# manufacturing module

The manufacturing vertical (PHASE-018 T38a/b + PHASE-042 execution + PHASE-043
planning): versioned BOMs/routings/standards (recipe master data), the
production-order lifecycle with the INV-028 shop-floor machine (execution), and
the MRP & planning brain (planning).

## The determinism note (PHASE-043 §4 — the architecture note in lieu of an ADR)

**The MRP engine is a deterministic pure service over existing stores.** A run
is a replayable snapshot, never a live recompute:

1. **Parameters ride the run row** (`mrp_runs.params` jsonb — the FULL
   parameter snapshot: bucket size, horizon, scope, the open-PO scope choice,
   the coverage-netting toggles). Re-running with the same inputs yields the
   same plan; re-RENDERING a run uses only its stored rows.
2. **The demand/supply lines ARE the input evidence** (`mrp_demand_lines` /
   `mrp_supply_lines` — every netting term snapshotted per bucket). A
   suggestion's quantity is reproducible from its `netting` jsonb + the run's
   lines alone — no live reads required (the explanation-first law, INV-030).
3. **The walk is pure** — `mrp-netting-core.netItem` + the graph service's
   low-level codes/explosion carry no clock, no randomness, no DB access; the
   engine is pure orchestration (load facts → walk levels ascending by LLC →
   write the family). Cycles are a typed `MrpCycleError` (the explosion
   terminates, never loops); the 16-level depth cap is the house cap.
4. **No journal, no stock** — the planning family posts NOTHING (the budgeting
   precedent; JOURNAL_RULES §3 note 2). Every converted document is born
   through its OWN service (the 038 PO path / the T38b order service / the
   transfer service), which is where the posting legs live (G-47/G-48/G-49
   ride those documents' shapes).

The payroll variable-feed discipline (PHASE-045's handoff note) mirrors this
run-snapshot pattern.

## Layout

- `application/` — the services (bom, production-order, operation-execution,
  mrp-engine, mrp-netting-core (pure), mrp-graph-service (pure),
  mrp-suggestions, mps, bill-of-resources, atp, mto, tolling,
  reservation-policy, rework, downtime, standard-cost, …).
- `domain/` — the error contracts (typed API codes) + `mrp/` (the pure
  planning kernel the engine composes).
- `infrastructure/` — `manufacturing.store.ts` (the BOM/order writer) +
  `planning.store.ts` (the MRP family writer — the single writer per family).
- `presentation/` — the controllers (permission-gated routes).
