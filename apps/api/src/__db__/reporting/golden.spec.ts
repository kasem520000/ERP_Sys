import { beforeAll, describe, expect, it } from "vitest";

import {
  fullContext,
  newRunService,
  postRemainingGoldenEntries,
  setupReportingFixture,
  TENANT_R,
  withTenant,
  type ReportingFixture,
} from "./fixtures";
import { registrySnapshot } from "../../modules/reporting/registry";
import type { ReportResult } from "../../modules/reporting/application/contract";

/**
 * PHASE-013 reporting golden tests (REPORTING_ARCHITECTURE §7;
 * FINANCIAL_REPORT_RULES §1–§11): the four statements over the pinned
 * four-entry golden book — every §11 assertion PASSes, the exact-decimal
 * figures pin (AR 880, net income 900, BS difference 0, Δ cash 10200), the
 * registry snapshot stays at 76 (50 core + 18 industry + 3 fixed-assets + 5
 * notes/installments, PHASE-027), and two runs at a
 * fixed asOf produce byte-identical rows/totals/assertions
 * (REPORT_RECONCILIATION §2 reproducibility).
 */

let fx: ReportingFixture;

beforeAll(async () => {
  fx = await setupReportingFixture();
  // Complete the golden book (idempotent fixed source keys — replay no-op).
  await postRemainingGoldenEntries(TENANT_R);
});

function runReport(
  reportKey: string,
  params: Record<string, unknown>,
): Promise<{ runId: string; result?: ReportResult; status: string }> {
  return withTenant(TENANT_R, () =>
    newRunService().run({ reportKey, params, ctx: fullContext() }),
  );
}

describe("trial balance golden (§2 + §11)", () => {
  it("all assertions PASS; AR closes at 880; period debit == credit", async () => {
    const outcome = await runReport("financial.trial-balance", {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.rows.length).toBeGreaterThan(0);
    for (const assertion of result.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
    expect(result.assertions.map((a) => a.id).sort()).toEqual([
      "tb-closing-net-zero",
      "tb-debits-equal-credits",
    ]);

    // AR control (1130): 1380 debited, 500 collected → closing debit 880.
    const arRow = result.rows.find((row) => row.key === fx.accounts.arControl);
    expect(arRow).toBeDefined();
    expect(arRow!.values.closingDebit).toBe("880.0000");
    expect(arRow!.values.closingCredit).toBe("0.0000");

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("periodDebit")).toBe("12180.0000");
    expect(totals.get("periodCredit")).toBe("12180.0000");
    expect(totals.get("closingDebit")).toBe("11380.0000");
    expect(totals.get("closingCredit")).toBe("11380.0000");
  });
});

describe("income statement golden (§3 + §11)", () => {
  it("net income 1200 − 300 = 900 with both cross-statement ties PASS", async () => {
    const outcome = await runReport("financial.income-statement", {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      locale: "en",
    });
    const result = outcome.result!;
    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("netRevenue")).toBe("1200.0000");
    expect(totals.get("grossProfit")).toBe("1200.0000"); // no COGS in the golden book
    expect(totals.get("netIncome")).toBe("900.0000");
    expect(totals.get("ytdNetIncome")).toBe("900.0000");
    expect(result.assertions.find((a) => a.id === "is-tb-tie")?.status).toBe("PASS");
    expect(result.assertions.find((a) => a.id === "is-net-equals-bs-current-result")?.status).toBe(
      "PASS",
    );
  });
});

describe("balance sheet golden (§4 + §11)", () => {
  it("assets 11080 = liabilities 180 + equity 10900; difference exactly zero", async () => {
    const outcome = await runReport("financial.balance-sheet", {
      asOfDate: "2026-01-31",
      locale: "en",
    });
    const result = outcome.result!;
    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("totalAssets")).toBe("11080.0000");
    expect(totals.get("totalLiabilities")).toBe("180.0000");
    expect(totals.get("totalEquity")).toBe("10900.0000");
    expect(totals.get("balanceCheck")).toBe("0.0000");
    for (const assertion of result.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
    expect(result.assertions.find((a) => a.id === "bs-current-year-once")?.status).toBe("PASS");
    // The current-year line is presented exactly once (900, composed of a
    // zero closing component + the live YTD component).
    const currentYearRow = result.rows.find((row) => row.key === "equity:current-year");
    expect(currentYearRow?.values.amount).toBe("900.0000");
  });
});

describe("cash flow golden (§5 + INV-019)", () => {
  it("computed net change ties to the actual Δ cash (10200)", async () => {
    const outcome = await runReport("financial.cash-flow", {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      locale: "en",
    });
    const result = outcome.result!;
    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("computedChange")).toBe("10200.0000");
    expect(totals.get("actualCashDelta")).toBe("10200.0000");
    expect(totals.get("cashTie")).toBe("0.0000");
    const tie = result.assertions.find((a) => a.id === "cf-cash-tie");
    expect(tie?.status).toBe("PASS");
    expect(tie?.compared).toEqual({ left: "10200.0000", right: "10200.0000" });
  });
});

describe("registry snapshot", () => {
  it("exposes exactly the 81 frozen contracts (50 core + 18 industry + 3 fixed assets + 5 notes/installments + 2 budgeting + 3 payroll)", () => {
    const snapshot = registrySnapshot(newRunService().contracts());
    expect(snapshot).toHaveLength(81);
    const ids = new Set(snapshot.map((row) => row.id));
    expect(ids.size).toBe(81);
  });
});

describe("reproducibility (REPORT_RECONCILIATION §2)", () => {
  it("two runs at a fixed asOf are byte-identical in rows, totals and assertions", async () => {
    const asOf = new Date(Date.now() + 60_000).toISOString(); // safely after every posting
    const params = { dateFrom: "2026-01-01", dateTo: "2026-01-31", asOf, locale: "en" };
    // Fresh RunService per run → both executions recompute (no cache carry).
    const first = (await runReport("financial.trial-balance", params)).result!;
    const second = (await runReport("financial.trial-balance", params)).result!;
    expect(second.freshness.asOf).toBe(asOf);
    expect(JSON.stringify(second.rows)).toBe(JSON.stringify(first.rows));
    expect(JSON.stringify(second.totals)).toBe(JSON.stringify(first.totals));
    expect(JSON.stringify(second.assertions)).toBe(JSON.stringify(first.assertions));
    expect(JSON.stringify(second.groups)).toBe(JSON.stringify(first.groups));
    // The envelope's echo carries the frozen asOf — deterministic too.
    expect(JSON.stringify(second.paramsEcho)).toBe(JSON.stringify(first.paramsEcho));
  });
});
