# Task 3-b · PHASE-017 T5 — vehicle registry + service history (partners-owned)

Task ID: **3-b**. Agent: vehicles-registry. Status: **DONE** —
`pnpm --filter @erp/api typecheck` green, `eslint .` (apps/api) green, the
db spec `src/__db__/partners/vehicles.spec.ts` **13/13 passed** on real
PostgreSQL 16 (embedded boot), plus a temporary full-HTTP probe (booted
AppModule via NestFactory, all 6 routes + every typed error mapping
verified 200/404/409/422, then deleted — evidence below).

## Files

### Created
| File | What |
|---|---|
| `apps/api/src/modules/partners/infrastructure/vehicles.store.ts` | Function-module store (partners.store pattern): `tenantTx()` ambient-scope guard, `VehicleRow` (schema-exact: decimal-string `odometerKm`, date-string `odometerAt`), `VEHICLE_COLUMNS`, `insertVehicle` (uuidv7 id, `erp.current_tenant_id()`, `createdBy` stamp), `findVehicleById`, `findVehicleByChassis`, `listVehicles({partnerId?, q?, status?}, limit)` (q → ILIKE plate/chassis/make/model, clamp ≤ 100, `created_at DESC, id DESC`), `updateVehicle` (conditional-set patch, optional version bump), `archiveVehicle` (`WHERE id AND status='ACTIVE'` → ARCHIVED, no delete), and `findVehicleServiceHistory(vehicleId)` — the UNION ALL read model over sales-owned `job_cards` (by vehicle_id) / `sales_invoices` (by vehicle_id) / `credit_notes` (JOIN job_cards on job_card_id), returning `{kind, id, docNo, date, status, total}` sorted `date DESC, kind, id`; documented in-file as the MODULE_BOUNDARIES read precedent (sales.store reads partners the same way; zero cross-module writes). |
| `apps/api/src/modules/partners/vehicles/domain/vehicle-errors.ts` | `VehicleNotFoundError` (`VEHICLE_NOT_FOUND`, 404), `VehicleDuplicateChassisError` (`VEHICLE_CHASSIS_TAKEN`, 409), `VehicleArchivedError` (`VEHICLE_ARCHIVED`, 409), `VehicleChassisInvalidError` (`VEHICLE_CHASSIS_INVALID`, 422 — pre-check of `ck_vehicles_chassis_shape`); exports `VEHICLE_CHASSIS_PATTERN = /^[A-HJ-NPR-Z0-9]{6,17}$/`. |
| `apps/api/src/modules/partners/vehicles/application/vehicle-service.ts` | `@Injectable() VehicleService(@Inject(AuditService))`: `create` (partner exists + not deleted → reused `PartnerNotFoundError`; chassis regex pre-check; duplicate pre-check; **23505 race backstop** via an `isUniqueViolation` cause-chain walker; audit `partners.vehicle_created`, entityType `vehicle`), `get`, `list`, `update` (ACTIVE only → `VehicleArchivedError`; chassis change re-validated, own-chassis re-set allowed, other-vehicle chassis → 409, 23505 backstop; audit `partners.vehicle_updated` with before/after), `archive` (idempotent-**error**: re-archive → 409; race-lost archive re-reads and reports honestly; audit `partners.vehicle_archived`), `serviceHistory` (not-found check first — never an empty timeline for an unknown id). Bilingual `note`/`noteAr` ride on the row; audit payloads snake_case per module convention. |
| `apps/api/src/modules/partners/presentation/vehicles.controller.ts` | `@Controller("api/v1/partners/vehicles")`, `@RequirePermissions("partners.vehicles.manage")` on **every** route (no `@RequireFeature` — mirrors the existing partners controller gating). Exact routes: `GET ""` (partnerId uuid?, q?, status ACTIVE\|ARCHIVED?, limit coerce 1–100 default 25), `POST ""`, `GET ":id"`, `PUT ":id"`, `POST ":id/archive"`, `GET ":id/service-history"` — byte-identical to the six pre-registered route-permissions entries (incl. **PUT** for update). Zod + `requireIdentity` + `envelope` exactly per the partners controller. |
| `apps/api/src/__db__/partners/vehicles.spec.ts` | New partners db-test folder + spec on tenant S via `setupSalesFixture()` (customerId / limitedCustomerId / branchId / warehouseId reused). 13 tests in 3 groups (below). |

### Modified (add-only)
| File | Change |
|---|---|
| `apps/api/src/infra/http/error.filter.ts` | +1 import block (the 4 vehicle errors) + 3 mapping blocks: `VehicleNotFoundError` → 404, `VehicleDuplicateChassisError` \| `VehicleArchivedError` → 409, `VehicleChassisInvalidError` → 422. Nothing else touched. |
| `apps/api/src/modules/partners/partners.module.ts` | + `VehiclesController` (controllers), + `VehicleService` (providers), + the two imports, + one doc line. Not added to `exports` (task scope: controller + service; no consumer yet). |

### Explicitly NOT touched
`apps/api/migrations/**`, `apps/api/src/db/schema.ts`,
`apps/api/src/infra/auth/route-permissions.ts` (already registered),
other modules' files (job-cards built in parallel — zero imports from it;
the history read model touches its *tables* only, by SQL, read-only).

## API surface (all `partners.vehicles.manage`)

```
GET    /api/v1/partners/vehicles                     → envelope(VehicleRow[])           (partnerId?, q?, status?, limit?)
POST   /api/v1/partners/vehicles                     → envelope(VehicleRow)             (Idempotency-Key)
GET    /api/v1/partners/vehicles/:id                 → envelope(VehicleRow)
PUT    /api/v1/partners/vehicles/:id                 → envelope(VehicleRow)             (partial patch; ACTIVE only)
POST   /api/v1/partners/vehicles/:id/archive         → envelope(VehicleRow)             (Idempotency-Key)
GET    /api/v1/partners/vehicles/:id/service-history → envelope(VehicleServiceHistoryEntry[])
```

`VehicleRow`: id, tenantId, createdBy, partnerId, make, model, modelYear,
chassisNo, plateNo, color, engineNo, odometerKm (decimal string), odometerAt
(YYYY-MM-DD), status (ACTIVE|ARCHIVED), note, noteAr, createdAt, updatedAt,
version. `VehicleServiceHistoryEntry`: kind (JOB_CARD|INVOICE|CREDIT_NOTE),
id, docNo, date (YYYY-MM-DD), status, total (decimal string; null for job
cards — they carry no document total).

Error codes: `VEHICLE_NOT_FOUND` (404), `VEHICLE_CHASSIS_TAKEN` (409),
`VEHICLE_ARCHIVED` (409), `VEHICLE_CHASSIS_INVALID` (422), plus reused
`PARTNER_NOT_FOUND` (404) at create.

## Tests — `src/__db__/partners/vehicles.spec.ts` (13/13 green)

Run: `mkdir -p $HOME/tmp-3b && cd apps/api && TMPDIR=$HOME/tmp-3b npx vitest run
--config vitest.db.config.ts src/__db__/partners/vehicles.spec.ts`

```
 ✓ src/__db__/partners/vehicles.spec.ts (13 tests) 319ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

1. **create/find/list + typed errors (6 tests)** — bilingual create round-trip
   (decimal-string odometer "48250.5", `noteAr` "مركبة أسطول", createdBy stamp);
   partner-scoped list, ACTIVE filter, ILIKE search by chassis prefix / plate
   (case-insensitive) / make / model, foreign-partner scope exclusion;
   duplicate chassis typed 409 **across partners** (tenant-wide unique);
   unknown partner → reused `PARTNERNotFoundError` (`PARTNER_NOT_FOUND`);
   chassis shape (contains I/O/Q, too short, 18 chars) → `VEHICLE_CHASSIS_INVALID`;
   two chassis-less vehicles coexist (partial unique index); audit row
   `partners.vehicle_created` (entityType `vehicle`, after.partner_id/make).
2. **update/archive lifecycle (4 tests)** — odometer/color/noteAr update
   (audited, `after.odometer_km` asserted); own-chassis re-set is a no-op,
   another vehicle's chassis → `VEHICLE_CHASSIS_TAKEN`, invalid shape on
   update → `VEHICLE_CHASSIS_INVALID`; archive ACTIVE→ARCHIVED, row survives
   (get works), update-after-archive → `VEHICLE_ARCHIVED`, re-archive →
   `VehicleArchivedError` (idempotent-error), list status filters; unknown ids
   → `VEHICLE_NOT_FOUND` on get/update/archive.
3. **service history (3 tests)** — job_card + sales_invoice + credit_note rows
   seeded with vehicle_id / job_card_id via ambient tenant-tx SQL with
   `ON CONFLICT (id) DO NOTHING` (fixed uuids); timeline merges all three
   sources newest-first (`CREDIT_NOTE 2026-03-05`, `INVOICE 2026-02-20`,
   `JOB_CARD 2026-02-10` from `checked_in_at`), exact docNo/date/status/total
   (invoice total "640.0000", note "100.0000", job card total null); empty
   array for a vehicle with no documents; unknown id → typed
   `VEHICLE_NOT_FOUND` (never an empty timeline).

## Extra verification (temporary, deleted)

A throwaway HTTP probe spec (master-data-http boot pattern: fresh tenant,
owner role cloned from the NULL-tenant owner template — which 0025 granted
`partners.vehicles.manage` — full `NestFactory.create(AppModule)`) proved the
whole pipeline before deletion: all six routes 200 with envelope shapes,
guard accepts the key (route-permissions ↔ controller paths align incl. PUT),
re-archive 409 `VEHICLE_ARCHIVED`, duplicate chassis 409 `VEHICLE_CHASSIS_TAKEN`,
bad chassis 422 `VEHICLE_CHASSIS_INVALID` (service typed error through the
filter), unknown id 404 `VEHICLE_NOT_FOUND`. One fix during probing: the API
auth header is `x-session-token` (BFF style), not `Authorization: Bearer` —
probe-only knowledge, no product code involved.

## Deviations / decisions

- **Chassis shape lives in the service, zod bounds length only (1–17)** — the
  task puts the regex pre-check in the application layer, so the *typed*
  `VEHICLE_CHASSIS_INVALID` is the actual HTTP contract (verified 422 via the
  probe); the controller schema stays permissive on purpose.
- **PUT does not accept `partnerId` re-assignment** — ownership is set at
  creation; the update patch covers make/model/modelYear/chassisNo/plateNo/
  color/engineNo/odometerKm/odometerAt/note/noteAr(+version). Flag for the
  web UI task if re-assignment is wanted.
- **Job-card timeline date** = `coalesce(checked_in_at, created_at)` cast to a
  **UTC** calendar date (deterministic regardless of server TZ); job cards
  carry no document total → `total: null` (typed `string | null`).
- **List has no cursor** (task signature is `{partnerId?, q?, status?, limit}`)
  → plain `envelope(rows)`; store clamps limit to 100 like PAGE_MAX.
- **`created_by` stamped on insert** — the column exists in migration 0025;
  provenance matches the session actor (asserted in the spec).
- **VehicleService not exported from PartnersModule** — task said "add
  VehiclesController + VehicleService"; no consumer imports it yet (job-cards
  reads vehicles via its own read-model SQL per MODULE_BOUNDARIES, if at all).
- **History sort tiebreak** `date DESC, kind ASC, id ASC` — deterministic
  across same-day documents; ISO text dates sort correctly.
