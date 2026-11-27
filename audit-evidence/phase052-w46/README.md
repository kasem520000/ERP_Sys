# PHASE-052 W-46 (THE BRIDGE) evidence — 2026-11-27 (T-05; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-46 step-1
head's tree (step 1 `545e1ca` pushed at its own completion per the
owner's standing order «عند الانتهاء من أي خطوة ادفعها إلى
المستودع»; the same-session evidence rule, the FIFTY-EIGHTH
consecutive wave). The wave is the APPROVED PLAN's §3 W-46 under the
owner's launch authorization (إذن إطلاق ONLY, NEVER production
approval — تسليم لا قبول; the reservations G-67 · INV-037 — NO BR
this phase — لا كتابة خارجها).

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ 545e1ca` (the W-46 step-1 head,
  pushed at its own completion) · `phase/051` = `c5175ff` (annotated
  `38b444e`) · `phase/050` = `01f61a7` · `phase/049` = `41c3701` ·
  `phase/048` = `ba459ff` · `phase/047` = `5b73bd1` · `phase/046` =
  `4ddb39f` — **the five annotated predecessors' identifiers + the 051
  tag intact** (re-proven by this session's history-secrets run: all
  SIX anchors walked, 0 violations).
- The working tree is this session's own continuation of the W-43…
  W-45 sessions' environment (node v24.22.3 · pnpm 9.15.9 · the
  workspace install · the embedded-PG16 16.14 binaries) — 0 skipped on
  every run below.

## The wave's acts (step 1 pushed + this gate increment)

1. **STEP 1 — THE CONVERSION TOOL + THE COMPLETION-LAW FIX**
   (`545e1ca`): the PolicyBridgeService (D-12's four-mode mapping +
   the origin_policy_id + the idempotence + the SUPERSEDED handling +
   the doc-type mapping + the threshold canonicalization + the
   entitlement gate + the audit seal) + the engine's completedSteps
   parity figure + the ChainVerdict widened + THE JOURNAL'S COMPLETION
   LAW (the W-44 fall-through's latent double-gate corrected) + the
   module wiring.
2. **THE GATE INCREMENT** (this commit): the bridge DB spec + the
   wave's exit battery (this envelope) + the ledger's W-46 dated note
   (**ACCEPTANCE #9 GREEN**) + the NEXT_ACTION + IMPLEMENTATION_STATUS
   dated headers.

## THE BRIDGE SPEC — workflow-bridge.db.spec, 7 arms ALL GREEN (acceptance #9's own proof)

The mode-per-tenant design (the policies are per-(doc_type,
applies_from) — one tenant converts ONE latest journal_entry policy;
every mode's world its own tenant; the REAL JournalService's own acts
on both sides of every parity):

| Arm | The proof |
|---|---|
| (a) THE SINGLE-APPROVER PARITY | the same verdicts and stamps before/after (one act by the owner, approval_step 1); the SoD parity (the owner's own journal blocked both sides — the legacy SelfApprovalBlocked / the chain's G-67); THE APPROVER-CLASS NARROWING disclosed (a third user the legacy allowed, the chain refuses — D-12's owner-role mapping); the origin back-reference + the ROLE owner step |
| (b) THE TWO-STEP PARITY | two acts before, two acts after — NEVER four (the W-44 fall-through's latent double-gate corrected); approval_step 2 both sides |
| (c) THE AMOUNT-THRESHOLD BRANCH PAIR | ≤ threshold the one-step chain (the branch's SKIPPED stamp at trigger time); THE AT-LIMIT LAW (the total exactly at the threshold → the one-step chain — the BR-034 boundary); > threshold THE DECLARED MAPPING: the second approval level instead of the legacy refusal (the BEFORE side's ApprovalLimitExceeded disclosed as the honest delta); the step-2 condition asserted verbatim |
| (d) THE NONE + SUPERSEDED + UNMAPPED | the honest rows (NO_CHAIN_NEEDED · SUPERSEDED · UNMAPPED_DOC_TYPE); no definition lands; the none mode's submit-time auto-approval byte-identical |
| (e) THE IN-FLIGHT COMPLETION | a document submitted BEFORE the conversion finishes under the OLD semantics (ZERO instances for it — the instance never retro-created; the legacy two-step ladder carries it); a document submitted AFTER gates under the chain — the launch-time boundary recorded |
| (f) THE ENTITLEMENT GATE | the engine-off tenant: the bridge silent (no records, no definitions), the legacy path permanent |
| (g) THE IDEMPOTENCE | the re-run converts NOTHING (ALREADY_CONVERTED, no new definitions) |

## THE AFFECTED-FOLDER BATTERY (the mid-wave scope-label law — the full DB suite re-runs at the migration waves W-43/W-51; this wave runs its folders)

| Part | Files · Tests | Log |
|---|---|---|
| the workflow family (schema · engine · delegation/escalation · the sweep isolate · the bridge) | 5 · 80 | `db-affected-workflow-family.log` |
| the accounting affected specs (the golden · the periods · the projects (the AppModule booter) · the INV-011-022) | 4 · 28 | `db-affected-accounting.log` |
| the inbox writer + the standing category arm (cmms-schema) | 2 · 40 | `db-affected-inbox-cmms.log` |

Every stamp VITEST_EXIT=0 through the guarded wrapper. The DB roster
moves 319 → 320 (the bridge spec joins the family — parts.json
updated).

## THE STANDING BATTERY (every log this session, every stamp green, at the final code state)

| Check | Verdict | Log |
|---|---|---|
| typecheck | 8/8 | `typecheck.log` |
| lint | 8/8 | `lint.log` |
| depcruise | clean — 2,304 · 17,187 (+2/+22 dated — the bridge service + the spec; zero cycles) | `depcruise.log` |
| unit workspace | 8/8 — 189 files · 2,233 tests standing (no unit delta — the wave's own proof is the DB spec) | `unit-workspace.log` |
| ROUTE_PERMISSIONS | **1,215 standing** (the tsx recount — the bridge is service-layer, the routes land at W-47+) | `route-permissions-recount.log` |
| permissions drift | 366 = 366 standing (no key delta) | `permissions-drift.log` |
| i18n parity | ar=7,582 = en=7,582 standing (the surface waves are W-48's) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| docs:validate | 33/33 (re-verified at the final docs state — the ledger edits ride this increment) | `docs-validate.log` |
| id-ledger | 0 errors + self-test all-probes-OK (probe 7 stands at G-67/PHASE-052, claimant PHASE-053) | `id-ledger.log` / `id-ledger-self-test.log` |
| history-secrets | 0 violations · 7,947 allowlisted hits (the SIX tag anchors walked, all untouched) | `history-secrets.log` |
| capabilities | agree | `capabilities.log` |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

## THE HONEST CATCHES (each caught RED, repaired, and disclosed)

1. **THE W-44 FALL-THROUGH'S LATENT DOUBLE-GATE** (caught at the
   bridge's own design, corrected at step 1): the W-44 journal binding
   ran the LEGACY policy engine AFTER the chain completed — a two-step
   policy's ladder demanding its own acts after the chain's two (four
   acts for one approval), an amount-threshold policy REFUSING the
   very approval its branch pair just granted (the document stuck in
   PENDING_APPROVAL behind a terminal chain). Never exercised before
   the bridge because no chain+policy coexistence existed. THE
   CORRECTED LAW: on the chain's completion the module's own APPROVED
   transition lands DIRECTLY (approval_step = the chain's APPROVED
   step count; the legacy path only when NO chain exists).
2. **THE W-44 MODULE WIRING'S LATENT DI BUG — THE EXPLICIT @Inject
   LAW** (caught at this gate's affected-folder run): vitest's esbuild
   transform does NOT emit constructor design:paramtypes (tsc's
   emitDecoratorMetadata never runs there), so the WorkflowModule's
   plain typed constructor resolved `engine` and `escalation` to
   UNDEFINED under the app-booting specs — `bindWorkflowEngine(
   undefined)` — the gateway's null check passed (undefined !== null)
   and every journal submit crashed on `ENGINE.openChain`. The
   projects spec's AppModule boot + the golden spec's submits (in one
   process) surfaced it; the deterministic reproduction (projects →
   golden) confirmed it; the probe logs named the undefined bind. THE
   FIX: the explicit `@Inject(Token)` decorators (the platform's own
   controller convention — metadata-free by construction, immune in
   both worlds). **THE PLATFORM-WIDE LATENT CLASS DISCLOSED**: the
   other sweep-registering modules with plain constructors
   (fixed_assets · hr · trade) degrade silently under the same
   transform (their registrations ride the catch-and-continue; a
   candidate follow-up wave, NOT this wave's scope — recorded here as
   the honest boundary).
3. **THE JOURNAL'S AMOUNT LAW RE-LEARNED AT THE SPEC** (the (c) arm's
   first RED): `totalBaseAmount` sums EVERY line (DEBIT + CREDIT — the
   W-44 facts law verbatim), so a balanced pair at X per line reads
   2X; the arm's thresholds re-derived (2500/line → 5000 total ≤
   10000; 5000/line → 10000 the at-limit; 10000/line → 20000 > 10000).
4. The spec-shape catches: the memberships parameter count (the
   reused `$2` — 8 params on 7 placeholders) · the account-code
   collision (the per-journal codes derived from the arm code collided
   within a tenant — a global sequence landed).

RISK-033: EIGHT incidents, ZERO new this wave — the row stays OPEN,
closing only by the owner's order.

The reservations G-67 · INV-037 — NO BR this phase — لا كتابة خارجها.

NEXT: W-47 (deep links + tasks + the rules alerts — T-06 + T-08 +
T-07's rules half: the stateless HMAC fourth derivation with the CAS
single-use; the TASK step type end-to-end (no seventh table); the
rules-engine alert adapters as bus consumers) under the standing
order. NOT production approval — تسليم لا قبول.
