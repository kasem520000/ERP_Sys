import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pageFooterTemplate, renderA4Document, type A4DocumentPayload } from "@erp/ui/print";

import { ChromiumRenderEngine } from "../../modules/reporting/application/render/render-engine";

/**
 * PHASE-051 (W-39 — T-14) — the ACTUAL PRINT TEST for the certificate of
 * origin/conformity's A4 document (D-13 — the 050 COA print-render
 * precedent carried VERBATIM): the REAL headless Chromium renders the
 * SAME a4-document payload the web certificates board's builder
 * produces (the frozen snapshot VERBATIM — the goods lines, the
 * exporter/consignee, the linked B/L + declaration figures as frozen)
 * in BOTH locales — every render is a real PDF with the embedded woff2
 * fonts, the html direction follows the locale (rtl/ltr), and the
 * numeric cells ride the .num LTR-mono isolation.
 *
 * The payload is the SPEC'S OWN certificate-shaped fixture (bilingual
 * labels inline, assembled from the frozen-snapshot rows — the COA
 * spec's own pattern); the PRODUCTION labels come from the app i18n
 * dictionary exclusively (the web builder's dictionary-exclusivity arm,
 * proven in the web trade-certificate-print spec). The suite skips
 * gracefully when the browser cannot launch (the render.spec precedent:
 * a probe render in beforeAll decides).
 */

/**
 * THE DETERMINISM FINDING (dated 2026-11-23, the probe's own evidence —
 * carried verbatim from the 050 W-29 finding): the REAL Chromium PDF is
 * deterministic in EVERY byte except the renderer's own wall-clock
 * metadata — Skia stamps `/CreationDate (D:YYYYMMDDhhmmss…)` and
 * `/ModDate (…)` into the document-info object at SECOND resolution (a
 * 40-pair probe: 31 pairs byte-identical; the 9 that crossed a second
 * boundary differed at exactly those two lines and nowhere else). The
 * payload itself carries NO wall-clock (docNo/docDate are the
 * certificate row's own strings), so the determinism arm asserts
 * byte-identity of the two BUILDS (full html compare) and byte-identity
 * of the two RENDERS with the renderer's own clock stamps normalized —
 * the honest statement of the renderer's contract, never a flaky
 * coin-flip on wall-clock timing.
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

/** One frozen-snapshot goods entry (the issue act's own stored shape —
 * the certificate's immutable history, rendered VERBATIM). */
interface FrozenGood {
  readonly description: string;
  readonly originCountry: string;
  readonly hsCode: string;
  readonly quantity: string;
}

const FROZEN_GOODS: readonly FrozenGood[] = [
  {
    description: "Steel sheets, cold rolled",
    originCountry: "SA",
    hsCode: "7209160000",
    quantity: "1250.000000",
  },
  {
    description: "Aluminium profiles",
    originCountry: "SA",
    hsCode: "7604210000",
    quantity: "500.000000",
  },
  {
    description: "Copper wire rod",
    originCountry: "SA",
    hsCode: "7408190000",
    quantity: "200.000000",
  },
];

/** The certificate-shaped A4 payload — the SAME a4-document shape the
 * web certificates board's builder produces (the parties block carries
 * the exporter/consignee + the frozen links, the columns the goods
 * table, the rows the frozen snapshot's own strings). */
function certificatePayload(locale: "ar" | "en"): A4DocumentPayload {
  return {
    template: "a4-document",
    locale,
    title: { ar: "شهادة منشأ", en: "Certificate of origin" },
    docNo: "CERT-2026-000007",
    docDate: "2026-11-25T16:30:00Z",
    branding: { tenantName: "شركة الاختبار للتجارة" },
    parties: [
      { label: { ar: "المصدِّر", en: "Exporter" }, lines: ["شركة الاختبار للتجارة"] },
      { label: { ar: "المرسَل إليه", en: "Consignee" }, lines: ["Gulf Importers LLC"] },
      { label: { ar: "سند الشحن", en: "Bill of lading" }, lines: ["BL-2026-000042 · Maersk Sealand"] },
      { label: { ar: "التصريح الجمركي", en: "Customs declaration" }, lines: ["CD-2026-000019"] },
    ],
    columns: [
      { label: { ar: "البضاعة", en: "Goods" } },
      { label: { ar: "المنشأ", en: "Origin" } },
      { label: { ar: "رمز النظام المنسق", en: "HS code" } },
      { label: { ar: "الكمية", en: "Quantity" }, numeric: true },
    ],
    rows: FROZEN_GOODS.map((entry) => [
      entry.description,
      entry.originCountry,
      entry.hsCode,
      entry.quantity,
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

describe("PHASE-051 W-39 — the certificate print in the REAL browser (both directions, the frozen snapshot)", () => {
  it("the certificate document: a real thead, the locale's direction, the .num isolation, the embedded fonts (AR + EN)", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = renderA4Document(certificatePayload(locale));
      // The template contract: a real thead, the locale's direction, the
      // LTR-mono numeric isolation, embedded woff2 fonts (no network fetch
      // inside render).
      expect(html).toContain("<thead>");
      expect(html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`);
      expect(html).toContain('class="numeric num"');
      expect(html).toContain("data:font/woff2;base64,");
      // The frozen snapshot's own strings, VERBATIM (the issue act's own
      // values — never recomputed).
      expect(html).toContain("1250.000000");
      expect(html).toContain("500.000000");
      expect(html).toContain("200.000000");
      expect(html).toContain("7209160000");
      // The frozen links' own figures as copied at issuance.
      expect(html).toContain("BL-2026-000042");
      expect(html).toContain("CD-2026-000019");
    }
  });

  it("the REAL Chromium render: a multi-kilobyte %PDF in both locales", async (ctx) => {
    if (!browserAvailable) {
      ctx.skip(); // no headless Chromium in this environment
    }
    for (const locale of ["ar", "en"] as const) {
      const html = renderA4Document(certificatePayload(locale));
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
      expect(renderA4Document(certificatePayload(locale))).toBe(renderA4Document(certificatePayload(locale)));
    }
    if (!browserAvailable) {
      ctx.skip(); // no headless Chromium in this environment
    }
    for (const locale of ["ar", "en"] as const) {
      const html = renderA4Document(certificatePayload(locale));
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
