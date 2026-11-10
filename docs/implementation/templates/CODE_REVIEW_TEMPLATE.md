# Code Review Template

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-27

Checklist for every PR. A reviewer (human or AI) works top-down; any ✋ item blocks
merge until resolved or explicitly waived with a decision record.

## 1. Scope & phase alignment

- [ ] Changes map 1:1 to the phase document's tasks; nothing extra
- [ ] No future-phase features smuggled in ("while I'm here" = reject)
- [ ] Docs that the changes affect are updated in the same PR

## 2. Architecture & boundaries

- [ ] Module boundary rules respected ([../architecture/DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md)) — CI green
- [ ] No cross-module table access; only published service surfaces used
- [ ] Layering respected (domain has no framework imports)
- [ ] Any architectural deviation has an ADR/decision record linked

## 3. Database

- [ ] Naming/conventions pass ([../database/DATABASE_CONVENTIONS.md](../../database/DATABASE_CONVENTIONS.md))
- [ ] Every new tenant-owned table: `tenant_id`, RLS policy, composite tenant FKs, indexes
- [ ] Migration review: locking risk, backfill batching, expand-contract respected
- [ ] No destructive contract steps without release gating
- [ ] Money/quantity types exact (`numeric(19,4)` / `(19,6)`); no float anywhere
- [ ] Entity catalog + TABLES + ERD updated for schema changes

## 4. Accounting correctness (if touching financial flows)

- [ ] All ledger writes go through the posting engine — grep-verified
- [ ] Posting rule implemented matches the canonical map ([../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4)
- [ ] Expected-journal tests present for every new posting operation (success + failure)
- [ ] Invariant tests: relevant INV-xxx covered; run green
- [ ] Posted-data immutability respected (no UPDATE/DELETE paths)

## 5. Security

- [ ] Permission checks on every new route (matrix updated if new permissions)
- [ ] Tenant context from session only; no client-supplied tenant trust
- [ ] New public endpoints rate-limited; validation schemas (zod) at the edge
- [ ] No secrets/PII in logs; redaction serializer respected
- [ ] Attack tests added for new tables/paths ([../testing/TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md))
- [ ] File/upload paths: size/type limits, tenant-scoped keys, signed URLs

## 6. API & contracts

- [ ] `packages/contracts` schemas updated; OpenAPI regenerated; no breaking change without versioning
- [ ] Idempotency keys honored on writes; If-Match concurrency on mutations
- [ ] Error envelope + stable codes ([../api/ERROR_MODEL.md](../../api/ERROR_MODEL.md))

## 7. UI / i18n / a11y

- [ ] Only catalog components used; no ad-hoc design ([../ui/COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md))
- [ ] Strings in both AR + EN (CI key-parity check); RTL-correct via logical properties
- [ ] Keyboard operable; focus states; a11y assertions pass
- [ ] Visual snapshots (AR + EN) updated intentionally, not rubber-stamped

## 8. Testing & quality

- [ ] Tests fail-first proven (or justified); failure cases included, not just happy paths
- [ ] No test skips/TODOs; deterministic (no flaky sleeps)
- [ ] Lint/typecheck clean; no `any` in domain code; no money math outside decimal utils

## 9. Observability & operations

- [ ] New jobs have alerting + runbook notes
- [ ] Correlation IDs propagate; new dashboards/alerts linked

## 10. Verdict

- [ ] **Approve** / Request changes / Reject — with reasons referencing checklist items
