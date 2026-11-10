# PHASE-NNN — <Title>

> **Status:** PLANNED | IN_PROGRESS | COMPLETE · **Updated:** <date>

<!-- TEMPLATE: copy this file for every new phase document. The 29 mandatory content
     items (per directive §19) are distributed across the 8 numbered sections below —
     the mapping is listed in implementation/README.md §"Phase document format".
     Keep ALL 8 sections, in order, with these exact headings (CI validates headings).
     Delete this comment. -->

## 1. Phase Overview

- **Phase ID:** PHASE-NNN
- **Title:** …
- **Objective:** … (one paragraph, outcome-oriented)
- **Business value:** … (who gains what)

## 2. Scope

- In scope: …
- **Explicitly out of scope:** … (as important as in-scope)

## 3. Prerequisites

- Required phases: PHASE-XXX (what from it, verified how)
- Required architecture decisions: ADR-XXXX (title) — summary of the binding constraints
- Relevant documentation: relative links to the documents that govern this phase

## 4. Design Impact

- **Database changes:** new/changed tables (with catalog entry commitments), RLS, seeds
- **API changes:** endpoints/contracts added/changed
- **UI changes:** screens/archetypes affected
- **Security & authorization:** new permissions, roles, attack-test additions
- **Accounting implications:** posting rules touched; invariants gained/reused (INV-xxx)
- **Localization implications:** new strings (AR+EN), formats, RTL concerns
- **Offline implications:** offline-capability matrix additions, sync considerations
- **Module dependencies:** modules touched and direction of dependency

## 5. Implementation Plan

Ordered tasks (T1…Tn), each: description · expected files/module boundaries · test hook.

## 6. Verification

- **Automated tests:** suites/cases required (names + intent; failure cases mandatory)
- **Manual verification:** steps a human/agent performs in a running system
- **Acceptance criteria:** objective, checkable statements (copied into
  [../../planning/PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md))
- **Performance & security considerations:** budgets, checks
- **Migration & rollback:** migration list + rollback path

## 7. Risks and Constraints

- Known risks: (RISK-xxx links or new) · mitigations
- Constraints: …

## 8. Completion and Handoff

- **Completion evidence:** what the completion report must contain (commands, outputs,
  test names, screenshots-as-secondary)
- **Documentation updates required:** docs this phase MUST update before completion
- **Exit criteria:** the gate list for COMPLETE status
- **Definition of Done:** the precise state of repo, tests, docs, status files
- **Handoff instructions:** what the next agent needs to know; next eligible phase
  (identify, do not implement)
