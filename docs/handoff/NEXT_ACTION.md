# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-11 (PHASE-040 COMPLETE — next eligible: PHASE-041; STOPPED awaiting the owner's go per the standing rule)

## The single next action

**PHASE-040 is COMPLETE and pushed** — the triple flip is done (the phase doc
header, the IMPLEMENTATION_STATUS row + header, and
[the completion report](../implementation/phases/reports/PHASE-040-COMPLETION.md)
with the CR-48 code-evidence checklist). **Execution is stopped here per the
owner's standing rule** — the next phase awaits the owner's go.

**Start PHASE-041 (Communications Hub — WhatsApp/SMS/Email, CR-11)** — «ابدأ تنفيذ
المرحلة PHASE-041» — when the owner gives the go. Wave-1 sibling (parallel-safe);
prerequisites all satisfied (035 ✓). Read [PHASE-041.md](../implementation/phases/PHASE-041.md)
first: the channel adapters (the notifications module's port family — the
deferred WHATSAPP/SMS dunning letters land here), the templated bilingual
messages, and the per-tenant quotas. The PHASE-040 demo-data loader and sandbox
tenants become the default substrate for its sales demos.

## Post-PHASE-040 context for the next author (2026-11-11)

PHASE-040 (Data Onboarding & Migration Toolkit) is COMPLETE — H-17, IN-26,
TB-19/TB-20, L1-21's export half and OA-05 all closed: migrations `0060`–`0063`
(schema_version 63; the RLS'd `import_mappings` + the seven-kind `import_jobs`
widening + the tenants SANDBOX/demo columns + the `user_membership_options`
SANDBOX plane + the BR-066 mapping snapshot + the `erp.tenant_kind` probe), the
BR-066 dry-run → acknowledged-atomic-commit engine, the saved-mapping wizard,
the QuickBooks/Odoo/Excel-generic adapters
([MIGRATION_ADAPTERS.md](../migration/MIGRATION_ADAPTERS.md) is the contract),
the 13-template one-click demo loader, the SANDBOX provisioning, and the
`/settings/imports` hub. CURRENT_SHIPPED_PHASE = "PHASE-040" (permissions
265 → **267**; feature keys +2; rules +BR-066; web i18n **5,109=5,109** (+90);
ENTITY_CATALOG 227 → **228**; the three new spec files **34/34**).

Key handoffs from 040 (read the
[completion report](../implementation/phases/reports/PHASE-040-COMPLETION.md)
first): the **spec-caught product fixes** (the opening-post zero-residual guard,
the COA nameAr fallback, the mapping snapshot, the tenant_kind probe — four
would-be production bugs the DB specs caught in-phase); the **@Inject
precedent** now covers OpeningBalancesPostingService/BudgetGridService/
BudgetVersionService (container resolution under vitest/esbuild); the
**enterprise-plan showcase posture** for anything that must light up ALL
templates (the sandbox precedent); the demo loader's ensureDemoActorUsers pair
(the SoD synthetic approvers) is reusable for future demo surfaces.

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
