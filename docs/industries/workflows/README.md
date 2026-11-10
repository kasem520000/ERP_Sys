# Industry Workflows — Reading Guide

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-10-27

The six **signature industry workflows** — the flows each template must get exactly right,
and the flows that define what "industry-ready" means for this platform. Each workflow in
[industry-workflows.md](industry-workflows.md) has: numbered steps, a Mermaid diagram, and
the **accounting effect of every step** (which journals result), because an industry flow
that posts wrong is worse than no industry support at all.

## The six signature workflows

| # | Workflow | Template | Phase |
|---|----------|----------|-------|
| (a) | Restaurant table order → kitchen → POS payment → end-of-day Z close | `restaurant_cafe` | PHASE-016 |
| (b) | Automotive job card: check-in → diagnosis quote → approval → parts + labor → invoice → payment | `automotive_workshop` | PHASE-017 |
| (c) | Van-sales day: load-out → route visits (cash, credit, return, collection) → unload → settlement with variance | `distribution_field_sales` | PHASE-017 (offline: PHASE-022) |
| (d) | Bakery production: BOM → production order → consume batches → finished goods + scrap → next-day expiry markdown | `food_manufacturing` | PHASE-018 |
| (e) | Car rental: reservation → contract + deposit → return inspection → late/damage charges → deposit release | `rental_logistics` | PHASE-019 |
| (f) | Service contract billing: monthly milestone → draft invoice from contract → approval → posting → customer statement | `professional_services` (also `rental_logistics`) | PHASE-019 |

## Conventions

- **Steps** are numbered and map 1:1 to UI/user actions; system-side actions inside a step
  are listed as sub-effects.
- **Accounting effects** use the canonical posting map in
  [../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4 and the
  document states in [../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md).
  Every journal shown is produced by the central posting engine — industry code never
  writes to the GL.
- **No effect** means exactly that: no journal entry, no stock movement. Steps marked "no
  ledger effect" are planning/presentation only.
- **VAT lines** appear where the treatment resolves to a taxable supply; in a no-VAT
  jurisdiction or for a not-registered tenant the same flow posts without VAT lines
  ([../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §1) — the workflow
  shape is unchanged.
- Each workflow ships as an automated end-to-end test with **expected journal entries**
  ([../../testing/ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md)); templates cite
  these workflows in their governance test suites
  ([../README.md](../README.md) §8).

## How templates use these workflows

Template documents ([../templates/README.md](../templates/README.md)) show a compact
signature-workflow diagram and link here for the authoritative step list and journals. When
a template evolves a flow (e.g., grocery reusing the expiry lifecycle), the shared workflow
is extended in place — never forked per industry.
