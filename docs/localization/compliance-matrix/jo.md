# Jordan (JO) — Compliance File

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

Jurisdiction compliance record for the Jordan pack (`jo`). **Every regulatory value below
is research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — see
[README.md](README.md) §4 and [../official-sources/README.md](../official-sources/README.md).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `JO` / `JOR` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | المملكة الأردنية الهاشمية / Hashemite Kingdom of Jordan | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | JOD — Jordanian Dinar (دينار أردني) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | **3** (1 JOD = 1000 fils) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Asia/Amman` (UTC+2; historical DST — verify current observance) | REQUIRES_VERIFICATION | IANA time zone database + official sources | PHASE-002 |
| Official language | Arabic (English widespread in business) | REQUIRES_VERIFICATION | istd.gov.jo (portal to confirm) | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | istd.gov.jo (TBC) | PHASE-009 |

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority | Income and Sales Tax Department — دائرة ضريبة الدخل والمبيعات (ISTD) | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| Tax scheme | **GST** (General Sales Tax, ضريبة المبيعات العامة) — modeled by the platform's VAT engine with local terminology | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| VAT applicability | `VAT_IN_FORCE` (GST) | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| Standard GST rate | 16% | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| Standard rate effective from | 2018 (applies to most goods/services) | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| Reduced / special rates | Some goods/services may face **different (e.g., reduced) rates**; none asserted here | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| Mandatory registration threshold | A threshold exists; exact amount **not asserted here** | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| Return filing | Periodic sales-tax returns required; frequency per taxpayer profile | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| E-invoicing | No mandatory e-invoicing regime identified in baseline research | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |

**Naming rule:** the pack's `regulatory_notes` record that Jordan's scheme is legally
"General Sales Tax" — documents and reports display GST terminology
(ضريبة المبيعات), while the engine's internal model stays the shared VAT-style treatment
set ([TAX_ENGINE.md](../TAX_ENGINE.md) §1).

## 3. VAT applicability and relevant treatments

| Treatment | Relevance in JO (baseline research) | status |
|-----------|--------------------------------------|--------|
| `STANDARD_RATED` | Default for most goods/services at the standard rate | REQUIRES_VERIFICATION |
| `ZERO_RATED` | Certain categories (e.g., exports); exact lists **not asserted here** | REQUIRES_VERIFICATION |
| `EXEMPT` | Specific supplies exempt; lists **not asserted here** | REQUIRES_VERIFICATION |
| `REVERSE_CHARGE` | Applies to defined situations; scope **not asserted here** | REQUIRES_VERIFICATION |
| `OUT_OF_SCOPE` | Non-supplies | engine semantics |
| `NOT_SUBJECT` | Unregistered tenants | engine semantics |

If reduced rates are verified, they land as additional `tax_rates` rows with distinct
tenant tax codes — the multi-rate mechanism is already part of the engine.

## 4. Invoice requirements

**Baseline commercial set** (platform standard): seller legal name + identifiers, buyer
details for tax invoices, invoice date, official number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), bilingual line description
where required, qty, unit price, discounts, line net, line tax + rate, totals, currency.

**JO-specific (baseline research, REQUIRES_VERIFICATION, source istd.gov.jo / taxes.gov.jo):**

- **Tax invoice** (فاتورة ضريبة / فاتورة مبيعات) requirements — exact mandatory field
  lists frozen only after verification (PHASE-009).
- No e-invoicing regime identified at research date → `e_invoicing.status: NONE`;
  compliance-ready archives are produced labeled non-authoritative
  ([../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §5).
- JOD 3-decimal amounts must round and render correctly.

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence, assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| Sales tax registration number (TIN) | الرقم الضريبي / رقم التسجيل في ضريبة المبيعات | REQUIRES_VERIFICATION (format not asserted) | istd.gov.jo / taxes.gov.jo (TBC) | PHASE-009 |
| National economy registration / trade name documents | وثائق تسجيل الاقتصاد الوطني | REQUIRES_VERIFICATION | relevant Jordanian authority portal | PHASE-009 |

## 7. Date and number formats

- **Calendar:** Gregorian business/fiscal dates (A-004).
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** `latn` default / `arab` optional; identifiers always `latn`
  ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** JOD **3** minor units, half-up ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §2–3).
- **DST:** verify current DST observance for `Asia/Amman` at pack verification; tests
  include a boundary fixture either way.

## 8. Relevant reports

- **Sales tax (GST) return** (الإقرار الضريبي) per [../TAX_ENGINE.md](../TAX_ENGINE.md) §4
  with INV-012 cross-check; bilingual RTL with GST terminology; humans file.
- Tax-account ledgers and document tax summaries; compliance-archive export
  (non-authoritative).

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `jo` | **SEEDED (PHASE-009 2026-10-30)** — rate row 16% from 2018-01-01, `verified_at NULL`; GST modeled as VAT with the local terminology (ضريبة المبيعات) in the pack descriptor | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| VAT return report for JO | **SHIPPED (PHASE-009 v1)** — 3-dp JOD fixtures green | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-jo.spec.ts`: the 7 classes (boundary = fail-closed before 2018-01) + rounding 3-dp half-up tie + determinism + return-prepare | PHASE-009 |
| Scenarios deferred | invoice field sets/print → 012/013 | 012/013 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard-rated sale at the standard rate — 3-decimal JOD rounding fixtures
   ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §7 F).
2. Zero-rated supply distinct from exempt in the return.
3. Exempt supply (correct box).
4. Reverse-charge purchase (self-accounted pair).
5. **Multi-rate fixture (synthetic):** a reduced-rate row proving per-line rate resolution
   via distinct tax codes, in case verification confirms reduced rates.
6. Credit note with 3-decimal negative amounts in RTL rendering.
7. Rate boundary fixture (document dated before/after an `effective_from` in fixture data).
8. Mixed basket with treatment-grouped summary.
9. Unregistered tenant (`NOT_SUBJECT`) documents and registration transition fixture.
10. GST terminology check: documents/reports show ضريبة المبيعات wording, not invented
    "VAT" labels — verified against the terminology rule (§2).
11. Compliance archive generation (non-authoritative) without submission attempts.

## 11. Known limitations

- All regulatory values are BASELINE_RESEARCH; no legal review yet.
- GST vs VAT terminology must be honored on printed/legal text; the engine is shared, the
  vocabulary is pack-local.
- Reduced/special rates (if any) are unasserted until verification; a pack update will
  carry them.
- Official portal URL marked TBC (two candidate domains recorded); the verification visit
  pins the authoritative one.
- Identifier formats deliberately unasserted until verification.
