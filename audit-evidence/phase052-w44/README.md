# PHASE-052 W-44 (THE ENGINE CORE + THE EVENT BUS) evidence — 2026-11-27 (T-03 + T-07's bus half; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-44 steps 1–3
heads' tree (step 1 `fc656fe` · step 2 `ddae709` · step 3 `bfc798c` —
every step pushed at its own commit per the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع»; the same-session
evidence rule, the FIFTY-SIXTH consecutive wave — the owner's standing
record counts fifty-five through the W-43 gate). The wave is the
APPROVED PLAN's §3 W-44 under the owner's launch authorization (إذن
إطلاق ONLY, NEVER production approval — تسليم لا قبول; the rulings
(أ)–(د) carried; the reservations G-67 · INV-037 — NO BR this phase —
لا كتابة خارجها).

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ bfc798c` (the W-44 step-3 head,
  pushed at its own completion); `phase/051` @ `c5175ff` (annotated
  `38b444e`) · `phase/050` @ `01f61a7` (`76dda77`) · `phase/049` @
  `41c3701` (`1fd74e9`) · `phase/048` @ `ba459ff` (`d46fa87`) ·
  `phase/047` @ `5b73bd1` (`90fd428`) · `phase/046` @ `4ddb39f`
  (`88568da`) — **the five annotated predecessors' six identifiers +
  the 051 tag intact** (re-proven by this session's history-secrets
  run: all SIX anchors walked, 0 violations).
- The working tree is this session's own continuation of the W-43
  session's environment (the tenth reset's recovery, disclosed at the
  W-43 gate) — the environment standing: node v24.22.3 · pnpm 9.15.9
  · the workspace install · the embedded-PG16 16.14 binaries · the
  chromium 1248 pair (provisioned at the W-43 gate) — 0 skipped on
  every run below.

## The wave's acts (steps 1–3 pushed + this gate increment)

1. **STEP 1 — THE BUS + THE CATEGORY** (`fc656fe`): migration 0131
   (the notifications-category widening — `workflow` joins BOTH
   closed CHECK domains, the shared-scope union 19 → 20, ordered WITH
   the writer) + the journal/manifest/spec pins (the chain 130 → 131)
   + the InboxService category type + the cmms-schema standing arm's
   dated enumeration + **THE WORKFLOW EVENT BUS** (D-10 — the eight
   topics, the config-events pattern: no persistence, the consumers
   act inside the emitting request's envelope; the 055 handoff
   surface).
2. **STEP 2 — THE ENGINE CORE** (`ddae709`): the store (the
   deterministic definition ordering (created_at, name, id) · the
   reads/writes with the CAS single-use stamp · the replay law's
   structural WHERE faces) + the engine (the entitlement probe · the
   context assembly — the four surfaces' own rows + the PHASE-036
   readers VERBATIM (the trigger-entity → 036-entity-type mapping:
   the singular registry members → the plural 036 forms) · the
   assignee resolution (ROLE/USER/FIELD/FORMULA — the closed
   vocabulary document.creator | tenant.owner; fail-closed, never a
   fallback to the creator) · the trigger resolution (the FIRST
   matching active definition; the immutable snapshot capture) · the
   act service (the actor law — the current step's assignee alone;
   the pointer walk with the NOTIFICATION fire-and-advance; the
   terminal verdicts) · the cancellation mirror) + **THE GATEWAY**
   (the documented contract: onDocumentSubmitted ·
   recordApprovalThroughChain · recordRejectionThroughChain ·
   onDocumentCancelled — the trade-order-gate pattern, zero module
   coupling) + **THE EMAIL LEG** (the workflow_step_assigned template
   + the module closure over the REAL EmailService — the assignee's
   prefs, the 014 absent-prefs-on law, the catch-and-continue) + the
   WorkflowModule (registered in app.module.ts).
3. **STEP 3 — THE FOUR EXEMPLAR BINDINGS** (`bfc798c`): the four
   bound surfaces' own acts call the gateway (manual_journals:
   submit/approve/cancel · purchase_orders: submit/approve/cancel ·
   the 048 change orders: submit/approve/reject · the 051 drawback
   claims: submit/approve/reject); the mid-chain shape: the approval
   LANDS on the chain's current step (one atomic act — the step stamp
   commits with the module's own envelope) and the module SKIPS its
   transition returning the current row; the honest catch disclosed
   at the commit (the PO cancel mirror's first cut landed in the
   request class's act — caught by the read-back, corrected).
4. **THE GATE INCREMENT** (this commit): the engine end-to-end DB
   spec + the wave's exit battery (this envelope) + the ledger's W-44
   dated note (**ACCEPTANCE #2 GREEN**) + the NEXT_ACTION +
   IMPLEMENTATION_STATUS dated headers.

## THE ENGINE END-TO-END DB SPEC — workflow-engine.db.spec, 15 arms ALL GREEN (acceptance #2's own proof)

The dedicated engine tenant (TENANT_WFE: the workflow.engine
entitlement + the owner/manager/finance/ceo/requester role plane +
the master-data substrate + the PHASE-036 `urgent` custom field) +
THE FLAG-OFF TENANT (TENANT_WFE_NOFLAG — the declared neutral zero's
own world). The PO path runs through the REAL PurchaseOrderService
(the true end-to-end); the other three bindings through the gateway's
own functions over real document rows:

| Arm | The proof |
|---|---|
| (a) THE CONDITIONAL-CHAIN SCENARIO | a PO above 50,000 opens the three-step chain (manager → finance → CEO) through the REAL module submit — the pointer at the manager, the SLA due, the bus order (instance.started → step.assigned), the assignee's `workflow`-category inbox record |
| (b) the small PO | at or below 50,000 the branch SKIPPED stamps land AT TRIGGER TIME (no actor — the 0128 stamp law); the manager's single approval completes the chain AND the document (one act, both effects) |
| (c) the full ladder | the mid-chain approvals LAND on the chain (the module skips its transition — the document stays awaiting); the final approval completes the chain + the document + the bus (step.approved → instance.completed) |
| (d) THE ACTOR LAW | a non-assignee's approval is refused (WORKFLOW_STEP_ALREADY_ACTED — zero residue, every step still PENDING) |
| (e) THE CUSTOM-FIELD BRANCH | a PHASE-036 custom field selects a different chain (the urgent PO → the CEO-direct chain; the unset PO → the standard chain — the 036 readers VERBATIM through the singular→plural mapping) |
| (f) THE JOURNAL BINDING | the PENDING_APPROVAL trigger + the mid-chain verdict shape (remaining: 1) + the completion |
| (g) THE CHANGE-ORDER BINDING | the SUBMITTED ladder + the rejection path (the chain COMPLETES with the rejection — the remaining step stands as the frozen history; the bus step.rejected → instance.completed) |
| (h) THE DRAWBACK BINDING | the register's own ready-made ladder (the 0121 evidence pair seeded) opens its chain and completes on approval |
| (i) THE NOTIFICATION FIRE-AND-ADVANCE | the engine's own progression stamp (SKIPPED, no actor, the owner's inbox record) walks the pointer past the notification step |
| (j) THE SNAPSHOT LAW | a definition edited after trigger NEVER rewrites a live instance (the two-step snapshot stands; a NEW document opens on the edited three-step definition) |
| (k) THE CANCELLATION MIRROR | the module's cancellation cancels the ACTIVE chain (the bus instance.cancelled); the terminal instance refuses further acts |
| (l) THE COMPATIBILITY MODE | a non-matching definition (the entry floor above the document): NO chain, the module's own approve runs the LEGACY path directly |
| (m) THE FLAG-OFF TENANT | the entitlement probe keeps the engine off — the gateway silent, the module's submit + approve untouched |
| (n) THE FORMULA VOCABULARY | document.creator and tenant.owner resolve through the declared closed formulas |
| (o) THE UNRESOLVABLE ASSIGNEE | the typed WORKFLOW_ASSIGNEE_UNRESOLVABLE refusal, fail-closed — ZERO RESIDUE (the ambient transaction rolls the whole submit back to DRAFT) |

The honest catches disclosed (the wave's own first REDs — the spec's
first run caught four real defects, each repaired with the RED shape
named, no battery red standing):

1. **THE DUPLICATE EMISSION** (the first run's bus arm): openChain
   emitted step.assigned TWICE (the announceAssignment path AND the
   original tail publish — the refactor's leftover); repaired — one
   emission, the lifecycle order (instance.started precedes every
   step.assigned).
2. **THE MID-CHAIN ATOMICITY** (the (c) first RED): the first design
   threw WORKFLOW_CHAIN_STEPS_REMAIN from inside the module's approve
   act — the withTenant envelope rolled the step approval back with
   it (the pointer never advanced; the CEO's final approval could
   never land). THE DESIGN CORRECTION: the mid-chain shape RESOLVES —
   the approval lands on the chain (one atomic act), the module skips
   its transition and returns the current row; the thrown-refusal
   class removed (dead code), the four bindings reworked to the
   verdict contract, the spec's arms reworked with it.
3. **THE TRIGGER-ENTITY → 036 MAPPING** (the (e) first RED): the
   context read custom fields with the SINGULAR trigger entity
   ("purchase_order") while the 036 registry keys are the PLURAL
   table forms ("purchase_orders") — isCustomFieldEntity("purchase_
   order") returned false, the custom-field arm silently read
   NOTHING, and the urgent PO fell through to the standard chain.
   THE FIX: the explicit closed mapping (purchase_order →
   purchase_orders), the unregistered entities read no custom fields
   (the no-fabrication law).
4. **THE (k) WORLD LEAK** (the (l)/(n)/(o) first REDs): the (k) arm's
   cancellation-mirror definition was seeded WITHOUT its
   manual_journal trigger — the default purchase_order + the empty
   entry group (all:[]) made it match EVERY later PO (the (l) count,
   the (n) formula arms, the (o) unresolvable arm all collided on
   it); diagnosed by the diagnostic dump (the chain's definition
   name), fixed with the trigger entity — the per-arm world law's
   own lesson re-learned (every arm's definition carries its OWN
   entity + entry window).
5. The fixture-shape catches (the accounts code floor · the B/L doc
   vocabulary · the customs currency · the journal line direction ·
   the drawback submitted stamp — each the schema's own CHECK floor
   surfacing at the seed, fixed at the seed).

## THE AFFECTED-FOLDER BATTERY (the mid-wave scope-label law — the full DB suite re-runs at the migration waves W-43/W-51; this wave runs its folders)

| Part | Files · Tests | Log |
|---|---|---|
| the workflow family + the inbox writer + the standing category arm | 4 · 96 | `db-affected-workflow-inbox-cmms.log` |
| the bound modules (purchasing operations · the 048 change orders · the 051 drawback) | 3 · 25 | `db-affected-bound-modules.log` |
| the purchasing ap paths | 1 · 12 | `db-affected-purchasing-ap.log` |
| the journal-driving accounting spec | 1 · 7 | `db-affected-accounting-projects.log` |

Every stamp VITEST_EXIT=0 through the guarded wrapper. The DB roster
moves 316 → 317 files (the workflow-engine spec joins the family) —
the full-envelope count at the new roster is W-51's (the plan's own
division: the migration waves run the full suite).

## THE STANDING BATTERY (every log this session, every stamp green, at the final code state)

| Check | Verdict | Log |
|---|---|---|
| typecheck | 8/8 | `typecheck.log` |
| lint | 8/8 | `lint.log` |
| depcruise | clean — 2,297 · 17,118 (+6/+51 dated — the engine/gateway/store/module + the spec + the template leg; zero cycles) | `depcruise.log` |
| unit workspace | 8/8 — 189 files · 2,233 tests standing (no unit delta — the engine's own proof is the DB spec) | `unit-workspace.log` |
| ROUTE_PERMISSIONS | **1,215 standing** (the tsx recount — zero routes this wave: the engine core is service-layer, the 0131 keys-seed-first note standing; the routes land at W-47+) | `route-permissions-recount.log` |
| permissions drift | 366 = 366 standing (no key delta) | `permissions-drift.log` |
| i18n parity | ar=7,582 = en=7,582 standing (the surface waves are W-48's) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| docs:validate | 33/33 (the ledger edits ride this increment) | `docs-validate.log` |
| id-ledger | 0 errors + self-test all-probes-OK (probe 7 stands at G-67/PHASE-052, claimant PHASE-053) | `id-ledger.log` / `id-ledger-self-test.log` |
| history-secrets | 0 violations · 7,773 allowlisted hits (the SIX tag anchors walked, all untouched) | `history-secrets.log` |
| capabilities | agree | `capabilities.log` |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

RISK-033: EIGHT incidents, ZERO new this wave — the row stays OPEN,
closing only by the owner's order.

The reservations G-67 · INV-037 — NO BR this phase — لا كتابة خارجها.

NEXT: W-45 (delegation + escalation — T-04: the delegation resolution
(the windows, the scope, the act-time re-route) + G-67's enforcement
(D-07 — the effective-actor walk, the typed block naming the chain
and BOTH endpoints; `allowSelfApproval` never flipping without the
decision record) + the circularity rejection at save + the
escalation_events engine + the workflow-escalation-sweep (D-08 — the
05:45 cron, the clock law, the structural dedupe, the audit seal, the
entitlement gate, the per-tenant catch-and-continue — THE SEVENTH
STANDING ISOLATE) + the recurring reminders) under the standing
order. NOT production approval — تسليم لا قبول.
