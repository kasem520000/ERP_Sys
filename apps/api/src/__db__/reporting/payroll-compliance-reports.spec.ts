import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import { ExportService } from "../../modules/reporting/application/export/export-service";
import { AssertionFailedExportBlockedError } from "../../modules/reporting/domain/reporting-errors";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { FilesService } from "../../modules/files/application/files.service";
import { S3FilesStore } from "../../modules/files/infrastructure/s3-files.store";
import {
  fullContext,
  newRunService,
  R_ACTOR,
  setupReportingFixture,
  ALL_KNOWN_PERMISSIONS,
} from "./fixtures";
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
  pPosting,
  eos,
} from "../payroll/fixtures";
import { EosbService } from "../../modules/payroll/application/eosb-service";
import { StructureService } from "../../modules/payroll/application/structure-service";
import { materializeCanonicalStatutorySet } from "../../modules/payroll/infrastructure/statutory-canonical";

/**
 * PHASE-046 (W-6, T-13) verification — the two compliance report
 * contracts (D-12, REPORT_CATALOG §payroll, registry 104 → 106):
 *
 * - `payroll.statutory-summary` — the per (period × profile row)
 *   statutory fold over POSTED runs: base totals, the employee/employer
 *   shares, the capped counts, and the frozen statutory_summary
 *   liability (accrued vs remitted) — the remittance-ready companion.
 *   The three-way `statutory-totals-tie` (INV-032(b)): Σ lines == the
 *   run totals == the independent jsonb breakdown re-fold, and the
 *   summary's accrued == Σ employee + Σ employer + Σ PIT.
 * - `payroll.eosb-liability` — the per-employee EOSB liability: service
 *   years, tier days, the computed entitlement, the STANDING provision
 *   (the 029 balance + the accumulated G-54 deltas — BR-087's model),
 *   settled, the latest delta. The `eosb-provision-tie`: Σ standing ==
 *   the EOS_PROVISION GL balance (the standing model accounts for the
 *   G-54 legs; the 029-era eos-provision fold predates them — the
 *   W-3/W-6 design point recorded on that contract).
 *
 * The worlds (the RUNSTAT dedicated-tenant precedent — never the PAY
 * registers whose censuses the 029 spec pins):
 * - TENANT_PCR (SA): the KSA worked example — the Saudi employee
 *   (basic 10,000 + housing 2,000 → employee 1,170.0000 / employer
 *   1,410.0000) beside the non-Saudi OH-only arm (0/240) in ONE posted
 *   run, EOS enabled (the two arms accrue 1,000 each — the
 *   ACCRUED_ONLY rows), a 1,000 partial remittance (the first-row-first
 *   allocation), and a suspended 7-year employee taking the OPENING
 *   G-54 true-up 40,500.0000 WITH the run reference (the F3
 *   eosb_trueup_total advance visible at the report level).
 * - TENANT_PZ (country BH — the PIT jurisdiction): the PIT world — the pit.spec synthetic
 *   VERIFIED set (0% to 10k · 10% 10–30k · 20% above, allowance 5,000)
 *   as the FIRST green end-to-end PIT-through-the-run pin (the engine
 *   spec owns the fold; KSA owns the honest no-bracket state): gross
 *   40,000 → taxable 35,000 → PIT 3,000.0000 — the report's PIT row.
 *
 * The failure law (block-on-fail): a superuser-seeded drift — a tampered
 * breakdown amount (the wrong-cap shape) or a tampered G-54 delta —
 * FAILS the tie and blocks every export (AssertionFailedExportBlocked
 * Error); the restore re-ties green (zero residue of the drift).
 */

const TENANT_PCR = "9b9b9b9b-9b9b-9b9b-9b9b-9b9b9b9b9b9b";
const TENANT_PZ = "9c9c9c9c-9c9c-9c9c-9c9c-9c9c9c9c9c9c";

const audit = new AuditService(new DrizzleAuditStore());
const structures = new StructureService(audit);
const eosb = new EosbService(audit, pPosting, eos);

interface PcrWorld {
  periodId: string;
  periodName: string;
  bankCashAccountId: string;
  runId: string;
  ksaEmployeeId: string;
  nsEmployeeId: string;
  eosEmployeeId: string;
  trueUpJournalEntryId: string | null;
}

interface PzWorld {
  runId: string;
}

const spec: { pcr?: PcrWorld; pz?: PzWorld } = {};

/** The run-context permission set carrying the module read key. */
function complianceContext(tenantId: string): ReturnType<typeof fullContext> {
  return fullContext(tenantId, {
    permissions: new Set([...ALL_KNOWN_PERMISSIONS, "payroll.reports.view"]),
  });
}

async function postRun(tenantId: string, periodId: string): Promise<string> {
  return withTenant(tenantId, async () => {
    const run = await calculation.createRun({ fiscalPeriodId: periodId, actorId: P_ACTOR });
    await calculation.calculate(run.id, { actorId: P_ACTOR });
    await workflow.submit(run.id, P_ACTOR);
    await workflow.approve(run.id, P_APPROVER);
    const posted = await runPosting.post(run.id, P_ACTOR);
    expect(posted.status).toBe("POSTED");
    return run.id;
  });
}

beforeAll(async () => {
  // Boot BOTH fixture families once: the reporting harness (R_ACTOR's
  // user row + the s3rver-backed files service) and the payroll services.
  await setupReportingFixture();
  await setupPayrollFixture();

  const client = await su();
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant PCR (046 compliance reports)', 'المستأجر لتقارير الامتثال', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant PZ (046 PIT world)', 'المستأجر لعالم الضريبة', 'SAR', 'BH', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PCR, TENANT_PZ],
  );
  await client.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
       (gen_random_uuid(), $1, 'payroll.eos.enabled', 'true'::jsonb),
       (gen_random_uuid(), $1, 'payroll.eos.accrual_days_per_service_year', '3'::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_PCR],
  );
  // TENANT_PZ's synthetic VERIFIED bracket set (the pit.spec shape, on
  // PZ's OWN books — the tenant-scoped law): 0–10k @0% · 10–30k @10% ·
  // 30k+ @20%, personal allowance 5,000, per-dependent 1,000.
  for (const [sort, floor, ceiling, rate] of [
    [1, "0.0000", "10000.0000", "0.0000"],
    [2, "10000.0000", "30000.0000", "10.0000"],
    [3, "30000.0000", null, "20.0000"],
  ] as const) {
    await client.query(
      `INSERT INTO payroll_tax_brackets
         (id, tenant_id, jurisdiction_code, code, floor, ceiling, rate, sort,
          personal_allowance_default, per_dependent_allowance, effective_from, status,
          source_name, source_ref, verified_at)
       VALUES (gen_random_uuid(), $1, 'BH', $2, $3, $4, $5, $6,
               5000.0000, 1000.0000, DATE '2020-01-01', 'VERIFIED',
               'The spec''s synthetic VERIFIED set (PHASE-046 W-6)', 'the worked-example shape', now())
       ON CONFLICT DO NOTHING`,
      [TENANT_PZ, "PIT-PZ", floor, ceiling, rate, sort],
    );
  }
  await client.end();

  // -- TENANT_PCR: the KSA statutory + EOSB world --------------------------------
  const pcr = await withTenant(TENANT_PCR, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    await materializeCanonicalStatutorySet();
    const salariesExpenseAccount = (await accounting.findActivePurpose("SALARIES_EXPENSE"))!.accountId;

    const existing = await structures.list(50);
    const structure =
      existing.find((row) => row.code === "ST-PCR") ??
      (await structures.create({
        code: "ST-PCR",
        name: "Compliance-reports structure",
        nameAr: "هيكل تقارير الامتثال",
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
      name: "PCR Bank",
      nameAr: "بنك تقارير الامتثال",
      type: "BANK",
      accountId: (await accounting.findAccountByCode("1121"))!.id,
      branchId: null,
      currencyCode: "SAR",
      createdBy: P_ACTOR,
    });

    const list = await employees.list({ limit: 100 });
    const ensure = async (input: Parameters<typeof employees.create>[0], suspended: boolean) => {
      const found = list.find((row) => row.code === input.code);
      if (found !== undefined) return found.id;
      const created = await employees.create(input);
      if (suspended) await employees.suspend(created.id, P_ACTOR);
      return created.id;
    };
    const ksaEmployeeId = await ensure(
      {
        code: "EMP-PCR-001",
        name: "Saudi Compliance Example",
        nameAr: "مثال الامتثال السعودي",
        nationality: "SA",
        hireDate: "2020-01-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      },
      false,
    );
    const nsEmployeeId = await ensure(
      {
        code: "EMP-PCR-002",
        name: "Non-Saudi OH Example",
        nameAr: "مثال الأخطار المهنية",
        nationality: "EG",
        hireDate: "2020-01-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      },
      false,
    );
    // The 7-year EOSB arm: SUSPENDED (the E2 pattern — invisible to the
    // run, so the 029 balance starts at ZERO and the OPENING true-up
    // posts the FULL 40,500 entitlement — the eosb.spec (b) shape).
    const eosEmployeeId = await ensure(
      {
        code: "EMP-PCR-003",
        name: "EOSB Seven Years",
        nameAr: "سبع سنوات نهاية الخدمة",
        nationality: "EG",
        hireDate: "2019-06-01",
        contractType: "FULL_TIME",
        basicSalary: "9000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      },
      true,
    );

    return {
      periodId: periodIds["FY2026-01"]!,
      periodName: "FY2026-01",
      bankCashAccountId: bank.id,
      ksaEmployeeId,
      nsEmployeeId,
      eosEmployeeId,
    };
  });

  // The posted run: the KSA worked example + the non-Saudi OH arm.
  const runId = await postRun(TENANT_PCR, pcr.periodId);

  // A 1,000 partial remittance — the first-row-first allocation lands on
  // GOSI-PENSION (the summary's stored order), leaving accrued > remitted.
  await withTenant(TENANT_PCR, () =>
    payouts.remit(runId, {
      cashAccountId: pcr.bankCashAccountId,
      amount: "1000.0000",
      entryDate: "2026-02-05",
      actorId: P_ACTOR,
    }),
  );

  // The OPENING G-54 true-up WITH the run reference — the F3 column.
  const trueUp = await withTenant(TENANT_PCR, () =>
    eosb.trueUp({
      employeeId: pcr.eosEmployeeId,
      kind: "OPENING",
      onDate: "2026-06-01",
      note: "the compliance-reports fixture (W-6)",
      actorId: P_ACTOR,
      runId,
      fiscalPeriodId: pcr.periodId,
    }),
  );
  expect(trueUp.delta).toBe("40500.0000");

  spec.pcr = { ...pcr, runId, trueUpJournalEntryId: trueUp.journalEntryId };

  // -- TENANT_PZ: the PIT world --------------------------------------------------
  const pz = await withTenant(TENANT_PZ, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    const salariesExpenseAccount = (await accounting.findActivePurpose("SALARIES_EXPENSE"))!.accountId;
    const existing = await structures.list(50);
    const structure =
      existing.find((row) => row.code === "ST-PZ") ??
      (await structures.create({
        code: "ST-PZ",
        name: "PIT structure (housing only)",
        nameAr: "هيكل عالم الضريبة",
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
    void treasury; // PZ settles nothing — the PIT arm only runs the report
    const list = await employees.list({ limit: 100 });
    if (!list.some((row) => row.code === "EMP-PZ-001")) {
      await employees.create({
        code: "EMP-PZ-001",
        name: "PIT Worked Example",
        nameAr: "مثال الضريبة",
        hireDate: "2020-01-01",
        contractType: "FULL_TIME",
        basicSalary: "38000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      });
    }
    return { periodId: periodIds["FY2026-01"]! };
  });
  spec.pz = { runId: await postRun(TENANT_PZ, pz.periodId) };
});

describe("PHASE-046 (W-6, T-13) · payroll.statutory-summary — the remittance-ready fold", () => {
  it("renders the KSA worked example beside the non-Saudi OH arm with the three-way tie PASS", async () => {
    const outcome = await withTenant(TENANT_PCR, () =>
      newRunService().run({
        reportKey: "payroll.statutory-summary",
        params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
        ctx: complianceContext(TENANT_PCR),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toBeDefined();
    const rows = new Map(outcome.result!.rows.map((row) => [row.key as string, row.values]));

    // GOSI-PENSION: base 12,000 (the Saudi arm only — the non-Saudi has
    // no pension row), 1,080/1,080; accrued 2,160. The 1,000 partial
    // settlement allocated FIRST-ROW-FIRST: GOSI-OH (the summary's
    // stored order — the resolution's code order O < P < S) took its
    // full 480, PENSION the remaining 520.
    const pension = rows.get("FY2026-01|GOSI-PENSION")!;
    expect(pension).toBeDefined();
    expect(pension.base).toBe("12000.0000");
    expect(pension.employeeShare).toBe("1080.0000");
    expect(pension.employerShare).toBe("1080.0000");
    expect(pension.accrued).toBe("2160.0000");
    expect(pension.remitted).toBe("520.0000");
    expect(pension.outstanding).toBe("1640.0000");

    // GOSI-SANED: 90/90, accrued 180, nothing remitted.
    const saned = rows.get("FY2026-01|GOSI-SANED")!;
    expect(saned.employeeShare).toBe("90.0000");
    expect(saned.employerShare).toBe("90.0000");
    expect(saned.accrued).toBe("180.0000");
    expect(saned.remitted).toBe("0.0000");

    // GOSI-OH: the ALL arm — base 24,000 (BOTH employees), 0/480; the
    // partial settlement's first row — fully remitted.
    const oh = rows.get("FY2026-01|GOSI-OH")!;
    expect(oh.base).toBe("24000.0000");
    expect(oh.employeeShare).toBe("0.0000");
    expect(oh.employerShare).toBe("480.0000");
    expect(oh.accrued).toBe("480.0000");
    expect(oh.remitted).toBe("480.0000");

    // KSA carries no PIT rows (the 0092 honest no-bracket law) — no PIT
    // row renders even though the period folded.
    expect(rows.has("FY2026-01|PIT")).toBe(false);

    // The three-way tie PASSES over the whole window.
    for (const assertion of outcome.result!.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
    const tie = outcome.result!.assertions.find((a) => a.id === "statutory-totals-tie")!;
    expect(tie).toBeDefined();

    // The totals fold: employee 1,170 · employer 1,650 · accrued 2,820 ·
    // remitted 1,000 (the DEDUCTIONS_PAYABLE statutory credit).
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total]));
    expect(totals.get("employeeTotal")?.amount).toBe("1170.0000");
    expect(totals.get("employerTotal")?.amount).toBe("1650.0000");
    expect(totals.get("accruedTotal")?.amount).toBe("2820.0000");
    expect(totals.get("remittedTotal")?.amount).toBe("1000.0000");
  });

  it("THE PIT WORLD (tenant BH) — the first green end-to-end PIT-through-the-run pin: the PIT row renders and the tie PASSes", async () => {
    const outcome = await withTenant(TENANT_PZ, () =>
      newRunService().run({
        reportKey: "payroll.statutory-summary",
        params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
        ctx: complianceContext(TENANT_PZ),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const rows = new Map(outcome.result!.rows.map((row) => [row.key as string, row.values]));
    // BH carries no statutory profiles (the no-profile state) — the ONLY
    // row is the PIT: gross 40,000 → taxable 35,000 → 3,000.0000.
    expect(outcome.result!.rows).toHaveLength(1);
    const pit = rows.get("FY2026-01|PIT")!;
    expect(pit).toBeDefined();
    expect(pit.employeeShare).toBe("3000.0000");
    expect(pit.employerShare).toBe("0.0000");
    expect(pit.accrued).toBe("3000.0000");
    expect(pit.remitted).toBe("0.0000");
    for (const assertion of outcome.result!.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
  });

  it("exports flow (csv, audited, BOM-first) from the PASSING run", async () => {
    const runs = newRunService();
    const outcome = await withTenant(TENANT_PCR, () =>
      runs.run({
        reportKey: "payroll.statutory-summary",
        params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
        ctx: complianceContext(TENANT_PCR),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const exportsSvc = new ExportService(
      new AuditService(new DrizzleAuditStore()),
      new FilesService(new S3FilesStore()),
      runs,
    );
    const artifact = await withTenant(TENANT_PCR, () =>
      exportsSvc.exportRun({ runId: outcome.runId, format: "csv", actorId: R_ACTOR }),
    );
    expect(artifact.bytes > 0).toBe(true);
    const client = await su();
    const counted = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'report.exported' AND entity_id = $2`,
      [TENANT_PCR, outcome.runId],
    );
    await client.end();
    expect(counted.rows[0]!.n).toBe(1);
  });

  it("THE SEEDED-DRIFT FAIL ARM (the wrong-cap shape): a tampered breakdown amount FAILs the three-way tie and blocks every export; the restore re-ties green", async () => {
    const pcr = spec.pcr!;
    const client = await su();
    // Tamper: the Saudi line's GOSI-PENSION employeeAmount 1,080 → 1,180
    // — the jsonb re-fold now disagrees with the line columns (and the
    // amount violates rate × clamped base — INV-032(a)'s wrong shape).
    // The lines are append-only (the INV-003 guard) — the tamper rides
    // the sanctioned data-repair path (replica session mode, the
    // exports.spec unbalanced-entry precedent).
    const line = await client.query<{ id: string; statutory_breakdown: unknown }>(
      `SELECT id, statutory_breakdown FROM payroll_run_lines
        WHERE tenant_id = $1 AND run_id = $2 AND employee_id = $3`,
      [TENANT_PCR, pcr.runId, pcr.ksaEmployeeId],
    );
    const breakdown = line.rows[0]!.statutory_breakdown as {
      code: string;
      employeeAmount: string;
    }[];
    const original = breakdown.find((row) => row.code === "GOSI-PENSION")!.employeeAmount;
    expect(original).toBe("1080.0000");
    const tampered = breakdown.map((row) =>
      row.code === "GOSI-PENSION" ? { ...row, employeeAmount: "1180.0000" } : row,
    );
    await client.query(`SET session_replication_role = replica`);
    await client.query(
      `UPDATE payroll_run_lines SET statutory_breakdown = $3::jsonb WHERE id = $1 AND tenant_id = $2`,
      [line.rows[0]!.id, TENANT_PCR, JSON.stringify(tampered)],
    );
    await client.query(`SET session_replication_role = DEFAULT`);
    try {
      const runs = newRunService();
      const outcome = await withTenant(TENANT_PCR, () =>
        runs.run({
          reportKey: "payroll.statutory-summary",
          params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
          ctx: complianceContext(TENANT_PCR),
        }),
      );
      expect(outcome.status).toBe("SUCCEEDED");
      const tie = outcome.result!.assertions.find((a) => a.id === "statutory-totals-tie")!;
      expect(tie.status).toBe("FAIL");
      expect(tie.detail?.en).toContain("export blocked");
      // THE BINDING BLOCK: no format leaves the building on a FAIL.
      const exportsSvc = new ExportService(
        new AuditService(new DrizzleAuditStore()),
        new FilesService(new S3FilesStore()),
        runs,
      );
      await expect(
        withTenant(TENANT_PCR, () =>
          exportsSvc.exportRun({ runId: outcome.runId, format: "csv", actorId: R_ACTOR }),
        ),
      ).rejects.toThrowError(AssertionFailedExportBlockedError);
    } finally {
      // RESTORE (zero residue) — the tie re-ties green.
      await client.query(`SET session_replication_role = replica`);
      await client.query(
        `UPDATE payroll_run_lines SET statutory_breakdown = $3::jsonb WHERE id = $1 AND tenant_id = $2`,
        [line.rows[0]!.id, TENANT_PCR, JSON.stringify(breakdown)],
      );
      await client.query(`SET session_replication_role = DEFAULT`);
      await client.end();
    }
    const reRun = await withTenant(TENANT_PCR, () =>
      newRunService().run({
        reportKey: "payroll.statutory-summary",
        params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
        ctx: complianceContext(TENANT_PCR),
      }),
    );
    const tie = reRun.result!.assertions.find((a) => a.id === "statutory-totals-tie")!;
    expect(tie.status).toBe("PASS");
  });

  it("sessions without payroll.reports.view are denied before params bind", async () => {
    const deniedCtx = fullContext(TENANT_PCR, {
      permissions: new Set(["reporting.reports.run", "reporting.reports.export"]),
    });
    await expect(
      withTenant(TENANT_PCR, () =>
        newRunService().run({
          reportKey: "payroll.statutory-summary",
          params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
          ctx: deniedCtx,
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });
});

describe("PHASE-046 (W-6, T-13) · payroll.eosb-liability — the standing-provision view", () => {
  it("renders the computed row beside the ACCRUED_ONLY rows with the eosb-provision-tie PASS (Σ standing == the GL)", async () => {
    const pcr = spec.pcr!;
    const outcome = await withTenant(TENANT_PCR, () =>
      newRunService().run({
        reportKey: "payroll.eosb-liability",
        params: { locale: "en" },
        ctx: complianceContext(TENANT_PCR),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const rows = new Map(outcome.result!.rows.map((row) => [row.key as string, row.values]));

    // The computed row: 7 years → 135 days → 40,500.0000 — the OPENING
    // true-up's full entitlement (the suspended employee has no 029
    // balance), standing 40,500, aligned 0.
    const eosRow = rows.get(pcr.eosEmployeeId)!;
    expect(eosRow).toBeDefined();
    expect(eosRow.kind).toBe("OPENING");
    expect(eosRow.serviceYears).toBe("7.00");
    expect(eosRow.tierDays).toBe("135.0000");
    expect(eosRow.entitlement).toBe("40500.0000");
    expect(eosRow.standing).toBe("40500.0000");
    expect(eosRow.lastDelta).toBe("40500.0000");
    expect(eosRow.aligned).toBe("0.0000");

    // The ACCRUED_ONLY rows: the two run employees' EOS accruals (basic
    // 10,000 × 3/30 = 1,000 each) — provision WITHOUT computation, the
    // honest "—" state (never a fabricated entitlement).
    const ksaRow = rows.get(pcr.ksaEmployeeId)!;
    expect(ksaRow.kind).toBe("ACCRUED_ONLY");
    expect(ksaRow.entitlement).toBe("—");
    expect(ksaRow.standing).toBe("1000.0000");
    const nsRow = rows.get(pcr.nsEmployeeId)!;
    expect(nsRow.kind).toBe("ACCRUED_ONLY");
    expect(nsRow.standing).toBe("1000.0000");

    // THE TIE: Σ standing (40,500 + 1,000 + 1,000 = 42,500) == the
    // EOS_PROVISION GL balance (the run accruals 2,000 + the G-54 40,500).
    const tie = outcome.result!.assertions.find((a) => a.id === "eosb-provision-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared?.left).toBe("42500.0000");
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total]));
    expect(totals.get("standingTotal")?.amount).toBe("42500.0000");
    expect(totals.get("entitlementTotal")?.amount).toBe("40500.0000");
  });

  it("THE SEEDED-DRIFT FAIL ARM: a register the GL never settled FAILs the eosb-provision-tie and blocks every export; the restore re-ties green", async () => {
    const pcr = spec.pcr!;
    const client = await su();
    // Tamper: stamp the KSA employee's terminal settlement WITHOUT a G-31
    // journal — the register's standing drops to 0 (settled ⇒ the 029
    // balance reads 0) while the GL still carries the 1,000 accrual. The
    // 0043 employees law (ck_employees_eos_settled_shape) couples the
    // settled amount to its journal-linkage column, so the drift stamps
    // the pair — pointing the linkage at the G-54 true-up's OWN journal
    // (a real entry that is NOT a settlement — the register claims a
    // settlement the books never made). (The G-54 delta itself is
    // un-tamperable — ck_eosb_calculations_delta enforces delta =
    // entitlement − provision at the TABLE level, the non-delta shape
    // unrepresentable in SQL.)
    await client.query(
      `UPDATE employees SET status = 'TERMINATED', termination_date = DATE '2026-06-30',
              eos_settled_amount = 500.0000, eos_settlement_journal_entry_id = $3::uuid
        WHERE tenant_id = $1 AND id = $2`,
      [TENANT_PCR, pcr.ksaEmployeeId, pcr.trueUpJournalEntryId],
    );
    try {
      const runs = newRunService();
      const outcome = await withTenant(TENANT_PCR, () =>
        runs.run({
          reportKey: "payroll.eosb-liability",
          params: { locale: "en" },
          ctx: complianceContext(TENANT_PCR),
        }),
      );
      expect(outcome.status).toBe("SUCCEEDED");
      const tie = outcome.result!.assertions.find((a) => a.id === "eosb-provision-tie")!;
      expect(tie.status).toBe("FAIL");
      const exportsSvc = new ExportService(
        new AuditService(new DrizzleAuditStore()),
        new FilesService(new S3FilesStore()),
        runs,
      );
      await expect(
        withTenant(TENANT_PCR, () =>
          exportsSvc.exportRun({ runId: outcome.runId, format: "xlsx", actorId: R_ACTOR }),
        ),
      ).rejects.toThrowError(AssertionFailedExportBlockedError);
    } finally {
      // RESTORE (zero residue) — the settled stamp returns to NULL and
      // the tie re-ties green.
      await client.query(
        `UPDATE employees SET status = 'ACTIVE', termination_date = NULL, eos_settled_amount = NULL,
                eos_settlement_journal_entry_id = NULL
          WHERE tenant_id = $1 AND id = $2`,
        [TENANT_PCR, pcr.ksaEmployeeId],
      );
      await client.end();
    }
    const reRun = await withTenant(TENANT_PCR, () =>
      newRunService().run({
        reportKey: "payroll.eosb-liability",
        params: { locale: "en" },
        ctx: complianceContext(TENANT_PCR),
      }),
    );
    const tie = reRun.result!.assertions.find((a) => a.id === "eosb-provision-tie")!;
    expect(tie.status).toBe("PASS");
  });

  it("the xlsx export round-trips from the PASSING run (audited)", async () => {
    const runs = newRunService();
    const outcome = await withTenant(TENANT_PCR, () =>
      runs.run({
        reportKey: "payroll.eosb-liability",
        params: { locale: "en" },
        ctx: complianceContext(TENANT_PCR),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const exportsSvc = new ExportService(
      new AuditService(new DrizzleAuditStore()),
      new FilesService(new S3FilesStore()),
      runs,
    );
    const artifact = await withTenant(TENANT_PCR, () =>
      exportsSvc.exportRun({ runId: outcome.runId, format: "xlsx", actorId: R_ACTOR }),
    );
    expect(artifact.bytes > 0).toBe(true);
    const client = await su();
    const counted = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'report.exported' AND entity_id = $2`,
      [TENANT_PCR, outcome.runId],
    );
    await client.end();
    expect(counted.rows[0]!.n).toBe(1);
  });

  it("the run's eosb_trueup_total carries the true-up's delta (the F3 advance, visible at the report world)", async () => {
    const pcr = spec.pcr!;
    const client: Client = await su();
    const row = await client.query<{ eosb_trueup_total: string }>(
      `SELECT eosb_trueup_total::text FROM payroll_runs WHERE tenant_id = $1 AND id = $2`,
      [TENANT_PCR, pcr.runId],
    );
    await client.end();
    expect(row.rows[0]!.eosb_trueup_total).toBe("40500.0000");
  });

  it("sessions without payroll.reports.view are denied before params bind", async () => {
    const deniedCtx = fullContext(TENANT_PCR, {
      permissions: new Set(["reporting.reports.run", "reporting.reports.export"]),
    });
    await expect(
      withTenant(TENANT_PCR, () =>
        newRunService().run({
          reportKey: "payroll.eosb-liability",
          params: { locale: "en" },
          ctx: deniedCtx,
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });
});
