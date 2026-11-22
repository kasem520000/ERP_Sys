# PHASE-050 Master Plan — Quality Management System (إدارة الجودة)

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-050.md`
(T-01…T-20 are the canon task spine; this plan keeps those numbers and adds T-00).
Register: CR-20 · Wave 2 / Stage 13.

Authority chain: PHASE-050.md → [CR-20](../docs/planning/COMPLETENESS_REGISTER.md)
→ the delivered baseline (inspections module, batch/serial tracking, the sales
delivery + inventory issue paths, the posting engine, RLS isolation, AR/EN i18n,
⌘K palette, pg-boss jobs — no hard 048/049 prerequisite; the 038 scorecards ·
the 042 routings · the 044 WMS paths consumed through documented contracts) →
the ID_LEDGER's 050 reservations (**G-62…G-63 · INV-035 · BR-101…BR-104**,
re-coordinated 2026-11-13/14) → this plan.

**Status: PROPOSED (2026-11-22, this session — per the owner's PHASE-050
launch dispatch: the master plan is the FIRST deliverable, sent FOR REVIEW
BEFORE LAUNCH — سابقة 049-W0 — and NO CODE WAVE opens before the owner's
approval of it; the approval is a launch authorization, NEVER production
approval; تسليم لا قبول).** This plan's evidence envelope:
`audit-evidence/phase050-plan/` (every log same-session, the THIRTY-FOURTH
consecutive wave — the owner's standing rule records thirty-three consecutive
same-session waves through the 049 closure; this wave is the next of them).
**The dispatch's five dated corrections (F-1…F-4 + the archive-form
acknowledgment) are THIS WAVE's first acts and have landed with it** (§0b);
the continuity rules are carried as §0c; the reservations law —
«لا كتابة خارجها» — is carried as red line §6.16.

## 0a. THE LOCAL = REMOTE VERIFICATION (the standing law — this session's FIRST act, before the first line)

The owner's standing law from the 049 program: «البعيد مصدر الحقيقة الوحيد، وكل
موجة تبدأ بالتحقق أن المحلي = البعيد قبل أول سطر» — the remote is the single
source of truth, and every wave begins by verifying local = remote before the
first line. **This session executed exactly that, first:**

- **The remote verified first:** `main @ 41c37018d452…` = the tag `phase/049`
  (annotated `1fd74e9` peeling to `41c3701` — the W-23 archive head, the owner's
  accepted W-22/W-23 delivery exactly as reconciled); `phase/048` @ `ba459ff`,
  `phase/047` @ `5b73bd1`, `phase/046` @ `4ddb39f` in place, untouched —
  **the three annotated tags' six identifiers + the 049 tag intact** (the
  owner's standing rule, verified again by this session's history-secrets run:
  all FOUR anchors walked, 0 violations).
- **A FRESH CLONE was taken** from the GitHub remote (`kasem520000/ERP_Sys`)
  — the clone's HEAD = the remote HEAD = `41c3701`, byte-faithful; the working
  tree reconciled against it: **ZERO content differences, ZERO missing files**
  (the full 879 git-tracked evidence logs present on disk — no snapshot loss
  this session), the tree clean at HEAD. Env-prep: pnpm 9.15.9 + the workspace
  install re-run in the fresh clone (store-cached, 6.7s); chromium
  headless-shell 1248 already provisioned — **0 skipped on every run below**.
- **THE LAW STANDING FOR EVERY 050 WAVE:** each wave's first act — before any
  edit — is the local-vs-remote verification (the fetch, the HEAD comparison,
  the clean-tree check), recorded in that wave's gate record (عرف 049 option
  (a) carried: the evidence README is the wave's gate record;
  `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-050 is the accumulation
  place). A wave never opens on an unreconciled tree.

## 0b. The owner's W-22/W-23 acceptance + THE FIVE DATED CORRECTIONS (the dispatch's order — landed in THIS first wave)

The owner's dispatch accepted **W-22 and W-23** and closed **PHASE-049 as
DELIVERY** («PHASE-049 مغلقة كتسليم» — at the tag `phase/049` @ `41c3701`),
then launched PHASE-050 with the master-plan-first law (سابقة 049-W0) and
**five dated corrections ordered into the first wave**. All five landed with
this plan wave, at their claim sites, dated 2026-11-22:

1. **F-1 — the §1 wave table of the 049 completion report corrected at the
   claim positions** (`docs/implementation/phases/reports/PHASE-049-COMPLETION.md`):
   the four head cells verified against the git log this session — W-16 is the
   ONE commit `9e34ddc` on the plan head `20b56d3` with **DB 272 · 3,885** per
   its own gate record (the printed `0f…`→`cf0248c`/6 steps + 271 · 3,743 were
   the wrong wave's shape); W-17 is six steps `82b282d`→`adb5644` with
   **DB 274 · 3,921** (the printed `b7ed567`-lineage + 277 · 3,939 were
   W-18's figures); W-18 is six steps `fa24490`→`cf0248c` (the cell had named
   only the final head, four steps short); W-19's delivery head is `d5b4caf`
   (`b7ed567` is its step 4 — the eighth envelope's head, never the wave's last
   commit); W-23's cell made its two commits (`b6812a7` + `41c3701`) explicit.
   The W-20/W-21/W-22 rows verified correct and untouched. The dated note lands
   under the table (the F1 literal-truth law).
2. **F-2 — the unit-ledger third term «940 → 840» corrected in the dispatch's
   three positions — and the sweep's fourth, disclosed:** the dispatch counted
   three positions; this session's sweep of the delivered tree found the same
   defect at **four** evidence sites — the w19/w20/w21/w22 gate READMEs, each
   carrying the arithmetic with a parenthetical breakdown whose own sum is
   393+274+43+56+38+36 = **840** (never 940; the totals reconcile only with
   840: 1,844 = 857+147+840 · 1,852 = 857+155+840 · 1,868 = 857+171+840).
   **All four corrected** with the same dated note at each claim site, the
   count disclosed here and in the wave's records — this session's own unit
   battery re-proves the figure: **1,868 = 857+171+840 EXACT** (§5).
3. **F-3 — the IMPLEMENTATION_STATUS header updated:** the file's top status
   line had stood at the 048-era text since 2026-11-20 (the 049 waves flipped
   the ROW, never the file header — the W-23 "triple flip" was two-thirds
   honest at the file level; this correction is its dated repair): the new
   dated line prepended — PHASE-049 COMPLETE at `phase/049` + PHASE-050 IN
   PROGRESS (the master plan wave, the implementation waves BLOCKED until the
   approval dispatch) + the five corrections named + the reservations +
   RISK-033 at EIGHT. The stale 048 line stands below it in the file's rolling
   history, untouched.
4. **F-4 — the 050 archive form declared explicitly (§5):**
   `ERP_PLATFORM_PHASE050.zip` — the git-tracked tree at the closure head, the
   commit-hash as the zip's first entry (the 048/049 shape verbatim), the
   ADDITIVE-ONLY law, **EXCLUDING every standing platform zip:
   أرشفة الأرشيف ممنوعة** (the zip never contains another zip), the members
   byte-verified, the standing zips verified untouched, delivered with the tag
   **`phase/050`** — DELIVERY, never acceptance (the §1a (a) ruling).
   **[F-050a, dated 2026-11-22 (the owner's correction order riding W-24): the
   parenthetical «the 048/049 shape verbatim» above was IMPRECISE about the
   physical shapes — the W-24 session's own zip inspection confirms: 048 = the
   commit hash in the ZIP COMMENT + folder (directory) entries (4,130 entries =
   702 dirs + 3,428 files, no hash file entry); 049 = FLAT (zero directory
   entries; 3,773 = the 3,772 git-tracked files + the commit-hash `b6812a7…` as
   the FIRST ENTRY, no zip comment) — 049's archive is its OWN physical shape,
   never 048's, and the two are NOT the same shape. The declared 050 form = the
   PHYSICAL shape of 049: FLAT, the commit-hash as the FIRST ENTRY,
   ADDITIVE-ONLY, excluding every standing zip; §5's declaration block and the
   w23/README claim site carry this same dated note.]**
5. **THE ARCHIVE-FORM ACKNOWLEDGMENT (إقرار شكل الأرشيف):** acknowledged and
   recorded by this plan — the 050 closure wave (W-32, §3) executes EXACTLY the
   form declared in F-4, nothing wider, nothing narrower: one zip, additive
   only, no nested archives, the tag after the members are byte-verified. This
   line is the acknowledgment the dispatch demanded; the closure wave cites it.

**The dispatch's boundary carried verbatim:** «تسليم لا قبول — ليست موافقة
إنتاج» — delivery, never acceptance, never production approval — binds this
plan and every wave it governs.

## 0c. The continuity rules (the owner's standing list — carried verbatim, binding on all 050 waves)

1. **Same-session evidence:** thirty-three consecutive waves through the 049
   closure; this plan wave is the **THIRTY-FOURTH**; every evidence log in
   `audit-evidence/phase050-*/` is this session's own run — never inherited,
   never replayed from cache (the typecheck cache-hit class is replaced with
   the force/plain re-run and disclosed).
2. **Prior isolation + the two-headed protocol:** the pre-isolation mandate
   (the time-sensitive isolates run standalone BEFORE any heavy envelope in
   every DB wave) + the two-head protocol at every flake appearance (both heads
   re-proven, ALL logs kept, the disclosure at the claim site) — the standing
   isolate set for 050's first DB wave: soak · fcm · email · **the cmms sweep**
   (the W-22 fourth isolate) + **the quality calibration sweep when it ships**
   (it joins the isolate set the wave it lands).
3. **The six identifiers + the 049 tag protected:** the three annotated tags'
   six identifiers (`phase/046` = `88568da`→`4ddb39f` · `phase/047` =
   `90fd428`→`5b73bd1` · `phase/048` = `d46fa87`→`ba459ff`) + the 049 tag
   (`phase/049` = `1fd74e9`→`41c3701`) — دائمة لا تُمسّ; every history-secrets
   run samples all four anchors; every wave's §0a verifies them.
4. **The cumulative archive law:** أرشفة الأرشيف ممنوعة (F-4 above) — the
   standing zips are never re-zipped; the evidence archive is ADDITIVE-ONLY
   (new files only; no moving, no deleting, no renaming of any existing
   evidence directory).
5. **RISK-033 at EIGHT incidents:** ZERO new across 049; the register row
   stays OPEN and **closes only by the owner's order** — never a closure
   criterion for 050; any new appearance is named, root-caused, two-head
   re-proven, and counted at the claim site.
6. **The standing recalls, as transferred in the 049 completion report §4**
   (never restated narrower, never folded): **the 043 hard review OPEN** ·
   **RISK-031/032 OPEN** · **the §7(b) remarks** (the three 045 final-audit
   remarks + 047's own) · **the register's exactly-two narrowed items
   (SANED 15,000 + EOSB M/51 Art. 84)** · **the 045 self-board Tabs defect**
   (the owner dispatches; every 050 board is immune — the data-slot shape) ·
   RISK-033 at eight.
7. **The standing reservations: G-62…G-63 · INV-035 · BR-101…BR-104 —
   لا كتابة خارجها** (red line §6.16): the 050 program allocates NO golden,
   invariant, or business-rule identifier outside these; the ID_LEDGER's
   reserved wordings are the canon the closure wave writes; the checker's
   probe-7 fixture already points at G-62/PHASE-050 (claimant PHASE-051 at
   the flip — the W-15 precedent's sixth move).

## 0. Inputs consumed (the plan-first reads — one focused pass over the `41c3701` head, 2026-11-22, this session)

- `docs/implementation/phases/PHASE-050.md` (spec §1–§8 — T-01…T-20, the
  twelve tables, the +10 keys, the two flags, the four report contracts) ·
  COMPLETENESS_REGISTER CR-20 · the gap analysis: ERP_FULL_GAP_ANALYSIS §7
  (M-23 — the production quality-gate contract) + §8 (**Q-01…Q-12** — NCR,
  CAPA, calibration, SPC, specifications, supplier scores, COA, complaints,
  holds/recall, management review, hazard registers) · ID_LEDGER row 47 (050 =
  G-62…G-63 · INV-035 · BR-101…104, re-coordinated 2026-11-13/14 — the
  original plan's G-63/G-64 · INV-034 · BR-070…073 predate the 037–042/044
  waves' consumption; shifted +1 by the 043 round's BR-081).
- The 049 delivery records: the completion report **§5 handoff** (calibration
  instruments bind to the asset card + the service-history timeline; the
  expiry-sweep pattern — the 30/7/0 ladder + the structural dedupe + the
  settings surface — extends to calibration due dates; the CMMS boards'
  data-slot shape, the INV ledger-tie report pattern, the per-arm-world spec
  laws are the reusable precedents) · the 049 master plan (the wave/gate/
  red-line pattern this plan inherits) · `agent-ctx/NEXT_ACTION.md` (the 050
  intake with the standing constraints).
- Code research (this session, read-only): the existing inspections module
  (the inspection-result surface the specifications map contract feeds from);
  the batch/serial ledger (the recall drill's traversal substrate —
  `wms-serial-ledger.spec`, the genealogy spec); the sales delivery +
  inventory issue paths (the hold-blocking contract's baseline surface); the
  posting engine's INV-013 source-key registration + the purpose-map
  fail-closed law (G-61's precedent); the 038 scorecard surface (the supplier
  quality feed contract's consumer); the 0111 sweep-settings pattern; the
  049 cmms fixtures (the per-arm-world law); the four annotated tags.

## 1. Settled design decisions (from the plan-first reads — binding for all waves, amendable only by the owner's dated dispatch)

- **D-01 — THE HONEST MIGRATION SLOTS: 0113–0116.** The phase doc's
  `0087…0090` predates the 037–049 programs and is stale by its own §4 note
  ("Exact numbers confirmed against the Drizzle journal at implementation
  time" — the 048/049 D-02 precedent verbatim). The journal stands at 112
  entries (idx 111, `0112_cmms_notifications_category_repair` — verified this
  session); 050 integrates at **0113 · 0114 · 0115 · 0116** (idx 112–115), no
  renumbering, no touching any published migration (the constants law).
- **D-02 — THE TWELVE TABLES, FOUR SLOTS:** `0113_quality_specifications.sql`
  (`quality_specifications` per item + parameter rows, target, UCL/LCL ·
  `spc_measurements` per-parameter samples) · `0114_quality_ncr_capa.sql`
  (`ncr_records` — source INSPECTION/PRODUCTION/COMPLAINT/SUPPLIER, severity,
  affected qty, disposition REWORK/SCRAP/ACCEPT/RETURN_TO_SUPPLIER ·
  `capa_records` — root cause, actions with owners/dates, effectiveness ·
  `complaints` — channel, severity, item/batch ref, NCR link) ·
  `0115_quality_calibration_supplier.sql` (`calibration_records` — the
  instrument AS an asset (D-08), standard used, result, due date ·
  `supplier_quality_scores` — the rolling fold · `coa_documents` — the
  generated certificate incl. the conformity type) ·
  `0116_quality_holds_recall.sql` (`batch_quality_holds` — hold/release with
  reason + disposition link · `recall_registry` — the drill's record ·
  `quality_management_reviews` — the meeting record + the indicator pack ·
  `hazard_registers` — HACCP hazards/CCPs/critical limits/monitoring · **THE
  DATA-ONLY grants block** (the 0098/0103/0108 pattern). All twelve:
  tenant_id prefix + RLS policies (A1–A10, the composite-FK law (id, tenant_id)
  wherever a root other than tenants is referenced) + Drizzle mirrors +
  `tables.registry` +12 (the A-suite arms) + ENTITY_CATALOG rows
  (**328 → 340**) + the journal/manifest/spec pins to 116 with the chain
  re-proven from zero at every full sweep.
- **D-03 — THE +10 KEYS, ZERO-DRIFT FROM THE FIRST INCREMENT (matrix §3.28,
  337 → 347):** `quality.view` · `quality.manage` · `quality.ncr.manage` ·
  `quality.capa.manage` · `quality.calibration.manage` · `quality.spc.view` ·
  `quality.complaints.manage` · `quality.coa.generate` ·
  `quality.hold.manage` · `quality.recall.manage` — owner all ten, the
  read keys down-scoped per the 048/049 precedent; ROUTE_PERMISSIONS
  **1,102 → 1,102+n dated** (keys-seed-first: the keys bind as the API waves
  ship, every change dated at the block — the 1,102 baseline anchor).
- **D-04 — THE TWO FEATURE FLAGS (CR-36f):** `quality` + `quality.spc`,
  template-composable grants — food-manufacturing, agriculture, healthcare and
  electronics compose `quality` by default; `quality.spc` composes for
  food-manufacturing and electronics (the manifests + FEATURE_DEPS +
  the template docs' enablements, the 0098/0103 pattern; STARTER AT THE
  DECLARED NEUTRAL ZERO where the matrix so records).
- **D-05 — G-62 (the NCR SCRAP write-off):** the SCRAP disposition posts the
  inventory write-off **through the REAL posting engine** on the
  purpose-mapped pair (the write-off expense account against the
  per-warehouse inventory at the affected quantity's own value — the 044
  valuation-ledger precedent), **fail-closed PURPOSE_NOT_MAPPED until the
  tenant maps** (the G-61 law), INV-013 idempotent with the single-use
  source key (ncr_record, disposition), the all-or-nothing rollback, the
  affected-quantity floor ≤ the batch's own on-hand. REWORK/ACCEPT/
  RETURN_TO_SUPPLIER carry NO GL entry (the recorded honest shape; the
  return-to-supplier rides the 044 supplier-returns path when consumed).
- **D-06 — G-63 (the external quality cost):** the external calibration and
  CAPA service costs post the quality expense through the REAL engine —
  DR the purpose-mapped QUALITY_EXPENSE · CR EXTERNAL_ACCRUAL (the 049 G-59
  external leg's own shape), fail-closed until mapped, INV-013 single-use,
  the cost line never double-counted with a maintenance work order's external
  leg (the source keys differ by construction).
- **D-07 — INV-035 + BR-101 (the batch hold): ONE shared blocking validation
  service wired into EVERY issue/ship path** — the baseline sales delivery +
  inventory issue paths bind at W-28; the 044 WMS picking paths bind through
  the recorded contract the day 044 delivers; the enforcement-drift risk is
  structurally mitigated: the service is the ONLY gate, and the INV-035
  invariant test extends the document-validation suite EVERY path must extend
  (the phase doc §7 verbatim); release requires the disposition-linked record;
  the check is SERVER-SIDE ONLY (offline documents carrying a held batch are
  rejected at sync reconciliation — OA-02 N/A-recorded, D-20).
- **D-08 — CALIBRATION ASSETS (the 049 handoff verbatim):** the instrument is
  an asset on the 049 surfaces — `calibration_records` binds to the asset card
  and lands on the service-history timeline; the `quality-calibration-due`
  sweep job extends the expiry-sweep pattern (30/7/0, the structural dedupe
  per instrument+window+day, the typed settings surface — the 0111 precedent's
  own settings keys) on the existing pg-boss queue; the sweep joins the
  isolate set the wave it ships.
- **D-09 — BR-102 (the NCR closure gate):** no NCR closes without a
  disposition — the typed refusal naming the record; the disposition stamps
  the record and (for SCRAP) fires D-05 exactly once.
- **D-10 — BR-103 (the CAPA effectiveness gate):** a CAPA cannot close before
  its actions' due dates pass AND the effectiveness check is recorded — the
  typed refusal carrying the open action/due-date figures.
- **D-11 — BR-104 (the COA gate):** generation is blocked unless EVERY
  parameter is within tolerance or carries an accepted-deviation NCR reference
  — the typed refusal naming the parameter and both figures; the certificate
  renders bilingual AR/EN (the W-13/W-21 print laws: `bi()` exclusively,
  docDate determinism, the REAL Chromium test both directions, the
  versioned A4 render).
- **D-12 — SPC (the pure layer FIRST, the unit-first law):** X-bar/R, Cp/Cpk
  and the out-of-control flags computed in a PURE module with PROPERTY TESTS
  on known/pinned reference datasets before any consumer lands (the
  wrong-control-limits risk is the phase doc §7's own; the formulas pinned in
  the phase report); the surface rides the `quality.spc` feature key; the
  measurements draw from the specifications' parameters (no parallel
  parameter source).
- **D-13 — THE SUPPLIER QUALITY FEED (a documented contract, not a hard
  prerequisite):** the rolling scores build from NCRs (SUPPLIER source),
  rejections and delivery performance; the documented feed contract to the
  038 scorecards is recorded in both phase surfaces — the 038 consumer reads,
  never re-computes (zero parallel computation).
- **D-14 — THE RECALL DRILL (Q-09/Q-12):** batch → where-used → customers ON
  the existing batch/serial ledger (the genealogy + serial-ledger reads,
  index-driven; the OA-06 budget is an acceptance criterion — the
  large-ledger risk is the phase doc §7's own); the drill RECORD (the recall
  registry row) is distinct from the drill QUERY (the live read).
- **D-15 — THE REVIEW PACK + HAZARD REGISTERS (Q-10/Q-11):** the management
  review record carries the indicator pack (NCR/CAPA/complaint/SPC status —
  the engines' own reads, zero recomputation) + decisions; the HACCP-style
  hazard registers are TEMPLATE-COMPOSABLE (composed by the
  food-manufacturing template's manifest — never hardcoded checklists; the
  tenant owns the critical-limits structure; the regulatory-variance risk is
  the phase doc §7's own).
- **D-16 — THE M-23 PRODUCTION-GATE CONTRACT (recorded here, enforced when
  042 delivers):** a documented contract to the routing surface — an
  operation flagged as a quality gate cannot complete without the inspection
  result recorded against the item's specification; the contract is written
  here, consumed when 042 ships (the 038/044 contract precedent).
- **D-17 — THE WEB PLANE (five screens + the print surface):**
  `/quality/ncr` · `/quality/capa` · `/quality/calibration` · `/quality/spc`
  · `/quality/complaints` + the COA print surface + **the hold banners on
  every batch-bearing surface** — the 048/049 board patterns (the data-slot
  shape, immune to the 045 Tabs defect; the typed-refusal panels with FULL
  payloads; the shared TypedRefusalPanel); ⌘K registration (OA-04); the
  12-template screen discipline.
- **D-18 — THE FOUR REPORT CONTRACTS (registry 118 → 122, ALL PIN SITES
  TOGETHER — the 048-W14 law, no partial anchoring):**
  `quality.ncr-register` · `quality.capa-status` · `quality.calibration-due`
  · `quality.complaints-summary` — every contract reads the engines' outputs
  VERBATIM (zero parallel computation); the day counts derive from the
  DATABASE'S OWN CURRENT_DATE inside the statement (the derived-step clock
  law); the catalog↔registry reconciliation check extends 118/118 → 122/122.
- **D-19 — RLS A1–A10 × THE TWELVE TABLES (D-13 of 049 verbatim):** two
  dedicated probe tenants with FULL FK-chained quality worlds through the
  APP-ROLE path; the composite-FK law (the pg_constraint catalog walk +
  the live FK-inversion probe 23503); the forged-tenant INSERT/UPDATE/DELETE
  matrix with zero residue; the evidence tables (NCR/CAPA/complaints/COA/
  holds/recalls) carry NO DELETE grant by design — the A5 split asserted.
- **D-20 — OA-02 N/A-RECORDED:** QMS workflows are web-only; the hold check
  is server-side so any offline document carrying a held batch is rejected at
  sync reconciliation — the recorded ruling, not a silent scope cut.

## 2. Migration inventory (the honest slots — journal ends at `0112`, idx 111; the fingerprint declared by design)

| Slot | File | Contents |
|---|---|---|
| 0113 | `0113_quality_specifications.sql` | `quality_specifications` (per item: parameter, target, UCL/LCL) + `spc_measurements` (per-parameter samples) |
| 0114 | `0114_quality_ncr_capa.sql` | `ncr_records` (source/severity/qty/disposition — the single-use G-62 stamp + the BR-102 closure gate) + `capa_records` (root cause, actions, the BR-103 effectiveness gate — the G-63 cost line) + `complaints` (intake + the NCR link) |
| 0115 | `0115_quality_calibration_supplier.sql` | `calibration_records` (the instrument-asset binding + the due-date sweep's own anchor) + `supplier_quality_scores` (the rolling fold) + `coa_documents` (the BR-104 gate + the bilingual print's frozen snapshot) |
| 0116 | `0116_quality_holds_recall.sql` | `batch_quality_holds` (hold/release + the disposition link — INV-035/BR-101) + `recall_registry` (the drill record) + `quality_management_reviews` + `hazard_registers` + THE DATA-ONLY grants block (the 0098/0103/0108 pattern) |

**THE MIGRATION FINGERPRINT (declared by design — the owner's framework item):
the chain 112 → 116; ENTITY_CATALOG 328 → 340 (+12 tables); the permissions
drift 337 → 347 (+10 keys, D-03 — zero-drift from the first increment);
ROUTE_PERMISSIONS 1,102 → 1,102+n dated (keys-seed-first, every change dated
at the block); the report registry 118 → 122 (W-30, all pin sites together);
i18n 6,955 + ~240 declared per surface wave (the first surface wave declares
its delta BY BOTH COUNTS; mobile 371 standing) — the two feature flags
(`quality` · `quality.spc`) and the template manifest enablements land with
the keys.**

## 3. Task waves (the canon T-01…T-20; the wave numbering — §7 (a))

### W-0 — The master plan wave (T-00, orchestrator) — THIS WAVE
The plan delivered for review with the same-session baseline envelope at
`41c3701` (§5; the evidence `audit-evidence/phase050-plan/`); the
acceptance-criteria ledger OPENED with this plan
(`PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-050 — the owner's framework law: the
ledger opens with the plan and closes with the closure); **the five dated
corrections landed (§0b — F-1…F-4 + the archive-form acknowledgment)**;
NEXT_ACTION updated. **The implementation waves are BLOCKED until the owner's
approval dispatch** (the dispatch's own boundary: الخطة للمراجعة قبل
الإطلاق — وليست موافقة إنتاج).
**Exit:** the plan APPROVED with amendments (recorded as §1a on the 046–049
pattern); the approval head baselined if it moved.

### W-24 — The foundation (T-01 + T-02 + T-03 + T-04, orchestrator)
Migrations 0113–0116 + every mirror/registry/catalog/matrix/pin in ONE
increment (D-01/D-02's shapes; **+10 keys 337 → 347 — zero-drift from the
first increment**; the two flags + the template manifest enablements —
D-04; ROUTE_PERMISSIONS stays 1,102 keys-seed-first with the dated note).
**The pre-isolation mandate carries: the four standing isolates (soak · fcm ·
email · the cmms sweep) run standalone before the wave's DB envelope.**
**Exit:** acceptance #1 green (migrations + catalog 328 → 340 + zero-drift
347 = 347); the chain re-proven from zero; the full DB suite at the new
count (283 + the quality schema spec).

### W-25 — The specifications + NCR engines (T-05 + T-06, orchestrator)
The PURE layer first where arithmetic exists (the unit-first law); the
specifications API + **the inspection-result mapping contract** (feeds from
the existing inspections module — a documented contract, the engines' own
rows, zero parallel computation); the NCR API (sources, severity, dispositions
— BR-102's closure gate) + **G-62's posting** (D-05).
**Exit:** acceptance #2's NCR arms + #6's specification feed arms green with
evidence.

### W-26 — CAPA + calibration (T-07 + T-08, orchestrator)
The CAPA API (root cause, actions, **BR-103's effectiveness gate** — D-10)
+ **G-63's posting** (D-06); the calibration API (the instrument-asset
binding — D-08) + **the `quality-calibration-due` sweep job** (30/7/0, the
dedupe, the settings surface) — **the sweep joins the isolate set from this
wave** (§0c (2)).
**Exit:** acceptance #2's CAPA arms + #8's sweep arms green.

### W-27 — SPC + supplier scores + COA (T-09 + T-10 + T-11, orchestrator)
**The SPC pure module FIRST with the property tests on pinned reference
datasets** (D-12 — the unit-first law before any consumer); the SPC service +
surface API; the supplier quality scores (the rolling fold + **the documented
038 feed contract** — D-13); the COA generation service (**BR-104** — D-11).
**Exit:** acceptance #5 + #6's score arms green.

### W-28 — Complaints + holds + recall (T-12 + T-13 + T-14, orchestrator)
The complaints API (intake, triage, the NCR link, notifications); **THE SHARED
BLOCKING VALIDATION SERVICE** wired into every baseline issue/ship path
(**INV-035 + BR-101** — D-07: one service, the only gate, the invariant test
extending the document-validation suite); the recall drill on the batch/serial
ledger (D-14).
**Exit:** acceptance #3 + #7's drill arms green (the INV-035 blocking matrix
over every baseline path).

### W-29 — The web plane (T-15, orchestrator)
The five screens + the COA print surface + **the hold banners on every
batch-bearing surface** (D-17 — the data-slot shape; the typed-refusal panels
with FULL payloads). **i18n BY BOTH COUNTS from this wave** (the first
surface wave — the declared delta 6,955+n = 6,955+n + mobile 371 standing,
§5).
**Exit:** the boards render the engines' figures VERBATIM; the flag-gating
verified; the declared i18n delta green; the COA print law green (the REAL
Chromium test both directions, deterministic byte-identical).

### W-30 — The review pack + the reports (T-16 + T-17, orchestrator)
The management review pack + the hazard registers composed into the
food-manufacturing template manifest (D-15); **the four report contracts
(registry 118 → 122, all pin sites together — D-18)**.
**Exit:** acceptance #8's template arm + #9's report arms green.

### W-31 — The proof pack (T-18, orchestrator)
**The golden transcripts G-62/G-63 with the MANDATORY failure packs** (the
refusals WITH their full payloads, the zero residue, the flip-and-restore
with the green re-runs — the JOURNAL_RULES §7 law, the 048-W14/049-W22
pattern) + **the INV-035 blocking-matrix golden** (the held batch refused on
EVERY baseline path + the offline-rejection shape) + **the RLS attack matrix
A1–A10 over the TWELVE tables** (D-19) + **the OA-06 EXPLAIN budgets** (the
SPC chart reads + the recall drill — the W-9 assertion law: never a forced
plan, never an isolated probe context).
**Exit:** acceptance #3's golden arms + #9's RLS/OA arms green — #1…#9 ALL
GREEN.

### W-32 — Docs + gates + closure (T-19 + T-20, orchestrator)
The canon docs in the ID_LEDGER's reserved wordings (JOURNAL_RULES G-62/G-63
+ note 20 · ACCOUNTING_INVARIANTS INV-035 · BUSINESS_RULES BR-101…BR-104 —
**لا كتابة خارجها**: no identifier outside the reservations enters the canon)
+ **THE ID_LEDGER FLIP** (atomic with the canon rows — implemented G 63 ·
INV 35 · BR 104; the checker's self-test probe (7) moves to G-64/PHASE-051,
claimant PHASE-052 — the W-15 precedent's sixth move) + the full sweep at the
final head (the isolates first; the amended ceiling law) + the completion
report (the cumulative ledger walked and closed + the battery scope map +
the FULL unit-package table + the open-items log transferred explicitly) +
the triple flip + **THE ARCHIVE `ERP_PLATFORM_PHASE050.zip` EXACTLY AS
DECLARED (F-4/§5 — the archive-form acknowledgment executed)** + **the tag
`phase/050`** (DELIVERY, never acceptance — the §1a (a) ruling).
**Exit:** acceptance #10 green; the phase closed at the delivery head.

## 4. Test matrix (the permanent suites; the pre-isolation mandate carried)

- **Unit (pure, first):** the SPC arithmetic (X-bar/R, Cp/Cpk, the
  out-of-control flags — property tests on pinned reference datasets, D-12);
  the hold-blocking fold (the batch/key resolution, the disposition-link
  release rule); the supplier-score fold; the COA tolerance fold (within/
  outside/accepted-deviation — BR-104's three shapes); the calibration
  due-date fold (the 30/7/0 windows, the dedupe keys); the NCR/CAPA
  lifecycle folds (the closure gates' refusal shapes).
- **DB specs (the `__db__/quality/` family, the hr/projects/cmms precedent):**
  `quality-schema.db.spec` (the structural laws refused BY NAME — every
  rejection arm on its OWN world, أذرع الرفض كلٌّ على عالمه) ·
  `quality-specs.db.spec` (the mapping contract from the inspections module's
  own rows) · `quality-ncr.db.spec` (the lifecycle, BR-102, G-62's exactly-
  once + the unmapped-purpose refusal) · `quality-capa.db.spec` (BR-103's
  gate + G-63) · `quality-calibration.db.spec` (the asset binding + the sweep
  isolate) · `quality-spc.db.spec` (the service vs the pure module's pinned
  outputs) · `quality-supplier-scores.db.spec` (the rolling fold + the 038
  feed contract) · `quality-coa.db.spec` (BR-104's three shapes + the frozen
  snapshot) · `quality-complaints.db.spec` (the intake + the NCR link) ·
  `quality-holds.db.spec` (**the INV-035 blocking matrix over every baseline
  path + the release rule**) · `quality-recall.db.spec` (the drill +
  the OA-06 budget) · `quality-goldens.db.spec` (G-62/G-63 with the failure
  packs + the INV-035 golden) · `quality-rls.db.spec` (A1–A10 × 12, the
  hostile worlds) · `quality-explain-budgets.db.spec` (OA-06) · the migration
  chain spec extended to 116. **The per-arm-world law** (freshPartsWorld's
  precedent): no spec's world moves another spec's absolute assertions.
- **Web:** the five screens' render + parity + flag-gating specs; the COA
  print spec (AR/EN + RTL + deterministic byte-identical — the REAL Chromium
  test, both directions); the hold-banner spec on a batch-bearing surface.
- **THE PRE-ISOLATION MANDATE (every DB wave):** the standing isolates —
  soak · fcm · email · the cmms sweep — run STANDALONE FIRST, before any
  heavy envelope (§0c (2)); the quality calibration sweep joins at W-26.
  The full-suite envelope: the nine-part plan (the five load parts + the
  four isolates) with the coverage verified BEFORE the first run (the union
  == the disk inventory, the comm diff empty) — every part inside the amended
  ceiling min(expectation, 600 − 30 = **570s**), declared at the claim site
  before the run.

## 5. Gate list (the exit bar — same as 043–049, no relaxations) + THE ARCHIVE FORM (F-4)

typecheck 8/8 · lint 8/8 · depcruise clean (the fresh count re-baselined at
any environmental delta; the disclosure law) · unit 8/8 packages (the FULL
unit-package table in every closure report) · **the full DB suite green at
the new count — the isolates standalone FIRST, the coverage verified before
the first run, every part INSIDE THE AMENDED CEILING 570s, the declaration at
the claim site before the run** · docs:validate green (33/33 or the extended
count declared) · **i18n parity BY BOTH COUNTS from the first surface wave
(W-29): every web wave declares its delta (6,955+n = 6,955+n) AND the mobile
count (371 = 371)** · permissions drift **337 → 347 = 347 at every wave from
W-24** · manifests 13/13 · id-ledger 0 errors + self-test OK (the flip at
W-32: implemented G 63 · INV 35 · BR 104) · history-secrets 0 (the FOUR tag
anchors verified untouched) · `check:rls` clean at **340** · OA-06 budgets
green · the standing checks (boundary-negative, shells, capabilities) per the
049 gate table · **every evidence log through the guarded wrapper (the
vitest summary guard — judge by the SUMMARY LINES, never the raw exit code,
the NF-12 verdict rule)** · the exact commit count declared at every
delivery · same-session evidence only · **the local-vs-remote verification as
every wave's first act (§0a)**.

**THE 050 ARCHIVE FORM — DECLARED EXPLICITLY (correction F-4, the
dispatch's own demand; amended by F-050a, dated 2026-11-22 — the owner's
correction order riding W-24):** the closure wave (W-32) delivers
**`ERP_PLATFORM_PHASE050.zip`** = **the git-tracked tree at the closure head**
(the commit-hash as the zip's FIRST entry — the 048/049 shape verbatim) ·
**[F-050a's amendment: the phrase «the 048/049 shape verbatim» was IMPRECISE —
048 = the hash in the ZIP COMMENT + folder entries; 049 = FLAT + the hash as
the FIRST ENTRY (this session's own inspection: 048 carries 702 directory
entries and a 40-char comment hash, 049 carries zero directories and the hash
file `b6812a7…` first); the declared 050 form = the PHYSICAL shape of 049:
FLAT, the commit-hash as the FIRST ENTRY — §0b-F-4 and the w23/README claim
site carry this same dated note.]** ·
**THE ADDITIVE-ONLY LAW** (members byte-verified) · **EXCLUDING every standing
platform zip: أرشفة الأرشيف ممنوعة — the zip never contains another zip** ·
the standing zips (034_FINAL…049) verified untouched · delivered with the tag
**`phase/050`** — DELIVERY, never acceptance (the §1a (a) ruling). **The
archive-form acknowledgment (إقرار شكل الأرشيف):** this is the whole of the
form — one zip, additive only, no nested archives, the tag after the
byte-verification; W-32 executes exactly this and nothing else.

**This plan wave's own envelope (`audit-evidence/phase050-plan/`, every log
this session — the THIRTY-FOURTH consecutive wave):** the fresh-clone §0a
record (remote @ 41c3701 = phase/049; the four tags' identifiers intact;
zero-diff reconciliation; the 879/879 log census) · typecheck 8/8 · lint 8/8
· depcruise clean 2,110 · 15,821 (the W-22 count EXACT — a docs-only wave) ·
unit 8/8 — **148 · 1,868** (api 68·857 · web 21·171 · mobile 27·393 · desktop
16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the
ledger arithmetic **1,868 = 857+171+840 EXACT**, the F-2 figure re-proven by
this session's own run) · **THE FULL DB SUITE 283 · 3,984 · 0 failed ·
0 skipped — the nine-part envelope** (the four isolates standalone first:
soak 1·1 227.4s · fcm 1·8 14.7s · email 1·5 12.3s · sweep 1·4 6.1s; then
smoke 3·1,843 19.2s · perf-rest 5·23 94.0s · chunk-a 97·764 141.6s ·
chunk-b-rest 86·625 63.9s · chunk-c 88·711 74.7s — every part inside the 570s
ceiling, the durations the vitest summaries' own printed figures; the coverage
verified BEFORE the first run: 283 = 283, missing NONE, extra NONE,
duplicates NONE) · **the 112-chain scratch from zero TWICE**
(CHAIN_112_APPLIED → [check-rls] OK — 328, both logs) · drift 337 = 337 ·
i18n 6,955 = 6,955 + mobile 371 = 371 · tokens 50/50 · manifests 13/13 ·
docs:validate 33/33 · id-ledger 0 errors + self-test all-probes-OK
(implemented G 61 · INV 34 · BR 100 — the 049 flip's own figures standing)
· history-secrets 0 violations · 6,543 allowlisted hits (the W-22 6,525 +18
— the window's shift: the two W-23 commits entered the last-200 sample; the
RESUMED slices 67+67+66 + the finalize, coverage asserted EXACT 200/200;
the FOUR tag anchors untouched) · capabilities agree · shells PASS/PASS ·
boundary PASS.

## 6. Governance red lines (carried, unchanged — the 049 set + the reservations law)

1. One phase per run; the phase doc is the contract; out-of-scope is
   prohibition (full ISO document control/ECM is 062's · supplier-portal
   collaboration 038/060's · LIMS beyond calibration is not an audited gap ·
   live lab-instrument integrations wait on 055 · the production routing
   itself is 042's — the contracts are recorded, never pre-built).
2. Doc precedence (ARCHITECTURE_BASELINE + ADRs + CD-01…12); discrepancies
   recorded, never silently rewritten.
3. Never weaken: tenant isolation (RLS), the posting-engine monopoly,
   INV-001…034 (…035 at delivery), auditability — every G-62/G-63 posting
   rides the engine with registered source keys under INV-013 idempotency.
4. No binary floating point for money (ADR-0009) — the affected quantities,
   the write-off values, the scores, the reports; the SPC statistics compute
   on Decimal where money-adjacent and on the documented numeric policy
   where statistical (the formulas pinned, D-12).
5. No fabricated compliance content (BR-055 family): the inspection results
   come from the inspections module READ-ONLY; an unset tolerance is
   UNTOLERATED, never a fabricated limit; the mappings are tenant DATA
   (fail-closed until mapped).
6. **The F1 literal-truth law:** every record claim — counts, paths,
   attributions — verified against the artifact before it is written; dated
   corrections at the original claim site when found (this wave's five
   corrections are the law's own exercise).
7. **The same-session evidence rule** (thirty-three consecutive waves and
   counting — this wave the thirty-fourth) + the scope-label law (claim only
   the affected surface; the full DB suite re-runs on migration/schema
   changes — W-24 and W-32 run it; the mid waves run their folders).
8. **The OA-06 assertion law (the W-9 ruling):** probes assert the stable
   index-driven law, accept the planner's legitimate paths, log the observed
   plan verbatim — never force a plan, never isolate the context.
9. The evidence-log capture convention (NF-3/NF-4, structurally through
   `scripts/capture-evidence.sh` with the W-6 vitest summary guard; the
   NF-12 verdict rule — the summary lines, never the raw exit code).
10. **THE CONSTANTS LAW:** migrations integrate from 0113 — no renumbering,
    no touching any published migration; the routes ledger's every change
    carries a dated note (the 1,102 baseline anchor); ENTITY_CATALOG appends
    (328 now, +12 at W-24); **no evidence archiving or deletion — the full
    envelope at every delivery**; **ALL TAGS immutable** (`phase/046` ·
    `phase/047` · `phase/048` · `phase/049` — دائمة لا تُمسّ); the evidence
    archive ADDITIVE-ONLY.
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
    excludes the standing archives** — the 050 form declared at §5/F-4; the
    members byte-verified; the standing zips verified untouched.
16. **THE RESERVATIONS LAW (the owner's 050 dispatch): G-62…G-63 · INV-035 ·
    BR-101…BR-104 — لا كتابة خارجها** — no golden, invariant, or
    business-rule identifier outside these enters any 050 surface, spec,
    contract, or doc; the ID_LEDGER's reserved wordings are the canon.

## 7. Open inputs for the owner (ruled at the approval dispatch — the plan is BLOCKED until then)

- **(a) THE WAVE NUMBERING.** The standing no-collision law (the §1a (b)
  precedent: the global sequence, no renumbering) puts 050's implementation
  waves at **W-24…W-32** (W-16…W-23 exist in 049's delivered records). This
  plan proposes W-24…W-32 over T-01…T-20 as §3 divides them; the owner
  confirms or overrides to a phase-relative restart at approval — either way
  the LAWS bind from the first implementation wave whatever its number.
- **(b) THE G-62/G-63 ACCOUNT SHAPES (D-05/D-06).** The purpose-mapped pairs
  are proposed (the write-off expense ↔ the per-warehouse inventory at the
  affected quantity's own value; the quality expense ↔ the external accrual);
  the owner may rule the exact account purposes at approval — the golden
  transcripts prove whichever is ruled; fail-closed until mapped either way.
- **(c) THE STANDING CARRIED ITEMS (never restated, never folded —
  transferred explicitly per the dispatch's list §0c (6))** and the
  reservations law §6.16 — **NOT production approval: the approval dispatch
  is a launch authorization only.**

**The implementation waves are BLOCKED until the owner's approval dispatch**
(the dispatch's own boundary: الخطة أولاً للمراجعة قبل الإطلاق — وليست
موافقة إنتاج). PHASE-049 stands COMPLETE at `phase/049` (W-16…W-23 delivered
and the owner's W-22/W-23 acceptance closed it as delivery, with this wave's
five corrections repairing the record's honest edges); PHASE-050's plan is
this document, its evidence envelope beside it, its acceptance ledger OPENED,
its archive form declared and acknowledged.
