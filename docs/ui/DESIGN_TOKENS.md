# Design Tokens

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-27

The single source of truth for visual values in `packages/ui` and all apps. Values are
**concrete and normative**: implementations read tokens, never invent hexes or px values.
CSS custom properties use the `--erp-<group>-<name>` convention and are exposed to
Tailwind v4 via `@theme` (§naming). Philosophy: [DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md).

**Theme scope at MVP:** one light brand theme. Dark mode is out of scope until after
[PHASE-014](../planning/MASTER_ROADMAP.md); the token *structure* below is
color-scheme-ready (semantic indirection, no raw palette usage in components).

## 1. Color — brand primary (teal)

A professional teal family: calm, trustworthy, distinct from the semantic red/green used
for financial signs — chosen so a "positive balance" green or "negative" red is never
confused with brand chrome.

| Token | Value | Primary use |
|-------|-------|-------------|
| `--erp-color-primary-50` | `#F0FDFA` | Selected-row tint, hover wash |
| `--erp-color-primary-100` | `#CCFBF1` | Active tab indicator background, checked checkbox fill |
| `--erp-color-primary-200` | `#99F6E4` | Focus ring on dark surfaces, subtle borders on tinted chips |
| `--erp-color-primary-300` | `#5EEAD4` | Decorative-only accents (charts secondary series) |
| `--erp-color-primary-400` | `#2DD4BF` | Icon/link on primary-700+ backgrounds |
| `--erp-color-primary-500` | `#14B8A6` | Chart series 1, progress track fill |
| `--erp-color-primary-600` | `#0F766E` | **Core brand**: buttons, links, focus ring, active nav |
| `--erp-color-primary-700` | `#115E59` | Primary button hover/active |
| `--erp-color-primary-800` | `#134E4A` | Primary text on primary-50 tints |
| `--erp-color-primary-900` | `#042F2E` | Headline on light, POS dark-panel text |
| `--erp-color-primary-950` | `#032726` | POS/terminal dark surface |

Contrast notes (vs `#FFFFFF`): primary-600 ≈ 5.5:1 (passes AA text/UI), primary-700
≈ 7.4:1. White text on primary-600 buttons ≈ 5.5:1 — AA compliant at all text sizes.

## 2. Color — neutrals (gray scale)

| Token | Value | Primary use |
|-------|-------|-------------|
| `--erp-color-gray-50` | `#F9FAFB` | App page background, zebra row alt |
| `--erp-color-gray-100` | `#F3F4F6` | Sunken panels, table header, input disabled fill |
| `--erp-color-gray-200` | `#E5E7EB` | Default hairline border, divider lines |
| `--erp-color-gray-300` | `#D1D5DB` | Input borders, strong dividers |
| `--erp-color-gray-400` | `#9CA3AF` | Placeholder text (large/secondary only — see §contrast), disabled borders |
| `--erp-color-gray-500` | `#6B7280` | Secondary icons, tertiary text |
| `--erp-color-gray-600` | `#4B5563` | Secondary text, column headers, captions |
| `--erp-color-gray-700` | `#374151` | Body text (secondary contexts), hover borders |
| `--erp-color-gray-800` | `#1F2937` | Emphasis text, table body default |
| `--erp-color-gray-900` | `#111827` | **Default body text**, headings |
| `--erp-color-gray-950` | `#030712` | Print black (with print stylesheet remap) |

## 3. Color — semantic states

Each family has a 700-level "solid" anchor (white text passes AA on it) and a
100-bg/800-text tint pair used by badges.

| Semantic | Solid (bg or text) | Tint bg | Tint text | Border | Use |
|----------|--------------------|---------|-----------|--------|-----|
| Success / نجاح | `#15803D` (`success-700`) | `#DCFCE7` | `#166534` | `#BBF7D0` | POSTED badge, reconciliation green, saved toast |
| Success-info / جاهز | `#0E7490` (`cyan-700`) | `#CFFAFE` | `#155E75` | `#A5F3FC` | APPROVED badge (awaiting posting) — distinct from POSTED so approvers can see the queue |
| Warning / تحذير | `#B45309` (`warning-700`) | `#FEF3C7` | `#92400E` | `#FDE68A` | PENDING_APPROVAL badge, low-stock, soft-closed period |
| Danger / خطأ | `#B91C1C` (`danger-700`) | `#FEE2E2` | `#991B1B` | `#FECACA` | Validation errors, REVERSED/CANCELLED context, destructive buttons |
| Info / معلومات | `#1D4ED8` (`info-700`) | `#DBEAFE` | `#1E40AF` | `#BFDBFE` | Hints, DRAFT badge, in-progress job state |

**Document-status badge binding (adopted from Folder 2, consolidation 2026-10-28):**
document lifecycle states MUST render status badges through this table and only through
this table — `DRAFT`→Info, `PENDING_APPROVAL`→Warning, `APPROVED`→Success-info,
`POSTED`→Success, `VOIDED`/`CANCELLED`→Danger. The mapping is part of the design-system
contract: component tests and visual-regression baselines assert it, and no screen may
invent a per-screen status color. (Financial sign semantics in §4 below are a separate,
additive concern — status color shows *workflow* state, sign color shows *money* state.)

Full scales are generated (e.g. `--erp-color-success-50 #F0FDF4` … `900 #14532D`);
components reference the four pairs above, not arbitrary stops.

## 4. Color — financial sign semantics (binding)

| Token | Value | Rule |
|-------|-------|------|
| `--erp-color-finance-positive` | `#15803D` | Amounts ≥ 0 shown in credit-favorable contexts (e.g., AR balance owed to us) |
| `--erp-color-finance-negative` | `#B91C1C` | Amounts < 0, overpayments, negative stock variance, credit-limit breach |
| `--erp-color-finance-neutral` | `inherit` | Zero (`0.00`) renders gray-600, never red or green |

**Red means negative by sign — never "credit column" or "money owed".** A debit balance
on an expense account is not red; a *negative* receivable balance is. Debit/credit
columns are distinguished by column headers (مدين / دائن), not color. This prevents the
classic bilingual-ERP confusion where "red = haram/owed" clashes with accounting sides.

## 5. Surfaces, borders, elevation

| Token | Value | Use |
|-------|-------|-----|
| `--erp-surface-page` | `#F9FAFB` | App background behind cards |
| `--erp-surface-card` | `#FFFFFF` | Cards, tables, dialogs, drawers |
| `--erp-surface-sunken` | `#F3F4F6` | Embedded panels, read-only fields, code chips |
| `--erp-surface-overlay` | `rgba(3, 7, 18, 0.45)` | Modal/drawer scrim (with `backdrop-filter: none` — no blur in transactional contexts) |
| `--erp-border-subtle` | `#E5E7EB` | Table grid lines, card dividers |
| `--erp-border-default` | `#D1D5DB` | Inputs, separators |
| `--erp-border-strong` | `#9CA3AF` | Emphasis borders, drag handles |
| `--erp-surface-pos` | `#032726` | POS terminal chrome (dark, PHASE-016) |
| `--erp-surface-pos-raised` | `#042F2E` | POS tiles/keys on the dark panel |

Shadows (subtle, layered — the product must feel printed, not floating):

| Token | Value | Applies to |
|-------|-------|------------|
| `--erp-shadow-e1` | `0 1px 2px rgba(3,7,18,0.06)` | Cards, inputs on hover |
| `--erp-shadow-e2` | `0 2px 4px rgba(3,7,18,0.07)` | Sticky headers, dropdowns |
| `--erp-shadow-e3` | `0 4px 12px rgba(3,7,18,0.10)` | Popovers, dialogs, drawers |
| `--erp-shadow-e4` | `0 8px 24px rgba(3,7,18,0.14)` | Command menu, toast stack |

## 6. Typography

Families (self-hosted woff2, `font-display: swap`):

| Token | Stack | Use |
|-------|-------|-----|
| `--erp-font-ar` | `'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif` | `lang="ar"` contexts (default) |
| `--erp-font-latin` | `'Inter', 'IBM Plex Sans Arabic', system-ui, sans-serif` | `lang="en"` contexts |
| `--erp-font-mono` | `'IBM Plex Mono', ui-monospace, monospace` | Document numbers, barcodes, IBANs, serials, optional amount columns |

The app sets the family per document direction; both stacks cross-fallback so a Latin
run inside an Arabic sentence and vice versa never falls to a system font.

Scale (px = rem × 16; base is 14px, tuned for dense data screens):

| Token | px | rem | Weight default | Line height | Use |
|-------|----|-----|----------------|-------------|-----|
| `--erp-text-xs` | 12 | 0.75 | 400/500 | 16px | Table captions, badges, helper text |
| `--erp-text-sm` | 13 | 0.8125 | 400 | 20px | Dense table cells (compact density) |
| `--erp-text-base` | 14 | 0.875 | 400 | 20px | Body default, form inputs, table cells |
| `--erp-text-md` | 15 | 0.9375 | 500 | 24px | Section titles, dialog titles |
| `--erp-text-lg` | 18 | 1.125 | 600 | 28px | Page titles |
| `--erp-text-xl` | 22 | 1.375 | 600 | 30px | Dashboard headings, POS totals |
| `--erp-text-2xl` | 28 | 1.75 | 700 | 36px | Statement grand totals, onboarding hero |

Weights: `400` body · `500` emphasis/labels · `600` headings/buttons · `700` totals &
`2xl` only. Line-height tokens: `--erp-leading-tight 1.2`, `--erp-leading-normal 1.45`,
`--erp-leading-relaxed 1.7` (long-form help text).

**Numerals (binding):** `font-variant-numeric: tabular-nums` on every element containing
money, quantities, rates, or document numbers. Arabic-Indic numerals (٠١٢٣…) are a
user-level preference (`--erp-numerals: arabic-indic`) defaulting to Western digits;
financial *reports and exports* always use Western digits at MVP
([../reporting/REPORT_CONTRACT.md](../reporting/REPORT_CONTRACT.md) §localization).

## 7. Spacing

4px base grid. Allowed stops only — no 5px, 10px, 18px oddities:

| Token | px | Typical use |
|-------|----|-------------|
| `--erp-space-0` | 0 | Flush edges |
| `--erp-space-1` | 4 | Icon↔label gap, inline chips |
| `--erp-space-2` | 8 | Control padding-y (compact), field gaps |
| `--erp-space-3` | 12 | Card padding (compact), cell padding-x |
| `--erp-space-4` | 16 | Card padding, form field vertical rhythm |
| `--erp-space-5` | 20 | Card padding (comfortable) |
| `--erp-space-6` | 24 | Page gutter (lg+), section spacing |
| `--erp-space-8` | 32 | Page gutter (xl), drawer padding |
| `--erp-space-12` | 48 | Dashboard card gaps |
| `--erp-space-16` | 64 | Wizard/onboarding whitespace |

## 8. Radii

| Token | px | Use |
|-------|----|-----|
| `--erp-radius-sm` | 4 | Badges, chips, checkboxes |
| `--erp-radius-md` | 6 | Buttons, inputs, selects |
| `--erp-radius-lg` | 8 | Cards, dialogs, drawers, table containers |
| `--erp-radius-full` | 9999px | Avatars, pills, toggle knobs |

Print templates use their own physical sizes ([../reporting/PRINTING_AND_EXPORT.md](../reporting/PRINTING_AND_EXPORT.md)).

## 9. Density modes

Density is a first-class prop (`density="compact" | "comfortable"`) on data components.

| Measurement | Compact (default for grids/forms) | Comfortable (settings, wizards) |
|-------------|-----------------------------------|--------------------------------|
| Grid row height | **32px** | 40px |
| Control height (input/button) | 32px | 40px |
| Cell padding | 6px 12px | 10px 16px |
| Cell font | `text-sm` 13px | `text-base` 14px |
| Form label position | Inline start (row layout) | Stacked |
| Touch target | 32px (keyboard/desk) | 40px (touch surfaces require ≥44px — see [ACCESSIBILITY.md](ACCESSIBILITY.md) §touch) |

POS grid keys override with 48–64px tiles ([PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md) §point-of-sale).

## 10. Z-index layers

| Token | Value | Layer |
|-------|-------|-------|
| `--erp-z-base` | 0 | Normal content |
| `--erp-z-raised` | 10 | Sticky table headers |
| `--erp-z-banner` | 150 | Global banners (period soft-close, read-only mode) |
| `--erp-z-dropdown` | 1000 | Select menus, autocomplete lists |
| `--erp-z-drawer` | 1100 | Sheets/drawers |
| `--erp-z-overlay` | 1200 | Scrim under dialogs |
| `--erp-z-dialog` | 1300 | Modal dialogs |
| `--erp-z-popover` | 1400 | Popovers, date pickers |
| `--erp-z-tooltip` | 1500 | Tooltips |
| `--erp-z-toast` | 1600 | Toast stack |

Gaps of ≥50 between adjacent layers leave room for sanctioned intermediates.

## 11. Focus ring (binding)

```css
:where(button, a, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--erp-focus-ring);
  outline-offset: 2px;
  border-radius: var(--erp-radius-md);
}
```

| Context | `--erp-focus-ring` |
|---------|--------------------|
| Light surfaces (default) | `#0F766E` (primary-600) |
| On primary-600+ fills | `#99F6E4` (primary-200) |
| On dark POS surface | `#5EEAD4` (primary-300) |
| Invalid/errored field | `#B91C1C` (danger-700), 2px, offset 2px — same geometry |

Never remove the outline; never substitute a color-only or glow-only affordance.

## 12. Breakpoints

| Token | Width | Design target |
|-------|-------|---------------|
| `sm` | 640px | Phones (owner's mobile view) |
| `md` | 768px | Small tablets, portrait |
| `lg` | 1024px | **Back-office minimum**; sidebar + content |
| `xl` | 1280px | Standard accountant desk; dense grids get horizontal room |
| `2xl` | 1536px | Large desks; optional three-pane document workspaces |
| `--erp-width-journal-grid` | 960px | `JournalEntryGrid` horizontal-scroll floor (8 columns + row affordances; §6.3) |

Below `lg`, back-office archetypes degrade to read-mostly (see
[PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md)); entry-heavy work assumes `lg+`.

## 13. Motion durations & easing

| Token | Value | Use |
|-------|-------|-----|
| `--erp-duration-instant` | 0ms | Sorting, filtering, totals updates, posting confirmations |
| `--erp-duration-fast` | 120ms | Enter/exit of menus, tooltips, small feedback |
| `--erp-duration-base` | 150ms | **Maximum** for any enter/exit or position shift |
| `--erp-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default |
| `--erp-ease-enter` | `cubic-bezier(0, 0, 0.2, 1)` | Enter |
| `--erp-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Exit |

Distance budget: opacity + ≤4px translate only; scale ≤1.02. Full policy:
[MOTION_GUIDELINES.md](MOTION_GUIDELINES.md). `prefers-reduced-motion` collapses all
durations to 0ms with layout preserved.

## 14. Iconography

- Library: **Lucide** (tree-shaken, currentColor, stroke-based).
- Sizes: 16px inside tables/badges; 20px in toolbars/buttons; 24px only for POS tiles.
- Stroke: **1.5** at all sizes.
- Directional icons (arrows, undo, indent, list-ordered) follow the mirroring rules in
  [RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md) §icon-mirroring; non-directional icons are
  never mirrored. Logos, barcodes, QR are never mirrored.

## 15. Token naming convention & Tailwind v4 mapping

**CSS custom properties:** `--erp-<group>-<role>-<state?>-<variant?>`, e.g.
`--erp-color-primary-600`, `--erp-shadow-e3`, `--erp-space-4`, `--erp-text-sm`. Components
consume semantic aliases (`--erp-surface-card`, `--erp-color-finance-negative`); raw
palette stops are legal only in token definitions, theming, and charts.

**Tailwind v4 (`packages/ui/src/theme.css`):**

```css
@theme {
  /* colors map 1:1 to tokens; Tailwind generates utilities like
     bg-primary-600, text-gray-700, border-subtle */
  --color-primary-600: #0F766E;
  --color-primary-700: #115E59;
  --color-gray-900:    #111827;
  --color-success-700: #15803D;
  --color-warning-700: #B45309;
  --color-danger-700:  #B91C1C;
  --color-info-700:    #1D4ED8;
  --color-surface-card: #FFFFFF;
  --color-surface-page: #F9FAFB;
  --color-finance-negative: #B91C1C;

  --font-sans: "IBM Plex Sans Arabic", "Inter", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --text-sm: 0.8125rem;   /* 13px */
  --text-base: 0.875rem;  /* 14px */

  --spacing-1: 4px;  --spacing-2: 8px;  --spacing-3: 12px;
  --spacing-4: 16px; --spacing-6: 24px; --spacing-8: 32px;

  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px;

  --shadow-e1: 0 1px 2px rgb(3 7 18 / 0.06);
  --shadow-e3: 0 4px 12px rgb(3 7 18 / 0.10);
}
```

Logical utilities (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start`, `text-end`,
`start-*`, `end-*`) are the only direction-aware tools; physical `left/right` utilities
are lint-banned in `packages/ui` and shared components
([RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md)).

## 16. Contrast verification (AA floor check)

Automated check runs in CI on the token file (design-token contrast gate,
[VISUAL_TESTING.md](VISUAL_TESTING.md)):

| Pair | Ratio (approx.) | Requirement | Result |
|------|------------------|-------------|--------|
| gray-900 on white | 17.4:1 | 4.5:1 | PASS |
| gray-600 on white | 7.6:1 | 4.5:1 | PASS |
| gray-500 on white | 4.8:1 | 4.5:1 | PASS (secondary text only) |
| primary-600 on white | 5.5:1 | 4.5:1 (text) · 3:1 (UI) | PASS |
| success-700 on white | 4.9:1 | 4.5:1 | PASS |
| warning-700 on white | 4.7:1 | 4.5:1 | PASS |
| danger-700 on white | 5.9:1 | 4.5:1 | PASS |
| info-700 on white | 6.3:1 | 4.5:1 | PASS |
| White on primary-600 | 5.5:1 | 4.5:1 | PASS |
| success tint text `#166534` on `#DCFCE7` | 6.8:1 | 4.5:1 | PASS |
| gray-400 placeholder `#9CA3AF` on white | 2.8:1 | — | Placeholder is exempt as "inactive"; *required* hints use gray-600 |

Placeholder exemption is scoped: any text carrying meaning (validation, amounts) may
never use gray-400.

## 17. Token governance

1. Tokens live in `packages/ui/src/tokens/` as the canonical export (CSS file + TS
   object for RN/Android mirroring, ADR-0014). Docs and code must not diverge; the visual
   suite fails on drift.
2. Adding a token: propose with component use case → add to this file → implement →
   Storybook entry shows it in AR and EN.
3. Changing a token *value*: requires design-system decision record + updated visual
   baselines in the same PR ([VISUAL_TESTING.md](VISUAL_TESTING.md) §baselines).
4. No component may hard-code a color, px, or font value that exists as a token —
   enforced by lint rule `erp/no-raw-design-values`.
