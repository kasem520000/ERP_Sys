# ADR-0002 — TypeScript Everywhere in a pnpm + Turborepo Monorepo

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

The product ships multiple clients (web, desktop, Android) plus a backend, background
jobs, and shared design system and domain contracts. Duplicating business rules, API
types, validation, and design tokens across languages is a documented failure mode
(directive §14: "Avoid duplicating business rules across web, desktop, Android, and
background workers").

## Decision

**TypeScript (strict mode)** for all first-party code, managed in a single **pnpm
workspaces monorepo** orchestrated with **Turborepo**.

```
erp-platform/
  apps/
    api/          # NestJS modular monolith (ADR-0001)
    web/          # Next.js web client (ADR-0003)
    desktop/      # Tauri shell (PHASE-021, ADR-0013)
    mobile/       # Expo React Native (PHASE-022, ADR-0014)
  packages/
    contracts/    # zod schemas + types = the API contract source (ADR-0011 & api docs)
    domain-core/  # shared kernel: ids, money, result types, domain errors
    ui/           # design system (ADR-0016) used by web/desktop
    config/       # shared tsconfig, eslint, prettier
  docs/           # this blueprint
```

Normative rules:

1. `packages/contracts` is the **single source of API truth**: request/response schemas,
   error codes, feature keys, enums. The API implements it; clients consume generated
   types. OpenAPI is generated from these schemas (see
   [../api/OPENAPI_STRATEGY.md](../../api/OPENAPI_STRATEGY.md)).
2. Business rules live in `apps/api` domain modules. Clients may **validate locally**
   (offline UX, fast feedback) using shared schemas in `packages/contracts`, but the
   server result is always authoritative.
3. Money math uses the decimal utilities in `packages/domain-core` — no client or server
   code implements its own money arithmetic ([ADR-0009](ADR-0009-money-precision.md)).
4. `strict: true`, `noUncheckedIndexedAccess`, no `any` in domain code; enforced by shared
   tsconfig and CI.

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Polyglot (Go/Rust backend, Kotlin Android) | Duplicated domain rules; higher AI-agent implementation risk across languages; harder contract consistency. |
| Yarn/Npm workspaces | pnpm has strict dependency isolation (no phantom dependencies) — important for module boundary hygiene. |
| Nx instead of Turborepo | Comparable; Turborepo's smaller surface is easier for agents; either is acceptable — do not relitigate without cause. |
| Bazel/Pants | Overkill at this scale. |

## Consequences

- One toolchain, one lint config, one CI graph; cross-cutting changes are atomic commits.
- Mobile and desktop share non-UI packages (`contracts`, `domain-core`) but **not** UI
  code (React Native ≠ React DOM; Tauri reuses `packages/ui`).
- Repo bootstrap cost is paid once in PHASE-001.

## Revisit triggers

- Build/CI times become painful at monorepo scale (mitigate with Turborepo remote caching
  first; split only as a last resort with a new ADR).
