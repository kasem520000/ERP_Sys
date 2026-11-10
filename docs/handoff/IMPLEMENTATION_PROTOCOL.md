# Implementation Protocol

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-27

The operating rules for implementing agents. Entry point:
[AGENT_START_HERE.md](AGENT_START_HERE.md). Ground rules overview:
[../implementation/README.md](../implementation/README.md).

## 1. Phase execution contract

1. Implement **only** the requested phase (its document is the contract: scope §2,
   tasks §5, acceptance §6, handoff §8).
2. Task order in §5 is the default execution order; deviations allowed only when
   technically forced — justify them in the completion report.
3. Every out-of-scope item in the phase document is a prohibition, not a suggestion.
4. Definition of Done (§8) is binary: it is met, or the phase is `IN_PROGRESS`.

## 2. Verification gate (every phase)

| Gate | Tooling | Pass condition |
|------|---------|----------------|
| Typecheck | `pnpm typecheck` | Zero errors |
| Lint (incl. boundaries) | `pnpm lint` | Zero errors/violations |
| Unit + property tests | `pnpm test` | Green; new invariants covered |
| Integration (DB) | Testcontainers suite | Green incl. migrations fresh+regression |
| Tenant isolation | Attack suite (new tables registered) | 0 leaks |
| API contracts | OpenAPI diff + zod schema tests | No breaking changes (or versioned) |
| UI (if touched) | Component + visual AR/EN + a11y | Green |
| Docs | `scripts/validate_docs.py` (link/headings/phase-count) + affected doc updates | Green |
| Security | gitleaks, dependency audit, permission tests for new routes | Green |

A phase is **COMPLETE** only when: all gates pass + all acceptance criteria verified
with evidence + docs updated + completion report written + status files updated.

## 3. Documentation change control

| Change type | Required process |
|-------------|------------------|
| Docs that describe implemented behavior (catalog/ERD/status) | Update in the same phase (listed in the phase's §8) |
| Clarification/typo, no behavior change | PR + CHANGELOG entry |
| Domain/business rule change | Decision record (docs/decisions/) + affected docs + CHANGELOG + tests updated |
| ADR-bound architectural change | New/superseding ADR + reason + impact analysis + migration plan + affected phases list + regression tests — **requires product-owner approval** |
| Phase scope change | Update phase doc + [MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md) + dependency graph + acceptance criteria + any downstream phase review |

If an earlier phase changes, identify which later phases need review (each phase
document's prerequisite section inverts into an "affected downstream" list —
foundational phases 001–005 changes trigger full-roadmap review).

## 4. Accounting and compliance red lines

1. All GL writes go through the posting engine ([ADR-0007](../architecture/ADR/ADR-0007-centralized-posting-engine.md));
   all invariants ([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md))
   hold at all times — a single invariant failure in any test is a release blocker.
2. No tenant configuration, industry template, or entitlement may alter posting rules
   or weaken isolation (INV-022; [../product/CONFIGURATION_ENGINE.md](../product/CONFIGURATION_ENGINE.md)).
3. No compliance feature may be implemented against unverified sources; jurisdiction
   work follows [../localization/compliance-matrix/README.md](../localization/compliance-matrix/README.md)
   statuses (BASELINE_RESEARCH → VERIFIED → IMPLEMENTED → TESTED) and the no-fabrication
   gate in [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md).
4. Offline financial data follows the conflict policies in
   [../offline/CONFLICT_RESOLUTION.md](../offline/CONFLICT_RESOLUTION.md) — no LWW for
   money, ever.

## 5. Evidence standards

- Commands + their outputs (trimmed to relevant lines), test suite names + counts,
  CI run references, migration apply logs.
- Screenshots only for visual criteria, always secondary to data assertions.
- A claim without evidence is not a claim (directive §17, §22).
- Completion reports may not contain unexplained skips/failures.

## 6. Review checklist for accepting a phase

Use [../implementation/templates/CODE_REVIEW_TEMPLATE.md](../implementation/templates/CODE_REVIEW_TEMPLATE.md);
the reviewer verifies the completion report against the phase's acceptance criteria
line-by-line and spot-checks evidence (re-run at least the invariant and isolation
suites).

## 7. Change log discipline

Every phase adds a dated entry to [CHANGELOG.md](CHANGELOG.md):
`PHASE-NNN — one-line summary — status change`. Docs-only changes get minor entries.
ADR changes get explicit "BREAKING-ARCH" entries.
