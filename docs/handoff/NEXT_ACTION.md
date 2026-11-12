# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-12 (PHASE-042 COMPLETE — Wave 2 opens; next eligible: PHASE-044; STOPPED awaiting the owner's go per the standing rule)

## The single next action

**PHASE-042 is COMPLETE and pushed** — the triple flip is done (the phase doc
header, the IMPLEMENTATION_STATUS row + header, and
[the completion report](../implementation/phases/reports/PHASE-042-COMPLETION.md)
with the CR-48 code-evidence checklist). **Execution is stopped here per the
owner's standing rule** — the next phase awaits the owner's go.

**Start PHASE-044 (WMS & Inventory Intelligence, CR-14)** — «ابدأ تنفيذ
المرحلة PHASE-044» — when the owner gives the go. Wave-2 sibling (parallel-safe);
prerequisites all satisfied (035 ✓). Read [PHASE-044.md](../implementation/phases/PHASE-044.md)
first: the location tree (zones/aisles/racks/bins with barcodes + pick
sequence), bin-level contents (AVAILABLE/QUARANTINE/HOLD; `item_stock` stays
the valuation authority — INV-010 untouched), the returnable packaging layer
(L1-20, v3.1/CR-46), and the inventory intelligence reports. NOTE: PHASE-043
(MRP) additionally requires 044 + 038 — its inputs (work-center capacities,
routing times, the frozen standards) shipped with 042.

## Post-PHASE-042 context for the next author (2026-11-12)

PHASE-042 (Manufacturing I — Routing, Work Centers & Costing, + the v3.1/CR-45
L2-12 standard-costing layer) is COMPLETE — H-04, M-02…M-04, M-12…M-19 and
L2-12 all closed: migrations `0065`/`0066` (schema_version 66; seven RLS'd
tables + the two security_invoker OEE views + the production_orders extension
columns), the versioned-routing discipline (one ACTIVE per item — the BOM
pattern), the INV-028 operation machine (sequence gate, skip SoD, the G-40
conversion posting at work-center rates × actual times, idempotent `op_<seq>`
replay), rework orders (G-41 → REWORK_EXPENSE — never the parent FG layer,
BR-069), reason-coded downtime (record-only by default — BR-070; G-42 on the
explicit `manufacturing.downtime_posting='post'` opt-in), the standard-cost
layer (roll-up over BOM + routing, freeze/activate, PPV at receipt through the
landed-cost point, stock revaluation), the touch-first shop-floor terminal +
the OP-scan endpoint, 4 report contracts (registry 91 → 95), and the five web
surfaces + the Operations tab. CURRENT_SHIPPED_PHASE = "PHASE-042"
(permissions 272 → **279**; feature keys +6 (business+enterprise + the
food_manufacturing manifest enablement); rules +BR-068…071; goldens
+G-40/41/42; INV-028; web i18n **5,422=5,422** (+175 — the audited operative
count discipline); ENTITY_CATALOG 232 → **239**; isolation suite **1,332/1,332**
(+42); the full DB suite **2,768/2,768**).

Key handoffs from 042 (read the
[completion report](../implementation/phases/reports/PHASE-042-COMPLETION.md)
first): the numbering deviations (the doc's BR-057…060/G-38…40/INV-027
predate 039/040/041 — the honest slots BR-068…071/G-40…42/INV-028 are the
law); the dual-mode decision (routing-less orders keep the legacy flat-rate
path — G-17/G-18 stayed green untouched); the `production_order_operations`
+ `downtime_records` bin-agnostic design (044 may add bin references without
migration conflicts — columns reserved); WMS 044 values movements at the
frozen standard when the item's policy elects it (the L2-12 consumer); the
**pre-existing 041 pin rot** the 042 full-suite sweep caught and repaired
(tenancy-http starter 58 → 60 — 0064's all-plans grant had moved it unseen by
the targeted 041 gates; recorded in the report's deviations); the FEATURE_DEPS
intake pattern for new feature keys (the catalog is closed — unknown keys fail
BR-040 closure).

## Post-PHASE-039 context for the next author (2026-11-11)

PHASE-039 (Returns & Collections) is COMPLETE — H-12, H-13, S-14…16, L1-10,
L1-11, L1-12 and R-03 all closed: migrations `0055`–`0059` (schema_version 59;
ten RLS'd tables + the partner credit-risk columns), the RMA workflow
(G-35/36/37, BR-064 exactly-once), managed warranties, the monotonic dunning
ladder (BR-065) with the late-fee engine (VAT-carrying fee invoices,
REQUIRES_VERIFICATION) and the collection-agency layer (hashed-token callbacks,
G-39), credit reviews (the blocked-class interplay), and the supplier-RMA
mirror (G-38). CURRENT_SHIPPED_PHASE = "PHASE-039" (permissions 256 → **265**;
feature keys +4; report registry 88 → **90**; web i18n **5,019=5,019** (+320);
ENTITY_CATALOG 217 → **227**; the full DB suite 173 files / **2,577 green**;
goldens G-35…G-39 + BR-064/065 registered).

Key handoffs from 039 (read `agent-ctx/7-API-A-returns-api.md` +
`7-API-B-dunning-collections-api.md` + `7-WEB-C-phase-039-returns-collections.md`
+ the [completion report](../implementation/phases/reports/PHASE-039-COMPLETION.md)
first):

- **The scorecard→credit-risk fold pattern is the one 040 should mirror** for
  import progress surfacing: the rolling-window fold over live documents plus
  the typed-settings fail-closed discipline (unmapped control account → typed
  rejection, zero partial writes) — now in THREE places (038 advances, 039
  scrap/returns/commission accounts).
- **The re-pin procedure is documented**: any plan-granting migration or
  FEATURE_DEPS edge moves ALL 37 golden-effective-configs pins — re-pin with a
  review note (the P32/039 precedent in
  `configuration/__tests__/golden-effective-configs.spec.ts`).
- **The isolation OWN_ROW contract**: every new tables.registry row needs its
  seed + OWN_ROW + MISMATCHED_INSERT triple in identity-isolation.db.spec.ts —
  the generated A-suite crashes at collection otherwise (the 039 gate-repair
  lesson).
- **The late-fee invoice path**: the sales engine's approve-override arm
  (`sales.credit_check_overridden` audit) is the pattern for any system-actor
  invoice that must not be blocked by the very condition it remedies.
- Watch items carried: the zatca-qr-decode Playwright environmental gap
  (pre-existing), the `manual_issue`/SUPPLIER_RETURN stock-source note (the
  mechanical rename path when a widening lands), WHATSAPP/SMS letters QUEUED
  for the 041 channel-port (the letter rows already store the channel).

## Post-v3.2 context for the next author (2026-11-11)

The residual layer (CR-49…CR-52) is COMPLETE and pushed: the Layer-3 file
([../planning/gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md](../planning/gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md))
documents the 15 final owner decisions (R-01…R-15 — 11 scope additions, R-08
covered-by-plan, R-06 shipped-by-design, R-09/R-11 non-goals); the directive is
preserved as [../implementation/GAP_LAYER3_DIRECTIVE.md](../implementation/GAP_LAYER3_DIRECTIVE.md);
the register carries CR-49…52; the roadmap is v3.2 (34 phases, 548 in-scope gaps,
~147–197 single-agent weeks with ~132–183 remaining, arithmetic in §9); eight phase
docs (039/048/049/053/054/062/064/066) received their R-scope extensions with
updated estimates; the risk register carries RISK-029/030; the v3.1 report's
line-101 count is corrected. **The plan is now comprehensive at the planning level**
— every future discovery enters through CR-47's same-commit intake. Execution is
what remains, and 039 is the next step.

## Post-PHASE-038 context for the next author

PHASE-038 (Procurement Sourcing & Supplier Collaboration) is COMPLETE — the audit's
H-11 verdict ("no organized negotiation with suppliers = direct financial loss")
closed: migrations `0051`–`0054` (schema_version 54; thirteen RLS'd tables — the RFQ
round, supplier quotes, the frozen `quote_comparisons` award matrix, blanket
agreements + the append-only release ledger that mints executable POs, the
collaboration cluster `supplier_ratings`/`approved_supplier_items`/
`supplier_advances`/`early_payment_discount_terms`, CAPEX + tender intakes), the
two NEW goldens **G-33** (supplier advance disbursement + application — the
tenant-mapped control account, fail-closed when unmapped, supplier-level netting)
and **G-34** (early-payment discount capture — once per invoice, POSTED-payment +
window + allocation verified), the P-05 supplier-portal skeleton (ONE public
endpoint — scoped sha256-hashed tokens in `rfqs.portal_invites`, the SECURITY
DEFINER `erp.portal_resolve_rfq_token` pre-GUC projection, re-validation under RLS,
audited + rate-limited), the four web sourcing screens + NAV_ITEMS §1.4, and the
docs wave (BR-062/063 · G-33/G-34 + JOURNAL_RULES note 11 · DATA_DICTIONARY §17 ·
ENTITY_CATALOG 217 · FEATURE_CATALOG +5 · REPORT_CATALOG +2 (86 → 88) ·
NAVIGATION_MODEL §1.4).
CURRENT_SHIPPED_PHASE = "PHASE-038" (schema_version 54; permissions 249 → **256**;
web i18n **4,699=4,699** (+163); ENTITY_CATALOG 204 → **217** domain rows; report
registry 86 → **88**; isolation registry +13 tables).

Key handoffs from 038 (read `agent-ctx/P38-sourcing.md` + the
[completion report](../implementation/phases/reports/PHASE-038-COMPLETION.md)
first):

- **The scorecard aggregation pattern is the ONE import 039 reuses**: the
  rolling-window fold over live documents (`scorecards.ts` + the
  `purchasing.scorecard-sweep` sweep) is the template for the partner credit-risk
  surfacing in Returns & Collections; the typed-settings fail-closed pattern
  (unmapped control account → typed rejection, zero partial writes —
  `SUPPLIER_ADVANCE_ACCOUNT_UNMAPPED` precedent) carries over to any new control
  mapping 039 introduces.
- **The report-hammer repair changed `RunService.run()`**: identical concurrent
  runs now single-flight coalesce (one compute, shared envelope) — if 039 adds a
  report, nothing changes; if 039 benchmarks concurrent runs, expect the coalescing
  (the store's ON CONFLICT REPLACE semantics, now enforced at the service edge).
- **The registry-pin discipline**: report registry pins live in THREE specs
  (`__db__/reporting/golden.spec.ts` + `industry-018` + `industry-019`) — a new
  contract moves all three (86 → 88 this phase); the boot-time known-permission
  set lives in `reporting.module.ts` `KNOWN_PERMISSION_KEYS` (extend it for any
  new report permission key — the 036/038 repair class).
- **The seed-pin discipline**: the identity-flows permissions pin
  (`__db__/identity-flows.db.spec.ts`) carries the full per-phase lineage comment —
  249 + 7 = 256 now; extend it, don't renumber.
- **The 038 repairs ledger** (five recorded + one environmental, in the completion
  report): the §12 known-permission omission, the 86-pins, the 249-pin, the
  report-hammer 57014 (coalescing), the MFA TOTP timestep time-bomb (~7% of runs —
  pinned now), and the notifications-email mail-capture race (load lineage, passes
  isolated).
- Watch items carried: SF-026-001 (purge vs guards), SF-026-002 (RC-10 seeded
  drift DB proof), the 028 ControlGuard first production call-site (CAPEX submit —
  advisory default, ENFORCE_DRAFT per tenant policy), the 029 "E2" item + payslip
  print-template deferrals, the 030 environmental runbook set.
