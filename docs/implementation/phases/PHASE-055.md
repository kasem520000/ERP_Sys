# PHASE-055 — Public API & Webhooks Platform

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 3 / Stage 14 · **Register:** [CR-25](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-21 · §17 N-10/N-11/N-21 · §26.4 IN-19…IN-25 · §20 UX-09 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §2 OpenAPI designed-not-generated row

## 1. Phase Overview

- **Phase ID:** PHASE-055
- **Title:** Public API & Webhooks Platform (منصة الـ API والـ Webhooks العامة)
- **Objective:** Open the platform to the outside world with production discipline:
  tenant API keys with hashed storage, scopes that mirror the existing 245-key
  permission matrix, rate-limit tiers, and per-tenant IP allowlists; a versioned
  public API surface at `/api/public/v1/*` generated from the existing route registry
  and contracts, with an OpenAPI 3.1 document served and published; outbound
  HMAC-signed webhooks with retry/backoff and a user-visible delivery console;
  read-only OData/CSV BI feeds for Power BI/Tableau; iPaaS recipe documentation for
  Zapier/Make/n8n; and CDC-style change streams carried on the webhook event fabric.
  This is deliberately a non-financial phase: no new goldens, only the platform
  invariant INV-039 (key hashing + scope enforcement).
- **Business value:** Integrations scored 22% — the weakest axis in the audit — with
  API keys, webhooks, and generated OpenAPI all at zero ("designed, not built").
  Every enterprise deal now asks "where is your API?" and every iPaaS/BI ecosystem
  enters through this door. The same HMAC webhook rails become the reconciliation
  transport for the payments and commerce integrations that follow immediately after,
  and the delivery console closes UX-09 (user-visible integration logs) for every
  future connector.
- **الملخص التنفيذي (AR):** تفتح هذه المرحلة المنصة على الخارج بانضباطٍ إنتاجي: مفاتيح API لكل مستأجر مخزّنة كـ hash فقط بنطاقاتٍ تعكس مصفوفة الصلاحيات 245 حرفياً، مع طبقاتِ حدّ معدل وقوائم IP مسموحة لكل مستأجر؛ سطحُ API عام مُصدَّر بإصدارٍ ثابت على `/api/public/v1/*` مولَّدٍ من سجل المسارات والعقود القائمة مع مستند OpenAPI 3.1 يُخدَم ويُنشَر؛ وويب-هوكس صادرة موقّعة بـ HMAC مع إعادة محاولة تراجعية وسجل تسليمٍ مرئي للمستخدم (UX-09)؛ وخلاصات BI للقراءة فقط بنمط OData/CSV لأدوات Power BI وTableau؛ ووصفاتُ تكامل موثّقة لـ Zapier وMake وn8n؛ وتدفقاتُ تغيير بنمط CDC فوق نسيج أحداث الويب-هوكس — دون أي قيودٍ ذهبية جديدة لأن السطح غير مالي، مع الثابت INV-039: تخزين المفاتيح كـ hash وإلزام النطاقات.

## 2. Scope

In scope:

1. **`api_keys`** (H-21, N-10, IN-20): tenant-scoped keys with hashed storage (the
   raw key shown once at creation), scope set, rate-limit tier, `last_used` stamp,
   and rotation (create successor → retire predecessor) with revocation.
2. **`api_ip_allowlists`** (per tenant): optional CIDR allowlists enforced at the
   public API gateway; empty list means no IP restriction.
3. **`webhook_endpoints`** (N-11, IN-21): tenant endpoints with URL, event
   subscriptions, HMAC secret (rotatable), and enabled state.
4. **`webhook_deliveries`** (IN-21, UX-09): the delivery ledger — payload, attempts,
   `next_retry`, outcome — powering the retry/backoff engine and the delivery
   console.
5. **`api_usage_counters` + rate-limiting middleware** (per key): sliding-window
   counters with plan-tiered limits; enforcement happens before controller logic.
6. **Versioned public API `/api/public/v1/*`** (N-21): the public surface generated
   from the existing route registry + request/response contracts — the same handlers
   behind a public auth guard that resolves the tenant from the key and enforces
   scopes; the API surface mirrors user permissions via the 245-key matrix.
7. **OpenAPI 3.1 document generation** (IN-19, N-21): the spec is generated, never
   hand-written; served at a public URL and published with the release notes;
   contract tests assert spec↔implementation parity so drift fails the build.
8. **HMAC-signed webhooks with retry/backoff**: delivery worker with exponential
   backoff, attempt caps, and automatic endpoint disablement after repeated failure;
   every event consumed from the internal event bus (workflow lifecycle events from
   PHASE-052 are the first feed).
9. **Delivery console** (UX-09): `/settings/webhooks` with per-endpoint delivery
   logs, payload viewer, manual resend, and HMAC secret rotation.
10. **BI feeds** (IN-23): read-only OData and CSV endpoints over whitelisted
    entities for Power BI/Tableau/extract tooling — separate scoped keys, no write
    verbs.
11. **iPaaS recipes** (IN-22, N-12): documented, tested recipes for Zapier/Make/n8n
    connecting invoice-created, payment-received, and partner-updated events to
    external flows.
12. **CDC-style change streams** (IN-25): change events per entity emitted to
    webhook subscribers with sequence numbers and cursor-based replay endpoints —
    event-carried state export, not bidirectional sync.
13. **CRM integration recipes** (N-15): the documented API recipe pattern for
    external CRM sync (partners/leads/invoices) riding the public API — recipes and
    scopes, not a per-vendor adapter.

Out of scope: the payment/commerce provider adapters themselves (056) · per-vendor
CRM connectors (recipes only here) · GraphQL surface · public API v2 or
deprecation tooling beyond the documented policy · marketplace/app store (kept
non-goal per DF-38).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | REQUIRED — NOT_STARTED (planned, Wave 1) |
| Route registry + request/response contracts (594 routes) | SHIPPED stages 1–11 — the generation source |
| 245-key permission matrix + zero-drift discipline | SHIPPED — scopes mirror it |
| Internal event bus (workflow lifecycle events) | DELIVERED BY PHASE-052 — first webhook feed |

Per [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5 this phase
hard-requires only 035; it consumes the 052 event bus when available and is itself a
hard prerequisite for 056 (webhooks/events feed commerce reconciliation).

## 4. Design Impact

- **Migrations**: 2, next in sequence — `0105_api_keys.sql` (keys + usage counters +
  IP allowlists), `0106_webhooks.sql` (endpoints + deliveries). The journal continues
  from the Wave sequence (expected 0049…0104 after phases 036–054); exact numbers
  assigned at implementation as the next free sequence, strictly increasing, with
  `_journal.json` + `migrations.ts/spec` updated per house convention.
- **Entities/catalog**: +5 tables (`api_keys`, `api_ip_allowlists`,
  `webhook_endpoints`, `webhook_deliveries`, `api_usage_counters`) — SQL + Drizzle
  mirror + `ENTITY_CATALOG.md` rows (CR-36 a).
- **Permissions**: +7 `platform.api.*` keys (manage keys, rotate keys, manage
  allowlists, manage webhooks, view deliveries, view usage, manage scopes); the
  public API surface itself does not add user permissions — it mirrors the existing
  245-key matrix through scopes; zero-drift check re-extended (registry = seed,
  cumulative v3.0 count).
- **i18n**: ~150 new AR/EN keys (key management, webhook console, delivery log,
  usage dashboard); parity check extended.
- **Docs**: `OPENAPI_STRATEGY.md` (generation pipeline), `API_VERSIONING.md`
  (v1 policy + deprecation rules), `AUTHENTICATION.md` (key auth), `ERROR_MODEL.md`
  (public error envelope), `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`,
  `FEATURE_CATALOG.md`, `NAVIGATION_MODEL.md`, new iPaaS recipe documents, INV-039
  entry in the invariants documentation.
- **Reports**: +2 contracts — `platform.api-usage`, `platform.webhook-deliveries`
  (catalog rows mandatory).
- **Feature flags**: `platform.api.public`, `platform.api.keys`,
  `platform.api.webhooks`, `platform.api.bi-feeds` — template-composable grants; the
  public API flag defaults on for enterprise-tier templates only.
- **No new goldens** (non-financial surface by design); INV-039 (key hashing + scope
  enforcement) is added and enforced in the public auth guard. No architectural
  change — the public surface is a gateway module in front of existing handlers;
  offline sync assessment: platform-only, N/A recorded for sync clients (CR-36 g).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations 0105–0106 + journal/spec updates | api |
| T-02 | Drizzle mirrors + `ENTITY_CATALOG.md` rows + RLS policies + attack tests A1–A10 | api |
| T-03 | Key lifecycle: creation (show-once raw key), hashed storage, rotation, revocation, `last_used` tracking, INV-039 enforcement | api |
| T-04 | Scope model: key scopes derived from the 245-key permission matrix; enforcement guard resolving tenant from key | api |
| T-05 | Rate-limiting middleware (sliding window per key, plan-tiered) + `api_usage_counters` + IP allowlist enforcement | api |
| T-06 | Public API surface: `/api/public/v1/*` generated from the route registry + contracts behind the public auth guard | api |
| T-07 | OpenAPI 3.1 generation pipeline: spec served + published + spec↔implementation parity contract tests | api |
| T-08 | Webhook engine: subscription matching, HMAC signing, delivery worker with retry/backoff and auto-disable | api |
| T-09 | CDC-style change streams: per-entity sequence numbers, cursor replay endpoints | api |
| T-10 | BI feeds: read-only OData/CSV endpoints over whitelisted entities with scoped keys | api |
| T-11 | Screens: `/settings/api-keys` (issue/rotate/revoke, usage) and `/settings/webhooks` + delivery log console with resend | web |
| T-12 | iPaaS + CRM recipe documents (Zapier/Make/n8n) with tested example flows | docs |
| T-13 | Docs: API strategy/versioning/auth/error model updates + INV-039 + catalog/report/feature/nav updates | docs |
| T-14 | Run full local gates (typecheck/lint/boundaries/tests/docs/i18n parity/permissions drift/manifests) and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations 0105–0106 apply cleanly; Drizzle mirrors and `ENTITY_CATALOG.md` rows
   present; RLS attack tests A1–A10 pass — including an attack proving one tenant's
   key cannot reach another tenant's data on public paths.
2. INV-039: keys are stored hashed only (raw value never persisted or logged — grep
   and integration proof); a key with a narrow scope cannot invoke an out-of-scope
   route (scope enforcement test against the 245-matrix mapping).
3. Rate limiting: a key exceeding its tier receives 429 responses with correct
   retry-after semantics and the usage counters reflect the calls; IP allowlisted
   tenants reject disallowed sources.
4. The OpenAPI 3.1 document is generated from the route registry, served at the
   public URL, and the parity contract test fails if a route or schema drifts from
   the implementation.
5. A seeded invoice event delivered through the 052 event bus reaches a subscribed
   webhook endpoint with a valid HMAC signature; an initially failing endpoint is
   retried with backoff and auto-disabled after the attempt cap, all visible in the
   delivery console with manual resend working.
6. The delivery console renders per-endpoint delivery history, payload viewer, and
   secret rotation with AR/EN parity and RTL — UX-09 closed.
7. BI feeds: an OData/CSV read-only feed over seeded data serves a Power BI-style
   client with a scoped key; write verbs are absent from the feed surface.
8. CDC-style streams: a subscriber can replay entity changes from a cursor without
   gaps or duplicates on the seeded fixture sequence.
9. All CR-36 discipline gates green (catalog parity, permissions zero-drift, AR/EN
   parity, `docs:validate`, RLS tests, feature flags, sync-surface N/A recorded);
   no new goldens, INV-039 documented and tested.
10. Completion report `reports/PHASE-055-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE055.zip` (OA-07).

## 7. Risks and Constraints

- **The largest new attack surface** — public authentication bypasses user sessions;
  mitigated by hashed keys (INV-039), scopes mirroring the permission matrix, RLS
  preserved on public paths, IP allowlists, and dedicated attack tests.
- **Spec drift** — a hand-maintained OpenAPI document rots immediately; mitigated by
  generation from the route registry and a parity contract test that fails the build
  on drift.
- **Webhook abuse and retry storms** — failing endpoints can hammer tenants or be
  used as amplifiers; mitigated by exponential backoff with attempt caps, automatic
  disablement, and per-endpoint delivery quotas.
- **Breaking changes** — external consumers freeze fast; mitigated by the versioned
  `/api/public/v1/*` path and a documented deprecation policy in the versioning
  documentation.
- **Rate-limit fairness** — a noisy tenant must not starve others; mitigated by
  per-key sliding windows and plan-tiered limits enforced before controller logic.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-055-COMPLETION.md`
  (evidence per criterion, gate output, the published OpenAPI URL, the security
  review notes for the public surface).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-055 row → COMPLETE; `NEXT_ACTION.md`
  → PHASE-056 (Payments & Commerce Integrations) with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE055.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-056».
- Handoff notes for PHASE-056: the HMAC webhook ingestion ledger pattern, scoped-key
  issuance, and the delivery console built here are reused directly by the payment
  provider event ingestion and the commerce/carrier connectors; provider callback
  URLs register as first-class webhook consumers, not ad-hoc endpoints.
