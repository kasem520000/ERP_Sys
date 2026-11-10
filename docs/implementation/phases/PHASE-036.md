# PHASE-036 — Extensibility Core — Custom Fields

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 1 / Stage 12 · **Register:** [CR-06](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §25.2 (FD-18/FD-19/FD-20) · §29.2 (DF-39) · UX-12 · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5/§6.3

## 1. Phase Overview

- **Phase ID:** PHASE-036
- **Title:** Extensibility Core — Custom Fields (نواة القابلية للتوسعة — الحقول المخصصة)
- **Objective:** Close the audit's **single most important functional gap** — FD-18,
  custom fields/UDF, whose absence the audit called "not a missing feature but a
  missing business model" — together with its two siblings: the per-entity
  **form layout designer** (FD-19) and **tenant-managed picklists** (FD-20). The
  phase delivers a typed custom-field store (`custom_field_definitions` +
  `custom_field_values`), the picklist pair (`custom_picklists` +
  `custom_picklist_options`), and `form_layouts`, all exposed through a
  code-owned **entity registry** so a tenant adds, validates, and renders a new
  field with **zero code changes, zero migrations, zero deploys**. It ships
  BEFORE the module waves by hard ordering (roadmap §5): every phase from 042
  onward surfaces custom fields on its new entities by registering them into
  this substrate in one line — the DF-39 plugin substrate without the
  marketplace (DF-38 stays a recorded non-goal), and the platform's answer to
  customizable forms (UX-12).
- **Business value:** Every competitor the audit named (Odoo, NetSuite,
  Dynamics, SAP B1) lets a customer add a field without a developer; today
  every "add the municipality license number to the customer card" request
  costs this platform a code change, a migration, and a deploy. Closing FD-18
  removes the model-killer verdict, unblocks multi-vertical sales demos, and
  is the substrate the SaaS scalability claim rests on.
- **الملخص التنفيذي (AR):** تسدّ هذه المرحلة أخطر فجوة وظيفية في التدقيق المستقل
  (FD-18: الحقول المخصصة) مع مصمِّم النماذج لكل كيان (FD-19) وقوائم القيم التي
  يديرها المستأجر (FD-20): خمسة جداول مستأجرة بمخزن قيم مطبَّع (نص/رقم/تاريخ/
  منطقي/اختيار فردي ومتعدد ومرجعي)، ومصمِّم تخطيطات مع تجاوزات حسب الدور،
  وواجهات إدارة في الإعدادات تظهر على كيانات الموجة الأولى (العملاء، الأصناف،
  فواتير البيع، أوامر الشراء، الموظفون، المشاريع). تُسلَّم البنية قبل موجات
  الوحدات لأن كل مرحلة من 042 فصاعداً تعرض حقولها المخصصة عبرها بقرارٍ من سطر
  واحد، ويُمنح مفتاح `platform.custom_fields` لخطتي business وenterprise
  بترحيل بياناتٍ فقط، مع حماية كاملة بعزل المستأجرين وقواعد سلامة الأنواع.

## 2. Scope

In scope:

1. **Custom-field definitions** (`custom_field_definitions`, FD-18): tenant-owned
   registry rows — entity_type (from a code-owned entity registry), key (the
   BR-058 namespace discipline), label AR + EN, data_type enum
   TEXT/NUMBER/DATE/BOOLEAN/SELECT/MULTISELECT/REFERENCE, config jsonb
   (REFERENCE target entity, SELECT/MULTISELECT picklist binding, number
   precision), validation (required, regex, min/max, length), status
   ACTIVE/ARCHIVED. First-wave entity surfaces: partners, items, sales
   invoices, purchase orders, employees, projects.
2. **Typed value store** (`custom_field_values`): one row per (entity, field)
   with typed columns value_text/value_number/value_date/value_boolean/
   value_json (MULTISELECT arrays) + the composite unique (tenant,
   entity_type, entity_id, field_id) + per-type indexes; BR-057 type
   integrity (a value row exists only for an ACTIVE definition of matching
   data_type; archiving preserves history).
3. **Custom picklists** (`custom_picklists` + `custom_picklist_options`,
   FD-20): tenant-managed value lists with AR/EN labels, ordering, and
   archive-not-delete semantics (archived options rejected for new values,
   preserved for historical rendering).
4. **Form layouts** (`form_layouts`, FD-19/UX-12): per-entity designer layout
   — sections jsonb (ordered groups of native + custom fields, collapsible,
   column options) and role overrides; BR-059 protects mandatory native
   fields from removal or reordering.
5. **API surface**: `/api/configuration/custom-fields` CRUD (+ picklists +
   form-layouts endpoints) and per-entity values injection on the first-wave
   entities' create/update/read paths through ONE reusable validation guard —
   the mechanism every later module reuses.
6. **Screens**: the `/settings/custom-fields` manager (definitions,
   picklists, layouts), the per-entity form designer, and a shared
   `CustomFieldSurface` web component rendered inside the first-wave entity
   forms — the 12-template screen discipline (AR/EN parity, RTL,
   empty/loading states, command-palette registration per OA-04).
7. **Plan gating**: feature key `platform.custom_fields` granted business +
   enterprise (DATA-ONLY grant rows riding migration 0049's tail block, the
   0047 idempotent-upsert convention; starter excluded — the tier-4
   precedent).
8. **Isolation**: RLS on all five tenant tables with the A1–A10 attack
   battery extended (isolation registry +5) — the platform's flagship
   discipline applied from day one.
9. **Substrate documentation**: ADR-0019 (typed value store + entity
   registry + the additive registration rule for later phases) and the DF-39
   note: this is the plugin substrate; the marketplace itself (DF-38)
   remains a recorded non-goal.

Out of scope: plugin/extension marketplace (DF-38 — recorded non-goal) ·
custom fields on entities beyond the first wave (each owning phase surfaces
its own) · custom scripting or business logic on fields · workflow
conditions on custom fields (052) · custom fields as report/BI dimensions
(057) · public-API exposure of custom-field values (055).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | planned — the v3.0 entry phase; hard ordering rule (roadmap §5: 035 ships first) |
| Delivered 34-phase baseline (posting engine, RLS macro, configuration module, template engine) | delivered 2026-11-09 in the stage-11 archive |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

No other Wave-1 phase is a prerequisite (siblings may run in parallel by
separate agents). The hard ordering rule that binds this phase: it ships
BEFORE PHASE-042+ so the module waves surface custom fields on their
entities. Cumulative counters below assume the sequential lineage
035 → 036 → … → 041.

## 4. Design Impact

- **Migrations**: `0049_custom_fields.sql` (journal 48 → 49; five tenant
  tables, all RLS'd with composite tenant FKs per the house convention). The
  `platform.custom_fields` plan grant rides 0049's DATA-ONLY tail block —
  idempotent upsert on the grant rows, the 0047/0048 grant discipline,
  business + enterprise, starter excluded — so no separate grant migration is
  spent and 0050 stays free for PHASE-037. Drizzle `_journal.json` +
  `migrations.ts`/spec updated per house convention.
- **Entities**: +5 tables (ENTITY_CATALOG.md 198 → 203 on the register §B
  baseline); Drizzle mirrors + typed stores under the configuration module.
- **Permissions**: +3 keys — `configuration.custom_fields.read`,
  `configuration.custom_fields.manage`,
  `configuration.form_layouts.manage`; the 245-discipline zero-drift check
  extended (245 → 248 on the sequential lineage; seed = mirror).
- **i18n**: ~180 new AR/EN dictionary keys (manager, designer, picklists,
  per-entity surfaces, typed validation messages); parity gate asserts
  locale-key equality (4,186 + Wave-1 predecessors + n = same on both
  locales).
- **Reports**: +0 contracts — these are settings/module surfaces, not
  reporting; REPORT_CATALOG.md unchanged.
- **Feature flags**: `platform.custom_fields` (deps: `platform.onboarding`)
  — FEATURE_CATALOG.md row + plan grants; template-composable grants
  preserved (CR-36 f).
- **Docs**: ADR-0019 · ENTITY_CATALOG.md (+5) · FEATURE_CATALOG.md (+1 key) ·
  DATA_DICTIONARY.md (the UDF key namespace) · NAVIGATION_MODEL.md (+1
  settings item) · BUSINESS_RULES.md (BR-057/BR-058/BR-059 — numbering
  continues from BR-056, the last shipped rule).
- **Sync surface (CR-36 g)**: custom-field values ride the first-wave
  entities' sync feeds as additive payload fields (offline entity editing
  preserves UDF data); the manager/designer are online-only — N/A-recorded
  for the offline clients' configuration plane.
- **Performance (OA-06)**: per-type indexes + EXPLAIN-verified hot paths —
  definition lookup by (tenant, entity_type) and value fetch by (tenant,
  entity_type, entity_id); a per-tenant definition cache (the ADR-0008 TTL +
  invalidation pattern).
- **One new ADR** — ADR-0019, the typed-value-store decision (typed columns
  over a jsonb blob: queryable, indexable, type-safe guards); everything else
  stays within decided patterns; CR-36 gates apply.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author ADR-0019 (typed value store, entity registry, additive registration rule for later phases) | docs |
| T-02 | Migration `0049` (five RLS'd tables + indexes + the DATA-ONLY grant tail) + Drizzle journal/spec | api |
| T-03 | Definition service: CRUD, key namespace guard (BR-058), archive semantics, entity-registry validation | api |
| T-04 | Typed value store + the reusable per-entity validation guard (seven data types, validation rules, typed 400 failure packs) | api |
| T-05 | Picklist service: list/option CRUD, ordering, archive-preserving history | api |
| T-06 | Form-layout service: sections jsonb, role overrides, BR-059 native-field protection | api |
| T-07 | Values injection into the six first-wave entity APIs (read merge + write guard, zero partial writes) | api |
| T-08 | `/settings/custom-fields` manager screen + picklist editor (12-template discipline, RTL) | web |
| T-09 | Per-entity form designer + the shared `CustomFieldSurface` component on first-wave forms | web |
| T-10 | NAV_ITEMS registration, command-palette entries (OA-04), plan-gating verification per plan | web |
| T-11 | RLS A1–A10 attack tests for the five tables + isolation-registry rows | api |
| T-12 | Rule specs BR-057/058/059 + docs wave (catalog, feature catalog, dictionary, navigation, rules) | docs |
| T-13 | Full local gates (typecheck/lint/boundaries/unit/docs/i18n parity/permissions drift/EXPLAIN budgets) + evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migration 0049 applies cleanly (journal 48 → 49); the five tables are
   RLS'd with composite tenant FKs; the Drizzle mirror and ENTITY_CATALOG.md
   agree (203 rows); the catalog ↔ SQL reconciliation check is green.
2. The audit's demo scenario, replayed end-to-end with ZERO code changes: a
   business-plan tenant creates the partner custom field «رقم رخصة البلدية»
   (municipality license number — TEXT, required, AR + EN labels) from
   `/settings/custom-fields`; it renders on the partner form, validates on
   save, persists, survives reload, and appears on the partner list
   (Playwright trace + API evidence attached).
3. Typed round-trip: all seven data types (TEXT/NUMBER/DATE/BOOLEAN/SELECT/
   MULTISELECT/REFERENCE) persist and re-read identically; the reusable guard
   rejects wrong-type values, regex/min/max violations, unknown picklist
   options, unknown field keys, and writes against ARCHIVED definitions —
   each a typed 400 failure pack with zero partial writes.
4. Picklists: option CRUD and reorder persist; archived options are rejected
   for NEW values while historical values keep rendering their labels.
5. Form designer: a saved layout and a role override render on the target
   entity screen; removing or reordering mandatory native fields is rejected
   (BR-059); archiving a definition hides its field while values are
   preserved.
6. Feature gating (CR-36 f): a starter tenant sees no custom-fields
   navigation; a business tenant does (grant evidence from 0049's tail
   block); template-composable grant behavior is unchanged.
7. RLS (CR-36 e): the A1–A10 attack battery extended to the five new tables —
   cross-tenant reads, writes, and injection attempts all fail typed;
   isolation registry +5.
8. House gates green (CR-36): typecheck · lint · boundaries · unit ·
   `docs:validate` (29/29 + v3.0 check 8) · i18n parity for every new key ·
   permissions drift 245 → 248 (seed = mirror) · manifests unchanged.
9. Performance budgets (OA-06): EXPLAIN evidence shows index scans (no
   seq-scan) for the definition-lookup and value-fetch hot paths at seeded
   demo volumes.
10. Completion report `docs/implementation/phases/reports/PHASE-036-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive
    delivered as `ERP_PLATFORM_PHASE036.zip` (OA-07).

## 7. Risks and Constraints

- **Polymorphic reference integrity** — `custom_field_values` references
  (entity_type, entity_id) without a DB-level FK; mitigated by the code-owned
  entity registry validating every write, an orphan-sweep integrity job, and
  a tamper spec proving guard-bypass attempts fail typed.
- **Hot-path performance** — value injection adds a fetch to every first-wave
  entity read; mitigated by typed-column indexes, one batched values query,
  a per-tenant definition cache, and the OA-06 EXPLAIN acceptance criterion.
- **Key collisions with future native columns** — a tenant key could collide
  with a later native column; mitigated by BR-058's namespace discipline
  (reserved prefix + the registry's native-column blocklist) documented in
  DATA_DICTIONARY.md.
- **Scope creep toward a plugin system** — DF-38's marketplace is a recorded
  non-goal; this phase ships the substrate (typed fields, layouts,
  picklists, registry) only; anything beyond it escalates to the owner.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-036-COMPLETION.md`
  (evidence per acceptance criterion, the demo-scenario trace, gate output,
  the EXPLAIN budget table).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-036 row → COMPLETE;
  `NEXT_ACTION.md` → next eligible phase PHASE-037 (ZATCA Phase-1 & QR)
  with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE036.zip` (OA-07)
  and handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة
  PHASE-037».
- Handoff notes for PHASE-037: none binding (wave siblings are
  parallel-safe); the sales-invoice surface shipped here becomes the first
  custom-field-bearing print document. For the 042+ module authors: register
  every new entity into the custom-field entity registry in the same PR (one
  registry line + ENTITY_CATALOG row) — the ADR-0019 additive rule.
