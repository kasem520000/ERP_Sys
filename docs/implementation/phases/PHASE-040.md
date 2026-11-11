# PHASE-040 — Data Onboarding & Migration Toolkit

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0, scope extended by v3.1/CR-46) · **Wave:** 1 / Stage 12 · **Register:** [CR-10](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-17) · §26.4 (IN-26) · §27.2 (TB-19/TB-20) · [gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md) (L1-21 export-templates half — the v3.1 scope extension) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §7 (OA-05)

## 1. Phase Overview

- **Phase ID:** PHASE-040
- **Title:** Data Onboarding & Migration Toolkit (عدة التهيئة والترحيل)
- **Objective:** Kill the onboarding bottleneck the audit called out
  directly (H-17: imports exist for only PARTNERS, ITEMS, and
  OPENING_BALANCES — "onboarding a serious client means millions of manual
  rows"). The phase widens the import engine with SEVEN new kinds — COA,
  ACCOUNT_OPENING_BALANCES, FIXED_ASSETS, EMPLOYEES, PRICE_LISTS,
  CONTRACTS, BUDGETS — each with a column-mapping wizard, typed dry-run
  validation, and an exportable error report, plus saved mappings
  (`import_mappings`). It adds migration adapters for Excel-generic,
  QuickBooks-shaped, and Odoo-shaped extracts with DOCUMENTED column
  mappings (IN-26 — extract-then-import, not live connectors), a one-click
  demo-data loader producing realistic seeded data per industry template
  (all 13 shipped templates — TB-19/TB-20), and platform-plane sandbox
  tenant creation for sales demos (OA-05). The dry-run-then-commit
  discipline of the PHASE-028 budget grid import is generalized into the
  platform's standard import path (BR-066).
- **Business value:** Implementation time for a real customer drops from
  weeks of manual entry to a mapped file and a reviewed dry-run; trials and
  sales demos get one-click realistic data per vertical; migration from
  QuickBooks/Odoo-shaped exports stops being a consulting project.
- **الملخص التنفيذي (AR):** تفتح هذه المرحلة عنق زجاجة تهيئة العملاء: سبعة أنواع
  استيراد جديدة (دليل الحسابات، الأرصدة الافتتاحية للحسابات، الأصول الثابتة،
  الموظفون، قوائم الأسعار، العقود، الميزانيات) لكلٍ منها معيّن ربط أعمدة
  وتشغيل تجريبي بلا كتابة وتقرير أخطاء مطبَّع ثنائي اللغة، مع خرائط محفوظة
  قابلة لإعادة الاستخدام، ومحوِّلات ترحيل لملفات على شكل QuickBooks و Odoo مع
  توثيق الربط، ومُحمِّل بيانات تجريبية واقعية بضغطة واحدة لكل قالب قطاعي من
  القوالب الثلاثة عشر، وإنشاء مستأجرين تجريبيين للعروض، مع تعميم انضباط
  «التجربة أولاً ثم الاعتماد» على مسار الاستيراد كله.

## 2. Scope

In scope:

1. **Import kinds widened** (H-17): COA, ACCOUNT_OPENING_BALANCES,
   FIXED_ASSETS, EMPLOYEES, PRICE_LISTS, CONTRACTS, BUDGETS — each with a
   typed row validator (COA codes/types/parents; opening balances
   balanced-by-nature into the opening engine; fixed-asset acquisition
   fields; employees under the payroll PII discipline; price lists;
   contracts onto `crm.service_contracts`; budgets onto the PHASE-028
   period grid).
2. **Column-mapping wizard** (the FD-18 wizard leverage per roadmap §6.3):
   file preview, header auto-detect heuristics, manual mapping with type
   hints, per-row typed AR + EN errors, and the DRY-RUN → COMMIT gate —
   BR-066: atomic per run, no partial commits (the PHASE-028 XLSX
   discipline generalized).
3. **Saved mappings** (`import_mappings`) — **extended to export templates
   by v3.1 (L1-21, CR-46)**: tenant-scoped named column maps reusable
   across files and future imports (kind, column map jsonb, options), now
   also serving the **export direction** — saved export templates (entity,
   column selection, format, filters) so recurring extracts (bank-feeds
   handoffs, accountant packs, partner file exchanges) run one-click with
   consistent shape.
4. **Migration adapters** (IN-26): Excel generic + QuickBooks-shaped
   (chart/accounts, customers/vendors, items, open invoices/bills) +
   Odoo-shaped (COA, partners, products) extract templates with DOCUMENTED
   column mappings — extract-then-import tooling; the live inter-ERP
   bridge (IN-27) stays out.
5. **Demo-data loader** (TB-19/TB-20): one-click realistic seeds per
   industry template (all 13 shipped templates) — partners, items,
   documents, and journals POSTED THROUGH THE POSTING ENGINE so reports and
   dashboards light up with real GL data; idempotent re-run.
6. **Sandbox tenants** (OA-05): platform-plane provisioning of a time-boxed
   SANDBOX tenant — template + demo data, flagged SANDBOX, quota-capped,
   never a consolidation member.
7. **Error reports**: typed per-row AR + EN errors with export; the dry-run
   guarantee is zero writes (journal and entity counts byte-identical
   before/after).
8. **Onboarding integration**: the wizard surfaces inside tenant
   onboarding and a `/settings/imports` hub listing kinds, saved mappings,
   and adapter templates.

Out of scope: live inter-ERP bridge (IN-27) · transactional-history import
beyond opening balances (documented boundary) · tenant backup/restore and
full data export tooling (059) · done-for-you migration services · public
API-based imports (055).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | planned — the v3.0 entry phase; hard ordering rule (roadmap §5: 035 ships first) |
| Import engine + XLSX dry-run discipline + 13 industry templates baseline | delivered with the 34-phase baseline (`items.import_export` grant repaired by PHASE-035) |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

No hard ordering binds this phase inside Wave 1 (siblings may run in
parallel); cumulative counters assume the sequential lineage
035 → 036 → … → 040. The BUDGETS import kind assumes the PHASE-028
budgeting grid is present in the baseline (it is).

## 4. Design Impact

- **Migrations**: `0058_import_toolkit.sql` (journal 57 → 58 — next in
  sequence after PHASE-039's 0057): the RLS'd `import_mappings` table +
  the import-kind enum widening (additive) + the demo-seed marker columns
  on the tenant row; Drizzle journal/spec updated.
- **Entities**: +1 table (ENTITY_CATALOG.md 223 → 224); the enum widening
  and marker columns are additive on catalogued objects.
- **Permissions**: +2 keys — `platform.imports.manage`,
  `platform.demo_data.manage`; zero-drift extended (261 → 263; seed =
  mirror).
- **i18n**: ~140 new AR/EN keys (wizard steps, kind labels, error
  vocabulary, adapter template names, demo-data surfaces); parity gate as
  ever.
- **Reports**: +0 contracts — the toolkit surfaces are settings screens
  and jobs; the import/dry-run artifacts are evidence files, not registry
  reports; REPORT_CATALOG.md unchanged.
- **Feature flags**: +2 keys — `platform.data_migration` (business +
  enterprise, the tier-4 precedent) and `platform.demo_data` (ALL plans —
  a recorded trial-enablement decision in FEATURE_CATALOG.md); sandbox
  tenant provisioning is platform-plane (never plan-gated — the
  platform.payouts precedent).
- **Rules**: BR-066 (an import commits only after a clean or
   explicitly-acknowledged dry-run, atomically — no partial commits, no
   mid-run residue) appended to BUSINESS_RULES.md (numbering continues
   from BR-065 shipped with PHASE-039).
- **Docs**: the per-adapter mapping documents (QuickBooks-shaped, Odoo-
  shaped, Excel-generic) · ENTITY_CATALOG.md (+1) · FEATURE_CATALOG.md
  (+2) · DATA_DICTIONARY.md (import kinds + mapping shape) ·
  NAVIGATION_MODEL.md (+ the imports hub) · the onboarding guide update.
- **Sync surface (CR-36 g)**: imports run online in the back office; the
  synced entities refresh through the existing feed projections after
  commit — offline write surfaces N/A-recorded.
- **Performance (OA-06)**: EXPLAIN-verified bulk paths — the dry-run
  validation scan and the commit's batched inserts (statement batching,
  bounded memory at 100k-row fixtures); command-palette entries for the
  imports hub (OA-04).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migration `0058` (`import_mappings` + enum widening + demo markers) + Drizzle journal/spec | api |
| T-02 | Import-kind validators for the seven new kinds (typed row rules, AR+EN error packs) | api |
| T-03 | Generalized dry-run → commit engine (BR-066 atomicity, zero-write dry-run proof, batching) | api |
| T-04 | Column-mapping wizard API (preview, auto-detect heuristics, saved mappings CRUD) | api |
| T-05 | QuickBooks-shaped + Odoo-shaped + Excel-generic adapter mapping documents + template files | docs |
| T-06 | Demo-data loader: per-template realistic seeds posted through the posting engine, idempotent | api |
| T-07 | Sandbox tenant provisioning (OA-05): platform-plane flow, SANDBOX flag, quotas, time-boxing | api |
| T-08 | `/settings/imports` hub + wizard screens (12-template discipline, RTL, error exports) | web |
| T-09 | Onboarding flow integration (activity-selection wizard links to the import hub) | web |
| T-10 | Import specs: per-kind round-trips, injected-error batteries, dry-run negative ledger proof | api |
| T-11 | Demo-data specs: 13-template one-click coverage, idempotent re-run, dashboards non-empty | api |
| T-12 | Sandbox isolation specs + docs wave + full gates + evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migration 0058 applies cleanly; `import_mappings` is RLS'd; Drizzle +
   ENTITY_CATALOG.md parity (224 rows); the enum widening is additive with
   zero reshape of existing import rows.
2. Each of the seven new kinds round-trips: map → dry-run (ZERO writes —
   journal and entity counts byte-identical before/after) → injected
   errors surface as typed AR + EN per-row failures → fix → commit →
   verified entity/GL effects. Recorded for all seven kinds.
3. ACCOUNT_OPENING_BALANCES imports pass the balanced-by-nature check and
   land through the existing opening engine (no journal bypass — the
   negative ledger proof holds around every commit).
4. Saved mappings: a mapping created for one file is reused on a second
   file of the same shape with zero re-mapping (Playwright trace).
5. Adapter evidence: the QuickBooks-shaped and Odoo-shaped fixture files
   import end-to-end through their DOCUMENTED mappings (the mapping
   documents are the contract — a mismatch fails the spec).
6. BR-066 atomicity: a commit interrupted mid-run (injected failure at a
   row threshold) leaves ZERO partial state; re-run converges.
7. Demo-data loader: one click seeds each of the 13 industry templates
   with realistic data — journals posted through the posting engine,
   reports and dashboards non-empty, re-run idempotent (zero duplicate
   rows).
8. Sandbox tenants (OA-05): provisioning creates a flagged, quota-capped,
   time-boxed SANDBOX tenant that is never a consolidation member and is
   invisible to cross-tenant attack probes (the A-suite battery).
9. House gates green (CR-36): RLS A1–A10 for `import_mappings` ·
   typecheck · lint · unit · `docs:validate` · i18n parity (~140 keys) ·
   permissions drift 261 → 263 · EXPLAIN budgets for the bulk paths.
10. Completion report `docs/implementation/phases/reports/PHASE-040-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive
    delivered as `ERP_PLATFORM_PHASE040.zip` (OA-07).

## 7. Risks and Constraints

- **Opening-balance integrity** — a bad COA/balance import can corrupt the
  books; mitigated by the dry-run zero-write gate, balanced-by-nature
  validation, the opening engine's own checks, and BR-066 atomicity.
- **PII in employee imports** — national IDs and salary data flow through
  files; mitigated by the payroll PII discipline (masked exports,
  audit-event reads) applied to the EMPLOYEES kind's error reports and
  logs.
- **Demo data polluting real books** — mitigated by the loader being
  explicitly invoked, idempotent, clearly flagged, and sandboxed for demo
  tenants; a tenant with posted real documents refuses demo seeding
  (typed rejection).
- **Adapter mapping drift** — QuickBooks/Odoo exports vary by version and
  locale; mitigated by versioned mapping documents, the wizard's manual
  override for every column, and REQUIRES_VERIFICATION flags on
  ambiguous columns.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-040-COMPLETION.md`
  (evidence per acceptance criterion, the seven round-trip traces, the
  adapter fixture runs, the demo-data coverage matrix, gate output).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-040 row → COMPLETE;
  `NEXT_ACTION.md` → next eligible phase PHASE-041 (Communications Hub)
  with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE040.zip`
  (OA-07); the owner continues with «ابدأ تنفيذ المرحلة PHASE-041».
- Handoff notes for PHASE-041: none binding (parallel-safe sibling); the
  demo-data loader and sandbox tenants become the default substrate for
  sales demos of the communications features.
