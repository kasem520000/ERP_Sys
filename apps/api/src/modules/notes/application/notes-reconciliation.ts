import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { findActivePurpose } from "../../accounting/infrastructure/accounting.store";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import type { ChecklistItem } from "../../accounting/application/reconciliation-service";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { listLiveNotes, type NoteRow } from "../infrastructure/notes.store";

/**
 * RC-11 — the notes subledger check (PHASE-027 T12; RECONCILIATION.md §1
 * row 11, the RC-10 registration pattern): per purpose side, the REGISTER
 * derived from live note rows must equal the GL balance of the mapped
 * purpose accounts — exact, ZERO tolerance (RECONCILIATION §2).
 *
 * THE ALGEBRA (both sides derived from source rows; every term a signed
 * canonical 4dp string):
 *
 *   NOTES_RECEIVABLE (received, purpose side): expected =
 *     Σ over live RECEIVED notes (IN_CUSTODY/ENDORSED_OUT/DEPOSITED) of
 *       amount × the note's stored rate (INV-008 — never recomputed)
 *   NOTES_PAYABLE (issued mirror): expected = Σ over live ISSUED notes.
 *
 * A note's GL contribution is exactly its amount×r₀ while live (G-24/G-27
 * debits it) and zero once resolved — COLLECTED/DISHONORED/DISCOUNTED/
 * RETURNED all derecognize it with a full credit (INV-024: custody equals
 * journal effects). The check's value is catching EXTERNAL drift: a manual
 * journal hitting a notes-purpose account, a register row written without
 * its journal, or a purpose remapped mid-life.
 */
export const NOTES_CHECK_KIND = "NOTES";

/** One scan page (listLiveNotes caps at the caller's limit). */
const REGISTER_SCAN_LIMIT = 1_000_000;

/** Canonical 4dp normalization for GL text reads (the RC-10 precedent). */
function money4(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/**
 * The GL side read in the REGISTER's convention (P27-G fix, found by the
 * INV-024 spec): NOTES_RECEIVABLE is debit-natured (G-24 debits it, so the
 * signed DEBIT−CREDIT balance already reads register-positive) but
 * NOTES_PAYABLE is CREDIT-natured (G-27 credits it) — its signed balance is
 * negative while the register fold is positive, so it must be NEGATED
 * (credit-positive) exactly like the fixed-assets accum side and the GRNI
 * convention. Without this, every tenant holding live ISSUED notes would
 * read BROKEN on a perfectly tied register.
 */
function glSideInRegisterConvention(
  purposeKey: "NOTES_RECEIVABLE" | "NOTES_PAYABLE",
  signedBalance: string,
): string {
  if (purposeKey !== "NOTES_PAYABLE") {
    return money4(signedBalance);
  }
  // Negate through Decimal (the signed read may already be negative — a
  // naive `-${value}` would double the minus and fail the parser).
  const negated = new Decimal(signedBalance).negated().toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  return negated === "-0.0000" ? "0.0000" : negated;
}

// -- the pure register fold (exported for the RC-11 + INV-024 specs) ------------------

export interface RegisterFoldRow {
  direction: "RECEIVED" | "ISSUED";
  amount: string;
  exchangeRate: string;
}

export interface RegisterExpectedSide {
  purposeKey: "NOTES_RECEIVABLE" | "NOTES_PAYABLE";
  direction: "RECEIVED" | "ISSUED";
  expected: string;
  notes: number;
}

/**
 * The pure fold: per (purpose key × direction), the expected GL contribution
 * of the live register. Resolved notes contribute nothing (INV-024).
 */
export function notesRegisterExpectedSides(rows: readonly RegisterFoldRow[]): RegisterExpectedSide[] {
  let received = "0.0000";
  let issued = "0.0000";
  let receivedCount = 0;
  let issuedCount = 0;
  for (const row of rows) {
    const contribution = new Decimal(row.amount)
      .times(new Decimal(row.exchangeRate))
      .toDecimalPlaces(4)
      .toFixed(4);
    if (row.direction === "RECEIVED") {
      received = addExact(received, contribution);
      receivedCount += 1;
    } else {
      issued = addExact(issued, contribution);
      issuedCount += 1;
    }
  }
  return [
    { purposeKey: "NOTES_RECEIVABLE", direction: "RECEIVED", expected: money4(received), notes: receivedCount },
    { purposeKey: "NOTES_PAYABLE", direction: "ISSUED", expected: money4(issued), notes: issuedCount },
  ];
}

// -- the RC-11 check service ----------------------------------------------------------

/** One offending row in a BROKEN run's diff. */
export interface NotesReconciliationDiffRow {
  purposeKey: string;
  direction: string;
  accountCode: string | null;
  expected: string;
  actual: string | null;
  diff: string;
  note?: string;
}

@Injectable()
export class NotesReconciliationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /**
   * RC-11: the register↔GL check. Read-only analysis — the only writes are
   * the reconciliation_runs row, the audit event, and the notification
   * (never a journal; drift is fixed by additive documents).
   */
  async runNotesCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }): Promise<journalStore.ReconciliationRunRow> {
    const live: NoteRow[] = await listLiveNotes(REGISTER_SCAN_LIMIT);
    const expectedSides = notesRegisterExpectedSides(
      live.map((note) => ({ direction: note.direction, amount: note.amount, exchangeRate: note.exchangeRate })),
    );

    const rows: NotesReconciliationDiffRow[] = [];
    let controlTotal = "0.0000";
    let subledgerTotal = "0.0000";
    let accounts = 0;
    for (const side of expectedSides) {
      const mapping = await findActivePurpose(side.purposeKey);
      if (mapping === undefined) {
        if (compareExact(side.expected, "0.0000") !== 0) {
          rows.push({
            purposeKey: side.purposeKey,
            direction: side.direction,
            accountCode: null,
            expected: side.expected,
            actual: null,
            diff: side.expected,
            note: "purpose not mapped — register value exists with no GL account",
          });
          subledgerTotal = addExact(subledgerTotal, side.expected);
        }
        continue;
      }
      accounts += 1;
      const actual = glSideInRegisterConvention(
        side.purposeKey,
        await journalStore.controlAccountBalance(mapping.accountId),
      );
      controlTotal = addExact(controlTotal, actual);
      subledgerTotal = addExact(subledgerTotal, side.expected);
      if (compareExact(actual, side.expected) !== 0) {
        rows.push({
          purposeKey: side.purposeKey,
          direction: side.direction,
          accountCode: mapping.accountCode ?? null,
          expected: side.expected,
          actual,
          // P27-G fix: the honest signed delta (GL − register), never the
          // absolute GL value the first draft carried.
          diff: money4(subExact(actual, side.expected)),
          note: `${side.notes} live note(s) do not tie to the ${side.purposeKey} account`,
        });
      }
    }
    // GL drift with NO register side (external journals on a notes-purpose
    // account with zero live register): surfaced per key.
    for (const purposeKey of ["NOTES_RECEIVABLE", "NOTES_PAYABLE"] as const) {
      if (expectedSides.some((side) => side.purposeKey === purposeKey && side.notes > 0)) continue;
      const mapping = await findActivePurpose(purposeKey);
      if (mapping === undefined) continue;
      const actual = glSideInRegisterConvention(
        purposeKey,
        await journalStore.controlAccountBalance(mapping.accountId),
      );
      if (compareExact(actual, "0.0000") !== 0) {
        accounts += 1;
        controlTotal = addExact(controlTotal, actual);
        rows.push({
          purposeKey,
          direction: purposeKey === "NOTES_RECEIVABLE" ? "RECEIVED" : "ISSUED",
          accountCode: mapping.accountCode ?? null,
          expected: "0.0000",
          actual,
          diff: actual,
          note: "GL balance with no live register — external journals on a notes-purpose account",
        });
      }
    }

    const status = rows.length > 0 ? "BROKEN" : "OK";
    const run = await journalStore.insertReconciliationRun({
      kind: NOTES_CHECK_KIND,
      asOf: input.asOf,
      status,
      controlBalance: money4(controlTotal),
      subledgerBalance: money4(subledgerTotal),
      diffCount: rows.length,
      diff: { notes: live.length, accounts, rows },
      runMode: input.runMode,
      checkedBy: input.checkedBy,
    });
    if (status === "BROKEN") {
      await this.audit.record({
        action: "notes.reconciliation_broken",
        entityType: "reconciliation_run",
        entityId: run.id,
        actorId: input.checkedBy ?? undefined,
        after: {
          kind: NOTES_CHECK_KIND,
          controlBalance: run.controlBalance,
          subledgerBalance: run.subledgerBalance,
          diffCount: run.diffCount,
          rows,
        },
      });
      await this.inbox.record({
        category: "reconciliation",
        severity: "critical",
        title: {
          en: "Notes reconciliation broken (RC-11)",
          ar: "انكسار مطابقة الأوراق التجارية (RC-11)",
        },
        body: {
          en: `The notes register no longer ties to the NOTES_RECEIVABLE/NOTES_PAYABLE accounts as of ${input.asOf} (register ${run.subledgerBalance} vs GL ${run.controlBalance}, ${rows.length} row(s)) — investigate before the period lock.`,
          ar: `لم يعد سجل الأوراق مطابقًا لحسابي أوراق القبض/الدفع كما في ${input.asOf} (السجل ${run.subledgerBalance} مقابل الأستاذ ${run.controlBalance}، ${rows.length} صف/صفوف) — يرجى التحقق قبل إقفال الفترة.`,
        },
        actionUrl: "/notes",
        dedupeKey: `notes-reconciliation-broken:${run.id}`,
      });
    }
    return run;
  }
}

// -- close-checklist row (PERIOD_CLOSING §2; accounting wires this) ---------------------

/** RC-11 checklist row from the latest run (the GRNI/WIP/FA item shape). */
export function notesCheckItem(run?: journalStore.ReconciliationRunRow): ChecklistItem {
  const label = {
    en: "Notes register reconciled (RC-11)",
    ar: "مطابقة سجل الأوراق التجارية (RC-11)",
  };
  if (run === undefined) {
    return {
      key: "reconciliation.notes",
      label,
      state: "NOT_RUN",
      detail: "notes RC-11 check not run yet (POST /notes/reconciliation/notes-check)",
    };
  }
  const diff = run.diff as { notes?: number } | null;
  if (run.status === "OK" && (diff?.notes ?? 0) === 0) {
    return {
      key: "reconciliation.notes",
      label,
      state: "NOT_APPLICABLE",
      detail: "no live notes — nothing to reconcile",
    };
  }
  if (run.status === "OK") {
    return {
      key: "reconciliation.notes",
      label,
      state: "OK",
      detail: `RC-11: register ${run.subledgerBalance} = notes accounts ${run.controlBalance} as of ${run.asOf}`,
    };
  }
  return {
    key: "reconciliation.notes",
    label,
    state: "BROKEN",
    detail: `RC-11 broken: register ${run.subledgerBalance} ≠ notes accounts ${run.controlBalance} (${run.diffCount} row(s)) — period lock blocked (PC-04)`,
  };
}
