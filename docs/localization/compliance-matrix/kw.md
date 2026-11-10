# Kuwait (KW) — Compliance File (NO_VAT mode)

> **Status:** STABLE (baseline research snapshot) · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

Jurisdiction compliance record for the Kuwait pack (`kw`). **Every regulatory value below
is research-date baseline knowledge carrying `REQUIRES_VERIFICATION`** — see
[README.md](README.md) §4 and [../official-sources/README.md](../official-sources/README.md).
Terminology: [../../GLOSSARY.md](../../GLOSSARY.md). Pack spec: [../COUNTRY_PACKS.md](../COUNTRY_PACKS.md).

## 1. Identifiers

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| ISO-3166 alpha-2 / alpha-3 | `KW` / `KWT` | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Country name (AR / EN) | دولة الكويت / State of Kuwait | VERIFIED_BASELINE | ISO-3166 standard | PHASE-002 |
| Currency | KWD — Kuwaiti Dinar (دينار كويتي) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Currency minor units | **3** (1 KWD = 1000 fils) | VERIFIED_BASELINE | ISO-4217 standard | PHASE-002 |
| Time zone | `Asia/Kuwait` (UTC+3, no DST) | VERIFIED_BASELINE | IANA time zone database | PHASE-002 |
| Official language | Arabic (English widespread in business) | REQUIRES_VERIFICATION | mof.gov.kw (portal to confirm) | PHASE-009 |
| Default platform locale | `ar` (supported: `ar`, `en`) | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | PHASE-009 |

## 2. Tax regime summary (baseline research)

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Tax authority (tax matters) | Ministry of Finance — وزارة المالية (Kuwait) | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | PHASE-009 |
| VAT applicability | `NO_VAT` — no VAT regime in force as of the research date | REQUIRES_VERIFICATION | mof.gov.kw / tax.gov.kw (TBC) | PHASE-009 |
| VAT proposals | VAT has been **repeatedly proposed; not enacted** as of the research date | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | PHASE-009 |
| Standard rate | N/A — no rate exists to assert | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | PHASE-009 |
| Other taxes | Other taxes/levies (e.g., corporate income tax on certain entities) may exist — **not asserted here**; flagged for future pack versions after verification | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | future pack version |
| E-invoicing | No mandatory regime identified in baseline research | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | PHASE-009 |

RISK-008 (no-VAT jurisdictions assumed wrong) applies squarely here: the pack's
`vat_status` must be re-verified before launch and monitored continuously.

## 3. How the platform operates in NO_VAT mode

The `NO_VAT` status is a first-class mode ([../TAX_ENGINE.md](../TAX_ENGINE.md) §1,
[ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) §5) — never "VAT at 0%":

| Behavior | Rule |
|----------|------|
| Document layout | **No VAT fields** printed: no tax column, no tax summary block, no VAT total row |
| Postings | **No VAT postings** — no VAT_PAYABLE / VAT_RECOVERABLE / VAT_EXPENSED journal lines |
| Treatment recorded | `NOT_SUBJECT` stamped on lines so reporting stays consistent and a future registration transition is clean |
| VAT return report | Not offered for this jurisdiction |
| UI | Tax-code pickers hidden for KW documents; tax settings pages show the NO_VAT explainer |
| Data model | Rate snapshot still stored (`NOT_SUBJECT`, jurisdiction `KW`, rate null) — history survives a future VAT introduction |

If Kuwait enacts VAT later: a new pack version adds `tax_rates` rows with
`effective_from`; tenants register (`tax_registrations`), and the same engine activates —
no migration of historical documents, which correctly remain `NOT_SUBJECT`.

## 4. Invoice requirements

**Standard commercial invoicing applies** (baseline platform set): seller legal name +
identifiers, buyer details, invoice date, official number
([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)), line description (bilingual
where the tenant requires), qty, unit price, discounts, line net, document totals,
currency — with **no VAT section**.

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Legal mandatory fields | Standard commercial fields; any KW-specific mandatory fields | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | PHASE-009 |
| Bilingual requirements | Arabic customary on commercial documents; exact requirements | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | PHASE-009 |
| NOT_SUBJECT indicator | Platform prints a neutral "no tax" presentation (no VAT wording invented) | platform behavior | — | — |

The platform does **not** stamp invented legal wording (e.g., a "not subject to VAT"
sentence) until a verified official requirement or tenant-approved custom print text
exists — blank VAT section is the default.

## 5. Numbering requirements

| aspect | value | status | official source to verify | verification phase |
|--------|-------|--------|---------------------------|--------------------|
| Platform rule | Per-tenant/branch/type sequence, assigned at issuance, immutable (ADR-0006) | — (platform decision) | — | — |
| Additional legal numbering rules | Any stricter sequencing/format rules | REQUIRES_VERIFICATION | mof.gov.kw (TBC) | PHASE-009 |

## 6. Business identifiers commonly used

| identifier | Arabic label | status | official source to verify | verification phase |
|------------|--------------|--------|---------------------------|--------------------|
| Commercial Registration (CR) number | رقم السجل التجاري | REQUIRES_VERIFICATION | relevant Kuwaiti authority portal | PHASE-009 |
| Civil ID (for individuals) | الرقم المدني | REQUIRES_VERIFICATION | relevant Kuwaiti authority portal | PHASE-009 |

## 7. Date and number formats

- **Calendar:** Gregorian business/fiscal dates (A-004).
- **Date display:** `dd/MM/yyyy` baseline pack default — REQUIRES_VERIFICATION (PHASE-009).
- **Digits:** `latn` default / `arab` optional; identifiers always `latn`
  ([../RTL_AND_LTR.md](../RTL_AND_LTR.md) §5).
- **Amounts:** KWD **3** minor units, half-up ([../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md) §2–3).

## 8. Relevant reports

- No VAT return for KW. Standard financial statements, sales/purchase reports, and tax-
  agnostic document summaries apply with 3-decimal KWD formatting.
- If other taxes are verified in future pack versions, their reports attach to those
  features — never to a fake VAT box.

## 9. Platform implementation status

| feature | status | phase |
|---------|--------|-------|
| Jurisdiction pack `kw` | **SEEDED (PHASE-009 2026-10-30)** — NO_VAT: full pack (formats, identifiers, invoice baseline) with NO rate rows; `verified_at NULL` | [PHASE-009](../../implementation/phases/PHASE-009.md) |
| VAT return report for KW | **SHIPPED (PHASE-009 v1)** — honest empty aggregation (no VAT activity; the close-checklist item reads NOT_APPLICABLE) | PHASE-009 |
| Per-pack fixture suite | **GREEN (PHASE-009)** — `pack-kw.spec.ts` NO_VAT mode: NOT_SUBJECT, no VAT fields/postings, full-pack formats still apply | PHASE-009 |

## 10. Test scenarios required before the pack is marked VERIFIED

1. Standard sale: document prints with **no VAT fields**, totals = net only.
2. Journal lines contain **no VAT postings**; entry balances without tax accounts.
3. Lines record `NOT_SUBJECT` snapshots (jurisdiction `KW`).
4. Credit note and receipt flows without tax lines; 3-decimal KWD rounding fixtures.
5. Mixed tenant behavior: a tenant with KW and (e.g.) SA registrations issues correctly
   in each — jurisdiction switching is explicit per document/branch.
6. VAT return UI does not offer KW; report catalog excludes it.
7. **Future-VAT readiness fixture**: synthetic pack version with a rate row
   `effective_from: T` — documents before T are `NOT_SUBJECT`, after T compute normally,
   proving the transition path without touching history.
8. Inclusive-pricing toggle is inert in NO_VAT mode (no extraction happens).
9. Compliance archive (non-authoritative) generation without VAT fields.

## 11. Known limitations

- All regulatory values are BASELINE_RESEARCH; the NO_VAT status itself must be
  re-verified at PHASE-009 and monitored (RISK-008).
- Other Kuwaiti taxes (e.g., corporate income tax for certain entities, any municipal
  fees) are not modeled; they are future pack features via decision record after
  verification.
- Official portal URL is less certain than the known baselines (see
  [../official-sources/README.md](../official-sources/README.md)) — "TBC" until the
  verification visit records the exact authority site.
- Identifier formats deliberately unasserted until verification.
