# User Journeys

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-10-27

Step-by-step journeys across the personas in [USER_PERSONAS.md](USER_PERSONAS.md). Each
journey names its actors, prerequisites, happy path (numbered steps with the system's
response), error/edge branches, audit events generated, and the phase that delivers each
step. Document states follow [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md);
invariants ([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md))
are cited where a step is the enforcement point. Arabic strings shown are canonical UI text.

## Journey A — Registration → onboarding → first invoice

**Actors.** Abu Mohammed (P-01, owner). **Prerequisites.** Public site live; jurisdiction
pack for the selected country seeded (PHASE-009 packs; general template at MVP).

| # | Step (user) | System response | Phase |
|---|---|---|---|
| A1 | Opens marketing site, taps "ابدأ مجاناً" (Start free) | Registration form: business name (AR/EN), country, phone/email, business-activity picker with template previews | 004 / 014 (site) |
| A2 | Selects activity "تجزئة — إكسسوارات جوال" (Retail — phone accessories) + country | Wizard preview: the `industry.retail` template, the country's jurisdiction pack (including honest "no VAT scheme" display where applicable), suggested base currency | 004 / 015 (full templates; MVP uses general defaults) |
| A3 | Submits registration with OTP verification | Tenant + owner membership created (status ACTIVE); jurisdiction pack bound; trial subscription recorded | 003 / 004 |
| A4 | Completes onboarding wizard: branch name, VAT registration status, fiscal year start, numbering preview | Workspace provisioned: bilingual CoA template applied with purposes mapped (`account_purposes`), one branch + one warehouse, numbering schemes per branch | 004 |
| A5 | Skips opening balances ("لاحقاً" — later) | Opening-balance draft remains open; banner reminds without blocking | 006 |
| A6 | Creates first item (name AR/EN, barcode, price) and first customer | Item + partner saved; item picks category default tax code | 006 |
| A7 | Opens "فاتورة جديدة" (New invoice), adds item ×2, sees totals with tax snapshot preview | Draft invoice computed live by the tax engine; official number not yet assigned (DRAFT shows temporary id) | 009 / 012 |
| A8 | Chooses **cash** payment, taps "ترحيل" (Post) | Document → APPROVED → POSTED atomically: official invoice number assigned (INV-021), balanced journal committed (cash/revenue/VAT), tax summary stamped, audit written | 012 |
| A9 | Taps "طباعة" (Print) | Bilingual RTL A4 invoice rendered from the A4 print template; PDF archived to tenant files | 013 |

**Error/edge branches.**

- A3 · phone/email already registered → offer login or membership request; never leaks
  existing tenant names.
- A2 · country pack incomplete for the chosen activity → proceed with the **general**
  template + banner "بعض إعدادات الصناعة غير متاحة بعد" (some industry defaults not yet
  available) — never fabricate defaults.
- A8 · tenant not VAT-registered → engine computes `NOT_SUBJECT`; invoice prints without VAT
  lines and the books stay consistent ([../localization/TAX_ENGINE.md](../localization/TAX_ENGINE.md) §1).
- A8 · credit customer instead of cash → credit policy applies first (BR-001: block/warn).
- A8 · posting date falls in a LOCKED period → rejected pre-write (INV-011) with an
  actionable message naming the period status.

**Audit events.** `tenant.created`, `onboarding.completed`, `opening_balances.deferred`,
`invoice.posted` (with before/after), `document.printed`.

## Journey B — Daily cash sale at POS, including offline

**Actors.** Noura (P-04, cashier). **Prerequisites.** Terminal registered
(`pos.terminals`), shift policy configured, items barcoded (PHASE-016).

| # | Step (user) | System response | Phase |
|---|---|---|---|
| B1 | Logs into terminal, taps "فتح الوردية" (Open shift), enters float | Shift record opened against the branch cash account; drawer opens; terminal goes to sale screen | 016 (shift model 008) |
| B2 | Scans item barcodes through the morning queue | Each scan appends a line in < 200 ms target with price from the resolved price list (BR-003); totals recompute live with tax preview | 016 |
| B3 | Takes cash 100, taps "بيع نقدي" (Cash sale) | Sale completes: simplified invoice POSTED, cash movement recorded, COGS journal at issue cost, 80 mm receipt prints ("شكراً لزيارتكم") | 016 |
| B4 | **Internet drops mid-morning** — she keeps selling | Terminal switches to offline mode (honest badge "غير متصل — سيتم المزامنة" — offline, will sync); each sale completes locally with `OFF-` receipt number and prints normally | 016 |
| B5 | Connectivity returns | Sale queue syncs: each offline sale posts server-side with the official number recorded **alongside** the `OFF-` number; the printed receipt's offline number stays reconcilable | 016 / 020 (general sync) |
| B6 | A customer returns an item from yesterday | Return flow validates the original invoice, applies the return-window policy (BR-004), issues credit note with stock re-entry at original cost | 016 (credit notes 012) |
| B7 | End of day: taps "إغلاق الوردية" (Close shift), counts drawer | Count entered per denomination; variance computed; shift POSTED; difference posts to cash-difference accounts (BR-021) if beyond tolerance | 016 (postings 008) |

**Error/edge branches.**

- B4 · a credit (known) customer during offline → cached credit-limit snapshot consulted;
  if the cached state cannot support the sale, the terminal requires cash or defers the
  credit sale; sync re-validates and returns actionable errors — never silently merges.
- B5 · a price changed server-side beyond tolerance during offline → that sale returns to
  the terminal as an **actionable rejection** (price changed — confirm or void); it is never
  auto-adjusted.
- B5 · period was locked while terminal was offline → push rejected with the period error;
  the sale lands in the next open period only via explicit operator choice, or escalates.
- B7 · variance beyond tolerance → shift cannot close silently; supervisor PIN + reason
  required; the event is flagged in the daily cash report.

**Audit events.** `shift.opened`, `pos_sale.posted` / `pos_sale.synced` (with offline
number), `credit_note.posted`, `shift.closed` (with count and variance),
`sync.push.rejected` (failures only).

## Journey C — Month-end close checklist

**Actors.** Sara (P-02, accountant); Eng. Mohammed (P-08, owner) for final lock.
**Prerequisites.** All trade modules live; reconciliation jobs ran (PHASE-007/013).

| # | Step (user) | System response | Phase |
|---|---|---|---|
| C1 | Opens close workspace for the period | Checklist rendered from **live checks**: subledger reconciliations (AR, AP, inventory, VAT, cash), unposted drafts, bank recs, recurring journals, FX revaluation, counts pending variance, VAT draft | 007 (engine) / 013 (workspace) |
| C2 | Reviews the AR tile showing `BROKEN` with a diff | Drill-down lists offending rows (partner subledger vs `AR_CONTROL`); she fixes by **new documents only** (reversal/adjustment — INV-009) | 007 |
| C3 | Disposes unposted drafts (post or cancel each) | Each draft shows its effect preview; cancels write `CANCELLED` with reason; gaps stay queryable | 012 (docs) |
| C4 | Completes bank reconciliations per account | Statement lines matched (auto then manual); unmatched items aging visible; statement period reconciled | 008 |
| C5 | Generates recurring journals (or skips with reason) | Job produces **drafts** referencing the recurrence; approvals apply normally | 007 |
| C6 | Runs (or waives) FX revaluation | Revaluation run posts a self-reversing dated pair; waiver recorded with reason | 007 |
| C7 | Clears count variance review queue | Each pending count is approved or returned; zero pending required (or waived with reason) | 010 |
| C8 | Verifies the VAT draft tile | VAT draft matches GL tax accounts (INV-012) → status "ready"; see Journey E | 009 |
| C9 | Marks checklist reviewed → SOFT_CLOSED | Banner warns soft-closed; posting still possible with `accounting.periods.post_to_soft_closed` + reason | 007 |
| C10 | Owner reviews; Sara sets LOCKED | Lock enforced by the posting engine (INV-011); DB trigger double-checks; reopen requires permission + reason + audit (INV-020), with reopen-age alerting | 007 |

**Error/edge branches.**

- C2 · drift above materiality (default 0) → written incident note attached to the
  reconciliation record (RISK-009 discipline: ledger-vs-subledger drift is Sev-1).
- C10 · attempt to lock with a `BROKEN` core check → blocked; the workspace names the check.
- C10 · a back-dated document arrives after lock → rejected pre-write; the fix is an open-
  period entry with memo, never a reopen-and-edit.

**Audit events.** `reconciliation.broken` / `reconciliation.verified`, `checklist.reviewed`,
`period.soft_closed`, `period.locked`, `period.reopened` (with reason + actor).

## Journey D — Stock count: planning → adjustment posting

**Actors.** Rashid (P-03, warehouse); Sara (P-02) approves variances.
**Prerequisites.** Count session policies configured (PHASE-010).

| # | Step (user) | System response | Phase |
|---|---|---|---|
| D1 | Creates count session: warehouse, scope (full / by category), blind count ON | Session DRAFT; system quantities snapshotted per line (`system_qty` frozen); printable count sheets (bilingual) generated | 010 |
| D2 | Warehouse continues normal movements during the count | Movements after the snapshot are flagged against the session and listed in variance review — operations never freeze | 010 |
| D3 | Rashid counts with the tablet (or POS-lite offline entry) | `stock_count_lines` captured: item, batch (where tracked), counted qty; unknown-barcode handling offered | 010 |
| D4 | Marks session COUNTED | Variances computed (counted − system); session → VARIANCE_REVIEW with per-line value impact at current valuation | 010 |
| D5 | Reviews variance list; recounts suspicious lines | Recount updates counted qty with audit; lines above the variance threshold (BR-015) demand a second counter or approval | 010 |
| D6 | Sara approves the session | Adjustment posting: shrinkage → DR `INVENTORY_SHRINKAGE` · CR `INVENTORY`; gains via `INVENTORY_APPRECIATION`; journals atomic with moves (INV-018); session → POSTED | 010 |
| D7 | Rashid opens the count report pack | Variance report, movement-since-snapshot list, and adjustment journal drill-down | 013 |

**Error/edge branches.**

- D3 · an item counted that the system doesn't know ( barcode) → quick-create path for
  items with the `warehouse` role restricted to draft pending an `items.manage` user.
- D6 · batch-tracked line counted without batch → variance review forces batch assignment
  or rejects the line (batch integrity is non-negotiable).
- D6 · adjustment date in a locked period → rejected (INV-011); count must post in an open
  period (typically the count date governs).

**Audit events.** `count.created`, `count.line_entered` (batched), `count.submitted`,
`count.recounted`, `count.approved`, `adjustment.posted`.

## Journey E — VAT return preparation and internal review

**Actors.** Sara (P-02) prepares; Eng. Mohammed (P-08) approves; Huda (P-09) may prepare in
smaller tenants. **Prerequisites.** Tax registrations configured; period's documents posted
(PHASE-009; review workflow polished at PHASE-013/014).

| # | Step (user) | System response | Phase |
|---|---|---|---|
| E1 | Opens "الإقرار الضريبي" (VAT return), picks period + jurisdiction + registration | Engine aggregates posted documents' tax summaries: output tax by treatment, input tax (recoverable vs expensed), reverse-charge amounts | 009 |
| E2 | Views the reconciliation panel | Side-by-side: document-summary totals vs GL tax-account movements for the period (INV-012); drill-down to documents and journal lines | 009 |
| E3 | Investigates a mismatch | Drill-down pinpoints offending documents (e.g., a draft posted after a prior draft's preview); fixes are new documents — the return recomputes deterministically | 009 |
| E4 | Marks the draft "ready for review" | Ready-to-file status gated by the INV-012 check passing; status + evidence stored with the draft | 009 |
| E5 | Owner reviews and approves internally | Approval recorded (actor, time); the platform **reports** — humans file with the authority; no filing claims | 009 |
| E6 | Exports the bilingual RTL return + backing schedules | PDF/XLSX export via report engine; filing metadata (who filed, when, reference) recorded afterwards for audit | 009 / 013 |

**Error/edge branches.**

- E2 · mismatch → "ready-to-file" is blocked (hard gate); the workspace explains which
  treatment bucket diverges and by how much.
- E1 · rate change mid-period (pack version boundary) → snapshots keep posted documents
  stable; the return separates buckets by rate version; drafts spanning the change warn.
- E1 · unregistered tenant → the workspace explains the `NOT_SUBJECT` posture and shows what
  will change on registration, without inventing future filings.
- E5 · period locked between E4 and E5 → approval still allowed (no posting), but any
  correcting document must land in an open period with memo.

**Audit events.** `vat_return.drafted`, `vat_return.recomputed`, `vat_return.ready`,
`vat_return.approved`, `vat_return.filing_recorded` (metadata only).

## Journey F — Expense claim approval

**Actors.** Any employee member (e.g., Khaled P-05); approver per policy (Tariq P-06 for
purchasing-related, Eng. Mohammed P-08 for high amounts). **Prerequisites.** Expense
categories + approval policies configured (PHASE-008).

| # | Step (user) | System response | Phase |
|---|---|---|---|
| F1 | Opens "مطالبة مصروف" (Expense claim): category, amount, date, notes | Category resolves the expense account and its approval policy; required-receipt rule applied | 008 |
| F2 | Photographs the paper receipt and attaches it | File validated, stored tenant-scoped, checksum recorded; attachment visible to approvers | 008 |
| F3 | Submits the claim | Claim → PENDING_APPROVAL; policy resolves approver(s) (category owner, amount threshold BR-023); self-approval blocked by default | 008 |
| F4 | Approver reviews effect preview (expected journal lines) and approves | Preview generated by the same engine code that will post (no preview/post divergence); claim → APPROVED | 008 |
| F5 | Cashier/accountant pays out from petty cash or bank | Payout document posts DR expense · CR cash; claim → POSTED; category + cost center flow to the journal | 008 |
| F6 | Claimant sees status timeline | DRAFT → PENDING_APPROVAL → APPROVED → POSTED with actor/time per hop (document lifecycle states) | 008 |

**Error/edge branches.**

- F3 · amount above the approver's threshold → routes to the next tier (BR-010 family);
  escalation visible to the claimant with an honest "waiting for" label.
- F3 · creator equals approver → blocked unless policy explicitly allows self-approval
  (`policy.expenses.allow_self_approval`, default OFF — BR-034).
- F5 · petty cash balance insufficient → payout blocked with top-up guidance (BR-020);
  the claim stays APPROVED, not silently downgraded.
- F2 · receipt required but missing (category rule) → submit blocked with the category rule
  cited.

**Audit events.** `expense.submitted`, `expense.approved` / `expense.rejected` (with
reason), `expense.paid_out`, `expense.posted`.

## Journey G — Van-sales rep day with settlement

**Actors.** Khaled (P-05, sales); Rashid (P-03, warehouse) loads the van; Sara (P-02)
reviews settlements. **Prerequisites.** Routes, van warehouse, settlement policy
(PHASE-017; offline via Android app PHASE-022).

| # | Step (user) | System response | Phase |
|---|---|---|---|
| G1 | Morning: warehouse issues the van load against a stock transfer | Transfer to the van warehouse POSTED (two-leg); van stock balances become the rep's accountability baseline | 017 (transfers 010) |
| G2 | Khaled opens the route app: today's visits + cached customer balances | Route visits ordered; per-customer tier pricing + free-goods suggestions precomputed | 017 |
| G3 | At each stop: sells (cash or credit), collects receipts, takes returns | Invoices/receipts/credit notes captured (offline-capable at PHASE-022); each document attributed to the rep; totals accumulate live on the settlement screen | 017 / 022 |
| G4 | Signal returns mid-route | Outbox syncs with idempotency keys (INV-013); duplicates return the original result; the app reflects posted states | 020 / 022 |
| G5 | Returns to the depot; counts collected cash with the supervisor | Settlement session: system totals (invoices, returns, collections) vs counted cash; variance computed (BR-021 family) | 017 |
| G6 | Supervisor approves the settlement | Settlement POSTED: cash deposited to treasury (transfer to main cash/bank), sales/AR effects already posted at document sync; variance posts to cash-difference with the settlement as source | 017 |
| G7 | End-of-day van recount (optional policy) | Remaining van stock counted; discrepancy vs ledger becomes a variance line on the settlement or a count session (tenant policy) | 017 |
| G8 | Khaled checks his commission statement | Commissions computed from settled, non-reversed sales per his rate | 017 |

**Error/edge branches.**

- G3 · offline credit sale to a customer whose cached limit is stale → cached snapshot
  governs (warn posture default); sync re-validates and, on breach, returns an actionable
  error to the rep and flags the customer per BR-001.
- G5 · counted cash ≠ collected cash → variance line with reason required; above tolerance
  the settlement escalates to the accountant before posting.
- G6 · unsynced documents remain → settlement cannot close; the app names the missing
  documents ("مستند غير مزامن") — no partial blind settlement.
- G6 · rep reverses a sale after settlement → allowed as a normal credit note; the
  commission statement recomputes only from non-reversed sales.

**Audit events.** `van_load.posted`, `route_visit.completed`, `invoice.posted` (rep-attributed),
`receipt.posted`, `settlement.opened`, `settlement.posted` (with variance detail),
`settlement.variance_escalated`.

## Journey H — Tenant offboarding with data export

**Actors.** Eng. Mohammed (P-08, owner requests); Layla (P-07, platform admin executes).
**Prerequisites.** Subscription lifecycle + export tooling (PHASE-004 backend, PHASE-014
billing integration).

| # | Step (user) | System response | Phase |
|---|---|---|---|
| H1 | Owner requests offboarding from settings with confirmation typing the tenant name | Request recorded; tenant enters a **read-only grace period** (duration PLACEHOLDER per OQ-009 discussion); users can export but not post | 004 / 014 |
| H2 | Owner (or admin on request) triggers full data export | Export job assembles: structured JSON per entity, CSV per entity, document PDFs, report archive; signed download URL issued; job audited | 004 |
| H3 | Owner downloads and verifies the export | Manifest with checksums + entity counts + schema version provided for verification | 004 |
| H4 | Grace period ends without cancellation | Tenant status → SUSPENDED: sessions invalidated, device pushes rejected, sync pulls return `tenant_suspended` (MULTI_TENANCY §6) | 004 |
| H5 | Retention window elapses (90-day default per [OQ-009](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) — placeholder pending legal review) | Data deleted by the documented purge job; deletion certificate (what/when/by-whom) retained in platform audit; restore impossible | 004 / 014 |
| H6 | Admin reviews the platform audit trail | Full offboarding timeline visible: request → exports → suspension → purge, every step with actor | 003 / 004 |

**Error/edge branches.**

- H1 · outstanding subscription balance → offboarding proceeds to read-only; the billing
  fallback (manual invoicing) reconciles outside the product; data is never held hostage
  silently — the owner sees the state honestly.
- H2 · export fails partway → the job is resumable; partial artifacts are never presented
  as complete (manifest completeness check).
- H4 · owner cancels during grace → tenant restored to ACTIVE; audit records the reversal.
- H5 · legal-hold request → purge blocked for that tenant by platform admin flag; the block
  itself is audited (jurisdiction-dependent; see [../localization/](../localization/TAX_ENGINE.md)).

**Audit events.** `offboarding.requested`, `export.generated`, `tenant.suspended`,
`tenant.restored`, `tenant.purged`, `legal_hold.applied`.

## Journey coverage matrix

| Journey | Primary personas | Core invariants exercised | Delivering milestone |
|---|---|---|---|
| A · Registration→first invoice | P-01, P-09 | INV-001/002/006/021 | MVP (PHASE-014; invoice from PHASE-012) |
| B · POS day + offline | P-04 | INV-006/013/018 (offline) | PHASE-016 (+020 sync) |
| C · Month-end close | P-02, P-08 | INV-009/010/011/012/019 | PHASE-007/013 |
| D · Stock count | P-03, P-02 | INV-010/017/018 | PHASE-010 |
| E · VAT return | P-02, P-08, P-09 | INV-012/022 | PHASE-009 |
| F · Expense claim | P-05, P-06, P-08 | INV-001/007/016 (policy) | PHASE-008 |
| G · Van-sales day | P-05, P-03, P-02 | INV-013/016/018/019 | PHASE-017 (+022 offline) |
| H · Offboarding | P-08, P-07 | (platform integrity; audit) | PHASE-004/014 |
