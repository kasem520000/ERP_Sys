# PHASE-001 — Repository & Engineering Foundation

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-001
- **Title:** Repository & Engineering Foundation
- **Objective:** Turn the documentation-only repository into a working engineering
  workspace: the pnpm + Turborepo monorepo skeleton with all apps/packages scaffolded,
  strict TypeScript, lint/format rules including module-boundary enforcement, the
  Docker Compose development environment (Postgres, MinIO, mailpit), the GitHub Actions
  CI pipeline running typecheck/lint/test/build on every push, and documentation
  tooling that keeps the blueprint synchronized with the code.
- **Business value:** Every later phase builds on this foundation; a correct,
  enforced foundation prevents the two classic failure modes of phased AI-driven
  development — boundary erosion and docs drift (RISK-016, RISK-020).

## 2. Scope

In scope:

1. Monorepo scaffold per [ADR-0002](../../architecture/ADR/ADR-0002-typescript-monorepo.md):
   `apps/api` (NestJS skeleton), `apps/web` (Next.js skeleton), `apps/desktop`
   (placeholder dir + README stub pointing to PHASE-021), `apps/mobile` (same for
   PHASE-022), `packages/contracts`, `packages/domain-core`, `packages/ui`,
   `packages/config`.
2. Tooling: pnpm workspaces, Turborepo pipeline, Prettier, ESLint (+typescript,
   boundaries, import rules), `dependency-cruiser` rule file, EditorConfig, strict
   tsconfig base (no unchecked indexed access, no implicit any).
3. `packages/domain-core` v0: `UUIDv7` generator, `Money`/`Quantity`/`Rate` value
   objects over decimal.js, `Result` type, domain error base, `CalendarDate` helper,
   and their unit tests — the primitives every later phase imports
   ([ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)).
4. Docker Compose dev environment: `postgres:16`, `minio`, `mailpit`, `api`, `web` —
   with healthchecks and `.env.example`.
5. CI (GitHub Actions): jobs — install, typecheck, lint, unit, build, docs validation
   (link checker + phase-heading checker + schema-catalog drift hook stub), gitleaks
   secrets scan. No DB integration tests yet (PHASE-002 adds Testcontainers).
6. Docs tooling: the validation script (this blueprint ships
   `scripts/validate-docs.py` as the initial version — CI runs it); commit message
   convention + CHANGELOG seed wiring; `AGENTS.md` remains authoritative.
7. A deliberate **negative test** proving boundary lint fails violating imports.

Out of scope (explicit):

- Any business logic, endpoints, or database schema (PHASE-002+).
- Testcontainers/integration DB tests (PHASE-002).
- Deployment manifests beyond Compose (PHASE-002/014+).
- Storybook/visual testing (PHASE-005).
- `apps/desktop` and `apps/mobile` actual code (PHASE-021/022).

## 3. Prerequisites

- Required phases: none (first phase).
- Required architecture decisions: [ADR-0002](../../architecture/ADR/ADR-0002-typescript-monorepo.md)
  (monorepo layout, strict TS), [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)
  (money primitives), [ADR-0001](../../architecture/ADR/ADR-0001-modular-monolith.md)
  (NestJS choice — skeleton only).
- Relevant documentation: [../../architecture/DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md)
  (enforcement lists), [../../operations/DEVELOPMENT_SETUP.md](../../operations/DEVELOPMENT_SETUP.md),
  [../../operations/CI_CD.md](../../operations/CI_CD.md), [../../handoff/IMPLEMENTATION_PROTOCOL.md](../../handoff/IMPLEMENTATION_PROTOCOL.md).

## 4. Design Impact

- **Database changes:** none (compose boots Postgres 16 with empty schema; roles are
  created in PHASE-002).
- **API changes:** skeleton `/health/live` route only (returns build info; readiness
  arrives in PHASE-002).
- **UI changes:** Next.js skeleton with a placeholder home page stating "Phase 001
  foundation" and locale/direction scaffolding (`<html lang dir>` wired for AR/EN
  switch demo) — proving RTL plumbing without design-system work.
- **Security & authorization:** none functional; gitleaks + branch protection defaults;
  CI-enforced CODEOWNERS stub.
- **Accounting implications:** none (but `domain-core` money primitives are the
  foundation for INV-001/002 and are tested here).
- **Localization implications:** the web skeleton must boot with `dir="rtl"` when
  locale=ar (locale switch demo, strings via the i18n pattern that PHASE-005 completes).
- **Offline implications:** none.
- **Module dependencies:** `packages/domain-core`, `packages/contracts` (empty registry
  v0), `packages/config`; apps import packages per [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §3.

## 5. Implementation Plan

### 5.1 Target repository layout (end of phase)

```
erp-platform/
  apps/
    api/            # NestJS skeleton: main.ts, app.module.ts, health controller
    web/            # Next.js skeleton: app router, [locale] segment, dir demo
    desktop/        # README stub only (implemented in PHASE-021)
    mobile/         # README stub only (implemented in PHASE-022)
  packages/
    contracts/      # zod registry v0 + error-code enum seed
    domain-core/    # UUIDv7, Money, Quantity, Rate, Result, errors, CalendarDate
    ui/             # README stub (implemented in PHASE-005)
    config/         # tsconfig bases, eslint config, prettier config
  docs/             # this blueprint (unchanged)
  scripts/          # validate_docs.py, check-boundaries fixture runner
  docker-compose.yml
  .env.example
  pnpm-workspace.yaml
  turbo.json
  .github/workflows/ci.yml
```

### 5.2 CI pipeline (target)

```mermaid
flowchart LR
  PR["PR / push"] --> INST["install (pnpm, cache)"]
  INST --> LINT["lint + boundaries<br/>+ dependency-cruiser"]
  INST --> TYPE["typecheck (all packages)"]
  INST --> UNIT["unit + property tests"]
  LINT & TYPE & UNIT --> BUILD["build api + web"]
  BUILD --> DOCS["docs validation script"]
  BUILD --> LEAKS["gitleaks scan"]
  DOCS & LEAKS --> NEG["negative meta-test:<br/>boundary violation fixture MUST fail lint"]
  NEG --> OK["merge gate green"]
```

### 5.3 Environment variables (`.env.example`)

| Variable | Dev value | Purpose |
|----------|-----------|---------|
| `DATABASE_URL` | `postgres://erp_app:erp_app@localhost:5432/erp` | App connection (non-owner role from PHASE-002) |
| `SESSION_SECRET` | dev-only string | Session cookie signing (used from PHASE-003) |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | minio values | Object storage (files module, PHASE-002+) |
| `SMTP_HOST` / `SMTP_PORT` | `localhost:1025` | mailpit (dev mail sink) |
| `WORKER_MODE` | `0` | Worker entrypoint flag (PHASE-002+) |
| `LOG_LEVEL` | `debug` | pino level |

### 5.4 Task table

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | pnpm + Turborepo init, workspace manifest, base tsconfigs | `pnpm-workspace.yaml`, `turbo.json`, `packages/config/*` | `pnpm build` green |
| T2 | ESLint + Prettier + boundaries + import rules + dependency-cruiser config | `eslint.config.mjs`, `.dependency-cruiser.cjs`, per-package lint configs | `pnpm lint` green; negative boundary test file fails lint (asserted in CI script) |
| T3 | NestJS `apps/api` skeleton + `/health/live` | `apps/api/src/**` (main.ts, app.module.ts, health controller) | unit test on route |
| T4 | Next.js `apps/web` skeleton + RTL/LTR demo page | `apps/web/**` | build + route smoke |
| T5 | `packages/domain-core`: UUIDv7, Money, Quantity, Rate, Result, errors | `packages/domain-core/src/**` | unit + property tests (fast-check): money add/sub/mul/round; UUIDv7 monotonicity & format |
| T6 | `packages/contracts` v0 (empty zod registry + error-code enum seed) | `packages/contracts/src/**` | unit test |
| T7 | Docker Compose dev stack + `.env.example` | `docker-compose.yml`, `.env.example` | `docker compose up -d` healthy |
| T8 | GitHub Actions CI (typecheck, lint, unit, build, docs validation, gitleaks) | `.github/workflows/ci.yml`, `scripts/validate-docs.py` moved into repo `scripts/` | green run on push |
| T9 | Docs validation wiring + commit conventions + CHANGELOG seed | `scripts/**`, `docs/handoff/CHANGELOG.md` (already exists — wire updates) | script exits 0 on current docs |
| T10 | README updates (dev quickstart) | `README.md`, `docs/operations/DEVELOPMENT_SETUP.md` | manual |

## 6. Verification

**Automated tests (required):**

- `domain-core` unit suite: Money (add, subtract, multiply by qty, currency-minor
  rounding half-up, string parse/format, rejects float construction), Rate precision,
  UUIDv7 (version bits, sortable within ms), Result semantics.
- Negative boundary test: a fixture importing across a forbidden boundary fails lint —
  CI asserts the failure occurs (meta-test).
- API health route test; web build smoke.
- Docs validation script: all markdown links resolve; all phase docs contain the 29
  required headings; roadmap phase table matches `docs/implementation/phases/` files.

**Manual verification:**

1. `docker compose up -d` → postgres, minio, mailpit reachable; `api` health live OK;
   `web` renders the locale/direction demo.
2. New developer/agent flow: clone → `pnpm i` → `pnpm dev` boots api+web.
3. Verify a deliberate cross-boundary import is caught by lint locally.

**Acceptance criteria (objective):**

1. All CI jobs green on `main` including the negative boundary meta-test.
2. `pnpm turbo build lint test typecheck` succeeds from a clean clone.
3. Compose stack healthy; documented quickstart matches reality.
4. Docs validation script passes and is wired into CI.
5. No business logic present (verified: `apps/api/src` contains only skeleton; grep for
   forbidden patterns clean).

**Performance & security considerations:** CI ≤ 8 min target; gitleaks + branch
protection on; no secrets in repo (`.env.example` only).

**Migration & rollback:** none (no DB). Rollback = revert commits; repo remains
docs-first if phase reverted.

## 7. Risks and Constraints

- RISK-016 (boundary erosion): mitigated by T2 + meta-test in CI from day one.
- RISK-020 (docs drift): mitigated by docs validation in CI + review checklist.
- Tool churn risk: pin versions exactly; upgrades via decision records.
- Constraint: no code beyond this list — resist scaffolding urges.

## 8. Completion and Handoff

- **Completion evidence:** completion report at
  `docs/implementation/phases/reports/PHASE-001-COMPLETION.md` with: CI run link,
  command outputs (`pnpm test`), compose healthcheck output, docs validation output,
  negative-test proof.
- **Documentation updates required:** update
  [../../planning/IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-001 → COMPLETE), `docs/handoff/CURRENT_STATE.md`,
  `docs/handoff/CHANGELOG.md`, and `docs/operations/DEVELOPMENT_SETUP.md` quickstart if
  reality differs from doc.
- **Exit criteria:** all acceptance criteria pass with evidence; report merged; status
  updated; next agent can run the quickstart cold.
- **Definition of Done:** repo boots from clean clone; CI green including meta-tests;
  docs validation green; zero TODOs in scaffold; status files updated.
- **Handoff instructions:** next agent should read the completion report, then
  [PHASE-002](PHASE-002.md). **Next eligible phase: PHASE-002 — Database & Migration
  Infrastructure** (identify only; do not implement).
