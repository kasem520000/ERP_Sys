# UNIFIED_UI_DESIGN_SYSTEM — The Single Design System for Every Screen

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-28 (consolidation pass)
> **Authority:** Consolidates UI standards for **web, desktop, and Android**. Normative
> detail remains in [DESIGN_TOKENS.md](DESIGN_TOKENS.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md),
> [COMPONENT_CATALOG.md](COMPONENT_CATALOG.md), [PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md),
> [NAVIGATION_MODEL.md](NAVIGATION_MODEL.md), [ACCESSIBILITY.md](ACCESSIBILITY.md),
> [MOTION_GUIDELINES.md](MOTION_GUIDELINES.md), [RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md),
> [VISUAL_TESTING.md](VISUAL_TESTING.md), [DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md).
> ADR: [../architecture/ADR/ADR-0016-ui-tailwind-radix.md](../architecture/ADR/ADR-0016-ui-tailwind-radix.md).

## 1. One system, three clients

All screens — web, Tauri desktop, Android (where shared) — are built from the same
layered packages: **tokens → Radix primitives → components → patterns → print**.
Lint bans enforce the architecture: no raw Radix imports outside the component package,
no raw design values (`no-raw-design-values`), **no physical CSS direction properties**
(`no-physical-direction` — logical properties only). No screen may carry private styling
that bypasses tokens/components; the design-review gate rejects such PRs.

## 2. Design tokens (single source)

Semantic colors (success/warning/danger/info + the **status-badge binding** below),
spacing, typography (Arabic-optimized stack + Latin stack with tabular numerals for all
money), elevation, radii, motion durations, dual density presets (comfort/dense for
data-heavy accounting screens), dark mode post-MVP. Values live in
[DESIGN_TOKENS.md](DESIGN_TOKENS.md); code mirrors are generated.

## 3. Financial UI semantics (binding)

1. **Sign semantics:** `--erp-color-finance-positive/negative/neutral` — red means a
   negative amount by sign, **never the credit column** (bilingual debit/credit
   disambiguation); zero renders neutral.
2. **Status semantics (adopted from Folder 2):** document lifecycle badges render only
   through the binding table — DRAFT→Info, PENDING_APPROVAL→Warning, APPROVED→Success-info
   (distinct from POSTED so approval queues are visible), POSTED→Success,
   VOIDED/CANCELLED→Danger ([DESIGN_TOKENS.md](DESIGN_TOKENS.md) §3).
3. **Money display:** tabular numerals mandatory; amounts right/end-aligned; currency and
   minor units per ISO-4217; formatted values are never re-parsed as input
   ([../architecture/ADR/ADR-0009-money-precision.md](../architecture/ADR/ADR-0009-money-precision.md)).

## 4. RTL-first bilingual

Logical CSS properties only; icon-direction mirroring registry (which icons mirror, which
never — numbers always LTR); bidi isolation for financial tables; per-document print
language independent of session locale; AR/EN locale pair as first-class releases
(rules: [RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md), [../localization/RTL_AND_LTR.md](../localization/RTL_AND_LTR.md)).

## 5. Components, archetypes, navigation

- **~88 catalog components**; complex ones (MoneyField, JournalLinesGrid, ApprovalBar,
  DocumentHeader, DataTable) are normatively specified with mandatory state matrices
  (loading/empty/error/success + RTL); a component is not "verified" without RTL+LTR+a11y
  evidence ([COMPONENT_CATALOG.md](COMPONENT_CATALOG.md)).
- **12 page archetypes** incl. POS, transaction-entry workspace, reconciliation health
  center — every screen maps to an archetype ([PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md)).
- Navigation is **derived from entitlements + configuration** (never authorization, but
  always visibility derivation of the same keys) — [NAVIGATION_MODEL.md](NAVIGATION_MODEL.md).

## 6. Accessibility and motion

WCAG 2.1 AA (target) with axe-core CI gates; full keyboard map for data-dense screens
(grid navigation, approval shortcuts); reduced-motion collapse policy; motion durations
tokenized ([ACCESSIBILITY.md](ACCESSIBILITY.md), [MOTION_GUIDELINES.md](MOTION_GUIDELINES.md)).

## 7. Consistency enforcement (how future screens stay uniform)

| Gate | Mechanism |
|------|-----------|
| Token lint | raw hex/px values fail CI |
| Direction lint | physical margins/paddings fail CI |
| Component review | screens must compose catalog components; new primitives require design-review |
| Visual regression | Playwright AR/EN × light/dark snapshot pairs per archetype; RTL-vs-LTR diff gate ([VISUAL_TESTING.md](VISUAL_TESTING.md)) |
| A11y | axe + keyboard walkthrough per archetype in CI |
| Golden screens | per-archetype reference screens updated only via reviewed baseline PRs |

## 8. Desktop and Android usage

Tauri desktop renders the web ERP (shared system entirely). Expo Android shares ONLY
`packages/contracts` + domain-core; its screens follow the same tokens and archetypes in
React Native form — the design system documents RN token mapping where needed
([../architecture/ADR/ADR-0014-android-expo.md](../architecture/ADR/ADR-0014-android-expo.md)).
