/**
 * PHASE-050 (W-29 — T-15) — the COA print PAYLOAD BUILDER (the W-13/W-21
 * print laws, carried verbatim from assets-print.ts): the certificate of
 * analysis/conformity's A4 document through the versioned @erp/ui/print
 * pipeline.
 *
 * THE LAWS (binding):
 *
 * - **bi() EXCLUSIVELY** (the owner's clause 1): every LABEL — the title,
 *   the parties block, the columns — is read through `bi(key)` producing
 *   BOTH dictionary sides (the AR payload carries the AR labels, the EN
 *   payload the EN — never a literal in this module). The payload's own
 *   VALUES (the parameter names, the measured values, the verdicts) ride
 *   the active locale's dictionary through the localized helpers, never a
 *   literal either.
 * - **ZERO PARALLEL COMPUTATION** (clause 2): the frozen `parameters`
 *   snapshot renders VERBATIM — each entry's own parameter name/nameAr,
 *   unit, measured value and verdict exactly as the gate stored them. NO
 *   totals block (a parameter count would be a client-side sum).
 * - **DETERMINISM** (clause 3): NO wall-clock reads — docNo and docDate
 *   are the caller's own parameters (the certificate row's own strings).
 *   Two builds of the same inputs produce byte-identical html in BOTH
 *   locales.
 * - `.num` LTR-mono isolation for figures (the measured-value column rides
 *   the template's numeric class) and a real `<thead>`.
 */

import { renderA4Document, type A4DocumentPayload } from "@erp/ui/print";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import { localizedCoaGateVerdict, localizedName } from "./messages";
import type { CoaDocumentRow, CoaParameterEntry } from "./api-types";

/** Both dictionaries (the bilingual labels' two sides — the print's labels
 * are GENUINELY bilingual, both sides from the dictionary). */
const AR = getDictionary("ar");
const EN = getDictionary("en");

/** The dictionary-exclusive bilingual label: BOTH sides from the i18n
 * dictionary (the owner's clause 1 — never a literal in this module). */
function bi(key: keyof Dictionary): { ar: string; en: string } {
  return { ar: AR[key], en: EN[key] };
}

/** The frozen snapshot's entries read defensively off the wire record (the
 * engine guarantees the CoaGateEntry shape; the builder never fabricates a
 * missing figure — an absent string renders the honest dash). */
function coaEntries(certificate: CoaDocumentRow): readonly CoaParameterEntry[] {
  const entries: CoaParameterEntry[] = [];
  for (const raw of certificate.parameters) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const parameter = typeof record.parameter === "string" ? record.parameter : "—";
    const parameterAr = typeof record.parameterAr === "string" ? record.parameterAr : null;
    const unit = typeof record.unit === "string" ? record.unit : null;
    const value = typeof record.value === "string" ? record.value : "—";
    const gate = typeof record.gate === "string" ? record.gate : "—";
    entries.push({
      specId: typeof record.specId === "string" ? record.specId : "",
      parameter,
      parameterAr,
      unit,
      targetValue: typeof record.targetValue === "string" ? record.targetValue : "",
      ucl: typeof record.ucl === "string" ? record.ucl : null,
      lcl: typeof record.lcl === "string" ? record.lcl : null,
      value,
      toleranceVerdict:
        typeof record.toleranceVerdict === "string" ? record.toleranceVerdict : "",
      gate,
      breachedLimit: typeof record.breachedLimit === "string" ? record.breachedLimit : null,
      ncrId: typeof record.ncrId === "string" ? record.ncrId : null,
    });
  }
  return entries;
}

/**
 * The certificate's A4 document — the frozen parameters snapshot rendered
 * VERBATIM (the W-13 print law: the print reads the stored snapshot, never
 * the live specs, never a recomputed verdict). docNo/docDate are the
 * certificate ROW's own strings (docNo + issuedAt — the determinism law:
 * no wall-clock read anywhere in this module).
 */
export function buildCoaDocumentHtml(input: {
  certificate: CoaDocumentRow;
  locale: Locale;
}): string {
  const { certificate, locale } = input;
  const d = getDictionary(locale);
  // The certificate's own type names the document (COA vs COC — both sides
  // through the dictionary, never a literal).
  const title =
    certificate.docType === "COC"
      ? bi("qualityCoaDocTypeCoc")
      : bi("qualityCoaDocTypeCoa");

  const payload: A4DocumentPayload = {
    template: "a4-document",
    locale,
    title,
    docNo: certificate.docNo,
    docDate: certificate.issuedAt,
    branding: { tenantName: "" },
    parties: [
      {
        label: bi("qualityCoaColItem"),
        lines: [certificate.itemId],
      },
      ...(certificate.batchId !== null
        ? [{ label: bi("qualityCoaColBatch"), lines: [certificate.batchId] }]
        : []),
      ...(certificate.inspectionId !== null
        ? [{ label: bi("qualityCoaGenerateInspection"), lines: [certificate.inspectionId] }]
        : []),
    ],
    columns: [
      { label: bi("qualityCoaPrintParam") },
      { label: bi("qualityCoaPrintUnit") },
      { label: bi("qualityCoaPrintValue"), numeric: true },
      { label: bi("qualityCoaPrintVerdict") },
    ],
    rows: coaEntries(certificate).map((entry) => [
      localizedName(entry.parameter, entry.parameterAr, locale),
      entry.unit ?? "—",
      entry.value,
      localizedCoaGateVerdict(d, entry.gate),
    ]),
    totals: [],
  };
  return renderA4Document(payload);
}
