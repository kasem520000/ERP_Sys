# NEXT ACTION — post-PHASE-037

PHASE-037 (ZATCA Phase-1 & QR Compliance) is COMPLETE — the audit's H-01
verdict resolved: Saudi Phase-1 e-invoicing is pure mathematical encoding and
now ships with ZERO external APIs. Migration `0050_zatca_phase1.sql`
(schema_version 50) carries the seven additive NULLABLE sales_invoices chain
columns + the RLS'd `zatca_devices` registry; the post-transaction stamping
mints the per-device ICV under a row lock and links PIH to the predecessor's
stored hash (genesis = base64(SHA-256(ASCII "0"))); the verification walk
re-derives every digest and fails closed; the backfill is issuance-ordered,
dry-run-first, idempotent, with the negative ledger proof; BR-060 fail-closed
guards issue+print (enrollment = the device registry); the adapter is the
honest `ZatcaGenerationAdapter` (GENERATED/FAILED only — BR-061) and the
print templates render a REAL scannable QR (H-02 closed, decoded back to the
exact stored payload in-test). CURRENT_SHIPPED_PHASE = "PHASE-037"
(schema_version 50; permissions 249=249; i18n 4,536=4,536; ENTITY_CATALOG
204 domain rows; DB suite 2,407/2,407; docs 32/32; typecheck/lint 8/8). The
working record is `agent-ctx/P37-zatca-phase1.md`; the completion report is
`docs/implementation/phases/reports/PHASE-037-COMPLETION.md`.

**Next eligible: PHASE-038 (Procurement Sourcing & Supplier Collaboration,
CR-08)** — prerequisites: PHASE-035 COMPLETE ✓ (the hard ordering rule holds
on the sequential lineage 035 → 036 → 037 → 038); PHASE-037 is a parallel-safe
sibling, not a prerequisite. Start with
`docs/implementation/phases/PHASE-038.md` (RFQ → supplier quotes → the award
matrix → award-generated POs; blanket agreements, scorecards, approved vendor
lists, CAPEX requests, supplier advances — journal 50 → 54).

Key handoffs from 037 (read the PHASE-037 completion report first):
- **The enrollment-gated guard pattern**: BR-060's compliance switch is the
  device registry (an opt-in enrollment act), so unenrolled tenants keep
  their exact pre-037 behavior. Any future jurisdiction surface (Egypt ETA
  in 054, JoFotara in 063) should reuse the shape: feature entitlement + an
  explicit registry row as the engagement switch + fail-closed typed guards
  only AFTER enrollment.
- **The chain-stamp pattern**: stamps ride the document's own post
  transaction (never a separate UoW), computed AFTER the numbering bind so
  the digest carries the official number, over the STORED timestamps (the
  verification walk re-derives from the rows — clock drift is chain death).
  Counters mint under SELECT FOR UPDATE with a partial UNIQUE DB floor.
- **The backfill pattern**: additive NULLABLE columns + issuance-ordered
  dry-run-first backfill (posted_at, created_at, id tie-break) + idempotent
  re-runs + the negative ledger proof — reuse for any retroactive column
  family.
- **Honesty discipline**: the adapter vocabulary is GENERATED/FAILED only;
  the Phase-2 surface is a typed NOT_IMPLEMENTED with the preserved GATE-1..4
  checklist attached (`GATE-DISCIPLINE-ZATCA.md`); registration status stays
  NOT_REGISTERED until 054. The GCC readiness matrix
  (`docs/tax/GCC_EINVOICING_READINESS.md`, DF-54) carries the
  REQUIRES_VERIFICATION register — 063 completes it.
- **The print-template version bump discipline**: a visual template change
  bumps PRINT_TEMPLATE_VERSIONS (037 moved a4-document/receipt-80/58 → v2)
  and updates the version-freeze spec in the same PR.
- Watch items carried: SF-026-001 (purge vs guards), SF-026-002 (RC-10
  seeded drift DB proof), the 028 ControlGuard first production call-site,
  the 029 "E2" item + payslip print-template deferrals, the 030
  environmental runbook item, and the 037 environmental item (the crm
  task-sweep mail-capture race under peak suite load — recorded, passes in
  isolation). For 054: the chain columns, `zatca_devices`, the
  `invoice-hash-v1` re-derive path, and the GATE-1..4 record are the exact
  substrate the clearance integration extends.
