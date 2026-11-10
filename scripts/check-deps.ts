/**
 * PHASE-024 T7 · `check:deps` — lockfile discipline lint (PHASE-024 §2 scope
 * item 6: "lockfile lint (no `*` ranges on prod deps)"; MVP_SECURITY_REVIEW
 * §1 "Lockfile discipline" is the standing precedent).
 *
 * Parses EVERY package.json in the workspace (root + apps/* + packages/* +
 * any nested package manifests, e.g. apps/mobile/native — workspace members
 * and non-members alike; node_modules and build outputs excluded) and
 * asserts:
 *
 *  - `dependencies` and `peerDependencies` carry NO floating ranges
 *    (`"*"` or `"x"` — npm semver "any" forms). Production code must be
 *    pinned by the lockfile through explicit ranges; a `*` dependency
 *    resolves to whatever the registry serves at install time.
 *  - `devDependencies` MAY float (never shipped) but each one is WARNED.
 *  - The pnpm `workspace:*`/`workspace:^`/`workspace:~` protocols are NOT
 *    violations: they are the sanctioned internal-package links (ADR-0002
 *    monorepo), resolved to the workspace version and pinned in
 *    pnpm-lock.yaml at install (MVP_SECURITY_REVIEW §1).
 *
 * Exit codes: 0 = clean (warnings allowed); 1 = violations found (listed
 * with file, section, name, range). `--report-only` prints the same report
 * but always exits 0 — the CI gate can adopt it progressively.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** npm semver "any" range forms this lint rejects on prod deps. */
const FLOATING_RANGES = new Set(["*", "x", "X"]);

/** Directories never scanned (deps, build output, tool caches). */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  ".next",
  "out",
  "out-desktop",
  "dist",
  "coverage",
  "storybook-static",
  ".desktop-stash",
]);

interface Violation {
  readonly file: string;
  readonly section: "dependencies" | "peerDependencies" | "devDependencies";
  readonly name: string;
  readonly range: string;
  readonly severity: "error" | "warning";
}

/** Recursively collect package.json files (sorted for stable output). */
function collectManifests(dir: string, root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      found.push(...collectManifests(full, root));
    } else if (entry === "package.json") {
      found.push(full.slice(root.length + 1));
    }
  }
  return found.sort();
}

function lintManifest(relativePath: string): Violation[] {
  const raw = JSON.parse(readFileSync(join(process.cwd(), relativePath), "utf8")) as Record<
    string,
    unknown
  >;
  const violations: Violation[] = [];
  const sections = [
    { key: "dependencies", severity: "error" as const },
    { key: "peerDependencies", severity: "error" as const },
    { key: "devDependencies", severity: "warning" as const },
  ];
  for (const section of sections) {
    const deps = raw[section.key];
    if (deps === undefined || deps === null || typeof deps !== "object") {
      continue;
    }
    for (const [name, value] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof value !== "string") {
        violations.push({
          file: relativePath,
          section: section.key as Violation["section"],
          name,
          range: JSON.stringify(value),
          severity: "error",
        });
        continue;
      }
      const range = value.trim();
      // workspace:* links are sanctioned internal pins (see header) — not
      // floating ranges; only the literal npm "any" forms are violations.
      if (FLOATING_RANGES.has(range)) {
        violations.push({
          file: relativePath,
          section: section.key as Violation["section"],
          name,
          range: value,
          severity: section.severity,
        });
      }
    }
  }
  return violations;
}

function main(): void {
  const reportOnly = process.argv.includes("--report-only");
  const manifests = collectManifests(process.cwd(), process.cwd());
  if (manifests.length === 0) {
    console.error("check-deps: no package.json files found (run from the repo root)");
    process.exitCode = 1;
    return;
  }

  const violations: Violation[] = [];
  for (const manifest of manifests) {
    try {
      violations.push(...lintManifest(manifest));
    } catch (error: unknown) {
      console.error(`check-deps: ${manifest}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
      return;
    }
  }

  const errors = violations.filter((violation) => violation.severity === "error");
  const warnings = violations.filter((violation) => violation.severity === "warning");

  for (const violation of errors) {
    console.error(
      `ERROR ${violation.file} → ${violation.section}.${violation.name} = "${violation.range}" (floating range on a production dependency — pin it)`,
    );
  }
  for (const violation of warnings) {
    console.warn(
      `WARN  ${violation.file} → ${violation.section}.${violation.name} = "${violation.range}" (dev-only floating range — allowed, pin when convenient)`,
    );
  }

  console.log(
    `check-deps: ${manifests.length} manifests scanned · ${errors.length} prod violations · ${warnings.length} dev warnings${reportOnly ? " (report-only)" : ""}`,
  );

  if (errors.length > 0 && !reportOnly) {
    process.exitCode = 1;
  }
}

main();
