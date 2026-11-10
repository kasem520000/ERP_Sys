# T45 / Task 4 — CRM core: leads + tasks/activities/reminders (PHASE-019)

**Agent:** T45 (crm core) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — all gates green (tails below). Evidence written early per
§18 lesson 7, refined after the gate pass.

## Scope (MASTER-PLAN §2/§3/§11 rows 4–17/§16 T45)

CrmModule skeleton (leads + tasks + activities + reminder sweep +
dashboard-summary), registered in AppModule; SalesModule wiring (the
contract-billing port) lands with T47 — documented comment in crm.module.ts.

## Files created

| File | Content |
|---|---|
| `apps/api/src/modules/crm/crm.module.ts` | Module skeleton (imports Accounting/Partners/Notifications/Configuration/Audit; LeadsController + TasksController; LeadService + TaskService + ActivityService) + the pg-boss sweep registration: queue `crm.task-reminders-sweep`, cron `30 5 * * *`, payload `{system: true}`, handler → TaskService.sweepAllReminders (the inventory.module OnModuleInit pattern, catch-guarded identically). |
| `apps/api/src/modules/crm/domain/crm-errors.ts` | 9 typed errors: LEAD_INPUT_INVALID, LEAD_NOT_FOUND, LEAD_CONVERTED, LEAD_LOST_REASON_REQUIRED, LEAD_MERGE_TARGET_REQUIRED, TASK_NOT_FOUND, TASK_STATE, TASK_INPUT_INVALID, ACTIVITY_INPUT_INVALID (manufacturing-errors shape). |
| `apps/api/src/modules/crm/infrastructure/crm.store.ts` | Raw-SQL store (tenantTx, uuidv7): leads insert/find/list/patch/setConverted/setLost/countByStatus; tasks insert/find/list/patch (remindAt → notified_at := NULL re-arm)/completeTask/cancelTask/markTaskNotified/listDueTaskReminders (OPEN + remind_at <= now + notified_at IS NULL)/countFollowUps (dueToday/overdue FILTER counts); activities insert/list (occurredAt DESC); dashboard reads (countActiveContractsExpiringWithin, countPlannedBillingEntriesWithin); §6 read-only probes findPartnerForCrm (sales.store.findCustomerById precedent) + readTenantName. |
| `apps/api/src/modules/crm/application/lead-service.ts` | create/list/find/update/qualify/lose/convert + dashboardSummary; audits crm.lead.{created,updated,qualified,lost,converted}. |
| `apps/api/src/modules/crm/application/task-service.ts` | Tasks CRUD + complete/cancel (replay semantics) + sweepReminders (per-tenant) + sweepAllReminders (listActiveTenantIds + withTenant per tenant). |
| `apps/api/src/modules/crm/application/activity-service.ts` | Activities insert/list (timeline) + audit crm.activity.logged. |
| `apps/api/src/modules/crm/application/related-target.ts` | Shared related-anchor validator (LEAD via crm store; PARTNER via the partners probe → PartnerNotFoundError; CONTRACT/SERVICE_ORDER probes land T46/T48 — documented, TODO-free). |
| `apps/api/src/modules/crm/presentation/leads.controller.ts` | §11 rows 4–9 + 17 under @Controller("api/v1/crm"): leads CRUD + convert + lose + dashboard-summary; zod (discriminated union on convert mode), envelopes, requireIdentity. |
| `apps/api/src/modules/crm/presentation/tasks.controller.ts` | §11 rows 10–16: tasks CRUD + complete + cancel + activities GET/POST. |
| `apps/api/src/__db__/crm/leads.spec.ts` | 8 tests, tenant 64646464-6464-6464-6464-646464646464 (verified unused). |
| `apps/api/src/__db__/crm/tasks.spec.ts` | 10 tests, tenant 65656565-6565-6565-6565-656565656565 (verified unused). |
| `agent-ctx/T45-4-crm-core.md` | This file. |

## Files changed

- `apps/api/src/app.module.ts` — CrmModule registered after ManufacturingModule.
- `apps/api/src/infra/http/error.filter.ts` — the PHASE-019 T45 CRM block:
  404 (LEAD_NOT_FOUND, TASK_NOT_FOUND, LEAD_MERGE_TARGET_REQUIRED), 409
  (LEAD_CONVERTED, TASK_STATE), 422 (LEAD_INPUT_INVALID,
  LEAD_LOST_REASON_REQUIRED, TASK_INPUT_INVALID, ACTIVITY_INPUT_INVALID).

## Convert-flow decisions (documented)

- NEW_PARTNER → PartnerService.create (BR-025 auto code; name/nameAr from the
  lead, kind from the request CUSTOMER|BOTH); phone/email carried via
  PartnerService.addContact (role null, isPrimary) when either is present.
- MERGE → partnerId required (zod discriminated union → 422 when absent);
  service re-validates: target exists, not archived, kind CUSTOMER|BOTH (a
  supplier-only partner is not a sales conversion target) → else typed
  LEAD_MERGE_TARGET_REQUIRED (A7 404 parity).
- Both → one setLeadConverted UPDATE (status + partner_id + converted_at; the
  ck_leads_converted_shape CHECK is the belt) + audit `crm.lead.converted`
  with mode + partnerId in the after-state. No ledger effects (§2; the spec
  asserts journal_lines count 0 for the tenant after the full flow).
- Immutability guard (assertMutable): PUT/qualify/lose/convert run while
  NEW/QUALIFIED only. CONVERTED → LEAD_CONVERTED ("immutable — the partner
  link is permanent provenance"); LOST hitting the guard carries an honest
  LOST message under the same stable code LEAD_CONVERTED (the task
  instruction's "typed LEAD_CONVERTED otherwise"); zero residue (the spec
  pins updatedAt/convertedAt/partnerId byte-identical after the throws).
- qualify-on-QUALIFIED = legal replay (returns the stored row, INV-013);
  complete-on-DONE / cancel-on-CANCELLED likewise; cross-terminal → TASK_STATE;
  PUT on terminal tasks → TASK_STATE.
- Task PUT carrying remindAt RE-ARMS the sweep (notified_at := NULL) so a
  postponed reminder fires again under the fresh dedupe key
  `crm-task-reminder:<taskId>:<remindAt>` (remindAt text as stored).
- Sweep notification: InboxService.notifyOwner (record + email leg, prefs-
  aware, owner-targeted — the master plan's owner-facing emit) with category
  "crm" / severity "info" / actionUrl "/crm/tasks"; email template
  "task_reminder" variables {title, tenantName, dueDate, tasksUrl} — exactly
  the templates.ts contract (grepped before building; tenantName via the
  local readTenantName probe, tasksUrl from env.WEB_BASE_URL — the
  usage-service URL precedent). Sweep audit `crm.task_reminders_swept`
  (system action, actorId null, anchored on the first notified task — the
  inventory.reservations_swept pattern).
- Email-layer note (found by the spec): the email leg coalesces content-
  identical sends by fingerprint (EmailService.enqueue's deterministic jobId
  — the notifications-email contract), so a re-armed reminder whose variables
  are unchanged produces the second in-app row but one email; a postponement
  that moves dueDate (the realistic case) produces both. Pinned in the spec.

## Deviations

- None vs the task card. Decisions above are within-card clarifications
  (LOST-guard wording; MERGE kind validation; email coalescing note).

## Verification (repo root; DB runs used TMPDIR=$HOME/tmp-t45)

- `pnpm --filter @erp/api typecheck` — clean (a transient `zz-probe-t44`
  file from T44's parallel run appeared mid-session and was gone by the
  final pass; not T45's).
- `pnpm --filter @erp/api run lint` — clean.
- `cd apps/api && TMPDIR=$HOME/tmp-t45 npx vitest run --config
  vitest.db.config.ts src/__db__/crm/` — **2 files, 18/18 green**
  (leads: create/audit, PUT+qualify+replay, list filters, lose
  reason-required + LOST-closed, convert NEW_PARTNER [P-xxxxxx + contact +
  immutable + zero residue + zero journal rows], convert MERGE [audited;
  unknown/supplier rejected; failed attempts leave no residue], timeline
  DESC + dangling anchors + bad kind, dashboard-summary [pipeline exact,
  follow-ups zero, 2-of-4 expiring contracts, 1-of-3 planned billing];
  tasks: create+anchor validation [LEAD/PARTNER not-founds, enum/shape,
  CONTRACT gap documented], list filters, PUT re-arm + terminal TASK_STATE,
  complete/cancel replays + cross-terminal TASK_STATE, sweep due →
  notification row [crm/info//crm/tasks/owner/dedupe key] + notifiedAt +
  system audit + REAL SMTP email [body variables + base64 RFC-2047 subject
  decoded], re-run no-dup, boundary inclusive (store-level exact-equality
  probe) + future no-bill, CLOSED never sweeps + re-arm fires again (2 rows,
  2 mails with distinct dueDates), sweepAllReminders platform pass).
- `TMPDIR=$HOME/tmp-t45 npx vitest run --config vitest.db.config.ts
  src/__db__/jobs.db.spec.ts src/__db__/notifications-email.db.spec.ts` —
  9/9, no regressions. (Plus identity-flows 21/21 and inbox 8/8 — both boot
  AppModule with the new CrmModule + sweep registration.)
- `pnpm --filter @erp/api test` — 25 files, 274/274 green.
- `pnpm run lint:depcruise` — 0 violations (939 modules, 6198 deps).
- `pnpm run check:permissions-drift` — OK, matrix 243 = seed 243.
- **Readonly-sweep gap narrowing (documented, expected mid-phase fail):** all
  9 of T45's state-changing routes (§11 rows 5/7/8/9/11/12/13/14/16) now
  return the typed 403 `tenancy/subscription-read-only` through the real
  pipeline (log-verified); violations down from T42's ~27 to **18**, all
  owned by T46 (contracts 6 + time-entries/timesheets 4), T47 (billing-runs
  1), T48 (service-orders 7... precisely: contracts POST/PUT/activate/cancel/
  renew/advances + time-entries POST/PUT/void + timesheets/review +
  billing-runs POST + service-orders POST/PUT/approve/log-hours/complete/
  invoice/cancel = 18).

## Handoff notes for T46–T50

- crm.store.ts is the single crm-owned writer; append contract/time/service-
  order slices banner-style (the manufacturing.store organization).
- The reminder-sweep registration shape lives in crm.module.ts; T47's
  billing-run job (`crm.contract-billing-run`, cron `0 3 1 * *`) registers
  the same way (queue + work + schedule, catch-guarded).
- Both controllers use @Controller("api/v1/crm"); T46/T48 controllers should
  do the same so route-permissions rows match byte-for-byte. LeadsController
  owns "leads/*" + "dashboard-summary"; TasksController owns "tasks/*" +
  "activities".
- The related-anchor seam: `apps/api/src/modules/crm/application/related-target.ts`
  — T46 adds the CONTRACT probe, T48 the SERVICE_ORDER probe (both currently
  accepted as uuid-shaped ids; the tasks spec pins the gap with a comment).
- TaskService's sweep composes InboxService.notifyOwner + EMAIL_SERVICE —
  T47's billing notifications can reuse the same constructor shape.
- The leads.spec dashboard fixture inserts service_contracts/
  contract_billing_schedule rows directly via superuser (T46 owns the
  services) — T46's specs may want richer fixtures, but the summary SQL is
  already pinned (2-of-4 expiring incl. the effectively-expired ACTIVE;
  1-of-3 planned billing).
- Email coalescing note (above) applies to any repeated notification email:
  vary the variables or accept the single content-identical send.
