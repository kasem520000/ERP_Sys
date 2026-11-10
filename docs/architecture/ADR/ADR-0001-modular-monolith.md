# ADR-0001 — Modular Monolith on NestJS

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

The Platform is a long-lived commercial ERP with many business modules (accounting,
inventory, sales, purchasing, treasury, tax, POS, manufacturing, …). The team is small and
initially includes AI coding agents implementing phases sequentially. Operational budget is
limited. Directive principles §1.16–1.17 forbid introducing microservices, event sourcing,
or distributed databases without documented justification.

## Decision

Build a **single deployable backend — a modular monolith** — using **NestJS** as the
application framework. Modules correspond to bounded contexts (see
[../MODULE_BOUNDARIES.md](../MODULE_BOUNDARIES.md)). Module boundaries are enforced by
lint rules and dependency direction tests, not by network boundaries.

NestJS is chosen because: first-class modular DI system; mature ecosystem (validation,
OpenAPI, scheduling); TypeScript-native; fits both HTTP API and job workers in one code
base; widely documented, which matters for AI-agent implementability.

## Alternatives considered

| Alternative | Why not now |
|-------------|-------------|
| Microservices per module | Massive operational overhead (deploy, observability, transactions) with no current scale justification; cross-module accounting transactions would need sagas — a correctness risk. |
| Next.js API routes as the backend | Web-coupled; poor fit for desktop/Android clients, background jobs, and long-running report generation; weak module boundary enforcement. |
| Event sourcing / CQRS event store | Complexity and audit needs are met by immutable journal entries + audit events; replay semantics conflict with financial correction rules (reversals). |
| Separate services only for reporting/sync later | Allowed **after** GA if justified — extraction points are documented per module. |

## Consequences

- One PostgreSQL transaction can span document + inventory + journal changes (atomicity
  for free) — a major correctness win for accounting.
- Deployment is one API image (+ web client); scaling is horizontal on the API.
- Cross-module communication is direct service calls within the process, plus in-process
  domain events for side effects. Events are **not** the system of record.
- A misbehaving module can degrade the whole process; mitigated by module quotas, timeouts
  on jobs, and CI boundary checks.

## Module-boundary enforcement (normative)

1. A module may not import another module's `entities/`, `repositories/`, or internal
   `services/` — only its published `api/` surface.
2. Only the `accounting` module writes `journal_entries`/`journal_lines` (via the posting
   engine). Only `inventory` writes `stock_moves`. Only `partners` writes `partners`.
3. No circular module imports; enforced by `eslint-plugin-boundaries` + a dependency
   graph test in CI.
4. Extraction seams: each module's published service interface is serializable
   (data-in/data-out) so a future service split does not force contract rewrites.

## Revisit triggers

- A single module's load profile (e.g., report rendering, sync fan-out) degrades the whole
  API beyond SLOs and cannot be isolated by workers/queues.
- Organizational scaling (multiple independent teams) makes ownership collisions chronic.
- Then: extract the specific module behind its published interface, with an ADR.
