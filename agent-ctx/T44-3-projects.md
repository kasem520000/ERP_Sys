# T44 / Task 3 — Projects dimension: controller + GL filters + manual-journal projectId + projects.spec (PHASE-019)

**Agent:** T44 (projects dimension) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE. All gates green (tails below); zero deviations from the
task contract (the first execution's only deviation — the 0028
manual_journal_lines gap — did NOT recur: T42 folded it into 0027, verified).

## Scope recap (§8 + §16 T44 row + task contract)

1. Controller trio (accounting.controller.ts) — cost-centers mirror.
2. GL project filters (gl-queries + journal.store feeds + GL HTTP threading).
3. Manual-journal projectId (journals.controller zod + journal-service buildSpec).
4. DB spec apps/api/src/__db__/accounting/projects.spec.ts (5 groups a–e).
5. Docs: ENTITY_CATALOG verification + conditional GL-docs note.

## T42 substrate verification (grep, all confirmed before building)

- `manual_journal_lines.project_id` IS in 0027 line 645 (§18 lesson 4 folded —
  no 0028 this run). projects table 0027:61 (uq tenant+code, code-shape CHECK,
  status CHECK OPEN|CLOSED, composite parent FK RESTRICT); sales_invoices
  .project_id 603; journal_lines.project_id 635 + ix_journal_lines_tenant_project.
- accounting.store: listProjects 484 / findProjectById 492 / insertProject 500 /
  updateProject 514 (COALESCE status patch — OPEN↔CLOSED both allowed).
- journal.store insertLine carries project_id; the manual-journal draft
  substrate (ManualJournalLineInput.projectId? + replace/list) shipped by T42.
- Engine stage (6b): PROJECT_NOT_FOUND / PROJECT_CLOSED, cached per post;
  ResolvedLine.projectId copied through; journal-spec JournalLineSpec.projectId.
- route-permissions rows 2406–2422 match §11 VERBATIM (GET view; POST+PATCH
  accounting.projects.manage). No new rows for GL query params (by contract).
- Sales surface: create() projectId existence+OPEN-validated; post() stamps
  EVERY line of the settlement journal AND the COGS journal (incl. VAT legs).
- statement-queries.ts: NO dimension filter exists (scope = dates/asOf only)
  → SKIP per the task contract; no routes invented.

## Files (mine) — what changed

| File | Change |
|---|---|
| apps/api/src/modules/accounting/presentation/accounting.controller.ts | The projects trio: GET `projects` (journal_entries.view) via listProjects; POST `projects` (projects.manage; zod code 1..20 + `^[A-Za-z0-9_-]{1,20}$`, name 1..200, nameAr nullish, parentId uuid nullish; 23505 on uq_projects_tenant_code caught via the tier-service cause-chain walk → typed ProjectCodeTakenError 409; audit `accounting.project_created`); PATCH `projects/:id` (projects.manage; name/nameAr/status OPEN\|CLOSED; pre-read for the audit before + the not-found; audit `accounting.project_updated` + a distinct `accounting.project_reopened` event when CLOSED→OPEN — the accounting.period_reopened naming precedent) |
| apps/api/src/modules/accounting/domain/accounting-errors.ts | + ProjectNotFoundError (PROJECT_NOT_FOUND, the module's 404 shape) + ProjectCodeTakenError (PROJECT_CODE_TAKEN, the code-taken 409 family); both appended to ACCOUNTING_NOT_FOUND_ERRORS where applicable |
| apps/api/src/infra/http/error.filter.ts | ProjectNotFoundError → 404 (accounting not-found list); ProjectCodeTakenError → 409 (natural-key conflicts list) |
| apps/api/src/modules/accounting/infrastructure/journal.store.ts | trialBalances/accountMovements/journalRegister gain optional `projectId` filtering journal_lines.project_id (the register keeps only entries carrying ≥1 project line, totals summed over those lines alone); GlMovementRow + the movements SELECT expose `projectId` (mirrors costCenterId) |
| apps/api/src/modules/accounting/application/gl-queries.ts | accountBalances/accountMovements/journalRegister pass `projectId` through |
| apps/api/src/modules/accounting/presentation/gl.controller.ts | `projectId` query param threaded on /gl/accounts, /gl/accounts/:id/movements, /gl/journal-register (unvalidated passthrough — exactly the existing from/to/sourceType posture; query params are not registry rows) |
| apps/api/src/modules/accounting/presentation/journals.controller.ts | lineSchema += `projectId: z.string().uuid().nullish()`; the create/patch/recurring line maps copy it (the costCenterId pattern verbatim) |
| apps/api/src/modules/accounting/application/journal-service.ts | DraftLineInput += projectId; create/update replaceManualJournalLines maps copy it; buildSpec copies `projectId: line.projectId ?? undefined` |
| apps/api/src/__db__/accounting/projects.spec.ts | The 5-group DB spec (below) — dedicated tenant 63636363-6363-6363-6363-636363636363 (verified unused; only the isolation suite's line-id family 63636363-0000-4000-8000-…00X shares the prefix, no collision) |
| docs/accounting/POSTING_ENGINE.md | §1 JournalLineSpec type block += `projectId?: UUID` line (the stamping-path doc for the T44 wiring) |

## The DB spec (projects.spec.ts) — coverage

- **(a) trio over the REAL HTTP pipeline** (AppModule + free port, the
  master-data-http/readonly-sweep pattern): POST creates (bilingual + parent
  link + OPEN default), GET lists ordered by code, bad code shape → 422 zod;
  duplicate code → typed **409 PROJECT_CODE_TAKEN**; unknown AND foreign
  (real id, other tenant — A7 parity) PATCH ids → identical **404
  PROJECT_NOT_FOUND**; PATCH rename + OPEN→CLOSED + CLOSED→OPEN all audited
  (project_updated ×3 with the status trail + exactly one project_reopened).
- **(b) line stamping**: manual journal with projectId on lines →
  manual_journal_lines.project_id (draft substrate) AND journal_lines.project_id
  (posted) both persist the stamp (2 layers asserted).
- **(c) fail-closed stamps**: CLOSED project post → typed PROJECT_CLOSED,
  zero residue (no entry for the source key; tenant entry count unchanged).
  Unknown id: the DRAFT substrate cannot even carry it (composite FK
  RESTRICT rejects the insert — the DB backstop), so PROJECT_NOT_FOUND is
  exercised via a direct engine spec post (the fixtures' manualSpec pattern)
  → typed rejection + zero residue. Documented in the spec comment.
- **(d) GL slice equality**: J1 (CASE-01) + J2 (CASE-02) + J3 (unstamped) —
  project-filtered balances equal the unfiltered slice sums per account and
  side (addExact identity asserts incl. J3's unstamped contribution);
  movements feed (1 movement, project column, slice running balance);
  register (only entries carrying the project's lines, totals over those
  lines); the threaded HTTP query param asserted on all three GL routes.
- **(e) sales-invoice stamping**: setupSalesFixture() reused for the tenant
  bootstrap (the established cross-suite pattern — pos/distribution/vehicles
  already draw from it); CREDIT invoice, flow B (warehouse S-WH), 2 × item A
  @ 100 + STD 15%: settlement journal (sales_invoice:post) = DR AR 230.0000
  (partner) · CR revenue 200.0000 · CR VAT 30.0000 — ALL 3 lines stamped;
  COGS journal (sales_invoice:cogs) = DR COGS 120.0000 · CR inventory
  120.0000 (WAC 60 × 2) — BOTH lines stamped; invoice row carries the header
  stamp. (Self-approval guard: create S_SALES, approve S_ACTOR — the
  quickPostedInvoice shape.)

## Docs decisions

- ENTITY_CATALOG accounting rows verified COMPLETE (projects row §accounting;
  journal_lines/manual_journal_lines project_id notes; sales_invoices trio) —
  no additions needed.
- GL-filter note: **SKIPPED per the contract** — no doc in docs/accounting
  enumerates GL query params (grep "cost center": JOURNAL_RULES §1 is the
  journal LINE dimension list, §13.79 a one-line "filters mirror GL report
  params" comment; the param table that exists is REPORT_CATALOG's
  journal-register row in docs/reporting — T49's §13 report surface, not
  docs/accounting). Recorded here instead of inventing rows.
- POSTING_ENGINE.md §1 type block gained the projectId line (the one-line
  gap in T42's shipped doc surface for the spec type my wiring feeds).
  Observation for the phase closer: POSTING_ENGINE.md §3's error table still
  lacks the two engine codes (PROJECT_NOT_FOUND/PROJECT_CLOSED) — T42's doc
  plane, left untouched (flagged, not fixed — engine taxonomy is §8-T42
  territory; the closer's docs pass can fold it in).

## Verification (repo root; DB runs use TMPDIR=$HOME/tmp-t44)

- `pnpm --filter @erp/api typecheck` — clean.
- `pnpm --filter @erp/api run lint` — clean.
- `TMPDIR=$HOME/tmp-t44 npx vitest run --config vitest.db.config.ts
  src/__db__/accounting/projects.spec.ts` — **7/7** (5 describe groups).
- Full accounting folder (same harness) — **8 files, 52/52** (no regressions).
- `pnpm --filter @erp/api test` — **25 files, 274/274**.
- `pnpm run lint:depcruise` — 0 violations (939 modules, 6198 deps).
- `pnpm run check:permissions-drift` — OK, matrix 243 = seed 243.
- `pnpm docs:validate` — **29/29**.
- Extra diligence: billing/readonly-sweep.db.spec.ts re-run — my 3 mounted
  routes now return the typed 403 (absent from the violations list); the 18
  remaining violations are ALL unmounted crm routes (T45–T48's scope, the
  documented mid-phase gap) — strictly improved from T42's ~27.

## Deviations

- None. (First execution's only deviation — the 0028 gap — did not recur.)
- Notes, not deviations: (1) statement-queries skipped per contract (no
  dimension filter exists there); (2) docs GL note skipped per contract (no
  GL param enumeration in docs/accounting); (3) POSTING_ENGINE §1 one-liner
  added (T42 doc gap in the exact type my task wires); §3 engine-code rows
  flagged for the closer.
