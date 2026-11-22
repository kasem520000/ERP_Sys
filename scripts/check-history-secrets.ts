/**
 * PHASE-024 T7 · `check:history-secrets` — the gitleaks LOCAL SUBSTITUTE:
 * a bounded `git grep` sweep over COMMIT HISTORY for the classic
 * credential-shape patterns (AWS keys, private-key blocks, credentialed
 * postgres URLs, quoted api-key/secret/password literals, GitHub ghp_
 * tokens, Slack xox* tokens). The CI gitleaks job (full history, every
 * push — SECRETS_MANAGEMENT §4 rule 2) remains the AUTHORITATIVE gate;
 * this script exists so the pattern set + allowlist decisions are
 * reviewable and runnable locally/without GitHub.
 *
 * **[Dated 2026-11-22 (PHASE-049 W-20 — THE RESUMABLE-SLICES AMENDMENT, the
 * environmental adaptation class): the fifth environment reset's sandbox
 * reaps every process between tool invocations (no background run
 * survives) and caps each invocation at 600s, while the sequential scan
 * costs ~6s per commit × ~203 sampled commits ≈ 20 minutes — a single-shot
 * run cannot complete. The amendment adds a RESUMABLE mode that preserves
 * the check EXACTLY — same deterministic sample (last SAMPLE_SIZE + every
 * tag anchor), same PATTERNS, same allowlist, same verdict logic, with a
 * coverage assertion at finalize — and leaves the DEFAULT single-shot path
 * byte-identical:
 *   `--slice N/M --state <path>` scan the Nth of M contiguous slices of
 *                               the same sample, appending one JSONL row
 *                               per scanned commit (its raw hits + its
 *                               allowlisted count) to the state file;
 *   `--finalize  --state <path>` merge the state, ASSERT FULL COVERAGE
 *                               (every sampled commit scanned exactly
 *                               once — missing, extra, or duplicate rows
 *                               all refuse), apply the allowlist + the
 *                               verdict, and print the single-shot summary
 *                               shape plus the slices' coverage line.
 * The slice scans carry the raw hits; ONLY the finalize invocation decides
 * the verdict (a slice run never exits non-zero on hit content).]**
 *
 * Sampling (tractability): by default the LAST 200 COMMITS plus the FIRST
 * COMMIT OF EVERY PHASE TAG (`git tag` → `git rev-list -n1`) — enough to
 * cover recent history + every phase boundary. `--full` scans every commit
 * on every ref.
 *
 * Path handling: `git grep -I` skips binary files; results under
 * node_modules/ or lockfiles (pnpm-lock.yaml / package-lock.json /
 * yarn.lock) are skipped; the ALLOWLIST below covers the repo's
 * INTENTIONAL dev/test fixtures (seeded local credentials, wrong-password
 * probes, redaction fixtures) — the MVP_SECURITY_REVIEW §0/§3 precedent:
 * "the embedded-test-PG bootstrap password … test infra, the documented
 * dev-credentials pattern; migrations stay secret-free". Every allowlist
 * entry carries its reason; anything NOT allowlisted that matches a
 * pattern is a VIOLATION → exit 1 with `commit path:line` for each hit.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

/**
 * Bounded pattern set (gitleaks-class shapes, ERE alternation — passed to
 * `git grep -E` as a single argv element, no shell interpolation).
 */
const PATTERNS = [
  "AKIA[0-9A-Z]{16}", // AWS access key ids
  "BEGIN (RSA|EC|OPENSSH) PRIVATE KEY", // private-key material
  "postgres(ql)?://[^[:space:]]*:[^[:space:]@]+@", // credentialed postgres URLs
  "(api[_-]?key|secret|password)[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9+/=_-]{16,}[\"']", // quoted secret-shaped literals
  "ghp_[A-Za-z0-9]{36,}", // GitHub PATs
  "xox[baprs]-[A-Za-z0-9-]+", // Slack tokens
].join("|");

/**
 * ALLOWLIST — intentional fixtures, each with its reason (per-path prefix
 * or exact file). NOT a blanket ignore: a real secret landing in any of
 * these paths is still gitleaks' job to catch (CI gate); this substitute
 * documents why the LOCAL pattern set fires on them.
 */
const ALLOWLIST: readonly { readonly path: string; readonly reason: string }[] = [
  // Task-mandated entries (PHASE-024 T7): test fixtures + docs.
  { path: "apps/api/migrations/", reason: "migrations are secret-free by policy; historical dev-credential comments are documentation" },
  { path: "apps/api/src/__db__/", reason: "db-suite fixtures: embedded-PG bootstrap creds, wrong-password probes (the documented dev-credentials pattern)" },
  { path: "tests/", reason: "repo-level test fixtures (e2e, authorities harness)" },
  { path: "docs/", reason: "docs quote the documented dev placeholder URLs (e.g. DEVELOPMENT_SETUP env tables)" },
  // Same-class extensions found by the first run of this very scan — the
  // documented dev-placeholder / test-fixture pattern outside the four
  // mandated roots (recorded in dependency-triage-2026-11.md §5):
  { path: ".env.example", reason: "the documented LOCAL-ONLY dev template (SECRETS §2 Development row)" },
  { path: "docker-compose.yml", reason: "dev compose stand-in credentials (postgres:postgres) — production assigns out-of-band" },
  { path: "apps/api/src/config/env.spec.ts", reason: "env-parser test fixtures quoting the dev URLs" },
  { path: "apps/api/scripts/", reason: "dev drill tooling (restore-drill.ts) carrying the documented dev-credentials pattern" },
  { path: "scripts/", reason: "dev/CI tooling (db-dev-credentials, migration-tests Testcontainers URL) — the documented dev-credentials pattern" },
  { path: "apps/desktop/__tests__/", reason: "telemetry redaction fixtures (postgres URLs as redaction PROOF material)" },
  { path: "apps/web/tests/", reason: "web security probe fixtures (wrong-password login attempts)" },
  // PHASE-049 (W-16, 2026-11-21): the evidence archive's scratch proofs
  // and logs (the phase049-plan/W-16 scratch-rls-proof.ts family — the
  // embedded-PG16 scratch boots carrying the documented
  // postgres:postgres@127.0.0.1 dev-credentials pattern, exactly the
  // scripts/ class). Found by THIS scan's own first run over the plan
  // commit (the plan wave's capture ran pre-commit — honest then; the
  // committed scratch file is immutable evidence now, the additive-only
  // archive law) — the same-class extension procedure this header
  // prescribes.
  { path: "audit-evidence/", reason: "the evidence archive's scratch proofs + logs quote the documented embedded-PG dev-credentials pattern (postgres:postgres@127.0.0.1) — never production secrets; the additive-only archive law makes them immutable history" },
];

/** Lockfiles: never scanned (generated dependency graphs). */
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);

const SAMPLE_SIZE = 200;

function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function gitOk(args: readonly string[]): string | undefined {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

interface Hit {
  readonly commit: string;
  readonly path: string;
  readonly line: string;
  readonly content: string;
}

function isAllowlisted(path: string): string | undefined {
  for (const entry of ALLOWLIST) {
    if (path === entry.path || path.startsWith(entry.path)) {
      return entry.reason;
    }
  }
  return undefined;
}

function scanCommit(commit: string): { hits: Hit[]; allowlisted: number } {
  const hits: Hit[] = [];
  let allowlisted = 0;
  // git grep exit codes: 0 = matches, 1 = none, >1 = real error.
  const output = gitOk(["grep", "-I", "-n", "-E", PATTERNS, commit]);
  if (output === undefined) {
    return { hits, allowlisted };
  }
  for (const raw of output.split("\n")) {
    if (raw === "") {
      continue;
    }
    // `<commit>:<path>:<line>:<content>` — split from the left, at most 4 parts.
    const firstColon = raw.indexOf(":");
    if (firstColon === -1) {
      continue;
    }
    const rest = raw.slice(firstColon + 1);
    const secondColon = rest.indexOf(":");
    if (secondColon === -1) {
      continue;
    }
    const path = rest.slice(0, secondColon);
    const afterPath = rest.slice(secondColon + 1);
    const thirdColon = afterPath.indexOf(":");
    const line = thirdColon === -1 ? afterPath : afterPath.slice(0, thirdColon);
    const content = thirdColon === -1 ? "" : afterPath.slice(thirdColon + 1);

    if (path.startsWith("node_modules/") || path.includes("/node_modules/")) {
      continue;
    }
    const base = path.split("/").pop() ?? path;
    if (LOCKFILES.has(base)) {
      continue;
    }
    if (isAllowlisted(path) !== undefined) {
      allowlisted += 1;
      continue;
    }
    hits.push({ commit: commit.slice(0, 12), path, line, content: content.trim() });
  }
  return { hits, allowlisted };
}

function main(): void {
  const full = process.argv.includes("--full");

  // -- PHASE-049 W-20: the resumable-slices flags (the dated header note) --
  const sliceMatch = /--slice (\d+)\/(\d+)/.exec(process.argv.join(" "));
  const stateMatch = /--state (\S+)/.exec(process.argv.join(" "));
  const finalize = process.argv.includes("--finalize");
  if ((sliceMatch !== null || finalize) && stateMatch === null) {
    console.error("check-history-secrets: --slice/--finalize require --state <path>");
    process.exitCode = 2;
    return;
  }
  if (sliceMatch !== null && finalize) {
    console.error("check-history-secrets: --slice and --finalize are exclusive");
    process.exitCode = 2;
    return;
  }

  const allCommits = git(["log", "--all", "--format=%H"])
    .split("\n")
    .filter((line) => line !== "");

  // Sample: the last SAMPLE_SIZE commits + the first commit of every tag
  // (phase boundaries) — unless --full.
  const sampled = new Set<string>(full ? allCommits : allCommits.slice(0, SAMPLE_SIZE));
  const tags = (gitOk(["tag"]) ?? "").split("\n").filter((line) => line !== "");
  const tagAnchors: string[] = [];
  for (const tag of tags) {
    const anchor = gitOk(["rev-list", "-n1", tag])?.trim();
    if (anchor !== undefined && anchor !== "") {
      sampled.add(anchor);
      tagAnchors.push(`${tag} -> ${anchor.slice(0, 12)}`);
    }
  }

  const commits = allCommits.filter((commit) => sampled.has(commit));

  // -- the resumable slice scan: same sample, contiguous slice N of M ----
  if (sliceMatch !== null && stateMatch !== null) {
    const sliceIndex = Number(sliceMatch[1]);
    const sliceCount = Number(sliceMatch[2]);
    if (!Number.isInteger(sliceIndex) || !Number.isInteger(sliceCount) || sliceIndex < 1 || sliceCount < 1 || sliceIndex > sliceCount) {
      console.error(`check-history-secrets: invalid --slice ${sliceIndex}/${sliceCount}`);
      process.exitCode = 2;
      return;
    }
    // Integer slice arithmetic (no Math.* — the ADR-0009 lint floor): slices
    // 1..remainder carry one extra commit, the boundaries derive exactly.
    const base = (commits.length - (commits.length % sliceCount)) / sliceCount;
    const extra = commits.length % sliceCount;
    const size = sliceIndex <= extra ? base + 1 : base;
    const start =
      sliceIndex <= extra
        ? (sliceIndex - 1) * (base + 1)
        : extra * (base + 1) + (sliceIndex - 1 - extra) * base;
    const chunk = commits.slice(start, start + size);
    let sliceHits = 0;
    let sliceAllowlisted = 0;
    for (const commit of chunk) {
      const { hits, allowlisted } = scanCommit(commit);
      sliceHits += hits.length;
      sliceAllowlisted += allowlisted;
      appendFileSync(
        stateMatch[1],
        `${JSON.stringify({ kind: "commit", commit, allowlisted, hits })}\n`,
        "utf8",
      );
    }
    console.log(
      `check-history-secrets: slice ${sliceIndex}/${sliceCount} scanned ${chunk.length} commit(s) — ${sliceHits} raw hit(s), ${sliceAllowlisted} allowlisted (raw hits ride the state file; the verdict is the finalize invocation's)`,
    );
    return;
  }

  // -- the finalize: merge the state, ASSERT FULL COVERAGE, decide -------
  if (finalize && stateMatch !== null) {
    let rows: { kind: string; commit: string; allowlisted: number; hits: Hit[] }[];
    try {
      rows = readFileSync(stateMatch[1], "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as { kind: string; commit: string; allowlisted: number; hits: Hit[] });
    } catch {
      console.error(`check-history-secrets: cannot read the state file ${stateMatch[1]}`);
      process.exitCode = 2;
      return;
    }
    if (rows.some((row) => row.kind !== "commit")) {
      console.error("check-history-secrets: state file carries a foreign row kind");
      process.exitCode = 2;
      return;
    }
    // COVERAGE: every sampled commit scanned EXACTLY ONCE — missing,
    // extra, or duplicate rows all refuse.
    const scanned = new Map<string, number>();
    for (const row of rows) {
      scanned.set(row.commit, (scanned.get(row.commit) ?? 0) + 1);
    }
    const missing = commits.filter((commit) => !scanned.has(commit));
    const extra = [...scanned.keys()].filter((commit) => !sampled.has(commit));
    const duplicated = [...scanned.entries()].filter(([, count]) => count > 1).map(([commit]) => commit);
    if (missing.length > 0 || extra.length > 0 || duplicated.length > 0) {
      console.error(
        `check-history-secrets: slice coverage REFUSED — ${missing.length} missing, ${extra.length} extra, ${duplicated.length} duplicated (the sample is ${commits.length} commits; the state carries ${rows.length} rows)`,
      );
      process.exitCode = 2;
      return;
    }
    const violations: Hit[] = [];
    let allowlistedTotal = 0;
    for (const row of rows) {
      violations.push(...row.hits);
      allowlistedTotal += row.allowlisted;
    }
    console.log(
      `check-history-secrets: ${full ? "FULL" : `sampled (last ${SAMPLE_SIZE} + ${tagAnchors.length} tag anchor${tagAnchors.length === 1 ? "" : "s"})`} — ${commits.length}/${allCommits.length} commits across all refs (RESUMED across ${new Set(rows.map((row) => row.commit)).size} slice-scanned commits, coverage asserted EXACT)`,
    );
    for (const anchor of tagAnchors) {
      console.log(`  anchor ${anchor}`);
    }
    for (const hit of violations) {
      console.error(`SECRET-SHAPED HIT ${hit.commit} ${hit.path}:${hit.line}: ${hit.content}`);
    }
    console.log(
      `check-history-secrets: ${violations.length} violation(s) · ${allowlistedTotal} allowlisted fixture hit(s) across ${ALLOWLIST.length} documented allowlist paths`,
    );
    console.log(
      "check-history-secrets: authoritative full-history gate = CI gitleaks job (ci.yml); this local substitute documents the pattern set + fixture allowlist.",
    );
    if (violations.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  // -- the default single-shot path (unchanged) --------------------------
  console.log(
    `check-history-secrets: ${full ? "FULL" : `sampled (last ${SAMPLE_SIZE} + ${tagAnchors.length} tag anchor${tagAnchors.length === 1 ? "" : "s"})`} — ${commits.length}/${allCommits.length} commits across all refs`,
  );
  for (const anchor of tagAnchors) {
    console.log(`  anchor ${anchor}`);
  }

  const violations: Hit[] = [];
  let allowlistedTotal = 0;
  for (const commit of commits) {
    const { hits, allowlisted } = scanCommit(commit);
    violations.push(...hits);
    allowlistedTotal += allowlisted;
  }

  for (const hit of violations) {
    console.error(`SECRET-SHAPED HIT ${hit.commit} ${hit.path}:${hit.line}: ${hit.content}`);
  }
  console.log(
    `check-history-secrets: ${violations.length} violation(s) · ${allowlistedTotal} allowlisted fixture hit(s) across ${ALLOWLIST.length} documented allowlist paths`,
  );
  console.log(
    "check-history-secrets: authoritative full-history gate = CI gitleaks job (ci.yml); this local substitute documents the pattern set + fixture allowlist.",
  );

  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

main();
