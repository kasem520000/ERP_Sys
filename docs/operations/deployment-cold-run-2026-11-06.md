# Deployment Runbook Cold Validation — 2026-11-06 (PHASE-025 T8)

> **Status:** EXECUTED (cold run — written runbook only, code/docs verified against it) ·
> **Owner:** Platform Operations · **Date:** 2026-11-06 · **Phase:**
> [PHASE-025](../implementation/phases/PHASE-025.md) §2 item 6 / §5 T8 · **Runbook
> validated:** [DEPLOYMENT.md](DEPLOYMENT.md) §1–§7

**Engineer:** AI coding agent #2 (PHASE-025 session — the DR-C session; NOT the author of
the §7 per-phase additions it validated, which were written by the PHASE-020…024 sessions
— the second-engineer property holds at the session level, honestly stated). **Method:**
walk DEPLOYMENT.md top to bottom against the repository state; every claim that is
code-checkable was checked in code; every claim that needs the hosting layer is marked
hosted with its evidence slot. Wall time ≈ 90 min (agent session, honestly approximate,
interleaved with the DR tabletop/rehearsal authoring).

**Result: PASS with fixes applied.** The runbook is now walkable cold end-to-end; the
walk found **three code-drift bugs in the §2 smoke block** (routes/paths that do not
match the implementation), one §6 wording drift, one command-convention ambiguity, and
one cross-doc template-reference error — all fixed in DEPLOYMENT.md (edit list in §8);
the remaining gaps are hosted legs recorded with owners (§9).

## 1. Pre-flight checklist (§1) — row-by-row checkability

| Row | Check | Cold-run verdict |
|-----|-------|------------------|
| 1 | CI green on the release tag | **Hosted** — the workflows exist in-repo (`ci.yml`, `ci-db.yml`, `ci-visual.yml`, `desktop-release.yml`, `mobile-release.yml`); the run link is CI-side evidence |
| 2 | Migration rehearsal on staging ≤ 7 days, same migration set | **Hosted cadence, in-repo evidence basis**: [CI_CD.md](CI_CD.md) §5 step 2 (the staging migration job doubles as the rehearsal) + the standing local proof that the chain applies cleanly on a fresh instance: every db-suite boot fresh-applies **0001→0036** (`apps/api/src/__db__/global-setup.ts` — `drizzle-kit migrate` on a virgin embedded PostgreSQL 16) and the Testcontainers runner (`scripts/ci/migration-tests.ts`) applies the same files in CI |
| 3 | Backups fresh (dump < 24 h, restore-smoke green, PITR window healthy) | **Provable in-sandbox as drill evidence, hosted as cadence**: [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §2–3 define the checks; the §8 log carries the drills (2026-11-01 PASSED; the 2026-11-06 rows ORCH-FILL); the nightly cadence + PITR window are provider-side |
| 4 | Rollback image identified + rollback job dry-verified | **Hosted deploy state** — `PREV=$(<deploy/previous_release_tag)` reads a file written at each deploy (§2 step 0 "recorded in ticket"); it is not in-repo (see §4 below) |
| 5 | Release checklist complete | Checkable against [../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md) §Quality gates per release (the section exists — verified) |
| 6 | Comms drafted (AR/EN) | **Hosted** (deploy ticket); the AR/EN templates for the incident-adjacent paths exist in [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) §3 |
| 7 | On-call informed; deploy inside announced window | **Hosted** (ops channel) |
| 8 | Contract-step migrations in this release? | **Checkable in-repo**: the expand-migrate-contract markers live in migration headers — verified `0009_partners_items.sql` ("Deliberate expand-migrate-contract step (MIGRATION_STRATEGY §3 …)") completed by `0011_journal_tables.sql`; PHASE-025 ships **no new migrations** (phase §4: tuning only), so the GA release manifest review is a no-op pass |
| — | **NEW (PHASE-025 §7 addition)** | DR/restore freshness leg — quarterly drill within window + attestation current + the release's restore-rehearsal record links; written into §7 with this cold run (see §7 below) |

## 2. Deploy sequence (§2) — steps + health gates verified in code

- **Step 2 is the gate**: `docker compose … run --rm migrate`; non-zero exit = abort,
  not rollback — consistent with §3 abort criteria 1 and the `MigrationFailed` Sev-1
  alert ([MONITORING.md](MONITORING.md) §3).
- **Health gates exist in code** — `apps/api/src/health/health.controller.ts`:
  `GET /health/live` (process up; payload `status`/`service`/`version`/`timestamp`) and
  `GET /health/ready` → `ReadinessService.check()` with **`checks[]` = exactly three
  items — `db`** (SELECT 1 round-trip), **`migrations`** (`erp.schema_version()` must
  equal the build's `MIGRATIONS.length` — currently 36, i.e. 0001→0036),
  **`queue`** (pg-boss liveness); 503 with the per-check report when anything is down
  (partial-failure detail, never secrets) — matches MONITORING §2's contract row.
- **Smoke block — three code-drift bugs found cold and FIXED** (the walk's main value):
  1. **(a) health path**: the doc probed `https://<host>/api/health/live` — but the api
     serves health at the **service root** (`@Controller("health")` → `/health/live`,
     `/health/ready`; the controller spec asserts exactly that), while business routes
     carry `/api/v1/...` **in-path** (e.g. `@Controller("api/v1/sales")`) — so a blanket
     `/api` strip is impossible and the documented public path 404s. Fixed to the
     node-level verifiable path + a note that the LB public probe mapping is a hosting
     routing item recorded at provisioning.
  2. **(b) login route**: `POST /api/v1/auth/login` **does not exist** — the
     session-creating route is **`POST /api/v1/identity/sessions`** (verified in
     `PUBLIC_ROUTES` + `sessions.controller.ts`, login schema `{email, password}`).
     Fixed.
  3. **(c) invoice-draft route + body + auth header**: `POST /api/v1/sales/invoices`
     does not exist — the route is **`POST /api/v1/sales/sales-invoices`**
     (`@Post("sales-invoices")` under `@Controller("/api/v1/sales")`); the minimum body
     per `createInvoiceSchema` is `branchId, customerId, kind CASH|CREDIT, invoiceDate,
     currencyCode, exchangeRate, lines[≥1]` (the doc's `{"branch_id","kind"}` shape
     would 400); and the API never takes client tenant claims (S-03) — the session
     carries the tenant scope, presented as **`x-session-token`** (not
     `authorization: Bearer` + `x-tenant-id`). Fixed.
  - (d) web RTL smoke: correct as written.
- **Step 6 queue verification** (`boss.job` states via `erp_readonly`) is hosted
  (compose `postgres` service) — consistent with the convention note.

## 3. Abort criteria (§3) — the migration-failed Sev-1 path is wired

- The four abort criteria are precise and checkable (non-zero exit; time budget; lock
  waits via `pg_stat_activity`; readiness flaps).
- **`MigrationFailed` is a MONITORING §3 alert row** (Sev-1, runbook → DEPLOYMENT §3,
  "Page deploy on-call — deploy is aborted") — verified present, and the observability
  audit confirms the wiring: `pnpm check:observability` run during this cold walk →
  **"alert catalog: 19/19 rows fully linked + section-verified"** (every alert's runbook
  link target + §ref resolves — including this row).

## 4. Rollback workflow (§4) — walked against repo state

- The split is sound: behavioral regression → app-level rollback ([CI_CD.md](CI_CD.md) §7
  — `workflow_dispatch` with `environment`/`image_tag`, registry-verified previous tag,
  **no migrations run**, health gates + smoke as normal deploy, contract steps never in
  the serving release); data-integrity problem → incident + §5.
- **Rollback image identification** requires `deploy/previous_release_tag` + the deploy
  ticket (§1 row 4, §2 step 0) — a **hosted deploy-state file, not in-repo** (`deploy/`
  holds the updater channel layout only). Honest assessment: the mechanism is coherent
  (each deploy writes it back), but a cold runner cannot verify it today — recorded as
  gap R1 (§9); the command-convention note now states plainly that `compose.prod.yml`
  (and, by the same logic, the deploy-state files) are provisioned at hosting setup.
- Expand-contract discipline (§3) verified against the migration headers (see §1 row 8).

## 5. Bad-migration decision tree (§5)

- Present (mermaid) and **does** point at the owning procedure: the `P` node → "follow
  PITR procedure BACKUP_RESTORE_RUNBOOK.md §5" — verified that §5 is indeed "Restore
  procedure A — logical corruption (PITR to timestamp)".
- **Cross-doc drift found cold**: the tree's `CUTOVER` node cited
  "DISASTER_RECOVERY.md §4" for tenant notices — the comms plan + AR/EN templates are
  **§3** (§4 is WORM dependencies). Fixed (same fix applied in
  [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §5 step 9 — found in the DR
  tabletop walk, G10).

## 6. First-deploy bootstrap (§6) — role model verified

- `0001_core_infra.sql` creates `erp_migrate` / `erp_app` / `erp_readonly` (idempotent
  `DO $$ … IF NOT EXISTS …` block — verified) and from `0002` on only `erp_migrate`
  semantics apply (per [../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md)
  §1).
- **Wording drift found cold and FIXED**: §6 step 2 claimed 0001 creates the roles "with
  passwords from the secret store" — the migration header says the opposite
  ("**Passwords are deliberately NOT set here** … production assigns passwords
  out-of-band"), and `scripts/db-dev-credentials.ts` is the dev/test leg (verified:
  sets the documented dev values via `ALTER ROLE … PASSWORD`, **fail-closed under
  `NODE_ENV=production`**). §6 step 2 now states the out-of-band password rule + the
  dev-credentials script.
- Steps 4–8 (seeds, object storage with WORM, SMTP, platform-admin bootstrap, verify incl.
  the RLS sanity check) are hosting/provisioning legs with precise in-repo contracts
  (e.g. the RLS check mirrors the drill's check b).

## 7. Per-phase additions (§7) — verified, then extended

Each listed addition verified present in DEPLOYMENT.md §7 with its live date:

- **PHASE-020** — quote-basis: "`change_log` growth monitoring added to pre-flight …
  (a) the `sync.feed.health` probe (5-min job) is green … (b) the
  `ix_change_log_tenant_entity_seq` index is present and used … (c) table size trend
  reviewed vs the `StorageGrowth` alert" — **verified** (row LIVE 2026-11-04).
- **PHASE-021** — quote-basis: "**Server deploys precede client announcements** — never
  announce a desktop build before the API it talks to is deployed … Staged rollout
  10%→50%→100% with crash gates … halt below 98.5% ⇒ publish `minVersion` =
  last-known-good" — **verified** (row LIVE 2026-11-04).
- **PHASE-022** — quote-basis: "The Android release channel is the Play Store + the EAS
  pipeline — `mobile-release.yml` (tag `v*`) runs every pnpm-level gate … **unsigned =
  internal channel only, never GA**" — **verified** (row LIVE 2026-11-05; the workflow
  file exists in `.github/workflows/mobile-release.yml`).
- **PHASE-023** — quote-basis: "E-invoicing certificates provisioned per
  SECRETS_MANAGEMENT §6 **before** adapter enablement — the service-enforced gate
  refuses to enable an adapter without an ACTIVE certificate … default OFF" —
  **verified** (row LIVE 2026-11-05).
- **PHASE-025 — ADDED by this cold run** (the T8 deliverable): the **DR/restore
  pre-flight inputs** row — §1 pre-flight gains a DR/restore freshness leg reading
  runbook §8: (a) last quarterly drill (§4) within window (overdue > 2 weeks = Sev-3
  per §9; failed drill repeats within 2 weeks per §4 step 9); (b) monthly attestation
  current (missed attestation blocks the release at §1 row 3; the honest 2026-11 state:
  first attestable month 2026-12, no fabricated line); (c) the GA release cites its
  restore-rehearsal evidence — the 2026-11-06 §8 drill-log rows (`restore:drill` cold
  re-proof + `restore:drill-ga` cross-tier rehearsal, orchestrator-run, ORCH-FILL) +
  the S1 tabletop record [dr-drill-2026-11-06.md](dr-drill-2026-11-06.md). SLO/error
  budget leg retained from the prior row (MONITORING §5, `SLOBurn` per §3).

## 8. What was hard → fixes applied to DEPLOYMENT.md (every edit listed)

| # | What was hard cold | Fix applied (DEPLOYMENT.md unless noted) |
|---|--------------------|------------------------------------------|
| E1 | The §2 smoke block referenced routes that do not exist (`/api/health/live` public path, `/api/v1/auth/login`, `/api/v1/sales/invoices` + wrong auth headers/body) — an engineer following it verbatim gets 404/400/401 | §2 smoke (a)/(b)/(c) rewritten to the verified routes: node-level `/health/live`+`/health/ready` (+ LB public-probe note), `POST /api/v1/identity/sessions`, `POST /api/v1/sales/sales-invoices` with the `createInvoiceSchema` minimum body + `x-session-token` (S-03: no client tenant claims) |
| E2 | §6 step 2 implied 0001 sets passwords | Rewritten: passwords deliberately NOT in SQL; out-of-band from the secret store in production; `scripts/db-dev-credentials.ts` for dev/test (fail-closed) |
| E3 | `deploy/compose.prod.yml` (and the deploy-state files) are referenced as if present; `deploy/` in-repo holds only the updater layout | Command-convention note extended: the compose file is provisioned at hosting setup, **not part of this repository** |
| E4 | §5 tree + runbook §5 step 9 pointed tenant-notice templates at DISASTER_RECOVERY §4 (wrong section) | §5 tree fixed here; [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §5 step 9 fixed (with the DR tabletop, G10) |
| E5 | Header date stamp | Updated → 2026-11-06 |

## 9. Gaps → actions (not fixable in-repo; owners + landing)

| # | Gap | Action | Owner | Lands in |
|---|-----|--------|-------|----------|
| R1 | `deploy/previous_release_tag` / rollback-image identification is hosted deploy state — not verifiable in-repo | Record the file + deploy-ticket workflow at hosting provisioning; the first real deploy writes it | Ops | Provider/hosting checklist |
| R2 | The LB public health-probe path (and the `/api/*` → api routing rule) is a hosting decision not fixed in any doc | Record the routing table at provisioning; add the public probe to the §2 smoke once mapped | Ops | Provider/hosting checklist |
| R3 | [CI_CD.md](CI_CD.md) §5 step 3 cites "DEPLOYMENT.md §3" for the rolling-restart health gates — they are §2 steps 3–6 (§3 is migration safety) | One-word §ref fix (§3→§2) — recorded here, not applied (outside this task's file scope) | Ops | CI_CD.md fix (next edit window) |
| R4 | The §1 rows 1/2/6/7 evidence (CI run, staging rehearsal, comms, on-call) is hosted/CI-side | First real GA-cohort deploy produces the run links; the GA release checklist carries the slots | Ops | GA release checklist |

## 10. Record

- **Date:** 2026-11-06 · **Engineer:** AI coding agent #2 (PHASE-025 session, DR-C) ·
  **Result:** **PASS with fixes applied** — DEPLOYMENT.md §1–§7 walked cold; every
  code-checkable claim verified against the implementation; five runbook edits landed
  (§8); the §7 PHASE-025 DR/restore pre-flight addition written; four hosted-leg gaps
  recorded with owners (§9).
- Companion records: the S1 DR tabletop + rehearsal
  ([dr-drill-2026-11-06.md](dr-drill-2026-11-06.md)), the runbook §8 drill-log rows
  (2026-11-06), and the DISASTER_RECOVERY §5/§7 drill-execution notes.
