# RTL Design Rules

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-27

Binding implementation rules for direction correctness. The product is **RTL-first**
([DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md) §1): components are built and tested with
`dir="rtl"`, and LTR is the generated mirror. Rendering-level rules (fonts, numerals,
calendar formatting) live in [../localization/RTL_AND_LTR.md](../localization/RTL_AND_LTR.md);
this file governs layout, icons, component behavior, and test gates.

## 1. Logical properties only (normative)

1. All direction-aware layout MUST use logical CSS / Tailwind logical utilities:
   - Spacing: `ms-*`, `me-*`, `ps-*`, `pe-*` (margin/padding-inline-start/end)
   - Alignment: `text-start`, `text-end`, `items-start/end`, `self-start/end`
   - Positioning: `start-0`, `end-0`, `inset-inline-*`
   - Borders: `border-s-*`, `border-e-*`
   - Sizing: logical sizes where a directional dimension exists (`ms`, `w`, `max-w` are
     fine; never `left/right` offsets)
2. **Banned in `packages/ui` and shared components:** physical direction utilities —
   `pl-*`, `pr-*`, `ml-*`, `mr-*`, `text-left`, `text-right`, `left-*`, `right-*`,
   `border-l-*`, `border-r-*`. Enforced by lint rule **`erp/no-physical-direction`**
   (error severity in CI from PHASE-005).
3. Sanctioned exceptions (each requires an inline `// rtl-exempt:` comment explaining
   why, and visual tests in both directions):
   - Elements that are *physically* anchored regardless of direction (e.g., a scrollbar
     gutter workaround, print page numbers — §8).
   - Third-party chart internals where we pass logical config instead
     ([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) ChartCard).
4. Never use `transform: scaleX(-1)` to mirror UI. The only sanctioned reflection is
   *icon assets* that have no mirrored variant (§4), and it is applied by the icon
   component's direction-prop, not by screens.

## 2. Direction source of truth

- `<html lang="ar" dir="rtl">` (or `lang="en" dir="ltr"`) is set by the app shell from
  the session locale; deep links carry the locale prefix (`/ar/…`, `/en/…`).
- Components must not set `dir` themselves except for **embedded direction runs**
  (§5) where `dir="ltr"` + isolation wraps a value, not a layout.
- Print artifacts set `dir` per template locale at render time (§9).

## 3. Mirroring catalog — what mirrors and what never does

### 3.1 Mirrors in RTL (start/end swap)

| UI element | Rule |
|------------|------|
| Sidebar / drawer position | Start edge (right in RTL) |
| Steppers, breadcrumbs separators, pagination arrows, tab underlines | Mirror |
| Progress/fill bars | Grow from start edge |
| Toast slide-in | From start edge (drawer/close buttons at end) |
| Dropdown sub-menu expansion | Toward start |
| Text caret & selection affordances | Follow direction naturally |
| Arrows in empty-state/flow illustrations | Mirror |
| Chart category axes | First category at start edge; y-axis labels at start
  ([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) ChartCard) |
| Tables | Column order mirrors; row action (kebab) column sits at the end side |
| Tooltips / popover collision | Logical `align="start" / "end"` only |

### 3.2 NEVER mirrors (physically identical in both directions)

| Content | Why |
|---------|-----|
| Numbers & amounts (all numerals) | Digit order is LTR by definition; alignment is decimal-based (`numeric` columns) |
| Logos (tenant + platform) | Brand identity |
| Media, photos, illustrations of real objects | A mirrored clock/photo is a lie |
| Barcodes & QR codes | Scanners don't read mirrored codes |
| Latin brand/product names, e-mails, URLs | Embedded LTR runs (§5) |
| Code, JSON, formulas | Syntax order is physical |
| Phone numbers, IBANs, tax registration numbers | Identifier order is LTR |
| Clock/compass/map imagery | Physical-world semantics |
| Playback transport icons (⏮ ⏸) if ever used | Media convention |

When a "never mirrors" item appears inside a mirrored container, it is wrapped per §5 —
it must not silently corrupt surrounding text.

## 4. Icon mirroring implementation

1. Default: Lucide icons render **as-shipped** (non-directional majority).
2. Directional icons are declared in a single registry in `packages/ui`:

```ts
// utils/icons.ts — the ONLY place direction is decided
const DIRECTIONAL = new Set(['arrow-left','arrow-right','arrow-start','arrow-end',
  'chevron-left','chevron-right','undo-2','redo-2','indent-increase','indent-decrease',
  'list-ordered','corner-down-left','corner-up-left','log-in','log-out','send',
  'message-reply','reply','share','move-left','move-right','panel-left','panel-right']);

export function Icon({ name, ...rest }) {
  const rtl = useDirection() === 'rtl';
  const mirrored = DIRECTIONAL.has(name) && rtl;
  return <Lucide name={name} aria-hidden
    style={mirrored ? { transform: 'scaleX(-1)' } : undefined} {...rest} />;
}
```

3. Screens never mirror icons themselves; they pick semantic names
   (`arrow-start` = "go start-ward"), and the registry renders the correct asset.
4. `undo-2` (reversal icon on `DocumentStatusBadge.REVERSED`) mirrors in RTL; barcode/QR
   icons (`barcode`, `qr-code`) are non-directional and never enter `DIRECTIONAL`.
5. Any new icon gets a one-line entry in this file's review checklist: directional or
   not, decided once, tested AR+EN.

## 5. Bidi typography mixing (binding)

Embedded LTR runs inside Arabic text (tax numbers, IBANs, e-mails, document numbers,
serials) MUST be isolated so the Unicode bidi algorithm cannot reorder the sentence:

- Use Unicode isolates: `U+2068` (LRI) … `U+2069` (PDI) around the run, or wrap the value
  element with `dir="ltr"` + `unicode-bidi: isolate` (CSS) — the `Input`/`Badge`
  components expose `bidiIsolate` for exactly this.
- Display-only mixed strings are built from parts in logical order and wrapped by the
  `bidi()` helper from `packages/ui/utils` — never "typed visually".
- Punctuation between Arabic and an LTR run (e.g., `فاتورة رقم INV-0001:`) is the classic
  corruption case; the helper places the punctuation outside the isolate so it renders on
  the correct side.
- Numerals inside Arabic sentences remain Western digits at MVP (user preference for
  Arabic-Indic applies to *presentation* of standalone numeric values, not identifiers —
  see [DESIGN_TOKENS.md](DESIGN_TOKENS.md) §6, [../localization/RTL_AND_LTR.md](../localization/RTL_AND_LTR.md)).

## 6. Scrollbars

- Vertical scrollbars sit on the **trailing side** per browser/OS default under `dir`
  (right in RTL desktops — do not fight the platform).
- Containers must reserve gutter with logical padding (`pe-*`) so content doesn't
  reflow when a scrollbar appears inside RTL scroll areas.
- Custom-styled thin scrollbars (design system surfaces) use logical `inset-inline-*`
  positioning only.
- Horizontal scroll regions (wide tables) scroll naturally; the start column stays
  sticky with logical `start-0`.

## 7. Date pickers (Gregorian + Hijri) in RTL

- The calendar grid mirrors: week starts column (السبت/الأحد per locale pack) is at the
  start edge; navigation arrows use §4 rules ("previous" arrow points start-ward).
- Day cells are square 32px (compact); month/year headers center; the weekday header row
  is a real row header for screen readers.
- Dual-calendar mode: primary calendar large, secondary (Hijri or Gregorian) as a
  caption line per cell at `text-xs` — never two side-by-side grids at MVP.
- Typed input accepts `YYYY-MM-DD` (Gregorian canonical); display formatting per locale
  pack ([../localization/RTL_AND_LTR.md](../localization/RTL_AND_LTR.md)); the stored value
  is always canonical Gregorian + the picker converts on entry when the tenant's primary
  calendar is Hijri (conversion service from PHASE-005 i18n foundation).

## 8. Numbers, tables, and alignment inside RTL

- All money/quantity columns: `font-variant-numeric: tabular-nums`, mono digits
  (`--erp-font-mono` in dense grids), `text-end` **logical** alignment = decimal side;
  the digit run itself is `dir="ltr"` isolated.
- Thousands separator `,` and decimal point `.` are physical (do not mirror); negative
  sign leads the digits; parentheses-as-negative are forbidden (ambiguous in RTL) — use
  minus sign + color per [DESIGN_TOKENS.md](DESIGN_TOKENS.md) §4.
- Totals rows mirror position (end of table, indent from start).

## 9. Print direction per template locale

- Each print render sets `dir`/`lang` from the template locale parameter
  ([../reporting/PRINTING_AND_EXPORT.md](../reporting/PRINTING_AND_EXPORT.md)):
  Arabic templates render RTL pages; English templates render LTR pages; bilingual
  templates (invoices) render RTL page flow with LTR-isolated identifier runs.
- Page numbers sit at the physical bottom-start corner of the *paper* (bottom-right for
  Arabic RTL documents, bottom-left for LTR) — a sanctioned §1 exception because paper
  is physical.
- Receipt templates: header/totals Arabic-first RTL; Latin lines (e.g., "TOTAL") are
  isolated runs; QR/barcode blocks never mirror.

## 10. Testing requirements (gates)

1. **Per component:** AR + EN snapshots for every state, both densities
   ([VISUAL_TESTING.md](VISUAL_TESTING.md)); a component with no LTR story fails CI.
2. **Per page:** Playwright runs every E2E journey twice — `dir=rtl` (Arabic locale) and
   `dir=ltr` (English locale) — assertions on positions (sidebar at start edge) and on
   non-mirroring content (amount cells identical digit order).
3. **Lint:** `erp/no-physical-direction` error in CI (PHASE-005).
4. **Mixed-script fixtures:** dedicated fixtures (`فاتورة INV-000123 من 2026-01-02 لـ
   john@example.com`) asserted byte-for-byte against expected renders in both
   directions.
5. **Manual audit:** per release, the RTL checklist (this file §1–§9) is walked on 3
   representative screens by a bilingual reviewer ([ACCESSIBILITY.md](ACCESSIBILITY.md)
   §release-audit).
