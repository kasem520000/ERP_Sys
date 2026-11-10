import { sql } from "drizzle-orm";

import { type TenantDb } from "../db/client";
import { requireTenantContext } from "../db/tenant-context";
import { SETTINGS_REGISTRY } from "../../modules/configuration/domain/settings-schema";

/**
 * Effective-setting read for service-layer consumers (PHASE-006 T5/T6):
 * stored row ∪ registry default — the same L5 merge posture as the tenancy
 * settings service (CONFIGURATION_ENGINE §4). Shared infra so the partners
 * (BR-001 policy) and items (BR-003 allowance) application services read
 * policy without cross-module imports.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("effective-setting read requires an ambient tenant scope");
  }
  return context.tx;
}

export async function readEffectiveSetting<T>(key: string): Promise<T> {
  const tx = tenantTx();
  // Raw-SQL read (driver-parsed jsonb), NOT the drizzle column mapper:
  // the jsonb mapFromDriverValue re-parses driver-parsed string values,
  // mangling numeric-looking strings ("4321" → 4321) — a latent substrate
  // quirk the PHASE-008 decimal-string settings exposed (repair recorded
  // in the phase report).
  const result = await tx.execute(
    sql`SELECT value FROM tenant_settings WHERE key = ${key} LIMIT 1`,
  );
  const stored = (result.rows as unknown as { value: unknown }[])[0]?.value;
  const fallback = SETTINGS_REGISTRY[key]?.default;
  return (stored !== undefined ? stored : fallback) as T;
}

/** Own tenant's base currency (RLS id-variant: only the own row is visible). */
export async function ownTenantBaseCurrency(): Promise<string> {
  const tx = tenantTx();
  const result = await tx.execute(
    sql`SELECT base_currency FROM tenants WHERE id = erp.current_tenant_id()`,
  );
  const row = (result.rows as unknown as { base_currency: string }[])[0];
  if (row === undefined) {
    throw new Error("own tenant row not visible under the current scope");
  }
  return row.base_currency;
}
