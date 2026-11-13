# Gate Evidence — PHASE-044 Post-Closure Audit Fixes, Wave 5 (2026-11-13)

> **Scope:** the evidence ledger for the fifth post-closure audit-fix wave —
> the owner's review of the fourth wave at head `8f943aa` accepted the union
> population, then named the REMAINING sequential scenario from the wave-4
> §5 recorded limitation: **a serial placed in a bin whose ledger
> corroborates the placement exactly (+1 here / +1 across all warehouses)
> while its `item_serials` registry status is `sold` was still skipped
> without a registry check** (`wms.service.ts` 730–744 — the placed branch
> examined the bins and the ledger, then `continue`), so a provable
> unplaced sibling's write could land Σ bins exactly on `item_stock` and
> ERASE a position the nightly probe had been showing as a visible deficit.
> The owner's prescribed test — serial A in a bin qty 1 with ledger net 1
> here / 1 total but registry `sold`; serial B `in_stock` with ledger net 1,
> never placed; `item_stock` 2, Σ bins 1 — was run on the CURRENT (pre-fix)
> code first, **confirmed exactly as predicted on a real database**, then
> fixed with the named registry-status conflict for the placed serial, the
> same-logic review of the other registry contradiction shapes, the refusal
> to hide, and the operational-risk documentation of the aggregate probe's
> limits. Every row states WHAT WAS RUN (command + environment + result) vs
> what was INFERRED from reading the code. No secrets; no bulky outputs.
>
> **Commits:** the fix + the spec + the runbook/risk docs + this evidence
> ledger (see the CHANGELOG entry for the per-commit map).

## 1. Environment

- Embedded PostgreSQL 16 (the suite's `global-setup.ts` boot), migrations
  0001–0073 applied by `drizzle-kit migrate` per run — every db row below
  ran on a freshly booted instance. Commands run from `apps/api` unless
  stated; Node 24, pnpm 9.15.9, the repo's locked workspace install. The
  one-time `playwright install chromium` sandbox bootstrap (the wave-3
  recorded environment note) was re-applied this session (the sandbox had
  chromium-1200; the locked playwright wants headless-shell 1248 — before
  it, `zatca-qr-decode.spec` fails on the missing binary, an environment
  miss, not a code defect); the unit suite ran green after it.

## 2. RUN — the owner's case on the PRE-FIX code (the review's prescribed test)

The new spec `src/__db__/inventory/wms-backfill-placed-registry.spec.ts`
was written FIRST, asserting the FIXED behavior; run against the unmodified
head (`8f943aa`) it IS the reproduction (the wave-4 precedent).

| # | Command (cwd `apps/api`) | Result |
|---|---|---|
| 2.1 | `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-backfill-placed-registry.spec.ts` (pre-fix) | **5 failed / 2 passed — the owner's reading-from-code inference CONFIRMED on a real database, every axis as predicted:** (1) the dry-run **"expected 'WRITABLE' to be 'NON_RECONCILABLE'"** — the pre-fix pass classified B provable and planned its unit (A skipped silently: the placed branch never examined `registryStatus`); (2) the LIVE pass the same WRITABLE — **it wrote B's unit**; (3) the RE-RUN **"expected undefined to be defined"** — the position no longer appears as a shortfall (Σ bins 2 == `item_stock` 2), so the conflict is gone from the report AND the probe (every recurring detector); (4) the `returned` variant the same WRITABLE (the third registry status hid identically); (5) the PARTIAL variant's notes **missing the placed serial entirely** (only the generic residue note — A never named). The two passes: the healthy WRITABLE control (a placed serial with an AGREEING registry heals) and the unplaced-mismatch control (the wave-3 note path) — both negative controls unchanged by the fix, as designed. |
| 2.2 | A one-off diagnostic spec (NOT committed — seeded the same shape, ran the LIVE pass, printed the probe rows before/after) | **The hiding, directly:** `PROBE BEFORE: [{itemSku INV-PLR-DIAG, binQty 1.000000, stockQty 2.000000, difference -1.000000}]` — the position STARTS as a visible deficit; `CLASSIFICATION: WRITABLE`, `PASS written: 1` (B's unit); `FOLD AFTER: 2.000000 | STOCK: 2.000000`; **`PROBE AFTER: []`** — the deficit VANISHED from the only recurring detector while serial A's registry conflict (a sold unit occupying a bin its ledger still calls in stock) stayed invisible. The wave-4 §5 claim "the probe cannot see such a position anyway (bins == ledger ⇒ no shortfall row)" was true ONLY for the already-balanced shape — with an unplaced sibling the pre-fix migration itself ERASED a visible deficit. |

## 3. RUN — the fix, the sibling corpus, and the standing gates

| # | Command (cwd `apps/api` unless stated) | Result |
|---|---|---|
| 3.1 | The same spec command on the FIX | **7/7 passed** — the owner's case NON_RECONCILABLE with the conflict NAMED by its exact shape ("serial PLR-S-PLACED: bin rows place 1.000000 unit(s) here and the ledger nets 1 here (1 across all warehouses), but the registry status is sold — the registry-status conflict for a placed serial") and the refusal explained ("placing the provable units would make Σ bins == item_stock and HIDE the named conflict(s) from the nightly probe"); the live pass writes NOTHING (the fold stays 1 vs stock 2 — the visible deficit stays visible); the re-run is a stable idempotent refusal (byte-identical `listBinContents`); the `returned` variant refuses identically (the third registry status treated with the SAME logic); the PARTIAL variant (stock 3, one phantom) still writes the PROVEN sibling's unit with A's conflict named and the 1-unit residue visible (the guard only forbids the HIDING write — PARTIAL_UNATTRIBUTED, the TBF-S-0004 precedent); the healthy counterpart (a placed serial with an AGREEING registry) still heals WRITABLE and the probe row CLEARS; the unplaced-mismatch control keeps the wave-3 note ("ledger says in stock but registry status is sold") with the clean sibling placed — no regression |
| 3.2 | The sibling WMS db corpus: `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-backfill-conflicts.spec.ts src/__db__/inventory/wms-backfill-races.spec.ts src/__db__/inventory/wms-budgets-backfill.spec.ts src/__db__/inventory/wms-tracked-backfill.spec.ts src/__db__/inventory/wms-core.spec.ts src/__db__/inventory/wms-inv029.spec.ts src/__db__/inventory/wms-serial-ledger.spec.ts src/__db__/inventory/wms-backfill-bins-no-ledger.spec.ts src/__db__/inventory/wms-backfill-placed-registry.spec.ts` | **62/62 passed (9 files)** — the surrounding corpus unaffected: the WAVE-3 CONFLICTS SPEC 7/7 (the wave-3 owner case still NON_RECONCILABLE with its netting phrasing), the WAVE-4 BINS-NO-LEDGER SPEC 9/9 (the union population + the serialized placement-corroboration note unchanged — no regression), the wave-2 races corpus 5/5 (the movement-vs-pass lock protocol untouched), the tracked-backfill corpus 7/7 (the TBF-S-0004 PARTIAL-with-conflict-note shape deliberately unchanged), budgets 5/5, core 15/15, inv029 2/2, the T-11 serial-ledger property 5/5 (the spec's afterAll removes the seeded orphan legs — the wave-3/4 hygiene precedent) |
| 3.3 | `pnpm exec tsc --noEmit -p tsconfig.json` · `pnpm --filter @erp/api lint` · `pnpm exec prettier --check` on the two changed code files | **0 errors · 0 problems · clean** |
| 3.4 | `pnpm lint:depcruise` (repo root) | **0 violations — 1,790 modules, 13,190 dependencies** (+1 module: the new spec) |
| 3.5 | `pnpm vitest run` (apps/api — the api unit suite, after the chromium bootstrap) | **51/51 files, 576/576 tests** |

NOT re-run this wave (the wave-4 precedent — no surface touched): i18n
parity, permissions drift, manifests, isolation suites, and NO second
batched full-suite db run (the 044 full gate is NOT repeated — the owner's
directive); the changed surfaces are one service classification branch,
one new spec, the runbook, the risk register, this ledger, and the
CHANGELOG.

## 4. What changed (the fix, for the reviewer)

1. **`classifyShortfall`'s placed branch (wms.service):** a serial whose
   bin rows place it HERE while its registry status is anything other than
   `in_stock` (`sold` / `returned` — migration 0015's complete status
   vocabulary) now gets a NAMED conflict — the registry-status conflict for
   a placed serial — INDEPENDENT of the over-placement and
   ledger-corroboration checks (a serial can contradict the registry while
   the ledger corroborates the placement — the owner's exact shape — or
   while it also disagrees with the ledger; both facts are named). The
   note feeds the wave-3 totals-matching guard: residue 0 + any named
   conflict ⇒ NON_RECONCILABLE, nothing written, the full shortfall stays
   visible to the probe.
2. **The cross-warehouse placed branch:** the same registry check — a unit
   the registry calls `sold`/`returned` cannot sit in ANOTHER warehouse's
   bin either; named alongside the existing cross-warehouse note.
3. **The other registry contradiction shapes — reviewed under the same
   logic (the owner's directive), no probe redesign:** the UNPLACED
   mismatch (ledger +1 here, registry `sold`/`returned`) keeps its
   pre-existing wave-3 note (test-proven unchanged by this wave's control);
   a registry `in_stock` with a ZERO ledger net claims nothing and places
   nothing (not a hiding vector — the residue keeps the probe honest) and
   stays unnamed by design; `returned` on a placed serial is named
   identically to `sold` (test 4).

## 5. The honest limitations — INCLUDING the corrections to the wave-4 §5 claims

- **CORRECTION (the owner's review, test-proven in 2.2):** the wave-4 §5
  second bullet claimed "the probe cannot see such a position anyway
  (bins == ledger ⇒ no shortfall row)". That is true ONLY for the
  already-balanced shape. With an unplaced provable sibling the position
  STARTS as a visible deficit (bins 1 vs stock 2) and the PRE-FIX
  migration ERASED it by writing the sibling. The wave-4 first bullet's
  stronger claim — "this wave guarantees the migration cannot CREATE such
  a hidden state from a visible one" — was therefore FALSE for the
  registry-status shape until this wave; post-wave-5 the guarantee is
  test-proven for every named conflict shape (per-batch bins-vs-ledger —
  wave 3/4; uncorroborated and over-placed placements — wave 4;
  registry-contradicting placements — wave 5). The wave-3 §5 line ("this
  wave guarantees a named conflict can no longer be HIDDEN") holds only
  for what that wave NAMED — the registry-status shape was unnamed then,
  which is exactly why it hid.
- **The known limit that REMAINS (documented as an operational risk, per
  the owner's directive):** a position whose Σ bins ALREADY equals
  `item_stock` while the per-batch or per-serial sources disagree is
  invisible to BOTH detectors (the probe is green; the backfill sees no
  shortfall row). This is the aggregate probe's inherent blindness —
  **the aggregate check is a NECESSARY condition, never a proof that every
  batch and every serial is correct**, and no doc may present it as one.
  Registered as **RISK-031** (the new "Operational risks" section of
  [RISK_REGISTER.md](../../planning/RISK_REGISTER.md)) and documented
  operator-facing in the runbook's new
  [§9](../WMS_UPGRADE_BACKFILL_RUNBOOK.md) ("The nightly probe's known
  limits"), including the operating consequence: positions green BEFORE
  the first backfill run were never examined by the migration at all. A
  per-batch/per-serial recurring detector remains future hardening —
  deliberately NOT built here (the owner's no-redesign directive).
- **The registry-vs-ledger disagreement on an UNPLACED serial with a zero
  ledger net stays unnamed** (e.g. registry `in_stock` while the ledger
  sold the unit): such a serial claims no warehouse position and places no
  bin row — it cannot hide anything from the fold (the residue keeps the
  probe honest), and naming every registry-vs-ledger disagreement in the
  registry would be the per-serial recurring detector's job, not the
  backfill's (the no-redesign boundary).
- **The concurrency proof is backfill-vs-backfill on the conflicted
  position** (the wave-3/4 standing limitation): the conflicted position
  writes nothing, so the write-path race surface does not apply to it;
  the movement interleavings on healthy positions remain the races
  corpus' 5/5 (re-run green in 3.2).
- **No second batched full-suite run** (the prior waves' standing
  limitation, restated per the owner's directive): the WMS db corpus ran
  once (62/62, 9 files) and the api unit suite once (576/576) on the fix;
  the full 044 gate is NOT repeated.
