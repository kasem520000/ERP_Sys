# Design Principles

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-27

The binding philosophy of the ERP user experience. Every component in
[COMPONENT_CATALOG.md](COMPONENT_CATALOG.md), every token in
[DESIGN_TOKENS.md](DESIGN_TOKENS.md), and every screen built from the
[PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md) must be justifiable by these principles. When two
principles appear to conflict, the conflict-resolution order at the end of this file
decides. Binding decision: [ADR-0016](../architecture/ADR/ADR-0016-ui-tailwind-radix.md).

Our users are not consumers browsing a marketing site; they are the
[personas](../product/USER_PERSONAS.md) — accountant (المحاسب), cashier (الكاشير),
warehouse keeper (أمين المستودع), shop owner (صاحب المحل), and field representative
(مندوب المبيعات) — doing hours of concentrated, repetitive, money-critical work.

## Principle 1 — Arabic-first, RTL-first

**RTL is the default direction. LTR is the mirror. Never the reverse.**

- Every component is designed, built, and visually tested in `dir="rtl"` first; the LTR
  rendering is generated from logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`,
  `text-start`, `text-end`) — never hand-drawn as a second layout
  ([RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md)).
- Arabic terminology is authored as the canonical user-facing string; English is a
  full-parity label, not a source that gets translated late
  ([../GLOSSARY.md](../GLOSSARY.md) is the controlled vocabulary).
- Dates may display in Hijri alongside Gregorian; numerals default to Western Arabic
  digits (0–9) for financial data with Arabic-Indic numerals as a user preference —
  money is never ambiguous because of numeral choice.
- Print artifacts (invoices, statements, receipts) are RTL-correct first
  ([../reporting/PRINTING_AND_EXPORT.md](../reporting/PRINTING_AND_EXPORT.md)).
- **Forbidden:** "RTL support" as a late toggle, `transform: scaleX(-1)` layout hacks,
  physical `left/right` utilities in shared components, Latin-only QA passes.

## Principle 2 — Density serves professional accounting work

Professional users scan hundreds of rows and type faster than they click. Density is a
usability feature, not a style preference.

- **32px row height is the default** for data grids (compact density); 40px "comfortable"
  is reserved for settings and low-volume screens. Density is a component prop, not a
  per-screen improvisation ([DESIGN_TOKENS.md](DESIGN_TOKENS.md) §density).
- Information beats whitespace in transactional surfaces: amounts, dates, statuses, and
  document numbers are visible without expanding rows.
- **Keyboard-first**: every transactional flow has a documented keyboard model
  ([NAVIGATION_MODEL.md](NAVIGATION_MODEL.md) §shortcuts); reaching for the mouse must
  never be required to complete a journal entry, an invoice, or a receipt.
- `tabular-nums` on every money/quantity column so digits never jitter while totals
  recompute.
- **Forbidden:** marketing-style hero paddings on operational screens, hiding totals
  behind hover, 56px+ rows in financial grids.

## Principle 3 — Speed beats decoration

Perceived performance is trust. A cashier cannot wait for an animation; an accountant
must not watch totals fade in.

- No decorative motion in transactional flows; motion is limited to functional enter/exit
  ≤ 150ms ([MOTION_GUIDELINES.md](MOTION_GUIDELINES.md)).
- Financial data display never animates: posting confirmations, totals, and balances
  update instantly.
- Tables sort instantly (or ≤ 150ms feedback); virtualized grids stay responsive at
  10,000 rows ([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) §DataTable).
- Skeletons are honest: they show real structure, never fake content.
- **Forbidden:** spinners on instant operations, confetti on posting, parallax, autoplay
  carousels, progress bars without defined work.

## Principle 4 — Trust through consistency

One design system; every industry module assembles the same components
([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)).

- A restaurant template and an auto-parts template use the *same* DataTable, the same
  status badges, the same posting flow — configuration changes vocabulary and
  composition, never interaction patterns.
- One status vocabulary from [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md)
  rendered by exactly one `DocumentStatusBadge`: DRAFT (مسودة), PENDING_APPROVAL (بانتظار
  الموافقة), APPROVED (معتمد), POSTED (مُرحّل), REVERSED (معكوس), CANCELLED (ملغي).
- Colors are semantic: negative amounts are red *by sign*, never by debit/credit
  convention; success/warning/danger mean the same thing on every screen
  ([DESIGN_TOKENS.md](DESIGN_TOKENS.md) §semantic-colors).
- **Forbidden:** raw Radix in app code, per-screen ad-hoc interactive patterns, a second
  button style because "this screen is special".

## Principle 5 — Accessibility is a floor, not a feature

WCAG 2.1 AA is the minimum bar for every component, not a polish phase
([ACCESSIBILITY.md](ACCESSIBILITY.md)).

- Keyboard-complete operation, visible focus (2px ring, 2px offset), and screen-reader
  announcements for money-critical outcomes (posting success/failure) are part of a
  component's definition of done.
- Automated gates: axe per page in E2E, keyboard-only journey, AR+EN visual snapshots
  ([VISUAL_TESTING.md](VISUAL_TESTING.md)).
- A component failing contrast or keyboard traversal is a defect, not a backlog item.
- **Forbidden:** "accessible version" toggles, divs pretending to be buttons, focus rings
  removed for aesthetics.

## Principle 6 — Mobile-first only for mobile-native workflows

The back office is a desktop product; pretending otherwise would sabotage Principle 2.

- **Mobile-native surfaces**: POS tablets (touch-first, ≥44px targets, no hover),
  field-sales Android app, owner's phone dashboard. These get genuine touch-first layouts
  ([PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md) §point-of-sale, §personal-account-mobile).
- **Back office** (accounting, inventory, reports): desktop density at ≥1024px is the
  design target; smaller widths degrade to usable read-mostly views, never to a fake
  "mobile app" with giant rows.
- The responsive contract: layouts adapt at breakpoints (sm 640 / md 768 / lg 1024 /
  xl 1280 / 2xl 1536); components never fork per device — the same component renders both.
- **Forbidden:** hiding desktop features behind "not mobile friendly", touch targets
  smaller than 44px on touch surfaces, hover-only affordances on touch.

## Principle 7 — Error prevention over error correction

The cheapest error is the one the UI makes impossible; the next cheapest is the one it
catches inline.

- **Inline validation** at the field: unbalanced journal amounts, duplicate invoice
  numbers, closed-period dates, credit-limit breaches are surfaced at input time with a
  bilingual message and a fix path — before submit.
- **Balanced-entry preview**: `JournalEntryGrid` shows a live Σdebit vs Σcredit
  difference that must reach exactly 0.00 before posting unlocks
  ([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md) §JournalEntryGrid); this mirrors INV-001
  ([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)) in
  the UI, but the posting engine remains the enforcer.
- Destructive actions (cancel, reverse) require an explicit reason and show consequences
  in the confirm dialog — no surprise side effects.
- Posted is immutable: the UI never offers an "edit posted invoice" affordance
  ([../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md)); it offers
  the correct corrective document (credit note / reversal).
- **Forbidden:** client-only validation as the sole guard, generic "something went
  wrong" errors on financial actions, silent auto-correction of amounts.

## Principle 8 — Bilingual typography discipline

Mixed Arabic/Latin content is the norm, not an edge case — amounts, codes, e-mail
addresses, IBANs, and Latin brand names appear inside Arabic sentences all day.

- Typography follows the token scale exactly
  ([DESIGN_TOKENS.md](DESIGN_TOKENS.md) §typography): IBM Plex Sans Arabic for Arabic,
  Inter for Latin, IBM Plex Mono for identifiers/tabular figures.
- Embedded LTR runs (tax numbers, IBANs, e-mails) are wrapped in Unicode bidi isolates so
  they never reorder the surrounding Arabic sentence
  ([RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md) §bidi-isolation; full rendering rules in
  [../localization/RTL_AND_LTR.md](../localization/RTL_AND_LTR.md)).
- Text is authored in logical order; the bidi algorithm and isolates handle display.
  Never "fix" mixed text by re-typing it in visual order.
- **Forbidden:** hard-coding one font per page, fake-bold via CSS filters, mixing
  numerals styles inside one column.

## How the principles are verified

| Principle | Automated gate | Phase |
|-----------|----------------|-------|
| 1 RTL-first | AR+EN visual snapshots; `dir=rtl` and `dir=ltr` Playwright runs; logical-properties lint | [PHASE-005](../planning/MASTER_ROADMAP.md) |
| 2 Density | Token-enforced row heights; density prop tests; keyboard E2E journeys | PHASE-005 |
| 3 Speed | Motion budget lint (≤150ms); grid 10k-row perf test | PHASE-005 |
| 4 Consistency | Forbidden-import lint (no raw Radix in apps); catalog coverage check | PHASE-005 onward |
| 5 Accessibility | axe per page; keyboard-only E2E; manual audit per release | PHASE-005 onward |
| 6 Surfaces | Per-archetype snapshots at 1024/768/390 widths | PHASE-005 onward |
| 7 Error prevention | Inline-validation unit tests; unbalanced-entry UI test | Feature phases |
| 8 Typography | Mixed-script fixture tests; font assertion in visual suite | PHASE-005 |

## Conflict resolution order

1. Correctness and auditability of financial data (never trade clarity of money for
   aesthetics).
2. Accessibility floor (Principle 5).
3. RTL fidelity (Principle 1).
4. Speed of daily work (Principles 2–3).
5. Consistency (Principle 4) — a justified deviation requires a design-system decision
   record and a catalog update, so the exception becomes the new rule.
