# GCC E-Invoicing Readiness Matrix

> **Status:** STARTED (PHASE-037) — **completed by PHASE-063** per
> [COMPLETENESS_REGISTER.md](../planning/COMPLETENESS_REGISTER.md) CR-33 · **Owner:** Tax &
> Compliance Architecture · **Updated:** 2026-11-10
> **Evidence base:** DF-54 ([../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md))
> · [PHASE-037](../implementation/phases/PHASE-037.md) (the KSA Phase-1 delivery) ·
> [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md)
> · the jurisdiction compliance matrices
> ([../localization/compliance-matrix/](../localization/compliance-matrix/README.md))

The single place that answers, per GCC jurisdiction: *what does the platform actually do
today, what is staged, and what is honestly unknown*. Two standing rules bind every row:

1. **RISK-005 no-fabrication**: no regime fact, date, threshold, or format is asserted
   without a verified official source. Every unverified cell carries
   `REQUIRES_VERIFICATION` — the same discipline as the compliance matrices (research-date
   baseline knowledge; nothing reaches `VERIFIED` until the verification protocol
   completes against the authority's official publications).
2. **BR-061 honest vocabulary** ([../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)):
   an adapter state column may only claim what the code does. Phase-1 generation is pure
   computation; no clearance/reporting/acceptance claim exists before an adapter passes
   the [GATE-1..4 discipline](../decisions/compliance/GATE-DISCIPLINE-ZATCA.md).

## 1. The matrix

| Country | Regime status | Phase-1 generation | Phase-2 clearance | Adapter state | Notes |
|---------|---------------|--------------------|-------------------|---------------|-------|
| **SA** (Saudi Arabia) | VAT in force (`VAT_IN_FORCE`, sa.md) | **GENERATION LIVE** — PHASE-037: the TLV-base64 QR payload (five mandated fields, tags 1..5), the per-device ICV counter + PIH hash chain (INV-027), the fail-closed B2C guard (BR-060), and a scannable QR image in the print templates | **STAGED for PHASE-054** — CSID lifecycle, UBL 2.1 digest (re-derives the walk under a new `invoice_hash_version`), XAdES signing, clearance/reporting APIs | `ZatcaGenerationAdapter` — `GENERATED`/`FAILED` only (BR-061); `submit()` is a typed `ZATCA_PHASE2_NOT_IMPLEMENTED` refusal carrying the unmet GATE-1..4 pack | Phase-2 is gated on the GATE-1..4 verification discipline (preserved from PHASE-023 — [GATE-DISCIPLINE-ZATCA.md](../decisions/compliance/GATE-DISCIPLINE-ZATCA.md)); the wave/threshold question stays with DR-001 ([../decisions/compliance/DR-001-zatca-scope-and-timing.md](../decisions/compliance/DR-001-zatca-scope-and-timing.md), OPEN) |
| **BH** (Bahrain) | VAT in force (`VAT_IN_FORCE`, bh.md) | Not applicable yet — no verified Phase-1 mandate at the research baseline | Not applicable yet | No adapter — the payload builder produces compliance-ready archives labeled **non-authoritative** (E_INVOICING_ARCHITECTURE §5) | The National Bureau for Revenue's e-invoicing initiative is a monitored planning signal — **REQUIRES_VERIFICATION** (nbr.gov.bh): mandate status, regime shape, and dates are **not asserted here** |
| **KW** (Kuwait) | No VAT in force at the research baseline (kw.md) | Not applicable — no VAT, no verified e-invoicing mandate | Not applicable yet | No adapter — the no-VAT pack ships standard invoicing only | Any e-invoicing initiative (Ministry of Finance — mof.gov.kw TBC) is **REQUIRES_VERIFICATION**; the pack's VAT status itself must be re-verified before launch (kw.md) |
| **OM** (Oman) | VAT in force (`VAT_IN_FORCE`, om.md) | Not applicable yet — no verified Phase-1 mandate at the research baseline | Not applicable yet | No adapter — compliance-ready archives labeled non-authoritative (E_INVOICING_ARCHITECTURE §5) | The Tax Authority's e-invoicing initiative is a monitored planning signal — **REQUIRES_VERIFICATION** (taxoman.gov.om): mandate status, regime shape, and dates are **not asserted here** |
| **QA** (Qatar) | VAT planned (`VAT_PLANNED` — no rate rows exist to assert, qa.md) | Not applicable — no VAT in force, no verified e-invoicing mandate | Not applicable yet | No adapter — the pack behaves NOT_SUBJECT until a verified version ships | Any General Tax Authority e-invoicing initiative is **REQUIRES_VERIFICATION** (gta.gov.qa); the VAT introduction itself carries no asserted date (qa.md) |
| **AE** (UAE) | VAT in force (`VAT_IN_FORCE`); the pack carries the e-invoicing slot `VAT_PLANNED_EINVOICING` (ae.md) | Not applicable yet — the announced program is not a verifiable mandate at the research baseline | Not applicable yet | Dormant adapter slot (PHASE-023) — refuses submissions until official specs exist | The Ministry of Finance's e-invoicing program is announced/planned, **not yet mandatory as of the research date** — **REQUIRES_VERIFICATION** (mof.gov.ae + tax.gov.ae); regime details, format, and dates come from official publications only (ae.md) |

Matrix reading: "generation live" means the artifact is computed and printed/scannable —
it is **never** a claim that an authority received or accepted anything. Only the SA row
has a live leg; every other row is planning-state and stays that way until a phase
completes the verification protocol against official sources.

## 2. REQUIRES_VERIFICATION register (Phase-1 specifics)

The KSA Phase-1 delivery (PHASE-037) pinned the ZATCA-documented **sample** encodings for
the five mandated TLV fields as unit vectors — the parts of the spec a sample can prove.
Every Phase-1 detail that could NOT be verified against an official sample is registered
below, exactly per the phase's §7 risk discipline. None of these blocks the Phase-1
generation (the mitigation is in code), and each is a PHASE-054 resolution item.

| # | Spec detail | Why it could not be verified this phase | Status | Mitigation delivered (PHASE-037 §7) |
|---|-------------|------------------------------------------|--------|--------------------------------------|
| RV-1 | **TLV sample equivalence beyond the documented samples** — the sample vectors prove the encoder for the documented field values; the full ZATCA field-level validation rules (lengths, character-set edge cases, tag ordering nuances beyond the samples) were not verifiable against an official sample set | No official sample corpus beyond the documented encodings was available to pin | REQUIRES_VERIFICATION (resolves in PHASE-054 with the official spec/SDK pinned — GATE-1) | Pinned unit vectors for the documented samples (`zatcaDocumentedSampleFields()`); `PAYLOAD_SPEC_VERSION` = `phase1-tlv-v1` — any future delta re-versions the payload marker, never silently rewrites |
| RV-2 | **Non-SAR currency semantics in the QR amount fields** — the five mandated fields carry the invoice total incl. VAT and the VAT amount "in SAR"; the semantics for a multi-currency document (what a non-SAR invoice must embed) are not covered by the pinned samples | The documented samples are single-currency (SAR); the official rule for foreign-currency invoices was not verifiable this phase | REQUIRES_VERIFICATION (resolves in PHASE-054 with GATE-4 legal review) | The digest and payload carry version markers; the chain re-derivation path is documented — a semantic correction is a versioned change, not a history rewrite |
| RV-3 | **Timestamp timezone nuance** — the QR timestamp field is an ISO-8601 instant; the exact timezone expectations of ZATCA readers (local KSA time vs UTC vs offset-carrying instants) beyond the sample forms are not verifiable from samples alone | The samples pin the format, not the authority's timezone enforcement behavior | REQUIRES_VERIFICATION (resolves in PHASE-054 — GATE-2 sandbox evidence) | The stamp uses the invoice's STORED `posted_at` rendered as an ISO-8601 instant (`zInstantOf`); the digest serialization is version-marked (`invoice-hash-v1`) with the documented re-derive path so a timezone-semantics fix in 054 re-derives the walk without breaking PIH links |

Register rules: a REQUIRES_VERIFICATION item never silently becomes verified — the
resolving phase records the official source and evidence in the compliance-matrix
verification log
([../localization/compliance-matrix/verification-log.md](../localization/compliance-matrix/verification-log.md))
and flips the flag in this table with a dated note.

## 3. What completes this document (PHASE-063 · CR-33)

- JoFotara (Jordan) row and any verified GCC regime deltas — the matrix gains rows as the
  jurisdiction packs verify (BH/KW/OM/QA/AE regime facts re-verified against official
  sources; flags flipped with evidence, not assumed).
- Phase-2 status for SA after PHASE-054 (the clearance/reporting leg + GATE-1..4 evidence
  or the honest NOT_DELIVERED state).
- Egypt ETA (054) and any non-GCC rows the register extends — out of scope here until
  their phases run.

Until then this document is **STARTED**: the SA Phase-1 row is the only live claim, and
every other cell is either staged, dormant, or flagged.
