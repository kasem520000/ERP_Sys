# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-11 (roadmap v3.2 residual layer applied — next eligible: PHASE-039, owner go received)

## The single next action

**Start PHASE-039 (Returns & Collections — RMA + Dunning + Late Fees + Agencies +
Supplier RMA, CR-09 + CR-46 + CR-50)** — the owner's go was received with the v3.2
directive («ثم ابدأ فوراً تنفيذ PHASE-039»). Per EXPANSION sequencing the wave-1
siblings are parallel-safe; 039's prerequisites (035 ✓, the AR/AP module + journal
infrastructure from the 34-phase baseline) are all satisfied. **The phase's scope is
FINAL before implementation starts** (CR-46 + CR-50) — read
[PHASE-039.md](../implementation/phases/PHASE-039.md) first: the sales RMA cycle
(authorization → receipt → inspection → disposition with G-35/G-36/G-37 posting
discipline per the phase doc's own numbering), managed warranties, the receivables
dunning sweep (aging-bucket escalation letters + collection-status surfacing), the
three v3.1 additions — the periodic credit-review workflow (L1-10), the late-fee
engine with VAT treatment + waiver path (L1-12), and the collection-agency referral
layer with the hashed-token callback port (L1-11) — **plus the v3.2 addition:
the supplier-RMA mirror (R-03 — return-to-vendor authorization → auto-generated AP
debit note, G-38, ~4-week estimate)**.

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
