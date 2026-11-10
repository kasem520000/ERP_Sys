# ADR-0010 — Tax Engine with Versioned Jurisdiction Packs and Isolated Adapters

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

The Platform serves jurisdictions with different regimes: 15% VAT (KSA), 5% (UAE, Oman),
10% (Bahrain), 14% (Egypt), 16% GST (Jordan), and **no VAT** (Kuwait, Qatar, Yemen, Iraq
as of the research date — each flagged for verification in
[../../localization/compliance-matrix/](../../localization/compliance-matrix/README.md)).
E-invoicing regimes differ (ZATCA clearance/reporting, ETA Egypt, planned UAE). Directive
§6 forbids hard-coding one country's rules into the core and forbids conflating distinct
tax concepts (zero-rated ≠ exempt ≠ out-of-scope ≠ unregistered business).

## Decision

1. **Core tax model** (module `tax`): tax **treatments**
   (`STANDARD_RATED`, `ZERO_RATED`, `EXEMPT`, `OUT_OF_SCOPE`, `REVERSE_CHARGE`,
   `NOT_SUBJECT`), tenant **tax registrations** per jurisdiction
   (`REGISTERED`, `NOT_REGISTERED`, `DEREGISTERED`), and tenant **tax codes** binding
   items/documents/partner-types to a treatment at document time. A rate snapshot
   (treatment + rate + jurisdiction + effective window) is stored **on each document
   line** so historical documents never change when rates change.
2. **Jurisdiction packs**: versioned configuration per country (currency, VAT
   applicability, default rates, invoice requirements, numbering rules, e-invoicing
   regime descriptor, fiscal calendar conventions). Packs are data + code-versioned
   descriptors; the core never reads "if country == X".
3. **Rounding and breakdown** per treatment/category computed by the tax engine and
   stamped into the document's tax summary (feeds VAT returns and e-invoicing payloads).
4. **External integrations (ZATCA, ETA, others) are adapters** behind a versioned port
   (`EInvoicingAdapter`): generate → sign → submit → track, with per-submission state
   machines and zero core coupling. Adapter implementations exist only after
   verification against official specifications (directive §1.12–1.13); see
   [../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md).
5. **Unregistered / no-VAT tenants**: the tax engine operates with a `NOT_APPLICABLE`
   scheme — documents print without VAT fields, VAT accounts are not posted, but the
   engine still records the treatment (`NOT_SUBJECT`) so reporting and future
   registration transitions are clean.

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Hard-coded VAT in invoice modules | Violates directive §6; breaks every new country. |
| Fully generic "any tax" engine (arbitrary formulas) | Complexity without buyers; VAT/GST-style taxes are the domain. Excise/customs become adapters later. |
| Tax rates resolved at report time from current config | Historical documents would silently change — unacceptable; snapshots are mandatory. |

## Consequences

- Adding a country = authoring a jurisdiction pack + compliance matrix entry with
  official sources; no core changes.
- Rate changes are configuration events with effective dates, testable per pack version.
- Every compliance feature carries: jurisdiction, official source reference, effective
  date, version, test scenarios, status, limitations
  ([../../localization/compliance-matrix/README.md](../../localization/compliance-matrix/README.md)).
- The engine is exercised by a mandatory tax-calculation test suite per pack
  ([../../testing/TEST_STRATEGY.md](../../testing/TEST_STRATEGY.md)).

## Revisit triggers

- New tax types demanded by a jurisdiction (excise, withholding) → extend the treatment
  model via decision record, not by hacking document lines.
