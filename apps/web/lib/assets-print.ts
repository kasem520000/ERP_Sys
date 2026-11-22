/**
 * PHASE-049 (W-21 — T-14) — the asset-tag print PAYLOAD BUILDERS (the
 * owner's clause 1 carried from W-13: the AR/EN templates read from the
 * i18n dictionary EXCLUSIVELY — every label below is a dictionary string
 * read through `bi()`, never a literal).
 *
 * THE LAWS (the W-13 print law, binding — copied from contracting-print):
 *
 * - **ZERO PARALLEL COMPUTATION IN THE PRINT** (clause 2): every figure is
 *   the engine's own STRING, passed verbatim into the payload — the tag's
 *   own code, its own createdAt stamp, the QR data URI the engine
 *   PRE-RENDERED (the template never computes a QR; OA-06). NO counts, NO
 *   totals block (a tag count would be a client-side sum).
 * - **DETERMINISM** (clause 3): NO wall-clock reads — docDate is "" (the
 *   tag sheet carries no document date; the paper shows the engine's own
 *   createdAt stamps only), and the builders are pure functions of
 *   (dictionaries, locale, payload). Two builds of the same inputs produce
 *   byte-identical html.
 *
 * THE MULTI-TAG SHAPE (the honest repair of the ONE-qrImageUri payload):
 * `A4DocumentPayload` carries a single `qrImageUri`, so a multi-tag sheet
 * is ONE TAG PER PAGE — `tagLabelPayload` builds one payload per tag and
 * `renderA4Document` renders each (the versioned template; screen preview
 * = paper, ADR-0011). The multi-tag PRINT concatenates the per-tag
 * documents with a page-break separator: the per-tag documents share the
 * identical `<style>` block, so the browser merges them and stacks the
 * bodies — ONE print dialog emits every tag, one per page. The preview
 * shows the FIRST tag's document with a note (the component's own choice,
 * rendered there).
 */

import { renderA4Document, type A4DocumentPayload } from "@erp/ui/print";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import { localizedName } from "./messages";
import type { AssetTagRow, TagPrintSheetPayload } from "./api-types";

/** Both dictionaries (the bilingual labels' two sides — the print's
 * labels are GENUINELY bilingual, both sides from the dictionary). */
const AR = getDictionary("ar");
const EN = getDictionary("en");

/** The dictionary-exclusive bilingual label: BOTH sides from the i18n
 * dictionary (the owner's clause 1 — never a literal in this module). */
function bi(key: keyof Dictionary): { ar: string; en: string } {
  return { ar: AR[key], en: EN[key] };
}

/** The tag label's payload — ONE TAG PER PAGE: the tag's own code as the
 * docNo, the engine's pre-rendered QR data URI passed through VERBATIM,
 * and the asset identification in the parties block. docDate is "" — the
 * determinism law (never a wall-clock read). */
function tagLabelPayload(
  tag: AssetTagRow & { qrImageUri: string },
  asset: TagPrintSheetPayload["asset"],
  locale: Locale,
): A4DocumentPayload {
  return {
    template: "a4-document",
    locale,
    title: bi("assetsTagsPrintSheetTitle"),
    docNo: tag.code,
    docDate: "",
    // The sheet payload carries no branding pool — the template renders
    // the logo only when present; the tenant identity rides the asset
    // identification instead.
    branding: { tenantName: "" },
    parties: [
      {
        label: bi("assetsMetersColAsset"),
        lines: [asset.code, localizedName(asset.name, asset.nameAr, locale)],
      },
    ],
    columns: [
      { label: bi("assetsTagsColCode") },
      { label: bi("assetsMaintenanceColCreatedAt") },
    ],
    rows: [[tag.code, tag.createdAt]],
    totals: [],
    qrImageUri: tag.qrImageUri,
  };
}

/** The whole sheet's payloads — one per (pending) tag: the print-sheet
 * endpoint returns the pending tags ONLY (zero parallel accounting), each
 * with its own PRE-RENDERED QR data URI. */
export function tagSheetPayload(
  sheet: TagPrintSheetPayload,
  locale: Locale,
): readonly A4DocumentPayload[] {
  return sheet.tags.map((tag) => tagLabelPayload(tag, sheet.asset, locale));
}

/** The per-tag pages — each rendered by the versioned a4-document template
 * (screen preview = paper; the preview shows the FIRST, the print emits
 * all through the join below). */
export function tagSheetPages(sheet: TagPrintSheetPayload, locale: Locale): readonly string[] {
  return tagSheetPayload(sheet, locale).map((payload) => renderA4Document(payload));
}

/** The multi-tag print join: the per-tag documents concatenated with a
 * page-break separator — one print dialog emits every tag, one per page
 * (the per-tag documents share the identical style block; the browser
 * merges them and stacks the bodies). */
export function joinTagSheetPages(pages: readonly string[]): string {
  return pages.join('<div style="page-break-after: always; break-after: page;"></div>');
}
