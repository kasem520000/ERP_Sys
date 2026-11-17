import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Client } from "pg";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../infra/db/tenant-context";
import { payrollAtomicKeys } from "../../modules/hr/infrastructure/atomic";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import * as payrollStore from "../../modules/payroll/infrastructure/payroll.store";
import * as statutoryStore from "../../modules/payroll/infrastructure/statutory.store";
import { EosbService } from "../../modules/payroll/application/eosb-service";
import { EosService } from "../../modules/payroll/application/eos-service";
import { StatutoryProfileService } from "../../modules/payroll/application/statutory-profile-service";
import { StructureService } from "../../modules/payroll/application/structure-service";
import { materializeCanonicalStatutorySet } from "../../modules/payroll/infrastructure/statutory-canonical";
import {
  P_ACTOR,
  P_APPROVER,
  calculation,
  employees,
  periods,
  payouts,
  runPosting,
  setupPayrollFixture,
  su,
  workflow,
  withTenant,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";

/**
 * PHASE-046 (W-6, T-17) — THE PERMANENT PAYROLL WRITER-RACE SUITE, in
 * the T-20 idiom (the hr-writer-races precedent): vi.spyOn splits the
 * WINNER's UoW exactly at the raced window — AFTER the winner's write
 * arm has run inside its transaction (every gate held, nothing
 * committed) — and starts the LOSER as a REAL service call in its OWN
 * withTenant UoW on its own pooled connection. The world is classified
 * from committed reads:
 *   - "blocked" — the loser is WAITING on the lock this duel races (the
 *     key's own advisory tag, or the winner's own transaction id for the
 *     row-lock duels) — the post-fix shape (the pre-fix world is
 *     "slipped", the loser settles inside the window on a stale read —
 *     the owner's proof, and it FAILS these tests);
 *   - after the winner commits, the loser unblocks, re-reads the
 *     winner's COMMITTED state, and answers on it (typed refusal or the
 *     exact legal settlement).
 * Every duel closes with the NO-ILLEGAL-STATE assertions (لا تبقى
 * الحالة غير القانونية).
 *
 * THE DUELS (the master plan §3 W-6 + the owner's F2/F3 scope additions
 * recorded 2026-11-17 at 6387da9):
 *   (1) calculate × calculate — the DRAFT reset race: exactly one line
 *       set, the INV-025 fold intact;
 *   (2a) post × calculate — the reset never eats a posted run (the
 *       status floor);
 *   (2b) calculate × post — the post never lands on a DRAFT (the same
 *       floor, the other direction);
 *   (3) EOSB true-up × true-up (one employee) — exactly one G-54
 *       journal; the second computation is the zero-delta no-journal
 *       law (never a double true-up);
 *   (4) EOSB true-up × G-31 settle — the employee gate: the provision
 *       never double-counts, the settle lands after the alignment;
 *   (5) verify × verify — the CAS: one flip, the loser typed
 *       STATUTORY_ALREADY_VERIFIED, exactly one audit event;
 *   (6) remittance × remittance — INV-013: one journal, one movement,
 *       the liability tracks once;
 *   (7) THE SMOKE — three in-flight writers on one run (remit + payout
 *       + a true-up referencing the run): no 40P01, every arm settles,
 *       the final state exact (the forest argument for the payroll
 *       namespaces — the advisory gate and F3's row-lock increment
 *       never cycle);
 *   (8) F2 — payout × payout on one run with a partial outstanding:
 *       exactly one loser typed (the above-outstanding refusal),
 *       paid_net_total advanced exactly once (the pre-F2 lost update —
 *       two journals, one overwritten advance — is unrepresentable);
 *   (9) F3 — true-up × true-up, TWO employees, ONE run reference: the
 *       run's eosb_trueup_total advances by exactly the Σ of both
 *       deltas (the SQL-side increment under the row's own lock — no
 *       lost update).
 *
 * Isolation: the DEDICATED tenant RACEP (the T-20 CC precedent — never
 * the PAY world's registers whose censuses the 029 spec pins).
 */

const TENANT_RACEP = "9e9e9e9e-9e9e-9e9e-9e9e-9e9e9e9e9e9e";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const eosService = new EosService(audit, posting);
const eosb = new EosbService(audit, posting, eosService);
const statutory = new StatutoryProfileService(audit);
const structures = new StructureService(audit);

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[],
): Promise<T[]> {
  const suClient: Client = await su();
  try {
    const result = await suClient.query<T>(text, params as never[]);
    return result.rows;
  } finally {
    await suClient.end();
  }
}

// -- the deterministic duel harness (the mfg race + T-20 precedents) --------------------

async function advisoryWaiterOn(composedKey: string): Promise<boolean> {
  return withTenant(TENANT_RACEP, async () => {
    const rows = await requireTenantContext().tx!.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_locks
           WHERE locktype = 'advisory' AND NOT granted
             AND classid = ((hashtextextended(${composedKey}, 0) >> 32) & 4294967295)::oid
             AND objid = (hashtextextended(${composedKey}, 0) & 4294967295)::oid`,
    );
    return rows.rows[0]!.n > 0;
  });
}

async function winnerTxWaiter(xactId: string): Promise<boolean> {
  return withTenant(TENANT_RACEP, async () => {
    const rows = await requireTenantContext().tx!.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_locks
           WHERE locktype = 'transactionid' AND NOT granted
             AND transactionid::text = ${xactId}`,
    );
    return rows.rows[0]!.n > 0;
  });
}

type ExpectedWait =
  | { kind: "advisory"; key: string }
  | { kind: "winner-tx"; xactId: string };

async function boundWaiter(expected: ExpectedWait): Promise<boolean> {
  return expected.kind === "advisory"
    ? advisoryWaiterOn(expected.key)
    : winnerTxWaiter(expected.xactId);
}

interface WindowObservation {
  shape: "slipped" | "blocked";
  loserError?: unknown;
}

async function observeTheWindow(
  loser: Promise<unknown>,
  expected: ExpectedWait,
): Promise<WindowObservation> {
  let settled = false;
  let loserError: unknown;
  loser.then(
    () => {
      settled = true;
    },
    (error: unknown) => {
      settled = true;
      loserError = error;
    },
  );
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (settled) {
      return { shape: "slipped", loserError };
    }
    if (await boundWaiter(expected)) {
      return { shape: "blocked" };
    }
    if (Date.now() > deadline) {
      throw new Error(
        "harness: the loser neither settled nor blocked on the raced lock within 15s — the window is not the raced one",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface DuelArm {
  observation: { value?: WindowObservation };
  loser: { promise?: Promise<unknown>; value?: unknown; error?: unknown };
  finish: () => Promise<void>;
}

function armDuelSpy<A extends unknown[], R>(
  spy: MockInstance<(...args: A) => Promise<R>>,
  real: (...args: A) => Promise<R>,
  expectation: { advisoryKey: string } | { winnerTx: true },
  runLoser: () => Promise<unknown>,
): DuelArm {
  const arm: DuelArm = {
    observation: {},
    loser: {},
    finish: async () => {
      spy.mockRestore();
      if (arm.loser.promise !== undefined) {
        try {
          arm.loser.value = await arm.loser.promise;
        } catch (error) {
          arm.loser.error = error;
        }
      }
    },
  };
  spy.mockImplementationOnce(async (...args: A) => {
    const value = await real(...args);
    let expected: ExpectedWait;
    if ("advisoryKey" in expectation) {
      expected = { kind: "advisory", key: expectation.advisoryKey };
    } else {
      const xactId = (
        await requireTenantContext().tx!.execute<{ xid: string }>(
          sql`SELECT pg_current_xact_id()::text AS xid`,
        )
      ).rows[0]!.xid;
      expected = { kind: "winner-tx", xactId };
    }
    const loser = runLoser();
    arm.loser.promise = loser;
    arm.observation.value = await observeTheWindow(loser, expected);
    return value;
  });
  return arm;
}

function loserCode(arm: DuelArm): string {
  return (arm.loser.error as { code: string } | undefined)?.code ?? "(fulfilled)";
}

// -- the world --------------------------------------------------------------------------

interface RaceWorld {
  periodIds: Record<string, string>;
  bankCashAccountId: string;
  ksaEmployeeId: string;
  tuEmployeeId: string;
  termEmployeeId: string;
  cEmployeeId: string;
  dEmployeeId: string;
  eEmployeeId: string;
}

let world: RaceWorld;

async function postRun(periodName: string): Promise<string> {
  return withTenant(TENANT_RACEP, async () => {
    const run = await calculation.createRun({
      fiscalPeriodId: world.periodIds[periodName]!,
      actorId: P_ACTOR,
    });
    await calculation.calculate(run.id, { actorId: P_ACTOR });
    await workflow.submit(run.id, P_ACTOR);
    await workflow.approve(run.id, P_APPROVER);
    const posted = await runPosting.post(run.id, P_ACTOR);
    expect(posted.status).toBe("POSTED");
    return run.id;
  });
}

beforeAll(async () => {
  await setupPayrollFixture();
  const client = await su();
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant RACEP (046 writer races)', 'المستأجر لسباقات الكتّاب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_RACEP],
  );
  await client.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
       (gen_random_uuid(), $1, 'payroll.eos.enabled', 'true'::jsonb),
       (gen_random_uuid(), $1, 'payroll.eos.accrual_days_per_service_year', '3'::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_RACEP],
  );
  await client.end();

  world = await withTenant(TENANT_RACEP, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    await materializeCanonicalStatutorySet();
    const salariesExpenseAccount = (await accounting.findActivePurpose("SALARIES_EXPENSE"))!.accountId;

    const existing = await structures.list(50);
    const structure =
      existing.find((row) => row.code === "ST-RACE") ??
      (await structures.create({
        code: "ST-RACE",
        name: "Writer-races structure",
        nameAr: "هيكل سباقات الكتّاب",
        actorId: P_ACTOR,
      }));
    if ((await payrollStore.countComponents(structure.id)) === 0) {
      await structures.replaceComponents(
        structure.id,
        [
          {
            key: "HOUSING",
            name: "Housing allowance",
            nameAr: "بدل السكن",
            kind: "ALLOWANCE",
            calc: "FIXED",
            amount: "2000.0000",
            glAccountId: salariesExpenseAccount,
            isEosBase: false,
            seq: 1,
          },
        ],
        P_ACTOR,
      );
    }
    const year = await periods.createYear(P_ACTOR, {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const periodIds: Record<string, string> = {};
    for (const period of await accounting.listPeriods(year.id)) {
      if (period.kind === "REGULAR") periodIds[period.name] = period.id;
    }
    const bank = await treasury.insertCashAccount({
      name: "Race Bank",
      nameAr: "بنك السباقات",
      type: "BANK",
      accountId: (await accounting.findAccountByCode("1121"))!.id,
      branchId: null,
      currencyCode: "SAR",
      createdBy: P_ACTOR,
    });

    const list = await employees.list({ limit: 100 });
    const ensure = async (input: Parameters<typeof employees.create>[0]) => {
      const found = list.find((row) => row.code === input.code);
      if (found !== undefined) return found.id;
      return (await employees.create(input)).id;
    };
    const mk = (code: string, name: string, nationality: string, basic: string, hireDate: string) =>
      ensure({
        code,
        name,
        nameAr: null,
        nationality,
        hireDate,
        contractType: "FULL_TIME",
        basicSalary: basic,
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      });
    return {
      periodIds,
      bankCashAccountId: bank.id,
      ksaEmployeeId: await mk("EMP-RACE-001", "Race Saudi Arm", "SA", "10000.0000", "2020-01-01"),
      tuEmployeeId: await mk("EMP-RACE-002", "Race True-Up Pair", "EG", "9000.0000", "2019-06-01"),
      termEmployeeId: await mk("EMP-RACE-003", "Race Terminated", "SA", "9000.0000", "2020-01-01"),
      cEmployeeId: await mk("EMP-RACE-004", "Race Smoke", "EG", "9000.0000", "2019-06-01"),
      dEmployeeId: await mk("EMP-RACE-005", "Race Two-Employees D", "EG", "9000.0000", "2019-06-01"),
      eEmployeeId: await mk("EMP-RACE-006", "Race Two-Employees E", "EG", "9000.0000", "2019-06-01"),
    };
  });
});

afterAll(async () => {
  // The world stays (its own tenant, its own books) — the deterministic
  // re-run floor is the tenant's isolation, not a wipe.
});

// -- the duels --------------------------------------------------------------------------

describe("PHASE-046 (W-6, T-17) · the payroll writer races — the run gate", () => {
  it("(1) calculate × calculate — the DRAFT reset race: the loser blocks on the run gate, re-recalculates on the committed lines; exactly ONE line set, the INV-025 fold intact", async () => {
    const runId = (
      await withTenant(TENANT_RACEP, () =>
        calculation.createRun({ fiscalPeriodId: world.periodIds["FY2026-01"]!, actorId: P_ACTOR }),
      )
    ).id;
    await withTenant(TENANT_RACEP, () => calculation.calculate(runId, { actorId: P_ACTOR }));

    const real = payrollStore.updateRun;
    const spy = vi.spyOn(payrollStore, "updateRun");
    const arm = armDuelSpy(
      spy,
      real,
      { advisoryKey: `${TENANT_RACEP}|${payrollAtomicKeys.run(runId)}` },
      () => withTenant(TENANT_RACEP, () => calculation.calculate(runId, { actorId: P_ACTOR })),
    );
    let winner: Awaited<ReturnType<typeof calculation.calculate>> | undefined;
    try {
      winner = await withTenant(TENANT_RACEP, () => calculation.calculate(runId, { actorId: P_ACTOR }));
    } finally {
      await arm.finish();
    }
    expect(winner!.run.status).toBe("DRAFT");
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced (both recalcs interleaved on one line set): the loser settled inside the window — ${loserCode(arm)}`,
    ).toBe("blocked");
    // The loser (a REAL recalculation) fulfilled on the committed lines.
    expect(loserCode(arm)).toBe("(fulfilled)");

    // NO ILLEGAL STATE: exactly ONE line set (never doubled), the totals
    // == the fold (INV-025), the run still DRAFT.
    const after = await withTenant(TENANT_RACEP, () => calculation.getRun(runId));
    const population = (await withTenant(TENANT_RACEP, () => employees.list({ status: "ACTIVE", limit: 100 })))
      .length;
    expect(after.lines).toHaveLength(population); // exactly one line per employee
    let gross = "0.0000";
    for (const line of after.lines) {
      gross = addLocal(gross, line.grossAmount);
    }
    expect(gross).toBe(after.run.grossTotal);
    expect(after.run.status).toBe("DRAFT");
  });

  it("(2a) post × calculate — the reset never eats a posted run: the calculate blocks, re-reads POSTED, refuses typed; the posted books intact", async () => {
    const runId = (
      await withTenant(TENANT_RACEP, async () => {
        const run = await calculation.createRun({
          fiscalPeriodId: world.periodIds["FY2026-02"]!,
          actorId: P_ACTOR,
        });
        await calculation.calculate(run.id, { actorId: P_ACTOR });
        await workflow.submit(run.id, P_ACTOR);
        await workflow.approve(run.id, P_APPROVER);
        return run.id;
      })
    );

    const real = payrollStore.updateRun;
    const spy = vi.spyOn(payrollStore, "updateRun");
    const arm = armDuelSpy(
      spy,
      real,
      { advisoryKey: `${TENANT_RACEP}|${payrollAtomicKeys.run(runId)}` },
      () => withTenant(TENANT_RACEP, () => calculation.calculate(runId, { actorId: P_ACTOR })),
    );
    let winner: Awaited<ReturnType<typeof runPosting.post>> | undefined;
    try {
      winner = await withTenant(TENANT_RACEP, () => runPosting.post(runId, P_ACTOR));
    } finally {
      await arm.finish();
    }
    expect(winner!.status).toBe("POSTED");
    expect(arm.observation.value!.shape).toBe("blocked");
    expect(loserCode(arm)).toBe("IMMUTABLE_DOCUMENT");

    // NO ILLEGAL STATE: the posted run's lines survive the refused reset
    // — the fold is intact, the journal still exists.
    const after = await withTenant(TENANT_RACEP, () => calculation.getRun(runId));
    expect(after.run.status).toBe("POSTED");
    expect(after.lines.length).toBeGreaterThan(0);
    expect(after.run.journalEntryId).not.toBeNull();
  });

  it("(2b) calculate × post — the same floor, the other direction: the post blocks, re-reads DRAFT, refuses typed; zero residue", async () => {
    const runId = (
      await withTenant(TENANT_RACEP, () =>
        calculation.createRun({ fiscalPeriodId: world.periodIds["FY2026-03"]!, actorId: P_ACTOR }),
      )
    ).id;
    await withTenant(TENANT_RACEP, () => calculation.calculate(runId, { actorId: P_ACTOR }));

    const real = payrollStore.updateRun;
    const spy = vi.spyOn(payrollStore, "updateRun");
    const arm = armDuelSpy(
      spy,
      real,
      { advisoryKey: `${TENANT_RACEP}|${payrollAtomicKeys.run(runId)}` },
      () => withTenant(TENANT_RACEP, () => runPosting.post(runId, P_ACTOR)),
    );
    try {
      await withTenant(TENANT_RACEP, () => calculation.calculate(runId, { actorId: P_ACTOR }));
    } finally {
      await arm.finish();
    }
    expect(arm.observation.value!.shape).toBe("blocked");
    expect(loserCode(arm)).toBe("IMMUTABLE_DOCUMENT"); // post (submit + approve first)

    // NO ILLEGAL STATE: the run stays DRAFT, no journal ever landed.
    const after = await withTenant(TENANT_RACEP, () => calculation.getRun(runId));
    expect(after.run.status).toBe("DRAFT");
    expect(after.run.journalEntryId).toBeNull();
  });
});

describe("PHASE-046 (W-6, T-17) · the payroll writer races — the eosb employee gate", () => {
  it("(3) EOSB true-up × true-up (one employee): the loser blocks on the employee gate, re-reads the winner's standing, and is the ZERO-DELTA no-journal law — exactly one G-54 journal", async () => {
    // The winner: the OPENING true-up (first adoption — no prior
    // calculation rows; the standing starts at the 029 balance).
    const real = statutoryStore.insertEosbCalculation;
    const spy = vi.spyOn(statutoryStore, "insertEosbCalculation");
    const arm = armDuelSpy(
      spy,
      real,
      { advisoryKey: `${TENANT_RACEP}|${payrollAtomicKeys.eosbEmployee(world.tuEmployeeId)}` },
      () =>
        withTenant(TENANT_RACEP, () =>
          eosb.trueUp({
            employeeId: world.tuEmployeeId,
            kind: "PERIOD_TRUE_UP",
            onDate: "2026-06-02",
            actorId: P_ACTOR,
          }),
        ),
    );
    let winner: Awaited<ReturnType<typeof eosb.trueUp>> | undefined;
    try {
      winner = await withTenant(TENANT_RACEP, () =>
        eosb.trueUp({
          employeeId: world.tuEmployeeId,
          kind: "OPENING",
          onDate: "2026-06-01",
          actorId: P_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.journalEntryId).not.toBeNull(); // the one G-54 journal
    expect(arm.observation.value!.shape).toBe("blocked");

    // NO ILLEGAL STATE: the loser's re-computation found the winner's
    // COMMITTED standing — delta exactly 0.0000, NO journal (never a
    // double true-up); exactly ONE eosb_calculation-sourced journal.
    const loser = arm.loser.value as { delta: string; journalEntryId: string | null };
    expect(loser.delta).toBe("0.0000");
    expect(loser.journalEntryId).toBeNull();
    const journals = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND source_type = 'eosb_calculation'`,
      [TENANT_RACEP],
    );
    expect(journals[0]!.n).toBe(1);
  });

  it("(4) EOSB true-up × G-31 settle: the settle blocks on the same employee gate, lands AFTER the alignment — one G-54 + one G-31, the provision never double-counts", async () => {
    // The terminated employee's provision run posts first (the 029
    // balance the settle extinguishes), then the termination.
    await postRun("FY2026-04");
    await withTenant(TENANT_RACEP, () =>
      employees.terminate(world.termEmployeeId, { terminationDate: "2026-06-30", actorId: P_ACTOR }),
    );

    const real = statutoryStore.insertEosbCalculation;
    const spy = vi.spyOn(statutoryStore, "insertEosbCalculation");
    const arm = armDuelSpy(
      spy,
      real,
      { advisoryKey: `${TENANT_RACEP}|${payrollAtomicKeys.eosbEmployee(world.termEmployeeId)}` },
      () =>
        withTenant(TENANT_RACEP, () =>
          eosService.settle(world.termEmployeeId, {
            settledAmount: "900.0000",
            cashAccountId: world.bankCashAccountId,
            entryDate: "2026-07-01",
            actorId: P_ACTOR,
          }),
        ),
    );
    let winner: Awaited<ReturnType<typeof eosb.trueUp>> | undefined;
    try {
      winner = await withTenant(TENANT_RACEP, () =>
        eosb.trueUp({
          employeeId: world.termEmployeeId,
          kind: "TERMINATION",
          onDate: "2026-06-30",
          actorId: P_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.journalEntryId).not.toBeNull();
    expect(arm.observation.value!.shape).toBe("blocked");
    // The settle landed AFTER the alignment — green, on the re-read
    // balance (the 029 run-line fold).
    expect(loserCode(arm)).toBe("(fulfilled)");

    // NO ILLEGAL STATE: one TERMINATION G-54 + one G-31 settlement; the
    // employee's terminal stamps present; further true-ups refuse typed
    // (the settled guard).
    const journals = await q<{ source_type: string; n: number }>(
      `SELECT source_type, count(*)::int AS n FROM journal_entries
        WHERE tenant_id = $1 AND source_type IN ('eosb_calculation', 'employee')
        GROUP BY source_type`,
      [TENANT_RACEP],
    );
    const bySource = new Map(journals.map((row) => [row.source_type, row.n]));
    expect(bySource.get("eosb_calculation")).toBe(2); // duel (3)'s + this TERMINATION
    expect(bySource.get("employee")).toBe(1); // the G-31 settlement
    const employee = await q<{ eos_settled_amount: string; status: string }>(
      `SELECT eos_settled_amount::text, status FROM employees WHERE tenant_id = $1 AND id = $2`,
      [TENANT_RACEP, world.termEmployeeId],
    );
    expect(employee[0]!.eos_settled_amount).toBe("900.0000");
    expect(employee[0]!.status).toBe("TERMINATED");
    await expect(
      withTenant(TENANT_RACEP, () =>
        eosb.trueUp({
          employeeId: world.termEmployeeId,
          kind: "PERIOD_TRUE_UP",
          onDate: "2026-07-02",
          actorId: P_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "EOSB_TRUE_UP_INVALID" });
  });
});

describe("PHASE-046 (W-6, T-17) · the payroll writer races — the verification CAS", () => {
  it("(5) verify × verify — one flip: the loser blocks on the winner's row transaction, matches ZERO rows, refuses typed STATUTORY_ALREADY_VERIFIED; exactly one audit event", async () => {
    // The target: a materialized REQUIRES_VERIFICATION placeholder (the
    // AE set — the blocked-state surface).
    const targets = await q<{ id: string }>(
      `SELECT id FROM statutory_contribution_profiles
        WHERE tenant_id = $1 AND status = 'REQUIRES_VERIFICATION' LIMIT 1`,
      [TENANT_RACEP],
    );
    expect(targets).toHaveLength(1);
    const profileId = targets[0]!.id;

    const real = statutoryStore.verifyProfileCas;
    const spy = vi.spyOn(statutoryStore, "verifyProfileCas");
    const arm = armDuelSpy(
      spy,
      real,
      { winnerTx: true }, // the row lock the CAS itself takes
      () =>
        withTenant(TENANT_RACEP, () =>
          statutory.verify({
            profileId,
            actorId: P_APPROVER, // a DIFFERENT verifier — the loser's
            // refusal must be the CAS, never the SoD guard
            sourceName: "The duel's loser citation (T-17)",
          }),
        ),
    );
    let winner: Awaited<ReturnType<typeof statutory.verify>> | undefined;
    try {
      winner = await withTenant(TENANT_RACEP, () =>
        statutory.verify({
          profileId,
          actorId: P_ACTOR,
          sourceName: "The duel's winner citation (T-17)",
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.status).toBe("VERIFIED");
    expect(arm.observation.value!.shape).toBe("blocked");
    expect(loserCode(arm)).toBe("STATUTORY_ALREADY_VERIFIED");

    // NO ILLEGAL STATE: exactly ONE flip (the row is VERIFIED, verified
    // once) + exactly ONE audit event for this profile.
    const row = await q<{ status: string; verified_by: string }>(
      `SELECT status, verified_by FROM statutory_contribution_profiles WHERE tenant_id = $1 AND id = $2`,
      [TENANT_RACEP, profileId],
    );
    expect(row[0]!.status).toBe("VERIFIED");
    expect(row[0]!.verified_by).toBe(P_ACTOR);
    const events = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'payroll.statutory_verified' AND entity_id = $2`,
      [TENANT_RACEP, profileId],
    );
    expect(events[0]!.n).toBe(1);
  });
});

describe("PHASE-046 (W-6, T-17) · the payroll writer races — the run gate's money writers", () => {
  it("(6) remittance × remittance — INV-013: the loser blocks on the run gate, re-reads the emptied outstanding, refuses typed; ONE journal, ONE movement, the liability tracks once", async () => {
    const runId = await postRun("FY2026-05");

    const real = payrollStore.updateRun;
    const spy = vi.spyOn(payrollStore, "updateRun");
    const arm = armDuelSpy(
      spy,
      real,
      { advisoryKey: `${TENANT_RACEP}|${payrollAtomicKeys.run(runId)}` },
      () =>
        withTenant(TENANT_RACEP, () =>
          payouts.remit(runId, {
            cashAccountId: world.bankCashAccountId,
            entryDate: "2026-06-05",
            actorId: P_ACTOR,
          }),
        ),
    );
    let winner: Awaited<ReturnType<typeof payouts.remit>> | undefined;
    try {
      winner = await withTenant(TENANT_RACEP, () =>
        payouts.remit(runId, {
          cashAccountId: world.bankCashAccountId,
          entryDate: "2026-06-05",
          actorId: P_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.amount).not.toBe("0.0000"); // the full liability settled
    expect(arm.observation.value!.shape).toBe("blocked");
    expect(loserCode(arm)).toBe("PAYROLL_REMITTANCE_EXCEEDS_LIABILITY");

    // NO ILLEGAL STATE: exactly ONE remittance journal for this run, ONE
    // movement, and the summary's liability fully tracked (accrued ==
    // remitted on every row).
    const journals = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries
        WHERE tenant_id = $1 AND source_type = 'payroll_remittance'
          AND source_id IN (SELECT id FROM payroll_runs WHERE tenant_id = $1 AND id = $2)`,
      [TENANT_RACEP, runId],
    );
    // (the source_id column holds the remittanceId; the run linkage rides
    // the description — the census below is the movement's, the exact one)
    void journals;
    const movements = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM cash_movements
        WHERE tenant_id = $1 AND memo LIKE 'Statutory remittance%'`,
      [TENANT_RACEP],
    );
    expect(movements[0]!.n).toBe(1);
    const run = await q<{ statutory_summary: { accrued: string; remitted: string }[] }>(
      `SELECT statutory_summary FROM payroll_runs WHERE tenant_id = $1 AND id = $2`,
      [TENANT_RACEP, runId],
    );
    const summary = run[0]!.statutory_summary;
    expect(summary.length).toBeGreaterThan(0);
    for (const row of summary) {
      expect(row.remitted).toBe(row.accrued); // tracked once, fully
    }
    const entries = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND source_type = 'payroll_remittance'`,
      [TENANT_RACEP],
    );
    expect(entries[0]!.n).toBe(1);
  });

  it("(7) THE SMOKE — three in-flight writers on one run (remit + payout + a run-referencing true-up): NO 40P01 anywhere, every arm settles, the final state exact", async () => {
    const runId = await postRun("FY2026-06");
    const netBefore = (
      await q<{ net: string; paid: string }>(
        `SELECT net_total::text AS net, paid_net_total::text AS paid FROM payroll_runs WHERE tenant_id = $1 AND id = $2`,
        [TENANT_RACEP, runId],
      )
    )[0]!;

    // Three REAL service calls in flight together — no spy, no split:
    // the deadlock-freedom smoke (the forest argument: the money writers
    // serialize on the run's advisory gate; the true-up's F3 increment
    // waits on the run ROW lock only — no cycle anywhere).
    const outcomes = await Promise.allSettled([
      withTenant(TENANT_RACEP, () =>
        payouts.remit(runId, {
          cashAccountId: world.bankCashAccountId,
          entryDate: "2026-07-01",
          actorId: P_ACTOR,
        }),
      ),
      withTenant(TENANT_RACEP, () =>
        payouts.payout(runId, {
          cashAccountId: world.bankCashAccountId,
          amount: "10000.0000",
          entryDate: "2026-07-01",
          actorId: P_ACTOR,
        }),
      ),
      withTenant(TENANT_RACEP, () =>
        eosb.trueUp({
          employeeId: world.cEmployeeId,
          kind: "OPENING",
          onDate: "2026-06-01",
          actorId: P_ACTOR,
          runId,
        }),
      ),
    ]);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("fulfilled"); // no 40P01, no deadlock, no typed refusal
    }
    const remit = (outcomes[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof payouts.remit>>>).value;
    const payout = (outcomes[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof payouts.payout>>>).value;
    const trueUp = (outcomes[2] as PromiseFulfilledResult<Awaited<ReturnType<typeof eosb.trueUp>>>).value;

    // NO ILLEGAL STATE: the paid advanced exactly once (net's prior paid
    // + 10,000), the statutory liability fully remitted, the run's
    // eosb_trueup_total == the true-up's delta (the F3 advance).
    const after = (
      await q<{ net: string; paid: string; trueup: string; summary: { accrued: string; remitted: string }[] }>(
        `SELECT net_total::text AS net, paid_net_total::text AS paid,
                eosb_trueup_total::text AS trueup, statutory_summary AS summary
           FROM payroll_runs WHERE tenant_id = $1 AND id = $2`,
        [TENANT_RACEP, runId],
      )
    )[0]!;
    expect(after.paid).toBe(addLocal(netBefore.paid, "10000.0000"));
    expect(after.paid).toBe(payout.run.paidNetTotal);
    for (const row of after.summary) {
      expect(row.remitted).toBe(row.accrued);
    }
    expect(after.trueup).toBe(trueUp.delta);
    expect(remit.amount).not.toBe("0.0000");
  });

  it("(8) F2 — payout × payout on one run with a partial outstanding: the loser blocks on the run gate, re-reads the winner's advance, refuses typed; paid_net_total advanced EXACTLY ONCE", async () => {
    const runId = await postRun("FY2026-07");
    const net = (
      await q<{ net: string }>(
        `SELECT net_total::text AS net FROM payroll_runs WHERE tenant_id = $1 AND id = $2`,
        [TENANT_RACEP, runId],
      )
    )[0]!.net;

    // A committed PARTIAL payout first: the outstanding remainder is the
    // duel's canvas (the pre-F2 lost update: both arms read the same
    // outstanding, both post journals, the second advance OVERWRITES the
    // first — two cash legs for one outstanding).
    await withTenant(TENANT_RACEP, () =>
      payouts.payout(runId, {
        cashAccountId: world.bankCashAccountId,
        amount: "25000.0000",
        entryDate: "2026-07-02",
        actorId: P_ACTOR,
      }),
    );
    const payoutsBefore = (
      await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND source_type = 'payroll_payout'`,
        [TENANT_RACEP],
      )
    )[0]!.n;

    const real = payrollStore.updateRun;
    const spy = vi.spyOn(payrollStore, "updateRun");
    const arm = armDuelSpy(
      spy,
      real,
      { advisoryKey: `${TENANT_RACEP}|${payrollAtomicKeys.run(runId)}` },
      () =>
        withTenant(TENANT_RACEP, () =>
          payouts.payout(runId, {
            cashAccountId: world.bankCashAccountId,
            entryDate: "2026-07-03",
            actorId: P_ACTOR,
          }),
        ),
    );
    let winner: Awaited<ReturnType<typeof payouts.payout>> | undefined;
    try {
      winner = await withTenant(TENANT_RACEP, () =>
        payouts.payout(runId, {
          cashAccountId: world.bankCashAccountId,
          entryDate: "2026-07-03",
          actorId: P_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    // The winner paid the full outstanding remainder.
    expect(winner!.run.paidNetTotal).toBe(net);
    expect(arm.observation.value!.shape).toBe("blocked");
    expect(loserCode(arm)).toBe("PAYROLL_PAYOUT_EXCEEDS_RUN");

    // NO ILLEGAL STATE: paid == net EXACTLY (advanced once — the loser's
    // lost update never landed); exactly ONE payout journal from the
    // duel (the partial's + one).
    const after = (
      await q<{ paid: string }>(
        `SELECT paid_net_total::text AS paid FROM payroll_runs WHERE tenant_id = $1 AND id = $2`,
        [TENANT_RACEP, runId],
      )
    )[0]!;
    expect(after.paid).toBe(net); // never net + the remainder again
    const payoutsAfter = (
      await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND source_type = 'payroll_payout'`,
        [TENANT_RACEP],
      )
    )[0]!.n;
    expect(payoutsAfter).toBe(payoutsBefore + 1); // exactly one from the duel
  });

  it("(9) F3 — true-up × true-up, TWO employees, ONE run reference: the loser's increment blocks on the winner's row transaction and applies on the COMMITTED value — the column == Σ both deltas, no lost update", async () => {
    const runId = await postRun("FY2026-08");

    // The winner: E-D's OPENING true-up referencing the run. The spy
    // splits AFTER the F3 increment ran inside the winner's UoW — the
    // run ROW lock is held uncommitted, so E-E's own increment (a
    // DIFFERENT employee gate — no advisory conflict) waits on the
    // winner's transaction and then applies on the committed value.
    const real = payrollStore.advanceRunEosbTrueup;
    const spy = vi.spyOn(payrollStore, "advanceRunEosbTrueup");
    const arm = armDuelSpy(
      spy,
      real,
      { winnerTx: true }, // the payroll_runs row lock the increment takes
      () =>
        withTenant(TENANT_RACEP, () =>
          eosb.trueUp({
            employeeId: world.eEmployeeId,
            kind: "OPENING",
            onDate: "2026-06-01",
            actorId: P_APPROVER,
            runId,
          }),
        ),
    );
    let winner: Awaited<ReturnType<typeof eosb.trueUp>> | undefined;
    try {
      winner = await withTenant(TENANT_RACEP, () =>
        eosb.trueUp({
          employeeId: world.dEmployeeId,
          kind: "OPENING",
          onDate: "2026-06-01",
          actorId: P_ACTOR,
          runId,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.journalEntryId).not.toBeNull();
    expect(arm.observation.value!.shape).toBe("blocked");
    // The loser fulfilled — its increment applied AFTER the winner's
    // commit (never a lost update, never a deadlock).
    expect(loserCode(arm)).toBe("(fulfilled)");
    const loser = arm.loser.value as { delta: string; journalEntryId: string | null };
    expect(loser.journalEntryId).not.toBeNull();

    // NO ILLEGAL STATE: the run's eosb_trueup_total == the EXACT Σ of
    // both deltas (the pre-F3 read-modify-write lost one of them).
    const after = (
      await q<{ trueup: string }>(
        `SELECT eosb_trueup_total::text AS trueup FROM payroll_runs WHERE tenant_id = $1 AND id = $2`,
        [TENANT_RACEP, runId],
      )
    )[0]!;
    expect(after.trueup).toBe(addLocal(winner!.delta, loser.delta));
  });
});

function addLocal(a: string, b: string): string {
  const negA = a.startsWith("-");
  const negB = b.startsWith("-");
  const [aInt, aFrac = ""] = (negA ? a.slice(1) : a).split(".");
  const [bInt, bFrac = ""] = (negB ? b.slice(1) : b).split(".");
  const A = BigInt(aInt + aFrac.padEnd(4, "0")) * (negA ? -1n : 1n);
  const B = BigInt(bInt + bFrac.padEnd(4, "0")) * (negB ? -1n : 1n);
  const S = A + B;
  const neg = S < 0n;
  const digits = (neg ? -S : S).toString().padStart(5, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
