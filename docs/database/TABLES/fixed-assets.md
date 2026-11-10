# TABLES — Fixed-Assets Cluster (PHASE-026)

> **Status:** DELIVERED (PHASE-026, migration `0037_fixed_assets.sql`) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-07 · Column-level specs for
> the PHASE-026 cluster (asset categories, the asset register, monthly depreciation
> runs + their append-only lines, disposal documents, audited revaluations), authored
> in-phase per the file header rule (ENTITY_CATALOG §fixed_assets is the catalog-level
> map; this file is the column-level truth). ADR-0009 precision discipline throughout:
> money quanta `numeric(19,4)`, UoP usage `numeric(19,6)` — decimal strings on the
> wire, never floats, no `Math.*`. All tables are draft-lifecycle
> (SELECT/INSERT/UPDATE for `erp_app`; posted/terminal immutability is service
> discipline + status↔stamped-columns shape CHECKs) **except** `depreciation_lines`
> which is append-only 🔒 by grants (SELECT/INSERT — the `journal_lines`/`stock_moves`
> INV-003 pattern) with the `erp.depreciation_lines_guard()` trigger as the
> defense-in-depth layer. RLS macro on every table; the isolation registry covers
> each (A1–A10). No table here writes `journal_*` — every posting flows through the
> centralized posting engine (ADR-0007; sources `FIXED_ASSET_CAPITALIZATION` G-21,
> `DEPRECIATION_RUN` G-22, `ASSET_DISPOSAL` G-23, `ASSET_REVALUATION`).

## §asset_categories — the BR-041 purpose-binding registry (T2)

One row per tenant-scoped natural key `code` (§12 codes; immutable — the store takes
no code patch). Bilingual `name`/`name_ar` pair (§3). Category defaults
`useful_life_months_default` (CHECK 1..1200) + `depreciation_method_default` (CHECK
`STRAIGHT_LINE|DECLINING_BALANCE|UNITS_OF_PRODUCTION` — DATA_DICTIONARY §9) apply to
NEW assets only; live assets keep their frozen columns. The three purpose links
`asset_purpose_key` · `accum_depreciation_purpose_key` · `expense_purpose_key`
(defaults `FIXED_ASSET`/`ACCUM_DEPRECIATION`/`DEPRECIATION_EXPENSE`, overridable to
more specific keys) carry the shape CHECK `^[A-Z][A-Z0-9_]{2,40}$`. **BR-041** is
service-enforced at create/update and re-checked at first asset use + every posting
(a category whose three purposes do not all resolve to ACTIVE accounts is UNUSABLE —
`CATEGORY_NOT_USABLE`, bilingual, names every missing key). `active` deactivation
retires a category for new use; deletion is NOT offered anywhere (INV-015 — the
in-use guard is service-level). Constraints: `uq_asset_categories_tenant_code`,
`uq_asset_categories_id_tenant`. Index: `ix_asset_categories_tenant_active`.

## §assets — the register (T3)

One row per tenant-scoped `code`. Economic columns are IMMUTABLE after creation
(service-enforced — corrections are revaluation (BR-044) or disposal (G-23)
documents, never register edits): `acquisition_date`, `cost` (19,4; CHECK ≥ 0),
`salvage_value` (CHECK `0 ≤ salvage ≤ cost` — the INV-023 floor), `opening_accumulated`
(CHECK `0 ≤ opening ≤ cost − salvage`; the opening-variant accumulated-to-date —
DATA_DICTIONARY §14), `useful_life_months` (CHECK 1..1200), `depreciation_method`
(§9 enum; per-asset override of the category default), `total_estimated_units`
(19,6 NULL; CHECK required > 0 iff UNITS_OF_PRODUCTION). Composite FKs:
`category_id` → asset_categories, `branch_id` → branches (both `(id, tenant_id)`
RESTRICT); `custodian_user_id` → users (SET NULL — membership-scoped at the service:
a foreign-tenant user 404s like an unknown one, A7). `status` CHECK
`ACTIVE|FULLY_DEPRECIATED|DISPOSED|WRITTEN_OFF` (§9 `asset_status`; the machine —
disposal locks DISPOSED exactly once from ACTIVE/FULLY_DEPRECIATED, INV-023);
`source_type`/`source_id` bind the capitalization journal (G-21) or the purchasing
document chain; `disposed_at`/`written_off_at` stamps. Constraints:
`uq_assets_tenant_code`, `uq_assets_id_tenant`. Indexes:
`ix_assets_tenant_cat_status_branch` (the listing surface),
`ix_assets_tenant_custodian`, `ix_assets_tenant_source`.

## §depreciation_runs — monthly batches, ONE per (tenant, fiscal period) (T6/T7)

`fiscal_period_id` composite FK → fiscal_periods (RESTRICT) + the one-run-per-period
dedupe `uq_depreciation_runs_tenant_period` (BR-042 — a second assembly after the
run POSTS is the typed 409 `DEPRECIATION_RUN_PERIOD_TAKEN`; a DRAFT re-assembles in
place). `status` CHECK `DRAFT|POSTED` (§9 `depreciation_run_status`); totals
`asset_count`/`total_amount` (CHECK ≥ 0). Job/post stamps: `assembly_job_id` (the
bounded pg-boss job, ADR-0008), `assembled_at`/`assembled_by`, `posted_at`/`posted_by`,
`journal_entry_id` (the G-22 entry); the INV-014 reversal side
`reversal_journal_entry_id`/`reversed_at`/`reversal_reason` (the run KEEPS status
POSTED after reversal — the append-only lines stay for audit). Posting is explicit
and period-locked (LOCKED period → `PERIOD_LOCKED`, INV-011). Index:
`ix_depreciation_runs_tenant_status`.

## §depreciation_lines 🔒 — the append-only per-asset history (T6)

One line per (run, asset): `uq_depreciation_lines_run_asset`; `line_no` (CHECK ≥ 1);
`period_units` (19,6 NULL — the manual UNITS_OF_PRODUCTION usage, DR-002 no
metering); `period_amount` (19,4 CHECK **> 0** — an asset computing to 0.0000 is
excluded and listed, never a zero line); `accumulated_amount` (19,4 CHECK ≥ 0 — the
asset's running accumulated AFTER the line; the NBV-floor proof chain).
Composite FKs → depreciation_runs + assets (RESTRICT). **Grants give `erp_app`
SELECT/INSERT only**; the `trg_depreciation_lines_guard` trigger (BEFORE UPDATE OR
DELETE) blocks everyone except the offboarding purge path (`erp.purge_mode` — the
0036 audit-guard exception shape; even then only `erp_migrate` holds the DELETE
policy). DRAFT re-assembly is the single sanctioned reset: the service replaces the
whole DRAFT's lines in one transaction (never a per-line rewrite). Index:
`ix_depreciation_lines_tenant_asset` (the as-of schedule source).

## §asset_disposals — SALE/SCRAP documents (T9)

`asset_id` composite FK → assets (RESTRICT). `disposal_no` is the official number
from the numbering service (INV-021/ADR-0006; format `DSP-{YYYY}-{SEQ:6}`, assigned
at POST, bound via `numbering.bind`); the tenant-scoped uniqueness is the PARTIAL
unique index `uq_asset_disposals_tenant_no` `(tenant_id, disposal_no) WHERE
disposal_no IS NOT NULL` (NULL while DRAFT — partial uniques are indexes, never
table constraints). `kind` CHECK `SALE|SCRAP` (§9 `disposal_kind`); `proceeds`
(19,4 CHECK ≥ 0 — a REQUIRED explicit field: a zero-proceeds SCRAP is entered as "0"
on purpose, a SALE must carry > 0). The frozen disposal snapshots (§14):
`net_book_value`, `accumulated_snapshot` (CHECK ≥ 0 both), `gain_loss = proceeds −
NBV` — immutable after post; the G-23 legs derive from them. `status` CHECK
`DRAFT|POSTED`; the §4 SoD pair `approved_by`/`approved_at` (creator ≠ approver,
service-enforced `SELF_APPROVAL_BLOCKED` backstop + audited; POST refuses an
unapproved disposal with `DISPOSAL_NOT_APPROVED`); `posted_at`/`posted_by`/
`journal_entry_id`. Disposal is exactly-once per asset (INV-023): ANY existing
disposal row — DRAFT or POSTED, no rejected state exists — blocks with
`DISPOSED_ASSET_REUSE`, and posting locks the asset `DISPOSED` + `disposed_at`.
Indexes: `ix_asset_disposals_tenant_asset`, `ix_asset_disposals_tenant_status_date`.

## §asset_revaluations — audited basis restatements (T8, BR-044)

`asset_id` composite FK → assets (RESTRICT). The revaluation basis (§14):
`revaluation_date` (date — §11), `new_gross_value` (CHECK > 0), `new_accumulated`
(CHECK ≥ 0), with the basis shape CHECK `new_gross − new_accumulated ≥ 0`; `delta`
(19,4) is FROZEN at DRAFT from the then-live NBV and never rewritten (the store
exposes no delta patch) — the POST journal derives the old side from the frozen
delta so the row and the journal agree by construction. `status` CHECK
`DRAFT|POSTED`; `reason` text NOT NULL CHECK length 1..500 (BR-044 audited — the
mandatory narrative); `posted_at`/`posted_by`/`journal_entry_id`. One live DRAFT per
asset (service-enforced `REVALUATION_DRAFT_EXISTS`); revaluation on a
DISPOSED/WRITTEN_OFF asset is rejected (`ASSET_STATUS_INVALID` — INV-023 terminal
states). The NBV delta posts to `REVALUATION_RESERVE` — never P&L, both directions.
Index: `ix_asset_revaluations_tenant_asset`.

## RLS, the purge path & the CoA markers (0037)

- **RLS**: `erp.apply_tenant_policy` on all six tables (the house macro — FORCE RLS,
  `tenant_isolation` USING/WITH CHECK on `erp.current_tenant_id()`), each registered
  in the isolation suite's table registry with generated A1–A10 coverage; the A3
  mismatched-INSERT shapes for all six and the append-only grant proof for
  `depreciation_lines` ride in the same generated suite.
- **Purge path (the 0036 discipline)**: `purge_path_delete`/`purge_path_update`
  policies for `erp_migrate` confined to the GUC-named tenant on every new table
  (idempotent drop+create) — the offboarding sweep only, never the app plane.
- **RC-10 widening**: `reconciliation_runs.kind` CHECK widened with `FIXED_ASSETS`
  (the 0012 BANK_REC precedent) so the fixed-assets register check registers in the
  PHASE-007 framework (BROKEN → notification + PC-04 close block).
- **CoA template markers (§11 of the migration)**: `1210 FIXED_ASSET` (existing row,
  purpose added), `1220 ACCUM_DEPRECIATION` (new contra-asset leaf), `3210
  REVALUATION_RESERVE` (equity), `4910 ASSET_DISPOSAL_GAIN` (revenue), `5300
  DEPRECIATION_EXPENSE` (existing row, purpose added), `5910 ASSET_DISPOSAL_LOSS`
  (expense) — the onboarding instantiation copies them + their purposes into every
  provisioned tenant (existing tenants map via `account_purposes`, fail-closed
  `PURPOSE_NOT_MAPPED`).

## Grants & roles (migration 0037)

`SELECT, INSERT, UPDATE` for `erp_app` on `asset_categories`, `assets`,
`depreciation_runs`, `asset_disposals`, `asset_revaluations` (status-lifecycled —
no tombstone deletes; deactivation is the category delete, disposals are
documents); `SELECT, INSERT` ONLY on `depreciation_lines` (append-only 🔒 — grants
+ guard trigger; the sole DELETE caller is the purge path under `erp.purge_mode`).
`SELECT` for `erp_readonly` + `erp_definer` on all six. Permission seeds
(AUTHORIZATION_MATRIX §3.11 — 13 keys, drift-checked): `fixed_assets.categories.manage`,
`fixed_assets.assets.view|create|manage`, `fixed_assets.depreciation_runs.view|run|post`,
`fixed_assets.revaluations.create|post`, `fixed_assets.disposals.create|approve|post`,
`fixed_assets.reports.view`; grants owner=13, accountant=11 (everything except
`revaluations.post` + `disposals.approve`), viewer=3. Plan grants: the seven §19
feature keys join business + enterprise (starter does NOT get them).
