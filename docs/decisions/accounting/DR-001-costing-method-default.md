# DR-001 — Costing Method Default: WAC, FIFO Opt-In

> **Status:** ACCEPTED · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-27 ·
> **Date:** opened 2026-10-27, accepted 2026-10-27 ·
> **Approver:** Product Owner (author: Accounting Domain Architecture) ·
> **Source:** [A-005](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) ·
> **Related:** [INV-017](../../accounting/ACCOUNTING_INVARIANTS.md),
> [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md),
> [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) (`items.costing_method`),
> PHASE-010

## Context

The platform supports two valuation methods from PHASE-010: **WAC** (moving weighted
average per item) and **FIFO** (cost layers consumed oldest-first,
`stock_layers` in the entity catalog). Every tenant must have a default, every item
carries a `costing_method`, and INV-017 forbids retroactive method changes: a switch
requires a dated revaluation posting, and past issues keep their original costs. The
default choice therefore shapes every tenant's onboarding and the cost of later
correction.

Forces:

- Target tenants are small/medium KSA/UAE businesses (A-001): most manage stock without
  dedicated cost accountants; WAC is the locally common default and the easier mental
  model ("what did I pay on average").
- FIFO is the right answer for serialized/expiry-sensitive goods (pharmacy-style,
  automotive parts with batch/serial tracking — the PHASE-017 templates lean this way).
- Perpetual inventory is the platform default (A-006); both methods are implemented
  either way — this decision is only about the **default**, not scope.

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. WAC default, FIFO opt-in per tenant/item** | Onboarding default = WAC; tenant may choose FIFO; method fixed per item thereafter (INV-017) | Simplest onboarding for the majority; a single explainable number; matches market habit | Tenants with true FIFO needs must actively opt in — mis-selection discovered late costs a revaluation posting |
| **B. FIFO default, WAC opt-in** | Reverse of A | Technically precise layer costing by default | Harder mental model for the target segment; more data (layers) from day one; heavier support load |
| **C. Per-item choice with no tenant default** | Every item configured at creation | Most "flexible" | Decision fatigue in onboarding; high mis-configuration rate; contradicts template-driven onboarding strategy |

## Decision

**Option A.** Tenants default to **WAC**; FIFO is opt-in per tenant and fixed per item
thereafter; switching a live item's method requires the documented dated revaluation
posting (INV-017). Industry templates may set the tenant default differently **only** as
a documented template manifest value (e.g., serialized-goods templates default to FIFO),
never as a silent per-item override.

## Consequences

- Onboarding and template manifests carry `costing_method_default: 'WAC'` (or 'FIFO' for
  the specific templates above); PHASE-010 tests assert both methods and the revaluation
  path, not just the default.
- `items.costing_method` values are `WAC | FIFO` (see the enum registry in
  [../../database/DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md)).
- WAC keeps 6-decimal internal unit-cost precision with 4-decimal issue rounding
  ([ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)).
- If the default proves wrong for a segment, the re-education cost is bounded: templates
  re-default, existing tenants keep their explicit choice (assumption A-005's
  consequence statement).
- Industry templates (PHASE-015+) must document their costing default in their manifest
  spec; a template contradicting this record requires an amendment here.

## Revisit conditions

- Design-partner evidence that a majority of a template's users re-choose FIFO at
  onboarding → amend the template default via a linked record.
- A jurisdiction requirement that presumes a specific statutory costing method (none
  known at decision time) → jurisdiction-pack decision record in `compliance/`, with this
  record amended for tenants in that jurisdiction.
- Any proposal to allow silent/retroactive method changes is out of scope permanently
  (INV-017) — do not reopen via this folder.

## Approval

ACCEPTED 2026-10-27 — product owner (formalizing A-005 per the assumptions-file protocol:
assumption promoted to decision; [../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)
A-005 now points here).
