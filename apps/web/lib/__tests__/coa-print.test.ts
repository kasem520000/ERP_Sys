/**
 * PHASE-050 (W-29 — T-15) — the COA print module's tests (THE PRINT LAW,
 * the W-13/W-21 clauses carried verbatim from assets-print.test.ts):
 *
 * - **DICTIONARY-EXCLUSIVE LABELS** (clause 1): the document's every label
 *   — the title, the parties block, the columns — comes from the i18n
 *   dictionary through `bi()`, BOTH sides; the AR build renders the AR
 *   side, the EN build the EN side (never a literal in the module).
 * - **DETERMINISM** (clause 3): two builds of the same certificate produce
 *   byte-identical html in BOTH locales — docNo/docDate are the
 *   certificate ROW's own strings (docNo + issuedAt), NEVER a wall-clock
 *   read.
 * - **THE FROZEN SNAPSHOT PASSES THROUGH VERBATIM** (clause 2): each
 *   parameter's own name/unit/measured value/verdict lands in the html
 *   exactly as the gate stored it — the module never recomputes a verdict
 *   and never totals a count.
 */
import { describe, expect, it } from "vitest";

import { getDictionary } from "../../i18n/dictionaries";
import type { CoaDocumentRow } from "../api-types";
import { buildCoaDocumentHtml } from "../coa-print";

const AR = getDictionary("ar");
const EN = getDictionary("en");

/** The frozen snapshot the engine stores (the gate fold's own entries —
 * one WITHIN, one accepted deviation, the bilingual names carried). */
function certificate(overrides: Partial<CoaDocumentRow> = {}): CoaDocumentRow {
  return {
    id: "coa-1",
    docNo: "COA-2026-000011",
    docType: "COA",
    itemId: "item-1",
    batchId: "batch-1",
    inspectionId: null,
    parameters: [
      {
        specId: "spec-1",
        parameter: "Thickness",
        parameterAr: "السماكة",
        unit: "mm",
        targetValue: "2.500000",
        ucl: "2.600000",
        lcl: "2.400000",
        value: "2.512000",
        toleranceVerdict: "WITHIN",
        gate: "PASS",
        breachedLimit: null,
        ncrId: null,
      },
      {
        specId: "spec-2",
        parameter: "Coating",
        parameterAr: "الطلاء",
        unit: "g/m2",
        targetValue: "120.000000",
        ucl: "140.000000",
        lcl: "100.000000",
        value: "142.500000",
        toleranceVerdict: "ABOVE_UCL",
        gate: "PASS_DEVIATION_ACCEPTED",
        breachedLimit: "140.000000",
        ncrId: "ncr-1",
      },
    ],
    issuedAt: "2026-11-22T14:00:00Z",
    issuedBy: "user-1",
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-22T14:00:00Z",
    updatedAt: "2026-11-22T14:00:00Z",
    ...overrides,
  };
}

describe("PHASE-050 W-29 — the COA print module (THE PRINT LAW)", () => {
  it("(a) the document uses ONLY dictionary labels (both sides, never a literal — no cross-leak)", () => {
    const input = certificate();
    const arHtml = buildCoaDocumentHtml({ certificate: input, locale: "ar" });
    const enHtml = buildCoaDocumentHtml({ certificate: input, locale: "en" });
    // The AR build renders the AR side of EVERY body label — the title,
    // the parties block, the columns.
    expect(arHtml.includes(AR.qualityCoaDocTypeCoa)).toBe(true);
    expect(arHtml.includes(AR.qualityCoaColItem)).toBe(true);
    expect(arHtml.includes(AR.qualityCoaPrintParam)).toBe(true);
    expect(arHtml.includes(AR.qualityCoaPrintUnit)).toBe(true);
    expect(arHtml.includes(AR.qualityCoaPrintValue)).toBe(true);
    expect(arHtml.includes(AR.qualityCoaPrintVerdict)).toBe(true);
    expect(arHtml.includes(AR.qualityCoaVerdictPass)).toBe(true);
    expect(arHtml.includes(AR.qualityCoaVerdictPassDeviation)).toBe(true);
    // NO EN column label leaks into the AR body (the <head> <title> element
    // carries the EN side by the template's own design — the assets-print
    // precedent scopes the cross-leak arm to the column labels).
    expect(arHtml.includes(`>${EN.qualityCoaPrintParam}<`)).toBe(false);
    expect(arHtml.includes(`>${EN.qualityCoaPrintValue}<`)).toBe(false);
    expect(arHtml.includes(`>${EN.qualityCoaPrintVerdict}<`)).toBe(false);
    expect(arHtml.includes(`>${EN.qualityCoaVerdictPass}<`)).toBe(false);
    // The EN build renders the EN side.
    expect(enHtml.includes(EN.qualityCoaDocTypeCoa)).toBe(true);
    expect(enHtml.includes(EN.qualityCoaPrintParam)).toBe(true);
    expect(enHtml.includes(EN.qualityCoaPrintValue)).toBe(true);
    expect(enHtml.includes(EN.qualityCoaVerdictPass)).toBe(true);
    expect(enHtml.includes(EN.qualityCoaVerdictPassDeviation)).toBe(true);
    expect(enHtml.includes(`>${AR.qualityCoaPrintParam}<`)).toBe(false);
    expect(enHtml.includes(`>${AR.qualityCoaVerdictPass}<`)).toBe(false);
    // The frozen snapshot's bilingual parameter names — the ACTIVE
    // locale's side (AR build → the Arabic names, EN build → the Latin).
    expect(arHtml.includes("السماكة")).toBe(true);
    expect(arHtml.includes("الطلاء")).toBe(true);
    expect(arHtml.includes(">Thickness<")).toBe(false);
    expect(enHtml.includes("Thickness")).toBe(true);
    expect(enHtml.includes("Coating")).toBe(true);
    expect(enHtml.includes("السماكة")).toBe(false);
  });

  it("(b) DETERMINISM — two builds of the same certificate produce byte-identical html in BOTH locales", () => {
    const input = certificate();
    const arFirst = buildCoaDocumentHtml({ certificate: input, locale: "ar" });
    const arSecond = buildCoaDocumentHtml({ certificate: input, locale: "ar" });
    // The FULL html string compare — no wall-clock, no random ids.
    expect(arFirst).toBe(arSecond);
    const enFirst = buildCoaDocumentHtml({ certificate: input, locale: "en" });
    const enSecond = buildCoaDocumentHtml({ certificate: input, locale: "en" });
    expect(enFirst).toBe(enSecond);
    // docNo/docDate are the certificate ROW's own strings (never a
    // wall-clock read): the certificate's docNo and its issuedAt stamp.
    expect(arFirst.includes("COA-2026-000011")).toBe(true);
    expect(arFirst.includes("2026-11-22T14:00:00Z")).toBe(true);
    expect(enFirst.includes("COA-2026-000011")).toBe(true);
  });

  it("(c) the frozen parameters pass through VERBATIM (each entry's own strings; .num isolation; a real thead)", () => {
    const input = certificate();
    const html = buildCoaDocumentHtml({ certificate: input, locale: "en" });
    // A real <thead> (the per-page header repetition contract).
    expect(html).toContain("<thead>");
    // The measured-value column rides the template's LTR-mono numeric class.
    expect(html).toContain('class="numeric num"');
    // THE FROZEN FIGURES — each entry's own measured value, unit and
    // stored verdict, byte-for-byte (the module never recomputes a
    // verdict and never totals a parameter count).
    expect(html).toContain("2.512000");
    expect(html).toContain("142.500000");
    expect(html).toContain("mm");
    expect(html).toContain("g/m2");
    // The stored gates render through the dictionary's verdict vocabulary
    // (PASS and PASS_DEVIATION_ACCEPTED — the tolerance verdict
    // ABOVE_UCL is the engine's own record, never re-judged here).
    expect(html).toContain(EN.qualityCoaVerdictPass);
    expect(html).toContain(EN.qualityCoaVerdictPassDeviation);
    // The parties block carries the row's own ids verbatim.
    expect(html).toContain("item-1");
    expect(html).toContain("batch-1");
  });
});
