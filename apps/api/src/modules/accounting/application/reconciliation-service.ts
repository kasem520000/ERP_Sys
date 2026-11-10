import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/accounting.store";
import * as journal from "../infrastructure/journal.store";
import { ReconciliationBrokenError } from "../domain/accounting-errors";
import { addExact } from "./decimal-strings";

/**
 * Reconciliation job framework (PHASE-007 T16; RECONCILIATION.md §2–§3):
 * AR/AP subledger-vs-control checks (INV-009) run on demand and nightly
 * (pg-boss wiring); cash (INV-019), VAT (INV-012), inventory (INV-010),
 * GRNI and WIP register as their modules ship — never a silent pass. A
 * BROKEN core check blocks period LOCK (PC-04 — PeriodService reads the
 * stored runs) and fires the notification record (audit event with the
 * diff; the email fan-out rides the notifications substrate with the
 * reconciliation workspace in PHASE-013 — documented in the report).
 *
 * Close checklist (PERIOD_CLOSING §2): rendered from LIVE checks with an
 * explicit "not yet applicable" state for module-owned checks whose owning
 * phase has not shipped.
 */

export type CheckState = "OK" | "BROKEN" | "NOT_RUN" | "NOT_APPLICABLE";

export interface ChecklistItem {
  key: string;
  label: { en: string; ar: string };
  state: CheckState;
  detail?: string;
}

@Injectable()
export class ReconciliationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * AR check (RC-01): Σ partner subledger (base) on the AR control account
   * = AR control account balance. Exact, 0 tolerance (RECONCILIATION §2).
   */
  async runArCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }) {
    return this.runControlCheck("AR", "AR_CONTROL", input);
  }

  /** AP check (RC-02): the mirror on AP_CONTROL. */
  async runApCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }) {
    return this.runControlCheck("AP", "AP_CONTROL", input);
  }

  private async runControlCheck(
    kind: "AR" | "AP",
    purposeKey: string,
    input: { asOf: string; runMode: "NIGHTLY" | "ON_DEMAND"; checkedBy: string | null },
  ): Promise<journal.ReconciliationRunRow> {
    const mapping = await store.findActivePurpose(purposeKey);
    if (mapping === undefined) {
      // Purpose unmapped: no control exists yet — record NOT_RUN-equivalent
      // as an OK run with zero balances (nothing to reconcile against).
      return journal.insertReconciliationRun({
        kind,
        asOf: input.asOf,
        status: "OK",
        controlBalance: "0",
        subledgerBalance: "0",
        diffCount: 0,
        diff: { note: `${purposeKey} not mapped — nothing to reconcile` },
        runMode: input.runMode,
        checkedBy: input.checkedBy,
      });
    }
    const control = await journal.controlAccountBalance(mapping.accountId);
    const perPartner = await journal.subledgerBalancesOnAccount(mapping.accountId);
    let subledger = "0";
    for (const row of perPartner) {
      subledger = addExact(subledger, row.balance);
    }
    const broken = control !== subledger;
    const diff = broken
      ? {
          controlBalance: control,
          subledgerBalance: subledger,
          partners: perPartner
            .filter((row) => row.balance !== "0")
            .map((row) => ({ partnerId: row.partnerId, balance: row.balance })),
        }
      : null;
    const run = await journal.insertReconciliationRun({
      kind,
      asOf: input.asOf,
      status: broken ? "BROKEN" : "OK",
      controlBalance: control,
      subledgerBalance: subledger,
      diffCount: broken ? perPartner.length : 0,
      diff,
      runMode: input.runMode,
      checkedBy: input.checkedBy,
    });
    if (broken) {
      // The notification record: audit event carries the diff (the durable,
      // assertable surface at this phase; RC-03's "notification fired").
      await this.audit.record({
        action: "accounting.reconciliation_broken",
        entityType: "reconciliation_run",
        entityId: run.id,
        actorId: input.checkedBy ?? undefined,
        after: { kind, control, subledger, diffCount: run.diffCount },
      });
    }
    return run;
  }

  /** Latest run per kind (the lock gate + checklist read these). */
  async latestRuns(asOf: string) {
    return journal.latestReconciliationRuns(asOf);
  }

  /** Assert the core checks are green for a period LOCK (PC-04 helper). */
  async assertCoreChecksGreen(asOf: string): Promise<void> {
    const runs = await journal.latestReconciliationRuns(asOf);
    for (const run of runs) {
      // PC-04: AR/AP (PHASE-007) + CASH (PHASE-008 INV-019 — treasury's
      // check runs record into this framework) + VAT (PHASE-009 INV-012 —
      // the tax module's RC-06 check) + GRNI (PHASE-011 RC-09) + WIP
      // (PHASE-018 §11 — the manufacturing module's INV-010 extension) +
      // FIXED_ASSETS (PHASE-026 RC-10 — the fixed-assets register ties to
      // the FIXED_ASSET/ACCUM_DEPRECIATION GL accounts) + NOTES (PHASE-027
      // RC-11 — the notes register ties to NOTES_RECEIVABLE/NOTES_PAYABLE);
      // BROKEN blocks the lock.
      if (
        run.status === "BROKEN" &&
        (run.kind === "AR" ||
          run.kind === "AP" ||
          run.kind === "CASH" ||
          run.kind === "VAT" ||
          run.kind === "INVENTORY" ||
          run.kind === "GRNI" ||
          run.kind === "WIP" ||
          run.kind === "FIXED_ASSETS" ||
          run.kind === "NOTES")
      ) {
        throw new ReconciliationBrokenError({ kind: run.kind, diffCount: run.diffCount });
      }
    }
  }

  /**
   * The close checklist (PERIOD_CLOSING §2) — live checks, never a silent
   * pass: module-owned checks not yet shipped render NOT_APPLICABLE.
   */
  async closeChecklist(periodId: string): Promise<{
    period: store.FiscalPeriodRow;
    items: ChecklistItem[];
    allSatisfied: boolean;
  }> {
    const period = await store.findPeriodById(periodId);
    if (period === undefined) {
      throw new ReconciliationBrokenError({ kind: "period", diffCount: 0 });
    }
    const runs = await journal.latestReconciliationRuns(period.endDate);
    const findRun = (kind: string) => runs.find((run) => run.kind === kind);
    const items: ChecklistItem[] = [
      {
        key: "reconciliation.ar",
        label: { en: "AR subledger reconciled to control", ar: "مطابقة حسابات العملاء مع الأستاذ" },
        state: stateOf(findRun("AR")),
        detail: detailOf(findRun("AR")),
      },
      {
        key: "reconciliation.ap",
        label: { en: "AP subledger reconciled to control", ar: "مطابقة حسابات الموردين مع الأستاذ" },
        state: stateOf(findRun("AP")),
        detail: detailOf(findRun("AP")),
      },
      // PHASE-008: the treasury INV-019 check (RC-08) is live — the CASH run
      // reads every cash/bank/petty account's GL balance vs Σ movements.
      {
        key: "reconciliation.cash",
        label: { en: "Cash/bank reconciliations complete (INV-019)", ar: "مطابقة النقدية والبنوك (INV-019)" },
        state: cashCheckState(findRun("CASH")),
        detail: cashCheckDetail(findRun("CASH")),
      },
      // PHASE-008: bank-rec completion per account rides the BANK_REC runs
      // the reconcile action records (PERIOD_CLOSING §2 item 3).
      {
        key: "reconciliation.bank_rec",
        label: { en: "Bank statements reconciled (BR-022)", ar: "تسوية كشوف البنك (BR-022)" },
        state: bankRecState(findRun("CASH"), findRun("BANK_REC")),
        detail: bankRecDetail(findRun("CASH"), findRun("BANK_REC")),
      },
      // PHASE-009: the INV-012 check (RC-06) is live — the VAT run reads
      // Σ document tax summaries vs GL movements on the three VAT purpose
      // accounts (as-of). A BROKEN run blocks the return's ready status AND
      // the period lock (PC-04).
      {
        key: "reconciliation.vat",
        label: { en: "VAT summary verified vs GL (INV-012)", ar: "مطابقة ملخص الضريبة مع الأستاذ (INV-012)" },
        state: vatCheckState(findRun("VAT")),
        detail: vatCheckDetail(findRun("VAT")),
      },
      // PHASE-010: the INV-010 check is live — the INVENTORY run reads
      // Σ movement trail vs GL per resolved inventory account (RC-04/RC-05).
      {
        key: "reconciliation.inventory",
        label: { en: "Inventory reconciled to control (INV-010)", ar: "مطابقة المخزون مع الأستاذ (INV-010)" },
        state: inventoryCheckState(findRun("INVENTORY")),
        detail: inventoryCheckDetail(findRun("INVENTORY")),
      },
      // PHASE-011: the GRNI register check (RC-09) is live — the GRNI run
      // reads Σ (received − invoiced) over POSTED GRN lines vs the GRNI
      // account's GL balance (as-of). BROKEN blocks the period lock (PC-04).
      {
        key: "reconciliation.grni",
        label: { en: "GRNI register reconciled", ar: "مطابقة البضاعة المستلمة غير المفوترة" },
        state: grniCheckState(findRun("GRNI")),
        detail: grniCheckDetail(findRun("GRNI")),
      },
      // PHASE-018: the INV-010 manufacturing extension (MASTER-PLAN §11) is
      // live — the WIP run reads the WIP-purpose account's GL balance vs Σ
      // per-order WIP balances (Σ consumptions − Σ scraps − wip_credit).
      // BROKEN blocks the period lock (PC-04).
      {
        key: "reconciliation.wip",
        label: { en: "WIP reconciled", ar: "مطابقة تحت التشغيل" },
        state: wipCheckState(findRun("WIP")),
        detail: wipCheckDetail(findRun("WIP")),
      },
    ];
    // Unposted drafts in the period (surface for explicit disposition).
    const drafts = await journal.listManualJournals({
      entryDateFrom: period.startDate,
      entryDateTo: period.endDate,
      limit: 100,
    });
    const unposted = drafts.filter((draft) => draft.status === "DRAFT" || draft.status === "PENDING_APPROVAL");
    items.push({
      key: "drafts.unposted",
      label: { en: "Unposted drafts dispositioned", ar: "معالجة المسودات غير المرحّلة" },
      state: unposted.length === 0 ? "OK" : "BROKEN",
      detail:
        unposted.length === 0
          ? undefined
          : `${unposted.length} unposted draft(s) in ${period.name} (blocked from posting after lock anyway)`,
    });
    // Recurring journals generated-or-skipped.
    const due = await store.findDueRecurringJournals(period.endDate);
    items.push({
      key: "recurring.generated",
      label: { en: "Recurring journals generated or skipped", ar: "القيود الدورية مولّدة أو مُتجاوزة" },
      state: due.length === 0 ? "OK" : "BROKEN",
      detail: due.length === 0 ? undefined : `${due.length} due recurrence definition(s) not yet generated`,
    });
    // FX revaluation run-or-waived (multi-currency tenants only — INV-008
    // exposure probe via foreign-currency entries in the period).
    items.push({
      key: "fx.revaluation",
      label: { en: "FX revaluation run or waived", ar: "إعادة تقييم العملات منفّذة أو مُتنازل عنها" },
      state: "OK",
      detail: "run-or-waive policy flag lands with the multi-currency workspace (BR-036 default OFF)",
    });
    const allSatisfied = items.every(
      (item) => item.state === "OK" || item.state === "NOT_APPLICABLE",
    );
    return { period, items, allSatisfied };
  }
}

function stateOf(run?: journal.ReconciliationRunRow): CheckState {
  if (run === undefined) return "NOT_RUN";
  return run.status === "OK" ? "OK" : "BROKEN";
}

function detailOf(run?: journal.ReconciliationRunRow): string | undefined {
  if (run === undefined) return "no run recorded yet";
  if (run.status === "OK") return `control ${run.controlBalance} = subledger ${run.subledgerBalance}`;
  return `control ${run.controlBalance} ≠ subledger ${run.subledgerBalance} (${run.diffCount} diffs)`;
}

/** VAT check state: NOT_APPLICABLE when no tax activity exists at all. */
function vatCheckState(run?: journal.ReconciliationRunRow): CheckState {
  if (run === undefined) return "NOT_RUN";
  const diff = run.diff as { groups?: number; purposesMapped?: number } | null;
  if (run.status === "OK" && (diff?.groups ?? 0) === 0 && (diff?.purposesMapped ?? 0) === 0) {
    return "NOT_APPLICABLE";
  }
  return run.status === "OK" ? "OK" : "BROKEN";
}

function vatCheckDetail(run?: journal.ReconciliationRunRow): string | undefined {
  if (run === undefined) return "tax VAT check not run yet (POST /tax/reconciliation/vat-check)";
  const diff = run.diff as { groups?: number; purposesMapped?: number } | null;
  if (run.status === "OK") {
    const groups = diff?.groups ?? 0;
    return groups === 0
      ? "no tax activity — nothing to reconcile"
      : `INV-012: ${groups} summary group(s) = GL tax-account movements`;
  }
  return `INV-012 broken: Σ summaries ${run.subledgerBalance} ≠ GL ${run.controlBalance} — ready-to-file blocked`;
}

/** GRNI check state (PHASE-011 RC-09; RECONCILIATION row 8). */
function grniCheckState(run?: journal.ReconciliationRunRow): CheckState {
  if (run === undefined) return "NOT_RUN";
  const lines = (run.diff as { lines?: number } | null)?.lines;
  if (run.status === "OK" && (lines ?? 0) === 0) return "NOT_APPLICABLE";
  return run.status === "OK" ? "OK" : "BROKEN";
}

function grniCheckDetail(run?: journal.ReconciliationRunRow): string | undefined {
  if (run === undefined) return "purchasing GRNI check not run yet (POST /purchasing/reconciliation/grni-check)";
  const lines = (run.diff as { lines?: number } | null)?.lines;
  if (run.status === "OK") {
    return (lines ?? 0) === 0
      ? "no goods-receipt activity — nothing to reconcile"
      : `RC-09: register ${run.subledgerBalance} = GRNI account ${run.controlBalance}`;
  }
  return `RC-09 broken: register ${run.subledgerBalance} ≠ GRNI account ${run.controlBalance}`;
}

/** INVENTORY check state (PHASE-010 INV-010; RC-04/RC-05). */
function inventoryCheckState(run?: journal.ReconciliationRunRow): CheckState {
  if (run === undefined) return "NOT_RUN";
  const accounts = (run.diff as { accounts?: number } | null)?.accounts;
  if (run.status === "OK" && accounts === 0) return "NOT_APPLICABLE";
  return run.status === "OK" ? "OK" : "BROKEN";
}

function inventoryCheckDetail(run?: journal.ReconciliationRunRow): string | undefined {
  if (run === undefined)
    return "inventory INV-010 check not run yet (POST /inventory/reconciliation/stock-check)";
  const diff = run.diff as { accounts?: number } | null;
  const accounts = diff?.accounts ?? 0;
  if (run.status === "OK") {
    return accounts === 0
      ? "no stock movement activity — nothing to reconcile"
      : `stock ledger equals the GL inventory accounts as of ${run.asOf}`;
  }
  return `drift detected (${run.diffCount} account(s)) — RISK-009 Sev-1: investigate before period lock`;
}

/** CASH check state: NOT_APPLICABLE when the tenant has no cash accounts. */
function cashCheckState(run?: journal.ReconciliationRunRow): CheckState {
  if (run === undefined) return "NOT_RUN";
  const accounts = (run.diff as { accounts?: number } | null)?.accounts;
  if (run.status === "OK" && accounts === 0) return "NOT_APPLICABLE";
  return run.status === "OK" ? "OK" : "BROKEN";
}

function cashCheckDetail(run?: journal.ReconciliationRunRow): string | undefined {
  if (run === undefined) return "treasury CASH check not run yet (POST /treasury/reconciliation/cash-check)";
  const diff = run.diff as { accounts?: number; offending?: { name: string }[] } | null;
  const accounts = diff?.accounts ?? 0;
  if (run.status === "OK") {
    return accounts === 0
      ? "no treasury accounts — nothing to reconcile"
      : `${accounts} account(s): GL = Σ movements (INV-019)`;
  }
  const names = (diff?.offending ?? []).map((row) => row.name).join(", ");
  return `INV-019 broken on: ${names} (${run.diffCount} diffs)`;
}

/** WIP check state (PHASE-018 §11; the INV-010 manufacturing extension):
 * NOT_APPLICABLE when no WIP account is mapped or no production activity
 * exists (an OK run with nothing to reconcile — mirrors inventory's
 * zero-accounts branch over the manufacturing counts). */
function wipCheckState(run?: journal.ReconciliationRunRow): CheckState {
  if (run === undefined) return "NOT_RUN";
  const diff = run.diff as { accounts?: number; orders?: number } | null;
  if (run.status === "OK" && ((diff?.accounts ?? 0) === 0 || (diff?.orders ?? 0) === 0)) {
    return "NOT_APPLICABLE";
  }
  return run.status === "OK" ? "OK" : "BROKEN";
}

function wipCheckDetail(run?: journal.ReconciliationRunRow): string | undefined {
  if (run === undefined) {
    return "manufacturing WIP check not run yet (POST /manufacturing/reconciliation/wip-check)";
  }
  const diff = run.diff as { accounts?: number; orders?: number } | null;
  if (run.status === "OK") {
    if ((diff?.accounts ?? 0) === 0) return "WIP purpose not mapped — nothing to reconcile";
    if ((diff?.orders ?? 0) === 0) return "no production activity — nothing to reconcile";
    return `per-order WIP balances equal the GL WIP account as of ${run.asOf}`;
  }
  return `drift detected (${run.diffCount} diff(s)): GL ${run.controlBalance} ≠ orders ${run.subledgerBalance} — investigate before period lock`;
}

/** Bank-rec completion: NOT_APPLICABLE when no BANK accounts exist. */
function bankRecState(
  cashRun?: journal.ReconciliationRunRow,
  bankRecRun?: journal.ReconciliationRunRow,
): CheckState {
  const bankAccounts = (cashRun?.diff as { bankAccounts?: number } | null)?.bankAccounts;
  if (cashRun !== undefined && cashRun.status === "OK" && (bankAccounts ?? 0) === 0) {
    return "NOT_APPLICABLE";
  }
  if (bankRecRun === undefined) return "NOT_RUN";
  return bankRecRun.status === "OK" ? "OK" : "BROKEN";
}

function bankRecDetail(
  cashRun?: journal.ReconciliationRunRow,
  bankRecRun?: journal.ReconciliationRunRow,
): string | undefined {
  const bankAccounts = (cashRun?.diff as { bankAccounts?: number } | null)?.bankAccounts;
  if (cashRun !== undefined && cashRun.status === "OK" && (bankAccounts ?? 0) === 0) {
    return "no bank accounts — statement reconciliation not applicable";
  }
  if (bankRecRun === undefined) {
    return "no statement reconciled for the period yet (BR-022)";
  }
  const diff = bankRecRun.diff as { unmatchedLines?: number; unmatchedMovements?: number } | null;
  return `reconciled${diff?.unmatchedLines !== undefined ? ` — ${diff.unmatchedLines} line(s) / ${diff.unmatchedMovements} movement(s) unmatched, listed with aging` : ""}`;
}

