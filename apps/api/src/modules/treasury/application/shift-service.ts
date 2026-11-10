import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import type { JournalSpec, JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { PostingService } from "../../accounting/application/posting-service";
import * as store from "../infrastructure/treasury.store";
import {
  CashAccountTypeInvalidError,
  ShiftAlreadyOpenError,
  ShiftNotFoundError,
  ShiftReasonRequiredError,
  ShiftSupervisorPinInvalidError,
  ShiftSupervisorRequiredError,
  TreasuryDocumentStateError,
} from "../domain/treasury-errors";
import {
  baseCurrency,
  moneyAbs,
  moneyAdd,
  moneyCompare,
  moneyMultiply,
  moneySub,
  requireActiveAccount,
  requirePositiveAmount,
  resolveDocumentRate,
  shiftSettings,
} from "./document-support";

/**
 * Shift service (PHASE-008 T9; BR-021): cashier shifts on CASH accounts —
 * opening float, manual tellering capture (the POS feed lands PHASE-016),
 * closing count, and difference handling:
 *
 * - |difference| ≤ tolerance: auto-posts DR/CR the cash-difference purpose
 *   against the cash account with the shift as source (when the auto-post
 *   setting is on and the difference is non-zero);
 * - |difference| > tolerance: supervisor id + PIN + reason are REQUIRED
 *   before the shift can close at all (the PIN is validated against the
 *   fail-closed `treasury.shift_supervisor_pin` setting);
 * - every variance is audited; INV-019 stays intact (the variance movement
 *   balances the journal's cash line by construction).
 *
 * The CASH_DIFFERENCE purpose (classical cash-over-short account) is
 * tenant-mapped fail-closed like CASH/PETTY_CASH — PURPOSE_NOT_MAPPED
 * surfaces when unmapped (the fixture maps it during setup).
 */
@Injectable()
export class ShiftService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  async list(filter: { status?: string; limit: number }) {
    return store.listShifts(filter);
  }

  async find(id: string) {
    const shift = await store.findShiftById(id);
    if (shift === undefined) throw new ShiftNotFoundError(id);
    return shift;
  }

  async open(input: {
    cashAccountId: string;
    openingAmount: string;
    actorId: string | null;
  }) {
    const opening = input.openingAmount === "" || input.openingAmount === "0" ? "0.0000" : input.openingAmount;
    if (moneyCompare(opening, "0.0000") < 0) {
      throw new TreasuryDocumentStateError("opening float cannot be negative");
    }
    const account = await store.findCashAccountById(input.cashAccountId);
    const active = requireActiveAccount(account);
    if (active.type !== "CASH") {
      throw new CashAccountTypeInvalidError(
        `cashier shifts run on CASH accounts — ${active.name} is ${active.type} (PETTY drawers land with the POS-grade UX, PHASE-016)`,
      );
    }
    const open = await store.findOpenShiftForAccount(active.id);
    if (open !== undefined) throw new ShiftAlreadyOpenError(active.id);
    void (await resolveDocumentRate({ currencyCode: active.currencyCode, exchangeRate: null }));
    const created = await store.insertShift({
      cashAccountId: active.id,
      currencyCode: active.currencyCode,
      openingAmount: opening,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "treasury.shift_opened",
      entityType: "cashier_shift",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { cashAccount: active.name, opening },
    });
    return created;
  }

  /** Manual tellering capture (§2.7): accumulate the in/out feed, audited. */
  async capture(input: { id: string; cashIn: string; cashOut: string; actorId: string | null }) {
    const shift = await this.find(input.id);
    if (shift.status !== "OPEN") {
      throw new TreasuryDocumentStateError(`shift ${input.id} is ${shift.status} — only OPEN shifts capture`);
    }
    const cashIn = input.cashIn === "" ? "0.0000" : input.cashIn;
    const cashOut = input.cashOut === "" ? "0.0000" : input.cashOut;
    if (moneyCompare(cashIn, "0.0000") < 0 || moneyCompare(cashOut, "0.0000") < 0) {
      throw new TreasuryDocumentStateError("captured amounts cannot be negative");
    }
    const updated = await store.captureShiftActivity({ id: input.id, cashIn, cashOut });
    await this.audit.record({
      action: "treasury.shift_capture",
      entityType: "cashier_shift",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      after: { cashIn, cashOut, totals: { in: updated.capturedIn, out: updated.capturedOut } },
    });
    return updated;
  }

  /**
   * Close (BR-021): expected = opening + capturedIn − capturedOut;
   * difference = counted − expected. Tolerance decides the attestation
   * path; auto-post posts the difference with the shift as source.
   */
  async close(input: {
    id: string;
    countedAmount: string;
    reason?: string;
    supervisorId?: string;
    supervisorPin?: string;
    actorId: string | null;
  }) {
    const shift = await this.find(input.id);
    if (shift.status !== "OPEN") {
      throw new TreasuryDocumentStateError(`shift ${input.id} is ${shift.status} — only OPEN shifts close`);
    }
    const countedFinal =
      input.countedAmount === "" || input.countedAmount === "0" || input.countedAmount === "0.0000"
        ? "0.0000"
        : requirePositiveAmount(input.countedAmount, "counted amount");
    const expected = moneySub(moneyAdd(shift.openingAmount, shift.capturedIn), shift.capturedOut);
    const difference = moneySub(countedFinal, expected);
    const settings = await shiftSettings();
    const diffAbs = moneyAbs(difference);
    const withinTolerance = moneyCompare(diffAbs, settings.tolerance) <= 0;
    const needsReason = moneyCompare(diffAbs, "0.0000") !== 0;

    if (!withinTolerance) {
      // Above tolerance: supervisor id + PIN + reason are all required.
      if (input.supervisorId === undefined || input.supervisorId.trim() === "") {
        throw new ShiftSupervisorRequiredError({ difference, tolerance: settings.tolerance });
      }
      if (input.reason === undefined || input.reason.trim() === "") {
        throw new ShiftReasonRequiredError();
      }
      if (settings.supervisorPin === "" || input.supervisorPin !== settings.supervisorPin) {
        throw new ShiftSupervisorPinInvalidError();
      }
    } else if (needsReason && (input.reason === undefined || input.reason.trim() === "")) {
      // Within tolerance but non-zero with tolerance 0: a reason documents it.
      throw new ShiftReasonRequiredError();
    }

    // Variance posting (auto-post path): DR CASH_DIFFERENCE · CR cash for a
    // shortage; DR cash · CR CASH_DIFFERENCE for an overage — shift source.
    let varianceJournalId: string | null = null;
    if (needsReason && settings.autoPost) {
      const account = requireActiveAccount(await store.findCashAccountById(shift.cashAccountId));
      const r1 = await resolveDocumentRate({
        currencyCode: shift.currencyCode,
        exchangeRate: shift.exchangeRate,
      });
      const base = await baseCurrency();
      const varianceBase = moneyMultiply(diffAbs, r1);
      const shortage = moneyCompare(difference, "0.0000") < 0;
      const lines: JournalLineSpec[] = shortage
        ? [
            { purpose: "CASH_DIFFERENCE", direction: "DEBIT", amount: diffAbs, memo: { en: "Cash shortage", ar: "عجز نقدي" } },
            { accountId: account.accountId, direction: "CREDIT", amount: diffAbs, memo: { en: `Shift ${shift.id} count`, ar: "فرق جرد الوردية" } },
          ]
        : [
            { accountId: account.accountId, direction: "DEBIT", amount: diffAbs, memo: { en: `Shift ${shift.id} count`, ar: "فرق جرد الوردية" } },
            { purpose: "CASH_DIFFERENCE", direction: "CREDIT", amount: diffAbs, memo: { en: "Cash overage", ar: "زيادة نقدية" } },
          ];
      const spec: JournalSpec = {
        source: { docType: "cashier_shift", docId: shift.id, operation: "variance" },
        entryDate: new Date().toISOString().slice(0, 10),
        description: { en: `Shift variance ${difference}`, ar: `فرق الوردية ${difference}` },
        currency: shift.currencyCode,
        exchangeRate: shift.currencyCode === base ? undefined : r1,
        lines,
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      varianceJournalId = result.journalEntryId;
      await store.insertCashMovement({
        cashAccountId: account.id,
        direction: shortage ? "OUT" : "IN",
        amount: diffAbs,
        currencyCode: shift.currencyCode,
        exchangeRate: r1,
        baseAmount: varianceBase,
        sourceType: "shift_variance",
        sourceId: shift.id,
        valueDate: spec.entryDate,
        memo: `shift variance ${difference}`,
      });
    }

    await store.closeShiftRecord({
      id: shift.id,
      countedAmount: countedFinal,
      expectedAmount: expected,
      difference,
      supervisorId: input.supervisorId ?? null,
      closeReason: input.reason ?? "",
      variancePostedJournalId: varianceJournalId,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "treasury.shift_closed",
      entityType: "cashier_shift",
      entityId: shift.id,
      actorId: input.actorId ?? undefined,
      before: { status: "OPEN", expected },
      after: {
        status: "CLOSED",
        counted: countedFinal,
        difference,
        withinTolerance,
        supervisorAttested: !withinTolerance,
        varianceJournalId,
        reason: input.reason ?? null,
      },
    });
    return this.find(shift.id);
  }

  async cancel(input: { id: string; reason: string; actorId: string | null }) {
    const shift = await this.find(input.id);
    if (shift.status !== "OPEN") {
      throw new TreasuryDocumentStateError(`shift ${input.id} is ${shift.status} — only OPEN shifts can cancel`);
    }
    await store.cancelShift({ id: input.id, actorId: input.actorId, reason: input.reason });
    await this.audit.record({
      action: "treasury.shift_cancelled",
      entityType: "cashier_shift",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      after: { reason: input.reason },
    });
    return this.find(input.id);
  }
}
