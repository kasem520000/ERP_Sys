# PHASE-021 — Desktop Application

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-021
- **Title:** Desktop Application
- **Objective:** Ship the Windows-first desktop client as a **Tauri v2 shell** around the
  existing web ERP build ([ADR-0013](../../architecture/ADR/ADR-0013-tauri-desktop.md)):
  the static-exported `apps/web` UI rendered in the OS webview, with Rust-side plugins
  for local SQLite (SQLCipher) consumed through the PHASE-020 `packages/sync-core`
  client, OS-keychain credential storage, a **signed auto-update channel with staged
  rollout**, crash recovery that preserves the outbox (WAL), receipt/printer
  integration points, and WebView2 minimum-version enforcement with graceful
  degradation. Offline behavior is exactly the desktop column of the
  [OFFLINE_CAPABILITIES_MATRIX](../../offline/OFFLINE_CAPABILITIES_MATRIX.md):
  cached read models + OFFLINE-DRAFT creation where the matrix allows — never a
  disconnected back office.
- **Business value:** owners and accountants get a native-feeling Windows app for old
  shop PCs (small bundles, low RAM — the reason Tauri beat Electron), businesses keep
  working through connectivity drops, and platform operations gain a controlled client
  release channel (signed updates, crash-rate-gated rollout) instead of unmanaged
  installs (RISK-017).

## 2. Scope

In scope:

1. **Tauri v2 shell** per ADR-0013: `apps/desktop` (placeholder since PHASE-001) becomes
   the Tauri project wrapping the `apps/web` **static export** build target; the web
   bundle must not depend on Next.js server features at runtime for offline screens
   (ADR-0013 consequence — a build-target check is part of CI). Rust code stays confined
   to plugins; app logic remains TypeScript in `packages/sync-core` + the web UI.
2. **Local SQLite store** per [LOCAL_DATABASE.md](../../offline/LOCAL_DATABASE.md):
   SQLCipher via the Tauri SQL plugin (or a `better-sqlite3` sidecar over a SQLCipher
   build) using the desktop mirrored subset (§1.1: broad read cache of the user's
   modules + the matrix's desktop write set); the shared `sync-core` schema/migrations
   apply at app start in a transaction; WAL mandatory; integrity check + the §6.4
   corruption path (stage outbox/inbox → reset → re-import → full pull).
3. **Sync integration**: the shell hosts the PHASE-020 sync client unmodified —
   device registration (`tauri-desktop` platform), scoped credentials, pull→push→ack
   cycles with desktop triggers (app start/unlock, OS connectivity signal debounced 5 s,
   periodic 2 min when dirty, push-only fast cycle after local writes, manual "sync
   now" — [SYNC_PROTOCOL.md](../../offline/SYNC_PROTOCOL.md) §8).
4. **Credential storage**: OS keychain (Windows Credential Manager via Tauri plugin)
   holds the device refresh token, the device private key, and the SQLite encryption
   key; access tokens live in memory only; **no secrets in SQLite, logs, or preferences**
   ([SECURITY_AND_DEVICE_MANAGEMENT.md](../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md) §3).
5. **Offline behavior** (desktop matrix column): READ-CACHED reads with as-of-cursor
   labels; OFFLINE-DRAFT creation for sales invoice draft, quotation draft, delivery
   note, stock transfer draft, expense entry, cash transfer/drawer drop draft, partner
   contact edits (field-merge), partner create, stock count lines (matrix rows 6, 7,
   10, 11, 21, 23, 25, 26, 34); ONLINE-ONLY operations disabled with the "requires
   connection" reason (rows 15–20, 22, 24, 30, 36 — no simulated queuing); honest local
   states (`DRAFT_LOCAL`, `PENDING_MERGE`, `SYNC_FAILED`) rendered distinctly; offline
   login = app unlock against the cached permission snapshot, degrading to
   read-only + online-required after the 7-day watermark (§5).
6. **Contract-version gate**: server `CONTRACT_VERSION_UNSUPPORTED` → read-only sync
   mode + update prompt; stale-server → refuse local writes rather than fabricate
   compatibility (LOCAL_DATABASE §2.3).
7. **Auto-update channel**: Tauri updater with **signed bundles**; update-signing keys
   are S-15 in [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) (rotation =
   a client-update event with a dual-trust window, then minimum-version force-update);
   **staged rollout 10% → 50% → 100% with crash-rate gates** reading the client-stability
   dashboard ([RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md) §Rollout,
   [MONITORING.md](../../operations/MONITORING.md) §1); updater manifests hosted per
   [DEPLOYMENT_ARCHITECTURE.md](../../architecture/DEPLOYMENT_ARCHITECTURE.md) client
   distribution; server deploys precede client announcements
   ([DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7).
8. **Crash recovery & reporting**: WAL roll-forward + `IN_FLIGHT → QUEUED` on every
   start (sync-core recovery sequence); crash reporting to the error tracker with
   tenant tag + redaction ([FAILURE_RECOVERY.md](../../offline/FAILURE_RECOVERY.md) §3);
   crash-free sessions feed the rollout gates.
9. **Receipt/printer integration points**: OS print APIs + raw ESC-POS via plugin for
   80/58 mm receipt templates where the tenant uses the desktop as a POS back office
   (reprint of already-POSTED documents offline from local cache — matrix row 32);
   scanner/scale keyboard-wedge input where needed (device-side per
   [integrations/README.md](../../api/integrations/README.md) §3.9 — no server
   round-trip in the scanning hot path).
10. **WebView2 minimum-version enforcement**: startup capability probe of the installed
    WebView2 runtime; below minimum → clear system-requirements message + installer
    guidance; degraded-capability notices for older-but-supported runtimes (graceful
    degradation, ADR-0013; RISK-017).
11. **Release engineering**: Windows code signing + updater signing in CI, bundle
    artifact pipeline, version stamping per CalVer release tags, SBOM for the desktop
    bundle, and updater-hosting runbook entries.
12. **macOS/Linux**: deferred — a decision record is required to schedule either
    platform (ADR-0013 platform order); this phase ships Windows only and notes the
    deferral explicitly in user-facing documentation.

Out of scope (explicit):

- Android (PHASE-022) and any mobile-specific work.
- New offline capabilities beyond the matrix's desktop column — no offline posting,
  approvals, period operations, journal entries, admin actions, or reports (rows
  15–20, 30; reports stay ONLINE-ONLY per
  [REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md)).
- Web offline writes (the browser app remains online-only — OFFLINE_ARCHITECTURE §6).
- Changes to the sync protocol itself: wire contracts are frozen by PHASE-020; any need
  routes through a decision record, not this phase.
- POS terminal provisioning flows beyond what PHASE-016 already ships (the desktop
  shell may host the POS experience, but terminal registry semantics are unchanged).

## 3. Prerequisites

- Required phases: **PHASE-020 — Offline Synchronization Foundation** COMPLETE
  (verified via its completion report + green CI): `packages/sync-core` v1, the
  reference local store, device registry, pull/push contracts, conflict policies, and
  the chaos matrix must be green — the desktop app is a consumer, not a protocol
  author. PHASE-016's POS terminal must interoperate with this shell where tenants run
  POS on desktop hardware.
- Required architecture decisions:
  [ADR-0013](../../architecture/ADR/ADR-0013-tauri-desktop.md) (Tauri v2, web UI reuse,
  Windows first, WebView2 as a system requirement),
  [ADR-0012](../../architecture/ADR/ADR-0012-offline-sync.md) (local store + sync),
  [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md) (device tokens),
  [ADR-0002](../../architecture/ADR/ADR-0002-typescript-monorepo.md) (shared TS
  packages), [ADR-0016](../../architecture/ADR/ADR-0016-ui-tailwind-radix.md) (the UI
  build being wrapped).
- Relevant documentation:
  [OFFLINE_ARCHITECTURE.md](../../offline/OFFLINE_ARCHITECTURE.md) §4/§6 (device
  classes, local stack), [LOCAL_DATABASE.md](../../offline/LOCAL_DATABASE.md) (desktop
  subset, encryption, recovery), [SYNC_PROTOCOL.md](../../offline/SYNC_PROTOCOL.md)
  (triggers, budgets), [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (desktop column), [CONFLICT_RESOLUTION.md](../../offline/CONFLICT_RESOLUTION.md)
  (rejection UX contract §3 — the shell must implement the mapping exactly),
  [SECURITY_AND_DEVICE_MANAGEMENT.md](../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md)
  (keychain, snapshot watermark, lost-device purge),
  [SYNC_TESTS.md](../../testing/SYNC_TESTS.md) §7 (PHASE-021 gate),
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §10 (D-02, D-06),
  [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md) / [RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md)
  (inherited from the wrapped UI), [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md),
  [USER_JOURNEYS.md](../../product/USER_JOURNEYS.md) (Journey B offline day).

## 4. Design Impact

- **Database changes:** none server-side (no new tables; device rows gain
  `tauri-desktop` platform instances). Local SQLite gains the desktop-subset tables +
  `sync-core` machinery only; any mirrored-subset change is a local migration mapped to
  a contract version (cursor reset when a cached column's meaning changes).
- **API changes:** none (consumes PHASE-020 endpoints verbatim). The web build gains a
  Tauri **static-export target** and a thin bridge interface for plugin capabilities
  (keychain, SQL, updater, printer) so the same UI runs in browser and shell.
- **UI changes:** the existing app shell/archetypes render unchanged; capability-gated
  affordances change behavior in the shell: offline badges ("غير متصل — سيتم
  المزامنة"), as-of labels on cached reads, ONLINE-ONLY actions disabled with reasons,
  the sync-now control, rejection-resolution actions per CONFLICT_RESOLUTION §3
  (edit-and-resend / accept server price / review-and-merge / discard / cancel),
  update-prompt UI, and WebView2 requirement screens.
- **Security & authorization:** device tokens in OS keychain; SQLite encrypted
  (SQLCipher) with the key in the keychain — the DB file must be unreadable without it
  (D-02 binary inspection); permission snapshot gates UI only, server stays final;
  logs redacted (no credentials echoed); update signature verification is a security
  boundary (D-06: unsigned/old updates rejected); screenshots/credential echo avoided
  on financial screens.
- **Accounting implications:** none new — drafts created offline enter the existing
  DRAFT lifecycle at sync; posting/approval remain online-only; INV-013/INV-011
  guarantee exactly-once, period-correct effects at push time; official numbers only
  ever appear via ACCEPTED results.
- **Localization implications:** all shell-added strings (update prompts, offline
  badges, printer dialogs, requirement screens) ship AR+EN with RTL-correct layout
  ([RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md)); receipt templates reuse the
  bilingual print templates from PHASE-013/016.
- **Offline implications:** delivers the desktop column of the capabilities matrix;
  LRU pruning within the 1 GB desktop budget; pull/push bandwidth budgets scale up on
  LAN/Wi-Fi; drafts are owner-device-wins — other devices see them read-only after
  first sync.
- **Module dependencies:** `apps/desktop` (Tauri) depends on `apps/web` (build target),
  `packages/sync-core`, `packages/contracts`, `packages/ui`; NO new API module; the
  sync module's contracts are consumed, not modified
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) `sync` row).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Tauri v2 project scaffold in `apps/desktop` + web static-export build target + runtime guard (no server-only features in offline screens) | `apps/desktop/**`, `apps/web/next.config.*` export mode | build produces the export; guard test fails on server-feature import in shell-only routes |
| T2 | SQL plugin wiring: SQLCipher DB, keychain-held key, `sync-core` schema + forward-only migrations at start, WAL + integrity check + corruption path | `apps/desktop/src-tauri/plugins/sql/**`, `packages/sync-core` adapter | D-02 encryption-at-rest inspection; migration-in-transaction test; corruption drill script |
| T3 | Device registration + credential lifecycle in the shell: keypair in keychain, attestation-lite, refresh rotation, unlock flow against cached permission snapshot (7-day watermark degrade) | `apps/desktop/src/auth/**` | registration E2E; watermark-degrade test (D-04); revoked-device UX |
| T4 | Sync runtime hosting: cycle triggers (start/unlock, connectivity, 2-min periodic, post-write fast push, manual), retry scheduler, contract-version gate + read-only mode | `apps/desktop/src/sync/**` (thin host over `packages/sync-core`) | unit tests on host wiring; C-08 auto-update path with real signed updates |
| T5 | Offline-capable UI affordances: offline badges, as-of labels, ONLINE-ONLY disabling with reasons, draft flows for the matrix's desktop rows, honest-state badges | `apps/web` capability-gated components (shared) | component + E2E tests AR/EN; matrix cross-check script output |
| T6 | Rejection UX: CONFLICT_RESOLUTION §3 mapping (edit-and-resend, accept server price, review-and-merge diff view, discard, cancel) with audit-logged user choices | `apps/web` reconciliation components | per-code action tests; every choice writes audit event with rejecting `traceId` |
| T7 | Keychain plugin: refresh token, device private key, SQLite key storage; memory-only access tokens | `apps/desktop/src-tauri/plugins/keychain/**` | secret-scan of DB/logs artifacts; rotation drill script |
| T8 | Auto-update: Tauri updater with signed bundles, staged rollout manifest service (10%→50%→100%), crash-rate gate integration, minimum-version enforcement | `apps/desktop/src-tauri/updater/**`, `deploy/updater/**` | D-06 unsigned/old-update rejection; downgrade attack test; staged-gate simulation |
| T9 | Crash reporting + recovery: error-tracker wiring (tenant tag, redaction), crash-free session metric, WAL/outbox preservation across forced kills | `apps/desktop/src/telemetry/**` | kill-matrix test: crash at every sync step → outbox intact, resume clean |
| T10 | Printer/receipt integration: OS print + raw ESC-POS plugin for 80/58 mm templates, reprint-from-cache (row 32), printer capability probe | `apps/desktop/src-tauri/plugins/print/**` | printed-output fixture tests (template parity with PHASE-013/016); reprint never re-numbers |
| T11 | WebView2 runtime probe: minimum-version enforcement, install guidance, degraded-capability notices | `apps/desktop/src/system/**` | probe matrix against runtime versions incl. below-minimum |
| T12 | Release engineering: Windows signing + updater signing in CI, artifact + SBOM pipeline, CalVer stamping, updater-hosting runbook | `.github/workflows/desktop-release.yml`, `deploy/**` | CI produces signed, verifiable bundle; SBOM attached; tamper check fails unsigned build |
| T13 | Chaos integration on desktop harness: full matrix against the Tauri shell local store (better-sqlite3 + SQLCipher profile) | `tests/sync-chaos/**` (desktop profile) | SYNC_TESTS §7 PHASE-021 slice green (C-01…C-16 incl. C-08 with signed updates) |
| T14 | Offline scenario smoke (E2E): offline login/unlock → cached reads → draft create → reconnect → sync → rejection resolution path | `tests/e2e/desktop-offline.spec.ts` | scripted outage journey green AR+EN |
| T15 | Docs: desktop quickstart, system requirements (WebView2), updater/rollout runbook, FEATURE_CATALOG `offline.desktop_app` status | `docs/operations/**`, `docs/product/**` | docs validation green |

## 6. Verification

**Automated tests (required):**

- **Full sync chaos matrix against the desktop harness**
  ([SYNC_TESTS.md](../../testing/SYNC_TESTS.md) §5 device matrix, §7 PHASE-021 row):
  better-sqlite3 + SQLCipher local store; **C-08 with real signed updates** (contract
  downgrade → 422 → update flow → clean resume, no data corruption); crash windows
  (C-04) driven through real process kills of the shell.
- Updater security tests (D-06): unsigned bundle rejected; older-version downgrade
  rejected; tampered manifest rejected; minimum-version enforcement forces update.
- Packaging pipeline tests: CI-built bundle signature verifies; SBOM present; static
  export contains no server-runtime dependency; gitleaks clean on artifacts.
- D-02 (SQLite unreadable without keychain key), D-04 (snapshot watermark degrade),
  D-01 (revocation → immediate stop, queued data wiped on next contact).
- UI: component + E2E tests for every desktop matrix row implemented (draft flows,
  ONLINE-ONLY disabling, as-of labels), AR and EN.

**Manual verification:**

1. Install on a clean Windows machine with (a) current WebView2, (b) below-minimum
   WebView2 → verify guidance path; run the quickstart cold.
2. Pull the network cable mid-session: create an invoice draft, a quotation draft, edit
   a partner phone; verify honest states and as-of labels; restore network → verify
   sync cycle completes and drafts reach server `DRAFT` state.
3. Seed a `PRICE_CHANGED` rejection: verify the accept-server-price / edit / cancel
   actions and the audit trail of the choice.
4. Publish a signed update to the staging channel; verify staged percentages, crash
   gate behavior, and that a revoked/rolled-back channel cannot serve old bundles.
5. Kill the app repeatedly during push cycles; verify outbox preservation and clean
   resume (WAL + `IN_FLIGHT → QUEUED`).

**Acceptance criteria (objective):**

1. The signed Windows installer boots the full web ERP in the shell from the static
   export; bundle size and memory footprint recorded in the report against the
   ADR-0013 rationale (~10–20 MB class).
2. Offline login/unlock works against the cached permission snapshot; after the 7-day
   watermark the app is read-only + online-required for writes (test evidence).
3. Every desktop-column matrix cell implemented in this phase matches its class
   (READ-CACHED / OFFLINE-DRAFT / ONLINE-ONLY) — cross-check output quoted row-by-row;
   no ONLINE-ONLY row is queued or simulated.
4. All OFFLINE-DRAFT rows sync through `sync-core` with owner-device-wins semantics;
   non-owner edit attempts are read-only in the UI and rejected server-side.
5. Rejection UX implements the CONFLICT_RESOLUTION §3 table exactly; every user choice
   is audit-logged with the rejecting response's `traceId`.
6. Local DB is SQLCipher-encrypted; key, refresh token, and device key exist ONLY in
   the OS keychain (binary + artifact inspection evidence).
7. Auto-update: signed bundles only; staged rollout 10%→50%→100% with crash-rate gates
   reading the client-stability dashboard; downgrade and unsigned-update attacks fail
   closed (D-06 green).
8. Full chaos matrix green on the desktop harness incl. real signed-update path; the
   suite remains blocking in CI after this phase.
9. Crash recovery: forced kills at any sync step lose no outbox command and re-converge
   without operator intervention (kill-matrix output).
10. WebView2 below-minimum produces the system-requirements path (no crash, no broken
    UI); supported-but-older runtimes get degradation notices.
11. Receipt printing from local cache reprints POSTED documents without re-creating or
    re-numbering anything (row 32 rule).
12. Docs updated: quickstart + system requirements + updater runbook +
    FEATURE_CATALOG `offline.desktop_app` → implemented; docs validation green;
    criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

**Performance & security considerations:** shell startup ≤ T-06-class budget (recorded);
T-03 reprint/scan paths stay local (no network in the hot path); crash-free sessions
feed rollout gates; S-15 update-signing key handling per
[SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) §3 (rotation = dual-trust
app update then minimum-version push); no secrets in logs/telemetry (redaction verified).

**Migration & rollback:** local SQLite migrations are forward-only and contract-mapped
(`sync-core`); semantic changes trigger cursor resets (full re-pull of the entity).
App rollback = previous signed bundle via the updater channel; server-side no migrations
ship in this phase; a bad client release is contained by halting the staged rollout
(automatic on crash-gate breach) and force-updating via minimum-version enforcement.

## 7. Risks and Constraints

- **RISK-017** (Tauri/WebView2 on old shop PCs): mitigated by the runtime probe,
  minimum-version enforcement + installer guidance, and the documented Electron
  fallback (ADR-0013 revisit trigger) — pilot install failures are the escalation
  trigger.
- **RISK-011** (sync double-posting) must stay dead on the desktop surface: the shell
  consumes `sync-core` unmodified; any local patch to sync behavior is a review
  blocker.
- **RISK-015** (RTL/UX edge cases): the shell reuses the web UI, so RTL correctness is
  inherited — but shell-added chrome (update prompts, printer dialogs) must pass the
  bilingual snapshot gates.
- Supply-chain risk on the updater path: signing keys are the crown jewel (S-15);
  compromise = malicious updates (THREAT_MODEL S-13 class) — signing occurs only in CI
  with store-backed keys, never on developer machines.
- Constraint: **Windows only** — macOS/Linux require a decision record; do not
  "scaffold them while here" (scope discipline).
- Constraint: the sync protocol is frozen (PHASE-020); protocol-shaped problems found
  here are documented + decided, not patched in the client.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-021-COMPLETION.md` with: signed-artifact
  verification output, updater attack/downgrade test results, chaos-matrix CI output on
  the desktop profile, crash kill-matrix output, matrix row-by-row cross-check, memory/
  bundle-size measurements, WebView2 probe matrix, offline smoke journey transcript
  (AR+EN), docs validation output.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-021 →
  COMPLETE), `docs/handoff/CURRENT_STATE.md`, `docs/handoff/CHANGELOG.md`, desktop
  quickstart + system requirements in
  [DEVELOPMENT_SETUP.md](../../operations/DEVELOPMENT_SETUP.md), updater/rollout
  runbook entries in [DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7 and
  [TROUBLESHOOTING.md](../../operations/TROUBLESHOOTING.md), FEATURE_CATALOG
  `offline.desktop_app` status.
- **Exit criteria:** all acceptance criteria green with evidence; chaos suite green on
  the desktop harness; staged rollout exercised in staging with crash gates observed;
  docs synchronized; zero TODOs.
- **Definition of Done:** signed installable Windows app in `main`; updater channel
  operational in staging; offline desktop journey passes end-to-end; client-stability
  dashboard panels live; IMPLEMENTATION_STATUS updated with `phase/021` tag.
- **Handoff instructions:** the desktop column of the capabilities matrix is now
  implemented — treat any new offline capability as a matrix change (decision record +
  same-phase local migration, matrix §5 rules). The Android team reuses `sync-core`
  untouched and ports design tokens, not sync code. **Next eligible phase: PHASE-022 —
  Android Application** (or PHASE-023 if already complete — both depend only on
  PHASE-020). Identify only; do not implement.
