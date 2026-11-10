# P30-A — contracts + migration (Task ID 1/2/3/4 core)

PHASE-030 implementation notes, wave A (the configuration-only core):

## Delivered

1. **Contracts (T1)**: `WHOLESALE_TEMPLATE_MANIFEST` +
   `ELECTRONICS_TEMPLATE_MANIFEST` transcribed VERBATIM from
   `docs/industries/templates/manifests/manifest.{wholesale,electronics}.json`
   (regenerated from the reconciled .md sources) into
   `packages/contracts/src/industry/templates.ts`; `SHIPPED_TEMPLATE_MANIFESTS`
   7 → 9; exports threaded through `industry/index.ts` + the package root.
   `pnpm validate:manifests`: **9/9 green**.
   - wholesale content hash: `sha256:0fe7aa4c8e0892a1451dd3cc623b886a5dd51ab6c3a78066a26e259fd85a7522`
   - electronics content hash: `sha256:216f1e981ae4c457173c18ead7c1263780f8082c6d18807fb9308a507e6f51a9`
2. **Report-key reconciliation** (the 0025/0027 convention): the doc drafts'
   `partners.ar_aging` / `inventory.stock_valuation` pins reconciled to the
   LIVE registry keys `ar.aging` / `inventory.valuation` in the .md sources,
   the regenerated .json mirrors, the contracts constants, and the migration
   seed — one convention applied at every layer.
3. **Migration 0041** (`0041_industry_wholesale_electronics.sql`, journal
   idx 40, schema_version 41): DATA-ONLY — the two registry rows upserted on
   key (SEEDS rule 2). Zero tables/columns/enums/journals/permissions/plan
   grants (INV-022). Embedded JSONs verified byte-equivalent to the contracts
   constants under canonical hashing.
4. **Policy registry**: nine typed keys — wholesale
   (`qty_break_pricing_automatic`, `bulk_order_from_quote_one_click`,
   `delivery_before_credit_invoice`, `statement_monthly_by_default`,
   `pdc_note_requires_maturity_date`) + electronics
   (`imei_capture_required_flagged_items`, `repair_parts_issue_mode`,
   `repair_card_labor_rate_source`, `tradein_purchase_at_branch`). No
   settingsKey mappings (the automotive/distribution posture — L1 template
   defaults, tenant override through the future L5 surface per key).
5. **CURRENT_SHIPPED_PHASE 028 → 030** (prerequisites.ts) with the 029
   bookkeeping leg recorded in the comment chain (payroll shipped, no
   template capability rides it).
6. **Layer fixtures**: the 0038 notes + installments grant wave (12 keys)
   mirrored into BUSINESS_KEYS — the wholesale pdc_notes REQUIRED chain
   needs it in the unit prerequisite tests. The 0039/0040 waves stay
   un-mirrored (the P28/P29 posture — no template consumes them).
7. **Synthetic phase-gate tests** moved PHASE-029 → PHASE-031
   (`healthcare.patients` — the next roadmap shell's intake, not yet a
   catalog key; the payroll.employees@029 proof expired with the 029 bump).

## Golden pin table (old → new, the 0038 fixture mirror)

| case | old | new |
|---|---|---|
| retail × business | 27b85f37…81951 | 211598c8…b4acf |
| retail × enterprise | 0cb55132…5e735 | 8b1530d7…def92 |
| grocery × business | d8a42afc…5bd00 | e80f9c37…862e1 |
| grocery × enterprise | d261c919…bc3bb | 9f5f602f…b754b |
| restaurant × business | d6a5727d…99eed | 2730405c…4308d |
| restaurant × enterprise | a5e2828b…4caf50 | db34e45e…bd98e |
| automotive × business | 371afb6f…d78efa | 3c9302b0…88d4 |
| automotive × enterprise | 5df8a82a…08ad | 78fc2144…8a28 |
| distribution × business | 3c714612…71c03 | 77f2893f…11373 |
| distribution × enterprise | 8535962a…952b9 | 2100745a…1a348 |
| food_manufacturing × business | ee699d0c…1042f | 80964a32…1af0 |
| food_manufacturing × enterprise | 0e8e8405…894e | 34cdbf0f…5433 |
| professional_services × business | 9c0fc111…98c8b3 | f2210855…6063 |
| professional_services × enterprise | 753d422b…17a2 | 7531130f…4a5d5 |
| (no template) × business | 5a53bdd9…1129 | 393178c2…8435 |

New pins (the 0041 seeds): wholesale starter/business/enterprise =
0a8dc4b6…802c / 5f113ee0…1028 / 35aab141…395a; electronics =
c5ec2797…44a9 / 699731c8…d683 / eee6dc38…b9d9. Starter rows of the seven
pre-existing templates unchanged (no new starter keys).

## Structural note

Electronics sets `cash_sales_autopost: true` (POS-first like retail);
wholesale leaves the platform default (credit-first trading) — the golden
structural assertion extended accordingly. Wholesale's OPTIONAL
`shipment_tracking` cites the ungrantable `distribution.shipment_tracking`
intake key → classifies HIDDEN (the §18 lesson 5 upgrade-path posture),
matching the 019 `deposits_late_fees` precedent.

## Verification (wave A)

- contracts: 52/52 · configuration unit: 109/109 · validate:manifests 9/9
- pending: DB spec (T6) + docs wave (T7) + full regression (T8)
