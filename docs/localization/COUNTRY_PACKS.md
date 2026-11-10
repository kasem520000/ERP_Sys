# Country Packs (Jurisdiction Packs)

> **Status:** STABLE · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

The specification of **jurisdiction packs** — the versioned configuration that makes the
Platform operate correctly in a country without hard-coding that country into the core
([ADR-0010](../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md)). The core tax model
(treatments, registrations, codes, snapshots) is defined in
[TAX_ENGINE.md](TAX_ENGINE.md); e-invoicing integration in
[E_INVOICING_ARCHITECTURE.md](E_INVOICING_ARCHITECTURE.md). **Integrity rule:** every
regulatory value in a pack is research-baseline knowledge carrying a
`REQUIRES_VERIFICATION` status with its official source
([compliance-matrix/](compliance-matrix/README.md),
[official-sources/README.md](official-sources/README.md)); a pack cannot be released as
`VERIFIED` until that protocol completes. Packs are seeded in
[PHASE-009](../implementation/phases/PHASE-009.md) as the `jurisdictions` +
`jurisdiction_tax_rates` seed sets ([../database/SEEDS/README.md](../database/SEEDS/README.md)).

## 1. What a pack is — and is not

| A pack IS | A pack is NOT |
|-----------|---------------|
| Versioned configuration (data + descriptor) per country | Code with `if country == X` branches |
| The single source of rates, formats, invoice requirements, and regime status for a country | A tenant-editable settings bag — legal values are read-only (SEEDS rule 4) |
| Reactive to law changes via version bumps and staged rollout | A retroactive editor of posted documents — snapshots protect history ([TAX_ENGINE.md](TAX_ENGINE.md) §3) |
| A contract consumed by tax, sales, purchasing, print, and reports modules | A compliance *attestation* — verification evidence lives in [compliance-matrix/](compliance-matrix/README.md) |

## 2. Pack schema (JSON)

Canonical shape (stored as a versioned JSONB descriptor + normalized rate rows; the JSON
below is the authoring/ interchange form). Example shows KSA-typical values as **baseline
research** — every regulatory field carries `verification.status`:

```json
{
  "country_code": "SA",
  "country_name": { "en": "Saudi Arabia", "ar": "المملكة العربية السعودية" },
  "pack_version": "1.0.0-baseline",
  "currency": { "code": "SAR", "minor_units": 2 },
  "vat_status": "VAT_IN_FORCE",
  "default_language": "ar",
  "supported_languages": ["ar", "en"],
  "fiscal_calendar_convention": {
    "calendar": "GREGORIAN",
    "fiscal_year_start_month": 1,
    "period_granularity": "MONTH",
    "note": "Hijri is display/search only (assumption A-004)"
  },
  "tax_rates": [
    {
      "treatment": "STANDARD_RATED",
      "rate_percent": "15.0000",
      "effective_from": "2020-07-01",
      "effective_to": null,
      "source_ref": "zatca.gov.sa (baseline research)",
      "verification": {
        "status": "REQUIRES_VERIFICATION",
        "official_source": "https://zatca.gov.sa",
        "verified_at": null,
        "verified_by": null,
        "verification_phase": "PHASE-009"
      }
    }
  ],
  "invoice_requirements": {
    "mandatory_fields": [
      "seller_legal_name", "seller_tax_number", "invoice_date",
      "document_number", "line_description", "line_qty", "line_unit_price",
      "line_net", "line_tax", "currency", "totals"
    ],
    "mandatory_fields_note": "BASELINE commercial set; jurisdiction-specific legal fields are frozen only after official-spec verification",
    "numbering_rules": {
      "platform_rule": "per-tenant/branch/type sequence, assigned at issuance (ADR-0006)",
      "authority_counters": "e.g., ICV stored as compliance payload field, never replacing platform identity",
      "verification": { "status": "REQUIRES_VERIFICATION", "official_source": "https://zatca.gov.sa", "verification_phase": "PHASE-023" }
    },
    "bilingual_requirements": {
      "invoice_language": ["ar", "en"],
      "note": "Arabic required; details frozen per official specs at verification",
      "verification": { "status": "REQUIRES_VERIFICATION", "official_source": "https://zatca.gov.sa", "verification_phase": "PHASE-023" }
    }
  },
  "e_invoicing": {
    "regime": "ZATCA_FATOORAH",
    "adapter_id": "zatca",
    "status": "MANDATORY_IN_FORCE",
    "modes": ["GENERATION", "INTEGRATION_CLEARANCE", "INTEGRATION_REPORTING"],
    "verification": { "status": "REQUIRES_VERIFICATION", "official_source": "https://zatca.gov.sa", "verification_phase": "PHASE-023" }
  },
  "business_identifiers": {
    "vat_registration_number": {
      "label": { "en": "VAT registration number", "ar": "الرقم الضريبي" },
      "format": null,
      "format_note": "format asserted only after verification",
      "verification": { "status": "REQUIRES_VERIFICATION", "official_source": "https://zatca.gov.sa", "verification_phase": "PHASE-009" }
    },
    "commercial_registration": {
      "label": { "en": "Commercial Registration (CR)", "ar": "السجل التجاري" },
      "format": null,
      "verification": { "status": "REQUIRES_VERIFICATION", "official_source": "https://zatca.gov.sa", "verification_phase": "PHASE-009" }
    }
  },
  "address_format": { "order": ["line1", "line2", "city", "district", "postal_code", "country"] },
  "date_format": "dd/MM/yyyy",
  "number_format": { "decimal_separator": ".", "grouping_separator": ",", "digit_default": "latn" },
  "time_zone": "Asia/Riyadh",
  "regulatory_notes": [
    "Baseline research snapshot; all regulatory values REQUIRES_VERIFICATION (compliance-matrix/sa.md)."
  ]
}
```

## 3. Field specification

| Field | Consumed by | Rules |
|-------|-------------|-------|
| `country_code` | pack registry (ISO-3166 alpha-2) | Immutable identity of the pack |
| `pack_version` | lifecycle (§6) | `major.minor.patch`: major = breaking/legal change, minor = new content, patch = corrections |
| `currency`, `minor_units` | treasury, documents, formatting | ISO-4217 seed values ([CURRENCY_AND_PRECISION.md](CURRENCY_AND_PRECISION.md) §2) |
| `vat_status` | tax engine applicability gate | Enum, §4 |
| `default_language`, `supported_languages` | i18n negotiation defaults | [LOCALIZATION_ARCHITECTURE.md](LOCALIZATION_ARCHITECTURE.md) §4 |
| `fiscal_calendar_convention` | provisioning (fiscal year template) | Gregorian at MVP (A-004) |
| `tax_rates[]` | tax engine at document date | Versioned, effective-dated, with `source_ref` + `verification`; loaded into `jurisdiction_tax_rates` seed |
| `invoice_requirements` | sales/purchasing documents + print templates | Mandatory fields + numbering + bilingual rules; legal specifics frozen after verification |
| `e_invoicing` | adapter registry ([E_INVOICING_ARCHITECTURE.md](E_INVOICING_ARCHITECTURE.md)) | Regime descriptor; adapter may be dormant (`NONE`/planned) |
| `business_identifiers` | partner/tenant profiles, print | Labels always; formats only after verification |
| `address_format`, `date_format`, `number_format`, `time_zone` | UI forms, print, i18n | Conventions; display-layer concerns ([RTL_AND_LTR.md](RTL_AND_LTR.md)) |
| `regulatory_notes` | humans | Free-text compliance pointers, never normative by themselves |

## 4. Enumerations

**`vat_status`** (jurisdiction VAT applicability — distinct from treatments, see
[TAX_ENGINE.md](TAX_ENGINE.md) §1):

| Value | Meaning | Examples (baseline research) |
|-------|---------|------------------------------|
| `VAT_IN_FORCE` | VAT scheme operates today | SA, AE, BH, OM, EG (VAT), JO (GST-modeled) |
| `VAT_PLANNED` | Announced/drafted but not in force | QA (no date) |
| `NO_VAT` | No VAT regime identified at research date | KW, YE, IQ |

**`e_invoicing.status`**:

| Value | Meaning | Examples (baseline research) |
|-------|---------|------------------------------|
| `MANDATORY_IN_FORCE` | Regime mandatory today (waves/segments per authority) | SA (ZATCA), EG (ETA) |
| `VAT_PLANNED_EINVOICING` | Announced, not yet mandatory | AE (per [E_INVOICING_ARCHITECTURE.md](E_INVOICING_ARCHITECTURE.md) §5) |
| `NONE` | No regime identified at research date | BH, KW, OM, QA, YE, JO, IQ |

A `NO_VAT` pack still ships fully (formats, identifiers, invoice baseline) — absence of
VAT ≠ absence of all obligations (directive §6): documents print without VAT fields, no
VAT postings occur, and treatments record `NOT_SUBJECT`
([TAX_ENGINE.md](TAX_ENGINE.md) §1).

## 5. Country summary (baseline research — every rate/status REQUIRES_VERIFICATION)

| Country | Currency (minor) | `vat_status` | Standard rate (baseline) | E-invoicing | Default lang | Verify at |
|---------|------------------|--------------|--------------------------|-------------|--------------|-----------|
| [sa.md](compliance-matrix/sa.md) Saudi Arabia | SAR (2) | `VAT_IN_FORCE` | 15% since Jul 2020 | ZATCA FATOORAH: mandatory (Ph.1 Dec 2021; Ph.2 waves since Jan 2023) | `ar` | zatca.gov.sa |
| [ae.md](compliance-matrix/ae.md) UAE | AED (2) | `VAT_IN_FORCE` | 5% since Jan 2018 | Planned (MoF), not mandatory at research date | `ar` | tax.gov.ae |
| [bh.md](compliance-matrix/bh.md) Bahrain | BHD (3) | `VAT_IN_FORCE` | 10% since Jan 2022 (5% from 2019) | None identified | `ar` | nbr.gov.bh |
| [kw.md](compliance-matrix/kw.md) Kuwait | KWD (3) | `NO_VAT` | — (repeatedly proposed, not enacted) | None identified | `ar` | mof.gov.kw / tax.gov.kw |
| [om.md](compliance-matrix/om.md) Oman | OMR (3) | `VAT_IN_FORCE` | 5% since Apr 2021 | None identified | `ar` | taxoman.gov.om |
| [qa.md](compliance-matrix/qa.md) Qatar | QAR (2) | `VAT_PLANNED` | — (planned, no date) | None identified | `ar` | gta.gov.qa |
| [ye.md](compliance-matrix/ye.md) Yemen | YER (2) | `NO_VAT` | — (legacy sales-tax concepts, verify) | None identified | `ar` | Yemeni tax authority (portal TBC) |
| [eg.md](compliance-matrix/eg.md) Egypt | EGP (2) | `VAT_IN_FORCE` | 14% since 2017 | ETA: mandatory phases since 2021 (B2B), e-receipt rolling | `ar` | eta.gov.eg |
| [jo.md](compliance-matrix/jo.md) Jordan | JOD (3) | `VAT_IN_FORCE` (GST) | 16% since 2018 (most goods/services) | None identified | `ar` | istd.gov.jo / taxes.gov.jo |
| [iq.md](compliance-matrix/iq.md) Iraq | IQD (3) | `NO_VAT` | — (proposals exist) | None identified | `ar` | mof.gov.iq (GCT) |

Jordan's GST is *modeled* as VAT (same engine, same treatments); the pack's
`regulatory_notes` record the local naming (ضريبة المبيعات / General Sales Tax) so
documents and reports show correct terminology.

## 6. Pack lifecycle

```
AUTHOR (research + compliance file)
  → VERIFY (against official sources — compliance-matrix protocol; result recorded in seed verified_at/source_ref)
  → VERSION (bump pack_version; changelog; migration ships seed update)
  → STAGE (preview tenant cohort → apply; drafts spanning rate changes warned)
  → AUDIT (pack_version + seed verification record + rollout log retained forever)
```

1. **Authoring** produces: pack JSON, a compliance-matrix file, test fixtures (§8), and
   the official-sources entry — all reviewed together.
2. **Verification** flips `verification.status` to verified *per fact* (rates, formats,
   regimes) with `verified_at` + `verified_by` + URL; un-verifiable facts stay
   `REQUIRES_VERIFICATION` and their features stay stubbed (RISK-005).
3. **Versioning:** packs are immutable per version; changes ship as new versions. A rate
   change = new `tax_rates` row with `effective_from` — never an edit of the old row.
4. **Staged rollout:** tenants move pack versions via preview → apply (tenant admins see a
   diff preview); the platform can hold a tenant on an older pack within a support window.
5. **Never retroactive:** posted documents keep their rate snapshots
   ([TAX_ENGINE.md](TAX_ENGINE.md) §3); drafts spanning an effective-date boundary are
   flagged on open.
6. **Audit:** every pack version's seed migration, verification record, and rollout is
   retained (NFR-004); seed updates carry changelog + verification record
   ([../database/SEEDS/README.md](../database/SEEDS/README.md) rule 2).

## 7. Runtime consumers (who reads what)

| Module | Reads | Effect |
|--------|-------|--------|
| `tax` | `vat_status`, `tax_rates[]`, verification flags | Applicability gate, rate resolution at document date, `NOT_SUBJECT` path for NO_VAT |
| `sales` / `purchasing` | `invoice_requirements`, `vat_status` | Document field sets, VAT sections on/off, bilingual field enforcement |
| `print` | `invoice_requirements`, `bilingual_requirements`, formats | Template direction/locale, mandatory print fields ([RTL_AND_LTR.md](RTL_AND_LTR.md) §2) |
| `treasury` | `currency`, `minor_units` | Accounts, rounding ([CURRENCY_AND_PRECISION.md](CURRENCY_AND_PRECISION.md)) |
| `reporting` | `vat_status`, rates (via snapshots) | VAT return availability/shape per jurisdiction ([TAX_ENGINE.md](TAX_ENGINE.md) §4) |
| `integrations` | `e_invoicing` | Adapter activation/dormancy ([E_INVOICING_ARCHITECTURE.md](E_INVOICING_ARCHITECTURE.md)) |
| `provisioning` | `default_language`, `fiscal_calendar_convention`, `time_zone` | Tenant defaults at onboarding |

## 8. Per-pack test fixtures (mandatory before VERIFIED)

Every pack ships the fixture suite from [TAX_ENGINE.md](TAX_ENGINE.md) §6: standard sale,
zero-rated sale, exempt sale, mixed basket, return/credit note, rate-change boundary,
unregistered-tenant (`NOT_SUBJECT`) documents — plus, for `NO_VAT` packs, the no-VAT-mode
fixtures (no VAT fields, no VAT postings) and, for e-invoicing countries, golden payload
samples gated on verified specs. Fixtures assert line taxes, document summary, and
expected journal lines. Country-specific scenarios are listed in each
[compliance-matrix/](compliance-matrix/README.md) file.

## 9. Adding an 11th country — authoring checklist

1. **Research from official sources only** ([official-sources/README.md](official-sources/README.md)):
   currency + minor units (ISO-4217), VAT applicability and rates with effective dates,
   invoice requirements, identifiers, formats — everything else is `REQUIRES_VERIFICATION`.
2. Author the **compliance-matrix file** (`compliance-matrix/<cc>.md`) using the fact-table
   columns (aspect | value | status | official source to verify | verification phase) and
   the per-country section structure.
3. Author the **pack JSON** (§2) at `pack_version: 1.0.0-baseline` with verification
   blocks on every regulatory fact.
4. Add **seed migrations**: `countries`/`currencies` rows (if missing), `jurisdictions`
   registry row, `jurisdiction_tax_rates` rows with `verified_at: null`.
5. Write the **fixture suite** (§8) with golden expected values — including at least one
   worked rounding example per minor-unit count.
6. Register **official sources** (authority name AR/EN, portal URL to confirm, what to
   verify) in [official-sources/README.md](official-sources/README.md).
7. Run the **verification protocol** ([compliance-matrix/README.md](compliance-matrix/README.md)):
   who, against what, when; record results; flip statuses you can verify; keep stubs for
   what you cannot.
8. Decide **e-invoicing** applicability (usually `NONE` → dormant adapter slot;
   [E_INVOICING_ARCHITECTURE.md](E_INVOICING_ARCHITECTURE.md) §5 payload archives still
   produced, labeled non-authoritative).
9. Stage the **rollout** (§6): preview with design-partner tenants in that country if
   available; then apply.
10. Update [COUNTRY_PACKS.md](COUNTRY_PACKS.md) §5 summary table, the compliance-matrix
    index, and `CHANGELOG.md`.

No core code changes are required for a new country (ADR-0010 consequence); if they seem
necessary, that is a design smell — escalate to a decision record.
