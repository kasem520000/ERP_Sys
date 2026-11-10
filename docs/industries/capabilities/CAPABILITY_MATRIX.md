# Shared Capability Matrix

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-11-02

The catalog of reusable capabilities every industry composes from. A **capability** is a
named, testable bundle of behavior provided by feature(s) of one or more modules
([../../architecture/MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)).
Templates reference these ids in `capability_prerequisites`
([../README.md](../README.md) §3); they never redefine them. **Feature keys cite the canonical
registry** [../../product/FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) — with one
small declared exception set pending catalog intake (see §3).

**Legend:** **REQ** = included as REQUIRED by the template · **OPT** = offered as OPTIONAL ·
**N/A** = not applicable. Industry columns: RET retail · GRO grocery/supermarket ·
RST restaurant/café · AUT automotive/workshop · DST distribution/field sales ·
MFG food manufacturing · SVC professional services · RNT rental/logistics ·
WHL wholesale/trade · ELC mobile & electronics · HLT healthcare (commercial shell) ·
EDU education (commercial shell) · AGR agriculture (commercial shell) — the last five
are v2.0 templates ([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §L).

## 1. Matrix

| Capability | RET | GRO | RST | AUT | DST | MFG | SVC | RNT | WHL | ELC | HLT | EDU | AGR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `barcode_pos` | REQ | REQ | REQ | OPT | OPT | OPT | N/A | OPT | OPT | REQ | OPT | N/A | N/A |
| `scale_barcodes` | N/A | REQ | OPT | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| `table_service` | N/A | N/A | REQ | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| `kitchen_display` | N/A | N/A | OPT | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| `cashier_shifts` | REQ | REQ | REQ | OPT | REQ | OPT | OPT | OPT | OPT | REQ | OPT | OPT | OPT |
| `composite_kits` | OPT | OPT | REQ | OPT | OPT | OPT | N/A | N/A | N/A | OPT | N/A | N/A | N/A |
| `expiry_tracking_fefo` | OPT | REQ | REQ | N/A | REQ | REQ | N/A | N/A | OPT | N/A | REQ | N/A | REQ |
| `imei_tracking` | OPT | N/A | N/A | N/A | N/A | N/A | N/A | N/A | OPT | REQ | N/A | N/A | N/A |
| `job_cards` | N/A | N/A | N/A | REQ | N/A | N/A | OPT | OPT | N/A | REQ | REQ | N/A | N/A |
| `customer_price_tiers` | OPT | REQ | N/A | REQ | REQ | OPT | OPT | OPT | REQ | OPT | OPT | OPT | OPT |
| `free_goods_promo` | OPT | REQ | OPT | OPT | REQ | N/A | N/A | N/A | OPT | OPT | N/A | N/A | N/A |
| `commissions` | OPT | OPT | N/A | OPT | REQ | N/A | OPT | OPT | OPT | OPT | N/A | N/A | OPT |
| `van_stock` | N/A | N/A | N/A | N/A | REQ | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| `route_planning` | N/A | N/A | N/A | N/A | REQ | N/A | N/A | OPT | OPT | N/A | N/A | N/A | N/A |
| `field_collections` | N/A | N/A | N/A | N/A | REQ | N/A | N/A | REQ | OPT | N/A | N/A | N/A | N/A |
| `bom_production` | N/A | N/A | OPT | N/A | N/A | REQ | N/A | N/A | N/A | N/A | N/A | N/A | REQ |
| `batch_genealogy` | N/A | N/A | N/A | N/A | N/A | REQ | N/A | N/A | N/A | N/A | N/A | N/A | OPT |
| `qc_inspections` | N/A | OPT | OPT | OPT | N/A | REQ | N/A | N/A | N/A | N/A | N/A | N/A | OPT |
| `service_contracts` | N/A | N/A | N/A | OPT | N/A | N/A | REQ | REQ | N/A | OPT | OPT | REQ | N/A |
| `recurring_billing` | N/A | N/A | N/A | OPT | N/A | N/A | REQ | REQ | N/A | N/A | N/A | OPT | N/A |
| `rental_contracts` | N/A | N/A | N/A | N/A | N/A | N/A | N/A | REQ | N/A | N/A | N/A | N/A | N/A |
| `deposits_late_fees` | N/A | N/A | N/A | N/A | N/A | N/A | OPT | REQ | N/A | N/A | N/A | OPT | N/A |
| `shipment_tracking` | N/A | N/A | N/A | N/A | OPT | N/A | N/A | REQ | OPT | N/A | N/A | N/A | OPT |
| `landed_costs` | OPT | OPT | N/A | OPT | OPT | OPT | N/A | N/A | OPT | OPT | N/A | N/A | OPT |
| `pdc_notes` | OPT | OPT | OPT | OPT | REQ | OPT | REQ | OPT | REQ | OPT | REQ | OPT | OPT |
| `installment_terms` | OPT | N/A | N/A | OPT | OPT | N/A | OPT | OPT | OPT | OPT | OPT | REQ | N/A |
| `insurance_claim_billing` | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | REQ | N/A | N/A |
| `crop_cycle_costing` | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | REQ |
| `harvest_batches` | N/A | N/A | N/A | N/A | N/A | OPT | N/A | N/A | N/A | N/A | N/A | N/A | REQ |

## 2. Capability definitions

Phases reference the [master roadmap](../../planning/MASTER_ROADMAP.md). All journals below
are produced through the centralized
[posting engine](../../accounting/POSTING_ENGINE.md) — capabilities never write to the GL.

### 2.1 Front-line selling (POS)

**`barcode_pos`** — Scanner-first, keyboard-fast counter selling on registered terminals:
basket building with barcode/quick-key entry, price list + promotion resolution, split
payment (cash/card), fiscal receipt printing (80/58 mm), and an offline sale queue with
`OFF-…` numbers that sync to posted invoices
([ADR-0012](../../architecture/ADR/ADR-0012-offline-sync.md)).

- **Providing modules:** `pos` (terminals, terminal UX, receipt printing, offline queue);
  `sales` (the POS sale is a sales-module invoice document with POS channel and
  `cash_sales_autopost` policy).
- **Feature keys:** `pos.terminals`, `pos.sales`, `pos.offline_queue`, `pos.receipts`.
- **Phase:** PHASE-016 (offline queue included; sync protocol generalized in PHASE-020).
- **Extension rules:** Any stock-selling industry may add it; it never issues stock directly
  — stock issue + COGS happen at invoice posting via the inventory module. Templates choose
  receipt size and autopost policy; tax layout comes from the jurisdiction pack.

**`scale_barcodes`** — Parsing of weight-embedded barcodes (random-weight/scale labels) at
POS: the scanned code resolves item + weight (or price), producing a weighed sale line.

- **Providing modules:** `pos` (scan/parse at terminal); `items` (barcode registry, UoM).
- **Feature keys:** `pos.barcode_scanning` (consumes `items.barcodes`).
- **Phase:** PHASE-016.
- **Extension rules:** Requires the item to be scale-flagged with a weight UoM. Never alters
  valuation math; weighed lines value at the item's normal costing method.

**`table_service`** — Dining-room floor plan: tables/zones, open orders per table, order
types (dine-in / takeaway / delivery), item sends and merges, guest check transfer/split,
and table-status board.

- **Providing modules:** `pos` (floor plan + order state); `sales` (invoice at payment).
- **Feature keys:** `pos.table_service`.
- **Phase:** PHASE-016.
- **Extension rules:** Kitchen-facing behavior belongs to `kitchen_display`, not here. Unpaid
  open tables hold no ledger effect until the check is paid
  ([../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §1).

**`kitchen_display`** — Routing of order items to kitchen preparation points: ticket
printing at PHASE-016, with a screen-based kitchen display system (KDS) tracked as a
roadmap extension (bump status, prep timers — not yet scheduled to a phase).

- **Providing modules:** `pos`.
- **Feature keys:** `pos.kitchen_display`.
- **Phase:** PHASE-016 (ticket printing); screen KDS = roadmap extension, no committed phase.
- **Extension rules:** Display concerns only — it never mutates order amounts or posts
  anything; item preparation/recipe depletion is `composite_kits` / `bom_production`.

### 2.2 Counter & cash discipline

**`cashier_shifts`** — Cashier accountability sessions: opening float, expected cash
computation, blind close count, variance posting, and per-shift sales reporting
("Z" close).

- **Providing modules:** `treasury` (owns `cashier_shifts`, cash accounts, variance
  journals); `pos` (POS-grade shift UX, `pos.shifts`).
- **Feature keys:** `treasury.cashier_shifts`, `pos.shifts`.
- **Phase:** PHASE-008 (shift core, FR-TRS-004) / PHASE-016 (POS-grade terminal UX).
- **Extension rules:** Variance always posts (shortage → expense; overage → income line
  with approval policy) — the platform never nets silently. Used unchanged by POS
  terminals, van reps (with `field_collections`), and rental counters.

**`composite_kits`** — Composite products: bundles/combos sold as one line that consume
component items (exploded at posting), with optional price override; components can
themselves be composite (one level).

- **Providing modules:** `items` (composite definition); `inventory` (explosion + issue);
  `pos`/`sales` (selling line).
- **Feature keys:** `items.composite_products`.
- **Phase:** PHASE-015 (catalog); first high-volume consumers are restaurant combos and
  retail bundles at POS (PHASE-016).
- **Extension rules:** Kit explosion issues components at their own cost (COGS journal per
  component); full multi-level recipes with yield belong to `bom_production`.

### 2.3 Inventory intelligence

**`expiry_tracking_fefo`** — Batch/lot records with expiry dates and FEFO (first-expiry,
first-out) issue discipline: nearest-expiry batch proposed/forced at POS and back-office
issues, expiry-bucketed reporting, and a governed write-off path.

- **Providing modules:** `inventory` (`item_batches`, picking rules, write-off adjustment).
- **Feature keys:** `inventory.batch_tracking` (the catalog feature includes batches,
  expiry, FEFO issuing, and the expiry write-off workflow; FEFO strictness per template is
  the `fefo_picking` inventory policy).
- **Phase:** PHASE-010 (tracking) — FEFO picking defaults per template from PHASE-015.
- **Extension rules:** Tracked dimensions change *which* units are issued, never the
  valuation math ([../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md)
  §5). Write-offs post as shrinkage with reason `EXPIRED` behind an approval policy.

**`imei_tracking`** — Per-device identity (IMEI/serial) for mobile phones and similar
devices: receive-in register, sale-out linkage, service/repair lookup, and an IMEI ledger
report.

- **Providing modules:** `inventory` (`item_serials` with IMEI type).
- **Feature keys:** `inventory.serial_tracking` (the catalog feature explicitly covers
  serial **and IMEI** tracking with per-unit status; IMEI is its device specialization).
- **Phase:** PHASE-010.
- **Extension rules:** IMEI is a serial-number specialization — it reuses serial capture at
  GRN and sale, and forbids sale of an unregistered IMEI for flagged items. Returns re-enter
  at original cost via credit note.

**`landed_costs`** — Allocation of freight/customs/insurance into received item cost by
value or quantity, revaluing WAC/layers with a documented COGS-adjustment path for stock
already issued.

- **Providing modules:** `purchasing` (cost components on GRN); `inventory` (revaluation).
- **Feature keys:** `purchasing.landed_costs`.
- **Phase:** PHASE-015 (full workflow per catalog; the GRN allocation mechanics are
  specified against the PHASE-011 goods-receipt baseline in
  [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §3).
- **Extension rules:** Follows
  [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §3
  exactly — no silent back-dating; allocation basis is tenant-configurable per receipt.

### 2.4 Field & route operations

**`van_stock`** — Vehicle stock: each van is a warehouse of type VAN assigned to a
representative; load-out/unload are stock transfers (in-transit visible); sales issue from
van stock; end-of-day balances must reconcile to settlements.

- **Providing modules:** `distribution` (van registry, load-out documents); `inventory`.
- **Feature keys:** `distribution.van_stock`.
- **Phase:** PHASE-017 (**shipped** — online/back-office; VAN-typed warehouses fed by
  ordinary transfers, the `van_stocks` mirror, and the conservation tie); offline van
  selling arrives with the Android field-sales app in PHASE-022.
- **Extension rules:** A van is never a valuation account of its own unless the tenant
  maps branch-distinct accounts; transfers otherwise post no journal
  ([../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §2).

**`route_planning`** — Route calendars: customers grouped into routes with planned visit
days; visit plan vs. actual visit reporting; sequencing within the day.

- **Providing modules:** `distribution` (`routes`, `route_visits`).
- **Feature keys:** `distribution.routes`.
- **Phase:** PHASE-017 (**shipped** — `routes`/`route_customers`/`route_visits` as
  planning data that posts nothing; visit completion links the day's documents).
- **Extension rules:** Planning data only — it drives no posting; actual visits are recorded
  from sales documents or explicit check-ins. GPS/telematics is out of scope (see
  [../templates/distribution-field-sales.md](../templates/distribution-field-sales.md)).

**`field_collections`** — Representative collection of customer receivables in the field:
receipts created against open AR during visits, with rep cash accounts, allocation rules,
and settlement integration.

- **Providing modules:** `distribution` (visit context, rep cash accountability);
  `treasury` (receipt posting, rep cash account); `sales` (AR subledger allocation).
- **Feature keys:** `treasury.receipts_disbursements` (receipts engine, PHASE-008) — the
  visit-linked collections UX and rep-cash discipline ship with `distribution` in
  PHASE-017.
- **Phase:** PHASE-017 (**shipped** — field-collection flows: visit-linked collections
  with rep cash accountability and the day-end settlement; receipts themselves are MVP).
- **Extension rules:** Collections are ordinary receipts (DR rep cash · CR AR control,
  partner-tagged) — never revenue; idempotency keys protect offline re-submission later.

### 2.5 Pricing, promotion & people

**`customer_price_tiers`** — Customer segments mapped to price lists (e.g., retail /
wholesale / VIP), resolved automatically by partner tier at sale time, with tier-specific
discount caps.

- **Providing modules:** `items` (price lists); `partners` (tier on partner); `sales`.
- **Feature keys:** `distribution.customer_tiers`.
- **Phase:** PHASE-017 (**shipped** — the BR-003 tier level between the customer's own
  list and base price; assignment on `partners.customer_tier_id`); price lists core
  since PHASE-006/012.
- **Extension rules:** Tier resolution never overrides an explicitly quoted price; tier
  discounts affect revenue only (COGS untouched per
  [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §4).

**`free_goods_promo`** — Free-of-charge lines and promotions: FOC lines on sales documents
(MVP), plus buy-X-get-Y and bundle promotions with effectiveness reporting (PHASE-017).

- **Providing modules:** `sales` (line/document discounts + FOC lines); `distribution`
  (rule-based free-goods engine applied on van/POS sales).
- **Feature keys:** `sales.discount_management` (PHASE-012), `distribution.free_goods` (PHASE-017).
- **Phase:** PHASE-012 (FOC lines) / PHASE-017 (**shipped** — rule-based promotions:
  buy-X-get-Y rules, per-tier scoping, reason-coded zero-price lines with full COGS).
- **Extension rules:** Free goods still issue stock and post COGS (goods left the shelf);
  the revenue side is zero-value — promotions are contra-revenue, never COGS manipulations.

**`commissions`** — Representative commission calculation: per-rep commission rules
(percentage/tiered on collected or invoiced sales), accrual postings, and commission-due
reports.

- **Providing modules:** `sales` (`sales_reps`, commission rules); `treasury` (payout via
  payment); `accounting` (accrual purposes).
- **Feature keys:** `sales.commissions`.
- **Phase:** PHASE-017 (**shipped** — FR-SAL-007; runs with accrual posting at run
  time).
- **Extension rules:** Commission accrual is an expense posting — it never modifies the
  sales invoice or its VAT. Payouts are ordinary payments through treasury. Payroll is a
  platform non-goal; commission payout ≠ salary.

### 2.6 Workshop & service work

**`job_cards`** — The work-order document combining service lines (labor, billed at rates)
and item lines (parts), from check-in through diagnosis quote, approval, execution,
invoicing, and warranty credit notes.

- **Providing modules:** `sales` (job-card document, quotation→invoice chain); `inventory`
  (parts reservation/issue); `crm` (service-order generalization, PHASE-019).
- **Feature keys:** `sales.job_cards` (FEATURE_CATALOG row since PHASE-017 — the §3
  intake completed in-phase per the §25 protocol).
- **Phase:** PHASE-017 (**shipped** — migration `0025_automotive_distribution.sql`);
  links/upgrade path to `crm.service_orders` in PHASE-019.
- **Catalog reconciliation (resolved PHASE-017):** the feature catalog had modeled job
  cards under `crm.service_orders` (PHASE-019, depending on `crm.service_contracts`),
  while the roadmap required the job-card workflow template at PHASE-017 — before the
  `crm` module exists (module phases per
  [MODULE_BOUNDARIES](../../architecture/MODULE_BOUNDARIES.md)). Resolution taken:
  PHASE-017 ships `sales.job_cards` as a sales-module document type with no contract
  dependency (deps `sales.quotations` + `inventory.reservations`); PHASE-019 generalizes
  it into `crm.service_orders`. The catalog row, plan grants (business/enterprise), and
  the `sales.job_cards.manage` permission seed all landed with migration 0025.
- **Extension rules:** Labor lines are non-stock service lines — with no payroll module,
  actual technician cost is not tracked; profitability uses parts margin + labor revenue
  (documented limitation). Parts flow is policy-driven: reserve-then-invoice (default) or
  issue-at-issue-time with immediate COGS.

### 2.7 Production & quality

**`bom_production`** — Bills of materials (recipes) with yield, production orders,
material consumption, WIP, finished-goods receipt, and scrap.

- **Providing modules:** `manufacturing` (BOM, production orders, WIP, costing).
- **Feature keys:** `manufacturing.bom`, `manufacturing.production_orders`.
- **Phase:** PHASE-018.
- **Extension rules:** Posting follows the canonical production rules (DR FG · CR WIP at
  completion; DR WIP · CR inventory at consumption; DR scrap expense · CR WIP —
  [../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4). Restaurant
  "prep recipes" reuse this capability at small scale, optionally.

**`batch_genealogy`** — Traceability tree linking finished batches to consumed material
batches (upstream) and to downstream sales (recall support), including rework links.

- **Providing modules:** `manufacturing` (consumption records); `inventory` (batch ids).
- **Feature key:** `manufacturing.batch_genealogy`.
- **Phase:** PHASE-018.
- **Extension rules:** Requires `bom_production` + `expiry_tracking_fefo`. Read-only
  analytics + recall listing — it does not alter posted documents.

**`qc_inspections`** — Inspection checkpoints with pass/fail/sampled results and
dispositions (accept, scrap, rework, return-to-supplier) attachable to goods receipts,
production completions, and returns.

- **Providing modules:** `manufacturing` (`inspections`).
- **Feature key:** `manufacturing.qc`.
- **Phase:** PHASE-018 (QC basics).
- **Extension rules:** A REQUIRED QC gate at production completion can quarantine finished
  goods (stock status, not a new ledger state) until inspection passes. Before PHASE-018,
  industries approximate receiving QC via count/adjustment reason codes — templates must
  say so honestly (see grocery template).

### 2.8 Contracts & billing

**`service_contracts`** — Ongoing service agreements: scope, term, billing schedule
(retainer/milestones/usage), renewal and expiry states, linked documents.

- **Providing modules:** `crm` (`service_contracts`).
- **Feature key:** `crm.service_contracts`.
- **Phase:** PHASE-019.
- **Extension rules:** The contract itself posts nothing; only its generated documents do.
  Extended by `recurring_billing`, `rental_contracts`, and `deposits_late_fees`.

**`recurring_billing`** — Schedule-driven generation of draft invoices from contracts
(monthly retainers or milestones), idempotent per (contract, period), with approval and
posting through the standard invoice lifecycle.

- **Providing modules:** `crm` (schedule + draft generation); `sales` (invoice document).
- **Feature key:** `crm.recurring_billing`.
- **Phase:** PHASE-019.
- **Extension rules:** One invoice per (contract, period) enforced by idempotency; billing
  runs never bypass approval policies or period locks; cancellations use credit notes, never
  in-place edits.

**`rental_contracts`** — Rentable-asset contracts: reservation, pickup/return events,
rate tables (daily/weekly/monthly), asset availability calendar, and per-asset revenue
history. Assets are serial-tracked items.

- **Providing modules:** `crm` (contract specialization over `crm.service_contracts`);
  `items`/`inventory` (asset = serial item); `reporting` (utilization).
- **Feature key:** `crm.rental_contracts` (proposed key — see §3; the industry catalog
  models rental terms as a `crm.service_contracts` specialization, which is exactly the
  extension mechanism this key names).
- **Phase:** PHASE-019.
- **Extension rules:** Extends `service_contracts`; the asset never leaves inventory
  valuation while on rent (it stays in stock, flagged as "out on rent" — no COGS at
  pickup). Damage/late charges are invoiced lines whose tax treatment resolves through the
  tenant's tax code and jurisdiction pack — nothing is hard-coded.

**`deposits_late_fees`** — Contract security deposits (received, held, released, or
applied) and late-return/late-payment fee charge lines generated from contract terms.

- **Providing modules:** `crm` (deposit terms, fee generation); `treasury` (money movement);
  `partners`/`sales` (on-account open items and allocation, BR-027).
- **Feature keys:** `crm.contract_deposits`, `crm.late_fees` (proposed keys — see §3).
- **Phase:** PHASE-019.
- **Extension rules:** A deposit is received as an **on-account amount** (BR-027): an
  explicit, allocatable credit open item on the partner subledger — never revenue, never
  silently netted. When the template's `deposits_distinct_liability` policy is ON (rental
  default), the on-account line posts to the `DEPOSITS_RECEIVED` account purpose instead of
  the AR control
  ([../../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md) §4);
  release refunds it via payment (mirror), and application against charge invoices is an
  allocation. Late-fee taxation follows tax-code resolution — no invented treatment.
  Professional-services retainers are normally plain recurring billing; the deposit
  mechanism is used only where engagement terms genuinely hold client funds.

**`shipment_tracking`** — Consignment/shipment records with tracking references, milestone
status board (booking → pickup → in transit → customs → delivered), and aging — manual
milestones first, carrier-adapter feeds with PHASE-023 integrations.

- **Providing modules:** `distribution` (shipment entity + milestones); adapters (PHASE-023).
- **Feature key:** `distribution.shipment_tracking` (proposed key — see §3).
- **Phase:** PHASE-019 (manual milestones); PHASE-023 (carrier/shipping adapters).
- **Extension rules:** Status tracking only; freight revenue is billed via ordinary service
  invoices (per shipment or per contract). No tracking-number-based legal claims — printed
  waybills follow jurisdiction pack rules where applicable.

### 2.9 Credit instruments, claims & commodity cycles (v2.0)

**`pdc_notes`** — Cheques & promissory notes lifecycle: received/issued notes with partner,
maturity date, and status (custody → endorse/deposit → collect / dishonor / discount /
return), an auto-derived PDC maturity calendar, and dunning registers. Delivered by the
`notes` module (PHASE-027, ED-03); all postings go through the engine.

- **Providing modules:** `treasury`/`notes` (note + event registers, calendar);
  `accounting` (posting only via engine).
- **Feature keys:** `notes.received`, `notes.issued`, `notes.pdc_calendar`,
  `notes.endorsement`, `notes.dishonor`, `notes.discounting`, `notes.reports`.
- **Phase:** PHASE-027.
- **Extension rules:** A received note settles the AR open item at custody
  (**G-24**: DR `NOTES_RECEIVABLE` · CR `AR_CONTROL`); collection posts **G-25**;
  dishonor restores the AR open item exactly (**G-26**, BR-046; fee via `BANK_CHARGES`);
  endorsement moves custody with **no** journal (BR-047); INV-024 binds note custody to
  its journal effects. Any stock-selling/service industry with credit customers may add it.

**`installment_terms`** — Customer installment plans over a source invoice: plan header
(total = source document total, BR-048), down payment, frequency (weekly → quarterly),
immutable schedule after activation, collection runs allocating receipts to installment
lines, and per-plan late-fee policies (rate + cap + grace — PLACEHOLDER defaults, BR-049).

- **Providing modules:** `sales` (AR open items, source documents); `treasury`
  (receipt posting); `accounting` (late fee via engine).
- **Feature keys:** `installments.plans`, `installments.schedules`,
  `installments.collections`, `installments.late_fees`, `installments.reports`.
- **Phase:** PHASE-027.
- **Extension rules:** Receipts reuse the ordinary customer-receipt posting (**G-05**
  shape: DR cash/bank · CR `AR_CONTROL`); the late fee posts only via the engine
  (**G-28**: DR `AR_CONTROL` · CR `LATE_FEE_INCOME`); schedule edits after activation are
  blocked — waivers/cancellations are explicit documents (credit lines / waived status),
  never silent edits.

**`insurance_claim_billing`** — Per-claim receivables from third-party payers: invoices
billed to the payer partner carry a claim reference; each claim tracks as its own open
item on the payer subledger; claim cheques/PDC arrive via `pdc_notes`; dunning and aging
run per claim, not only per payer.

- **Providing modules:** `sales` (invoice + claim reference); `partners` (payer files,
  statements); `treasury`/`notes` (claim cheques via `notes.received`).
- **Feature keys:** `sales.invoices`, `partners.statements`, `notes.received`.
- **Phase:** composed by the healthcare template at PHASE-031 (underlying keys:
  PHASE-006/012/027); ED-07 bounds it to the financial layer — no clinical data.
- **Extension rules:** No new document types: the claim is a reference stamped on
  invoices/notes/allocations; rejection/appeal beyond credit notes is manual bookkeeping.
  Claims adjudication (approval rules, tariff engines) is out of scope.

**`crop_cycle_costing`** — Season/cycle costing over the production engine: a crop-cycle
recipe (BOM of seeds/feed/fertilizer + labor + overhead rates with yield) runs as a
production order stamped with a field project and crop cost center; WIP accumulates inputs
through the cycle; completion lands the harvest at production cost; per-field profitability
comes from the project dimension.

- **Providing modules:** `manufacturing` (BOM, production orders, WIP, costing);
  `accounting` (projects/cost centers, posting via engine).
- **Feature keys:** `manufacturing.bom`, `manufacturing.production_orders`,
  `accounting.projects`, `accounting.cost_centers`.
- **Phase:** composed by the agriculture template at PHASE-033 (underlying keys:
  PHASE-018/019); ED-09 bounds it to the commercial shell.
- **Extension rules:** Reuses the canonical production postings (consumption DR WIP ·
  CR inventory; completion **G-17**; scrap **G-18**) unchanged — the capability adds the
  field/crop analytical stamps, never new ledger shapes. Biological-asset fair-value
  accounting (IAS 41-style) is explicitly not modeled.

**`harvest_batches`** — Batch-tracked harvest output: the completed production order lands
a harvest batch (with perishability/expiry window); genealogy links consumed input batches
(seed/seedling/feed lots) to the harvest batch and onward to sales lines; FEFO issues and
expiry write-off reuse `expiry_tracking_fefo` unchanged.

- **Providing modules:** `inventory` (batches, picking, write-off); `manufacturing`
  (consumption records → genealogy edges).
- **Feature keys:** `inventory.batch_tracking`, `manufacturing.batch_genealogy`.
- **Phase:** batches PHASE-010; genealogy PHASE-018; composed by the agriculture template
  at PHASE-033. Food manufacturing already consumes the same batch machinery (MFG OPT).
- **Extension rules:** Read-only traceability — genealogy never alters posted documents;
  write-offs post as shrinkage with reason `EXPIRED` behind an approval policy
  ([../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §5).

## 3. Catalog alignment — keys pending FEATURE_CATALOG intake

Every feature key used in template manifests resolves in the canonical registry
([../../product/FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md)) **except** the
keys below, which the industry templates require and this matrix proposes through the
catalog's §5 maintenance protocol (definitions below are the proposing source of truth;
no entitlement is grantable until the catalog row exists — until then the owning template
capability is phase-gated/optional and degrades per [../README.md](../README.md) §5 R10).

> **v2.0 note:** the stage-9 module keys (`notes.*`, `installments.*`, `fixed_assets.*`,
> `budgeting.*`, `payroll.*`, `consolidation.*`) are canonical registry keys per
> [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §D and enter the catalog
> through the same §5 intake — they are **not** part of the pending set above and are
> phase-gated (PHASE-026…034) rather than degraded.

| Proposed key | Capability | Definition (one line) | Target phase |
|---|---|---|---|
| `crm.rental_contracts` | `rental_contracts` | Rental specialization of service contracts: reservation, pickup/return, rate tables, availability | **deferred** (PHASE-019 shipped without it — decision record in [../../implementation/phases/reports/PHASE-019-COMPLETION.md](../../implementation/phases/reports/PHASE-019-COMPLETION.md); the base `service_contracts` capability is live) |
| `crm.contract_deposits` | `deposits_late_fees` | Contract security deposits as on-account credit items (BR-027), optionally posted to `DEPOSITS_RECEIVED` | **deferred** (same decision record — advances use the plain on-account + DEFERRED_REVENUE reclass path; the DEPOSITS_RECEIVED liability split is NOT implemented) |
| `crm.late_fees` | `deposits_late_fees` | Contract-term late-return/late-payment charge generation | **deferred** (same decision record) |
| `distribution.shipment_tracking` | `shipment_tracking` | Shipment/consignment records with milestone status and aging | **deferred** (same decision record; manual milestones re-targeted with the PHASE-023 adapters) |

> **Intake completions:** `pos.table_service` + `pos.kitchen_display` (PHASE-016) and
> `sales.job_cards` (PHASE-017) were proposed here and have since completed the §5
> intake — they are full FEATURE_CATALOG rows with plan grants and permission seeds
> (rows removed from the pending set; `sales.job_cards` via migration 0025).

## 4. How to extend this matrix

1. Propose the capability with definition, providing module(s), feature keys, phase —
   using only modules from
   [MODULE_BOUNDARIES](../../architecture/MODULE_BOUNDARIES.md).
2. Prove it is industry-neutral, or scope it as a module feature that multiple industries
   can still compose.
3. Add the matrix row (all thirteen industry columns must be answered, even if N/A).
4. Ship tests with expected journal entries for every ledger-touching path.
5. Update affected templates' `capability_prerequisites` and re-run the template test suite
   ([../README.md](../README.md) §8).
