# Blueprint Validation Report

> **Status:** STABLE · **Owner:** Platform Architecture · **Validation date:** 2026-10-27

Record of the cross-document validation performed on blueprint v1.0 (directive STEP 9),
re-runnable via `scripts/validate_docs.py` (wired into CI in PHASE-001). This report is
re-run and appended after every phase that changes documentation.

## 1. Automated checks (script: `scripts/validate_docs.py`)

| Check | Method | Result (v1.0) |
|-------|--------|---------------|
| Required inventory (166 required paths from directive §18 structure) | File existence | PASS — all present (202 total markdown files; the first validation pass recorded 201 —
recount corrected this **DEF-009**; post-consolidation inventory lives in
[../CONSOLIDATION_VALIDATION_REPORT.md](../CONSOLIDATION_VALIDATION_REPORT.md)) |
| ADR completeness | ≥ 16 ADR files | PASS — 16 |
| Phase documents | 25 files × 8 mandatory sections + status header + ≥ 200 lines | PASS — 25/25 (exemplars 001/002 expanded; agent-written phases 300–450 lines) |
| Phase-reference consistency | Roadmap + dependency graph + acceptance criteria + status reference all PHASE-001…025 (any notation form) | PASS |
| Link resolution | Every relative link resolves to an existing file | PASS — 0 broken (14 found and fixed in v1.0 review pass: wrong relative depths, missing VALIDATION_REPORT, stale ERD→TABLES pointers) |
| Mermaid/code fences | Balanced code fences (triple-backtick); mermaid blocks well-formed | PASS — 60 diagrams |
| Stub markers | Placeholder-marker scan (quotes-aware) | PASS (two false-positives reviewed: "coming soon" is legitimate onboarding UI copy; INV-000123 examples are invoice numbers, not invariant IDs — check refined) |
| Registry integrity | INV-001…022, BR-001…040, RISK-001…022 referenced anywhere are defined in their registries | PASS — 22 invariants (referenced across 23 docs), 40 rules, 22 risks |
| Terminology spot checks | banned bigserial column specs, common misspellings | PASS — zero occurrences in type positions (uppercase BIGSERIAL appears only in ADR-0006's rejected-alternatives table) |
| Status headers | Every living doc carries a Status line | PASS |

## 2. Manual consistency review performed (v1.0)

| Area | Review | Resolution |
|------|--------|------------|
| Phase-numbering drift | Subagent cross-reports flagged: ADR-0012 (POS subset), DEPLOYMENT_ARCHITECTURE (client phases), OQ-004 (ZATCA phase), OBSERVABILITY (sync health phase), MODULE_BOUNDARIES (configuration module phase + sync tables) | All corrected to roadmap canon: POS=016, sync=020, desktop=021, android=022, ZATCA impl=023, configuration engine=015 |
| Permission-key drift | FEATURE_CATALOG permission column vs AUTHORIZATION_MATRIX (POS/template/BOM/settlement/device keys) | Normative reconciliation note added to FEATURE_CATALOG: AUTHORIZATION_MATRIX is canonical; phases must reconcile in-PR |
| 29-items vs 8-sections | Directive §19 lists 29 mandatory items; template renders 8 sections | Mapping table added to implementation/README.md; template comment corrected — all 29 items covered, CI-validated |
| PHASE_ACCEPTANCE_CRITERIA.md | File was found missing during the build (write anomaly) | Re-authored and verified present; referenced consistently by roadmap, protocol, and phases |
| Dangling spec pointer | E_INVOICING_ARCHITECTURE → TABLES/tax-compliance.md | File created (tax/compliance column specs); ERD pointers corrected to the per-phase TABLES sync rule |
| Directive STEP-9 checklist | Contradictory decisions / missing prerequisites / undefined terms / inconsistent entity names / missing relationships / missing authorization / missing accounting effects / unsupported regulatory claims / circular phase dependencies / features without tests / reports without sources / offline workflows without conflict policies / modules without ownership | Each verified: decisions in ADRs + decisions/; prerequisites per phase doc §3; glossary defines terms; entity names catalog-driven; relationships + write-matrix in database/MODULE_BOUNDARIES docs; authorization matrix covers modules; posting rules cover every operation (POSTING_ENGINE §4 + ACCOUNTING_TESTS golden tests); compliance claims all carry REQUIRES_VERIFICATION (no unsupported claims); dependency graph acyclic (script-verified structure); every feature maps to phases with acceptance criteria; every report in REPORT_CATALOG has a source-of-truth; offline operations carry per-entity conflict policies; every module has owned tables + published services |

## 3. Residual known limitations (honest statement)

1. Tax rates and regulatory statuses are BASELINE_RESEARCH only — every compliance
   fact carries REQUIRES_VERIFICATION + official source; verification occurs in
   PHASE-009 (packs) and PHASE-023 (integrations). No compliance claim is made.
2. Plan limits/pricing are PLACEHOLDER pending OQ-002; payment provider pending OQ-003;
   ZATCA scope pending OQ-004 / DR-001. All are decision records, none block phases.
3. TABLES/ specs exist for tenancy-identity, core-accounting, and tax-compliance;
   remaining clusters (trade/inventory/treasury) intentionally land per-phase per the
   database README sync rule (no speculative columns — directive §23 STEP 4).
4. Docs describe a **designed** system: nothing is implemented, tested, or verified
   until phases complete with evidence (see CURRENT_STATE.md).

## 4. Re-validation protocol

- `scripts/validate_docs.py` must exit 0 in CI (PHASE-001 wires it).
- Every phase completion report must include a re-run of the script + a line here (or a
  linked delta) if it found and fixed issues.
- Manual review checklist (§2) is re-run when any ADR, roadmap edge, or phase scope
  changes.

## 5. Blueprint v2.0 expansion re-validation (2026-10-28)

The v2.0 expansion (platform depth & breadth — [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md)
ED-01…ED-19) was applied on top of the v1.1 baseline and re-validated:

- `scripts/validate_docs.py` upgraded per register §N (phase range 001–034, 13 manifests,
  ADR set 0001..0018, six new structural checks 4d–4i for expansion artifacts) and exits 0:
  **29/29 checks passed** over **240 markdown documents** (the v1.1 snapshot of
  202 total markdown files recorded above remains the historical baseline statement).
- **THE RESTORATION MERGE (2026-11-09):** the lost stage-9/10 lineage (PHASE-028–031) was
  restored from the uploaded `ERP_PLATFORM_PHASE031.zip` and merged onto the PHASE-034 head —
  the final consolidation uniting PHASE-001…034 in one build (see
  [../implementation/phases/reports/PHASE-034-FINAL-RESTORATION.md](../implementation/phases/reports/PHASE-034-FINAL-RESTORATION.md)).
  The merged `docs/` corpus now counts **316 markdown files** (the restored lineage's
  completion reports, industry templates, and planning docs united with the surviving
  lineage's); the historical baseline statements above stay as recorded snapshots of their
  own validation runs.
- v2.0 additions: 9 phase documents (PHASE-026…034, stages 9–11) all carry the 8 canonical
  headings; 6 modules / 38 feature keys (catalog 125 → **163 keys, 16 → 22 modules**);
  23 new catalog entities; 22 new enums; 16 CoA purposes; goldens G-21…G-32; invariants
  INV-023…026; rules BR-041…056; 17 report keys (catalog 50 → **67**); 5 industry
  templates (8 → **13**, manifests extracted 13/13 OK); decision records DR-002…DR-006
  (accounting) + DR-003 (product) + ADR-0018, all ACCEPTED and indexed.
- Safeguards re-verified: MVP (PHASE-014) and GA (PHASE-025) gates unchanged; accounting
  invariants INV-001…022 and posting-engine monopoly untouched (all v2.0 postings via
  `PostingEngine.post`); folders 1/2/4 reference archives byte-untouched; consolidation
  requires zero cross-tenant writes (ADR-0018).
- The v2.0 scope remains **designed, not implemented**: every new phase is `PLANNED`
  until executed with evidence per IMPLEMENTATION_STATUS.md.


## Re-run — PHASE-025 (GA release) · 2026-11-06

Post-phase validation with the GA tree: **docs:validate 29/29 green** (303 markdown
documents — the blueprint + the phase reports, the GA checklist, the DR/deployment
drill records, the seven post-GA decision stubs, and the bilingual release notes all
link-resolved). The cross-document consistency facts re-verified at the gate:
permissions seed = AUTHORIZATION_MATRIX (244=244, zero new keys — PHASE-025 §4),
capabilities matrix vs implemented gates agree (25 PASS rows), the phase tables
(roadmap + status + dependency graph) reference PHASE-001…025 consistently with
PHASE-025 COMPLETE — GA RELEASE, and the GA gate criteria are enumerated closed in
[GA-RELEASE-CHECKLIST.md](../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
with gate-run evidence (1 INFRA-GATED / 5 CLOSED-LOCAL-TIER / 5 CLOSED — the honest
ledger). Entity catalog unchanged (156 tables; no migrations this phase — tuning
only per §4).
