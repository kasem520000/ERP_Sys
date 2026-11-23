# PHASE-050 W-28 (THE COMPLAINTS + HOLDS + RECALL ENGINES) evidence — 2026-11-23 (T-12 + T-13 + T-14; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-28 step-2 head
`a6d4685`'s tree + this gate increment's own repair (the same-session
evidence rule, the **THIRTY-NINTH** consecutive wave — the owner's
standing record counts thirty-eight through the W-27 delivery). The wave
is the APPROVED PLAN's §3 W-28 under the owner's standing order — «طيب
واصل العمل وعند الانتهاء من أي خطوة ادفعها إلى المستودع» (every step
pushed at its own commit: `edc3fe2` the engines → `a6d4685` the DB specs
→ this gate increment): **T-12 the complaints engine (Q-08) · T-13 THE
SHARED BLOCKING VALIDATION SERVICE (INV-035 + BR-101 — D-07) · T-14 the
recall engine (Q-09/Q-12 — D-14).**

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ a6d4685` (the W-28 step-2 head —
  the wave's first two commits already on the remote, pushed at their
  own steps per the owner's order); `phase/049` @ `41c3701` ·
  `phase/048` @ `ba459ff` · `phase/047` @ `5b73bd1` · `phase/046` @
  `4ddb39f` — **the three annotated tags' six identifiers + the 049 tag
  intact** (the standing rule; re-verified by the history-secrets run's
  four anchors).
- The working tree: this session's clone (the W-27 recovery's own —
  pnpm 9.15.9, the workspace install, the persistent-store embedded-PG16
  binaries, the chromium 1200/1248 shells — every DB run below boots the
  embedded server fresh with the full chain from zero); the tree clean
  at HEAD at the wave's opening.

## The wave's acts (three delivery commits, each pushed at its own step)

1. **THE ENGINES** (`edc3fe2`): the pure layers FIRST (the unit-first
   law) — `hold-blocking.ts` (the deterministic refusal-target fold +
   BR-101's release gate, 10 property tests) · `complaint-lifecycle.ts`
   (the total status × move matrix + the NCR-link window + the
   resolution-pair law, 12 property tests) · `recall-scope.ts` (the
   registry ladder + THE CUSTOMER FOLD, 10 property tests) — then the
   services (the HoldService register surface · the ComplaintService
   with the CMP numbering + the intake notification · the RecallService
   with the drill query over the genealogy walk VERBATIM + the doc→
   customer lookup + the REC numbering + the frozen snapshots) · **THE
   GATE** (`hold-gate.ts` wired INSIDE the movement core's planIssue —
   the reserved-pool hard-protection precedent's own choke point; the
   sole `allowHeldBatch` bypass carried by the G-62 write-off) · the
   wiring (ROUTE_PERMISSIONS 1,134 + 18 = 1,152 — the FOURTH binding
   wave · the error filter's domainStatus rows · GenealogyService
   exported from ManufacturingModule per the D-14 contract).
2. **THE DB SPECS** (`a6d4685`): the three service specs over real PG16
   (`quality-holds.db.spec` 8 arms — the INV-035 blocking matrix ·
   `quality-complaints.db.spec` 5 arms · `quality-recall.db.spec` 4
   arms) + the fixtures' blocking worlds (the hold world + the FEFO
   pair through the REAL receipt path + the delivery/transfer
   singletons + the ownerTarget substrate per the QSW recipe) + the
   coverage roster's declared movement (**chunk-a 105 → 108 · the
   roster 292 → 295**; `parts.json` + the three coverage files — 295 =
   295, missing NONE, extra NONE, duplicates NONE — VERDICT: COVERED;
   the full ten-part envelope re-runs at W-32's final head) + the
   affected-folder runs at the delta head.
3. **THIS GATE INCREMENT** — the battery (below) + the evidence
   envelope + the ledger accumulation (the acceptance ledger's W-28
   dated note: #3's blocking arms + #7's drill arms + #2's complaints
   arms DELIVERED · NEXT_ACTION → W-29 · the IMPLEMENTATION_STATUS
   dated line) + the lint repair of this increment's own honest catch.

## THE HONEST CATCHES (four — all RED-proven with the logs, no battery red stands)

1. **The scope snapshot's jsonb shape (the 0109/0110 precedent, caught
   RED at the FIRST DB run before any push of the spec increment):** the
   execute act froze the scope as a jsonb OBJECT — 0116's
   `ck_recall_registry_scope_shape` demands an ARRAY (the typed refusal
   at the first run, `db-first-run-RED.log`, 4 failed). **THE REPAIR:**
   the kind-tagged where-used entries array (one entry per production +
   sale edge + the frozenAt witness) — the honest shape within the
   constraint.
2. **The same first run's companions:** the intake arm's dedupe-key
   lookup interpolated the key UNQUOTED into the raw SQL (the syntax
   error at ':') — parameterized; the fixture codes' length
   (`QL-WH-HOLD-DRILL-EMPTY` > the warehouses' 20-char shape) — the
   world codes shortened; the missing ownerTarget substrate (the QL
   tenant had no OWNER membership, so the intake notification was
   skipped) — the QSW recipe's membership seeded idempotently in the
   fixtures.
3. **The family-run catch:** the manual-issue arm's zero-residue journal
   read was TENANT-WIDE — the family's other worlds legitimately carry
   their own issue journals in the same tenant; the read is now
   WORLD-SCOPED to the arm's own item.
4. **THIS INCREMENT's own catch (the standing battery's design):** the
   step-1 `hold-blocking.spec.ts` and `recall-scope.spec.ts` shuffle
   helpers carried `Math.floor` — caught RED by the first lint run of
   this gate increment (`lint-RED.log`, 7/8, the ADR-0009 rule naming
   the file/line — the W-27 catch's own class, my own new code). **THE
   REPAIR:** the house bitwise truncation (`(x) | 0`) with the dated
   comment (a pure array position, far inside the 2^31 safe range);
   GREEN re-run 8/8, the affected spec files re-run green (10/10 each).

**The declared interpretations (three, the wave README's table):**

1. **THE GATE'S SCOPE (INV-035's own wording extended):** the gate
   judges the RESOLVED plan — the line's explicit batch AND the FEFO
   auto-pick alike. A held batch expiring first is never silently
   issued: the strict law REJECTS (the typed refusal names the batch),
   never a silent skip to the next batch — the operator explicitly
   issues a different batch or releases the hold.
2. **THE SOLE BYPASS (BR-101's own ordering):** the G-62 write-off
   (sourceType `ncr_record`) is the ONLY path that may issue a held
   batch — because the 0116 flow's own demand: the SCRAP write-off
   lands AT the disposition act, while the investigating hold may still
   be ACTIVE; the hold's release comes after, justified by this very
   disposition (the disposition-linked record). The QC quarantine
   dispose does NOT bypass (a held batch in quarantine releases the hold
   first — the QMS authority wins; no deadlock exists since the QC
   dispose is not the hold's release requirement).
3. **THE SCOPE SNAPSHOT'S SHAPE (0116's own law):** the frozen scope is
   the kind-tagged where-used ARRAY (one entry per production + sale
   edge + the frozenAt witness) and the affected customers their own
   array — the drill's full live shape stays available through the
   drill query; the record carries the executed paths' own evidence.

## The isolates — THE FIVE standing (the pre-isolation mandate, §0c (2))

| The FIVE isolates (STANDALONE FIRST) | Files · Tests | Log |
|---|---|---|
| soak | 1·1 — 229.01s | `db-isolate-soak.log` |
| fcm | 1·8 | `db-isolate-fcm.log` |
| email | 1·5 | `db-isolate-email.log` |
| the cmms sweep | 1·4 | `db-isolate-sweep.log` |
| the quality calibration sweep | 1·4 | `db-isolate-quality-sweep.log` |

Every stamp VITEST_EXIT=0 through the guarded wrapper.

## The affected DB folders — re-run at the delta head, this session (the scope-label law)

| Folder | Files · Tests | Log |
|---|---|---|
| the quality family | **12 · 156 GREEN** (the schema 59 · the specs 11 · the NCR 13 · the CAPA 17 · the calibration 10 · the sweep 4 · the SPC 8 · the supplier scores 8 · the COA 9 · the complaints 5 · the holds 8 · the recall 4 — the family 139 → 156) | `db-affected-quality.log` |
| migrations + identity-flows | **2 · 28 GREEN** (the chain at 118 · the ROUTE_PERMISSIONS checklist over the **1,152** routes — the owner template grants every quality.* key) | `db-affected-migrations-identityflows.log` |

The full ten-part envelope rides at the standing counts **295 files**
(the declared roster movement verified this session: chunk-a 105 → 108 ·
295 = 295, missing NONE, extra NONE, duplicates NONE, VERDICT: COVERED —
`parts.json` + `coverage-inventory.txt` + `coverage-union.txt` +
`coverage-proof.txt`) — **W-32 re-runs it at the final head**.

## The 118-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts` (the W-26/W-27 shape, the chain stamp 118):
initdb a scratch embedded PG16 → apply the chain from zero →
`check:rls` → clean shutdown — run TWICE, both logs kept: **run 1**
`check-rls-scratch-118-run1.log` and **run 2**
`check-rls-scratch-118-run2.log`, each CHAIN_118_APPLIED →
**[check-rls] OK — 340 catalog tables** → SCRATCH_STOPPED, EXIT=0.
(The invocation-shape note, disclosed: `pnpm --filter @erp/api exec tsx
../../audit-evidence/phase050-w28/scratch-rls-proof.ts` from the repo
root — the explicit relative script path through the filter exec, the
declared shape.)

## The standing battery (every log this session, every stamp green)

| Check | Verdict | Log |
|---|---|---|
| typecheck | **8/8** (0 cached — the force re-run) | `typecheck.log` |
| lint | **8/8** (0 cached — the force re-run; the RED first run + the repair disclosed above, `lint-RED.log` kept) | `lint.log` |
| depcruise | clean — **2,160 modules · 16,138 dependencies** (+13/+64 dated) | `depcruise.log` |
| unit workspace | 8/8 (0 cached — the force re-run) — **158 files · 1,987 tests** (api **78·976** · web 21·171 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the ledger arithmetic **1,987 = 976+171+840 EXACT**, the F-2 third term standing) | `unit-workspace.log` (+ `unit-api.log`) |
| permissions drift | **347 = 347** (zero delta — no new keys; the 18 W-28 routes bind the ten standing keys) | `permissions-drift.log` |
| i18n parity | ar=6,955 = en=6,955 (no delta, as declared — an API-DB wave) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities.log` |
| docs:validate | 33/33 (re-run green AFTER this wave's doc edits — the log the post-edit run's own) | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 61 · INV 34 · BR 100 · reservations 15 phases · 37 ids | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-62/PHASE-050 — the 050 flip is W-32's) | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 6,687 allowlisted hits (the W-27 6,654 +33 — the window's shift: the W-28 session commits entering the last-200 sample; the FOUR tag anchors untouched) | `history-secrets.log` |
| ROUTE_PERMISSIONS | **1,134 + 18 = 1,152** (the tsx recount — the keys-seed-first FOURTH binding wave) | (the static recount, this session) |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

**The static constants (recounted this session):** the chain **118
standing** (no migration this wave) · ENTITY_CATALOG **340** · the
registry **315 tenant-owned tables** · the drift **347** ·
ROUTE_PERMISSIONS **1,152** · the report registry **118** (zero change —
the +4 are W-30's) · the unit ledger **158 · 1,987** (75·944 → 78·976
api) · the DB suite roster **295 files** (156 quality-family tests at
the delta head; the full envelope at W-32).

## The physical-file census (the exact-commit-count law)

The wave's commits, in order: (1) **THE ENGINES** (`edc3fe2` — the 19
new/extended code files: the three pure modules + their three spec
files + the gate + the three services + the store/controller/module/
route-permissions/error-filter extensions + the movement-core wiring +
the NCR bypass + the ManufacturingModule export); (2) **THE DB SPECS**
(`a6d4685` — the three spec files + the fixtures' blocking worlds + the
scope-shape repair + `parts.json` + the three coverage files + the
affected-folder logs + `db-first-run-RED.log` + `db-first-run.log`);
(3) **THIS GATE INCREMENT** (the battery logs — the five isolate logs +
the affected-folder logs + both scratch logs + the standing checks — +
the lint repair with its RED log + this README + the ledger
accumulation: the acceptance criteria's W-28 dated note + NEXT_ACTION →
W-29 + the IMPLEMENTATION_STATUS dated line). Every push declared its
copy count at the time (1 + 1 + 1); the battery evidence is this final
increment's own session.

**NOT production approval — تسليم لا قبول.** W-29 (the web plane —
T-15: the five screens + the COA print surface + the hold banners on
every batch-bearing surface; **i18n BY BOTH COUNTS from this wave — the
first surface wave**) waits on the owner's dispatch under the standing
order. The standing recalls ride the 049 completion report §4; RISK-033
at EIGHT with ZERO new this wave — the row stays OPEN, closing only by
the owner's order. The reservations G-62…G-63 · INV-035 · BR-101…BR-104
carry the لا-كتابة-خارجها law into every remaining 050 wave.
