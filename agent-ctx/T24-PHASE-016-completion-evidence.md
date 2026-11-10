# T24 — PHASE-016 completion evidence (implementation + gate verification)

> **Status:** COMPLETE · **Date:** 2026-11-02 · **Owner:** PHASE-016 delivery run

## What this record covers

The code-side completion of PHASE-016 (Point of Sale) beyond the T23 docs
task: the follow-up fixes surfaced by the full gate runs, and the final
verified evidence for every gate in `scripts/ci/local-gate.sh`.

## Follow-up fixes delivered in this run

1. **Migration 0024 corrections** (pre-release, same-phase edit — the
   archive is the first carrier):
   - `ALTER TABLE "sales_invoices" DROP CONSTRAINT` gained its table
     prefix (the embedded-PG migrate run caught the syntax error).
   - `devices` **lost** the `tenant_id` column: check-rls demands a
     tenant policy on every table bearing `tenant_id`, and devices is
     service-mediated by design (PHASE-003 §4) — the pos-terminal slice
     binds tenant through the terminal (`DR-016-03` records the posture).
   - Plan grants + system role-template grants: business/enterprise plans
     gain `pos.table_service`/`pos.kitchen_display`/`items.composite_products`
     (array_cat, idempotent); the cashier template gains
     pos.sales.sell/pos.shifts.manage/pos.receipts.print; owner gains
     pos.terminals.manage + the set + sync.devices.revoke.
   - Grants split: `change_log` is APPEND-ONLY (SELECT+INSERT — the
     journal_lines pattern); `pos_tables` carries DELETE (the floor plan
     is editable); the rest SELECT/INSERT/UPDATE.
2. **BR-005 policy-actor audit FK (latent bug surfaced by the POS goldens)**:
   the autopost path passed `POLICY_ACTOR_ID` into audit records whose
   `actor_id` FKs to `users` — the sentinel is now a document-column
   marker only (approved_by/posted_by), never an audit actor (the audit
   service maps it to "no human actor" at the boundary; DOCUMENT_LIFECYCLE
   §2 rule 1 honored: approved_by = sentinel ≠ posted_by = the cashier).
3. **`ck_sales_invoices_posted_shape`**: system/offline postings carry the
   policy sentinel as posted_by (never NULL).
4. **`TERMINAL_COLUMNS` bug**: the pos store's SELECT list missed `t.id` —
   every terminal-scoped invoice column (pos_terminal_id) silently
   NULLed; the offline-replay golden caught it via the (terminal, OFF-)
   dedupe probe.
5. **Permissions drift checker** now reads the UNION of permission-seeding
   migrations (0004 + 0024): matrix 231 = seed 231.
6. **PHASE-015→016 test transitions** (pinned expectations):
   tables.registry +6 POS tables (+ A1–A10 isolation fixtures incl. the
   change_log entity_id probe override + append-only A4 posture);
   permissions 227→231; report contracts 53→56; onboarding/provisioning
   42/16→43/17 accounts/purposes; template-apply/degraded-entitlement/
   config-resolution phase-gates → LIVE; golden effective-config pins
   regenerated (10); gl-perf plan proofs hardened (bitmap variant +
   enable_seqscan=off for the EXPLAIN session — documented rationale).
7. **POS return path**: credit notes against cash invoices are standalone
   by shape (outstanding 0 — the tenant enables the documented
   `sales.credit_note_standalone_allowed` policy); the G-04 mirror posts
   AR_CONTROL CR + the separate `credit_note:reentry` journal at original
   cost (W-3).

## Final verified evidence (all gates)

| Gate | Result |
|------|--------|
| `pnpm typecheck` (turbo, 6 packages) | 6/6 successful |
| `pnpm lint` (incl. module boundaries) | 6/6 successful |
| `pnpm lint:depcruise` | ✔ no violations (844 modules, 5236 deps) |
| `pnpm check:permissions-drift` | OK — matrix 231 = seed 231 |
| `pnpm test` (unit + property, 5 packages) | 5/5 successful — API 257/25 files; sync-core 8/8 (chaos slice C-01/03/04/07/09/16 + numbering + state honesty) |
| `pnpm validate:manifests` | OK — 3 manifests |
| `pnpm test:db` (embedded PG16, full) | **79 files / 1255 tests ALL PASS** — incl. POS goldens 5/5, migrations+RLS 7/7, isolation A1–A10 705/705 with the POS cluster |
| `pnpm check:token-contrast` | all §16 pairs pass the AA floor |
| `pnpm check:i18n-parity` | ar=2030 = en=2030 |
| `pnpm docs:validate` | 29/29 checks |
| `pnpm boundary:negative-test` | PASS (boundary enforcement active) |
| `pnpm boundary:negative-ui-test` | all four rules fail their fixtures |
| `pnpm boundary:negative-i18n-test` | parity checker fails its drifting fixture |
| web (from T10) | tsc 0 errors · lint 0 errors |

Not run here (standing waived/hosted obligations, unchanged): hosted CI,
`test:visual-harness-run` (storybook), `test:web-security` (needs a web
build) — carried exactly as NEXT_ACTION §Follow-up obligations records
them; the web tsc/lint/parity gates above ran green in T10.

## Files touched in this run (code-side, after T23)

- `apps/api/migrations/0024_pos_core.sql` (corrections above)
- `apps/api/src/infra/db/migrations.ts` (+0024 manifest)
- `apps/api/src/modules/audit/application/audit.service.ts` (sentinel guard)
- `apps/api/src/modules/sales/application/invoices.ts` (autopost actor)
- `apps/api/src/modules/sales/application/pos-channel/pos-sale-service.ts`
- `apps/api/src/modules/pos/infrastructure/pos.store.ts` (t.id)
- `apps/api/src/modules/identity/infrastructure/permissions-drift.ts` (+spec)
- `apps/api/src/db/schema.ts` (devices column drop)
- `apps/api/src/modules/sales/infrastructure/sales.store.ts` (INVOICE_COLUMNS + id + offline find)
- `apps/api/src/__db__/`: pos/golden.spec.ts (new), isolation (registry+fixtures), tenancy-http, tenancy-provisioning, identity-flows, reporting/golden, accounting/gl-perf, configuration (template-apply, degraded-entitlement, config-resolution, golden pins, layer-fixtures)
- `packages/sync-core/src/**` (adapter/parser fixes from the chaos debugging)
- `docs/implementation/phases/reports/PHASE-016-COMPLETION.md` (evidence refresh)
