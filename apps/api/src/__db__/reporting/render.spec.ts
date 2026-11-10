import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pageFooterTemplate, renderA4Report } from "@erp/ui/print";

import { ChromiumRenderEngine } from "../../modules/reporting/application/render/render-engine";
import { pdfPageCount, stampPdfA2b } from "../../modules/reporting/application/render/pdf-a";

/**
 * PHASE-013 render engine (PRINTING_AND_EXPORT §3, ADR-0011): the REAL
 * headless Chromium renders the same a4-report HTML the web preview shows —
 * a 60-row Arabic statement paginates (thead repeats per page via CSS),
 * fonts are embedded data URIs (no network — every route aborted), and the
 * PDF/A-2b XMP identification stamp preserves the page count.
 *
 * The suite skips gracefully when the browser cannot launch (the CI unit
 * image ships no Chromium): a probe render in beforeAll decides, and every
 * browser-dependent test calls ctx.skip() — the suite stays green there
 * while the full DB image proves the pagination contract.
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

function sixtyRowArabicReport(): string {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    values: [String(1100 + index), `حساب تجريبي ${index + 1}`, `${(index + 1) * 25}.0000`],
    groupKey: "ASSET",
  }));
  return renderA4Report({
    template: "a4-report",
    locale: "ar",
    title: { ar: "ميزان المراجعة", en: "Trial Balance" },
    parameterSummary: ["dateFrom=2026-01-01", "dateTo=2026-01-31", "locale=ar"],
    branding: { tenantName: "شركة الاختبار" },
    columns: [
      { label: { ar: "رمز الحساب", en: "Account code" } },
      { label: { ar: "الحساب", en: "Account" } },
      { label: { ar: "مدين الفترة", en: "Period debit" }, numeric: true },
    ],
    groups: [{ key: "ASSET", label: { ar: "الأصول", en: "Assets" } }],
    rows,
    totals: [
      { label: { ar: "إجمالي مدين الفترة", en: "Total period debit" }, amount: "45300.0000" },
      {
        label: { ar: "الأصول = الالتزامات + حقوق الملكية", en: "Assets = Liabilities + Equity" },
        amount: "0.0000",
        isCheck: true,
      },
    ],
    assertions: [
      { id: "tb-debits-equal-credits", status: "PASS" },
      { id: "tb-closing-net-zero", status: "PASS" },
    ],
    asOf: "2026-02-01T09:00:00.000Z",
    computedAt: "2026-02-01T10:00:00.000Z",
  });
}

describe("ChromiumRenderEngine (real browser)", () => {
  it("renders a 60-row ar report across ≥2 pages with a repeating thead", async (ctx) => {
    const html = sixtyRowArabicReport();
    // The template contract: real <thead> (per-page header repetition), RTL,
    // embedded woff2 fonts (no network fetch inside render).
    expect(html).toContain("<thead>");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("data:font/woff2;base64,");
    if (!browserAvailable) {
      ctx.skip(); // no headless Chromium in this environment
    }

    const output = await engine.render({
      html,
      options: { format: "A4", locale: "ar", footerTemplate: pageFooterTemplate("ar") },
    });
    expect(output.pages).toBeGreaterThanOrEqual(2);
    expect(output.templateVersion).toBe(1);
    expect(output.pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(output.pdf.byteLength).toBeGreaterThan(10_000); // embedded fonts
  });

  it("stampPdfA2b preserves the page count of the rendered document", async (ctx) => {
    if (!browserAvailable) {
      ctx.skip(); // no headless Chromium in this environment
    }
    const html = sixtyRowArabicReport();
    const output = await engine.render({
      html,
      options: { format: "A4", locale: "ar", footerTemplate: pageFooterTemplate("ar") },
    });
    const stamped = await stampPdfA2b(output.pdf);
    expect(stamped.byteLength).toBeGreaterThan(0);
    expect(await pdfPageCount(stamped)).toBe(output.pages);
    // The archive stamp itself round-trips through pdf-lib.
    expect(await pdfPageCount(await stampPdfA2b(stamped))).toBe(output.pages);
  });
});
