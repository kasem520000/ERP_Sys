# PHASE-047 Master Plan — HR Growth (Talent & Performance)

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-047.md`
(T-01…T-18 are the canon task spine; this plan keeps those numbers and adds T-00).
Register: CR-17 · Wave 2 / Stage 13 · Roadmap ~4–6 weeks.

Authority chain: PHASE-047.md → [CR-17](../docs/planning/COMPLETENESS_REGISTER.md)
→ the **045 → 046 → 047 hard ordering** (COMPLETENESS_ROADMAP §5) → the
ID_LEDGER's 047 reservations (**BR-088…BR-091** — no golden/invariant slots;
047 is ledger-free by design) → this plan.

**Status: APPROVED 2026-11-18 (the owner's W-9 verification + plan-approval
dispatch — W-9 ACCEPTED at `2956c27`; the plan's plan-first findings both
verified hands-on by the owner) with FIVE BINDING AMENDMENTS recorded in §1a
below (the PHASE-046 precedent: approval carried six binding amendments
recorded in §1a of that plan; the 047 equivalents land as dated amendments
here). The implementation waves are UNBLOCKED — W-0 delivered same day at the
then-current head `2956c27` (per A-5; audit-evidence/phase047-w0/). Two
long-standing owner inputs RULED in the same dispatch — 0071 ruled-no-action,
029 ruled option (A): see §1a items 6–7.**

## 1a. The owner's approval amendments (binding — recorded 2026-11-18, the W-9 verification + plan-approval dispatch)

1. **A-1 (§7(a) — the probation-date substrate: APPROVED).**
   `employees.probation_end` (nullable `date`, **fail-open** — NULL = not
   tracked, the sweep skips NULLs, no alert ever fabricated) added in T-03's
   `0097`. The fail-open direction confirmed correct: probation is an ALERT
   input, not a pricing input (the mirror image of `nationality`'s
   fail-closed). **Additionally: the field is registered in the PII inventory
   in the same increment** (the 046 `nationality` D-02 pattern).
2. **A-2 (§7(b) — BR-091 CONFIRMED with two precision edits).** The
   BUSINESS_RULES text must (i) **name the dedupe key's shape**
   (`hr:{kind}:{employeeId}:{documentId}:{threshold}`) so the law is
   self-contained, and (ii) state the 30/7/0 as **the documented
   tenant-configurable default** (red line 5's law), not as hard-coded
   constants — "per configured threshold pass (documented default 30/7/0)".
3. **A-3 (§7(c) — CONFIRMED).** The closure tag is `phase/047`.
4. **A-4 (the PII amendment — the plan's one real gap, closed).** The talent
   tables' PII fields enter the PII inventory **in the migration increment**
   (D-02's pattern generalized): `employee_documents`' document
   numbers/identifiers, applicants' personal data, interview notes. The three
   D-07 export contracts **cross-check their field lists against the PII
   inventory at implementation** — the payslips/remittance precedent governs
   (employee code + name; never national_id/bank/document numbers in
   exports).
5. **A-5 (W-0 baseline-head precision — the F1 law).** W-0's baseline runs
   at the then-current head and records it as such — presently `2956c27` (the
   plan commit; docs-only above the W-9 code head `8fab3ed`). The §3 W-0
   "untouched W-9 head `8fab3ed`" phrasing corrected at implementation
   (the dated note in §3).
6. **0071 warehouses-sweep — RULED: NO REPAIR (2026-11-18, the same
   dispatch).** The owner read the migration and the runtime paths: §5's own
   header defers post-migration warehouses to the lazy path;
   `ensureDefaultBin` (wms-store.ts) recreates the exact migration shape and
   is pinned across the inventory DB suite including the race and conflict
   specs; **the pick-strategy arm rides `upsertPickStrategyRow`, structurally
   idempotent on the tenant+warehouse unique** — verified by the owner. A
   0094-style re-materialization would add no capability and risks
   conflicting with the lazy floors. The flagged item CLOSES as
   ruled-no-action; the one-line record note at the original flag site (the
   0094 header) landed with W-0.
7. **029 eos-provision semantic update — RULED: option (A), fold the deltas
   (2026-11-18, the same dispatch).** The 029 report's register side folds
   the accumulated true-up deltas (aligning with the standing model so it
   ties in every world); block-on-fail retained; the 029 golden re-pinned in
   the true-up world. **Delivered as a SMALL STANDALONE maintenance wave (the
   W-8/W-9 pattern) at this session's scheduling discretion — NOT inside
   047's ledger-free waves** (payroll-module scope; keep 047 clean). Until it
   lands, the SAFE-direction block stands. See §7(d)'s dated note.

   > **DELIVERED 2026-11-18 (same day, between W-0 and W-1 — the earliest
   > discretion slot; on the W-0 head `6ffd79d`, the delivering session's
   > fresh clone): the fold landed — the standing balance (the 029 balance +
   > Σ eosb_calculations deltas) with its own `trueUp` column, the row
   > universe extended to the computations, block-on-fail retained and
   > re-proven by the seeded-drift arm, the golden re-pinned BOTH worlds (the
   > no-true-up PAY world's legacy assertions unchanged + the true-up PCR
   > world's new re-pin: Σ standing 42,500 == the GL). The SAFE-direction
   > block stands down. Evidence: the gate doc
   > `2026-11-18-maintenance-029.md` + `audit-evidence/maintenance-029/`
   > (15 logs, same-session). The DB-suite census moves 3,436 → **3,438**
   > (the +2 re-pin tests — the §0 baselines note, dated).**

## 0. Inputs consumed (the plan-first reads, all done — one focused pass over the W-9 head `8fab3ed`, 2026-11-18)

- `docs/implementation/phases/PHASE-047.md` (spec §1–§8) · COMPLETENESS_REGISTER
  CR-17 · COMPLETENESS_ROADMAP §6.2 · ID_LEDGER row 44 (047 = BR-088…091,
  re-coordinated 2026-11-13/14 — the original BR-057…060 were consumed by
  036/037).
- The 045/046 delivery records: both completion reports,
  `agent-ctx/NEXT_ACTION.md` (the 046→047 handoffs — the baselines to move),
  the PHASE-046 master plan (the wave/gate/red-line pattern this plan
  inherits), and the W-8/W-9 gate docs (the F1 literal-truth law + the OA-06
  index-driven assertion law now standing).
- Code research (this session, read-only): the employees substrate
  (`apps/api/src/db/schema.ts` — the 029 baseline + the 045 `userId` bridge +
  the 046 `nationality`/`pit_exemptions`; **verified: NO probation field
  exists anywhere** — see D-02), the hr module layout (feed/atomic/the
  045 stores — the roster's ONE-row-per-cell law, the cross-module READ
  precedent), the notifications machinery (the `notifications` table's
  `uq_notifications_dedupe` + `InboxService` + the inventory
  `alerts-service` daily pg-boss sweep precedent), the reporting registry
  layout (106 contracts after 046), the web hr screens
  (`[locale]/hr/{attendance,leave,self,shifts}` — the in-family 12-template
  reference), the jobs infra (`infra/jobs/`), and the baselines below.
- Baselines to move (**recounted this session at the W-9 head** — one F1
  correction found and recorded: NEXT_ACTION's "catalog 288 tables" line
  carried the W-1-era figure; the recount says **292** in BOTH
  `ENTITY_CATALOG.md` and `check:rls` — corrected there with the dated
  note): migrations journal **0094** (idx 93) · DB suite **250/250 files ·
  3,436/3,436** · permissions **300** · report registry **106** · i18n
  **6,121** (web) + **371** (mobile) · ENTITY_CATALOG **292** table rows ·
  `check:rls` **292** · id-ledger implemented **G 54 · INV 32 · BR 87** ·
  drift 300 = 300 · docs 33/33.

  > **[Dated 2026-11-18 — the 029 maintenance wave (the ruled option (A)
  > fold, §1a item 7) moved ONE baseline number: the DB-suite census is now
  > 250/250 files · 3,438 tests** (3,436 + the 2 true-up-world re-pin tests
  > in payroll-compliance-reports.spec — the reporting folder 120 → 122).
  > Every other number above is untouched; W-1's full-suite re-run carries
  > the 3,438 expectation.]**

  > **[Dated 2026-11-18 (W-1 delivered) — the foundation wave moved the
  > baselines to their §2 targets: migrations journal 0098 (idx 97) · DB
  > suite 250/250 · 3,522 (the +84 A-suite extension) · permissions 312 ·
  > i18n 6,125 + 371 · ENTITY_CATALOG/check:rls 306 · depcruise fresh-
  > clone 1,941 · 14,439 (+2 modules). The report registry stays 106 (the
  > four contracts are W-6's).]**

  > **[Dated 2026-11-18 (W-2 delivered) — the engines wave moved the
  > mid-suite numbers: depcruise fresh-clone 1,949 · 14,495 (+8
  > modules: the six new src files + the two new specs) · unit api 59
  > files · 684 (+17 pure tests) · ROUTE_PERMISSIONS 920 → 945 (+25
  > rows) · the DB suite's W-7 full-run expectation 251 files · 3,536
  > (250 · 3,522 + the new spec's 14). Unchanged: the journal (0098),
  > permissions (312), i18n (6,125 + 371 — the screens are W-5's),
  > ENTITY_CATALOG/check:rls (306 — no schema delta), the report
  > registry (106 — W-6's), docs 33/33.]**
  >
  > **[Dated 2026-11-19 (W-3, the owner's W-2 verification finding
  > NF-8) — the ROUTE_PERMISSIONS count above is off by one on BOTH
  > ends: the true verified figures are 919 → 944 (three independent
  > counts at both heads; the +25 delta itself is correct; the hr
  > sub-count 88 is correct). The same off-by-one rode the W-2 gate
  > doc §5 and the CHANGELOG entry — both carry their own dated
  > corrections. W-3's own delta computes from the true 944 base.]**
  >
  > **[Dated 2026-11-19 (W-3 delivered) — the wave moved the
  > baselines: migrations journal 0099 (idx 98 — the hr_alert_jobs
  > config surface, D-06's own requirement; the §2 table's dated
  > note) · DB suite 254 files · 3,572 (THE FULL SUITE re-ran this
  > wave — the migration delta's scope-label law; +3 spec files · +30
  > spec tests +6 A-suite rows for hr_alert_jobs over W-2's expected
  > 251 · 3,536) · ROUTE_PERMISSIONS 944 → 979 (+35 rows: recruitment
  > 13 · training 10 · org 6 · documents+alerts 6 — the true base per
  > the NF-8 correction) · depcruise fresh-clone 1,965 · 14,630 (+16
  > modules) · unit api 59 files · 693 (+9 pure tests) ·
  > ENTITY_CATALOG/check:rls 306 → 307 (hr_alert_jobs). Unchanged:
  > permissions (312), i18n (6,125 + 371 — the screens are W-5's),
  > the report registry (106 — the four contracts are W-6's), docs
  > 33/33.]**

## 1. Settled design decisions (from the plan-first reads — binding for all waves, amendable only by the owner's dated dispatch)

**D-01 — The talent layer attaches to the FROZEN employees substrate, never
rewrites it.** Org structure and positions attach to employees as documented
extensions (the phase doc's own law): `employees.position_id` (nullable uuid →
`positions`, ON DELETE SET NULL — an employee without a position stays valid,
the `userId` bridge's precedent) in the T-03 migration. The payroll run
machinery (029/043/046) is frozen substrate — 047 never writes a payroll
table (the hr-store READ precedent), and merit/bonus cycles that would write
payroll variables stay out of scope (the phase doc's own exclusion; 046 owns
payroll posting).

**D-02 — THE PROBATION-DATE PREREQUISITE DRIFT (found by this plan's reads,
recorded honestly):** PHASE-047.md's prerequisite table claims 045 delivered
"probation dates" — **FALSE at the delivered head**: no `probation` field
exists anywhere in `apps/api/src` or the 045 completion report (verified by
exhaustive grep this session; 045 shipped `hireDate`/`terminationDate` +
the `userId` bridge). The phase doc's own §7 anticipated this
("Prerequisite drift … may shift before this phase runs"). **The remedy —
APPROVED 2026-11-18, the owner's plan-approval amendment A-1 (§1a), the 046
`nationality` D-02 precedent — a plan-level addition now confirmed:**
`employees.probation_end` (nullable `date`) added in the T-03 migration,
fail-open semantics — NULL = not tracked, the expiry sweep skips NULLs, no
alert ever fabricated (the alert-input vs pricing-input mirror of
nationality's fail-closed); **the field registers in the PII inventory in
the same increment (A-1's addition)**. The probation-end alert (§2.9 of the
scope) rides it. [Pre-approval text, superseded by A-1: "If the owner
declines, the `hr.probation-end` alert drops from scope and the completion
report records the delta (the phase doc's own mitigation)."]

**D-03 — Migration slots pinned honestly: 0095–0098** (the journal ends at
`0094_rls_tenant_sweep_repair`, idx 93 — verified this session). The phase
doc's "0075…0078" are stale blueprint-time slots (written before 036–046
consumed 0049–0094); the doc's own note defers to the journal. Shapes:
`0095_hr_talent_performance.sql` (cycles/reviews/competencies/levels/goals),
`0076→0096_hr_talent_recruitment.sql` (vacancies/applicants/interviews),
`0097_hr_talent_training_org.sql` (training/certifications/org units/
positions/employee documents + D-01/D-02's employee extensions),
`0098_hr_talent_grants.sql` (DATA-ONLY: permission seeds, plan/template
grants, the competency 1–5 scale seed — the 0078-pattern, no schema).

**D-04 — The BR reservations, proposed wordings (binding at approval):**
BR-088 the recruitment pipeline's monotonic stages (fixed enum
NEW→SCREEN→INTERVIEW→OFFER→HIRED/REJECTED; backward motion ONLY via the
recorded reopen action — no tenant-custom stage sets), BR-089 the per-cycle
per-reviewee active goal weights sum to exactly 100%, BR-090 the 360
anonymity law (aggregate-only visibility; a relationship's inputs surface
only at ≥ 3 responses — never attributed), BR-091 the expiry-sweep dedup
law (one alert per employee per document per threshold pass — 30/7/0 days
— deduplicated structurally by the notification dedupe key; never a repair,
only the alert — the inventory alerts-service's own law). [BR-091's wording
CONFIRMED 2026-11-18 with two precision edits — amendment **A-2**, §1a: the
BUSINESS_RULES text names the dedupe key's shape
`hr:{kind}:{employeeId}:{documentId}:{threshold}` (self-contained law) and
states 30/7/0 as the documented tenant-configurable default — "per
configured threshold pass (documented default 30/7/0)" — never hard-coded
constants.]

**D-05 — Ledger-free by design (the ID_LEDGER's own record):** no G-slots,
no INV slots; `JOURNAL_RULES.md` and `ACCOUNTING_INVARIANTS.md` untouched;
training-program `cost` and any money-adjacent field still goes through the
money type (ADR-0009 — no binary float, ever). The id-ledger's 047 row
flips BR-087 → BR-091 at closure.

**D-06 — The expiry sweep = the inventory alerts precedent, exactly.** One
daily pg-boss job (`hr-expiry-sweep`, the `inventory.shelf-life-alerts`
shape): `listActiveTenantIds` + `withTenant` per tenant; four probes
(documents, certifications, probation end, review-due windows); one
`InboxService` notification per pass with the **dedupe key
`hr:{kind}:{employeeId}:{documentId}:{threshold}`** — the `notifications`
table's `uq_notifications_dedupe` makes D-04's BR-091 structural, not
application-level; fail-closed documented defaults when a tenant registers
no config row (the 044 pattern); run stats stamped; audited.

**D-07 — The external bridges (DF-51/N-14) ride the EXISTING export/import
machinery, no live connectors.** Exports: the reporting module's CSV/JSON
export path (the 046 T-13/T-14 precedent) over three documented contracts
(employee master, employment history + org snapshot, appraisal results);
imports: appraisal results + training completions with **row-level
validation reports** (accepted/rejected per row, reasons typed — the
attendance-import precedent in the hr module); Workday/BambooHR field maps
documented as reference profiles in the integrations README; the public API
platform of PHASE-055 is the live-connector substrate (out of scope by the
phase doc's own list). [Amendment **A-4** (2026-11-18): the talent tables'
PII fields — employee_documents' document numbers/identifiers, applicants'
personal data, interview notes — enter the PII inventory in the migration
increment; the three export contracts cross-check their field lists against
the PII inventory at implementation (the payslips/remittance precedent:
employee code + name; never national_id/bank/document numbers in exports).]

**D-08 — The 360 aggregation is a PURE domain function, aggregate-only.**
`aggregate360(inputs) → per-relationship {count, mean, min, max}` — unit-
tested first (the attendance-classification/pit-engine precedent); the
reviewer sees aggregates ONLY (BR-090); raw per-source rows exist for audit
but no API surface returns an attributed source below the ≥ 3 threshold;
the review-history trend on the 360 view shows overall scores per cycle,
never per-source values.

**D-09 — Org trees are cycle-safe by construction.** `org_units` carry
materialized paths; every move/update validates no cycle at write time
(pure `detectCycle` unit-tested); `positions.reports_to` gets the same
guard; the web tree editor's moves call the guarded API (never client-side
reordering). The 045 roster's ONE-row-per-cell REPLACE law is the in-family
precedent for edit shapes.

**D-10 — Feature flags + template composition.** `hr.performance`,
`hr.recruitment`, `hr.training`, `hr.org` (CR-36f template-composable); the
professional-services, healthcare, education and food-manufacturing
manifests compose all four by default (the phase doc's instruction);
manifests validation extended in the same increment as the flag
registration (one-increment law — every checker stays green).

**D-11 — Permissions +12 keys (the phase doc's exact list), one increment:**
`hr.performance.view/manage/review`, `hr.recruitment.view/manage/interview`,
`hr.training.view/manage`, `hr.org.view/manage`, `hr.documents.manage`,
`hr.competency.manage` — seed + matrix §3.x row + drift-checker list +
`route-permissions.ts` + feature-keys together; drift **300 → 312**.

**D-12 — i18n ~+260 AR/EN pairs** across the four screen families + the 360
extension + the alert templates; parity **6,121 → 6,121+n** (exact count at
implementation; the equality check extended — base+n = base+n).

**D-13 — Web: four route families + the 360 extension, the in-family
reference.** `[locale]/hr/{performance,recruitment,training,org-structure}`
beside the delivered `{attendance,leave,self,shifts}`; NAV_ITEMS + ⌘K (OA-04)
+ RTL + AR/EN parity + loading/empty states (the 12-template discipline);
the employee 360 extension composes position/org placement, review trend,
active goals, training, certifications, document expiry chips, and the
hired-applicant source record — read-model composition over the module
APIs, no cross-module table reads in the web layer.

**D-14 — OA-06 EXPLAIN budgets (T-17) assert the INDEX-DRIVEN law in the
W-9-settled shape.** Two probe families (the applicant pipeline read; the
review-aggregation fold): index-driven, no seq-scan, accepting the
planner's legitimate index-driven paths (the P3/W-9 precedent's regex
shape), the observed plan LOGGED verbatim — never a forced plan
(enable_bitmapscan=off/hints rejected by the owner's W-9 ruling), never an
isolated probe context.

## 2. Migration inventory (the honest slots — journal ends at 0094, idx 93)

| Slot | File | Contents |
|---|---|---|
| 0095 | `0095_hr_talent_performance.sql` | `performance_cycles`, `performance_reviews` (with the per-source 360 rows), `competencies`, `competency_levels`, `goals` (+ the cycle-weight unique) |
| 0096 | `0096_hr_talent_recruitment.sql` | `vacancies`, `applicants` (+ the stage-transition audit shape), `interviews` (one row per panelist per round) |
| 0097 | `0097_hr_talent_training_org.sql` | `training_programs`, `training_enrollments`, `certifications`, `org_units` (materialized path), `positions`, `employee_documents` + D-01 `employees.position_id` + D-02 `employees.probation_end` |
| 0098 | `0098_hr_talent_grants.sql` | DATA-ONLY: the 12 permission seeds, plan/template grants (D-10), the competency 1–5 AR/EN scale seed |

All four: tenant_id prefix + RLS policies (the A1–A10 law), Drizzle mirrors,
`tables.registry.ts` +14 (292 → 306 at `check:rls`), ENTITY_CATALOG rows
(292 → 306 table rows), journal/manifest/spec pins to 98 with the chain
re-proven from zero + re-apply no-op.

> **[Dated 2026-11-19 (W-3) — the inventory gains a FIFTH slot:
> `0099_hr_alert_jobs.sql` (the hr-expiry-sweep's config surface —
> the hr_alert_jobs registration row + the 'hr' notifications
> category widening; registry/catalog 306 → 307). The table above
> listed the talent TABLES only; D-06's own text ("fail-closed
> documented defaults when a tenant registers no config row (the 044
> pattern); run stats stamped") requires the config surface, and
> amendment A-2 + red line 5 make the 30/7/0 thresholds
> tenant-configurable DATA with documented fail-closed defaults — a
> DATA law needs a table. The honest-slot law (D-03): the journal's
> next slot after 0098 is 0099; the pins moved to 99 with the chain
> re-proven from zero + re-apply no-op (the W-3 full-suite run).]**

## 3. Task waves (canon T-numbers; per-task exit criteria)

### W-0 — Environment preparation (T-00, orchestrator)
The sandbox law (the 046 pattern): fresh clone, `pnpm install` (pnpm 9.15.9,
frozen), Playwright chromium headless-shell **1248** (the known gap,
disclosed), embedded-PG16 rehearsal, `~/.local/bin` pnpm shim for the
global-setup spawn.
**Exit:** typecheck/lint 8/8, unit 8/8, the DB suite **250/250 · 3,436/3,436**
green on the untouched W-9 head `8fab3ed` in THIS environment — the baseline
proven before any change (the honest-log law), every log kept
(`audit-evidence/phase047-w0/`).

> **DELIVERED 2026-11-18 — and the head pinned per amendment A-5 (§1a):**
> the baseline ran at the then-current head **`2956c27`** (the plan-commit
> head, docs-only above the W-9 code head `8fab3ed` — the original
> "untouched W-9 head `8fab3ed`" phrasing above was imprecise about which
> head the clone boots at; the code content is identical, `2956c27` adding
> only the plan/NEXT_ACTION docs). All exit gates met: typecheck 8/8 · lint
> 8/8 · depcruise 1,939 · 14,434 (the fresh-clone re-baseline) · unit 8/8 ·
> DB suite 250/250 · 3,436/3,436 (one disclosed fcm-channel flake on the
> first chunk-02 run — green standalone + pair + full-chunk re-run, every
> log kept; the standing DB-suite serial-order sensitivities watch item) ·
> drift 300 = 300 · check:rls 292 · i18n 6,121 + 371 · id-ledger 0 errors +
> self-test OK · history-secrets 0 · docs 33/33 · manifests 13/13.
> `audit-evidence/phase047-w0/` + the W-0 gate doc.

### W-1 — Foundation (T-01 + T-02 + T-03 + T-04, orchestrator)
Migrations 0095–0098 (§2) + mirrors + registry/catalog/permissions/i18n/
feature-keys/NAV rows in ONE increment (D-10/D-11/D-12 — every checker
stays green); the competency scale seed; the typed error taxonomy
(`hr/domain/talent-errors.ts`).
**Exit:** migrations apply + re-apply no-op over the 98-entry chain;
A1–A10 ×14 green; drift **312 = 312**; manifests valid; catalog parity;
i18n parity green; `check:rls` clean at 306.

> **DELIVERED 2026-11-18 (same day, on the 029-maintenance-wave head
> `e6e61a1`, this session's fresh clone — the same-session evidence
> rule's eighth consecutive wave): every exit criterion met — the 98-chain
> applies cleanly from zero + re-apply no-op; A1–A10 ×14 green (the
> generated suite +84); drift 312 = 312; manifests 13/13; check:rls
> **306 catalog tables, 0 violations** (scratch-PG16 + in-suite); i18n
> 6,125 = 6,125 (+4 nav keys). The full battery: typecheck/lint 8/8,
> depcruise 1,941 · 14,439 (+2 modules — the W-0 re-baseline's disclosure
> law), unit 8/8 (api 667 · web 87 · mobile 393 · desktop 274 · ui 42 ·
> contracts 56 · domain-core 38 · sync-core 36), **THE FULL DB SUITE
> 250/250 · 3,522/3,522** (the plan's expected 3,438 + 84 exactly; 5
> chunks, one disclosed census-pin repair re-run green, both logs kept),
> docs 33/33, id-ledger 0 errors + self-test OK, history-secrets 0,
> capabilities agree, shells PASS, the negative boundary PASS. THE
> ENTITLEMENT/AUTHORIZATION DIVERGENCE recorded (the four flags gate the
> capability on plans/manifests/nav; the twelve keys ride roles — matrix
> §3.25's dated note; 045/046's one-key-both-jobs shape does not fit the
> manifest schema's single-segment law, found and designed in-session).
> The golden effective-configs re-pinned (31 of 37 moved — the review
> note); the template-apply specs' stored-manifest hashes re-pinned with
> the dated notes. Evidence: the W-1 gate doc +
> `audit-evidence/phase047-w1/` (25 logs incl. the db-suite chunks).**

> **[Dated 2026-11-18 (W-2) — the NF-5 correction, the owner's W-1
> verification finding: the bundle count above is 23 FILES, not 25.
> The "25" counted directory-listing entries (23 files + 2
> directories); the same 25-vs-23 imprecision rode W-1's commit
> message (immutable history — this note is the claim site's dated
> correction, the F1 law). The bundle itself is unchanged: 23 files,
> every one kept and verified.]**

### W-2 — The performance + goals engines (T-05 + T-06, orchestrator)
Cycle lifecycle (DRAFT→ACTIVE→CALIBRATION→CLOSED with CAS on the state),
review submission, the 360 aggregation (D-08 — pure, unit-tested first),
calibration; the goals cascade tree + weight-sum validation (BR-089) + KRI
progress rollup.
**Exit:** the engines' laws pinned by unit + DB specs (§4); acceptance #2's
end-to-end cycle green; BR-090 proven both ways (aggregate shown, source
hidden below threshold).

> **DELIVERED 2026-11-18 (on the W-1 head `786636a`, this session's
> fresh clone — the same-session evidence rule's ninth consecutive
> wave): every exit criterion met — the pure layer FIRST
> (`talent-math.ts`: aggregate360/visible360, the weight-sum law, the
> rollup, the pace fold + triage, wouldCreateCycle — 17 unit tests;
> the unit-first law caught a real infinite-loop bug in the guard's
> first shape (`!seen.add` is always truthy) BEFORE any consumer
> landed, recorded in the spec's header), the store (every write a
> conditional statement: the cycle CAS, the review upsert's
> WHERE-immutable, the submit CAS, the goals' tri-state update), the
> two engines (the one-way CAS ladder + the T-20 `talent.cycle` gate
> on the SAME atomic floor; validation-first submission with BR-089's
> zero-residue gate; the BR-090 aggregate read with the typed 422;
> the calibration act; the competency framework's CRUD), 25 routes on
> the §3.25 keys (+25 ROUTE_PERMISSIONS rows; the in-phase error
> filter registration), and the DB spec 14/14 (the plan §4's
> `talent-performance.db.spec`: the CAS RACE as a real
> two-transaction duel — zero rows for the loser, one version bump;
> BR-089/090 both ways; the end-to-end cycle (acceptance #2) incl.
> the exact rollup worked examples (52.50 / 65.00) and the CLOSED
> immutability; the KRI triage over crafted windows; the cascade +
> D-09; the framework; the tenant boundary). THE NF-4/NF-5 RECORD
> FIXES delivered with the wave: the two dated false-stamp notes at
> the W-0/W-1 gate docs' claim sites + the structural capture wrapper
> `scripts/capture-evidence.sh` (the controlled-red self-test proof —
> a real vitest red stamps VITEST_EXIT=1; every W-2 log is
> wrapper-captured) + the 25→23-files dated correction in W-1's
> DELIVERED note (NF-6 chat-only, no repo change). Gates: typecheck
> 8/8 · lint 8/8 · depcruise 1,949 · 14,495 (+8 modules, the
> disclosure law) · unit 8/8 (api 59 · 684) · the new spec + the hr
> (14 · 97) + payroll (11 · 88) + isolation/identity (6 · 1,747)
> folders green · check:rls scratch 306/0 · drift 312 = 312 · i18n
> 6,125 = 6,125 + 371 · manifests 13/13 · docs 33/33 · id-ledger 0
> errors · history-secrets 0 · capabilities agree · shells PASS ·
> boundary PASS. The full DB suite does not re-run (the scope-label
> law — no migration/schema delta; W-7's expectation moves to 251
> files · 3,536). Evidence: the W-2 gate doc +
> `audit-evidence/phase047-w2/` (22 logs, every one wrapper-captured,
> incl. the self-test proof).**

### W-3 — Recruitment + training/org + documents + the sweep (T-07 + T-08 + T-09, orchestrator)
The pipeline with monotonic stages (BR-088) + the recorded reopen + hire→
employee link; interview scorecards per panelist per round; training/
certifications; the org tree with cycle detection (D-09); employee
documents; the `hr-expiry-sweep` job (D-06 — four probes, 30/7/0, deduped).
**Exit:** acceptance #3/#4/#5 green (the sweep's evidence in the job log +
notification records, dedup proven by re-run).

> **DELIVERED 2026-11-19 (on the W-2 head `83bfc19`, this session's fresh
> clone `/home/z/ERP_Sys_W3` — the same-session evidence rule's TENTH
> consecutive wave): every exit criterion met — the PURE layer first
> (`talent-math.ts` extended: BR-088's rank-law stage machine
> (canAdvanceStage/isApplicantStage/reopenTarget — any strictly-forward
> move is monotonic, skips included; REJECTED→SCREEN the ONE recorded
> backward edge, reopenTarget the pure law), BR-091's
> normalizeSweepWindows/sweepBands/expiryDedupeKey (the disjoint
> day-bands + the exact four-segment key shape with the documented
> dash placeholder) — 9 unit tests, 26/26 green with W-2's 17);
> MIGRATION `0099_hr_alert_jobs` (the honest slot note: the §2 table
> above listed 0095–0098 only — D-06's own text ("the 044 pattern"
> config row + "run stats stamped") + amendment A-2's
> tenant-configurable-thresholds law REQUIRE the config surface, and
> A-5's red line 5 makes 30/7/0 DATA with fail-closed documented
> defaults; the dated note rides the migration header, §2's table
> here, and the W-3 gate doc — never a silent rewrite): the
> hr_alert_jobs registration row (thresholds jsonb DEFAULT
> '[30,7,0]', is_active, the stamped run stats — the 044 inventory
> pattern exactly) + the 'hr' notifications category widening (BOTH
> CHECK domains + the TS union + PREFERENCE_MODULES); the journal
> 0098→**0099** (idx 98), the manifest/spec pins moved with it; the
> stores ×4 (recruitment/training/org/alerts — one per family, every
> write conditional: the stage CAS with the in-statement history
> append, the hire CAS's written-once link arm, the scorecard's
> panelist-guarded UPDATE, the org move's two-statement guarded
> subtree rewrite, the enrollment's ON CONFLICT DO NOTHING); the
> services ×5 (the recruitment engine — the vacancy lifecycle CAS
> (OPEN↔ON_HOLD, →FILLED/CANCELLED terminal, filled_at stamped), the
> hire act LINKING AN EXISTING employee (D-01 honored exactly: the
> talent layer never writes the employees table — the payroll module
> owns the master's creation; the link + the OFFER→HIRED hop + the
> history record in ONE conditional statement), the interview
> scorecards (the panelist's OWN card — the own-rows law structural);
> the training engine (the exact-decimal cost, the (program, employee)
> natural key's typed 409, the completion act stamping completed_at +
> result, the certification register with issuer/expiry intact); the
> org engine (the dot-free code law for the path grammar, the D-09
> move under the NEW T-20 `talent.org-plane` gate — the same
> wouldCreateCycle the goals ride, the materialized-path subtree
> rewrite, positions' reports_to the same guard); the documents
> register (HR-10, operational DELETE, the number never in the audit
> payload); THE ALERTS SERVICE (D-06 exactly: the four probes over
> the pre-built expiry indexes, the DISJOINT bands — one alert per
> item per threshold pass, no catch-up ladder, no per-item stamp
> column; the owner-targeted 'hr' notifications with the structural
> BR-091 keys; the 044 config law — absent row = defaults fire,
> explicit inactive = skip, garbage upsert = fail-closed defaults;
> run stats stamped; audited; never a repair, only the alert) + the
> `hr-expiry-sweep` pg-boss job (the phase doc's verbatim queue name,
> daily 04:15 UTC, the any-talent-flag entitlement gate, the warranty
> job's registration shape); 35 routes on the matrix §3.25 keys
> (recruitment 13 · training 10 · org 6 · documents+alerts 6;
> ROUTE_PERMISSIONS 944 → **979** — the true NF-8-corrected base);
> the error filter's in-phase registration (the W-1 taxonomy's
> remaining 404s + the W-3 409s; the 422 family falls through by
> design). The DB specs ×3 (the plan §4's rows): talent-recruitment
> 15/15 (the lifecycle, BR-088 both ways incl. the skip + the
> terminals, the reopen + the live-again walk, THE HIRE (acceptance
> #3 — requires OFFER, links, once, A7 parity), the scorecards + the
> own-rows refusal + the slot 409, THE STAGE CAS RACE as a real
> two-transaction duel, the tenant boundary), talent-training-org
> 9/9 (the catalog + the natural key + the completion act (acceptance
> #4) + the certification register + the org tree's path rewrites +
> D-09 both guards + the boundary), talent-documents-sweep 6/6 (the
> register, THE SWEEP (acceptance #5): the four probes at 30/7/0 with
> the exact keys, the severity ladder, the honest expired/today
> titles, THE PII LAW (the numbers never ride the payload), THE
> RE-RUN DEDUPE (zero new rows — BR-091 structural), the NULL
> probation/probation skip (fail-open, no fabricated alert), the
> DRAFT/CLOSED review-due skip, the config row's defaults/custom/off
> switch/stamped stats). **THE NF-7/NF-8 RECORD FIXES delivered with
> the wave** (the owner's W-2 verification findings): the dated
> quadrant note at the W-2 gate doc's self-test row (the preserved
> log holds the vitest-red quadrant; the other three re-provable —
> every future self-test keeps all four logs) + the dated 919→944
> corrections at all THREE NF-8 sites (the plan §0's W-2 note, the
> W-2 gate doc §5, the CHANGELOG entry). Gates (all same-session,
> wrapper-captured, `audit-evidence/phase047-w3/` — 24 files):
> typecheck/lint 8/8 (0 cached, forced) · depcruise **1,965 ·
> 14,630** (+16 modules: 13 src + 3 specs) · unit 8/8 (api 59 ·
> **693** = 684 + 9) · **THE FULL DB SUITE re-ran (the scope-label
> law — migration delta): 254 files · 3,572/3,572, 0 failed, 0
> skipped** (5 chunks 61·449 + 57·2,068 + 61·483 + 67·544 + 8·28;
> every chunk wrapper-captured; the A-suite extends by +6 for
> hr_alert_jobs) · check:rls scratch **307 catalog tables, 0
> violations** (the 99-chain from zero) · drift 312 = 312 · i18n
> 6,125 = 6,125 + 371 · mobile tokens 50/50 · manifests 13/13 · docs
> 33/33 · id-ledger 0 errors · history-secrets 0 · capabilities agree
> · shells PASS · boundary PASS. The W-7 full-suite expectation
> moves to **254 files · 3,572** (already re-proven this wave).**

### W-4 — The external bridges (T-10, orchestrator)
The three export contracts + the two import paths with row-level validation
reports (D-07); the integrations README's bridge contracts + the
Workday/BambooHR reference maps.
**Exit:** acceptance #9's bridge criteria green (CSV/JSON exports, the bad-
row rejection report).

### W-5 — The web plane (T-11 + T-12 + T-13 + T-14, orchestrator)
The four screen families + the 360 extension + the alert list surfaces
(D-13); NAV/⌘K registration; feature-flag gating verified per plan and per
template composition.
**Exit:** acceptance #6 green (AR/EN parity, RTL, loading/empty states);
the ⌘K + NAV checks green.

### W-6 — Reports + proof (T-15 + T-17, orchestrator)
The four report contracts (`hr.performance-cycle-results`,
`hr.recruitment-pipeline`, `hr.training-completions`,
`hr.document-expiry` — registry **106 → 110**, all pin sites re-pinned
together); RLS attack tests A1–A10 ×14 (CR-36e); the OA-06 budgets in the
W-9 shape (D-14).
**Exit:** acceptance #7/#8 green; the registry reconciliation check
extended and green.

### W-7 — Docs + gates + closure (T-16 + T-18, orchestrator)
BUSINESS_RULES BR-088…091 (D-04's wordings) + NAVIGATION_MODEL + FEATURE_
CATALOG + the HR tables doc + the integrations README (W-4's); the full
gate sweep at the final head; the completion report; the triple flip; the
archive `ERP_PLATFORM_PHASE047.zip` (OA-07, byte-verified members); the tag
(`phase/047` proposed — §7(c)); NEXT_ACTION → PHASE-048 (Projects &
Contracting — the phase doc's own handoff: positions/grades feed
`project_resource_allocations`).
**Exit:** acceptance #1…#10 all green with evidence; the same-session
evidence rule honored (the sixth+ consecutive wave).

## 4. Test matrix (the permanent suites)

- **Unit (pure, first):** the 360 aggregation math; the weight-sum
  validation; the KRI rollup; `detectCycle`; the stage-transition state
  machine; the sweep's threshold windows (30/7/0) + dedupe-key derivation.
- **DB specs (the `__db__/hr/` family, the 045 precedent):**
  `talent-performance.db.spec` (the end-to-end cycle + BR-089/090 both
  ways), `talent-recruitment.db.spec` (monotonic + reopen + hire link +
  scorecards), `talent-training-org.db.spec` (enrollments → certifications;
  org cycle rejection), `talent-documents-sweep.db.spec` (the four probes,
  the dedupe re-run, NULL probation skip), `talent-bridges.db.spec`
  (exports + the bad-row report), `talent-rls.db.spec` (A1–A10 ×14),
  `talent-explain-budgets.db.spec` (the two OA-06 probe families, D-14's
  shape), the migration chain spec extended to 98.
- **Web:** the four families' render + parity + flag-gating specs; the 360
  extension spec (the `__tests__` + boundary patterns).

## 5. Gate list (the exit bar — same as 043–046, no relaxations)

typecheck 8/8 · lint 8/8 · depcruise clean (the fresh-clone count
re-baselined at W-0; the environmental-delta disclosure law) · unit 8/8
packages · **the full DB suite green at the new count** (250 + the new
files) · docs:validate 33/33 (extended for the new canon rows) · i18n
parity **6,121+n = 6,121+n** (+ mobile 371) · permissions drift **312 =
312** · manifests 13/13 · id-ledger 0 errors + self-test OK (BR-088…091
flipped) · history-secrets 0 · `check:rls` clean at 306 · OA-06 budgets
green (D-14) · the standing checks (boundary-negative, shells,
capabilities) per the 046 gate table.

## 6. Governance red lines (carried, unchanged — plus the two new laws)

1. One phase per run; the phase doc is the contract; out-of-scope is
   prohibition.
2. Doc precedence (ARCHITECTURE_BASELINE + ADRs + CD-01…12); discrepancies
   recorded, never silently rewritten.
3. Never weaken: tenant isolation (RLS), the posting-engine monopoly,
   INV-001…032, auditability — 047 touches none (ledger-free), and the
   frozen payroll/employees substrate law (D-01) extends the same
   discipline.
4. No binary floating point for money (ADR-0009) — training costs,
   certification costs, any budget figure.
5. No fabricated compliance content (BR-055 family): competency scales,
   certification validity rules, and alert thresholds are tenant-configurable
   DATA with fail-closed documented defaults — never invented numbers; the
   competency 1–5 scale seed is the one shipped default, documented.
6. **The F1 literal-truth law (the W-6/W-8/W-9 lesson):** every record
   claim — counts, paths, attributions, "deterministic"-class adjectives —
   verified against the artifact before it is written; dated corrections at
   the original claim site when found.
7. **The same-session evidence rule** (five consecutive waves and counting)
   + the scope-label law (claim only the affected surface; the full DB
   suite re-runs only on migration/schema/route changes — W-1 and W-7 run
   it; the mid waves run their folders).
8. **The OA-06 assertion law (the W-9 ruling):** probes assert the stable
   index-driven law, accept the planner's legitimate paths, log the
   observed plan verbatim — never force a plan, never isolate the context.
9. The evidence-log capture convention (NF-3): every log carries
   `VITEST_EXIT=N`/`EXIT=N` under `set -o pipefail`.
   **[Dated 2026-11-18 (W-2) — the NF-4 repair: the convention is now
   STRUCTURAL, not aspirational — every evidence log is captured
   through `scripts/capture-evidence.sh` (pipefail + `PIPESTATUS[0]`
   + the stamp reads the run command's OWN exit code; a controlled
   red run stamps `VITEST_EXIT=1` — the self-test proof
   `audit-evidence/phase047-w2/capture-wrapper-selftest.log`). The
   two false-stamp red logs (W-0's chunk-02, W-1's chunk-01) carry
   their dated corrections at their gate docs' claim sites.]**

## 7. Open inputs for the owner (none block plan approval; (a) is the one scope decision)

> **RESOLVED 2026-11-18 (the plan-approval dispatch): (a) = amendment A-1
> (APPROVED — probation_end + the PII registration); (b) = A-2 (CONFIRMED
> with the two precision edits); (c) = A-3 (phase/047); all three recorded
> in §1a. (d)'s 0071 and 029 are now RULED (§1a items 6–7); (d)'s remaining
> items stand unchanged.**

- **(a) The probation-date substrate (D-02's drift):** approve
  `employees.probation_end` (nullable, fail-open — the 046 `nationality`
  precedent) or drop the `hr.probation-end` alert from scope. The
  prerequisite-table claim ("045 delivered probation dates") was false at
  the delivered head; this plan records it and proposes the remedy.
  **[APPROVED 2026-11-18 — A-1, §1a.]**
- **(b) BR-091's wording (D-04):** proposed as the expiry-sweep dedup law;
  confirm or amend at approval (BR-088/089/090 are the phase doc's own).
  **[CONFIRMED 2026-11-18 with two precision edits — A-2, §1a.]**
- **(c) The closure tag:** `phase/047` proposed (the 046 owner instruction
  `phase/046` as the pattern); confirm at approval. **[CONFIRMED 2026-11-18
  — A-3, §1a.]**
- **(d) Standing owner inputs carried (unchanged, not 047 blockers):**
  §7(b)'s three PHASE-045 final-audit remarks (text awaited, never
  fabricated); the 0071 warehouses-sweep ruling; the 029 eos-provision
  semantic update; PHASE-043's hard review + RISK-031/RISK-032 OPEN; the
  register's exactly two narrowed items (SANED 15,000 ceiling + EOSB M/51
  Art. 84 text). **[Dated 2026-11-18: 0071 RULED — NO REPAIR (§1a item 6;
  the 0094 header note landed with W-0); 029 RULED — option (A) fold the
  deltas, a small standalone maintenance wave at the session's scheduling
  discretion, NOT inside 047 (§1a item 7) — **DELIVERED same day between
  W-0 and W-1 (the §1a item 7 note; the SAFE-direction block stands
  down)**. The remaining items stand.]**

**NOT production approval** — the standing law. PHASE-046 stands COMPLETE
at the W-9 head (the owner's W-8 acceptance + the W-9 repair wave); this
plan unblocks the 047 implementation waves at the owner's approval dispatch.
