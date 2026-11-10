# T37 / Task 2 — Contracts + configuration + industry.food_manufacturing template (PHASE-018)

**Agent:** T37 (template & configuration) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — validate:manifests 6/6, contracts unit 46/46, api unit 270/270
(25 files), typecheck 6/6, lint 6/6, depcruise 0, docs:validate 29/29, DB suite
**1458/1459** — the single remaining failure is the documented mid-phase gap
`billing/readonly-sweep` (14 unmounted manufacturing routes → 404; T38a/T39 mount
the controllers). Every configuration/template spec passes, including the 7 new
templates-018 tests and the re-pinned template-switch R9 preview.

## Files created

- `apps/api/src/__db__/configuration/templates-018.spec.ts` (7 tests) — the §8 seven
  per-template requirements for `industry.food_manufacturing` through the UNMODIFIED
  PHASE-015 engine (details below).
- `agent-ctx/T37-2-template.md` (this file).

## Files changed

- `packages/contracts/src/industry/templates.ts` — added
  `FOOD_MANUFACTURING_TEMPLATE_MANIFEST` (deepFreeze, transcribed VERBATIM from
  docs/industries/templates/manifests/manifest.food_manufacturing.json — the same
  canonical source as the 0026 registry seed); appended to
  `SHIPPED_TEMPLATE_MANIFESTS`; header comment now documents the six-template set.
- `packages/contracts/src/industry/index.ts` + `packages/contracts/src/index.ts` —
  exported the new constant (the main barrel re-exports by name — forgetting it
  made the first test run fail with `undefined`; fixed).
- `packages/contracts/src/__tests__/industry-manifests.test.ts` — "all five" →
  "all six" (parse + round-trip + ids pins), a PHASE-018 block (report-key pins,
  production/trace nav groups, required manufacturing keys, the four workflow
  policies, the PRD- numbering rule), and three food_manufacturing negative
  fixtures (n) phase-gate pattern, (o) terminology missing `en`, (p) unknown
  default_period preset.
- `apps/api/src/modules/configuration/domain/policy-registry.ts` — new
  "manufacturing (PHASE-018)" section: `production_qc_gate` (enum
  required|off, default off, settingsKey `manufacturing.qc_gate`),
  `scrap_reason_required` (bool, true, `manufacturing.scrap_reason_required`),
  `fg_batch_expiry_from_shelf_life` (bool, true,
  `manufacturing.fg_batch_expiry_from_shelf_life`),
  `consumption_variance_threshold_pct` (number, 5,
  `manufacturing.consumption_variance_threshold_pct`).
- `apps/api/src/modules/configuration/domain/settings-schema.ts` — the four matching
  `SettingDefinition`s (z.enum(["required","off"]) default "off"; z.boolean() ×2
  default true; z.number().min(0).max(100) default 5).
- `apps/api/src/modules/configuration/application/apply/prerequisites.ts` —
  `CURRENT_SHIPPED_PHASE` "PHASE-017" → **"PHASE-018"** + doc comment notes the
  0026 manufacturing grants.
- `apps/api/src/modules/configuration/application/resolve/resolve-service.ts` —
  **bug fix (see deviations #3)**: L7 series formats now filter to the §3
  series-bearing `DOCUMENT_TYPES` (runtime acquisition rows with internal doc
  types like `pos_sales_invoice` never enter the numbering-policy surface).
- `apps/api/src/modules/configuration/__tests__/layer-fixtures.ts` —
  `SHIPPED_TEMPLATES` += food_manufacturing; `BUSINESS_KEYS` += the 7 manufacturing
  keys (0026 grants; enterprise already carried them from 0008, so its explicit
  block was removed to keep the spread duplicate-free); header note 0008→0026.
- `apps/api/src/modules/configuration/__tests__/golden-effective-configs.spec.ts` —
  3 new rows + re-pins (below) + food_manufacturing structural anchors + the
  no-template manufacturing-policies anchor + a PHASE-018 review note.
- `apps/api/src/modules/configuration/__tests__/template-prerequisites.spec.ts` —
  CURRENT_SHIPPED_PHASE pin → 18 (+phaseNumber("PHASE-018")); automotive
  `qc_inspections` now `included` (0026 grant + 18 shipped); the synthetic
  REQUIRED-later-phase proof moved PHASE-018→**PHASE-019** (a PHASE-018 synthetic
  now classifies included — business carries the manufacturing keys).
- `apps/api/src/__db__/configuration/template-switch.spec.ts` — R9 preview:
  grocery `qc_inspections` moved `phaseGated` → **`included`** (0026 grants make
  missing=[] ⇒ included per the §4 decision tree; the 18 bump lifted the gate
  regardless); `addedCapabilities.phaseGated` now `[]`; comments updated.
- `apps/api/src/modules/reporting/registry/runtime.ts` — `SOURCE_MODULES` +
  "manufacturing"; `MODULE_DATA_PHASE.manufacturing = 18`;
  `REGISTERED_PHASE_WINDOW` 17 → **18** (comment updated). Zero new contracts
  registered (T40 owns them) — `validateRegistry` only checks registered
  contracts, so the widened window is inert until T40 appends.
- `apps/api/src/modules/reporting/application/contract.ts` — `DataSourceModule`
  union += "manufacturing".
- `docs/product/FEATURE_CATALOG.md` — §14 permission column reconciled to the real
  0026 seeds / §9 route permissions (MASTER-PLAN §13 last bullet):
  bom→`manufacturing.boms.manage`, production_orders/wip→
  `manufacturing.production_orders.view`, costing→`manufacturing.costing.read`
  (unchanged), scrap→`manufacturing.production_orders.post`,
  batch_genealogy→`manufacturing.genealogy.read` (unchanged),
  qc→`manufacturing.qc.manage` (unchanged). docs:validate 29/29.

## The manifest hash (recorded verbatim)

```
industry.food_manufacturing@1.0.0
sha256:e62f1bf2d709e226f203702259f1e51a1829df3d8e9be7031f658c026659a5da
```

Byte-equality proven (canonical JSON) across all three sources: the contracts
constant, the docs file, and the migration 0026 `industry_templates` seed
(`sha256` over the canonical JSON matches for all three — verified by script).
`pnpm validate:manifests` (6 manifests, all OK):

| Template | Content hash |
|---|---|
| industry.retail@1.0.0 | sha256:ac0a93342ae85cd9b870c96b2bf63cb13e5e815477ebd9d9679f08700080cbba |
| industry.grocery@1.0.0 | sha256:c6ef7c8a82bdc3817e46e9068892e550ea2bbacb1583d0954f5c86704e29525e |
| industry.restaurant@1.0.0 | sha256:e187c90342250bf0a99497c27e7cb97ec7ce0b7420f76e1b3d1aab1b6954b127 |
| industry.automotive@1.0.0 | sha256:047d5671387ae1872ca8dd2bb6f7235758caa392b7c4441429fc0aadef734172 |
| industry.distribution@1.0.0 | sha256:d31597032af69990560e4041cc6fb566b8c2159ee36d47f6b95b2cdf94be995d |
| industry.food_manufacturing@1.0.0 | sha256:e62f1bf2d709e226f203702259f1e51a1829df3d8e9be7031f658c026659a5da |

The same hash is pinned twice in tests: `KNOWN_HASH` in templates-018.spec.ts and
`hashManifestJson(FOOD_MANUFACTURING_TEMPLATE_MANIFEST)` equality on the applied
row.

## Golden effective-config pins — every re-pin listed (old → new)

All 16 pre-existing rows moved. Reason: (a) the four manufacturing
SETTINGS_REGISTRY keys land in EVERY tenant's §5 `policies` map as platform
defaults (starter and no-template rows included — see deviation #1), and (b) the
0026 grants widened business/enterprise L4 by the 7 manufacturing keys.

| Row | Old hash | New hash |
|---|---|---|
| industry.retail × starter | sha256:513d6aace8d183e853f187a298a3c2cfad53256afac6e593f7b359c82f532851 | sha256:f1a45d08e47aa1a63fede2559d56ce85a13697cc897bc7c39b01255f6a8fddbb |
| industry.retail × business | sha256:f72ced435a2539a22113682534867034559edab04a9a8502831ba586384d02f5 | sha256:0ce16dc289a5babbdb54329c0544a3065a38eaed5fdad4837eb7bd49ec0bc07f |
| industry.retail × enterprise | sha256:964bfe7fc6bad50d655a3135ef1d1f8182c7fdc7b7377b63814ef425426c8b8d | sha256:14c3a245a75d875dd372e73c37d748b841be1b089ec51651dd3d3c9a62d13678 |
| industry.grocery × starter | sha256:4c85bdcdedaa885c7df1ef8976b6488374a567597540642ed3d193aac3d3bd99 | sha256:ed454222eb2b7fba92f29b6cd44f908782f27263dc95b293d150db3db540ba16 |
| industry.grocery × business | sha256:cba355374615fe31e034f34e5afd17448827b1880b7e3ec1ca725037c2f1df33 | sha256:cc9cc93d1b2b400c265e3562b984a3a740ebac9ea7aa09ad23e1edd6195e7386 |
| industry.grocery × enterprise | sha256:f54f3cc14a35b7ee49281872ff918aaa1672fb336898a1fd79c2da6ab5c1c77b | sha256:a936b485a38e551bab5d5d75b94a8abd1b8fe74cc39afb25d4e4c4fc15c79eca |
| industry.restaurant × starter | sha256:49af6ed1458d0c04b07ca1e9131e21ee28511a6b04e5ddb5c3db702ffcffd785 | sha256:9ca1b313cd0be6ccb0f64f1f67dff5b4a6576a8043bd2c213ec36080939ae2a2 |
| industry.restaurant × business | sha256:2c5e5e8bb22fbe3461871ff5f5a472f8ad5ac7bd6a995685bd07f1d279e4f304 | sha256:8176497a4e8db1f5b4ba655ff6d041b564a3d82189b5dae336c4f1482a577b25 |
| industry.restaurant × enterprise | sha256:2a97c299e0eb1e8b1f2a649c0561d10880eb5bd5e4a394c82c4aee845000d5d0 | sha256:3e78517a723ca19d3100e85ebea47fbe24b9b1cafdb78bcee69ba1ea66183a0d |
| industry.automotive × starter | sha256:169cee5743df89af51dafe74f52d65c64f889ae44c09e67394d315fe043c9358 | sha256:8f05f3bebf9bbd1b7a811b6da44d3ce4b9509d97c79df2adc4dc684fa2272287 |
| industry.automotive × business | sha256:c59538a763bae65882e214f546c69c01e84ecb48150afdde7430843fa7ecea8c | sha256:b8e94c7a9062c38e3f7338d982c79e30c649e62a61fa03f738d3327ed78ddfb3 |
| industry.automotive × enterprise | sha256:d00e6eeff0d3f7ff827e4de9fbfece807e7197b3696d103c45ccd81a11daa169 | sha256:191283eca605aa225c0b98e07319d08739118e95c306a1e8935001e7d3265c36 |
| industry.distribution × starter | sha256:2615cdbecf0dc6c9e2706105c699db744002197dc4ff83156cc8b9381758f7d4 | sha256:89ae25dd341c25ccc53967d2c0f68494a110e24e58300398bf5f306e0e0ab2da |
| industry.distribution × business | sha256:6793c43af8722939f99e8c33f0c7cdd1c0a1438cf0da15aa5a0d2f0c4ecd2883 | sha256:f62571129dbb29ae265925d22486717c4d1fee0e6f1b8701788685b8f8f951d5 |
| industry.distribution × enterprise | sha256:72a685dd53520a14eb23260d4042515061882a589f49883dc9ec81153d6d62d5 | sha256:0c3f9cd6671135633e94086c884fc07b8606e73662869382214447526549a245 |
| (no template) × business | sha256:731e73c803982db76e323723a284056d3f5a52673e30cdf98e55b3755a274bbc | sha256:5011609fc96a6ca47427bdeff903f5c63b99234d6031ffe9cf81dda4e8651cc6 |

New rows: food_manufacturing × starter
`sha256:99a4e9605a944d5b1ad5adbde11f487d176d24aaa455b86f4f64c31eb81e1779`,
× business `sha256:b9a8971082610cb88c131134f9efceb2743f48e127cfa8f24865863b23dbf62e`,
× enterprise `sha256:471bf1a8fe7c8ad47208d6e481f8e8b1e812e15671735cc0f1e49529d1f39a80`.

## templates-018.spec.ts — what the 7 tests prove

1. **Clean apply** (fresh business tenant): applied:true; version 1.0.0 +
   manifestHash == `hashManifestJson(FOOD_MANUFACTURING_TEMPLATE_MANIFEST)` ==
   KNOWN sha256; `bom_production`/`qc_inspections`/`batch_genealogy` (+
   `expiry_tracking_fefo`) all `included`, `requiresAcknowledgement === false`;
   applied-row fields (status ACTIVE, appliedBy owner, hash); tenant-level series
   exactly `Object.keys(document_numbering_defaults).sort()` with
   `PRD-{yyyy}-{seq:5}` @ nextValue 1 (append-only R5; GRN-{seq:6}, DLV-{seq:5}
   too); `overrides.report_pins` order == manifest order
   (manufacturing.production_cost first: pinned+dashboard+this_month); checklist
   ids == manifest onboarding_steps, all `visible` (outlet step's pos.sales is
   entitled on business); `enabled_modules` == default_modules_enabled (incl.
   "manufacturing" → derived `l8_installed.manufacturing === true`); 1 audit
   `industry.template.applied`; derived config: `ui.navigation ==
   ["production","trace"]`, production items `["recipes","orders","qc"]`,
   terminology `mfg.recipe == {en:"Recipe (BOM)", ar:"الوصفة (قائمة المواد)"}`,
   policies `manufacturing.qc_gate == "required"`,
   `manufacturing.consumption_variance_threshold_pct == 5`,
   `manufacturing.scrap_reason_required === true`,
   `manufacturing.fg_batch_expiry_from_shelf_life === true`.
2. **Idempotent re-apply**: applied:false/"already-applied", zero writes
   (appliedAt unchanged, series count unchanged, audit still 1).
3. **Switch safety (BR-038)** restaurant → food_manufacturing → restaurant: REAL
   POS history first (a posted POS-channel counter sale through PosSaleService —
   till + terminal + stocked item + settlement/COGS journals + POS- number), then
   the switch is additive-only: the POS invoice (no/status/channel/total) +
   journal lines survive **byte-identical** across BOTH switches; series = union
   (restaurant rows byte-for-byte untouched, PRD-/DLV-/INV- appended; the POS sale
   numbered from `pos_sale`, so food's `sales_invoice` default registers fresh);
   archived_* snapshots for restaurant present (terminology pos.table, nav floor+
   day, capabilities composite_kits/free_goods_promo/kitchen_display/
   table_service); switch back to restaurant always succeeds; archives hold BOTH
   templates; audit `industry.template.switched` 1 → 2.
4. **Degraded entitlement** (food minus `manufacturing.qc`): typed
   `configuration/template-prerequisites-blocked` + bilingual missingChain
   guidance (`["manufacturing.qc"]`) + ZERO rows (no applied row, no series, no
   audit).
5. **Restaurant WITHOUT the manufacturing add-on** (all 7 keys revoked — the
   clean removal that keeps BR-040 closure valid; revoking only
   bom/production_orders would strand wip/costing/scrap on a broken closure):
   `bom_production` (OPTIONAL, PHASE-018) classifies **`hidden`** with both
   missingKeys and NO phase label (18 shipped — hidden, not phase_gated); apply
   succeeds; nav stays floor/day with zero manufacturing.* targets; resolution
   does not crash; `l8_installed.manufacturing` undefined.
6. **Starter-plan degradation** (assignPlan "starter" through the real
   EntitlementsService): blocked with the exact 8-key chain (below) + zero rows.
7. **L5 beats L1** (BR-038 R8): `tenant_settings` row `manufacturing.qc_gate` =
   "off" → resolved policies show "off" while the manifest ships "required"; the
   other three manufacturing policies keep their L1 defaults.

## Test output tails

- `pnpm validate:manifests` → `OK — 6 manifest(s) valid against §3; ids unique;
  versions semver; required_feature_keys non-empty.` (table above)
- `pnpm --filter @erp/contracts test` → `Test Files 2 passed (2) / Tests 46
  passed (46)`.
- `pnpm typecheck` → `Tasks: 6 successful, 6 total`. · `pnpm lint` → 6/6 ·
  `pnpm run lint:depcruise` → `✔ no dependency violations found (1595 modules,
  6266 dependencies cruised)`.
- `pnpm --filter @erp/api test` → `Test Files 25 passed (25) / Tests 270 passed
  (270)`.
- `pnpm docs:validate` → `29/29 checks passed`.
- DB (isolated `TMPDIR=$HOME/tmp-t37`), configuration subset:
  `templates-018 (7) ✓ templates-017 (6) ✓ template-apply (6) ✓
  degraded-entitlement (3) ✓ template-switch (7) ✓ engine.db (5) ✓
  dependency-closure (3) ✓ — Test Files 7 passed (7) / Tests 37 passed (37)`.
- Full DB suite: `Test Files 1 failed | 88 passed (89) / Tests 1 failed | 1458
  passed (1459)` — the single failure is `billing/readonly-sweep.db.spec.ts`
  "every state-changing registered route returns 403…" listing exactly the 14
  unmounted manufacturing routes (POST/PUT /api/v1/manufacturing/… → 404) — the
  documented T38a/T39 gap; not touched by design.

## Deviations from MASTER-PLAN §13 (with reasons)

1. **More golden rows re-pinned than the brief stated.** The brief said
   business/enterprise rows move (L4 entitlements). In fact ALL 16 existing rows
   moved, including the starter rows and the no-template row: the four
   manufacturing SETTINGS_REGISTRY keys ride into every tenant's §5 `policies`
   map as platform defaults, and the policies map is part of the hashed content.
   Re-pinning all of them is the honest, reviewed decision (each is listed
   above); anything else would have failed the pin gate.
2. **Starter missingChain content.** The brief said "all 7 manufacturing keys +
   inventory.batch_tracking etc. per closure". The actual chain (per the
   checkPrerequisites algorithm, asserted exactly in test 6) is 8 keys:
   `industry.template_engine, inventory.batch_tracking, inventory.stock_counts,
   manufacturing.batch_genealogy, manufacturing.bom,
   manufacturing.production_orders, manufacturing.qc, purchasing.landed_costs`.
   Only the 4 manufacturing keys the manifest REQUIRES enter the chain —
   wip/costing/scrap are granted by 0026 but not required by the template, so
   they are correctly absent.
3. **New bug fix (not in the plan): resolve-service L7 filter.** The switch test
   surfaced a latent PHASE-016 engine bug: POS-channel invoices acquire numbers
   under the internal doc type `pos_sales_invoice` (INV-021), which is NOT one of
   the 21 §3 series-bearing `DOCUMENT_TYPES`. `loadL7Branches` fed every
   numbering_sequences row into `seriesFormats`, so `mergeNumbering` minted
   `numbering.pos_sales_invoice.assign_at` policy keys and
   `validateMergedPolicies` failed closed — any cold-cache `resolveTenantStatic`
   on a tenant that had posted a POS sale threw (masked until now because POS
   sales don't invalidate the config cache). Fixed additively inside my module:
   L7 now admits only §3 series-bearing doc types; the runtime acquisition rows
   stay in the DB untouched (they are number acquisition state, not tenant
   policy). All existing specs still pass.
4. **D.5 "prep-recipe nav items hidden"**: the restaurant manifest carries NO
   manufacturing navigation items by design (its own doc says the production
   layer composes from `food_manufacturing`). The test asserts the equivalent:
   bom_production hidden, floor/day nav intact, zero `manufacturing.*` targets,
   no crash. No manifest content was invented (the manifest is frozen).
5. **D.3 "posted POS/POS-history data"**: implemented with a genuine POS-channel
   counter sale (settlement + COGS journals + POS- number + till), not a
   back-office service invoice — restaurant is the POS-first template, so the
   switch safety proof runs over its own data essence. Seeding is phased
   (tenant-tx → superuser → tenant-tx) because the superuser legs must see
   committed rows (composite FKs).
6. The restaurant→food switch registers a NEW `sales_invoice` series (union has
   7 tenant-level doc types, not 6): the POS sale numbers from `pos_sale`, so no
   `sales_invoice` row pre-existed for the apply to skip — this is the correct
   append-only behavior, asserted explicitly.

## Handoff notes for T38/T39/T40 (the policy keys your services read)

**`config.policies` includes all four manufacturing keys even with NO template
applied** — verified empirically and pinned in
`golden-effective-configs.spec.ts` (the "(no template) × business" anchor):

```
manufacturing.qc_gate                       = "off"   (platform default)
manufacturing.scrap_reason_required         = true
manufacturing.fg_batch_expiry_from_shelf_life = true
manufacturing.consumption_variance_threshold_pct = 5
```

Reason: `effectiveSettings` starts from the full SETTINGS_REGISTRY defaults and
`mergePolicies` flattens every scalar into the §5 policy map. So T38's services
can read `config.policies["manufacturing.qc_gate"]` (etc.) via
`ResolveEffectiveConfigService` **unconditionally** — the keys are always
present; the `readEffectiveSetting` fallback is never needed for them. With
`industry.food_manufacturing` applied, L1 raises the defaults to
required/true/true/5; an explicit L5 `tenant_settings` row
(`manufacturing.qc_gate` = "off") overrides (proven by templates-018 test 7).
Note the naming split: manifests write the POLICY_REGISTRY names
(`production_qc_gate`, …) which map onto the SETTINGS_REGISTRY/L5 names
(`manufacturing.qc_gate`, …) via `settingsKey`.

For T40: the reporting runtime now knows `manufacturing` as a data-source module
at phase 18 with `REGISTERED_PHASE_WINDOW = 18` — appending the three report
contracts to REPORT_CONTRACTS needs no further runtime changes. For T38a/b:
mounting the 24 controllers is the only remaining step to make
`billing/readonly-sweep` pass. For T41: `l8_installed.manufacturing` is true for
food_manufacturing tenants; restaurant tenants without the add-on have no
manufacturing module and no manufacturing nav items (hidden cleanly).
