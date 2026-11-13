# PHASE-044 Completion Report — WMS & Inventory Intelligence

> **Status:** COMPLETE · **Date:** 2026-11-13 · **Phase doc:**
> [../PHASE-044.md](../PHASE-044.md) · **Register:** [CR-14](../../../planning/COMPLETENESS_REGISTER.md)
> · **Triple flip:** this report + the phase doc header + the IMPLEMENTATION_STATUS
> row flipped together (CR-48) · **Wave 2's second phase** — the warehouse becomes a
> real WMS, and the field workforce gets its first synced surface (OA-02).

## 1. Executive summary

PHASE-044 closed the audit's H-07 finding ("a warehouse over 5,000 items or 500
locations is manual management" — zero bins, zero putaway, zero directed picking):
the warehouse now runs on a **location tree** (zones/aisles/racks/bins with scan
barcodes, zone types, pick sequence) under **bin-level contents** with
AVAILABLE/QUARANTINE/HOLD status and consignment ownership — **INV-029**'s
same-transaction law (Σ tenant-owned `bin_contents` = `item_stock` per warehouse ×
item, `item_stock` staying the valuation authority — INV-010 untouched) enforced by
the movement core, the nightly probe, and a dedicated invariants suite. On that
substrate: **directed putaway** (priority rules → suggested tasks on receipt, the
PP-12 BIN-LABEL-V1 print), **directed picking** (FIFO/FEFO/NEAREST strategies,
PW- waves, scan-verified confirms, the cluster route — confirmed picks drive the
delivery post's bin decrements), **LPN plates**, **ABC-classified cycle counts**
(the BR-075 threshold + supervisor gate; variances through G-13/G-14 with
CYCLE_COUNT reasons), the **quarantine/HOLD board** (G-43's policy-gated leg),
**consignment/VMI** (BR-076's structural exclusion + the G-44 settlement),
**cross-docking**, **warehouse kitting** (G-45 — the journal-less Σ-components
roll-up), the append-only **serial-movement ledger**, the shelf-life +
slow-movement **alert jobs**, transit exceptions, and **transfer pricing** (G-46).
The field workforce syncs the pick/putaway task lists + scan confirmations through
the extended outbox/inbox contracts (OA-02 — the sync duty, BR-074); the web gets
five boards + the PP-11 scan embeds on the existing receipt/delivery/transfer/count
screens; and four **intelligence reports** join the registry. **Migrations
0067–0073 (schema_version 73) · 22 new RLS'd tables · permissions 279 → 287 ·
feature keys +8 · report registry 95 → 99 · goldens G-43…G-46 (the honest slots) ·
INV-029 · BR-072…077 · i18n 5,672 keys/locale (+250, the operative count).**

## 2. Mandatory code-evidence checklist (CR-48)

**New tables (SQL migration + Drizzle mirror + ENTITY_CATALOG row — CR-36 a):**
22 tables, catalog 239 → 261 (the RLS-suite parity gate re-anchored), each with the
house RLS triple + the master-data/document grants (the 0026 precedent;
`bin_contents` is a POSITION table; `serial_movements` +
`returnable_packaging_movements` are append-only logs — SELECT/INSERT only).

| Table | Migration | schema.ts (Drizzle) |
|---|---|---|
| warehouse_zones / warehouse_aisles / warehouse_racks / warehouse_bins | 0067 §1–§4 | `warehouseZones` :7783 · `warehouseAisles` :7816 · `warehouseRacks` :7839 · `warehouseBins` :7864 |
| bin_contents | 0067 §6 | `binContents` :7927 |
| lpns | 0067 §5 | `lpns` :7904 |
| returnable_packaging / returnable_packaging_movements (L1-20) | 0067 §8–§9 | :7986 · :8014 |
| the `stock_moves` extension (source/target bin + LPN refs §7; the WMS document source shapes) | 0067 §7 + 0073 | the movement-core writes |
| putaway_rules | 0068 §1 | `putawayRules` :8058 |
| pick_strategies / pick_waves / pick_tasks | 0068 §2–§4 | :8085 · :8104 · :8136 |
| cycle_count_schedules / cycle_count_documents / cycle_count_lines | 0069 §1–§3 | :8193 · :8229 · :8271 |
| abc_classifications | 0069 §4 | `abcClassifications` :8303 |
| serial_movements | 0069 §5 | `serialMovements` :8342 |
| transfer_pricing_policies | 0070 §1 | `transferPricingPolicies` :8381 |
| transit_exceptions (I-22) | 0070 §2 | the transit surface |
| inventory_alert_jobs | 0070 §3 | `inventoryAlertJobs` :8433 |
| warehouse_kit_orders / warehouse_kit_lines | 0070 §4 | the kitting store mirrors |
| 0070 §5 is the CoA template markers (1290 QUARANTINE_INVENTORY · 2135 CONSIGNATION_PAYABLE · 4990 TRANSFER_PRICING_ADJUSTMENT), not a settlements table — the consignment consumption settlements ride the posting engine's exactly-once source keys (`consignment_consumption:{id}:settle`, G-44) with NO new table | 0070 §5 | the G-44 surface |

**Migrations & manifest:** journal idx 66/67…72/73 appended (73 entries); the
manifest `src/infra/db/migrations.ts` carries the tags with the numbering-note
comment (the phase doc planned ≈0073…0081 — PHASE-043 had NOT run, so 0067…0071
were the honest next slots, the 0064/0065 D-1 precedent); 0072 (the wave-cancel
evidence repair) + 0073 (the `stock_moves` WMS source-shape extension)
followed per the house convention; `migrations.db.spec.ts` green (apply +
re-apply no-op + the RLS catalog drift probe over all 73).

**Permissions (CR-36 b):** the eight 0071 §1 keys (matrix §3.21) —
`inventory.wms.locations`, `inventory.wms.putaway`, `inventory.wms.picking`,
`inventory.cycle_counts`, `inventory.abc`, `inventory.tracking.serial_ledger`,
`inventory.quarantine`, `inventory.tracking.consignment` — catalog 279 → 287,
seed = matrix (zero drift, the checker's list extended); the route registry
carries all 67 WMS routes + the delivery pick-wave route.

**Feature flags (CR-36 f):** the eight keys on business + enterprise (0071 §3);
the distribution-bearing templates (`industry.distribution` + `industry.wholesale`)
require them by default (0071 §4 — the `required_feature_keys` append); the
FEATURE_DEPS closure rides `inventory.wms` under `inventory.multi_warehouse`.

**Sync surface (CR-36 g / OA-02):** `pick_tasks` + `putaway_tasks` join the
field pull group (both projections of the `pick_tasks` table by `task_kind`,
watermarked by `updated_at`); the write intents `wms_task:confirm_putaway` +
`wms_task:confirm_pick` ride the outbox/inbox contracts as transport-only
handlers over the WMS services — in-tx feed markers, the wrong-bin typed
rejection with machine-readable details, idempotent replay under duplicate
delivery (the stored row, never a second move); registry 17 → 19.

**i18n:** +250 keys/locale (5,672 = 5,672 runtime-counted — the five boards, the
PP-11 embeds, the WMS error family); parity check green.

**Docs:** JOURNAL_RULES §7 (G-43…G-46 + note 14 + the cycle-count G-13/G-14
reuse note) · ACCOUNTING_INVARIANTS INV-029 · BUSINESS_RULES BR-072…077 ·
ENTITY_CATALOG §"warehouse management — WMS" · FEATURE_CATALOG +8 ·
REPORT_CATALOG +4 · NAVIGATION_MODEL §1.9 + the phasing row ·
AUTHORIZATION_MATRIX §3.21 · LOCAL_DATABASE §1.1 (the sync-contract update) ·
the desktop.routes/mobility mirrors ride the registry.

## 3. Acceptance criteria vs. evidence (§6 of the phase doc)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Migrations apply cleanly; Drizzle + catalog parity; RLS A1–A10 on every new table | 0067–0073 apply + re-apply no-op over the 73-entry chain (`migrations.db.spec.ts`); catalog 239 → 261 with the parity gate green; the A-suite extended +132 (the 22 tables × the SIX generated `it()` blocks per table — the A1–A10 attack classes packed six per table, NOT ×10) — identity-isolation 1,452/1,452 in the full run |
| 2 | INV-029 at all times; quarantined/HOLD excluded from availability; consignment excluded from valuation + ATP | The `wms-inv029` suite walks EVERY movement kind asserting the fold + the probe after each step; the exclusion rules pinned at the ATP fold, the valuation fold, and the pick-allocation source (BR-076); the nightly probe (`inventory.bin-reconcile`, 01:45 UTC) is the read-only detector — its corpus test proves the mismatch notification + the SYSTEM audit row; the blocking side is the movement core's `BinContentsShortError` (the T-03/T-04 suites) |
| 3 | Directed putaway: rules generate tasks on receipt; the label prints; wrong-bin is typed | `wms-putaway.spec` — first-match-by-priority, the emptiest-bin zone resolution, receipt task generation, the scan-confirmed structural move (the slot moves; `item_stock` never does), the PP-12 BIN-LABEL-V1 payload, the wrong-bin typed rejection with zero residue + the idempotent replay; the receipts screen renders the queue with the receipt-58 label print (PP-12's fixed format — the 062 designer later) |
| 4 | Directed picking per strategy with scan verification; partial per the warehouse rule; the cluster route | `wms-picking.spec` — NEAREST allocation + the two-deliveries-one-walk cluster proof with the confirms driving the delivery post's `directedTakes` (INV-029 end to end); FEFO + `allow_partial=false`'s typed short-confirm rejection; the wave lifecycle (PW- numbers) + the 0072 cancel-evidence repair |
| 5 | Cycle counting: ABC schedules generate due documents; the threshold gates; variances post G-13/G-14 with CYCLE_COUNT reasons | `wms-cycle-counts.spec` — the Pareto recompute (zero-consumption → C, one-latest floor), the frequency-gated generation (nightly `inventory.cycle-count-generate`), the bin-aware lifecycle (DRAFT→COUNTED→VARIANCE_REVIEW→POSTED), the BR-075 `CYCLE_COUNT_THRESHOLD_EXCEEDED` + the supervisor override, and the approval posting one move per item + one balanced journal per document |
| 6 | Goldens G-47…G-50 green with failure packs (honest slots G-43…G-46) | G-43 (quarantine policy: off posts nothing — the G-15 mirror; distinct posts DR 1290 · CR INVENTORY at qty × avg cost, mirrored on release; 1290-unmapped = typed zero residue) · G-44 (DR COGS · CR 2135 at the agreed price, owner-stamped, exactly-once, fail-closed until mapped) · G-45 (the Σ-components roll-up — same-account, NO journal; the short-component + self-consumption zero-residue rejections) · G-46 (the MARKUP/FIXED operand discipline; the receipt's explicit difference DR dest · CR 4990, fail-closed until mapped) |
| 7 | Serial-ledger completeness: every serialized move appends exactly one row | The T-11 property probes over the whole tenant corpus (no duplicate (move, serial) pairs, every serialized move covered, no cross-wiring) + the walk's own corpus in `wms-inv029` (RECEIVE/PICK per unit) + the serialized-kit scan-at-assembly law + the honest cycle-count limitation (a serialized variance cannot post without naming units — `SerialRequiredError`) |
| 8 | Jobs fire; in-transit damage/missing posts shrinkage | `wms-alerts-policies.spec` — the shelf-life probe (02:30 UTC) flags on-hand batches inside the threshold, stamps its run, ONE owner notification; the slow-movement probe (03:00 UTC) over the no-outbound window; the I-22 transit exceptions (DAMAGE/MISSING reduce the received qty and post the G-13 shrinkage leg at the carried cost — each its own exactly-once key) |
| 9 | Sync duty: tasks + scan confirmations round-trip; the fleet harness passes; idempotent transitions | `sync/wms-tasks.spec` on the dedicated F2E tenant — ACCEPT + the C-01 duplicate replay (the stored row, never a second move) + the wrong-bin zero-residue + the feed-group scope law (a desktop device cannot pull the task feeds); the fleet harness green in the full suite (`chaos-matrix` 19/19 + the expo/desktop chaos + the field-intents suites); the mobile sync-host re-pin 15 → 17 pull calls (the two task feeds) |
| 10 | All house gates green; OA-06 budgets; the completion report; status flip; archive | See §5 below — the full sweep; the OA-06 EXPLAIN budgets 4/4; this report; the triple flip; `ERP_PLATFORM_PHASE044.zip` (OA-07) |

## 4. Deviations & decisions (documented)

- **Golden numbering G-43…G-46, not the planned G-47…G-50.** The phase doc's
  planned slots predate the implementation-time decision that the WMS goldens take
  the next free slots after G-42 (the 042 precedent, recorded in JOURNAL_RULES
  note 14). The cycle-count variance deliberately reuses the G-13/G-14 shapes with
  CYCLE_COUNT_LOSS/GAIN reasons — no new golden row (the §4 note documents it).
- **BR-072…077, not the planned BR-064…067.** The planned slots were consumed by
  039/040/041 (BR-064/065 returns, BR-066 imports, BR-067 channel isolation); the
  honest slots continue from BR-071 (the 042 precedent, recorded in BUSINESS_RULES).
- **Migration numbering 0067–0071, not ≈0073…0081.** PHASE-043 (the planned prior
  consumer of 0067+) never ran — it requires THIS phase — so the WMS cluster took
  the honest next slots (the ENTITY_CATALOG numbering note). 0072 (the wave-cancel
  evidence repair) + 0073 (the `stock_moves` WMS source-shape extension) shipped
  with their feature tasks.
- **The returnable-packaging deposit accounting (L1-20)** shipped its substrate
  (the container register + the movement log riding the bin/LPN machinery, the
  4895 DEPOSIT_FORFEITURE marker) with the deposit liability leg reusing the
  EXISTING `DEPOSITS_RECEIVED` purpose (2140 — D-2, no new liability purpose).
- **Gate repairs this phase's full-suite run surfaced** (the first since 042 —
  recorded honestly, the 041 D-7 precedent): (a) the T-08 AppModule-boot regression
  — an undecorated `PostingService` constructor param sitting BEFORE a later
  `@Inject` punches an `undefined` hole into Nest's token array (the vitest
  transform emits no `design:paramtypes`; the compiled app was unaffected) —
  `@Inject(PostingService)` added on the four WMS services (the opening-stock
  pattern); (b) the T-01 CoA-marker re-pins (73 accounts / 50 purposes across the
  tenancy specs — 0067 §10 + 0070 §8); (c) the degraded-entitlement double
  revocation (the business plan's `inventory.serial_ledger` depends on
  `serial_tracking`); (d) the wms-picking suite moved to DEDICATED items (its
  101.00 receipts on the shared S-A item diluted the WAC and broke pos/golden's
  pinned COGS legs in corpus order); (e) corpus-honest shelf-life + certificates +
  report-tie assertions (the shared tenants accumulate other specs' state — the
  assertions now pin the BEHAVIOR, not the corpus); (f) the pre-existing 042
  navigation group re-pin (10 → 11 groups — manufacturing) + the T-13 mobile
  field-group count re-pin (15 → 17) caught at T-14.

## 5. Gate evidence (the full sweep)

- **typecheck:** 8/8 packages, zero errors. **lint:** 8/8. **boundaries
  (dependency-cruiser):** 1,785 modules, 13,131 dependencies — no violations.
- **unit:** 8/8 packages green (the registry meta-tests re-pinned 95 → 99; the
  drift checker's seed list extended with 0071; the consolidation mirror re-pinned).
- **DB suite (embedded PG16, the full 73-migration chain):**
  **2,979/2,979 — 202 files, 0 failures** (the 042 baseline was 2,768/189; +211
  tests across T-03…T-20 and the regression base).
- **isolation (RLS A1–A10):** identity-isolation 1,452/1,452 (+132 for the 22
  WMS tables — the 042-era A-suite baseline was **1,320** (219 tables × 6 + 6
  fixed), re-run verified 2026-11-13; the originally announced "1,332" was a
  miscount, corrected with errata in the 042 report and
  IMPLEMENTATION_STATUS).
- **migrations:** apply + re-apply no-op; the RLS catalog drift probe green with
  the 22 new tables catalogued.
- **docs:validate:** 33/33. **i18n parity:** 5,672 = 5,672 (AR = EN; +250, the
  operative count). **permissions drift:** 287 = 287 (matrix §3.21 = the seed
  union). **manifests:** 13/13 valid.
- **report registry:** 99 contracts (the unit + wiring + golden + industry-018/019
  + consolidation pins re-anchored).
- **OA-06 EXPLAIN budgets:** **4/4** — the directed-pick allocation walk
  (`ix_bin_contents_pick_fefo`/`tenant_item_status`), the INV-029 probe fold
  (`ix_bin_contents_tenant_wh_item_owner`), the serial-ledger walk
  (`ix_serial_movements_tenant_serial_time`), and the pick-task board
  (`ix_pick_tasks_tenant_kind_status`) — seeded + ANALYZEd + `enable_seqscan=off`
  (the 041 method; index-driven, zero seq-scans).
- **The legacy-stock backfill:** the dry-run report names the shortfall
  (75.000000) without writing; the LIVE pass lands it on the DEFAULT bin
  (AVAILABLE, tenant-owned, the INV-029 note); the fold goes exact; the probe
  clears it; the second run is a no-op (idempotent). The operator script:
  `pnpm --filter @erp/api backfill:bins -- --dry-run` then without the flag
  (one UoW per ACTIVE tenant, audited).
  **Post-closure audit fix (2026-11-13):** tracked items (batch/serial) are
  now DISTRIBUTED from the proven stock_moves ledger per (batch, warehouse)
  and per serial — reconciled against the total BEFORE any write, never a
  blind NULL-dimension row; unprovable residue is never written (the probe
  keeps it, one critical owner notification) and concurrent passes converge
  on an advisory lock. Evidence: `wms-tracked-backfill.spec` (7 tests) + the
  mandatory operator runbook
  [docs/operations/WMS_UPGRADE_BACKFILL_RUNBOOK.md](../../../operations/WMS_UPGRADE_BACKFILL_RUNBOOK.md)
  + [the gate-evidence ledger](../../../operations/gate-evidence/2026-11-13-post044-audit-fixes.md).

## 6. Delivery

The per-phase archive `ERP_PLATFORM_PHASE044.zip` (OA-07) accompanies this
report. With 044 delivered, **PHASE-043 (MRP) is unblocked** — 042 ✓ + 044 ✓ +
038 ✓ — its inputs shipped: bin-level availability, the FEFO/expiry-aware supply
qualification, the consignment exclusion (BR-076), and the reservation policy
engine (I-14) are the WMS surfaces MRP consumes; the strategy service is the
single source both sales picking and MRP netting call. **PHASE-045 (HR Core)**
remains eligible in parallel. The owner continues with «ابدأ تنفيذ المرحلة
PHASE-043» or «ابدأ تنفيذ المرحلة PHASE-045».
