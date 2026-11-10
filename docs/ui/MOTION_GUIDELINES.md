# Motion Guidelines

> **Status:** STABLE · **Owner:** Design System Architecture · **Updated:** 2026-10-27

Functional motion only. Motion in this product exists to make state changes *legible*
(what appeared, what changed), never to entertain ([DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md)
§3). Token values: [DESIGN_TOKENS.md](DESIGN_TOKENS.md) §13. Binding decision:
[ADR-0016](../architecture/ADR/ADR-0016-ui-tailwind-radix.md) ("minimal, functional only").

## 1. Duration budget (hard limits)

| Token | Value | Applies to |
|-------|-------|------------|
| `--erp-duration-instant` | **0ms** | Default for all data/state updates |
| `--erp-duration-fast` | **120ms** | Enter/exit: menus, tooltips, popovers, toasts, small feedback |
| `--erp-duration-base` | **150ms** | **Absolute maximum** for any enter/exit or position shift |

Any animation longer than 150ms, or animating more than opacity + ≤4px translate
(scale ≤1.02), requires a design decision record — expect the answer to be "no".

## 2. What may animate (sanctioned list)

| Interaction | Motion | Duration/easing |
|-------------|--------|-----------------|
| Overlay enter (dropdown, dialog, drawer, popover, command menu) | opacity 0→1 + ≤4px translate toward open direction | 120ms · `ease-enter` |
| Overlay exit | opacity 1→0 (no movement) | 120ms · `ease-exit` (never blocks input longer) |
| Toast slide-in | ≤8px translate from start edge + opacity | 120ms · `ease-enter` |
| Focus indicator transitions | ring color change | instant (no fade — focus must be immediate) |
| Tab/segmented indicator | underline slides ≤ tab width | 150ms · `ease-standard` |
| Collapse/expand (group tree, advanced filters) | height change on the container only | 150ms · `ease-standard` |
| POS scan feedback | green tile flash / border pulse | ≤120ms, then static |
| Skeleton shimmer | slow ambient loop | 1.2s+ but opacity-only, ≤2% luminance range |

Everything else — especially everything financial — is instant.

## 3. What never animates (forbidden list)

1. **Financial data display**: totals, balances, Δ indicators, statements — updates are
   instant. Numbers must never "count up", fade, or slide.
2. **Posting confirmation**: the moment a document posts, the status badge flips and the
   toast appears — no celebratory motion, no confetti, no camera movement. Trust is the
   emotion; delay reads as doubt.
3. **Table sorting/filtering**: re-sort may be instant, or ≤150ms fade on row area if a
   clear-state transition is needed — never per-row staggered fly-ins.
4. **Page transitions** in the back office: none. Route changes swap content instantly;
   loading states are skeletons.
5. Background loops, marquees, parallax, hover-trailing effects: forbidden product-wide.
6. Loading spinners on operations that resolve < 200ms (show nothing; Principle 3).

## 4. Easing tokens

- `--erp-ease-standard: cubic-bezier(0.2, 0, 0, 1)` — default for position/size changes.
- `--erp-ease-enter: cubic-bezier(0, 0, 0.2, 1)` — decelerating enter.
- `--erp-ease-exit: cubic-bezier(0.4, 0, 1, 1)` — accelerating exit.
- Bounce/elastic/back easings are forbidden — they extend perceived duration and feel
  decorative.

## 5. Reduced-motion policy

- `@media (prefers-reduced-motion: reduce)` → every `transition-duration`/`animation`
  becomes **0ms** while final layout/state is preserved (overlays still appear —
  instantly).
- This is implemented once in the token layer (`tokens.css` global rule), not per
  component; components therefore don't need their own media queries.
- Motion is never the sole feedback channel ([ACCESSIBILITY.md](ACCESSIBILITY.md) §7):
  every animated state has a static equivalent (badge text, toast).

## 6. POS-specific feedback rules (PHASE-016)

- **Scan feedback is visual + short, never blocking**: item tile flashes success tint
  for ≤120ms and the cart line count increments; no modal, no blocking spinner — the
  cashier continues scanning.
- Payment: tender buttons lock via disabled state instantly; success swaps to receipt
  action immediately; failure shows the assertive toast with retry (no shake animation
  on the panel — screen-shake is forbidden).
- Shift animations: none; count fields update statically.

## 7. Implementation rules

1. Animate with `transition`/`@keyframes` on transform/opacity only (compositor-friendly);
   `height` transitions are allowed only for the sanctioned collapse case.
2. Use the duration/easing tokens — raw ms values in components are lint-flagged
   (`erp/no-raw-motion-values`).
3. Enter/exit must not create focus-loss windows: exit animation keeps the element in
   the accessibility tree until done; focus restoration happens on close, not after the
   animation ([ACCESSIBILITY.md](ACCESSIBILITY.md) §1).
4. Visual suite snapshots pin the *final* frame; motion changes require baseline updates
   + changeset ([VISUAL_TESTING.md](VISUAL_TESTING.md) §baselines) and a perf note if
   they touch grid virtualization.
