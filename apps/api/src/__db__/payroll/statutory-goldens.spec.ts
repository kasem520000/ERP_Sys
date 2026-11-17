import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

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
  withTenant,
  workflow,
  eos,
  pPosting,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { EosbService } from "../../modules/payroll/application/eosb-service";
import { StructureService } from "../../modules/payroll/application/structure-service";
import { materializeCanonicalStatutorySet } from "../../modules/payroll/infrastructure/statutory-canonical";
import type { StatutoryBreakdownEntry } from "../../modules/payroll/domain/statutory-math";

/**
 * PHASE-046 (W-6, T-14) — THE GOLDEN SUITES G-52/G-53/G-54 WITH FAILURE
 * PACKS (the 029 golden-pack convention: each wrong shape RED, zero
 * residue — the unmap-and-restore idiom), the consolidated worked
 * examples, and the table-level law discoveries this wave surfaced.
 *
 * The standing pins this suite CONSOLIDATES (not duplicates — each
 * cross-referenced): the effective-dated resolution + the dual-cap clamp
 * + the verify CAS (statutory.spec 7/7), the PIT fold + the honest
 * no-bracket state (pit.spec 6/6), the KSA worked example end-to-end +
 * BR-085's seeded-row arm (run-statutory.spec 7/7), the tier fold + the
 * guards + the termination sequence (eosb.spec 9/9), the feed boundary +
 * the negative ledger proof (variable-lines.spec 5/5).
 *
 * THIS suite's own pins, on the dedicated GOLD tenant (the RUNSTAT
 * precedent — never the PAY world's registers):
 *
 * - (a) G-52 + G-53 GOLDEN, consolidated: one posted run carrying BOTH
 *   the Saudi worked example (1,170/1,410) and the non-Saudi OH arm
 *   (0/240) — the balanced journal 25,650 = 25,650 with G-52's
 *   employee/PIT legs and G-53's pair pinned SEPARATELY inside the same
 *   fold; INV-032(a) per breakdown row (rate × clamped base == the
 *   share, exact 4dp — recomputed in-test with BigInt); INV-032(b) the
 *   totals tie (Σ lines == run totals); the remittance settlement leg
 *   (the full 2,820 through the payout machinery + the summary's
 *   accrued → remitted) and INV-013's double-settle refusal.
 * - (b) FAILURE PACK — THE WRONG-CAP SHAPE: a base FAR above every cap
 *   (50,000 — 48,000 basic + 2,000 housing; title/comment corrected from
 *   the wrong "60,000" 2026-11-17, the W-7 F1 literal-truth sweep) must
 *   clamp per row (pension/SANED/OH at their OWN caps —
 *   the dual-cap law): the wrong outcome (an above-cap line) is
 *   unrepresentable; every line == rate × the CAPPED base, clampedBy
 *   MAX on all three rows, capped counts surface.
 * - (c) FAILURE PACK — THE REQUIRES_VERIFICATION SHAPE (the
 *   flip-and-restore idiom): the seeded GOSI-PENSION row flipped to
 *   REQUIRES_VERIFICATION refuses the WHOLE calculation typed (BR-085)
 *   with zero residue and the surviving audit event; restored, the run
 *   recalculates green.
 * - (d) FAILURE PACK — THE BRACKET-GAP SHAPE: a gapped VERIFIED SA set
 *   (0–10k, then 12k–30k — a 2k gap that never tiles) refuses the whole
 *   calculation typed (SET-CONSISTENT — never a partial fold), zero
 *   residue; withdrawn, SA returns to the honest no-bracket state and
 *   the run recalculates green (zero PIT).
 * - (e) G-54 GOLDEN + FAILURE PACK — THE NON-DELTA TRUE-UP SHAPE: the
 *   OPENING true-up (the full 40,500 entitlement — the 7-year tier
 *   fold), then a re-true-up with NOTHING changed: delta exactly
 *   0.0000, NO journal (the evidence row still records — never a double
 *   full-entitlement post), the GL unchanged. THE TABLE-LEVEL LAW
 *   (discovered in this wave): ck_eosb_calculations_delta enforces
 *   delta = entitlement − provision IN SQL — a non-delta row cannot
 *   even be INSERTed. Then the wage-base shrink: the RELEASE mirror
 *   (−13,500 — DR EOS_PROVISION · CR EOS_PROVISION_EXPENSE).
 */

const TENANT_GOLD = "9d9d9d9d-9d9d-9d9d-9d9d-9d9d9d9d9d9d";

const audit = new AuditService(new DrizzleAuditStore());
const structures = new StructureService(audit);
const eosb = new EosbService(audit, pPosting, eos);

interface GoldWorld {
  structureId: string;
  periodIds: Record<string, string>;
  bankCashAccountId: string;
  bankGlAccountId: string;
  ksaEmployeeId: string;
  nsEmployeeId: string;
  bigEmployeeId: string;
  eosEmployeeId: string;
}

let world: GoldWorld;

/** The journal's lines — through the AMBIENT tenant tx (the caller's
 *  still-open UoW is invisible to independent connections). */
async function journalLinesOf(entryId: string): Promise<
  { accountId: string; direction: string; amount: string }[]
> {
  const { listLines } = await import("../../modules/accounting/infrastructure/journal.store");
  const lines = await listLines(entryId);
  return lines.map((line) => ({ accountId: line.accountId, direction: line.direction, amount: line.amount }));
}

/** Parse a 4dp decimal string into scaled BigInt units (10^-4). */
function units4(value: string): bigint {
  const neg = value.startsWith("-");
  const bare = neg ? value.slice(1) : value;
  const [int, frac = ""] = bare.split(".");
  const scaled = BigInt(int + frac.padEnd(4, "0"));
  return neg ? -scaled : scaled;
}

/** INV-032(a) recomputed in-test: rate% × clampedBase, half-up 4dp. */
function rateTimesBase(ratePercent: string, base: string): string {
  const product = units4(ratePercent) * units4(base); // scale 8 (percent 4 + base 4)
  const amountUnits = divHalfUp(product, 1_000_000n); // percent → fraction (10^4 × 10^2)
  const neg = amountUnits < 0n;
  const abs = neg ? -amountUnits : amountUnits;
  const digits = abs.toString().padStart(5, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs + denominator / 2n) / denominator;
  return negative ? -quotient : quotient;
}

beforeAll(async () => {
  await setupPayrollFixture(); // the DB harness + the shared services
  const client = await su();
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant GOLD (046 goldens)', 'المستأجر للسجلات الذهبية', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_GOLD],
  );
  await client.end();

  world = await withTenant(TENANT_GOLD, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    await materializeCanonicalStatutorySet();
    const salariesExpenseAccount = (await accounting.findActivePurpose("SALARIES_EXPENSE"))!.accountId;

    const existing = await structures.list(50);
    const structure =
      existing.find((row) => row.code === "ST-GOLD") ??
      (await structures.create({
        code: "ST-GOLD",
        name: "Goldens structure",
        nameAr: "هيكل السجلات الذهبية",
        actorId: P_ACTOR,
      }));
    const payrollStore = await import("../../modules/payroll/infrastructure/payroll.store");
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
      name: "Gold Bank",
      nameAr: "بنك السجلات الذهبية",
      type: "BANK",
      accountId: (await accounting.findAccountByCode("1121"))!.id,
      branchId: null,
      currencyCode: "SAR",
      createdBy: P_ACTOR,
    });

    // The spec's employees — ALL booted SUSPENDED (the E2 pattern): each
    // arm reactivates exactly its own population, so every run's fold is
    // the arm's own golden.
    const list = await employees.list({ limit: 100 });
    const ensure = async (input: Parameters<typeof employees.create>[0]) => {
      const found = list.find((row) => row.code === input.code);
      if (found !== undefined) return found.id;
      const created = await employees.create(input);
      await employees.suspend(created.id, P_ACTOR);
      return created.id;
    };
    return {
      structureId: structure.id,
      periodIds,
      bankCashAccountId: bank.id,
      bankGlAccountId: bank.accountId,
      ksaEmployeeId: await ensure({
        code: "EMP-GOLD-001",
        name: "Saudi Golden Example",
        nameAr: "المثال الذهبي السعودي",
        nationality: "SA",
        hireDate: "2020-01-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }),
      nsEmployeeId: await ensure({
        code: "EMP-GOLD-002",
        name: "Non-Saudi OH Golden",
        nameAr: "الأخطار المهنية الذهبية",
        nationality: "EG",
        hireDate: "2020-01-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }),
      bigEmployeeId: await ensure({
        code: "EMP-GOLD-003",
        name: "Above Every Cap",
        nameAr: "فوق كل السقوف",
        nationality: "SA",
        hireDate: "2020-01-01",
        contractType: "FULL_TIME",
        basicSalary: "48000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }),
      eosEmployeeId: await ensure({
        code: "EMP-GOLD-004",
        name: "Seven Golden Years",
        nameAr: "سبع سنوات ذهبية",
        nationality: "EG",
        hireDate: "2019-06-01",
        contractType: "FULL_TIME",
        basicSalary: "9000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }),
    };
  });
});

describe("PHASE-046 (W-6, T-14) · the G-52/G-53/G-54 golden suites with failure packs", () => {
  it("(a) G-52 + G-53 GOLDEN — the consolidated journal with the legs pinned separately, INV-032(a)/(b), the remittance settlement, and INV-013's double-settle refusal", async () => {
    await withTenant(TENANT_GOLD, async () => {
      await employees.reactivate(world.ksaEmployeeId, P_ACTOR);
      await employees.reactivate(world.nsEmployeeId, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-01"]!,
        actorId: P_ACTOR,
      });
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      expect(calculated.lines).toHaveLength(2);
      await workflow.submit(run.id, P_ACTOR);
      await workflow.approve(run.id, P_APPROVER);
      const posted = await runPosting.post(run.id, P_ACTOR);

      // The totals: employee 1,170 · employer 1,650 · deductions 1,170 ·
      // net 22,830 (gross 24,000 — both employees 12,000).
      expect(posted.statutoryEmployeeTotal).toBe("1170.0000");
      expect(posted.statutoryEmployerTotal).toBe("1650.0000");
      expect(posted.pitTotal).toBe("0.0000"); // KSA: the honest no-bracket state
      expect(posted.netTotal).toBe("22830.0000");

      // THE BALANCED JOURNAL (one fold, zero new purposes — D-06):
      // DR SALARIES_EXPENSE 24,000 · DR EMPLOYER_CONTRIBUTIONS 1,650 ·
      // CR DEDUCTIONS_PAYABLE 2,820 · CR SALARIES_PAYABLE 22,830.
      const lines = await journalLinesOf(posted.journalEntryId!);
      const by = (direction: string, accountId: string) =>
        lines.filter((line) => line.direction === direction && line.accountId === accountId);
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      const salaries = (await accounting.findActivePurpose("SALARIES_EXPENSE"))!.accountId;
      const employer = (await accounting.findActivePurpose("EMPLOYER_CONTRIBUTIONS"))!.accountId;
      const deductions = (await accounting.findActivePurpose("DEDUCTIONS_PAYABLE"))!.accountId;
      const payable = (await accounting.findActivePurpose("SALARIES_PAYABLE"))!.accountId;
      expect(by("DEBIT", salaries)).toHaveLength(1);
      expect(by("DEBIT", salaries)[0]!.amount).toBe("24000.0000");
      expect(by("DEBIT", employer)).toHaveLength(1);
      expect(by("DEBIT", employer)[0]!.amount).toBe("1650.0000"); // G-53's DR leg
      expect(by("CREDIT", deductions)).toHaveLength(1);
      expect(by("CREDIT", deductions)[0]!.amount).toBe("2820.0000");
      expect(by("CREDIT", payable)).toHaveLength(1);
      expect(by("CREDIT", payable)[0]!.amount).toBe("22830.0000");
      // G-52's employee/PIT legs + G-53's liability leg, pinned
      // separately inside the SAME credit: 1,170 (employee share, PIT 0)
      // + 1,650 (the employer bump) = 2,820.
      const fold = await calculation.getRun(run.id);
      const ksaLine = fold.lines.find((line) => line.employeeId === world.ksaEmployeeId)!;
      const nsLine = fold.lines.find((line) => line.employeeId === world.nsEmployeeId)!;
      expect(ksaLine.statutoryEmployeeShare).toBe("1170.0000"); // G-52's withholding
      expect(ksaLine.statutoryEmployerShare).toBe("1410.0000");
      expect(nsLine.statutoryEmployeeShare).toBe("0.0000");
      expect(nsLine.statutoryEmployerShare).toBe("240.0000"); // OH-only

      // INV-032(a) per breakdown row — rate × clamped base == the share,
      // recomputed in-test with exact BigInt arithmetic.
      for (const line of fold.lines) {
        for (const entry of (line.statutoryBreakdown ?? []) as StatutoryBreakdownEntry[]) {
          expect(entry.employeeAmount).toBe(rateTimesBase(entry.employeeRate!, entry.clampedBase!));
          expect(entry.employerAmount).toBe(rateTimesBase(entry.employerRate!, entry.clampedBase!));
        }
      }
      // INV-032(b): Σ lines == the run totals.
      let employeeSum = "0.0000";
      let employerSum = "0.0000";
      for (const line of fold.lines) {
        employeeSum = addExactLocal(employeeSum, line.statutoryEmployeeShare);
        employerSum = addExactLocal(employerSum, line.statutoryEmployerShare);
      }
      expect(employeeSum).toBe(posted.statutoryEmployeeTotal);
      expect(employerSum).toBe(posted.statutoryEmployerTotal);

      // THE REMITTANCE SETTLEMENT (G-52's leg through the payout
      // machinery): the full 2,820 — DR DEDUCTIONS_PAYABLE · CR cash +
      // the movement; the summary's liability accrued → remitted.
      const remitted = await payouts.remit(run.id, {
        cashAccountId: world.bankCashAccountId,
        entryDate: "2026-02-05",
        actorId: P_ACTOR,
      });
      expect(remitted.amount).toBe("2820.0000");
      for (const row of remitted.summary) {
        expect(row.remitted).toBe(row.accrued); // the liability fully cleared
      }
      const remitLines = await journalLinesOf(remitted.journalEntryId);
      expect(remitLines.filter((l) => l.direction === "DEBIT" && l.accountId === deductions)).toHaveLength(1);
      expect(remitLines.filter((l) => l.direction === "DEBIT" && l.accountId === deductions)[0]!.amount).toBe("2820.0000");
      expect(remitLines.filter((l) => l.direction === "CREDIT" && l.accountId === world.bankGlAccountId)).toHaveLength(1);

      // INV-013's double-settle refusal: nothing outstanding remains.
      await expect(
        payouts.remit(run.id, {
          cashAccountId: world.bankCashAccountId,
          entryDate: "2026-02-06",
          actorId: P_ACTOR,
        }),
      ).rejects.toMatchObject({ code: "PAYROLL_REMITTANCE_EXCEEDS_LIABILITY" });

      // The arm's population parks suspended again (the next arm's
      // isolation).
      await employees.suspend(world.ksaEmployeeId, P_ACTOR);
      await employees.suspend(world.nsEmployeeId, P_ACTOR);
    });
  });

  // (title corrected 2026-11-17 — the W-7 F1 literal-truth sweep: it said
  // "a base of 60,000" while the fixture (48,000 basic + 2,000 housing) and
  // every assertion pin the base at 50,000; the header bullet above carried
  // the same wrong number and moved with it — zero behavior change)
  it("(b) FAILURE PACK — THE WRONG-CAP SHAPE: a base of 50,000 clamps at EVERY row's own cap (the dual-cap law); no line above the capped maximum, every line == rate × the CAPPED base", async () => {
    await withTenant(TENANT_GOLD, async () => {
      await employees.reactivate(world.bigEmployeeId, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-02"]!,
        actorId: P_ACTOR,
      });
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      expect(calculated.lines).toHaveLength(1);
      const line = calculated.lines[0]!;
      const breakdown = (line.statutoryBreakdown ?? []) as StatutoryBreakdownEntry[];
      expect(breakdown).toHaveLength(3);

      const byCode = new Map(breakdown.map((entry) => [entry.code, entry]));
      // GOSI-PENSION: base 50,000 → clamped 45,000 → 4,050/4,050 — the
      // WRONG outcome (9% × 50,000 = 4,500) is unrepresentable.
      const pension = byCode.get("GOSI-PENSION")!;
      expect(pension.base).toBe("50000.0000");
      expect(pension.clampedBase).toBe("45000.0000");
      expect(pension.clampedBy).toBe("MAX");
      expect(pension.employeeAmount).toBe("4050.0000");
      expect(pension.employerAmount).toBe("4050.0000");
      // GOSI-SANED: the SAME base clamps at its OWN (lower) cap 15,000
      // → 112.50/112.50 — the dual-cap law a single rate-pair row could
      // never express (D-01).
      const saned = byCode.get("GOSI-SANED")!;
      expect(saned.clampedBase).toBe("15000.0000");
      expect(saned.clampedBy).toBe("MAX");
      expect(saned.employeeAmount).toBe("112.5000");
      expect(saned.employerAmount).toBe("112.5000");
      // GOSI-OH: employer-only at the 45,000 cap → 0/900.
      const oh = byCode.get("GOSI-OH")!;
      expect(oh.clampedBase).toBe("45000.0000");
      expect(oh.clampedBy).toBe("MAX");
      expect(oh.employeeAmount).toBe("0.0000");
      expect(oh.employerAmount).toBe("900.0000");

      // NO LINE ABOVE THE CAPPED MAXIMUM (INV-032(a) at the cap edge —
      // recomputed per row from the entry's own rate + clampedBase).
      for (const entry of breakdown) {
        expect(entry.employeeAmount).toBe(rateTimesBase(entry.employeeRate!, entry.clampedBase!));
        expect(entry.employerAmount).toBe(rateTimesBase(entry.employerRate!, entry.clampedBase!));
      }
      // The folds: employee 4,162.50 · employer 5,062.50 (the run totals
      // tie — INV-032(b)).
      expect(line.statutoryEmployeeShare).toBe("4162.5000");
      expect(line.statutoryEmployerShare).toBe("5062.5000");
      expect(calculated.run.statutoryEmployeeTotal).toBe("4162.5000");
      expect(calculated.run.statutoryEmployerTotal).toBe("5062.5000");
      // The capped counts surface in the summary companion (the report
      // world pins the same law through payroll.statutory-summary).

      await employees.suspend(world.bigEmployeeId, P_ACTOR);
      // The DRAFT run stays (DRAFTs are free — the monthly law binds
      // only non-DRAFT runs); zero residue beyond the empty shell.
      const after = await calculation.getRun(run.id);
      expect(after.lines).toHaveLength(1);
    });
  });

  it("(c) FAILURE PACK — THE REQUIRES_VERIFICATION SHAPE (the flip-and-restore idiom): the seeded GOSI-PENSION row flipped to REQUIRES_VERIFICATION refuses the whole calculation typed, zero residue, the audit event survives; restored, the run recalculates green", async () => {
    const client: Client = await su();
    // Flip: the platform-carried VERIFIED row becomes blocked. The 0089
    // law couples the status to the verification record
    // (ck_statutory_contribution_profiles_verified_shape: VERIFIED ⟺
    // the citation fields present), so the flip clears them — exactly
    // the shape a withdrawn verification would leave. The fail-closed
    // gate must catch it at the RUN level (BR-085).
    const prior = await client.query<{
      id: string;
      source_name: string | null;
      source_ref: string | null;
      verified_by: string | null;
      verified_at: Date | null;
      review_note: string | null;
    }>(
      `SELECT id, source_name, source_ref, verified_by, verified_at, review_note
         FROM statutory_contribution_profiles
        WHERE tenant_id = $1 AND jurisdiction_code = 'SA' AND code = 'GOSI-PENSION'`,
      [TENANT_GOLD],
    );
    expect(prior.rows).toHaveLength(1);
    await client.query(
      `UPDATE statutory_contribution_profiles SET status = 'REQUIRES_VERIFICATION',
              source_name = NULL, source_ref = NULL, verified_by = NULL, verified_at = NULL
        WHERE tenant_id = $1 AND jurisdiction_code = 'SA' AND code = 'GOSI-PENSION'`,
      [TENANT_GOLD],
    );
    let blockedRunId = "";
    await withTenant(TENANT_GOLD, async () => {
      await employees.reactivate(world.ksaEmployeeId, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-03"]!,
        actorId: P_ACTOR,
      });
      blockedRunId = run.id;
      await expect(calculation.calculate(run.id, { actorId: P_ACTOR })).rejects.toMatchObject({
        code: "STATUTORY_REQUIRES_VERIFICATION",
      });
      // ZERO RESIDUE: the DRAFT shell stands, no lines, no totals.
      const after = await calculation.getRun(run.id);
      expect(after.lines).toEqual([]);
      expect(after.run.grossTotal).toBe("0.0000");
    });
    // The refusal's audit event survived the caller's rollback (the
    // service's own UoW — the W-2 law).
    const events = await client.query(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'payroll.statutory_refused'`,
      [TENANT_GOLD],
    );
    expect(events.rows[0]!.n).toBeGreaterThanOrEqual(1);
    // RESTORE: the row returns to VERIFIED with its exact prior
    // verification record (the seeded citation) — the same run
    // recalculates green.
    await client.query(
      `UPDATE statutory_contribution_profiles SET status = 'VERIFIED',
              source_name = $2, source_ref = $3, verified_by = $4, verified_at = $5, review_note = $6
        WHERE id = $1 AND tenant_id = $7`,
      [
        prior.rows[0]!.id,
        prior.rows[0]!.source_name,
        prior.rows[0]!.source_ref,
        prior.rows[0]!.verified_by,
        prior.rows[0]!.verified_at,
        prior.rows[0]!.review_note,
        TENANT_GOLD,
      ],
    );
    await client.end();
    await withTenant(TENANT_GOLD, async () => {
      const calculated = await calculation.calculate(blockedRunId, { actorId: P_ACTOR });
      expect(calculated.lines).toHaveLength(1);
      expect(calculated.run.statutoryEmployeeTotal).toBe("1170.0000");
      await employees.suspend(world.ksaEmployeeId, P_ACTOR);
    });
  });

  it("(d) FAILURE PACK — THE BRACKET-GAP SHAPE: a gapped VERIFIED SA set refuses the whole calculation typed (SET-CONSISTENT — never a partial fold), zero residue; withdrawn, SA returns to the honest no-bracket state", async () => {
    const client: Client = await su();
    // The gapped set on the TENANT'S OWN jurisdiction (the run resolves
    // SA): 0–10k @0% then 12k–30k @10% — a 2,000 gap that never tiles.
    for (const [sort, floor, ceiling, rate] of [
      [1, "0.0000", "10000.0000", "0.0000"],
      [2, "12000.0000", "30000.0000", "10.0000"],
    ] as const) {
      await client.query(
        `INSERT INTO payroll_tax_brackets
           (id, tenant_id, jurisdiction_code, code, floor, ceiling, rate, sort,
            personal_allowance_default, per_dependent_allowance, effective_from, status,
            source_name, source_ref, verified_at)
         VALUES (gen_random_uuid(), $1, 'SA', $2, $3, $4, $5, $6,
                 5000.0000, 1000.0000, DATE '2020-01-01', 'VERIFIED',
                 'The goldens'' gapped set (W-6 failure pack)', 'the gap shape', now())
         ON CONFLICT DO NOTHING`,
        [TENANT_GOLD, "PIT-GAP", floor, ceiling, rate, sort],
      );
    }
    let gapRunId = "";
    await withTenant(TENANT_GOLD, async () => {
      await employees.reactivate(world.ksaEmployeeId, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-04"]!,
        actorId: P_ACTOR,
      });
      gapRunId = run.id;
      // SET-CONSISTENT: the gap refuses the WHOLE calculation — never a
      // partial fold (D-03's law at the run level).
      await expect(calculation.calculate(run.id, { actorId: P_ACTOR })).rejects.toMatchObject({
        code: "PIT_BRACKET_SET_INVALID",
      });
      const after = await calculation.getRun(run.id);
      expect(after.lines).toEqual([]); // zero residue
      expect(after.run.grossTotal).toBe("0.0000");
    });
    // WITHDRAWN (the 0092 law restored): SA carries NO bracket rows —
    // the honest no-bracket state computes zero PIT with the explicit
    // note, and the same run recalculates green.
    await client.query(
      `DELETE FROM payroll_tax_brackets WHERE tenant_id = $1 AND jurisdiction_code = 'SA' AND code = 'PIT-GAP'`,
      [TENANT_GOLD],
    );
    await client.end();
    await withTenant(TENANT_GOLD, async () => {
      const calculated = await calculation.calculate(gapRunId, { actorId: P_ACTOR });
      expect(calculated.lines).toHaveLength(1);
      expect(calculated.run.pitTotal).toBe("0.0000"); // the honest state
      await employees.suspend(world.ksaEmployeeId, P_ACTOR);
    });
  });

  it("(e) G-54 GOLDEN + THE NON-DELTA SHAPE — the OPENING 40,500, the zero-delta no-journal law, the table-level delta CHECK, and the release mirror", async () => {
    await withTenant(TENANT_GOLD, async () => {
      // THE OPENING TRUE-UP (first adoption — the suspended employee
      // carries no 029 balance): 7 years × eosBase 9,000 → 135 days →
      // 40,500.0000 — the FULL entitlement, one G-54 journal.
      const opening = await eosb.trueUp({
        employeeId: world.eosEmployeeId,
        kind: "OPENING",
        onDate: "2026-06-01",
        note: "the goldens' opening (W-6)",
        actorId: P_ACTOR,
      });
      expect(opening.delta).toBe("40500.0000");
      expect(opening.journalEntryId).not.toBeNull();
      const openingLines = await journalLinesOf(opening.journalEntryId!);
      expect(openingLines).toHaveLength(2);
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      const provision = (await accounting.findActivePurpose("EOS_PROVISION"))!.accountId;
      const provisionExpense = (await accounting.findActivePurpose("EOS_PROVISION_EXPENSE"))!.accountId;
      expect(openingLines.filter((l) => l.direction === "DEBIT" && l.accountId === provisionExpense)[0]!.amount).toBe("40500.0000");
      expect(openingLines.filter((l) => l.direction === "CREDIT" && l.accountId === provision)[0]!.amount).toBe("40500.0000");

      // THE NON-DELTA SHAPE, refused: a re-true-up with NOTHING changed
      // computes delta 0.0000 and posts NO journal (the evidence row
      // still records — never a double full-entitlement post).
      const rerun = await eosb.trueUp({
        employeeId: world.eosEmployeeId,
        kind: "PERIOD_TRUE_UP",
        onDate: "2026-06-02",
        note: "the goldens' zero-delta re-run (W-6)",
        actorId: P_ACTOR,
      });
      expect(rerun.delta).toBe("0.0000");
      expect(rerun.journalEntryId).toBeNull();
      expect(rerun.calculation.status).toBe("COMPUTED");
      // The GL is unchanged: exactly ONE eosb_calculation-sourced
      // journal exists in the tenant (the opening's).
      const tx = await import("../../modules/payroll/infrastructure/payroll.store");
      const journals = await tx.requireAmbientTx().execute<{ n: number }>(
        (await import("drizzle-orm")).sql`
          SELECT count(*)::int AS n FROM journal_entries
          WHERE source_type = 'eosb_calculation' AND tenant_id = erp.current_tenant_id()`,
      );
      expect((journals.rows[0] as { n: number }).n).toBe(1);

      // THE RELEASE MIRROR: the wage base shrinks (basic 9,000 → 6,000)
      // — the entitlement drops to 27,000 (the SAME on-date — the
      // service-year lens is pinned to 7.00), the delta goes NEGATIVE,
      // and G-54 posts the release: DR EOS_PROVISION · CR
      // EOS_PROVISION_EXPENSE at 13,500.
      await employees.update(world.eosEmployeeId, { basicSalary: "6000.0000" }, P_ACTOR);
      const release = await eosb.trueUp({
        employeeId: world.eosEmployeeId,
        kind: "PERIOD_TRUE_UP",
        onDate: "2026-06-01",
        note: "the goldens' release (W-6)",
        actorId: P_ACTOR,
      });
      expect(release.delta).toBe("-13500.0000");
      expect(release.journalEntryId).not.toBeNull();
      const releaseLines = await journalLinesOf(release.journalEntryId!);
      expect(releaseLines.filter((l) => l.direction === "DEBIT" && l.accountId === provision)[0]!.amount).toBe("13500.0000");
      expect(releaseLines.filter((l) => l.direction === "CREDIT" && l.accountId === provisionExpense)[0]!.amount).toBe("13500.0000");
    });

    // THE TABLE-LEVEL LAW (discovered in this wave): the 0090 CHECK
    // ck_eosb_calculations_delta enforces delta = entitlement −
    // provision IN SQL — the non-delta shape cannot even be INSERTed.
    const client: Client = await su();
    await expect(
      client.query(
        `INSERT INTO eosb_calculations
           (id, tenant_id, employee_id, kind, service_years, tier_breakdown, wage_base_snapshot,
            entitlement_amount, provision_balance, delta, status, entry_date, created_by)
         VALUES (gen_random_uuid(), $1, $2, 'PERIOD_TRUE_UP', 7.00, '[]'::jsonb, '{}'::jsonb,
                 40500.0000, 0.0000, 99999.0000, 'COMPUTED', DATE '2026-06-04', $3)`,
        [TENANT_GOLD, world.eosEmployeeId, P_ACTOR],
      ),
    ).rejects.toThrow(/ck_eosb_calculations_delta/);
    await client.end();
  });
});

function addExactLocal(a: string, b: string): string {
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
