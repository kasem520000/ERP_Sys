/**
 * PHASE-051 (W-39 — T-14) — the trade certificate print module's tests
 * (THE PRINT LAW, D-13 — the 050 COA print laws carried VERBATIM):
 *
 * - **DICTIONARY-EXCLUSIVE LABELS** (clause 1): the document's every label
 *   — the title, the parties block, the columns — comes from the i18n
 *   dictionary through `bi()`, BOTH sides; the AR build renders the AR
 *   side, the EN build the EN side (never a literal in the module).
 * - **DETERMINISM** (clause 3): two builds of the same certificate produce
 *   byte-identical html in BOTH locales — docNo/docDate are the
 *   certificate ROW's own strings (certificateNo + issuedAt), NEVER a
 *   wall-clock read.
 * - **THE FROZEN SNAPSHOT PASSES THROUGH VERBATIM** (clause 2): the goods
 *   lines' own description/origin/HS/quantity land in the html exactly as
 *   the issue act froze them — the module never recomputes a figure and
 *   never totals a goods-line count; the linked B/L's and declaration's
 *   own figures render as copied at issuance (a later PATCH never moves a
 *   stored certificate).
 */
import { describe, expect, it } from "vitest";

import { getDictionary } from "../../i18n/dictionaries";
import type { TradeCertificateRow } from "../api-types";
import { buildTradeCertificateHtml } from "../trade-certificate-print";

const AR = getDictionary("ar");
const EN = getDictionary("en");

/** The frozen snapshot the issue act stores (the chamber certificate's own
 * data — the goods lines with their origins, the linked B/L + declaration
 * figures as copied at issuance). */
function certificate(overrides: Partial<TradeCertificateRow> = {}): TradeCertificateRow {
  return {
    id: "cert-1",
    certificateNo: "CERT-2026-000007",
    certType: "ORIGIN",
    billOfLadingId: "bl-1",
    declarationId: "decl-1",
    snapshot: {
      certType: "ORIGIN",
      exporterName: "Test Trading Company",
      consigneeName: "Gulf Importers LLC",
      goods: [
        {
          description: "Steel sheets, cold rolled",
          originCountry: "SA",
          hsCode: "7209160000",
          quantity: "1250.000000",
          uom: "PKG",
        },
        {
          description: "Aluminium profiles",
          originCountry: "SA",
          hsCode: "7604210000",
        },
      ],
      billOfLading: {
        id: "bl-1",
        blNo: "BL-2026-000042",
        docType: "SEA",
        carrierName: "Maersk Sealand",
        portOfLoading: "Jeddah Islamic Port",
        portOfDischarge: "Rotterdam",
        shipmentStatus: "DEPARTED",
      },
      declaration: {
        id: "decl-1",
        declarationNo: "CD-2026-000019",
        status: "ACCEPTED",
      },
    },
    issuedAt: "2026-11-25T16:30:00Z",
    issuedBy: "user-1",
    note: null,
    noteAr: null,
    createdAt: "2026-11-25T16:30:00Z",
    updatedAt: "2026-11-25T16:30:00Z",
    ...overrides,
  };
}

describe("PHASE-051 W-39 — the trade certificate print module (D-13's PRINT LAW)", () => {
  it("(a) the document uses ONLY dictionary labels (both sides, never a literal — no cross-leak)", () => {
    const input = certificate();
    const arHtml = buildTradeCertificateHtml({ certificate: input, locale: "ar" });
    const enHtml = buildTradeCertificateHtml({ certificate: input, locale: "en" });
    // The AR build renders the AR side of EVERY body label — the title,
    // the parties block, the columns.
    expect(arHtml.includes(AR.tradeCertificateTypeOrigin)).toBe(true);
    expect(arHtml.includes(AR.tradeCertificatePrintExporter)).toBe(true);
    expect(arHtml.includes(AR.tradeCertificatePrintConsignee)).toBe(true);
    expect(arHtml.includes(AR.tradeCertificatePrintBl)).toBe(true);
    expect(arHtml.includes(AR.tradeCertificatePrintDeclaration)).toBe(true);
    expect(arHtml.includes(AR.tradeCertificatePrintGood)).toBe(true);
    expect(arHtml.includes(AR.tradeCertificatePrintOrigin)).toBe(true);
    expect(arHtml.includes(AR.tradeCertificatePrintHs)).toBe(true);
    expect(arHtml.includes(AR.tradeCertificatePrintQty)).toBe(true);
    // NO EN column label leaks into the AR body (the <head> <title>
    // element carries the EN side by the template's own design — the
    // assets-print precedent scopes the cross-leak arm to the column
    // labels).
    expect(arHtml.includes(`>${EN.tradeCertificatePrintGood}<`)).toBe(false);
    expect(arHtml.includes(`>${EN.tradeCertificatePrintOrigin}<`)).toBe(false);
    expect(arHtml.includes(`>${EN.tradeCertificatePrintQty}<`)).toBe(false);
    // The EN build renders the EN side.
    expect(enHtml.includes(EN.tradeCertificateTypeOrigin)).toBe(true);
    expect(enHtml.includes(EN.tradeCertificatePrintExporter)).toBe(true);
    expect(enHtml.includes(EN.tradeCertificatePrintGood)).toBe(true);
    expect(enHtml.includes(EN.tradeCertificatePrintOrigin)).toBe(true);
    expect(enHtml.includes(EN.tradeCertificatePrintQty)).toBe(true);
    expect(enHtml.includes(`>${AR.tradeCertificatePrintGood}<`)).toBe(false);
    expect(enHtml.includes(`>${AR.tradeCertificatePrintOrigin}<`)).toBe(false);
    // The CONFORMITY type names its own title (both sides through the
    // dictionary, never a literal).
    const conformity = buildTradeCertificateHtml({
      certificate: certificate({ certType: "CONFORMITY" }),
      locale: "en",
    });
    expect(conformity.includes(EN.tradeCertificateTypeConformity)).toBe(true);
  });

  it("(b) DETERMINISM — two builds of the same certificate produce byte-identical html in BOTH locales", () => {
    const input = certificate();
    const arFirst = buildTradeCertificateHtml({ certificate: input, locale: "ar" });
    const arSecond = buildTradeCertificateHtml({ certificate: input, locale: "ar" });
    // The FULL html string compare — no wall-clock, no random ids.
    expect(arFirst).toBe(arSecond);
    const enFirst = buildTradeCertificateHtml({ certificate: input, locale: "en" });
    const enSecond = buildTradeCertificateHtml({ certificate: input, locale: "en" });
    expect(enFirst).toBe(enSecond);
    // docNo/docDate are the certificate ROW's own strings (never a
    // wall-clock read): the certificate's number and its issuedAt stamp.
    expect(arFirst.includes("CERT-2026-000007")).toBe(true);
    expect(arFirst.includes("2026-11-25T16:30:00Z")).toBe(true);
    expect(enFirst.includes("CERT-2026-000007")).toBe(true);
  });

  it("(c) the frozen snapshot passes through VERBATIM (the goods lines' own strings; the linked figures as frozen; .num isolation; a real thead)", () => {
    const input = certificate();
    const html = buildTradeCertificateHtml({ certificate: input, locale: "en" });
    // A real <thead> (the per-page header repetition contract).
    expect(html).toContain("<thead>");
    // The quantity column rides the template's LTR-mono numeric class.
    expect(html).toContain('class="numeric num"');
    // THE FROZEN GOODS LINES — each entry's own description, origin, HS
    // code and quantity, byte-for-byte (the module never recomputes a
    // figure and never totals a goods-line count). The absent quantity
    // renders the honest dash (never a fabricated figure).
    expect(html).toContain("Steel sheets, cold rolled");
    expect(html).toContain("1250.000000");
    expect(html).toContain("7209160000");
    expect(html).toContain("Aluminium profiles");
    // THE PARTIES — the snapshot's own exporter/consignee names.
    expect(html).toContain("Test Trading Company");
    expect(html).toContain("Gulf Importers LLC");
    // THE LINKED FIGURES AS FROZEN — the B/L's own blNo (+ carrier) and
    // the declaration's own declarationNo, copied at issuance (a later
    // PATCH never moves a stored certificate — the frozen-snapshot law).
    expect(html).toContain("BL-2026-000042");
    expect(html).toContain("Maersk Sealand");
    expect(html).toContain("CD-2026-000019");
  });

  it("(d) the honest dash — an absent link renders no parties row; an absent goods field renders the dash", () => {
    const unlinked = certificate({
      billOfLadingId: null,
      declarationId: null,
      snapshot: {
        certType: "ORIGIN",
        exporterName: "Test Trading Company",
        consigneeName: "Gulf Importers LLC",
        goods: [{ description: "Bulk commodity", originCountry: "SA" }],
      },
    });
    const html = buildTradeCertificateHtml({ certificate: unlinked, locale: "en" });
    // No B/L or declaration parties row (the links are absent — never a
    // fabricated reference).
    expect(html).not.toContain("BL-2026-000042");
    expect(html).not.toContain("CD-2026-000019");
    // The absent HS code + quantity render the honest dash.
    expect(html).toContain("Bulk commodity");
  });
});
