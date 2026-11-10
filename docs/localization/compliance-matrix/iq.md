# Iraq (IQ) — Compliance File (NO_VAT mode)

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

Jurisdiction compliance record for the Iraq pack (`iq`). **Every regulatory value below
is research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — see
[README.md](README.md) §4 and [../official-sources/README.md](../official-sources/README.md).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).
Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `IQ` / `IRQ` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | جمهورية العراق / Republic of Iraq | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | IQD — Iraqi Dinar (دينار عراقي) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | **3** (1 IQD = 1000 fils; subunits not used in practice) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Asia/Baghdad` (UTC+3; historical DST — verify current observance) | REQUIRES_VERIFICATION | IANA time zone database + official sources | PHASE-002 |
| Official language | Arabic (Kurdish official in the Kurdistan Region; English used in business) | REQUIRES_VERIFICATION | mof.gov.iq (portal to confirm) | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority | General Commission for Taxes — الهيئة العامة للضرائب (under the Ministry of Finance) | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |
| VAT applicability | `NO_VAT` — no VAT regime in force as of the research date | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |
| VAT proposals | Proposals exist; **not enacted** as of the research date | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |
| Standard rate | N/A — no rate exists to assert | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |
| Other taxes | Income tax and other obligations may exist — **not asserted here**; flagged for future pack versions after verification | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | future pack version |
| E-invoicing | No mandatory regime identified in baseline research | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |

RISK-008 applies: the `NO_VAT` status must be re-verified before launch and monitored;
if Iraq enacts VAT, activation follows the pack-version path (§3).

## 3. How the platform operates in NO_VAT mode

| Behavior | Rule |
|----------|------|
| Document layout | **No VAT fields** printed; standard commercial invoice presentation |
| Postings | **No VAT postings** of any purpose |
| Treatment recorded | `NOT_SUBJECT` stamped on lines (jurisdiction `IQ`) for clean future transition |
| VAT return report | Not offered for this jurisdiction |
| Region nuance | The Kurdistan Region may differ administratively; nothing region-specific is configured until verification records official guidance |

## 4. Invoice requirements

**Standard commercial invoicing applies** (baseline platform set): seller legal name +
identifiers, buyer details, invoice date, official number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), Arabic line description,
qty, unit price, discounts, line net, totals, currency — **no VAT section**.

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Legal mandatory fields | Standard commercial fields; any IQ-specific mandatory fields | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |
| Bilingual requirements | Arabic-primary documents; exact requirements | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |
| Customs/import documents | Out of current scope; any required interplay lands with future pack features | REQUIRES_VERIFICATION | relevant authority portals | future pack version |

No legal tax wording is invented on documents before verification.

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence, assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| Company registration number | رقم تسجيل الشركة | REQUIRES_VERIFICATION | relevant Iraqi authority portal | PHASE-009 |
| Tax card / tax number (where issued) | البطاقة الضريبية | REQUIRES_VERIFICATION | mof.gov.iq (TBC) | PHASE-009 |

## 7. Date and number formats

- **Calendar:** Gregorian business/fiscal dates (A-004).
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** `latn` default / `arab` optional; identifiers always `latn`
  ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** IQD **3** minor units per ISO-4217, half-up
  ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §2–3). Practical note:
  IQD circulates in whole-dinar magnitudes; display grouping/thousand-scale rendering is
  a tenant preference — storage keeps full ISO precision.

## 8. Relevant reports

- No VAT return for IQ. Standard financial and operational reports apply.
- Future verified tax features (income-tax-related reports, etc.) attach to their own
  pack versions — never to invented VAT boxes.

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `iq` | **SEEDED (PHASE-009 2026-10-30)** — NO_VAT: full pack, NO rate rows; GCT matters remain future pack features via decision record | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| VAT return report for IQ | **SHIPPED (PHASE-009 v1)** — honest empty aggregation | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-iq.spec.ts` NO_VAT mode | PHASE-009 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard sale: no VAT fields; totals = net only.
2. No VAT postings; `NOT_SUBJECT` snapshots stored (jurisdiction `IQ`).
3. Credit note + receipt flows without tax lines; IQD 3-decimal rounding fixtures
   ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §7 F).
4. Large-magnitude rendering: multi-million IQD amounts format with grouping + tabular
   numerals in RTL without breaking layout.
5. Multi-jurisdiction tenant fixture (IQ branch NO_VAT alongside a VAT jurisdiction).
6. VAT return UI excludes IQ.
7. **Future-VAT activation fixture**: synthetic pack version with a rate row
   `effective_from: T` — before T `NOT_SUBJECT`, after T normal computation; history
   untouched.
8. Inclusive-pricing toggle inert in NO_VAT mode.
9. Compliance archive (non-authoritative) without VAT fields.

## 11. Known limitations

- All regulatory values are BASELINE_RESEARCH; NO_VAT status must be re-verified at
  PHASE-009 and monitored (RISK-008).
- Administrative differences between federal Iraq and the Kurdistan Region are not
  modeled; nothing is configured until official guidance is verified.
- Other taxes (income tax etc.) are not modeled; future pack features via decision record.
- Official portal URL is TBC (see [../official-sources/README.md](../official-sources/README.md)).
- Identifier formats deliberately unasserted until verification.
