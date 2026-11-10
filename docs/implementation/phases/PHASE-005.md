# PHASE-005 — Design System, i18n & RTL Foundation

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-005
- **Title:** Design System, i18n & RTL Foundation
- **Objective:** Build `packages/ui` exactly per [DESIGN_SYSTEM.md](../../ui/DESIGN_SYSTEM.md):
  the token layer implementing [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md) values
  verbatim (Tailwind v4 `@theme`), the Radix-wrapper primitives, the core component set
  from [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) (including the normative
  `DataTable`, `MoneyInput`, `DateRangePicker`, `DocumentStatusBadge` sections), the
  app shell with entitlement-driven navigation from
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md), the AR+EN i18n pipeline with
  key-parity CI, the RTL lint rules (physical-direction utilities banned), the
  Storybook + Playwright visual-regression harness per
  [VISUAL_TESTING.md](../../ui/VISUAL_TESTING.md) with both-direction baselines, and
  the a11y baseline gates per [ACCESSIBILITY.md](../../ui/ACCESSIBILITY.md). Login and
  the PHASE-003/004 provisional screens migrate onto the system.
- **Business value:** Every screen from PHASE-006 onward composes documented,
  visually-verified, accessible, RTL-correct components instead of improvising — the
  single biggest lever against UX inconsistency and bidi bugs (RISK-015) at AI-agent
  implementation speed, and the thing that makes the product feel Arabic-native rather
  than translated.

## 2. Scope

In scope:

1. **Package structure** per [DESIGN_SYSTEM.md](../../ui/DESIGN_SYSTEM.md) §2:
   `packages/ui` with `tokens/` (tokens.css, tokens.ts, density.css — the only raw
   values), `primitives/` (thin Radix wrappers, the only legal Radix import site),
   `components/` (catalog components), `patterns/` (empty registry + contracts),
   `print/` (directory stub + README pointing at PHASE-013), `theme.css`, `utils/`
   (cn, densityCx, money format hooks, bidi isolate, icon direction registry),
   `lint/`, and `index.ts` as the only import surface (`@erp/ui`).
2. **Tokens** implementing [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md) §1–§16
   exactly: teal `--erp-color-primary-50…950` (`#0F766E` core brand), gray 50–950,
   semantic success/warning/danger/info anchors, **financial sign semantics** (red =
   negative by sign, never debit/credit side), surfaces/borders/elevation e1–e4, IBM
   Plex Sans Arabic + Inter + IBM Plex Mono self-hosted typography with
   `tabular-nums` on money, 4px spacing scale, radii, z-layers, **focus ring 2px/2px
   with color-by-context** (§11), density modes 32/40px (§9), breakpoints (§12), motion
   0/120/150ms + easings (§13), Lucide 16/20 stroke 1.5 (§14), `--erp-*` naming +
   Tailwind v4 `@theme` mapping (§15), and the **contrast verification gate** (§16) as
   a CI check that recomputes AA ratios on every token PR.
3. **Core components** from [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) — the
   set required by archetypes 1–4 + the app shell: `Button`, `IconButton`, `Input`,
   `Textarea`, `Select`, `Combobox`, `Checkbox`, `Radio`/`RadioGroup`, `Switch`,
   `NumberInput` (§1 primitives ≈20), plus `DataTable` (§6.1: virtualized to 10,000
   rows, 60fps gate, roving tabindex grid semantics), `MoneyInput` (§6.2: decimal
   strings only, currency suffix chip, digits LTR-isolated), `DatePicker` +
   `DateRangePicker` (Gregorian + Hijri `islamic-umalqura` display, presets),
   `DocumentStatusBadge` (§6.4: 6 lifecycle states + `PENDING_SYNC`, tone map fixed to
   [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)), `Pagination`,
   `Tabs`, `Badge`, `Dialog`, `Drawer`/`Sheet`, `Toast`, `Tooltip`, `Popover`,
   `CommandMenu`, `SearchInput`, `Breadcrumbs`, `EmptyState`, `LoadingState`,
   `ErrorState`, `NavigationSidebar`. Each ships with unit + axe + keyboard tests, both
   densities, and AR+EN stories for every documented state (mandatory state matrix §8).
   The companion `DocumentActions` transition menu derives from the same lifecycle
   table.
4. **App shell + entitlement-driven navigation** per
   [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md): `NavItem` registry data model
   (§2, binding) resolved server-side — an item renders iff `entitlement(featureKey)`
   AND `permission(user, branch)`; 9 sidebar groups in binding order; group visibility
   = entitlement AND ≥1 visible child; breadcrumbs; **back-preserves-filters**
   (URL-encoded list state); locale-prefixed deep links (`/ar/…`, `/en/…`) with
   direction from the prefix; ⌘K `CommandMenu` over navigation items (document/report
   search indexes extend in later phases); mobile tab bar + drawer below `md`; global
   shortcut registry core set (`⌘K`, `/`, `?`, `g`-prefix go, `Ctrl+Enter`,
   `Alt+Enter`).
5. **i18n pipeline**: AR+EN message catalogs (namespaced, typed), key-parity CI check
   (missing-locale key fails), locale negotiation from session + URL prefix,
   `<html lang dir>` set by the shell only ([RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md)
   §2), server-localized errors per [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md)
   §12, digit rendering policy (`latn` default / `arab` option; identifiers always
   `latn`).
6. **RTL enforcement**: the `erp/no-physical-direction` lint rule (error severity, CI
   from this phase — banning `pl-/pr-/ml-/mr-/text-left/text-right/left-*/right-*/border-l-*/border-r-*`
   in `packages/ui` and shared components), plus `erp/no-raw-radix`,
   `erp/no-raw-design-values`, `erp/import-path` per DESIGN_SYSTEM §4; the directional
   icon registry (RTL_DESIGN_RULES §4: direction decided in one place, `scaleX(-1)`
   banned outside it); sanctioned-exception protocol (`// rtl-exempt:` comment + both-
   direction visual tests).
7. **Visual regression harness** per [VISUAL_TESTING.md](../../ui/VISUAL_TESTING.md):
   Storybook-driven Playwright `toHaveScreenshot` with deterministic fonts (self-hosted
   woff2, `document.fonts.ready`), clock freeze, seeded typed fixtures, masked dynamic
   regions, **pixel threshold 0**, AR+EN both mandatory (coverage check fails a one-
   direction PR), geometry assertions for one story per archetype (sidebar at start
   edge, digits unchanged, breadcrumb separator mirrored, logo unmirrored), mixed-
   script fixtures; component + archetype (1–4) × 2 locales × 3 viewports (390/1024/
   1280) baseline sets; CI budgets ≤ 5 min each with sharding; baseline update = same
   PR + changeset justification.
8. **Accessibility gates** per [ACCESSIBILITY.md](../../ui/ACCESSIBILITY.md): axe (0
   violations) runs per story *inside the visual harness*; keyboard model tests (Tab/
   Shift-Tab/Escape/Enter/arrow-key grids per COMPONENT_CATALOG §7); skip-to-content;
   focus-visible stories per component; live-region announcement rules (§5: assertive
   for posting outcomes, debounced polite for totals); reduced-motion story per
   animated component; keyboard-only Playwright journey over the migrated screens.
9. **Secure headers/CSP verification probe** per
   [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §8: HSTS, nosniff,
   frame-ancestors 'none', Referrer-Policy, CSP with nonce'd scripts (no
   `unsafe-inline`), `object-src 'none'`, SRI on third-party assets (there are none at
   this phase — assert that), staging report-only capture; bidi/RTL spoofing payload
   tests (THREAT_MODEL S-03) against the new components.
10. **Screen migration**: login + PHASE-003 user-management + PHASE-004
    registration/onboarding/console screens rebuilt as compositions of catalog
    components on shell archetypes (List+Search, Create/Edit, Wizard for onboarding);
    provisional styling removed. Every migrated screen gets an archetype baseline.
11. **Docs tooling for the system**: CI catalog-coverage check (every exported
    component has a [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) row and vice
    versa); changesets workflow for `@erp/ui` semver (DESIGN_SYSTEM §5).

Out of scope (explicit):

- `JournalEntryGrid`, `LineItemsEditor`, `PartnerPicker`, `ItemPicker`,
  `ApprovalsQueue`, `StatementViewer`, `ReportViewer`, `ShiftPanel`, `KPIStatCard`,
  `ChartCard`, `MoneySummaryBar`, `FilterBar` and other domain patterns — they land
  with their consuming phases (PHASE-006+), composing this phase's primitives per
  DESIGN_SYSTEM §4.3.
- Print templates (PHASE-013), ReportViewer + assertion banners (PHASE-013).
- POS archetype + terminal profiles (PHASE-016), industry template label patches
  (PHASE-015), role landing dashboards (PHASE-014), tenant accent injection
  (PHASE-014+), dark mode (post-MVP), Android RN theme consumption (tokens.ts ships
  now; Expo consumes in PHASE-022).
- Business features of any kind — no new endpoints beyond what the shell needs
  (navigation resolution, session/locale).

## 3. Prerequisites

- Required phases: **PHASE-004 COMPLETE** — consumed artifacts: entitlements service +
  permissions (navigation resolution inputs: feature keys + permission checks),
  registration/onboarding/console screens to migrate, `tenant_settings` locale keys.
  Verified via completion report + green CI + IMPLEMENTATION_STATUS row.
- Required architecture decisions:
  [ADR-0016](../../architecture/ADR/ADR-0016-ui-tailwind-radix.md) (Tailwind v4 +
  Radix + custom system; RTL-first; AA floor; IBM Plex),
  [ADR-0003](../../architecture/ADR/ADR-0003-nextjs-nestjs.md) (App Router + BFF),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (money strings drive
  MoneyInput), [ADR-0002](../../architecture/ADR/ADR-0002-typescript-monorepo.md)
  (package boundaries).
- Relevant documentation: [DESIGN_SYSTEM.md](../../ui/DESIGN_SYSTEM.md),
  [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md),
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md),
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md) (archetypes 1–4 +
  common rules), [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md),
  [RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md),
  [RTL_AND_LTR.md](../../localization/RTL_AND_LTR.md) (rendering-level rules),
  [ACCESSIBILITY.md](../../ui/ACCESSIBILITY.md),
  [MOTION_GUIDELINES.md](../../ui/MOTION_GUIDELINES.md),
  [VISUAL_TESTING.md](../../ui/VISUAL_TESTING.md),
  [LOCALIZATION_ARCHITECTURE.md](../../localization/LOCALIZATION_ARCHITECTURE.md),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (feature keys for nav
  gating), [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §4 (the
  no-physical-direction CI check is *due* from this phase).

## 4. Design Impact

- **Database changes:** none (navigation registry is code + configuration data; no
  tables). The nav registry's `featureKey`/`permission` fields consume existing
  seeds.
- **API changes:** none new beyond shell needs: navigation resolution payload
  (resolved registry for the session: items, groups, terminology, shortcuts —
  derived-only visibility), and locale-preference plumbing on the session. All per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md).
- **UI changes:** the phase *is* UI: `packages/ui` v1.0.0 (tokens + ~30 components +
  shell), migrated auth/admin screens, archetype instantiations 1–4 with baselines.
  Every later phase composes this surface (DESIGN_SYSTEM §4 binding rules).
- **Security & authorization:** navigation hides what the server says the user lacks
  (never authoritative — AUTHORIZATION_MATRIX §8 layer 4); routes without grants
  return opaque 404-equivalents (no feature-existence leak); CSP probe gates §8 of
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md); bidi spoof payload
  tests on mixed-script inputs (`Input` bidiIsolate, `MoneyInput` isolation).
- **Accounting implications:** none yet — but `MoneyInput` enforces ADR-0009 string
  money and `DocumentStatusBadge` fixes the lifecycle vocabulary (the exact statuses
  the posting engine will emit from PHASE-007), so the vocabulary cannot fork later.
- **Localization implications:** this phase *is* the localization UX foundation:
  AR-first defaults, key parity enforced, Hijri display support in date pickers
  (`general.hijri_display` setting honored), numeral system option, Arabic emails
  unaffected. All shell strings AR+EN; terminology objects `{ ar, en }` flow from the
  controlled [GLOSSARY.md](../../GLOSSARY.md) vocabulary.
- **Offline implications:** none active (design system is a build-time dependency of
  future offline clients; tokens.ts is the cross-platform contract per DESIGN_SYSTEM
  §10 — Android consumption lands PHASE-022).
- **Module dependencies:** `packages/ui` depends on `packages/domain-core` (Money
  types) + `packages/contracts` (nav payload types) only — never on `apps/api`
  (DEPENDENCY_RULES §3); apps import `@erp/ui` surface only; data flows via
  props/headless-hook contracts (DESIGN_SYSTEM §3).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Package scaffold + tokens layer (tokens.css/ts, density.css, theme.css `@theme`) + self-hosted fonts | `packages/ui/src/tokens/*`, `packages/ui/src/theme.css`, `packages/ui/package.json` | token snapshot unit test (values byte-match DESIGN_TOKENS); contrast gate CI (§16 ratios recomputed) |
| T2 | Lint rules: `erp/no-physical-direction`, `no-raw-radix`, `no-raw-design-values`, `import-path` wired into CI | `packages/ui/lint/*`, `eslint.config.mjs` | negative fixtures: each rule fails a violating file (meta-tests, mirrors PHASE-001 pattern) |
| T3 | Radix primitives layer (dialog, drawer, popover, dropdown, tooltip, tabs, combobox, select, checkbox, radio, switch) + `_shared` helpers + icon direction registry | `packages/ui/src/primitives/*`, `src/utils/icons.ts` | unit: direction registry applies mirrored set only in RTL; primitives render tokens |
| T4 | Form components: Input, Textarea, Select, Combobox, Checkbox, RadioGroup, Switch, NumberInput, MoneyInput, DatePicker, DateRangePicker | `packages/ui/src/components/*` | unit + axe per story; MoneyInput paste-sanitize + locale decimal rules; Hijri/Gregorian rendering tests; keyboard model tests |
| T5 | Feedback/display: Button, IconButton, Badge, DocumentStatusBadge (+ DocumentActions), Toast, Tooltip, Popover, Dialog, Drawer, EmptyState, LoadingState, ErrorState, Breadcrumbs, Tabs, SearchInput | `packages/ui/src/components/*` | state-matrix stories (§8) all present; status tone map asserts DOCUMENT_LIFECYCLE vocabulary |
| T6 | DataTable + Pagination (virtualization, sort/filter/selection/row-actions, sticky header/start column, skeleton/empty/error states) | `packages/ui/src/components/data-table/*` | 10k-row scroll 60fps test; roving tabindex; selection announcements; a11y grid semantics |
| T7 | CommandMenu + NavigationSidebar + app shell (groups, breadcrumbs, mobile tab bar + drawer, shortcut registry, DensityProvider) | `packages/ui/src/components/*`, `apps/web/src/components/shell/*` | nav resolution unit tests (entitlement AND permission gating, group collapse, 404-opaque routes); shortcut registry tests; focus traps |
| T8 | Navigation resolution endpoint + typed payload + locale-prefixed routing + i18n catalogs + parity CI | `apps/api/src/modules/tenancy/presentation/navigation*`, `apps/web/src/i18n/*`, `scripts/check-i18n-parity.ts` | parity script fails on missing key (negative proof); deep-link direction follows prefix; back-preserves-filters E2E |
| T9 | Visual harness: Storybook build + Playwright snapshot pipeline + fixture factories + flake controls + CI wiring + budgets | `packages/ui/.storybook/*`, `packages/ui/src/testing/fixtures/*`, `tests/visual/*`, `.github/workflows/ci-visual.yml` | AR+EN baselines generated; one-direction PR fails coverage; threshold 0; ≤5 min budget enforced |
| T10 | A11y gates: axe-per-story inside harness, keyboard-only journey, focus-visible stories, reduced-motion stories | `tests/a11y/*` | 0 axe violations; keyboard journey passes without mouse |
| T11 | CSP probe + bidi spoof payload tests | `tests/security/headers-csp.spec.ts`, `tests/security/bidi-payloads.spec.ts` | header set asserted per environment; RTL spoof payloads render isolated (THREAT_MODEL S-03) |
| T12 | Screen migration: login, users/roles/invitations, registration, onboarding, branches, platform console onto archetypes 1–4 | `apps/web/src/app/**` | archetype baselines (12 × 2 × 3 viewport set for archetypes 1–4); migrated screens pass axe + keyboard |
| T13 | Changesets + catalog-coverage CI check + docs updates | `.changeset/*`, `scripts/check-ui-catalog-coverage.ts`, `docs/ui/**` | coverage check green (exports ↔ catalog rows); changeset required on visual diffs |

## 6. Verification

**Automated tests (required):**

- Token layer: every value byte-matches [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md);
  contrast gate recomputes the §16 AA matrix and fails on regression; focus-ring
  geometry (2px/2px) asserted in focus-visible stories.
- Component suites: per component — unit behavior, axe 0 violations per story,
  keyboard model per §7 map, density (compact 32 / comfortable 40), AR+EN stories for
  every applicable state in the §8 matrix (or documented `n/a`).
- DataTable: 10,000-row virtualized scroll holds 60fps (gate from §6.1); multi-sort,
  filter menus, tri-state selection, row actions all keyboard-complete; numeric
  columns keep decimal alignment in both directions.
- MoneyInput: accepts only canonical decimal strings; grouping on blur, raw digits on
  focus; paste sanitization; negative/zero states; digits LTR-isolated inside RTL.
- Visual: AR+EN baselines for all shipped components + archetype pages 1–4 at
  390/1024/1280; both directions mandatory; geometry invariants per archetype; mixed-
  script fixtures byte-identical across suites; baseline changes require a changeset
  (CI-enforced).
- i18n: key-parity check green; locale-prefix deep links render RTL for `/ar/…`
  regardless of viewer preference.
- Security: CSP probe green per §8; bidi spoof payloads isolated (no layout/status
  injection).
- Negative lint proofs: each of the four custom rules fails a violating fixture.

**Manual verification:**

1. `pnpm storybook` → browse the catalog: every component has an Arabic-first docs
   page with a live AR example; states/densities render; no raw-value or physical-
   direction classes anywhere (grep).
2. Log in as tenant owner (AR): sidebar shows groups in binding order with correct
   icons; a feature-flagged group disappears when the entitlement is removed
   (server-derived); ⌘K finds navigation items by Arabic and English labels.
3. Switch to EN mid-session: direction flips, fonts swap, dates/money re-render;
   deep-link `/ar/...` from an EN session renders RTL.
4. Navigate a migrated list screen: filter, sort, paginate, follow a record, press
   browser back → exact grid state restored.
5. Keyboard-only pass over login → shell → users list → invite dialog without
   touching the mouse; `?` shows the cheat sheet.

**Acceptance criteria (objective):**

1. `packages/ui` v1.0.0 publishes with tokens byte-identical to
   [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md) and the contrast gate green in CI.
2. All catalog components shipped in this phase have: catalog row, stories for every
   applicable state (§8 matrix), axe 0 violations, keyboard tests, both densities,
   AR+EN baselines — the catalog-coverage CI check proves export↔row parity.
3. `DataTable` passes the 10k-row 60fps virtualization gate with grid a11y semantics
   (asserted, not eyeballed).
4. The lint rules are active in CI: a fixture using `pl-4`/`text-left`/raw Radix
   import/raw hex fails `pnpm lint` (negative proofs committed).
5. App shell renders the 9-group registry in binding order, gated by
   entitlement AND permission server-side; groups with zero visible children never
   render; ungranted routes are opaque (no feature leak).
6. Every AR story has an EN baseline and vice versa (coverage check); the visual
   suites run within the ≤5-minute CI budgets; a baseline change without a changeset
   fails.
7. i18n parity check is green; every migrated screen renders AR-first RTL correctly,
   including Hijri display in date pickers when enabled.
8. The migrated screens (login, users/roles, registration, onboarding, branches,
   console) pass axe + keyboard-only journeys and have archetype baselines.
9. CSP verification probe is green in CI per
   [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §8.
10. Zero business logic in `packages/ui` (patterns receive data via props/hooks only;
    boundary lint green).

**Performance & security considerations:** visual CI budget ≤ 5 min per suite
   (shard, never skip); font payloads self-hosted and subset for AR+EN; no runtime
   CSS-in-JS; CSP forbids inline scripts; component bundle tracked (no Radix raw
   imports means tree-shaking stays honest); axe findings block baseline generation,
   so a11y debt cannot accumulate silently.

**Migration & rollback:** no DB migrations. `@erp/ui` is semver'd via changesets; a
   bad release is rolled back by pinning the previous version in apps. Baselines are
   regenerated only from green runs (VISUAL_TESTING §5.4).

## 7. Risks and Constraints

- RISK-015 (Hijri/Arabic-numeral UX edge cases): both-direction baselines + geometry
  assertions + ICU-backed calendars are the mitigation; bidi spoof payload tests
  cover the injection variant.
- Visual-test flakiness is the top practical risk: the VISUAL_TESTING §3 hard rules
  (deterministic fonts, clock freeze, seeded fixtures, masked dynamics, threshold 0,
  5-day quarantine SLA) are requirements, not suggestions; budget breaches are defects
  (TEST_STRATEGY §6).
- Tailwind v4 + Storybook + Playwright tool churn: pin exact versions; upgrades via
  decision records (ADR-0016 consequence).
- Constraint: resist building domain patterns early (JournalEntryGrid etc.) — they
  belong to their consuming phases and would arrive here without real data contracts
  (DESIGN_SYSTEM §4 escape-hatch rule).

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-005-COMPLETION.md` with: token contrast
  gate output, component×state×locale baseline inventory, DataTable 60fps test
  output, lint negative-proof results, nav gating tests, i18n parity output, CSP probe
  output, keyboard/axe journey results, changeset + `@erp/ui` version, archetype
  baseline list, CI run links with budget timings.
- **Documentation updates required:** [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-005 → COMPLETE + tag), CHANGELOG + changesets,
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) (any prop/state additions made
  during implementation — catalog is co-owned),
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) (registry field notes if
  reality forced changes), `docs/operations/DEVELOPMENT_SETUP.md` (Storybook/visual
  harness quickstart). Acceptance criteria copied into
  `planning/PHASE_ACCEPTANCE_CRITERIA.md` (planned file — see PHASE-003 note).
- **Exit criteria:** all 10 acceptance criteria green with evidence; visual + a11y
  suites wired as required CI checks; migrated screens baselined; docs validation
  green.
- **Definition of Done:** a new screen built by any later agent can be assembled
  purely from catalog components, rendered RTL-correct with zero custom direction
  code, visually verified AR+EN, and accessible by keyboard — with the harness
  catching every drift automatically.
- **Handoff instructions:** read the PHASE-005 completion report + the
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) entries before building any
  screen; follow the component workflow (DESIGN_SYSTEM §8) for every new pattern;
  domain patterns for your phase belong in your phase's scope with catalog entries in
  the same PR. **Next eligible phase: PHASE-006 — Master Data** (identify only; do
  not implement).
