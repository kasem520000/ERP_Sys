# Task 9-a · PHASE-017 T6 — automotive web UI (job-card workspace + vehicle registry)

Task ID: **9a-auto**. Agent: 9a-auto-web. Status: **DONE** —
`pnpm --filter @erp/web typecheck` green (exit 0), `pnpm run check:i18n-parity`
green (ar=2348 / en=2348 keys, 100% parity, no empty values), and
`pnpm --filter @erp/web lint` green (exit 0). Zero new API endpoints; zero
backend changes; navigation.ts / effective-config.ts / app-shell.tsx / the
T14 dictionary anchor untouched.

## Files

### Created
| File | What |
|---|---|
| `apps/web/app/[locale]/job-cards/page.tsx` | Server page (pos/terminals pattern): locale check → `requireSessionToken` → parallel `fetchApi` for the card list + supporting data (`sales/job-cards?limit=200`, `partners/partners?kind=CUSTOMER&limit=100`, `items/items?limit=100`, `tenancy/branches`, `inventory/warehouses`, `tax/tax-codes`) → 401 redirect → 403/FORBIDDEN `ErrorState` (permission `sales.job_cards.manage`) → `<JobCards>` under `<AppShell pagePath="job-cards" title={d.jobCardsTitle}>`. |
| `apps/web/components/job-cards.tsx` | Client workspace: status filter chips (all/draft/in-progress/completed/invoiced/cancelled) + card-no/customer `SearchInput`; create dialog (branch, customer, vehicle — client fetch of the selected customer's ACTIVE vehicles via `partners/vehicles?partnerId=…&status=ACTIVE`, warehouse, parts issue mode reserve/issue_immediate, odometer with pattern validation, complaints/note Textareas, mixed-line editor: PARTS→STOCK items (qty + unit price + discount) / LABOR→SERVICE items (qty + hourly rate + estimated hours), per-line optional tax code); detail workspace for the selected card (status badge, DefList header — customer, vehicle (fetched `partners/vehicles/:id`, short-id fallback on 403), branch, warehouse, issue mode, odometer, complaints/diagnosis/note with locale-first fallback, labor-hours total, JC no + check-in date); lines table (type badge, item, qty, price, `est → logged` hours, discount) with log-hours row action (LABOR, card IN_PROGRESS/COMPLETED, line not CANCELLED); lifecycle action bar gated by status — quotation/approve/cancel+reason (DRAFT), complete/cancel+reason (IN_PROGRESS), invoice (COMPLETED); every mutation via `bffFetch` + in-place row patch + `refreshCard` refetch of the with-lines detail; localized errors through `localizedJobCardError`. |
| `apps/web/app/[locale]/vehicles/page.tsx` | Server page: `partners/vehicles?limit=100` (primary, `partners.vehicles.manage`) + `partners/partners?limit=100` (owner picker source) → 401 redirect → 403 `ErrorState` → `<Vehicles>` under `<AppShell pagePath="vehicles" title={d.vehiclesTitle}>`. |
| `apps/web/components/vehicles.tsx` | Client registry: searchable list (plate / chassis / make / model / partner, client-side filter); create dialog (partner, make, model, model-year int 1900–2100, chassis with the backend VIN-shape pre-check `/^[A-HJ-NPR-Z0-9]{6,17}$/` on uppercased input, plate, color, engine no, odometer, note); archive confirm dialog (danger, ACTIVE-only row action); service-history dialog (client fetch `partners/vehicles/:id/service-history`, timeline list with kind badges job card / invoice / credit note + doc no + date + localized status + total, `max-h-96` scroll); status badges via `vehicleStatusLabel`; localized errors through `localizedVehicleError`. |

### Modified (add-only)
| File | Change |
|---|---|
| `apps/web/i18n/dictionaries.ts` | Filled the three `PHASE-017-T6` anchor blocks (interface + ar + en) with 78 keys each (see below). The T14 anchor blocks and every other line untouched. |
| `apps/web/lib/api-types.ts` | Appended the automotive rows block at end of file: `JobCardRow`, `JobCardLineRow`, `JobCardWithLines` (`JobCardRow & { lines }`), `VehicleRow`, `VehicleHistoryEntry` — field-exact mirrors of the API store rows (decimal strings; `partsIssueMode`/`lineType`/history `kind` as string/union per wire). |
| `apps/web/lib/messages.ts` | Appended the T6 (9-a) localization helpers: `jobCardStatusLabel`, `localizedJobCardError` (maps JOB_CARD_NOT_FOUND/LINE_INVALID/NOT_CANCELABLE/INPUT_INVALID + `sales/job-card-posting-not-configured`), `vehicleStatusLabel`, `vehicleHistoryKindLabel`, `localizedVehicleError` (VEHICLE_NOT_FOUND/CHASSIS_TAKEN/ARCHIVED/CHASSIS_INVALID) — same shape as the existing POS/sales mappers. |

### Explicitly NOT touched
`packages/contracts/src/navigation.ts`, `apps/web/lib/effective-config.ts`,
`apps/web/components/app-shell.tsx` (already wired — my pages use the
pre-registered `job-cards` / `vehicles` fallback crumb entries), the T14
dictionary anchor, all `apps/api/**` backend files, the BFF.

## Dictionary keys — 78 (51 job-cards + 27 vehicles), AR-first

Anchor: the `// -- PHASE-017-T6 automotive screens (job cards + vehicles)` comment ×3 (interface/ar/en); each `// (agent-filled block)` below it replaced in place.

- **jobCards\*/jc\* (51)**: `jobCardsEmpty`, `jobCardsNew`, `jcFilterAll`, `jcCardNo`, `jcCustomer`, `jcVehicle`, `jcBranch`, `jcWarehouse`, `jcPartsIssueMode`, `jcModeReserve`, `jcModeIssueImmediate`, `jcOdometer`, `jcComplaints`, `jcDiagnosis`, `jcNote`, `jcLaborHoursTotal`, `jcLineParts`, `jcLineLabor`, `jcItem`, `jcQty`, `jcUnitPrice`, `jcHourlyRate`, `jcEstimatedHours`, `jcLoggedHours`, `jcDiscount`, `jcTaxCode`, `jcAddLine`, `jcRemoveLine`, `jcStatusDraft`, `jcStatusInProgress`, `jcStatusCompleted`, `jcStatusInvoiced`, `jcStatusCancelled`, `jcActionQuotation`, `jcActionApprove`, `jcActionComplete`, `jcActionInvoice`, `jcActionCancel`, `jcCancelReason`, `jcLogHours`, `jcSearchPlaceholder`, `jcClose`, `jcCreated`, `jcNoticeCreated` (`{no}`), `jcNoticeQuotation` (`{no}`), `jcNoticeUpdated`, `jcNoticeHoursLogged`, `jcErrState`, `jcErrNotCancelable`, `jcErrLineInvalid`, `jcErrPosting`.
- **vehiclesEmpty/veh\* (27)**: `vehiclesEmpty`, `vehNew`, `vehNote`, `vehPartner`, `vehMake`, `vehModel`, `vehModelYear`, `vehChassis`, `vehPlate`, `vehColor`, `vehEngineNo`, `vehOdometer`, `vehSearchPlaceholder`, `vehStatusActive`, `vehStatusArchived`, `vehArchive`, `vehArchiveHint`, `vehHistory`, `vehHistoryKindJobCard`, `vehHistoryKindInvoice`, `vehHistoryKindCreditNote`, `vehHistoryEmpty`, `vehNoticeCreated`, `vehNoticeArchived`, `vehErrChassisTaken`, `vehErrArchived`, `vehErrChassisInvalid`.

Reused (checked, NOT redefined): `commonCancel`, `commonCreate`, `commonOpen`,
`loading`, `errorsForbidden`, `errorsValidation`, `errorsNotFound`, `errorsGeneric`
(via helpers), `retryLabel`, `salesStatus` (generic status column header),
`kindLabel` (generic type column header), `jobCardsTitle`/`vehiclesTitle`
(orchestrator-provided, consumed by AppShell + pages).

## Verification

```
$ pnpm --filter @erp/web typecheck     → tsc --noEmit: exit 0 (clean)
$ pnpm run check:i18n-parity
  == i18n key parity: ar=2348 keys, en=2348 keys ==
  ar/en catalogs at 100% key parity; no empty values.        → exit 0
$ pnpm --filter @erp/web lint          → eslint .: exit 0 (clean)
```

One transient typecheck failure observed mid-run (the parallel T14 agent's
in-flight `distribution/settlements` page); re-ran after their write landed →
clean, exactly as the task brief anticipated. Final state green on all three.

## Deviations / decisions (documented)

1. **78 keys vs "~45" guidance** — full coverage of the task's enumerated
   label list (every form label, 5 status labels, 6 action buttons + reason,
   history kind labels, per-code error strings, notices) with AR-first
   values; parity/typecheck prove completeness. Lifecycle notices were
   consolidated (approve/complete/invoice/cancel share `jcNoticeUpdated`;
   quotation carries its quote number) to keep the count near the brief.
2. **Lifecycle gating exactly per the task spec**: quotation DRAFT-only
   (the service also allows IN_PROGRESS); approve DRAFT; complete
   IN_PROGRESS; invoice COMPLETED; cancel DRAFT/IN_PROGRESS with a required
   reason dialog; log-hours on LABOR lines while IN_PROGRESS/COMPLETED.
3. **PUT (diagnosis patch + DRAFT line replace) not surfaced** — the task's
   build list specifies list + create dialog + detail workspace + lifecycle
   actions + log-hours; no edit dialog was requested. The type exists for it.
4. **AR-first text mapping**: the create dialogs send complaints/note into
   `complaintsAr`/`noteAr` when locale=ar and into the EN columns when
   locale=en; detail views read back with locale-first fallback.
5. **LABOR lines omit the discount input** (PARTS lines carry it) — the API
   accepts `discountAmount` on both; the form favors the per-hour-rate mental
   model for labor.
6. **Supporting-data fallbacks**: tax codes + the per-customer vehicle list
   degrade to empty/optional selects on 403 (fields are optional; the card
   opens without them); the detail vehicle read falls back to a short-id
   label instead of a blank.
7. **Vehicles owner picker** fetches all partners (no kind filter) — the
   registry is partner-scoped, not customer-scoped; the job-cards customer
   picker uses `kind=CUSTOMER` exactly as the task prescribed.
8. **Object-literal separators**: the first dictionary insertion batch used
   interface-style semicolons in the ar/en object literals (esbuild caught
   it); fixed to commas via targeted sed — final file parses, parity green.
9. No `router.refresh()` after mutations (unlike sales-quotes): both screens
   own their lists in local state and patch from the authoritative mutation
   response + a detail refetch — the pos-terminals pattern.
