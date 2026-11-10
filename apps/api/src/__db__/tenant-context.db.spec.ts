import { beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";
import { eq } from "drizzle-orm";

import { withTenant, requireTenantContext } from "../infra/db/tenant-context";
import { ensureTestDb, seedTenants, superuserClient, TENANT_A } from "./test-db";
import { getDb } from "../infra/db/client";
import { auditEvents } from "../db/schema";
import { AuditService } from "../modules/audit/application/audit.service";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";

/**
 * Unit-of-work + tenant-context behavior against real PostgreSQL 16
 * (PHASE-002 §5.4): the GUC is transaction-local, the ALS carries the tenant
 * + transaction, and the audit service appends inside the caller's
 * transaction (transactional audit).
 */

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await seedTenants(su);
  await su.end();
});

describe("withTenant unit-of-work", () => {
  it("sets the tenant GUC inside the transaction and reverts it after commit", async () => {
    const db = getDb();
    const leak = await db.execute<{ v: string | null }>(
      `SELECT nullif(current_setting('erp.tenant_id', true), '') AS v`,
    );
    expect(leak.rows[0]?.v ?? null).toBeNull();

    let insideValue: string | null = "unset";
    await withTenant(TENANT_A, async (tx) => {
      const result = await tx.execute<{ v: string | null }>(
        `SELECT nullif(current_setting('erp.tenant_id', true), '') AS v`,
      );
      insideValue = result.rows[0]?.v ?? null;
    });
    expect(insideValue).toBe(TENANT_A);

    const after = await db.execute<{ v: string | null }>(
      `SELECT nullif(current_setting('erp.tenant_id', true), '') AS v`,
    );
    expect(after.rows[0]?.v ?? null).toBeNull();
  });

  it("exposes the tenant context + live transaction through the ALS", async () => {
    await withTenant(TENANT_A, async () => {
      const context = requireTenantContext();
      expect(context.tenantId).toBe(TENANT_A);
      expect(context.tx).toBeDefined();
    });
  });

  it("rolls back atomically on failure — no partial writes (A9 shape)", async () => {
    const marker = generateUuidV7();
    const db = getDb();
    await expect(
      withTenant(TENANT_A, async (tx) => {
        await tx.insert(auditEvents).values({
          id: marker,
          tenantId: TENANT_A,
          action: "rollback.probe",
          entityType: "probe",
          entityId: marker,
        });
        throw new Error("forced failure");
      }),
    ).rejects.toThrow("forced failure");

    await withTenant(TENANT_A, async (tx) => {
      void tx;
      const found = await tx.select().from(auditEvents).where(eq(auditEvents.id, marker));
      expect(found).toHaveLength(0);
    });
    void db;
  });

  it("AuditService appends inside the caller's transaction (transactional audit)", async () => {
    const audit = new AuditService(new DrizzleAuditStore());
    const entityId = generateUuidV7();
    await withTenant(TENANT_A, async () => {
      await audit.record({
        action: "probe.recorded",
        entityType: "probe",
        entityId,
        after: { value: 42 },
      });
      // Same transaction: the row is visible before COMMIT.
      const rows = await audit.list({ entityType: "probe" });
      const own = rows.filter((row) => row.entityId === entityId);
      expect(own).toHaveLength(1);
      expect(own[0]?.after).toEqual({ value: 42 });
    });
    // Still visible after commit, still tenant-scoped.
    await withTenant(TENANT_A, async () => {
      const rows = await audit.list({ entityType: "probe" });
      expect(rows.some((row) => row.entityId === entityId)).toBe(true);
    });
  });
});
