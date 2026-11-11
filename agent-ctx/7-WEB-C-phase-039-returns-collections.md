# 7-WEB-C — PHASE-039 web UI (Returns & Collections: customer RMAs + warranties, dunning, supplier RMAs)

**Task ID:** 7-WEB-C (PHASE-039, matrix §3.2/§3.3). Work ONLY in `apps/web` +
`packages/contracts/src/navigation.ts` + `apps/web/components/app-shell.tsx` (this worklog +
`/agent-ctx`). `apps/api` and `docs/` untouched (read-only reference).

**Repo state at handoff:** an interrupted previous run had left substantial, near-complete
partial files (3 pages, 3 workspaces, the full WEB-039 i18n block, 3 nav rows, 3
FALLBACK_CRUMBS, and the api-types rows). Per the spec's audit-first instruction this session
AUDITED everything against the spec + the frozen API controllers (never assumed), found and
fixed 5 real defects in the in-progress code, and re-ran every gate from scratch.

**Status:** COMPLETE — every mandated gate green.

## Files (final state)

| File | Lines | Change |
| --- | --- | --- |
| `apps/web/app/[locale]/sales/returns/page.tsx` | 108 | NEW (from partial run; audited). Server page: getDictionary → requireSessionToken → parallel fetchApi (rmas, warranties, customers `partners/partners?kind=CUSTOMER&limit=100`, items `items/items?limit=100`, POSTED invoices `sales/sales-invoices?status=POSTED&limit=100`, tenancy branches, treasury cash accounts, identity session) → AppShell + `ReturnsWorkspace`; 401→redirect; 403→ErrorState forbidden; canManage=sales.rma.manage, canApprove=sales.rma.approve, canWarranties=sales.warranties.manage. This session: comment fix for the conditional warranties tab. |
| `apps/web/app/[locale]/sales/dunning/page.tsx` | 123 | NEW (from partial run; audited + FIXED). Parallel fetchApi (letters, policies, actions, credit-reviews?due=1, agencies, referrals, invoices `sales/sales-invoices?status=POSTED&kind=CREDIT&limit=100`, session) → `DunningWorkspace`; canDun=sales.dunning.manage, canFees=sales.late-fees.manage, canAgencies=sales.collection-agencies.manage. **Fix:** the partners fetch was `partners/partners?limit=200` — the partners controller's LIMIT is `max(100)`, so the call 400'd and every partner label would have degraded to raw UUIDs. Now two kind-scoped fetches (`kind=CUSTOMER&limit=100` + `kind=SUPPLIER&limit=100`, feeding the letters/actions/reviews/refer pickers and the agency register respectively) deduped by id (BOTH-kind partners ride both pages). |
| `apps/web/app/[locale]/purchasing/returns/page.tsx` | 98 | NEW (from partial run; audited). Parallel fetchApi (srmas, suppliers `kind=SUPPLIER&limit=100`, items, `purchasing/purchase-orders?limit=100`, tenancy branches, `inventory/warehouses` — the receipts idiom, session) → `SupplierReturnsWorkspace`; canManage=purchasing.rma.manage. |
| `apps/web/components/returns-workspace.tsx` | 1414 | NEW (from partial run; audited + FIXED). Tabs [RMAs | warranties]: RMA table (rmaNo/partner/invoice/status badge/disposition/total/requested/completed) + per-status actions (approve on REQUESTED [canApprove], receive on APPROVED, inspect+disposition dialog on RECEIVED, complete with refund-cash-account select when disposition=REFUND on INSPECTED, cancel with reason dialog on REQUESTED/APPROVED) + create dialog (branch + POSTED-invoice picker → per-line qty inputs over the fetched invoice lines + 6-code reason select + reason/reasonAr/note) + detail dialog with lines + warranty tab (list + create dialog partner/item/serial/start/duration/coverage/basis/mileage + void on ACTIVE). **Fixes:** (1) `submitCancel` sent `cancelTarget.reason` (the RMA's own nullable create reason) instead of the typed dialog input — the API's `cancelSchema` needs a 3–500 char string; now sends the typed reason with min-3 validation. (2) create qty-map validation hardened: a typed-but-invalid qty now blocks submit (no silent line drops); qty strings trimmed on the wire. (3) the warranties tab now renders only for `canWarranties` holders (the dunning agencies rule — a 403 register must not masquerade as an honest empty list). |
| `apps/web/components/dunning-workspace.tsx` | 2367 | NEW (from partial run; audited + FIXED). Tabs [letters | policies | actions | credit reviews | agencies]: letters table (step/days/channel/status/partner/invoice/letterDate/sentAt/fee/feeInvoice/waiver) + sweep runner (asOf optional, `sales/dunning/run`, localized result line) + charge-fee/waive-fee (canFees) with waiver-reason dialog; policies list (per-policy card: status + default badges, mini-ladder chips `n · +Nd · CHANNEL` with escalate/refer badges, late-fee summary) + activate/archive + create dialog (step builder with monotonic day validation, fee mode CONTRACT_RATE/STATUTORY_CAP with rate/grace/max/source fields, MONEY4 max); actions log + create dialog (9 action types, outcome, promisedDate REQUIRED for PROMISE_TO_PAY, followUpDate, amount MONEY4, note); credit reviews due workset (class badge A–D) + record-review dialog (scoreClass/nextReviewAt/note); agencies register + create + issue-token (copyable, shown-ONCE warning banner, the 038 enrollment-secret discipline) + suspend/activate + referrals table with refer/settle (MONEY4)/post-commission (G-39)/close dialogs. **Fixes:** (1) waive-fee reason now validates min-3 chars (API `waiveFeeSchema`); (2) `policyReady` validates grace-days as an integer ≥ 0; (3) added the fee-invoice column to the letters table (the `dunningColFeeInvoice` key existed but was unused). |
| `apps/web/components/supplier-returns-workspace.tsx` | 814 | NEW (from partial run; audited + FIXED). SRMA table (srmaNo/supplier/PO/status/total/requested) + create dialog (branch + PO picker filtered to APPROVED/ISSUED/CLOSED — matches the API's `PO_RETURNABLE_STATUSES` exactly → per-line qty inputs + 7-code reason select) + approve (confirm) / ship (warehouse select — the API's `warehouseId` body) / credit (G-38 confirm) / cancel (reason dialog) + detail dialog with lines. **Fixes:** the same cancel-reason and qty-map-validation defects as the customer workspace. |
| `apps/web/i18n/dictionaries.ts` | 16286 | CHANGED (from partial run; verified). `// -- WEB-039 (PHASE-039): returns & collections` block in all three literals — **320 keys** per side (interface 5078–5397, ar 10471–10800, en 15888–16217), natural Saudi business Arabic (أذونات الإرجاع، الضمانات، خطابات الاستذكار، الرسوم المتأخرة، مراجعات الائتمان، وكالات التحصيل، الإحالات). Parity 5019=5019, no empty values. |
| `packages/contracts/src/navigation.ts` | 1257 | CHANGED (from partial run; verified). 3 rows, exact 038 shape: `sales.returns` → `/sales/returns` (featureKey `sales.rma`, permission `sales.rma.read`, icon undo-2, sales group order 70); `sales.dunning` → `/sales/dunning` (`sales.dunning` / `sales.dunning.manage`, hourglass, order 80); `purchasing.returns` → `/purchasing/returns` (`purchasing.rma` / `purchasing.rma.read`, corner-up-left, order 45). No duplicate ids/routes; all three icons exist in the @erp/ui icon map; feature/permission keys confirmed seeded in `route-permissions.ts` + the controllers' `@RequireFeature`/`@RequirePermissions`. |
| `apps/web/components/app-shell.tsx` | 582 | CHANGED (from partial run; verified). +3 `FALLBACK_CRUMBS`: `sales/returns` → {navSales, returnsNav}, `sales/dunning` → {navSales, dunningNav}, `purchasing/returns` → {navPurchasing, supplierReturnsNav} (the support-sessions rule: crumbs only; the sidebar stays registry-driven). |
| `apps/web/lib/api-types.ts` | 5508 | CHANGED (from partial run; verified against the frozen controllers). +18 wire types: `RmaReasonCode`, `RmaDisposition`, `RmaRow`, `RmaLineRow`, `RmaWithLines`, `WarrantyTerms`, `WarrantyRow`, `DunningStep`, `DunningPolicyRow`, `DunningLetterRow`, `CollectionActionRow`, `CreditReviewRow`, `CollectionAgencyRow`, `CollectionReferralRow`, `DunningSweepResult`, `LateFeeChargeResult`, `SupplierRmaReasonCode`, `SupplierRmaRow`, `SupplierRmaLineRow`, `SupplierRmaWithLines`, `PurchaseOrderLineRow`, `PurchaseOrderWithLines`. |

## Reports deliverable (registry-driven — no web change needed)

`/reports` fetches `reporting/reports` (the registry snapshot) and the workspace groups whatever
categories the registry returns. Both PHASE-039 contracts are registered in the API:
`sales.rma_register` (params dateFrom/dateTo/family, permission `sales.rma.read`) and
`sales.dunning_status` (params asOf, permission `sales.dunning.manage`) at
`apps/api/src/modules/reporting/registry/operational/returns-dunning.ts`, wired into the
registry index — they surface on the reports index automatically for permission holders.

## Contract verification (every path/body checked against the frozen API)

- Routes confirmed 1:1 in `returns.controller.ts` / `dunning.controller.ts` /
  `supplier-returns.controller.ts` (`@Controller("/api/v1/sales")` / `("/api/v1/purchasing")`).
- Bodies confirmed against the zod schemas: RMA create (branchId/invoiceId/reasonCode/reason/
  reasonAr/note/lines[invoiceLineId,qty,note]), inspect {disposition, inspectionNote}, complete
  {refundCashAccountId}, cancel {reason min 3}, warranty create (terms nested: durationMonths/
  coverage/basis/mileageLimitKm), dunning policy create (steps array with stepNo auto-numbered,
  lateFeeRatePct PCT ≤2dp, lateFeeMaxAmount MONEY4 canonical 4dp, lateFeeSource ≥3 chars for
  STATUTORY_CAP), action create (promisedDate REQUIRED for PROMISE_TO_PAY, amount MONEY4),
  review record (scoreClass A–D), agency create (PCT_OF_COLLECTED→commissionPct | FLAT_FEE→
  flatFee MONEY4), referral create/settle (referredAmount/settledAmount MONEY4), SRMA create
  (poLineId lines) + ship {warehouseId}.
- Reference paths confirmed: `partners/partners?kind=…&limit=100` (LIMIT max 100 — the bug
  source), `items/items?limit=100` (max 100), `sales/sales-invoices?status=&kind=&limit=`
  (max 500), `purchasing/purchase-orders?limit=` (max 500), `treasury/cash-accounts` (limit
  param ignored, harmless), `tenancy/branches`, `inventory/warehouses`,
  `sales/credit-reviews?due=1`.
- bffFetch auto-carries CSRF + a fresh Idempotency-Key on every unsafe call (the global POST
  guard).

## Style compliance

Sourcing-workspace idiom copied exactly: string drafts + regex validation (QTY_RE 6dp,
MONEY_INPUT_RE + `toMoney4` canonical 4dp, PCT_RE 2dp, DATE_RE, CURRENCY rules), bffFetch,
router.refresh() after every write, localizedApiError via per-workspace error-code families
(RMA_STATE_INVALID → returnsErrState, LATE_FEE_ALREADY_CHARGED → dunningErrFeeAlreadyCharged,
SCRAP_LOSS_ACCOUNT_UNMAPPED → returnsErrScrapUnmapped, …), Badge neutral/primary tone maps,
status→label maps, loading (`d.loading`) + empty states per table, `activeLocaleHeader` +
`dir="ltr"` mono/tabular-nums for codes and money, `window.confirm` for destructive hops,
`formatMessage` placeholders ({days}, {letters}, {months}, {km}). NO new deps.

## Verification (all green; exact outputs)

```
cd apps/web && npx tsc --noEmit -p tsconfig.json          → (no output) PASS
cd apps/web && npx eslint app components i18n --ext .ts,.tsx → (no output) PASS
pnpm check:i18n-parity → "ar=5019 keys, en=5019 keys — 100% key parity; no empty values." PASS
cd packages/contracts && pnpm typecheck                   → (no output) PASS
```

## Ambiguities resolved

1. **Spec's `GET partners?…` / `items?…` shorthand** — the real BFF-relative routes are
   `partners/partners?…` (controller `api/v1/partners` + `@Get("partners")`) and `items/items?…`
   (controller `api/v1/items`); used the real ones (the pos/job-cards and crm/manufacturing
   precedents). The rfq reference page's `partners?limit=500` resolves to a nonexistent route
   (404 → silent [] degrade) — NOT copied.
2. **Partners page cap** — `partners/partners` LIMIT max is 100, so the dunning page fetches
   CUSTOMER + SUPPLIER kind pages (100 each) and dedupes by id; agencies are partner-linked
   without a kind constraint (service-layer verified), so suppliers feed the agency picker.
3. **Warranties tab visibility** — the API gates `GET sales/warranties` behind
   `sales.warranties.manage`; the tab renders only for holders (the dunning agencies rule)
   rather than showing a misleading empty register to `sales.rma.read` users. Warranties stay
   a returns-screen tab (no nav row), per the spec.
4. **Cancel/waive reason minimum** — the API schemas require 3–500 chars; the dialogs validate
   min-3 client-side for honest inline feedback (was non-empty only).
5. **Letters fee-invoice column** — `feeInvoiceId` is a raw UUID (no doc-no on the letter row);
   rendered as a mono 8-char honest link with a code comment (the referral
   commissionEntryNo rule — a doc-no lookup can ride the row later).
