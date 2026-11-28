# NEXT ACTION — PHASE-052 (Workflow & Approvals Engine) — **THE MASTER PLAN APPROVED 2026-11-27 (the owner's dispatch, recorded at the plan's §1a — إذن إطلاق فقط، وليست موافقة إنتاج — تسليم لا قبول)** — W-43 THE FOUNDATION (ACCEPTANCE #1 GREEN) — W-44 THE ENGINE CORE + THE EVENT BUS (ACCEPTANCE #2 GREEN) — W-45 DELEGATION + ESCALATION (ACCEPTANCE #3 + #4's ENFORCEMENT ARMS + #5 GREEN) — **W-46 THE BRIDGE DELIVERED 2026-11-27 — ACCEPTANCE #9 GREEN** (step 1 + the gate increment, every step pushed at its own commit: `545e1ca` the conversion tool + the completion-law fix (the PolicyBridgeService — D-12's four-mode mapping with the origin_policy_id back-reference, the idempotence, the SUPERSEDED handling, the doc-type mapping, the threshold canonicalization, the entitlement gate, the audit seal; the engine's completedSteps parity figure; THE JOURNAL'S COMPLETION LAW — the W-44 fall-through's latent double-gate corrected: on the chain's completion the module's APPROVED transition lands DIRECTLY, the legacy policy path only when NO chain exists) · the gate the bridge DB spec 7 arms ALL GREEN (the single-approver parity · the two-step parity (NEVER four acts) · the amount-threshold branch pair with the at-limit law + the declared mapping · the none/superseded/unmapped honest rows · the in-flight completion (the launch-time boundary) · the entitlement gate · the idempotence) + the affected folders (the workflow family 5 · 80 + the accounting 4 · 28 + the inbox/cmms 2 · 40) + the whole standing battery green; the DB roster 319 → 320; the honest catches: the W-44 double-gate + THE W-44 MODULE DI BUG (the explicit @Inject law — vitest's esbuild transform does not emit design:paramtypes; the platform-wide latent class disclosed: the other sweep-registering modules with plain constructors degrade silently — a candidate follow-up) + the journal's 2X amount law; the evidence `audit-evidence/phase052-w46/`) — **W-47 THE DEEP LINKS + TASKS + THE RULES ALERTS DELIVERED 2026-11-28 — ACCEPTANCE #6 GREEN** — **W-48 THE WEB PLANE DELIVERED 2026-11-28 — ACCEPTANCE #7 GREEN** (steps 1–4 + the gate increment, every step pushed at its own commit: `3555bfc` THE API SURFACE (the definition-input pure fold + the store's editor reads/writes + the inbox's aging-at-the-DB-clock query + THE DELEGATION LANE + the two services (the fold first + the audit seal; the engine's own act path VERBATIM + the timeline read) + THE CONTROLLER +6 — ROUTE_PERMISSIONS 1,216 -> 1,222, every key the 0130-seeded row) · `6187fa9` THE WORKFLOW SURFACES (the timeline component — PP-17's full history VERBATIM; the approvals inbox board — the DATA-SLOT shape, the aging VERBATIM, the quick actions; the tasks pane; the deep-link act landing; the three pages + the crumbs + **i18n BY BOTH COUNTS 7,582 + 166 = 7,748 = 7,748** + the 13 spec arms) · `65e7384` THE CHAIN EDITOR + THE NAV (the form-first editor — the visual ordering (the order is DATA, never a canvas), the conditions editor, the mapping law, the deactivation dialog; **NAV_ITEMS +3** (workflow.approvals · workflow.tasks · settings.workflows) + **THE HONEST +1** (trade.drawbacks — the fourth bound surface's register, disclosed: the 051 web plane delivered the drawback claims engine-only, the docDetailPath contract makes the row honest) + the ⌘K registration; the 9 spec arms) · `7d62c0b` THE TIMELINE EMBEDS + THE FOURTH BOUND SURFACE (the journal detail embed server-gated on workflow.history.view · the PO chain view (the rowAction + the ?doc= landing) · the contracting CO chain view · THE DRAWBACK CLAIMS BOARD (the 051 engine's register + the create act + the lifecycle acts + the chain view); the 7 spec arms) · the gate THE EXIT BATTERY (the evidence `audit-evidence/phase052-w48/`): the SEVEN standing isolates standalone first + the affected folders (the workflow family 6 · 97 · the accounting 4 · 28 · the inbox/cmms 2 · 40 · the identity-flows 1 · 21) + the wave's own web suite 46 · 269 ALL GREEN + the whole standing battery (typecheck 8/8 · lint 8/8 · unit 8/8 — 2,290 standing (+47) · depcruise clean 2,332 · 17,413 · ROUTE_PERMISSIONS 1,222 · permissions 366 = 366 · **i18n 7,748 = 7,748 BY BOTH COUNTS** + mobile 371 standing · manifests 13/13 · docs 33/33 · id-ledger 0 + self-test OK · history-secrets 0 (8,179 allowlisted; the SIX anchors walked) · capabilities · the shells · boundary PASS); the DB roster standing at 321) (steps 1–2 + the gate increment, every step pushed at its own commit: `14dee97` THE DEEP-LINK LAW END-TO-END (T-06 — the deadline law (the step's own due_at, else the 72-hour default); the 404 class; the WorkflowDeepLinkService (the decode/consistency/expiry/actor floors against the DB's own clock + the CAS pre-check + the engine's own act path VERBATIM); the link preview; the email leg's tokens; the module's FIRST CONTROLLER (POST /api/v1/workflow/act on workflow.approve + the SESSION_ROUTES preview); ROUTE_PERMISSIONS 1,215 → 1,216; the workflow error statuses in error.filter.ts (404/403/409s — the CAS replay · the EXPIRED deadline · the ladder · INV-037 · G-67 · the circularity); the 041 template's deep links AR/EN) · `5d35b4e` THE TASKS LANE + THE RULES ALERTS (T-08 + T-07's rules half — the tasks ARE the step instances (no seventh table): the store's lane query (due-first) + the TaskLaneService (the typed list through the engine's own facts reader; the graceful tasks-plane gate; the completion write-back = the step's own ACTED stamp with the TASK floors + the receipt) + the tasks routes (SESSION_ROUTES +2 + @RequireFeature(workflow.tasks)); the alert-rules fold (fail-closed, the D-06 fold the conditions' ONE validator) + the settings key workflow.alert_rules (the OPT-IN default []) + the ADAPTER (the workflow.instance.started bus consumer — the engine's own assembleDocumentContext exported (never a parallel evaluation path), the audiences owner|creator, the per-rule-per-instance dedupe, the catch-and-continue) + the wiring) · the gate THE DB SPEC + THE EXIT BATTERY (the workflow-deeplink-tasks.db.spec — 17 arms ALL GREEN: the one-time act + THE POST-COMPLETION RE-ENTRY (THE STRANDED-ACT GAP caught at the spec's design and corrected in the same increment — the gateway's findCompletedApprovedInstanceForDocument: the module's approve after a deep-link completion lands the document DIRECTLY, the legacy path never re-gates a chain-approved document) · the replay/expiry/actor-mismatch/tamper refusals · the reject link · the preview · the typed list · the completion write-back · the non-task refusal · the actor law · the graceful gate · the threshold alert · the silence · the garbage rule skipped · the no-rules default · the creator audience; the evidence `audit-evidence/phase052-w47/`)) — **NEXT: W-49 THE REPORTS** (T-14: **the two report contracts (registry 126 -> 128, ALL PIN SITES TOGETHER — D-15): `workflow.pending-approvals` (the inbox's own figures: the PENDING steps with the assignee, the age, the document drill) · `workflow.sla-aging` (the escalation plane's own figures: the breaches, the reminders, the aging buckets)** — the REPORT_CATALOG rows + the queries service (the engine's own reads, zero parallel computation) + the DB spec in the SAME increment; exit: the report arms green (the catalog<->registry reconciliation + the specs)) under the standing order «عند الانتهاء من أي خطوة ادفعها إلى المستودع» — NOT production approval — تسليم لا قبول

**W-48 — THE WEB PLANE (T-10 + T-11 + T-12 + T-13, delivered 2026-11-28 in four steps + the gate increment, every step pushed at its own commit):** step 1 `3555bfc` THE API SURFACE (the definition-input pure fold FIRST — 18 unit arms: the mapping law (the event DERIVED via submitTransitionStatusFor, never sent), the D-06 tree's save-time structural face (exactly-one-of all/any, the operand vocabulary, the canonical 4-dp amount values — floats refused, the in/between member laws, every malformed node named BY PATH), the step ladder's floors (the three types ONLY — the W-10 scope note; the four assignee rules; the SLA whole hours >= 1; the 1..20 contiguous ladder) + the store's editor reads/writes (listWorkflowDefinitions/Steps · insert/update with the steps REPLACED in one ambient transaction — an edit never touches a live instance (the snapshots frozen, D-02); deactivation the path, definitions never deleted — 0127 §3's evidence discipline) + findPendingApprovalsForUser/Users (the inbox's pointer-step APPROVAL query, THE AGING FIGURES THE DB'S OWN CLOCK COMPUTES — ageHours + overdue inside the SQL, the engine-output law) + findLatestInstanceForDocument (the timeline's own read — the ACTIVE chain or the latest terminal) + the WorkflowDefinitionsService (the fold first + the audit seal workflow.definition_created/updated + the duplicate-name typed wrap + the trigger-binding immutability after create) + the WorkflowApprovalInboxService (listMyApprovals: the caller's current APPROVAL steps + THE DELEGATION LANE — the absent assignees' steps resolved through the SAME resolveEffectiveActor the act path runs, the listed set IS the actable set by construction; actOnStep: the engine's own actOnCurrentStep VERBATIM with the wrong-surface + ladder floors; readTimeline: the full step history with the snapshot's own bilingual names + the actors' display names (ONE bounded users query), the no-chain document the honest instance-null read) + THE CONTROLLER +6 (ROUTE_PERMISSIONS 1,216 -> 1,222, every key the 0130-seeded matrix §3.30 row: GET /workflow/approvals on workflow.inbox.act + workflow.engine · POST /workflow/approvals/:id/act on workflow.approve + workflow.engine · GET /workflow/timeline on workflow.history.view + workflow.engine · GET+POST /workflow/definitions + PUT /workflow/definitions/:id on workflow.definitions.manage + workflow.definitions) · step 2 `6187fa9` THE WORKFLOW SURFACES (components/workflow-timeline.tsx — PP-17's full step history VERBATIM (the state ladder by its own words, the assignee + the delegated_to by name, the acted_at with its actor, the comment, the CURRENT chip on the pointer's step, the terminal record frozen as it closed), the no-chain notice, the typed-refusal panels, workflowDocDetailPath (the engine's routing law with the journal path corrected to the [id] detail page — the F1 class: the register URL never carried the ?doc= param) + components/workflow-inbox-board.tsx — the DATA-SLOT pane switch (never the Tabs primitive — the 045 recall), the aging figures rendered VERBATIM (zero client-side recomputation), the routed rows' delegation marker, the quick actions (approve/reject dialogs with the comment) through the engine's own act path, the tasks pane's completion write-back + components/workflow-act-surface.tsx — the deep-link landing (the link AUTHORIZES, the session AUTHENTICATES; the preview's own facts + the awaiting flag; the dead link previews as the typed refusal — the expired/already-acted/actor-mismatch classes with FULL payloads, the act buttons disabled on the non-awaiting read) + the three pages (/workflow/approvals · /workflow/tasks · /workflow/act) + the FALLBACK_CRUMBS + THE I18N BLOCK (the whole wave's 166 keys BY BOTH COUNTS — 7,582 + 166 = 7,748 = 7,748: the surfaces' vocabularies + the editor's keys + the conditions editor + the 11 typed-refusal localizations + the drawback board's keys + the four NAV labels) + the messages.ts helpers (workflowDocLabel · workflowStepStateLabel · workflowStepTypeLabel · workflowInstanceStatusLabel · localizedWorkflowError) + the 13 spec arms (the timeline 4 · the inbox 5 · the act 4)) · step 3 `65e7384` THE CHAIN EDITOR + THE NAV (components/workflow-definitions-board.tsx — D-14's form-first shape: the register (the trigger chip + the DERIVED event mono, the active chip, the step count, the origin marker) + the create/edit form (the visual ordering — the up/down buttons rewrite the array, the order is DATA never a canvas; the three step types ONLY; the four assignee rules; the SLA whole hours; the bilingual names; the branch conditions in the structured face — one group, one combiner, the operand rows; the deactivation dialog) + /settings/workflows + NAV_ITEMS **+3** (workflow.approvals — the HOME group, circle-check, workflow.engine + workflow.inbox.act · workflow.tasks — the HOME group, calendar-check, workflow.tasks, the self plane (no key — the actor law is the engine's own floor) · settings.workflows — list-ordered, workflow.definitions + workflow.definitions.manage, order 127) + **THE HONEST +1** (trade.drawbacks — banknote, the whole-module trade flag + trade.view, order 26: the FOURTH bound detail surface's register; the 051 web plane (W-39) delivered the drawback claims engine-only, the engine's own docDetailPath law points the assignee at /trade/drawbacks?doc=…, so the row makes the workflow plane's contract honest — disclosed at the row's comment + the wave's README) + the ⌘K registration (OA-04 — the registry IS the registration, the palette inherits all four through resolveNavigation) + the 9 spec arms (the editor 5: the register's shapes · THE ORDERING LAW (the up button rewrites the array, the PUT posts the reordered contiguous ladder) · THE EXACT CREATE BODY (no triggerEvent key ever leaves the editor) · the typed refusal with the fold's path-named payload · the AR arm; the nav rows 4: the exact ids/routes/featureKeys · the permission keys mirroring the 0130-seeded rows · the honest +1 · both label sides)) · step 4 `7d62c0b` THE TIMELINE EMBEDS + THE FOURTH BOUND SURFACE (the journal detail embed — /accounting/journals/[id] carries the timeline Card below the panel, server-gated on workflow.history.view (the section never renders without it); the PO chain view — the register's chain rowAction + the ?doc= landing (the page reads searchParams.doc, the workspace opens the linked order's chain); the contracting CO chain view — the change-orders slot's rows carry the chain rowAction + the ?doc= landing independent of the project selection; THE DRAWBACK CLAIMS BOARD (components/trade-drawbacks-board.tsx + /trade/drawbacks) — the 051 engine's own register (the ladder DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED -> PAID with the localized chips, the claim's own figures VERBATIM) + the create act (BR-108's evidence floor server-side — the client sends the honest nulls) + the lifecycle acts (evidence · submit · review · approve · reject · pay — the ladder-gated rowActions) + the chain view (the timeline Card — the ?doc= landing + the rowAction) + the 7 spec arms (the drawbacks board 4 · the PO chain view 3)) · **the gate increment** THE EXIT BATTERY (the evidence `audit-evidence/phase052-w48/`): THE SEVEN STANDING ISOLATES standalone FIRST (soak 1·1 · fcm 1·8 · email 1·5 · the cmms sweep 1·4 · the quality sweep 1·4 · the trade sweep 1·6 · the workflow escalation sweep 1·9) + the affected folders (the workflow family 6 · 97 ALL GREEN (the module's own specs — the new providers boot clean under the real AppModule) · the accounting 4 · 28 · the inbox/cmms 2 · 40 · the identity-flows 1 · 21 (the ROUTE_PERMISSIONS registry's own consumer — the six new workflow.* rows pass the owner-grant walk)) + the wave's own web suite (46 files · 269 tests ALL GREEN — the six W-48 spec files' 31 arms among them) + the whole standing battery (typecheck 8/8 · lint 8/8 · unit workspace 8/8 — 2,290 tests standing (+47: the fold's 18 + the web plane's 29) · depcruise clean 2,332 · 17,413 (+21/+170 dated; zero cycles) · ROUTE_PERMISSIONS 1,216 -> 1,222 + SESSION_ROUTES standing 32 · permissions drift 366 = 366 (zero new keys — all six routes bind the 0130-seeded rows) · **i18n 7,582 + 166 = 7,748 = 7,748 BY BOTH COUNTS** + mobile 371 = 371 standing · manifests 13/13 · docs 33/33 · id-ledger 0 errors + the self-test all-probes OK (probe 7 stands at G-67/PHASE-052, claimant PHASE-053) · history-secrets 0 violations (8,179 allowlisted hits — the SIX tag anchors walked, all untouched) · capabilities agree · the shells PASS · boundary-negative PASS); the DB roster standing at 321 (no new DB spec — the wave's specs are the web component specs + the pure fold's unit spec). **The W-48 exit discharged: ACCEPTANCE #7 GREEN (the timeline renders the full step history (state, assignee, delegated_to, acted_at, comment) on the bound documents across modules — the four embed surfaces live; the approval inbox lists PENDING work with aging — PP-17 satisfied with AR/EN parity and RTL)** (the ledger's dated note at §PHASE-052). The mobile companion affordance stays ONLINE-ONLY (the OFFLINE_CAPABILITIES_MATRIX row 16 law).

**W-47 — THE DEEP LINKS + THE TASKS + THE RULES ALERTS (T-06 + T-08 + T-07's rules half, delivered 2026-11-28 in two steps + the gate increment):** step 1 `14dee97` THE DEEP-LINK LAW END-TO-END (the deadline law at the token fold's own home — the step's own due_at when the SLA set one, else the 72-hour default window (the invitation precedent's span); the stateless law, never a stored TTL, never a token table · the routes' own 404 class (the A7 parity, registered in the SAME increment as the routes — the PHASE-045 T-03 lesson) · the WorkflowDeepLinkService — the decode (ANY tamper/shape failure the typed WORKFLOW_INPUT_INVALID, no partial parse) + the claims' instance/step consistency + the claims asserted USABLE against the DB'S OWN CLOCK (readDbNow — the clock law; the typed EXPIRED + ACTOR_MISMATCH: the link authorizes, the session authenticates — never an unauthenticated action surface) + the CAS PRE-CHECK (a stale token never acts on a step the pointer has moved past) + the engine's own act path VERBATIM (the G-67 floor, the delegation resolution, the actor law, the CAS stamp, the pointer walk, the notifications, the bus — never a parallel act path) · the link preview (the act page's own read — the same floors, a dead link previews as the typed refusal) · the email leg's tokens (the engine builds them at assignment with the deadline law; the leg renders the locale-bound URLs `${WEB_BASE_URL}/{locale}/workflow/act?token=…`) · the module's FIRST CONTROLLER (POST /api/v1/workflow/act on workflow.approve + @RequireFeature(workflow.engine) + the GET preview on SESSION_ROUTES) · ROUTE_PERMISSIONS 1,215 → 1,216 (the keys-seed-first discipline standing) · the workflow error statuses in error.filter.ts's domainStatus chain (the 404 · the 403 ACTOR_MISMATCH · the 409s — the CAS replay, the EXPIRED deadline (the BudgetStateError family), the ladder, INV-037, G-67 (the BudgetSelfApprovalError precedent verbatim), the delegation circularity; the policy class the 422 fall-through) · the 041 template's deep links (AR/EN, byte-stable — the single-use law + the claim's own deadline rendered for the reader)) · step 2 `5d35b4e` THE TASKS LANE + THE RULES ALERTS (D-11/UX-13 — the tasks ARE the workflow_step_instances (NO SEVENTH TABLE, no crm coupling): the store's lane query (the PENDING TASK steps on ACTIVE chains assigned to the user, due-first aging) + the TaskLaneService (the typed list — the caller's own pending tasks, each row the step's bilingual name from the immutable snapshot + the document's rendering facts through THE ENGINE'S OWN reader per row, bounded; the graceful tasks-plane gate (the flag-off tenant's lane EMPTY); THE COMPLETION WRITE-BACK = the step's own ACTED stamp through the engine's act path with the TASK floors (the wrong-surface refusal for non-TASK steps · the ladder law (a future task cannot complete early) · the single-use completion) + the completion's own receipt to the actor) + the tasks routes (SESSION_ROUTES +2 — the self plane, the actor law the engine's own floor; @RequireFeature(workflow.tasks)) · THE ALERT-RULES FOLD (the pure fail-closed normalizer — the envelope's typed members normalized, the conditions passed VERBATIM (the D-06 fold the conditions' ONE validator at evaluation time, never a parallel schema), the garbage dropped one by one) + the settings key `workflow.alert_rules` (the typed registry row, the documented OPT-IN default []) + THE ADAPTER (the workflow.instance.started BUS CONSUMER — the envelope law (the ambient tenant IS the emitter's own, a rogue emission skips silently) · the rules read through the effective-setting reader · THE ENGINE'S OWN assembleDocumentContext (exported this increment — never a parallel evaluation path: a rule sees exactly what the chain's entry conditions saw) · the D-06 fold VERBATIM (a malformed condition group a SKIPPED rule) · the audiences owner|creator (the escalation precedent's audience + the person waiting; a no-creator row falls back to the owner) · the per-rule-per-instance dedupe (`workflow:alert:{ruleName}:{instanceId}` — the inbox's ON CONFLICT floor) · the catch-and-continue (a failed alert NEVER blocks the chain — the email-leg precedent's law; the in-flight tracking + the drain() spec surface)) + the module wiring (the providers + the adapter's subscribe() at boot)) · the gate increment THE DB SPEC + THE EXIT BATTERY (the evidence `audit-evidence/phase052-w47/`): the workflow-deeplink-tasks.db.spec — 17 arms ALL GREEN (TENANT_WFX + TENANT_WFX_GATE, every arm its own world, THE CAPTURING EMAIL LEG carrying the exact tokens the 041 mail renders): (a) THE ONE-TIME ACT + THE COMPLETION LANDING (the email's own approve token acts once — the step APPROVED with acted_at/acted_by/comment, the chain COMPLETED, the instance.completed bus; THE POST-COMPLETION RE-ENTRY — THE STRANDED-ACT GAP caught at the spec's own design and corrected in the same increment: the gateway's findCompletedApprovedInstanceForDocument (the latest COMPLETED chain with no REJECTED step) returns the verdict {chainOpened: true, completed: true, completedSteps} — the module's next approve act (the REAL JournalService) lands the document's APPROVED transition DIRECTLY (approval_step the chain's count — the W-46 completion law extended to the beyond-module act surfaces; the legacy policy path never re-gates a chain-approved document; the idempotence structural — the module's own state floors refuse an already-transitioned document before this read)) · (b) THE REPLAY REFUSAL (the typed WORKFLOW_STEP_ALREADY_ACTED — the CAS single-use, the acted_at stamp the ledger) · (c) THE EXPIRY REFUSAL (the typed WORKFLOW_TOKEN_EXPIRED — the claim's own deadline, the DB's own clock) · (d) THE ACTOR MISMATCH (the typed WORKFLOW_TOKEN_ACTOR_MISMATCH, ZERO residue) · (e) THE TAMPER (the typed input class) · (f) THE REJECT LINK (the terminal REJECTED verdict + the frozen history) · (g) THE PREVIEW · (h) THE TYPED LIST (due-first; the other user's tasks never in my lane) · (i) THE COMPLETION WRITE-BACK (the lane empties, the receipt lands) · (j) THE NON-TASK REFUSAL · (k) THE ACTOR LAW · (l) THE GRACEFUL GATE · (m) THE THRESHOLD ALERT · (n) THE BELOW-THRESHOLD SILENCE · (o) THE GARBAGE RULE SKIPPED (exactly one alert for the good rule; the chain still opens) · (p) THE NO-RULES DEFAULT · (q) THE CREATOR AUDIENCE. The battery: THE SEVEN STANDING ISOLATES standalone first (soak 1·1 · fcm 1·8 · email 1·5 · the cmms sweep 1·4 · the quality sweep 1·4 · the trade sweep 1·6 · the workflow escalation sweep 1·9) + the workflow family 6 · 97 ALL GREEN (the deeplink-tasks spec joins) + the accounting affected specs 4 · 28 + the inbox/cmms 2 · 40 + the whole standing battery (typecheck 8/8 · lint 8/8 · unit 8/8 — 189 · 2,243 standing (+10) · depcruise clean 2,311 · 17,243 (+5/+18 dated; zero cycles) · ROUTE_PERMISSIONS 1,215 → 1,216 + SESSION_ROUTES +3 · permissions drift 366 = 366 · i18n 7,582 = 7,582 standing (no delta — the W-48 web plane's ~180 keys are that wave's own) + mobile parity standing · manifests 13/13 · docs 33/33 (the ledger edits ride this increment) · id-ledger 0 errors · history-secrets 0 violations (8,034 allowlisted) · capabilities agree · the shells PASS · boundary-negative PASS). The DB roster moves 320 → 321 (the deeplink-tasks spec joins chunk-a 132 → 133) — the full envelope at the new count is W-51's. **The W-47 exit discharged: acceptance #6 GREEN (the one-time act + the replay/expiry refusals) + the task arms GREEN + the alert arms GREEN** (the ledger's dated note at §PHASE-052). The mobile companion affordance stays ONLINE-ONLY (the OFFLINE_CAPABILITIES_MATRIX row 16 law).

**W-46 — THE BRIDGE (T-05, delivered 2026-11-27 in one step + the gate increment):** step 1 `545e1ca` THE CONVERSION TOOL + THE COMPLETION-LAW FIX: the PolicyBridgeService (D-12's four-mode mapping — none → NO definition (the honest no-chain row, the legacy auto-approval byte-identical) · single-approver → the one-step APPROVAL chain on the owner-role rule · two-step → the two-step chain · amount-threshold → THE BRANCH PAIR (step 2's entry condition amountBase > threshold — the at-limit law preserved)) + the origin_policy_id back-reference + the idempotence (the origin probe) + the SUPERSEDED handling (the latest active per doc type; the older the policy history) + the doc-type mapping (journal_entry → manual_journal; the unmapped the legacy path) + the threshold canonicalization (the policy shape → the evaluator's 4-dp operand, the leading-zero class re-formed, the malformed the typed refusal) + the entitlement gate + the audit seal; THE ENGINE'S completedSteps (the chain's APPROVED step count at the terminal verdict — the SKIPPED never count, the frozen PENDING tail never counts) + the ChainVerdict widened (the rejection hook carries none — the field is the approve hook's own); THE JOURNAL'S COMPLETION LAW (the W-44 fall-through's latent double-gate caught and corrected — the corrected law: on the chain's completion the module's APPROVED transition lands DIRECTLY with approval_step = completedSteps and the audit action accounting.journal_approved after {step, note, via: workflow_chain}; the legacy BR-034 path only when NO chain exists); THE MODULE WIRING'S @Inject FIX (the explicit tokens — the platform's controller convention; vitest's esbuild transform does not emit design:paramtypes, the plain typed constructor resolved to UNDEFINED under the app-booting specs — bindWorkflowEngine(undefined), every submit crashed on ENGINE.openChain; the platform-wide latent class disclosed: the other sweep-registering modules with plain constructors (fixed_assets · hr · trade) degrade silently — a candidate follow-up, NOT this wave's scope). The gate increment: THE BRIDGE DB SPEC (7 arms, the mode-per-tenant design, the REAL JournalService both sides) + the exit battery + the ledger's W-46 dated note (ACCEPTANCE #9 GREEN) + the headers.

**W-45 — DELEGATION + ESCALATION (T-04, delivered 2026-11-27 in three steps + the gate increment):** step 1 `c88dba2` THE DELEGATION LAW + G-67'S ENFORCEMENT (the delegation service — D-07's IO shell: the save-time circularity over the standing ACTIVE windows (the DB's own clock), the scope pair law typed, the strictly-positive window floor, the no-self floor, the act-time resolution with the pure effectiveActor fold; the engine's act path — the G-67 block (the chain's terminal vs the document's creator, the typed refusal naming the chain and BOTH endpoints, allowSelfApproval never flipping without the decision record), the actor law widened (the assignee OR the chain's terminal), the delegated_to provenance stamp) · step 2 `6831f12` THE ESCALATION ENGINE (the settings key `workflow.escalation_reminder_hours` — the typed registry row, the fail-closed default [24]; scanBreachedSteps — the DB's own now() inside the SQL over the awaiting steps on ACTIVE chains (INV-037's own reading); insertEscalationEvent — the structural dedupe IS the index; the EscalationService — the entitlement gate (workflow.escalation; an unentitled tenant takes NO seal), the cadence read (the fail-closed normalize fold), the NOTIFY row + the owner-target breach notification + the workflow.step.escalated bus emission, the REMINDER plane (the row at the first crossing — one per step EVER; the recurring surface the per-member inbox family to the assignee), the audit seal in the same ambient transaction; the declared interpretations recorded: the action vocabulary's honest boundary (NOTIFY + REMINDER only — REASSIGN/ADD_LEVEL need a target config the 0127 step shape does not carry, the engine never invents an assignee), the audiences (the owner for the breach, the assignee for the reminders), the recurring surface's shape) · step 3 `c8c51f6` THE SWEEP JOB (the `workflow-escalation-sweep` queue at cron 45 5 * * * — 05:45 UTC, the free window after the 05:30 crm slot; the per-tenant pass with the entitlement gate + the catch-and-continue; the WorkflowModule registration — THE SEVENTH STANDING ISOLATE: soak · fcm · email · the cmms sweep · the quality calibration sweep · the trade expiry sweep · this) · the gate increment THE TWO DB SPECS + THE EXIT BATTERY (the evidence `audit-evidence/phase052-w45/`): the delegation spec 8 arms (the act-time re-route with the provenance stamp (acted_by + delegated_to = the delegate, the assignee frozen) · the scope law (ALL covers everything; MODULE accounting covers the journal; ENTITY purchase_order never re-routes the journal step — the typed actor-law refusal, ZERO residue, the assignee's own act still landing) · the expiry (the past-bounded window stops routing) · the save-time circularity (the refusal naming the FULL closed chain finance → manager → delegate → finance + the no-self floor + the scope pair law) · G-67 DIRECT (the chain of length one, BOTH endpoints himself, ZERO residue) · G-67 TRANSITIVE (the routed-back chain manager → delegate → creator — the creator's AND the manager's acts both blocked, the chain names BOTH endpoints, ZERO residue) · the windows' register (the early end narrows the bounds, the resolution stops)) + the sweep isolate 9 arms (the empty pass — the seal lands even when nothing breached · the breach → the NOTIFY row + the owner's warning notification + the bus emission (the reminder NOT yet at 2h vs the 24h cadence) · the reminder cadence (the 25h breach: the REMINDER row + the assignee's reminder at the per-member key) · the structural dedupe convergence (the re-run inserts NOTHING — events and inbox unchanged) · the clock law (the future due never breaches) · the custom cadence [1, 2] (TWO per-member reminders) · the fail-closed garbage (the garbage row reads [24]) · the prefs gate (the owner's in-app off: the rows land, the record skipped, the seal still lands) · the entitlement gate (the flag-off tenant: NOTHING, NO SEAL)). THE HONEST CATCHES disclosed at the wave's README: the identity plane's own floors surfacing at the spec's first REDs (the users email lowercase CHECK ck_users_email_shape · the roles key shape ^[a-z][a-z0-9_]*$) + the (h) arm's raw instance seed needing its own definition row (the composite FK fk_workflow_instances_definition's own floor). The battery: the workflow family 4 · 73 ALL GREEN + the affected folders (the inbox writer + the cmms standing category arm 2 · 40) + the whole standing battery (typecheck 8/8 · lint 8/8 · depcruise clean 2,302 · 17,165 (+5/+47 dated — the escalation service + the job + the wiring + the two specs; zero cycles) · unit workspace 8/8 — 189 · 2,233 standing · ROUTE_PERMISSIONS 1,215 standing (zero routes — the wave is service-layer) · permissions drift 366 = 366 · i18n 7,582 = 7,582 standing · mobile 371 + 50/50 · manifests 13/13 · docs:validate 33/33 (the ledger edits ride this increment) · id-ledger 0 errors + self-test all-probes-OK (probe 7 stands at G-67/PHASE-052, claimant PHASE-053) · history-secrets 0 violations · 7,889 allowlisted hits (the SIX tag anchors walked, all untouched) · capabilities agree · the shells PASS · boundary-negative PASS). The DB roster moves 317 → 319 (the delegation-escalation spec + the sweep isolate join the family) — the full envelope at the new count is W-51's. **The W-45 exit discharged: acceptance #3 GREEN (the re-route/expiry/circularity) + #4's enforcement arms GREEN (the golden transcript with the mandatory failure pack is W-50's) + #5 GREEN (the SLA breach → the escalation row + the actions + the reminders)** (the ledger's dated note at §PHASE-052).

**W-43 — THE FOUNDATION (T-01 + T-02, delivered 2026-11-27 in three steps + the gate increment):** step 1 `7246506` the migrations 0127–0130 + every mirror/registry/catalog/matrix/pin in ONE increment (the nine `workflow.*` keys — the ruling (ب), never platform.workflow.* — the drift 357 → 366 ZERO-DRIFT from the first increment · the five flags on business+enterprise at the declared neutral zero, STARTER at NONE — D-04 · ENTITY_CATALOG 354 → 360 · ROUTE_PERMISSIONS 1,215 standing keys-seed-first · the golden effective-configs' twenty-five pins re-pinned) · step 2 `f026f2a` the pure folds FIRST (the condition evaluator D-06 · the instance/step state machine D-13 · the delegation-graph fold D-07 with the G-67 effective-actor transitive closure · the SLA fold D-08 · the token fold D-09 — 5 files · 72 tests) · step 3 `b8c834f` the `__db__/workflow/` family OPENS (the LEAN fixture + the schema spec 41 arms — every law refused BY NAME, every rejection arm on its OWN world; the three honest catches disclosed at the commit) · the gate increment (this head) the wave's exit battery + the A-suite uuid parse fix (the pre-fix RED captured: three 11-char uuid last groups `…d01/d02/d03` in step 1's committed A-suite extension — `invalid input syntax for type uuid` 22P02 at the seed boot, 2,016 arms skipped; the fix GREEN standalone 1 · 2,016 AND inside the smoke 3 · 2,035 — the RED log kept) + the coverage-proof F1 arithmetic correction (the first draft's «4,527 = 4,486 + 41» contradicted itself — the +36 declared but never added; corrected BEFORE the first load run: 4,563 = 4,486 + 36 + 41 EXACT, confirmed by the run) + the chromium-1248 provisioning disclosure (the first chunk-a attempt's four print-render skips re-run 0 skipped). The battery (every log this session, `audit-evidence/phase052-w43/`): the SIX standing isolates standalone FIRST (soak 1 · 1 @ 230.23s · fcm 1 · 8 · email 1 · 5 · the cmms sweep 1 · 4 · the quality sweep 1 · 4 · the trade sweep 1 · 6) · the FULL DB SUITE **316 · 4,563 · 0 failed · 0 skipped** (smoke 3 · 2,035 — the A-suite 1,999 → 2,035 · perf-rest 5 · 23 · chunk-a 128 · 1,141 · chunk-b 86 · 625 · chunk-c 88 · 711) · the 130-chain from zero TWICE (both [check-rls] OK — 360 catalog tables) · typecheck 8/8 · lint 8/8 · unit 8/8 — 189 · 2,233 · depcruise clean 2,291 · 17,067 · docs 33/33 · i18n 7,582 = 7,582 + mobile 371 standing · permissions 366 = 366 · manifests 13/13 · id-ledger 0 errors + self-test OK (probe 7 stands at G-67/PHASE-052, claimant PHASE-053) · history-secrets 0 with the SIX anchors walked · capabilities agree · the shells PASS · boundary-negative PASS. **The W-43 exit discharged: acceptance #1 GREEN** (the ledger's dated note at §PHASE-052).

**W-0 — THE MASTER PLAN WAVE (T-00, delivered 2026-11-27 at the 051
closure head `c5175ff` in one increment):** §0a FIRST (the remote
verified at `c5175ff` = the tag `phase/051` — annotated `38b444e`
peeling to the W-42 archive head; the FIVE annotated predecessors'
six identifiers + the 051 tag intact; the working tree reconciled to
the remote — the ninth environment reset recovered: git init + fetch +
reset --hard, ZERO content differences, ZERO missing files, the
evidence census 1,699 tracked files across 74 directories; pnpm 9.15.9
via npm -g — corepack's /usr/bin symlink refused EACCES, disclosed; the
workspace install store-cached 24.3s; the embedded-PG16 smoke green
3 · 1,999 VITEST_EXIT=0; the chromium 1248 pair provisioned BEFORE the
runs — the same dated disclosure as the 051-plan wave) · THE MASTER
PLAN (the nine waves W-43…W-51 over T-01…T-16; the sixteen settled
design decisions D-01…D-16 — the honest slots 0127–0130 + the declared
additive 0131 WITH the writer; the nine `workflow.*` keys 357 → 366
(the 0060 law); the five flags on business+enterprise at the neutral
zero; the FOUR exemplar bindings through the WorkflowGateway contract;
the G-67 effective-actor closure; the INV-037 terminal floor; the
stateless-HMAC deep links with the CAS single-use; the WorkflowEvent
bus family — the 055 handoff surface; the TASK steps ARE the step
instances — no seventh table; the bridge's four-mode mapping + the
compatibility mode) · THE LEDGER OPENED (§PHASE-052 — the ten criteria
with their ARMS and WAVES) · the status header + this NEXT_ACTION
updated. The battery: the closure head's own constants re-proven
(a docs-only wave) — every log in `audit-evidence/phase052-plan/`.
**W-0's exit condition discharged 2026-11-27: the plan APPROVED with the
four §7 rulings (recorded at §1a on the 046–051 pattern); the approval head
baselined at `8e07400` (the dispatch arrived in-channel, no new head); the
owner's audit note executed — the probe-7 F1 corrections landed at §0c(7)
and §3 W-51.**

---

# PHASE-051 (Foreign Trade & Logistics) — **CLOSED AS DELIVERY 2026-11-26** (W-33…W-41 · the tag `phase/051` — DELIVERY, never acceptance · the report `docs/implementation/phases/reports/PHASE-051-COMPLETION.md`) — the historical record below

**W-41 — THE PROOF PACK (T-16, delivered on the W-40 gate head
`24e439a` in one increment + this gate):** trade-goldens.db.spec — 9
arms (THE G-64 GOLDEN TRANSCRIPT — the issue's margin deposit DR 1180
· CR the bank + the retirement's REVERSED pair + the settled pair
stamped TOGETHER, the journal EXACT at the line level, the INV-013
single-use keys, the INV-019-exact movements, the margin-net-zero
ledger arithmetic · THE G-64 FAILURE PACK — the unmapped
LC_MARGIN_DEPOSIT → PURPOSE_NOT_MAPPED with the FULL payload + the
ZERO RESIDUE + the flip-and-restore and the SAME act GREEN with the
SAME transcript · THE G-65 GOLDEN TRANSCRIPT — the fold's duty+VAT
totals into the landed-cost document of kind customs through the REAL
LandedCostService (DR 1140 · CR 2145, the line-level tie, the 0125
linkage pair, the exactly-once) · THE G-65 INV-036 COMPLETENESS
FAILURE PACK — DECLARATION_INCOMPLETE with the declaration's own state
· DECLARATION_REQUIRED with no declaration, ZERO residue on both, the
flip-and-restore and the SAME post GREEN · THE G-66 GOLDEN TRANSCRIPT
— the release recognizes the duty EXACTLY ONCE (the recognition pair
DR 1140 · CR 2145, the revaluation uplift through the REAL service,
the ATOMIC pair, the single-use stamp with the replay refused at
ZERO residue) · THE G-66 ZERO-DUTY RELEASE (the interpretation #6:
the EMPTY recognition pair, the pool still releases, the gate falls
silent) · THE G-66 FAILURE PACK (the unmapped CUSTOMS_DUTY_PAYABLE
before the stamp, zero residue, the flip-and-restore, the SAME pair
GREEN) · THE BONDED BLOCKING-MATRIX GOLDEN (ONE arm over the four
canonical baseline paths — the raw planIssue · the manualIssue · the
sales-delivery post · the transfer dispatch — the payloads pinned and
EQUAL across the paths, ZERO residue per path, the release + the
GREEN re-run of the very issue that was refused) · THE
OFFLINE-REJECTION SHAPE (D-20 — OA-02 N/A-RECORDED for trade: the
gate is SERVER-SIDE in planIssue, so the sync-reconciliation-shaped
document's POST sees the SAME typed refusal payload for payload —
the server-side-only law's own proof)) · trade-rls.db.spec — 10 arms
(the A1–A10 matrix over the FOURTEEN trade tables + the census
before/after: the no-GUC reads · the paired witnesses at both floors
· the forged-tenant INSERTs → 42501 · the UPDATE hijacks → 0 rows ·
the DELETE grants census (the twelve no-grant evidence tables DENIED
· the two tenant-extensible seed registers 0 rows) · the id-probes +
the typed finds · the composite-FK law (≥ 25 FKs, all (id, tenant_id)
or the tenants root) + the live FK-inversion probe → 23503 · the
FK-chain joins confined · the UNION ALL + the recursive CTE walking
the declaration→B/L→declaration cycle) · trade-explain-budgets.db.spec
— 4 arms (the OA-06 EXPLAIN budgets: P0 the REAL corpus · P1 the
declaration-lines walk on ix_customs_declaration_lines_tenant_decl ·
P2 the tracking-events walk on ix_shipment_tracking_events_tenant_bl
· P3 the customs-leg read on the 0122 partial index — EXPLAIN not
ANALYZE, the plans logged verbatim, SET LOCAL enable_seqscan=off,
never a forced plan). The battery (the FIFTY-THIRD consecutive
same-session wave; §0a first — the remote verified at `04a44f2`, the
five tags' anchors intact): the six isolates standalone first, the
ELEVEN-PART ENVELOPE **315 · 4,486 · 0 failed · 0 skipped** (the
coverage verified before the first load run; the one declared roster
movement: the three proof-pack specs join chunk-a 124 → 127, the
roster 312 → 315; the provenance 4,463 + 9 + 10 + 4 = 4,486 EXACT),
the 126-chain scratch from zero TWICE (check-rls OK — 354 catalog
tables; the proof pack is a SPECS-ONLY wave — the chain STANDS), the
standing battery green at the final code state (typecheck 8/8 · lint
8/8 · depcruise 2,278 · 17,039 · unit 184 · 2,161 standing ·
ROUTE_PERMISSIONS 1,215 standing · drift 357 = 357 · i18n 7,582
standing (no delta) + mobile 371 = 371 · tokens 130/130 +
derivations 50/50 · manifests 13/13 · docs 33/33 · id-ledger 0 errors
+ all-probes-OK · history-secrets 0 violations (7,411 allowlisted
hits — the window's shift) · capabilities agree · shells PASS/PASS ·
boundary PASS). #1…#9 ALL GREEN at the W-41 gate. RISK-033: EIGHT
incidents, ZERO new — the row stays OPEN. NOT production approval —
تسليم لا قبول.

**W-42 — THE CLOSURE (T-17 + T-18, delivered 2026-11-26 on the W-41
gate head `e416bfb` — the code tree unchanged, this closure step moves
docs and canon only):** THE CANON ROWS in the ID_LEDGER's reserved
wordings — JOURNAL_RULES **G-64** (the LC margin deposit & retirement:
DR the purpose-mapped LC_MARGIN_DEPOSIT 1180 · CR the tenant's chosen
bank at the contract rate (the FX ride, the INV-019-exact treasury
movements), the amendment's margin adjustment through the SAME pair on
(lc_amendment, id), the retirement's reversal of the CURRENT margin
with the settled pair + the journal stamps landing TOGETHER in the CAS
stamp, the fees on the `fee_{seq}` single-use keys to BANK_CHARGES, the
margin exit law, fail-closed with zero residue) · **G-65** (the customs
duty + import VAT capitalization: the fold's totals (Σ duty + Σ import
VAT from the declaration's OWN lines through computeDeclarationTotals,
never a stored parallel figure) into the landed-cost document of kind
customs through the REAL LandedCostService — DR INVENTORY · DR COGS ·
CR the purpose-mapped CUSTOMS_DUTY_PAYABLE 2145, the line-level tie
riding the allocation rows, the INV-018 linkage pair in the same
ambient transaction, the exactly-once (the 0125 partial unique
uq_landed_costs_tenant_declaration), the zero-duty completion's
no-document shape, the FX ride at the contract rate) · **G-66** (the
bonded transfer: the in-bond move posts NO duty (the G-15 policy
journal the value-neutral pair; the from-NULL deposit the custodial
entry) · the release into free circulation recognizes the duty EXACTLY
ONCE — the recognition pair (Dr the released stock's value · Cr the
purpose-mapped CUSTOMS_DUTY_PAYABLE), INV-013 single-use on
(bonded_warehouse_moves, id, release), the revaluation through the
REAL RevaluationService, the ATOMIC recognition-pair CAS, the
zero-duty release's EMPTY pair, the IMPORT/ACCEPTED honest
bifurcation, the blocking face at planIssue — the ONE shared bonded
gate) + note 21 (the non-ledger-document law: the collections,
incoterms, B/Ls, packing lists, certificates, tracking events,
drawbacks and HS/incoterm registers never post — the drawback a
registry record (D-12), the refund lands when treasury records it,
053's surface) · ACCOUNTING_INVARIANTS **INV-036** (the
declaration-completeness law: no landed-cost allocation on an import
receipt without a COMPLETED declaration reference, every allocated
duty ties to a declaration line — the shared customs landed-cost floor
wired INSIDE the purchasing LandedCostService's POST act, the typed
DECLARATION_REQUIRED/DECLARATION_INCOMPLETE refusals with zero
residue, the non-duty landed costs untouched, the flag OFF = the floor
silent, the line-level tie's one-line-per-item exactness laws) ·
BUSINESS_RULES **BR-105…BR-108** (the LC expiry ladder at 30/14/7/1
days with the DB-clock law · the Incoterm mandate + the risk-hint
matrix · the release's exactly-once duty recognition + the honest
bifurcation · the drawback export-evidence gate) + **THE ID_LEDGER
FLIP atomic with the canon rows** (implemented **G 66 · INV 36 ·
BR 108**; reservations 13 phases · 22 ids; 0 errors + the self-test
all-probes-OK — the probe-7 fixture moved to G-67/PHASE-052, claimant
PHASE-053, the W-15 precedent's seventh move) + **THE COMPLETION
REPORT** (the cumulative wave table W-33…W-41 · the ledger #1–#10
CLOSED with every wave's evidence pointers · the battery scope map ·
the FULL unit-package table 184 · 2,161 = 1,081+240+840 EXACT ·
ROUTE_PERMISSIONS 1,215 (the W-33 ten-key seed + the six keys-seed-
first binding waves) · the DB roster 315 (the trade family 15 · 158) ·
the honest catches' log — NINETEEN across the phase, every one
RED-proven then repaired or corrected-with-the-dated-note · the
open-items log transferred explicitly: the 050 report §4's standing
recalls verbatim + RISK-033 at EIGHT with ZERO new across W-33…W-41 ·
the PHASE-052 handoff + **THE STAGE-13 RELEASE GATE CHECKED per CR-38
(full ERP: MRP + HR + WMS + projects live — recorded before Wave 3
starts)**) + **THE TRIPLE FLIP** (the phase doc header → COMPLETE · the
IMPLEMENTATION_STATUS row → COMPLETE + the W-42 dated header · this
file → PHASE-052) + **THE STEP-2 FULL SWEEP AT THE FINAL HEAD** (the
isolates first · the FULL eleven-part envelope at 315 · the standing
battery every check green · the gate record
`audit-evidence/phase051-w42/`) + **THE ARCHIVE
`ERP_PLATFORM_PHASE051.zip` EXACTLY AS DECLARED (F-4/§5 — the
archive-form acknowledgment executed: FLAT, the commit-hash as the
FIRST ENTRY — the physical shape of 049/050, ADDITIVE-ONLY, EXCLUDING
every standing platform zip: أرشفة الأرشيف ممنوعة — the members
byte-verified, the SEVENTEEN standing zips 034_FINAL…050 verified
untouched)** + **THE TAG `phase/051`** (DELIVERY, never acceptance —
the §1a (a) ruling; the tag lands at the archive head).

**The phase's final state:** the chain **126** · ENTITY_CATALOG **354**
· the drift **357 = 357** · the registry **329 tenant-owned tables** ·
ROUTE_PERMISSIONS **1,215** · **the report registry 126** · i18n
**7,582 = 7,582 + mobile 371** · the unit battery **184 · 2,161** (api
86·1,081 · web 39·240 · mobile 27·393 · desktop 16·274 · ui 3·43 ·
contracts 2·56 · domain-core 6·38 · sync-core 5·36) · **the DB roster
315** (the trade family 15 · 158; the full eleven-part envelope at the
closure's final head) · depcruise **2,278 · 17,039** · docs:validate
33/33 · id-ledger 0 errors + self-test OK (implemented **G 66 ·
INV 36 · BR 108**) · history-secrets 0 violations.

**PHASE-052 (Workflow & Approvals Engine):** the change orders (048)
and the duty drawback submissions are the first documents to bind
multi-step approval chains — the workflow engine should adopt them as
its exemplar documents; the LC fees + bank-charge postings extend
treasury surfaces for 053; the customs jurisdiction-pack notes feed the
tax compliance calendar for 054. **THE STAGE-13 RELEASE GATE CHECKED
per CR-38 (recorded in the completion report, before Wave 3 starts):
full ERP — MRP (PHASE-043) · HR (045/046/047) · WMS (044) · projects
(048) live, and the Stage-13 program's own capstone — foreign trade &
logistics — live with this delivery.** The owner continues with «ابدأ
تنفيذ المرحلة PHASE-052». **Delivered as delivery — NOT production
approval.**

---

# The W-40 reports record (the historical context below)

**W-40 — THE REPORTS (T-15, delivered on the W-39 gate head `1699d7e`
in two increments + this gate):** THE FOUR REPORT CONTRACTS (D-18 —
**registry 122 → 126, ALL PIN SITES TOGETHER — the 048-W14 law, no
partial anchoring**): `trade.lc-register` (the register's own rows +
the expiry band verdict through the SWEEP'S OWN FOLD — the effective
windows read, never the run + the days on the DB's own CURRENT_DATE +
the checklist's own open-discrepancy count + the
`lc-status-vocabulary` check; the amounts in each LC's own currency,
never summed across unlike currencies — the retention-statement law
extended to FX) · `trade.customs-declaration-register` (the
declarations' own rows + the linked B/L/PO/landed-cost briefs + **the
line totals THROUGH THE REAL computeDeclarationTotals fold the G-65
completion act rides — rendered from the LINES at every read, never a
stored parallel figure**) · `trade.shipment-status` (the B/L register
+ THE FOLD'S OWN DRIVEN shipment_status — never writable by hand,
D-14's own law — + the append-only event log's own latest milestone +
count) · `trade.duty-drawback-status` (the claims register + the
export evidence's own briefs + THE HONEST NO-GL SHAPE (D-12)) → THE
QUERY SURFACE (TradeReportQueriesService — the registry query-service
convention, the 042/044/048/049/050 pattern verbatim; the folds' READ
surfaces only, zero JavaScript clocks) → THE WIRING (the `trade`
category + data-source module at phase 51 · THE WINDOW WIDENED 50 →
51, declared · reportingServices().tradeQueries · the §9 trade
registration) → ALL PIN SITES (the eight count pins + the cmms spec's
own pin + the NINTH caught by the envelope — see the honest catches —
+ the known-permission catalogs + REPORT_CATALOG's header/§9/§13/
reconciliation 122/122 → 126/126) → THE DB SPEC
(`trade-reports.db.spec` 7 arms — the verbatim ties against the
store's own reads + the REAL folds + the REAL TrackingService's
driven statuses + the deny paths + the isolation floor + the
registry's four rows; the first REDs the 0119/0121 CHECKs' own
floors, repaired in the same session). ROUTE_PERMISSIONS 1,215
standing (zero new routes — the contracts are registry rows on the
engine's own run endpoint; drift 357 = 357, zero key delta — the §12
module-register convention). The battery (the FIFTY-SECOND
consecutive same-session wave; §0a first — the remote verified at
`31ed950`, the five tags' anchors intact): the six isolates
standalone first, the ELEVEN-PART ENVELOPE **312 · 4,463 · 0 failed ·
0 skipped** (the coverage verified before the first load run; the one
declared roster movement: the trade-reports spec joins chunk-a
123 → 124, the roster 311 → 312; the FIRST-RED log kept — the NINTH
count pin the envelope caught, the two-head protocol; the
stamp-truth catch dated inside the first-red log — the NF-12 verdict
rule exercised), the 126-chain scratch from zero TWICE (check-rls OK —
354 catalog tables; the wave added NO migration — the window widening
is a runtime declaration, not a schema act), the standing battery
green at the final code state (typecheck 8/8 · lint 8/8 · depcruise
2,275 · 16,970 · unit 184 · 2,161 standing · ROUTE_PERMISSIONS 1,215
· i18n 7,582 standing (no delta — an API-reports wave) + mobile 371
= 371 · tokens 130/130 + derivations 50/50 · manifests 13/13 · docs
33/33 · id-ledger 0 errors + all-probes-OK · history-secrets 0
violations (7,361 allowlisted hits — the window's shift) ·
capabilities agree · shells PASS/PASS · boundary PASS). **W-41 (the
proof pack) next under the standing order. RISK-033: EIGHT incidents,
ZERO new — the row stays OPEN. NOT production approval — تسليم لا
قبول.**

---

# The W-39 web-plane record (the historical context below)

**W-39 — THE WEB PLANE (T-14, delivered on the W-38 gate head `78e8428`
in two increments + this gate):** THE FIVE SCREENS (`/trade/lc` — the
register + the create + the detail chain (the amendments + the
documents checklist with the discrepancy notes) + the lifecycle acts
(issue with G-64's margin door · the typed amendments · the checklist
writes · the fees through the existing charges discipline · retire ·
cancel); `/trade/customs` — the declarations register + the create with
THE LINES EDITOR + the detail chain with the fold's totals rendered
from the LINES at every read + the ladder acts (submit · accept · THE
G-65 COMPLETION · cancel) + the DRAFT-only add-line + the HS registry
pane with D-16's no-fabrication disclaimer; `/trade/shipments` — the
B/L register + the packing lists + THE CARRIER EVENT LOG (the
append-only truth; the documents' shipment_status NEVER writable
here, D-14's own law); `/trade/incoterms` — the reference page with
the risk-hint matrix rendered from each row's OWN data VERBATIM;
`/trade/certificates` — the register + THE ISSUE ACT + the print
preview (the Dialog + iframe srcDoc + Print-now, ADR-0011)) → **THE
CERTIFICATE ENGINE (the API plane's one gap)**: `CertificateService`
with the FROZEN SNAPSHOT (the linked B/L + declaration's own figures
freeze at issuance ONCE — a later PATCH or tracking event NEVER moves
a stored certificate; ledger-free by design, the 050 note-20 pattern),
the CERT-{YYYY}-{SEQ:6} official number through the REAL
NumberingService, the reads trade.view · the issue
trade.shipments.manage (NO new key minted — the 357 discipline
standing) → **THE PRINT BUILDER** (`lib/trade-certificate-print.ts` —
the 050 COA print laws VERBATIM: `bi()` EXCLUSIVELY · DETERMINISM (no
wall-clock reads — docNo/docDate the certificate row's own strings;
two builds byte-identical in both locales) · the versioned
a4-document template with the .num LTR-mono isolation) → THE SHARED
PIECES (the IncotermSelector embedded in the PO/SO create forms —
BR-106's mandate stays server-side, the matrix rendered VERBATIM at
selection time; the DutySuspendedBanner + DutySuspendedChip — the 050
hold-banner pattern, additive on the stock surface, the move's OWN
figures VERBATIM: moveNo · the line's own qty under bond ·
executedAt, never a recomputed suspended balance) → THE NAV (the five
NAV_ITEMS rows riding the PURCHASING group — D-04's own dependency;
the permission keys mirror the route-permissions rows verbatim, the
0122 §5 ten-key seed; ⌘K inherits them through resolveNavigation,
OA-04) + the five FALLBACK_CRUMBS → **THE I18N: 7,253 + 329 = 7,582 =
7,582 — 100% parity BY BOTH COUNTS (the first surface wave's law)** +
mobile 371 standing + the 55-code localizedTradeError mapper + the
five status localizers → **THE WEB SPECS** (the nine web specs — the
five board specs + the banner + the nav-rows flag-gating + the
incoterm-selector + the print-builder: the web suite **30 · 204 → 39
· 240**) + **THE REAL CHROMIUM CERTIFICATE PRINT ARM**
(`trade-certificate-print-render.db.spec` — 3 arms, the 050 COA
print-render precedent VERBATIM: both locales' thead/dir/rtl-ltr/.num/
woff2 assertions · the REAL PDF render (multi-kilobyte %PDF, the
chromium-1248 shells) · THE DETERMINISM ARM with the renderer's own
Skia /CreationDate + /ModDate clock stamps normalized — the dated
2026-11-23 finding carried VERBATIM) — the trade DB family **11 ·
128** standing green. ROUTE_PERMISSIONS 1,212 + 3 = **1,215** (the tsx
recount; drift 357 = 357, zero key delta — a surface wave). The
battery (the FIFTY-FIRST consecutive same-session wave; §0a first —
the remote verified at `cf6ad9b`, the five tags' anchors intact; the
TENTH environment reset recovered BEFORE the runs — the fresh clone,
pnpm 9.15.9, the workspace install, the chromium 1248 pair): the six
isolates standalone first, the ELEVEN-PART ENVELOPE **311 · 4,456 · 0
failed · 0 skipped** (the coverage verified before the first load
run; the one declared roster movement: the print-render spec joins
chunk-a 122 → 123, the roster 310 → 311), the 126-chain scratch from
zero TWICE (check-rls OK — 354 catalog tables; **the step-2 NEXT
note's «127-chain» anticipation corrected at the gate record's dated
note — the wave added NO migration, the chain verified at 126 SQL
files · 126 journal entries, the F1 literal-truth law**), the standing
battery green at the final code state (typecheck 8/8 · lint 8/8 ·
depcruise 2,269 · 16,922 · unit 184 · 2,161 (api 86·1,081 · web
39·240) · ROUTE_PERMISSIONS 1,215 (the tsx recount) · i18n 7,582 =
7,582 (the declared delta standing) + mobile 371 = 371 · tokens
130/130 + derivations 50/50 · manifests 13/13 · docs 33/33 · id-ledger
0 errors + all-probes-OK · history-secrets 0 violations (7,289
allowlisted hits — the window's shift) · capabilities agree · shells
PASS/PASS · boundary PASS). **W-40 (the reports) next under the
standing order. RISK-033: EIGHT incidents, ZERO new — the row stays
OPEN. NOT production approval — تسليم لا قبول.**

---

# The W-38 bonded + drawback record (the historical context below)

**W-38 — THE BONDED + DRAWBACK ENGINES (T-11 + T-12, delivered on the
W-37 gate head `33aaff5` in two increments + this gate):** THE TWO PURE
FOLDS FIRST (the unit-first law): `bonded-fold.ts` — the ladder (DRAFT →
EXECUTED, terminal), the kind shapes (IN_BOND requires to; RELEASE
requires from), the no-duty/duty matrix (an IN_BOND move NEVER carries
duty — the 0121 floor's caller-side face; a RELEASE carries the
recognition pair ATOMICALLY or NOT AT ALL — the empty pair is the
zero-duty release's own shape, the G-65 interpretation #6 extended), THE
RELEASE DUTY (BR-107 — the declaration's OWN figure at the released
quantity: per-line duty_amount × the released share on Decimal 4dp, the
tie a FUNCTION never a relation, the over-release guard over the
register's own Σ) + THE BASE ALLOCATION (the exact-Σ law — the remainder
absorbed so Σ ≡ the converted total EXACTLY) with 21 property tests;
`drawback-fold.ts` — the ladder (DRAFT → SUBMITTED → UNDER_REVIEW →
APPROVED | REJECTED; APPROVED → PAID), the evidence gate, the DRAFT-only
link window, the export-type law with 11 property tests → **THE SHARED
BONDED GATE** (`bonded-gate.ts` — G-66's own structural face, D-08
VERBATIM: the SECOND blocking validation wired INSIDE the movement
core's planIssue at the INV-035 gate's own choke point — the hold-gate
precedent's exact shape; every issue/ship path passes it BY
CONSTRUCTION; the typed 409 BONDED_STOCK_SUSPENDED naming the stock +
the bond + the figures, ZERO residue; the bond ledger = the register
itself (interpretation #7); the flag OFF = the gate silent; the sole
bypass `allowBondedStock` — the beneficiary discipline; NO new invariant
identifier — the reservations law §6.16) → THE BONDED ENGINE
(BND-{YYYY}-{SEQ:6}): create → execute — THE IN-BOND TRANSFER (G-66: NO
duty entry, the REAL movement core VERBATIM — the OUT leg at WAC with
the bypass, the IN leg at the carried cost, the G-15 policy journal the
value-neutral pair; the INITIAL DEPOSIT from NULL: the custodial entry,
NO journal — interpretation #10) / THE RELEASE (BR-107: the declaration
link — IMPORT-type ACCEPTED only (a COMPLETED declaration's duties
already flowed through G-65 — the double-recognition refusal); the
fold's duty at the released quantity; the FX ride; the fail-closed
CUSTOMS_DUTY_PAYABLE; THE RECOGNITION JOURNAL — Dr the released stock's
value · Cr the purpose-mapped liability, INV-013 single-use on
(bonded_warehouse_moves, id, release); THE REVALUATION through the REAL
RevaluationService VERBATIM (the WAC/layers uplift at the released
quantity); THE EXECUTION CAS — the stamp + the recognition pair ATOMIC;
the zero-duty release: the EMPTY pair) → THE DRAWBACK ENGINE
(DBK-{YYYY}-{SEQ:6}): create → link (DRAFT-only, the EXPORT-type
verification) → submit (BR-108'S EXPORT-EVIDENCE GATE) → review →
approve | reject → pay — THE HONEST NO-GL SHAPE (D-12: the claim is a
registry record, the refund lands when treasury records it, 053's
surface) → THE THIRTEEN-ROUTE CONTROLLER (trade.view over the reads +
trade.bonded.manage / trade.drawback.manage over the acts — the 0122 §5
keys) + the error filter's W-38 codes → **MIGRATION 0126** (the honest
catch: the closed ck_stock_moves_source_shape refused the first
bonded_move insert BY NAME — the 0117/0123 additive-slot precedent's
own class, the chain 125 → 126, the union 24 + 1 = 25, the cmms-schema
scope arm updated in the same increment) → **THE DB SPECS**
(`trade-bonded.db.spec` 14 arms — the blocking matrix over every
baseline issue path + the release golden + the flip-and-restore + the
single-use stamp + the over-release guard + the declaration-state
refusals + the zero-duty release + the FX + the fail-closed purpose +
the flag-off boundary; `trade-drawback.db.spec` 7 arms — the evidence
gate + the ladder + the honest no-GL). ROUTE_PERMISSIONS 1,199 + 13 =
**1,212** (the keys-seed-first FIFTH trade binding wave, dated at the
block; drift 357 = 357, zero delta). The battery: the six isolates
standalone first, the ELEVEN-PART ENVELOPE **310 · 4,453 · 0 failed · 0
skipped** (the coverage verified before the first load run; the one
declared roster movement: the two new specs join chunk-a 120 → 122),
the 126-chain scratch from zero TWICE (check-rls OK — 354 catalog
tables), the standing battery green at the final code state (typecheck
8/8 · lint 8/8 · depcruise 2,244 · 16,752 · unit 175 · 2,125 (api
86·1,081) · ROUTE_PERMISSIONS 1,212 (the tsx recount) · i18n 7,253
standing (no delta — an API-DB wave) + mobile 371 = 371 · tokens 130/130
+ derivations 50/50 · manifests 13/13 · docs 33/33 · id-ledger 0 errors
+ all-probes-OK · history-secrets 0 violations (7,220 allowlisted hits —
the window's shift) · capabilities agree · shells PASS/PASS · boundary
PASS). **W-39 (the web plane) waits on the owner's dispatch under the
standing order. RISK-033: EIGHT incidents, ZERO new — the row stays
OPEN. NOT production approval — تسليم لا قبول.**

---

# The W-37 customs-engine record (the historical context below)

**W-37 — THE CUSTOMS ENGINE (T-10, delivered on the W-36 gate head
`5270b93` in two increments + this gate):** THE PURE FOLD FIRST (D-06 —
the unit-first law): `duty-vat-fold.ts` — THE DUTY/VAT LINE MATH
(duty_amount = customs_value × duty_rate on Decimal, ADR-0009, 4dp
ROUND_HALF_UP; the import VAT the tenant's own figure — REQUIRES_VERIFICATION,
never invented; THE NO-HARDCODED-RATES LAW: the rates are the tenant's own
data, a zero rate the explicit EXW/free statement) · THE TOTALS (the
G-65 amount's own source: Σ (duty + import VAT) from the declaration's OWN
lines — never a stored parallel figure) with 11 property tests → THE
CUSTOMS DECLARATIONS API (create with the official CUS-{YYYY}-{SEQ:6} +
the lines computed THROUGH THE FOLD VERBATIM → the DRAFT-only add-line →
submit (≥1 line) → accept → **complete — THE G-65 FLOW (D-06 VERBATIM)**:
the fold's totals → the FX ride at the contract rate (D-21's own shape —
the landed amount the BASE figure) → the exactly-once pre-check (the
duplicate refused BY NAME) → the purpose-mapped CUSTOMS_DUTY_PAYABLE
(the 0122 §8 marker 2145, fail-closed until mapped) → THE COMPLETION CAS
(ACCEPTED → COMPLETED, the stamp law's exactly-once) → **THE LANDED-COST
DOCUMENT OF KIND customs THROUGH THE REAL LandedCostService VERBATIM
(D-15(a)'s documented contract — the PurchasingModule import
one-directional: the REAL service the ONLY allocator, DR INVENTORY · DR
COGS · CR the purpose-mapped CUSTOMS_DUTY_PAYABLE, allocated by VALUE,
the line-level tie riding the allocation rows) → the declaration's
linkage pair in the SAME ambient transaction (INV-018)** — THE ZERO-DUTY
COMPLETION (the declared interpretation #6: an all-EXW/free set completes
without a landed-cost document — nothing to allocate) → cancel (the
DRAFT-only exit — the 0121 stamp-shape floor's specific refusal) · THE HS
REGISTRY (D-16: the reads, the tenant additions, the frozen code, the
retirement's snapshot semantics) → **THE SHARED CUSTOMS LANDED-COST FLOOR**
(`trade-customs-gate.ts` — INV-036/D-07's honest interpretation, the
trade-order-gate's plain-function shape consumed by the purchasing
LandedCostService's POST act: DECLARATION_REQUIRED/DECLARATION_INCOMPLETE
with ZERO residue; the non-duty landed costs untouched; the flag OFF =
the floor silent; **THE LINE-LEVEL TIE** — the declaration's own lines
joined to the GRN's stock lines by ITEM, the one-line-per-item exactness
laws (the declared interpretation #5), the tie map riding the allocation
rows) → **MIGRATION 0125_trade_customs_landed_cost_source** (the
0123/0124 additive-slot precedent's own class, ordered WITH the writers:
landed_costs.declaration_id + THE PARTIAL UNIQUE
uq_landed_costs_tenant_declaration (the INV-013-equivalent exactly-once
— one customs landed-cost document per declaration, ever) +
customs_declarations.landed_cost_id/landed_cost_no (the linkage pair) +
landed_cost_allocations.declaration_line_id (the line-level tie —
INV-036's own demand); the chain 124 → 125; the manifest + journal +
the spec's dated chain note together) → THE ELEVEN-ROUTE CONTROLLER
(trade.customs.view over the reads + trade.customs.manage over the
register acts) — **ROUTE_PERMISSIONS 1,188 + 11 = 1,199** (the
keys-seed-first FOURTH trade binding wave, dated at the block) · the
error filter's domainStatus chain registered the W-37 codes in the SAME
increment that ships the routes. **THE WAVE'S HONEST CATCH (one,
first-RED-proven then repaired, disclosed at the claim sites — no battery
red standing): the customs spec's FIRST run had the completion-refusal
catches INSIDE the withTenant callbacks — swallowing the refusal within
the transaction and COMMITTING the completion stamp (the tie-law arms
found the declarations COMPLETED instead of rolled back); the repair
moves the catch OUTSIDE the withTenant so the refusal propagates through
the transaction (the INV-018 rollback actually proven — the honest
shape).** The evidence envelope `audit-evidence/phase051-w37/` (the
FORTY-NINTH consecutive same-session wave): the SIX isolates standalone
FIRST + the eleven-part envelope **308 · 4,432 · 0 failed · 0 skipped**
(the coverage verified before the first load run; the one declared
roster movement: the trade-customs spec joins chunk-a 119 → 120) + the
125-chain scratch from zero TWICE (check-rls OK — 354 catalog tables) +
the standing battery (typecheck 8/8 · lint 8/8 · depcruise 2,234/16,668 ·
unit 173 · 2,093 (api 84·1,049 — the fold's property tests) · drift 357
= 357 · ROUTE_PERMISSIONS 1,199 · manifests 13/13 · docs:validate 33/33 ·
id-ledger 0 errors + all-probes-OK · history-secrets 0 violations (7,154
allowlisted hits — the window's shift) · capabilities agree · shells
PASS/PASS · boundary PASS). **W-38 (the bonded warehouse + the duty
drawback) waits on the owner's dispatch under the standing order.
RISK-033: EIGHT incidents, ZERO new — the row stays OPEN. NOT production
approval — تسليم لا قبول.**

---

# The W-36 transport + tracking record (the historical context below)

**W-36 — TRANSPORT DOCUMENTS + SHIPMENT TRACKING (T-09 + T-13, delivered
on the W-35 gate head `0fc3d4c` in two increments + this gate):** THE PURE
FOLD FIRST (D-14 — the unit-first law): `tracking-fold.ts` — THE TOTAL
STATUS × EVENT MATRIX (the carrier ladder BOOKED/DEPARTED/ARRIVED/
CLEARED/DELIVERED, ranks 0…4; every document rung × milestone carries a
verdict: strictly above → ADVANCE (the multi-rung leap allowed — the fold
does not demand intermediate events); the diagonal → NOOP (the idempotent
re-assert — the event records, the status stays); strictly below →
REFUSED as a drive (THE MONOTONE LADDER — an event never regresses a
document's status; the event still records in the append-only log — the
0122 comment's own law «this table is only the append-only log», the
monotone law lives in the fold); the unknown event and the unknown
current → the typed vocabulary refusals) with 10 property tests (the full
5×5 product walked, the never-regress invariant asserted over the whole
product) → **the transport documents API** (T-09 — NO journal, NO ledger
effect anywhere: the transport documents are shipping evidence, the
non-ledger-document law's trade face; the reservations law rides it):
createBl (the official BL-{YYYY}-{SEQ:6} reserved AT CREATE; the
multimodal vocabulary SEA/AIR/ROAD/RAIL/MULTIMODAL; the commercial links
PO import leg + delivery-note export leg — acceptance #8's chain
navigable; the container refs as JSONB data; the shipment_status NEVER
moves by hand — THE FOLD DRIVES IT, the transport service exposes NO
status write) → findBl (the B/L + its packing lists + its events — the
chain's own read) → listBls → createPackingList (the official
PL-{YYYY}-{SEQ:6}; THE ANCHOR LAW — the declared interpretation recorded
at the claim site: the packing list is the shipment's packing document,
the B/L link REQUIRED at the service floor (the 0120 FK nullable for the
raw plane, the engine demands the shipment's identity); the receipt link
optional; the pack lines validated — description/packages/gross/net AND
THE PHYSICAL LAW: gross ≥ net, recorded at the claim site) → **the
shipment tracking API** (T-13): appendEvent (the anchor B/L typed 404 →
the milestone vocabulary's typed pre-check (D-14's unknown-event refusal,
the 0122 CHECK the DB's authority of last resort) → the event shapes →
the optional declaration link probed with the typed 404 (the read-only
documented contract — the declarations ENGINE is W-37's own wave) → THE
APPEND (the carrier's facts are the truth, the log append-only S/I/U NO
DELETE) → THE DRIVE rendered VERBATIM (the fold's verdicts per document:
the anchor B/L + the packing lists under it + the event's OWN linked
declaration; each ADVANCE executes as the race-safe CAS with the
from-rung pinned (a raced status never regresses); the NOOP/REFUSED never
move the document — the event still records; the drive's own summary
rides the response + the audit) → the event-log reads (listEvents by B/L
or declaration) → **THE SEVEN-ROUTE CONTROLLER** (the transport family:
trade.shipments.view over the reads + trade.shipments.manage over the
creates — the family's OWN view key, the LC precedent's shape; the
tracking family: trade.shipments.view over the log reads +
trade.shipments.manage over THE APPEND) — **ROUTE_PERMISSIONS 1,181 + 7
= 1,188** (the keys-seed-first THIRD trade binding wave, dated at the
block) · the error filter's domainStatus chain registered the W-36 codes
in the SAME increment that ships the routes. **NO MIGRATION THIS WAVE**
(the 0120/0122 floors landed at W-33 and the chain stands at 124 — the
declared slots' constants law, zero additive slot demanded by this
wave's writers). **THE WAVE'S HONEST CATCHES (three disclosures at this
gate, no battery red standing): (1) THE EXIT-CODE DISCOVERY (this
session's own — the guarded wrapper hardened in response): on DB-suite
runs the vitest process EXIT CODE IS NOT TRUSTWORTHY ON RED —
embedded-postgres's async-exit-hook converts the natural beforeExit exit
(vitest's pending exitCode=1 after failed tests) into an explicit
process.exit(0); proven by a deliberate failing diagnostic (exit 0 with 1
failed); the wrapper now verifies the vitest SUMMARY lines (zero failed
files AND zero failed tests) in addition to the exit stamp; (2) THE SOAK
ISOLATE'S ENVIRONMENTAL RED (run 1's end-of-window sample caught a
5-deep tail backlog — lastDepth 5 vs baseline 1+2, the machine still
settling after the fresh install; the RED log kept at
`db-isolate-soak-env-RED.log`; the re-run GREEN 1·1 at 228.29s —
environmental, never a code red: the soak path touches no trade code);
(3) THE SCRATCH INVOCATION SLIP (the W-0/W-33 class — the first scratch
invocation passed the repo-root-relative path; ERR_MODULE_NOT_FOUND
before any DB work; the slip log kept; re-invoked through the filter's
apps/api cwd, both runs green).** The evidence envelope
`audit-evidence/phase051-w36/` (the FORTY-EIGHTH consecutive
same-session wave): the SIX isolates standalone FIRST + the
eleven-part envelope **307 · 4,422 · 0 failed · 0 skipped** (the coverage
verified before the first load run; the one declared roster movement: the
trade-tracking + trade-transport specs join chunk-a 117 → 119) + the
124-chain scratch from zero TWICE (check-rls OK — 354 catalog tables) +
the standing battery (typecheck 8/8 · lint 8/8 · depcruise 2,228/16,614 ·
unit 172 · 2,072 (api 83·1,038 — the fold's property tests) · drift 357
= 357 · ROUTE_PERMISSIONS 1,188 · manifests 13/13 · docs:validate 33/33 ·
id-ledger 0 errors + all-probes-OK · history-secrets 0 violations (7,091
allowlisted hits — the window's shift) · capabilities agree · shells
PASS/PASS · boundary PASS). **W-37 (the customs engine) waits on the
owner's dispatch under the standing order. RISK-033: EIGHT incidents,
ZERO new — the row stays OPEN. NOT production approval — تسليم لا
قبول.**

---

# The W-35 collections + incoterms record (the historical context below)

**W-35 — COLLECTIONS + INCOTERMS (T-07 + T-08, delivered on the W-34
gate head `0d40d2c` in two increments + this gate):** THE PURE LAYERS
FIRST (the unit-first law): `collections-lifecycle.ts` — the D/P vs D/A
settlement-windows fold (OPEN → PRESENTED → ACCEPTED (the usance act,
D/A ONLY) → PAID | CANCELLED; the terms-gated settle windows; THE STAMP
LAW'S OPEN-ONLY EXIT — the 0119 XOR floors' own reading: the presentation
and acceptance stamps are monotone evidence that never un-stamp; the
usance floor; the settlement pair law) with 11 property tests ·
`incoterm-matrix.ts` — the ownership-matrix fold (five AR/EN risk-hint
lines rendered from the registry ROW'S OWN booleans — carriage ·
insurance · export clearance · import clearance · import duty; zero
parallel dictionary) + **BR-106's mandate trigger fold (the owner's
ruling (ج) VERBATIM: «currency ≠ base currency, or the order carries the
import/export tag» — the two arms NAMED in the verdict)** with 10
property tests → **the collections service** (T-07 — create with the
official `COLL-{YYYY}-{SEQ:6}` reserved at create → present → accept
(D/A only) → settle (the paid stamps + the settled pair landing
TOGETHER; THE AT-SIGHT ACCEPTANCE — declared interpretation #4, the
0119 accepted_shape floor rendered VERBATIM: a PAID row carries the
full ceremony, a D/P's acceptance and payment one banking event) →
cancel (OPEN only); **the register carries NO GL entry** — the
non-ledger-document law's trade face, the reservations law rides it) →
**the incoterms registry service** (T-08 — the reads render the matrix
from the row's own data; the tenant additions with the (tenant, code)
natural key refused BY NAME; the frozen code (the identity never
rewritten); the retirement's snapshot semantics) → **THE SHARED ORDER
GATE** (`trade-order-gate.ts` — the documented-contract surface consumed
by the purchasing AND sales create/issue acts through the plain-function
import shape, never a module coupling: the selection floor at create +
**THE MANDATE AT THE ORDER'S OWN POSTING** — the entitlement probe → the
base-currency resolve → the pure fold's verdict → the typed
ORDER_INCOTERM_REQUIRED naming the order + the missing field + the arms,
ZERO residue, the number never reserves; the flag OFF = the gate
silent) → **THE ONBOARDING HOOK** (`trade-canonical.ts` — the
Incoterms-2020 set + the HS chapter starter, ONE SOURCE both paths, the
accuracy disclaimer on every starter row «البذور بإقرار الدقة», wired as
the provisioning flow's step 1e) → **migration 0124_trade_order_incoterms**
(the orders' incoterm_code + trade_direction additive NULLABLE column
pairs on purchase_orders AND sales_orders — BR-106's mandate floor; NO
FK by design (the tenant-extensible registry with a DELETE grant); the
chain 123 → 124) → THE ELEVEN-ROUTE CONTROLLER (the collections
register acts on trade.collections.manage · the collections + incoterms
reads on trade.view (the matrix row's OWN wording names the
LC/collections registers — the finance-read plane) · the incoterms
tenant-addition MANAGEMENT on trade.collections.manage — the dated
interpretation at the block; the routes feature-gated on the
whole-module unit `trade`) — **ROUTE_PERMISSIONS 1,170 + 11 = 1,181**
(the keys-seed-first SECOND trade binding wave). **THE WAVE'S HONEST
CATCHES (two, both first-RED-proven then repaired, disclosed at the
claim sites): (1) THE AT-SIGHT ACCEPTANCE (the 0119 accepted_shape
floor's own demand — the first D/P at-sight settle refused by the
floor; the repair lands the acceptance together with the payment, the
fold's terms gate unchanged); (2) this gate's THREE ORDER-DEPENDENT
PURCHASING ASSERTIONS (vitest's duration-based file sort reorders the
suite across sessions — the golden G-07/G-08 GRNI-register TOTAL, the
G-08 receipt lookup, the operations A7 count; reproduced at the FULL
W-34 tree in this session (pre-existing, never W-35 regressions); the
repair scopes every assertion to the arm's OWN rows — the per-arm-world
law restored, the re-run GREEN in every order).** The evidence envelope
`audit-evidence/phase051-w35/` (the FORTY-SEVENTH consecutive
same-session wave): the SIX isolates standalone FIRST + the
eleven-part envelope **305 · 4,407 · 0 failed · 0 skipped** (the
coverage verified before the first load run) + the 124-chain scratch
from zero TWICE (check-rls OK — 354 catalog tables) + the standing
battery (typecheck 8/8 · lint 8/8 · depcruise 2,221/16,568 · unit
171 · 2,072 (api 82·1,028) · drift 357 = 357 · ROUTE_PERMISSIONS 1,181
· manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors +
all-probes-OK · history-secrets 0 violations · capabilities agree ·
shells PASS/PASS · boundary PASS). **W-36 (the transport documents +
the shipment tracking) waits on the owner's dispatch under the standing
order. RISK-033: EIGHT incidents, ZERO new — the row stays OPEN. NOT
production approval — تسليم لا قبول.**

---

# The W-34 LC-engine record (the historical context below)

**W-34 — THE LC ENGINE + THE EXPIRY SWEEP (T-05 + T-06, delivered on the
W-33 gate head `4368187` in two increments + this gate):** THE TRADE MODULE
OPENS (`modules/trade/` — the domain folds FIRST (lc-lifecycle's total
status × move matrix + lc-sweep-math's BR-105 arithmetic, 31 property
tests) → the services → the store → the controller → the wiring): the LC
lifecycle API (create with the official `LC-{YYYY}-{SEQ:6}` reserved at
create → **issue — G-64's margin deposit through the REAL posting engine:
DR the purpose-mapped LC_MARGIN_DEPOSIT (the 0122 §8 marker 1180) · CR the
tenant's chosen bank account** (an explicit ACTIVE in-currency cash account
at the act, the landed-cost charge-account discipline's own shape; INV-013
single-use on (lc, issue); the FX ride at the contract rate (D-21); the
INV-019-exact treasury movement) → **amend** — the dated typed changes
(VALUE/VALIDITY/DOCUMENTS/OTHER, the typed-change + freshness laws) with
the margin adjustment through THE SAME G-64 pair on (lc_amendment, id) →
**the documents checklist** — the monotone stamps (the 0119 floors' fold
VERBATIM) + the discrepancy notes (BR-105's own anchor) → **fee** — THE
FINANCIAL-CHARGES DISCIPLINE (the bank-charge pattern, zero new machinery:
DR BANK_CHARGES · CR the bank, on the `fee_{seq}` INV-028-precedent
single-use keys) → **retire** — the G-64 reversal (DR the bank · CR
LC_MARGIN_DEPOSIT on (lc, retirement); the settled pair + the journal link
land TOGETHER in the CAS) → **cancel** (the margin exit law: the margined
instrument cancels never)) + **BR-105's `trade-expiry-sweep`** (D-09 — the
0111/calibration pattern verbatim, **THE SIXTH STANDING ISOLATE**: the
30/14/7/1 ladder + the discrepancy family on the same bands, the structural
dedupe on D-09's own axes, the clock law (the DB's OWN CURRENT_DATE), the
ISSUED → EXPIRED transition (the ladder's own terminus, CAS-stamped +
audited, idempotent), the 'trade' prefs gate, the
trade.lc_expiry_sweep_run seal, the typed settings key
trade.lc_expiry_sweep_thresholds) + the pg-boss job (queue
`trade-expiry-sweep`, daily 05:00 UTC — the nightly ladder's free window)
+ THE ELEVEN-ROUTE CONTROLLER binding trade.lc.view / trade.lc.manage,
feature-gated on trade.lc — **ROUTE_PERMISSIONS 1,159 + 11 = 1,170** (the
keys-seed-first FIRST trade binding wave). **THE HONEST CATCH (the
0117/0118 additive-slot precedent's own class, disclosed at the claim
sites): the TWO closed-domain widenings land WITH the writers through the
additive slot 0123 (the chain 122 → 123): 'trade' joins the notifications
categories (the 19-member union) + 'letters_of_credit'/'lc_amendment'/
'lc_fee' join ck_cash_movements_source_shape (the fee EVENT its own source
identity — the one-movement-per-source-side law's own demand).** The
evidence envelope `audit-evidence/phase051-w34/` (the FORTY-SIXTH
consecutive same-session wave): the SIX isolates standalone FIRST (the
trade sweep the sixth) + the eleven-part envelope **303 · 4,385 · 0 failed
· 0 skipped** + the 123-chain scratch from zero TWICE (check-rls OK — 354
catalog tables) + the standing battery (typecheck 8/8 · lint 8/8 ·
depcruise 2,210/16,500 · unit 169 · 2,051 (api 80·1,007) · drift 357 = 357
· ROUTE_PERMISSIONS 1,170 · manifests 13/13 · docs:validate 33/33 ·
id-ledger 0 errors + all-probes-OK · history-secrets 0 violations ·
capabilities agree · shells PASS/PASS · boundary PASS). **W-35 (the
collections + Incoterms) waits on the owner's dispatch under the standing
order. RISK-033: EIGHT incidents, ZERO new — the row stays OPEN. NOT
production approval — تسليم لا قبول.**

---

# The W-33 foundation record (the historical context below)

**The W-0 approval dispatch (the owner's, recorded in full in the plan §0b
and the F-051a note):** the plan ACCEPTED AS DELIVERY at `2449233` after the
full independent verification on a clean clone — ONE non-blocking dated
correction order (F-051a: the plan envelope's physical count 35, not 37 —
landed FIRST at `b67afc7`, the note attached to the plan wave's gate log) ·
**the plan ratified as the BINDING PHASE PROGRAM — إذن إطلاق فقط (a launch
authorization, NEVER production approval)** · the rulings: (a) the wave
numbering W-33…W-42 CONFIRMED (the global sequence, no collision; the laws
bind from the first implementation wave) · (b) the G-64/G-65/G-66 account
shapes ACCEPTED AS PROPOSED in D-05/D-06/D-08 (fail-closed until mapped,
the dated-amendment right reserved) · (c) the BR-106 trigger rule AS
PROPOSED (the currency ≠ base OR the import/export marker under the trade
flag) · (d) the standing reservations G-64…G-66 · INV-036 · BR-105…BR-108 —
لا كتابة خارجها, never restated narrower. **W-33 RELEASED by the dispatch:
0119–0122 + كل المرايا + the ten keys 347→357 + the three flags + the seeds
with the accuracy acknowledgment + the five pre-isolations FIRST + F-051a
riding W-33.**

**W-33 — THE FOUNDATION (T-01…T-04, delivered on the F-051a head `b67afc7`
in three increments + this gate):** migrations 0119–0122 + EVERY
mirror/registry/catalog/matrix/pin in ONE increment (the 0108 W-16/0116
W-24 pattern) — the fourteen tables with their floors (the G-64
margin/retirement stamps · the typed-change law · the checklist floor · the
D/A usance floor · the Incoterms ownership matrix as registry DATA · the
B/L as THE SHIPMENT'S OWN ANCHOR (the declared interpretation) · the frozen
certificates' snapshot · INV-036's COMPLETED floor · the tenant's own duty
rows (no hardcoded rates) · THE G-66 NO-DUTY IN-BOND FLOOR + the BR-107
atomic release stamps · the BR-108 evidence floor with NO GL entry · the
milestone vocabulary) + THE DATA-ONLY GRANTS BLOCK (the TEN trade.* keys —
matrix §3.29, the drift 347 → 357 zero-drift from the first increment; the
ENTITLEMENTS widening applied in advance — the 050 W-24 honest catch's own
class, admitting exactly the second whole-module `trade` key; the THREE
flags on business+enterprise with STARTER AT THE DECLARED NEUTRAL ZERO; the
three trade-carrying templates' manifest enablements; the TWO CoA markers
1180 LC_MARGIN_DEPOSIT · 2145 CUSTOMS_DUTY_PAYABLE) + THE SEEDS (the
Incoterms-2020 set + the HS starter set through the 0098 migration-plane
gate, the accuracy disclaimer on every starter row — «البذور بإقرار
الدقة») + the `__db__/trade/` family (the fixtures + trade-schema.db.spec —
41 arms) + THE FULL TEN-PART ENVELOPE 301 files · 4,369 tests · 0 failed ·
0 skipped (the five isolates standalone FIRST; the two honest catches
RED-proven then repaired, both logs kept) + the 122-chain scratch from zero
TWICE (check-rls OK — 354 catalog tables) + the standing battery green
(typecheck 8/8 · lint 8/8 · depcruise 2,197/16,419 · unit 167 · 2,020
UNCHANGED · drift 357 = 357 · manifests 13/13 · docs:validate 33/33 ·
id-ledger 0 errors + all-probes-OK · history-secrets 0 violations ·
ROUTE_PERMISSIONS 1,159 UNCHANGED — keys-seed-first). **The evidence
envelope `audit-evidence/phase051-w33/` (the FORTY-FIFTH consecutive
same-session wave). W-34 (the LC engine + the expiry sweep) waits on the
owner's dispatch under the standing order. RISK-033: EIGHT incidents, ZERO
new — the row stays OPEN. NOT production approval — تسليم لا قبول.**

---

# The W-0 plan wave's own record (the historical context below)


# PHASE-050 — CLOSED AS DELIVERY 2026-11-23 (the historical record below)

# NEXT ACTION — PHASE-050 (Quality Management System) — **CLOSED AS DELIVERY 2026-11-23** (W-24…W-32 · the tag `phase/050` — DELIVERY, never acceptance · the report `docs/implementation/phases/reports/PHASE-050-COMPLETION.md`) — **PHASE-051 (Foreign Trade & Logistics) IS THE NEXT ELIGIBLE PHASE** — the owner continues with «ابدأ تنفيذ المرحلة PHASE-051» — تسليم لا قبول — NOT production approval

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

---

**W-26 — THE CAPA + CALIBRATION ENGINES (T-07 + T-08, delivered on the
W-25 head `b4cc743` in three commits — `b8333a6` the engines → `041a163`
the DB specs → this battery/gate/ledger increment, EVERY step pushed at
its own commit per the owner's «عند الانتهاء من أي خطوة ادفعها إلى
المستودع»):**

- **THE CAPA ENGINE (T-07 — D-10):** the pure fold FIRST
  (`capa-lifecycle.ts` — the TOTAL status × move matrix with the
  root-cause-act-IS-the-start declared interpretation · the actions
  array's canonical shape law refused cell-by-cell · **BR-103's
  capaCloseGate: D-10's two conditions EXACTLY** — every OPEN action's
  window elapsed (undated open = the fail-closed BLOCK, future-dated =
  the BLOCK with the figures openActionCount/pendingCount/
  pendingDueDates) AND the effectiveness check RECORDED (the outcome the
  tenant's honest record, never a forced verdict) — 16 property tests)
  · the service (the official `CAPA-{YYYY}-{SEQ:6}` numbering · the NCR
  link's typed pre-check through the module's OWN row · **THE G-63
  EXTERNAL-COST ACT**: DR QUALITY_EXPENSE (5320, the 0116 marker) · CR
  EXTERNAL_ACCRUAL (2137, the existing marker) through the REAL engine,
  fail-closed PURPOSE_NOT_MAPPED, INV-013 exactly-once on the
  single-use `(capa_record, id, external_cost)` key, the cost + the
  journal link landing in ONE guarded CAS, ONE ambient transaction
  all-or-nothing (INV-018) · **THE CLOSE ACT**: BR-103's typed
  refusals + the checkedAt fabrication guard (a future-dated check
  refused)).
- **THE CALIBRATION ENGINE (T-08 — D-08, the 049 handoff verbatim):** the
  instrument-AS-asset binding through the fixed-assets module's OWN
  `findAssetCard` (the typed QUALITY_INSTRUMENT_NOT_FOUND) · the official
  `CAL-{YYYY}-{SEQ:6}` numbering · the due-after floor's typed pre-check
  naming BOTH dates (the 0115 CHECK's own shape) · **G-63 AT THE CREATE
  ACT** — the record id PRE-GENERATED (uuidv7) so the INV-013 source key
  names the row before it exists, the posting + the insert ONE ambient
  transaction; the zero-cost in-house shape carries NO entry.
- **THE QUALITY-CALIBRATION SWEEP (T-08 — THE FIFTH STANDING ISOLATE from
  this wave, §0c (2)):** the pure folds FIRST (`calibration-sweep-math.ts`
  — the 0111 cmms sibling in this module's own home + **D-08's own dedupe
  axes `quality:calibration:{assetId}:{threshold}:{dueDate}`** — the DAY
  axis is the DUE DATE the alert names: the per-cycle re-alert law (a
  re-calibrated instrument's new cycle alerts again) with the convergence
  law held within a cycle — 11 property tests) · the sweep service (the
  clock law — every date derived from the DATABASE'S OWN CURRENT_DATE in
  the probe's SQL · the structural dedupe via uq_notifications_dedupe ·
  the owner target + the 'quality' prefs gate · THE SEAL
  `quality.calibration_sweep_run` in the same ambient transaction) · the
  pg-boss job (the phase doc's verbatim queue name `quality-calibration-due`,
  daily 04:45 UTC, the 'quality' entitlement gate, registered on boot) ·
  **THE SETTINGS SURFACE — the FIRST 050 SETTINGS KEYS**
  (`quality.calibration_sweep_thresholds` on the typed registry, fail-closed
  default [30,7,0], the SAME tenant_settings row + the SAME
  publishTenancyEvent invalidation as the generic surface).
- **THE WIRING:** ROUTE_PERMISSIONS **1,113 + 12 = 1,125** (the
  keys-seed-first SECOND binding wave: the CAPA seven + the calibration
  five incl. the sweep-config pair, dated at the block) · **MIGRATION
  0118_quality_notifications_category.sql** ('quality' joins BOTH
  notifications CHECK domains — the 18-member union, the shared-scope
  union law, ordered WITH the writer in the same increment; the journal
  117 → 118, no tables — the catalog stays 340; both scratch runs
  CHAIN_118_APPLIED → [check-rls] OK — 340) · the error filter's
  domainStatus rows in the same increment.
- **THE HONEST CATCHES (two, both RED-proven with the four-quarter
  logs):** (1) the cmms-schema spec's union arms — the W-25 scope-label
  run had left the stock_moves arm's EXPLICIT bookkeeping stale at
  0117's new site (the lineage 10 → 11; the members 23 → 24 with
  `ncr_record`); the arm's own design fired RED naming the drift,
  repaired with the dated notes at every modified site, GREEN 32/32.
  (2) the sweep probe's LATEST-FIRST LAW — the per-cycle arm caught the
  band-inside-the-collapse bug RED (a re-calibrated +300 instrument
  still flagged on its superseded +15 row); the collapse now runs BEFORE
  the band filter; GREEN 114/114.

**The wave's battery (every log in `audit-evidence/phase050-w26/`, this
session — the THIRTY-SEVENTH consecutive same-session wave):** §0a FIRST
(the remote verified at `b4cc743` = the W-25 delivery head; the FOUR
tags' six identifiers + the 049 tag intact; the tree clean at HEAD) —
then **THE FIVE ISOLATES STANDALONE FIRST** (soak 1·1 229.11s · fcm 1·8
· email 1·5 · the cmms sweep 1·4 · **the quality calibration sweep 1·4
— the new fifth**, every VITEST_EXIT=0 stamp) · **the affected DB
folders re-run at the delta head** (the scope-label law): **the quality
family 6 · 114 GREEN** (the schema 59 + the NCR 13 + the specs 11 + the
CAPA 17 + the calibration 10 + the sweep 4 — the family 83 → 114) ·
**migrations + identity-flows 2 · 28 GREEN** (the chain at 118 + the
ROUTE_PERMISSIONS checklist over the 1,125 routes — the owner template
grants every quality.* key) · **the cmms schema 1 · 32 GREEN** (the
repaired union arms) · the coverage roster updated with the declared
movement (chunk-a 100 → 102 · **isolate-quality-sweep the new part** ·
the roster 286 → 289; 289 = 289, missing NONE, extra NONE, duplicates
NONE — VERDICT: COVERED; the full ten-part envelope re-runs at W-32) ·
typecheck 8/8 (0 cached — the force re-run) · lint 8/8 (0 cached) ·
depcruise clean **2,135 modules · 15,992 dependencies** (+11/+86 dated) ·
unit 8/8 — **152 · 1,921** (api 72·910 · web 21·171 · mobile 27·393 ·
desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core
5·36 — the ledger arithmetic **1,921 = 910+171+840 EXACT**, the F-2
third term standing) · i18n 6,955 = 6,955 (no delta, as declared — an
API-DB wave) + mobile 371 = 371 · tokens 50/50 · **drift 347 = 347**
(zero delta — no new keys) · manifests 13/13 · docs:validate 33/33 ·
id-ledger 0 errors + self-test all-probes-OK (implemented G 61 · INV 34 ·
BR 100 standing — the 050 flip is W-32's; probe 7 stands at
G-62/PHASE-050) · history-secrets 0 violations · 6,624 allowlisted hits
(the window's shift: the W-26 session commits entering the last-200
sample; the FOUR tag anchors untouched) · ROUTE_PERMISSIONS **1,125**
(the tsx recount) · the registry 315 tenant-owned tables · capabilities
agree · shells PASS/PASS · boundary PASS. RISK-033: EIGHT incidents, ZERO
new this wave.

**W-32 — THE CLOSURE (T-19 + T-20, delivered 2026-11-23 on the W-31 delivery
head `df2fe1e`):** THE CANON ROWS in the ID_LEDGER's reserved wordings —
JOURNAL_RULES **G-62** (the NCR scrap write-off: DR the purpose-mapped
INVENTORY_SHRINKAGE · CR the per-warehouse INVENTORY at the affected quantity's
own value, through the REAL engine and the REAL WMS path, INV-013 single-use on
(ncr_record, disposition), fail-closed, the honest no-GL shapes, the sole
INV-035 bypass, note 20) · **G-63** (the external quality costs: DR
QUALITY_EXPENSE 5320 · CR the EXISTING EXTERNAL_ACCRUAL 2137 — the CAPA leg +
the calibration create act, the cost + the journal link in ONE guarded CAS) ·
ACCOUNTING_INVARIANTS **INV-035** (the batch quality-hold blocking on every
baseline issue/ship path — ONE shared gate inside planIssue, the sole bypass
the G-62 write-off, the offline leg the same plan) · BUSINESS_RULES
**BR-101…BR-104** (the disposition-linked release · the NCR closure gate · the
CAPA effectiveness gate · the COA tolerance gate) + **THE ID_LEDGER FLIP atomic
with the canon rows** (implemented **G 63 · INV 35 · BR 104**; reservations 14
phases · 30 ids; 0 errors + the self-test all-probes-OK — the probe-7 fixture
moved to G-64/PHASE-051, claimant PHASE-052, the W-15 precedent's sixth move)
+ **THE COMPLETION REPORT** (the cumulative wave table W-24…W-32 · the ledger
#1–#10 CLOSED with every wave's evidence pointers · the battery scope map · the
FULL unit-package table 167 · 2,020 = 976+204+840 EXACT · ROUTE_PERMISSIONS
1,159 with the five binding waves · the honest catches' log — TWELVE across the
phase, every one RED-proven then repaired · the open-items log transferred
explicitly: the 049 report §4's standing recalls verbatim + RISK-033 at EIGHT
with ZERO new across W-24…W-32 · the PHASE-051 handoff) + **THE TRIPLE FLIP**
(the phase doc header → COMPLETE · the IMPLEMENTATION_STATUS row → COMPLETE ·
this file → PHASE-051) + **THE STEP-2 FULL SWEEP AT THE FINAL HEAD** (the
isolates first · the FULL ten-part envelope at 300 · the standing battery every
check green · the gate record `audit-evidence/phase050-w32/`) + **THE ARCHIVE
`ERP_PLATFORM_PHASE050.zip` EXACTLY AS DECLARED (F-4/§5 — the archive-form
acknowledgment executed: FLAT, the commit-hash as the FIRST ENTRY — the physical
shape of 049, ADDITIVE-ONLY, EXCLUDING every standing platform zip: أرشفة
الأرشيف ممنوعة — the members byte-verified, the standing zips verified
untouched)** + **THE TAG `phase/050`** (DELIVERY, never acceptance — the §1a (a)
ruling; the tag lands at the archive head).

**The phase's final state:** the chain **118** · ENTITY_CATALOG **340** · the
drift **347 = 347** · the registry **315 tenant-owned tables** ·
ROUTE_PERMISSIONS **1,159** · **the report registry 122** · i18n **7,253 =
7,253 + mobile 371** · the unit battery **167 · 2,020** (api 78·976 · web
30·204 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 ·
domain-core 6·38 · sync-core 5·36) · **the DB roster 300** (the quality family
17 · 188; the full ten-part envelope at the closure's final head) · depcruise
**2,195 · 16,411** · docs:validate 33/33 · id-ledger 0 errors + self-test OK
(implemented **G 63 · INV 35 · BR 104**) · history-secrets 0 violations.

**PHASE-051 (Foreign Trade & Logistics):** the COA print patterns and the
bilingual print pipeline shipped here are reused for trade certificates
(certificate of origin/analysis); the batch-hold blocking service — the ONE
shared gate inside the movement core — is the precedent for bonded-warehouse
movement restrictions on stock. The owner continues with «ابدأ تنفيذ المرحلة
PHASE-051». **Delivered as delivery — NOT production approval.**

---

**W-31 — THE PROOF PACK (T-18, delivered on the W-30 head `ab3beda` in
two commits — `ca52143` the specs + the affected folders → this
battery/gate/ledger increment, EVERY step pushed at its own commit per
the owner's «عند الانتهاء من أي خطوة ادفعها إلى المستودع»):** the
golden transcripts G-62/G-63 with the MANDATORY failure packs (the
JOURNAL_RULES §7 law) + the INV-035 blocking-matrix golden + the
offline-rejection shape (D-20/OA-02) + the RLS attack matrix A1–A10 ×
12 (the composite-FK law) + the OA-06 EXPLAIN budgets — **#1…#9 ALL
GREEN; only #10 (the W-32 closure) remains.** The family 167 → 188
(17 files); the roster 297 → 300, VERDICT: COVERED. The battery: the
five isolates (soak 228.67s) · the affected folders (17·188 · 2·28) ·
the scratch ×2 · typecheck 8/8 · lint 8/8 (no catch this wave) ·
depcruise 2,195 · 16,411 (+3/+35) · unit 167 · 2,020 standing · i18n
7,253 standing + mobile 371 · drift 347 = 347 · manifests 13/13 ·
docs:validate 33/33 · id-ledger 0 errors + self-test OK ·
history-secrets 0 violations · 6,790 (the FOUR tag anchors untouched)
· ROUTE_PERMISSIONS 1,159 · the report registry 122 · capabilities
agree · shells PASS/PASS · boundary PASS. RISK-033: EIGHT incidents,
ZERO new this wave.

**PREVIOUS WAVE (W-30 — the review pack + the reports):** **the golden transcripts G-62/G-63 with the MANDATORY failure
packs** (the refusals WITH their full payloads, the zero residue, the
flip-and-restore with the green re-runs — the JOURNAL_RULES §7 law, the
048-W14/049-W22 pattern) + **the INV-035 blocking-matrix golden** (the
held batch refused on EVERY baseline path + the offline-rejection
shape) + **the RLS attack matrix A1–A10 over the TWELVE tables** (D-19)
+ **the OA-06 EXPLAIN budgets** (the SPC chart reads + the recall drill
— the W-9 assertion law: never a forced plan, never an isolated probe
context). The standing recalls as transferred in the 049 completion
report §4; the reservations G-62…G-63 · INV-035 · BR-101…BR-104 — لا
كتابة خارجها. NOT production approval.

---

**W-30 — THE REVIEW PACK + THE REPORTS (T-16 + T-17, delivered on the
W-29 head `87153f8` in three commits — `dd08585` the engines →
`0de7ebe` the DB specs → this battery/gate/ledger increment, EVERY step
pushed at its own commit per the owner's «عند الانتهاء من أي خطوة
ادفعها إلى المستودع»):**

- **THE MANAGEMENT REVIEW PACK (T-16 — D-15):** the official
  MRV-{YYYY}-{SEQ:6} numbering + **THE FROZEN INDICATOR PACK** (at
  create the service reads the NCR/CAPA/complaint/SPC status counts
  through the engines' OWN store reads and freezes the pack into the
  row's jsonb — the frozen-snapshot law: a later state never moves a
  stored pack, proven by the spec) + the decisions array.
- **THE HAZARD REGISTERS (T-16 — Q-11):** the HACCP register CRUD per
  the 0116 table's own shape (the hazard, the CCP flag, the critical
  limits, the monitoring, the corrective actions) — the food-
  manufacturing template composes the quality plane (the template doc's
  QMS section; template-composable, never hardcoded; manifests 13/13).
- **THE FOUR REPORT CONTRACTS (T-17 — D-18, registry 118 → 122, ALL
  PIN SITES TOGETHER):** quality.ncr-register (the ncr-status-vocabulary
  check — no quantity totals across unlike units) · quality.capa-status
  (BR-103's gate figures through the same capaCloseGate fold the close
  act rides) · quality.calibration-due (the sweep's own probe shape —
  the thresholds ladder ∪ [30,7,0], disjoint bands, the LATEST due
  dates — never running the sweep) · quality.complaints-summary (the
  grouped counts + the count-tie check) — the pin moves verified green
  in their own suites (4 · 36).
- **THE DB SPECS (the family 159 → 167):** quality-reviews-hazards 8
  arms (the frozen pack VERBATIM against the world's counts · the
  frozen-snapshot law · the hazard constraint law · the RLS boundary).
- **THE WIRING:** ROUTE_PERMISSIONS **1,152 + 7 = 1,159** (the FIFTH
  binding wave — the reviews three + the hazards four on the standing
  keys) · the error filter's rows in the same increment · the module
  wiring.

**The wave's battery (every log in `audit-evidence/phase050-w30/`, this
session — the FORTY-FIRST consecutive same-session wave):** §0a FIRST
(the remote verified at `0de7ebe` = the W-30 step-2 head; the FOUR
tags' six identifiers + the 049 tag intact) — then THE FIVE ISOLATES
STANDALONE FIRST (soak 1·1 228.09s · fcm 1·8 · email 1·5 · the cmms
sweep 1·4 · the quality calibration sweep 1·4) · the affected folders
(the quality family 14 · 167 · migrations + identity-flows 2 · 28 over
the 1,159 routes · the reporting family 4 · 36) · the coverage roster
(chunk-a 109 → 110 · the roster 296 → 297, VERDICT: COVERED) · the
118-chain scratch from zero TWICE · typecheck 8/8 (0 cached) · lint 8/8
(0 cached — no catch this wave) · depcruise clean 2,192 modules ·
16,376 dependencies (+8/+64) · unit 8/8 — 167 · 2,020 standing · i18n
7,253 = 7,253 standing (no delta — an API-DB wave) + mobile 371 = 371 ·
drift 347 = 347 · manifests 13/13 · docs:validate 33/33 · id-ledger 0
errors + self-test all-probes-OK · history-secrets 0 violations · 6,762
allowlisted (the FOUR tag anchors untouched) · ROUTE_PERMISSIONS 1,159
(the tsx recount) · the registry 315 tenant-owned tables · the report
registry **122** · capabilities agree · shells PASS/PASS · boundary
PASS. RISK-033: EIGHT incidents, ZERO new this wave.

**NEXT: W-32 — DOCS + GATES + CLOSURE (T-19 + T-20)** after W-31: the
canon docs in the ID_LEDGER's reserved wordings (JOURNAL_RULES G-62/G-63
+ note 20 · ACCOUNTING_INVARIANTS INV-035 · BUSINESS_RULES
BR-101…BR-104 — لا كتابة خارجها) + THE ID_LEDGER FLIP + the full sweep
at the final head + the completion report + the triple flip + **THE
ARCHIVE ERP_PLATFORM_PHASE050.zip EXACTLY AS DECLARED (F-4/§5)** + the
tag `phase/050` (DELIVERY, never acceptance). NOT production approval.

**W-29 — THE WEB PLANE (T-15, delivered on the W-28 head `f2148e5` in
three commits — `6171b09` the screens → `f749298` the specs → this
battery/gate/ledger increment, EVERY step pushed at its own commit per
the owner's «عند الانتهاء من أي خطوة ادفعها إلى المستودع»):**

- **THE SIX QUALITY SCREENS (D-17):** `/quality/ncr` (the register +
  intake panes, the disposition + close acts) · `/quality/capa` (the
  root-cause + external-cost + close acts) · `/quality/calibration`
  (the register + create + THE SWEEP-CONFIG surface — the thresholds
  ladder VERBATIM) · `/quality/spc` (the measurements + THE CHART READ
  rendered VERBATIM — grandMean/rBar/limits/sigmaHat/cp/cpk/
  excludedCount/outOfControl + the subgroups table; rides the
  `quality.spc` feature key) · `/quality/complaints` (the ladder acts)
  · `/quality/coa` (the certificates register + the generate act + THE
  PRINT PREVIEW) — the 048/049 board patterns' laws: every figure an
  ENGINE OUTPUT rendered VERBATIM (zero client-side recomputation),
  the segmented Button switches (never the Tabs primitive), the
  typed-refusal panels with FULL payloads, the one-line localized
  refusals (`localizedQualityError` — all 33 codes), the mono cells
  dir=ltr, the DataTable + activeLocaleHeader columns, the token-class
  chips.
- **THE COA PRINT (the W-13/W-21 print laws):** the builder
  (`lib/coa-print.ts` — bi() EXCLUSIVELY, zero parallel computation,
  the frozen parameters VERBATIM, .num LTR-mono, a real thead,
  determinism — no wall-clock) + the preview Dialog + Print-now +
  **THE REAL CHROMIUM TEST both directions**
  (`quality-coa-print-render.db.spec` 3 arms — both locales' html
  assertions (thead + dir + the numeric class + the embedded woff2) +
  the REAL PDF render (%PDF, pages ≥ 1, byteLength > 10_000) + the
  determinism arm (two builds byte-identical + two renders
  byte-identical modulo the renderer's own Skia /CreationDate +
  /ModDate clock stamps — the probe-evidenced finding, dated in the
  spec)) + the web print spec (3 arms: dictionary-exclusivity ·
  determinism · VERBATIM figures).
- **THE HOLD BANNERS:** the shared `batch-hold-banner.tsx` (role=status,
  the warning tokens, the reason + heldAt VERBATIM, the NCR link)
  wired into the inventory batches registry + the manufacturing
  genealogy surface (one parallel active-holds read per surface,
  additive, degrading to no banners on a 403; the row chip + the full
  banners).
- **THE WIRING:** the six NAV_ITEMS rows (orders 75-80, the closed icon
  registry; the flag-gating verified — `quality` ×5 + `quality.spc` on
  the SPC row + the permission keys + both label sides; the ⌘K palette
  inherits them through resolveNavigation, OA-04) + the six
  FALLBACK_CRUMBS + **i18n BY BOTH COUNTS (the first-surface-wave
  law): 6,955 + 298 = 6,955 + 298 — ar=7,253 = en=7,253, 100% parity**
  + mobile 371 standing + the api-types row mirrors.
- **THE SPECS (the web suite 21·171 → 30·204):** the six board specs
  (5/4/4/4/4/3 arms — the listing-verbatim/AR-parity/exact-act-bodies/
  typed-refusal-full-payload shapes) + the banner spec (3 arms) + the
  nav-rows flag-gating spec (3 arms) + the print spec (3 arms).

**The wave's battery (every log in `audit-evidence/phase050-w29/`, this
session — the FORTIETH consecutive same-session wave):** §0a FIRST (the
remote verified at `f749298` = the W-29 step-2 head; the FOUR tags' six
identifiers + the 049 tag intact) — then THE FIVE ISOLATES STANDALONE
FIRST (soak 1·1 227.96s · fcm 1·8 · email 1·5 · the cmms sweep 1·4 ·
the quality calibration sweep 1·4) · the affected folders (the quality
family 13 · 159 · migrations + identity-flows 2 · 28 over the 1,152
routes) · the coverage roster (chunk-a 108 → 109 · the roster 295 →
296, VERDICT: COVERED) · the 118-chain scratch from zero TWICE ·
typecheck 8/8 (0 cached) · lint 8/8 (0 cached — no catch this wave) ·
depcruise clean 2,184 modules · 16,312 dependencies (+24/+174) · unit
8/8 — 167 · 2,020 (the ledger arithmetic 2,020 = 976+204+840 EXACT) ·
i18n 7,253 = 7,253 (+298 both sides — the declared delta) + mobile 371
= 371 · drift 347 = 347 · manifests 13/13 · docs:validate 33/33 ·
id-ledger 0 errors + self-test all-probes-OK · history-secrets 0
violations · 6,723 allowlisted (the FOUR tag anchors untouched) ·
ROUTE_PERMISSIONS 1,152 standing (no new routes — a surface wave) · the
registry 315 tenant-owned tables · capabilities agree · shells PASS/PASS
· boundary PASS. RISK-033: EIGHT incidents, ZERO new this wave.

**NEXT: W-31 — THE PROOF PACK (T-18)** after W-30: the golden
transcripts G-62/G-63 with the MANDATORY failure packs + the INV-035
blocking-matrix golden + the RLS attack matrix A1–A10 over the TWELVE
tables + the OA-06 EXPLAIN budgets. The standing recalls as transferred
in the 049 completion report §4; the reservations G-62…G-63 · INV-035 ·
BR-101…BR-104 — لا كتابة خارجها. NOT production approval.

**W-28 — THE COMPLAINTS + HOLDS + RECALL ENGINES (T-12 + T-13 + T-14,
delivered on the W-27 head `2f24c95` in three commits — `edc3fe2` the
engines → `a6d4685` the DB specs → this battery/gate/ledger increment,
EVERY step pushed at its own commit per the owner's «عند الانتهاء من أي
خطوة ادفعها إلى المستودع»):**

- **THE SHARED BLOCKING VALIDATION SERVICE (T-13 — INV-035 + BR-101,
  D-07: ONE service, the ONLY gate):** the pure fold FIRST
  (`hold-blocking.ts` — the deterministic refusal-target selection
  (batchId ASC; the caller's slice order is NEVER evidence, invariance
  under permutation ×50) + BR-101's release gate (NOT_ACTIVE /
  DISPOSITION_LINK_REQUIRED naming what is missing) — 10 property
  tests); **the gate wired INSIDE the movement core's planIssue** (the
  reserved-pool hard-protection precedent's own choke point — every
  issue/ship path passes it BY CONSTRUCTION, the enforcement-drift risk
  closed structurally): fired after resolveIssueSlices so it judges the
  RESOLVED plan (the line's explicit batch AND the FEFO auto-pick
  alike — a held batch is never silently issued), BEFORE any slice is
  valued or applied (the caller's document keeps its state, ZERO
  residue), one read over the partial unique
  uq_batch_quality_holds_tenant_batch_active; the typed 409
  BATCH_QUALITY_HELD naming the batch + the reason + the figures;
  **THE SOLE BYPASS** — `allowHeldBatch` carried by EXACTLY ONE path,
  the G-62 write-off (the NCR disposition act: the SCRAP write-off
  lands AT the disposition while the investigating hold may still be
  ACTIVE — BR-101's own ordering); **THE SERVER-SIDE-ONLY LAW
  (D-20/OA-02)** — an offline document carrying a held batch is
  rejected at sync reconciliation when its POST runs this same plan; the
  register's own surface (`HoldService`: the create with the
  one-active-per-batch typed pre-check · the active-hold read the W-29
  banners consume · BR-101's release with the disposition-link refusal
  at the service floor above the ck_release_shape DB floor).
- **THE COMPLAINTS ENGINE (T-12 — Q-08):** the pure fold FIRST
  (`complaint-lifecycle.ts` — the total status × move matrix
  NEW→TRIAGED→IN_PROGRESS→RESOLVED→CLOSED, every illegal cell refused BY
  NAME · the NCR-link window (TRIAGED/IN_PROGRESS only) · the
  resolution-pair law — 12 property tests); the service (the official
  CMP-{YYYY}-{SEQ:6} numbering · the triage act carrying the first NCR
  link · the link through the register's OWN row · the resolve pair
  landing together · every transition ONE guarded CAS) + THE INTAKE
  NOTIFICATION (category 'quality' — the calibration sweep's own
  channel, 0118's widening; the structural dedupe on the complaint's
  own number).
- **THE RECALL ENGINE (T-14 — Q-09/Q-12, D-14: the drill RECORD is
  distinct from the drill QUERY):** the pure fold FIRST
  (`recall-scope.ts` — the registry ladder + THE CUSTOMER FOLD (dedupe
  across every sale edge, deterministic sorts, the missing-lookup drop
  honestly disclosed) — 10 property tests); the service (THE DRILL
  QUERY: the genealogy walk consumed VERBATIM through
  ManufacturingModule's exported GenealogyService (the documented D-14
  contract — zero parallel computation) + the doc→customer lookup (the
  §10 boundary's designated consumer, one UNION read over the sales doc
  tables joined to the partner register) · THE RECORD: the official
  REC-{YYYY}-{SEQ:6} numbering, the execute act freezing the
  kind-tagged where-used array + the affected-customers array (0116's
  own jsonb-array law), the close sealing the ladder).
- **THE DB SPECS (the family 139 → 156):** `quality-holds.db.spec` 8
  arms (THE INV-035 BLOCKING MATRIX: the raw choke point · the manual
  issue path with ZERO residue · the sales delivery path (the document
  stays DRAFT) · the transfer path (the FEFO-resolved pick) · the FEFO
  arm itself · the sole bypass (the G-62 write-off on the HELD batch) ·
  the release rule with the flip-and-restore (the previously refused
  issue posts GREEN after the linked release) · the register's floors +
  the RLS boundary) · `quality-complaints.db.spec` 5 arms (the intake +
  the notification · the ladder · the link window · the
  resolution-pair floor · the RLS boundary) · `quality-recall.db.spec` 4
  arms (the drill query · the record with the frozen snapshots + the
  frozen-snapshot law (a later delivery never moves a stored scope) ·
  the held batch's own recall (the record is not the gate) · the RLS
  boundary + the not-found floor) + the fixtures' blocking worlds (the
  hold world + the FEFO pair through the REAL receipt path + the
  delivery/transfer singletons + the ownerTarget substrate per the QSW
  recipe).
- **THE HONEST CATCHES (three, all RED-proven, no battery red
  standing):** (1) the execute act's scope snapshot was a jsonb OBJECT —
  0116's ck_recall_registry_scope_shape demands an ARRAY (caught at the
  FIRST DB run, `db-first-run-RED.log`, 4 failed; the repair is the
  kind-tagged where-used entries array); (2) the intake arm's unquoted
  dedupe-key interpolation (the syntax error at ':') + the fixture
  codes' length (the warehouses' 20-char shape) + the missing
  ownerTarget substrate — all caught by the same first run;
  parameterized, the codes shortened, the QSW-recipe OWNER membership
  seeded idempotently; (3) the step-1 hold-blocking spec's shuffle
  helpers carried Math.floor — caught RED by this gate increment's
  standing lint (`lint-RED.log`, 7/8, the ADR-0009 rule), repaired with
  the house bitwise truncation (the W-27 catch's own precedent), GREEN
  8/8. A fourth family-run catch: the manual-issue arm's zero-residue
  journal read was tenant-wide (the family's other worlds legitimately
  carry their own) — the read is now world-scoped to the arm's own
  item.
- **THE WIRING:** ROUTE_PERMISSIONS **1,134 + 18 = 1,152** (the
  keys-seed-first FOURTH binding wave, dated at the block: the
  complaints eight on quality.complaints.manage/quality.view · the holds
  four on quality.hold.manage/quality.view — the BLOCKING side of
  INV-035 is NOT a route · the recall six on quality.recall.manage/
  quality.view, the drill route declared BEFORE :id) · the error
  filter's domainStatus rows in the same increment (the three 404s; the
  409s incl. BATCH_QUALITY_HELD; the policy classes fall through to
  422) · GenealogyService exported from ManufacturingModule (the D-14
  documented contract, dated at the export).

**The wave's battery (every log in `audit-evidence/phase050-w28/`, this
session — the THIRTY-NINTH consecutive same-session wave):** §0a FIRST
(the remote verified at `a6d4685` = the W-28 step-2 head; the FOUR tags'
six identifiers + the 049 tag intact; the tree clean at HEAD) — then
**THE FIVE ISOLATES STANDALONE FIRST** (soak 1·1 229.01s · fcm 1·8 ·
email 1·5 · the cmms sweep 1·4 · the quality calibration sweep 1·4 —
every VITEST_EXIT=0 stamp) · **the affected DB folders re-run at the
delta head** (the scope-label law): **the quality family 12 · 156
GREEN** (the family 139 → 156) · **migrations + identity-flows 2 · 28
GREEN** (the chain at 118 + the ROUTE_PERMISSIONS checklist over the
1,152 routes) · the coverage roster verified (chunk-a 105 → 108 · the
roster 292 → 295; 295 = 295, missing NONE, extra NONE, duplicates NONE —
VERDICT: COVERED; the full ten-part envelope re-runs at W-32) · **the
118-chain scratch from zero TWICE** (both runs CHAIN_118_APPLIED →
[check-rls] OK — **340 catalog tables** → SCRATCH_STOPPED, EXIT=0, both
logs kept) · typecheck 8/8 (0 cached — the force re-run) · lint 8/8 (0
cached — the RED/repair disclosed above) · depcruise clean **2,160
modules · 16,138 dependencies** (+13/+64 dated) · unit 8/8 — **158 ·
1,987** (api **78·976** · web 21·171 · mobile 27·393 · desktop 16·274 ·
ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the
ledger arithmetic **1,987 = 976+171+840 EXACT**, the F-2 third term
standing) · i18n 6,955 = 6,955 (no delta, as declared — an API-DB wave)
+ mobile 371 = 371 · tokens 50/50 · **drift 347 = 347** (zero delta — no
new keys) · manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors +
self-test all-probes-OK (implemented G 61 · INV 34 · BR 100 standing —
the 050 flip is W-32's; probe 7 stands at G-62/PHASE-050) ·
history-secrets 0 violations · 6,687 allowlisted hits (the window's
shift: the W-28 session commits entering the last-200 sample; the FOUR
tag anchors untouched) · ROUTE_PERMISSIONS **1,152** (the tsx recount) ·
the registry 315 tenant-owned tables · capabilities agree · shells
PASS/PASS · boundary PASS. RISK-033: EIGHT incidents, ZERO new this
wave.

**NEXT: W-30 — THE REVIEW PACK + THE REPORTS (T-16 + T-17)** after
W-29: the management review pack + the hazard registers composed into
the food-manufacturing template manifest (D-15); **the four report
contracts (registry 118 → 122, all pin sites together — D-18)**. The
standing recalls as transferred in the 049 completion report §4; the
reservations G-62…G-63 · INV-035 · BR-101…BR-104 — لا كتابة خارجها. NOT
production approval.

**W-27 — THE SPC + SUPPLIER SCORES + COA ENGINES (T-09 + T-10 + T-11,
delivered on the W-26 head `94c4dc6` in three commits — `20255ac` the
engines → `fa71b27` the DB specs → this battery/gate/ledger increment,
EVERY step pushed at its own commit per the owner's «عند الانتهاء من أي
خطوة ادفعها إلى المستودع»):**

- **THE SPC PLANE (T-09 — D-12, the pure module FIRST):**
  `spc-statistics.ts` THE ONLY SPC ARITHMETIC IN THE MODULE — the pinned
  Shewhart constants table n=2…10 (A₂/D₃/D₄/d₂ at 3dp) · the subgroup
  chunk with the trailing partial group EXCLUDED and disclosed
  (`excludedCount` — a partial group is not evidence) · X̄ᵢ/rᵢ at 6dp ·
  X̄̄±A₂R̄ / D₃R̄/D₄R̄ · σ̂=R̄/d₂ · Cp=(USL−LSL)/6σ̂ and
  Cpk=min(USL−X̄̄, X̄̄−LSL)/3σ̂ against the SPECIFICATION band
  (one-sided/unset → NULL, the no-fabrication law) · the out-of-control
  flags judging the PUBLISHED figures (the closed-interval law — ON a
  limit is within) · the degenerate R̄=0 collapse (null σ̂/Cp/Cpk) — with
  **13 property tests on THREE PINNED REFERENCE DATASETS** (A stable: Cp
  1.163000 EXACT · Cpk 1.114542 · UCLx 10.255800 · B the X-chart mean
  shift — the fifth subgroup flagged ABOVE · C the R-chart range spike —
  flagged on R only) + the constants-table shape walk + the order-freedom
  ×50 + the independent JS-oracle ×100. The SpcService: the ingestion
  with the 0113 source vocabulary + the batch provenance through the
  inventory store's own read; THE CHART READ feeds the PURE module and
  returns its output VERBATIM — zero parallel computation; the DESC-cap
  law (the newest 20 samples charted).
- **THE SUPPLIER QUALITY SCORES (T-10 — D-13):** the pure fold
  (`supplier-score.ts` — the pinned 0.60/0.40 defect/delivery blend · the
  unmeasured zero shape · the drag cap · monotonicity · convexity bounds
  ×200 — 10 property tests); the rolling fold reading the module's OWN
  register (ncrCount) + the goods-receipt FAIL inspections + the
  delivery window MIRRORING the 038 readScorecardWindow's law VERBATIM ·
  the calendar-month period law YYYY-MM-01 · the idempotent upsert on the
  (tenant, partner, period_start) natural key · **THE DOCUMENTED 038 FEED
  CONTRACT** — the purchasing scorecards' recompute detail carries
  qualityFeed: the quality module's own rows read VERBATIM through its
  store (the consumer READS, never re-computes; absent rows the honest
  empty array; the 038 debit-note quality leg stands untouched).
- **THE COA GENERATION SERVICE (T-11 — BR-104, D-11):** `coa-gate.ts`
  the pure three-shape fold COMPOSING the tolerance fold (the module's
  ONLY evaluator, W-25's law — WITHIN/UNBANDED pass · OUTSIDE fails
  naming the parameter + BOTH figures · OUTSIDE+accepted-NCR passes as
  DEVIATION_ACCEPTED with the tolerance verdict kept honest (ABOVE_UCL,
  never re-judged) · the coverage law: missing/foreign/duplicate each
  block, named — 11 tests); the service with the batch/inspection
  provenance floors through the mapping contract's own chain incl. the
  GRN per-line resolution · the accepted-deviation NCR validation (the
  register's own row, this item's, ACCEPT-dispositioned) · the official
  COA-{YYYY}-{SEQ:6} numbering (both certificate types one sequence) ·
  **THE FROZEN SNAPSHOT** stored verbatim (a later spec PATCH never moves
  a stored certificate).
- **THE DB SPECS (the family 114 → 139):** `quality-spc.db.spec` 8 arms
  (the chart read vs the pure module VERBATIM on the pinned dataset A —
  the DB's own numeric(19,6) canonical strings feeding the independent
  fold · the DESC-cap law · the trailing partial group · the ingestion
  floors with the NEGATIVE VALUE LEGAL arm (a temperature can be −5) ·
  the RLS boundary — the isolated tenant's chart is the 404 shape) ·
  `quality-supplier-scores.db.spec` 8 arms (the pinned world through the
  REAL purchasing services: PO → issued → GRN → POSTED through the REAL
  engine, G-07's own path + one FAIL inspection + one SUPPLIER NCR →
  ncrCount 1 · rejectionCount 1 · total 2 · onTime 1 → the pinned blend
  defectLeg 0 · deliveryLeg 50 · score 20.00 · the idempotent upsert ·
  the unmeasured zero · the feed contract + the honest empty shape · the
  window law) · `quality-coa.db.spec` 9 arms (BR-104's three shapes incl.
  the Arabic parameter names in the frozen snapshot · the zero-residue
  refusal · the deviation floors · the provenance floors · the frozen
  snapshot · the RLS boundary) + the fixtures' supplier world
  (freshQualitySupplier + seedSupplierDelivery — the FULL real chain, the
  delivery evidence the 038 window read's own law, never a parallel
  computation).
- **THE HONEST CATCHES (two, both RED-proven, no battery red standing):**
  (1) the step-1 store's `spc_measurements` INSERT carried `note_ar` — a
  column the 0113 table does NOT have (the samples are operational rows;
  the bilingual note_ar is the master-data registers' shape) — caught RED
  at the FIRST DB run (`db-first-run-RED.log`, the 42703 refusing the
  INSERT BY NAME, 8 failed); the repair removes note_ar from the store
  row, the service input and the controller schema with the dated
  comment; GREEN 9·139. (2) the step-1 `spc-statistics.ts:131`
  `Math.floor` caught RED by THIS gate increment's standing lint (the
  ADR-0009 rule, `lint-RED.log` kept 7/8); the repair is the house
  bitwise integer-floor pattern with the dated comment (a pure subgroup
  COUNT, never a rounded measurement — the operands bounded by the
  DESC-cap law); GREEN 8/8 with the affected folders re-run at the final
  head (the quality family 9·139 · the api unit 75·944 — the repair
  changes NO figure on the positive count domain).
- **THE WIRING:** ROUTE_PERMISSIONS **1,125 + 9 = 1,134** (the
  keys-seed-first THIRD binding wave, dated at the block: the SPC
  chart/measurement reads on quality.spc.view + the ingestion on
  quality.manage · the supplier reads + the feed door on quality.view +
  the recompute on quality.manage · the COA generation on
  quality.coa.generate + reads on quality.view) · the error filter's
  domainStatus rows in the same increment (the two new 404s; the policy
  classes fall through to 422, the family law).

**The wave's battery (every log in `audit-evidence/phase050-w27/`, this
session — the THIRTY-EIGHTH consecutive same-session wave):** §0a FIRST
(the remote verified at `fa71b27` = the W-27 step-2 head; the FOUR tags'
six identifiers + the 049 tag intact; **THE EIGHTH ENVIRONMENT RESET
RECOVERED** — the fresh clone, pnpm 9.15.9, the workspace install, the
persistent-store embedded-PG16 binaries re-linked, the chromium 1200/1248
shells provisioned BEFORE the runs) — then **THE FIVE ISOLATES STANDALONE
FIRST** (soak 1·1 229.30s · fcm 1·8 15.65s · email 1·5 · the cmms sweep
1·4 · the quality calibration sweep 1·4 — every VITEST_EXIT=0 stamp) ·
**the affected DB folders re-run at the delta head** (the scope-label
law): **the quality family 9 · 139 GREEN** (the schema 59 + the specs 11
+ the NCR 13 + the CAPA 17 + the calibration 10 + the sweep 4 + the SPC 8
+ the supplier scores 8 + the COA 9 — the family 114 → 139) ·
**migrations + identity-flows 2 · 28 GREEN** (the chain at 118 + the
ROUTE_PERMISSIONS checklist over the 1,134 routes) · the coverage roster
verified (chunk-a 102 → 105 · the roster 289 → 292; 292 = 292, missing
NONE, extra NONE, duplicates NONE — VERDICT: COVERED; the full ten-part
envelope re-runs at W-32) · **the 118-chain scratch from zero TWICE**
(السلسلة من الصفر مرتين: both runs CHAIN_118_APPLIED → [check-rls] OK —
**340 catalog tables** → SCRATCH_STOPPED, EXIT=0, both logs kept) ·
typecheck 8/8 (0 cached — the force re-run) · lint 8/8 (0 cached — the
RED/repair disclosed above) · depcruise clean **2,147 modules · 16,074
dependencies** (+12/+82 dated) · unit 8/8 — **155 · 1,955** (api
**75·944** · web 21·171 · mobile 27·393 · desktop 16·274 · ui 3·43 ·
contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the ledger
arithmetic **1,955 = 944+171+840 EXACT**, the F-2 third term standing) ·
i18n 6,955 = 6,955 (no delta, as declared — an API-DB wave) + mobile 371
= 371 · tokens 50/50 · **drift 347 = 347** (zero delta — no new keys) ·
manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors + self-test
all-probes-OK (implemented G 61 · INV 34 · BR 100 standing — the 050 flip
is W-32's; probe 7 stands at G-62/PHASE-050) · history-secrets 0
violations · 6,654 allowlisted hits (the window's shift: the W-27 session
commits entering the last-200 sample; the FOUR tag anchors untouched) ·
ROUTE_PERMISSIONS **1,134** (the tsx recount) · the registry 315
tenant-owned tables · capabilities agree · shells PASS/PASS · boundary
PASS. RISK-033: EIGHT incidents, ZERO new this wave.

**NEXT: W-29 — THE WEB PLANE (T-15)** after W-28: the five screens +
the COA print surface + the hold banners on every batch-bearing surface
(D-17 — the data-slot shape; **i18n BY BOTH COUNTS from W-29 — the first
surface wave: the declared delta 6,955+n = 6,955+n + mobile 371
standing**); the boards render the engines' figures VERBATIM; the COA
print law (the REAL Chromium test both directions, deterministic
byte-identical). The standing recalls as transferred in the 049
completion report §4; the reservations G-62…G-63 · INV-035 ·
BR-101…BR-104 — لا كتابة خارجها. NOT production approval.
