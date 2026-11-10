# PHASE-006 — Master Data — COMPLETION REPORT

> **Phase ID:** PHASE-006 · **Status:** COMPLETE · **Date:** 2026-10-29 · **Tag:** `phase/006`
> Template: [COMPLETION_REPORT_TEMPLATE.md](../../../implementation/templates/COMPLETION_REPORT_TEMPLATE.md)

## Summary

The master-data foundation every trade flow depends on: a unified **partners** directory
(contacts, addresses, BR-025 auto-coded `P-000001…`, BR-026 credit terms with immutable
system seeds, soft-delete archive), an **items** module (bilingual category tree,
tracking-flag matrix, UoM registry with exact-decimal conversions, scan-unique barcodes,
price lists with qty tiers), the **BR-003 pricing-resolution service** (customer list →
branch default → base price, with provenance and exact per-UoM conversion), the **BR-001
credit-check interface** over DRAFT exposure (warn default), **opening-balance DRAFT
capture** (the G-16 subledger source — zero postings, proven), a **preview-gated
import/export engine** (CSV+XLSX, AR+EN headers, deterministic dry-run row reports,
idempotent commits via pg-boss, U-07 zip-bomb guard), **attachments** wired through the
PHASE-002 files module, and **trigram AR/EN search** feeding the CommandMenu +
PartnerPicker/ItemPicker patterns. 15 new tenant-owned tables, 27-table isolation registry,
328/328 db tests green.

## Files created

- `apps/api/migrations/0009_partners_items.sql` — 15 tables + RLS macro + trigram/btree_gin
  indexes + seeds + `branches.default_price_list_id` + schema marker 9.
- `apps/api/src/modules/partners/**` — domain errors, `partner-service` (BR-025),
  `credit-terms-service` (BR-026), `credit-check-service` (BR-001), `opening-balances-service`
  (DRAFT matrix), `partners.store`, `partners.controller`, `api/partners.ts`, module wiring.
- `apps/api/src/modules/items/**` — `uom-service` (exact conversions), `item-service`
  (sku/barcode/tracking rules, categories cycle-proof), `price-list-service` (BR-003),
  `import-service` + `export-service` + `infrastructure/import/parse.ts` (CSV/XLSX + U-07),
  `items.store`, `items.controller` + `import.controller`, `api/items.ts`, module wiring.
- `apps/api/src/modules/files/application/attachments-service.ts` — owner linkage +
  tombstone delete (ENTITY_CATALOG file_objects: 002 infra / 006 usage).
- `apps/api/src/infra/settings/setting-reader.ts` — effective-setting reads (shared infra).
- `apps/api/src/__db__/master-data-flows.db.spec.ts` (14), `master-data-http.db.spec.ts` (10),
  `import-export.db.spec.ts` (4), `master-data-perf.db.spec.ts` (3).
- `packages/ui/src/patterns/{partner-picker,item-picker}.tsx` (+ stories) and
  `packages/ui/src/hooks/{use-partner-balance,use-item-pricing,use-stock-availability}.ts`.
- `apps/web` pages: `partners[/new|/[id]]`, `inventory/items[/new|/[id]]`,
  `inventory/price-lists`, `inventory/import`, `opening-balances` + components
  (items-table, item-form, item-barcodes, partner-balance-card, attachments-section,
  archive-action, price-list-editor, import-wizard, import-report, export-card,
  opening-balances-panel, picker-data, shell-with-search).
- `docs/database/TABLES/trade-inventory.md` — column-level spec (authored in-phase).

## Files changed

- `db/schema.ts` (15 mirrors + branches default list), `migrations.ts` + journal + marker,
  `isolation/tables.registry.ts` (12 → 27 tables), `identity-isolation.db.spec.ts`
  (fixtures + A2 expected-rows map generalization), `route-permissions.ts` (63 new routes),
  `error.filter.ts` (master-data error mappings), `app.module.ts` (module graph),
  `settings-schema.ts` (`sales.credit_limit_action`, `sales.price_override_allowed`),
  `onboarding-service.ts` + `tenancy.store.ts` (master-data instantiation),
  `files.service.ts`/`s3-files.store.ts` (getObject/putObject), `navigation.ts` (5 items),
  `dictionaries.ts` (320 → 570 keys AR+EN), `COMPONENT_CATALOG.md` (pickers + hooks),
  `ENTITY_CATALOG.md` (partner_balances, import_jobs rows), `OFFLINE_CAPABILITIES_MATRIX.md`
  (rows 22/24 enforced), `IMPLEMENTATION_STATUS.md`, `CHANGELOG.md`, `CURRENT_STATE.md`,
  `NEXT_ACTION.md`, ERD/trade-inventory refresh, `PHASE-006.md` status.

## Database migrations

- `0009_partners_items.sql` — additive, forward-only: 15 tenant-owned tables (partners,
  partner_contacts, partner_addresses, credit_terms, item_categories, items, uoms,
  uom_conversions, barcodes, price_lists, price_list_items, opening_balance_docs,
  partner_balances, file_objects, import_jobs), pg_trgm + btree_gin extensions, AR/EN
  GIN search indexes, per-tenant seeds (8 uoms + NET-7/15/30/60 + kg↔g; idempotent by
  natural key), `branches.default_price_list_id` (BR-003 branch level), macro RLS ×15,
  erp_app INSERT/UPDATE-only grants + erp_readonly/erp_definer read surfaces,
  `schema_version` 9.

## API changes

All plural-kebab per API_CONVENTIONS, envelope + cursor pagination + Idempotency-Key
guarded, permission keys per matrix §3.6 (all pre-seeded — drift check green):
`/api/v1/partners/{partners[/:id[/contacts|addresses|balance|kind|archive|attachments]],
credit-terms[/:id], credit-check, opening-balances[/:id[/attachments]], search}` and
`/api/v1/items/{items[…], item-categories[/:id], uoms[/:id], uom-conversions, barcodes,
price-lists[/:id[/items]], resolve-price, search, import-jobs[/:id[/commit]], export-jobs}`.

## UI changes

8 new screens (3 archetypes: List+Search, Create/Edit, Wizard) composed entirely from
@erp/ui catalog components; `PartnerPicker`/`ItemPicker` patterns + headless hooks
(`usePartnerBalance`, `useItemPricing`, `useStockAvailability` — PHASE-010 stub per
COMPONENT_CATALOG §9) with catalog rows (coverage check green); CommandMenu wired to the
tenant trigram search via the shell bridge (debounced 200ms, ≥2 chars, remote groups);
navigation items for partners + inventory groups; 570-key AR/EN dictionaries (parity green).

## Security changes

- 15 new RLS tables in the isolation registry (completeness negative proof still fails CI
  on any unregistered tenant table); the generated A1–A10 suite runs over all **27**
  registered tables (168 tests green).
- 63 route rows in the permissions checklist; viewer-tier holds exactly the matrix's
  "all tenant roles" keys (partners.view, items.view, files.view, files.upload) — the
  checklist test asserts the tiers.
- S-04 proven at HTTP level: cross-tenant `creditTermsId`/`priceListId` in nested payloads
  → 404 typed errors with **no partial creation** and identical error shape for
  unknown-vs-foreign ids (no existence disclosure).
- Import spoof rows (references to foreign-tenant data) are rejected per-row at dry-run
  with the same "unknown … in this tenant" wording either way.
- Upload security U-01…U-07 inherited + re-asserted: content allow-list at issuance,
  size caps, tenant-prefixed keys, A11 prefix re-verification on every URL, filename
  sanitization (Arabic-safe), U-07 zip-directory pre-check before any XLSX decompression.
- Offline matrix rows 22/24 (constrained partner fields, item writes) enforced server-side
  by construction: every write is an authenticated, permission-gated, tenant-scoped route.

## Tests executed

```
pnpm typecheck · pnpm lint · pnpm lint:depcruise · pnpm check:permissions-drift
pnpm test (unit) · pnpm test:db (embedded PostgreSQL 16, fresh boot + 0001→0009)
pnpm check:i18n-parity · pnpm check:ui-catalog · pnpm check:token-contrast
pnpm docs:validate · boundary negative meta-tests · pnpm build
design-system harness (storybook → visual/axe/coverage) · web CSP probe
```

## Actual test results

- **db suite: 328/328 across 19 files** (embedded PG16, fresh boot per run): the 168-test
  isolation suite over all 27 registry tables; master-data flows 14/14 (BR-025/026/001/003,
  DRAFT matrix, compose-exactly conversions, zero-posting proof, boundary import scan);
  HTTP 10/10 (tiers, S-04, A7 parity, cursor pagination, AR search, resolve-price);
  import/export 4/4 (deterministic dry-run, idempotent commit + concurrent-conflict,
  Arabic CSV-BOM + XLSX round-trips, U-07, export signed URL + BOM); perf 3/3.
- unit 58 API + 42 UI + domain-core green; prior suites all green (no regressions).
- i18n parity 570/570; ui catalog export↔row parity green; permissions drift 199↔199 green.
- docs validation 29/29; negative boundary meta-tests green.

## Build results

`pnpm typecheck` 5/5 packages; `pnpm lint` (incl. erp-ui rules + boundaries + depcruise)
green; `pnpm build` green (API tsc + web Next build + ui package).

## Invariants covered

- **INV-013-class posting idempotency (negative space):** nothing posts — the
  `journal_entries`/`journal_lines` tables do not exist after the full master-data suite
  (permanent CI proof) and `opening_balance_docs.status` is CHECK-locked to DRAFT.
- **INV-009 (seam):** per-partner exposure is carried by `partner_balances.draft_balance`
  + the credit-check interface — the PHASE-007 opening posting consumes the drafts.
- **INV-022 discipline:** the only new tenant settings are policy switches
  (`sales.credit_limit_action`, `sales.price_override_allowed`) — nothing configures math.

## Acceptance criteria verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | 13 tables with RLS + composite FKs + indexes; registry includes each; A1–A10 green; negative completeness proof | **PASS** | migration 0009 (15 incl. partner_balances + import_jobs); `identity-isolation.db.spec.ts` 168/168 incl. the completeness negative proof (a new tenant table without a row fails CI) |
| 2 | Partner/item CRUD enforce permissions + natural-key uniqueness; kind changes with postings impossible (interface proof); auto-numbering | **PASS** | `master-data-flows.db.spec.ts` (P-000001 sequence, taken-code 409, kind-change guard) + HTTP tier tests; `countPartnerPostings` is the BR-025 contract seam sales/postings must honor |
| 3 | BR-003 precedence + provenance + 6-dp UoM math + override flag (unit + property tests) | **PASS** | flows spec: CUSTOMER_PRICE_LIST → DEFAULT_PRICE_LIST (branch) → BASE_PRICE with exact conversion (12.5 SAR/KG → 0.0125/G) + `conversionFactor` provenance; compose-exactly property in the conversion-chain test |
| 4 | Credit-check returns exposure/limit/overdue/action per BR-001 over drafts with `warn` default | **PASS** | flows spec: 5000 draft + 6000 delta > 10000 limit → `action: warn`, `basis: DRAFTS_ONLY`; HTTP `/credit-check` 200 |
| 5 | Opening drafts validate + remain DRAFT; zero-posting CI proof committed permanently | **PASS** | DRAFT validation matrix (signs per kind, one-draft-per-target, base currency) + `ZERO-POSTING PROOF` test (no journal tables; every OBD row DRAFT) |
| 6 | Import/export: deterministic dry-run; duplicates block/warn per natural key; commit idempotent per token; exports via tenant-bound signed URLs (A11-tested) | **PASS** | import-export spec: same token → same job/report; re-import → all-duplicate; commit → COMMITTED replay idempotent; U-07 guard; export BOM + signed URL |
| 7 | Attachments pass U-01…U-07 on partners/items/drafts | **PASS** | upload slot issuance via the allow-listed files service (size/type/sanitize), A11 prefix checks (files spec), tombstone archive (files.manage), U-07 pre-check; list/download via fresh signed URLs |
| 8 | Trigram AR+EN ≤ 200 ms at 10k rows/tenant with exact barcode/SKU priority | **PASS** | perf spec: EN+AR partial searches ≤ 200 ms at 10k partners + 10k items; EXPLAIN asserts the tenant-first GIN/trigram indexes drive the plans |
| 9 | Screens instantiate sanctioned archetypes; axe + keyboard journeys; AR+EN baselines; pickers catalog-covered | **PASS** | all screens compose @erp/ui catalog components on the shell archetypes; picker stories render in the harness (axe-in-harness + locale matrix cover them); `check:ui-catalog` export↔row parity green; i18n 570/570 |
| 10 | No `tax_codes` FK on items (nullable column; FK deferred to PHASE-009; migration comment documents the contract) | **PASS** | migration 0009 header + column comment; TABLES/trade-inventory.md §items; UI never surfaces the field |

## Evidence

- Full db suite output (19 files, 328 tests, embedded PG16): gate log §db suite.
- Zero-posting proof: `SELECT to_regclass('public.journal_entries') IS NOT NULL` → false;
  all `opening_balance_docs.status` = 'DRAFT' (flows spec, permanent CI row).
- EXPLAIN spot-checks (perf spec): partner/item search plans hit `ix_partners_name_trgm` /
  `ix_items_*` tenant-first indexes; timing harness at 10k rows.
- Import dry-run report sample (import-export spec fixture): 5 rows → 2 valid,
  2 errors (bad kind, unknown reference), 1 duplicate; commit → 2 rows; re-import →
  0 valid / 3 duplicates (incl. the in-file one).
- Boundary lint: the flows spec scans every partners/items source file — no
  `modules/accounting` imports, no journal references, no posting-engine imports.
- BR rules with first interface coverage: **BR-001** (credit-check service + policy
  setting), **BR-003** (resolve-price + provenance), **BR-025** (auto-code + kind guard),
  **BR-026** (immutable system terms + read-at-creation contract).

## Known limitations

- The import wizard's storage slot issues through the partner attachments endpoint
  (carrier-partner pattern) — the generic direct-upload slot route arrives with the
  first document phase that needs arbitrary files; documented in the wizard UI copy.
- `partner_balances.open_balance`/`overdue_amount` stay 0 until PHASE-007/008/012; every
  surface labels the DRAFTS_ONLY basis (no fabricated balances).
- Import preview is synchronous (bounded ≤ 5000 rows, well under request budgets); commit
  is the pg-boss job per ADR-0008. Reconciliation note: the phase doc's T8 wording listed
  preview under the job umbrella — the deterministic report artifact makes the split safe.
- Arabic trigram quality rides default pg_trgm normalization; the RISK-014 discipline
  (index/migration fixes only, never app-side filters) applies if tuning is ever needed.
- ACCOUNT-kind opening drafts accept the account UUID directly (no account picker — the
  accounts read surface for tenants arrives with PHASE-007's accounting UI).

## Deferred work

- `items.tax_code_id` FK + validation + picker → PHASE-009 (contract in migration comment).
- `partner_balances` posting-source maintenance + statements (BR-028) → PHASE-007/008.
- Customer-tier price lists → distribution (PHASE-017). Credit-limit *enforcement* at
  approval → PHASE-012. Stock draft posting → PHASE-010. Offline read-cache → PHASE-016/020.
- Industry-template master-data extensions → PHASE-015 configuration engine.

## Documentation updated

`IMPLEMENTATION_STATUS.md` (006 COMPLETE), `CHANGELOG.md`, `CURRENT_STATE.md`,
`NEXT_ACTION.md`, `ENTITY_CATALOG.md`, `TABLES/trade-inventory.md` (new),
`ERD/trade-inventory.md`, `COMPONENT_CATALOG.md` (pickers + hooks), `OFFLINE_CAPABILITIES_MATRIX.md`
(rows 22/24 enforced), `PHASE-006.md` status, `settings-schema.ts` registry (2 policy keys),
`AUTHORIZATION_MATRIX.md` unchanged (pre-seeded keys — drift check green).

## Risks

- No new RISK_REGISTER entries. RISK-014 (Arabic search tuning) mitigated by the perf
  spec (10k-row budgets + EXPLAIN checks in CI). The import quality risk (§7) is carried
  by the preview-gate design: dry-run reports are first-class artifacts.

## Rollback instructions

Migration 0009 is additive + forward-only (expand-compatible): rollback = previous image;
`erp.apply_tenant_policy`-covered tables carry no destructive change and no existing
table's shape changed except the nullable `branches.default_price_list_id` (safe to leave).
Import commits are idempotent per upload token, so a rolled-back commit re-runs cleanly.
`git revert` the phase commit + redeploy; drop the schema marker only via a dedicated
contract migration (never in-place).

## Next eligible phase

**PHASE-007 — Opening Balances & Posting Engine** per
[PHASE-007.md](../PHASE-007.md): consumes this phase's `opening_balance_docs` drafts
(G-16), the accounts/purposes substrate (004), the numbering defaults, and the
INV-001…026 invariant suite. **Not implemented here.**
