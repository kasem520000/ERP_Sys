import { and, asc, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import type {
  PlatformContext,
  TenantContext,
} from "../../../infra/db/tenant-context";
import { auditEvents } from "../../../db/schema";
import {
  AuditStore,
  type AuditEventInput,
  type AuditEventRow,
  type AuditQuery,
  type PlatformAuditQuery,
} from "../application/audit.service";

/**
 * Drizzle-backed audit store: every statement runs through the ambient
 * transaction (`withTenant` / `withPlatformScope` handle) so the audit row
 * commits with the audited action — transactional auditability — and RLS
 * (`tenant_id = erp.current_tenant_id()` on the tenant path; the platform
 * GUC path for platform rows) is the safety net. The append-only guard
 * trigger + missing UPDATE/DELETE grants make history rewriting impossible
 * (attack tests A1–A5/A10).
 */
export class DrizzleAuditStore extends AuditStore {
  async append(context: TenantContext, event: AuditEventInput): Promise<void> {
    const tx = this.requireTx(context.tx);
    await tx.insert(auditEvents).values({
      id: generateUuidV7(),
      tenantId: context.tenantId,
      actorId: event.actorId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: event.before ?? null,
      after: event.after ?? null,
      correlationId: context.correlationId ?? null,
      deviceId: event.deviceId ?? null,
      viaPlatformAdmin: event.viaPlatformAdmin === true,
    });
  }

  /**
   * PHASE-004 platform append: tenant_id NULL — admitted ONLY by the
   * platform GUC (the INSERT policy requires tenant_id IS NULL ∧ platform
   * scope), stamped via_platform_admin = true.
   */
  async appendPlatform(context: PlatformContext, event: AuditEventInput): Promise<void> {
    const tx = this.requireTx(context.tx);
    await tx.insert(auditEvents).values({
      id: generateUuidV7(),
      tenantId: null,
      actorId: event.actorId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: event.before ?? null,
      after: event.after ?? null,
      correlationId: context.correlationId ?? null,
      deviceId: null,
      viaPlatformAdmin: true,
    });
  }

  async list(
    context: TenantContext,
    query: AuditQuery,
  ): Promise<readonly AuditEventRow[]> {
    const tx = this.requireTx(context.tx);
    const filters = [
      query.entityType !== undefined ? eq(auditEvents.entityType, query.entityType) : undefined,
      query.entityId !== undefined ? eq(auditEvents.entityId, query.entityId) : undefined,
      query.actorId !== undefined ? eq(auditEvents.actorId, query.actorId) : undefined,
      query.action !== undefined ? eq(auditEvents.action, query.action) : undefined,
      // PHASE-024 T8: the correlation-id lookup (the tenant-admin review
      // tooling's "follow one request" filter).
      query.correlationId !== undefined
        ? eq(auditEvents.correlationId, query.correlationId)
        : undefined,
      query.fromAt !== undefined ? gte(auditEvents.at, query.fromAt) : undefined,
      query.toAt !== undefined ? lte(auditEvents.at, query.toAt) : undefined,
    ].filter((filter) => filter !== undefined);
    const rows = await tx
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(asc(auditEvents.at))
      .limit(query.limit ?? 100);
    return rows.map(toRow);
  }

  /**
   * Cross-tenant platform review (platform GUC path): keyset pagination on
   * (at, id) DESC with optional tenant/action/time/platformOnly filters.
   */
  async listPlatform(
    context: PlatformContext,
    query: PlatformAuditQuery,
  ): Promise<readonly AuditEventRow[]> {
    const tx = this.requireTx(context.tx);
    const limit = query.limit ?? 100;
    const filters = [
      query.tenantId !== undefined ? eq(auditEvents.tenantId, query.tenantId) : undefined,
      query.platformOnly === true ? isNull(auditEvents.tenantId) : undefined,
      query.action !== undefined ? eq(auditEvents.action, query.action) : undefined,
      query.fromAt !== undefined ? gte(auditEvents.at, query.fromAt) : undefined,
      query.toAt !== undefined ? lte(auditEvents.at, query.toAt) : undefined,
      query.cursor !== undefined
        ? or(
            lt(auditEvents.at, query.cursor.at),
            and(
              eq(auditEvents.at, query.cursor.at),
              lt(auditEvents.id, query.cursor.id),
            ),
          )
        : undefined,
    ].filter((filter) => filter !== undefined);
    const rows = await tx
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(limit + 1);
    return rows.slice(0, limit).map(toRow);
  }

  private requireTx(tx: TenantDb | undefined): TenantDb {
    if (tx === undefined) {
      throw new Error(
        "Audit store requires an active transaction: call inside withTenant()/withPlatformScope()",
      );
    }
    return tx;
  }
}

function toRow(row: typeof auditEvents.$inferSelect): AuditEventRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    correlationId: row.correlationId,
    deviceId: row.deviceId,
    at: row.at,
    viaPlatformAdmin: row.viaPlatformAdmin,
  };
}
