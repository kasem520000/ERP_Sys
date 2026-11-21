# PHASE-048 Completion Report — Projects & Contracting (المشاريع والمقاولات)

> **Status:** COMPLETE · **Date:** 2026-11-21 · **Phase doc:**
> [../PHASE-048.md](../PHASE-048.md) · **Register:** [CR-18](../../../planning/COMPLETENESS_REGISTER.md)
> · **Triple flip:** this report + the phase doc header + the IMPLEMENTATION_STATUS
> row flipped together (CR-48) · **Wave 2's sixth phase** — the platform that runs
> the daily workforce truth, the statutory world and the full talent lifecycle now
> runs the PROJECTS & CONTRACTING world on top of them: the WBS tree with the
> leaf-recomputed rollup, the budget cost-curve and the four-leg actuals
> reconciling to the GL to the cent (INV-033), the two-discipline EVM engine, the
> change-order gate, the contracting core (subcontracts + the retention ledger +
> progress billing + the in-transaction invoice + the advance amortization + IAS
> 23), field service with the pause-aware single clock, the three web surfaces,
> the three bilingual prints and the four report contracts — and PHASE-049 (CMMS
> — Asset Maintenance) is unblocked per the roadmap's hard chain.
> **Scope discipline (the owner's W-15 dispatch, verbatim in substance): THE
> PHASE CLOSURE IS NOT PRODUCTION APPROVAL** — the tag `phase/048` is a
> DELIVERY marker, never an acceptance marker (the §1a (a) ruling); RISK-031/032
> stay OPEN; the 043 hard review stays OPEN; the 045 notes and the Tabs defect
> stand transferred below (§9).

## 1. Executive summary

PHASE-048 closed the platform's **projects & contracting gap** (CR-18, the
L2-15/L2-20 homes): the **WBS engine** (the tree with milestones and the
single-predecessor edges, **BR-095's leaf-recomputed weighted %-complete
rollup** — recomputed from the leaves on EVERY read, ONE rounding at the
total, both cycle guards before every write), the **budget cost-curve**
(the DRAFT→APPROVED→CLOSED one-approved law, the CELL law, the APPROVED
curve alone feeding PV), **the four actual collectors + INV-033** (labor ×
the snapshotted cost rates on the WBS dimension · materials through the
WMS issue paths read-only · subcontract through the approved certificates'
nets — the SOLE actuals source · the tenant-configured overhead distributor
through the clearing account; **the typed reconciliation refusing at ANY
residual against the GL project dimension, to the cent**), the **EVM
engine** (two EV disciplines — certificate-gated for customer billing, the
weighted structural rollup for internal EV, the delta a management signal;
**EV never exceeds the approved budget** — the typed refusal; CPI/SPI/
EAC/ETC + the forecast surface), the **change-order gate** (**BR-094**'s
inert-until-approved with the 0102 structural floor; **G-58**'s exactly-once
delta; the ceiling recomputed on every read — one law, three engines), the
**contracting core** (the sub lifecycles with the activation opening the
SAME-ledger retention row; **G-55**'s sub-side hold + THE AP LINKAGE; the
CUSTOMER retention register — the contract's commercial spine, the
immutable core; **G-56**'s release at final acceptance with the schedule's
gates; **G-57**'s fused billing with the IN-TRANSACTION POSTED invoice +
the G-33-mirror advance amortization; **BR-092/BR-093** — the derived pair
and the ceiling at the statute's position), the **IAS-23 engine**
(REQUIRES_VERIFICATION — never a fabricated rate; the documented stop
rules), **field service** (the D-12 status machine; **THE SINGLE CLOCK
SERVICE** — pause-aware response/resolution clocks, **BR-096**'s deduped
escalation, the report NEVER the evaluation act), the **web plane** (the
/projects board + /projects/contracting + /projects/fieldservice — the
engines' figures VERBATIM, the typed refusals with their FULL payloads),
**the three bilingual prints** (AR/EN RTL-correct through `bi()` reading
both sides; deterministic byte-identical across runs; the retention
statement carrying NO totals by design), and **the four report contracts**
(registry 110 → 114, every pin site re-pinned together, zero new
permissions and zero new routes).

The phase shipped **migrations 0100–0104** (the eleven tables + the
time-entry WBS dimension + the three single-consumption stamp columns;
ENTITY_CATALOG 307 → 318; the chain re-proven from zero at every full
sweep), **+14 permission keys** (312 → 326, zero-drift at every wave),
**+3 feature flags** (the D-16 composable units, business + enterprise +
the three project-carrying templates), **i18n +187** (6,433 → 6,620 in the
two declared web deltas +49/+138; mobile 371 unchanged), and
**ROUTE_PERMISSIONS 988 → 1,052** with every change dated.

## 2. Mandatory code-evidence checklist (CR-48)

- Migrations **0100–0104** (the WBS tree · the budgets/lines/allocations ·
  the change orders · the contracting core + field service + IAS-23 · the
  three stamp columns) — Drizzle mirrors + `tables.registry` +11 +
  `ENTITY_CATALOG` 307 → 318; the chain applies cleanly from zero with
  re-apply no-op (the migrations spec green in every sweep; the standalone
  scratch `check:rls` 318/0 at the final head).
- Drizzle schema parity: the mirrors landed with the migrations (W-8's
  one-increment law; the drift checks green at every wave).
- Permissions: +14 keys seeded (0103 §1), matrix §3.26 (312 → 326), the
  zero-drift equality at every wave (**326 = 326**).
- ROUTE_PERMISSIONS: **988 → 1,052** across W-9…W-13 (every change dated at
  the block; zero routes W-14/W-15).
- i18n: **6,433 → 6,620** (+49 W-12, +138 W-13 — both declared deltas; ZERO
  DELTA W-14/W-15) + mobile 371 + tokens 130/130 + 50/50.
- `docs:validate` **33/33** at every wave; manifests **13/13**.
- The archive `ERP_PLATFORM_PHASE048.zip` (OA-07) — members byte-verified
  (§11); the tag `phase/048` at the delivery head.

## 3. THE CUMULATIVE WAVE RECONCILIATION (W-8…W-15 — the phase's whole ledger)

| Wave | Head | Date (UTC) | The scope (the plan §3) | DB suite | i18n | Key deltas |
|---|---|---|---|---|---|---|
| W-8 | `916510f` | 2026-11-20 | THE FOUNDATION (T-01…T-04): migrations 0100–0103 + every mirror/registry/catalog/matrix/pin in ONE increment · the +14 keys (312→326) · the flags + manifests (D-13/D-16) · the approval amendments A-1/A-2 · the W-5 date-defect repair | **259 · 3,689** | 6,433 | ENTITY_CATALOG 307→318 · drift 326 · ROUTE_PERMISSIONS 988 (keys-seed-first) |
| W-9 | `e5efb29` | 2026-11-20 | THE WBS + BUDGETS + ACTUALS ENGINES (T-05/T-06/T-07): the pure layer first (three real scale bugs caught before any consumer) · BR-095's rollup · the cost curve + the four collectors + INV-033's typed reconciliation | **261 · 3,717** | 6,433 | ROUTE_PERMISSIONS 988→1007 · the `__db__/projects/` family begins (2 specs) |
| W-10 | `8a3534c` | 2026-11-20 | THE EVM + CHANGE ORDERS + IAS 23 (T-08/T-09 + D-11): the two EV disciplines + the EV-ceiling refusal · BR-094/G-58's exactly-once gate · the REQUIRES_VERIFICATION register | **264 · 3,743** | 6,433 | ROUTE_PERMISSIONS 1007→1018 · the ceiling's one-law-three-engines |
| W-11 | `8610310` | 2026-11-20 | THE CONTRACTING CORE (T-10/T-11/T-12): **the migration 0104 declaration** · the sub engine + THE AP LINKAGE + G-55 · the retention ledger + G-56 · the progress billing + BR-092/093 + G-57 + the in-transaction invoice + the amortization · FX at posting | **265 · 3,754** | 6,433 | ROUTE_PERMISSIONS 1018→1038 · the chain at 0104 · the catalog stays 318 |
| W-12 | `52681bf` | 2026-11-20 | FIELD SERVICE + THE WEB PLANE I (T-13/T-14): THE SINGLE CLOCK SERVICE (pause-aware, BR-096) · the dispatch board API · the /projects WBS board + the Gantt-ish timeline + the EVM tab | **266 · 3,774** | **6,482 (+49 declared)** | ROUTE_PERMISSIONS 1038→1051 |
| W-13 | `ce78bc7` | 2026-11-20 | THE WEB PLANE II + THE PRINT PACK (T-15/T-16): /projects/contracting (four tabs) · /projects/fieldservice · the three bilingual prints (bi() exclusively · deterministic · NO totals on the statement) | **267 · 3,778** | **6,620 (+138 declared)** | ROUTE_PERMISSIONS 1051→1052 · the registry stays 110 · THE CUMULATIVE LEDGER OPENED |
| W-14 | `a932b1e` | 2026-11-21 | THE REPORTS + THE PROOF (T-17/T-18): the four contracts (registry 110→114, all pins together) · the golden transcripts with the failure packs · the INV-033 + IAS-23 goldens · the RLS A1–A10 · the OA-06 budgets | **271 · 3,807** | 6,620 (ZERO DELTA) | #6 closed whole + #9's arms closed — #1…#9 ALL GREEN |
| W-15 | this delivery | 2026-11-21 | THE CLOSURE (T-19/T-20): the canon docs in the D-18 wordings + THE ID_LEDGER FLIP (atomic) + THE FULL GATE SWEEP at the final head + this report + the triple flip + the archive + the tag | **271 · 3,807** (BOTH envelopes) | 6,620 (ZERO DELTA) | implemented G 58 · INV 33 · BR 96 · reservations 16 · 45 · every constant declared (§10) |

## 4. THE BATTERY SCOPE MAP (one time — the five-package ↔ unit-packages linkage)

The owner's standing recall (b) counts the DB suite by its CHUNK packages;
the unit gates count by WORKSPACE packages — the two never mix. The map:

- **The DB-suite chunk packages** (the five-package shape, W-14's; W-15's
  eight-part restructuring declared in §5) are VITEST RUN GROUPS over
  `apps/api/src/__db__/**` — they are NOT workspace packages. The
  five-package breakdown: the smoke (migrations + the isolation family) ·
  the perf family · chunk a · chunk b (the projects family whole at W-14) ·
  chunk c. The eight-part restructure: the smoke · **the three
  time-sensitive isolates** (soak · fcm · email) · the perf-rest · chunk a ·
  chunk b-rest · chunk c — same 271 files, the regrouping declared.
- **The unit workspace packages** (8): `@erp/api` · `@erp/web` ·
  `@erp/mobile` · `@erp/desktop` · `@erp/ui` · `@erp/contracts` ·
  `@erp/domain-core` · `@erp/sync-core` — `pnpm test` (turbo, 8/8). The
  api unit package (65 files · 816 tests) is DISJOINT from the api DB
  suite (271 files · 3,807 tests — the `__db__` family runs under its own
  config with the embedded PG16); the web/mobile/desktop unit packages
  carry the render/parity/flag-gating specs of their planes.
- **The linkage**: every wave's DB count (§3) is the `__db__` inventory at
  that head; every wave's unit counts live in its gate doc; the FULL
  unit-package table at the final head is §5 (the W-14 omission repaired —
  the owner's W-15 note: «جدول حزم الوحدة غاب — عُد به كاملًا في الإغلاق»).

## 5. THE FULL UNIT-PACKAGE TABLE (at the final head — the W-15 sweep)

| Package | Files | Tests | Notes |
|---|---|---|---|
| `@erp/api` | 65 | 816 | unchanged W-10…W-15 (the fieldservice refactor at W-14 behavior-preserving) |
| `@erp/web` | 17 | 147 | +4 files/+25 tests W-12 (the board) · +3/+3 W-13 (the two screens) — unchanged W-14/W-15 |
| `@erp/mobile` | 27 | 393 | untouched by 048 (371 i18n · 130/130 + 50/50 tokens) |
| `@erp/desktop` | 16 | 274 | untouched by 048 |
| `@erp/ui` | 3 | 43 | the print-template specs extended W-13 (the freeze arm 4→7 keys) — unchanged W-14/W-15 |
| `@erp/contracts` | 2 | 56 | the NAV_ITEMS registry rows (W-12/W-13) — unchanged W-14/W-15 |
| `@erp/domain-core` | 6 | 38 | untouched by 048 |
| `@erp/sync-core` | 5 | 36 | untouched by 048 (36/36 byte-identical since 022) |
| **TOTAL** | **141** | **1,803** | **8/8 packages green at the final head** (the forced-fresh run) |

## 6. Acceptance criteria vs evidence (the phase doc §6 — the cumulative ledger closed)

1. **Migrations + mirrors + catalog rows (CR-36a)** — W-8 (migrations
   0100–0103, every mirror/registry/catalog/matrix/pin in one increment)
   + W-11's declared 0104; the chain re-proven from zero at every full
   sweep and standalone at the final head (W-15's scratch 318/0).
2. **The WBS board; BR-095's rollup; cycles rejected** — W-9's API arms
   (`projects-wbs.db.spec` — the triple agreement, the legal diamond, the
   cycle refusals with the path) + W-12's board (`/projects` + the EVM
   tab).
3. **The cost rollup complete; INV-033 to the cent** — W-9's four
   collectors + the typed reconciliation
   (`projects-budgets-actuals.db.spec` — the coherent four-leg world
   10,945.3125 = the GL dimension EXACTLY) + W-14's INV-033 golden (the
   poisoned world's typed refusal with the full per-leg payload).
4. **EVM per project/node; the EV ceiling; the forecast surface** — W-10's
   engine (`projects-evm.db.spec` — both disciplines, the typed refusal) +
   W-12's tab + W-14's `projects.evm-summary` (the block-on-fail tie).
5. **Change orders inert until approved; G-58 exactly once** — W-10's gate
   (`projects-change-orders.db.spec`) + W-13's screen tab + W-14's golden
   transcript with the failure packs.
6. **G-55…G-58 through the posting engine with balanced entries** — W-11's
   posting arms + **W-14's golden transcripts with the MANDATORY failure
   packs** (the refusals WITH their full payloads, the zero residue, the
   flip-and-restore with the green re-run) + the IAS-23 golden.
7. **Certificates → invoices with retention; advances amortize; the
   BR-093 ceiling** — W-11 WHOLE (`projects-contracting.db.spec`) + W-13's
   screen + W-14's two report contracts.
8. **Field service: the board, the pause-aware clocks, BR-096, completion
   notes/parts** — W-12's API arms (`projects-fieldservice.db.spec` — the
   pause-subtraction golden 6h − 3h = 3h) + W-13's board + W-14's
   `projects.fieldservice-sla` (the pure readout).
9. **The CR-36 gates** — keys zero-drift **W-8** (312 → 326) · i18n parity
   **W-12/W-13** (declared deltas) + **W-14/W-15** (zero delta) · RLS
   A1–A10 **W-14** (the dedicated hostile worlds + the composite-FK law)
   + the scratch chain at every sweep · flag/template gating **W-8 +
   W-12/W-13** · docs:validate **every wave** · OA-06 **W-14** (the rollup
   + dispatch probes, the plans logged verbatim) · the bilingual prints
   **W-13** (the REAL Chromium test, both directions, `bi()` exclusively,
   byte-identical determinism) · multi-currency FX **W-11** (the
   fail-closed missingFxRate).
10. **The completion report + the flip + the archive + the tag** — THIS
    REPORT (the cumulative reconciliation §3 · the battery scope map §4 ·
    the full unit-package table §5 · the ledger closed §6 · the open items
    §9) + the triple flip + `ERP_PLATFORM_PHASE048.zip` (OA-07,
    byte-verified) + the tag **`phase/048`** at the delivery head.

## 7. Deviations & decisions (documented across the waves)

- **THE MIGRATION 0104 DECLARATION (W-11)** — the plan §2 listed 0100–0103;
  the contracting core needed the three stamp columns (each anticipated by
  0103's own note; the 0100 crm_time_entries precedent) — declared at
  W-11 per the owner's clause-4 law («ما لم تصرّح الموجة بغيره»), the
  chain re-proven from zero twice.
- **The G-55 presentation decision record (W-11)** — the D-18 wording's
  customer-side hold rides G-57's own retention leg (a separate
  customer-side G-55 posting would double-count); G-55's posting is the
  sub side's. Recorded in the canon row and the W-11 gate doc.
- **The spec's own hand-slips caught by the unit-first law (W-9 · W-11 ·
  W-12)** — the fold was RIGHT each time; the SPEC's stated arithmetic
  corrected at the claim site.
- **The W-13 disclosure set** — the detached-launch reap + the shell-glob
  slip (zero evidence impact — the run replaced); the retention
  statement's NO-totals law; the letterhead's degraded placeholder.
- **The W-14 disclosure set** — the soak timing flake + the fcm chunk
  flake (both re-proven, retries green); the contracting spec's
  order-robustness repair (the supersede dance — zero production
  changes); the probe's own finding corrected at the claim site (the
  penny's credit to the 4999 sink).
- **The W-15 disclosure set** — the email chunk flake + the soak full-run
  flake (the two-head protocol, both logs kept, the three-isolate
  restructure declared); the environment-reset recovery (the fresh clone
  + the chromium env-prep); the typecheck cache-hit replacement; the F1
  ledger-date correction (2026-11-22 → 2026-11-21 at the claim site).

## 8. Gate evidence (the W-15 final sweep — 2026-11-21, both envelopes)

Every log wrapper-captured in the delivery session
(`audit-evidence/phase048-w15/` — 33 files, the two RED attempts KEPT):

| Gate | Result |
|---|---|
| typecheck / lint | **8/8 packages green** (the forced-fresh runs) |
| depcruise | no violations — **2,054 modules · 15,372 dependencies (UNCHANGED — zero production code)** |
| unit | **8/8 packages — 141 files · 1,803 tests** (§5's table) |
| **THE FULL DB SUITE (eight parts)** | **271/271 files · 3,807/3,807 · 0 failed · 0 skipped** — smoke 3·1,783 + the soak isolate 1·1 + perf-rest 5·23 + the fcm isolate 1·8 + the email isolate 1·5 + a 82·596 + b-rest 98·772 + c 80·619 (the coverage verified BEFORE the first run: union == inventory 271/271, comm diff empty) |
| **THE FULL DB SUITE (single process)** | **271/271 · 3,807/3,807 · 0 failed · 0 skipped · 553.18s INSIDE THE DECLARED 680s CEILING** (the retry after the disclosed soak flake — both logs kept) |
| check:rls (scratch PG16, the 104-chain from zero) | **OK — 318 catalog tables, 0 violations** |
| permissions drift | **326 = 326** |
| i18n parity | **6,620 = 6,620 (ZERO DELTA)** · mobile **371 = 371** · tokens 130/130 + 50/50 |
| manifests / docs:validate | **13/13** · **33/33** |
| id-ledger | **0 errors + self-test all-probes-OK — implemented G 58 · INV 33 · BR 96** (the flip; probe (7) at G-59/PHASE-049) |
| history-secrets / capabilities / shells | 0 violations · agree · PASS (the two tag anchors verified untouched) |
| negative boundary | **PASS** |

## 9. THE OPEN-ITEMS LOG (transferred explicitly — the owner's clause 5)

Standing carried into PHASE-049 and beyond, each with its owner and its
record — nothing closed by this phase's completion:

1. **THE 043 HARD REVIEW** — OPEN (the owner's independent review track;
   `audit-evidence/phase043-hard-review/` + the review's own records).
   The 043-completion round's BR-081 shift is recorded in the ID_LEDGER's
   coordination arithmetic (every phase after 043 shifted +1).
2. **RISK-031 / RISK-032** — OPEN (the register's own records; RISK-032's
   scope narrowed by the owner's 2026-11-14 directive to the
   reservation-side defenses review ONLY — never a policy question; the
   G-49 row carries the corrected wording verbatim).
3. **THE 045 NOTES** — (a) **§7(b)'s three PHASE-045 final-audit remarks**
   never entered the record (referenced by the 045 acceptance dispatch;
   never restated — nothing folded, nothing fabricated; they stand as the
   owner's open input); (b) **the register's exactly-two narrowed items**
   (the SANED 15,000 ceiling + the EOSB M/51 Art. 84 text) — unchanged,
   the owner's; (c) **the 045 self-board Tabs defect** (hr-self-board's
   conditional-expression Tabs children render EMPTY for every tab except
   the last — the Children.forEach null-overwrite; the 3-line repair is
   045 scope, the owner dispatches; the 048 boards are immune — the
   data-slot shape, the W-13 proof).
4. **THE TIME-SENSITIVITY CLASS** — NUMBERED OPEN, **seven incidents**
   (W-11's true-up non-reproducer · W-13's detached-launch reap · W-14's
   soak + fcm · W-15's email + soak); the pre-isolation mandate is now
   standing practice (W-15's three isolates); the two-head protocol with
   both logs kept is the flake law.
5. **PHASE-047's §7(b) remarks** — the same shape as 3(a): the owner's
   open input, never restated, never folded.

## 10. The constants (declared at the final head — the owner's clause 8)

**The migration chain 0104** · **the catalog 318** · **the drift 326 = 326**
· **the report registry 114** · **ROUTE_PERMISSIONS 1,052 (unchanged since
W-13 — zero routes W-14/W-15; the last dated block W-13's
`(1051 + 1 = 1052)`)** · **i18n 6,620 web + 371 mobile (both waves'
deltas declared: +49 W-12, +138 W-13, ZERO DELTA W-14/W-15)** ·
**implemented G 58 · INV 33 · BR 96 (the ledger's own counts)** ·
**the DB suite 271 files · 3,807 tests** · **depcruise 2,054 · 15,372** ·
**the unit suite 141 files · 1,803 tests (8/8 packages)**.

## 11. Delivery and handoff

- **The triple flip (CR-48):** this report · the phase doc header →
  COMPLETE · the IMPLEMENTATION_STATUS row → COMPLETE (the wave history
  appended at the closure — the 046/047 precedent).
- **The archive:** `ERP_PLATFORM_PHASE048.zip` (OA-07) at the delivery head
  — the git-archive of the delivered tree, all members byte-verified; the
  standing `ERP_PLATFORM_PHASE043.zip`…`ERP_PLATFORM_PHASE047.zip`
  verified untouched; **the evidence archive ADDITIVE-ONLY** (the §1a (c)
  law verbatim: `audit-evidence/phase048-w8…w15` all intact — new files
  only, no moving, no deleting, no renaming).
- **The tag:** `phase/048` (annotated, at the delivery head — the §1a (c)
  ruling; DELIVERY, never acceptance); `phase/046` @ `4ddb39f` and
  `phase/047` @ `5b73bd1` verified untouched.
- **Handoff to PHASE-049 (CMMS — Asset Maintenance):** the work-order
  status machine, the board patterns and THE SINGLE CLOCK SERVICE
  (pause-aware SLA) shipped here are reused by maintenance work orders;
  the `project_resource_allocations` asset side hands the CMMS phase its
  cross-branch asset movement context; the 044 asset register is the
  substrate. The ID_LEDGER's PHASE-049 reservations stand (G-59…G-61 ·
  INV-034 · BR-097…BR-100).
- **NOT PRODUCTION APPROVAL** — the closure is a delivery act; the owner's
  independent verification on fresh clones decides acceptance (the
  standing protocol).
