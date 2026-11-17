import { beforeAll, describe, expect, it } from "vitest";

import {
  P_ACTOR,
  P_APPROVER,
  calculation,
  employees,
  eos,
  pPosting,
  periods,
  setupPayrollFixture,
  su,
  withTenant,
  workflow,
  runPosting,
} from "./fixtures";
import { EosbService } from "../../modules/payroll/application/eosb-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { materializeCanonicalStatutorySet } from "../../modules/payroll/infrastructure/statutory-canonical";
import { StructureService } from "../../modules/payroll/application/structure-service";
import {
  EosbNoRuleError,
  EosbTrueUpInvalidError,
} from "../../modules/payroll/domain/statutory-errors";

/**
 * PHASE-046 (W-2, T-06) — the EOSB engine's DB laws (§4): the KSA tier
 * fold (7 years, eosBase 9,000 → 75 + 60 = 135 days → 40,500.0000), the
 * OPENING true-up on adoption, the PERIOD true-up (+delta as the
 * entitlement grows; standing includes the prior true-ups), the RELEASE
 * case (the negative mirror), the zero-delta no-journal law, the
 * contract-type override, BR-087's guards + INV-032(c), the termination
 * sequence (true-up aligns → G-31 settles — the 029 machinery green
 * after), and the reconciliation view's standing tie.
 *
 * Isolation — THE DEDICATED TENANT (the T-20 race suite's own precedent:
 * the LP provisioning shape, real postings, never the shared tenants'
 * books): tenant EOSB carries its own CoA + FY2026 + settings + structure
 * + statutory set, so this spec's employees, runs, and G-54/G-31 journals
 * never touch the PAY world's registers (whose censuses the 029 spec
 * pins). The G-51 cross-check (TERMINATED never encashes) stays pinned by
 * hr/leave-posting.spec (the existing spec stays the pin).
 */

const TENANT_EOSB = "8e8e8e8e-8e8e-8e8e-8e8e-8e8e8e8e8e8e";

const audit = new AuditService(new DrizzleAuditStore());
const eosb = new EosbService(audit, pPosting, eos);
const structures = new StructureService(audit);

interface EosbWorld {
  structureId: string;
  periodIds: Record<string, string>;
  bankCashAccountId: string;
  purposeAccounts: Record<"EOS_PROVISION" | "EOS_PROVISION_EXPENSE", string>;
}

let world: EosbWorld;

/** The spec's dates (all inside FY2026's OPEN periods — payroll-rules
 *  locks period 12 of ITS OWN tenant; this tenant's stay OPEN). */
const HIRE_JULY = "2019-07-01"; // → 7.00 service years at 2026-07-01
const AT_7Y_JUL = "2026-07-01";
const AT_6_5Y_JAN = "2026-01-01"; // → 6.51 years from HIRE_JULY (the exact fold pinned below)
const AT_8Y_NOV = "2026-11-30"; // → 8.00 years from 2018-11-30

interface SpecEmployee {
  id: string;
  code: string;
}

const created: SpecEmployee[] = [];

async function createSuspendedEmployee(code: string, input: {
  basicSalary?: string;
  hireDate?: string;
  contractType?: "FULL_TIME" | "PART_TIME" | "CONTRACTOR";
} = {}): Promise<string> {
  const employee = await employees.create({
    code,
    name: `EOSB ${code}`,
    nameAr: null,
    hireDate: input.hireDate ?? HIRE_JULY,
    contractType: input.contractType ?? "FULL_TIME",
    basicSalary: input.basicSalary ?? "9000.0000",
    salaryStructureId: world.structureId, // the spec's basic-only structure ⇒ eosBase = basic
    actorId: P_ACTOR,
  });
  await employees.suspend(employee.id, P_ACTOR); // the E2 pattern — invisible to runs
  created.push({ id: employee.id, code });
  return employee.id;
}

/** The G-54 journal's lines — read through the AMBIENT tenant tx (the
 *  payroll-rules idiom: an independent connection cannot see the still-
 *  open caller's UoW). */
async function journalLinesOf(entryId: string): Promise<{ accountId: string; direction: string; amount: string }[]> {
  const { listLines } = await import("../../modules/accounting/infrastructure/journal.store");
  const lines = await listLines(entryId);
  return lines.map((line) => ({ accountId: line.accountId, direction: line.direction, amount: line.amount }));
}

beforeAll(async () => {
  // The dedicated EOSB tenant (idempotent — its own books, never the
  // shared PAY world's registers whose censuses the 029 spec pins).
  await setupPayrollFixture(); // the DB harness + the shared services (the fixture boot)
  const client = await su();
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant EOSB (046 engine)', 'المستأجر لتسوية نهاية الخدمة', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_EOSB],
  );
  await client.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
       (gen_random_uuid(), $1, 'payroll.eos.enabled', 'true'::jsonb),
       (gen_random_uuid(), $1, 'payroll.eos.accrual_days_per_service_year', '3'::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_EOSB],
  );
  await client.end();

  world = await withTenant(TENANT_EOSB, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    const byPurpose = async (key: string): Promise<string> => {
      const mapping = await accounting.findActivePurpose(key);
      if (mapping === undefined) throw new Error(`purpose ${key} unmapped`);
      return mapping.accountId;
    };
    const structure =
      (await structures.list(50)).find((row) => row.code === "ST-EOSB") ??
      (await structures.create({
        code: "ST-EOSB",
        name: "EOSB spec structure (basic-only)",
        nameAr: null,
        actorId: P_ACTOR,
      }));
    const year = await periods.createYear(P_ACTOR, {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const periodIds: Record<string, string> = {};
    for (const period of await accounting.listPeriods(year.id)) {
      if (period.kind === "REGULAR") {
        periodIds[period.name] = period.id;
      }
    }
    const bank = await treasury.insertCashAccount({
      name: "EOSB Bank",
      nameAr: "بنك التسوية",
      type: "BANK",
      accountId: await byPurpose("SALARIES_PAYABLE"),
      branchId: null,
      currencyCode: "SAR",
      createdBy: P_ACTOR,
    });
    await materializeCanonicalStatutorySet();
    return {
      structureId: structure.id,
      periodIds,
      bankCashAccountId: bank.id,
      purposeAccounts: {
        EOS_PROVISION: await byPurpose("EOS_PROVISION"),
        EOS_PROVISION_EXPENSE: await byPurpose("EOS_PROVISION_EXPENSE"),
      },
    };
  });

  // The CONTRACTOR override tier (0–∞ × 20 days/year) — contract-specific
  // rows REPLACE the default tier set for that contract type.
  const suClient = await su();
  await suClient.query(
    `INSERT INTO eosb_rules
       (id, tenant_id, jurisdiction_code, from_years, to_years, days_per_year, contract_type,
        effective_from, status, source_name, source_ref, verified_at, review_note)
     VALUES (gen_random_uuid(), $1, 'SA', 0.00, NULL, 20.00, 'CONTRACTOR',
             DATE '2020-01-01', 'VERIFIED', 'The spec''s CONTRACTOR override (PHASE-046 §4)',
             'the contract-type override shape', now(), 'spec-owned row')`,
    [TENANT_EOSB],
  );
  await suClient.end();
});

describe("PHASE-046 T-06 — the EOSB engine", () => {
  it("(a) THE KSA TIER FOLD — 7 years × eosBase 9,000 → 135 days → 40,500.0000 (the frozen snapshot)", async () => {
    await withTenant(TENANT_EOSB, async () => {
      const employeeId = await createSuspendedEmployee("EOSB-A");
      const entitlement = await eosb.computeEntitlement({ employeeId, onDate: AT_7Y_JUL });
      expect(entitlement.serviceYears).toBe("7.00");
      expect(entitlement.wageBase.eosBase).toBe("9000.0000"); // ST-1's housing is NOT eos-base
      expect(entitlement.fold.days).toBe("135.0000");
      expect(entitlement.fold.breakdown).toHaveLength(2);
      expect(entitlement.fold.breakdown[0]).toMatchObject({ days: "75.0000" });
      expect(entitlement.fold.breakdown[1]).toMatchObject({ days: "60.0000" });
      expect(entitlement.entitlement).toBe("40500.0000");
      expect(entitlement.provisionBalance).toBe("0.0000"); // no runs, no true-ups
      expect(entitlement.delta).toBe("40500.0000");
    });
  });

  it("(b) THE OPENING TRUE-UP — first adoption posts the full entitlement (G-54: DR EOS_PROVISION_EXPENSE · CR EOS_PROVISION)", async () => {
    await withTenant(TENANT_EOSB, async () => {
      const employeeId = created.find((row) => row.code === "EOSB-A")!.id;
      const result = await eosb.trueUp({
        employeeId,
        kind: "OPENING",
        onDate: AT_7Y_JUL,
        actorId: P_ACTOR,
        note: "adoption",
      });
      expect(result.delta).toBe("40500.0000");
      expect(result.journalEntryId).toBeTruthy();
      expect(result.calculation.status).toBe("POSTED");
      expect(result.calculation.journalEntryId).toBe(result.journalEntryId);
      const lines = await journalLinesOf(result.journalEntryId!);
      expect(lines).toHaveLength(2);
      const expenseAccount = world.purposeAccounts.EOS_PROVISION_EXPENSE;
      const provisionAccount = world.purposeAccounts.EOS_PROVISION;
      expect(lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: expenseAccount, direction: "DEBIT", amount: "40500.0000" }),
          expect.objectContaining({ accountId: provisionAccount, direction: "CREDIT", amount: "40500.0000" }),
        ]),
      );

      // A second OPENING is the typed refusal (first adoption only).
      await expect(
        eosb.trueUp({ employeeId, kind: "OPENING", onDate: AT_7Y_JUL, actorId: P_ACTOR }),
      ).rejects.toBeInstanceOf(EosbTrueUpInvalidError);
    });
  });

  it("(c) THE PERIOD TRUE-UP + THE ZERO-DELTA NO-JOURNAL LAW — the standing provision includes the prior true-ups", async () => {
    await withTenant(TENANT_EOSB, async () => {
      // Employee B: adopted at 6.50 years (2026-01-01 → 36,000), re-trued at
      // 7.00 years (2026-07-01 → 40,500) → +4,500.
      const employeeId = await createSuspendedEmployee("EOSB-B");
      const opening = await eosb.trueUp({ employeeId, kind: "OPENING", onDate: AT_6_5Y_JAN, actorId: P_ACTOR });
      expect(opening.delta).toBe("36090.0000"); // 6.51 years: 5×15/30×9,000 + 1.51×30/30×9,000 = 22,500 + 13,590

      const period = await eosb.trueUp({ employeeId, kind: "PERIOD_TRUE_UP", onDate: AT_7Y_JUL, actorId: P_ACTOR });
      expect(period.delta).toBe("4410.0000"); // the entitlement grew to 40,500; the standing (36,090) included the opening
      expect(period.journalEntryId).toBeTruthy();

      // The ZERO-DELTA law: nothing changed → NO journal, the evidence row still records.
      const again = await eosb.trueUp({ employeeId, kind: "PERIOD_TRUE_UP", onDate: AT_7Y_JUL, actorId: P_ACTOR });
      expect(again.delta).toBe("0.0000");
      expect(again.journalEntryId).toBeNull();
      expect(again.calculation.status).toBe("COMPUTED"); // never stamped POSTED — no journal
    });
  });

  it("(d) THE RELEASE CASE — a shrunken wage base releases the excess (the negative mirror: DR EOS_PROVISION · CR EOS_PROVISION_EXPENSE)", async () => {
    await withTenant(TENANT_EOSB, async () => {
      const employeeId = await createSuspendedEmployee("EOSB-C");
      const opening = await eosb.trueUp({ employeeId, kind: "OPENING", onDate: AT_7Y_JUL, actorId: P_ACTOR });
      expect(opening.delta).toBe("40500.0000");

      // The wage base shrinks (basic 9,000 → 6,000): the entitlement at 7
      // years becomes 5×15/30×6,000 + 2×30/30×6,000 = 15,000 + 12,000 = 27,000.
      await employees.update(employeeId, { basicSalary: "6000.0000" }, P_ACTOR);
      const release = await eosb.trueUp({ employeeId, kind: "PERIOD_TRUE_UP", onDate: AT_7Y_JUL, actorId: P_ACTOR });
      expect(release.delta).toBe("-13500.0000"); // 27,000 − 40,500
      expect(release.journalEntryId).toBeTruthy();
      const lines = await journalLinesOf(release.journalEntryId!);
      expect(lines).toHaveLength(2);
      expect(lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: world.purposeAccounts.EOS_PROVISION, direction: "DEBIT", amount: "13500.0000" }),
          expect.objectContaining({ accountId: world.purposeAccounts.EOS_PROVISION_EXPENSE, direction: "CREDIT", amount: "13500.0000" }),
        ]),
      );
    });
  });

  it("(e) THE CONTRACT-TYPE OVERRIDE — CONTRACTOR rows replace the default tier set (never a mixed fold)", async () => {
    await withTenant(TENANT_EOSB, async () => {
      const employeeId = await createSuspendedEmployee("EOSB-D", { contractType: "CONTRACTOR" });
      const entitlement = await eosb.computeEntitlement({ employeeId, onDate: AT_7Y_JUL });
      // 20 days/year × 7 years = 140 days → 140/30 × 9,000 = 42,000 — the
      // KSA tiers (15/30) NEVER enter the fold.
      expect(entitlement.fold.days).toBe("140.0000");
      expect(entitlement.fold.breakdown).toHaveLength(1);
      expect(entitlement.entitlement).toBe("42000.0000");
    });
  });

  it("(f) BR-087's GUARDS — the wrong shapes refuse typed with zero residue", async () => {
    await withTenant(TENANT_EOSB, async () => {
      const activeId = await createSuspendedEmployee("EOSB-E");
      // TERMINATION true-up on a non-terminated employee.
      await expect(
        eosb.trueUp({ employeeId: activeId, kind: "TERMINATION", onDate: AT_7Y_JUL, actorId: P_ACTOR }),
      ).rejects.toMatchObject({ code: "EOSB_TRUE_UP_INVALID" });
      // Zero residue: no calculation rows, no journals.
      const client = await su();
      const rows = await client.query(
        `SELECT count(*)::int AS n FROM eosb_calculations WHERE tenant_id = $1 AND employee_id = $2`,
        [TENANT_EOSB, activeId],
      );
      await client.end();
      expect(rows.rows[0]!.n).toBe(0);
    });
  });

  it("(g) THE TERMINATION SEQUENCE — a posted run builds the 029 provision; the true-up aligns; G-31 settles; the 029 machinery green after", async () => {
    // PHASE-046 (W-3, D-09): the run writer (the run gate) and the
    // true-up/settlement (the eosb employee gate) are DIFFERENT floor
    // keys — the no-expansion law refuses the pre-W-3 fixture batching
    // (a run-key holder cannot then take the employee key). The
    // PRODUCTION shape is one writer per UoW (the T-20 self-service.spec
    // precedent); the assertions are unchanged.
    const employeeId = await withTenant(TENANT_EOSB, async () => {
      const created = await createSuspendedEmployee("EOSB-F", { hireDate: "2018-11-30" });
      // Activate inside this spec's own run window (FY2026-10 — unused by
      // the other payroll specs), build the 029 provision, then terminate.
      await employees.reactivate(created, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-10"]!,
        actorId: P_ACTOR,
      });
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      const own = calculated.lines.find((line) => line.employee.id === created);
      expect(own).toBeTruthy();
      expect(own!.eosAccrual).toBe("900.0000"); // 9,000 × 3/30 — the 029 policy
      await workflow.submit(run.id, P_ACTOR);
      await workflow.approve(run.id, P_APPROVER);
      const posted = await runPosting.post(run.id, P_ACTOR);
      expect(posted.status).toBe("POSTED");

      // Terminate effective 2026-11-30 (⇒ 8.00 service years; period 11 — OPEN).
      await employees.terminate(created, { terminationDate: AT_8Y_NOV, reason: "retirement", actorId: P_ACTOR });
      return created;
    });

    // The TERMINATION true-up: standing 900 (the run) → entitlement 49,500
    // (5×15 + 3×30 = 165 days × 9,000/30) → +48,600.
    await withTenant(TENANT_EOSB, async () => {
      const trueUp = await eosb.trueUp({
        employeeId,
        kind: "TERMINATION",
        onDate: AT_8Y_NOV,
        actorId: P_ACTOR,
      });
      expect(trueUp.delta).toBe("48600.0000");
      expect(trueUp.journalEntryId).toBeTruthy();
    });

    await withTenant(TENANT_EOSB, async () => {
      // G-31 settles the 029-visible balance — the shipped machinery,
      // green after (re-entrant on the same employee key).
      const settle = await eos.settle(employeeId, {
        settledAmount: "900.0000",
        cashAccountId: world.bankCashAccountId,
        actorId: P_ACTOR,
      });
      expect(settle.settled).toBe("900.0000");

      // After the settlement, no further true-ups (BR-087 — the G-31 is terminal).
      await expect(
        eosb.trueUp({ employeeId, kind: "TERMINATION", onDate: AT_8Y_NOV, actorId: P_ACTOR }),
      ).rejects.toMatchObject({ code: "EOSB_TRUE_UP_INVALID" });
    });
  });

  it("(h) THE RECONCILIATION VIEW — computed entitlement ↔ standing provision ↔ settled at every row (aligned = zero)", async () => {
    await withTenant(TENANT_EOSB, async () => {
      const employeeB = created.find((row) => row.code === "EOSB-B")!;
      const rows = await eosb.reconciliation({ employeeId: employeeB.id });
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.entitlement).toBe("40500.0000");
      expect(row.provisionBalance).toBe("40500.0000"); // the standing: the 029 balance (0 — no runs) + the accumulated true-ups (36,090 + 4,410)
      expect(row.alignedDelta).toBe("0.0000"); // aligned — the tie holds
      expect(row.lastCalculation!.entitlementAmount).toBe("40500.0000");
      expect(row.settled).toBeNull();
    });
  });

  it("(i) THE NO-RULE JURISDICTION — fail-closed, never a guessed tier", async () => {
    await withTenant(TENANT_EOSB, async () => {
      const employeeId = await createSuspendedEmployee("EOSB-G");
      await expect(
        eosb.computeEntitlement({ employeeId, onDate: AT_7Y_JUL, jurisdictionCode: "ZZ" }),
      ).rejects.toBeInstanceOf(EosbNoRuleError);
    });
  });
});
