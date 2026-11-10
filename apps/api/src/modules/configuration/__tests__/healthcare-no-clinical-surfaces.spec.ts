import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HEALTHCARE_TEMPLATE_MANIFEST, SHIPPED_TEMPLATE_MANIFESTS } from "@erp/contracts";

import { POLICY_REGISTRY } from "../domain/policy-registry";
import { SETTINGS_REGISTRY } from "../domain/settings-schema";
import { FEATURE_DEPS, isKnownFeatureKey } from "../domain/feature-catalog";
import { REPORT_CONTRACTS } from "../../reporting/registry/index";

/**
 * PHASE-031 T10 — the ZERO-CLINICAL-SURFACE gate (ED-07/ED-11's bold
 * boundary, machine-checked): the healthcare shell holds NO clinical data
 * anywhere — no diagnosis, prescription, appointment, patient-chart, lab,
 * or clinical-note field, terminology key, policy key, settings key,
 * feature key, or report surface exists in the shell's composition. A
 * clinical-named key anywhere in this spec's inventory fails CI — the
 * "just one diagnosis field" creep (the phase's defining product risk)
 * becomes a build failure, not a review note.
 *
 * The inventory covers every surface the shell composes:
 *   (a) the manifest itself — terminology, onboarding steps, nav labels,
 *       policy keys, capability feature keys, report pins;
 *   (b) the platform registries the shell registers into — POLICY_REGISTRY
 *       + SETTINGS_REGISTRY + FEATURE_CATALOG + the report contracts
 *       (including the PHASE-031 group_by_claim parameter surface);
 *   (c) the schema change — the migration 0045 SQL text (restored renumber) adds EXACTLY one
 *       column (claim_ref) and touches no other object;
 *   (d) the request surface — the invoice-claim-ref module's exported
 *       vocabulary (the capture machinery names money and claims only).
 *
 * The patient file is a partner FINANCIAL file only — identity, contacts,
 * credit terms, opening balances — the same partner form as any customer,
 * relabeled (no partner-schema change ships with this phase: 0045/0046
 * alter no partners column).
 */

/**
 * The clinical vocabulary the boundary forbids (stems, lowercase). The
 * automotive workshop's `svc.diagnosis` (vehicle fault diagnosis — a
 * REPAIR term, not a medical one) is deliberately NOT in this list: the
 * stems name MEDICAL surfaces (patient diagnoses, prescriptions,
 * appointments, charts, labs, vitals, dosages, rosters) — the words a
 * clinical record would need, not the words a repair bench shares.
 */
const CLINICAL_STEMS: readonly string[] = Object.freeze([
  "patient_diagnos",
  "diagnosis_code",
  "medical_diagnos",
  "prescript",
  "appoint",
  "patient_chart",
  "patientchart",
  "medical_record",
  "medicalrecord",
  "clinical_",
  "_clinical",
  "icd",
  "lab_result",
  "labresult",
  "lis_",
  "vital",
  "symptom",
  "dosage",
  "drug_interaction",
  "druginteraction",
  "e_prescri",
  "eprescri",
  "nphies",
  "roster",
  "triage",
  "admiss",
  "discharge_summary",
  "encounter_note",
]);

/** The HONEST boundary phrases — statements OF the boundary ("no clinical
 *  data", "zero-clinical-surface", "clinical-free") are the guard itself,
 * never violations. Exempted before the stem matching. */
const BOUNDARY_PHRASE = /(^|\W)(no|zero)\s+clinical|no-clinical|zero-clinical|clinical-free|(بيانات مالية فقط)/i;

/** Every string in a JSON-shaped value (keys included — a clinical KEY is
 *  as much a surface as a clinical label). */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      collectStrings(child, out);
    }
  }
  return out;
}

function clinicalHits(strings: readonly string[]): string[] {
  const hits: string[] = [];
  for (const text of strings) {
    if (BOUNDARY_PHRASE.test(text)) {
      continue; // the honest guard naming the boundary
    }
    const lower = text.toLowerCase();
    for (const stem of CLINICAL_STEMS) {
      if (lower.includes(stem)) {
        hits.push(`"${text}" matched stem "${stem}"`);
      }
    }
  }
  return hits;
}

/** Strip `--` comment lines (SQL) / `//` + ` *` comment lines (TS) — the
 *  executable surface is what the gate scans; comments carry the honest
 *  boundary prose. */
function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(--|\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("healthcare zero-clinical-surface (PHASE-031 T10; ED-07/ED-11 machine-checked)", () => {
  it("the manifest carries zero clinical strings — terminology, steps, nav, policies, capabilities, pins", () => {
    const hits = clinicalHits(collectStrings(HEALTHCARE_TEMPLATE_MANIFEST));
    expect(hits, hits.join("\n")).toEqual([]);
    // The honest framing IS present (the boundary stated, not just implied):
    // the patients step carries "no clinical data" in EN and its Arabic
    // counterpart; the patient terminology labels the FINANCIAL file.
    expect(HEALTHCARE_TEMPLATE_MANIFEST.onboarding_steps.find((step) => step.id === "patients")!
      .title.en).toContain("no clinical data");
    expect(HEALTHCARE_TEMPLATE_MANIFEST.terminology_overrides["partner.patient"]!.en).toContain(
      "financial file",
    );
  });

  it("the manifest's capability feature keys cite commercial modules only — every key resolves in the catalog", () => {
    // insurance_claim_billing's chain: sales + notes + partners — the
    // commercial layer exactly; nothing cites a clinical module (none
    // exists in the catalog at all).
    const featureKeys = new Set<string>();
    for (const capability of Object.values(HEALTHCARE_TEMPLATE_MANIFEST.capability_prerequisites)) {
      for (const key of capability.feature_keys) {
        featureKeys.add(key);
      }
    }
    for (const key of featureKeys) {
      expect(isKnownFeatureKey(key), key).toBe(true);
    }
    expect([...featureKeys].sort()).toEqual([
      "crm.service_contracts",
      "crm.service_orders",
      "distribution.customer_tiers",
      "installments.plans",
      "inventory.batch_tracking",
      "items.price_lists",
      "notes.pdc_calendar",
      "notes.received",
      "partners.statements",
      "pos.receipts",
      "pos.sales",
      "pos.terminals",
      "sales.invoices",
      "treasury.cashier_shifts",
    ]);
  });

  it("the platform registries carry zero clinical keys (POLICY_REGISTRY + SETTINGS_REGISTRY + FEATURE_DEPS)", () => {
    expect(clinicalHits(Object.keys(POLICY_REGISTRY))).toEqual([]);
    expect(clinicalHits(Object.keys(SETTINGS_REGISTRY))).toEqual([]);
    expect(clinicalHits(Object.keys(FEATURE_DEPS))).toEqual([]);
  });

  it("the report surface carries zero clinical keys — and the group_by_claim extension names claims, never cases", () => {
    const reportIds = REPORT_CONTRACTS.map((contract) => contract.id);
    expect(clinicalHits(reportIds)).toEqual([]);
    // The PHASE-031 report-parameter extension surface (the three contracts
    // that carry groupByClaim) — a claim is a financial reference.
    for (const id of ["notes.aging", "notes.maturity-calendar", "partner.statement"]) {
      const contract = REPORT_CONTRACTS.find((candidate) => candidate.id === id)!;
      expect(clinicalHits(collectStrings(contract.parameters))).toEqual([]);
      expect(clinicalHits(collectStrings(contract.dataSources))).toEqual([]);
    }
  });

  it("the schema change is EXACTLY one additive column — migration 0045 adds no clinical (or any other) object", () => {
    const sql = readFileSync(
      join(process.cwd(), "..", "..", "apps", "api", "migrations", "0045_healthcare_claim_ref.sql"),
      "utf8",
    );
    // The one ALTER + the one partial index — nothing else touches the schema.
    const alters = sql.match(/^ALTER TABLE .+$/gm) ?? [];
    expect(alters).toEqual(['ALTER TABLE "sales_invoices" ADD COLUMN "claim_ref" varchar(64);']);
    const creates = sql.match(/^CREATE (TABLE|TYPE|INDEX IF NOT EXISTS "ix_\w+")/gm) ?? [];
    expect(creates.filter((line) => line.startsWith("CREATE TABLE"))).toEqual([]);
    expect(creates.filter((line) => line.startsWith("CREATE TYPE"))).toEqual([]);
    // The seed migration 0046 is DATA-ONLY: zero DDL statements at all.
    const seed = readFileSync(
      join(process.cwd(), "..", "..", "apps", "api", "migrations", "0046_industry_healthcare.sql"),
      "utf8",
    );
    expect(seed.match(/^ALTER TABLE |^CREATE TABLE |^CREATE TYPE /gm) ?? []).toEqual([]);
    // No clinical column name anywhere in either migration's EXECUTABLE
    // text (comments carry the boundary prose — stripped).
    expect(clinicalHits([stripComments(sql), stripComments(seed)])).toEqual([]);
    // The partners table is UNTOUCHED (the patient file rides the standard
    // partner form — no partner column ships with this phase).
    expect(sql).not.toMatch(/ALTER TABLE "partners"/);
    expect(seed).not.toMatch(/ALTER TABLE "partners"/);
  });

  it("the request-surface vocabulary names money and claims only (invoice-claim-ref)", () => {
    const module = stripComments(
      readFileSync(
        join(process.cwd(), "src", "modules", "sales", "application", "invoice-claim-ref.ts"),
        "utf8",
      ),
    );
    // The capture module's identifiers + messages: no clinical stems.
    const identifiers = module.match(/[A-Za-z_][A-Za-z0-9_]*|"[^"]+"|'[^']+'/g) ?? [];
    expect(clinicalHits(identifiers)).toEqual([]);
    // The typed errors are exactly the three capture codes — no clinical
    // error class exists.
    expect(module).toContain('"CLAIM_REF_REQUIRED"');
    expect(module).toContain('"CLAIM_REF_ON_SELF_PAY"');
    expect(module).toContain('"CLAIM_REF_INVALID"');
    expect(module.match(/class \w+Error/g) ?? []).toHaveLength(3);
  });

  it("the whole shipped-template set stays clinical-free (the boundary is not healthcare-specific hygiene)", () => {
    for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
      const hits = clinicalHits(collectStrings(manifest));
      expect(hits, `${manifest.id}: ${hits.join(", ")}`).toEqual([]);
    }
  });
});
