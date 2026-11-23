# PHASE-050 W-25 (THE SPECIFICATIONS + NCR ENGINES) evidence — 2026-11-23 (T-05 + T-06; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-24 delivery head
`ff9b023`'s tree + this wave's own increments (the same-session evidence
rule, the **THIRTY-SIXTH** consecutive wave — the owner's standing record
counts thirty-five through the W-24 foundation). The wave is the APPROVED
PLAN's §3 W-25 under the owner's launch authorization (إذن إطلاق ONLY — NEVER
production approval): **T-05 the specifications API + THE INSPECTION-RESULT
MAPPING CONTRACT · T-06 the NCR engine with BR-102's closure gate and
G-62's SCRAP write-off through the REAL posting engine.**

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ ff9b023` (the W-24 delivery head);
  `phase/049` @ `41c3701` · `phase/048` @ `ba459ff` · `phase/047` @
  `5b73bd1` · `phase/046` @ `4ddb39f` — **the four annotated tags' six
  identifiers + the 049 tag intact** (the standing rule; re-verified by the
  history-secrets finalize's four anchors).
- A FRESH CLONE taken from the GitHub remote — the clone's HEAD = the remote
  HEAD (a clean zero-diff reconciliation, no local-only files); the working
  tree is the clone (the environment reset recovered: pnpm 9.15.9
  re-provisioned, the workspace install re-run — the shared pnpm store
  survived, the embedded-PG16 binaries + the chromium 1200/1248 shells
  present; one api unit spec smoke-run before the first line).

## The wave's acts (three delivery commits + this gate increment)

1. **THE ENGINES** — the `modules/quality/` module OPENS: the PURE layers
   first (the unit-first law: `ncr-lifecycle.ts` — the total status × move
   matrix fold + the G-62 journal-scope fold + the source-shape fold, 12
   property tests · `spec-tolerance.ts` — the module's ONLY tolerance
   evaluator (the no-fabrication law: UNBANDED/one-sided/the closed
   interval with inclusive limits, 6-dp exactness), 14 property tests) ·
   the store (the specs register + the NCR rows + the single-use CAS stamps
   + the per-warehouse on-hand mirror read (the `qcBatchOnHand` precedent))
   · the specification service (the authoring surface with the typed band
   refusals naming the parameter and BOTH figures · the natural-key
   duplicate pre-check · the PATCH's explicit-null CLEAR + the merged-band
   re-check · **the inspection-result mapping contract**: the inspections
   row VERBATIM through `findInspectionById`, the item through the engine's
   own chain (the FG batch → item · the production order → item · the
   GRN-only declared honest NONE shape), the active register alongside) ·
   the NCR service (the official `NCR-{YYYY}-{SEQ:6}` numbering · the
   source-shape law at the service floor with the INSPECTION source binding
   to the inspections module's OWN row · **G-62's floor at create AND at
   the act** (the live `batchOnHand` read, the refusal naming BOTH figures)
   · **BR-102's closure gate** (the typed refusal NAMING the record) ·
   **the G-62 write-off**: the per-warehouse coverage (warehouse_id ASC),
   the moves through the REAL WMS path (`planIssue`/`applyIssue`, moveKind
   `adjust`, sourced `ncr_record`, reason `QUALITY_SCRAP`), DR the
   purpose-mapped `INVENTORY_SHRINKAGE` · CR the per-warehouse INVENTORY
   accounts at the affected quantity's own value (the per-account
   aggregation — the G-59 credit-side pattern), INV-013 exactly-once on
   `(ncr_record, disposition)`, fail-closed `PURPOSE_NOT_MAPPED`, ONE
   ambient transaction all-or-nothing) · the controller (11 routes,
  `@RequirePermissions` + `@RequireFeature("quality")` — the whole-module
   key's own gate) · **THE HONEST CATCH below's migration 0117** · the
   module wiring (`app.module.ts` + ROUTE_PERMISSIONS **1,102 + 11 =
   1,113** dated at the block — the keys-seed-first FIRST binding wave ·
   the error filter's `domainStatus` rows in the SAME increment — the
   PHASE-045 T-03 lesson applied at the first quality increment: the
   not-founds 404, the lifecycle conflicts 409).
2. **THE DB SPECS** — the `__db__/quality/` family grows: `quality-ncr.db.spec`
   (13 arms: the golden-class write-off arm 5 × 2.500000 = 12.5000 — DR
   5110 · CR 1140, the moves' REAL-WMS witness, the batch on-hand 100 → 95 ·
   INV-013's exactly-once with the single journal + single move proof ·
   **the unmapped-purpose fail-closed with the ZERO residue + the
   flip-and-restore re-run** · the floor re-read at the act (the stock
   moved 60 under the record — the refusal names 90 vs 40, zero residue)
   · the two-warehouse 1140/1141 per-account split (order-free
   assertions) · BR-102's three cells · the honest no-GL shapes) +
   `quality-specs.db.spec` (11 arms: the authoring surface · the band law's
   typed refusals · the SPC-FK protection BY NAME · **the mapping
   contract's four chains** — the FG batch, the production order, the
   GRN-only NONE, the foreign-id typed not-found) + **the fixtures' G-62
   posting world** (the provisioned CoA + FY2026-QL's OPEN periods + the
   QL-WH/QL-WH-B warehouses with the 1141 per-warehouse override + the
   INVENTORY_APPRECIATION 4920 mapping (the 0008 fail-closed gap, the
   inventory fixtures' own tenant-setup precedent) + the batch-tracked
   per-arm scrap worlds with REAL stock through the inventory module's own
   `manualReceipt` — the on-hand floor and the valuation read the ledger's
   own rows).
3. **THIS GATE INCREMENT** — the evidence envelope + the ledger
   accumulation (the acceptance ledger's W-25 dated note: #2's NCR arms +
   #6's specification-feed arms DELIVERED, the CAPA arms W-26's, the
   supplier-score arms W-27's) + NEXT_ACTION → W-26 + the
   IMPLEMENTATION_STATUS dated line.

## THE HONEST CATCH OF THE WAVE (the 0109/0110 precedent, the G-48 class — RED-proven then repaired, no battery red anywhere)

**`ck_stock_moves_source_shape` refused the write-off's `ncr_record` moves
BY NAME at the first DB run**: the stock-moves source vocabulary is a
CLOSED domain (0110's own twenty-four members) and D-05's write-off sources
its moves through the REAL WMS path — the floor fired exactly as designed,
the first `applyIssue` insert refused. **THE REPAIR: migration `0117_quality_ncr_source_shape.sql`**
(the additive DROP+ADD pattern, the 0109/0110 shape): the constraint
re-added with the standing twenty-four members + **EXACTLY the one new
source** — no wider. The journal **116 → 117** (the manifest + the drizzle
journal + the spec's last-tag pin moved together; the ENTITY_CATALOG's
dated note: NO new tables — the count stays 340). Both from-zero scratch
runs apply the 117 chain and `check:rls` passes at 340.

**The declared interpretations (three):**

1. **The batch-less SCRAP** stamps the disposition with NO journal (the
   0114 gate's own NULL allowance — `journal_entry_id` exists only on the
   SCRAP path but is not demanded there): the record never named stock
   under a batch, so no value source exists for a write-off — the recorded
   honest shape (D-05's own language "the batch's own on-hand" scopes the
   posting to batch-referencing records; REWORK/ACCEPT/RETURN_TO_SUPPLIER
   carry NO GL entry in every case by D-05's recorded law).
2. **The write-off's coverage order** is deterministic (warehouse_id ASC —
   the store read's own ORDER BY) but the two-warehouse spec arm asserts
   ORDER-FREE (the per-move value ties to its own warehouse's position; the
   per-account credit sums tie to the moves' own values) — the goldens
   (W-31) will pin the single-warehouse canonical order.
3. **The GRN-only mapping chain** returns `item: null` + an empty register
   with `itemResolution: "NONE"` — a goods-receipt inspection names no
   SINGLE item (a GRN's lines can carry many); the COA surface (W-27)
   resolves per-line. The declared honest shape, asserted by its own arm.

## The affected DB folders — re-run at the delta head, this session (the scope-label law)

| Folder | Files · Tests | Log |
|---|---|---|
| the quality family | **3 · 83 GREEN** (the schema 59 · the NCR 13 · the specs 11 — the family 59 → 83) | `db-affected-quality.log` |
| migrations + identity-flows | **2 · 28 GREEN** (the chain at 117 · the ROUTE_PERMISSIONS checklist over the 1,113 routes — the owner template grants every quality.* key) | `db-affected-migrations-identityflows.log` |

The full nine-part envelope rides at the standing counts **284 files ·
4,115 tests** (the W-24 head) — **W-32 re-runs it at the final head** with
this wave's declared roster movement: the two new specs join chunk-a at
their alphabetical position (**chunk-a 98 → 100 · the roster 284 → 286**;
`parts.json` + `coverage-inventory.txt` + `coverage-union.txt` +
`coverage-proof.txt` — 286 = 286, missing NONE, extra NONE, duplicates
NONE, VERDICT: COVERED).

## The 117-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts` (the W-24 shape, the chain stamp 117): initdb a
scratch embedded PG16 → apply the chain from zero → `check:rls` → clean
shutdown — run TWICE, both logs kept: **run 1**
`check-rls-scratch-117-run1.log` and **run 2**
`check-rls-scratch-117-run2.log`, each CHAIN_117_APPLIED → **[check-rls]
OK — 340 catalog tables** → SCRATCH_STOPPED. (The invocation-shape note:
`pnpm --filter @erp/api exec tsx ../../audit-evidence/phase050-w25/scratch-rls-proof.ts`
from the repo root — the process cwd is apps/api, so the script path is
the explicit relative one; one process, one log, the wrapper's goal.)

## The standing battery (every log this session, every stamp green)

| Check | Verdict | Log |
|---|---|---|
| **The four isolates (STANDALONE FIRST — the pre-isolation mandate)** | soak 1·1 228.4s · fcm 1·8 · email 1·5 · sweep 1·4 — every VITEST_EXIT=0 | `db-isolate-soak.log` · `db-isolate-fcm.log` · `db-isolate-email.log` · `db-isolate-sweep.log` |
| typecheck | **8/8** (0 cached — the force re-run) | `typecheck.log` |
| lint | **8/8** (0 cached) | `lint.log` |
| depcruise | clean — **2,124 modules · 15,906 dependencies** (+12/+77 dated) | `depcruise.log` |
| unit workspace | 8/8 — **150 files · 1,894 tests** (api **70·883** · web 21·171 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the ledger arithmetic **1,894 = 883+171+840 EXACT**, the F-2 third term standing) | `unit-workspace.log` |
| permissions drift | **347 = 347** (zero delta — no new keys; the ten quality keys stand from W-24) | `permissions-drift.log` |
| i18n parity | ar=6,955 = en=6,955 (no delta, as declared — an API-DB wave) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities.log` |
| docs:validate | 33/33 | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 61 · INV 34 · BR 100 · reservations 15 phases · 37 ids | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-62/PHASE-050 — the 050 flip is W-32's) | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 6,579 allowlisted hits (the W-24 6,571 +8 — the window's shift: the W-25 session commits entering the last-200 sample) | `history-secrets.log` (+ slices 1/2/3 — the RESUMED 67+67+66, coverage EXACT 200/200; the FOUR tag anchors untouched) |
| ROUTE_PERMISSIONS | **1,102 + 11 = 1,113** (the recount — the keys-seed-first FIRST binding wave) | (the static recount, this session) |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

**The static constants (recounted this session):** the chain **116 → 117**
(0117 — the one-source widening, no tables) · ENTITY_CATALOG **340** (the
dated note on the quality header) · the registry **315 tenant-owned
tables** · the drift **347** · ROUTE_PERMISSIONS **1,113** · the report
registry **118** (zero change — the +4 are W-30's) · the unit ledger
**150 · 1,894** (68·857 → 70·883 api) · the DB suite roster **286 files**
(83 quality-family tests at the delta head; the full envelope at W-32).

## The physical-file census (the exact-commit-count law)

The wave's commits, in order: (1) THE ENGINES (the module's 10 files +
`app.module.ts` + `route-permissions.ts` + `error.filter.ts` + the
migration `0117_quality_ncr_source_shape.sql` + `meta/_journal.json` +
`migrations.ts` + `migrations.spec.ts` + the ENTITY_CATALOG dated note);
(2) THE DB SPECS (`quality-ncr.db.spec.ts` + `quality-specs.db.spec.ts` +
the fixtures' posting-world extension + `parts.json` + the three coverage
files); (3) THIS GATE INCREMENT (the 34 physical evidence files — 33 logs
+ `scratch-rls-proof.ts` + this README — + the ledger accumulation: the
acceptance criteria's W-25 dated note + NEXT_ACTION → W-26 + the
IMPLEMENTATION_STATUS dated line). Every push declares its copy count at
the time (1 + 1 + 1); the battery evidence is this final increment's own
session.

**NOT production approval — تسليم لا قبول.** W-26 (CAPA + calibration —
BR-103's effectiveness gate + G-63's posting + the calibration sweep
joining the standing isolate set) waits on the owner's dispatch under the
standing order. The standing recalls ride the 049 completion report §4;
RISK-033 at EIGHT with ZERO new this wave — the row stays OPEN, closing
only by the owner's order. The reservations G-62…G-63 · INV-035 ·
BR-101…BR-104 carry the لا-كتابة-خارجها law into every remaining 050 wave.
