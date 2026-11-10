# CONSOLIDATION_VALIDATION_REPORT — Defect Log, Traceability, and Verification Results

> **Status:** STABLE · **Owner:** Platform Architecture · **Validation date:** 2026-10-28
> **Scope:** consolidation pass over the Folder 3 canonical blueprint (adopting audited
> ideas from Folders 1, 2, 4). This report distinguishes rigorously between
> `DOCUMENTATION_VERIFIED` (statements cross-checked against source files),
> `STATIC_CHECK_PASSED` (deterministic script checks executed with observed output),
> `TEST_EXECUTED_AND_PASSED` (product code tested — **none applies; no product code exists**),
> `NOT_TESTED`, and `UNRESOLVED`.
> **No ERP functionality has been implemented or run.** Scripts run here validate
> *documentation* only.

## 1. Working state and preservation

- **Repository:** the four plan folders live outside git tracking under the upload
  workspace; the surrounding project is a git repo on branch `main`, clean except
  unrelated tool artifacts. **No commits or pushes were made** (not authorized).
- **Folder 3 preservation:** original archive `upload/a.zip` (md5 `5e644e9a801c65a381a48d34bc9a6147`)
  is intact, and a full pre-consolidation snapshot was taken at
  `upload/backup-pre-consolidation/3-original` (202 files). All consolidation changes are
  additive or in-place edits to Folder 3 only.
- **Folders 1, 2, 4:** untouched (verified — no writes issued against them; adoptions are
  citations, not moves).
- **Inventory:** Folder 3 grew from 202 to 216 markdown files (+14 consolidated documents)
  plus 8 extracted manifest JSONs and 2 scripts under `scripts/`. Complete file-level
  inventory: [CONSOLIDATION_REGISTER.md](CONSOLIDATION_REGISTER.md) §6.

## 2. Defect log (DEF-001 … DEF-010)

| ID | Sev | File · location | Defect | Consequence if unfixed | Correction applied | Dependent docs updated | Verification |
|----|-----|-----------------|--------|------------------------|--------------------|------------------------|--------------|
| DEF-001 | HIGH | `api/API_CONVENTIONS.md` §7 vs `architecture/ADR/ADR-0009` Consequences | Wire regex conflict: API allowed ≤4 dp for money while ADR-0009's blanket pattern allowed ≤8 dp "for money inputs" | Contracts disagree; a 8-dp amount would validate on the wire then silently round in `numeric(19,4)` — money-precision integrity issue; rates would be rejected by the API pattern | Per-type patterns canonized in API_CONVENTIONS §7 (money ≤4, qty ≤6, rate ≤8 — matching storage); ADR-0009 consequence corrected to defer to §7 | Both files cross-reference each other; DEF note recorded in both | DOCUMENTATION_VERIFIED + STATIC_CHECK_PASSED (checks 3a/3b) |
| DEF-002 | MEDIUM | `architecture/SYSTEM_OVERVIEW.md` C4 diagram L41-42 | Desktop labeled PHASE-022, Android PHASE-023 (canon: 021/022 per MASTER_ROADMAP + DEPLOYMENT_ARCHITECTURE) | Implementers schedule desktop work on the Android phase; validation report's "all corrected" claim stays false | Labels fixed to PHASE-021/PHASE-022 | none further (roadmap already canon) | STATIC_CHECK_PASSED (check 2 label scan) |
| DEF-003 | MEDIUM | `architecture/ADR/ADR-0008` job table | Sync maintenance at PHASE-021, e-invoicing retries at PHASE-024 (canon: 020, 023) | Job scheduling expectations diverge from roadmap phases | Corrected to PHASE-020 / PHASE-023 | none further | STATIC_CHECK_PASSED (canon refs re-verified) |
| DEF-004 | MEDIUM | `database/DATA_DICTIONARY.md` §9 | Enum registry (claimed exhaustive) missing `VAT_PLANNED_EINVOICING` (jurisdictions.vat_status) and submission status `FAILED`, both used in `TABLES/tax-compliance.md` | Status enums drift from registry; CHECK constraints and TypeScript unions disagree with the "single source" registry | Both values added to §9 | REGRESSION_STRATEGY docs-drift rule already binds registry↔schema sync | STATIC_CHECK_PASSED (check 3c) |
| DEF-005 | LOW (no defect) | `database/TABLES/core-accounting.md` L98 | Flagged in audit: `entry_no` nullable vs "assigned at posting, immutable" | — | **Verified NOT a defect:** DRAFT journal rows legitimately exist pre-numbering; the CASCADE note (L121: "draft-entry cleanup only; posted parents are undeletable") confirms draft lifecycle; NULL-while-DRAFT + immutable-at-posting is coherent | none | DOCUMENTATION_VERIFIED (no change; recorded in ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS A-DEF) |
| DEF-006 | MEDIUM | `accounting/CHART_OF_ACCOUNTS.md` §2 vs `testing/ACCOUNTING_TESTS.md` §3 | Purpose-key drift: tests seeded `CASH_BANK`, `ROUNDING`, `OPENING_EQUITY`, `EXPENSE`; catalog had `CASH`, `ROUNDING_GAIN/LOSS`, no opening purpose | Golden tests cannot run against the catalog; opening-balance posting has no target account | `OPENING_EQUITY` purpose added to catalog; tests aligned (`CASH_BANK`→`CASH` ×9 + PHASE-011; `ROUNDING`→`ROUNDING_GAIN/LOSS`; `EXPENSE` annotated as per-document account, no purpose key) | CHART_OF_ACCOUNTS, ACCOUNTING_TESTS, PHASE-011 | STATIC_CHECK_PASSED (checks 3f/3g) |
| DEF-007 | MEDIUM | `security/AUTHORIZATION_MATRIX.md` §3.4 vs `architecture/MODULE_BOUNDARIES.md` | Permission keys `treasury.receipts.*` / `treasury.payments.*` violated the matrix's own rule §1.1 (prefix = owning module; receipts table owned by sales, payments by purchasing) | Seed permissions would mismatch module ownership checks; docs-drift CI rule would fail | Keys renamed `sales.receipts.*` / `purchasing.payments.*`; treasury keeps the money-leg *feature* key `treasury.receipts_disbursements` | AUTHORIZATION_MATRIX, PHASE-008/011/012, FEATURE_CATALOG L204; decision CD-07 | STATIC_CHECK_PASSED (checks 3d/3e — zero residual) |
| DEF-008 | MEDIUM | `industries/templates/README.md` index vs `product/INDUSTRY_CATALOG.md` vs manifests | Template identity spelled three ways (`restaurant_cafe` / `industry.restaurant` / file slug); INDUSTRY_CATALOG pointed to non-existent `manifest.retail.json` files | Config engine cannot resolve canonical ids; dangling pointers | Canonical id = manifest `"id"` (`industry.*`); index rebuilt with machine-id column; 8 manifests extracted to `manifests/*.json` (JSON-validated); all 8 catalog pointers + intro fixed | templates/README, INDUSTRY_CATALOG, manifests/ (new), scripts/extract_manifests.py (new) | STATIC_CHECK_PASSED (checks 1b/3h — 8/8 parse, ids valid) |
| DEF-009 | LOW | `handoff/VALIDATION_REPORT.md` L13 | Recorded "201 total markdown files" (actual: 202; CHANGELOG said 202) | Inventory distrust | Corrected to 202 with DEF note pointing here | none | DOCUMENTATION_VERIFIED (recount performed) |
| DEF-010 | HIGH (latent) | `database/CONSTRAINTS_AND_INDEXES.md` §2 balanced-entry row | Ledger-balance trigger specified as immediate `AFTER INSERT/UPDATE` row trigger — fires on the *first* line of a multi-line posting and aborts valid transactions (a single line never balances) | If implemented as written, **every posting fails at the first journal line** — a build-breaking defect caught before any code existed | Replaced with `CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` (adopted from Folder 4) + mandatory engine-bypass commit-failure test at PHASE-007 | CONSTRAINTS_AND_INDEXES §2, DATABASE_ARCHITECTURE §1.7, ACCOUNTING_ENGINE_SPECIFICATION §1, roadmap PHASE-007 delta, decision CD-09 | DOCUMENTATION_VERIFIED + STATIC_CHECK_PASSED (check 3j) |

**False positives resolved during Stage B (recorded for audit honesty):** DEF-005 (no
defect); the validator's first pass also flagged PHASE-021 L316 as an "android stale ref" —
on re-reading, the sentence correctly lists PHASE-023 as eligible-after-022 (023 also
depends only on 020); the check heuristic was refined, not the document. **Stage-B
corrections to the earlier comparison report:** two recommended adoptions were reversed
after source re-verification — tenant pack-version pinning (F2) REJECTED (CD-06; effective-dated
law-driven packs make pinning legally wrong) and "reconciliation failure = SeV-1" (F4)
ALREADY_COVERED (F3 INCIDENT_RESPONSE §1 already auto-SEV-1s ledger drift). Both are
recorded in the CONSOLIDATION_REGISTER (CR-2-F2-04, CR-4-F4-07) and the decision register.

## 3. Traceability matrix — requirement → decision → specification → phase → acceptance

| Requirement (source) | Decision | Specification | Phase | Acceptance evidence (planned) |
|---|---|---|---|---|
| Double-entry ledger always balances | AD-07, CD-09 (DEF-010) | ACCOUNTING_ENGINE_SPECIFICATION §1; POSTING_ENGINE; CONSTRAINTS_AND_INDEXES §2 | 007 | INV-001/002 battery green; direct-SQL unbalanced insert fails at commit (engine-bypass test) |
| Posting idempotency under retry/sync | AD-07 | ACCOUNTING_ENGINE_SPECIFICATION §2.1 | 007 | `uq_journal_entries_tenant_source_op` + replay tests (ACCOUNTING_TESTS §2) |
| Configuration cannot alter accounting | AD-05/07; INV-022 | ACCOUNTING_ENGINE_SPECIFICATION §3 | 007/015 | Config-fuzz suite: 50 permutations → byte-identical journals |
| Tenant isolation (release-blocking) | AD-05; CD-02, CD-07 | SECURITY_AND_TENANT_ISOLATION §1/§3; TENANT_ISOLATION | 002/003 | A1–A11 generated per-table suites in CI; production RLS-denial canary = 0 |
| Money precision & rounding | AD-09 (DEF-001) | DATABASE_ARCHITECTURE §1.4; CURRENCY_AND_PRECISION | 007/009 | W-1/W-2/W-3 golden examples; regex contract tests (incl. 3-dcimal currencies) |
| Tax localization without engine hard-coding | AD-10; CD-05, CD-06 | REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE §1–2 | 009/016/023 | Per-pack fixture suites; UNVERIFIED stub refuses to execute; verification-log entries |
| ZATCA e-invoicing (honest claims only) | AD-10; NV-01 | E_INVOICING_ARCHITECTURE; DR-001 (OPEN) | 023/024 | Submission-lifecycle tests against sandbox; marketing rule enforced in copy review |
| Industry extensibility | AD-01; CD-08 | INDUSTRY_MODULE_ARCHITECTURE; manifests/*.json | 015/017/018/019 | Manifest schema validation; 7 governance tests per template switch |
| Offline with financial safety | AD-12 | OFFLINE_AND_SYNC_ARCHITECTURE §2/§5 | 016/020 | Chaos suite C-01…C-16 + ledger oracle; per-item push results |
| Unified UI across clients | AD-16; CD-10 | UNIFIED_UI_DESIGN_SYSTEM; DESIGN_TOKENS §3 | 005 | Token/direction lint, AR/EN visual pairs, status-badge binding asserted |
| Reporting tied to the ledger | AD-11; CD-12 | REPORTING_AND_DOCUMENT_ENGINE §2 | 013 | Ledger-tie assertions block output; golden datasets via independent SQL path |
| Financial printing (Arabic-first) | AD-11; CD-03 | PRINTING_AND_EXPORT §1–2 (tafqit) | 013 | Tafqit fixtures per currency incl. 3-dp; PDF text-extraction tests |
| Authn/Authz correctness | AD-15; CD-04 | SECURITY_AND_TENANT_ISOLATION §4; API_IDEMPOTENCY §1.5 | 003 | Login/refresh excluded from key store; replay/rotation tests |
| Costing–picking separation (food/pharma) | CD-11 | INVENTORY_ACCOUNTING §5 | 010 | FEFO-pick + FIFO-cost scenario fixture; negative tests |
| Document lifecycle integrity | AD-06/07 | ACCOUNTING_ENGINE_SPECIFICATION §4 | 006–012 | Lifecycle transition tests; INV-021 numbering uniqueness |
| Evidence-based phase completion | process | IMPLEMENTATION_ROADMAP §1; PHASE_ACCEPTANCE_CRITERIA | all | Completion reports with command-output evidence (protocol unchanged from baseline) |

All acceptance evidence in the rightmost column is **planned, not executed** — the project
remains a blueprint with zero product code (consistent with `planning/IMPLEMENTATION_STATUS.md`).

## 4. Validation checks executed (observed results, 2026-10-28)

Script: `scripts/validate_docs.py` (deterministic, read-only; 23 checks).
Result on the consolidated tree: **23/23 PASS** after the fixes recorded in §2 —
including: all relative links resolve (was 8 broken: 4 awaiting this report, 3 pre-existing
`AGENTS.md` dangling references **found by the validator and fixed** to point at
`handoff/AGENT_START_HERE.md`, 1 duplicate); 8/8 manifests JSON-parse with `industry.*`
ids; PHASE refs within 001–025 and client labels match canon; all DEF/CD markers present;
ADR set 0001–0017 complete; 25 phase documents present. Full console output is reproduced
in the repository worklog; the script itself is rerunnable:
`python3 scripts/validate_docs.py`.

## 5. Unresolved items (honest list)

1. **NV-01 ZATCA wire-level conformance** — deferred behind OPEN DR-001; nothing is
   compliance-proven; verification log empty until PHASE-009+.
2. **OQ-002 pricing/limits** — commercial model undecided (placeholders flagged).
3. **R-DB-1/R-DB-2** — per-tenant PITR and ledger partitioning are post-GA decisions with
   recorded triggers.
4. **Fixed assets** — feature key exists, TABLES spec does not; PHASE-025 scope review.
5. **OQ-C-1 offline financial statements** — online-only everywhere today; changing it
   requires an ADR.
6. **Consolidation deltas in phase docs** — the roadmap binds each delta to a phase
   (§2 of IMPLEMENTATION_ROADMAP); the 29-section phase docs themselves were *not*
   rewritten to restate these deltas (they are governed by the roadmap table); a phase
   executor must read both. This is a known, accepted seam — flagged rather than hidden.

## 6. Consolidated change summary (for §10 of the consolidation directive)

- **Files created:** 14 authoritative documents + ADR-0017 + 8 manifest JSONs + 2 scripts.
- **Files modified:** 24 (16 defect-fix targets + README + VALIDATION_REPORT + 5 cross-reference
  touchpoints; full list in CONSOLIDATION_REGISTER §6).
- **Files moved/deleted:** none. Folders 1/2/4 untouched.
- **Critical/high issues resolved:** DEF-001 (HIGH), DEF-010 (HIGH-latent), plus 6 medium
  defects; 1 flagged item verified as a non-defect.
- **Critical/high issues unresolved:** none at documentation level; runtime risks R-PERF-1
  and R-ZATCA-1 remain **TO BE TESTED / OPEN** by design (they require code and external
  verification respectively).
- **Actions requiring human approval:** adopt pricing (OQ-002); open or close OQ-C-1
  (offline statements) via ADR; staff the compliance-verification owner role (R-COM-1);
  decide the PHASE-023 split question if certification lead times demand it (OQ-C-2).

## 7. Verdict

The consolidated Folder 3 is a **single, internally consistent, implementation-ready
blueprint**: one authoritative baseline layer over the validated detailed specifications,
17 ADRs, a master decision register, complete idea traceability from the three source
plans, ten documented defect corrections (two of them HIGH), and a green 23-check
deterministic validation. The next implementation unit is **PHASE-001** under the existing
agent protocol. No claim in this report asserts working software; every future-tense
capability above is design + acceptance criteria awaiting execution.
