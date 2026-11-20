import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { diffDrift, parseMatrixKeys, parseSeedKeys } from "./permissions-drift";

/**
 * PHASE-003 T2: the seed↔matrix drift checker must parse the real documents
 * (current docs → green) and fail closed on the negative fixtures (missing
 * key, unknown key) — the checker is only trustworthy if its failure mode is
 * proven (same principle as the RLS checker's negative proof).
 */

const MATRIX_PATH = join(
  process.cwd(),
  "..",
  "..",
  "docs",
  "security",
  "AUTHORIZATION_MATRIX.md",
);
const SEED_PATHS = [
  join(process.cwd(), "migrations", "0004_permissions_seed.sql"),
  join(process.cwd(), "migrations", "0024_pos_core.sql"), // PHASE-016 pos.* family
  join(process.cwd(), "migrations", "0025_automotive_distribution.sql"), // PHASE-017 automotive/distribution family
  join(process.cwd(), "migrations", "0026_manufacturing.sql"), // PHASE-018 manufacturing family
  join(process.cwd(), "migrations", "0027_crm_projects.sql"), // PHASE-019 crm/projects family
  join(process.cwd(), "migrations", "0029_sync_foundation.sql"), // PHASE-020 sync-plane re-assertions
  join(process.cwd(), "migrations", "0035_external_integrations.sql"), // PHASE-023 commerce channel gate
  join(process.cwd(), "migrations", "0049_custom_fields.sql"), // PHASE-036 extensibility core (245 → 248)
  join(process.cwd(), "migrations", "0050_zatca_phase1.sql"), // PHASE-037 ZATCA device registry (248 → 249)
  join(process.cwd(), "migrations", "0051_rfq_quotes.sql"), // PHASE-038 sourcing keys (249 → 256)
  join(process.cwd(), "migrations", "0056_dunning_collections.sql"), // PHASE-039 returns & collections keys (256 → 265)
  join(process.cwd(), "migrations", "0060_import_toolkit.sql"), // PHASE-040 data onboarding keys (265 → 267)
  join(process.cwd(), "migrations", "0064_communications_hub.sql"), // PHASE-041 communications keys (267 → 272)
  // PHASE-044 repair: the 042 manufacturing-execution seed pair was never
  // added here — the matrix §3.20 rows existed while the checker stayed
  // blind to the seed migrations, so the drift-free contract silently
  // missed its own negative (caught by the PHASE-044 gate re-run).
  join(process.cwd(), "migrations", "0065_routing_work_centers.sql"), // PHASE-042 routing/work-center keys
  join(process.cwd(), "migrations", "0066_standard_costing.sql"), // PHASE-042 standard-costing key
  join(process.cwd(), "migrations", "0071_wms_seeds.sql"), // PHASE-044 the eight WMS keys (279 → 287)
  // PHASE-043 repair (the 044 §3.20-repair precedent, caught by the
  // T-19 gate re-run): 0078's four planning keys joined the matrix §3.22
  // and the checker's list together — 287 → 291.
  join(process.cwd(), "migrations", "0078_mrp_seeds.sql"), // PHASE-043 the four planning keys
  // 59085a0 review-round repair (the 044/043 precedent, caught by the
  // round's shared-gates sweep — the unit gate failed while the CLI
  // checker passed 297 = 297): PHASE-045 (CR-15) seeded the six HR-core
  // keys in 0086 and joined them to the CLI list (matrix §3.23,
  // 291 → 297) — the spec's copy was never extended.
  join(process.cwd(), "migrations", "0086_hr_seeds.sql"), // PHASE-045 the six HR-core keys (291 → 297)
  // PHASE-046 (CR-16, W-1): 0092 seeds the three compliance keys and
  // joins both lists together (matrix §3.24, 297 → 300) — the 0086
  // lesson applied: the spec's copy extends in the SAME change.
  join(process.cwd(), "migrations", "0092_payroll_statutory_seeds.sql"), // PHASE-046 the three compliance keys (297 → 300)
  // PHASE-047 (CR-17, W-1): 0098 seeds the twelve talent keys and joins
  // both lists together (matrix §3.25, 300 → 312) — the 0086/0092 lesson
  // carried: the spec's copy extends in the SAME change.
  join(process.cwd(), "migrations", "0098_hr_talent_grants.sql"), // PHASE-047 the twelve talent keys (300 → 312)
  // PHASE-048 (CR-18, W-8, 2026-11-20): 0103 §1 seeds the fourteen
  // projects keys and joins both lists together (matrix §3.26,
  // 312 → 326) — the same lesson carried forward.
  join(process.cwd(), "migrations", "0103_projects_contracting_fieldservice.sql"), // PHASE-048 the fourteen projects keys (312 → 326)
] as const;

const matrixMarkdown = readFileSync(MATRIX_PATH, "utf8");
const seedSql = SEED_PATHS.map((path) => readFileSync(path, "utf8")).join("\n");

describe("permissions drift checker (PHASE-003 T2)", () => {
  it("parses §3 of the matrix: compact rows expand, non-catalog sections excluded", () => {
    const keys = parseMatrixKeys(matrixMarkdown);
    // Compact-row expansion (§3.2): `.create` continues the previous full key.
    expect(keys).toContain("sales.quotations.view");
    expect(keys).toContain("sales.quotations.convert");
    // Two-segment keys (§3.6/§3.8) survive the expansion rules.
    expect(keys).toContain("partners.view");
    expect(keys).toContain("files.upload");
    expect(keys).toContain("audit.view");
    // Money-in/money-out keys live under the treasury section (§3.4).
    expect(keys).toContain("sales.receipts.approve");
    expect(keys).toContain("purchasing.payments.create");
    // §6 portal keys are NOT part of the seeded catalog (PHASE-022).
    expect(keys).not.toContain("portal.account.view");
    // v2.0 modules parsed from their §3.11–3.15 sections.
    expect(keys).toContain("consolidation.eliminations.post");
    expect(keys).toContain("payroll.runs.approve");
  });

  it("seed parses to the same key shape as the matrix", () => {
    const seedKeys = parseSeedKeys(seedSql);
    expect(seedKeys.length).toBeGreaterThan(150);
    for (const key of seedKeys) {
      // 2–4 segments: the PHASE-013 reports catalog uses the 4-segment
      // `reports.<domain>.<subject>.read` shape (matrix §3.9).
      expect(key).toMatch(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){1,3}$/);
    }
  });

  it("current docs ↔ seed is drift-free (matrix §9.1 CI contract)", () => {
    // The seed side is the UNION of permission-seeding migrations (the
    // checker's main() does the same — 0004 base + 0024 pos.* + 0025
    // automotive/distribution + 0029 sync re-assertions + 0035 commerce).
    const seedSql = SEED_PATHS.map((path) => readFileSync(path, "utf8")).join("\n");
    const result = diffDrift(parseMatrixKeys(matrixMarkdown), parseSeedKeys(seedSql));
    expect(result.missingInSeed).toEqual([]);
    expect(result.unknownInSeed).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("negative fixture: a key present in the matrix but missing from the seed fails", () => {
    const seedKeys = parseSeedKeys(seedSql).filter((key) => key !== "audit.view");
    const result = diffDrift(parseMatrixKeys(matrixMarkdown), seedKeys);
    expect(result.ok).toBe(false);
    expect(result.missingInSeed).toContain("audit.view");
  });

  it("negative fixture: a seeded key absent from the matrix fails", () => {
    const seedKeys = [...parseSeedKeys(seedSql), "identity.users.hack"];
    const result = diffDrift(parseMatrixKeys(matrixMarkdown), seedKeys);
    expect(result.ok).toBe(false);
    expect(result.unknownInSeed).toContain("identity.users.hack");
  });
});
