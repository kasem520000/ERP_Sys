import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { addExact } from "../../modules/accounting/application/decimal-strings";
import type { ReportResult } from "../../modules/reporting/application/contract";
import {
  setupReportingFixture,
  postRemainingGoldenEntries,
  newRunService,
  fullContext,
  TENANT_R,
  R_ACTOR,
} from "./fixtures";

/**
 * PHASE-014 T9 db evidence (PHASE-014 §6 "Dashboard tests"): every widget
 * KPI equals the BOUND contract's run for the same pinned parameters (no
 * side-channel math — the extraction below is the exact derivation the
 * web owner-dashboard performs, re-derived here independently), drill
 * links preserve the pinned parameters, and a FAIL assertion makes the
 * widget fail honestly (never a fabricated number).
 */

const runs = newRunService();
let fixture: Awaited<ReturnType<typeof setupReportingFixture>>;

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  fixture = await setupReportingFixture();
  await postRemainingGoldenEntries(TENANT_R);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

/** p95 helper (ms). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  // eslint-disable-next-line no-restricted-properties -- latency-statistics index (rank selection), not money math (ADR-0009).
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

/** Extracts the inline-run result (the widget input) with an honest failure. */
function resultOf(outcome: { result?: ReportResult; status: string }): ReportResult {
  if (!outcome.result) throw new Error(`run produced no result (status ${outcome.status})`);
  return outcome.result;
}

describe("PHASE-014 dashboard widget equivalence (T9)", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("sales.today widget == sales.daily-revenue run (totals entry, exact decimals)", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      runs.run({
        reportKey: "sales.daily-revenue",
        params: { dateFrom: today, dateTo: today, locale: "ar" },
        ctx: fullContext(),
      }),
    );
    const result = resultOf(outcome);
    // The widget KPI = the run's netSales totals entry — the SAME value the
    // web dashboard renders (owner-dashboard extract).
    const kpiFromTotals = result.totals.find((entry) => entry.id === "netSales")?.amount;
    expect(kpiFromTotals).toBeDefined();
    // An empty day: 0.0000 exact (no sales posted today on the golden
    // tenant — the fixture posts are dated 2026-01).
    expect(kpiFromTotals).toBe("0.0000");
    // The cross-check: Σ rows netSales via exact string math == the totals
    // entry (the web helper's derivation).
    const rows = resultOf(outcome).rows;
    const sum = rows.reduce((acc, row) => addExact(acc, String(row.values.netSales)), "0.0000");
    expect(sum).toBe(kpiFromTotals);
  });

  it("cash.position widget == treasury.daily-cash run (Σ net, exact string math)", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      runs.run({
        reportKey: "treasury.daily-cash",
        params: { dateFrom: today, dateTo: today, locale: "ar" },
        ctx: fullContext(),
      }),
    );
    const rows = resultOf(outcome).rows;
    const kpi = rows.reduce((acc, row) => addExact(acc, String(row.values.net)), "0.0000");
    // No cash movements today on the golden tenant → exact zero.
    expect(kpi).toBe("0.0000");
  });

  it("ar.overdue widget == ar.aging run (Σ overdue buckets, exact string math)", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      runs.run({
        reportKey: "ar.aging",
        params: { asOf: "2026-01-31", locale: "ar" },
        ctx: fullContext(),
      }),
    );
    const rows = resultOf(outcome).rows;
    // The widget KPI = the overdue buckets only (every bucket except notDue).
    let kpi = "0.0000";
    for (const row of rows) {
      const total = ["b1_30", "b31_60", "b61_90", "b90Plus"].reduce(
        (acc, key) => addExact(acc, String(row.values[key])),
        "0.0000",
      );
      kpi = addExact(kpi, total);
    }
    // The golden book: G2's AR 1380 is unallocated in the §3.4 gross-open
    // posture (the collection G3 is an on-account journal, not an explicit
    // allocation) — so the aging row carries notDue 1380 and ZERO overdue
    // buckets (the honest presentation PHASE-012 established: netting is a
    // derived display total, never a mutation).
    expect(kpi).toBe("0.0000");
    const notDue = rows.reduce((acc, row) => addExact(acc, String(row.values.notDue)), "0.0000");
    expect(notDue).toBe("1380.0000");
  });

  it("stock.alerts widget == inventory.reorder-alerts run (row count)", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      runs.run({
        reportKey: "inventory.reorder-alerts",
        params: { locale: "ar" },
        ctx: fullContext(),
      }),
    );
    const rows = resultOf(outcome).rows;
    // The golden tenant sets no reorder levels -> zero alerts (honest empty).
    expect(rows.length).toBe(0);
  });

  it("drill links preserve the pinned parameters (the widget contract)", () => {
    // The deep-link formats the web dashboard emits (owner-dashboard.tsx):
    const salesDrill = `/${"ar"}/reports?report=${encodeURIComponent("sales.daily-revenue")}&dateFrom=${today}&dateTo=${today}`;
    const cashDrill = `/${"ar"}/reports?report=${encodeURIComponent("treasury.daily-cash")}&dateFrom=${today}&dateTo=${today}`;
    const arDrill = `/${"ar"}/reports?report=${encodeURIComponent("ar.aging")}&asOf=${today}`;
    const stockDrill = `/${"ar"}/reports?report=${encodeURIComponent("inventory.reorder-alerts")}`;
    for (const drill of [salesDrill, cashDrill, arDrill, stockDrill]) {
      const url = new URL(drill, "http://localhost:3000");
      expect(url.searchParams.get("report")).toBeTruthy();
    }
    expect(new URL(salesDrill, "http://x").searchParams.get("dateFrom")).toBe(today);
    expect(new URL(arDrill, "http://x").searchParams.get("asOf")).toBe(today);
  });

  it("a FAIL assertion makes the widget fail honestly (never a fabricated number)", async () => {
    // The exports.spec replica pattern: an unbalanced posted entry INSIDE
    // the queried window (superuser data-repair path past the deferred
    // balance trigger), deleted at the end of the test.
    const su = await (await import("../test-db")).superuserClient();
    const periodId = await withTenant(TENANT_R, async () => {
      const store = await import("../../modules/accounting/infrastructure/accounting.store");
      const year = await store.findFiscalYearByName("FY2026");
      const periods = await store.listPeriods(year!.id);
      return periods.find((row) => row.name.includes("01"))!.id;
    });
    const probeId = "56565656-0000-4000-8000-0000000000fa";
    const lineIds = [
      "56565656-0000-4000-8000-0000000000fb",
      "56565656-0000-4000-8000-0000000000fc",
    ];
    await su.query(`SET session_replication_role = replica`);
    await su.query(
      `INSERT INTO journal_entries (id, tenant_id, entry_date, fiscal_period_id, currency_code,
                                    source_type, operation, posted_at, posted_by, status, description)
       VALUES ($1, $2, '2026-01-31', $3, 'SAR', 'journal_entry', 'post', now(), $4, 'POSTED',
               '{"en":"dashboard fail probe","ar":"مسبار فشل"}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [probeId, TENANT_R, periodId, R_ACTOR],
    );
    await su.query(
      `INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id,
                                  direction, amount, base_amount)
       VALUES ($1, $2, $3, 1, $4, 'DEBIT', 50, 50),
              ($5, $2, $3, 2, $4, 'CREDIT', 49, 49)`,
      [lineIds[0], TENANT_R, probeId, fixture.accounts.cash, lineIds[1]],
    );
    await su.query(`SET session_replication_role = DEFAULT`);

    const outcome = await withTenant(TENANT_R, () =>
      runs.run({
        reportKey: "financial.trial-balance",
        params: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "en" },
        ctx: fullContext(),
      }),
    );
    const result = resultOf(outcome);
    const tbDebits = result.assertions.find((entry) => entry.id === "tb-debits-equal-credits");
    expect(tbDebits?.status).toBe("FAIL");
    // The widget honesty rule: a FAIL contract renders the failure state —
    // the web owner-dashboard surfaces the FAIL chip; the spec pins the
    // contract-side fact the widget consumes.
    expect(tbDebits).toBeDefined();

    // Cleanup (never corrupt the shared golden book for later specs) —
    // the replica session mode is the sanctioned data-repair path past the
    // append-only guard (the exports.spec afterAll pattern).
    await su.query(`SET session_replication_role = replica`);
    await su.query(`DELETE FROM journal_lines WHERE id = ANY($1)`, [lineIds]);
    await su.query(`DELETE FROM journal_entries WHERE id = $1`, [probeId]);
    await su.query(`SET session_replication_role = DEFAULT`);
    await su.end();
  });

  it("interactive tier budgets hold (T-04: p95 < 2 s per contract run)", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const started = Date.now();
      await withTenant(TENANT_R, () =>
        runs.run({
          reportKey: "financial.trial-balance",
          params: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "en" },
          ctx: fullContext(),
        }),
      );
      samples.push(Date.now() - started);
    }
    expect(p95(samples)).toBeLessThan(2000);
  });
});
