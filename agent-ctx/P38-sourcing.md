# P38 — Procurement Sourcing & Supplier Collaboration (working record)

Task: PHASE-038 per `docs/implementation/phases/PHASE-038.md` (CR-08).
Everything below is the as-built ledger for the closeout and the 039/043/050/060
authors. Gate evidence is finalized by the main agent (see the completion report's
«recorded at gate time» markers).

## Shipped surface (the short map)

- `apps/api/migrations/0051_rfq_quotes.sql` — rfqs / rfq_lines / supplier_quotes /
  supplier_quotes_lines / quote_comparisons + the 7 permission seeds (249 → 256) +
  the 5 feature-plan grants + `erp.portal_resolve_rfq_token` (SECURITY DEFINER,
  owned by erp_definer) + schema_version 51.
- `0052_blanket_orders.sql` — blanket_orders / blanket_releases + the additive
  NULLABLE `purchase_orders.contract_id` (P-06, composite FK → crm.service_contracts).
- `0053_supplier_collaboration.sql` — supplier_ratings / approved_supplier_items /
  supplier_advances / early_payment_discount_terms (+ the G-33/G-34 substrate).
- `0054_capex_tenders.sql` — capex_requests / tender_intakes. Schema_version 54.
- `purchasing/application/` — rfq.ts · quotes.ts · award.ts · sourcing-math.ts ·
  blanket.ts · scorecards.ts · capex.ts · advances.ts · tenders.ts ·
  matching.ts (tolerance bands) · pricing.ts (the approved-vendor gate).
- `purchasing/domain/sourcing-errors.ts` (the typed sourcing failure packs) ·
  `purchasing/infrastructure/` (sourcing.store.ts · collaboration.store.ts ·
  scorecard-sweep.job.ts — queue `purchasing.scorecard-sweep`) ·
  `purchasing/presentation/` (sourcing.controller.ts · portal.controller.ts).
- Portal: `POST /api/v1/portal/rfqs/:rfqId/quotes` in `PUBLIC_ROUTES`
  (`infra/auth/route-permissions.ts`).
- Docs: BR-062/063 · G-33/G-34 + JOURNAL_RULES note 11 · DATA_DICTIONARY §17 ·
  ENTITY_CATALOG 204 → 217 · FEATURE_CATALOG +5 · REPORT_CATALOG +2 (86 → 88) ·
  NAVIGATION_MODEL §1.4 · the phase header flip · the completion report ·
  this file.

## Key decisions (recorded)

1. **Portal invites are jsonb on `rfqs` + the one definer projection.** Scoped
   supplier tokens live in `rfqs.portal_invites` (sha256 hashes only — the plaintext
   is shown ONCE at mint, never stored). The portal route is public (the token IS the
   credential — the enrollment/refresh login pattern verbatim), so resolution must
   happen BEFORE any tenant GUC exists: `erp.portal_resolve_rfq_token(rfq_id,
   token_hash)` is a read-only SECURITY DEFINER projection (FORCE RLS binds even the
   owner, hence the erp_definer ownership) returning (tenant, supplier, expiry,
   revocation); the service then re-opens the tenant scope withTenant(...) and
   re-validates the SAME invite under RLS — the projection bootstraps, it never
   authorizes.
2. **G-33 is BASE-denominated at rate 1** (the G-30 payout pattern): the disbursement
   journal is base == the cash line, and the treasury movement runs through the
   treasury store API with INV-019 exact — no FX semantics were invented for
   advances. The application leg posts under source operation `apply`.
3. **Supplier-level advance application** (not per-invoice): the apply leg DRs
   `AP_CONTROL` (partner-stamped) and CRs the same ADVANCES control, so the
   supplier's subledger nets; `applied_amount` ≤ `amount` is the DB CHECK and the
   service tracks the open-item allocation.
4. **Blanket releases generate executable POs** — the release ledger row carries
   `purchase_order_id` created in the same transaction; the GRN/AP flow runs against
   the PO's own lifecycle (the release never posts a journal — INV-022: +0 goldens).
   `released_amount` advances transactionally in the release statement; the CHECK is
   the floor, the typed over-release lives in the service.
5. **Award traceability = `quote_comparisons.generated_docs` + PO line notes** — the
   frozen snapshot is evidence (never recomputed); the award block records the
   line-level decisions and generated_docs carries {kind, id, supplierId,
   documentNo?, lineRefs} so every generated PO/release walks back to its quotes.
6. **The 3-bid rule is tenant policy** (`purchasing.rfq.min_quote_count`):
   `threeBidDecision` returns the verdict consumed by the award service — ENFORCED
   typed rejection, ADVISORY one inbox notification + audit then proceeds, OFF
   (default). Both modes tested (BR-062).
7. **Scorecards fold delivery 40 / quality 40 / price 20** over a rolling window
   computed from live documents; ONE row per supplier, recompute overwrites; the
   approved-vendor list gates pricing suggestions per
   `purchasing.approved_vendor_list.mode` (OFF/FLAG/BLOCK).
8. **G-34 honesty floor: pay net early, then capture** — one capture per invoice
   (INV-013 source key (invoiceId, capture)); the capture verifies the treasury
   payment is POSTED, allocated onto the invoice's open item, inside the approved
   terms' window, and ≥ the net-after-discount amount. Both control accounts are
   tenant-mapped SETTINGS (not engine purposes) — unmapped fails closed with typed
   `SUPPLIER_ADVANCE_ACCOUNT_UNMAPPED` / `EARLY_DISCOUNT_INCOME_ACCOUNT_UNMAPPED`,
   zero partial writes (the payroll G-29 loan-account precedent).

## Pointers for the next phases

- **039 (Returns & Collections)** — reuse the scorecard aggregation pattern
  (`scorecards.ts` + the sweep) for partner credit-risk surfacing; the typed-settings
  fail-closed pattern carries over to any new control mapping.
- **043 (planning)** — blanket release schedules are planning inputs: read
  `blanket_orders` (window, min/max, price lock) + the append-only `blanket_releases`
  stream; never rewrite the ledger.
- **050 (supplier quality)** — extend `supplier_ratings` as additional fold inputs;
  the CHECK admits the 0..100 columns and `detail` jsonb is the evidence envelope —
  no reshape of the one-row-per-supplier store.
- **060 (full portal)** — build on the P-05 skeleton: PUBLIC_ROUTES surface, scoped
  hashed tokens, the definer projection, rate limiter, audit trail all stay; add the
  authenticated portal app without forking the credential model.

## Gate evidence

Recorded (main agent gate run, 2026-11-10): typecheck 8/8 · lint 8/8 · depcruise 0
violations (1,621 modules / 11,540 deps) · unit 1,414 (api 502 · web 73 · desktop 274 ·
mobile 393 · ui 42 · contracts 56 · domain-core 38 · sync-core 36) · **DB full suite
2,555/2,555 green (176 files**, three sequential post-change chunk passes: 628 + 1,792
+ 135**)** · build 8/8 · i18n parity 4,699=4,699 (+163) · permissions drift 256=256 ·
manifests 13 · token contrast AA · ui catalog 39↔62 · web-security probe 6/6. Five
recorded gate repairs (the completion report's ledger): the §12 known-permission set
missing `purchasing.rfqs.read`, the 86→88 registry pins (golden + industry-018/019),
the 249→256 identity-flows seed pin, the report-hammer 57014 thundering herd (fixed
with single-flight coalescing in `RunService.run()` — wave walls 17.9 s → ~6 s), and
the MFA TOTP timestep time-bomb (~7% of runs). Environmental: notifications-email
mail-capture race (the 037 lineage) + the visual-harness CI-duty items. The full
ledger lives in `docs/implementation/phases/reports/PHASE-038-COMPLETION.md`.
