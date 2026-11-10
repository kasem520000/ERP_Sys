import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PHASE-003 docs-drift checker (PHASE-003 T2; AUTHORIZATION_MATRIX §9.1;
 * REGRESSION_STRATEGY §docs-drift): the `permissions` seed (migration
 * `0004_permissions_seed.sql`) must match the normative catalog in
 * `docs/security/AUTHORIZATION_MATRIX.md` §3 exactly — keys are contracts
 * (ERROR_MODEL §4; matrix §1: tenants compose roles from the catalog and
 * cannot invent keys).
 *
 * Parse rules for the matrix (§3 "Permission catalog by module"):
 * - Only `### 3.x` subsections count; §2 role table, §5 branch rules, §6
 *   portal set and §7 support rows are out of the seeded catalog (portal
 *   keys arrive with PHASE-022; role mapping is template grants, not keys).
 * - A row's first cell holds one or more backticked tokens: full keys
 *   (`sales.invoices.view`) and suffix continuations (`.create`) that expand
 *   against the preceding full key (`sales.invoices.create`).
 *
 * The check is bidirectional (missing in seed / unknown in seed) and
 * fail-closed; the local gate + CI run it on every push.
 */

export interface DriftResult {
  ok: boolean;
  matrixKeys: readonly string[];
  seedKeys: readonly string[];
  missingInSeed: readonly string[];
  unknownInSeed: readonly string[];
}

/** Extract the §3 permission keys from AUTHORIZATION_MATRIX.md. */
export function parseMatrixKeys(matrixMarkdown: string): string[] {
  const keys: string[] = [];
  let inSection3 = false;
  let lastFullKey: string | undefined;

  for (const rawLine of matrixMarkdown.split("\n")) {
    const line = rawLine.trim();
    if (/^##\s/.test(line)) {
      inSection3 = false;
      continue;
    }
    if (/^###\s+3\.\d+/.test(line)) {
      inSection3 = true;
      lastFullKey = undefined;
      continue;
    }
    if (!inSection3 || !line.startsWith("|")) {
      continue;
    }
    const firstCell = line.split("|")[1] ?? "";
    for (const token of [...firstCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)) {
      if (token.startsWith(".")) {
        if (lastFullKey === undefined) {
          throw new Error(`matrix row continues a key without a preceding full key: ${line}`);
        }
        const prefix = lastFullKey.slice(0, lastFullKey.lastIndexOf("."));
        keys.push(`${prefix}${token}`);
      } else if (token.includes(".")) {
        keys.push(token);
        lastFullKey = token;
      }
    }
  }
  return [...new Set(keys)].sort();
}

/** Extract the seeded keys from the permissions seed migration SQL. */
export function parseSeedKeys(seedSql: string): string[] {
  const keys = [...seedSql.matchAll(/^\('([a-z][a-z0-9_.-]+)',/gm)].map((m) => m[1]!);
  return [...new Set(keys)].sort();
}

/** Bidirectional diff (fail-closed on any drift). */
export function diffDrift(matrixKeys: readonly string[], seedKeys: readonly string[]): DriftResult {
  const matrix = new Set(matrixKeys);
  const seed = new Set(seedKeys);
  const missingInSeed = [...matrix].filter((key) => !seed.has(key)).sort();
  const unknownInSeed = [...seed].filter((key) => !matrix.has(key)).sort();
  return {
    ok: missingInSeed.length === 0 && unknownInSeed.length === 0,
    matrixKeys,
    seedKeys,
    missingInSeed,
    unknownInSeed,
  };
}

function resolveMonorepoPath(relative: string): string {
  const candidates = [join(process.cwd(), relative), join(process.cwd(), "..", "..", relative)];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`check-permissions-drift: cannot resolve ${relative} from ${process.cwd()}`);
}

export function runDriftCheck(matrixMarkdown: string, seedSql: string): DriftResult {
  return diffDrift(parseMatrixKeys(matrixMarkdown), parseSeedKeys(seedSql));
}

/**
 * CLI entry (scripts/check-permissions-drift.ts): exit code 1 on any
 * drift. The seed side is the UNION of every permission-seeding migration
 * (0004 base set + later phase migrations that seed `permissions` rows —
 * PHASE-016 0024 added the pos.* family; PHASE-018 0026 added the
 * manufacturing.* family; PHASE-019 0027 re-asserts the crm base set and
 * adds crm.contracts.bill + accounting.projects.manage): a key seeded
 * anywhere counts.
 */
const PERMISSION_SEED_MIGRATIONS: readonly string[] = [
  "apps/api/migrations/0004_permissions_seed.sql",
  "apps/api/migrations/0024_pos_core.sql",
  "apps/api/migrations/0025_automotive_distribution.sql",
  "apps/api/migrations/0026_manufacturing.sql",
  "apps/api/migrations/0027_crm_projects.sql",
  // PHASE-020: 0029 re-asserts the four sync-plane keys (sync.devices.*,
  // sync.settings.manage, identity.devices.manage — seeded at 0004 base,
  // going live with the device registry).
  "apps/api/migrations/0029_sync_foundation.sql",
  // PHASE-023 T8: 0035 seeds sales.commerce.manage (the commerce-channel
  // import gate — operator-plane, granted to platform ops roles only).
  "apps/api/migrations/0035_external_integrations.sql",
];

export async function main(): Promise<void> {
  const matrixPath = resolveMonorepoPath("docs/security/AUTHORIZATION_MATRIX.md");
  const seedSql = PERMISSION_SEED_MIGRATIONS.map((relative) =>
    readFileSync(resolveMonorepoPath(relative), "utf8"),
  ).join("\n");
  const result = runDriftCheck(readFileSync(matrixPath, "utf8"), seedSql);
  for (const key of result.missingInSeed) {
    console.error(`[permissions-drift] IN MATRIX BUT NOT SEEDED: ${key}`);
  }
  for (const key of result.unknownInSeed) {
    console.error(`[permissions-drift] SEEDED BUT NOT IN MATRIX: ${key}`);
  }
  console.log(
    `[permissions-drift] ${result.ok ? "OK" : "FAILED"} — matrix ${result.matrixKeys.length} keys, seed ${result.seedKeys.length} keys`,
  );
  if (!result.ok) {
    process.exitCode = 1;
  }
}
