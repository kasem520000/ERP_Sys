# Component Catalog

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-27

The normative catalog of `packages/ui` (PHASE-005 core; later phases append entries — CI
checks that every exported component has a row here and vice versa). Composition rules:
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Token values referenced below are defined in
[DESIGN_TOKENS.md](DESIGN_TOKENS.md). Status vocabulary is fixed by
[../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md).

Conventions used below: **density** prop = `compact | comfortable` on all interactive
components (compact default); **all** components are RTL-correct via logical properties
and are visually verified AR+EN ([VISUAL_TESTING.md](VISUAL_TESTING.md)).

## 1. Primitives — form controls and buttons

| Component | Purpose | Key props | States / variants | A11y & RTL notes | Usage guidance |
|-----------|---------|-----------|-------------------|------------------|----------------|
| `Button` | Primary action trigger | `variant: primary \| secondary \| ghost \| danger`, `size: sm \| md`, `loading`, `iconStart/End` | default, hover, focus-visible, active, loading (spinner + label kept), disabled | `loading` keeps width stable, sets `aria-busy`; icon mirrors per direction rules | One `primary` per view region; destructive actions use `danger` + confirm dialog |
| `IconButton` | Icon-only trigger | `icon`, `label` (required), `variant`, `size` | as Button | `label` → `aria-label` + tooltip; 32px desktop, ≥44px on touch contexts | Toolbar density; never rely on icon alone in flows |
| `Input` | Single-line text field | `label`, `error`, `hint`, `mono`, `bidiIsolate`, `prefix/suffix` | default, focus, error, disabled, readonly, loading-async (inline) | Label bound via `for`; error text `aria-describedby` + `aria-invalid`; error announces politely | Use `mono` for codes/numbers; `bidiIsolate` for mixed-script values (tax no., IBAN, e-mail) |
| `Textarea` | Multi-line notes | `label`, `error`, `maxLength` w/ counter | as Input | Counter is `aria-live="polite"` at ≤20 chars left | Notes fields on documents; not for amounts |
| `Select` | Native-like list choice | `options`, `value`, `onValueChange`, `placeholder` | default, open, focus, error, disabled | Radix Listbox semantics; type-ahead matches AR and EN labels | Low/medium option counts (≤ ~50); else `Combobox` |
| `Combobox` | Searchable async selection | `items`, `onSearch`, `loading`, `emptyText`, `allowClear` | typing, loading, empty, no-match | `role="combobox"` + `aria-expanded`; selection restores focus to trigger | Partner/item pickers ≥50 records; debounced 200ms search |
| `Checkbox` | Multi-choice / row select | `label`, `indeterminate`, `error` | unchecked, checked, indeterminate, focus, disabled | Space toggles; `indeterminate` visual ≠ state; group has fieldset+legend | Header checkbox = select-all with tri-state in tables |
| `Radio` / `RadioGroup` | Exclusive small choice | `orientation`, `items` | checked, focus, disabled | Arrow keys move within group; one required `checked` | ≤6 options; else Select/Combobox |
| `Switch` | Immediate setting toggle | `label`, `description`, `checked`, `onCheckedChange` | off, on, focus, disabled, loading | `role="switch"`; change announces state | Settings only — never for document data (use Checkbox) |
| `DatePicker` | Single date | `value`, `calendar: gregory \| islamic-umalqura`, `locale`, `min/max` | default, open, focus, error, disabled | Grid navigation arrows/Home/End; value input accepts typed ISO/ymd; `aria-live` on change | Displays both calendars when tenant enables Hijri (secondary line) |
| `DateRangePicker` | Period selection | `start`, `end`, `presets[]` (this month/quarter/fiscal year), `calendar` | as DatePicker | Range described as one announcement "من 1 يناير إلى 31 يناير" | Report parameters, aging buckets; presets are the common path |
| `NumberInput` | Numeric non-money value | `value`, `min/max`, `step`, `allowNegative`, `unitSuffix` | as Input | `inputMode="decimal"`; invalid input blocked + announced | Quantities, discounts %, rates — money must use `MoneyInput` |
| `MoneyInput` | Amount entry (see §6) | `amount`, `currency`, `minorUnits`, `sign` | default, focus, error, negative, zero | `role="group"` with suffix; tabular-nums enforced | Every money field, no exceptions |

## 2. Data display, navigation & feedback

| Component | Purpose | Key props | States / variants | A11y & RTL notes | Usage guidance |
|-----------|---------|-----------|-------------------|------------------|----------------|
| `DataTable` | Virtualized data grid (see §6) | `columns`, `rows`, `rowKey`, `sort`, `filters`, `selection`, `rowActions`, `empty`, `density` | loading (skeleton rows), empty, error, sorted, filtered, selected, sticky-header | `role="grid"` + roving tabindex; all ops keyboard-complete | Every list screen; one grid per view region |
| `Pagination` | Paged navigation | `page`, `pageSize`, `total`, `onPageChange` | default, first/last, page-size menu | Announces "صفحة 3 من 12"; page size menu is a Select | Bottom bar of DataTable; total always visible |
| `Tabs` | Peer content switch | `items`, `value`, `orientation` | active, hover, focus, disabled | Radix Tab semantics; Arrow keys per direction (RTL-aware) | Document detail sections; report tabs (result/export) |
| `Badge` | Neutral count/tag chip | `children`, `tone: neutral \| primary`, `mono` | — | Decorative if duplicating adjacent text; else has accessible name | Counts, codes, categories — statuses use `DocumentStatusBadge` |
| `DocumentStatusBadge` | Lifecycle state chip (see §6) | `status`, `showIcon`, `size` | 6 lifecycle states + `PENDING_SYNC` (offline) | Status text is real text (AR+EN via app i18n), icon decorative | Header of every document; never hand-rolled |
| `Dialog` | Modal interruption | `title`, `description`, `size: sm \| md \| lg`, `onOpenChange` | open, closing (150ms), nested (max 2) | Focus trap + restore; Escape closes; scrim click = cancel only | Confirmations, lightweight edits; big forms → Drawer |
| `Drawer` / `Sheet` | Side panel editor | `side: start \| end` (logical), `size: md \| lg`, `title` | open, closing, dirty-close-guard | Focus trap; close restores trigger; body scroll locked | Line-item edit, record side-views; side is logical — renders left in LTR, right in RTL |
| `Toast` | Transient outcome notice | `tone: success \| warning \| danger \| info`, `title`, `description?`, `action?` | enter (120ms), auto-dismiss 6s (danger: sticky) | Region `role="status"` (polite); errors `role="alert"`; stacked max 3 | Posting saved / failed, sync results; never the only error surface |
| `Tooltip` | Delayed helper text | `content`, `delay: 300ms`, `shortcut?` | hover/focus, exit | `aria-describedby`; never interactive content | Icon meanings, column explanations, shortcuts |
| `Popover` | Anchored lightweight panel | `trigger`, `align: start \| end`, `width` | open, exit | Radix Popover semantics; Escape closes | Quick filters, mini-previews, chart annotations |
| `CommandMenu` | ⌘K / Ctrl+K global search+nav | `commands[]`, `placeholder` | typing, results, empty, "no results" | Opens focused input; arrow keys; Escape closes and restores focus | Universal: reports, documents, partners, navigation (see [NAVIGATION_MODEL.md](NAVIGATION_MODEL.md)) |
| `SearchInput` | Persistent in-view search | `value`, `placeholder`, `onDebouncedChange` | typing, clear (×), search-icon | `role="searchbox"`, clear announced | List headers; global search is CommandMenu, not this |
| `Breadcrumbs` | Location trail | `items[]`, `maxVisible: 4` | collapsed (…), hover | `nav aria-label` + current = `aria-current`; separator mirrors (chevron flips) | Under page title; last item never links |
| `EmptyState` | First-use / no data | `icon`, `title (AR+EN)`, `description`, `primaryAction` | — | Illustration decorative (`alt=""`) | Every list/report; action creates or explains why empty |
| `LoadingState` | Skeleton placeholders | `variant: table \| form \| report`, `rows` | shimmer (reduced-motion: static gray-100 blocks) | `aria-busy="true"` on container; no fake text | Structure-true skeletons; never spinners over content |
| `ErrorState` | Failure + recovery | `title`, `retry`, `detail?` | inline vs full-page | `role="alert"`; retry is reachable first | Fetch/render failures; financial errors include document-safe detail |

## 3. Patterns — composed domain components

| Pattern | Purpose | Key props | States | A11y & RTL notes | Usage guidance |
|---------|---------|-----------|-------|------------------|----------------|
| `JournalEntryGrid` | Balanced entry editor (see §6) | `lines`, `onLinesChange`, `accountsSource`, `balanceIndicator` | editing, unbalanced (locked post), line-errors, max-lines | Grid roving tabindex; Σdiff announced; row add via keyboard | Manual journals, opening balances, adjustments |
| `LineItemsEditor` | Qty × price document lines | `lines`, `itemPicker`, `pricing`, `taxPreview`, `totals` | editing, unit-invalid, tax-preview updating, totals live | Totals `aria-live="polite"`; add-line keyboard flow (see §6 note) | Invoices, orders, GRN, credit notes |
| `PartnerPicker` | Customer/supplier selection (PHASE-006) | `items: {id,label,labelAr?,meta?}[]`, `value`, `onSelect`, `onSearch`, `loading`, `emptyText` | default, typing, loading, empty, clear (SHIPPED P6-T11a: Combobox-composed; async search app-injected; `newInline` lands with inline-create phase) | Combobox semantics; AR+EN type-ahead from one option set; selection restores focus to trigger | Pre-screening credit info (`usePartnerBalance` beside it); document entry |
| `ItemPicker` | Item selection + barcode (PHASE-006) | `items: {id,label,labelAr?,meta?}[]`, `value`, `onSelect`, `onSearch`, `loading`, `emptyText` | default, typing, loading, empty/not-found (SHIPPED P6-T11a: scan-first = app's `onSearch` wiring; matched-flash/beep land with POS/warehouse phases) | Combobox semantics; SKU rides as mono meta; result announced | Scan-first in POS/warehouse; type-first in back office |
| `WarehousePicker` | Warehouse scope choice | `warehouses`, `scope: single \| multi` | single, multi (chips) | Multi mode = checkbox group in popover | Stock docs, reports; respects branch scoping |
| `ApprovalsQueue` | Approvals inbox | `pending[]`, `onApprove/Reject`, `batch` | empty, batch-review, reject-reason dialog | Counts in page title; reject reason required (`aria-invalid` if empty) | Approval archetype core; actions audit-logged server-side |
| `StatementViewer` | Partner account statement reader | `statement`, `agingBuckets`, `allocations` | loading, empty, overdue-highlight, drill-down | Rows are links (Enter opens source doc) | AR/AP statements; read-mostly |
| `MoneySummaryBar` | Sticky totals strip | `items: {label, amount, sign}[]`, `currency` | totals updating, negative, zero | `aria-live="polite"` off during typing (debounce 300ms) to avoid chatter; totals announced on blur | Bottom of entry screens; always visible ≥lg |
| `FilterBar` | List/report filters | `fields[]`, `onApply`, `savedViews` | applied-chips, dirty, reset | "Filters applied: 3" announced; chips removable via keyboard | Above DataTable/ReportViewer; state is shareable (URL) |
| `ReportViewer` | Report result display (see §6) | `result`, `columns`, `drillDown`, `exportMenu`, `freshness` | loading, ready, empty, error, assertion-failed banner | Table semantics; drill links real links; export menu labeled | All report pages; renders the report result envelope |
| `PrintPreview` | On-screen print preview | `templateId`, `data`, `zoom` | rendering, ready, print-again | Preview iframe titled; toolbar buttons labeled | Pre-print check; same HTML as server PDF (ADR-0011) |
| `ShiftPanel` | Cashier shift panel | `shift`, `openFloat`, `counts`, `variance` | open, counting, over/short, closed | Variance announces; count fields MoneyInput | POS open/close count; treasury shifts |
| `KPIStatCard` | Dashboard metric tile | `label`, `value`, `delta?`, `spark?` | loading, empty, positive/negative delta | Delta colored by sign (finance tokens); spark decorative | Dashboards; max 6 per screen |
| `ChartCard` | RTL-mirrored chart frame | `type: line \| bar \| donut`, `series`, `title` | loading, empty, error | Charts get `role="img"` + `aria-label` summary + table alternative (details) | Y axis origin bottom, category axis start = right in RTL; bars grow from start edge |
| `NavigationSidebar` | Primary nav (see [NAVIGATION_MODEL.md](NAVIGATION_MODEL.md)) | `registry[]`, `activePath`, `collapsed` | expanded, collapsed (icon rail), mobile drawer | `nav` landmark; current = `aria-current="page"` | Entitlement-driven; renders only permitted groups |
| `AppShell` | App chrome: skip-to-content, sidebar/mobile tabs, ⌘K, `?` sheet, banner slot, toast stack, density provider | `locale`, `dir`, `density`, `navigation` (resolved payload), `activePath`, `brand`, `strings`, `userMenu` | desktop, mobile (tab bar + drawer), empty-registry | nav landmark + `aria-current`; skip link first Tab stop; shell-only `<html lang dir>` (RTL §2) | One per app (layout level); every screen composes inside it |
| `RadioGroup` | Radio set wrapper (the `Radio` row above is the item) | `options`, `value`, `onValueChange`, `orientation`, `error` | checked, focus, disabled, error | fieldset+legend; arrows move within group (§7) | ≤6 options; else Select/Combobox |
| `DocumentActions` | Lifecycle transition menu — the §6.4 companion | `status`, `labels`, `onAction` | per-status allowed transitions (submit/approve/post/reverse/cancel) | derives from the SAME lifecycle table; critical actions danger-toned, never default-focused | Document Detail headers; never hand-rolled menus |
| `NotificationBell` | Notification center entry | `unread`, `items`, `markRead` | badge count, panel open | Count in `aria-label` ("التنبيهات: 3 غير مقروءة") | Approvals, sync failures, reconciliation alerts |
| `TimelinePanel` | لوحة الخط الزمني / Timeline panel — ordered event-log trail (PHASE-027) | `locale?` (section `lang` — bilingual voice selection; direction stays ambient per RTL §2), `items: {date, kind, title, subtitle?, tone: 'default'\|'positive'\|'warning'\|'critical', icon?}[]`, `title?`, `emptyText?` | populated, empty, mixed-tone, icon markers | `<ol>` semantics; connector + markers decorative (`aria-hidden`); ISO dates LTR-isolated `<time>`; tone never the only signal; trail grows from the inline-start edge in both directions (logical utilities only) | Custody/audit trails (`note_events` the first consumer); append-only histories, never editable lists || `TimelinePanel` | لوحة الخط الزمني / Timeline panel — ordered event-log trail (PHASE-027) | `locale?` (section `lang` — bilingual voice selection; direction stays ambient per RTL §2), `items: {date, kind, title, subtitle?, tone: 'default'\|'positive'\|'warning'\|'critical', icon?}[]`, `title?`, `emptyText?` | populated, empty, mixed-tone, icon markers | `<ol>` semantics; connector + markers decorative (`aria-hidden`); ISO dates LTR-isolated `<time>`; tone never the only signal; trail grows from the inline-start edge in both directions (logical utilities only) | Custody/audit trails (`note_events` the first consumer); append-only histories, never editable lists |
| `PeriodGrid` | شبكة الفترات / Period grid — spreadsheet-style period-column editor+reader (PHASE-028) | `locale`, `periods: {id,label}[]`, `rows: {key, dimensionLabel, amounts: Record<periodId,string>}[]`, `totalsRow`, `onCellChange?(rowKey, periodId, value)`, `onRemoveRow?`, `readOnly?` | populated, empty, read-only, editable-with-live-totals | `role="grid"` semantics; sticky inline-start dimension column; tabular-nums LTR-isolated money inputs with 4-dp sanitize; keyboard grid navigation (Enter/↓/↑ rows, ←/→ columns at caret edges — mirrored under RTL); live row totals via exact BigInt folds | The budget workspace (DRAFT grid editing) and any period-column planning surface; never for ledger journals (the JournalEntryGrid owns those) |

## 4. Print templates (shared web ↔ Chromium server render; details in [../reporting/PRINTING_AND_EXPORT.md](../reporting/PRINTING_AND_EXPORT.md))

| Template | Purpose | Key props | States | A11y & RTL notes | Usage guidance |
|----------|---------|-----------|-------|------------------|----------------|
| `A4DocumentTemplate` | Invoices/statements/credit notes (A4) | `doc`, `tenantBranding`, `locale`, `footer` | first page, multipage, last-page totals | Page numbering physical bottom-start (RTL: bottom-right); logo never mirrored | Official documents; matches print CSS versioned set |
| `ReportTemplate` | Report paper output (A4) | `result`, `params`, `title`, `tenantBranding` | header repeat, totals row, assertion banner | Repeated `<thead>`; totals marked up as table cells with `scope` | TB/GL/IS/BS/CF and operational reports |
| `Receipt80` | POS receipt, 80mm roll | `sale`, `qrPayload`, `locale` | standard, offline (OFF- number), reprint | Monospace-safe numerals; QR never mirrored | PHASE-016 POS; ZATCA-ready QR slot |
| `Receipt58` | POS receipt, 58mm roll | as Receipt80 | as Receipt80 | Compact bilingual layout (AR primary, EN secondary line) | Small-printer retail/food |

## 5. Naming, imports, props conventions

1. Components are PascalCase exports from `@erp/ui`; props are camelCase; event props
   `onXxx`; boolean props default false and are named for the positive state.
2. Bilingual display strings arrive as `{ ar: string; en: string }` or via the app's i18n
   function — components never embed business words (exception: the status token map,
   §6).
3. Data-in is props/callbacks only; server interactions live in app/headless hooks.
4. Every component tolerates loading/empty/error before first release (definition of
   done, [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §8).

## 6. The five most complex components (normative sections)

### 6.1 `DataTable`

**Purpose:** the workhorse grid; virtualized to 10,000 rows; every list archetype uses it.

- **Columns:** `{ id, header: {ar,en}, accessor, align: 'start'|'end'|'center', width?,
  sortable?, filterable?, render?, stickyStart?, mono?, numeric? }`. Numeric columns set
  `numeric: true` → tabular-nums + `text-end` (numbers align by decimal side regardless of
  direction).
- **Behavior:** click-header sort (multi-sort via Shift-click), per-column filter menu
  (Popover), row selection (checkbox column, tri-state header), row actions menu (kebab,
  keyboard accessible), column visibility toggle, sticky header, horizontal scroll with
  sticky first (start) column.
- **Virtualization:** windowed rendering (~20 rows overscan); row height from density
  token (32/40px); 10k-row scroll test must hold 60fps at PHASE-005 gate.
- **States:** `loading` renders skeleton rows preserving column widths; `empty` renders
  `EmptyState` inside the grid frame; `error` renders `ErrorState` with retry; sort/filter
  re-render is instant (no animation, Principle 3).
- **A11y:** `role="grid"`, roving tabindex `gridcell` model; header buttons announce sort
  state ("مرتب تصاعدياً"); selection announced "تم تحديد 3 صفوف"; screen-reader table mode
  supported by keeping real `<table>` semantics inside the virtual window.
- **RTL:** logical utilities only; sort arrows and chevrons mirror; numeric columns keep
  `text-end` (digit alignment unchanged); sticky column is the *start* column.
- **Usage:** never nest grids; >50 columns → reconsider the screen design.

### 6.2 `MoneyInput`

**Purpose:** the only legal way to capture amounts.

- Renders: text input (mono digits, tabular-nums) + currency suffix chip (ISO code +
  symbol, e.g., `SAR ر.س`); optional decimal keypad popover on touch contexts.
- **Props:** `amount: string` (canonical decimal string, never float), `currency`,
  `minorUnits` (from currency metadata, default 2), `allowNegative`, `max`,
  `onAmountChange`, `error`.
- **Behavior:** digit-grouping on blur (e.g., `12,500.00`); caret-preserving edit on
  focus (raw digits); paste sanitization to `[0-9.,-]` + locale decimal point; locale
  decimal separator per active locale (`,` display in AR is forbidden at MVP — decimal
  point `.` always, thousands separator `,`); negative sign entered or by `sign` toggle
  per context.
- **States:** default/focus/error/negative (red text only when value < 0 —
  `finance-negative`)/zero (gray-600).
- **A11y:** group role; suffix part of accessible name ("المبلغ بالريال السعودي");
  invalid states announced; keypad is a labelled grid of buttons.
- **RTL:** digits always LTR (`dir="ltr"` + `bidiIsolate` on the input *value only*);
  suffix chip on the inline-end side via logical padding; thousands grouping separators
  do not mirror.

### 6.3 `JournalEntryGrid`

**Purpose:** manual journal entry with live balanced-entry preview (UI mirror of INV-001).

- **Columns:** account (Combobox on active leaf accounts), description, cost center,
  partner (required when account has AR/AP purpose — engine rule surfaced inline), debit,
  credit, tax code (optional), line total; add/remove line controls.
- **Keyboard model (binding):** Enter moves to next cell; Tab exits row; `Alt+Enter` or
  end-of-row Enter adds a new line focused in its account cell; `Ctrl+D` duplicates the
  current line; Delete on an empty selected row removes it; Escape reverts the edited
  cell.
- **Balance indicator:** sticky footer bar `Σdebit | Σcredit | Δdifference`; Δ≠0.00 shows
  the difference in `finance-negative` red with bilingual warning "القيد غير متوازن /
  Entry unbalanced"; the Post button stays disabled while Δ≠0 (and server re-validates —
  UI lock is convenience, engine is authority).
- **A11y:** grid semantics; Δ changes announced politely on blur, not per keystroke;
  per-line errors announced when navigated to.
- **RTL:** debit column is the start-side money column, credit inline-next; both keep
  `numeric` alignment; the balance bar mirrors (Σdebit at start).

### 6.4 `DocumentStatusBadge`

**Purpose:** one component renders the lifecycle vocabulary everywhere.

| Status | Arabic | English | Tone (tint pair) | Icon |
|--------|--------|---------|------------------|------|
| `DRAFT` | مسودة | Draft | neutral gray | pencil |
| `PENDING_APPROVAL` | بانتظار الموافقة | Pending approval | warning | hourglass |
| `APPROVED` | معتمد | Approved | primary (teal tint) | check-circle |
| `POSTED` | مُرحّل | Posted | success | ledger-check |
| `REVERSED` | معكوس | Reversed | danger tint | undo-arrow (mirrored icon) |
| `CANCELLED` | ملغي | Cancelled | gray solid, strikethrough label | x |
| `PENDING_SYNC` | بانتظار المزامنة | Pending sync | info | cloud-off |

- **Behavior:** text comes from the app i18n bundle keyed by status (component ships the
  mapping, not translations); optional icon (`showIcon`) is decorative (`aria-hidden`);
  `size: sm` (12px text, tables) / `md` (13px, document headers).
- **Companion:** `DocumentActions` menu derives allowed transitions from the same
  lifecycle table (submit, approve, post, reverse, cancel appear only where the state
  machine permits — see [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §2).
- **A11y:** badge text is real text (screen readers read "مُرحّل / Posted" per locale);
  in tables the status cell also carries `title` for hover.
- **Usage:** never re-color statuses ad hoc; tone changes require a design decision
  record.

### 6.5 `ReportViewer`

**Purpose:** renders the report result envelope
([../reporting/REPORT_CONTRACT.md](../reporting/REPORT_CONTRACT.md) §result-envelope)
identically on web and print paths.

- **Sections:** parameter summary strip (what was run: period, branch, as-of), group tree
  (collapsible group headers with subtotals), result table (DataTable in read-only mode,
  numeric columns right/decimal-aligned, totals rows sticky), drill links per row (open
  source document/account), export menu (PDF · XLSX · CSV · Print), freshness indicator
  ("كما في 2026-10-27 14:32 · as of" + cache badge).
- **States:** loading (report skeleton), ready, empty ("لا توجد بيانات لهذه الفترة"),
  error, and **assertion banner**: if the contract's reconciliation assertions fail, a
  danger banner states the failed check and disables export/print (see
  [../reporting/REPORT_RECONCILIATION.md](../reporting/REPORT_RECONCILIATION.md)).
- **A11y:** totals rows are `<th scope="row">`; drill links announce target ("فتح قيد
  اليومية JE-…"); export menu fully keyboard-operable; long reports virtualize.
- **RTL:** group indent grows from the start edge (logical padding); numeric alignment
  unchanged; chart-note: axes handled by `ChartCard` mirroring rules.
- **Print:** the same data drives `ReportTemplate` — screen and paper cannot diverge
  (ADR-0011).

## 7. Common interaction model (keyboard map, normative)

Applies to all interactive components unless a section above overrides:

| Context | Key | Action |
|---------|-----|--------|
| Anywhere | `Tab` / `Shift+Tab` | Move focus forward/backward in logical order |
| Overlays (Dialog/Drawer/Popover/CommandMenu) | `Escape` | Close + restore focus to trigger |
| Overlay primary action | `Enter` | Confirm (never maps to destructive buttons, [ACCESSIBILITY.md](ACCESSIBILITY.md) §6) |
| Menus / listboxes / combobox lists | `ArrowUp/Down` | Move active option (direction-aware in RTL) |
| Menus / listboxes | `Home` / `End` | First / last option |
| Combobox | Type | Filter; `Enter` selects active option |
| Tabs | `ArrowLeft/Right` | Next/previous tab (mirrors with `dir`) |
| Grids | `ArrowUp/Down/Left/Right` | Cell navigation (roving tabindex) |
| Grids | `Space` | Toggle row selection (when selection enabled) |
| Grids | `Enter` | Open row / activate row action |
| Inputs | `Escape` | Revert current edit to last committed value |
| Money/date fields | `Enter` | Commit + move to next field |

Announcement rules for all of the above: [ACCESSIBILITY.md](ACCESSIBILITY.md) §5.

## 8. Mandatory state matrix (per component)

Every component ships these states as stories (visual baselines require all four):

| State | Requirement |
|-------|-------------|
| `default` | Normal render, compact density, AR and EN |
| `focus-visible` | Focus ring per token spec ([DESIGN_TOKENS.md](DESIGN_TOKENS.md) §11) — one story minimum |
| `disabled / readonly` | Shows what is and is not interactive; disabled controls are focusable-`false` but never removed from DOM |
| `error / invalid` | Where the component can carry data |
| `loading` | Where the component fetches or awaits |
| `empty` | Where the component lists |

A component lacking an applicable state must document "n/a" in its spec (e.g., `Badge`
has no loading state) — silence is not an excuse at review.

## 9. Headless data hooks (pattern-side contracts)

Patterns never fetch; screens bind data through these published headless hooks
(defined beside each pattern in `packages/ui/patterns/*/hooks`):

| Hook | Pattern | Contract |
|------|---------|----------|
| `useAccountSearch` | `JournalEntryGrid` | Debounced active-leaf account search via accounting module query service; returns `{ account, label }[]` |
| `useBalancePreview` | `JournalEntryGrid` | Pure client computation of Σdebit/Σcredit/Δ from lines (no server round-trip) |
| `useItemPricing` | `LineItemsEditor`, `ItemPicker` | SHIPPED P6-T11a (headless): app-injected resolver → `{resolution, loading, error, refresh}` per (item, partner, branch, uom, qty) — apps bind it to the items `resolve-price` endpoint (BR-003) |
| `JournalEntryGrid` | Manual journal entry (PHASE-007) | `accounts`, `partners?`, `costCenters?`, `taxCodes?`, `partnerRequiredAccountIds`, `labels`, `lines`, `onLinesChange`, `currency`, `minorUnits` | balanced, unbalanced (Δ red + warning), empty (SHIPPED P7-T18: Combobox/MoneyInput composed; Ctrl+D duplicate, Alt+Enter add-line, Delete removes empty row; inline partner-required rule mirrors the engine; embedded MoneySummaryBar) | Grid semantics (§6.3); UI lock is convenience, engine is authority | The journal workspace (archetype 4) |
| `MoneySummaryBar` | Live Σdebit/Σcredit/Δ totals bar (PHASE-007) | `debit`, `credit` (canonical strings), `currency`, `minorUnits`, `labels` | balanced (success tone), unbalanced (finance-negative + bilingual warning) | Exact decimal math (BigInt minor units — can never disagree with the engine on the same fixture); aria-live polite | JournalEntryGrid (embedded); any financial document footer |
| `ApprovalsQueue` | Pending-approval worklist (PHASE-007) | `rows: {id,title,description?,totalBase,currency,submittedBy,submittedAt,isOwnSubmission,status}[]`, `labels`, `onApprove?`, `onReject?`, `onOpenPreview?`, `loading` | default (rows + SoD hint), empty, loading | BR-034 decisions compare BASE totals; creator rows show the self-approval hint (server still enforces SoD); preview links to the engine-generated view | Approvals screen; period close workspace |
| `usePartnerBalance` | `PartnerPicker` | SHIPPED P6-T11a (headless): app-injected fetcher → `{balance: {openBalance, draftBalance, overdueAmount, basis: DRAFTS_ONLY}, loading, error, refresh}` |
| `useStockAvailability` | `ItemPicker` | SHIPPED P6-T11a (honest stub): `{available: null, basis: "STOCK_POSTS_IN_PHASE_010"}` — no fabricated zeros before the stock ledger posts (PHASE-010) |
| `useReportRun` | `ReportViewer` | Runs/refreshes a report contract, polls job status, exposes result envelope + freshness |

Hook contracts are typed against shared-kernel types (Money as decimal strings —
[../architecture/ADR/ADR-0009-money-precision.md](../architecture/ADR/ADR-0009-money-precision.md));
mocked fixtures ship with each hook for Storybook and tests
([VISUAL_TESTING.md](VISUAL_TESTING.md) §3).

## 10. Adding a component (checklist)

1. Draft catalog entry (purpose/props/states/a11y/RTL) → review.
2. Build RTL-first in `packages/ui`; logical utilities only.
3. Unit + axe + keyboard tests; both densities; AR+EN stories for every state.
4. Visual baselines committed with the change ([VISUAL_TESTING.md](VISUAL_TESTING.md)).
5. Update this file (row or §section), changeset, and the phase document's scope note.
