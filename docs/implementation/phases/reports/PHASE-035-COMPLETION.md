# Completion Report — PHASE-035

> **Status:** COMPLETE · **Updated:** 2026-11-10
>
> **Errata 2026-11-13 (post-closure audit):** the isolation/RLS figures originally
> announced here as **1,095/1,095** (and the derived fresh-chain-critical total
> **1,145**) were a miscount — the true 035-era count is **1,086** (the identity
> A-suite 178 registry tables × 6 generated `it()` blocks + 6 fixed = 1,074, plus
> platform-isolation 12), re-run verified against this phase's code commit
> (embedded PG16 + that tree's migration chain: 1,086/1,086, exit 0 —
> [the gate-evidence ledger](../../../operations/gate-evidence/2026-11-13-post044-audit-fixes.md) §7).
> The +24 delta for the four 0041 consolidation tables was and remains correct
> (4 × 6); the corrected fresh-chain-critical total is 7+11+4+6+22+1,086 = **1,136**.

## Phase ID / Date

PHASE-035 — Activation & Truth Restoration (Blueprint v3.0, wave 1 / stage 12,
register CR-05 — **the v3.0 program's entry phase**) · 2026-11-10

## Summary

Blueprint v3.0's entry phase closed the audit's activation defects and restored
the documentation truth ledger. Migration `0048` (DATA-ONLY, the 0042/0043/0047
grant convention) grants `items.import_export` to business + enterprise
(EVAL-F-5 / H-18) — schema_version 48, permissions drift 245=245. Three
activation screens shipped over existing APIs (EVAL-F-1/F-2):
`/inventory/batches` and `/inventory/serials` (List+Search with register +
write-off / sold-at actions under `inventory.tracking.manage`) and the
read-only `/inventory/adjustments` register (posting stays in the count wizard
by design); `reports.consolidated` became a core NAV_ITEMS entry (EVAL-F-3) so
template-less tenants see القوائم الموحدة; web i18n 4,290=4,290 (mobile
371=371). The `tax.e-invoicing-log` contract (EVAL-F-6) took the registry
85 → 86 with REPORT_CATALOG reconciled 86/86 (7 unlisted rows added, the
`sales.commissions_due` duplicate removed), permission riding
`tax.einvoicing.manage` (the §12 module-register convention). Three silent
deviations resolved as DR-035-01/02/03 (EVAL-F-7/8/9). Repository hygiene
untracked 251 generated files (`.gitignore` + the `ci-visual.yml` guard).
Twelve pre-existing 034-tree gate defects were repaired and recorded. All
gates green. Next: PHASE-036.

## Files created

**Database**

- `apps/api/migrations/0048_items_import_export_grant.sql` (42 lines) — the
  DATA-ONLY plan grant (see §Database migrations).

**API — tests**

- `apps/api/src/__db__/reporting/einvoicing-log.spec.ts` (156 lines, 4 tests)
  — the §6 criterion-5 DB spec (render over the real registry, status filter,
  created_at window, permission denial before params bind).

**Web** (`apps/web/`)

- `app/[locale]/inventory/batches/page.tsx` (78) ·
  `app/[locale]/inventory/serials/page.tsx` (76) ·
  `app/[locale]/inventory/adjustments/page.tsx` (76) — the three server
  components (AppShell pattern, server-side fetch, fallback crumbs).
- `components/inventory-batches.tsx` (338) · `components/inventory-serials.tsx`
  (333) · `components/inventory-adjustments.tsx` (193) — the List+Search
  client components (AR/EN, RTL, loading/empty states; register + write-off /
  sold-at actions under `inventory.tracking.manage` in batches/serials;
  adjustments strictly read-only).

**Docs & records**

- `docs/decisions/product/DR-035-01-scheduled-reports.md` ·
  `docs/decisions/product/DR-035-02-customer-portal.md` ·
  `docs/decisions/product/DR-035-03-platform-payouts.md` — the three
  silent-deviation resolution records (T-07).
- `docs/implementation/phases/reports/PHASE-035-COMPLETION.md` (this file).

## Files changed

- `apps/api/migrations/meta/_journal.json` + `apps/api/src/infra/db/migrations.ts`
  + `migrations.spec.ts` — the 0048 registration (journal 47 → 48; **also the
  pre-existing repair**: the manifest was missing the 0047 row — see the
  ledger below).
- `apps/api/src/modules/reporting/registry/index.ts` — `tax.e-invoicing-log`
  appended (registry 85 → 86).
- `apps/api/src/modules/reporting/registry/operational/treasury-tax-platform.ts`
  (+113) — the `taxEInvoicingLogContract` (`defineReport`, zod params
  status/adapter/created_at window, bilingual title سجل الفوترة
  الإلكترونية / E-Invoicing Submission Log, no GL tie — submissions precede
  posting, so INV-012 does not apply).
- `apps/api/src/modules/tax/application/tax-queries.ts` (+61) —
  `TaxQueriesService.submissionLog` (the module-owned query surface per
  ADR-0011); `apps/api/src/modules/tax/submissions/store.ts` (+6) — the
  `created_at` window filter.
- `apps/api/src/modules/reporting/reporting.module.ts` — the tax query wiring.
- `packages/contracts/src/navigation.ts` (+69) — the three inventory NAV_ITEMS
  rows + the `reports.consolidated` core row (route `/consolidation`,
  `consolidation.reports` capability + `consolidation.reports.view`).
- `apps/web/components/app-shell.tsx` (+6) — the fallback crumbs for the new
  inventory surfaces.
- `apps/web/i18n/dictionaries.ts` (+214) — the three screens' AR/EN keys
  (4,186 → 4,290, triple parity).
- `apps/web/components/marketing-landing.tsx` · `consolidation-group-detail.tsx`
  · `consolidation-runs.tsx` — typecheck/lint repairs from the 034 tree.
- `.gitignore` + `.github/workflows/ci-visual.yml` + `README.md` +
  `docs/ui/VISUAL_TESTING.md` — the repository-hygiene set (T-10).
- `docs/decisions/product/README.md` · `docs/product/FEATURE_CATALOG.md` ·
  `docs/product/SUBSCRIPTION_AND_ENTITLEMENTS.md` ·
  `docs/reporting/REPORT_CATALOG.md` — the DR links + the catalog
  reconciliation (T-07/T-08).
- The truth-refreshed planning/handoff docs (T-09):
  `docs/planning/IMPLEMENTATION_STATUS.md`, `docs/handoff/NEXT_ACTION.md`,
  `docs/handoff/CURRENT_STATE.md`, `docs/handoff/CHANGELOG.md`,
  `docs/handoff/IMPLEMENTATION_PROTOCOL.md`, `docs/ui/NAVIGATION_MODEL.md`.
- The pre-existing 034-tree gate repairs (see the dedicated ledger below):
  `apps/api/migrations/0041_consolidation.sql`,
  `apps/api/src/__db__/consolidation/*` (fixtures, g32, inv-026, br-056,
  isolation), `apps/api/src/__db__/isolation/tables.registry.ts` +
  `identity-isolation.db.spec.ts`, `apps/api/src/__db__/reporting/golden.spec.ts`
  + `fixtures.ts` + `industry-018/019.spec.ts`, the consolidation module
  (`elimination-service.ts`, `run-service.ts`, `reader-service.ts`,
  `controller`), its unit suites (`snapshot.spec.ts`,
  `consolidation-contracts.spec.ts`, `consolidation-math.spec.ts`,
  `reporting-unit.spec.ts`, `report-pack-wiring.spec.ts`),
  `packages/contracts/src/index.ts`, and
  `apps/api/src/modules/configuration/__tests__/capability-matrix-reconciliation.spec.ts`.

## Pre-existing gate repairs (recorded)

Defects inherited from the restored/delivered 034 tree — found by this phase's
gate runs, fixed in-phase, each marked `PHASE-035 gate repair (recorded)` in a
code comment at the fix site (the honest ledger; none are 035 scope):

1. **`RENTAL_LOGISTICS_TEMPLATE_MANIFEST` index re-export** —
   `packages/contracts/src/index.ts`: the delivery-completion's thirteenth
   template exported it from `industry/templates` but missed the index
   re-export the manifests test imports (typecheck + contracts suite red on
   the clean tree).
2. **21 typecheck errors** across the consolidation/restored code
   (`snapshot.spec.ts` array-literal widening, `inv-026` structural casts,
   `marketing-landing`, `consolidation-group-detail/-runs`, the
   `StoredRateRow → StoredRate` seam in `run-service.ts`, …) — typecheck now
   8/8 packages.
3. **The MIGRATIONS manifest missing 0047** — `migrations.ts`/`migrations.spec.ts`
   (the rental_logistics migration was never registered; fresh chains stopped
   at 46).
4. **The capability-matrix RNT stale assertion** —
   `configuration/__tests__/capability-matrix-reconciliation.spec.ts` still
   asserted the RNT column undefined and `industry.rental_logistics`
   un-shipped; corrected to the delivered truth (13/13).
5. **The 0041 fresh-chain boot defect** — `migrations/0041_consolidation.sql`:
   `erp_consolidation_reader` lacked `CREATE` on schema `erp` (its definer
   functions need it on a fresh chain) — `GRANT USAGE, CREATE` per the 0003
   `erp_definer` precedent.
6. **The `include_from` run semantics bug** — `run-service.ts`: members whose
   window starts after the run period errored the pre-check instead of being
   excluded (both the pre-check and the extract pass now skip out-of-window
   members).
7. **The elimination posting INV-009 defect** — `elimination-service.ts`:
   AR/AP control lines carried no partner, so the posting engine rejected
   every elimination; now resolve-or-create the parent-side intercompany
   partner per member line (`IC-<tenant-prefix>`, kind BOTH, idempotent).
8. **The consolidation fixtures' order-dependence** — `fixtures.ts`: the USD
   member referenced a `US` country row no seed carries (idempotent inactive
   fixture row added) and the run/translation specs asserted over member GL
   the fixture never seeded (one balanced November journal per member added).
9. **The isolation registry missing the four 0041 tables** —
   `__db__/isolation/tables.registry.ts` (+ `identity-isolation.db.spec.ts`):
   the A-suite's negative proof extended +24 rows; isolation + RLS now
   1,086/1,086 (errata-corrected 2026-11-13; originally announced 1,095).
10. **The inv-026 spec's cash account typo (1110 → 1111) and the missing
    `purge_mode` SET** — the tamper lever needs `SET erp.purge_mode = 'on'`
    to mutate the sealed snapshot (RESET after).
11. **The `snapshot.spec` regex lint** — the `no-regex-spaces` rule (`{2}`
    quantifier) + the `SnapshotMemberMeta` annotation.
12. **The g32 spec's missing `withTenant` wraps and period-status ordering** —
    the spec must post while November is OPEN (`setPeriodStatus`), wrapped in
    owner-tenant scope.

## Database migrations

- `0048_items_import_export_grant.sql` — DATA-ONLY (schema_version 48, journal
  idx 47 → 48): `items.import_export` → business + enterprise via the guarded
  `array_cat` upsert (the 0042/0043/0047 convention); starter keeps the
  manual-entry flow (the tier-4 precedent); BR-040 closure
  (`items.item_master` + `partners.directory`) already satisfied by the 0008
  seeds; `erp._schema_state` marker updated; zero tables/columns/enums/
  journals/permission keys (INV-022; drift stays 245=245).

## API changes

- No new routes. `TaxQueriesService.submissionLog` + the submissions store's
  `created_at` window filter feed the new report contract; the reporting
  module wires the query surface. All existing inventory endpoints
  (`GET/POST /inventory/batches`, `/serials`, the adjustment journal reads)
  are consumed as-is — the audit's "API exists, screen missing" finding
  confirmed exactly.

## UI changes

- Three List+Search screens (§2 archetype) under المخزون — batches (order 90),
  serials (order 100), adjustments (order 110, read-only) — plus
  `reports.consolidated` as a core item under التقارير (order 15). Register +
  write-off / sold-at actions inside batches/serials run under
  `inventory.tracking.manage`; adjustments adds no posting path (the count
  wizard remains the only adjustment posting surface — design intent
  documented in NAVIGATION_MODEL §1.2/§9). AR/EN parity + RTL via the
  standard dictionary + AppShell patterns; 4,290=4,290 keys.

## Security changes

- No new permission keys; no new tables. The nav rows ride existing granted
  capabilities (`inventory.batch_tracking` / `serial_tracking` /
  `stock_ledger`) + seeded permissions (`inventory.moves.view`,
  `inventory.stock.view`), resolved server-side by `resolveNavigation`
  (featureKey AND permission — the §2 resolution rule; behavior-tested in
  `packages/ui` `behavior.test.ts`). The report contract's permission rides
  the module's existing `tax.einvoicing.manage` (the §12 module-register
  convention — the catalog's documented `reports.tax.einvoice-log.read` never
  existed as a seed; corrected). The permission-denial leg is asserted before
  params bind (einvoicing-log spec test 4).

## Tests executed

Sandbox/harness commands (the repo's canonical scripts; DB suites on the
embedded PostgreSQL 16 fresh chain 0001→0048):

| Suite | Command | Result |
|-------|---------|--------|
| Typecheck | `pnpm typecheck` | **8/8 packages** green (incl. the 21 repaired errors) |
| Lint | `pnpm lint` | **8/8 packages** green (incl. the snapshot.spec regex repair) |
| API unit | `pnpm --filter @erp/api test` | **474/474** |
| Web unit | `pnpm --filter @erp/web test` | **73** green |
| Contracts | `pnpm --filter @erp/contracts test` | **56** green |
| UI | `pnpm --filter @erp/ui test` | **42** green (incl. resolveNavigation gating) |
| Desktop | `pnpm --filter @erp/desktop test` | **274** green |
| Mobile | `pnpm --filter @erp/mobile test` | **393** green |
| sync-core / domain-core | `pnpm --filter @erp/sync-core test` · `--filter @erp/domain-core test` | **36** · **38** green |
| i18n parity (web/mobile) | `pnpm check:i18n-parity` · `check:mobile-i18n` | **4,290=4,290** · **371=371** |
| Permissions drift | `pnpm check:permissions-drift` | **OK — matrix 245, seed 245** |
| Docs validation | `pnpm docs:validate` | **32/32** |
| Manifests | `pnpm validate:manifests` | **13/13** |
| DB — migrations | migrations.db.spec fresh apply + regression | **7/7** (fresh 0001→0048; regression no-op) |
| DB — entitlements | `__db__/entitlements.db.spec.ts` | **11/11** (BR-040 closure per seeded plan incl. the new grant) |
| DB — einvoicing-log | `__db__/reporting/einvoicing-log.spec.ts` | **4/4** |
| DB — reporting golden | `__db__/reporting/golden.spec.ts` | **6/6** (the 86-contract pin) |
| DB — consolidation | `__db__/consolidation/**` | **22/22** (G-32, INV-026, BR-056, FX, isolation) |
| DB — isolation + RLS | the generated A-suite + RLS suites | **1,086/1,086** (incl. +24 rows for the 0041 tables; errata-corrected 2026-11-13 — originally announced 1,095) |
| Boundaries | `pnpm lint:depcruise` | **0 violations** |
| Catalog/capabilities/observability/tokens/history-secrets | `check:*` scripts | all green |

Unit total **1,386**; DB fresh-chain-critical total **1,136** (7+11+4+6+22+1,086 — errata-corrected 2026-11-13; originally announced 1,145 on the 1,095 miscount).

## Invariants covered

- **INV-022** (no config/entitlement alters posting rules or isolation): the
  0048 grant is plan data only — no code path; `entitlements.db.spec` 11/11
  asserts BR-040 closure per seeded plan.
- **INV-009** (subledger consistency): the elimination-posting repair makes
  every AR/AP control line carry its intercompany partner; the g32/inv-026 DB
  suites re-assert the chain end-to-end.
- **INV-012** (append-only tax summaries): intentionally NOT asserted by the
  new contract — submissions precede posting; the spec's status-vocabulary
  assertion covers the state machine instead.
- **INV-013/INV-003** (idempotency/immutability): re-verified by the
  consolidation + golden suites post-repair.

## Acceptance criteria verification

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 6.1 | 0048 applies cleanly; `items.import_export` on business+enterprise; `/inventory/import` visible for those plans | PASS | migrations.db.spec fresh apply **7/7** (0001→0048) + regression no-op; entitlements.db.spec **11/11** (grant materialized, BR-040 closure). The nav item `items.import_export` (featureKey + `items.import.run`) now resolves for granted plans — `resolveNavigation` gating is behavior-tested (`packages/ui` behavior.test.ts, 42 green). Honest note: the browser-level Playwright sidebar assertion was not run in this environment (no live web+api stack); visibility follows from the granted featureKey + the registry resolution rule, the same mechanism every shipped nav item rides. |
| 6.2 | `/inventory/batches` + `/inventory/serials` render with AR/EN parity, RTL, loading/empty states; create/cancel flows post against the live API; nav entries respect gating | PASS | The screens + components (files above) follow the proven server-fetch + AppShell pattern; typecheck 8/8 + web unit 73 + i18n 4,290=4,290 + the DB specs exercising the endpoints green. Honest note: browser-level Playwright navigation assertions were not run in this sandbox; AR/EN parity is enforced by the i18n gate, gating by the resolveNavigation behavior test. |
| 6.3 | `/inventory/adjustments` lists adjustment journals with filters; no posting path added | PASS | The read-only register (List+Search, filters); grep-clean of posting actions — the design intent documented in NAVIGATION_MODEL §1.2 + §9. |
| 6.4 | `reports.consolidated` in the sidebar for a template-less tenant; navigates to the 5 pages | PASS | The core NAV_ITEMS row (route `/consolidation`, `consolidation.reports` + `consolidation.reports.view`) — template-independent by construction (core items are never template-injected); the granted capability carries it for every entitled tenant; NAVIGATION_MODEL §1.1 updated. |
| 6.5 | `tax.e-invoicing-log` registered; renders over seeded data; catalog lists 86 with every registry key having a row | PASS | einvoicing-log.spec **4/4** (render/filter/window/permission-deny); golden.spec **6/6** (the 86-pin: 50 core + 18 industry + 3 FA + 5 notes + 2 budgeting + 3 payroll + 4 consolidation + 1 tax.e-invoicing-log); REPORT_CATALOG reconciled **86/86** (7 unlisted rows added, the `sales.commissions_due` duplicate removed). |
| 6.6 | DR-035-01/02/03 exist, linked from corrected claims; grep proves no stale text | PASS | The three records (Files created); FEATURE_CATALOG `reporting.scheduled_reports` → 057 DEFERRED (DR-035-01), SUBSCRIPTION_AND_ENTITLEMENTS `platform.payouts` substrate/surface split (DR-035-03); grep for "SHIPPED PHASE-025 scheduled reports" / "SHIPPED PHASE-023 payouts" matches only PHASE-035.md's own criterion text quoting the strings. |
| 6.7 | CURRENT_STATE / NEXT_ACTION / IMPLEMENTATION_STATUS show the 34-phase reality, the v3.0 pointer, PHASE-035 active | PASS | The T-09 truth sweep (this report's §Documentation updated): header/ledger/callout/registry trails (86 with history), the git-narrative correction (single squash commit `3d19e2f`, no tags), CURRENT_SHIPPED_PHASE PHASE-035 / 0048 / 13 templates / 86 contracts / 4,290=4,290. |
| 6.8 | `git status` proves untracking; `.gitignore` covers them; docs describe regeneration | PASS | **251 staged deletions** (dist-storybook + `__image_snapshots__` + `.playwright-artifacts*`); `.gitignore` extended (4 patterns + regeneration comments); `ci-visual.yml` guard step fails the build on any tracked baseline; README "Generated artifacts" + VISUAL_TESTING §5 rewritten. |
| 6.9 | All house gates green | PASS | The Tests-executed table: typecheck 8/8 · lint 8/8 · unit 1,386 · i18n 4,290=4,290 / 371=371 · drift 245=245 · docs 32/32 · manifests 13/13 · depcruise 0 · DB fresh-chain 1,136 (migrations 7/7, entitlements 11/11, einvoicing-log 4/4, golden 6/6, consolidation 22/22, isolation/RLS 1,086/1,086 — errata-corrected 2026-11-13). |
| 6.10 | Completion report appended; status flipped; archive delivered | PASS | This report; IMPLEMENTATION_STATUS PHASE-035 row → **COMPLETE 2026-11-10** + the v3.0 ledger note; NEXT_ACTION → PHASE-036; archive `ERP_PLATFORM_PHASE035.zip` (OA-07) delivered with this phase's state. |

## Build results

Typecheck **8/8** packages · lint **8/8** packages (both including the 21 +
regex repairs above) · depcruise 0 violations · manifests 13/13 · the web
build surface exercised through the typecheck/lint/unit gates (no separate
production build artifact is part of this phase's gate set).

## Evidence

- Commit `e84003a` "PHASE-035 code: activation surfaces + tax.e-invoicing-log
  + gate repairs" (50 files, +2,110/−75) + the working-tree docs set (DRs,
  REPORT_CATALOG, FEATURE_CATALOG, SUBSCRIPTION_AND_ENTITLEMENTS,
  VISUAL_TESTING, README, .gitignore, ci-visual.yml) + this phase's docs.
- `git status --porcelain`: 251 staged deletions (the hygiene proof), 8
  modified, 3 untracked DRs.
- Gate outputs recorded in the Tests-executed table (the delivered-facts
  ledger; re-runnable via the cited scripts).
- The grep sweep: `rg -i "SHIPPED PHASE-025 scheduled|SHIPPED PHASE-023
  payouts" docs/` → PHASE-035.md only (the criterion's own quotation).

## Known limitations

- The browser-level Playwright navigation assertions (criteria 6.1/6.2 —
  sidebar visibility + rendered AR/EN screens against a live stack) were not
  executed in this sandbox (no running web+api stack); the equivalent
  evidence is the granted-key + registry-resolution chain, the i18n parity
  gate, the resolveNavigation behavior tests, and the DB specs over the
  endpoints — the standing honest note, not a silent skip.
- The full DB suite (all 143 files) was not run end-to-end in this phase's
  verification; the fresh-chain-critical suites were: migrations /
  entitlements / einvoicing-log / golden / consolidation / isolation+RLS =
  **1,136 tests** (all green — errata-corrected 2026-11-13; originally announced 1,145).
- `check:rls` requires `MIGRATE_DATABASE_URL` + a provisioned postgres and is
  not runnable in this sandbox — the RLS attack suites (A-series, 1,086/1,086 — errata-corrected 2026-11-13
  incl. the +24 consolidation rows) ran instead.

## Deferred work

- Scheduled reports → PHASE-057 (DR-035-01, grant key preserved);
  customer portal → PHASE-060 (DR-035-02); `platform.payouts` surface →
  PHASE-059 (DR-035-03 — substrate live, surface deferred).
- The browser-level Playwright assertions above (re-run on the hosted harness
  with the standing visual/e2e gates).
- ZATCA Phase-1 QR → PHASE-037 (out of scope here by design).

## Documentation updated

IMPLEMENTATION_STATUS (header + intro note + v3.0 ledger + the PHASE-035 row
flip) · NEXT_ACTION (rewritten → PHASE-036 with the handoff note: the
batch/serial screens become the first custom-field consumers / exemplar
fixtures) · CURRENT_STATE (the PHASE-035 callout, registry trails 86 with
history, the lineage/git-narrative corrections, CURRENT_SHIPPED_PHASE 035 /
0048 / 13 templates / 86 / 4,290=4,290) · CHANGELOG (the PHASE-035 entry) ·
IMPLEMENTATION_PROTOCOL (§8 volatile-statistics policy — audit §9.ج item 11) ·
NAVIGATION_MODEL (§1.1 consolidated core promotion, §1.2 the three rows,
§2.1 contextual flows — audit F-4, §9 the LIVE phasing row) · REPORT_CATALOG
(86/86 reconciliation) · FEATURE_CATALOG + SUBSCRIPTION_AND_ENTITLEMENTS (the
DR-linked corrections) · VISUAL_TESTING §5 + README (regeneration) · the three
DRs + this report.

## Risks

No new RISK-xxx rows. The phase doc §7 risks all closed by their mitigations:
the grant follows the 0042/0043/0047 pattern exactly (plan metering safe);
the truth edits were cascade-checked by `docs:validate` 32/32 + the stale
count sweep (66/80/81 → 86 with historical trails, per-phase mentions left);
the untracking was paired with the CI guard in the same change (CI files are
code).

## Rollback instructions

Additive and DATA-ONLY throughout: (1) code — revert commit(s) delivering the
screens/nav/contract (no schema effect); (2) migration — 0048 is an
idempotent `array_cat` upsert; reverting = remove the journal/manifest row
and (optionally) `UPDATE plans SET feature_keys = array_remove(feature_keys,
'items.import_export') WHERE key IN ('business','enterprise')`; no data
depends on the grant; (3) the report contract — remove the registry index
entry (the 86-pin specs revert with it); (4) docs — the truth-refresh set is
prose; git revert restores. The DRs are records, not code — they stand as
history either way.

## Next eligible phase

**PHASE-036 — Extensibility Core — Custom Fields** (wave 1 / stage 12; §3
prerequisite PHASE-035 ✓ met; ships before PHASE-042+ per the hard ordering
rule). **Do NOT implement it here** — this report closes 035 only.
