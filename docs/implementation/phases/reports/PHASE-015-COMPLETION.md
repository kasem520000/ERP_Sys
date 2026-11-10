# Completion Report — PHASE-015 — Industry Configuration Framework & Priority Templates

> **Status:** COMPLETE · **Updated:** 2026-11-02

| Field | Content |
|-------|---------|
| **Phase ID / Date** | PHASE-015 · 2026-11-02 |
| **Summary** | "Configuration without chaos" is real. The `configuration` module ships the full ten-layer resolution engine — `resolveEffectiveConfig(tenantId)` merging L1 industry template → L2 jurisdiction pack → L3 plan → L4 entitlements → L5 tenant settings → L7 branch settings → L8 installed modules → L10 workflow/policy config per the CONFIGURATION_ENGINE §3 precedence table, with deterministic content-hash caching (property-proven: identical inputs ⇒ identical `resolved_hash`), event-driven invalidation for every §9 event (incl. the L6 events that drop the request overlay only), and fail-closed validation (unknown keys/type violations are typed errors — a partially-resolved config can never reach a module). On top of it: the platform-owned template registry (`industry_templates` with the three v1.0.0 manifests `industry.retail` / `industry.grocery` / `industry.restaurant` seeded byte-exact and CI-validated against the §3 manifest schema), the idempotent audited apply service (activity→template resolution, entitlement + phase-gate classification with "coming with PHASE-016" labels, numbering series append-only with pack precedence note R7, report pins, bilingual onboarding checklist), additive-only switching (BR-038 — preview diff before confirmation, archives never deletes, switch-back always succeeds, conflicts recorded), BR-040 dependency-closure rejection with the missing chain, registry drift upgrade-offers (recorded, never auto-applied), the terminology + navigation runtime (tenant addition > template > glossary; nav pruned by entitlements with phase-gated items labeled, empty groups dropped), the PHASE-015 supporting features (`items.composite_products` with explosion executing at sale posting — component issues at WAC, revenue on the composite line, zero stock moves for the composite SKU; `inventory.reservations` entitlement surface + pg-boss expiry sweep — the platform's first cron schedule; `inventory.reorder_levels` in-app `stock.below_reorder` leg + replenishment list, alert-only BR-019; `purchasing.landed_costs` full workflow incl. cumulative multi-document allocation + preview), the notifications generalization (`stock` + `templates` categories), the three PHASE-015 industry reports over the shared contract (`inventory.expiry_list` with INV-010 tie, `grocery.expiry_writeoff` with the exact shrinkage GL tie-out, `retail.imei_register` with GRN/sale/return linkage), the onboarding wizard's industry step (activity → template cards → capability preview: included / optional / coming soon), the admin "Industry & templates" screens (apply/switch/extend with the what-will-change diff + upgrade offers + policy defaults with honest source badges), template-derived navigation + terminology in the app shell, and the three reconciled permission keys (`industry.templates.manage` / `.switch` / `industry.terminology.manage`, matrix 227=227). All 18 local gate steps green (incl. the new manifest-validation step); db suite 78 files / 1214 tests green. |
| **Invariants covered** | INV-022 (the config-fuzz discipline: template apply/switch mid-flight never alters posting math — the sales/accounting golden suites re-ran green inside the phase suite; policy values select, never override), INV-010 (expiry-list value ties to the inventory GL — `industry.spec.ts`), INV-012 discipline (write-off register shows its GL tie-out explicitly), INV-021 (numbering append-only across template switches — `template-switch.spec.ts` R5), INV-001/002 (composite-explosion golden posts balanced journals — `composites-golden.spec.ts`), plus the full INV-001…022 release suite re-run green (1214 tests). |

## Acceptance criteria verification (phase §6 — every row linked to evidence)

- [x] **1. `resolveEffectiveConfig` implements all ten layers with the documented precedence;
      identical inputs produce identical `resolved_hash`** —
      `apps/api/src/modules/configuration/__tests__/config-resolution.spec.ts` (47 tests:
      fast-check determinism property over randomized layer combinations, precedence-table
      unit tests per value class, L2-only tax enforcement, unknown-key rejection,
      fail-closed on corrupted/missing layers) +
      `golden-effective-configs.spec.ts` (14 tests: pinned hashes per template × plan ×
      jurisdiction fixture — retail `sha256:ac0a93…`, grocery `sha256:c6ef7c…`,
      restaurant `sha256:e187c9…`, cross-plan variance asserted; hash changes fail CI).
- [x] **2. Every §9 invalidating event has a green test proving the correct cache scope
      drops** — `config-events` extension + `config-resolution.spec.ts` invalidation
      block: tenant-static events (`tenant.updated`, `template.applied`/`switched`,
      `pack.upgraded`, `plan.changed`, `entitlements.changed`, `settings.changed`,
      `branch.updated`, `module.installed`/`deactivated`, `policy.changed`) drop the
      tenant-static cache; L6 events (`role.updated`, `membership.updated`) drop ONLY the
      request overlay; the content-hash fingerprint mismatch forces re-resolution.
- [x] **3. All three manifests pass schema validation in CI and apply idempotently with
      byte-stable golden fixtures (AR + EN)** — `pnpm validate:manifests` (gate step 6;
      `scripts/validate-manifests.ts` + `packages/contracts/src/__tests__/industry-manifests.test.ts`
      — 30 tests incl. 12 negative fixtures) + `template-apply.spec.ts` (6 tests: golden
      onboarding fixture per template — nav tree, terminology, series, defaults, pins,
      checklist; re-apply idempotent; apply on a tenant with existing data changes
      nothing existing).
- [x] **4. Switching is additive-only: zero data loss, archived read-only capabilities,
      intact explicit settings, append-only numbering (BR-038; INV-021)** —
      `template-switch.spec.ts` (8 tests: retail → items + posted documents → grocery →
      zero data loss, explicit tenant setting untouched, posted numbers immutable + new
      series appended, previous terminology archived read-only, archived capabilities
      listed, switch back succeeds, journal balance holds).
- [x] **5. REQUIRED-missing blocks apply with guidance; OPTIONAL-missing degrades to
      hidden; phase-gated renders "coming with PHASE-016"** —
      `degraded-entitlement.spec.ts` (3 tests) + `prerequisites.ts` classification unit
      tests; the back-office mode is proven by the apply-then-post-back-office-invoice
      case.
- [x] **6. The config-fuzz discipline proves no INV-xxx invariant or authorization check
      is bypassable through any layer combination or apply/switch (INV-022; BR-037)** —
      the full release suite (78 files / 1214 tests) re-ran green with the template
      apply/switch flows exercised mid-suite (the sales/accounting/inventory golden packs
      + the RLS attack suites + the route × role permission checklist cover every
      registered route incl. the 9 new configuration routes); policy keys select policy,
      never math (`inventory.allow_negative_stock` flips policy — the INV-022 property
      suites from PHASE-010/014 stay green).
- [x] **7. Supporting features + reports ship green with no orphan keys** —
      `composites.spec.ts` (19) + `composites-golden.spec.ts` (4: explosion at posting,
      COGS = Σ component issues, no composite-SKU stock move, balanced journals),
      `reservation-sweep.spec.ts` (5 unit + 3 db: only past-due ACTIVE rows expire;
      pg-boss cron registered — the platform's first schedule, ADR-0008),
      `reorder-inapp.db.spec.ts` (4: in-app row with 24 h dedupe, email still sent,
      **no PO created** — BR-019, replenishment list), landed-costs cumulative
      multi-document + preview cases (extended `landed-costs.spec.ts`),
      `reporting/industry.spec.ts` (8: expiry buckets + INV-010 tie, write-off register
      tying EXACTLY to the shrinkage GL per reason, IMEI in/out ledger with linkage,
      registry integration); FEATURE_CATALOG + REPORT_CATALOG rows reconciled.
- [x] **8. Every new route carries its permission key; unentitled access denied
      server-side; UI visibility derived only (BR-039)** — 9 route-permission rows in
      `route-permissions.ts` (5 POST → `configuration.templates.apply`, 4 session GETs);
      the route × role permission checklist + RLS spoof suites green; the web renders
      only server-derived payloads.
- [x] **9. ENTITY_CATALOG/TABLES, CONFIGURATION_ENGINE, INDUSTRY_CATALOG, permission
      seeds updated in-phase; docs validation green** — 13 docs files updated (see
      §Documentation updated); `pnpm docs:validate` 29/29, `pnpm check:permissions-drift`
      227=227, `pnpm check:rls` 156 tables.

## Files created (selected)

| Area | Files |
|------|-------|
| Contracts | `packages/contracts/src/industry/{manifest.ts (543 L), templates.ts (773 L), index.ts}`, `__tests__/industry-manifests.test.ts` (30 tests), `scripts/validate-manifests.ts` |
| Engine | `apps/api/src/modules/configuration/domain/{layer-model,precedence,policy-registry,effective-config,hashing}.ts`, `application/resolve/{resolve-service,cache,compose,derivation,terminology}.ts`, `infrastructure/config-repository.ts` |
| Apply/switch/closure | `application/apply/{activity-mapping,prerequisites,apply-service,applied-state.store}.ts`, `application/switch/switch-service.ts`, `application/closure/drift-service.ts` |
| API | `apps/api/src/modules/configuration/presentation/configuration.controller.ts` (8 routes) |
| Supporting features | `items/application/composite-service.ts`, `inventory/application/industry-queries.ts`, `infra/jobs/system-tenants.ts` (cross-tenant job enumeration), `reporting/registry/industry/industry.ts` (3 contracts) |
| Migrations | `0022_industry_configuration.sql` (tenant_industry_config, feature_flags, item_components, registry status + 3 manifest seeds, permission keys), `0023_notifications_categories.sql` |
| Web | `components/onboarding/industry-step.tsx`, `components/templates-admin.tsx` (988 L), `app/[locale]/settings/templates/page.tsx`, `lib/effective-config.ts` |
| Tests | `src/__db__/configuration/{engine,template-apply,template-switch,degraded-entitlement,dependency-closure}.spec.ts`, `src/__db__/sales/composites-golden.spec.ts`, `src/__db__/inventory/{reorder-inapp.db,reservations-sweep}.spec.ts`, `src/__db__/reporting/industry.spec.ts` |

## Database migrations

- **`0022_industry_configuration.sql`** — `tenant_industry_config` (tenant-owned RLS,
  UNIQUE tenant_id: template_key, applied_version, applied_manifest_hash, applied_at/by,
  status, overrides `{report_pins, onboarding_checklist, enabled_modules}`,
  archived_terminology/archived_navigation/archived_capabilities, conflict_notes),
  `feature_flags` (L8 platform rollout flags — global reference, app read-only, seeded
  empty), `item_components` (composite definitions, RLS, CHECKs qty>0 +
  composite≠component), `industry_templates.status` (ACTIVE/DRAFT/RETIRED), the three
  v1.0.0 manifests seeded byte-exact (upsert), permission keys (owner auto-grant via the
  0005 CROSS JOIN). Schema-version 22.
- **`0023_notifications_categories.sql`** — widens the `notifications` +
  `notification_prefs` category CHECK domains with `stock` + `templates`. Purely
  additive. Schema-version 23.

## API changes

`@Controller("api/v1/configuration")`: `GET /effective-config` (request-scoped: layers +
policies + ui + request_overlay), `GET /templates`, `GET /templates/:key` (manifest +
entitlement-resolved capability preview), `GET /templates/activity-map`,
`POST /templates/:key/apply`, `POST /templates/:key/preview` (R9 diff),
`POST /templates/:key/switch`, `POST /templates/:key/extend`,
`POST /templates/drift-check`. Supporting-feature routes: composite components
(GET/PUT `items/:id/components`, feature-gated), below-reorder list, landed-cost preview.

## UI changes

Onboarding wizard: new first step `industry → fiscal → result(+apply outcome) → item →
customer → invoice → print`; template cards AR/EN with the §4 capability preview
(included / optional / coming soon «قادم مع المرحلة 016»), honest skip-forever, blocked
applies render the typed AR/EN guidance + missing chain without stopping onboarding.
Admin `settings/templates`: applied-template card, registry with permission-gated
apply/preview/switch/extend, the what-will-change dialog (added capabilities split
included/phase-gated/optional, renamed labels old→new, new series, archived R6,
inventory defaults marked "new items only" R3, pin changes) with the acknowledgement
checkbox, drift offers (never auto-applied), policy-defaults table with honest source
badges (template-default where provable; no fabricated per-key sources). App shell:
template-derived navigation groups render after core groups, terminology applies to all
labels, phase-gated items carry the coming-phase suffix; degrade paths keep the core
shell on any failure. i18n parity 1829 = 1829 keys (AR = EN).

## Actual test results

| Suite | Result |
|-------|--------|
| contracts (incl. 30 new manifest tests) | 41/41 |
| api unit (incl. config-resolution 47, golden-effective-configs 14, composites 19, reservation-sweep 5) | 257/257 |
| **db suite (embedded PG16, full chain 0001–0023)** | **78 files / 1214 tests — 0 failures** (PHASE-014: 69/1153; +9 files / +61 tests) |
| web | typecheck + lint + i18n parity + build (134 routes) green |
| permissions drift | matrix 227 = seed 227 |
| check:rls | 156 catalog tables |
| docs:validate | 29/29 |
| validate:manifests | 3/3 (hashes: retail `sha256:ac0a9334…`, grocery `sha256:c6ef7c8a…`, restaurant `sha256:e187c903…`) |

The full 18-step local-gate transcript is archived at
[agent-ctx/T22-gate-evidence-PHASE-015.md](../../../../agent-ctx/T22-gate-evidence-PHASE-015.md).

## Known limitations (honest record)

- The R7 pack-mandate precedence over template numbering formats is enforced at
  series-use time (the numbering service reads the pack), not at apply time — no
  jurisdiction pack in the current seeds mandates a numbering format, so no programmatic
  mandate surface exists yet; recorded in `apply-service.ts` and the worklog.
- `applied_at` is not exposed by any read route (the admin card shows version + hash;
  the gap is noted in the UI honestly rather than fabricated).
- The policy-defaults view badges sources only where provable (unmapped
  `workflow_policies` keys = template; provable numbering contradictions = tenant);
  `GET /tenancy/settings` returns the effective merged snapshot, so a full per-key
  source map is not honestly derivable from the current payloads.
- The frozen `@erp/ui` sidebar primitive has no disabled/badge item variant — phase-gated
  nav items carry the «قادم مع المرحلة 016» suffix inline in the label; flagged for the
  next UI-owning phase.
- POS entries are phase-gated configuration only (RISK-019 respected): `pos.*` behavior
  ships with PHASE-016; the templates trade in back-office mode immediately.
- The standing hosted-infra obligations (GitHub CI run, hosted k6, staging restore)
  carry over unchanged from NEXT_ACTION §Follow-up obligations.

## Documentation updated

`CONFIGURATION_ENGINE.md` (status: IMPLEMENTED PHASE-015), `INDUSTRY_CATALOG.md`
(shipped templates), `FEATURE_CATALOG.md` (landed_costs 011/015, notifications in-app,
industry.addons scope), `AUTHORIZATION_MATRIX.md` §3.8 (3 keys + industry module),
`ENTITY_CATALOG.md` (item_components + rewritten industry section + widened
notification categories), `REPORT_CATALOG.md` (3 industry rows + §13 matrix),
`industries/README.md` §8 (machine-enforcement note), `IMPLEMENTATION_STATUS.md`
(PHASE-015 COMPLETE), `CURRENT_STATE.md`, `CHANGELOG.md`, `NEXT_ACTION.md` (rewritten →
PHASE-016), `PHASE-015.md` (status header), PHASE-014 completion report (one pre-existing
broken link fixed to unblock docs:validate).

## Rollback instructions

Migrations 0022/0023 are additive (new tables + widened CHECKs + seed upserts). Rollback
= revert commits + drop the new tables (dev only); applied templates are data rows — a
reverted engine leaves tenants on their L5 defaults (MVP posture) with the applied rows
archived read-only. No posting history is touched by anything in this phase (INV-022).

## Next eligible phase

**PHASE-016 — Point of Sale** (identify only; do not implement). The phase-gated entries
(`pos.*`) flip live and the intake keys (`pos.table_service`, `pos.kitchen_display`)
must be registered into FEATURE_CATALOG at PHASE-016 start via the §5 maintenance
protocol — recorded in NEXT_ACTION.md.
