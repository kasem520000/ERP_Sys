# Task 2-a — PHASE-017 T2: seed + apply both industry templates via the PHASE-015 engine

**Agent:** 2-a (configuration + contracts + docs manifests) · **Task ID:** 2-a · **Repo:** /home/z/phase017_work
**Status:** DONE — all verification green (contracts 42/42, api unit 267/267, configuration db 30/30 incl. the new 6-test spec, entitlements db 11/11, `validate:manifests` 5/5, typecheck 6/6 turbo tasks, eslint clean, `validate_docs.py` 29/29).

The engine (`apply-service` / `applied-state.store` / `switch-service` / `drift-service` / compose+derivation) is **UNMODIFIED** — everything below is constants, registry data, docs, and tests.

## Files shipped

### Contracts (`packages/contracts`)

| File | Change |
|---|---|
| `src/industry/templates.ts` | `AUTOMOTIVE_TEMPLATE_MANIFEST` + `DISTRIBUTION_TEMPLATE_MANIFEST` (typed, deep-frozen), **transcribed verbatim from the migration 0025 `industry_templates` seeds** — verified programmatically byte-equal to the seed JSON (key order included; script imported both constants, parsed the seed literals out of the SQL, `JSON.stringify` identity). Automotive pins the reconciled live keys `inventory.valuation` + `ar.aging` (NOT `inventory.stock_valuation`/`partners.ar_aging`). Both added to `SHIPPED_TEMPLATE_MANIFESTS` (now 5). |
| `src/industry/index.ts`, `src/index.ts` | Export the two constants (additive; the main `src/index.ts` export block is alphabetical and previously listed only the three 015 manifests — that was the one contracts-test failure on first run). |
| `src/__tests__/industry-manifests.test.ts` | Shipped-set assertions 3 → 5: describe title, `all five parse + round-trip`, exact ids array `[retail, grocery, restaurant, automotive, distribution]` @ 1.0.0, frozen-ness loop over `SHIPPED_TEMPLATE_MANIFESTS`. New test "the PHASE-017 pair pins the live report keys (0025 reconciliation)": automotive pins `[automotive.job_card_profitability, automotive.vehicle_service_history, inventory.valuation, ar.aging]`, distribution pins the 5 van-sales reports, nav groups `[workshop, parts]` / `[field, settle]`, `sales.job_cards` in automotive's required set. |

### Configuration (`apps/api/src/modules/configuration`)

| File | Change |
|---|---|
| `application/apply/prerequisites.ts` | `CURRENT_SHIPPED_PHASE` **16 → 17** + doc comments (017 shipped `sales.job_cards` + the distribution set). |
| `domain/feature-catalog.ts` | `FEATURE_DEPS += "sales.job_cards": ["sales.quotations", "inventory.reservations"]` (PHASE-017 intake, §25 protocol). **Load-bearing, see Mechanism below.** |
| `domain/policy-registry.ts` | 11 new `POLICY_REGISTRY` keys — automotive: `job_card_parts_issue_mode` (enum `reserve\|issue_immediate`, default reserve), `job_card_labor_rate_source` (enum `[price_list]`), `quotation_validity_days` (number, 7, BR-006), `invoice_approval_required_over` (number, 0, BR-034 leg), `warranty_credit_note_requires_original_invoice` (bool, BR-004 family); distribution: `van_loadout_requires_transfer` (BR-016), `settlement_required_daily`, `settlement_variance_approval_required` (BR-021 family), `collection_receipt_at_visit`, `tier_price_automatic_by_partner` (BR-003), `credit_sale_credit_limit_enforced` (BR-001), `free_goods_require_reason_code` (BR-008). Without these, `templateSettingDefaults`/`validateMergedPolicies` throw `unknown policy key` on the first automotive/distribution compose. |
| `__tests__/layer-fixtures.ts` | `SHIPPED_TEMPLATES` 3 → 5; `BUSINESS_KEYS` += the 0025 plan grants (`sales.job_cards`, `sales.commissions`, `distribution.{routes,van_stock,settlements,customer_tiers,free_goods}`, `inventory.reservations`); `ENTERPRISE_KEYS` restructured to inherit them from business. |
| `__tests__/golden-effective-configs.spec.ts` | **6 new golden pins** (automotive × starter/business/enterprise, distribution × starter/business/enterprise) + 7 re-pinned (retail/grocery/restaurant × business+enterprise + no-template × business — the L4 entitlement layer is hashed content, so the reviewed 0025 seed change moves exactly those; starter pins unchanged, proving the diff is the plan keys). Structural anchors: workshop/parts + field/settle nav trees, terminology `بطاقة عمل` / `أجور العمل` / `رقم الهيكل` / `خط السير` / `التحميل الصباحي` / `تسوية المندوب` / `مندوب التوزيع` (AR + EN), job-card + settlement policies, `numbering.job_card.assign_at = posting`, `numbering.purchase_order.assign_at = approval`, L8 `distribution` installed, `l4.missing = []` on business/enterprise. The cash-autopost structural assertion split: the 015 trio auto-posts; the 017 pair leaves the platform default (their manifests set no `cash_sales_autopost`). |
| `__tests__/template-prerequisites.spec.ts` | `CURRENT_SHIPPED_PHASE` assertion → 17; grocery tier test rewritten (customer_price_tiers **included** on post-0025 business; without the key → honest BLOCKED, guided plan selection); new automotive × business (job_cards LIVE, service_contracts PHASE-019 / qc_inspections PHASE-018 coming-soon, no acknowledgement), distribution × business (all 9 REQUIRED included), automotive-minus-job-cards (blocked, exact chain); synthetic PHASE-018 REQUIRED capability test **preserving the acknowledgement mechanism**; enterprise closure loop over all 5 manifests. |
| `application/resolve/terminology.ts` | Comment only ("three shipped manifests" → "shipped manifests"). |

### DB specs (`apps/api/src/__db__/configuration`)

| File | Change |
|---|---|
| `templates-017.spec.ts` | **NEW — 6 tests** (see Test outputs). Tenants: auto-017 / dist-017 / switch-auto / auto-degraded / grocery-live, all fresh business-plan tenants through the REAL `RegistrationService` (the existing template-apply spec's seeding pattern — registration materializes TRIAL entitlements from `plans.feature_keys`, so post-0025 business tenants carry `sales.job_cards` etc. automatically). |
| `template-switch.spec.ts` | retail→grocery expectations updated to the PHASE-017 reality: `customer_price_tiers` now in `addedCapabilities.included`; the only phase-gated entry is the OPTIONAL `qc_inspections` (PHASE-018); `acknowledgementRequired = false`, `acknowledgementPhases = []`. The "switch without acknowledgement fails" test is replaced by "switches additively to grocery with NO acknowledgement" — at CURRENT 17 + the 0025 grants **no shipped-template pair on business/enterprise carries a REQUIRED-phase-gated difference any more** (the mechanism itself stays implemented and unit-covered). |
| `engine.db.spec.ts` | Comment only (0022 seeds the first three rows + 0025 the pair). |

### Docs + scripts

| File | Change |
|---|---|
| `docs/industries/templates/automotive-workshop.md` | The json fence `report_defaults`: `inventory.stock_valuation` → **`inventory.valuation`**, `partners.ar_aging` → **`ar.aging`** (the live report-registry keys, verified in `reporting/registry/operational/{inventory,ar-ap}.ts`); the "Reports emphasized" prose line likewise. The .md is the extraction source, so fixing only the json file would drift on the next `extract_manifests.py` run. |
| `docs/industries/templates/manifests/manifest.automotive.json` | Regenerated via `python3 scripts/extract_manifests.py` — content diff vs. before is EXACTLY the two report keys (all 12 other regenerated manifests byte-identical, mtime-only). |
| `docs/industries/templates/manifests/manifest.distribution.json` | **Unchanged** — programmatically deep-compared against the 0025 seed: semantically IDENTICAL (key-order-insensitive and value-exact). |
| `docs/product/FEATURE_CATALOG.md` | `sales.job_cards` row added to §8 sales (phase 017, permission `sales.job_cards.manage`, depends on `sales.quotations`, `inventory.reservations`) — the feature-catalog sync rule (machine mirror ↔ docs table in the same PR). |
| `scripts/validate-manifests.ts` | Comment only (three → five; sources named). |

## The `sales.job_cards` phase-gating mechanism (explained)

`sales.job_cards` was the **CAPABILITY_MATRIX §3 pending-intake key for PHASE-017**. The engine has two phase-gate mechanisms in `domain/feature-catalog.ts` + `application/apply/prerequisites.ts`:

1. **Intake gating** — `PHASE_GATED_INTAKE_KEYS` + `INTAKE_TARGET_PHASE`: keys that exist in no manifest-validated catalog yet. A capability whose *missing* keys are intake keys resolves `phase_gated` labeled "coming with PHASE-0NN" (satisfied-but-labeled; excluded from the BR-040 closure universe). The set is EMPTY since 0024 registered the POS pair — the mechanism stays for the next intake.
2. **Roadmap gating** — `available_from_phase > CURRENT_SHIPPED_PHASE` ⇒ `phase_gated` whatever the entitlements.

For 017 the correct §25-protocol move is NOT the intake set (that would keep job cards labeled coming-soon) but a **full FEATURE_DEPS registration** — which migration 0025's plan grants already assume. Registering `"sales.job_cards": ["sales.quotations", "inventory.reservations"]` is what makes it "resolve live at 17":

- `validateL1RequiredKeys` (engine L1 boundary) rejects a manifest requiring an unknown key → automotive could not even resolve;
- `resolveFeatureAvailability` asserts BR-040 closure over the L4 active set → **every business/enterprise tenant's entitlement set** (which carries `sales.job_cards` post-0025) would throw `configuration/dependency-closure-violated` at resolve time;
- `checkPrerequisites`' closure universe includes required keys → automotive apply would always block with `sales.job_cards` in the chain;
- `entitlements.db.spec` "the seeded plans satisfy BR-040 against the catalog" fails on the business/enterprise plan rows.

With the registration + `CURRENT_SHIPPED_PHASE = 17` + the 0025 grants, automotive's `job_cards` capability classifies **included** on business/enterprise, and a tenant missing the key gets the typed blocked error (proven in both unit and db specs).

## Grocery tier liveness mechanism (explained)

The "coming with PHASE-017" entry is the grocery manifest's `capability_prerequisites.customer_price_tiers` (`REQUIRED`, `[distribution.customer_tiers]`, `available_from_phase: PHASE-017`). §4 gates on **missing keys**: a capability whose keys are all granted is `included` regardless of phase. It went live through three coordinated changes:

1. **Migration 0025** granted `distribution.customer_tiers` to business + enterprise (the entitlement source — done by 1-b, untouched by me).
2. **`CURRENT_SHIPPED_PHASE` 16 → 17** — for any tenant whose set does NOT carry the key, the entry is no longer `phase_gated` ("قادم مع المرحلة 017") but an honest uncovered REQUIRED key → BLOCKED with guided plan selection (never a silent gate).
3. **`layer-fixtures.ts` BUSINESS_KEYS** transcribed the 0025 grants, so the unit fixtures + golden pins reflect the real plans (this is also what re-pinned the 7 golden hashes).

Evidence: `templates-017.spec.ts` test 6 — apply grocery on a fresh business tenant ⇒ `customer_price_tiers` = `{ status: "included", featureKeys: ["distribution.customer_tiers"] }`, `phase` undefined, `requiresAcknowledgement: false`, the `tiers` checklist step `visible`, the `tiers` nav item live in the derived config, and `distribution.customer_tiers` in `l4.active`.

## Switch-safety evidence (BR-038, templates-017.spec test 4)

Retail applied over real business data (posted NS invoice via the real sales flow + stock item + SoD approver) → `switchService.switch(retail → automotive)` (no acknowledgement needed — nothing REQUIRED is phase-gated at 17):

- **Zero data loss**: `sales_invoices` row still `{invoice_no: <original>, status: "POSTED"}`; item still `{sku: SWITCH-AUTO-ITEM-1, track_batch: false}`.
- **`archived_*` snapshots present**: `archived_terminology[0]` = retail v1.0.0 with `pos.terminal → {Terminal, الطرفية}`; `archived_navigation[0]` = 2 groups (selling + stock); `archived_capabilities[0]` = retail-only caps `[cashier_shifts, composite_kits, free_goods_promo, imei_tracking]`.
- **Additive-only series**: retail tenant-level rows `[credit_note, pos_sale, stock_transfer]` unchanged (pos_sale format byte-identical `POS-{branch}-{yy}{MM}-{seq:5}`); automotive adds `job_card` (JC-), `quotation` (QT-), `purchase_order` (PO-); `sales_invoice`/`credit_note` kept (R5 skip-existing).
- **Audit**: `industry.template.switched` × 1.
- **Switch back to retail succeeds**: applied row retail again (hash = retail manifest), archives hold BOTH template sets (`[industry.retail, industry.automotive]`), the JC/QT/PO series REMAIN (append-only), the posted invoice STILL untouched, audit × 2.

## Test outputs (final)

```
pnpm --filter @erp/contracts test        → Test Files 2 passed (2) · Tests 42 passed (42)
pnpm --filter @erp/contracts typecheck   → clean   ·  lint → clean
pnpm --filter @erp/api test              → Test Files 25 passed (25) · Tests 267 passed (267)
pnpm --filter @erp/api typecheck         → clean   ·  lint → clean
pnpm typecheck (turbo, root)             → 6/6 tasks successful
pnpm validate:manifests                  → OK — 5 manifest(s) valid against §3
  industry.retail      sha256:ac0a93342ae85cd9b870c96b2bf63cb13e5e815477ebd9d9679f08700080cbba (unchanged)
  industry.grocery     sha256:c6ef7c8a82bdc3817e46e9068892e550ea2bbacb1583d0954f5c86704e29525e (unchanged)
  industry.restaurant  sha256:e187c90342250bf0a99497c27e7cb97ec7ce0b7420f76e1b3d1aab1b6954b127 (unchanged)
  industry.automotive  sha256:047d5671387ae1872ca8dd2bb6f7235758caa392b7c4441429fc0aadef734172 (NEW — equals the 0025 seed hash)
  industry.distribution sha256:d31597032af69990560e4041cc6fb566b8c2159ee36d47f6b95b2cdf94be995d (NEW — equals the 0025 seed hash)

TMPDIR=$HOME/tmp-2a npx vitest run --config vitest.db.config.ts src/__db__/configuration/templates-017.spec.ts
  ✓ templates-017.spec.ts (6 tests) — 1. automotive apply (row/version/KNOWN 0025 hash, JC- series,
    pins incl. inventory.valuation + ar.aging, checklist all-visible, audit ×1, workshop/parts nav,
    بطاقة عمل terminology, policies) · 2. distribution apply (STL/LOD/RCP series, 5 pins, field/settle
    nav, خط السير/التحميل الصباحي terminology, L8 distribution on) · 3. idempotent re-apply ·
    4. switch safety retail→automotive→retail (BR-038 evidence above) · 5. degraded entitlement
    (missingChain ["sales.job_cards"], zero rows/series/audit) · 6. grocery tier liveness.

TMPDIR=$HOME/tmp-2a npx vitest run --config vitest.db.config.ts src/__db__/configuration/ src/__db__/entitlements.db.spec.ts
  ✓ templates-017.spec.ts (6) · template-apply.spec.ts (6) · entitlements.db.spec.ts (11 — incl. the
    plan-seed BR-040 guarantee over the post-0025 plans) · degraded-entitlement.spec.ts (3) ·
    template-switch.spec.ts (7) · engine.db.spec.ts (5) · dependency-closure.spec.ts (3)
  Test Files 7 passed (7) · Tests 41 passed (41)

python3 scripts/validate_docs.py          → 29/29 checks passed
```

## Deviations / decisions (read before building on this)

1. **`FEATURE_DEPS` + `FEATURE_CATALOG.md` `sales.job_cards` registration** was not an explicit bullet in my task but is strictly required for "both templates apply via the UNMODIFIED engine" (four failure modes listed in the Mechanism section; the plan-seed spec was failing without it). Deps are exactly PHASE-017 T1's (`sales.quotations`, `inventory.reservations`). If T1's agent also adds the row, the doc edit is idempotent — reconcile to one row.
2. **`POLICY_REGISTRY` extension (11 keys)** — the platform policy registry is the sanctioned surface for new manifest policy keys ("a manifest may only set keys THIS registry knows"); the engine is untouched.
3. **7 golden pins re-pinned** (business/enterprise + no-template) — reviewed change, documented in the spec header; the starter pins are byte-identical, isolating the cause to the transcribed 0025 plan grants.
4. **template-switch.spec acknowledgement test reworked** — no shipped pair can produce a REQUIRED-phase-gated difference at CURRENT 17 on business/enterprise; the typed `TemplateSwitchAcknowledgementRequiredError` path remains implemented and is now covered by the synthetic-manifest unit test (`PHASE-018` REQUIRED capability ⇒ `phase_gated` + `requiresAcknowledgement: true`).
5. **Automotive .md fence fixed too** (not just the extracted json) because `extract_manifests.py` regenerates the manifests/ directory from the .md fences; the "Reports emphasized" prose line was reconciled as well. Distribution doc + manifest: no semantic mismatch found (deep-compared against the seed) — untouched.
6. **`SUPPORTED_ACTIVITIES` NOT extended** — the bilingual activity→template wizard catalog is a PHASE-015 onboarding surface (3 entries by design); automotive/distribution apply via the admin template endpoints (`GET/POST /api/v1/configuration/templates*`). Extending the wizard catalog belongs to the onboarding-UI owner.
7. **Prettier**: many pre-existing files in these packages are not prettier-formatted (verified on untouched files); I matched the surrounding style rather than reformatting.
8. Untouched per constraints: migrations, `src/db/schema.ts`, `route-permissions.ts`, all sales/partners/distribution module files (a parallel agent is actively landing the distribution module core — their `core.spec.ts`/module files appeared during my session and are theirs).
