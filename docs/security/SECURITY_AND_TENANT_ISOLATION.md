# SECURITY_AND_TENANT_ISOLATION — Authorization, RLS, Tenant Context, and Security Testing

> **Status:** STABLE · **Owner:** Security Architecture · **Updated:** 2026-10-28 (consolidation pass)
> **Authority:** Consolidates the security model. Normative detail remains in
> [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md),
> [../architecture/SECURITY_ARCHITECTURE.md](../architecture/SECURITY_ARCHITECTURE.md),
> [THREAT_MODEL.md](THREAT_MODEL.md), [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md),
> [SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md), [DATA_PROTECTION.md](DATA_PROTECTION.md),
> [SECURITY_TEST_PLAN.md](SECURITY_TEST_PLAN.md), [../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md),
> [../testing/TENANT_ISOLATION_TESTS.md](../testing/TENANT_ISOLATION_TESTS.md).

## 1. The three-layer isolation model (release-blocking)

| Layer | Mechanism | Failure behavior |
|-------|-----------|------------------|
| 1. Application tenant context | From validated session (httpOnly cookie → session → tenant), never client input; `RequestContext` immutable; propagated via AsyncLocalStorage | No context → request rejected before any query |
| 2. SQL execution | Transaction-local `set_config('erp.tenant_id', $1, true)` on every transaction, including pooled connections and worker jobs | Missing/empty GUC → RLS matches zero rows (**fail closed**) |
| 3. PostgreSQL RLS | `FORCE ROW LEVEL SECURITY` + `USING`/`WITH CHECK` policies on every tenant-owned table; `erp_app` is not the table owner | Policy absence on a new tenant table = CI failure (catalog assertion) |

**Belt-and-braces:** composite tenant-scoped FKs (`UNIQUE (id, tenant_id)` parents) make
cross-tenant dangling references impossible even with RLS disabled
([../database/RELATIONSHIPS.md](../database/RELATIONSHIPS.md) §1). **Pooled connections are
safe by construction**: the GUC is transaction-local (not session-level), so PgBouncer
transaction-mode pooling cannot leak tenant context between checkouts.

## 2. Authorization model

- Roles → permissions → scope, evaluated server-side on every request; UI visibility is
  derived, never authorization ([AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md)).
- Permission keys: `module.resource.action`, module names matching
  [../architecture/MODULE_BOUNDARIES.md](../architecture/MODULE_BOUNDARIES.md) —
  **resource-table ownership governs the prefix** (DEF-007 resolution:
  `sales.receipts.*`, `purchasing.payments.*`; the treasury money-leg service keeps the
  feature key `treasury.receipts_disbursements`).
- Risky actions are approval-separated (creator ≠ approver, SoD), always audited;
  approval limits evaluated server-side; branch vs tenant scoping per key.
- Platform administrators have **no standing tenant-data route**; support access is
  time-boxed (≤ 4 h), tenant-approved where feasible, banner-visible to the tenant, and
  fully audited (`via_platform_admin` events) — [../architecture/SECURITY_ARCHITECTURE.md](../architecture/SECURITY_ARCHITECTURE.md) §support-access.

## 3. Privileged paths and leakage paths (review gate)

Every shipped feature must pass the **leakage-path checklist** (adopted from Folder 1,
[../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) leakage-paths section
for the original formulation):

- [ ] Files/objects: keys prefixed `t/{tenant_id}/…`, authorized on download, signed URLs scoped
- [ ] Exports/reports: generated under tenant context, never elevated
- [ ] Background jobs: carry and re-establish tenant context (RLS applies to workers)
- [ ] Caches: keyed with tenant id; no shared memoization across tenants
- [ ] Logs/metrics: tenant tag only, no PII/financial payloads
- [ ] Audit events: include tenant id; platform audit separated
- [ ] Backups/restore: tenant-aware restore drills

Cross-tenant API behavior: resources return **404, not 403** (anti-enumeration,
[../api/ERROR_MODEL.md](../api/ERROR_MODEL.md) §3).

## 4. Authentication

argon2id (params stored per-hash for forward upgrades), breached-password rejection,
no forced rotation; server-side sessions with rotation; TOTP MFA (required for privileged
roles); device tokens with registration/revocation; rate limiting + lockout;
login/refresh are **explicitly not idempotent-keyed**
([../api/IDEMPOTENCY.md](../api/IDEMPOTENCY.md) §1 rule 5 — consolidation DEF from Folder 2).
ADR: [../architecture/ADR/ADR-0015-authentication.md](../architecture/ADR/ADR-0015-authentication.md).

## 5. Threat model and secrets

STRIDE across 7 trust boundaries with 13 worked scenarios and residual ratings:
[THREAT_MODEL.md](THREAT_MODEL.md). Secrets inventory S-01…S-15 with rotation cadence;
ZATCA private keys are the HIGHEST class — signing-job-only access, never in dumps/exports;
leak response is revoke-first ([SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md)).
Any control without a linked test is treated as absent (binding review rule).

## 6. Security testing (release gates)

- **A1–A11 attack matrix** generated per tenant-owned table in CI: spoofed/missing GUC,
  mismatched INSERT, worker without context, signed-URL scope, etc.
  ([../testing/TENANT_ISOLATION_TESTS.md](../testing/TENANT_ISOLATION_TESTS.md)).
- Isolation battery runs **every phase**, against real PostgreSQL (RLS cannot be mocked).
- Production canary: `erp_rls_denials_total` must stay 0 — >0 is auto-SEV-1.
- Authorization-matrix ↔ permission-seed drift is a docs-drift CI check
  ([../testing/REGRESSION_STRATEGY.md](../testing/REGRESSION_STRATEGY.md) §6).
- Security test plan: [SECURITY_TEST_PLAN.md](SECURITY_TEST_PLAN.md); pen test at PHASE-024.

## 7. Incident response

Severity ladder + playbooks: [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md). Auto-SEV-1
triggers include RLS denials in production and **ledger/subledger reconciliation drift** —
financial-integrity incidents are handled with security-incident rigor.
