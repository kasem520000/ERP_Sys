import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { ACTOR, ensureFiscalYear } from "../accounting/fixtures";
import {
  ensureFixtureGroup,
  MEMBER_SAR,
  MEMBER_USD,
  OWNER_TENANT,
  ownerNovemberPeriod,
  memberNovemberPeriod,
  setPeriodStatus,
  setupConsolidationFixture,
} from "./fixtures";

/**
 * PHASE-034 T6/T12 · the BR-056 live-harness suite: run creation is
 * REJECTED (typed, not warned) while any member's fiscal period for the
 * run period is open; succeeds after the member's period closes;
 * include_from bounds membership; FAILED runs leave NO partial snapshot;
 * the COMPLETED snapshot is rewrite-proof (the DB guard).
 */

let group: Awaited<ReturnType<typeof ensureFixtureGroup>>;
let periodId: string;

beforeAll(async () => {
  await setupConsolidationFixture();
  await withTenant(OWNER_TENANT, () => ensureFiscalYear());
  group = await ensureFixtureGroup();
  const period = await ownerNovemberPeriod();
  periodId = period.id;
});

describe("BR-056 · the run pre-check (typed rejection, never a warning)", () => {
  it("rejects with MEMBER_PERIOD_OPEN while a member period is OPEN (no job queued)", async () => {
    const memberPeriod = await memberNovemberPeriod(MEMBER_USD);
    await setPeriodStatus(memberPeriod.id, "OPEN");
    const service = await newRunService();
    await expect(
      withTenant(OWNER_TENANT, () =>
        service.createRun({ groupId: group.groupId, fiscalPeriodId: periodId, actorId: ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "MEMBER_PERIOD_OPEN" });
  });

  it("succeeds after the member's period closes (SOFT_CLOSED and LOCKED both count)", async () => {
    const memberPeriod = await memberNovemberPeriod(MEMBER_USD);
    await setPeriodStatus(memberPeriod.id, "SOFT_CLOSED");
    const service = await newRunService();
    const run = await withTenant(OWNER_TENANT, () =>
      service.createRun({ groupId: group.groupId, fiscalPeriodId: periodId, actorId: ACTOR }),
    );
    expect(run.status).toBe("QUEUED");
  });

  it("include_from bounds membership: a member whose window starts after the period is excluded from the run", async () => {
    // The fixture's SAR member carries include_from 2026-01-01 (inside the
    // period) — flip it beyond the period end and re-run: the member drops.
    const su = await (await import("../test-db")).superuserClient();
    await su.query(
      `UPDATE group_entities SET include_from = '2027-01-01'
       WHERE group_id = $1 AND member_tenant_id = $2`,
      [group.groupId, MEMBER_SAR],
    );
    await su.end();
    for (const member of [OWNER_TENANT, MEMBER_USD, MEMBER_SAR]) {
      const memberPeriod = await memberNovemberPeriod(member);
      await setPeriodStatus(memberPeriod.id, "SOFT_CLOSED");
    }
    const run = await createAndExecuteRun();
    const snapshot = run.snapshot as { members: { memberTenantId: string }[] };
    expect(snapshot.members.map((member) => member.memberTenantId)).not.toContain(MEMBER_SAR);
    // Restore the fixture window (order independence).
    const su2 = await (await import("../test-db")).superuserClient();
    await su2.query(
      `UPDATE group_entities SET include_from = '2026-01-01'
       WHERE group_id = $1 AND member_tenant_id = $2`,
      [group.groupId, MEMBER_SAR],
    );
    await su2.end();
  });

  it("FAILED runs leave NO partial snapshot (the CHECK-enforced shape)", async () => {
    // Force a failure: remove the dated USD rate (RATE_MISSING — INV-008
    // fails closed), then execute; the run must land FAILED typed with a
    // NULL snapshot.
    const su = await (await import("../test-db")).superuserClient();
    await su.query(
      `DELETE FROM exchange_rates WHERE tenant_id = $1 AND currency_code = 'USD' AND rate_date = '2026-11-30'`,
      [OWNER_TENANT],
    );
    await su.end();
    const run = await createAndExecuteRun();
    expect(run.status).toBe("FAILED");
    expect(run.errorCode).toBe("RATE_MISSING");
    expect(run.snapshot).toBeNull();
    // Restore the rate (order independence).
    const su2 = await (await import("../test-db")).superuserClient();
    await su2.query(
      `INSERT INTO exchange_rates (id, tenant_id, currency_code, rate_date, rate, source)
       VALUES (gen_random_uuid(), $1, 'USD', '2026-11-30', '3.75000000', 'MANUAL')
       ON CONFLICT (tenant_id, currency_code, rate_date) DO NOTHING`,
      [OWNER_TENANT],
    );
    await su2.end();
  });

  it("the COMPLETED snapshot is rewrite-proof (the DB guard trigger)", async () => {
    const run = await createAndExecuteRun();
    expect(run.status).toBe("COMPLETED");
    const su = await (await import("../test-db")).superuserClient();
    await expect(
      su.query(`UPDATE consolidation_runs SET snapshot = '{"tampered": true}'::jsonb WHERE id = $1`, [run.id]),
    ).rejects.toThrow(/immutable/i);
    await su.end();
  });
});

async function newRunService() {
  const { RunService } = await import("../../modules/consolidation/application/run-service");
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { ConsolidationReaderService } = await import(
    "../../modules/consolidation/application/reader-service"
  );
  const audit = new AuditService(new DrizzleAuditStore());
  return new RunService(audit, new ConsolidationReaderService(audit));
}

async function createAndExecuteRun() {
  const service = await newRunService();
  return withTenant(OWNER_TENANT, async () => {
    const run = await service.createRun({
      groupId: group.groupId,
      fiscalPeriodId: periodId,
      actorId: ACTOR,
    });
    return service.executeRun({ runId: run.id, actorId: ACTOR });
  });
}
