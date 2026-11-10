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
