# Phase Acceptance Criteria

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-11-08

Consolidated, objective acceptance criteria and exit gates per phase. The authoritative,
expanded version lives in each phase document's sections 6–8 ("Verification",
"Completion and Handoff"); this file is the reviewable index. **No phase may be marked
COMPLETE unless every item here passes with evidence.**

Universal criteria apply to all phases (from
[../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) and
[../handoff/IMPLEMENTATION_PROTOCOL.md](../handoff/IMPLEMENTATION_PROTOCOL.md)):

- U1. Typecheck, lint (incl. module-boundary rules), and full test suite green in CI.
- U2. New migrations apply cleanly on a fresh database AND on the staging-shape database
  (migration test); rollback path documented.
- U3. Every new tenant-owned table has tenant scoping + RLS + isolation attack tests.
- U4. Every new route has permission checks + permission tests; rate limits on public ones.
- U5. All money math via shared decimal utilities; no float (lint-enforced).
- U6. UI text bilingual (AR+EN), RTL-correct (visual snapshot AR & EN), a11y checks pass.
- U7. Documentation updated: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md),
  affected domain docs, `CHANGELOG.md`; completion report written with evidence.
- U8. No TODOs / stubs / dead code merged; code review checklist passed.

## Per-phase criteria (must-have highlights)

| Phase | Acceptance criteria (highlights) |
|-------|----------------------------------|
| 001 | Monorepo builds; CI runs typecheck+lint+unit+E2E stub on all apps; Docker Compose boots api+web+pg+minio+mailpit with health checks; boundary lint fails a deliberately violating test file (negative meta-test); docs validation in CI |
| 002 | Drizzle migration framework with named conventions; RLS helpers applied (app role non-owner, `SET LOCAL` GUC pattern, guard triggers); pg-boss boots with test job; storage adapter signed URLs; `/health/ready`; migration tests + RLS presence check in CI; attack tests A1–A10 on infra tables pass |
| 003 | Login/logout/session rotation; argon2id hashing; TOTP enroll/verify + recovery codes; RBAC enforcement matching [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md); audit events for auth + admin actions; **cross-tenant attack suite ≥ 20 scenarios, 0 leaks**; rate limiting + progressive lockout verified |
| 004 | Registration creates tenant + owner + default config (template selected, jurisdiction pack bound, CoA template instantiated); onboarding wizard API complete; branches CRUD + scoping; entitlements service resolves plan→features and blocks disabled features server-side; admin console: suspend/restore (sessions killed, sync rejected), entitlement edit, audit view; support access time-boxed + audited |
| 005 | Design tokens implemented exactly ([../ui/DESIGN_TOKENS.md](../ui/DESIGN_TOKENS.md)) and used by ≥ 20 catalog components; DataTable virtualized at 10k rows with keyboard support; MoneyInput decimal keypad AR/EN; DateRange Gregorian+Hijri; app shell RTL/LTR mirrored with entitlement-driven nav; i18n key-parity CI check (zero missing AR/EN keys); visual regression AR+EN green; Storybook catalog deployed |
| 006 | Partners/items/categories/UoM/barcodes/price lists CRUD + search + import(CSV/XLSX)/export with duplicate detection and dry-run preview; opening-balance drafts stored (not posted); attachments permission-checked; partner credit-check API; UoM conversion property tests; **zero journal rows from module (verified)** |
| 007 | CoA template instantiation bilingual + tree validation (leaf-only posting) + purpose mapping fail-closed; fiscal periods + lock enforced by posting engine; manual journal create→approve→post; **posting engine implements [../accounting/POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md) exactly: validation pipeline 1–8, error taxonomy, idempotency INV-013**; reversal flow; GL drill-down; recurring entries; opening balances posting (CoA + partners); **INV-001…INV-022 initial coverage: each invariant has passing positive + violation tests** |
| 008 | Cash/bank/petty accounts linked to CoA; receipts/disbursements with allocations (incl. opening balances) post correct journals (goldens G-05/G-06/G-10 with gain+loss mirrors); INV-016 allocation bounds incl. concurrency (CC-02), on-account remainders explicit (BR-027); expense claims + approval policies (BR-023) + reserved tax field; transfers with charges (G-12); cashier shifts with variance auto-post + supervisor PIN above tolerance (BR-021); bank statement import (adapters, idempotent, bounded) + auto/manual match + aging + per-account period lock (BR-022), statement lines never ledger entries; FX difference posting on settlement honoring stored rate (INV-008); **treasury balance = Σ movements (INV-019) with seeded-drift BROKEN detection blocking period lock (RC-08/PC-04)**; new tables in isolation registry A1–A10 + spoof rejections zero-partial; §3.4 permissions incl. SoD-guarded approve keys |
| 009 | Six treatments modeled distinctly; tax codes resolve per document date with rate snapshots; jurisdiction packs for all 10 countries load + version; **no-VAT pack operates cleanly (documents without VAT fields, no VAT postings, NOT_SUBJECT stamps)**; unregistered-tenant mode; tax summary per document; VAT return report reconciles to GL tax accounts (INV-012) per pack scenario; adapter port + fake adapter contract tests |
| 010 | Stock ledger append-only; WAC + FIFO engines pass property tests vs oracle datasets (incl. multi-receipt/multi-issue sequences); opening stock posting; transfers with in-transit; counts → adjustments post shrinkage/appreciation; batch/expiry/serial/IMEI enforcement where flagged; availability API; **inventory subledger reconciles to GL (INV-010/017/018: move+journal atomicity tests)** |
| 011 | PR→PO→GRN→supplier invoice chain with documented statuses; three-way matching with tolerance policies + match_result recorded; debit notes; payments + allocations; AP aging + supplier statements; GRNI accrual + clearing correct; landed-cost baseline; matching failure paths tested |
| 012 | Quote→order→delivery→invoice→credit note full chain; cash + credit sales; partial payments + allocations; credit limits (block/warn/ignore) enforced server-side at approval; returns re-enter stock at original cost; AR aging + customer statements (deterministic as-of); **all sales/credit-note posting rules tested with expected journal entries (success + failure: credit limit, period lock, stale price)** |
| 013 | Report contract registry per [../reporting/REPORT_CONTRACT.md](../reporting/REPORT_CONTRACT.md); TB/IS/BS/CF correct on golden datasets with self-assertions (TB debits=credits; IS net = BS current-year result); drill-down to source documents; print templates AR/EN RTL-correct; PDF/XLSX/CSV exports byte-stable in tests; permissions per report; exports audited; heavy reports via job path |
| 014 | Plans + entitlement matrix enforced end-to-end (server-side); checkout via provider adapter (sandbox) AND manual invoicing fallback; onboarding UX: register→configure→first invoice journey in AR and EN; dashboards with drill-down; security review of MVP surface (findings triaged); load smoke vs NFR-006; **MVP gate checklist green** ([MASTER_ROADMAP.md](MASTER_ROADMAP.md) §Release gates) |
| 015 | Configuration engine: `resolveEffectiveConfig` deterministic (property tests) + invalidation events; manifests schema-validated; retail/grocery/restaurant templates apply without data corruption; template switching additive-only (reversal of destructive attempts rejected + audited); INV-022 fuzz: configuration attempts cannot alter invariants |
| 016 | POS terminals + shifts/drawer with variance posting; touch sale flow p95 < 2s scan-to-cart; barcode scanning; receipts 80/58mm RTL-correct (visual snapshots); **offline sale queue: sell disconnected → sync reconciles with zero double-posting (chaos slice C-01/03/04/07/09/16)**; end-of-day Z report matches journals; unregistered-mode receipts |
| 017 | Automotive template: job cards (parts + labor) post correctly (golden tests incl. both parts-issue policies); vehicle registry per partner; distribution: van stock = warehouse semantics with load/unload transfers, route visits, settlements (cash + credit + returns + variance reconcile — conservation tests); customer price tiers + free goods |
| 018 | BOM versioning + explosion (multi-level); production order → consumption → WIP → finished goods at computed cost (material+labor+overhead); scrap posting; batch genealogy forward/backward trace; QC gates block completion on fail; **WIP/FG reconcile to GL (INV-010)**; multi-level costing golden tests with scrap % |
| 019 | Leads→customer conversion; tasks/activities/reminders with notifications; service contracts: recurring billing idempotent per (contract, period) incl. boundary dates + period-lock handling; deferred revenue wiring (BR-027); service orders; project dimension usable on documents + reports; revenue schedule ↔ AR reconciliation |
| 020 | Device registry + revocation (pushes rejected pre-execution with zero ledger effects, pulls `DEVICE_REVOKED`, refresh exchange fails — per SECURITY_AND_DEVICE_MANAGEMENT §4); change feeds with opaque signed cursors + tombstones (crash at any point converges by re-pull; no full-table dump anywhere); push/pull contracts with typed per-item results and machine-readable `details` (`DEFERRED` never executed, never inbox-recorded); duplicate delivery of a financial command at ANY multiplicity (incl. concurrent + cross-batch) = exactly one journal effect + `duplicate: true` replay (INV-013); **conflict policies per entity: server-decision for financial (no LWW — negative test), FIELD_LEVEL_MERGE for partner contacts with field-level audit; policy tests**; inbox retention ≥ 30 d audited + a second durable dedupe layer after expiry (35-day restored-outbox proof); cross-tenant pushes reject with no effects + no existence disclosure (C-13 + Y-series); local DB reference implementation (`packages/sync-core`) + contract version gates (422 read-only mode, no fabricated writes); PHASE-016 POS terminal syncs UNCHANGED (wire compat §11 rule 3 — any deviation decision-recorded); **full chaos matrix C-01…C-16 green with logged seed** ([../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md) — LIVE in `apps/api/src/__db__/sync/`); sync health dashboard + `SyncPushFailSpike`/`SyncCursorStall` alerts + `outbox.lag`/`device.revoked.pending_ops` gauges live, every alert links a TROUBLESHOOTING §sync runbook entry; k6 sync-fleet T-05 (p95 < 3 s, 500 devices, 5% revoked) — staged, run deferred to hosted k6 (follow-up obligation); capabilities-matrix cross-check quoted in the completion report; `ix_change_log_tenant_entity_seq` present; docs validation green + criteria copied here |
| 021 | 1. The signed Windows installer boots the full web ERP in the shell from the static export; bundle size and memory footprint recorded in the report against the ADR-0013 rationale (~10–20 MB class). 2. Offline login/unlock works against the cached permission snapshot; after the 7-day watermark the app is read-only + online-required for writes (test evidence). 3. Every desktop-column matrix cell implemented in this phase matches its class (READ-CACHED / OFFLINE-DRAFT / ONLINE-ONLY) — cross-check output quoted row-by-row; no ONLINE-ONLY row is queued or simulated. 4. All OFFLINE-DRAFT rows sync through `sync-core` with owner-device-wins semantics; non-owner edit attempts are read-only in the UI and rejected server-side. 5. Rejection UX implements the CONFLICT_RESOLUTION §3 table exactly; every user choice is audit-logged with the rejecting response's `traceId`. 6. Local DB is SQLCipher-encrypted; key, refresh token, and device key exist ONLY in the OS keychain (binary + artifact inspection evidence). 7. Auto-update: signed bundles only; staged rollout 10%→50%→100% with crash-rate gates reading the client-stability dashboard; downgrade and unsigned-update attacks fail closed (D-06 green). 8. Full chaos matrix green on the desktop harness incl. real signed-update path; the suite remains blocking in CI after this phase. 9. Crash recovery: forced kills at any sync step lose no outbox command and re-converge without operator intervention (kill-matrix output). 10. WebView2 below-minimum produces the system-requirements path (no crash, no broken UI); supported-but-older runtimes get degradation notices. 11. Receipt printing from local cache reprints POSTED documents without re-creating or re-numbering anything (row 32 rule). 12. Docs updated: quickstart + system requirements + updater runbook + FEATURE_CATALOG `offline.desktop_app` → implemented; docs validation green; criteria copied into PHASE_ACCEPTANCE_CRITERIA.md (this row). |
| 022 | 1. One installable app serves both experiences; role/capability scoping happens at device registration, not by build variant (ADR-0014 rule quoted in report). *(evidence: the `@erp/mobile` package + `native/` glue are ONE build — DR-P22-01; `registerMobileDevice` carries `platform:"android"` + the `android-field`/`android-personal` deviceClass with advisory capability labels; `sync/pull-fields.spec` + `sync/pull-personal.spec` prove the feeds gate by deviceClass; the ADR-0014 quote is in [PHASE-022-COMPLETION.md](../implementation/phases/reports/PHASE-022-COMPLETION.md))* 2. Full chaos matrix green on the Expo profile; C-06/C-07/C-13 evidenced on-device. *(expo profile live: `sync/expo/expo-chaos.spec` 19 tests = C-01…C-16 + C-11b on the REAL mobile store, in-sim; the on-device C-06/C-07/C-13 leg is the wired `device-farm` CI job — the recorded honest deferral in the completion report, the k6 precedent)* 3. Every implemented Android-field/personal-account matrix cell matches its class (row-by-row cross-check quoted); OFFLINE-COMPLETE rows show honest `PENDING_SYNC → POSTED/REJECTED` machines; personal-account class has NO write path. *(the row-by-row cross-check is quoted in the completion report; `check:capabilities-matrix` agree — 42 implemented rows, 0 deferred; the honest state machines are the flow suites + StatusChip binding map; the personal no-write proof is three layers: the import-graph structural test, the host hard guard, zero write controls asserted in renders)* 4. Background sync respects OS constraints: ≤ 15-min background fetch, Doze-safe, budgets enforced (≤ 8 MB pull / ≤ 2 MB push cellular; ≤ 256 KB personal-account background fetch) — schedule evidence in report. *(`sync/triggers` + `sync/transport` suites over the golden constants — `SYNC_BACKGROUND_MIN_INTERVAL_MS` 900 000, the byte-budget guards; the Doze-deferred ≥ 15-min fault profiles in the expo chaos suite; which side enforces what is documented — client budgets, server 2 MB delta cap)* 5. Secrets exist only in SecureStore; SQLCipher key never in the DB or preferences; access tokens memory-only; screenshots blocked on financial screens (inspection evidence). *(DR-P22-09: the vault `erp.<deviceId>.*` + the memory-only `MobileSession` secret-scan test + `applySecureScreenPolicy` on the 8 financial screens; D-02 structure-level in-sim — the cipher-profile inspection is the recorded on-device deferral)* 6. Biometric unlock optional with PIN fallback; permission snapshot gates UI; beyond the 7-day watermark the app is read-only + online-required for writes. *(UnlockPort + UnlockGate ladder suite; D-04 on the expo store incl. the personal class; `permissionWatermarkState`/`offlineWritePolicy` over REAL stores)* 7. RTL parity: AR-first design with EN mirroring; parity snapshots green both directions; no physical-property styles in RN code (lint ban active). *(the DR-P22-03 ESLint ban — 13 selector forms, negative-proven; both-direction render tests through the vitest Flow bridge assert no physical-direction key in any emitted tree; pixel snapshots are the recorded device/CI deferral — tree-level parity proven)* 8. Revocation, suspension, and contract-skew paths behave per protocol (D-01, C-14, C-08) with force-update via minimum-version enforcement. *(D-01 purge on the expo store both classes; C-14 suspension mid-queue + C-08 contract gate → read-only + update prompt in expo-chaos; the ReleasePolicy min-version force-update decision + rollout gates tested at the exact 99.5/99.7/98.5 boundaries)* 9. Play Store pipeline produces a signed artifact; staged rollout 10%→50%→100% with crash-rate gates wired to the client-stability dashboard. *(`mobile-release.yml`: S-15/FCM warn-and-continue provisioning → EAS build → SBOM → apk/aab → the staged-rollout config + the `minVersion` manifest; structurally asserted by `mobile-release-ci.test`; the actual signing/compile is CI-only — the honest deferral, `check:mobile-shell` is the standing source-level gate)* 10. FCM skeleton: opt-in per device, locale-resolved templates, contract tests green; delivery is best-effort with retry + quota (no functional dependency on push). *(`notifications/fcm-channel.spec` 8 tests against the fake FCM — locale resolved pre-call, opt-in default OFF, per-tenant quota, retry, no financial payloads at three layers; the adapter is disabled when credentials are unset)* 11. Docs updated (quickstart, rollout runbook, FEATURE_CATALOG keys → implemented); docs validation green; criteria copied into PHASE_ACCEPTANCE_CRITERIA.md (this row). *(MOBILE_QUICKSTART.md new; DEVELOPMENT_SETUP §12; DEPLOYMENT.md §7 Play Store staged-rollout + minimum-version runbook; TROUBLESHOOTING §android; FEATURE_CATALOG `offline.android_app`/`offline.mobile_accounts` → shipped; `pnpm docs:validate` 29/29)* |
| 023 | 1. The submission registry implements exactly the lifecycle `PENDING → GENERATED → SIGNED → SUBMITTED → ACCEPTED/REJECTED → REPORTED` with retries, dead-letter, and full audit; registry status is the only source of authority-truth (no inference from local state anywhere — code-review proven). *(migration 0035 + the state machine: illegal transitions rejected in code; `attempts`/`next_attempt_at` drive the exponential-capped retry sweep; dead-letter at the cap with the `einvoice.submission.failed` inbox alert; the fake-authority matrix exercises every path; per-document lookups resolve through owning-module services — never a JOIN across `source_type`/`source_id`)* 2. **No-fabrication proof**: every implemented adapter capability cites a pinned official source + version + date in the verification log; any unverifiable capability is an `UNVERIFIED` refusing stub; the gated remainder is listed INCOMPLETE with named unmet items — never silently omitted. *(ZATCA = the UNVERIFIED refuse-to-submit stub — the verification gate is honestly NOT_VERIFIED (no external access; nothing fabricated): GATE-1 spec/SDK pin, GATE-2 sandbox, GATE-3 sample-invoice validation, GATE-4 legal review all unmet and named in every refusal; DR-001 OPEN with option C recommended; Egypt ETA NOT_STARTED — the DR-003 DEFERRED draft + the fake-eta evaluation harness)* 3. Certificates handled per SECRETS_MANAGEMENT §6: encrypted tenant-scoped storage, signing-job-only access, usage audit, expiry alerts at 30/14/7 days, no key material in exports/backups. *(the path-only S-10 registry — no column carries key material; the §6 handling tests assert the API role cannot read key material; `expires_alerted_at` fires each threshold exactly once; the offboarding purge removes secret paths)* 4. Fake-authority harness proves: acceptance stores authority references; rejection surfaces codes; timeout retries; poison messages dead-letter with alerts; duplicate submissions are impossible (registry idempotency). *(`tests/authorities` fake-zatca + fake-eta drive the REAL registry + jobs through the submit/accept/reject/timeout/retry/DLQ scenario matrix; idempotency = the partial unique `uq_einvoicing_submissions_live` — one LIVE row per document × adapter)* 5. Chaos slice green: sync duplicates produce exactly one submission per document and exactly one ledger effect (INV-013). *(`sync/chaos-submissions` C-01…C-04 with the submission jobs in the loop)* 6. Payment checkout works in production configuration (or is INCOMPLETE with the DR-002 pointer); webhook verification + refund + reconciliation evidenced; manual fallback functional in both states. *(DR-002 OPEN ⇒ production cutover INCOMPLETE with the pointer; the sandbox is hardened: `refund()` + `payment.refunded` events — the invoice stays PAID — + payout sync/reconciliation/list + the `runPayoutReconciliation` job with DRIFT reported, never auto-corrected; the manual-invoicing fallback intact)* 7. Bank parsers park unknown lines; no parser writes guessed amounts; re-imports are idempotent. *(the csv-debit-credit + csv-with-balances families park unparseable rows verbatim; the sha-256 statement idempotency unchanged from PHASE-008)* 8. Commerce port: order import is upsert-by-natural-key with server-decision conflicts; shipping port exists with a fake only. *(`commerce_channel_orders`/`commerce_channel_imports`; financial drift ⇒ CONFLICT with the previous payload preserved in `conflict_detail`; explicit human resolution KEEP_EXISTING/TAKE_INCOMING — never LWW; `ShippingPort` + `FakeShippingProvider` reserved)* 9. E-invoicing funnel dashboard live with alerts wired; runbook entries exist for rejection triage, certificate rotation, and spec-version upgrades. *(funnel + per-document registry at `/settings/tax/einvoicing` + the ops funnel at `/platform/einvoicing-funnel`; `EInvoiceRejectSpike` >5%/15 min Sev-2; the runbook entries live with the operations doc set)* 10. Egypt ETA: either an approved decision record + adapter, or the evaluation pack + deferred record — eg.md and the verification log reflect which, honestly. *(the DR-003 DEFERRED draft + the fake-eta evaluation harness; no adapter claim anywhere)* 11. Compliance-matrix rows, seed verification fields, and the verification log are consistent (one row per fact checked; archived copies stored); docs validation green; criteria copied into PHASE_ACCEPTANCE_CRITERIA.md. *(this row is the copy; the compliance-matrix/verification-log consistency excerpts are carried by [PHASE-023-COMPLETION.md](../implementation/phases/reports/PHASE-023-COMPLETION.md))* |
| 024 | Pen test per [../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) §11 scope executed; findings remediated/closed per SLA; MFA enforcement policies per role/plan; rate-limit/lockout hardening verified; secrets rotation drill executed once; dependency/SBOM triage; audit review tooling; privacy notices legal-review task tracked (OQ-009 decision record). *(copied at completion, 2026-11-06 — the verdict rows live in [PHASE-024-COMPLETION.md](../implementation/phases/reports/PHASE-024-COMPLETION.md) §Acceptance criteria verification: 14/14 PASS, two via the honest branches — the external-firm leg infra-gated with the internal re-verification executed over the full scope list [139 files/2019 tests], OQ-009 BLOCKED-EXTERNAL per DR-024-02; the findings log [SF-024-001..022](../operations/security-findings.md) is the living artifact: 0 Critical open, every internal finding fixed in-phase with regression links or open with SLA clocks + rationale)* |
| 025 | Load tests at 10× projection meet NFR-006 (k6 evidence, T-01…T-08); soak test; DR drill within RTO with timing evidence (region-loss tabletop + cross-region restore rehearsal); cold backup-restore by second engineer; runbooks cold-run validated; SLO dashboards + error budgets live; docs-drift final validation; **GA gate checklist green** ([MASTER_ROADMAP.md](MASTER_ROADMAP.md) §Release gates) |

## Per-phase criteria — Blueprint v2.0 expansion (stages 9–11)

Universal criteria U1–U8 above apply unchanged, as do the register §O safeguards: every
new posting goes through the posting engine with INV-013 idempotency, every new table is
tenant-owned + RLS with isolation attack tests, and no country-specific rates are
fabricated. Canonical identifiers per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md).

### PHASE-026 — Fixed Assets & Depreciation

- **INV-023 enforced**: Σ depreciation ≤ cost − salvage_value; NBV ≥ 0 always; disposal
  once only and only from status ACTIVE/FULLY_DEPRECIATED.
- Goldens **G-21/G-22/G-23** byte-stable: capitalization; monthly depreciation run (one
  journal, lines per asset); disposal with mandatory gain/loss mirror.
- Depreciation posts **only via runs** (BR-042), and runs are period-locked; a manual asset
  journal is rejected (negative test).
- Disposal locks the asset (BR-043); revaluation is optional + audited with delta to
  `REVALUATION_RESERVE` (BR-044).
- **Category purpose mapping enforced fail-closed** (BR-041): asset/accumulated/expense
  purposes must exist before a category is usable.
- Asset register, depreciation schedule, and movements reports reconcile to GL control
  accounts on golden datasets.
- All 6 new tables (`asset_categories`, `assets`, `depreciation_runs`, `depreciation_lines`
  🔒, `asset_disposals`, `asset_revaluations`) tenant-owned + RLS + isolation attack tests.

### PHASE-027 — Cheques, Promissory Notes & Installments

- **INV-024 enforced**: note custody equals journal effects — COLLECTED/DISCOUNTED/RETURNED
  notes carry zero `NOTES_RECEIVABLE` balance.
- Goldens **G-24…G-28** byte-stable: note received against invoice; collected at maturity;
  dishonored; issued-note pair; installment late fee.
- **PDC calendar auto-derived** from note maturity dates (BR-045); endorsement moves
  custody without a journal (BR-047).
- **Dishonor restores the AR open item exactly** (amount + references), requires a reason;
  bank fee optional via `BANK_CHARGES` (BR-046).
- **Installment plan total = source document total** (BR-048); schedule immutable after
  activation; **late fees only via the engine** per plan policy (BR-049/G-28), flat fees
  only — no interest-bearing computation (DR-003).
- Maturity-calendar, aging, and dishonored-register reports correct on golden datasets.
- `notes`, `note_events` 🔒, `installment_plans`, `installment_lines` tenant-owned + RLS +
  isolation attack tests; existing `treasury.cheques` feature key re-pointed to the
  `notes` module (ED-03).

**Acceptance criteria (objective) — copied at completion, 2026-11-07 (verbatim from
[../implementation/phases/PHASE-027.md](../implementation/phases/PHASE-027.md) §6; the
verdict rows live in
[PHASE-027-COMPLETION.md](../implementation/phases/reports/PHASE-027-COMPLETION.md)):**

1. Every notes/installments posting goes through the engine with its canonical
   G-row shape (G-24/G-25/G-26/G-27 both legs/G-28 green with line-level asserts),
   INV-013 idempotency per source/operation, and zero journal rows for
   endorsement/DEPOSIT/RECLASSIFY events.
2. INV-024 is enforced and tested: custody equals ledger effect across the full
   state graph; COLLECTED/DISHONORED/DISCOUNTED/RETURNED notes carry zero
   `NOTES_RECEIVABLE` balance; dishonor restores the AR open item exactly
   (amount, partner, references).
3. BR-046 enforced: dishonor requires a reason; the optional fee posts via
   `BANK_CHARGES`; the restored item appears in AR aging and the customer
   statement with its original references.
4. The PDC calendar is job-derived from `maturity_date` only, correct after every
   event, idempotent under re-runs, freshness-labeled — never stale-silent; no
   posting can originate from the calendar.
5. Installment plans enforce BR-048 (total = source document total, activation
   blocked otherwise) and schedule immutability after activation; plans never
   duplicate AR (Σ line collections ≤ invoice outstanding, INV-016 tie).
6. Line statuses are job-derived only (OVERDUE via the daily job honoring
   grace); WAIVED is the sole manual transition — permission-gated,
   reason-required, audited.
7. Late fees post only via the engine (G-28) per the plan's policy (rate + cap +
   grace with documented PLACEHOLDER defaults, OQ-002 family); flat fees only —
   no interest computation or compounding code path exists (negative test green).
8. RC-11 is green in the permanently-blocking CI set; seeded drift is detected as
   `BROKEN` with the offending note and blocks period LOCK (PC-04).
9. All four tables are in the isolation registry with A1–A10 green; foreign
   references are rejected with typed 404s and zero partial creation; the §3.12
   permission checklist is green with audit on risky actions.
10. The five report contracts are registered with block-on-fail ledger ties and
    as-of determinism; nav additions (الخزينة ×2, المبيعات ×1) carry bilingual
    labels + featureKeys; the `treasury.cheques` re-point and the PHASE-008/012
    pointers are in place (ED-03 chain closed).


### PHASE-028 — Budgeting & Variance Control

- **BR-050 enforced** at the DB AND service level: exactly one ACTIVE budget version
  per (fiscal year, scope) — the partial unique `uq_budgets_one_active` rejects a
  second ACTIVE insert outright; revisions supersede (a linked DRAFT with copied
  lines, `supersedes_id` chain) and never edit; the predecessor flips ACTIVE → REVISED
  only at the successor's activation, atomically; non-DRAFT budgets reject line edits
  with 409 `IMMUTABLE_DOCUMENT`; closed budgets stay readable for variance history.
- **BR-051 enforced**: controls are ADVISORY by default (an over-budget DRAFT-save
  evaluation returns exactly one warning — notification + banner payload — and the
  save proceeds); hard-block exists only via the explicit
  `budgeting.controls.mode = ENFORCE_DRAFT` tenant policy, acts only at the
  DRAFT-stage save step with the typed, audited `BUDGET_EXCEEDED` reason, and never
  affects posted documents or the posting engine; both policy keys documented in the
  settings schema with PLACEHOLDER defaults (OQ-002 family).
- **The negative ledger proof**: after the full budgeting operation set,
  `journal_entries`/`journal_lines` counts are byte-identical, zero `JournalSpec`
  submissions ran (engine spy), and the module's store greps clean of any
  journal-table write — budgets are structurally ledger-incapable (DR-004).
- The variance engine reads actuals strictly read-only from the GL (dimension-grouped
  shared query incl. the BRANCHES-via-source-document attribution with the honest
  unattributed bucket); the worked example holds (budget 1,000.00, actual 750.00 in
  period 4 ⇒ variance −250.00 / −25.0000%) and is as-of deterministic.
- `budgeting.budget-vs-actual` + `budgeting.variance-analysis` registered per
  REPORT_CONTRACT (registry 76→78) with the `budget-ledger-tie` block-on-fail
  assertion folding to the trial balance; seeded drift ⇒ FAIL (export blocked).
- XLSX import/export round-trips grids (19,4 exact), dry-run reports per-row typed
  AR+EN errors with zero writes, row caps typed, idempotent per file hash (the honest
  LRU + HTTP Idempotency-Key scope documented).
- `budgets` + `budget_lines` tenant-owned + RLS + the isolation registry (A1–A10);
  the S-04 spoof battery over foreign year/period/account/dimension/budget ids →
  typed 404s with zero partial creation; the الموازنات / Budgets nav item renders
  under المحاسبة / Accounting; the `PeriodGrid` pattern has a catalog row + AR+EN
  baselines.

**Acceptance criteria (objective) — copied at completion, 2026-11-08 (verbatim from
[../implementation/phases/PHASE-028.md](../implementation/phases/PHASE-028.md) §6; the
verdict rows live in
[PHASE-028-COMPLETION.md](../implementation/phases/reports/PHASE-028-COMPLETION.md)):**

1. `budgets` + `budget_lines` exist tenant-owned with RLS and pass the full isolation
   registry suite (A1–A10, S-04, A7) with zero partial creation on foreign dimension
   references.
2. BR-050 is enforced at the database and service level: exactly one ACTIVE version
   per (fiscal year, scope); revisions supersede via the chain and never edit an
   ACTIVE version; non-DRAFT budgets are immutable.
3. The approval lifecycle (DRAFT → PENDING_APPROVAL → ACTIVE → REVISED → CLOSED)
   enforces `budgeting.budgets.approve` with SoD (creator cannot approve) and audits
   every transition.
4. The variance engine computes actuals read-only from GL read models: every
   consumption figure ties to the trial balance (assertion-tested), and the suite's
   negative proof shows zero journal-table writes and zero JournalSpec submissions
   after the full run.
5. `budgeting.budget-vs-actual` and `budgeting.variance-analysis` are registered per
   REPORT_CONTRACT with provenance, permissions, as-of determinism, drill-down, and
   export-blocked-on-assertion-failure behavior.
6. BR-051 holds: controls are advisory by default; hard-block exists only via the
   explicit `budgeting.controls.mode = ENFORCE_DRAFT` tenant policy, acts only at the
   DRAFT-stage save/approval step with an audited reason, and never affects posted
   documents or the posting engine; both policy keys are documented in the settings
   schema with their PLACEHOLDER defaults.
7. XLSX import/export round-trips grids exactly (19,4), is idempotent per file hash,
   bounded by row caps, and handles Arabic headers.
8. All §3.13 permissions enforce on their routes (generated checklist green); the SoD
   approve key is audited on use.
9. Every budgeting screen instantiates a sanctioned archetype with AR+EN baselines;
   the `PeriodGrid` pattern has a catalog entry; the الموازنات / Budgets item renders
   under المحاسبة per the nav resolution rule.

### PHASE-028 — Budgeting & Variance Control

- **One ACTIVE budget version per (fiscal year, scope)** (BR-050); revisions supersede —
  never edit (immutability test).
- **Budgets never post journals**: budget lines are planning data only; variance reads GL
  actuals (negative test: no journal can originate from budgeting).
- **Controls advisory by default** (BR-051); hard-block only via explicit tenant policy;
  both behaviors tested.
- Budget-vs-actual variance correct on golden datasets across all four scopes (accounts,
  cost centers, projects, branches).
- Approval workflow DRAFT → PENDING_APPROVAL → ACTIVE → REVISED/CLOSED with SoD on
  `budgeting.budgets.approve`.
- `budgets`, `budget_lines` tenant-owned + RLS + isolation attack tests.

### PHASE-029 — Payroll: Salaries, Loans & End-of-Service

- **INV-025 enforced**: run totals = Σ lines (gross, deductions, net) and net = gross −
  deductions exactly; posted runs immutable (reversal-only).
- Goldens **G-29/G-30/G-31** byte-stable: run posting; payout; EOS settlement with residual
  to `EOS_PROVISION_EXPENSE`.
- **Payroll posts only via runs** (BR-053): a manual journal touching payroll accounts is
  rejected (negative test).
- **PII permission gating**: `payroll.employees.*` reads restricted (role template
  additions); national-ID and bank fields protected per
  [../security/DATA_PROTECTION.md](../security/DATA_PROTECTION.md).
- **No fabricated rates** (BR-055): components are tenant-configured; GOSI/social-insurance/EOS
  jurisdiction rules REQUIRE_VERIFICATION per the official-sources protocol; EOS accrual
  per tenant policy table.
- Salary structure versioning (BR-052): mid-period change creates a new structure version;
  loan deduction per period ≤ cap percent of net (BR-054).
- All 7 payroll tables (`employees`, `salary_structures`, `salary_components`,
  `payroll_runs`, `payroll_run_lines` 🔒, `employee_loans`, `employee_loan_lines`)
  tenant-owned + RLS + isolation attack tests.

**Acceptance criteria (objective) — copied at completion, 2026-11-08 (verbatim from
[../implementation/phases/PHASE-029.md](../implementation/phases/PHASE-029.md) §6; the
verdict rows live in
[PHASE-029-COMPLETION.md](../implementation/phases/reports/PHASE-029-COMPLETION.md) —
the planning-docs flip was honestly deferred at 029 commit time and delivered with the
PHASE-030 docs wave):**

1. All seven tables exist tenant-owned with RLS and pass the isolation
   registry suite (A1–A10, S-04, A7) including the PII-access attack rows, with
   audit events on every restricted read and every export.
2. BR-052 holds: runs require an ACTIVE structure; mid-period changes create a
   new version; archived/used structures are never edited in place; run lines
   freeze `component_snapshot`.
3. G-29 posts exactly through the engine with line-level expected-vs-actual
   asserts (worked example), official numbers (INV-021), cost-center/project
   allocation on every line, and INV-013 idempotency per run.
4. INV-025 is enforced and in the permanently-blocking CI suite: run totals
   equal Σ lines and net = gross − deductions exactly; posted runs and their
   lines are immutable (reversal-only).
5. BR-053 holds: payroll-purpose accounts post only via runs (manual journals
   rejected with `PAYROLL_ACCOUNT_ENGINE_ONLY`); no other code path can post
   to them.
6. Payouts execute as treasury payments with the G-30 shape, INV-019
   consistency on the paying account, exact remainder tracking, and idempotency
   per run.
7. Loans enforce BR-054 (cap percent of net, default 25% PLACEHOLDER,
   documented in the settings schema), recover through the tenant-mapped
   control account (no new canonical purpose), and make every waive/write-off
   an audited, reason-required action.
8. EOS follows BR-055: accrual per tenant policy (disabled by default; no
   shipped rates), G-31 settlement with the residual rule; the platform
   contains no jurisdiction rate tables (grep-verifiable).
9. The three reports are registered per REPORT_CONTRACT with provenance, GL
   ledger-tie assertions, permission gating (employee detail requires
   `payroll.employees.view`), and export-blocked-on-assertion-failure.
10. All §3.14 permissions enforce on their routes (generated checklist green);
    `payroll.runs.approve` is SoD-guarded and audited; role templates exclude
    payroll reads from broad roles.
11. Navigation group 10 الموظفون والرواتب / HR & Payroll renders with its four
    items per the nav resolution rule; NAVIGATION_MODEL's group wording is 10
    everywhere; every screen has AR+EN baselines with axe + keyboard journeys;
    the payslip template prints RTL-correct in both locales.

### PHASE-030 — Wholesale & Electronics Templates

- `manifest.wholesale.json` + `manifest.electronics.json` parse, schema-validate, and
  extract byte-stable (`industry.wholesale`, `industry.electronics` ids).
- Both template docs pass the industry framework's **7 governance tests** (manifest schema,
  feature-key existence, navigation sample, terminology overrides, workflow signature,
  defaults, out-of-scope declaration).
- **Additive switching rules hold**: applying either template to a live tenant is
  additive-only; destructive attempts rejected + audited (INV-022 fuzz extended).
- Wholesale: qty-break price lists, credit terms/limits, optional routes resolve on golden
  partner/item data.
- Electronics: IMEI serial tracking, repair service orders, POS keys, trade-in via
  purchasing — every flagship key resolves to an existing module feature (no new core
  surface).
- CAPABILITY_MATRIX gains WHL/ELC columns; every cell cites an existing feature or N/A.

**Acceptance criteria (objective) — copied at completion, 2026-11-08 (verbatim from
[../implementation/phases/PHASE-030.md](../implementation/phases/PHASE-030.md) §6; the
verdict rows live in
[PHASE-030-COMPLETION.md](../implementation/phases/reports/PHASE-030-COMPLETION.md)):**

1. Both templates apply via the **unmodified PHASE-015 engine** — zero engine-code changes
   in this phase's diff — and each passes all seven governance tests of
   [../industries/README.md](../industries/README.md) §8, in AR and EN.
2. Both manifests pass [../industries/README.md](../industries/README.md) §3 schema
   validation in CI; ids are exactly `industry.wholesale` / `industry.electronics`,
   version 1.0.0, registered in `industry_templates`.
3. Feature-key resolution is fail-closed and proven by test: every required key resolves;
   a missing OPTIONAL key hides cleanly; a missing REQUIRED key blocks onboarding with
   actionable plan guidance; `notes.*` entries phase-gate per their
   `available_from_phase` with the documented ordinary-receipts fallback pre-027.
4. Switch safety is proven per BR-038 by test: apply a prior template → post documents →
   switch/extend to each new template → zero data loss, explicit settings intact, series
   append-only, archived capabilities read-only, audit diff recorded.
5. The capability cross-check is green and CI-enforced: manifests ≡
   [../industries/capabilities/CAPABILITY_MATRIX.md](../industries/capabilities/CAPABILITY_MATRIX.md)
   §1 WHL/ELC columns, including the `pdc_notes`, `installment_terms`, `imei_tracking`,
   and `job_cards` rows.
6. Navigation patches obey [../ui/NAVIGATION_MODEL.md](../ui/NAVIGATION_MODEL.md): labels may
   change, items may be added (bilingual, feature-key-gated, permission-resolving), core
   items and group order never change — asserted across apply and switch.
7. The negative ledger proof holds: zero journal rows and zero posting-rule changes from
   any apply/switch/extend of either template (INV-022); all signature-workflow journals
   match the existing goldens line-for-line.
8. Report-pack wiring lands from existing keys only (no new report keys introduced by the
   phase); every pinned report resolves in the registry and renders its GL tie-out where
   monetary.
9. All surfaced screens instantiate existing archetypes (zero new archetypes; zero new
   API routes); the RTL visual set passes for both industry homes and signature screens.
10. Docs validation is green, including the 34-phase document set and the 13-manifest
    extraction (ED-17).

### PHASE-031 — Healthcare Commercial Shell

- Manifest + template doc pass the **7 governance tests**; additive switching rules hold.
- Insurance-claim billing = AR per claim (no clinical data model); claim lifecycle tested;
  claims cheques via `notes.received`.
- Pharmacy stock = `inventory.batch_tracking` (+ expiry) verified on golden datasets; no
  drug/clinical catalog fabricated.
- Patient financial files = partner extension with financial data only — clinical records/HIS
  remain out-of-scope, declared in the template doc (ED-11).
- Visits via `crm.service_orders`; every flagship key resolves to an existing feature.
- CAPABILITY_MATRIX gains the HLT column and `insurance_claim_billing` row with citations.

**Acceptance criteria (objective) — copied at completion, 2026-11-08 (verbatim from
[../implementation/phases/PHASE-031.md](../implementation/phases/PHASE-031.md) §6; the
verdict rows live in
[PHASE-031-COMPLETION.md](../implementation/phases/reports/PHASE-031-COMPLETION.md)):**

1. The shell applies and switches via the **unmodified PHASE-015 engine** per BR-038
   (additive-only, audited diff, zero data loss on switch-back) and passes all seven
   governance tests of industries/README §8, in AR and EN.
2. The claim billing workflow runs **end-to-end on a template tenant** — visit → invoice
   (self-pay and insured) → claim open item → claim cheque/PDC note → collection (and
   the dishonor path) — with every journal line-asserted to the existing goldens
   (G-01/G-03/G-24/G-25/G-26) and zero residue on every failure path.
3. The schema change is exactly one additive nullable column (`sales_invoices.claim_ref`)
   with the catalog note per conventions; fresh + regression migrations green; existing
   tenants' behavior unchanged with the template off.
4. `claim_ref_required_for_insured_invoices` enforcement is policy-driven (L1 default,
   L5 override): insured invoices cannot save without a claim ref (typed
   `CLAIM_REF_REQUIRED`); self-pay invoices save with null; toggling the policy changes
   only the capture behavior, never posting.
5. Per-claim tracking reconciles: `Σ per-insurer claim open items = AR control`
   (INV-009/012) at every step; claim allocations respect INV-016; claim cheques obey
   INV-024 (dishonor restores the claim exactly).
6. Dunning and report packs wire **existing** keys only — `notes.aging`,
   `notes.maturity-calendar`, `partners.ar_aging`, `partners.statements`,
   `inventory.expiry_list` — with the optional `group_by_claim` parameter inside the
   existing report contracts; **no new report key is registered** (register §J).
7. Pharmacy flows reuse `inventory.batch_tracking` unchanged: batch/expiry capture at
   GRN, FEFO proposed/forced at dispensing (BR-017), dispensing never exceeds on-hand,
   expiry write-off stays approval-gated with reason `EXPIRED`.
8. **Zero clinical data surfaces** — machine-checked: no clinical field, terminology
   key, or screen exists in the shell; the patient file is a partner financial file only
   (ED-07/ED-11 bolded in the template doc and enforced by CI).
9. Degraded entitlement is graceful: missing OPTIONAL keys (`pos.*`, price lists/tiers,
   `installments.plans`) hide cleanly with the upgrade path; a missing REQUIRED key blocks
   onboarding with actionable guidance; the capability cross-check (HLT column, including
   `insurance_claim_billing` REQ) is green.
10. Docs validation is green (34-phase set, 13 manifests, all links/headings per ED-17),
    with the `sales_invoices` catalog note and CONFIGURATION_ENGINE §4 policy rows landed.

### PHASE-032 — Education Commercial Shell

- Manifest + template doc pass the **7 governance tests**; additive switching rules hold.
- Tuition contracts via `crm.service_contracts` (enrollment years); installment plans via
  `installments.plans` — plan total = contract total (BR-048) tested on golden data.
- Sibling discounts via pricing rules (no new pricing engine surface); dunning uses
  installment aging.
- Academic operations/LMS remain out-of-scope, declared in the template doc (ED-11).
- CAPABILITY_MATRIX gains the EDU column and `installment_terms` row with citations.

### PHASE-033 — Agriculture Commercial Shell

- Manifest + template doc pass the **7 governance tests**; additive switching rules hold.
- Crop-cycle costing via `manufacturing.boms` + production costing verified on golden
  datasets (crop cycle = BOM: inputs → harvest).
- Harvest batches via `inventory.batch_tracking`; livestock as serial-tracked items (no new
  tracking primitives).
- Per-field costing via `accounting.projects` — project dimension tested on agri documents.
- Precision agronomy remains out-of-scope, declared in the template doc (ED-11).
- CAPABILITY_MATRIX gains the AGR column and `crop_cycle_costing`/`harvest_batches` rows
  with citations.

### PHASE-034 — Multi-Entity Consolidation

- **INV-026 enforced**: consolidation runs never write member books; consolidated
  statement = Σ member statements (group currency, dated FX) − eliminations.
- **Zero cross-tenant writes**: cross-tenant reads only via the explicit, audited,
  read-only service (ADR-0018); RLS never relaxed — proven by isolation attack tests.
- Eliminations are balanced journals posted only in the parent's consolidation books
  (golden **G-32** byte-stable); reversible only by counter-entry (BR-056).
- **Member periods closed** prerequisite (BR-056) enforced and tested — a run against an
  open member period is rejected.
- Consolidated TB/IS/BS + eliminations log reconcile to member books on a golden
  two-entity dataset with intercompany balances.
- FX translation uses dated rates from PHASE-007; ownership percentages recorded on
  `group_entities`.
- `consolidation_groups`, `group_entities`, `elimination_entries`, `consolidation_runs`
  tenant-owned + RLS + isolation attack tests.

### Enterprise Depth release gate (end of PHASE-034)

- Every stage 9–11 phase (026–034) is `COMPLETE` with evidence per this file.
- Consolidated statements reconcile to member books with eliminations proven (INV-026,
  golden G-32); zero cross-tenant writes demonstrated (ADR-0018).
- Payroll, fixed-assets, and notes/installments suites green (INV-023…025, goldens
  G-21…G-32).
- Stages 9–11 never alter the MVP (PHASE-014) or GA (PHASE-025) gate criteria (ED-01) —
  expansion evidence is additional, never a substitute.

## Per-phase criteria — Blueprint v3.0 expansion (stages 12+)

Universal criteria U1–U8 above apply unchanged, as do the register §O safeguards. The
v3.0 phases' criteria below distill each phase document's §6; the full evidence ledger
lives in each phase's completion report. (PHASE-035…045's criteria are carried by
their phase documents + completion reports — the first v3.0 register entries begin
with the phases whose acceptance needed a coordinated cross-doc flip.)

### PHASE-046 — HR Payroll Compliance (GOSI / PIT / EOSB)

- **INV-032 enforced**: every statutory line == rate × the CLAMPED wage base, exact
  4dp (the dual-cap law — one base clamps at every row's OWN cap; an above-cap line is
  unrepresentable); the totals tie three ways (Σ lines == run totals == the
  independent jsonb re-fold, tolerance 0); the EOSB delta == entitlement − provision
  exactly (the `ck_eosb_calculations_delta` table-level law).
- Goldens **G-52/G-53/G-54** green with failure packs: the statutory accrual + the
  remittance settlement (one golden, two legs); the employer contribution pair; the
  delta-only EOSB true-up (OPENING / PERIOD / TERMINATION / release mirror / the
  zero-delta no-journal law). ZERO new account purposes, ZERO new treasury movement
  kinds; the 029 regression packs (G-29/G-30/G-31) stay green.
- **BR-085 proven both ways**: a REQUIRES_VERIFICATION row refuses the whole
  calculation typed with the audit event and zero residue; the verify act is
  permission-gated (`payroll.statutory.verify`, owner-only), SoD-bound, CAS-once;
  only VERIFIED rows post — the GOSI rows post out of the box on a KSA tenant (the
  PwC citation is the seed's verification record; the register's open items are
  exactly two: the SANED 15,000 ceiling + the EOSB M/51 Art. 84 text).
- **BR-086**: statutory/variable amounts exist ONLY as run lines through the
  feed-service boundary (called ONCE per run — the negative ledger proof); the
  remittance settles only through the payout machinery; the export is read-only +
  audited.
- **BR-087**: the true-up posts ONLY the delta; settled employees never true-up
  again; TERMINATED employees settle only through G-31 after the alignment; the
  reconciliation view ties entitlement ↔ provision ↔ settled at every row.
- **PIT**: the marginal fold over VERIFIED SET-CONSISTENT bracket sets (per-slice
  half-up 4dp, no absorbed residual); the no-bracket jurisdiction computes zero PIT
  with the explicit honest note (KSA); the gapped-set typed refusal.
- **Variable lines** (the 045 handoff): overtime/absence/late feeds land as run-time
  variable lines with multiplier application; every knob OFF/NULL by default
  (BR-055); encashment stays G-51's machinery.
- **Migrations 0089–0094** apply cleanly from zero with the RLS/catalog checker
  clean at 288 tables; the 0094 RLS-class repair verified end-to-end against the
  realistic pre-states (its evidence kept); every concurrent writer held by the
  permanent race suite on the T-20 floor (the F2 payout × payout + F3
  two-employees-one-run duels).
- **The report contracts** (`payroll.statutory-summary` · `payroll.eosb-liability`)
  render + export with the block-on-fail tie checks; the registry pins re-pinned at
  every site (104 → 106) with zero new permissions (drift 300 = 300).
- **The register** ([../decisions/product/STATUTORY_VERIFICATION_REGISTER.md](../decisions/product/STATUTORY_VERIFICATION_REGISTER.md))
  lists every seeded row with citation, status, reviewer/date, and blocking effect.

### PHASE-047 — HR Growth (Talent & Performance)

- **BR-088 proven both ways**: the FIXED stage ladder refuses every backward/
  sideways/terminal-exit move typed (`STAGE_TRANSITION_INVALID`, zero residue) while
  any forward distance is monotonic (a skip NEW→INTERVIEW is legal); the ONE
  sanctioned backward edge is the recorded REOPEN (REJECTED → SCREEN through the
  dedicated act, the REOPEN record appended to stage_history); the hire link is
  WRITTEN ONCE (the CAS's WHERE carries `hired_employee_id IS NULL` — a second hire
  collapses to the typed conflict); the two-transaction CAS duel proves the stage
  race (zero rows for the loser).
- **BR-089**: the goal set feeds a review submission ONLY at exactly Σ weights =
  100% (the 80% arm refuses typed with zero residue — nothing lands, not even the
  rows that would have been legal alone); the end-to-end cycle closes with the
  worked example 40%@50 + 60%@75 = 65.00 and the CLOSED cycle's immutability.
- **BR-090**: the 360 aggregate renders per relationship kind at the ≥ 3 threshold
  (count/mean/min/max — never an attributed source; below the threshold the typed
  422); the posture holds at every bridge BY CONSTRUCTION — the W-4 appraisal
  export and the W-6 report contract ship MANAGER outcomes only with NO reviewer
  axis, and the 360 inputs never leave the platform (the seeded-bait + row-universe
  proofs).
- **BR-091 (amendment A-2's confirmed wording)**: the four probes fire per
  configured threshold pass (documented default 30/7/0 — tenant-configurable DATA
  with the explicit off switch; NO row = the defaults fire); the bands are disjoint
  with the tightest band's open lower edge (already-expired items stay caught); the
  dedupe is STRUCTURAL via the exact key `hr:{kind}:{employeeId}:{documentId}:
  {threshold}` (the notifications unique index — a re-run never double-alerts);
  NULL expiry/probation never fires.
- **Migrations 0095–0099** apply cleanly from zero with re-apply no-op; the RLS
  catalog checker clean at 307 tables; the A1–A10 attack matrix green over all 14
  talent tables (the generated suite + the dedicated FK-chained hostile worlds with
  the composite-FK law proven live).
- **The four report contracts** (`hr.performance-cycle-results` ·
  `hr.recruitment-pipeline` · `hr.training-completions` · `hr.document-expiry`)
  render + export with the block-on-fail checks; the registry pins re-pinned at
  every site (106 → 110) with zero new permissions and zero new routes (drift
  312 = 312; the catalog↔registry reconciliation extended to 110/110).
- **The external bridges** (acceptance #9): the employee-master and
  employment/org-snapshot exports as CSV/JSON with the A-4 PII cross-check
  STRUCTURAL (the typed forbidden-axes list + the bait scans); the
  appraisal-results and training-completions imports with row-level validation
  reports (the 15-reason typed vocabulary, the in-file collapse law, the
  idempotence laws); the contracts documented in the integrations README §3.10.
- **The OA-06 budgets**: the applicant-pipeline and review-aggregation probes
  index-driven, no seq-scan, the plans logged verbatim (the W-9-settled shape —
  never a forced plan).

### PHASE-048 — Projects & Contracting

- **Migrations 0100–0104 apply cleanly from zero with re-apply no-op** (the
  chain re-proven at W-8, at the full sweeps, and standalone at the final
  head — the scratch `check:rls` 318/0); Drizzle mirror parity held at every
  wave; all 11 new tables (+ the time-entry WBS dimension + the three 0104
  stamp columns) have ENTITY_CATALOG rows (307 → 318) and the column-level
  TABLES doc (`docs/database/TABLES/projects-contracting.md`).
- **The WBS board renders the tree, milestones and dependencies; BR-095's
  rollup reconciles node-by-node; cycles rejected** — `projects-wbs.db.spec`
  (the triple agreement: engine vs. store vs. the pure leaf-recomputed fold;
  the legal diamond; the cycle refusals carrying the path; the 0100
  write-time coherence on `crm_time_entries`); the `/projects` board + the
  Gantt-ish timeline + the EVM tab (W-12).
- **The cost rollup is complete and INV-033 holds to the cent** — the four
  collectors (labor/materials/subcontractor/overhead) with the coherent
  four-leg world 820.3125 + 500 + 9,000 + 625 = 10,945.3125 = the GL project
  dimension EXACTLY (`projects-budgets-actuals.db.spec`, every GL side
  through the REAL PostingService); the typed reconciliation refusing at any
  residual with the per-leg breakdown; the INV-033 golden with the poisoned
  world's typed refusal carrying the FULL per-leg payload (W-14).
- **EVM per project and per node; EV never exceeds the approved budget (the
  typed refusal); the forecast surface renders** — `projects-evm.db.spec`
  (W-10) + the EVM tab (W-12) + `projects.evm-summary` with the
  `evm-ac-gl-tie` block-on-fail assertion (W-14).
- **Change orders inert until approved (BR-094); the approval adjusts
  value/budget/ceiling exactly once (G-58)** — `projects-change-orders.
  db.spec` (the DRAFT +9,999/REJECTED +500 inertness; the all-or-nothing
  rollback; the single-use stamp; DR 1160 · CR 2150 at |+500|; the ceiling
  re-baseline 150,000 → 170,000) + the golden transcript with its failure
  packs (W-14).
- **The goldens G-55…G-58 pass on the seeded chart through the posting
  engine with balanced entries** — each mirrored by its golden transcript
  with the MANDATORY failure pack (the typed refusals WITH their full
  payloads, the zero residue, the flip-and-restore with the green re-run):
  G-55 (the AP linkage + the sub-side hold), G-56 (the release at final
  acceptance, the schedule's gates first), G-57 (the fused billing + the
  in-transaction POSTED invoice), G-58 (the delta exactly once) + the
  IAS-23 golden (the capitalization + the single-use stamp + the
  unverified-register flip) — `projects-goldens.db.spec` (W-14) over the
  W-11 posting arms.
- **Progress certificates generate sales invoices with retention withheld;
  advances post and amortize (the G-33 mirror); BR-093's ceiling holds** —
  `projects-contracting.db.spec` (the five-figure refusal with NO silent
  truncation; the re-baseline only through the REAL G-58 gate; the
  oldest-first amortization bounded by every remaining balance; the
  no-register fail-closed refusal both ways) + `/projects/contracting`
  (W-13) + the two report contracts (W-14).
- **Field service: the dispatch board assigns technicians; the pause-aware
  clocks escalate on breach (BR-096); completion records notes and parts** —
  `projects-fieldservice.db.spec` (the status machine with the stamp law;
  the pause states; the escalation dedupe keys; the pause-subtraction golden
  6h − 3h = 3h; the completed-while-paused law) + `/projects/fieldservice`
  (W-13) + `projects.fieldservice-sla` (the PURE readout, nothing recorded —
  the report-never-records law proven by the unchanged notification count).
- **The CR-36 gates**: +14 keys zero-drift (312 → 326 = 326 at every wave) ·
  i18n parity at the declared deltas (+49 W-12, +138 W-13, ZERO DELTA
  declared W-14 — 6,620 = 6,620 + mobile 371) · the RLS attack matrix A1–A10
  over all ELEVEN tables (the generated suite + the dedicated FK-chained
  hostile worlds, the composite-FK law proven offensively — W-14) ·
  flag/template gating verified (the D-16 composable units + the three
  manifest enablements) · docs:validate 33/33 at every wave · the OA-06
  EXPLAIN budgets (the rollup + the dispatch probes, index-driven, the plans
  logged verbatim — W-14) · **the bilingual contracting prints rendering
  AR/EN with RTL correctness** (the REAL Chromium print test, both
  directions; the labels exclusively through `bi()`; deterministic
  byte-identical across runs; the retention statement carrying NO totals by
  design — W-13) · multi-currency contracts posting through the existing FX
  discipline (the fail-closed missingFxRate — W-11).
- **The completion report + the IMPLEMENTATION_STATUS flip + the archive
  (OA-07, `ERP_PLATFORM_PHASE048.zip`, byte-verified members) + the tag
  `phase/048`** — the W-15 closure wave; the cumulative acceptance ledger
  #1–#10 walked and closed with every wave's evidence pointers (the W-13
  administrative request (a)); the open-items log transferred explicitly
  (the 043 hard review · RISK-031/032 · the 045 notes · the Tabs defect).

### PHASE-049 — CMMS — Asset Maintenance (OPENED AT PLAN 2026-11-21 — the owner's review-framework law: the ledger opens with the plan and closes with the closure; every criterion carries its ARMS and its WAVES; the master plan `agent-ctx/PHASE-049-MASTER-PLAN.md` §3/§4 is the binding division)

**[Dated 2026-11-22 (W-22 DELIVERED — THE ACCUMULATION PLACE per the ratified
عرف 049 option (a); the W-16…W-21 records stand ratified, never rewritten).
WITH THIS WAVE THE LEDGER'S #1…#9 ARE ALL GREEN — this section is now the phase's
SINGLE CITABLE EXIT RECORD; #10 (the closure wave) is W-23's alone.]** This
wave's accumulated deliveries: **T-16 + T-17 DELIVERED** — THE FOUR CMMS REPORT
CONTRACTS (`assets.maintenance-costs` — the engine's own three legs + the LIVE
`inv034-expense-tie` block-on-fail check (the GL maintenance-expense debit vs
the order's own source lines to the cent + the no-posting-before-completion
arm) · `assets.maintenance-backlog` — the overdue ACTIVE plans by their OWN
next-due date + the open orders, the days derived from the database's
CURRENT_DATE (the sweep's derived-step clock law), the `backlog-honest-shape`
check · `assets.meter-readings` — the engine's own log rows with the
`readings-log-shape` check · `assets.expiry-register` — R-10's engine read
verbatim with the `fleet-odometer-single-binding` check) with the registry
**114 → 118 BROKEN BY DESIGN AND DECLARED** at ALL fixation points together
(the 048-W14 law — no partial anchoring) on the EXISTING §3.27 read keys (the
§12 convention; zero new keys, zero new routes) · **THE GOLDEN TRANSCRIPTS
G-59/G-60/G-61 with their MANDATORY FAILURE PACKS** (the refusals WITH their
full payloads, the zero residue, the flip-and-restore with the green re-runs —
`cmms-goldens.db.spec` 7/7) · **THE INV-034 GOLDEN فعل-واحد-بشهادتين** (act
one, witness two: the engine's own verdict and the journal's own landed lines
agreeing TO THE CENT, and no posting before the act) — **#3's transcripts arm
and #4's golden arm CLOSED** · **THE RLS ATTACK MATRIX A1–A10 over the TEN
cmms family tables** (the plan's eight + the two 0109 D-02 tables — the
declared superset; two dedicated probe tenants with FULL FK-chained worlds
through the app-role path; `cmms-rls.db.spec` 10/10) + **the independent
scratch from zero TWICE** (CHAIN_112_APPLIED · check-rls OK — 328, both logs)
— **#9's RLS arm CLOSED** · **THE OA-06 EXPLAIN BUDGETS** (the readings
insert P0 + the readings log P1 + the boards P2/P3 + the timeline's transfers
leg P4 — no seq scan anywhere, never a forced plan, never an isolated probe;
`cmms-explain-budgets.db.spec` 5/5) — **#9's OA-06 arm CLOSED — #9 WHOLE**.
The constants: chain 112 · catalog 328 · drift 337 · routes 1,102 UNCHANGED;
**the report registry 114 → 118 (the authorized broken constant)**; i18n
**6,955 = 6,955 by both counts, ZERO DELTA as declared (registry-bilingual)**
+ mobile 371 standing; unit 8/8 — **148 · 1,868 unchanged** (the pure DB
wave); **THE NINTH DB ENVELOPE RE-ANNOUNCED AT THIS WAVE'S OWN HEAD — 283
files · 3,984 tests · 0 failed · 0 skipped** (the coverage verified before
the first load run: 283 = 283, missing NONE, extra NONE, duplicates NONE; the
one reassembly movement declared: the four W-22 specs join chunk-a 93 → 97 ·
731 → 764); depcruise 2,110 · 15,821 (+9/+83 dated). The structural repairs
the family run caught: the per-arm parts world (freshPartsWorld — no spec's
consumption moves another's stock assertions) + the BR-CM3 order-robustness
supersede dance (both refusal arms provable regardless of file order). The
evidence: `audit-evidence/phase049-w22/` (the gate record — with the W-21
physical-count clarification line: 21 files = 20 logs + the README itself).**

**[Dated 2026-11-22 (W-21 DELIVERED — THE ACCUMULATION PLACE per the ratified
عرف 049 option (a); the W-16…W-20 records stand ratified, never rewritten).** This wave's
accumulated deliveries: **T-14 + T-15 DELIVERED** — `/assets/meters` (the meters board +
THE FLEET REGISTER — R-10's view with the SQL-derived days chips) · `/assets/transfers`
(the SoD-aware ladder with the G-61 verdict's own figures) · `/assets/scan` (the resolver +
the tags admin + **THE PRINT SHEET** — the W-13 law: bi() exclusively, determinism, the QR
pass-through) · **THE EXTENDED ASSET CARD** (the 044 drift honestly repaired + the expiry
chips + the components + the cost-center row + THE SERVICE-HISTORY TIMELINE). **#7's
SURFACE ARMS CLOSED** (the scan resolves to the card; the print renders AR/EN
deterministic — the print-law spec green). **THE WAVE'S TWO HONEST CATCHES** (the G-48
class, both repaired in-step with spec arms): the 0108 family's MISSING WRITE PATH (the
columns read everywhere, written nowhere — the asset PATCH now carries them with the
ancestor-walk cycle law) and the 044 DETAIL DRIFT (the nested payload vs the flat wire
type + the register's phantom computed columns — now real and reconciled EXACTLY). The
constants: chain 112 · catalog 328 · drift 337 · routes 1,102 UNCHANGED; i18n 6,797 →
**6,955** (+158, both counts) · mobile 371 standing; unit 8/8 — **148 · 1,868**; the
affected DB folders re-run (fixed-assets 13+7 · cmms-tags 7 GREEN). The evidence:
`audit-evidence/phase049-w21/` (the gate record).**

**[Dated 2026-11-22 (W-20 DELIVERED — THE ACCUMULATION PLACE per the ratified
عرف 049 option (a); the W-16…W-19 records stand ratified, never rewritten).** This
wave's accumulated deliveries: **T-13 DELIVERED** — `/assets/maintenance` (the orders
board + the plans admin + the checklist entry; the 048 board patterns; the data-slot
two-pane switch immune to the 045 Tabs defect) with **i18n BY BOTH COUNTS** (the
FIRST SURFACE WAVE: 6,620 → 6,797 per side, the +177 `assetsMaintenance*` delta, AND
mobile 371 = 371 standing) and the flag-gating registered (the NAV_ITEMS row
`assets.maintenance` on the exact D-16 composable unit — the sidebar + the ⌘K palette
ride it); the board renders the engines' figures VERBATIM (the engine-output law —
the engine totals, the completion's OWN INV-034 verdict, the evaluation's NAMED
skips; the 8 component-test arms green). The constants: chain 112 · catalog 328 ·
drift 337 · routes 1,102 all UNCHANGED (the pure web wave); unit 8/8 — **144 ·
1,852**; the DB suite NOT re-run per the scope-label law (the standing 279 · 3,951
at `b7ed567` rides; W-23 re-runs it). The evidence: `audit-evidence/phase049-w20/`
(the gate record).**

**[Dated 2026-11-21 (W-19 DELIVERED at `b7ed567` — THE ACCUMULATION PLACE per the
ratified عرف 049 option (a): this ledger accumulates every wave's delivered arms from
W-0 to the W-23 closure, giving the closure its ONE CITABLE CUMULATIVE RECORD; the
W-16/W-17/W-18 deliveries are recorded in their own evidence READMEs — their gate
records — and ratified, never rewritten).** This wave's accumulated deliveries: **#7's
API arms DELIVERED** (the signed codes' entropy/uniqueness + the pre-lookup signature
gate + the RLS-scoped scan resolving the asset card + the CAS printed stamp + the
zero-parallel print payload — `cmms-tags.db.spec` 7 arms green; the print sheet's
`bi()` surface closes at W-21) · **#8 DELIVERED** (the `asset-expiry-sweep`: the
30/7/0 ladder × the four classes with the S-15 severities, the structural dedupe
`assets:{class}:{assetId}:{threshold}`, the no-arming/no-double-launch convergence,
the seal-after-success audit record `assets.expiry_sweep_run` in the same
transaction, the typed settings surface over `assets.expiry_sweep_thresholds`, the
fleet-light register's four chips + the odometer binding — `cmms-expiry-sweep.db.spec`
4 arms green as THE FOURTH ISOLATE) · **#1's from-zero arm re-proven at the 112
chain** (both scratch runs: `CHAIN_112_APPLIED`, check-rls OK — 328; the honest slots
0111+0112 per the plan §2's W-19 dated amendment) · **#9's keys arm advanced by the
dated amendment**: the drift equality is now **337 = 337** (336 + the ONE sweep
threshold key `assets.expiry.manage`, matrix §3.27's W-19 note; zero-drift re-proven).
The evidence: `audit-evidence/phase049-w19/README.md` (the gate record — the battery
279 · 3,951 · 0 failed · 0 skipped; the final expected fingerprint CONFIRMED: chain
112 · catalog 328 · drift 337 · routes 1,102). The prior waves' accumulation: W-16
delivered #1's opening (the migrations + the catalog 326 + the zero-drift 336, the
plan-wave envelope `audit-evidence/phase049-w16/`) · W-17 delivered #2's ladder, #3's
G-59, #4's collectors, #5's calendar side (`audit-evidence/phase049-w17/`) · W-18
delivered #5's meter side, #6, #3's G-60/G-61 arms (`audit-evidence/phase049-w18/`).**]

1. **Migrations 0105–0108 apply cleanly from zero with re-apply no-op;
   Drizzle mirror parity; all 8 new tables + the `assets` column family have
   ENTITY_CATALOG rows (318 → 326) and the fixed-assets TABLES doc
   extension.** — *Arms:* the migration chain spec pinned to 108 (the
   from-zero boot embedded in every full run) · the standalone scratch
   `check:rls` 326/0 · the drift checker **336 = 336** (the +10 keys
   seeded). *Waves:* W-16 (opens) · re-proven at every full sweep · W-23
   (closes with the standalone scratch at the final head).
2. **The work-order status machine enforces REQUESTED→PLANNED→IN_PROGRESS→
   ON_HOLD→COMPLETED only; completion is BLOCKED while checklist steps are
   open (BR-098) or cost lines are unposted/unpriced.** — *Arms:*
   `cmms-workorders.db.spec` — the legal ladder walks, every illegal
   transition refused BY NAME, the open-step completion refusal carrying the
   open count, the unpriced-labor completion refusal (an unset rate =
   UNPRICED, never a fabricated rate). *Waves:* W-17 (proves) · W-20 (the
   board renders the machine's states verbatim).
3. **The goldens pass on the seeded chart through the posting engine with
   balanced entries: G-59 (maintenance expense at completion — labor +
   parts + external, the asset's cost and depreciation UNTOUCHED) · G-60
   (spares consumption — the inventory-issue leg under BR-099's
   no-negative-stock floor) · G-61 (transfer approval — the NBV
   reclassification between branch cost centers, posted exactly once,
   BR-100)** — all idempotent (INV-013), with the failure packs. — *Arms:*
   the posting arms at W-17/W-18 + **W-22's golden transcripts with the
   MANDATORY failure packs** (the typed refusals WITH their full payloads,
   the zero residue, the flip-and-restore with the green re-run). *Waves:*
   W-17 (G-59) · W-18 (G-60/G-61) · W-22 (the transcripts close).
4. **INV-034 holds: per work order, the GL maintenance expense equals the
   sum of its labor, parts and external source lines TO THE CENT; no
   posting occurs before completion.** — *Arms:* the cost collectors' typed
   reconciliation with the per-leg breakdown + **W-22's INV-034 golden (the
   poisoned world's typed refusal — the INV-033 pattern)**. *Waves:* W-17
   (opens with the collectors) · W-22 (the golden closes).
5. **Preventive plans behave: a CALENDAR plan generates on its day interval;
   a METER plan generates when the reading delta crosses its threshold; at
   most one open order per asset per trigger window (BR-097); back-dated
   readings cannot double-trigger.** — *Arms:* `cmms-plans.db.spec` — the
   calendar due-date walk, the meter-threshold crossing, the single-open
   refusal, the back-dated no-double-trigger arm (the anchor is the
   generation's own stamp). *Waves:* W-17 (the calendar side + the plans
   API) · W-18 (the meter side completes it).
6. **Meter readings validate monotonically per meter with effective-date
   order; the last-reading snapshot and the usage views reconcile with the
   log.** — *Arms:* `cmms-meters.db.spec` — the monotonic refusal carrying
   both values, the effective-date insertion order, the snapshot/usage
   reconciliation, the JOB-source readings. *Waves:* W-18.
7. **Asset tags: generated codes are unguessable and unique; scanning
   resolves to the asset card (the standard auth + RLS stack — a foreign
   tenant's scan is a typed 404); the print sheet renders AR/EN with RTL
   correctness, deterministic byte-identical.** — *Arms:* `cmms-tags.db.spec`
   (the code entropy/uniqueness, the signature verification, the scan
   resolution + the foreign-tenant refusal) + the print spec (both
   directions, `bi()` exclusively — the W-13 law). *Waves:* W-19 (the API
   arms) · W-21 (the print + the scan surface close it).
8. **The `asset-expiry-sweep` fires 30/7/0-day alerts for warranty,
   insurance and license — and inspection where a tenant tracks it (the
   R-10 fleet-light class) — deduplicated; evidence in the job log and the
   notification records.** — *Arms:* `cmms-expiry-sweep.db.spec` — the three
   windows + the fourth class, the dedupe key per asset+class+window+day.
   *Waves:* W-19.
9. **The CR-36 gates: +10 permission keys with zero-drift equality (326 →
   336 = 336 at every wave) · i18n parity BY BOTH COUNTS from the first
   surface wave (each web wave declares its delta; mobile 371 standing) ·
   the RLS attack matrix A1–A10 over all EIGHT new tables (the hostile
   worlds, the composite-FK law offensively proven) · flag/template gating
   verified (the D-16 composable units; automotive-workshop, rental-
   logistics, healthcare, food-manufacturing compose by default) ·
   `docs:validate` green · the OA-06 budgets (indexes + EXPLAIN on the
   readings insert, the boards and the service-history timeline).** —
   *Waves:* W-16 (the keys) · W-20/W-21 (the i18n both counts + the flag
   gating + the boards) · W-22 (the RLS + the OA-06 close them).
10. **The completion report `reports/PHASE-049-COMPLETION.md` with the
    cumulative ledger #1–#10 walked and closed (every wave's evidence
    pointers) + the IMPLEMENTATION_STATUS flip + the archive
    `ERP_PLATFORM_PHASE049.zip` (OA-07 — EXCLUDING every standing platform
    zip: the amended archive law, أرشفة الأرشيف ممنوعة) + the tag
    `phase/049` (DELIVERY, never acceptance).** — *Waves:* W-23 (closes the
    ledger and the phase; the open-items log transferred explicitly).

### PHASE-050 — Quality Management System (OPENED AT PLAN 2026-11-22 — the owner's review-framework law: the ledger opens with the plan and closes with the closure; every criterion carries its ARMS and its WAVES; the master plan `agent-ctx/PHASE-050-MASTER-PLAN.md` §3/§4 is the binding division; the five dated corrections F-1…F-4 + the archive-form acknowledgment landed with the plan wave; the reservations G-62…G-63 · INV-035 · BR-101…BR-104 — لا كتابة خارجها)

> **[Dated 2026-11-23 (PHASE-050 W-31 — T-18 delivered, the proof pack
> under the owner's standing order — «عند الانتهاء من أي خطوة ادفعها إلى
> المستودع», pushed at its own commits: `ca52143` the specs + the
> affected folders → this battery/gate/ledger increment; the evidence
> `audit-evidence/phase050-w31/`, the FORTY-SECOND consecutive
> same-session wave): #2's GOLDEN TRANSCRIPTS DELIVERED —
> `quality-goldens.db.spec` 7 arms (the 049 cmms-goldens precedent's
> shape — the golden transcript + THE MANDATORY FAILURE PACK per
> golden, the JOURNAL_RULES §7 law): the G-62 transcript (DR 5110 · CR
> 1140, 12.5000 balanced to the cent; the write-off move; INV-013
> single-use; the batch ledger 100 → 95) + its failure pack (the
> unmapped-purpose refusal WITH the full payload + the ZERO residue +
> the flip-and-restore GREEN re-run) + the on-hand floor naming BOTH
> figures · the G-63 transcript (DR 5320 · CR 2137, 480.0000; the cost
> stamp + the journal link in ONE CAS) + its failure pack · **#3's
> GOLDEN ARMS DELIVERED** — the INV-035 blocking-matrix golden (the
> four canonical paths each refused with the FULL payload + the zero
> residue per path + the release + the green flip-and-restore re-run)
> + **the offline-rejection shape (D-20/OA-02: the offline leg's POST
> is the same plan — the same typed BATCH_QUALITY_HELD,
> payload-for-payload equal)** · **#9's RLS + OA ARMS DELIVERED** —
> `quality-rls.db.spec` 10 arms (the cmms-rls precedent's exact set:
> A1/A2/A3/A4/A5/A7/A8/A9/A10 + the census — the twelve tables each
> covered ≥ 6 times: the forged-tenant INSERTs 42501 · the UPDATE
> hijacks 0 rows byte-identical · the DELETE grants law (nine evidence
> tables DENIED) · the composite-FK law (the catalog walk + the live
> FK-inversion 23503) · the recursive-CTE cycle walk) +
> `quality-explain-budgets.db.spec` 4 arms (the OA-06 budgets: the
> where-used leg rides ix_stock_moves_tenant_batch · the doc→customer
> resolution the planner's own index paths · the SPC chart read
> ix_spc_measurements_tenant_spec_sampled Index Scan Backward — never a
> forced plan, never an isolated probe context) — **#1…#9 ALL GREEN;
> only #10 (the W-32 closure) remains.** The battery (this gate
> increment, every log this session): THE FIVE ISOLATES STANDALONE
> FIRST (soak 1·1 228.67s · fcm 1·8 · email 1·5 · the cmms sweep 1·4 ·
> the quality calibration sweep 1·4) · the affected folders (the
> quality family **17 · 188 GREEN** — the family 167 → 188 · migrations
> + identity-flows 2 · 28 over the 1,159 routes) · the coverage roster
> (chunk-a 110 → 113 · the roster 296 → 297 → **300**; 300 = 300,
> missing NONE, extra NONE, duplicates NONE — VERDICT: COVERED) · the
> 118-chain scratch from zero TWICE · typecheck 8/8 (0 cached) · lint
> 8/8 (0 cached — no catch this wave) · depcruise clean 2,195 modules ·
> 16,411 dependencies (+3/+35 dated) · unit 8/8 — 167 · 2,020 standing
> · i18n 7,253 = 7,253 standing + mobile 371 = 371 · drift 347 = 347 ·
> manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors + self-test
> all-probes-OK · history-secrets 0 violations · 6,790 allowlisted hits
> (the FOUR tag anchors untouched) · ROUTE_PERMISSIONS 1,159 standing ·
> the registry 315 tenant-owned tables · the report registry 122 ·
> capabilities agree · shells PASS/PASS · boundary PASS.]**

> **[Dated 2026-11-23 (PHASE-050 W-30 — T-16 + T-17 delivered under the
> owner's standing order — «عند الانتهاء من أي خطوة ادفعها إلى
> المستودع», every step pushed at its own commit: `dd08585` the engines
> → `0de7ebe` the DB specs → this battery/gate/ledger increment; the
> evidence `audit-evidence/phase050-w30/`, the FORTY-FIRST consecutive
> same-session wave): #8's TEMPLATE ARM DELIVERED — the management
> review pack (the official MRV-{YYYY}-{SEQ:6} numbering + **THE FROZEN
> INDICATOR PACK** — the NCR/CAPA/complaint/SPC status counts read
> through the engines' OWN reads and frozen at create; a later state
> never moves a stored pack, proven by the spec) + the HACCP hazard
> registers (the 0116 table's own shape: the hazard, the CCP flag, the
> critical limits, the monitoring, the corrective actions) + **the
> food-manufacturing template composes the quality plane** (the template
> doc's QMS section — the hazard registers + the review pack + the six
> quality surfaces; template-composable, never hardcoded; manifests
> 13/13 standing) · `quality-reviews-hazards.db.spec` 8 arms (the frozen
> pack asserted VERBATIM against the world's actual counts · the
> frozen-snapshot law · the hazard constraint law · the RLS boundary).
> #9's REPORT ARMS DELIVERED — **the four report contracts (registry
> 118 → 122, ALL PIN SITES TOGETHER — D-18)**: quality.ncr-register (the
> register's own rows + the item/partner briefs + the
> ncr-status-vocabulary check — no quantity totals across unlike units)
> · quality.capa-status (BR-103's gate verdict figures through the same
> capaCloseGate fold the close act rides + the capa-closure-shape check)
> · quality.calibration-due (the sweep's own probe shape — the effective
> thresholds ladder ∪ the documented [30,7,0] default, disjoint bands,
> the instruments' LATEST due dates — never running the sweep) ·
> quality.complaints-summary (the grouped counts by status/channel/
> severity + the complaints-count-tie check) — the pin moves verified
> green in their own suites (golden + industry-018 + industry-019 +
> cmms-reports 4 · 36). The battery (this gate increment, every log
> this session): THE FIVE ISOLATES STANDALONE FIRST (soak 1·1 228.09s ·
> fcm 1·8 · email 1·5 · the cmms sweep 1·4 · the quality calibration
> sweep 1·4) · the affected folders re-run at the delta head (the
> quality family **14 · 167 GREEN** — the family 159 → 167 · migrations
> + identity-flows 2 · 28 over the **1,159** routes · the reporting
> family 4 · 36) · the coverage roster's declared movement (chunk-a 109
> → 110 · the roster 296 → 297; 297 = 297, missing NONE, extra NONE,
> duplicates NONE — VERDICT: COVERED) · the 118-chain scratch from zero
> TWICE (both CHAIN_118_APPLIED → [check-rls] OK — 340) · typecheck 8/8
> (0 cached) · lint 8/8 (0 cached — no catch this wave) · depcruise
> clean **2,192 modules · 16,376 dependencies** (+8/+64 dated) · unit
> 8/8 — **167 · 2,020 standing** (no unit delta — an API-DB wave) ·
> i18n 7,253 = 7,253 standing (no delta) + mobile 371 = 371 · drift
> **347 = 347** (zero delta — the seven W-30 routes bind the standing
> keys) · manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors +
> self-test all-probes-OK · history-secrets 0 violations · 6,762
> allowlisted hits (the window's shift; the FOUR tag anchors untouched)
> · ROUTE_PERMISSIONS **1,159** (the tsx recount — 1,152 + 7) · the
> registry 315 tenant-owned tables · the report registry **122** ·
> capabilities agree · shells PASS/PASS · boundary PASS.]**

> **[Dated 2026-11-23 (PHASE-050 W-29 — T-15 delivered, the web plane under
> the owner's standing order — «عند الانتهاء من أي خطوة ادفعها إلى
> المستودع», every step pushed at its own commit: `6171b09` the screens →
> `f749298` the specs → this battery/gate/ledger increment; the evidence
> `audit-evidence/phase050-w29/`, the FORTIETH consecutive same-session
> wave): THE SIX QUALITY SCREENS (D-17 — the data-slot shape, the 048/049
> board patterns): `/quality/ncr` · `/quality/capa` · `/quality/calibration`
> · `/quality/spc` (rides the `quality.spc` feature key) ·
> `/quality/complaints` · `/quality/coa` (the certificates register + the
> generate act + THE PRINT PREVIEW) — every figure an ENGINE OUTPUT
> rendered VERBATIM (zero client-side recomputation), the segmented Button
> switches (never the Tabs primitive), the typed-refusal panels with FULL
> payloads, the mono cells dir=ltr, the DataTable +
> activeLocaleHeader columns, the one-line localized refusals through
> `localizedQualityError` (all 33 quality codes). #4's PRINT ARM
> DELIVERED — the W-13/W-21 print laws: the COA builder (`lib/coa-print.ts`
> — bi() EXCLUSIVELY, zero parallel computation, the frozen parameters
> VERBATIM, .num LTR-mono, a real thead) + **THE REAL CHROMIUM TEST both
> directions** (`quality-coa-print-render.db.spec` 3 arms: both locales'
> html carries thead + dir + the numeric class + the embedded woff2; the
> REAL PDF render (%PDF, pages ≥ 1, byteLength > 10_000) for both; the
> determinism arm — two builds byte-identical + two renders
> byte-identical modulo the renderer's own Skia clock stamps, the
> probe-evidenced finding dated in the spec) + the web print spec
> (`lib/__tests__/coa-print.test.ts` 3 arms: dictionary-exclusivity both
> locales · byte-identical determinism · VERBATIM figure pass-through).
> #9's I18N ARM DELIVERED — **BY BOTH COUNTS (the first-surface-wave
> law): 6,955 + 298 = 6,955 + 298 — ar=7,253 = en=7,253, 100% parity,
> no empty values** + mobile 371 = 371 standing. THE HOLD BANNERS (the
> shared `batch-hold-banner.tsx` — role=status, the warning tokens, the
> reason + heldAt VERBATIM) wired into the batch-bearing surfaces (the
> inventory batches registry + the manufacturing genealogy surface — one
> parallel active-holds read per surface, additive, degrading to no
> banners on a 403; the banner spec 3 arms). THE FLAG-GATING VERIFIED
> (the six NAV_ITEMS rows carry the exact featureKeys — `quality` ×5 +
> `quality.spc` on the SPC row — + the permission keys + both label
> sides; the ⌘K palette inherits them through resolveNavigation, OA-04;
> the 403 degradation arms the pages carry). The web suite **21·171 →
> 30·204** (+9 files, +33 tests). The battery (this gate increment,
> every log this session): THE FIVE ISOLATES STANDALONE FIRST (soak
> 1·1 227.96s · fcm 1·8 · email 1·5 · the cmms sweep 1·4 · the quality
> calibration sweep 1·4 — every VITEST_EXIT=0) · the affected folders
> re-run at the delta head (the quality family **13 · 159 GREEN** — the
> family 156 → 159 · migrations + identity-flows 2 · 28 over the 1,152
> routes) · the coverage roster's declared movement (chunk-a 108 → 109 ·
> the roster 295 → 296; 296 = 296, missing NONE, extra NONE, duplicates
> NONE — VERDICT: COVERED) · the 118-chain scratch from zero TWICE (both
> CHAIN_118_APPLIED → [check-rls] OK — 340) · typecheck 8/8 (0 cached —
> the force re-run) · lint 8/8 (0 cached — no catch this wave) ·
> depcruise clean **2,184 modules · 16,312 dependencies** (+24/+174
> dated) · unit 8/8 — **167 · 2,020** (api 78·976 · web **30·204** ·
> mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 ·
> domain-core 6·38 · sync-core 5·36 — the ledger arithmetic **2,020 =
> 976+204+840 EXACT**, the F-2 third term standing) · drift 347 = 347 ·
> manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors + self-test
> all-probes-OK (probe 7 stands at G-62/PHASE-050) · history-secrets 0
> violations · 6,723 allowlisted hits (the window's shift; the FOUR tag
> anchors untouched) · ROUTE_PERMISSIONS **1,152** standing (no new
> routes — a surface wave) · the registry 315 tenant-owned tables ·
> capabilities agree · shells PASS/PASS · boundary PASS.]**

> **[Dated 2026-11-23 (PHASE-050 W-28 — T-12 + T-13 + T-14 delivered, the
> complaints + holds + recall wave under the owner's standing order — «عند
> الانتهاء من أي خطوة ادفعها إلى المستودع», every step pushed at its own
> commit: `edc3fe2` the engines → `a6d4685` the DB specs → this
> battery/gate/ledger increment; the evidence `audit-evidence/phase050-w28/`,
> the THIRTY-NINTH consecutive same-session wave): #3's blocking arms
> DELIVERED — **THE SHARED BLOCKING VALIDATION SERVICE (D-07: ONE service,
> the ONLY gate) wired INSIDE the inventory movement core's planIssue**
> (the reserved-pool hard-protection precedent's own choke point — every
> issue/ship path passes it BY CONSTRUCTION, the enforcement-drift risk
> closed structurally; the gate judges the RESOLVED plan — the line's
> explicit batch AND the FEFO auto-pick alike): `quality-holds.db.spec` 8
> arms over real PG16 — THE RAW CHOKE POINT (the typed BATCH_QUALITY_HELD
> naming the batch + the reason + the figures) · THE INVENTORY ISSUE PATH
> (the manualIssue refused with ZERO residue — no moves added, no journal,
> the read world-scoped) · THE SALES DELIVERY PATH (the post refused, the
> document stays DRAFT, zero moves) · THE TRANSFER PATH (the dispatch
> refused on the FEFO-resolved held batch) · THE FEFO ARM (a held batch
> expiring first is never silently issued — the strict reject, never a
> silent skip) · THE SOLE BYPASS (the G-62 write-off issues the HELD
> batch at the NCR's SCRAP disposition — the sole allowHeldBatch caller,
> BR-101's own ordering: the release comes after, justified by this very
> disposition) · THE RELEASE RULE (BR-101's floor — a bare hold's release
> refused HOLD_RELEASE_DISPOSITION_REQUIRED; the one-active-per-batch law
> refused BY NAME; THE FLIP-AND-RESTORE — the linked hold releases with
> the justification note and the previously refused manualIssue posts
> GREEN through the REAL engine; the RELEASED register refuses every
> move) · the register's floors (the 404 shape, the active read, the RLS
> boundary) — the INV-035 invariant test extending the document-validation
> matrix's own shape (the reservation-hard-protection precedent); the
> W-31 golden (the offline-rejection shape) remains W-31's. #7's drill
> arms DELIVERED — `quality-recall.db.spec` 4 arms (THE DRILL QUERY: a
> shipped batch resolves through the REAL delivery path to its customer
> — the genealogy walk's sales edge VERBATIM (D-14: consumed through
> ManufacturingModule's exported GenealogyService, zero parallel
> computation) + the customer fold deduped; the nothing-shipped batch the
> honest empty scope · THE RECORD: initiate → execute — **THE FROZEN
> SNAPSHOTS (the kind-tagged where-used array per 0116's own jsonb-array
> law + the affected-customers array)** → close; the close-before-execute
> refused; the FROZEN SNAPSHOT LAW — a later delivery never moves a
> stored scope; the re-execute refused (the single-use stamp) · the held
> batch's own recall — the drill works beside an ACTIVE hold (the record
> is not the gate: INV-035 blocks issues, never reads) · the RLS boundary
> + the not-found floor) — the OA-06 EXPLAIN budget is W-31's arm. #2's
> complaints arms DELIVERED — `quality-complaints.db.spec` 5 arms (the
> intake with the official CMP-{YYYY}-{SEQ:6} number + THE INTAKE
> NOTIFICATION (category 'quality', the structural dedupe) · the ladder
> triage→progress→resolve→close through the REAL CAS, the triage carrying
> the first NCR link · the link window's refusals · the resolution-pair
> floor · the RLS boundary). **THE HONEST CATCHES (three, all RED-proven
> with the logs, no battery red standing): (1) the execute act's scope
> snapshot was a jsonb OBJECT — 0116's ck_recall_registry_scope_shape
> demands an ARRAY (caught at the FIRST DB run,
> `db-first-run-RED.log`, 4 failed); the repair is the kind-tagged
> where-used entries array (the honest shape within the constraint); (2)
> the intake arm's dedupe-key lookup interpolated the key UNQUOTED into
> the raw SQL — parameterized; the same first run caught the fixture
> codes' length (the warehouses' 20-char shape) and the missing
> ownerTarget substrate (the QL tenant's OWNER membership seeded per the
> QSW recipe); (3) the step-1 hold-blocking spec's shuffle helpers
> carried Math.floor — caught RED by this gate increment's standing lint
> (`lint-RED.log`, 7/8, the ADR-0009 rule), repaired with the house
> bitwise truncation (the W-27 catch's own precedent), GREEN 8/8.**
> ROUTE_PERMISSIONS **1,134 + 18 = 1,152** — the keys-seed-first FOURTH
> binding wave (the complaints eight + the holds four + the recall six,
> dated at the block — the BLOCKING side of INV-035 is NOT a route: it is
> the gate in the movement core); the error filter's domainStatus rows in
> the same increment (the three 404s; the 409s incl. BATCH_QUALITY_HELD;
> the policy classes fall through to 422). The battery (this gate
> increment, every log this session): THE FIVE ISOLATES STANDALONE FIRST
> (soak 1·1 229.01s · fcm 1·8 · email 1·5 · the cmms sweep 1·4 · the
> quality calibration sweep 1·4 — every VITEST_EXIT=0) · the affected
> folders re-run at the delta head (the quality family **12 · 156
> GREEN** — the family 139 → 156 · migrations + identity-flows 2 · 28
> over the **1,152** routes) · the coverage roster's declared movement
> (chunk-a 105 → 108 · the roster 292 → 295; 295 = 295, missing NONE,
> extra NONE, duplicates NONE — VERDICT: COVERED; the full ten-part
> envelope re-runs at W-32) · the 118-chain scratch from zero TWICE (both
> runs CHAIN_118_APPLIED → [check-rls] OK — 340 catalog tables →
> SCRATCH_STOPPED, EXIT=0) · typecheck 8/8 (0 cached — the force re-run)
> · lint 8/8 (0 cached — the RED/repair disclosed above) · depcruise
> clean **2,160 modules · 16,138 dependencies** (+13/+64 dated) · unit
> 8/8 — **158 · 1,987** (api **78·976** · web 21·171 · mobile 27·393 ·
> desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 ·
> sync-core 5·36 — the ledger arithmetic **1,987 = 976+171+840 EXACT**,
> the F-2 third term standing) · i18n 6,955 = 6,955 (no delta, as
> declared — an API-DB wave) + mobile 371 = 371 · tokens 50/50 · drift
> **347 = 347** (zero delta — no new keys) · manifests 13/13 ·
> docs:validate 33/33 · id-ledger 0 errors + self-test all-probes-OK
> (probe 7 stands at G-62/PHASE-050 — the 050 flip is W-32's) ·
> history-secrets 0 violations · **6,687 allowlisted hits** (the W-27
> 6,654 +33 — the window's shift: the W-28 session commits entering the
> last-200 sample; the FOUR tag anchors untouched) · ROUTE_PERMISSIONS
> **1,152** (the tsx recount) · the registry 315 tenant-owned tables ·
> capabilities agree · shells PASS/PASS · boundary PASS.]**

> **[Dated 2026-11-23 (PHASE-050 W-27 — T-09 + T-10 + T-11 delivered, the
> SPC + supplier-scores + COA wave under the owner's standing order — «عند
> الانتهاء من أي خطوة ادفعها إلى المستودع», every step pushed at its own
> commit: `20255ac` the engines → `fa71b27` the DB specs → this
> battery/gate/ledger increment; the evidence `audit-evidence/phase050-w27/`,
> the THIRTY-EIGHTH consecutive same-session wave): #5 CLOSED — the SPC
> pure module FIRST (D-12, the unit-first law): `spc-statistics.ts` THE
> ONLY SPC ARITHMETIC IN THE MODULE — the pinned Shewhart constants table
> n=2…10 (A₂/D₃/D₄/d₂ at 3dp) · the subgroups chunk with the trailing
> partial group EXCLUDED and disclosed (`excludedCount` — a partial group
> is not evidence) · X̄ᵢ/rᵢ at 6dp · X̄̄±A₂R̄ / D₃R̄/D₄R̄ · σ̂=R̄/d₂ ·
> Cp=(USL−LSL)/6σ̂ and Cpk=min(USL−X̄̄, X̄̄−LSL)/3σ̂ against the
> SPECIFICATION band (one-sided/unset → NULL, the no-fabrication law) ·
> the out-of-control flags judging the PUBLISHED figures (the
> closed-interval law — ON a limit is within) · the degenerate R̄=0
> collapse (null σ̂/Cp/Cpk, never a fabricated infinity) — with its **13
> property tests on THREE PINNED REFERENCE DATASETS** (A stable: **Cp
> 1.163000 EXACT · Cpk 1.114542 · UCLx 10.255800**; B the X-chart mean
> shift — the fifth subgroup flagged ABOVE; C the R-chart range spike —
> flagged on R only) + the constants-table shape walk + the order-freedom
> ×50 + the independent JS-oracle ×100; `quality-spc.db.spec` 8 arms over
> real PG16 (THE CHART READ vs THE PURE MODULE VERBATIM on the pinned
> dataset A — the DB's own numeric(19,6) canonical strings feeding the
> independent fold; the DESC-cap law — the newest 20 samples charted, the
> wild older pair excluded; the trailing partial group excluded and
> disclosed; the ingestion floors — the unknown spec the 404 shape, the
> source vocabulary and the unknown batch the typed refusals, the
> NEGATIVE VALUE LEGAL arm (a temperature can be −5); the batch provenance
> read; the RLS boundary — the isolated tenant sees no samples and the
> chart is the 404 shape). #6's score arms CLOSED —
> `quality-supplier-scores.db.spec` 8 arms (THE PINNED WORLD through the
> REAL purchasing services: one on-time + one late POSTED delivery (PO →
> issued → GRN → posted through the REAL engine, G-07's own path) + one
> FAIL goods-receipt inspection + one SUPPLIER-source NCR → ncrCount 1 ·
> rejectionCount 1 · total 2 · onTime 1 → **the pinned blend defectLeg 0 ·
> deliveryLeg 50 · score 20.00**; the idempotent upsert — ONE row per
> period, the version advances; THE UNMEASURED ZERO — no deliveries →
> 0.00, evidence never decoration; the calendar-month + kind + not-found
> floors, all typed; **THE DOCUMENTED 038 FEED CONTRACT (D-13)** — the
> scorecard recompute's detail carries the quality rows VERBATIM (the
> consumer READS, never re-computes) + the feed door's own read + the
> honest empty shape; the RLS boundary; the window law — an outside-month
> delivery never counts) + the supplier-score pure fold (the pinned
> 0.60/0.40 blend · the drag cap · monotonicity · convexity bounds ×200 ·
> the weights pin — 10 property tests) — the specs mapping contract arm
> stood DELIVERED at W-25 (`quality-specs.db.spec`). #4's SERVICE ARM
> DELIVERED (the print is W-29's): `coa-gate.ts` BR-104's pure three-shape
> fold (WITHIN/UNBANDED pass · OUTSIDE fails naming the parameter + BOTH
> figures · OUTSIDE+accepted-NCR passes as DEVIATION_ACCEPTED with the
> tolerance verdict kept honest (ABOVE_UCL, never re-judged) · the
> coverage law: missing/foreign/duplicate each block, named — 11 tests;
> the fold COMPOSES the tolerance fold, the module's ONLY evaluator,
> W-25's law) + `quality-coa.db.spec` 9 arms (BR-104's three shapes over
> the real register incl. the Arabic parameter names in the frozen
> snapshot; OUTSIDE blocked with the ZERO RESIDUE — the refusal rolls the
> number reserve back; the deviation floors — an OPEN NCR is not an
> acceptance, another item's NCR is not this item's; the provenance floors
> — the foreign batch, the foreign FG-batch inspection, the GRN per-line
> resolution through the purchasing store's own line read; THE FROZEN
> SNAPSHOT — a later spec PATCH never moves a stored certificate; the
> reads + the RLS boundary) + the CoaService (the official
> COA-{YYYY}-{SEQ:6} numbering, both certificate types one sequence).
> **THE HONEST CATCH OF THE WAVE (the 0109/0110 precedent, caught RED at
> the FIRST DB run, before any push of the spec increment):** the step-1
> store's `spc_measurements` INSERT carried `note_ar` — a column the 0113
> table does NOT have (the samples are operational rows, a single note
> column; the bilingual note_ar is the master-data registers' shape) — the
> first run's 42703 refused the INSERT BY NAME
> (`db-first-run-RED.log`, 8 failed); the repair removes note_ar from the
> store row, the service input, and the controller schema, with the dated
> comment at the store's column block; GREEN 9·139.** ROUTE_PERMISSIONS
> **1,125 + 9 = 1,134** — the keys-seed-first THIRD binding wave (the SPC
> chart/measurement reads on quality.spc.view + the ingestion on
> quality.manage · the supplier reads + the feed door on quality.view +
> the recompute on quality.manage · the COA generation on
> quality.coa.generate + reads on quality.view, dated at the block); the
> error filter's domainStatus rows in the same increment. The battery
> (this gate increment, every log this session — the environment reset
> recovered FIRST: the EIGHTH — the fresh clone, pnpm 9.15.9, the
> workspace install, the persistent-store embedded-PG16 binaries re-linked
> and the chromium 1200/1248 shells provisioned BEFORE the runs): **THE
> FIVE ISOLATES STANDALONE FIRST** (soak 1·1 229.30s · fcm 1·8 15.65s ·
> email 1·5 · the cmms sweep 1·4 · the quality calibration sweep 1·4,
> every VITEST_EXIT=0) · the affected folders re-run at the delta head
> (the quality family **9 · 139 GREEN** — the schema 59 + the specs 11 +
> the NCR 13 + the CAPA 17 + the calibration 10 + the sweep 4 + the SPC 8
> + the supplier scores 8 + the COA 9 · migrations + identity-flows 2 · 28
> over the **1,134** routes) · the coverage roster's declared movement
> (chunk-a 102 → 105 · the roster 289 → 292; 292 = 292, missing NONE,
> extra NONE, duplicates NONE — VERDICT: COVERED; the full ten-part
> envelope re-runs at W-32) · the 118-chain scratch from zero TWICE (both
> runs CHAIN_118_APPLIED → [check-rls] OK — 340 catalog tables →
> SCRATCH_STOPPED, EXIT=0) · typecheck 8/8 (0 cached — the force re-run) ·
> lint 8/8 (0 cached) **with the honest catch of this increment — the
> step-1 `spc-statistics.ts:131` `Math.floor` caught RED by the standing
> battery (`lint-RED.log`, 7/8, the ADR-0009 rule naming the file/line);
> the repair is the house bitwise integer-floor pattern with the dated
> comment (a pure subgroup COUNT, never a rounded measurement; the
> operands bounded by the DESC-cap law), GREEN re-run 8/8, the affected
> folders re-run at the final head (the quality family 9·139 · the api
> unit 75·944)** · depcruise clean **2,147 modules · 16,074
> dependencies** (+12/+82 dated) · unit 8/8 — **155 · 1,955** (api
> **75·944** · web 21·171 · mobile 27·393 · desktop 16·274 · ui 3·43 ·
> contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the ledger
> arithmetic **1,955 = 944+171+840 EXACT**, the F-2 third term standing)
> · i18n 6,955 = 6,955 (no delta, as declared — an API-DB wave) + mobile
> 371 = 371 · tokens 50/50 · drift **347 = 347** (zero delta — no new
> keys) · manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors +
> self-test all-probes-OK (probe 7 stands at G-62/PHASE-050 — the 050
> flip is W-32's) · history-secrets 0 violations · 6,654 allowlisted hits
> (the W-26 6,624 +30 — the window's shift: the W-27 session commits
> entering the last-200 sample; the FOUR tag anchors untouched) ·
> ROUTE_PERMISSIONS **1,134** (the tsx recount) · the registry 315
> tenant-owned tables · capabilities agree · shells PASS/PASS · boundary
> PASS.]**

> **[Dated 2026-11-23 (PHASE-050 W-26 — T-07 + T-08 delivered, the CAPA +
> calibration wave under the owner's standing order — «عند الانتهاء من أي
> خطوة ادفعها إلى المستودع», every step pushed at its own commit; the
> evidence `audit-evidence/phase050-w26/`, the THIRTY-SEVENTH consecutive
> same-session wave): #2's CAPA arms DELIVERED — `quality-capa.db.spec` 17
> arms over real PG16 (BR-103's effectiveness gate as the typed refusals
> carrying the open action/due-date figures — the undated open action the
> fail-closed BLOCK, the future-dated one the BLOCK with
> openActionCount/pendingCount/pendingDueDates, the elapsed-window
> boundary an open action due TODAY closes · **G-63's exactly-once** —
> DR 5320 QUALITY_EXPENSE · CR 2137 EXTERNAL_ACCRUAL through the REAL
> engine, the single-use source key `(capa_record, id, external_cost)`
> + the single-use cost stamp (journal_entry_id IS NULL + external_cost
> = 0 pinned), the replay the typed CAPA_COST_ALREADY_RECORDED with one
> journal standing · **the unmapped-purpose fail-closed** —
> QUALITY_EXPENSE superseded → the engine's own PURPOSE_NOT_MAPPED with
> the ZERO residue (the record keeps its pre-act state, zero journals,
> the cost still 0) + the flip-and-restore re-run GREEN · the root-cause
> start act (OPEN → IN_PROGRESS in the same CAS, the IN_PROGRESS
> re-record refreshing the stamp — the declared interpretation) · the
> actions array's shape law refused cell-by-cell · the zero-cost CAPA
> closing with NO entry · the future-dated CHECK refused (the
> fabrication guard) · the honest negative check closing with the
> record preserved · the CLOSED register refusing every move BY NAME) —
> the G-62/G-63 golden TRANSCRIPTS with the failure packs remain W-31's.
> #8's sweep arms DELIVERED — `quality-calibration-sweep.db.spec` 4 arms
> (**THE FIFTH STANDING ISOLATE** — soak · fcm · email · the cmms sweep
> · the quality calibration sweep, §0c (2)'s own law that the sweep
> joins the isolate set the wave it ships): the default ladder firing
> each band once with the S-15 severities and the dedupe keys asserted
> EXACT · the structural DEDUPE (the re-run converges — flagged again,
> notified 0, no accumulation, every pass seals) · **THE PER-CYCLE
> RE-ALERT** (D-08's «per instrument+window+day» axes — the DAY is the
> DUE DATE the alert names: a re-calibrated instrument stops, the next
> near-dated cycle alerts AGAIN through its new due-date key; within a
> cycle re-runs/the cron/races converge) · the settings surface (the
> first 050 settings keys — the typed write dedup+descending · the
> custom ladder governs · the registry refusal re-surfaced as
> CALIBRATION_SWEEP_THRESHOLDS_INVALID · the garbage row fails-closed
> to [30,7,0])) + `quality-calibration.db.spec` 10 arms (D-08's
> instrument-AS-asset binding through the fixed-assets module's OWN
> findAssetCard with the typed not-found · the official
> CAL-{YYYY}-{SEQ:6} numbering · the due-after floor's typed pre-check
> naming BOTH dates · G-63 AT THE CREATE ACT with the PRE-GENERATED
> record id naming the INV-013 source key before the row exists (ONE
> ambient transaction — the unmapped EXTERNAL_ACCRUAL leaves NO row and
> NO journal, the in-house create UNAFFECTED throughout — a tenant
> without the mapping keeps calibrating, the honest shape) · the
> zero-cost/absent-cost in-house NO-entry shape · the newest-first
> per-asset history). THE UNIT FOLDS (the plan §4's own arm): the CAPA
> lifecycle matrix fold (16 property tests — the total status × move
> grid, the actions shape law, BR-103's gate arms) + the calibration
> sweep-math fold (11 property tests — the window coercion class, the
> disjoint-band totality, D-08's dedupe-key axes, the severity ladder).
> **THE HONEST CATCHES (two, both RED-proven with the four-quarter
> logs, no battery red standing): (1) the cmms-schema spec's union arms
> — 0117 (the W-25 stock-moves source widening) had defined
> ck_stock_moves_source_shape at a NEW site with the new `ncr_record`
> member and the W-25 scope-label run left the arm's EXPLICIT
> bookkeeping stale (the lineage 10 → 11 sites; the members 23 → 24);
> the arm's own design fired RED naming the drift
> (`db-cmms-schema-union-RED.log`, VITEST_EXIT=1, 2 failed), repaired
> with the dated notes at every modified site, GREEN re-run
> (`db-cmms-schema-union-GREEN.log`, 32/32); the notifications arm's
> enumeration grew 17 → 18 with `quality` in the same repair —
> MIGRATION 0118_quality_notifications_category.sql ('quality' joins
> BOTH notifications CHECK domains, the shared-scope union law's
> 18-member union, ordered WITH the sweep's inbox writer in the same
> increment; the journal 117 → 118, the manifest/journal/spec pins
> moved together, no tables — the count stays 340; both scratch runs
> CHAIN_118_APPLIED → check:rls OK — 340). (2) the sweep probe's own
> shape — the per-cycle arm went RED on the first run
> (`db-sweep-probe-RED.log`, VITEST_EXIT=1 — expected 4 flagged, the
> band filter sat INSIDE the per-instrument DISTINCT ON collapse so a
> re-calibrated instrument (+300 due) still flagged on its superseded
> +15 row); THE REPAIR: the LATEST-FIRST LAW in scanCalibrationDue (the
> collapse runs BEFORE the band filter — the instrument's CURRENT
> obligation is its newest due date), the dated comment at the claim
> site; GREEN 114/114.** ROUTE_PERMISSIONS 1,113 + 12 = 1,125 — the
> keys-seed-first SECOND binding wave (the CAPA seven + the calibration
> five incl. the sweep-config pair, dated at the block, the 1,102
> baseline anchor); the error filter's domainStatus rows in the same
> increment (the not-founds 404 · the lifecycle/single-use conflicts
> 409 · BR-103's policy refusals 422). The battery: THE FIVE ISOLATES
> STANDALONE FIRST (soak 1·1 229.11s · fcm 1·8 · email 1·5 · the cmms
> sweep 1·4 · **the quality calibration sweep 1·4 — the new fifth**,
> every VITEST_EXIT=0) · the affected folders re-run at the delta head
> (the quality family 6 · 114 — the schema 59 + the NCR 13 + the specs
> 11 + the CAPA 17 + the calibration 10 + the sweep 4 · migrations +
> identity-flows 2 · 28 over the 1,125 routes · the cmms schema 1 · 32
> — the repaired union arms) · the coverage roster's declared movement
> (chunk-a 100 → 102 · **isolate-quality-sweep the new part** · the
> roster 286 → 289, VERDICT: COVERED; the full ten-part envelope re-runs
> at W-32) · typecheck 8/8 (0 cached — the force re-run) · lint 8/8 (0
> cached) · depcruise 2,135 · 15,992 (+11/+86) · unit 152 · 1,921 (the
> ledger arithmetic **1,921 = 910+171+840 EXACT** — the api 70·883 →
> 72·910) · i18n 6,955 = 6,955 + mobile 371 (no delta — an API-DB
> wave) · drift 347 = 347 (zero delta — no new keys) · manifests 13/13
> · docs:validate 33/33 · id-ledger 0 errors + self-test all-probes-OK
> (probe 7 stands at G-62/PHASE-050) · history-secrets 0 violations ·
> 6,624 allowlisted (the window's shift; the FOUR tag anchors untouched)
> · capabilities agree · shells PASS/PASS · boundary PASS.]**

> **[Dated 2026-11-23 (PHASE-050 W-25 — T-05 + T-06 delivered, the
> specifications + NCR engines wave under the owner's standing order; the
> evidence `audit-evidence/phase050-w25/`, the THIRTY-SIXTH consecutive
> same-session wave): #2's NCR arms DELIVERED — `quality-ncr.db.spec` 13
> arms over real PG16 (BR-102's closure gate as the typed refusal NAMING
> the record · **G-62's exactly-once** — the single-use source key
> `(ncr_record, disposition)` + the single-use disposition stamp, the
> replay refused typed with one journal + one move standing · **the
> unmapped-purpose fail-closed** — INVENTORY_SHRINKAGE superseded → the
> engine's own PURPOSE_NOT_MAPPED with the ZERO residue (the record stays
> OPEN, zero journals, zero moves) + the flip-and-restore re-run GREEN ·
> the affected-quantity floor at create AND at the act (the live stock
> read, the refusal naming BOTH figures, zero residue) · the write-off's
> REAL-WMS moves (planIssue/applyIssue, sourced `ncr_record`, the
> per-warehouse coverage + the 1140/1141 per-account credit split) · the
> honest no-GL shapes (REWORK/ACCEPT/RETURN_TO_SUPPLIER · the batch-less
> SCRAP's no-journal declared interpretation) · the golden-class arm
> 5 × 2.500000 = 12.5000 — DR 5110 · CR 1140) — the CAPA arms (BR-103 +
> G-63) are W-26's. #6's specification-feed arms DELIVERED —
> `quality-specs.db.spec` 11 arms (the authoring surface with the
> no-fabrication band law's typed refusals naming the parameter and BOTH
> figures · the natural-key duplicate refusal · the PATCH's explicit-null
> CLEAR · the SPC-FK protection BY NAME · **the inspection-result
> mapping contract**: the inspections row VERBATIM through the owning
> store, the item through the engine's own chain (the FG batch · the
> production order · the GRN-only declared honest NONE shape), the
> active register alongside — zero parallel computation) — the
> supplier-score arms are W-27's. THE UNIT FOLDS (the plan §4's own
> arm): the NCR lifecycle matrix fold (12 property tests — the full
> status × move walk) + the tolerance fold (14 property tests — the
> no-fabrication law, the closed interval, the 6-dp exactness). **THE
> HONEST CATCH (the 0109/0110 precedent, the G-48 class): the
> stock-moves source domain refused the write-off's `ncr_record` BY
> NAME at the first DB run — the additive migration 0117 re-adds the
> constraint with the standing twenty-four members + EXACTLY the one
> new source (the journal 116 → 117, the manifest/journal/catalog pins
> moved together, no tables — the count stays 340; both scratch runs
> CHAIN_117_APPLIED → check:rls OK). ROUTE_PERMISSIONS 1,102 + 11 =
> 1,113 — the keys-seed-first FIRST binding wave (the eleven W-25
> routes on quality.view/manage/ncr.manage, dated at the block); the
> error filter's domainStatus rows landed in the same increment (the
> T-03 lesson). The battery: the four isolates standalone FIRST · the
> affected folders re-run at the delta head (the quality family 3 · 83
> — the schema 59 + the NCR 13 + the specs 11 · migrations +
> identity-flows 2 · 28) · the coverage roster's declared movement
> (chunk-a 98 → 100 · the roster 284 → 286) · typecheck 8/8 · lint 8/8
> · depcruise 2,124 · 15,906 (+12/+77) · unit 150 · 1,894 (the ledger
> arithmetic 1,894 = 883+171+840 EXACT) · i18n 6,955 = 6,955 + mobile
> 371 · drift 347 = 347 · manifests 13/13 · docs:validate 33/33 ·
> id-ledger 0 errors + self-test all-probes-OK · history-secrets 0
> violations · 6,579 (the slices 67+67+66 + the finalize, coverage
> EXACT 200/200; the FOUR tag anchors untouched) · capabilities ·
> shells PASS/PASS · boundary PASS.]**

> **[Dated 2026-11-22 (PHASE-050 W-24 — T-01…T-04 delivered, the foundation
> wave under the owner's launch authorization; the evidence
> `audit-evidence/phase050-w24/`, the THIRTY-FIFTH consecutive same-session
> wave): #1 OPENED — the migrations 0113–0116 applied from zero (the chain
> 112 → 116, both scratch runs CHAIN_116_APPLIED → [check-rls] OK — 340) ·
> the Drizzle mirrors +12 (parity with the migrations' shapes) · the twelve
> tables have ENTITY_CATALOG rows (328 → 340) + the tables.registry entries
> (303 → 315, the A-suite +72 → 1,896 green) · the chain spec extended to
> 116 (the manifest/journal/pins moved together) · the quality schema spec
> 59 arms GREEN (every structural law refused BY NAME, every rejection arm
> on its own world). #9's keys + flags arms DELIVERED — the +10 keys
> 337 → 347 = 347 (zero-drift at the wave head, seed = mirror, both drift
> lists + the identity-flows pin) · the two feature flags `quality` ·
> `quality.spc` on business + enterprise with STARTER AT THE DECLARED
> NEUTRAL ZERO (verified live from the from-zero boot) + the four
> quality-carrying templates' manifest enablements + the manifest schema's
> dated whole-module-key amendment + FEATURE_CATALOG §30. #1's "tables doc"
> arm: the twelve ENTITY_CATALOG rows carry the column-level truth (the
> full TABLES/ doc is W-32's canon wave with T-19). THE HONEST CATCHES
> (three, all RED-proven then repaired — the wave's README carries them
> whole): the entitlements substrate refused the whole-module key (the
> provisioning path 23514'd — 0116 §7's additive one-key widening); the
> tenancy CoA pins (79 → 80 · 56 → 57 — the one 5320 marker); the
> tenancy-http journey pin (the same marker, caught by the envelope's
> first chunk-c run — the RED log kept). ROUTE_PERMISSIONS 1,102 unchanged
> (keys-seed-first).]**

1. **Migrations 0113–0116 (the honest slots — the phase doc's 0087…0090 stale
   by its own note, the 048/049 D-02 precedent) apply cleanly from zero
   (re-apply no-op); Drizzle mirror parity; the TWELVE new tables
   (`quality_specifications` · `spc_measurements` · `ncr_records` ·
   `capa_records` · `complaints` · `calibration_records` ·
   `supplier_quality_scores` · `coa_documents` · `batch_quality_holds` ·
   `recall_registry` · `quality_management_reviews` · `hazard_registers`)
   have ENTITY_CATALOG rows (328 → 340) + the tables doc.** — *Arms:* the
   chain spec extended to 116 · the from-zero boot in every run · the
   A-suite's arms over the twelve tables. *Waves:* W-24 (opens) · W-32 (the
   final sweep closes).
2. **The NCR → CAPA lifecycle runs end-to-end: NCR closure requires a
   disposition (BR-102 — the typed refusal naming the record); CAPA closure
   requires the effectiveness check recorded after the action due date
   (BR-103 — the refusal carrying the open figures); the golden tests G-62
   (the scrap write-off) and G-63 (the external quality cost) post balanced
   entries through the REAL posting engine with the MANDATORY failure packs
   (the refusals WITH their full payloads · the zero residue · the
   flip-and-restore with the green re-runs).** — *Arms:* `quality-ncr.db.spec`
   (BR-102 + G-62's exactly-once + the unmapped-purpose fail-closed) ·
   `quality-capa.db.spec` (BR-103 + G-63) · `quality-goldens.db.spec` (the
   transcripts with the failure packs — the JOURNAL_RULES §7 law). *Waves:*
   W-25/W-26 (the engine arms) · W-31 (the transcripts close).
3. **INV-035 holds: any issue/ship document line referencing a batch with an
   active quality hold is rejected SERVER-SIDE on every baseline path (sales
   delivery, inventory issue, and any 044 picking path when delivered);
   release requires a disposition-linked record (BR-101).** — *Arms:*
   `quality-holds.db.spec` (the blocking matrix over every baseline path +
   the release rule) · the INV-035 invariant test extending the
   document-validation suite EVERY path must extend · the W-31 golden (the
   held batch refused everywhere + the offline-rejection shape). *Waves:*
   W-28 (opens) · W-31 (the golden closes).
4. **COA generation produces a certificate from inspection results against
   the item's specification, blocked unless every parameter is within
   tolerance or carries an accepted-deviation NCR reference (BR-104 — the
   refusal naming the parameter and both figures); the print renders
   bilingual AR/EN with RTL correctness, deterministic byte-identical (the
   W-13/W-21 print laws — `bi()` exclusively, the REAL Chromium test both
   directions).** — *Arms:* `quality-coa.db.spec` (BR-104's three shapes +
   the frozen snapshot) · the web COA print spec. *Waves:* W-27 (the
   service) · W-29 (the print law) · W-31 (the proof).
5. **SPC charts compute correctly on known datasets (X-bar/R, Cp/Cpk) with
   out-of-control points flagged; property tests cover the math (the pure
   module FIRST, the formulas pinned in the phase report).** — *Arms:* the
   SPC pure module's unit property tests on pinned reference datasets ·
   `quality-spc.db.spec` (the service vs the pure module's outputs). *Waves:*
   W-27 (opens and closes).
6. **Supplier quality scores compute from NCR/rejection/delivery data and
   expose the documented feed contract consumed by the 038 scorecards (the
   consumer reads, never re-computes); the specifications' inspection-result
   mapping contract feeds from the existing inspections module.** — *Arms:*
   `quality-supplier-scores.db.spec` (the rolling fold + the feed contract) ·
   `quality-specs.db.spec` (the mapping contract). *Waves:* W-25 (the specs
   contract) · W-27 (the scores close).
7. **The recall drill resolves a batch to its where-used chain and the
   customers who received it within the OA-06 budget (indexed where-used
   query over the existing batch/serial ledger, EXPLAIN-verified — never a
   forced plan, never an isolated probe context).** — *Arms:*
   `quality-recall.db.spec` (the drill + the budget) ·
   `quality-explain-budgets.db.spec`. *Waves:* W-28 (the drill) · W-31 (the
   OA-06 arm closes).
8. **The `quality-calibration-due` sweep fires 30/7/0-day alerts bound to
   instrument ASSETS (the 049 handoff: the card + the service-history
   timeline + the expiry-sweep pattern extended); the food-manufacturing
   template composes `quality` + hazard registers in its manifest
   (template-composable, never hardcoded — Q-10/Q-11).** — *Arms:*
   `quality-calibration.db.spec` (the binding + the sweep isolate — it joins
   the standing isolate set at W-26) · the manifest reconciliation + the
   template doc. *Waves:* W-26 (the sweep) · W-30 (the review pack + the
   registers close).
9. **CR-36 gates: +10 permission keys with zero-drift equality (337 → 347 =
   347) · i18n parity BY BOTH COUNTS from the first surface wave (W-29:
   6,955+n = 6,955+n + mobile 371 = 371) · RLS attack tests A1–A10 on all
   twelve tables (the composite-FK law) · feature-flag/template gating
   verified (`quality` · `quality.spc`) · `docs:validate` green · manifest
   reconciliation.** — *Arms:* the drift checker at every wave ·
   `quality-rls.db.spec` (A1–A10 × 12, the hostile probe worlds) · the
   flag-gating specs. *Waves:* W-24 (the keys + the flags) · W-29 (the i18n)
   · W-31 (the RLS closes).
10. **The completion report `reports/PHASE-050-COMPLETION.md` with the
    cumulative ledger #1–#10 walked and closed (every wave's evidence
    pointers) + the IMPLEMENTATION_STATUS flip + **the archive
    `ERP_PLATFORM_PHASE050.zip` EXACTLY AS DECLARED (F-4: the git-tracked
    tree at the closure head, the commit-hash first entry, ADDITIVE-ONLY,
    EXCLUDING every standing platform zip — أرشفة الأرشيف ممنوعة)** + the
    tag `phase/050` (DELIVERY, never acceptance).** — *Waves:* W-32 (closes
    the ledger and the phase; the open-items log transferred explicitly; the
    ID_LEDGER flip — implemented G 63 · INV 35 · BR 104 — atomic with the
    canon rows).

### PHASE-051 — Foreign Trade & Logistics (OPENED AT PLAN 2026-11-24 — the owner's review-framework law: the ledger opens with the plan and closes with the closure; every criterion carries its ARMS and its WAVES; the master plan `agent-ctx/PHASE-051-MASTER-PLAN.md` §3/§4 is the binding division; the launch dispatch's §5 declared base — the COA print patterns → the trade certificates · the planIssue unified gate → the bonded restrictions · the documented-contract precedents — carried into every wave; the reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة خارجها)

1. **Migrations 0119–0122 (the honest slots — the phase doc's 0091…0094 stale
   by its own note, the 048/049/050 D-02 precedent) apply cleanly from zero
   (re-apply no-op); Drizzle mirror parity; the FOURTEEN new tables
   (`letters_of_credit` · `lc_amendments` · `lc_documents` ·
   `documentary_collections` · `incoterms` · `bills_of_lading` ·
   `packing_lists` · `certificates_of_origin` · `customs_declarations` ·
   `customs_declaration_lines` · `hs_code_registry` ·
   `bonded_warehouse_moves` · `duty_drawback_claims` ·
   `shipment_tracking_events`) have ENTITY_CATALOG rows (340 → 354) + the
   tables doc; the Incoterms and HS seeds load and are tenant-extensible.** —
   *Arms:* the chain spec extended to 122 · the from-zero boot in every run ·
   the A-suite's arms over the fourteen tables · the seeds' disclaimer
   (D-16). *Waves:* W-33 (opens) · W-42 (the final sweep closes).
2. **The LC lifecycle runs end-to-end — issue, amend, track the documents
   checklist with discrepancies, retire — with G-64 posting balanced
   margin/retirement entries and LC fees posting to financial charges;
   expiry alerts fire at 30/14/7/1 days (BR-105).** — *Arms:*
   `trade-lc.db.spec` (the ladder · the amendments' typed windows · the
   checklist states + the discrepancy notes · G-64's exactly-once + the
   unmapped-purpose refusal + zero residue) · `trade-lc-sweep.db.spec`
   (**the SIXTH standing isolate** — the ladder, the dedupe axes, the
   settings surface, the DB's-own-clock law) · the pure folds FIRST
   (property tests). *Waves:* W-34 (opens) · W-41 (the golden closes).
3. **Customs declarations compute duties and import VAT per line and flow
   into the existing landed-cost allocation (G-65); INV-036 holds — no
   landed-cost allocation on an import receipt without a completed
   declaration reference, and every allocated duty ties to a declaration
   line.** — *Arms:* `trade-customs.db.spec` (the line math on Decimal
   (ADR-0009) · the allocation through the REAL LandedCostsService VERBATIM
   — zero parallel computation · the INV-036 typed refusals (D-07's honest
   interpretation: the customs-duty allocation on an import receipt
   requires the COMPLETED declaration; ordinary non-duty landed costs
   untouched) + the zero residue + the line-level tie) · the duty/VAT pure
   fold. *Waves:* W-37 (opens) · W-41 (the golden closes).
4. **Bonded moves post no duty on movement (G-66); release into free
   circulation recognizes duty exactly once (BR-107); duty-suspended stock
   is visibly flagged and blocked from customer issue while suspended.** —
   *Arms:* `trade-bonded.db.spec` (the in-bond transfer with NO duty entry
   through the REAL movement core · **THE SHARED GATE'S BLOCKING MATRIX over
   every baseline issue path — the 050 hold-gate's own evidence shape: the
   raw `planIssue` · the manualIssue · the sales-delivery post · the
   transfer dispatch, the typed `BONDED_STOCK_SUSPENDED` naming the stock +
   the bond, zero residue** · the release's duty recognition (the
   G-65-shaped pair at the released quantity) + the single-use stamp + the
   typed replay refusal + the flip-and-restore) · the suspended banner spec
   (W-39) · **the block is G-66's own structural face — NO new invariant
   identifier (the reservations law; the launch dispatch's declared base:
   the planIssue unified gate as the precedent)**. *Waves:* W-38 (opens) ·
   W-41 (the golden closes).
5. **Duty drawback claims cannot submit without linked export evidence
   (BR-108); the claim workflow records claimed amounts and status
   transitions.** — *Arms:* `trade-drawback.db.spec` (the export-evidence
   gate's typed refusal naming the claim + the missing evidence · the
   ladder · **the honest no-GL shape — the non-ledger-document law: the
   claim is a registry record; the refund lands when treasury records
   it**). *Waves:* W-38 (opens).
6. **Incoterm selection is mandatory on trade-flagged purchase/sales orders
   and renders the carriage/insurance/duty risk-hint matrix (BR-106); the
   registry page lists the seeded set and accepts tenant additions.** —
   *Arms:* `trade-incoterms.db.spec` (the registry + the mandate's typed
   refusal at the order's own posting — **D-10's proposed trigger: with the
   `trade` flag enabled, an order whose currency ≠ the base OR carrying the
   import/export marker** + the ownership matrix as registry data) · the web
   selector spec on the PO/SO forms + the reference page spec (W-39).
   *Waves:* W-35 (the engine) · W-39 (the surface).
7. **Shipment tracking events drive document status transitions (booked →
   departed → arrived → cleared → delivered) on the linked bills of lading,
   packing lists and declarations; the tracking board renders AR/EN parity
   with RTL and loading/empty states.** — *Arms:* the tracking PURE fold
   (D-14 — the total status × event matrix, the monotone ladder, the typed
   refusals — property tests FIRST) · `trade-tracking.db.spec` (the fold's
   output rendered VERBATIM) · the web board spec (W-39). *Waves:* W-36 (the
   engine) · W-39 (the board).
8. **Certificates of origin print in bilingual chamber format; the PO →
   LC/collection → transport documents → declaration → receipt →
   landed-cost chain is navigable end-to-end.** — *Arms:* the certificate
   print spec (D-13 — the 050 print laws carried verbatim: `bi()`
   EXCLUSIVELY · the frozen snapshots VERBATIM · the REAL Chromium test both
   directions, deterministic byte-identical with the renderer's own clock
   stamps normalized) · the chain-navigation spec (the linked reads through
   each module's OWN rows — D-15's documented contracts). *Waves:* W-39 (the
   print) · the chain arms W-34…W-37 as each link lands.
9. **CR-36 gates: +10 permission keys with zero-drift equality (347 → 357 =
   357) · i18n parity BY BOTH COUNTS from the first surface wave (W-39:
   7,253+n = 7,253+n + mobile 371 = 371 standing) · RLS attack tests A1–A10
   on all fourteen tables (the composite-FK law) · feature-flag/template
   gating verified (`trade` · `trade.lc` · `trade.customs` — wholesale ·
   distribution-field-sales · electronics compose by default) ·
   `docs:validate` green · OA-06 budgets (indexes + EXPLAIN on declaration
   lines and tracking events).** — *Arms:* the drift checker at every wave ·
   `trade-rls.db.spec` (A1–A10 × 14, the hostile probe worlds — the
   cmms/quality precedent's exact set) · `trade-explain-budgets.db.spec`
   (OA-06 — never a forced plan, never an isolated probe context) · the
   flag-gating specs. *Waves:* W-33 (the keys + the flags) · W-39 (the
   i18n) · W-41 (the RLS closes).
10. **The completion report `reports/PHASE-051-COMPLETION.md` with the
    cumulative ledger #1–#10 walked and closed (every wave's evidence
    pointers) + the IMPLEMENTATION_STATUS flip + **the archive
    `ERP_PLATFORM_PHASE051.zip` EXACTLY AS DECLARED (§5 of the master plan:
    the git-tracked tree at the closure head, FLAT — the physical shape of
    049/050, the commit-hash as the FIRST entry, ADDITIVE-ONLY, EXCLUDING
    every standing platform zip — أرشفة الأرشيف ممنوعة; the SEVENTEEN
    standing zips 034_FINAL…050 verified untouched)** + the tag `phase/051`
    (DELIVERY, never acceptance) + the Stage-13 release gate checked per
    CR-38 and recorded before Wave 3 starts.** — *Waves:* W-42 (closes the
    ledger and the phase; the open-items log transferred explicitly; the
    ID_LEDGER flip — implemented G 66 · INV 36 · BR 108 — atomic with the
    canon rows).
**[Dated 2026-11-24 (PHASE-051 W-33 DELIVERED at the foundation head
`ff2b0df` + the spec head `ab1fd30` — THE ACCUMULATION PLACE per the
ratified عرف 049 option (a); the owner's launch dispatch honored — the
plan APPROVED as the binding phase program 2026-11-24, W-33 released;
the standing order «عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored
— F-051a `b67afc7` → the foundation `ff2b0df` → the schema spec
`ab1fd30`, every step pushed at its own commit): CRITERION #1'S
FOUNDATION ARMS GREEN.** The migrations 0119–0122 apply cleanly from
zero — the 122-chain scratch from zero TWICE (both runs
CHAIN_122_APPLIED → [check-rls] OK — **354 catalog tables** →
SCRATCH_STOPPED, EXIT=0, both logs kept) + the re-apply no-op proven in
every DB run's migration state. Drizzle mirror parity: schema.ts +14
tables (348 pgTable exports). The FOURTEEN tables have their
ENTITY_CATALOG rows (340 → 354, the section with the header chain) +
the tables doc + the A-suite's +84 arms (the identity-isolation suite
1,980/1,980 GREEN — the fe family's fixture rows, OWN_ROW entries and
the FK-consistent mismatched-tenant attacks). THE SEEDS LOAD AND ARE
TENANT-EXTENSIBLE: the Incoterms-2020 set (11 rules) + the HS starter
set (14 chapter-level headings) seed through the 0098 §4
migration-plane gate with THE ACCURACY DISCLAIMER ON EVERY STARTER ROW
(«البذور بإقرار الدقة» — the owner's own order; the tenant owns the
final classification; NO duty rates on the seeds) + the trade-schema
spec's registry arms (the incoterm insert + the duplicate refusal; the
HS row + its own duplicate refusal — tenant-extensible BY
CONSTRUCTION). The structural-laws spec itself: `trade-schema.db.spec`
— 41 arms over real PG16, every law refused BY NAME, every rejection
arm on its own world. THE FULL TEN-PART ENVELOPE AT THE NEW COUNT:
**301 files · 4,369 tests · 0 failed · 0 skipped** (the five isolates
standalone FIRST per the owner's عزل مسبق order — soak 1·1 · fcm 1·8 ·
email 1·5 · the cmms sweep 1·4 · the quality calibration sweep 1·4; the
load parts: smoke 3·1,999 · perf-rest 5·23 · chunk-a 114·989 · b-rest
86·625 · c 88·711; the arithmetic 301 = 1+1+1+1+1+3+5+114+86+88 EXACT ·
4,369 = 1+8+5+4+4+1,999+23+989+625+711 EXACT; the provenance 4,369 =
4,244 + 84 (the A-suite) + 41 (the trade schema spec); every part
inside the 570s ceiling; the coverage verified BEFORE the first load
run — 301 = 301, missing NONE, extra NONE, duplicates NONE, VERDICT:
COVERED). THE HONEST CATCHES (two, both first-RED-proven then
repaired, both logs kept verbatim — the regression-protocol law's
exercise; no battery red stands anywhere): (1) THE TENANCY-HTTP JOURNEY
PIN — the same two-marker delta in the HTTP journey's own mirror
(80 → 82 accounts · 57 → 59 purposes), re-pinned with the dated note
(the W-24 catch #3's exact class); (2) THE TRADE FIXTURE'S TENANT-ID
COLLISION — the first chunk-a run RED-named it (the 6b6b6b6b fixture
tenant collided with crm/time.spec's TENANT_T, the fiscal-year overlap
refusing the journey), the repair moving the family to the free 7c
plane, both heads re-proven (the two-head protocol: the RED log kept
as db-chunk-a-first-red.log, the green re-run 114·989). The standing
battery at the wave head: typecheck 8/8 (0 cached) · lint 8/8 (0
cached) · depcruise clean 2,197 modules · 16,419 dependencies (+2/+8
dated) · unit 8/8 — 167 files · 2,020 tests UNCHANGED (the ledger
arithmetic 2,020 = 976+204+840 EXACT, an API-DB wave) · permissions
drift **347 → 357 = 357** (D-03 — zero-drift from the first increment,
seed = mirror) · i18n 7,253 standing (no delta — an API-DB wave) +
mobile 371 · tokens 50/50 · manifests 13/13 · docs:validate 33/33 ·
id-ledger 0 errors (implemented G 63 · INV 35 · BR 104 standing — the
051 flip is W-42's) + the self-test all-probes-OK (probe 7 stands at
G-64/PHASE-051) · history-secrets 0 violations · 6,920 allowlisted hits
(the window's shift: this session's commits entering the last-200
sample; the FIVE tag anchors walked, untouched — phase/046 `4ddb39f` ·
phase/047 `5b73bd1` · phase/048 `ba459ff` · phase/049 `41c3701` ·
phase/050 `01f61a7`) · ROUTE_PERMISSIONS 1,159 UNCHANGED (zero
route-bearing files moved this wave — keys-seed-first, the 0116 §1
precedent; the /api/v1/trade/* families bind as the W-34+ service
waves ship) · the registry 329 tenant-owned tables · capabilities
agree · shells PASS/PASS · boundary PASS. **RISK-033: EIGHT incidents,
ZERO new this wave — the row stays OPEN, closing only by the owner's
order.** The reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا
كتابة خارجها. NEXT: W-34 (the LC engine + G-64's postings + the
BR-105 expiry sweep — the SIXTH standing isolate) under the owner's
standing order. NOT production approval — تسليم لا قبول.]**

**[Dated 2026-11-25 (PHASE-051 W-34 DELIVERED at the engine head
`7291513` + the spec head `3f98aa7` — the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored, every step
pushed at its own commit): CRITERION #2'S LC ARMS GREEN + THE SWEEP
ISOLATE GREEN STANDALONE.** THE LIFECYCLE RUNS END-TO-END — issue,
amend, track the documents checklist with discrepancies, retire: the
GOLDEN-CLASS ARM of `trade-lc.db.spec` walks the whole journey over
real PG16 with every G-64 posting proven AT THE JOURNAL-LINE LEVEL
(the deposit DR LC_MARGIN_DEPOSIT (1180) · CR the tenant's chosen
bank at the contract rate (the FX ride, INV-008 capture) with the
INV-019-exact treasury movement; the amendment's margin adjustment
through the SAME pair on (lc_amendment, id); the retirement reversal
of the CURRENT margin with the settled pair + the journal stamps
landing TOGETHER in the CAS stamp — the 0119 retirement-shape floor
satisfied by the same statement) + THE LEDGER ARITHMETIC (the margin
asset's net over the lifecycle EXACTLY ZERO; the movement bases tie
the line bases by construction) + G-64's exactly-once (the ladder's
typed refusals naming the record; the duplicate delivery returns the
STORED result — idempotentReplay, INV-013's own surface; the entry
count stays ONE) + the unmapped-purpose fail-closed with ZERO residue
+ the flip-and-restore re-run GREEN + the amendment windows (the
typed-change law + the freshness law + the validity floor + the
decrease's REVERSED pair with the IN movement) + the checklist
monotone law (the 0119 floors' fold VERBATIM — the unpresented
verification refused, the regressing stamps refused) + the margin
exit law (the margined cancellation refused — the deposit's exit is
the retirement pair; the margin-free retirement refused — the
declared shapes at the claim sites) + the terminal register + the
bank-account floor (the wrong-currency and unknown accounts refused
with the typed name). THE LC FEES POST TO FINANCIAL CHARGES: the
bank-charge pattern (DR the purpose-mapped BANK_CHARGES · CR the
bank) on the `fee_{seq}` single-use keys — the INV-028 `op_<seq>`
precedent (two fees, two keys, two treasury movements, proven) + the
cash-moves source widening (the honest catch disclosed below). THE
EXPIRY ALERTS FIRE AT 30/14/7/1 DAYS (BR-105) + THE SIXTH STANDING
ISOLATE GREEN STANDALONE: `trade-lc-sweep.db.spec` — the default
ladder fires each band once with the S-15 severities; the discrepancy
family rides the same bands (`trade:lc:{lcId}:disc:{threshold}:
{expiryDate}`); the dedupe is STRUCTURAL (the re-run converges —
flagged counts again, ZERO new notifications, every pass seals); the
per-cycle re-alert (the validity amendment moves the expiry — the new
date forms NEW keys); the settings surface (the typed write · the
custom ladder governs · the garbage row fails-closed to [30,14,7,1] ·
the zod refusal under LC_SWEEP_THRESHOLDS_INVALID); the prefs gate
(in-app off skips the records, the flags still count, the run still
seals; the prefs removed → a NEW instrument records again); the seal
`trade.lc_expiry_sweep_run` carries {windows, flagged, notified,
expired}; THE EXPIRY TRANSITION (the declared interpretation's own
arm): the ISSUED instrument past its date CAS-stamps EXPIRED from the
DB'S OWN CURRENT_DATE (the clock law — no Date.now()+delta anywhere
in the sweep's path), audited `trade.lc_expired`, idempotent (the
re-run finds no ISSUED row), a DRAFT row past its date never touched.
THE ENVELOPE AT THE NEW COUNT: **303 files · 4,385 tests · 0 failed ·
0 skipped** (the SIX isolates standalone FIRST — soak 1·1 · fcm 1·8 ·
email 1·5 · the cmms sweep 1·4 · the quality calibration sweep 1·4 ·
THE TRADE SWEEP 1·6 — the sixth, joining the standing set this wave;
the load parts: smoke 3·1,999 20.2s · perf-rest 5·23 95.0s · chunk-a
115·999 146.6s · b-rest 86·625 63.8s · c 88·711 75.1s; the arithmetic
303 = 1+1+1+1+1+1+3+5+115+86+88 EXACT · 4,385 = 28 + 4,357 EXACT; the
provenance 4,385 = 4,369 (the W-33 envelope) + 16 (the two trade
specs: trade-lc 10 + the trade sweep 6); every part inside the 570s
ceiling; the coverage verified BEFORE the first load run — 303 = 303,
missing NONE, extra NONE, duplicates NONE, VERDICT: COVERED). THE
123-CHAIN SCRATCH FROM ZERO TWICE: both runs CHAIN_123_APPLIED →
[check-rls] OK — 354 catalog tables → SCRATCH_STOPPED, EXIT=0, both
logs kept. THE STANDING BATTERY at the final code state: typecheck
8/8 (0 cached) · lint 8/8 (0 cached) · depcruise clean 2,210 modules ·
16,500 dependencies (+13/+81 dated) · unit 8/8 — 169 files · 2,051
tests (api 80·1,007 · web 30·204 · mobile 27·393 · desktop 16·274 ·
ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36; the
ledger arithmetic 2,051 = 1,007+204+840 EXACT) · permissions drift
**347 → 357 = 357** (unchanged — no key this wave; the sweep-config
binds the EXISTING 0122-seeded trade.lc.manage key) · ROUTE_PERMISSIONS
**1,159 + 11 = 1,170** (the keys-seed-first FIRST trade binding wave,
dated at the block — the LC plane's eleven routes) · i18n 7,253
standing (no delta — an API-DB wave) + mobile 371 · tokens 50/50 ·
manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors (implemented
G 63 · INV 35 · BR 104 standing — the 051 flip is W-42's) + the
self-test all-probes-OK (probe 7 stands at G-64/PHASE-051) ·
history-secrets 0 violations · 6,974 allowlisted hits (the FIVE tag
anchors walked, untouched) · capabilities agree · shells PASS/PASS ·
boundary PASS. THE HONEST CATCH (one, first-RED-proven then repaired —
the 0117/0118 additive-slot precedent's own class, disclosed at the
claim sites): the TWO closed-domain widenings this wave's writers
demand land WITH the writers through the additive slot 0123 (the chain
122 → 123): (a) 'trade' joins the notifications/notification_prefs
CHECK domains (the sweep's inbox records — the 19-member union, the
shared-scope union law; the cmms-schema spec's standing arm updated in
the same increment); (b) ck_cash_movements_source_shape is a closed
domain AND uq_cash_movements_source_side is one movement per
source-side — the repair gives the FEE EVENT its own source identity
('lc_fee' keyed by its single-use journal entry; the margin pair
keeps (letters_of_credit, lc.id) one row per side; the amendments
keep (lc_amendment, id)) — EXACTLY the three new members, no wider,
the standing twelve of 0056 + three = fifteen. The master plan's four
declared slots 0119–0122 are consumed at W-33 and PUBLISHED (the
constants law); the additive slot is the 050 0117/0118 precedent's
own class, dated at every claim site. **RISK-033: EIGHT incidents,
ZERO new this wave — the row stays OPEN, closing only by the owner's
order.** The reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا
كتابة خارجها. NEXT: W-35 (the documentary collections API (D/P + D/A)
+ the Incoterms registry with BR-106's selector mandate) under the
owner's standing order. NOT production approval — تسليم لا قبول.]**

**[Dated 2026-11-25 (PHASE-051 W-35 DELIVERED at the engine head
`f478170` + the spec head `e2bbfa6` — the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored, every step
pushed at its own commit): CRITERION #6'S REGISTRY/SELECTOR ENGINE ARMS
GREEN + THE COLLECTIONS ENGINE ARMS GREEN (the register's engine plane).**
THE INCOTERM SELECTION IS MANDATORY ON TRADE-FLAGGED ORDERS (BR-106 —
the owner's ruling (ج) VERBATIM): the shared order gate
(`trade-order-gate.ts` — the documented-contract surface) probes the
tenant's `trade` entitlement, resolves the base currency, renders the
PURE fold's trigger verdict (the currency arm OR the marker arm, both
NAMED), and REFUSES the order's own posting with the typed
ORDER_INCOTERM_REQUIRED naming the order + the missing field + the
arms — ZERO residue (the number never reserves, the row stays DRAFT/
APPROVED, no issuance audit; proven on BOTH order families: the PO and
the SO through its approval hop). THE RISK-HINT MATRIX RENDERS FROM THE
REGISTRY ROW'S OWN DATA: `trade-incoterms.db.spec` proves the five AR/EN
lines flip with the row's booleans (CIF · DDP · EXW's own 2020 shapes),
the matrix DATA riding the registry (0120's ownership columns — never a
parallel dictionary). THE REGISTRY LISTS THE SEEDED SET AND ACCEPTS
TENANT ADDITIONS (the engine arms — the page renders on W-39's surface
wave): the canonical seeds materialize through the ONBOARDING path (the
0122 §6 note's own demand — `trade-canonical.ts`, one source both paths,
the accuracy disclaimer on every starter row, idempotent); the tenant
addition refuses the (tenant, code) natural key BY NAME; the frozen
code (the identity never rewritten); the retirement's SNAPSHOT
semantics (a retired code never rides a NEW order; an order created
before the retirement keeps its recorded selection and posts). THE
COLLECTIONS ENGINE (T-07 — the D/P vs D/A settlement windows over real
PG16): both golden lifecycles (at sight and usance) with the settled
pair landing TOGETHER, the register's own evidence telling the terms
apart (a D/A's acceptance precedes its payment; a D/P's at-sight
acceptance lands with the payment — declared interpretation #4, the
0119 accepted_shape floor rendered VERBATIM), the usance floor, the
terms gates, the stamp law's OPEN-only exit, the terminal law, and THE
NON-LEDGER LAW (zero journal entries, zero cash movements — the money
lands through the existing receipts discipline; the reservations law
rides it: no posting identifier minted). THE WAVE'S HONEST CATCHES (two,
both first-RED-proven then repaired, disclosed at the claim sites): the
at-sight acceptance (above) + this gate's three order-dependent
purchasing assertions (vitest's duration-based file sort reorders the
suite across sessions — the golden G-07/G-08 GRNI-register TOTAL, the
G-08 receipt lookup, the operations A7 count; reproduced at the FULL
W-34 tree in this session, proving them pre-existing; the repair scopes
every assertion to the arm's OWN rows — the per-arm-world law
«أذرع الرفض كلٌّ على عالمه» restored; the re-run GREEN in every order).
The battery: the six isolates standalone first, the ELEVEN-PART
ENVELOPE 305 · 4,407 · 0 failed · 0 skipped (the coverage verified
before the first load run), the 124-chain scratch from zero TWICE
(check-rls OK — 354 catalog tables), the standing battery green at the
final code state (typecheck 8/8 · lint 8/8 · depcruise 2,221 · 16,568 ·
unit 171 · 2,072 · drift 357 = 357 · ROUTE_PERMISSIONS 1,181 · docs
33/33 · id-ledger 0 errors + the self-test all-probes-OK ·
history-secrets 0 violations · the shells and the boundary PASS —
`audit-evidence/phase051-w35/`). **RISK-033: EIGHT incidents, ZERO new
this wave — the row stays OPEN, closing only by the owner's order.**
The reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة
خارجها. NEXT: W-36 (the transport documents + the shipment tracking —
the pure fold FIRST per D-14) under the owner's standing order. NOT
production approval — تسليم لا قبول.]**

**[Dated 2026-11-25 (PHASE-051 W-36 DELIVERED at the engine head
`258c49a` + the spec head `5653574` — the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored, every step
pushed at its own commit): CRITERION #7'S ENGINE ARMS GREEN (the
tracking board's web arms wait on W-39's surface wave) + #8'S
CHAIN-NAVIGABLE TRANSPORT LINK GREEN (the PO import leg through the
REAL PO service — the chain's links navigable link-by-link as each
lands, D-15's documented contracts).** THE TRACKING PURE FOLD (D-14 —
the unit-first law) CAME FIRST: `tracking-fold.ts` — THE TOTAL STATUS ×
EVENT MATRIX (the carrier ladder BOOKED/DEPARTED/ARRIVED/CLEARED/
DELIVERED, ranks 0…4; every document rung × milestone carries a
verdict: strictly above → ADVANCE (the multi-rung leap allowed — the
fold does not demand intermediate events) · the diagonal → NOOP (the
idempotent re-assert — the event records, the status stays) · strictly
below → REFUSED as a drive (THE MONOTONE LADDER — an event NEVER
regresses a document's status; the event still records in the
append-only log — the 0122 comment's own law «this table is only the
append-only log», the monotone law lives in the fold) · the unknown
event and the unknown current → the typed vocabulary refusals) with
its 10 property tests (the full 5×5 product walked, the never-regress
invariant asserted over the whole product). THE DRIVE AT THE SERVICE
(`trade-tracking.db.spec`, 9 arms, the fold's output rendered VERBATIM
at the service floor): THE GOLDEN LADDER (every rung advances the
anchor B/L AND both packing lists; the log carries all five events in
order) · THE MONOTONE LAW AT THE SERVICE (a regressing event RECORDS —
the carrier's late-arriving fact is the truth — but NEVER regresses a
document) · THE MULTI-RUNG LEAP (a fresh world's DELIVERED event
advances BOOKED → DELIVERED directly) · THE DECLARATION DRIVE (the
event's OWN linked declaration advances with the shipment — the
customs leg; the 0121 shipment_status column proven as the fold's own
output) · the milestone vocabulary's typed refusal (ZERO residue — no
event row) · the event shapes · the unknown-B/L typed 404 · the
declaration link's typed 404 (the unknown declaration refuses the
append — the event never records, the documents never moved) · the
event-log reads (the filters by B/L and by declaration). THE TRANSPORT
DOCUMENTS (T-09 — `trade-transport.db.spec`, 6 arms, NO journal, NO
ledger effect anywhere — the non-ledger-document law's trade face):
THE B/L GOLDEN CREATE (the official BL-{YYYY}-{SEQ:6} · the multimodal
type · the commercial links — the PO import leg through the REAL PO
service · the container refs as data · THE FOLD'S INITIAL RUNG (BOOKED
— no manual status write exists anywhere; the transport service
exposes NO status write) · the find's own chain: the B/L + its packing
lists + its events) · the doc-type vocabulary's refusal · the B/L's
own floors (the empty carrier name, the blank port, the oversized
container ref, the >50 refs) · the unknown B/L's typed 404 · THE
PACKING LIST'S ANCHOR + SHAPES (the B/L link REQUIRED at the service
floor — the declared interpretation recorded at the claim site; the
pack lines validated; THE PHYSICAL LAW — gross ≥ net, the reason
naming the law) · the list surfaces. NO migration this wave (the
0120/0122 floors landed at W-33; the chain stands at 124 — the
declared slots' constants law). The battery: the six isolates
standalone first, the ELEVEN-PART ENVELOPE **307 · 4,422 · 0 failed ·
0 skipped** (the coverage verified before the first load run; the one
declared roster movement: the trade-tracking + trade-transport specs
join chunk-a 117 → 119), the 124-chain scratch from zero TWICE
(check-rls OK — 354 catalog tables), the standing battery green at the
final code state (typecheck 8/8 · lint 8/8 · depcruise 2,228 · 16,614
· unit 172 · 2,082 (api 83·1,038 — the fold's property tests) · drift
357 = 357 (zero delta — no key this wave; the routes bind the EXISTING
0122-seeded trade.shipments.* keys) · ROUTE_PERMISSIONS 1,181 + 7 =
**1,188** (the keys-seed-first THIRD trade binding wave, dated at the
block) · docs 33/33 · id-ledger 0 errors + the self-test all-probes-OK
· history-secrets 0 violations (7,091 allowlisted hits — the window's
shift) · the shells and the boundary PASS —
`audit-evidence/phase051-w36/`). THE WAVE'S HONEST CATCHES (three
disclosures, no battery red standing): (1) THE EXIT-CODE DISCOVERY
(this session's own — the guarded wrapper hardened in response): on
DB-suite runs the vitest process EXIT CODE IS NOT TRUSTWORTHY ON RED —
embedded-postgres's async-exit-hook converts the natural beforeExit
exit (vitest's pending exitCode=1 after failed tests) into an explicit
process.exit(0); proven by a deliberate failing diagnostic (exit 0
with 1 failed); the wrapper now verifies the vitest SUMMARY lines
(zero failed files AND zero failed tests) in addition to the exit
stamp; (2) THE SOAK ISOLATE'S ENVIRONMENTAL RED (run 1's end-of-window
sample caught a 5-deep tail backlog — lastDepth 5 vs baseline 1+2 —
the machine still settling after the fresh install; the RED log kept
at `db-isolate-soak-env-RED.log`; the re-run GREEN 1·1 at 228.29s,
the drain restored — environmental, never a code red: the soak path
touches no trade code); (3) THE SCRATCH INVOCATION SLIP (the W-0/W-33
class — the first scratch invocation passed the repo-root-relative
path; ERR_MODULE_NOT_FOUND before any DB work; the slip log kept;
re-invoked through the filter's apps/api cwd, both runs green). The
reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة خارجها.
NEXT: W-37 (the customs engine — T-10: the declarations + lines API,
the HS registry extension, the duty computation into the landed costs
(G-65 — D-06) with INV-036's completeness gate (D-07); the duty/VAT
line fold a PURE module FIRST) under the owner's standing order. NOT
production approval — تسليم لا قبول.]**

**[Dated 2026-11-25 (PHASE-051 W-37 DELIVERED at the engine head
`af76c7b` + the spec head `bb3a3fb` — the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored, every step
pushed at its own commit): CRITERION #3 GREEN — THE ENGINE ARMS (the
declaration → allocation flow + the INV-036 refusals; the golden
transcripts + the failure packs are W-41's).** THE DUTY/VAT LINE FOLD
(D-06 — the unit-first law) CAME FIRST: `duty-vat-fold.ts` — the line
math (duty_amount = customs_value × duty_rate on Decimal, ADR-0009,
4dp ROUND_HALF_UP) with the NO-HARDCODED-RATES LAW (the rates are the
tenant's own data; a zero rate the explicit EXW/free statement) and
the totals (the G-65 amount's own source: Σ (duty + import VAT) from
the declaration's OWN lines — never a stored parallel figure) with 11
property tests. CUSTOMS DECLARATIONS COMPUTE DUTIES AND IMPORT VAT PER
LINE: `trade-customs.db.spec` (10 arms over real PG16, every arm on
its OWN world) proves the line math on every row (the find's own
chain renders the fold's output — 10.0000/5.0000 on the golden
world's lines). THE DUTIES FLOW INTO THE EXISTING LANDED-COST
ALLOCATION (G-65 — D-06/D-15(a) VERBATIM): the completion act creates
+ posts THE LANDED-COST DOCUMENT OF KIND `customs` THROUGH THE REAL
LandedCostService (the ONLY allocator — zero parallel computation):
the journal asserted line-by-line — **DR INVENTORY 1140 (the on-hand
allocation) · DR COGS (the issued portion — fully-on-hand → 0) · CR
the purpose-mapped CUSTOMS_DUTY_PAYABLE 2145** (the 0122 §8 marker,
fail-closed until mapped: the superseded→refused→restored→GREEN
flip-and-restore arm), allocated by VALUE per the existing engine,
the FX ride at the contract rate (D-21's own shape — the landed
amount the BASE figure, the missing rate refused at the act). INV-036
HOLDS — NO LANDED-COST ALLOCATION ON AN IMPORT RECEIPT WITHOUT A
COMPLETED DECLARATION REFERENCE (D-07's honest interpretation): the
typed DECLARATION_REQUIRED (no declaration references the receipt) /
DECLARATION_INCOMPLETE (the resolved declaration's own state —
ACCEPTED, not COMPLETED) refusals fire at the purchasing POST act
itself (the shared customs landed-cost floor — the documented
contract consumed through the plain-function shape, the W-35 order
gate's precedent) with ZERO residue (the refused allocation stays a
draft — status DRAFT, posted_journal_id NULL, zero journal entries,
zero allocation rows); ordinary NON-DUTY landed costs stand untouched
(a freight cost posts GREEN with no declaration near the receipt, its
ordinary rows carrying NO tie — never restated narrower); the flag
OFF = the floor silent (the boundary tenant's own full substrate
proves the pre-051 behavior). EVERY ALLOCATED DUTY TIES TO A
DECLARATION LINE (the line-level linkage recorded on the allocation —
INV-036's own demand): the 0125 additive column
`landed_cost_allocations.declaration_line_id` + the tie map resolved
by the trade gate (the one-line-per-item exactness laws — the declared
interpretation #5: every declaration line item-bearing, every item
declared exactly once, every GRN stock line's item declared; the three
refusal arms — the item-less line, the doubled item, the undeclared
GRN item — each refuse DECLARATION_LINE_TIE_INVALID at the post with
THE WHOLE COMPLETION ROLLING BACK (INV-018: the declaration stays
ACCEPTED, zero landed-cost documents, zero journals). THE
EXACTLY-ONCE: the completion CAS (the stamp law — the second complete
refused from the COMPLETED rung) + the 0125 partial unique
uq_landed_costs_tenant_declaration (one customs landed-cost document
per declaration, ever — the INV-013-equivalent single-use, D-06's own
wording) + the declaration's own linkage pair (landed_cost_id +
landed_cost_no, landing in the SAME ambient transaction). THE
LADDER'S OWN ARMS: the DRAFT-only lines window · the DRAFT-only
cancellation (the 0121 stamp-shape floor — «the submission stamp is
monotone evidence that never un-stamps», the specific refusal wired
BEFORE the CAS) · the typed 404 · THE HS REGISTRY's arms (the tenant
addition, the duplicate refused BY NAME, the frozen code, the
retirement's snapshot semantics) · THE ZERO-DUTY COMPLETION (the
declared interpretation #6: an all-EXW/free set completes without a
landed-cost document — nothing to allocate, the linkage pair NULL).
MIGRATION **0125** (the 0123/0124 additive-slot precedent's own
class, ordered WITH the writers — the chain 124 → 125; the manifest +
journal + the spec's dated chain note together). ROUTE_PERMISSIONS
1,188 + 11 = **1,199** (the keys-seed-first FOURTH trade binding
wave, dated at the block — the customs family binds the EXISTING
0122-seeded trade.customs.* keys; drift 357 = 357, zero delta). The
battery: the six isolates standalone first, the ELEVEN-PART ENVELOPE
**308 · 4,432 · 0 failed · 0 skipped** (the coverage verified before
the first load run; the one declared roster movement: the
trade-customs spec joins chunk-a 119 → 120), the 125-chain scratch
from zero TWICE (check-rls OK — 354 catalog tables), the standing
battery green at the final code state (typecheck 8/8 · lint 8/8 ·
depcruise 2,234 · 16,668 · unit 173 · 2,093 (api 84·1,049 — the
fold's property tests) · drift 357 = 357 · docs 33/33 · id-ledger 0
errors + the self-test all-probes-OK · history-secrets 0 violations
(7,154 allowlisted hits — the window's shift) · the shells and the
boundary PASS — `audit-evidence/phase051-w37/`). THE WAVE'S HONEST
CATCH (one, first-RED-proven then repaired, disclosed at the claim
sites — no battery red standing): the customs spec's FIRST run had
the completion-refusal catches INSIDE the withTenant callbacks —
swallowing the refusal within the transaction and COMMITTING the
completion stamp (the tie-law arms found the declarations COMPLETED
instead of rolled back); the repair moves the catch OUTSIDE the
withTenant so the refusal propagates through the transaction (the
INV-018 rollback actually proven — the honest shape); the
`invocation-slip` class of the prior waves does not recur (the
scratch proof invoked through the filter's apps/api cwd from the
first try). **RISK-033: EIGHT incidents, ZERO new this wave — the row
stays OPEN, closing only by the owner's order.** The reservations
G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة خارجها. NEXT: W-38
(the bonded warehouse + duty drawback — T-11 + T-12: the in-bond
transfer with NO duty entry through the REAL movement core (G-66 —
D-08) + THE SHARED GATE at planIssue blocking the duty-suspended
stock from customer issue + the release recognizing the duty EXACTLY
ONCE (BR-107) + the drawback claims' export-evidence gate (BR-108))
under the owner's standing order. NOT production approval — تسليم لا
قبول.]**

**[Dated 2026-11-25 (PHASE-051 W-38 DELIVERED at the engine head
`e01dbab` + the spec head `22836be` — the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored, every step
pushed at its own commit): CRITERIA #4 + #5 GREEN — THE ENGINE ARMS
(the blocking matrix + the release + the export-evidence gate; the
golden transcripts + the failure packs are W-41's; the suspended
banner spec is W-39's).** BONDED MOVES POST NO DUTY ON MOVEMENT
(G-66 — D-08 VERBATIM): `trade-bonded.db.spec` (14 arms over real
PG16, every arm on its OWN world — a fresh item per arm) proves THE
IN-BOND TRANSFER through the REAL movement core (the OUT leg at WAC
with the movement core's own `allowBondedStock` bypass — the
beneficiary discipline; the IN leg at the carried cost — value
conservation, G-15's own law), the G-15 policy journal on distinct
accounts asserted as the VALUE-NEUTRAL pair (DR 1141 · CR 1140 at
the carried value — NEVER a duty line; zero journals at the
'release' operation), and the from-NULL INITIAL DEPOSIT (the
custodial entry — the declared interpretation #10: NO journal while
suspended, the INV-010 trail exact). **THE SHARED GATE'S BLOCKING
MATRIX OVER EVERY BASELINE ISSUE PATH** (the 050 hold-gate's own
evidence shape): the raw `planIssue` (the typed 409
BONDED_STOCK_SUSPENDED naming the stock + the bond + the figures —
the exact pool/on-hand payload, ZERO residue), the `manualIssue`
(zero moves beyond the deposit's receipt, zero journals), the
sales-delivery post (the note stays DRAFT, zero moves), the transfer
dispatch — **the bond FOLLOWS THE GOODS** (the destination's pool
grows, the gate blocks the destination alike), and the flag-off
boundary (a tenant without the trade entitlement: a positive-pool
position issues GREEN exactly as before — the gate silent, never
restated narrower). THE BLOCK IS G-66'S OWN STRUCTURAL FACE — NO NEW
INVARIANT IDENTIFIER (the reservations law §6.16; the launch
dispatch's declared base: the planIssue unified gate as the
precedent). RELEASE INTO FREE CIRCULATION RECOGNIZES DUTY EXACTLY
ONCE (BR-107 — D-11): the release golden arm asserts the G-65-shaped
pair at the released quantity (the journal **DR INVENTORY 1140 (the
released stock's value uplift) · CR the purpose-mapped
CUSTOMS_DUTY_PAYABLE 2145**, INV-013 single-use on
(bonded_warehouse_moves, id, release) — the journal source's own
anchor), the revaluation uplift through the REAL RevaluationService
(WAC 2 → 2.1 — the WAC/layers math at the released quantity, the
adjust move with the journal link), the ATOMIC recognition pair on
the register's row (the 0121 ck_release_shape floor), THE
FLIP-AND-RESTORE at release (the pool drops to zero — the manual
issue passes; the physical-move shape carries the destination's WAC
with the duty), THE SINGLE-USE STAMP (the replay refused — the row
and the journal stand), the partial releases partitioning the
declared duty + THE OVER-RELEASE GUARD (40 + 60 = the declared 100;
61 refused BY NAME), the declaration-state refusals (SUBMITTED ·
EXPORT-type · **COMPLETED through the REAL G-65 flow — the
double-recognition refusal, the honest bifurcation**), the zero-duty
release (the declared interpretation #6 extended: the EMPTY
recognition pair — nothing posts, the pool still releases), and the
FX ride + the fail-closed purpose (the superseded→refused→
restored→GREEN flip-and-restore — the W-37 arm's own shape).
DUTY-SUSPENDED STOCK IS VISIBLY FLAGGED AND BLOCKED FROM CUSTOMER
ISSUE WHILE SUSPENDED (the gate's structural block — the suspended
banner on the bonded-bearing surfaces is W-39's own arm, declared).
DUTY DRAWBACK CLAIMS CANNOT SUBMIT WITHOUT LINKED EXPORT EVIDENCE
(BR-108 — D-12's own wording): `trade-drawback.db.spec` (7 arms over
real PG16) proves the gate's typed refusal (DRAWBACK_EVIDENCE_
REQUIRED naming the claim + the missing evidence, the claim stays
DRAFT — ZERO residue), the OR branches (the EXPORT declaration — the
export-type law refuses an IMPORT declaration as evidence; the
export bill of lading), the DRAFT-only link window, THE WORKFLOW
RECORDS THE CLAIMED AMOUNTS AND STATUS TRANSITIONS (the ladder DRAFT
→ SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED; APPROVED → PAID —
the stamps' shapes: submitted_at monotone, decided_at only at the
verdicts; REJECTED and PAID terminal, every later move refused), and
**THE HONEST NO-GL SHAPE — ZERO journals and ZERO cash movements
across the whole workflow** (the non-ledger-document law's trade
face: the claim is a registry record, the refund money lands when
treasury records it — 053's surface). MIGRATION **0126** (the honest
catch, disclosed at the claim sites: the closed
ck_stock_moves_source_shape refused the bonded engine's first
stock_moves insert BY NAME — the step-1 «NO migration» declaration
corrected; the 0117/0123 additive-slot precedent's own class, the
chain 125 → 126, the shared-scope union 24 + 1 = 25 — the cmms-schema
spec's standing scope arm updated in the same increment). The
battery: the six isolates standalone first, the ELEVEN-PART ENVELOPE
**310 · 4,453 · 0 failed · 0 skipped** (the coverage verified before
the first load run; the one declared roster movement: the
trade-bonded + trade-drawback specs join chunk-a 120 → 122), the
126-chain scratch from zero TWICE (check-rls OK — 354 catalog
tables), the standing battery green at the final code state
(typecheck 8/8 · lint 8/8 · depcruise 2,244 · 16,752 · unit 175 ·
2,125 (api 86·1,081 — the two folds' property tests) · ROUTE_
PERMISSIONS 1,199 + 13 = 1,212 (the keys-seed-first FIFTH trade
binding wave, dated at the block; drift 357 = 357, zero delta) ·
docs 33/33 · id-ledger 0 errors + the self-test all-probes-OK ·
history-secrets 0 violations (7,220 allowlisted hits — the window's
shift) · the shells and the boundary PASS —
`audit-evidence/phase051-w38/`). THE WAVE'S HONEST CATCH (one,
first-RED-proven then repaired, disclosed at the claim sites — no
battery red standing): the closed source vocabulary's refusal (the
0126 story above) + the two spec first-reds repaired in the same
session (the per-arm-world law's fresh-item discipline — the shared
fixture item accumulated two arms' positions; the empty-ledger pool
read's numeric-literal "0" shape; the 0121 stamp floors on the raw
export-declaration fixture insert) — all disclosed, all repaired, the
re-runs GREEN. **RISK-033: EIGHT incidents, ZERO new this wave — the
row stays OPEN, closing only by the owner's order.** The reservations
G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة خارجها. NEXT: W-39
(the web plane — T-14: the three screens + the Incoterms reference
page + the incoterm selector in the PO/SO forms + the certificate
print surface (D-13 — the 050 print laws) + the duty-suspended
banners (D-17) + i18n BY BOTH COUNTS from this wave) under the
owner's standing order. NOT production approval — تسليم لا قبول.]**

**[Dated 2026-11-26 (PHASE-051 W-39 DELIVERED at the web-plane head
`f8fee96` + the web-spec head `cf6ad9b` — the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored, every step
pushed at its own commit): CRITERIA #6'S SURFACE ARMS + #7'S BOARD
ARMS + #8'S PRINT ARMS GREEN — THE FIRST SURFACE WAVE'S I18N LAW
GREEN.** THE FIVE SCREENS RENDER THE ENGINES' FIGURES VERBATIM (the
nine web specs — the five board specs + the banner + the nav-rows
flag-gating + the incoterm-selector + the print-builder: the register
VERBATIM + the create acts posting the exact bodies + the detail
chains (the amendments + the checklist with the discrepancy notes; the
lines + the fold's totals from the LINES at every read; the B/L's own
packing lists + events; the registry's five ownership axes; the
certificates' frozen goods lines + parties + links) + the typed
refusal panels with the FULL payloads + the AR locale Arabic-first on
every board) · THE FLAG-GATING VERIFIED (the nav-rows spec's three
arms: the five rows with the exact ids/routes/feature keys — trade.lc
+ trade.customs + the whole-module trade ×3, the PURCHASING group
(D-04's own dependency); the permission keys mirror the
route-permissions rows verbatim — trade.lc.view ·
trade.customs.view · trade.shipments.view · trade.view; both label
sides with real Arabic) · THE DECLARED I18N DELTA GREEN (7,253 + 329 =
7,582 = 7,582 BY BOTH COUNTS — ar = en, 100% parity, the first
surface wave's law; mobile 371 standing; the 55-code
localizedTradeError mapper + the five status localizers) · **THE
CERTIFICATE PRINT LAW GREEN (D-13 — the 050 COA print-render
precedent VERBATIM)**: the print-builder spec's four arms (bi()
EXCLUSIVELY with the no-cross-leak arms in both locales; DETERMINISM —
two builds byte-identical in BOTH locales (docNo/docDate the
certificate row's own strings, never a wall-clock read); the frozen
snapshot passing through VERBATIM with the .num isolation and a real
thead; the honest dash — absent links render no parties row) + THE
REAL CHROMIUM CERTIFICATE PRINT ARM (trade-certificate-print-render.
db.spec — 3 arms over real PG16 + the chromium-1248 shells: both
locales' thead/dir/rtl-ltr/.num/woff2 assertions with the frozen goods
lines + the frozen links' own figures; the REAL PDF render — a
multi-kilobyte %PDF with the embedded fonts; THE DETERMINISM ARM with
the renderer's own Skia /CreationDate + /ModDate clock stamps
normalized — the dated 2026-11-23 finding carried VERBATIM: two builds
byte-identical; two renders byte-identical modulo the renderer's own
second-resolution metadata) · THE DUTY-SUSPENDED BANNER SPEC (D-17 —
four arms: a null move renders nothing (the additive law); the
register's own figures VERBATIM (moveNo · the line's own qty under
bond · executedAt — never a recomputed suspended balance); role=status
· the AR locale Arabic-first · the row-level chip) · THE INCOTERM
SELECTOR (five arms: the matrix VERBATIM at selection time in both
locales; no selection → no matrix + BR-106's mandate hint; the empty
registry degrades to the bare select; the selection flows to the
host). THE WEB SUITE 30 · 204 → 39 · 240 (+9 files, +36 tests) · the
trade DB family 11 · 128 standing green at the spec head (the print
arm joining) · ROUTE_PERMISSIONS 1,212 + 3 = 1,215 (the tsx recount —
the certificate plane's three routes binding the EXISTING
trade.shipments.manage key, the 0120 family; drift 357 = 357 — zero
key delta, a surface wave). THE GATE BATTERY (the FIFTY-FIRST
consecutive same-session wave; §0a first — the remote verified at
`cf6ad9b` = the W-39 spec head, the four annotated tags' six
identifiers + the 050 tag intact, local = remote; the TENTH
environment reset recovered BEFORE the runs — the fresh clone from
the GitHub remote, pnpm 9.15.9, the workspace install with the
embedded-PG16 16.14 binaries, the chromium-1248 pair provisioned):
the six isolates standalone FIRST (the owner's عزل مسبق order — soak
1·1 230.23s · fcm 1·8 · email 1·5 · the cmms sweep 1·4 · the quality
calibration sweep 1·4 · the trade expiry sweep 1·6, every stamp
through the guarded wrapper) · THE ELEVEN-PART ENVELOPE **311 files
· 4,456 tests · 0 failed · 0 skipped** (the coverage verified BEFORE
the first load run — 311 = 311, missing NONE, extra NONE, duplicates
NONE, VERDICT: COVERED; the ONE declared roster movement: the
trade-certificate-print-render spec joins chunk-a at its alphabetical
position 122 → 123, the roster 310 → 311; the load parts: smoke
3·1,999 19.44s · perf-rest 5·23 90.04s · chunk-a 123·1,070 153.02s ·
b-rest 86·625 65.45s · c 88·711 76.84s — every part inside the 570s
ceiling; the arithmetic 311 = 1+1+1+1+1+1+3+5+123+86+88 EXACT · 4,456
= 1+8+5+4+4+6+1,999+23+1,070+625+711 EXACT; the provenance 4,456 =
4,453 (the W-38 envelope) + 3 (the print arm) EXACT, declared before
the first load run and confirmed by it; the print arm ran UNSKIPPED —
3 tests, 2,381ms, the REAL Chromium) · THE 126-CHAIN SCRATCH FROM
ZERO TWICE (السلسلة من الصفر مرتين: both runs CHAIN_126_APPLIED →
[check-rls] OK — 354 catalog tables → SCRATCH_STOPPED, EXIT=0, both
logs kept — run 2 at its own SCRATCH_PORT 5498; the chain STANDS at
126 — the wave added NO migration (the certificate surface rides the
0120 §4 plane's own issuance; the banners read the existing bond
ledger), verified against the tree BEFORE the claim: 126 SQL files ·
126 journal entries; **THE «127-CHAIN» ANTICIPATION CORRECTED — the
step-2 NEXT note's own word «the 127-chain scratch» corrected HERE at
the original claim's follow-through site with the dated note (the F1
literal-truth law: verified against the artifact before it is
written; no migration invented to match an anticipation)**) · the
standing battery green at the final code state (typecheck 8/8 (0
cached, --force) · lint 8/8 (0 cached, --force) · depcruise clean
2,269 · 16,922 (+25/+170 dated — the W-39 web plane's files; zero
cycles) · unit 8/8 — **184 files · 2,161 tests** (api 86·1,081 · web
39·240 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 ·
domain-core 6·38 · sync-core 5·36; the ledger arithmetic 2,161 =
1,081+240+840 EXACT) · ROUTE_PERMISSIONS 1,215 (the tsx recount) ·
drift 357 = 357 · i18n 7,582 = 7,582 + mobile 371 = 371 · tokens
130/130 + derivations 50/50 · manifests 13/13 · docs 33/33 · id-ledger
0 errors (implemented G 63 · INV 35 · BR 104 standing — the 051 flip
is W-42's) + the self-test all-probes-OK (probe 7 stands at
G-64/PHASE-051) · history-secrets 0 violations (7,289 allowlisted
hits — the window's shift: this session's commits entering the
last-200 sample; the FIVE tag anchors walked, untouched) ·
capabilities agree · shells PASS/PASS · boundary PASS —
`audit-evidence/phase051-w39/`). NO battery red this gate; the ONE
honest catch is the «127-chain» anticipation correction above (the
environment reset recovered before the runs, disclosed at §0a).
**RISK-033: EIGHT incidents, ZERO new this wave — the row stays OPEN,
closing only by the owner's order.** The reservations G-64…G-66 ·
INV-036 · BR-105…BR-108 — لا كتابة خارجها. NEXT: W-40 (the reports —
T-15: the four report contracts `trade.lc-register` ·
`trade.customs-declaration-register` · `trade.shipment-status` ·
`trade.duty-drawback-status`, registry 122 → 126, all pin sites
together — D-18) under the owner's standing order. NOT production
approval — تسليم لا قبول.]**

**[Dated 2026-11-26 (PHASE-051 W-40 DELIVERED at the contracts head
`39fe961` + the DB-spec head `31ed950` — the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored, every step
pushed at its own commit): CRITERION #9'S REPORT ARMS GREEN — THE
REGISTRY 122 → 126, ALL PIN SITES TOGETHER (D-18).** THE FOUR TRADE
REPORT CONTRACTS over the PHASE-013 engine: `trade.lc-register` (the
register's own rows — the official number, the 0119 ladder, the
currency, the amount, the margin deposit, the bank, the beneficiary,
the PO brief — with THE EXPIRY BAND VERDICT THROUGH THE SWEEP'S OWN
FOLD: the same effective-windows read (stored ∪ the documented
[30,14,7,1] default) + lcSweepBands + lcSweepBandFor the alerting pass
rides, NEVER running the sweep — a report is never the alerting act;
the days-to-expiry derived on the DATABASE'S OWN CURRENT_DATE; the
checklist's own open-discrepancy count (the store's own law:
discrepancy_notes IS NOT NULL AND verified = false) + the amendments
count + the `lc-status-vocabulary` block-on-fail check; the amounts
render in each LC's own currency and are never summed across unlike
currencies — the retention-statement law extended to FX) ·
`trade.customs-declaration-register` (the declarations' own rows + the
linked B/L/PO/landed-cost briefs + **THE LINE TOTALS THROUGH THE REAL
computeDeclarationTotals FOLD THE G-65 COMPLETION ACT RIDES — rendered
from the declaration's OWN lines at every read, never a stored
parallel figure** (D-06's zero-parallel-computation law) + the
`declaration-status-vocabulary` check) · `trade.shipment-status` (the
B/L register's own rows + THE FOLD'S OWN DRIVEN shipment_status —
never writable by hand, D-14's own law — + the append-only event
log's own latest milestone + count + the packing-list counts + the
`shipment-status-vocabulary` check on the fold's own milestone domain)
· `trade.duty-drawback-status` (the claims register's own rows + the
export evidence's own briefs with the honest dash + the
`drawback-status-vocabulary` check + THE HONEST NO-GL SHAPE (D-12 —
the claim is a registry record, the refund lands when treasury
records it)). THE QUERY SURFACE: TradeReportQueriesService — the
registry query-service convention (the 042/044/048/049/050 pattern
verbatim), read-only over the ambient tenant transaction, the folds'
READ surfaces only, zero JavaScript clocks (the derived-step clock
law). THE WIRING: the `trade` category + data-source module in the
unions · MODULE_DATA_PHASE trade: 51 · THE WINDOW WIDENED 50 → 51
(declared, never silent) · the §9 trade registration · the §12
module-register key reuse (trade.lc.view · trade.customs.view ·
trade.shipments.view · trade.view — ZERO new keys minted, the 357
discipline standing). THE PIN-SITE DISCIPLINE (the 048-W14 law — no
partial anchoring): the eight count pins (report-pack-wiring ·
reporting-unit ×2 · consolidation-contracts ×2 · golden ×2 ·
industry-018 · industry-019) + the cmms spec's own pin + THE NINTH
(the quality-reviews-hazards spec's own registry pin — missed by the
step-1 sweep's file list, CAUGHT BY THE ENVELOPE'S OWN COVERAGE
DISCIPLINE: the first chunk-a run RED-named it, the pin moved to 126
with the dated note, the two-head protocol with both logs kept) + the
known-permission catalogs (the boot list · the db fixtures · the unit
spec's own · the consolidation spec's own) + REPORT_CATALOG's dated
header · §9's PHASE-051 subsection (the four-row table + the notes) ·
the §13 provenance row · THE CATALOG↔REGISTRY RECONCILIATION EXTENDED
122/122 → 126/126 (the walk re-done at delivery: each of the four
trade keys appears exactly once in §9 and once in the live registry).
THE DB SPEC (trade-reports.db.spec — 7 arms, every arm on its OWN
world): the verbatim ties against the store's own reads (the
issuing_bank unaliased key disclosed at the claim site) + the REAL
folds (the band fold's verdict ≤14 at 10 days; the line-fold totals
14,000 · 1,200 · 700 · 1,900 EXACT) + the REAL TrackingService's
driven status (ARRIVED through two REAL appendEvent acts) + the deny
paths (one per contract — PermissionDeniedError before params bind) +
the tenant-isolation floor (the empty boundary tenant reads zero
rows) + the registry's four rows (the snapshot 126 + the permission
pins + the bilingual titles). THE GATE BATTERY (the FIFTY-SECOND
consecutive same-session wave; §0a first — the remote verified at
`31ed950`, the four annotated tags' six identifiers + the 050 tag
intact, local = remote): the six isolates standalone FIRST (the
owner's عزل مسبق order — soak 1·1 228.14s · fcm 1·8 16.59s · email 1·5
13.12s · the cmms sweep 1·4 7.26s · the quality calibration sweep 1·4
7.86s · the trade expiry sweep 1·6 7.31s, every stamp through the
guarded wrapper) · THE ELEVEN-PART ENVELOPE **312 files · 4,463 tests
· 0 failed · 0 skipped** (the coverage verified BEFORE the first load
run — 312 = 312, missing NONE, extra NONE, duplicates NONE, VERDICT:
COVERED; the ONE declared roster movement: the trade-reports spec
joins chunk-a at its alphabetical position 123 → 124, the roster
311 → 312; the load parts: smoke 3·1,999 21.07s · perf-rest 5·23
96.81s · chunk-a 124·1,077 147.97s (the green re-run — the first-red
log kept) · b-rest 86·625 62.50s · c 88·711 74.83s — every part
inside the 570s ceiling; the arithmetic 312 = 1+1+1+1+1+1+3+5+124+86+88
EXACT · 4,463 = 1+8+5+4+4+6+1,999+23+1,077+625+711 EXACT; the
provenance 4,463 = 4,456 (the W-39 envelope) + 7 (the trade-reports
spec's arms) EXACT, declared before the first load run and confirmed
by it) · THE 126-CHAIN SCRATCH FROM ZERO TWICE (السلسلة من الصفر
مرتين: both runs CHAIN_126_APPLIED → [check-rls] OK — 354 catalog
tables → SCRATCH_STOPPED, EXIT=0, both logs kept — run 2 at its own
SCRATCH_PORT 5498; the chain STANDS at 126 — the wave added NO
migration, the window widening 50 → 51 a RUNTIME declaration, not a
schema act, verified against the tree: 126 SQL files · 126 journal
entries) · the standing battery green at the final code state
(typecheck 8/8 (0 cached, --force) · lint 8/8 (0 cached, --force) ·
depcruise clean 2,275 · 16,970 (+6/+48 dated; zero cycles) · unit 8/8
— **184 files · 2,161 tests** standing (2,161 = 1,081+240+840 EXACT)
· ROUTE_PERMISSIONS 1,215 standing (the tsx recount — zero new routes)
· drift 357 = 357 · i18n 7,582 = 7,582 standing (no delta — an
API-reports wave) + mobile 371 = 371 · tokens 130/130 + derivations
50/50 · manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors
(implemented G 63 · INV 35 · BR 104 standing — the 051 flip is W-42's)
+ the self-test all-probes-OK (probe 7 stands at G-64/PHASE-051) ·
history-secrets 0 violations (7,361 allowlisted hits — the window's
shift; the FIVE tag anchors walked, untouched) · capabilities agree ·
shells PASS/PASS · boundary PASS — `audit-evidence/phase051-w40/`).
THE HONEST CATCHES (all first-RED-proven then repaired, all disclosed
at the claim sites, no battery red standing): (1) the NINTH count pin
(the envelope's own catch — the quality-reviews-hazards spec's own
registry pin at 122, the two-head protocol with both logs kept, the
pin moved to 126 with the dated note); (2) THE STAMP-TRUTH CATCH (the
NF-12 verdict rule exercised and dated inside the first-red log: the
hand-rolled capture's stamp first read the process code 0 while the
log's own vitest summary reported 1 failed — the exact W-6 class the
guarded wrapper's summary guard exists for; the stamp corrected to the
SUMMARY VERDICT, the guarded wrapper the only capture path for every
other log); (3) the step-2 spec's first REDs (the 0119/0121 CHECKs'
own floors: the presented-shape · the accepted-shape stamp law · the
HS digits-only floor; the store's unaliased issuing_bank key + the
family-run's tenant-global label — disclosed, the re-runs GREEN).
**RISK-033: EIGHT incidents, ZERO new this wave — the row stays OPEN,
closing only by the owner's order.** The reservations G-64…G-66 ·
INV-036 · BR-105…BR-108 — لا كتابة خارجها. NEXT: W-41 (the proof
pack — T-16: the golden transcripts G-64/G-65/G-66 with the MANDATORY
failure packs + the INV-036 completeness golden + the bonded
blocking-matrix golden + the RLS attack matrix A1–A10 over the
FOURTEEN tables (D-19) + the OA-06 EXPLAIN budgets) under the owner's
standing order. NOT production approval — تسليم لا قبول.]**

**[Dated 2026-11-26 (PHASE-051 W-41 DELIVERED at the proof-pack head
`04a44f2` — the owner's standing order «عند الانتهاء من أي خطوة ادفعها
إلى المستودع» honored, every step pushed at its own commit): THE
PROOF PACK GREEN — **#1…#9 ALL GREEN; ONLY #10 (THE W-42 CLOSURE)
REMAINS.** THE GOLDEN TRANSCRIPTS WITH THE MANDATORY FAILURE PACKS
(the JOURNAL_RULES §7 law, the 048-W14/049-W22/050-W31 pattern): the
G-64 golden (the issue's margin deposit DR the purpose-mapped 1180 ·
CR the bank + the retirement's REVERSED pair + the settled pair
stamped TOGETHER — the journal EXACT at the line level, the INV-013
single-use keys (lc, issue)/(lc, retirement), the INV-019-exact
treasury movements, the margin-net-zero ledger arithmetic) + the
G-64 failure pack (the unmapped LC_MARGIN_DEPOSIT → the typed
PURPOSE_NOT_MAPPED refusal with the FULL payload + the ZERO RESIDUE
(the row stays DRAFT, no journal, no movement, no stamp) + the
flip-and-restore through the tenancy runtime surface and the SAME act
GREEN with the SAME transcript) · the G-65 golden (the fold's
duty+VAT totals into the landed-cost document of kind customs through
the REAL LandedCostService — DR INVENTORY 1140 · CR the purpose-mapped
CUSTOMS_DUTY_PAYABLE 2145, the line-level tie, the 0125 linkage pair,
the exactly-once) + the G-65 INV-036 completeness failure pack
(DECLARATION_INCOMPLETE with the declaration's own state ·
DECLARATION_REQUIRED with no declaration at all, ZERO residue on
both, the flip-and-restore and the SAME post GREEN) · the G-66 golden
(the release recognizes the duty EXACTLY ONCE — the recognition pair
DR the released stock's value 1140 · CR 2145, the revaluation uplift
through the REAL service, the ATOMIC recognition pair, the
single-use stamp with the replay refused at ZERO residue) + the
G-66 zero-duty release (the declared interpretation #6 — the EMPTY
recognition pair, the pool still releases, the gate falls silent) +
the G-66 failure pack (the unmapped CUSTOMS_DUTY_PAYABLE before the
stamp, zero residue, the flip-and-restore, the SAME pair GREEN) ·
THE BONDED BLOCKING-MATRIX GOLDEN (ONE arm over the four canonical
baseline paths — the raw planIssue · the manualIssue · the
sales-delivery post · the transfer dispatch — every
BONDED_STOCK_SUSPENDED payload pinned and EQUAL across the paths,
ZERO residue per path, the release + the GREEN re-run of the very
issue that was refused) · THE OFFLINE-REJECTION SHAPE (D-20 — OA-02
N/A-RECORDED for trade: the module is web-only, no synced entity; the
gate is SERVER-SIDE in planIssue, so the sync-reconciliation-shaped
document's POST runs the same plan and sees the SAME typed refusal,
payload for payload — the server-side-only law's own proof). THE RLS
ATTACK MATRIX A1–A10 OVER THE FOURTEEN TABLES (D-19): the no-GUC
reads · the paired witnesses at both floors (victim ≥ 1 / attacker 0
per table, the raw SQL + the store list surfaces) · the fourteen
forged-tenant INSERTs → 42501 with the census unmoved · the fourteen
UPDATE hijacks → 0 rows byte-identical · the DELETE grants census
(the twelve no-grant evidence tables DENIED 42501 · the two
tenant-extensible seed registers (incoterms · hs_code_registry) 0
rows — their own floor honored) · the id-probes 0 rows + the typed
finds answering the same not-found for a foreign as an absent id ·
the composite-FK law (the catalog walk ≥ 25 FKs, all (id, tenant_id)
or the tenants root) + the live FK-inversion probe → 23503 · the
FK-chain joins confined with the paired witnesses · the UNION ALL
over all fourteen (0 rows) + the recursive CTE walking the
declaration→B/L→declaration cycle via the tracking events'
declaration link, confined · the census before/after — every table
covered ≥ 6 times across arms. THE OA-06 EXPLAIN BUDGETS (the W-9
assertion law — never a forced plan, never an isolated probe
context): P0 the REAL corpus (a 30-line probe declaration + siblings
through the REAL customs service; a 30-event probe B/L + siblings
through the REAL transport/tracking services) · P1 the
declaration-lines walk (ix_customs_declaration_lines_tenant_decl —
the INV-036 line-level tie's own leg) · P2 the tracking-events walk
(ix_shipment_tracking_events_tenant_bl — the append-only log's own
leg) · P3 the customs-leg read (the 0122 partial index) — EXPLAIN
not ANALYZE, the plans logged verbatim, SET LOCAL enable_seqscan=off,
ANALYZE before the probes. THE GATE BATTERY (the FIFTY-THIRD
consecutive same-session wave; §0a first — the remote verified at
`04a44f2`, the four annotated tags' six identifiers + the 050 tag
intact, local = remote): the six isolates standalone FIRST (the
owner's عزل مسبق order — soak 1·1 229.49s · fcm 1·8 17.01s · email
1·5 13.47s · the cmms sweep 1·4 6.27s · the quality calibration sweep
1·4 8.31s · the trade expiry sweep 1·6 7.32s, every stamp through
the guarded wrapper) · THE ELEVEN-PART ENVELOPE **315 files · 4,486
tests · 0 failed · 0 skipped** (the coverage verified BEFORE the
first load run — 315 = 315, missing NONE, extra NONE, duplicates
NONE, VERDICT: COVERED; the ONE declared roster movement: the three
proof-pack specs join chunk-a at their alphabetical positions
124 → 127, the roster 312 → 315; the load parts: smoke 3·1,999
20.62s · perf-rest 5·23 96.76s · chunk-a 127·1,100 150.41s · b-rest
86·625 62.45s · c 88·711 76.09s — every part inside the 570s ceiling;
the arithmetic 315 = 1+1+1+1+1+1+3+5+127+86+88 EXACT · 4,486 =
1+8+5+4+4+6+1,999+23+1,100+625+711 EXACT; the provenance 4,486 =
4,463 (the W-40 envelope) + 9 + 10 + 4 EXACT, declared before the
first load run and confirmed by it) · THE 126-CHAIN SCRATCH FROM ZERO
TWICE (السلسلة من الصفر مرتين: both runs CHAIN_126_APPLIED →
[check-rls] OK — 354 catalog tables → SCRATCH_STOPPED, EXIT=0, both
logs kept — run 2 at its own SCRATCH_PORT 5498; the chain STANDS at
126 — the proof pack is a SPECS-ONLY wave: the goldens + the RLS
matrix + the EXPLAIN budgets PROVE the delivered schema, they never
alter it, verified against the tree: 126 SQL files · 126 journal
entries) · the standing battery green at the final code state
(typecheck 8/8 (0 cached, --force) · lint 8/8 (0 cached, --force) ·
depcruise clean 2,278 · 17,039 (+3/+69 dated; zero cycles) · unit 8/8
— 184 files · 2,161 tests standing (2,161 = 1,081+240+840 EXACT — a
specs-only wave) · ROUTE_PERMISSIONS 1,215 standing (the tsx
recount) · drift 357 = 357 · i18n 7,582 standing (no delta) + mobile
371 = 371 · tokens 130/130 + derivations 50/50 · manifests 13/13 ·
docs:validate 33/33 · id-ledger 0 errors (implemented G 63 · INV 35 ·
BR 104 standing — the 051 flip is W-42's) + the self-test
all-probes-OK (probe 7 stands at G-64/PHASE-051) · history-secrets 0
violations (7,411 allowlisted hits — the window's shift; the FIVE tag
anchors walked, untouched) · capabilities agree · shells PASS/PASS ·
boundary PASS — `audit-evidence/phase051-w41/`). THE HONEST CATCHES
(the wave's own first REDs, all repaired in the same session, all
disclosed at the claim sites — no battery red standing): (1) the
blocking-matrix golden's post-flip ledger count (the in-place duty
release's revaluation posts its own adjust move — the WAC uplift —
alongside the deposit's receipt and the green issue: 2 → 3
stock_moves expected, the product right, the spec's expectation
corrected with the three rows named); (2) THE BOUNDARY-TENANT LAW
(the W-31 honest-disclosure lesson applied: the shared
TENANT_TRADE_RLS carries the sibling specs' flag-off worlds, so
trade-rls mints its OWN dedicated never-written boundary tenant,
recorded in the spec header). **RISK-033: EIGHT incidents, ZERO new
this wave — the row stays OPEN, closing only by the owner's order.**
The reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة
خارجها. NEXT: W-42 (the closure — T-17 + T-18: the canon rows in the
ID_LEDGER's reserved wordings + THE ID_LEDGER FLIP (implemented G 66
· INV 36 · BR 108) + the full sweep at the final head + the
completion report + the triple flip + THE ARCHIVE
ERP_PLATFORM_PHASE051.zip EXACTLY AS DECLARED + the tag phase/051)
under the owner's standing order. NOT production approval — تسليم لا
قبول.]**

### PHASE-052 — Workflow & Approvals Engine (OPENED AT PLAN 2026-11-27 — the owner's review-framework law: the ledger opens with the plan and closes with the closure; every criterion carries its ARMS and its WAVES; the master plan `agent-ctx/PHASE-052-MASTER-PLAN.md` §3/§4 is the binding division; the launch dispatch's standing orders carried verbatim — «عند الانتهاء من أي خطوة ادفعها إلى المستودع» · «تسليم لا قبول»; the 051 completion report §5 handoff is the declared base — the change orders (048) and the duty drawback claims (051) the FIRST documents to bind multi-step chains; the reservations G-67 · INV-037 — NO BR reservation this phase — لا كتابة خارجها)

1. **Migrations 0127–0130 (the honest slots — the phase doc's 0090…0093
   stale by its own note, the 048/049/050/051 D-02 precedent) apply
   cleanly from zero (re-apply no-op); Drizzle mirror parity; the SIX new
   tables (`workflow_definitions` · `workflow_steps` ·
   `workflow_instances` · `workflow_step_instances` · `delegations` ·
   `escalation_events`) have ENTITY_CATALOG rows (354 → 360) + the RLS
   registry rows; the nine `workflow.*` keys seed with the matrix §3.30
   section (drift 357 → 366, zero-drift from the first increment) + the
   five feature flags on business+enterprise at the declared neutral
   zero.** — *Arms:* the chain spec extended to 130 · the from-zero boot
   in every run (السلسلة من الصفر مرتين at W-43) · the A-suite's arms
   over the six tables · the grants block's bilingual descriptions (the
   0122 §5 pattern). *Waves:* W-43 (opens) · W-51 (the final sweep
   closes).
2. **The engine runs the seeded conditional-chain scenario: a PO above
   50,000 routes manager → finance → CEO; at or below 50,000 it stops at
   the manager; a branch on a PHASE-036 custom field selects a different
   chain (the integration test) — over the FOUR exemplar bindings
   (`manual_journals` · `purchase_orders` · the 048 change orders · the
   051 drawback claims) through the documented WorkflowGateway contract,
   the vocabulary mapping law standing (each doc type's OWN
   submit-transition status, never a parallel vocabulary).** — *Arms:*
   `workflow-engine.db.spec` (the entry-condition evaluation · the
   definition snapshot capture at trigger time · the step ladder · the
   custom-field branch through the 036 readers VERBATIM — zero parallel
   computation) · the condition-evaluator pure fold FIRST (property
   tests, the typed refusals naming the condition BY PATH). *Waves:*
   W-44 (opens) · W-50 (the golden closes).
3. **Delegation: an active absence window re-routes PENDING steps to the
   delegate within scope only; expired windows stop routing; circular
   delegations are rejected at save.** — *Arms:*
   `workflow-delegation-escalation.db.spec` (the act-time resolution ·
   the scope boundaries · the circularity walk's typed refusal naming
   the chain · the delegation-graph pure fold first). *Waves:* W-45
   (opens).
4. **G-67 (the golden): an actor cannot approve their own document
   through a delegation chain (directly or transitively) — the
   effective-actor transitive closure checked against the document's
   creator, `allowSelfApproval` never flipping without an explicit
   tenant decision record.** — *Arms:* the enforcement at the act
   (W-45) + **the golden transcript with the MANDATORY failure pack at
   W-50** (the block naming the chain and BOTH endpoints · the zero
   residue · the flip-and-restore through a clean chain with the SAME
   act GREEN — the 048-W14/049-W22/050-W31/051-W41 pattern) + the
   JOURNAL_RULES canon row at the closure. *Waves:* W-45 (the
   enforcement opens) · W-50 (the golden closes) · W-51 (the canon).
5. **Escalation: a step left past its SLA hours produces an
   `escalation_events` row and fires the configured
   escalation/notification plus reminders via the scheduler.** —
   *Arms:* `workflow-escalation-sweep` (**the SEVENTH standing isolate**
   — the 05:45 cron · the clock law with the DB's own CURRENT_DATE · the
   structural dedupe `workflow:sla:{stepInstanceId}:{kind}:{dueDate}` ·
   the audit seal in the same ambient transaction · the entitlement gate
   · the per-tenant catch-and-continue) + the settings registry's typed
   key (`workflow.escalation_reminder_hours`, fail-closed defaults).
   *Waves:* W-45 (opens).
6. **Email deep-link approve and reject: the action is one-time, records
   the actor, `acted_at`, and comment, updates the timeline; replayed or
   expired links are rejected with a clear error.** — *Arms:* the
   stateless HMAC token (the identity secret's FOURTH derivation, the
   `workflow-action:` domain prefix — never the raw session) + the
   step-instance CAS single-use (the `acted_at` stamp) + the typed
   refusals (ALREADY_ACTED / EXPIRED / ACTOR_MISMATCH) + the email leg
   on the 041 templates. *Waves:* W-47 (opens).
7. **The timeline component renders the full step history (state,
   assignee, `delegated_to`, `acted_at`, comment) on the bound documents
   across modules, and the approval inbox lists PENDING work with aging —
   PP-17 satisfied with AR/EN parity and RTL.** — *Arms:* the data-slot
   shape (never the Tabs primitive — the 045 recall, every 052 board
   immune by construction) · the inbox's aging figures the engine's own
   reads VERBATIM · NAV_ITEMS +3 + the ⌘K registration · **i18n ~180
   keys BY BOTH COUNTS (7,582 + n = 7,582 + n, mobile 371 standing)**.
   *Waves:* W-48 (opens).
8. **INV-037: terminal workflow instances are immutable — any mutation
   attempt after completion is rejected by the service layer and covered
   by an invariant test.** — *Arms:* the typed
   `WORKFLOW_INSTANCE_IMMUTABLE` refusal (the state machine's fold + the
   store's guard) + the RED/GREEN invariant pair at W-50 + the
   ACCOUNTING_INVARIANTS canon row at the closure. *Waves:* W-44 (the
   floor) · W-50 (the golden) · W-51 (the canon).
9. **The `approval_policies` bridge converts seeded policies without
   behavior change (parity test on documents gated before/after), and
   in-flight documents complete under compatibility semantics.** —
   *Arms:* `workflow-bridge.db.spec` (the four-mode mapping — none → the
   honest no-chain row · single-approver → the one-step chain ·
   two-step → the two-step chain · amount-threshold → the branch pair ·
   the `origin_policy_id` back-reference) + the compatibility mode (the
   unregistered doc types byte-identical · the in-flight boundary
   recorded) + the mapping table in the completion report. *Waves:*
   W-46 (opens) · W-51 (the mapping record).
10. **All CR-36 discipline gates green (SQL+Drizzle+catalog parity,
    permissions zero-drift 366 = 366, AR/EN parity, `docs:validate`
    33 → 34 with the BUSINESS_WORKFLOWS intake declared, RLS tests,
    feature flags, the sync-surface assessment recorded — the
    inbox/timeline read surfaces assessed for the sync clients, the
    approve actions online-only by design); the report contracts
    `workflow.pending-approvals` + `workflow.sla-aging` (registry 126 →
    128, all pin sites together); completion report
    `reports/PHASE-052-COMPLETION.md` appended with evidence (the
    bridge mapping table + the event-bus topic list handed to
    PHASE-055); `IMPLEMENTATION_STATUS.md` row flipped; archive
    delivered as `ERP_PLATFORM_PHASE052.zip` (OA-07 — FLAT, the
    commit-hash first entry, additive-only, excluding the EIGHTEEN
    standing zips); the tag `phase/052` — DELIVERY, never acceptance.**
    — *Arms:* the closure wave's full sweep (the SEVEN isolates
    standalone first) + the ID_LEDGER flip (implemented G 67 · INV 37 ·
    probe-7's eighth move, claimant PHASE-053) + the two decision
    records (DR-052-01 the bridge policy · DR-052-02 the W-10 scope
    note). *Waves:* W-49 (the reports) · W-50 (the RLS matrix + the
    EXPLAIN budgets) · W-51 (closes).

**[Dated 2026-11-27 (PHASE-052 W-0 THE MASTER PLAN WAVE DELIVERED at the
051 closure head `c5175ff` — the plan PROPOSED for review before launch,
the implementation waves W-43…W-51 BLOCKED until the owner's approval
dispatch; the ledger OPENED with this plan per the owner's framework law;
the plan wave's own envelope `audit-evidence/phase052-plan/` — the
FIFTY-FOURTH consecutive same-session wave: the §0a record (remote @
c5175ff = the tag phase/051 · the six tags' identifiers intact · the
zero-diff reconciliation · the evidence census 1,699 files across 74
directories) + the full battery at the closure head's own constants
re-proven — a docs-only wave, the CODE tree byte-identical at `c5175ff`.
NOT production approval — تسليم لا قبول.]**

**[Dated 2026-11-27 (PHASE-052 W-43 THE FOUNDATION DELIVERED —
**ACCEPTANCE #1 GREEN** at the W-43 gate; steps 1–3 + the gate increment
pushed at their own commits under the standing order «عند الانتهاء من أي
خطوة ادفعها إلى المستودع»: step 1 `7246506` the migrations 0127–0130 +
every mirror/registry/catalog/matrix/pin in ONE increment (the drift 357
→ 366 zero-drift from the first increment · the five flags ·
ENTITY_CATALOG 354 → 360 · the ROUTE_PERMISSIONS 1,215 standing
keys-seed-first) · step 2 `f026f2a` the pure folds (the condition
evaluator · the instance/step state machine · the delegation graph · the
SLA fold · the token fold — unit-first, 5 files · 72 tests) · step 3
`b8c834f` the __db__/workflow/ family opens (the schema spec 41 arms,
every law refused BY NAME) · the gate increment this evidence envelope.
The wave's exit evidence `audit-evidence/phase052-w43/`: THE SIX STANDING
ISOLATES standalone first (soak 1 · 1 @ 230.23s · fcm 1 · 8 · email 1 ·
5 · the cmms sweep 1 · 4 · the quality sweep 1 · 4 · the trade sweep 1 ·
6) + THE FULL DB SUITE at the new count — **316 files · 4,563 tests · 0
failed · 0 skipped** (smoke 3 · 2,035 — the A-suite 1,999 → 2,035 over
the six new tables · perf-rest 5 · 23 · chunk-a 128 · 1,141 · chunk-b
86 · 625 · chunk-c 88 · 711; 4,563 = 4,486 + 36 + 41 EXACT, the
coverage verified before the first load run) + **THE 130-CHAIN FROM
ZERO TWICE** (both CHAIN_130_APPLIED → [check-rls] OK — 360 catalog
tables, both logs kept) + the full battery (typecheck 8/8 · lint 8/8 ·
unit 8/8 — 189 files · 2,233 tests · depcruise clean 2,291 · 17,067 ·
docs 33/33 · i18n 7,582 = 7,582 + mobile 371 standing · permissions
366 = 366 · manifests 13/13 · id-ledger 0 errors + self-test OK ·
history-secrets 0 with the SIX anchors walked · capabilities agree ·
the shells PASS · boundary-negative PASS). THE HONEST CATCHES
disclosed: (1) THE A-SUITE UUID PARSE FIX — step 1's committed
A-suite extension carried three invalid uuid literals (11-char last
groups `…d01/d02/d03`), the pre-fix RED captured (`invalid input
syntax for type uuid` 22P02 at the seed boot — the RED log kept,
VITEST_EXIT=1, 2,016 arms skipped) and the fix re-verified GREEN
standalone (1 · 2,016) AND inside the smoke chunk (3 · 2,035); (2) THE
COVERAGE-PROOF F1 ARITHMETIC CORRECTION — the first draft declared
«4,527 = 4,486 + 41» while itself stating the A-suite grows 1,999 →
2,035 (the +36 never added); corrected BEFORE the first load run with
the dated F1 note at the proof, 4,563 confirmed EXACT by the run; (3)
the chromium-1248 pair provisioned BEFORE the chunk runs (the fresh
environment's cache carried only the 1200 pair — the first chunk-a
attempt's four print-render skips re-run 0 skipped, the dated
env-prep disclosure). NOT production approval — تسليم لا قبول.]**

**[Dated 2026-11-27 (PHASE-052 W-44 THE ENGINE CORE + THE EVENT BUS
DELIVERED — **ACCEPTANCE #2 GREEN** at the W-44 gate; steps 1–3 + the
gate increment pushed at their own commits under the standing order:
step 1 `fc656fe` the bus + the category (0131 the declared additive
slot WITH THE WRITER — `workflow` joins BOTH notifications CHECK
domains, the union 19 → 20, the cmms-schema standing arm's dated
enumeration in the same increment; the WorkflowEvent bus — D-10's
eight topics, the config-events pattern, the 055 handoff surface) ·
step 2 `ddae709` the engine core (the store + the engine + the
gateway contract + the email leg on the 041 hub + the WorkflowModule)
· step 3 `bfc798c` the four exemplar bindings (the journals'
submit/approve/cancel · the POs' submit/approve/cancel · the change
orders' submit/approve/reject · the drawback claims'
submit/approve/reject — the vocabulary mapping law standing) · the
gate increment the engine end-to-end DB spec + the exit battery. THE
SEEDED CONDITIONAL-CHAIN SCENARIO GREEN: a PO above 50,000 opens
manager → finance → CEO through the REAL PurchaseOrderService (the
mid-chain approvals LAND on the chain — one atomic act, the module
skips its transition; the final approval completes the chain AND the
document); at or below 50,000 the branch SKIPPED stamps land at
trigger time and the manager's single approval completes everything;
a PHASE-036 custom field selects a different chain (the urgent PO →
the CEO-direct chain — the 036 readers VERBATIM through the
singular→plural entity mapping). The engine end-to-end DB spec 15
arms ALL GREEN (the four bindings · the actor law · the snapshot law
· the notification fire-and-advance · the cancellation mirror · the
compatibility mode (the non-matching definition + the flag-off
tenant) · the formula vocabulary · the unresolvable-assignee
fail-closed with ZERO RESIDUE). THE HONEST CATCHES disclosed at the
wave's README: the duplicate step.assigned emission · THE MID-CHAIN
ATOMICITY DESIGN CORRECTION (the thrown refusal rolled the step
approval back with the module's envelope — the design now RESOLVES
the mid-chain act, the module skips its transition; the refusal class
removed) · the trigger-entity → 036 entity-type mapping (the singular
registry members vs the plural 036 forms — the custom-field arm
silently read nothing; the explicit closed mapping landed) · the (k)
world leak (the cancellation-mirror definition seeded without its
manual_journal trigger matched every later PO — diagnosed by the dump,
the per-arm world law re-learned). The battery: the affected folders
9 files · 140 tests green (the workflow family + the inbox writer +
the standing category arm + the bound modules' own specs) + the whole
standing battery green (typecheck/lint 8/8 · unit 8/8 — 189 · 2,233 ·
depcruise clean 2,297 · 17,118 · ROUTE_PERMISSIONS 1,215 standing
(zero routes — the engine is service-layer, the routes land at W-47+)
· permissions 366 = 366 · i18n standing · docs 33/33 · id-ledger 0 +
self-test OK · history-secrets 0 with the SIX anchors · capabilities
agree · the shells + boundary PASS); the DB roster 316 → 317 (the
workflow-engine spec) — the full envelope at the new count is W-51's.
NOT production approval — تسليم لا قبول.]**

**[Dated 2026-11-27 (PHASE-052 W-45 DELEGATION + ESCALATION DELIVERED
— **ACCEPTANCE #3 GREEN + #4's ENFORCEMENT ARMS GREEN + #5 GREEN** at
the W-45 gate; steps 1–3 + the gate increment pushed at their own
commits under the standing order: step 1 `c88dba2` the delegation law
+ G-67's enforcement (the delegation service — the save-time
circularity over the DB's own clock, the scope pair law, the act-time
resolution; the engine's act path — assertNotSelfApproval with the
chain and BOTH endpoints, the actor law widened to the resolution
chain's terminal, the delegated_to provenance stamp) · step 2
`6831f12` the escalation engine (the settings key
`workflow.escalation_reminder_hours` — the typed registry row with the
fail-closed default [24]; the store's escalation plane — the breach
scan with the DB's own now() inside the SQL + the structurally-deduped
escalation_events insert; the EscalationService — the entitlement
gate, the cadence read, the NOTIFY row + the owner-target breach
notification + the bus emission, the REMINDER plane, the audit seal) ·
step 3 `c8c51f6` the sweep job (the `workflow-escalation-sweep` queue
at 05:45 UTC — the SEVENTH standing isolate; the per-tenant
catch-and-continue; the WorkflowModule registration) · the gate
increment the two DB specs + the exit battery. THE DELEGATION SPEC
(workflow-delegation-escalation.db.spec — 8 arms ALL GREEN, acceptance
#3's own proof + #4's enforcement arms): the act-time re-route (the
delegate's approval lands with acted_by + delegated_to = the delegate,
the assignee frozen) · the scope law (ALL covers everything · MODULE
accounting covers the journal · ENTITY purchase_order never re-routes
the journal step — the typed actor-law refusal with ZERO residue, the
assignee's own act still landing) · the expiry (the past-bounded
window stops routing by construction) · the save-time circularity (the
typed refusal naming the FULL closed chain finance → manager →
delegate → finance + the no-self floor + the scope pair law defended
typed) · G-67 DIRECT (the creator-assignee's own approval — the chain
of length one, BOTH endpoints himself, ZERO residue) · G-67 TRANSITIVE
(the routed-back chain manager → delegate → creator: EVERY act on the
step blocked — the creator's AND the manager's — the chain names BOTH
endpoints, ZERO residue) · the windows' own register (the early end
narrows the bounds, the row never deleted, the resolution stops). THE
SWEEP ISOLATE SPEC (workflow-escalation-sweep.db.spec — 9 arms ALL
GREEN, acceptance #5's own proof, THE SEVENTH standing isolate): the
empty pass (the seal lands even when nothing breached) · the breach →
the events (the NOTIFY row + the owner's warning notification + the
bus workflow.step.escalated emission; the reminder NOT yet at 2h vs
the 24h cadence) · the reminder cadence (the 25h breach: the REMINDER
row + the assignee's reminder at the per-member key) · the structural
dedupe convergence (the re-run inserts NOTHING — events and inbox
unchanged) · the clock law (the future due never breaches) · the
custom cadence [1, 2] (TWO per-member reminders — the recurring
surface) · the fail-closed garbage (the garbage row reads the
documented [24]) · the prefs gate (the owner's in-app off skips the
record, the rows still land, the run still seals) · the entitlement
gate (the escalation-flag-off tenant: NOTHING, NO SEAL). THE DECLARED
INTERPRETATIONS recorded at the claim sites: the action vocabulary's
honest boundary (the 0129 floor carries all four kinds; the sweep
emits NOTIFY + REMINDER only — REASSIGN/ADD_LEVEL need an
escalation-target/level configuration the 0127 step shape does not
carry; the engine never invents an assignee — widenings dated
additive) · the audiences (the NOTIFY breach → the tenant owner, the
escalation audience; the REMINDER family → the breached step's
assignee, the aging nudge) · the recurring surface (ONE REMINDER row
per step EVER — the due-date axis is fixed; the per-member inbox
family carries the cadence). The battery: the workflow family 4 · 73
ALL GREEN + the affected folders (the inbox writer + the cmms standing
category arm 2 · 40) + the whole standing battery green (typecheck/lint
8/8 · unit 8/8 — 189 · 2,233 · depcruise clean 2,302 · 17,165 ·
ROUTE_PERMISSIONS 1,215 standing (zero routes — the wave is
service-layer, the routes land at W-47+) · permissions 366 = 366 ·
i18n standing · docs 33/33 · id-ledger 0 + self-test OK (probe 7
stands at G-67/PHASE-052, claimant PHASE-053) · history-secrets 0 ·
7,889 allowlisted (the SIX tag anchors walked) · capabilities agree ·
the shells + boundary PASS); the DB roster 317 → 319 (the
delegation-escalation spec + the sweep isolate join the family) — the
full envelope at the new count is W-51's. The spec's own first REDs
disclosed at the wave's README: the identity plane's own floors
surfacing at the seeds (the users email lowercase CHECK · the roles
key shape ^[a-z][a-z0-9_]*$) + the (h) arm's raw instance seed needing
its own definition row (the composite FK's own floor). NOT production
approval — تسليم لا قبول.]**

**[Dated 2026-11-27 (PHASE-052 W-46 THE BRIDGE DELIVERED —
**ACCEPTANCE #9 GREEN** at the W-46 gate; step 1 + the gate increment
pushed at their own commits under the standing order: step 1 `545e1ca`
THE CONVERSION TOOL + THE COMPLETION-LAW FIX (the PolicyBridgeService —
D-12's four-mode mapping with the origin_policy_id back-reference, the
idempotence, the SUPERSEDED handling, the doc-type mapping, the
threshold canonicalization, the entitlement gate, the audit seal; the
engine's completedSteps — the bridge's approval_step parity figure;
the ChainVerdict widened; THE JOURNAL'S COMPLETION LAW — the W-44
fall-through's latent double-gate caught and corrected: the legacy
policy engine ran AFTER the chain completed — a two-step policy's
ladder demanding its own acts after the chain's two, an
amount-threshold policy REFUSING the very approval its branch pair
just granted; the corrected law: on the chain's completion the
module's own APPROVED transition lands DIRECTLY, approval_step carries
the chain's APPROVED step count, the legacy path runs only when NO
chain exists) · the gate increment THE BRIDGE DB SPEC + THE EXIT
BATTERY. THE BRIDGE SPEC (workflow-bridge.db.spec — 7 arms ALL GREEN
over real embedded PG16, the mode-per-tenant design, the REAL
JournalService's own acts on both sides): (a) THE SINGLE-APPROVER
PARITY (the same verdicts and stamps before/after — one act by the
owner, approval_step 1; the SoD parity — the owner's own journal
blocked both sides (the legacy SelfApprovalBlocked / the chain's
G-67); THE APPROVER-CLASS NARROWING disclosed — a third user the
legacy allowed, the converted chain refuses (the actor law — D-12's
owner-role mapping); the origin back-reference + the ROLE owner step
asserted) · (b) THE TWO-STEP PARITY (two acts before, two acts after —
NEVER four; approval_step 2 both sides — the completion law's own
proof) · (c) THE AMOUNT-THRESHOLD BRANCH PAIR (≤ threshold the
one-step chain with the branch's SKIPPED stamp · THE AT-LIMIT LAW (the
total exactly at the threshold → the one-step chain — the BR-034
boundary) · > threshold THE DECLARED MAPPING: the second approval
level instead of the legacy refusal (the BEFORE side's
ApprovalLimitExceeded disclosed as the honest delta) · the step-2
condition asserted verbatim) · (d) THE NONE MODE + THE SUPERSEDED +
THE UNMAPPED (the honest rows: NO_CHAIN_NEEDED · SUPERSEDED ·
UNMAPPED_DOC_TYPE; no definition lands; the none auto-approval
byte-identical) · (e) THE IN-FLIGHT COMPLETION (a document submitted
BEFORE the conversion finishes under the OLD semantics — zero
instances for it, the legacy two-step ladder carries it; a document
submitted AFTER gates under the chain — the launch-time boundary
recorded) · (f) THE ENTITLEMENT GATE (the engine-off tenant: the
bridge silent, the legacy path permanent) · (g) THE IDEMPOTENCE (the
re-run converts NOTHING — ALREADY_CONVERTED, no new definitions).
THE HONEST CATCHES disclosed at the wave's README: (1) THE W-44
FALL-THROUGH'S LATENT DOUBLE-GATE (above — caught at the bridge's own
design, corrected at step 1); (2) THE W-44 MODULE WIRING'S LATENT DI
BUG — THE EXPLICIT @Inject LAW: vitest's esbuild transform does NOT
emit constructor design:paramtypes, so the WorkflowModule's plain
typed constructor resolved `engine` and `escalation` to UNDEFINED
under the app-booting specs — bindWorkflowEngine(undefined) — the
gateway's null check passed (undefined !== null) and every journal
submit crashed on ENGINE.openChain; never exercised until the bridge's
affected-folder run paired the projects spec's AppModule boot with the
golden spec's journal submits; THE FIX: the explicit @Inject tokens
(the platform's own controller convention — metadata-free by
construction, immune in both worlds); the platform-wide latent class
DISCLOSED (the other sweep-registering modules with plain constructors
— fixed_assets · hr · trade — degrade silently under the same
transform: their registrations ride the catch-and-continue; a
candidate follow-up recorded, NOT this wave's scope); (3) the
journal's amount law re-learned at the spec (totalBaseAmount sums
EVERY line — DEBIT + CREDIT — the W-44 facts law verbatim; the
balanced pair at X per line reads 2X). The battery: the workflow
family 5 · 80 ALL GREEN (the bridge spec joins) + the accounting
affected specs 4 · 28 + the inbox writer + the standing category arm 2
· 40 + the whole standing battery green (typecheck/lint 8/8 · unit 8/8
— 189 · 2,233 · depcruise clean 2,304 · 17,187 (+2/+22 dated — the
bridge service + the spec; zero cycles) · ROUTE_PERMISSIONS 1,215
standing (the bridge is service-layer, the routes land at W-47+) ·
permissions 366 = 366 · i18n standing · docs 33/33 · id-ledger 0 +
self-test OK · history-secrets 0 with the SIX anchors · capabilities
agree · the shells + boundary PASS); the DB roster 319 → 320 (the
bridge spec joins the family) — the full envelope at the new count is
W-51's. NOT production approval — تسليم لا قبول.]**

**[Dated 2026-11-28 (PHASE-052 W-47 THE DEEP LINKS + THE TASKS + THE
RULES ALERTS DELIVERED — **ACCEPTANCE #6 GREEN** at the W-47 gate;
steps 1–2 + the gate increment pushed at their own commits under the
standing order «عند الانتهاء من أي خطوة ادفعها إلى المستودع»: step 1
`14dee97` THE DEEP-LINK LAW END-TO-END (T-06 — the deadline law at the
token fold's own home (the step's own due_at when the SLA set one,
else the 72-hour default window from the assignment — the invitation
precedent's span; the stateless law, never a stored TTL, never a token
table) · the routes' own 404 class (WorkflowStepInstanceNotFoundError
— the A7 parity, registered in the SAME increment as the routes) ·
the WorkflowDeepLinkService (the decode with ANY tamper/shape failure
the typed WORKFLOW_INPUT_INVALID · the claims' instance/step
consistency · the claims asserted USABLE against the DB'S OWN CLOCK
(readDbNow — the clock law) with the typed EXPIRED + ACTOR_MISMATCH
(the link authorizes, the session authenticates — never an
unauthenticated action surface) · the CAS PRE-CHECK (a stale token
never acts on a step the pointer has moved past) · the engine's own
act path VERBATIM) + THE LINK PREVIEW (the act page's own read) + the
email leg's tokens (the engine builds them at assignment; the leg
renders the locale-bound URLs) + the module's FIRST CONTROLLER (POST
/api/v1/workflow/act on workflow.approve + the SESSION_ROUTES preview)
+ ROUTE_PERMISSIONS 1,215 → 1,216 + the workflow error statuses in
error.filter.ts's domainStatus chain (404/403/409s — the CAS replay,
the EXPIRED deadline, the ladder, INV-037, G-67, the circularity; the
policy class the 422 fall-through) + the 041 template's deep links
(AR/EN, byte-stable)) · step 2 `5d35b4e` THE TASKS LANE + THE RULES
ALERTS (T-08 + T-07's rules half — the tasks ARE the step instances
(no seventh table, no crm coupling): the store's lane query (due-first
aging) + the TaskLaneService (the typed list through the ENGINE'S OWN
facts reader per row, bounded; the graceful tasks-plane gate; the
completion write-back = the step's own ACTED stamp through the
engine's act path with the TASK floors (the wrong-surface refusal, the
ladder law, the single-use completion) + the completion receipt) + the
tasks routes (SESSION_ROUTES +2, @RequireFeature(workflow.tasks)) ·
THE ALERT-RULES FOLD (the pure fail-closed normalizer — the envelope's
typed members normalized, the conditions passed VERBATIM (the D-06
fold the conditions' ONE validator), the garbage dropped one by one) +
the settings key workflow.alert_rules (the typed registry row, the
documented OPT-IN default []) + THE ADAPTER (the
workflow.instance.started BUS CONSUMER: the envelope law, the rules
read through the effective-setting reader, THE ENGINE'S OWN
assembleDocumentContext (exported this increment — never a parallel
evaluation path), the D-06 fold VERBATIM, the audiences owner|creator,
the per-rule-per-instance dedupe, the catch-and-continue — a failed
alert never blocks the chain; the drain() spec surface) + the module
wiring (the providers + the adapter's subscribe() at boot)) · the gate
increment THE DB SPEC + THE EXIT BATTERY. THE DEEPLINK-TASKS SPEC
(workflow-deeplink-tasks.db.spec — 17 arms ALL GREEN over real embedded
PG16, TENANT_WFX (engine + tasks + the alert-rules settings + the
owner user) + TENANT_WFX_GATE (engine only — the graceful-gate +
no-rules worlds), every arm its own world, the CAPTURING EMAIL LEG
carrying the exact tokens the 041 mail renders — the end-to-end: the
link the assignee receives is the link that works): (a) THE ONE-TIME
ACT + THE COMPLETION LANDING (the email's own approve token acts once
— the step APPROVED with acted_at/acted_by/comment, the chain
COMPLETED, the instance.completed bus emission; THE POST-COMPLETION
RE-ENTRY: the module's approve act after the deep-link completion (the
REAL JournalService) reads the completed-approved chain and lands the
document's APPROVED transition DIRECTLY — approval_step the chain's
count, the W-46 completion law extended to the beyond-module act
surfaces, the legacy policy path never re-gates a chain-approved
document) · (b) THE REPLAY REFUSAL (the same link again — the typed
WORKFLOW_STEP_ALREADY_ACTED, the CAS single-use, the acted_at stamp
the ledger) · (c) THE EXPIRY REFUSAL (a token past its claim's own
deadline — the typed WORKFLOW_TOKEN_EXPIRED, the DB's own clock) ·
(d) THE ACTOR MISMATCH (another user's session — the typed
WORKFLOW_TOKEN_ACTOR_MISMATCH, ZERO residue) · (e) THE TAMPER (a
forged signature — the typed input class, no partial parse) · (f) THE
REJECT LINK (the terminal REJECTED verdict + the frozen history) ·
(g) THE PREVIEW (the act page's own read — the rendering facts, the
awaiting flag, the claim's own deadline) · (h) THE TYPED LIST (the
caller's own PENDING TASK steps due-first; the other user's tasks
never in my lane; the doc facts per row) · (i) THE COMPLETION
WRITE-BACK (the step's own ACTED stamp, the chain completes, the lane
empties, the receipt lands) · (j) THE NON-TASK REFUSAL (an APPROVAL
step through the task surface — the typed wrong-surface refusal, ZERO
residue) · (k) THE ACTOR LAW (another user completing my task — the
engine's typed actor refusal, ZERO residue) · (l) THE GRACEFUL GATE
(the tasks-flag-off tenant's lane EMPTY — the chain itself lives) ·
(m) THE THRESHOLD ALERT (the configured amount rule above its
threshold raises the owner's inbox alert — the engine's own context
figure) · (n) THE BELOW-THRESHOLD SILENCE (no alert; the chain's own
assignment notification only) · (o) THE GARBAGE RULE SKIPPED (the
malformed rule never alerts, never crashes the chain open — exactly
one alert for the good rule) · (p) THE NO-RULES DEFAULT (the
settings-less tenant's chains raise NO alerts — the opt-in default [])
· (q) THE CREATOR AUDIENCE (the creator-audience rule alerts the
document's creator). THE HONEST CATCH caught at the spec's own design
and corrected IN THIS INCREMENT: THE STRANDED-ACT GAP — the deep-link
act completes the chain OUTSIDE the module's own act, leaving the
document awaiting with the legacy policy path as its only next step
(the W-46 double-gate resurfaced through the beyond-module act
surfaces); THE FIX: THE POST-COMPLETION RE-ENTRY at the gateway
(findCompletedApprovedInstanceForDocument — the latest COMPLETED
chain with no REJECTED step carries the verdict {chainOpened: true,
completed: true, completedSteps}; the module's next approve act lands
its transition DIRECTLY; the idempotence structural — a document
already transitioned is refused by the module's own state floors
before this read). The battery: THE SEVEN STANDING ISOLATES standalone
first (soak 1 · 1 · fcm 1 · 8 · email 1 · 5 · the cmms sweep 1 · 4 ·
the quality sweep 1 · 4 · the trade sweep 1 · 6 · the workflow
escalation sweep 1 · 9) + the workflow family 6 · 97 ALL GREEN (the
deeplink-tasks spec joins — 80 + 17) + the accounting affected specs 4
· 28 + the inbox writer + the standing category arm 2 · 40 + the whole
standing battery green (typecheck/lint 8/8 · unit 8/8 — 189 · 2,243
standing (+10: the deadline law's 3 + the template links' 2 + the
alert-rules fold's 5) · depcruise clean 2,311 · 17,243 (+5/+18 dated —
the deep-link service + the task-lane service + the alert adapter +
the alert-rules fold + the spec; zero cycles) · ROUTE_PERMISSIONS
1,215 → 1,216 (the act route) + SESSION_ROUTES +3 (the preview + the
tasks pair) · permissions 366 = 366 (zero new keys — the act binds
the existing workflow.approve, the tasks ride the self plane) · i18n
7,582 = 7,582 standing (no delta — the W-48 web plane's ~180 keys are
that wave's own) + mobile parity standing · manifests 13/13 · docs
33/33 · id-ledger 0 errors · history-secrets 0 violations (8,034
allowlisted hits — the window's shift) · capabilities agree · the
shells PASS · boundary-negative PASS); the DB roster 320 → 321 (the
deeplink-tasks spec joins chunk-a 132 → 133) — the full envelope at
the new count is W-51's. The mobile companion affordance stays
ONLINE-ONLY (the OFFLINE_CAPABILITIES_MATRIX row 16 law — the approve
act never queued, never faked offline). NOT production approval —
تسليم لا قبول.]**

**[Dated 2026-11-28 (PHASE-052 W-48 THE WEB PLANE DELIVERED —
**ACCEPTANCE #7 GREEN** at the W-48 gate; steps 1–4 + the gate
increment pushed at their own commits under the standing order «عند
الانتهاء من أي خطوة ادفعها إلى المستودع»: step 1 `3555bfc` THE API
SURFACE (the definition-input pure fold FIRST — the unit-first law,
18 spec arms: the mapping law (the event DERIVED, never sent), the
D-06 tree's save-time structural face naming every malformed node BY
PATH, the step ladder's floors (the three types ONLY · the four
assignee rules · the SLA whole-hours law · the 1..20 contiguous
ladder) + the store's editor reads/writes (the definitions + steps
REPLACED in one ambient transaction — an edit never touches a live
instance, the snapshots frozen; deactivation the path, never delete)
+ the inbox's pointer-step APPROVAL query with THE AGING FIGURES THE
DB'S OWN CLOCK COMPUTES (ageHours + overdue inside the SQL) + THE
DELEGATION LANE (the absent assignees' steps resolved through the
SAME resolveEffectiveActor the act path runs — the listed set IS the
actable set) + the WorkflowDefinitionsService (the fold first + the
audit seal + the duplicate-name typed wrap + the binding immutability)
+ the WorkflowApprovalInboxService (listMyApprovals · actOnStep — the
engine's own actOnCurrentStep VERBATIM · readTimeline — the ACTIVE
chain or the latest terminal one, the no-chain document the honest
instance-null read) + THE CONTROLLER +6 (ROUTE_PERMISSIONS 1,216 →
1,222, every key the 0130-seeded matrix §3.30 row: GET approvals on
workflow.inbox.act · POST approvals/:id/act on workflow.approve · GET
timeline on workflow.history.view · the definitions CRUD pair on
workflow.definitions.manage; the flags workflow.engine/
workflow.definitions per D-04)) · step 2 `6187fa9` THE WORKFLOW
SURFACES (the timeline component — PP-17's full step history VERBATIM
with the snapshot's own bilingual names + the actors' display names;
the approvals inbox board — the DATA-SLOT pane switch (never the Tabs
primitive, the 045 recall), the aging VERBATIM, the routed rows'
delegation marker, the quick actions through the engine's own act
path; the tasks lane pane (the completion write-back); the deep-link
act landing (the link authorizes, the session authenticates — the
dead link previews as the typed refusal, never a stale form) + the
three pages + the FALLBACK_CRUMBS + **i18n BY BOTH COUNTS 7,582 + 166
= 7,748 = 7,748** (the wave's whole declared delta) + the messages
helpers) · step 3 `65e7384` THE CHAIN EDITOR + THE NAV (the form-first
editor: the visual ordering (the up/down buttons rewrite the array —
the order is DATA, never a canvas), the conditions editor (the D-06
tree's structured face — the fold the ONE validator), the mapping law
(no triggerEvent key ever leaves the editor), the deactivation dialog;
NAV_ITEMS **+3** (workflow.approvals · workflow.tasks — the HOME
group, NAVIGATION_MODEL §1's own approvals-queue member ·
settings.workflows) + **THE HONEST +1** (trade.drawbacks — the fourth
bound surface's register, disclosed: the 051 web plane delivered the
drawback claims engine-only; the engine's own docDetailPath law points
the assignee at /trade/drawbacks?doc=…, so the row makes the workflow
plane's contract honest) + the ⌘K registration (OA-04 — the registry
IS the registration)) · step 4 `7d62c0b` THE TIMELINE EMBEDS + THE
FOURTH BOUND SURFACE (the journal detail embed — server-gated on
workflow.history.view, the section never renders without it; the PO
chain view (the rowAction + the ?doc= landing); the contracting CO
chain view (the rowAction + the ?doc= landing, independent of the
project selection); THE DRAWBACK CLAIMS BOARD — the 051 engine's own
register with the ladder chips + the create act (the honest nulls) +
the lifecycle acts (evidence · submit · review · approve · reject ·
pay) + the chain view). The gate increment: THE SEVEN STANDING
ISOLATES standalone FIRST (soak 1·1 · fcm 1·8 · email 1·5 · the cmms
sweep 1·4 · the quality sweep 1·4 · the trade sweep 1·6 · the workflow
escalation sweep 1·9) + the affected folders (the workflow family
6 · 97 · the accounting 4 · 28 · the inbox/cmms 2 · 40 · the
identity-flows 1 · 21 — the ROUTE_PERMISSIONS registry's own consumer)
+ the wave's own web suite (46 files · 269 tests ALL GREEN — the six
W-48 spec files' 31 arms among them) + the whole standing battery
(typecheck 8/8 · lint 8/8 · unit workspace 8/8 — 2,290 tests standing
(+47: the definition-input fold's 18 + the web plane's 29) ·
depcruise clean 2,332 · 17,413 (+21/+170 dated; zero cycles) ·
ROUTE_PERMISSIONS 1,216 → 1,222 + SESSION_ROUTES standing 32 ·
permissions drift 366 = 366 (zero new keys — all six routes bind the
0130-seeded rows) · **i18n 7,582 + 166 = 7,748 = 7,748 BY BOTH
COUNTS** + mobile 371 = 371 standing · manifests 13/13 · docs 33/33
(the ledger edits ride this increment) · id-ledger 0 errors + the
self-test all-probes OK (probe 7 stands at G-67/PHASE-052, claimant
PHASE-053) · history-secrets 0 violations (8,179 allowlisted hits —
the SIX tag anchors walked, all untouched) · capabilities agree · the
shells PASS · boundary-negative PASS); the DB roster standing at 321
(no new DB spec — the wave's specs are the web component specs + the
pure fold's unit spec) — the full envelope is W-51's. The mobile
companion affordance stays ONLINE-ONLY (the OFFLINE_CAPABILITIES_
MATRIX row 16 law). NOT production approval — تسليم لا قبول.]**


## Verification evidence requirements

Every acceptance item must be evidenced by at least one of: CI test names (linked),
command output in the completion report, screenshots for visual criteria (secondary —
data assertions are primary per directive §17), or runbook drill logs. Statements
without evidence do not count. A phase with failing or skipped critical tests is
`IN_PROGRESS` — never `COMPLETE`.
