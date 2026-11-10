# External Integrations — Adapter Catalog & Authoring Guide

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

The registry of external integration adapters and the rules for authoring them. An
**adapter** is a versioned implementation of a **port** (a module-owned interface),
isolated from the core per the integration discipline of
[ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) §4: the core never
imports adapter details; adapters read domain data and write their own records (e.g.,
`e_invoicing_submissions`, [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md)).
Status legend: **PLANNED** = specified in this blueprint, not implemented. Nothing here is
implemented against unverified assumptions (§4, the NO-FABRICATION rule).

## 1. Adapter authoring rules (normative)

1. **Port first**: the owning module defines a versioned port interface + typed results +
   error taxonomy; the adapter implements it. Ports live in `packages/contracts`-adjacent
   module code, never inside `apps/`.
2. **Isolation**: core code never references adapter classes, provider names, or wire
   formats. Adapters never write business tables directly — only via domain services or
   their own registry tables.
3. **Credentials**: all secrets via the platform secrets store —
   [../../security/SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md)
   (encryption at rest, scoped access, usage audit, expiry monitoring); never in job
   payloads ([ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) §5), never in
   tenant settings plaintext.
4. **Retry & idempotency contract**: outbound calls are executed by pg-boss jobs —
   idempotent handlers, exponential backoff with cap, dead-letter with alerting
   ([ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md)). Every adapter declares its
   (a) natural idempotency key (provider request id / our submission id), (b) retry
   safety (is a duplicate call harmless? if not, provider dedupe token is mandatory),
   (c) timeout budget, and (d) circuit-breaker policy (failures degrade the feature, not
   the platform).
5. **Observability**: every adapter emits per-call metrics (latency, outcome), structured
   logs with correlation ids, and state-machine transitions on its registry rows
   ([../../architecture/OBSERVABILITY.md](../../architecture/OBSERVABILITY.md)).
6. **Contract tests**: each adapter ships a sandbox/mock contract test (recorded
   interactions); live-provider tests are gated on credentials in staging only.

## 2. Registry

| Adapter | Purpose | Phase | Status | Port / owner |
|---------|---------|-------|--------|--------------|
| **ZATCA e-invoicing** (KSA clearance/reporting) | Regulatory e-invoice generation/signing/submission | PHASE-023 | PLANNED (gated on verified official specs) | `EInvoicingAdapter` · tax module · architecture: [../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) |
| **Egypt ETA** (e-invoice/e-receipt) | Regulatory submission | PHASE-023 (evaluation track) | PLANNED — begins only after official-doc review + decision record | `EInvoicingAdapter` · tax module |
| **Payment provider** (checkout + webhooks for subscriptions) | Tenant card payments, plan checkout | PHASE-014 (adapter + sandbox; manual-invoice fallback mandatory) | PLANNED — provider TBD per [OQ-003](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) | `PaymentProviderAdapter` · billing module |
| **Email (SMTP)** + mailpit (dev) | Invitations, notifications, login alerts | PHASE-003 | PLANNED | `MailerPort` · notifications module ([A-008](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)) |
| **SMS / push (FCM)** | Outbound SMS; Android push notifications | PHASE-022+ | PLANNED | `NotificationChannelPort` · notifications module ([ADR-0014](../../architecture/ADR/ADR-0014-android-expo.md) §4) |
| **Bank statement format** adapters | Parse downloaded statements into `bank_statement_lines` | PHASE-008 | PLANNED (CSV/Excel families first; bank-specific parsers additive) | `StatementParserPort` · treasury module |
| **E-commerce platform** adapters (order/channel import) | Pull orders, push stock/prices | PHASE-023+ | PLANNED | `CommerceChannelPort` · sales module |
| **Shipping providers** | Rate quotes, label printing, tracking | post-MVP | PLANNED (not scheduled) | `ShippingPort` · sales module |
| **Barcode / scale device interfaces** (POS) | Scanner/scale input at the terminal | PHASE-016 | PLANNED | device-side (not a server port — see note §3.9) |

## 3. Per-adapter contracts (sketch + rules)

### 3.1 ZATCA e-invoicing — `EInvoicingAdapter`

```ts
interface EInvoicingAdapter {
  readonly id: 'zatca';  readonly supportedDocTypes: readonly DocumentType[];
  generate(doc: PostedDocumentRef): Promise<GeneratedPayload>;   // payload + hash + QR
  sign(payload: GeneratedPayload, ctx: TenantContext): Promise<SignedPayload>;
  submit(signed: SignedPayload): Promise<SubmissionRef>;          // clearance | reporting
  poll(ref: SubmissionRef): Promise<SubmissionOutcome>;           // ACCEPTED(uuid) | REJECTED(codes)
}
```

Credential handling: authority-issued certificates/CSRs are highest-sensitivity — signing
job access only, usage audited, expiry monitored
([../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §3).
Retries: submission jobs retry with provider request dedupe; authority status is written
to `e_invoicing_submissions` only. **Authority acceptance is NEVER inferred from local
state** — the registry status is the sole source of truth (directive §12).

### 3.2 Egypt ETA — `EInvoicingAdapter` (second implementation)

Same port, same rules. **Evaluation gate**: official API documentation review, enrollment
process confirmation, and an approving decision record BEFORE any implementation
([RISK-007](../../planning/RISK_REGISTER.md),
[../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §4).

### 3.3 Payment provider — `PaymentProviderAdapter`

```ts
interface PaymentProviderAdapter {
  readonly id: string;                                  // decided per OQ-003
  createCheckout(intent: CheckoutIntent): Promise<{ redirectUrl, providerRef }>;
  verifyWebhook(headers: Record<string, string>, rawBody: string): Promise<WebhookEvent | null>;
  refund(ref: ProviderRef, amount: Money): Promise<RefundResult>;
}
```

Webhook verification is signature-based (never trust body claims); checkout intents carry
our `Idempotency-Key` as the provider dedupe token; reconciling webhooks to subscriptions
is a pg-boss job with a natural-key upsert. Manual-invoice fallback must remain functional
even when the adapter is disabled ([A-009](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)).

### 3.4 Email — `MailerPort`

`send(message: TemplatedEmail): Promise<DeliveryReceipt>` — template ids versioned in the
notifications module; failures retry (backoff), then dead-letter + alert. Dev
environment: **mailpit** container; production: SMTP provider via secrets store. Emails
carry no secrets (single-use links only).

### 3.5 SMS / push FCM — `NotificationChannelPort`

`deliver(notification: ChannelMessage): Promise<DeliveryReceipt>` — FCM device tokens come
from the device registry (opt-in per device); SMS providers TBD per market. Delivery is
best-effort with retry + per-tenant quota; template + locale (ar/en) resolved before the
call. Phase-gated with the Android app (PHASE-022+).

PHASE-022 status: the skeleton landed — `NotificationChannelPort`
(`send(request): Promise<{ok, providerMessageId?, error?}>`, the SmtpTransport seam
convention) + `FcmChannelAdapter` in `apps/api/src/modules/notifications/` (disabled
unless `FCM_CREDENTIALS` is set — the DisabledSmtpTransport pattern), the device-token
opt-in surface `PUT /api/v1/devices/:id/push-token` (default OFF), and the fake-FCM
contract tests (locale resolution, opt-in, quota, retry, no financial payloads).

### 3.6 Bank statement formats — `StatementParserPort`

`parse(file: StatementFileRef): ParsedStatement` — pure functions per format family
(CSV/Excel), idempotent per (statement, checksum); unknown/unparseable lines park for
manual mapping (never guessed amounts into `bank_statement_lines`). Format registry grows
per bank; each parser declares columns it requires.

### 3.7 E-commerce platforms — `CommerceChannelPort`

`pullOrders(cursor) / pushPrice(list) / pushStock(levels)` — per-channel credentials
tenant-scoped; import is upsert-by-natural-key (channel order id) + `Idempotency-Key` per
batch; conflict policy for imported orders is **server-decision** (same as any financial
document — no LWW, [ADR-0012](../../architecture/ADR/ADR-0012-offline-sync.md)).

### 3.8 Shipping providers — `ShippingPort` (post-MVP)

Same discipline; not scheduled — listed to reserve the port boundary and prevent ad-hoc
coupling later.

### 3.9 Barcode / scale interfaces (POS, PHASE-016)

Not a server adapter: scanner/scale input is **device-side** (Tauri plugin /
keyboard-wedge handling in the POS client). It appears in this registry to keep the
"peripheral integration" decision visible: no server round-trip may sit in the scanning
hot path; scale formats are validated client-side against item UoM data from the pulled
cache ([../../offline/OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md) row 4).

## 4. NO-FABRICATION rule (binding)

1. **No adapter is implemented against unverified assumptions about a provider's API.**
   Before implementation, the adapter's decision record must cite: the official
   documentation source + version + date ([../../localization/official-sources/](../../localization/official-sources/README.md)),
   sandbox evidence, and for regulatory adapters the compliance-matrix entry
   ([../../localization/compliance-matrix/](../../localization/compliance-matrix/README.md)).
2. Anything unverifiable ships as an explicit `UNVERIFIED` stub that **refuses to
   execute** real submissions (RISK-005 discipline) — never a guessed wire format.
3. The platform never claims external acceptance (authority certification, provider
   approval) from local state: acceptance is exactly what the provider/authority said,
   recorded in the registry — nothing else.
