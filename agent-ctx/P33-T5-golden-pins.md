# P33 / Task 5 — Golden effective-config pins: the zero-move ship (PHASE-033)

**Agent:** P33 (agriculture commercial shell — configuration-only track) ·
**Repo:** /home/z/phase017_work (the PHASE-027 lineage; stages 028–031 lost to
environment resets on this lineage and remain unshipped — the honesty note in
`template-prerequisites.spec.ts` records it)
**Status:** COMPLETE — the table below is the reviewed §10 #2 record;
`golden-effective-configs.spec` 32/32 green (28 pinned rows + shape/structure
tests) under the sandbox bun runner; `validate:manifests` 9/9 (agriculture
content hash `sha256:f30e4fa0b39f05672cb6331e324a8798cc65cda3887a75aa57daabd49f1b72ce`).

## Why ZERO existing pins moved (the reviewed decision)

Agriculture is the **first shipped template whose REQUIRED chain resolves
entirely through already-transcribed grants** — no layer-fixtures change, no
SETTINGS_REGISTRY change, no plan-grant migration:

- `manufacturing.bom` / `manufacturing.production_orders` — the 0026 block
  (business + enterprise; the `harvest_batches` OPTIONAL key
  `manufacturing.batch_genealogy` rides the same block).
- `inventory.batch_tracking` + `accounting.cost_centers` — the 0008 base
  business seed.
- `purchasing.orders` / `purchasing.goods_receipts` / `sales.invoices` — the
  starter base (all three plans).
- `accounting.projects` — the 0027 block.
- `industry.template_engine` — the 0025 block.

Migration 0040 therefore adds **no plan grants** (the deliberate difference
from 0039, which transcribed the 0038 grants its chain needed — those were
already SQL-side; here nothing new is needed at all), so `BUSINESS_KEYS` /
`ENTERPRISE_KEYS` / `STARTER_KEYS` are byte-identical to the PHASE-032
transcription. The four new agriculture `POLICY_REGISTRY` keys carry **no
settingsKey mapping** (the 0039 precedent — L1 defaults land under their raw
policy-key names), so non-agriculture tenants' policy maps are untouched; the
two REUSED PHASE-018 manufacturing keys (`scrap_reason_required`,
`consumption_variance_threshold_pct`) land with values identical to the
platform defaults (true / 5), so even the agriculture tenant's settings-key
run values are the platform ones.

## Old → new (25 rows → 28 rows)

| Row | Old (PHASE-032 ship) | New (PHASE-033) | |
|---|---|---|---|
| industry.retail × starter | `sha256:b8b224a305efd894b2638304f14c6f7366f1fc65f3ff6b76ce4d9468dc3e06c5` | — byte-stable — | |
| industry.retail × business | `sha256:cbe6fe4b775e31891456f0f27fa95456dd3bfb783eb4832925d08360e8e0e463` | — byte-stable — | |
| industry.retail × enterprise | `sha256:1495168d3443ee1daa3fc122ef55bcbd8a08a6349f1c32ba2ab4aa9d0af2f2b8` | — byte-stable — | |
| industry.grocery × starter | `sha256:784e3636e041822a1cf89666c2649f37c410728b61c5f847cefa2efeb7d922ea` | — byte-stable — | |
| industry.grocery × business | `sha256:07e8af07c844d79eac49090e1b317f71cf4d292d9823b4eb48e7d6b0aa8048c7` | — byte-stable — | |
| industry.grocery × enterprise | `sha256:ab5a2ef974ccd43bc09f43f7ac309d3d5e7527283ceb46e77273c8f084d511ba` | — byte-stable — | |
| industry.restaurant × starter | `sha256:44bf3f272a9215caf5986537a34fd218def0b3373f668c568862281e7f9303c5` | — byte-stable — | |
| industry.restaurant × business | `sha256:a38caa0a1e16b346f956b6fc517081f9a27e6bc096909103b4ec50840aaafcbf` | — byte-stable — | |
| industry.restaurant × enterprise | `sha256:6320e7a203c3c4eb0f1dd4f9a34fcd0f156ba189b774be3d3322c887f53f912a` | — byte-stable — | |
| industry.automotive × starter | `sha256:1ea0705e0b0105b0469b6cbe508bfe8dc8778ce45fea5db940d8efe2cfa7bdbc` | — byte-stable — | |
| industry.automotive × business | `sha256:05f78f257ca8ac4f23582c5369fd1f10ce1c2145bcea824561f4566be55e4681` | — byte-stable — | |
| industry.automotive × enterprise | `sha256:5de65928c0b28d4561336ef13eaefe87101d7f2151cd1bd715354907ab3f7b9c` | — byte-stable — | |
| industry.distribution × starter | `sha256:b4c8573bf6c543d57108e370b2e5228810e0a45b4056e597d8d0965812ec0ea0` | — byte-stable — | |
| industry.distribution × business | `sha256:a143fd468e25560fdef6bb73a00a14e4ae6d805cd95722dadcb8840624c41576` | — byte-stable — | |
| industry.distribution × enterprise | `sha256:ccff2bd02b90557aa195ef0c912d3d766ed6f50db4334911e88caef69f6db7c5` | — byte-stable — | |
| industry.food_manufacturing × starter | `sha256:e5b5d8664142749e648a9f16baf7d9fb6a1140f7bbc27086736b879ac17ece8c` | — byte-stable — | |
| industry.food_manufacturing × business | `sha256:50882f04923ba0b21ae5d8993d8656e6df60678fb03145e71bbbb06e586ab6a6` | — byte-stable — | |
| industry.food_manufacturing × enterprise | `sha256:b4e9e4fe4bcf568beac08244325b5e314a9d2da37ab99d96cf4153268e088e6d` | — byte-stable — | |
| industry.professional_services × starter | `sha256:b8ea666c1fc4c7d728be68359de7f5882e09233c6ae6c142c4603167c7ac85f7` | — byte-stable — | |
| industry.professional_services × business | `sha256:e8fee3cb3ae30c6f6458c3ae9e8c964460d4737a2608874b9aea00ae4f2e8519` | — byte-stable — | |
| industry.professional_services × enterprise | `sha256:1a5435a24b292c8071b739b7e8d4fc17b3d8fbeb51ff850f826bb2cc18770fe6` | — byte-stable — | |
| industry.education × starter | `sha256:eabd9b35bbff4ecca11ea57154c0791d2403717459fb47a771a3dbda579c06da` | — byte-stable — | |
| industry.education × business | `sha256:29e147555dce1a4d3da6027d6d7e8e73392572d9000b0b8cc1c93c597f0f7cbc` | — byte-stable — | |
| industry.education × enterprise | `sha256:421a8d59db03671e3cd968ce37eee3498ac4e753e3375eb24e55bf3c4a68d637` | — byte-stable — | |
| (no template) × business | `sha256:9718517f38dc4a9ec0bcb9086aaa5781b5cb3610c00c3a01b73b17d61cc59d9e` | — byte-stable — | |
| industry.agriculture × starter | — | `sha256:61b168b4a659a4d295504488a979bb6ad0e1579fc76f076a0f33349d11d0f034` | NEW |
| industry.agriculture × business | — | `sha256:7261f1a473e216d560417b632b78486deb5384af93afefcc12f6d0fd2058c0c9` | NEW |
| industry.agriculture × enterprise | — | `sha256:f0e4e461c659ea4206649ea059a8064c5b15068d5ab0af848a8db5a76df96fa5` | NEW |

Method: every pin was recomputed by running the compose pipeline
(`composeTenantStaticConfig` over the fixtures) under bun — the 25
pre-existing pins reproduced exactly (25/25, proving both the harness and the
zero-move claim; the education × business spot check: `29e14755…f7cbc`
unchanged), then the three agriculture rows pinned with the rest. The old
values above are the PHASE-032 `GOLDEN` map verbatim (the pre-PHASE-033
spec at `git show HEAD:`).
