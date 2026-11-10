import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ELECTRONICS_TEMPLATE_MANIFEST,
  HEALTHCARE_TEMPLATE_MANIFEST,
  SHIPPED_TEMPLATE_MANIFESTS,
  WHOLESALE_TEMPLATE_MANIFEST,
  type IndustryTemplateManifest,
} from "@erp/contracts";

/**
 * PHASE-030 T7 — the capability-matrix cross-check (register §L
 * reconciliation rule; CAPABILITY_MATRIX §1):
 *
 * (a) The three stage-10 templates reconcile STRICTLY, both directions and
 *     zero mismatches: manifest `capability_prerequisites` ≡ the matrix's
 *     WHL / ELC / HLT columns (REQ ⇔ REQUIRED, OPT ⇔ OPTIONAL, N/A ⇔ absent).
 *     Drift in either direction fails CI.
 * (b) The seven pre-existing templates reconcile on the strict legs only —
 *     a manifest capability with NO matrix row fails (the typo guard), and
 *     a capability declared against an N/A cell fails. Their
 *     planned-vs-shipped delta (matrix cells the v2.0 planning table
 *     carries but the shipped manifests predate — the matrix is dated
 *     2026-11-02, after the 015/017/018/019 manifests froze) is pinned as
 *     the KNOWN_DELTA snapshot below: shrinking it is a reviewed
 *     doc-change, growing it fails CI. PHASE-032/033 extend
 *     COLUMN_TO_TEMPLATE as their shells ship — the harness needs no
 *     rewrite (the durable artifact the PHASE-030 handoff names).
 */

// -- the §1 table parser ----------------------------------------------------------

const MATRIX_PATH = join(
  process.cwd(),
  "..",
  "..",
  "docs",
  "industries",
  "capabilities",
  "CAPABILITY_MATRIX.md",
);

interface MatrixTable {
  readonly columns: readonly string[];
  readonly rows: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

function parseMatrixSection(): MatrixTable {
  const text = readFileSync(MATRIX_PATH, "utf8");
  const section = text.split("## 1. Matrix")[1]!.split("## 2.")[0]!;
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  const header = lines[0]!
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  const columns = header.slice(1); // drop the leading "Capability" label
  const rows = new Map<string, Map<string, string>>();
  for (const line of lines.slice(2)) {
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
    const capability = cells[0]!.replace(/^`|`$/g, "");
    const perColumn = new Map<string, string>();
    columns.forEach((column, index) => {
      perColumn.set(column, cells[index + 1] ?? "");
    });
    rows.set(capability, perColumn);
  }
  return { columns, rows };
}

/** The matrix column each shipped template reconciles against. */
const COLUMN_TO_TEMPLATE: Readonly<Record<string, string>> = Object.freeze({
  RET: "industry.retail",
  GRO: "industry.grocery",
  RST: "industry.restaurant",
  AUT: "industry.automotive",
  DST: "industry.distribution",
  MFG: "industry.food_manufacturing",
  SVC: "industry.professional_services",
  RNT: "industry.rental_logistics",
  WHL: "industry.wholesale",
  ELC: "industry.electronics",
  HLT: "industry.healthcare",
  // The restoration merge: education + agriculture shipped on the surviving
  // lineage (032/033) and now map here too — the 2026-11-02 planning matrix
  // carries their columns with the exact cells the shipped manifests declare.
  EDU: "industry.education",
  AGR: "industry.agriculture",
});

/** The columns whose reconciliation is STRICT both directions (030+/the restoration/the completion). */
const STRICT_COLUMNS: readonly string[] = ["WHL", "ELC", "HLT", "EDU", "AGR", "RNT"];

/**
 * The frozen pre-existing planned-vs-shipped delta (part (b)): cells the
 * 2026-11-02 planning matrix carries for the seven pre-030 templates whose
 * manifests predate the v2.0 capability intake. Recorded, not silent —
 * and not silently growing either.
 */
const KNOWN_DELTA: readonly string[] = Object.freeze([
  "RET x expiry_tracking_fefo: matrix OPT, manifest omits",
  "RET x customer_price_tiers: matrix OPT, manifest omits",
  "RET x commissions: matrix OPT, manifest omits",
  "RET x pdc_notes: matrix OPT, manifest omits",
  "RET x installment_terms: matrix OPT, manifest omits",
  "GRO x free_goods_promo: matrix REQ, manifest OPTIONAL",
  "GRO x commissions: matrix OPT, manifest omits",
  "GRO x landed_costs: matrix OPT, manifest omits",
  "GRO x pdc_notes: matrix OPT, manifest omits",
  "RST x scale_barcodes: matrix OPT, manifest omits",
  "RST x qc_inspections: matrix OPT, manifest omits",
  "RST x pdc_notes: matrix OPT, manifest omits",
  "AUT x cashier_shifts: matrix OPT, manifest omits",
  "AUT x composite_kits: matrix OPT, manifest omits",
  "AUT x customer_price_tiers: matrix REQ, manifest omits",
  "AUT x free_goods_promo: matrix OPT, manifest omits",
  "AUT x recurring_billing: matrix OPT, manifest omits",
  "AUT x pdc_notes: matrix OPT, manifest omits",
  "AUT x installment_terms: matrix OPT, manifest omits",
  "DST x barcode_pos: matrix OPT, manifest omits",
  "DST x composite_kits: matrix OPT, manifest omits",
  "DST x shipment_tracking: matrix OPT, manifest omits",
  "DST x pdc_notes: matrix REQ, manifest omits",
  "DST x installment_terms: matrix OPT, manifest omits",
  "MFG x composite_kits: matrix OPT, manifest omits",
  "MFG x landed_costs: matrix OPT, manifest REQUIRED",
  "MFG x pdc_notes: matrix OPT, manifest omits",
  "MFG x harvest_batches: matrix OPT, manifest omits",
  "SVC x cashier_shifts: matrix OPT, manifest omits",
  "SVC x customer_price_tiers: matrix OPT, manifest omits",
  "SVC x pdc_notes: matrix REQ, manifest omits",
  "SVC x installment_terms: matrix OPT, manifest omits",
]);

// -- the reconciliation ------------------------------------------------------------

describe("capability-matrix reconciliation (register §L; CAPABILITY_MATRIX §1)", () => {
  const matrix = parseMatrixSection();
  const byId = new Map<string, IndustryTemplateManifest>(
    SHIPPED_TEMPLATE_MANIFESTS.map((manifest) => [manifest.id, manifest]),
  );

  /** One reconciliation pass for a column → its mismatch list. */
  function reconcile(column: string, manifest: IndustryTemplateManifest): string[] {
    const out: string[] = [];
    for (const [capabilityId, perColumn] of matrix.rows) {
      const cell = perColumn.get(column) ?? "";
      const declared = manifest.capability_prerequisites[capabilityId];
      if (cell === "" || cell === "N/A") {
        if (declared !== undefined) {
          out.push(
            `${column} x ${capabilityId}: ${cell || "(empty)"} but manifest declares ${declared.level}`,
          );
        }
        continue;
      }
      const expectedLevel = cell === "REQ" ? "REQUIRED" : cell === "OPT" ? "OPTIONAL" : null;
      if (expectedLevel === null) {
        out.push(`${column} x ${capabilityId}: unrecognized matrix cell '${cell}'`);
        continue;
      }
      if (declared === undefined) {
        out.push(`${column} x ${capabilityId}: matrix ${cell}, manifest omits`);
      } else if (declared.level !== expectedLevel) {
        out.push(`${column} x ${capabilityId}: matrix ${cell}, manifest ${declared.level}`);
      }
    }
    for (const capabilityId of Object.keys(manifest.capability_prerequisites)) {
      if (!matrix.rows.has(capabilityId)) {
        out.push(`${column} x ${capabilityId}: manifest capability with NO matrix row`);
      }
    }
    return out;
  }

  it("the §1 table parses with the 13 industry columns and a non-empty row set", () => {
    expect(matrix.columns).toEqual([
      "RET",
      "GRO",
      "RST",
      "AUT",
      "DST",
      "MFG",
      "SVC",
      "RNT",
      "WHL",
      "ELC",
      "HLT",
      "EDU",
      "AGR",
    ]);
    expect(matrix.rows.size).toBeGreaterThanOrEqual(25);
  });

  it("every shipped template has a matrix column mapping (the 13 shipped × 13 mapped)", () => {
    const mapped = new Set(Object.values(COLUMN_TO_TEMPLATE));
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      expect(mapped.has(manifest.id), manifest.id).toBe(true);
    }
    expect(SHIPPED_TEMPLATE_MANIFESTS).toHaveLength(13);
  });

  it("WHL + ELC + HLT + EDU + AGR + RNT reconcile STRICTLY — zero mismatches, both directions (the 030/031 gates + the restoration merge's 032/033 shells + the delivery-completion rental shell)", () => {
    for (const column of STRICT_COLUMNS) {
      const manifest = byId.get(COLUMN_TO_TEMPLATE[column]!)!;
      const mismatches = reconcile(column, manifest);
      expect(mismatches, `${column}:\n${mismatches.join("\n")}`).toEqual([]);
    }
  });

  it("the register §L explicit rows: pdc_notes (REQ/OPT/REQ), installment_terms (OPT/OPT/OPT), imei_tracking (OPT/REQ/N/A), job_cards (N/A/REQ/REQ), customer_price_tiers (REQ/OPT/OPT), insurance_claim_billing (N/A/N/A/REQ)", () => {
    const cell = (capability: string, column: string) => matrix.rows.get(capability)!.get(column);

    expect(`${cell("pdc_notes", "WHL")}/${cell("pdc_notes", "ELC")}/${cell("pdc_notes", "HLT")}`).toBe(
      "REQ/OPT/REQ",
    );
    expect(WHOLESALE_TEMPLATE_MANIFEST.capability_prerequisites.pdc_notes?.level).toBe("REQUIRED");
    expect(ELECTRONICS_TEMPLATE_MANIFEST.capability_prerequisites.pdc_notes?.level).toBe(
      "OPTIONAL",
    );
    expect(HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites.pdc_notes?.level).toBe("REQUIRED");

    expect(
      `${cell("installment_terms", "WHL")}/${cell("installment_terms", "ELC")}/${cell("installment_terms", "HLT")}`,
    ).toBe("OPT/OPT/OPT");
    expect(WHOLESALE_TEMPLATE_MANIFEST.capability_prerequisites.installment_terms?.level).toBe(
      "OPTIONAL",
    );
    expect(ELECTRONICS_TEMPLATE_MANIFEST.capability_prerequisites.installment_terms?.level).toBe(
      "OPTIONAL",
    );
    expect(HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites.installment_terms?.level).toBe(
      "OPTIONAL",
    );

    expect(
      `${cell("imei_tracking", "WHL")}/${cell("imei_tracking", "ELC")}/${cell("imei_tracking", "HLT")}`,
    ).toBe("OPT/REQ/N/A");
    expect(WHOLESALE_TEMPLATE_MANIFEST.capability_prerequisites.imei_tracking?.level).toBe(
      "OPTIONAL",
    );
    expect(ELECTRONICS_TEMPLATE_MANIFEST.capability_prerequisites.imei_tracking?.level).toBe(
      "REQUIRED",
    );
    expect(HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites.imei_tracking).toBeUndefined();

    expect(`${cell("job_cards", "WHL")}/${cell("job_cards", "ELC")}/${cell("job_cards", "HLT")}`).toBe(
      "N/A/REQ/REQ",
    );
    expect(WHOLESALE_TEMPLATE_MANIFEST.capability_prerequisites.job_cards).toBeUndefined();
    expect(ELECTRONICS_TEMPLATE_MANIFEST.capability_prerequisites.job_cards?.level).toBe(
      "REQUIRED",
    );
    expect(HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites.job_cards?.level).toBe("REQUIRED");

    expect(
      `${cell("customer_price_tiers", "WHL")}/${cell("customer_price_tiers", "ELC")}/${cell("customer_price_tiers", "HLT")}`,
    ).toBe("REQ/OPT/OPT");
    expect(WHOLESALE_TEMPLATE_MANIFEST.capability_prerequisites.customer_price_tiers?.level).toBe(
      "REQUIRED",
    );
    expect(ELECTRONICS_TEMPLATE_MANIFEST.capability_prerequisites.customer_price_tiers?.level).toBe(
      "OPTIONAL",
    );
    expect(HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites.customer_price_tiers?.level).toBe(
      "OPTIONAL",
    );

    // The healthcare shell's OWN capability (ED-07): N/A everywhere else,
    // REQ in HLT — the commercial-shell boundary (per-claim open items +
    // settlement by cheque/PDC; no clinical anything, ED-11).
    expect(
      `${cell("insurance_claim_billing", "WHL")}/${cell("insurance_claim_billing", "ELC")}/${cell("insurance_claim_billing", "HLT")}`,
    ).toBe("N/A/N/A/REQ");
    expect(WHOLESALE_TEMPLATE_MANIFEST.capability_prerequisites.insurance_claim_billing).toBeUndefined();
    expect(ELECTRONICS_TEMPLATE_MANIFEST.capability_prerequisites.insurance_claim_billing).toBeUndefined();
    expect(
      HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites.insurance_claim_billing?.level,
    ).toBe("REQUIRED");
  });

  it("the pre-existing templates: strict legs hold (no invented capabilities, no N/A declarations) and the planned-vs-shipped delta stays the frozen KNOWN_DELTA", () => {
    const observed: string[] = [];
    for (const [column, templateId] of Object.entries(COLUMN_TO_TEMPLATE)) {
      if (STRICT_COLUMNS.includes(column)) continue;
      const manifest = byId.get(templateId)!;
      const mismatches = reconcile(column, manifest);
      // The strict legs: anything NOT of the "matrix offers a cell the
      // manifest predates" shape fails outright (invented capability ids,
      // declarations against N/A cells, unrecognized cells).
      const hardFailures = mismatches.filter(
        (line) =>
          !/^([A-Z]{3}) x ([a-z_]+): matrix (REQ|OPT), manifest (omits|OPTIONAL|REQUIRED)$/.test(
            line,
          ),
      );
      expect(hardFailures, `${column}:\n${hardFailures.join("\n")}`).toEqual([]);
      observed.push(...mismatches);
    }
    // The frozen snapshot: growing the pre-existing delta fails CI;
    // shrinking it is a reviewed change (update KNOWN_DELTA with it).
    const grew = observed.filter((line) => !KNOWN_DELTA.includes(line));
    const shrank = KNOWN_DELTA.filter((line) => !observed.includes(line));
    expect(
      { grew, shrank },
      [
        "NEW pre-existing drift (review or fix):",
        ...grew.map((line) => `+ ${line}`),
        "Resolved drift (update KNOWN_DELTA to shrink it):",
        ...shrank.map((line) => `- ${line}`),
      ].join("\n"),
    ).toEqual({ grew: [], shrank: [] });
  });

  it("the one v2.0-only column left (RNT) stays unmapped until its shell ships; EDU/AGR mapped at the restoration (no premature reconciliation)", () => {
    // The rental/logistics template is NOT in SHIPPED_TEMPLATE_MANIFESTS —
    // its column exists in the matrix but maps to nothing yet. Education
    // (032) and agriculture (033) shipped on the surviving lineage and were
    // mapped by the restoration merge — their strict reconciliation is the
    // test above, and both shells being live is asserted here.
    expect(COLUMN_TO_TEMPLATE["RNT"]).toBeUndefined();
    expect(COLUMN_TO_TEMPLATE["EDU"]).toBe("industry.education");
    expect(COLUMN_TO_TEMPLATE["AGR"]).toBe("industry.agriculture");
    const shippedIds = new Set(SHIPPED_TEMPLATE_MANIFESTS.map((manifest) => manifest.id));
    expect(shippedIds.has("industry.rental_logistics")).toBe(false);
    expect(shippedIds.has("industry.education")).toBe(true);
    expect(shippedIds.has("industry.agriculture")).toBe(true);
  });
});
