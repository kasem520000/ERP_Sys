# Architecture Decision Records — Index

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28

Architecture Decision Records (ADRs) capture each significant, hard-to-reverse decision:
context, decision, alternatives, consequences, and the conditions under which the decision
must be revisited. ADRs are immutable once accepted; superseding requires a new ADR that
references the old one.

Any change to an accepted ADR during implementation requires the change-control process in
[../handoff/IMPLEMENTATION_PROTOCOL.md](../handoff/IMPLEMENTATION_PROTOCOL.md) (reason,
impact analysis, migration plan, affected phases, updated ADR, regression tests).

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-0001](ADR/ADR-0001-modular-monolith.md) | Modular monolith on NestJS (no microservices at launch) | ACCEPTED |
| [ADR-0002](ADR/ADR-0002-typescript-monorepo.md) | TypeScript everywhere in a pnpm + Turborepo monorepo | ACCEPTED |
| [ADR-0003](ADR/ADR-0003-nextjs-nestjs.md) | Next.js web client + headless NestJS API (BFF pattern) | ACCEPTED |
| [ADR-0004](ADR/ADR-0004-postgresql-drizzle.md) | PostgreSQL 16+ with Drizzle ORM | ACCEPTED |
| [ADR-0005](ADR/ADR-0005-multi-tenancy.md) | Shared-schema multi-tenancy with Row-Level Security defense-in-depth | ACCEPTED |
| [ADR-0006](ADR/ADR-0006-identifiers.md) | UUIDv7 technical IDs + separate official document numbering | ACCEPTED |
| [ADR-0007](ADR/ADR-0007-centralized-posting-engine.md) | Centralized posting engine — the only writer of general-ledger data | ACCEPTED |
| [ADR-0008](ADR/ADR-0008-jobs-redis.md) | pg-boss background jobs on PostgreSQL; Redis deferred | ACCEPTED |
| [ADR-0009](ADR/ADR-0009-money-precision.md) | Money representation: NUMERIC(19,4), decimal math, string transport | ACCEPTED |
| [ADR-0010](ADR/ADR-0010-tax-jurisdiction-packs.md) | Tax engine with versioned jurisdiction packs and isolated adapters | ACCEPTED |
| [ADR-0011](ADR/ADR-0011-reporting-printing.md) | Reporting: report contract, HTML→Chromium PDF, exceljs exports | ACCEPTED |
| [ADR-0012](ADR/ADR-0012-offline-sync.md) | Offline: SQLite local store + outbox/inbox sync; server-authoritative posting | ACCEPTED |
| [ADR-0013](ADR/ADR-0013-tauri-desktop.md) | Desktop application on Tauri v2 | ACCEPTED |
| [ADR-0014](ADR/ADR-0014-android-expo.md) | Android application on React Native + Expo | ACCEPTED |
| [ADR-0015](ADR/ADR-0015-authentication.md) | Authentication: argon2id + server sessions + TOTP MFA + device tokens | ACCEPTED |
| [ADR-0016](ADR/ADR-0016-ui-tailwind-radix.md) | UI: Tailwind CSS v4 + Radix primitives + custom RTL-first ERP design system | ACCEPTED |
| [ADR-0017](ADR/ADR-0017-no-event-sourcing.md) | No event sourcing: relational journal + append-only audit (consolidation 2026-10-28, rationale from Folder 4) | ACCEPTED |
| [ADR-0018](ADR/ADR-0018-multi-entity-consolidation.md) | Multi-entity consolidation: legal entity = tenant; read-only member aggregation + eliminations in parent books (Blueprint v2.0, 2026-10-28) | ACCEPTED |

## Decisions deliberately NOT taken (with reasons)

| Candidate decision | Why deferred / rejected |
|--------------------|-------------------------|
| Microservices / event sourcing / CQRS event store | No business justification at current scale; violates the "no unjustified complexity" principle (directive §1.16–1.17). Revisit trigger documented in ADR-0001. |
| Database-per-tenant | Operationally prohibitive for thousands of small tenants (migrations × N databases). Revisit triggers in ADR-0005. |
| Prisma ORM | Runtime engine overhead, weaker raw-SQL control for RLS and numeric handling; Drizzle chosen (ADR-0004). |
| Redis + BullMQ at launch | Extra production dependency without justified load; pg-boss suffices (ADR-0008). |
| Kubernetes at launch | Single-node or small-cluster deployment is sufficient to MVP SLA; revisit at scale (see [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md)). |
| GraphQL API | REST + OpenAPI gives simpler caching, idempotency semantics, and generated clients for all platforms. |
| Last-write-wins sync for financial data | Forbidden by directive §12; conflict policies are per entity type (ADR-0012). |
| Hard-coding any country's tax rules in the core | Forbidden by directive §6; all jurisdictions are packs (ADR-0010). |
