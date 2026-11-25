/**
 * PHASE-051 (W-39 — T-14) — THE CERTIFICATE PRINT PAYLOAD BUILDER (D-13,
 * the 050 COA print laws carried VERBATIM): the chamber-format bilingual
 * certificate of origin/conformity's A4 document through the versioned
 * @erp/ui/print pipeline.
 *
 * THE LAWS (binding — the W-29 COA builder's own, carried verbatim):
 *
 * - **bi() EXCLUSIVELY** (the owner's clause 1): every LABEL — the title,
 *   the parties block, the columns — is read through `bi(key)` producing
 *   BOTH dictionary sides (the AR payload carries the AR labels, the EN
 *   payload the EN — never a literal in this module). The payload's own
 *   VALUES (the exporter/consignee names, the goods lines, the B/L and
 *   declaration figures) ride the FROZEN SNAPSHOT's own strings, never
 *   a literal and never a re-derivation.
 * - **ZERO PARALLEL COMPUTATION** (clause 2): the frozen `snapshot`
 *   renders VERBATIM — each goods line's own description, origin, HS
 *   code and quantity exactly as the issue act froze them; the linked
 *   B/L's and declaration's own figures (blNo, declarationNo) as
 *   copied at issuance. A later declaration PATCH or a tracking event
 *   NEVER moves a stored certificate. NO totals block (a goods-line
 *   count would be a client-side sum).
 * - **DETERMINISM** (clause 3): NO wall-clock reads — docNo and docDate
 *   are the caller's own parameters (the certificate row's own
 *   strings: certificateNo + issuedAt). Two builds of the same inputs
 *   produce byte-identical html in BOTH locales.
 * - `.num` LTR-mono isolation for figures (the quantity column rides
 *   the template's numeric class) and a real `<thead>`.
 */

import { renderA4Document, type A4DocumentPayload } from "@erp/ui/print";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type { TradeCertificateRow } from "./api-types";

/** Both dictionaries (the bilingual labels' two sides — the print's labels
 * are GENUINELY bilingual, both sides from the dictionary). */
const AR = getDictionary("ar");
const EN = getDictionary("en");

/** The dictionary-exclusive bilingual label: BOTH sides from the i18n
 * dictionary (the owner's clause 1 — never a literal in this module). */
function bi(key: keyof Dictionary): { ar: string; en: string } {
  return { ar: AR[key], en: EN[key] };
}

/** The frozen snapshot's goods lines read defensively off the wire record
 * (the engine guarantees the shape; the builder never fabricates a missing
 * figure — an absent string renders the honest dash). */
function certificateGoods(certificate: TradeCertificateRow): readonly {
  description: string;
  originCountry: string;
  hsCode: string;
  quantity: string;
}[] {
  const raw = certificate.snapshot.goods;
  if (!Array.isArray(raw)) {
    return [];
  }
  const lines: { description: string; originCountry: string; hsCode: string; quantity: string }[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    lines.push({
      description: typeof record.description === "string" ? record.description : "—",
      originCountry: typeof record.originCountry === "string" ? record.originCountry : "—",
      hsCode: typeof record.hsCode === "string" ? record.hsCode : "—",
      quantity: typeof record.quantity === "string" ? record.quantity : "—",
    });
  }
  return lines;
}

/** The frozen snapshot's linked-figures block — the B/L's own blNo and the
 * declaration's own declarationNo as copied at issuance (VERBATIM, the
 * chain's own anchors — acceptance #8). */
function certificateLinks(certificate: TradeCertificateRow): readonly {
  label: { ar: string; en: string };
  lines: readonly string[];
}[] {
  const parties: { label: { ar: string; en: string }; lines: string[] }[] = [];
  const bl = certificate.snapshot.billOfLading;
  if (typeof bl === "object" && bl !== null) {
    const record = bl as Record<string, unknown>;
    if (typeof record.blNo === "string") {
      const carrier = typeof record.carrierName === "string" ? record.carrierName : null;
      parties.push({
        label: bi("tradeCertificatePrintBl"),
        lines: carrier === null ? [record.blNo] : [`${record.blNo} · ${carrier}`],
      });
    }
  }
  const declaration = certificate.snapshot.declaration;
  if (typeof declaration === "object" && declaration !== null) {
    const record = declaration as Record<string, unknown>;
    if (typeof record.declarationNo === "string") {
      parties.push({
        label: bi("tradeCertificatePrintDeclaration"),
        lines: [record.declarationNo],
      });
    }
  }
  return parties;
}

/**
 * The certificate's A4 document — the frozen snapshot rendered VERBATIM
 * (the 050 COA print law: the print reads the stored snapshot, never the
 * live declaration, never the live B/L, never a recomputed figure).
 * docNo/docDate are the certificate ROW's own strings (certificateNo +
 * issuedAt — the determinism law: no wall-clock read anywhere in this
 * module).
 */
export function buildTradeCertificateHtml(input: {
  certificate: TradeCertificateRow;
  locale: Locale;
}): string {
  const { certificate, locale } = input;
  // The certificate's own type names the document (ORIGIN vs CONFORMITY —
  // both sides through the dictionary, never a literal).
  const title =
    certificate.certType === "CONFORMITY"
      ? bi("tradeCertificateTypeConformity")
      : bi("tradeCertificateTypeOrigin");

  const snapshot = certificate.snapshot;
  const exporter = typeof snapshot.exporterName === "string" ? snapshot.exporterName : "—";
  const consignee = typeof snapshot.consigneeName === "string" ? snapshot.consigneeName : "—";

  const payload: A4DocumentPayload = {
    template: "a4-document",
    locale,
    title,
    docNo: certificate.certificateNo,
    docDate: certificate.issuedAt,
    branding: { tenantName: "" },
    parties: [
      { label: bi("tradeCertificatePrintExporter"), lines: [exporter] },
      { label: bi("tradeCertificatePrintConsignee"), lines: [consignee] },
      ...certificateLinks(certificate),
    ],
    columns: [
      { label: bi("tradeCertificatePrintGood") },
      { label: bi("tradeCertificatePrintOrigin") },
      { label: bi("tradeCertificatePrintHs") },
      { label: bi("tradeCertificatePrintQty"), numeric: true },
    ],
    rows: certificateGoods(certificate).map((line) => [
      line.description,
      line.originCountry,
      line.hsCode,
      line.quantity,
    ]),
    totals: [],
  };
  return renderA4Document(payload);
}
