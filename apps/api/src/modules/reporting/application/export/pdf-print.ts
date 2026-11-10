/**
 * PHASE-013 · report PDF rendering: the stored result envelope → the
 * versioned `a4-report` print template (the same HTML the web preview
 * shows) → the Chromium render service. No user-supplied HTML ever
 * reaches the renderer (ADR-0011).
 */

import {
  renderA4Report,
  pageFooterTemplate,
  PRINT_TEMPLATE_VERSIONS,
  type A4ReportPayload,
} from "@erp/ui/print";

import type { ReportResult } from "../contract";
import { getRenderEngine } from "../render/engine-holder";

export async function renderReportPdf(
  envelope: ReportResult,
  template: "a4-report" | "a4-document",
): Promise<Buffer> {
  const locale = envelope.formatting.locale;
  const payload: A4ReportPayload = {
    template: "a4-report",
    locale,
    title: bilingualOf(envelope),
    parameterSummary: Object.entries(envelope.paramsEcho)
      .filter(([key]) => key !== "locale")
      .slice(0, 6)
      .map(([key, value]) => `${key}=${String(value)}`),
    branding: { tenantName: "ERP" },
    columns: envelope.columns.map((column) => ({
      label: column.label,
      numeric: column.numeric === true,
    })),
    groups: envelope.groups.map((group) => ({ key: group.key, label: group.label })),
    rows: envelope.rows.map((row) => ({
      values: envelope.columns.map((column) => {
        const value = row.values[column.id];
        return value === null || value === undefined ? null : String(value);
      }),
      groupKey: row.groupKey,
    })),
    totals: envelope.totals.map((total) => ({
      label: total.label,
      amount: total.amount,
      isCheck: total.kind === "check",
    })),
    assertions: envelope.assertions.map((assertion) => ({
      id: assertion.id,
      status: assertion.status,
    })),
    asOf: envelope.freshness.asOf ?? undefined,
    computedAt: envelope.freshness.computedAt,
  };
  const html = renderA4Report(payload);
  const engine = getRenderEngine();
  const output = await engine.render({
    html,
    options: {
      format: "A4",
      locale,
      footerTemplate: pageFooterTemplate(locale),
      timeoutMs: 60_000,
    },
  });
  void template;
  void PRINT_TEMPLATE_VERSIONS;
  return output.pdf;
}

function bilingualOf(envelope: ReportResult): { ar: string; en: string } {
  return { ar: `تقرير ${envelope.reportId}`, en: `Report ${envelope.reportId}` };
}
