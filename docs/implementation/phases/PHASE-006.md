# PHASE-006 — Master Data

> **Status:** COMPLETE (tag `phase/006`, 2026-10-29) · **Updated:** 2026-10-29

## 1. Phase Overview

- **Phase ID:** PHASE-006
- **Title:** Master Data
- **Objective:** Deliver the two master-data modules every trade flow depends on —
  `partners` (unified customer/supplier directory with contacts, addresses, credit
  terms, credit-check service interface) and `items` (categories, items, UoM registry +
  conversions, barcodes, price lists with the BR-003 pricing-resolution service) — plus
  opening-balance **DRAFT** capture (no posting), bilingual CSV/XLSX import/export with
  duplicate detection and dry-run preview, attachment integration on top of the
  PHASE-002 `files` module, trigram search, and full-archetype screens with AR/EN
  bilingual data entry. The phase ends with a proven guarantee: **zero GL postings**
  (the posting engine does not exist yet and nothing here writes one).
- **Business value:** Master data quality determines the quality of every invoice,
  statement, and stock record that follows. Bilingual, import-friendly, duplicate-safe
  partner/item setup is the first thing a real tenant touches after onboarding, and
  the credit-check/pricing service interfaces are the seams sales (PHASE-012) and
  purchasing (PHASE-011) plug into.

## 2. Scope

In scope:

1. **Partners module** per [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md)
   §partners & items and [ERD/trade-inventory.md](../../database/ERD/trade-inventory.md):
   `partners` (kind `CUSTOMER|SUPPLIER|BOTH`, tenant-unique `code` with auto-numbering
   default per BR-025, `name`/`name_ar`, `tax_number`, `credit_limit`,
   `credit_terms_id`, `price_list_id`, status, `deleted_at` tombstone-capable soft
   delete), `partner_contacts`, `partner_addresses`, `credit_terms` (net 7/15/30/60/
   custom codes). Kind changes only while the partner has no postings (BR-025). A
   `partner_balances` read-model (owned by `partners` per
   [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)) exists as a
   recomputed view/table — at this phase it reflects opening-balance drafts only and
   is maintained as a read model from PHASE-007 onward.
2. **Items module**: `item_categories` (bilingual tree, drives default tax codes and
   reporting from PHASE-009), `items` (tenant-unique `sku`, `name`/`name_ar`, kind
   `STOCK|SERVICE|COMPOSITE`, base `uom_id`, category, costing method field
   `WAC|FIFO` (stored now, enforced from PHASE-010), tracking flags
   `track_batch|track_serial|track_imei|has_expiry`, reorder defaults, status),
   `uoms` (seeded common units per [SEEDS/README.md](../../database/SEEDS/README.md) +
   tenant-extendable), `uom_conversions` (from/to factor — exact decimal factors,
   compose-exactly property per [TEST_STRATEGY.md](../../testing/TEST_STRATEGY.md)
   §2.1), `barcodes` (multiple per item, per UoM), `price_lists` (sale/purchase kind,
   validity window, currency) + `price_list_items` (per-UoM unit price, min-qty
   tiers). `items.tax_code_id` is created as a nullable column with **no FK yet** —
   `tax_codes` arrives in PHASE-009 which adds the FK + validation (expand-migrate-
   contract; documented in both phase docs; the field is absent from UI until then).
3. **Pricing resolution service** (BR-003): precedence **customer's price list →
   customer-tier list (distribution, later) → branch default list → item base price**,
   with per-request provenance (which level resolved, applied UoM conversion) and
   manual-override allowance flag (ceilings enforced at sales time, PHASE-012).
   Published as the `items` module api service.
4. **Partner credit-check service interface**: `checkCredit(partnerId, amountDelta)`
   returning `{ openBalance, creditLimit, overdueAmount, action }` where `action`
   reads the tenant policy `sales.credit_limit_action = warn` default (BR-001
   semantics; the *enforcement point* is sales approval in PHASE-012 — this phase
   ships the interface + computation over opening-balance drafts).
5. **Opening-balance DRAFT capture**: `opening_balance_docs` (kind
   `partner|account|stock`, target refs, amounts, status DRAFT) per ENTITY_CATALOG —
   data entry + validation + attachment support only. **No posting**: the OPENING
   period and posting engine are PHASE-007; partner drafts become the subledger source
   for PHASE-007's opening posting (G-16); stock drafts post in PHASE-010.
6. **Import/export** (`items.import_export`): CSV + XLSX for partners, items, and
   opening-balance drafts — column-mapping, **dry-run preview with row-level error
   reports**, duplicate detection (natural keys: code/sku/email; fuzzy name match
   warnings), commit step, and export via the files module (signed URLs). Import is
   preview-gated (`items.import.run` permission; matrix §3.6), idempotent per
   upload-token, bounded (row/cell caps, zip-bomb guard U-07), and audited.
7. **Attachments integration**: attach files to partners, items, and opening-balance
   drafts via the PHASE-002 `files` module (direct-upload slot pattern for larger
   files, multipart ≤ 5 MB for receipts); upload security tests U-01…U-07 apply
   (content allow-list, magic bytes, quotas, tenant-bound keys, filename sanitization
   incl. Arabic names).
8. **Search**: pg_trgm indexes + query endpoints for partner names (AR+EN) and item
   names/SKU/barcodes (DATABASE_CONVENTIONS §8.5), wired into the shell
   `CommandMenu` partner/item search.
9. **Screens per archetypes** ([PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)):
   List+Search (partners, items, price lists), Create/Edit form (partner, item, credit
   terms, UoM, price list), Wizard archetype (import flow: upload → map → dry-run
   preview → commit; opening-balance draft entry), building on PHASE-005 components
   (new patterns this phase: `PartnerPicker`, `ItemPicker` with the headless hooks
   `usePartnerBalance`, `useItemPricing`, `useStockAvailability` stubs per
   [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) §9). Bilingual data entry
   everywhere (`name` + `name_ar` field pairs with locale-preview); every screen gets
   AR+EN archetype baselines.
10. **API spoof scenarios** per [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md)
    §2 PHASE-006 row: cross-tenant partner-id/item-id references in nested payloads
    (S-04), import row spoofing (rows referencing foreign tenant data → per-row
    rejection with no existence disclosure), and A6/A7 sweeps over all new routes.
11. **Offline policy registration**: matrix rows #22 (partner constrained fields —
    credit limit/terms/status — ONLINE-ONLY) and #24 (item create/edit ONLINE-ONLY)
    are recorded as policy in the module services (server-owned integrity); no offline
    sync exists yet (PHASE-020).

Out of scope (explicit):

- Any GL posting, opening-balance posting, subledger rows, or balance maintenance
  (PHASE-007) — verified acceptance criterion, not a hope.
- Warehouses, stock, batches/serials (PHASE-010); composite-product explosion rules
  (consumed by sales, PHASE-012).
- Tax codes/registrations UI on items (PHASE-009 adds the FK + picker).
- Statements, aging, allocations (PHASE-008/012/013) — `partner_balances` exposes
  draft-only sums here.
- Document numbering, credit-limit *enforcement* at document approval (PHASE-007/012).
- Industry-template-specific item/partner field extensions (PHASE-015 configuration
  engine).

## 3. Prerequisites

- Required phases: **PHASE-005 COMPLETE** — consumed artifacts: `@erp/ui` component
  catalog + archetypes + visual/a11y harness (every screen here composes it), app
  shell + navigation registry entries (الجهات / Partners, المخزون / Inventory groups),
  i18n pipeline. Verified via completion report + green CI + IMPLEMENTATION_STATUS row.
- Required architecture decisions:
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (UUIDv7; codes are
  natural keys, tenant-scoped unique), [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)
  (prices `numeric(19,6)`, quantities `numeric(19,6)` as strings over API),
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (every table RLS'd),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (import commit as bounded
  tenant-scoped job).
- Relevant documentation: [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md)
  §partners & items, [ERD/trade-inventory.md](../../database/ERD/trade-inventory.md),
  [DATABASE_CONVENTIONS.md](../../database/DATABASE_CONVENTIONS.md) (bilingual name
  pattern, trigram indexes, soft-delete policy),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-001 interface, BR-003,
  BR-025…BR-028 where applicable), [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md)
  (partners/items feature rows, PHASE-006), [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md),
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) §3/§9 (picker patterns +
  hooks), [TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md) §3–4,
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2/§7,
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  rows 22/24, [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) (filtering/sort/
  cursor on lists), [SEEDS/README.md](../../database/SEEDS/README.md) (uoms).

## 4. Design Impact

- **Database changes:** new tenant-owned tables `partners`, `partner_contacts`,
  `partner_addresses`, `credit_terms`, `item_categories`, `items`, `uoms`,
  `uom_conversions`, `barcodes`, `price_lists`, `price_list_items`,
  `opening_balance_docs`, plus the `partner_balances` read model — all with standard
  columns, composite tenant FKs, RLS via the macro, and hot indexes tenant-first
  (DATABASE_CONVENTIONS §8); trigram indexes on partner/item names; `uoms` seeded
  globally and tenant-extendable (tenant rows only — global seed rows are read-only).
  Every table enters [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + the
  TABLES/ spec (authored in-phase per the catalog's note that later-phase specs
  complete in their phase) + ERD refresh.
- **API changes:** `/api/v1/partners/partners[/{id}[/contacts|/addresses]]`,
  `/credit-terms`, `/api/v1/items/items`, `/item-categories`, `/uoms`,
  `/uom-conversions`, `/barcodes`, `/price-lists[/{id}/items]`,
  `/api/v1/items/import-jobs[/{id}/preview|/commit]`, `/export-jobs`, and
  `/api/v1/partners/credit-check`, `/api/v1/items/resolve-price` service endpoints.
  All per [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) (plural kebab, action
  sub-resources POST, `Idempotency-Key`, cursor pagination, whitelisted filters,
  `409 STALE_VERSION` optimistic locking on mutable rows).
- **UI changes:** new List+Search, Create/Edit, and Wizard archetype instances for
  partners/items/prices/import; two new shared patterns (`PartnerPicker`,
  `ItemPicker`) + their headless hooks added to `packages/ui` with catalog entries in
  the same PR (DESIGN_SYSTEM §4 escape-hatch protocol); CommandMenu gains partner/
  item search.
- **Security & authorization:** permissions `partners.view/create/update/archive`,
  `partners.credit_terms.manage`, `items.view/create/update/archive`,
  `items.price_lists.manage`, `items.import.run` (matrix §3.6) enforced on routes;
  risky-ish actions (credit terms changes) audited with before/after; import commit
  audited with row counts; attachments enforce `files.upload`/`files.view` +
  U-01…U-07; A6/A7/S-04 sweeps extended to every new route; new tables join the
  isolation registry.
- **Accounting implications:** none posted. Opening-balance drafts are validated for
  future postability (balanced sign conventions per kind, currency = base at this
  phase) so PHASE-007's posting step (G-16, INV-009 per-partner subledger) does not
  discover garbage. INV-022 note: nothing here can configure accounting math.
- **Localization implications:** bilingual `name`/`name_ar` on every descriptive
  entity + search across both; Arabic filenames preserved safely in attachments
  (U-06); import templates ship AR and EN column headers; trigram search tuned for
  Arabic script (pg_trgm with appropriate normalization).
- **Offline implications:** policy only — rows #22/#24 of
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (constrained partner fields + item writes ONLINE-ONLY) enforced server-side; master
  data will become READ-CACHED for POS/desktop from PHASE-016/020 but no sync work
  happens here.
- **Module dependencies:** `partners` and `items` → `shared-kernel` (+ the *allowed*
  dependency direction toward `accounting` per [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md)
  §2 remains unused at this phase — the accounting module does not exist yet and
  nothing imports it); `files` consumed via its api surface; `audit` via interceptor;
  no cross-module table writes ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)
  write matrix).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0006_partners_items.sql`: 13 tables + read model + indexes (trigram, tenant-first) + RLS + composite FKs | `apps/api/migrations/0006_partners_items.sql`, module schemas | migration fresh+regression; RLS catalog check; A1–A10 generated suite on all new tables |
| T2 | UoM seed + uom service (registry, conversions, factor validation) | `apps/api/seeds/uoms.sql`, `apps/api/src/modules/items/application/uom-service.ts` | property test: conversion chains compose exactly (no drift at 6-dp) |
| T3 | Partners domain + service: kind rules (BR-025), code auto-numbering, contacts/addresses, credit terms | `apps/api/src/modules/partners/**` | unit: kind-change blocked with postings (stub), code uniqueness, BR-026 terms-change semantics (new docs only — interface test) |
| T4 | Items domain + service: categories tree, items, barcodes, tracking flags, sku rules | `apps/api/src/modules/items/**` | unit: sku/ barcode uniqueness per tenant + per-UoM; category tree cycle check; tracking flag matrix |
| T5 | Price lists + BR-003 pricing resolution service with provenance | `apps/api/src/modules/items/application/pricing-service.ts` | precedence unit tests (customer list > tier > branch default > base); UoM-converted price math; override flag |
| T6 | Credit-check service interface + partner_balances read model (draft-aware) | `apps/api/src/modules/partners/application/credit-check-service.ts` | exposure math over drafts; policy mapping (`warn` default) |
| T7 | Opening-balance DRAFT capture service + validation | `apps/api/src/modules/partners/application/opening-balances-service.ts` | draft validation matrix (partner/account/stock kinds, signs, duplicates); **assert no journal rows can be created** (boundary negative test) |
| T8 | Import/export engine: CSV/XLSX parse, mapping, dry-run preview, duplicate detection, bounded commit job, export via files | `apps/api/src/modules/items/application/import-service.ts`, `infra/import/*` | dry-run reports row errors without writing; duplicate block/warn; commit idempotent per token; zip-bomb guard (U-07); spoofed rows (foreign refs) rejected per-row |
| T9 | Attachments wiring on partners/items/opening drafts | `apps/api/src/modules/partners/presentation/*`, `items/presentation/*` | U-01…U-07 suite; A11 cross-tenant object fetch impossible |
| T10 | Trigram search + CommandMenu integration | `apps/api/src/modules/*/application/search-service.ts`, `apps/web` wiring | AR+EN search results parity; barcodes/sku exact-match priority |
| T11 | Screens: partner/item lists, create/edit forms, price-list editor, import wizard, opening-balance drafts (archetypes 2/3 + Wizard) + `PartnerPicker`/`ItemPicker` patterns + hooks | `apps/web/src/app/(app)/partners/**`, `(app)/inventory/items/**`, `packages/ui/src/patterns/*` | AR+EN archetype baselines; axe + keyboard; dirty-guard; URL-encoded filters |
| T12 | Attack + permission registration: routes in matrix checklist, tables in isolation registry, S-04/import spoof scenarios | `tests/isolation/**`, `tests/api/**` | full isolation suite green; permission checklist green; S-04 nested-payload rejects with zero partial creation |
| T13 | Docs sync: ENTITY_CATALOG/TABLES/ERD, catalog coverage for new patterns | `docs/database/**`, `docs/ui/COMPONENT_CATALOG.md` | docs validation + schema-catalog drift green; catalog coverage check green |

## 6. Verification

**Automated tests (required):**

- Isolation: A1–A10 on all 13 new tenant-owned tables; A7 404-parity on every id
  route; S-04 nested foreign-id payloads (e.g., `credit_terms_id` from tenant B)
  rejected with no partial writes; import rows referencing foreign data rejected
  per-row with typed reasons and no existence disclosure.
- Service coverage (TEST_STRATEGY §8): every service method — happy path + failure
  path + authorization assertion. Highlights: BR-025 code/kind rules, price
  precedence (BR-003), conversion exactness (property), credit-check math (BR-001
  interface), draft validation matrix, duplicate detection on all natural keys.
- Import engine: dry-run produces a byte-stable preview (same upload token → same
  report); commit applies exactly the previewed rows; concurrent duplicate commit
  (same token) applies once; oversized/degenerate files fail cleanly (U-07); Arabic
  content round-trips (XLSX + CSV with BOM per
  [PRINTING_AND_EXPORT.md](../../reporting/PRINTING_AND_EXPORT.md) CSV rules).
- Attachments: U-01…U-07 (allow-list, magic bytes, size/quota, tenant-bound keys,
  signed-URL scope, filename sanitization, decompression guard).
- **Zero-posting proof:** a CI test asserts `journal_entries`/`journal_lines` do not
  exist (or contain zero rows for every tenant) after the full master-data suite runs;
  boundary lint proves `partners`/`items` import no accounting-writer code.
- UI: AR+EN baselines for every new archetype instance; axe 0 violations; picker
  patterns' keyboard models; CommandMenu result grouping.

**Manual verification:**

1. Create a partner bilingually (AR name primary), add contact + address, assign
   credit terms + a price list; verify the EN/AR display flips cleanly in the shell.
2. Create an item with two barcodes and two UoM conversions; resolve a price for the
   partner at a branch and read the provenance tooltip.
3. Run an XLSX import of 50 partners with 5 deliberate duplicates and 3 bad rows →
   dry-run flags exactly those; commit inserts the good rows; re-import the same file
   → all-duplicate report, zero new rows.
4. Attach a PDF and an Arabic-named image to a partner; open via signed URL; attempt
   the URL from the twin tenant → rejected (A11).
5. Enter opening-balance drafts (partner AR + AP) — verify they remain DRAFT and no
   ledger object is reachable anywhere in the API surface.

**Acceptance criteria (objective):**

1. All 13 tables exist with RLS + composite tenant FKs + documented indexes; the
   isolation registry includes each and the generated A1–A10 suite is green; the
   negative registry proof still fails CI when a table is unregistered.
2. Partner and item CRUD enforce their permission keys and natural-key uniqueness;
   kind changes with postings are impossible (interface-level proof); codes
   auto-number tenant-wide by default (BR-025).
3. The pricing resolution service returns the BR-003 precedence order with
   provenance, correct UoM-converted math (6-dp), and override flags — proven by unit
   + property tests.
4. The credit-check interface returns exposure/limit/overdue/action per BR-001
   semantics over opening drafts, reading `sales.credit_limit_action` default `warn`.
5. Opening-balance drafts validate (kinds, signs, base currency) and remain DRAFT:
   the zero-posting CI proof is green and committed as a permanent test.
6. Import/export: dry-run preview is deterministic and row-accurate; duplicates
   block/warn per natural key; commit is idempotent per upload token; exports download
   via tenant-bound signed URLs (A11-tested).
7. Attachments pass U-01…U-07 on partners/items/opening drafts.
8. Trigram search returns AR+EN results for partial names in ≤ 200 ms at 10k
   rows/tenant (fixture volume), with exact barcode/SKU match priority.
9. All new screens instantiate sanctioned archetypes, pass axe + keyboard journeys,
   and have AR+EN baselines committed; `PartnerPicker`/`ItemPicker` have catalog
   entries (coverage check green).
10. No `tax_codes` FK exists yet on `items` (column nullable, FK explicitly deferred
    to PHASE-009 — migration comment documents the contract).

**Performance & security considerations:** list endpoints cursor-paginated with
   whitelisted filters (no arbitrary-field filtering); trigram + tenant-first
   composite indexes keep search index-driven (EXPLAIN spot-checks in CI for the
   top queries per [TENANT_ISOLATION.md](../../database/TENANT_ISOLATION.md) §6);
   import jobs bounded (rows/cells/time) and cancelable; statement timeouts apply;
   no tenant data in import job payloads beyond ids (ADR-0008 discipline); uploads
   never proxy through API pods (direct-upload pattern).

**Migration & rollback:** additive migration `0006` + uoms seed; no changes to
   existing tables. Forward-only; rollback = previous image (expand-compatible).
   Import jobs are idempotent by token so a rolled-back commit leaves a clean
   re-runnable state.

## 7. Risks and Constraints

- Import quality risk: garbage in → ledger garbage out in PHASE-007 — mitigated by
  preview-gated commits, duplicate detection, and postability validation now (the
  dry-run report is a first-class artifact, not a debug log).
- Arabic search quality (pg_trgm normalization for Arabic script) may need
  collation/expression-index tuning — budgeted spike inside T10; if defaults prove
  inadequate, the fix is an index/migration change, never a filter change in app code
  (RISK-014 discipline).
- `items.tax_code_id`-without-FK is a deliberate expand-migrate-contract step
  (MIGRATION_STRATEGY §3): the migration comment + PHASE-009 doc are the contract;
  do not "complete" it early.
- Constraint: no stock, no tax, no GL — pricing must not simulate tax, credit checks
  must not block anything yet (enforcement lands with documents), and the
  `partner_balances` read model must label draft-only sums honestly in every UI
  surface.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-006-COMPLETION.md` with: isolation suite
  output for all new tables, zero-posting proof output, import dry-run/commit/idemp
  otency artifacts (sample reports), property-test summaries (conversions, pricing),
  attachment security suite results, screen baseline inventory, EXPLAIN outputs for
  the search queries, and the list of BR rules with first interface coverage
  (BR-001/003/025).
- **Documentation updates required:** [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-006 → COMPLETE + tag), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + new TABLES spec section +
  [ERD/trade-inventory.md](../../database/ERD/trade-inventory.md) refresh,
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) (picker patterns + hooks),
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (rows 22/24 marked enforced). Acceptance criteria copied into
  `planning/PHASE_ACCEPTANCE_CRITERIA.md` (planned file — see PHASE-003 note).
- **Exit criteria:** all 10 acceptance criteria green with evidence; the
  opening-balance drafts are structurally ready for PHASE-007's posting; docs
  validation + drift checks green.
- **Definition of Done:** a tenant can fully set up customers, suppliers, items,
  barcodes, price lists, and opening-balance drafts bilingually — via UI or bulk
  import — with duplicates caught, files attached, and provably no ledger effects.
- **Handoff instructions:** read the PHASE-006 completion report. The opening-balance
  drafts (partner + account kinds) are the input contract for the PHASE-007 opening
  posting; the credit-check and pricing-resolution interfaces are the input contracts
  for PHASE-011/012; `items.tax_code_id` awaits its PHASE-009 FK. **Next eligible
  phase: PHASE-007 — Accounting Core & Posting Engine** (identify only; do not
  implement).
