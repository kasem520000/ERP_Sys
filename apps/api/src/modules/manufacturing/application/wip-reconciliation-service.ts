import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import * as store from "../infrastructure/manufacturing.store";

/**
 * WIP↔GL reconciliation (PHASE-018 T38b-ii; MASTER-PLAN §11; the INV-010
 * manufacturing extension): the GL balance of the account(s) mapped to the
 * WIP purpose (as-of) must equal Σ per-order WIP balances —
 * Σ production_consumptions.value − Σ production_scraps.value −
 * orders.wip_credit_value, each filtered to the as-of window — exact with
 * ZERO tolerance.
 *
 * By construction the check also verifies the manufacturing posting
 * discipline: every journal touching the WIP account belongs to a production
 * order (source `production_order`). A manual journal hitting WIP with no
 * producing order behind it skews the control side and the run lands BROKEN
 * with the orphan entries in the diff (entry ids + sources + their net WIP
 * effect — the inventory movesWithoutJournal mirror).
 *
 * Drift discipline (RISK-009): BROKEN blocks the period LOCK via the
 * PHASE-007 framework (ReconciliationService.assertCoreChecksGreen +
 * PeriodService.lock read the WIP kind — PC-04) and fires the notification
 * record: the audit event carrying the diff plus the inbox notification
 * (category `reconciliation`, severity `critical`, RISK-009 Sev-1).
 *
 * The run NEVER writes a journal (read-only analysis; the only writes are
 * the reconciliation_runs row, the audit event, and the notification).
 */
@Injectable()
export class ManufacturingReconciliationService {
  constructor(
    // NOTE: every param carries an explicit @Inject — the vitest/esbuild
    // pipeline does not emit design:paramtypes, so bare type-annotated
    // params resolve to undefined holes (the JobCardService silent-undefined
    // precedent, see agent-ctx/T38bi-3b-orders.md).
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /**
   * The WIP check (RC-04/RC-05 semantics): GL WIP balance vs Σ per-order WIP
   * balances. Runs even with no WIP purpose mapped and no orders (an OK run
   * with zero counts — the close checklist's NOT_APPLICABLE branch reads the
   * diff; the AR/AP unmapped-purpose precedent).
   */
  async runWipCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }): Promise<journalStore.ReconciliationRunRow> {
    const purposes = await journalStore.accountsForPurposes(["WIP"]);
    if (purposes.length === 0) {
      // Purpose unmapped: no control exists yet — record the OK 0/0 run with
      // the note (nothing to reconcile against; the checklist renders
      // NOT_APPLICABLE from the zero counts).
      return journalStore.insertReconciliationRun({
        kind: "WIP",
        asOf: input.asOf,
        status: "OK",
        controlBalance: "0.0000",
        subledgerBalance: "0.0000",
        diffCount: 0,
        diff: { accounts: 0, orders: 0, note: "WIP not mapped — nothing to reconcile" },
        runMode: input.runMode,
        checkedBy: input.checkedBy,
      });
    }

    // Control side: the mapped WIP account(s)' GL base balance as-of.
    let control = new Decimal(0);
    for (const purpose of purposes) {
      control = control.plus(new Decimal(await store.wipGlBalanceAsOf(purpose.accountId, input.asOf)));
    }
    // Subledger side: per-order WIP balances over ALL orders with activity.
    const perOrder = await store.listOrderWipBalances(input.asOf);
    let subledger = new Decimal(0);
    for (const row of perOrder) {
      subledger = subledger.plus(new Decimal(row.balance));
    }
    // Orphan detail: non-production journals touching the WIP account(s).
    const orphanJournals = await store.listWipOrphanJournals(
      purposes.map((purpose) => purpose.accountId),
      input.asOf,
      25,
    );

    const broken = control.minus(subledger).abs().greaterThan(0);
    const controlBalance = control.toFixed(4);
    const subledgerBalance = subledger.toFixed(4);
    const run = await journalStore.insertReconciliationRun({
      kind: "WIP",
      asOf: input.asOf,
      status: broken ? "BROKEN" : "OK",
      controlBalance,
      subledgerBalance,
      diffCount: broken ? Math.max(orphanJournals.length, 1) : 0,
      diff: broken
        ? {
            accounts: purposes.length,
            orders: perOrder.length,
            controlBalance,
            subledgerBalance,
            orphanJournals,
            ordersWithWip: perOrder
              .filter((row) => row.balance !== "0.0000")
              .slice(0, 25)
              .map((row) => ({ orderId: row.orderId, orderNo: row.orderNo, balance: row.balance })),
          }
        : { accounts: purposes.length, orders: perOrder.length, orphanJournals },
      runMode: input.runMode,
      checkedBy: input.checkedBy,
    });
    if (broken) {
      // The notification record: the audit event carries the diff (the
      // durable, assertable surface) and the inbox row surfaces it to the
      // tenant (category reconciliation, severity critical — RISK-009 Sev-1).
      await this.audit.record({
        action: "manufacturing.reconciliation_broken",
        entityType: "production_order_reconciliation",
        entityId: run.id,
        actorId: input.checkedBy ?? undefined,
        after: {
          kind: "WIP",
          controlBalance,
          subledgerBalance,
          diffCount: run.diffCount,
          orphanJournals,
        },
      });
      await this.inbox.record({
        category: "reconciliation",
        severity: "critical",
        title: {
          en: "WIP reconciliation broken",
          ar: "انكسار مطابقة تحت التشغيل",
        },
        body: {
          en: `The WIP control account no longer equals the sum of per-order WIP balances as of ${input.asOf} (GL ${controlBalance} vs orders ${subledgerBalance}) — investigate before the period lock.`,
          ar: `لم يعد حساب تحت التشغيل مطابقًا لمجموع أرصدة أوامر الإنتاج كما في ${input.asOf} (الأستاذ ${controlBalance} مقابل الأوامر ${subledgerBalance}) — يرجى التحقق قبل إقفال الفترة.`,
        },
        actionUrl: "/manufacturing/orders",
        dedupeKey: `mfg-wip-reconciliation-broken:${run.id}`,
      });
    }
    return run;
  }
}
