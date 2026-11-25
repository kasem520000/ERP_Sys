import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";

import * as store from "../infrastructure/trade.store";
import {
  collectionUsanceValid,
  nextCollectionMove,
  settlementPairValid,
  type CollectionStatus,
  type CollectionTerms,
} from "../domain/collections-lifecycle";
import {
  CollectionDuplicateError,
  CollectionRecordNotFoundError,
  CollectionSettlementInvalidError,
  CollectionStateError,
  CollectionUsanceError,
  TradeInputInvalidError,
} from "../domain/trade-errors";

/**
 * PHASE-051 (W-35 — T-07, 2026-11-25) THE DOCUMENTARY COLLECTIONS
 * ENGINE (L-02): the D/P and D/A register — create → present → accept
 * (the usance act, D/A only) → settle (the settlement linkage) — with
 * the cancel window at OPEN only (the 0119 stamp law's own exit).
 *
 *   THE REGISTER'S OWN SHAPE (the 0119 floors, rendered VERBATIM):
 *   the terms are D/P (documents against payment — at sight: the
 *   presentation leads directly to the settlement) or D/A (documents
 *   against acceptance — usance: the acceptance precedes the
 *   settlement, and the register carries its maturity date from birth,
 *   the 0119 usance floor); the documents set is the register's own
 *   JSONB array (the checklist the collecting bank presents — freely
 *   shaped by the tenant, typed at the surface); the stamps land on
 *   their own rungs only (the XOR floors — the CAS stamps satisfy them
 *   by the same statements that consume them).
 *
 *   THE SETTLEMENT LINKAGE (the phase doc's own wording): the settle
 *   act records the paid stamps TOGETHER with the settled pair —
 *   settled_at + settlement_ref (the reference names the treasury
 *   fact: the receipt or payment document that moved the money). THE
 *   REGISTER CARRIES NO GL ENTRY (the non-ledger-document law's trade
 *   face — the matrix's own wording: "the settlement linkage records
 *   the treasury fact; the money lands through the existing receipts
 *   discipline" — the reservation law rides it: no posting identifier
 *   is minted for a collection, G-64…G-66/INV-036/BR-105…BR-108
 *   untouched).
 *
 *   THE DECLARED INTERPRETATIONS (four, recorded at the claim sites):
 *   (1) THE REGISTER'S OFFICIAL NUMBER `COLL-{YYYY}-{SEQ:6}` IS
 *   RESERVED AT CREATE (the LC/NCR/INV-021 precedent — the register
 *   row is the audit trail from its first write); (2) THE MATURITY IS
 *   DATA, NEVER A GATE on the settle act (an early settlement is a
 *   real banking event — the drawee may pay before maturity; the
 *   register records the fact; the aging/alerting surfaces read the
 *   maturity, the W-40 contracts among them); (3) THE DOCUMENTS SET
 *   IS FROZEN AT CREATE (documents are lifecycle state machines — no
 *   PATCH surface, values ride create; the presented set is the
 *   created set); (4) THE AT-SIGHT ACCEPTANCE — a D/P collection
 *   settling from PRESENTED stamps its acceptance TOGETHER with the
 *   payment (the 0119 accepted_shape floor's own reading: a PAID row
 *   carries the full ceremony; the drawee's acceptance of the
 *   documents and the payment are one banking event at sight — the
 *   explicit ACCEPT ACT stays the D/A-only usance ceremony, the
 *   fold's own terms gate).
 *
 *   ONE ambient transaction per act (INV-018): the stamp and the audit
 *   record commit together or not at all — there is no journal to
 *   post, so the CAS stamp IS the act's whole write.
 */

/** Official collection numbers (INV-021/ADR-0006; the treasury
 * {PREFIX}-{YYYY}-{SEQ:6} convention, the LC/NCR precedent). */
export const COLLECTION_NUMBER_FORMAT = {
  prefix: "COLL",
  format: "COLL-{YYYY}-{SEQ:6}",
  docType: "documentary_collections",
} as const;

const DOCUMENT_ENTRY_RE = /^[A-Za-z0-9 _/-]{1,120}$/;

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new TradeInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function requirePositive(value: string, field: string): string {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new TradeInputInvalidError({ field, reason: `a positive decimal is required, got "${value}"` });
  }
  return amount.toFixed(4);
}

/** The audit action each move records (the act's own name). */
function auditActionOf(move: "present" | "accept" | "settle" | "cancel"): string {
  if (move === "present") return "trade.collection_presented";
  if (move === "accept") return "trade.collection_accepted";
  if (move === "settle") return "trade.collection_settled";
  return "trade.collection_cancelled";
}

@Injectable()
export class CollectionsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ── the register (the reads) ───────────────────────────────────────────

  async find(collectionId: string): Promise<store.CollectionRow> {
    requireUuid(collectionId, "id");
    const row = await store.findCollectionById(collectionId);
    if (row === undefined) throw new CollectionRecordNotFoundError({ collectionId });
    return row;
  }

  async list(filter: { status?: string }): Promise<store.CollectionRow[]> {
    return store.listCollections({ status: filter.status, limit: 200 });
  }

  // ── the create act (the register opens) ────────────────────────────────

  async create(input: {
    purchaseOrderId?: string | null;
    termsType: "D/P" | "D/A";
    amount: string;
    currency: string;
    dueDate?: string | null;
    documents: readonly string[];
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.CollectionRow> {
    if (input.termsType !== "D/P" && input.termsType !== "D/A") {
      throw new TradeInputInvalidError({
        field: "termsType",
        reason: `the terms are D/P (documents against payment) or D/A (documents against acceptance), got "${input.termsType}"`,
      });
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new TradeInputInvalidError({
        field: "currency",
        reason: `an ISO-4217 code is required (3 uppercase letters), got "${input.currency}"`,
      });
    }
    const amount = requirePositive(input.amount, "amount");
    const dueDate = input.dueDate ?? null;
    if (dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new TradeInputInvalidError({
        field: "dueDate",
        reason: `an ISO date (yyyy-mm-dd) is required, got "${dueDate}"`,
      });
    }
    // THE USANCE FLOOR (the fold's verdict, rendered VERBATIM — the
    // 0119 constraint's own law: a D/A collection carries its maturity
    // from birth; a D/P's due_date stays free).
    const usance = collectionUsanceValid(input.termsType, dueDate);
    if (!usance.valid) {
      throw new CollectionUsanceError({ termsType: input.termsType, reason: usance.reason! });
    }
    // The documents set (the register's own checklist — frozen at
    // create; the array floor the 0119 CHECK demands).
    if (input.documents.length === 0) {
      throw new TradeInputInvalidError({
        field: "documents",
        reason: "the documents set carries at least one document type (the set the collecting bank presents)",
      });
    }
    if (input.documents.length > 40) {
      throw new TradeInputInvalidError({
        field: "documents",
        reason: `at most 40 document entries are accepted, got ${input.documents.length}`,
      });
    }
    for (const entry of input.documents) {
      if (!DOCUMENT_ENTRY_RE.test(entry)) {
        throw new TradeInputInvalidError({
          field: "documents",
          reason: `a document entry is 1…120 chars of letters, digits, spaces, '_', '/', '-' — got "${entry}"`,
        });
      }
    }
    if (input.purchaseOrderId !== undefined && input.purchaseOrderId !== null) {
      requireUuid(input.purchaseOrderId, "purchaseOrderId");
    }

    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: COLLECTION_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: COLLECTION_NUMBER_FORMAT.format,
      prefix: COLLECTION_NUMBER_FORMAT.prefix,
      year,
    });
    if ((await store.findCollectionByNo(acquired.number)) !== undefined) {
      throw new CollectionDuplicateError({ collectionNo: acquired.number });
    }
    const row = await store.insertCollection({
      collectionNo: acquired.number,
      purchaseOrderId: input.purchaseOrderId ?? null,
      termsType: input.termsType,
      amount,
      currency: input.currency,
      dueDate,
      documents: input.documents,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.collection_created",
      entityType: "documentary_collections",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        collectionNo: row.collectionNo,
        termsType: row.termsType,
        currency: row.currency,
        amount: row.amount,
        dueDate: row.dueDate,
        documents: row.documents,
      },
    });
    return row;
  }

  // ── the lifecycle acts (the fold's verdict → the CAS stamp → the audit) ──

  async present(collectionId: string, input: { actorId: string | null }): Promise<store.CollectionRow> {
    return this.act(collectionId, "present", input, async (row) =>
      store.stampCollectionPresented({ id: row.id, actorId: input.actorId }),
    );
  }

  async accept(collectionId: string, input: { actorId: string | null }): Promise<store.CollectionRow> {
    return this.act(collectionId, "accept", input, async (row) =>
      store.stampCollectionAccepted({ id: row.id, actorId: input.actorId }),
    );
  }

  async settle(
    collectionId: string,
    input: { settlementRef: string; actorId: string | null },
  ): Promise<store.CollectionRow> {
    requireUuid(collectionId, "id");
    const row = await store.findCollectionById(collectionId);
    if (row === undefined) throw new CollectionRecordNotFoundError({ collectionId });
    const ref = input.settlementRef.trim();
    if (ref.length === 0 || ref.length > 200) {
      throw new CollectionSettlementInvalidError({
        collectionId: row.id,
        reason: "the settlement reference is 1…200 chars (the treasury fact the linkage names — the receipt or payment document)",
      });
    }
    // THE SETTLEMENT PAIR LAW (the fold's verdict): the settled pair
    // lands TOGETHER — the reference is the linkage's own name.
    const pair = settlementPairValid("settling", ref);
    if (!pair.valid) {
      throw new CollectionSettlementInvalidError({ collectionId: row.id, reason: pair.reason! });
    }
    return this.actOn(row, "settle", input.actorId, async (current) =>
      store.stampCollectionSettled({ id: current.id, settlementRef: ref, actorId: input.actorId }),
    );
  }

  async cancel(collectionId: string, input: { actorId: string | null }): Promise<store.CollectionRow> {
    return this.act(collectionId, "cancel", input, async (row) =>
      store.stampCollectionCancelled({ id: row.id, actorId: input.actorId }),
    );
  }

  // ── the shared act shape ───────────────────────────────────────────────

  private async act(
    collectionId: string,
    move: "present" | "accept" | "cancel",
    input: { actorId: string | null },
    stamp: (row: store.CollectionRow) => Promise<store.CollectionRow | undefined>,
  ): Promise<store.CollectionRow> {
    requireUuid(collectionId, "id");
    const row = await store.findCollectionById(collectionId);
    if (row === undefined) throw new CollectionRecordNotFoundError({ collectionId });
    return this.actOn(row, move, input.actorId, stamp);
  }

  /**
   * The act's own rendering: the fold's verdict (naming the register
   * and the illegal move's reason — the terms gate, the stamp law's
   * OPEN-only exit, the terminals) → the CAS stamp (zero rows = the
   * raced move, the typed state refusal) → the audit record (the same
   * ambient transaction — INV-018).
   */
  private async actOn(
    row: store.CollectionRow,
    move: "present" | "accept" | "settle" | "cancel",
    actorId: string | null,
    stamp: (row: store.CollectionRow) => Promise<store.CollectionRow | undefined>,
  ): Promise<store.CollectionRow> {
    const verdict = nextCollectionMove(
      row.status as CollectionStatus,
      move,
      row.termsType as CollectionTerms,
    );
    if (!verdict.allowed) {
      throw new CollectionStateError({
        collectionId: row.id,
        collectionNo: row.collectionNo,
        from: row.status,
        to: verdict.to ?? move.toUpperCase(),
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const stamped = await stamp(row);
    if (stamped === undefined) {
      throw new CollectionStateError({
        collectionId: row.id,
        collectionNo: row.collectionNo,
        from: row.status,
        to: verdict.to ?? move.toUpperCase(),
        reason: "the row moved under the act — the stamp is single-use",
      });
    }
    await this.audit.record({
      action: auditActionOf(move),
      entityType: "documentary_collections",
      entityId: row.id,
      actorId: actorId ?? undefined,
      before: { status: row.status },
      after: {
        status: stamped.status,
        ...(move === "settle" ? { settlementRef: stamped.settlementRef } : {}),
      },
    });
    return stamped;
  }
}
