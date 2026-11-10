# Page Archetypes

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-27

The 12 sanctioned page layouts. Every screen in every module instantiates exactly one
archetype — never a bespoke layout ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §4). Archetypes
compose [COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) components; screens bring data and
wiring only. Direction: wireframes below are drawn LTR for readability; **the built
layout is RTL-first** — every wireframe mirrors per [RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md)
(see each archetype's RTL notes for non-mirroring exceptions).

**Common rules (all archetypes):** page title (18px semibold) + `Breadcrumbs` under the
top bar; global banner slot under the header (period soft-close, read-only mode); every
fetching surface must define loading/empty/error states before ship
([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) §2). Density default: compact.

## 1. Dashboard — لوحة المعلومات

Home for accountant/owner overviews: KPI tiles, work lists, alerts.

```text
┌──────────────────────────────────────────────────────────┐
│ Page title + date-range picker (presets)                 │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│ │KPIStat │ │KPIStat │ │KPIStat │ │KPIStat │ │KPIStat │  │  (max 6)
│ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘  │
│ ┌───────────────────────────┐ ┌───────────────────────┐ │
│ │ ChartCard (cash flow)     │ │ DataTable (my drafts/ │ │
│ │ RTL-mirrored axes         │ │ approvals due)        │ │
│ └───────────────────────────┘ └───────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- **Components:** `KPIStatCard` ×N, `ChartCard`, `DataTable`, `DateRangePicker`.
- **Keyboard:** Tab through cards; each work-list row opens with Enter; `/` focuses
  CommandMenu.
- **States:** every tile has its own loading skeleton; empty = "لا توجد حركات لهذه
  الفترة / No activity in this period" with a create action.
- **RTL:** charts mirror (category axis starts at the start edge); KPI deltas keep
  +/- sign logic (sign never mirrors).
- **Instantiated by:** role landing pages ([NAVIGATION_MODEL.md](NAVIGATION_MODEL.md)
  §landing), PHASE-014 dashboards.

## 2. List + Search — قائمة وبحث

The default collection browser (invoices, partners, items, journal entries…).

```text
┌──────────────────────────────────────────────────────────┐
│ Title + [New] primary           (grid toolbar)           │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ FilterBar: SearchInput · filters · saved views · ⋮  │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ DataTable (virtualized)                              │ │
│ │  rows: status badge · number (mono) · partner · date │ │
│ │  amount (numeric col) · kebab row actions            │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ Pagination + total count                            │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- **Components:** `FilterBar`, `DataTable`, `Pagination`, `DocumentStatusBadge`,
  `Button`, `CommandMenu` (global).
- **Keyboard:** `/` focuses search; arrows move rows; Enter opens; `n` new (per registry
  shortcut); filters reachable by Tab; filter state is URL-encoded and shareable.
- **States:** skeleton rows → empty (with create/import action) → error (retry).
- **RTL:** mirrors wholesale; numeric amount column keeps decimal alignment; kebab stays
  at row end (logical end).
- **Instantiated by:** sales invoice list, partner list, item list, journal list,
  transfer list, shifts, users, tax codes…

## 3. Create/Edit Form — نموذج إنشاء/تعديل

Master data and simple single-entity documents (partner, item, expense, cash transfer).

```text
┌────────────────────────────────────────────┬─────────────┐
│ Form sections (fieldset + legend)          │ Sticky      │
│  fields 2-col at lg, 1-col below          │ action      │
│  inline validation under each field        │ rail:       │
│  (Save · Cancel) + dirty indicator         │ Save/Cancel │
└────────────────────────────────────────────┴─────────────┘
```

- **Components:** `Input`, `MoneyInput`, `Select`, `Combobox`, `Checkbox`, `Switch`,
  `DatePicker`; sticky action rail.
- **Keyboard:** Tab natural order; `Ctrl+S` save; invalid submit focuses first error
  field and announces it; unsaved-changes guard on navigate (Dialog).
- **States:** loading (fetch-for-edit skeleton), saved (toast + stay), error (inline +
  toast), concurrency loss (refresh prompt).
- **RTL:** labels inline-start of fields; error icons at inline-end; sticky rail
  mirrors to the left side.
- **Instantiated by:** new partner, new item, new expense, new cash account, settings
  sub-forms.

## 4. Transaction Entry Workspace — مساحة إدخال المعاملات

The dense money-entry surface: manual journals, sales/purchase invoices. Full-height
grid + sticky totals; no scrolling to see consequences.

```text
┌──────────────────────────────────────────────────────────┐
│ Header: PartnerPicker/date/number (2 rows, compact)      │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ JournalEntryGrid / LineItemsEditor (fills viewport)  │ │
│ │  add line · duplicate line · inline errors           │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ MoneySummaryBar (sticky bottom): Σdebit Σcredit Δ    │ │
│ │  subtotal · tax preview · total · [Post]             │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- **Components:** `JournalEntryGrid` or `LineItemsEditor`, `MoneySummaryBar`,
  `PartnerPicker`, `DatePicker`, `DocumentStatusBadge`.
- **Keyboard (binding):** grid-cell navigation model
  ([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) §6.3); `Alt+Enter` new line; `Ctrl+D`
  duplicate; `Ctrl+Enter` submit/post; Post disabled while Δ≠0 for journals.
- **States:** autosaved draft indicator ("مسودة محفوظة 14:02"); posting = button
  loading, grid frozen; failure = assertive toast + inline fields.
- **RTL:** money columns keep LTR digits + decimal alignment inside RTL grid; Σdebit at
  start side of the summary bar.
- **Instantiated by:** manual journal entry, sales invoice create, supplier invoice
  create, credit note, opening-balance journal.

## 5. Document Detail — تفاصيل المستند

Read/detail view of a posted or in-flight document: header, lines, timeline, approvals.

```text
┌──────────────────────────────────────────────────────────┐
│ Doc number (mono) + DocumentStatusBadge + actions menu   │
│ Tabs: [Summary | Lines | Ledger impact | Timeline | Files]│
│ ┌───────────────────────┬──────────────────────────────┐ │
│ │ Summary: header info  │ Lines: read-only DataTable   │ │
│ │ partner, dates, tot…  │ + totals footer              │ │
│ ├───────────────────────┴──────────────────────────────┤ │
│ │ Timeline: state transitions (actor · time · reason)  │ │
│ │ Ledger impact: journal entries (drill links)         │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- **Components:** `Tabs`, `DataTable` (read-only), `DocumentStatusBadge`,
  `DocumentActions`, `PrintPreview` (print action), `Breadcrumbs`.
- **Keyboard:** Tab cycles: actions → tabs → active panel; all timeline items links
  (Enter opens linked reversal/approval).
- **States:** loading skeleton; missing/deleted → error page with audit pointer; no
  ledger-impact tab before POSTED (hidden, not disabled-empty).
- **RTL:** timeline grows from start edge; document number keeps LTR digits inside
  `bidiIsolate`.
- **Instantiated by:** invoice detail, journal entry detail, GRN, payment, stock
  transfer, production order (PHASE-018).

## 6. Approval Queue — طابور الموافقات

Reviewer's inbox of PENDING_APPROVAL work.

```text
┌──────────────────────────────────────────────────────────┐
│ Title + count badge + [batch approve]                    │
│ ┌──────────────┬───────────────────────────────────────┐ │
│ │ Queue list   │ Selected item preview: summary + diff │ │
│ │ (DataTable,  │ + [Approve] [Reject→reason dialog]    │ │
│ │  selectable) │                                       │ │
│ └──────────────┴───────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- **Components:** `ApprovalsQueue`, `DataTable`, `Dialog` (reject reason), `Toast`.
- **Keyboard:** `j/k` next/prev queue item; `a` approve focused; `r` reject (opens
  reason dialog); Space multi-select for batch.
- **States:** empty = "لا يوجد ما ينتظر موافقتك / Nothing awaiting your approval";
  acting on stale item reloads and warns.
- **RTL:** master-detail panes mirror (list at start side).
- **Instantiated by:** document approvals, period-close checklist review,
  stock-count variance review.

## 7. Report Page — صفحة التقرير

Parameters + result + export for every report (PHASE-013).

```text
┌──────────────────────────────────────────────────────────┐
│ Title + category + saved views                           │
│ ┌────────────┐ ┌───────────────────────────────────────┐ │
│ │ Params     │ │ ReportViewer:                         │ │
│ │ panel      │ │  param summary · group tree · table   │ │
│ │ (FilterBar │ │  totals · drill links                 │ │
│ │  + Run)    │ │  export menu · freshness              │ │
│ └────────────┘ └───────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- **Components:** `FilterBar`, `DateRangePicker`, `WarehousePicker`, `ReportViewer`,
  `PrintPreview`, `CommandMenu` (report search).
- **Keyboard:** `Enter` in params runs; result table per DataTable keyboard model;
  `Ctrl+P` print preview of current result.
- **States:** running (inline job status for heavy reports — poll), ready, empty,
  assertion-failed banner blocks export ([../reporting/REPORT_RECONCILIATION.md](../reporting/REPORT_RECONCILIATION.md)).
- **RTL:** parameter panel at start side; mirrors fully.
- **Instantiated by:** all [../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md)
  reports; reconciliation drill-downs.

## 8. Settings — الإعدادات

Low-volume configuration screens: tenants, roles, tax codes, numbering policies.

```text
┌────────────┬─────────────────────────────────────────────┐
│ Settings    │ Section forms (comfortable density, 40px)  │
│ side-nav    │ grouped by fieldset; Switch/Select controls│
│ (anchor)    │ explicit Save per section                  │
└────────────┴─────────────────────────────────────────────┘
```

- **Components:** comfortable-density forms, `Switch`, `Select`, `Tabs`, `DataTable`
  (role/permission matrix).
- **Keyboard:** section nav via Tab; form per archetype 3 model; per-section save.
- **States:** section-level save feedback; invalid config (e.g., contrast-fail accent)
  inline-blocked; permission changes warn about live sessions.
- **RTL:** side-nav at start (right); mirrors.
- **Instantiated by:** general settings, roles & permissions, tax codes, numbering,
  branches/warehouses, subscription plan view.

## 9. Wizard — معالج التهيئة

Onboarding and multi-step guided flows (tenant setup, opening balances).

```text
┌──────────────────────────────────────────────────────────┐
│ Stepper: ①②③④ (progress; mirrors)                       │
│ Step content (one archetype-3-like form per step)        │
│ [Back]                          [Skip for now] [Continue]│
└──────────────────────────────────────────────────────────┘
```

- **Components:** Stepper (Tabs variant), form components, `Dialog` (abandon guard).
- **Keyboard:** Tab order content → actions; `Ctrl+Enter` continue; step errors block
  continue with focus to first issue.
- **States:** per-step validation; autosave per step ("تم حفظ الخطوة"); final step shows
  summary + consequences before finish.
- **RTL:** stepper flows start→end (right→left in RTL); check/next icons mirror.
- **Instantiated by:** onboarding wizard (PHASE-014), opening-balance wizard, industry
  template switch confirm (PHASE-015), e-invoicing enrollment (PHASE-023).

## 10. Point of Sale — نقطة البيع

Touch-first tablet surface (PHASE-016): 48–64px tiles, ≥44px targets, no hover, dark
chrome (`--erp-surface-pos`).

```text
┌───────────────────────────────┬──────────────────────────┐
│ Item grid (tiles w/ image or  │ Cart: lines + qty steppers│
│ barcode field at top)         │ Σ total (22px)           │
│ category tabs                 │ [Pay → ShiftPanel/tender]│
│ scan input: auto-focus        │                          │
└───────────────────────────────┴──────────────────────────┘
```

- **Components:** `ItemPicker` (scan-first), `LineItemsEditor` (touch variant),
  `ShiftPanel`, `MoneyInput` (keypad popover), `Button` (POS sizes).
- **Keyboard (when hardware keyboard present):** scan-to-add; F-keys → tender actions
  (documented per terminal profile); Escape cancels tender dialog.
- **States:** offline banner + queued-sale count (honest sync state); item-not-found =
  red flash ≤120ms + retry hint; payment success shows receipt action immediately (no
  animation gate).
- **RTL:** full RTL; keypad digits stay LTR grid; totals keep Western digits by default.
- **Instantiated by:** POS terminal (PHASE-016); future quick-sale kiosk variants.

## 11. Reconciliation / Health Center — مركز التسوية والفحص

Checklist tiles of reconciliation checks — a flagship trust surface
([../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md) §6).

```text
┌──────────────────────────────────────────────────────────┐
│ Period selector + [Run all checks]                       │
│ ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐       │
│ │Tile:AR ││Tile:AP ││Inv try ││VAT rec ││Cash rec│ …    │
│ │✓ 0.00  ││✗ Δ12.5││✓       ││✓       ││⚠ drift │       │
│ └────────┘└────────┘└────────┘└────────┘└────────┘       │
│ Detail panel: selected check → offending rows (DataTable)│
│ + fix actions (never force-balance; documents only)      │
└──────────────────────────────────────────────────────────┘
```

- **Components:** status tiles (KPI-like), `DataTable`, `DocumentStatusBadge`, action
  buttons per workflow, `DateRangePicker`.
- **Keyboard:** tiles Tab-reachable; Enter opens detail; `r` re-runs selected check.
- **States:** running per-tile spinner (≤ its job), GREEN/`BROKEN`(with Δ)/`DRIFT`
  (warning) — colors from semantic tokens only.
- **RTL:** mirrors; Δ amounts keep sign coloring by value.
- **Instantiated by:** period close checklist, reconciliation workspace, subscription
  health (PHASE-014 admin).

## 12. Personal Account Mobile View — عرض الحساب الشخصي (الجوال)

Read-mostly owner/partner mobile experience (<`sm`–`md`, PHASE-022 mirrors it natively):
balances, statements, quick facts.

```text
┌────────────────────────┐
│ Balance hero (2xl)     │
│ Δ this month (KPIStat) │
│ ── statement rows ──   │
│ doc · date · amount    │
│ (tap → drill summary)  │
│ [Request statement]    │
└────────────────────────┘
```

- **Components:** `KPIStatCard`, `StatementViewer` (mobile variant), `DateRangePicker`
  (presets only), `EmptyState`.
- **Keyboard:** focus order top→bottom; all taps ≥44px; swipe is supplementary, never
  the only path.
- **States:** pull-to-refresh + last-sync time ("آخر تحديث 14:02"); offline = cached +
  banner.
- **RTL:** mirrors; amounts LTR-isolated.
- **Instantiated by:** owner mobile dashboard, partner statement portal (post-MVP), field
  rep's customer balance lookup.

## Composition rules (binding)

1. One archetype per screen — hybrids are a design smell; request a decision record.
2. Archetype = layout + state contract; the screen adds domain fields and services.
3. Shared slots across archetypes: header (title/breadcrumbs/actions), global banner,
   toast stack, command menu — provided by the app shell once.
4. Archetype changes require visual-baseline updates for *every* instantiating screen
   ([VISUAL_TESTING.md](VISUAL_TESTING.md) §archetypes).
