# PHASE-065 — Growth Platform & Customer Success

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 4 / Stage 15 · **Register:** [CR-35](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) DF-36…DF-50 · TB-26…TB-30 · UX-16 · [gap-analysis/PROJECT_EVALUATION_2026-11-10.md](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md) §5.1 (shipped subscription/billing + checkout stay prerequisites per CR-04) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.3

## 1. Phase Overview

- **Phase ID:** PHASE-065
- **Title:** Growth Platform & Customer Success (منصة النمو ونجاح العملاء)
- **Objective:** Close the program's final gap family — the growth loop the audit found
  entirely absent (DF-36…DF-50: «referral program: zero», «partner program: zero», «no
  health score», «MRR/ARR/churn: zero», «product analytics: usage counters for metering
  only», «in-app messaging: zero»). Concretely: **referrals** (`referral_codes` +
  attribution + reward credits applied to subscription invoices); a **partner/reseller
  program** (`partner_accounts` with margin %, attributed sub-tenants, commission
  statements) leveraging the PHASE-062 white-label theming, with a partner portal that
  shows tenant status and **no tenant data without consent**; **product analytics**
  (privacy-scrubbed `usage_events`, health scores from login cadence + module breadth +
  support signals, feature-adoption dashboards); **revenue visibility** (MRR/ARR/churn/
  cohorts on the platform plane from the existing subscription/billing data); **in-app
  messaging** (targeted announcement campaigns segmented by plan/usage/locale + a tips
  engine); the **trust & legal layer** (public trust center with placeholder-honest
  compliance badges, the legal document library — Terms/DPA/SLA/AUP completing UX-02 on
  the public side, a feature-request voting board, and the public changelog feed reusing
  the PHASE-062 table); and **self-serve conversion** (trial-expiry nudges, a
  self-upgrade checkout path extending the shipped `/checkout`, and a
  sandbox-to-paid migration wizard over the PHASE-059 sandbox tenants). Completing this
  phase satisfies the **Stage-15 «differentiated» wave gate** (CR-38) and closes
  Blueprint v3.0.
- **Business value:** The audit calls white-label-partner economics «the biggest wasted
  revenue opportunity» — this phase is where that opportunity becomes a channel: resellers
  sell under their brand, attributed tenants are measured, and commissions are computed;
  health scores and adoption telemetry turn churn into an observable, actionable signal
  instead of a surprise; MRR/ARR/cohorts give the owner real revenue instrument panels;
  and the trust/legal layer removes the procurement blockers (DPA/SLA requests) that stall
  mid-market deals. Self-serve conversion shortens the sales cycle for the long tail.
- **الملخص التنفيذي (AR):** آخر مراحل المخطط وإغلاقٌ لحلقة النمو الغائبة كلياً وفق
  التدقيق: نظام إحالة ب رموز إسناد ورصيد مكافآت يُطبَّق على فواتير الاشتراك؛ وبرنامج
  شركاء/موزعين بحسابات هوامش ومستأجرين مُسندَين وكشوف عمولة، يبني على الهوية البيضاء
  من المرحلة 062، مع بوابة شريك تُظهر حالة مستأجريه دون أي وصول لبياناتهم إلا بموافقتهم؛
  وتحليلات منتج من حدث استخدام منقّى الخصوصية، ودرجات صحة العملاء من إيقاع الدخول
  واتساع الوحدات وإشارات الدعم مع رايات خطر؛ ولوحات إيراد MRR/ARR/التسرّب/الفوجات على
  مستوى المنصة من بيانات الاشتراك والفوترة الموجودة؛ ومراسلة داخلية بحملات إعلانات
  موجَّهة بالخطة والاستخدام واللغة ومحرّك نصائح؛ ثم طبقة الثقة والقانون: مركز ثقة عام
  بشارات امتثال صادقة كعناصر مؤقتة حتى الدليل، ومكتبة الوثائق القانونية (الشروط/DPA/
  SLA/AUP) مكمّلةً UX-02 جهة الجمهور، ولوحة تصويت على الميزات، وتغذية سجل تغييرات عامة
  من جدول المرحلة 062؛ وأخيراً تحويل الخدمة الذاتية: تنبيهات انتهاء التجربة، ومسار
  ترقية ذاتي يوسّع `/checkout` الموجود، ومعالج ترحيل من الحمايات التجريبية إلى المدفوع.

## 2. Scope

In scope:

1. **Referrals** (DF-36, DF-43): `referral_codes` with attribution (code → signup →
   tenant), and **reward credits** (`reward_credits`) applied to subscription invoices
   through the existing billing engine — credits are balance rows with an application
   log, never price-table mutations.
2. **Partners/resellers** (DF-37): `partner_accounts` (margin %, attributed sub-tenants,
   status) and `partner_commission_statements` (period, attributed revenue, margin,
   commission); the program **leverages the PHASE-062 white-label** theming (partner-branded
   login/chrome for attributed tenants where the plan allows); a **partner portal
   surface** showing their tenants' status (plan, health flag, lifecycle stage) with
   **no tenant data access without recorded consent** — the portal reads platform-plane
   aggregates only; commissions are statements, not payouts (payout execution remains
   with the platform operator per CR-29's deferred-payouts decision).
3. **Product analytics** (DF-44, DF-46, DF-47; TB-26…TB-30 growth-plane readings): 
   - `usage_events` — feature-adoption telemetry, **privacy-scrubbed by construction**
     (a documented event vocabulary; no free text, no record payloads, no user content).
   - **Health scores**: login cadence + module breadth + support signals → a per-tenant
     score with risk flags (`customer_health_scores`), surfaced to the owner and — in
     aggregate — to the partner portal.
   - **Feature-adoption dashboards** over the event stream (which modules, which plans,
     which locales).
4. **Revenue visibility** (DF-45): MRR/ARR/churn/cohorts dashboards on the **platform
   plane**, computed from the existing subscription/billing data — no new billing
   mechanics, only the missing instrument panels (with a reconciliation check tying
   dashboard MRR back to the subscription invoices).
5. **In-app messaging** (DF-48): targeted **announcement campaigns**
   (`announcement_campaigns`) segmented by plan/usage/locale, delivered through the
   PHASE-062 notification substrate and in-app surfaces; a **tips engine** (contextual
   one-line guidance triggered by usage signals, distinct from the 062 help center).
6. **Trust & legal** (DF-49, DF-50, TB-28…TB-30, UX-02 public completion, UX-16 note):
   - **Public trust center**: security posture, sub-processors, uptime link to the 059
     status page, and **compliance badges placeholder-honest** — no badge is shown
     without evidence; placeholders are labeled as planned, preserving the honesty
     discipline (TB-30).
   - **Legal document library pages**: Terms, DPA, SLA, AUP — bilingual public pages
     (UX-02 completion on the public side; the in-app links shipped with PHASE-062).
   - **Feature-request voting board** (`feature_requests`, `feature_request_votes`) with
     a public roadmap view (TB-28).
   - **Public changelog feed** reusing the PHASE-062 `changelog_entries` table through a
     public read-only view (TB-29).
   - Academy videos (UX-16) remain an **optional** content follow-up — noted, not
     committed (content production is an owner decision, not a platform gap).
7. **Self-serve conversion** (DF-43): trial-expiry nudges (scheduled, through the
   announcement engine); a **self-upgrade checkout path extending the shipped
   `/checkout`** flow (CR-04 — extended, never re-implemented); a
   **sandbox-to-paid migration wizard** over the PHASE-059 sandbox tenants (guided plan
   selection, data-promotion path, dry-run verification before cutover).

Out of scope: the app marketplace DF-38 (kept non-goal per the register — the plugin
substrate delivered by PHASE-036 stands) · built-in storefront DF-41 (served by the 056
connectors) · marketing websites DF-40/DF-42 (optional follow-ups, noted not committed) ·
payout execution for partners (stays with the operator per the 059 decision) · any change
to plan pricing itself (OQ-002 territory) · academy video production (UX-16 content).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-062 (UX Excellence & Document Design) COMPLETE | hard prerequisite — roadmap §5 edge 062 → 065: white-label theming, the `changelog_entries` table, and the announcement-capable notification substrate |
| PHASE-059 (Platform Operations & Trust) COMPLETE | hard prerequisite — sandbox tenants, the support portal/KB surfaces, the public status page the trust center links, and the billing data plane |
| Subscription/billing + `/checkout` shipped (CR-04) | never re-implemented — reward credits, revenue dashboards, and the self-upgrade path extend it |

## 4. Design Impact

- **Migrations:** the next in sequence after the predecessors' last journal entry (~0150+
  at planning time; exact numbers bound at implementation start). Grouped SQL migrations +
  Drizzle mirrors for ~9 new tables: `referral_codes`, `reward_credits`,
  `partner_accounts`, `partner_commission_statements`, `usage_events`,
  `customer_health_scores`, `announcement_campaigns`, `feature_requests`,
  `feature_request_votes`; the public changelog **reuses** the PHASE-062
  `changelog_entries` table (no new table).
- **Entities/catalog parity:** +9 rows in `ENTITY_CATALOG.md`; SQL + Drizzle + catalog row
  for every table (CR-36 a); `usage_events` carries an explicit index/partition strategy
  per OA-06 (high-write table).
- **Permissions:** +6 keys — `growth.referrals.manage`, `growth.partners.manage`,
  `growth.campaigns.manage`, `growth.analytics.view`, `growth.feedback.moderate`,
  `platform.trust.manage`; these are platform-plane operator keys seeded under the
  platform console roles; the tenant-plane surfaces (tips, changelog, voting, trust
  pages) need no new tenant keys; zero-drift check re-anchored (seed = catalog = matrix).
- **i18n:** full AR/EN parity for every public page (trust center, legal library,
  changelog feed, voting board) and every in-app campaign surface; campaign content is
  authored bilingually per locale segment.
- **Reports:** +4 contracts registered in `REPORT_CATALOG.md` with an explicit
  **platform-plane marker** (the first cross-tenant contracts — read-only aggregates over
  billing/telemetry data): `growth.revenue-overview` (MRR/ARR), `growth.churn-cohorts`,
  `growth.feature-adoption`, `growth.customer-health`; rendered through the PHASE-057
  dashboard framework on the platform console.
- **Docs:** `FEATURE_CATALOG.md` (growth module + platform.trust) · `ENTITY_CATALOG.md` ·
  `REPORT_CATALOG.md` (+4 platform-plane rows) · `NAVIGATION_MODEL.md` (platform console
  + public routes) · `SUBSCRIPTION_AND_ENTITLEMENTS.md` (reward credits, partner margins,
  plan gating) · `RELEASE_STRATEGY.md` (the Stage-15 gate row per CR-38) · the legal
  library pages themselves · `IMPLEMENTATION_STATUS.md`.
- **Feature flags:** `growth.*` and `platform.trust.*`, template-composable grants
  (CR-36 f); referrals and the voting board are public-plane features available to all
  plans unless the pricing table says otherwise.
- **Sync/offline assessment (CR-36 g):** growth features are platform-plane/online —
  recorded as explicitly N/A for the offline clients; in-app campaign delivery degrades
  to the next online session.
- **No new goldens/INV/BR rows** — growth math is billing arithmetic on the existing
  subscription engine, reconciled rather than re-posted.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations for the ~9 tables + Drizzle mirrors + catalog rows (OA-06 index/partition strategy for `usage_events`) | api |
| T-02 | Referral engine: `referral_codes` generation/attribution + `reward_credits` balance and application log onto subscription invoices | api |
| T-03 | Partner program: `partner_accounts` (margin %, attributed tenants) + `partner_commission_statements` computation | api |
| T-04 | Partner portal surface: tenants' status + health flags in aggregate, consent-gated data access, white-label application | web |
| T-05 | Telemetry: privacy-scrubbed `usage_events` emit points with a documented event vocabulary + tenant opt-out | api |
| T-06 | Health scoring: login cadence + module breadth + support signals → `customer_health_scores` with risk flags + surface | api |
| T-07 | Revenue dashboards: `growth.revenue-overview` + `growth.churn-cohorts` contracts with the MRR reconciliation check | api |
| T-08 | Adoption dashboards: `growth.feature-adoption` + `growth.customer-health` contracts on the 057 dashboard framework | api |
| T-09 | Announcement campaigns: segment builder (plan/usage/locale), delivery through the 062 notification substrate, tips engine | web |
| T-10 | Trust center: public security-posture/sub-processor/badge pages (placeholder-honest) + status-page link | web |
| T-11 | Legal library pages (Terms/DPA/SLA/AUP, bilingual) + public changelog feed over `changelog_entries` | web |
| T-12 | Feature-request voting board + public roadmap view + moderation queue | web |
| T-13 | Self-serve conversion: trial-expiry nudges, self-upgrade path extending `/checkout`, sandbox-to-paid migration wizard with dry-run | web |
| T-14 | Docs: FEATURE_CATALOG/ENTITY_CATALOG/REPORT_CATALOG/NAVIGATION_MODEL/SUBSCRIPTION_AND_ENTITLEMENTS/RELEASE_STRATEGY updates | docs |
| T-15 | Full local gates: typecheck, lint, tests, `docs:validate`, i18n parity, permissions zero-drift, RLS attack tests A1–A10 extended to the partner-facing surfaces, evidence recording | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations apply cleanly with journal/spec/catalog parity; RLS attack tests A1–A10 pass
   for every new table **and for the partner-facing and public surfaces** — a partner
   without recorded consent cannot read any tenant business data (isolation attack rows
   extended per CR-36 e).
2. Referral loop end-to-end: a code attributed to a new signup produces a reward credit,
   and the credit applies to a subscription invoice through the existing billing engine
   (price tables untouched); the application is logged (DF-36).
3. Partner program: a partner account with margin % and attributed tenants computes a
   correct commission statement for a seeded period; the partner portal shows tenant
   status and health flags only, with consent gating verified (DF-37).
4. Product analytics: `usage_events` emit only vocabulary events (a payload-inspection
   test proves no free text or record content); health scores compute from seeded login
   cadence, module breadth, and support signals with risk flags (DF-44/46/47).
5. Revenue visibility: the MRR/ARR dashboard reconciles line-by-line to the underlying
   subscription invoices (recorded reconciliation evidence); churn/cohort panels render
   for seeded cohorts (DF-45).
6. Campaigns: a segmented announcement (plan × usage × locale) delivers to exactly the
   targeted segment through the 062 substrate; a tips-engine tip triggers on a usage
   signal (DF-48).
7. Trust & legal: the trust center renders with **no unevidenced compliance badge**
   (placeholders explicitly labeled as planned); Terms/DPA/SLA/AUP pages render
   bilingually; the public changelog feed mirrors the 062 table read-only; the voting
   board accepts a public vote with moderation (TB-28…TB-30, DF-49/DF-50, UX-02).
8. Self-serve conversion: a trial-expiry nudge fires on schedule; a self-upgrade flow
   completes through the extended `/checkout` with correct proration; the
   sandbox-to-paid wizard performs a dry-run verification before a seeded cutover
   (DF-43).
9. All house gates green (typecheck, lint, boundaries, unit tests, `docs:validate`, i18n
   parity, permissions zero-drift re-anchored, manifests); +4 platform-plane report
   contracts registered with catalog rows (CR-36).
10. Completion report `reports/PHASE-065-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped — **Blueprint v3.0 complete (31/31 phases)**;
    the Stage-15 «differentiated» wave gate (CR-38) is reviewed and recorded in
    `RELEASE_STRATEGY.md`; archive delivered as `ERP_PLATFORM_PHASE065.zip` (OA-07).

## 7. Risks and Constraints

- **Partner visibility vs tenant isolation** — the partner portal is the first
  non-operator surface near tenant data: mitigated by consent records, platform-plane
  aggregates only, RLS untouched, and isolation attack tests extended to every
  partner-facing route as an acceptance criterion.
- **Telemetry privacy** — usage events must never become surveillance: mitigated by the
  closed event vocabulary, payload-inspection tests, tenant-level opt-out, and a public
  description of exactly what is collected in the trust center.
- **Public trust claims honesty** — badges and compliance statements are procurement
  ammunition but honesty is the platform's brand: mitigated by the placeholder-honest
  rule (no badge without evidence) and an owner sign-off gate on trust-center content
  before publication.
- **Platform-plane report contracts set a precedent** — the first cross-tenant contracts
  in the catalog: mitigated by the explicit plane marker, read-only aggregate queries,
  audited access, and the MRR reconciliation check tying every number back to billing
  records.
- **Self-serve edge cases** (proration, sandbox cutover): mitigated by extending the
  shipped checkout flow instead of replacing it, the wizard's dry-run mode, and
  reconciliation checks after every seeded conversion.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-065-COMPLETION.md` — evidence
  per acceptance criterion, the isolation attack-test extension for partner-facing
  surfaces, the MRR reconciliation output, and the Stage-15 gate review record.
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-065 row → COMPLETE — with this phase the
  Blueprint v3.0 program is complete (PHASE-035…065, 31 phases, 4 waves);
  `NEXT_ACTION.md` → program closure: the Wave-4 / Stage-15 release gate (CR-38
  «differentiated») review, the `RELEASE_STRATEGY.md` v3.0 tier-row update, and the
  post-program continuous-improvement backlog (the optional DF-40/DF-42 marketing-website
  follow-ups are noted there, not committed).
- Delivery: repository state archived as `ERP_PLATFORM_PHASE065.zip` (OA-07) — the final
  program archive; the owner may continue with «ابدأ تنفيذ المرحلة PHASE-065» for
  execution of this phase, and with the gate-review instruction afterwards.
- Handoff notes at program close: the growth loop (referrals → partners → health →
  campaigns → conversion) is instrumented end-to-end; the trust center and legal library
  become the owner's living public commitments (they need an owner-owned update cadence);
  and `usage_events` is the single telemetry source any future roadmap decision should
  cite — the 31 phase documents remain the authoritative record of what was promised and
  what shipped.
