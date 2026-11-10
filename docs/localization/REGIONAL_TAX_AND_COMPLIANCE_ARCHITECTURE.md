# REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE — Country Packs, Tax Engine, and E-Invoicing

> **Status:** STABLE · **Owner:** Localization Architecture · **Updated:** 2026-10-28 (consolidation pass)
> **Authority:** Consolidates regional rules. Normative detail remains in
> [TAX_ENGINE.md](TAX_ENGINE.md), [COUNTRY_PACKS.md](COUNTRY_PACKS.md),
> [E_INVOICING_ARCHITECTURE.md](E_INVOICING_ARCHITECTURE.md),
> [CURRENCY_AND_PRECISION.md](CURRENCY_AND_PRECISION.md), [RTL_AND_LTR.md](RTL_AND_LTR.md),
> [LOCALIZATION_ARCHITECTURE.md](LOCALIZATION_ARCHITECTURE.md),
> [compliance-matrix/](compliance-matrix/), [official-sources/](official-sources/).

## 1. Core vs country-specific separation (binding)

| Belongs to the universal core | Belongs to jurisdiction packs |
|------------------------------|------------------------------|
| Tax treatment model (STANDARD_RATED, ZERO_RATED, EXEMPT, OUT_OF_SCOPE, REVERSE_CHARGE, NOT_SUBJECT) | Actual rates, thresholds, effective dates |
| Tenant tax-registration posture (REGISTERED / NOT_REGISTERED / DEREGISTERED, dated) | Invoice mandatory-field lists, numbering rules |
| Per-line tax snapshotting (immutable at posting) | E-invoicing regime descriptors and adapters |
| Tax summaries per treatment + VAT return data shape | Identifier formats (TRN, VAT no…) and validation regexes |
| Rounding mechanics (per-currency minor units, half-up) | Jurisdiction-specific rounding regulation (rare) |
| NO_VAT mode (packs where VAT does not apply) | Submission lifecycles per authority |

**No country's rule is ever hard-coded in the engine**; KSA 15% VAT is data in the `sa`
pack, not code. The engine resolves treatments at document date via effective-dated rows;
law changes = new rows (`effective_from`), never edits.

## 2. Compliance honesty framework (non-negotiable)

1. **Status ladder per fact:** `BASELINE_RESEARCH → VERIFIED → IMPLEMENTED → TESTED`;
   the compliance matrix (10 country files) records official source URL + retrieval date
   + pack version + test scenarios per fact.
2. **Verification protocol:** per-fact (not per-country), official-sources-only,
   two-person rule for adapters, mandatory downgrade to REQUIRES_VERIFICATION on any
   law-change alert ([compliance-matrix/README.md](compliance-matrix/README.md) §2–4).
3. **Anti-fabrication marketing rule (adopted from Folder 4):** no marketing, onboarding,
   in-app, or documentation copy may claim "VAT compliant", "ZATCA compliant", or any
   authority certification for a jurisdiction not `VERIFIED`+ at claim time
   ([compliance-matrix/README.md](compliance-matrix/README.md) §1 supplementary rule).
4. **UNVERIFIED adapter stubs refuse to execute** — an unverified ZATCA adapter fails
   closed rather than submitting garbage to an authority.
5. Tenant **pack-version pinning was evaluated and REJECTED** (consolidation decision
   CD-007): rates are effective-dated by law, so tenants cannot "pin" an old rate after
   the law changes; pack content is platform-managed and verified — divergence from legal
   reality is never a tenant choice. (This corrects the earlier comparison report's
   adoption suggestion; see CONSOLIDATION_REGISTER CR-2-F2-04.)

## 3. Country coverage (facts recorded, verification ongoing)

| Jurisdiction | VAT posture recorded | E-invoicing posture | Matrix file |
|--------------|---------------------|--------------------|-------------|
| SA | 15% since 2020-07; ZATCA Ph.1 Dec-2021, Ph.2 waves Jan-2023 | Clearance/reporting split, QR TLV, ICV, submission lifecycle | [compliance-matrix/sa.md](compliance-matrix/sa.md) |
| AE | 5% since 2018 | ETA e-invoicing planned — evaluation track | [compliance-matrix/ae.md](compliance-matrix/ae.md) |
| BH | 10% since 2022 (2019 history) | — | [compliance-matrix/bh.md](compliance-matrix/bh.md) |
| EG | 14% + DST exception | ETA B2B/e-receipt evaluation | [compliance-matrix/eg.md](compliance-matrix/eg.md) |
| JO | 16% GST (modeled as VAT with local naming) | — | [compliance-matrix/jo.md](compliance-matrix/jo.md) |
| QA | VAT planned | — | [compliance-matrix/qa.md](compliance-matrix/qa.md) |
| KW / YE / IQ | NO_VAT mode with dedicated operation sections | — | [compliance-matrix/kw.md](compliance-matrix/kw.md), [ye.md](compliance-matrix/ye.md), [iq.md](compliance-matrix/iq.md) |
| OM | NO_VAT (excise noted) | — | [compliance-matrix/om.md](compliance-matrix/om.md) |

3-decimal minor-unit currencies (KWD, BHD, OMR, JOD, IQD) are first-class in precision,
rounding, and printing (tafqit). The verification log is currently empty by design —
entries begin at PHASE-009 pack work; **no fact here is claimed TESTED today**.

## 4. E-invoicing architecture

Adapter contract: prepare → sign → submit → poll, with submission lifecycle
`PENDING → GENERATED → SIGNED → SUBMITTED → ACCEPTED/REPORTED` (+ `REJECTED`, `FAILED`),
authority refs stored per official spec, rejection **does not un-post** the invoice, and
retry/backoff is a pg-boss job ([E_INVOICING_ARCHITECTURE.md](E_INVOICING_ARCHITECTURE.md) §2–3).
ZATCA Phase 2 (clearance vs reporting, UBL-ish payloads, hash, QR TLV-base64, ICV,
certificates) is architected concretely; **wire-level field lists are deferred behind
OPEN decision record [../decisions/compliance/DR-001-zatca-scope-and-timing.md](../decisions/compliance/DR-001-zatca-scope-and-timing.md)**
— claiming ZATCA compliance before verified-spec implementation + authority testing is
prohibited (see §2 rules).

## 5. Localization and RTL

Arabic-first bilingual product: ICU messages with all six Arabic plural categories,
gender-aware select, lint-banned string concatenation; logical CSS properties only with
lint enforcement; per-document print language; Western numerals at MVP with Arabic-Indic
as a formatting option; amount-in-words (tafqit) on financial prints
([../reporting/PRINTING_AND_EXPORT.md](../reporting/PRINTING_AND_EXPORT.md) §2 — adopted
from Folder 1). Rules: [RTL_AND_LTR.md](RTL_AND_LTR.md),
[LOCALIZATION_ARCHITECTURE.md](LOCALIZATION_ARCHITECTURE.md).

## 6. Consolidated corrections in this scope

| ID | Change | Where |
|----|--------|-------|
| DEF-004 | Enum registry: `VAT_PLANNED_EINVOICING`, submission `FAILED` added | [../database/DATA_DICTIONARY.md](../database/DATA_DICTIONARY.md) §9 |
| DEF-003 | E-invoicing retry job phase corrected → PHASE-023 | [../architecture/ADR/ADR-0008-jobs-redis.md](../architecture/ADR/ADR-0008-jobs-redis.md) |
| — | Anti-fabrication marketing rule added (Folder 4) | [compliance-matrix/README.md](compliance-matrix/README.md) §1 |
| — | Tafqit amount-in-words added to financial print spec (Folder 1) | [../reporting/PRINTING_AND_EXPORT.md](../reporting/PRINTING_AND_EXPORT.md) §1–2 |
