# PHASE-041 — Communications Hub

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 1 / Stage 12 · **Register:** [CR-11](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-22) · §26.3 (IN-13…IN-18, N-06/N-07/N-08) · §25.3 (FD-30) · §27.2 (TB-23) · UX-14 · PP-13/PP-15

## 1. Phase Overview

- **Phase ID:** PHASE-041
- **Title:** Communications Hub (مركز الاتصالات (واتساب/SMS/بريد))
- **Objective:** Fulfil the channel-port promise the audit found hollow
  (H-22: "SMS providers TBD per market" — in the Arab market, WhatsApp IS
  the business channel). The phase implements the provider adapters behind
  the EXISTING channel-port discipline: **WhatsApp Business Cloud API**
  (template messages, per-market number configuration), **SMS adapters**
  (Unifonic, Msegat, Twilio), and a **verified email provider abstraction**
  (SMTP/SendGrid/SES/Mailgun selectable per environment) with a
  DKIM/SPF/DMARC configuration guide. On top of the port: tenant
  email/print templates (`message_templates` — the FD-30 substrate), the
  send ledger (`outbound_messages` with status, provider ref, cost), the
  per-module notification-preference matrix (`notification_preferences` —
  TB-23), the unified interaction log (`communication_log`) feeding the
  unified inbox surface (UX-14) with basic call logging (IN-16), the daily
  digest (PP-13), proactive deadline nudges (PP-15), and Google/Outlook
  calendar integration via OAuth (IN-17) plus contacts sync (IN-18). Every
  provider sits behind the port with a **SANDBOX default provider** — zero
  external calls until a real provider is configured and credentialed
  (BR-067).
- **Business value:** Invoices, dunning letters, and statements reach
  customers where they actually read messages (WhatsApp/SMS in MENA);
  notification fatigue ends with per-module channel preferences; sales and
  support get one inbox with the full interaction history; calendars and
  contacts stop being silos.
- **الملخص التنفيذي (AR):** يُنجز هذه المرحلة وعد منفذ القنوات: محوِّل واتساب
  للأعمال (رسائل القوالب مع أرقام مُرسِلة لكل سوق)، ومحوِّلات رسائل SMS
  (يونيفونك/مسجات/Twilio)، وتجريد بريد متعدد المزوّدين (SMTP/SendGrid/SES/
  Mailgun) مع دليل ضبط DKIM/SPF، وكلها خلف منفذ القنوات القائم مع مزوّد
  «صندوق رملي» افتراضي لا يرسل شيئاً خارجياً قبل الضبط. فوق المنفذ: قوالب
  بريد وطباعة للمستأجر بمعاملات مطبَّعة، وسجل إرسال بالحالة والتكلفة ومرجع
  المزوّد، ومصفوفة تفضيلات إشعار لكل وحدة وقناة، وصندوق وارد موحّد مع تسجيل
  مكالمات، وملخص يومي وتنبيهات استباقية قبل الاستحقاق، وتكامل تقويم
  Google/Outlook عبر OAuth ومزامنة جهات الاتصال.

## 2. Scope

In scope:

1. **Channel-port adapters** (H-22, N-06/N-07/N-08, IN-13/IN-14/IN-15):
   whatsapp-business (template messages, per-market sender numbers), SMS
   (unifonic, msegat, twilio), and email (smtp, sendgrid, ses, mailgun) —
   environment-selectable per provider kind, ALL behind the existing
   channel-port; the SANDBOX default provider makes zero external calls
   until configured (BR-067).
2. **Tenant message templates** (`message_templates`, FD-30): channel ×
   locale × module templates with typed variables, tenant-editable — the
   email-template substrate the audit found missing ("no email_templates —
   strings in code") + the print-template variable documentation.
3. **Send ledger** (`outbound_messages`): status
   QUEUED/SENT/DELIVERED/FAILED, provider reference, cost, retry policy —
   bounded pg-boss jobs with backoff; every send is a row.
4. **Notification preferences** (`notification_preferences`, TB-23): the
   user × module × channel matrix (in-app/email/SMS/WhatsApp) with
   per-module defaults; the dispatch resolver honors the matrix
   end-to-end.
5. **Unified inbox + call logging** (`communication_log`, UX-14, IN-16):
   the unified inbox surface lists messages and calls per partner with
   filters; basic call logging (manual entries with outcome/duration
   linked to partners and users).
6. **Daily digest** (PP-13): the per-user "what needs attention today" job
   (overdue invoices, approvals pending, low stock, expiring warranties)
   rendered from templates and honoring preferences.
7. **Proactive nudges** (PP-15): deadline-ahead reminders (invoice due
   dates, tasks, contract renewals) as scheduled jobs with per-event-type
   lead times, honoring preferences.
8. **Calendar integration** (IN-17): Google + Outlook OAuth connect —
   event write for tasks/appointments; tokens in the secret store; flows
   stubbed in tests.
9. **Contacts sync** (IN-18): opt-in two-way contact sync for connected
   accounts with partner-directory matching rules (exact + fuzzy
   candidate review — never auto-merge).
10. **Deliverability guide** (N-08's verified-provider leg): the
    DKIM/SPF/DMARC configuration guide per environment + provider
    credentials in settings under the secret-store discipline (never
    logged, rotation documented).
11. **Delivery-log report** (`communication.outbound_delivery_log`): the
    outbound ledger as a report contract (status, provider, cost, channel
    mix).

Out of scope: realtime in-app WebSocket notifications (062) · marketing
campaign messaging (065) · voice/VOIP calling (call logging only) ·
WhatsApp bots and AI assistants (064) · provider management beyond
selection + credentials · the JoFotara/ETA notification integrations
(054/063).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | planned — the v3.0 entry phase; hard ordering rule (roadmap §5: 035 ships first) |
| Channel-port + notification machinery baseline (FCM + email single-provider) | delivered with the 34-phase baseline |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

Hard ordering rules that involve this phase: 041 feeds 056 (payments and
commerce reuse the templates/outbox) and 061 (POS e-receipts ride the
channel-port) per roadmap §5; inside Wave 1 it is parallel-safe. Cumulative
counters assume the sequential lineage 035 → 036 → … → 041.

## 4. Design Impact

- **Migrations**: `0059_communications_hub.sql` (journal 58 → 59 — next in
  sequence after PHASE-040's 0058): the four RLS'd tables
  (`message_templates`, `outbound_messages`, `notification_preferences`,
  `communication_log`) + preference default seed rows; Drizzle
  journal/spec updated.
- **Entities**: +4 tables (ENTITY_CATALOG.md 224 → 228); Drizzle mirrors +
  typed stores under a new `communication` module.
- **Permissions**: +5 keys — `communication.templates.manage`,
  `communication.outbox.read`, `communication.preferences.manage`,
  `communication.inbox.read`, `communication.calendar.connect`;
  zero-drift extended (263 → 268; seed = mirror).
- **i18n**: ~160 new AR/EN keys (settings, inbox, preferences, digest and
  nudge templates, provider labels); parity gate as ever.
- **Reports**: +1 contract — `communication.outbound_delivery_log`
  (registry 90 → 91); REPORT_CATALOG.md row mandatory (CR-36).
- **Feature flags**: +6 keys — `communication.templates` and
  `communication.outbound` (ALL plans — base messaging over the SANDBOX
  default provider); `communication.whatsapp`, `communication.sms`,
  `communication.email_providers`, `communication.calendar_integration`
  (business + enterprise, the tier-4 precedent); FEATURE_CATALOG.md rows +
  dependency edges.
- **Rules**: BR-067 (channel-port isolation: every outbound send goes
  through the port; no provider is called outside it; the SANDBOX
  provider is the default until a real one is configured and credentialed)
  appended to BUSINESS_RULES.md (numbering continues from BR-066 shipped
  with PHASE-040).
- **Docs**: the deliverability guide (DKIM/SPF/DMARC per environment) ·
  ENTITY_CATALOG.md (+4) · FEATURE_CATALOG.md (+6) · REPORT_CATALOG.md
  (+1) · DATA_DICTIONARY.md (template variables, status vocabulary) ·
  NAVIGATION_MODEL.md (+ settings items and the inbox).
- **Sync surface (CR-36 g)**: inbox and notification-preference surfaces
  extend the existing mobile notification feeds additively (OA-02); the
  outbound ledger projects read-only; provider configuration is
  online-only — N/A-recorded.
- **Performance (OA-06)**: EXPLAIN-verified hot paths — the outbox queue
  scan (status + next_attempt_at), the inbox list by (tenant, partner),
  and the digest aggregation; command-palette entries for the inbox and
  templates (OA-04).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migration `0059` (four RLS'd tables + preference defaults) + Drizzle journal/spec | api |
| T-02 | Channel-port adapters: whatsapp-business, unifonic, msegat, twilio, smtp, sendgrid, ses, mailgun + the SANDBOX default | api |
| T-03 | Provider selection + credentials in settings (secret-store discipline, never logged) + per-market WhatsApp numbers | api |
| T-04 | Template service: channel × locale × module CRUD, typed variables, rendering + the print-template variable documentation | api |
| T-05 | Outbound send pipeline: queue → provider → status transitions, provider ref, cost, retries with backoff | api |
| T-06 | Notification-preference matrix + the dispatch resolver honoring it end-to-end | api |
| T-07 | Daily digest job + proactive nudge jobs (lead-time config, preference-aware) | api |
| T-08 | Unified inbox + communication_log + basic call logging | api |
| T-09 | Google/Outlook OAuth calendar connect (event write) + contacts sync with matching rules | api |
| T-10 | Web screens: `/settings/communication` (templates, providers), unified inbox, preference matrix, call log | web |
| T-11 | `communication.outbound_delivery_log` report contract + catalog row | api |
| T-12 | Deliverability guide (DKIM/SPF/DMARC) + docs wave | docs |
| T-13 | Adapter contract suite (fake transports, network-blocked SANDBOX proof) + RLS A1–A10 + full gates + evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migration 0059 applies cleanly; the four tables are RLS'd; Drizzle +
   ENTITY_CATALOG.md parity (228 rows); preference defaults seed idempotently.
2. Adapter honesty (BR-067): the full adapter contract suite passes behind
   fake transports, and the network-blocked test environment proves the
   SANDBOX default provider makes ZERO external calls until a provider is
   configured; a repo grep proves no provider is invoked outside the port.
3. A WhatsApp template-message send flows end-to-end in the SANDBOX: row
   created in `outbound_messages` with status transitions, provider
   reference, and cost fields exercised; a FAILED injection drives the
   retry/backoff path exactly per policy.
4. The dispatch resolver honors the preference matrix: a user opting out
   of a module×channel receives nothing on that channel while identical
   events still deliver on opted-in channels (end-to-end fixture test).
5. Daily digest (PP-13): the fixture-based digest job renders the
   per-user "needs attention today" set (overdue invoices, pending
   approvals, low stock, expiring warranties) in AR and EN from templates.
6. Proactive nudges (PP-15): a seeded invoice due in N days triggers the
   reminder exactly once at the configured lead time, honoring
   preferences; early/late/duplicate firings fail the spec.
7. Unified inbox (UX-14): messages and logged calls list per partner with
   filters and AR/EN parity (RTL, 12-template discipline); a logged call
   persists outcome/duration and links partner + user.
8. Calendar integration (IN-17) and contacts sync (IN-18): the OAuth flows
   complete against stubbed providers, an event write lands, and contact
   sync proposes fuzzy matches for review without ever auto-merging.
9. House gates green (CR-36): RLS A1–A10 for the four tables · typecheck ·
   lint · unit · `docs:validate` · i18n parity (~160 keys) · permissions
   drift 263 → 268 · the delivery-log report renders over seeded
   `outbound_messages` with its REPORT_CATALOG row (registry 91) ·
   EXPLAIN budgets for the queue and inbox paths.
10. Completion report `docs/implementation/phases/reports/PHASE-041-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive
    delivered as `ERP_PLATFORM_PHASE041.zip` (OA-07).

## 7. Risks and Constraints

- **External API volatility** — WhatsApp template approvals and provider
  API versions change; mitigated by versioned adapters behind the port, a
  REQUIRES_VERIFICATION flag on approval-dependent behaviors, and the
  SANDBOX default keeping tests hermetic.
- **Send-cost control** — paid channels can silently drain money;
  mitigated by the outbound ledger's cost fields, per-tenant advisory
  quotas with threshold notifications, and a hard cap setting.
- **Secrets handling** — provider credentials and OAuth tokens;
  mitigated by the secret-store discipline (never logged, rotation
  documented, masked settings UI).
- **Deliverability misconfiguration** — unauthenticated email lands in
  spam; mitigated by the DKIM/SPF/DMARC guide plus a per-environment
  verification checklist recorded in the completion evidence.
- **OAuth scope creep** — calendar/contact integrations invite over-broad
  scopes; mitigated by minimal scopes only and explicit per-tenant
  opt-in.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-041-COMPLETION.md`
  (evidence per acceptance criterion, the adapter matrix, the
  network-blocked proof, gate output).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-041 row → COMPLETE;
  `NEXT_ACTION.md` → next eligible phase PHASE-042 (Manufacturing I —
  Wave 2 opens) with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE041.zip`
  (OA-07); the owner continues with «ابدأ تنفيذ المرحلة PHASE-042».
- Handoff notes: this phase completes Wave 1 / Stage 12 — the release-gate
  checklist per CR-38 ("sellable": ZATCA-1 shipped with PHASE-037; OQ-002
  resolved as the owner pricing decision; the payments-ready path staged
  for 056) is recorded in the completion report. For PHASE-042: the
  036-before-042 hard ordering is satisfied on this lineage; the dunning
  letters from PHASE-039 and the demo tenants from PHASE-040 become the
  first live consumers of the configured channels.
