# Tax Engine

> **Status:** STABLE · **Owner:** Tax & Compliance Architecture · **Updated:** 2026-10-27

The normative tax computation model. Architecture decision: [ADR-0010](../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md).
Country data and rates: [COUNTRY_PACKS.md](COUNTRY_PACKS.md) and
[compliance-matrix/](compliance-matrix/README.md) — every rate there carries a
verification status and official sources; **nothing in this file hard-codes a country's
numbers** (directive §6, §1.12).

## 1. Concepts (distinct, never conflated — directive §6)

| Concept | Meaning | Examples |
|---------|---------|----------|
| **Tax treatment** | Legal classification of a supply | `STANDARD_RATED`, `ZERO_RATED`, `EXEMPT`, `OUT_OF_SCOPE`, `REVERSE_CHARGE`, `NOT_SUBJECT` |
| **Tenant tax registration** | Tenant's status for a jurisdiction's tax scheme | `REGISTERED`, `NOT_REGISTERED`, `DEREGISTERED` |
| **Jurisdiction VAT applicability** | Whether the jurisdiction operates a VAT scheme | `VAT_IN_FORCE`, `VAT_PLANNED`, `NO_VAT` |
| **Tax code** | Tenant-usable binder: default treatment + current rate for items/document lines | "VAT 15%", "Zero-rated food", "Exempt financial" |
| **Rate snapshot** | Frozen (treatment, rate, jurisdiction, version) stamped on each document line at posting | invoice line stores `tax_snapshot` JSONB |

**Conceptual separations that MUST hold in code and UI:**

- A **zero-rated** supply is taxable at 0% (reportable in VAT return).
- An **exempt** supply is outside VAT scope by law (different return box, no input tax
  recovery on related inputs).
- An **out-of-scope** item is not a supply for VAT purposes at all.
- A **reverse charge** shifts liability to the buyer (imports/cross-border where
  applicable).
- A **not-registered business** may lawfully charge no VAT — documents show no VAT, and
  the engine records `NOT_SUBJECT` so its books remain consistent and its later
  registration transition is clean.
- A jurisdiction **without a VAT scheme** (e.g., Yemen today) runs the whole platform
  with tax fields absent and no VAT postings — other taxes, when implemented, are
  separate pack features, never "VAT with 0%" (directive §6: absence of VAT ≠ absence of
  all obligations).

## 2. Resolution flow (document line → tax lines)

```
Document line (item, qty, unit price, discount)
  → item's default tax code (tenant defaults; overridable per document/partner type)
  → tax code → active treatment + rate at DOCUMENT DATE (from jurisdiction pack version)
  → tenant registration check (registered? then compute; not registered → NOT_SUBJECT)
  → line tax = round(taxable_base × rate, currency minor units, half-up)   [ADR-0009]
  → stamp rate snapshot on the line; accumulate document tax summary by (treatment, rate, tax code)
  → posting engine consumes summary for VAT_PAYABLE / VAT_RECOVERABLE / VAT_EXPENSED lines
```

Determinism: identical inputs (date, code, amounts) always produce identical tax lines —
the engine has no side effects; recomputation of a draft matches the original computation
(golden-dataset tests per pack).

## 3. Versioning and effective dates

- Jurisdiction packs ship **versioned rate tables**: `{country, treatment, rate,
  effective_from, effective_to?, source_ref, verified_at}`. Loading a pack update never
  alters posted documents (snapshots) and warns on drafts spanning a rate change.
- Tenants on the same pack version behave identically; pack upgrades are staged
  (preview → apply) and audited.

## 4. VAT return computation

1. Period + jurisdiction + registration selected → engine aggregates posted documents'
   tax summaries: output tax by treatment/category, input tax (recoverable vs expensed),
   reverse-charge amounts.
2. Cross-check vs GL tax account movements for the period (INV-012) — displayed
   side-by-side; mismatch blocks "ready-to-file" status.
3. Output: bilingual RTL report (draft / ready / filed-by-human statuses with filing
   metadata recorded for audit). The platform **reports**; humans file (no filing API
   claims without verified official integration — see
   [E_INVOICING_ARCHITECTURE.md](E_INVOICING_ARCHITECTURE.md)).

## 5. Configuration surface

| Configurable | Where |
|--------------|-------|
| Tenant tax registrations per jurisdiction | `tax_registrations` |
| Tax codes + defaults per item category | `tax_codes` (tenant) |
| Inclusive/exclusive pricing default | tenant settings (per sales doc override) |
| Tax display on documents (registered vs not) | pack + registration |
| Rounding policy exceptions | pack (rare; default half-up per ADR-0009) |

NOT configurable: treatment semantics, snapshot-on-posting, GL effect mapping logic,
invariant INV-012 (INV-022).

## 6. Testing requirements (per pack)

Each jurisdiction pack ships test fixtures: standard sale, zero-rated sale, exempt sale,
mixed basket, return/credit note, rate-change boundary (document dated before/after),
unregistered-tenant documents. All fixtures assert: line taxes, document summary, and
**expected journal lines** ([../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md)).
Packs with `REQUIRES_VERIFICATION` flags cannot be marked complete without the
verification checklist in their compliance-matrix file.
