# NEXT ACTION — post-PHASE-031

PHASE-031 (Healthcare Commercial Shell) is COMPLETE — the third Blueprint
v2.0 stage-10 shell and the register's first "configuration + light
extension" delivery: the single additive `sales_invoices.claim_ref` column
(migration 0042) + the `industry.healthcare` v1.0.0 registry seed (data-only
migration 0043), with the claim lifecycle proven end-to-end (G-01/G-03/
G-24/G-25/G-26 line-asserted; the FEFO dispensing pick; the dishonor
restoring the claim exactly) and the zero-clinical boundary
machine-checked. CURRENT_SHIPPED_PHASE = "PHASE-031" (schema_version 43;
10 shipped industry templates; report registry 81 contracts — §J stayed
closed, the group_by_claim parameter rode the existing contracts;
permissions 245=245; i18n 4,069=4,069 — zero web changes again).

**Next eligible: PHASE-032 (Education Commercial Shell, ED-08)** — per
EXPANSION_REGISTER §B sequencing: 032 needs 015 (the engine) + 027 (the
installments module) COMPLETE — both are (identify only; do not implement
without a fresh phase order). PHASE-033 (Agriculture) is parallel-eligible
after its deps (015 + 018); then PHASE-034 (consolidation — the Enterprise
Depth gate).

Key handoffs from 031 (read the PHASE-031 completion report first):
- The **group_by_claim report parameter** is the pattern 032/033's
  statement/dunning wiring should reuse: a parameter extension on the
  EXISTING PHASE-013 contracts (groups + per-row claim column + subtotals
  that partition the footer ties) — never a new report key (register §J
  stays closed; the report-pack wiring gate enforces it).
- The **claim-ref light-extension pattern** (the register's "configuration +
  light extension" row): ONE additive nullable column whose capture is
  policy-gated on the SETTINGS surface (the L5 override path —
  readEffectiveSetting reads L5 ∪ platform default, so the platform default
  must equal the intended invariant), validated BEFORE the insert so every
  failure path leaves zero residue, plus a bounded grouping read model over
  the existing subledger (the INV-009 partition proof). 032's tuition
  installments and 033's field-project stamps should follow the same shape
  if their phase docs sanction a light extension.
- The **zero-clinical-surface gate** (`healthcare-no-clinical-surfaces.spec.ts`)
  is the model for every vertical boundary claim: machine-check the
  manifests + registries + migration SQL executable text + request
  vocabulary against a forbidden-stem list, with the honest boundary
  phrases exempted ("no clinical data" IS the guard). 032/033 should ship
  the same gate for their out-of-scope claims (e.g. education: no
  academic-records/LMS surface).
- The **capability-matrix reconciliation harness** now carries the HLT
  column (strict, zero mismatches both directions) — 032 adds EDU, 033 adds
  AGR, the same way. The synthetic phase-gate proofs moved to
  `education.students`@PHASE-032 (the §18 lesson-5 relay) — 032 moves them
  to agriculture@PHASE-033.
- The **golden-effective-configs re-pin discipline**: any SETTINGS_REGISTRY
  key wave moves EVERY pin (the platform default lands in every tenant's
  policy map — §18 lesson 5). Compute the new hashes with the
  composeTenantStaticConfig script pattern and record the old→new table in
  agent-ctx (P31-A-claim-ref.md is the 031 record).
- Watch items carried: SF-026-001 (purge vs guards), SF-026-002 (RC-10
  seeded drift DB proof), the 028 ControlGuard first production call-site,
  the 029 "E2" item + payslip print-template deferrals, and the
  environmental runbook item from the 030 report (the documented flaky
  environmental set). Nothing new carried from 031 — the phase closed all
  twelve tasks green.
