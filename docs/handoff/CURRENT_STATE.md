# Current State

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-09

What actually exists in this repository right now. Paired with
[../planning/IMPLEMENTATION_STATUS.md](../planning/IMPLEMENTATION_STATUS.md) (phase
table) and [NEXT_ACTION.md](NEXT_ACTION.md).

## Repository contents

- **Documentation blueprint v2.0 — COMPLETE** (v1.1 consolidated baseline + platform depth
  & breadth expansion per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md)): 265
  Markdown documents under `docs/` covering vision, product
  requirements, scope, glossary (EN↔AR), architecture (system overview, 18 ADRs,
  module boundaries, dependency rules, data flows, security, multi-tenancy, deployment,
  observability), planning (34-phase roadmap, dependency graph, acceptance criteria,
  status, release strategy, risk register), database (conventions, entity catalog, data
  dictionary, relationships, constraints/indexes, tenant isolation, migration strategy,
  backup/recovery, ERDs, table specs, seeds), product (personas, journeys, workflows,
  BR-001…056 business rules, industry/feature catalogs — 22 modules, 172 feature keys
  (131 v1.1 + 38 v2.0) — subscriptions & entitlements,
  configuration engine), accounting (principles, bilingual CoA, posting engine,
  document lifecycle, journal rules with golden postings G-01…G-32, AR/AP, inventory
  accounting, period closing,
  reconciliation, invariants INV-001…026), industries (framework + capability matrix +
  13 template manifests (8 v1.1 + 5 v2.0 commercial shells) + workflows + report
  catalog), localization (architecture,
  RTL/LTR, currency/precision, country packs for SA/AE/BH/KW/OM/QA/YE/EG/JO/IQ with
  compliance matrices + official-sources registry, tax engine, e-invoicing
  architecture), api (conventions, authentication, error model, idempotency,
  versioning, OpenAPI strategy, integrations catalog), ui (principles, tokens, design
  system, 49-component catalog, 12 page archetypes, navigation (10 groups), RTL rules,
  accessibility, motion, visual testing), reporting (architecture, report contract,
  catalog with 67 core + v2.0 reports plus the per-phase industry sets (13 shipped
  industry contracts across 015–018; registry 66), financial statement rules, printing/export,
  reconciliation), offline (architecture, local DB, sync protocol, conflict
  resolution, idempotency, device security, capabilities matrix, failure recovery),
  security (threat model, authorization matrix, data protection, secrets, security
  test plan, incident response), testing (strategy, accounting tests with golden
  datasets, tenant isolation tests, sync chaos suite, regression, performance),
  operations (dev setup, environments, CI/CD, deployment, backup/restore runbook,
  disaster recovery, monitoring, troubleshooting), implementation (34 phase documents
  + phase/completion/code-review templates), decisions (records for pricing, payment
  provider, costing default, ZATCA scope, Yemen scope, observability vendors, and the
  v2.0 expansion set: platform expansion, fixed assets, notes & installments,
  budgeting, payroll scope, consolidation), and this handoff set.
- **Application code: PHASE-001 … PHASE-025 (all COMPLETE) — **GA RELEASED
  (v1.1.0 / CalVer v1.26.11.0, tags real in this repository)** — the MVP v1.0
  release + the industry configuration engine + Point of Sale + the
  automotive/distribution templates + Manufacturing & Production + CRM/Service
  Contracts & Projects + the Offline Synchronization Foundation + the Desktop
  Application (Tauri shell) + the Android Application (Expo/RN) + the External
  Integrations & E-Invoicing substrate + Security Hardening + the Performance/
  Reliability/GA-Readiness closing phase (the 10× local load harness T-01…T-08
  ALL PASS, the DR drills executed with timings, the SLO/error-budget substrate
  live with SLOBurn, the observability audit green, the GA checklist closed
  with the honest ledger).** The
  pnpm + Turborepo monorepo with all local gates green (re-verified 2026-11-03):
- **Post-GA v2.0 expansion on this lineage (2026-11-09) — THE 34-PHASE
  ROADMAP IS COMPLETE:** after GA, this repository's lineage shipped
  PHASE-027 (notes & installments, migration 0038 — schema_version 38) and
  the stage-10 commercial-shell templates PHASE-032 education (0039) +
  PHASE-033 agriculture (0040 — both configuration-only through the
  unmodified PHASE-015 engine), then **PHASE-034 Multi-Entity Consolidation
  (0041, the final roadmap phase — the Enterprise Depth gate): the
  `consolidation` module** (groups/membership configuration, G-32
  eliminations via the posting engine into the parent's consolidation books,
  BR-056-gated read-only runs over the audited platform-plane reader with
  ZERO cross-tenant writes, the DR-P34-FX-1 dated-FX translation decision,
  the four §10 consolidated-statement report contracts — registry 80) with
  the web surfaces and the unit/DB suites. The sibling phases 028–031 were
  lost to environment resets on this lineage and remain NOT_STARTED (the
  honest lineage note in IMPLEMENTATION_STATUS); every shipped phase's
  evidence is in its completion report under
  [../implementation/phases/reports/](../implementation/phases/reports/).
  Post-completion: the maintenance/ops handoff per MASTER_ROADMAP §Handoff.
  - `apps/api` — NestJS with `GET /health/live` + `GET /health/ready` (DB +
    migration state + queue liveness); modules: `audit` (append-only, transactional
    appends inside the caller's UoW + audit.view-gated query endpoint),
    `files` (S3 adapter + signed URLs + upload constraints, tenant-prefixed keys),
    `identity` (argon2id login, rotating opaque sessions 12 h/30 min, progressive
    lockout + per-IP windows, TOTP MFA with replay rejection + hashed recovery
    codes, stateless HMAC reset tokens, single-use invitations, RBAC admission via
    `@RequirePermissions` + route registry, roles editor primitives, tenant-context
    middleware + interceptor inside the RLS UoW), `notifications` (AR/EN email
    templates, minimal SMTP client, pg-boss queue with dedupe); infra: drizzle pool
    (non-owner `erp_app`), tenant-context unit-of-work (`withTenant`, transaction-local
    GUC, ALS), pg-boss queue client (`boss` schema, WORKER_MODE), ERROR_MODEL
    exception filter + success envelopes + Idempotency-Key presence guard, pino
    logging with correlation ids + redaction, OTel api no-op wiring, and — from
    PHASE-007 — the **accounting module** (the platform's financial heart): CoA
    readiness service (tree rules V1–V6, `account_purposes` 1-active-per-purpose
    resolution, fail-closed `PURPOSE_NOT_MAPPED`), fiscal calendar (12 monthly
    periods + OPENING/CLOSING windows, OPEN→SOFT_CLOSED→LOCKED with audited
    transitions, reopen + >2-month anti-fraud alert), dated exchange rates, the
    **posting engine** (ADR-0007 pure domain package — the ONLY writer of
    `journal_entries`/`journal_lines`, validation pipeline 1–8 in order,
    verbatim error taxonomy, idempotency on `(tenant, source_type, source_id,
    operation)` INV-013/CC-01, reversal-only correction INV-014, append-only
    guards + balance + period-lock triggers INV-003/011), manual journals
    (draft→submit→approve→post, SoD creator≠approver default), recurring journals
    (pg-boss DRAFT generation, never auto-posts), approval policies (BR-034
    base-currency thresholds), GL queries (trial balance, movements + running
    balance, journal register, INV-006 drill-down), cost centers, the numbering
    service (JE-{yyyy}-{seq:6}, ADR-0006), opening-balance posting (G-16 via the
    partners subledger port — per-partner AR/AP rows from entry #1), year-end
    close (PC-05…07, idempotent + unit-reversible), and the reconciliation
    framework (RC-01…03 AR/AP) + close checklist (NOT_APPLICABLE explicit). The
    partners module exposes the sanctioned same-transaction subledger api.
    Migrations `0010_accounting_core.sql` + `0011_journal_tables.sql` ship the
    tables (all RLS'd, composite-FK'd, registry-isolated). From PHASE-008 — the
    **treasury module** (the daily cash heartbeat): cash/bank/petty account
    service (open requires a mapped GL account, 1:1 by unique constraint; close
    preserves history; balance is always derived Σ `cash_movements` — INV-019),
    receipts/payments services (DRAFT→POSTED through `PostingEngine.post`,
    official RCV-/PAY- numbers at posting INV-021, methods incl. reserved CHEQUE,
    FX rate capture), the allocation service (FIFO suggestion, partials,
    INV-016 bounds enforced under the open-item row lock CC-02, on-account
    remainders as explicit open items BR-027), realized-FX settlement
    (SettlementCore: cash at current rate · control at the ORIGINAL stored rate
    INV-008 · explicit FX_GAIN/FX_LOSS residual line with references — goldens
    both directions), petty-cash guard (BR-020 per-tx + fund caps with
    PLACEHOLDER defaults documented in the settings schema + accountant
    override with audit), transfer service (G-12 with BANK_CHARGES fee posting,
    two movements, INV-019 both sides), expense service (BR-023 categories with
    per-category approval, receipt attachment via the files module, reserved
    `tax_code_id` for PHASE-009), shift service (BR-021 float/capture/close,
    tolerance auto-post with the shift as source, supervisor id+PIN above
    tolerance), statement import (pluggable adapter registry: generic-csv with
    Arabic-header mapping + generic-xlsx; sha-256 file-hash idempotency; row
    caps), bank-rec workspace service (auto-match amount+window+reference,
    exact manual match, unmatched aging both sides, per-account period lock
    BR-022 — statement lines never become ledger entries), and the treasury
    INV-019/RC-08 reconciliation check registered into the PHASE-007 framework
    (seeded drift → BROKEN + notification + PC-04 period-lock block; the close
    checklist's cash + bank-rec items are live with explicit NOT_RUN/
    NOT_APPLICABLE states). Migration `0012_treasury.sql` ships 11 tables (all
    RLS'd, composite-FK'd, registry-isolated; `cash_movements` append-only by
    grants + guard trigger — no UPDATE/DELETE for `erp_app` at all). From
    PHASE-009 — the **tax module** (six-treatment engine, all 10 jurisdiction
    packs with REQUIRES_VERIFICATION provenance, deterministic resolver with
    frozen rate snapshots BR-033, registrations with the settings
    expand-migration, the G-11 expense VAT leg, the INV-012 append-only
    summaries, VAT return v1 with the side-by-side cross-check + ready-gating,
    the RC-06/RC-07 check in the reconciliation framework with PC-04 lock
    block, and the EInvoicingAdapter port + fake adapter with the RISK-005
    refusal). Migration `0013_tax.sql` ships 3 global reference tables (no
    RLS by design, read-only to erp_app) + 6 tenant tables
    (`tax_document_summaries` append-only). From PHASE-010 — the
    **inventory module** (where money physically sits): warehouse service
    (branch-linked, per-warehouse GL inventory-account override — the G-15
    distinct-accounts seam; activation/deactivation), item-warehouse settings
    (reorder_level/min_qty + the once-per-24h-window reorder stamp BR-019),
    the movement core — one transaction per move: stock rows +
    `PostingEngine.post` + audit (INV-018; crash-injection proven), WAC + FIFO
    valuation engines at 6-decimal internal precision (oracle property
    suites: average within [min,max], Σ layer qty = on-hand exactly), the
    opening-stock flow consuming PHASE-006 stock drafts through the OPENING
    period (G-16 stock leg with per-item layers, INV-010 green from entry
    #1), transfers DRAFT → IN_TRANSIT → POSTED (two legs at conserved value;
    journal only when the warehouses resolve distinct GL accounts — G-15 +
    the policy-none case asserted; IN_TRANSIT stock visible but never
    sellable BR-016), stock counts DRAFT → COUNTED → VARIANCE_REVIEW →
    POSTED (frozen system-qty snapshot at creation, blind mode, audited
    recount, BR-015 value-impact tolerance with supervisor override, approval
    posts G-13 loss / G-14 gain), batches/expiry with FEFO issuing (BR-017)
    and expiry write-off as shrinkage, serial/IMEI registry with the original-
    unit return binding (BR-018), soft reservations + the availability
    service (on-hand − reserved − in-transit — the PHASE-011/012 seam), the
    nightly reorder job emitting `stock.below_reorder` email digests (alert,
    never autopilot), the INV-010/RC-04/RC-05 reconciliation check registered
    into the PHASE-007 framework (movement trail vs GL per resolved account
    with zero tolerance; drift → BROKEN + notification + PC-04 lock block +
    live close-checklist item), method-lock + dated-revaluation method switch
    (INV-017 — no in-flight movements, revaluation journal, history
    immutable), and manual reason-coded receipts/issues/adjustments. Migrations
    `0014_inventory_core.sql` + `0015_inventory_tracking.sql` ship 13 tables
    (all RLS'd, composite-FK'd, registry-isolated; `stock_moves` append-only
    by grants + `trg_stock_moves_guard` — even superuser DELETE refuses;
    the 0014 template correction realigns the viewer role with matrix §3.5).
    From PHASE-011 — the **purchasing module** (the procure-to-pay chain):
    purchase requests with approval routing + SoD, purchase orders DRAFT →
    PENDING_APPROVAL (BR-010 thresholds against the approval-policies
    substrate) → APPROVED → ISSUED → CLOSED with linked revisions and BR-029
    numbering, goods receipts receiving stock through the inventory
    `planReceipt`/`applyReceipt` seam (batch capture at receipt; purchasing
    never writes stock tables) and posting the GRNI accrual G-07 with the
    BR-012 PO-less policy, the three-way match BR-009 (tolerance matrix,
    per-line outcomes + dispositions in `match_result` recorded BEFORE
    approval, the service-level no-match-no-post guard,
    `purchasing.matching.override` risky), supplier invoices (BR-011 duplicate
    block/warn, BR-033 line snapshots, G-08 posting with exact per-line
    GRNI-clearing quanta + partial proportional clearing, VAT recoverability
    per pack + registration — RECOVERABLE/EXPENSED/NOT_SUBJECT), debit notes
    as G-09 mirror corrections, payments riding the PHASE-008 treasury service
    (`purchasing.payments.*` keys; G-10 + the W-2 FX mirror INV-008) with
    audited INSERT-only re-allocation documents (BR-027 on-account both
    directions, INV-016 bounds), the AP subledger tying to `AP_CONTROL`
    exactly (RC-02 randomized + RC-03 drift → BROKEN + PC-04 lock block),
    aging buckets + supplier statements as deterministic as-of recomputations
    (RC-10 byte-identical; document currency + base totals BR-028), opening-AP
    settlement (G-16 AP side; INV-009 from entry #1), the GRNI register RC-09
    registered into the PHASE-007 framework (live close-checklist item),
    landed-cost baseline allocation (VALUE/QTY, remaining-qty constraint,
    explicit COGS-adjustment posting via the new inventory revaluation seam),
    and supplier price-list consumption with BR-003 purchase-side provenance.
    Migrations `0016_purchasing_core.sql` + `0017_purchasing_ap.sql` ship 14
    tables (all RLS'd, composite-FK'd, registry-isolated; the re-allocation
    pair is INSERT-only by grants — the audit trail cannot be rewritten).
    From PHASE-012 — the **sales module** (the quote-to-cash chain — the
    revenue surface): quotations with BR-006 validity (enforced at send +
    accept + the expiry sweep; QOT- at SENT), sales orders DRAFT →
    PENDING_APPROVAL → APPROVED → ISSUED → CLOSED with optional line-level
    soft reservations against the PHASE-010 availability service (SOR- at
    ISSUE), delivery notes issuing stock through the inventory
    `planIssue`/`applyIssue` seam and posting the COGS journal G-03 WITHOUT
    AR (DEL-; converting to revenue-only invoices with the DN issue-cost
    snapshot copied onto the invoice lines — the W-3 provenance; BR-007
    both flows first-class), sales invoices cash + credit (G-01/G-02/G-03
    W-1 exact with per-line output-VAT legs, official SAL- numbering at
    posting INV-021, BR-005 cash-autopost with the POLICY_ACTOR sentinel,
    BR-001 credit limits as a CREDIT-kind control enforced server-side at
    approval with the no-TOCTOU re-verification at post — block/warn/allow
    × limit/overdue with the 8,200 + 2,500 > 10,000 math, override via
    `sales.credit_check.override` audited; BR-003 price resolution with the
    PRICE_CHANGED staleness gate; BR-033 snapshots refusing a rate mismatch
    at post), credit notes as G-04/W-3 mirror corrections (returns
    re-entering stock at the ORIGINAL issue cost — batch preserved, serial
    binds the sold unit BR-018; BR-004 window 14d/0 with the reference
    never disabling; §3.4 explicit allocation — the invoice stays
    gross-open, the note its own subledger row), receipts riding the
    PHASE-008 treasury service (G-05 settle + G-06 the W-2 FX residual ±10
    at the INV-008 stored rate; settlement + on-account control legs split
    explicitly BR-027) with INV-016 allocation bounds + CC-02 concurrency
    and audited INSERT-only re-allocation documents (SRA-; from→to,
    to-NULL on-account, `receipts.allocated_amount` re-synced), the AR
    aging buckets + customer statements as deterministic as-of
    recomputations (RC-10 byte-identical; BR-028 currency + base; the
    INV-009 footer tie) + `verifyInv009`, RC-01/RC-03 on the PHASE-007
    framework's AR kind (20 randomized ops OK; drift → BROKEN + PC-04
    lock block), opening-AR settlement (G-16 AR side; INV-009 from entry
    #1), the `invoice.overdue` job exactly-once (audit-stamp dedupe), and
    sales-rep attribution (commissions explicitly PHASE-017 — grep-clean).
    Migrations `0018_sales_core.sql` + `0019_sales_ar.sql` ship 14 tables
    (all RLS'd, composite-FK'd, registry-isolated; the re-allocation pair
    INSERT-only by grants; `stock_moves.source_type` widened with
    delivery_note/sales_invoice/credit_note + `cash_movements.source_type`
    gains sales_invoice for the G-02 counter payment; the §6 AR index
    `(tenant_id, customer_id, due_date)`). From PHASE-013 — the **reporting
    module** (the read-side truth surface, ADR-0011): the code-defined
    contract registry — 48 contracts, the REPORT_CATALOG §1–§7 phase-013
    set — boot-validated by zod (a malformed contract, an unknown
    permission, or a financial contract missing its §11 assertion set
    fails startup — meta-tested); the executor with the inline path
    (p50 budget) and the pg-boss job path (`reporting-report-run` queue)
    where permissions are re-resolved at execution — a revoked grant
    kills a queued run FORBIDDEN_AT_RUN with zero partial artifacts (no
    TOCTOU) — and runs are idempotent per `(tenant_id, report_key,
    params_hash)` (re-runs replace their own artifacts; the stored result
    envelope is the export source of truth — you print what you saw); the
    as-of-keyed cache (60s current-TTL cap) invalidated by ledger events
    (journal.posted/period.locked on the new accounting ledger-events bus
    wired into PostingService.post + PeriodService.lock); the assertion
    engine executing the FINANCIAL_REPORT_RULES §11 minimum set at
    exact-decimal tolerance 0 (FAIL is stored on the run AND blocks
    export/print server-side with ASSERTION_FAILED — the viewer renders
    the banner, the server refuses the artifact); the financial
    statements exact per the rules (TB one-side balances + zero
    suppression, GL running balance + the INV-006 entry drill +
    gl-entry-balance, IS contra aggregation via SALES_RETURNS/
    SALES_DISCOUNTS + the COGS section + the YTD column + is-tb-tie, BS
    with the RE composition counted once (bs-current-year-once) +
    prior-year comparative re-derived, CF indirect with cf-cash-tie
    INV-019 — untagged lines display as "أخرى/Other", the documented
    limitation), the fiscal close pack as an archive-class job,
    journal-register, and cost-centers — all consolidated by construction:
    journal lines carry no branch dimension in migrations 0001–0020, so
    financial contracts declare branches "fixed-all" (FINANCIAL_REPORT_
    RULES §1 branch subsets land with a branch-dimensioned journal
    substrate); the operational contracts over module query services —
    7 NEW application services (sales-analytics, ap-analytics,
    inventory-queries, treasury-queries, partner-queries, tax-queries,
    user-queries) powering AR/AP aging + statements + allocations (the
    INV-009 ties), salesAnalytics.* (item/customer/rep revenue,
    payment-method split, pipeline conversion, branch revenue +
    sales-gl-tie), apAnalytics.* (supplier/item spend, PO status,
    matching exceptions + purchasing-gl-tie), inventory queries (on
    hand/movement/expiry/count variance/transfer log/serials/slow-moving
    + the INV-010 tie), treasury queries (daily flow, receipts/payments
    registers, petty cash, expenses, shifts, bank recon + per-account
    INV-019 ties), the both-sides VAT return + summary-by-treatment
    (INV-012 tie via TaxQueriesService), and the platform reports
    (audit-trail with the new actorId/action filters on AuditQuery,
    user-activity, report-runs, subscription-usage); and the print/export
    system — `packages/ui/print` (entry `@erp/ui/print`, sanctioned in
    the erp-ui import-path rule): 4 versioned templates (a4-document
    with tafqit amount-in-words verified per locale and per currency
    minor-unit incl. 3-dp KWD/BHD/OMR/JOD/IQD + bilingual legal footers,
    a4-report with assertion footers + freshness stamps, receipt-80,
    receipt-58 with RTL rules — Western digits LTR-isolated, physical QR
    blocks, condensed 58mm) over embedded woff2 fonts (no system fonts,
    no network in render), the Chromium render service (playwright, pool
    bound 2 via Semaphore, 60s/300s timeouts, PDF/A-2b XMP
    identification stamping via pdf-lib — Chromium cannot emit
    conformance-level PDF/A; the stamp + artifact metadata record the
    archive class honestly), XLSX via exceljs (RTL sheet views,
    values-only, typed columns), CSV UTF-8 BOM RFC4180, and artifacts
    through the files module with sha256 + 15-minute signed URLs +
    audited export issuance. Migration `0020_reporting_core.sql` ships
    `report_runs` + `print_templates` (RLS'd, registry-isolated with
    generated A-test coverage). From PHASE-016 — the **`pos` + `sync` modules**
    (the shop front + its deliberately narrow offline slice, migration
    `0024_pos_core.sql`): the terminal registry (one row per branch counter bound
    to a till cash account + a device + a default warehouse + 80/58 mm receipt
    size; manual `pos-terminal` device enrollment — one terminal = one device;
    revocation rejects pushes `DEVICE_REVOKED` before any command executes), the
    POS shift flow over treasury shifts (opening float, per-denomination blind
    counts, supervisor PIN beyond tolerance, variance always posts BR-021), floor
    service (zones/tables/open checks with send/merge/transfer/split + printed
    kitchen tickets — an unpaid check holds NO ledger effect until it converts to
    a paid sale), receipts through the PHASE-013 print templates (receipt-80/58,
    AR/EN RTL-correct, the `OFF-` offline variant with the pending-sync notice),
    and the Z report + shift-end reconciliation screen (OFF-⇄official pairs, typed
    rejection actions). A POS sale IS a sales invoice: `PosSaleService` in
    `sales/application/pos-channel` posts `channel='POS'`, `kind=CASH` through the
    standard invoice chain with BR-005 cash autopost
    (`approved_by = policy:pos.cash_autopost`), split tenders G-02 (DR till cash +
    DR the tenant-mapped `CARD_RECEIVABLE` 1151 — fail-closed
    `PURPOSE_NOT_MAPPED` until mapped, per DR-016-02), server-side
    `POS-{branch}-{yyMM}-{seq:5}` numbering, returns as credit notes at original
    cost (G-04), and the POS-WALKIN walk-in partner. The narrow `sync` slice
    (SYNC_PROTOCOL §11 — binding) is the offline protocol's first real consumer:
    a catch-up `change_log` writer over the POS feed group
    (items/barcodes/uoms/price_list_items/partners/tax_codes), cursor pull with
    HMAC-signed opaque tokens, batch push ≤ 50 commands with per-item
    ACCEPTED/REJECTED/DEFERRED, and offline replay exactly-once (client UUIDv7 +
    idempotencyKey + the (terminal, OFF-) triple dedupe — INV-013; the chaos slice
    C-01/03/04/07/09/16 is green with the ledger oracle). From PHASE-017 — the
    **`distribution` module + the automotive/job-card and commission surfaces**
    (migration `0025_automotive_distribution.sql`, 15 new RLS'd tenant tables): the
    `distribution` module (routes + composition + idempotent visit planning and the
    visit board with check-in/complete/skip + the missed sweep — planning data that
    posts nothing; van stock as VAN-typed warehouses fed by ordinary TRN- transfers
    with the `van_stocks` read-model mirror refreshed inside the owning transaction
    and the conservation tie asserted; rep settlements STL- with expected-cash math
    (opening + cash sales + collections − refunds − expenses), the pending-documents
    gate, variance that ALWAYS posts (BR-021 family, reason required for any
    non-zero, beyond-tolerance ⇒ creator≠approver BR-034), the optional bank-deposit
    leg, the (rep, date) day-lock, and POSTED immutability; customer tiers driving
    the BR-003 price-resolution level (own list → tier list → base; quoted prices
    never overridden); the free-goods rule engine (buy-X-get-Y, per-tier,
    reason-coded zero-price FOC lines that still issue stock and post full COGS —
    BR-008, with 0018's net-positive CHECK re-issued for reason-coded lines));
    sales-owned job cards (the workshop work order DRAFT→IN_PROGRESS→COMPLETED→
    INVOICED + CANCELLED with the reserve/issue_immediate parts policy, LABOR lines
    billed at estimated-hours × per-hour rate, quotation-from-card through the real
    QuotationService, and the posting port: two revenue natures (SALES_REVENUE +
    SERVICE_REVENUE 4200) + per-line VAT, flow-B COGS under reserve, the
    `job_card:issue_parts` COGS journal at approval under issue_immediate — exactly
    one COGS journal per card — and warranty credit notes re-entering parts at the
    ORIGINAL issue cost W-3); the per-partner vehicle registry in `partners`
    (VIN-shape chassis tenant-unique where set, archive-only, service history as a
    read-only UNION over job cards/invoices/credit notes); and rep commissions
    (per-rep rules flat or tiered with INVOICED/COLLECTED basis, runs whose post is
    the single accrual journal DR COMMISSION_EXPENSE 5250 · CR COMMISSION_ACCRUAL
    2150 dated period_to, exclusion note-lines for basis mismatches, POSTED runs
    immutable). Both templates (`industry.automotive` + `industry.distribution`)
    seeded at v1.0.0 and applied through the UNMODIFIED PHASE-015 engine
    (CURRENT_SHIPPED_PHASE 17; the grocery tier entry flipped live; 7 new permission
    seeds — matrix 238 = seed union 0004+0024+0025 — and business/enterprise plan
    grants). The 7 PHASE-017 industry reports registered over the PHASE-013 contract
    (registry 56 → 63, tolerance-0 GL ties on job-card parts COGS, settlement
    variance/deposit, van conservation, and commission accruals). From PHASE-018 —
    the **`manufacturing` module** (migration `0026_manufacturing.sql`, 7 new RLS'd
    tenant tables + the QUARANTINED batch status, `warehouses.role` RAW\|WIP\|FG,
    `items.shelf_life_days`, and `item_batches.production_order_id` provenance):
    versioned BOMs (per-item version history with the partial-unique ACTIVE rule,
    yield % + per-component scrap %, DRAFT full-replace, activate-archives-previous)
    with the multi-level explosion service (`round6(qty × qty_per_output ×
    (1+scrap%) ÷ yield%)`, cycle detection, property-proven); production orders
    (DRAFT → RELEASED — `PRD-{YYYY}-{SEQ:5}` reserved+bound per-branch INV-021,
    the BOM version bound + level-1 explosion snapshotted as order lines — →
    IN_PROGRESS → COMPLETED / CANCELLED-before-consumption): consumption through
    the inventory issue seam at actual per-batch cost — one journal per call
    DR WIP 1160 · CR inventory, `over_plan` variance flag + inbox review notice at
    the policy threshold (never blocks); reason-coded scrap DR PRODUCTION_SCRAP
    5120 · CR WIP with the ≤ WIP-balance guard and no stock move; completion =
    the single journal DR FG inventory · CR WIP · [CR PRODUCTION_LABOR 5410 ·
    CR PRODUCTION_OVERHEAD 5420 when rates > 0 — absorption inside the completion
    journal], FG batch with expiry = completedAt + shelf_life_days and producing-order
    provenance, per-order WIP netting to EXACTLY zero, idempotent replay INV-013;
    QC inspections (PASS/FAIL + sampled, dispositions; the required gate
    quarantines the FG batch — FEFO/availability exclude it, explicit-batch issues
    typed-fail — PASS releases with no journal, FAIL+SCRAP posts the qc_scrap
    DR PRODUCTION_SCRAP · CR FG inventory and issues the quarantined stock);
    read-only batch genealogy (upstream material batches / downstream productions +
    sales edges over the provenance + consumption + move graph — recall trace,
    never writes); and the WIP reconciliation check (kind "WIP" INV-010: GL
    WIP-purpose balance vs Σ per-order WIP, seeded drift → BROKEN + inbox, wired
    into PC-04 lock blocks + the close checklist + `POST /reconciliation/wip-check`).
    `industry.food_manufacturing` seeded at v1.0.0 and applied through the UNMODIFIED
    PHASE-015 engine (CURRENT_SHIPPED_PHASE 18; restaurant → food_manufacturing
    additive switch safety BR-038 proven; 8 new permission keys — approve/post RISKY,
    matrix 241 = seed union — and business/enterprise plan grants for the seven
    `manufacturing.*` feature keys). The 3 PHASE-018 industry reports registered over
    the PHASE-013 contract (registry 63 → 66, `manufacturing.production_cost` with
    the tolerance-0 materials↔GL tie, `manufacturing.batch_genealogy`,
    `manufacturing.qc_inspection_log`). From PHASE-023 — the **external-integration
    substrate** (migration `0035_external_integrations.sql`, schema_version 35; the
    9-table cluster — the OPERATIONAL `e_invoicing_submissions` expansion,
    certificates, certificate usage, adapter settings, parked lines, the format
    registry, commerce orders/imports, billing payouts; all RLS'd +
    registry-isolated): `tax/submissions` — the adapter-neutral state machine
    (illegal transitions rejected in code; ONE LIVE row per document × adapter — the
    no-double-clearance partial unique), the registry service, the
    NON_AUTHORITATIVE compliance-archive payload builder (jurisdiction-pack labels +
    the INV-012 summary — zero wire-format knowledge), the pg-boss
    `einvoicing.sign|submit|poll|reconcile` jobs (expo-capped retries + the
    `einvoice.submission.failed` dead-letter alert; degrade-the-feature-never-the-
    platform), and funnel monitoring + `EInvoiceRejectSpike` (>5%/15 min, Sev-2);
    `tax/certs` — the S-10 path-only certificate registry with approval-separated
    audited enroll/rotate, signing-job-only key access (no API surface reads key
    material — asserted), the per-operation usage audit, the `CertExpiry` 30/14/7
    ladder (each threshold exactly once via `expires_alerted_at`), and the
    offboarding purge; `tax/adapters/zatca` — the UNVERIFIED refuse-to-submit stub
    (the verification gate is honestly NOT_VERIFIED — no external access, nothing
    fabricated; every refusal names the unmet GATE-1..GATE-4 items; DR-001 OPEN,
    option C recommended); `tax/rollout` — the per-tenant adapter flags default OFF
    with the enablement gate = a provisioned ACTIVE certificate + the jurisdiction
    pack (never the platform feature_flags table); `treasury/parsers` — the
    csv-debit-credit + csv-with-balances format families with parking (raw cells
    verbatim, amounts NEVER guessed, balance drift advisory-only) + the seeded
    `bank_statement_formats` registry + the parked-lines list/resolve/discard
    endpoints; `sales/adapters/commerce` — the CommerceChannelPort +
    FakeCommerceChannel + the import service (natural-key upsert per tenant+channel+
    channel order id, Idempotency-Key batches that replay the recorded outcome,
    financial drift ⇒ CONFLICT for explicit human resolution — never LWW;
    ShippingPort reserved with a fake) behind the NEW `sales.commerce.manage`
    (matrix 243→244, drift-green); `tenancy/application/billing`
    refund-payout-service — `refund()` on the sandbox provider port
    (`payment.refunded` events; the invoice stays PAID, history append-only) +
    `refundSettledPayment` + `syncPayouts`/`reconcilePayouts`/`listPayouts` + the
    `runPayoutReconciliation` job (provider-reported gross/fee/net vs settled
    payments in the window — RECONCILED or DRIFT with detail, never auto-corrected;
    DR-002 OPEN — no production cutover claim); and `tests/authorities` — the
    fake-zatca + fake-eta harnesses (in-process authority simulators driving the
    REAL registry + jobs through the submit/accept/reject/timeout/retry/DLQ
    scenario matrix; port-shaped only, zero wire-format knowledge).
  - `apps/web` — Next.js BFF (PHASE-003 substrate, contracts frozen) with all
    18 screens migrated onto @erp/ui (PHASE-005) + the PHASE-006 master-data
    screens + the PHASE-007 accounting group (8 screens: CoA editor + purpose
    mapping, journal list/detail/workspace on the JournalEntryGrid archetype-4
    pattern with live MoneySummaryBar Δ, GL browser with INV-006 drill-down,
    period management + close checklist + reconciliation + year-end, approvals
    queue on the ApprovalsQueue pattern, exchange-rate editor, opening-balances
    post step) + the PHASE-008 treasury group (12 routes: accounts list +
    detail with movements drill-down, receipts/payments list + create + detail
    with the allocation editor (INV-016 panel, FIFO suggest, live allocated /
    remainder bar in exact string math), expenses with category management,
    transfers with inline create + lifecycle, shifts with the ShiftPanel
    capture/close console, bank-rec import wizard → match grid → unmatched
    aging → reconcile lock) + the PHASE-009 tax group (4 routes: settings
    tax-codes manager with the resolve-lines preview, registrations manager,
    pack viewer with versions/preview/apply, and the reports VAT-return
    workspace with the INV-012 cross-check side-by-side + export +
    mark-filed) + the PHASE-010 inventory group (5 routes: the warehouses
    manager on the Settings archetype with create + deactivate/reactivate,
    stock on hand with the warehouse filter + BR-016 availability drill
    (on-hand − reserved − in-transit), the movement ledger with
    direction/kind/warehouse filters + batch/serial columns, the transfer
    wizard (multi-line create → dispatch → in-transit badge → receive —
    the G-15 two-leg flow), and the count workspace — Journey D end-to-end:
    session create with item picking + blind mode, the frozen-snapshot
    sheet, line entry, variance review with per-line diff + value impact,
    audited recount, and plain/supervisor approval posting G-13/G-14) + the
    PHASE-011 purchasing group (5 routes: the orders workspace with the
    PR→PO flow + threshold/revision awareness, receipts with GRN create/post
    + the PO-less reason flow + landed-cost create/post with allocation
    preview, supplier invoices with the match-result panel — per-line
    PO/GRN/invoice triple with variance highlighting + dispositions + the
    duplicate-warning banner, debit notes referencing posted invoices, and
    the AP views — aging buckets, supplier statement with the INV-009
    footer badge + document currency + base totals, and the GRNI register —
    all as-of deterministic) + the PHASE-012 sales group (5 routes: the
    quotes+orders workspace — BR-006 validity + conversion chain +
    soft-reservation awareness, deliveries with the two-flow posting +
    convert-to-invoice, invoices with the live credit-check decision panel
    (BR-001 math + escalation postures) + tax preview, credit notes with
    the return-window + re-entry-at-original-cost presentation, and the AR
    views — aging buckets, customer statement with the INV-009 footer tie,
    open items + re-allocation workspace; the receipts money leg rides the
    treasury group's existing surface; print honestly marked "arriving
    with the PHASE-013 reporting release" — the promise the PHASE-013
    print system now honors) + the PHASE-013 reports workspace (the
    `/reports` route on the report archetype: the catalog grouped by
    category filtered to the session's permissions, the declarative
    parameter bar (date window / as-of / report locale), saved views as
    client-side parameter sets — no new tables per the phase constraint,
    run + polling with the live stage line, the ReportViewer with group
    tree / check totals / assertion footer / freshness / drill links,
    the export menu, the print-preview iframe, and run history) + the
    PHASE-016 POS group (the `/[locale]/pos` counter sale — terminal selector,
    shift open/close with denomination grids, scan input, item grid, cart,
    tender dialog with split + change, receipt iframe print, returns, and the
    offline outbox in localStorage with `OFF-` numbering + honest
    `PENDING_SYNC` + auto-drain + typed rejection triage per DR-016-01;
    `/pos/floor`; `/pos/reconciliation` — Z report + OFF-⇄official pairs +
    rejection actions; `/pos/terminals` — admin registry + device enrollment) + the
    PHASE-017 industry group (the seven 017 surfaces over the new modules: `/job-cards`
    — the workshop workspace (diagnosis → quotation → approve → hours → complete →
    invoice → warranty note, both parts-issue policies surfaced); `/vehicles` — the
    registry + per-vehicle service history timeline; `/distribution/routes` — routes,
    composition + visit board; `/distribution/van` — van balances + load-out/unload;
    `/distribution/settlements` — open/count/approve/post with variance escalation;
    `/distribution/tiers` — tiers + free-goods rule editors; `/sales/commissions` —
    rules + runs with the accrual statement) + the PHASE-018 manufacturing group
    (the four surfaces over the new module: `/manufacturing/boms` — the version
    registry + lines editor + multi-level explosion preview; `/manufacturing/orders` —
    the order workspace with the lifecycle bar, consume dialog seeded from the planned
    components with per-component batch pickers, scrap + complete dialogs, the
    `over_plan` warning chip, and the completion summary; `/manufacturing/qc` — the
    inspections console with the target/result/disposition matrix and quarantine-
    release notices; `/manufacturing/genealogy` — the recall search with upstream /
    downstream / batch-summary walks) on the template-derived navigation +
    terminology (الوصفة / أمر الإنتاج / بوابة فحص الجودة / شجرة الدفعات),
    i18n parity 2556/2556 +
    the nav item `reports.workspace`: session cookie +
    CSRF double-submit, generic proxy; login/register/forgot/accept on the
    public card shell; admin/console lists on DataTable archetypes with the
    navigation-driven app shell; CSP middleware (per-request nonce, §8 header
    set, probe-tested against the built app); typed dictionaries at 2556 keys
    with triple parity enforcement (TS + runtime + CI script).
  - `apps/desktop` — **`@erp/desktop` (PHASE-021, the Tauri v2 shell runtime)**: ALL
    application logic in TypeScript (`src/**` — the dual-profile SQLite store with
    desktop migrations v4/v5 continuing the shared local `schema_migrations`
    numbering + byte-exact 1 GB pruning + the §6.4 corruption drill,
    enrollment/keychain/session/unlock with the D-04 7-day watermark, the sync host
    + §8 triggers over UNMODIFIED sync-core + D-01 revocation purge, the real
    minisign updater client + staged-rollout gates, the WebView2 probe, crash
    telemetry, 80/58 mm bilingual ESC-POS + reprint-from-cache, the fail-closed
    bridge contract incl. the DR-P21-09 `sync` member) + the thin Rust shell
    (`src-tauri/**`, source-only — the Windows CI workflow compiles + signs it;
    `pnpm check:desktop-shell` validates the structural invariants). 16 files /
    274 tests green on real temp-dir SQLite + real Ed25519. Dev loop:
    [../operations/DESKTOP_QUICKSTART.md](../operations/DESKTOP_QUICKSTART.md).
  - `apps/mobile` — **`@erp/mobile` (PHASE-022, the Expo/RN Android runtime)**: ALL
    application logic in TypeScript (`src/**` — the golden-constants leaf, the two-layer
    design-token mirror behind `check:mobile-tokens` 130/130+50/50, the AR-first i18n
    runtime behind `check:mobile-i18n` ar=en=371 with the logical-props-only RTL
    discipline (the DR-P22-03 ESLint ban), auth/session/unlock/trust/watermark
    (DR-P22-09: the SecureStore vault, memory-only access tokens, rotation-reuse wipe,
    biometric-optional + PIN, FLAG_SECURE, the 7-day watermark), the dual-profile SQLite
    store (field migrations v4+ + the 128 MB byte-exact LRU prune + the proven §6.4
    corruption drill; **DR-P22-08b** personal = cursors+meta+read models only, no
    outbox/inbox), the sync host + triggers + revocation over UNMODIFIED sync-core with
    the 8 MB/2 MB/256 KB budget guards and the ≤ 15-min background schedule, the
    field-sales flow state machines with LOCAL-VALID† pre-validation, the companion +
    personal view models, the FULL CONFLICT_RESOLUTION §3 rejection UX, the FCM client
    wiring, the release policy + rollout gates) + the RN screens (11 registered,
    tree-rendered AR/EN with a11y + ≥ 44 px targets through the vitest Flow bridge) +
    the thin Expo glue (`native/**` + eas.json + app.config.ts + metro.config.js,
    source-only — the EAS CI workflow compiles it; `pnpm check:mobile-shell` gates the
    structure). 27 files / 393 tests green on Node. Dev loop:
    [../operations/MOBILE_QUICKSTART.md](../operations/MOBILE_QUICKSTART.md).
  - `packages/ui` — **@erp/ui v1.0.0 (PHASE-005, ADR-0016)**: token layer
    byte-verbatim to DESIGN_TOKENS (contrast gate §16 in CI), Radix primitive
    wrappers (the only legal Radix site), catalog components (DataTable
    virtualized to 10k rows, MoneyInput §6.2, Hijri-capable date pickers §6.3,
    DocumentStatusBadge §6.4 + DocumentActions), the app shell with
    server-resolved entitlement-driven navigation (GET /tenancy/navigation;
    binding 10-group registry in @erp/contracts), AR+EN Storybook→Playwright
    visual harness (threshold 0, axe-in-harness 0 violations, geometry
    invariants, both-directions coverage check, quarantine mechanism) + the
    PHASE-008 `ShiftPanel` pattern (headless cashier console — capture/close
    callbacks, EXPECTED = opening+in−out via the shared `exact-decimal`
    helpers, supervisor id+PIN fields for BR-021 variance, CLOSED read-only
    summary, 4 bilingual stories with AR+EN baselines), the
    four erp-ui lint rules with negative proofs, and the four changeset-semver
    surface. From PHASE-013 the package also exposes the print surface
    `packages/ui/print` (entry `@erp/ui/print`, the second sanctioned
    entry — the erp-ui import-path rule allows the exact entry and bans
    deeper paths): the 4 versioned print templates (a4-document / a4-report
    / receipt-80 / receipt-58), the print CSS, and the embedded woff2
    fonts. Evidence: reports/PHASE-005-COMPLETION.md.
  - `packages/domain-core` — UUIDv7, `Money`/`Quantity`/`Rate` (ADR-0009 decimal
    semantics, half-up rounding, 3-decimal currencies), `Result`, domain errors,
    `CalendarDate`; 38 unit/property tests green.
  - `packages/contracts` — zod registry v0 (empty), error-code enum seed, wire-format
    schemas per API_CONVENTIONS §7; 11 tests green. From PHASE-016 it also carries
    the sync wire schemas (`pos_sale`, `cashier_shift`, the pull envelope, push
    per-item results, and the rejection-reason registry mapped to
    CONFLICT_RESOLUTION §3 actions).
  - `packages/sync-core` — **@erp/sync-core (PHASE-016, NEW)**: the device-side sync
    library for the POS subset (LOCAL_DATABASE §1.1) — the storage-adapter contract
    (the web terminal's localStorage bridge per DR-016-01 and, from PHASE-021, the
    encrypted SQLite store implement the same seam), versioned local migrations
    (outbox/inbox-mirror/cursors/meta + the mirrored read caches), the outbox engine
    (QUEUED → IN_FLIGHT → ACKED/REJECTED with crash recovery — WAL roll-forward,
    IN_FLIGHT → QUEUED), the SyncClient + command builders, and the seeded-RNG
    chaos-test harness (the C-01/03/04/07/09/16 slice runs against it).
  - `packages/config` — shared strict tsconfig bases, ESLint config with
    module-boundary enforcement (proven by the negative meta-test), Prettier.
  - Tooling: pnpm workspaces + Turborepo, ESLint boundaries + custom money/RTL rules,
    `dependency-cruiser` graph rules (web→api violation caught in verification),
    Docker Compose dev stack (postgres:16/minio/mailpit/api/web), GitHub Actions CI
    (typecheck/lint/unit/build/docs-validation/gitleaks/e2e-stub/negative-boundary-test
    + the new ci-db.yml Testcontainers job), CODEOWNERS stub, `.env.example`.
  - Migrations `0001_core_infra.sql` … `0005_system_role_templates_seed.sql`
    (drizzle-kit journal `NNNN_description.sql` convention): PHASE-002 substrate
    plus the PHASE-003 identity cluster — 9 tables, variant command-specific RLS
    for roles/role_permissions, `template_seed` path, NOLOGIN BYPASSRLS role
    `erp_definer` owning the pre-GUC definer projections, 199-key permission seed
    (drift-checked against AUTHORIZATION_MATRIX in the gate) + 9 role templates
    with 413 grants. `tenants` grew its full profile in PHASE-004 (below).
  - PHASE-004 provisioning cluster — migrations `0006_tenancy_provisioning.sql`
    (currencies/countries seeded reference tables, tenants profile expansion +
    status swap incl. OFFBOARDED, audit_events platform widening: nullable
    tenant_id + via_platform_admin + platform-read policy, branches,
    tenant_settings, plans (platform RLS + seed path), subscriptions, entitlements,
    support_sessions, `erp.tenant_active_entitlements` definer projection,
    `erp.seed_platform_tenant()` ops-tenant bootstrap), `0007_accounts_schema.sql`
    (accounts + account_purposes, composite FKs, created early for CoA
    instantiation), `0008_platform_seeds.sql` (PLACEHOLDER plans starter/business/
    enterprise incl. closure-completion keys, 13 industry templates, the 42-row
    bilingual CoA template with 16 purpose markers).
  - PHASE-004 modules: `configuration` (feature-catalog mirror + BR-040 closure
    validator, settings-schema registry with zod schemas, in-process §9 event bus
    + config cache) and `tenancy` (registration, onboarding provisionWorkspace,
    branches + branch-scope enforcement, entitlements service + RequireFeature
    guard, typed settings service, lifecycle suspend/restore with session kill,
    support access §7, platform console with per-use platform audit). The
    platform plane = `@PlatformScope()` routes over the seeded operations tenant
    (platform_admin role from the template; first staff user bootstrapped by ops).
  - Prior migrations `0001_core_infra.sql` + `0002_rls_macro.sql` (drizzle-kit journal
    `NNNN_description.sql` convention): roles `erp_migrate`/`erp_app`/`erp_readonly`
    (no passwords in SQL — dev credentials via `scripts/db-dev-credentials.ts`),
    `erp.current_tenant_id()` GUC helper, minimal `tenants`, append-only
    `audit_events` (grants + `erp.audit_events_guard()`), RLS ENABLE+FORCE with
    `tenant_isolation` policies, `erp.apply_tenant_policy()` macro,
    `erp._schema_state` mirror, `boss` schema (owned by `erp_app`).
  - Completion flip (2026-10-28): the CI-green and `docker compose up` healthcheck
    evidence items are waived to first infrastructure availability by project-owner
    directive — the CI-equivalent local gate (`pnpm gate:local`) is green and is the
    recorded substitute; follow-ups tracked in the phase report §Deferred evidence.
- **Git:** initialized on `main` during PHASE-001 (the pre-implementation state was a
  plain directory — see the phase report's doc-reality reconciliation); baseline
  committed and tagged `blueprint/v1.1`; PHASE-001 implementation committed and tagged
  `phase/001`; blueprint v2.0 expansion committed on top; `phase/006` tagged 2026-10-29;
  `phase/007` tagged 2026-10-30; `phase/008` tagged 2026-10-30; `phase/009` tagged
  2026-10-30; `phase/010` tagged 2026-10-30; `phase/011` tagged 2026-10-30;
  `phase/012` tagged 2026-10-31; `phase/013` tagged 2026-11-01.

## Status of the world (honest statement per directive §24)

- **Designed:** everything in `docs/` — this is the blueprint, not a claim of working
  software.
- **Implemented:** PHASE-001 engineering foundation + PHASE-002 database &
  migration infrastructure + PHASE-003 identity/tenancy/audit core + PHASE-004
  provisioning + PHASE-005 design system + PHASE-006 master data + PHASE-007
  accounting core & posting engine + PHASE-008 treasury + PHASE-009 tax
  engine & jurisdiction packs + PHASE-010 inventory & warehousing +
  PHASE-011 purchasing & payables + PHASE-012 sales & receivables +
  PHASE-013 reporting, statements & printing + PHASE-014 subscriptions,
  billing, onboarding & dashboards + PHASE-015 industry configuration
  framework & priority templates + PHASE-016 Point of Sale + PHASE-017 Automotive &
  Distribution Templates + PHASE-018 Manufacturing & Production + PHASE-019 CRM,
  Service Contracts & Projects + PHASE-020 Offline Synchronization Foundation +
  PHASE-021 Desktop Application + PHASE-022 Android Application + PHASE-023
  External Integrations & E-Invoicing (the operational substrate — registry,
  certificates, rollout, monitoring; the ZATCA adapter honestly UNVERIFIED) +
  PHASE-024 Security Hardening & Compliance Review (MFA policy, the offboarding
  purge, rate limiting, the findings log) + PHASE-025 Performance, Reliability
  & GA Readiness (the GA release — 10× local load evidence T-01…T-08 ALL PASS,
  DR drills executed, SLOs/error budgets live, the GA checklist closed)
  + PHASE-026 Fixed Assets & Depreciation + PHASE-027 Cheques, Promissory
  Notes & Installments + PHASE-028 Budgeting & Variance Control (the
  planning layer over the ledger — versioned budgets with BR-050/BR-051,
  the read-only variance engine, and the negative ledger proof that budgets
  never write a journal) + PHASE-029 Payroll: Salaries, Loans &
  End-of-Service (financial scope per DR-005 — the PII-restricted employee
  financial file with audit-on-read, BR-052 structure versioning, G-29/G-30/
  G-31 through the engine, INV-025 self-proving run totals, employee loans
  under the BR-054 cap, tenant-policy EOS per BR-055 with no fabricated
  jurisdiction rates, and the report registry 78→81) + PHASE-030 Wholesale
  & Electronics Templates (the first two Blueprint v2.0 industry templates
  as configuration over existing modules — data-only migration 0041: zero
  new tables, columns, journals, permission keys, or web code; the nine
  typed policy keys; the negative ledger proof that template apply/switch
  writes zero journal rows) + PHASE-031 Healthcare Commercial Shell (ED-07,
  the register's "configuration + light extension" pattern: the single
  additive `sales_invoices.claim_ref` column by migration 0042 + the
  `industry.healthcare` v1.0.0 seed by the data-only migration 0043; the
  policy-gated claim-ref capture with the typed CLAIM_REF_REQUIRED
  rejection; the `(partner, claim_ref)` claim-slice read model
  partitioning the AR open items (INV-009); the group_by_claim parameter
  on the existing notes.aging / notes.maturity-calendar /
  partner.statement contracts (register §J stays closed); the
  claim-lifecycle end-to-end suite line-asserting G-01/G-03/G-24/G-25/G-26
  incl. the FEFO dispensing pick and the G-26 dishonor restoring the claim
  exactly; the zero-clinical-surface CI gate — no clinical field, key, or
  screen exists anywhere in the shell)
  (migrations 0001–0043 — schema_version 43; CURRENT_SHIPPED_PHASE
  PHASE-031; 10 shipped industry templates; report registry 81 contracts;
  permissions 245=245; web i18n 4,069=4,069; the centralized posting engine with the full
  invariant suite is live and proven by its consumers — treasury posts every
  money movement through it, tax stamps every tax-carrying line with frozen
  rate snapshots BR-033, inventory posts every stock movement through it
  atomically with its journal effect INV-018, purchasing posts the full P2P
  chain through it — GRNI accrual G-07, supplier-invoice clear + AP open
  G-08, debit notes G-09, payments G-10 with the FX mirror — and sales
  posts the full O2C chain through it — credit AR G-01, cash G-02, COGS
  G-03 both flows, credit-note mirror + original-cost re-entry G-04,
  receipt settle G-05 with the W-2 FX mirror; the AP and AR subledgers tie
  to their controls exactly (RC-01/02/03, INV-009 from entry #1 incl.
  opening balances on both sides) and the GRNI register reconciles at
  every step (RC-09) — drift blocks the period lock PC-04; the three-way
  match BR-009 records outcomes before approval and no posting path
  bypasses it; credit limits BR-001 enforce server-side at approval in all
  three postures with audited overrides; landed costs revalue stock
  through the sanctioned inventory seam with the remaining-qty
  constraint; and the reporting engine consumes it all read-only — every
  statement runs its FINANCIAL_REPORT_RULES §11 assertions at
  exact-decimal tolerance 0 with a FAIL blocking exports server-side,
  as-of re-runs are byte-identical (idempotent per (tenant_id, report_key,
  params_hash)), and print/export artifacts are sha256-stamped, signed
  (15-minute URLs), and audited). The MVP arc is CLOSED (PHASE-014, 2026-11-01):
  the commercialization layer is live — plans seeded with PLACEHOLDER prices
  (OQ-002), sandbox checkout AND the manual-invoicing fallback produce identical
  entitlement/billing outcomes (A-009), the trial → active → read-only grace →
  suspended lifecycle wires the PHASE-004 semantics with every transition audited,
  usage counters soft-warn at 80%/100% and hard-block only creation actions
  (documents/month never blocks posting — INV-022 property-proven), the
  onboarding wizard walks Journey A to a POSTED first invoice over the real
  controllers, the owner dashboard renders 4 report-contract-bound KPI tiles
  (links, never parallel math), and the billing-critical notifications center
  delivers; the MVP security review is recorded (MVP_SECURITY_REVIEW.md — zero
  open blockers; pen-test stays PHASE-024), the NFR-006 load budgets hold (T-01
  33 ms / T-02 10 ms / T-04 14 ms / T-06 156 ms AR + 160 ms EN / T-07 0.000%),
  and the first backup-restore rehearsal PASSED (runbook §8). Release tag
  `release/v1.0.0`.
  PHASE-015 (2026-11-02) closes the configuration arc on top of the MVP: the
  ten-layer `resolveEffectiveConfig` engine is live in the `configuration`
  module (typed-key schema validation, BR-040 dependency closure, content-hash
  tenant-static cache + §9 event invalidation, L6 request overlay, L9
  navigation/terminology derivation — fail-closed, never partially-defaulted);
  the `industry_templates` registry is engine-owned with the three priority
  manifests seeded at v1.0.0 (`industry.retail`, `industry.grocery`,
  `industry.restaurant`); apply/switch/extend are idempotent + audited with
  additive-only BR-038 semantics (no-writes preview diff, read-only archives,
  append-only numbering, switch-back always possible; registry drift records
  bilingual upgrade OFFERS — never auto-applies); the terminology/navigation
  runtime prunes by entitlements/flags/permissions with POS entries
  phase-gated "coming with PHASE-016" (back-office mode live); and the
  PHASE-015 supporting surface ships with it — composite products (explosion
  at sale posting), the reservation pool + expiry sweep, BR-019 alert-only
  reorder digests in-app, the landed-costs full workflow, three industry
  reports over the PHASE-013 contract (`inventory.expiry_list`,
  `grocery.expiry_writeoff`, `retail.imei_register` — each with its ledger
  tie), and the generalized in-app notification categories (`stock`,
  `templates`); three new permission keys (`industry.templates.manage`,
  `industry.templates.switch` — risky, `industry.terminology.manage`) keep the
  matrix at 227=227 drift-green, and manifest schema validation runs in CI
  (`pnpm validate:manifests`).
  PHASE-016 (2026-11-02) adds the shop front on the same core: the `pos` module
  (terminal registry, POS shifts with per-denomination blind counts, ledger-free
  floor service + kitchen tickets, 80/58 mm AR/EN receipts, the Z report), the POS
  channel through the sales invoice chain (split tenders with `CARD_RECEIVABLE`,
  server-side `POS-` numbering, exactly-once offline replay with `OFF-` ⇄ official
  1:1 reconciliation, typed rejections, returns as credit notes at original cost),
  the narrow `sync` slice + the `@erp/sync-core` package (outbox engine, seeded-RNG
  chaos harness — the blocking slice C-01/03/04/07/09/16 green), three report
  contracts (`pos.sales_by_terminal` + `pos.sales_by_hour` with the pos-gl-tie
  assertion, and `treasury.shift_cash_reconciliation`), and the three
  §11 deviation records (DR-016-01/02/03); the three priority templates' POS
  entries flipped live with four new `pos.*` permission keys (matrix 231 = the seed
  union 0004+0024).
  PHASE-017 (2026-11-02) lands the two harder industry templates with the modules
  they require, on the same financial core: the `distribution` module (planning-only
  routes/visits that post nothing; VAN-warehouse van stock via ordinary transfers with
  the `van_stocks` mirror + conservation tie; STL- rep settlements whose variance
  ALWAYS posts approval-gated never netted, with the (rep, date) day-lock and POSTED
  immutability; BR-003 customer tiers + the reason-coded BR-008 free-goods engine),
  sales-owned job cards (parts + labor with two revenue natures — SALES_REVENUE and
  SERVICE_REVENUE 4200 — reserve vs issue-immediate parts policies with exactly one
  COGS journal per card either way, warranty credit notes at original cost W-3), the
  partners-owned vehicle registry with per-vehicle service history, and rep
  commissions (flat/tiered rules, INVOICED/COLLECTED bases, the single accrual journal
  DR 5250 · CR 2150 at run post — never touching invoices or VAT); `industry.automotive`
  + `industry.distribution` seeded at v1.0.0 and applied through the UNMODIFIED
  PHASE-015 engine (CURRENT_SHIPPED_PHASE 17 — grocery's tier entry flipped live),
  the 7 industry reports over the PHASE-013 contract with tolerance-0 GL ties
  (registry 63), the seven web surfaces (job-cards workspace, vehicles, routes/visit
  board, van balances, settlements console, tiers/free-goods editors, commissions)
  with i18n parity 2348/2348, and the docs set authored in-phase (TABLES + ERD cluster
  specs, ENTITY_CATALOG distribution-ownership reconciliation, POSTING_ENGINE §4 rows,
  catalog flips); 7 new permission keys keep the matrix at 238 = the seed union
  0004+0024+0025 drift-green.
  PHASE-018 (2026-11-03) ships Manufacturing & Production on the same financial core:
  versioned BOMs with yield/scrap math and the multi-level explosion (cycle-safe,
  property-proven), production orders whose release binds the BOM version + PRD number
  and snapshots the level-1 plan, consumption through the inventory issue seam at
  actual per-batch cost into WIP (variance beyond the threshold flags a review —
  never blocks), reason-coded scrap, and completion as the single absorption journal
  (materials + labor + overhead rates) receiving the FG batch at computed cost with
  shelf-life expiry — per-order WIP nets to exactly zero, proven by the two-level
  golden chain (dough → bread: J1 8875.0000 / J2 scrap 443.7500 / J3 8431.2500 /
  J4 8554.6875 / J5 9117.1875 with labor 375.0000 + overhead 187.5000, bread unit cost
  12.156250); the QC gate quarantines the FG batch until inspection (PASS releases
  with no journal; FAIL+SCRAP posts DR PRODUCTION_SCRAP · CR FG inventory and issues
  the batch); read-only batch genealogy answers the recall question both directions;
  and the WIP reconciliation check (INV-010) is live in the health center with seeded-
  drift detection; `industry.food_manufacturing` seeded at v1.0.0 and applied through
  the UNMODIFIED PHASE-015 engine (CURRENT_SHIPPED_PHASE 18 — restaurant switch
  safety proven BR-038), the 3 industry reports over the PHASE-013 contract
  (registry 66; `manufacturing.production_cost` tolerance-0 GL-tied), the four web
  surfaces (boms / orders / qc / genealogy) with i18n parity 2556/2556, and the docs
  set authored in-phase (TABLES + ERD cluster specs, ENTITY_CATALOG manufacturing
  section, POSTING_ENGINE §4 production rows incl. qc_scrap, CHART_OF_ACCOUNTS labor/
  overhead purposes, FEATURE_CATALOG permission reconciliation, catalog flips);
  8 new permission keys bring the matrix to 241 = the seed union drift-green.
  PHASE-020 (2026-11-04) generalizes the PHASE-016 POS slice into the platform-wide
  offline synchronization foundation: the `sync` module (migrations 0029–0031;
  schema_version 31) owns the device registry (`devices` widened with device_class /
  contract_version / attestation substrate / trust_flags / pull-push watermarks /
  data_expires_at; refresh rotation as one-time-use chained tokens with the
  used_at reuse tripwire → revoke + alarm, HS256 JWT access tokens, PUBLIC
  /devices/:id/refresh deriving the tenant from the device user's ACTIVE membership),
  the change feeds (4 device-class feed groups; the 9-entity catch-up writer +
  per-command feed entries inside the owning transaction; the `permissions` snapshot
  feed with the 6d refresh + 7d read-only watermark), pull v2 (opaque signed
  cursors over contiguous seq windows, 2 MB/500-row page caps, C-12 resync
  directive, tombstone transport for soft-deleted master data), push v2 (ONE
  handler registry over owning-module services only — pos_sale/cashier_shift
  byte-identical to 016, partner contact-merge FIELD_LEVEL_MERGE with the
  constrained-fields guard, draft invoices OWNER_DEVICE_WINS + STALE_VERSION,
  ONLINE_ONLY → FORBIDDEN resubmittable:false; inbox dedupe with `duplicate:true`
  replay incl. the within-batch refinement, per-device rate limit → DEFERRED
  never-executed-never-recorded, 1 MB batch byte cap), four maintenance jobs
  (inbox retention 30d, tombstone GC weekly, cursor lag audit daily, feed-health
  probe 5-min), the reconciliation queue (revoked-device pending ops + drafts
  reassign), and the admin health aggregate (p95, outbox.lag buckets,
  device.revoked.pending_ops, alerts) with three platform web screens (devices,
  sync health, sync reconciliation; NAV_ITEMS permission-gated; i18n 3044).
  `packages/sync-core` v1 ships the reference client engine (runCycle with
  recovery → contract gate → permissions-first pull → drain → FIFO push, full-jitter
  retry, crash recovery + quarantine + cursor-reset re-bootstrap, row-budget LRU
  pruning, LOCAL_MIGRATIONS v2). Contract version `2026-11-04.1` with the
  `2026-10-27.1` grace window — a PHASE-016 terminal syncs unchanged (rule 3,
  interop proven by the chaos suite's legacy legs). The FULL chaos matrix
  C-01…C-16 + duplicates + D-series device security + Y-series isolation are
  live in `apps/api/src/__db__/sync/` (9 files / 74 tests green, ledger oracle
  after every scenario, ~12 s whole-dir wall vs the 15-min budget; sync-core
  36/36); the chaos suites found and fixed three production bugs in-phase
  (BR-003 price gate missing on the POS autopost path, ITEM_INACTIVE vocabulary
  for soft-deleted master data, the 1 MB push byte cap). Byte-exact LRU budgets
  and the k6 sync-fleet run are honestly deferred to 021/025.
  PHASE-021 (2026-11-04) ships the Windows-first desktop application as the Tauri v2
  shell around the web ERP static export (ADR-0013): `apps/desktop` = the `@erp/desktop`
  TypeScript runtime — the dual-profile SQLite store (DR-P21-02: cipher profile on the
  Windows CI `--features sqlcipher` build, fail-closed `SqlCipherUnavailableError` on
  the stock build, the recorded standard-profile fallback keeping every other
  key-management invariant + the secret-scan) with desktop migrations v4/v5 continuing
  the shared local `schema_migrations` numbering, byte-exact 1 GB `dbstat` pruning
  (DR-P21-03 — the 020 deferral closed), and the proven §6.4 corruption drill; the
  sync host over UNMODIFIED sync-core with the full §8 trigger table and the D-01
  revocation purge; the real minisign/Ed25519 updater client with staged rollout
  10%→50%→100% and the crash gates (≥ 99.5%/≥ 200 sessions, ≥ 99.7%/≥ 500, halt
  < 98.5% + the `minVersion` force-update remedy — DR-P21-05) fed by the crash-free-
  session telemetry; the WebView2 probe (DR-P21-04); bilingual ESC-POS print with
  reprint-from-cache. The Rust shell ships as source (the k6 precedent) — the Windows
  CI workflow compiles, EV-codesigns, minisign-signs (S-15), and SBOMs it, while
  `pnpm check:desktop-shell` gates the structure. Server-side exactly two additions:
  DR-P21-01 `POST /devices/:id/enroll` (the one-time credential exchange — migration
  `0032_device_enrollment_one_time.sql`, schema_version 32) and DR-P21-08 the seven
  desktop write intents inside the frozen v2 envelope (partner create, quotation /
  delivery-note / cash-transfer / stock-transfer drafts, expense, stock-count lines —
  handlers call the owning module services only; registry 6→13 intents; contract
  `2026-11-04.1` unchanged). Web: the DR-P21-06 Offline Console
  (`/{locale}/offline` + `/{locale}/unlock`) with the 9 OFFLINE-DRAFT flows,
  ONLINE-ONLY disabling with localized reasons, as-of labels, the FULL rejection
  action table with every choice audit-logged incl. the rejecting `traceId`, and
  reprint — shipped in the DR-P21-07 exported shell subset (`build:desktop` →
  `out-desktop`; depcruise `web-shell-no-server`); i18n 3044→3244. The updater
  channel is hosted as the `deploy/updater/` static-JSON layout +
  `scripts/updater-manifest.ts sign\|publish\|--self-test`. The E2E offline journey
  found and fixed a real integration defect (DR-P21-3b-1 — the outbox `payload`
  column must carry the full v2 envelope, or per-item results are unattributable and
  the row freezes IN_FLIGHT) and is green AR + EN.
  PHASE-022 (2026-11-05) ships the Android application as `@erp/mobile` (ADR-0014 —
  ONE app, TWO capability experiences: `android-field` + `android-personal`, scoping
  at device registration, never by build variant): the TS workspace package holds ALL
  application logic (DR-P22-01 — the `native/` Expo glue dir is excluded from the
  pnpm workspace, source-only until the EAS release workflow compiles it;
  `check:mobile-shell` gates the structure) — the two-layer token mirror +
  `check:mobile-tokens` (DR-P22-02), the logical-props-only RTL ban (DR-P22-03, the
  RN port of `erp/no-physical-direction`), the AR-first typed dictionary +
  `check:mobile-i18n` ar=en=371 (DR-P22-04), the mobile store (field migrations v4+,
  the 128 MB byte-exact prune, the §6.4 corruption drill; DR-P22-08b personal =
  cursors+meta+read models only — no outbox/inbox, push structurally unreachable),
  the sync host over UNMODIFIED sync-core with the §8 triggers + the 8 MB/2 MB/256 KB
  budgets + the C-08 gate + the D-01 purge (DR-P22-08), device security
  (DR-P22-09 — the SecureStore vault, memory-only tokens, biometric-optional unlock,
  best-effort trust signals that degrade never brick, FLAG_SECURE, the 7-day
  watermark), the 11-screen registry with honest states + the FULL rejection table
  (DR-P22-11), and the release policy + rollout gates (DR-P22-10 — calver
  `minVersion` force-update; promote 10→50 ≥ 99.5%/≥ 200, 50→100 ≥ 99.7%/≥ 500,
  halt < 98.5% at any sample size). Server-side: DR-P22-05 the field + personal feed
  activation (partner-scoped personal feeds, tampered-pull-proof) with DR-P22-05a
  migration `0033_mobile_feeds.sql` (`devices.linked_partner_id`) + the 3-b
  registration writer; DR-P22-06 the write-intent registry 13→17
  (`receipt:create_field_collection`, `van:confirm_load`/`van:confirm_unload`,
  `credit_note:create_draft` — owning services only, typed rejections with
  machine-readable details, duplicate:true replays); DR-P22-07 the FCM skeleton
  (NotificationChannelPort + the disabled-by-default adapter, opt-in default OFF, no
  financial payloads — three enforcement layers) with DR-P22-07a migration
  `0034_device_push_tokens.sql` + the `PUT /devices/:id/push-token` surface. The
  expo chaos profile (`apps/api/src/__db__/sync/expo/`) drives the REAL mobile store
  through the FULL C-01…C-16 (+C-11b) matrix + battery/connectivity fault profiles +
  the 4-window real-SIGKILL kill-matrix + D-01/D-02/D-04 (the personal class
  included) on the dedicated TENANT_EXPO; the capabilities-matrix android columns
  are implemented with real gates (18 cells; 42 implemented rows, 0 deferred).
  Honest deferrals (the k6 precedent): the on-device C-06/C-07/C-13 + D-02 cipher
  legs (the wired device-farm CI job), Play Store signing/EAS compile (CI only),
  the pixel snapshot gallery (tree-level parity proven), T-03 scan-to-cart on
  reference hardware, and the force-update screen navigation glue (policy + tests
  complete; the App.tsx TODO asserted structurally).
  PHASE-023 (2026-11-05) ships the external-integration substrate under the
  no-fabrication discipline: migration `0035_external_integrations.sql`
  (schema_version 35) makes the e-invoicing submission registry OPERATIONAL — one
  LIVE row per document × adapter (the partial unique over the live states;
  PENDING → GENERATED → SIGNED → SUBMITTED → ACCEPTED/REJECTED → REPORTED with
  exponential-capped retries, dead-letter alerting, and sealed payload/response
  artifacts via `EINVOICING_SECRET_KEY` with the `IDENTITY_SECRET_KEY` fallback —
  production fails closed), adds the S-10 certificate registry + the append-only
  usage audit (signing-job-only key access; CertExpiry 30/14/7; the offboarding
  purge), the per-tenant adapter rollout flags (default OFF; the enablement gate =
  an ACTIVE certificate + the jurisdiction pack), bank-statement parking + the
  seeded format-family registry (amounts never guessed), commerce-channel staging
  (natural-key upsert + Idempotency-Key batches; financial drift ⇒ CONFLICT for
  explicit human resolution, never LWW), and billing payout reconciliation
  (provider-reported gross/fee/net vs settled payments — RECONCILED or DRIFT with
  detail, never auto-corrected) with the refund flow (`payment.refunded`; the
  invoice stays PAID). The ZATCA adapter is the UNVERIFIED refuse-to-submit stub —
  the verification gate is honestly NOT_VERIFIED (no external access; nothing
  fabricated; every refusal names the unmet GATE-1..GATE-4 items; DR-001 OPEN with
  option C recommended); Egypt ETA is NOT_STARTED (the DR-003 DEFERRED draft + the
  fake-eta evaluation harness); the payment production cutover is INCOMPLETE with
  DR-002 OPEN (the sandbox is hardened). The `tests/authorities` harnesses
  (fake-zatca + fake-eta) drive the REAL registry + jobs through the
  submit/accept/reject/timeout/retry/DLQ scenario matrix; the chaos slice C-01…C-04
  runs with the submission jobs in the loop; `sales.commerce.manage` joins the
  permission catalog (243→244, permissions-drift 244=244); web adds
  `/settings/tax/einvoicing` + `/platform/einvoicing-funnel` + the parked-lines
  mapping + checkout result states, i18n AR/EN parity maintained.
  Infra-bound evidence (hosted CI, compose boot, Testcontainers run, mailpit
  capture, Playwright journey) waived per owner directive 2026-10-28 with
  local-gate equivalence recorded.
- **Tested:** locally — 1900+ checks across suites (api unit 270 + domain-core 38
  + contracts 46 + @erp/ui 42 + db suite 1517 on embedded PostgreSQL 16 (incl. 36 PHASE-014 billing/notifications/dashboard/perf specs: lifecycle transitions with session kills, the read-only route sweep, usage-limit matrix incl. the posting-never-blocked property, webhook signature/replay/idempotency, dashboard widget equivalence, mvp-candidate NFR-006 harness + the PHASE-015 configuration spec pack: config-resolution/golden effective-configs, template-apply, template-switch, degraded-entitlement, dependency-closure, composites-golden, reservations-sweep, reorder-inapp, landed-costs, industry reports + the PHASE-017 job-card/distribution/commissions packs + the PHASE-018 manufacturing packs: bom/explosion property, orders lifecycle, the two-level costing golden chain, wip-recon drift, qc gate, genealogy traces, industry-018 reports, templates-018)
  (invariants INV-001…009/010/011/012/013/014/015/016/017/018/019/020/021/022
  with positive+violation each, goldens G-01..G-06+mirrors/G-07/G-08+VAT-legs/
  G-09/G-10+FX-mirror/G-11+VAT-leg/G-12/G-13/G-14/G-15+policy-none/G-16+
  G-19/G-20 + engine goldens,
  concurrency CC-01/02/03/04/05/06, periods PC-01…07, reconciliation
  RC-01…03 + RC-04/RC-05 + RC-06/RC-08 + RC-09 + RC-10 + drift, posting-smoke
  p95 local (n=100 p95=58.4ms), treasury spoof S-04/A7 + tax spoof A7/A8 +
  inventory spoof A7 + purchasing spoof A7,
  BR-009/010/011/012 + BR-013…023 + BR-025…028 + BR-001 matrix + BR-004/
  BR-006/BR-018 sales packs, per-pack fixture suites ×10
  with rounding worked examples + byte-identical determinism + rate-boundary
  + unregistered/NO_VAT modes,
  FEFO + serial return-binding, T-01 100k-move perf smoke with
  EXPLAIN-verified index use + the PHASE-013 reporting specs (registry
  meta-tests, golden dataset envelopes, as-of byte-identical re-runs, run
  lifecycle with the FORBIDDEN_AT_RUN TOCTOU + idempotent artifact
  replacement, export block on seeded corruption, real-Chromium render +
  the PDF/A stamp, tafqit/CSV/XLSX units, isolation A-tests over
  `report_runs`/`print_templates`; the full suite output is in the
  completion report)) + the PHASE-020 sync
  suites (db: `src/__db__/sync/` 9 files / 74 tests — chaos-matrix C-01..C-16,
  duplicates 2×/10×/cross-batch/35d-restored-outbox, device-security D-01/03/04 +
  tenant spoof, push-isolation Y-01..Y-04, pull/push/policies/devices/jobs;
  sync-core 36/36 cycle/retry/recovery/pruning/watermark + the 016 chaos slice) +
  the PHASE-021 suites (`@erp/desktop` 16 files / 274 tests on real temp-dir SQLite +
  real Ed25519; the sync dir widened to 14 files / 130 tests — the desktop chaos
  profile 27 (the matrix C-01…C-16 on the real file store + 4 real-SIGKILL kill
  windows + D-01/02/04/06 on file) + enroll 6 + desktop-intents 23; the web console
  suites 73; the E2E offline journey 2/2 AR+EN — with the 020 chaos regression 19/19
  bit-identical and sync-core untouched at 36/36) +
  the PHASE-022 suites (`@erp/mobile` 27 files / 393 tests NEW — logic + REAL RN
  renders AR/EN through the vitest Flow bridge; the sync dir widened again to
  21 files / 191 tests in `src/__db__/sync/` — the expo chaos profile 27 (the matrix
  C-01…C-16 + C-11b on the REAL mobile store + battery/connectivity fault profiles +
  4 real-SIGKILL windows + D-01/02/04 incl. the personal class) + pull-fields /
  pull-personal 10 + field-intents 18 + register-partner-link 6, plus fcm-channel 8
  in `src/__db__/notifications/`, the full DB suite 128 files / 1898 tests; the
  mobile gates `check:mobile-tokens`
  130/130+50/50 + `check:mobile-i18n` 371 + `check:mobile-shell`; web i18n 3244=3244
  untouched; desktop 274/274 + the 020/021 chaos regressions byte-identical +
  sync-core 36/36 untouched) +
  visual
  harness 16 (AR+EN threshold-0 baselines ×95 incl. ShiftPanel ×4 ×2 directions,
  axe 0, geometry, coverage) +
  perf gate (10k-row overhead ≤ 6ms) + CSP probe 4 + negative proofs 3
  + contrast 15 + web typecheck/lint/build): the generated
  tenant-isolation suite A1–A10 over every registered tenant-owned table with the
  registry negative proof, identity flows (R-01/02/03/05, M-01/02/04/06/07/08/10,
  S-01/02/03, invitations, permission checklist), HTTP end-to-end through the
  real Nest pipeline, email over a real SMTP session, append-only guards,
  pg-boss dedupe, signed URLs, readiness + boundary meta-test via the
  CI-equivalent `pnpm gate:local`; hosted-CI runs remain waived follow-ups
  (U1) pending infrastructure.
- **Verified against official sources:** no compliance item is VERIFIED; all country
  tax data is BASELINE_RESEARCH with REQUIRES_VERIFICATION flags
  ([../localization/compliance-matrix/README.md](../localization/compliance-matrix/README.md)).
- **Production-ready / compliant / secure:** no such claims are made anywhere, and
  none may be made until phases complete with evidence.

## Known open items

- Open questions OQ-001…OQ-010 in
  [../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) —
  notable: pricing matrix (OQ-002), payment provider (OQ-003), ZATCA scope (OQ-004).
- Decision records OPEN under [../decisions/](../decisions/README.md).
- Risks under watch: [../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md)
  top-5 watchlist.
