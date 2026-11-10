# PHASE-026 Master Plan — Fixed Assets & Depreciation

> Phase doc: `docs/implementation/phases/PHASE-026.md` (T1–T14) · Decision authority:
> `docs/decisions/accounting/DR-002-fixed-assets.md` (option A). GA is shipped
> (PHASE-025); expansion never reopens the GA gate (EXPANSION_REGISTER ED-01).

## Non-negotiable constraints

1. **Engine monopoly (ADR-0007)**: fixed_assets NEVER writes GL tables — every
   posting is `PostingEngine.post` with source types `FIXED_ASSET_CAPITALIZATION`
   (G-21), `DEPRECIATION_RUN` (G-22), `ASSET_DISPOSAL` (G-23), `ASSET_REVALUATION`
   (POSTING_ENGINE §4.1 registrations). INV-013 idempotency via
   `(tenant, source_type, source_id, operation)`.
2. **INV-023 (new, this phase)**: Σ depreciation ≤ cost − salvage per asset;
   NBV ≥ 0 always; disposal exactly once, only from ACTIVE/FULLY_DEPRECIATED;
   final-period residual absorption makes Σ = cost − salvage exactly (property
   tests, half-up per ADR-0009).
3. **Math.* ban**: percentages/rates are raw floats or decimal strings; window
   math uses domain-core precedents (rate.ts/precision.ts).
4. **Embedded-PG exclusivity**: ONE db-suite run at a time. Subagents are
   FORBIDDEN from `test:db` / any embedded-PG boot. The orchestrator runs the
   DB gate serially. (Subagents verify with `typecheck` + unit `vitest run` on
   NON-db specs only.)
5. **Append-only 🔒**: depreciation_lines — SELECT/INSERT grants + the
   `erp.depreciation_lines_guard` trigger (already in migration 0037). The
   store MUST NOT expose update/delete for it.
6. **Catalog drift**: migration 0037 + schema.ts mirror already landed
   (verified: 6 tables, 18 RLS policies incl. purge_path, 13 permissions,
   6 CoA purposes 1210/1220/3210/4910/5300/5910, plans business+enterprise,
   roles owner=13/accountant=11/viewer=3, guard trigger, grants). FEATURE_DEPS
   + FEATURE_CATALOG §19 + AUTHORIZATION_MATRIX §3.11 + ENTITY_CATALOG
   fixed_assets section were pre-authored with Blueprint v2.0 — DO NOT
   duplicate-register; only fill gaps (SECURITY_TEST_PLAN §2 row,
   RECONCILIATION §1 row 10 deferred→PHASE-026, PERIOD_CLOSING §2 advisory).
7. **Honest split**: nothing fabricated; anything unverifiable here is marked
   with the evidence gap, never silently passed.

## Migration facts (0037_fixed_assets.sql — LANDED + VERIFIED)

- Tables: `asset_categories`, `assets`, `depreciation_runs`,
  `depreciation_lines` 🔒, `asset_disposals`, `asset_revaluations`.
- Key constraints: `uq_asset_categories_tenant_code`, `uq_assets_tenant_code`,
  `uq_depreciation_runs_tenant_period` (one run per period — the 409 dedupe),
  `uq_depreciation_lines_run_asset`, partial unique INDEX
  `uq_asset_disposals_tenant_no WHERE disposal_no IS NOT NULL` (42P10 lesson:
  partial uniques are indexes, never table constraints).
- `assets.opening_accumulated` carries the opening-variant accumulated-to-date;
  NBV = cost − opening_accumulated − Σ(lines of non-reversed POSTED runs).
- `assets` CHECKs: salvage ≤ cost; opening_accumulated ≤ cost − salvage;
  UoP ⇒ total_estimated_units > 0.
- runs carry `assembly_job_id` (pg-boss), `journal_entry_id`,
  `reversal_journal_entry_id`/`reversed_at` (INV-014 reversal; lines stay).
- disposals carry frozen `net_book_value`/`accumulated_snapshot`/`gain_loss`,
  SoD `approved_by/approved_at`, official `disposal_no` (numbering service).
- revaluations carry `new_gross_value`/`new_accumulated`/`delta` + mandatory
  `reason` (BR-044 audited).
- CoA template rows: 1210 FIXED_ASSET, 1220 ACCUM_DEPRECIATION,
  3210 REVALUATION_RESERVE, 4910 ASSET_DISPOSAL_GAIN, 5300 DEPRECIATION_EXPENSE,
  5910 ASSET_DISPOSAL_LOSS — onboarding instantiates them for new tenants.
- Permission seeds: 13 keys §3.11 (categories.manage; assets.view/create/manage;
  depreciation_runs.view/run/post; revaluations.create/post; disposals.create/
  approve/post; reports.view). Grants: owner=13, accountant=11 (everything
  except revaluations.post + disposals.approve), viewer=3.

## Task split

| Task ID | Owner | Phase tasks | Deliverables |
|---|---|---|---|
| **P26-0** (done) | orchestrator | T1 + substrate | migration 0037 + journal + schema.ts mirror + verification (above) |
| **P26-A** (CORE) | subagent | T2, T3, T4, T5 | module scaffolding (module/store/errors/controller), category-service (BR-041), asset-service (status machine, NBV), capitalization-service (G-21 credit/cash/opening), purchase-capitalization hook (GRN capital-expense flag), acquisition chain fixture |
| **P26-B** (DEPR) | subagent | T6, T7 | depreciation-service (3 methods, salvage floor, final-period residual, one-run-per-period), depreciation-assembly.job (ADR-0008 bounded), run-service (G-22 post + INV-014 reverse, period-locked), INV-023 property suite (fast-check) |
| **P26-C** (LIFE) | subagent | T8, T9, T10 | revaluation-service (BR-044, reserve journal both directions), disposal-service (G-23 + loss mirror, SoD second-user approval, asset lock), RC-10 reconciliation registration + period-close advisory |
| **P26-D** (REPORTS) | subagent | T11 | 3 report contracts (asset-register, depreciation-schedule, movements) + fa-cost-tie/fa-accum-tie block-on-fail assertions + as-of determinism |
| **P26-E** (WEB) | subagent | T13 | 6 archetype screens + i18n AR/EN + NAV item + baselines |
| **P26-F** (DOCS) | subagent | T12 suites wiring + T14 | isolation attack suite (A1–A10 ×6 tables, S-04 foreign refs → typed 404), fixed-assets-rules.spec (BR-041..044), docs sync (SECURITY_TEST_PLAN row, RECONCILIATION row 10, PERIOD_CLOSING §2, JOURNAL_RULES §7 already pre-authored — verify, ACCOUNTING_TESTS suites, BUSINESS_WORKFLOWS §11, SCOPE ED-18) |
| **P26-ORCH** | orchestrator | gate + closure | module registration in app, golden suites G-21/22/23 verification, serial gate (typecheck/lint/unit/DB suite/drift/docs), completion report, IMPLEMENTATION_STATUS, CURRENT_SHIPPED_PHASE 025→026, commit, ZIP, delivery page |

## Gate sequence (serial, orchestrator-only)

1. `pnpm -r typecheck` + root lint (fast feedback).
2. DB suite (chunked foreground): the full suite + new fixed-assets specs.
3. Drift battery: `docs:validate`, `check:permissions-drift`, `check:rls`,
   `check:capabilities-matrix`, `check:i18n-parity`, `lint:depcruise`,
   `check:deps`, unit suites (api/web/desktop/mobile).
4. Docs finalization + completion report + commit + ZIP.

## Inter-agent contracts (write these FIRST in each service file)

- Store functions live in `fixed_assets/infrastructure/fixed-assets.store.ts`
  (P26-A owns the file start; P26-B/C APPEND clearly-delimited sections —
  never rewrite each other's functions).
- Services are plain classes/functions (Nest providers) taking deps via
  constructor; the posting engine port is
  `accounting/application/posting-service.ts` (PostingService.post/reverse).
- Purpose resolution: read `account_purposes` via the coa-service helpers;
  fail closed with `PURPOSE_NOT_MAPPED` (engine taxonomy) — BR-041 checks at
  create/update AND first asset use AND every posting.
- Money: decimal strings, 19,4; half-up rounding via
  `@erp/domain-core` precision helpers; NO Math.*.
- Idempotency keys: `fa:cap:{assetId}`, `dep:run:{runId}`, `fa:disp:{disposalId}`,
  `fa:rev:{revaluationId}` per source/operation.
- NBV read model: `Σ posted lines (run POSTED, reversed_at IS NULL) +
  opening_accumulated` — exposed as store helpers
  `assetAccumulated(assetId)` / `assetNbv(assetId)` used by B/C/D equally.

## Honest markers (decided up front)

- The 10k-asset assembly bounded-job proof runs at sandbox scale (local
  embedded tier); production-class wall-time is the standing infra-gated
  pattern (PHASE-025 waiver discipline).
- Pre-existing finding to record (SF-026-001 candidate): the offboarding
  purge deletes guarded tables (journal_lines, stock_moves,
  depreciation_lines…) — the 024 drill passed on a journal-less tenant; a
  tenant WITH journal rows would hit the INV-003 triggers. Our guard admits
  purge_mode DELETE; the older ones do not. Recorded in the completion
  report as a pre-existing gap with the named follow-up (not phase-blocking:
  the purge path is documented migration-scope tooling).
- T-03-style hosted legs: none here (no new hosting surface).
