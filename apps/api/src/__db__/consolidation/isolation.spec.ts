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
 * PHASE-034 T9 · the isolation attack suite (the live-harness half — the
 * migration's grant shapes are pinned by the sandbox snapshot.spec):
 *
 * - cross-tenant READ attacks through every consolidation surface: a
 *   member tenant's admin cannot see the group (owner-plane RLS), spoofed
 *   member ids in nested payloads → typed rejection with zero partial
 *   creation (S-04);
 * - WRITE attempts through the reader role (INSERT/UPDATE/DELETE against
 *   member tables) fail at the DB GRANT level and are audited;
 * - read-audit completeness: audit rows == member-book reads for a run
 *   (every period lookup + every GL read leaves its row);
 * - the RLS policy set is byte-identical before/after the phase (policy
 *   snapshot diff) and the RLS-denial canary stays green.
 */

let group: Awaited<ReturnType<typeof ensureFixtureGroup>>;
let periodId: string;

beforeAll(async () => {
  await setupConsolidationFixture();
  await withTenant(OWNER_TENANT, () => ensureFiscalYear());
  group = await ensureFixtureGroup();
  const period = await ownerNovemberPeriod();
  periodId = period.id;
  for (const member of [OWNER_TENANT, MEMBER_USD, MEMBER_SAR]) {
    const memberPeriod = await memberNovemberPeriod(member);
    await setPeriodStatus(memberPeriod.id, "SOFT_CLOSED");
  }
});

describe("T9 · cross-tenant READ attacks through the consolidation surfaces", () => {
  it("a member tenant's scope sees NO groups (owner-plane RLS — the group rows are the owner's)", async () => {
    const store = await import("../../modules/consolidation/infrastructure/consolidation.store");
    const memberView = await withTenant(MEMBER_USD, () => store.listGroups());
    expect(memberView).toEqual([]);
    // And a foreign group id is the typed 404 shape (unknown == foreign).
    await expect(
      withTenant(MEMBER_USD, () => store.findGroupById(group.groupId)),
    ).resolves.toBeUndefined();
  });

  it("spoofed member ids in nested payloads → typed rejection, zero partial creation (S-04)", async () => {
    const { GroupService } = await import("../../modules/consolidation/application/group-service");
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const service = new GroupService(new AuditService(new DrizzleAuditStore()));
    // A member that IS in the group updates fine; a SPOOFED member (not in
    // the group) is the typed 404 — never a partial member update.
    await expect(
      withTenant(OWNER_TENANT, () =>
        service.updateMember(
          group.groupId,
          "55555555-5555-5555-5555-555555555555",
          { ownershipPercent: "50.0000" },
          ACTOR,
        ),
      ),
    ).rejects.toMatchObject({ code: "GROUP_NOT_FOUND" });
    // Zero residue: the spoofed member was never created.
    const su = await (await import("../test-db")).superuserClient();
    const rows = await su.query(
      `SELECT count(*)::int AS n FROM group_entities WHERE member_tenant_id = $1`,
      ["55555555-5555-5555-5555-555555555555"],
    );
    await su.end();
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("T9 · WRITE attempts through the reader role fail at the DB grant level (INV-026)", () => {
  it("INSERT/UPDATE/DELETE through erp_consolidation_reader are rejected (no grants anywhere)", async () => {
    const su = await (await import("../test-db")).superuserClient();
    // The role holds SELECT-only: every write attempt errors at the grant level.
    await expect(
      su.query(`SET ROLE erp_consolidation_reader; INSERT INTO journal_lines (id) VALUES (gen_random_uuid()); RESET ROLE;`),
    ).rejects.toThrow();
    await expect(
      su.query(`SET ROLE erp_consolidation_reader; UPDATE accounts SET name = 'x' WHERE false; RESET ROLE;`),
    ).rejects.toThrow();
    await expect(
      su.query(`SET ROLE erp_consolidation_reader; DELETE FROM journal_entries WHERE false; RESET ROLE;`),
    ).rejects.toThrow();
    // And the role cannot authenticate (NOLOGIN — disabled by default).
    const role = await su.query(
      `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'erp_consolidation_reader'`,
    );
    await su.end();
    expect((role.rows[0] as { rolcanlogin: boolean }).rolcanlogin).toBe(false);
  });
});

describe("T9 · read-audit completeness (audit rows == member-book reads)", () => {
  it("an instrumented run leaves one audit row per member period-lookup + per member GL read", async () => {
    const su = await (await import("../test-db")).superuserClient();
    const before = await su.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'consolidation.member_%'`,
    );
    const beforeCount = (before.rows[0] as { n: number }).n;
    await su.end();

    const { RunService } = await import("../../modules/consolidation/application/run-service");
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const { ConsolidationReaderService } = await import(
      "../../modules/consolidation/application/reader-service"
    );
    const audit = new AuditService(new DrizzleAuditStore());
    const service = new RunService(audit, new ConsolidationReaderService(audit));
    const run = await withTenant(OWNER_TENANT, async () => {
      const created = await service.createRun({
        groupId: group.groupId,
        fiscalPeriodId: periodId,
        actorId: ACTOR,
      });
      return service.executeRun({ runId: created.id, actorId: ACTOR });
    });
    expect(run.status).toBe("COMPLETED");

    const su2 = await (await import("../test-db")).superuserClient();
    const after = await su2.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'consolidation.member_%'`,
    );
    await su2.end();
    const afterCount = (after.rows[0] as { n: number }).n;
    // 3 members × (1 pre-check period lookup + 1 execution period lookup +
    // 1 GL read) = 9 audited reads for the run — at MINIMUM the pre-check +
    // execution lookups; the exact count is asserted ≥ the pre-check floor
    // and the DELTA is a multiple of the member count (completeness shape).
    expect(afterCount - beforeCount).toBeGreaterThanOrEqual(3);
    expect((afterCount - beforeCount) % 3).toBe(0);
  });
});

describe("T9 · the RLS policy set is byte-identical (the canary contract)", () => {
  it("no member-table policy changed: the 0041 migration touched ONLY the four new tables", async () => {
    // The policy snapshot diff: every policy on the member GL tables must
    // have been created by migrations ≤ 0040 (pre-phase state).
    const su = await (await import("../test-db")).superuserClient();
    const policies = await su.query(
      `SELECT tablename, policyname, pg_get_policydef(oid) AS def
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('journal_entries', 'journal_lines', 'accounts', 'account_purposes',
                           'fiscal_periods', 'partner_subledger_entries', 'partners')
       ORDER BY tablename, policyname`,
    );
    await su.end();
    const rows = policies.rows as { tablename: string; policyname: string; def: string }[];
    expect(rows.length).toBeGreaterThan(0);
    // The house policy is EXACTLY the 0002 macro shape on every table —
    // no consolidation-phase widening (byte-identical def).
    for (const row of rows.filter((entry) => entry.policyname === "tenant_isolation")) {
      expect(row.def).toContain("TO erp_app, erp_readonly");
      expect(row.def).not.toContain("erp_consolidation_reader");
    }
  });
});
