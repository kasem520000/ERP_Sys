import { AsyncLocalStorage } from "node:async_hooks";

import { DomainError } from "@erp/domain-core";
import { sql } from "drizzle-orm";

import { getDb, type TenantDb } from "./client";

// Re-export for consumers (PHASE-004 platform services pass the shared tx).
export type { TenantDb };
import { getCorrelationId } from "../observability/request-context";

/**
 * Tenant context (ADR-0005 layer 1): every repository/service call MUST run
 * inside `withTenant` — the context is derived from the authenticated session
 * server-side, never from client input, and any access without it throws
 * (fail closed). The context carries the live transaction handle so services
 * append audit events and rows through the SAME transaction as the caller.
 */
export interface TenantContext {
  tenantId: string;
  correlationId?: string;
  tx?: TenantDb;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export class MissingTenantContextError extends DomainError {
  constructor() {
    super(
      "tenancy/tenant-context-missing",
      "Database access requires a tenant context: wrap the call in withTenant()",
    );
  }
}

/** Current tenant context, or undefined outside a tenant scope. */
export function currentTenantContext(): TenantContext | undefined {
  return tenantContextStorage.getStore();
}

/** Current tenant context; throws outside a tenant scope (fail closed). */
export function requireTenantContext(): TenantContext {
  const context = tenantContextStorage.getStore();
  if (context === undefined) {
    throw new MissingTenantContextError();
  }
  return context;
}

/** Live transaction handle of the ambient tenant scope, when one exists. */
export function ambientTx(): TenantDb | undefined {
  return tenantContextStorage.getStore()?.tx;
}

/**
 * Unit-of-work (PHASE-002 §5.4): opens a transaction, sets the tenant GUC
 * transaction-locally (`set_config(..., true)` — cannot leak across pooled
 * connections), runs `fn` with the handle stored in the ambient context, and
 * commits/rolls back atomically. Correlation id is captured from the request
 * scope so audit events inside the UoW carry it.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  const db = getDb();
  const context: TenantContext = {
    tenantId,
    correlationId: getCorrelationId(),
  };
  return tenantContextStorage.run(context, () =>
    db.transaction(async (tx) => {
      // Transaction-local GUC (TENANT_ISOLATION §2): true → reverted at
      // COMMIT/ROLLBACK, so a pooled connection can never carry a stale
      // tenant. The value is a bound parameter, never string-concatenated.
      await tx.execute(sql`SELECT set_config('erp.tenant_id', ${tenantId}, true)`);
      context.tx = tx;
      return fn(tx);
    }),
  );
}

/**
 * Platform-scope context (PHASE-004; session-context.ts `PlatformScope`
 * marker): the admin-plane GUC path (TENANT_ISOLATION §3.2) — a transaction
 * with `erp.platform_scope` set locally. Platform rows (`tenants` list,
 * `plans`, NULL-tenant `audit_events`) become visible; tenant-owned tables
 * stay invisible (their policies only honor the tenant GUC — per-operation
 * tenant scoping happens through withTenant(target), never a blanket GUC).
 * Every consumer of this path is permission-gated (`platform.*`) and its
 * use is audited with `via_platform_admin = true` (matrix §3.10).
 */
export interface PlatformContext {
  readonly platform: true;
  correlationId?: string;
  tx?: TenantDb;
}

/** Discriminated ambient scope: tenant UoW or platform UoW (never both). */
export type DbContext = TenantContext | PlatformContext;

export const platformScopeStorage = new AsyncLocalStorage<PlatformContext>();

/** Current platform context, or undefined outside a platform scope. */
export function ambientPlatformContext(): PlatformContext | undefined {
  return platformScopeStorage.getStore();
}

/**
 * Platform unit-of-work: opens a transaction, sets the platform GUC
 * transaction-locally, runs `fn` with the handle stored in the ambient
 * platform context, commits/rolls back atomically.
 */
export async function withPlatformScope<T>(
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  const db = getDb();
  const context: PlatformContext = { platform: true, correlationId: getCorrelationId() };
  return platformScopeStorage.run(context, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('erp.platform_scope', 'on', true)`);
      context.tx = tx;
      return fn(tx);
    }),
  );
}

/**
 * Ambient transaction of either scope (tenant first, then platform) —
 * consumers that legitimately run under both envelopes (platform console
 * per-operation tenant reads) resolve one handle without caring which
 * ALS store carries it.
 */
export function ambientAnyTx(): TenantDb | undefined {
  return (
    tenantContextStorage.getStore()?.tx ?? platformScopeStorage.getStore()?.tx
  );
}

/**
 * PHASE-004 per-operation tenant scoping (ADR-0005): enter the tenant
 * context ON an existing transaction — used by platform-scope services
 * (console detail, registration, lifecycle, support access) so tenant-
 * plane writes and BOTH audit shapes (platform NULL-tenant row + tenant
 * row) commit atomically in the same UoW. Sets the tenant GUC
 * transaction-locally on the shared handle; never opens a second
 * transaction.
 */
export async function withTenantOnTx<T>(
  tenantId: string,
  tx: TenantDb,
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  await tx.execute(sql`SELECT set_config('erp.tenant_id', ${tenantId}, true)`);
  const context: TenantContext = {
    tenantId,
    correlationId: getCorrelationId(),
    tx,
  };
  return tenantContextStorage.run(context, () => fn(tx));
}
