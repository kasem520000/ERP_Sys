import { Decimal } from "@erp/domain-core";

import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";
import { PostingService } from "../../accounting/application/posting-service";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  AllocationExceedsDocumentError,
  AllocationExceedsOpenItemError,
  OpenItemCurrencyMismatchError,
  OpenItemNotFoundError,
  OpenItemPartnerMismatchError,
  OpenItemSideInvalidError,
} from "../../treasury/domain/treasury-errors";
import {
  type OpenItemRow,
  findOpenItemById,
  listOpenItems,
  lockOpenItemAndSumPostedAllocations,
} from "../../treasury/infrastructure/treasury.store";
import { findPartnerById } from "../../partners/infrastructure/partners.store";
import { NotePartnerNotFoundError, NoteSourceInvalidError } from "../domain/notes-errors";
import type { NoteRow } from "../infrastructure/notes.store";

/**
 * The shared note allocation machinery (PHASE-027 T3 — the "standard
 * allocation machinery" the phase doc mandates): notes settle AR/AP open
 * items exactly the way receipts/payments do —
 *
 *  - explicit allocations (or the single-source default: allocate up to the
 *    invoice item's outstanding), remainder on-account (BR-027);
 *  - INV-016 both bounds: the document bound (Σ allocations ≤ note amount)
 *    and the per-open-item bound recomputed under the CC-02 advisory lock —
 *    the SettlementCore.validateAllocationsUnderLock mirror (never trust a
 *    draft-time snapshot), with the SAME typed treasury error codes;
 *  - INV-008 for foreign notes: the note settles each item at the ITEM's
 *    original stored rate, so the note's stored rate must match (typed
 *    NOTE_RATE_MISMATCH); FX movement accrues to collection (G-25 residual).
 *
 * The create journals post BASE-DENOMINATED with explicit base line amounts
 * (the fx-settlement precedent — receipts post the same way): the GL is
 * always base; document currencies enter via their stored rates.
 */

/** Resolve a source invoice's open item (the settle target). Typed 404s on the way. */
export async function loadOpenItemForSource(input: {
  partnerId: string;
  sourceType: "sales_invoice" | "supplier_invoice";
  sourceId: string;
}): Promise<OpenItemRow> {
  const side = input.sourceType === "sales_invoice" ? "AR" : "AP";
  const items = await listOpenItems({
    partnerId: input.partnerId,
    side,
    openOnly: true,
    limit: 200,
  });
  const item = items.find(
    (row) => row.sourceType === input.sourceType && row.sourceId === input.sourceId,
  );
  if (item === undefined) {
    throw new NoteSourceInvalidError({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reason: "no open item outstanding for this partner (already settled?)",
    });
  }
  return item;
}

export interface NoteAllocationInput {
  openItemId: string;
  amount: string;
}

/**
 * INV-016 under lock (the SettlementCore mirror): document bound first, then
 * per item under `pg_advisory_xact_lock` recomputing Σ effective allocations
 * (note-owned rows are effective by presence). Returns the validated list
 * with each row's base (allocation × the item's stored rate).
 */
export async function validateNoteAllocationsUnderLock(input: {
  noteId: string;
  noteAmount: string;
  noteCurrency: string;
  partnerId: string;
  side: "AR" | "AP";
  allocations: readonly NoteAllocationInput[];
}): Promise<{ validated: { openItemId: string; amount: string; base: string; rate: string }[] }> {
  // (1) document bound (same currency — the caller asserted currency match).
  let allocated = "0.0000";
  for (const allocation of input.allocations) {
    allocated = addExact(allocated, allocation.amount);
  }
  if (compareExact(allocated, input.noteAmount) > 0) {
    throw new AllocationExceedsDocumentError({
      allocated,
      amount: input.noteAmount,
    });
  }
  // (2) per-open-item bound under the CC-02 row lock + the partner/currency/
  // side asserts (the same typed treasury codes the receipt path throws).
  const validated: { openItemId: string; amount: string; base: string; rate: string }[] = [];
  for (const allocation of input.allocations) {
    const item = await findOpenItemById(allocation.openItemId);
    if (item === undefined) {
      throw new OpenItemNotFoundError(allocation.openItemId);
    }
    if (item.partnerId !== input.partnerId) {
      throw new OpenItemPartnerMismatchError({
        openItemPartnerId: item.partnerId,
        documentPartnerId: input.partnerId,
      });
    }
    if (item.currencyCode !== input.noteCurrency) {
      throw new OpenItemCurrencyMismatchError({
        openItemCurrency: item.currencyCode,
        documentCurrency: input.noteCurrency,
      });
    }
    const expectedDirection = input.side === "AR" ? "DEBIT" : "CREDIT";
    if (item.direction !== expectedDirection) {
      throw new OpenItemSideInvalidError({
        documentType: "note",
        requiredSide: input.side,
      });
    }
    const settled = await lockOpenItemAndSumPostedAllocations(item.id);
    const outstanding = subExact(item.amount, settled);
    if (compareExact(allocation.amount, outstanding) > 0) {
      throw new AllocationExceedsOpenItemError({
        openItemId: item.id,
        allocated: allocation.amount,
        outstanding,
      });
    }
    validated.push({
      openItemId: item.id,
      amount: allocation.amount,
      base: moneyRate(allocation.amount, item.exchangeRate),
      rate: item.exchangeRate,
    });
  }
  return { validated };
}

/** amount × rate, canonical 4dp (the moneyMultiply discipline — no Math.*). */
function moneyRate(amount: string, rate: string): string {
  // Decimal via the shared helper set: allocation amounts are 4dp, item
  // rates ≤ 6dp — the product normalizes to 4dp exactly like
  // SettlementCore's moneyMultiply(amount, item.exchangeRate).
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4).toFixed(4);
}

/** The tenant base currency (SAR unless provisioned otherwise). */
export async function tenantBaseCurrency(): Promise<string> {
  return ownTenantBaseCurrency();
}

/** Resolve the note's effective rate: 1 for base currency, the stored rate otherwise. */
export function effectiveNoteRate(note: { currency: string; exchangeRate: string }, base: string): string {
  return note.currency === base ? "1" : note.exchangeRate;
}

/** Resolve + validate the note partner (typed 404 — the spoof shape). */
export async function requireNotePartner(partnerId: string): Promise<void> {
  const partner = await findPartnerById(partnerId);
  if (partner === undefined) {
    throw new NotePartnerNotFoundError(partnerId);
  }
}

/**
 * The G-24 create journal (RECEIVED): `DR NOTES_RECEIVABLE · CR AR_CONTROL`
 * (allocated portion at the items' original stored rates; on-account portion
 * at the note's stored rate) — BASE-denominated, one entry, INV-013 source
 * {docType: "note", docId, operation: "post"}.
 */
export async function postG24(
  posting: PostingService,
  input: {
    note: NoteRow;
    base: string;
    rate: string;
    allocatedBase: string;
    onAccountBase: string;
    entryDate: string;
    postedBy: string | null;
  },
): Promise<{ journalEntryId: string; entryNo: string | null; idempotentReplay: boolean }> {
  const lines: JournalLineSpec[] = [
    {
      purpose: "NOTES_RECEIVABLE",
      direction: "DEBIT",
      amount: moneyRate(input.note.amount, input.rate),
      memo: {
        en: `Note ${input.note.number ?? input.note.id} received into custody (G-24)`,
        ar: `استلام ${input.note.number ?? input.note.id} في العهدة (G-24)`,
      },
    },
    {
      purpose: "AR_CONTROL",
      direction: "CREDIT",
      amount: input.allocatedBase,
      partnerId: input.note.partnerId,
      memo: {
        en: "Settlement of open items (original stored rate, INV-008)",
        ar: "تسوية بنود مفتوحة (السعر الأصلي المخزن، INV-008)",
      },
    },
  ];
  if (compareExact(input.onAccountBase, "0.0000") !== 0) {
    lines.push({
      purpose: "AR_CONTROL",
      direction: "CREDIT",
      amount: input.onAccountBase,
      partnerId: input.note.partnerId,
      memo: {
        en: "On-account (unallocated — BR-027)",
        ar: "دفعة غير مخصصة (BR-027)",
      },
    });
  }
  const spec: JournalSpec = {
    source: { docType: "note", docId: input.note.id, operation: "post" },
    entryDate: input.entryDate,
    description: {
      en: `Note received ${input.note.number ?? input.note.id} — ${input.note.kind === "CHEQUE" ? "cheque" : "promissory note"} (G-24)`,
      ar: `ورقة قبض ${input.note.number ?? input.note.id} — ${input.note.kind === "CHEQUE" ? "شيك" : "كمبيالة"} (G-24)`,
    },
    currency: input.base,
    lines,
  };
  const result = await posting.post(spec, { postedBy: input.postedBy });
  return {
    journalEntryId: result.journalEntryId,
    entryNo: result.entryNo,
    idempotentReplay: result.idempotentReplay,
  };
}

/**
 * The G-27 first leg (ISSUED): `DR AP_CONTROL · CR NOTES_PAYABLE` — the AP
 * mirror of G-24 (allocated at the item rates, on-account at the note rate).
 */
export async function postG27(
  posting: PostingService,
  input: {
    note: NoteRow;
    base: string;
    rate: string;
    allocatedBase: string;
    onAccountBase: string;
    entryDate: string;
    postedBy: string | null;
  },
): Promise<{ journalEntryId: string; entryNo: string | null; idempotentReplay: boolean }> {
  const lines: JournalLineSpec[] = [
    {
      purpose: "AP_CONTROL",
      direction: "DEBIT",
      amount: input.allocatedBase,
      partnerId: input.note.partnerId,
      memo: {
        en: "Settlement of open items (original stored rate, INV-008)",
        ar: "تسوية بنود مفتوحة (السعر الأصلي المخزن، INV-008)",
      },
    },
  ];
  if (compareExact(input.onAccountBase, "0.0000") !== 0) {
    lines.push({
      purpose: "AP_CONTROL",
      direction: "DEBIT",
      amount: input.onAccountBase,
      partnerId: input.note.partnerId,
      memo: {
        en: "On-account (unallocated — BR-027)",
        ar: "دفعة غير مخصصة (BR-027)",
      },
    });
  }
  lines.push({
    purpose: "NOTES_PAYABLE",
    direction: "CREDIT",
    amount: moneyRate(input.note.amount, input.rate),
    memo: {
      en: `Note issued ${input.note.number ?? input.note.id} (G-27)`,
      ar: `إصدار ورقة دفع ${input.note.number ?? input.note.id} (G-27)`,
    },
  });
  const spec: JournalSpec = {
    source: { docType: "note", docId: input.note.id, operation: "post" },
    entryDate: input.entryDate,
    description: {
      en: `Note issued ${input.note.number ?? input.note.id} — ${input.note.kind === "CHEQUE" ? "cheque" : "promissory note"} (G-27)`,
      ar: `إصدار ${input.note.number ?? input.note.id} — ${input.note.kind === "CHEQUE" ? "شيك" : "كمبيالة"} (G-27)`,
    },
    currency: input.base,
    lines,
  };
  const result = await posting.post(spec, { postedBy: input.postedBy });
  return {
    journalEntryId: result.journalEntryId,
    entryNo: result.entryNo,
    idempotentReplay: result.idempotentReplay,
  };
}
