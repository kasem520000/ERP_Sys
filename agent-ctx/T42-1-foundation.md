# T42 / Task 1 — Foundation: migration 0027 + registrations + engine/sales surface (PHASE-019)

**Agent:** T42 (foundation) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE (see gate tails below) — typecheck clean, api lint clean,
migrations.db.spec 7/7, check-rls catalog parity green, permissions-drift
243=243 (was 241=241), docs:validate 29/29. Expected mid-phase gap: the
billing/readonly-sweep DB spec fails on the unmounted 0027 routes (404 ≠ the
typed read-only 403) — owned by T44–T48 who mount the controllers, exactly the
T36 precedent (its manufacturing routes failed until T38/T39).

## Files created

- `apps/api/migrations/0027_crm_projects.sql` (1063 lines) — 11 RLS'd tenant
  tables (projects [the cost_centers clone with status OPEN|CLOSED], leads,
  crm_tasks, crm_activities, service_contracts [NO contract-level fee_item_id
  — §18 lesson 1], contract_billing_schedule, contract_invoices,
  contract_advances, service_orders, service_order_lines, crm_time_entries),
  widenings (notifications/notification_prefs.category += 'crm' on BOTH
  [0023 DROP/re-ADD]; stock_moves.source_type += 'service_order' [full list
  re-issued]; sales_invoices += contract_id/service_order_id/project_id
  [composite FKs RESTRICT + partial tenant indexes]; journal_lines +=
  project_id + ix_journal_lines_tenant_project; **manual_journal_lines +=
  project_id folded into THIS migration** [§18 lesson 4 — no 0028]), CoA 2130
  UPDATED IN PLACE (exists since 0008 as plain 'Accrued expenses' → 'Deferred
  revenue' / الإيرادات المؤجلة + DEFERRED_REVENUE marker, the 0025
  4200/SERVICE_REVENUE precedent), 7 permission seeds (5 re-asserting 0004 +
  new crm.contracts.bill + accounting.projects.manage), plan grants
  (array_cat 6 PHASE-019 feature keys → business+enterprise NOT-guard;
  enterprise already carried them from 0008; starter excluded), role grants
  (owner all 7; sales leads/tasks/activities; accountant contracts.bill +
  projects.manage), `industry.professional_services` v1.0.0 manifest seed —
  byte-identical to the regenerated docs JSON (verified True by script),
  no DELETE grants anywhere, `_schema_state` = 27.
- `docs/database/TABLES/crm-projects.md` + `docs/database/ERD/crm-projects.md`
  — the phase cluster docs (check:rls catalog parity; mermaid erDiagram with
  the 11 tables + edges).

## Files changed

- `docs/industries/templates/professional-services.md` (§12 reconciliation:
  bom_production capability entry DROPPED + note rewritten; report pin
  partners.ar_aging → ar.aging in BOTH the manifest JSON block and the
  reports-emphasized section) + regenerated
  `docs/industries/templates/manifests/manifest.professional_services.json`
  via `python3 scripts/extract_manifests.py` (diff: -bom_production, ar.aging).
- `apps/api/src/db/schema.ts` — drizzle mirrors of the 11 tables (PHASE-019
  block at the tail; `projects` beside costCenters) + new columns
  (salesInvoices.contractId/serviceOrderId/projectId + partial indexes;
  journalLines.projectId + ix; manualJournalLines.projectId).
- `apps/api/src/infra/db/migrations.ts` (+0027), `migrations.spec.ts` (last
  tag), `migrations/meta/_journal.json` (idx 26).
- `apps/api/src/modules/identity/infrastructure/permissions-drift.ts`
  (+0027 in PERMISSION_SEED_MIGRATIONS union) + `permissions-drift.spec.ts`
  (SEED_PATHS + 0027).
- `apps/api/src/infra/auth/route-permissions.ts` — the 45 PHASE-019 §11 rows
  (one comment block; controllers T44–T48 — the registry is declarative, the
  T36 precedent).
- `apps/api/src/__db__/isolation/tables.registry.ts` (11 tables; no delete
  grants) + `identity-isolation.db.spec.ts` (seedFixtures + OWN_ROW +
  MISMATCHED_INSERT for all 11; UUID families 91..99/a0/a1 fixture + -3000
  attack rows) + `identity-flows.db.spec.ts` (241→243 + title/comment) +
  `tenancy-provisioning.db.spec.ts` (purposes 24→25 ×3 + comments; accounts
  stay 50 — the 2130 row is an UPDATE, no new account row).
- **Engine surface (§8):** `journal-spec.ts` (JournalLineSpec.projectId? +
  ResolvedLine.projectId?), `posting-engine.ts` (PostingReadModel.findProject
  + the (6b) account-resolution-stage validation: PROJECT_NOT_FOUND /
  PROJECT_CLOSED, cached per post; spec→resolved copy; lineOf carries it) +
  `posting-engine.spec.ts` (model factory implements findProject),
  `posting-errors.ts` (+2 codes + factories), `posting-service.ts` (readModel
  wires store.findProjectById), `journal.store.ts` (insertLine/LINE_COLUMNS/
  JournalLineRow carry project_id; the manual-journal draft store:
  ManualJournalLineInput.projectId? [optional — T44 wires the consumers],
  replaceManualJournalLines inserts project_id, listManualJournalLines reads
  it, ManualJournalLine redeclares projectId: string | null).
- `accounting.store.ts` — the projects CRUD block (listProjects/
  findProjectById/insertProject/updateProject — the cost_centers clone).
- **Sales surface (§11):** `sales.store.ts` (SalesInvoiceRow/
  INVOICE_COLUMNS/insertSalesInvoice carry the trio; +findContractExists/
  findServiceOrderExists — commented infrastructure-level probes) +
  `sales/application/invoices.ts` (create() input += contractId/serviceOrderId/
  projectId [all optional nullable]; validation: project must exist AND OPEN
  [typed InvoiceLineInvalidError/SalesDocumentStateError]; contract through
  the port when wired else the raw read; service order raw probe;
  `setContractBillingPort({validateContract, onContractInvoicePosted})` null
  default; post() stamps projectId on EVERY line of the AR/cash journal AND
  the COGS journal [incl. the VAT legs]; after a successful post of a
  contract-linked invoice fires `onContractInvoicePosted(contractId, id,
  actorId)` same-UoW optional-chained).
- **Notifications (§3):** `inbox-service.ts` (NotificationCategory += "crm";
  notifyOwner emailTemplate union += "task_reminder") + `templates.ts`
  (EmailTemplate += "task_reminder" + AR/EN renderers — it did not exist).
- **Docs:** `ENTITY_CATALOG.md` (crm PHASE-019 section with entity table for
  the 10 crm tables + the projects row in §accounting; journal_lines/
  manual_journal_lines column notes; notifications category domains; Diagrams
  list += crm-projects; blueprint note updated), `AUTHORIZATION_MATRIX.md`
  (§3.1 accounting.projects.manage row + §3.8 crm.contracts.bill row —
  existing rows byte-identical; new CRM note + the manufacturing note's
  union now reads 0004+0024+0025+0026+0027), `MODULE_BOUNDARIES.md` (crm owns
  += contract_billing_schedule/contract_invoices/contract_advances/
  crm_time_entries with real table names; accounting owns += projects;
  P-019 notes), `POSTING_ENGINE.md` §4 (+the advance reclass + release rows,
  existing table style), `CHART_OF_ACCOUNTS.md` §3 (the 2130 row updated in
  place: Deferred revenue / الإيرادات المؤجلة ← DEFERRED_REVENUE).

## Migration summary (0027, 113 breakpoints)

11 tables all standard-shape (id/tenant_id/created_at/updated_at/version,
uq_<t>_id_tenant, composite 2-col FKs RESTRICT, RLS +
erp.apply_tenant_policy) + the §10 CHECKs/uniques/partial indexes exactly as
specified (leads lost/converted shapes; tasks pending-reminders partial ix;
activities related DESC ix; contracts term/monthly CHECKs + partial no-uq +
project FK; schedule entry-type/period-key-shape CHECKs + the two partial
uqs [entry-period WHERE period_key NOT NULL, milestone WHERE
entry_type='MILESTONE'] + bill_date ix; contract_invoices the two §4 partial
uqs + GENERATED-only status; advances HELD|RELEASED + amount>0 + the plain-
uuid journal anchors [production fg_journal_id precedent]; service_orders
cancel-requires-reason + partial no-uq; service_order_lines the job_card
tombstone shape + service-shape CHECK; time entries hours>0/rate>=0 +
pullable partial ix). Widenings per the 0023/0025/0026 patterns. Grants:
SELECT/INSERT/UPDATE on all 11 to erp_app (NO DELETE), SELECT to
erp_readonly/erp_definer; new columns on widened tables ride their existing
table-level grants.

## Drift counts before → after

- permissions: matrix 241 → **243**; seed 241 → **243** (union
  0004+0024+0025+0026+0027; +crm.contracts.bill, +accounting.projects.manage;
  the 5 crm base keys re-asserted idempotently — parseSeedKeys dedupes).
- isolation registry: 96 → **107** tenant tables (A1–A10 auto-extends).
- tenancy-provisioning purposes: 24 → **25** per tenant (accounts stay 50 —
  2130 is an in-place UPDATE, no new template row).
- industry template rows: 13 (professional_services already in the 0008
  index; 0027 converges its stub to the full manifest).

## Deviations / notes

- **2130**: the master plan's "verified gap: NO account/template row exists"
  was stale — 2130 exists since 0008 (plain 'Accrued expenses', purpose
  NULL). Applied the task instruction: UPDATE in place (0025 precedent).
  Existing tenants keep their tenant-owned 2130 row (provisioning copies
  happen at creation only); they map once — fail-closed PURPOSE_NOT_MAPPED
  until then (the documented pattern).
- **2130 name change** also updates CHART_OF_ACCOUNTS §3 (the template
  mirror) — noted in the row itself.
- **manual_journal_lines.project_id input is optional** in
  ManualJournalLineInput (insert coalesces to NULL) so existing consumers
  compile unchanged; the read side exposes projectId: string | null. T44
  wires the consumers (zod per line + journal-service buildSpec) — the
  master plan assigns that to T44; this is the substrate only.
- **service_order_lines FK is RESTRICT** (not job_card_lines' CASCADE): no
  DELETE grant exists on service_orders so the distinction is moot; the 0026
  family discipline (RESTRICT) wins.
- **schedule.invoice_id** (§4 lists it; §10 doesn't) — included: composite FK
  → sales_invoices RESTRICT; the INVOICED flip stamp. No index (not in §10).
- **crm_time_entries.billed_invoice_id** carries a composite FK RESTRICT
  (mirrors contract_invoices.invoice_id; §10 point 6 precedent) — the
  fixture/attack inserts honor it.
- **readonly-sweep**: ~27 state-changing 0027 routes are registered but
  unmounted → the sweep's first test fails (404 ≠ typed read-only 403).
  Documented mid-phase gap owned by T44–T48 (T36 mirror); the identity-flows
  checklist (route × owner/viewer grants) passes because the 0027 role
  grants cover owner and none of the new keys land on viewer.
- **Feature keys**: verified already in FEATURE_DEPS (crm.leads,
  crm.tasks_activities, crm.service_contracts, crm.recurring_billing,
  crm.service_orders, accounting.projects) — no change needed, per the task.
- Manifest embedding verified byte-identical (python assert embedded ==
  disk); no single quotes in the JSON so the SQL literal needs no escaping.

## Gate tails

- `pnpm --filter @erp/api typecheck` — clean · `pnpm --filter @erp/api run
  lint` — clean.
- `TMPDIR=$HOME/tmp-t42 npx vitest run --config vitest.db.config.ts
  src/__db__/migrations.db.spec.ts` — 7/7 (incl. re-apply no-op + check-rls
  catalog parity over the real schema).
- `pnpm run check:permissions-drift` — OK, matrix 243 = seed 243.
- `pnpm docs:validate` — 29/29.

(Refined after the full gate pass — isolation suite, tenancy specs, api unit
tests, depcruise; see the final report.)
