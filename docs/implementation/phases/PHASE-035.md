# PHASE-035 — Activation & Truth Restoration

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 1 / Stage 12 · **Register:** [CR-05](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/PROJECT_EVALUATION_2026-11-10.md](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md) §5.2/§9 · [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) H-17/H-18

## 1. Phase Overview

- **Phase ID:** PHASE-035
- **Title:** Activation & Truth Restoration (التنشيط واستعادة صدق التوثيق)
- **Objective:** Close the audit's **activation defects** — fully-built features that no
  tenant can see or reach — and restore the **documentation truth ledger** so that every
  claim in `docs/` is backed by code. This is deliberately the FIRST v3.0 phase because
  it is small, high-leverage, and de-risks every later phase: implemented surfaces become
  reachable (`items.import_export` grant, consolidated-reports nav, batch/serial screens),
  silent deviations become either code or recorded decisions (scheduled reports,
  customer-portal classification, `platform.payouts`), the report catalog is reconciled
  to the real 85-contract registry, and the stale planning documents
  (`CURRENT_STATE`/`NEXT_ACTION`/counts) are refreshed to the delivered 34-phase reality.
- **Business value:** For ~10% of one phase's effort, three whole screens become
  reachable, one missing report ships, and the project's celebrated
  "engineering honesty" discipline (audit §2 point 5) is restored after the audit
  found three claims-without-code (F-5/F-7/F-9). Sales demos stop hitting dead ends
  (consolidated reports for template-less tenants; import/export for business plans).
- **الملخص التنفيذي (AR):** أول مراحل الموجة الأولى وأصغرها: تُفعَّل شاشاتٌ جاهزةٌ
  لا يصل إليها أحد (منح `items.import_export`، تسجيل «القوائم الموحدة» في التنقّل،
  شاشات الدفعات/التسلسل/الصلاحية)، يُسلَّم تقرير سجل الفوترة الإلكترونية الناقص،
  وتُحسم ثلاثة «انحرافات صامتة» بقرارٍ موثَّق (التقارير المجدولة، بوابة العملاء،
  `platform.payouts`)، ثم يُستعاد صدق الوثائق بالكامل (الكتالوج 85، الأعداد
  الحقيقية، إخراج المخرجات المولَّدة من المستودع).

## 2. Scope

In scope:

1. **Inventory batch/serial/expiry screens** (EVAL-F-1, I-16/I-18 surface side): new web
   surfaces `/inventory/batches`, `/inventory/serials`, and the expiry-alert list — the
   backing API (`GET/POST /inventory/batches`) already exists per the audit. Screens
   follow the 12-template screen discipline (AR/EN parity, RTL, empty/loading states,
   ⌘K registration). No new API work unless a gap is found during implementation
   (any found gap is recorded, minimal, and in-scope).
2. **Inventory adjustments surface** (EVAL-F-2): a dedicated `/inventory/adjustments`
   list surface over the existing adjustment journal flow (currently reachable only
   through stock counts) — read surface + filtered navigation entry; posting stays where
   it is (design-intent preserved, documentation updated to match).
3. **Consolidated reports navigation** (EVAL-F-3): register `reports.consolidated` in
   `NAV_ITEMS` (group `reports`) so template-less tenants see «القوائم الموحدة» —
   the audit proved the 5 pages exist but only render via template-injected nav.
4. **`items.import_export` grant repair** (EVAL-F-5 / H-18): one DATA-ONLY migration
   (0048, following the 0044/0046/0047 convention) granting the feature to
   `business` + `enterprise` plans; navigation visibility re-verified for all plans.
5. **`tax.e-invoicing-log` report contract** (EVAL-F-6): the documented-but-missing 86th
   report contract via `defineReport` — e-invoicing submission log over the existing
   e-invoicing tables; registered in `REPORT_CATALOG.md`.
6. **Silent-deviation resolution records** (EVAL-F-7/F-8/F-9): three decision records
   under `docs/decisions/product/`:
   - `DR-035-01` — scheduled reports (`reporting.scheduled_reports`): either
     re-classified DEFERRED-to-PHASE-057 with the grant key preserved, or a minimal
     scheduler shipped here (owner call at implementation time; default = record,
     implement in 057).
   - `DR-035-02` — customer portal (`S-20`): classified as PLANNED PHASE-060 (was
     unclassified "priority 3" with no DEFERRED marker).
   - `DR-035-03` — `platform.payouts`: classified DEFERRED-to-PHASE-059 with its
     documented "SHIPPED PHASE-023" claim corrected.
7. **Report catalog reconciliation** (audit §7): `REPORT_CATALOG.md` updated to the true
   85(+1) contract set — the 7 unlisted contracts added
   (`inventory.reorder-alerts`, `manufacturing.*` ×3, `sales.daily-revenue`,
   `services.*` ×2) and counts corrected everywhere (66/80 → 85/86).
8. **Planning-document truth refresh** (audit §9.ج items 8–13): `CURRENT_STATE.md`,
   `IMPLEMENTATION_STATUS.md` intro counts, `NEXT_ACTION.md` (rewritten to point at
   PHASE-035 as the next eligible phase with the v3.0 program pointer), stale
   "PHASE-026 next" text removed; code-comment statistics policy recorded
   (no volatile counts in comments — lint rule added if cheap).
9. **Repository hygiene** (audit §9.ج item 14): `packages/ui/dist-storybook`,
   `__image_snapshots__`, `.playwright-artifacts` removed from Git tracking and added
   to `.gitignore` (regeneration documented in README/dev docs).
10. **Contextual-route documentation** (EVAL-F-4): `/security`, `/checkout`,
    `/onboarding`, `/offline` confirmed as intentional contextual flows in
    `NAVIGATION_MODEL.md` (documentation-only, no code).

Out of scope: scheduled-reports implementation (057) · customer-portal implementation
(060) · payouts implementation (059) · ZATCA QR (037) · any new API modules · any
schema change beyond the 0048 grant migration.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-034 (consolidation) COMPLETE | ✅ delivered 2026-11-09 |
| Delivery completion (rental_logistics + marketing landing) | ✅ in the delivered archive |
| v3.0 planning artifacts (register + roadmap + this document) | ✅ authored 2026-11-10 |

No code prerequisites beyond the delivered 34-phase baseline. This phase is the
entry point of Blueprint v3.0.

## 4. Design Impact

- **Navigation** (`apps/web` navigation registry): +3–4 items (batches, serials,
  adjustments, consolidated-reports).
- **Migrations**: `0048_items_import_export_grant.sql` (DATA-ONLY; journal 47 → 48;
  Drizzle `_journal.json` + `migrations.ts/spec` updated per house convention).
- **Report registry**: +1 contract (`tax.e-invoicing-log`) → registry 85 → 86;
  `REPORT_CATALOG.md` reconciled (+7 unlisted rows, counts corrected).
- **Permissions**: no new permission keys (screens ride existing
  `inventory.batch_tracking` / `serial_tracking` capabilities); zero-drift check
  re-run and must stay 245 = 245.
- **i18n**: new AR/EN dictionary keys for the three screens (~40–60 keys); parity
  check extended (4,186+n = 4,186+n).
- **Docs**: decision records ×3 · `CURRENT_STATE` / `NEXT_ACTION` / `REPORT_CATALOG` /
  `NAVIGATION_MODEL` / `IMPLEMENTATION_STATUS` updates · `.gitignore` change.
- **No architectural change** — no new ADR required (all changes are within decided
  patterns; CR-36 gates apply).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migration `0048` (items.import_export → business+enterprise grants) + journal/spec updates | api |
| T-02 | Build `/inventory/batches` screen (list + create + cancel/scrap actions) over live API | web |
| T-03 | Build `/inventory/serials` screen (serial ledger + status + sold-at view) | web |
| T-04 | Build `/inventory/adjustments` read surface + nav wiring | web |
| T-05 | Register `reports.consolidated` + new screens in `NAV_ITEMS`; verify visibility per plan | web |
| T-06 | Implement `tax.e-invoicing-log` `defineReport` contract + tests + catalog row | api |
| T-07 | Author decision records DR-035-01/02/03 and correct the three stale claims | docs |
| T-08 | Reconcile `REPORT_CATALOG.md` (add 7 unlisted, fix counts everywhere) | docs |
| T-09 | Truth-refresh `CURRENT_STATE` / `NEXT_ACTION` / `IMPLEMENTATION_STATUS` intro; add comment-statistics policy | docs |
| T-10 | Repository hygiene: untrack generated artifacts, extend `.gitignore`, document regeneration | repo |
| T-11 | Run full local gates (typecheck/lint/tests/docs/i18n parity/permissions drift) and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migration `0048` applies cleanly; `items.import_export` granted on business+enterprise;
   the `/inventory/import` screen becomes visible in the sidebar for those plans
   (Playwright navigation assertion).
2. `/inventory/batches` and `/inventory/serials` render with AR/EN parity, RTL, loading
   and empty states; create/cancel flows post successfully against the live API
   (integration test); navigation entries respect feature gating.
3. `/inventory/adjustments` lists adjustment journals with filters; no posting path
   added (design intent preserved and documented).
4. `reports.consolidated` appears in the sidebar for a **template-less tenant** (the
   audit's F-3 scenario) and navigates to the existing 5 consolidation pages.
5. `tax.e-invoicing-log` contract registered; report renders over seeded e-invoicing
   data; `REPORT_CATALOG.md` lists 86 contracts and every registry key has a catalog row
   (a new `scripts/` check may be added: catalog ↔ registry reconciliation).
6. Decision records DR-035-01/02/03 exist and are linked from the corrected claims;
   grep proves no stale "SHIPPED PHASE-025 scheduled reports" / "SHIPPED PHASE-023
   payouts" text remains uncorrected.
7. `CURRENT_STATE` / `NEXT_ACTION` / `IMPLEMENTATION_STATUS` show the 34-phase reality,
   the v3.0 program pointer, and PHASE-035 as the active phase.
8. `git status` proves dist-storybook/snapshots/playwright-artifacts are untracked;
   `.gitignore` covers them; docs describe regeneration.
9. All house gates green: typecheck · lint · boundaries · unit tests · `docs:validate`
   (29/29 + new v3.0 check 8) · i18n parity · permissions drift 245 = 245 · manifests
   13/13.
10. Completion report `reports/PHASE-035-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE035.zip`.

## 7. Risks and Constraints

- **Grant migration vs plan metering** — the grant must follow the plan-entitlement
  convention (DATA-ONLY, no code path): mitigated by reusing the 0044/0046/0047 pattern
  exactly.
- **Screen/API drift** — the audit confirmed the API exists; if implementation finds
  drift (it wrote its numbers from static reading), the delta is recorded and the
  minimal fix is in-scope; anything beyond minimal escalates to the owner.
- **Truth edits may cascade** — correcting counts in one doc can desync another;
  mitigated by running `docs:validate` + a grep sweep for the stale numbers (66/80/2328)
  as an acceptance criterion.
- **Untracking artifacts could break CI expectations** — if a workflow expects the
  committed artifacts, the workflow is updated in the same change (CI files are code).

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-035-COMPLETION.md`
  (evidence for each acceptance criterion, local gate output, the three decision
  records, the catalog reconciliation table).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-035 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase PHASE-036 (Extensibility Core) with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE035.zip` (OA-07) and handed
  to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-036».
- Handoff notes for PHASE-036: the batch/serial screens shipped here become the first
  consumers of custom-field surfacing; their entity lists are the exemplar fixtures.
