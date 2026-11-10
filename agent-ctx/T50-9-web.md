# T50 — PHASE-019 Task 9 (web UI) — CRM screens + projects screen + GL filter

**Task ID:** T50 · **Agent:** T50 (crm web: 7 CRM screens + projects screen + GL filter)
**Status:** COMPLETE — all gates green (tails below). Evidence written early per
§18 lesson 7 and finalized after the gate pass.

## Scope (MASTER-PLAN §14 + §16 T50 row)

8 server pages + 8 client components under `apps/web` (the T41 byte-close pattern),
the GL project filter, the `TARGET_ROUTE_ALIASES` / `INDUSTRY_REPORT_TARGETS` /
`FALLBACK_CRUMBS` registrations, the api-types wire rows, `localizedCrmError` + the
status label helpers, ONE PHASE-019 dictionary block (AR authored first, exact
parity), and the permission-gated dashboard CRM card. **No backend changes**
(`pnpm --filter @erp/api typecheck` re-run clean — nothing leaked).

## Files created

### Server pages (the manufacturing-boms pattern verbatim: doc comment → isLocale/notFound → getDictionary → requireSessionToken → Promise.all fetchApi (primary first, supporting degrade to []) → 401→login / 403→ErrorState(no retry) / success → AppShell + client component)

| File | Fetches |
| --- | --- |
| `apps/web/app/[locale]/crm/pipeline/page.tsx` | primary `crm/leads?limit=200`; supporting `identity/users` (owner rep select — the users screen's actual route) + `partners/partners?limit=100` (MERGE targets). |
| `apps/web/app/[locale]/crm/tasks/page.tsx` | primary `crm/tasks?limit=200`; supporting `identity/users` + the four related-anchor pools (`crm/leads?limit=200`, `partners/partners?limit=100`, `crm/contracts?limit=200`, `crm/service-orders?limit=200`). |
| `apps/web/app/[locale]/crm/contracts/page.tsx` | primary `crm/contracts?limit=200` (the `{contract, isExpired}` read envelope); supporting `partners/partners?limit=100`, `accounting/projects`, `items/items?limit=100` (SERVICE), `treasury/receipts?limit=100` (advance tag pool). |
| `apps/web/app/[locale]/crm/billing/page.tsx` | primary `crm/billing-runs?limit=20` (the audit events); supporting `crm/contracts?limit=200` + `crm/contract-invoices?limit=200`. |
| `apps/web/app/[locale]/crm/time/page.tsx` | primary `crm/time-entries?limit=200`; supporting `accounting/projects`, `items/items?limit=100` (SERVICE), `crm/contracts?limit=200`, `identity/users`. |
| `apps/web/app/[locale]/crm/service-orders/page.tsx` | primary `crm/service-orders?limit=200`; supporting `partners/partners?limit=100`, `crm/contracts?limit=200`, `tenancy/branches`, `inventory/warehouses`, `items/items?limit=100`. |
| `apps/web/app/[locale]/accounting/projects/page.tsx` | primary `accounting/projects` (no supporting reads — the parent select reuses the list). |
| `apps/web/app/[locale]/accounting/gl/page.tsx` | + the `accounting/projects` supporting read (degrades to empty) handed to the GL browser as the filter pool. |

### Client components ("use client"; @erp/ui frozen set only — Badge, Button, DataTable, DatePicker, Dialog, Input, MoneyInput, Select, formatMoneyDisplay; locale prop + getDictionary; module-level QTY_RE/MONEY_RE; qtyCell/moneyCell/shortId; one busy key per mutation; bffFetch; ErrorNotice/SuccessNotice; DataTable + plain semantic tables in workspaces; Dialog + grid gap-3 sm:grid-cols-2 forms)

| File | Screen surface |
| --- | --- |
| `components/crm-pipeline.tsx` | status tabs NEW/QUALIFIED/CONVERTED/LOST + per-status counts (client-side over the full set) · create dialog (name/nameAr/phone/email/company/source select/owner rep/note) · convert wizard (mode NEW_PARTNER \| MERGE with the customer-partner select + kind CUSTOMER/BOTH — the partners-form kind labels reused) · lose dialog (reason 1–200) · edit (PUT) on NEW/QUALIFIED only — CONVERTED/LOST rows render read-only (the §2 immutability). |
| `components/crm-tasks.tsx` | tasks list (title/status/due/remind/assignee/related with cross-pool label resolution) + status filter (server refetch) · create dialog (title, relatedType + the per-type pool select, assignee, dueDate DatePicker, remindAt DatePicker + HH:MM time input composed as `${date}T${time}:00Z` — the zod datetime contract) · OPEN-only edit (PUT; carrying remindAt re-arms the sweep) · complete/cancel row actions · the activity timeline of the SELECTED task's related record (`crm/activities?relatedType&relatedId` client-side) · log-activity dialog (kind, occurredAt date+time, summary, durationMinutes int). |
| `components/crm-contracts.tsx` | list (contractNo/partner/title/feeModel/term/monthlyAmount money 4dp/status badge + the derived isExpired chip) + status filter (server refetch) · create dialog (customer partner, optional project, title/titleAr/scope/note, feeModel select, term DatePickers, RETAINER monthlyAmount MoneyInput, the default fee item stamped into the grid, MILESTONES multi-add editor) · workspace (GET :id): header card (partner/project/term/monthly/activatedAt/renewedTo/cancelReason/note), the §4 schedule grid (entryType/periodKey/milestone label/window/billDate/amount/feeItem/status badges), the billing-preview dialog (asOf → per-entry wouldInvoice lines + pullable count + per-entry needsNarrative warning chips + the periodLocked chip), the advances panel (list + tag dialog with the posted-receipts select, DEF/REL journal shorts) · lifecycle: DRAFT edit (the §18 lesson-1 PUT shape — feeItemId omitted ⇒ stored grid default; milestones ride only on MILESTONES) + activate + cancel(reason); ACTIVE preview + renew(optional term) + cancel; terminal read-only. |
| `components/crm-billing.tsx` | runs history table (at/actorId short/asOf/scanned/drafts/locked/duplicates/narrative — counts read defensively off the audit after-state) · the manual run dialog: asOf DatePicker + the DRY PREVIEW over every ACTIVE contract (per-contract `crm/contracts/:id/billing-preview?asOf` — no tenant-wide preview route is exposed; the honest per-contract fan-out) rendering due entries + wouldInvoice lines + locked/narrative chips, then POST `crm/billing-runs` → toast + history/drafts refetch · the drafts review: contract-invoices table (contract label/invoice short/periodKey/milestone short/createdAt/status badge) + the `/{locale}/sales/invoices` deep-link. All actions are focusable buttons in the focus-managed dialogs (keyboard-complete). |
| `components/crm-time.tsx` | entries table (date/project/feeItem/hours/rate/narrative/billable/earner/status) · from/to/projectId filters (server refetch — the row-32 params) · create dialog (entryDate, hours QTY6, SERVICE fee item, project with the case-policy hint, optional contract, fee earner, optional manual rate with the snapshot hint, narrative, billable yes/no) · DRAFT-only edit (PUT) · void (DRAFT/APPROVED) · the weekly review dialog (Monday weekStart — client Monday check + the typed server belt → POST `crm/time/timesheets/review` → reviewed-count toast + list refetch). |
| `components/crm-service-orders.tsx` | the job-cards workspace pattern: SO- list (orderNo/partner/contract/status) + status filter · create dialog (branch, customer partner, optional ACTIVE contract with the provenance hint, parts warehouse, note, SERVICE/PARTS lines editor — SERVICE: service item + estimatedHours + rate; PARTS: stock item + qty + price) · workspace (GET :id): header + the lines table (lineNo/type badge/item+desc/status badge/est→logged hours/qty/price/issue value + journal short) · lifecycle bar per status: DRAFT edit (PUT full-replace preserving line ids, tombstones server-side) + approve (partsIssueMode select reserve \| issue_immediate) + cancel(reason); IN_PROGRESS log-hours dialog (the SERVICE-lines select + hours) + complete + cancel; COMPLETED invoice + cancel; terminal read-only. |
| `components/accounting-projects.tsx` | list (code/name/parent/status) ordered by code · create dialog (code `^[A-Za-z0-9_-]{1,20}$` + hint, name, nameAr, parent select from the fetched list) · rename dialog (PATCH name/nameAr) · the status flip with a confirm dialog (close/reopen row actions gated per current status — both OPEN→CLOSED and CLOSED→OPEN). |

### The GL project filter (minimal additive)
`components/accounting-gl.tsx` + its page: a `projects` prop (the supporting read),
a `projectId` Select (accountingGlProjectFilter / accountingGlAllProjects), and the
param threaded into `/gl/accounts`, `/gl/accounts/:id/movements` and
`/gl/journal-register` queries — T44's param, the existing from/to posture.

### The dashboard CRM card
`components/owner-dashboard.tsx` + `app/[locale]/dashboard/page.tsx`: the page
computes `canCrm = session.permissions.includes("crm.leads.manage")` (the
dashboard's existing gating pattern) and the component renders ONE card (not a
widget framework) binding `GET /crm/dashboard-summary` — pipeline NEW/QUALIFIED
counts, follow-ups due today/overdue, contracts expiring 30d, upcoming billing
entries — with loading skeleton, honest error degrade (the usage-unavailable
note, never a fake number) and the `/crm/pipeline` deep-link.

## Files changed

| File | Change |
| --- | --- |
| `apps/web/lib/effective-config.ts` | `TARGET_ROUTE_ALIASES` += crm.pipeline→/crm/pipeline, crm.time→/crm/time, crm.contracts→/crm/contracts, crm.recurring_billing→/crm/billing, accounting.projects→/accounting/projects (one PHASE-019 comment block); `INDUSTRY_REPORT_TARGETS` += services.contract_revenue_schedule + services.time_billing_summary. |
| `apps/web/components/app-shell.tsx` | `FALLBACK_CRUMBS` += the 7 crm rows under ONE shared `crmNavSection` group + the projects row (one PHASE-019 block; the manufacturing decision-8 precedent — the projects row carries no group label because the registry has no accounting-section crumb key). |
| `apps/web/lib/api-types.ts` | ONE `// -- PHASE-019 (T50)` block mirroring the crm store Rows + the accounting ProjectRow exactly: `LeadRow`, `CrmTaskRow`, `CrmActivityRow`, `ServiceContractRow`, `ServiceContractReadRow`, `ScheduleEntryRow`, `PreviewInvoiceLine`, `BillingPreviewItemRow`, `BillingPreviewRow`, `ContractInvoiceRow`, `ContractAdvanceRow`, `TimeEntryRow`, `TimesheetReviewResult`, `ServiceOrderRow`, `ServiceOrderDetailRow`, `ServiceOrderLineRow`, `ProjectRow`, `BillingRunSummaryRow`, `BillingRunDraftRow`, `BillingRunResultRow`, `CrmDashboardSummary`. |
| `apps/web/lib/messages.ts` | `localizedCrmError` (all 26 crm typed codes → crmErr* keys; the posting-engine/accounting codes the crm surfaces rethrow — PERIOD_LOCKED, PROJECT_*, PURPOSE_NOT_MAPPED, POSTING_*, EXCHANGE_RATE_MISSING, PARTNER_NOT_FOUND — fall back to the API message; unknown codes → the localizedApiError ladder) + label helpers: `localizedLeadStatus`, `localizedLeadSource`, `localizedTaskStatus`, `localizedActivityKind`, `localizedRelatedType`, `localizedContractStatus`, `localizedFeeModel`, `localizedScheduleEntryType`, `localizedScheduleStatus`, `localizedAdvanceStatus`, `localizedTimeEntryStatus`, `localizedServiceOrderStatus`, `localizedServiceOrderLineStatus`, `localizedProjectStatus`. ALSO `localizedAccountingError` += PROJECT_NOT_FOUND→errorsNotFound, PROJECT_CODE_TAKEN→accountingProjectErrCodeTaken, PROJECT_CLOSED→accountingErrState (the T44 codes — additive, benefits every accounting surface). |
| `apps/web/i18n/dictionaries.ts` | ONE `// -- PHASE-019 (T50): crm navigation & screens` block appended at the END of all THREE blocks (interface + ar + en) — **370 keys each** (count below). AR authored first; existing blocks untouched. |
| `apps/web/components/accounting-gl.tsx` | the project filter (above). |
| `apps/web/components/owner-dashboard.tsx` + `app/[locale]/dashboard/page.tsx` | the CRM card + the permission gate (above). |

## Key count
**370 keys × 3 blocks** — nav/titles 8, GL filter 2, pipeline 49, tasks+activities 46,
contracts 92, billing 27, time 38, service orders 61, projects 19, dashboard 6, error
keys 26 (`crmErr*` — one per crm-errors.ts typed code). Reused existing keys where
they fit: `commonSave/commonCreate/commonCancel/commonOpen/commonClear/commonConfirm`,
`accountingColStatus/accountingColName/accountingColCode`, `accountingFromDate/accountingToDate`,
`errorsValidation/errorsNotFound`, `kindCustomer/kindBoth/partnersKindLabel` (the
convert-kind select), `mfgOrderBranch` (the SO branch label), `mfgOrderMaterialsWarehouse`
(the SO parts-warehouse label), `crmLeadColCreated` (the SO created column).
Machine-diff of every PHASE-019 key referenced anywhere in `apps/web` (components +
app + lib) against the interface block: **used-not-defined = ∅; defined-not-used =
crmNavSection only** — which app-shell.tsx consumes as the `FALLBACK_CRUMBS` group
key (`d[exact.group]`), so effectively 370/370 live.

## Verification output (exact tails)
```
$ pnpm --filter @erp/web typecheck
> @erp/web@0.1.0 typecheck /home/z/phase017_work/apps/web
> tsc --noEmit -p tsconfig.json
(clean — exit 0)

$ pnpm --filter @erp/web run lint
> @erp/web@0.1.0 lint /home/z/phase017_work/apps/web
> eslint .
(clean — exit 0)

$ pnpm run check:i18n-parity
== i18n key parity: ar=2926 keys, en=2926 keys ==
ar/en catalogs at 100% key parity; no empty values.

$ pnpm --filter @erp/api typecheck
> @erp/api@0.1.0 typecheck /home/z/phase017_work/apps/api
> tsc --noEmit -p tsconfig.json
(clean — confirms no backend edits leaked)

$ pnpm lint
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
```
No page smoke run (the T41 precedent — the brief explicitly skips a web dev server);
the typecheck + the byte-followed manufacturing/job-cards archetypes are the gate.
Money displays at 4dp (`formatMoneyDisplay(value, 4)`); hours/qty/rates render the
exact server strings with `dir="ltr"`; numerals tabular-nums throughout.

## Decisions & deviations (all additive, documented)
1. **No qualify button on the pipeline board.** The §11 API surface (rows 4–9) ships
   NO qualify route — the service's `qualify()` method is not HTTP-exposed, and the
   PUT schema carries no status field. The board offers edit/lose/convert on
   NEW/QUALIFIED (the two mutable states) and renders CONVERTED/LOST read-only;
   QUALIFIED rows (seeded/service-driven) display under their tab. Recorded rather
   than inventing an unsupported action.
2. **The users supporting route is `identity/users`** (the users screen's actual
   route), not the brief's `tenancy/users?limit=100` shorthand — the T41
   decision-1 precedent (follow the working path).
3. **The billing dry preview fans out per ACTIVE contract** — the billing controller
   exposes only GET/POST `billing-runs` (the tenant-wide `preview()` is
   service-internal, never routed). The dialog iterates the ACTIVE pool calling
   `crm/contracts/:id/billing-preview?asOf` each (read-only), rendering per-entry
   cards; the POST run itself is the authoritative sweep.
4. **remindAt/occurredAt compose as date + HH:MM UTC inputs** (DatePicker + mono
   time Input, default 09:00) → `${date}T${time}:00Z` — the zod `z.string().datetime()`
   contract; the pg `::text` echo is parsed back on edit (slice 0,10 / 11,16).
5. **One shared crm crumb section** (`crmNavSection`) for all six crm routes — the
   manifest's own L9 groups render registry-driven when professional_services is
   applied; the fallback is crumbs-only (the manufacturing decision-8 precedent).
   The projects row has no group label (no accounting-section crumb key exists in
   the registry dictionary) — the screen title alone is the honest leaf.
6. **The convert-kind select reuses the partner-form labels** (`kindCustomer` /
   `kindBoth` + `partnersKindLabel`) instead of new keys — the same vocabulary the
   partners screen already ships.
7. **Billing runs history counts render defensively** — `summary` is `unknown` on
   the wire (the audit after-state); the reader walks the run-result shape field
   by field and degrades to 0/—, never crashing on an unexpected payload.
8. **The projects status flip renders as two status-gated row actions** (close on
   OPEN rows, reopen on CLOSED rows) rather than one dynamic-label action — the
   frozen DataTable rowAction label is a static string; two explicit actions keep
   both keyboard-reachable.

## Handoff notes (phase owner)
- Routes: `/{locale}/crm/{pipeline,tasks,contracts,billing,time,service-orders}` +
  `/{locale}/accounting/projects` (+ the GL project filter) — nav aliases
  `crm.{pipeline,time,contracts,recurring_billing}` + `accounting.projects` + the
  two services.* report deep-links live in `lib/effective-config.ts`.
- i18n parity moved **2556 → 2926 keys (+370, exact AR/EN parity, no empty values)**.
- The completion report can cite: the 45-route PHASE-019 API surface is now fully
  surfaced on the web — all 45 routes reachable from these screens (read + write)
  except none: leads 6/6 (list/create/get/put/convert/lose — qualify unrouted,
  decision 1), dashboard-summary 1/1, tasks/activities 7/7, contracts 12/12,
  contract-invoices 1/1, billing-runs 2/2, time-entries 5/5 + review 1/1,
  service-orders 9/9, projects 3/3.
- Known minor seams (documented, not blocking): the dry preview's per-contract
  fan-out (decision 3) is N requests bounded by the ACTIVE pool; the users pool
  supporting read requires `identity.users.view` and degrades to the id-short
  display for tenants whose sales roles lack it (the honest degrade).
