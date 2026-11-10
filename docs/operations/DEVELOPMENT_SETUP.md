# Development Setup

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-05

Local development environment runbook for the Universal Business ERP Platform. It takes a
new engineer or AI agent from a clean clone to a running stack: database, object storage,
mail catcher, API, web, and worker. The quickstart below is a **release acceptance
criterion** of PHASE-001 ("a new developer can run the quickstart cold" —
[../implementation/phases/PHASE-001.md](../implementation/phases/PHASE-001.md) §6); if
reality drifts from this file, fixing the doc or the code is part of the phase exit.

## 1. Prerequisites

| Tool | Version | Why | Check |
|------|---------|-----|-------|
| Node.js | 22 LTS+ | api (NestJS), web (Next.js), tooling ([ADR-0002](../architecture/ADR/ADR-0002-typescript-monorepo.md)) | `node -v` |
| pnpm | 9+ | workspace package manager | `pnpm -v` |
| Docker Desktop | 4.x with Compose v2 | postgres/minio/mailpit services; Testcontainers in CI and locally | `docker compose version` |
| git | 2.40+ | trunk-based flow, hooks | `git --version` |
| PostgreSQL client tools | 16 (`psql`, `pg_dump`) | DB inspection, backup drill exercises ([BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md)) | `psql --version` |

Use `nvm`/`fnm` (or equivalent) to pin Node 22; a mismatched Node version is the most
common cold-start failure.

## 2. Quickstart (cold start)

```bash
# 1. Clone
git clone <repo-url> erp-platform && cd erp-platform

# 2. Install workspace dependencies (pnpm workspaces + Turborepo)
pnpm install

# 3. Create your local env file from the committed template — never commit .env
cp .env.example .env

# 4. Start infrastructure + app skeletons (postgres 16, minio, mailpit, api, web)
docker compose up -d

# 5. Apply migrations (first run: bootstrap creates the erp_migrate/erp_app roles,
#    then every run applies pending migrations as erp_migrate — PHASE-002)
pnpm --filter @erp/api db:migrate

# 6. Dev data: reference seeds (currencies, permissions catalog, jurisdiction packs,
#    plans) arrive via migrations from PHASE-003 onward; no seed step exists yet at
#    PHASE-002 (fresh stack = roles + infrastructure tables only)

# 7. Run the app (hot reload): web on http://localhost:3000, api on http://localhost:3001
pnpm dev
```

Verify the stack:

```bash
curl -fsS http://localhost:3001/health/live   # {"status":"ok", ...}
curl -fsS http://localhost:3001/health/ready  # {"status":"ready","checks":[db,migrations,queue]} (PHASE-002)
docker compose ps                             # all services healthy
```

Without Docker (sandbox/CI hosts): `pnpm test:db` boots an **embedded PostgreSQL 16**
automatically (same major version as the compose stack), applies the full migration
chain, and runs the DB suite against it; `pnpm migration-tests` is the Docker-capable
Testcontainers equivalent (ci-db.yml).

The worker is the **same image/process entrypoint** with `WORKER_MODE=1`
([../architecture/DEPLOYMENT_ARCHITECTURE.md](../architecture/DEPLOYMENT_ARCHITECTURE.md)).
In development run it as a second process when exercising jobs:

```bash
pnpm --filter @erp/api dev:worker        # WORKER_MODE=1, consumes pg-boss queues
```

## 3. Local service map (docker compose)

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| `postgres` | `postgres:16` | 5432 | Dev database `erp`; roles `erp_migrate` / `erp_app` / `erp_readonly` created by migration `0001_core_infra` (PHASE-002) |
| `minio` | `minio` | 9000 (S3 API), 9001 (console) | S3-compatible storage for the `files` module; dev stand-in for managed object storage |
| `mailpit` | `mailpit` | 1025 (SMTP), 8025 (web UI) | Catches all outbound email (invitations, notifications — A-008) |
| `api` | built locally | 3001 | NestJS app ([ADR-0003](../architecture/ADR/ADR-0003-nextjs-nestjs.md)) |
| `web` | built locally | 3000 | Next.js BFF + UI |

Optional profile: `docker compose --profile worker up -d` runs a containerized worker for
testing job behavior closer to production topology.

## 4. Dev scripts (Turborepo tasks)

| Command | What it does |
|---------|--------------|
| `pnpm dev` | `turbo dev` — web + api with hot reload |
| `pnpm --filter @erp/api dev:worker` | API package in worker mode (`WORKER_MODE=1`) |
| `pnpm test` | `turbo test` — unit suites across packages |
| `pnpm test:integration` | Testcontainers-based DB tests (PHASE-002+; needs Docker) |
| `pnpm lint` | ESLint (+ module boundary rules + import rules) + Prettier + dependency-cruiser |
| `pnpm typecheck` | `tsc --noEmit` across all packages (strict base config) |
| `pnpm build` | `turbo build` — all packages + apps |
| `pnpm --filter @erp/api db:generate` | `drizzle-kit generate` — draft SQL migration from schema changes (hand-edit after: named constraints, RLS, composite FKs, triggers; see [../database/MIGRATION_STRATEGY.md](../database/MIGRATION_STRATEGY.md)) |
| `pnpm --filter @erp/api db:migrate` | Apply pending migrations (`drizzle-kit migrate`) as the bootstrap/migrate role, then assign the documented dev role passwords (migrations never carry credentials; `scripts/db-dev-credentials.ts` fails closed outside dev) |
| `pnpm --filter @erp/api db:studio` | Drizzle Studio schema browser (read-only habits encouraged) |
| `pnpm test:db` | DB suite on an embedded PostgreSQL 16 (RLS attack tests A1–A5/A10, append-only guards, pg-boss, signed URLs, readiness) — no Docker needed |
| `pnpm migration-tests` | Testcontainers runner: fresh postgres:16 + migrations + DB suite + RLS/catalog checker (ci-db.yml) |
| `pnpm check:rls` | RLS presence + ENTITY_CATALOG drift checker (fails the build on violations; `MIGRATE_DATABASE_URL` required) |
| `pnpm --filter @erp/api dev:worker` | Second process of the same image with `WORKER_MODE=1` (consumes pg-boss queues) |
| `pnpm --filter @erp/desktop test` | The desktop TS runtime suite (real SQLite files + real minisign crypto — see [DESKTOP_QUICKSTART.md](DESKTOP_QUICKSTART.md)) |
| `pnpm --filter @erp/mobile test` | The mobile TS runtime suite — 27 files / 393 tests: logic suites + REAL RN screen renders (AR/EN, a11y, ≥ 44 px) through the vitest Flow bridge (see [MOBILE_QUICKSTART.md](MOBILE_QUICKSTART.md)) |
| `pnpm --filter @erp/web build:desktop` | The Tauri shell static export → `apps/web/out-desktop` (transient, gitignored — remove before linting; §11) |
| `pnpm check:desktop-shell` | Desktop shell structural gate: `tauri.conf.json` invariants + bridge↔Rust command parity + export completeness + secret scan |
| `pnpm check:mobile-tokens` / `check:mobile-i18n` | Mobile parity gates: the RN design-token mirror 130/130 (+50/50 derivations) · the mobile dictionary ar=en=371 |
| `pnpm test:e2e-desktop` | The offline desktop journey E2E (AR + EN; real-runtime bridge double over a temp SQLite store) |
| `pnpm check:mobile-shell` | The mobile structural gate (7 sections: the `native/` toolchain + entry wiring, eas/app-config invariants, the 11-screen registry, screen imports, the workspace boundary, token/RTL spot-checks) — EAS CI compiles the real thing |
| `pnpm docs:validate` | `scripts/validate-docs.py` — link checker + phase-heading + catalog drift hook |

## 5. Environment variables (`.env.example` pattern)

Environment is the **only** configuration source (see
[ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md)). `.env` is git-ignored;
`.env.example` is the committed, reviewed template (PHASE-001 T7). Gitleaks runs in CI and
rejects any secret committed to the repo.

| Variable | Dev example | Used by | Notes |
|----------|-------------|---------|-------|
| `DATABASE_URL` | `postgresql://erp_app:erp_app@localhost:5432/erp` | api, web BFF, worker | Runtime role (non-owner) — RLS applies ([../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md)); dev password assigned by `db:migrate`, production assigns real passwords out-of-band ([../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md)) |
| `MIGRATE_DATABASE_URL` | fresh stack: `postgresql://postgres:postgres@localhost:5432/erp` (bootstrap superuser that migration 0001 grants from); provisioned env: `postgresql://erp_migrate:…@localhost:5432/erp` | drizzle-kit, deploy migrate job | Migration-only role; never used at runtime ([../database/MIGRATION_STRATEGY.md](../database/MIGRATION_STRATEGY.md)) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `erp_dev` / `erp_dev` / `erp_dev` | compose provisioning | First-run bootstrap superuser; not used by the app after `0001` |
| `IDENTITY_SECRET_KEY` | `openssl rand -base64 32` (dev may leave unset) | api | PHASE-003: AES-256-GCM envelope for TOTP secrets + HMAC derivation for reset tokens ([ADR-0015](../architecture/ADR/ADR-0015-authentication.md)); unset in dev/test derives the documented local key — **production fails closed** |
| `IDENTITY_SECRET_KEY_ID` | `v1` | api | Envelope key id for rotation (≤ 8 chars) |
| `EINVOICING_SECRET_KEY` | `openssl rand -base64 32` (dev may leave unset) | api | PHASE-023: AES-256-GCM envelope sealing e-invoicing submission payloads + authority responses at rest ([../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md) §6); falls back to `IDENTITY_SECRET_KEY`; unset in dev/test derives the documented local key — **production fails closed** |
| `EINVOICING_SECRET_KEY_ID` | `v1` | api | Envelope key id for rotation (≤ 8 chars) |
| `SMTP_USER` / `SMTP_PASS` | *(empty locally — mailpit needs no auth)* | notifications | SMTP AUTH PLAIN when the provider requires it |
| `WEB_BASE_URL` | `http://localhost:3000` | api | Absolute links inside emails (invitations, resets) — replaces the planned `PUBLIC_WEB_URL` row |
| `MAX_UPLOAD_BYTES` / `SIGNED_URL_TTL_SECONDS` / `S3_*` | see files module | files module | PHASE-002 delivered |
| `S3_ENDPOINT` / `S3_REGION` | `http://localhost:9000` / `us-east-1` | files module | MinIO locally; managed storage in staging/prod |
| `S3_BUCKET` | `erp-dev` | files module | Created by seed; per-environment bucket in staging/prod |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | MinIO root keys (dev) | files module | Signed-URL issuance |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | dev values | compose provisioning | MinIO console login at http://localhost:9001 |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | notifications | Mailpit locally; real provider in prod (A-008) |
| `SMTP_FROM` | `ERP Dev <dev@localhost.test>` | notifications | From-address for outbound mail |
| `PUBLIC_WEB_URL` | `http://localhost:3000` | api | Absolute links in emails (invitations) |
| `API_PORT` / `WEB_PORT` | `3001` / `3000` | apps | Change on port conflicts |
| `LOG_LEVEL` | `debug` | all | `info` in staging/prod; `debug` forbidden in prod |
| `WORKER_MODE` | `0` / `1` | api entrypoint | Selects pg-boss consumer mode |
| `DEV_SEED_ADMIN_EMAIL` / `DEV_SEED_ADMIN_PASSWORD` | dev values | db:seed | Demo admin credentials; variable must be **unset** outside local |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | observability | No-op export by default (PHASE-002 wiring) |
| `SENTRY_DSN` | *(empty in local)* | error tracking | Staging/prod carry real DSNs ([MONITORING.md](MONITORING.md)) |

**Rule:** no secret is ever committed. If a secret touched the repo: rotate it first, then
purge history per [../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md).

## 6. Common workflows

### 6.1 Author and run one migration

```bash
# Edit the Drizzle schema in the owning module, then draft the SQL:
pnpm --filter api db:generate        # creates apps/api/migrations/NNNN_description.sql
# Hand-edit the file for named constraints, RLS policy, composite tenant FKs,
# partial indexes, triggers (generator does not own these — conventions do).
pnpm --filter @erp/api db:migrate         # apply locally
pnpm test:integration                # fresh-apply + regression-apply + RLS checks
```

Never edit an already-applied migration; add a new one instead (forward-only —
[../database/MIGRATION_STRATEGY.md](../database/MIGRATION_STRATEGY.md) §4).

### 6.2 Reset the local database

```bash
docker compose down -v               # stops services AND removes data volumes
docker compose up -d
pnpm --filter @erp/api db:migrate && pnpm --filter @erp/api db:seed
```

### 6.3 Run a job inline (debugging pg-boss handlers)

```bash
# Terminal 1 — worker consuming queues with verbose logs:
LOG_LEVEL=debug pnpm --filter @erp/api dev:worker

# Terminal 2 — enqueue via the jobs API from a one-off script
# (the PHASE-002 test job defines the pattern):
#   import { Jobs } from '...'; await Jobs.publish('reports.render', payload, opts);
pnpm --filter api exec tsx scripts/dev-enqueue.ts   # dev-only helper script
```

Inspect queue state directly:

```bash
docker compose exec postgres psql -U erp_dev -d erp_dev \
  -c "SELECT state, count(*) FROM boss.job GROUP BY state;"
```

### 6.4 Read outbound email (invitations, notifications)

Open **http://localhost:8025** (Mailpit web UI). SMTP target is `localhost:1025`. If mail
is not arriving, check `SMTP_HOST`/`SMTP_PORT` in `.env`.

### 6.5 Inspect object storage (attachments, exports)

Open **http://localhost:9001** and sign in with `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`.
The dev bucket `erp-dev` holds tenant-scoped prefixes (`tenants/<tenant_id>/…`).

### 6.6 psql into the dev database

```bash
docker compose exec postgres psql -U erp_dev -d erp_dev
# Try the isolation behavior yourself (fail-closed):
# SET LOCAL erp.tenant_id IS NOT APPLICABLE — SELECT * FROM audit_events; → 0 rows
```

### Auth flows + mailpit (PHASE-003)

```bash
docker compose up -d        # postgres, minio, mailpit (localhost:1025), api, web
open http://localhost:3000/ar/login
```

Login with a seeded/invited account; invitation + password-reset + login
emails land in the mailpit UI (http://localhost:8025) rendered in the
recipient's locale (plain text, UTF-8). The API listens on 3001 and is
token-authenticated only (`X-Session-Token` from the BFF); the browser talks
exclusively to the BFF which holds the `httpOnly` `erp_session` cookie and
enforces the CSRF double-submit (`erp_csrf` + `X-CSRF-Token`). Provisioned
environments: the ops bootstrap must create the `erp_definer` role
(NOLOGIN BYPASSRLS) and `GRANT erp_definer TO erp_migrate` before migration
0003 — fresh stacks (compose/embedded/Testcontainers) create it automatically
as the bootstrap superuser (TENANT_ISOLATION §1 envelope).

## 7. Troubleshooting quick hits

| Symptom | Fix |
|---------|-----|
| Port already allocated (`3000/3001/5432/9000`) | Stop the conflicting service or set `WEB_PORT`/`API_PORT`; on Linux check `ss -ltnp` |
| `pnpm install` fails on peer deps | Do not use `--force`; pin via `pnpm.overrides` in the workspace root with a justification comment (tool churn rule, PHASE-001 §7) |
| Node version mismatch errors | `nvm use 22` / `fnm use 22`; check `.nvmrc` |
| Migrations "already applied with different checksum" | You edited an applied migration. Restore it from git and add a **new** migration instead |
| Testcontainers cannot reach Docker | Ensure Docker Desktop is running and the user has socket access; WSL2 users: enable integration for the distro |
| API `/health/ready` fails | Postgres not up yet (`docker compose ps`), or migrations not applied — run `db:migrate` |
| Web renders but API calls fail | `API_PORT` mismatch or CORS; both apps must share the `.env` values |
| Stale schema after switching branches | `docker compose down -v && docker compose up -d` then re-migrate (dev data is disposable) |
| Mailpit empty while app "sent" mail | Wrong `SMTP_HOST`; the API logs the configured host at boot |
| gitleaks flags your branch | You committed a real secret: rotate it **first**, then rewrite history; never just delete the line |

## 8. Docs-first rule for agents (AGENTS.md protocol)

This repository is documentation-driven: the docs under `docs/` are the authoritative
blueprint, and code conforms or the blueprint is amended through change control. The full
protocol is [../../handoff/AGENT_START_HERE.md](../handoff/AGENT_START_HERE.md); the mandatory summary:

1. Start at `docs/handoff/AGENT_START_HERE.md` — the single entry point — and read
   `docs/handoff/IMPLEMENTATION_PROTOCOL.md` before writing code.
2. Read the roadmap/status files, then **only the requested phase document**; never
   implement future phases "while you are there" (scope discipline,
   [../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md)).
3. Verify prior phases against actual code/migrations/tests/completion reports — never
   assume completion from the roadmap.
4. Run the full verification gate (`pnpm typecheck && pnpm lint && pnpm test &&
   pnpm test:integration` + phase-specific gates) before reporting.
5. Update every doc your work affects (this file included), append to
   `docs/handoff/CHANGELOG.md`, update `IMPLEMENTATION_STATUS.md` /
   `CURRENT_STATE.md`, and produce a completion report from
   [../implementation/templates/COMPLETION_REPORT_TEMPLATE.md](../implementation/templates/COMPLETION_REPORT_TEMPLATE.md).
6. Hard rules: never fabricate tax rates/legal rules/official API behavior; never bypass
   tenant isolation, the posting engine, or accounting invariants; never report success
   with failed or skipped tests.

CI enforces the docs side: `pnpm docs:validate` (link checker, phase-heading checker,
schema-catalog drift hook) must stay green on every PR
([CI_CD.md](CI_CD.md)).

## 9. PHASE-004 walkthrough (registration → onboarding → console)

1. **Public registration**: `GET /api/v1/platform/register/options` returns the
   seeded form data (10 countries, 12 currencies, 13 industry templates);
   `POST /api/v1/platform/register` (anonymous, per-IP 5/h + global 60/h)
   creates tenant + owner + business-plan TRIAL (14 d PLACEHOLDER) + audit rows
   atomically. The web equivalent is `/ar/register` (or `/en/register`).
2. **Sign in** as the owner and open **`/{locale}/onboarding`** — the wizard
   calls `POST /api/v1/tenancy/onboarding/provision` (feature-gated by
   `platform.onboarding`): instantiates the CoA template (42 accounts, 16
   purpose markers), the 8 business system roles, numbering/fiscal/jurisdiction
   defaults. Re-runs are idempotent (created=0 diff).
3. **Branches** (`/{locale}/branches`) and **settings** (`/{locale}/settings`)
   follow the tenancy API; the support opt-in toggle lives under settings
   (`platform.support.opt_in`).
4. **Platform staff bootstrap (ops, out-of-band — no credentials in migrations)**:
   create the first platform admin with a membership in the platform-operations
   tenant on the `platform_admin` role:
   ```sql
   INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES (gen_random_uuid(), '<email>', 'Platform Admin', '<argon2id-hash>', 'ACTIVE');
   INSERT INTO memberships (id, tenant_id, user_id, role_id)
     SELECT gen_random_uuid(), '20000000-0000-4000-8000-000000000001', u.id, r.id
       FROM users u, roles r
      WHERE u.email = '<email>'
        AND r.tenant_id = '20000000-0000-4000-8000-000000000001'
        AND r.key = 'platform_admin';
   ```
   That user signs in normally and sees the platform console
   (`/{locale}/platform`): tenant list/search, detail (plan, entitlements,
   memberships, branches), suspend/restore (reason required), manual plan
   assignment, entitlement grants (MANUAL require expiry + reason; BR-040
   closure enforced), the cross-tenant audit viewer, and §7 support sessions
   (opt-in or ticket, ≤ 4 h, per-action audit).
5. **Suspend semantics check**: suspending a tenant kills its sessions
   immediately (next request 401, login blocked, console still reachable);
   restore revives re-login access.

## §10 PHASE-005 — Design-system harness quickstart

```bash
pnpm --filter @erp/ui storybook          # interactive catalog (AR canvas default)
pnpm test:visual-harness-run             # storybook --test build → visual+axe → perf (gates)
pnpm --filter @erp/ui test:visual -- --update-snapshots   # regenerate baselines (green runs only)
pnpm test:web-security                   # builds apps/web + probes §8 headers on :3100
pnpm check:token-contrast                # DESIGN_TOKENS §16 AA matrix
pnpm check:ui-catalog                    # export ↔ catalog-row parity
pnpm check:i18n-parity                   # ar/en key parity (web 3244=3244; the mobile
                                         #   twin gate check:mobile-i18n asserts 371=371)
```

Notes: baselines live in `packages/ui/__image_snapshots__` (tool-generated,
never hand-edited; changes ship with a changeset naming the cause). The
`catalog--app-shell-page` baseline is quarantined (VISUAL_TESTING §3, subpixel
AA variance under contention; 5-day SLA from 2026-10-29). The 10k-row 60fps
gate isolates component overhead from the environment floor and enforces the
absolute budget on capable hardware (floor < 15ms).

## §11 PHASE-021 — Desktop application (Tauri shell) quickstart

The desktop application is the workspace package **`@erp/desktop`** (`apps/desktop`):
all application logic (SQLite store, enrollment/keychain auth, sync host, minisign
updater, WebView2 probe, telemetry, ESC-POS print) is TypeScript on plain Node — the
Rust shell (`apps/desktop/src-tauri/**`) is thin plugin glue shipped as source and
compiled + signed only by the Windows CI workflow. The bootstrap is the **same
monorepo one** (`pnpm install` — nothing desktop-specific: `better-sqlite3` installs
with prebuilt binaries; the SQLCipher cipher profile is a Windows-CI custom build per
the dual-profile store decision DR-P21-02):

```bash
pnpm --filter @erp/desktop test        # 16 files / 274 tests — real temp-dir SQLite
pnpm --filter @erp/web dev             # the Offline Console at /{locale}/offline
pnpm --filter @erp/web build:desktop   # the shell static export → out-desktop
pnpm check:desktop-shell               # the shell structural gate (no cargo needed)
pnpm test:e2e-desktop                  # the offline journey E2E, AR + EN
```

Full loop (web console route, the export-build lint landmine, the E2E harness, the
updater `--self-test`, the command map):
[DESKTOP_QUICKSTART.md](DESKTOP_QUICKSTART.md); installed-client requirements
(Windows 10/11 64-bit, WebView2 Evergreen minimum 109.0.1518.78):
[DESKTOP_SYSTEM_REQUIREMENTS.md](DESKTOP_SYSTEM_REQUIREMENTS.md).

## §12 PHASE-022 — Android application (Expo/RN) quickstart

The Android application is the workspace package **`@erp/mobile`** (`apps/mobile`):
all application logic (golden constants, the two-layer design-token mirror, the i18n
runtime, auth/session/device security, the field + personal SQLite stores, the sync
host over UNMODIFIED `@erp/sync-core`, the field-sales flow state machines, the
rejection UX, the release policy, the RN screens) is TypeScript on plain Node — the
**`native/`** dir (`apps/mobile/native/**` + `app.config.ts` + `eas.json` +
`metro.config.js`) is the thin Expo glue, shipped as source and compiled only by the
EAS release workflow (**DR-P22-01**, the `src-tauri` precedent). The bootstrap is the
**same monorepo one** (`pnpm install` — expo is never installed by it:
`pnpm-workspace.yaml` excludes `apps/mobile/native`; react/react-native are pure JS,
and the vitest Flow bridge strips react-native's Flow syntax so REAL screen renders
work on Node):

```bash
pnpm --filter @erp/mobile test        # 27 files / 393 tests — logic + real AR/EN renders
pnpm --filter @erp/mobile typecheck   # tsc --noEmit (strict; native/ excluded)
pnpm check:mobile-tokens              # the RN token mirror: 130/130 + 50/50 derivations
pnpm check:mobile-i18n                # the mobile dictionary: ar=en=371
pnpm check:mobile-shell               # the structural shell gate (no Android SDK needed)
```

Android toolchain (SDK + EAS CLI) is needed ONLY for device builds — the release
workflow installs `apps/mobile/native` standalone and runs `eas build`; the honest
deferral doctrine (what the sandbox proves vs what EAS CI / the device farm proves) is
part of the loop: [MOBILE_QUICKSTART.md](MOBILE_QUICKSTART.md).
