# Implementation — How Phases Work

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28

## Structure

- [phases/](phases/) — `PHASE-001.md` … `PHASE-034.md`: one document per phase (001–025
  are the v1.1 baseline; 026–034 are the Blueprint v2.0 post-GA expansion phases, stages
  9–11, per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §B). Each
  phase document contains the **29 mandatory content items** required by the directive,
  distributed across **8 numbered sections** (mapping below).
- [phases/reports/](phases/) — completion reports, named `PHASE-NNN-COMPLETION.md`,
  created by the implementing agent at phase end (template:
  [templates/COMPLETION_REPORT_TEMPLATE.md](templates/COMPLETION_REPORT_TEMPLATE.md)).
- [templates/](templates/) — phase template, completion-report template, code-review
  template.

## Ground rules (normative)

1. **One phase at a time.** An implementing agent executes exactly the requested phase —
   never earlier phases, never later ones, never "adjacent improvements".
2. **Prerequisites verified, not trusted.** Before starting, the agent verifies each
   prerequisite phase is `COMPLETE` in
   [../planning/IMPLEMENTATION_STATUS.md](../planning/IMPLEMENTATION_STATUS.md) with a
   completion report + passing CI evidence. Missing prerequisite ⇒ stop and report
   (never implement the prerequisite silently).
3. **Exit criteria are the contract.** Code existing ≠ done. Tests passing + criteria
   verified + docs updated + completion report = done.
4. **Docs stay authoritative.** Implementation updates the docs it affects in the same
   phase (schema catalog, status, changelog). Drift = phase not complete.
5. **Architecture changes are forbidden mid-phase.** If implementation reveals an
   architectural problem, the agent stops, documents the contradiction, and files a
   decision record + ADR proposal instead of improvising.

## Phase document format

Every phase document contains all **29 mandatory content items** (directive §19),
distributed across **8 numbered sections** — the mapping is normative and CI-validated:

| § | Phase document section | Directive §19 items covered |
|---|------------------------|------------------------------|
| 1 | Phase Overview | 1 Phase ID & title · 2 Objective · 3 Business value |
| 2 | Scope | 4 Scope · 5 Explicit out-of-scope |
| 3 | Prerequisites | 6 Prerequisite phases · 7 Required architecture decisions · 8 Documentation references |
| 4 | Design Impact | 9 Database · 10 API · 11 UI · 12 Security & authorization · 13 Accounting · 14 Localization · 15 Offline · 16 Module dependencies |
| 5 | Implementation Plan | 17 Ordered tasks · 18 Expected files / module boundaries |
| 6 | Verification | 19 Automated tests · 20 Manual verification · 21 Acceptance criteria · 22 Performance & security · 23 Migration & rollback |
| 7 | Risks and Constraints | 24 Known risks |
| 8 | Completion and Handoff | 25 Completion evidence · 26 Documentation updates · 27 Exit criteria · 28 Definition of Done · 29 Handoff instructions |
