# DR-006 — Consolidation Policy: Read-Only Members, Engine-Posted Eliminations

> **Status:** ACCEPTED · **Owner:** Accounting Domain Architecture · **Updated:** 2026-11-09 (OQ-V2-2 decision landed — §4 amended) ·
> **Date:** opened 2026-10-28, accepted 2026-10-28 ·
> **Approver:** Product Owner (author: Accounting Domain Architecture) ·
> **Source:** [ED-10](../../EXPANSION_REGISTER.md) (Blueprint v2.0) ·
> **Related:** [ADR-0018](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md)
> (architecture), [INV-026](../../accounting/ACCOUNTING_INVARIANTS.md),
> [BR-056](../../product/BUSINESS_RULES.md), G-32 golden posting
> ([../../accounting/JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7), PHASE-034,
> umbrella record [product/DR-003](../product/DR-003-platform-expansion-v2.md)

## Context

Multi-entity consolidation is the last table-stakes gap from the comparative research
(register preamble): multi-company groups in KSA/UAE run several tenants (one legal
entity per tenant, ADR-0005) and consolidate in spreadsheets today. Blueprint v2.0 adds
the `consolidation` module at **PHASE-034** (ED-10, stage 11 — Enterprise Consolidation).
The architecture — **legal entity = tenant; read-only member aggregation; eliminations
via the posting engine in the parent's consolidation books; zero cross-tenant writes** —
is fixed by [ADR-0018](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md).
This record pins the **accounting policy** on top of that architecture.

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. Derived statements + real elimination journals (adopted)** | Runs read member books (closed periods only), FX-translate with dated rates, subtract eliminations posted as balanced journals in the parent's consolidation books | Auditable end-to-end; member statutory books untouched; matches ADR-0017's one-source-of-truth discipline | Elimination authoring is real work (by design — it is real accounting) |
| **B. Member-side elimination postings** | Post eliminations into each member's books | "Symmetric" treatment | Cross-tenant writes (forbidden); members' statutory books would carry group adjustments they did not authorize |
| **C. Spreadsheet-style consolidation report without journals** | Pure report math over member data | Cheapest | Eliminations unauditable, not drill-down-able; no approval trail; breaks the golden-posting discipline |

## Decision

**Option A.** The `consolidation` module ships at **PHASE-034** with this policy:

1. **Legal entity = tenant** (ADR-0005 unchanged): groups are configuration
   (`consolidation_groups`, `group_entities` with ownership percent and include-from),
   not a tenancy change.
2. **Read-only member aggregation**: a run reads member tenants' posted books via the
   dedicated, audited consolidation service (INV-026: consolidation runs **never write
   member books**); members must have **closed fiscal periods** before a run (BR-056).
3. **Eliminations via the engine in the parent's books**: elimination entries are
   balanced journals posted by the posting engine into the parent tenant's consolidation
   books with source_type `CONSOLIDATION_ELIMINATION` (G-32 intercompany AR/AP shape);
   reversible **only by counter-entry** (BR-056) — INV-006 source chain and INV-013
   idempotency apply like any journal.
4. **FX translation with dated rates** (INV-008 conventions) into the group's base
   currency. **Method decision (OQ-V2-2 — RESOLVED 2026-11-09, decision record
   DR-P34-FX-1): CLOSING_RATE is the default; the shipped method is an explicit
   per-group configuration (`fx_translation_method ∈ {CLOSING_RATE, TEMPORARY}`),
   defaulting to CLOSING_RATE.** Under CLOSING_RATE, income-statement lines
   translate at each member's period-rate (= the dated stored rate at the period
   end) and balance-sheet lines at the closing rate — both strictly the stored
   INV-008 rates (amount × stored rate, never recomputed); a group configured
   TEMPORARY additionally translates non-monetary items at transaction-date
   stored rates with the equity-recycling delta surfaced as a
   `CONSOLIDATION_ADJUSTMENT` elimination line — bounded to exactly what ships
   at PHASE-034 (no waterfall automation, the §5 posture). Missing rates fail
   closed (`RATE_MISSING`); 3-decimal currencies (KWD-style) ride the ordinary
   dated-rate machinery.
5. **Consolidated statements are derived artifacts** (INV-026): consolidated TB/IS/BS =
   Σ member statements (group currency, dated FX) − eliminations; they never replace
   member statutory books.

## Consequences

- Tables `consolidation_groups`, `group_entities`, `elimination_entries`,
  `consolidation_runs` land at PHASE-034 per
  [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §C; feature keys
  `consolidation.*` (5) per §D; reports `consolidation.consolidated-tb`, `consolidated-is`,
  `consolidated-bs`, `eliminations-log` per §J.
- INV-026 joins the invariant suite; G-32 joins the golden postings;
  `consolidation.eliminations.post` is approval-gated with SoD (register §K).
- The consolidation service is the **only sanctioned cross-tenant reader** — the
  interoperability cost accepted by ADR-0018; every other module stays single-tenant.
- Ownership percent is recorded for disclosure and minority-interest presentation, but
  full minority-interest accounting beyond elimination math is **not promised** at
  PHASE-034; anything beyond the register's scope needs an amendment here.
- Enterprise Depth release gate (post-034): consolidated statements reconcile to member
  books with eliminations proven (register §B).

## Revisit conditions

- ~~The FX translation method decision (closing-rate default proposed — OQ-V2-2) lands via
  the open question → amend §4 of this record with the chosen method.~~ **RESOLVED
  2026-11-09** — see the §4 amendment above (CLOSING_RATE default, per-group
  `fx_translation_method`, TEMPORARY bounded to the PHASE-034 surface); OQ-V2-2 is
  closed in [../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md).
- Regulatory demand for a mandated translation method in a target jurisdiction → a
  compliance-folder record may pin a group's method; the per-group configuration is
  the seam.
- Statutory consolidated filings are mandated in a target jurisdiction → compliance-folder
  record with official sources feeding the reports.
- Demand for intercompany document automation (orders/invoices between members) → new
  ADR + accounting record; explicitly out of scope here (ADR-0018 revisit triggers agree).

## Approval

ACCEPTED 2026-10-28 — product owner, under the platform-expansion umbrella record
([product/DR-003](../product/DR-003-platform-expansion-v2.md)); the architecture owner
countersigns via [ADR-0018](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md);
the accounting domain owner countersigns INV-026 and the engine-posted eliminations
policy.
