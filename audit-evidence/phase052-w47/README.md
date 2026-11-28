# PHASE-052 W-47 (THE DEEP LINKS + THE TASKS + THE RULES ALERTS) evidence — 2026-11-28 (T-06 + T-08 + T-07's rules half; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-47 steps'
heads' tree (step 1 `14dee97` + step 2 `5d35b4e` pushed at their own
completions per the owner's standing order «عند الانتهاء من أي خطوة
ادفعها إلى المستودع»; the same-session evidence rule, the
FIFTY-NINTH consecutive wave). The wave is the APPROVED PLAN's §3
W-47 under the owner's launch authorization (إذن إطلاق ONLY, NEVER
production approval — تسليم لا قبول; the reservations G-67 · INV-037
— NO BR this phase — لا كتابة خارجها).

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ 5d35b4e` (the W-47 step-2 head,
  pushed at its own completion) · `phase/051` = `c5175ff` (annotated
  `38b444e`) · `phase/050` = `01f61a7` · `phase/049` = `41c3701` ·
  `phase/048` = `ba459ff` · `phase/047` = `5b73bd1` · `phase/046` =
  `4ddb39f` — **the five annotated predecessors' identifiers + the 051
  tag intact** (re-proven by this session's history-secrets run: 0
  violations, 8,034 allowlisted fixture hits across the 12 documented
  allowlist paths — the window's shift).
- The working tree is this session's own continuation of the W-43…
  W-46 sessions' environment (node v24.22.3 · pnpm 9.15.9 · the
  workspace install · the embedded-PG16 16.14 binaries) — 0 skipped on
  every run below.

## The wave's acts (steps 1–2 pushed + this gate increment)

1. **STEP 1 — THE DEEP-LINK LAW END-TO-END** (`14dee97`): the deadline
   law at the token fold's own home + the routes' own 404 class + the
   WorkflowDeepLinkService (the decode/consistency/expiry/actor floors
   against the DB's own clock + the CAS pre-check + the engine's own
   act path VERBATIM) + the link preview + the email leg's tokens + the
   module's FIRST CONTROLLER + ROUTE_PERMISSIONS 1,215 → 1,216 + the
   workflow error statuses in error.filter.ts + the 041 template's
   deep links.
2. **STEP 2 — THE TASKS LANE + THE RULES ALERTS** (`5d35b4e`): the
   store's lane query + the TaskLaneService + the tasks routes + the
   alert-rules fold + the settings key `workflow.alert_rules` + THE
   ADAPTER (the bus consumer) + the module wiring.
3. **THE GATE INCREMENT** (this commit): the deeplink-tasks DB spec +
   the wave's exit battery (this envelope) + the ledger's W-47 dated
   note (**ACCEPTANCE #6 GREEN**) + the NEXT_ACTION +
   IMPLEMENTATION_STATUS dated headers.

## THE DEEPLINK-TASKS SPEC — workflow-deeplink-tasks.db.spec, 17 arms ALL GREEN (acceptance #6's own proof + the task arms + the alert arms)

TENANT_WFX (workflow.engine + workflow.tasks + the alert-rules
settings row + the owner user) + TENANT_WFX_GATE (workflow.engine ONLY
— the graceful-gate + the no-rules worlds); every arm its OWN world
(users · role · journal · account · line · definition discriminated by
the arm's own entry window); **THE CAPTURING EMAIL LEG** carries the
exact tokens the 041 mail renders (the end-to-end: the link the
assignee receives is the link that works).

| Arm | The proof |
|---|---|
| (a) THE ONE-TIME ACT + THE COMPLETION LANDING | the email's own approve token acts once (the step APPROVED with acted_at/acted_by/comment, the chain COMPLETED, the instance.completed bus emission); **THE POST-COMPLETION RE-ENTRY** — the module's approve act after the deep-link completion (the REAL JournalService) reads the completed-approved chain and lands the document's APPROVED transition DIRECTLY (approval_step the chain's count — the W-46 completion law extended to the beyond-module act surfaces) |
| (b) THE REPLAY REFUSAL | the same link again — the typed WORKFLOW_STEP_ALREADY_ACTED (the CAS single-use; the acted_at stamp is the ledger) |
| (c) THE EXPIRY REFUSAL | a token past its claim's own deadline — the typed WORKFLOW_TOKEN_EXPIRED (the DB's own clock) |
| (d) THE ACTOR MISMATCH | another user's session with the link — the typed WORKFLOW_TOKEN_ACTOR_MISMATCH, ZERO residue |
| (e) THE TAMPER REFUSAL | a forged signature — the typed input class (no partial parse, no lenient field) |
| (f) THE REJECT LINK | the reject token completes the chain with the terminal REJECTED verdict + the frozen history |
| (g) THE PREVIEW | the act page's own read — the rendering facts, the awaiting flag, the claim's own deadline |
| (h) THE TYPED LIST | the caller's own PENDING TASK steps, due-first (the 2h task before the 48h); the other user's tasks never in my lane; the doc facts per row |
| (i) THE COMPLETION WRITE-BACK | the task's completion is the step's own ACTED stamp; the chain completes; the lane empties; the receipt lands |
| (j) THE NON-TASK REFUSAL | an APPROVAL step through the task surface — the typed wrong-surface refusal, ZERO residue |
| (k) THE ACTOR LAW | another user completing my task — the engine's typed actor refusal, ZERO residue |
| (l) THE GRACEFUL GATE | the tasks-flag-off tenant's lane is EMPTY (the chain itself lives — the engine flag is on) |
| (m) THE THRESHOLD ALERT | the configured amount rule above its threshold raises the owner's inbox alert (the engine's own context figure) |
| (n) THE BELOW-THRESHOLD SILENCE | no alert (the chain's own assignment notification only) |
| (o) THE GARBAGE RULE SKIPPED | the malformed rule never alerts, never crashes the chain open — exactly ONE alert for the good rule |
| (p) THE NO-RULES DEFAULT | the settings-less tenant's chains raise NO alerts (the opt-in default []) |
| (q) THE CREATOR AUDIENCE | the creator-audience rule alerts the document's creator (the person waiting on the chain) |

**THE HONEST CATCH caught at the spec's own design and corrected IN
THIS INCREMENT: THE STRANDED-ACT GAP.** The deep-link act completes
the chain OUTSIDE the module's own act — the document stays awaiting
with the legacy policy path as its only next step (the W-46 double-gate
resurfaced through the beyond-module act surfaces: a two-step policy
demanding its own acts after the chain's, an amount-threshold policy
refusing the approval its chain granted). **THE FIX: THE
POST-COMPLETION RE-ENTRY at the gateway** — `findCompletedApproved
InstanceForDocument` (the store's new read: the latest COMPLETED chain
with no REJECTED step, carrying the APPROVED step count) — the
module's next approve act reads the verdict {chainOpened: true,
completed: true, completedSteps} and lands its transition DIRECTLY;
the idempotence is structural (a document already transitioned is
refused by the module's own state floors before this read — the
re-entry never double-fires).

## THE SEVEN STANDING ISOLATES standalone FIRST (the W-45 law — the escalation sweep joins the set)

| Isolate | Tests | Log |
|---|---|---|
| soak | 1 · 1 | `isolate-soak.log` |
| fcm | 1 · 8 | `isolate-fcm.log` |
| email | 1 · 5 | `isolate-email.log` |
| the cmms sweep | 1 · 4 | `isolate-sweep.log` |
| the quality calibration sweep | 1 · 4 | `isolate-quality-sweep.log` |
| the trade expiry sweep | 1 · 6 | `isolate-trade-sweep.log` |
| THE WORKFLOW ESCALATION SWEEP (the SEVENTH) | 1 · 9 | `isolate-workflow-sweep.log` |

## THE AFFECTED-FOLDER BATTERY (the mid-wave scope-label law — the full DB suite re-runs at the migration waves W-43/W-51; this wave runs its folders)

| Part | Files · Tests | Log |
|---|---|---|
| the workflow family (schema · engine · delegation/escalation · the sweep isolate · the bridge · **the deeplink-tasks**) | 6 · 97 | `db-affected-workflow-family.log` |
| the accounting affected specs (the golden · the periods · the projects (the AppModule booter) · the INV-011-022 — the re-entry's own folder) | 4 · 28 | `db-affected-accounting.log` |
| the inbox writer + the standing category arm (cmms-schema) | 2 · 40 | `db-affected-inbox-cmms.log` |

The DB roster moves 320 → 321 (the deeplink-tasks spec joins chunk-a
132 → 133; `parts.json` updated) — the full envelope at the new count
is W-51's.

## THE STANDING BATTERY (every log this session, every stamp green, at the final code state)

| Check | Result | Log |
|---|---|---|
| typecheck | 8/8 | `typecheck.log` |
| lint | 8/8 | `lint.log` |
| unit workspace | 8/8 — 189 · **2,243** standing (+10: the deadline law's 3 + the template links' 2 + the alert-rules fold's 5) | `unit-workspace.log` |
| depcruise | clean **2,311 · 17,243** (+5/+18 dated — the deep-link service · the task-lane service · the alert adapter · the alert-rules fold · the spec; zero cycles) | `depcruise.log` |
| ROUTE_PERMISSIONS | **1,215 → 1,216** (the act route on `workflow.approve`) + SESSION_ROUTES **+3** (the preview + the tasks pair) | `route-permissions-recount.log` |
| permissions drift | 366 = 366 (zero new keys — the act binds the existing workflow.approve; the tasks ride the self plane) | `permissions-drift.log` |
| i18n parity | 7,582 = 7,582 standing (no delta — the W-48 web plane's ~180 keys are that wave's own) | `i18n-parity.log` |
| mobile tokens + i18n | 50/50 derivations · parity OK | `mobile-tokens.log` · `mobile-i18n.log` |
| manifests | 13/13 | `manifests.log` |
| docs:validate | 33/33 (the ledger edits ride this increment) | `docs-validate.log` |
| id-ledger | 0 errors | `id-ledger.log` |
| history-secrets | 0 violations · 8,034 allowlisted hits | `history-secrets.log` |
| capabilities matrix | agree | `capabilities.log` |
| the shells | PASS / PASS | `desktop-shell.log` · `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

**The W-47 exit discharged: ACCEPTANCE #6 GREEN (the one-time act +
the replay/expiry refusals) + the task arms GREEN + the alert arms
GREEN** (the ledger's dated note at §PHASE-052). The mobile companion
affordance stays ONLINE-ONLY (the OFFLINE_CAPABILITIES_MATRIX row 16
law — the approve act never queued, never faked offline).

NOT production approval — تسليم لا قبول.
