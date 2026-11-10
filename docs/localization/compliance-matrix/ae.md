# United Arab Emirates (AE) — Compliance File

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

Jurisdiction compliance record for the UAE pack (`ae`). **Every regulatory value below is
research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — see the protocol in
[README.md](README.md) §4 and [../official-sources/README.md](../official-sources/README.md).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `AE` / `ARE` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | الإمارات العربية المتحدة / United Arab Emirates | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | AED — UAE Dirham (درهم إماراتي) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | 2 | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Asia/Dubai` (UTC+4, no DST) | VERIFIED_BASELINE | IANA time zone database | PHASE-002 |
| Official language | Arabic (English widespread in business) | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority | Federal Tax Authority — هيئة الضرائب الاتحادية (FTA) | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| VAT applicability | `VAT_IN_FORCE` | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| Standard VAT rate | 5% | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| Standard rate effective from | 2018-01 | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| Reduced / multiple rates | None identified in baseline research (single standard rate; zero-rated and exempt categories exist) | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| Mandatory registration threshold | A threshold exists; exact amount **not asserted here** | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| VAT return filing | Periodic returns required; frequency per taxpayer profile | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| E-invoicing program | Announced/planned via the Ministry of Finance; **NOT yet mandatory as of the research date** — regime details, format, and dates to be taken from official publications only | REQUIRES_VERIFICATION | mof.gov.ae (portal to confirm) + tax.gov.ae | PHASE-023 |

## 3. VAT applicability and relevant treatments

| Treatment | Relevance in AE (baseline research) | status |
|-----------|--------------------------------------|--------|
| `STANDARD_RATED` | Default for most supplies at the standard rate | REQUIRES_VERIFICATION |
| `ZERO_RATED` | Certain exports and other zero-rated categories; exact lists **not asserted here** | REQUIRES_VERIFICATION |
| `EXEMPT` | Specific supplies exempt; category lists **not asserted here** | REQUIRES_VERIFICATION |
| `REVERSE_CHARGE` | Applies to defined situations (e.g., certain imports/cross-border services); scope **not asserted here** | REQUIRES_VERIFICATION |
| `OUT_OF_SCOPE` | Non-supplies | engine semantics |
| `NOT_SUBJECT` | Unregistered tenants issue documents without VAT | engine semantics |

## 4. Invoice requirements

**Baseline commercial set** (identical platform-wide): seller legal name + identifiers,
buyer details for tax invoices, invoice date, official number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), bilingual line description
where required, qty, unit price, discounts, line net, line tax + rate, totals, currency.

**AE-specific (baseline research, REQUIRES_VERIFICATION, source tax.gov.ae):**

- **Tax invoice** (فاتورة ضريبية) vs **simplified tax invoice** for B2C — exact mandatory
  field lists are frozen only after verification (PHASE-009 for pack fields).
- **E-invoicing:** the pack carries e-invoicing status `VAT_PLANNED_EINVOICING`; the
  adapter slot stays **dormant** until official specifications exist
  ([../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §5). Meanwhile the
  payload builder produces compliance-ready archives (locally signed PDF + structured
  data), clearly labeled **non-authoritative**.
- Any future mandated format/labels become a pack version bump — never a core change.

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence, assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | tax.gov.ae | PHASE-009 |
| Future e-invoicing counters | Deferred with the dormant adapter | REQUIRES_VERIFICATION | mof.gov.ae (TBC) | PHASE-023 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| TRN (Tax Registration Number) | رقم التسجيل الضريبي | REQUIRES_VERIFICATION (format not asserted) | tax.gov.ae | PHASE-009 |
| Trade license number | رقم الرخصة التجارية | REQUIRES_VERIFICATION | relevant authority portals | PHASE-009 |

Formats stay `null` in the pack until verification
([../COUNTRY_PACKS.md](../COUNTRY_PACKS.md) §2).

## 7. Date and number formats

- **Calendar:** Gregorian business/fiscal dates (A-004); Hijri display available.
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** `latn` default / `arab` optional per tenant; identifiers always `latn`
  ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** AED 2 minor units, half-up ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md)).

## 8. Relevant reports

- **VAT return** (الإقرار الضريبي) per [../TAX_ENGINE.md](../TAX_ENGINE.md) §4 with
  INV-012 GL cross-check; bilingual RTL output; humans file.
- Tax-account ledgers + document tax summaries; dormant-adapter compliance-archive
  export report (labeled non-authoritative).

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `ae` | **SEEDED (PHASE-009 2026-10-30)** — rate row 5% from 2018-01-01, `verified_at NULL`; dormant e-invoicing slot (VAT_PLANNED_EINVOICING) with the refusal asserted | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| E-invoicing adapter (dormant slot) | **NOT_IMPLEMENTED** — waits for official specs | [PHASE-023](../../implementation/phases/PHASE-023.md) |
| VAT return report for AE | **SHIPPED (PHASE-009 v1)** | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-ae.spec.ts`: the 7 engine-level scenario classes (boundary = fail-closed before 2018-01) + rounding 2-dp + determinism + return-prepare | PHASE-009 |
| Scenarios deferred | invoice field sets/print → 012/013; dormant-adapter compliance-archive test → 023 | 012/013/023 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard-rated sale at the standard rate — line tax, summary, journal lines.
2. Zero-rated export sale (distinct from exempt in the return).
3. Exempt supply (correct return box).
4. Reverse-charge purchase (self-accounted pair).
5. Simplified (B2C) vs standard tax invoice field sets and print outputs.
6. Credit note against a tax invoice.
7. **Effective-date boundary**: documents dated before 2018-01 (pre-regime, `NOT_SUBJECT`)
   vs after — snapshot correctness; plus a synthetic future rate-change fixture proving
   the pack mechanism.
8. Mixed basket with treatment-grouped tax summary.
9. Unregistered tenant (`NOT_SUBJECT`) documents and registration transition fixture.
10. Dormant-adapter test: compliance archive generation succeeds, is labeled
    non-authoritative, and no submission attempt occurs.

## 11. Known limitations

- All regulatory values are BASELINE_RESEARCH; no legal review yet.
- The e-invoicing program is in flux by nature: this pack must be re-verified against
  official MoF/FTA publications before any AE launch that promises e-invoicing readiness
  (RISK-006 trigger).
- Free-zone and designated-zone treatment nuances are not asserted and are not configured
  until verified official guidance is recorded.
- Identifier formats deliberately unasserted until verification.
