# Security Test Plan

> **Status:** STABLE · **Owner:** Security Architecture & Quality Engineering · **Updated:** 2026-11-07

The security testing program, phase-mapped. Security is CI-gated from PHASE-001 — not a
PHASE-024 afterthought; PHASE-024 hardens what earlier phases built and adds external
(pen-test) validation. Companion documents: [THREAT_MODEL.md](THREAT_MODEL.md) (what we
defend), [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md) (what we enforce),
[../testing/TENANT_ISOLATION_TESTS.md](../testing/TENANT_ISOLATION_TESTS.md) (attack suite
detail), [../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) (general test
architecture).

## 1. Per-phase security gates (every phase, from PHASE-001)

| Gate | Tool/approach | Phase start | Frequency | Blocking? |
|------|---------------|-------------|-----------|-----------|
| Dependency audit | `pnpm audit` (or equivalent) + lockfile lint (no `*` ranges on prod deps) | PHASE-001 | every push | Yes — no known-critical in prod deps |
| Secrets scan | gitleaks (diff + full-history weekly) | PHASE-001 | every push | Yes |
| SAST | static analysis with security rules (injection, unsafe crypto, prototype pollution) | PHASE-001 | every push | Yes on new findings |
| Tenant-isolation attack suite | A1–A11 matrix + new-table expansion ([../testing/TENANT_ISOLATION_TESTS.md](../testing/TENANT_ISOLATION_TESTS.md)) | PHASE-002 (harness) / PHASE-003 (first full run) | every push | Yes |
| Permission tests per route | matrix-driven generated checklist (§4) | PHASE-003 | every push | Yes |
| Rate-limit tests on new public endpoints | §5 | PHASE-003 | every push | Yes |
| Migration safety | RLS policy + tenant FK catalog assertions on every new table | PHASE-002 | every push | Yes |
| Image scan | container/OS + manifest scan | PHASE-002 | build + weekly | Yes (critical) |
| Upload security | §7 | PHASE-002/006 | every push | Yes |
| Headers/CSP verification | §8 | PHASE-005 | every push | Yes |
| Export leakage | §9 | PHASE-013 | every push | Yes |
| Device/offline security | §10 | PHASE-020–022 | every push | Yes |
| Pen test (external) | §11 | PHASE-024 | per release tier | Yes for open findings within SLA |

Phase exit requires the applicable gates green; evidence goes in the phase completion
report ([../planning/PHASE_ACCEPTANCE_CRITERIA.md](../planning/PHASE_ACCEPTANCE_CRITERIA.md)).

## 2. Tenant-isolation attack suite (the spine of the program)

- **Source of truth**: matrix A1–A11 in
  [../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) §5; test
  specifications (given/when/then) in
  [../testing/TENANT_ISOLATION_TESTS.md](../testing/TENANT_ISOLATION_TESTS.md).
- **Per-phase expansion rule**: every new tenant-owned table ships with the full attack
  set applied to it — enforced by the phase checklist + a CI catalog query asserting every
  `tenant_id`-bearing table has RLS `USING`+`WITH CHECK` policies, `FORCE RLS`, and
  composite tenant FKs.
- **API-level scenarios per module phase** (in addition to the SQL-level A1–A10):

| Phase | API spoofing scenarios added |
|-------|------------------------------|
| PHASE-003 | session/membership routes: membership switch attempts, session fixation, `tenant_id` in body |
| PHASE-004 | provisioning: register→suspend→restore state machine abuse; entitlement escalation attempts |
| PHASE-006 | partners/items: cross-tenant partner-id references in documents; import row spoofing |
| PHASE-007 | accounting: journal `accountId` from another tenant (→ 404 not 403); period of another tenant |
| PHASE-008 | treasury: receipt referencing foreign invoice id; allocation to foreign documents |
| PHASE-009 | tax: tax-code/rate id enumeration cross-tenant |
| PHASE-010 | inventory: foreign warehouse/item ids in transfers and counts |
| PHASE-011 | purchasing: GRN→supplier-invoice cross-tenant chain breaks |
| PHASE-012 | sales: delivery/invoice chain with foreign order id; receipt allocation to foreign invoice |
| PHASE-013 | reporting: report run with foreign branch filter; export of foreign run id (A11) |
| PHASE-016 | POS: terminal of branch X issuing for branch Y |
| PHASE-020+ | sync: device of tenant A pushing commands referencing tenant B entities (→ rejection, no effects) |
| PHASE-026 | fixed assets: asset create with foreign `category_id`/`branch_id`/`custodian_user_id` (custodian is membership-scoped — a foreign-tenant user 404s like an unknown one); disposal/revaluation drafted on a foreign `asset_id`; a depreciation run assembled against a foreign `fiscal_period_id` — typed 404 rejection (`ASSET_CATEGORY_NOT_FOUND`/`BRANCH_NOT_FOUND`/`USER_NOT_FOUND`/`ASSET_NOT_FOUND`/`PERIOD_NOT_FOUND`), zero partial creation (S-04; A7) — the six tables also enter the A1–A10 isolation registry (incl. the append-only `depreciation_lines` grant proof) |
| PHASE-027 | notes & installments: note create with a foreign `partner_id`/invoice id (`PARTNER_NOT_FOUND`/`NOTE_SOURCE_INVALID`); endorse/dishonor/discount/collect/return on a foreign note id (`NOTE_NOT_FOUND` — incl. the asymmetric-dishonor probe: a foreign dishonor NEVER restores a foreign AR item); a plan referencing a foreign invoice/contract id (`PLAN_SOURCE_INVALID`); waive/charge-late-fee on a foreign line (`LINE_NOT_FOUND`) — typed 404 rejection, zero partial creation (S-04; A7 unknown-vs-foreign parity) — the four tables also enter the A1–A10 isolation registry (incl. the append-only `note_events` grant proof; `installment_lines` carries DELETE for the draft-plan edit path only) |
| PHASE-028 | budgeting: budget create with a foreign `fiscal_year_id` (`FISCAL_YEAR_NOT_FOUND`); grid lines carrying a foreign `fiscal_period_id` (`BUDGET_PERIOD_MISMATCH` — RLS renders it out-of-year), a foreign `account_id` (`ACCOUNT_NOT_FOUND`), or a foreign `cost_center_id`/`project_id`/`branch_id` (`COST_CENTER_NOT_FOUND`/`PROJECT_NOT_FOUND`/`BRANCH_NOT_FOUND` — typed 404s); a foreign budget id reads as 404 exactly like an unknown one (A7 parity) — typed rejection, zero partial creation (S-04) — the two tables also enter the A1–A10 isolation registry (`budget_lines` carries DELETE for the DRAFT bulk-replace path only; `budgets` never) |

All cross-tenant id enumeration MUST return **404** (no existence leak — A7).

## 3. RLS denial monitoring assertion

Part of the test plan AND production monitoring: a synthetic canary job runs known-bad
queries (as `erp_app`, no GUC) in every environment and asserts 0 rows; production metric
`erp_rls_denials_total` must stay 0 — alert on > 0 and investigate immediately
(RISK-010; [../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md) business
SLO set).

## 4. Permission tests per route (matrix-driven)

- The route registry is generated from code + `packages/contracts`; the expected
  permission is declared per route; CI generates a checklist:
  **route × role-template (from [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md)) →
  expect 200/2xx or 403**, plus for risky routes: expect audit event on success and
  403-with-audit on denial.
- Scenarios per route class:
  1. Anonymous → 401.
  2. Authenticated, no permission (e.g., `cashier` → `accounting.journal_entries.post`) → 403 + audit.
  3. Authenticated, permission, wrong branch scope → 403.
  4. Authenticated, permission, other tenant's entity id → 404 (A7).
  5. Approval-limit boundary: amount at limit (pass), limit + 0.01 (fail with
     `APPROVAL_LIMIT_EXCEEDED`) when the route carries a limit.
  6. SoD: same user creates + attempts approve with `allow_self_approval=false` → denied;
     with policy on → allowed + flagged in audit.
- Drift checks: permissions seed vs. [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md)
  catalog (docs-drift test,
  [../testing/REGRESSION_STRATEGY.md](../testing/REGRESSION_STRATEGY.md) §6).

## 5. Rate limiting & lockout tests (PHASE-003+)

| # | Scenario | Expected |
|---|----------|----------|
| R-01 | N rapid failed logins for one user (per-IP limit untouched) | progressive delays → temporary lock; never permanent without admin; login notification email sent |
| R-02 | Distributed failed logins across IPs for one user | per-user lockout triggers regardless of IP spread |
| R-03 | Credential-stuff spray across many users from one IP | per-IP limit → 429 with Retry-After; audit trail records |
| R-04 | Per-tenant API burst above plan quota | 429s, no effect on other tenants (isolation of throttle), quota headers correct |
| R-05 | Password-reset email request flood | per-account + per-IP limits; no email bombing |
| R-06 | Sync endpoint hammering with invalid device token | cheap rejection (no DB-heavy path) before rate limit |
| R-07 | Lockout bypass attempts: login via API vs BFF vs password reset | same counters across surfaces |
| R-08 | Rate-limit headers/session fixations | limits not resettable by toggling headers/case; stable under IPv6 rotation |

## 6. Session / MFA abuse tests

| # | Scenario | Expected |
|---|----------|----------|
| M-01 | Idle timeout: no request for 30 min | session invalid; re-auth required |
| M-02 | Absolute timeout 12h regardless of activity | invalidation at 12h |
| M-03 | Cookie flags on every response | httpOnly, Secure, SameSite=Lax; no token readable from JS (assert via DOM probe) |
| M-04 | Session rotation on login/membership switch | old session id dead after rotation (fixation test) |
| M-05 | Reused refresh token (device) | replay detected → device token chain revoked |
| M-06 | TOTP: replay of same code within window | rejected (one-time use) |
| M-07 | Recovery code use + reuse | single-use; regenerates set; audit |
| M-08 | Password reset link: reuse + expired + different account | single-use, short-lived, bound to account |
| M-09 | Tenant suspension mid-session | next request fails; device push rejected (`tenant_suspended`) |
| M-10 | Session revocation by owner for another user | target session dead immediately |

## 7. Upload security tests (PHASE-002 files module; PHASE-006 attachments UX)

| # | Scenario | Expected |
|---|----------|----------|
| U-01 | Content-type/extension allow-list (images, PDF, XLSX/CSV) | rejects executables, HTML (stored-XSS via file), SVG with scripts unless sanitized |
| U-02 | Magic-byte verification vs. claimed type | mismatch → reject |
| U-03 | Size limits per plan + total quota | 413 + quota accounting |
| U-04 | Upload path tenant binding | object key includes tenant id; A11 cross-tenant fetch test |
| U-05 | Signed URL scope + expiry | URL valid only for the issued tenant + object + method; expired URL → 403/404 |
| U-06 | Filename sanitization | no path traversal, no control chars, Unicode-safe (Arabic filenames preserved safely) |
| U-07 | Zip-bomb / decompression guard on import flows (CSV/XLSX) | bounded rows/cells; job fails cleanly |

## 8. Secure headers & CSP verification (PHASE-005)

Asserted per environment by an automated probe (not just manually): `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`,
`Referrer-Policy`, CSP with `default-src 'self'`, no `unsafe-inline` scripts (hashed or
nonce'd), `object-src 'none'`, SRI on any third-party asset, and CSP report-only capture
in staging. Bidi/Arabic content tests include RTL spoofing payloads
([THREAT_MODEL.md](THREAT_MODEL.md) S-03).

## 9. Report / export leakage tests (PHASE-013)

| # | Scenario | Expected |
|---|----------|----------|
| E-01 | Export run of tenant A, fetch attempt with tenant B session | 404/403; no object access (A11) |
| E-02 | Signed export URL after expiry | rejected |
| E-03 | Report parameters referencing foreign branch/partner ids | empty or 404 — never foreign rows |
| E-04 | Export audit events | every run/export/download audited with actor + object |
| E-05 | DLP-lite: oversized export attempts | rate-limited + alert |
| E-06 | Print template injection (fields rendering as markup) | escaped output; template preview can't execute |

## 10. Offline & device security tests (PHASE-020–022)

| # | Scenario | Expected |
|---|----------|----------|
| D-01 | Device revocation → immediate push/pull stop | pushes rejected `DEVICE_REVOKED`; pulls return revocation; queued local data wiped on next contact |
| D-02 | Local DB encryption at rest | SQLite file unreadable without keychain key (binary inspection test) |
| D-03 | Tampered SQLite rows pushed to server | server re-validation rejects (stock/price/period checks); per-item results; no partial ledger effects (INV-013/018) |
| D-04 | Offline permission snapshot expiry | after window, device requires re-auth/sync; actions refused |
| D-05 | Clock skew on device | server-authoritative times; stale timestamps rejected/normalized |
| D-06 | Desktop auto-update signature | unsigned/old update rejected (min-version enforcement) |
| D-07 | Android tampered build / rooted-device policy | attestation where configured; degraded mode documented |
| D-08 | Sync chaos suite green | [../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md) full matrix at PHASE-020 |

## 11. Penetration testing (PHASE-024; repeated per major release tier)

| Item | Detail |
|------|--------|
| Scope | Web app + BFF (auth flows, CSP), full API surface (all modules shipped by then), **multi-tenancy/RLS** (with a tenant-pair test setup), POS flows, sync endpoints, file/export paths, desktop + Android clients, e-invoicing adapter surface (sandbox), CI/CD exposure |
| Method | External firm (first pen test) + internal re-runs; grey-box with a valid tenant account per tester |
| Cadence | PHASE-024 full scope; re-test before GA (PHASE-025) and after each major release tier (v2.x, GA); scoped re-tests after significant new surfaces (e-invoicing go-live) |
| Findings severity | aligned with [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) ladder: Critical/High map SEV-1/2 process; fix SLAs below |
| Fix SLA | Critical: 7 days (release-blocking) · High: 30 days · Medium: 90 days · Low: next release; waivers only via decision record |
| Retest | every fixed finding gets a retest proof (§12) + a regression test where automatable |

## 12. Bug bounty consideration (post-GA)

Private bug-bounty program is a **post-GA decision** (decision record required — scope,
payouts, safe-harbor rules, who triages). Prerequisite: the public surface is pen-tested
and the incident process has handled at least one real security report drill. Until then:
security@ contact with a published disclosure policy (part of PHASE-024 compliance review).

## 13. Evidence format

1. **Findings log** (repo-tracked, `docs/operations/security-findings.md` at
   implementation): id, title, severity, affected surface, discovery source (gate/pen
   test/monitoring), status (open/fixed/waived), links to fix PR + regression test.
2. **Retest proof**: for each fixed finding — command/test run output, environment,
   date, tester (human or CI job id); automated findings link the CI run permalink.
3. **Gate evidence per phase**: which gates ran, pass/fail, and links — attached to the
   phase completion report template
   ([../implementation/templates/COMPLETION_REPORT_TEMPLATE.md](../implementation/templates/COMPLETION_REPORT_TEMPLATE.md)).
4. Never record exploit payloads containing real tenant data; test tenants only
   (fixture discipline: [../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) §test-data).

## 14. Maintenance protocol

1. New route/table/module ⇒ extend §2/§4 in the same phase (phase checklist item).
2. New incident/postmortem with a security cause ⇒ new automated test in the matching
   section (regression named after the ticket).
3. Pen-test report ingested ⇒ findings log rows created same day; SLA clock starts.
4. Quarterly review: which gates are still relevant, which sections lack automation.
