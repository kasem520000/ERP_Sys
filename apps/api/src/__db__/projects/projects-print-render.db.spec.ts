import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  pageFooterTemplate,
  renderProgressCertificate,
  renderRetentionStatement,
  renderSubcontractorCertificate,
  type CertificatePrintPayload,
  type RetentionStatementPrintPayload,
} from "@erp/ui/print";

import { ChromiumRenderEngine } from "../../modules/reporting/application/render/render-engine";

/**
 * PHASE-048 (W-13 — T-16) — the ACTUAL PRINT TEST for the three bilingual
 * contracting templates (the owner's clause 1: "an actual print test for
 * both directions with page breaks for long tables and LTR-mono numbers
 * in both languages"): the REAL headless Chromium renders each template
 * in BOTH locales with a 60-row history/ledger — every render paginates
 * (≥2 pages, the repeating thead carrying the table across the page
 * breaks), the html direction follows the locale (rtl/ltr), and the
 * numeric cells ride the .num LTR-mono isolation. The suite skips
 * gracefully when the browser cannot launch (the render.spec precedent:
 * a probe render in beforeAll decides; the full DB image proves the
 * pagination contract).
 *
 * The payloads are the SPEC'S OWN fixtures (bilingual labels inline —
 * the base print-templates suite's own pattern); the PRODUCTION labels
 * come from the app i18n dictionary exclusively (the web builder's
 * dictionary-exclusivity arm, proven in the web component spec).
 */

const engine = new ChromiumRenderEngine();

let browserAvailable = false;

beforeAll(async () => {
  try {
    const probe = await engine.render({
      html: "<!DOCTYPE html><html lang=\"en\" dir=\"ltr\"><head><meta charset=\"utf-8\"></head><body>render probe</body></html>",
      options: { format: "A4", locale: "en", footerTemplate: pageFooterTemplate("en") },
    });
    browserAvailable = probe.pdf.subarray(0, 4).toString("utf8") === "%PDF";
  } catch {
    browserAvailable = false;
  }
});

afterAll(async () => {
  await engine.close();
});

function certificatePayload(
  locale: "ar" | "en",
  template: "a4-progress-certificate" | "a4-sub-certificate",
): CertificatePrintPayload {
  return {
    template,
    locale,
    title:
      template === "a4-progress-certificate"
        ? { ar: "مستخلص أعمال", en: "Progress certificate" }
        : { ar: "مستخلص مقاول باطن", en: "Subcontractor certificate" },
    docNo: "PC-2026-000042",
    docDate: "2026-11-30",
    branding: { tenantName: "شركة الاختبار للتجارة" },
    parties: [
      { label: { ar: "المشروع", en: "Project" }, lines: ["PJW-PRJ-1", "مشروع العالم المتسق"] },
    ],
    figures: [
      { label: { ar: "القيمة الإجمالية", en: "Gross value" }, value: "45000.0000" },
      { label: { ar: "المحتجيات", en: "Retention" }, value: "2250.0000" },
      { label: { ar: "الصافي", en: "Net" }, value: "42750.0000" },
    ],
    columns: [
      { label: { ar: "رقم المستخلص", en: "Certificate no." } },
      { label: { ar: "التاريخ", en: "Date" } },
      { label: { ar: "القيمة الإجمالية", en: "Gross value" }, numeric: true },
      { label: { ar: "المحتجيات", en: "Retention" }, numeric: true },
      { label: { ar: "الصافي", en: "Net" }, numeric: true },
    ],
    rows: Array.from({ length: 60 }, (_, index) => [
      `PC-2026-${String(index + 1).padStart(6, "0")}`,
      "2026-10-31",
      `${(index + 1) * 100}.0000`,
      `${(index + 1) * 5}.0000`,
      `${(index + 1) * 95}.0000`,
    ]),
    totals: [
      { label: { ar: "الفوترة التراكمية", en: "Cumulative billing" }, amount: "90000.0000" },
      { label: { ar: "المتبقي", en: "Remaining" }, amount: "30000.0000", isCheck: true },
    ],
    signatures: [
      { label: { ar: "إعداد", en: "Prepared by" } },
      { label: { ar: "الاعتماد", en: "Approval" } },
    ],
    note: { ar: "أرقام المحركات كما هي.", en: "The engines' own figures, verbatim." },
  };
}

function statementPayload(locale: "ar" | "en"): RetentionStatementPrintPayload {
  return {
    template: "a4-retention-statement",
    locale,
    title: { ar: "كشف المحتجيات", en: "Retention statement" },
    asOf: "2026-11-01T00:00:00Z",
    branding: { tenantName: "شركة الاختبار للتجارة" },
    parties: [{ label: { ar: "المشروع", en: "Project" }, lines: ["PJW-PRJ-1"] }],
    figures: [
      { label: { ar: "الرصيد المتراكم", en: "Accrued balance" }, value: "4500.0000" },
    ],
    columns: [
      { label: { ar: "النوع", en: "Kind" } },
      { label: { ar: "قيمة العقد", en: "Contract value" }, numeric: true },
      { label: { ar: "الرصيد المتراكم", en: "Accrued balance" }, numeric: true },
      { label: { ar: "الحالة", en: "Status" } },
    ],
    rows: Array.from({ length: 60 }, (_, index) => [
      index % 2 === 0 ? "عميل (سجل العقد)" : "مقاول باطن",
      `${(index + 1) * 1000}.0000`,
      `${(index + 1) * 50}.0000`,
      "ACTIVE",
    ]),
    signatures: [{ label: { ar: "الاعتماد", en: "Approval" } }],
    note: { ar: "أرقام المحركات كما هي.", en: "The engines' own figures, verbatim." },
  };
}

describe("PHASE-048 W-13 — the contracting prints in the REAL browser (both directions, long tables)", () => {
  it("the progress certificate: 60-row history paginates across ≥2 pages with the repeating thead (AR + EN)", async (ctx) => {
    for (const locale of ["ar", "en"] as const) {
      const html = renderProgressCertificate(certificatePayload(locale, "a4-progress-certificate"));
      // The template contract: a real thead, the locale's direction, the
      // LTR-mono numeric isolation, embedded woff2 fonts.
      expect(html).toContain("<thead>");
      expect(html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`);
      expect(html).toContain('class="numeric num"');
      if (!browserAvailable) {
        ctx.skip(); // no headless Chromium in this environment
      }
      const output = await engine.render({
        html,
        options: { format: "A4", locale, footerTemplate: pageFooterTemplate(locale) },
      });
      expect(output.pages).toBeGreaterThanOrEqual(2);
      expect(output.pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
      expect(output.pdf.byteLength).toBeGreaterThan(10_000); // embedded fonts
    }
  });

  it("the subcontractor certificate: the 60-row sub history paginates (AR + EN)", async (ctx) => {
    if (!browserAvailable) {
      ctx.skip(); // no headless Chromium in this environment
    }
    for (const locale of ["ar", "en"] as const) {
      const html = renderSubcontractorCertificate(certificatePayload(locale, "a4-sub-certificate"));
      expect(html).toContain("<thead>");
      const output = await engine.render({
        html,
        options: { format: "A4", locale, footerTemplate: pageFooterTemplate(locale) },
      });
      expect(output.pages).toBeGreaterThanOrEqual(2);
      expect(output.pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    }
  });

  it("the retention statement: the 60-row ledger paginates (AR + EN)", async (ctx) => {
    if (!browserAvailable) {
      ctx.skip(); // no headless Chromium in this environment
    }
    for (const locale of ["ar", "en"] as const) {
      const html = renderRetentionStatement(statementPayload(locale));
      expect(html).toContain("<thead>");
      const output = await engine.render({
        html,
        options: { format: "A4", locale, footerTemplate: pageFooterTemplate(locale) },
      });
      expect(output.pages).toBeGreaterThanOrEqual(2);
      expect(output.pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    }
  });
});
