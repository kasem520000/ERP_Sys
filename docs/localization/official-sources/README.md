# Official Sources Directory

> **Status:** STABLE · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

The authoritative directory of **official government sources** used by the compliance
verification protocol ([../compliance-matrix/README.md](../compliance-matrix/README.md) §4).
This is the only class of source that may flip a fact from `REQUIRES_VERIFICATION` to
verified. **Hard rule: only official government portals (and laws/gazettes they publish)
count.** Third-party blogs, consultancies, accounting-firm summaries, and news articles
are never acceptable verification evidence — at most they point *toward* the official
source, which must then be consulted directly.

Known main portal domains below are **baseline research** — each is flagged for
confirmation at verification time; entries marked **"URL to be confirmed"** have no
confident baseline and must be located during the verification visit (never guessed in
documentation or code).

## 1. Directory

| Country | Authority (AR / EN) | Portal | What to verify there | Status |
|---------|---------------------|--------|----------------------|--------|
| SA | هيئة الزكاة والضريبة والجمارك / Zakat, Tax and Customs Authority (ZATCA) | zatca.gov.sa *(baseline domain — verify)* | VAT law + rates + effective dates; e-invoicing ("FATOORAH") specifications and **SDKs** (pin exact SDK versions); invoice-content requirements; FAQs; taxpayer-segment waves | REQUIRES_VERIFICATION |
| AE | هيئة الضرائب الاتحادية / Federal Tax Authority (FTA) · وزارة المالية / Ministry of Finance (e-invoicing program) | tax.gov.ae *(baseline domain — verify)* · mof.gov.ae *(URL to be confirmed at verification time)* | VAT law + rates; e-invoicing program announcements/specs (when published); invoice requirements; FAQs | REQUIRES_VERIFICATION |
| BH | هيئة الإيرادات الوطنية / National Bureau for Revenue (NBR) | nbr.gov.bh *(baseline domain — verify)* | VAT law + rates (incl. 2019→2022 change history); invoice requirements; registration thresholds; FAQs | REQUIRES_VERIFICATION |
| KW | وزارة المالية / Ministry of Finance (Kuwait) | mof.gov.kw · tax.gov.kw *(both URLs to be confirmed at verification time)* | Confirm NO_VAT status; any VAT legislative developments; other taxes in force; invoicing practice guidance | REQUIRES_VERIFICATION |
| OM | هيئة الضرائب / Oman Tax Authority | taxoman.gov.om *(baseline domain — verify)* | VAT law + rates + effective dates; invoice requirements; registration thresholds; FAQs | REQUIRES_VERIFICATION |
| QA | هيئة الضرائب العامة / General Tax Authority (GTA) | gta.gov.qa *(baseline domain — verify)* | Confirm VAT-PLANNED status and timeline (if any); **excise tax** scope (goods, rates, mechanics); other taxes; FAQs | REQUIRES_VERIFICATION |
| YE | مصلحة الضرائب / Yemeni tax authority | **URL to be confirmed at verification time** — locate the official portal during the verification visit | Confirm NO_VAT/legacy sales-tax status; any current invoicing requirements; authority name confirmation | REQUIRES_VERIFICATION |
| EG | مصلحة الضرائب المصرية / Egyptian Tax Authority (ETA) | eta.gov.eg *(baseline domain — verify)* | VAT law + rates (+ any schedule rates); e-invoice & e-receipt system specifications, APIs, certificate enrollment; invoice requirements; FAQs | REQUIRES_VERIFICATION |
| JO | دائرة ضريبة الدخل والمبيعات / Income and Sales Tax Department (ISTD) | istd.gov.jo · taxes.gov.jo *(both to be confirmed at verification time — pin the authoritative domain)* | GST law + rates (standard + any reduced); invoice requirements; registration thresholds; FAQs | REQUIRES_VERIFICATION |
| IQ | الهيئة العامة للضرائب / General Commission for Taxes (GCT), وزارة المالية / Ministry of Finance | mof.gov.iq *(URL to be confirmed at verification time)* | Confirm NO_VAT status; proposals status; other taxes in force; invoicing practice guidance | REQUIRES_VERIFICATION |

## 2. What "verify" means per fact type

| Fact type | Evidence to capture |
|-----------|---------------------|
| Tax rate / applicability | Law or official decree reference (number, date) + the page/URL + retrieved date |
| Effective dates | The same law/decretal text defining `effective_from` (and any prior windows for history) |
| E-invoicing regime | Official specification/SDK **version + date**, portal section, sandbox documentation |
| Invoice field lists | The official requirement document (title, version, date) — screenshots/PDF archived |
| Identifier formats | Official format description or published validation rules — never reverse-engineered from examples |
| Thresholds / filing rules | Official guidance page + date |

## 3. Verification log format

Every verification act is recorded (append-only) in the log table below and mirrored into
the seed's `verified_at` / `source_ref` fields
([../../database/SEEDS/README.md](../../database/SEEDS/README.md) rule 2). One row per
fact checked — **not** per country:

```text
date | verifier | country | fact checked | source URL (official) | source version/date | result | actions
```

| date | verifier | country | fact checked | source URL (official) | source version/date | result | actions |
|------|----------|---------|--------------|----------------------|---------------------|--------|---------|
| _(log starts at PHASE-009; no entries yet)_ | | | | | | | |

Rules for the log:

1. `verifier` is a named person/role (two-person rule for e-invoicing adapter gates —
   [../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §3, RISK-005).
2. `result` states the outcome precisely: *confirmed as documented*, *corrected (old →
   new value)*, or *could not verify (fact stays REQUIRES_VERIFICATION)*.
3. Corrections always trigger a pack version bump + seed migration + `CHANGELOG.md`
   entry ([../COUNTRY_PACKS.md](../COUNTRY_PACKS.md) §6).
4. Archived copies (PDF/screenshot of the official page as retrieved) are stored with the
   log entry for auditability; URLs rot, archives don't.
5. Monitoring: after initial verification, the compliance owner re-checks each country's
   official portal on a documented cadence (and on any monitoring alert — RISK-006),
   appending new rows here.
