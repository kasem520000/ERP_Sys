# Completion Report — PHASE-023

> **Status:** COMPLETE (split: registry/substrate COMPLETE; ZATCA adapter + payment
> production cutover + Egypt ETA INCOMPLETE with named unmet items — the gated-shipping
> §2.3 protocol, no silent completion) · **Updated:** 2026-11-05

## Phase ID / Date

PHASE-023 — External Integrations & E-Invoicing Implementations (T1–T14) · 2026-11-05

## Summary

The external-integration substrate ships with the **no-fabrication discipline enforced
end-to-end**: everything the platform can build and prove without unverified official
specifications is live and green; everything gated on external verification (ZATCA
certification, the payment provider contract, Egypt's ETA regime) ships as the honest
stub/pointer with the decision-record trail — exactly what RISK-005/RISK-022/RISK-007
demand.

**Database — migration `0035_external_integrations.sql`** (schema_version 35; drizzle
journal idx 34 — the 0-based convention; four-place manifest consistency incl. the
migrations.spec last-tag pin): the nine-table external-integrations cluster — the
`e_invoicing_submissions` OPERATIONAL expansion (status enum + `SIGNED`/`REPORTED`;
1:N per adapter — the 009 UNIQUE becomes the **partial** unique
`uq_einvoicing_submissions_live` over the live states only, so terminal rows never block
a retry chain via `retry_of_submission_id`; `attempts`/`next_attempt_at` backoff
bookkeeping; `authority_refs`; sealed payload/response artifacts AES-256-GCM encrypted
via `EINVOICING_SECRET_KEY`/`EINVOICING_SECRET_KEY_ID` with the `IDENTITY_SECRET_KEY`
fallback — production fails closed), `e_invoicing_certificates` (the S-10 path-only
registry — uq `secret_path` + shape check, `rotated_from` chain, the 30/14/7 expiry
ladder on `expires_alerted_at`) + the append-only `e_invoicing_certificate_usage`
audit, `e_invoicing_adapter_settings` (per-tenant rollout flags DEFAULT OFF; CHECK
enabled ⇒ enabled_by+enabled_at), `bank_statement_parked_lines` + the seeded
`bank_statement_formats` registry, `commerce_channel_orders`/`commerce_channel_imports`
(natural-key upsert + conflict detail), and `billing_payouts` (CHECK net = gross − fee;
`DRIFT` status + `drift_detail`) — all RLS'd + registered in the isolation attack
suites (OWN_ROW/MISMATCHED_INSERT/NO_UPDATE_GRANT fixtures for the seven tenant-plane
tables) + the ENTITY_CATALOG/DATA_DICTIONARY/CONSTRAINTS/RELATIONSHIPS/TABLES docs.

**The operational registry (T1/T2):** the adapter-neutral state machine (PENDING →
GENERATED → SIGNED → SUBMITTED → ACCEPTED/REJECTED → REPORTED; illegal transitions
rejected in code; self-transitions on live states register attempts without fake churn),
the registry service (reacts to POSTED documents; audit on every transition), the
NON_AUTHORITATIVE compliance-archive payload builder (jurisdiction-pack labels + the
INV-012 summary — zero wire-format knowledge), pg-boss pipeline jobs
(`einvoicing.sign|submit|poll|reconcile` + cert-expiry + reject-spike + dead-letter
watch; idempotent; registration failure degrades the feature, never the platform),
funnel monitoring + the `EInvoiceRejectSpike` evaluation (>5% over 15 min, Sev-2) +
the `einvoice.submission.failed` dead-letter alert.

**Certificates (T5/S-10):** approval-separated audited enroll/rotate, signing-job-only
key access (**no API surface reads key material — asserted**), `CertExpiry` 30/14/7 with
bilingual inbox alerts + status flips, the offboarding purge hook (usage rows first —
the FK chain; DELETE granted on the usage table only for the purge path).

**Rollout (T13):** flags default OFF; the enablement gate = provisioned ACTIVE
certificate + jurisdiction pack (never the platform feature_flags table); flag-off
default asserted.

**ZATCA (T4) — the UNVERIFIED refuse-to-submit stub:** the verification gate
(E_INVOICING §3 — GATE-1 pinned official SDK versions, GATE-2 exercised ZATCA sandbox,
GATE-3 validated sample invoices, GATE-4 legal review) is honestly **NOT_VERIFIED on
every item** (this environment has no access to ZATCA sandbox/official artifacts;
nothing was fabricated): every regulated action refuses with the explicit UNVERIFIED
error naming the four unmet gate items. **DR-001 stays OPEN (option C recommended —
generation-at-launch + the adapter as the fast-follow).** The completion report's
INCOMPLETE clause is what the GA gate reads (MASTER_ROADMAP §GA gate: certified adapter
OR documented launch-segment exclusion).

**Egypt ETA (T9):** NOT_STARTED — the DR-003 draft records the DEFERRED recommendation
(e-invoice scope first; e-receipt after GA evidence) + the fake-eta evaluation harness;
RISK-007 honored (the decision record exists before any code).

**Fake-authority harnesses (T11):** `tests/authorities/fake-zatca` + `fake-eta` drive
the REAL registry + jobs through the submit/accept/reject/timeout/retry/dead-letter
scenario matrix (port-shaped only — zero wire-format knowledge; the SA gate-flip is
scoped + restored inside the harness).

**Treasury parsers (T7):** the `csv-debit-credit` + `csv-with-balances` format FAMILIES
(not bank-specific claims) with parking — raw cells verbatim, amounts never guessed,
balance drift advisory-only — + the parked-lines list/resolve/discard endpoints and the
statement-screen mapping surface.

**Commerce staging (T8):** `CommerceChannelPort` + `FakeCommerceChannel` (deterministic
order stream) + the import service (natural-key upsert `(tenant, adapter, channel id)`,
Idempotency-Key batches, cursor before/after, financial drift ⇒ CONFLICT for explicit
human resolution — never LWW) behind the NEW `sales.commerce.manage` (permission
catalog 243→**244**, owner cross-join + sales-role template grant, permissions-drift
244=244); the `ShippingPort` reserved with a fake.

**Payment hardening (T6):** `refund()` on the sandbox provider port + the
refund-payout-service (`refundSettledPayment` — provider call + `payment.refunded`
event + audit, the invoice stays PAID; `syncPayouts` idempotent by (provider, ref);
`reconcilePayouts` — provider-reported vs platform-computed count+gross per window,
match ⇒ RECONCILED, mismatch ⇒ **DRIFT + detail, never auto-corrected**;
`runPayoutReconciliation` per-ACTIVE-tenant job) + the payout/refund operator endpoints
(`platform.subscriptions.manage`) + the webhook-storm idempotence re-proof + the
A-009/RISK-022 manual-fallback proof (recordManualPayment works while the provider
adapter is untouched). **DR-002 stays OPEN: production cutover INCOMPLETE with the
pointer — sandbox hardened, no production payment claim.**

**Chaos slice (T12):** C-01..C-04 against the REAL submission pipeline + jobs (restart
mid-flight, authority timeout, poison payload, DLQ exhaustion + the alert path) —
blocking inside the DB suite; the pre-existing chaos-matrix 19/19 untouched + green.

**Web (T14 surface):** `/[locale]/settings/tax/einvoicing` (per-state registry,
adapters + their verification honesty — UNVERIFIED renders as such, cert countdowns),
`/[locale]/platform/einvoicing-funnel` (states, latency p50/p95, rejection reasons,
sandbox-vs-prod health), the parked-lines mapping surface, checkout result states —
i18n AR/EN parity **3284=3284**.

## Decision records

- **DR-001 (ZATCA scope at GA)** — OPEN; option C recommended. T4 ships the refusing
  stub; the verification log records GATE-1..4 NOT_VERIFIED with evidence slots.
- **DR-002 (payment provider)** — OPEN; T6 = sandbox hardening only; the production
  cutover is the INCOMPLETE item with the DR pointer.
- **DR-003 (Egypt ETA scope)** — OPEN (draft, DEFERRED recommendation); opened by this
  phase (T9); implementation NOT_STARTED.

## INCOMPLETE items (named, per the §8 protocol — never silently omitted)

1. **ZATCA real adapter** — unmet: GATE-1 pinned official spec/SDK version; GATE-2
   exercised sandbox; GATE-3 validated sample invoices; GATE-4 legal review (all
   NOT_VERIFIED — no external access in this environment; evidence slots recorded in
   the verification log). Follow-up: the fast-follow adapter once the gate passes.
2. **Payment production cutover** — DR-002 OPEN; the chosen provider's adapter,
   production credentials (S-09), real webhook shape, and fee schedule belong to the
   cutover release. Sandbox depth only.
3. **Egypt ETA adapter** — NOT_STARTED by decision (DR-003 DEFERRED draft).
4. **Live-provider contract tests** — staging-credentials-gated by design
   (integrations/README §1.6); recorded, not fabricated.

## Notable engineering findings (recorded honestly)

- **Partial-unique arbiter:** PostgreSQL 42P10 — a partial unique index requires the
  matching WHERE in the ON CONFLICT target; both tax stores carry it.
- **Fixture-namespace collision (the phantom payout DRIFT):** the payout spec's first
  "unique" tenant `4949…` was readonly-sweep's `TENANT_RO` — its leftover PAID
  `provider_webhook` invoice leaked into the platform-computed reconciliation count
  (provider 3 vs platform 4). Root-caused by pair-bisection, fixed with the verified-free
  `5454` block; the full suite 1990/1990 after.
- **pg-boss `create_queue` deadlock** (unhandled rejection in full-suite runs): proven
  **pre-existing** by reproduction at PHASE-022 HEAD (clean worktree, same spec pair) —
  a queue-creation race at AppModule boot, benign for results (all suites exit 0);
  flagged as a PHASE-024 hardening candidate, not fixed mid-delivery.
- **ADR-0009 blanket Math ban:** the four time/window computations (cert days-left,
  15-min/1-hour dedupe keys, rejection per-mille) re-expressed with the house `| 0`
  integer-division pattern (cf. rate-limiter.ts) — no floating-point rounding anywhere.
- **CURRENT_SHIPPED_PHASE 021 → 023** (022 added no plan keys): the synthetic
  phase-gate proofs moved to PHASE-024; the runtime feature registry (FEATURE_DEPS)
  gained the three new keys with their catalog dependencies (BR-040 closure cascade).

## Test evidence (all green, exact counts)

- **DB suite: 135 files / 1990 tests** (PHASE-022: 128/1898 → +7 files/+92 tests) —
  incl. `submissions-registry` 12, `certificates` 9, `fake-authority` 6, `spoof` 5,
  `parsers` 7, `commerce` 5, `payout-reconciliation` 6, `chaos-submissions` 5 (C-01..04),
  isolation `identity-isolation` 930/930 with the new attack fixtures.
- **Unit: 26 files / 280 tests** (incl. migrations manifest 4/4, permissions-drift 5/5,
  template-prerequisites phase-pin 023).
- **Web:** typecheck ✅; i18n ar=en=3284 (3244 → +40).
- **Suites untouched:** sync-core 36/36, desktop 274/274, mobile 393, chaos-matrix 19/19.

## Gates (final sweep)

```
typecheck 8/8 · lint 8/8 · depcruise 0 violations (1297 modules) ·
unit 26/280 · test:db 135/1990 · permissions-drift 244=244 ·
i18n 3284=3284 · docs:validate 29/29 · check:rls (in-suite runChecks) green ·
migration-tests → the documented sandbox substitution (pnpm test:db against the
embedded PostgreSQL 16 — no docker daemon; per the script's own header)
```

## Budgets

DB suite wall-clock ≈ 4 min (the ≤ 15 min budget holds); no new runtime dependencies
added by this phase (the harnesses ride the existing pg/files/boss infrastructure).

## Manual verification pointers

- `/[locale]/settings/tax/einvoicing` — the UNVERIFIED adapter honesty + cert countdowns.
- `/[locale]/platform/einvoicing-funnel` — the live funnel shapes (states/latency/reasons).
- Treasury statement import with a malformed row → the parked-lines surface.
- Operator payouts surface — DRIFT renders the reported-vs-computed detail.

## Handoff

**Next eligible phase: PHASE-024 — Security Hardening & Compliance Review** (identify
only). The hardening phase consumes the adapter surface as pen-test scope, re-validates
rate limits on webhook ingress, and inherits the two flagged follow-ups: the pg-boss
queue-creation race at boot + the verification-gate evidence slots (the moment external
access exists, the ZATCA gate items flip and the adapter track unlocks). Any spec drift
discovered later reopens the verification log first, code second.
