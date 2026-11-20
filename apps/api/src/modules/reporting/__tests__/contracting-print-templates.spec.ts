import { describe, expect, it } from "vitest";

import {
  PRINT_TEMPLATE_VERSIONS,
  renderProgressCertificate,
  renderRetentionStatement,
  renderSubcontractorCertificate,
  type CertificatePrintPayload,
  type RetentionStatementPrintPayload,
} from "@erp/ui/print";

/**
 * PHASE-048 (W-13 — T-16) — the three bilingual CONTRACTING print
 * templates' unit suite (the plan §4's "the print-template specs (AR/EN
 * + RTL)"; the PHASE-013 base suite's own laws):
 *
 * - BOTH DIRECTIONS (the owner's clause 1): AR renders `dir="rtl"` with
 *   the AR title; EN renders `dir="ltr"` with the EN labels.
 * - PAGE-BREAK DISCIPLINE (clause 1's long tables): a real `<thead>`
 *   (Chromium repeats it per page) + the rows-atomic + blocks-never-split
 *   rules in the stylesheet.
 * - LTR-MONO NUMBERS IN BOTH LANGUAGES (clause 1): every numeric cell
 *   carries `class="numeric num"` — IBM Plex Mono + tabular-nums, digit
 *   order never mirrors.
 * - DETERMINISM (clause 3): NO wall-clock inside the templates — every
 *   date is a payload parameter; TWO RENDERS OF THE SAME PAYLOAD ARE
 *   BYTE-IDENTICAL (the golden determinism law), for all three
 *   templates in BOTH locales.
 * - ZERO PARALLEL COMPUTATION (clause 2): the engine's own figures ride
 *   the payload strings verbatim — the golden fixture's exact decimals
 *   render untouched (no rounding, no reformatting).
 */

function certificatePayload(
  locale: "ar" | "en",
  template: "a4-progress-certificate" | "a4-sub-certificate",
): CertificatePrintPayload {
  return {
    template,
    locale,
    title: { ar: "مستخلص أعمال", en: "Progress certificate" },
    docNo: "PC-2026-000042",
    docDate: "2026-11-30",
    branding: { tenantName: "شركة الاختبار للتجارة" },
    parties: [
      { label: { ar: "المشروع", en: "Project" }, lines: ["PJW-PRJ-1", "مشروع العالم المتسق"] },
      {
        label: { ar: "سجل العقد", en: "Contract register" },
        lines: ["قيمة العقد: 115000.0000 SAR", "نسبة الحجز: 5.00%"],
      },
    ],
    figures: [
      { label: { ar: "النوع", en: "Kind" }, value: "PROGRESS" },
      { label: { ar: "النسبة التراكمية", en: "Cumulative %" }, value: "45.00%" },
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
      { label: { ar: "القيمة الفعّالة", en: "Effective value" }, amount: "120000.0000" },
      { label: { ar: "المتبقي", en: "Remaining" }, amount: "30000.0000", isCheck: true },
    ],
    signatures: [
      { label: { ar: "إعداد", en: "Prepared by" } },
      { label: { ar: "المراجعة الفنية", en: "Technical review" } },
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
      { label: { ar: "المُفرَج عنه", en: "Released" }, value: "0.0000" },
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

describe("PHASE-048 W-13 — the contracting print templates (AR/EN + RTL + determinism)", () => {
  it("AR renders dir=rtl with the AR title; EN renders dir=ltr with the EN labels (both directions)", () => {
    const ar = renderProgressCertificate(certificatePayload("ar", "a4-progress-certificate"));
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(ar).toContain("مستخلص أعمال");
    const en = renderProgressCertificate(certificatePayload("en", "a4-progress-certificate"));
    expect(en).toContain('<html lang="en" dir="ltr">');
    expect(en).toContain("Progress certificate");
    expect(en).toContain("شركة الاختبار للتجارة");
    // The sub certificate + the statement mirror the law.
    expect(renderSubcontractorCertificate(certificatePayload("ar", "a4-sub-certificate"))).toContain('dir="rtl"');
    expect(renderRetentionStatement(statementPayload("en"))).toContain('dir="ltr"');
    expect(renderRetentionStatement(statementPayload("en"))).toContain("Retention statement");
  });

  it("the page-break discipline: a real thead + rows atomic + the totals/signature blocks never split", () => {
    const html = renderProgressCertificate(certificatePayload("ar", "a4-progress-certificate"));
    // A real <thead> — Chromium repeats it on every page of the long table.
    expect(html).toContain("<thead>");
    // Rows are atomic (a row never splits across pages).
    expect(html).toMatch(/tr\s*\{\s*break-inside:\s*avoid/);
    // The totals/signature/figures blocks never split.
    expect(html).toContain("avoid-break");
    // The fonts embed as data URIs (no network fetch inside the print).
    expect(html).toContain("data:font/woff2;base64,");
  });

  it("the numbers render LTR-mono in BOTH languages (numeric cells carry the .num isolation)", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = renderProgressCertificate(certificatePayload(locale, "a4-progress-certificate"));
      // Every numeric cell (figures + table + totals) carries class="...num".
      expect(html).toContain('class="numeric num"');
      // The tabular-nums + mono font rule rides the stylesheet.
      expect(html).toMatch(/\.num\s*\{\s*font-variant-numeric:\s*tabular-nums/);
      // The engine's own figures render VERBATIM (no reformatting).
      expect(html).toContain("45000.0000");
      expect(html).toContain("2250.0000");
      expect(html).toContain("42750.0000");
    }
  });

  it("DETERMINISM — two renders of the same payload are byte-identical, all three templates, both locales (no wall-clock)", () => {
    for (const locale of ["ar", "en"] as const) {
      const progress = certificatePayload(locale, "a4-progress-certificate");
      expect(renderProgressCertificate(progress)).toBe(renderProgressCertificate(progress));
      const sub = certificatePayload(locale, "a4-sub-certificate");
      expect(renderSubcontractorCertificate(sub)).toBe(renderSubcontractorCertificate(sub));
      const statement = statementPayload(locale);
      expect(renderRetentionStatement(statement)).toBe(renderRetentionStatement(statement));
    }
    // The only dates in the document are the payload's own parameters
    // (docDate/asOf — never a template-side clock read): the golden
    // fixture's dates render, and no "computed at"-style stamp exists.
    const html = renderRetentionStatement(statementPayload("en"));
    expect(html).toContain("2026-11-01T00:00:00Z");
    expect(html).not.toContain("computed at");
  });

  it("the zero-parallel-computation law: the golden figures ride the paper untouched (no rounding, no separators)", () => {
    const html = renderProgressCertificate(certificatePayload("en", "a4-progress-certificate"));
    // The 4dp engine strings render EXACTLY (never 2dp, never thousands).
    expect(html).toContain("45000.0000");
    expect(html).not.toContain("45,000.00");
    expect(html).not.toContain("45,000.0000");
    // The retention statement renders NO totals block (a cross-kind sum
    // would be a parallel computation — the payload carries none).
    const statement = renderRetentionStatement(statementPayload("ar"));
    expect(statement).not.toContain('class="totals');
  });

  it("the version registry freezes the three contracting templates at v1 (additive; the base four unchanged)", () => {
    expect(PRINT_TEMPLATE_VERSIONS["a4-progress-certificate"]).toBe(1);
    expect(PRINT_TEMPLATE_VERSIONS["a4-sub-certificate"]).toBe(1);
    expect(PRINT_TEMPLATE_VERSIONS["a4-retention-statement"]).toBe(1);
    // The base four unchanged (the PHASE-037 freeze).
    expect(PRINT_TEMPLATE_VERSIONS["a4-document"]).toBe(2);
    expect(PRINT_TEMPLATE_VERSIONS["a4-report"]).toBe(1);
    expect(PRINT_TEMPLATE_VERSIONS["receipt-80"]).toBe(2);
    expect(PRINT_TEMPLATE_VERSIONS["receipt-58"]).toBe(2);
  });
});
