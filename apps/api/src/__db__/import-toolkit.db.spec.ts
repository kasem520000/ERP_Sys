/**
 * PHASE-040 T-10 — the import-toolkit evidence suite (§6 acceptance 2–6)
 * on real PostgreSQL 16:
 *
 * - acceptance 2: each of the SEVEN kinds round-trips — map → dry-run
 *   (ZERO writes: journal + entity counts byte-identical before/after) →
 *   injected errors surface as typed AR+EN per-row failures → fix →
 *   commit (the BR-066 worker, awaited by polling) → verified entity/GL
 *   effects;
 * - acceptance 3: ACCOUNT_OPENING_BALANCES lands through the opening
 *   engine (balanced-by-nature file check; the draft posts as ONE journal
 *   entry through PostingService — no journal bypass);
 * - acceptance 4: a saved mapping created for one file is reused on a
 *   second file of the same shape with zero re-mapping;
 * - acceptance 5: the QuickBooks-shaped and Odoo-shaped fixture files
 *   import end-to-end through their DOCUMENTED mappings (the adapter
 *   registry IS the contract — a mismatch fails this spec);
 * - acceptance 6: BR-066 atomicity — a commit interrupted mid-run (a
 *   patched applier throwing at a row threshold) leaves ZERO partial
 *   state; the re-run converges.
 *
 * The app boots once (NestFactory) so services resolve through the real
 * DI tree; every call runs inside withTenant (RLS live); commits ride the
 * in-process pg-boss worker (polled to a terminal status).
 */
import { randomInt } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { AppModule } from "../app.module";
import { withTenant } from "../infra/db/tenant-context";
import { closeDb } from "../infra/db/client";
import { stopBoss } from "../infra/jobs/boss";
import { RegistrationService, __resetRegistrationLimitersForTests } from "../modules/tenancy/application/registration-service";
import { OnboardingService as TenancyOnboardingService } from "../modules/tenancy/application/onboarding-service";
import { PeriodService } from "../modules/accounting/application/period-service";
import { OpeningBalancesPostingService as AccountingOpeningService } from "../modules/accounting/application/opening-balances-service";
import { CategoryService as AssetCategoryService } from "../modules/fixed_assets/application/category-service";
import { PartnerService } from "../modules/partners/application/partner-service";
import { ItemService } from "../modules/items/application/item-service";
import { UomService } from "../modules/items/application/uom-service";
import { EmployeeService } from "../modules/payroll/application/employee-service";
import { BudgetVersionService } from "../modules/budgeting/application/budget-version-service";
import { ImportToolkitService } from "../modules/onboarding/application/import-toolkit-service";
import { MappingsService } from "../modules/onboarding/application/mappings-service";
import { FilesService } from "../modules/files/api/files";
import { MIGRATION_ADAPTERS, findAdapter } from "../modules/onboarding/application/adapters";
import { insertAccountPurpose, insertBranch, listBranches } from "../modules/tenancy/infrastructure/tenancy.store";
import { findAccountByCode, findActivePurpose } from "../modules/accounting/infrastructure/accounting.store";

const OWNER_PASSWORD = "toolkit-owner-passphrase-9";

interface ReportShape {
  summary: { total: number; valid: number; invalid: number; duplicates: number; warnings: number };
  issues: { row: number; field: string; en: string; ar: string; duplicate: boolean }[];
  unmappedColumns: string[];
}

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let toolkit: ImportToolkitService;
let mappings: MappingsService;
let files: FilesService;
let tenancyOnboarding: TenancyOnboardingService;
let periods: PeriodService;
let accountingOpening: AccountingOpeningService;
let categories: AssetCategoryService;
let partners: PartnerService;
let items: ItemService;
let uoms: UomService;
let employees: EmployeeService;
let budgetVersions: BudgetVersionService;

let tenantId = "";
let ownerId = "";
let fiscalYearId = "";
/** Two template-instantiated account codes (the opening-balance targets). */
let cashAccountCode = "";
let capitalAccountCode = "";
let assetCategoryCode = "";
let branchCode = "";
let partnerCode = "";
let itemSku = "";
let itemSku2 = "";

async function suCount(sql: string, params: unknown[] = []): Promise<number> {
  const su = await superuserClient();
  const result = await su.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) q`, params);
  await su.end();
  return result.rows[0]?.n ?? 0;
}

/** The combined negative-ledger + entity snapshot (the zero-write proof). */
async function ledgerSnapshot(): Promise<Record<string, number>> {
  return {
    accounts: await suCount(`SELECT * FROM accounts WHERE tenant_id = $1`, [tenantId]),
    journals: await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId]),
    journalLines: await suCount(`SELECT * FROM journal_lines WHERE tenant_id = $1`, [tenantId]),
    openingDocs: await suCount(`SELECT * FROM opening_balance_docs WHERE tenant_id = $1`, [tenantId]),
    assets: await suCount(`SELECT * FROM assets WHERE tenant_id = $1`, [tenantId]),
    employees: await suCount(`SELECT * FROM employees WHERE tenant_id = $1`, [tenantId]),
    priceLists: await suCount(`SELECT * FROM price_lists WHERE tenant_id = $1`, [tenantId]),
    priceListRows: await suCount(`SELECT * FROM price_list_items WHERE tenant_id = $1`, [tenantId]),
    contracts: await suCount(`SELECT * FROM service_contracts WHERE tenant_id = $1`, [tenantId]),
    budgetLines: await suCount(`SELECT * FROM budget_lines WHERE tenant_id = $1`, [tenantId]),
  };
}

/** CSV builder (BOM + CRLF — the engine's documented tolerant reader). */
function csv(headers: readonly string[], rows: readonly (readonly string[])[]): Buffer {
  const lines = [headers, ...rows].map((row) =>
    row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(","),
  );
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

/** Upload a fixture file through the REAL artifact seam (tenant-prefixed). */
async function uploadCsv(name: string, body: Buffer): Promise<string> {
  const key = await files.writeArtifact(tenantId, "import_fixtures", name, body);
  return key;
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  committedRows: number;
  error: string | null;
  report: unknown;
}

async function createJob(input: {
  kind: string;
  fileKey: string;
  format?: "CSV" | "XLSX";
  columnMap?: Record<string, string> | null;
  mappingId?: string | null;
  options?: Record<string, unknown> | null;
  uploadToken?: string;
}): Promise<JobRow> {
  return withTenant(tenantId, () =>
    toolkit.createJob(ownerId, {
      kind: input.kind,
      format: input.format ?? "CSV",
      uploadToken: input.uploadToken ?? `${input.kind}-${Date.now()}-${randomInt(1, 1e9)}`,
      fileKey: input.fileKey,
      fileName: "fixture.csv",
      mappingId: input.mappingId ?? null,
      options: input.options ?? null,
      columnMap: input.columnMap ?? null,
    }),
  ) as Promise<JobRow>;
}

/** commit + poll the in-process BR-066 worker to a terminal status. */
async function commitAndAwait(
  jobId: string,
  acknowledged = false,
  timeoutMs = 40_000,
): Promise<JobRow> {
  await withTenant(tenantId, () => toolkit.commit(ownerId, jobId, acknowledged));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = (await withTenant(tenantId, () => toolkit.getJob(jobId))) as JobRow;
    if (job.status === "COMMITTED" || job.status === "FAILED") {
      return job;
    }
    if (job.status === "PREVIEW_READY" && job.error !== null && job.error !== "") {
      console.error("[commitAndAwait] the worker rolled back:", job.error);
      return job; // the worker rolled back and recorded the failure
    }
    if (Date.now() > deadline) {
      throw new Error(`commit of ${jobId} did not converge (status ${job.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function reportOfJob(job: JobRow): ReportShape {
  return job.report as ReportShape;
}

beforeAll(async () => {
  ensureTestDb();
  __resetRegistrationLimitersForTests();
  reloadEnv();
  const created = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  app = created;
  await created.init();
  toolkit = created.get(ImportToolkitService);
  mappings = created.get(MappingsService);
  files = created.get(FilesService);
  tenancyOnboarding = created.get(TenancyOnboardingService);
  periods = created.get(PeriodService);
  accountingOpening = created.get(AccountingOpeningService);
  categories = created.get(AssetCategoryService);
  partners = created.get(PartnerService);
  items = created.get(ItemService);
  uoms = created.get(UomService);
  employees = created.get(EmployeeService);
  budgetVersions = created.get(BudgetVersionService);

  const registration = created.get(RegistrationService);
  const registered = await registration.register({
    businessName: "Toolkit Import Co",
    businessNameAr: "شركة استيراد العدة",
    countryCode: "SA",
    baseCurrency: "SAR",
    industryTemplateKey: "industry.professional_services",
    taxRegistrationStatus: "NOT_REGISTERED",
    taxRegistrationNumber: null,
    ownerEmail: `toolkit-${Date.now()}@provision.test`,
    ownerFullName: "Toolkit Owner",
    ownerPassword: OWNER_PASSWORD,
    ip: `10.40.${randomInt(1, 250)}.1`,
  });
  tenantId = registered.tenantId;
  ownerId = registered.ownerUserId;

  await withTenant(tenantId, async () => {
    // The workspace substrate (roles, CoA template instantiation, units).
    await tenancyOnboarding.provision(ownerId, { industryTemplateKey: "industry.professional_services" });
    // FY2026 (the opening post + the BUDGETS grid ride its periods).
    const year = await periods.createYear(ownerId, {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    fiscalYearId = year.id;

    // Two postable template accounts for the opening-balance kinds —
    // same-transaction reads (deterministic template codes 1111/3100; a
    // separate superuser connection CANNOT see this open UoW's rows).
    const cashAccount = await findAccountByCode("1111");
    const capitalAccount = await findAccountByCode("3100");
    if (cashAccount === undefined || capitalAccount === undefined) {
      throw new Error("CoA template accounts 1111/3100 missing after provisioning");
    }
    cashAccountCode = cashAccount.code;
    capitalAccountCode = capitalAccount.code;

    // Belt-and-braces FA purpose mapping (the fixed-assets fixture
    // precedent — fail-closed consumers need it present regardless of
    // provisioning order), then the asset category (FIXED_ASSETS target).
    const mapPurpose = async (purposeKey: string, code: string): Promise<void> => {
      if ((await findActivePurpose(purposeKey)) !== undefined) return;
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
    };
    await mapPurpose("FIXED_ASSET", "1210");
    await mapPurpose("ACCUM_DEPRECIATION", "1220");
    await mapPurpose("DEPRECIATION_EXPENSE", "5300");
    await categories.create({
      code: "IT-EQP",
      name: "IT Equipment",
      nameAr: "معدات تقنية",
      usefulLifeMonthsDefault: 48,
      depreciationMethodDefault: "STRAIGHT_LINE",
      assetPurposeKey: "FIXED_ASSET",
      accumDepreciationPurposeKey: "ACCUM_DEPRECIATION",
      expensePurposeKey: "DEPRECIATION_EXPENSE",
      note: null,
      noteAr: null,
      actorId: ownerId,
    });
    assetCategoryCode = "IT-EQP";
    // The workspace branch (the fixed-assets fixture precedent — the
    // workspace provisioning does not create branches).
    const existingBranches = await listBranches(null);
    const mainBranch =
      existingBranches.find((row) => row.code === "MAIN") ??
      (await insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    branchCode = mainBranch.code;

    // A partner + an item (CONTRACTS / PRICE_LISTS targets).
    const partner = await partners.create(ownerId, {
      kind: "CUSTOMER",
      code: "C-1001",
      name: "Al Amal Trading",
      nameAr: "الأمل التجارية",
      taxNumber: null,
      creditLimit: null,
      creditTermsId: null,
      priceListId: null,
    });
    partnerCode = partner.code;
    const uomList = await uoms.list();
    const uom = uomList.find((row) => row.code === "PCS") ?? uomList[0]!;
    const item = await items.create(ownerId, {
      sku: "SRV-CONS-01",
      name: "Consulting hours",
      nameAr: "ساعات استشارية",
      kind: "SERVICE",
      uomId: uom.id,
      categoryId: null,
      taxCodeId: null,
      costingMethod: "WAC",
      trackBatch: false,
      trackSerial: false,
      trackImei: false,
      hasExpiry: false,
      reorderLevel: null,
      reorderQty: null,
      basePrice: "150.00",
    });
    void item;
    itemSku = "SRV-CONS-01";
    const item2 = await items.create(ownerId, {
      sku: "SRV-AUDIT-02",
      name: "Audit hours",
      nameAr: "ساعات تدقيق",
      kind: "SERVICE",
      uomId: uom.id,
      categoryId: null,
      taxCodeId: null,
      costingMethod: "WAC",
      trackBatch: false,
      trackSerial: false,
      trackImei: false,
      hasExpiry: false,
      reorderLevel: null,
      reorderQty: null,
      basePrice: "90.00",
    });
    void item2;
    itemSku2 = "SRV-AUDIT-02";
  });
}, 240_000);

afterAll(async () => {
  __resetRegistrationLimitersForTests();
  if (app !== undefined) {
    await app.close();
  }
  await stopBoss();
  await closeDb();
});

// ---------------------------------------------------------------------------
describe("acceptance 2 — the seven-kind round-trips (map → dry-run → errors → fix → commit)", () => {
  it("COA: dry-run zero-write proof → typed AR+EN errors → fix → commit → accounts verified", async () => {
    const before = await ledgerSnapshot();
    // The header vocabulary matches the kind's aliases; one row carries a
    // bad type, one a duplicate code, one a missing required name.
    const badFile = await uploadCsv(
      "coa-bad.csv",
      csv(
        ["code", "name", "type", "parent_code", "is_group"],
        [
          ["9001", "Imported Assets Group", "asset", "", "TRUE"],
          ["9002", "Imported Petty Cash", "not-a-type", "9001", "FALSE"],
          ["9003", "", "expense", "9001", "FALSE"],
          ["9002", "Duplicate code", "asset", "9001", "FALSE"],
        ],
      ),
    );
    const job = await createJob({ kind: "COA", fileKey: badFile, columnMap: {
      code: "code", name: "name", type: "type", parent_code: "parent_code", is_group: "is_group",
    } });
    expect(job.status).toBe("PREVIEW_READY");
    const report = reportOfJob(job);
    expect(report.summary.total).toBe(4);
    expect(report.summary.invalid).toBeGreaterThanOrEqual(2);
    expect(report.issues.some((issue) => issue.field === "type" && issue.en !== "" && issue.ar !== "")).toBe(true);
    expect(report.issues.some((issue) => issue.field === "name")).toBe(true);
    // ZERO writes: the whole ledger snapshot is byte-identical.
    expect(await ledgerSnapshot()).toEqual(before);

    // commit without acknowledgement is refused (BR-066 gate).
    await expect(
      withTenant(tenantId, () => toolkit.commit(ownerId, job.id, false)),
    ).rejects.toThrow();

    // Fix the file → clean dry-run → commit through the worker.
    const goodFile = await uploadCsv(
      "coa-good.csv",
      csv(
        ["code", "name", "type", "parent_code", "is_group"],
        [
          ["9001", "Imported Assets Group", "asset", "", "TRUE"],
          ["9002", "Imported Petty Cash", "Bank", "9001", "FALSE"],
          ["9003", "Imported Bank Charges", "fixed asset", "9001", "FALSE"],
        ],
      ),
    );
    const clean = await createJob({ kind: "COA", fileKey: goodFile, columnMap: {
      code: "code", name: "name", type: "type", parent_code: "parent_code", is_group: "is_group",
    } });
    expect(reportOfJob(clean).summary.invalid).toBe(0);
    expect(await ledgerSnapshot()).toEqual(before); // still zero writes
    const committed = await commitAndAwait(clean.id);
    expect(committed.status).toBe("COMMITTED");
    expect(committed.committedRows).toBe(3);
    // Verified effects: the accounts exist, parents resolved, the QuickBooks
    // vocabulary ("Bank") normalized to ASSET.
    const su = await superuserClient();
    const rows = await su.query<{ code: string; type: string; parent: string | null; postable: boolean }>(
      `SELECT a.code, a.type, p.code AS parent, a.is_postable AS postable
         FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id
        WHERE a.tenant_id = $1 AND a.code LIKE '900%' ORDER BY a.code`,
      [tenantId],
    );
    await su.end();
    expect(rows.rows.map((row) => row.code)).toEqual(["9001", "9002", "9003"]);
    expect(rows.rows[1]!.type).toBe("ASSET");
    expect(rows.rows[1]!.parent).toBe("9001");
    expect(rows.rows[0]!.postable).toBe(false); // the group row
  }, 120_000);

  it("ACCOUNT_OPENING_BALANCES: balanced-by-nature file check → opening engine post (acceptance 3)", async () => {
    // An UNbalanced file is refused at the file level (typed, bilingual).
    const unbalanced = await uploadCsv(
      "opening-bad.csv",
      csv(
        ["account_code", "account_name", "debit", "credit", "note"],
        [
          [cashAccountCode, "Cash", "10000.00", "", ""],
          [capitalAccountCode, "Capital", "", "9000.00", ""],
        ],
      ),
    );
    const bad = await createJob({ kind: "ACCOUNT_OPENING_BALANCES", fileKey: unbalanced });
    const badReport = reportOfJob(bad);
    expect(badReport.summary.invalid).toBeGreaterThan(0);
    expect(badReport.issues.some((issue) => issue.ar.includes("متوازن") || issue.en.includes("balanced"))).toBe(true);

    // The balanced file: dry-run (zero writes incl. journals) → commit → drafts.
    const journalsBefore = await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId]);
    const balanced = await uploadCsv(
      "opening-good.csv",
      csv(
        ["account_code", "account_name", "debit", "credit", "note"],
        [
          [cashAccountCode, "Cash", "10000.00", "", "opening import"],
          [capitalAccountCode, "Capital", "", "10000.00", "opening import"],
        ],
      ),
    );
    const job = await createJob({ kind: "ACCOUNT_OPENING_BALANCES", fileKey: balanced });
    expect(reportOfJob(job).summary.invalid).toBe(0);
    expect(await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId])).toBe(journalsBefore);
    const committed = await commitAndAwait(job.id);
    expect(committed.status).toBe("COMMITTED");
    // The import created DRAFT docs — still no journal bypass.
    expect(await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId])).toBe(journalsBefore);
    const docs = await suCount(
      `SELECT * FROM opening_balance_docs WHERE tenant_id = $1 AND kind = 'ACCOUNT'`,
      [tenantId],
    );
    expect(docs).toBe(2);

    // The opening engine post: ONE journal entry, balanced legs (the GL
    // effect lands through PostingService — never raw inserts).
    const posted = await withTenant(tenantId, () => accountingOpening.post(ownerId, fiscalYearId));
    expect(posted.journalEntryId).toEqual(expect.any(String));
    expect(await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId])).toBe(journalsBefore + 1);
    const su = await superuserClient();
    const legs = await su.query<{ direction: string; amount: string }>(
      `SELECT l.direction, l.amount FROM journal_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.tenant_id = $1 AND e.id = $2`,
      [tenantId, posted.journalEntryId],
    );
    await su.end();
    const debit = legs.rows
      .filter((row) => row.direction === "DEBIT")
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const credit = legs.rows
      .filter((row) => row.direction === "CREDIT")
      .reduce((sum, row) => sum + Number(row.amount), 0);
    expect(debit).toBeCloseTo(10000, 4);
    expect(credit).toBeCloseTo(10000, 4);
  }, 120_000);

  it("FIXED_ASSETS: rows land in the asset register with acquisition fields", async () => {
    const badFile = await uploadCsv(
      "assets-bad.csv",
      csv(
        ["code", "name", "name_ar", "category_code", "branch_code", "acquisition_date", "cost", "useful_life_months", "depreciation_method"],
        [
          ["FA-1001", "Laptop batch", "دفعة حواسيب", assetCategoryCode, branchCode, "2026-01-15", "48000.00", "48", "STRAIGHT_LINE"],
          ["FA-1002", "Negative cost", "تكلفة سالبة", assetCategoryCode, branchCode, "2026-01-15", "-5.00", "48", "STRAIGHT_LINE"],
          ["FA-1003", "Bad date", "تاريخ خاطئ", assetCategoryCode, branchCode, "15/01/2026", "1000.00", "48", "STRAIGHT_LINE"],
          ["FA-1004", "Unknown category", "فئة مجهولة", "NOPE", branchCode, "2026-01-15", "1000.00", "48", "STRAIGHT_LINE"],
        ],
      ),
    );
    const bad = await createJob({ kind: "FIXED_ASSETS", fileKey: badFile });
    const badReport = reportOfJob(bad);
    expect(badReport.summary.invalid).toBe(3);
    expect(badReport.issues.some((issue) => issue.field === "cost")).toBe(true);
    expect(badReport.issues.some((issue) => issue.field === "acquisition_date")).toBe(true);
    expect(badReport.issues.some((issue) => issue.field === "category_code")).toBe(true);

    const goodFile = await uploadCsv(
      "assets-good.csv",
      csv(
        ["code", "name", "name_ar", "category_code", "branch_code", "acquisition_date", "cost", "useful_life_months", "depreciation_method"],
        [
          ["FA-1001", "Laptop batch", "دفعة حواسيب", assetCategoryCode, branchCode, "2026-01-15", "48000.00", "48", "STRAIGHT_LINE"],
          ["FA-1002", "Server rack", "خزانة خوادم", assetCategoryCode, branchCode, "2026-02-01", "120000.00", "60", "DECLINING_BALANCE"],
        ],
      ),
    );
    const job = await createJob({ kind: "FIXED_ASSETS", fileKey: goodFile });
    expect(reportOfJob(job).summary.invalid).toBe(0);
    const committed = await commitAndAwait(job.id);
    expect(committed.status).toBe("COMMITTED");
    const su = await superuserClient();
    const rows = await su.query<{ code: string; cost: string; method: string | null }>(
      `SELECT code, cost, depreciation_method AS method FROM assets WHERE tenant_id = $1 AND code LIKE 'FA-10%' ORDER BY code`,
      [tenantId],
    );
    await su.end();
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.cost).toBe("48000.0000");
    expect(rows.rows[1]!.method).toBe("DECLINING_BALANCE");
  }, 120_000);

  it("EMPLOYEES: payroll register rows with bilingual names + bank PII", async () => {
    const badFile = await uploadCsv(
      "employees-bad.csv",
      csv(
        ["code", "name", "hire_date", "contract_type", "basic_salary"],
        [
          ["EMP-001", "Sara Hassan", "2026-01-01", "FULL_TIME", "9000.00"],
          ["EMP-002", "Bad salary", "2026-01-01", "FULL_TIME", "abc"],
          ["EMP-003", "Bad contract", "2026-01-01", "MOONLIGHT", "5000.00"],
        ],
      ),
    );
    const bad = await createJob({ kind: "EMPLOYEES", fileKey: badFile });
    const badReport = reportOfJob(bad);
    expect(badReport.summary.invalid).toBe(2);
    expect(badReport.issues.some((issue) => issue.field === "basic_salary")).toBe(true);
    expect(badReport.issues.some((issue) => issue.field === "contract_type")).toBe(true);

    const goodFile = await uploadCsv(
      "employees-good.csv",
      csv(
        ["code", "name", "name_ar", "hire_date", "contract_type", "basic_salary", "bank_name", "bank_iban"],
        [
          ["EMP-001", "Sara Hassan", "سارة حسن", "2026-01-01", "FULL_TIME", "9000.00", "Al Rajhi", "SA0380000000608010167519"],
          ["EMP-002", "Omar Saleh", "عمر صالح", "2026-02-01", "PART_TIME", "6000.00", "", ""],
        ],
      ),
    );
    const job = await createJob({ kind: "EMPLOYEES", fileKey: goodFile });
    expect(reportOfJob(job).summary.invalid).toBe(0);
    const committed = await commitAndAwait(job.id);
    expect(committed.status).toBe("COMMITTED");
    const su = await superuserClient();
    const rows = await su.query<{ code: string; name_ar: string | null; iban: string | null }>(
      `SELECT code, name_ar, bank_iban AS iban FROM employees WHERE tenant_id = $1 AND code LIKE 'EMP-0%' ORDER BY code`,
      [tenantId],
    );
    await su.end();
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.name_ar).toBe("سارة حسن");
    expect(rows.rows[0]!.iban).toBe("SA0380000000608010167519");
    expect(rows.rows[1]!.iban).toBe(null);
  }, 120_000);

  it("PRICE_LISTS: list-per-code creation + item rows land", async () => {
    const badFile = await uploadCsv(
      "price-bad.csv",
      csv(
        ["list_code", "list_name", "kind", "currency", "item_sku", "uom_code", "unit_price", "min_qty"],
        [
          ["PL-GOLD", "Gold prices", "SALE", "SAR", itemSku, "", "150.00", "1"],
          ["PL-GOLD", "Gold prices", "SALE", "SAR", "NOPE-SKU", "", "200.00", "1"],
        ],
      ),
    );
    const bad = await createJob({ kind: "PRICE_LISTS", fileKey: badFile });
    expect(reportOfJob(bad).summary.invalid).toBe(1);

    const goodFile = await uploadCsv(
      "price-good.csv",
      csv(
        ["list_code", "list_name", "kind", "currency", "item_sku", "uom_code", "unit_price", "min_qty"],
        [
          ["PL-GOLD", "Gold price list", "SALE", "SAR", itemSku, "", "150.00", "1"],
          ["PL-GOLD", "Gold price list", "SALE", "SAR", itemSku2, "", "90.00", "1"],
        ],
      ),
    );
    const job = await createJob({ kind: "PRICE_LISTS", fileKey: goodFile });
    expect(reportOfJob(job).summary.invalid).toBe(0);
    const committed = await commitAndAwait(job.id);
    expect(committed.status).toBe("COMMITTED");
    const su = await superuserClient();
    const lists = await su.query<{ name: string }>(
      `SELECT name FROM price_lists WHERE tenant_id = $1 AND name = 'Gold price list'`,
      [tenantId],
    );
    const rows = await su.query<{ unit_price: string; min_qty: string }>(
      `SELECT r.unit_price, r.min_qty FROM price_list_items r
         JOIN price_lists l ON l.id = r.price_list_id
        WHERE l.tenant_id = $1 AND l.name = 'Gold price list' ORDER BY r.unit_price DESC`,
      [tenantId],
    );
    await su.end();
    expect(lists.rows).toHaveLength(1); // one list for the shared list_code
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.unit_price).toBe("150.000000");
    expect(rows.rows[1]!.unit_price).toBe("90.000000");
  }, 120_000);

  it("CONTRACTS: CRM contracts land against the imported partner", async () => {
    const badFile = await uploadCsv(
      "contracts-bad.csv",
      csv(
        ["partner_code", "title", "fee_model", "start_date", "end_date", "monthly_amount", "fee_item_sku"],
        [
          [partnerCode, "Annual support", "RETAINER", "2026-01-01", "2026-12-31", "25000.00", itemSku],
          [partnerCode, "Bad fee model", "PAY_WHAT_YOU_WANT", "2026-01-01", "2026-12-31", "1000.00", itemSku],
          [partnerCode, "End before start", "RETAINER", "2026-12-31", "2026-01-01", "1000.00", itemSku],
        ],
      ),
    );
    const bad = await createJob({ kind: "CONTRACTS", fileKey: badFile });
    expect(reportOfJob(bad).summary.invalid).toBe(2);

    const goodFile = await uploadCsv(
      "contracts-good.csv",
      csv(
        ["partner_code", "title", "title_ar", "fee_model", "start_date", "end_date", "monthly_amount", "fee_item_sku"],
        [
          [partnerCode, "Annual support", "دعم سنوي", "RETAINER", "2026-01-01", "2026-12-31", "25000.00", itemSku],
        ],
      ),
    );
    const job = await createJob({ kind: "CONTRACTS", fileKey: goodFile });
    expect(reportOfJob(job).summary.invalid).toBe(0);
    const committed = await commitAndAwait(job.id);
    expect(committed.status).toBe("COMMITTED");
    const su = await superuserClient();
    const rows = await su.query<{ title: string; title_ar: string | null }>(
      `SELECT title, title_ar FROM service_contracts WHERE tenant_id = $1 AND title = 'Annual support'`,
      [tenantId],
    );
    await su.end();
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.title_ar).toBe("دعم سنوي");
  }, 120_000);

  it("BUDGETS: the PHASE-028 grid replaces a DRAFT budget whole", async () => {
    // A DRAFT ACCOUNTS-scope budget for FY2026.
    const budget = await withTenant(tenantId, () =>
      budgetVersions.create(
        { fiscalYearId, scope: "ACCOUNTS", name: "Imported budget", nameAr: "موازنة مستوردة" },
        ownerId,
      ),
    );
    // The grid XLSX (3 EN identity columns + the year's period columns).
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Budget");
    sheet.addRow(["Account Code", "Account Name", "Dimension Code", "2026-01", "2026-02"]);
    sheet.addRow([cashAccountCode, "Cash", "", "5000.00", "6000.00"]);
    sheet.addRow([capitalAccountCode, "Capital", "", "1000.00", "1100.00"]);
    const gridBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const gridKey = await files.writeArtifact(tenantId, "import_fixtures", "budget-grid.xlsx", gridBuffer);

    const job = await createJob({
      kind: "BUDGETS",
      fileKey: gridKey,
      format: "XLSX",
      options: { budgetId: budget.id },
    });
    expect(job.status).toBe("PREVIEW_READY");
    const committed = await commitAndAwait(job.id);
    expect(committed.status).toBe("COMMITTED");
    const su = await superuserClient();
    const lines = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM budget_lines WHERE tenant_id = $1 AND budget_id = $2`,
      [tenantId, budget.id],
    );
    await su.end();
    expect(lines.rows[0]!.n).toBe(4); // 2 accounts × 2 periods
  }, 120_000);
});

// ---------------------------------------------------------------------------
describe("acceptance 4 — saved mappings reuse (zero re-mapping on the second file)", () => {
  it("a mapping created for one COA file applies to a second file of the same shape", async () => {
    // Custom (non-alias) headers force an explicit map — the save/reuse path.
    const headers = ["رقز الحساب", "اسم الحساب", "النوع"];
    const firstFile = await uploadCsv(
      "mapped-1.csv",
      csv(headers, [
        ["9101", "Mapped revenue", "income"],
        ["9102", "Mapped expense", "expense"],
      ]),
    );
    const columnMap = { code: headers[0]!, name: headers[1]!, type: headers[2]! };
    const first = await createJob({ kind: "COA", fileKey: firstFile, columnMap });
    expect(reportOfJob(first).summary.invalid).toBe(0);
    expect((await commitAndAwait(first.id)).status).toBe("COMMITTED");

    // Save the mapping (the wizard's step-3 action).
    const saved = await withTenant(tenantId, () =>
      mappings.create(ownerId, {
        name: "Arabic-header COA",
        direction: "IMPORT",
        kind: "COA",
        entity: null,
        columnMap,
        options: null,
      }),
    );

    // The SECOND file — same shape, new data, ONLY the mappingId (no
    // columnMap): zero re-mapping (acceptance 4).
    const secondFile = await uploadCsv(
      "mapped-2.csv",
      csv(headers, [
        ["9103", "Mapped asset", "bank"],
        ["9104", "Mapped liability", "payable"],
      ]),
    );
    const second = await createJob({ kind: "COA", fileKey: secondFile, mappingId: saved.id });
    expect(second.status).toBe("PREVIEW_READY");
    expect(reportOfJob(second).summary.invalid).toBe(0);
    const committed = await commitAndAwait(second.id);
    expect(committed.status).toBe("COMMITTED");
    const su = await superuserClient();
    const rows = await su.query<{ code: string; type: string }>(
      `SELECT code, type FROM accounts WHERE tenant_id = $1 AND code LIKE '910%' ORDER BY code`,
      [tenantId],
    );
    await su.end();
    expect(rows.rows).toHaveLength(4);
    expect(rows.rows[2]!.type).toBe("ASSET"); // "bank" via the saved map + vocabulary
    expect(rows.rows[3]!.type).toBe("LIABILITY");
  }, 120_000);
});

// ---------------------------------------------------------------------------
describe("acceptance 5 — adapter evidence (the documented mappings are the contract)", () => {
  it("the QuickBooks trial-balance fixture imports through its documented columns", async () => {
    const adapter = findAdapter("quickbooks-trial-balance")!;
    expect(adapter.engine).toBe("toolkit");
    // The columnMap handed to the engine: canonical → the SOURCE header,
    // derived from the adapter's DOCUMENTED columns (registry = contract).
    const columnMap: Record<string, string> = {};
    for (const column of adapter.columns) {
      if (column.canonical !== null) {
        columnMap[column.canonical] = column.source;
      }
    }
    const journalsBefore = await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId]);
    const file = await uploadCsv(
      "qb-trial-balance.csv",
      csv(
        adapter.columns.map((column) => column.source),
        [
          ["1112", "Petty cash", "12500.00", ""],
          ["3110", "Owner drawings", "", "12500.00"],
        ],
      ),
    );
    const job = await createJob({
      kind: adapter.targetKind,
      fileKey: file,
      columnMap,
    });
    expect(job.status).toBe("PREVIEW_READY");
    expect(reportOfJob(job).summary.invalid).toBe(0);
    const committed = await commitAndAwait(job.id);
    expect(committed.status).toBe("COMMITTED");
    // Drafts only — the journal count still untouched by the import itself.
    expect(await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId])).toBe(journalsBefore);
  }, 120_000);

  it("the Odoo chart-of-accounts fixture imports through its documented columns", async () => {
    const adapter = findAdapter("odoo-chart-of-accounts")!;
    expect(adapter.engine).toBe("toolkit");
    const columnMap: Record<string, string> = {};
    for (const column of adapter.columns) {
      if (column.canonical !== null) {
        columnMap[column.canonical] = column.source;
      }
    }
    const file = await uploadCsv(
      "odoo-coa.csv",
      csv(
        adapter.columns.map((column) => column.source),
        [
          ["920001", "Odoo bank account", "bank", ""],
          ["920002", "Odoo income", "income", ""],
        ],
      ),
    );
    const job = await createJob({ kind: adapter.targetKind, fileKey: file, columnMap });
    expect(reportOfJob(job).summary.invalid).toBe(0);
    const committed = await commitAndAwait(job.id);
    expect(committed.status).toBe("COMMITTED");
    const su = await superuserClient();
    const rows = await su.query<{ code: string; type: string }>(
      `SELECT code, type FROM accounts WHERE tenant_id = $1 AND code LIKE '920%' ORDER BY code`,
      [tenantId],
    );
    await su.end();
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.type).toBe("ASSET"); // "bank" per the §3 table
    expect(rows.rows[1]!.type).toBe("REVENUE"); // "income" per the §3 table
  }, 120_000);

  it("the adapter registry lists the three sources with downloadable templates", async () => {
    const keys = MIGRATION_ADAPTERS.map((adapter) => adapter.key);
    expect(keys).toContain("quickbooks-chart-of-accounts");
    expect(keys).toContain("odoo-partners");
    expect(keys).toContain("excel-generic-coa");
    for (const adapter of MIGRATION_ADAPTERS) {
      expect(adapter.label.en.length).toBeGreaterThan(0);
      expect(adapter.label.ar.length).toBeGreaterThan(0);
      expect(adapter.columns.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe("acceptance 6 — BR-066 atomicity (interrupted commit → zero partial state → re-run converges)", () => {
  it("a mid-run applier failure rolls everything back; the re-run converges", async () => {
    const employeesBefore = await suCount(`SELECT * FROM employees WHERE tenant_id = $1`, [tenantId]);
    const file = await uploadCsv(
      "employees-atomic.csv",
      csv(
        ["code", "name", "hire_date", "contract_type", "basic_salary"],
        [
          ["EMP-A1", "Atomic One", "2026-03-01", "FULL_TIME", "7000.00"],
          ["EMP-A2", "Atomic Two", "2026-03-01", "FULL_TIME", "7500.00"],
          ["EMP-A3", "Atomic Three", "2026-03-01", "FULL_TIME", "8000.00"],
        ],
      ),
    );
    const job = await createJob({ kind: "EMPLOYEES", fileKey: file });
    expect(reportOfJob(job).summary.invalid).toBe(0);

    // Patch the applier: throw at the 2nd row (a mid-run interruption).
    const original = employees.create.bind(employees);
    let calls = 0;
    (employees as unknown as { create: unknown }).create = async (...args: unknown[]) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("injected mid-run failure (the atomicity probe)");
      }
      return (original as (...a: unknown[]) => Promise<unknown>)(...args);
    };
    let interrupted: JobRow;
    try {
      interrupted = await commitAndAwait(job.id);
    } finally {
      (employees as unknown as { create: unknown }).create = original;
    }
    // The worker rolled back: PREVIEW_READY + the failure recorded.
    expect(interrupted.status).toBe("PREVIEW_READY");
    expect(interrupted.error).toContain("injected mid-run failure");
    // ZERO partial state: no employee rows leaked.
    expect(await suCount(`SELECT * FROM employees WHERE tenant_id = $1`, [tenantId])).toBe(employeesBefore);

    // The re-run converges (the un-patched applier applies all rows).
    const converged = await commitAndAwait(job.id);
    expect(converged.status).toBe("COMMITTED");
    expect(converged.committedRows).toBe(3);
    expect(
      await suCount(`SELECT * FROM employees WHERE tenant_id = $1 AND code LIKE 'EMP-A%'`, [tenantId]),
    ).toBe(3);
  }, 120_000);
});
