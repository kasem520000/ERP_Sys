# Egypt (EG) — Compliance File

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-11-05

Jurisdiction compliance record for the Egypt pack (`eg`). **Every regulatory value below
is research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — see
[README.md](README.md) §4 and [../official-sources/README.md](../official-sources/README.md).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `EG` / `EGY` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | جمهورية مصر العربية / Arab Republic of Egypt | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | EGP — Egyptian Pound (جنيه مصري) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | 2 | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Africa/Cairo` (UTC+2; **DST observed** — the notable exception in the region) | VERIFIED_BASELINE | IANA time zone database | PHASE-002 |
| Official language | Arabic (English widespread in business) | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |

Egypt is the only pack in the initial ten with **daylight-saving time** — the timezone
policy ([../LOCALIZATION_ARCHITECTURE.md](../LOCALIZATION_ARCHITECTURE.md) §8) relies on
timestamptz + IANA zones, so DST needs no special handling, but display-time tests must
cross a DST boundary.

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority | Egyptian Tax Authority — مصلحة الضرائب المصرية (ETA) | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |
| VAT applicability | `VAT_IN_FORCE` | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |
| Standard VAT rate | 14% | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |
| Standard rate effective from | 2017 (VAT law era) | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |
| Schedule / additional rates | **Additional schedule rates and special categories may exist** (common in schedule-based VAT systems); none asserted here | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |
| Mandatory registration threshold | A threshold exists; exact amount **not asserted here** | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |
| VAT return filing | Periodic returns required; frequency per taxpayer profile | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-009 |
| E-invoicing | ETA e-invoicing mandatory **in phases since 2021 (B2B)**; an **e-receipt system** is rolling out (baseline research) | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-023 |

## 3. VAT applicability and relevant treatments

| Treatment | Relevance in EG (baseline research) | status |
|-----------|--------------------------------------|--------|
| `STANDARD_RATED` | Default for most supplies | REQUIRES_VERIFICATION |
| `ZERO_RATED` | Certain exports and other zero-rated categories; exact lists **not asserted here** | REQUIRES_VERIFICATION |
| `EXEMPT` | Specific supplies exempt; lists **not asserted here** | REQUIRES_VERIFICATION |
| `REVERSE_CHARGE` | Applies to defined situations; scope **not asserted here** | REQUIRES_VERIFICATION |
| `OUT_OF_SCOPE` | Non-supplies | engine semantics |
| `NOT_SUBJECT` | Unregistered tenants | engine semantics |

If verification confirms **multiple schedule rates**, they are modeled as additional
`tax_rates` rows (`treatment: STANDARD_RATED`, distinct `rate_percent`, category-labeled
tax codes) — the engine already supports per-line rates; no structural change.

## 4. Invoice requirements

**Baseline commercial set** (platform standard): seller legal name + identifiers, buyer
details for tax invoices, invoice date, official number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), bilingual line description
where required, qty, unit price, discounts, line net, line tax + rate, totals, currency.

**EG-specific (baseline research, REQUIRES_VERIFICATION, source eta.gov.eg):**

- **ETA e-invoicing (الفوترة الإلكترونية):** mandatory in phases since 2021 for B2B
  invoices; the **e-receipt system** for retail is rolling out. Exact mandatory fields,
  submission mechanics, and certificate enrollment are **frozen only after
  official-spec verification in [PHASE-023](../../implementation/phases/PHASE-023.md)**.
- Architecture: the ETA adapter follows the `EInvoicingAdapter` port on the **evaluation
  track** — implementation begins only after official API documentation review,
  certificate enrollment confirmation, and an approving decision record (RISK-007,
  [../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §4).
- Until then: standard tax invoices print normally; the payload builder produces
  compliance-ready archives labeled non-authoritative.

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence, assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Authority counters/identifiers (e-invoicing) | Stored as compliance payload fields — never replacing platform identity | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-023 |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-023 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| Tax registration number (VAT) | رقم التسجيل الضريبي | REQUIRES_VERIFICATION (format not asserted) | eta.gov.eg | PHASE-009 |
| Commercial registration number | رقم السجل التجاري | REQUIRES_VERIFICATION | relevant Egyptian authority portal | PHASE-009 |
| ETA portal taxpayer credentials (e-invoicing) | بيانات الدخول لبوابة الفاتورة الإلكترونية | REQUIRES_VERIFICATION | eta.gov.eg | PHASE-023 |

## 7. Date and number formats

- **Calendar:** Gregorian business/fiscal dates (A-004).
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** `latn` default / `arab` optional; identifiers always `latn`
  ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** EGP 2 minor units, half-up ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §2–3).
- **DST:** `Africa/Cairo` observes DST — schedule/report tests must cross a transition.

## 8. Relevant reports

- **VAT return** (الإقرار الضريبي) per [../TAX_ENGINE.md](../TAX_ENGINE.md) §4 with
  INV-012 cross-check; bilingual RTL; humans file.
- ETA submission funnel + status reporting once the adapter exists
  ([../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §7).

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `eg` | **SEEDED (PHASE-009 2026-10-30)** — rate row 14% from 2017-01-01, `verified_at NULL`; schedule rates deliberately not asserted | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| ETA e-invoicing adapter | **NOT_STARTED (PHASE-023 2026-11-05)** — evaluation deferred ([DR-003](../../decisions/compliance/DR-003-egypt-eta-scope.md) draft with DEFERRED recommendation, PHASE-023 T9); the fake-eta test harness + the adapter-neutral registry/state machine shipped and are exercised in tests; no ETA integration claim | [PHASE-023](../../implementation/phases/PHASE-023.md) |
| VAT return report for EG | **SHIPPED (PHASE-009 v1)** — 2-dp EGP fixtures green | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-eg.spec.ts`: the 7 classes (boundary = fail-closed before 2017-01) + rounding 2-dp + determinism + return-prepare | PHASE-009 |
| Scenarios deferred | invoice field sets/print → 012/013; payload goldens → 023 | 012/013/023 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard-rated sale at the standard rate — line tax, summary, journal lines.
2. Zero-rated export distinct from exempt in the return.
3. Exempt supply (correct box).
4. Reverse-charge purchase (self-accounted pair).
5. Credit note against a tax invoice.
6. **Schedule-rate fixture (synthetic):** a second rate row for a special category
   proving multi-rate resolution per line via distinct tax codes.
7. Rate boundary (document dated before/after an `effective_from` in the fixture data).
8. Mixed basket with treatment-grouped summary.
9. Unregistered tenant (`NOT_SUBJECT`) documents; registration transition fixture.
10. **DST boundary test:** receipt at 23:30 local across a DST transition lands on the
    correct business date ([../LOCALIZATION_ARCHITECTURE.md](../LOCALIZATION_ARCHITECTURE.md) §8).
11. E-invoicing: refuse-to-submit stub until PHASE-023 verification; compliance archives
    labeled non-authoritative in the meantime.

## 11. Known limitations

- All regulatory values are BASELINE_RESEARCH; no legal review yet.
- The ETA regime has two systems (e-invoice + e-receipt) with phased mandates; scope for
  the adapter is an explicit decision record before implementation (RISK-007) — this file
  does not promise either.
- Schedule rates and categories (if they exist) are unasserted until verification; a
  pack update will carry them.
- Identifier formats deliberately unasserted until verification.
