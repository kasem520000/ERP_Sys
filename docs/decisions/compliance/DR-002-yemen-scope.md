# DR-002 — Yemen Scope at GA: No-VAT Pack Only vs. Legacy Sales-Tax Reporting

> **Status:** OPEN · **Date:** 2026-10-27 (opened) · **Approvers:** Product Owner +
> Compliance Review · **Source:** [OQ-005](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) ·
> **Related:** [../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §1
> (no-VAT jurisdictions), [../../localization/compliance-matrix/ye.md](../../localization/compliance-matrix/ye.md),
> PHASE-009 (packs), PHASE-023 (evaluation window)

## Context

Yemen currently operates **no VAT scheme**. The tax engine models this correctly: Yemen
ships as a **no-VAT jurisdiction pack** — tax fields absent, no VAT postings, standard
invoicing — and the engine's conceptual separation forbids representing "no VAT" as
"VAT at 0%" ([../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §1).
Yemen does, however, have a legacy **general sales tax** regime. The open question: does
the GA product merely *not break* for Yemeni businesses (correct books, standard
invoices), or does it also ship a **sales-tax reporting format** to help them file?

The platform's standing rule — the platform **reports**, humans **file**
([../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §4) — applies either
way; the question is whether we produce the report at all.

## Options

| Option | Shape | Consequences |
|--------|-------|--------------|
| **A. No-VAT pack only at GA** (recommended in OQ-005) | Yemeni tenants get: correct double-entry books, standard invoicing, pack-flagged `NO_VAT`, no tax-report output | Zero additional format work; books are legally usable; tenants file sales tax from their own figures — no filing-format claim made or implied. GA scope unchanged |
| **B. Add legacy sales-tax reporting** | A Yemen pack feature: period report aggregating taxable sales by the sales-tax rules | Small format work (one report + rules verified against official Yemeni sources in the compliance matrix); creates an ongoing obligation to track any Yemeni rate/format changes (RISK-008 pattern) before GA; only worth it if real demand exists |

## Recommendation

**Option A at GA.** Rationale: launch markets are KSA/UAE (A-001); Yemeni demand is
plausible but unproven; a wrong or unverified sales-tax format is worse than none (the
compliance folder's hard rule applies — no format ships without verified official
sources). Keep the pack extension path documented so option B is a **pack feature
addition** (a later decision record), never an architecture change.

## Consequences

- If **A** is accepted: `ye.md` compliance matrix records "no-VAT pack; no sales-tax
  reporting at GA"; sales material must not imply Yemeni tax-filing support; any Yemeni
  sales-tax reporting request routes to this record's amendment process.
- If **B** is accepted: the evaluation window (PHASE-023) gains a Yemen verification task
  (official sources, rate effective dates, format sample) **before** any report ships;
  the work is small but must be evidence-gated like any compliance feature.
- **No decision by the deadline**: option A governs by default (the conservative path),
  per the assumptions-file protocol.

## Approval requirements

- Product owner + compliance reviewer signatures.
- Evidence if option B is chosen: official source documents for the sales-tax format and
  rates, filed as the `ye.md` compliance-matrix verification entries.
- On acceptance: update OQ-005 in
  [../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)
  and `CHANGELOG.md`.
