# Visual Testing

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-27

The visual regression strategy that makes the design system trustworthy at AI-agent
speed: every component and every archetype is snapshot-verified in **Arabic (RTL) and
English (LTR)** on every change. Tooling: **Playwright** screenshot assertions against a
**Storybook**-driven component harness ([ADR-0016](../architecture/ADR/ADR-0016-ui-tailwind-radix.md)).
Part of the overall test strategy: [../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md).

## 1. Scope — three snapshot layers

| Layer | What | Where | Cadence |
|-------|------|-------|---------|
| **Component snapshots** | Every catalog component, every documented state (hover/focus/disabled/loading/empty/error), both densities | `packages/ui` Storybook stories → Playwright `toHaveScreenshot` per story | Every `@erp/ui` PR |
| **Archetype page snapshots** | One representative screen per [PAGE_ARCHETYPES.md](PAGE_ARCHETYPES.md) archetype × AR/EN × 3 viewports (390 / 1024 / 1280) | App-level Storybook "page stories" with seeded fixtures (no live backend) | Every app PR touching shell/archetypes; full set weekly + on token changes |
| **Print/PDF snapshots** | The 4 print templates rendered headless (Chromium) with golden fixture documents | Reporting harness, PHASE-013 | Every print-template PR |

Additionally, the same suite captures **accessibility states**: `:focus-visible` frames
and `prefers-reduced-motion` variants for one representative story per component
([ACCESSIBILITY.md](ACCESSIBILITY.md) §9).

## 2. Harness design (Storybook-driven, deterministic)

1. Stories are the single fixture source: each component ships `<Component>.stories.tsx`
   with one story per state, named `ar/default`, `ar/error`, `en/default`, … The story
   name encodes locale → the test matrix is generated, not hand-listed.
2. Every story sets `<html lang dir>` explicitly; fonts, icons, and providers are
   identical to the app shell.
3. Playwright opens each story (`storybook:build` static output), waits for the
   "ready" marker (`data-visual-ready="true"` set by an async fixture helper after data
   settle), masks dynamic regions, and screenshots the story frame at device scale 1.

## 3. Flakiness control (the hard rules)

Visual tests are only useful if they never cry wolf. Binding controls:

1. **Deterministic fonts**: self-hosted woff2 loaded from the local harness; Playwright
   waits for `document.fonts.ready`; no system font fallback in snapshots.
2. **Clock freeze**: a story decorator injects a fixed clock (`2026-10-27T09:00:00`)
   — dates, "as of" stamps, and relative times are stable.
3. **Seeded data**: page/fixture data comes from typed fixture factories
   (`packages/ui/src/testing/fixtures`) — same UUIDs, amounts (`12,345.67`), partner
   names, mixed-script strings every run.
4. **Hidden dynamic widgets**: tooltips (shown via story state, not hover), toasts
   (paused at enter-complete), auto-dismiss timers disabled in test mode
   (`testMode` prop on Toast host), avatars/clock widgets masked via
   `data-visual-mask` regions.
5. **No shadows-scroll ambiguities**: fixed viewport per story class; sticky headers
   pinned at scroll-top state; caret and text selection hidden
   (`caret-color: transparent` in harness CSS).
6. **Threshold policy**: pixel diff threshold **0** by default (exact match) — this is a
   design system; a one-pixel drift *is* the signal. Blurred/AA differences are handled
   by deterministic rendering (scale 1, `prefers-reduced-motion` forced on for snapshot
   frames except dedicated motion-state stories).
7. Anti-flake CI rule: a snapshot failure reproduces in retry on the PR author's side;
   flakes get a quarantine label with a 5-day fix deadline — quarantined stories are
   excluded from the diff gate but still rendered (catch runtime errors).

## 4. RTL vs LTR diff gates

- **Both directions are mandatory baselines.** A component PR that adds only an `ar/`
  baseline fails the coverage check (and vice versa) — the mirror must be proven, not
  assumed ([RTL_DESIGN_RULES.md](RTL_DESIGN_RULES.md) §10).
- Positional assertions complement pixels: for one story per archetype, the suite
  asserts geometry invariants — sidebar at start edge, amount column digits unchanged
  between locales, breadcrumb separator mirrored, logo unmirrored — so a *wrong* mirror
  that happens to pixel-match can't slip through.
- Mixed-script fixture stories (`INV-000123` inside Arabic sentences, §RTL §5) are
  asserted byte-identical in both suites' expected files.

## 5. Snapshot review process (intentional change protocol)

1. **Intentional change = PR includes updated baselines + justification.** Baselines
   are committed PNGs in `packages/ui/__image_snapshots__` (and app equivalents); the
   diff is reviewable in the PR checks.
2. The PR description must state: which token/component changed, why, and the user-visible
   effect in AR and EN. Reviewers approve the visual diff explicitly (a dedicated
   "visual review" checkbox in [CODE_REVIEW_TEMPLATE.md](../implementation/templates/CODE_REVIEW_TEMPLATE.md)).
3. Bulk-regeneration (`--update-snapshots`) is rejected if the changeset doesn't name
   the cause; CI posts a summary of changed baselines so nothing slips in as noise.
4. Token-value changes additionally require the design decision record + a note of every
   affected archetype ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §5, §10).
5. Baselines are never edited by hand; they are regenerated by the tool from a green run.

## 6. CI integration & budget

| Suite | Trigger | Budget |
|-------|---------|--------|
| Component AR+EN snapshots (~400 stories) | every PR touching `packages/ui`, `apps/web` shared shell | **≤ 5 minutes** wall clock |
| Archetype page snapshots (12 × 2 × 3 viewports) | PRs touching archetypes/shell + weekly scheduled | ≤ 5 minutes (parallel shards ×8, 1 worker/shard) |
| Print template PDF snapshots | PRs touching `packages/ui/print`, reporting | ≤ 10 minutes (includes Chromium render), allowed to run as a separate required check |

- Budgets are enforced (suite fails on wall-clock overrun) to keep the design system
  cheap to develop; a growing catalog must shard, not slow down.
- Chromium for snapshots = the same pinned version as the report renderer
  ([../reporting/PRINTING_AND_EXPORT.md](../reporting/PRINTING_AND_EXPORT.md)) so print
  and screenshot rendering share one engine truth.
- Nightly full run (all layers, both platforms' token mirrors) catches drift that
  per-PR sharding might miss; failures open a triage issue with attached diffs.

## 7. Accessibility snapshots in the same suite

- The per-component suite captures one `:focus-visible` story per component — focus ring
  spec (2px/2px/color-by-context, [DESIGN_TOKENS.md](DESIGN_TOKENS.md) §11) is verified
  visually, not just by CSS assertions.
- One reduced-motion story per animated component proves the 0ms collapse preserves
  layout ([MOTION_GUIDELINES.md](MOTION_GUIDELINES.md) §5).
- axe runs on the same Storybook pages (not a separate harness) — a story with axe
  violations cannot even produce a baseline; visual and a11y evidence stay in one
  place ([ACCESSIBILITY.md](ACCESSIBILITY.md) §9).

## 8. Phasing

- **PHASE-005**: harness + first ~20 core components + app shell archetypes (1–4) baselined;
  lint + coverage checks live; suite wired as required CI check.
- **Feature phases**: each phase baselines its new screens' archetype instances before
  its completion report is accepted.
- **PHASE-013**: print-template snapshot layer added with the reporting engine.
- **PHASE-016/021/022**: POS archetype and platform shells (Tauri webview = same suite;
  Android native uses token-level spot checks + manual audit, not this suite).
