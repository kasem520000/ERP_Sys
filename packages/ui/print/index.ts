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
export { EMBEDDED_FONTS } from "./fonts";
// PHASE-021: the webview reprint template's paper palette (the offline
// console's cached-receipt reprint — apps/web components/offline).
export { REPRINT_CSS, REPRINT_CSS_VERSION } from "./reprint-css";
