# T43 / Task 2 — Template & configuration + industry.professional_services template (PHASE-019)

**Agent:** T43 (template & configuration) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — validate:manifests 7/7; contracts unit 50/50 (2 files);
api unit 274/274 (25 files); DB configuration suite **44/44** (8 files, incl.
the 7 new templates-019 tests and the re-checked template-switch R9 preview);
docs:validate 29/29; check:permissions-drift 243=243 OK; lint:depcruise 0
violations. typecheck/lint: 5/6 packages green — @erp/api fails ONLY on two
in-flight files owned by the PARALLEL agents (T44 `zz-probe-t44.db.spec.ts`
unused import; T45 `crm/leads.spec.ts` unused var) — not in my file set, left
untouched per the §16 task-boundary rule.

## Files created

- `apps/api/src/__db__/configuration/templates-019.spec.ts` (7 tests) — the §8
  seven per-template requirements for `industry.professional_services` through
  the UNMODIFIED PHASE-015 engine (details below).
- `agent-ctx/T43-2-template.md` (this file).

## Files changed

- `packages/contracts/src/industry/templates.ts` — added
  `PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST` (deepFreeze, transcribed VERBATIM
  from docs/industries/templates/manifests/manifest.professional_services.json
  — the same canonical source as the 0027 registry seed); appended to
  `SHIPPED_TEMPLATE_MANIFESTS` (7); header comment now documents the
  seven-template set.
- `packages/contracts/src/industry/index.ts` + `packages/contracts/src/index.ts`
  — exported the new constant by name from both barrels.
- `packages/contracts/src/__tests__/industry-manifests.test.ts` — "all six" →
  "all seven" (parse + round-trip + ids pins += industry.professional_services),
  a PHASE-019 pins block (report pins incl. the reconciled live `ar.aging`;
  practice/billing nav groups with the accounting.projects/crm.time/
  crm.contracts/crm.recurring_billing targets; the six §9 workflow policies;
  the INV-/RCP-/CN- numbering rules; required-keys + svc.case terminology),
  and three professional_services negative fixtures: (q) workflow-policy key
  outside lower_snake_case → zod `invalid_key`, (r) numbering default keyed by
  a non-series-bearing doc type (`service_contract`) → `unrecognized_keys`,
  (s) capability with empty feature_keys → `too_small` (minItems 1).
- `apps/api/src/modules/configuration/domain/policy-registry.ts` — new
  "professional services (PHASE-019)" section: `contract_billing_mode` (enum
  retainer_or_milestones|retainer|milestones|hourly, default
  retainer_or_milestones, settingsKey crm.contract_billing_mode, module crm),
  `time_entries_require_case` (bool true, crm.time_entries_require_case),
  `unbilled_time_review_before_invoice` (bool true,
  crm.unbilled_time_review_before_invoice), `invoice_approval_required` (bool
  true, crm.invoice_approval_required), `invoice_numbering_per_series` (bool
  false, crm.invoice_numbering_per_series), `narrative_required_on_time_billing`
  (bool true, crm.narrative_required_on_time_billing) — all six with settingsKey
  + module "crm".
- `apps/api/src/modules/configuration/domain/settings-schema.ts` — the six
  matching `SettingDefinition`s (z.enum default retainer_or_milestones;
  z.boolean() ×4 default true; z.boolean() default false) + the platform-only
  `crm.defer_advance_recognition` (z.boolean(), default false, NOT in the
  manifest).
- `apps/api/src/modules/configuration/application/apply/prerequisites.ts` —
  `CURRENT_SHIPPED_PHASE` "PHASE-018" → **"PHASE-019"** + doc comment notes
  the 0027 CRM+projects grants.
- `apps/api/src/modules/configuration/__tests__/layer-fixtures.ts` —
  `SHIPPED_TEMPLATES` += professional_services (7); `BUSINESS_KEYS` += the
  6-key 0027 block (crm.leads, crm.tasks_activities, crm.service_contracts,
  crm.recurring_billing, crm.service_orders, accounting.projects); REMOVED the
  now-duplicate explicit enterprise rows for accounting.projects/crm.* (they
  ride the business block via the spread — duplicate-free, header note
  0008→0027).
- `apps/api/src/modules/configuration/__tests__/golden-effective-configs.spec.ts`
  — 3 new rows (professional_services × starter/business/enterprise) + full
  re-pin of ALL 19 pre-existing rows (table below) + professional_services
  structural anchors (practice/billing groups + items, svc.case + doc.contract
  terminology, all six crm.* policies incl.
  crm.contract_billing_mode == "retainer_or_milestones", l8_installed.crm
  === true, l4 missing == []) + the no-template platform-defaults anchor
  extended with the seven PHASE-019 keys (incl.
  crm.defer_advance_recognition === false) + a PHASE-019 review note.
- `apps/api/src/modules/configuration/__tests__/template-prerequisites.spec.ts`
  — CURRENT_SHIPPED_PHASE pin → 19 (+phaseNumber("PHASE-019")); automotive
  `service_contracts` now `included` (flipped from phase_gated; 019 shipped +
  0027 grants); the OPTIONAL later-phase example moved to a synthetic
  PHASE-020 rental_logistics entry; the synthetic REQUIRED-later-phase proof
  moved to `accounting.fixed_assets`@**PHASE-020** (§18 lesson 5 — a real
  catalog key no plan grants); a NEW professional_services × business test
  (full practice set included; deposits_late_fees hidden with the §17
  pending-intake pair).
- `apps/api/src/__db__/configuration/template-switch.spec.ts` — R9 preview
  re-checked at the 019 bump: **zero pins moved** (7/7 green unchanged —
  grocery's set was already fully live at 018; the 0027 crm keys touch no
  grocery capability); both phase comments updated to record the re-check.
- `docs/industries/templates/README.md` — index row + phase-map row marked
  **delivered 2026-11-03** with the six-key grant list and the §17
  rental_logistics deferral note (RISK-019/RISK-020).
- `docs/product/FEATURE_CATALOG.md` — §13 crm rows Phase → "019 (shipped
  2026-11-03)"; permission column reconciled to the real 0027 seeds
  (`crm.tasks_activities` now carries `crm.tasks.manage` +
  `crm.activities.manage`; the other rows already matched); accounting.projects
  row marked shipped too.
- `docs/product/SUBSCRIPTION_AND_ENTITLEMENTS.md` — professional services pack
  row marked **SHIPPED PHASE-019** (full six-key bundle); automotive pack note
  "generalization shipped PHASE-019"; §2 plan table honest-ified
  (accounting.projects + crm.* + manufacturing.* moved to Business adds with
  their grant phases); the "> Add-on wiring (PHASE-019, migration
  0027_crm_projects.sql)" note mirroring the 0026 one.

## The manifest hash (recorded verbatim)

```
industry.professional_services@1.0.0
sha256:d000a1159335ce3fa0c327b3f72be2c93b3f3c029fadc90c8bdd30ef1e13429a
```

Byte-equality proven (canonical JSON) across all three sources: the contracts
constant, the docs file, and the migration 0027 `industry_templates` seed
(verified by script: TS constant == docs JSON == the 0027 seed transcription;
`pnpm validate:manifests` 7/7):

| Template | Content hash |
|---|---|
| industry.retail@1.0.0 | sha256:ac0a93342ae85cd9b870c96b2bf63cb13e5e815477ebd9d9679f08700080cbba |
| industry.grocery@1.0.0 | sha256:c6ef7c8a82bdc3817e46e9068892e550ea2bbacb1583d0954f5c86704e29525e |
| industry.restaurant@1.0.0 | sha256:e187c90342250bf0a99497c27e7cb97ec7ce0b7420f76e1b3d1aab1b6954b127 |
| industry.automotive@1.0.0 | sha256:047d5671387ae1872ca8dd2bb6f7235758caa392b7c4441429fc0aadef734172 |
| industry.distribution@1.0.0 | sha256:d31597032af69990560e4041cc6fb566b8c2159ee36d47f6b95b2cdf94be995d |
| industry.food_manufacturing@1.0.0 | sha256:e62f1bf2d709e226f203702259f1e51a1829df3d8e9be7031f658c026659a5da |
| industry.professional_services@1.0.0 | sha256:d000a1159335ce3fa0c327b3f72be2c93b3f3c029fadc90c8bdd30ef1e13429a |

The same hash is pinned twice in tests: `KNOWN_HASH` in templates-019.spec.ts
(asserted on the apply result AND the applied row) +
`hashManifestJson(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST)` equality.

## Golden effective-config pins — every re-pin listed (old → new)

ALL 19 pre-existing rows moved. Reason (§18 lesson 5, confirmed empirically):
the SEVEN new SETTINGS_REGISTRY keys (the six crm.* policy keys + the
platform-only crm.defer_advance_recognition) land in EVERY tenant's §5
`policies` map as platform defaults, and the 0027 grants widened business L4
by the six CRM+projects keys. New hashes computed by direct
`composeTenantStaticConfig` runs over layer-fixtures, then pinned.

| Row | Old hash (018 state) | New hash (019 state) |
|---|---|---|
| industry.retail × starter | sha256:f1a45d08e47aa1a63fede2559d56ce85a13697cc897bc7c39b01255f6a8fddbb | sha256:b8b224a305efd894b2638304f14c6f7366f1fc65f3ff6b76ce4d9468dc3e06c5 |
| industry.retail × business | sha256:0ce16dc289a5babbdb54329c0544a3065a38eaed5fdad4837eb7bd49ec0bc07f | sha256:e42d0ae397506576e3b32c17fa14f46bac0bfa2f05ba7efcea629896f36bfe51 |
| industry.retail × enterprise | sha256:14c3a245a75d875dd372e73c37d748b841be1b089ec51651dd3d3c9a62d13678 | sha256:e8b0ea1e1bd2e5089ec428c4cd4b7619fdce773d6c59b677a9cafcd51978435b |
| industry.grocery × starter | sha256:ed454222eb2b7fba92f29b6cd44f908782f27263dc95b293d150db3db540ba16 | sha256:784e3636e041822a1cf89666c2649f37c410728b61c5f847cefa2efeb7d922ea |
| industry.grocery × business | sha256:cc9cc93d1b2b400c265e3562b984a3a740ebac9ea7aa09ad23e1edd6195e7386 | sha256:584deea54541e60774b3d01c204546ac9659eeabb0232bba967262c6382bf4e2 |
| industry.grocery × enterprise | sha256:a936b485a38e551bab5d5d75b94a8abd1b8fe74cc39afb25d4e4c4fc15c79eca | sha256:454ef52039c4cc93efa28f0e152fdd2d3812389b26f98da186f0240a9deeb448 |
| industry.restaurant × starter | sha256:9ca1b313cd0be6ccb0f64f1f67dff5b4a6576a8043bd2c213ec36080939ae2a2 | sha256:44bf3f272a9215caf5986537a34fd218def0b3373f668c568862281e7f9303c5 |
| industry.restaurant × business | sha256:8176497a4e8db1f5b4ba655ff6d041b564a3d82189b5dae336c4f1482a577b25 | sha256:2f2be5e730e6e135bada13d81a8258b63373008f0626d68e515298c36028c923 |
| industry.restaurant × enterprise | sha256:3e78517a723ca19d3100e85ebea47fbe24b9b1cafdb78bcee69ba1ea66183a0d | sha256:cd067efe0f89e0d70fd8a00acc27f25110772cfa45a9b4500abc457f02b0326e |
| industry.automotive × starter | sha256:8f05f3bebf9bbd1b7a811b6da44d3ce4b9509d97c79df2adc4dc684fa2272287 | sha256:1ea0705e0b0105b0469b6cbe508bfe8dc8778ce45fea5db940d8efe2cfa7bdbc |
| industry.automotive × business | sha256:b8e94c7a9062c38e3f7338d982c79e30c649e62a61fa03f738d3327ed78ddfb3 | sha256:06249c46472cfe6623635e35b96e4d634e9f5c848d18d9b3af4c983a66159d62 |
| industry.automotive × enterprise | sha256:191283eca605aa225c0b98e07319d08739118e95c306a1e8935001e7d3265c36 | sha256:a25be7ecbcb6732c27cb2586ad56ad471acdf7d297faff591575bf5e1170f902 |
| industry.distribution × starter | sha256:89ae25dd341c25ccc53967d2c0f68494a110e24e58300398bf5f306e0e0ab2da | sha256:b4c8573bf6c543d57108e370b2e5228810e0a45b4056e597d8d0965812ec0ea0 |
| industry.distribution × business | sha256:f62571129dbb29ae265925d22486717c4d1fee0e6f1b8701788685b8f8f951d5 | sha256:e14881d954db7360a211fb66512f6e0bd6f4859cef28f9ed60e5ce09e7601d7d |
| industry.distribution × enterprise | sha256:0c3f9cd6671135633e94086c884fc07b8606e73662869382214447526549a245 | sha256:97b935892cfb35c8ded75a4ed1bf1ae2edfcd5aab18daba31853575f0e4a8ff5 |
| industry.food_manufacturing × starter | sha256:99a4e9605a944d5b1ad5adbde11f487d176d24aaa455b86f4f64c31eb81e1779 | sha256:e5b5d8664142749e648a9f16baf7d9fb6a1140f7bbc27086736b879ac17ece8c |
| industry.food_manufacturing × business | sha256:b9a8971082610cb88c131134f9efceb2743f48e127cfa8f24865863b23dbf62e | sha256:f54439610a0edaee72e477a875666ac625bab4b3477905ade15c11dd51833cfa |
| industry.food_manufacturing × enterprise | sha256:471bf1a8fe7c8ad47208d6e481f8e8b1e812e15671735cc0f1e49529d1f39a80 | sha256:07ea44a2f80ba810fbed7762b4ce0cb0dec05c85993420ceb54f6eff1638a9b1 |
| (no template) × business | sha256:5011609fc96a6ca47427bdeff903f5c63b99234d6031ffe9cf81dda4e8651cc6 | sha256:48ebd6f99c82b0af1cb575ea08c4db055521a78a630c471891c15d6734709405 |

New rows: professional_services × starter
`sha256:b8ea666c1fc4c7d728be68359de7f5882e09233c6ae6c142c4603167c7ac85f7`,
× business `sha256:8353be21bc9ad51891b685c3e30864edda83ef1b82c7b5f2964de3888b47e9c6`,
× enterprise `sha256:1683e56a5e7df787c5a016c8c1dadcccbffc6cf9c08bff812d118a51814e135c`.

## templates-019.spec.ts — what the 7 tests prove

1. **Clean apply** (fresh business tenant): applied:true; version 1.0.0 +
   manifestHash == hashManifestJson(constant) == KNOWN sha256 (pinned on the
   result AND the applied row); service_contracts + recurring_billing
   (REQUIRED) `included`, commissions `included`, deposits_late_fees `hidden`
   with the §17 pending-intake pair; series == the four manifest doc types
   sorted (contract_invoice INV-{yyyy}-{seq:6} @ nextValue 1, receipt
   RCP-{yyyy}-{seq:6}, credit_note CN-{yyyy}-{seq:5}, sales_invoice
   INV-{yyyy}-{seq:6}); report_pins order == manifest order
   (services.contract_revenue_schedule first; ar.aging pinned+this_month);
   checklist ids == manifest order, all visible; enabled_modules ==
   default_modules_enabled (crm present); 1 audit
   `industry.template.applied`; derived config: navigation ==
   ["practice","billing"], practice items ["cases","timesheets","contracts"],
   billing items ["recurring","invoices","statements"], terminology
   svc.case == {en "Case / Matter", ar "القضية / الملف"}, policies
   crm.contract_billing_mode == "retainer_or_milestones" + the other five L1
   defaults, l8_installed.crm === true.
2. **Idempotent re-apply**: applied:false/"already-applied", zero writes
   (appliedAt unchanged, series count unchanged, audit still 1).
3. **Switch safety (BR-038)** retail → professional_services → retail: REAL
   posted history first (a posted CREDIT service invoice through the real
   sales flow — submit → approve (SoD) → post; SAL- number + AR subledger
   row), then the switch is additive-only: the invoice (no/status/channel/
   total_gross) + journal lines (direction/amount/accountId/partnerId/
   projectId) survive **byte-identical** across BOTH switches; series =
   union (retail rows byte-for-byte untouched — pos_sale
   POS-{branch}-{yy}{MM}-{seq:5}, credit_note CN-; contract_invoice +
   receipt appended; sales_invoice/credit_note correctly skipped via the
   any-scope listSeriesDocTypes rule); archived_* snapshots for retail
   present (terminology pos sale label, nav selling+stock, all six retail
   capabilities); switch back to retail always succeeds; archives hold BOTH
   templates; audit `industry.template.switched` 1 → 2.
4. **Degraded entitlement** (professional_services minus
   `crm.service_contracts`): typed
   `configuration/template-prerequisites-blocked` + bilingual missingChain
   guidance (["crm.service_contracts"]) + ZERO rows (no applied row, no
   series, no audit).
5. **Automotive WITHOUT the CRM add-on** (the full 5-key set revoked — the
   clean removal that keeps BR-040 closure valid; a single-key revoke would
   strand recurring_billing/service_orders): `service_contracts` (OPTIONAL,
   PHASE-019) classifies **`hidden`** with missingKeys and NO phase label
   (19 shipped — hidden, not phase_gated); apply succeeds; nav stays
   workshop/parts with zero crm.* targets; `l8_installed.crm` undefined.
6. **Starter-plan degradation** (assignPlan "starter" through the real
   EntitlementsService): blocked with the exact 5-key chain
   [accounting.cost_centers, accounting.projects, crm.recurring_billing,
   crm.service_contracts, industry.template_engine] (REQUIRED capabilities +
   the required_feature_keys backstop + the BR-040 closure contribution from
   accounting.projects → cost_centers) + zero rows.
7. **L5 beats L1** (BR-038 R8): `tenant_settings` row
   `crm.time_entries_require_case` = false → resolved policies show false
   while the manifest ships true; the other five crm policies keep their L1
   defaults.

## Test output tails

- `pnpm validate:manifests` → `OK — 7 manifest(s) valid against §3; ids
  unique; versions semver; required_feature_keys non-empty.` (table above)
- `pnpm --filter @erp/contracts test` → `Test Files 2 passed (2) / Tests 50
  passed (50)`.
- `pnpm --filter @erp/api test` → `Test Files 25 passed (25) / Tests 274
  passed (274)`.
- `pnpm run lint:depcruise` → `✔ no dependency violations found (939
  modules, 6186 dependencies cruised)`.
- `pnpm docs:validate` → `29/29 checks passed`.
- `pnpm run check:permissions-drift` → `[permissions-drift] OK — matrix 243
  keys, seed 243 keys`.
- DB (isolated `TMPDIR=$HOME/tmp-t43`), the full configuration directory:
  `templates-019 (7) ✓ templates-018 (7) ✓ templates-017 (6) ✓
  template-apply (6) ✓ degraded-entitlement (3) ✓ template-switch (7) ✓
  engine.db (5) ✓ dependency-closure (3) ✓ — Test Files 8 passed (8) /
  Tests 44 passed (44)`.
- `pnpm typecheck` / `pnpm lint`: contracts/web/domain-core/shared-toolkit
  green; @erp/api fails ONLY on `zz-probe-t44.db.spec.ts` (T44, unused
  `withTenant` import) and `crm/leads.spec.ts` (T45, unused `leadNew`) —
  both files owned by the parallel agents, untouched per the §16 boundary.

## Deviations from MASTER-PLAN §12 (with reasons)

1. **SUBSCRIPTION_AND_ENTITLEMENTS §2 plan table updated beyond the 018
   mirror.** The brief said "the PHASE-019 delivery notes (mirror the 018
   entries)". Beyond the mirrored wiring note + SHIPPED markers, the §2
   table was factually stale after 0027: `accounting.projects` and `crm.*`
   sat in the "Enterprise adds" column while migration 0027 grants both to
   business. Fixed for crm.*/accounting.projects (my phase), and — since it
   was the same class of drift — moved `manufacturing.*` to Business adds
   with a "(PHASE-018 grant)" note (the 0026 change T37 left un-mirrored in
   this table). Subscription docs must not understate business-plan grants.
2. **template-switch R9: zero pins moved — recorded, not "fixed".** The
   brief said "re-check R9 preview expectations (run; fix honestly)". The
   run passed 7/7 unchanged (grocery's capability set was already fully live
   at 018; the 0027 crm keys touch no grocery capability), so the honest
   fix was updating the two phase comments to document the 019 re-check —
   no assertion content was invented.
3. **zod issue-code corrections in the negative fixtures.** (q) planned
   `invalid_format` but zod 4 record-key violations report `invalid_key`
   ("Invalid key in record" — the key schema's custom message does not
   propagate); (r) planned a keyed path but `z.partialRecord` reports
   `unrecognized_keys` at the parent path naming `service_contract` in the
   message. Both fixed to the actual codes/paths (assertions still pin
   exactly one issue each).
4. **templates-019 switch snapshot uses channel "STANDARD"**, not the
   guessed "BACK_OFFICE" (the sales_invoices.channel value for back-office
   invoices); caught from the first run's diff and corrected — the snapshot
   itself is value-agnostic (deep-equal before/after), only the explicit
   row assertion was updated.
5. **FEATURE_CATALOG §13 "Phase → shipped 019"** implemented as the Phase
   column form "019 (shipped 2026-11-03)" (the `platform.notifications` /
   `purchasing.landed_costs` convention for shipped-phase annotations), not
   a structural schema change — docs:validate has no Phase-column format
   check (verified against scripts/validate_docs.py before choosing).

## Handoff notes for T45/T46/T47/T49/T50 (the keys your services read)

**`config.policies` includes all seven PHASE-019 keys even with NO template
applied** — verified empirically and pinned in
`golden-effective-configs.spec.ts` (the "(no template) × business" anchor):

```
crm.contract_billing_mode            = "retainer_or_milestones" (platform default)
crm.time_entries_require_case         = true
crm.unbilled_time_review_before_invoice = true
crm.invoice_approval_required         = true
crm.invoice_numbering_per_series      = false
crm.narrative_required_on_time_billing = true
crm.defer_advance_recognition         = false   (platform-only, L5-overridable)
```

Reason: `effectiveSettings` starts from the full SETTINGS_REGISTRY defaults
and `mergePolicies` flattens every scalar into the §5 policy map. So the crm
services can read `config.policies["crm.invoice_approval_required"]` etc. via
`ResolveEffectiveConfigService` **unconditionally**; `crm.defer_advance_recognition`
(T47's deferral chain) is read the same way — an explicit L5 `tenant_settings`
row (true) overrides the platform default (proven by templates-019 test 7 for
a sibling key; the deferral golden tests set it true directly). With
`industry.professional_services` applied, L1 raises the defaults to the
manifest's shipped values. Note the naming split: manifests write the
POLICY_REGISTRY names (`contract_billing_mode`, …) which map onto the
SETTINGS_REGISTRY/L5 names (`crm.contract_billing_mode`, …) via `settingsKey`.

For T49: the two services.* report pins (contract_revenue_schedule,
time_billing_summary) + ar.aging + sales.commissions_due ride
`overrides.report_pins` at apply time — the reporting registry work only
needs to register the two contracts; the pins already materialize.
For T50: `l8_installed.crm` is true for professional_services tenants;
automotive tenants without the add-on have no crm module and no crm nav
items (hidden cleanly).
