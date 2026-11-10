# GATE-DISCIPLINE-ZATCA — The ZATCA Submission Gate (GATE-1..4)

> **Status:** ACTIVE — all four gates **NOT_VERIFIED** (unchanged since PHASE-023) ·
> **Owner:** Product Owner & Compliance Review · **Established:** PHASE-023 (T3, the
> verification-gate execution task) · **Recorded:** 2026-11-10 (PHASE-037 documents the
> discipline; nothing in it changed) · **Related:**
> [DR-001-zatca-scope-and-timing.md](DR-001-zatca-scope-and-timing.md) (OPEN — the segment
> decision the gates protect) ·
> [../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md)
> §3 (the origin checklist) ·
> [../../localization/compliance-matrix/sa.md](../../localization/compliance-matrix/sa.md)
> (RISK-005 baseline) · PHASE-054 (the phase that must clear them) ·
> [../../product/BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) BR-061

## 1. The four gates

A **ZATCA submission claim** — any code path that sends an invoice artifact toward the
ZATCA authority (clearance of standard invoices, reporting of simplified invoices, CSID
enrollment, certificate operations) — may not exist, ship, or be advertised until all
four gates are evidenced:

| Gate | Item | Evidence required |
|------|------|-------------------|
| **GATE-1** | Official ZATCA specifications/SDK version pinned | The exact spec + SDK versions recorded in the compliance-matrix verification log (source + retrieval date) |
| **GATE-2** | ZATCA sandbox environment exercised | Recorded sandbox runs against the pinned versions (access log, request/response evidence) |
| **GATE-3** | Sample invoices validated against official rules | Sample-invoice validation runs (including the authority's own sample encodings) recorded as evidence |
| **GATE-4** | Legal review of invoice-content requirements | Compliance-reviewer sign-off that the invoice content (fields, language, archiving) matches the current official requirements |

This is the PHASE-023 verification gate checklist
([E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §3) made
explicit. It is the operational form of the folder's hard rule — the no-fabrication gate:
a record cannot waive these gates, not even a product-owner signature
([README.md](README.md)).

## 2. Where the discipline lives in code (PHASE-037 state)

- `apps/api/src/modules/tax/adapters/zatca/zatca-stub.ts` exports
  **`ZATCA_UNMET_GATE_ITEMS`** — the four gates, each `NOT_VERIFIED` — and the adapter's
  `submit()` returns the typed **`ZATCA_PHASE2_NOT_IMPLEMENTED`** refusal carrying that
  pack. Every refusal names exactly which gates are unmet; the refusal is the gate's
  user-visible face.
- **BR-061** ([../../product/BUSINESS_RULES.md](../../product/BUSINESS_RULES.md)): the
  generation vocabulary is `GENERATED`/`FAILED` only (`ZATCA_GENERATION_STATUS_VOCABULARY`,
  grep-pinned by contract tests) — no clearance/reporting/acceptance status can be
  produced before PHASE-054.
- The registry service independently enforces the gate before any adapter call (defense in
  depth — E_INVOICING_ARCHITECTURE §3).
- `zatca_devices.registration_status` is CHECK-constrained to the future lifecycle states
  but the Phase-1 surface writes **`NOT_REGISTERED` only** — the DB admits Phase-2, the
  app never claims it.

## 3. What the gates deliberately do NOT cover: Phase-1 generation

**Phase-1 generation is pure computation and requires no gate.** The external audit's
verdict, which PHASE-037 implements: *"Phase 1 (QR) needs no outside access; it is pure
mathematical encoding"* — its earlier absence was "a decision, not a necessity". The
TLV-base64 QR payload, the invoice hash digest, the ICV/PIH chain, and the scannable QR
image are computed locally with **zero external calls**: no network, no authority, no
sandbox, no certificate. Nothing is sent anywhere, so there is nothing for GATE-1..4 to
verify — demanding sandbox evidence for local arithmetic would be ceremony, not
compliance.

The honest boundary the gates still enforce: a computed QR is a **generation** fact
(`GENERATED`), never an **acceptance** fact. Only when a submission claim appears
(PHASE-054's clearance/reporting integration) do the gates bind — and the audit trail for
that claim is exactly this record plus the refusal pack's live state.

## 4. Resolution path

- **Gates clear (PHASE-054):** each gate's evidence lands in the compliance-matrix
  verification log; `ZATCA_UNMET_GATE_ITEMS` flips item-by-item in the same PR that wires
  the submission surface; DR-001's segment decision (OPEN) governs **which taxpayers** the
  submission claim may be marketed to. A gate that cannot clear blocks submission — the
  refusal vocabulary stays.
- **Gates stay unmet:** the platform remains in the PHASE-037 state — Phase-1 generation
  for every KSA tenant, submission refused typed, no claim made
  ([../../tax/GCC_EINVOICING_READINESS.md](../../tax/GCC_EINVOICING_READINESS.md) tracks
  the jurisdiction matrix).

**Rule of thumb:** *compute freely, claim nothing.* The gates gate claims, not
arithmetic.
