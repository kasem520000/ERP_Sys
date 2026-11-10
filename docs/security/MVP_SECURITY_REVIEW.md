# MVP Security Review — PHASE-014 (internal gate)

> **Status:** COMPLETE · **Date:** 2026-11-01 · **Scope:** the full MVP surface
> (everything shipped in PHASE-001…014) · **Executed by:** PHASE-014 session (AI coding
> agent) per [PHASE-014.md](../implementation/phases/PHASE-014.md) §2.9 and
> [SECURITY_TEST_PLAN.md](SECURITY_TEST_PLAN.md) §1 per-phase gates.

## 0. Scope split (explicit — PHASE-014 §2.9)

This review is the **internal MVP gate**: dependency audit, SAST-equivalent static
review, route-permission sweep, configuration verification against the THREAT_MODEL
scenarios, and a triaged findings register with in-phase fixes for blockers.

**The external penetration test and its remediation are PHASE-024** — out of this
gate's scope by decision (RELEASE_STRATEGY; SECURITY_TEST_PLAN §11). Nothing in this
document substitutes for it. MFA-policy hardening beyond current config and
rate-limit tuning beyond verification are likewise PHASE-024.

Environment note (the standing waiver pattern): executed in the development sandbox —
embedded PostgreSQL 16, real tooling, no staging infra. Evidence outputs are local-run
transcripts; first GitHub CI run remains the recorded follow-up obligation from
PHASE-001. Gitleaks (secrets scan) runs in CI only — the local substitute is the
targeted secrets grep in §3 (recorded below).

## 1. Dependency audit (`pnpm audit`) — 2026-11-01, lockfile as of PHASE-014

**Production-reachable (`pnpm audit --prod`): 3 findings, 0 critical.**

| # | Severity | Package | Advisory | Path | Triage | Decision |
|---|----------|---------|----------|------|--------|----------|
| P-01 | HIGH | `multer@2.4.0` | GHSA-q7qp-rjg7-q26m — process crash via pending async `fileFilter` + aborted request | `apps/api > @nestjs/core > @nestjs/platform-express > multer` | **Not reachable**: the API has ZERO multipart routes (grep for `FileInterceptor`/`multer`/`multipart` across `apps/api/src`: 0 hits) — file attachments upload as JSON bodies through the files module; multer is never invoked on any request path, so the abort-during-parse precondition cannot occur. | **Defer** — fix lands with the scheduled `@nestjs/platform-express` upgrade (multer ≥ 2.5.0); revisit at the PHASE-015 dependency sweep. Not an MVP blocker (unreachable). |
| P-02 | MODERATE | `uuid@8.3.2` | GHSA-w5hq-g745-h8pq — `v3()/v5()/v6()` with caller-supplied `buf`/`offset` out-of-range writes | `apps/api > exceljs > uuid` | **Not exploitable**: the vulnerable API methods require the CALLER to pass an output buffer; exceljs internally calls `v4()` only, and no application code passes buffers to uuid. | **Defer** — transitive inside exceljs; no application-reachable path. |
| P-03 | MODERATE | `minimatch@3.1.5/5.1.9` | GHSA-g3hv-75wg-m249 — ReDoS via attacker-controlled glob pattern amplification | `apps/api > exceljs > archiver > glob/minimatch` | **Not attacker-controlled**: the glob patterns are archiver's static internal patterns (XLSX zip assembly); no user input reaches pattern compilation. | **Defer** — patterns are library-internal constants. |

**Dev-only (`pnpm audit` full graph): 24 additional findings (5 critical, 5 high …)**
— all in toolchain dependencies never shipped to production: `handlebars` (via
`eslint-plugin-boundaries`), `tinypool`/`vitest`/`@vitest/mocker` (test runner),
`esbuild` (bundler dev server), `fast-xml-parser` (storybook-side), `glob`. Severity
applies to the development environment only.

**Verdict: 0 known-critical in production dependencies — the §1 blocking gate holds**
(the one HIGH is unreachable, triaged with reason above).

**Lockfile discipline:** no `*` ranges on production dependencies (only sanctioned
`workspace:*` protocol on internal packages); `pnpm-lock.yaml` committed.

## 2. Route-permission sweep (100% of shipped routes, PHASE-001…014)

- **Registry vs seed vs matrix**: `pnpm check:permissions-drift` →
  `OK — matrix 224 keys, seed 224 keys` (AUTHORIZATION_MATRIX §3.1–§3.10 ↔
  migration seed — zero drift, run in the 17-step gate, step 4).
- **Generated route × role checklist (acceptance 5)**: the identity/audit-plane spec
  asserts *every protected route in `ROUTE_PERMISSIONS`: the owner template grants it,
  the viewer template does not* — green in the db suite (identity-flows spec,
  `src/__db__/identity-flows.db.spec.ts`, part of the 69-file / 1153-test green run).
- **Public-route inventory** (no session, explicitly listed in `PUBLIC_ROUTES`):
  `POST /api/v1/identity/sessions` (login — progressive lockout R-01/R-02 live and
  tested), password-reset request/confirm, registration, `GET /api/v1/public/plans`
  (NEW PHASE-014 — rate-limited 60/min per anonymous bucket, tenant-data-free,
  verified in §4), `POST /api/v1/platform/billing/webhook` (NEW PHASE-014 —
  signature-verified, §4). No other route resolves without a session + permission.
- **PHASE-014 additions to the registry** (all permission-gated per matrix §3.9/§3.10):
  `tenancy.subscription.manage` → `GET /tenancy/subscriptions`, `POST
  /tenancy/subscriptions/change-plan`, `POST /tenancy/subscriptions/checkout/:ref/complete`;
  `platform.subscriptions.manage` → `GET|POST /platform/subscriptions`,
  `POST /platform/subscriptions/:id/manual-payment|suspend|restore`,
  `POST /platform/subscriptions/run-daily-pass`; the notifications self plane
  (`GET /notifications`, `GET /notifications/unread-count`,
  `PATCH /notifications/:id/read`, `GET|PUT /notifications/preferences`) is
  session-scoped with no permission key (self data only — every row is
  `WHERE user_id = session user`).
- **UI visibility is derived-only (BR-039)**: server rejects unentitled actions even
  when the UI hid them — asserted by the spoofing specs in the isolation suite.

## 3. SAST-equivalent static review (2026-11-01)

The repo's ESLint configuration is the standing static analyzer (security-relevant
rules active: `no-restricted-properties` enforcing ADR-0009 decimal discipline,
module-boundary rules via `eslint-plugin-boundaries`, TypeScript strict mode, import
hygiene). Gate step 2 (`pnpm lint` across all packages) — clean. On top, targeted
scans for the classic categories (commands run 2026-11-01 against `apps/api/src` +
`apps/web`):

| Category | Scan | Result |
|----------|------|--------|
| Dynamic code execution | `eval(`, `new Function(` | **0 hits** in production code |
| Process spawning | `child_process` | Only test infrastructure (`__db__/global-setup.ts`, `migrations.db.spec.ts` — the embedded-PG boot; no user input reaches argv) |
| SQL injection | raw `query(\`…${…}\`)` interpolation of non-parameter values | **0 hits** in `src/modules` + `src/infra` (all queries parameterized; the LIKE patterns in specs are fixture constants) |
| Hard-coded secrets | credential-shaped literals scan | 2 hits, both benign: `REPORT_JOB_ENQUEUER_TOKEN` (a DI symbol name, not a secret) and the embedded-test-PG bootstrap password in `__db__/global-setup.ts` (test infra, the documented dev-credentials pattern; migrations stay secret-free — `scripts/db-dev-credentials.ts`) |
| Weak randomness for tokens | `Math.random` in production code | **0 hits** — tokens/secrets via `node:crypto` (`randomBytes`, `createHmac`, `timingSafeEqual`: identity tokens/TOTP/MFA/recovery + the NEW billing webhook signer) |
| Secrets scan (gitleaks local substitute) | targeted grep (above) + `git log -p` scan of the phase diff for credential-shaped strings | No findings; CI gitleaks remains the authoritative gate (follow-up obligation) |

## 4. Configuration verification vs THREAT_MODEL scenarios (S-01…S-13 applicable subset)

| Scenario | Verification | Evidence |
|----------|--------------|----------|
| S-01 cross-tenant access | The tenant-isolation attack suite (A1–A11 + API spoofing) incl. the PHASE-014 tables (`subscriptions`, `subscription_invoices`, `billing_events`, `usage_counters`, `notifications`, `notification_prefs` — migration 0021 RLS + grants + A-tests) | `src/__db__/isolation/` — **654 tests green** (identity-isolation 642 + platform-isolation 12); RLS catalog checker green (gate); zero RLS denials in suite traffic |
| S-02 stolen session token | Session/MFA abuse tests (M-01…M-10: idle/absolute timeout, cookie flags, rotation, replay) | identity specs green in the 1153-test db run; session invalidation on suspension = lifecycle spec (M-09) green |
| S-03 stored XSS (bilingual) | CSP verification probe (AR+EN, RTL-spoofing payloads) | `pnpm test:web-security` — **1 passed (35 s)** (gate step 12): CSP `default-src 'self'`, no `unsafe-inline` scripts, `X-Content-Type-Options`, `X-Frame-Options DENY`, `Referrer-Policy` asserted |
| S-04 CSRF on approvals | Same probe (SameSite + origin checks) | green (above) |
| S-05 support-access abuse | Support-access service (PHASE-004): scoped, expiring, audited, ticket-linked | platform-isolation spec (12 tests) green; weekly report cadence = ops follow-up on real infra |
| S-06 platform-admin misuse | Platform plane fully audited incl. NEW `via_platform_admin` manual payments (reason mandatory ≥ 3 chars, audited `subscription.manual_payment` events) | platform specs green; billing webhook + admin console spec (`webhook-http.db.spec.ts` 7 tests, platform billing routes in `platform-lifecycle` + `billing/*` specs) green |
| S-07 e-invoicing certificate theft | Post-MVP scope (no production e-invoicing live in v1.0 — DR-001 defers ZATCA Phase-2) | N/A at MVP (documented in compliance DRs) |
| S-08 offline device theft | Offline clients are PHASE-020+ | N/A at MVP; suspension semantics (`tenant_suspended` push rejection) tested at the API layer |
| S-09 backup exfiltration | WORM/object-access alerting is the managed-storage tier; the restore drill proves the artifact path | Drill record 2026-11-01 (runbook §8): PASSED; staging WORM inspection = ops follow-up |
| S-10 invoice tampering | Posting immutability INV-003 + append-only grants + typed `ALREADY_POSTED` | golden + posting suites green (part of 1153); restore-drill check (f) re-proved the grant wall post-restore |
| S-11 permission elevation | Route × role checklist + drift check + server-side re-resolution (incl. report runs FORBIDDEN_AT_RUN) | §2 evidence; drift 224=224 |
| S-12 rate-limit evasion | R-01/R-02 progressive lockout + per-IP limits (PHASE-003, tested); NEW PHASE-014 public endpoints rate-limited: `GET /public/plans` 60/min anonymous bucket (`RateLimiter` in the controller — verified); webhook = signature+replay protected (HMAC-SHA256 `timingSafeEqual`, 300 s staleness window, idempotency-key gate `webhook:{eventId}` — duplicate delivery = idempotent no-op, INV-013 discipline) | identity specs green; `webhook-http.db.spec.ts` (signature rejection, stale rejection, duplicate idempotency) green |
| S-13 supply-chain compromise | §1 audit + lockfile discipline + pnpm integrity | §1 verdict: 0 prod criticals |

Session config spot-check: cookie flags (httpOnly, Secure, SameSite=Lax), idle 30 min /
absolute 12 h, rotation on login/membership switch — asserted by the identity specs
(green) and the web probe.

## 5. Findings register (triaged)

| ID | Severity | Finding | Owner | Decision |
|----|----------|---------|-------|----------|
| F-01 | High (unreachable) | multer GHSA-q7qp-rjg7-q26m via @nestjs/platform-express (P-01) | Platform | **Defer with reason** (§1): no multipart route exists; upgrade at the PHASE-015 dependency sweep. Re-triage if any file-upload route adopts multipart before then — that would make it a blocker. |
| F-02 | Medium | Visual-baseline directory `__image_snapshots__` was absent from the delivered archive (environment drift), requiring regeneration in this environment (zero rendering-code changes — `packages/ui` untouched by PHASE-014) | Platform | **Fixed in-phase**: baselines regenerated; clean re-run 16/16 green; the standing quarantine (`catalog--app-shell-page`, subpixel AA variance under software rasterization, SLA 2026-11-03) is now honored by the coverage check (excluded from the pixel-diff gate per VISUAL_TESTING §3 — it still renders every run). |
| F-03 | Medium (dev-only) | 24 dev-graph advisories (handlebars/tinypool/vitest/esbuild) | Platform | **Accept**: toolchain-only exposure, never shipped; upgrade opportunistically. |
| F-04 | Low | `pg_dump`/`pg_restore` binaries are not part of the sandbox image (drill needed the extracted Debian client package) | Ops | **Recorded**: staging/CI must pin the postgresql-client package matching the server major (16) in the image (BACKUP_RESTORE_RUNBOOK §3 prerequisite — added to the runbook drill record actions). |
| F-05 | Low | `webhook` secret falls back to a documented dev value when `BILLING_WEBHOOK_SECRET` is unset (sandbox/test only; production env validation fails closed per SECRETS_MANAGEMENT) | Platform | **Accept for dev**; production deployment checklist must set the secret (DEPLOYMENT.md env matrix — already required). |

**Blockers fixed in-phase: none outstanding** (F-01 is unreachable; F-02 was fixed;
F-03/F-04/F-05 are recorded with reasons). Zero open gate blockers.

## 6. Release-blocking verdict

Per [SECURITY_TEST_PLAN.md](SECURITY_TEST_PLAN.md) §1 (phase exit requires the
applicable gates green):

- Dependency audit: **green** (0 prod criticals; 1 HIGH unreachable + triaged).
- Secrets scan: local substitute green; CI gitleaks = standing follow-up.
- SAST: green (lint clean + targeted scans clean).
- Tenant-isolation attack suite incl. the six new PHASE-014 tables: **green** (654
  isolation tests; full db suite 69 files / 1153 tests).
- Permission tests per route: **green** (drift 224=224 + generated checklist).
- Rate limiting on new public endpoints: **green** (plans limiter + webhook signature).
- Headers/CSP verification: **green** (probe passed).
- Upload security: unchanged surface from PHASE-002/006 (files specs green in the
  1153-run; U-01…U-07 remain covered by the files specs).

**The MVP surface is reviewable and internally verified; the external penetration test
(PHASE-024) is the next hardening step per RELEASE_STRATEGY.**
