import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  findCashAccountById,
  insertCashMovement,
  type CashAccountRow,
} from "../../treasury/infrastructure/treasury.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";

import * as store from "../infrastructure/trade.store";
import {
  amendmentTypedShapeValid,
  checklistTransitionValid,
  marginAdjustmentPlan,
  nextLcMove,
} from "../domain/lc-lifecycle";
import {
  LcAmendmentInvalidError,
  LcBankAccountInvalidError,
  LcChecklistStateError,
  LcDuplicateError,
  LcMarginShapeError,
  LcRecordNotFoundError,
  LcStateError,
  TradeInputInvalidError,
} from "../domain/trade-errors";

/**
 * PHASE-051 (W-34 — T-05 + T-06, 2026-11-25) THE LC ENGINE (L-01): the
 * letters-of-credit register's lifecycle — issue → amend (the typed
 * changes) → the documents checklist (the bank's ceremony with the
 * discrepancy notes) → retire — with G-64's postings (D-05) and the LC
 * fees on the EXISTING financial-charges discipline (D-05/D-21 — the
 * bank-charge pattern, zero new machinery, zero new identifier).
 *
 *   THE POSTING (G-64 — D-05, through the REAL posting engine):
 *   the margin deposit at issuance — **DR the purpose-mapped
 *   LC_MARGIN_DEPOSIT (the 0122 §8 marker, 1180 under 1150) · CR the
 *   tenant's chosen bank account** (the landed-cost charge-account
 *   discipline's own shape — an EXPLICIT cash account at the act, ACTIVE
 *   and in the LC's own currency, the treasury discipline's floor); the
 *   retirement (the settlement) REVERSES it — **DR the bank · CR
 *   LC_MARGIN_DEPOSIT**; an amendment that changes the margin adjusts
 *   through the SAME pair on its own single-use key (DR/CR by the
 *   adjustment's direction). Fail-closed PURPOSE_NOT_MAPPED until the
 *   tenant maps (the G-61 law — the engine's own refusal through the
 *   `purpose:` line); INV-013 single-use on **(lc, issue) / (lc,
 *   retirement) / (lc_amendment, id)**; ONE ambient transaction
 *   all-or-nothing (INV-018 — the journal, the treasury movement and the
 *   CAS stamp commit together or not at all).
 *
 *   THE FX RIDE (D-21 — the doc's integration scope): the LC amounts
 *   ride the EXISTING FX discipline at the contract rate — the postings
 *   carry the LC's own currency with the act's explicit rate when it
 *   differs from the base (the posting engine's own INV-008 capture; zero
 *   new FX code); the treasury movement records the same rate (INV-019
 *   exact — the movement's base equals the journal line's base).
 *
 *   THE FEES (T-06 — the bank-charge pattern, D-05's own law): an LC fee
 *   is a financial charge like any bank charge — **DR the purpose-mapped
 *   BANK_CHARGES · CR the tenant's chosen bank account** + the OUT
 *   treasury movement (INV-019), on the single-use source operation
 *   `fee_{seq}` (the INV-028 `op_<seq>` precedent — each fee act its own
 *   INV-013 key; a raced double-submit of the same sequence gets
 *   ALREADY_POSTED semantics, the engine's own law).
 *
 *   THE DECLARED INTERPRETATIONS (four, recorded at the claim sites):
 *   (1) THE MARGIN EXIT LAW — the deposit's only exit is the retirement
 *   pair; a margined instrument CANCELS never (the tenant retires it —
 *   the 0119 margin-shape floor's own reading: a CANCELLED row never
 *   carries the stamp); (2) THE RETIREMENT'S OWN SHAPE — the retirement
 *   reverses the live deposit (D-05's "reverses it"), so the act
 *   requires a live margin stamp (the margin-free instrument's exits are
 *   EXPIRED and CANCELLED — the register's honest vocabulary); (3) the
 *   register's official number `LC-{YYYY}-{SEQ:6}` is reserved AT CREATE
 *   (the NCR/INV-021 precedent — the register row is the audit trail
 *   from its first write; the provisional-to-official renumbering would
 *   rewrite the trail); (4) the EXPIRED rung is NOT terminal — an
 *   expired instrument RETIRES late (the settlement after expiry, the
 *   margin's own exit) or is CANCELLED when it carries no live margin.
 */

/** Official LC numbers (INV-021/ADR-0006; the treasury {PREFIX}-{YYYY}-
 * {SEQ:6} convention, the NCR precedent). */
export const LC_NUMBER_FORMAT = {
  prefix: "LC",
  format: "LC-{YYYY}-{SEQ:6}",
  docType: "letters_of_credit",
} as const;

const DOC_TYPE_RE = /^[A-Z0-9 _/-]{2,120}$/;

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new TradeInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** The money floor (ADR-0009's canonical 4dp strings, the positive
 * direction demanded by the act). */
function requirePositive(value: string, field: string): string {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new TradeInputInvalidError({ field, reason: `a positive decimal is required, got "${value}"` });
  }
  return amount.toFixed(4);
}

function requireNonNegative(value: string, field: string): string {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.lessThan(0)) {
    throw new TradeInputInvalidError({ field, reason: `a non-negative decimal is required, got "${value}"` });
  }
  return amount.toFixed(4);
}

/** The tenant's chosen bank account at the act — ACTIVE and in the LC's
 * own currency (the treasury discipline's floor, the transfer act's own
 * shape; the typed trade refusal names the account and the reason). */
async function requireBankAccount(
  bankAccountId: string | null,
  currency: string,
  lcId: string,
): Promise<CashAccountRow> {
  if (bankAccountId === null || bankAccountId === "") {
    throw new LcBankAccountInvalidError({
      lcId,
      bankAccountId: "none",
      reason: "the act requires the tenant's chosen bank account (an explicit account at the act — D-05's own shape)",
    });
  }
  const account = await findCashAccountById(bankAccountId);
  if (account === undefined) {
    throw new LcBankAccountInvalidError({
      lcId,
      bankAccountId,
      reason: "the cash account does not exist in this tenant",
    });
  }
  if (account.status === "CLOSED") {
    throw new LcBankAccountInvalidError({ lcId, bankAccountId, reason: "the cash account is CLOSED" });
  }
  if (account.currencyCode !== currency) {
    throw new LcBankAccountInvalidError({
      lcId,
      bankAccountId,
      reason: `the cash account is in ${account.currencyCode}, the LC is in ${currency} (the treasury discipline's floor)`,
    });
  }
  return account;
}

/** The FX ride (D-21): "1" at base; the act's explicit positive rate
 * otherwise (the posting engine's INV-008 capture is the floor; this is
 * the caller-side capture the treasury documents' own shape). */
async function resolveRate(currency: string, exchangeRate: string | null): Promise<string | undefined> {
  const base = await ownTenantBaseCurrency();
  if (currency === base) {
    return undefined;
  }
  if (exchangeRate === null || exchangeRate === "") {
    throw new TradeInputInvalidError({
      field: "exchangeRate",
      reason: `the LC is in ${currency} (base ${base}) — the contract rate is required at the act (the existing FX discipline)`,
    });
  }
  const rate = new Decimal(exchangeRate);
  if (!rate.isFinite() || rate.lessThanOrEqualTo(0)) {
    throw new TradeInputInvalidError({
      field: "exchangeRate",
      reason: `a positive contract rate is required, got "${exchangeRate}"`,
    });
  }
  return rate.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

/** The base amount of a document-currency figure at the resolved rate
 * (INV-019 exact — the treasury movement's base equals the journal
 * line's base by construction). */
function baseAmountAt(amount: string, rate: string | undefined): string {
  if (rate === undefined) {
    return amount;
  }
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

@Injectable()
export class LcService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  // ── the register (the reads + the DRAFT create) ───────────────────────

  async find(lcId: string): Promise<{
    lc: store.LcRow;
    amendments: store.LcAmendmentRow[];
    documents: store.LcDocumentRow[];
  }> {
    requireUuid(lcId, "id");
    const lc = await store.findLcById(lcId);
    if (lc === undefined) throw new LcRecordNotFoundError({ lcId });
    return {
      lc,
      amendments: await store.listLcAmendments(lcId),
      documents: await store.listLcDocuments(lcId),
    };
  }

  async list(filter: { status?: string }): Promise<store.LcRow[]> {
    return store.listLcs({ status: filter.status, limit: 200 });
  }

  async create(input: {
    purchaseOrderId?: string | null;
    currency: string;
    amount: string;
    marginAmount?: string | null;
    issuingBank: string;
    beneficiaryName: string;
    applicantName: string;
    expiryDate: string;
    exchangeRate?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.LcRow> {
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new TradeInputInvalidError({
        field: "currency",
        reason: `an ISO-4217 code is required (3 uppercase letters), got "${input.currency}"`,
      });
    }
    const amount = requirePositive(input.amount, "amount");
    const marginAmount =
      input.marginAmount === undefined || input.marginAmount === null
        ? "0.0000"
        : requireNonNegative(input.marginAmount, "marginAmount");
    for (const [field, value] of [
      ["issuingBank", input.issuingBank],
      ["beneficiaryName", input.beneficiaryName],
      ["applicantName", input.applicantName],
    ] as const) {
      if (value.trim().length === 0 || value.length > 500) {
        throw new TradeInputInvalidError({ field, reason: "1…500 chars are required" });
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) {
      throw new TradeInputInvalidError({
        field: "expiryDate",
        reason: `an ISO date (yyyy-mm-dd) is required, got "${input.expiryDate}"`,
      });
    }
    if (input.purchaseOrderId !== undefined && input.purchaseOrderId !== null) {
      requireUuid(input.purchaseOrderId, "purchaseOrderId");
    }
    // The contract rate is captured at create (the FX discipline's own
    // document shape — the rate rides the row's later acts; the honest
    // floor refuses a foreign-currency LC without it up front).
    await resolveRate(input.currency, input.exchangeRate ?? null);

    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: LC_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: LC_NUMBER_FORMAT.format,
      prefix: LC_NUMBER_FORMAT.prefix,
      year,
    });
    if ((await store.findLcByNo(acquired.number)) !== undefined) {
      throw new LcDuplicateError({ lcNo: acquired.number });
    }
    const row = await store.insertLc({
      lcNo: acquired.number,
      purchaseOrderId: input.purchaseOrderId ?? null,
      currency: input.currency,
      amount,
      marginAmount,
      issuingBank: input.issuingBank,
      beneficiaryName: input.beneficiaryName,
      applicantName: input.applicantName,
      expiryDate: input.expiryDate,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.lc_created",
      entityType: "letters_of_credit",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { lcNo: row.lcNo, currency: row.currency, amount: row.amount, marginAmount: row.marginAmount },
    });
    return row;
  }

  // ── THE ISSUE ACT (the G-64 margin deposit) ──────────────────────────

  /**
   * DRAFT → ISSUED — ONE ambient transaction, all-or-nothing: the
   * account resolved (fail-closed) → the G-64 deposit journal (INV-013
   * single-use on (lc, issue)) → the treasury movement (INV-019 exact)
   * → the CAS stamp (the status and the margin journal link land
   * together). A failure anywhere rolls everything back (the row stays
   * DRAFT, zero journal rows, zero movements).
   */
  async issue(
    lcId: string,
    input: {
      marginAmount?: string | null;
      bankAccountId?: string | null;
      exchangeRate?: string | null;
      entryDate?: string | null;
      actorId: string | null;
    },
  ): Promise<{ lc: store.LcRow; journalEntryId: string | null }> {
    requireUuid(lcId, "id");
    const row = await store.findLcById(lcId);
    if (row === undefined) throw new LcRecordNotFoundError({ lcId });
    const verdict = nextLcMove(row.status as "DRAFT", "issue");
    if (!verdict.allowed) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: row.status,
        to: "ISSUED",
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const margin =
      input.marginAmount === undefined || input.marginAmount === null
        ? row.marginAmount
        : requireNonNegative(input.marginAmount, "marginAmount");
    const entryDate = input.entryDate ?? todayIso();
    const rate = await resolveRate(row.currency, input.exchangeRate ?? null);

    let journalEntryId: string | null = null;
    if (new Decimal(margin).greaterThan(0)) {
      const account = await requireBankAccount(input.bankAccountId ?? null, row.currency, row.id);
      const lines: JournalLineSpec[] = [
        {
          purpose: "LC_MARGIN_DEPOSIT",
          direction: "DEBIT",
          amount: margin,
          memo: {
            en: `LC ${row.lcNo} — margin deposit at issuance (G-64)`,
            ar: `الاعتماد ${row.lcNo} — إيداع هامش الاعتماد عند الإصدار G-64`,
          },
        },
        {
          accountId: account.accountId,
          direction: "CREDIT",
          amount: margin,
          memo: {
            en: `LC ${row.lcNo} — margin blocked at ${account.name}`,
            ar: `الاعتماد ${row.lcNo} — الهامش المحجوز لدى ${account.name}`,
          },
        },
      ];
      const spec: JournalSpec = {
        source: { docType: "letters_of_credit", docId: row.id, operation: "issue" },
        entryDate,
        description: {
          en: `LC ${row.lcNo} — G-64 margin deposit`,
          ar: `الاعتماد ${row.lcNo} — إيداع هامش الاعتماد G-64`,
        },
        currency: row.currency,
        exchangeRate: rate,
        lines,
      };
      const posted = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = posted.journalEntryId;
      await insertCashMovement({
        cashAccountId: account.id,
        direction: "OUT",
        amount: margin,
        currencyCode: row.currency,
        exchangeRate: rate ?? "1",
        baseAmount: baseAmountAt(margin, rate),
        sourceType: "letters_of_credit",
        sourceId: row.id,
        valueDate: entryDate,
        memo: `LC ${row.lcNo} margin deposit (G-64)`,
        memoAr: `هامش الاعتماد ${row.lcNo} G-64`,
      });
    }
    // Zero margin: no deposit journal (the 0119 floor's own shape — the
    // stamp exists only on a real margin), the register still issues.
    const stamped = await store.stampLcIssued({
      id: row.id,
      marginJournalEntryId: journalEntryId,
      actorId: input.actorId,
    });
    if (stamped === undefined) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: "DRAFT",
        to: "ISSUED",
        reason: "the row moved under the act — the issue stamp is single-use",
      });
    }
    await this.audit.record({
      action: "trade.lc_issued",
      entityType: "letters_of_credit",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: { status: row.status, marginAmount: row.marginAmount },
      after: {
        status: stamped.status,
        marginAmount: stamped.marginAmount,
        journalEntryId,
      },
    });
    return { lc: stamped, journalEntryId };
  }

  // ── THE AMENDMENT ACT (the typed changes + the G-64 adjustments) ──────

  /**
   * ISSUED → ISSUED — the dated typed change with, when the margin
   * moves, the G-64 pair adjustment on the amendment's own single-use
   * key (lc_amendment, id). ONE ambient transaction: the amendment row →
   * the adjustment journal (only when the margin moves) → the CAS effect
   * write (the amount/expiry/margin land together with version+1).
   */
  async amend(
    lcId: string,
    input: {
      changeType: "VALUE" | "VALIDITY" | "DOCUMENTS" | "OTHER";
      valueFrom?: string | null;
      valueTo?: string | null;
      expiryFrom?: string | null;
      expiryTo?: string | null;
      documentsNote?: string | null;
      summary?: string | null;
      marginTo?: string | null;
      bankAccountId?: string | null;
      exchangeRate?: string | null;
      note?: string | null;
      actorId: string | null;
    },
  ): Promise<{
    amendment: store.LcAmendmentRow;
    lc: store.LcRow;
    journalEntryId: string | null;
  }> {
    requireUuid(lcId, "id");
    const row = await store.findLcById(lcId);
    if (row === undefined) throw new LcRecordNotFoundError({ lcId });
    const verdict = nextLcMove(row.status as "ISSUED", "amend");
    if (!verdict.allowed) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: row.status,
        to: "ISSUED",
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const shape = {
      changeType: input.changeType,
      valueFrom: input.valueFrom ?? null,
      valueTo: input.valueTo ?? null,
      expiryFrom: input.expiryFrom ?? null,
      expiryTo: input.expiryTo ?? null,
      documentsNote: input.documentsNote ?? null,
      summary: input.summary ?? null,
    };
    const shapeVerdict = amendmentTypedShapeValid(shape);
    if (!shapeVerdict.valid) {
      throw new LcAmendmentInvalidError({ lcId: row.id, reason: shapeVerdict.reason ?? "the typed shape is invalid" });
    }
    // THE FRESHNESS LAW (an amendment must change something): the typed
    // pair must differ; the typed from-values must match the live row
    // (the amendment changes the register's OWN values, never floats).
    if (shape.changeType === "VALUE") {
      const from = requirePositive(shape.valueFrom!, "valueFrom");
      const to = requirePositive(shape.valueTo!, "valueTo");
      if (new Decimal(from).equals(new Decimal(to))) {
        throw new LcAmendmentInvalidError({ lcId: row.id, reason: "the VALUE pair is unchanged — an amendment must change something" });
      }
      if (!new Decimal(from).equals(new Decimal(row.amount))) {
        throw new LcAmendmentInvalidError({
          lcId: row.id,
          reason: `the VALUE pair's from (${from}) must equal the live amount (${row.amount}) — the amendment changes the register's own value`,
        });
      }
    }
    if (shape.changeType === "VALIDITY") {
      if (shape.expiryFrom === shape.expiryTo) {
        throw new LcAmendmentInvalidError({ lcId: row.id, reason: "the VALIDITY pair is unchanged — an amendment must change something" });
      }
      if (shape.expiryFrom !== row.expiryDate) {
        throw new LcAmendmentInvalidError({
          lcId: row.id,
          reason: `the VALIDITY pair's from (${shape.expiryFrom}) must equal the live expiry (${row.expiryDate})`,
        });
      }
      // The 0119 validity floor, named BEFORE the posting (the DB is the
      // authority of last resort; the typed refusal is the caller's).
      if (shape.expiryTo! < row.issuedAt.slice(0, 10)) {
        throw new LcAmendmentInvalidError({
          lcId: row.id,
          reason: `the new expiry (${shape.expiryTo}) precedes the issuance (${row.issuedAt.slice(0, 10)}) — the 0119 validity floor`,
        });
      }
    }
    const marginTo =
      input.marginTo === undefined || input.marginTo === null
        ? null
        : requireNonNegative(input.marginTo, "marginTo");
    const entryDate = todayIso();
    const amendmentNo = await store.nextAmendmentNo(row.id);

    let journalEntryId: string | null = null;
    let bankForAdjustment: CashAccountRow | null = null;
    let adjustment: ReturnType<typeof marginAdjustmentPlan> | null = null;
    if (marginTo !== null) {
      const plan = marginAdjustmentPlan(row.marginAmount, marginTo);
      if (plan.direction !== "NONE") {
        adjustment = plan;
        bankForAdjustment = await requireBankAccount(
          input.bankAccountId ?? null,
          row.currency,
          row.id,
        );
      }
    }
    const rate = await resolveRate(row.currency, input.exchangeRate ?? null);

    const amendment = await store.insertLcAmendment({
      lcId: row.id,
      amendmentNo,
      changeType: shape.changeType,
      valueFrom: shape.valueFrom,
      valueTo: shape.valueTo,
      expiryFrom: shape.expiryFrom,
      expiryTo: shape.expiryTo,
      documentsNote: shape.documentsNote,
      summary: shape.summary,
      effectiveAt: nowIso(),
      note: input.note ?? null,
      actorId: input.actorId,
    });

    // THE G-64 ADJUSTMENT (D-05: "an amendment that changes the margin
    // adjusts through the same pair on its own single-use key") —
    // (lc_amendment, id): increase deposits more (DR the margin asset ·
    // CR the bank), decrease releases part (DR the bank · CR the margin
    // asset).
    if (adjustment !== null && bankForAdjustment !== null && adjustment.direction !== "NONE") {
      const lines: JournalLineSpec[] =
        adjustment.direction === "INCREASE"
          ? [
              {
                purpose: "LC_MARGIN_DEPOSIT",
                direction: "DEBIT",
                amount: adjustment.delta,
                memo: {
                  en: `LC ${row.lcNo} — amendment ${amendmentNo} margin increase (G-64)`,
                  ar: `الاعتماد ${row.lcNo} — التعديل ${amendmentNo} زيادة الهامش G-64`,
                },
              },
              {
                accountId: bankForAdjustment.accountId,
                direction: "CREDIT",
                amount: adjustment.delta,
                memo: {
                  en: `LC ${row.lcNo} — margin increase at ${bankForAdjustment.name}`,
                  ar: `الاعتماد ${row.lcNo} — زيادة الهامش لدى ${bankForAdjustment.name}`,
                },
              },
            ]
          : [
              {
                accountId: bankForAdjustment.accountId,
                direction: "DEBIT",
                amount: adjustment.delta,
                memo: {
                  en: `LC ${row.lcNo} — amendment ${amendmentNo} margin release at ${bankForAdjustment.name}`,
                  ar: `الاعتماد ${row.lcNo} — التعديل ${amendmentNo} الإفراج الجزئي عن الهامش لدى ${bankForAdjustment.name}`,
                },
              },
              {
                purpose: "LC_MARGIN_DEPOSIT",
                direction: "CREDIT",
                amount: adjustment.delta,
                memo: {
                  en: `LC ${row.lcNo} — amendment ${amendmentNo} margin release (G-64)`,
                  ar: `الاعتماد ${row.lcNo} — التعديل ${amendmentNo} الإفراج الجزئي عن الهامش G-64`,
                },
              },
            ];
      const spec: JournalSpec = {
        source: { docType: "lc_amendment", docId: amendment.id, operation: "amend" },
        entryDate,
        description: {
          en: `LC ${row.lcNo} — G-64 margin adjustment (amendment ${amendmentNo})`,
          ar: `الاعتماد ${row.lcNo} — تعديل هامش الاعتماد G-64 (التعديل ${amendmentNo})`,
        },
        currency: row.currency,
        exchangeRate: rate,
        lines,
      };
      const posted = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = posted.journalEntryId;
      await insertCashMovement({
        cashAccountId: bankForAdjustment.id,
        direction: adjustment.direction === "INCREASE" ? "OUT" : "IN",
        amount: adjustment.delta,
        currencyCode: row.currency,
        exchangeRate: rate ?? "1",
        baseAmount: baseAmountAt(adjustment.delta, rate),
        sourceType: "lc_amendment",
        sourceId: amendment.id,
        valueDate: entryDate,
        memo: `LC ${row.lcNo} margin adjustment (G-64 amendment ${amendmentNo})`,
        memoAr: `تعديل هامش الاعتماد ${row.lcNo} G-64 (التعديل ${amendmentNo})`,
      });
    }

    const updated = await store.applyLcAmendment({
      id: row.id,
      amount: shape.changeType === "VALUE" ? shape.valueTo : null,
      expiryDate: shape.changeType === "VALIDITY" ? shape.expiryTo : null,
      marginAmount: marginTo,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: row.status,
        to: "ISSUED",
        reason: "the row moved under the act — the amendment's effect write is single-use",
      });
    }
    await this.audit.record({
      action: "trade.lc_amended",
      entityType: "lc_amendment",
      entityId: amendment.id,
      actorId: input.actorId ?? undefined,
      before: { amount: row.amount, expiryDate: row.expiryDate, marginAmount: row.marginAmount },
      after: {
        amendmentNo,
        changeType: shape.changeType,
        amount: updated.amount,
        expiryDate: updated.expiryDate,
        marginAmount: updated.marginAmount,
        journalEntryId,
      },
    });
    return { amendment, lc: updated, journalEntryId };
  }

  // ── THE CHECKLIST ACT (the bank's documents ceremony) ─────────────────

  /**
   * The checklist write — one row per (lc, doc type): the monotone
   * stamps (presented/verified, never regressing — the 0119 floors'
   * fold) and the freely-recordable discrepancy notes (BR-105's own
   * anchor, the sweep's discrepancy arm reads them).
   */
  async recordDocument(
    lcId: string,
    input: {
      docType: string;
      presented?: boolean;
      verified?: boolean;
      discrepancyNotes?: string | null;
      note?: string | null;
      noteAr?: string | null;
      actorId: string | null;
    },
  ): Promise<store.LcDocumentRow> {
    requireUuid(lcId, "id");
    if (!DOC_TYPE_RE.test(input.docType)) {
      throw new TradeInputInvalidError({
        field: "docType",
        reason: `the document type must match ${DOC_TYPE_RE} (the 0119 checklist floor), got "${input.docType}"`,
      });
    }
    const lc = await store.findLcById(lcId);
    if (lc === undefined) throw new LcRecordNotFoundError({ lcId });
    const verdict = nextLcMove(lc.status as "ISSUED", "checklist");
    if (!verdict.allowed) {
      throw new LcStateError({
        lcId: lc.id,
        lcNo: lc.lcNo ?? "",
        from: lc.status,
        to: lc.status,
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const current = await store.findLcDocument(lcId, input.docType);
    const currentState = {
      presented: current?.presented ?? false,
      verified: current?.verified ?? false,
    };
    const nextState = {
      presented: input.presented ?? currentState.presented,
      verified: input.verified ?? currentState.verified,
    };
    const transition = checklistTransitionValid(currentState, nextState);
    if (!transition.allowed) {
      throw new LcChecklistStateError({
        lcId: lc.id,
        docType: input.docType,
        reason: transition.reason ?? "the checklist transition is illegal",
      });
    }
    // THE STAMPS: a stamp lands only on its own transition (presented_at
    // when presentation turns true — kept otherwise; verified_at when
    // verification turns true — the bank's own ceremony times).
    const presentedAt =
      nextState.presented && !currentState.presented
        ? nowIso()
        : current?.presentedAt ?? (nextState.presented ? nowIso() : null);
    const verifiedAt =
      nextState.verified && !currentState.verified
        ? nowIso()
        : current?.verifiedAt ?? (nextState.verified ? nowIso() : null);
    const row =
      current === undefined
        ? await store.insertLcDocument({
            lcId: lc.id,
            docType: input.docType,
            presented: nextState.presented,
            presentedAt,
            verified: nextState.verified,
            verifiedAt,
            discrepancyNotes: input.discrepancyNotes ?? null,
            actorId: input.actorId,
          })
        : await store.updateLcDocument({
            id: current.id,
            presented: nextState.presented,
            presentedAt,
            verified: nextState.verified,
            verifiedAt,
            discrepancyNotes:
              input.discrepancyNotes === undefined
                ? current.discrepancyNotes
                : input.discrepancyNotes,
            actorId: input.actorId,
          });
    if (row === undefined) {
      throw new LcChecklistStateError({
        lcId: lc.id,
        docType: input.docType,
        reason: "the row moved under the write — the checklist stamp is single-use",
      });
    }
    await this.audit.record({
      action: "trade.lc_document_recorded",
      entityType: "lc_documents",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: current === undefined ? undefined : { presented: currentState.presented, verified: currentState.verified },
      after: {
        docType: input.docType,
        presented: row.presented,
        verified: row.verified,
        hasDiscrepancy: row.discrepancyNotes !== null,
      },
    });
    return row;
  }

  // ── THE FEE ACT (T-06 — the financial-charges discipline) ─────────────

  /**
   * The LC fee — a financial charge like any bank charge (D-05/D-21's
   * own law, zero new machinery): DR the purpose-mapped BANK_CHARGES ·
   * CR the tenant's chosen bank account, on the single-use source
   * operation `fee_{seq}` (the INV-028 `op_<seq>` precedent) + the OUT
   * treasury movement (INV-019 exact).
   */
  async fee(
    lcId: string,
    input: {
      amount: string;
      bankAccountId: string;
      exchangeRate?: string | null;
      entryDate?: string | null;
      memo?: string | null;
      actorId: string | null;
    },
  ): Promise<{ journalEntryId: string; feeSequence: number }> {
    requireUuid(lcId, "id");
    requireUuid(input.bankAccountId, "bankAccountId");
    const amount = requirePositive(input.amount, "amount");
    const row = await store.findLcById(lcId);
    if (row === undefined) throw new LcRecordNotFoundError({ lcId });
    const verdict = nextLcMove(row.status as "ISSUED", "fee");
    if (!verdict.allowed) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: row.status,
        to: row.status,
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const account = await requireBankAccount(input.bankAccountId, row.currency, row.id);
    const rate = await resolveRate(row.currency, input.exchangeRate ?? null);
    const entryDate = input.entryDate ?? todayIso();
    const feeSequence = await store.nextLcFeeSequence(row.id);

    const lines: JournalLineSpec[] = [
      {
        purpose: "BANK_CHARGES",
        direction: "DEBIT",
        amount,
        memo: {
          en: input.memo ?? `LC ${row.lcNo} — letter-of-credit fee`,
          ar: `الاعتماد ${row.lcNo} — رسوم اعتماد مستندي`,
        },
      },
      {
        accountId: account.accountId,
        direction: "CREDIT",
        amount,
        memo: {
          en: `LC ${row.lcNo} — fee charged at ${account.name}`,
          ar: `الاعتماد ${row.lcNo} — الرسوم محصّلة لدى ${account.name}`,
        },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "letters_of_credit", docId: row.id, operation: `fee_${feeSequence}` },
      entryDate,
      description: {
        en: `LC ${row.lcNo} — LC fee (financial charge)`,
        ar: `الاعتماد ${row.lcNo} — رسوم الاعتماد (مصاريف مالية)`,
      },
      currency: row.currency,
      exchangeRate: rate,
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });
    await insertCashMovement({
      cashAccountId: account.id,
      direction: "OUT",
      amount,
      currencyCode: row.currency,
      exchangeRate: rate ?? "1",
      baseAmount: baseAmountAt(amount, rate),
      sourceType: "letters_of_credit",
      sourceId: row.id,
      valueDate: entryDate,
      memo: `LC ${row.lcNo} fee (financial charge)`,
      memoAr: `رسوم الاعتماد ${row.lcNo} (مصاريف مالية)`,
    });
    await this.audit.record({
      action: "trade.lc_fee_charged",
      entityType: "letters_of_credit",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { amount, feeSequence, journalEntryId: posted.journalEntryId, bankAccount: account.name },
    });
    return { journalEntryId: posted.journalEntryId, feeSequence };
  }

  // ── THE RETIREMENT ACT (the G-64 reversal) ────────────────────────────

  /**
   * ISSUED/EXPIRED → RETIRED — the settlement: the retirement REVERSES
   * the live margin deposit (DR the bank · CR LC_MARGIN_DEPOSIT on the
   * (lc, retirement) single-use key) and the settled pair + the journal
   * link land TOGETHER in the CAS stamp (the 0119 retirement-shape
   * floor satisfied by the same statement). THE DECLARED SHAPE: the act
   * requires a live margin stamp — the retirement reverses the deposit
   * (D-05's "reverses it"); the margin-free instrument's exits are
   * EXPIRED and CANCELLED (the register's honest vocabulary).
   */
  async retire(
    lcId: string,
    input: {
      bankAccountId?: string | null;
      exchangeRate?: string | null;
      entryDate?: string | null;
      actorId: string | null;
    },
  ): Promise<{ lc: store.LcRow; journalEntryId: string }> {
    requireUuid(lcId, "id");
    const row = await store.findLcById(lcId);
    if (row === undefined) throw new LcRecordNotFoundError({ lcId });
    const verdict = nextLcMove(row.status as "ISSUED", "retire");
    if (!verdict.allowed) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: row.status,
        to: "RETIRED",
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    if (row.marginJournalEntryId === null || new Decimal(row.marginAmount).lessThanOrEqualTo(0)) {
      throw new LcMarginShapeError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        reason:
          "the retirement reverses the live margin deposit — this instrument carries none (the margin-free exits are EXPIRED and CANCELLED)",
      });
    }
    const account = await requireBankAccount(input.bankAccountId ?? null, row.currency, row.id);
    const rate = await resolveRate(row.currency, input.exchangeRate ?? null);
    const entryDate = input.entryDate ?? todayIso();

    const lines: JournalLineSpec[] = [
      {
        accountId: account.accountId,
        direction: "DEBIT",
        amount: row.marginAmount,
        memo: {
          en: `LC ${row.lcNo} — margin released at settlement (G-64)`,
          ar: `الاعتماد ${row.lcNo} — الإفراج عن الهامش عند التسوية G-64`,
        },
      },
      {
        purpose: "LC_MARGIN_DEPOSIT",
        direction: "CREDIT",
        amount: row.marginAmount,
        memo: {
          en: `LC ${row.lcNo} — margin retirement reversal (G-64)`,
          ar: `الاعتماد ${row.lcNo} — عكس إيداع الهامش عند التسوية G-64`,
        },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "letters_of_credit", docId: row.id, operation: "retirement" },
      entryDate,
      description: {
        en: `LC ${row.lcNo} — G-64 margin retirement`,
        ar: `الاعتماد ${row.lcNo} — تسوية هامش الاعتماد G-64`,
      },
      currency: row.currency,
      exchangeRate: rate,
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });
    await insertCashMovement({
      cashAccountId: account.id,
      direction: "IN",
      amount: row.marginAmount,
      currencyCode: row.currency,
      exchangeRate: rate ?? "1",
      baseAmount: baseAmountAt(row.marginAmount, rate),
      sourceType: "letters_of_credit",
      sourceId: row.id,
      valueDate: entryDate,
      memo: `LC ${row.lcNo} margin release (G-64 retirement)`,
      memoAr: `الإفراج عن هامش الاعتماد ${row.lcNo} G-64`,
    });
    const stamped = await store.stampLcRetired({
      id: row.id,
      retirementJournalEntryId: posted.journalEntryId,
      settledAt: nowIso(),
      actorId: input.actorId,
    });
    if (stamped === undefined) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: row.status,
        to: "RETIRED",
        reason: "the row moved under the act — the retirement stamp is single-use",
      });
    }
    await this.audit.record({
      action: "trade.lc_retired",
      entityType: "letters_of_credit",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: { status: row.status, marginAmount: row.marginAmount },
      after: { status: stamped.status, journalEntryId: posted.journalEntryId, marginAmount: stamped.marginAmount },
    });
    return { lc: stamped, journalEntryId: posted.journalEntryId };
  }

  // ── THE CANCEL ACT (the tenant's withdrawal) ──────────────────────────

  /**
   * DRAFT/ISSUED → CANCELLED — THE MARGIN EXIT LAW: a margined
   * instrument cancels NEVER (the deposit's exit is the retirement pair
   * — the 0119 margin-shape floor's own reading); the margin-free paths
   * cancel freely.
   */
  async cancel(lcId: string, input: { actorId: string | null }): Promise<store.LcRow> {
    requireUuid(lcId, "id");
    const row = await store.findLcById(lcId);
    if (row === undefined) throw new LcRecordNotFoundError({ lcId });
    const verdict = nextLcMove(row.status as "DRAFT", "cancel");
    if (!verdict.allowed) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: row.status,
        to: "CANCELLED",
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    if (row.marginJournalEntryId !== null) {
      throw new LcMarginShapeError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        marginAmount: row.marginAmount,
        reason: "the margin deposit's exit is the retirement pair — retire the instrument instead (the cancellation never strands a blocked deposit)",
      });
    }
    const stamped = await store.stampLcCancelled({ id: row.id, actorId: input.actorId });
    if (stamped === undefined) {
      throw new LcStateError({
        lcId: row.id,
        lcNo: row.lcNo ?? "",
        from: row.status,
        to: "CANCELLED",
        reason: "the row moved under the act — the cancel stamp is single-use",
      });
    }
    await this.audit.record({
      action: "trade.lc_cancelled",
      entityType: "letters_of_credit",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: { status: row.status },
      after: { status: stamped.status },
    });
    return stamped;
  }
}
