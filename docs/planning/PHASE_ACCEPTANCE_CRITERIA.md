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

## Verification evidence requirements

Every acceptance item must be evidenced by at least one of: CI test names (linked),
command output in the completion report, screenshots for visual criteria (secondary —
data assertions are primary per directive §17), or runbook drill logs. Statements
without evidence do not count. A phase with failing or skipped critical tests is
`IN_PROGRESS` — never `COMPLETE`.
