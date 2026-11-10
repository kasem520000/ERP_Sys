# ADR-0019 — Custom Fields: Typed Value Store + Code-Owned Entity Registry

> **Status:** ACCEPTED · **Date:** 2026-11-10 · **Supersedes:** none · **Origin:** Blueprint v3.0 completeness — [../../planning/COMPLETENESS_REGISTER.md](../../planning/COMPLETENESS_REGISTER.md) CR-06 (canonical spec: [../../implementation/phases/PHASE-036.md](../../implementation/phases/PHASE-036.md)); closes the audit's FD-18/FD-19/FD-20 gap — the verdict called custom fields "not a missing feature but a missing business model"

## Context

The completeness audit's single most important functional gap is FD-18, custom fields/UDF:
every competitor it named (Odoo, NetSuite, Dynamics, SAP B1) lets a customer add a field
without a developer, while this platform answers each "add the municipality license number
to the customer card" request with a code change, a migration, and a deploy. The phase ships
before the module waves by hard ordering (roadmap §5): every phase from 042 onward must
surface custom fields on its new entities, so the substrate those phases plug into is
decided here ([../../planning/COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md)
§5/§6.3).

Three design questions have to be answered at once, because they determine what a 042+
phase pays to join:

1. **How are values stored?** A jsonb blob per entity (a `custom_fields` column or one
   value row holding a jsonb document) is one write path but untyped at the database: no
   per-type WHERE, no per-type index, and every reader re-implements type checking.
2. **Which entities carry fields?** A DB-level CHECK on `entity_type` pins the list in
   schema — every later entity becomes a migration, exactly the cost the phase exists to
   remove. The same list must also feed the form-layout designer (FD-19): the designer
   needs to know each entity's native fields and which of them are mandatory.
3. **How do values attach to entities owned by other modules?** `custom_field_values`
   rows point at partners, items, sales invoices, purchase orders, employees, projects —
   six tables owned by six modules ([../MODULE_BOUNDARIES.md](../MODULE_BOUNDARIES.md)) —
   while the value store itself must have exactly one owner.

The constraints are the platform's standing ones: tenant isolation by RLS on every new
tenant table, no configuration may alter posting rules or authorization (INV-022 — a UDF
value never posts), and no unjustified complexity: DF-39 asks for a plugin substrate, and
the marketplace itself (DF-38) is a recorded non-goal.

## Decision

1. **A typed value store.** `custom_field_values` stores one row per (entity, field) with
   five typed columns — `value_text`, `value_number numeric(19,6)`, `value_date`,
   `value_boolean`, `value_json` — pinned by the row-level law
   `num_nonnulls(value_text, value_number, value_date, value_boolean, value_json) = 1`.
   The definition's `data_type` selects the column (see
   [../../database/DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §15: TEXT /
   SELECT / REFERENCE → `value_text`, NUMBER → `value_number`, DATE → `value_date`,
   BOOLEAN → `value_boolean`, MULTISELECT → `value_json`). Typed columns over a jsonb
   blob: **queryable** (`WHERE value_number BETWEEN …` works), **indexable** (per-type
   indexes plus `(tenant_id, entity_type, entity_id)` and `(tenant_id, field_id)`), and
   **type-safe** (the CHECK is the floor; the guard is the enforcement — BR-057).
2. **A code-owned entity registry.** `CUSTOM_FIELD_ENTITIES` in
   `apps/api/src/modules/configuration/domain/custom-fields-schema.ts` is the single list
   of entities that can carry custom fields. Each descriptor carries the `entityType`
   string (deliberately following the sync `PULLED_ENTITY_TYPES` naming — `partners`,
   `items`, `sales_invoices`, `purchase_orders`, `employees`, `projects` — so values ride
   the feeds' entity vocabulary unchanged), the physical table (REFERENCE existence
   checks + the orphan-sweep job), bilingual labels, and `nativeFields` (the designer's
   placeable fields; the same keys are the BR-058 native-column blocklist, and
   `mandatory: true` rows are the BR-059-protected canonical order). The migration 0049
   tables carry **no DB-level entity CHECK** (a syntax floor only), so a later phase adds
   an entity with **zero migrations**.
3. **Polymorphic `(entity_type, entity_id)` with no DB FK — by design.** One value table
   cannot FK six owners; nullable per-entity FK columns or per-entity value tables
   multiply the surface instead. The registry validates every write (unknown
   `entityType` fails typed), REFERENCE values resolve against the registry's physical
   table, and an orphan-sweep integrity job reconciles drift; a tamper spec proves
   guard-bypass attempts fail typed.
4. **One reusable per-entity value guard, published as the configuration module's `api/`
   surface.** `validateValues` → `persistValues` → `attachValues`/`mergeValuesInto` (plus
   `readValues`) is the mechanism every module reuses: the guard **validates BEFORE the
   entity insert — zero partial writes** (a bad field never strands a created partner);
   writes are **full-replace** (absent keys clear their rows — the reason
   `custom_field_values` alone carries a DELETE grant); failures are the typed 400 family
   `CUSTOM_FIELD_UNKNOWN_KEY` / `CUSTOM_FIELD_ARCHIVED` / `CUSTOM_FIELD_REQUIRED` /
   `CUSTOM_FIELD_VALUE_INVALID`. Values ride the **owning entity's** permission; the
   definitions manager carries its own `configuration.custom_fields.*` keys. The six
   first-wave consumers are partners, items, sales, purchasing, payroll, accounting
   (projects) — published-service calls only, no cross-module writes.
5. **The additive registration rule (the 042+ rule).** Every phase from PHASE-042 onward
   that ships a new entity registers it into `CUSTOM_FIELD_ENTITIES` **in the same PR** —
   one registry line plus the
   [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) row; zero
   migrations, zero deploys. This is the binding handoff note of PHASE-036 §8.
6. **DF-39 note: this is the plugin substrate.** Typed fields, tenant picklists, form
   layouts, and the registry are the substrate a plugin system would build on. The
   marketplace itself (DF-38) remains a recorded non-goal — building it requires a new
   decision, not an extension of this one.
7. **A per-tenant definition cache.** The guard's definition lookup `(tenant,
   entity_type)` is cached per tenant with the ADR-0008 in-process TTL + invalidation
   pattern; the hot paths — definition lookup by `(tenant, entity_type)` and value fetch
   by `(tenant, entity_type, entity_id)` — are EXPLAIN-verified index scans (no
   seq-scan) at seeded demo volumes (the OA-06 acceptance criterion).

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| One jsonb blob per entity (`custom_fields jsonb` column on each owner, or a value row holding a jsonb document) | Untyped at the database: no per-type predicates, no per-type indexes, type safety re-implemented in every reader; `value_json` remains in this design only for MULTISELECT arrays |
| A DB-level CHECK enumerating `entity_type` | Every later entity becomes a migration — the exact cost this phase removes; the check would also have to be kept in lockstep with the designer's native-field metadata anyway |
| Per-entity value tables (or one table with one nullable FK per entity) | Six (and growing) near-identical tables or a nullable-FK fan-out; the guard would be copied per module; the registry already validates writes and the orphan sweep reconciles |
| Entity modules owning their value rows | `MODULE_BOUNDARIES` violation — cross-module writes to `custom_field_values`; one guard would become seven |
| Archive-as-delete for definitions and picklist options | Breaks history: posted documents and historical rows must render their values and labels forever (BR-057); the store keeps values, only NEW writes against archived rows are rejected typed |

## Consequences

- **Values are first-class data**: per-type queries and indexes work; BR-057 type
  integrity is a DB floor (`num_nonnulls = 1`) plus a service guard (a value row exists
  only for an ACTIVE definition of matching `data_type`).
- **Archive preserves history**: definitions, picklists, and options are
  archive-not-delete (no DELETE grants); archiving a definition hides its field while
  its values keep rendering; archived picklist options are rejected for new values and
  keep their labels for history.
- **Polymorphic integrity is code-guarded, not FK-pinned**: the registry check, the
  orphan-sweep job, and the tamper spec are mandatory companions — a module skipping the
  guard surfaces as orphans the sweep reconciles, never as silent corruption.
- **Module boundaries hold**: the configuration module owns all five 0049 tables and
  publishes the guard; the six first-wave entity modules consume it via `api/` only.
  `form_layouts` rides the same registry (BR-059 mandatory-native protection is guarded
  against the registry's mandatory list).
- **Interoperability cost**: entity registration is a code review concern, not a
  migration concern — a 042+ phase that forgets its registry line ships an entity the
  substrate cannot see (caught by the same PR's review rule, not by a gate).
- **Phase wiring**: migration `0049_custom_fields.sql` (journal 48 → 49, five RLS'd
  tenant tables); permissions +3 (`configuration.custom_fields.read` /
  `configuration.custom_fields.manage` / `configuration.form_layouts.manage`, 245 → 248);
  feature key `platform.custom_fields` granted business + enterprise (starter excluded —
  the tier-4 precedent) with dependency `platform.onboarding`; rules BR-057/BR-058/BR-059
  ([../../product/BUSINESS_RULES.md](../../product/BUSINESS_RULES.md)); the key namespace
  is documented in [../../database/DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md)
  §15.
- **Sync surface**: custom-field values ride the first-wave fed entities' pull
  projections as one additive `customFields` payload field (ACTIVE definitions only);
  offline pushes never touch the value store (CR-36 g).

## Revisit triggers

- A tenant demands formulas, scripting, or business logic on custom fields — out of scope
  by PHASE-036's non-goals; requires a new decision record before any such surface.
- Workflow conditions on custom fields (PHASE-052), custom fields as report/BI dimensions
  (PHASE-057), or public-API exposure of values (PHASE-055): each consuming phase owns its
  exposure; the store and registry do not change.
- The marketplace (DF-38) is revived → a new ADR; this substrate stands underneath it.
- Value-fetch load on a first-wave entity outgrows the per-tenant definition cache →
  revisit caching tiers under the ADR-0008 Redis adoption triggers, not the storage shape.
