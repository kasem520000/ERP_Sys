# Gate Evidence — PHASE-044 Post-Closure Audit Fixes, Wave 4 (2026-11-13)

> **Scope:** the evidence ledger for the fourth post-closure audit-fix wave —
> the owner's review of the third wave at head `0038fc0` accepted the
> checker fix and the tested conflict case, then named ONE point from the
> wave-3 §5 recorded limitation: **a batch with a positive BOX balance and
> NO ledger movements in the warehouse may HIDE its conflict from the
> total probe, not merely leave it unreported.** The owner's prescribed
> test — batch A in the boxes 8 with no ledger legs, batch B in the ledger
> 2 / boxes 0, `item_stock` 10; verify whether the backfill writes B's
> pinned balance, classifies the position WRITABLE, and the case then
> disappears from the aggregate probe despite A's conflict — was run on
> the CURRENT (pre-fix) code first, confirmed exactly as predicted, then
> fixed with the UNION population (tenant / ownership / bin-status
> scoped), the named no-movements conflict, the refusal to hide, and the
> serialized placement-corroboration analogue. Every row states WHAT WAS
> RUN (command + environment + result) vs what was INFERRED from reading
> the code. No secrets; no bulky outputs.
>
> **Commits:** `ad3807e` (the union population + the named conflicts + the
> spec) · `2a35496` (the runbook) · this commit (the evidence ledger + the
> CHANGELOG entry).

## 1. Environment

- Embedded PostgreSQL 16 (the suite's `global-setup.ts` boot), migrations
  0001–0073 applied by `drizzle-kit migrate` per run — every db row below
  ran on a freshly booted instance. Commands run from `apps/api` unless
  stated; Node 24, pnpm 9.15.9, the repo's locked workspace install. The
  one-time `playwright install chromium` sandbox bootstrap (the wave-3
  recorded environment note) remains applied; the unit suite ran green
  without re-doing it.

## 2. RUN — the owner's case on the PRE-FIX code (the review's prescribed test)

The new spec `src/__db__/inventory/wms-backfill-bins-no-ledger.spec.ts`
was written FIRST, asserting the FIXED behavior; run against the unmodified
head (`0038fc0`) service it IS the reproduction — no stash needed (the
wave-3 stash-and-run method applied only because that wave's spec already
existed).

| # | Command (cwd `apps/api`) | Result |
|---|---|---|
| 2.1 | `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-backfill-bins-no-ledger.spec.ts` (pre-fix) | **7 failed / 2 passed — the owner's prediction confirmed on every axis:** (1) the dry-run **"expected 'WRITABLE' to be 'NON_RECONCILABLE'"** — the pre-fix pass planned B's ledger 2 as a clean write (`plannedWrites` = one 2-unit row for BNL-B), batch A invisible to the ledger-driven population; (2) the LIVE pass the same WRITABLE — **it wrote 2 for B**, landing Σ bins 10 == `item_stock` 10; (3) the RE-RUN **"expected undefined to be defined"** — the position no longer appears as a shortfall, so the conflict is gone from the report AND the probe (every recurring detector); (4) the concurrent passes the same undefined; (5) the PARTIAL variant's notes **missing the bins-only batch** (only the generic pre-tracking residue note — A never named); (6) the serialized analogue **healed** (the provable sibling placed, the phantom-placement serial swallowed as "already placed"); (7) the HOLD-status variant WRITABLE. The two passes: the healthy WRITABLE control and the consignment negative control — both negative controls unchanged by the fix, as designed. |
| 2.2 | The same command on the FIX (`ad3807e`) | **9/9 passed** — the owner's case NON_RECONCILABLE with the conflict NAMED by its exact shape ("batch BNL-A: bins hold 8 but the ledger has NO movements for this batch at this warehouse") and the refusal explained ("writing the proven parts would make Σ bins == item_stock and HIDE the named conflict(s) from the nightly probe"); the live pass writes NOTHING (the fold stays 8 vs stock 10); the probe keeps the row (bins 8 / stock 10); the re-run is a stable idempotent refusal (byte-identical `listBinContents`, no new writes); two concurrent passes both refuse; the PARTIAL variant (stock 20) still writes the PROVEN batch B's 2 with A's conflict named and the 10-unit residue visible (the union never over-blocks — PARTIAL_UNATTRIBUTED); the serialized analogue refuses (nothing placed, the phantom named: "bin rows place 1.000000 unit(s) here but the ledger nets 0 here (0 across all warehouses)"); the HOLD variant refuses (the probe folds all statuses, so the union does too); the consignment row (owner_partner_id set) is NOT a conflict — the healthy sibling heals WRITABLE and the consignment batch is never named |
| 2.3 | The sibling WMS db corpus: `pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/wms-backfill-conflicts.spec.ts src/__db__/inventory/wms-backfill-races.spec.ts src/__db__/inventory/wms-budgets-backfill.spec.ts src/__db__/inventory/wms-tracked-backfill.spec.ts src/__db__/inventory/wms-core.spec.ts src/__db__/inventory/wms-inv029.spec.ts src/__db__/inventory/wms-serial-ledger.spec.ts src/__db__/inventory/wms-backfill-bins-no-ledger.spec.ts` | **55/55 passed (8 files)** — the surrounding corpus unaffected: the WAVE-3 CONFLICTS SPEC 7/7 (the wave-3 owner case A ledger 5/bins 8 still NON_RECONCILABLE with its wave-3 netting phrasing — no regression), the wave-2 races corpus 5/5 (the movement-vs-pass lock protocol untouched), the tracked-backfill corpus 7/7 (the TBF-S-0004 PARTIAL-with-conflict-note shape deliberately unchanged), budgets 5/5, core 15/15, inv029 2/2, the T-11 serial-ledger property 5/5 |

## 3. RUN — the standing gates (this wave)

| # | Command (cwd as stated) | Result |
|---|---|---|
| 3.1 | `pnpm exec tsc --noEmit -p tsconfig.json` (apps/api) | **0 errors** (one transient TS6133 unused-variable in the new spec caught and removed before commit) |
| 3.2 | `pnpm --filter @erp/api lint` | **0 problems** |
| 3.3 | `pnpm exec prettier --check` on the three changed code files | **clean** (after one `--write` pass on the store + the spec) |
| 3.4 | `pnpm lint:depcruise` (repo root) | **0 violations — 1,789 modules, 13,179 dependencies** (+1 module: the new spec) |
| 3.5 | `python3 scripts/validate_docs.py` (repo root) | **33/33** (after the runbook update) |
| 3.6 | `pnpm check:id-ledger` (repo root) | **0 errors, 0 warnings — 115 claim ids, 2,455 reference ids over 68 phase docs** (unchanged from wave 3 — no ID-bearing docs touched this wave) |
| 3.7 | `pnpm vitest run` (apps/api — the api unit suite) | **51/51 files, 576/576 tests** |

NOT re-run this wave (no surface touched): i18n parity, permissions drift,
manifests, isolation suites — the changed files are one store query, one
service classification, one new spec, one runbook; none of those gates
read them.

## 4. What changed (the fix, for the reviewer)

1. **`listBatchDistribution` (wms-store):** the population is now the
   FULL OUTER JOIN (the UNION) of the per-batch ledger fold and the
   tenant-owned bin fold — a batch whose bins hold stock with ZERO ledger
   legs enters with `ledger_qty 0 / ledger_legs 0` instead of being
   invisible. The scoping mirrors the probe exactly: **tenant** (the RLS
   context plus the `item_batches` tenant join — complete over the union
   because both `stock_moves.batch_id` and `bin_contents.batch_id` carry
   composite same-tenant RESTRICT FKs, verified against migrations 0015
   and 0067), **ownership** (`owner_partner_id IS NULL` — the probe never
   counts partner-owned consignment rows), **bin status** (all three —
   the probe's fold spans AVAILABLE/QUARANTINE/HOLD alike). A new
   `ledgerLegs` count distinguishes "NO movements" from "movements
   netting zero".
2. **`classifyShortfall`'s batch path (wms.service):** a batch whose bins
   exceed its ledger — legs or no legs — is a NAMED conflict; the wave-3
   totals-matching guard (residue 0 + a named conflict ⇒
   NON_RECONCILABLE, nothing written, the full shortfall stays visible to
   the probe) now fires for the bins-only shape too. A residue > 0 keeps
   the proven writes legitimate (PARTIAL_UNATTRIBUTED) with the conflict
   named — test-proven (2.2, the PARTIAL variant).
3. **The serialized path's placement precedence:** a placed serial whose
   ledger does not corroborate the placement (bin rows place 1 here while
   the ledger nets anything other than exactly 1 here, or anything other
   than 1 across all warehouses) is a NAMED conflict — pre-fix silently
   accepted as "already placed", which let a provable sibling's placement
   hide it (2.1 row 6 → 2.2). The wave-3 over-placement and
   cross-warehouse notes are unchanged (the wave-3 spec's 7/7 proves it).

## 5. The honest limitations

- **The probe is still the aggregate (warehouse, item) fold — the union
  widens the BACKFILL's comparison, not the probe's.** A position whose
  Σ bins ALREADY equals `item_stock` while the per-batch sources disagree
  (e.g. batch A bins 8 / no legs + batch B ledger 8 / bins 0 +
  `item_stock` 8) is invisible to BOTH detectors: the probe is green (Σ
  bins == stock) and the backfill never sees the position (no shortfall).
  The wave-3 §5 "per-batch/per-serial recurring detector" gap remains
  open — this wave guarantees the migration cannot CREATE such a hidden
  state from a visible one; it does not retroactively detect
  already-hidden ones. That detector remains future hardening, unchanged.
- **The placed-serial registry check is still unidirectional.** A placed
  serial whose ledger corroborates the placement (nets exactly 1 here, 1
  total) but whose REGISTRY status contradicts it (`sold` while the
  ledger says in stock here) is still not named on the placed branch —
  the registry-vs-ledger conflict is named only for unplaced serials (the
  provable branch). The probe cannot see such a position anyway (bins ==
  ledger ⇒ no shortfall row); the same per-serial recurring detector
  would own it.
- **The union's completeness rests on the composite FKs.** Both
  `stock_moves.batch_id` and `bin_contents.batch_id` reference
  `item_batches (id, tenant_id)` with ON DELETE RESTRICT (migrations
  0015/0067) — a batch id that cannot resolve inside the tenant's
  registry cannot exist at the DB level, so the INNER `item_batches`
  join is complete over the union. If a future migration ever relaxes
  those FKs, the union must switch to a LEFT JOIN plus a named
  registry-conflict branch (recorded here; not built — the DB floor makes
  it unreachable today).
- **The concurrency proof is backfill-vs-backfill on the conflicted
  position** (the wave-3 §5 limitation stands unchanged): the conflicted
  position writes nothing, so the write-path race surface does not apply
  to it; the movement interleavings on healthy positions remain the
  races corpus' 5/5 (re-run green in 2.3).
- **No second batched full-suite run** (the prior waves' standing
  limitation): the WMS db corpus ran once (55/55) and the api unit suite
  once (576/576) on the fix; the email-flake / p95-environmental
  classifications of the earlier waves rest on their recorded standalone
  re-runs and nothing this wave touched them.
