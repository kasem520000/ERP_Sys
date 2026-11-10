---
"@erp/ui": minor
---

## @erp/ui 1.0.0 — the design system ships (PHASE-005)

Initial release of `@erp/ui` per ADR-0016 / DESIGN_SYSTEM: token layer
byte-verbatim to DESIGN_TOKENS (contrast gate §16 green), the Radix
primitive wrappers (single legal Radix site), the catalog components
(DataTable virtualized to 10k rows, MoneyInput per §6.2, Date pickers with
Hijri `islamic-umalqura` display, DocumentStatusBadge per §6.4 fixed tone
map), the app shell with server-resolved entitlement-driven navigation
(NAVIGATION_MODEL §2), the AR+EN visual harness (Storybook → Playwright,
threshold 0, both directions mandatory, axe 0 violations inside the
harness), and the four erp-ui lint rules with negative proofs.

Visual baselines committed with this release: AR+EN component set +
archetype pages at 390/1024/1280 — cause: initial baseline generation
(VISUAL_TESTING §5: baseline changes ship in the same PR with a changeset
naming the cause).
