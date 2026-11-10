# P32 / Task 5 — Golden effective-config pins: the 0038-grant re-pin (PHASE-032)

**Agent:** P32 (education commercial shell — configuration-only track) ·
**Repo:** /home/z/phase017_work (the PHASE-027 lineage; stages 028–031 lost to
environment resets on this lineage and remain unshipped — the honesty note in
`template-prerequisites.spec.ts` records it)
**Status:** COMPLETE — the re-pin table below is the reviewed §10 #2 record;
`golden-effective-configs.spec` 29/29 green (25 pinned rows + shape/structure
tests) under the sandbox bun runner; `validate:manifests` 8/8 (education
content hash `sha256:1334e1744256fb10b773d7e00aa056a34974d4efb9564100629228da3c9c9745`).

## Why every business/enterprise pin moved (the reviewed decision)

`layer-fixtures.ts` now transcribes the PHASE-027 migration **0038 plan
grants** (the twelve notes/installments feature keys → business + enterprise,
the tier-4 precedent; starter does NOT get them) because the education
template's REQUIRED chain (`installments.plans`/`collections`/`late_fees`) and
OPTIONAL `pdc_notes` entry (`notes.received`) resolve through exactly those
grants — the same transcription posture the 0025/0026/0027 blocks established
before it. The L4 layer is part of the hashed §5 content, so a reviewed seed
change moves exactly the pins whose L4 changed:

- **The 7 starter pins are byte-stable** — starter never received the 0038
  grants, so its L4 (and its pins) are untouched.
- **The 14 pre-existing business/enterprise pins + the no-template row moved
  (15 rows)** — their L4 grew by the twelve transcribed keys.
- **The 3 education rows are NEW** — `industry.education` ×
  starter/business/enterprise.
- The six new education `POLICY_REGISTRY` keys carry **no settingsKey mapping**
  (the deliberate no-SETTINGS_REGISTRY-surface choice — L1 defaults land under
  their raw policy-key names), so non-education tenants' policy maps and pins
  are byte-stable apart from the L4 grant growth above.
- The 0035/0037 grant blocks stay untranscribed (no shipped template consumes
  their keys — the fixture's documented role is the template-relevant grant
  subset).

## Old → new (22 rows → 25 rows)

| Row | Old (PHASE-027 ship) | New (PHASE-032) | |
|---|---|---|---|
| industry.retail × starter | `sha256:b8b224a305efd894b2638304f14c6f7366f1fc65f3ff6b76ce4d9468dc3e06c5` | — byte-stable — | |
| industry.retail × business | `sha256:c32d2bc8eac2eb814d5c7ce95dcbef064369d1cab95707cd4340637c6bb2561f` | `sha256:cbe6fe4b775e31891456f0f27fa95456dd3bfb783eb4832925d08360e8e0e463` | moved |
| industry.retail × enterprise | `sha256:e8b0ea1e1bd2e5089ec428c4cd4b7619fdce773d6c59b677a9cafcd51978435b` | `sha256:1495168d3443ee1daa3fc122ef55bcbd8a08a6349f1c32ba2ab4aa9d0af2f2b8` | moved |
| industry.grocery × starter | `sha256:784e3636e041822a1cf89666c2649f37c410728b61c5f847cefa2efeb7d922ea` | — byte-stable — | |
| industry.grocery × business | `sha256:bfac33332b7fd47997b70d81e34b5c9162966ed649d6fdbe92dddea6b8eaa528` | `sha256:07e8af07c844d79eac49090e1b317f71cf4d292d9823b4eb48e7d6b0aa8048c7` | moved |
| industry.grocery × enterprise | `sha256:454ef52039c4cc93efa28f0e152fdd2d3812389b26f98da186f0240a9deeb448` | `sha256:ab5a2ef974ccd43bc09f43f7ac309d3d5e7527283ceb46e77273c8f084d511ba` | moved |
| industry.restaurant × starter | `sha256:44bf3f272a9215caf5986537a34fd218def0b3373f668c568862281e7f9303c5` | — byte-stable — | |
| industry.restaurant × business | `sha256:a3d8d005044a4b0d4debd695b98ed08f472c6dda1f659d9cd79cd67e6ff3ad4e` | `sha256:a38caa0a1e16b346f956b6fc517081f9a27e6bc096909103b4ec50840aaafcbf` | moved |
| industry.restaurant × enterprise | `sha256:cd067efe0f89e0d70fd8a00acc27f25110772cfa45a9b4500abc457f02b0326e` | `sha256:6320e7a203c3c4eb0f1dd4f9a34fcd0f156ba189b774be3d3322c887f53f912a` | moved |
| industry.automotive × starter | `sha256:1ea0705e0b0105b0469b6cbe508bfe8dc8778ce45fea5db940d8efe2cfa7bdbc` | — byte-stable — | |
| industry.automotive × business | `sha256:f8b1e3cb14f94119572ca666e80100fe84422270938f392799384083e54a828d` | `sha256:05f78f257ca8ac4f23582c5369fd1f10ce1c2145bcea824561f4566be55e4681` | moved |
| industry.automotive × enterprise | `sha256:a25be7ecbcb6732c27cb2586ad56ad471acdf7d297faff591575bf5e1170f902` | `sha256:5de65928c0b28d4561336ef13eaefe87101d7f2151cd1bd715354907ab3f7b9c` | moved |
| industry.distribution × starter | `sha256:b4c8573bf6c543d57108e370b2e5228810e0a45b4056e597d8d0965812ec0ea0` | — byte-stable — | |
| industry.distribution × business | `sha256:50758aab1d63d8182b6c000c6666104ce0d16818ea53111aba2b174adaa2b18f` | `sha256:a143fd468e25560fdef6bb73a00a14e4ae6d805cd95722dadcb8840624c41576` | moved |
| industry.distribution × enterprise | `sha256:97b935892cfb35c8ded75a4ed1bf1ae2edfcd5aab18daba31853575f0e4a8ff5` | `sha256:ccff2bd02b90557aa195ef0c912d3d766ed6f50db4334911e88caef69f6db7c5` | moved |
| industry.food_manufacturing × starter | `sha256:e5b5d8664142749e648a9f16baf7d9fb6a1140f7bbc27086736b879ac17ece8c` | — byte-stable — | |
| industry.food_manufacturing × business | `sha256:ba98dacd8467149863dae37b8ac89fd548ae8575a4a7e849876a90b093a15774` | `sha256:50882f04923ba0b21ae5d8993d8656e6df60678fb03145e71bbbb06e586ab6a6` | moved |
| industry.food_manufacturing × enterprise | `sha256:07ea44a2f80ba810fbed7762b4ce0cb0dec05c85993420ceb54f6eff1638a9b1` | `sha256:b4e9e4fe4bcf568beac08244325b5e314a9d2da37ab99d96cf4153268e088e6d` | moved |
| industry.professional_services × starter | `sha256:b8ea666c1fc4c7d728be68359de7f5882e09233c6ae6c142c4603167c7ac85f7` | — byte-stable — | |
| industry.professional_services × business | `sha256:e5b6c557bf37b75cd3d9591f93e9f7acb543fd86129cf9c963142d67916bf90c` | `sha256:e8fee3cb3ae30c6f6458c3ae9e8c964460d4737a2608874b9aea00ae4f2e8519` | moved |
| industry.professional_services × enterprise | `sha256:1683e56a5e7df787c5a016c8c1dadcccbffc6cf9c08bff812d118a51814e135c` | `sha256:1a5435a24b292c8071b739b7e8d4fc17b3d8fbeb51ff850f826bb2cc18770fe6` | moved |
| (no template) × business | `sha256:cc4c714d205842a1b8da9a9d3ab7909f8f19fef07dc1d43678964304a102cfbb` | `sha256:9718517f38dc4a9ec0bcb9086aaa5781b5cb3610c00c3a01b73b17d61cc59d9e` | moved |
| industry.education × starter | — | `sha256:eabd9b35bbff4ecca11ea57154c0791d2403717459fb47a771a3dbda579c06da` | NEW |
| industry.education × business | — | `sha256:29e147555dce1a4d3da6027d6d7e8e73392572d9000b0b8cc1c93c597f0f7cbc` | NEW |
| industry.education × enterprise | — | `sha256:421a8d59db03671e3cd968ce37eee3498ac4e753e3375eb24e55bf3c4a68d637` | NEW |

Method: every pin was recomputed by running the compose pipeline
(`composeTenantStaticConfig` over the updated `layer-fixtures.ts`) under bun —
the 22 pre-existing pins reproduced first (22/22 exact, proving the harness),
then the fixtures grew the 0038 block and the three education rows pinned with
the rest. The old values above are `git show HEAD:` of the pre-PHASE-032 spec.
