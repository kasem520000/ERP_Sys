# Accessibility

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-27

The accessibility contract for the platform. **WCAG 2.1 Level AA is the floor for every
screen** — in both Arabic (RTL) and English (LTR), on desktop, tablet, and mobile.
Accessibility is part of each component's definition of done
([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §8), not a later audit. The floor binds all
modules and industry templates ([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)
INV-022 discipline: configuration can never lower this floor either).

## 1. Keyboard completeness (all interactive surfaces)

- **Every action reachable by keyboard.** No hover-only menus, no drag-only reordering
  (drag alternatives: keyboard move commands), no click-only affordances.
- **Focus order** follows logical reading order (start→end per direction — RTL-aware):
  header → breadcrumbs → page content → action bar. `tabindex` > 0 is forbidden;
  roving tabindex is the pattern for grids ([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) §6.1).
- **Skip-to-content:** first Tab stop is a visible "تجاوز إلى المحتوى / Skip to content"
  link targeting the main landmark.
- **Dialogs and drawers:** focus moves in on open, is trapped while open (Tab cycles;
  Shift+Tab reverses), Escape closes, and focus **restores to the trigger element** on
  close — including after destructive confirmations.
- **Keyboard shortcuts** follow the registry ([NAVIGATION_MODEL.md](NAVIGATION_MODEL.md)
  §7): single-letter shortcuts never fire while typing; `?` documents all shortcuts.
- **No keyboard traps** anywhere outside intentional modal traps; any trap has a visible
  exit.

## 2. ARIA requirements per component type

| Component type | Requirement |
|----------------|-------------|
| Grids (`DataTable`, `JournalEntryGrid`) | `role="grid"`/`treegrid` semantics, `aria-rowcount`/`colcount` for virtualized data, roving tabindex, sortable headers announce sort state (`aria-sort`) |
| Comboboxes / pickers | `role="combobox"` + `aria-expanded`, `aria-activedescendant` while browsing, results count announced |
| Dialogs | `role="dialog"` + `aria-modal="true"` + labelled by title; description wired |
| Drawers/Sheets | `role="dialog"` with labelled title; scrim click cancels but Escape and close button always exist |
| Tabs | `role="tablist"`/`tab`/`tabpanel`; arrow-key movement direction mirrors with `dir` |
| Toasts | `role="status"` (polite) for success/info; `role="alert"` (assertive) for errors and posting failures |
| Tooltips/Popovers | `aria-describedby` wired on focus **and** hover; dismissible via Escape (WCAG 1.4.13) |
| Status badges | Text content, never color/icon alone |
| Form fields | `label` bound (`for`/`id`), `aria-invalid` + `aria-describedby` on errors, fieldset+legend for groups |
| Charts | `role="img"` + `aria-label` summary; a data table alternative is available in details |

## 3. Color and contrast targets (AA)

- **Text:** ≥ **4.5:1** against its background; large text (≥ 24px or ≥ 18.66px bold)
  ≥ 3:1.
- **UI components & graphical objects** (input borders, focus rings, icons, chart
  series that carry meaning): ≥ **3:1**.
- The documented token palette is constructed to pass: body text gray-900 on white
  17.4:1; secondary gray-600 7.6:1; brand primary-600 5.5:1; semantic solid anchors
  (success-700 #15803D ≈ 4.9:1, warning-700 #B45309 ≈ 4.7:1, danger-700 #B91C1C ≈ 5.9:1,
  info-700 #1D4ED8 ≈ 6.3:1) and tint pairs pass AA — the full matrix with ratios is
  [DESIGN_TOKENS.md](DESIGN_TOKENS.md) §16, and **it is stated as a CI check**: the token
  contrast gate recomputes ratios on every token PR, so the palette is *verified*, not
  assumed.
- Color never carries meaning alone: statuses pair color with text + icon
  ([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) §6.4); finance-negative red pairs with a
  minus sign.
- Placeholder exemption is scoped to inactive hints only
  ([DESIGN_TOKENS.md](DESIGN_TOKENS.md) §16); meaningful text may never use gray-400.

## 4. Focus visibility

- Global `:focus-visible` spec: **2px solid outline, 2px offset**, color by context
  (`--erp-focus-ring`, [DESIGN_TOKENS.md](DESIGN_TOKENS.md) §11) — primary-600 on light
  surfaces, primary-200 on filled brand surfaces, danger-700 on invalid fields; same
  geometry in both directions.
- Focus is never removed (`outline: none` is lint-banned); replacing outline with a
  background change alone is forbidden (WCAG 2.4.7 + 1.4.11 — the ring must also clear
  3:1 against adjacent colors).

## 5. Screen reader announcements (live regions)

- **Posting / money-critical outcomes are assertive:** "تم ترحيل القيد JE-2026-0001 /
  Posted JE-2026-0001" via `role="alert"` toast; failures include the safe reason and the
  field to fix.
- **Polite regions:** grid row counts after filtering, totals after recalculation
  (debounced so typing does not spam — announce on blur/commit), background job progress.
- **Never announce** per-keystroke value changes, virtualization swaps, or tooltip opens.
- Announcements are bilingual-capable: they read the active locale's string.

## 6. Forms and error announcement patterns

1. Inline validation: message text is programmatically tied (`aria-describedby`);
   `aria-invalid="true"` on the field; on failed submit, focus moves to the **first**
   invalid field and an assertive summary announces "يوجد 3 أخطاء / 3 errors found" with
   per-error links.
2. Error text states the problem **and the fix** ("التاريخ داخل فترة مقفلة — اختر تاريخاً
   في فترة مفتوحة / Date is in a locked period — choose an open period"), never just
   "Invalid input".
3. Required fields marked visually (asterisk + legend explanation) and programmatically
   (`required` / `aria-required`).
4. Confirm dialogs for destructive actions restate the consequence and require an
   explicit choice (no focus-default on the destructive button; Enter maps to Cancel).

## 7. Reduced motion

- `@media (prefers-reduced-motion: reduce)`: all transitions/animations collapse to 0ms
  while preserving final layout; skeletons become static gray-100 blocks; no parallax or
  auto-moving content anywhere ([MOTION_GUIDELINES.md](MOTION_GUIDELINES.md) §policy).
- Motion is never the sole feedback channel — every animated confirmation has a static
  equivalent (toast/badge).

## 8. Touch targets (POS, tablet, mobile)

- On touch surfaces (POS archetype, mobile view, `<md` tablets): all interactive elements
  ≥ **44×44px** with ≥ 8px separation; POS tiles are 48–64px
  ([PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md) §10).
- Hover-dependent patterns are banned on touch surfaces; `:hover` styles may exist but
  must never gate functionality.
- Desktop compact density (32px rows/controls) is legal only where the surface is
  keyboard+mouse; the density provider flags touch contexts and components switch to
  ≥44px hit areas automatically.

## 9. Automated gates (CI, from PHASE-005)

| Gate | Scope | Tooling |
|------|-------|---------|
| axe per page | Every E2E journey, both `dir=rtl` and `dir=ltr` | `@axe-core/playwright` — 0 violations allowed |
| Keyboard-only journey | Post an invoice, enter a journal, approve, run a report — no pointer input | Playwright keyboard-only spec |
| Token contrast gate | All text/UI token pairs recomputed | CI check on `tokens.css` ([DESIGN_TOKENS.md](DESIGN_TOKENS.md) §16) |
| Focus & announcements | Focus trap/restore assertions; live-region text assertions | Component tests + E2E |
| Visual a11y snapshots | AR+EN storybook runs include focus-visible + reduced-motion states | [VISUAL_TESTING.md](VISUAL_TESTING.md) |

## 10. Manual audit checklist (per release, before ship)

1. Bilingual reviewer walks 3 representative screens (one transactional, one report,
   one settings) with: keyboard only → screen reader (AR voice + EN voice) → 200% zoom
   → reduced motion → grayscale (color-independence check).
2. RTL-specific pass: focus ring visibility on RTL layouts, announcement language
   correctness, mixed-script reading order ([RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md) §10).
3. Findings logged as release-blocking (floor violations) or design-debt (with owner +
   phase); the checklist result is recorded in the release notes.
