# T23-DOCS — PHASE-016 documentation set (T14)

**Task ID:** T23-DOCS (PHASE-016 T14 — template activation flip was already shipped by
the implementation tasks; this session delivered the full documentation/handoff set).
Docs + `agent-ctx/` only — NO code, packages, or migration files were touched.

## Context

PHASE-016 (Point of Sale) was implemented in code (migration `0024_pos_core.sql`, the
`pos` + narrow `sync` modules, `PosSaleService`, `packages/sync-core`, the web POS
group). This session updated every document the phase's §8 "Completion and Handoff"
requires, following each file's living-document conventions (read first, then edit).

## Files changed by this session (all docs)

| File | Change |
| --- | --- |
| `docs/product/FEATURE_CATALOG.md` | §16: `pos.table_service` + `pos.kitchen_display` rows (the former intake keys, with deps + `pos.sales.sell`); §16 intro marks the module DELIVERED; header reconciliation note updated to the shipped `pos.*` permission set (+ the reused `sales.pos_session.*`) |
| `docs/security/AUTHORIZATION_MATRIX.md` | §3.8 heading + the four `pos.*` rows (owner/cashier, tenant/branch(terminal)/branch, risky no) + the POS note (migration 0024 seeds, `sales.pos_session.*` reuse, `DEVICE_REVOKED`); §1 module list gains `pos`; §2 cashier summary gains the `pos.*` keys |
| `docs/database/ENTITY_CATALOG.md` | `pos_terminals`/`pos_tables`/`pos_checks`/`pos_kitchen_tickets` rows (016, RLS); the stale `pos_sales` row removed (POS sales ARE `sales_invoices` channel='POS'; POS shifts ARE `cashier_shifts`); `sales_invoices` + `cashier_shifts` columns updated; `change_log`/`sync_cursors` → "016 (POS subset) / 020 (generalized)"; `devices` → "003 (schema) / 016 (pos-terminal slice) / 020 (generalized)" |
| `docs/database/TABLES/trade-sales.md` | NEW "POS core" section (0024 brief specs: the 4 tables, the widenings, the sync slice, the `CARD_RECEIVABLE` marker, grants); header + the `offline_receipt_no` note updated (live since 016) |
| `docs/database/ERD/trade-inventory.md` | pos relationships + attribute blocks (`pos_terminals`/`pos_tables`/`pos_checks`/`pos_kitchen_tickets`); `sales_invoices` block gains channel/terminal/tenders; header phases + date |
| `docs/offline/OFFLINE_CAPABILITIES_MATRIX.md` | rows #1–#5, #8, #23, #31, #32, #33, #35 marked ✓ (POS-terminal portion IMPLEMENTED 2026-11-02) + the §1 legend bullet; header date |
| `docs/offline/SYNC_PROTOCOL.md` | §11 "SHIPPED 2026-11-02 (PHASE-016)" note (narrow slice live, same wire contracts, the three recorded deviations with DR links); header date |
| `docs/decisions/DR-016-01-pos-web-outbox-bridge.md` | NEW — localStorage bridge vs the SQLite store (PHASE-021 reconciliation) |
| `docs/decisions/DR-016-02-card-receivable-mapping.md` | NEW — tenant-mapped `CARD_RECEIVABLE`, fail-closed `PURPOSE_NOT_MAPPED` |
| `docs/decisions/DR-016-03-pos-device-transport.md` | NEW — devices on the identity table with session transport (PHASE-020 reconciliation) |
| `docs/decisions/README.md` | §2 index note for root-level phase-scoped deviation records |
| `docs/planning/IMPLEMENTATION_STATUS.md` | PHASE-016 → COMPLETE (2026-11-02, the full row per the 015 format + the completion-report link); current-state line → 001..016 |
| `docs/handoff/NEXT_ACTION.md` | rewritten → PHASE-017 (automotive & distribution; `sales.job_cards` intake first); "Why now: PHASE-016 is COMPLETE"; waived-evidence list unchanged; Do NOT gains the PHASE-016 frozen-substrate entry |
| `docs/handoff/CURRENT_STATE.md` | app-code bullet → 001..016 (MVP + configuration engine + POS); the `pos`+`sync` module paragraph; the web POS group; `packages/sync-core` bullet + the contracts sync-schema note; status-of-world Implemented list + a PHASE-016 paragraph |
| `docs/handoff/CHANGELOG.md` | PHASE-016 entry at the top (migration, module, service, sync slice, web, reports, activation, DRs, test evidence) |
| `docs/reporting/REPORT_CATALOG.md` | §8 "Shipped (PHASE-016)" table (the 3 POS contracts with perms/params/assertions) + the §13 phase-matrix PHASE-016 row + the honest catalogued-vs-registered note |
| `docs/industries/README.md` + `docs/industries/templates/README.md` | the §4 gate-lifted note (POS entries resolve live) + the phase-map delivered marker |
| `docs/industries/reports/README.md` | the two restaurant analytics rows marked "catalogued; not in the shipped 016 registry set" (verified against the code registry — only 3 contracts registered) |
| `docs/implementation/phases/PHASE-016.md` | status header PLANNED → COMPLETE |
| `docs/implementation/phases/reports/PHASE-016-COMPLETION.md` | NEW — mirrors the PHASE-015 report structure (summary/invariants, the 10 acceptance rows with pointers, the capabilities-matrix ✓ row quote, files, migration, API/UI, test results, the 3 deviations, honest limitations, docs list, rollback, release note, next eligible) |
| `agent-ctx/T23-DOCS-phase-016-docs.md` | this record |

## Verification

- `python3 scripts/validate_docs.py` → **29/29 PASS** (re-run after every change).
- `pnpm check:permissions-drift` → **now reports 4 keys IN MATRIX BUT NOT SEEDED
  (matrix 231 vs seed 227)** — this is a pre-existing checker limitation surfaced by
  the (required) matrix update, NOT a doc error: the checker reads only
  `0004_permissions_seed.sql` while the four `pos.*` keys are seeded by
  `0024_pos_core.sql` (verified by reading both migrations). Matrix 231 = the seed
  union 0004 (227) + 0024 (4). The checker (and its unit spec
  `permissions-drift.spec.ts`, which asserts docs↔0004 parity) must be taught to read
  the union of permission-seeding migrations — a code-side follow-up recorded in the
  completion report §Known limitations #1, outside this docs task's mandate
  (docs/agent-ctx only). The task instruction's claim that 0004 already seeds the
  four keys is inaccurate — only 0024 does; the doc now matches the real seeds.

## Notes for the next agent

1. Fix the drift checker scope (union of permission-seeding migrations, or backfill
   0004) and add the `pos.*` grants to the cashier/owner role templates (0005 predates
   them) — then re-run `pnpm check:permissions-drift` + the api unit suite; the
   completion report's Known limitations #1–#3 record the exact state.
2. PHASE-017 is next (identify only): read the PHASE-016 completion report first;
   register `sales.job_cards` into FEATURE_CATALOG via the §25 protocol before any
   job-card work.
3. PHASE-020 starts from SYNC_PROTOCOL §11 + the three DR-016 records and must accept
   a PHASE-016 terminal on day one.
