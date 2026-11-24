# PHASE-051 Master Plan — Foreign Trade & Logistics (التجارة الخارجية والخدمات اللوجستية)

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-051.md`
(T-01…T-18 are the canon task spine; this plan keeps those numbers and adds T-00).
Register: CR-21 · Wave 2 / Stage 13 — **the LAST phase of Stage 13 (Full-ERP
Completion)**; the Stage-13 release gate (CR-38) is checked and recorded at the
closure before Wave 3 starts.

Authority chain: PHASE-051.md → [CR-21](../docs/planning/COMPLETENESS_REGISTER.md)
→ the delivered baseline (purchasing + landed-cost allocation, FX/multi-currency
discipline, financial charges, the posting engine, the movement core with the
INV-035 shared gate, the COA print pipeline, RLS isolation, AR/EN i18n, ⌘K
palette, pg-boss jobs — no hard prerequisite; the 044 WMS paths + the 042
routings + the 038 scorecards consumed through documented contracts) →
the ID_LEDGER's 051 reservations (**G-64…G-66 · INV-036 · BR-105…BR-108**,
re-coordinated 2026-11-13/14) → this plan.

**Status: PROPOSED (2026-11-24, this session — per the owner's PHASE-051
launch dispatch: the master plan is the FIRST deliverable, sent FOR REVIEW
BEFORE LAUNCH — سابقة 049-W0/050-W0 — and NO CODE WAVE opens before the
owner's approval of it; the approval is a launch authorization, NEVER
production approval; تسليم لا قبول).** This plan's evidence envelope:
`audit-evidence/phase051-plan/` (every log same-session, the FORTY-FOURTH
consecutive wave — the owner's standing record counts forty-three consecutive
same-session waves through the 050 closure; this wave is the next of them).
**The dispatch's §5 foundation deliveries are THIS PLAN'S DECLARED BASE**
(§0b): the COA dual-print patterns → the trade certificates · the unified
blocking gate inside `planIssue` → the bonded-warehouse movement restrictions
· the D-13/D-14 documented-contract precedents → the 051 contracts. The
continuity rules are carried as §0c; the reservations law — «لا كتابة
خارجها» — is carried as red line §6.16.

## 0a. THE LOCAL = REMOTE VERIFICATION (the standing law — this session's FIRST act, before the first line)

The owner's standing law from the 049 program: «البعيد مصدر الحقيقة الوحيد،
وكل موجة تبدأ بالتحقق أن المحلي = البعيد قبل أول سطر» — the remote is the
single source of truth, and every wave begins by verifying local = remote
before the first line. **This session executed exactly that, first:**

- **The remote verified first:** `main @ 01f61a7ee46d…` = the tag `phase/050`
  (annotated `76dda77` peeling to `01f61a7` — the W-32 archive head, the
  owner's accepted W-31/W-32 delivery exactly as reconciled — the closure
  completed with the archive `ERP_PLATFORM_PHASE050.zip` and the full sweep
  300 · 4,244); `phase/049` @ `41c3701`, `phase/048` @ `ba459ff`,
  `phase/047` @ `5b73bd1`, `phase/046` @ `4ddb39f` in place, untouched —
  **the four annotated tags' six identifiers + the 050 tag intact** (the
  owner's standing rule, verified again by this session's history-secrets
  run: all FIVE anchors walked, 0 violations).
- **A FRESH CLONE was taken** from the GitHub remote (`kasem520000/ERP_Sys`)
  — the clone's HEAD = the remote HEAD = `01f61a7`, byte-faithful; the working
  tree reconciled against it: **ZERO content differences, ZERO missing files**
  (the git-tracked evidence-log census re-counted this session — the figure
  in the wave's gate record), the tree clean at HEAD. Env-prep: pnpm 9.15.9
  + the workspace install re-run in the fresh clone (store-cached, 23.1s);
  the embedded-PG16 binaries present with the install; **the chromium 1248
  shells provisioned BEFORE the runs (a dated disclosure: this sandbox's
  playwright cache carried only the 1200 pair — the W-27/W-29 print arms
  require 1248; both pairs now provisioned, the PDF probe green)** — 0
  skipped on every run below.
- **THE LAW STANDING FOR EVERY 051 WAVE:** each wave's first act — before any
  edit — is the local-vs-remote verification (the fetch, the HEAD comparison,
  the clean-tree check), recorded in that wave's gate record (عرف 049 option
  (a) carried: the evidence README is the wave's gate record;
  `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-051 is the accumulation
  place). A wave never opens on an unreconciled tree.

## 0b. The owner's 050 acceptance + THE PHASE-051 LAUNCH DISPATCH (the declared base — carried into every wave)

The owner's dispatch accepted **W-31 and W-32** and closed **PHASE-050 as
DELIVERY** («PHASE-050 مُقفلة تسليماً») — W-31 (the proof pack) and W-32 (the
closure: the canon rows + the ID_LEDGER flip + the completion report + the
full sweep 300 · 4,244 + the archive + the tag) both accepted with **ZERO
deviations — «لا تصحيحات مطلوبة»** — the first closure in the record needing
no correction order. The phase stands closed at the tag `phase/050` @
`01f61a7` with the archive `ERP_PLATFORM_PHASE050.zip`.

The dispatch then launched PHASE-051 with the master-plan-first law (سابقة
049-W0/050-W0) and **declared the delivery base in the completion report's
§5 handoff — binding on this plan:**

1. **The COA dual-print patterns** (the `bi()` builder, the frozen snapshots
   rendered VERBATIM, the REAL Chromium determinism laws) are REUSED for the
   trade certificates (certificate of origin/analysis) — this plan's D-13.
2. **The unified blocking gate inside `planIssue`** (the ONLY gate — every
   issue/ship path passes it structurally) is THE PRECEDENT for the
   bonded-warehouse movement restrictions on stock — this plan's D-08.
3. **The documented-contract precedents** (the supplier-quality feed contract
   D-13 and the recall drill's genealogy consumption D-14 of 050) stand as
   the pattern for 051's own recorded contracts — this plan's D-15.

The dispatch's standing orders carried verbatim: **«عند الانتهاء من أي خطوة
ادفعها إلى المستودع»** (every completed step pushed at its own commit) ·
**«تسليم لا قبول»** — delivery, never acceptance, never production approval —
binds this plan and every wave it governs · the open-items log (the 050
completion report §4) transferred VERBATIM (§0c (6)).

## 0c. The continuity rules (the owner's standing list — carried verbatim, binding on all 051 waves)

1. **Same-session evidence:** forty-three consecutive waves through the 050
   closure; this plan wave is the **FORTY-FOURTH**; every evidence log in
   `audit-evidence/phase051-*/` is this session's own run — never inherited,
   never replayed from cache (the typecheck cache-hit class is replaced with
   the force/plain re-run and disclosed).
2. **Prior isolation + the two-headed protocol:** the pre-isolation mandate
   (the time-sensitive isolates run standalone BEFORE any heavy envelope in
   every DB wave) + the two-head protocol at every flake appearance (both
   heads re-proven, ALL logs kept, the disclosure at the claim site) — the
   standing isolate set for 051's first DB wave: soak · fcm · email · the
   cmms sweep · the quality calibration sweep (the 050 fifth) + **the trade
   expiry sweep when it ships (W-34 — the SIXTH standing isolate)**.
3. **The six identifiers + the tags protected:** the four annotated tags'
   six identifiers (`phase/046` = `88568da`→`4ddb39f` · `phase/047` =
   `90fd428`→`5b73bd1` · `phase/048` = `d46fa87`→`ba459ff` · `phase/049` =
   `1fd74e9`→`41c3701`) + the 050 tag (`phase/050` = `76dda77`→`01f61a7`) —
   دائمة لا تُمسّ; every history-secrets run samples all FIVE anchors; every
   wave's §0a verifies them.
4. **The cumulative archive law:** أرشفة الأرشيف ممنوعة — the standing zips
   are never re-zipped; the evidence archive is ADDITIVE-ONLY (new files
   only; no moving, no deleting, no renaming of any existing evidence
   directory).
5. **RISK-033 at EIGHT incidents:** ZERO new across 050 (W-24…W-32); the
   register row stays OPEN and **closes only by the owner's order** — never
   a closure criterion for 051; any new appearance is named, root-caused,
   two-head re-proven, and counted at the claim site.
6. **The standing recalls, as transferred in the 050 completion report §4
   (never restated narrower, never folded):** **the 043 hard review OPEN** ·
   **RISK-031/032 OPEN** · **the §7(b) remarks** · **the register's
   exactly-two narrowed items (SANED 15,000 + EOSB M/51 Art. 84)** · **the
   045 self-board Tabs defect** (the owner dispatches; every 051 board is
   immune — the data-slot shape) · RISK-033 at eight.
7. **The standing reservations: G-64…G-66 · INV-036 · BR-105…BR-108 —
   لا كتابة خارجها** (red line §6.16): the 051 program allocates NO golden,
   invariant, or business-rule identifier outside these; the ID_LEDGER's
   reserved wordings are the canon the closure wave writes; the checker's
   probe-7 fixture already points at G-64/PHASE-051 (claimant PHASE-052 at
   the flip — the W-15 precedent's seventh move).

## 0. Inputs consumed (the plan-first reads — one focused pass over the `01f61a7` head, 2026-11-24, this session)

- `docs/implementation/phases/PHASE-051.md` (spec §1–§8 — T-01…T-18, the
  fourteen tables, the +10 keys, the three flags, the four report
  contracts) · COMPLETENESS_REGISTER CR-21 · the gap analysis:
  ERP_FULL_GAP_ANALYSIS §2 (H-08) + §14 (**L-01…L-14** — LC, collections,
  Incoterms, transport documents, customs declarations, certificates,
  tracking, bonded, drawback) · ID_LEDGER row 48 (051 = G-64…G-66 ·
  INV-036 · BR-105…108, re-coordinated 2026-11-13/14 — the original plan's
  G-65…G-67 · INV-035 · BR-074…077 predate the 044 wave's consumption of
  those slots; shifted +1 by the 043-completion round's BR-081).
- The 050 delivery records: the completion report **§5 handoff** (the
  declared base — §0b above) + the 050 master plan (the wave/gate/red-line
  pattern this plan inherits) + `agent-ctx/NEXT_ACTION.md` (the closure's
  own triple flip — PHASE-051 the next eligible phase).
- Code research (this session, read-only): the movement core's `planIssue`
  + the INV-035 shared blocking gate (`quality/application/hold-gate.ts` —
  the D-08 precedent's own choke point); the landed-costs service (the
  existing allocation engine — freight/customs/insurance/other kinds, the
  VALUE/QTY split, the revaluation ride, the charge-account discipline);
  the posting engine's purpose-map + INV-013 source-key registration (the
  G-61/G-62/G-63 precedents); the 050 COA print pipeline
  (`packages/ui/print` + the `ChromiumRenderEngine` — the W-13/W-21/W-29
  print laws); the sweep pattern (`quality-calibration-due` — the 0111
  precedent, the fifth isolate); the purchasing/sales order surfaces (the
  incoterm selector's embedding sites); the FX/multi-currency + financial
  charges disciplines (the doc's integration scope); the five annotated
  tags.

## 1. Settled design decisions (from the plan-first reads — binding for all waves, amendable only by the owner's dated dispatch)

- **D-01 — THE HONEST MIGRATION SLOTS: 0119–0122.** The phase doc's
  `0091…0094` predates the 037–050 programs and is stale by its own §4 note
  ("Exact numbers confirmed against the Drizzle journal at implementation
  time" — the 048/049/050 D-02 precedent verbatim). The journal stands at 118
  entries (idx 117, `0118_quality_notifications_category` — verified this
  session); 051 integrates at **0119 · 0120 · 0121 · 0122** (idx 118–121),
  no renumbering, no touching any published migration (the constants law).
- **D-02 — THE FOURTEEN TABLES, FOUR SLOTS:** `0119_trade_lc_collections.sql`
  (`letters_of_credit` — currency/amount, issuing bank, beneficiary/applicant,
  the PO link, validity, the status ladder · `lc_amendments` — the dated
  value/validity/document changes, each typed · `lc_documents` — the
  checklist: doc type, presented/verified, discrepancy notes ·
  `documentary_collections` — D/P + D/A terms, the documents set, status,
  settlement linkage) · `0120_trade_documents.sql` (`incoterms` — code,
  AR/EN names, the carriage/insurance/duty ownership matrix as registry
  DATA, the 2020 seed · `bills_of_lading` — the multimodal doc types
  (sea/air/road/rail + combined transport), carrier, ports, container refs,
  the shipment link · `packing_lists` — the shipment/receipt link, the
  line-level pack shapes · `certificates_of_origin` — the chamber-format
  bilingual print's own frozen snapshot, the declaration/shipment link; the
  certificate of CONFORMITY rides the same table as a document type — the
  050 COA one-table-two-types law) · `0121_trade_customs.sql`
  (`customs_declarations` — office, type import/export/transit, status, the
  receipt/PO link · `customs_declaration_lines` — HS code, origin,
  quantities, customs value, duty rate, duty amount, import VAT ·
  `hs_code_registry` — the tenant-extensible starter set ·
  `bonded_warehouse_moves` — the duty-suspended move record (in-bond
  transfer/release), the declaration link · `duty_drawback_claims` — the
  export-evidence link, claimed amounts, the status workflow) ·
  `0122_trade_shipments.sql` (`shipment_tracking_events` — the carrier
  milestone log per shipment: booked → departed → arrived → cleared →
  delivered, the document links it drives + **THE DATA-ONLY grants block**
  (the 0098/0103/0108/0116 pattern) + **the Incoterms-2020 + HS starter
  seeds**). All fourteen: tenant_id prefix + RLS policies (A1–A10, the
  composite-FK law (id, tenant_id) wherever a root other than tenants is
  referenced) + Drizzle mirrors + `tables.registry` +14 (the A-suite arms)
  + ENTITY_CATALOG rows (**340 → 354**) + the journal/manifest/spec pins to
  122 with the chain re-proven from zero at every full sweep.
- **D-03 — THE +10 KEYS, ZERO-DRIFT FROM THE FIRST INCREMENT (matrix §3.28,
  347 → 357):** `trade.view` · `trade.lc.view` · `trade.lc.manage` ·
  `trade.collections.manage` · `trade.customs.view` · `trade.customs.manage`
  · `trade.shipments.view` · `trade.shipments.manage` ·
  `trade.bonded.manage` · `trade.drawback.manage` — owner all ten, the
  read keys down-scoped per the 048/049/050 precedent; ROUTE_PERMISSIONS
  **1,159 → 1,159+n dated** (keys-seed-first: the keys bind as the API
  waves ship, every change dated at the block — the 1,159 baseline anchor).
- **D-04 — THE THREE FEATURE FLAGS (CR-36f):** `trade` + `trade.lc` +
  `trade.customs`, template-composable grants — wholesale,
  distribution-field-sales and electronics compose them by default (the
  manifests + FEATURE_DEPS + the template docs' enablements, the
  0098/0103/0116 pattern; STARTER AT THE DECLARED NEUTRAL ZERO where the
  matrix so records).
- **D-05 — G-64 (the LC margin deposit and retirement):** the margin posts
  at issuance **through the REAL posting engine** — **DR the purpose-mapped
  `LC_MARGIN_DEPOSIT` (asset) · CR the tenant's chosen bank account** (the
  landed-cost charge-account discipline's own shape — an explicit account
  at the act); the retirement (the settlement) **reverses it — DR the bank
  · CR `LC_MARGIN_DEPOSIT`**; an amendment that changes the margin adjusts
  through the same pair on its own single-use key. Fail-closed
  `PURPOSE_NOT_MAPPED` until the tenant maps (the G-61 law), INV-013
  single-use on `(lc, issue)` / `(lc, retirement)` /
  `(lc_amendment, id)`, ONE ambient transaction all-or-nothing (INV-018).
  **The LC FEES ride the EXISTING financial-charges discipline** (the
  bank-charge pattern — zero new machinery: a letter-of-credit fee is a
  financial charge like any bank charge; the doc's own integration scope;
  no new identifier — the reservations law). The exact account purposes may
  be ruled by the owner at approval (§7 (b)); fail-closed until mapped
  either way.
- **D-06 — G-65 (customs duty + import VAT into landed cost):** the
  completed declaration's duties and import VAT flow into **the EXISTING
  landed-cost allocation — a landed-cost document of kind `customs` sourced
  from the declaration's OWN lines**, allocated by VALUE/QTY per the
  existing engine **VERBATIM (zero parallel computation — the
  LandedCostsService is the ONLY allocator)**: **DR INVENTORY (the
  on-hand allocation) · DR COGS (the issued portion) · CR the
  purpose-mapped `CUSTOMS_DUTY_PAYABLE`** (the existing charge-account
  shape with the customs purpose), fail-closed until mapped, INV-013
  single-use on `(customs_declaration, id)`, every allocated duty tied to
  its declaration line (the line-level linkage recorded on the allocation —
  INV-036's own demand).
- **D-07 — INV-036 (declaration completeness — the honest interpretation):**
  a customs-duty landed-cost allocation on an import receipt REQUIRES a
  COMPLETED declaration reference — the typed refusal
  (`DECLARATION_REQUIRED`/`DECLARATION_INCOMPLETE` naming the receipt + the
  declaration's own state) with ZERO residue (the refused allocation stays
  a draft, nothing posts); ordinary non-duty landed costs on domestic
  receipts stand untouched (the existing behavior — never restated
  narrower); the allocation's source is the declaration's own lines (D-06).
- **D-08 — G-66 (the bonded transfer + the release) + THE MOVEMENT
  RESTRICTION (the dispatch's declared base, the 050 §5 handoff):** moves
  INSIDE the bond post NO duty — the physical transfer rides the REAL
  movement core (the transfer paths, `moveKind` transfer, sourced
  `bonded_move`, ONE ambient transaction); **the duty-suspended stock is
  BLOCKED from customer issue while suspended through THE SHARED GATE
  PATTERN — a second blocking validation wired INSIDE the movement core's
  `planIssue`, at the INV-035 gate's own choke point** (the dispatch: «بوابة
  الحجب الموحدة داخل planIssue — البوابة الوحيدة — كل مسار إصدار/شحن يمرّ
  بها بنيوياً ← قيود حركة المستودعات المضمونة على المخزون»): every
  issue/ship path — the baseline sales delivery, the inventory issue, the
  044 WMS picking paths — passes it BY CONSTRUCTION (the enforcement-drift
  risk closed structurally); the typed refusal `BONDED_STOCK_SUSPENDED`
  naming the stock + the bond; the bonded module's own paths (the in-bond
  transfer, the release) are the typed callers that legitimately move
  suspended stock — the beneficiary discipline, never a silent bypass;
  **NO new invariant identifier is minted for the block — the reservations
  law (§6.16): the restriction is G-66's own reserved wording's structural
  face, documented in the phase surfaces.** The release into free
  circulation recognizes the duty EXACTLY ONCE (BR-107): the G-65-shaped
  recognition at release — **DR the released stock's value (the
  revaluation discipline's own math — the WAC/layers uplift at the
  released quantity) · CR the purpose-mapped `CUSTOMS_DUTY_PAYABLE`**,
  INV-013 single-use on `(bonded_warehouse_moves, id, release)`, the typed
  replay refusal, fail-closed until mapped.
- **D-09 — BR-105 (the LC expiry ladder) + THE SIXTH ISOLATE:** the
  30/14/7/1-day expiry alerts + the discrepancy alerts fire from the
  **`trade-expiry-sweep`** pg-boss job (the 0111/calibration pattern
  verbatim: the clock law — every date derived from the DATABASE'S OWN
  CURRENT_DATE in the probe's SQL; the structural dedupe on
  `trade:lc:{lcId}:{threshold}:{dueDate}`; the typed settings surface on
  the trade module's own settings keys; the 'trade' prefs gate; the
  `trade.lc_expiry_sweep_run` seal in the same ambient transaction) —
  **the sweep joins the standing isolate set the wave it ships (W-34 — the
  SIXTH standing isolate, §0c (2))**.
- **D-10 — BR-106 (the Incoterm mandate + the risk-hint matrix):** the
  registry ships the Incoterms-2020 set (EXX/FCA/FAS/FOB/CFR/CIF/CPT/CIP/
  DPU/DAP/DDP) with the carriage/insurance/duty ownership matrix as
  registry DATA (tenant-extensible); the selection is MANDATORY on
  trade-flagged purchase/sales orders — **the honest trigger rule
  (proposed, §7 (c)): with the `trade` flag enabled, an order whose
  currency differs from the tenant's base currency OR that carries the
  explicit import/export marker must post WITH an incoterm** (the typed
  refusal at the order's own posting naming the order + the missing
  field); the matrix renders at selection time from the registry row's own
  data (AR/EN).
- **D-11 — BR-107 (the release duty recognition — D-08's release law as
  its own canon wording):** the release into free circulation recognizes
  the duty exactly once — the single-use stamp, the typed replay refusal
  naming the move + the figures, the release-only trigger (an in-bond
  transfer NEVER recognizes duty — the G-66 no-duty shape).
- **D-12 — BR-108 (the drawback export-evidence gate):** the claim's
  submission requires the linked export evidence (the export declaration
  or the export bill of lading — the typed refusal naming the claim + the
  missing evidence); the workflow records the claimed amounts and the
  status ladder; **the claim itself carries NO GL entry** (the
  non-ledger-document law — the 050 note-20 pattern: the claim is a
  registry record; the refund money lands when treasury records it — the
  honest boundary, 053's surface).
- **D-13 — THE CERTIFICATE PRINTS (the 050 §5 handoff VERBATIM — the
  declared base):** the certificates of origin/conformity print in
  bilingual chamber format through the 050 COA print pipeline patterns:
  the `bi()` builder EXCLUSIVELY (never a parallel dictionary), the frozen
  snapshots rendered VERBATIM (a later declaration PATCH never moves a
  stored certificate), the REAL Chromium determinism laws both directions
  (the Skia clock-stamp normalization finding dated and carried), the
  versioned A4 render, the embedded woff2 fonts (no network fetch inside
  render), the print tests in BOTH locales (thead/dir/rtl + the %PDF
  render + the byte-identity arm).
- **D-14 — THE SHIPMENT TRACKING FOLD (the unit-first law):** the milestone
  → document-status transition matrix is a PURE module with PROPERTY TESTS
  FIRST (the total status × event matrix, the monotone ladder — an event
  never regresses a document's status; the unknown-event typed refusal;
  the drive on the linked bills of lading, packing lists and declarations)
  — the surface and the service render the fold's own output VERBATIM
  (zero parallel computation).
- **D-15 — THE DOCUMENTED CONTRACTS (the 050 D-13/D-14 precedent pattern):
  (a) the declaration → landed-cost contract** (the existing
  LandedCostsService consumes the declaration lines VERBATIM — D-06);
  **(b) the PO → LC/collection chain** (the purchasing module's own rows
  linked, navigable end-to-end — acceptance #8's chain);
  **(c) the tracking events → document status** (D-14's fold);
  **(d) the bonded gate at the movement core** (D-08 — the recorded
  contract; the 044 WMS picking paths pass it by construction since they
  run through `planIssue`).
- **D-16 — THE SEEDS + THE DISCLAIMER (the BR-055 family):** the
  Incoterms-2020 set + the HS starter set ship as tenant-extensible DATA
  with **the documented accuracy disclaimer** (the tenant owns the final
  classification; a missing HS code is MISSING, never invented — the
  no-fabrication law; REQUIRES_VERIFICATION discipline on the
  jurisdiction-pack notes; NO hardcoded duty rates — the rates live on the
  declaration lines as tenant DATA, the phase doc §7's own mitigation).
- **D-17 — THE WEB PLANE (three screens + the reference page + the
  selector + the print surface + the banners):** `/trade/lc` ·
  `/trade/customs` (the declarations register + the lines editor) ·
  `/trade/shipments` (the tracking board) + the Incoterms reference page +
  the incoterm selector embedded in the PO/SO forms + the certificate
  print surface (D-13) + **the duty-suspended banners on every
  bonded-bearing inventory surface** (the 050 hold-banner pattern:
  additive, degrading on 403) — the 048/049/050 board patterns (the
  data-slot shape, immune to the 045 Tabs defect; the typed-refusal
  panels with FULL payloads; the shared TypedRefusalPanel); ⌘K
  registration (OA-04); the 12-template screen discipline; the NAV_ITEMS
  rows with the flag-gating (trade ×3 · trade.lc on the LC row ·
  trade.customs on the customs row) + the FALLBACK_CRUMBS.
- **D-18 — THE FOUR REPORT CONTRACTS (registry 122 → 126, ALL PIN SITES
  TOGETHER — the 048-W14 law, no partial anchoring):**
  `trade.lc-register` · `trade.customs-declaration-register` ·
  `trade.shipment-status` · `trade.duty-drawback-status` — every contract
  reads the engines' outputs VERBATIM (zero parallel computation); the day
  counts derive from the DATABASE'S OWN CURRENT_DATE inside the statement
  (the derived-step clock law); the catalog↔registry reconciliation check
  extends 122/122 → 126/126.
- **D-19 — RLS A1–A10 × THE FOURTEEN TABLES (the cmms/quality precedent
  verbatim):** two dedicated probe tenants with FULL FK-chained trade
  worlds through the APP-ROLE path; the composite-FK law (the
  pg_constraint catalog walk + the live FK-inversion probe 23503); the
  forged-tenant INSERT/UPDATE/DELETE matrix with zero residue; the
  evidence tables (the declarations, the bills of lading, the
  certificates, the claims) carry NO DELETE grant by design — the A5
  split asserted.
- **D-20 — OA-02 N/A-RECORDED (the doc's own ruling):** trade
  documentation is web-only; no synced entity added. The bonded gate is
  server-side — an offline document issuing suspended stock is rejected at
  sync reconciliation when its POST runs the same plan (the
  payload-for-payload law, the 050 D-20 pattern — the recorded ruling,
  never a silent scope cut).
- **D-21 — THE FX + FINANCIAL-CHARGE RIDES (the doc's integration scope):
  the LC/declaration amounts ride the EXISTING FX discipline at the
  contract rate (zero new FX code — the existing multi-currency
  machinery); the LC fees ride the EXISTING financial-charges/bank-charge
  discipline (zero new fee machinery — D-05's own law).** The treasury
  surfaces (053) consume later (the phase doc §8's own handoff note).

## 2. Migration inventory (the honest slots — journal ends at `0118`, idx 117; the fingerprint declared by design)

| Slot | File | Contents |
|---|---|---|
| 0119 | `0119_trade_lc_collections.sql` | `letters_of_credit` (the G-64 margin/retirement anchor + the status ladder) + `lc_amendments` (the dated typed changes) + `lc_documents` (the checklist + the discrepancy notes — BR-105's own anchor) + `documentary_collections` (D/P + D/A, the settlement linkage) |
| 0120 | `0120_trade_documents.sql` | `incoterms` (the ownership matrix + the 2020 seed) + `bills_of_lading` (the multimodal types) + `packing_lists` + `certificates_of_origin` (the frozen snapshot — D-13's print anchor; conformity rides the same table as a doc type) |
| 0121 | `0121_trade_customs.sql` | `customs_declarations` + `customs_declaration_lines` (the duty/VAT math's own rows — G-65/INV-036) + `hs_code_registry` (the tenant-extensible starter) + `bonded_warehouse_moves` (the G-66 duty-suspended anchor) + `duty_drawback_claims` (the BR-108 evidence gate) |
| 0122 | `0122_trade_shipments.sql` | `shipment_tracking_events` (the milestone log — D-14's fold anchor) + THE DATA-ONLY grants block (the 0098/0103/0108/0116 pattern) + the Incoterms-2020/HS starter seeds |

**THE MIGRATION FINGERPRINT (declared by design — the owner's framework
item): the chain 118 → 122; ENTITY_CATALOG 340 → 354 (+14 tables); the
permissions drift 347 → 357 (+10 keys, D-03 — zero-drift from the first
increment); ROUTE_PERMISSIONS 1,159 → 1,159+n dated (keys-seed-first, every
change dated at the block); the report registry 122 → 126 (W-40, all pin
sites together); i18n 7,253 + ~280 declared per the surface wave (W-39 —
the first surface wave declares its delta BY BOTH COUNTS; mobile 371
standing) — the three feature flags (`trade` · `trade.lc` ·
`trade.customs`) and the template manifest enablements (wholesale ·
distribution-field-sales · electronics) land with the keys.**

## 3. Task waves (the canon T-01…T-18; the wave numbering — §7 (a))

### W-0 — The master plan wave (T-00, orchestrator) — THIS WAVE
The plan delivered for review with the same-session baseline envelope at
`01f61a7` (§5; the evidence `audit-evidence/phase051-plan/`); the
acceptance-criteria ledger OPENED with this plan
(`PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-051 — the owner's framework law: the
ledger opens with the plan and closes with the closure); NEXT_ACTION updated
+ the IMPLEMENTATION_STATUS dated header line prepended. **The implementation
waves are BLOCKED until the owner's approval dispatch** (the dispatch's own
boundary: الخطة للمراجعة قبل الإطلاق — إذن إطلاق فقط، وليست موافقة إنتاج).
**Exit:** the plan APPROVED with amendments (recorded as §1a on the
046–050 pattern); the approval head baselined if it moved.

### W-33 — The foundation (T-01 + T-02 + T-03 + T-04, orchestrator)
Migrations 0119–0122 + every mirror/registry/catalog/matrix/pin in ONE
increment (D-01/D-02's shapes; **+10 keys 347 → 357 — zero-drift from the
first increment**; the three flags + the template manifest enablements —
D-04; the Incoterms-2020 + HS starter seeds with the disclaimer — D-16;
ROUTE_PERMISSIONS stays 1,159 keys-seed-first with the dated note).
**The pre-isolation mandate carries: the FIVE standing isolates (soak · fcm
· email · the cmms sweep · the quality calibration sweep) run standalone
before the wave's DB envelope.**
**Exit:** acceptance #1 green (migrations + catalog 340 → 354 + zero-drift
357 = 357); the chain 118 → 122 re-proven from zero TWICE; the full DB
suite at the new count (300 + the trade schema spec).

### W-34 — The LC engine + the expiry sweep (T-05 + T-06, orchestrator)
The LC lifecycle API (issue → amend → the documents checklist → retire)
with **G-64's postings** (D-05 — the margin/retirement pair + the
amendment adjustments) + the LC fee postings to financial charges (the
existing discipline) + **BR-105's `trade-expiry-sweep`** (D-09 — the
30/14/7/1 ladder + the discrepancy alerts). The pure folds FIRST (the
lifecycle ladder · the checklist states · the amendment windows — the
unit-first law). **THE SWEEP JOINS THE ISOLATE SET FROM THIS WAVE (the
SIXTH standing isolate).**
**Exit:** acceptance #2's LC arms green with evidence; the sweep isolate
green standalone.

### W-35 — Collections + Incoterms (T-07 + T-08, orchestrator)
The documentary collections API (D/P and D/A terms, the documents set, the
settlement linkage — the pure fold first) + the Incoterms registry + the
PO/SO selector with the risk-hint matrix (**BR-106** — D-10: the mandate's
typed refusal at the order's own posting + the matrix from the registry's
own data).
**Exit:** acceptance #6's registry/selector arms green.

### W-36 — Transport documents + shipment tracking (T-09 + T-13, orchestrator)
The bills of lading (the multimodal types) + the packing lists + the
shipment tracking events driving the document status transitions
(**the pure fold FIRST — D-14**: the total status × event matrix with the
property tests, the monotone ladder, the typed refusals).
**Exit:** acceptance #7's engine arms green.

### W-37 — The customs engine (T-10, orchestrator)
The declarations + lines API, the HS registry extension, **the duty
computation into the landed costs (G-65 — D-06: the allocation through the
REAL LandedCostsService VERBATIM, sourced from the declaration's own
lines)** with **INV-036's completeness gate** (D-07 — the typed refusals +
the zero residue + the line-level tie). The duty/VAT line fold a PURE
module FIRST (the Decimal math — ADR-0009).
**Exit:** acceptance #3 green (the declaration → allocation flow + the
INV-036 refusals).

### W-38 — Bonded warehouse + duty drawback (T-11 + T-12, orchestrator)
**The bonded moves (G-66 — D-08): the in-bond transfer with NO duty entry
through the REAL movement core + THE SHARED GATE at `planIssue` blocking
the duty-suspended stock from customer issue (the blocking matrix over
every baseline path — the 050 hold-gate's own evidence shape) + the
release recognizing the duty EXACTLY ONCE (BR-107 — the G-65-shaped
recognition at release, the single-use stamp)** + the drawback claims
(**BR-108** — D-12: the export-evidence gate + the honest no-GL shape).
**Exit:** acceptance #4 + #5 green (the blocking matrix + the release +
the export-evidence gate).

### W-39 — The web plane (T-14, orchestrator)
The three screens + the Incoterms reference page + the incoterm selector
embedded in the PO/SO forms + **the certificate print surface (D-13 — the
050 print laws: `bi()` EXCLUSIVELY, the frozen snapshots VERBATIM, the
REAL Chromium test both directions, deterministic byte-identical)** + the
duty-suspended banners on the bonded-bearing surfaces (D-17 — the
data-slot shape; the typed-refusal panels with FULL payloads). **i18n BY
BOTH COUNTS from this wave** (the first surface wave — the declared delta
7,253+n = 7,253+n + mobile 371 standing, §5).
**Exit:** the boards render the engines' figures VERBATIM; the
flag-gating verified; the declared i18n delta green; the certificate print
law green; acceptance #6's surface arms + #7's board arms + #8's print
arms green.

### W-40 — The reports (T-15, orchestrator)
**The four report contracts (registry 122 → 126, all pin sites together —
D-18):** `trade.lc-register` · `trade.customs-declaration-register` ·
`trade.shipment-status` · `trade.duty-drawback-status`.
**Exit:** acceptance #9's report arms green.

### W-41 — The proof pack (T-16, orchestrator)
**The golden transcripts G-64/G-65/G-66 with the MANDATORY failure packs**
(the refusals WITH their full payloads, the zero residue, the
flip-and-restore with the green re-runs — the JOURNAL_RULES §7 law, the
048-W14/049-W22/050-W31 pattern) + **the INV-036 completeness golden** +
**the bonded blocking-matrix golden** (the suspended stock refused on
EVERY baseline path + the offline-rejection shape — D-20) + **the RLS
attack matrix A1–A10 over the FOURTEEN tables** (D-19) + **the OA-06
EXPLAIN budgets** (the declaration lines + the tracking events — the W-9
assertion law: never a forced plan, never an isolated probe context).
**Exit:** acceptance #9's RLS/OA arms + the goldens green — **#1…#9 ALL
GREEN.**

### W-42 — Docs + gates + closure (T-17 + T-18, orchestrator)
The canon docs in the ID_LEDGER's reserved wordings (JOURNAL_RULES
G-64/G-65/G-66 + note 21 · ACCOUNTING_INVARIANTS INV-036 · BUSINESS_RULES
BR-105…BR-108 — **لا كتابة خارجها**: no identifier outside the
reservations enters the canon) + **THE ID_LEDGER FLIP** (atomic with the
canon rows — implemented G 66 · INV 36 · BR 108; the checker's self-test
probe (7) moves to G-67/PHASE-052, claimant PHASE-053 — the W-15
precedent's seventh move) + the full sweep at the final head (the
isolates first; the amended ceiling law) + the completion report (the
cumulative ledger walked and closed + the battery scope map + the FULL
unit-package table + the open-items log transferred explicitly) + the
triple flip + **THE ARCHIVE `ERP_PLATFORM_PHASE051.zip` EXACTLY AS
DECLARED (§5 — the archive-form acknowledgment executed)** + **the tag
`phase/051`** (DELIVERY, never acceptance — the §1a (a) ruling) + **the
Stage-13 release gate checked per CR-38 and recorded before Wave 3
starts** (the phase doc §8's own law).
**Exit:** acceptance #10 green; the phase closed at the delivery head.

## 4. Test matrix (the permanent suites; the pre-isolation mandate carried)

- **Unit (pure, first):** the LC lifecycle fold (the ladder, the
  amendment windows, the checklist states, the discrepancy floors); the
  tracking fold (D-14 — the total status × event matrix, the monotone
  ladder, the typed refusals); the Incoterm matrix fold (the ownership
  matrix from the registry's own data); the duty/VAT line fold (the
  Decimal math per line — ADR-0009); the drawback workflow fold (the
  evidence gate + the ladder); the bonded transition fold (the move kinds
  × the duty/no-duty shapes); the collections fold (D/P vs D/A × the
  settlement windows).
- **DB specs (the `__db__/trade/` family, the hr/projects/cmms/quality
  precedent):** `trade-schema.db.spec` (the structural laws refused BY
  NAME — every rejection arm on its OWN world, أذرع الرفض كلٌّ على عالمه)
  · `trade-lc.db.spec` (the lifecycle + G-64's exactly-once + the
  unmapped-purpose refusal + the amendments + the checklist) ·
  `trade-lc-sweep.db.spec` (**the SIXTH isolate** — the 30/14/7/1 ladder,
  the dedupe axes, the settings surface) · `trade-collections.db.spec` ·
  `trade-incoterms.db.spec` (the registry + BR-106's mandate + the matrix
  data) · `trade-transport.db.spec` (the multimodal B/L + the packing
  lists) · `trade-tracking.db.spec` (the events → the document status,
  the fold VERBATIM) · `trade-customs.db.spec` (**G-65 + INV-036**: the
  line math · the allocation through the REAL service · the completeness
  refusals + zero residue + the line-level tie) · `trade-bonded.db.spec`
  (**G-66 + BR-107 + THE BLOCKING MATRIX over every baseline issue path**
  — the 050 quality-holds evidence shape carried: the raw `planIssue` ·
  the manualIssue · the sales-delivery post · the transfer dispatch + the
  flip-and-restore at release + the single-use stamp) ·
  `trade-drawback.db.spec` (BR-108's gate + the no-GL shape) ·
  `trade-goldens.db.spec` (G-64/G-65/G-66 with the failure packs + the
  INV-036 golden + the bonded blocking golden) · `trade-rls.db.spec`
  (A1–A10 × 14, the hostile worlds) · `trade-explain-budgets.db.spec`
  (OA-06: the declaration lines + the tracking events) · the migration
  chain spec extended to 122. **The per-arm-world law** (freshPartsWorld's
  precedent): no spec's world moves another spec's absolute assertions.
- **Web:** the three screens' render + parity + flag-gating specs; the
  certificate print spec (AR/EN + RTL + deterministic byte-identical —
  the REAL Chromium test, both directions — the 050 COA print spec's own
  shape); the suspended-banner spec on a bonded-bearing surface; the
  incoterm-selector spec on the PO/SO forms.
- **THE PRE-ISOLATION MANDATE (every DB wave):** the standing isolates —
  soak · fcm · email · the cmms sweep · the quality calibration sweep —
  run STANDALONE FIRST, before any heavy envelope (§0c (2)); **the trade
  expiry sweep joins at W-34 (the SIXTH)**. The full-suite envelope: the
  eleven-part plan (the five load parts + the six isolates) with the
  coverage verified BEFORE the first run (the union == the disk inventory,
  the comm diff empty) — every part inside the amended ceiling
  min(expectation, 600 − 30 = **570s**), declared at the claim site
  before the run.

## 5. Gate list (the exit bar — same as 043–050, no relaxations) + THE ARCHIVE FORM

typecheck 8/8 · lint 8/8 · depcruise clean (the fresh count re-baselined at
any environmental delta; the disclosure law) · unit 8/8 packages (the FULL
unit-package table in every closure report) · **the full DB suite green at
the new count — the isolates standalone FIRST, the coverage verified before
the first run, every part INSIDE THE AMENDED CEILING 570s, the declaration
at the claim site before the run** · docs:validate green (33/33 or the
extended count declared) · **i18n parity BY BOTH COUNTS from the first
surface wave (W-39): every web wave declares its delta (7,253+n = 7,253+n)
AND the mobile count (371 = 371)** · permissions drift **347 → 357 = 357 at
every wave from W-33** · manifests 13/13 · id-ledger 0 errors + self-test
OK (the flip at W-42: implemented G 66 · INV 36 · BR 108) ·
history-secrets 0 (the FIVE tag anchors verified untouched) · `check:rls`
clean at **354** · OA-06 budgets green · the standing checks
(boundary-negative, shells, capabilities) per the 049/050 gate table ·
**every evidence log through the guarded wrapper (the vitest summary guard
— judge by the SUMMARY LINES, never the raw exit code, the NF-12 verdict
rule)** · the exact commit count declared at every delivery ·
same-session evidence only · **the local-vs-remote verification as every
wave's first act (§0a)**.

**THE 051 ARCHIVE FORM — DECLARED EXPLICITLY (the F-4/§0b pattern, zero
corrections this time — the 050 closure's own zero-deviation form):** the
closure wave (W-42) delivers **`ERP_PLATFORM_PHASE051.zip`** = **the
git-tracked tree at the closure head** — **FLAT (the PHYSICAL shape of
049/050: zero directory entries), the commit-hash as the zip's FIRST
ENTRY** · **THE ADDITIVE-ONLY LAW** (every member byte-verified against
the git blob at the closure head) · **EXCLUDING every standing platform
zip: أرشفة الأرشيف ممنوعة — the zip never contains another zip; the
SEVENTEEN standing zips 034_FINAL…050 verified untouched** · delivered
with the tag **`phase/051`** — DELIVERY, never acceptance (the §1a (a)
ruling). **The archive-form acknowledgment (إقرار شكل الأرشيف):** this is
the whole of the form — one zip, flat, the hash first, additive only, no
nested archives, the tag after the byte-verification; W-42 executes
exactly this and nothing else.

**This plan wave's own envelope (`audit-evidence/phase051-plan/`, every log
this session — the FORTY-FOURTH consecutive wave):** the fresh-clone §0a
record (remote @ 01f61a7 = phase/050; the five tags' identifiers intact;
zero-diff reconciliation; the evidence-log census) + the full battery at
the closure head's own constants re-proven (the figures in the wave's gate
record — a docs-only wave: the CODE tree stands at `01f61a7`
byte-identical, so the battery's constants are the 050 closure's own
figures re-proven).

## 6. Governance red lines (carried, unchanged — the 049/050 set + the reservations law)

1. One phase per run; the phase doc is the contract; out-of-scope is
   prohibition (live carrier API ingestion is 056's · the bank-guarantee
   module is 053's · FX revaluation runs are 053's · customs-authority
   e-filing adapters are the jurisdiction packs' (054 territory,
   REQUIRES_VERIFICATION) · transfer-pricing documentation is 054's).
2. Doc precedence (ARCHITECTURE_BASELINE + ADRs + CD-01…12); discrepancies
   recorded, never silently rewritten.
3. Never weaken: tenant isolation (RLS), the posting-engine monopoly,
   INV-001…035 (…036 at delivery), auditability — every G-64/G-65/G-66
   posting rides the engine with registered source keys under INV-013
   idempotency; the movement core stays the ONLY stock writer (G-66's
   transfers included).
4. No binary floating point for money (ADR-0009) — the duty/VAT line math,
   the landed-cost allocations, the drawback amounts, the reports; the
   exchange-rate conversions ride the existing FX discipline's own
   precision laws.
5. No fabricated compliance content (BR-055 family): the HS classification
   is tenant DATA (a missing code is MISSING — D-16); the customs values
   and rates are the declaration's own rows (never hardcoded); the
   certificates' snapshots are frozen (never re-attested).
6. **The F1 literal-truth law:** every record claim — counts, paths,
   attributions — verified against the artifact before it is written;
   dated corrections at the original claim site when found.
7. **The same-session evidence rule** (forty-three consecutive waves and
   counting — this wave the forty-fourth) + the scope-label law (claim only
   the affected surface; the full DB suite re-runs on migration/schema
   changes — W-33 and W-42 run it; the mid waves run their folders).
8. **The OA-06 assertion law (the W-9 ruling):** probes assert the stable
   index-driven law, accept the planner's legitimate paths, log the observed
   plan verbatim — never force a plan, never isolate the context.
9. The evidence-log capture convention (NF-3/NF-4, structurally through
   `scripts/capture-evidence.sh` with the W-6 vitest summary guard; the
   NF-12 verdict rule — the summary lines, never the raw exit code).
10. **THE CONSTANTS LAW:** migrations integrate from 0119 — no renumbering,
    no touching any published migration; the routes ledger's every change
    carries a dated note (the 1,159 baseline anchor); ENTITY_CATALOG
    appends (340 now, +14 at W-33); **no evidence archiving or deletion —
    the full envelope at every delivery**; **ALL TAGS immutable**
    (`phase/046` · `phase/047` · `phase/048` · `phase/049` · `phase/050`
    — دائمة لا تُمسّ); the evidence archive ADDITIVE-ONLY.
11. **THE DELIVERY LAW:** every delivery declares its commit count precisely;
    evidence from the same session only; the owner's independent verification
    runs on fresh clones.
12. **THE REGRESSION PROTOCOL LAW:** a regression test that does not go RED
    on the pre-fix code is not accepted no matter how green after — with
    the four-quarter logs and the F1 dated comments at every modified site.
13. **THE AMENDED CEILING LAW: السقف الفعلي = min(التوقع، حد الأمر −
    هامش)** — never a declared ceiling above the harness cap; runs whose
    expectation exceeds the cap are split BEFORE they are attempted; the
    declaration at the claim site before every timed run.
14. **THE TIME-SENSITIVITY CLASS LAW:** RISK-033 NUMBERED OPEN at EIGHT
    incidents — a named open risk, never a closure criterion; the isolate
    set declared in the plan, isolated standalone BEFORE any heavy envelope;
    the two-head protocol with both logs kept at every appearance; **the
    row closes only by the owner's order** (§0c (5)).
15. **THE AMENDED ARCHIVE LAW: أرشفة الأرشيف ممنوعة — the zip ALWAYS
    excludes the standing archives** — the 051 form declared at §5; the
    members byte-verified; the standing zips verified untouched.
16. **THE RESERVATIONS LAW (the owner's 051 dispatch): G-64…G-66 · INV-036
    · BR-105…BR-108 — لا كتابة خارجها** — no golden, invariant, or
    business-rule identifier outside these enters any 051 surface, spec,
    contract, or doc; the ID_LEDGER's reserved wordings are the canon; the
    bonded-issuance block (D-08) is G-66's own structural face, never a
    new identifier.

## 7. Open inputs for the owner (ruled at the approval dispatch — the plan is BLOCKED until then)

- **(a) THE WAVE NUMBERING.** The standing no-collision law (the §1a (b)
  precedent: the global sequence, no renumbering) puts 051's implementation
  waves at **W-33…W-42** (W-24…W-32 exist in 050's delivered records; the
  split mirrors 050's own: the foundation · the engines · the web plane ·
  the reports · the proof pack · the closure — ten waves over T-01…T-18).
  This plan proposes W-33…W-42 as §3 divides them; the owner confirms or
  overrides to a phase-relative restart at approval — either way the LAWS
  bind from the first implementation wave whatever its number.
- **(b) THE G-64/G-65/G-66 ACCOUNT SHAPES (D-05/D-06/D-08).** The
  purpose-mapped pairs are proposed (the LC margin deposit asset ↔ the
  bank account at issuance, reversed at retirement; the existing
  landed-cost allocation shape ↔ the customs duty payable; the released
  stock's value uplift ↔ the customs duty payable at release); the owner
  may rule the exact account purposes at approval — the golden transcripts
  prove whichever is ruled; fail-closed until mapped either way.
- **(c) THE BR-106 TRIGGER RULE (D-10).** The proposed trigger for the
  mandatory Incoterm: with the `trade` flag enabled, an order whose
  currency ≠ the tenant's base currency OR carrying the explicit
  import/export marker; the owner may rule a narrower or wider trigger at
  approval.
- **(d) THE STANDING CARRIED ITEMS (never restated, never folded —
  transferred explicitly per the dispatch's list §0c (6))** and the
  reservations law §6.16 — **NOT production approval: the approval dispatch
  is a launch authorization only.**

**The implementation waves are BLOCKED until the owner's approval dispatch**
(the dispatch's own boundary: الخطة أولاً للمراجعة قبل الإطلاق — وليست
موافقة إنتاج). PHASE-050 stands COMPLETE at `phase/050` (W-24…W-32
delivered and the owner's W-31/W-32 acceptance closed it as delivery with
ZERO deviations — the first no-correction closure in the record);
PHASE-051's plan is this document, its evidence envelope beside it, its
acceptance ledger OPENED, its archive form declared and acknowledged.
