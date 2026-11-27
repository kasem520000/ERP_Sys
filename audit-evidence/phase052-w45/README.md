# PHASE-052 W-45 (DELEGATION + ESCALATION) evidence — 2026-11-27 (T-04; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-45 steps 1–3
heads' tree (step 1 `c88dba2` — delivered at the prior session's
continuation head, verified by this session's re-proven battery · step
2 `6831f12` · step 3 `c8c51f6` — every step pushed at its own commit
per the owner's standing order «عند الانتهاء من أي خطوة ادفعها إلى
المستودع»; the same-session evidence rule, the FIFTY-SEVENTH
consecutive wave). The wave is the APPROVED PLAN's §3 W-45 under the
owner's launch authorization (إذن إطلاق ONLY, NEVER production
approval — تسليم لا قبول; the rulings (أ)–(د) carried; the
reservations G-67 · INV-037 — NO BR this phase — لا كتابة خارجها).

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ c8c51f6` (the W-45 step-3 head,
  pushed at its own completion; step 1 `c88dba2` and step 2 `6831f12`
  pushed at their own completions before it) · `phase/051` =
  `c5175ff` (annotated `38b444e`) · `phase/050` = `01f61a7` ·
  `phase/049` = `41b3701` · `phase/048` = `ba459ff` · `phase/047` =
  `5b73bd1` · `phase/046` = `4ddb39f` — **the five annotated
  predecessors' identifiers + the 051 tag intact** (re-proven by this
  session's history-secrets run: all SIX anchors walked, 0 violations).
- The working tree is this session's own continuation of the W-43/W-44
  sessions' environment (the tenth reset's recovery stands; the
  environment standing: node v24.22.3 · pnpm 9.15.9 · the workspace
  install · the embedded-PG16 16.14 binaries) — 0 skipped on every
  run below.

## The wave's acts (steps 1–3 pushed + this gate increment)

1. **STEP 1 — THE DELEGATION LAW + G-67'S ENFORCEMENT** (`c88dba2`):
   the delegation service (D-07's IO shell over the W-43 pure fold —
   the save-time circularity over the standing ACTIVE windows (the
   DB's own clock), the scope pair law typed, the window floors, the
   act-time resolution) + the engine's act path (the G-67 block
   naming the chain and BOTH endpoints; the actor law widened to the
   chain's terminal; the delegated_to provenance stamp).
2. **STEP 2 — THE ESCALATION ENGINE** (`6831f12`): the settings key
   `workflow.escalation_reminder_hours` (the typed registry row, the
   fail-closed default [24]) + the store's escalation plane (the
   DB-clock breach scan over the awaiting steps on ACTIVE chains +
   the structurally-deduped escalation_events insert) + THE
   ESCALATION SERVICE (the entitlement gate · the cadence read · the
   NOTIFY row + the owner-target breach notification + the
   workflow.step.escalated bus emission · the REMINDER plane (one row
   per step EVER at the first cadence crossing; the recurring surface
   the per-member inbox family to the assignee) · the audit seal) —
   with the declared interpretations recorded at the claim sites (the
   action vocabulary's honest boundary: NOTIFY + REMINDER only; the
   audiences; the recurring surface's shape).
3. **STEP 3 — THE SWEEP JOB** (`c8c51f6`): the
   `workflow-escalation-sweep` queue at cron `45 5 * * *` (05:45 UTC —
   the nightly ladder's free window after the 05:30 crm slot) + the
   per-tenant pass (the entitlement gate + the catch-and-continue) +
   the WorkflowModule registration — **THE SEVENTH STANDING ISOLATE**
   (soak · fcm · email · the cmms sweep · the quality calibration
   sweep · the trade expiry sweep · this).
4. **THE GATE INCREMENT** (this commit): the two DB specs + the
   wave's exit battery (this envelope) + the ledger's W-45 dated note
   (**ACCEPTANCE #3 + #4's ENFORCEMENT ARMS + #5 GREEN**) + the
   NEXT_ACTION + IMPLEMENTATION_STATUS dated headers.

## THE DELEGATION SPEC — workflow-delegation-escalation.db.spec, 8 arms ALL GREEN (acceptance #3's own proof + #4's enforcement arms)

The dedicated tenant TENANT_WFD (the workflow.engine entitlement);
every arm seeds its OWN world — its own users (manager · delegate ·
finance · creator), its own manager role + memberships, its own
journal + line + account, and its own definition discriminated by the
arm's own entry window on the journal's amount (the per-arm world
law; the arms' delegation windows never share users):

| Arm | The proof |
|---|---|
| (a) THE ACT-TIME RE-ROUTE | an active ALL window re-routes: the DELEGATE's approval lands with acted_by + delegated_to = the delegate (the assignee frozen — the provenance stamp) |
| (b) THE SCOPE LAW — ENTITY | a window scoped to purchase_order never re-routes the manual_journal step: the typed actor-law refusal, ZERO residue; the assignee's own act still lands (delegated_to NULL) |
| (c) THE SCOPE LAW — MODULE | the accounting-scoped window re-routes the journal step |
| (d) THE EXPIRY | the past-bounded window stops routing by construction; the returned manager acts directly |
| (e) THE SAVE-TIME CIRCULARITY | the candidate finance → manager over the standing manager → delegate → finance is refused naming the FULL closed chain [finance, manager, delegate, finance] + the no-self floor + the scope pair law (ALL-with-a-value and MODULE-without-a-value both refused typed); the register lists only the saved rows |
| (f) G-67 DIRECT | the creator-assignee's own approval: WORKFLOW_SELF_APPROVAL_BLOCKED, the chain of length one, BOTH endpoints himself, ZERO residue |
| (g) G-67 TRANSITIVE | the routed-back chain manager → delegate → creator: the creator's AND the manager's acts BOTH blocked (the chain's terminal is the creator regardless of the physical actor), the chain names BOTH endpoints, ZERO residue |
| (h) THE WINDOWS' REGISTER | the early end narrows the bounds (tenant DATA, never deleted); the resolution stops with the narrowed window |

## THE SWEEP ISOLATE — workflow-escalation-sweep.db.spec, 9 arms ALL GREEN (acceptance #5's own proof — THE SEVENTH standing isolate)

The dedicated tenants TENANT_WES (workflow.engine +
workflow.escalation, its own owner membership) + TENANT_WES_NOESC
(the engine ONLY — the entitlement gate's own world); every due_at
seeded from the DATABASE'S OWN now() inside the seed SQL (the clock
law on BOTH sides):

| Arm | The proof |
|---|---|
| (0) THE EMPTY PASS | the seal lands even when nothing breached — {cadence: [24], breached: 0, escalated: 0, notified: 0} + the audit row |
| (a) THE BREACH → THE EVENTS | the NOTIFY escalation_events row (the payload with the doc refs + the audience) + the owner's warning inbox record (the workflow category) + the bus workflow.step.escalated emission; the REMINDER NOT yet (2h breach vs the 24h cadence) |
| (b) THE REMINDER CADENCE | the 25h breach: the REMINDER row (payload {cadence: [24], crossed: [24]}) + the assignee's reminder at the per-member key `workflow:sla:{step}:REMINDER:24:{dueDate}` |
| (c) THE STRUCTURAL DEDUPE CONVERGENCE | the re-run inserts NOTHING — escalated 0, notified 0, the events and the inbox unchanged (re-runs, the nightly cron, and a raced concurrent pass all converge) |
| (d) THE CLOCK LAW | the future due (now() + 2h) never breaches — no event for it |
| (e) THE CUSTOM CADENCE | the tenant's [1, 2] governs: the REMINDER row (crossed [1, 2]) + TWO per-member reminders (each its own dedupe key — the recurring surface) |
| (f) THE FAIL-CLOSED GARBAGE | the garbage settings row `["garbage", null, 0, -5]` reads as the documented [24] — the reminders never silently disable |
| (g) THE PREFS GATE | the owner's in-app OFF: the escalation rows still land, the owner's record skipped, the run still seals; the prefs row removed → the next pass records again |
| (h) THE ENTITLEMENT GATE | the escalation-flag-off tenant: NOTHING — no events, no notifications, NO SEAL (there was no run to seal) |

## THE AFFECTED-FOLDER BATTERY (the mid-wave scope-label law — the full DB suite re-runs at the migration waves W-43/W-51; this wave runs its folders)

| Part | Files · Tests | Log |
|---|---|---|
| the workflow family (schema · engine · delegation/escalation · the sweep isolate) | 4 · 73 | `db-affected-workflow-family.log` |
| the inbox writer + the standing category arm (cmms-schema) | 2 · 40 | `db-affected-inbox-cmms.log` |

Every stamp VITEST_EXIT=0 through the guarded wrapper. The DB roster
moves 317 → 319 (the delegation-escalation spec + the sweep isolate
join the family) — the full-envelope count at the new roster is
W-51's (the plan's own division: the migration waves run the full
suite).

## THE STANDING BATTERY (every log this session, every stamp green, at the final code state)

| Check | Verdict | Log |
|---|---|---|
| typecheck | 8/8 | `typecheck.log` |
| lint | 8/8 | `lint.log` |
| depcruise | clean — 2,302 · 17,165 (+5/+47 dated — the escalation service + the job + the wiring + the two specs; zero cycles) | `depcruise.log` |
| unit workspace | 8/8 — 189 files · 2,233 tests standing (no unit delta — the wave's own proof is the DB specs) | `unit-workspace.log` |
| ROUTE_PERMISSIONS | **1,215 standing** (the tsx recount — zero routes this wave: the delegation/escalation waves are service-layer, the routes land at W-47+) | `route-permissions-recount.log` |
| permissions drift | 366 = 366 standing (no key delta — the settings registry row is not a permission key) | `permissions-drift.log` |
| i18n parity | ar=7,582 = en=7,582 standing (the surface waves are W-48's) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| docs:validate | 33/33 (re-verified at the final docs state — the ledger edits ride this increment) | `docs-validate.log` |
| id-ledger | 0 errors + self-test all-probes-OK (probe 7 stands at G-67/PHASE-052, claimant PHASE-053) | `id-ledger.log` / `id-ledger-self-test.log` |
| history-secrets | 0 violations · 7,889 allowlisted hits (the SIX tag anchors walked, all untouched) | `history-secrets.log` |
| capabilities | agree | `capabilities.log` |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

## THE HONEST CATCHES (the spec's own first REDs, each repaired with the RED shape named)

1. **THE USERS EMAIL LOWERCASE FLOOR** (the delegation spec's first
   RED): the per-arm user seeds carried UPPERCASE arm codes in the
   emails (`wfd-A-manager@…`) — `ck_users_email_shape` refuses
   (email = lower(email)); the seeds lowercased.
2. **THE ROLES KEY SHAPE FLOOR** (the second RED): the per-arm role
   keys `wfd-mgr-A` — `ck_roles_key_shape` demands
   `^[a-z][a-z0-9_]*$`; the keys re-formed `wfd_mgr_a` (no hyphens,
   lowercase).
3. **THE (h) ARM'S FK FLOOR** (the sweep isolate's only RED): the
   entitlement-gate world's raw instance seed pointed at
   `gen_random_uuid()` — `fk_workflow_instances_definition` (the
   composite FK to workflow_definitions) refused; the world seeds its
   own definition row first (the same floor the family's fixtures
   already encode — re-learned at the raw seed).

RISK-033: EIGHT incidents, ZERO new this wave — the row stays OPEN,
closing only by the owner's order.

The reservations G-67 · INV-037 — NO BR this phase — لا كتابة خارجها.

NEXT: W-46 (the bridge — T-05: the approval_policies conversion tool
(D-12's mapping) + the compatibility mode (the in-flight documents
finish under the old semantics) + the parity test + the mapping
record) under the standing order. NOT production approval — تسليم لا
قبول.
