# PHASE-062 — UX Excellence & Document Design

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 4 / Stage 15 · **Register:** [CR-32](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) TB-01…TB-18 · TB-22 · TB-34 · FD-01…FD-17 · FD-21…FD-29 · FD-34/FD-35 · H-23 · UX-02…UX-09 · UX-11…UX-18 · PP-01…PP-10 · PP-13/PP-14 · PP-18/PP-19 · PP-29…PP-34 · [gap-analysis/PROJECT_EVALUATION_2026-11-10.md](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md) §5.1 (shipped surfaces stay prerequisites per CR-04) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.3

## 1. Phase Overview

- **Phase ID:** PHASE-062
- **Title:** UX Excellence & Document Design (تميّز التجربة وتصميم المستندات)
- **Objective:** Close the single largest cluster of the audit's UX findings — table stakes
  TB-01…TB-18/TB-22/TB-34, functional depth FD-01…FD-17/FD-21…FD-29/FD-34/FD-35, polish
  PP-01…PP-10/PP-13/PP-14/PP-18/PP-19/PP-29…PP-34, UX-02…UX-09/UX-11…UX-18, and H-23 — so
  that the depth delivered through PHASE-061 feels excellent to use daily: app-wide dark
  mode from the Storybook-only design tokens (TB-01); the white-label theming the audit
  called the biggest wasted revenue opportunity (TB-03); bulk actions, column chooser,
  saved views, and unified server-side pagination on every list (FD-01…FD-06); tabbed
  entity cards with a related-records graph, KPI chips, a record timeline over the
  existing `audit_events`, comments with mentions, and a unified attachments panel
  (FD-11…FD-17); the tenant print-template designer incl. the missing payslip template,
  watermarks, batch print, reprint-with-reason, and barcode labels (FD-21…FD-29, UX-18);
  ⌘K expanded from partners/items-only to all entities plus the realtime WebSocket channel
  and the PWA shell (TB-05, TB-12, TB-02); the guidance layer — tours, the onboarding
  refresh, help center, changelog, report-a-problem (TB-15…TB-18, TB-22, FD-34); and the
  platform locales framework (H-23), the Arabic-Indic numeral groundwork (OA-01), and the
  iOS client (UX-11 — the deferred delivery decision is honored by shipping it here).
- **Business value:** The audit's commercial framing is direct: white-label theming is the
  «biggest wasted revenue opportunity» — no reseller channel without it (PHASE-065 builds
  on it); 60% of free trials fail without onboarding (TB-15); one user in three asks for
  dark mode (TB-01); and every customer's logo request is today a code change
  (FD-21/FD-22). This is also Wave 4's substrate phase: 063 renders Hijri, Tafqeet, and
  Arabic-Indic numerals through these surfaces; 064 delivers copilot answers and notices
  through the realtime channel; 065 builds partner white-label, campaigns, and the public
  changelog feed on this phase's tables.
- **الملخص التنفيذي (AR):** أوسع مراحل البرنامج وأكثرها ملموسةً للمستخدم اليومي: يُطلق
  الوضع الداكن في التطبيق كاملاً (رموزه في Storybook فقط اليوم)، ثم هوية المستأجر
  البيضاء (الشعار والألوان وشاشة الدخول) مقيدة بالخطط، وإطار الإجراءات الجماعية
  مع تقدّمٍ حيّ وتراجعٍ آمن حيث يجوز، ومُختار الأعمدة وطرق عرضٍ محفوظة لكل مستخدم
  وترقيم صفحات موحّد على الخادم؛ وبطاقات كيانات بتبويبات مع رسم العلاقات وشرائح
  المؤشرات وسجلّ نشاطٍ من `audit_events` وتعليقاتٍ بذِكر المستخدمين ولوحة مرفقات
  موحّدة؛ ثم مصمّم قوالب الطباعة (ومنها قالب كشف الراتب) والعلامات المائية
  والطباعة الجماعية وسجلّ أسباب إعادة الطباعة وملصقات الباركود؛ وتوسيع ⌘K إلى كل
  الكيانات مع إشعارات فورية وغلاف PWA؛ ثم الجولات التعريفية ومعالج «أول عشر دقائق»
  ومركز المساعدة وصفحة «ما الجديد» وزر الإبلاغ عن مشكلة؛ وأخيراً إطار اللغات
  الإضافية، وتأسيس الأرقام العربية الهندية، وتسليم عميل iOS عبر TestFlight —
  تنفيذاً للقرار المؤجَّل لا إلغاءً له.

## 2. Scope

In scope:

1. **Theming** (TB-01, TB-03, TB-13, UX-05, UX-06, UX-17, PP-14):
   - App-wide **dark mode**: the design tokens already exist in Storybook — surface them in
     `apps/web`: theme toggle, per-user persistence (`user_ui_preferences.theme`), instant
     switch; prints always render paper-light. WCAG AA contrast in both modes — the token-
     contrast check becomes a blocking CI gate (TB-13).
   - **White-label theming, plan-gated**: `tenant_branding` (logo, brand colors,
     login-screen configuration) under `platform.branding.manage` — applied to the login
     screen, app chrome accent, and the designer's print templates; non-entitled plans
     cannot enable it (CR-36 f).
   - **Deep personalization** (UX-17, PP-14): density/compact mode, default landing page
     per role, sidebar ordering — persisted in `user_ui_preferences`.
2. **List operations** (FD-01…FD-10, PP-19, PP-32, PP-33, PP-34):
   - **Bulk-actions framework** (FD-01): row selection exposes only the operations the
     user is permitted on **every selected row** (per-row permission re-check — no bulk
     privilege escalation); execution runs server-side as `bulk_operations` jobs with live
     progress (PP-32) and **undo where safe** (FD-10) — undo composes the house
     reversal-only pattern, never mutating posted rows.
   - **Column chooser** (FD-02) · **saved views/filters per user per list** (`saved_views`,
     FD-03) · **export from the list itself** (FD-04).
   - **Unified server-side pagination pattern** (FD-05) across all lists with a per-list
     performance budget verified on the largest seeded set (OA-06); **multi-column sort and
     filter** in one interaction pattern (FD-06).
   - **Quick row actions** hover menu (FD-07) · **copy-document-as-template** and
     duplicate-with-edits (FD-08, PP-19) · **autosave drafts** — local first, then
     server-side persistence (`document_drafts`, FD-09, PP-34) · **idempotency UI**
     double-submit guard (PP-33).
3. **Entity depth** (FD-11…FD-17, PP-01…PP-10, PP-18, A-13):
   - **Tabbed entity cards** for partner, item, invoice, and the other core entities (FD-11).
   - **Related-records graph panel** (FD-12): customer → invoices → returns → cheques in
     one navigable panel; **KPI chips on entity cards** (FD-13): balance · overdue days ·
     last payment for a customer; on-hand · turnover for an item.
   - **Record timeline + comments** (FD-14, PP-04, FD-15, FD-16): a per-record surface
     rendering the existing `audit_events` — no new audit mechanism, only the missing
     screen — plus `record_comments` with @mentions that notify through the realtime
     channel; visibility follows the record's permissions.
   - **Unified attachments panel** (FD-17): one surface over the existing `file_objects`
     for every entity, with ECM-style folders and versions (the A-13 reading shared with
     the 053 accounting-depth ECM surfaces).
   - **The accountant polish pack** (PP-01…PP-10): journal entry card (PP-01 — the shipped
     pre-save check PP-02 stays as-is); post preview completion (PP-03); period compare
     (PP-05); outlier highlighting (PP-06); what-if preview (PP-07); a deterministic entry
     narrative from the source documents (PP-08 — its AI-assisted extension is PP-16 in
     PHASE-064); closing checklist (PP-09); books health panel (PP-10); recently-changed
     row highlight (PP-18).
4. **Print & document design** (FD-21…FD-29, UX-18):
   - **Tenant print-template designer** (`print_templates`, FD-21, FD-22, UX-18): logo,
     brand colors, and section layout per document type — invoice, receipt, cheque,
     statement, and the **payslip template** the audit found missing (FD-23); templates
     render through the existing print pipeline, never beside it.
   - **Watermarks + DRAFT stamps** (FD-24) · **batch print** (FD-25) · **reprint-with-reason
     log** (`print_events`, FD-26) · **PDF export for any document** (FD-27) · **real
     QR/barcode in templates** building on PHASE-037's scannable QR (FD-28) · **barcode
     label designer + printing** (`barcode_label_templates`, FD-29).
5. **Search & realtime** (TB-02, TB-05, TB-06, TB-07, TB-12, UX-07, UX-08, UX-09, PP-13,
   PP-29, PP-30, PP-31, DF-13):
   - **Global search expansion** (TB-12, UX-08, OA-04): ⌘K reaches invoices, journal
     entries, documents, and reports — not only partners and items; the command palette is
     an audit §21 "do not touch" surface — **extended, never rewritten**.
   - **Realtime notification channel** (TB-05, UX-07): WebSocket with presence; records
     persist in `notifications`; a polling fallback keeps the app functional behind
     restrictive proxies; **long-operation notifications** (PP-31) and the attention-today
     digest (PP-13, riding the PHASE-041 channel substrate).
   - **Last-updated indicators** on every screen (PP-29) · **resume-after-reconnect** (PP-30)
     · **user-visible integration logs** (UX-09).
   - **PWA manifest + service worker shell** (TB-02, DF-13): installable app shell with an
     offline landing page — the deep-offline story remains the sync clients; the PWA is the
     shell, not a second offline engine.
6. **Guidance** (TB-15…TB-18, TB-22, UX-02, UX-03, UX-04, UX-15, UX-16, FD-34, FD-35):
   - **Product tours** — step-by-step spotlight overlays (TB-16).
   - **Onboarding wizard refresh** (TB-15): the shipped activity-selection wizard (CR-04)
     is extended — never re-implemented — with a first-10-minutes checklist
     (`onboarding_checklist_states`): create an item, post an invoice, run a report.
   - **In-app help center + contextual help widget** (TB-17, UX-03, UX-15) and the user
     guide (TB-18, UX-04) — text-first; academy videos (UX-16) stay an optional follow-up
     noted for PHASE-065. **In-app changelog** (`changelog_entries`, TB-22) is later exposed
     as the public feed by PHASE-065.
   - **Report-a-problem button** attaching screen and context (`problem_reports`, FD-34) ·
     **slow-query warning affordance** (FD-35).
   - Skeleton/prefetch and directed empty-state unification (TB-06, TB-07) · full keyboard
     support for forms (TB-14) · published WCAG AA accessibility statement (TB-13) · the
     **in-app** reading of UX-02 (settings and login links to Terms/Privacy; the public
     pages complete in PHASE-065).
7. **Platform locales framework & client reach** (H-23, TB-08, TB-34, UX-11, UX-12, OA-01):
   - **Pluggable additional locales** (H-23): `locale_packs` — translation packs live
     **outside the code** as installable data; AR/EN stay canonical (the parity rule remains
     AR/EN-only, documented); Urdu/French are the substrate examples — RTL preserved (TB-08),
     LTR proven by the French example.
   - **Arabic-Indic numeral display groundwork** (OA-01): the per-user preference flag
     (`user_ui_preferences.numerals`) is stored here; rendering completes in PHASE-063.
   - **iOS client delivery** (UX-11): an Expo iOS target over the existing mobile API
     surface, a TestFlight distribution pipeline, and parity tests against the web golden
     flows — the deferred delivery decision is honored by shipping it here; public App
     Store launch remains an owner decision.
   - **Sync-conflict resolution surfaces for offline users** (TB-34): a user-facing
     conflict list over the existing sync conflict records with resolution actions and
     audit (`sync_conflict_resolutions`); sync-fleet harness extended (OA-02).
   - **Customizable form surfaces** (UX-12): user-facing layout preferences layered on the
     PHASE-036 form-designer substrate.

Out of scope: AI copilot, OCR, suggesters, narration, voice (064) · Hijri, Tafqeet, season
planning, Islamic finance, country packs, numerals rendering (063) · referrals, partners,
trust center, public legal pages, self-serve conversion (065) · marketing websites DF-40/42
(kept non-goal) · rewriting the command palette, shortcuts, or the offline sync engine
(audit §21 "do not touch" — extended only) · any new accounting posting behavior.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-036 (Extensibility Core) COMPLETE | hard prerequisite — roadmap §5 edge 036 → 062: custom fields and form-designer layouts surface in the column chooser, entity cards, and personalized forms |
| PHASE-041 (Communications Hub) COMPLETE | hard prerequisite — channel abstraction + per-module notification preferences reused by the realtime layer and the digest |
| PHASE-057 (BI & Analytics) COMPLETE | advisory — the saved-views interaction pattern is kept consistent between lists (here) and reports (057) |
| Stage 12–14 baseline delivered (wave gates per CR-38) | the entity surfaces this phase deepens all exist and are stable |

UX-13 (custom alerts) stays with PHASE-052 and UX-14 with PHASE-041 — consumed, never re-implemented.

## 4. Design Impact

- **Migrations:** the next in sequence after the predecessors' last journal entry (~0120+ at
  planning time; exact numbers bound at implementation start — counts and contents only,
  never fixed journal numbers). Grouped SQL migrations + Drizzle mirrors for ~15 new
  tables: `tenant_branding`, `user_ui_preferences`, `saved_views`, `document_drafts`,
  `bulk_operations`, `record_comments`, `print_templates`, `print_events`,
  `barcode_label_templates`, `locale_packs`, `onboarding_checklist_states`,
  `changelog_entries`, `problem_reports`, `notifications`, `sync_conflict_resolutions`.
- **Entities/catalog parity:** +15 rows in `ENTITY_CATALOG.md` (198 + Σ v3.0 prior + 15);
  every table ships SQL + Drizzle + catalog row (CR-36 a).
- **Permissions:** +8 keys — `ux.print-templates.manage`, `ux.labels.manage`,
  `ux.comments.create`, `ux.comments.moderate`, `ux.bulk-operations.execute`,
  `ux.attachments.manage`, `platform.branding.manage`, `platform.locales.manage`; the
  zero-drift check re-anchors to the running v3.0 total (seed = catalog = matrix).
- **i18n:** the program's largest dictionary extension (~500–700 keys) with strict AR/EN
  parity equality; locale packs are **data, not dictionary keys** — the parity rule stays
  AR/EN-only and this boundary is documented.
- **Reports:** +0 new report contracts — print templates, saved views, and KPI chips
  decorate existing contracts; `REPORT_CATALOG.md` gains no rows.
- **Docs:** `FEATURE_CATALOG.md` (ux + platform.theming) · `ENTITY_CATALOG.md` ·
  `NAVIGATION_MODEL.md` · `AUTHORIZATION_MATRIX.md` · `SUBSCRIPTION_AND_ENTITLEMENTS.md` ·
  the accessibility statement · decision record DR-062-01 (iOS closes the deferral) ·
  `IMPLEMENTATION_STATUS.md`.
- **Feature flags:** `ux.*` and `platform.theming.*` keys, template-composable grants
  (CR-36 f) — `platform.theming.branding` and `platform.theming.locales` are plan-gated
  (OQ-002).
- **Sync/offline assessment (CR-36 g):** saved views, drafts, comments, notifications, and
  sync-conflict resolutions join the offline surface where clients consume them; the iOS
  client runs the extended sync-fleet harness (OA-02).
- **No architectural change** to posting, RLS, decimal discipline, or the audit §21
  invariants; no new goldens/INV/BR rows.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author the grouped migrations (next-in-sequence journal) for all ~15 tables + Drizzle mirrors + `ENTITY_CATALOG.md` rows | api |
| T-02 | Surface design tokens app-wide: dark-mode toggle, per-user persistence, print-always-light, token-contrast check promoted to a blocking CI gate | web |
| T-03 | White-label branding: settings surface, login + chrome + print application, plan gating, deep personalization (density, role landing, sidebar) | web |
| T-04 | Bulk-actions framework: row selection, per-row permission re-check, `bulk_operations` runner with live progress and undo-safe operations | api |
| T-05 | List framework: column chooser, saved views, list export, unified server-side pagination, multi-column sort/filter | web |
| T-06 | Quick row actions, copy-document-as-template, autosave drafts (local + `document_drafts`), idempotency double-submit guard | web |
| T-07 | Tabbed entity cards + related-records graph panel + KPI chips | web |
| T-08 | Record timeline over `audit_events`; comments + @mentions backend and surface; unified attachments panel with folders/versions | api |
| T-09 | Accountant polish pack (PP-01…PP-10, PP-18): entry card, post preview, period compare, outlier highlight, what-if preview, entry narrative, closing checklist, health panel | web |
| T-10 | Print-template designer + payslip template + watermarks/DRAFT stamps + batch print + reprint-with-reason log + document PDF export + QR/barcode in templates + barcode label designer | web |
| T-11 | ⌘K global search expansion to all entities (invoices, journal entries, documents, reports) with permission-scoped results | api |
| T-12 | Realtime notification channel: WebSocket + presence + polling fallback, `notifications` persistence, long-operation notices, attention-today digest; last-updated indicators, resume-after-reconnect, integration logs, PWA shell | api |
| T-13 | Guidance layer: product tours, first-10-minutes onboarding checklist, help center + contextual widget, changelog page, report-a-problem, slow-query affordance, skeleton/empty-state unification, form keyboard support | web |
| T-14 | Locale-pack framework (`locale_packs`, install-from-data, AR/EN canonical rule documented) + numerals preference flag groundwork | api |
| T-15 | iOS client: Expo iOS target, TestFlight pipeline, parity tests against web golden flows, sync-conflict resolution surfaces (TB-34) | mobile |
| T-16 | Docs: FEATURE_CATALOG/ENTITY_CATALOG/NAVIGATION_MODEL/AUTHORIZATION_MATRIX/SUBSCRIPTION_AND_ENTITLEMENTS updates, accessibility statement, DR-062-01 | docs |
| T-17 | Full local gates: typecheck, lint, boundaries, tests, `docs:validate`, i18n parity, permissions zero-drift, RLS attack tests A1–A10 for every new table, sync-fleet harness, evidence recording | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. All ~15 migrations apply cleanly with journal/spec/catalog parity; RLS attack tests
   A1–A10 pass for every new tenant table (CR-36 a, e); pagination budgets recorded (OA-06).
2. Dark mode: toggle + per-user persistence work across reloads; the token-contrast check
   passes WCAG AA in light and dark for every surfaced token; the statement is published.
3. White-label: a plan-gated tenant's logo + brand colors render on the login screen, app
   chrome, and print templates; a non-entitled tenant cannot enable branding.
4. List operations: a 50-row bulk action runs server-side with live progress and a
   reversal-only undo; saved views persist per user per list; pagination verified.
5. Entity depth: the timeline renders `audit_events` for a seeded invoice; an @mention
   comment delivers a realtime notification; attachments show folders and versions.
6. Print design: a tenant edits a template, prints a payslip (FD-23) with a watermark and
   DRAFT stamp; batch print works; a reprint requires a reason logged in `print_events`;
   any document exports to PDF.
7. ⌘K finds invoices, journal entries, documents, and reports — the audit's TB-12 scenario —
   with results scoped to the searching user's permissions; a realtime notification is
   delivered over WebSocket with presence; the PWA installs offline.
8. Locales: AR/EN dictionary parity equality is green for all new keys; a sample Urdu pack
   and a French pack install from data with no code change and render RTL/LTR correctly;
   the numerals preference flag is stored per user (H-23, OA-01).
9. iOS: a TestFlight build passes the parity tests against the web golden flows; a seeded
   sync conflict is listed and resolved through the new surface with an audit record.
10. All house gates green (typecheck, lint, boundaries, unit tests, `docs:validate`, i18n
    parity, permissions zero-drift re-anchored, manifests); completion report
    `reports/PHASE-062-COMPLETION.md` appended; `IMPLEMENTATION_STATUS.md` row flipped;
    archive delivered as `ERP_PLATFORM_PHASE062.zip` (OA-07).

## 7. Risks and Constraints

- **Breadth risk — the largest surface phase of the program** (~15 tables, seven thematic
  groups, a large migration + permission footprint): mitigated by shipping each group as
  an independently flag-gated slice that runs the full CR-36 gates (zero-drift, catalog
  parity) before the next starts, plus the per-row permission re-check in bulk operations.
- **WebSocket + PWA introduce new runtime infrastructure**: mitigated by the polling
  fallback, a feature-flagged rollout, and a notification-channel load test before the
  flag defaults on.
- **WCAG AA under dark mode × white-label brand colors**: mitigated by the token-contrast
  check as a blocking CI gate and brand colors constrained to token slots with an automatic
  accessible fallback (no free-form color).
- **iOS delivery unpredictability** (TestFlight review, device matrix): mitigated by
  making TestFlight — not a public App Store launch — the acceptance bar, with parity
  tests as the gate; public launch remains an owner decision.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-062-COMPLETION.md` — evidence
  per acceptance criterion, per-slice gate output, the accessibility statement, the iOS
  parity matrix, and DR-062-01.
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-062 row → COMPLETE; `NEXT_ACTION.md` → next
  eligible phase PHASE-063 with its prerequisites (PHASE-037, PHASE-045).
- Delivery: repository state archived as `ERP_PLATFORM_PHASE062.zip` (OA-07); the owner
  continues with «ابدأ تنفيذ المرحلة PHASE-063».
- Handoff notes for PHASE-063: the numerals preference flag and the locale-pack substrate
  are consumed there (OA-01 rendering); the print-template designer is where Hijri dates
  and Tafqeet lines render. For PHASE-065: `tenant_branding` and `changelog_entries` are
  the tables its partner program and public changelog build on.
