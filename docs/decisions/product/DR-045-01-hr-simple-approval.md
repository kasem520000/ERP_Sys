# DR-045-01 — HR Approvals: The Simple-Approval Model (PHASE-052 Is the Upgrade Path)

> **Status:** ACCEPTED · **Owner:** Product Owner · **Updated:** 2026-11-16 ·
> **Date:** opened 2026-11-10, accepted 2026-11-16 (delivered with PHASE-045 T-07/T-06) ·
> **Approver:** Product Owner (author: HR Domain Architecture) ·
> **Source:** [CR-15](../../planning/COMPLETENESS_REGISTER.md) (Blueprint v3.0 — the HR core) ·
> **Related:** [INV-031](../../accounting/ACCOUNTING_INVARIANTS.md),
> [BR-083/BR-084](../../product/BUSINESS_RULES.md),
> PHASE-045 ([../../implementation/phases/PHASE-045.md](../../implementation/phases/PHASE-045.md)),
> PHASE-052 (the workflow engine — the upgrade path)

## Context

The HR core (PHASE-045) needs approval semantics for two document families: **leave
requests** (PENDING → APPROVED/REJECTED/CANCELLED, the approval decrements the balance
in the same transaction) and **overtime entries** (PENDING → APPROVED/REJECTED, the
approve clears BR-084's exception flag and sanctions the time). The audit gap (HR-02)
demands the lifecycle NOW; the platform's full multi-step workflow engine is planned at
**PHASE-052** (the register's W4 polish wave). Deep-hierarchy approvals (HR manager →
department head → GM, delegations, escalation timers) are NOT part of the HR core's
scope, and building a bespoke mini-engine inside the phase would duplicate PHASE-052's
substrate and have to be migrated later.

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. Simple one-step approval (adopted)** | A single decide hop: any holder of the module key (`hr.leave` / `hr.overtime`) approves or rejects; decided requests never re-decide (the 0083/0082 decided-stamps law); the balance/cap side-effects ride the same transaction | Ships the audited lifecycle now; zero bespoke engine; the PENDING state, the decided stamps, and the audit trail are the exact hooks a future engine attaches to | No multi-step chains, no delegation, no escalation — fine for ≤ 2-tier orgs, thin for deep hierarchies |
| **B. Build a mini workflow engine inside PHASE-045** | Step chains, approver sets, timers — HR-local | More coverage in one phase | Duplicates PHASE-052's substrate; double migration risk; explodes the phase's scope against its own non-goals |
| **C. Defer approvals entirely to PHASE-052** | Requests recorded but undecided until the engine lands | Smallest phase | The leave balance arithmetic (INV-031) is meaningless without an approve boundary — the phase's core value (who is on leave, charged to which balance) would not ship |

## Decision

**Option A.** The simple approval is a **documented compromise, not a silent shortcut**:

1. **The lifecycle is engine-ready by construction** — the states (PENDING →
   APPROVED/REJECTED/CANCELLED), the decided-stamps columns (`decided_by`, `decided_at`,
   `decision_note`), the never-re-decide law, and the audit events are the interface a
   PHASE-052 chain consumes; the upgrade retro-fits the routing (which approver, which
   step) **without data migration** — the documents and their decisions already carry
   the shape.
2. **The money/quantity laws do not wait for the engine** — INV-031's balance cap is
   enforced at the APPROVE boundary (the typed refusal before the decrement), BR-084's
   feeding law at the overtime decision, and BR-083's charge law on every approved span;
   a multi-step chain will call the SAME boundary functions, so the invariants survive
   the upgrade unchanged.
3. **SoD today**: the approve hop rides the module management keys (`hr.leave`,
   `hr.overtime` — owner/accountant tiers per the 0086 seed); the ledger-writing goldens
   (G-50 accrual posting, G-51 encashment) ride `payroll.runs.post` — the SoD
   three-way split (create ≠ approve ≠ post) already separates the request, the leave
   decision, and the ledger effect.
4. **The reviewer's visibility is honest** — PENDING spans never charge a balance (the
   pending-days surface is visibility, not a decrement), and a pre-approval-required
   overtime entry surfaces as a first-class exception (BR-084) — nothing is silently
   fed while it awaits a decision.

## Consequences

- PHASE-052's workflow engine MUST consume the existing lifecycle tables/columns as its
  document substrate (no parallel leave/overtime request tables); its intake check
  includes proving the simple-approval rows upgrade in place.
- Until PHASE-052, deep-hierarchy organizations configure the practical workaround:
  the approve keys are role-granted, so a tenant can scope them to the HR tier that
  matches their structure (the role/permission system carries the delegation story).
- This record closes the phase plan's "simple-approval decision record" deliverable
  (PHASE-045 §4: "No new ADR — the simple-approval decision is recorded as a decision
  record referencing PHASE-052 as the upgrade path").
