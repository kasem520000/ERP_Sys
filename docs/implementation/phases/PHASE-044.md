# PHASE-044 — WMS & Inventory Intelligence

> **Status:** COMPLETE 2026-11-13 (Blueprint v3.0, scope extended by v3.1/CR-46) — [the completion report](reports/PHASE-044-COMPLETION.md) · **Wave:** 2 / Stage 13 · **Register:** [CR-14](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-07 · §6 I-01…I-25 · §20 PP-11/PP-12, DF-12/DF-17 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §2 inventory depth · [gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md) (L1-20 returnable packaging — the v3.1 scope extension)

## 1. Phase Overview

- **Phase ID:** PHASE-044
- **Title:** WMS & Inventory Intelligence (إدارة المستودعات والذكاء المخزني)
- **Objective:** Turn the warehouse from a per-item quantity register into a real
  **Warehouse Management System**: a location tree (zones / aisles / racks / bins with
  barcodes), bin-level contents with AVAILABLE / QUARANTINE / HOLD status and
  ownership, directed putaway and directed picking (FIFO / FEFO / nearest strategies),
  pick waves and tasks with scanning, LPN pallet tracking, ABC-classified cycle-count
  schedules, a complete serial-movement ledger, shelf-life and slow-movement alert
  jobs, cross-docking, warehouse kitting, consignment/VMI ownership, transit
  exception states, and internal transfer pricing — INV-010 stays exact at every
  move; bin-level supply and FEFO data here are hard prerequisites of PHASE-043.
- **Business value:** The audit found zero bins, zero putaway, zero directed picking —
  "a warehouse over 5,000 items or 500 locations is manual management." This phase
  makes stock findable, pickable, countable, and ownable: putaway suggestions on
  receipt, scan-driven pick tasks on waves, scheduled cycle counts, quarantine
  control, vendor-owned consignment stock, and rotation/shelf-life automation. The
  field workforce gets the synced task list on the Android client (OA-02) — the
  first field-operations surface of the platform.
- **الملخص التنفيذي (AR):** تحوّل المستودع من «رقم مجمّع لكل صنف» إلى إدارة مستودعات
  حقيقية: شجرة مواقع (مناطق/ممرات/أرفف/صناديق بباركود)، ومحتويات صناديق بحالة
  متاح/فحص/تعليق مع ملكية مخزون الأمانة، وقواعد تخزين موجّهة عند الاستلام،
  واستراتيجيات انتقاء FIFO/FEFO/الأقرب، وموجات ومهام انتقاء تُسنَّد وتُمسح
  باركود، ولوحات ترخيص (LPN)، وجرد دوري مجدول بتحليل ABC وحسابات عتبات، ودفتر
  حركة التسلسلي، وتنبيهات صلاحية وبطء حركة كمهام مجدولة، وعبور مباشر وتجميع
  مستودعي، وتسعير تحويل داخلي — مع مزامنة مهام الالتقاط والتخزين إلى عميل
  الميدان وبقاء المطابقة الدفترية دقيقة عند كل حركة.

## 2. Scope

In scope:

1. **Location tree** (`warehouse_zones`, `warehouse_aisles`, `warehouse_racks`,
   `warehouse_bins`) (H-07, I-01, I-02, DF-12): zone types (PICKING / BULK /
   QUARANTINE / DOCK / STAGE), bin barcode, mixed-batch rule, capacity, pick
   sequence for nearest-pick routing.
2. **Bin-level stock** (`bin_contents`) (I-01, I-19, I-24): item / batch / serial /
   quantity / status AVAILABLE / QUARANTINE / HOLD per bin; `item_stock` remains the
   valuation authority (INV-010 untouched) with a hard reconciliation —
   Σ `bin_contents` = `item_stock` per warehouse and item, enforced same-transaction
   (INV-029); `stock_moves` gains source/target bin references.
3. **Directed putaway** (`putaway_rules`) (I-03, PP-12): condition engine
   (item attributes / zone / batch characteristics) generating suggested putaway
   tasks on goods receipt; immediate bin-label print after receipt (PP-12 — fixed
   formats here; the template designer stays PHASE-062).
4. **Directed picking** (`pick_strategies`, `pick_waves`, `pick_tasks`) (I-04, I-06,
   I-07, PP-11): per-warehouse strategy (FIFO / FEFO / NEAREST with partial-pick
   allowed rules); pick waves grouping deliveries into routes; tasks with assignee,
   scan verification, and status; cluster (multi-order) picking; barcode scanning
   inside count screens from the browser (PP-11, DF-17 completion).
5. **LPN handling** (`lpns`) (I-05): license plates / pallets with their contents
   (`bin_contents` rows bound to an LPN), LPN-level receipt and move-by-LPN.
6. **Cycle counting** (`cycle_count_schedules` + generated count documents) (I-08,
   I-20): ABC-frequency-based schedules generating count documents (header + lines)
   with recount and approval workflow; variances post through the existing adjustment
   shapes (G-13/G-14) with CYCLE_COUNT reason codes and an approval threshold.
7. **ABC classification** (`abc_classifications`) (I-09): computed from consumption
   value and velocity with configurable thresholds; recomputed per schedule; drives
   count frequency and slotting hints.
8. **Quarantine and HOLD board** (I-24, I-21 adjacent): status transitions
   (AVAILABLE ↔ QUARANTINE/HOLD) with approval, release / return-to-vendor / scrap
   dispositions, and a reserved integration point for PHASE-050 quality holds.
9. **Consignment and VMI ownership** (stock ownership fields, `owner_partner_id`)
   (I-10, I-11, I-19): vendor-owned stock tracked at bin level, excluded from the
   tenant's valuation and ATP; consumption settlement against the owner partner.
10. **Cross-docking** (I-12): receipt linked directly to an outbound delivery on the
    dock, bypassing putaway, with in-transit exactness checks.
11. **Warehouse kitting** (I-13): light kit assembly from bins without a production
    order (kit BOM consumption, kit layer at Σ component costs).
12. **Serial movement ledger** (`serial_movements`) (I-16, I-18): append-only
    per-serial history (receive / putaway / pick / transfer / adjust / return) with
    document references — the audit's "serials without movements" gap closed.
13. **Automation jobs** (`shelf_life_alert_jobs`) (I-17, I-21, I-25): daily
    shelf-life alert job (batch expiry thresholds), slow-movement rotation alert job
    (stale-stock automation), both emitting notifications through the existing
    center; transit exception states (I-22) — damaged/missing in-transit stock posts
    shrinkage per existing shapes; internal transfer pricing (I-23) — policy
    (cost / markup % / fixed price) with explicit valuation-difference posting.
14. **Automatic UOM conversion** (I-15): `uom_conversions` applied automatically
    inside bin moves and picks when the bin's UOM differs from the move's UOM.
15. **Returnable packaging deposits** (**L1-20** — added by v3.1/CR-46):
    `returnable_packaging` (the container register: pallets/crates/containers as
    tracked asset-items) + movements riding the bin/LPN machinery (issue with a
    delivery, return on receipt back) + **deposit accounting**: issue posts the
    customer-deposit liability (DR cash/AR · CR deposits payable), return releases it,
    damage/non-return writes it off — all through the posting engine with the mapped
    control-account discipline (fail-closed when unmapped, the 038 precedent); the
    deposit balance report per customer and container type.
16. **Sync duty (OA-02)**: pick and putaway tasks sync to the Android field client —
    the offline outbox/inbox contracts are extended (task state transitions,
    scan confirmations) and the sync-fleet harness runs as an acceptance gate.
17. **Screens** (12-template discipline, AR/EN parity, RTL, ⌘K registration):
    `/inventory/locations` (zone tree with bins), `/inventory/pick-waves`,
    `/inventory/cycle-counts`, `/inventory/abc`, and the quarantine board; bin / LPN
    selectors embed into the existing receipt, delivery, transfer, and count screens.

Out of scope: MRP / planning consumption (PHASE-043 — built on top of this phase) ·
barcode label template designer (PHASE-062) · warehouse automation hardware
(conveyors / PLC integration) · slotting optimization engine (ABC hints only) ·
warehouse billing / 3PL invoicing.

**v3.1 scope note (CR-46):** the returnable-packaging deposit layer (L1-20) was
consolidated into this phase before implementation — the container tracking rides its
bin/LPN machinery and the deposit postings ride the mapped control-account
discipline; the effort estimate moves from ~6–8 to ~6–9 weeks.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | NOT_STARTED — hard prerequisite (batch/serial/expiry screens this phase builds on) |
| PHASE-036 (Extensibility Core) COMPLETE | NOT_STARTED — recommended (custom fields on bins/zones/count lines) |
| PHASE-034 (Enterprise-Depth consolidation) baseline | delivered 2026-11-09 |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

Per the [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) dependency
graph, PHASE-035 is the hard edge; PHASE-036 is recommended (not blocking). This
phase must COMPLETE before PHASE-043 (bins for supply).

## 4. Design Impact

- **Migrations**: the sequence continues from PHASE-043's last journal entry (≈ 0072;
  exact numbers taken at implementation time — planned ≈ 0073…0081): location tree
  (zones/aisles/racks/bins) · `bin_contents` + `stock_moves` bin/LPN references +
  ownership fields · `putaway_rules` · `pick_strategies` + `pick_waves` +
  `pick_tasks` · `lpns` · `cycle_count_schedules` + generated count documents ·
  `abc_classifications` · `serial_movements` · `shelf_life_alert_jobs` + job
  registration · seed migration (permissions, feature grants, strategies, reason
  codes — DATA-ONLY). Drizzle `_journal.json` + `migrations.ts/spec` updated per
  house convention.
- **Entities/catalog parity**: +16 tables (`warehouse_zones`, `warehouse_aisles`,
  `warehouse_racks`, `warehouse_bins`, `bin_contents`, `putaway_rules`,
  `pick_strategies`, `pick_waves`, `pick_tasks`, `lpns`,
  `cycle_count_schedules`, cycle-count document header + lines, `abc_classifications`,
  `serial_movements`, `shelf_life_alert_jobs`) — each with SQL + Drizzle mirror +
  `ENTITY_CATALOG.md` row (CR-36 (a)); ownership fields extend existing stock tables.
- **Permissions**: +8 keys (`inventory.wms.locations`, `inventory.wms.putaway`,
  `inventory.wms.picking`, `inventory.cycle_counts`, `inventory.abc`,
  `inventory.tracking.serial_ledger`, `inventory.quarantine`,
  `inventory.tracking.consignment`); zero-drift check extended to the new baseline —
  seeded set equal on both sides (CR-36 (b)).
- **i18n**: ~220 new AR/EN dictionary keys (location tree, wave/task boards, count
  screens, ABC, quarantine); parity check extended.
- **Reports**: +4 contracts into `REPORT_CATALOG.md` (`inventory.bin-contents`,
  `inventory.cycle-count-variance`, `inventory.abc-classification`,
  `inventory.slow-movement`); catalog ↔ registry reconciliation check extended.
- **Posting canon**: goldens G-47 (quarantine move — distinct-account policy, G-15
  policy mirror), G-48 (consignment consumption settlement), G-49 (warehouse kitting),
  G-50 (internal transfer-price valuation difference) added to `JOURNAL_RULES.md` §7;
  a note records that cycle-count variances reuse G-13/G-14 shapes with CYCLE_COUNT
  reasons. Invariant INV-029 (bin-content exactness) added to
  `ACCOUNTING_INVARIANTS.md`; BR-064…BR-067 added to `BUSINESS_RULES.md`.
- **Feature flags**: `inventory.wms.*`, `inventory.cycle_count.*`,
  `inventory.tracking.*` — template-composable grants (CR-36 (f));
  distribution-bearing industry templates enable WMS by default.
- **Custom fields**: bins, zones, and count lines registered as custom-field surfaces
  in the PHASE-036 entity registry.
- **Sync surface (CR-36 (g) / OA-02 — mandatory this phase)**: pick/putaway task
  state transitions and scan confirmations join the offline outbox/inbox contracts;
  the sync-fleet harness run is an acceptance criterion.
- **Docs touched**: `JOURNAL_RULES.md` · `ACCOUNTING_INVARIANTS.md` ·
  `BUSINESS_RULES.md` · `ENTITY_CATALOG.md` · `FEATURE_CATALOG.md` ·
  `REPORT_CATALOG.md` · `NAVIGATION_MODEL.md` · sync-client contracts ·
  `IMPLEMENTATION_STATUS.md` · `NEXT_ACTION.md`.
- **No new ADR** — bin-level state extends existing stores within decided patterns;
  CR-36 gates apply.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations ≈ 0073…0081 (location tree, `bin_contents` + move references + ownership, putaway, picking family, LPN, cycle counts, ABC, serial ledger, jobs, seeds) + journal/spec updates | api |
| T-02 | Drizzle mirrors, `ENTITY_CATALOG.md` rows, RLS policies + attack tests A1–A10 for every new table | api |
| T-03 | Bin-contents service: same-transaction writes with `item_stock` (INV-029), reconciliation job, status transitions, auto-UOM conversion inside moves | api |
| T-04 | Putaway rule engine + suggested tasks on goods receipt + bin-label print (PP-12) | api |
| T-05 | Pick strategy engine (FIFO/FEFO/NEAREST, partial rules) + wave/task lifecycle + cluster picking + scan verification endpoints | api |
| T-06 | LPN service: LPN-bound contents, LPN receipt, move-by-LPN | api |
| T-07 | Cycle-count schedules + ABC recompute + generated count documents + recount/approval + variance posting (G-13/G-14 with CYCLE_COUNT reasons, threshold approval) | api |
| T-08 | Quarantine/HOLD board service + G-47 posting (policy-gated distinct account) + disposition flows | api |
| T-09 | Consignment/VMI ownership: owner-partner stock, valuation/ATP exclusion, consumption settlement + G-48 | api |
| T-10 | Cross-docking flow + warehouse kitting + G-49 | api |
| T-11 | `serial_movements` ledger hooks on every stock movement + completeness test | api |
| T-12 | Shelf-life / slow-movement alert jobs (pg-boss) + transit exception states (I-22) + transfer pricing policy + G-50 | api |
| T-13 | Sync duty (OA-02): outbox/inbox contracts for pick/putaway tasks + scan confirmations; sync-fleet harness run | api |
| T-14 | Build `/inventory/locations` (zone tree + bin grid), `/inventory/pick-waves` (wave/task boards with scan), `/inventory/cycle-counts`, `/inventory/abc`, quarantine board | web |
| T-15 | Embed bin/LPN selectors + scan into existing receipt, delivery, transfer, and count screens (PP-11) | web |
| T-16 | NAV_ITEMS + ⌘K registration, permissions seeding, feature grants, i18n keys | web |
| T-17 | Implement the 4 report contracts + tests + `REPORT_CATALOG.md` rows | api |
| T-18 | Golden suites G-47…G-50 with failure packs; INV-029 suite (reconciliation, exclusion rules, ledger completeness); BR-064…067 guards | api |
| T-19 | Docs: JOURNAL_RULES §7 rows + cycle-count note, ACCOUNTING_INVARIANTS INV-029, BUSINESS_RULES BR rows, FEATURE_CATALOG keys, NAVIGATION_MODEL entries, sync-contract update | docs |
| T-20 | Run full local gates + OA-06 EXPLAIN budgets (`bin_contents`, `serial_movements`, pick-task board) + backfill job for existing stock into a default bin per warehouse; record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations ≈ 0073…0081 apply cleanly; Drizzle mirrors + `ENTITY_CATALOG.md` parity
   for all 16 tables (CR-36 (a)); RLS attack tests A1–A10 pass for every new tenant
   table (CR-36 (e)).
2. INV-029 holds at all times: Σ `bin_contents` = `item_stock` per warehouse/item
   (same-transaction writes; nightly reconciliation job green over seeded fixtures);
   quarantined/HOLD stock is excluded from availability, and owner-partner
   (consignment) stock is excluded from valuation and ATP (BR-065/BR-067 asserted).
3. Directed putaway: a goods receipt generates suggested putaway tasks from rules; a
   bin label prints immediately after receipt commit (PP-12); wrong-bin putaway is
   rejected with a typed error.
4. Directed picking: a delivery wave generates pick tasks per strategy (FIFO/FEFO/
   nearest) with scan verification from the browser (PP-11); partial picks follow the
   warehouse's allowed-rules setting; cluster picking completes two orders in one
   route on the fixture.
5. Cycle counting: an ABC schedule generates count documents at the configured
   frequency; variance approval gates posting over threshold; variances post through
   the existing adjustment shapes with CYCLE_COUNT reasons (G-13/G-14 note).
6. Goldens G-47…G-50 green with failure packs: quarantine move (policy-gated distinct
   account; same-account default posts nothing — the G-15 mirror), consignment
   consumption settlement, kitting cost roll-up (kit = Σ components exactly),
   transfer-price valuation difference.
7. Serial ledger completeness: every stock movement touching a serialized item
   appends exactly one `serial_movements` row with document references (property
   test over all movement kinds).
8. Jobs fire: shelf-life alerts and slow-movement alerts emit notifications on
   fixtures; in-transit damaged/missing posts shrinkage per the existing shapes.
9. Sync duty (OA-02): pick/putaway tasks and scan confirmations round-trip through
   the extended outbox/inbox contracts; the sync-fleet harness run passes; task-state
   transitions are idempotent under duplicate delivery.
10. All house gates green: typecheck · lint · boundaries · unit tests ·
    `docs:validate` · i18n parity · permissions drift equality · manifests; OA-06
    EXPLAIN budgets met for `bin_contents` and `serial_movements`; completion report
    `reports/PHASE-044-COMPLETION.md` appended; `IMPLEMENTATION_STATUS.md` row
    flipped; archive delivered as `ERP_PLATFORM_PHASE044.zip` (OA-07).

## 7. Risks and Constraints

- **Bin/valuation reconciliation drift** — the highest-stakes risk of the phase:
  mitigated by same-transaction writes, INV-029 property tests, a nightly
  reconciliation job, and blocking (not warning) mismatches.
- **Existing-stock backfill** — tenants start bin-less: mitigated by a default bin
  per warehouse created in migration, a backfill job with a dry-run report, and
  zero-quantity bins allowed (structure without contents).
- **Performance at scale** — `bin_contents` and `serial_movements` grow fast:
  mitigated by OA-06 EXPLAIN budgets, covering indexes, and scan pagination on the
  task boards.
- **Field-sync conflicts** — two devices claiming the same task: mitigated by task
  assignment/version checks, idempotent scan confirmations, and the sync-fleet
  harness chaos run.
- **Scope sprawl** — WMS tempts endless features: mitigated by the explicit
  out-of-scope list, fixed label formats until the 062 designer, and no automation
  hardware.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-044-COMPLETION.md`
  (evidence per acceptance criterion, gate outputs, golden pack results,
  reconciliation evidence, sync-fleet run log, OA-06 EXPLAIN evidence, backfill
  report).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-044 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase per the roadmap — PHASE-043 (MRP) is now unblocked once
  PHASE-038 is also COMPLETE; PHASE-045 (HR Core) remains eligible in parallel.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE044.zip` (OA-07); the
  owner continues with «ابدأ تنفيذ المرحلة PHASE-043» when 038 is complete, or
  «ابدأ تنفيذ المرحلة PHASE-045» in parallel.
- Handoff notes for PHASE-043: bin-level availability, FEFO/expiry-aware supply
  qualification, consignment exclusion, and the reservation policy engine (I-14) are
  the WMS inputs MRP consumes; the strategy service is the single source both sales
  picking and MRP netting call. Handoff notes for PHASE-050: the quarantine board's
  hold integration point is where quality holds will bind; the pick-task sync
  contracts delivered here are the pattern for future field-client surfaces.
