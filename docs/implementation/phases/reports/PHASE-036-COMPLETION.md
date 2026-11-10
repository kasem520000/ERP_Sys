# Completion Report — PHASE-036

> **Status:** COMPLETE · **Updated:** 2026-11-10

## Phase ID / Date

PHASE-036 — Extensibility Core — Custom Fields (Blueprint v3.0, wave 1 / stage
12, register CR-06 — the audit's **single most important functional gap**) ·
2026-11-10

## Summary

The extensibility core landed as migration `0049_custom_fields.sql`
(schema_version 49): five RLS'd tenant tables — `custom_field_definitions`
(FD-18), the TYPED value store `custom_field_values` (ADR-0019: one typed
column per row, the `num_nonnulls=1` DB law), the picklist pair
`custom_picklists` + `custom_picklist_options` (FD-20, archive-preserving
history), and `form_layouts` (FD-19/UX-12, two partial uniques for the
default/role-override split) — plus the three §3.8 permission seeds (drift
245 → **248**, seed = mirror both sides) and the `platform.custom_fields`
plan grant (business + enterprise, the tier-4 precedent; starter excluded —
BR-040 closure satisfied by the 0008 `platform.onboarding` base grant). A
code-owned entity registry (`CUSTOM_FIELD_ENTITIES`, ADR-0019's additive rule)
exposes the six first-wave entities — partners, items, sales invoices,
purchase orders, employees, projects — with the native-field lists that power
the BR-058 blocklist and the BR-059 mandatory-native protection. ONE reusable
value guard (validate-before-insert, zero partial writes, typed 400 failure
packs, full-replace semantics) is injected into all six entities'
create/update/read paths through the configuration module's `api/` surface —
the mechanism every phase from 042 on reuses with one registry line. The
manager screen `/settings/custom-fields` (definitions + picklist editor +
form designer with role overrides) and the shared `CustomFieldSurface`
component render on the first-wave forms; the partner list renders dynamic
custom-field columns (the audit's demo scenario replayed end-to-end). Sync
feeds (CR-36 g): items/partners/sales_invoices pulls carry ONE additive
`customFields` jsonb payload field (ACTIVE definitions only; pushes never
touch the value store — offline editing preserves UDF data; the
manager/designer are online-only, N/A-recorded). Web i18n 4,447=4,447
(+157); mobile 371=371. Two pre-existing 034-tree gate defects repaired and
recorded (the reporting boot rule's missing `consolidation.reports.view` and
the 0041 consolidation account/purpose pins 64/41 → 65/42); one environmental
item recorded (`report-hammer`, see Gates). All other gates green. Next:
PHASE-037.

## What Shipped (per the task table)

| Task | Delivered |
|---|---|
| T-01 ADR-0019 | `docs/architecture/ADR/ADR-0019-custom-fields-typed-value-store.md` (+ both decision-register indexes; validate_docs check 4b widened to 0001..0019) |
| T-02 Migration 0049 | Five RLS'd tables + per-type/partial indexes + purge-path policies + grants + the §7 permission seed + the §8 plan-grant tail (DATA-ONLY block) + schema_version 49; journal idx 48, `MIGRATIONS` manifest + spec assertions updated; Drizzle mirror (schema.ts +5 tables) |
| T-03 Definition service | `custom-field-service.ts` definitions CRUD: BR-058 key guard (syntax + reserved stems + native blocklist), per-type config matrix, validation-rule × data-type matrix, archive/restore semantics |
| T-04 Typed value store + guard | The seven-type validation family (TEXT/regex/lengths, NUMBER/min-max/precision, DATE, BOOLEAN, SELECT/MULTISELECT with ACTIVE-option enforcement, REFERENCE with registry-table existence checks); `CUSTOM_FIELD_UNKNOWN_KEY` / `CUSTOM_FIELD_ARCHIVED` / `CUSTOM_FIELD_REQUIRED` / `CUSTOM_FIELD_VALUE_INVALID` typed 400 packs; zero-partial-write ordering; full-replace semantics |
| T-05 Picklist service | `picklist-service.ts`: list/option CRUD, ordering (renumber reorder), archive-preserving history (BR-057) |
| T-06 Form-layout service | `form-layout-service.ts`: sections jsonb, role overrides (override → default → null resolution), BR-059 mandatory-native protection (exactly-once + canonical order), shape floor (unknown native/custom, duplicates) |
| T-07 Values injection | All six first-wave entities: create (validate-before-insert + persist + read merge), update/PATCH (partners, items, employees, projects), get + list (batched merge, the no-definitions OA-06 fast path adds zero queries on UDF-free tenants) |
| T-08 Manager screen | `/settings/custom-fields` (server page + `custom-fields-manager.tsx`, 2,076 lines): Definitions / Picklists / Layouts tabs, AR/EN parity, RTL, empty/loading/error states |
| T-09 Designer + surface | The per-entity form designer (Layouts tab: sections, field placement, role overrides, BR-059-locked mandatory natives) + the shared `CustomFieldSurface` (all seven data types) integrated into partner-form, item-form, employee-form, sales-invoices, purchasing-orders, accounting-projects; the partner list renders dynamic custom-field columns |
| T-10 Navigation + gating | `settings.custom_fields` NAV_ITEMS row (featureKey `platform.custom_fields`, permission `configuration.custom_fields.read` — command palette rides NAV_ITEMS per OA-04); plan gating: starter tenants get no grant (0049 tail) → no nav, no feature; ROUTE_PERMISSIONS +21 rows, SESSION_ROUTES +2 (the render surface + entity registry, the BR-039 derived-only pattern) |
| T-11 RLS battery | Isolation registry +5 (A-suite +30 auto-generated, all green); hand-written fixtures (seedFixtures + OWN_ROW + MISMATCHED_INSERT — the consolidation pattern for the composite FKs) |
| T-12 Rules + docs wave | BUSINESS_RULES BR-057/058/059 (numbering continues from BR-056); FEATURE_CATALOG `platform.custom_fields` row; DATA_DICTIONARY §15 (the UDF key namespace) + the two §9 enum rows; NAVIGATION_MODEL §1.3 + §9; MODULE_BOUNDARIES (configuration owns the five tables, publishes the guard); SYNC_PROTOCOL §2 item 9 (the additive pull field); ENTITY_CATALOG +5 (203 domain rows) |
| T-13 Gates | Below |

## Verification (acceptance criteria → evidence)

1. **Migration 0049 applies cleanly** — full DB suite boots the fresh chain
   through 0049 (journal 48 → 49; the `migrations.db.spec` manifest↔journal↔disk
   triple and the per-file schema_version assertions green). The five tables
   are RLS'd with composite tenant FKs; the Drizzle mirror and
   ENTITY_CATALOG.md agree (204 rows / 203 domain) and the catalog ↔ SQL
   reconciliation (`check-rls` check 2, migrations.db.spec "passes on the real
   schema") is green.
2. **The demo scenario** — a tenant creates a TEXT required partner field
   («رقم رخصة البلدية» / municipality license) from `/settings/custom-fields`;
   it renders on the partner form (CustomFieldSurface), validates on save (the
   guard's required/regex family), persists (typed value row), survives reload
   (the get read-merge), and appears on the partner list (dynamic columns).
   Machine-proven end-to-end at the service layer by
   `__db__/configuration/custom-fields.db.spec.ts` (the `rt_municipality_license`
   required TEXT field with lengths, the read-merge assertions, the replace
   round-trip); the web surfaces typecheck/lint green with the integrations in
   all six forms + the partners table.
3. **Typed round-trip + the failure family** — all seven data types persist
   and re-read identically (TEXT/NUMBER/DATE/BOOLEAN/SELECT/MULTISELECT/
   REFERENCE, exact-value assertions); the guard rejects wrong types, regex /
   min/max / length violations, unknown picklist options, unknown field keys,
   bad references, missing required fields, and writes against ARCHIVED
   definitions — each a typed pack (`CUSTOM_FIELD_*` codes, 400 family in the
   error filter) with zero partial writes (`valueRowCount === 0` after every
   rejection path).
4. **Picklists** — option CRUD + reorder persist; archived options are
   rejected for NEW values (`CUSTOM_FIELD_VALUE_INVALID`) while historical
   values keep rendering their labels (the read merge resolves ARCHIVED option
   labels — asserted for both the SELECT and MULTISELECT shapes).
5. **Form designer** — a saved default layout + a role override render on
   resolve (override wins, default falls back, no-layout → null); removing or
   reordering mandatory native fields is rejected (`FORM_LAYOUT_NATIVE_PROTECTED`,
   BR-059 — removal, order-flip, duplicate, unknown-native and unknown-custom
   all asserted); archiving a definition hides its field while values are
   preserved (BR-057 archive test).
6. **Feature gating** — the 0049 tail grants `platform.custom_fields` to
   business + enterprise only; starter tenants hold no grant → the nav item is
   pruned server-side (featureKey) and the manager routes fail the feature
   guard; template-composable grant behavior unchanged (CR-36 f — the
   entitlements closure suite green). The readonly-sweep proves the new
   state-changing routes return the typed read-only 403 during grace (the
   sweep iterates the +21 ROUTE_PERMISSIONS rows — the fixture's business-plan
   tenants carry the key through the 0049 grant so the feature guard passes
   and the read-only interceptor fires, exactly the documented sweep shape).
7. **RLS** — the A1–A10 battery extended to the five new tables (registry +5;
   A1 no-GUC reads, A2 foreign-GUC, A3 mismatched inserts, A4 foreign updates,
   A5 delete grants, A7 id probes, A8 aggregates, A9 joins, A10 union/CTE —
   all green in the final full run); plus the service-layer cross-tenant
   read-merge proof and the two row-law tamper specs (multi-typed rows and
   non-array `value_json` both rejected by the 0049 CHECKs).
8. **House gates** — typecheck 8/8 · lint 8/8 · unit 1,386 (api 474 · web 73 ·
   contracts 56 · ui 42 · desktop 274 · mobile 393 · sync-core 36 ·
   domain-core 38) · DB full suite 2,389 tests, **one environmental failure
   (recorded below)** · docs 32/32 (validate_docs 4b widened for ADR-0019) ·
   i18n parity 4,447=4,447 · mobile i18n 371=371 · permissions drift
   **248=248** (seed = mirror, both seed-path lists extended) · manifests
   13/13 · depcruise clean (1,581 modules) · capabilities matrix PASS · token
   contrast AA · REPORT_CATALOG unchanged (86 — settings surfaces, not
   reporting).
9. **Performance budgets** — the EXPLAIN proofs are machine-checked in the DB
   suite (OA-06 describe): the definition lookup rides
   `ix_custom_field_definitions_tenant_entity_status` and the value fetch
   rides `uq_custom_field_values_tenant_entity_field` — index scans, no
   seq-scan, with `enable_seqscan=off` isolating the index-shape proof from
   the planner's volume-dependent cost choice. The read merges are batched
   (one values query + one option-label query per page) and UDF-free tenants
   take the zero-query fast path.
10. **This report + status flip** — IMPLEMENTATION_STATUS row flipped;
    `NEXT_ACTION.md` rewritten for PHASE-037; the working record in
    `agent-ctx/P36-custom-fields.md` (the re-pin ledger + the recorded gate
    repairs); the archive delivered as `ERP_PLATFORM_PHASE036.zip` (OA-07).

## Recorded pre-existing 034-tree gate repairs (the 035 ledger continuation)

- **`reporting.module.ts` KNOWN_PERMISSION_KEYS** lacked
  `consolidation.reports.view` (seeded by 0004/PHASE-034 and present in the
  reporting-unit meta-test list, but never added to the module's boot-time
  set) — every full-AppModule boot (crm/billing, tenancy-http,
  master-data-http, …) failed `ContractValidationError`. The 035 evidence run
  covered only its spec subset, so the boot rule never fired. Repaired
  in-tree with the provenance comment.
- **tenancy-provisioning / tenancy-http account + purpose pins** (64 → 65
  accounts, 41 → 42 purposes): the restored-lineage migration `0041` added the
  `3220 CONSOLIDATION_ADJUSTMENT` template account + purpose but the pins
  stayed at the 034 numbers. Repaired with genealogy comments (the same
  subset-run explanation).

## The environmental item (recorded, not repaired)

`performance/report-hammer.db.spec.ts` — the full suite's one failure: the
hammer's 4 concurrent identical trial-balance COMPUTES on the 100k-scale large
tenant serialize on the `report_runs` ON CONFLICT tuple lock and lanes 2–4
exceed the production 15s `statement_timeout`
(`apps/api/src/infra/db/client.ts`) on this hardware. The spec is UNREACHABLE
on the 035 tree (its beforeAll boots AppModule → the repaired boot defect
above fails it — vitest surfaces that as a skip), so this is not a regression:
with the boot repaired the spec runs and the sandbox CPU misses the concurrent
lane budget (the single-lane `ga-spike` budgets PASS at ~11s). The spec's own
header documents the split ("the production-class hammer is the infra-gated GA
obligation; the `[report-hammer]` lines are the recorded local-tier
evidence") — this report records the local-tier line honestly per the 030
environmental-runbook precedent. One `golden.spec` period-state order flake
was observed once mid-phase and passed on every subsequent full-suite rerun
(the fixtures' `restorePeriodsOpen` harness is the designed mitigation);
flagged in agent-ctx for the 037 author, no repair spent.

## Handoff to PHASE-037 (ZATCA Phase-1 & QR)

None binding (wave siblings are parallel-safe). The sales-invoice surface
shipped here is the first custom-field-bearing document: if 037 touches the
invoice print template, the custom-field values are available on the invoice
read (`customFields` merged in get/findWithLines) for optional print
inclusion — a 037-scope decision, not an obligation. For the 042+ module
authors: register every new entity into `CUSTOM_FIELD_ENTITIES` in the same
PR (one registry line + the ENTITY_CATALOG row) — the ADR-0019 additive rule.
