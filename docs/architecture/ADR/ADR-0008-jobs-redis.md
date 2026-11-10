# ADR-0008 — pg-boss Background Jobs on PostgreSQL; Redis Deferred

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

The Platform needs deferred/retried work from early on: email sending (invitations),
report generation/exports, statement imports, sync maintenance, subscription checks, and
later e-invoicing submissions. Directive §1.16 forbids unjustified infrastructure;
directive §14 requires operational-burden justification per technology.

## Decision

Use **pg-boss** (PostgreSQL-backed job queue) running inside the same NestJS app as a
worker module (or a separate worker process of the same image). No Redis, no separate
queue service at launch.

Job categories (initial):

| Category | Examples | Phase |
|----------|----------|-------|
| Email delivery | invitations, password reset, notifications | PHASE-003 |
| Report/export generation | PDF/XLSX renders, scheduled exports | PHASE-013 |
| Statement import processing | bank statement parsing | PHASE-008 |
| Maintenance | tombstone cleanup, sync cursor compaction | PHASE-020 |
| Regulatory submissions | e-invoicing clearance retries | PHASE-023 |

Normative rules:

1. Jobs are **tenant-scoped** (payload carries `tenantId`; executor re-establishes tenant
   context — RLS applies to workers too).
2. Handlers are **idempotent**; retries are safe by contract.
3. Every job has: max attempts, exponential backoff, dead-letter policy (`expired`
   states alerted via [../OBSERVABILITY.md](../OBSERVABILITY.md)).
4. Long jobs (report rendering) must checkpoint/expire gracefully; UI polls job status
   endpoints.
5. Jobs never carry secrets in payloads; references only.

## Alternatives considered

| Alternative | Why not now |
|-------------|-------------|
| Redis + BullMQ | Adds a second stateful service (HA, backups, monitoring) before load justifies it; Postgres handles our job volume easily. |
| Temporal / workflow engine | Powerful but heavy; our workflows are short and transactional; revisit for complex multi-step regulatory workflows. |
| pg-boss alternatives (graphile-worker) | Comparable; pg-boss has stronger scheduling semantics and is NestJS-friendly. |

## Consequences

- One less production dependency; jobs share the database's durability and backup story.
- Job throughput is bounded by Postgres; acceptable to ~thousands of jobs/minute.
- Queue tables live in a dedicated schema (`boss`) — excluded from RLS (no tenant data),
   but payload tenant scoping still enforced in handlers.

## Redis adoption triggers (documented, not speculative)

- Caching hot read models (dashboard aggregates) beyond in-process caching capacity.
- Rate-limit counters shared across API replicas.
- Pub/Sub fan-out if we ever run >1 real-time concern.

If triggered: introduce Redis for that concern only, with its own ADR; pg-boss stays.
