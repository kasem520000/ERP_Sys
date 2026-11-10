import { beforeAll, describe, expect, it } from "vitest";

import {
  fakeResult,
  fullContext,
  newRunService,
  postRemainingGoldenEntries,
  setupAsOfFixture,
  TENANT_R,
  TENANT_R_ASOF,
  withTenant,
  type ReportingFixture,
} from "./fixtures";
import { publishLedgerEvent } from "../../modules/accounting/application/ledger-events";
import type { ReportResult } from "../../modules/reporting/application/contract";

/**
 * PHASE-013 as-of semantics (REPORTING_ARCHITECTURE §6; REPORT_CONTRACT §3):
 * a run frozen at asOf=T re-reads immutable posted history — entries dated
 * inside the window but POSTED after T are invisible to it, byte-identically
 * across re-runs, while the "current" view (no asOf) sees them. Plus the
 * cache-invalidation contract: journal.posted/period.locked events drop the
 * affected tenant's cached entries through the RunService's constructor-wired
 * subscription.
 *
 * Runs on the clone tenant R_ASOF (own posting timeline): the freeze cut-off
 * is taken between the fixture's G1/G2 and this spec's own G3/G4 postings,
 * so no other spec file's execution order can shift the boundary.
 */

let fx: ReportingFixture;

beforeAll(async () => {
  fx = await setupAsOfFixture(); // G1 + G2 only, posted at setup time
});

function runTB(asOf: string | undefined): Promise<ReportResult> {
  const params: Record<string, unknown> = {
    dateFrom: "2026-01-01",
    dateTo: "2026-01-31",
    locale: "en",
  };
  if (asOf !== undefined) {
    params.asOf = asOf;
  }
  return withTenant(TENANT_R_ASOF, async () => {
    const outcome = await newRunService().run({
      reportKey: "financial.trial-balance",
      params,
      ctx: fullContext(TENANT_R_ASOF),
    });
    expect(outcome.status).toBe("SUCCEEDED");
    return outcome.result!;
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("as-of freeze (posted_at cutoff)", () => {
  it("entries posted AFTER the freeze never leak into the as-of snapshot", async () => {
    // T sits 1 s in the future: G1/G2 (setup-time posted_at) are inside,
    // and the G3/G4 postings below happen strictly after T (we wait past it).
    const frozenAt = new Date(Date.now() + 1_000).toISOString();
    const snapshot = await runTB(frozenAt);

    // The frozen book at T: capital 10000 + credit sale (AR 1380 / rev 1200 / VAT 180).
    const arRow = snapshot.rows.find((row) => row.key === fx.accounts.arControl);
    expect(arRow?.values.closingDebit).toBe("1380.0000");
    const totals = new Map(snapshot.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("periodDebit")).toBe("11380.0000");
    expect(totals.get("periodCredit")).toBe("11380.0000");
    for (const assertion of snapshot.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }

    // Post the January-dated collection + rent AFTER the freeze point.
    await sleep(1_200); // now() > frozenAt guaranteed for posted_at
    await postRemainingGoldenEntries(TENANT_R_ASOF);

    // Same params, fresh RunService (a genuinely recomputed read): the
    // as-of snapshot is byte-identical despite the late postings.
    const rerun = await runTB(frozenAt);
    expect(JSON.stringify(rerun.rows)).toBe(JSON.stringify(snapshot.rows));
    expect(JSON.stringify(rerun.totals)).toBe(JSON.stringify(snapshot.totals));
    expect(JSON.stringify(rerun.assertions)).toBe(JSON.stringify(snapshot.assertions));

    // The current view (no asOf) sees them: AR now 880, cash 10200.
    const current = await runTB(undefined);
    const currentAr = current.rows.find((row) => row.key === fx.accounts.arControl);
    expect(currentAr?.values.closingDebit).toBe("880.0000");
    const currentTotals = new Map(current.totals.map((total) => [total.id, total.amount]));
    expect(currentTotals.get("periodDebit")).toBe("12180.0000");
    expect(JSON.stringify(current.rows)).not.toBe(JSON.stringify(snapshot.rows));
    for (const assertion of current.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
  });
});

describe("cache invalidation via ledger events (§6.3)", () => {
  it("journal.posted / period.locked events drop exactly the affected tenant's entries", async () => {
    const runs = newRunService(); // constructor wires cache.attachLedgerEvents(onLedgerEvent)
    runs.cache.setForTenant(TENANT_R, "r-asof-key-1", fakeResult(), 60_000);
    runs.cache.setForTenant(TENANT_R_ASOF, "r-asof-key-2", fakeResult(), 60_000);
    expect(runs.cache.size).toBe(2);

    publishLedgerEvent({ type: "journal.posted", tenantId: TENANT_R });
    expect(runs.cache.size).toBe(1);
    expect(runs.cache.get("r-asof-key-2")).toBeDefined();

    publishLedgerEvent({ type: "period.locked", tenantId: TENANT_R_ASOF });
    expect(runs.cache.size).toBe(0);
  });
});
