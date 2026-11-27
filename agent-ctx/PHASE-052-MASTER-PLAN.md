# PHASE-052 Master Plan — Workflow & Approvals Engine (محرك سير العمل والموافقات)

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-052.md`
(T-01…T-16 are the canon task spine; this plan keeps those numbers and adds T-00).
Register: CR-22 · Wave 3 / Stage 14 — **the OPENING phase of Stage 14 (Platform
Depth)**; the Stage-13 release gate (CR-38) was checked and recorded at the 051
closure before this phase opens.

Authority chain: PHASE-052.md → [CR-22](../docs/planning/COMPLETENESS_REGISTER.md)
→ the delivered baseline (the document lifecycle DRAFT → PENDING_APPROVAL →
APPROVED → POSTED across modules · the `approval_policies` + `manual_journals`
single-step model with BR-034 SoD · the PHASE-036 custom-fields core (the
branch-condition substrate) · the PHASE-041 communications hub (the email leg) ·
the pg-boss scheduler + the standing sweeps · the notifications inbox with its
category union · the HMAC token derivations (the cursor/device precedents) · the
RLS isolation substrate · the AR/EN i18n discipline · the ⌘K palette · the
045/048/050/051 board and data-slot conventions) → the ID_LEDGER's 052
reservations (**G-67 · INV-037 — NO BR reservation for this phase**, re-coordinated
2026-11-13 per the ledger's own note) → this plan.

**Status: PROPOSED (2026-11-27, this session — per the owner's PHASE-052 launch
dispatch «طيب ابدأ تنفيذ المرحلة PHASE-052 وعند الانتهاء من أي خطوة ادفعها إلى
المستودع»: the master plan is the FIRST deliverable, sent FOR REVIEW BEFORE
LAUNCH — سابقة 049-W0/050-W0/051-W0 — and NO CODE WAVE opens before the owner's
approval of it; the approval is a launch authorization, NEVER production
approval; تسليم لا قبول).** This plan's evidence envelope:
`audit-evidence/phase052-plan/` (every log same-session, the FIFTY-FOURTH
consecutive wave — the owner's standing record counts fifty-three consecutive
same-session waves through the 051 closure: the 051-plan wave the forty-fourth,
W-33…W-42 the forty-fifth through the fifty-third; this wave is the next of
them). **The dispatch's standing orders carried verbatim: «عند الانتهاء من أي
خطوة ادفعها إلى المستودع» (every completed step pushed at its own commit) ·
«تسليم لا قبول» — delivery, never acceptance, never production approval —
binds this plan and every wave it governs.** The 051 completion report §5
handoff is THIS PLAN'S DECLARED BASE (§0b): the change orders (048) and the
duty drawback claims (051) are the FIRST documents to bind multi-step chains —
the drawback ladder DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED is
the register's own ready-made chain. The continuity rules are carried as §0c;
the reservations law — «لا كتابة خارجها» — is carried as red line §6.16.

## 0a. THE LOCAL = REMOTE VERIFICATION (the standing law — this session's FIRST act, before the first line)

The owner's standing law from the 049 program: «البعيد مصدر الحقيقة الوحيد،
وكل موجة تبدأ بالتحقق أن المحلي = البعيد قبل أول سطر» — the remote is the
single source of truth, and every wave begins by verifying local = remote
before the first line. **This session executed exactly that, first:**

- **The remote verified first:** `main @ c5175ffb3b0e…` = the tag `phase/051`
  (annotated `38b444e` peeling to `c5175ff` — the W-42 archive head, the
  owner's launch dispatch base exactly as reconciled — the closure completed
  with the archive `ERP_PLATFORM_PHASE051.zip` and the full sweep 315 · 4,486);
  `phase/050` @ `01f61a7` (annotated `76dda77`) · `phase/049` @ `41c3701`
  (`1fd74e9`) · `phase/048` @ `ba459ff` (`d46fa87`) · `phase/047` @ `5b73bd1`
  (`90fd428`) · `phase/046` @ `4ddb39f` (`88568da`) in place, untouched —
  **the five annotated predecessors' six identifiers + the 051 tag intact**
  (the owner's standing rule, to be re-proven by this session's history-secrets
  run: all SIX anchors walked, 0 violations).
- **THE WORKING TREE RECONCILED TO THE REMOTE** (this sandbox's recovery, the
  ninth environment reset, disclosed): the sandbox carried a STALE working
  copy (the 050-W26-era tree with no git metadata of its own — the sandbox's
  checkpoint system is a separate outer repo with UUID-message commits, never
  the project's history). The recovery: `git init` in the working tree +
  `git remote add origin <the GitHub remote, kasem520000/ERP_Sys>` +
  `git fetch origin main --tags` + `git reset --hard origin/main` — **HEAD =
  the remote HEAD = `c5175ffb`, the tree clean at HEAD: ZERO content
  differences, ZERO missing files, ZERO untracked leftovers** (the only
  ignored entries the session's own fresh `node_modules`). The git-tracked
  evidence-log census re-counted this session: **1,699 tracked files across
  the 74 delivered evidence directories** — every prior wave's logs present,
  no snapshot loss this session; this wave's own directory the 75th,
  additive only.
- **Env-prep (this session's environment recovery, disclosed):** node v24.22.3
  + pnpm 9.15.9 (corepack's `/usr/bin` symlink refused EACCES in this sandbox
  — pnpm installed via `npm i -g pnpm@9.15.9`, the exact pinned version) +
  the workspace install re-run (store-cached, 24.3s); the embedded-PG16
  binaries present with the install (the DB smoke probe green this session:
  the 126-chain boot from zero, 3 files · 1,999 tests, VITEST_EXIT=0); **the
  chromium 1248 shells provisioned BEFORE the runs (the same dated disclosure
  as the 051-plan wave: this sandbox's playwright cache carried only the 1200
  pair — playwright-core@1.64.1's own browsers manifest requires 1248; both
  pairs now provisioned)** — 0 skipped on every run below.
- **THE LAW STANDING FOR EVERY 052 WAVE:** each wave's first act — before any
  edit — is the local-vs-remote verification (the fetch, the HEAD comparison,
  the clean-tree check), recorded in that wave's gate record (عرف 049 option
  (a) carried: the evidence README is the wave's gate record;
  `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-052 is the accumulation
  place). A wave never opens on an unreconciled tree.

## 0b. The owner's 051 closure + THE PHASE-052 LAUNCH DISPATCH (the declared base — carried into every wave)

The 051 program closed **PHASE-051 as DELIVERY** at the tag `phase/051` @
`c5175ff` — W-33…W-42 delivered under the owner's standing push-each-step
order, the closure report recording the phase's final constants (the chain
126 · the drift 357 · ROUTE_PERMISSIONS 1,215 · the report registry 126 ·
ENTITY_CATALOG 354 · the DB suite 315 · 4,486 · the unit ledger 184 · 2,161 ·
i18n 7,582 + mobile 371 · depcruise 2,278 · 17,039 · implemented G 66 · INV 36
· BR 108) and the one honest build catch disclosed (the first zip build's
shared cat-file stream desync — caught by the additive-only verification
itself, the build redone, all 4,722 members byte-identical).

The dispatch then launched PHASE-052 with the master-plan-first law (سابقة
049-W0/050-W0/051-W0) and **the 051 completion report's §5 handoff stands as
the declared base — binding on this plan:**

1. **The exemplar documents:** the change orders (048) and the duty drawback
   submissions (051) are the FIRST documents to bind multi-step approval
   chains — the drawback ladder DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED |
   REJECTED is the register's own ready-made chain (this plan's D-05 consumes
   both).
2. **The vocabulary reconciliation (the phase doc ↔ the delivered code):** the
   phase doc's "DRAFT→SUBMITTED and siblings" is the gap-analysis vocabulary;
   the platform-wide approval state is **`PENDING_APPROVAL`** (DOCUMENT_LIFECYCLE
   §2) — the engine's trigger event binds each doc type's OWN submit-transition
   status, never a parallel vocabulary (D-05's mapping law).
3. **The Stage-13 gate:** CR-38 checked and recorded at the 051 closure —
   Stage 14 opens with this phase.

## 0c. The continuity rules (the owner's standing list — carried verbatim, binding on all 052 waves)

1. **Same-session evidence:** fifty-three consecutive waves through the 051
   closure; this plan wave is the **FIFTY-FOURTH**; every evidence log in
   `audit-evidence/phase052-*/` is this session's own run — never inherited,
   never replayed from cache (the typecheck cache-hit class is replaced with
   the force/plain re-run and disclosed).
2. **Prior isolation + the two-headed protocol:** the pre-isolation mandate
   (the time-sensitive isolates run standalone BEFORE any heavy envelope in
   every DB wave) + the two-head protocol at every flake appearance (both
   heads re-proven, ALL logs kept, the disclosure at the claim site) — the
   standing isolate set for 052's first DB wave: soak · fcm · email · the
   cmms sweep · the quality calibration sweep · the trade expiry sweep (the
   051 sixth) + **the workflow escalation sweep when it ships (W-45 — the
   SEVENTH standing isolate)**.
3. **The six identifiers + the tags protected:** the five annotated
   predecessors' six identifiers (`phase/046` = `88568da`→`4ddb39f` ·
   `phase/047` = `90fd428`→`5b73bd1` · `phase/048` = `d46fa87`→`ba459ff` ·
   `phase/049` = `1fd74e9`→`41c3701` · `phase/050` = `76dda77`→`01f61a7`) +
   the 051 tag (`phase/051` = `38b444e`→`c5175ff`) — دائمة لا تُمسّ; every
   history-secrets run samples all SIX anchors; every wave's §0a verifies
   them.
4. **The cumulative archive law:** أرشفة الأرشيف ممنوعة — the standing zips
   are never re-zipped; the evidence archive is ADDITIVE-ONLY (new files
   only; no moving, no deleting, no renaming of any existing evidence
   directory).
5. **RISK-033 at EIGHT incidents:** ZERO new across 051 (W-33…W-42); the
   register row stays OPEN and **closes only by the owner's order** — never
   a closure criterion for 052; any new appearance is named, root-caused,
   two-head re-proven, and counted at the claim site.
6. **The standing recalls, as transferred in the 051 completion report §4
   (never restated narrower, never folded):** **the 043 hard review OPEN** ·
   **RISK-031/032 OPEN** · **the §7(b) remarks** · **the register's
   exactly-two narrowed items (SANED 15,000 + EOSB M/51 Art. 84)** · **the
   045 self-board Tabs defect** (the owner dispatches; every 052 board is
   immune — the data-slot shape) · RISK-033 at eight.
7. **The standing reservations: G-67 · INV-037 — لا كتابة خارجها** (red line
   §6.16): the 052 program allocates NO golden or invariant identifier
   outside these two, and NO business-rule identifier at all (the ID_LEDGER's
   052 row carries no BR reservation — the phase's business laws are the
   phase doc's own conditions, never new canon identifiers); the ID_LEDGER's
   reserved wordings are the canon the closure wave writes; the checker's
   probe-7 fixture stands at G-64/PHASE-051 (claimant PHASE-052 at the flip —
   the W-15 precedent's eighth move, to G-67/PHASE-052 with claimant
   PHASE-053).

## 0. Inputs consumed (the plan-first reads — one focused pass over the `c5175ff` head, 2026-11-27, this session)

- `docs/implementation/phases/PHASE-052.md` (spec §1–§8 — T-01…T-16, the six
  tables, the +9 keys, the five flags, the ~180 i18n keys, the two report
  contracts, the three screens) · COMPLETENESS_REGISTER CR-22 · the gap
  analysis: ERP_FULL_GAP_ANALYSIS §2 (H-14) + §16 (**W-01…W-12**) + §20
  (UX-13) + §28 (PP-17) · ID_LEDGER row 49 (052 = G-67 · INV-037, no BR —
  re-coordinated 2026-11-13: the original plan's G-68/INV-036 predate the
  044 wave's consumption of those slots).
- The 051 delivery records: the completion report **§5 handoff** (the declared
  base — §0b above) + the 051 master plan (the wave/gate/red-line pattern this
  plan inherits) + `agent-ctx/NEXT_ACTION.md` (the closure's own triple flip —
  PHASE-052 the next eligible phase).
- Code research (this session, read-only): the `approval_policies` substrate
  (0010's table + BR-034's modes `none|single-approver|two-step|
  amount-threshold` + the SoD default-OFF law + `manual_journals`' own
  `approval_step` — the ONLY step column in the platform, 0011) and its
  consumers (`JournalService.submit/approve` · the L10 config engine's
  `policy.changed` invalidation hook — the cache hook the engine reuses);
  the per-document lifecycle surfaces (the typed state errors + the stamp
  columns + the audit-first law; the vocabulary map: treasury/purchasing/
  sales/journals/payroll/budgets on `PENDING_APPROVAL`, the 048/051 registers
  on `SUBMITTED`); the pg-boss sweep pattern (the `quality-calibration-due`
  + `trade-expiry-sweep` precedents — the clock law, the structural dedupe,
  the entitlement gate, the audit seal, the cron ladder with the 05:30 crm
  slot the last taken); the HMAC token derivations (`keyMaterialForTokens`
  — one identity secret, three derivations; the `sync-cursor` HMAC + the
  `device_refresh_tokens` one-time storage precedents); the notifications
  inbox (the 19-member category union at 0123 + the SHARED-SCOPE UNION LAW +
  the email/push legs); the PHASE-036 custom-fields core (`findValuesForEntity`
  — the branch-condition reader, zero parallel computation); the permissions
  substrate (the matrix §3 law + the 0060 precedent — **`platform.*` is the
  never-tenant-assignable namespace**; the DATA-ONLY grants block pattern;
  drift 357 at 0122) + ROUTE_PERMISSIONS (1,215, the keys-seed-first law);
  the feature-catalog composition law (the `quality`/`trade` whole-module
  units + the `payroll.employees`-on-`platform.branches` substrate precedent);
  the web plane (the settings-screen pattern, the data-slot board shape, the
  NAV_ITEMS registry, the dictionaries' static parity); the report contracts
  (the `defineReport` kit + the D-18 all-pin-sites law); the six-pin table
  convention (SQL + journal + migrations.ts + Drizzle mirror + ENTITY_CATALOG
  + the RLS registry); the `config-events` bus (the tiny typed EventEmitter —
  no persistence; the `policy.changed` scope hook); the crm tasks surface
  (the reminder-sweep precedent); the mobile companion approvals affordance
  (the ONLINE-ONLY law — OFFLINE_CAPABILITIES_MATRIX row 16); the six tags.

## 1. Settled design decisions (from the plan-first reads — binding for all waves, amendable only by the owner's dated dispatch)

- **D-01 — THE HONEST MIGRATION SLOTS: 0127–0130 (+ the declared additive
  0131).** The phase doc's `0090…0093` predates the 037–051 programs and is
  stale by its own §4 note ("exact numbers are assigned at implementation
  time as the next free sequence" — the 048/049/050/051 D-02 precedent
  verbatim). The journal stands at 126 entries (idx 125,
  `0126_bonded_stock_moves_source` — verified this session); 052 integrates
  at **0127 · 0128 · 0129 · 0130** (idx 126–129), no renumbering, no
  touching any published migration (the constants law). **The declared
  additive slot 0131** (`workflow` joins BOTH notifications CHECK domains —
  the 20-member union, the shared-scope union law, ordered WITH the writer)
  lands in the ENGINE wave (W-44), never the foundation wave — the 0118/0123
  precedent: the widening migrates with the first writing code, never before
  it.
- **D-02 — THE SIX TABLES, FOUR SLOTS + THE BRIDGE SUBSTRATE:**
  `0127_workflow_definitions.sql` (`workflow_definitions` — the tenant
  definition register bound to a trigger entity + event, the `active` flag,
  the entry `conditions` jsonb, the immutable per-instance snapshot source,
  the bilingual name; + `workflow_steps` — the ordered steps with type
  APPROVAL / NOTIFICATION / TASK, the assignee rule ROLE / USER / FIELD /
  FORMULA, the branch `conditions` jsonb on amount thresholds / department /
  the PHASE-036 custom fields, the per-step `sla_hours`) ·
  `0128_workflow_instances.sql` (`workflow_instances` — one per triggered
  document: the entity reference, the definition SNAPSHOT jsonb (the
  immutable capture at trigger time — the doc's own "immutable definition
  snapshot per instance"), the current-step pointer, the terminal state +
  stamps (INV-037's floor); + `workflow_step_instances` — the per-step state
  PENDING / APPROVED / REJECTED / SKIPPED / DELEGATED with the assignee,
  `delegated_to`, `acted_at`/`acted_by`, `comment`, the SLA `due_at`, and the
  TASK completion write-back — the complete step-history record the timeline
  renders) · `0129_delegations_escalations.sql` (`delegations` — the absence
  windows from→to with the scope module/entity/all; + `escalation_events` —
  the SLA-breach detections with the escalation/notification actions and the
  recurring reminders) · `0130_approval_policies_bridge.sql` (the bridge
  substrate: `workflow_definitions.origin_policy_id` — the nullable
  back-reference to the converted `approval_policies` row + the DATA-ONLY
  grants block §5 (D-03/D-04) — the 0122 pattern verbatim). **NO seventh
  table:** the TASK steps ARE `workflow_step_instances` (type TASK — D-11);
  the deep-link tokens are STATELESS (D-09) — no token table.
- **D-03 — THE NINE KEYS: `workflow.*`, NOT `platform.workflow.*` (the 0060
  precedent law — a dated deviation from the phase doc's §4 letter).** The
  house law (AUTHORIZATION_MATRIX §3.10 + the 0060 renaming precedent:
  `platform.imports.manage` → `configuration.imports.manage`) pins
  `platform.*` as the platform_admin-only, NEVER tenant-assignable
  namespace; the nine workflow keys are tenant-facing role keys. They ship
  as: `workflow.definitions.manage` (the chain editor) ·
  `workflow.approve` (the approve/reject act) · `workflow.inbox.act` (act on
  the inbox) · `workflow.delegate` (create one's own delegation windows) ·
  `workflow.history.view` (the timeline/step history) ·
  `workflow.escalation.manage` (configure escalation) ·
  `workflow.tasks.manage` (the document tasks) ·
  `workflow.delegations.manage` (administer all windows) ·
  `workflow.settings.admin` (the engine settings). **Drift 357 → 366
  (zero-drift from the first increment — the matrix §3.30 gets the workflow
  section, the seed at 0130 §5, both sides together).**
- **D-04 — THE FIVE FLAGS: the doc's five, the tenant namespace.**
  `workflow.engine` (the runtime engine + the bridge — the base unit) ·
  `workflow.definitions` (the chain editor plane) · `workflow.delegation` ·
  `workflow.escalation` · `workflow.tasks`. Composition (the catalog's own
  law): `workflow.engine` stands on `platform.branches` (the tenancy's own
  branch/user substrate — the `payroll.employees` precedent verbatim: the
  assignee resolution and the delegation windows ride the branch/user
  baseline, never a new substrate); the four planes compose `workflow.engine`
  (the `trade.lc`-on-`trade` pattern). **The grants: business + enterprise
  with STARTER AT THE DECLARED NEUTRAL ZERO** (the 050 precedent — the
  starter plan never carries the flags); NO industry-template manifest
  enablements (the engine is a HORIZONTAL capability — plan-gated, never
  template-gated; the capabilities matrix stays agreeing with zero delta).
- **D-05 — THE TRIGGER REGISTRY (the enumerated binding set + the vocabulary
  mapping law).** The engine binds FOUR exemplar surfaces through a
  documented WorkflowGateway contract (the `trade-order-gate` pattern — a
  plain-function module boundary, never a module coupling):
  **`manual_journals`** (the `approval_policies` consumer — the bridge's
  parity target, 0011's own `approval_step`) · **`purchase_orders`** (the
  acceptance scenario's own document: > 50,000 routes manager → finance →
  CEO, ≤ 50,000 stops at the manager — BR-010's threshold setting the
  successor surface) · **the 048 change orders** (the handoff's first
  exemplar) · **the 051 duty drawback claims** (the handoff's ready-made
  ladder). **The vocabulary mapping law:** the doc's "SUBMITTED" trigger
  event binds each doc type's OWN submit-transition status —
  `PENDING_APPROVAL` for journals/POs, `SUBMITTED` for the change orders and
  the drawback claims — never a parallel status vocabulary (the DOCUMENT_
  LIFECYCLE §2 sovereignty). Every doc type OUTSIDE the registry keeps its
  existing behavior byte-identical (the out-of-scope prohibition — the
  engine NEVER touches a surface it does not declare).
- **D-06 — THE CONDITION EVALUATOR (a pure fold, unit-first).** The entry +
  branch conditions evaluate a document context `{docType, amountBase
  (ADR-0009 4-dp string), departmentId, customFields (the PHASE-036
  `findValuesForEntity`/`findValuesForEntities` readers — zero parallel
  computation), the native fields the registry declares}` with short-circuit
  AND/OR groups; the operands: amount thresholds (compareExact — the
  BR-034 at-limit law), department equality, custom-field equality/range
  (the typed value store's own shapes); every malformed condition is a typed
  refusal naming the condition BY PATH (never a silent pass — fail-closed).
- **D-07 — THE DELEGATION LAW + G-67's ENFORCEMENT.** The windows:
  `from_user` → `to_user`, scope module/entity/all, `starts_at`/`ends_at`;
  **circular delegations are rejected at save** (the delegation-graph fold —
  the transitive closure walk; a window that would create a cycle is a typed
  refusal naming the chain). **The resolution at ACT time:** a PENDING
  step's assignee resolves through the ACTIVE windows at the moment of the
  act (the re-route; expired windows stop routing). **G-67 (the golden):**
  an actor cannot approve their own document through a delegation chain —
  directly or transitively: the EFFECTIVE actor (the delegation chain's
  terminal) is checked against the document's creator (the BR-034 SoD
  default-OFF discipline standing: `allowSelfApproval` never flips without
  an explicit tenant decision record); the chain walk is the pure fold's
  own transitive closure — the block names the chain and BOTH endpoints.
- **D-08 — THE ESCALATION SWEEP (the SEVENTH standing isolate).**
  `workflow-escalation-sweep` at cron **"45 5 * * *"** (the free window
  after the 05:30 crm slot — the nightly ladder's own discipline): the SLA
  breach detection over the PENDING step instances (`due_at` vs the DB's own
  clock — the CLOCK LAW verbatim), the `escalation_events` rows (reassign /
  add-level / notification actions per the step's config), the recurring
  reminders (the cadence from the settings registry), the STRUCTURAL DEDUPE
  (`workflow:sla:{stepInstanceId}:{kind}:{dueDate}` — the day axis the due
  date, the 0111/0123 axes law), the audit seal in the same ambient
  transaction (`workflow.escalation_sweep_run`), the entitlement gate (the
  `workflow.escalation` flag), the per-tenant catch-and-continue
  (degrade-the-feature-never-the-platform). **The sweep joins the standing
  isolate set from W-45 — every DB wave after it runs it standalone FIRST.**
- **D-09 — THE DEEP-LINK LAW (stateless HMAC + the CAS single-use).** The
  approve/reject links carry `${WEB_BASE_URL}/{locale}/workflow/act?token=…`
  where the token is the cursor-tokens pattern's FOURTH derivation from the
  one identity secret (`HMAC-SHA256` over `workflow-action:` + the
  base64url claims `{userId, instanceId, stepInstanceId, action
  approve|reject, deadline}` — the domain-prefixed derivation, never the raw
  session, never the session token embedded); **the one-time property is the
  step instance's OWN single-use CAS** (the `acted_at` stamp — the replay
  meets a non-PENDING step and takes the typed `WORKFLOW_STEP_ALREADY_ACTED`
  refusal); the expiry is the claim's own deadline (the typed
  `WORKFLOW_TOKEN_EXPIRED`); the wrong actor the typed
  `WORKFLOW_TOKEN_ACTOR_MISMATCH`; the comment captured with the act. NO
  token table (the CAS is the ledger); the mobile companion affordance
  stays ONLINE-ONLY (the OFFLINE_CAPABILITIES_MATRIX row 16 law — the
  approve act is never queued, never faked offline).
- **D-10 — THE EVENT BUS (the WorkflowEvent family — the 055 handoff
  surface).** The outbound events extend the `config-events` pattern (the
  tiny typed `node:events` EventEmitter — no persistence; the consumers act
  inside the emitting request's envelope; durable fan-out is 055's platform):
  `workflow.instance.started` · `workflow.step.assigned` ·
  `workflow.step.approved` · `workflow.step.rejected` ·
  `workflow.step.delegated` · `workflow.step.escalated` ·
  `workflow.instance.completed` · `workflow.instance.cancelled` — the topic
  list recorded in the completion report as the ingestion surface PHASE-055
  turns into public webhooks. The rules-engine alert adapters (UX-13) are
  BUS CONSUMERS (threshold/condition rules raising configurable alerts into
  the notifications inbox — never a parallel evaluation path).
- **D-11 — THE TASKS LAW (no seventh table, no crm coupling).** The TASK
  step type's tasks ARE `workflow_step_instances` (type TASK, the assignee,
  the `due_at`, the completion write-back = the step's own ACTED stamp); the
  task list is a query over the PENDING TASK steps (the inbox's tasks lane
  + the API's typed list); the crm reminder-sweep precedent is NOT consumed
  (no `crm_tasks` coupling — the workflow plane keeps its own rows; the
  crm module untouched).
- **D-12 — THE BRIDGE (the conversion + the compatibility mode + the parity
  proof).** The conversion tool maps every `approval_policies` row to a
  `workflow_definitions` row (the `origin_policy_id` back-reference) + the
  equivalent steps: `none` → no definition (the doc-type ungated — the
  mapping record's honest "no chain needed" row); `single-approver` → a
  one-step APPROVAL chain on the owner-role assignee rule;
  `two-step` → the two-step chain (the `manual_journals.approval_step`
  semantics verbatim); `amount-threshold` → the branch pair (≤ threshold
  the one-step chain, > threshold the two-step chain — the BR-034
  comparison law preserved). **The compatibility mode:** a document whose
  doc type has NO active workflow definition keeps the legacy path
  byte-identical (the `JournalService` verdicts untouched); an IN-FLIGHT
  document (submitted under the old semantics) finishes under the old
  semantics (the instance is never retro-created — the launch-time
  boundary recorded in the mapping); the parity test walks documents gated
  before/after the conversion (the same verdicts, the same stamps). The
  mapping table lands in the completion report (the doc's own §8 law).
- **D-13 — THE INV-037 LAW (the terminal immutability floor).** A terminal
  workflow instance (COMPLETED/CANCELLED) refuses every mutation — the
  service layer's typed `WORKFLOW_INSTANCE_IMMUTABLE` refusal (the state
  machine's own fold, the store's guard, the invariant test's RED/GREEN
  pair); the timeline renders the terminal record VERBATIM (the frozen
  history — PP-17's own audit checkbox).
- **D-14 — THE WEB PLANE (the data-slot shape + the form-first editor).**
  `/[locale]/settings/workflows` — the chain editor: a STRUCTURED form-first
  editor with visual ordering + the branch display (the doc's own risk
  mitigation — the free-canvas drag-everything editor is OUT, recorded as
  the scope note in the decision records); the approval inbox (the PENDING
  work with the aging indicators + the quick actions); the timeline
  component embedded on the bound document detail pages (the full step
  history: state, assignee, `delegated_to`, `acted_at`, comment — PP-17).
  Every board the DATA-SLOT SHAPE (never the Tabs primitive — the 045
  recall, every 052 board immune by construction); NAV_ITEMS +3 (the
  workflows settings · the approvals inbox · the tasks lane) with the ⌘K
  registration (OA-04); **i18n ~180 keys BY BOTH COUNTS (7,582 + n = 7,582
  + n, mobile 371 standing)**; the RTL verification (the AR-first law);
  the flag-gating (the five flags gate the surfaces; the permission-gating
  per D-03's keys).
- **D-15 — THE REPORTS (the two contracts, all pin sites together — the
  D-18 law).** `workflow.pending-approvals` (the inbox's own figures: the
  PENDING steps with the assignee, the age, the document drill) ·
  `workflow.sla-aging` (the escalation plane's own figures: the breaches,
  the reminders, the aging buckets) — registry **126 → 128**, the
  REPORT_CATALOG rows + the queries service (the engine's own reads, zero
  parallel computation) + the DB spec in the SAME increment.
- **D-16 — THE DOCS (the canon + the two decision records + the new
  surface doc).** `docs/accounting/BUSINESS_WORKFLOWS.md` — NEW (the engine
  semantics: the trigger registry, the condition evaluator, the delegation
  law, the escalation law, the bridge mapping — the DOCUMENT_LIFECYCLE
  sibling; docs:validate 33 → 34, the extended count declared) ·
  JOURNAL_RULES **G-67 + note 22** · ACCOUNTING_INVARIANTS **INV-037** (the
  canon rows in the ID_LEDGER's reserved wordings — لا كتابة خارجها) ·
  ENTITY_CATALOG (+6 rows) · REPORT_CATALOG (+2) · FEATURE_CATALOG (the
  five flags) · NAVIGATION_MODEL (+3) · the two decision records:
  `DR-052-01-workflow-bridge-policy.md` (the D-12 mapping + the
  compatibility mode) + `DR-052-02-workflow-step-types-scope.md` (the W-10
  scope note: the three step types ONLY, the free-form custom actions
  OUT — the platform note the phase doc itself records).

## 2. Migration inventory (the honest slots — journal ends at `0126`, idx 125; the fingerprint declared by design)

| Slot | File | Contents |
|---|---|---|
| 0127 | `0127_workflow_definitions.sql` | `workflow_definitions` (the trigger entity+event binding · the entry conditions jsonb · the active flag · the immutable-snapshot source · the bilingual name · `origin_policy_id` nullable) + `workflow_steps` (the order · the APPROVAL/NOTIFICATION/TASK type · the ROLE/USER/FIELD/FORMULA assignee rule · the branch conditions jsonb · the `sla_hours`) |
| 0128 | `0128_workflow_instances.sql` | `workflow_instances` (the entity reference · the definition snapshot jsonb · the current-step pointer · the terminal state + stamps — INV-037's floor) + `workflow_step_instances` (the per-step state ladder · the assignee + `delegated_to` · `acted_at`/`acted_by` + `comment` · the SLA `due_at` · the TASK write-back) |
| 0129 | `0129_delegations_escalations.sql` | `delegations` (the from→to windows · the module/entity/all scope · the active law) + `escalation_events` (the breach detections · the reassign/add-level/notification actions · the reminder cadence stamps) |
| 0130 | `0130_approval_policies_bridge.sql` | THE BRIDGE SUBSTRATE (the `origin_policy_id` FK back-reference + the bridge marker columns) + **THE DATA-ONLY grants block** (the 0098/0103/0108/0116/0122 §5 pattern: the NINE `workflow.*` keys 357 → 366 + the FIVE flags on business+enterprise at the declared neutral zero + the owner-template role grants) |
| 0131 | `0131_workflow_notifications_category.sql` — **the declared additive slot, LANDS IN W-44 WITH THE WRITER** | `workflow` joins BOTH notifications CHECK domains (`ck_notifications_category_values` + `ck_notification_prefs_category_values`) — the **20-member** shared-scope union, every member ever defined re-declared, ordered WITH the writer (the 0118/0123 law verbatim) |

**THE MIGRATION FINGERPRINT (declared by design — the owner's framework
item): the chain 126 → 130 at W-43 (→ 131 at W-44, the additive slot WITH
the writer); ENTITY_CATALOG 354 → 360 (+6 tables); the permissions drift
357 → 366 (+9 keys, D-03 — zero-drift from the first increment); the
notifications category union 19 → 20 (0131); ROUTE_PERMISSIONS 1,215 →
1,215+n dated (keys-seed-first, every change dated at the block); the
report registry 126 → 128 (W-49, all pin sites together); i18n 7,582 +
~180 declared per the surface wave (W-48 — the first surface wave declares
its delta BY BOTH COUNTS; mobile 371 standing) — the five feature flags
(`workflow.engine` · `workflow.definitions` · `workflow.delegation` ·
`workflow.escalation` · `workflow.tasks`) land with the keys at 0130 §5.**

## 3. Task waves (the canon T-01…T-16; the wave numbering — §7 (a))

### W-0 — The master plan wave (T-00, orchestrator) — THIS WAVE
The plan delivered for review with the same-session baseline envelope at
`c5175ff` (§5; the evidence `audit-evidence/phase052-plan/`); the
acceptance-criteria ledger OPENED with this plan
(`PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-052 — the owner's framework law: the
ledger opens with the plan and closes with the closure); NEXT_ACTION updated
+ the IMPLEMENTATION_STATUS dated header line prepended. **The implementation
waves are BLOCKED until the owner's approval dispatch** (the dispatch's own
boundary: الخطة للمراجعة قبل الإطلاق — إذن إطلاق فقط، وليست موافقة إنتاج).
**Exit:** the plan APPROVED with amendments (recorded as §1a on the
046–051 pattern); the approval head baselined if it moved.

### W-43 — The foundation (T-01 + T-02, orchestrator)
Migrations 0127–0130 + every mirror/registry/catalog/matrix/pin in ONE
increment (D-01/D-02's shapes; **+9 keys 357 → 366 — zero-drift from the
first increment (D-03; the matrix §3.30 + the 0130 §5 seed, both sides
together)**; the five flags + the plan grants — D-04; ROUTE_PERMISSIONS
stays 1,215 keys-seed-first with the dated note). **The pure folds FIRST
(the unit-first law):** the condition evaluator (D-06) · the instance/step
state machine (the PENDING/APPROVED/REJECTED/SKIPPED/DELEGATED ladder + the
INV-037 terminal fold — D-13) · the delegation-graph fold (the circularity
walk + the G-67 effective-actor transitive closure — D-07) · the SLA fold
(D-08) · the token fold (D-09's HMAC round-trip). The `__db__/workflow/`
family OPENS (the schema spec — every law refused BY NAME, the rejection
arms each in its own world). **The pre-isolation mandate carries: the SIX
standing isolates (soak · fcm · email · the cmms sweep · the quality
calibration sweep · the trade expiry sweep) run standalone before the
wave's DB envelope.**
**Exit:** acceptance #1 green (migrations + catalog 354 → 360 + zero-drift
366 = 366 + the RLS registry's six rows); the chain 126 → 130 re-proven
from zero TWICE; the full DB suite at the new count.

### W-44 — The engine core + the event bus (T-03 + T-07's bus half, orchestrator)
The WorkflowGateway documented contract + the four exemplar bindings
(D-05 — `manual_journals` · `purchase_orders` · the 048 change orders ·
the 051 drawback claims; the vocabulary mapping law); the trigger
resolution (the active definitions' entry conditions — D-06), the instance
+ step state machine (the snapshot capture, the assignment, the
PENDING/APPROVED/REJECTED/SKIPPED ladder), the **seeded conditional-chain
scenario** (the PO > 50,000 → manager → finance → CEO; ≤ 50,000 stops at
the manager; the PHASE-036 custom-field branch selecting a different
chain); **the `workflow` notifications category (the additive 0131 WITH
the writer — the 20-member union, both CHECK domains)**; the assignee
notifications (the inbox + the email leg on the 041 hub); **the
WorkflowEvent bus family (D-10 — the eight topics, the 055 handoff
surface)**. The DB spec: the engine end-to-end over the four bindings.
**Exit:** acceptance #2 green (the routing scenarios + the custom-field
branch); the chain 130 → 131; the category union 20 at both floors.

### W-45 — Delegation + escalation (T-04, orchestrator)
The delegation resolution (the windows, the scope, the act-time re-route)
+ **G-67's enforcement** (D-07 — the effective-actor walk, the typed block
naming the chain and BOTH endpoints; `allowSelfApproval` never flips
without the decision record) + the circularity rejection at save; the
`escalation_events` engine + **the `workflow-escalation-sweep` (D-08 —
the 05:45 cron, the clock law, the structural dedupe, the audit seal, the
entitlement gate, the per-tenant catch-and-continue) + the recurring
reminders (the cadence from the settings registry —
`workflow.escalation_reminder_hours` the typed key, fail-closed
defaults)**. **THE SWEEP JOINS THE ISOLATE SET FROM THIS WAVE (the SEVENTH
standing isolate).**
**Exit:** acceptance #3 (the re-route/expiry/circularity) + #4's
enforcement arms + #5 green (the SLA breach → the escalation row + the
actions + the reminders).

### W-46 — The bridge (T-05, orchestrator)
The `approval_policies` conversion tool (D-12's mapping: none → the honest
no-chain row; single-approver → the one-step chain; two-step → the
two-step chain; amount-threshold → the branch pair) + the compatibility
mode (the unregistered doc types byte-identical; the in-flight documents
finish under the old semantics — the launch-time boundary) + the parity
test (the documents gated before/after) + the mapping record (the
completion report's table).
**Exit:** acceptance #9 green (the parity + the in-flight completion).

### W-47 — Deep links + tasks + the rules alerts (T-06 + T-08 + T-07's rules half, orchestrator)
The signed one-time deep links (D-09 — the stateless HMAC fourth
derivation, the CAS single-use, the typed refusals
ALREADY_ACTED/EXPIRED/ACTOR_MISMATCH, the comment capture, the email leg
with the 041 templates); the TASK step type end-to-end (D-11 — the
assignment, the due dates, the completion write-back, the tasks lane);
the rules-engine alert adapters (UX-13 — the bus consumers raising the
configurable threshold/condition alerts into the notifications inbox).
**Exit:** acceptance #6 green (the one-time act + the replay/expiry
refusals) + the task arms + the alert arms green.

### W-48 — The web plane (T-10 + T-11 + T-12 + T-13, orchestrator)
`/[locale]/settings/workflows` — the chain editor (D-14's form-first
shape: the ordered steps, the branch conditions, the SLA, the assignee
rules — the visual ordering, never the free canvas) + **the approval
inbox** (the PENDING work, the aging indicators, the quick actions, the
tasks lane) + **the timeline component embedded on the four bound document
detail pages** (the full step history VERBATIM — PP-17) + NAV_ITEMS +3 +
the ⌘K registration + **i18n ~180 keys BY BOTH COUNTS (7,582 + n = 7,582 +
n, mobile 371 standing)** + the RTL verification + the flag/permission
gating. Every board the DATA-SLOT SHAPE.
**Exit:** acceptance #7 green (the timeline + the inbox, AR/EN parity,
RTL); the declared i18n delta green.

### W-49 — The reports (T-14, orchestrator)
**The two report contracts (registry 126 → 128, all pin sites together —
D-15):** `workflow.pending-approvals` · `workflow.sla-aging` (the queries
service over the engine's own reads; the DB spec in the same increment).
**Exit:** the report arms green (the catalog↔registry reconciliation +
the specs).

### W-50 — The proof pack (T-09, orchestrator)
**The G-67 golden transcript with the MANDATORY failure pack** (the
delegation chain's self-approval block — directly and transitively — with
the full payload, the zero residue, the flip-and-restore and the SAME act
GREEN through a clean chain; the 048-W14/049-W22/050-W31/051-W41 pattern)
+ **the INV-037 immutability golden** (the terminal instance's mutation
refusal — the service floor + the store guard + the RED/GREEN invariant
pair) + **the RLS attack matrix A1–A10 over the SIX tables** (the
generated suite over the registry's rows — D-19's 051 shape) + **the
OA-06 EXPLAIN budgets** (the instances' entity lookup + the step
instances' assignee lookup — the W-9 assertion law: the stable
index-driven law, never a forced plan).
**Exit:** acceptance #4's golden + #8 green — **#1…#9 ALL GREEN.**

### W-51 — Docs + gates + closure (T-15 + T-16, orchestrator)
The canon docs in the ID_LEDGER's reserved wordings (JOURNAL_RULES G-67 +
note 22 · ACCOUNTING_INVARIANTS INV-037 — **لا كتابة خارجها**: no
identifier outside the reservations enters the canon; NO BR section — the
052 row carries none) + `docs/accounting/BUSINESS_WORKFLOWS.md` NEW
(docs:validate 33 → 34, the extended count declared) + FEATURE_CATALOG +
NAVIGATION_MODEL + the two decision records (DR-052-01/DR-052-02) + **THE
ID_LEDGER FLIP** (atomic with the canon rows — implemented G 67 · INV 37;
the checker's self-test probe (7) moves to G-67/PHASE-052, claimant
PHASE-053 — the W-15 precedent's eighth move) + the full sweep at the
final head (the isolates first — the SEVENTH standing; the amended
ceiling law) + the completion report (the cumulative ledger walked and
closed + the battery scope map + the FULL unit-package table + the bridge
mapping table + the event-bus topic list handed to PHASE-055 + the
open-items log transferred explicitly) + the triple flip +
**THE ARCHIVE `ERP_PLATFORM_PHASE052.zip` EXACTLY AS DECLARED (§5 — the
archive-form acknowledgment executed)** + **the tag `phase/052`**
(DELIVERY, never acceptance — the §1a (a) ruling).
**Exit:** acceptance #10 green; the phase closed at the delivery head.

## 4. Test matrix (the permanent suites; the pre-isolation mandate carried)

- **Unit (pure, first — W-43):** the condition evaluator fold (the
  amount/department/custom-field branches · the short-circuit · the typed
  refusals naming the condition BY PATH · the BR-034 at-limit law); the
  instance/step state machine fold (the ladder · the terminal immutability
  · the typed refusals); the delegation-graph fold (the circularity walk ·
  the transitive resolution · the G-67 effective-actor closure); the SLA
  fold (the due computation · the breach detection · the reminder cadence);
  the token fold (the HMAC round-trip · the expiry · the binding). Property
  tests where the domain is a lattice (the graph walks, the state ladder).
- **DB specs (`__db__/workflow/`, the family OPENS at W-43):** the schema
  spec (every CHECK/unique/floor refused BY NAME — the rejection arms each
  in its own world, the RLS boundary rows) · the engine spec (W-44 — the
  four bindings end-to-end, the seeded chains, the custom-field branch, the
  snapshot capture, the notifications' first writes) · the
  delegation/escalation spec (W-45 — the re-route, the expiry, the
  circularity, the G-67 block, the SLA breach → the events + the
  reminders, **the sweep isolate standalone**) · the bridge spec (W-46 —
  the conversion parity, the compatibility mode, the in-flight completion)
  · the deep-links/tasks/alerts spec (W-47) · the reports spec (W-49) ·
  **the goldens + the RLS matrix + the EXPLAIN budgets (W-50 — the proof
  pack, the G-67 failure pack mandatory)**.
- **Web (W-48):** the screens' own tests (the editor's ordering law, the
  inbox's aging figures VERBATIM, the timeline's full history), the i18n
  parity BY BOTH COUNTS, the RTL verification, the flag/permission gating.
- **The standing battery:** every wave's gate record (§5) — the isolates
  standalone FIRST in every DB wave (the SEVEN from W-45), the affected
  folders at the delta head (the scope-label law), the full DB suite at
  W-43 and W-51 (the migration waves), the chain from zero TWICE at every
  migration wave.

## 5. Gate list (the exit bar — same as 043–051, no relaxations) + THE ARCHIVE FORM

typecheck 8/8 · lint 8/8 · depcruise clean (the fresh count re-baselined at
any environmental delta; the disclosure law) · unit 8/8 packages (the FULL
unit-package table in every closure report) · **the full DB suite green at
the new count — the isolates standalone FIRST (the SEVEN from W-45), the
coverage verified before the first run, every part INSIDE THE AMENDED
CEILING 570s, the declaration at the claim site before the run** ·
docs:validate green (33/33 → **34/34 at W-51**, the extended count declared
— the BUSINESS_WORKFLOWS intake) · **i18n parity BY BOTH COUNTS from the
first surface wave (W-48): every web wave declares its delta (7,582+n =
7,582+n) AND the mobile count (371 = 371)** · permissions drift **357 → 366
= 366 at every wave from W-43** · manifests 13/13 · id-ledger 0 errors +
self-test OK (the flip at W-51: implemented G 67 · INV 37) ·
history-secrets 0 (the SIX tag anchors verified untouched) · `check:rls`
clean at **360** · OA-06 budgets green (W-50) · the standing checks
(boundary-negative, shells, capabilities) per the 049/050/051 gate table ·
**every evidence log through the guarded wrapper (the vitest summary guard
— judge by the SUMMARY LINES, never the raw exit code, the NF-12 verdict
rule)** · the exact commit count declared at every delivery ·
same-session evidence only · **the local-vs-remote verification as every
wave's first act (§0a)**.

**THE 052 ARCHIVE FORM — DECLARED EXPLICITLY (the F-4/§0b pattern, the
049/050/051 physical shape):** the closure wave (W-51) delivers
**`ERP_PLATFORM_PHASE052.zip`** = **the git-tracked tree at the closure
head** — **FLAT (the PHYSICAL shape of 049/050/051: zero directory
entries), the commit-hash as the zip's FIRST ENTRY** · **THE ADDITIVE-ONLY
LAW** (every member byte-verified against the git blob at the closure
head) · **EXCLUDING every standing platform zip: أرشفة الأرشيف ممنوعة —
the zip never contains another zip; the EIGHTEEN standing zips
034_FINAL…051 verified untouched** · delivered with the tag
**`phase/052`** — DELIVERY, never acceptance (the §1a (a) ruling). **The
archive-form acknowledgment (إقرار شكل الأرشيف):** this is the whole of
the form — one zip, flat, the hash first, additive only, no nested
archives, the tag after the byte-verification; W-51 executes exactly this
and nothing else.

**This plan wave's own envelope (`audit-evidence/phase052-plan/`, every log
this session — the FIFTY-FOURTH consecutive wave):** the §0a record
(remote @ c5175ff = phase/051; the six tags' identifiers intact; the
zero-diff reconciliation; the evidence-log census) + the full battery at
the closure head's own constants re-proven (the figures in the wave's gate
record — a docs-only wave: the CODE tree stands at `c5175ff`
byte-identical, so the battery's constants are the 051 closure's own
figures re-proven).

## 6. Governance red lines (carried, unchanged — the 049/050/051 set + the reservations law)

1. One phase per run; the phase doc is the contract; out-of-scope is
   prohibition (webhook endpoint delivery/retries is 055's · BI alert
   surfaces 057's · the general form builder is 036's delivered designer ·
   free-form custom actions beyond the three step types OUT — the W-10
   scope note · BPMN import/export OUT · workflow versioning beyond the
   immutable per-instance snapshot OUT).
2. Doc precedence (ARCHITECTURE_BASELINE + ADRs + CD-01…12); discrepancies
   recorded, never silently rewritten.
3. Never weaken: tenant isolation (RLS), the posting-engine monopoly,
   INV-001…036 (…037 at delivery), auditability — the workflow engine
   GATES documents, it never posts: no workflow surface writes a journal
   entry (the chains gate the EXISTING submit/approve verdicts; the
   movements/postings stay their modules' own); the audit-first law at
   every transition (`workflow.*` audit actions, POLICY_ACTOR_ID never an
   audit actor).
4. No binary floating point for money (ADR-0009) — the amount thresholds
   ride the canonical 4-dp string comparisons (the BR-034 compareExact
   law); the reports' figures the engine's own reads.
5. No fabricated compliance content (BR-055 family): the delegation
   windows and the SLA configs are tenant DATA; the engine never invents
   an assignee (an unresolvable assignee rule is a typed refusal —
   fail-closed, never a fallback to the creator).
6. **The F1 literal-truth law:** every record claim — counts, paths,
   attributions — verified against the artifact before it is written;
   dated corrections at the original claim site when found.
7. **The same-session evidence rule** (fifty-three consecutive waves and
   counting — this wave the fifty-fourth) + the scope-label law (claim only
   the affected surface; the full DB suite re-runs on migration/schema
   changes — W-43 and W-51 run it; the mid waves run their folders).
8. **The OA-06 assertion law (the W-9 ruling):** probes assert the stable
   index-driven law, accept the planner's legitimate paths, log the observed
   plan verbatim — never force a plan, never isolate the context.
9. The evidence-log capture convention (NF-3/NF-4, structurally through
   `scripts/capture-evidence.sh` with the W-6 vitest summary guard; the
   NF-12 verdict rule — the summary lines, never the raw exit code).
10. **THE CONSTANTS LAW:** migrations integrate from 0127 — no renumbering,
    no touching any published migration; the routes ledger's every change
    carries a dated note (the 1,215 baseline anchor); ENTITY_CATALOG
    appends (354 now, +6 at W-43); **no evidence archiving or deletion —
    the full envelope at every delivery**; **ALL TAGS immutable**
    (`phase/046` · `phase/047` · `phase/048` · `phase/049` · `phase/050` ·
    `phase/051` — دائمة لا تُمسّ); the evidence archive ADDITIVE-ONLY.
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
    excludes the standing archives** — the 052 form declared at §5; the
    members byte-verified; the standing zips verified untouched.
16. **THE RESERVATIONS LAW (the ID_LEDGER's 052 row): G-67 · INV-037 — لا
    كتابة خارجها** — no golden or invariant identifier outside these two
    enters any 052 surface, spec, contract, or doc; **NO business-rule
    identifier at all** (the 052 row carries no BR reservation — the
    phase's business laws are the phase doc's own conditions, never new
    canon identifiers); the ID_LEDGER's reserved wordings are the canon.

## 7. Open inputs for the owner (ruled at the approval dispatch — the plan is BLOCKED until then)

- **(a) THE WAVE NUMBERING.** The standing no-collision law (the §1a (b)
  precedent: the global sequence, no renumbering) puts 052's implementation
  waves at **W-43…W-51** (W-33…W-42 exist in 051's delivered records; the
  split mirrors 051's own: the foundation · the engines · the bridge · the
  web plane · the reports · the proof pack · the closure — nine waves over
  T-01…T-16). This plan proposes W-43…W-51 as §3 divides them; the owner
  confirms or overrides to a phase-relative restart at approval — either
  way the LAWS bind from the first implementation wave whatever its number.
- **(ب) THE KEY/FIELD NAMESPACE RULING (D-03/D-04).** The phase doc §4's
  `platform.workflow.*` letter predates the 0060 law's consolidation
  (`platform.*` = the never-tenant-assignable namespace); the plan proposes
  the nine permission keys as **`workflow.*`** and the five feature flags
  as **`workflow.engine`/`workflow.definitions`/`workflow.delegation`/
  `workflow.escalation`/`workflow.tasks`** (the doc's five flags, the
  tenant namespace, the catalog's composition law). The owner may rule the
  exact names at approval — the drift target moves with the ruling either
  way (357 + 9 = 366 at the proposed shape).
- **(ج) THE TRIGGER BINDING SET (D-05).** The plan binds the FOUR exemplar
  surfaces (`manual_journals` · `purchase_orders` · the 048 change orders ·
  the 051 drawback claims — the 051 handoff's own declared base + the
  acceptance scenario's document). The owner may widen or narrow the set at
  approval; every doc type outside the ruled set keeps its existing
  behavior byte-identical.
- **(د) THE STANDING CARRIED ITEMS (never restated, never folded —
  transferred explicitly per the dispatch's list §0c (6))** and the
  reservations law §6.16 — **NOT production approval: the approval dispatch
  is a launch authorization only.**

**The implementation waves are BLOCKED until the owner's approval dispatch**
(the dispatch's own boundary: الخطة أولاً للمراجعة قبل الإطلاق — وليست
موافقة إنتاج). PHASE-051 stands COMPLETE at `phase/051` (W-33…W-42
delivered; the closure with the archive + the tag + the full sweep 315 ·
4,486); PHASE-052's plan is this document, its evidence envelope beside it,
its acceptance ledger OPENED, its archive form declared and acknowledged.
