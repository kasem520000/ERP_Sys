# ADR-0017 — No Event Sourcing: Relational Journal + Append-Only Audit

> **Status:** ACCEPTED · **Date:** 2026-10-28 · **Supersedes:** none · **Origin:** consolidation 2026-10-28 — rationale adopted from Folder 4 (ADR-0002-no-event-sourcing), decision consistent with the existing Folder 3 design (ADR-0004, ADR-0007, INV-003)

## Context

The Platform requires a complete, tamper-evident audit story: every financial effect must
be traceable from an operational document to immutable ledger lines, and point-in-time
financial reporting must be reproducible. A natural question is whether the ledger should
be built as an event-sourced system (append-only domain events as the primary record,
with projections rebuilt from the event log).

## Decision

**Do not adopt event sourcing.** The authoritative records are:

1. **Relational journal entries/lines** written exclusively by the posting engine
   ([ADR-0007](ADR-0007-centralized-posting-engine.md)) — rows in PostgreSQL, protected by
   the INV-003 immutability triggers and the DEF-010 deferred balance trigger.
2. **An append-only `audit_events` table** written only by the audit module's interceptor —
   recording who did what to which aggregate, before/after references, and correlation IDs.
3. **Operational documents with a state machine** (DRAFT → … → POSTED, plus reversals),
   where the posted state is terminal and corrections flow through linked reversal
   documents ([../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)).

Point-in-time reporting is achieved through fiscal-period scoping and as-of queries
(`dataAsOf` on every report contract), not through event replay.

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Full event sourcing (event log = primary record, projections for reads) | Projection consistency becomes a second correctness problem in a system whose core value is that the ledger is already an immutable, append-only, balanced log; every financial report would depend on replay correctness; operational complexity (snapshotting, versioned event schemas, replay migrations) is unjustifiable for an ERP whose relational journal already provides auditability |
| Event sourcing only for the ledger | The journal *is* already append-only and immutable — INV-003 + reversal-only corrections provide the same guarantees without a projection layer |
| Temporal tables / system-versioning for audit | Adds storage and migration complexity; the audit_events + guard-trigger pattern covers the anti-tamper requirement ([../../security/DATA_PROTECTION.md](../../security/DATA_PROTECTION.md)) |

## Consequences

- One source of truth for balances: the relational ledger. No competing projections of
  financial truth (INV-001..INV-022 test this directly).
- Audit = `audit_events` + immutable ledger rows; tamper evidence is enforced by DB
  triggers, role separation, and the RLS canary — not by an event-log hash chain.
- Rebuilding "state" is never needed because state *is* the database; reports are
  deterministic functions of posted data at an as-of date.
- If a future requirement demands event streaming (e.g., real-time data-warehouse feeds),
  the solution is transactional outbox → change-data-capture, evaluated via a new ADR —
  not a rewrite of the ledger.

## Revisit triggers

- A hard requirement for event-level temporal queries that period scoping cannot serve.
- A regulatory demand for cryptographic event-log chaining (none known in target
  jurisdictions; ZATCA requirements are met by submission records + signed artifacts,
  see [../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md)).
