# Universal Business ERP Platform

Multi-tenant, multi-industry SaaS ERP for MENA/GCC markets — Arabic-first, fully
bilingual (AR/EN), RTL-first. This repository is the **consolidated canonical
baseline (Blueprint v1.1 + v2.0 + v3.0)** plus its implementation; the documentation
blueprint under `docs/` is the single source of truth, and code lands phase by phase
per the [65-phase roadmap](docs/planning/MASTER_ROADMAP.md) — stages 1–34 COMPLETE,
stages 12–15 (PHASE-035…065) planned per
[docs/planning/COMPLETENESS_REGISTER.md](docs/planning/COMPLETENESS_REGISTER.md) and
[docs/planning/COMPLETENESS_ROADMAP.md](docs/planning/COMPLETENESS_ROADMAP.md) (the
Full-ERP completion program closing the 495 audited gaps).

> **Honest status:** implementation status lives in
> [docs/planning/IMPLEMENTATION_STATUS.md](docs/planning/IMPLEMENTATION_STATUS.md)
> — nothing is described as working until recorded there with evidence.

## Quickstart (docs/operations/DEVELOPMENT_SETUP.md §2)

Prerequisites: Node 22 LTS, pnpm 9, Docker with Compose v2, Python 3.12+.

```bash
pnpm install                 # workspace install (pnpm workspaces + Turborepo)
cp .env.example .env         # local env — never commit real secrets
docker compose up -d         # postgres:16 + minio + mailpit + api + web
pnpm dev                     # api on :3001, web on :3000 (hot reload)
```

Verify:

```bash
curl -fsS http://localhost:3001/health/live   # {"status":"ok","service":"erp-api",...}
docker compose ps                            # all services healthy
```

## Verification gates (CI-equivalent — `pnpm gate:local` runs them all)

| Gate | Command |
|------|---------|
| Typecheck (strict TS everywhere) | `pnpm typecheck` |
| Lint incl. module boundaries | `pnpm lint` |
| Dependency graph rules | `pnpm lint:depcruise` |
| Unit + property tests | `pnpm test` |
| Build all apps/packages | `pnpm build` |
| Docs validation (23 checks) | `pnpm docs:validate` |
| Boundary negative meta-test | `pnpm boundary:negative-test` |

CI runs the same gates on every push (`.github/workflows/ci.yml`) plus gitleaks
secret scanning.

## Repository layout (ADR-0002)

```
apps/
  api/        NestJS modular monolith (ADR-0001)
  web/        Next.js web client (ADR-0003)
  desktop/    Tauri shell (PHASE-021)
  mobile/     Expo Android (PHASE-022)
packages/
  contracts/  zod schemas + error codes — the single source of API truth
  domain-core/ shared kernel: UUIDv7, Money/Quantity/Rate, Result (ADR-0009)
  ui/         design system (PHASE-005)
  config/     shared tsconfig / eslint / prettier
docs/         the blueprint (authoritative)
scripts/      docs validation + boundary meta-test tooling
```

## Generated artifacts (PHASE-035 hygiene)

`packages/ui/dist-storybook/`, `__image_snapshots__/`, and `.playwright-artifacts*/`
are gitignored build outputs — never committed; CI fails if they reappear. Regenerate
locally: `pnpm --filter @erp/ui build:storybook` (Storybook static build) and
`pnpm test:visual` (first run writes the visual baselines). Policy: [docs/ui/VISUAL_TESTING.md](docs/ui/VISUAL_TESTING.md) §5.

## For AI agents and engineers

Start at [docs/handoff/AGENT_START_HERE.md](docs/handoff/AGENT_START_HERE.md)
(the 15-step protocol). Project instructions summary: [AGENTS.md](AGENTS.md).
Document precedence: [docs/ARCHITECTURE_BASELINE.md](docs/ARCHITECTURE_BASELINE.md)
supersedes older overview docs; consolidation decisions CD-01…CD-12 are recorded
in [docs/CONSOLIDATION_REGISTER.md](docs/CONSOLIDATION_REGISTER.md).
