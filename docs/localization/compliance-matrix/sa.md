# Saudi Arabia (SA) — Compliance File

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-11-05

Jurisdiction compliance record for the Saudi pack (`sa`). **Every regulatory value below
is research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — the pack cannot
reach `VERIFIED` until the protocol in [README.md](README.md) §4 completes against
official sources ([../official-sources/README.md](../official-sources/README.md)).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `SA` / `SAU` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | المملكة العربية السعودية / Saudi Arabia | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | SAR — Saudi Riyal (ريال سعودي) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | 2 | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Asia/Riyadh` (UTC+3, no DST) | VERIFIED_BASELINE | IANA time zone database | PHASE-002 |
| Official language | Arabic (English widely used in business documents) | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority | ZATCA — هيئة الزكاة والضريبة والجمارك (Zakat, Tax and Customs Authority) | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| VAT applicability | `VAT_IN_FORCE` | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| Standard VAT rate | 15% | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| Standard rate effective from | 2020-07 (prior lower rate before that date) | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| Reduced / multiple rates | None identified in baseline research (single standard rate) | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| Mandatory registration threshold | A threshold exists; exact amount **not asserted here** | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| VAT return filing | Periodic returns required; frequency rules per taxpayer profile | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| Zakat / other levies | Zakat and other obligations exist for certain taxpayers — out of current pack scope (assumption A-003) | REQUIRES_VERIFICATION | zatca.gov.sa | future pack version |

The prior-rate history matters for tenants importing historical documents: the rate table
must contain the earlier window with `effective_to` so boundary tests (§10) pass.

## 3. VAT applicability and relevant treatments

All six treatments from [../TAX_ENGINE.md](../TAX_ENGINE.md) §1 are modeled for SA:

| Treatment | Relevance in SA (baseline research) | status |
|-----------|--------------------------------------|--------|
| `STANDARD_RATED` | Default for most supplies at the standard rate | REQUIRES_VERIFICATION |
| `ZERO_RATED` | Certain exports and other zero-rated categories apply; exact category lists **not asserted here** | REQUIRES_VERIFICATION |
| `EXEMPT` | Specific supplies are exempt; category lists **not asserted here** | REQUIRES_VERIFICATION |
| `REVERSE_CHARGE` | Applies to defined imports/cross-border situations; scope **not asserted here** | REQUIRES_VERIFICATION |
| `OUT_OF_SCOPE` | Non-supplies (e.g., pure payroll lines outside VAT) | engine semantics |
| `NOT_SUBJECT` | Unregistered tenants issue documents without VAT until registration | engine semantics |

Item-level category classification (which item is zero-rated vs exempt) is tenant
configuration guided by pack documentation — the engine computes from the assigned tax
code; the pack never classifies items automatically.

## 4. Invoice requirements

**Baseline commercial set (platform standard, all jurisdictions):** seller legal name +
identifiers, buyer (tax invoice) details, invoice date, official document number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), line description (bilingual
where required), quantity, unit price, discounts, line net, line tax with rate, document
totals, currency ([../../GLOSSARY.md](../../GLOSSARY.md) "Tax invoice").

**SA-specific (baseline research, REQUIRES_VERIFICATION, source zatca.gov.sa):**

- Two VAT invoice types apply: **tax invoice** (فاتورة ضريبية, B2B full buyer details)
  and **simplified tax invoice** (فاتورة ضريبية مبسطة, B2C).
- **E-invoicing ("FATOORAH", الفوترة الإلكترونية):**
  - Phase 1 (generation): QR code, invoice hash, anti-tampering — mandatory since
    2021-12 (baseline research).
  - Phase 2 (integration): **clearance** for standard invoices, **reporting** for
    simplified invoices — rolling out in waves grouped by taxpayer revenue thresholds
    since 2023-01 (baseline research).
  - Architecture: [../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §3
    (isolation, submission lifecycle, certificates, verification gate).
- **Explicit note:** the *detailed legal field lists* (exact mandatory fields, QR content,
  XML structure, stamping rules) are **frozen only after official-specification
  verification in [PHASE-023](../../implementation/phases/PHASE-023.md)** (RISK-005). This
  file deliberately does not enumerate them.

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Authority counters (e.g., ICV) | Stored as compliance payload fields — never replacing platform identity | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-023 |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-023 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| VAT registration number (TIN) | الرقم الضريبي | REQUIRES_VERIFICATION (format deliberately not asserted) | zatca.gov.sa | PHASE-009 |
| Commercial Registration (CR) number | رقم السجل التجاري | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |
| National address elements (building/postal) | العنوان الوطني | REQUIRES_VERIFICATION | zatca.gov.sa | PHASE-009 |

Formats are stored as `null` in the pack until verification
([../COUNTRY_PACKS.md](../COUNTRY_PACKS.md) §2); validation never rejects a partner
identifier on an unverified pattern.

## 7. Date and number formats

- **Calendar:** Gregorian for all business/fiscal dates (assumption A-004); Hijri display
  and search supported via the Islamic calendar
  ([../LOCALIZATION_ARCHITECTURE.md](../LOCALIZATION_ARCHITECTURE.md) §7).
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** tenant-configurable `latn` (default) / `arab` display; identifiers and
  phone numbers always `latn` ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** SAR 2 minor units, half-up rounding
  ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §2–3).

## 8. Relevant reports

- **VAT return** (الإقرار الضريبي) per [../TAX_ENGINE.md](../TAX_ENGINE.md) §4:
  output/input tax by treatment, reverse-charge amounts, GL cross-check (INV-012),
  bilingual RTL rendering, draft → ready → filed-by-human statuses.
- Standard tax-account ledgers and document-level tax summaries feed the return; e-invoicing
  submission status reporting per [../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §7.

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `sa` (rates, formats, invoice baseline) | **SEEDED (PHASE-009 2026-10-30)** — rate row 15% from 2020-07-01 with `verified_at NULL` (REQUIRES_VERIFICATION); the pre-2020-07 prior rate is deliberately NOT asserted (§2) so no seed row exists — documents before the window fail closed (NO_RATE_FOR_DATE) | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| ZATCA e-invoicing adapter | **SHIPPED AS UNVERIFIED REFUSING STUB (PHASE-023 2026-11-05)** — the operational submission registry (1:N per adapter, retry chains via retry_of_submission_id, sealed payload/response artifacts), the S-10 certificate store, per-tenant rollout flags default OFF, and the fake-authority test harness are real and exercised in tests; every regulated adapter action (generate for clearance, sign, submit, report) refuses with the explicit UNVERIFIED error naming the unmet gate items — all four gate items NOT_VERIFIED in the verification log ([verification-log.md](verification-log.md)); the real adapter stays gated on [DR-001](../../decisions/compliance/DR-001-zatca-scope-and-timing.md) + the verification gate ([E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §3) | [PHASE-023](../../implementation/phases/PHASE-023.md) |
| VAT return report for SA | **SHIPPED (PHASE-009 v1)** — aggregation + INV-012 side-by-side cross-check + ready-gating + CSV/XLSX export + mark-filed (humans file) | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-sa.spec.ts`: standard/zero/exempt/mixed/credit-note/boundary(fail-closed before window)/unregistered + rounding 2-dp + determinism + return-prepare | PHASE-009 |
| Scenarios deferred | simplified-vs-standard invoice field sets + print outputs → PHASE-012/013; e-invoicing payload goldens → PHASE-023 (gated on verified specs) | 012/013/023 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard-rated sale at the current standard rate — line tax, summary, journal lines
   ([../../testing/TEST_STRATEGY.md](../../testing/TEST_STRATEGY.md) tax suite).
2. Zero-rated export sale (0% reported in the correct return box, not exempt).
3. Exempt supply (correct return box; no input recovery assumption).
4. Reverse-charge purchase (self-accounted output/input pair).
5. **Simplified vs standard invoice**: B2C simplified document vs B2B tax invoice —
   field sets, buyer-detail handling, print outputs.
6. Credit note against a standard invoice (negative amounts, RTL rendering, return box).
7. **Rate boundary**: document dated the day before the standard-rate change vs the day
   after — snapshots pin the correct rate ([../TAX_ENGINE.md](../TAX_ENGINE.md) §3).
8. Mixed basket (standard + zero + exempt on one invoice) with treatment-grouped summary.
9. Unregistered tenant: `NOT_SUBJECT` documents, no VAT fields, clean registration
   transition fixture.
10. Inclusive vs exclusive pricing on the same basket (extraction correctness).
11. E-invoicing payload golden files (generation phase features) — gated on verified
    specs in PHASE-023; refuse-to-submit behavior for unverified paths.

## 11. Known limitations

- All regulatory values are BASELINE_RESEARCH: no legal review has occurred yet; nothing
  here may be presented to a customer as compliance advice.
- E-invoicing: wave/taxpayer-segment behavior (who must integrate when) is configured per
  tenant only after verification; the adapter refuses submission until then.
- Zakat, excise, customs, and sector-specific levies are not modeled; they are future pack
  features via decision record ([ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md)
  revisit triggers).
- Identifier formats (TIN/CR) deliberately unasserted until verification.
