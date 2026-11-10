# P24-SEC-D — PHASE-024 T6 secrets-rotation drills + T7 dependency triage

**Task ID:** P24-SEC-D · **Scope:** PHASE-024 §5 T6 (drills S-01/S-03/S-11/S-10 + runbook)
+ T7 (lockfile lint, audit wiring, SBOM, history-secrets substitute, triage record)
**Status:** COMPLETE — api tsc clean, 2 new plain unit specs + full plain suite 310/310
green, depcruise clean (2192 modules), docs:validate 29/29, check:deps PASS,
check:history-secrets PASS (sampled + --full), audit:deps + sbom executed and recorded
honestly. DB drill spec WRITTEN, NOT RUN (orchestrator owns the DB suite).

## Files created

| Path | What |
|------|------|
| `apps/api/src/modules/identity/infrastructure/secret-envelope-rotation.spec.ts` | Plain unit spec (8 tests): S-03 dual-accept — old-key seal → window read (round-trip), window close fails closed, new seals use current keyId, wrong-id previous never opens, tamper fails under every config, bad previous-key length fails fast, same-id material swap, third-key envelope fails closed. |
| `apps/api/src/modules/tenancy/__tests__/webhook-rotation.spec.ts` | Plain unit spec (7 tests): S-11 dual-secret — current passes alone, old-secret passes through the window, window close fails closed (mismatch), wrong secret rejected in both configs, tampered bytes, stale/malformed unchanged, identical previous collapses. |
| `apps/api/src/__db__/secrets-rotation.db.spec.ts` | **THE DRILL (orchestrator runs it — I did NOT run it)**: S-01 ALTER ROLE erp_app PASSWORD rotation + old-password canary + restore-verify; S-03 env rotation through `reloadEnv` (window open → readable, window closed → fail closed); S-11 webhook dual-secret through the rotation-aware verifier; S-10 enroll→rotate via certificate-service against the `fake-zatca` harness adapter (throwaway synthetic PEM) with `rotated_from_id` chain + REVOKED predecessor + usage-audit rows + no-key-material-in-metadata. `timings` object per block, asserted present + printed (`[secrets-rotation-drill] timings (ms)`). S-01 restores the password in `finally` before any other spec can open app-role connections. |
| `scripts/check-deps.ts` | Lockfile lint: walks every package.json (node_modules/build outputs skipped), errors on `"*"`/`"x"`/`"X"` in dependencies+peerDependencies, warns on dev floats, `workspace:*` sanctioned (NOT a violation), `--report-only` mode, exit 1 with the offending list. |
| `scripts/check-history-secrets.ts` | Gitleaks local substitute: `git grep -E` over commit history (AKIA / private-key blocks / credentialed postgres URLs / quoted secret literals ≥16 / ghp_ / xox*), samples last 200 commits + first commit of every tag (`--full` = everything), skips node_modules/lockfiles/binary, per-entry REASONED allowlist, exit 1 with `commit path:line` hits. |
| `docs/operations/drills/2026-11-06-secrets-rotation.md` | The drill record: what was drilled (4 blocks), dual-accept design, env vars, §7 revoke-first 7-step TABLETOP walk, what-was-hard (5 runbook entries), honest evidence split (spec-verified-by-orchestrator vs run-by-me), honest status line pointing at the db spec + PHASE-024 completion report. |
| `docs/operations/SECRETS_ROTATION_RUNBOOK.md` | Ops runbook: §0 revoke-first ordering; §1 S-01 (verify/rollback/emergency); §2 S-03-class dual-accept (4-var window, open/close/verify/rollback); §3 reserved S-06; §4 S-11 provider-coordinated window; §5 S-10 enroll/rotate via the service (fake-authority-harness-only in staging); §6 append-only drill log. |
| `docs/operations/dependency-triage-2026-11.md` | T7 record: §1 blocking-rule statement (0 critical → HOLDS), §2 audit table (1 moderate + 3 high, triaged, report-only), §3 lockfile lint result, §4 SBOM story (first-attempt failure + root cause + working invocation + desktop-release latent-bug finding), §5 history-secrets output + allowlist + the 63-hits-outside-strict-4-paths honest note, §6 CI wiring, §7 findings-log candidates (log owned by orchestrator — NOT touched). |

## Files modified

| Path | Change |
|------|--------|
| `apps/api/src/modules/identity/infrastructure/secret-envelope.ts` | Dual-accept: `previousKeyMaterial()` (env `IDENTITY_SECRET_KEY_PREVIOUS` + `_ID_PREVIOUS`, 32-byte fail-fast); `openSecret` tries current key → on unknown keyId or auth failure tries previous (keyId match required) → fails closed; `sealSecret` always current. `decryptWith` extracted. |
| `apps/api/src/modules/tenancy/application/billing/provider-adapter.ts` | `acceptedWebhookSecrets()` (current first, previous while set) + `verifyWebhookSignatureWithRotation()` (current → previous; malformed/stale surface immediately; all-mismatch → fail closed). `verifyWebhookSignature` unchanged (explicit-secret, still unit-tested). |
| `apps/api/src/modules/tenancy/application/billing/subscription-service.ts` | `ingestWebhook` now verifies via `verifyWebhookSignatureWithRotation` (the S-11 window at the real ingest path). |
| `apps/api/src/config/env.ts` | + `IDENTITY_SECRET_KEY_PREVIOUS`, `IDENTITY_SECRET_KEY_ID_PREVIOUS`, `WEBHOOK_SIGNING_SECRET_PREVIOUS` (documented). **`reloadEnv()` FIX**: reset-then-assign — zod drops absent optional keys, so the old `Object.assign` left STALE values when a var was deleted (closing the S-03 window would not have taken effect). Caught by the new unit spec. |
| `.env.example` (root) | Documented the two rotation-window blocks (+ `BILLING_WEBHOOK_SECRET` which was never listed) with runbook pointers. |
| `package.json` (root) | + `check:deps`, `check:history-secrets`, `audit:deps`, `sbom:generate`, `sbom:web`. |
| `.github/workflows/ci.yml` | + `deps-audit` job (pnpm audit --prod --audit-level high, no continue-on-error) + `sbom` job (server + web CycloneDX → upload-artifact `erp-sbom-<sha>`), both following the gitleaks/install job style. |
| `.gitignore` | + `sbom*.json` (local SBOM outputs; CI artifacts authoritative). |

## Verification (executed)

- `cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json` → **clean** (includes the db drill spec).
- New plain specs → **15/15 green**; full plain api suite → **31 files / 310 tests green** (regression incl. the `reloadEnv` fix).
- `pnpm run check:deps` → **PASS** (11 manifests, 0 prod violations, 0 dev warnings; no package.json edited). Negative case + `--report-only` verified on a scratch tree.
- `pnpm run check:history-secrets` → **PASS, 0 violations, 141 allowlisted fixture hits, ~3.5 s** (sampled AND `--full` — repo history is 6 phase-squash commits + tag `phase/023`).
- `pnpm run audit:deps` → **registry REACHABLE**; exit 1 with `1 moderate | 3 high` (image-size ×2 via metro, multer carried P-01, uuid P-02). 0 critical → §1 blocking rule HOLDS. No upgrades attempted (report-only per task).
- SBOM: task-literal command **FAILS** (`pnpm ls --json --long --all` → Unknown option 'all' on pnpm 9.15.9; tool detects pnpm via `npm_execpath`); fixed scripts (`env -u npm_execpath` + `--ignore-npm-errors`) → **exit 0**, sbom.json 2061 components ("erp-platform"), sbom-web.json 2471 ("web"); artifacts deleted (gitignored). **desktop-release.yml carries the same latent bug** (recorded as a findings candidate).
- eslint (all touched files) clean; `pnpm lint:depcruise` clean (2192 modules); `python3 scripts/validate_docs.py` 29/29.
- apps/web NOT touched by this task (its diffs in the shared tree belong to P24-WEB-A-web / P24-SEC-B).

## Deviations / judgment calls (reported, not hidden)

1. **`reloadEnv()` fix in shared config** — required for the S-03 window-close to be real (see above); behavior-compatible for every existing consumer (values only ever added before, never removed).
2. **Webhook env naming asymmetry** — the task mandates `WEBHOOK_SIGNING_SECRET_PREVIOUS` while the current secret stays `BILLING_WEBHOOK_SECRET` (PHASE-014 name). Kept both per the task's letter; documented in .env.example + runbook §4.
3. **History-secrets allowlist extended beyond the 4 mandated paths** — strict 4-path allowlist leaves 63 hits in 6 documented dev-placeholder files (.env.example, docker-compose.yml, restore-drill.ts, env.spec.ts, telemetry.test.ts, migration-tests.ts); each added WITH a reason; the extension is reported in the triage doc §5 and in the script comments. CI gitleaks stays authoritative.
4. **SBOM scripts deviate from the task-literal commands** (they fail on pnpm 9.15.9 — exact errors recorded in the triage doc §4); the shipped scripts are the proven-working variants; the CI job mirrors desktop-release's artifacts-dir style with the two fix flags.
5. **deps-audit CI job is intentionally RED right now** (3 highs) — it's the gate working; remediation/waiver is the path (no self-upgrades of transitive deps per task).
6. **S-10 drill scope**: enroll→rotate via the certificate service for the `fake-zatca` harness adapter with synthetic PEM + usage-audit assertions, mirroring `tax/certificates.spec.ts` fixture setup (per the task's "keep it minimal" instruction); the full fake-authority submission matrix stays in its own spec.

## Handoff notes (for the orchestrator)

- Run `apps/api/src/__db__/secrets-rotation.db.spec.ts` in the DB suite; the transcript's `[secrets-rotation-drill] timings (ms)` line is what the drill record cites — attach it to the PHASE-024 completion report.
- The drill record + triage doc mark the spec-verified vs directly-verified evidence split explicitly (no fabricated results).
- Findings-log candidates for `docs/operations/security-findings.md` are listed in dependency-triage-2026-11.md §7 (that file is orchestrator-owned — NOT touched by this task).
- The desktop-release.yml SBOM-step fix (two flags) is a one-line change for whoever owns release engineering.
