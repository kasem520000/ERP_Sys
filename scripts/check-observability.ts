/**
 * PHASE-025 T10 — the observability completeness audit (repo-auditing,
 * reads files only — no PG boot). Fail-closed checks over the
 * documentation + code surfaces of docs/operations/MONITORING.md:
 *
 *  1. Alert catalog (§3): every alert row links a runbook — each markdown
 *     link target exists AND every §ref in the runbook cell resolves to a
 *     section of the referenced file (numeric `## N.` headings; slug refs
 *     match by heading title words — "§api" → "## 2. API",
 *     "§tenant-isolation" → "## 6. Tenants, entitlements & isolation").
 *  2. Dashboards (§1): the inventory is non-empty and every "Introduced"
 *     phase is ≤ 025 (no future-phase dashboard claims).
 *  3. Metric naming: every `erp_` string literal in apps/api/src with the
 *     metric shape (≥ 4 underscore segments) matches the
 *     `erp_<module>_<name>_<unit>` convention — the SAME machine rule the
 *     unit spec asserts (imported from the api metrics module).
 *  4. Retention (§6): the 30-days-hot / 1-year-cold policy is documented
 *     and stated as a sink configuration (the honest documentation-only
 *     state — the sink itself is the metrics-pipeline item; env knobs are
 *     reported, not required).
 *  5. Redaction: the logger's fail-closed redaction (the REDACT_PATHS
 *     list + the pino redact censor) is present in code.
 *
 * Usage: tsx scripts/check-observability.ts   (wired as
 * `pnpm check:observability`); exit 0 green with the summary line, 1 with
 * precise failures.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { isConformantMetricName } from "../apps/api/src/infra/observability/metrics";

/** The scripts run from the repo root (`pnpm check:observability`); the
 * ../../ candidate covers runs from inside apps/api (the permissions-drift
 * resolveMonorepoPath pattern). */
function resolveMonorepoPath(relative: string): string {
  for (const candidate of [join(process.cwd(), relative), join(process.cwd(), "..", "..", relative)]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`check-observability: cannot resolve ${relative} from ${process.cwd()}`);
}

const MONITORING_PATH = resolveMonorepoPath("docs/operations/MONITORING.md");
const REPO_ROOT = join(MONITORING_PATH, "..", "..", "..");
const API_SRC_ROOT = resolveMonorepoPath("apps/api/src");

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
  console.error(`FAIL  ${message}`);
}

/** Extract a `## N. Title` section of a markdown doc (by heading number). */
function sectionBody(markdown: string, sectionNumber: number): string | null {
  const lines = markdown.split("\n");
  const headingRe = new RegExp(`^##\\s+${sectionNumber}\\.\\s`);
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start === -1) {
    return null;
  }
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/** All `## N. Title` headings of a markdown doc. */
function headings(markdown: string): { number: number; title: string }[] {
  const rows: { number: number; title: string }[] = [];
  for (const match of markdown.matchAll(/^##\s+(\d+)\.\s+(.+)$/gm)) {
    rows.push({ number: Number(match[1]), title: match[2] ?? "" });
  }
  return rows;
}

/**
 * Does a `§ref` resolve against a doc's headings? Numeric refs match the
 * heading number; slug refs match a heading whose title contains every
 * significant slug word (≥ 3 chars — drops the "e" in "e-invoicing").
 */
function refResolves(ref: string, targetHeadings: { number: number; title: string }[]): boolean {
  const numeric = /^§(\d+)$/.exec(ref);
  if (numeric !== null) {
    return targetHeadings.some((heading) => heading.number === Number(numeric[1]));
  }
  const slug = ref.replace(/^§/, "");
  const words = slug
    .split("-")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length >= 3);
  if (words.length === 0) {
    return false;
  }
  return targetHeadings.some((heading) => {
    const title = heading.title.toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

// -- 1 + 2: the MONITORING.md tables ------------------------------------------------

const monitoring = readFileSync(MONITORING_PATH, "utf8");
const monitoringHeadings = headings(monitoring);

interface AlertRow {
  name: string;
  runbookCell: string;
}

function parseAlertCatalog(markdown: string): AlertRow[] {
  const body = sectionBody(markdown, 3);
  if (body === null) {
    return [];
  }
  const rows: AlertRow[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("| `")) {
      continue;
    }
    const cells = line.split("|").map((cell) => cell.trim());
    // cells: ["", "`Alert`", condition, severity, runbook, paging, ""]
    const name = (cells[1] ?? "").replace(/`/g, "");
    if (name === "" || name === "Alert") {
      continue;
    }
    rows.push({ name, runbookCell: cells[4] ?? "" });
  }
  return rows;
}

function parseDashboardRows(markdown: string): { dashboard: string; introduced: string }[] {
  const body = sectionBody(markdown, 1);
  if (body === null) {
    return [];
  }
  const rows: { dashboard: string; introduced: string }[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("| ") || line.startsWith("| Dashboard") || line.startsWith("|---")) {
      continue;
    }
    const cells = line.split("|").map((cell) => cell.trim());
    const dashboard = cells[1] ?? "";
    if (dashboard === "") {
      continue;
    }
    rows.push({ dashboard, introduced: cells[2] ?? "" });
  }
  return rows;
}

const alertRows = parseAlertCatalog(monitoring);
let alertsLinked = 0;
if (alertRows.length === 0) {
  fail("alert catalog (MONITORING §3): no rows parsed — the table is empty or moved");
}
for (const row of alertRows) {
  const links = [...row.runbookCell.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  if (links.length === 0) {
    fail(`alert ${row.name}: the runbook cell has no link (every alert links a runbook — §2 rule)`);
    continue;
  }
  // Resolve each link target + each §ref (a ref binds to the most recently
  // mentioned file in the cell, or MONITORING.md itself when none precedes).
  let currentFile: { path: string; headings: { number: number; title: string }[] } | null = null;
  const segments = [...row.runbookCell.matchAll(/(\[[^\]]+\]\([^)]+\))|(§[^\s,)]+)/g)];
  let ok = true;
  for (const segment of segments) {
    const text = segment[0];
    if (text.startsWith("[")) {
      const target = /\]\(([^)]+)\)/.exec(text)?.[1] ?? "";
      const path = join(REPO_ROOT, "docs", "operations", target);
      if (!existsSync(path)) {
        fail(`alert ${row.name}: runbook link target does not exist: ${target}`);
        ok = false;
        currentFile = null;
        continue;
      }
      currentFile = { path, headings: headings(readFileSync(path, "utf8")) };
    } else {
      const ref = text;
      const target = currentFile ?? { path: MONITORING_PATH, headings: monitoringHeadings };
      if (!refResolves(ref, target.headings)) {
        const relative = target.path.startsWith(REPO_ROOT)
          ? target.path.slice(REPO_ROOT.length + 1)
          : target.path;
        fail(`alert ${row.name}: runbook ref ${ref} does not resolve to a section of ${relative}`);
        ok = false;
      }
    }
  }
  if (ok) {
    alertsLinked += 1;
  }
}
console.log(`alert catalog: ${alertsLinked}/${alertRows.length} rows fully linked + section-verified`);

const dashboardRows = parseDashboardRows(monitoring);
if (dashboardRows.length === 0) {
  fail("dashboards inventory (MONITORING §1): empty — every dashboard must be enumerated");
}
for (const row of dashboardRows) {
  const phaseTokens = [
    ...row.introduced.matchAll(/PHASE-(\d+)/g),
    ...row.introduced.matchAll(/\/\s*(\d{3})/g),
  ].map((match) => Number(match[1]));
  if (phaseTokens.length === 0) {
    fail(`dashboard "${row.dashboard}": no PHASE-N in "Introduced" (${row.introduced})`);
    continue;
  }
  for (const phase of phaseTokens) {
    if (phase > 25) {
      fail(`dashboard "${row.dashboard}": Introduced phase ${phase} > 025 (no future-phase claims)`);
    }
  }
}
console.log(`dashboards inventory: ${dashboardRows.length} rows, all Introduced phases ≤ 025`);

// -- 3: metric naming over the api source --------------------------------------------

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listTsFiles(path));
    } else if (entry.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

const metricLiteral = /["'`](erp_[a-z0-9_]+)["'`]/g;
let metricsConformant = 0;
const metricsSeen = new Set<string>();
for (const file of listTsFiles(API_SRC_ROOT)) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index]!.matchAll(metricLiteral)) {
      const token = match[1]!;
      // Metric shape = ≥ 4 underscore segments (erp, module, name, unit).
      // Two-segment tokens are database roles (erp_app, erp_migrate) — not
      // metric names; three-segment tokens violate erp_<module>_<name>_<unit>.
      if (token.split("_").length < 4) {
        continue;
      }
      if (!isConformantMetricName(token)) {
        const relative = file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length + 1) : file;
        fail(`metric naming: ${token} violates erp_<module>_<name>_<unit> — ${relative}:${index + 1}`);
        continue;
      }
      metricsSeen.add(token);
      metricsConformant += 1;
    }
  }
}
console.log(
  `metric naming: ${metricsConformant} literal occurrences (${metricsSeen.size} distinct names) conformant`,
);

// -- 4: retention (§6) ----------------------------------------------------------------

const retentionBody = sectionBody(monitoring, 6);
if (retentionBody === null) {
  fail("retention (MONITORING §6): the section is missing");
} else {
  for (const expected of ["30 days hot", "1 year cold", "sink configuration"]) {
    if (!retentionBody.includes(expected)) {
      fail(`retention (MONITORING §6): expected policy statement "${expected}" not found`);
    }
  }
}
// Honest configuration state: retention KNOBS in the env contract are
// reported, not required — the sink configuration is the metrics-pipeline
// item (MONITORING §6 says so verbatim).
const envExample = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
const envSchema = readFileSync(join(API_SRC_ROOT, "config", "env.ts"), "utf8");
const retentionKnobs = [
  ...envExample.matchAll(/^[^#]*?(RETENTION[A-Z_]*)/gm),
  ...envSchema.matchAll(/(RETENTION[A-Z_]*)/g),
].map((match) => match[1]!);
console.log(
  `retention: documented (30 d hot / 1 y cold, sink configuration); env knobs present: ${retentionKnobs.length === 0 ? "none — documentation-only, the pipeline item" : retentionKnobs.join(", ")}`,
);

// -- 5: redaction fail-closed ----------------------------------------------------------

const loggerSource = readFileSync(
  join(API_SRC_ROOT, "infra", "observability", "logger.ts"),
  "utf8",
);
const redactionChecks: [string, string][] = [
  ["REDACT_PATHS list", /const REDACT_PATHS\s*=\s*\[/],
  ["pino redact wiring", /redact:\s*\{\s*paths:\s*REDACT_PATHS/],
  ["redaction censor", /censor:\s*"\[REDACTED\]"/],
  ["fail-closed posture (doc note)", /fail-closed/i],
];
let redactionOk = true;
for (const [label, pattern] of redactionChecks) {
  if (!pattern.test(loggerSource)) {
    fail(`redaction: ${label} missing from apps/api/src/infra/observability/logger.ts`);
    redactionOk = false;
  }
}
if (redactionOk) {
  console.log("redaction: fail-closed serializer present (REDACT_PATHS + pino redact censor)");
}

// -- verdict ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nobservability audit FAILED — ${failures.length} violation(s)`);
  process.exit(1);
}
console.log(
  `observability audit: ${alertsLinked} alerts linked / ${dashboardRows.length} dashboards / ${metricsConformant} metrics conformant / retention documented / redaction fail-closed`,
);
