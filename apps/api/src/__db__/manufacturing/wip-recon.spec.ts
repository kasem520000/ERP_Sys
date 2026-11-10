import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { JournalService } from "../../modules/accounting/application/journal-service";
import { ReconciliationService } from "../../modules/accounting/application/reconciliation-service";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import {
  M_ACTOR,
  TENANT_M,
  mPosting,
  periods,
  setupMfgFixture,
  wipReconciliation,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-018 T38b-ii — the WIP↔GL reconciliation spec (MASTER-PLAN §11; the
 * INV-010 manufacturing extension; RECONCILIATION §1): the golden-chain green
 * path (the chain nets the WIP GL balance to EXACTLY zero — every journal on
 * the WIP account belongs to a production order and every order's balance is
 * zero after completion), the seeded-drift proof (a MANUAL JOURNAL on the WIP
 * account with no producing order → BROKEN with the orphan in the diff, the
 * audit event, the inbox notification, and the PC-04 lock block), the
 * PERIOD_LOCKED interplay (the run records on a locked period — a read, not
 * a posting), and the zero-activity NOT_APPLICABLE branch of the live
 * `reconciliation.wip` checklist row.
 *
 * Drift-seeding technique (the INV-010 mirror): the inventory spec seeds an
 * orphan MOVE via superuser tooling because the app role cannot bypass the
 * posting engine; the WIP mirror seeds an orphan JOURNAL through the REAL
 * manual-journal surface (JournalService draft → submit → post, default
 * policy none) — a perfectly legitimate GL entry that simply has no
 * production order behind it, which is exactly the drift this check exists
 * to catch. Repair is the production discipline the inventory spec
 * documents: a compensating correction (same-day reversal through the
 * engine) — posted documents are never mutated, so the tenant is left with a
 * net-zero manual-journal/reversal pair on WIP (status OK on every later
 * run; the two entries stay in the runs' orphan DETAIL, which is
 * informational like inventory's orphanMoves).
 *
 * File-order independence (the suite does not sort files): every pack is
 * either difference-based (the drift is EXACTLY 500.0000 on the control
 * side) or window-scoped to months no other manufacturing spec touches
 * (January for NOT_APPLICABLE); March is always restored OPEN in finally.
 */

let fixture: MfgFixture;
const specAudit = new AuditService(new DrizzleAuditStore());
const mJournals = new JournalService(specAudit, mPosting);
const reconciliation = new ReconciliationService(specAudit);

async function periodOf(date: string) {
  return withTenant(TENANT_M, () => periodStore.findPeriodForDate(date));
}

/** Order independence: never leave a period in a non-OPEN state behind. */
async function ensurePeriodOpen(date: string, reason: string) {
  const period = await periodOf(date);
  if (period === undefined) throw new Error(`no fiscal period covers ${date}`);
  const current = await withTenant(TENANT_M, () => periodStore.findPeriodById(period.id));
  if (current !== undefined && current.status !== "OPEN") {
    await withTenant(TENANT_M, () => periods.reopen(M_ACTOR, period.id, reason));
  }
}

async function wipItemOf(periodId: string) {
  const checklist = await withTenant(TENANT_M, () => reconciliation.closeChecklist(periodId));
  return checklist.items.find((item) => item.key === "reconciliation.wip");
}

beforeAll(async () => {
  fixture = await setupMfgFixture();
});

describe("WIP-GL green path — the golden chain nets the WIP GL balance to zero", () => {
  it("runWipCheck on the chain state → OK with control 0.0000 = subledger 0.0000", async () => {
    const run = await withTenant(TENANT_M, () =>
      wipReconciliation.runWipCheck({
        asOf: "2026-03-10",
        runMode: "ON_DEMAND",
        checkedBy: M_ACTOR,
      }),
    );
    expect(run.kind).toBe("WIP");
    expect(run.status).toBe("OK");
    expect(run.diffCount).toBe(0);
    // The chain (and every other in-window order) nets WIP to exactly zero:
    // every journal on 1160 is a production_order journal and every order
    // completed in window, so both sides are the canonical zero.
    expect(run.controlBalance).toBe("0.0000");
    expect(run.subledgerBalance).toBe("0.0000");
    const diff = run.diff as { accounts: number; orders: number; orphanJournals: unknown[] };
    expect(diff.accounts).toBeGreaterThanOrEqual(1); // the WIP purpose is mapped (1160)
    expect(diff.orders).toBeGreaterThanOrEqual(2); // at least the golden dough + bread orders
    expect(diff.orphanJournals).toEqual([]); // no non-production journal touches WIP

    // The close checklist's WIP row is LIVE and OK (never the old
    // "manufacturing module ships PHASE-018" stub).
    const march = await periodOf("2026-03-02");
    const wipItem = await wipItemOf(march!.id);
    expect(wipItem?.state).toBe("OK");
    expect(wipItem?.detail).toContain("per-order WIP balances");
  });
});

describe("zero-activity window — the NOT_APPLICABLE branch", () => {
  it("no production activity before the chain → OK run, checklist NOT_APPLICABLE", async () => {
    // January 2026: the WIP purpose is mapped but nothing has produced yet
    // (the material seeds post INVENTORY/APPRECIATION; the chain is March).
    const run = await withTenant(TENANT_M, () =>
      wipReconciliation.runWipCheck({
        asOf: "2026-01-31",
        runMode: "ON_DEMAND",
        checkedBy: M_ACTOR,
      }),
    );
    expect(run.status).toBe("OK");
    expect(run.controlBalance).toBe("0.0000");
    expect(run.subledgerBalance).toBe("0.0000");
    const diff = run.diff as { accounts: number; orders: number };
    expect(diff.accounts).toBeGreaterThanOrEqual(1); // mapped but idle
    expect(diff.orders).toBe(0); // no order activity in the window

    // The January period's checklist reads the January run (as-of window)
    // and renders the explicit NOT_APPLICABLE state — nothing to reconcile.
    const january = await periodOf("2026-01-05");
    const wipItem = await wipItemOf(january!.id);
    expect(wipItem?.state).toBe("NOT_APPLICABLE");
    expect(wipItem?.detail).toContain("no production activity");
  });
});

describe("PERIOD_LOCKED interplay — the run records on a locked period", () => {
  it("locking the as-of period does not block the check (a read, not a posting)", async () => {
    await ensurePeriodOpen("2026-03-02", "wip-recon PERIOD_LOCKED pack precondition");
    const march = await periodOf("2026-03-02");
    await withTenant(TENANT_M, () => periods.softClose(M_ACTOR, march!.id));
    await withTenant(TENANT_M, () => periods.lock(M_ACTOR, march!.id));
    try {
      const locked = await withTenant(TENANT_M, () => periodStore.findPeriodById(march!.id));
      expect(locked!.status).toBe("LOCKED");
      // The check runs and records while the period is locked — the
      // reconciliation run is a diagnostic (reconciliation_runs + audit +
      // notification writes only), never a journal posting.
      const run = await withTenant(TENANT_M, () =>
        wipReconciliation.runWipCheck({
          asOf: "2026-03-31",
          runMode: "ON_DEMAND",
          checkedBy: M_ACTOR,
        }),
      );
      expect(run.status).toBe("OK");
      expect(run.asOf).toBe("2026-03-31");
    } finally {
      await withTenant(TENANT_M, () =>
        periods.reopen(M_ACTOR, march!.id, "wip-recon PERIOD_LOCKED pack reopen"),
      );
    }
  });
});

describe("seeded drift — a manual journal on WIP with no order breaks the check", () => {
  it("manual capitalization on the WIP account → BROKEN + orphan detail + audit + inbox + PC-04 lock block; reversal repairs", async () => {
    await ensurePeriodOpen("2026-03-02", "wip-recon drift pack precondition");
    // Seed the drift through the REAL manual-journal surface (see the header
    // note): a balanced manual journal DR WIP 500 · CR rent 500 — a GL
    // effect on the WIP control account with NO producing order behind it.
    const draft = await withTenant(TENANT_M, () =>
      mJournals.create(M_ACTOR, {
        entryDate: "2026-03-20",
        description: "wip drift fixture — manual capitalization with no production order",
        lines: [
          { accountId: fixture.gl.wip, direction: "DEBIT", amount: "500.0000" },
          { accountId: fixture.gl.serviceAccount, direction: "CREDIT", amount: "500.0000" },
        ],
      }),
    );
    // Default approval policy (none): submit auto-approves, then post.
    await withTenant(TENANT_M, () => mJournals.submit(M_ACTOR, draft.id));
    const posted = await withTenant(TENANT_M, () => mJournals.post(M_ACTOR, draft.id));
    const driftEntryId = posted.result.journalEntryId!;

    const run = await withTenant(TENANT_M, () =>
      wipReconciliation.runWipCheck({
        asOf: "2026-03-31",
        runMode: "NIGHTLY",
        checkedBy: M_ACTOR,
      }),
    );
    expect(run.status).toBe("BROKEN");
    expect(run.diffCount).toBeGreaterThanOrEqual(1);
    // The drift is EXACTLY the manual journal's 500.0000 on the control side
    // (difference-based: robust to any other order state in the window).
    expect(
      new Decimal(run.controlBalance).minus(new Decimal(run.subledgerBalance)).toFixed(4),
    ).toBe("500.0000");

    // The orphan detail names the journal: entry id + source + net WIP effect.
    const diff = run.diff as {
      accounts: number;
      orders: number;
      orphanJournals: {
        journalId: string;
        entryNo: string | null;
        sourceType: string;
        sourceId: string | null;
        wipNet: string;
      }[];
    };
    const orphan = diff.orphanJournals.find((row) => row.journalId === driftEntryId);
    expect(orphan).toBeDefined();
    expect(orphan!.sourceType).toBe("journal_entry");
    expect(orphan!.sourceId).toBe(draft.id);
    expect(orphan!.wipNet).toBe("500.0000");

    // The notification record (RISK-009 Sev-1): the audit event …
    const events = await withTenant(TENANT_M, () =>
      specAudit.list({ entityType: "production_order_reconciliation", entityId: run.id, limit: 5 }),
    );
    expect(events.some((event) => event.action === "manufacturing.reconciliation_broken")).toBe(true);
    // … plus the inbox row (category reconciliation, severity critical,
    // actionUrl the orders workspace).
    const su = await (await import("../test-db")).superuserClient();
    const notes = await su.query<{ category: string; severity: string; action_url: string }>(
      `SELECT category, severity, action_url FROM notifications
       WHERE tenant_id = $1 AND dedupe_key = $2`,
      [TENANT_M, `mfg-wip-reconciliation-broken:${run.id}`],
    );
    await su.end();
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0]).toMatchObject({
      category: "reconciliation",
      severity: "critical",
      action_url: "/manufacturing/orders",
    });

    // The live checklist row reflects the BROKEN run.
    const march = await periodOf("2026-03-02");
    const brokenItem = await wipItemOf(march!.id);
    expect(brokenItem?.state).toBe("BROKEN");

    // PC-04: the BROKEN WIP run blocks the period LOCK.
    const state = await withTenant(TENANT_M, () => periodStore.findPeriodById(march!.id));
    if (state!.status === "OPEN") {
      await withTenant(TENANT_M, () => periods.softClose(M_ACTOR, march!.id));
    }
    await expect(
      withTenant(TENANT_M, () => periods.lock(M_ACTOR, march!.id)),
    ).rejects.toMatchObject({ code: "RECONCILIATION_BROKEN" });
    await withTenant(TENANT_M, () =>
      periods.reopen(M_ACTOR, march!.id, "wip-recon drift pack reopen"),
    );

    // Repair (the production discipline): a compensating correction — the
    // same-day reversal through the engine. Posted documents are never
    // mutated; the net WIP effect returns to zero.
    await ensurePeriodOpen("2026-03-02", "wip-recon drift repair precondition");
    const reversal = await withTenant(TENANT_M, () =>
      mJournals.reverse(M_ACTOR, draft.id, {
        entryDate: "2026-03-20",
        reason: "wip drift fixture repair — compensating correction",
      }),
    );
    expect(reversal.status).toBe("POSTED");

    const repaired = await withTenant(TENANT_M, () =>
      wipReconciliation.runWipCheck({
        asOf: "2026-03-31",
        runMode: "ON_DEMAND",
        checkedBy: M_ACTOR,
      }),
    );
    expect(repaired.status).toBe("OK");
    expect(repaired.controlBalance).toBe(repaired.subledgerBalance);
  });
});
