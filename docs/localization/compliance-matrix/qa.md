# Qatar (QA) — Compliance File (NO_VAT mode; excise noted)

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

Jurisdiction compliance record for the Qatar pack (`qa`). **Every regulatory value below
is research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — see
[README.md](README.md) §4 and [../official-sources/README.md](../official-sources/README.md).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `QA` / `QAT` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | دولة قطر / State of Qatar | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | QAR — Qatari Riyal (ريال قطري) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | 2 | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Asia/Qatar` (UTC+3, no DST) | VERIFIED_BASELINE | IANA time zone database | PHASE-002 |
| Official language | Arabic (English widespread in business) | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority | General Tax Authority — هيئة الضرائب العامة (GTA) | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |
| VAT applicability | `VAT_PLANNED` — no VAT in force as of the research date; introduction planned, **no date asserted** | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |
| Standard rate | N/A — no rate exists to assert | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |
| Excise tax | An **excise tax exists on some goods** (baseline research); scope, rates, and mechanics **not asserted here** | REQUIRES_VERIFICATION | gta.gov.qa | future pack version |
| Other taxes | Corporate income tax and other obligations may exist — **not asserted here** | REQUIRES_VERIFICATION | gta.gov.qa | future pack version |
| E-invoicing | No mandatory regime identified in baseline research | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |

`VAT_PLANNED` behaves exactly like `NO_VAT` for day-to-day operation, but the pack
additionally schedules **monitoring** for the introduction (RISK-006/RISK-008) and keeps
the future activation path documented (§3).

## 3. How the platform operates in NO_VAT mode (with planned flag)

| Behavior | Rule |
|----------|------|
| Document layout | **No VAT fields** printed (no tax column, no summary block, no VAT total) |
| Postings | **No VAT postings** — no VAT journal lines of any purpose |
| Treatment recorded | `NOT_SUBJECT` stamped on lines (jurisdiction `QA`) for clean future transition |
| VAT return report | Not offered for this jurisdiction |
| Excise | **Not modeled yet** — when verified, it becomes a separate pack feature via decision record ([ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) revisit triggers), never "VAT with a different name" |
| Planned-VAT activation | A future pack version adds `tax_rates` with `effective_from`; tenants register; historical documents stay `NOT_SUBJECT` |

## 4. Invoice requirements

**Standard commercial invoicing applies** (baseline platform set): seller legal name +
identifiers, buyer details, invoice date, official number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), line description (bilingual
where the tenant requires), qty, unit price, discounts, line net, totals, currency —
**no VAT section**.

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Legal mandatory fields | Standard commercial fields; any QA-specific mandatory fields | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |
| Bilingual requirements | Arabic customary on commercial documents; exact requirements | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |
| Excise-related invoice content | If excise requires invoice content, it lands with the future excise feature | REQUIRES_VERIFICATION | gta.gov.qa | future pack version |

The platform prints a neutral no-tax presentation; no legal "not subject" wording is
invented before verification.

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence, assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| Commercial Registration (CR) number | رقم السجل التجاري | REQUIRES_VERIFICATION | relevant Qatari authority portal | PHASE-009 |
| Tax card / tax number (where applicable to specific taxes) | البطاقة الضريبية / الرقم الضريبي | REQUIRES_VERIFICATION | gta.gov.qa | PHASE-009 |

## 7. Date and number formats

- **Calendar:** Gregorian business/fiscal dates (A-004).
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** `latn` default / `arab` optional; identifiers always `latn`
  ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** QAR 2 minor units, half-up ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §2–3).

## 8. Relevant reports

- No VAT return for QA. Standard financial and operational reports apply.
- Excise reporting (if verified in a future pack version) attaches to that feature; the
  current pack ships no placeholder boxes for it.

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `qa` | **SEEDED (PHASE-009 2026-10-30)** — VAT_PLANNED: full pack, NO rate rows (no rate exists to assert — behaves NOT_SUBJECT until a verified version ships); excise stays a future pack feature | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| VAT return report for QA | **SHIPPED (PHASE-009 v1)** — honest empty aggregation | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-qa.spec.ts` planned-mode: NOT_SUBJECT + full-pack formats apply | PHASE-009 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard sale: no VAT fields on the document, totals = net only.
2. No VAT postings in journals; `NOT_SUBJECT` snapshots stored.
3. Credit note + receipt flows without tax lines (2-decimal QAR fixtures).
4. Multi-jurisdiction tenant fixture: QA branch documents are NO_VAT while another
   jurisdiction's branch computes normally — explicit per-document jurisdiction.
5. VAT return UI excludes QA.
6. **Planned-VAT activation fixture**: synthetic pack version with a future `effective_from`
   rate — documents before the date are `NOT_SUBJECT`, after compute; history untouched.
7. Inclusive-pricing toggle inert in NO_VAT mode.
8. Compliance archive (non-authoritative) without VAT fields.
9. Excise stub behavior: feature absent (no invented fields) until its own verified pack
   version exists.

## 11. Known limitations

- All regulatory values are BASELINE_RESEARCH; VAT-PLANNED status requires monitoring and
  re-verification before any QA launch promising VAT readiness (RISK-008).
- **Excise tax exists on some goods but is not modeled**; tenants dealing in excisable
  goods must not treat this platform as excise-compliant until a verified excise feature
  ships (decision record required).
- Other taxes (e.g., corporate income tax) not modeled.
- Identifier formats deliberately unasserted until verification.
