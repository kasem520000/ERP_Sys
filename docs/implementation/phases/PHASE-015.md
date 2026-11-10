# PHASE-015 — Industry Configuration Framework & Priority Templates

> **Status:** COMPLETE · **Updated:** 2026-11-02

## 1. Phase Overview

- **Phase ID:** PHASE-015
- **Title:** Industry Configuration Framework & Priority Templates
- **Objective:** Implement the `configuration` module's full ten-layer resolution
  engine — `resolveEffectiveConfig(tenant)` per
  [../../product/CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) — with
  deterministic layer merging, content-hash caching, event-driven invalidation, and
  fail-closed validation; on top of it, ship the industry template engine
  (`industry_templates` registry, versioned manifests, `tenant_industry_config`
  application, additive-only switching per BR-038, terminology and navigation overlays)
  and apply the first three templates — `industry.retail`, `industry.grocery`,
  `industry.restaurant` — exactly as their manifests define them, including the
  PHASE-015-assigned supporting features and industry reports those templates pin.
- **Business value:** This is "configuration without chaos"
  ([../../PROJECT_VISION.md](../../PROJECT_VISION.md) pillar 2) made real: a retail,
  grocery, or restaurant tenant onboards into a workspace that speaks its language
  (Arabic-first terminology, its menus, its workflow defaults) on the same financial
  core — without code forks (RISK-002 mitigation), and with template switching that can
  never corrupt a live business (BR-038).

## 2. Scope

In scope:

1. **Ten-layer resolution engine** (configuration module):
   `resolveEffectiveConfig(tenantId)` merging L1 industry template → L2 jurisdiction pack
   → L3 subscription plan → L4 entitlements → L5 tenant settings → L7 branch settings →
   L8 installed modules → L10 workflow/policy config, per the resolution algorithm and
   precedence table in
   [CONFIGURATION_ENGINE.md §3](../../product/CONFIGURATION_ENGINE.md). Includes:
   schema validation of the merged result against the typed-key registry (§4 — unknown
   keys/type violations fail **loudly**, never silently drop), feature dependency-closure
   check (BR-040), request-scoped L6 overlay (permissions + branch scope, never cached
   across principals), L9 navigation/terminology **derivation only**, and the
   tenant-static cache keyed by content hash with the §9 invalidation-event wiring
   (`tenant.updated`, `template.applied`/`template.switched`, `pack.upgraded`,
   `plan.changed`/`entitlements.changed`, `settings.changed`, `branch.updated`,
   `module.installed`/`module.deactivated`, `policy.changed`; L6 events invalidate the
   request overlay only).
2. **Template registry + manifest schema** (L1): `industry_templates` as the
   platform-owned, semantically-versioned manifest registry (MINOR/PATCH/MAJOR rules,
   [../../industries/README.md](../../industries/README.md) §8) validated in CI against
   the JSON Schema of [README §3](../../industries/README.md) — no manifest ships or
   upgrades without passing schema validation. The three template manifests
   ([retail.md](../../industries/templates/retail.md),
   [grocery-supermarket.md](../../industries/templates/grocery-supermarket.md),
   [restaurant-cafe.md](../../industries/templates/restaurant-cafe.md)) are seeded as
   `industry.retail`, `industry.grocery`, `industry.restaurant` v1.0.0.
3. **Template application service**: one idempotent, audited transaction that resolves
   the registrant's business activity → template id, runs the entitlement + phase check
   via `capability_prerequisites` (REQUIRED-missing ⇒ blocked with guided plan
   selection; REQUIRED-phase-gated ⇒ labeled "coming with PHASE-016", back-office mode
   available immediately, per [README §4](../../industries/README.md)), then applies:
   enable modules, install navigation + terminology, create numbering series
   (pack mandates win, R7), set inventory defaults for **newly created items** (R3),
   pin reports + dashboard widgets, and build the bilingual onboarding checklist.
   Applied state (template key, version, manifest hash, overrides) records on
   `tenant_industry_config`.
4. **Additive-only switching** (BR-038, fixed —
   [BUSINESS_RULES.md §7](../../product/BUSINESS_RULES.md)): switch/extend may add
   menus, defaults, terminology, policies, series, pins; may **never** delete tenant
   data, remove a tenant's explicit setting, change accounts/purposes, or renumber
   documents (§5 rules R1–R10 of
   [industries/README.md](../../industries/README.md)). The UI presents a "what will
   change" diff (added capabilities, renamed labels, new series, archived capabilities)
   before confirmation; the apply writes an audit event with the diff; archived
   capabilities become read-only/hidden, reversal documents still allowed (R6).
   `industry.template_switching` implements this; switching back is always possible
   because nothing was destroyed.
5. **Feature conflict/dependency rules** (BR-040): activation-time closure check against
   `depends on` edges from
   [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (POS closure, distribution
   closure, manufacturing closure, CRM billing closure, offline clients, template-vs-
   features graceful degradation with the "الميزة غير مفعّلة في خطتك" upgrade path,
   additive multi-template default resolution with conflict recorded in the applied
   manifest). Unsatisfiable activations are rejected with the specific missing chain.
6. **Terminology overrides (AR/EN)** — feature `industry.terminology`: per-template
   bilingual label sets layered over [GLOSSARY.md](../../GLOSSARY.md) keys
   (`terminology_overrides` in each manifest); presentation only — glossary meanings and
   data-model semantics never change; archived label sets retained read-only on switch
   (R2); tenant additions win over the template.
7. **Navigation manifest → nav registry**: the entitlement-driven navigation data model
   from [PHASE-005](PHASE-005.md)/[PHASE-004](PHASE-004.md) now renders from the applied
   template's `navigation_manifest` — groups/items with `feature_key`-gated visibility
   (item hidden when key unentitled), L9 derivation from the effective config, one
   active navigation per tenant, archived groups retained read-only on switch.
8. **Apply the three priority templates** with their exact manifest content:
   - `industry.retail` — required keys `industry.template_engine`, `items.barcodes`,
     `items.price_lists`, `inventory.multi_warehouse`, `inventory.stock_transfers`,
     `inventory.serial_tracking`, `pos.terminals`, `pos.sales`, `pos.offline_queue`,
     `pos.receipts`, `treasury.cashier_shifts`; selling/stock navigation groups;
     `cash_sales_autopost: true`; WAC, all tracking off, negative stock forbidden;
     series `INV/POS/CN/TRF`; pins `pos.sales_by_terminal`, `pos.sales_by_hour`,
     `retail.imei_register`, `inventory.stock_valuation`; POS entries phase-gated
     "coming with PHASE-016".
   - `industry.grocery` — adds `inventory.batch_tracking`, `inventory.stock_counts`,
     `pos.barcode_scanning`, `distribution.customer_tiers` (phase-gated to 017); batch +
     expiry on, FEFO on; expiry-control navigation (`inventory.expiry_list`,
     write-off register, counts); GRN expiry-capture and write-off-approval policies;
     pins `inventory.expiry_list`, `grocery.expiry_writeoff`, `pos.sales_by_hour`,
     `inventory.stock_valuation`.
   - `industry.restaurant` — adds `items.composite_products`, `pos.table_service`
     (phase-gated; intake key per
     [CAPABILITY_MATRIX §3](../../industries/capabilities/CAPABILITY_MATRIX.md));
     floor/daily-close navigation (tables, quick sale, kitchen tickets, shifts, Z
     close); `unpaid_table_holds_no_ledger`, `combo_explosion_at_posting`, service
     charge rate 0; series `RC/PO/GRN/ADJ`; pins `restaurant.sales_by_table`,
     `restaurant.order_type_mix`, `pos.sales_by_hour`,
     `treasury.shift_cash_reconciliation`, `inventory.expiry_list`.
9. **PHASE-015-assigned supporting features** (per
   [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) Phase column — required for
   template pins to resolve and to satisfy the no-orphan-keys rule):
   `items.composite_products` (composite definitions; explosion executes at POS/sale
   posting), `inventory.reservations` (reservation pool with expiry; consumed by
   approved orders/job cards later), `inventory.reorder_levels` (`stock.below_reorder`
   alerting, BR-019 — alert only, never auto-PO), `purchasing.landed_costs` **full
   workflow** (allocation by value/quantity on GRN per
   [INVENTORY_ACCOUNTING.md §3](../../accounting/INVENTORY_ACCOUNTING.md)), in-app
   notifications inbox (`platform.notifications` in-app leg,
   [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) `notifications`
   module), and the industry reports pinned by these templates whose data exists after
   PHASE-010/013: `inventory.expiry_list`, `grocery.expiry_writeoff`,
   `retail.imei_register` ([industries/reports/README.md](../../industries/reports/README.md)
   — PHASE-015 rows).
10. **UI surfaces**: template selection step inside the onboarding wizard
    (activity → template resolution + "included / optional / coming soon" capability
    screen), admin template management (apply/switch/extend with diff preview, version
    drift notifications for PATCH/MINOR upgrades), settings screens for template-set
    policy defaults within guardrails.
11. **Configuration audit events**: every apply/switch/extend/module-install/policy-
    change writes an audit event (actor, before/after diff, correlation id) through the
    `audit` module interceptor; template upgrade offers are recorded, never auto-applied.

Out of scope (explicit):

- The `pos` module itself — terminals, sale flow, offline queue (PHASE-016). The 015
  templates' POS-flavored entries ship **phase-gated** and degrade to back-office mode.
- The automotive, distribution, food-manufacturing, professional-services, and
  rental-logistics template applications (PHASE-017/018/019) — their manifests are NOT
  seeded into the registry yet.
- The generalized sync foundation, device registry, change feeds beyond the POS subset
  (PHASE-020).
- Plan/pricing definitions and checkout (PHASE-014 owns billing; `industry.addons` is
  only wired to entitlement resolution here).
- Jurisdiction-pack content (PHASE-009 owns L2 data; this phase only consumes packs).
- A template-authoring UX for brand-new industries (manifests are authored as versioned
  data + docs; adding an industry remains a product decision record).

## 3. Prerequisites

- **PHASE-014 COMPLETE** (MVP gate): entitlements service (`platform.entitlements`),
  plans/add-ons, onboarding wizard UX, dashboards — verified via its completion report +
  green CI + `IMPLEMENTATION_STATUS.md`. The engine's L3/L4/L8 inputs and the onboarding
  integration point all come from it.
- Earlier hard dependencies consumed as-is: PHASE-004 (tenant settings, branches,
  entitlement materialization, `industry_templates` seed stub), PHASE-005
  (navigation data model, i18n/RTL pipeline), PHASE-007 (policy keys, approval
  policies, cost centers), PHASE-009 (jurisdiction packs, L2), PHASE-010 (batch/expiry/
  serial/IMEI data for the pinned reports), PHASE-013 (report contract + print/export
  engine that industry reports register against).
- Required architecture decisions:
  [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (L2 pack values
  read-only to tenants; pack precedence over template defaults),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (numbering immutability —
  switching rule R5), [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md)
  (pg-boss for event/invalidation and upgrade-offer jobs).
- Relevant documentation:
  [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) (the engine this
  phase implements), [industries/README.md](../../industries/README.md) (manifest
  schema §3, apply flow §4, switching rules §5, testing §8),
  [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md)
  (capability ids + §3 intake set),
  [INDUSTRY_CATALOG.md](../../product/INDUSTRY_CATALOG.md),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-037…BR-040),
  [SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
  (add-on bundles), [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-022), [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  (§3.8 configuration permissions).

## 4. Design Impact

- **Database changes:** `industry_templates` (004 seed stub → full engine-owned registry:
  key, name, name_ar, manifest jsonb, version, status), `tenant_industry_config`
  (template_key, applied_version, applied_manifest_hash, applied_at, overrides jsonb,
  archived label/navigation history), `feature_flags` (L8 rollout flags — platform
  delivery only, never tenant policy). New tables for the in-app notifications leg
  (`notifications`, `notification_preferences` — listed in
  [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) but absent from
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md); this phase adds the catalog
  entries per the sync rule). Reorder alerts and reservation pool reuse existing
  inventory tables (`item_warehouse_settings`, new reservation rows). All new/changed
  tables enter ENTITY_CATALOG in the same phase; RLS via the PHASE-002 macro.
- **API changes:** `GET /api/v1/configuration/effective-config` (request-scoped, includes
  L6 overlay + L9 derivation); `POST /api/v1/configuration/templates/{id}/apply`,
  `/switch`, `/extend` (diff preview via `POST …/preview`); template registry read
  endpoints; onboarding wizard integration (activity→template resolution); entitlement
  closure-check endpoint consumed by checkout (PHASE-014 surface). Contracts in
  `packages/contracts` with zod schemas mirroring the manifest JSON Schema.
- **UI changes:** onboarding wizard gains the industry step (template cards AR/EN with
  capability preview); admin "Industry & templates" screens (apply/switch with
  what-will-change diff, upgrade offers); app-shell navigation renders from the nav
  registry; terminology resolution through the i18n pipeline (PHASE-005); settings
  screens show template-default badges vs tenant-explicit values.
- **Security & authorization:** `configuration.templates.apply` (risky, audited —
  [AUTHORIZATION_MATRIX §3.8](../../security/AUTHORIZATION_MATRIX.md)) and the
  feature-implied keys `industry.templates.manage` / `industry.templates.switch` /
  `industry.terminology.manage` from
  [FEATURE_CATALOG §18](../../product/FEATURE_CATALOG.md) — the phase must reconcile
  the two namespaces into the seeded `permissions` table (AUTHORIZATION_MATRIX §9.2
  protocol) and add role-template grants. BR-037/BR-039 enforcement tests extend the
  attack-test list: no route may act on an unentitled feature even with a crafted
  request; UI visibility is derived-only.
- **Accounting implications:** configuration selects — never overrides (INV-022):
  policy defaults (`sales.cash_autopost`, `sales.return_window_days`,
  `inventory.fefo_for_expiry_items`, numbering `assign_at`) land as L1 defaults that L5
  may override; no posting rule changes. The config-fuzz suite (INV-022 coverage)
  extends to template apply/switch inputs: adversarial manifests, layer combinations,
  and switch-time policy churn must never alter accounting mathematics or authorization.
- **Localization implications:** every terminology override is bilingual AR/EN with
  Arabic-first display; glossary keys are the namespace; RTL rendering rules from
  [RTL_AND_LTR.md](../../localization/RTL_AND_LTR.md) apply to all new screens; the
  golden fixtures snapshot AR + EN.
- **Offline implications:** configuration writes are ONLINE-ONLY
  ([OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md) row
  #36); effective-config reads may be cached for display only; entitlement snapshots
  for offline devices are read-only caches revalidated at sync (BR-039) — groundwork
  only, no sync implementation in this phase.
- **Module dependencies:** `configuration` (owns the engine, registry, application
  service) consumed by `tenancy` (settings/entitlements feed), `identity` (L6), `items`
  (composites), `inventory` (reservations, reorder alerts), `purchasing` (landed costs),
  `reporting` (report registry entries), `notifications` (reorder/upgrade-offer events),
  `audit` (events). Direction: all feature modules stay independent of `configuration`
  internals; they read the effective config through its published service only
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md),
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md)).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Resolution engine core: ten-layer merge, precedence table, schema validation, fail-closed errors, content-hash + tenant-static cache | `apps/api/src/modules/configuration/{api,application,domain,infrastructure}/**` | unit + property tests: determinism (same inputs ⇒ same hash), precedence, unknown-key rejection, fail-closed on broken layer |
| T2 | Invalidation events wiring (in-process + pg-boss) per CONFIGURATION_ENGINE §9; L6 overlay never cached | `apps/api/src/modules/configuration/infrastructure/*`, event bus | unit tests: each event invalidates exactly its scope; hash mismatch forces re-resolution |
| T3 | Manifest schema package: JSON Schema (industries/README §3) as zod contracts + CI validation script for all registry manifests | `packages/contracts/src/industry/**`, `scripts/validate-manifests.ts` | CI green on the 3 manifests; negative fixtures (bad enum, orphan module, non-const negative stock) fail |
| T4 | Template registry + seeds: `industry.retail`/`industry.grocery`/`industry.restaurant` v1.0.0 manifests as migrations; versioning + drift-detection job | `apps/api/src/modules/configuration/infrastructure/seeds/**`, migration `NNNN_industry_registry.sql` | migration tests; registry read API contract tests |
| T5 | Apply service: activity→template resolution, entitlement + phase-gate check, idempotent audited apply (modules, navigation, terminology, numbering w/ pack precedence, inventory defaults for new items, report pins, onboarding checklist) | `apps/api/src/modules/configuration/application/apply/**` | integration tests: golden onboarding fixture per template (nav tree, terminology, series, defaults, pins, checklist — AR + EN); re-apply idempotent |
| T6 | Additive-only switching (BR-038): preview-diff service, switch/extend transactions, archived capabilities (R6), conflict recording for multi-template defaults | `apps/api/src/modules/configuration/application/switch/**` | switch safety test: apply A → create items/post docs → switch B → zero data loss, explicit settings intact, series append-only, archives read-only |
| T7 | Dependency/conflict closure (BR-040) + graceful degradation paths + upgrade-offer notifications | `apps/api/src/modules/configuration/application/closure/**` | `dependency-closure.spec`: unsatisfiable activations rejected with the missing chain; degraded-entitlement test (missing OPTIONAL hides cleanly; missing REQUIRED blocks with guidance; phase-gated renders "coming with PHASE-016") |
| T8 | Terminology + navigation runtime: glossary layering, nav registry rendering, L9 derivation | `apps/api/src/modules/configuration/application/ui/**`, web nav container | unit tests on label resolution precedence (tenant addition > template > glossary); nav visibility prunes by L4/L8/L6 |
| T9 | Supporting features: `items.composite_products` (definition + explosion contract), `inventory.reservations`, `inventory.reorder_levels` + `stock.below_reorder`, `purchasing.landed_costs` full workflow | `apps/api/src/modules/{items,inventory,purchasing}/**` | unit/integration per feature; landed-cost golden posting tests per INVENTORY_ACCOUNTING §3; reservation expiry job test; alert-only rule (BR-019) test |
| T10 | In-app notifications inbox (notifications module) + report registry entries: `inventory.expiry_list`, `grocery.expiry_writeoff`, `retail.imei_register` | `apps/api/src/modules/{notifications,reporting}/**` | report contract tests + fixtures asserting totals tie to journal lines where applicable |
| T11 | UI: onboarding industry step, admin template management, diff preview, upgrade offers, settings badges | `apps/web/src/features/{onboarding,admin-templates,settings}/**` | component tests AR/EN + axe; visual snapshots of industry home + admin screens (both directions) |
| T12 | Audit events + entitlement/permission reconciliation (seeds for new permission keys, role-template grants) | `apps/api/src/modules/{configuration,identity}/**`, seed migration | attack tests: unentitled feature route ⇒ 403/404; audit events present for apply/switch; permission matrix tests green |
| T13 | Docs updates: CONFIGURATION_ENGINE status, ENTITY_CATALOG/TABLES/ERD additions, INDUSTRY_CATALOG pointers, FEATURE_CATALOG phase cross-check | `docs/**` | docs validation script green (links, headings, catalog drift check) |

## 6. Verification

**Automated tests (required):**

- `config-resolution.spec` — property tests (fast-check) on determinism: randomized
  layer combinations resolve identically across runs with a stable content hash;
  precedence-table unit tests per value class; L2-only rows (tax) reject tenant-layer
  writes; fail-closed on a corrupted/missing layer (typed configuration error, no
  partially-defaulted config ever reaches a module).
- `config-fuzz.spec` (INV-022): generated adversarial configurations (including applies/
  switches mid-flight) drive posting attempts — no invariant or authorization bypass via
  any layer combination; `inventory.allow_negative_stock` flips policy but never math.
- `industry-manifests.spec` (CI): all three manifests validate against the §3 schema;
  negative fixtures rejected; `required_feature_keys` resolve in
  FEATURE_CATALOG **or** the declared intake set
  ([CAPABILITY_MATRIX §3](../../industries/capabilities/CAPABILITY_MATRIX.md) —
  `pos.table_service` etc. resolve as phase-gated until PHASE-016 intake).
- `template-apply.spec` — golden onboarding fixtures per template: snapshot-assert
  navigation tree, terminology resolution, numbering series (pack-mandated formats win),
  inventory defaults, report pins, and the bilingual onboarding checklist; idempotent
  re-apply; apply on a seeded tenant with existing data changes **nothing** existing.
- `template-switch.spec` — switch safety (README §8 #5): template A → items + posted
  documents → switch/extend to B → assert zero data loss, archived capabilities
  read-only, explicit tenant settings untouched, numbering append-only (posted numbers
  immutable), all invariants hold.
- `degraded-entitlement.spec` (README §8 #7): plan missing an OPTIONAL key hides cleanly;
  missing REQUIRED blocks onboarding with actionable guidance; phase-gated keys render
  "coming with PHASE-016" and the tenant trades immediately in back-office mode.
- `dependency-closure.spec` (BR-040) — representative edges from CONFIGURATION_ENGINE §7.
- Golden effective-configs: one pinned, hashed effective config per shipped template ×
  plan × jurisdiction example; hash changes fail CI unless reviewed.
- Feature tests for T9/T10: landed-cost golden postings, composite explosion contract,
  reservation pool behavior, reorder alert (notification created; **no** PO created),
  report fixtures tying `grocery.expiry_writeoff` totals to shrinkage journal lines.
- Visual regression (AR + EN) for the industry home, onboarding industry step, and admin
  template screens (README §8 #6).

**Manual verification:**

1. Onboard a fresh tenant declaring "supermarket" activity → workspace opens with
   Arabic-first grocery terminology, expiry-control menus, FEFO defaults, pinned expiry
   dashboard; POS entries visibly labeled "قادم مع المرحلة 016" (coming with PHASE-016).
2. From admin, switch `industry.retail` → `industry.grocery` on a tenant with posted
   invoices: the diff preview matches the applied change; previous terminology archives;
   posted documents and numbers unchanged; switch back succeeds.
3. Downgrade the tenant's plan (remove an OPTIONAL key) → corresponding menus hide with
   the upgrade path message; remove a REQUIRED key → apply/switch blocked with the
   missing chain named.
4. Inspect the audit trail: apply/switch events carry the full before/after diff.

**Acceptance criteria (objective):** *(to be mirrored into
`PHASE_ACCEPTANCE_CRITERIA.md` rows 015 when that planning file is created — see worklog
note: the file is referenced by the roadmap but does not yet exist.)*

1. `resolveEffectiveConfig` implements all ten layers with the documented precedence;
  identical inputs produce identical `resolved_hash` (property test, CI-green).
2. Every invalidating event in CONFIGURATION_ENGINE §9 has a green test proving the
  correct cache scope is dropped and no stale-but-wrong data can be served.
3. All three template manifests pass schema validation in CI and apply idempotently to
   fresh tenants with byte-stable golden fixtures (AR + EN).
4. Template switching is additive-only: the switch-safety test proves zero data loss,
   archived read-only capabilities, intact explicit settings, and append-only numbering
   (BR-038; INV-021).
5. A REQUIRED capability missing from the plan blocks apply with guidance; a missing
   OPTIONAL capability degrades to hidden; phase-gated entries render "coming with
   PHASE-016" (no broken screens).
6. The config-fuzz suite proves no INV-xxx invariant or authorization check is
   bypassable through any layer combination or template apply/switch (INV-022; BR-037).
7. Features `items.composite_products`, `inventory.reservations`,
   `inventory.reorder_levels`, `purchasing.landed_costs` (full workflow),
   in-app notifications, and reports `inventory.expiry_list`, `grocery.expiry_writeoff`,
   `retail.imei_register` ship with green tests and exist in
   FEATURE_CATALOG + the report registry (no orphan keys).
8. Every new route carries its permission key; unentitled access is denied server-side
   (matrix tests); UI visibility is derived only (BR-039).
9. ENTITY_CATALOG/TABLES/ERD, CONFIGURATION_ENGINE, INDUSTRY_CATALOG, and the permission
   seeds are updated in the same phase; docs validation is green.

**Performance & security considerations:** effective-config resolution p95 ≤ 50 ms warm
(cache hit) and ≤ 400 ms cold for a 10-branch tenant; apply transaction ≤ 5 s for the
golden fixtures. Manifest jsonb is read-only to `erp_app` except via the configuration
service; template apply is owner-permission-gated and audited; no tenant-supplied JSON
is ever trusted without schema validation (fail closed).

**Migration & rollback:** migrations add registry/config/notification tables and seeds —
all additive. Rollback = revert commits + drop the new tables (dev only); applied
templates on live tenants are data rows, not schema — a reverted engine leaves tenants
on their L5 defaults (MVP posture) with templates archived read-only; no posting history
is ever touched by rollback.

## 7. Risks and Constraints

- **RISK-002** (templates feel generic): mitigated by terminology/navigation/report packs
  shipping with real content in this phase and design-partner validation at rollout.
- **RISK-016** (boundary erosion): the engine must not become a god-module — modules
  read the published service only; dependency-cruiser rules extended to `configuration`.
- **RISK-020** (docs drift): manifest schema lives in docs AND contracts; CI validates
  both directions (schema-catalog drift hook from PHASE-002).
- **RISK-019** (agents implement beyond phase): the phase-gated POS entries are
  configuration only — implementing POS behavior here is a review blocker.
- Cache-staleness risk (invalidation lag serving stale config): mitigated by content-hash
  keys — a hash mismatch forces re-resolution; tested in T2.
- Multi-template default conflicts: recorded in the applied manifest and surfaced in the
  diff; most-recently-applied wins for unset keys only (CONFIGURATION_ENGINE §7).
- Constraints: no new layers (the ten-layer model is fixed — adding one requires an ADR);
  no template may grant entitlements by itself; `industry.rental_logistics` and the other
  five templates are not seeded yet.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-015-COMPLETION.md` with: property/fuzz test
  outputs (determinism + INV-022), golden fixture hashes per template, switch-safety and
  degraded-entitlement outputs, audit-event samples, permission matrix results, docs
  validation output, screenshots of onboarding/admin screens as secondary evidence.
- **Documentation updates required:** IMPLEMENTATION_STATUS (PHASE-015 → COMPLETE),
  CURRENT_STATE, CHANGELOG, ENTITY_CATALOG + TABLES/ERD (registry/config/notification
  tables), CONFIGURATION_ENGINE (engine status: completed), INDUSTRY_CATALOG (shipped
  templates), FEATURE_CATALOG (confirm Phase column for shipped keys), permission seeds
  reconciliation note (AUTHORIZATION_MATRIX §9.2).
- **Exit criteria:** all acceptance criteria green with evidence; the three templates
  apply cleanly on fresh tenants; switching is proven safe; config-fuzz green; docs
  synchronized; zero TODOs in delivered scope.
- **Definition of Done:** engine + registry + 3 templates + supporting features + UI +
  audit + tests merged on `main`; CI green including manifest validation and
  effective-config golden hashes; status files updated.
- **Handoff instructions:** the next agent reads this completion report, then the POS
  template notes: the phase-gated entries (`pos.*`, `pos.table_service`) resolve as
  "coming with PHASE-016" and the intake keys
  (`pos.table_service`, `pos.kitchen_display`) must be registered into FEATURE_CATALOG at
  the start of PHASE-016 via the §5 maintenance protocol.
  **Next eligible phase: PHASE-016 — Point of Sale** (identify only; do not implement).
