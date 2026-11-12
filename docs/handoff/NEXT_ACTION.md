# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-12 (PHASE-041 COMPLETE — Wave 1 closed: 035…041 all delivered; next eligible: PHASE-042)

## The single next action

**PHASE-041 is COMPLETE and pushed, and the owner's independent audit (2026-11-12)
has verified Wave 1 end-to-end — Wave 1 (035–041) is officially CLOSED.** The
triple flip is done (the phase doc header, the IMPLEMENTATION_STATUS row + header,
and [the completion report](../implementation/phases/reports/PHASE-041-COMPLETION.md)
with the CR-48 code-evidence checklist + the audit errata). **The owner has given
the go for the Wave 2 opener in this round.**

**Start PHASE-042 (Manufacturing I — Routing & Work Centers, CR-12)** — «ابدأ تنفيذ
المرحلة PHASE-042» — the Wave 2 opener (Stage 13). Prerequisites all satisfied:
the hard ordering **036-before-042 is met on this lineage** (PHASE-036 Extensibility
Core COMPLETE 2026-11-10 — its entity registry is the surface custom fields attach
to). Read [PHASE-042.md](../implementation/phases/PHASE-042.md) first: work centers
with per-shift capacity + fixed/var cost rates (M-03/H-04), versioned routings +
routing operations with setup/run times (M-02), the production-order operation
state machine with barcode scan points (M-17, INV-027 sequence discipline), actual
operation costing at work-center rates (M-18), standard-vs-actual variance records
(M-13/M-19) + statistical scrap (M-12), rework orders (M-14), downtime records
(M-15), OEE views (M-16), and the v3.1/CR-45 **standard-costing layer** (L2-12:
item standard costs, cost roll-up over BOM + routing, freeze/activate with
effective dates, purchase-price variance at receipt, stock revaluation). Budget:
+7 tables + 2 views · +7 permission keys (the 245-discipline zero-drift extends) ·
~160 i18n keys · 4 report contracts · new manufacturing goldens + INV-027 +
BR-057…060 · migrations continue from `0064` (exact numbers taken at
implementation time per the phase doc's convention).

## Post-PHASE-041 context for the next author (2026-11-12)

**Wave 1 (Stage 12 — "Sellable") is CLOSED:** 035 Activation & Truth Restoration ·
036 Extensibility Core · 037 ZATCA Phase-1 & QR · 038 Procurement Sourcing ·
039 Returns & Collections · 040 Data Onboarding · 041 Communications Hub — all
COMPLETE with reports, and the owner's independent audit (fresh clone, line-by-line
evidence verification, live gate runs: typecheck 0 errors · unit 576/576 ·
docs:validate 33/33 · i18n parity green) confirmed both closing phases as real and
complete. The audit's counting corrections are recorded as errata in the 040/041
reports — including the adopted rule that i18n counts are always OPERATIVE counts
(Object.keys-style flatten over the loaded module, what `assertDictionaryParity`
measures), never git-diff tallies.

**The Wave 1 release gate per CR-38 ("sellable" — Stage 12):** ZATCA-1 shipped
with PHASE-037 ✓ · OQ-002 resolved as the owner pricing decision ✓ · the
payments-ready path staged for PHASE-056 ✓ (recorded in
[PHASE-041.md](../implementation/phases/PHASE-041.md) §8's handoff note; the
register row [CR-38](../planning/COMPLETENESS_REGISTER.md) is the authority, and
RELEASE_STRATEGY.md carries the tier table).

**PHASE-041 (Communications Hub) delivery in one paragraph:** migration `0064`
(schema_version 64; four RLS'd tables — `message_templates`, `outbound_messages`,
`notification_preferences`, `communication_log`), the BR-067 channel port (eight
providers behind fake-transported contract tests + the SANDBOX default with ZERO
external calls until selected AND credentialed), the tenant template service
(fail-closed rendering), the outbound pipeline (status transitions + provider ref +
cost + bounded backoff retries), the TB-23 preference matrix end-to-end, the PP-13
digest + PP-15 nudges, the UX-14 unified inbox + IN-16 call logging, the IN-17
calendar connect + IN-18 review-only contacts sync, the delivery-log report
(registry 90 → 91), and the `/settings/communication` + inbox web surfaces.
CURRENT_SHIPPED_PHASE = "PHASE-041" (permissions 267 → **272**; feature keys +6;
rules +BR-067; web i18n **5,247=5,247** (+139, from 5,108 — the audited operative
count); ENTITY_CATALOG 228 → **232**; report registry 90 → **91**; isolation suite
**1,290/1,290** (+24); the archive `ERP_PLATFORM_PHASE041.zip`).

Key handoffs from 041 (read the
[completion report](../implementation/phases/reports/PHASE-041-COMPLETION.md)
first): **the two pre-documented letter handoffs are live consumers now** — the
PHASE-039 dunning/collection EMAIL messages ride a real ledger row (the register's
SENT stamp backed by the outbox transition), and the PHASE-036 QUEUED
WHATSAPP/SMS letters enqueue + deliver + flip SENT through the pipeline; **the
PHASE-040 demo tenants are the first realistic audience for the configured
channels** (the demo loader seeds the tenants the channel demos run against). For
042 specifically: the `@Inject` explicit-token discipline (the boot-regression
lesson — manually-constructed specs cannot see container resolution gaps), the
fail-closed rendering pattern for anything template-shaped, and the OA-06 EXPLAIN
budget discipline on every new hot path.

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
