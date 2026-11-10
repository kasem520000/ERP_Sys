# Compliance Matrix

> **Status:** STABLE · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-11-05

The **compliance feature registry** (directive §6): one file per jurisdiction recording
every regulatory fact the Platform relies on, its official source, and its verification
state. Nothing in the Platform may be *implemented* from a fact that is not registered
here, and nothing may be *claimed* (compliance, certification, authority approval)
without the evidence recorded here. Companion documents:
[TAX_ENGINE.md](../TAX_ENGINE.md) (computation model),
[E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) (integration regimes),
[COUNTRY_PACKS.md](../COUNTRY_PACKS.md) (pack spec), and the source directory
[../official-sources/README.md](../official-sources/README.md).

## 1. Registry rules

Every compliance feature — a rate, an invoice field requirement, a numbering rule, an
e-invoicing regime, an identifier format — records **all** of:

| Field | Meaning |
|-------|---------|
| Jurisdiction | ISO-3166 alpha-2 country (pack-scoped) |
| Official source references | Government portal/law/guideline URL(s) actually consulted |
| Effective date | When the rule applies (`effective_from`, with `effective_to` when superseded) |
| Version | Pack version + source document version/date the fact was taken from |
| Test scenarios | Fixtures that must pass before the pack is `VERIFIED` ([TAX_ENGINE.md](../TAX_ENGINE.md) §6) |
| Implementation status | Ladder below |
| Known limitations | Explicit list of what is *not* asserted / not covered |

Supplementary registry rule (adopted from Folder 4, consolidation 2026-10-28): **no
marketing, onboarding, in-app, or documentation copy may claim "VAT compliant",
"ZATCA compliant", or any authority certification for a jurisdiction whose row here is
not `VERIFIED` (or higher on the ladder) at the time of the claim.** Compliance claims
are surfaced in-product only from the matrix status itself (e.g., a pack-details screen
quoting the row), never from static copy. Violations are treated as documentation defects
with the same severity as an incorrect rate.

## 2. Status ladder

```
BASELINE_RESEARCH → VERIFIED → IMPLEMENTED → TESTED
```

| Status | Meaning | Gate to next |
|--------|---------|--------------|
| `BASELINE_RESEARCH` | Research-date knowledge recorded, **not yet checked** against official sources — carries `REQUIRES_VERIFICATION` | Verification protocol (§4) executed; `verified_at` + verifier recorded |
| `VERIFIED` | Checked against the official source, pinned to a source version/date | Pack shipped in [PHASE-009](../../implementation/phases/PHASE-009.md) (or adapter in [PHASE-023](../../implementation/phases/PHASE-023.md)) |
| `IMPLEMENTED` | Pack/feature shipped in a release | Full fixture suite green |
| `TESTED` | Fixtures + golden datasets + (for adapters) sandbox evidence pass | — |

Downgrades are allowed and mandatory: a monitoring alert or law change flips the affected
fact back to `REQUIRES_VERIFICATION` (RISK-006) and opens a pack version bump
([COUNTRY_PACKS.md](../COUNTRY_PACKS.md) §6).

## 3. Fact-table column convention

Every fact table in the country files uses exactly these columns:

`aspect | value | status | official source to verify | verification phase`

- **status** is `VERIFIED_BASELINE` or `REQUIRES_VERIFICATION`:
  - `VERIFIED_BASELINE` is reserved for **non-legal, published-standard facts**
    (ISO-3166 codes, ISO-4217 currency minor units, IANA time zones) — checked against
    the standard itself, seeded in [PHASE-002](../../planning/MASTER_ROADMAP.md).
  - `REQUIRES_VERIFICATION` is the default for **every regulatory fact** (rates,
    applicability, regimes, effective dates, legal field lists, identifier formats,
    thresholds) — regardless of how "well known" it is. Research-date knowledge is a
    starting point, never an assertion.
- **verification phase**: `PHASE-009` for pack facts (rates, invoice requirements,
  identifiers, formats); `PHASE-023` for e-invoicing integrations (regimes, legal payload
  fields, certificate flows); `PHASE-002` for standards seeds.

## 4. Verification protocol

| Question | Answer |
|----------|--------|
| **Who verifies** | A named compliance owner (role, recorded per fact) with product-owner sign-off for anything affecting invoice legality; two-person rule for e-invoicing adapter gates (RISK-005) |
| **Against what** | Official government sources **only** — the directory in [../official-sources/README.md](../official-sources/README.md); third-party blogs, consultancies, and news articles are never acceptable as evidence (they may only *point* to the official source) |
| **When** | Pack facts: during [PHASE-009](../../implementation/phases/PHASE-009.md) before a pack may ship as `VERIFIED`. E-invoicing specs: during [PHASE-023](../../implementation/phases/PHASE-023.md) before any adapter code is written. Continuously thereafter: official-source monitoring (RISK-006) with a documented review cadence per country, recorded in the verification log |
| **How recorded** | Three places, always together: (1) the country file's fact table flips to verified with source URL + date; (2) the seed row gets `verified_at` + `source_ref` ([../../database/SEEDS/README.md](../../database/SEEDS/README.md) rule 2); (3) a row in the verification log ([../official-sources/README.md](../official-sources/README.md) §log) — e-invoicing adapter gate items ([E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md) §3) are recorded in the dedicated gate log ([verification-log.md](verification-log.md)) |

**Hard rules:**

1. A `REQUIRES_VERIFICATION` fact blocks the dependent feature from `VERIFIED`/`TESTED`
   status — it may ship only as an explicit `UNVERIFIED` stub that refuses the regulated
   action (never a guess — RISK-005).
2. Verification is per fact, not per country: verifying the standard rate does not verify
   invoice field lists; each keeps its own row.
3. The Platform **reports** (VAT return, archives); humans file. No filing or
   authority-submission claims without a verified official integration
   ([TAX_ENGINE.md](../TAX_ENGINE.md) §4).

## 5. Registry index

| Jurisdiction | File | Regime (baseline research) | Pack status |
|--------------|------|----------------------------|-------------|
| Saudi Arabia (SA) | [sa.md](sa.md) | VAT in force; ZATCA e-invoicing mandatory | BASELINE_RESEARCH — pack in PHASE-009 |
| UAE (AE) | [ae.md](ae.md) | VAT in force; e-invoicing planned | BASELINE_RESEARCH — pack in PHASE-009 |
| Bahrain (BH) | [bh.md](bh.md) | VAT in force | BASELINE_RESEARCH — pack in PHASE-009 |
| Kuwait (KW) | [kw.md](kw.md) | No VAT (proposals exist) | BASELINE_RESEARCH — pack in PHASE-009 |
| Oman (OM) | [om.md](om.md) | VAT in force | BASELINE_RESEARCH — pack in PHASE-009 |
| Qatar (QA) | [qa.md](qa.md) | No VAT (planned); excise exists on some goods | BASELINE_RESEARCH — pack in PHASE-009 |
| Yemen (YE) | [ye.md](ye.md) | No VAT regime; legacy sales-tax concepts | BASELINE_RESEARCH — pack in PHASE-009 |
| Egypt (EG) | [eg.md](eg.md) | VAT in force; ETA e-invoicing mandatory (phases) | BASELINE_RESEARCH — pack in PHASE-009 |
| Jordan (JO) | [jo.md](jo.md) | GST in force | BASELINE_RESEARCH — pack in PHASE-009 |
| Iraq (IQ) | [iq.md](iq.md) | No VAT (proposals exist) | BASELINE_RESEARCH — pack in PHASE-009 |

E-invoicing overview (all countries): [../E_INVOICING_ARCHITECTURE.md](../E_INVOICING_ARCHITECTURE.md).
Tax computation model: [../TAX_ENGINE.md](../TAX_ENGINE.md). Money precision:
[../CURRENCY_AND_PRECISION.md](../CURRENCY_AND_PRECISION.md).

## 6. Maintenance

- Any phase touching tax, invoices, or integrations re-checks the affected country files
  at exit ([../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) scope
  discipline).
- Law changes: flip statuses (§2), bump the pack version
  ([COUNTRY_PACKS.md](../COUNTRY_PACKS.md) §6), update seeds with a verification record,
  note in `CHANGELOG.md`.
- This registry is part of the audit surface: it must never contain an un-sourced
  assertion (NFR-004; INV-022's spirit applied to compliance data).
