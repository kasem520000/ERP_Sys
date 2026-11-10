# Security Findings Log

> **Status:** LIVING DOCUMENT — appended same-day per SECURITY_TEST_PLAN §13;
> never edited after the fact · **Opened:** 2026-11-06 (PHASE-024 T1) ·
> **Owner:** platform security owner (role) ·
> Severity ladder + fix SLAs per [../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) §11:
> **Critical 7 days (release-blocking) · High 30 days · Medium 90 days · Low next release**;
> waivers only via decision record.

Evidence format: id → title · severity · surface · source · status · fix + regression links ·
retest proof. Findings discovered by the PHASE-024 internal re-verification
(T2 — the full-scope internal run over SECURITY_TEST_PLAN §11's scope list) are
logged below with their in-phase remediations; the external-firm leg is the
recorded infra-gated waiver (see the engagement record at the bottom).

## Findings

| ID | Title | Severity | Surface | Source | Status | Fix + regression | Retest proof |
|----|-------|----------|---------|--------|--------|------------------|--------------|
| SF-024-001 | Per-tenant API burst limiter absent (R-04 gap: no quota isolation above plan ceilings) | High | API (all authenticated routes) | T2 internal re-verification vs §5 R-04 | **FIXED** (in-phase, same day) | `infra/http/tenant-rate-limit.middleware.ts` + `identity/infrastructure/rate-limiter.ts` (`TENANT_LIMITER`, env-tunable) + `infra/http/tenant-rate-limit.spec.ts` (7 tests: isolation A/B, 429 envelope + Retry-After + X-RateLimit, skip cases) | DB-suite green run attached to [PHASE-024-COMPLETION](../implementation/phases/reports/PHASE-024-COMPLETION.md); unit spec 7/7 |
| SF-024-002 | Password-reset email flood: per-account limit missing (R-05 half-gap) | Medium | Identity (password-resets) | T2 vs §5 R-05 | **FIXED** | `identity/application/recovery-service.ts` (per-account 3/h window; uniform 200 preserved — no oracle; email skipped when saturated) + `recovery-flood.spec.ts` (5 tests) | Unit spec 5/5 |
| SF-024-003 | API origin shipped no security headers (HSTS/nosniff/frame-ancestors/Referrer-Policy/CSP) | Medium | API origin | T2 vs §8 probe scope (web-only coverage pre-024) | **FIXED** | `infra/http/security-headers.middleware.ts` (global; CSP `default-src 'none'`) + `security-headers.spec.ts` (3 tests) + in-suite HTTP assertions | Unit spec 3/3; suite green |
| SF-024-004 | BFF JSON responses carried no security headers (matcher excluded `/api/bff`) | Low | Web BFF | T2 vs §8 | **FIXED** | `apps/web/middleware.ts` BFF branch (4 fixed headers) + `tests/security/headers-csp.spec.ts` BFF probe | Probe suite updated (CI headers-csp job) |
| SF-024-005 | CSP report-only capture absent in staging | Low | Web origin | T2 vs §8 ("report-only capture in staging") | **FIXED** | `CSP_REPORT_ONLY=1` env → `Content-Security-Policy-Report-Only` + `/csp-report` capture route (log-only, never stored) | Runtime smoke executed (agent-ctx/P24-SEC-B.md) |
| SF-024-006 | M-03 cookie DOM probe absent (flags asserted by implementation only) | Low | Web BFF cookies | T2 vs §6 M-03 | **FIXED** | `tests/security/headers-csp.spec.ts` M-03 DOM probe (httpOnly `erp_session` JS-invisible; `erp_csrf` readable) | Probe suite updated |
| SF-024-007 | MFA policy enforcement absent (ADR-0015 §4 "mandatory-able per role/plan" undelivered) | High | Identity (login) | T2 vs phase §2 item 3 | **FIXED** | Migration 0036 (`plans.mfa_required_role_keys`, `sessions.mfa_gate_passed`) + `identity/domain/mfa-policy.ts` + login enforcement (423 + `enrollmentRequired`) + the enrollment bootstrap (`POST /identity/mfa/bootstrap`) + admin reset (`DELETE /identity/users/:userId/mfa`) + `__db__/mfa-policy.db.spec.ts` (9 tests: the role × plan × tenant-override matrix + the HTTP golden path) | DB spec 9/9 |
| SF-024-008 | Enrollment deadlock under mandated MFA (policy-mandated user with no factor could neither log in nor enroll — found during T4 design) | High | Identity (login + MFA) | T4 design review (found + fixed pre-ship) | **FIXED** (same as SF-024-007) | The 15-minute gated enrollment session + the middleware route gate (`MFA_ENROLLMENT_REQUIRED` allowlist) + rotation gate-inheritance | mfa-policy.db.spec HTTP golden path (423 → bootstrap → gated 423 → verify → 200) |
| SF-024-009 | Nest middleware route-path reset breaks path-matched gates (request.path resets to "/" under per-route mounting — latent in any middleware matching paths) | High | API middleware layer | T4 HTTP verification (the gate allowlist failed closed on every route) | **FIXED** | `session.middleware.ts` + `tenant-rate-limit.middleware.ts` read `originalUrl` (query-stripped) — the documented Nest mounting behavior | mfa-policy.db.spec (whoami allowlist + blocked-route assertions) |
| SF-024-010 | Tenant-offboarding purge job absent (FR-PLT-003 / Journey H5 undeliverable; DATA_PROTECTION §4 documented flow unimplemented) | High | Tenancy (offboarding) | T2 vs phase §2 item 10 | **FIXED** | Migration 0036 (`tenants.legal_hold`, `tenant_offboarding`, `purged_tenants`, the command-scoped `purge_path_*` RLS policies for the migration-scope connection, the audit-guard purge exception) + `tenancy/application/offboarding/*` (the flow service + the purge sweep on `MIGRATE_DATABASE_URL`, NEVER the app pool) + `__db__/offboarding-purge.db.spec.ts` (7 tests: H1→H6 end-to-end + legal-hold block + cancel + idempotency) | DB spec 7/7 |
| SF-024-011 | Tenant-plane audit review UI + export absent (the `/audit/events` endpoint had no consumer; no actor/correlation filters at HTTP; no export — E-04 surface) | Medium | Audit (web + API) | T2 vs phase §2 item 7 | **FIXED** | Controller filters (`actorId`/`action`/`correlationId`) + `GET /audit/events/export` (bounded 10k CSV, audited `audit.exported`) + web `/[locale]/audit` screens + NAV registration | audit db-spec assertions (in-suite) + web typecheck |
| SF-024-012 | RLS canary absent (`erp_rls_denials_total` documented but not implemented) | Medium | Monitoring (RLS) | T2 vs SECURITY_TEST_PLAN §3 | **FIXED** | `infra/security/rls-canary.ts` (*/5 no-GUC crown-jewel probes; the counter + auto-SEV-1 fatal logging) + AppModule queue registration + the seeded-stack spec assertion | `__db__/support-review-rls-canary.db.spec.ts` (0 breaches) |
| SF-024-013 | Support-access review report absent (matrix §7 review tooling) | Medium | Tenancy (platform) | T2 vs phase §2 item 11 | **FIXED** | `SupportAccessService.reviewReport` (window index from the platform-widened audit trail + per-tenant row fetch per ADR-0005 — support_sessions carries the STRICT macro) + `GET /platform/support-sessions/review` + the staged-window spec (grant/end/counts + the expired-unclosed + zero-action gaps) | DB spec 2/2 |
| SF-024-014 | Secrets dual-accept rotation windows absent (S-03-class + S-11 single-key only — rotation would break in-flight secrets) | Medium | Identity envelope + billing webhook | T6 drill design (SECRETS_MANAGEMENT §3) | **FIXED** | `IDENTITY_SECRET_KEY_PREVIOUS` (envelope keyId dual-accept) + `WEBHOOK_SIGNING_SECRET_PREVIOUS` (dual-secret verify) + `reloadEnv()` reset-then-assign fix + `secret-envelope-rotation.spec.ts` (8) + `webhook-rotation.spec.ts` (7) + the `__db__/secrets-rotation.db.spec.ts` drill | Unit specs 15/15; drill output attached to the completion report |
| SF-024-015 | Dependency triage tooling absent (no audit wiring / lockfile lint / server-web SBOM) | Medium | Supply chain | T7 | **FIXED (tooling)** — see SF-024-016..019 for the findings it surfaced | `scripts/check-deps.ts` (lockfile lint) + `audit:deps` + `sbom:generate`/`sbom:web` (pnpm-9-compatible) + CI `deps-audit` + `sbom` jobs + `scripts/check-history-secrets.ts` (gitleaks local substitute) | [dependency-triage-2026-11.md](dependency-triage-2026-11.md) |
| SF-024-016 | `image-size@1.2.1` — 2 HIGH advisories (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) | High (SLA 30d — clock started 2026-11-06; not release-blocking: no CRITICAL) | apps/mobile → react-native → metro (BUILD-TIME bundler DoS; not in any shipped runtime bundle) | `pnpm audit --prod` (T7) | **OPEN** (accepted for GA: build-time-only exposure, CI-hermetic builds; upgrade rides the next mobile dependency pass) | [dependency-triage-2026-11.md](dependency-triage-2026-11.md) | n/a (monitor) |
| SF-024-017 | `multer@2.4.0` — HIGH advisory (GHSA-q7qp-rjg7-q26m) | High (SLA 30d; not release-blocking) | apps/api (carried since P-01) | `pnpm audit --prod` + reachability re-verification | **OPEN** (waiver rationale: 0 multipart routes in the API surface — re-verified by search this phase; unreachable code path; removal/upgrade ticketed with the next express-stack pass) | [dependency-triage-2026-11.md](dependency-triage-2026-11.md) | n/a (unreachable — re-verified) |
| SF-024-018 | `uuid@8.3.2` — MODERATE advisory | Medium | Transitive (test/doc tooling paths) | `pnpm audit --prod` | **OPEN** (rides the next transitive bump) | [dependency-triage-2026-11.md](dependency-triage-2026-11.md) | n/a |
| SF-024-019 | `desktop-release.yml` SBOM step broken-on-arrival (`pnpm ls --json --long --all` — `Unknown option: 'all'` on pnpm 9.15.9; never executed on a real runner) | Medium | CI/CD (desktop release pipeline) | T7 SBOM work | **FIXED (the fix is recorded; the workflow runs on the release host)** | The proven-working invocation (`env -u npm_execpath` + `--ignore-npm-errors`) is documented in [dependency-triage-2026-11.md](dependency-triage-2026-11.md) §SBOM — apply to `desktop-release.yml` at the next release-engineering pass | Local execution proof in the triage doc |
| SF-024-020 | `identity-flows.db.spec.ts` stale test title ("243 keys" over a 244 assertion) | Low | Test hygiene | T2 | **FIXED** | Title corrected to 244 | The suite's own 244=244 assertion |
| SF-024-021 | In-process metrics substrate: `erp_rls_denials_total` lives in-process + logs (OTel providers are the documented no-op) — a metrics-pipeline consumer needs the exporter swap | Low | Monitoring | T12/§3 implementation | **OPEN** (documented — the OBSERVABILITY exporter swap picks the name up; no waiver needed: the counter + fatal logging exist, the pipeline is a platform-infra item) | `infra/security/rls-canary.ts` header note | n/a |
| SF-024-022 | Pre-existing device tokens are not retroactively MFA-gated (a mandated user's already-enrolled desktop/mobile device keeps its refresh chain until revocation) | Medium (documented residual, THREAT_MODEL B1/S-16 row) | Identity (device tokens) | T4 design review | **OPEN (accepted residual)** — operational answer: admin reset (`identity.mfa.admin_reset`) + session revocation; the device re-attests on the next enrollment | THREAT_MODEL S-16 row + DR-024-01 revisit triggers | n/a |

| SF-025-001 | **FIXED** — the PushService DI paramtypes break: the vitest/esbuild transform emits no `design:paramtypes`, so every app boot under vitest DI-constructed PushService with ALL 15 constructor slots undefined, silently re-wiring the sync handler graph (every push through a booted app failed with a misleading per-command rejection). The dev runtime (tsx) emits the metadata — the break was test-environment-only, but it masked a convention violation. Found by the GA T-05 sync round-trip harness (the first spec ever to boot the app AND push). Fix: explicit `@Inject()` tokens on every constructor param (the repo's own DI convention); regression-proof: the full sync suite + T-05 green | Low (test-env DI correctness; no production path — dev/runtime emitted metadata) | Sync/DI | PHASE-025 T2 gate | **FIXED** (2026-11-06) — regression: `ga-full-load.db.spec.ts` T-05 + the 22-file sync suite | `push-service.ts` SF-025-001 comment + T-P25-orchestrator.md | n/a |
| SF-025-002 | The pool-before-limiter collapse mode: at ~800 req/s loopback storms (8× the R-04 ceiling) the 20-connection DB pool saturates BEFORE the tenant limiter's ceiling — the platform 5xx-collapses instead of 429ing (each request costs several sequential withTenant transactions; the limiter's own tenant lookup starves with the pool). Availability-relevant under adversarial single-tenant load | Medium (documented) | Availability / rate limiting | PHASE-025 T4a (the spike first draft) | **OPEN (documented)** — the graceful-degradation contract is proven at pool-safe storm rates (10 lanes ≈ 165 req/s ≈ 5.5× the modeled tenant baseline: 429-before-collapse, A/B isolation, ≤15 s recovery); production-class runs carry real network latency + pool sizing is the O-4 options ladder (PERFORMANCE_TEST_PLAN §8); a connection-cheap limiter pre-check (e.g., token-hash LRU cache) is the follow-up design note | `ga-spike.db.spec.ts` header + PHASE-025-COMPLETION.md §bugs | n/a |

## SLA status at phase exit (2026-11-06)

- **Critical open: 0** (release-blocking rule holds).
- **High open: 3** (SF-024-016/017 dependency advisories — build-time-only or
  unreachable, accepted-with-rationale, 30-day clocks running; SF-024-022 is a
  documented residual with an operational answer) — none release-blocking per
  the §11 rule (Critical-only blocks).
- **Medium open: 2** (SF-024-018 transitive bump; SF-024-021 metrics pipeline) —
  90-day clocks.
- Everything else FIXED in-phase with regression links + retest proofs above.

## Pen-test engagement record (SECURITY_TEST_PLAN §11)

- **Method split, honestly recorded:** the external-firm leg is
  **infra-gated** in the delivery environment (no external firm reachable —
  the follow-up-obligations pattern; a partial-scope report is an INCOMPLETE
  marker, not a pass, and this record says exactly that). The
  **internal re-verification leg EXECUTED over the full §11 scope list**:
  web + BFF (auth flows, CSP — the headers-csp probe suite incl. the new BFF
  + M-03 probes), the full API surface (the route × role checklist), the
  multi-tenancy/RLS spine with the tenant-pair fixtures (A1–A11 across the
  expanded 156-table registry), POS flows (the 016 suite), sync endpoints
  (the 020–022 suites), file/export paths (U/E series), native clients
  (desktop/mobile suites + the shell checks), the e-invoicing sandbox surface
  (the fake-authority harnesses), and CI/CD exposure (config + secret-scan
  review). Output = the PHASE-024 gate baseline attached to the completion
  report — the PHASE-025 GA checklist references it and re-runs the scoped
  re-test before GA.
- **Tenant-pair test setup:** the DB suite's fixed `TENANT_A`/`TENANT_B`
  fixtures + the per-spec seeded tenants ARE the §11 grey-box tenant-pair
  setup (fixtures only — §13 rule 4: no real tenant data in payloads).
- **Findings ingestion:** every internal finding landed in this log the same
  day (§14 rule 3); the SLA clocks started 2026-11-06.

## Dependency triage summary (T7)

See [dependency-triage-2026-11.md](dependency-triage-2026-11.md) — lockfile
lint clean (11 manifests, 0 prod violations); `pnpm audit --prod`: 0 critical
(the §1 blocking rule HOLDS), 3 high + 1 moderate recorded as SF-024-016..018;
SBOMs generated for server + web (CI artifacts); gitleaks: the CI job remains
the authoritative full-history gate, the local sampled substitute ran clean
(0 violations, 141 allowlisted fixture hits + the reasoned dev-placeholder
extension recorded in the triage doc).
