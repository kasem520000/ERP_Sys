import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";

import * as store from "../infrastructure/trade.store";
import {
  BlDuplicateError,
  BlRecordNotFoundError,
  PackingListDuplicateError,
  TransportInputInvalidError,
} from "../domain/trade-errors";

/**
 * PHASE-051 (W-36 — T-09, 2026-11-25) THE TRANSPORT DOCUMENTS ENGINE
 * (L-04/L-05/L-13): the bills of lading — THE SHIPMENT'S OWN ANCHOR
 * (the declared interpretation recorded at the 0120 claim site: the
 * fourteen-table budget has no separate shipments table, the B/L's
 * carriage contract IS the shipment's identity, the tracking events
 * link it NOT NULL) — with the multimodal doc types (SEA/AIR/ROAD/
 * RAIL/MULTIMODAL — the document types cover multimodal trade), and
 * the packing lists tied to the shipment with the line-level pack
 * shapes.
 *
 *   THE REGISTER'S OWN SHAPE (the 0120 floors, rendered VERBATIM): the
 *   B/L's official number `BL-{YYYY}-{SEQ:6}` reserves AT CREATE (the
 *   LC/COLL/NCR/INV-021 precedent — the register row is the audit
 *   trail from its first write); the commercial links ride the row
 *   (the PO import leg + the delivery-note export leg — acceptance
 *   #8's chain navigable end-to-end: PO → LC/collection → transport
 *   documents → declaration → receipt → landed cost); the container
 *   refs ride as JSONB data; the shipment_status NEVER moves by hand —
 *   THE FOLD DRIVES IT (D-14: the tracking events' drive, the monotone
 *   ladder; the transport service exposes NO status write — the
 *   document's status is the fold's own output, zero parallel
 *   computation).
 *
 *   THE PACKING LISTS: the official `PL-{YYYY}-{SEQ:6}`; the B/L link
 *   REQUIRED (the declared interpretation: the packing list is the
 *   shipment's packing document, the B/L its anchor — the 0120 FK is
 *   nullable for the legacy/raw plane but the SERVICE floor demands
 *   the shipment); the receipt link optional (the landed receipt the
 *   packing fed); the lines validated as the pack shapes — each
 *   entry: description 1…200 · packages a positive integer · gross/net
 *   kilograms non-negative ≤ 3dp · GROSS ≥ NET (the physical law,
 *   recorded here at the claim site).
 *
 *   ONE ambient transaction per act (INV-018); NO journal, NO ledger
 *   effect anywhere (the transport documents are shipping evidence,
 *   not ledger documents — the non-ledger-document law's trade face;
 *   the reservations law rides it: no posting identifier minted,
 *   G-64…G-66/INV-036/BR-105…BR-108 untouched).
 */

/** Official B/L numbers (INV-021/ADR-0006; the treasury
 * {PREFIX}-{YYYY}-{SEQ:6} convention, the LC/COLL precedent). */
export const BL_NUMBER_FORMAT = {
  prefix: "BL",
  format: "BL-{YYYY}-{SEQ:6}",
  docType: "bills_of_lading",
} as const;

/** Official packing-list numbers (the same convention). */
export const PL_NUMBER_FORMAT = {
  prefix: "PL",
  format: "PL-{YYYY}-{SEQ:6}",
  docType: "packing_lists",
} as const;

/** The 0120 multimodal vocabulary (ck_bills_of_lading_doc_type's list). */
export const BL_DOC_TYPES = ["SEA", "AIR", "ROAD", "RAIL", "MULTIMODAL"] as const;
export type BlDocType = (typeof BL_DOC_TYPES)[number];

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new TransportInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The pack-line shape (the 0120 lines jsonb array's own grammar). */
export interface PackLineInput {
  description: string;
  packages: number;
  grossKg: string;
  netKg: string;
}

const KG_RE = /^\d+(\.\d{1,3})?$/;

function requirePackLine(line: PackLineInput, index: number): Record<string, unknown> {
  const field = `lines[${index}]`;
  if (line.description.trim().length === 0 || line.description.length > 200) {
    throw new TransportInputInvalidError({
      field: `${field}.description`,
      reason: `1…200 chars are required, got "${line.description}"`,
    });
  }
  if (!Number.isSafeInteger(line.packages) || line.packages <= 0 || line.packages > 1_000_000_000) {
    throw new TransportInputInvalidError({
      field: `${field}.packages`,
      reason: `a positive integer package count is required, got ${line.packages}`,
    });
  }
  for (const [name, value] of [
    ["grossKg", line.grossKg],
    ["netKg", line.netKg],
  ] as const) {
    if (!KG_RE.test(value) || new Decimal(value).lessThan(0)) {
      throw new TransportInputInvalidError({
        field: `${field}.${name}`,
        reason: `a non-negative kilogram decimal (≤ 3dp) is required, got "${value}"`,
      });
    }
  }
  // THE PHYSICAL LAW (recorded at the claim site): the gross weight
  // carries the packaging — it is never below the net.
  if (new Decimal(line.grossKg).lessThan(new Decimal(line.netKg))) {
    throw new TransportInputInvalidError({
      field: `${field}.grossKg`,
      reason: `the gross weight (${line.grossKg}kg) is below the net (${line.netKg}kg) — the gross carries the packaging, never the reverse`,
    });
  }
  return {
    description: line.description.trim(),
    packages: line.packages,
    grossKg: line.grossKg,
    netKg: line.netKg,
  };
}

@Injectable()
export class TransportService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ── the bills of lading (the reads + the create) ─────────────────────

  async findBl(blId: string): Promise<{
    bl: store.BillOfLadingRow;
    packingLists: store.PackingListRow[];
    events: store.TrackingEventRow[];
  }> {
    requireUuid(blId, "id");
    const bl = await store.findBlById(blId);
    if (bl === undefined) throw new BlRecordNotFoundError({ blId });
    return {
      bl,
      packingLists: await store.listPackingLists({ billOfLadingId: bl.id, limit: 100 }),
      events: await store.listTrackingEvents({ billOfLadingId: bl.id, limit: 100 }),
    };
  }

  async listBls(filter: { docType?: string; shipmentStatus?: string }): Promise<store.BillOfLadingRow[]> {
    return store.listBls({ docType: filter.docType, shipmentStatus: filter.shipmentStatus, limit: 200 });
  }

  async createBl(input: {
    docType: BlDocType;
    carrierName: string;
    portOfLoading?: string | null;
    portOfDischarge?: string | null;
    containerRefs?: readonly string[];
    purchaseOrderId?: string | null;
    deliveryNoteId?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.BillOfLadingRow> {
    if (!BL_DOC_TYPES.includes(input.docType)) {
      throw new TransportInputInvalidError({
        field: "docType",
        reason: `the multimodal vocabulary is ${BL_DOC_TYPES.join("/")}, got "${input.docType}"`,
      });
    }
    if (input.carrierName.trim().length === 0 || input.carrierName.length > 500) {
      throw new TransportInputInvalidError({
        field: "carrierName",
        reason: "1…500 chars are required (the carriage contract's carrier)",
      });
    }
    for (const [field, value] of [
      ["portOfLoading", input.portOfLoading ?? null],
      ["portOfDischarge", input.portOfDischarge ?? null],
    ] as const) {
      if (value !== null && (value.trim().length === 0 || value.length > 200)) {
        throw new TransportInputInvalidError({ field, reason: "1…200 chars are required when present" });
      }
    }
    const containerRefs = input.containerRefs ?? [];
    if (containerRefs.length > 50) {
      throw new TransportInputInvalidError({
        field: "containerRefs",
        reason: `at most 50 container references are accepted, got ${containerRefs.length}`,
      });
    }
    for (const ref of containerRefs) {
      if (ref.trim().length === 0 || ref.length > 50) {
        throw new TransportInputInvalidError({
          field: "containerRefs",
          reason: `a container reference is 1…50 chars, got "${ref}"`,
        });
      }
    }
    if (input.purchaseOrderId !== undefined && input.purchaseOrderId !== null) {
      requireUuid(input.purchaseOrderId, "purchaseOrderId");
    }
    if (input.deliveryNoteId !== undefined && input.deliveryNoteId !== null) {
      requireUuid(input.deliveryNoteId, "deliveryNoteId");
    }

    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: BL_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: BL_NUMBER_FORMAT.format,
      prefix: BL_NUMBER_FORMAT.prefix,
      year,
    });
    if ((await store.findBlByNo(acquired.number)) !== undefined) {
      throw new BlDuplicateError({ blNo: acquired.number });
    }
    const row = await store.insertBl({
      blNo: acquired.number,
      docType: input.docType,
      carrierName: input.carrierName.trim(),
      portOfLoading: input.portOfLoading?.trim() || null,
      portOfDischarge: input.portOfDischarge?.trim() || null,
      containerRefs,
      purchaseOrderId: input.purchaseOrderId ?? null,
      deliveryNoteId: input.deliveryNoteId ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.bl_created",
      entityType: "bills_of_lading",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        blNo: row.blNo,
        docType: row.docType,
        carrierName: row.carrierName,
        purchaseOrderId: row.purchaseOrderId,
        deliveryNoteId: row.deliveryNoteId,
      },
    });
    return row;
  }

  // ── the packing lists (the reads + the create) ───────────────────────

  async listPackingLists(filter: { billOfLadingId?: string }): Promise<store.PackingListRow[]> {
    if (filter.billOfLadingId !== undefined) {
      requireUuid(filter.billOfLadingId, "billOfLadingId");
    }
    return store.listPackingLists({ billOfLadingId: filter.billOfLadingId, limit: 200 });
  }

  async createPackingList(input: {
    billOfLadingId: string;
    receiptId?: string | null;
    lines: readonly PackLineInput[];
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.PackingListRow> {
    requireUuid(input.billOfLadingId, "billOfLadingId");
    // THE ANCHOR LAW (the declared interpretation): the packing list is
    // the shipment's packing document — the B/L link is REQUIRED at the
    // service floor (the 0120 FK is nullable for the raw plane; the
    // engine demands the shipment's identity).
    const bl = await store.findBlById(input.billOfLadingId);
    if (bl === undefined) {
      throw new BlRecordNotFoundError({ blId: input.billOfLadingId });
    }
    if (input.receiptId !== undefined && input.receiptId !== null) {
      requireUuid(input.receiptId, "receiptId");
    }
    if (input.lines.length === 0) {
      throw new TransportInputInvalidError({
        field: "lines",
        reason: "the packing list carries at least one pack line (the line-level pack shapes)",
      });
    }
    if (input.lines.length > 200) {
      throw new TransportInputInvalidError({
        field: "lines",
        reason: `at most 200 pack lines are accepted, got ${input.lines.length}`,
      });
    }
    const lines = input.lines.map((line, index) => requirePackLine(line, index));

    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: PL_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: PL_NUMBER_FORMAT.format,
      prefix: PL_NUMBER_FORMAT.prefix,
      year,
    });
    if ((await store.findPackingListByNo(acquired.number)) !== undefined) {
      throw new PackingListDuplicateError({ plNo: acquired.number });
    }
    const row = await store.insertPackingList({
      plNo: acquired.number,
      billOfLadingId: bl.id,
      receiptId: input.receiptId ?? null,
      lines,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.packing_list_created",
      entityType: "packing_lists",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        plNo: row.plNo,
        billOfLadingId: row.billOfLadingId,
        receiptId: row.receiptId,
        lines: row.lines.length,
      },
    });
    return row;
  }
}
