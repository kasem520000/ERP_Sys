# PHASE-041 Completion Report — Communications Hub

> **Status:** COMPLETE · **Date:** 2026-11-12 · **Phase doc:**
> [../PHASE-041.md](../PHASE-041.md) · **Register:** [CR-11](../../../planning/COMPLETENESS_REGISTER.md)
> · **Triple flip:** this report + the phase doc header + the IMPLEMENTATION_STATUS
> row flipped together (CR-48) · **Wave 1 closes here** — 035…041 all COMPLETE.

## 1. Executive summary

PHASE-041 delivered the communications hub the audit demanded (H-22 + N-06/N-07/N-08 +
IN-13…IN-18 + FD-30 + TB-23 + UX-14 + PP-13/PP-15): every outbound send — email,
WhatsApp, SMS, from any producing surface — is a ledger row through the channel port
(BR-067), with tenant-editable bilingual templates (the "no email_templates, strings
in code" gap closed), the notification-preference matrix honored end-to-end, the
per-user daily digest and deadline-ahead nudges, the unified inbox with call logging,
the Google/Outlook calendar connect with review-only contacts sync, and the
delivery-log report. **The two pre-documented handoffs landed:** the PHASE-039 EMAIL
dunning letters now ride a REAL ledger row (the register's SENT stamp is backed by
the outbox transition), and the PHASE-036 QUEUED WHATSAPP/SMS letters enqueue +
deliver + flip SENT through the pipeline (the source handler is the register's
evidence). **Migration 0064 · schema_version 64 · 4 new RLS'd tables · permissions
267 → 272 · feature keys +6 · rules BR-067 · report registry 90 → 91 · i18n +139
keys/locale.** The full-AppModule HTTP smoke gate caught (and this phase fixed) a
real DI regression the manually-constructed specs could not see.

## 2. Mandatory code-evidence checklist (CR-48)

**New tables (SQL migration + Drizzle mirror + ENTITY_CATALOG row — CR-36 a):**

| Table | Migration | schema.ts (Drizzle) | Catalog |
|---|---|---|---|
| message_templates | 0064_communications_hub.sql §1 (line 63) | `messageTemplates` — **schema.ts:944** | §"onboarding/communications" (228 → 232) |
| outbound_messages | 0064 §2 (line 115) | `outboundMessages` — **schema.ts:979** | (same section) |
| notification_preferences | 0064 §3 (line 197) | `notificationPreferences` — **schema.ts:1038** | (same section) |
| communication_log | 0064 §4 (line 228) | `communicationLog` — **schema.ts:1066** | (same section) |

**Migrations & manifest:** journal idx 63 appended (64 entries); the manifest
`src/infra/db/migrations.ts` carries the tag with lineage; `migrations.db.spec.ts`
7/7 (apply + re-apply no-op + RLS catalog drift + ownership + role defaults); the
manifest pin re-anchored to `0064_communications_hub` (the golden re-pin pattern).
§5 RLS = the house triple (apply_tenant_policy + purge path) ×4; §8 the
preference-default seed (idempotent, `ON CONFLICT DO NOTHING` — materialized lazily
by the first read, the documented decision); §9 the five permission keys; §10 the
six feature grants (templates/outbound ALL plans; whatsapp/sms/email_providers/
calendar_integration business+enterprise — the 0051 tier-4 precedent).

**Core services (the `communication` module, 6,989 lines):**
- `application/providers/*` — the eight adapters behind fake-transported contract
  tests: whatsapp-business (per-sender Graph template messages), unifonic/msegat/
  twilio (SMS), smtp (the existing Seam bridge)/sendgrid/ses (SigV4)/mailgun
  (EMAIL) + the SANDBOX default (zero external calls by construction).
- `application/provider-http.ts` — the ONE transport seam (`await fetch(` lives
  here alone — the grep gate proves it).
- `application/provider-registry.ts` (379) + `provider-config.ts`/`.service.ts` —
  BR-067's resolution (selected AND fully-credentialed → live; else SANDBOX with
  the honest blockedOnCredentials), sealed credentials (never returned — only
  configured-state), per-market senders, the daily hard cap, tier-4 gates at save.
- `application/template-catalog.ts` (354) + `template-service.ts` (354) — the
  builtin bilingual dunning/digest/nudge catalog + tenant overrides (channel ×
  locale × module, typed variables) with FAIL-CLOSED rendering (preview errors =
  send errors).
- `application/outbox/outbox-service.ts` (487) — the pipeline: queue → provider →
  QUEUED/SENT/DELIVERED/FAILED with the status-evidence CHECK, provider ref, cost
  fields, bounded retries with backoff, the source-handler registry (the 039
  register flip), per-user digests/nudges enqueued through the same ledger.
- `application/preferences-service.ts` (388) — the TB-23 matrix (user → tenant
  default → code; paid channels off by default) + the dispatch resolver the
  pipeline consults per (recipient, module, channel).
- `application/digest-service.ts` (344) — PP-13 (the needs-attention-today digest:
  overdue invoices, pending approvals, low stock, expiring warranties, AR+EN from
  templates) + PP-15 (invoice-due/task/contract-renewal nudges with per-type lead
  times, exactly-once per window).
- `application/inbox-service.ts` — the UX-14 unified timeline (partner/kind/
  channel/direction filters) + the IN-16 call logger (outcome/duration linked to
  partner + user; the logger edits their own rows — log semantics).
- `application/calendar-port.ts` (294) + `calendar-service.ts` (579) — IN-17/IN-18:
  Google/Outlook OAuth (anti-CSRF state digest, tokens SEALED in tenant_settings,
  minimal scopes — calendar.events / Calendars.ReadWrite+Contacts.Read only), task
  event writes, the OPT-IN contacts sync with exact email/phone LINK + fuzzy name
  candidates (Levenshtein ≥ 0.72, best-first, capped 3), a bounded review queue
  (cap 200), identity-aware dedupe (decisions never re-proposed), idempotent
  accept (no duplicate contact insert) — NEVER an auto-merge.
- Presentation: providers/templates/preferences/inbox/calendar controllers — 20
  route-permission rows (matrix §3.19).

**The two documented handoffs (the phase doc's pre-flagged attention points):**
- **039 EMAIL (charged but waiting):** `DunningService` now injects the pipeline;
  EMAIL letters enqueue + mark SENT in the same step — the register's SENT stamp
  is backed by a REAL `outbound_messages` row (source_type DUNNING_LETTER +
  source_id = the letter row; the previously-billed messages keep their register
  semantics, now with ledger evidence).
- **036 WHATSAPP/SMS QUEUED:** the channels now exist behind the port — letters
  enqueue, the worker delivers through the (SANDBOX-default) provider, and the
  registered source handler flips the register SENT on the ledger's transition;
  a FAILED send keeps the letter QUEUED (the error lives on the ledger row,
  retries per policy — the register never fabricates a send).

**Web (T-10):** `apps/web/app/[locale]/settings/communication/page.tsx` (103) +
`components/communication-settings-workspace.tsx` (858 — templates: the effective
catalog with override/builtin badges + the override editor + the fail-closed
preview; providers: the BR-067 selection with live/sandbox/blocked badges + the
sealed-credential editor (state-only) + per-market senders + the daily cap;
defaults: the tenant-default matrix) and `apps/web/app/[locale]/communication/
inbox/page.tsx` (82) + `components/communication-inbox-workspace.tsx` (503 — the
filtered timeline, the call logger, my-preferences). NAV: `settings.communication`
(order 85) + `communication.inbox` (home, order 30 — the notifications-inbox
precedent, no feature key); command palette inherits (OA-04);
NAVIGATION_MODEL §1.7; i18n **+139 AR/EN pairs** (5,109 → 5,248 = 5,248, parity
gate green).

**Reports (T-11):** `communication.outbound_delivery_log` (REPORT_CATALOG §7 row;
registry 90 → 91) — every send a row with the outbox-cost-shape +
outbox-status-vocabulary block-on-fail assertions; the module-owned query surface
joins the registry (`communication` in SOURCE_MODULES + phase matrix 41); OA-06
EXPLAIN budgets: the worker's claim scan, the per-partner + tenant-wide inbox
lists, the report window (seeded + ANALYZEd — the 037 either-index precedent on
the queue path).

**Docs (T-12):** `docs/operations/EMAIL_DELIVERABILITY_GUIDE.md` (the
DKIM/SPF/DMARC per-provider DNS tables, the per-environment verification
checklist, the credential rotation + revoke-first discipline); BR-067 in
BUSINESS_RULES.md; DATA_DICTIONARY §20 (the send-status law, the template-variable
registry, the preference resolution, the call vocabulary, the source linkage).

**Specs (the 041 wave, 61 tests):**
- `__tests__/adapter-contract.spec.ts` (27) — every adapter's wire shape behind
  fake transports, the network-blocked SANDBOX proof (a poisoned fetch stays
  untouched through a full sandbox send), the provider registry gates, and the
  TWO grep proofs (provider wire markers + `await fetch(` outside the seam).
- `__tests__/{provider-config,template-service,calendar-matching}.spec.ts` (25) —
  BR-067 resolution, the sealed write, catalog shapes, template rendering
  fail-closed, the matching rules (exact/ambiguous/fuzzy/short-name).
- `src/__db__/communication/*` (27) — outbox 8 (the SANDBOX end-to-end with
  status transitions + provider ref + cost, the FAILED → backoff → retry ladder,
  the dunning handoff), preferences 4 (the resolver end-to-end: opt-out blocks
  the channel while others deliver), digest-nudges 4 (AR+EN digest render, the
  exactly-once lead-time window with early/late/duplicate fails), inbox 3, calendar
  4 (the OAuth flow against the stub, event writes, the never-auto-merge review),
  explain-budgets 4.
- `src/__db__/reporting/outbound-delivery-log.spec.ts` (6) — renders over seeded
  sends, filters narrow, the tenant-isolation probe, the deny path.
- The isolation A-suite: the four tables registered in `tables.registry.ts` +
  OWN_ROW/MISMATCHED_INSERT probes — 1,290 isolation tests green (+24).

## 3. Acceptance criteria vs. evidence (§6 of the phase doc)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Migration applies cleanly; 4 tables RLS'd; Drizzle + catalog parity (228); defaults seed idempotently | 0064 in the 64-entry chain (migrations.db.spec 7/7); catalog 228 → 232; the A-suite triple; the §8 seed is `ON CONFLICT DO NOTHING` (re-run no-op, spec-verified in preferences.db.spec) |
| 2 | Adapter honesty (BR-067): suite behind fake transports + network-blocked SANDBOX zero-call proof + the no-provider-outside-the-port grep | adapter-contract.spec 27/27 — the poisoned-fetch sandbox send + BOTH grep gates (wire markers + fetch seam) |
| 3 | A WhatsApp send flows end-to-end in the SANDBOX: row + transitions + provider ref + cost; a FAILED injection drives the retry/backoff exactly per policy | outbox.db.spec 8/8 (the status-evidence CHECKs are the DB floor; attempts/max/next_attempt_at exercised) |
| 4 | The dispatch resolver honors the matrix: opt-out blocks the module×channel while identical events deliver on opted-in channels | preferences.db.spec 4/4 (the end-to-end fixture) |
| 5 | Daily digest renders the needs-attention set in AR and EN from templates | digest-nudges.db.spec (the four-bucket render, template-sourced) |
| 6 | Nudges fire exactly once at the configured lead time, honoring preferences; early/late/duplicate fail | digest-nudges.db.spec (the window probe — exactly-once deduped by id) |
| 7 | Unified inbox: messages + calls per partner with filters and AR/EN parity; a call persists outcome/duration + links partner + user | inbox.db.spec 3/3 + the T-10 web surface (RTL + the 12-template discipline via the house components) |
| 8 | Calendar + contacts sync: OAuth flows complete against stubs, an event write lands, fuzzy proposals for review — never auto-merge | calendar.db.spec 4/4 + calendar-matching.spec 6/6 (the idempotent accept + identity-aware dedupe on top of the doc's minimum) |
| 9 | House gates green: RLS A1–A10 · typecheck · lint · unit · docs:validate · i18n parity · permissions drift · the delivery-log report + REPORT_CATALOG row (registry 91) · EXPLAIN budgets | §5 below — all green; drift **272 = 272** (the doc's "263 → 268" predates 039/040 — the actual line is 265 → 267 → 272, recorded as deviation D-1); registry 91; EXPLAIN 4/4 |
| 10 | Completion report + IMPLEMENTATION_STATUS flip + the OA-07 archive | this file; the status row flipped; `ERP_PLATFORM_PHASE041.zip` |

## 4. Deviations & decisions (documented)

- **D-1 — the phase doc's cumulative counters were authored pre-039/040.** The
  doc's §4 numbers (migration `0059`, catalog 224 → 228, permissions 263 → 268,
  registry 90 → 91) predate the two intervening phases. The delivered reality:
  migration **0064** (journal 63 → 64), catalog **228 → 232**, permissions
  **267 → 272** (the doc's five keys are exactly what landed — 039's 265 and
  040's 267 came first), registry **90 → 91** (as predicted). The phase doc's
  prose scope is unchanged; only the counters moved. This report's numbers are
  the authoritative ones.
- **D-2 — provider configuration rides `communication.templates.manage`.** The
  phase's five-key budget has no dedicated provider key and "provider management
  beyond selection + credentials" is explicitly out of scope — the settings back
  office hub key owns it (documented in the controller's design note). The
  per-channel tier-4 entitlement still fires SERVER-SIDE at save time (a starter
  tenant cannot even save a paid selection).
- **D-3 — `message_templates.variables` CHECK is shape-only.** The phase doc's
  "typed variables" survive as the jsonb array-of-objects shape CHECK + the
  SERVICE-layer typed validation (name regex, required flags, the fail-closed
  render); a subquery-based CHECK is illegal in PostgreSQL (the T-01 drizzle
  diagnosis — recorded here for the ledger).
- **D-4 — the calendar connect has NO sidebar item.** The OAuth + review flows
  surface from the task screens and API (`communication.calendar.connect`
  routes); NAVIGATION_MODEL §1.7 records the decision (the notifications-inbox
  self-plane precedent applies to the INBOX, not the admin connect).
- **D-5 — the sync-surface assessment (CR-36 g).** The inbox + preference
  surfaces ride the authenticated API (any client can read `communication/inbox`
  + `preferences/me`); the mobile notification feeds are UNCHANGED (the in-app
  leg reuses the existing notifications machinery); the outbound ledger projects
  read-only; provider configuration is **online-only — N/A-recorded** (no
  offline client should ever hold provider credentials or OAuth tokens).
- **D-6 — the 0064 seed needed the definer window.** The §8 preference-default
  seed runs as `erp_migrate` AFTER RLS activation and cannot see tenant rows;
  the migration uses the house `erp_definer` (NOLOGIN BYPASSRLS) window for the
  seed then revokes — the same pattern as the 0061 diagnosis (recorded in the
  migration's §8 comment).
- **Boot regression found + fixed (the gate that earned its keep):** the T-05
  dunning handoff's fifth constructor param lacked the explicit `@Inject`
  (invisible to the manually-constructed specs — esbuild never emits
  `design:paramtypes`) and the full-AppModule HTTP smoke crashed with
  UndefinedDependencyException. Fixed with `@Inject(OutboxService)` +
  `@Optional()` (commit 9f47f16); identity-http 12/12 green again.

## 5. Gate evidence (the full sweep)

- **typecheck:** api 0 errors · web 0 · contracts 0 · desktop 0.
- **lint:** api clean · web clean.
- **unit:** api **576/576** (51 files) · web 73/73 · contracts 56/56.
- **isolation (RLS A1–A10):** **1,290/1,290** (+24 for the four 041 tables).
- **migrations:** 7/7 (the 64-entry chain; re-apply no-op).
- **HTTP smoke:** identity-http 12/12 (after the D-boot fix).
- **communication DB specs:** 27/27 · **reporting:** delivery-log 6/6 + golden
  6/6 + consolidation 50/50 + reporting-unit 42/42 · **dunning regression:**
  16/16.
- **docs:validate:** 33/33. **i18n parity:** 5,248 = 5,248 (AR = EN; +139).
- **permissions drift:** 272 = 272 (seed = matrix; the drift checker's
  SEED_PATHS + the identity-flows count re-pinned).
- **report registry:** 91 contracts (the unit meta-test + wiring + golden +
  industry-018/019 + consolidation pins all re-anchored).

## 6. Delivery

The per-phase archive `ERP_PLATFORM_PHASE041.zip` (OA-07) accompanies this
report; the tree is at commit `9f47f16` (+ this report's flip commit). Wave 1
(035–041) is now COMPLETE — the next phase is PHASE-042 (Manufacturing I —
Routing & Work Centers), the Wave 2 opener, pending the owner's review of this
closing wave.
