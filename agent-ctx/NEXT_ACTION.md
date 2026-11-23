# NEXT ACTION — PHASE-050 (Quality Management System) — **W-25 THE SPECIFICATIONS + NCR ENGINES DELIVERED (2026-11-23, this session) — W-26 (CAPA + CALIBRATION) WAITS ON THE OWNER'S DISPATCH** — تسليم لا قبول — NOT production approval

**The approval dispatch (the owner's W-0 acceptance, recorded in full at the
F-050a commit `de05cfd`):** W-0 ACCEPTED AS DELIVERY at `7054520` after the
owner's full field verification; **the plan APPROVED AS A BINDING PROGRAM —
إذن إطلاق ONLY, NEVER production approval**; the rulings: (a) the numbering
**W-24…W-32 CONFIRMED** · (b) the **G-62/G-63 account shapes accepted as
proposed in D-05/D-06** (fail-closed standing; the owner's dated-amendment
right reserved) · (c) the payloads + the reservations law as-is. The
non-blocking correction order **F-050a landed first** (`de05cfd` — the
«the 048 shape verbatim» phrase corrected at ALL THREE claim sites with the
dated note; the declared 050 form = the PHYSICAL shape of 049).

**W-24 — THE FOUNDATION (T-01…T-04, delivered at `e708610`+`3112c6c`+`ff9b023`,
2026-11-22):** migrations 0113–0116 + every mirror in ONE increment — the
TWELVE tables + the DATA-ONLY grants (the TEN quality.* keys 337 → 347 =
347 zero-drift · the TWO flags with STARTER AT THE DECLARED NEUTRAL ZERO ·
the manifest enablements · the QUALITY_EXPENSE 5320 marker) · the chain
112 → 116 · ENTITY_CATALOG 328 → 340 · the `__db__/quality/` family OPENS
(the schema spec 59 arms). The honest catches (three) + the nine-part
envelope 284 · 4,115 at the foundation head — the full record lives in
`audit-evidence/phase050-w24/README.md`.

**W-25 — THE SPECIFICATIONS + NCR ENGINES (T-05 + T-06, delivered on the
W-24 head `ff9b023` in three commits — the engines → the DB specs → the
battery/gate/ledger increment):** THE QUALITY MODULE OPENS
(`modules/quality/` — the domain folds + the store + the services + the
controller + the wiring):

- **THE PURE LAYERS FIRST (the unit-first law):** `ncr-lifecycle.ts` — the
  total status × move matrix fold (BR-102's closure gate + the single-use
  disposition stamp + the CLOSED-register law + the G-62 journal-scope fold
  + the source-shape fold) with its 12 property tests; `spec-tolerance.ts`
  — the ONLY tolerance evaluator in the module (the no-fabrication law:
  UNBANDED/one-sided/closed-interval inclusive limits, 6-dp exactness) with
  its 14 property tests. The api unit 68 · 857 → **70 · 883** (+2/+26).
- **THE SPECIFICATIONS API (T-05):** the master-data register (create/list/
  find/PATCH/remove) with the typed band refusals (a point/inverted band
  refused with the parameter and BOTH figures — the merged-band re-check on
  PATCH, an explicit null CLEARS a tolerance end), the natural-key duplicate
  refusal (the 23505 never surfaces raw), and the SPC-FK protection arm.
- **THE INSPECTION-RESULT MAPPING CONTRACT (T-05's second half):**
  `inspectionMap` binds an inspection to the item's specifications through
  the OWNING modules' own reads — the inspections row VERBATIM
  (`findInspectionById`), the item through the engine's own chain (the FG
  batch → item · the production order → item · the GRN-only chain's
  declared honest NONE shape), the active register alongside — ZERO
  parallel computation, proven by the verbatim assertions.
- **THE NCR ENGINE (T-06):** the official `NCR-{YYYY}-{SEQ:6}` numbering ·
  the source-shape law at the service floor (the INSPECTION source binds to
  the inspections module's OWN row — the composite FK's service face ·
  SUPPLIER/COMPLAINT carry their partner) · **G-62's floor at create AND at
  the act** (the live `batchOnHand` read, the typed refusal naming BOTH
  figures — re-read at the disposition because the stock may have moved) ·
  **BR-102's closure gate** (the close on OPEN is the typed refusal NAMING
  the record; the ladder OPEN → DISPOSITIONED → CLOSED with the single-use
  CAS stamps; the CLOSED register refuses every move) · **G-62's SCRAP
  write-off through the REAL engine** (D-05): the affected quantity covered
  warehouse-by-warehouse (the per-warehouse on-hand mirror read,
  deterministic warehouse_id ASC), the write-off MOVES through the REAL
  WMS path (`planIssue`/`applyIssue`, moveKind `adjust`, sourced
  `ncr_record`, reason `QUALITY_SCRAP`), **DR the purpose-mapped
  INVENTORY_SHRINKAGE · CR the per-warehouse INVENTORY accounts at the
  affected quantity's own value** (aggregated per account — the G-59
  credit-side pattern), INV-013 exactly-once on `(ncr_record,
  disposition)`, fail-closed PURPOSE_NOT_MAPPED with the ZERO residue +
  the flip-and-restore re-run — ONE ambient transaction, all-or-nothing
  (the golden-class arm: 5 × 2.500000 = 12.5000, DR 5110 · CR 1140, the
  two-warehouse 1140/1141 per-account split) · **the honest no-GL shapes:**
  REWORK/ACCEPT/RETURN_TO_SUPPLIER carry NO GL entry in every case; the
  batch-less SCRAP stamps with NO journal (the 0114 gate's own NULL
  allowance — the declared interpretation, the wave README's table).
- **THE HONEST CATCH OF THE WAVE (the 0109/0110 precedent, the G-48
  class):** `ck_stock_moves_source_shape` — the stock-moves source domain —
  refused the write-off's `ncr_record` BY NAME at the first DB run; the
  additive **migration 0117** re-adds the constraint with the standing
  twenty-four members + EXACTLY the one new source (the journal 116 → 117,
  the manifest/journal/catalog pins moved together, no tables — the count
  stays 340).
- **THE FIRST ROUTE BINDING WAVE (keys-seed-first):** ROUTE_PERMISSIONS
  **1,102 + 11 = 1,113** (the eleven W-25 routes on quality.view/manage/
  ncr.manage, dated at the block) · the module registered in app.module ·
  the error filter's domainStatus rows in the SAME increment (the
  PHASE-045 T-03 lesson: the not-founds 404, the lifecycle conflicts 409 —
  never the 422 fall-through drift).

**The wave's battery (every log in `audit-evidence/phase050-w25/`, this
session — the THIRTY-SIXTH consecutive same-session wave):** §0a FIRST (the
remote verified at `ff9b023` = the W-24 delivery head; the FOUR tags' six
identifiers + the 049 tag intact; the fresh clone the working tree, a clean
zero-diff reconciliation) — then **the four isolates STANDALONE FIRST**
(soak 1·1 228.4s · fcm 1·8 · email 1·5 · sweep 1·4 — every VITEST_EXIT=0
stamp) · **the affected DB folders re-run at the delta head** (the
scope-label law): **the quality family 3 · 83 GREEN** (the schema 59 + the
NCR 13 + the specs 11 — the family 59 → 83) · **migrations + identity-flows
2 · 28 GREEN** (the chain at 117 + the ROUTE_PERMISSIONS checklist over
the 1,113 routes — the owner template grants every quality.* key) · the
coverage roster updated with the declared movement (chunk-a 98 → 100 · the
roster 284 → 286; 286 = 286, missing NONE, extra NONE, duplicates NONE) ·
**the 117-chain scratch from zero TWICE** (السلسلة من الصفر مرتين:
CHAIN_117_APPLIED → [check-rls] OK — **340 catalog tables**, both logs) ·
typecheck 8/8 (0 cached — the force re-run) · lint 8/8 (0 cached) ·
depcruise clean **2,124 modules · 15,906 dependencies** (+12/+77 dated) ·
unit 8/8 — **150 · 1,894** (api 70·883 · web 21·171 · mobile 27·393 ·
desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core
5·36 — the ledger arithmetic **1,894 = 883+171+840 EXACT**, the F-2 third
term standing) · i18n 6,955 = 6,955 (no delta, as declared — an API-DB
wave) + mobile 371 = 371 · tokens 50/50 · **drift 347 = 347** · manifests
13/13 · docs:validate 33/33 · id-ledger 0 errors + self-test all-probes-OK
(implemented G 61 · INV 34 · BR 100 standing — the 050 flip is W-32's) ·
history-secrets 0 violations · 6,579 allowlisted hits (the W-24 6,571 +8 —
the window's shift: the W-25 session commits entering the last-200 sample;
the RESUMED slices 67+67+66 + the finalize, coverage EXACT 200/200; the
FOUR tag anchors untouched) · ROUTE_PERMISSIONS **1,113** (the recount) ·
the registry 315 tenant-owned tables · capabilities agree · shells
PASS/PASS · boundary PASS. RISK-033: EIGHT incidents, ZERO new this wave.

**NEXT: W-26 — CAPA + CALIBRATION (T-07 + T-08)** under the owner's
standing order: the CAPA API (root cause, the actions array, **BR-103's
effectiveness gate** — D-10: no close before the action due dates pass AND
the effectiveness check is recorded, the typed refusal carrying the open
figures) + **G-63's posting** (D-06: DR the purpose-mapped QUALITY_EXPENSE
(the 5320 marker) · CR the EXISTING EXTERNAL_ACCRUAL — the 049 G-59
external leg's own shape, fail-closed, INV-013 single-use, the cost line
never double-counted with a work order's external leg by construction);
the calibration API (the instrument-ASSET binding — D-08, the 049 handoff)
+ **the `quality-calibration-due` sweep job** (30/7/0, the structural
dedupe, the typed settings surface — the 0111 precedent) — **the sweep
joins the standing isolate set from this wave** (§0c (2)). The standing
recalls as transferred in the 049 completion report §4; the reservations
G-62…G-63 · INV-035 · BR-101…BR-104 — لا كتابة خارجها. NOT production
approval.
