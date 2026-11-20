/**
 * PHASE-013 · the versioned print-template package (ADR-0011;
 * PRINTING_AND_EXPORT §1): pure HTML-string generators consumed
 * identically by the web PrintPreview (iframe srcDoc) and the server
 * Chromium renderer — screen preview and paper cannot diverge. Exported
 * on the package surface as `@erp/ui/print` (sanctioned in the erp-ui
 * import-path rule; deep paths remain forbidden).
 */
export {
  renderA4Document,
  renderA4Report,
  renderReceipt,
  renderReceipt80,
  renderReceipt58,
  pageFooterTemplate,
  PRINT_TEMPLATE_VERSIONS,
  printCss,
  PRINT_CSS_VERSION,
  type A4DocumentPayload,
  type A4ReportPayload,
  type ReceiptPayload,
  type PrintBranding,
  type LegalFooter,
  type BilingualText,
} from "./templates";
// PHASE-048 (W-13 — T-16, D-14): the three bilingual contracting print
// templates (pure generators; the payload labels are the caller's —
// the production callers read them from the app i18n dictionary).
export {
  renderProgressCertificate,
  renderSubcontractorCertificate,
  renderRetentionStatement,
  type CertificatePrintPayload,
  type RetentionStatementPrintPayload,
  type CertificateFigure,
  type CertificateSignature,
} from "./contracting-templates";
export { EMBEDDED_FONTS } from "./fonts";
// PHASE-021: the webview reprint template's paper palette (the offline
// console's cached-receipt reprint — apps/web components/offline).
export { REPRINT_CSS, REPRINT_CSS_VERSION } from "./reprint-css";
