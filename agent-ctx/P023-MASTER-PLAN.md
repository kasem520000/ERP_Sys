# PHASE-023 Master Plan — External Integrations & E-Invoicing Implementations

> Spec: `docs/implementation/phases/PHASE-023.md` (T1–T14) · Protocol: verification gate +
> gated-shipping rules (§2.3) govern everything below.

## 0. Gating reality (read first)

- **DR-001 (ZATCA scope) = OPEN** → option C recommended; adapter ships as the
  `UNVERIFIED` refuse-to-submit stub unless the verification gate passes.
- **Verification gate (E_INVOICING §3)**: requires pinned official SDK versions +
  exercised ZATCA sandbox + validated sample invoices + legal review, all with
  archived official-source evidence. **This environment has no access to ZATCA
  sandbox/official SDK artifacts** → every gate item is honestly NOT_VERIFIED →
  T4 ships the refusing stub; T3 records the checklist + evidence slots verbatim.
- **DR-002 (payment provider) = OPEN** → T6 hardens the SANDBOX adapter (refund flow,
  payout/fee reconciliation, webhook-storm idempotence, fallback proof) and the
  production cutover is the INCOMPLETE item with the DR-002 pointer.
- No compliance claim anywhere: completion report marks ZATCA adapter + payment
  production cutover INCOMPLETE with named unmet items; IMPLEMENTATION_STATUS records
  the split (no silent completion).

## 1. Database — migration `0035_external_integrations.sql`

1. **`e_invoicing_submissions` expand** (operational per spec §2.1):
   - status enum + `SIGNED`, `REPORTED` (DATA_DICTIONARY already documents both);
   - new columns: `attempts`, `next_attempt_at`, `authority_refs jsonb`,
     `payload_file_id`, `response_file_id` (→ files), `reported_at`, `last_error_code`;
   - UNIQUE `(tenant_id, source_type, source_id)` → `(tenant_id, source_type, source_id, adapter_id)`
     (RELATIONSHIPS.md: 1:N per adapter; registry idempotency = one row per doc×adapter);
   - retry-sweep partial index on `(status, next_attempt_at)`.
2. **`e_invoicing_certificates`** (tenant-owned, RLS): secret-store PATH + metadata only —
   key material never in this table (encrypted blob lives in the files module, path
   `einvoicing/{jurisdiction}/{tenant}/…`); status ACTIVE/EXPIRING_SOON/EXPIRED/REVOKED.
3. **`e_invoicing_certificate_usage`** (tenant-owned, append-only, RLS): every
   decrypt/sign (cert id, submission id, operation, key_version) — the signing-volume
   dashboard substrate.
4. **`e_invoicing_adapter_settings`** (tenant-owned, RLS): `(tenant_id, adapter_id)`
   UNIQUE, `enabled` DEFAULT FALSE — the T13 per-tenant rollout flag (jurisdiction-
   scoped; the global `feature_flags` table stays platform-only).
5. **`bank_statement_parked_lines`** (tenant-owned, RLS): raw cells + parked reason +
   status PARKED/RESOLVED/DISCARDED + resolved link — never a guessed amount.
6. **`bank_statement_formats`** (global reference, seeded, read-only): the shipped
   parser-format registry rows (format families, not bank-specific claims).
7. **`commerce_channel_orders`** (tenant-owned, RLS): upsert-by-natural-key
   `(tenant_id, channel_adapter_id, channel_order_id)`; status IMPORTED/CONFLICT/RESOLVED
   with `conflict_detail` (server-decision, no LWW).
8. **`commerce_channel_imports`** (tenant-owned, RLS): batch bookkeeping — Idempotency-Key
   per batch, cursor before/after, pulled/imported/skipped/conflict counts.
9. **`billing_payouts`** (tenant-owned, RLS): provider payout batches (gross/fee/net,
   status PENDING/RECONCILED) — the T6 reconciliation substrate.
10. RLS macro on every tenant table; grants per house style; `_schema_state` → 35;
    rls-attacks suite + migration specs cover the new tables.

## 2. Module layout (apps/api/src/modules)

- **`tax/submissions/`** (T1+T2): `state-machine.ts` (legal transitions only),
  `registry-service.ts` (react to POSTED docs; payload/response encrypted via files;
  audit on every transition), `payload-builder.ts` (jurisdiction-pack compliance
  archive from the INV-012 summaries — platform-neutral, labeled NON_AUTHORITATIVE),
  `jobs.ts` (pg-boss `einvoicing.sign|submit|poll|reconcile` + retry/backoff caps +
  DLQ alert), `monitoring.ts` (funnel stats + `EInvoiceRejectSpike` evaluation).
- **`tax/certs/`** (T5): enrollment/rotation trigger service (audited,
  approval-separated), signing-job-only read path (API role has NO read surface for key
  material — asserted), usage rows, `CertExpiry` 30/14/7 evaluation, offboarding purge
  hook.
- **`tax/adapters/zatca/`** (T4): `UNVERIFIED` refusing stub — every regulated action
  refuses with the explicit UNVERIFIED error naming the unmet gate items (asserted).
- **`tax/rollout/`** (T13): adapter-settings service — flags default OFF; enablement
  gate = provisioned ACTIVE certificate + jurisdiction pack; flag-off default asserted.
- **`treasury/parsers/`** (T7): two format-family adapters (`csv-debit-credit`,
  `csv-with-balances`) + parking in the import service (unparseable rows park; manual
  mapping resolves; re-import idempotent per checksum — unchanged).
- **`sales/adapters/commerce/`** (T8): `CommerceChannelPort` + `FakeCommerceChannel`
  (deterministic order stream) + import service (upsert by channel order id,
  Idempotency-Key per batch, server-decision conflicts); `ShippingPort` + fake (reserved).
- **`tenancy/application/billing/`** (T6): `refund()` on the sandbox port + refund
  service, payout batch generation + reconciliation job, webhook-storm idempotence
  re-verified, manual-fallback-with-adapter-disabled test.
- **`tests/authorities/`** (T11): `fake-zatca/` + `fake-eta/` harnesses — scenario
  matrix submit/accept/reject/timeout/retry/DLQ driving the REAL registry+jobs.

## 3. API surface (route-permissions.ts + controllers)

- GET `/api/v1/tax/einvoicing/submissions|/submissions/:id|/adapters` (exist — 009);
- POST `/api/v1/tax/einvoicing/certificates/enroll|rotate` (admin trigger — no read),
  GET `/api/v1/tax/einvoicing/certificates` (metadata + countdowns only),
- GET `/api/v1/tax/einvoicing/funnel` (platform ops funnel),
- POST `/api/v1/tax/einvoicing/settings/:adapterId` (enable/disable — gated),
- treasury: GET/POST parked-lines endpoints (list/map/discard),
- sales: POST `/api/v1/sales/commerce/import` + GET imports/orders (behind port),
- billing: sandbox refund + payout endpoints (hardening; no production claim).

## 4. Web screens (AR+EN, i18n parity)

1. `/[locale]/settings/tax/einvoicing` — tenant status surface (submissions by state,
   per-document registry status, adapters + their verification honesty, certificate
   countdowns);
2. `/[locale]/platform/einvoicing-funnel` — ops funnel (submissions by state, latency,
   rejection reasons, cert countdowns, sandbox-vs-prod health);
3. checkout result states on `/[locale]/checkout` (complete PHASE-014 flows);
4. parked-lines mapping surface on the treasury statement screens.

## 5. Waves (Task tool agents where parallel)

- W1: migration 0035 + submissions (state machine/registry/jobs/payload builder) + certs.
- W2: fake-authority harness (fake-zatca/fake-eta) + ZATCA refusing stub + rollout gate.
- W3: bank parsers + parking UI contract + commerce/shipping ports + payment hardening.
- W4: monitoring funnel + alerts + web screens (4) + i18n keys AR/EN.
- W5: chaos slice C-01..C-04 with submission jobs (SYNC_TESTS §7 row).
- W6: docs — verification log (T3 honest NOT_VERIFIED), DR-003 ETA draft (T9),
  compliance-matrix sa.md/eg.md rows, TROUBLESHOOTING §10 fill, MONITORING LIVE row,
  FEATURE_CATALOG status, ENTITY_CATALOG/TABLES/DATA_DICTIONARY, IMPLEMENTATION_STATUS
  split, PHASE_ACCEPTANCE_CRITERIA copy, CHANGELOG, CURRENT_STATE.

## 6. Gates (all green before completion report)

`pnpm typecheck` · `lint` · `lint:depcruise` · `test` (unit) · `test:db` (full suite)
· `check:permissions-drift` · `docs:validate` · `check:i18n-parity` · `check:rls`
· `migration-tests`.

## 7. Honest deferrals (INCOMPLETE with named items)

- ZATCA adapter real implementation — unmet gate items: (a) pinned official spec/SDK
  version, (b) sandbox exercised, (c) sample invoices validated, (d) legal review; all
  NOT_VERIFIED (no external access); DR-001 stays OPEN (slot recorded).
- Egypt ETA adapter — evaluation pack + DR-003 draft (DEFERRED recommendation);
  implementation not started (RISK-007 honored).
- Payment production cutover — DR-002 OPEN; sandbox hardened; cutover INCOMPLETE.
- Live-provider contract tests — staging-credentials-gated by design (integrations
  README §1.6) — recorded, not fabricated.
