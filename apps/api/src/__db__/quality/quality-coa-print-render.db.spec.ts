import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pageFooterTemplate, renderA4Document, type A4DocumentPayload } from "@erp/ui/print";

import { ChromiumRenderEngine } from "../../modules/reporting/application/render/render-engine";

/**
 * PHASE-050 (W-29 — T-15) — the ACTUAL PRINT TEST for the certificate of
 * analysis/conformity's A4 document (the projects-print-render precedent
 * carried verbatim): the REAL headless Chromium renders the SAME
 * a4-document payload the web COA board's builder produces (the frozen
 * parameters snapshot VERBATIM) in BOTH locales — every render is a real
 * PDF with the embedded woff2 fonts, the html direction follows the locale
 * (rtl/ltr), and the numeric cells ride the .num LTR-mono isolation.
 *
 * The payload is the SPEC'S OWN COA-shaped fixture (bilingual labels
 * inline, assembled from the frozen-parameters rows — the projects spec's
 * own pattern); the PRODUCTION labels come from the app i18n dictionary
 * exclusively (the web builder's dictionary-exclusivity arm, proven in the
 * web coa-print spec). The suite skips gracefully when the browser cannot
 * launch (the render.spec precedent: a probe render in beforeAll decides).
 */

/**
 * THE DETERMINISM FINDING (dated 2026-11-23, the probe's own evidence): the
 * REAL Chromium PDF is deterministic in EVERY byte except the renderer's
 * own wall-clock metadata — Skia stamps `/CreationDate (D:YYYYMMDDhhmmss…)`
 * and `/ModDate (…)` into the document-info object at SECOND resolution
 * (a 40-pair probe: 31 pairs byte-identical; the 9 that crossed a second
 * boundary differed at exactly those two lines and nowhere else). The
 * payload itself carries NO wall-clock (docNo/docDate are the certificate
 * row's own strings), so the determinism arm asserts byte-identity of the
 * two BUILDS (full html compare) and byte-identity of the two RENDERS with
 * the renderer's own clock stamps normalized — the honest statement of the
 * renderer's contract, never a flaky coin-flip on wall-clock timing.
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

/** One frozen-snapshot parameter entry (the gate fold's own stored shape —
 * the certificate's immutable history, rendered VERBATIM). */
interface FrozenParameter {
  readonly parameter: string;
  readonly parameterAr: string;
  readonly unit: string;
  readonly value: string;
  readonly verdict: string;
  readonly verdictAr: string;
}

const FROZEN_PARAMETERS: readonly FrozenParameter[] = [
  {
    parameter: "Thickness",
    parameterAr: "السماكة",
    unit: "mm",
    value: "2.512000",
    verdict: "Conforms",
    verdictAr: "مطابق",
  },
  {
    parameter: "Coating",
    parameterAr: "الطلاء",
    unit: "g/m2",
    value: "142.500000",
    verdict: "Deviation accepted",
    verdictAr: "انحراف مقبول",
  },
  {
    parameter: "Density",
    parameterAr: "الكثافة",
    unit: "g/cm3",
    value: "7.850000",
    verdict: "Conforms",
    verdictAr: "مطابق",
  },
];

/** The COA-shaped A4 payload — the SAME a4-document shape the web COA
 * builder produces (the parties block carries the item/batch, the columns
 * the parameter table, the rows the frozen snapshot's own strings). */
function coaPayload(locale: "ar" | "en"): A4DocumentPayload {
  return {
    template: "a4-document",
    locale,
    title: { ar: "شهادة تحليل (COA)", en: "Certificate of analysis (COA)" },
    docNo: "COA-2026-000011",
    docDate: "2026-11-22T14:00:00Z",
    branding: { tenantName: "شركة الاختبار للتجارة" },
    parties: [
      { label: { ar: "الصنف", en: "Item" }, lines: ["item-1"] },
      { label: { ar: "المجموعة", en: "Batch" }, lines: ["batch-1"] },
    ],
    columns: [
      { label: { ar: "المعامل", en: "Parameter" } },
      { label: { ar: "الوحدة", en: "Unit" } },
      { label: { ar: "القيمة", en: "Value" }, numeric: true },
      { label: { ar: "الحكم", en: "Verdict" } },
    ],
    rows: FROZEN_PARAMETERS.map((entry) => [
      locale === "ar" ? entry.parameterAr : entry.parameter,
      entry.unit,
      entry.value,
      locale === "ar" ? entry.verdictAr : entry.verdict,
    ]),
    totals: [],
  };
}

/** Skia's own wall-clock metadata stamps — the renderer's /CreationDate +
 * /ModDate lines (second resolution). Everything else in the output is a
 * pure function of the html payload. */
function stripRendererClockStamps(pdf: Buffer): string {
  return pdf
    .toString("latin1")
    .replace(/\/(CreationDate|ModDate) \(D:\d{14}[^)]*\)/g, "/$1 (normalized)");
}

describe("PHASE-050 W-29 — the COA print in the REAL browser (both directions, the frozen snapshot)", () => {
  it("the certificate document: a real thead, the locale's direction, the .num isolation, the embedded fonts (AR + EN)", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = renderA4Document(coaPayload(locale));
      // The template contract: a real thead, the locale's direction, the
      // LTR-mono numeric isolation, embedded woff2 fonts (no network fetch
      // inside render).
      expect(html).toContain("<thead>");
      expect(html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`);
      expect(html).toContain('class="numeric num"');
      expect(html).toContain("data:font/woff2;base64,");
      // The frozen parameters' own strings, VERBATIM (the engine's own
      // values — never recomputed).
      expect(html).toContain("2.512000");
      expect(html).toContain("142.500000");
      expect(html).toContain("7.850000");
    }
  });

  it("the REAL Chromium render: a multi-kilobyte %PDF in both locales", async (ctx) => {
    if (!browserAvailable) {
      ctx.skip(); // no headless Chromium in this environment
    }
    for (const locale of ["ar", "en"] as const) {
      const html = renderA4Document(coaPayload(locale));
      const output = await engine.render({
        html,
        options: { format: "A4", locale, footerTemplate: pageFooterTemplate(locale) },
      });
      expect(output.pages).toBeGreaterThanOrEqual(1);
      expect(output.pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
      expect(output.pdf.byteLength).toBeGreaterThan(10_000); // embedded fonts
    }
  });

  it("DETERMINISM — two builds byte-identical; two renders byte-identical modulo the renderer's own clock stamps (AR + EN)", async (ctx) => {
    for (const locale of ["ar", "en"] as const) {
      // THE BUILDS: the payload carries no wall-clock (docNo/docDate are
      // the certificate row's own strings) — the full html strings are
      // byte-for-byte identical.
      expect(renderA4Document(coaPayload(locale))).toBe(renderA4Document(coaPayload(locale)));
    }
    if (!browserAvailable) {
      ctx.skip(); // no headless Chromium in this environment
    }
    for (const locale of ["ar", "en"] as const) {
      const html = renderA4Document(coaPayload(locale));
      const first = await engine.render({
        html,
        options: { format: "A4", locale, footerTemplate: pageFooterTemplate(locale) },
      });
      const second = await engine.render({
        html,
        options: { format: "A4", locale, footerTemplate: pageFooterTemplate(locale) },
      });
      expect(first.pages).toBe(second.pages);
      expect(first.pdf.byteLength).toBe(second.pdf.byteLength);
      // THE RENDERS: byte-for-byte identical with the renderer's own
      // /CreationDate + /ModDate wall-clock stamps normalized — Skia's
      // only nondeterminism (the dated finding above), the payload's own
      // bytes identical.
      expect(stripRendererClockStamps(first.pdf)).toBe(stripRendererClockStamps(second.pdf));
    }
  });
});
