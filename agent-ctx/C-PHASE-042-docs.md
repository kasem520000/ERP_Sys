# Task C — PHASE-042 docs wave (Manufacturing I — Routing, Work Centers & Costing)

Task ID: C · Agent: docs (PHASE-042 wave, T-16-equivalent) · Date: 2026-11-12
Repo: /home/z/ERP_Sys · Scope: DOCS-ONLY (no code touched; no commit made).

## Ground truth read before writing

- Migrations `0065_routing_work_centers.sql` (schema_version 65) + `0066_standard_costing.sql`
  (66): tables, OEE views, permission seeds (0065 §13 six keys + 0066 §7 the seventh),
  role grants, CoA markers 5125/5430/5990/5995, feature plan grants (0066 §8),
  food_manufacturing manifest enablement (0066 §9).
- Services: `operation-execution-service.ts` (G-40, INV-028 machine), `rework-service.ts`
  (G-41), `downtime-service.ts` (G-42 + the `manufacturing.downtime_posting` seam),
  `standard-cost-service.ts` (revaluation), `goods-receipts.ts` (PPV shape A),
  `production-order-service.ts` (release extension + yield variance + dual mode).
- DB suites pinned as worked examples: `__db__/manufacturing/routing-execution`,
  `rework-costing`, `downtime-oee`, `standard-costing`.
- `packages/contracts/src/navigation.ts` (the ACTUAL nav ids/orders/icons/archetypes),
  `route-permissions.ts` (the guarded routes), `reporting/registry/manufacturing/*.contract.ts`
  (the four report keys/params/perms), `configuration/domain/feature-catalog.ts` (FEATURE_DEPS).

## Files touched (8 — exactly the deliverables)

1. `docs/accounting/JOURNAL_RULES.md` — §7 golden table +G-40 (operation completion,
   source `production_order` op `op_<seq>`: DR WIP · CR PRODUCTION_LABOR (var × actual
   hours) · CR PRODUCTION_OVERHEAD (fixed × actual hours)) +G-41 (rework completion, source
   `rework_order` op complete: DR REWORK_EXPENSE · CR labor · CR overhead — never the
   parent FG layer) +G-42 (downtime close, source `downtime_record` op close, BR-070
   policy-gated default off: DR DOWNTIME_EXPENSE · CR PRODUCTION_OVERHEAD at the center's
   rates × idle hours); note 13 (fail-closed purpose mapping incl. the 4 new purposes;
   PPV-at-receipt legs on the G-07 GRN journal — inventory at ACTIVE standard, PPV carries
   (actual−std)×qty, GRNI at actual, legacy shape untouched for standard-less items;
   revaluation on standard activate with revaluateStock — DR/CR inventory × (new−old)×qty
   contra STANDARD_REVALUATION; worked examples from the db suites; the numbering note).
2. `docs/accounting/ACCOUNTING_INVARIANTS.md` — new section "Manufacturing execution
   integrity (Blueprint v3.0 — PHASE-042)" with INV-028 (sequence discipline, at-most-once
   completion with the op_<seq> INV-013 key, current_operation advance, skip SoD); header
   Updated line; the closing G-21…G-32 range corrected to G-21…G-42.
3. `docs/product/BUSINESS_RULES.md` — compliance section extended to (BR-060 … BR-071);
   intro paragraph extended with the CR-12/PHASE-042 attribution + the numbering note
   (planned BR-057…060 → honest slots BR-068…071; ≈0060…0066 → 0065/0066); rows BR-068
   (one ACTIVE routing + frozen snapshot + dual mode), BR-069 (rework → REWORK_EXPENSE),
   BR-070 (downtime record-only default + `manufacturing.downtime_posting` opt-in),
   BR-071 (rates × ACTUAL times + variance records + yield variance + explicit rounding +
   rate_variance v1-zero documented honestly); header Updated line.
4. `docs/security/AUTHORIZATION_MATRIX.md` — new §3.20 `manufacturing` execution block:
   the SEVEN keys with bilingual descriptions, guarded-routes paragraph, role-grant note;
   header "permission catalog 272 → 279"; §3.8 manufacturing note gained the §3.20 pointer.
5. `docs/reporting/REPORT_CATALOG.md` — §8 "Shipped (PHASE-042, category industry)" block
   with the FOUR rows (work-center-utilization, downtime-analysis, rework-cost,
   cost-variance — EN/AR titles, source of truth, params, perms, PHASE-042) + notes
   (assertions, BR-070/069 policy visibility, v1 rate-variance zero, dual mode); header
   registry 91 → 95; §13 phase-matrix row for PHASE-042.
6. `docs/product/FEATURE_CATALOG.md` — new §27 "Module: manufacturing — execution
   extension (PHASE-042)" (appended after §25/§26, the 041 precedent): the SIX feature
   keys with AR/EN names, SHIPPED descriptions, plan grants (business + enterprise per
   0066 §8), FEATURE_DEPS edges matching `feature-catalog.ts` (work_centers leaf; routing →
   items.item_master + work_centers; shopfloor → routing + work_centers; rework →
   production_orders; downtime → work_centers; standard_costs → bom + routing), and the
   food_manufacturing enablement note (0066 §9); header Updated line. Repair: the §26 AND
   §27 table headers gained the missing "Priority" column name (041's rows carried 7 cells
   against a 6-name header — same repair applied to both so rows/headers align).
7. `docs/accounting/CHART_OF_ACCOUNTS.md` — §2 purpose registry +4 rows following the
   PRODUCTION_* format: REWORK_EXPENSE (5125), DOWNTIME_EXPENSE (5430),
   PURCHASE_PRICE_VARIANCE (5990), STANDARD_REVALUATION (5995) — bilingual names + PHASE-042
   attribution + fail-closed conditions; header Updated line.
8. `docs/ui/NAVIGATION_MODEL.md` — §1 table: the manufacturing group inserted at position
   5 (الإنتاج والتصنيع / layers, after inventory — matches the binding NAV_GROUPS order in
   navigation.ts) with downstream groups renumbered 6–11 and every group-number reference
   updated (§1.1/§1.3/§1.6/§1.7 tables, the v2.0 core-items sentence, the NavItem "one of
   the 11 groups" comment, §9's group-11 mention); new §1.8 with the five entries exactly
   as coded (manufacturing.work_centers/routings/shopfloor/downtime/standard_costs —
   routes, featureKeys, permissions, orders 10/20/30/40/50, archetypes incl. the
   Point-of-Sale §10 terminal) + the ⌘K/palette inheritance note (OA-04) + the
   Operations-tab/rework-ride-the-orders-screen note; §9 phasing row for PHASE-042;
   header Updated line.

## NOT touched (per instructions)

`docs/handoff/CHANGELOG.md`, `docs/handoff/CURRENT_STATE.md` (the orchestrator owns the
completion flip), `docs/implementation/phases/PHASE-042.md` header. Pre-existing
uncommitted changes from the implementation agents (ENTITY_CATALOG, the food_manufacturing
manifest mirror, apps/, packages/) were left as-is.

## Recorded deviation (doc matches code — flagged for the orchestrator)

The task spec listed `manufacturing.shopfloor.execute` and `manufacturing.downtime.log` as
"(owner, accountant, warehouse)". The actual seed (0065 §13) grants those two keys to
owner + warehouse ONLY — the accountant block grants work_centers.manage,
routings.manage, rework_orders.manage, oee.read (0065) + standard_costs.manage (0066).
The matrix documents the SEEDED roles (owner, warehouse for those two) and states the
grant breakdown verbatim in the guarded-routes note, keeping the doc truthful to code the
same way §3.16–§3.19 match their seeds. The drift checker validates the key union only —
it is green either way. If the orchestrator intended accountant to hold those keys, the
fix belongs in a seed migration first, then a one-line matrix edit.

## Gates

- `python3 scripts/validate_docs.py` → **33/33 checks passed.**
- `pnpm check:permissions-drift` → **[permissions-drift] OK — matrix 279 keys, seed 279
  keys** (was FAILED — matrix 272, seed 279 before the §3.20 block).
- All edited table rows verified column-consistent with their headers (4/6/3/5/7/7/3
  cols per table); all relative links resolve (validate_docs check 1a).

## Numbering note (recorded in each doc, per the task mandate)

The PHASE-042 doc's planned BR-057…060 / G-38/39/40 / INV-027 / ≈0060…0066 predate the
039/040/041 waves. Honest slots shipped and documented: BR-068…071, G-40/41/42, INV-028,
migrations 0065/0066 (the 0064 D-1 precedent). Recorded in: JOURNAL_RULES note 13,
ACCOUNTING_INVARIANTS INV-028, BUSINESS_RULES intro, AUTHORIZATION_MATRIX §3.20,
REPORT_CATALOG §8 notes, FEATURE_CATALOG §27, NAVIGATION_MODEL §1.8.
