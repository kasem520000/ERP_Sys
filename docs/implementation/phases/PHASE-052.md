# PHASE-052 — Workflow & Approvals Engine

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 3 / Stage 14 · **Register:** [CR-22](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-14 · §16 W-01…W-12 · §20 UX-13 · §28 PP-17 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §3 row 12

## 1. Phase Overview

- **Phase ID:** PHASE-052
- **Title:** Workflow & Approvals Engine (محرك سير العمل والموافقات)
- **Objective:** Replace the single-step approvals model (`approval_policies.policy` jsonb +
  one `approval_step` integer) with a general, tenant-configurable workflow engine:
  multi-step approval chains with conditional branching on amount, department, and custom
  fields; delegation during absence with self-approval protection; SLA escalation and
  reminders; approve-by-email/mobile through signed deep links; a full step-history
  timeline on every document; document-linked tasks; rules-engine alerts; and outbound
  event hooks that later feed the webhook platform. Existing `approval_policies` migrate
  and bridge into the new definitions without breaking any in-flight document.
- **Business value:** The audit's H-14 impact statement is direct: any company beyond
  ~30 employees needs a real permission matrix, and today a PO of any size gets one
  approval step. Conditional chains (PO > 50k → manager → finance → CEO) unlock the
  mid-market segment; the approval inbox plus mobile approve shortens cycle time from
  days to hours; the visible approval timeline (PP-17) is an enterprise checkbox in every
  demo; and the event bus emitted here becomes the substrate the API/webhook platform
  and payment integrations consume later in this wave.
- **الملخص التنفيذي (AR):** تحوّل هذه المرحلة الموافقات من خطوةٍ واحدة جامدة إلى محرك سير عمل كامل: سلاسل موافقة متعددة المستويات بتفريعٍ شرطي على المبلغ والقسم والحقول المخصصة، تفويضٌ أثناء الغياب مع منعٍ صارم للموافقة الذاتية عبر التفويض (G-67)، تصعيدٌ تلقائي عند تجاوز مهلة الخطوة مع تذكيرات دورية، موافقةٌ عبر البريد والجوال بروابط موقّعة أحادية الاستخدام، صندوق موافقات ومخطط زمني مرئي لكل خطوة على كل مستند (PP-17)، مهام مرتبطة بالمستند وتنبيهات قواعد ذكية (UX-13)، وجسرٌ يحوّل سياسات الموافقة الحالية إلى تعريفات سير عمل دون كسر أي مستند قائم — مع إطلاق أحداثٍ صادرة تُغذّي لاحقاً منصة الويب-هوكس.

## 2. Scope

In scope:

1. **`workflow_definitions`** (W-01, W-02): tenant workflow definitions bound to a
   trigger entity + event (e.g. purchase_order + SUBMITTED), an `active` flag, and
   entry `conditions` jsonb evaluated against the document context at trigger time.
2. **`workflow_steps`** (W-02, W-05): ordered steps with type APPROVAL / NOTIFICATION /
   TASK; assignee rule ROLE / USER / FIELD / FORMULA (document-derived, e.g. the
   owner's manager); branch conditions on amount thresholds, department, and custom
   fields surfaced by PHASE-036; per-step SLA hours.
3. **`workflow_instances`** (W-07): one instance per triggered document — entity
   reference, current step pointer, terminal state, immutable on completion (INV-037).
4. **`workflow_step_instances`** (W-07, PP-17): per-step state PENDING / APPROVED /
   REJECTED / SKIPPED / DELEGATED with assignee, `delegated_to`, `acted_at`, and
   `comment` — the complete step-history record the timeline renders.
5. **`delegations`** (W-03): absence windows with from→to users and scope
   (module / entity / all); active windows re-route PENDING steps at resolution time.
6. **`escalation_events`** (W-05, W-06): SLA-breach detection producing escalation
   (reassign / add level) or notification actions, plus recurring reminders.
7. **Engine hooks on document state transitions** (H-14, W-01, W-02): subscriptions on
   the existing document lifecycle (DRAFT→SUBMITTED and siblings) across modules;
   conditional multi-level chains — the exemplar scenario is a PO above 50,000 routing
   manager → finance → CEO while smaller POs stop at the manager.
8. **Email/mobile approve** (W-04): signed one-time deep links (approve / reject with
   comment) into the companion approvals affordance; links are bound to user +
   instance + action and expire after use or deadline.
9. **Screens**: `/settings/workflows` visual chain editor (ordered steps, branch
   conditions, SLA), the approval inbox (pending items with aging), and a timeline
   component embedded on every document detail page (PP-17).
10. **Document-linked tasks** (W-08): the TASK step type creates assignable,
    due-dated tasks attached to the triggering document and visible in the task list.
11. **Rules-engine alerts** (W-11, UX-13): threshold/condition rules (amount, aging,
    custom fields) raise configurable alerts into the notification system.
12. **Outbound event hooks** (W-12): workflow lifecycle events (instance started, step
    approved/rejected, instance completed) emitted on an internal event bus — the
    delivery layer (endpoints, retries, HMAC) is the webhook platform of PHASE-055.
13. **`approval_policies` migration/bridge**: one-time conversion of existing
    single-step policies into definitions + steps, plus a compatibility mode so
    in-flight documents finish under the old semantics; mapping recorded in the
    completion report.

Out of scope: webhook endpoint delivery and retry platform (055) · BI alert surfaces
(057) · general form builder (W-09 — served by the PHASE-036 form designer) ·
free-form custom actions beyond the three step types (W-10 — recorded as a platform
note in the decisions) · BPMN import/export · workflow versioning beyond an immutable
definition snapshot per instance.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-036 (Extensibility Core) COMPLETE | REQUIRED — NOT_STARTED (planned, Wave 1) |
| Document lifecycle state machine (DRAFT → SUBMITTED → APPROVED → POSTED) | SHIPPED stages 1–11 (audit §21 item 11) |
| `approval_policies` + `approval_step` baseline | SHIPPED — bridge source |
| PHASE-041 Communications Hub (email/WhatsApp delivery channels) | SEQUENCED BEFORE by wave order; approve links degrade to in-app only if late |

Branch conditions reference custom fields delivered by PHASE-036; delegation and
escalation build on the existing users/roles model. Per
[COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5 this phase opens
Wave 3 and hard-requires only 036.

## 4. Design Impact

- **Migrations**: 4, next in sequence — `0090_workflow_definitions.sql` (definitions +
  steps), `0091_workflow_instances.sql` (instances + step instances),
  `0092_delegations_escalations.sql`, `0093_approval_policies_bridge.sql`. The journal
  continues from wherever the Wave-1/2 phases (036–051) leave it (expected 0049…0089);
  exact numbers are assigned at implementation time as the next free sequence, strictly
  increasing, with `_journal.json` + `migrations.ts/spec` updated per house convention.
- **Entities/catalog**: +6 tables (`workflow_definitions`, `workflow_steps`,
  `workflow_instances`, `workflow_step_instances`, `delegations`,
  `escalation_events`) — SQL + Drizzle mirror + `ENTITY_CATALOG.md` rows (CR-36 a).
- **Permissions**: +9 `platform.workflow.*` keys (manage definitions, approve, act on
  inbox, delegate, view history, configure escalation, manage document tasks, manage
  delegations, administer engine settings); zero-drift check re-extended (registry =
  seed, cumulative v3.0 count, no drift).
- **i18n**: ~180 new AR/EN dictionary keys (chain editor, inbox, timeline, delegation,
  escalation, tasks); the 4,186-style parity check is extended (AR = EN per key).
- **Docs** (reservations re-coordinated 2026-11-13 per [../../planning/ID_LEDGER.md](../../planning/ID_LEDGER.md) — the original plan's G-68/INV-036 predate the 044 wave's consumption of those slots): `BUSINESS_WORKFLOWS.md` (engine semantics), `JOURNAL_RULES.md` (G-67),
  `ACCOUNTING_INVARIANTS.md` (INV-037), `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`,
  `FEATURE_CATALOG.md`, `NAVIGATION_MODEL.md` (+3 nav items), decision records for
  the bridge policy and the W-10 scope note.
- **Reports**: +2 contracts — `workflow.pending-approvals`, `workflow.sla-aging`
  (catalog rows mandatory per CR-36).
- **Feature flags**: `platform.workflow.definitions`, `platform.workflow.engine`,
  `platform.workflow.delegation`, `platform.workflow.escalation`,
  `platform.workflow.tasks` — template-composable grants per the plan-entitlement
  convention.
- **No architectural change** — a new module inside the modular monolith subscribing
  to existing lifecycle transitions; offline sync assessment recorded: inbox/timeline
  read surfaces assessed for the sync clients, approve actions are online-only by
  design (CR-36 g).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations 0090–0093 (definitions/steps, instances/step-instances, delegations/escalations, policy bridge) + journal/spec updates | api |
| T-02 | Drizzle mirrors + `ENTITY_CATALOG.md` rows + RLS policies + attack tests A1–A10 for the six new tables | api |
| T-03 | Workflow engine core: trigger resolution on document state transitions, conditions + branch evaluation, instance/step state machine | api |
| T-04 | Delegation resolution (absence windows, scope) + escalation/reminder jobs on the scheduler + G-67 enforcement | api |
| T-05 | `approval_policies` bridge: conversion tool, compatibility mode, parity tests, mapping record | api |
| T-06 | Email/mobile approve actions: signed one-time deep links, comment capture, expiry handling | api |
| T-07 | Outbound event bus emission (workflow lifecycle events) + rules-engine alert adapters (UX-13) | api |
| T-08 | Document-linked tasks: TASK step type, assignment, due dates, completion write-back | api |
| T-09 | Golden G-67 (no self-approval through delegation) + INV-037 (instance immutability post-completion) tests and doc entries | api |
| T-10 | Build `/settings/workflows` chain editor (ordered steps, branch conditions, SLA, assignee rules) | web |
| T-11 | Build the approval inbox screen with aging indicators and quick actions | web |
| T-12 | Build the document timeline component and embed it on document detail pages (PP-17) | web |
| T-13 | Navigation + ⌘K registration for the new screens (OA-04); AR/EN keys; RTL verification | web |
| T-14 | Report contracts `workflow.pending-approvals` + `workflow.sla-aging` with tests and catalog rows | api |
| T-15 | Update `BUSINESS_WORKFLOWS.md`, `FEATURE_CATALOG.md`, `NAVIGATION_MODEL.md`; author the two decision records | docs |
| T-16 | Run full local gates (typecheck/lint/boundaries/tests/docs/i18n parity/permissions drift/manifests) and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations 0090–0093 apply cleanly with Drizzle mirrors and `ENTITY_CATALOG.md`
   rows; RLS attack tests A1–A10 pass for all six new tenant tables.
2. The seeded conditional-chain scenario works: a PO above 50,000 routes
   manager → finance → CEO; at or below 50,000 it stops at the manager; a branch on a
   PHASE-036 custom field selects a different chain (integration test).
3. Delegation: an active absence window re-routes PENDING steps to the delegate within
   scope only; expired windows stop routing; circular delegations are rejected at save.
4. Golden G-67: an actor cannot approve their own document through a delegation chain
   (directly or transitively) — covered in the golden suite and documentation.
5. Escalation: a step left past its SLA hours produces an `escalation_events` row and
   fires the configured escalation/notification plus reminders via the scheduler.
6. Email/mobile deep-link approve and reject: the action is one-time, records the
   actor, `acted_at`, and comment, updates the timeline; replayed or expired links are
   rejected with a clear error.
7. The timeline component renders the full step history (state, assignee,
   `delegated_to`, `acted_at`, comment) on documents across modules, and the approval
   inbox lists PENDING work with aging — PP-17 satisfied with AR/EN parity and RTL.
8. INV-037: terminal workflow instances are immutable — any mutation attempt after
   completion is rejected by the service layer and covered by an invariant test.
9. The `approval_policies` bridge converts seeded policies without behavior change
   (parity test on documents gated before/after), and in-flight documents complete
   under compatibility semantics.
10. All CR-36 discipline gates green (SQL+Drizzle+catalog parity, permissions
    zero-drift, AR/EN parity, `docs:validate`, RLS tests, feature flags, sync-surface
    assessment recorded); completion report
    `reports/PHASE-052-COMPLETION.md` appended with evidence; `IMPLEMENTATION_STATUS.md`
    row flipped; archive delivered as `ERP_PLATFORM_PHASE052.zip` (OA-07).

## 7. Risks and Constraints

- **Engine latency on hot paths** — every SUBMITTED transition now evaluates workflow
  definitions; mitigated by indexed trigger lookups, short-circuit condition
  evaluation, and asynchronous instance creation where posting order allows.
- **Delegation abuse** — circular or self-serving delegation chains; mitigated by the
  G-67 golden plus delegation-graph validation at save time.
- **Bridge backward compatibility** — existing tenants depend on `approval_policies`
  semantics; mitigated by the compatibility mode, the parity test, and a recorded
  mapping before any cutover.
- **Deep-link security** — approve-by-email must not become an unauthenticated action
  surface; mitigated by signed, single-use, expiring tokens bound to user + instance +
  action, never embedding the raw session.
- **Visual editor scope creep** — a full drag-everything editor is a large surface;
  mitigated by shipping a structured form-first editor with visual ordering and branch
  display, deferring free-canvas editing.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-052-COMPLETION.md`
  (evidence per acceptance criterion, gate output, the bridge mapping table, the
  event-bus topic list handed to the API platform).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-052 row → COMPLETE; `NEXT_ACTION.md`
  → PHASE-053 (Accounting Depth & Treasury) with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE052.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-053».
- Handoff notes for PHASE-053: treasury operations (FX revaluation runs, netting
  documents, intercompany vouchers) gate their posting through the approval chains
  delivered here; the outbound event bus emitted here is the ingestion surface
  PHASE-055 turns into public webhooks.
