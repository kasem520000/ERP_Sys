# Dependency Triage — 2026-11 (PHASE-024 T7)

> **Status:** COMPLETE (record) · **Owner:** Platform Operations / Security Architecture ·
> **Updated:** 2026-11-06 · **Phase:** [PHASE-024](../implementation/phases/PHASE-024.md) §5 T7
> (§2 scope item 6: "Dependency triage: full `pnpm audit`-equivalent sweep + lockfile lint
> (no `*` ranges on prod deps), SBOM review …, known-exploit triage with the §1 blocking
> rule (no known-critical in prod deps), and a gitleaks full-history scan") · **Feeds:**
> `docs/operations/security-findings.md` (the living findings log — same-day ingestion of
> anything actionable below; this file is the evidence record).

Commands in this record were executed 2026-11-06 against the PHASE-024 working tree
(lockfile as of PHASE-023 + PHASE-024 changes). Toolchain: pnpm 9.15.9, Node 22/24.

## 1. §1 blocking rule — statement + actual result

> **Blocking rule (PHASE-024 §6 acceptance 6): no known-critical in production
> dependencies.**

**Result: HOLDS — 0 critical findings** in `pnpm audit --prod` (recursive workspace
audit, 2026-11-06). The sweep found **1 moderate + 3 high**; none critical. The 3 highs
are recorded with triage in §2 (2 are build-toolchain DoS in the mobile bundler chain,
1 is the carried-over unreachable multer advisory); the CI `deps-audit` job gates at
high and is RED until they are remediated or waiver-recorded — that is the gate doing
its job, not a broken gate. Per the task discipline, **no transitive-dependency
upgrades were attempted here** — remediation is report-only with the path named.

## 2. `pnpm audit` output (registry reachable — no network failure to record)

`pnpm run audit:deps` (= `pnpm audit --prod --audit-level high`, recursive over the
workspace lockfile) — executed 2026-11-06, **exit 1 (3 highs ≥ audit level)**,
summary line: `4 vulnerabilities found — Severity: 1 moderate | 3 high`.

| # | Severity | Package (advisory) | Path | Triage (2026-11-06) | Remediation path (report-only) |
|---|----------|--------------------|------|--------------------|-------------------------------|
| A-1 | HIGH | `image-size@1.2.1` (GHSA-5p2g-fcmc-qvqq — JXL/HEIF parser infinite loop) | `apps/mobile > react-native@0.76.9 > @react-native/community-cli-plugin > metro@0.81.5 > image-size@1.2.1` | **Build-time only**: image-size runs inside metro while BUNDLING the app (asset dimension parsing); it is not compiled into the shipped Android binary and never sees tenant/runtime input. DoS requires a malicious image asset in the app source tree. | react-native 0.76.x line must ship a metro with image-size ≥ 2.0.3 (or a coordinated `pnpm.overrides` bump — a release-engineering change, not an in-triage edit). |
| A-2 | HIGH | `image-size@1.2.1` (GHSA-w3rx-r6r6-pgpr — ICNS parser infinite loop) | same path as A-1 | same triage as A-1 (second advisory on the same package instance) | same as A-1 |
| A-3 | HIGH | `multer@2.4.0` (GHSA-q7qp-rjg7-q26m — DoS via pending async fileFilter after request teardown) | `apps/api > @nestjs/core@11.2.8 > @nestjs/platform-express@11.2.8 > multer@2.4.0` | **Not reachable** (re-verified 2026-11-06: `FileInterceptor|multer|multipart` across `apps/api/src` → **0 hits**; file uploads travel as JSON bodies through the files module). Carried finding — P-01 in [MVP_SECURITY_REVIEW.md](../security/MVP_SECURITY_REVIEW.md) §1 with the same triage. | `@nestjs/platform-express` upgrade (multer ≥ 2.5.0) — the scheduled Nest 11.x patch bump; revisit at the next dependency sweep. |
| A-4 | MODERATE | `uuid@8.3.2` (GHSA-w5hq-g745-h8pq — v3/v5/v6 out-of-range writes with caller-supplied buf) | `apps/api > exceljs@4.4.0 > uuid@8.3.2` | **Not exploitable** (exceljs calls `v4()` only; no application code passes buffers to uuid). Carried finding — P-02 in MVP_SECURITY_REVIEW §1. | transitive inside exceljs; no application-reachable path — monitor. |

Dev-only graph (`pnpm audit` without `--prod`) is out of scope for the blocking rule
(toolchain dependencies never shipped); the MVP review §1 recorded that class.

## 3. Lockfile lint (`check:deps`)

`pnpm run check:deps` → **PASS**: `11 manifests scanned · 0 prod violations · 0 dev
warnings` (root + apps/api, apps/desktop, apps/mobile, apps/mobile/native, apps/web +
packages/config, contracts, domain-core, sync-core, ui). The lint asserts no `"*"`/`"x"`
ranges in `dependencies`/`peerDependencies` (dev floats are warned, not failed); the
sanctioned `workspace:*` internal links are NOT violations (resolved to the workspace
version, lockfile-pinned — MVP_SECURITY_REVIEW §1 "Lockfile discipline"). Negative-case
behavior verified on a scratch tree (3 prod errors + 1 dev warning detected, exit 1;
`--report-only` exits 0 with the same report). **No package.json was modified by this
task — the tree was already clean.**

## 4. SBOM (CycloneDX)

**CI is the authoritative substrate**: the new `sbom` job in
[.github/workflows/ci.yml](../../.github/workflows/ci.yml) generates server + web
CycloneDX SBOMs on every push and uploads them as artifacts (`erp-sbom-<sha>`) —
mirroring the desktop-release invocation style. `sbom*.json` is gitignored locally.

**Local run record (honest, including the failures):**

1. First attempt with the task-literal command
   (`pnpm dlx @cyclonedx/cyclonedx-npm --output-format JSON --output-file sbom.json`)
   → **FAILED**, exit 254:
   `Command failed: pnpm ls --json --long --all` → `ERROR Unknown option: 'all'` →
   `Error: failed to parse npm-ls response`. Root cause: cyclonedx-npm detects pnpm via
   the `npm_execpath` env var (set by `pnpm run`) and shells out to
   `pnpm ls --json --long --all` — **pnpm 9.15.9 does not support `--all` on `ls`**.
2. Second observation: with `npm_execpath` unset the tool falls back to `npm ls`, which
   accepts `--all` but exits nonzero on pnpm-installed trees (ELSPROBLEMS:
   extraneous/invalid entries from npm reading the pnpm layout) — absorbed by the
   tool's documented `--ignore-npm-errors` escape hatch.
3. Working invocation (now the root script):
   `env -u npm_execpath pnpm dlx @cyclonedx/cyclonedx-npm --ignore-npm-errors
   --output-format JSON --output-file sbom.json` → **exit 0**, `sbom.json`
   (2061 components, metadata name `erp-platform` — the full workspace npm graph
   incl. the API server), and `sbom:web` (scoped to `apps/web`) → **exit 0**,
   `sbom-web.json` (2471 components, metadata name `web`). Both artifacts deleted
   after recording (gitignored); the CI job uploads the per-sha authoritative copies.

**Carried finding (for the findings log):** the SBOM step in
[desktop-release.yml](../../.github/workflows/desktop-release.yml) uses the bare
invocation and pins the same pnpm 9.15.9 — on a real Windows runner it would fail the
same way (the pipeline has never executed outside the sandbox; its step order is
structurally asserted by `apps/desktop/__tests__/desktop-release-ci.test.ts`, which is
why this stayed invisible). Candidate row for `security-findings.md`: severity Medium
(release pipeline SBOM step broken-on-arrival), fix = the same two flags, owner
release engineering.

The workspace-filter approach (`-w apps/api`) was also tested and fails
(`npm error No workspaces found` — npm only reads the `"workspaces"` key in
package.json, pnpm uses pnpm-workspace.yaml; the feature is experimental in
cyclonedx-npm 6.0.1), which is why the server SBOM is the full-workspace graph and the
web SBOM is directory-scoped.

## 5. Gitleaks full-history scan — local substitute + CI gate

**CI remains the authoritative gate**: the `gitleaks` job (full history, every push +
weekly per SECRETS_MANAGEMENT §4 rule 2). The new local substitute
(`pnpm run check:history-secrets`, `scripts/check-history-secrets.ts`) runs a bounded
`git grep -E` sweep over commit history with the classic pattern set (AWS `AKIA…`,
`BEGIN (RSA|EC|OPENSSH) PRIVATE KEY`, credentialed `postgres://…:…@` URLs, quoted
api-key/secret/password literals ≥16 chars, GitHub `ghp_…`, Slack `xox[baprs]-…`),
sampling the last 200 commits + the first commit of every phase tag (`--full` for
everything).

**Executed 2026-11-06 (both modes; the repo's history is 6 phase-squash commits + 1
tag `phase/023`, so sampled == full):**

```
check-history-secrets: sampled (last 200 + 1 tag anchor) — 6/6 commits across all refs
  anchor phase/023 -> 3ad2f9121bdf
check-history-secrets: 0 violation(s) · 141 allowlisted fixture hit(s) across 11 documented allowlist paths
check-history-secrets: authoritative full-history gate = CI gitleaks job (ci.yml); …
exit 0 (≈3.5 s; --full identical)
```

**Allowlist (each entry carries its reason in the script):** the task-mandated four
paths — `apps/api/migrations/`, `apps/api/src/__db__/`, `tests/`, `docs/` (test
fixtures + docs; the MVP_SECURITY_REVIEW §0/§3 "documented dev-credentials pattern"
precedent) — PLUS six same-class extensions found by the first strict run, reported
here rather than hidden: with ONLY the four mandated paths, the scan reports **63
hits across 6 files**, all the same documented dev-placeholder/test-fixture class:
`.env.example` (6), `docker-compose.yml` (12), `apps/api/scripts/restore-drill.ts`
(18), `apps/api/src/config/env.spec.ts` (12), `apps/desktop/__tests__/telemetry.test.ts`
(9), `scripts/ci/migration-tests.ts` (6). Each is quoted LOCAL-ONLY dev material
(production assigns credentials out-of-band — SECRETS_MANAGEMENT §2); the extensions
are recorded in the script's ALLOWLIST with per-entry reasons.

## 6. CI wiring added by this task

- `deps-audit` job (ci.yml): `pnpm audit --prod --audit-level high` after a frozen
  install, no continue-on-error — **currently RED on the 3 highs of §2 by design**;
  remediation or §13 waiver records turn it green.
- `sbom` job (ci.yml): server + web CycloneDX SBOMs → `upload-artifact`
  (`erp-sbom-<sha>`), the SBOM-diff review substrate for the release process.
- Root scripts: `check:deps`, `check:history-secrets`, `audit:deps`, `sbom:generate`,
  `sbom:web`.

## 7. Findings candidates for the security findings log (ingestion)

The findings log (`docs/operations/security-findings.md`) is owned by the PHASE-024
orchestrator; the rows this triage contributes for same-day ingestion:

| Candidate | Severity | Surface | Status |
|-----------|----------|---------|--------|
| image-size ≥2.0.0 <2.0.3 in the mobile bundling chain (A-1/A-2) | High (SLA 30 d) | build toolchain (metro), not shipped runtime | open — remediation via react-native/metro line; waiver candidate (build-time only) |
| multer <2.5.0 carried under @nestjs/platform-express (A-3) | High (SLA 30 d) | API runtime — **unreachable** (0 multipart routes, re-verified) | open — carried P-01; Nest patch bump |
| desktop-release.yml SBOM step fails on pnpm 9.15.9 (`pnpm ls --all`) | Medium | release pipeline (never executed on a real runner) | open — apply the §4 fix flags |
| SBOM generation requires `env -u npm_execpath` + `--ignore-npm-errors` under pnpm 9 | Low (tooling note) | SBOM tooling | resolved in the new scripts/CI job (recorded for the next toolchain bump) |
