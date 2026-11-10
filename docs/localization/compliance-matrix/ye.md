# Yemen (YE) — Compliance File (NO_VAT mode)

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

Jurisdiction compliance record for the Yemen pack (`ye`). **Every regulatory value below
is research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — see
[README.md](README.md) §4 and [../official-sources/README.md](../official-sources/README.md).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).
Related open question: OQ-005 (Yemen-specific formats — recommended decision: no).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `YE` / `YEM` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | الجمهورية اليمنية / Republic of Yemen | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | YER — Yemeni Rial (ريال يمني) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | 2 | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Asia/Aden` (UTC+3, no DST) | VERIFIED_BASELINE | IANA time zone database | PHASE-002 |
| Official language | Arabic | REQUIRES_VERIFICATION | Yemeni tax authority (portal TBC) | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | Yemeni tax authority (TBC) | PHASE-009 |

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority | Yemeni tax authority (مصلحة الضرائب اليمنية) — exact authority name + official portal **to be confirmed** | REQUIRES_VERIFICATION | official portal TBC | PHASE-009 |
| VAT applicability | `NO_VAT` — no VAT regime identified as of the research date | REQUIRES_VERIFICATION | official portal TBC | PHASE-009 |
| Legacy sales-tax concepts | Some **legacy sales-tax concepts exist** (baseline research) — their current scope, rates, and mechanics are **not asserted here**; treated as NO_VAT with standard commercial invoicing until verified | REQUIRES_VERIFICATION | official portal TBC | future pack version |
| Standard rate | N/A — no VAT rate asserted | REQUIRES_VERIFICATION | official portal TBC | PHASE-009 |
| E-invoicing | No mandatory regime identified in baseline research | REQUIRES_VERIFICATION | official portal TBC | PHASE-009 |

The Yemen file has the **weakest source baseline** of the ten: no confident portal URL is
asserted. Until the verification visit records the official portal, every regulatory
aspect stays `REQUIRES_VERIFICATION` and nothing beyond standard commercial invoicing is
configured.

## 3. How the platform operates in NO_VAT mode

| Behavior | Rule |
|----------|------|
| Document layout | **No VAT fields** printed; standard commercial invoice presentation |
| Postings | **No VAT postings** of any purpose |
| Treatment recorded | `NOT_SUBJECT` stamped on lines (jurisdiction `YE`) |
| VAT return report | Not offered for this jurisdiction |
| Legacy sales tax | **Not modeled** — if verification establishes current obligations, they land as a future pack feature via decision record; the platform never presents them as "VAT at 0%" (directive §6) |

OQ-005 (support Yemen-specific sales-tax filing formats at GA?) has the recommended
decision **No** — Yemen ships as a no-VAT pack with standard invoicing; revisit if a
design partner requires otherwise.

## 4. Invoice requirements

**Standard commercial invoicing applies** (baseline platform set): seller legal name +
identifiers, buyer details, invoice date, official number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), Arabic line description,
qty, unit price, discounts, line net, totals, currency — **no VAT section**.

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Legal mandatory fields | Standard commercial fields; any YE-specific mandatory fields | REQUIRES_VERIFICATION | official portal TBC | PHASE-009 |
| Bilingual requirements | Arabic-primary documents; exact requirements | REQUIRES_VERIFICATION | official portal TBC | PHASE-009 |
| Sales-tax stamps/wording | **Not implemented** — no invented legal wording before verification | REQUIRES_VERIFICATION | official portal TBC | future pack version |

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence, assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | official portal TBC | PHASE-009 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| Tax card / tax number (where issued) | البطاقة الضريبية | REQUIRES_VERIFICATION | official portal TBC | PHASE-009 |
| Commercial registration number | رقم السجل التجاري | REQUIRES_VERIFICATION | relevant Yemeni authority portal | PHASE-009 |

## 7. Date and number formats

- **Calendar:** Gregorian business/fiscal dates (A-004).
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** `latn` default / `arab` optional; identifiers always `latn`
  ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** YER 2 minor units, half-up ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §2–3).
- Practical note: YER is a high-inflation, low-subunit-usage environment; the platform
  still stores and rounds at the ISO minor units — display trimming is a tenant
  preference, storage never truncates.

## 8. Relevant reports

- No VAT return for YE. Standard financial and operational reports apply.
- Any future verified sales-tax reporting becomes a dedicated feature (OQ-005 decision
  record), never a VAT-return variant.

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `ye` | **SEEDED (PHASE-009 2026-10-30)** — NO_VAT: full pack, NO rate rows; official portal still TBC (source_ref carries the placeholder honestly) | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| VAT return report for YE | **SHIPPED (PHASE-009 v1)** — honest empty aggregation | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-ye.spec.ts` NO_VAT mode | PHASE-009 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard sale: no VAT fields; totals = net only; Arabic-primary print template.
2. No VAT postings; `NOT_SUBJECT` snapshots stored (jurisdiction `YE`).
3. Credit note + receipt flows without tax lines (2-decimal YER fixtures).
4. **Verification-protocol scenario:** the pack reaches `VERIFIED` only after an
   official-portal visit records the authority name/URL — until then all scenarios pass
   against BASELINE_RESEARCH values and the pack stays flagged.
5. Multi-jurisdiction tenant fixture (YE branch NO_VAT alongside a VAT jurisdiction).
6. VAT return UI excludes YE.
7. Future-activation fixture (synthetic rate row with `effective_from`) proving the
   transition path without touching history.
8. Compliance archive (non-authoritative) without VAT fields.

## 11. Known limitations

- **Weakest verification baseline of all packs**: no confident official portal URL; the
  verification visit is a hard precondition for any YE-specific configuration beyond
  standard invoicing.
- Legacy sales-tax concepts are acknowledged but deliberately not implemented; tenants
  must not treat the platform as sales-tax-compliant in YE until a verified feature ships.
- OQ-005 recommended decision (No YE-specific filing formats at GA) stands until a
  product-owner decision record changes it.
- Identifier formats deliberately unasserted until verification.
