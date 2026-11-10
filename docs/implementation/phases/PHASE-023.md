# PHASE-023 — External Integrations & E-Invoicing Implementations

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-023
- **Title:** External Integrations & E-Invoicing Implementations
- **Objective:** Implement the external-adapter layer: regulatory e-invoicing (ZATCA
  KSA primary; Egypt ETA evaluation track), the production payment-provider checkout
  completing PHASE-014's sandbox, expanded bank-statement format adapters, and the
  e-commerce/shipping adapter ports with fakes. This is **the no-fabrication phase**:
  no e-invoicing adapter is written against unverified assumptions, and no compliance
  or certification claim is ever made without evidence
  ([E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §3,
  [integrations/README.md](../../api/integrations/README.md) §4). The ZATCA adapter is
  gated by the hard verification checklist AND the scope decision record
  [DR-001-zatca-scope-and-timing.md](../../decisions/compliance/DR-001-zatca-scope-and-timing.md);
  if the gate is not passed, the adapter ships as an `UNVERIFIED` stub that refuses to
  submit and the phase completes its non-regulatory scope with explicit INCOMPLETE
  status rules for the gated remainder.
- **Business value:** KSA/UAE launch tenants get production card checkout and richer
  bank reconciliation; the platform gains the submission registry, state machines, and
  monitoring that make ANY authority or provider integration safe to operate — and it
  gains them without betting the GA date on external certification lead times
  (RISK-005, RISK-007).

## 2. Scope

In scope:

1. **Submission registry + state machine** per E_INVOICING_ARCHITECTURE §2/§6:
   `e_invoicing_submissions` (schema designed in PHASE-009 — catalog marks
   "023 (schema 009)") operational with the lifecycle
   `PENDING → GENERATED (payload built) → SIGNED (where applicable) → SUBMITTED →
   ACCEPTED (reference/UUID stored) / REJECTED (reason codes; user action) → REPORTED`
   (reporting-mode flows); retries exponential-capped, dead-letter alerting, full
   audit; raw payloads/responses stored as encrypted files via tenant-scoped signed
   URLs; **a document's official validity never depends on local state — the registry
   status is the sole source of authority truth**.
2. **ZATCA (KSA) adapter** behind the `EInvoicingAdapter` port — implementation begins
   ONLY after the **verification gate** passes
   ([E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §3):
   (a) official ZATCA specifications/SDK **version pinned**
   ([official-sources/README.md](../../localization/official-sources/README.md) —
   sandbox docs + exact SDK versions recorded in the verification log), (b) sandbox
   environment exercised, (c) sample invoices validated, (d) legal review of
   invoice-content requirements per current official docs; two-person rule
   ([compliance-matrix/README.md](../../localization/compliance-matrix/README.md) §4).
   Implementation scope per
   [DR-001](../../decisions/compliance/DR-001-zatca-scope-and-timing.md) (status OPEN —
   it is THE gating decision record): generation-phase features (serialized invoices,
   QR TLV-base64 encoding, invoice hash, anti-tampering, cryptographic stamp per
   official specs) and integration-phase features (standard invoices → **clearance**;
   simplified B2C → **reporting**; device/certificate enrollment; authority-issued
   certificate signing; submission APIs with UUIDs; cleared XML/PDF handling) — as
   applicable to the taxpayer segment DR-001 selects. Authority counters (e.g., ICV)
   are stored as compliance payload fields, never replacing platform document identity
   (ADR-0006; sa.md §5).
3. **Gated-shipping rules (explicit INCOMPLETE semantics)**: if DR-001 is undecided or
   the verification checklist has unpassed items at implementation time, this phase
   ships: the full registry/state machine/jobs/monitoring, the payload builder for
   generation-phase features where verifiable, and the adapter as an **`UNVERIFIED`
   stub that refuses real submissions** (never a guessed wire format —
   integrations/README §4 rule 2). The completion report then marks the ZATCA adapter
   line **INCOMPLETE** with the exact unmet checklist items and the DR-001 follow-up
   slot; the phase is COMPLETE only for the ungated scope, and
   [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) records the
   split state per its update protocol (no silent completion).
4. **Certificates & secrets** per
   [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) §6 (S-10, HIGHEST):
   tenant-scoped encrypted storage `einvoicing/{jurisdiction}/{tenant}/…`;
   **signing-job-only access** (the API role cannot read key material; platform admins
   can only trigger enrollment/rotation workflows); usage audit for every decrypt/sign
   (tenant, doc, submission id, key version) with signing-volume dashboards;
   **expiry monitoring with 30/14/7-day alerts** (CertExpiry,
   [MONITORING.md](../../operations/MONITORING.md) §3); renewal follows the authority's
   re-enrollment process; key material never in exports/backups; tenant offboarding
   purges certificate paths.
5. **Retry, dead-letter, alerting** per E_INVOICING_ARCHITECTURE §1/§7 and the adapter
   authoring rules (integrations/README §1.4): pg-boss jobs sign → submit → poll →
   retry → reconcile → alert; each adapter declares its natural idempotency key,
   duplicate-call safety (provider dedupe token where a duplicate is not harmless),
   timeout budget, and circuit-breaker policy (failures degrade the feature, not the
   platform); `einvoice.submission.failed` → notifications; dead-letter growth alerts.
6. **Egypt ETA evaluation track** per E_INVOICING_ARCHITECTURE §4 and
   [eg.md](../../localization/compliance-matrix/eg.md): the adapter follows the same
   port, but **implementation begins only after** official API documentation review,
   certificate-enrollment process confirmation, and an **approving decision record**
   (RISK-007 — e-invoice AND e-receipt scope creep is explicitly decided, not assumed).
   Until then: standard tax invoices print normally and the payload builder produces
   compliance-ready archives labeled non-authoritative (eg.md §4). This phase
   delivers the evaluation evidence pack + the decision-record draft; the adapter
   itself ships only if the record is approved within the phase window.
7. **Payment provider — production checkout** completing PHASE-014's sandbox adapter
   per [DR-002-payment-provider-selection.md](../../decisions/product/DR-002-payment-provider-selection.md):
   the chosen provider's adapter goes live (production credentials S-09, webhook
   signature verification, refund flow, payout/fee reconciliation to the depth the
   provider's APIs allow); checkout intents carry our `Idempotency-Key` as the provider
   dedupe token; webhook reconciliation is a pg-boss natural-key upsert; **the
   manual-invoice fallback must remain functional even when the adapter is disabled**
   (A-009, RISK-022). If DR-002 is still OPEN, the sandbox adapter is hardened and the
   production cutover is an INCOMPLETE item with the decision-record pointer.
8. **Bank statement format adapters expansion**: `StatementParserPort` families
   (CSV/Excel shipped in PHASE-008) extended with bank-specific parsers; unknown/
   unparseable lines park for manual mapping — **never guessed amounts into
   `bank_statement_lines`**; each parser declares required columns; idempotent per
   (statement, checksum).
9. **E-commerce/shipping adapter ports + fakes**: `CommerceChannelPort`
   (pullOrders/pushPrice/pushStock — upsert by channel order id, `Idempotency-Key`
   per batch, **server-decision** conflict policy for imported orders, no LWW per
   ADR-0012) implemented against a fake channel for contract testing;
   `ShippingPort` reserved with a fake (post-MVP, not scheduled — listed to prevent
   ad-hoc coupling later).
10. **Monitoring dashboard**: the e-invoicing submission funnel per
    [MONITORING.md](../../operations/MONITORING.md) §1 (PHASE-023): submissions by
    state, latency, rejection reasons, certificate-expiry countdowns, sandbox-vs-prod
    health; alerts `EInvoiceRejectSpike` (> 5% in 15 min, Sev-2) and `CertExpiry`
    (30/7-day escalation) wired to
    [TROUBLESHOOTING.md](../../operations/TROUBLESHOOTING.md) §e-invoicing runbook
    entries (rejection triage, certificate rotation, spec-version upgrades).
11. **Compliance-matrix upkeep**: every verified fact flips its row with source URL +
    date + verifier, seeds gain `verified_at`/`source_ref`, and the verification log
    ([official-sources/README.md](../../localization/official-sources/README.md) §3)
    gains one row per fact — archived copies of official pages stored with each entry.
    Adapter rollout flags default OFF per tenant jurisdiction
    ([DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7 PHASE-023 row).

Out of scope (explicit):

- Filing VAT returns or any authority submission on the tenant's behalf — the platform
  reports, humans file (compliance-matrix README §4 hard rule 3).
- Personal-account online payments (OQ-007 — deferred; not this phase).
- UAE adapter (dormant slot until official specs exist,
  [E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §5);
  shipping live integrations; SMS providers.
- Any wire format, field list, QR content, certificate flow, or API endpoint "reversed
  engineered" from examples or third-party blog posts — the NO-FABRICATION rule is
  absolute (RISK-005).
- Changes to posted documents to satisfy adapters: adapters read documents; the core
  never imports adapter details (ADR-0010 §4 isolation).

## 3. Prerequisites

- Required phases: **PHASE-020** COMPLETE (device/adapter + job patterns ride the
  platform substrate; sync push path must be stable because e-invoicing reacts to
  server-side posting). Transitively COMPLETE: PHASE-009 (tax engine, jurisdiction
  packs, `EInvoicingAdapter` port + payload-builder architecture,
  `e_invoicing_submissions` schema), PHASE-012 (sales invoices), PHASE-013
  (print/archive), PHASE-014 (payment adapter sandbox + manual fallback), PHASE-008
  (bank statement parsing base).
- Required architecture decisions:
  [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (isolated
  adapters behind versioned ports),
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (adapters
  react to posted documents; never bypass),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (submission jobs),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (numbering interplay).
- Gating decision records:
  [DR-001-zatca-scope-and-timing.md](../../decisions/compliance/DR-001-zatca-scope-and-timing.md)
  (OPEN — ZATCA scope/timing; option C recommended: generation features at launch,
  integration adapter as certified fast-follow),
  [DR-002-payment-provider-selection.md](../../decisions/product/DR-002-payment-provider-selection.md)
  (OPEN — first provider),
  [OQ-004](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) (the open question DR-001
  resolves), RISK-005/RISK-007 (fabrication + ETA scope risks).
- Relevant documentation:
  [E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) (the
  verification gate §3, lifecycle §2, data model §6, monitoring §7),
  [compliance-matrix/README.md](../../localization/compliance-matrix/README.md)
  (status ladder, verification protocol, fact-table rules),
  [compliance-matrix/sa.md](../../localization/compliance-matrix/sa.md),
  [compliance-matrix/eg.md](../../localization/compliance-matrix/eg.md),
  [official-sources/README.md](../../localization/official-sources/README.md),
  [integrations/README.md](../../api/integrations/README.md) (adapter authoring rules
  + registry + per-adapter contracts),
  [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) §6,
  [ERROR_MODEL.md](../../api/ERROR_MODEL.md) (rejection surfacing),
  [SYNC_TESTS.md](../../testing/SYNC_TESTS.md) §7 (PHASE-023 chaos slice),
  [MONITORING.md](../../operations/MONITORING.md),
  [DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7 (certificate provisioning before
  adapter enablement),
  [TAX_ENGINE.md](../../localization/TAX_ENGINE.md) (payload tax summaries),
  [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) (adapters react to
  POSTED documents only).

## 4. Design Impact

- **Database changes:** `e_invoicing_submissions` becomes operational (columns per
  ENTITY_CATALOG: tenant_id, doc_type, doc_id, adapter_id, status, attempts,
  authority_refs JSONB, payload_file, response_file); adapter registry/config tables
  if the port requires per-tenant adapter settings; bank-format parser registry rows;
  commerce-channel import bookkeeping. All with RLS, catalog entries in-phase, and
  attack-suite expansion for new tenant-owned tables.
- **API changes:** tenant-facing submission status/read endpoints (view-only; the
  lifecycle is job-driven), admin certificate-enrollment/rotation trigger endpoints
  (permission `tax.einvoicing.manage` — approval-separated per
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)), webhook ingress
  for the payment provider (signature-verified, idempotent), and the commerce-channel
  import endpoints behind the port. No core document endpoints change.
- **UI changes:** tenant e-invoicing status surface (per-document submission state
  from the registry — never inferred), certificate-expiry admin notices, payment
  checkout result pages (completing PHASE-014 flows), bank-statement import mapping
  UI for parked lines, e-invoicing funnel dashboard for platform ops.
- **Security & authorization:** certificates are S-10 HIGHEST with signing-job-only
   access (§6); webhook verification is signature-based (never body claims);
   provider secrets in the platform store only (S-09/S-11); enrollment/rotation are
   audited, approval-separated actions; adapter sandbox credentials never in prod
   ([SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) §2 staging rule);
   pen-test scope will include the adapter surface (sandbox) in PHASE-024
   ([SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §11).
- **Accounting implications:** none to posting rules — adapters are read-side
  consumers of posted documents; the registry's ACCEPTED/REJECTED states never alter
  ledger state; INV-012 (VAT return cross-check) consumes the same tax summaries the
  payload builder emits, keeping return and payload consistent.
- **Localization implications:** payload field labels and print artifacts follow the
  jurisdiction pack (bilingual where required); rejection reason codes surface in
  AR+EN; cleared-document rendering (e.g., QR placement on printed invoices) follows
  the pack's print templates.
- **Offline implications:** none — e-invoicing is ONLINE-ONLY by design (matrix row
  19); offline clients never see authority acceptance as a local state. Chaos slice
  re-runs C-01…C-04 with submission jobs in the loop to prove sync duplicates cannot
  double-clear (SYNC_TESTS §7 PHASE-023 row).
- **Module dependencies:** `tax` module owns the adapters + registry; `billing`
  (payment adapter) completes; `treasury` owns statement parsers; `sales` owns the
  commerce port; `notifications` handles failure events; `files` stores encrypted
  payloads/responses. Core modules never import adapter classes
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) + ADR-0010 §4).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Submission registry operational: state machine, encrypted payload/response storage via files module, attempts/authority_refs, audit events on every transition | `apps/api/src/modules/tax/submissions/**` | state-machine unit tests (legal transitions only); encrypted-at-rest check; RLS attack tests |
| T2 | Submission job pipeline: pg-boss sign→submit→poll→retry→reconcile→alert with declared idempotency keys, backoff caps, dead-letter alerting | `apps/api/src/modules/tax/submissions/jobs/**` | retry/DLQ tests; circuit-breaker trip test (feature degrades, platform unaffected) |
| T3 | **ZATCA verification gate execution**: pin spec/SDK versions, sandbox access log, sample-invoice validation runs, legal content review; record every fact in the verification log + compliance-matrix rows; two-person sign-off | `docs/localization/compliance-matrix/sa.md`, verification log, DR-001 evidence pack | gate checklist items each evidenced; unpassed item ⇒ stub path (T4) |
| T4 | ZATCA adapter per gate outcome: generation features (serialization, QR TLV, hash, stamp) + integration (clearance/reporting, enrollment, signing, submission APIs, cleared artifacts) — or the `UNVERIFIED` refuse-to-submit stub with explicit INCOMPLETE markers | `apps/api/src/modules/tax/adapters/zatca/**` | fake-authority harness (T11); sandbox evidence runs; stub refuses real submissions (asserted) |
| T5 | Certificate handling: tenant-scoped encrypted storage, signing-job-only runtime credential, usage audit + volume dashboards, 30/14/7-day expiry alerts, rotation/enrollment workflows | `apps/api/src/modules/tax/certs/**`, secret-store wiring | §6 handling tests: API role denied; admin can trigger but not read; expiry alert fires |
| T6 | Payment provider production cutover: prod credentials, webhook ingress + signature verification, refund flow, payout/fee reconciliation job; manual fallback re-verified | `apps/api/src/modules/billing/adapters/<provider>/**` | webhook signature tests; duplicate webhook idempotence; fallback-enabled-with-adapter-disabled test |
| T7 | Bank format adapters expansion: bank-specific `StatementParserPort` parsers + parked-line mapping UI contract | `apps/api/src/modules/treasury/parsers/**` | parser contract tests per format; unknown-line parking (never guessed amounts) |
| T8 | Commerce/shipping ports + fakes: `CommerceChannelPort` fake channel (order import upsert, price/stock push), `ShippingPort` fake | `apps/api/src/modules/sales/adapters/commerce/**`, fakes in test kit | port contract tests vs fakes; imported-order conflict = server-decision (no LWW) |
| T9 | Egypt ETA evaluation pack: official API doc review evidence, enrollment process confirmation, scope decision-record draft (e-invoice vs e-receipt vs both) | `docs/decisions/compliance/**`, eg.md updates | evaluation checklist complete or explicitly deferred with reasons |
| T10 | Monitoring + runbooks: e-invoicing funnel dashboard, `EInvoiceRejectSpike`/`CertExpiry` alerts, TROUBLESHOOTING §e-invoicing entries (rejection triage, cert rotation, spec upgrade) | dashboards config, `docs/operations/TROUBLESHOOTING.md` | alert wiring verified on seeded rejection burst + expiring cert |
| T11 | **Fake-authority harness**: simulates ZATCA/ETA flows — submission, acceptance, rejection with codes, timeout, retry, dead-letter; used by adapter contract tests and chaos | `tests/authorities/fake-zatca/**`, `tests/authorities/fake-eta/**` | scenario matrix: submit/accept/reject/timeout/retry all evidenced |
| T12 | Chaos slice with submission jobs: re-run C-01…C-04 with e-invoicing jobs in the loop (duplicate pushes → registry idempotency, no double-clearance) | `tests/sync-chaos/**` (submission profile) | SYNC_TESTS §7 PHASE-023 slice green |
| T13 | Rollout + deployment wiring: adapter flags default OFF per tenant jurisdiction, cert provisioning before enablement, deploy watch-list entries | `apps/api/src/modules/tax/rollout/**`, DEPLOYMENT §7 updates | flag-off default asserted; enablement requires provisioned cert (gate test) |
| T14 | Compliance-matrix + docs upkeep: verified fact rows, seed `verified_at`/`source_ref`, verification log entries, archived source copies, FEATURE_CATALOG `tax.einvoicing_*` status | `docs/localization/**`, `docs/database/SEEDS/**` | docs validation green; no un-sourced assertion (review checklist) |

## 6. Verification

**Automated tests (required):**

- **Fake-authority harness scenario matrix** (per adapter): generate → sign → submit →
  poll → ACCEPTED(uuid stored) / REJECTED(codes surfaced for user action) / timeout →
  retry per policy / dead-letter + alert; registry transitions asserted against the
  legal state machine (illegal transitions rejected); **duplicate submission attempts
  dedupe via the registry — no double-clearance**.
- Chaos slice C-01…C-04 with submission jobs in the loop
  ([SYNC_TESTS.md](../../testing/SYNC_TESTS.md) §7): sync duplicate pushes cannot
  produce two submissions or two ledger effects.
- Contract tests per adapter per integrations/README §1.6 (recorded sandbox/mock
  interactions); live-provider tests only in staging with real credentials.
- `UNVERIFIED` stub behavior test (if the gate is unpassed): every regulated action
  refuses with an explicit error; nothing is submitted; UI states honestly what is
  unavailable.
- Payment: webhook signature verification (tampered/absent signatures rejected);
  duplicate webhook delivery idempotent; refund + reconciliation jobs correct;
  manual fallback functional with adapter disabled.
- Statement parsers: per-format fixtures; unparseable rows park (asserted);
  re-import idempotent per checksum.
- Security: signing-job-only credential access (API-role read attempt fails);
  certificate paths purged by the offboarding purge job; new tables pass the tenant
  isolation attack suite.

**Manual verification:**

1. Walk the verification-gate checklist end-to-end for ZATCA: pinned SDK version,
   sandbox submission evidence, validated sample invoices, legal-review sign-off —
   each item has an artifact attached in the verification log.
2. Enroll a staging tenant's certificate through the admin workflow; watch usage
   audit events and the expiry countdown appear on the dashboard.
3. Disable the payment adapter flag: confirm checkout falls back to manual invoicing
   without data loss; re-enable and reconcile a webhook storm.
4. Seed a fake-authority rejection burst: `EInvoiceRejectSpike` fires; run the
   rejection-triage runbook entry cold.
5. Confirm adapter flags default OFF for tenants outside the jurisdiction.

**Acceptance criteria (objective):**

1. The submission registry implements exactly the lifecycle
   `PENDING → GENERATED → SIGNED → SUBMITTED → ACCEPTED/REJECTED → REPORTED` with
   retries, dead-letter, and full audit; registry status is the only source of
   authority-truth (no inference from local state anywhere — code-review proven).
2. **No-fabrication proof**: every implemented adapter capability cites a pinned
   official source + version + date in the verification log; any unverifiable
   capability is an `UNVERIFIED` refusing stub. If the ZATCA gate or DR-001 is open,
   the completion report lists the adapter as INCOMPLETE with named unmet items and
   IMPLEMENTATION_STATUS records the split — the phase never claims compliance without
   evidence.
3. Certificates are handled per SECRETS_MANAGEMENT §6: encrypted tenant-scoped
   storage, signing-job-only access, usage audit, expiry alerts at 30/14/7 days, no
   key material in exports/backups.
4. Fake-authority harness proves: acceptance stores authority references; rejection
   surfaces codes; timeout retries; poison messages dead-letter with alerts; duplicate
   submissions are impossible (registry idempotency).
5. Chaos slice green: sync duplicates produce exactly one submission per document and
   exactly one ledger effect (INV-013).
6. Payment checkout works in production configuration (or is INCOMPLETE with the
   DR-002 pointer); webhook verification + refund + reconciliation evidenced; manual
   fallback functional in both states.
7. Bank parsers park unknown lines; no parser writes guessed amounts; re-imports are
   idempotent.
8. Commerce port: order import is upsert-by-natural-key with server-decision
   conflicts; shipping port exists with a fake only.
9. E-invoicing funnel dashboard live with alerts wired; runbook entries exist for
   rejection triage, certificate rotation, and spec-version upgrades.
10. Egypt ETA: either an approved decision record + adapter, or the evaluation pack +
    deferred record — eg.md and the verification log reflect which, honestly.
11. Compliance-matrix rows, seed verification fields, and the verification log are
    consistent (one row per fact checked; archived copies stored); docs validation
    green; criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

**Performance & security considerations:** submission jobs must not block posting
(document POST → registry row is async; posting latency unaffected — T-02 protected);
provider timeouts budgeted per adapter declaration; circuit breakers degrade the
feature only; secrets scoping per §4 above; pen-test scope statement for the adapter
surface handed to PHASE-024 (SECURITY_TEST_PLAN §11).

**Migration & rollback:** registry/config migrations are expand-contract; adapter
enablement is per-tenant flag (default OFF) — rollback = flag off + previous image;
submission history is append-only (never rewritten on rollback); certificate material
is external to the DB, so app rollback cannot orphan it. A spec-version change by an
authority = pack version bump + adapter release note + staged rollout (E_INVOICING §7).

## 7. Risks and Constraints

- **RISK-005** (ZATCA misread → non-compliant invoices) is the defining risk: the
  verification gate + two-person rule + refuse-to-submit stubs are its only
  acceptable mitigations; "implementing something reasonable" is a review blocker.
- **RISK-007** (Egypt ETA scope creep): the e-invoice/e-receipt scope is decided by
  record before any code; the evaluation track may legitimately end in "not now".
- **RISK-006** (rules change mid-development): every verified fact is monitored;
  changes flip statuses to `REQUIRES_VERIFICATION` and bump pack versions — adapters
  version their submission modes per ADR-0010.
- **RISK-022** (payment provider blocks billing): manual fallback must stay
  demonstrably functional; provider cutover is INCOMPLETE-with-pointer if DR-002
  stays open.
- External-dependency timing (certification lead times) must never leak into the GA
  critical path: DR-001 option C keeps GA honest with a documented segment statement.
- Constraint: the platform REPORTS; humans file. Constraint: adapters never write
  business tables (ADR-0010 §4; integrations/README §1.2).

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-023-COMPLETION.md` with: verification-gate
  checklist artifacts (pinned versions, sandbox logs, sample-invoice validations,
  legal-review sign-off), fake-authority scenario matrix output, chaos-slice output,
  certificate-handling test evidence, payment cutover evidence (or INCOMPLETE
  pointers), compliance-matrix/verification-log excerpts, dashboard/alert wiring
  proof, docs validation output. INCOMPLETE items are listed with named unmet
  checklist/decision items — never silently omitted.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-023 →
  COMPLETE or split COMPLETE/INCOMPLETE-per-adapter per its protocol),
  `docs/handoff/CURRENT_STATE.md`, `docs/handoff/CHANGELOG.md`,
  [compliance-matrix/sa.md](../../localization/compliance-matrix/sa.md) +
  [eg.md](../../localization/compliance-matrix/eg.md) (implementation status rows),
  verification log, [DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7 +
  [TROUBLESHOOTING.md](../../operations/TROUBLESHOOTING.md) (§e-invoicing),
  [MONITORING.md](../../operations/MONITORING.md) (funnel live), FEATURE_CATALOG
  `tax.einvoicing_zatca` / `tax.einvoicing_eta` status.
- **Exit criteria:** all ungated acceptance criteria green with evidence; gated items
  explicitly COMPLETE (gate passed + decision recorded) or INCOMPLETE (named unmet
  items + follow-up slot); no compliance claim without evidence anywhere in the repo;
  docs synchronized; zero TODOs except gated stubs' named markers.
- **Definition of Done:** registry + jobs + monitoring + all non-regulatory adapters
  in `main` and green; ZATCA either verified-and-implemented or refusing-stub with
  decision-record trail; payment production path live or pointered; chaos slice
  blocking in CI; `phase/023` tag.
- **Handoff instructions:** the hardening phase next consumes the adapter surface as
  pen-test scope and re-validates rate limits on webhook ingress; any spec drift
  discovered later reopens the verification log first, code second. The GA gate will
  read this phase's completion report for the ZATCA clause (certified adapter OR
  documented launch-segment exclusion per
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) §GA gate). **Next eligible
  phase: PHASE-024 — Security Hardening & Compliance Review.** Identify only; do not
  implement.
