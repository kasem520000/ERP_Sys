# T21-DOCS — PHASE-014 verification gate, evidence bundle & MVP release docs

**Task ID:** T21-DOCS (PHASE-014 T11–T14 — the gate, security review, load/restore
evidence, and the release documentation set). This session picked up the
in-progress PHASE-014 tree (API + web work complete but unverified), drove it
through the full verification gate, fixed what the gate found, executed the three
evidence tasks (security review / load smoke / restore drill), and produced the
release documentation + the completion report. `apps/api/src` module code and
`apps/web` production code were NOT feature-modified by this session (only test
files, tooling, and docs — every change listed below).

## What this session did (chronological)

1. **Toolchain restore** — the extracted tree had no `node_modules`; installed via
   corepack pnpm 9.15.9 (`packageManager`-pinned) + Playwright Chromium for the
   render/visual suites. Restored `scripts/ci/local-gate.sh`, `.env.example`,
   `scripts/gate-baseline.log` (present in the uploaded zip, missing from the
   extraction).
2. **Inherited-tree verification** — ran the db suite (initially 3 files failing:
   1 real = Playwright browser missing; 2 flaky-ordering that passed on re-run),
   then typecheck/lint. Found **12 typecheck errors + 3 lint errors** in the
   inherited PHASE-014 spec files (unused imports/variables, unsafe `outcome as`
   casts, `Math.ceil` without the sanctioned ADR-0009 justification). Fixed all:
   typed `resultOf()` helper in `dashboard.db.spec.ts`, removed dead declarations,
   added the codebase's eslint-disable justification pattern for the
   latency-statistics index computation (mirroring `posting-smoke.local.spec.ts`).
3. **Honest perf logging** — `mvp-candidate.local.spec.ts` T-04 measured the
   post-warm CACHE pass (p95=0 ms) as "interactive report tier"; restructured to
   log + assert BOTH the compute pass and the cached re-run.
4. **The 17-step gate** — the sandbox reaps detached processes, so the gate ran as
   5 foreground chunks (`/tmp/run-gate-steps.sh`, same commands/order as
   `local-gate.sh`). Step 11 (visual harness) initially failed 4 tests:
   (a) `__image_snapshots__` baselines were never in the delivered archive —
   regenerated via `--update-snapshots` (rendering code untouched: `packages/ui`
   diffs clean against the PHASE-013 zip); (b) the coverage check demanded
   baselines for the pre-existing QUARANTINE story (`catalog--app-shell-page`,
   the 2026-10-29 anti-flake decision with its own SLA) — fixed the check to
   honor the documented protocol (quarantined stories still render every run).
   Re-run: 16/16 green. **All 17 steps then green end-to-end, twice** (the final
   run after every last file change: `agent-ctx/T20-gate-evidence-PHASE-014.md`).
5. **T12 NFR-006 evidence** — standalone measurement run recorded: T-01 33 ms p95
   (100k-row register) · T-02 10 ms · T-04 14 ms compute / 0 ms cached · T-06
   156 ms AR / 160 ms EN · T-07 0/62 5xx. Authored the hosted-tier k6 script
   `apps/api/k6/mvp-candidate.ts` (ramping 20 VUs, the §2 60/25/15 mix, per-tier
   thresholds; the staged-run calibration note is in the completion report).
6. **T13 restore drill** — authored `apps/api/scripts/restore-drill.ts`
   (`pnpm --filter @erp/api restore:drill`): embedded PG16 + full migration chain
   + seeded verifiable dataset → real `pg_dump -Fc` → DROP/CREATE →
   `pg_restore --no-owner --jobs=4` → the runbook §3.4 invariant smoke a–f +
   row-parity. Debug notes: the sandbox has no pg tools on PATH and no root —
   extracted `postgresql-client-16` 16.15 (pgdg) + `libpq5` (Debian) to
   /tmp/pgtools; a first attempt with client-17 tools failed on the PG17-only
   `transaction_timeout` GUC (client major MUST match the server major — recorded
   as F-04 in the security review). **DRILL PASSED**: RTO 0.7 s, all checks green,
   parity 5/5. Drill record appended to BACKUP_RESTORE_RUNBOOK §8.
7. **T11 security review** — `docs/security/MVP_SECURITY_REVIEW.md`: pnpm audit
   (prod: 1 HIGH multer unreachable — zero multipart routes — + 2 moderate
   transitive, all triaged with reasons; dev-only set documented), route sweep
   (drift 224=224 + the generated route×role checklist), SAST-equivalent scans
   (eval/child_process/SQL-interpolation/secrets/Math.random — all clean; crypto
   via node:crypto with timingSafeEqual on the webhook), the S-01…S-13 applicable
   subset mapped to suite evidence, findings F-01…F-05 (zero open blockers), the
   PHASE-024 pen-test split explicit.
8. **T14 release docs** — IMPLEMENTATION_STATUS (014 COMPLETE + MVP headline),
   CHANGELOG entry, CURRENT_STATE, NEXT_ACTION (→PHASE-015 + the updated
   follow-up obligations), SUBSCRIPTION_AND_ENTITLEMENTS delivery note,
   FEATURE_CATALOG notifications split, RELEASE_STRATEGY §Release execution log
   (v1.0.0 row + the tag instruction for the zip handover), and
   **PHASE-014-COMPLETION.md** (the MVP gate record with every checklist box
   linked to evidence).

## Files changed by THIS session (all test/tooling/docs — no production feature code)

| File | Change |
| --- | --- |
| `apps/api/src/__db__/reporting/dashboard.db.spec.ts` | typed `resultOf()` helper replacing 5 unsafe casts; dropped the unused billing-store import; quarantine-safe |
| `apps/api/src/__db__/billing/readonly-sweep.db.spec.ts` | removed the unused `usage` service + `UsageService` import; `isExempt(_method)` |
| `apps/api/src/__db__/billing/usage-limits.db.spec.ts` | removed the unused tenancy-store import |
| `apps/api/src/__db__/billing/webhook-http.db.spec.ts` | removed the unused provider construction |
| `apps/api/src/__db__/notifications/inbox.db.spec.ts` | removed the unused audit scaffolding + imports |
| `apps/api/src/__db__/performance/mvp-candidate.local.spec.ts` | removed dead `postedIds`; measurement logging (T-01/02/04/06/07 lines); honest T-04 compute+cached pair |
| `apps/api/src/modules/tenancy/__tests__/billing-unit.spec.ts` | the sanctioned eslint-disable justification for the threshold-oracle Math.ceil |
| `packages/ui/tests/visual/visual.spec.ts` | the coverage check honors QUARANTINE per VISUAL_TESTING §3 |
| `packages/ui/__image_snapshots__/**` | baselines regenerated for this environment (absent from the archive; rendering code unchanged) |
| `apps/api/k6/mvp-candidate.ts` | NEW — the hosted-tier MVP-candidate scenario |
| `apps/api/scripts/restore-drill.ts` + package.json `restore:drill` | NEW — the runnable §8 drill |
| `docs/security/MVP_SECURITY_REVIEW.md` | NEW — T11 |
| `docs/operations/BACKUP_RESTORE_RUNBOOK.md` | §8 drill record |
| `docs/planning/{IMPLEMENTATION_STATUS,RELEASE_STRATEGY}.md`, `docs/handoff/{CHANGELOG,CURRENT_STATE,NEXT_ACTION}.md`, `docs/product/{SUBSCRIPTION_AND_ENTITLEMENTS,FEATURE_CATALOG}.md` | T14 updates |
| `docs/implementation/phases/reports/PHASE-014-COMPLETION.md` | NEW — the MVP release record |
| `agent-ctx/T20-gate-evidence-PHASE-014.md` | NEW — the archived gate + perf + drill transcript |

## Verification (this session's own outputs)

- Final 17-step gate: **17/17 exit 0** (`agent-ctx/T20-gate-evidence-PHASE-014.md`).
- db suite 69 files/1153 tests; unit 244; visual 16/16; CSP probe; docs 29/29
  (re-run after every doc change).
- Perf: T-01 33 ms / T-02 10 ms / T-04 14 ms / T-06 156+160 ms / T-07 0.000%.
- Drill: PASSED (RTO 0.7 s, checks a–f green, parity 5/5).

## Notes for the next agent

1. The zip handover cannot carry the `release/v1.0.0` git tag — the instruction +
   evidence are in RELEASE_STRATEGY §Release execution log and the completion
   report §v1.0.0 notes; create the tag when the archive lands in a git checkout.
2. Hosted follow-ups are consolidated in NEXT_ACTION §Follow-up obligations
   (CI, Testcontainers, hosted k6 ×2, staging PITR drill, gitleaks, the human
   journey walkthrough).
3. The pg-tools extraction path (client major must match the server) is recorded
   as security finding F-04 + the drill row actions — the staging image should pin
   `postgresql-client-16`.
4. PHASE-015 is next (identify only): the L3/L4 inputs it consumes are the
   PHASE-014 plan/entitlement events; read the PHASE-014 completion report first.
