# T32 / Task 6-b — Customer price tiers + free goods + BR-003/BR-008 enforcement (PHASE-017 T11)

**Agent:** 6-b (tiers + free goods) · **Task ID:** 6-b · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — `pnpm --filter @erp/api typecheck` exit 0 · `pnpm --filter @erp/api lint` (eslint .) exit 0 ·
new spec **18/18 green** (isolated TMPDIR run) · regressions green in isolated runs: 5-a `core.spec.ts` **6/6**,
6-a `settlements.spec.ts` **4/4**, sales `golden.spec.ts` **10/10** · combined single-process run of all four
specs **38/38** · route probe: all **8** T11 mounted paths match `ROUTE_PERMISSIONS` verbatim (path + method +
permission key + `@RequireFeature`).

## ⚠️ One finding the phase lead MUST read (schema gap, not fixable inside this task's rules)

**Migration 0018's `ck_sales_invoice_lines_net_positive CHECK ("net_amount" > 0)` (STRICTLY positive) blocks
BR-008 zero-price invoice lines.** Migration 0025 added `sales_invoice_lines.foc_reason_code` ("BR-008
zero-price FOC lines carry their reason") but did NOT relax the 0018 check. Consequence: `invoices.create`
with a `unitPrice "0.000000", focReasonCode "PROMO-1"` line passes EVERY application-level validation
(qty > 0 ✓, `PRICE_RE` + `Number(unitPrice) < 0` → 0 allowed ✓, `salesLineNetAmount` net ≥ 0 ✓ — the app layer
is already FOC-ready, no surgical invoices.ts edit was needed) and is then rejected by the DB with
`23514 ck_sales_invoice_lines_net_positive`. The task's rules forbid me from touching migrations, so the
one-line relaxation — e.g. `CHECK ("net_amount" > 0 OR "foc_reason_code" IS NOT NULL)` — belongs to the
migration owner. My pack 4 pins the full BR-008 semantics around the gap (see "FOC posting evidence" below):
the moment the constraint is relaxed, a net-0 FOC line posts zero revenue + full COGS by construction —
everything else is proven end-to-end. NOTE: the concurrent T13 reports agent's
`distribution-queries.ts` `discountEffectiveness` (FOC lines, `SUM(net_amount)` as `focRevenue`) also assumes
net-0 FOC lines exist — same dependency.

## Files

| File | Kind | Notes |
|---|---|---|
| `apps/api/src/modules/distribution/domain/distribution-errors.ts` | edit (add-only) | 7 new typed errors (below) |
| `apps/api/src/modules/distribution/infrastructure/distribution.store.ts` | edit (add-only) | Tiers + free-goods sections: the ONLY writer of `customer_tiers` + `free_goods_rules` |
| `apps/api/src/modules/distribution/application/tier-service.ts` | new | `TierService` — CRUD, `assignPartner`, `listPartnerTiers` |
| `apps/api/src/modules/distribution/application/free-goods-service.ts` | new | `FreeGoodsService` — CRUD + `evaluate` engine + `appendFocLines` |
| `apps/api/src/modules/sales/application/pricing.ts` | edit (the seam) | `TIER_PRICE_LIST` level inserted; union extended |
| `apps/api/src/modules/distribution/presentation/distribution.controller.ts` | edit (add-only) | The 8 T11 routes exactly as registered |
| `apps/api/src/modules/distribution/distribution.module.ts` | edit | +`TierService`/`FreeGoodsService` providers/exports |
| `apps/api/src/modules/partners/infrastructure/partners.store.ts` | edit (additive tier-slice) | `PartnerRow.customerTierId` (+PARTNER_COLUMNS), `updatePartner` patch field, NEW `updatePartnerTier`, NEW `customerTierExists` |
| `apps/api/src/modules/partners/application/partner-service.ts` | edit (additive) | `update` accepts `customerTierId` + validates existence → `TierNotFoundError` |
| `apps/api/src/modules/partners/presentation/partners.controller.ts` | edit (additive) | `partnerPatchSchema` + `customerTierId` (rides PATCH /api/v1/partners/partners/:id — no new route needed) |
| `apps/api/src/infra/http/error.filter.ts` | edit (add-only) | `TIER_NOT_FOUND`/`FREE_GOODS_RULE_NOT_FOUND` → 404; `TIER_CODE_TAKEN`/`FREE_GOODS_RULE_CODE_TAKEN` → 409 (invalid-class → 422 default) |
| `apps/api/src/__db__/distribution/tiers-foc.spec.ts` | new | 18 db-backed tests on `setupSalesFixture()` tenant S |

Untouched (as instructed): migrations, `src/db/schema.ts`, `route-permissions.ts`, commissions, job-cards
posting, `settlements` internals, `invoices.ts` (the anticipated unitPrice relaxation was NOT needed —
the check is already `Number(line.unitPrice) < 0`, i.e. ≥ 0 allowed; the actual blocker is the 0018 DB
constraint above).

## Error surface (add-only)

`TIER_NOT_FOUND` (404) · `TIER_CODE_TAKEN` (409, uq_customer_tiers_tenant_code — pre-check + 23505 catch) ·
`TIER_PRICE_LIST_INVALID` (422 default — unknown/PURCHASE-kind/non-SALE list) ·
`TIER_INVALID` (422 default — **one extra class beyond the task's six** for discount-cap/visit-frequency
bounds; keeping `TierPriceListInvalidError` price-list-shaped; the 5-a "extra typed errors" precedent) ·
`FREE_GOODS_RULE_NOT_FOUND` (404) · `FREE_GOODS_RULE_CODE_TAKEN` (409) ·
`FREE_GOODS_RULE_INVALID` (422 default — qty ≤ 0, dangling item/tier refs, inverted window, bad
maxFreePerOrder, reason code empty/oversized).

## Store surface (additions)

- **Tiers:** `insertTier`, `findTierById`/`findTierByCode` (price-list name joined), `listTiers({status?, limit})`,
  `updateTier` (dynamic `sql.join` SET — undefined=keep, null=clear), `findPartnerTier(partnerId)`
  (read-only partners read via `partners.customer_tier_id` — §6 precedent, documented in-file),
  `listPartnerTiers()` (partners GROUP BY tier + the unassigned row; live CUSTOMER/BOTH partners only).
- **Free goods:** `insertFreeGoodsRule` (rule_type 'BUY_X_GET_Y'), `findFreeGoodsRuleById`/`ByCode`
  (buy/get item SKU + tier code joined), `listFreeGoodsRules({status?, tierId?, limit})`,
  `updateFreeGoodsRule` (same patch semantics), `activeFreeGoodsRules(date)` — ACTIVE ∧ window-valid
  (NULL bounds open-ended), ORDER BY code (deterministic feed).

## Service semantics

**TierService** (`@Inject(AuditService)`): create — code-unique pre-check (+23505 race catch), price list
must EXIST and be kind SALE, `discountCapPct` 0..100, `visitFrequencyDays` ≥ 0; audits
`distribution.tier_created` (entityType `"customer_tier"`). update — additive patch, same validations.
`assignPartner(partnerId, {tierId|null, actorId})` — partner exists (PartnerNotFoundError on unknown/archived),
tier exists when non-null (TierNotFoundError), writes through the partners store's additive
`updatePartnerTier` (the documented tier-slice exception — partners owns partner rows, distribution owns
tier rows; mirrors the VAN-slice precedent), audits `distribution.tier_partner_assigned` (before/after tier
ids). `listPartnerTiers` — the grouped read. `listPartnerTiers` has NO route (none registered) —
service-level only, as instructed.

**FreeGoodsService** (`@Inject(AuditService)`): create/update validate buy/get qty > 0 (≤6dp), items exist
(non-deleted), tier exists when given (FreeGoodsRuleInvalidError — the task's "tier refs" bucket), window
from ≤ to (update validates against the MERGED before-state), maxFreePerOrder ≥ 0, reasonCode required
trimmed 1..30 chars. Audits `distribution.free_goods_rule_created`/`_updated` (entityType
`"free_goods_rule"`). The engine:

```
evaluate({customerId|null, lines: {itemId, qty}[], date}) → FreeGoodsLine[]
  rules = activeFreeGoodsRules(date)                       // ACTIVE + window
  tier  = customerId !== null ? findPartnerTier(customerId) : undefined
  qtyByItem = Σ per item across lines
  per rule: tierId null ? all customers : tier.id === rule.tierId (null customer never matches)
            bought = qtyByItem[rule.buyItemId]             // BUY item must appear
            multiples = perMultiple ? floor(bought / buyQty) : (bought ≥ buyQty ? 1 : 0)
            free = multiples × getQty, capped by maxFreePerOrder
            free > 0 → {itemId: getItemId, qty: 6dp, reasonCode, ruleCode}
```

Pure Decimal quantity math (property-testable), no writes, no journals. `appendFocLines(customerId, lines,
date)` — the sale-time convenience: returns `[...originals, ...zeroPriceDrafts]` where each draft is
`{itemId, qty, unitPrice: "0.000000", focReasonCode, ruleCode}`; the van/POS caller maps drafts onto its
invoice-line shape (generic `<L extends {itemId, qty}>` keeps the originals' type). The rules NEVER post —
the invoice path owns stock issue + COGS (BR-008).

## The resolveSalesPrice change shape (the BR-003 seam)

`SalesPriceSource` extended additively: `"SALES_PRICE_LIST" | "TIER_PRICE_LIST" | "BASE_PRICE" | "MANUAL"`.
Consumers audited before extending (grep): `invoices.ts` (staleness gate — only `!== "MANUAL"`), `orders.ts` /
`quotations.ts` (only `=== "MANUAL"`), purchasing uses its own string — **no exhaustive switches anywhere**, so
the union extension breaks nothing. New level 2 sits between the customer's own list and base price:
`findPartnerTier(customerId)` → tier ACTIVE ∧ `tier.priceListId` set → list ACTIVE ∧ kind SALE →
`resolvePriceListTier` on THAT list → `{unitPrice, source: "TIER_PRICE_LIST", priceListId: tier.priceListId}`.
Returns whatever it found at a higher level otherwise; falls through to BASE_PRICE/MANUAL unchanged.
"Tier resolution never overrides an explicitly quoted price" is honored structurally: the resolve only
produces DEFAULTS (manual quotes carry their own unitPrice), and the approval staleness gate
(`sales.price_override_allowed = false`) re-resolves through this SAME level — proven in test (d).

## API surface (all requireIdentity + envelope + zod; POSTs HttpCode 201)

```
GET    /api/v1/distribution/tiers                     ?status&limit        distribution.tiers.manage  @distribution.customer_tiers
POST   /api/v1/distribution/tiers                     {code,name,nameAr?,priceListId?,discountCapPct?,visitFrequencyDays?,note?,noteAr?}
GET    /api/v1/distribution/tiers/:id
PUT    /api/v1/distribution/tiers/:id                 {name?,nameAr?,priceListId?,discountCapPct?,visitFrequencyDays?,status?,note?,noteAr?}
GET    /api/v1/distribution/free-goods-rules          ?status&tierId&limit distribution.free_goods.manage @distribution.free_goods
POST   /api/v1/distribution/free-goods-rules          {code,name,nameAr?,buyItemId,buyQty,getItemId,getQty,perMultiple?,maxFreePerOrder?,tierId?,reasonCode,validFrom?,validTo?,note?,noteAr?}
GET    /api/v1/distribution/free-goods-rules/:id
PUT    /api/v1/distribution/free-goods-rules/:id      (additive patch incl. status)
```

**Partner-tier assignment** (no T11 route registered for it): rides the partners module's existing
`PATCH /api/v1/partners/partners/:id` — `partnerPatchSchema.customerTierId: uuid|null` →
`PartnerService.update` validates via `partnersStore.customerTierExists` → `TierNotFoundError` (404 through
the filter) → `updatePartner` writes the column. `TierService.assignPartner` is the service-level twin.
**Route-probe evidence** (temporary tsx probe over Reflect metadata vs ROUTE_PERMISSIONS, deleted after the
run): all 8 mounted T11 paths OK — path, method, permission key, and feature key
(`distribution.customer_tiers` / `distribution.free_goods`) match verbatim; zero UNMOUNTED registrations.

## Test output

Isolated: `mkdir -p $HOME/tmp-6b && cd apps/api && TMPDIR=$HOME/tmp-6b npx vitest run --config
vitest.db.config.ts src/__db__/distribution/tiers-foc.spec.ts`

```
 ✓ src/__db__/distribution/tiers-foc.spec.ts (18 tests) 573ms
 Test Files  1 passed (1)   Tests  18 passed (18)
```

Regressions (each its own fresh-DB TMPDIR run): `core.spec.ts (6 tests)` ✓ 6/6 ·
`settlements.spec.ts (4 tests)` ✓ 4/4 · `sales/golden.spec.ts (10 tests)` ✓ 10/10.
Combined single-process run (one DB, four spec files): **38/38** — no cross-spec pollution
(dedicated customers `TIER6B-*`, find-or-create fixtures, `clearSalesSetting` restore).

### Fixture (tenant S, idempotent)

`setupSalesFixture()` + SALE price lists `TIER-PL (6b)` (item S-A @ 85, minQty 1) and `OWN-PL (6b)`
(S-A @ 90) + PURCHASE list `PUR-PL (6b)`; tiers `WHOLESALE` (→ TIER-PL, cap 10.00, freq 7),
`RETAIL` (no list), `DORMANT` (→ TIER-PL, INACTIVE); dedicated customers `TIER6B-OWN` (own list +
WHOLESALE), `TIER6B-TIER` (WHOLESALE only), `TIER6B-NONE` (DORMANT — the inactive-tier probe), `TIER6B-RETAIL`
(RETAIL); six rules `PROMO-A-PM` (buy 10 A get 1, per-multiple, open), `PROMO-B-CAP` (buy 10 B get 1,
max 1), `PROMO-C-ONCE` (buy 10 C get 1, per_multiple=false), `PROMO-A-TIER` (buy 5 A get 1, WHOLESALE-only),
`PROMO-A-EXP` (window ends 2026-03-09), `PROMO-A-FUT` (starts 2026-03-11). Evaluation date 2026-03-10.
The fixture customers (S-CUST-01/S-CUST-LIM) stay tierless — sibling suites' price resolutions unchanged.

### BR-003 precedence-chain evidence (pack 1, THE phase test)

- **(a)** own list + tier → `{90.000000, SALES_PRICE_LIST, ownPl}` — own list WINS over the tier.
- **(b)** tier only → `{85.000000, TIER_PRICE_LIST, tierPl}` — the new level.
- **(c)** inactive tier (DORMANT) + no list → `{100.000000, BASE_PRICE}` — inactive tiers never resolve.
- **(d)** quoted 75 on the WHOLESALE customer: the draft persists `unitPrice 75.000000` / `net 75.0000`
  verbatim (the quote wins, tier only supplies defaults); with `sales.price_override_allowed=false`
  (restored after), approving the 75-draft → **PriceChangedError** (gate re-resolves 85 through the tier
  level — never silently rewritten), while the 85-priced draft approves cleanly under the same policy.

### Tier CRUD + assignment evidence (pack 2)

Create joins price-list name, cap/freq persisted; `GOLD-6B` duplicate → `TierCodeDuplicateError`;
unknown list + PURCHASE-kind list → `TierPriceListInvalidError`; caps 150/−1 → `TierInvalidError`; unknown
id → `TierNotFoundError`; update additive (rename + cap, priceListId untouched); `assignPartner` set/clear
via `partners.customer_tier_id` (+ audit rows `distribution.tier_partner_assigned` ≥ 2); unknown partner →
`PartnerNotFoundError`, unknown tier → `TierNotFoundError`; the partners PATCH path sets/validates
(`customerTierId` persisted; unknown tier → `TierNotFoundError`); `listPartnerTiers` groups WHOLESALE ≥ 2
partners + the unassigned row.

### FOC rule-engine property evidence (pack 3)

buy 10 get 1 per-multiple: qty 25 → `2.000000`, qty 9 → `[]`, split lines 12+13 → 2 (per-item
aggregation); maxFreePerOrder 1: qty 25 → `1.000000`; per_multiple=false: qty 25 → `1.000000`;
tier-scoped: WHOLESALE customer → `[PROMO-A-PM, PROMO-A-TIER]` (scoped 10/5 → 2 free), RETAIL customer /
null customer → only the open rule; windows: on 03-10 only the 4 valid rules feed
(`activeFreeGoodsRules`), 03-09 includes the expired, 03-11 the future; `appendFocLines` returns
originals + `{qty 1.000000, unitPrice 0.000000, focReasonCode PROMO-1, ruleCode PROMO-A-PM}`;
CRUD validation: buyQty/getQty 0, dangling item, dangling tier, inverted window, empty/31-char reason →
`FreeGoodsRuleInvalidError`; duplicate code → `FreeGoodsRuleCodeDuplicateError`; update (getQty 2 +
INACTIVE) + inactive rules leave the engine feed; `list({tierId})` filters.

### FOC posting evidence (pack 4 — the BR-008 proof around the 0018 gap)

- **(i)** `appendFocLines` draft → invoice line inputs → `invoices.create` passes every app check and the
  line INSERT is refused with **`23514` / `ck_sales_invoice_lines_net_positive`** (asserted down drizzle's
  cause chain) — the exact, documented schema gap; the app layer (4-a plumbing + this task) is FOC-ready.
- **(ii)** zero-net line on the DELIVERY-NOTE surface (0018's sibling check
  `ck_delivery_note_lines_net_nonneg` allows net ≥ 0): DN (1 @ 100 + 1 @ 0) posts — COGS journal EXACTLY
  `[[cogs, DEBIT, 120.0000], [inventory, CREDIT, 120.0000]]` (both units' 60.0000 WAC), 2 OUT stock_moves
  (Σ 2, Σ value 120), the free line's issue snapshot `unitCost 60.000000 / value 60.0000`,
  `totalNet 100.0000`, **no revenue journal** (DN posts none) — a zero-net line issues stock and posts its
  FULL cost with zero revenue.
- **(iii)** invoice surface aggregation split: (2 @ 100 + 1 @ **0.000100** — the constraint's floor,
  focReasonCode "PROMO-1" persisted) posts — AR journal EXACTLY `[[arControl, DEBIT, 200.0001],
  [salesRevenue, CREDIT, 200.0001]]` (revenue = Σ qty×price: the floor line's contribution is its 0.0001
  net; a true FOC line's is exactly 0) and COGS journal EXACTLY `[[cogs, DEBIT, 180.0000],
  [inventory, CREDIT, 180.0000]]` (3 × 60 WAC — price-independent), floor line `issueValue 60.0000`,
  2 OUT moves Σ 3. Revenue and COGS are separate linear aggregations of the same lines ⇒ once the 0018
  constraint is relaxed, a net-0 FOC line posts 0 revenue + full COGS by construction.

## Deviations / decisions (read before building on this)

1. **The 0018 constraint gap (above) is the one substantive deviation** — the literal "invoice with a
   zero-price FOC line posted" fixture is impossible under the frozen migration set; pack 4 was restructured
   into the three-part proof. Everything else in the task's pack-4 spec (revenue excludes the zero line,
   COGS includes its cost, stock issued, foc_reason_code persisted) is asserted on the closest legal
   surfaces, and the exact failing point + fix is pinned for the migration owner.
2. **One extra error class `TierInvalidError`** beyond the task's six (discount cap / visit frequency /
   status bounds) — keeps `TierPriceListInvalidError` price-list-shaped; the 5-a "two extra typed errors"
   precedent. Maps to the 422 default (no filter entry needed).
3. **`TierNotFoundError` is thrown by the partners module's update path** (cross-module domain-error
   import — the `invoices.ts`-imports-accounting-errors precedent) rather than a new partner error; the
   filter maps it 404 globally either way.
4. **`PartnerRow`/`PARTNER_COLUMNS` gained `customerTierId`** (additive read column) so the PATCH path can
   audit before/after and callers see the assignment; PartnerRow consumers are partner-service + store only
   (verified) — no exact-shape test breakage.
5. **`findPartnerTier` returns the tier regardless of status** — the pricing seam checks `status ===
   "ACTIVE"` itself (mirroring how level 1 checks the list's status); the inactive-tier skip is asserted in
   test (c).
6. **`appendFocLines` is generic over the original line type** (`<L extends {itemId: string | null, qty:
   string}>`) so callers' richer line shapes pass through untouched; FOC drafts are a separate exported
   `FocLineDraft` interface for the caller to map onto its document-line shape.
7. **The rule engine aggregates buy quantities per item across lines** before the per-rule math
   (`12+13 → 25`) — the property-testable reading of "the BUY item appears in lines".
8. **`activeFreeGoodsRules` orders by code** — deterministic evaluation order for stable outputs.
9. **Tier `discountCapPct` is informational for sale-time math at this phase** — BR-003 says "discounts
   affect revenue only" and the cap bounds manual discounts (BR-002 ceilings enforce at the document
   level); the cap is validated + persisted + surfaced, not yet consumed by a discount gate (none is
   registered in this task's scope).
10. **Concurrent-agent note:** a parallel T13 reports agent was editing
    `src/modules/reporting/registry/industry/*.ts` during this task (one transient typecheck failure in
    THEIR in-flight `automotive-queries.ts`, resolved by them before my final gate). My final typecheck +
    lint runs were fully green.
