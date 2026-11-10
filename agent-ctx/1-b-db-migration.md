# Task 1-b · PHASE-015 T4 (+T9/T12 schema parts) — industry configuration DB migration

Task ID: **1-b** (PHASE-015). Agent: db-migration. Status: **DONE** (handoff notes at the end).

## What shipped

### 1. `apps/api/migrations/0022_industry_configuration.sql` (new, 409 lines)
Follows 0021 conventions exactly: `SET ROLE erp_migrate` header, `--> statement-breakpoint`
between every statement, RLS macro per tenant table, per-table grants
(REVOKE → GRANT → RESET ROLE → erp_definer grant → SET ROLE), `erp._schema_state`
marker `('schema_version', 22)` at the end, final `RESET ROLE`.

- **`industry_templates` ALTER**: `ADD COLUMN "status" text NOT NULL DEFAULT 'ACTIVE'`
  plus `ck_industry_templates_status_values CHECK ("status" IN ('ACTIVE','DRAFT','RETIRED'))`
  (drop-if-exists → add, 0021's subscriptions pattern).
- **Template registry seeds**: the three PHASE-015 priority manifests upserted
  `ON CONFLICT ("key") DO UPDATE` — `manifest` jsonb embedded **byte-exact** from
  `docs/industries/templates/{retail,grocery-supermarket,restaurant-cafe}.md` (verified:
  extracted JSON literal === doc fence text; `manifest = $1::jsonb` true on live PG16;
  Arabic strings included; no apostrophes so no SQL escaping needed).
  Keys `industry.retail` / `industry.grocery` / `industry.restaurant`, version `1.0.0`,
  `is_active = true`, `status = 'ACTIVE'`. The other ten 0008 stub rows stay untouched.
- **`tenant_industry_config`** (tenant-owned, RLS): id uuid PK (app-generated uuidv7 —
  no DB default), tenant_id FK→tenants RESTRICT, created/updated timestamptz default now(),
  template_key (FK→industry_templates.key RESTRICT), applied_version (semver-shape CHECK,
  mirrors 0006's version shape), applied_manifest_hash text, applied_at default now(),
  applied_by FK→users RESTRICT (0021 recorded_by pattern), status default 'ACTIVE'
  (no CHECK — domain not specified anywhere; left open for the apply/switch service),
  overrides `{}`::jsonb, archived_terminology/navigation/capabilities + conflict_notes
  `'[]'::jsonb. `UNIQUE (tenant_id)` (one applied state per tenant) + `ix_tenant_industry_config_tenant`.
- **`feature_flags`** (platform-owned L8): key text PK, scope, enabled default false,
  rules `{}`::jsonb, created/updated. NO tenant_id, NO RLS (global reference like
  jurisdictions/plans): `REVOKE ALL … GRANT SELECT ON feature_flags TO erp_app` (+erp_readonly,
  +erp_definer) — writable only via erp_migrate. No seed rows (none requested).
- **`item_components`** (tenant-owned, RLS): id, tenant_id FK→tenants, created_at,
  composite_item_id + component_item_id with the tenant-composite FK pattern
  `FOREIGN KEY (composite_item_id, tenant_id) REFERENCES items (id, tenant_id) RESTRICT`
  (0014 pattern; items carries `uq_items_id_tenant` from 0009), qty numeric(18,6) with
  `CHECK (qty > 0)` + `CHECK (composite_item_id <> component_item_id)`,
  `UNIQUE (composite_item_id, component_item_id)` + indexes on tenant_id and composite_item_id.
- **RLS macro calls used (exact 0021 form)**:
  `SELECT erp.apply_tenant_policy('"tenant_industry_config"');` and
  `SELECT erp.apply_tenant_policy('"item_components"');` — feature_flags gets none.
- **Grants**: tenant_industry_config SELECT/INSERT/UPDATE (no DELETE — re-applied/switched
  in place); item_components SELECT/INSERT/UPDATE/DELETE (definition CRUD); feature_flags
  SELECT only. No guard triggers (nothing here is append-only; BR-038 archives are jsonb
  snapshots on the mutable row, not event rows).

### 2. `apps/api/migrations/0004_permissions_seed.sql` (only migration modified)
Three rows inserted before the `ON CONFLICT ("key")` close under
`-- §3.8 industry templates (PHASE-015)`:
`industry.templates.manage` / `industry.templates.switch` / `industry.terminology.manage`
(module `industry`, bilingual descriptions verbatim from the task). Idempotent upsert tail
intact. **0005 verification (read + live-DB proof):** the owner template grant is
`CROSS JOIN "permissions" p WHERE … p."key" NOT LIKE 'platform.%' AND p."key" <> 'identity.mfa.manage'`
— the three new keys match neither exclusion, so on every fresh apply the owner role
template auto-grants them (verified on PG16: owner grants = 3/3).

### 3. Journal + manifest
- `apps/api/migrations/meta/_journal.json`: appended idx 21, version "7",
  when `1793528823433` (= 1793528802433 + 21*1000), tag `0022_industry_configuration`,
  breakpoints true.
- `apps/api/src/infra/db/migrations.ts`: `"0022_industry_configuration"` appended to
  MIGRATIONS (required — readMigrationFiles() throws on manifest/file drift and
  `erp.schema_version()` must equal MIGRATIONS.length = 22).
- `apps/api/src/infra/db/migrations.spec.ts`: last-tag expectation updated to
  `0022_industry_configuration` (was hard-coded `0021_...`).

### 4. `apps/api/src/db/schema.ts` (additive)
- `industryTemplates` gains `status: text("status").notNull().default("ACTIVE")`.
- New PHASE-015 block after notificationPrefs: `tenantIndustryConfig`
  (explicit id/createdAt/updatedAt — no `version` column exists in the SQL, so no
  standardColumns spread), `featureFlags` (text PK, like currencies), `itemComponents`
  (billingEvents style: explicit id + createdAt only). Indexes/unique mirror the SQL names.

### 5. Test-fixture updates forced by the shipping convention (NOT new test logic)
The isolation registry header mandates: "every tenant_id-bearing table must be
registered — a registry CI check fails when a new tenant-owned table ships without
registerating". Same class of update as the journal/manifest sync:
- `apps/api/src/__db__/isolation/tables.registry.ts`: + `tenant_industry_config`,
  + `item_components` (deleteGranted: true — the DELETE grant is by design).
- `apps/api/src/__db__/isolation/identity-isolation.db.spec.ts`: PHASE-015 fixture
  block (tenant_industry_config rows; one COMPOSITE item per tenant
  `1f1f1f1f-…` — kind COMPOSITE is a legal ck_items_kind value — plus the
  item_components row `20202020-…` pairing it with the existing babababa stock
  fixture), OWN_ROW + MISMATCHED_INSERT entries, `items: 2` in
  EXPECTED_ROWS_PER_TENANT, and an `item_components → qty` A4 branch (no updated_at
  column — the report_runs precedent).
- `apps/api/src/__db__/identity-flows.db.spec.ts`: permissions count 224 → 227
  (+3 industry keys).

## Verification evidence

- `pnpm --filter @erp/api typecheck` → exit 0. `pnpm --filter @erp/api lint` → exit 0.
- Unit `src/infra/db/migrations.spec.ts` → 4/4 pass.
- `pnpm --filter @erp/api test:db -- src/__db__/migrations.db.spec.ts` (embedded PG16,
  fresh apply of the full chain):
  **5/7 pass** — schema_version=22, re-apply no-op, ownership model, role defaults,
  FORCE RLS. **2/7 fail — both are the SAME single expected gap**: the check-rls catalog
  drift reports exactly one violation, `"item_components: present in the database but
  missing from ENTITY_CATALOG.md (schema-docs sync rule, MIGRATION_STRATEGY §6)"`
  (`tenant_industry_config` and `feature_flags` are already documented there). The
  negative-proof test fails only on its final `clean.ok` assertion — same root cause.
- Full db suite (3 runs): after my fixture updates, `identity-isolation` (654 tests) and
  `identity-flows` pass; the ONLY persistent failures are the 2 catalog-drift tests above.
  One run showed transient `gl-perf` (EXPLAIN) / `notifications-email` (SMTP capture
  timeout) flakiness under sandbox load; both pass in isolation and in the other runs —
  pre-existing timing sensitivity, not a regression (gl-perf passes standalone; the email
  spec passed in the final run).
- `pnpm check:permissions-drift` (repo root) → fails with EXACTLY the 3 expected keys:
  `[permissions-drift] SEEDED BUT NOT IN MATRIX: industry.templates.manage /
  industry.templates.switch / industry.terminology.manage` then
  `[permissions-drift] FAILED — matrix 224 keys, seed 227 keys` (exit 1). No
  IN-MATRIX-BUT-NOT-SEEDED lines.
- Extra live-PG16 proof (fresh boot + drizzle migrate, 20/20 checks green):
  manifest jsonb === docs JSON for all three templates; 13 registry rows all
  ACTIVE/is_active; status default + CHECK present; FORCE RLS + tenant_isolation policy
  (TO erp_app, erp_readonly) on both tenant tables; feature_flags has NO RLS and
  erp_app holds SELECT only; permissions=227 with owner auto-grants 3/3;
  seed upsert re-runs idempotently; qty>0 CHECK enforced.

## Handoff notes for the other agents

1. **Docs agent**: add `item_components` to `docs/database/ENTITY_CATALOG.md` (items
   section; suggested row: composite-product definition lines — tenant_id,
   composite_item_id, component_item_id, qty | 015 | no). That clears the ONLY
   remaining migrations.db.spec failures. Also add the 3 permission keys to
   AUTHORIZATION_MATRIX §3.8 (clears check:permissions-drift).
2. **Apply/switch service agents (T5/T6)**: `tenant_industry_config.status` has no
   CHECK (domain deliberately left open — nothing normative existed; tell me if you
   need one and I'll note it for a follow-up migration). `applied_manifest_hash` is
   free-form text (no length/charset pinned). One row per tenant enforced by
   UNIQUE(tenant_id); re-apply = UPDATE in place. `applied_by` FK→users RESTRICT.
3. **Composite explosion (T9)**: item_components FKs are the tenant-composite pattern
   `(item_id, tenant_id) REFERENCES items (id, tenant_id)`; `qty > 0` and
   composite≠component are CHECK-enforced.
4. **feature_flags**: no rows seeded — rollout flags ship as later seed migrations
   (erp_migrate-writable only; erp_app/erp_readonly/erp_definer hold SELECT).
