# CONSOLIDATION_REGISTER — Traceable Dispositions for Ideas from Folders 1, 2, and 4

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28
> **Purpose:** prevent valuable requirements from disappearing during consolidation and
> prevent unjustified imports. Classification vocabulary: `ADOPT` · `ADOPT_AFTER_MODIFICATION` ·
> `ALREADY_COVERED` · `REJECT` · `DEFER` · `NEEDS_VALIDATION`.
> ID convention: `CR-<source folder>-<number>` (F1 = Folder 1 "Mizaan", F2 = Folder 2,
> F4 = Folder 4 "UBEP"); `CR-0-*` = consolidation-process items. Defect corrections are
> tracked separately as DEF-001…DEF-010 in [CONSOLIDATION_VALIDATION_REPORT.md](CONSOLIDATION_VALIDATION_REPORT.md) §2.

## 1. Adopted (integrated into canonical documents)

| ID | Idea (source file · section) | What it contributes | Canonical destination | Status / evidence |
|----|------------------------------|--------------------|----------------------|------------------|
| CR-1-F1-01 | 7-way **effect matrix** for every financial operation (1/docs/accounting/ACCOUNTING_PRINCIPLES.md §Effect matrices) | Forces every new posting operation to specify doc-state, inventory, AR/AP, cash, GL, tax, audit effects — closes the "operation specified only as journal lines" gap | [accounting/POSTING_ENGINE.md](accounting/POSTING_ENGINE.md) §4 extension gate; [accounting/ACCOUNTING_ENGINE_SPECIFICATION.md](accounting/ACCOUNTING_ENGINE_SPECIFICATION.md) §2.5 | DOCUMENTATION_VERIFIED — text in place; G-scenarios already assert postconditions (test-side was largely covered) |
| CR-1-F1-02 | **Tenant-data leakage-path checklist** per shipped feature (1/docs/architecture/MULTI_TENANCY.md §Leakage paths) | Non-SQL leak review gate (files/exports/jobs/caches/logs/backups) complementing F3's table-level attack tests | [security/SECURITY_AND_TENANT_ISOLATION.md](security/SECURITY_AND_TENANT_ISOLATION.md) §3 | DOCUMENTATION_VERIFIED |
| CR-1-F1-03 | **Tafqit / amount-in-words** on financial prints (1/docs/reporting/REPORTING_ARCHITECTURE.md §print pipeline) | Legally customary Arabic amount-in-words; missing entirely from F3 | [reporting/PRINTING_AND_EXPORT.md](reporting/PRINTING_AND_EXPORT.md) §1–2; [reporting/REPORTING_AND_DOCUMENT_ENGINE.md](reporting/REPORTING_AND_DOCUMENT_ENGINE.md) §5 | DOCUMENTATION_VERIFIED — helper + per-currency fixtures assigned to PHASE-013 |
| CR-2-F2-01 | **Document-status color tokens** bound to the lifecycle state machine (2/docs/ui/DESIGN_TOKENS.md) | Uniform status semantics across 88 components; F3 lacked an explicit APPROVED mapping | [ui/DESIGN_TOKENS.md](ui/DESIGN_TOKENS.md) §3 (binding rule + APPROVED row); [ui/UNIFIED_UI_DESIGN_SYSTEM.md](ui/UNIFIED_UI_DESIGN_SYSTEM.md) §3.2 | DOCUMENTATION_VERIFIED |
| CR-2-F2-02 | **Idempotency scope edge cases** — "login is NOT idempotent" (2/docs/api/IDEMPOTENCY.md) | F3's blanket "all POST writes keyed" would replay stale sessions on login/refresh — real latent defect | [api/IDEMPOTENCY.md](api/IDEMPOTENCY.md) §1 rule 5; [security/SECURITY_AND_TENANT_ISOLATION.md](security/SECURITY_AND_TENANT_ISOLATION.md) §4 | DOCUMENTATION_VERIFIED |
| CR-4-F4-01 | **Deferrable constraint trigger** for journal balance (4/docs/database/CONSTRAINTS_AND_INDEXES.md §1) | Commit-time DB last-resort; fixes F3's immediate-firing trigger spec that would abort valid multi-line postings → **DEF-010** | [database/CONSTRAINTS_AND_INDEXES.md](database/CONSTRAINTS_AND_INDEXES.md) §2; [database/DATABASE_ARCHITECTURE.md](database/DATABASE_ARCHITECTURE.md) §1.7; ADR-0017 §Decision | DOCUMENTATION_VERIFIED — SQL + engine-bypass test required at PHASE-007 |
| CR-4-F4-02 | **Anti-fabrication marketing rule** (4/docs/localization/compliance-matrix/COMPLIANCE_MATRIX.md rule 4) | No marketing/onboarding/in-app copy may claim compliance beyond the matrix ladder | [localization/compliance-matrix/README.md](localization/compliance-matrix/README.md) §1 supplementary rule; [localization/REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE.md](localization/REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE.md) §2.3 | DOCUMENTATION_VERIFIED |
| CR-4-F4-03 | **FIFO-cost vs FEFO-picking decoupling** (4/docs/accounting/INVENTORY_ACCOUNTING.md §2.2 BR-INV-04) | Crisp normative statement (costing layers vs expiry as separate attributes) — food/pharma correctness | [accounting/INVENTORY_ACCOUNTING.md](accounting/INVENTORY_ACCOUNTING.md) §5; [industries/INDUSTRY_MODULE_ARCHITECTURE.md](industries/INDUSTRY_MODULE_ARCHITECTURE.md) §4 | DOCUMENTATION_VERIFIED |
| CR-4-F4-04 | **Report reconciliation via independent code path** (4/docs/reporting/REPORT_RECONCILIATION.md §3) | Expected values computed by direct SQL, not the report's query — catches self-consistent-but-wrong reports | [reporting/REPORTING_AND_DOCUMENT_ENGINE.md](reporting/REPORTING_AND_DOCUMENT_ENGINE.md) §2.2 (binding on [REPORT_RECONCILIATION.md](reporting/REPORT_RECONCILIATION.md) §3 suite) | DOCUMENTATION_VERIFIED |
| CR-4-F4-05 | **No-event-sourcing rationale** as a durable ADR (4/docs/architecture/ADR/0002-no-event-sourcing.md) | F3's design was already relational-journal; the explicit decision record was missing | [architecture/ADR/ADR-0017-no-event-sourcing.md](architecture/ADR/ADR-0017-no-event-sourcing.md) (new); index updated | DOCUMENTATION_VERIFIED |
| CR-0-General-01 | **Effort bands + coverage map** for the roadmap (process gap, identified by the comparison report) | Capacity planning absent from baseline | [planning/IMPLEMENTATION_ROADMAP.md](planning/IMPLEMENTATION_ROADMAP.md) §2 | DOCUMENTATION_VERIFIED — bands are estimates, flagged as such |
| CR-0-General-02 | **Manifest JSON extraction** (turns stale `manifest.retail.json` pointers into real artifacts) | Machine-readable manifests for the PHASE-015 engine; validation becomes scriptable | [industries/templates/manifests/](industries/templates/manifests/) (8 files) + [scripts/extract_manifests.py](../scripts/extract_manifests.py); template-id unification (DEF-008) | STATIC_CHECK_PASSED — all 8 JSON-parse + id-format checks green |

## 2. Already covered (evaluated, no import needed — evidence)

| ID | Idea (source) | Folder 3 equivalent (evidence) |
|----|---------------|-------------------------------|
| CR-1-F1-04 | Regulatory humility rule: no uncited tax rates; source URL + retrieval date (1/docs/localization/TAX_ENGINE.md) | Compliance-matrix registry: official-source refs, retrieval dates, verification ladder, downgrade-on-law-change ([localization/compliance-matrix/README.md](localization/compliance-matrix/README.md) §1–2) |
| CR-1-F1-05 | Dual identity: client UUIDs + server gapless official numbers (1/docs/architecture/ADR/ADR-0004) | ADR-0006 UUIDv7 + BR-029 numbering at approval/posting + OFF- receipt numbers reconciled at sync |
| CR-1-F1-06 | "Ten separations" configuration model (1/docs/product/CONFIGURATION_ENGINE.md) | Ten-layer configuration engine with per-value-class precedence ([product/CONFIGURATION_ENGINE.md](product/CONFIGURATION_ENGINE.md) §2–3) |
| CR-1-F1-07 | Monolith extraction criteria / revisit triggers (1/docs/architecture/ADR/ADR-0001) | Every F3 ADR carries revisit triggers; ARCHITECTURE_DECISIONS "decisions deliberately NOT taken" |
| CR-1-F1-08 | Outbox/inbox sync with "money never LWW" (1/docs/offline/OFFLINE_AND_SYNC.md) | ADR-0012 + per-entity conflict policies + 3-layer idempotency |
| CR-2-F2-03 | Numbered accounting invariants INV-xxx bound to tests (2/docs/accounting/ACCOUNTING_INVARIANTS.md) | INV-001…INV-022 with enforcement + test mapping ([accounting/ACCOUNTING_INVARIANTS.md](accounting/ACCOUNTING_INVARIANTS.md)) |
| CR-2-F2-04 | Country packs as **version-pinned per tenant** (2/docs/localization/COUNTRY_PACKS.md) — initially recommended for adoption by the comparison report | **Reclassified ALREADY_COVERED/REJECT after source re-check (Stage B correction):** F3's packs are effective-dated *by law* — tenant pinning of legal rates would be legally wrong; stability is provided by effective-dated rows + verification status. See CD-007 in [ARCHITECTURE_DECISION_REGISTER.md](ARCHITECTURE_DECISION_REGISTER.md) |
| CR-2-F2-05 | Posting engine as sole GL writer + purposes mapping (2/docs/accounting/POSTING_ENGINE.md) | ADR-0007 + purpose resolution with `PURPOSE_NOT_MAPPED` fail-closed |
| CR-2-F2-06 | Argon2id with explicit parameters (2/docs/api/AUTHENTICATION.md) | ADR-0015: argon2id 64MB/t=3/p=1, per-hash stored params |
| CR-4-F4-06 | `account_purpose` tags decoupling from account codes (4/docs/accounting/CHART_OF_ACCOUNTS.md §3) | F3 purpose registry + one-active-account-per-purpose mapping |
| CR-4-F4-07 | "Reconciliation failure = Sev-1" (4/docs/security/INCIDENT_RESPONSE.md §4) — initially recommended for adoption | **Reclassified ALREADY_COVERED (Stage B correction):** [security/INCIDENT_RESPONSE.md](security/INCIDENT_RESPONSE.md) §1 already lists ledger/subledger drift as auto-SEV-1 |
| CR-4-F4-08 | Postgres-backed jobs instead of Redis (4/docs/architecture/ADR/0010) | ADR-0008 pg-boss with documented Redis-deferred triggers (same decision) |
| CR-4-F4-09 | Five-way tax treatment incl. tenant not-registered flag (4/docs/localization/TAX_ENGINE.md) | F3 treatments + dated `tax_registrations` posture |

## 3. Rejected (architecturally significant, with reasons)

| ID | Idea (source) | Reason for rejection |
|----|---------------|----------------------|
| CR-2-F2-07 | NestJS + **Next.js 14 / React 18** stack, BullMQ/Redis at launch (2/docs/README.md, ADR-0003, ADR-0005) | Stale versions by its own 2026 date; F3's stack is current and Redis-deferred deliberately; no value in re-litigating |
| CR-1-F1-09 | Folder 1's **release-numbering model** ("v1.0 = +012–013") | Contradictory inside F1 (its own PHASE-016 was "Commercial Release v1.0"); F3's MVP=014 / GA=025 gates are cleaner and already consistent |
| CR-4-F4-10 | Folder 4's **pilot at Phase 013 before tax engine (016)** sequencing | Legal exposure (VAT-incomplete pilot invoices in KSA/UAE); F3's tax engine (009) precedes any live tenant — keep F3 sequencing (not imported) |
| CR-1-F1-10 | Folder 1's web-only MVP with desktop/Android "groundwork" phases | F3's client plan (Tauri 021, Expo 022 after sync 020) is more honest about offline dependencies; no change |

## 4. Deferred (valuable, later phase or gated by a decision)

| ID | Idea (source) | Phase / condition |
|----|---------------|-------------------|
| CR-1-F1-11 | Fixed assets & depreciation module (1/docs/implementation/phases/PHASE-016 scope) | PHASE-025 scope review (`accounting.fixed_assets` in [product/FEATURE_CATALOG.md](product/FEATURE_CATALOG.md) §4) — needs its own TABLES spec before scheduling |
| CR-4-F4-11 | Per-report `reconcilesTo` field as an explicit contract property (4 / 2 wording) | PHASE-013: assertion targets already bind to control-account purposes; consider naming the field explicitly in the contract schema when the engine is implemented |
| CR-0-General-03 | `journal_lines`/`stock_moves` partitioning & archival | Post-GA, revisit at ~10M lines/tenant (R-DB-2) |
| CR-0-General-04 | Offline financial statements (currently online-only on all devices) | Requires an ADR — touches posting-authoritative principle (OQ-C-1) |
| CR-0-General-05 | Inventory variant matrices (size/color), e-signature, loyalty | Industry-template backlog intake ([industries/capabilities/CAPABILITY_MATRIX.md](industries/capabilities/CAPABILITY_MATRIX.md) §3 pending list) |

## 5. Needs validation (insufficient evidence to decide now)

| ID | Item | Validation condition |
|----|------|---------------------|
| NV-01 | ZATCA wire-level field lists / UBL profile conformance | OPEN decision record [decisions/compliance/DR-001-zatca-scope-and-timing.md](decisions/compliance/DR-001-zatca-scope-and-timing.md); verification log entries begin at PHASE-009 |
| NV-02 | Plan pricing and limits (all PLACEHOLDER) | OQ-002 product decision |
| NV-03 | Multi-legal-entity / intercompany (A-002: single entity per tenant at MVP) | Post-GA scope decision; tenant model unaffected at MVP (documented assumption) |

## 6. Files changed by consolidation (inventory)

**Modified (16):** `api/API_CONVENTIONS.md`, `api/IDEMPOTENCY.md`,
`architecture/ADR/ADR-0008-jobs-redis.md`, `architecture/ADR/ADR-0009-money-precision.md`,
`architecture/ARCHITECTURE_DECISIONS.md`, `architecture/SYSTEM_OVERVIEW.md`,
`accounting/CHART_OF_ACCOUNTS.md`, `accounting/INVENTORY_ACCOUNTING.md`,
`accounting/POSTING_ENGINE.md`, `database/CONSTRAINTS_AND_INDEXES.md`,
`database/DATA_DICTIONARY.md`, `handoff/VALIDATION_REPORT.md`,
`industries/templates/README.md`, `product/INDUSTRY_CATALOG.md`,
`product/FEATURE_CATALOG.md`, `testing/ACCOUNTING_TESTS.md`,
`ui/DESIGN_TOKENS.md`, `reporting/PRINTING_AND_EXPORT.md`,
`security/AUTHORIZATION_MATRIX.md`, `localization/compliance-matrix/README.md`,
`implementation/phases/PHASE-008.md`, `implementation/phases/PHASE-011.md`,
`implementation/phases/PHASE-012.md` *(23 files)*.

**Created (16 in docs/):** this register,
[ARCHITECTURE_DECISION_REGISTER.md](ARCHITECTURE_DECISION_REGISTER.md),
[ARCHITECTURE_BASELINE.md](ARCHITECTURE_BASELINE.md),
[ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md),
[CONSOLIDATION_VALIDATION_REPORT.md](CONSOLIDATION_VALIDATION_REPORT.md),
[database/DATABASE_ARCHITECTURE.md](database/DATABASE_ARCHITECTURE.md),
[accounting/ACCOUNTING_ENGINE_SPECIFICATION.md](accounting/ACCOUNTING_ENGINE_SPECIFICATION.md),
[security/SECURITY_AND_TENANT_ISOLATION.md](security/SECURITY_AND_TENANT_ISOLATION.md),
[localization/REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE.md](localization/REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE.md),
[industries/INDUSTRY_MODULE_ARCHITECTURE.md](industries/INDUSTRY_MODULE_ARCHITECTURE.md),
[ui/UNIFIED_UI_DESIGN_SYSTEM.md](ui/UNIFIED_UI_DESIGN_SYSTEM.md),
[reporting/REPORTING_AND_DOCUMENT_ENGINE.md](reporting/REPORTING_AND_DOCUMENT_ENGINE.md),
[offline/OFFLINE_AND_SYNC_ARCHITECTURE.md](offline/OFFLINE_AND_SYNC_ARCHITECTURE.md),
[planning/IMPLEMENTATION_ROADMAP.md](planning/IMPLEMENTATION_ROADMAP.md),
[architecture/ADR/ADR-0017-no-event-sourcing.md](architecture/ADR/ADR-0017-no-event-sourcing.md),
plus 8 extracted `industries/templates/manifests/manifest.*.json`.
**Created (repo root):** [scripts/extract_manifests.py](../scripts/extract_manifests.py),
[scripts/validate_docs.py](../scripts/validate_docs.py).

**Moved/deleted:** none. Folders 1, 2, and 4 untouched. Pre-consolidation snapshot of
Folder 3 preserved (original archive + backup copy, see
[CONSOLIDATION_VALIDATION_REPORT.md](CONSOLIDATION_VALIDATION_REPORT.md) §1).
