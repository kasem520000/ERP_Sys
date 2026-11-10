# PHASE-034 — Multi-Entity Consolidation

> **Status:** COMPLETE (2026-11-09) · **Updated:** 2026-11-09 · completion evidence:
> [reports/PHASE-034-COMPLETION.md](reports/PHASE-034-COMPLETION.md)

## 1. Phase Overview

- **Phase ID:** PHASE-034
- **Title:** Multi-Entity Consolidation
- **Objective:** Deliver the `consolidation` module (ED-10, stage 11 — the final
  roadmap phase) exactly per
  [ADR-0018](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md): a legal
  entity = a tenant (unchanged); **consolidation groups** as configuration
  (`consolidation_groups`, `group_entities` with ownership percent and include-from);
  **elimination entries** as balanced journals posted via the posting engine into the
  **parent tenant's consolidation books** (source_type `CONSOLIDATION_ELIMINATION`,
  golden G-32, reversal-only per BR-056); **consolidation runs** as read-only
  aggregations over member books through **one audited platform-plane reader service —
  the only sanctioned cross-tenant reader in the platform** — with **zero cross-tenant
  writes**, member RLS never relaxed, members required to have closed fiscal periods
  (BR-056); **FX translation with dated rates** (INV-008) resolving the open method
  question OQ-V2-2 in-phase; and **consolidated statements** (TB/IS/BS + eliminations
  log) as PHASE-013 report contracts asserting INV-026 (consolidated = Σ member
  statements − eliminations). Completing this phase satisfies the **Enterprise Depth
  release gate**.
- **Business value:** Multi-company groups across MENA — a KSA trading group with one
  tenant per VAT registration is the canonical case — export each entity's statements
  today and consolidate offline in spreadsheets. This phase brings consolidated
  statements inside the platform, auditable end-to-end (every elimination is a real,
  drill-down-able journal in the parent's books), **without weakening tenant
  isolation for a single tenant, consolidated or not**.

## 2. Scope

In scope:

1. **Consolidation groups & membership** (`consolidation.groups`,
   [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §consolidation):
   `consolidation_groups` (`owner_tenant_id`, `name`, `name_ar`, `base_currency`,
   status) and `group_entities` (`group_id`, `member_tenant_id`,
   `ownership_percent` numeric(7,4), `include_from`, status) per register §C — groups
   are **configuration in the
   consolidation module, not a tenancy change** (ADR-0018 §1). The owner tenant
   maintains membership under `consolidation.groups.manage` (audited); the owner is
   itself typically a member; `include_from` bounds a member's consolidated periods;
   `ownership_percent` is recorded for disclosure and minority-interest presentation
   only — full minority-interest accounting beyond elimination math is **not promised**
   at PHASE-034 ([DR-006](../../decisions/accounting/DR-006-consolidation.md)).
2. **Elimination documents** (`consolidation.eliminations`):
   `elimination_entries` (`group_id`, `fiscal_period_id`, `description`, status
   DRAFT/POSTED, `journal_entry_ids`) with the
   DRAFT → POSTED lifecycle — POSTED via `PostingEngine.post` with source_type
   `CONSOLIDATION_ELIMINATION`, **in the parent tenant's consolidation books only**
   ([POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4/§4.1); **intercompany
   AR/AP elimination** in the G-32 shape — DR `AP_CONTROL` (entity B intercompany) ·
   CR `AR_CONTROL` (entity A intercompany) — authored over **member-pair lines**
   (manual authoring: the surface suggests intercompany pairings from the members' AR/AP
   subledgers; matching is human-confirmed — the automatic matching engine is out of
   scope); **investment/equity elimination** lines post through the
   `CONSOLIDATION_ADJUSTMENT` purpose ([CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md)
   §2 v2.0 row — used only in the parent's consolidation books); corrections are
   **reversal-only counter-entries** (BR-056); INV-006 document↔journal chain, INV-013
   idempotency, INV-003 posted-row immutability all apply; SoD create ≠ post
   ([AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.15 + §4).
3. **Consolidation runs** (`consolidation.runs`): `consolidation_runs` (`group_id`,
   `fiscal_period_id`, status QUEUED/RUNNING/COMPLETED/FAILED, output refs) orchestrated
   as bounded pg-boss jobs ([ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md));
   the run reads member GL **via the audited read-only consolidation service** —
   never by relaxing RLS (ADR-0018 §3); a **BR-056 pre-check blocks run creation when
   any member's fiscal period for the run period is open** (typed `MEMBER_PERIOD_OPEN`
   — rejected, not warned); the run produces **immutable, versioned snapshot outputs**
   (member statement extracts in group currency + elimination effects) that feed the
   consolidated statements — statements read snapshots, never live member books;
   **every member-book read writes an audit row** (run id, member tenant, actor,
   scope); the elimination set as of the run is fixed with the snapshot.
4. **FX translation** (`consolidation.fx_translation`): member statements translate
   into the group's base currency with **dated stored rates** per the INV-008
   conventions (rate > 0; base amounts = document amounts × stored rate exactly as
   stored — no recomputation drift); the **method decision (closing-rate vs temporal)
   is open question OQ-V2-2**
   ([ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md))
   and is **resolved in-phase by a decision record amending
   [DR-006](../../decisions/accounting/DR-006-consolidation.md) §4 before executor
   tasks merge** — closing-rate is the proposed default, and the shipped method is an
   explicit per-group configuration (`fx_translation_method`); missing-rate cases fail
   closed with a typed error.
5. **Consolidated statements** (`consolidation.reports`): four report contracts
   registered on the PHASE-013 engine per
   [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) §10 —
   `consolidation.consolidated-tb`, `consolidation.consolidated-is`,
   `consolidation.consolidated-bs`, `consolidation.eliminations-log` — each asserting
   INV-026 in the footer and blocking exports on assertion failure
   ([REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md)): **consolidated
   statements reconcile = Σ member statements (group currency, dated FX) −
   eliminations**, checked line-by-line against the run snapshot;
   `consolidation.eliminations-log` ties to the parent's elimination journals;
   consolidated statements are labeled **group views** — they never replace member
   statutory books (ADR-0018 consequences).
6. **Permissions & SoD** (register §K → matrix §3.15): seed
   `consolidation.groups.manage`, `consolidation.eliminations.create`,
   `consolidation.eliminations.post` (approval-gated, SoD creator ≠ approver),
   `consolidation.runs.execute` (audited), `consolidation.reports.view`;
   consolidation is **tenant-plane, never branch-scoped** (matrix §5 row).
7. **UI per archetypes** ([PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)): group +
   membership maintenance as **Settings (§8)**; elimination authoring as a
   **Transaction Entry workspace (§4)** over member-pair lines (pick two member tenants,
   accounts/purposes, amounts — live balanced DR/CR preview, post with approval);
   run execution + history as a **Report Page (§7)**; consolidated statements render
   through the PHASE-013 report viewer with drill-down from a consolidated line to
   the parent's elimination journal (member lines carry provenance to the audited
   read); the التقارير / Reports group gains the consolidated-statements item
   ([NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) `reports.consolidated`).
8. **Isolation & audit of the platform-plane reader**: the consolidation service
   holds the **single explicit platform-plane read grant** — narrow by construction
   (SELECT-only on the member GL read models, for groups the owner tenant belongs
   to), acquired per query, **audited on every member-book read**; **zero cross-tenant
   writes** are enforced at the database grant level (the reader role holds no
   INSERT/UPDATE/DELETE anywhere; write attempts fail and are audited); member RLS
   policies, the A1–A11 attack tests, and the RLS-denial canary are **untouched**
   (ADR-0018 "No RLS changes"; the grant is covered by isolation attack rows in
   [SECURITY_AND_TENANT_ISOLATION.md](../../security/SECURITY_AND_TENANT_ISOLATION.md)).
9. **Period discipline (BR-056)**: members must have **closed fiscal periods** before
   a run — the pre-check rejects open-period runs; eliminations post into the
   parent's books under the ordinary period checks for the run's fiscal period;
   reversal counter-entries are new audited documents; the run snapshot freezes the
   elimination set actually reflected in the statements.

Out of scope (explicit):

- **Intercompany automatic matching engine** — eliminations are manually authored
  first; auto-matching is a future decision record (ADR-0018 revisit triggers).
- **Statutory group tax filings** — a jurisdiction mandate would require a
  compliance-folder record with official sources feeding the reports (DR-006 revisit).
- **Minority-interest waterfall automation** beyond `ownership_percent` display —
  future decision (DR-006: not promised at PHASE-034).
- **Management-reporting dimensions beyond GL accounts/cost centers** on consolidated
  statements.
- **Group master-data sharing and intercompany documents** (orders/invoices between
  members) — a new ADR + accounting record is required (ADR-0018 revisit triggers);
  a mega-tenant shape is explicitly rejected there.

## 3. Prerequisites

- **PHASE-025 COMPLETE** (GA gate): stage 11 is an additive release that never alters
  the GA gate (ED-01). Verified via the completion report + green CI.
- **PHASE-013 COMPLETE** — the reporting engine (functional prereq, register §B):
  report-contract registry + schema validation at startup, executor + envelope
  builder, **assertion engine** (exact-decimal compare, `ASSERTION_FAILED` +
  block-export), golden datasets, saved runs, print/export (PDF/XLSX/CSV, bilingual
  RTL), Report Page surfaces. Verified via [PHASE-013.md](PHASE-013.md) completion
  report + green CI.
- **PHASE-026 COMPLETE** — fixed assets consolidated (functional prereq, register
  §B): depreciation runs, revaluations, and disposals post into member books and close
  with member periods — consolidated statements read **completed asset books**
  ([PHASE-026.md](PHASE-026.md)).
- **PHASE-029 COMPLETE** — payroll consolidated (functional prereq, register §B):
  posted payroll runs, payouts, and EOS settlements are part of member books; the same
  finality argument applies ([PHASE-029.md](PHASE-029.md)).
- **PHASE-007 COMPLETE** (dated FX, parenthetical in register §B): the `exchange_rates`
  store and the **INV-008 conventions** (stored rate > 0; base = amount × rate; no
  recomputation drift), fiscal years/periods, and the GL read paths the reader
  service consumes.
- **Binding architecture decision:**
  [ADR-0018](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md) — legal
  entity = tenant; read-only member aggregation; eliminations posted via the engine
  into the parent's consolidation books (`CONSOLIDATION_ELIMINATION`); zero
  cross-tenant writes; one audited platform-plane reader; BR-056 closed member
  periods; FX translation with dated rates (method per OQ-V2-2). Supporting decisions:
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (tenancy unchanged;
  RLS defense in depth untouched),
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (the
  engine is the only ledger writer — eliminations included),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (bounded run jobs),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (decimal amounts/rates
  at canonical precision),
  [ADR-0011](../../architecture/ADR/ADR-0011-reporting-printing.md) (reports are
  deterministic functions of posted data),
  [ADR-0017](../../architecture/ADR/ADR-0017-no-event-sourcing.md) (no second
  financial truth — snapshots are derived artifacts, not a second ledger).
- Relevant documentation:
  [DR-006](../../decisions/accounting/DR-006-consolidation.md) (accounting policy —
  read-only members, engine eliminations, counter-entry reversals, dated FX),
  [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B/§C/§D/§E/§F/§G/§H/§J/§K,
  [ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md)
  (OQ-V2-2), [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 (G-32),
  [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) §2
  (`CONSOLIDATION_ADJUSTMENT`), [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-026), [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (G-32 + INV-026
  suites), [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)
  (elimination row), [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-056),
  [BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §15 (consolidation
  close), [FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md)
  (TB/IS/BS derivation), [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md)
  (closed-period semantics), [CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md)
  (FX residual rules), [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  §3.15/§4/§5, [SECURITY_AND_TENANT_ISOLATION.md](../../security/SECURITY_AND_TENANT_ISOLATION.md)
  + [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2,
  [TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md) (A1–A11 +
  canary), [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) +
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) (the read-only
  cross-tenant edge, rule 5), [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (#44 ONLINE-ONLY), [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §6/§9
  (numeric(7,4) percentages; `consolidation_run_status` enum),
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md),
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) (Enterprise Depth gate),
  [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md),
  [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md)
  (PHASE-034 + gate rows).

## 4. Design Impact

- **Database changes:** migration `0033_consolidation.sql`: the four register §C
  tables — `consolidation_groups`, `group_entities`, `elimination_entries`,
  `consolidation_runs` — all tenant-owned + RLS via the macro + composite tenant FKs
  + hot indexes (`(tenant_id, group_id, fiscal_period_id)`); the
  `consolidation_run_status` enum (register §I); `ownership_percent` numeric(7,4) per
  [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §6; run output refs as jsonb
  snapshot pointers (snapshots stored immutable + versioned); **the platform-plane
  reader grant**: a dedicated read-only database role with **SELECT-only** grants on
  the member GL read models, created disabled-by-default and enabled via reviewed
  configuration — the only grant of its kind in the platform (ADR-0018). No
  append-only tables in this module (register §C marks none of the four 🔒);
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) already carries the
  blueprint-level rows (ED-19) — the migration reconciles to them.
- **API changes:** `/api/v1/consolidation/groups[/{id}|/{id}/members]`,
  `/eliminations[/{id}|/{id}/post|/{id}/reverse]`,
  `/runs[/{id}|/{id}/snapshots|/{id}/statements]` — all per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md): `Idempotency-Key` on post/reverse,
  409 `IMMUTABLE_DOCUMENT` on posted eliminations, 404 on foreign ids, typed errors
  `MEMBER_PERIOD_OPEN` / `GROUP_NOT_OWNED` / `RATE_MISSING` (fail-closed);
  contracts in `packages/contracts`.
- **UI changes:** Settings (§8) for group + membership maintenance; Transaction Entry
  workspace (§4) for elimination authoring over member-pair lines with a live
  balanced-entry preview; Report Page (§7) for run execution + history; consolidated
  statements through the report viewer with the INV-026 assertion footer and
  drill-down to elimination journals; AR+EN baselines for every screen.
- **Security & authorization:** the five §3.15 permission keys seed + reconcile
  (generated checklist); `consolidation.eliminations.post` is approval-gated with
  **SoD creator ≠ approver** and audited; `consolidation.runs.execute` and group
  maintenance are audited; tenant-plane scoping (never branch-scoped); new attack
  rows: cross-tenant **read** attempts through every consolidation surface (member
  A's admin cannot see member B without membership; spoofed member ids → 404/rejection),
  and **write attempts through the reader role fail at the DB grant level and are
  audited** (S-04 zero-partial-creation discipline where payloads nest ids).
- **Accounting implications:** the phase **implements** the already-canonical G-32
  elimination row ([JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7;
  [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4/§4.1 — source
  `CONSOLIDATION_ELIMINATION`, operations `post`/`reverse`); investment/equity
  elimination lines use the `CONSOLIDATION_ADJUSTMENT` purpose; **INV-026 joins the
  invariant suite** with seeded-drift checks (statement ≠ Σ members − eliminations ⇒
  detect + block); INV-003/INV-006/INV-008/INV-013 reused; eliminations live in the
  **parent tenant's** books, so ordinary RLS, periods, and audit apply to them;
  consolidated statements are derived artifacts — no journal ever posts into a member
  tenant from this module.
- **Localization implications:** bilingual group/elimination/run labels (group
  `name_ar`); consolidated TB/IS/BS and eliminations log print bilingual RTL through
  the PHASE-013 print system; the INV-026 footer assertion renders in both languages;
  RTL-correct numerals/money per the design tokens.
- **Offline implications:** none — consolidation is **ONLINE-ONLY**
  ([OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  row #44): cross-tenant reads run through the audited service only; no sync rows are
  added and no device class gains the capability.
- **Module dependencies:** `consolidation` → `accounting` (posting engine, periods,
  GL read models via its published query services), `reporting` (contract registry,
  executor, assertion engine), and the platform plane (the reviewed read grant); the
  cross-tenant edge is **read-only** and named in
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) rule 5; no module
  writes another's tables ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)
  write matrix); the module writes only its own tables plus the parent tenant's
  journals **via the engine**.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | **OQ-V2-2 decision gate**: decision record resolving the FX translation method (closing-rate proposed default; per-group `fx_translation_method`) by amending [DR-006](../../decisions/accounting/DR-006-consolidation.md) §4 and closing OQ-V2-2 in [ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md) — lands **before** any executor task merges | `docs/decisions/accounting/DR-006-consolidation.md`, `docs/ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md` | docs validation green; the decision record is linked from the completion report; executor code reads the method from group config only |
| T2 | Migration `0033_consolidation.sql`: 4 tables + enum + RLS/composite FKs/indexes + **the SELECT-only platform-plane reader grant** (disabled-by-default, config-enabled) | `apps/api/migrations/0033_consolidation.sql` | migration fresh+regression; RLS catalog; A1–A10 on all four tables; **reader-role write attempts (INSERT/UPDATE/DELETE) rejected at the DB level and audited**; grant scope asserts SELECT on member GL read models only |
| T3 | Consolidation reader service: the audited platform-plane reader — posted member GL read models (journal lines, account balances, TB/IS/BS derivation inputs), per-read audit rows (run, member tenant, actor, scope), closed-period + include_from checks | `apps/api/src/modules/consolidation/application/reader-service.ts`, `infrastructure/**` | **read-audit completeness**: instrumented run ⇒ audit rows == reads; member A cannot read member B without membership; spoofed member ids → typed rejection; RLS canary untouched |
| T4 | Groups & membership service: CRUD, ownership_percent/include_from, owner-scope validation, base currency | `apps/api/src/modules/consolidation/application/group-service.ts` | foreign tenant refs rejected (404); maintenance audited; include_from bounds consolidated periods on fixtures |
| T5 | Elimination service: DRAFT authoring over member-pair lines (intercompany pairing **suggestions** from member AR/AP subledgers — manual confirm), `CONSOLIDATION_ADJUSTMENT` investment/equity lines, balance validation, POST via `PostingEngine.post` (`CONSOLIDATION_ELIMINATION`), reversal-only counter-entry | `apps/api/src/modules/consolidation/application/elimination-service.ts` | **G-32 golden** (DR intercompany AP · CR intercompany AR in the parent's books) + failure packs: `ENTRY_NOT_BALANCED`, `ALREADY_POSTED`, `MEMBER_PERIOD_OPEN` (BR-056), `PURPOSE_NOT_MAPPED` — zero residue; SoD create ≠ post fires |
| T6 | Run orchestration: BR-056 pre-check; QUEUED→RUNNING→COMPLETED/FAILED as bounded pg-boss jobs; immutable versioned snapshots (member extracts + elimination set); FAILED typed states | `apps/api/src/modules/consolidation/application/run-service.ts`, `infrastructure/jobs/**` | open member period ⇒ run rejected (typed, not warned); re-run ⇒ new snapshot, old snapshots immutable; FAILED leaves no partial snapshot; snapshot determinism (same inputs ⇒ byte-identical output) |
| T7 | FX translation step: dated stored rates (INV-008), group base currency, per-group method per the T1 decision; residual handling per [CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md) | `apps/api/src/modules/consolidation/application/fx-translation.ts` | translation fixtures (incl. 3-decimal currencies KWD-style); rate>0 + `RATE_MISSING` fail-closed; no recomputation drift (stored-rate equality) |
| T8 | Consolidated statements: register the 4 report contracts on the PHASE-013 engine with REPORT_CONTRACT assertions — **INV-026 headline** (Σ members − eliminations, line-by-line vs snapshot), TB/IS/BS derivations per [FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md), eliminations-log ↔ journal tie | `apps/api/src/modules/reporting/registry/consolidation/**` | contract schema validation at startup; assertions green on the golden group fixture; **seeded drift (tampered snapshot, unbalanced elimination) ⇒ `ASSERTION_FAILED` + export blocked**; group-view labeling asserted |
| T9 | Isolation attack suite: cross-tenant read attacks via every consolidation surface; write-attempt audit test; member-book immutability proof | `tests/consolidation/isolation/**`, `tests/isolation/**` | member A admin cannot see member B; **byte-compare member GL before/after a run — zero member rows changed**; policy snapshot diff proves zero RLS changes; canary green |
| T10 | Permissions & SoD: seed §3.15 keys + role templates; SoD on `consolidation.eliminations.post`; tenant-plane scoping | `apps/api/src/modules/{identity,consolidation}/**` (seeds) | generated permission checklist green; SoD warning fires on create+post in one role; branch scoping impossible (matrix §5 row) |
| T11 | UI: group Settings (§8), elimination Transaction Entry workspace (§4, member-pair lines + balanced preview), run Report Page (§7), statements via the report viewer with drill-down | `apps/web/src/app/(app)/consolidation/**` | AR+EN baselines; axe + keyboard journeys; RTL; drill from a consolidated line to the elimination journal |
| T12 | Golden + invariant + rule suites | `tests/accounting/golden/G-32*`, `tests/accounting/invariants/INV-026*`, `tests/consolidation/**` | all blocking: G-32 with failure packs; INV-026 seeded-drift detection; line-by-line reconciliation fixture; cross-tenant write proof; read-audit completeness; zero residue everywhere |
| T13 | Docs sync: NAVIGATION_MODEL §9 phasing row (`reports.consolidated` live), REPORT_CATALOG readiness row, OFFLINE #44 verification, ENTITY_CATALOG/TABLES/ERD reconciliation vs the migration, completion-report scaffolding | `docs/**` | docs validation green; validator (ED-17-upgraded: phase range 001–034, ADR set 0001…0018) green; catalog drift check green |

## 6. Verification

**Automated tests (required):**

- **G-32 golden** with expected journal lines **in the parent's consolidation books
  only**: intercompany elimination (DR `AP_CONTROL` entity B intercompany · CR
  `AR_CONTROL` entity A intercompany), one balanced journal per elimination set;
  asserts the elimination document state (`POSTED` + journal chain per INV-006),
  INV-013 idempotency per source/operation, an audit event on post, and **zero rows in
  any member tenant's ledger** with a consolidation source.
- **G-32 failure packs** (each with zero residue): unbalanced elimination ⇒
  `ENTRY_NOT_BALANCED`; already-posted elimination ⇒ `ALREADY_POSTED` (409
  `IMMUTABLE_DOCUMENT`); member period open ⇒ `MEMBER_PERIOD_OPEN` (BR-056 — the
  rejection, not a warning); unmapped `CONSOLIDATION_ADJUSTMENT` ⇒
  `PURPOSE_NOT_MAPPED` (fail closed).
- **INV-026 suite + seeded drift**: on a fixture group (owner + 2 members, one
  non-base-currency member with dated FX), a completed run's consolidated TB/IS/BS
  reconcile **line-by-line** to Σ member statements (group currency, dated stored
  rates) − eliminations; seeded drift — a tampered snapshot value and an unbalanced
  elimination — is detected (`ASSERTION_FAILED`, export blocked, statement flagged);
  **runs never write member books**: byte-compare of every member's GL rows
  before/after the run shows zero changes.
- **Zero cross-tenant writes — attack suite**: write attempts through the reader
  role (INSERT/UPDATE/DELETE against member tables) fail at the DB grant level and
  produce audit rows; no code path issues member-tenant writes (static grep +
  runtime proof); the RLS policy set is byte-identical before/after the phase
  (policy snapshot diff) and the denial canary stays green.
- **Read-audit completeness**: on instrumented fixtures, audit rows == member-book
  reads for every run and every statement render from snapshots; an attempted read
  outside a group's membership is rejected and audited.
- **BR-056 suite**: run creation rejected while any member period is open (typed
  error, no job queued); succeeds after the member's period closes; `include_from`
  bounds consolidated periods; posted eliminations reject direct edits (409) and
  reverse only by counter-entry (a new audited DRAFT→POSTED pair).
- **FX translation fixtures**: dated stored rates honored exactly (INV-008 — base =
  amount × stored rate, no recomputation); 3-decimal currency member (KWD-style);
  missing rate on a translation date ⇒ `RATE_MISSING` fail-closed; the per-group
  method matches the T1 decision record.
- **Report contracts**: the 4 consolidation contracts validate against the
  REPORT_CONTRACT schema at startup; provenance boot checks (runs + member GL read
  models per REPORT_CATALOG §10); assertions green on golden datasets; export
  blocked on seeded failure; group-view labeling present in every output.
- **Isolation**: A1–A10 on the four new tables; foreign group/elimination ids in
  nested payloads → typed rejection, zero partial creation (S-04); A7 on all routes.
- **Permission checklist** for §3.15 (5 keys) incl. SoD on `consolidation.eliminations.post`
  and audit assertions on `consolidation.runs.execute` / group maintenance.

**Manual verification:**

1. Create a group (owner + two members — one in a non-base currency); set ownership
   percentages and an `include_from` for the second member.
2. Post one intercompany invoice pair inside the members; close the members' fiscal
   periods; author the elimination over the pair in the workspace (suggestion →
   confirm), post it, and verify the balanced journal in the parent's consolidation
   books and the eliminations-log row.
3. Attempt a run while one member period is open → rejected with `MEMBER_PERIOD_OPEN`;
   close the period; run → COMPLETED; open the consolidated TB/IS/BS — the INV-026
   footer assertion is green and a consolidated line drills down to the elimination
   journal; the USD member's lines show the dated-rate translation.
4. Attack checks: as member A's admin, probe member B's books through every
   consolidation surface → rejected; attempt a write through the service role →
   rejected at the DB grant and audited.
5. Reverse the elimination by counter-entry; verify the eliminations-log shows both
   entries; re-run → a new immutable snapshot; the statements reflect the reversal.

**Acceptance criteria (objective):** *(mirrored into
[PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md) — v2.0
section, PHASE-034.)*

1. **INV-026 is enforced with seeded-drift tests**: a completed run's consolidated
   statements equal Σ member statements (group currency, dated FX) − eliminations
   **line-by-line** on fixture data; seeded drift (tampered snapshot, unbalanced
   elimination) is detected and blocks exports; **no member book is ever written** —
   proven by byte-comparing member GL before/after runs.
2. **G-32 golden green with failure packs**: unbalanced eliminations rejected,
   already-posted eliminations rejected, member-period-open runs rejected (BR-056) —
   each with zero residue; eliminations post **only via the engine** into the
   parent's consolidation books (source_type `CONSOLIDATION_ELIMINATION`; INV-006
   chain; INV-013 idempotency; reversal-only counter-entries).
3. **Zero cross-tenant writes proven by the attack suite + a write-attempt audit
   test**: the reader role holds SELECT-only grants; write attempts fail at the DB
   level and are audited; member RLS policies and the RLS-denial canary are
   byte-identical to pre-phase state.
4. **Every member-book read is audited**: read-audit completeness tests pass on
   instrumented runs; no unaudited read path exists; reads outside group membership
   are rejected.
5. **BR-056 is enforced**: runs are rejected (typed, not warned) while any member's
   fiscal period for the run period is open; `include_from` bounds membership.
6. **FX translation uses dated stored rates (INV-008) with the OQ-V2-2-decided
   method**: the decision record amends DR-006 §4 before executor tasks merge;
   missing rates fail closed; no recomputation drift.
7. The four consolidated-statement contracts run on the PHASE-013 engine with
   REPORT_CONTRACT assertions green; statements are labeled group views and never
   replace member statutory books.
8. Permissions enforce per AUTHORIZATION_MATRIX §3.15 with SoD on
   `consolidation.eliminations.post` (creator ≠ approver); `consolidation.runs.execute`
   and group maintenance are audited; tenant-plane scoping holds.
9. The UI instantiates the sanctioned archetypes (Settings §8, Transaction Entry §4,
   Report Page §7) with AR+EN baselines; elimination authoring works over member-pair
   lines; statements drill down to elimination journals.
10. Docs validation green (ED-17 validator: phase range 001–034, ADR set 0001…0018);
    identifiers match the register exactly (§C tables, §D keys, §E purpose, §J reports,
    §K permissions).

**Performance & security considerations:** member GL reads are bounded by closed
periods and indexed `(tenant, period, account)`; **snapshots make statement renders
O(1) after a run** — statements never re-read member books; a run on the 5-member
fixture completes p95 ≤ 60 s with audit rows batch-written; snapshot storage grows
per run (retention is a reviewed ops policy — old snapshots stay immutable, never
mutated in place); the platform-plane grant is reviewed with the isolation suite at
every release and widened only by a new ADR; SoD and every post/run/maintenance action
are audited.

**Migration & rollback:** additive migration `0033_consolidation.sql` (4 tables + enum
+ the disabled-by-default reader grant); no destructive changes; posted eliminations
are ordinary parent-tenant journals — immutable and valid after any rollback, so
rollback = previous image (expand-compatible); snapshots are retained read-only;
disabling the feature = entitlement removal (the grant config off) with read-only
historical access per
[SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md).

## 7. Risks and Constraints

- **The platform-plane grant is a standing attack surface** (the accepted
  interoperability cost, ADR-0018): mitigated by SELECT-only scope on specific read
  models, per-read audit, the isolation attack suite + RLS-denial canary as permanent
  CI gates, and release-cadence grant review; **widening the grant or adding a second
  cross-tenant reader requires a new ADR**.
- **RISK-009 extension** (accounting bugs): G-32 and FX translation are new posting/
  derivation surfaces — goldens with failure packs and the INV-026 line-by-line
  reconciliation are the gate; drift between consolidated statements and member books
  is Sev-1.
- **RISK-016 extension** (boundary erosion): the reader must be the **only**
  cross-tenant path — dependency-cruiser rules enforce that no other module imports
  the grant or the reader; reports read snapshots, not member books.
- **Temporal-method complexity**: if the OQ-V2-2 decision selects temporal for any
  configuration, equity/FX-recycling complexity grows — the T1 decision record must
  bound exactly what ships at PHASE-034 (closing-rate proposed as the default).
- **Scale**: groups with many members or long histories — bounded jobs, snapshot
  versioning, and O(1) statement renders answer it; re-consolidation is always a new
  run (old snapshots immutable, so published statements never change underfoot).
- Constraint: **eliminations are real accounting work** — manual authoring is the
  design (DR-006 option A), not a gap; the auto-match engine stays a future decision.
- Constraint: consolidated statements are **derived artifacts** (ADR-0011/ADR-0017) —
  no second financial database, no report-time-only eliminations, no member-side
  postings.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-034-COMPLETION.md` with: the OQ-V2-2
  decision record link (T1), G-32 golden outputs + failure packs, the INV-026
  line-by-line reconciliation output on the fixture group, seeded-drift outputs,
  attack-suite + write-attempt audit outputs, read-audit completeness proof, member
  GL byte-compare proof, BR-056 rejection evidence, FX translation fixtures,
  permission/SoD checklist results, AR+EN statement renders (secondary evidence),
  and docs validation + validator output (ED-17).
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-034 →
  COMPLETE + roadmap-complete note), CURRENT_STATE, CHANGELOG,
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) (§9 phasing row —
  `reports.consolidated` live),
  [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (readiness row),
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (#44 verification), [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) +
  [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md) (Enterprise Depth gate
  evidence), [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md)
  (PHASE-034 + gate rows), [ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md)
  (OQ-V2-2 closed), and the [DR-006](../../decisions/accounting/DR-006-consolidation.md)
  §4 amendment (FX method).
- **Exit criteria:** all acceptance criteria green with evidence; the Enterprise
  Depth release gate is satisfied per
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) — consolidated statements
  reconcile to member books with eliminations proven (INV-026, G-32), zero
  cross-tenant writes demonstrated (ADR-0018), payroll/fixed-assets/notes suites
  green (INV-023…025, G-21…G-31), and stages 9–11 evidence shown as **additional to**
  — never a substitute for — the unchanged MVP/GA gates (ED-01).
- **Definition of Done:** consolidation module + the audited reader service +
  eliminations + runs + FX translation + the 4 report contracts + UI + the golden/
  invariant/attack suites merged; CI green (G-32, INV-026, isolation suite, RLS
  canary); docs synchronized; OQ-V2-2 closed; zero TODOs in the delivered scope.
- **Handoff instructions:** read the PHASE-034 completion report. **This is the final
  roadmap phase — no next phase exists.** Post-completion actions: (1) declare the
  **Enterprise Depth release gate** per MASTER_ROADMAP/RELEASE_STRATEGY, bundling the
  §026–034 completion evidence; (2) hand off to maintenance/operations — run-job
  monitoring + alerting ownership, snapshot retention/storage growth policy, the
  isolation suite + RLS-denial canary as permanent CI gates, the platform-plane grant
  review cadence, open-question tracking in
  [ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md),
  and the standing non-goals (deep-vertical operations per ED-11; intercompany
  automation, minority-interest waterfall, statutory filings per the ADR-0018 /
  DR-006 revisit triggers) as the future decision-record queue. **Next eligible
  phase: NONE — the 34-phase roadmap is complete; identify the maintenance/ops
  handoff only, do not implement.**
