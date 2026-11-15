# T-12/T-13 — PHASE-045 web screens (HR attendance + leave + shifts/roster)

**Task ID:** T-12 (attendance register + exception board + device-import wizard) and
T-13 (leave + shifts/roster) · **Agent:** T12-13 (hr web: 4 server pages + 4 client
boards + wire types + i18n + HR error map)
**Status:** COMPLETE — all four gates green (tails below).

## Scope (PHASE-045 T-12/T-13 briefs)

Three HR screen families under `apps/web`, following the payroll screens byte-close:
`/{locale}/hr/attendance` (daily register + exception board + capture + derive +
the `?date=` deep link), `/{locale}/hr/attendance/import` (3-step device-import
wizard + batches log + anomaly quarantine), `/{locale}/hr/leave` (requests +
balances + types + accrual/rollover), `/{locale}/hr/shifts` (templates + the roster
editor grid + the rotation generator). **No backend changes, no NAV_ITEMS changes
(T-15 is the supervisor's), no existing screens touched.**

## Files created

### Server pages (the payroll-runs pattern verbatim: doc comment citing
PAGE_ARCHETYPES + the PHASE-045 task id → isLocale/notFound → getDictionary →
requireSessionToken → Promise.all fetchApi (primary first, references degrade) →
401→login / 403→ErrorState(no retry, errorsForbidden) / success → AppShell
pagePath + dictionary title)

| File | Fetches |
| --- | --- |
| `apps/web/app/[locale]/hr/attendance/page.tsx` | primary `hr/attendance/register?date=` (the `?date=` deep link, default today — trailing-week exception seed rides the same render); supporting `hr/attendance/exceptions?from=&to=&pageSize=25` + `payroll/employees` (degrades to the register's own employees). |
| `apps/web/app/[locale]/hr/attendance/import/page.tsx` | primary `hr/attendance/import/batches?pageSize=25` (the `hr.attendance` review key); supporting `hr/attendance/import/anomalies?status=PENDING&pageSize=25` + `hr/attendance/import/mapping` (403 → the wizard-hidden `mappingForbidden` flag — the 0086 permission split) + `payroll/employees`. |
| `apps/web/app/[locale]/hr/leave/page.tsx` | primary `hr/leave/requests?from={y}-01-01&to={y}-12-31&pageSize=25` (the API's from/to are REQUIRED — the overlap filter's range); supporting `hr/leave/types` + `hr/leave/balances?year=` + `payroll/employees`. |
| `apps/web/app/[locale]/hr/shifts/page.tsx` | primary `hr/shifts?limit=500`; supporting `hr/roster?from={monday}&to={sunday}&pageSize=5000` (the current ISO week; `hasMore` passes as `rosterTruncated` — the joint-review pagination law) + `payroll/employees`. |

### Client components ("use client"; @erp/ui frozen set only — Badge, Button,
Checkbox, DataTable, DatePicker, Dialog, Input, Pagination, Select, Textarea,
useToast; locale prop + getDictionary; module-level DATE_RE/TIME_RE/DAYS_RE regex
constants; one busy key per mutation; bffFetch re-fetch on filter/mutation with the
runRef stale-response guard; ErrorNotice/SuccessNotice/InfoNotice; DataTable for
registers + plain semantic tables for the pivot grids; mono + dir="ltr" for every
code/date/time/decimal run)

| File | Screen surface |
| --- | --- |
| `components/hr-attendance-board.tsx` | register date filter (DatePicker → router.push `?date=` — the server page re-fetches; a date-change effect re-seeds the capture date + resets the exception window to the trailing week) · the register DataTable (employee, check-in/out, derived-status Badge with `isException` → primary tone, shift code, late/early-leave/worked/overtime minute facts — `—` for the never-computed null, danger text for late>0, source, note) · the checkout action rendered INSIDE the open-session check-out cell → Dialog (BR-082's one-shot fill) · the capture card (employee select over the merged register+payroll pool, work-date DatePicker, HH:MM check-in/out Inputs composed as `${date} ${time}:00` — the INSTANT contract, MANUAL/DEVICE source with the deviceRef required-on-DEVICE law, note; empty strings NEVER ride — the TEXT min(1) law) · the derive card (from/to → POST attendance/derive → the {days,rowsUpdated,absentSynthesized} toast → router.refresh + exceptions reload) · the exception board (from/to/employee filters + Pagination, re-fetch through the BFF; columns date/employee/status/late/worked/overtime/punch-span/note). |
| `components/hr-attendance-import.tsx` | the 3-step wizard (the budget-import-wizard pattern): upload (file read as text via `file.text()` OR paste; fileName required 1–200; the mapping editor — column indexes 0–49 with "" = the absent optional column, ISO/DMY/MDY, skipHeader, comma/semicolon/tab; the PUT mapping save as tenant default; InfoNotice default-vs-stored state) → preview (POST import/preview `{content, mapping}` — ZERO writes; DefList rowCount/sessions/anomalies/fingerprint + the paired-sessions table (lineIn→lineOut) + the typed anomaly table (reason/detail/rawLine)) → commit (POST import/commit `{content, fileName, mapping, deviceRef?, note?}` → the imported/quarantined toast → done step; the batches + anomalies reload). Below: the batches log (fileName/createdAt/rows/imported/quarantined(danger)/deviceRef/note + Pagination) and the anomaly quarantine (status filter PENDING/RESOLVED/REJECTED + Pagination + the resolve Dialog — REJECT with note, or IMPORT-with-corrections: employee select + `YYYY-MM-DD HH:MM` check-in (+`:00`) + optional check-out + note — the resolveBody zod shape). |
| `components/hr-leave-board.tsx` | the requests register (from/to/status/employee filters + Apply + Pagination through the BFF; employee/type/span/days(decimal string)/status Badge/note+decisionNote columns) · the decision Dialog (approve/reject/cancel + optional note — PENDING only, the 0083 CHECK; `/approve|/reject|/cancel` paths) · the create card (employee, ACTIVE type select, start/end DatePickers, note → POST leave/requests) · the balances panel (year select 2020..Y+1 → GET leave/balances?year=; entitlement/carried/used/remaining as exact decimal strings, remaining bold) · the types card (create: code/name/nameAr/paid/accrualDaysPerYear/monthlyGrant/prorateJoiners/carryOverCapDays — the DAYS decimal-string law; table + activate/deactivate row actions) · the accrual/rollover card (type + year + optional asOfMonth → POST leave/accrual → {cells,employees} toast; the rollover rides fromYear=Y−1→toYear=Y → {cells,count,days} toast; both reload balances). |
| `components/hr-shifts-board.tsx` | the templates card (create: code/name/nameAr/startTime/endTime(HH:MM or HH:MM:SS)/grace 0–240/break 0–480/isNight/note; the edit Dialog PUTs the FULL patch set — nameAr/note ride explicitly so the server's null-when-absent arms never clear them; activate/deactivate row actions) · the roster editor (from/to + Apply → the page WALK through the BFF: pageSize=5000, loop while hasMore, cap 10 pages → the truncated InfoNotice; the date × employee pivot grid — employees = roster cells ∪ payroll pool sorted by code, ≤92 columns, sticky header, every cell a button with an aria-label → the cell Dialog: shift Select ("" = the explicit MANUAL day-off cell via PUT roster/cell `shiftId: null`) + note + the separate Clear button (POST roster/cell/clear — the DELETE), the existing cell's source provenance shown) · the rotation generator (the employee checkbox list in a max-h-72 scroll — the house long-list rule; the 7 Monday…Sunday pattern selects reusing distDay* labels, "" = day off (null); from/to DatePickers → POST roster/rotation → the {cellsWritten,manualPreserved} toast + grid reload). |

## Files changed

| File | Change |
| --- | --- |
| `apps/web/lib/api-types.ts` | ONE `// -- PHASE-045 (T-12/T-13)` block: `AttendanceRecordRow`, `AttendanceExceptionsPage`, `AttendanceImportMapping`, `AttendanceImportMappingRead`, `AttendanceImportSession`, `AttendanceImportPreviewAnomaly`, `ImportPreviewResult`, `AttendanceDeriveResult`, `ImportBatchRow`, `ImportCommitResult`, `ImportBatchesPage`, `ImportAnomalyRow`, `ImportAnomaliesPage`, `LeaveTypeRow`, `LeaveBalanceRow`, `LeaveRequestRow`, `LeaveRequestsPage`, `LeaveAccrualResult`, `LeaveRolloverResult`, `HrShiftRow`, `RosterCellRow`, `RosterPage`, `RosterRotationResult` — field names mirror the store SELECT aliases EXACTLY (checked against attendance.store.ts / attendance-import.store.ts / leave.store.ts / hr.store.ts + the service return types). |
| `apps/web/lib/messages.ts` | `localizedHrError` (every hr-errors.ts + leave-errors.ts typed code → hrErr* keys; unknown → the localizedApiError ladder) + label helpers `localizedHrAttendanceStatus` (the six derivation verdicts), `localizedHrLeaveStatus`, `localizedHrAnomalyStatus`, `localizedHrAnomalyReason` (the eight quarantine reasons), `localizedHrPunchSource`, `localizedHrRosterSource`. |
| `apps/web/i18n/dictionaries.ts` | ONE `// PHASE-045 (T-12/T-13)` block appended at the END of all THREE blocks (interface + ar + en) — **206 keys each** (count below). AR authored first, professional ERP tone per the neighboring strings; existing blocks untouched. |

## Key count
**206 keys × 3 blocks** — titles/sections 15, column labels 21, statuses 6+4+3,
anomaly reasons 8, sources 4, filters/pagination 6, capture/checkout 11, derive 3,
empty states 3, import wizard 51, leave 36, shifts/roster 25, errors 15
(`hrErr*`). Reused existing keys where they fit: `kindFilterAll`, `retryLabel`,
`errorsForbidden`, `commonOpen/commonEdit/commonSave/commonCancel`,
`budgetFormInvalid` (the shared invalid-input refusal), `budgetsEmpty`-style
empties are new (`hr*Empty`), `instWizStepOf`/`instWizBack` (the wizard chrome),
`distDayMon…distDaySun` (the rotation axis). Machine-diff of every hr key
referenced in components + app + lib against the interface block:
**used-not-defined = ∅; defined-not-used = ∅** (the four titles live in the server
pages' AppShell `title=` props; hrImportStepCommit labels the done step).

## Verification output (exact tails)
```
$ pnpm --filter @erp/web typecheck
> @erp/web@0.1.0 typecheck /home/z/ERP_Sys/apps/web
> tsc --noEmit -p tsconfig.json
(clean — exit 0)

$ pnpm --filter @erp/web lint
> @erp/web@0.1.0 lint /home/z/ERP_Sys/apps/web
> eslint .
(clean — exit 0)

$ pnpm --filter @erp/web test
 Test Files  6 passed (6)
      Tests  77 passed (77)

$ pnpm check:i18n-parity
== i18n key parity: ar=5995 keys, en=5995 keys ==
ar/en catalogs at 100% key parity; no empty values.
```
(5789 + 206 = 5995 — the counts grew equally on both sides.) No dev-server smoke
run (the supervisor reviews; the T41/T50 precedent — typecheck + lint + unit +
parity are the gate).

## Decisions & deviations (all additive, documented)

1. **The exception board is attendance-only.** The brief allowed an overtime tab
   "only if simple" — it is NOT simple: `overtime/entries` rides `hr.overtime`, a
   DIFFERENT permission key from the board's `hr.attendance` (the 0086 matrix
   split), so the tab would 403 for legitimate register users and require a
   second primary-error path. The attendance exceptions response carries exactly
   the is_exception rows; overtime keeps its own screen family. Recorded rather
   than half-wiring a cross-permission tab.
2. **`hr/shifts` wire row named `HrShiftRow`** — the brief's `ShiftRow` name is
   already taken by the treasury shifts wire type (api-types.ts:1226); the store
   row is `ShiftRow` in the api, the web mirror disambiguates with the Hr prefix.
3. **The register date rides the URL (`?date=`), the sub-boards ride the BFF.**
   The consolidation-runs deep-link pattern for the page-level param (the server
   page re-fetches); the exception board / requests / roster / batches / anomalies
   own their filters client-side and re-fetch through the BFF (the
   payroll-runs-table pattern). A date-change effect re-seeds the dependent local
   state (capture date, exception window) so the two never desync.
4. **The roster read WALKS pages client-side** (pageSize=5000 while hasMore, cap
   10 pages = 50k cells) — the joint-review pagination law ("walk pages until
   hasMore flips false"); the cap surfaces the `hrRosterTruncated` notice rather
   than a silent cut. The server page seeds week one with a single page-1 read +
   the hasMore flag.
5. **`PUT roster/cell` with `shiftId: null` vs `POST roster/cell/clear` are both
   surfaced, distinctly**: the cell dialog's "No shift" select option writes the
   explicit MANUAL day-off cell (the upsert); the Clear button DELETEs the cell
   row (deleteRosterCell) — two different laws in the store, two different
   buttons, the existing cell's provenance (ROTATION/MANUAL) shown in the dialog.
6. **The employee pool is a union** — `payroll/employees` requires
   `payroll.employees.view` which an HR role may not carry; the register/requests
   rows' own employeeCode+employeeName seed the selects first and the payroll
   directory only enriches (the honest degrade: the capture/leave forms render
   the pool-empty notice, never a free-typed uuid input).
7. **Empty optional strings never ride the wire** — the TEXT zod law
   (`min(1).max(500).nullable().optional()`) means an empty note/nameAr/deviceRef
   is OMITTED from the body, never sent as "" (a 422 trap); every form follows
   the `...(x.trim() === "" ? {} : { x: x.trim() })` spread.
8. **The exception board has NO status filter** — the attendance exceptions
   endpoint takes `from/to/employeeId/page/pageSize` only (the controller read;
   is_exception=true is the board's fixed predicate). The anomalies quarantine
   (import) DOES carry the status filter per its controller.
9. **All timestamps compose as naive wall-clock** `${date} ${HH:MM}:00` — the
   INSTANT zod regex accepts the `[T ]` separator without offset (PostgreSQL
   casts to timestamptz in the tenant's timezone at the store — the same space
   the import pipeline's parseTimestamp produces). Time inputs validate
   `([01]\d|2[0-3]):[0-5]\d` with the hrTimeHint label.
10. **Leave types get create + activate/deactivate only** (the brief's exact
    wording); the full PUT edit is wired for SHIFT templates (the brief's
    create/edit wording) — including the full-patch-shape discipline because the
    controller's update arms null-out absent nameAr/note/noteAr fields.

## Endpoints consumed (all verified against the controllers + stores)

- `hr/attendance/register?date=`, `hr/attendance/exceptions?from&to&employeeId&page&pageSize`
- `hr/attendance/records` (POST), `hr/attendance/records/:id/checkout` (POST),
  `hr/attendance/derive` (POST)
- `hr/attendance/import/preview|commit` (POST), `hr/attendance/import/mapping`
  (GET/PUT), `hr/attendance/import/batches`, `hr/attendance/import/anomalies`,
  `hr/attendance/import/anomalies/:id/resolve` (POST)
- `hr/leave/types` (GET/POST), `hr/leave/types/:id` (PUT — types use create +
  activate/deactivate only per the brief), `hr/leave/types/:id/activate|deactivate`,
  `hr/leave/balances?year=`, `hr/leave/requests` (GET/POST),
  `hr/leave/requests/:id/approve|reject|cancel`, `hr/leave/accrual`,
  `hr/leave/rollover`
- `hr/shifts` (GET/POST), `hr/shifts/:id` (PUT), `hr/shifts/:id/activate|deactivate`,
  `hr/roster?from&to&page&pageSize`, `hr/roster/cell` (PUT),
  `hr/roster/cell/clear` (POST), `hr/roster/rotation` (POST)
- Reference: `payroll/employees` (the degraded employee directory)

No endpoint's response shape was undetermined — every wire field was read from
the store SELECT aliases / service return types, not assumed.
