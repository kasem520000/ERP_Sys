# ADR-0016 — UI: Tailwind CSS v4 + Radix Primitives + Custom RTL-First ERP Design System

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

One design system must serve dense accounting screens, POS, dashboards, Arabic RTL and
English LTR, web + desktop (shared) and Android (tokens), with accessibility and
long-session comfort (directive §10). It must be implementable by AI agents consistently,
so the component surface must be explicit and documented, not improvised per screen.

## Decision

1. **Styling: Tailwind CSS v4** with a token-driven theme (CSS custom properties in
   `@theme`) mapping 1:1 to the documented design tokens
   ([../../ui/DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md)). Logical properties
   (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start/end`) are mandatory for direction-aware
   layout; physical direction utilities are lint-banned in shared components.
2. **Behavior/a11y primitives: Radix UI** (unstyled) for dialogs, popovers, dropdowns,
   tabs, comboboxes, tooltips — wrapped by our components so Radix never appears raw in
   app code.
3. **Component library: a custom ERP design system** (`packages/ui`) with a documented
   catalog ([../../ui/COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md)): data tables
   (with financial tabular numerals), journal-entry grids, money/date inputs, document
   status badges, approval queues, report viewers, RTL-correct charts. Data-dense
   "compact" density is the default for operational screens.
4. **Typography**: IBM Plex Sans Arabic (Arabic) + Inter (Latin) + IBM Plex Mono
   (tabular figures) — self-hosted, `font-variant-numeric: tabular-nums` everywhere
   money appears.
5. **Motion**: minimal, functional only (focus, enter/exit < 150ms); no decorative
   animation in transactional screens ([../../ui/MOTION_GUIDELINES.md](../../ui/MOTION_GUIDELINES.md)).
6. **Accessibility**: WCAG 2.1 AA floor; keyboard-complete data entry; tested with axe +
   keyboard-only E2E ([../../ui/ACCESSIBILITY.md](../../ui/ACCESSIBILITY.md)).
7. **RTL-first process**: every component is built RTL-first and mirrored to LTR via
   logical properties + `dir` attribute — never `transform: scaleX(-1)` hacks except
   documented directional icons ([../../ui/RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md)).
8. Android consumes the same tokens via a RN theme object (ADR-0014) — no shared DOM
   components.

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Material UI / Ant Design | Heavy opinions; RTL is an add-on rather than native; ERP density and bilingual typography needs fight the defaults; bundle size. |
| Chakra / Mantine | Good candidates; Tailwind v4 + Radix gives full control of tokens and smaller runtime; the deciding factor is agent-implementable explicitness. |
| CSS-in-JS (styled-components) | Runtime cost; SSR complexity; Tailwind's token approach aligns better with a design-token source of truth. |
| shadcn/ui pattern (copy-in components) | We adopt the *pattern* (Radix + Tailwind, code owned in-repo) — but with our own ERP component set, since data-grid/journal/money patterns dominate over generic marketing components. |

## Consequences

- The design system is a first-class product surface with its own phase (PHASE-005),
  visual-regression tests ([../../ui/VISUAL_TESTING.md](../../ui/VISUAL_TESTING.md)),
  and a Storybook-based catalog.
- App code may not use raw Radix or ad-hoc utility soup for interactive patterns;
  screens compose catalog components (directive §10: industry modules assemble shared
  components rather than recreate UI patterns).
- Tailwind version pinned in v4 (CSS-first config) — document any upgrade as a decision.

## Revisit triggers

- If a specialized grid (virtualized 100k-row tables) needs a headless engine
  (TanStack Table is already the assumed headless choice) — library additions inside
  `packages/ui` are allowed with catalog updates, not new ADRs.
