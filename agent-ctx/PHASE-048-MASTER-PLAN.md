# PHASE-048 Master Plan — Projects & Contracting (المشاريع والمقاولات)

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-048.md`
(T-01…T-20 are the canon task spine; this plan keeps those numbers and adds T-00).
Register: CR-18 · Wave 2 / Stage 13 · Roadmap ~5.5–7.5 weeks (the v3.2/CR-50 note).

Authority chain: PHASE-048.md → [CR-18](../docs/planning/COMPLETENESS_REGISTER.md)
→ the **047 → 048 hard ordering** (COMPLETENESS_ROADMAP §5) → the ID_LEDGER's
048 reservations (**G-55…G-58 · INV-033 · BR-092…BR-096**, re-coordinated
2026-11-13/14) → this plan.

**Status: PROPOSED (2026-11-19, this session — per the owner's PHASE-048
authorization dispatch: the plan is the FIRST deliverable and NO CODE WAVE
opens before the owner's approval of it; the dispatch's four binding
conditions are carried verbatim as red lines §6.10–§6.12 and pre-satisfied
where the delivered state already satisfies them — §0a/§0b).** This plan's
evidence envelope: `audit-evidence/phase048-plan/` (every log same-session,
the FIFTEENTH consecutive wave). **[Dated 2026-11-19 (later the same day) —
the owner's §7-rulings dispatch: §0a ACCEPTED as written (the
progress-before-authorization licensed; plan-before-code honored in
`0926a74`; the 307 correction accepted; the swallowed-first-attempt
disclosure accepted); the four §7 rulings recorded in §1a below; the
written clarifications this amendment carries (the W-15 archive's
ADDITIVE-ONLY law verbatim · the two skipped DB tests named + justified +
the no-masking PROOF · the NF-10/NF-11 pointers · the four-quadrant wrapper
self-test bundle) — clarification only, NO code, per the dispatch's own
boundary. Condition 2's checkmark stands PROVISIONAL until the owner's own
protocol re-run (§1a (d)).]**

## 1a. The owner's §7 rulings (binding — recorded 2026-11-19, the §7-rulings dispatch)

1. **(a) THE 047 BOUNDARY + THE TAG — RULED.** The boundary as declared is
   adopted: PHASE-047 = W-0…W-7, delivery at `5b73bd1`. The tag
   `phase/047` stays where placed (2026-11-19) — the owner sees it as
   correct on the merits, not merely frozen by the permanence law.
   **The tag is DELIVERY, NOT ACCEPTANCE:** W-4…W-7 remain pending
   acceptance on the owner's independent verification, and any defect
   found in them is fixed FORWARD-PROGRESSIVELY in 048's waves — no tag
   touching, no published-item modification.
2. **(b) THE WAVE NUMBERING — CONFIRMED.** The global sequence continues;
   W-4…W-7 belong to 047 finally; PHASE-048's waves = **W-8…W-15** as
   proposed. No renumbering, no collision.
3. **(c) THE TAG `phase/048` — RULED WITH A BINDING CONDITION.** On the
   W-15 delivery commit, per the 046/047 precedent. And — stated VERBATIM
   as the owner required before approval: **«الأرشيف» في W-15 إضافي فقط —
   إنشاء أدلة وملفات جديدة، ولا نقل ولا حذف ولا إعادة تسمية لأي دليل
   قائم** — the W-15 "archive" is ADDITIVE ONLY: creating new directories
   and files; NO moving, NO deleting, NO renaming of ANY existing
   directory. (Also stated at W-15 in §3 and as §6.10's dated extension.)
4. **(d) NF-9 — THE OWNER'S OWN RE-RUN DECIDES.** The owner will execute
   the protocol in a clean clone per the evidence README's commands
   verbatim, with raw commands: the worktree at `7d22c49` + the spec from
   the post-fix head → required literally **1 failed | 9 passed, (d4) by
   name, exit 1, and no other failure — number by number**; then green at
   the plan head `0926a74` (same code as `5b73bd1` + docs only) → **10/10**.
   The (d4) arm's fate per the owner's criterion: a permanent named arm
   running within the standard battery on every run → **EXEMPT** from the
   W-8 dedicated-spec requirement; isolatable or skippable → REQUIRED in
   W-8. [§0b's dated note states the facts: (d4) is a plain named `it()`
   under the DB config's standard include, with no skip guards anywhere in
   the file — grep-verified this session — and it ran in every full
   DB-suite invocation (the W-6/W-7 sweeps + this session's 259/259).]
   **And if the red does not reproduce on the owner's re-run for any
   reason — the protocol is REJECTED and the blocking-ness returns fully
   to W-8.**
5. **The verification queue (the owner's own list, recorded):** the wave
   chain `83362ff ← 461e257 ← e76bbd0 ← 65fee86 ← 5b73bd1 ← 0926a74` +
   the one-commit-per-wave commitment + the tags in place · the
   `starts_with` fix with its dated comment + the (d4) arm · the NF-10/
   NF-11 pointers (§0c below — the owner's written demand) · the journal
   ends 0099 · the routes 979 → 984 → 988 with two dated notes ·
   ENTITY_CATALOG 307 · zero archiving · the envelope's logs with the four
   quadrants complete · the full battery at `0926a74` number-by-number
   including the two skipped DB tests named + justified (§0d — with the
   no-masking proof) · then the clause-by-clause plan review.

## 0a. THE LEDGER RECONCILIATION (the owner's 2026-11-19 dispatch vs the repository state — dated, binding)

The owner's dispatch anchors the ledger at **W-3 ACCEPTED (`7d22c49`)** with
NF-9 open and no code wave permitted before its fix. Every verification
number in the dispatch is the W-3 head's own baseline — cross-checked this
session against the 047 plan §0's dated W-3 note, each matching exactly:
depcruise **1,965** (· 14,630) · unit api **693** (59 files) · the W-3 new
specs **30/30** · the full DB suite **254/254** (· 3,572) · check:rls
scratch **307/0** · drift **312 = 312** · routes **979** ·
ENTITY_CATALOG/check:rls **307** (the 306 → 307 move was W-3's own `0099`).

The repository, however, moved past that anchor **before the dispatch
arrived** — under the standing push-each-step instruction, the eleventh
through fourteenth waves delivered and pushed PHASE-047's remaining approved
plan (each with same-session evidence, on fresh clones):

| Wave | Head | Delivered |
|---|---|---|
| W-4 | `83362ff` | the external bridges + **THE NF-9/NF-10/NF-11 FIXES** (the owner's W-3 verification findings — including the org-move `starts_with` literal-prefix repair with the adversarial close-code arm, §0b) |
| W-5 | `461e257` | the web plane (four screen families + the 360 extension + 308 i18n keys/locale) |
| W-6 | `e76bbd0` | the reports + proof wave (registry 106 → 110, the talent RLS attack suite, the OA-06 budgets, the vitest summary guard) |
| W-7 | `65fee86` | the closure (canon docs, the ID_LEDGER flip BR-001…091, the full sweep 259/259 · 3,623, the completion report, the triple flip) |
| delivery | `5b73bd1` | the OA-07 archive `ERP_PLATFORM_PHASE047.zip` (3,118 members byte-verified) + **the tag `phase/047`** |

This plan claims those waves' **delivery, never their acceptance** — they
await the owner's independent fresh-clone verification exactly as W-3's
did (the dispatch's own protocol). The dispatch's "no code wave before the
NF-9 fix" is thereby satisfied by history: the fix shipped in `83362ff` and
every later wave rode above it; no 048 code wave opens before this plan's
approval regardless.

**THE PHASE-047 BOUNDARY — DECLARED (the dispatch's explicit demand):**
PHASE-047 = **W-0 through W-7**, per the owner-approved 047 master plan
(2026-11-18, amendments A-1…A-5) with its full wave division — COMPLETE at
the delivery head `5b73bd1`. The dispatch's two anticipated scenarios
(W-3-end → tag `7d22c49`; W-4-end → tag after acceptance) were written from
the W-3-verification state; the approved plan's actual boundary is the W-7
closure, and the dispatch's own tag-permanence law governs what exists:

**THE TAG `phase/047` — ALREADY PLACED, DISCLOSED, UNTOUCHED.** It sits at
`5b73bd1` (annotated; the tag object `90fd428d`), placed 2026-11-19 at the
W-7 closure delivery per the 046 precedent (the tag at the delivery head)
and the owner-approved amendment A-3 of the 047 plan ("the closure tag is
`phase/047`") — placed BEFORE this dispatch arrived. Per the dispatch's own
rule — "الوسم في الحالين دائم لا يُمسّ" — and the standing untouchable-tags
law, **it stands; no tag is moved, deleted, or re-pointed** (`phase/046` on
`4ddb39f` equally untouched). If the owner rules the boundary differently,
that ruling arrives as a dated dispatch and is recorded — but the
permanence law binds both ways.

**The dispatch's standing constants — reconciled (each verified this
session):** migrations integrate **from 0100** (the journal ends at `0099`,
idx 98 — no renumbering, no touching any published migration) · the routes
ledger from the **979** baseline with dated notes for every change (979 →
984 at W-4, +5; 984 → 988 at W-5, +4 — both notes dated in the 047 plan §0;
current 988; 048 continues the discipline) · `ENTITY_CATALOG` — the
dispatch's "من 306" is the pre-`0099` anchor; the actual at the owner's own
W-3-verified head is **307** (the 306 → 307 move is W-3's own, dated); 048
appends from 307 · **no evidence archived or deleted** — every
`audit-evidence/` folder stands; this plan ADDS `phase048-plan/` · all tags
immutable.

**The wave numbering — reconciled:** the dispatch's "تقسيم الموجات بدءًا من
W-4" is anchored to the W-3-accepted state (the next wave number in the
owner's ledger at dispatch time). The delivered history consumed W-4…W-7
for 047's approved plan; **PHASE-048's waves therefore continue the global
sequence at W-8** — no collision with the delivered W-4…W-7 records, no
renumbering of anything published. [§7(b) — the owner confirms or overrides
at approval.]

## 0b. NF-9 — THE BLOCKING ITEM (the dispatch's condition 2), mapped to the delivered state and PRE-VERIFIED

- **The defect** (as documented by the owner's W-3 verification report,
  proven on a live cluster): `moveOrgUnit`'s dependent-path rewrite rode
  `WHERE path LIKE '${oldPath}.%'` — `_` is a single-character WILDCARD in
  LIKE and org codes legally contain underscores (`ORG_CODE_RE`), so the
  pattern `SALES_EAST.%` matched BOTH `SALES_EAST.child` AND
  `SALESXEAST.otherchild` — a sibling tree whose code matched at the
  underscore position would have its path corrupted by the move.
- **The fix — DELIVERED in 047's W-4 (`83362ff`), before the dispatch
  arrived:** `WHERE starts_with(path, ${oldPath} || '.')` — literal prefix
  semantics; the dated F1 comment at the store site
  (`talent-org.store.ts`, 2026-11-19); **the regression test — the (d4)
  adversarial close-code arm** added to
  `apps/api/src/__db__/hr/talent-training-org.db.spec.ts` (the
  `ADV{seq}_EAST` vs `ADV{seq}XEAST` sibling pair; the file's ONLY W-4
  delta, unchanged since — `git log --follow` verified).
- **THE RED/GREEN PROTOCOL — PRE-VERIFIED THIS SESSION** (the dispatch's
  acceptance bar, executed exactly as the owner's verifier will execute
  it; every log in `audit-evidence/phase048-plan/`, four quarters kept):
  - **GREEN at `5b73bd1`:** the spec 10/10, `VITEST_EXIT=0`
    (`nf9-green-current-head.log`) — and the FULL DB SUITE 259/259 ·
    3,621 passed | 2 skipped green the same session
    (`db-suite-full-verbose-259files.log`).
  - **RED at the pre-fix head `7d22c49`** (rebuilt this session as a
    worktree, the regression spec applied from the post-fix head):
    **1 failed | 9 passed — (d4) FAILS BY NAME** — the failure is exactly
    the defect, the other nine tests green, `VITEST_EXIT=1`
    (`nf9-red-prefix-head-7d22c49.log`).
  - **The verifier's exact commands** (green + red sides) are recorded in
    the evidence README — including the honest note that the FIRST red
    attempt, run through the **W-3-era capture wrapper** (which predates
    the W-6 vitest summary guard) with the pnpm layer, stamped
    `VITEST_EXIT=0` on the genuinely red run — the exact NF-4/W-6 class,
    re-proven live at the W-3 head. The verifier at the pre-fix head MUST
    use the direct vitest invocation or a post-W-6 wrapper.
- **The fallback arm (the dispatch's condition honored even though the
  delivered pair satisfies the protocol):** IF the owner's verifier
  requires a DEDICATED self-contained regression spec (its own file at the
  pre-fix tree), **W-8 (the first code wave) adds it** — same red/green
  protocol against `7d22c49`, the four-quarter logs, the F1 dated comments
  at every touched site. One wave, no scope creep.
- **[Dated 2026-11-19 (the §7-rulings dispatch) — the (d4) arm's
  battery permanence, the owner's criterion stated and the facts
  verified this session:]** (d4) is a **permanent named arm inside the
  standard battery**: a plain `it("…")` block in
  `apps/api/src/__db__/hr/talent-training-org.db.spec.ts`, matched by the
  DB config's include pattern (`src/__db__/**/*.spec.ts`), with **NO
  `skipIf`/`.skip`/`ctx.skip` guards anywhere in the file** (grep-verified
  this session), and it ran in **every full DB-suite invocation** — the
  W-6 and W-7 sweeps (259/259 each) and this session's full run (`✓ …
  (10 tests)` among the 259). It is not isolatable except by explicitly
  narrowing the file selection — true of any test in the suite. **Per the
  owner's criterion: the EXEMPTION branch** — the owner's own re-run
  decides finally (§1a (d)).

## 0c. NF-10 / NF-11 — the pointers (the owner's written demand, 2026-11-19)

Both findings came from the owner's W-3 verification session; both were
fixed in 047's W-4 (`83362ff`); the canonical documentation is the W-4
gate doc §4 (`docs/operations/gate-evidence/2026-11-19-phase047-w4.md`).

- **NF-10 — THE PHANTOM HIRE ARM (a documentation-truth defect, delivered
  as the owner's PREFERRED remedy):** the W-3 store header named a
  `casHireApplicant` function and an `hired_employee_id IS NULL`
  written-once arm **that DID NOT EXIST** — the W-3 mechanism was the
  stage pin alone (`WHERE id AND stage = 'OFFER'`; the law held only
  because no ladder path leads from HIRED back to OFFER). The header
  claimed a structural defense the code did not carry.
  **The fix (`83362ff`):** the arm now EXISTS for real — `casAdvanceStage`'s
  WHERE carries `AND (${hiredEmployeeId}::uuid IS NULL OR
  hired_employee_id IS NULL)` (active only when the statement carries a
  hire link; vacuously true for every ADVANCE/REOPEN call), with the dated
  NF-10 note at the site (`talent-recruitment.store.ts`) recording what
  the W-3 shape was, and both service doc sites (the header's HIRE ACT law
  + the `hireApplicant` docblock) now state the TWO defense lines
  truthfully.
  **The regression arm:** `(d2) THE NF-10 WRITTEN-ONCE ARM` in
  `apps/api/src/__db__/hr/talent-recruitment.db.spec.ts` — a row pinned
  at OFFER but ALREADY LINKED (a state no API path produces; seeded by
  raw superuser UPDATE) faces the store-level CAS with a hire link →
  **ZERO rows matched, ZERO residue** (stage still OFFER, the ORIGINAL
  link intact, version unbumped, no HIRE record in the history). The arm
  runs in the standard battery with the same permanence as (d4) (same
  file family, no skip guards).
- **NF-11 — THE UNIT-COUNT RECORD (a pure F1 record correction):** the
  W-3 gate doc's §3 unit row carried the inner parenthetical "58 · 684" —
  the FILE count was off by one (the W-2 base was **59 files · 684**,
  counted at both heads; the 9 W-3 pure tests landed in the EXISTING
  `talent-math.spec.ts`, adding zero files — **59 · 693 at both ends**).
  The row's headline figures (59 · 693) were correct; only the inner
  "58" was miswritten. **The fix: the DATED 58 → 59 correction AT the
  claim site** (the W-3 gate doc's unit row, dated 2026-11-19/W-4). No
  test arm exists or applies — the class is documentation-truth (the F1
  law); the dated correction at the original claim site IS the remedy,
  and the W-4 gate doc §4 records it.

## 0d. The two skipped DB tests — named, justified, and PROVEN not to mask (the owner's verification item, 2026-11-19)

- **The two tests, by name** — both in the describe
  `"ChromiumRenderEngine (real browser)"` of
  `apps/api/src/__db__/reporting/render.spec.ts`:
  1. `renders a 60-row ar report across ≥2 pages with a repeating thead`
  2. `stampPdfA2b preserves the page count of the rendered document`
- **The skip mechanism (the suite's own documented law):** the spec's
  header documents graceful degradation — "the suite skips gracefully
  when the browser cannot launch (the CI unit image ships no Chromium):
  a probe render in `beforeAll` decides, and every browser-dependent test
  calls `ctx.skip()`". The engine launches Playwright's Chromium; if the
  launch fails, `browserAvailable = false` and the two tests skip AT
  RUNTIME — an environment-conditional skip, never a failure mask.
- **The cause this session (the honest timeline, timestamped from the
  logs):** the full-suite run (22:00:04–22:09:18 UTC) PRECEDED the
  `chromium_headless_shell-1248` install (completed ~22:15 UTC — the
  W-0 known gap, revealed by the unit battery's first attempt at
  22:13–22:14 on the zatca-qr spec and installed for it). At suite
  time the browser binary was absent → the probe failed → the two
  tests skipped. The battery's unit run and the DB suite are separate
  invocations; the install happened between them; the render re-run
  (22:35:51 UTC) is the proof below.
- **THE NO-MASKING PROOF (this session, minutes later):** the re-run of
  the spec with the browser present — at the plan head `0926a74`'s tree
  — **2/2 GREEN, `VITEST_EXIT=0`**
  (`audit-evidence/phase048-plan/render-spec-browser-present.log`).
  With the browser present, the full-suite count is **3,623/3,623 · 0
  skipped** — identical to the W-7 record.
- **The W-3 comparison (the owner's own observation):** at W-3 the suite
  was 254/254 · 3,572/3,572 with no skips — the render spec existed and
  ran GREEN in the owner's verification environment (the browser present
  there). The skip is strictly a property of THIS session's
  browser-absent window, not of the code — and per the owner's rule:
  had the re-run revealed a failure beneath the skip, that would have
  been a REJECTION, not an adjustment. It revealed green.

## 0. Inputs consumed (the plan-first reads — one focused pass over the `5b73bd1` head, 2026-11-19, this session)

- `docs/implementation/phases/PHASE-048.md` (spec §1–§8 — T-01…T-20, the
  v3.1/CR-45 ID bindings, the v3.2/CR-50 IAS-23 addition) ·
  COMPLETENESS_REGISTER CR-18 · COMPLETENESS_ROADMAP §6.1/§6.2/§6.5 ·
  ID_LEDGER row 45 (048 = G-55…G-58 · INV-033 · BR-092…096,
  re-coordinated 2026-11-13/14).
- The 046/047 delivery records: both completion reports, the 047 master
  plan (the wave/gate/red-line pattern this plan inherits — including its
  §0 dated baseline notes through W-7), `agent-ctx/NEXT_ACTION.md` (the
  047→048 handoff: `positions` + the employee master feed
  `project_resource_allocations`; the 360 extension is the allocating
  surface; the org tree's materialized paths roll project rollups up the
  reporting lines).
- Code research (this session, read-only): the projects substrate
  (`schema.ts` — the PHASE-019 six-column analytical dimension with
  status OPEN|CLOSED, `PROJECT_CLOSED` typed at the engine), the
  `crm_time_entries` surface (hours · feeItemId · projectId · unitRate
  snapshotted · billable · DRAFT→APPROVED · billedInvoiceId — the WBS
  dimension lands here), `sales_invoices` (the certificate→invoice
  target), `service_orders`/`serviceOrderLines` (the field-service
  substrate — the PENDING/RESERVED/ISSUED/INVOICED/VOID line shape), the
  posting engine + JOURNAL_RULES G-21…G-54 (the G-33 supplier-advance
  DISBURSE/APPLY pattern the customer advances mirror; the golden-row
  canon shape), ACCOUNTING_INVARIANTS through INV-032, BUSINESS_RULES
  through BR-091, the reporting registry (110 contracts, the W-6 pin-site
  law), the 044 WMS issue paths (material actuals), the 038 advances, the
  jobs infra, the web `[locale]` screens + NAV_ITEMS + ⌘K, the
  print-template machinery, the `hr_alert_jobs` config-row precedent
  (047's D-06) for the IAS-23 rate register's shape.
- **Baselines — RECOUNTED THIS SESSION at `5b73bd1`** (every number this
  session's own run or recount, `audit-evidence/phase048-plan/` — the
  strongest F1 position; W-0 re-runs the clean-environment baseline at the
  approval head per the 047 A-5 precedent): typecheck 8/8 · lint 8/8 ·
  depcruise clean **1,993 modules · 14,855 dependencies** · unit 8/8
  packages (api 60 · 712 · web 13 · 122 · mobile 27 · 393 · desktop 16 ·
  274 · ui 3 · 43 · contracts 2 · 56 · domain-core 6 · 38 · sync-core 5 ·
  36) · **THE FULL DB SUITE 259/259 files · 3,621 passed | 2 skipped
  (3,623)** — the two skips are the render spec's browser-gated pair,
  environment-conditional (the W-7 sweep's 0-skipped was that session's
  environment; both records true in their environments, the F1 law) ·
  permissions drift **312 = 312** · ROUTE_PERMISSIONS **988** · i18n
  **6,433 = 6,433** + mobile **371 = 371** + tokens **50/50** · manifests
  **13/13** · docs:validate **33/33** · id-ledger **0 errors + self-test
  all-probes-OK** (implemented G 54 · INV 32 · BR 91) · history-secrets
  **0** · capabilities **agree** · shells **PASS/PASS** · ENTITY_CATALOG
  **307** · check:rls **307** (the W-7 scratch run + this session's
  in-suite co-proof; the standalone scratch re-runs at W-0) · the report
  registry **110** · the migration journal **0099** (idx 98).

> **[Dated 2026-11-20 (W-8 DELIVERED — the foundation wave, T-01 + T-02 +
> T-03 + T-04, on the approved-plan head `765e481`, this session's fresh
> clone — the same-session evidence rule's SIXTEENTH consecutive wave):
> the plan §2's inventory shipped exactly + the approval dispatch's two
> binding amendments.]** Migrations **0100–0103** (0100 the WBS tree +
> the `crm_time_entries` WBS dimension · 0101 budgets/lines/allocations ·
> 0102 change orders with BR-094's structural inert-until-approved floor
> · 0103 the contracting core + THE DATA-ONLY grants — the 0098 pattern)
> + every mirror in ONE increment: journal +4 (idx 99–102) + the
> MIGRATIONS manifest + the unit spec pin; Drizzle mirrors +11 + the
> time-entry column; tables.registry +11 (the A-suite +66, the isolation
> spec 1,764 green in the full run); ENTITY_CATALOG **307 → 318**; matrix
> **§3.26 (312 → 326)** + the drift checker's list + the spec's copy +
> the identity-flows census pin (the 0086/0092 lesson); FEATURE_DEPS +3
> (wbs → accounting.projects · contracting → accounting.projects +
> sales.invoices · fieldservice → crm.service_orders — the D-16 substrate
> law) + the layer-fixtures' 0103 §2 transcription; templates.ts + the
> three docs mirrors + the golden effective-configs re-pin (27 of 37
> moved, the dated review note) + the templates-017/019 stored-hash
> re-pins + the contracts manifests test's rental pin; the manifest
> schema's FEATURE_KEY_MODULE_SEGMENT gains `projects` (the one-increment
> law); **the IAS-23 rate register landed as the settings-plane config
> key `projects.ias23_capitalization_rate`** (D-02's "config row" — NOT a
> table, the gosi_establishment_no no-default precedent; REQUIRES_
> VERIFICATION at the W-14 posting, pin-neutral by construction — the +11
> catalog count stands, no +12 dated note needed). **ROUTE_PERMISSIONS
> stays 988 = 988** (the keys-seed-first discipline, the §3.23/§3.24/
> §3.25 precedent — matrix §3.26's dated note records it; the
> /api/v1/projects/* families bind the keys as W-9…W-13 ship). **THE
> OWNER'S APPROVAL-DISPATCH AMENDMENTS:** **A-1** the phase048-plan
> README's sealed table gains its 26th row (`docs-validate-amendment.log`
> — the F1 record correction at the claim site, dated) · **A-2 (NF-12)**
> the README's verifier-commands section gains the binding verdict rule
> (judge by the SUMMARY LINES or the guarded wrapper, never the raw exit
> code — the owner's calibrated probe proved the DB-configured vitest
> exits 0 on single-test reds too, not only the W-6 suite-level class)
> + the matching dated scope line at the capture-evidence.sh guard.
> **THE FORWARD-PROGRESSIVE REPAIR (§1a(a) — a 047 W-5 latent defect the
> wave's own battery caught):** both web clock-pin test blocks
> (employee-talent-360 + hr-org-board) pinned 2026-11-19 and then
> IMMEDIATELY un-pinned it (`vi.useRealTimers()` on the wrong line) —
> the pin only held while real time was 2026-11-19; the session's UTC
> midnight flip (11-19 → 11-20) turned "6 days remaining" into "5 days
> remaining" and three chip tests red (the date-bound class, disclosed
> in the W-8 gate doc). REPAIRED test-only: the pin now holds
> (`useFakeTimers({ shouldAdvanceTime: true })` + the real restore in
> afterEach); zero production change; the rental_logistics manifests
> test pin extended with the flags likewise. **Exit criteria met:**
> acceptance #1 green (migrations + catalog rows + zero-drift 326 = 326);
> the migration chain re-proven from zero (the full DB suite's embedded
> boot + the standalone scratch run); the full DB suite at the new count
> (259 files · 3,689 — the 3,623 baseline + the A-suite's 66 new arms;
> every number in `audit-evidence/phase048-w8/`). The (d4) fallback arm
> NOT dispatched (the owner's exemption ruling — §1a(d)). NOT production
> approval. The evidence: `audit-evidence/phase048-w8/` + the gate doc
> `docs/operations/gate-evidence/2026-11-20-phase048-w8.md`.**

## 1. Settled design decisions (from the plan-first reads — binding for all waves, amendable only by the owner's dated dispatch)

**D-01 — The projects substrate is EXTENDED, never replaced (the phase
doc's own law).** The six-column `projects` table (the PHASE-019
analytical dimension; `PROJECT_CLOSED` rejects new journal-line stamps)
keeps its shape; the contracting world lands AROUND it (`project_wbs_tasks`
→ `projects`; the journal-line project dimension is INV-033's GL
reconciliation target and is untouched). The 047 frozen-substrate law
extends: **048 never writes a payroll table** — labor actuals value
approved time entries at employee cost rates READ from the payroll/HR data
(rate snapshotted at valuation, the `crm_time_entries.unitRate` precedent).

**D-02 — Migration slots pinned honestly: 0100–0103** (the journal ends at
`0099` — this session's recount; the phase doc's "0079…0082" are stale
blueprint slots, its own note defers to the journal — the 047 D-03
precedent). Shapes: `0100_projects_wbs.sql` (the WBS tree + milestones +
dependencies + weight/%-complete + the WBS dimension on
`crm_time_entries`), `0101_projects_budgets_allocation.sql` (budgets +
lines by cost type + resource allocations), `0102_projects_change_orders.sql`
(the approval link), `0103_projects_contracting_fieldservice.sql`
(subcontracts + sub-certificates + retention + progress certificates +
service visits + the IAS-23 pair + the DATA-ONLY grants block — the
`0098` pattern). **The honest table count:** the doc's §4 "+9" predates the
v3.2 addition and undercounts its own §2 — the true inventory is **wbs ·
budgets · budget_lines · allocations · change_orders ·
subcontractor_agreements · subcontractor_certificates ·
retention_accounts · progress_certificates · service_visits** (10) **+
`ias23_capitalizations`** (the v3.2/CR-50 addition) = **11 new tables**
(+ the IAS-23 rate register — a config row in the `hr_alert_jobs`
precedent's shape, pinned at W-8 against the doc's REQUIRES_VERIFICATION
law; if implementation lands it as a table, the dated note records the
+12). `check:rls`/ENTITY_CATALOG **307 → 318** (or 319).

**D-03 — The WBS law (BR-095):** the tree with milestones (zero-duration
flag), predecessor dependencies **cycle-safe by construction** (the 047
D-09 org-tree precedent exactly — a pure `detectCycle` unit-tested first,
validation at write time, the API the only move path), and the weighted
%-complete rollup **recomputed from the leaves on every read of the
aggregate** (never a stored stale sum; the BR-089 zero-residue spirit; the
rollup reconciles node-by-node per acceptance #2).

**D-04 — The budget cost curve (PR-01):** `project_budgets` +
`project_budget_lines` by cost type LABOR/MATERIAL/SUBCONTRACT/OVERHEAD,
planned amounts spread over the WBS schedule — the curve behind PV; money
is the numeric money type (ADR-0009 — no binary float, ever); the
vs-actual rollup per type and per node (T-06).

**D-05 — THE ACTUAL COLLECTORS (INV-033's four legs, T-07):** labor =
approved `crm_time_entries` × employee cost rates (payroll read-only,
D-01) on the new WBS dimension; materials = the 044 WMS issue paths
(read-only aggregation; **graceful degrade when absent** — the phase doc's
soft-dependency note, an honest zero not a fabricated one);
subcontractors = the certificates' net values; overhead = the
tenant-configured allocation driver. **INV-033 (proposed wording, binding
at approval):** per project, AC = labor + materials + subcontractor +
allocated overhead, reconciling to the GL project dimension **to the
cent** — the typed reconciliation service computes and refuses to report
on any residual (the INV-032(b) tolerance-0 spirit; the reconciliation
output is acceptance #3's evidence).

**D-06 — EVM is a PURE domain function set (unit-first, T-08):** PV from
the budget curve; EV from approved %-complete × budget with **two
disciplines** — certificate-gated EV for customer billing, the weighted
structural rollup for internal EV, the delta surfaced as a management
signal (the phase doc's %-complete-honesty mitigation); AC from the
collectors; CPI/SPI/EAC/ETC per project and per node; **EV never exceeds
the approved budget** (the typed refusal); the forecast surface renders
trend + estimate at completion.

**D-07 — Change orders (PR-05, BR-094):** `change_orders` (scope/price/
schedule deltas) are **inert until approved** — the approval gate precedes
any budget, billing or contract-value effect; approval applies G-58's
delta **exactly once** (INV-013 idempotency; the ceiling recomputes to
include approved change orders — BR-092/093's law); multi-step chains
bind when 052's workflow engine lands (the phase doc's own deferral).

**D-08 — Subcontracting (PR-06, the L2-20 home):**
`subcontractor_agreements` (value, currency, retention %, period) +
`subcontractor_certificates` (progress %, gross, retention withheld, net
payable); each certificate drives its subcontractor purchase obligation
through the purchasing chain (the AP debit-note/PO linkage); subcontractor
retention tracks in the SAME retention ledger (D-09); the 043 tolling
flow (M-21) owns the manufacturing side — together closing L2-20.

**D-09 — THE RETENTION LEDGER (G-55/G-56, PR-07/DF-08):**
`retention_accounts` (hold %, accrued balance, release schedule tied to
taking-over and defect-liability dates); **G-55** hold at each progress
certificate, **G-56** release at final acceptance — both through the
posting engine with balanced entries and registered source keys; the
presentation default (contra-revenue vs receivable) documented in the
G-rows with any owner deviation recorded as a decision record at
implementation (the phase doc's own risk note).

**D-10 — PROGRESS-CERTIFICATED BILLING (G-57, BR-092/093, the L2-15
home):** `progress_certificates` (PROGRESS/ADVANCE/FINAL; cumulative
completed %, gross, retention, net) generate sales invoices on approval;
**cumulative billing never exceeds the approved contract value including
approved change orders** (the ceiling law, typed refusal); advance
applications post as customer advances amortized against later
certificates — **the G-33 supplier-advance DISBURSE/APPLY mirror on the
customer side** (the 038 discipline); the IFRS-15 output-method alignment
with 068's recognition schedules is the interface contract both sides
honor (L2-15's residual is exactly this alignment, not a rebuild).

**D-11 — IAS 23 borrowing costs (R-04, the v3.2/CR-50 addition):** the
capitalization-rate register is **tenant-entered WITH SOURCE EVIDENCE —
`REQUIRES_VERIFICATION`, the posting refuses without it** (the phase
doc's own law — no fabricated compliance content, red line 5); the window
driven by the WBS schedule start/end on qualifying projects; the
capitalized-vs-expensed split posts through the engine (the golden at
implementation, W-14); scope tracking (`ias23_capitalizations`) rides the
budget lines it capitalizes.

**D-12 — Field service (PR-13/14/15, BR-096):** `service_visits` on the
EXISTING `service_orders` (never a new order surface); the status machine
NEW→SCHEDULED→DISPATCHED→IN_PROGRESS→COMPLETED→CLOSED; **a SINGLE clock
service** for SLA response/resolution with pause states (the phase doc's
risk mitigation — one implementation, its own test matrix) and breach
escalation (BR-096); completion records notes and parts used (the
service-order line issue path).

**D-13 — Permissions +14 keys (the phase doc's exact list), ONE
increment** (the 047 D-11 law): `projects.wbs.view/manage`,
`projects.budget.view/manage`, `projects.allocation.manage`,
`projects.change_order.view/approve`, `projects.contracting.view/manage`,
`projects.certificates.approve`, `projects.retention.manage`,
`projects.evm.view`, `projects.fieldservice.view/dispatch` — seed +
matrix §3.x rows + drift-checker list + `route-permissions.ts` +
feature-keys together; drift **312 → 326**; ROUTE_PERMISSIONS 988 + n
with **every change dated** (the dispatch's law).

**D-14 — i18n ~+300 AR/EN pairs** across the three screen families, the
EVM tab and the print templates; parity **6,433 → 6,433+n** (exact at
implementation; the equality check extended); the three bilingual print
templates render AR/EN with RTL correctness (acceptance #9's print arm).

**D-15 — Reports +4 contracts (110 → 114):**
`projects.evm-summary`, `projects.contract-progress`,
`projects.retention-statement`, `projects.fieldservice-sla` — REPORT_CATALOG
§9 rows + **all pin sites re-pinned together** (the W-6 047 law) + the
catalog↔registry reconciliation extended to 114/114.

**D-16 — Feature flags + template composition (CR-36f):**
`projects.wbs`, `projects.contracting`, `projects.fieldservice`;
professional-services, automotive-workshop and rental-logistics manifests
compose them by default; manifests validation extended in the same
increment (one-increment law — every checker stays green).

**D-17 — OA-06 EXPLAIN budgets (T-18) assert the INDEX-DRIVEN law in the
W-9-settled shape** (the standing ruling): the rollup and dispatch query
probes — index-driven, no seq-scan, the planner's legitimate paths
accepted, the observed plan LOGGED verbatim; never a forced plan, never
an isolated probe context.

**D-18 — THE G-55…G-58 · INV-033 · BR-092…096 PROPOSED WORDINGS (binding
at approval — the 047 D-04/A-2 pattern; the canon rows land at W-15 in
the JOURNAL_RULES G-table, ACCOUNTING_INVARIANTS and BUSINESS_RULES
shapes):**
- **G-55** retention hold at each progress certificate — DR the
  tenant-mapped retention contra/receivable account · CR `AR_CONTROL` at
  the certificate's retention amount (fail-closed `PURPOSE_NOT_MAPPED`
  until mapped — the 038 discipline);
- **G-56** retention release at final acceptance — DR the retention
  account · CR `AR_CONTROL` (the released balance; the schedule's
  taking-over/defect-liability gates);
- **G-57** progress-certificate revenue — DR `AR_CONTROL` (net) · DR the
  retention account (held) · CR `REVENUE` (the approved cumulative value)
  at certificate approval, the sales invoice generated in-transaction;
- **G-58** change-order delta — on approval, exactly-once (INV-013): the
  contract-value/budget/billing-ceiling adjustment posts its price delta
  through the engine (DR/CR per the delta's sign on the mapped
  contract-WIP/revise accounts — the mapping fail-closed);
- **INV-033** EVM consistency — D-05's wording;
- **BR-092** the retention % comes from the contract (never a global
  constant — tenant DATA per contract);
- **BR-093** cumulative billing ≤ the approved contract value including
  approved change orders (the ceiling law, typed refusal);
- **BR-094** change orders inert until approved (the gate precedes every
  effect);
- **BR-095** the weighted %-complete rollup integrity (leaf-recomputed,
  node-by-node reconcilable);
- **BR-096** SLA breach escalation on pause-aware clocks (the single
  clock service's law).

## 2. Migration inventory (the honest slots — journal ends at `0099`, idx 98)

| Slot | File | Contents |
|---|---|---|
| 0100 | `0100_projects_wbs.sql` | `project_wbs_tasks` (tree, milestones, dependencies, weight, `percent_complete`) + the WBS-task dimension on `crm_time_entries` (the phase doc's "+1 column family") |
| 0101 | `0101_projects_budgets_allocation.sql` | `project_budgets` + `project_budget_lines` (by cost type) + `project_resource_allocations` (employee or asset, date range, allocation %) |
| 0102 | `0102_projects_change_orders.sql` | `change_orders` (scope/price/schedule deltas, the approval link) |
| 0103 | `0103_projects_contracting_fieldservice.sql` | `subcontractor_agreements` + `subcontractor_certificates` + `retention_accounts` + `progress_certificates` + `service_visits` + `ias23_capitalizations` (+ the rate-register config row) + THE DATA-ONLY grants block |

All four: tenant_id prefix + RLS policies (the A1–A10 law), Drizzle
mirrors, `tables.registry.ts` +11 (307 → 318), ENTITY_CATALOG rows
(307 → 318), journal/manifest/spec pins to 103 with the chain re-proven
from zero at W-8 and at the full sweeps.

## 3. Task waves (the canon T-01…T-20; the global sequence continues at W-8 — §0a's reconciliation)

### W-0 — The owner's approval wave (T-00, orchestrator)
The approval dispatch's amendments recorded as §1a (the 046/047 pattern);
the clean-environment baseline at the then-current head (the 047 A-5
precedent — typecheck/lint/depcruise/unit/full DB suite/check:rls
scratch/i18n/drift/manifests/docs/id-ledger/secrets/capabilities/shells,
every log same-session); the standalone `check:rls` scratch-PG16 re-run;
the NF-9 verifier handoff (§0b's commands — the owner's independent
red/green confirmation on the delivered pair, or the W-8 fallback-arm
dispatch).
**Exit:** the plan APPROVED with amendments; the baseline envelope green.

### W-8 — The foundation (T-01 + T-02 + T-03 + T-04, orchestrator)
Migrations 0100–0103 + every mirror/registry/catalog/matrix/pin in ONE
increment (D-02's shapes; permissions 312 → 326 and ROUTE_PERMISSIONS
988 + n with dated notes — D-13; flags + manifests — D-16); **the NF-9
dedicated regression spec IF the owner's verifier dispatches the fallback
arm (§0b) — with the red/green protocol, the four-quarter logs, the F1
dated comments**.
**Exit:** acceptance #1 green (migrations + catalog rows + zero-drift);
the migration chain re-proven from zero; the full DB suite at the new
count.

### W-9 — The WBS + budgets + actuals engines (T-05 + T-06 + T-07, orchestrator)
The WBS API (tree, `detectCycle`, the weighted rollup — BR-095/D-03); the
budget cost-curve + vs-actual rollup (D-04); the four actual collectors +
the INV-033 reconciliation service (D-05).
**Exit:** acceptance #2's API arms + #3 green with evidence (the
rollup reconciles node-by-node; INV-033 holds to the cent).

> **[Dated 2026-11-20 (W-9 DELIVERED — on the owner-accepted W-8 head
> `916510f`, this session's fresh clone — the same-session evidence
> rule's SEVENTEENTH consecutive wave): the unit-first law opened the
> wave and caught three real scale bugs in the pure folds' first shape
> (fixed BEFORE any consumer landed — the 047 talent-math precedent
> repeating). T-05: the pure layer (detectDependencyCycle with the
> cycle path + wouldCreateParentCycle + the leaf-recomputed rollup fold
> with ONE rounding at the total + the curve's EXACT LCM interpolation +
> the distributor fold + the payroll read-only rate fold) + the WBS
> engine (both cycle guards before every write, the API the only move
> path; the project boundary; the children-first law; the rollup
> recomputed on every read) + 0100's write-time coherence on the time
> entries (the task ∈ the entry's project, never a guessed default).
> T-06: the budget lifecycle CAS + the DRAFT bulk-replace + THE
> ONE-APPROVED LAW (D-07) + the CELL LAW + the APPROVED curve ALONE (the
> pure exact fold) + the vs-actual rollup by type and node + the
> over-allocation WARNING as the read-side signal (0101's law). T-07:
> the four collectors (labor = the approved-class WBS-dimensioned
> entries × the payroll cost rates — D-01 read-only, the rate
> snapshotted at valuation, the unset divisor = UNPRICED never a
> fabricated rate; materials = the 044 WMS issue paths at the MOVE's own
> value via the posting's project stamp — the honest zero; subcontract
> = the APPROVED certificates' nets; overhead = the tenant-configured
> distributor over the pool accounts — the allocation postings credit
> the CLEARING account never the pool) + INV-033 the typed refusal at
> any residual. The settings keys `projects.labor_standard_monthly_hours`
> + `projects.overhead_distributor` (the D-02 config-row precedent,
> null-default + pin-neutral). ROUTE_PERMISSIONS 988 → 1007 (+19, dated
> at the block — the W-8 keys' first binding). The `__db__/projects/`
> family begins (15 + 13 arms; acceptance #2's triple agreement + #3's
> coherent world AC 10,945.3125 = the GL dimension exactly, every GL
> side through the real PostingService). Gates: the full DB suite
> 261/261 · 3,717/3,717 · 0 failed · 0 skipped in five family-whole
> chunks (the W-7 pattern) + the scratch check:rls 318/0 + every
> standing checker green (the evidence `audit-evidence/phase048-w9/` +
> the gate doc `docs/operations/gate-evidence/2026-11-20-phase048-w9.md`
> — the three honest disclosures recorded there: the unit-first catch,
> the chunking discovery, the command-cap + the true-up flake). Exit
> criteria MET. NOT production approval.]**

### W-10 — EVM + change orders + IAS 23 (T-08 + T-09 + the D-11 engine, orchestrator)
The EVM service (PV/EV/AC, CPI/SPI, EAC/ETC — D-06); the change-order
approval gate + G-58's exactly-once effects (D-07); the IAS-23
capitalization service over the WBS window (D-11 — REQUIRES_VERIFICATION).
**Exit:** acceptance #4 + #5 green (EV never exceeds the approved budget;
change orders inert until approved; the IAS-23 refusal arm proven).

> **[Dated 2026-11-20 (W-10 DELIVERED — on the owner-accepted W-9 head
> `e5efb29`, this session's working clone — the same-session evidence
> rule's EIGHTEENTH consecutive wave): the unit-first law opened the wave
> and caught the ×10² aggregate-percent scale bug in the pure fold's first
> shape (the weightedPct/weightSum ratio ALREADY sits at the percent's
> minor-2 scale — the W-9 rollup's own note; fixed before any consumer,
> the 5-of-37 first-run red kept in the session record). T-08: the EVM
> engine — PV EXCLUSIVELY from the approved curve (D-04's law through the
> budget service's own read); the TWO EV disciplines (the structural
> whole-tree aggregate × BAC from the EXACT rational — ONE rounding at
> money — and the certificate-gated latest APPROVED percent × BAC) with
> the delta the management signal; THE EV CEILING at every scope (the
> typed refusal; the boundary EV = ceiling legal, pinned on a real 100%
> node); AC from T-07's breakdown ALONE; BAC = the approved total + the
> APPROVED deltas only — the EVM's BAC EQUALS the gate's own ceiling read
> (one law, two engines); the per-node arm's honest shape (the node's own
> cells + the W-9 per-node rollup + the labor-leg AC; nodes without cells
> or labor absent, never zeroed; every honest cut disclosed). T-09: the
> gate — BR-094's DRAFT→SUBMITTED→APPROVED/REJECTED CAS ladder with the
> verdict stamps atomic; INERT until approved (the ceiling reads APPROVED
> rows only); G-58's exactly-once effects (the price delta through the
> REAL engine, DR/CR per the sign on the purpose-mapped CONTRACT_WIP/
> CONTRACT_REVISE pair — fail-closed PURPOSE_NOT_MAPPED until the tenant
> maps, the 038/0077 discipline, zero migration; the zero-delta order
> posts nothing and still consumes its stamp; the all-or-nothing rollback
> proven; the single-use stamp proven — exactly one entry, the ceiling
> unmoved); the ceiling RECOMPUTED on every read (the retention register
> + the deltas; BAC the same deltas — the gate the ONLY re-planning
> path); the postings carry NO project stamp (INV-033 untouched —
> pinned). D-11: the IAS-23 service — REQUIRES_VERIFICATION (the planted
> register's three typed refusals: unset · malformed · unverified); the
> WBS-schedule window; the approved-budget scope; the documented STOP
> RULES (the start law · the completion law · the elapsed/never-future
> law — the preview projects, the posting refuses asOf > today); the
> posting DR IAS23_QUALIFYING_ASSET · CR IAS23_BORROWING_COST at Σ
> capitalized (fail-closed until mapped; the 0011 shape CHECKs honored —
> `ias_capitalization` / `post_YYYYMMDD`, the honest finding disclosed);
> the single-use POSTED stamp on the (line, slice) rows. ROUTE_PERMISSIONS
> 1007 → 1007 + 11 = 1018 (dated at the block — evm.view ·
> change_order.view (the authoring — BR-094 makes it safe) ·
> change_order.approve (THE GATE) · the IAS-23 rides budget.view/manage,
> D-11's scope law). The `__db__/projects/` family grows: 9 + 7 + 10
> (+26; the fixture gains the probe-guarded ensureP1BudgetWorld — every
> W-10 spec standalone-runnable). Gates: the full DB suite 264/264 ·
> 3,743/3,743 · 0 failed · 0 skipped in BOTH envelopes (the single-
> process full run 554.04s WITHIN this session's cap — the W-9 machine
> had been killed at its 598s — AND the precomputed five family-whole
> chunks: the smoke 3·1,783 + the perf 6·24 + 86·644 + 85·672 (the
> projects family whole) + 84·620, the plan built + coverage-verified
> 264/264 BEFORE the first run) + the scratch check:rls 318/0 + every
> standing checker green (the evidence `audit-evidence/phase048-w10/` +
> the gate doc `docs/operations/gate-evidence/2026-11-20-phase048-w10.md`
> — the FIVE honest disclosures recorded there: the unit-first catch; the
> mistyped first chunk command (both envelopes kept — the accidental full
> run GREEN under the stamp's own truth); the family-order discovery +
> the test-only forward fix (the W-9 beforeAll's probe guard — its arms
> byte-identical); the 0011 shape findings corrected at the call sites;
> the four standalone/family/chunk/full envelopes). Exit criteria MET
> (acceptance #4 + #5 green with evidence). NOT production approval.]**

### W-11 — The contracting core (T-10 + T-11 + T-12, orchestrator)
Subcontracting (agreements + certificates + the AP linkage — D-08); the
retention ledger + G-55/G-56 through the engine (D-09); the
progress-certificate billing (G-57, the invoice generation, the advance
amortization, the BR-092/093 ceiling — D-10).
**Exit:** acceptance #6's posting arms + #7 green (the goldens' posting
shapes proven with their db specs; the ceiling's typed refusal).

> **[Dated 2026-11-20 (W-11 DELIVERED — on the owner-accepted W-10 head
> `8a3534c`, this session's working clone — the same-session evidence
> rule's NINETEENTH consecutive wave): the unit-first law opened the wave
> (the pure folds: BR-092's retention with ONE rounding and the 0103
> arithmetic floor BY CONSTRUCTION · BR-093's figures · the G-33-mirror
> amortization plan · G-56's gates; the first run caught the SPEC'S OWN
> hand-slip, corrected at the claim site). THE MIGRATION 0104 — the
> owner's clause-4 DECLARATION («ما لم تصرّح الموجة بغيره»): three
> additive stamp columns (the register's contract CUSTOMER · the AP
> linkage's journal · the advance amortization state), each anticipated
> by 0103's own note; no new tables — the catalog stays 318; the chain
> re-proven from zero twice. T-10: the agreements' CAS lifecycle (the
> ACTIVATION opens the agreement's SUBCONTRACTOR row — the SAME
> retention ledger) + the certificates (APPROVED terminal) + BR-092 per
> agreement + THE AP LINKAGE (the net obligation into AP through the
> REAL engine, PROJECT-STAMPED at exactly the collector's read — the
> approved extracts the SOLE actuals source, INV-033 green after EACH
> posting) + G-55's sub-side hold (the unprojected cost-family debit ·
> the SUBCONTRACT_RETENTION liability) + the single-consumption 0104
> stamp (the all-or-nothing rollback proven). T-11: the CUSTOMER
> register (ONE per project · the IMMUTABLE core — the change-order
> gate the only re-planning path) + G-56's release (the schedule gates
> · the single-use CAS · the customer mirror shape + the sub D-18
> literal shape). T-12: the ladder + BR-092 fail-closed + BR-093 AT THE
> STATUTE'S POSITION (the ChangeOrder gate's OWN ceiling read — one
> law, three engines; the typed refusal with ALL five figures, no
> silent truncation; the CO re-baseline through the REAL G-58) + G-57
> the fused billing + THE GENERATED-IN-TRANSACTION INVOICE + the
> advance amortization (the G-33 APPLY mirror, oldest-first). The
> presentation decision record documented (D-09's own law). ROUTE
> PERMISSIONS 1018 → 1038 (+20, dated at the block — the W-8 keys'
> third binding wave). The `__db__/projects/` family grows:
> `projects-contracting.db.spec.ts` (11 arms; P1's INV-033 unchanged at
> 10,945.3125). Gates: the full DB suite 265/265 · 3,754/3,754 · 0
> failed · 0 skipped in BOTH envelopes (the precomputed five
> family-whole chunks — coverage-verified BEFORE the first run — AND
> the single-process runs: 546.25s with ONE named timing flake
> (re-proven standalone 21/21) then the RETRY GREEN at 552.58s; the
> time ceiling COMPUTED before committing: projected ~555s) + the
> scratch check:rls (the 104-chain from zero · 318/0) + every standing
> checker green (the evidence `audit-evidence/phase048-w11/` — 26 files
> — + the gate doc `docs/operations/gate-evidence/
> 2026-11-20-phase048-w11.md` — the SIX honest disclosures recorded
> there). Exit criteria MET. NOT production approval.]**

### W-12 — Field service + the web plane I (T-13 + T-14, orchestrator)
The dispatch board API (the status machine, the SINGLE clock service with
pause states, BR-096's escalation — D-12); the `/projects` WBS board +
Gantt-ish timeline + the EVM tab (the 12-template discipline, RTL, ⌘K).
**Exit:** acceptance #8's API arms green (the SLA test matrix); the WBS
board renders the tree/dependencies/%-complete (acceptance #2's web arm).

### W-13 — The web plane II + the print pack (T-15 + T-16, orchestrator)
The `/projects/contracting` screen (certificates, retention, change
orders, subcontracts); the `/projects/fieldservice` dispatch board; the
three bilingual print templates (progress certificate, subcontractor
certificate, retention statement — AR/EN with RTL correctness); i18n
parity extended (D-14).
**Exit:** acceptance #9's screen/print/i18n arms green.

### W-14 — Reports + proof (T-17 + T-18, orchestrator)
The four report contracts (110 → 114, all pin sites together — D-15);
the golden tests G-55…G-58 with failure packs + the INV-033 test + the
IAS-23 golden; the RLS attack tests A1–A10 on all new tables; the OA-06
EXPLAIN budgets (D-17).
**Exit:** acceptance #6's golden transcripts + #9's RLS/OA-06 arms green.

### W-15 — Docs + gates + closure (T-19 + T-20, orchestrator)
The canon docs (JOURNAL_RULES G-55…G-58 + ACCOUNTING_INVARIANTS INV-033 +
BUSINESS_RULES BR-092…096 in the D-18 wordings + ENTITY_CATALOG +
REPORT_CATALOG + NAVIGATION_MODEL + the crm-projects tables doc); the
ID_LEDGER flip (G-55…58 · INV-033 · BR-092…096 → implemented); the FULL
GATE SWEEP at the final head (the full DB suite at the new count); the
completion report + the triple flip + the archive (OA-07,
`ERP_PLATFORM_PHASE048.zip`, byte-verified members) + the tag
**`phase/048`** on the W-15 delivery commit (§1a (c) — RULED).
**THE ARCHIVE'S ADDITIVE-ONLY LAW (§1a (c)'s binding condition, VERBATIM):
«الأرشيف» في W-15 إضافي فقط — إنشاء أدلة وملفات جديدة، ولا نقل ولا حذف
ولا إعادة تسمية لأي دليل قائم** — the archive step creates NEW
directories and files ONLY; NO moving, NO deleting, NO renaming of ANY
existing directory.
**Exit:** acceptance #10 green; PHASE-048 COMPLETE.

## 4. Test matrix (the permanent suites)

- **Unit (pure, first):** `detectCycle` (the WBS dependency graph); the
  weighted rollup fold; the EVM arithmetic (PV/EV/AC, CPI/SPI, EAC/ETC,
  the EV-ceiling refusal); the SLA clock's pause-aware arithmetic; the
  advance amortization schedule; the budget cost-curve interpolation.
- **DB specs (the `__db__/projects/` family, the hr precedent):**
  `projects-wbs.db.spec` (the tree, cycles rejected, the rollup
  reconciling node-by-node), `projects-budgets-actuals.db.spec` (the
  cost curve + the four collectors + INV-033 to the cent),
  `projects-evm.db.spec` (the two EV disciplines + the forecast),
  `projects-change-orders.db.spec` (inert-until-approved + the
  exactly-once delta), `projects-contracting.db.spec` (subcontracts +
  retention + certificates → invoices + the ceiling + the advance
  amortization), `projects-fieldservice.db.spec` (the dispatch board +
  the SLA matrix with pause states + escalation),
  `projects-goldens.db.spec` (G-55…G-58 with failure packs + the IAS-23
  golden + INV-033), `projects-rls.db.spec` (A1–A10 × the new tables),
  `projects-explain-budgets.db.spec` (D-17), the migration chain spec
  extended to 103.
- **Web:** the three families' render + parity + flag-gating specs; the
  print-template specs (AR/EN + RTL).

## 5. Gate list (the exit bar — same as 043–047, no relaxations)

typecheck 8/8 · lint 8/8 · depcruise clean (the fresh-clone count
re-baselined at W-0; the environmental-delta disclosure law) · unit 8/8
packages · **the full DB suite green at the new count** (259 + the new
files) · docs:validate green (extended for the new canon rows) · i18n
parity **6,433+n = 6,433+n** (+ mobile 371) · permissions drift **312 →
326 = 326** · manifests 13/13 · id-ledger 0 errors + self-test OK
(G-55…58 · INV-033 · BR-092…096 flipped at W-15) · history-secrets 0 ·
`check:rls` clean at 318 · OA-06 budgets green (D-17) · the standing
checks (boundary-negative, shells, capabilities) per the 047 gate table ·
**every evidence log through the capture wrapper (the vitest summary
guard — never the W-3-era wrapper shape, §0b's note) · the exact
commit count declared at every delivery · same-session evidence only.**

## 6. Governance red lines (carried, unchanged — plus the dispatch's conditions as laws)

1. One phase per run; the phase doc is the contract; out-of-scope is
   prohibition.
2. Doc precedence (ARCHITECTURE_BASELINE + ADRs + CD-01…12); discrepancies
   recorded, never silently rewritten.
3. Never weaken: tenant isolation (RLS), the posting-engine monopoly,
   INV-001…032 (…033 at delivery), auditability — every G-55…58 posting
   rides the engine with registered source keys under INV-013
   idempotency.
4. No binary floating point for money (ADR-0009) — budgets, certificates,
  retention, EVM figures, the IAS-23 split.
5. No fabricated compliance content (BR-055 family): the retention %
   comes from the contract (BR-092); the IAS-23 rate register is
   REQUIRES_VERIFICATION tenant DATA; SLA targets are tenant-configured
   with documented fail-closed defaults.
6. **The F1 literal-truth law:** every record claim — counts, paths,
   attributions — verified against the artifact before it is written;
   dated corrections at the original claim site when found (this plan's
   §0a reconciliation is itself an F1 act).
7. **The same-session evidence rule** (fourteen consecutive waves and
   counting) + the scope-label law (claim only the affected surface; the
   full DB suite re-runs on migration/schema changes — W-8 and W-15 run
   it; the mid waves run their folders).
8. **The OA-06 assertion law (the W-9 ruling):** probes assert the stable
   index-driven law, accept the planner's legitimate paths, log the
   observed plan verbatim — never force a plan, never isolate the
   context.
9. The evidence-log capture convention (NF-3/NF-4, structurally through
   `scripts/capture-evidence.sh` with the W-6 vitest summary guard —
   §0b's live re-proof at the W-3 head recorded).
10. **THE CONSTANTS LAW (the dispatch's condition 3):** migrations
    integrate from 0100 — no renumbering, no touching any published
    migration; the routes ledger's every change carries a dated note (the
    979 baseline anchor; current 988); ENTITY_CATALOG appends (307 now,
    +11 at W-8); **no evidence archiving or deletion — the full envelope
    at every delivery**; **ALL TAGS immutable** (`phase/046` @
    `4ddb39f` · `phase/047` @ `5b73bd1` — دائم لا يُمسّ).
    **[Dated 2026-11-19 (the §7-rulings dispatch, §1a (c)) — the
    archive's ADDITIVE-ONLY law, now part of this red line verbatim:
    «الأرشيف» في W-15 إضافي فقط — إنشاء أدلة وملفات جديدة، ولا نقل
    ولا حذف ولا إعادة تسمية لأي دليل قائم. The W-15 archive step
    creates new directories and files only; no moving, no deleting, no
    renaming of any existing directory.]**
11. **THE DELIVERY LAW (the dispatch's condition 4):** every delivery
    declares its commit count precisely; evidence from the same session
    only; the owner's independent verification runs on fresh clones.
12. **THE NF-9 REGRESSION PROTOCOL LAW (the dispatch's condition 2 + its
    special verification note):** a regression test that does not go RED
    on the pre-fix code is not accepted no matter how green after — the
    red-on-`7d22c49` proof is the acceptance bar, with the four-quarter
    logs (NF-7) and the F1 dated comments at every modified site.

## 7. Open inputs for the owner (the four §7 rulings received 2026-11-19 — §1a; (d) executes now)

> **RESOLVED 2026-11-19 (the §7-rulings dispatch — §1a): (a) = RULED
> (the boundary adopted; the tag stands — DELIVERY not ACCEPTANCE; the
> forward-fix law); (b) = CONFIRMED (W-8…W-15); (c) = RULED with the
> binding ADDITIVE-ONLY condition (stated verbatim at §1a (c), W-15, and
> §6.10's dated extension). (d) executes now — the owner's own clean-clone
> protocol re-run decides the (d4) arm's exemption and condition 2's
> final checkmark.**

- **(a) THE 047 BOUNDARY + THE TAG RULING (§0a):** ~~confirm or dispatch
  a ruling~~ **RULED 2026-11-19 — §1a (a): adopted as declared; the tag
  stands as DELIVERY (W-4…W-7 pending acceptance; defects fixed forward
  in 048's waves; no tag or published-item touching).**
- **(b) THE WAVE NUMBERING (§0a):** ~~confirm or override~~ **CONFIRMED
  2026-11-19 — §1a (b): W-8…W-15 stand as proposed.**
- **(c) THE CLOSURE TAG:** ~~proposed, confirm at approval~~ **RULED
  2026-11-19 — §1a (c): `phase/048` on the W-15 delivery commit, WITH
  the binding ADDITIVE-ONLY archive condition (verbatim in §1a (c)).**
- **(d) THE NF-9 VERIFIER PROTOCOL (§0b):** the delivered pair (the
  `starts_with` fix + the (d4) adversarial arm in `83362ff`) satisfies
  the red/green protocol — pre-verified this session with the exact
  verifier commands recorded. **The owner's own re-run executes now**
  (§1a (d)): literally 1 failed | 9 passed, (d4) by name, exit 1, no
  other failure — number by number — then green at `0926a74` → 10/10.
  The (d4) arm's battery permanence facts are stated at §0b's dated
  note (the EXEMPTION branch per the owner's criterion); if the red
  does not reproduce for any reason, the protocol is REJECTED and the
  blocking-ness returns fully to W-8 (the dedicated-spec fallback arm).
- **(e) Standing owner inputs carried (unchanged, not 048 blockers):**
  §7(b)'s three PHASE-045 final-audit remarks (text awaited, never
  fabricated); PHASE-043's hard review + RISK-031/RISK-032 OPEN; the
  register's exactly two narrowed items (SANED 15,000 + EOSB M/51
  Art. 84); the 045 self-board Tabs defect (the owner dispatches);
  **NOT production approval.**

**The implementation waves are BLOCKED until (1) the owner's
verification succeeds and (2) the approval dispatch issues** (the
authorization's condition 1 + the §7-rulings dispatch's fourth section —
approval may carry further binding dated amendments). PHASE-047 stands
COMPLETE at `5b73bd1` (W-0…W-7 delivered; W-4…W-7 pending the owner's
independent verification alongside this plan).
