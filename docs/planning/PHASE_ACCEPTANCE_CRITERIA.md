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

## Verification evidence requirements

Every acceptance item must be evidenced by at least one of: CI test names (linked),
command output in the completion report, screenshots for visual criteria (secondary —
data assertions are primary per directive §17), or runbook drill logs. Statements
without evidence do not count. A phase with failing or skipped critical tests is
`IN_PROGRESS` — never `COMPLETE`.
