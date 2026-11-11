# Completion Report — PHASE-038

> **Status:** COMPLETE · **Updated:** 2026-11-10

## Phase ID / Date

PHASE-038 — Procurement Sourcing & Supplier Collaboration (Blueprint v3.0, wave 1 /
stage 12, register CR-08 — the audit's H-11 finding: "no organized negotiation with
suppliers = direct financial loss"; the sourcing verdict in the completeness report's
§2 gap 5 stops applying) · 2026-11-10

## Summary

The **negotiation loop in front of the purchase order** landed as migrations
`0051_rfq_quotes.sql` → `0054_capex_tenders.sql` (schema_version 54): thirteen RLS'd
tenant tables with composite tenant FKs and stamp-shape CHECKs (the 0050 discipline) —
the RFQ round (`rfqs`/`rfq_lines`, OPEN or INVITED modes, `rfq_no` reserved at ISSUE),
supplier quotes (`supplier_quotes`/`supplier_quotes_lines`, one per supplier per RFQ,
re-submit replaces the lines while the round is open), the frozen award matrix
(`quote_comparisons` — evidence written once at prepare, never recomputed; the
one-live-comparison unique is the BR-063 DB floor), blanket agreements
(`blanket_orders`/`blanket_releases` — the transactional `released_amount` accumulator,
the append-only release ledger whose releases generate the executable PO), the
collaboration cluster (`supplier_ratings`, `approved_supplier_items`,
`supplier_advances`, `early_payment_discount_terms`), and CAPEX + tenders
(`capex_requests`, `tender_intakes` — intake records only, the honesty discipline).
Two NEW journal goldens continue the numbering from G-32: **G-33** (supplier advance
disbursement + application — the control account is the tenant-mapped setting
`purchasing.supplier_advance_control_account`, fail-closed when unmapped; the
disbursement journal is BASE-denominated at rate 1 with the treasury movement through
the treasury store API, INV-019 exact; the apply leg posts under source operation
`apply` and nets the supplier's subledger) and **G-34** (early-payment discount capture
— once per invoice, only while the APPROVED terms' window holds and the treasury
payment is POSTED, allocated, and ≥ net-after-discount — pay net early, then capture).
The supplier-portal skeleton (P-05) is ONE public endpoint
(`POST /api/v1/portal/rfqs/:rfqId/quotes` in `PUBLIC_ROUTES`): the scoped token IS the
credential (sha256 hashes at rest in `rfqs.portal_invites`, plaintext shown once), a
read-only SECURITY DEFINER projection `erp.portal_resolve_rfq_token` resolves
(rfq, token-hash) → (tenant, supplier, expiry) BEFORE any tenant GUC exists, and the
service re-validates the same invite under RLS — audited and rate-limited; the full
portal (060) shares this infrastructure. BR-062 (the 3-bid rule, tenant policy) and
BR-063 (one award per round; awarding closes it) are enforced in the award service.
Permissions drift 249 → **256** (seven sourcing keys, migration 0051 §9); feature keys
+5 (business + enterprise, the tier-4 precedent); reports +2 (`purchasing.rfq-award-matrix`,
`purchasing.supplier-scorecard` — registry 86 → 88). ENTITY_CATALOG 204 → **217**.
Gate evidence (recorded): typecheck 8/8 · lint 8/8 (incl. boundaries + depcruise 0
violations over 1,621 modules / 11,540 deps) · unit 1,414 (api 502 · web 73 · desktop
274 · mobile 393 · ui 42 · contracts 56 · domain-core 38 · sync-core 36) · **DB full
suite 2,555/2,555 green (176 files)** · build 8/8 · i18n parity **4,699=4,699** (+163) ·
permissions drift **256=256** · manifests 13 valid · token contrast AA · ui catalog
39↔62 · web secure-headers/CSP probe 6/6. Five recorded gate repairs (below) + the
notifications-email environmental item (the 037 lineage).

## What Shipped (per the task table)

| Task | Delivered |
|---|---|
| T-01 Migrations 0051–0054 | `0051_rfq_quotes.sql` (rfqs, rfq_lines, supplier_quotes, supplier_quotes_lines, quote_comparisons + the 7 permission seeds 249 → 256 + the 5 feature-plan grants + the SECURITY DEFINER projection `erp.portal_resolve_rfq_token`) · `0052_blanket_orders.sql` (blanket_orders, blanket_releases + the additive NULLABLE `purchase_orders.contract_id` composite-FK linkage to crm.service_contracts) · `0053_supplier_collaboration.sql` (supplier_ratings, approved_supplier_items, supplier_advances, early_payment_discount_terms) · `0054_capex_tenders.sql` (capex_requests, tender_intakes) — 13 RLS'd tables (`erp.apply_tenant_policy` + purge-path policies), composite tenant FKs throughout, lifecycle stamp-shape CHECKs, the one-live-comparison unique, OA-06 hot-path indexes, schema_version 54; Drizzle mirrors + journal/spec pins |
| T-02 RFQ lifecycle service | `purchasing/application/rfq.ts` — DRAFT → ISSUED (open AND invited modes) → QUOTED → AWARDED → CLOSED (+CANCELLED off DRAFT/ISSUED); `rfq_no` reserved at ISSUE; invalid transitions are typed 409s with zero residue; the DB stamp-shape CHECKs are the floor, the service owns transition legality |
| T-03 Quotes + portal endpoint | `purchasing/application/quotes.ts` + `presentation/portal.controller.ts` — back-office entry stamps the actor, portal entry stamps the contact (the token itself is never recorded); `POST /api/v1/portal/rfqs/:rfqId/quotes` registered in `PUBLIC_ROUTES` (`infra/auth/route-permissions.ts`); scoped tokens sha256-hashed in `rfqs.portal_invites`; pre-GUC resolution through `erp.portal_resolve_rfq_token` then service re-validation under RLS (the projection is the bootstrapping lookup, never the authority); rate-limited + audited; re-submission while the round is open replaces the quote lines |
| T-04 Comparison / award | `purchasing/application/award.ts` + `sourcing-math.ts` — the comparison snapshot is frozen at prepare (the award never re-scores); `threeBidDecision` evaluates BR-062 in both modes (ENFORCED typed rejection / ADVISORY one inbox notification + audit then proceeds / OFF default); BR-063 — one award per round, awarding closes the RFQ for quote activity; award generates the PO or the blanket release with line refs back to the awarded quotes, traced through `quote_comparisons.generated_docs` + PO line notes |
| T-05 Blanket agreements | `purchasing/application/blanket.ts` — `released_amount` advanced transactionally in the same statement as the release (the CHECK `0 ≤ released_amount ≤ max_commitment` is the DB floor); over-release is a typed rejection; expiry blocks new releases; prices resolve from the blanket `price_lock`; each release generates the executable PO in-transaction (the ledger row carries it) |
| T-06 Scorecards + approved items | `purchasing/application/scorecards.ts` + `infrastructure/scorecard-sweep.job.ts` (queue `purchasing.scorecard-sweep`) — rolling-window scores computed from LIVE documents (GRN punctuality, debit-note quality drag, invoice price variance), overall = the documented fold delivery 40% · quality 40% · price 20%, `detail` jsonb carries the sample decomposition; ONE row per supplier, recompute overwrites; `pricing.ts` gates vendor suggestions through `approved_supplier_items` per `purchasing.approved_vendor_list.mode` (OFF default / FLAG / BLOCK) |
| T-07 CAPEX requests | `purchasing/application/capex.ts` — workflow DRAFT → PENDING_APPROVAL → APPROVED → CONVERTED (+REJECTED/CANCELLED), SoD creator ≠ approver, the PHASE-028 budget control guard at submit as a DECLARED edge (advisory default, ENFORCE_DRAFT per tenant policy) with the evaluation snapshot persisted on the row (`budget_evaluation`); `request_no` reserved at approval; CONVERT links the generated PO (`converted_order_id`) |
| T-08 G-33/G-34 posting integration | `purchasing/application/advances.ts` + `domain/sourcing-errors.ts` — G-33 disbursement (DR the tenant-mapped `ADVANCES_TO_SUPPLIERS` control · CR CASH/BANK, BASE at rate 1, treasury movement via the treasury store API, INV-019 exact) + application leg (DR `AP_CONTROL` partner-stamped · CR the same control, source operation `apply`, supplier-level application nets the subledger); G-34 capture (once per invoice — INV-013 idempotency; verifies the treasury payment is POSTED, allocated onto the invoice's open item, inside the approved terms' window, and ≥ net-after-discount); failure packs: `SUPPLIER_ADVANCE_ACCOUNT_UNMAPPED`, `EARLY_DISCOUNT_INCOME_ACCOUNT_UNMAPPED` (zero partial writes — the payroll G-29 loan-account precedent), the SoD rejections (advance approver ≠ creator; terms APPROVED before capture), `DISCOUNT_ALREADY_CAPTURED` |
| T-09 Tender intake | `purchasing/application/tenders.ts` — intake records ONLY (the announcing authority, the deadline, our recorded decision PENDING/WILL_BID/DECLINED/WON/LOST, the DF-52/53 government supplier-registration fields stored verbatim); no bidding-platform claims, nothing auto-bids |
| T-10 Matching tolerance bands | `purchasing/application/matching.ts` — the `purchasing.match.tolerance_bands` setting refines the flat keys (per-band price/qty tolerances; **the flat keys stay default** when no bands are configured); no new tables |
| T-11 Web surfaces | The sourcing screens — `/purchasing/rfq` (list/detail with the comparison/award matrix), `/purchasing/blanket-orders` (agreements + releases), `/purchasing/supplier-scorecards`, `/purchasing/capex-requests` — web unit 73/73 + the full next build green (8/8) |
| T-12 NAV_ITEMS + i18n | The four purchasing NAV_ITEMS rows (NAVIGATION_MODEL §1.4), command-palette entries (OA-04), feature gating per the 0051 plan grants; i18n keys added with full AR/EN parity — **4,699=4,699 (+163)** |
| T-13 Rule specs + RLS + docs | BR-062/BR-063 (BUSINESS_RULES.md Blueprint-v3.0 section), G-33/G-34 rows + note 11 (JOURNAL_RULES.md §7), DATA_DICTIONARY §17, ENTITY_CATALOG +13 (217), FEATURE_CATALOG +5, REPORT_CATALOG +2 + the revision-history row, NAVIGATION_MODEL §1.4, the portal spoof battery + RLS registration (A1–A10 for the 13 tables) — the DB pass green (the isolation/RLS chunk: 1,792/1,792) + `docs:validate` (below) |

## Verification (acceptance criteria → evidence)

Evidence below is recorded by the main agent's gate run — nothing here is invented.

1. **Migrations 0051–0054 apply cleanly; the 13 new tables are RLS'd with composite
   tenant FKs; Drizzle + ENTITY_CATALOG.md parity (217 rows)** — evidence: the DB
   suite boots the fresh chain through 0054 (schema_version 54; the
   migrations.db.spec manifest↔journal↔disk triple), the RLS canary + the isolation
   registry for the 13 tables, and the ENTITY_CATALOG count check — **green**
   (the 176-file/2,555-test suite, chunked into three sequential post-change passes
   on the 2-vCPU sandbox: 628 + 1,792 + 135).
2. **RFQ lifecycle end-to-end** (DRAFT → ISSUED open AND invited → QUOTED → AWARDED →
   CLOSED; invalid transitions typed 409, zero residue; the DB stamp-shape CHECKs
   hold) — evidence: the sourcing lifecycle spec over `rfq.ts` including the
   negative-transition battery — **green** (`__db__/purchasing/sourcing.spec.ts`,
   part of the 628-test chunk-1 pass).
3. **3-bid rule (BR-062) both modes** — ENFORCED rejects the award below
   `purchasing.rfq.min_quote_count` typed; ADVISORY warns once (one inbox notification
   + audit) and proceeds; OFF ignores — evidence: `threeBidDecision` unit spec + the
   award-service integration spec asserting the verdict lands in the audit record —
   **green** (the unit pass + the DB pass).
4. **Awarding generates the PO (or blanket release) with lines traceable to the awarded
   quotes; awarding closes the RFQ (BR-063); double-award attempts fail typed** —
   evidence: the award spec's generated_docs assertions + the AWARDED/CLOSED
   submission-rejection 409s + the second-award rejection against the
   one-live-comparison unique — **green**.
5. **Blanket releases decrement the remaining commitment; over-release beyond max is a
   typed rejection; expiry blocks new releases** — evidence: the blanket spec
   (transactional `released_amount` walk, the typed over-release, the expired-agreement
   rejection, the price-lock resolution) — **green**.
6. **Goldens G-33/G-34 post through the posting engine with balanced worked examples
   and failure packs** (unmapped control account → typed
   `SUPPLIER_ADVANCE_ACCOUNT_UNMAPPED` / `EARLY_DISCOUNT_INCOME_ACCOUNT_UNMAPPED`, zero
   partial writes; SoD creator ≠ approver holds for the advance and the terms) —
   evidence: the advances spec (balanced-entry assertions, the failure packs, the
   INV-013 one-capture-per-invoice idempotency, the window/POSTED/allocation
   verification) — **green** (also the `__db__/purchasing/golden.spec.ts` G-33/G-34
   rows in the DB pass).
7. **Scorecards compute from live documents in the rolling window; approved supplier
   items gate vendor suggestions per policy** (flagged or blocked per
   `purchasing.approved_vendor_list.mode`) — evidence: the scorecards spec (the
   40/40/20 fold, the detail decomposition, the OFF/FLAG/BLOCK matrix in the pricing
   path) + the `purchasing.scorecard-sweep` pg-boss queue — **green**.
8. **Portal skeleton: an invited supplier's scoped token submits ONLY their quote for
   ONLY that RFQ** — the spoof battery (other RFQs, other suppliers, cross-tenant,
   stale/revoked tokens) all fails typed; every submission is audited — evidence: the
   portal spec over `portal.controller.ts` + the definer projection (the pre-GUC
   resolution, the re-validation under RLS, the rate limiter) — **green**.
9. **CAPEX checks the budget control guard in advisory AND enforced modes** (the 028
   discipline; the evaluation snapshot persists), approval workflow with SoD, and the
   `purchase_orders.contract_id` linkage resolves a live contract — evidence: the
   capex spec + the contract-linkage composite-FK test — **green**.
10. **House gates green (CR-36) + completion** — RLS A1–A10 for the 13 tables ·
    permissions drift 249 → 256 (drift CLI: matrix 256 = seed 256) · i18n parity
    **4,699=4,699** (+163) · `docs:validate` **32/32** · the 2 new report contracts
    render over seeded data with REPORT_CATALOG rows (`purchasing/sourcing.spec.ts`
    covers both; the registry pins updated 86 → 88 in golden + industry-018 +
    industry-019) · this completion report · the IMPLEMENTATION_STATUS row flip ·
    the archive as `ERP_PLATFORM_PHASE038.zip` (OA-07) — evidence: typecheck 8/8 ·
    lint 8/8 · depcruise 0 violations · unit 1,414 · manifests 13 · build 8/8 ·
    token contrast AA · ui catalog 39↔62 · web-security probe 6/6 — **green**.

## Recorded gate repairs (the 035/036/037 ledger continuation)

1. **The §12 boot validator's known-permission set was missing `purchasing.rfqs.read`**
   (`reporting.module.ts` `KNOWN_PERMISSION_KEYS` — the hardcoded boot-time catalog):
   the two new sourcing contracts gate on the 0051 §9 seed key, so every
   AppModule-booting DB spec (crm/billing et al.) failed startup with
   `ContractValidationError` (2 contract problems). The PHASE-036 precedent class
   (the consolidation keys) — the key added with the §12 module-register comment;
   the meta-tests' seed↔matrix drift stays 256=256.
2. **The registry 86-pins were not advanced** — `__db__/reporting/golden.spec.ts` (the
   frozen snapshot count) + the shared `industry-018`/`industry-019` integration pins
   expected 86 against the new 88; updated with the per-phase lineage comment
   (+2 sourcing).
3. **The identity-flows seed pin was still 249** — the 0051 §9 seven-key seed moved
   the catalog to 256; the pin + its lineage comment updated (249 + 7 = 256; the
   drift CLI agrees).
4. **The report-hammer thundering herd (57014)** — the within-wave identical-params
   shape structurally serialized 4 concurrent runs behind the first lane's WHOLE
   compute (`report_runs` UNIQUE (tenant, report_key, params_hash) + the withTenant
   UoW holding the ON CONFLICT tuple lock until commit), pinning the last waiter
   past the pool's 15 s `statement_timeout` once the 100k TB compute under 4-way
   2-vCPU contention crossed ~15 s (the GA-recorded 17.9 s wave wall was already the
   borderline). Repair: **single-flight coalescing in `RunService.run()`** —
   identical concurrent requests share one in-flight compute (keyed like the cache
   key, self-cleaning; the store's ON CONFLICT REPLACE already collapses identical
   runs into one row) — a production improvement (the dashboard-refresh herd is the
   exact production shape), with the spec shape UNCHANGED and the repair recorded in
   the spec header. Post-repair evidence: wave walls 6,198/6,001/6,008 ms (was
   17.9 s max), all SUCCEEDED, witness p95=20 ms (budget 2,000) / list p95=22 ms
   (budget 500).
5. **The MFA spec's TOTP time-bomb (~7% of runs)** — `mfa-policy.db.spec.ts` computed
   the login code at `Date.now() + 31_000`, which lands TWO timesteps ahead whenever
   the verify call runs in the last second of a 30 s period (r ≥ 29 s), outside the
   ±1 drift window → deterministic `MfaRequiredError`. Repair: both codes pinned to
   one base timestep (login = verify + 1) — inside the window at any test speed.

## The environmental item (recorded, not repaired)

`notifications-email.db.spec.ts` mail capture raced its deadline once under the
chunked-suite peak load ("no matching mail captured (6 total)") and passed on the
isolated + subsequent full-chunk runs — the 037 environmental lineage (the sweep's
mail-wait harness under load; nothing in this phase's diff touches the email path).
Also recorded: the visual harness (`test:visual-harness-run`) is not in the recorded
phase-gate set since the 034 tree (the GPU-CI duty per VISUAL_TESTING §3 + the
ci-visual.yml guard; the software-rasterization QUARANTINE lineage) — its local run
surfaces the pre-existing `patterns-periodgrid--editable-arabic` axe item (the
`label-content-name-mismatch` rule on the aria-labelled gridcells — the component,
story, and axe-core 4.14.0 are all unchanged since 034) and regenerates the two
gitignored journal-grid AR baselines; both are CI-visual-workflow duties, not phase
gates. The web secure-headers/CSP probe (the §8 gate that IS scriptable locally)
was run green (6/6).

## Handoff to PHASE-039 (Returns & Collections) / 043 / 050 / 060

- **PHASE-039 (Returns & Collections):** the partner credit-risk surfacing there
  reuses the scorecard aggregation pattern shipped here — the rolling-window fold over
  live documents (`scorecards.ts` + the `purchasing.scorecard-sweep` sweep) is the
  template; the typed-settings fail-closed pattern (unmapped → typed rejection, zero
  partial writes) carries over to any new control mapping.
- **PHASE-043 (replenishment planning):** blanket release schedules are planning
  inputs — `blanket_orders` (validity window, min/max commitment, price lock) and the
  append-only `blanket_releases` ledger give the planner the committed-demand stream;
  read it, never rewrite it.
- **PHASE-050 (supplier quality):** `supplier_ratings` extends — the CHECK admits the
  0..100 score columns and `detail` jsonb is the evidence envelope; quality records
  from 050 land as additional fold inputs without reshaping the one-row-per-supplier
  store.
- **PHASE-060 (full supplier portal):** the P-05 skeleton is the substrate — the
  PUBLIC_ROUTES surface, the scoped sha256-hashed tokens in `rfqs.portal_invites`, the
  `erp.portal_resolve_rfq_token` definer projection, the rate limiter, and the audit
  trail stay; 060 adds the authenticated portal app on top (quote history, document
  exchange) without forking the credential model.
