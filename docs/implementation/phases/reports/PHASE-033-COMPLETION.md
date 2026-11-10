# Completion Report — PHASE-033

> **Status:** COMPLETE · **Updated:** 2026-11-08

## Phase ID / Date

PHASE-033 — Agriculture Commercial Shell · 2026-11-08

## Summary

The `industry.agriculture` template (ED-09) shipped as a **commercial shell**
through the unmodified PHASE-015 engine — **configuration only**: migration
`0040_agriculture_template.sql` is an additive registry seed (the manifest row
converging the 0008 index row to the full v1.0.0 manifest) with **no new
tables, no new modules, no new feature keys, no new permission keys, and
INV-022 unchanged**. The crop cycle is a BOM recipe run as a production order
costed to the field project (`accounting.projects` + `accounting.cost_centers`
— the per-field profitability dimension), the harvest lands as a batch at
production cost (then WAC onward, the G-17 chain), crop loss posts as G-18
scrap with a reason, livestock are serial-tracked items at head level
(OPTIONAL per-category opt-in), inputs are ordinary purchases (G-07/G-08), and
produce sells from harvest batches (G-01/G-02/G-03, FEFO) — every posting
riding the existing manufacturing and trading goldens.

**The zero-grant ship (the phase's defining property):** agriculture is the
**first shipped template whose REQUIRED chain resolves entirely through
already-transcribed plan grants** — `manufacturing.bom`/`production_orders`
@ the 0026 block, `inventory.batch_tracking` + `accounting.cost_centers` @
the 0008 base, purchasing/sales @ the starter base, `accounting.projects` @
the 0027 block. Migration 0040 therefore adds **no plan grants** (contrast
0039, which needed the 0038 installments/notes grants its chain resolved
through), `layer-fixtures.ts` is byte-identical to the PHASE-032
transcription apart from the `SHIPPED_TEMPLATES` growth (8 → 9), and the four
new agriculture `POLICY_REGISTRY` keys carry **no settingsKey mapping** (the
0039 precedent) — so **every one of the 25 existing golden pins is
byte-stable**, the first configuration-only phase with a zero-move pin set
(the §10 #2 reviewed record: `agent-ctx/P33-T5-golden-pins.md`; all 25
re-verified by re-running the compose pipeline — the education × business
spot check `29e14755…f7cbc` unchanged). Three new agriculture rows pin
(25 → 28).

The manifest pins the §J-reconciled report pack
(`manufacturing.production_cost` on the dashboard, `inventory.valuation`,
`inventory.expiry_list`, `manufacturing.batch_genealogy` — the doc draft's
`inventory.stock_valuation` planning id pinned to the LIVE
`inventory.valuation` registry key, the 0025 automotive / 0039 education
reconciliation precedent; all four verified REGISTERED in
`reporting/registry/index.ts` — zero reporting-module changes) and the six
workflow policies: four agriculture-owned POLICY_REGISTRY keys
(`cycle_order_per_field_project`, `harvest_batch_genealogy_enabled`,
`field_cost_center_mandatory_on_cycle`, `livestock_serial_per_head` — no
settingsKey mapping) plus `scrap_reason_required` and
`consumption_variance_threshold_pct` **REUSING the PHASE-018 manufacturing
keys** (crop loss rides the G-18 scrap surface; the 5% variance threshold
rides the §5 review flag; templates never fork policy keys).

**Lineage note (recorded honestly):** PHASE-033 executes on the PHASE-027
lineage after the working environments holding the interim PHASE-028–031
states were lost to sandbox resets. Stage-9/10 siblings share only the GA
gate and pre-GA functional prereqs; agriculture's prereqs
(PHASE-015/018/019/025) are all satisfied at this HEAD, so the template ships
here ahead of the still-unexecuted 028–031, which remain NOT_STARTED.
Consequently `CURRENT_SHIPPED_PHASE` **stays PHASE-027** — claiming 028–032
would be false. The honest consequence for agriculture: its one
beyond-the-gate capability marker (`crop_cycle_costing` @ PHASE-033) never
labels granted keys INCLUDED-vs-phase-gated by the phase at all — the §4
decision tree classifies on MISSING keys only, so on business/enterprise
(keys granted) the capability is INCLUDED, and on starter (keys ungranted)
it labels phase_gated @ PHASE-033 (the roadmap availability marker) while
the apply blocks on the other uncovered REQUIRED keys.

## Files created

- `apps/api/migrations/0040_agriculture_template.sql` — the template
  registry seed, generated programmatically from the constant (byte-level
  parity with the 0039 seed-only pattern; embedded JSON verified to
  deep-equal the constant); idempotent upsert on `key`, converging the 0008
  index row to the full v1.0.0 manifest (`is_active = true`,
  `status = 'ACTIVE'`); **zero plan grants**; registered in the drizzle
  journal (`idx` 39) and the `migrations.ts` manifest with the PHASE-033
  comment.
- `agent-ctx/P33-T5-golden-pins.md` — the reviewed §10 #2 zero-move record
  (25 byte-stable + 3 new; the no-grant rationale).
- `docs/implementation/phases/reports/PHASE-033-COMPLETION.md` (this file).

## Files changed

- `packages/contracts/src/industry/templates.ts` — added
  `AGRICULTURE_TEMPLATE_MANIFEST` (deepFreeze, transcribed VERBATIM from
  docs/industries/templates/manifests/manifest.agriculture.json — the
  canonical source, the §J reconciliation applied); appended to
  `SHIPPED_TEMPLATE_MANIFESTS` (9); header comment documents the
  ninth-template set and the lineage note.
- `packages/contracts/src/industry/index.ts` +
  `packages/contracts/src/index.ts` — exported the constant by name from both
  barrels.
- `apps/api/src/modules/configuration/domain/policy-registry.ts` — the four
  agriculture-owned policy keys (`cycle_order_per_field_project`,
  `harvest_batch_genealogy_enabled`, `field_cost_center_mandatory_on_cycle`,
  `livestock_serial_per_head`) with the no-settingsKey documentation block
  (the two reused PHASE-018 manufacturing keys documented beside them).
- `apps/api/src/modules/configuration/__tests__/layer-fixtures.ts` —
  `SHIPPED_TEMPLATES` grew to 9 with the PHASE-033 note documenting WHY no
  grant block was added (the zero-grant ship; `distribution.shipment_tracking`
  recorded as the one OPTIONAL key no plan grants — degrades HIDDEN).
- `apps/api/src/modules/configuration/__tests__/golden-effective-configs.spec.ts`
  — the PHASE-033 zero-move review note + the 3 new agriculture rows (28) +
  the agriculture structural anchors (season/harvest navigation targets,
  terminology, the six policies incl. the two PHASE-018 reuses, the CYC
  numbering assign_at, L8 `manufacturing`, FEFO on, the starter degradation
  set with the pruned navigation).
- `apps/api/src/modules/configuration/__tests__/template-prerequisites.spec.ts`
  — the agriculture legs: business (the full season set INCLUDED on the
  already-transcribed grants — crop_cycle_costing INCLUDED because the phase
  gate only labels missing keys; shipment_tracking HIDDEN on the ungranted
  §17 pending-intake key), starter (blocked with the exact six-key chain +
  crop_cycle_costing phase_gated @ PHASE-033 + bilingual guidance), the
  livestock OPTIONAL-hide (serial tracking is a leaf key — hides cleanly),
  the REQUIRED-tear fail-loud (business minus `manufacturing.bom`: the apply
  blocks on the named key — with the honest contrast to education's torn
  notes cluster: a REQUIRED key cannot orphan anything because the closure
  universe unions the manifest's own required keys; education's
  `notes.received` was OUTSIDE its required set, which is why tearing it
  surfaced closure violations), the enterprise closure entry, and the
  CURRENT_SHIPPED_PHASE honesty note extension (stays 027).
- `apps/api/src/infra/db/migrations.ts` +
  `apps/api/src/infra/db/migrations.spec.ts` + journal — the 0040
  registration (last tag + comment).
- `packages/contracts/src/__tests__/industry-manifests.test.ts` — "all
  eight" → "all nine" (parse + round-trip + the ids pin +=
  `industry.agriculture`), the PHASE-033 pins block (report pins incl. the
  reconciled `inventory.valuation`; season/harvest nav targets; the six §2
  workflow policies; CYC/GRN/INV/DLV/TRF numbering; required-keys + the
  season terminology; the crop_cycle_costing/harvest_batches/pdc_notes/
  shipment_tracking capability posture; the inventory-policy defaults).
- `docs/industries/templates/agriculture.md` — status STABLE · Updated
  2026-11-08 (shipped in PHASE-033); the embedded manifest JSON + the
  Reports-emphasized section carry the reconciled `inventory.valuation` pin
  with the precedent note.
- `docs/industries/templates/manifests/manifest.agriculture.json` — the docs
  mirror regenerated from the constant (JSON deep-equality verified; the diff
  is exactly the one reconciled report-key line, mirroring education's 1-line
  mirror change).
- `docs/implementation/phases/PHASE-033.md` — status COMPLETE.
- `docs/planning/IMPLEMENTATION_STATUS.md` — the PHASE-033 row COMPLETE.

## The crop_cycle_costing phase-marker semantics (the honest record)

`available_from_phase: PHASE-033` with `CURRENT_SHIPPED_PHASE = "PHASE-027"`
produces exactly three classification outcomes, all asserted:

1. **business/enterprise** (keys granted): `included` — the §4 decision tree
   checks the phase only when keys are MISSING; a granted key never labels
   coming-soon (the roadmap marker describes the template's own availability,
   not the tenant's plan).
2. **starter** (keys ungranted): `phase_gated` @ PHASE-033 — the label reads
   "coming with PHASE-033", the honest roadmap statement for a capability
   whose owning phase ships with this very template while the gate constant
   (the platform's live-feature statement) lags on the lost 028–031 lineage.
   The overall apply is blocked anyway on the six uncovered REQUIRED keys
   (`accounting.cost_centers`, `industry.template_engine`,
   `inventory.batch_tracking`, `manufacturing.batch_genealogy`,
   `manufacturing.bom`, `manufacturing.production_orders`).
3. **business minus a REQUIRED key** (`manufacturing.bom`): the OTHER
   capabilities block on the named key (`bom_production` 018 ≤ 027 — hard
   block) while crop_cycle_costing labels phase_gated (033 > 027 AND its key
   missing) — `missingChain = ["manufacturing.bom"]`, bilingual guidance,
   zero silently-partial season surface.

## Verification evidence

Sandbox runner: `bun test` over the repo's vitest-style specs via a local
`node_modules` shim (vitest→bun:test re-export, inert drizzle/pg/pino/@nestjs
stubs — `node_modules/` is gitignored; no network install exists in this
environment).

- `validate:manifests` — **9/9** OK (agriculture content hash
  `sha256:f30e4fa0b39f05672cb6331e324a8798cc65cda3887a75aa57daabd49f1b72ce`);
  ids unique; versions semver; required_feature_keys non-empty.
- `golden-effective-configs.spec` — **32/32** (28 pinned rows: **25
  byte-stable + 3 new agriculture** — the zero-move review note; §5 shape;
  per-template structure incl. the agriculture anchors; distinct-pins;
  reviewed-change-atomicity).
- `template-prerequisites.spec` — **25/25** (agriculture
  business/starter/livestock-hide/REQUIRED-tear + enterprise closure + the
  pre-existing industries unchanged).
- `migrations.spec` — **4/4** (manifest ↔ SQL files on disk; journal ↔
  manifest order; schema-state upserts; fail-closed drift signal).
- Configuration suite (`__tests__/`, 5 files) — **111/111** (incl.
  `config-resolution.spec` + `template-drift.spec` regression over the
  changed fixtures).
- Contracts package — `industry-manifests.test` **41/41**, `contracts.test`
  **11/11** (run per-file, mirroring vitest's module isolation; the §3
  registry check shares contract-registry state across files in a single
  bun process — an artifact of the sandbox runner, not the repo).
- `docs/industries/templates/manifests/manifest.agriculture.json` — JSON
  deep-equals the constant (mirror regenerated, no drift beyond the
  reconciled report key).
- Migration 0040's embedded manifest JSON — parses and deep-equals the
  constant (byte-level parity with the 0039 pattern).
- Agriculture report pins — all four resolve to REGISTERED report contracts
  (`registry/index.ts`: `manufacturingProductionCostContract` +
  `manufacturingBatchGenealogyContract` @ phase018,
  `inventoryValuationContract` @ operational/inventory,
  `inventoryExpiryListContract` @ industry): the report pack wires through
  the manifest's `report_defaults` (apply/switch materialization) with zero
  reporting-module changes, exactly the phase's config-only design.

**Environment-constrained (recorded honestly):** the DB suites (the §6
season end-to-end golden — G-07/G-08 input purchases, the G-17
consumption/completion chain, G-18 crop loss, G-01/G-02/G-03 produce sale
with FEFO; the per-field profitability reconciliation; the
template-apply/switch/degraded-entitlement db specs; INV-010 conservation;
livestock serial lifecycle) and the reporting unit suite
(exceljs-dependent export tests) require the live harness environment
(postgres + the pnpm install); they are NOT runnable in this sandbox and
remain to re-run there — the phase's unit-level surface above is fully
green, and every file the phase touched is covered by it. No
reporting/manufacturing/purchasing/sales/inventory source file was modified
(git status: the 17-file configuration-only set).

## Deviations & decisions (recorded)

1. **`CURRENT_SHIPPED_PHASE` stays PHASE-027** — no gate bump (the honesty
   note; see Summary). The gate mechanism itself is still proven by the
   synthetic PHASE-028 `budgeting.budgets` REQUIRED fixture (§18 lesson 5),
   and now additionally by agriculture's own starter leg (crop_cycle_costing
   phase-gated @ 033 on ungranted keys — a REAL manifest entry beyond the
   gate, not a synthetic one).
2. **Migration 0040 adds ZERO plan grants** — the first such template ship;
   every required key was already granted by 0008/0026/0027 (starter
   excluded by the tier-4 posture of those earlier migrations).
3. **No settingsKey mapping for the four agriculture policy keys** — L1
   defaults land under their raw policy-key names; non-agriculture tenants'
   policy maps (and golden pins) stay byte-stable (the agent-ctx pin table
   records the exact 25+3 zero-move split).
4. **The two reused PHASE-018 manufacturing keys ship manifest values equal
   to the platform defaults** (true / 5) — the template asserts the
   crop-loss/variance posture rather than forking it; the agriculture
   tenant's settings-key run values are byte-identical to the platform ones.
5. **Zero new report keys** — the §J reconciliation pins the LIVE
   `inventory.valuation` registry key (the draft's
   `inventory.stock_valuation` planning id), exactly the 0025/0039
   precedent.
6. **`distribution.shipment_tracking` recorded as the ungranted §17
   pending-intake key** — the OPTIONAL shipment_tracking capability degrades
   HIDDEN on business/enterprise (an upgrade path, never a coming-soon
   label), the same posture as professional_services' deposits_late_fees.

## Documentation updates — all done

- `agriculture.md` — STABLE · 2026-11-08 (shipped; the reconciled report pin
  noted in both the manifest block and the Reports-emphasized section).
- `manifest.agriculture.json` — regenerated mirror (deep-equal; the 1-line
  §J reconciliation).
- `PHASE-033.md` — COMPLETE.
- `IMPLEMENTATION_STATUS.md` — PHASE-033 row COMPLETE (this report linked).
- `CAPABILITY_MATRIX.md` — the AGR column + `crop_cycle_costing`/
  `harvest_batches` rows landed with the v2.0 doc sync (pre-existing;
  citations intact — no edit needed).
- `PHASE_ACCEPTANCE_CRITERIA.md` — the v2.0 PHASE-033 section pre-existing
  (mirrored at plan time; no edit needed).

## Exit criteria

Configuration-only scope shipped and unit-verified per the plan's §5
T1-homologue (manifest + registry seed + policies + entitlement
classification + golden pins); T3–T7 ride the shipped PHASE-015/018/019
manufacturing/purchasing/sales/inventory surfaces verbatim (config only — no
code to write; the season chain's goldens are the EXISTING G-07/G-08/G-17/
G-18/G-01/G-02/G-03 rows); T8 report-pack wiring is the manifest's
`report_defaults` (verified against the live registry); T9's governance
suite re-runs on the harness environment (recorded above).

## Handoff

Next eligible per EXPANSION_REGISTER §B on this lineage: PHASE-028/029
(stage-9) or the stage-10 siblings (030/031) — NOT_STARTED; stage 10
completes when 030 + 031 ship, which opens stage 11 (PHASE-034
Multi-Entity Consolidation, the final roadmap phase). The golden pins are
the drift tripwire for every future change to the fixtures, the manifest, or
the compose pipeline (§10 #2).
