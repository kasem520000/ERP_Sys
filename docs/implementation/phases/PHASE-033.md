# PHASE-033 — Agriculture Commercial Shell

> **Status:** COMPLETE · **Updated:** 2026-11-08 — configuration-only scope
> shipped on the PHASE-027 lineage (see
> [reports/PHASE-033-COMPLETION.md](reports/PHASE-033-COMPLETION.md)); the
> DB-level governance suites re-run on the harness environment.

## 1. Phase Overview

- **Phase ID:** PHASE-033
- **Title:** Agriculture Commercial Shell
- **Objective:** Deliver the `industry.agriculture` template (ED-09) as a **commercial
  shell** through the unmodified PHASE-015 engine: every **crop cycle الدورة الزراعية**
  is a BOM recipe run as a production order costed to a **field project الحقل**, harvests
  land as **batches دفعة الحصاد** at production cost (then WAC onward), livestock are
  serial-tracked items at **head level رأس**, inputs (seeds/feed/supplies) are ordinary
  purchases, and produce sells from harvest batches — every posting riding the existing
  manufacturing and trading goldens (G-07/G-08, the G-17 chain, G-18, G-01/G-02/G-03).
  **Configuration only**: no new tables, no new modules, no new feature keys or
  permissions, and INV-022 unchanged — the template selects accounts, features, and
  policies, never accounting mathematics.
- **Business value:** Farms, greenhouses, contract growers, agri-traders, and
  head-level livestock operations across MENA need one honest answer — what did each
  field, each crop, each season cost, and what did the harvest fetch? This phase makes
  the season (inputs → cycle → harvest → sale) auditable end-to-end on the same
  financial core while ED-11 keeps precision agronomy honestly out of scope.

## 2. Scope

In scope:

1. **Template application via the PHASE-015 engine** (a needed engine change here is a
   PHASE-015 defect to fix there, not a fork): `industry.agriculture` v1.0.0 per
   [agriculture.md](../../industries/templates/agriculture.md) — terminology overrides
   (`المحصول` crop, `الدورة الزراعية` crop cycle, `وصفة الدورة الزراعية (قائمة المواد)`
   crop-cycle recipe/BOM, `أمر تنفيذ الدورة` cycle run order, `دفعة الحصاد` harvest
   batch, `المزرعة / الحقل` farm/field, `رأس` livestock head, `البذور والمدخلات`
   seeds & inputs, `الأعلاف` feed, `المردود` yield, `الفاقد` crop loss…), the Season /
   الموسم and Harvest & trade / الحصاد والتجارة navigation groups, workflow policies
   (`cycle_order_per_field_project`, `harvest_batch_genealogy_enabled`,
   `field_cost_center_mandatory_on_cycle`, `scrap_reason_required`,
   `consumption_variance_threshold_pct: 5`, `livestock_serial_per_head`), series
   `CYC/GRN/INV/DLV/TRF` (`CYC-{yyyy}-{seq:5}` per-branch, reserved at release),
   inventory defaults (WAC costing, batch + expiry **on**, FEFO picking on, serial
   per-category opt-in, negative stock forbidden), report pins
   (`manufacturing.production_cost` on the dashboard), and onboarding steps (confirm
   the CoA with WIP, crop loss, and biological-asset accounts; fields as projects +
   cost centers; crop-cycle recipes; seeds/feed/inputs with batches; livestock items
   with head-level serials — OPTIONAL; run the first cycle: order → harvest intake →
   sale).
2. **Crop-cycle costing via `manufacturing.bom` + production orders scoped to
   `accounting.projects`**: the crop-cycle recipe is a versioned BOM (seeds/feed/
   fertilizer inputs + configured labor and overhead rates + yield; scrap factor =
   crop-loss allowance) bound at release; the cycle run is an ordinary
   `manufacturing.production_orders` order (DRAFT → RELEASED → IN_PROGRESS → COMPLETED
   / CANCELLED) **stamped with the field project and the crop cost center** (mandatory
   per policy `field_cost_center_mandatory_on_cycle`); one order per (field, cycle) —
   multi-crop rotations are separate cycle orders; WIP accumulates **per order** and
   nets to zero at completion (INV-010 continuous reconciliation); consumption posts
   **DR WIP · CR inventory at issue cost** (the G-17 consumption chain); completion
   posts the harvest at production cost — **DR finished-goods inventory · CR WIP**
   (G-17); crop loss posts **DR `PRODUCTION_SCRAP` (crop-loss expense) · CR WIP** with
   a reason code (G-18) and approval beyond the 5% consumption-variance threshold.
3. **Per-field / per-crop profitability**: the field = `accounting.projects` project +
   crop cost center stamp on every cycle order, input issue, and produce sale gives
   per-field profitability from existing dimensions —
   `manufacturing.production_cost` (planned vs actual inputs, yield, crop loss per
   cycle) scoped by project plus the cost-center/GL dimension
   (`accounting.cost-centers`, `financial.general-ledger`); everything reconciles to
   the GL (WIP per INV-010; COGS discipline per
   [INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §4).
4. **Harvest batches via `inventory.batch_tracking` with genealogy refs**: the
   completion step lands the **harvest batch دفعة الحصاد** as an `item_batches` row at
   production cost (FG layer @M/Q), carrying perishability windows (expiry on, FEFO
   issues); `manufacturing.batch_genealogy` links consumed input batches → harvest
   batch → produce sales (policy `harvest_batch_genealogy_enabled`; recall support);
   WIP → harvest batch values follow the **existing** inventory-accounting conventions
   — the batch lands at production cost, then WAC applies onward
   ([INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §1; no new
   valuation primitive).
5. **Livestock as serial-tracked items — OPTIONAL** (`inventory.serial_tracking`,
   per-category opt-in): one serial per head (رأس) with status per animal; intake
   through existing documents (goods receipt for purchases; existing adjustment paths
   for on-farm births at cost); no new tracking primitive and **no biological-asset
   revaluation** (IAS 41 fair value is not modeled — livestock and growing crops stay
   at cost through WIP; documented template limitation).
6. **Input purchasing (feed/seeds/supplies)**: purchase orders + goods receipts
   (**DR inventory · CR GRNI**, G-07) with supplier invoices clearing the accrual
   (G-08); input batches captured at receipt with expiry; `purchasing.landed_costs`
   (OPTIONAL) attaches freight/customs to imported inputs; no new purchasing surface.
7. **Produce sales**: invoices issue from harvest batches (FEFO): **DR AR/cash · CR
   revenue · CR VAT** (G-01/G-02 per the jurisdiction pack treatment) plus **DR COGS ·
   CR inventory** (G-03) at the batch's cost; the field project stamp on the sale
   completes the per-field profitability loop; buyers' post-dated cheques settle via
   `notes.received` (OPTIONAL, PHASE-027).
8. **Report packs** (existing PHASE-013 contract keys pinned at apply time — **no new
   report keys**): `manufacturing.production_cost` (dashboard), 
   `inventory.stock_valuation`, `inventory.expiry_list` (produce perishables),
   `manufacturing.batch_genealogy` (harvest traceability) — monetary totals carry GL
   tie-outs (INV-010 WIP; stock valuation vs the inventory account).
9. **Terminology + navigation patches**: the two manifest nav groups apply additively
   through the PHASE-015 nav registry — templates surface existing targets
   (`accounting.projects`, `manufacturing.bom`, `manufacturing.orders`,
   `inventory.batches`, `sales.invoices`, `inventory.serials`); core navigation groups
   are retained, never removed; RTL-first Arabic labels; machinery assets follow the
   **generic** fixed-asset lifecycle (PHASE-026) — this template introduces **no**
   agriculture-specific asset flow (none is needed).

Out of scope (explicit):

- **Precision agronomy / IoT** (soil sensors, drone imagery, irrigation telemetry),
  **weather integrations** (forecasts, growing-degree-day models), and **feed-mix
  optimization science** (least-cost ration formulation) — ED-11 deep-vertical
  operations; feed is a purchased input consumed by the cycle BOM, nothing more
  ([agriculture.md](../../industries/templates/agriculture.md)).
- Any new costing, genealogy, or tracking primitive; any new table, module, feature
  key, or permission (register §C/§D assign `industry.agriculture` none); anything
  that touches INV-022.
- Biological-asset fair-value accounting (IAS 41-style revaluation) — a future
  decision record would be required; co-product split (one FG item per production
  order line — the
  [food-manufacturing.md](../../industries/templates/food-manufacturing.md) limitation
  applies identically); field time capture (awaits the payroll module's financial
  scope, PHASE-029); deep-vertical agronomy decision records (ED-11 — see
  [DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)).

## 3. Prerequisites

- **PHASE-025 COMPLETE** (GA gate): stage-10 templates apply on the GA platform;
  stages 9–11 are additive releases that never alter the GA gate (ED-01). Verified via
  the completion report + green CI.
- **PHASE-015 COMPLETE** — the framework (functional prereq, register §B). Consumed
  artifacts: the template engine (apply/switch/extend with diff preview), terminology
  resolution, navigation registry, series/policy/report seeds, onboarding checklists,
  additive-only switching per BR-038, template audit events, and the seven governance
  tests. Verified via [PHASE-015.md](PHASE-015.md) completion report + green CI.
- **PHASE-018 COMPLETE** — BOM/production orders/WIP costing (functional prereq,
  register §B): versioned `manufacturing.bom` with scrap factors and yield,
  `manufacturing.production_orders` lifecycle, WIP per order reconciling to the GL
  (INV-010), configured labor/overhead absorption, batch genealogy, and the production
  goldens this phase re-runs agriculture-shaped (the G-17 completion chain, G-18
  scrap). Verified via [PHASE-018.md](PHASE-018.md) completion report + green CI.
- **PHASE-010 COMPLETE** (consumed as-is): batch tracking with expiry/FEFO, serial
  tracking per category (livestock), stock transfers, adjustments.
- **PHASE-019 COMPLETE** (OPT at the phase level per register §B — consumed as-is):
  the `accounting.projects` dimension for fields (its required manifest keys
  `accounting.projects`/`accounting.cost_centers` ship at PHASE-019, a pre-GA phase,
  so they are present on the GA platform; "OPT" means this phase's acceptance stamps
  the project dimension on agri documents rather than exercising CRM flows).
- Required architecture decisions:
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (a template applies inside
  one tenant and never crosses tenants),
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (zero new
  posting surfaces — the season rides existing engine rules G-07/G-08, G-17, G-18,
  G-01/G-02/G-03),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (costing, WIP, and
  valuation math as decimals at the canonical precision),
  [ADR-0016](../../architecture/ADR/ADR-0016-ui-tailwind-radix.md) (every surfaced
  screen instantiates a sanctioned archetype from the design system).
- Relevant documentation:
  [agriculture.md](../../industries/templates/agriculture.md) (the template —
  authoritative manifest),
  [food-manufacturing.md](../../industries/templates/food-manufacturing.md) (the BOM/
  production baseline + shared limitations),
  [industries/README.md](../../industries/README.md) §3 (manifest schema), §5
  (additive-only rules), §8 (the seven governance tests),
  [industry-workflows.md](../../industries/workflows/industry-workflows.md) (d) food
  manufacturing and (k) agriculture flows,
  [BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §6 (production run),
  [INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §1 (WAC
  conventions), §4 (COGS discipline),
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) §3 (G-07, G-08, G-17, G-18,
  G-01/G-02/G-03 rows),
  [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) (AGR
  column; `crop_cycle_costing`/`harvest_batches` rows),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-003, BR-016, BR-038),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.8
  (manufacturing keys; purchasing/sales keys reused),
  [industries/reports/README.md](../../industries/reports/README.md) (agriculture
  report row), [DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)
  (ED-09/ED-11), [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B/§L.

## 4. Design Impact

- **Database changes:** **none** — no new tables (register §C assigns
  `industry.agriculture` no entities; ED-09 is a configuration-layer template). The
  manifest ships as the extracted
  [manifest.agriculture.json](../../industries/templates/manifests/manifest.agriculture.json)
  (regenerated by `scripts/extract_manifests.py`); the configuration module's
  `industry_templates` registry row, series, policy defaults, report pins, and
  onboarding checklist are additive seeds. INV-022 unchanged — the config-fuzz suite
  re-runs to prove no accounting-mathematics change.
- **API changes:** none new — apply/switch/extend run through the existing
  configuration endpoints (PHASE-015) with diff preview and audit events; the season
  uses the existing manufacturing/purchasing/inventory/sales/treasury contracts
  verbatim.
- **UI changes:** the Season and Harvest & trade navigation groups surface existing
  screens re-labeled by terminology (fields & projects, crop-cycle recipes, cycle run
  orders, harvest batches, produce sales, livestock register); no new components or
  archetypes; all screens RTL-first with AR+EN baselines re-run.
- **Security & authorization:** no new permission keys — the template exercises the
  manufacturing, purchasing, inventory, and sales keys that already exist
  ([AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.8 + §2/§3
  rows); cycle-order release/completion approval rides the existing manufacturing
  policies; entitlement gating is per plan, fail-closed.
- **Accounting implications:** zero new posting rules — the season chain exercises
  G-07/G-08 (input purchases), the G-17 consumption/completion chain (DR WIP · CR
  inventory at issue cost; DR FG · CR WIP at production cost), G-18 (crop loss with
  reason), and G-01/G-02/G-03 (produce sale + COGS) with new document sources only;
  invariants reused: INV-008 (rates on imported-input FX purchases), INV-009 (buyer
  subledger on credit produce sales), INV-010 (WIP + stock valuation ↔ GL),
  INV-013 (idempotent operations), INV-018 (consumption/output atomicity), INV-021
  (series immutability), INV-022 (unchanged). The WIP, `PRODUCTION_SCRAP`, and
  inventory purpose mappings are required at onboarding (fail-closed
  `PURPOSE_NOT_MAPPED` otherwise).
- **Localization implications:** the full AR/EN terminology set from the manifest;
  Arabic-first labels (وصفات الدورات, أوامر تنفيذ الدورات, دفعات الحصاد, سجل الثروة
  الحيوانية); produce invoices and batch genealogy print bilingual RTL through the
  PHASE-013 print system; produce VAT treatment comes from the jurisdiction pack
  (REQUIRES_VERIFICATION — nothing fabricated here).
- **Offline implications:** none implemented — farm back-office flows are online
  surfaces; this template adds no offline capability rows and changes none
  ([OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  untouched by this phase).
- **Module dependencies:** `configuration` applies the template over `manufacturing`,
  `accounting` (projects/cost centers dimensions), `inventory`, `purchasing`, `sales`,
  `treasury`, and `reporting` — every module consumed through its published services;
  no module writes another's tables
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)); no new module and
  no new inter-module edge
  ([DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) unchanged).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Register + verify the manifest: `industry.agriculture` v1.0.0 row in the template registry (version, family), extracted manifest byte-verified against the embedded doc manifest, series/policy/report-pin/onboarding seeds | `docs/industries/templates/manifests/manifest.agriculture.json`, `apps/api/src/modules/configuration/infrastructure/seeds/**` | manifest JSON-Schema validation (governance #1); feature-key resolution closure test: all `required_feature_keys` resolve fail-closed (governance #2) |
| T2 | Apply + onboarding golden fixture: apply to a fresh tenant; snapshot nav tree, terminology resolution, numbering series (CYC per-branch, reserved at release), inventory defaults, report pins, onboarding checklist (AR + EN) | `apps/api/src/modules/configuration/**` (seeds + apply path), test fixtures under `tests/industries/agriculture/**` | golden onboarding fixture asserts every snapshot field (governance #3) |
| T3 | Season setup fixtures: field project + crop cost center pair; crop-cycle recipe (BOM with seeds/fertilizer inputs, configured labor/overhead rates, yield, crop-loss scrap factor); input items with batches; livestock category with head-level serials (OPTIONAL) | onboarding fixtures + `apps/api/src/modules/{accounting,manufacturing,inventory,items}/**` (config only) | project/cost-center stamp mandatory on cycle order (policy); BOM version bound at release; batch+expiry defaults on |
| T4 | Input purchases: seeds/feed via purchase order + goods receipt (G-07) with supplier invoice clearing the accrual (G-08); landed costs on imported inputs (OPTIONAL); input batches captured at receipt | `apps/api/src/modules/purchasing/**` (config only) | G-07/G-08 golden re-run agriculture-shaped (GRNI register clears exactly; landed-cost revalue before issue) |
| T5 | Cycle run + harvest intake: cycle order against the field project; input-batch consumption through the season (DR WIP · CR inventory at issue cost — the G-17 chain, genealogy links); completion posts the harvest batch at production cost (G-17: DR FG · CR WIP; FG layer @M/Q → WAC onward); crop loss with reason (G-18), escalation beyond the 5% threshold | `apps/api/src/modules/manufacturing/**` (config only) | **season golden**: production run per the existing G-17/G-18 goldens — WIP nets to zero per order (INV-010); genealogy input batches → harvest batch; consumption-variance threshold approval; zero residue on failure paths (`PERIOD_LOCKED`, `INSUFFICIENT_STOCK`, unmapped WIP/`PRODUCTION_SCRAP` purpose) |
| T6 | Livestock register (OPTIONAL): serial-tracked livestock category — one serial per head (رأس); intake via goods receipt (purchases) and existing adjustment paths (on-farm births at cost); status per animal | `apps/api/src/modules/inventory/**` (config only) | serial lifecycle tests re-run head-shaped; no biological-asset revaluation path exists (documented limitation asserted) |
| T7 | Produce sales: invoices issue from harvest batches (FEFO) — G-01/G-02 revenue + G-03 COGS at batch cost; field project stamp completes per-field profitability; buyers' PDC via `notes.received` (OPTIONAL) | `apps/api/src/modules/sales/**` (config only) | FEFO issue from the harvest batch fixture; COGS at the batch's production-cost-derived WAC; AR subledger INV-009; INV-010 conservation across the chain |
| T8 | Per-field profitability + report pack wiring: `manufacturing.production_cost` scoped by field project (planned vs actual inputs, yield, crop loss — dashboard), `inventory.stock_valuation`, `inventory.expiry_list`, `manufacturing.batch_genealogy` pins | `apps/api/src/modules/reporting/**` (config only) | **per-field profitability reconciliation**: production-cost pack + cost-center/GL dimension tie to the GL (WIP INV-010; stock valuation vs inventory account; COGS discipline §4) |
| T9 | Governance suite + switch safety + docs sync: run all seven governance tests; switch test (`industry.food_manufacturing` → `industry.agriculture` on a live tenant); degraded entitlement; RTL visual set; docs updates | `tests/industries/agriculture/**`, `docs/**` | all seven green (governance #1–#7); switch safety: zero data loss, archived capabilities read-only, series append-only; docs validation green |

## 6. Verification

**Automated tests (required):**

- **The seven governance tests** per
  [industries/README.md §8](../../industries/README.md), run for `industry.agriculture`:
  (1) manifest JSON-Schema validation; (2) feature-key resolution (fail-closed) for
  every required and prerequisite key; (3) golden onboarding fixture (AR + EN); (4)
  workflow smoke with expected journals — the season chain end-to-end; (5) switch
  safety — apply a template, create items/partners, post documents, switch to
  `industry.agriculture`, assert zero data loss and archived capabilities read-only;
  (6) RTL visual set (AR + EN screenshots of the season and harvest surfaces); (7)
  degraded entitlement — plan missing an OPTIONAL key (e.g.,
  `inventory.serial_tracking`, `manufacturing.batch_genealogy`, `purchasing.landed_costs`,
  `notes.received`) hides cleanly; missing a REQUIRED key (e.g., `manufacturing.bom`)
  blocks onboarding with actionable guidance.
- **Season end-to-end golden**: field project/BOM setup (no ledger) → input purchases
  (G-07: DR inventory · CR GRNI; G-08: supplier invoice clears the accrual; landed
  cost revalues where imported) → cycle run per the existing manufacturing goldens —
  input-batch consumption (DR WIP · CR inventory at issue cost), completion (G-17: DR
  FG · CR WIP at production cost; FG layer @M/Q; batch genealogy links; WIP nets to
  zero per order, INV-010), crop loss (G-18: DR `PRODUCTION_SCRAP` · CR WIP with
  reason; escalation beyond 5%) → harvest batch intake → produce sale (G-01/G-02
  revenue + G-03 COGS at batch cost, FEFO). Persisted journal lines asserted at every
  step; INV-013 idempotency; zero residue on every failure path (`PERIOD_LOCKED`,
  `INSUFFICIENT_STOCK`, `PURPOSE_NOT_MAPPED`).
- **Per-field profitability reconciliation**: on the golden fixture, the
  production-cost pack scoped to the field project plus the cost-center/GL dimension
  reconciles to the GL — Σ WIP per order = the WIP account (INV-010); stock valuation =
  the inventory account; COGS matches the issued batch costs; profit per field =
  field-attributed revenue − field-attributed cost, both tying to journal lines.
- **Inventory-conservation tests** across the season: inputs in − consumed −
  adjustments + harvest − sold = 0 across `stock_moves`; FEFO honored on produce
  batches; in-transit excluded (BR-016) for field-store → cold-store transfers.
- **Livestock tests** (OPTIONAL key present): one serial per head; purchase intake at
  cost; status transitions per animal; no revaluation path exists.
- **Invariant/config-fuzz re-run**: INV-022 proof — template apply/switch/policy churn
  never alters accounting mathematics or authorization.
- **Permission matrix re-run** for every surfaced route (no new keys; the existing
  checklist stays green); crop-loss approval rides the existing scrap policies.
- **Report fixtures** for all pinned keys with GL tie-outs where monetary.

**Manual verification:**

1. Apply `industry.agriculture` to a fresh tenant (AR UI): walk the onboarding
   checklist (CoA confirm with WIP/crop loss/biological assets; fields as projects +
   cost centers; recipes; inputs with batches; livestock items — optional; first
   cycle).
2. Run one season on fixtures: create the field project + wheat recipe → purchase
   seeds/fertilizer (goods receipt with batches) → release the cycle order → consume
   input batches through the season → record 3% crop loss with a reason → complete:
   the harvest batch lands at production cost with genealogy → sell produce from the
   batch (FEFO) → check `manufacturing.production_cost` (dashboard),
   `inventory.stock_valuation`, and the per-field profitability tie to the GL; drill
   a batch genealogy chain input batch → harvest batch → sale.
3. Add a livestock category with head-level serials; buy two heads via goods receipt;
   verify the register shows one serial per رأس at cost.
4. Switch a live food-manufacturing tenant to `industry.agriculture`: diff preview
   matches; posted history intact; archived entries read-only; switch back succeeds.

**Acceptance criteria (objective):** *(mirrored into
[PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md) — v2.0
section, PHASE-033.)*

1. `industry.agriculture` applies via the **unmodified** PHASE-015 engine and passes
   all seven governance tests; a needed engine change is a PHASE-015 defect fixed
   there.
2. The season flow runs end-to-end on the template tenant — field project/BOM setup →
   input purchases (G-07/G-08) → production run per the existing G-17/G-18
   manufacturing goldens (consumption, completion at production cost, crop loss with
   reason) → harvest batch intake (genealogy linked) → produce sale (G-01/G-02/G-03,
   FEFO) — with persisted journal lines asserted at every step and zero residue on
   failure paths.
3. WIP nets to zero per cycle order and reconciles to the GL continuously (INV-010);
   the harvest batch lands at production cost and then values at WAC per the existing
   inventory-accounting conventions — no new valuation primitive.
4. The **per-field profitability pack reconciles to the GL**: production-cost scoped
   by field project + cost-center/GL dimension tie line-by-line to journal lines on
   the fixture data.
5. Livestock (when the OPTIONAL serial key is enabled) track one serial per head via
   the existing serial primitives — no new tracking surface; no revaluation path.
6. All pinned report keys run on the PHASE-013 contract with GL tie-outs; **no new
   report keys, feature keys, permission keys, tables, or modules exist**; INV-022 is
   unchanged (config-fuzz proof attached).
7. Additive switching per BR-038 is proven against a live tenant (zero data loss;
   archived capabilities read-only; series append-only).
8. CAPABILITY_MATRIX keeps its AGR column and `crop_cycle_costing`/`harvest_batches`
   rows with citations (landed with the v2.0 doc sync); docs validation green;
   identifiers match the register exactly (ED-09, §D keys reused, none new).

**Performance & security considerations:** template apply p95 within the PHASE-015
budget on the onboarding fixture; production-cost and genealogy queries ride the
existing manufacturing/inventory read-model indexes; entitlement checks are
fail-closed on every surfaced route; the consumption-variance threshold (5%) and
scrap-approval escalation reuse existing manufacturing policies — no new approval
surface; no agronomy telemetry exists to secure by design (ED-11).

**Migration & rollback:** **no schema migration** — additive seeds and a registry row
only. Rollback = switch away or archive the template per
[industries/README.md §5](../../industries/README.md) additive rules + entitlement
removal (read-only historical access per
[SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md));
posted purchases, cycle orders, harvest batches, sales, and journals are ordinary
documents and remain valid regardless of the active template.

## 7. Risks and Constraints

- **RISK-002** (template genericity): farm models vary (open-field vs greenhouse,
  per-head vs per-batch livestock) — mitigated by manifest terminology/policies and
  the two design-partner validations required at rollout.
- **RISK-019** (implementing beyond phase): the tempting overreach is agronomy science
  (IoT sensors, weather, feed-mix optimization) and a bespoke crop-costing engine —
  both explicitly out of scope; the completion report must show zero non-configuration
  code and zero new engine surfaces.
- **RISK-009** extension (accounting bugs): the season chain touches WIP, scrap, and
  batch valuation — mitigated by re-running the existing G-17/G-18 goldens
  agriculture-shaped plus the INV-010 conservation suite before any UI polish counts
  as done; drift between the production-cost pack and the GL is Sev-1.
- **RISK-016** (boundary erosion): the template must not bypass manufacturing/purchasing
  services to "simplify" the season — dependency-cruiser rules apply unchanged.
- Constraint: one FG item per production order line (no co-product split) —
  multi-crop rotations are separate cycle orders; the food-manufacturing limitation
  applies identically.
- Constraint: labor and overhead absorb at configured rates per cycle order; actual
  field time capture awaits the payroll module's financial scope (PHASE-029).
- Constraint: biological-asset revaluation (IAS 41-style fair value) is not modeled —
  livestock and growing crops stay at cost; a future decision record would be required
  for fair-value accounting.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-033-COMPLETION.md` with: all seven
  governance-test outputs (AR + EN), the season end-to-end golden output (G-07/G-08,
  G-17 chain, G-18, G-01/G-02/G-03 journal lines), the per-field profitability
  reconciliation output, INV-010 conservation output, switch-safety output, report GL
  tie-outs, the INV-022 config-fuzz proof, permission checklist output, RTL visual
  set, and docs validation.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-033 →
  COMPLETE), CURRENT_STATE, CHANGELOG,
  [INDUSTRY_CATALOG.md](../../product/INDUSTRY_CATALOG.md) pointer check (already
  points at PHASE-033), [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md)
  AGR row citation check, [industries/templates/README.md](../../industries/templates/README.md)
  phase-map row check, and the
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) stage-10 progress note.
- **Exit criteria:** all acceptance criteria green with evidence; the template is live
  via the unmodified engine; ED-09 is delivered as a commercial shell only (ED-11
  respected); zero new schema/keys/modules.
- **Definition of Done:** manifest + seeds + governance tests + season golden +
  per-field reconciliation + switch-safety + report fixtures merged; CI green; docs
  synchronized; zero TODOs in the delivered scope; the config-fuzz suite still proves
  INV-022.
- **Handoff instructions:** read the PHASE-033 completion report. With stage 10
  complete (PHASE-030…033), stage 11 opens: PHASE-034 (Multi-Entity Consolidation)
  is the final roadmap phase — its functional prereqs (PHASE-013 reporting engine,
  PHASE-026 fixed assets, PHASE-029 payroll, dated FX from PHASE-007) are all
  post-GA/pre-stage-11 complete; the consolidation agent needs the completed member
  book surfaces that stages 9–10 prove. **Next eligible phase: PHASE-034 —
  Multi-Entity Consolidation** (identify only, do not implement).
