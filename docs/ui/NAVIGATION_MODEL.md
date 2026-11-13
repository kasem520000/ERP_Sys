# Navigation Model

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-11-11 (PHASE-035 / PHASE-036 / PHASE-038 / PHASE-039) · 2026-11-12 (PHASE-042 — the manufacturing execution group, §1.8) · 2026-11-13 (PHASE-043 — the planning surfaces, §1.10)

How users move through the platform: the information architecture, the entitlement-driven
navigation registry, the command menu as universal navigation, back/deep-link behavior,
role landing pages, mobile navigation, and the global keyboard shortcut registry. The app
shell (PHASE-005) implements this model; the
[configuration engine](../product/CONFIGURATION_ENGINE.md) consumes the same registry to
let industry templates re-order and re-label within the rules below.

## 1. Information architecture — top groups

Sidebar order is **binding** (start-to-end = top-to-bottom in LTR, right-to-left in RTL).
Arabic is canonical; English is full parity.

| # | Group (AR / EN) | Icon | Contains (examples) | Typical module |
|---|------------------|------|---------------------|----------------|
| 1 | الرئيسية / Home | home | Dashboard, approvals queue (if approver), reconciliation center | reporting, accounting |
| 2 | المبيعات / Sales | receipt | Quotations, sales orders, deliveries, invoices, credit notes, receipts, AR aging, statements, installment plans (خطة الأقساط) | sales |
| 3 | المشتريات / Purchasing | truck | Purchase requests/orders, GRN, supplier invoices, debit notes, payments, AP aging | purchasing |
| 4 | المخزون / Inventory | boxes | Items & barcodes, stock on hand, movements, transfers, counts, batches/expiry, warehouses | inventory, items |
| 5 | الإنتاج والتصنيع / Manufacturing | layers | Work centers, routings, shop-floor terminal (طرفية أرضية المصنع), downtime log, standard costs | manufacturing |
| 6 | المحاسبة / Accounting | ledger | Chart of accounts, journal entries, fiscal calendar & periods, trial balance & statements, period close, fixed assets (الأصول الثابتة), budgets (الموازنات) | accounting |
| 7 | الخزينة / Treasury | banknote | Cash/bank accounts, receipts/disbursements, expenses, petty cash, transfers, cashier shifts, bank reconciliation, cheques & notes (الشيكات والأوراق التجارية), maturity calendar (تقويم الاستحقاق) | treasury |
| 8 | التقارير / Reports | bar-chart | Saved reports, all catalog reports, VAT returns, exports, consolidated statements (القوائم الموحدة) | reporting |
| 9 | الجهات / Partners | users | Customers, suppliers, credit terms, statements, balances | partners |
| 10 | الإعدادات / Settings | settings | Branches/warehouses, users & roles, tax codes, numbering, branding, subscription, industry template | tenancy, identity, tax |
| 11 | الموظفون والرواتب / HR & Payroll | users-round | Employees, salary structures, payroll runs, loans | payroll |

Group visibility = entitlement AND at least one child visible (never an empty group).
Industry templates (PHASE-015) may add template-specific items (e.g., job cards under
المبيعات) but **may not reorder groups or remove core items** — configuration composes,
never forks ([../GLOSSARY.md](../GLOSSARY.md) Industry template). This is unchanged by
v2.0 and the v3.0 waves: the items below (group 11 and the additions in groups
2/6/7/8, plus the group-5 manufacturing execution items of §1.8) are core items in the
same sense — templates may surface them (e.g., education surfaces installment plans,
healthcare surfaces cheques & notes — [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md)
§L) but still may not remove them. PHASE-042 (2026-11-12) inserted the الإنتاج والتصنيع
group at position 5 — after المخزون, because production consumes what inventory stocks
(the binding NAV_GROUPS order in `packages/contracts/src/navigation.ts`); the groups
below it renumber accordingly.

### 1.1 v2.0 registry additions (Blueprint v2.0)

Added by [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §K (ED-12). Same
resolution rule as every item — `entitlement(featureKey)` AND `permission(user, branch)`;
feature keys per [../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md),
permissions per [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md)
§3.11–§3.15, archetypes per [PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md). The PHASE-027
rows (الخزينة ×2 + المبيعات ×1) shipped with migration `0038_notes_installments.sql` —
routes `/notes`, `/notes/calendar`, `/installments`; register/detail/calendar/reports
surfaces navigate through the in-page tab strip (one-item-many-screens, the fixed-assets
precedent).

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `sales.installment-plans` | 2 المبيعات | خطة الأقساط / Installment plans | `installments.plans` | `installments.plans.view` | List + Search (§2) — route `/installments`; plan creation runs as Wizard (§9) |
| `accounting.fixed-assets` | 6 المحاسبة | الأصول الثابتة / Fixed assets | `fixed_assets.register` | `fixed_assets.assets.view` | List + Search (§2); asset cards on Document Detail (§5) |
| `accounting.budgets` | 6 المحاسبة | الموازنات / Budgets | `budgeting.budgets` | `budgeting.budgets.view` | List + Search (§2) + Create/Edit Form (§3) for budget lines |
| `treasury.cheques-notes` | 7 الخزينة | الشيكات والأوراق التجارية / Cheques & notes | `notes.received` | `notes.notes.view` | List + Search (§2) — route `/notes`; note lifecycle on Document Detail (§5) with the `note_events` custody timeline (`TimelinePanel`) |
| `treasury.pdc-calendar` | 7 الخزينة | تقويم الاستحقاق / Maturity calendar | `notes.pdc_calendar` | `notes.notes.view` | Dashboard (§1 — the maturity workspace) — route `/notes/calendar`, with list drill (§2) |
| `reports.consolidated` | 8 التقارير | القوائم الموحدة / Consolidated statements | `consolidation.reports` | `consolidation.reports.view` | Report Page (§7) — route `/consolidation`; promoted from template-injected nav to a **CORE NAV_ITEMS entry at PHASE-035** (template-independent — template-less tenants now see القوائم الموحدة) |
| `payroll.employees` | 11 الموظفون والرواتب | الموظفون / Employees | `payroll.employees` | `payroll.employees.view` | List + Search (§2) |
| `payroll.salary-structures` | 11 الموظفون والرواتب | هياكل الرواتب / Salary structures | `payroll.salary_structures` | `payroll.salary_structures.manage` (view implied) | List + Search (§2) + Create/Edit Form (§3) |
| `payroll.runs` | 11 الموظفون والرواتب | تشغيلات الرواتب / Payroll runs | `payroll.runs` | `payroll.runs.view` | List + Search (§2); pending approvals surface in Approval Queue (§6) |
| `payroll.loans` | 11 الموظفون والرواتب | سلف الموظفين / Employee loans | `payroll.loans` | `payroll.loans.manage` (view implied) | List + Search (§2) |

### 1.2 PHASE-035 registry additions (Blueprint v3.0 — activation)

The three inventory surfaces (audit EVAL-F-1/F-2): fully-built APIs and flows that
no tenant could reach from the sidebar until PHASE-035 registered them. Same
resolution rule as every item — `entitlement(featureKey)` AND `permission(user,
branch)`; the register + write-off / sold-at actions inside batches/serials run
under `inventory.tracking.manage`.

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `inventory.batches` | 4 المخزون | الدفعات والصلاحية / Batches & expiry | `inventory.batch_tracking` | `inventory.moves.view` | List + Search (§2) — route `/inventory/batches`, order 90; register + write-off actions under `inventory.tracking.manage` |
| `inventory.serials` | 4 المخزون | الأرقام التسلسلية / Serial numbers | `inventory.serial_tracking` | `inventory.moves.view` | List + Search (§2) — route `/inventory/serials`, order 100; register + sold-at actions under `inventory.tracking.manage` |
| `inventory.adjustments` | 4 المخزون | تسويات المخزون / Stock adjustments | `inventory.stock_ledger` | `inventory.stock.view` | List + Search (§2), read-only — route `/inventory/adjustments`, order 110; posting stays in the count wizard by design |

### 1.3 PHASE-036 registry additions (Blueprint v3.0 — extensibility core)

The custom-fields manager (audit FD-18/FD-19/FD-20; [ADR-0019](../architecture/ADR/ADR-0019-custom-fields-typed-value-store.md)):
the settings-plane surface for definitions, picklists, and per-entity form layouts.
Same resolution rule as every item — `entitlement(featureKey)` AND `permission(user,
branch)`; a starter tenant sees no custom-fields navigation (the `platform.custom_fields`
plan grant rides migration `0049`). The per-entity form designer and the shared
`CustomFieldSurface` render inside the first-wave entity forms — not sidebar items.

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `settings.custom_fields` | 10 الإعدادات | الحقول المخصصة / Custom fields | `platform.custom_fields` | `configuration.custom_fields.read` | Settings (§8) — route `/settings/custom-fields`: the definitions + picklists manager (definitions / قوائم القيم), with the per-entity form designer (مصمم النماذج) opening from it; create/update/archive actions run under `configuration.custom_fields.manage` / `configuration.form_layouts.manage` |

### 1.4 PHASE-038 registry additions (Blueprint v3.0 — procurement sourcing)

The sourcing cluster (CR-08; [../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md)
§9): four purchasing items in group 3 المشتريات — the RFQ negotiation loop, the blanket
agreements, the supplier scorecards, and the CAPEX worklist. Same resolution rule as
every item — `entitlement(featureKey)` AND `permission(user, branch)`; the portal
skeleton has no sidebar item by design (the supplier submits through the scoped public
endpoint, never through the app shell). Visibility is **server-resolved**
(`resolveNavigation`) per BR-039 — entitlement and permission are evaluated on the API
side, never inferred in the client.

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `purchasing.rfqs` | 3 المشتريات | طلبات عروض الأسعار / RFQs & sourcing | `purchasing.rfqs` | `purchasing.rfqs.read` | List + Search (§2) — route `/purchasing/rfq`; the comparison/award matrix and the award→PO generation run inside the detail surface under `purchasing.rfqs.award` |
| `purchasing.blanket_orders` | 3 المشتريات | الاتفاقيات الإطارية / Blanket agreements | `purchasing.blanket_orders` | `purchasing.rfqs.read` | List + Search (§2) — route `/purchasing/blanket-orders`; releases generate the executable PO in-document |
| `purchasing.supplier_scorecards` | 3 المشتريات | تقييم الموردين / Supplier scorecards | `purchasing.supplier_scorecards` | `purchasing.rfqs.read` | Dashboard (§1) — route `/purchasing/supplier-scorecards`; the rolling scorecard + the approved-vendor-per-item list; recompute/review under `purchasing.suppliers.rate` |
| `purchasing.capex` | 3 المشتريات | طلبات الشراء الرأسمالي / CAPEX requests | `purchasing.capex_requests` | `purchasing.capex.read` | List + Search (§2) — route `/purchasing/capex-requests`; the budget guard runs at submit (advisory default), approve/reject under `purchasing.capex.approve` (SoD creator ≠ approver) |

### 1.5 PHASE-039 registry additions (Blueprint v3.0 — returns & collections)

The returns & collections cluster (CR-09; [../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md)
§8/§9): the customer RMA + warranty workspace (the warranties ride the returns screen
as its second tab), the dunning engine's collections workspace (letters, policies,
actions, credit reviews, agencies), and the supplier-returns (RTV) register. Same
resolution rule as every item — `entitlement(featureKey)` AND `permission(user,
branch)`; visibility is **server-resolved** (`resolveNavigation`) per BR-039, and all
three mirror `packages/contracts/src/navigation.ts` (orders 70/80/45 — Transaction
Entry workspaces under matrix §3.17's keys).

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `sales.returns` | 2 المبيعات | مرتجعات البيع / Sales returns | `sales.rma` | `sales.rma.read` | Transaction Entry (§4) — route `/sales/returns`, order 70: the RMA lifecycle (approve SoD, receive, inspect, complete) with the managed-warranty register as the screen's second tab; actions under `sales.rma.manage` / `sales.rma.approve` / `sales.warranties.manage` |
| `sales.dunning` | 2 المبيعات | التحصيل والمطالبات / Collections & dunning | `sales.dunning` | `sales.dunning.manage` | Transaction Entry (§4) — route `/sales/dunning`, order 80: the collections worklist — policies ladder, letters register + sweep, late-fee charge/waive, actions log, credit reviews, and the agencies/referrals layer (`sales.late-fees.manage` / `sales.collection-agencies.manage`) |
| `purchasing.returns` | 3 المشتريات | مرتجعات الموردين / Supplier returns | `purchasing.rma` | `purchasing.rma.read` | Transaction Entry (§4) — route `/purchasing/returns`, order 45: the RTV lifecycle (approve SoD, ship, credit — the G-38 debit note) under `purchasing.rma.manage` |

### 1.6 PHASE-040 registry additions (Blueprint v3.0 — data onboarding & migration toolkit)

The imports hub (CR-10; [../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md)
§3): one settings-plane item — the `/settings/imports` surface (the seven-kind wizard
with the BR-066 dry-run → acknowledged-atomic-commit discipline, the saved-mapping
manager, the jobs history, and the IN-26 QuickBooks/Odoo/Excel-generic adapter
templates). Same resolution rule as every item — `entitlement(featureKey)` AND
`permission(user, branch)`; a starter tenant sees no imports navigation (the
`platform.data_migration` plan grant rides migration 0060 §8 — business + enterprise,
the 0051 tier-4 precedent). The one-click demo-data surface deliberately has NO
sidebar item: it lives on the onboarding home (`platform.demo_data` is granted to ALL
plans — the trial-enablement decision — and the onboarding wizard's step-3 result
screen links to the hub). The command palette inherits the entry through
`resolveNavigation` (OA-04). Mirrors `packages/contracts/src/navigation.ts`
(`settings.imports`, order 80).

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `settings.imports` | 10 الإعدادات | استيراد البيانات والترحيل / Data import & migration | `platform.data_migration` | `configuration.imports.manage` | Wizard (§9) — route `/settings/imports`, order 80: four tabs (the import wizard — kind → upload → column mapping with auto-detect + saved-mapping reuse → dry-run report (bilingual AR+EN per-row issues) → ack-gated commit with polling; the jobs history; the saved mappings; the migration adapters with the documented-mapping template downloads); writes gate in-screen on `configuration.imports.manage` |

### 1.7 PHASE-041 registry additions (Blueprint v3.0 — communications hub)

The communications hub (H-22; [../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md)
§3): two items — the settings-plane back office (message templates channel × locale ×
module with the fail-closed preview, the BR-067 provider selection with sealed
credentials + per-market senders + the daily hard cap, and the tenant-default
notification matrix) and the home-plane unified inbox (the per-partner message+call
timeline, the IN-16 call logger, and the caller's own TB-23 preference matrix). Same
resolution rule as every item — `entitlement(featureKey)` AND `permission(user,
branch)`; the settings hub rides the ALL-plans `communication.outbound` grant (the
SANDBOX defaults render honestly on every plan — paid provider selections fail
closed server-side at save time), while the inbox carries NO feature key
(`communication.inbox.read` is granted to every role template — a workspace surface,
the notifications-inbox precedent). The calendar connect (IN-17/IN-18) deliberately
has NO sidebar item: the OAuth flows + the review-only contacts-sync queue surface
from task screens and the inbox (the `communication.calendar.connect` API routes
serve them). The command palette inherits both entries through `resolveNavigation`
(OA-04). Mirrors `packages/contracts/src/navigation.ts` (`settings.communication`
order 85, `communication.inbox` order 30).

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `settings.communication` | 10 الإعدادات | مركز الاتصالات / Communications | `communication.outbound` | `communication.templates.manage` | Settings (§8) — route `/settings/communication`, order 85: three tabs (templates — the effective catalog with override/builtin badges, the override editor, the fail-closed preview; providers — the per-channel selection with the live/sandbox/blocked resolution, the sealed-credential editor (state-only display), per-market senders, the daily send cap; defaults — the tenant-default module × channel matrix); the defaults tab writes gate on `communication.preferences.manage` |
| `communication.inbox` | 1 الرئيسية | صندوق الاتصالات الموحد / Communications inbox | — | `communication.inbox.read` | List + Search (§2) — route `/communication/inbox`, order 30: the unified timeline (kind/channel/direction/partner filters), the call logger (outcome + duration + notes linked to partner + user), and my-preferences (the self-plane matrix — `POST /communication/preferences/me`); the logger edits their own entries (log semantics — no deletes) |

### 1.8 PHASE-042 registry additions (Blueprint v3.0 — manufacturing execution)

The manufacturing execution cluster (CR-12, scope extended by v3.1/CR-45 L2-12;
[../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md) §27): five items in the NEW
group 5 الإنتاج والتصنيع — work centers, routings, the touch-first shop-floor terminal,
the downtime log, and standard costs. Until this phase these surfaces rode the industry
manifests + FALLBACK_CRUMBS; the routing/work-center/costing phase promotes them to
first-class registry rows. Same resolution rule as every item —
`entitlement(featureKey)` AND `permission(user, branch)`; visibility is **server-resolved**
(`resolveNavigation`) per BR-039, and the command palette (⌘K / Ctrl+K, §3) inherits all
five entries through the same registry (OA-04 — no separate palette registration). The
production order's Operations tab (progress, actual times, variances) + the
create-rework action and the rework lifecycle ride the EXISTING orders screen
(`/manufacturing/orders`, the §14 production-orders keys) — no new item by design; the
OEE reads surface inside the work-centers screen and the utilization report. Mirrors
`packages/contracts/src/navigation.ts` (orders 10/20/30/40/50; the numbering note for
the phase's migration slots — planned ≈0060…0066, shipped 0065/0066, the 0064 D-1
precedent — is recorded in [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.20).

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `manufacturing.work_centers` | 5 الإنتاج والتصنيع | مراكز العمل / Work centers | `manufacturing.work_centers` | `manufacturing.work_centers.manage` | List + Search (§2) — route `/manufacturing/work-centers`, order 10: capacity, hourly cost rates, status, cost-center link; the OEE/utilization reads render in-screen under `manufacturing.oee.read` |
| `manufacturing.routings` | 5 الإنتاج والتصنيع | مسارات الإنتاج / Routings | `manufacturing.routing` | `manufacturing.routings.manage` | Create/Edit Form (§3) — route `/manufacturing/routings`, order 20: the versioned routing editor (operations grid — sequence, work center, setup/run times, rate overrides; copy + activate, one ACTIVE per item) |
| `manufacturing.shopfloor` | 5 الإنتاج والتصنيع | طرفية أرضية المصنع / Shop-floor terminal | `manufacturing.shopfloor` | `manufacturing.shopfloor.execute` | Point of Sale (§10) — route `/manufacturing/shopfloor`, order 30: the touch-first, scan-first terminal (`OP:<order>:<seq>:<action>` — start/pause/resume/complete with actual times + scrap), large-target RTL layout for operators |
| `manufacturing.downtime` | 5 الإنتاج والتصنيع | سجل التوقفات / Downtime log | `manufacturing.downtime` | `manufacturing.downtime.log` | List + Search (§2) — route `/manufacturing/downtime`, order 40: reason-coded records per work center (open/close; posting is the BR-070 policy opt-in) |
| `manufacturing.standard_costs` | 5 الإنتاج والتصنيع | التكاليف المعيارية / Standard costs | `manufacturing.standard_costs` | `manufacturing.standard_costs.manage` | List + Search (§2) — route `/manufacturing/standard-costs`, order 50: versioned standards (draft → roll-up → activate with optional stock revaluation); PPV rides the GRN |

### 1.9 PHASE-044 registry additions (Blueprint v3.0 — WMS & inventory intelligence)

The WMS surfaces (CR-14; [../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md) §4's
WMS block): five items in group 4 المخزون — the location tree, the pick waves, the
cycle-count workspace, ABC, and the quarantine board. Same resolution rule as every
item — `entitlement(featureKey)` AND `permission(user, branch)`; visibility is
**server-resolved** (`resolveNavigation`) per BR-039, and the command palette
(⌘K / Ctrl+K, §3) inherits all five through the same registry (OA-04). The PP-11 scan
embeds ride the EXISTING receipt/delivery/transfer/count screens (no new items by
design — the putaway queue on `/purchasing/receipts`, the wave action + pick scan on
`/sales/deliveries`, the LPN mover on `/inventory/transfers`, the bin-scan helper on
`/inventory/counting`); the field workforce's synced task list is the Android surface
(OA-02 — LOCAL_DATABASE §1.1). Mirrors `packages/contracts/src/navigation.ts`
(orders 120/130/140/150/160; the eight 0071 permission keys —
[../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.21).

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `inventory.locations` | 4 المخزون | مواقع المستودع / Warehouse locations | `inventory.wms` | `inventory.wms.locations` | List + Search (§2) — route `/inventory/locations`, order 120: the zone→aisle→rack→bin tree with inline creation, the bin-contents board, the INV-029 reconciliation report, and the LPN registry + move-by-LPN |
| `inventory.pick_waves` | 4 المخزون | موجات الانتقاء / Pick waves | `inventory.picking` | `inventory.wms.picking` | List + Search (§2) — route `/inventory/pick-waves`, order 130: waves with the release/complete/cancel lifecycle, the PP-11 scan-confirmed task list, and the strategy card (FIFO/FEFO/NEAREST + allow-partial) |
| `inventory.cycle_counts` | 4 المخزون | الجرد الدوري / Cycle counts | `inventory.cycle_counts` | `inventory.cycle_counts` | Wizard (§4) — route `/inventory/cycle-counts`, order 140: schedules (create + run-now), count documents with the DRAFT→POSTED lifecycle, bin-aware line entry, and the BR-075 supervisor approval |
| `inventory.abc` | 4 المخزون | تصنيف ABC / ABC classification | `inventory.abc` | `inventory.abc` | Report Page (§7) — route `/inventory/abc`, order 150: the latest Pareto generation with the class summary + recompute |
| `inventory.quarantine` | 4 المخزون | لوحة الحجر الصحي / Quarantine board | `inventory.quarantine` | `inventory.quarantine` | List + Search (§2) — route `/inventory/quarantine`, order 160: the held-rows board with the G-43 transitions and the three dispositions |

### 1.10 PHASE-043 registry additions (Blueprint v3.0 — MRP & planning)

The planning surfaces (CR-13; [../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md)
§27's planning block): two items in group 5 الإنتاج والتصنيع — the MRP engine + suggestions
board and the master production schedule. Same resolution rule as every item —
`entitlement(featureKey)` AND `permission(user, branch)`; visibility is **server-resolved**
(`resolveNavigation`) per BR-039, and the command palette (⌘K / Ctrl+K, §3) inherits both
through the same registry (OA-04). The item card's planning tab rides the EXISTING item
screen (`/inventory/items/:id`, the §4 items keys) as an embedded tab — no new item by
design; the frozen-fence override permission (`manufacturing.mps.frozen_edit`) stays
DATA-DEPENDENT (resolved per request by the MPS service — never a static nav row). Mirrors
`packages/contracts/src/navigation.ts` (orders 60/70; the 0078 permission keys —
[../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.20).

| id | Group | Label (AR / EN) | featureKey | permission | archetype |
|----|-------|-----------------|------------|------------|-----------|
| `manufacturing.mrp` | 5 الإنتاج والتصنيع | تخطيط الاحتياجات / MRP | `manufacturing.mrp` | `manufacturing.mrp` | List + Search (§2) — route `/manufacturing/mrp`, order 60: the run configuration (mode, bucket, horizon, scope) + run history + the suggestions board (accept / dismiss-with-reason / convert; the netting drill-down per suggestion) |
| `manufacturing.mps` | 5 الإنتاج والتصنيع | الجدول الرئيسي / MPS | `manufacturing.mps` | `manufacturing.mps` | List + Search (§2) — route `/manufacturing/mps`, order 70: the PeriodGrid bucket editor with FIRMED toggles, the data-readiness panel, and the BR-078 frozen-fence guard (the in-fence edit needs the distinct permission + a reason) |

## 2. Navigation registry (data model, normative)

Navigation is **data**, not code — a single registry resolved per session:

```ts
type NavItem = {
  id: string;                    // 'sales.invoices' — stable, used in shortcuts & deep links
  parentGroup: NavGroupId;       // one of the 11 groups above
  label: Bilingual;              // { ar: 'فواتير البيع', en: 'Sales invoices' }
  icon: LucideName;              // from the icon set, never custom SVGs per item
  route: string;                 // '/sales/invoices' — locale-agnostic; locale lives in URL prefix
  featureKey?: string;           // entitlement: 'sales.invoicing' — absent = core, always present
  permission?: string;           // minimum permission to see the item: 'sales.invoices.read'
  branchScoped: boolean;         // data is per-branch; UI shows branch switcher context
  archetype: ArchetypeId;        // which PAGE_ARCHETYPES layout the route uses
  shortcut?: string;             // global keyboard shortcut, e.g. 'j'
  order: number;                 // within group
};
```

**Resolution rule (server-side, binding):** an item renders iff
`entitlement(featureKey)` AND `permission(user, branch)` resolve true. The client never
decides visibility alone — routes without a matching grant return 404-equivalent (opaque),
not "forbidden lists" that leak feature existence
([../security/THREAT_MODEL.md](../security/THREAT_MODEL.md) discipline). Industry
templates may patch `label`, add items, or hide optional items via the configuration
engine; the registry stays the single source consumed by sidebar, command menu, mobile
tabs, and shortcuts.

### 2.1 Contextual flows (intentionally outside NAV_ITEMS)

Confirmed intentional at PHASE-035 (audit F-4) — these routes never appear in the
sidebar because they are session / billing / shell flows, not workspace destinations:

- `/security` — the MFA/security challenge surface: session-contextual (reached from
  the user menu and the identity flows, never browsed to).
- `/checkout` — the billing checkout flow, entered from the pricing/plans surface.
- `/onboarding` — the first-run provisioning wizard (Journey A), one-time per tenant.
- `/offline` — the desktop shell's offline console (the DR-P21-07 exported-shell route
  include), desktop-context only.

## 3. Command menu — universal navigation (⌘K / Ctrl+K)

- Searches: navigation items (registry), recent documents (typed prefix `INV-`/`JE-`
  matches numbers), partners, items, and reports (by AR or EN label — both indexes).
- Fuzzy match; results grouped (تنقل / Navigation, تقارير / Reports, مستندات / Documents,
  جهات التعامل / Partners); arrow keys + Enter; `Escape` closes and restores focus.
- The command menu is the *only* global search surface — screens never add their own
  overlay search (in-view `SearchInput` remains for grid filtering).

## 4. Breadcrumbs, back behavior, and state preservation

- **Breadcrumbs** show the registry path (group → item → instance title); last crumb is
  plain text; middle crumbs preserve list context.
- **Back preserves filters**: list pages encode filter/sort/page/scroll state in the URL
  (`?status=POSTED&sort=-date&page=2`). Browser back and in-app back buttons restore the
  exact grid state; "record → back" must never dump the user on page 1.
- **Dirty-guard**: leaving an unsaved entry surface (archetypes 3/4/9) opens the cancel
  confirm dialog; autosaved drafts (transaction workspace) restore on return.
- **Deep links are first-class:** every list state, document, report run, and report
  parameter set is a shareable URL. Links are locale-prefixed (`/ar/...`, `/en/...`) and
  direction follows the prefix — sharing an AR link shows RTL regardless of viewer's
  preference.

## 5. Role-based landing pages

Landing page is a Dashboard archetype keyed by role and resolved at login
(PHASE-014; see [../product/USER_PERSONAS.md](../product/USER_PERSONAS.md)):

| Role (AR / EN) | Lands on | Rationale |
|----------------|----------|-----------|
| المحاسب / Accountant | Accounting dashboard: period status, TB snapshot, reconciliation tiles | Day starts with books health |
| الكاشير / Cashier (POS) | POS terminal (or shift open dialog) | Zero navigation friction |
| أمين المستودع / Warehouse keeper | Inventory dashboard: pending counts, transfers, low stock | Task-driven surface |
| صاحب المحل / Shop owner | Executive dashboard: cash, sales vs last period, receivables | Answers "how is business?" |
| مندوب المبيعات / Field rep | Mobile: today's route, van stock, customer balances | Field context |

Landing is user-overridable ("start here next time") but role-keyed defaults ship first.

## 6. Mobile navigation

Below `md` (768px) the shell collapses to:

- **Tab bar (bottom):** الرئيسية (Home) · المبيعات/الإجراءات (primary workflow of the
  role — one item) · التقارير (Reports) · المزيد (More → drawer with full registry).
  Tab bar respects the registry: the "primary workflow" slot is the highest-order
  visible item of the user's role.
- **Drawer:** full registry tree, swipe-reveal from the start edge + hamburger toggle;
  ≥44px rows; Escape and scrim close.
- Back-office pages below `lg` degrade to read-mostly ([PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md)
  preamble) — navigation never hides features that exist, but entry-heavy flows show an
  honest "best on desktop / يعمل أفضل على الحاسب" affordance instead of a broken grid.

## 7. Keyboard shortcut registry (global, normative)

| Shortcut | Action | Registry target |
|----------|--------|-----------------|
| `⌘K` / `Ctrl+K` | Command menu | global |
| `/` | Focus search of current view (or command menu if none) | global |
| `j` | New journal entry | `accounting.journal-entries.new` |
| `n` | New sales invoice | `sales.invoices.new` |
| `g` then `t` | Go to trial balance | `reports.trial-balance` |
| `g` then `h` | Go to dashboard | `home.dashboard` |
| `r` | Run/refresh current report or check | context |
| `?` | Shortcut cheat sheet (dialog) | global |
| `Ctrl+Enter` | Save & post / submit current entry surface | context |
| `Alt+Enter` | Add line (grid contexts) | context |

Rules: single-letter shortcuts are lowercase and never fire while typing in a field;
`g`-prefix is the "go" namespace; context shortcuts are documented on the archetype; all
shortcuts are discoverable via `?` and re-map-ready through the registry (never
hard-coded listeners in screens). POS terminal profiles define their own F-key map
(PHASE-016) layered on top.

## 8. Accessibility requirements (summary)

- Sidebar is a `nav` landmark with `aria-current="page"` on the active item; collapsed
  rail keeps accessible names ( tooltips); mobile drawer traps focus while open.
- Tab bar items are real links with visible text labels (icon + label, never icon-only).
- The active group/section is conveyed programmatically, not by color alone.
- Full contract: [ACCESSIBILITY.md](ACCESSIBILITY.md).

## 9. Phasing

| Capability | Phase |
|-----------|-------|
| App shell, sidebar, registry resolution, breadcrumbs, shortcuts (core set) | [PHASE-005](../planning/MASTER_ROADMAP.md) |
| Command menu with document/report search | PHASE-005 (nav) / PHASE-013 (reports index) |
| Mobile tab bar + drawer polish | PHASE-005 · validated with Android work in PHASE-022 |
| Industry template label/re-order patches | PHASE-015 |
| POS terminal nav profile | PHASE-016 |
| Role landing dashboards | PHASE-014 |
| Fixed assets (register, depreciation, revaluation, disposal) under المحاسبة | PHASE-026 |
| Cheques & notes + maturity calendar under الخزينة; installment plans under المبيعات | PHASE-027 |
| Budgets under المحاسبة | PHASE-028 |
| HR & Payroll group (group 11) + its items | PHASE-029 |
| Consolidated statements under التقارير | PHASE-034 — **LIVE** (delivered 2026-11-09: the `/consolidation` surfaces — group Settings, the elimination Transaction Entry workspace with the live balanced DR/CR preview, the run Report Page with the snapshot viewer — nav items under group 8 التقارير, `reports.consolidated`) |
| Inventory batches & expiry + serial numbers + stock adjustments (read-only) under المخزون; the import/export visibility repair; consolidated statements as a core item | PHASE-035 — **LIVE** (delivered 2026-11-10: `/inventory/batches` + `/inventory/serials` (register + write-off / sold-at under `inventory.tracking.manage`) and the read-only `/inventory/adjustments` register — posting stays in the count wizard; `items.import_export` granted business+enterprise by the DATA-ONLY migration `0048`; `reports.consolidated` promoted from template-injected to a core NAV_ITEMS entry — template-less tenants see القوائم الموحدة) |
| Custom-fields manager (definitions + picklists + per-entity form designer) under الإعدادات; typed values render on the six first-wave entity forms | PHASE-036 |
| Manufacturing execution group (group 5, الإنتاج والتصنيع) + its five items (work centers, routings, shop-floor terminal, downtime log, standard costs); the Operations tab + rework ride the existing orders screen | PHASE-042 |
| WMS surfaces under المخزون (location tree, pick waves, cycle counts, ABC, quarantine board) + the PP-11 scan embeds on the existing receipt/delivery/transfer/count screens | PHASE-044 |
