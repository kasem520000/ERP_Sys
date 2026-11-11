# Roadmap v3.1 — Gap Consolidation Report

> **Status:** COMPLETE · **Updated:** 2026-11-11 · **Kind:** planning-consolidation
> deliverable (no production code — documentation and planning infrastructure only)
> **Governing decisions:** [CR-41…CR-48](../../../planning/COMPLETENESS_REGISTER.md)

## What this was

The owner's strategic directive (2026-11-11): two later audit rounds had discovered
**43 additional gaps** whose knowledge existed only in working conversations — none of
them referenced anywhere in `docs/planning/`. Before resuming execution at PHASE-039,
the program paused for a **documentation-only consolidation wave**: persist every gap,
triage every one with evidence, place every one in the plan, and harden the process so
the pattern never recurs.

## The 43 new gaps and where they landed

### Layer 1 — the 23 operational gaps ([GAP_ANALYSIS_LAYER1_23_GAPS.md](../../../planning/gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md))

| Disposition | Count | The gaps |
|---|---|---|
| **SHIPPED** (closed with evidence — never re-planned) | 2 | L1-06 petty cash (BR-020 + `cash_accounts` PETTY, PHASE-008) · L1-14 official statements (`partner.statement` 012 / `supplier.statement` 011) |
| **NEW PHASE 068** (the all-gaps accrual/recurring family) | 7 | L1-01 deferred revenue · L1-02 revenue recognition · L1-03 prepaid · L1-04 recurring invoices (residual) · L1-05 monthly accruals (residual) · L1-15 standing orders (customer side) · L1-16 subscription depth (residual) |
| **PHASE-039** (decided pre-039, the owner mandate) | 3 | L1-10 credit-review workflow · L1-11 collection agencies · L1-12 late-payment fees |
| **PHASE-053** | 3 | L1-07 travel layer (residual over BR-023) · L1-08 mileage · L1-09 corporate cards |
| **PHASE-058** | 4 | L1-13 signing-authority matrix (residual over BR-034) · L1-17 board resolutions · L1-18 risk register (ID binding) · L1-19 contractual compliance |
| **PHASE-040 + 062** (split) | 1 | L1-21 productivity → export templates → 040 · batch ops → 062 |
| **PHASE-044 / 054 / 055** | 3 | L1-20 returnable packaging → 044 · L1-22 intangibles → 054 · L1-23 EDI → 055 |

### Layer 2 — the 20 advanced IFRS/IAS gaps ([GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](../../../planning/gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md))

| Disposition | Count | The gaps |
|---|---|---|
| **NEW PHASE 066** — IFRS Advanced I (Measurements & Provisions, Wave 3 after 053/054) | 8 | L2-01 IAS 24 · L2-02 IAS 20 · L2-03 IFRS 5 · L2-04 IAS 40 · L2-05 IFRS 3 goodwill · L2-11 IAS 37 · L2-13 IAS 36 · L2-19 IAS 1 |
| **NEW PHASE 067** — IFRS Advanced II (Business, Ownership & Disclosure, Wave 4 after 054/066) | 7 | L2-06 IFRS 3 combinations · L2-07 IFRS 2 · L2-08/L2-09 IAS 19 · L2-10 IAS 29 · L2-16 IFRS 10 NCI · L2-18 XBRL |
| **PHASE-042** (the early decision the owner mandated before manufacturing starts) | 1 | L2-12 standard costing → 042 (its title is literally "…& Costing"; 043 consumes the frozen standard) |
| **PHASE-048** (bound to existing scope — IDs + alignment rules, no parallel scope) | 2 | L2-15 milestone billing (PR-11 + the IFRS-15 output-method alignment) · L2-20 subcontracting (PR-06 + the inbound-subcontract linkage; 043 M-21 tolling) |
| **PHASE-068** (dependency-driven: they derive from 068's own schedules) | 2 | L2-14 contract assets · L2-17 contract liabilities/RPO |

## The identifier decision (documented deviation)

The directive numbered Layer-1 as `N-01…N-23`; the `N` namespace is already taken by
the first-round **Integrations family N-01…N-21** (FULL_GAP §17 — consumed by phases
037/040/041/045/047/054/055/056/061). Keeping `N` would have made every future
citation ambiguous, so Layer-1 is numbered **L1-01…L1-23** (1:1 with the requested
list), mirroring L2. Recorded in CR-41 and both layer files.

## Count reconciliation (the 518 vs 495 question)

The three first-round reports contain **518 unique gap identifiers** (23 H + 304
module families + 191 commercial — verified by extraction, roadmap §9). The v3.0
"495" = 518 − 23 not-in-program items (UX-01, UX-10, H-10→OQ-002, HR-14/15, 14
shipped DF items, 4 DF non-goals). v3.1 adds 43 documented gaps − 2 shipped (L1-06,
L1-14) = **41 entering the plan** → **536 in-scope gaps**, 561 total documented
identifiers. Full arithmetic: [roadmap §9](../../../planning/COMPLETENESS_ROADMAP.md).

## The honest re-estimate

| | v3.0 | v3.1 |
|---|---|---|
| Phases | 31 (035–065) | **34** (+066/067/068) |
| In-scope gaps | 495 | **536** (+41) |
| Single-agent effort (all v3.x phases) | 116–156 weeks | **~136–185 weeks** |
| Delivered so far | 035–038 | 035–038 (~15–22 weeks) |
| Remaining | ~101–141 weeks | **~121–171 weeks** (~2.3–3.3 years single-agent) |

The number grew because the scope grew — stating it plainly is the point (CR-41's
policy: everything enters the plan). The wave-parallel sets (roadmap §5, dependency
graph v3.1 section) are the lever for team execution.

## Process hardening (so 035/036-style loss never recurs)

1. **The gap-intake protocol (CR-47, roadmap §8):** every newly discovered gap gets
   an ID + severity + effort + phase home **in the same commit**. Gap knowledge
   living only in a conversation is a defect.
2. **The completion triple-flip (CR-48):** phase doc header + IMPLEMENTATION_STATUS
   row (including its own header line — the line-3 lesson fixed this round) +
   completion report with the **mandatory code-evidence checklist** (schema.ts line
   numbers, migration names, page paths, test counts, permission counts) — the
   template now enforces it.
3. **The validator extended:** `scripts/validate_docs.py` now checks 68 phase docs,
   the 066–068 range, CR-48 presence, and the two layer files (check 8c).

## Files touched (this consolidation)

**Created (6):** the two gap-analysis layer files · PHASE-066.md · PHASE-067.md ·
PHASE-068.md · this report.
**Updated (16):** COMPLETENESS_ROADMAP.md (v3.1 header, §0–§9) ·
COMPLETENESS_REGISTER.md (CR-41…48, §B, OA-08) · IMPLEMENTATION_STATUS.md (header
line 3 fixed to 038; the v3.1 note; +3 ledger rows) · PHASE_DEPENDENCY_GRAPH.md ·
RISK_REGISTER.md (RISK-026…028) · NEXT_ACTION.md · COMPLETION_REPORT_TEMPLATE.md ·
scripts/validate_docs.py · and the ten phase docs 039/040/042/044/048/053/054/055/
058/062 (scope extensions + effort updates + gap-ID bindings).

## Definition-of-done check (the owner's criteria)

- [x] The two layer files exist with L1-01…L1-23 / L2-01…L2-20 (the L1 prefix is the
      documented CR-41 deviation from the requested N-xx — collision with the
      Integrations family)
- [x] Every one of the 43 gaps has exactly one disposition: SHIPPED (2, with
      evidence) / existing phase (17, named) / new phase 066/067/068 (24)
      *(count corrected 2026-11-11 in the v3.2 commit — the original line said
      15/26, contradicting the tables above: Layer 1 into existing phases 14 +
      Layer 2 into 042/048 3 = 17; into 066/068 7+2 and 067 8+7 = 24)*
- [x] PHASE-066/067 created per the official template with Arabic executive
      summaries (+ PHASE-068 under the owner's new-phase authorization)
- [x] L2-12 and L2-20 (and L2-15) have documented decisions re 042/043 and 048 —
      made before those phases start (CR-45)
- [x] Roadmap + register + status + risk register + dependency graph all updated
      and mutually consistent
- [x] IMPLEMENTATION_STATUS line 3 reflects PHASE-038
- [x] The honest re-estimate is explicit (§ above)
- [x] Commits carry `roadmap: v3.1 gap consolidation` messages

## What happens next

PHASE-039 — with its scope now final (RMA + dunning + the three v3.1 additions:
credit-review workflow, late-fee engine, collection-agency layer). Start with
«ابدأ تنفيذ المرحلة PHASE-039». Await the owner's go-ahead per the directive.
