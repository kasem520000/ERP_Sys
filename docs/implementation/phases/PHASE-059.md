# PHASE-059 — Platform Operations & Trust

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 3 / Stage 14 · **Register:** [CR-29](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-19) · §18 (PL-01…PL-18) · §19 (G-14…G-18) · §25 (FD-33) · §27 (TB-21, TB-24…TB-27, TB-31…TB-33, TB-35) · [COMPLETENESS_REGISTER.md](../../planning/COMPLETENESS_REGISTER.md) OA-03

## 1. Phase Overview

- **Phase ID:** PHASE-059
- **Title:** Platform Operations & Trust (عمليات المنصة والثقة)
- **Objective:** Make the platform operationally trustworthy — the difference between
  a product and a service: per-tenant backup/restore with documented restore drills,
  full tenant data export for portability, tenant quotas with enforcement, a Redis
  cache layer, a background-jobs console, a secrets-management adapter, sandbox
  tenants, public trust surfaces (status page, SLA publication, support ticket
  portal, public knowledge base), an in-app system-health panel for tenant admins,
  CI/CD deployment pipelines, the OpenTelemetry exporter completion, FinOps views,
  cold-storage archival, K8s/Helm multi-region deployment optionality (charts and
  runbooks, not a mandate), auto-DR verification drills, and the hosted load-test
  closure owed by the standing PERFORMANCE_TEST_PLAN obligation. Closes Wave 3 and
  the Stage-14 "enterprise" gate.
- **Business value:** H-19 (no per-tenant backup/restore) is a data-custody blocker
  for any serious tenant; TB-32 (no full data export) is a contractual-compliance
  blocker; the public trust surfaces convert "trust me" into verifiable uptime,
  SLA, and support commitments — the operational pillars a buyer evaluates before
  renewing. Quotas and FinOps protect margin as tenant count grows.
- **الملخص التنفيذي (AR):** تجعل هذه المرحلة المنصةَ موثوقةً تشغيلياً: نسخ احتياطي
  واستعادة لكل مستأجر مع تدريبات تعافٍ موثّقة بالتوقيتات، وتصدير كامل للبيانات
  (قابلية النقل التعاقدية)، وحصص استخدام مع وسيط فرض، وطبقة Redis للمسارات الساخنة،
  ووحدة تحكم بالوظائف الخلفية، ومدير أسرار، ومستأجرون معزولون للتجربة، وصفحة حالة
  عامة واتفاقية مستوى خدمة وبوابة دعم وقاعدة معرفة عامة، ولوحة «صحة النظام» داخل
  التطبيق، وخطوط نشر CI/CD ببوابات موافقة، وإكمال تصدير التتبّع، وآراء FinOps،
  والأرشفة الباردة، وخيار النشر متعدد المناطق برسوم Helm وأدلة تشغيل — لا التزام —
  وإغلاق اختبار الحمل القائم، مع ملاحظة امتثال الاستضافة SDAIA في وثائق النشر.

## 2. Scope

In scope:

1. **Per-tenant backup and restore** (H-19, PL-07, TB-31): `tenant_backup_jobs` —
   per-tenant snapshot export (full or entity-scoped) with a documented restore
   drill path and recorded timings; restore drills are scheduled, executed, and
   evidenced.
2. **Full data export / portability** (TB-32): `tenant_export_jobs` — a complete
   tenant data bundle (JSON and CSV per entity, documented schema, versioned) that
   satisfies contractual portability and on-request exit.
3. **Auto-DR verification and BCP** (PL-16, G-14): automated backup-restore
   verification drills with alerting on drift, plus a documented Business Continuity
   Plan linked from the runbooks.
4. **Tenant quotas** (PL-13): `tenant_quotas` — storage bytes, document count, API
   calls, report runs; enforcement middleware, usage counters, warning thresholds,
   and clear overage errors (no silent degradation).
5. **Redis cache layer** (PL-04): cache-aside layer for session and report hot
   paths with TTL policy and invalidation on posting events; pg-boss remains the
   queue of record.
6. **Background-jobs console** (PL-05): a platform-console UI over pg-boss —
   queue list, active/complete/failed counts, retry actions, dead-letter inspection.
7. **Secrets management adapter** (PL-06): Vault / AWS Secrets Manager adapter with
   environment-variable fallback; secret-reference resolution at boot and a rotation
   runbook; existing env-based configuration keeps working unchanged.
8. **Sandbox tenants** (PL-08, TB-35, FD-33): isolated sandbox tenant provisioning
   seeded by the PHASE-040 demo loader, with expiry and auto-expiry cleanup —
   sales-demo and trial environments without production risk.
9. **Public trust surfaces** (TB-24, TB-25, TB-26, TB-27, PL-14): public status
   page (uptime + incidents feed over `status_components` and `status_incidents`),
   SLA publication, customer support ticket portal (`support_tickets` +
   `support_ticket_messages`), and a public bilingual knowledge base (`kb_articles`)
   at the public routes `/status` and `/support`.
10. **In-app system-health panel** (TB-21): a tenant-admin surface showing the
    platform health indicators relevant to them (job lag, queue depth, incident
    notices) without exposing cross-tenant internals.
11. **CI/CD deployment pipelines** (PL-09, PL-10): deployment workflows with
    environment promotion and approval gates (test workflows remain; deploy
    workflows are gated) plus deployment runbooks.
12. **Observability completion** (PL-11): OpenTelemetry exporter completion — the
    traces/metrics pipeline leg with OTLP endpoint configuration, dashboards, and
    alert rules; no vendor lock beyond the OTLP standard.
13. **FinOps** (PL-12): `finops_cost_records` and cost-allocation views per
    tenant/module, ingesting cloud billing exports joined to the quota usage
    counters.
14. **Scale optionality** (PL-01, PL-02, PL-03, PL-15): K8s/Helm charts and
    multi-region deployment optionality delivered as charts + runbooks — not a
    mandate; docker-compose remains the reference deployment, with a CDN strategy
    note and horizontal-scaling guidance.
15. **Data archival** (PL-17, TB-33): `archival_jobs` — cold-storage archival policy
    jobs per entity class after N years, with a documented restore-from-archive path.
16. **Edge security posture** (G-15, G-16, G-17, G-18): security-header completion,
    WAF and DDoS edge runbooks and configuration guides, and per-tenant IP
    whitelisting middleware.
17. **Hosted load-test closure** (PL-18): the k6 full-load run plus a 12-hour soak
    per the standing PERFORMANCE_TEST_PLAN obligation, with recorded evidence and
    any remediation — closing the audit's "no real sustained load testing" finding.
18. **SDAIA/KSA hosting compliance note** (OA-03): the data-residency posture note
    in deployment documentation for KSA public-sector deals.

Out of scope: multi-region production operation (optionality only — charts and
runbooks) · SOC 2/ISO certification (058 readiness substrate) · customer-facing
payouts tooling (`platform.payouts` decision record stands; any activation is a
future owner decision) · changes to the pg-boss engine itself · vendor-specific APM
contracts beyond OTLP.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-055 (Public API & Webhooks — event feeds that automate status/incident updates) | PLANNED (Blueprint v3.0) — strongly recommended; if not yet COMPLETE at start, the incident feed degrades to manual entry (recorded) |
| PHASE-035 (v3.0 baseline) | PLANNED — minimum entry condition; must be COMPLETE before this phase starts |
| Delivered platform console, subscription/billing, pg-boss queue, docker-compose reference deployment | shipped in stages 1–11 (audit §21 — do not touch) |

The 055 soft edge exists because the public status page and incident automation are
considerably stronger when fed by the webhook/event platform; the phase is viable
without it with the degradation recorded honestly.

## 4. Design Impact

- **Migrations:** next in sequence (≈0120…0123 at authoring time; exact numbers are
  bound at implementation start — counts and contents claimed, not fixed journal
  numbers): `tenant_backup` (tenant_backup_jobs, tenant_export_jobs),
  `tenant_quotas` (tenant_quotas), `trust_surfaces` (support_tickets,
  support_ticket_messages, status_components, status_incidents, kb_articles),
  `ops_finops` (archival_jobs, finops_cost_records). Drizzle mirror,
  `_journal.json`, and migration spec updated per house convention.
- **Entities/catalog parity:** +10 new tables (the ten above); every table ships
  SQL + Drizzle + an `ENTITY_CATALOG.md` row (CR-36 a). Support-ticket and
  status tables are platform-scoped (not tenant RLS) — the RLS model for
  platform-level tables is documented and attacked per CR-36 e.
- **Permissions:** +10 keys — `platform.backups`, `platform.exports`,
  `platform.quotas`, `platform.jobs`, `platform.support`, `platform.status`,
  `platform.kb`, `platform.finops`, `platform.archival`, `platform.sandboxes`;
  zero-drift equality re-run at the extended running base (CR-36 b).
- **i18n:** ~220–260 new dictionary keys — console extensions plus fully bilingual
  public pages (status, support portal, knowledge base) ×2 AR/EN; parity equality
  extended (CR-36 c).
- **Docs:** `DEPLOYMENT.md` (pipelines, Helm charts, multi-region runbooks, SDAIA
  note per OA-03) · new `RUNBOOKS.md` (DR drills, restore, incidents) · new
  `SUPPORT_AND_STATUS.md` (trust-surface operating model) · `PERFORMANCE_TEST_PLAN`
  closure record.
- **Reports:** +2 code-level contracts — `platform.backup-history` (backup and drill
  evidence) and `platform.quota-usage` (per-tenant usage vs quotas); catalog rows
  mandatory.
- **Feature flags:** `platform.ops_console` (internal console extensions);
  public trust surfaces are ungated public routes; sandbox behavior is a tenant kind
  flag, not a feature key.
- **Goldens/invariants:** none allocated — operational surfaces only; numbering
  continues in PHASE-060 and 061.
- **Architecture:** one new ADR (next in the ADR sequence) records the cache layer,
  secrets adapter, and deployment-optionality decisions; the posting engine, RLS
  model, and queue engine are untouched.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations (≈0120…0123) + Drizzle mirror + `ENTITY_CATALOG.md` rows | api |
| T-02 | Backup/restore service: snapshot export, restore path, scheduled drills with recorded timings | api/jobs |
| T-03 | Full export bundle job (JSON/CSV per entity, documented schema, download) | jobs |
| T-04 | Auto-DR verification drills + BCP document + runbook linkage | jobs/docs |
| T-05 | Quota engine: counters, enforcement middleware, warning thresholds, console views | api |
| T-06 | Redis cache layer for session/report hot paths + invalidation on posting events | api |
| T-07 | Background-jobs console UI over pg-boss (queues, retry, dead-letter) | web |
| T-08 | Secrets adapter (Vault/AWS SM, env fallback) + rotation runbook | infra |
| T-09 | Sandbox tenant provisioning + expiry cleanup (seeded via the 040 demo loader) | api/jobs |
| T-10 | Public status page + incidents feed + uptime components; SLA publication | web |
| T-11 | Support ticket portal + agent workspace + public bilingual knowledge base | web |
| T-12 | In-app system-health panel for tenant admins | web |
| T-13 | CI/CD deployment pipelines with approval gates + deployment runbooks + Helm charts + multi-region optionality + SDAIA note | infra/docs |
| T-14 | OpenTelemetry exporter completion (traces/metrics, OTLP config, dashboards, alerts) | infra |
| T-15 | FinOps cost ingestion + allocation views; archival policy jobs + restore-from-archive | jobs |
| T-16 | Edge security: header completion, WAF/DDoS runbooks, per-tenant IP whitelisting middleware | api/infra |
| T-17 | Hosted load-test closure: k6 full-load + 12h soak per PERFORMANCE_TEST_PLAN with evidence | qa |
| T-18 | RLS attack tests A1–A10 (tenant tables) + platform-scope isolation tests + full local gates | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. A per-tenant backup job produces a restorable snapshot; a recorded restore drill
   reproduces tenant data with timings documented end-to-end; the auto-DR drill
   alerts on drift — H-19 closed with evidence.
2. The full export bundle contains every documented entity in JSON and CSV with a
   versioned schema manifest; a fresh tenant can be reconstructed from it in a drill
   (TB-32 closed).
3. Quota enforcement: exceeding storage/documents/API-calls/report-runs limits
   returns clear errors after warning thresholds; usage counters are accurate
   against seeded activity.
4. The jobs console lists pg-boss queues with counts; a failed job can be retried
   and a dead-lettered job inspected and requeued — all actions audited.
5. Public `/status` shows component uptime and an incidents feed (manual entry or
   055 event feed when present); `/support` accepts a ticket, threads messages, and
   the knowledge base renders bilingually; SLA publication is live.
6. The in-app system-health panel shows job lag, queue depth, and tenant-relevant
   incident notices without exposing cross-tenant data (RLS/platform-scope attack
   tests pass).
7. The secrets adapter resolves references at boot from Vault/AWS SM with env
   fallback proven in both modes; rotation runbook executed once as evidence.
8. Load-test closure: the k6 full-load run and the 12-hour soak complete within the
   PERFORMANCE_TEST_PLAN budgets with recorded evidence and remediation items
   tracked — PL-18 closed.
9. CR-36 gates: SQL + Drizzle + `ENTITY_CATALOG.md` for all 10 tables · permissions
   zero-drift at the extended base · AR/EN parity equality (public pages included) ·
   `docs:validate` green · RLS attack tests A1–A10 + platform-scope tests pass ·
   feature-flag gating where applicable · sync-surface assessment recorded (ops
   surfaces are online-only; explicit N/A record per OA-02) · OA-06 EXPLAIN budgets
   for every new table's hot paths.
10. Completion report `docs/implementation/phases/reports/PHASE-059-COMPLETION.md`
    appended with evidence (drills, load runs, trust-surface screenshots); the
    `IMPLEMENTATION_STATUS.md` row flipped; the Wave-3 / Stage-14 gate assessed
    against CR-38; archive delivered as `ERP_PLATFORM_PHASE059.zip` (OA-07).

## 7. Risks and Constraints

- **Backup/restore claims must stay honest** — H-19 is exactly the class of gap the
  audits punished when documented-but-missing. Mitigated by making a recorded
  restore drill with timings an acceptance criterion, not a configuration claim.
- **Redis changes runtime behavior** — caching session/report paths can introduce
  staleness bugs. Mitigated by cache-aside discipline, explicit invalidation on
  posting events, a kill-switch to bypass the cache, and parity tests with the cache
  on and off.
- **Quota enforcement breaking legitimate tenants** — a hard limit can cut off a
  paying customer mid-operation. Mitigated by warning thresholds, per-quota
  enablement, overage policy configuration, and clear errors (never silent
  failure).
- **Public attack surface growth** — status/support/KB pages are internet-facing
  without authentication. Mitigated by rate limiting, captcha on ticket
  submission, content moderation on the KB, and the edge-security runbooks shipped
  in this phase.
- **Optionality creep into obligation** — K8s/multi-region charts can quietly become
  a support burden. Mitigated by the explicit "not a mandate" decision here, the
  docker-compose reference remaining canonical, and support scope stated in
  DEPLOYMENT.md.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-059-COMPLETION.md`
  (drill logs, load-test evidence, quota policy defaults, trust-surface inventory,
  gate outputs, the Stage-14 gate assessment).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-059 row → COMPLETE; the Wave-3 /
  Stage-14 gate ("enterprise": API platform + SSO + BI + operations per CR-38) is
  assessed and recorded; `NEXT_ACTION.md` points to PHASE-060 opening Wave 4 per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §2/§5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE059.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-060».
- Handoff notes for PHASE-060: report-run quotas and the cache layer now bound the
  analytics surfaces from 057; sandbox tenants become the demo substrate for the
  CRM/portal sales motion; the support portal receives the customer-portal dispute
  cases submitted through the 060 portal accounts.
