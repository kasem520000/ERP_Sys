# P36 — custom fields (PHASE-036 working record)

Task ID: P36 (orchestrated: API/docs in-tree, WEB-036 + DOCS-036 subagents).

## Zero-drift re-pins (the §18 lesson-5 ledger)

| Counter | Before | After | Where asserted |
|---|---|---|---|
| Permissions | 245 | **248** (+3: configuration.custom_fields.read/.manage, configuration.form_layouts.manage) | identity-flows.db.spec.ts pin; `pnpm check:permissions-drift` (matrix 248 = seed 248 — 0049 joined BOTH seed lists: permissions-drift.ts PERMISSION_SEED_MIGRATIONS + permissions-drift.spec.ts SEED_PATHS) |
| Web i18n | 4,290 | **4,447** (+157) | `pnpm check:i18n-parity` |
| Mobile i18n | 371 | 371 (untouched) | `pnpm check:mobile-i18n` |
| ENTITY_CATALOG rows | 199 (198 domain + 1 infra) | **204** (203 domain + 1 infra) | check-rls catalog drift (the 035-named "catalog ↔ SQL reconciliation" — it pre-existed in check-rls; the five 0049 tables made it green once cataloged) |
| Isolation registry | 178 | **183** (+5, A-suite +30) | tables.registry.ts + identity-isolation fixtures (OWN_ROW + MISMATCHED_INSERT + seedFixtures) |
| Report registry | 86 | 86 (no new contracts — settings surfaces, not reporting) | report-pack-wiring.spec |
| schema_version | 48 | **49** | migration 0049 marker + /health/ready |

NO SETTINGS_REGISTRY key wave — the golden-effective-configs pins did NOT move
(platform.custom_fields is granted by 0049 to business+enterprise but is NOT
transcribed into layer-fixtures BUSINESS_KEYS/ENTERPRISE_KEYS — the fixtures'
documented role is the template-relevant grant subset and no shipped template
manifest consumes the key; entitlements.db.spec's BR-040 closure is satisfied
by the 0008 platform.onboarding base grant).

## Recorded pre-existing 034-tree gate repairs (the 035 ledger continuation)

1. **reporting.module.ts KNOWN_PERMISSION_KEYS** lacked `consolidation.reports.view`
   (the 0041 consolidation contracts' permission — seeded in 0004 by PHASE-034
   and present in the reporting-unit meta-test list, but never added to the
   module's boot-time set): every full-AppModule boot (crm/billing, tenancy-http,
   master-data-http, …) failed ContractValidationError. The 035 evidence run
   covered only its spec subset so it never fired. Repaired + recorded in-file.
2. **tenancy-provisioning.db.spec.ts / tenancy-http.db.spec.ts account+purpose
   pins** (64→65 accounts, 41→42 purposes): the restored-lineage migration 0041
   added the 3220 CONSOLIDATION_ADJUSTMENT template account + purpose but the
   pins stayed at the 034 numbers. Same subset-run explanation. Repaired with
   genealogy comments.
3. **performance/report-hammer.db.spec.ts** — the only remaining full-suite
   failure: NOT repaired, recorded as the environmental item (see below).

## The environmental item (the 030-runbook precedent)

`report-hammer` fails on this hardware with the production 15s
`statement_timeout` (apps/api/src/infra/db/client.ts): the hammer's 4 concurrent
identical trial-balance COMPUTES on the 100k-scale large tenant serialize on
the `report_runs` ON CONFLICT tuple lock; lanes 2–4 time out at ~15.0–15.1s.
Evidence trail: the spec is UNREACHABLE on the 035 tree (its beforeAll boots
AppModule → the pre-existing KNOWN_PERMISSION_KEYS defect above fails the boot —
vitest reports it as "1 skipped"); on the 036 tree (boot repaired) it runs and
the compute wall-clock exceeds the budget on this sandbox (ga-spike's
single-lane budgets PASS — 11s — so the single-compute path fits; the miss is
the concurrent-identical-lane contention). The spec's own header documents the
split: "The production-class hammer is the infra-gated GA obligation; the
`[report-hammer]` lines are the recorded local-tier evidence."

## Key implementation facts for 037+ authors

- The **value guard** is the ONE import later phases reuse:
  `import { validateValues, persistValues, attachValues, mergeValuesInto, customFieldsPayloadSchema } from "../../configuration/api"`.
  Contract: validate BEFORE the entity insert (zero partial writes), persist
  after (same ambient UoW), `customFields === undefined` never touches the
  store, full-replace semantics (absent keys clear; required ACTIVE fields
  must ride every replace payload).
- The **entity registry** (`CUSTOM_FIELD_ENTITIES` in configuration/domain/
  custom-fields-schema.ts) is the ADR-0019 additive rule: 042+ register every
  new entity in the same PR (one registry line + ENTITY_CATALOG row); entityType
  strings follow the sync PULLED_ENTITY_TYPES vocabulary.
- The **typed↔column mapping** (BR-057): TEXT/SELECT/REFERENCE→value_text,
  NUMBER→value_number, DATE→value_date, BOOLEAN→value_boolean, MULTISELECT→
  value_json (array of option ids; node-pg parses jsonb — the store normalizes
  back to the wire string, the double-parse lesson from the first run).
- **jsonb sub-selects in raw SQL**: node-pg returns jsonb as PARSED JS values;
  stringifying for `::jsonb` params needs `${json}::jsonb` interpolation, and
  read-back rows need typeof normalization (custom-fields.store.ts mapValue).
- **Sync projections** (CR-36 g): items/partners/sales_invoices pulls carry ONE
  additive `customFields` jsonb (ACTIVE definitions only — archived fields drop
  off the feed while values stay in the store). purchase_orders/employees/
  projects are in no feed group (documented in the phase doc's sync note).
- The **manager screen** (/settings/custom-fields) + picklist editor + layout
  designer ship as `custom-fields-manager.tsx` (2,076 lines, 3 tabs); the
  shared render component is `custom-field-surface.tsx`; the partner LIST
  renders dynamic custom-field columns (the acceptance-2 demo shape).
- Watch items carried: SF-026-001, SF-026-002, the 028 ControlGuard production
  call-site, the 029 "E2" item + payslip print templates, the 030
  environmental runbook set (+report-hammer joins it per this record), and
  the golden.spec period-state order flake observed once mid-phase (passed on
  every full-suite rerun — the fixtures' restorePeriodsOpen harness is the
  designed mitigation; flagged for the 037 author's awareness only).
