import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { findBatchById, findItemForInventory } from "../../inventory/infrastructure/inventory.store";
import { findInspectionById, findProductionOrderById } from "../../manufacturing/infrastructure/manufacturing.store";
import { listGoodsReceiptLines } from "../../purchasing/infrastructure/purchasing.store";

import * as store from "../infrastructure/quality.store";
import { coaGateFold, type CoaMeasuredInput } from "../domain/coa-gate";
import {
  CoaBatchItemMismatchError,
  CoaDeviationNcrInvalidError,
  CoaDocumentNotFoundError,
  CoaGateBlockedError,
  CoaInspectionItemMismatchError,
  CoaNoSpecificationsError,
  NcrRecordNotFoundError,
  QualityInputInvalidError,
  QualityInspectionNotFoundError,
} from "../domain/quality-errors";

/**
 * PHASE-050 (W-27 — T-11, 2026-11-23) THE COA GENERATION SERVICE (Q-07,
 * BR-104 — D-11): the certificate of analysis (COA) or conformity (COC)
 * generated from the measured parameter values against the item's OWN
 * specifications.
 *
 * BR-104's GATE (the phase doc's wording, the refusal naming the
 * parameter and BOTH figures): the certificate is blocked unless EVERY
 * active parameter is within tolerance or carries an ACCEPTED-DEVIATION
 * NCR reference — the PURE gate fold (domain/coa-gate.ts) composes the
 * tolerance fold (the module's ONLY evaluator) and this service throws
 * its typed refusal on the fold's `blocked` flag. The accepted-deviation
 * reference's own floor: the NCR must exist (the module's register),
 * belong to the certificate's item, and carry the ACCEPT disposition —
 * an open or differently-dispositioned NCR is not an acceptance.
 *
 * THE FROZEN SNAPSHOT (0115's own design): the gate fold's entries ARE
 * the stored `parameters` array, verbatim — the certificate print (W-29)
 * reads this array and never recomputes (the W-13 print law). The
 * certificate is immutable history (S/I/U, NO DELETE — the 0115 grants).
 *
 * THE PROVENANCE FLOORS (the mapping contract's own chain — W-25's
 * declared shapes): the optional batch must belong to the certificate's
 * item; the optional inspection must resolve to the certificate's item
 * through the mapping contract's own chain — the FG batch, the
 * production order, or (a GRN-target inspection) the goods receipt's
 * OWN lines carrying the item (the per-line resolution the W-25 record
 * declared). The official numbering rides the treasury {PREFIX}-{YYYY}-
 * {SEQ:6} convention (INV-021/ADR-0006): COA-{YYYY}-{SEQ:6} — both
 * certificate types share the one register sequence (the 0115 doc_no
 * unique's own grain; the declared interpretation).
 */

/** Official certificate numbers (INV-021/ADR-0006; the NCR precedent). */
export const COA_NUMBER_FORMAT = {
  prefix: "COA",
  format: "COA-{YYYY}-{SEQ:6}",
  docType: "coa_document",
} as const;

export interface GenerateCoaInput {
  docType: "COA" | "COC";
  itemId: string;
  batchId?: string | null;
  inspectionId?: string | null;
  parameters: { specId: string; value: string; ncrId?: string | null }[];
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class CoaService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  async generate(input: GenerateCoaInput): Promise<store.CoaDocumentRow> {
    const item = await findItemForInventory(input.itemId);
    if (item === undefined) {
      throw new QualityInputInvalidError({
        field: "itemId",
        reason: `item ${input.itemId} does not exist in this tenant`,
      });
    }
    // The batch provenance floor (the 0115 FK guarantees existence; the
    // cross-field coherence is this typed floor).
    const batchId = input.batchId ?? null;
    if (batchId !== null) {
      const batch = await findBatchById(batchId);
      if (batch === undefined) {
        throw new QualityInputInvalidError({
          field: "batchId",
          reason: `batch ${batchId} does not exist in this tenant`,
        });
      }
      if (batch.itemId !== input.itemId) {
        throw new CoaBatchItemMismatchError({
          batchId,
          itemId: input.itemId,
          batchItemId: batch.itemId,
        });
      }
    }
    // The inspection provenance floor — the mapping contract's own chain
    // (the W-25 declared shapes, the per-line resolution included).
    const inspectionId = input.inspectionId ?? null;
    if (inspectionId !== null) {
      const inspection = await findInspectionById(inspectionId);
      if (inspection === undefined) {
        throw new QualityInspectionNotFoundError({ inspectionId });
      }
      await this.assertInspectionCoversItem(inspection, input.itemId);
    }
    // The register: the item's ACTIVE specifications (the mapping
    // contract's own read).
    const specs = await store.listQualitySpecs({ itemId: input.itemId, activeOnly: true, limit: 500 });
    if (specs.length === 0) {
      throw new CoaNoSpecificationsError({ itemId: input.itemId });
    }
    // The accepted-deviation validation — every referenced NCR is the
    // module's OWN row, this item's, and ACCEPT-dispositioned (the
    // register's own verdict; the service pre-validates so the pure
    // fold stays pure — D-11's law).
    const accepted = new Set<string>();
    const referencedNcrs = new Map<string, string>();
    for (const measured of input.parameters) {
      if (measured.ncrId === undefined || measured.ncrId === null) continue;
      if (referencedNcrs.has(measured.ncrId)) continue;
      const ncr = await store.findNcrById(measured.ncrId);
      if (ncr === undefined) {
        throw new NcrRecordNotFoundError({ ncrId: measured.ncrId });
      }
      if (ncr.itemId !== input.itemId || ncr.disposition !== "ACCEPT") {
        throw new CoaDeviationNcrInvalidError({
          ncrId: measured.ncrId,
          ncrNo: ncr.ncrNo,
          itemId: ncr.itemId,
          disposition: ncr.disposition,
        });
      }
      referencedNcrs.set(measured.ncrId, ncr.ncrNo);
      accepted.add(measured.ncrId);
    }
    // THE PURE GATE (BR-104's three shapes + the coverage law).
    const measuredInput: CoaMeasuredInput[] = input.parameters.map((parameter) => ({
      specId: parameter.specId,
      value: parameter.value,
      ncrId: parameter.ncrId ?? null,
    }));
    const gate = coaGateFold(specs, measuredInput, accepted);
    if (gate.blocked) {
      throw new CoaGateBlockedError({
        itemId: input.itemId,
        firstFailure: gate.firstFailure,
        missing: gate.missing,
        foreign: gate.foreign,
        duplicates: gate.duplicates,
      });
    }
    // The official number (the NCR precedent: reserve → insert → bind).
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: COA_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: COA_NUMBER_FORMAT.format,
      prefix: COA_NUMBER_FORMAT.prefix,
      year,
    });
    const issuedAt = new Date().toISOString();
    const row = await store.insertCoaDocument({
      docNo: acquired.number,
      docType: input.docType,
      itemId: input.itemId,
      batchId,
      inspectionId,
      // The frozen snapshot: the gate fold's entries serialized verbatim
      // (camelCase keys, nulls explicit — the actions array's discipline).
      parameters: gate.entries as unknown as store.CoaParameters,
      issuedAt,
      issuedBy: input.actorId,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
    });
    await this.numbering.bind(COA_NUMBER_FORMAT.docType, acquired.number, row.id);
    await this.audit.record({
      action: "quality.coa_generated",
      entityType: "coa_document",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        docNo: row.docNo,
        docType: row.docType,
        itemId: row.itemId,
        parameters: row.parameters.length,
      },
    });
    return row;
  }

  /** The mapping contract's own chain, asserted for the certificate's
   * provenance: the FG batch's item · the production order's item · or
   * the goods receipt's OWN lines carrying the item (the per-line
   * resolution — the W-25 declared shape, the purchasing store's own
   * read). */
  private async assertInspectionCoversItem(
    inspection: Awaited<ReturnType<typeof findInspectionById>>,
    itemId: string,
  ): Promise<void> {
    const row = inspection!;
    if (row.fgBatchId !== null) {
      const batch = await findBatchById(row.fgBatchId);
      if (batch !== undefined && batch.itemId !== itemId) {
        throw new CoaInspectionItemMismatchError({ inspectionId: row.id, itemId });
      }
      return;
    }
    if (row.orderId !== null) {
      const order = await findProductionOrderById(row.orderId);
      if (order !== undefined && order.itemId !== itemId) {
        throw new CoaInspectionItemMismatchError({ inspectionId: row.id, itemId });
      }
      return;
    }
    if (row.grnId !== null) {
      // The per-line resolution: the receipt's OWN lines carry the item.
      const lines = await listGoodsReceiptLines(row.grnId);
      if (!lines.some((line) => line.itemId === itemId)) {
        throw new CoaInspectionItemMismatchError({ inspectionId: row.id, itemId });
      }
      return;
    }
    // An inspection with no target at all cannot cover any item.
    throw new CoaInspectionItemMismatchError({ inspectionId: row.id, itemId });
  }

  async find(id: string): Promise<store.CoaDocumentRow> {
    const row = await store.findCoaDocumentById(id);
    if (row === undefined) throw new CoaDocumentNotFoundError({ coaId: id });
    return row;
  }

  async list(filter: {
    itemId?: string;
    batchId?: string;
    limit?: number;
  }): Promise<store.CoaDocumentRow[]> {
    return store.listCoaDocuments({
      itemId: filter.itemId,
      batchId: filter.batchId,
      limit: filter.limit ?? 200,
    });
  }
}
