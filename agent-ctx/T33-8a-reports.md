# T33 / Task 8-a — The seven PHASE-017 industry reports on the PHASE-013 contract

**Agent:** 8-a (industry reports) · **Task ID:** 8-a · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — `pnpm --filter @erp/api typecheck` exit 0 · `pnpm --filter @erp/api lint` exit 0 ·
new db spec **10/10 green** · reporting unit spec **42/42 green** (counts 56 → 63 in both assertions) ·
full api unit suite **267/267 (25 files)** · full reporting db suite green (exports 4, industry 8, runs 5,
golden 6, dashboard 7, asof, industry-017 10) — only `render.spec.ts` fails on the sandbox's missing
Playwright chromium binary (environmental, pre-existing, unrelated).

## The 7 report keys (registered in `registry/index.ts` §8 PHASE-017 block)

| Report key | AR title | Permission (reused — NO new keys) | Assertion ids |
|---|---|---|---|
| `automotive.job_card_profitability` | ربحية بطاقات العمل | `reports.sales.profitability.read` | `jc-parts-cogs-tie` (GL) |
| `automotive.vehicle_service_history` | سجل صيانة المركبة | `sales.statements.read` | — (operational, README rule 2 note) |
| `distribution.rep_settlement` | تسوية المندوب | `reports.treasury.fx.read` (the shift/variance family pos.ts rides) | `settlement-gl-tie` (GL) |
| `distribution.route_visit_compliance` | الالتزام بخطوط السير | `reports.sales.by-rep.read` | — (planning data) |
| `distribution.van_stock_balances` | أرصدة مخزون السيارات | `inventory.stock.read` | `van-conservation-tie` |
| `sales.discount_management_effectiveness` | فاعلية السلع المجانية | `reports.sales.by-customer.read` | — (operational, BR-008 measurement) |
| `sales.commissions_due` | العمولات المستحقة | `reports.sales.by-rep.read` | `commissions-total-tie` (GL) |

All seven: category `industry`, bilingual AR-first titles/headers/notes, money as canonical 4-decimal
strings (qty 6), `printTemplate a4-report`, `executionClass inline`, freshness `current` with 60s TTL and
per-nature invalidation events, scopeRules tenant + optional branches (+ optional `warehouses` for the van
balances), `onFailure: "block-export"` assertions, exact-decimal ties (tolerance 0 via `assertExact`).

## Files

| File | Kind | Notes |
|---|---|---|
| `apps/api/src/modules/reporting/registry/industry/automotive-queries.ts` | new | `AutomotiveQueriesService` — `jobCardProfitability`, `jobCardPartsCogsTie`, `vehicleServiceHistory` (read-only SQL inside the ambient tenant tx, the PHASE-015 `industry-queries.ts` precedent, ADR-0011) |
| `apps/api/src/modules/reporting/registry/industry/distribution-queries.ts` | new | `DistributionQueriesService` — `repSettlement` (header money + `rep_settlement_lines` component-ledger detail + variance/deposit journal nos. + day load-out), `settlementGlTie`, `routeVisitCompliance`, `vanStockBalances`, `vanConservationTie`, `discountEffectiveness`, `commissionsDue`, `commissionsTotalTie` |
| `apps/api/src/modules/reporting/registry/industry/phase017.ts` | new | The 7 `defineReport` contracts (pos.ts/industry.ts patterns verbatim) |
| `apps/api/src/modules/reporting/registry/services.ts` | edit | `reportingServices()` lazy singleton + `automotive` / `distribution` |
| `apps/api/src/modules/reporting/registry/index.ts` | edit | §8 PHASE-017 block — 7 imports + registrations (56 → 63 contracts) |
| `apps/api/src/modules/reporting/registry/runtime.ts` | edit | `SOURCE_MODULES` + `"distribution"`; `MODULE_DATA_PHASE` + `distribution: 17`; `REGISTERED_PHASE_WINDOW` 16 → **17** (boot-critical) |
| `apps/api/src/modules/reporting/application/contract.ts` | edit | `DataSourceModule` + `"distribution"` (vehicleId param already typed) |
| `apps/api/src/modules/reporting/__tests__/reporting-unit.spec.ts` | edit | 56 → 63 in BOTH assertions (`result.count` + `snapshot` length) |
| `apps/api/src/__db__/reporting/golden.spec.ts` | edit | registry-snapshot pin 63 ("50 core + 13 industry") |
| `apps/api/src/__db__/reporting/industry-017.spec.ts` | new | dedicated tenant R17 book through REAL services; 10 tests |

Untouched (as instructed): migrations, `src/db/schema.ts`, route-permissions, module internals (the query
services read the published tables read-only — the reporting precedent; no module code was modified).

## Honest-source choices (documented in the query headers)

- **Job-card money** rides the POSTED invoice-line snapshots (net_amount, issue_value) netted by the
  warranty CN's re-entry values — the exact quanta the COGS journals posted; `job_card_lines.qty×price` is
  NOT used for money. The PARTS/LABOR nature split rides the card-line ↔ invoice-line mapping the T4
  posting port stamps, with the item kind (`STOCK`→PARTS / `SERVICE`→LABOR) as the fallback.
- **`jc-parts-cogs-tie` is document-set shaped**: register side = Σ per-card parts COGS of the listed
  cards; GL side = Σ net COGS journal-line amounts over the postings backing exactly those cards
  (`sales_invoice:cogs` + `job_card:issue_parts` + `credit_note:reentry`) — exact at tolerance 0 whatever
  date skew exists between approval and invoice.
- **Rep settlement**: the money columns read the settlement HEADER (the figures the GL tie reconciles);
  the `rep_settlement_lines` component ledger (signed, Σ lines = counted − deposit) is exposed as audit
  detail (`componentLineCount` + `componentLinesTotal`), so a stale line set is visible next to the tied
  numbers. Load-out = Σ IN stock_moves to the van warehouse on the settlement date.
- **Commissions**: the total tie covers POSTED runs only (DRAFT runs are listed for visibility but carry
  no journal — documented in the contract note); GL side = Σ DEBITS on the COMMISSION_EXPENSE accounts of
  `commission_run:accrual` journals.
- **Van stock** reads the `van_stocks` mirror AS PERSISTED (the van services refresh it inside their owning
  transactions); the `van-conservation-tie` compares it to Σ signed stock_moves and flags drift.

## Test evidence (exact ties, tolerance 0)

`TMPDIR=$HOME/tmp-8a npx vitest run --config vitest.db.config.ts src/__db__/reporting/industry-017.spec.ts`
→ **10/10 passed** (verbose):

- `automotive.job_card_profitability … parts COGS tie PASSES exactly` — row: partsRevenue 100.0000 /
  partsCogs 60.0000 / partsMargin 40.0000 (2×100 − CN 1×100; 2×60 − re-entry 60), laborRevenue 120.0000
  (1.5 h × 80), status INVOICED, invoice POSTED → **`jc-parts-cogs-tie` PASS {left "60.0000",
  right "60.0000"}**; empty window honestly empty {0.0000, 0.0000}.
- `automotive.vehicle_service_history … newest first` — 3 rows (warranty CN / invoice 320.0000 / job
  card, card total null), no assertions (operational).
- `distribution.rep_settlement … variance+deposit tie PASSES exactly` — opening 20, cash sales 40,
  expected 60, counted 58, variance −2.0000 SHORTAGE, deposit 58, load-out 16 / 74.0000, component lines
  4 with Σ 0.0000 (= counted − deposit) → **`settlement-gl-tie` PASS {left "60.0000", right "60.0000"}**
  (|−2| + 58 == DR CASH_DIFFERENCE 2 + DR bank 58).
- `distribution.route_visit_compliance` — planned 2 / completed 2 / skipped 0 / missed 0 / pending 0,
  invoices 2, salesTotal 64.0000, salesPerVisit 32.0000.
- `distribution.van_stock_balances … conservation tie PASSES exactly` — plain 3 @ WAC 5 (15.0000,
  batchless) + batch R17-B-1 6 @ 4 (24.0000, expiry +20 d) → **`van-conservation-tie` PASS {left
  "9.000000", right "9.000000"}** (mirror 3+6 == Σ signed moves 10+6−7).
- `sales.discount_management_effectiveness` — PROMO-1 × R17-CUST-02: FOC qty 1.000000, **focRevenue
  0.0000 (true zero-net line)**, focCostValue 5.0000 (full WAC), paired 1 invoice / 2.000000 qty /
  24.0000 net.
- `sales.commissions_due … ties to the accrual journal exactly` — base 64.0000 × 5% → 3.2000, ACCRUED →
  **`commissions-total-tie` PASS {left "3.2000", right "3.2000"}**.
- Registry integration — the 7 keys registered, category industry, the reused permissions, inline class;
  CSV export contains `STL-`, `-2.0000`, and `settlement-gl-tie,PASS`.

Unit: `npx vitest run src/modules/reporting/__tests__/reporting-unit.spec.ts` → **42/42** ("the 63 frozen
contracts validate against the known-permission catalog" — `result.count` 63, snapshot 63).

## Deviations / notes for the phase lead

1. **True zero-net FOC line**: an earlier draft of the fixture seeded the FOC line at the 0018 constraint
   floor (`unitPrice 0.0001`, the gap T32 documented). Migration 0025 is NOW relaxed
   (`net_amount > 0 OR foc_reason_code IS NOT NULL`), so the fixture seeds `unitPrice "0.000000" +
   focReasonCode "PROMO-1"` — net 0.0000 revenue, full WAC COGS — and every downstream expectation was
   updated (route sales 64.0000/32.0000, FOC revenue 0.0000, commission base 64.0000 → 3.2000). The
   application layer needed no change (its price check is `≥ 0`).
2. **No drillTargets** on the 7 contracts — matches the PHASE-016 `pos.ts` precedent (aggregate-first
   reports; the IMEI register is the document-link exception). Drill hops would need document-view
   permission keys; nothing new was invented.
3. `rep_settlement` reuses `reports.treasury.fx.read` (the variance/cash-difference family the PHASE-016
   shift-cash reconciliation rides) rather than a bespoke settlement permission — the "same choice
   pattern" rule.
4. The settlement load-out column counts ALL IN moves to the van on the settlement date (the load-out
   transfer 10 @ 5 AND the direct van GRN 6 @ 4 → 16 / 74.0000) — documented in the row comment; both are
   genuinely "loaded onto the van that day".
5. `render.spec.ts` fails in the full db-suite run only because the sandbox lacks the Playwright chromium
   binary (`npx playwright install` would fix it) — unrelated to this task; its 2 tests skip in CI shape.
