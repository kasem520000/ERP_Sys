# Oman (OM) — Compliance File

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

Jurisdiction compliance record for the Oman pack (`om`). **Every regulatory value below is
research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — see
[README.md](README.md) §4 and [../official-sources/README.md](../official-sources/README.md).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `OM` / `OMN` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | سلطنة عمان / Sultanate of Oman | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | OMR — Omani Rial (ريال عماني) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | **3** (1 OMR = 1000 baisa) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Asia/Muscat` (UTC+4, no DST) | VERIFIED_BASELINE | IANA time zone database | PHASE-002 |
| Official language | Arabic (English widespread in business) | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority | Oman Tax Authority — هيئة الضرائب (سلطنة عمان) | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |
| VAT applicability | `VAT_IN_FORCE` | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |
| Standard VAT rate | 5% | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |
| Standard rate effective from | 2021-04 | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |
| Reduced / multiple rates | None identified in baseline research (single standard rate; zero-rated and exempt categories exist) | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |
| Mandatory registration threshold | A threshold exists; exact amount **not asserted here** | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |
| VAT return filing | Periodic returns required; frequency per taxpayer profile | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |
| E-invoicing | No mandatory regime identified in baseline research | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |

## 3. VAT applicability and relevant treatments

| Treatment | Relevance in OM (baseline research) | status |
|-----------|--------------------------------------|--------|
| `STANDARD_RATED` | Default for most supplies | REQUIRES_VERIFICATION |
| `ZERO_RATED` | Certain categories (e.g., exports); exact lists **not asserted here** | REQUIRES_VERIFICATION |
| `EXEMPT` | Specific supplies exempt; lists **not asserted here** | REQUIRES_VERIFICATION |
| `REVERSE_CHARGE` | Applies to defined situations; scope **not asserted here** | REQUIRES_VERIFICATION |
| `OUT_OF_SCOPE` | Non-supplies | engine semantics |
| `NOT_SUBJECT` | Unregistered tenants | engine semantics |

## 4. Invoice requirements

**Baseline commercial set** (platform standard): seller legal name + identifiers, buyer
details for tax invoices, invoice date, official number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), bilingual line description
where required, qty, unit price, discounts, line net, line tax + rate, totals, currency.

**OM-specific (baseline research, REQUIRES_VERIFICATION, source taxoman.gov.om):**

- **Tax invoice** (فاتورة ضريبية) requirements; simplified/retail forms may apply — exact
  mandatory field lists frozen only after verification (PHASE-009).
- No e-invoicing regime identified at research date → `e_invoicing.status: NONE`; the
  payload builder still produces compliance-ready archives labeled non-authoritative
  ([../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §5).
- OMR 3-decimal amounts must round and render correctly on invoices.

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence, assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | taxoman.gov.om | PHASE-009 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| VAT registration number (TIN) | الرقم الضريبي / رقم التسجيل في ضريبة القيمة المضافة | REQUIRES_VERIFICATION (format not asserted) | taxoman.gov.om | PHASE-009 |
| Commercial Registration (CR) number | رقم السجل التجاري | REQUIRES_VERIFICATION | relevant Omani authority portal | PHASE-009 |

## 7. Date and number formats

- **Calendar:** Gregorian business/fiscal dates (A-004).
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** `latn` default / `arab` optional; identifiers always `latn`
  ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** OMR **3** minor units, half-up ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §2–3).

## 8. Relevant reports

- **VAT return** (الإقرار الضريبي) per [../TAX_ENGINE.md](../TAX_ENGINE.md) §4 with
  INV-012 cross-check; bilingual RTL; humans file.
- Tax-account ledgers and document tax summaries; compliance-archive export
  (non-authoritative).

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `om` | **SEEDED (PHASE-009 2026-10-30)** — rate row 5% from 2021-04-01, `verified_at NULL` | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| VAT return report for OM | **SHIPPED (PHASE-009 v1)** — 3-dp OMR fixtures green | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-om.spec.ts`: the 7 classes (boundary = fail-closed before 2021-04) + rounding 3-dp + determinism + return-prepare | PHASE-009 |
| Scenarios deferred | invoice field sets/print → 012/013 | 012/013 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard-rated sale at the standard rate — 3-decimal OMR rounding fixtures
   ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §7 F).
2. Zero-rated supply distinct from exempt in the return.
3. Exempt supply (correct box).
4. Reverse-charge purchase (self-accounted pair).
5. Credit note with 3-decimal negative amounts in RTL rendering.
6. **Effective-date boundary:** document dated before 2021-04 (pre-VAT, `NOT_SUBJECT`
   path for historical imports) vs after — snapshot correctness.
7. Mixed basket with treatment-grouped summary.
8. Unregistered tenant (`NOT_SUBJECT`) documents and registration transition fixture.
9. Inclusive vs exclusive pricing with 3-decimal extraction.
10. Compliance archive generation (non-authoritative) without submission attempts.

## 11. Known limitations

- All regulatory values are BASELINE_RESEARCH; no legal review yet.
- 3-decimal currency rounding (baisa) is the highest-risk defect area; fixtures must be
  green before `TESTED`.
- Excise tax (if applicable to a tenant's goods) is not modeled; flagged for future pack
  versions after verification.
- Identifier formats deliberately unasserted until verification.
