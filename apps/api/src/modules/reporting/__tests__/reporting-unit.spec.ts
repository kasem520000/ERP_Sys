import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REPORT_CONTRACTS } from "../registry";
import { registrySnapshot, validateRegistry } from "../registry/runtime";
import { trialBalanceContract } from "../registry/financial/statements";
import { ReportCache } from "../application/cache";
import type { ReportResult } from "../application/contract";
import {
  assertContractPermission,
  intersectBranchScope,
  PermissionDeniedError,
} from "../application/scope";
import {
  assertionStatus,
  assertExact,
  bsCurrentYearOnce,
  cfCashTie,
  glEntryBalance,
  isTbTie,
  ledgerTie,
  tbClosingNetZero,
  tbDebitsEqualCredits,
} from "../application/assertions";
import { amountToWords } from "../application/export/tafqit";
import { renderCsv } from "../application/export/csv";
import { inspectWorkbook, renderXlsx } from "../application/export/xlsx";
import { pageFooterTemplate } from "@erp/ui/print";
import { Semaphore } from "../../../infra/concurrency/semaphore";

/**
 * PHASE-013 unit suite (REPORTING_ARCHITECTURE §2/§6, REPORT_RECONCILIATION
 * §1, PRINTING_AND_EXPORT §2/§4/§5): the registry meta-tests (boot
 * validation failure modes), the report cache (param canonicalization, TTL
 * semantics, event invalidation), scope intersection, the assertion engine,
 * tafqit fixtures, and the CSV/XLSX render contracts — all against pure
 * functions and direct constructions, no database (the statement math and
 * run lifecycle are proven by src/__db__/reporting/).
 */

// The known-permission catalog re-declared from ReportingModule (the boot
// rule asserts registry ↔ seeded-catalog parity; drift must fail here).
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set([
  "reporting.reports.run",
  "reporting.reports.export",
  "reporting.templates.manage",
  "reports.financial.tb.read",
  "reports.financial.gl.read",
  "reports.financial.is.read",
  "reports.financial.bs.read",
  "reports.financial.cf.read",
  "reports.financial.close.read",
  "reports.accounting.cost-centers.read",
  "accounting.journals.read",
  "reports.ar.aging.read",
  "reports.ap.aging.read",
  "sales.statements.read",
  "purchasing.statements.read",
  "reports.ar-alloc.read",
  "partners.balances.read",
  "reports.sales.by-item.read",
  "reports.sales.by-customer.read",
  "reports.sales.by-rep.read",
  "reports.sales.by-paymethod.read",
  "reports.sales.pipeline.read",
  "reports.sales.by-branch.read",
  "reports.sales.profitability.read",
  "reports.purchasing.by-supplier.read",
  "reports.purchasing.by-item.read",
  "reports.purchasing.grni.read",
  "purchasing.po.read",
  "reports.purchasing.matching.read",
  "inventory.stock.read",
  "inventory.moves.read",
  "inventory.valuation.read",
  "inventory.batches.read",
  "inventory.counts.read",
  "inventory.serials.read",
  "treasury.cash.read",
  "treasury.receipts.read",
  "treasury.payments.read",
  "treasury.petty.read",
  "treasury.expenses.read",
  "treasury.shifts.read",
  "treasury.bankrec.read",
  "reports.treasury.fx.read",
  "reports.tax.vat-return.read",
  "reports.tax.summary.read",
  "platform.audit.read",
  "platform.users.read",
  "platform.reporting.read",
  "platform.tenants.read",
  // PHASE-018 (0026 seed): the manufacturing report keys
  "manufacturing.costing.read",
  "manufacturing.genealogy.read",
  "manufacturing.qc.manage",
  // PHASE-019 (0027 seed): the CRM services report key
  "crm.contracts.manage",
  // PHASE-026 (0037 seed): the fixed-assets report keys
  "fixed_assets.reports.view",
  // PHASE-027 (0038 seed): the notes/installments report keys
  "notes.notes.view",
  "installments.plans.view",
  // PHASE-028/029 (0004 pre-seeded §3.13/§3.14, restored lineage): the budgeting/payroll report keys
  "budgeting.reports.view",
  "payroll.reports.view",
  // PHASE-034 (0041 seed): the consolidation report key (§3.15)
  "consolidation.reports.view",
  "consolidation.eliminations.create",
]);

/** A minimal but type-complete stored envelope for cache/CSV/XLSX tests. */
function fakeResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    reportId: "financial.trial-balance",
    contractVersion: 1,
    runId: "018f0000-0000-7000-8000-000000000001",
    paramsEcho: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "en" },
    columns: [
      { id: "accountCode", label: { ar: "رمز الحساب", en: "Account code" }, type: "text" },
      { id: "accountName", label: { ar: "الحساب", en: "Account" }, type: "text" },
      {
        id: "periodDebit",
        label: { ar: "مدين الفترة", en: "Period debit" },
        type: "money",
        numeric: true,
      },
    ],
    groups: [{ key: "ASSET", label: { ar: "الأصول", en: "Assets" } }],
    rows: [
      {
        key: "a1",
        groupKey: "ASSET",
        values: { accountCode: "1111", accountName: 'Acme, "Ltd"', periodDebit: "10500.0000" },
      },
      {
        key: "a2",
        groupKey: "ASSET",
        values: { accountCode: "1130", accountName: "AR control", periodDebit: "1380.0000" },
      },
    ],
    totals: [
      { id: "periodDebit", label: { ar: "إجمالي مدين الفترة", en: "Total period debit" }, amount: "11880.0000", kind: "sum" },
      { id: "periodCredit", label: { ar: "إجمالي دائن الفترة", en: "Total period credit" }, amount: "11880.0000", kind: "check" },
    ],
    assertions: [
      { id: "tb-debits-equal-credits", status: "PASS", compared: { left: "11880.0000", right: "11880.0000" } },
      { id: "tb-closing-net-zero", status: "PASS", compared: { left: "11880.0000", right: "11880.0000" } },
    ],
    freshness: { computedAt: "2026-02-01T10:00:00.000Z", asOf: "2026-02-01T09:00:00.000Z", cacheState: "recomputed" },
    formatting: { baseCurrency: "SAR", numerals: "western", locale: "en" },
    ...overrides,
  };
}

describe("registry meta-tests (boot validation, §2)", () => {
  it("the 85 frozen contracts validate against the known-permission catalog", () => {
    const result = validateRegistry([...REPORT_CONTRACTS], { knownPermissions: KNOWN_PERMISSIONS });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.count).toBe(85);
  });

  it("snapshot exposes id + permission for navigation and includes the trial balance", () => {
    const snapshot = registrySnapshot(REPORT_CONTRACTS);
    expect(snapshot).toHaveLength(85);
    const tb = snapshot.find((row) => row.id === "financial.trial-balance");
    expect(tb).toBeDefined();
    expect(tb!.requiredPermission).toBe("reports.financial.tb.read");
    expect(tb!.version).toBe(1);
    expect(tb!.executionClass).toBe("inline");
  });

  it("a malformed contract (no dataSources) fails validation", () => {
    const malformed = { ...trialBalanceContract, dataSources: [] };
    const result = validateRegistry([malformed], { knownPermissions: KNOWN_PERMISSIONS });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join("; ")).toContain("dataSources");
  });

  it("a duplicate report id fails validation with the duplicate named", () => {
    const result = validateRegistry([trialBalanceContract, { ...trialBalanceContract }], {
      knownPermissions: KNOWN_PERMISSIONS,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("; ")).toContain("duplicate");
    expect(result.errors.join("; ")).toContain("financial.trial-balance");
  });

  it("an unknown required permission fails validation", () => {
    const rogue = { ...trialBalanceContract, requiredPermission: "reports.financial.nope.read" };
    const result = validateRegistry([rogue], { knownPermissions: KNOWN_PERMISSIONS });
    expect(result.ok).toBe(false);
    expect(result.errors.join("; ")).toContain("unknown permission");
    expect(result.errors.join("; ")).toContain("reports.financial.nope.read");
  });

  it("a financial contract missing a §11 minimum assertion fails with the id named", () => {
    const stripped = {
      ...trialBalanceContract,
      assertions: trialBalanceContract.assertions.filter((a) => a.id !== "tb-closing-net-zero"),
    };
    const result = validateRegistry([stripped], { knownPermissions: KNOWN_PERMISSIONS });
    expect(result.ok).toBe(false);
    expect(result.errors.join("; ")).toContain("tb-closing-net-zero");
    expect(result.errors.join("; ")).toContain("§11");
  });
});

describe("report cache (§6)", () => {
  let cache: ReportCache;

  beforeEach(() => {
    cache = new ReportCache();
  });
  afterEach(() => {
    cache.detach();
    vi.useRealTimers();
  });

  it("paramsHash is deterministic regardless of key order (nested too)", () => {
    const left = { a: 1, b: 2, nested: { x: "1.0000", y: [1, 2, { z: 3 }] } };
    const right = { nested: { y: [1, 2, { z: 3 }], x: "1.0000" }, b: 2, a: 1 };
    expect(ReportCache.paramsHash(left)).toBe(ReportCache.paramsHash(right));
    // Different content still hashes differently.
    expect(ReportCache.paramsHash({ a: 1, b: 3 })).not.toBe(ReportCache.paramsHash({ a: 1, b: 2 }));
  });

  it("cacheKey separates tenants for identical report params", () => {
    const parts = {
      reportId: "financial.trial-balance",
      contractVersion: 1,
      params: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "en" },
    };
    const keyA = ReportCache.cacheKey({ tenantId: "tenant-a", ...parts });
    const keyB = ReportCache.cacheKey({ tenantId: "tenant-b", ...parts });
    expect(keyA).not.toBe(keyB);
    // asOf participates in the params hash: current and as-of never share.
    const current = ReportCache.cacheKey({
      tenantId: "tenant-a",
      ...parts,
      params: { ...parts.params, asOf: null },
    });
    const frozen = ReportCache.cacheKey({
      tenantId: "tenant-a",
      ...parts,
      params: { ...parts.params, asOf: "2026-02-01T00:00:00.000Z" },
    });
    expect(current).not.toBe(frozen);
  });

  it("entries expire after their TTL (as-of semantics use the declared TTL)", () => {
    vi.useFakeTimers();
    const key = "k-ttl";
    cache.setForTenant("t1", key, fakeResult(), 50);
    expect(cache.get(key)).toBeDefined();
    vi.advanceTimersByTime(60);
    expect(cache.get(key)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("'current' semantics cap the TTL at 60 s regardless of the declared TTL", () => {
    vi.useFakeTimers();
    const key = "k-current";
    cache.setForTenant("t1", key, fakeResult(), 120_000);
    vi.advanceTimersByTime(50_000);
    expect(cache.get(key, { semantics: "current" })).toBeDefined();
    vi.advanceTimersByTime(11_000); // 61 s total > the 60 s current cap
    expect(cache.get(key, { semantics: "current" })).toBeUndefined();
    // ... while as-of semantics honor the declared 120 s TTL.
    cache.setForTenant("t1", key, fakeResult(), 120_000);
    vi.advanceTimersByTime(61_000);
    expect(cache.get(key, { semantics: "as-of" })).toBeDefined();
    expect(cache.get(key, { semantics: "current" })).toBeUndefined();
  });

  it("cacheTtlSeconds 0 means no caching", () => {
    cache.setForTenant("t1", "k-zero", fakeResult(), 0);
    expect(cache.size).toBe(0);
    expect(cache.get("k-zero")).toBeUndefined();
  });

  it("ledger events drop exactly the affected tenant's entries", () => {
    let listener: ((event: { type: string; tenantId: string }) => void) | undefined;
    cache.attachLedgerEvents((subscribe) => {
      listener = subscribe;
      return () => undefined;
    });
    expect(listener).toBeDefined();
    cache.setForTenant("t1", "k1", fakeResult(), 60_000);
    cache.setForTenant("t1", "k2", fakeResult(), 60_000);
    cache.setForTenant("t2", "k3", fakeResult(), 60_000);
    expect(cache.size).toBe(3);
    listener!({ type: "journal.posted", tenantId: "t1" });
    expect(cache.size).toBe(1);
    expect(cache.get("k3")).toBeDefined();
    listener!({ type: "period.locked", tenantId: "t2" });
    expect(cache.size).toBe(0);
  });

  it("invalidateTenantEntries returns the dropped count", () => {
    cache.setForTenant("t1", "k1", fakeResult(), 60_000);
    cache.setForTenant("t1", "k2", fakeResult(), 60_000);
    cache.setForTenant("t2", "k3", fakeResult(), 60_000);
    expect(cache.invalidateTenantEntries("t1")).toBe(2);
    expect(cache.size).toBe(1);
  });
});

describe("scope intersection (§5)", () => {
  it("tenant-wide grants scope down to the requested branches without narrowing", () => {
    const scope = intersectBranchScope({ effectiveBranchIds: null }, { branchIds: ["a"] });
    expect(scope.branchIds).toEqual(["a"]);
    expect(scope.narrowed).toBe(false);
  });

  it("a branch-scoped user requesting all branches is intersected down to the grants", () => {
    const scope = intersectBranchScope({ effectiveBranchIds: ["a", "b"] }, { branchIds: undefined });
    expect(scope.branchIds).toEqual(["a", "b"]);
    expect(scope.narrowed).toBe(true);
  });

  it("a request beyond the grants is narrowed to the intersection", () => {
    const scope = intersectBranchScope({ effectiveBranchIds: ["a"] }, { branchIds: ["a", "c"] });
    expect(scope.branchIds).toEqual(["a"]);
    expect(scope.narrowed).toBe(true);
  });

  it("assertContractPermission denies without the grant and passes with it", () => {
    const ctx = {
      tenantId: "t1",
      userId: null,
      effectiveBranchIds: null,
      baseCurrency: "SAR",
      permissions: new Set<string>(),
    };
    expect(() => assertContractPermission(trialBalanceContract, ctx)).toThrowError(PermissionDeniedError);
    expect(() => assertContractPermission(trialBalanceContract, ctx)).toThrowError(
      /reports\.financial\.tb\.read/,
    );
    assertContractPermission(trialBalanceContract, {
      ...ctx,
      permissions: new Set(["reports.financial.tb.read"]),
    });
  });
});

describe("assertion engine (§1 — exact-decimal, tolerance 0)", () => {
  it("assertExact passes on exact equality and carries the compared values", () => {
    const pass = assertExact("check-x", "1.0000", "1.0000");
    expect(pass.status).toBe("PASS");
    expect(pass.compared).toEqual({ left: "1.0000", right: "1.0000" });
  });

  it("assertExact fails on any drift with the compared values persisted", () => {
    const fail = assertExact("check-x", "1.0000", "1.0001");
    expect(fail.status).toBe("FAIL");
    expect(fail.compared).toEqual({ left: "1.0000", right: "1.0001" });
  });

  it("assertionStatus aggregates: one FAIL makes the run FAIL", () => {
    expect(assertionStatus([{ id: "a", status: "PASS" }])).toBe("PASS");
    expect(assertionStatus([])).toBe("PASS");
    expect(
      assertionStatus([
        { id: "a", status: "PASS" },
        { id: "b", status: "FAIL" },
      ]),
    ).toBe("FAIL");
  });

  it("tb assertions compare the declared totals with the stable ids", () => {
    expect(tbDebitsEqualCredits("11880.0000", "11880.0000")).toMatchObject({
      id: "tb-debits-equal-credits",
      status: "PASS",
    });
    expect(tbDebitsEqualCredits("11880.0000", "11881.0000").status).toBe("FAIL");
    expect(tbClosingNetZero("0.0000", "0.0000")).toMatchObject({
      id: "tb-closing-net-zero",
      status: "PASS",
    });
    expect(tbClosingNetZero("10.0000", "0.0000").status).toBe("FAIL");
  });

  it("glEntryBalance passes on an empty unbalanced set and names the offenders otherwise", () => {
    const pass = glEntryBalance([]);
    expect(pass.id).toBe("gl-entry-balance");
    expect(pass.status).toBe("PASS");
    expect(pass.compared!.right).toBe("0.0000");
    const fail = glEntryBalance([{ entryNo: "JE-2026-000009", net: "5.0000" }]);
    expect(fail.status).toBe("FAIL");
    expect(fail.compared!.right).toContain("JE-2026-000009");
    expect(fail.detail!.en).toContain("Unbalanced entries: 1");
  });

  it("bsCurrentYearOnce composes closing + YTD and compares to the presented line", () => {
    expect(bsCurrentYearOnce("900.0000", "0.0000", "900.0000")).toMatchObject({
      id: "bs-current-year-once",
      status: "PASS",
    });
    expect(bsCurrentYearOnce("900.0000", "900.0000", "0.0000").status).toBe("PASS");
    expect(bsCurrentYearOnce("900.0000", "0.0000", "800.0000").status).toBe("FAIL");
  });

  it("isTbTie / cfCashTie / ledgerTie keep their §11 identities", () => {
    expect(
      isTbTie(
        [
          { id: "netRevenue", amount: "1200.0000" },
          { id: "expenses-total", amount: "300.0000" },
        ],
        [
          { id: "netRevenue", amount: "1200.0000" },
          { id: "expenses-total", amount: "300.0000" },
        ],
      ).status,
    ).toBe("PASS");
    expect(
      isTbTie(
        [
          { id: "netRevenue", amount: "1200.0000" },
          { id: "expenses-total", amount: "300.0000" },
        ],
        [
          { id: "netRevenue", amount: "1200.0000" },
          { id: "expenses-total", amount: "299.0000" },
        ],
      ).status,
    ).toBe("FAIL");
    expect(cfCashTie("10200.0000", "10200.0000")).toMatchObject({ id: "cf-cash-tie", status: "PASS" });
    expect(ledgerTie("ar-aging-total", "1000.0000", "1000.0000")).toMatchObject({
      id: "ar-aging-total",
      status: "PASS",
    });
  });
});

describe("tafqit fixtures (PRINTING_AND_EXPORT §2)", () => {
  it("SAR zero renders the canonical zero phrase", () => {
    expect(amountToWords("0.0000", "SAR", "ar")).toBe("صفر ريال سعودي");
  });

  it("SAR 12,500 — the documented example — reads ألفاً وخمسمائة مع المفرد", () => {
    // The docstring example: "اثنا عشر ألفاً وخمسمائة ريال سعودي" — hundreds
    // end the number, so the counted noun stays singular.
    expect(amountToWords("12500.0000", "SAR", "ar")).toBe("اثنا عشر ألفاً وخمسمائة ريال سعودي");
  });

  it("SAR 2,000.50 — dual thousands, 11–99 minor takes the singular هللة", () => {
    const words = amountToWords("2000.5000", "SAR", "ar");
    expect(words).toContain("ألفان");
    expect(words).toContain("ريال سعودي");
    expect(words).toContain("خمسون هللة");
    expect(words).not.toContain("هللات");
  });

  it("KWD 1.234 — 3-dp minor unit, noun-first singular major, singular فلس after 234", () => {
    const words = amountToWords("1.234", "KWD", "ar");
    expect(words).toContain("دينار كويتي واحد");
    expect(words).toContain("مائتان وأربعة وثلاثون فلس");
    expect(words).not.toContain("فلوس");
  });

  it("BHD 2.500 — the dual major form, hundreds-singular minor", () => {
    expect(amountToWords("2.500", "BHD", "ar")).toBe("ديناران بحرينيان وخمسمائة فلس");
  });

  it("OMR 10.250 — 3–10 takes the plural major, 250 takes the singular minor", () => {
    expect(amountToWords("10.250", "OMR", "ar")).toBe("عشرة ريالات عمانية ومائتان وخمسون بيسة");
  });

  it("SAR 15 — 11–99 keeps the accusative singular the original engine got right", () => {
    expect(amountToWords("15.0000", "SAR", "ar")).toBe("خمسة عشر ريالاً سعودياً");
  });

  it("SAR 3.05 — plural major and plural minor for the 3–10 band", () => {
    expect(amountToWords("3.0500", "SAR", "ar")).toBe("ثلاثة ريالات سعودية وخمس هللات");
  });

  it("negative amounts carry the سالب prefix with the same agreement", () => {
    const words = amountToWords("-125.5000", "SAR", "ar");
    expect(words.startsWith("سالب ")).toBe(true);
    expect(words).toContain("مائة وخمسة وعشرون ريالاً سعودياً");
    expect(words).toContain("خمسون هللة");
  });

  it("USD 100.25 in English", () => {
    expect(amountToWords("100.25", "USD", "en")).toBe("one hundred US dollars and twenty-five cents");
  });

  it("EUR 3.07 in English", () => {
    expect(amountToWords("3.07", "EUR", "en")).toBe("three euros and seven cents");
  });

  it("USD zero in English", () => {
    expect(amountToWords("0.00", "USD", "en")).toBe("zero US dollars");
  });
});

describe("CSV export contract (§5)", () => {
  it("renders UTF-8 BOM + locale header + RFC4180 quoting + CRLF + assertion footer", () => {
    const csv = renderCsv(fakeResult());
    const bytes = [...csv];
    expect(bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]); // BOM (Excel Arabic)
    const text = csv.toString("utf8").slice(1); // strip the BOM for content checks
    // CRLF line endings everywhere.
    expect(text).toContain("\r\n");
    expect(text.split("\r\n")[0]).toBe("Account code,Account,Period debit");
    // RFC4180: the embedded comma/quote value is quoted with doubled quotes.
    expect(text).toContain('"Acme, ""Ltd"""');
    // Totals block then the self-describing footer with assertion ids.
    expect(text).toContain("Total period debit,11880.0000");
    expect(text).toContain("tb-debits-equal-credits,PASS");
    expect(text).toContain("tb-closing-net-zero,PASS");
    expect(text).toContain("as of,2026-02-01T09:00:00.000Z");
    expect(text).toContain("computed at,2026-02-01T10:00:00.000Z");
  });

  it("the header row follows the run locale", () => {
    const csv = renderCsv(
      fakeResult({ formatting: { baseCurrency: "SAR", numerals: "western", locale: "ar" } }),
    );
    const header = csv.toString("utf8").slice(1).split("\r\n")[0]!;
    expect(header).toBe("رمز الحساب,الحساب,مدين الفترة");
  });
});

describe("XLSX export contract (§4)", () => {
  it("locale ar → RTL sheet view, no formulas, single Report sheet", async () => {
    const buffer = await renderXlsx(
      fakeResult({ formatting: { baseCurrency: "SAR", numerals: "western", locale: "ar" } }),
    );
    const workbook = await inspectWorkbook(buffer);
    expect(workbook.rightToLeft).toBe(true);
    expect(workbook.formulas).toEqual([]);
    expect(workbook.sheetNames).toEqual(["Report"]);
  });

  it("locale en → LTR sheet view", async () => {
    const buffer = await renderXlsx(fakeResult());
    const workbook = await inspectWorkbook(buffer);
    expect(workbook.rightToLeft).toBe(false);
    expect(workbook.formulas).toEqual([]);
  });
});

describe("render pool + footer furniture (§3)", () => {
  it("the semaphore bounds concurrency at max and releases waiters in order", async () => {
    const semaphore = new Semaphore(2);
    const release1 = await semaphore.acquire();
    const release2 = await semaphore.acquire();
    expect(semaphore.inUse).toBe(2);
    let thirdAcquired = false;
    const third = semaphore.acquire().then((release) => {
      thirdAcquired = true;
      return release;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(thirdAcquired).toBe(false); // still waiting — the pool is full
    release1();
    const release3 = await third;
    expect(thirdAcquired).toBe(true);
    expect(semaphore.inUse).toBe(2); // the waiter took the freed slot
    release2();
    release3();
    expect(semaphore.inUse).toBe(0);
  });

  it("the Chromium footer template carries the page-number placeholders per locale", () => {
    const ar = pageFooterTemplate("ar");
    expect(ar).toContain("صفحة");
    expect(ar).toContain('class="pageNumber"');
    expect(ar).toContain('class="totalPages"');
    const en = pageFooterTemplate("en");
    expect(en).toContain("Page");
    expect(en).toContain('class="pageNumber"');
  });
});
