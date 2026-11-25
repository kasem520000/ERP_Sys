import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";

import * as store from "../infrastructure/trade.store";
import {
  CertificateDuplicateError,
  CertificateInputInvalidError,
  CertificateLineInvalidError,
  CertificateLinkNotFoundError,
  CertificateRecordNotFoundError,
} from "../domain/trade-errors";

/**
 * PHASE-051 (W-39 — T-14, 2026-11-25) THE CERTIFICATE SERVICE (the
 * 0120 §4 plane's own issuance — D-13's print anchor): the chamber
 * certificate of ORIGIN/CONFORMITY issues ONCE with THE FROZEN
 * SNAPSHOT (the 050 COA frozen-snapshot law verbatim): the print's
 * own data — the exporter/consignee, the goods lines with their
 * origins, the linked B/L's own figures (blNo · docType · carrier ·
 * ports) and the linked declaration's own figures (declarationNo ·
 * status) — freezes AT ISSUANCE into the snapshot jsonb; a later
 * declaration PATCH (or a tracking event moving the B/L's rung) NEVER
 * moves a stored certificate — the W-39 print surface renders the
 * snapshot VERBATIM through the bi() builder EXCLUSIVELY.
 *
 * THE LAWS (binding, the 050 COA generate-act pattern):
 *
 * - **THE NUMBER** `CERT-{YYYY}-{SEQ:6}` reserves at create through
 *   the REAL NumberingService (INV-021/ADR-0006 — the BL/PL precedent;
 *   the duplicate pre-check refuses BY NAME before the DB floor).
 * - **THE LINKS' OWN READS** (zero parallel computation): the B/L and
 *   declaration figures frozen into the snapshot are the STORE'S OWN
 *   rows read at issue time — never recomputed, never re-derived.
 * - **LEDGER-FREE BY DESIGN** (the 0120 note: the certificates are
 *   non-ledger documents — the 050 note-20 pattern; no posting
 *   identifier minted, the reservations law untouched).
 * - **IMMUTABLE HISTORY** (the S/I/U + NO DELETE grants): an issued
 *   certificate never rewrites — the only write after issue is none;
 *   a correction is a new certificate.
 */
@Injectable()
export class CertificateService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ── the reads (the register + the find) ─────────────────────────────

  async list(filter: { certType?: string }): Promise<store.CertificateRow[]> {
    if (filter.certType !== undefined && !["ORIGIN", "CONFORMITY"].includes(filter.certType)) {
      throw new CertificateInputInvalidError({
        field: "certType",
        reason: `the vocabulary is ORIGIN/CONFORMITY, got "${filter.certType}"`,
      });
    }
    return store.listCertificates({ certType: filter.certType, limit: 200 });
  }

  async find(certificateId: string): Promise<store.CertificateRow> {
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(certificateId)) {
      throw new CertificateInputInvalidError({
        field: "id",
        reason: "a uuid is required",
      });
    }
    const row = await store.findCertificateById(certificateId);
    if (row === undefined) {
      throw new CertificateRecordNotFoundError({ certificateId });
    }
    return row;
  }

  // ── the issue (the frozen snapshot's own door) ───────────────────────

  async issue(input: {
    certType: "ORIGIN" | "CONFORMITY";
    exporterName: string;
    consigneeName: string;
    billOfLadingId?: string | null;
    declarationId?: string | null;
    goods: readonly {
      description: string;
      originCountry: string;
      hsCode?: string | null;
      quantity?: string | null;
      uom?: string | null;
    }[];
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.CertificateRow> {
    if (input.certType !== "ORIGIN" && input.certType !== "CONFORMITY") {
      throw new CertificateInputInvalidError({
        field: "certType",
        reason: `the vocabulary is ORIGIN/CONFORMITY, got "${input.certType}"`,
      });
    }
    for (const [field, value] of [
      ["exporterName", input.exporterName],
      ["consigneeName", input.consigneeName],
    ] as const) {
      if (value.trim().length === 0 || value.length > 300) {
        throw new CertificateInputInvalidError({
          field,
          reason: "1…300 chars are required (the chamber format's own party block)",
        });
      }
    }
    if (input.goods.length === 0 || input.goods.length > 200) {
      throw new CertificateInputInvalidError({
        field: "goods",
        reason: `1…200 goods lines are required, got ${input.goods.length}`,
      });
    }
    const goods: Record<string, unknown>[] = [];
    for (const [index, line] of input.goods.entries()) {
      if (line.description.trim().length === 0 || line.description.length > 200) {
        throw new CertificateLineInvalidError({
          index,
          field: "description",
          reason: `1…200 chars are required, got "${line.description}"`,
        });
      }
      if (!/^[A-Z]{2}$/.test(line.originCountry)) {
        throw new CertificateLineInvalidError({
          index,
          field: "originCountry",
          reason: `an ISO-3166 alpha-2 code is required, got "${line.originCountry}"`,
        });
      }
      if (line.hsCode !== undefined && line.hsCode !== null && !/^[0-9]{2,10}$/.test(line.hsCode)) {
        throw new CertificateLineInvalidError({
          index,
          field: "hsCode",
          reason: `2…10 digits (the harmonized system's own shape), got "${line.hsCode}"`,
        });
      }
      if (
        line.quantity !== undefined &&
        line.quantity !== null &&
        !/^\d+(\.\d{1,6})?$/.test(line.quantity)
      ) {
        throw new CertificateLineInvalidError({
          index,
          field: "quantity",
          reason: `a non-negative decimal (≤ 6dp) is required, got "${line.quantity}"`,
        });
      }
      goods.push({
        description: line.description.trim(),
        originCountry: line.originCountry.trim().toUpperCase(),
        ...(line.hsCode !== undefined && line.hsCode !== null && line.hsCode !== ""
          ? { hsCode: line.hsCode.trim() }
          : {}),
        ...(line.quantity !== undefined && line.quantity !== null && line.quantity !== ""
          ? { quantity: line.quantity }
          : {}),
        ...(line.uom !== undefined && line.uom !== null && line.uom !== ""
          ? { uom: line.uom.trim() }
          : {}),
      });
    }

    // THE LINKS' OWN READS (the chain's figures freeze from the store's
    // own rows — acceptance #8: PO → LC/collection → transport documents
    // → declaration → receipt → landed cost; the certificate anchors on
    // the transport + declaration links).
    let bl: store.BillOfLadingRow | null = null;
    if (input.billOfLadingId !== undefined && input.billOfLadingId !== null) {
      if (
        !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
          input.billOfLadingId,
        )
      ) {
        throw new CertificateInputInvalidError({
          field: "billOfLadingId",
          reason: "a uuid is required",
        });
      }
      const found = await store.findBlById(input.billOfLadingId);
      if (found === undefined) {
        throw new CertificateLinkNotFoundError({ link: "billOfLadingId", id: input.billOfLadingId });
      }
      bl = found;
    }
    let declaration: { id: string; declarationNo: string; status: string } | null = null;
    if (input.declarationId !== undefined && input.declarationId !== null) {
      if (
        !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
          input.declarationId,
        )
      ) {
        throw new CertificateInputInvalidError({
          field: "declarationId",
          reason: "a uuid is required",
        });
      }
      const found = await store.findDeclarationWithLines(input.declarationId);
      if (found === undefined) {
        throw new CertificateLinkNotFoundError({ link: "declarationId", id: input.declarationId });
      }
      declaration = {
        id: found.declaration.id,
        declarationNo: found.declaration.declarationNo,
        status: found.declaration.status,
      };
    }

    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: "certificates_of_origin",
      branchId: null,
      periodKey: year,
      format: "CERT-{YYYY}-{SEQ:6}",
      prefix: "CERT",
      year,
    });
    if ((await store.findCertificateByNo(acquired.number)) !== undefined) {
      throw new CertificateDuplicateError({ certificateNo: acquired.number });
    }

    // THE FROZEN SNAPSHOT (D-13: the print's own data at issuance — the
    // linked rows' own figures copied ONCE; a later PATCH never moves a
    // stored certificate).
    const snapshot: Record<string, unknown> = {
      certType: input.certType,
      exporterName: input.exporterName.trim(),
      consigneeName: input.consigneeName.trim(),
      goods,
      ...(bl !== null
        ? {
            billOfLading: {
              id: bl.id,
              blNo: bl.blNo,
              docType: bl.docType,
              carrierName: bl.carrierName,
              portOfLoading: bl.portOfLoading,
              portOfDischarge: bl.portOfDischarge,
              shipmentStatus: bl.shipmentStatus,
            },
          }
        : {}),
      ...(declaration !== null ? { declaration } : {}),
    };

    const row = await store.insertCertificate({
      certificateNo: acquired.number,
      certType: input.certType,
      billOfLadingId: bl !== null ? bl.id : null,
      declarationId: declaration !== null ? declaration.id : null,
      snapshot,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.certificate_issued",
      entityType: "certificates_of_origin",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        certificateNo: row.certificateNo,
        certType: row.certType,
        billOfLadingId: row.billOfLadingId,
        declarationId: row.declarationId,
        goodsLines: goods.length,
      },
    });
    return row;
  }
}
