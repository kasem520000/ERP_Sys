# ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS — Unresolved Decisions, Assumptions, and Risks

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-11-09 (PHASE-034 T1: OQ-V2-2 RESOLVED — decision record DR-P34-FX-1 amending [decisions/accounting/DR-006](decisions/accounting/DR-006-consolidation.md) §4; first open-question closure on this list, kept visible per the decision-record rule)
> **Authority:** Consolidated live list of what is **not yet decided or not yet proven**.
> Domain risk detail remains in [planning/RISK_REGISTER.md](planning/RISK_REGISTER.md)
> (R-xxx) and [ASSUMPTIONS_AND_OPEN_QUESTIONS.md](ASSUMPTIONS_AND_OPEN_QUESTIONS.md)
> (A-xxx / OQ-xxx); this document adds the consolidation-pass items (R-C-xx, OQ-C-xx),
> the Blueprint v2.0 expansion items (OQ-V2-xx), and indexes the rest. **Nothing on this
> list may be silently resolved by an implementing
> agent** — each requires a decision record or the stated validation.

## 1. Open questions requiring product-owner decisions

| ID | Question | Blocking? | Default while open |
|----|----------|-----------|--------------------|
| OQ-002 | Plan pricing and all numeric subscription limits (PLACEHOLDER throughout) | Blocks commercial launch, not engineering | Placeholder values flagged; entitlement machinery independent of numbers |
| OQ-001 | Product branding/legal name | Marketing surfaces only | "the Platform" |
| OQ-009 | Retention/offboarding windows (90-day data, 7-year audit) are engineering defaults pending legal review | Compliance review at PHASE-024 | Defaults stand until reviewed |
| OQ-C-1 | Offline financial statements (TB/BS on devices) — currently online-only everywhere | Feature scope decision + ADR (touches posting-authoritative principle) | Stay online-only; documented limitation |
| OQ-C-2 | PHASE-023 split (ZATCA vs other adapters) if certification lead times pressure GA | Roadmap decision | Keep single phase; DR-001 may defer clearance post-GA |
| OQ-V2-1 | Payroll jurisdiction contribution/EOS tables — GOSI-style social-insurance rates and end-of-service legal scales **REQUIRE_VERIFICATION** against official sources per country before any jurisdiction-specific payroll default is enabled; components stay tenant-configured, **zero fabricated rates** (Blueprint v2.0, [accounting/DR-005](decisions/accounting/DR-005-payroll-scope.md)) | Blocks jurisdiction-specific payroll defaults only — the PHASE-029 financial-payroll module itself proceeds | Tenant-configured components; templates ship empty component shells with documentation pointers; no seeded rates |
| OQ-V2-2 | ~~Consolidation FX translation method — **closing-rate vs temporal**~~ **RESOLVED 2026-11-09 (PHASE-034 T1 decision record DR-P34-FX-1, amending [decisions/accounting/DR-006](decisions/accounting/DR-006-consolidation.md) §4): CLOSING_RATE default, explicit per-group `fx_translation_method` configuration (CLOSING_RATE / TEMPORARY — TEMPORARY bounded to the PHASE-034 surface with the equity-recycling delta as a CONSOLIDATION_ADJUSTMENT elimination line); dated-rate mechanics (INV-008) unchanged; missing rates fail closed (`RATE_MISSING`)** | Resolved before executor tasks merged, as PHASE-034 required | N/A — the decision is recorded and the executor reads the method from group config only |

## 2. Assumptions explicitly relied upon (selected — full list in ASSUMPTIONS_AND_OPEN_QUESTIONS.md)

| ID | Assumption | Impact if wrong |
|----|------------|-----------------|
| A-002 | Single legal entity per tenant at MVP; intercompany post-GA | Tenant model unchanged at MVP; consolidation features deferred (documented non-goal) |
| A-014 | Cheque tracking without bank integration at MVP | Manual deposit/clear workflows |
| A-DEF | DEF-005 verification: `journal_entries.entry_no` NULL only for DRAFT rows ("assigned at posting, immutable" — CASCADE note `core-accounting.md` L121) | None — verified against spec, recorded as no-defect |

## 3. Top architectural risks (indexed from RISK_REGISTER + consolidation additions)

| ID | Risk | Sev | Likelihood | Mitigation / owner | Status |
|----|------|-----|------------|--------------------|--------|
| R-DB-1 | Per-tenant PITR not available until justified | M | L | Same-region PITR + tenant-aware restore drills; revisit for enterprise tier | OPEN (post-GA) |
| R-DB-2 | `journal_lines`/`stock_moves` unbounded growth (no partitioning at MVP) | M | M (per tenant scale) | Archival design post-GA; monitor at ~10M lines/tenant | OPEN (post-GA) |
| R-PERF-1 | Posting p95 < 300 ms on MVP sizing unproven | H | M | PERFORMANCE_TEST_PLAN T-02 gates PHASE-025 | TO BE TESTED |
| R-SYNC-1 | Offline serial double-sell (two terminals, last unit) | M | M | Acknowledged business case #35; receipt-level warnings + reconciliation | ACCEPTED (documented) |
| R-ZATCA-1 | Wire-level ZATCA conformance unverified until DR-001 executes | H | M | UNVERIFIED stubs refuse to execute; verification log starts PHASE-009 | OPEN |
| R-COM-1 | 10-jurisdiction verification is standing work needing a named compliance owner | M | H | Verification protocol + downgrade-on-alert; staffing is a product decision | OPEN |
| R-C-1 | Consolidation added scope (DEF-010 trigger, tafqit, status tokens, effect-matrix gate) could quietly drop from phase acceptance if phase docs are not updated | M | L | Roadmap §2 "Consolidation deltas" binds each to a phase; validation report re-checks at consolidation end; each phase's completion report must reference its deltas | MITIGATED (monitor) |
| R-C-2 | The earlier comparison report's two adoption suggestions (pack pinning; Sev-1 reconciliation) were **reversed by source verification** — future merges must re-verify, not trust summaries | M | L | Stage-B rule written into this consolidation's register (CR-2-F2-04 / CR-4-F4-07) | MITIGATED (process rule) |

## 4. Known documentation gaps (honest, tracked)

1. **Data dictionary coverage** grows per phase by policy (anti-speculation): implementing
   agents must add column specs in the same PR as the table (binding rule,
   [database/DATABASE_ARCHITECTURE.md](database/DATABASE_ARCHITECTURE.md) §2). Current
   coverage: foundation + accounting core + tax-compliance clusters.
2. **Fixed assets** have a feature key and purpose-adjacent accounts but no TABLES spec —
   gated behind the PHASE-025 scope review (CR-1-F1-11); must not be smuggled into a phase
   without that review.
3. **Verification log is empty by design** — no jurisdiction fact is TESTED yet; the
   compliance matrices are research artifacts until PHASE-009+ work executes.
4. Phase docs 008/011/012/015/etc. now carry consolidation deltas in the roadmap; if a
   phase doc and the roadmap disagree on those deltas, **fix the doc to match the roadmap**
   (the roadmap is the consolidation-era authority for delta placement).

## 5. Definition of "resolved"

An item leaves this document only via: (a) an accepted ADR/DR recording the decision, or
(b) recorded passing evidence (test execution, official-source verification) — in either
case cross-linked here first. Verbal resolution in a meeting is not resolution.
