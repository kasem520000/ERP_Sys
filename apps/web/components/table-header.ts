/**
 * P5-T12 — DataTable column-header adapter. The frozen @erp/ui DataTable
 * renders `column.header.en` for the visible label, so — until the package
 * grows a locale-aware header — app tables put the ACTIVE-locale label into
 * BOTH bilingual slots. This keeps grid headers following the page locale
 * (Arabic-first) without touching packages/ui. Noted for the phase report.
 */
export function activeLocaleHeader(label: string): { ar: string; en: string } {
  return { ar: label, en: label };
}
