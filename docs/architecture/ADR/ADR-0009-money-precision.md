# ADR-0009 — Money Representation: NUMERIC(19,4), Decimal Math, String Transport

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

The Platform handles multi-currency money, fractional quantities, FX rates, and tax
rounding across jurisdictions. Binary floating point is forbidden for money — JavaScript
`number` cannot represent `0.1 + 0.2` exactly, and an ERP cannot tolerate cent-level
drift. Precision must also survive API transport, offline storage, and reporting.

## Decision

1. **Storage (PostgreSQL):** monetary amounts `numeric(19,4)`; quantities
   `numeric(19,6)`; FX rates `numeric(19,8)`; percentages `numeric(7,4)`.
2. **Application:** all money/quantity/rate arithmetic uses `decimal.js` (configured to
   34 significant digits, banker-safe rounding modes chosen per operation) wrapped in a
   `Money`/`Quantity`/`Rate` value objects in `packages/domain-core`. Constructing money
   from a JS number is lint-banned (except documented parsing of user input).
3. **API transport:** money, quantities, and rates are **JSON strings** (e.g.,
   `"1234.5000"`), never JSON numbers. Parsing/validation is centralized in
   `packages/contracts` ([../api/API_CONVENTIONS.md](../../api/API_CONVENTIONS.md)).
4. **Local (offline) storage (SQLite):** money as `TEXT` storing canonical decimal
   strings, or `NUMERIC`-affinity columns — never REAL/float affinity.
5. **Display:** formatting per locale/currency via `Intl.NumberFormat` with
   Arabic-Indic vs Western digit options ([../../localization/CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md));
   formatted values are never re-parsed as authoritative input.

### Rounding policy (normative summary — full text in
[../../localization/CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md))

- Line net = round( qty × unit price − discount , currency minor units, half-up).
- Line tax = round( taxable base × rate , minor units, half-up), per line, per tax code.
- Document totals = Σ rounded lines; header-vs-sum tolerance must be 0.00 (or posted to
  the rounding-difference account for FX/tax-only residual cases, per documented rules).
- FX conversion: round at final posting step only, not per intermediate line, unless the
  jurisdiction pack specifies otherwise.
- Unit costs (WAC/FIFO) keep 6-decimal internal precision; issue amounts round to 4.

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Integer minor units (cents) | Multi-currency with 3-decimal currencies (KWD, BHD, OMR, IQD, JOD all use 3 decimals; some contexts need 4) + fractional quantities make integer-only painful; NUMERIC is exact anyway. |
| JS `number` + epsilon tricks | Forbidden — drift and non-determinism across engines. |
| floats in Postgres | Never exact for decimals; forbidden. |

## Consequences

- Every layer treats money as strings/decimals; JSON schemas enforce `string` with
  per-type decimal patterns — amounts `^-?\d{1,15}(\.\d{1,4})?$` (≤ 4 dp),
  quantities ≤ 6 dp, FX rates ≤ 8 dp. The authoritative pattern registry is
  [../../api/API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) §7
  (**consolidation correction DEF-001**: this ADR previously quoted a single blanket
  `1,8`-decimal regex for all money inputs, which conflicted with the API contract
  and with `numeric(19,4)` amount storage; the per-type patterns govern).
- Sorting/aggregating money happens in SQL NUMERIC (exact) — not in JS after retrieval.
- Slightly more code at boundaries; centralized helpers eliminate the burden.

## Revisit triggers

- None anticipated. Any new storage or transport must repeat this ADR's rules.
