# ADR-0018 — Multi-Entity Consolidation: Legal Entity = Tenant, Read-Only Member Aggregation

> **Status:** ACCEPTED · **Date:** 2026-10-28 · **Supersedes:** none · **Origin:** Blueprint v2.0 expansion — [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) ED-10 (canonical spec); matures v1.1 assumption A-002 ("multi-entity groups are post-GA")

## Context

[ADR-0005](ADR-0005-multi-tenancy.md) fixes the tenancy model: **one legal entity = one
tenant**, shared schema with Row-Level Security as defense in depth, and v1.1 deliberately
deferred multi-entity consolidation (assumption A-002 in
[../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)).
Clients running multi-company groups — a KSA trading group with one tenant per VAT
registration is the canonical case — currently export each entity's statements and
consolidate offline in spreadsheets. They need consolidated statements inside the platform
**without weakening tenant isolation**: the moment consolidation requires cross-tenant
writes or relaxed RLS, the platform's core promise (ADR-0005 attack tests A1–A11, the
RLS-denial canary) is broken for every tenant, consolidated or not.

Two v1.1 decisions constrain the design space: the posting engine is the only writer of
ledger data ([ADR-0007](ADR-0007-centralized-posting-engine.md)) — so eliminations, being
accounting facts, must land in auditable journals like any other posting — and
consolidated reports must be deterministic functions of posted data (ADR-0011 report
contracts), not computed opinions floating beside the books.

## Decision

1. **A legal entity = a tenant — unchanged.** No new tenancy shape; group membership is
   configuration in the consolidation module, not a change to ADR-0005.
2. **Consolidation is a read-only run** over the member tenants' books, **plus elimination
   entries** posted via the posting engine into the **parent tenant's consolidation
   books**, using engine source_type `CONSOLIDATION_ELIMINATION` (one balanced journal per
   elimination set; reversals only by counter-entry, BR-056).
3. **Zero cross-tenant writes.** Member RLS is never relaxed; a dedicated, audited
   **consolidation service** reads member books via an explicit, platform-plane grant —
   the only sanctioned cross-tenant reader in the platform.
4. **Group FX translation uses dated exchange rates** following the INV-008 conventions
   (stored rate > 0; base amounts = document amounts × stored rate; no recomputation
   drift), producing statements in the group's base currency.
5. **Members must have closed fiscal periods before a run may execute** (BR-056); a run
   over open periods is rejected, not warned.
6. **Tables** owned by the new `consolidation` module (PHASE-034):
   `consolidation_groups`, `group_entities`, `elimination_entries`, `consolidation_runs`
   ([../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md),
   [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §C).

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Cross-tenant posting: write elimination journals directly into member tenants' books | Breaks the one-writer-per-tenant model; member audit trails would carry group-level adjustments the member never authorized; relaxing RLS for a writer becomes a standing, exploitable grant |
| One mega-tenant with group members as branches | Collapses legal-entity boundaries — each entity's statutory books, VAT registration, numbering, and e-invoicing identity are per-tenant by ADR-0005's design; re-migrating existing groups is costlier than a read service |
| Report-time consolidation only (eliminations computed in the report layer, no journals) | Eliminations would be unaudited magic numbers beside the ledger; violates the rule that reports are deterministic functions of posted data; no drill-down from a consolidated statement to a balanced, linked journal |
| A separate consolidation database fed by copies of member books | A second financial truth — forbidden in spirit by [ADR-0017](ADR-0017-no-event-sourcing.md); doubles reconciliation work and adds freshness lag with no isolation benefit |

## Consequences

- **No RLS changes**: member-tenant policies, attack tests, and the RLS-denial canary are
  untouched; the consolidation service is an additive, audited reader with its own grant,
  covered by isolation attack rows ([../../security/SECURITY_AND_TENANT_ISOLATION.md](../../security/SECURITY_AND_TENANT_ISOLATION.md)).
- **Consolidated statements are derived artifacts**: consolidated TB/IS/BS equal
  Σ member statements (group currency, dated FX) minus eliminations (INV-026);
  they never replace member statutory books and are labeled as group views.
- **Eliminations are real journals in the parent's books**: the full posting-engine
  contract applies — document↔journal source chain (INV-006), operation idempotency
  (INV-013), immutable posted rows (INV-003), reversal-only corrections.
- **Interoperability cost**: the consolidation service is the **only sanctioned
  cross-tenant reader**; every other module, job, and report keeps single-tenant scope.
  Platform-plane grants are explicit, audited, and reviewed with the isolation suite.
- **ADR-0005 multi-tenancy unchanged**; a future "shared group features" request (group
  master data, intercompany documents) requires a new ADR — this one covers statements
  only.
- Phase wiring: module `consolidation` + feature keys (`consolidation.groups`,
  `consolidation.eliminations`, `consolidation.runs`, `consolidation.fx_translation`,
  `consolidation.reports`) and reports (`consolidated-tb`, `consolidated-is`,
  `consolidated-bs`, `eliminations-log`) land at PHASE-034 per
  [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §D/§J; the G-32 elimination
  posting shape (DR intercompany AP · CR intercompany AR, in the parent's consolidation
  books only) joins the golden postings in
  [../../accounting/JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7.

## Revisit triggers

- A member tenant's fiscal calendar cannot be aligned with the group's consolidation
  calendar (e.g., mixed Hijri/Gregorian year-ends) → open a product decision record on
  mapping conventions before PHASE-034.
- A group demands intercompany document automation (orders/invoices between members) —
  out of scope here; requires a new ADR plus an accounting decision record.
- Regulatory demand for statutory consolidated filings with a mandated translation method
  (temporal vs closing-rate) — tracked as open question OQ-V2-2 in
  [../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md);
  decide before PHASE-034 planning.
