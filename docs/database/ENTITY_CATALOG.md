# Entity Catalog

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-11-12 (PHASE-044 — the WMS & Inventory Intelligence cluster, 239 → 261 domain rows)

All planned entities grouped by owning module, with the phase that introduces them and
key relationships. This is the catalog-level map; column-level specifications for core
tables live in [TABLES/](TABLES/) and grow per phase (the actual Drizzle schema is the
machine-readable mirror — README sync rule). Column detail is deliberately **not**
speculative: entities introduced in later phases are listed with their key fields only,
and their TABLES specs are completed in their phase (directive §23 STEP 4).

Legend: **Phase** = first implementation phase · **OC** = offline-creatable
(UUIDv7 client-side, ADR-0006) · 🔒 = append-only (no update/delete by app role).

## tenancy & identity (PHASE-002/003/004)

| Entity | Purpose | Key fields / relationships | Phase | OC |
|--------|---------|---------------------------|-------|----|
| `tenants` | Customer organizations | name, name_ar, status, base_currency, country_code, timezone, industry_template_key, deleted_at | 002 (minimal) → 004 (profile) | no |
| `branches` | Operating units | tenant_id, code, name, name_ar, address, is_active | 004 | no |
| `users` | Global identity (email/phone unique) | email, phone, password_hash, status, locale, mfa fields | 003 | no |
| `memberships` | User↔tenant role link | user_id, tenant_id, role_id, branch_scope[], status | 003 | no |
| `roles` | Tenant roles | tenant_id (null = system template), key, name, name_ar, is_system | 003 | no |
| `permissions` | Atomic action catalog (seeded) | key (`sales.invoices.post`), module, description | 003 seed | no |
| `role_permissions` | Role grants | role_id, permission_id | 003 | no |
| `sessions` | Web sessions | user_id, token_hash, tenant_id (active), expires_at, revoked_at, ip, device_id | 003 | no |
| `devices` | Registered native clients | user_id, device_key_hash, platform (DESKTOP/ANDROID/pos-terminal), capabilities jsonb, tenant_id, terminal_id, name, last_seen_at, revoked_at + the 020 registry widening: device_class CHECK (pos-terminal/tauri-desktop/android-field/android-personal), contract_version, attestation_public_key/attestation_nonce/attested_at, trust_flags jsonb, last_pull_at/last_push_at, data_expires_at | 003 (schema) / 016 (pos-terminal slice) / 020 (generalized — LIVE) | no |
| `device_refresh_tokens` | Device credential rotation chain (identity-owned, service-mediated — the sessions pattern: hash-at-rest, no RLS); used_at is the reuse-detection tripwire, predecessor_id links rotations | device_id (CASCADE), token_hash (unique), predecessor_id, issued_at, expires_at, used_at, revoked_at | 020 | no |
| `device_push_tokens` | FCM device-token opt-in store (identity-owned, service-mediated — the device_refresh_tokens pattern; no RLS); one active row per device (uq device_id), a token never belongs to two devices (uq token), opted_in defaults FALSE (explicit opt-in — integrations §3.5), locale is the device's notification locale resolved before the FCM call; revocation clears the rows | device_id (CASCADE, unique), token (unique, 20–512 chars — shape never guessed), platform, opted_in, locale (ar/en), created_at, updated_at, version | 022 | no |
| `mfa_factors` | TOTP enrollment | user_id, secret_enc, enrolled_at, last_used_at, recovery_codes_hash | 003 | no |
| `invitations` | Membership invitations | email, tenant_id, role_id, token_hash, expires_at, accepted_at | 003 | no |
| `plans` | Subscription plans (seeded + admin) | key, name, price, limits jsonb, feature_keys[] | 004 | no |
| `subscriptions` | Tenant plan assignment | tenant_id, plan_id, status, period, provider_ref | 014 | no |
| `entitlements` | Effective feature grants (materialized) | tenant_id, feature_key, source, expires_at | 004 | no |
| `tenant_settings` | Key-value config (typed) | tenant_id, key, value jsonb | 004 | no |
| `support_sessions` | Time-boxed audited support access (matrix §7) | tenant_id, platform_user_id, opt_in, ticket_ref, reason, opened_at, expires_at, closed_at, closed_by, status | 004 | no |
| `audit_events` 🔒 | Immutable audit trail | tenant_id (null = platform-scope row, 004), actor_id, action, entity_type, entity_id, before jsonb, after jsonb, correlation_id, device_id, via_platform_admin (004), at | 002 → 004 (platform scope) | no |
| `_schema_state` | Migration-state mirror in the `erp` schema (`erp.schema_version()` feeds `/health/ready`); infra, not a domain entity | key, value, at | 002 | no |

## accounting (PHASE-007)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `accounts` | CoA nodes | tenant_id, code, name, name_ar, type, parent_id, is_postable, currency, status | 004 (schema+template) / 007 (posting) | no |
| `account_purposes` | Purpose→account mapping | tenant_id, purpose_key, account_id, active_from | 004 (schema+template) / 007 (posting) | no |
| `fiscal_years` | Tenant years | tenant_id, start_date, end_date, status | 007 | no |
| `fiscal_periods` | Month periods | fiscal_year_id, start_date, end_date, status (OPEN/SOFT_CLOSED/LOCKED) | 007 | no |
| `currencies` *(seed)* | ISO currencies + minor units | code, name, name_ar, minor_units | 002 (planned) → 004 (delivered) | no |
| `countries` *(seed)* | ISO-3166 country records + display defaults (locale, currency, date format, timezone) | code, name, name_ar, default_locale, currency_code, date_format, time_zone | 002 (planned) → 004 (delivered) | no |
| `exchange_rates` | Dated rates | tenant_id, currency_code, rate_date, rate, source | 007 | no |
| `journal_entries` 🔒 | Posted entries | tenant_id, entry_no, entry_date, fiscal_period_id, currency, exchange_rate, status (POSTED/REVERSED), source_type, source_id, operation, reversal_of_id, reversed_by_id, description, posted_at/by | 007 | no |
| `journal_lines` 🔒 | Entry lines | journal_entry_id, line_no, account_id, direction, amount, base_amount, partner_id, item_id, cost_center_id, tax_code_id, project_id (019 stamp — CLOSED projects reject new stamps), memo | 007 (projects 019) | no |
| `cost_centers` | Analytical dimension | tenant_id, code, name, name_ar, parent_id | 007 (basic) | no |
| `projects` | The PHASE-019 analytical dimension (cost_centers clone; OPEN/CLOSED — a CLOSED project rejects NEW journal-line stamps, typed PROJECT_CLOSED at the engine; posted history stays) | tenant_id, code (tenant-unique `^[A-Za-z0-9_-]{1,20}$`), name, name_ar, parent_id (composite FK RESTRICT), status (OPEN/CLOSED) | 019 | no |
| `recurring_journals` | Recurrence definitions | tenant_id, template jsonb, schedule, next_run_date, status | 007 | no |
| `approval_policies` | Doc-type approval rules | tenant_id, doc_type, policy jsonb (thresholds, approvers) | 007 | no |
| `numbering_sequences` | ADR-0006 per-(tenant, branch, type, period) sequences | tenant_id, doc_type, branch_id, period_key, next_value, format | 007 | no |
| `number_assignments` | Numbering audit ledger (voided = reserved forever, INV-021) | tenant_id, doc_type, branch_id, period_key, number, value, document_id, voided_at | 007 | no |
| `manual_journals` | Manual-journal DRAFT documents | tenant_id, status (DRAFT/PENDING_APPROVAL/APPROVED/POSTED/CANCELLED), entry_date, currency, exchange_rate, recurrence_id, posted_journal_id, approval_step | 007 | no |
| `manual_journal_lines` | Draft lines (cascade with the draft) | manual_journal_id, line_no, account_id, direction, amount, dimensions incl. project_id (019 draft substrate) | 007 (projects 019) | no |
| `journal_templates` | Line-structure templates (documents, not postings) | tenant_id, name, lines jsonb | 007 | no |
| `partner_subledger_entries` 🔒 | AR/AP subledger rows (partners-owned; INV-009) | tenant_id, partner_id, journal_entry_id, journal_line_id, direction, amount, base_amount, source_type | 007 | no |
| `reconciliation_runs` | Reconciliation check results (RC-01..03, PC-04) | tenant_id, kind (AR/AP/…), as_of, status (OK/BROKEN), control/subledger balances, diff jsonb | 007 | no |

## partners & items (PHASE-006)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `partners` | Customers/suppliers/both | tenant_id, kind, code, name, name_ar, tax_number, credit_limit, credit_terms_id, price_list_id, customer_tier_id (017 tier assignment — drives BR-003 resolution), balance caches (read-model), status | 006 → 017 (tier column) | no |
| `vehicles` | Per-partner vehicle registry (workshop — partners-owned) | tenant_id, partner_id, make, model, model_year, chassis_no (tenant-unique where set, VIN shape), plate_no, color, engine_no, odometer_km/odometer_at, status (ACTIVE/ARCHIVED), note/note_ar; service history is a UNION ALL read model over sales-owned job_cards/sales_invoices/credit_notes (read-only, MODULE_BOUNDARIES §6 precedent) | 017 | no |
| `partner_contacts` | Contact people | partner_id, name, phone, email, role | 006 | no |
| `partner_addresses` | Addresses | partner_id, type, line1, city, country_code, geo | 006 | no |
| `credit_terms` | Payment terms | tenant_id, code, days, description | 006 | no |
| `opening_balance_docs` | Draft opening balances | tenant_id, kind (partner/account/stock), target refs, amounts, status | 006 (draft) / 007 (posting) | no |
| `item_categories` | Item taxonomy | tenant_id, code, name, name_ar, parent_id | 006 | no |
| `items` | Item master | tenant_id, sku, barcode_ref, name, name_ar, kind (stock/service/composite), uom_id, category_id, tax_code_id, costing_method, track_batch, track_serial, track_imei, has_expiry, shelf_life_days? (018 — FG batch expiry = completion date + shelf life when the policy is on), reorder defaults, status | 006 → 018 (shelf life) | no |
| `uoms` | Units of measure | tenant_id, code, name, name_ar | 006 | no |
| `uom_conversions` | Conversion factors | tenant_id, from_uom, to_uom, factor | 006 | no |
| `barcodes` | Item barcodes | tenant_id, item_id, code, uom_id | 006 | no |
| `price_lists` | Price lists | tenant_id, name, currency, kind (sale/purchase), validity | 006 | no |
| `price_list_items` | Prices | price_list_id, item_id, uom_id, unit_price, min_qty | 006 | no |
| `partner_balances` | Read model: partner exposure | tenant_id, partner_id, open_balance, draft_balance, overdue_amount | 006 | no |
| `import_jobs` | Preview-gated bulk import state | tenant_id, kind, format, upload_token, status, counts, report | 006 | no |
| `file_objects` | Attachments | tenant_id, owner_type, owner_id, storage_key, name, size, content_type, checksum, uploaded_by | 002 (infra) / 006 (usage) | no |

## inventory (PHASE-010)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `warehouses` | Stock locations | tenant_id, branch_id, code, name, name_ar, inventory_account_id (G-15 override; NULL ⇒ INVENTORY purpose), type (STANDARD/VAN — 017 van slice; VAN rows carry rep_id, one van per rep), rep_id, role? (RAW/WIP/FG — 018 convention tag; no behavior depends on it), is_active | 010 → 017 (VAN type + rep binding) → 018 (role) | no |
| `item_warehouse_settings` | Per-item defaults | item_id, warehouse_id, reorder_level, min_qty, last_reorder_alerted_at | 010 | no |
| `stock_moves` 🔒 | Immutable movements | tenant_id, item_id, warehouse_id, direction (IN/OUT), qty, unit_cost, batch_id, serial_id, move_kind (receipt/issue/transfer_in/transfer_out/adjust), source_type (widened 017 with `job_card`; 018 with `production_order`), source_id, moved_at, value_amount | 010 → 017 (job_card source) → 018 (production_order source) | POS only |
| `stock_layers` | FIFO cost layers | tenant_id, item_id, warehouse_id, remaining_qty, unit_cost, source_move_id | 010 | no |
| `item_stock` | Read model: qty on hand | item_id, warehouse_id, qty, avg_cost | 010 | no |
| `item_batches` | Batch/lot records | tenant_id, item_id, batch_no, expiry_date, source_ref, status (ACTIVE/QUARANTINED/WRITTEN_OFF — QUARANTINED added 018 for the QC gate; FEFO and availability count ACTIVE only), production_order_id? (018 produced-batch provenance, composite FK → production_orders — the genealogy upstream edge) | 010 → 018 (status widening + provenance) | no |
| `item_serials` | Serial/IMEI units | tenant_id, item_id, serial_no, imei, status (in_stock/sold/returned), current_owner | 010 | no |
| `stock_counts` | Count sessions | tenant_id, warehouse_id, status, counted_by, variance jsonb | 010 | no |
| `stock_count_lines` | Counted lines | stock_count_id, item_id, batch_id, system_qty, counted_qty | 010 | POS-lite |
| `stock_transfers` | Warehouse transfers | tenant_id, from_wh, to_wh, status (DRAFT/IN_TRANSIT/POSTED), lines | 010 | no |
| `stock_transfer_lines` | Transfer lines (in-phase addition: the §4 doc list's "lines" is a real child table — one row per item per transfer) | transfer_id, line_no, item_id, qty | 010 | no |
| `stock_adjustments` | Reason-coded direct adjustments (in-phase addition: the §4 API `/inventory/adjustments` + `/post` and the G-13/G-14 golden source `stock_adjustment:post` require durable draft documents) | tenant_id, warehouse_id, item_id, reason, delta_qty (signed), unit_cost?, counter_account_id (required for OTHER), status | 010 | no |
| `stock_reservations` | Soft reservation pool (in-phase addition per the §4 sync rule; hard/soft policies land PHASE-015) | tenant_id, item_id, warehouse_id, qty, holder_type (widened 017 with `JOB_CARD`)/holder_id, expires_at, status | 010 → 017 (JOB_CARD holder) | no |

## purchasing (PHASE-011)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `purchase_requests` | Internal requisitions (approval routing → PO) | tenant_id, branch_id, needed_by, request_no, status, note | 011 | no |
| `purchase_request_lines` | Requisition lines | tenant_id, request_id, item_id, qty | 011 | no |
| `purchase_orders` | Supplier orders (DRAFT→ISSUED→CLOSED; revisions linked) | tenant_id, supplier_id, branch_id, order_no, order_date, expected_date, status, totals, tax_summary | 011 | no |
| `purchase_order_lines` | PO lines (BR-003 purchase-side pricing provenance) | tenant_id, order_id, item_id, qty, unit_price, tax_code_id, net/tax amounts, price_source | 011 | no |
| `goods_receipts` | Goods-in docs (G-07: stock + GRNI accrual) | tenant_id, po_id, warehouse_id, receipt_no, status, po_less_reason (BR-012), total_value | 011 | no |
| `goods_receipt_lines` | GRN lines (provisional cost, batch capture) | tenant_id, receipt_id, po_line_id, item_id, qty, unit_cost, value_amount, account_id (expense lines) | 011 | no |
| `supplier_invoices` | AP invoices (G-08; match outcome recorded pre-approval) | tenant_id, supplier_id, invoice_no (supplier's), internal_no, match_result, status, totals, tax_summary, due_date | 011 | no |
| `supplier_invoice_lines` | Invoice lines (BR-033 tax snapshots, GRNI quanta) | tenant_id, invoice_id, grn_line_id, item_id/account_id, qty, unit_price, tax_code_id, vat_recoverable, tax_snapshot, grni_cleared_value | 011 | no |
| `debit_notes` | AP corrections (G-09 mirror) | tenant_id, supplier_id, ref_invoice_id, note_no, totals, tax_summary | 011 | no |
| `debit_note_lines` | Debit-note lines | tenant_id, note_id, invoice_line_id, item_id/account_id, qty, unit_price, tax snapshot | 011 | no |
| `payments` | Money out (money movement via treasury) | tenant_id, supplier_id (or payee), cash_account_id, amount, allocations, status | 008 (generic disbursement) / 011 (AP alloc) | no |
| `landed_costs` | Cost allocations (baseline: value/qty + remaining-qty constraint) | tenant_id, grn_id, cost_type, amount, allocation_method, charge_account_id, allocated_to_stock/cogs | 011 | no |
| `landed_cost_allocations` | Per-GRN-line allocation rows | tenant_id, landed_cost_id, grn_line_id, qty_at_allocation, remaining_qty, allocated_amount, cogs_adjustment_amount | 011 | no |
| `purchase_reallocations` | Audited post-allocation re-allocation documents | tenant_id, payment_id, supplier_id, reason, total_amount | 011 | no |
| `purchase_reallocation_lines` | Re-allocation from→to pairs (BR-027 on-account) | tenant_id, reallocation_id, from/to open item ids, amount | 011 | no |
| `rfqs` | The RFQ sourcing round header (H-11/P-01) — open (OPEN: any supplier registry entry may respond) or invited (INVITED: the `invited_suppliers` jsonb uuid[] allow-list) supplier competition in front of the purchase order; lifecycle DRAFT → ISSUED → QUOTED → AWARDED → CLOSED (+CANCELLED off DRAFT/ISSUED) with DB stamp-shape CHECKs (issued/awarded/closed stamps must cohere with status, the 0050 discipline); `rfq_no` reserved at ISSUE (the BR-029 boundary-transition numbering); `portal_invites` jsonb carries the P-05 scoped supplier tokens as sha256 hashes only (the plaintext is shown ONCE at mint, never stored) | tenant_id, branch_id, rfq_no (UNIQUE per tenant, NULL until issue), title/title_ar, mode (OPEN/INVITED), status, currency_code, due_at, invited_suppliers jsonb, portal_invites jsonb, issued_at/by, quoted_at, awarded_at/by, closed_at/by, cancel_reason; grants SELECT/INSERT/UPDATE — **NO DELETE** (an issued RFQ is sourcing history; the purge-path policies cover offboarding) | 038 | no |
| `rfq_lines` | The RFQ requested items (qty + optional buyer target price) — lines replace on DRAFT edits only | tenant_id, rfq_id (composite FK CASCADE → rfqs), line_no (UNIQUE per RFQ), item_id (composite FK RESTRICT → items), qty (CHECK > 0), target_price? (CHECK ≥ 0), note; carries the **DELETE grant** — the replace-on-DRAFT-edit path (lines are scratch until the round issues) | 038 | no |
| `supplier_quotes` | The supplier quote header (P-02) — ONE quote per supplier per RFQ (UNIQUE tenant+rfq+supplier); portal or back-office entry; re-submission while the round is open REPLACES the lines (upsert semantics) | tenant_id, rfq_id (composite FK RESTRICT → rfqs), supplier_id (composite FK RESTRICT → partners), quote_ref? (the supplier's own reference, verbatim), status (SUBMITTED/WITHDRAWN), submitted_via (PORTAL/BACK_OFFICE), currency_code, lead_time_days?, valid_until?, payment_terms?, submitted_at, submitted_by?, portal_contact? (back-office stamps the actor, portal stamps the contact — the token itself is never recorded), note; grants SELECT/INSERT/UPDATE — **NO DELETE** | 038 | no |
| `supplier_quotes_lines` | The offered line prices/lead times per quote — replaced wholesale on re-submission while the RFQ is open | tenant_id, quote_id (composite FK CASCADE → supplier_quotes), rfq_line_id (composite FK RESTRICT → rfq_lines), line_no (UNIQUE per quote), qty (CHECK > 0), unit_price (CHECK ≥ 0), lead_time_days?, note; carries the **DELETE grant** — the re-submit replace path | 038 | no |
| `quote_comparisons` | The frozen comparison snapshot + the award decision (P-02/P-08) — EVIDENCE written once at prepare, never recomputed (the phase §7 risk note); the `award` jsonb records the line-level decisions ({rfqLineId, quoteId, supplierId, qty, unitPrice}) written once by the award; `generated_docs` jsonb traces the award to its generated POs/releases ({kind, id, supplierId, documentNo?, lineRefs}); ONE live comparison per RFQ — the BR-063 DB floor (uq on tenant_id+rfq_id; a second award round cannot coexist) | tenant_id, rfq_id (composite FK RESTRICT → rfqs), snapshot jsonb (CHECK object — per-line offers + scores + supplier totals), status (PREPARED/AWARDED/CANCELLED with award-stamp coherence CHECK), award jsonb?, awarded_by/at, award_note(_ar)?, generated_docs jsonb?; grants SELECT/INSERT/UPDATE — **NO DELETE** (the comparison is audit evidence; cancelled rows keep history) | 038 | no |
| `blanket_orders` | The standing supplier agreement (P-03) — validity window, min/max commitment amounts, price-locked lines, and the `released_amount` accumulator the service advances transactionally in the same statement as each release (over-release is a typed rejection; the CHECK is the DB floor); `contract_id` links P-06 contract purchasing | tenant_id, branch_id, blanket_no (UNIQUE per tenant), supplier_id (composite FK RESTRICT → partners), contract_id? (composite FK RESTRICT → crm.service_contracts), title/title_ar, currency_code, status (ACTIVE/EXPIRED/CLOSED/CANCELLED + closed-stamp coherence CHECK), valid_from/to (CHECK from ≤ to), min_commitment (≥ 0), max_commitment (≥ 0), released_amount (CHECK 0 ≤ released_amount ≤ max_commitment), price_lock jsonb ([{itemId, unitPrice, note?}] — the release resolves prices from here), closed_at/by, cancel_reason; grants SELECT/INSERT/UPDATE — **NO DELETE** (agreements close/cancel by status) | 038 | no |
| `blanket_releases` | The append-only release ledger — each release decrements the blanket's remaining commitment and carries the generated purchase order (the executable document the GRN/AP flow runs against; created in the same transaction as the release) — **a NO-DELETE ledger: released commitment is audited history** | tenant_id, blanket_id (composite FK RESTRICT → blanket_orders), release_no (UNIQUE per tenant), release_date, lines jsonb ([{itemId, qty, unitPrice}] — CHECK array; the effective release, prices resolved from the blanket price lock or explicit per-line quotes), amount (CHECK > 0), purchase_order_id (composite FK RESTRICT → purchase_orders), note; grants SELECT/INSERT/UPDATE — **NO DELETE** | 038 | no |
| `supplier_ratings` | The supplier scorecard (P-04) — delivery/quality/price scores (0..100, 2dp) computed from LIVE documents over the rolling window (GRN punctuality, debit-note quality drag, invoice price variance); ONE row per supplier (UNIQUE tenant+supplier), recompute overwrites — the window moves; the overall is the documented weighted fold (delivery 40% · quality 40% · price 20%); `detail` jsonb carries the sample decomposition (the evidence) | tenant_id, supplier_id (composite FK RESTRICT → partners), window_start/window_end (CHECK start ≤ end), delivery_score/quality_score/price_score/overall_score (CHECK 0..100), sample_size (≥ 0), detail jsonb (CHECK object — {grns, onTime, invoices, debitNotes, priceVariancePct, notes}), computed_by/at; grants SELECT/INSERT/UPDATE — **NO DELETE** | 038 | no |
| `approved_supplier_items` | The approved-vendor-per-item list (P-04 — the item-vendor mapping leg of P-09); gates vendor suggestions per the `purchasing.approved_vendor_list.mode` policy (OFF/FLAG/BLOCK); SUSPENDED vendors keep history but stop suggesting | tenant_id, supplier_id + item_id (composite FKs RESTRICT → partners/items; UNIQUE tenant+supplier+item), status (APPROVED/SUSPENDED), approved_by/at, expires_at?, note; grants SELECT/INSERT/UPDATE — **NO DELETE** (suspension, not deletion) | 038 | no |
| `supplier_advances` | Supplier advance disbursement tracking (P-12, golden G-33) — DRAFT → APPROVED (SoD creator ≠ approver) → DISBURSED (G-33 posts: DR the tenant-mapped ADVANCES control · CR CASH/BANK) → CLOSED (fully applied; the apply leg DR AP_CONTROL · CR the same control — the supplier's subledger nets) → CANCELLED; the control account is tenant-mapped by setting (`purchasing.supplier_advance_control_account`) — fail-closed when unmapped; `advance_no` reserved at DISBURSE (the posting stamp, the payroll PR- pattern) | tenant_id, supplier_id (composite FK RESTRICT → partners), advance_no? (UNIQUE per tenant), currency_code, amount (CHECK > 0), status, applied_amount (CHECK 0 ≤ applied ≤ amount), approved_by/at, cash_account_id? (composite FK RESTRICT → cash_accounts), entry_date?, posted_journal_id?/entry_no?, disbursed_at/by, cancel_reason; lifecycle stamp-shape CHECK (DISBURSED requires posted_journal_id); grants SELECT/INSERT/UPDATE — **NO DELETE** (workflow history) | 038 | no |
| `early_payment_discount_terms` | Per-supplier early-payment discount terms (P-13, golden G-34) — discount_pct within discount_days; the capture posts G-34 (DR AP_CONTROL · CR the tenant-mapped discount-income account) only while the terms are ACTIVE **and approved** (SoD: approved_by ≠ creator, before any capture posts) and the payment lands inside the window | tenant_id, supplier_id (composite FK RESTRICT → partners; UNIQUE per supplier), discount_pct (CHECK 0 < pct ≤ 100), discount_days (CHECK > 0), min_invoice_amount (≥ 0), status (ACTIVE/INACTIVE), approved_by?/approved_at (approval-coherence CHECK), note; grants SELECT/INSERT/UPDATE — **NO DELETE** | 038 | no |
| `capex_requests` | The capital purchase request (P-10/P-15) — budget-checked CAPEX workflow DRAFT → PENDING_APPROVAL → APPROVED → CONVERTED (+REJECTED/CANCELLED off the way), SoD creator ≠ approver, and the PHASE-028 budget control guard at submit (ADVISORY default / ENFORCE_DRAFT per tenant policy — the 028 discipline verbatim); `request_no` reserved at APPROVAL (the PR discipline — drafts are scratch); the guard's evaluation snapshot persists on the row as evidence; CONVERT generates the purchase order (the linkage lands here) | tenant_id, branch_id, request_no? (UNIQUE per tenant, NOT NULL at APPROVED — stamp-shape CHECK), title/title_ar, description?, account_id (composite FK RESTRICT → accounts — the guard's dimension key), cost_center_id?/project_id? (composite FKs RESTRICT), estimated_amount (CHECK > 0), currency_code, needed_by?, status, submitted_at/by, approved_by/at, rejection_reason?, cancel_reason?, converted_order_id? (composite FK RESTRICT → purchase_orders), budget_evaluation jsonb?; grants SELECT/INSERT/UPDATE — **NO DELETE** (workflow history) | 038 | no |
| `tender_intakes` | Public-tender INTAKE records (P-14/DF-52/DF-53) — the announcing authority, the deadline, our bid decision, and the government supplier-registration fields (stored verbatim, never guessed); intake records ONLY — no bidding-platform claims (the honesty discipline; nothing auto-bids) | tenant_id, intake_no (UNIQUE per tenant), title/title_ar, announcing_authority, tender_ref_no?, published_at?, submission_deadline?, estimated_value? (CHECK ≥ 0), currency_code? (shape-checked when set), our_decision (PENDING/WILL_BID/DECLINED/WON/LOST), decided_at?, decision_note?, gov_registration_no?, gov_registration_expiry?, classification_code?, source_url?, status (OPEN/CLOSED), note(_ar)?; grants SELECT/INSERT/UPDATE — **NO DELETE** | 038 | no |

## sales (PHASE-012; POS 016; job cards + commissions 017)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `quotations` | Offers | tenant_id, customer_id, valid_until, status, lines, totals | 012 | no |
| `quotation_lines` | Offer lines (BR-003 resolution at create) | tenant_id, quotation_id, item_id, qty, unit_price, discount, tax_code_id, net/tax amounts | 012 | no |
| `sales_orders` | Confirmed orders | tenant_id, customer_id, branch_id, order_no, status, lines, reservations | 012 | no |
| `sales_order_lines` | Order lines + the optional soft-reservation reference | tenant_id, order_id, item_id, qty, unit_price, discount, tax_code_id, net/tax amounts, reservation_id | 012 | no |
| `delivery_notes` | Goods-out docs | tenant_id, order_id, warehouse_id, status, lines | 012 | no |
| `delivery_note_lines` | DN lines (issue-cost snapshot — the W-3 provenance) | tenant_id, delivery_id, order_line_id, item_id, qty, unit_price, net_amount, batch_id, serial_ids, issue_unit_cost, issue_value | 012 | no |
| `sales_invoices` | Billing docs | tenant_id, customer_id, branch_id, invoice_no, invoice_date, due_date, kind (CASH/CREDIT), currency, exchange_rate, totals, tax_summary, posted_journal_ids, status, offline_receipt_no?, einvoice_status, channel (STANDARD/POS), pos_terminal_id?, order_type? (DINE_IN/TAKEAWAY/DELIVERY/COUNTER), pos_table_id?, tenders jsonb (the cash/card split — G-02), job_card_id?/vehicle_id? (017 provenance — the card→invoice chain + per-vehicle history), owner_device_id? (020 — the OWNER_DEVICE_WINS drafts stamp, reassigned by the admin route), claim_ref? (031 — external insurer claim reference, captured only when a template policy activates it; null = self-pay) | 012 → 016 (POS channel columns) → 017 (job-card/vehicle provenance) → 020 (owner-device drafts) → 031 (healthcare claim_ref) → 037 (ZATCA Phase-1 chain stamps) | POS yes |
| `sales_invoices` — **PHASE-037 addenda** (migration `0050_zatca_phase1.sql`) | ZATCA chain stamps on the billing doc | zatca_device_id? (composite FK → zatca_devices — the chain anchor), icv? (1..N per device, strictly monotonic — INV-027), previous_invoice_hash? (PIH = the predecessor's stored invoice_hash; genesis = base64(SHA-256(ASCII "0"))), invoice_hash? (base64 digest), invoice_hash_version? (`invoice-hash-v1`; PHASE-054 re-derives), qr_payload? (base64 TLV — rendered to an image at print time only, OA-06), classification? (STANDARD/SIMPLIFIED — the B2C path); all six stamp columns all-or-nothing (`ck_sales_invoices_zatca_stamp_shape`), partial UNIQUE (tenant, device, icv) + chain-walk index; NULL = unstamped until post or the backfill fills history (never rewritten) | 037 | POS yes |
| `sales_invoice_lines` | Lines | invoice_id, item_id, qty, uom_id, unit_price, discount, tax_code_id, tax_snapshot, net_amount, tax_amount, batch_id, serial_id, foc_reason_code? (017 BR-008 — zero-price FOC lines carry their reason; net ≥ 0 exactly when reason-coded) | 012 → 017 (FOC reason) | POS yes |
| `credit_notes` | AR corrections/returns | tenant_id, customer_id, ref_invoice_id, lines, totals, tax_summary, return_stock, job_card_id? (017 warranty-note provenance) | 012 → 017 (job-card link) | no |
| `credit_note_lines` | Note lines (mandatory invoice_line_id; re-entry cost snapshot) | tenant_id, note_id, invoice_line_id, item_id, qty, unit_price, tax_code_id, tax_snapshot, return_to_stock, batch_id, serial_ids, reentry_unit_cost, reentry_value | 012 | no |
| `receipts` | Money in | tenant_id, customer_id, cash_account_id, amount, currency, exchange_rate, allocations, status, method | 008 (generic) / 012 (AR alloc) | POS yes |
| `sales_reps` | Representatives | tenant_id, user_id, code, commission_method (NONE/PERCENTAGE), commission_rate, commission_basis (INVOICED/COLLECTED), commission_tiers jsonb (017 rule columns) | 012 (attr) → 017 (commission rules) | no |
| `sales_reallocations` | Audited post-allocation re-allocation documents (BR-027) | tenant_id, receipt_id, customer_id, doc_no, reason, total_amount, POSTED-at-create | 012 | no |
| `sales_reallocation_lines` | Re-allocation from→to pairs (BR-027 on-account) | tenant_id, reallocation_id, from/to open item ids, amount | 012 | no |
| `pos_terminals` | Registered terminals — one row per branch counter, bound to a till cash account + device + default warehouse; 80/58 mm receipt size; activate/deactivate only (no delete) | tenant_id, branch_id, code, name/name_ar, device_id (one terminal = one device), cash_account_id, warehouse_id, receipt_size, quick_keys jsonb, status (ACTIVE/INACTIVE), offline_seq | 016 | no |
| `pos_tables` | Floor plan (zones/tables) — ledger-free until a check pays | tenant_id, branch_id, zone, label, seats, status (FREE/OCCUPIED/RESERVED/OUT_OF_SERVICE), sort_key | 016 | no |
| `pos_checks` | Open guest checks — unpaid = NO ledger effect; `lines` jsonb is the working order document (send/merge/transfer/split); converts to a sales_invoices channel='POS' row at payment | tenant_id, branch_id, check_no, table_id, order_type, guest_count, status (OPEN/PAID/CANCELLED), lines jsonb, opened_by/at, closed_at, invoice_id | 016 | no |
| `pos_kitchen_tickets` | Printed kitchen tickets from open checks (print-only — screen KDS is a roadmap extension) | tenant_id, check_id, ticket_no, items jsonb, status (PRINTED/VOID), printed_at | 016 | no |
| `job_cards` | Workshop work order (sales-owned; the automotive template's REQUIRED capability) — DRAFT → IN_PROGRESS (approve) → COMPLETED → INVOICED + CANCELLED, with the issue-mode policy `reserve`/`issue_immediate`, quotation/invoice/credit-note references, and hours totals; no ledger before INVOICED | tenant_id, branch_id, card_no (JC-), customer_id, vehicle_id?, warehouse_id, parts_issue_mode, complaints/diagnosis (bilingual), odometer_km, checked_in_at + lifecycle stamps, quotation_id?/invoice_id?/credit_note_id?, labor_hours_total | 017 | no |
| `job_card_lines` | Card lines — PARTS (STOCK-kind items, reservation/issue linkage) vs LABOR (SERVICE-kind, estimated_hours billing at per-hour rate; qty column is line-count semantics) | tenant_id, job_card_id, line_no, line_type (PARTS/LABOR), item_id, qty, unit_price, estimated_hours?, logged_hours, discount_amount, tax_code_id?, status (PENDING/RESERVED/ISSUED/INVOICED/CANCELLED — tombstone-based full-replace, no deletes by grants), reservation_id?, issue_unit_cost?/issue_value?/issue_journal_id? (the W-3-style issue snapshot), invoice_line_id? | 017 | no |
| `commission_runs` | Commission run documents — one basis (INVOICED/COLLECTED) per run, computed lines, accrual journal at post (DR COMMISSION_EXPENSE · CR COMMISSION_ACCRUAL, dated period_to) | tenant_id, period_from/period_to, basis, status (DRAFT/POSTED/CANCELLED), total_base, total_commission, journal_entry_id?, computed_at, posted_at/by | 017 | no |
| `commission_run_lines` | Per-rep run lines — base × rate (flat or tiered bands, one rounding), effective rate stored, exclusion note-lines (BASIS_MISMATCH) explain absent reps; payout tracking | tenant_id, run_id, sales_rep_id, base_amount, rate_applied, commission_amount, detail jsonb (bands/invoiced/credited/collected), payout_status (ACCRUED/PAID), payment_id? | 017 | no |
| `commerce_channel_orders` | Staged e-commerce channel orders (T8) — upsert by natural key (tenant, channel, channel order id); financial-field drift on re-import flags CONFLICT with the previous payload preserved; resolution is an explicit human decision (ADR-0012 — no LWW anywhere) | tenant_id, channel_adapter_id, channel_order_id (uq natural key), payload jsonb, status (IMPORTED/CONFLICT/RESOLVED), conflict_detail jsonb?, import_batch_id?, resolved_by/at, resolution? | 023 | no |
| `commerce_channel_imports` | Import batch bookkeeping (T8) — Idempotency-Key per batch (duplicate batch replays the recorded outcome without re-pulling), cursors before/after, per-batch counters | tenant_id, channel_adapter_id, batch_key (uq with tenant+channel), cursor_before/after jsonb, pulled/imported/skipped/conflict counts, status (COMPLETED/FAILED), error? | 023 | no |

## distribution (PHASE-017)

The `distribution` module's tables (migration `0025_automotive_distribution.sql`; routes,
visits, van stock, settlements, tiers, free goods). Module ownership reconciled this phase
per [../architecture/MODULE_BOUNDARIES.md](../architecture/MODULE_BOUNDARIES.md): the three
planned rows previously listed under §sales (`routes`, `van_stocks`, `rep_settlements`) live
here, with their sibling tables added. Planning data (routes/visits) drives **no posting**;
`van_stocks` is a read-model mirror refreshed inside the owning transaction
(`stock_moves` stays the source of truth).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `routes` | Distribution routes — rep + optional van binding, weekday day-pattern | tenant_id, code (tenant-unique), name/name_ar, sales_rep_id?, van_warehouse_id? (VAN-type), day_pattern jsonb (⊆ MON..SUN, default MON–FRI), status (ACTIVE/INACTIVE), note/note_ar | 017 | no |
| `route_customers` | Route composition — ordered customer list (full-replace by grants) | tenant_id, route_id, customer_id (unique per route), visit_order, is_pinned | 017 | no |
| `route_visits` | Planned visits (idempotent per route/customer/date) — check-in/complete/skip/missed lifecycle, completion links to the day's documents | tenant_id, route_id, customer_id, planned_date, status (PLANNED/COMPLETED/SKIPPED/MISSED), checked_in_at?/checked_out_at?, sales_invoice_id?/credit_note_id?/receipt_id? (EXISTS-validated links), sales_rep_id?, note/note_ar | 017 | no |
| `van_stocks` | Read-model mirror of Σ signed `stock_moves` scoped to VAN warehouses (per warehouse/item/batch; refreshed by the van services inside the owning transaction; DELETE+INSERT by grants) | tenant_id, warehouse_id (VAN-type), item_id, batch_id?, qty, value (WAC carried), refreshed_at | 017 | no |
| `customer_tiers` | Customer price tiers → price-list binding (BR-003 tier level; assignment rides `partners.customer_tier_id`) | tenant_id, code (tenant-unique), name/name_ar, price_list_id? (SALE-kind), discount_cap_pct?, visit_frequency_days?, status (ACTIVE/INACTIVE), note/note_ar | 017 | no |
| `free_goods_rules` | Buy-X-get-Y promotion rules (BR-008 reason-coded FOC lines; evaluation is pure — never posts) | tenant_id, code (tenant-unique), name/name_ar, rule_type (BUY_X_GET_Y), buy_item_id/buy_qty, get_item_id/get_qty, per_multiple, max_free_per_order?, tier_id? (null = all customers), reason_code (required), valid_from?/valid_to?, status (ACTIVE/INACTIVE), note/note_ar | 017 | no |
| `rep_settlements` | Day-end rep settlement — STL- at post (INV-021); expected = opening + Σcash sales + Σcollections − Σrefunds − Σexpenses; variance ALWAYS posts (BR-021 family); one live settlement per (rep, date); POSTED locks the day | tenant_id, settlement_no (STL-), sales_rep_id, van_warehouse_id?, shift_id?, settlement_date, status (DRAFT/COUNTED/APPROVED/POSTED/CANCELLED), opening_cash/cash_sales/collections/cash_refunds/rep_expenses/expected_cash, counted_cash?, variance?/variance_direction (SHORTAGE/SURPLUS/NONE)/variance_reason?/variance_journal_id?, deposit_account_id?/deposit_amount?/deposit_journal_id?, approval + posted/cancelled stamps | 017 | no |
| `rep_settlement_lines` | Signed component ledger (Σ lines = expected; after post Σ lines = counted − deposit) — upsert-by-(settlement, line_no), zeroed tombstones on recount (no deletes by grants) | tenant_id, settlement_id, line_no, component (OPENING_CASH/CASH_SALE/COLLECTION/CASH_REFUND/REP_EXPENSE/VARIANCE/BANK_DEPOSIT), amount (signed), source_type?/source_id? (document refs; the OPENING_CASH line persists the rep cash account pointer), description/description_ar | 017 | no |

## manufacturing (PHASE-018)

The `manufacturing` module's tables (migration `0026_manufacturing.sql`; BOMs,
production orders, consumptions, scraps, QC inspections). Journals flow ONLY
through the centralized posting engine (ADR-0007) — consumption posts DR WIP ·
CR inventory at actual issue cost; completion posts DR FG inventory · CR WIP
(plus CR PRODUCTION_LABOR/PRODUCTION_OVERHEAD when the rates are set);
pre-completion scrap posts DR PRODUCTION_SCRAP · CR WIP with **no stock move**
(stock left at consumption). `stock_moves` stays the single stock truth (source
widened with `production_order`); `item_batches.production_order_id` is the
produced-batch provenance edge genealogy walks (read-only — genealogy never
writes).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `bills_of_materials` | Versioned recipe per item — DRAFT → ACTIVE → ARCHIVED; exactly one ACTIVE version per item (partial unique); release binds the version and snapshots the level-1 explosion | tenant_id, item_id (FK), version_no, status (DRAFT/ACTIVE/ARCHIVED), output_uom_id (FK), yield_pct numeric(7,4) DEFAULT 100 (CHECK 0 < yield ≤ 100, stored per version), effective_from?, note/note_ar, activated_at?/archived_at? | 018 | no |
| `bom_lines` | Component lines (the ONLY delete-granted manufacturing table — the DRAFT full-replace) | tenant_id, bom_id (FK composite), line_no, component_item_id (FK), uom_id (FK), qty_per_output numeric(19,6) CHECK > 0, scrap_pct numeric(7,4) DEFAULT 0 CHECK ≥ 0, note/note_ar | 018 | no |
| `production_orders` | The PRD- work order — DRAFT → RELEASED (number reserved + bound, BOM bound, level-1 snapshot) → IN_PROGRESS → COMPLETED / CANCELLED (zero consumption only, reason required); per-order WIP nets to exactly zero at completion | tenant_id, branch_id (FK), order_no (tenant-unique where set, partial uq), status, bom_id? (FK, bound at release), item_id (FK), uom_id (FK), planned_qty CHECK > 0, planned_date?, actual_qty DEFAULT 0, materials_warehouse_id/fg_warehouse_id (FK), labor_rate/overhead_rate numeric(19,6) DEFAULT 0, cost_center_id? (no FK — the job_cards cross-document precedent), yield_snapshot?, fg_batch_id?/fg_journal_id?, fg_value/wip_credit_value/labor_value/overhead_value numeric(19,4) DEFAULT 0, note/note_ar, cancel_reason (CHECK: CANCELLED ⇒ cancelled_at + cancel_reason NOT NULL), released_at/started_at/completed_at/cancelled_at | 018 | no |
| `production_order_lines` | The frozen level-1 explosion snapshot bound at release; `over_plan` flags the consumption-variance review once cumulative consumption crosses the template threshold (default 5%) | tenant_id, order_id (FK composite), line_no, component_item_id (FK), uom_id (FK), planned_qty, scrap_pct, actual_qty DEFAULT 0, over_plan boolean DEFAULT false, note/note_ar | 018 | no |
| `production_consumptions` | Batch-linked material issues — one journal per consume call (DR WIP · CR inventory at actual issue cost, per batch); the genealogy upstream edges | tenant_id, order_id (FK), item_id (FK), batch_id? (no FK — cross-module link, the stock_moves precedent), qty CHECK > 0, unit_cost CHECK ≥ 0, value CHECK > 0, journal_id?, consumed_at, note/note_ar | 018 | no |
| `production_scraps` | Reason-coded pre-completion WIP scrap (DR PRODUCTION_SCRAP · CR WIP; NO stock move); value ≤ the running WIP balance is service-enforced | tenant_id, order_id (FK), reason_code (1..40), qty CHECK > 0, value CHECK > 0, journal_id?, scrapped_at, note/note_ar | 018 | no |
| `inspections` | QC pass/fail + dispositions against production orders (FG batches) or goods receipts; PASS+ACCEPT releases a QUARANTINED batch to ACTIVE (no journal); FAIL+SCRAP routes to the qc_scrap stock issue | tenant_id, target_type (production_order/goods_receipt — CHECK target shape), order_id? (FK), grn_id? (FK composite → goods_receipts), fg_batch_id? (no FK), result (PASS/FAIL), sampled boolean DEFAULT false, sample_size?, disposition (ACCEPT/SCRAP/REWORK/RETURN_TO_SUPPLIER; required on FAIL — CHECK result='PASS' OR disposition NOT NULL), inspected_at, note/note_ar | 018 | no |

## crm (PHASE-019)

The `crm` module's tables (migration `0027_crm_projects.sql`; leads, tasks,
activities, the service-contract family, service orders, time entries) plus
the accounting-owned `projects` dimension (row above in §accounting). The
contract itself posts NOTHING (CAPABILITY_MATRIX §2.8) — the schedule is the
fee-item home (no contract-level fee_item_id, §18 lesson 1); contract
invoices are DRAFT sales invoices through the ordinary chain (the billing
run never auto-posts); service orders mirror job cards byte-close (contract
linkage alters no journal); the advance reclass/release journals flow only
through the centralized posting engine (ADR-0007) anchored at plain uuids;
time feeds billing ONLY (no payroll). `stock_moves.source_type` widens with
`service_order`; `sales_invoices` gains the contract/service-order/project
provenance trio (composite FKs RESTRICT); every line of a contract invoice's
post + COGS journals carries the project stamp.

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `leads` | The intake pipeline — NEW → QUALIFIED → CONVERTED (partner linked forever, provenance) / LOST (reason required); no numbering series (leads are not legal documents); no ledger effect ever | tenant_id, name, name_ar?, phone?/email?/company?, source (WALK_IN/REFERRAL/WEBSITE/CAMPAIGN/CALL/OTHER), status (NEW/QUALIFIED/CONVERTED/LOST), lost_reason (CHECK: LOST ⇒ present, 1..200), owner_user_id?, partner_id? (composite FK, set at conversion), converted_at (CHECK: CONVERTED ⇒ partner_id + converted_at), note/note_ar | 019 | no |
| `crm_tasks` | Future work (OPEN/DONE/CANCELLED) + the reminder-sweep substrate (the 05:30 cron scans remind_at ≤ now AND notified_at IS NULL, stamps notified_at) | tenant_id, title (1..200), related_type (LEAD/PARTNER/CONTRACT/SERVICE_ORDER) + related_id (polymorphic — no FK), assignee_user_id?, due_date?, remind_at?/notified_at?, status, note/note_ar | 019 | no |
| `crm_activities` | Logged past interactions — the timeline per lead/partner/contract (ordered by occurred_at DESC) | tenant_id, kind (CALL/MEETING/EMAIL/NOTE), related_type + related_id (polymorphic), occurred_at, summary (1..2000), duration_minutes? (≥ 0), actor_user_id? | 019 | no |
| `service_contracts` | The CT- document (posts nothing itself; the schedule rows are the fee-item home — NO contract-level fee_item_id, §18 lesson 1); DRAFT → ACTIVE (number + grid expansion at activation) → CANCELLED (reason) / RENEWED (renew creates a new contract copy + links renewed_to_contract_id); expiry is derived (isExpired in reads — no state-flip job) | tenant_id, contract_no (tenant-unique where set, partial uq, CT-{yyyy}-{seq:5} reserved+bound at activation), partner_id (composite FK), project_id? (composite FK RESTRICT), title (1..200)/title_ar?, scope?, fee_model (RETAINER/MILESTONES/HOURLY), start_date/end_date (CHECK end ≥ start), monthly_amount numeric(19,4)? (CHECK ≥ 0), currency_code (tenant base only v1), status (DRAFT/ACTIVE/CANCELLED/RENEWED), renewed_to_contract_id? (composite FK), cancel_reason?, note/note_ar, activated_at?/cancelled_at? | 019 | no |
| `contract_billing_schedule` | The expanded grid (re-runnable, additive): RETAINER grid = calendar months clipped to the term, billDate = period start (in advance), full monthly amount per period (NO automatic proration); MILESTONE rows carry dated labels; HOURLY periods bill in arrears with amount NULL (computed at the run) | tenant_id, contract_id (composite FK), entry_type (RETAINER_PERIOD/MILESTONE/HOURLY_PERIOD), period_key? (YYYY-MM, CHECK shape), period_start?/period_end?, bill_date, amount numeric(19,4)?, fee_item_id (composite FK — the fee-item home), milestone_label/milestone_label_ar? (partial uq WHERE entry_type='MILESTONE'), status (PLANNED/INVOICED/SKIPPED), invoice_id? (composite FK — the INVOICED flip stamp) | 019 | no |
| `contract_invoices` | The idempotency guard — the two partial uniques make concurrent double-fire a constraint violation ⇒ graceful skip (INV-013 discipline); the billing run is the only writer | tenant_id, contract_id (composite FK), invoice_id (composite FK RESTRICT → sales_invoices), period_key? (partial uq WHERE NOT NULL), milestone_schedule_id? (composite FK → contract_billing_schedule, partial uq WHERE NOT NULL), status (GENERATED) | 019 | no |
| `contract_advances` | On-account receipts tagged to a contract — HELD → RELEASED at the releasing invoice's post (the release journal's anchor); with the defer policy ON, tagging posts the reclass (DR AR · CR DEFERRED_REVENUE), OFF = link-only | tenant_id, contract_id (composite FK), receipt_id (composite FK → receipts), amount numeric(19,4) CHECK > 0, status (HELD/RELEASED), defer_journal_id?/released_journal_id?/released_invoice_id? (plain uuids — the production fg_journal_id precedent), note/note_ar | 019 | no |
| `service_orders` | The job-card generalization — create → approve (issue_immediate posts the parts COGS journal / reserve mode holds reservations) → logHours → complete → invoice (COMPLETED only, through SalesInvoiceService) → cancel (reason required; refuses when invoiced/issued); contract linkage does NOT alter any journal | tenant_id, branch_id (composite FK), order_no (tenant-unique where set, partial uq, SO-{yyyy}-{seq:5} reserved at creation), partner_id (composite FK), contract_id? (composite FK), warehouse_id (composite FK — parts), status (DRAFT/IN_PROGRESS/COMPLETED/INVOICED/CANCELLED), cancel_reason (CHECK: CANCELLED ⇒ cancelled_at + cancel_reason), note/note_ar, approved_at?/completed_at?/invoiced_at?/cancelled_at? | 019 | no |
| `service_order_lines` | Tombstone-based lines (no DELETE grant — the job_card_lines shape); SERVICE lines require estimated_hours; PARTS lines carry qty | tenant_id, order_id (composite FK), line_no (uq per order), line_type (SERVICE/PARTS), item_id (composite FK), description/description_ar?, estimated_hours? (CHECK ≥ 0; SERVICE ⇒ present), unit_price numeric(19,6) DEFAULT 0, qty CHECK > 0, logged_hours DEFAULT 0, status (PENDING/RESERVED/ISSUED/INVOICED/VOID), reservation_id?/issue_unit_cost?/issue_value?/issue_journal_id?/invoice_line_id?, note | 019 | no |
| `crm_time_entries` | Timeslips — unit_rate snapshotted at recording (never recomputed — determinism); narrative required on billing by policy; only APPROVED entries are pullable; time feeds billing ONLY (no payroll, no staff cost) | tenant_id, entry_date, hours numeric(19,6) CHECK > 0, fee_item_id (composite FK — SERVICE item), project_id? (composite FK RESTRICT; required-when-policy is service-enforced, typed TIME_ENTRY_CASE_REQUIRED), contract_id? (composite FK), fee_earner_user_id?, unit_rate numeric(19,6) CHECK ≥ 0, narrative?, billable DEFAULT true, status (DRAFT/APPROVED/BILLED/VOID), billed_invoice_id? (composite FK RESTRICT) | 019 | no |
| `projects` *(accounting-owned, listed here for the phase cluster)* | See the §accounting row above — the PHASE-019 analytical dimension | — | 019 | no |

## treasury (PHASE-008)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `cash_accounts` | Cash/bank/petty accounts (linked to GL) | tenant_id, type (CASH/BANK/PETTY), account_id (CoA), branch_id?, currency, status | 008 | no |
| `cash_movements` | Money in/out records | tenant_id, cash_account_id, direction, amount, currency, exchange_rate, base_amount, source_type (widened 017 with `rep_settlement` — settlement variance/deposit legs), source_id, value_date | 008 → 017 (rep_settlement source) | no |
| `treasury_allocations` | Settlement allocations (INV-016; exactly one of receipt_id/payment_id) | tenant_id, receipt_id, payment_id, open_item_id (→ partner_subledger_entries), amount | 008 | no |
| `expenses` | Expense claims/records | tenant_id, category_id, payee, amount, tax, cash_account_id, status, receipts (file refs) | 008 | no |
| `expense_categories` | Categories | tenant_id, code, name, name_ar, account_id, approval_policy | 008 | no |
| `cash_transfers` | Account↔account transfers | tenant_id, from_id, to_id, amount, charges, status | 008 | no |
| `cashier_shifts` | POS/teller shifts | tenant_id, cash_account_id, user_id, opening, counted, difference, status, pos_terminal_id?, denominations jsonb (per-denomination blind count BR-021), blind_count | 008 → 016 (POS-grade columns) | no |
| `bank_statements` | Imported statements | tenant_id, bank_account_id, period, source file ref | 008 | no |
| `bank_statement_lines` | Statement lines | statement_id, date, amount, ref, matched_movement_id? | 008 | no |
| `bank_statement_parked_lines` | Unparseable statement rows parked for manual mapping (T7) — raw cells verbatim, amounts NEVER guessed; resolution writes the mapped line + links it, discard records why | tenant_id, statement_id, line_index (uq with statement), raw_cells jsonb, raw_line, parked_reason, status (PARKED/RESOLVED/DISCARDED), resolved_line_id?, resolved_by/at, resolution_note? | 023 | no |
| `bank_statement_formats` *(seed)* | The shipped parser-format registry (global reference — format FAMILIES with declared required columns, not bank-specific claims; no attribution without verified documentation) | key, label_en/ar, family (csv/xlsx), extensions jsonb, required_columns jsonb, notes | 008 (registry rows 023) | no |

## tax & compliance (PHASE-009/023)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `tax_treatments` *(seed)* | The six treatments (TAX_ENGINE §1) + return-box semantics | key, name, name_ar, taxable, output_tax_box, input_tax_box, sort_order | 009 seed | no |
| `jurisdictions` *(seed)* | Country pack registry (global reference — no tenant_id, read-only to erp_app) | country_code, country_name (bilingual), currency_code, minor_units, vat_status (VAT_IN_FORCE/VAT_PLANNED/NO_VAT), pack_version, descriptor jsonb, verification_status, source_ref, verified_at | 009 seed | no |
| `jurisdiction_tax_rates` *(seed)* | Versioned effective-dated rates (verified_at NULL until the compliance protocol completes) | jurisdiction_id, treatment, rate, effective_from, effective_to, source_ref, verified_at | 009 seed | no |
| `tax_codes` | Tenant codes (treatment binder bound to a pack) | tenant_id, code, name, name_ar, country_code, default_treatment, snapshot_policy (STAMP_AT_POSTING), status | 009 | no |
| `tax_registrations` | Per-jurisdiction registration status (migrates the PHASE-004 tax.registration.* settings) | tenant_id, country_code, status (REGISTERED/NOT_REGISTERED/DEREGISTERED), registration_number, effective_from/to, deregistered_at | 009 | no |
| `tax_pack_bindings` | Staged pack-version pin per tenant (preview → apply, audited) | tenant_id, country_code, pack_version, applied_at/by | 009 | no |
| `tax_document_summaries` 🔒 | INV-012 document side: per-document (treatment, rate, tax code) groups accumulated at posting (append-only) | tenant_id, source_type, source_id, document_date, country_code, direction (OUTPUT/INPUT), treatment, rate, tax_code_id, taxable_base, tax_amount, snapshot jsonb | 009 | no |
| `vat_returns` | VAT return v1 (draft → ready → filed-by-human; INV-012 cross-check gates ready) | tenant_id, country_code, period_start/end, status, summary jsonb, cross_check jsonb, cross_check_ok, prepared_at/by, filed_at/by, filing_reference | 009 | no |
| `e_invoicing_submissions` | Operational submission registry (0035 expansion: 1:N per adapter — UQ tenant+source+adapter; one row per doc×adapter, re-submit chains via retry_of_submission_id) | tenant_id, country_code, adapter_id, source_type, source_id, status (PENDING/GENERATED/SUBMITTED/SIGNED/REPORTED/ACCEPTED/REJECTED/FAILED/SUPPRESSED), attempts, next_attempt_at (retry sweep), retry_of_submission_id, authority_refs jsonb, payload_file_id/response_file_id (sealed artifacts), payload_digest, authority_reference, submitted_at/reported_at/responded_at, last_error_code, error_detail | 009 (operational 023) | no |
| `e_invoicing_certificates` | S-10 certificate registry (SECRETS §6 HIGHEST) — secret-store PATH + lifecycle metadata ONLY (the encrypted blob lives in the files store einvoicing/{jurisdiction}/{tenant}/…); signing-job-only access (no API surface reads key material); expiry alerts 30/14/7; offboarding purge | tenant_id, country_code, adapter_id, label, key_version, secret_path (uq, 'einvoicing/%' shape), fingerprint, not_before/not_after, status (ACTIVE/EXPIRING_SOON/EXPIRED/REVOKED), enrolled_by/at, rotated_from_id, sign_count, last_used_at, expires_alerted_at | 023 | no |
| `e_invoicing_certificate_usage` 🔒 | Append-only per decrypt/sign audit row (the signing-volume dashboard substrate) | tenant_id, certificate_id, submission_id?, operation (SIGN/DECRYPT), key_version, used_at | 023 | no |
| `e_invoicing_adapter_settings` | Per-tenant adapter rollout flag — default OFF (DEPLOYMENT §7); enabling is a gated audited action requiring a provisioned ACTIVE certificate; NEVER the global feature_flags table (platform L8 vs tenant config) | tenant_id, adapter_id (uq with tenant), country_code, enabled (default false; enabled_by/at required when true), config jsonb | 023 | no |

## reporting & platform jobs (PHASE-002/013; sync substrate 016/020; desktop device-local store 021)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `report_runs` | Execution records (idempotent per `(tenant_id, report_key, params_hash)`; the stored result envelope is the export source of truth) | tenant_id, report_key, contract_version, params jsonb, params_hash, execution_class (inline/job), status (QUEUED/RUNNING/SUCCEEDED/FAILED), stage, requested_by, started_at/finished_at, duration_ms, error_code, error_detail jsonb, assertion_status (PASS/FAIL), result jsonb, assertions jsonb, artifacts jsonb, correlation_id | 013 | no |
| `print_templates` | Per-tenant registry of the 4 code-defined base templates (synced from `packages/ui/print`; tenants pick locale variants, never author logic) | tenant_id, key (a4-document/a4-report/receipt-80/receipt-58), version, locale_variants jsonb, metadata jsonb | 013 | no |
| `subscription_invoices` | Billing history rows — both payment paths (sandbox provider webhook + manual recording) write the SAME table identically (A-009); `paid_via` distinguishes the channel | tenant_id, subscription_id, number (BI-yyyy-nnnn), plan_key, period_start/end, amount 19,4, currency_code, status (OPEN/PAID/VOID/UNCOLLECTIBLE), source (checkout/manual/trial_credit), provider_ref, due_date, paid_at, paid_via (provider_webhook/manual_recorded), paid_reference, recorded_by, reason, placeholder_price | 014 | no |
| `billing_events` | Append-only billing trail (grants + guard trigger — the audit_events pattern); the unique `idempotency_key` is the webhook replay/duplicate-delivery guard (INV-013 discipline) | tenant_id, type (trial.started/expired, checkout.created/completed/expired, payment.succeeded/failed, payment.refunded, manual_payment.recorded, dunning.warned, grace.entered, suspension.executed, subscription.restored, plan.change.requested/changed, downgrade.blocked, limit.warning), payload jsonb, idempotency_key, actor_id, via_platform_admin, correlation_id | 014 (payment.refunded 023) | no |
| `billing_payouts` | Provider payout batches (T6) — the row records what the provider REPORTED (gross/fee/net per batch, uq provider+ref); reconciliation compares against settled platform payments in the window: RECONCILED or DRIFT with the reported-vs-computed detail (drift NEVER auto-corrected). Sandbox-depth until DR-002 decides the provider | tenant_id, provider_id, provider_ref, period_start/end, gross/fee/net (net = gross − fee, CHECK-enforced), currency_code, status (PENDING/RECONCILED/DRIFT), settled_payment_count, reconciled_at?, drift_detail jsonb?, raw jsonb | 023 | no |
| `usage_counters` | The §6 usage read model (documents/month per YYYY-MM; structural 'CURRENT' stamps); maintained by the fail-safe ledger-event subscriber + the daily-pass reconcile from journal_entries (the durable truth) | tenant_id, counter_key (documents_per_month/users/branches/warehouses/pos_terminals/offline_devices/industry_addons), period, value | 014 | no |
| `notifications` | The in-app inbox (PHASE-014 billing-critical subset: limits, subscription states, reconciliation/assertion failures, invoice.overdue; generalized in 015 — stock reorder digests (BR-019) and industry template upgrade offers); bilingual jsonb payloads; `dedupe_key` unique per tenant (once-per-event) | tenant_id, user_id (null = broadcast), category (limits/subscription/reconciliation/invoice_overdue/stock/templates/crm — crm widened 019), severity (info/warning/critical), title/body/action_label jsonb, action_url, dedupe_key, read_at | 014 (categories widened 015) | no |
| `notification_prefs` | Per-user channel toggles (in-app / email) per category; absent rows = both channels on — preferences suppress, never fabricate | tenant_id, user_id, category (limits/subscription/reconciliation/invoice_overdue/stock/templates/crm — crm widened 019), in_app, email | 014 (domain widened 015/019) | no |
| `change_log` | Sync change feed — the 020 generalized writer (feed groups pos/field/desktop/personal; 9 catch-up entity projections + per-command feed entries + the `permissions` snapshot rows) writes here inside the owning module's transaction; the 016 POS feed group rides unchanged | tenant_id, entity_type, entity_id, op (UPSERT/DELETE), payload, changed_at, seq; hot growth table — see [operations/DEPLOYMENT.md §7](../operations/DEPLOYMENT.md) | 016 (POS subset) / 020 (generalized — LIVE) | no |
| `tombstones` | Soft-delete markers for sync (the GC ledger — feed entries are the transport; gc_after is the sweep boundary, app-provided with deleted_at; weekly GC job bounded at 5000/loop) | tenant_id, entity_type (shape-checked), entity_id, deleted_at, gc_after; UQ (tenant_id, entity_type, entity_id) | 020 — LIVE | no |
| `sync_cursors` | Per-device pull positions (server-side hint — opaque signed tokens to clients; the daily cursor.compact pass audits lag and notifies owners of stalled cursors) | tenant_id, device_id, entity_type, last_seq, acknowledged_at | 016 (POS subset) / 020 (generalized — LIVE) | no |
| `inbox_commands` | Processed sync commands (the push dedupe ledger — one row per EXECUTED command, never DEFERRED; redelivery replays the stored result; the 30-day retention sweep is the audited daily job) | tenant_id, device_id, command_id, idempotency_key, entity_type, intent, status (ACCEPTED/REJECTED), result jsonb, processed_at; UQ (tenant_id, device_id, command_id) | 020 — LIVE | no |

> **Device-local store tables (PHASE-021 — LIVE, not server entities).** The desktop
> client's SQLite store (`@erp/desktop`, migrations v4/v5 continuing the shared local
> `schema_migrations` numbering on top of `sync-core` v1–3) carries **device-local
> tables that have no server counterpart and intentionally do not appear as catalog
> rows above**: the v4 read caches `sales_invoices` / `quotations` / `delivery_notes` /
> `stock_counts` (pulled projections of the same-named server entities — server columns
> win, plus the `local_status`/as-of overlays) and the write-set tables `draft_docs`
> (the unified OFFLINE-DRAFT store: doc_type, local_id, payload, local_status
> DRAFT_LOCAL\|PENDING_MERGE\|SYNC_FAILED\|MERGED\|CANCELLED_LOCAL, command_id,
> rejection, updated_at) + `local_events` (the audit-logged rejection choices with
> `trace_id` — kept forever, never pruned), plus the v5 `meta` seeds. The **server
> catalog is unchanged** — these are device-local schemas specified in
> [../offline/LOCAL_DATABASE.md](../offline/LOCAL_DATABASE.md) §1 and exercised by the
> desktop chaos profile ([../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md) §7).

## security & offboarding (PHASE-024)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `tenant_offboarding` | The Journey-H offboarding flow state machine (tenant-owned DURING the flow — the row dies with the tenant in the purge it tracks; the permanent record is `purged_tenants`): REQUESTED (read-only grace) → EXPORTED (manifest verified) → EXECUTED (two-person execution; SUSPENDED + retention window) → PURGED; CANCELLED is the owner-during-grace reversal | tenant_id (one LIVE row — partial unique over status ≠ CANCELLED), status, requested_by/at, grace_until, export_file_id, manifest_checksum, exported_at, executed_by/at, retention_until, purged_at, cancelled_at | 024 | no |
| `purged_tenants` | Deletion certificates (Journey H5 "what/when/by-whom retained in platform audit") — platform-owned, survives the purge it certifies; `hashed_tenant_id` (HMAC-SHA256 under the platform salt) is the only post-purge correlation handle (the tenant's audit rows are anonymized to tenant_id NULL by the purge) | tenant_id_at_purge (uq), hashed_tenant_id (uq), tenant_name_snapshot, manifest_checksum, export_file_id, performed_by, purged_at, table_row_counts jsonb, storage_objects_deleted, audit_rows_anonymized, verification jsonb | 024 | no |

## industry configuration (PHASE-004/015)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `industry_templates` *(seed)* | Template manifests — the engine-owned registry (3 manifests seeded at v1.0.0 in 015: retail, grocery-supermarket, restaurant-cafe; the 017 pair automotive + distribution seeded at v1.0.0 by migration 0025; the other eight remain 008 index stubs until their owning phases ship) | key, name, name_ar, manifest jsonb (modules, menus, terminology, defaults), version, status (ACTIVE/DRAFT/RETIRED), is_active | 004 seed / 015 engine / 017 (automotive + distribution) | no |
| `chart_of_accounts_template` *(seed)* | Bilingual default CoA (CHART_OF_ACCOUNTS §3) with purpose markers — additive per phase (016: `1151 CARD_RECEIVABLE`; 017: `2150 COMMISSION_ACCRUAL` + `5250 COMMISSION_EXPENSE` + the `4200 SERVICE_REVENUE` labor-revenue marker) | code, name, name_ar, type, is_group, parent_code, purpose_key | 004 seed (instantiation) / 007 (posting readiness) / 016–017 (POS + commission/labor markers) | no |
| `tenant_industry_config` | Applied template state — exactly one row per tenant (UNIQUE (tenant_id)); BR-038 switch archives ride as jsonb snapshots, never extra rows | tenant_id, template_key, applied_version, applied_manifest_hash, applied_at, applied_by, status, overrides jsonb (report_pins / onboarding_checklist / enabled_modules), archived_terminology / archived_navigation / archived_capabilities jsonb, conflict_notes jsonb | 015 | no |
| `feature_flags` | L8 rollout flags — platform delivery only, never tenant policy (global reference: no tenant_id, no RLS; erp_migrate writes, app reads; seeded empty) | key, scope, enabled, rules jsonb | 015 | no |
| `item_components` | Composite-product component definitions (items.composite_products; explosion at sale posting issues components at their own cost) | tenant_id, composite_item_id, component_item_id, qty | 015 | no |

> **Blueprint v2.0 module sections (ED-19).** The six financial-depth module sections
> below are specified at **blueprint level** per
> [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §C — 23 entities, all tenant-owned
> with RLS and UUIDv7 ids per the catalog conventions, phases PLANNED (delivered by
> PHASE-026…029/034); their TABLES specs are completed in their phase. Money, quantity,
> and rate types follow [ADR-0009](../architecture/ADR/ADR-0009-money-precision.md) and
> [DATA_DICTIONARY.md](DATA_DICTIONARY.md) §6 (costs/proceeds 19,4; percentages 7,4);
> append-only 🔒 tables follow INV-003 (no update/delete grants). The crm section
> arrived with PHASE-019 above per the grow-per-phase rule
> (manufacturing arrived with PHASE-018).

## fixed_assets (PHASE-026)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `asset_categories` | Category defaults & purpose mapping | code, name, name_ar, useful_life_months_default, depreciation_method_default, asset_purpose_key, accum_depreciation_purpose_key, expense_purpose_key | 026 | no |
| `assets` | Asset register | code, name, name_ar, category_id, acquisition_date, cost, salvage_value, useful_life_months, depreciation_method, branch_id, custodian_user_id, status | 026 | no |
| `depreciation_runs` | Monthly depreciation batches | fiscal_period_id, status DRAFT/POSTED, totals, journal_entry_id | 026 | no |
| `depreciation_lines` 🔒 | Per-asset run lines | run_id, asset_id, period_amount, accumulated_amount | 026 | no |
| `asset_disposals` | Sale/scrap disposals | asset_id, disposal_date, kind SALE/SCRAP, proceeds, net_book_value, gain_loss, status DRAFT/POSTED, journal_entry_id | 026 | no |
| `asset_revaluations` | Audited revaluations | asset_id, revaluation_date, new_gross_value, new_accumulated, delta, status, journal_entry_id | 026 | no |

## notes (PHASE-027 — DELIVERED by migration `0038_notes_installments.sql`, schema_version 38)

Blueprint rows per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §C (ED-19); column-level
truth: [TABLES/notes-installments.md](TABLES/notes-installments.md) (authored in-phase per the
grow-per-phase rule).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `notes` | Cheques & promissory notes in custody (delivered 0038) | kind CHEQUE/PROMISSORY_NOTE, direction RECEIVED/ISSUED, partner_id, number, issuing_bank, amount, currency, exchange_rate, issue_date, maturity_date, status, source_type/source_id + the delivered additions: `cash_account_id` (treasury cash account stored at DEPOSIT — the G-25/G-27/discount/dishonor-fee money legs), `journal_entry_id` (the G-24/G-27 entry), `note`/`note_ar` memos | 027 | no |
| `note_events` 🔒 | Custody/lifecycle events (delivered 0038 — append-only by grants + the `erp.note_events_guard` trigger: UPDATE never, DELETE only under `erp.purge_mode`) | note_id, event_kind, event_date, refs, journal_entry_id (NULL exactly for ENDORSE/DEPOSIT/RECLASSIFY — `ck_note_events_journal_shape`), created_by, memo/memo_ar | 027 | no |

The PDC maturity calendar is a job-derived cached read model over these two tables —
deliberately **no** new canonical entity (register §C). `treasury_allocations` gained
`note_id` (exactly-one-of-three owner CHECK) as the settle/restore substrate — see the
TABLES spec for the repoint algebra.

## installments (PHASE-027 — DELIVERED by migration `0038_notes_installments.sql`, schema_version 38)

Blueprint rows per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §C (ED-19); column-level
truth: [TABLES/notes-installments.md](TABLES/notes-installments.md).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `installment_plans` | Payment plans over source documents (delivered 0038) | partner_id, source_type/source_id (sales_invoice / crm service_contract) + source_no, total_amount, down_payment, line_count, start_date, frequency, late_fee_policy jsonb, status ACTIVE/CLOSED/DEFAULTED — **NULL = draft pre-activation** (the §9 enum lists the activated lifecycle states only; `ck_installment_plans_activated_shape` ties status to `activated_at`), activated_at/activated_by, closed_at, defaulted_at, note/note_ar | 027 | no |
| `installment_lines` | Generated dues schedule (delivered 0038) | plan_id, seq, due_date, amount, status PENDING/DUE/PAID/OVERDUE/WAIVED, receipt_refs jsonb (attributed receipt slices), collected_amount + the delivered late-fee stamps `late_fee_amount`/`late_fee_entry_id`/`late_fee_charged_at` (G-28 once per line, INV-013) and the waiver trio `waived_at`/`waived_by`/`waive_reason` | 027 | no |

## budgeting (PHASE-028)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `budgets` | Versioned budgets by fiscal year & scope | fiscal_year_id, scope, name, version, status DRAFT/PENDING_APPROVAL/ACTIVE/REVISED/CLOSED, supersedes_id | 028 | no |
| `budget_lines` | Budget amounts per period/dimension | budget_id, fiscal_period_id, account_id, cost_center_id?, project_id?, branch_id?, amount | 028 | no |

## payroll (PHASE-029)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `employees` | Payroll employees (financial scope only) | code, name, name_ar, national_id, hire_date, termination_date?, contract_type, basic_salary, salary_structure_id, branch_id, cost_center_id?, bank fields, status | 029 | no |
| `salary_structures` | Salary component templates | name, name_ar, currency, status ACTIVE/ARCHIVED | 029 | no |
| `salary_components` | Structure lines | structure_id, key, name, name_ar, kind ALLOWANCE/DEDUCTION/EMPLOYER_CONTRIBUTION, calc FIXED/PERCENT_OF_BASIC/PERCENT_OF_GROSS, amount, rate, gl_account_id, is_eos_base | 029 | no |
| `payroll_runs` | Monthly payroll batches | fiscal_period_id, status DRAFT/PENDING_APPROVAL/POSTED, gross_total, deductions_total, net_total, journal_entry_id | 029 | no |
| `payroll_run_lines` 🔒 | Per-employee frozen pay lines | run_id, employee_id, component_snapshot jsonb, gross_total, deductions_total, net_total | 029 | no |
| `employee_loans` | Employee loans/advances | employee_id, amount, installments_count, start_period_id, status ACTIVE/CLOSED (WRITE_OFF) | 029 | no |
| `employee_loan_lines` | Per-period loan deductions | loan_id, fiscal_period_id, amount, payroll_run_id?, status PENDING/DEDUCTED/WAIVED | 029 | no |

## consolidation (PHASE-034)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `consolidation_groups` | Multi-entity group definitions (parent-owned) | owner_tenant_id, name, name_ar, base_currency, status | 034 | no |
| `group_entities` | Member entities & ownership | group_id, member_tenant_id, ownership_percent, include_from, status | 034 | no |
| `elimination_entries` | Intercompany eliminations | group_id, fiscal_period_id, description, status DRAFT/POSTED, journal_entry_ids | 034 | no |
| `consolidation_runs` | Consolidation execution records | group_id, fiscal_period_id, status QUEUED/RUNNING/COMPLETED/FAILED, output refs | 034 | no |

## custom fields (PHASE-036 — DELIVERED by migration `0049_custom_fields.sql`, schema_version 49)

The extensibility core (ADR-0019): typed custom fields (FD-18) + tenant
picklists (FD-20) + per-entity form layouts (FD-19). The entity list is
CODE-OWNED (`CUSTOM_FIELD_ENTITIES`) — later phases register entities
additively with zero migrations.

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `custom_field_definitions` | Tenant-owned field registry (FD-18) | entity_type (code-owned registry), key (BR-058 namespace), label/label_ar, data_type TEXT/NUMBER/DATE/BOOLEAN/SELECT/MULTISELECT/REFERENCE, config jsonb, required, validation rule set, status ACTIVE/ARCHIVED | 036 | no |
| `custom_field_values` | Typed value store (ADR-0019: one typed column per row — num_nonnulls=1) | entity_type, entity_id (polymorphic, registry-validated), field_id, value_text/value_number/value_date/value_boolean/value_json | 036 | no |
| `custom_picklists` | Tenant-managed value lists (FD-20) | key, name, name_ar, status ACTIVE/ARCHIVED | 036 | no |
| `custom_picklist_options` | Picklist options | picklist_id, label, label_ar, sort_order, status ACTIVE/ARCHIVED (archived rejected for new values, labels preserved for history) | 036 | no |
| `form_layouts` | Per-entity designer layouts + role overrides (FD-19) | entity_type, role_key (NULL = default; two partial uniques), name, sections jsonb, status | 036 | no |

## zatca devices (PHASE-037 — DELIVERED by migration `0050_zatca_phase1.sql`, schema_version 50)

The ZATCA Phase-1 generation substrate (INV-027 —
[../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)): the
per-tenant EIAS device registry (the chain anchor) + the additive NULLABLE sales_invoices
stamp columns recorded as the addenda row in the sales section above. +1 table — the
catalog count moves 203 → 204 (the RLS-suite parity gate checks the number).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `zatca_devices` | Per-tenant ZATCA EIAS device registry — the INV-027 chain anchor (device UUID/serial are placeholders until PHASE-054 CSID onboarding; solution-provider fields stored verbatim, never guessed) | tenant_id, name/name_ar (UNIQUE per tenant), device_uuid? (36-hex shape, UNIQUE per tenant where set), device_serial?, solution_provider_name?, solution_provider_vat? (15-digit shape), registration_status (NOT_REGISTERED/PENDING/REGISTERED/REVOKED — the app writes NOT_REGISTERED only in Phase-1, BR-061), icv_counter (≥0 — the next minted ICV is counter+1, incremented transactionally inside the invoice post), branch_id? (composite FK RESTRICT), note; grants SELECT/INSERT/UPDATE — **NO DELETE** (a device with issued invoices is archive-disabled by the service; the purge-path policies cover offboarding) | 037 | no |

## returns & collections (PHASE-039 — DELIVERED by migrations `0055`–`0059`, schema_version 59)

The Returns & Collections cluster (H-12/H-13/S-14…S-16 · L1-10/11/12 · R-03):
the customer RMA workflow whose completion auto-generates the credit note through
the posting engine (G-35/G-36/G-37, BR-064), managed warranties with structured
terms, the dunning step ladder (BR-065 monotonic) with the late-fee register, the
collection-agency layer with hashed callback tokens, the additive partner
credit-risk columns (L1-10), and the supplier-RMA mirror auto-generating the AP
debit note (G-38 — the v3.2/R-03 addition). +10 tables — the catalog count moves
217 → 227 (the RLS-suite parity gate checks the number).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `return_authorizations` | The customer RMA (H-12/S-14) — REQUESTED → APPROVED (SoD) → RECEIVED → INSPECTED → RESTOCKED/SCRAPPED/REFUNDED (+CANCELLED); the terminal completion auto-generates the credit note through the posting engine — exactly once, atomically with the disposition leg (BR-064; INV-013 sources `return_authorization:restock\|scrap\|refund` → G-35/G-36/G-37); `rma_no` reserved at APPROVAL (the PR discipline) | tenant_id, branch_id (composite FK RESTRICT), rma_no? (UNIQUE per tenant at APPROVED), partner_id/invoice_id (composite FKs RESTRICT), reason_code (DAMAGED/DEFECTIVE/WRONG_ITEM/LATE_DELIVERY/CUSTOMER_REMORSE/OTHER), status, disposition? (RESTOCK/SCRAP/REFUND — gated at INSPECTED+, BR-064), currency_code, total_net/tax/gross (CHECK ≥ 0), lifecycle stamps (approved/received/inspected/completed/cancelled × at/by — the 0053 stamp-CHECK discipline; terminal states imply credit_note_id + posted_journal_id), refund_cash_account_id? (required at REFUNDED — the G-37 cash-out leg), credit_note_id? (composite FK RESTRICT → credit_notes), entry_no?; grants SELECT/INSERT/UPDATE — **NO DELETE** (workflow history) | 039 | no |
| `return_authorization_lines` | RMA lines — invoice-line referenced, qty bounded by invoiced − credited − open-RMA (the service fold; a typed rejection above it); replace-on-edit (DRAFT only, the rfq_lines precedent) | tenant_id, rma_id (composite FK CASCADE), line_no (UNIQUE per RMA), invoice_line_id (composite FK RESTRICT → sales_invoice_lines), item_id? (composite FK RESTRICT), qty (CHECK > 0, 6dp), unit_price/discount_amount/net_amount/tax_amount snapshots, tax_code_id?, note?; grants SELECT/INSERT/UPDATE/**DELETE** (replace-on-edit) | 039 | no |
| `warranty_registrations` | Managed warranties with STRUCTURED terms (S-15) — typed jsonb `{ durationMonths, coverage: REPAIR\|REPLACE\|REFUND\|LABOR_ONLY\|PARTS_ONLY, basis: INVOICE_DATE\|DELIVERY_DATE, mileageLimitKm? }` replacing the free-text blob; the daily expiry sweep emits 30/7/0-day notifications (category `warranties`) | tenant_id, partner_id/item_id (composite FKs RESTRICT), serial_no?, invoice_id?/job_card_id? (provenance, composite FKs), terms jsonb (CHECK object; service-validated shape), start_date/end_date (CHECK end ≥ start), status (ACTIVE/EXPIRED/VOID), last_notified_at? (the sweep's dedupe stamp); grants SELECT/INSERT/UPDATE — **NO DELETE** | 039 | no |
| `dunning_policies` | The dunning step ladder (H-13/S-16) — steps jsonb `[{stepNo, daysOverdue, channel: EMAIL\|WHATSAPP\|SMS, templateKey, escalate, referToAgency?}]` (ascending — BR-065 monotonic; service-validated order, CHECK array non-empty) + the late-fee rules ON the policy (L1-12): mode DISABLED/CONTRACT_RATE/STATUTORY_CAP with REQUIRES_VERIFICATION (a statutory rate carries its jurisdiction-source citation or the fee run refuses to post — worksheet mode) | tenant_id, name/name_ar, status (DRAFT/ACTIVE/ARCHIVED), partner_tier_ids jsonb (attachment scope), is_default, steps jsonb, late_fee_mode/rate_pct/grace_days/max_amount/source (shape CHECKs: CONTRACT_RATE ⇒ rate > 0; STATUTORY_CAP ⇒ rate > 0 + source 3–500 chars); grants SELECT/INSERT/UPDATE — **NO DELETE** | 039 | no |
| `dunning_letters` | One letter per (invoice, step) — the BR-065 monotonic evidence (UNIQUE tenant+invoice+step_no: a step fires at most once, the sweep only advances) + the late-fee register (L1-12: fee columns stamped by the charging step; the waiver path records reason + approver) | tenant_id, policy_id/partner_id/invoice_id (composite FKs RESTRICT), step_no (CHECK ≥ 1), days_overdue (CHECK > 0), letter_date, channel (EMAIL live now; WHATSAPP/SMS stored, delivered post-041 through the channel-port — the explicit deferral), template_key, status (QUEUED/SENT/FAILED), sent_at?/email_to?/subject?/body_snapshot?/error?, fee_amount? (CHECK > 0)/fee_invoice_id? (composite FK → sales_invoices)/fee_waived_at?/fee_waived_by?/fee_waiver_reason? (waiver shape CHECK: all-three-or-none, reason 3–500); grants SELECT/INSERT/UPDATE — **NO DELETE** (compliance history) | 039 | no |
| `collection_actions` | Logged collection actions with outcome codes — calls, promises-to-pay (promised_date required), disputes, field visits, payment plans, agency referrals; the ladder's working memory, never a posting | tenant_id, partner_id (composite FK RESTRICT), invoice_id?/policy_id? (composite FKs), action_type (CALL/EMAIL/PROMISE_TO_PAY/DISPUTE/FIELD_VISIT/PAYMENT_PLAN/WRITE_OFF_REQUEST/AGENCY_REFERRAL/OTHER), action_date, outcome (PENDING/PROMISED/BROKEN/PAID/ESCALATED/NO_ANSWER/OTHER), promised_date?/follow_up_date?/amount?, note(_ar)?; grants SELECT/INSERT/UPDATE — **NO DELETE** | 039 | no |
| `collection_agencies` | The partner-linked collection-agency register (L1-11) — commission terms + the hashed callback token (the 038 portal pattern verbatim: 256-bit random, sha256 at rest, unenumerable + revocable; `erp.portal_resolve_agency_token` resolves pre-GUC, SECURITY DEFINER, erp_definer-owned) | tenant_id, partner_id (composite FK RESTRICT, UNIQUE per tenant), contact_name?/email?/phone?, commission_mode (PCT_OF_COLLECTED ⇒ pct ∈ (0,100] / FLAT_FEE ⇒ fee > 0 — shape CHECK), status (ACTIVE/SUSPENDED), portal_token_hash? (64-hex CHECK + token_issued_at), note(_ar)?; grants SELECT/INSERT/UPDATE — **NO DELETE** (agencies suspend, never delete) | 039 | no |
| `collection_referrals` | Referral records (L1-11) — the referred balance, the commission-terms snapshot at referral, the settlement ladder REFERRED → ACKNOWLEDGED → PARTIAL → SETTLED → COMMISSION_POSTED → CLOSED (+CANCELLED); the commission posts through the engine at settlement (G-39, implementation-bound: DR the tenant-mapped commission expense · CR AP_CONTROL on the agency partner) | tenant_id, agency_id/partner_id (composite FKs RESTRICT), invoice_id?/action_id? (composite FKs), currency_code, referral_date, referred_amount (CHECK > 0), commission_mode/pct/flat_fee snapshot, status, settled_amount (CHECK ≥ 0)/settled_at?, commission_amount?/commission_journal_id?/commission_entry_no? (the COMMISSION_POSTED stamp CHECK implies them), closed_at?; grants SELECT/INSERT/UPDATE — **NO DELETE** (compliance evidence) | 039 | no |
| `supplier_return_authorizations` | The supplier-RMA mirror (R-03, v3.2/CR-50 — decided before any 039 code): REQUESTED → APPROVED (SoD) → SHIPPED (the goods leave — inventory issue leg) → CREDITED (the AP debit note auto-generates through the posting engine, G-38: DR AP_CONTROL · CR INVENTORY at the receipt cost); `srma_no` reserved at APPROVAL | tenant_id, branch_id/supplier_id/purchase_order_id (composite FKs RESTRICT), srma_no? (UNIQUE per tenant at APPROVED), reason_code (DAMAGED/DEFECTIVE/WRONG_ITEM/OVER_SHIPMENT/EXPIRED/RECALL/OTHER), status, currency_code, totals (CHECK ≥ 0), lifecycle stamps (approved/shipped/credited/cancelled — the CREDITED state implies debit_note_id + posted_journal_id), debit_note_id? (composite FK RESTRICT → debit_notes), entry_no?; grants SELECT/INSERT/UPDATE — **NO DELETE** | 039 | no |
| `supplier_return_authorization_lines` | Supplier-RMA lines — PO-line referenced, qty bounded by purchased − already-returned (the service fold); replace-on-edit (DRAFT only) | tenant_id, srma_id (composite FK CASCADE), line_no (UNIQUE per SRMA), po_line_id (composite FK RESTRICT → purchase_order_lines), item_id? (composite FK RESTRICT), qty (CHECK > 0, 6dp), unit_cost/net_amount snapshots, note?; grants SELECT/INSERT/UPDATE/**DELETE** (replace-on-edit) | 039 | no |

Plus the **additive partner credit-risk columns** (L1-10, migration `0057` — zero
reshape of the catalogued `partners` row): `credit_score_class` (A/B/C/D, CHECK —
tenant-entered or rule-computed locally; the tenant-mapped blocked class behaves
exactly like an over-limit block in the BR-001 credit check),
`credit_review_frequency_days` (≥ 7 when set) + `next_credit_review_at` (the periodic
review clock — the daily sweep assigns reviewers via `collections` notifications and
the outcome history rides `audit_events`, the house record-timeline pattern — no new
history table), `last_credit_review_at/by` + `credit_review_note`; indexed
`(tenant_id, next_credit_review_at) WHERE NOT NULL` for the sweep's hot path.

## data onboarding (PHASE-040 — DELIVERED by migration `0060_import_toolkit.sql`, schema_version 60)

The Data Onboarding & Migration Toolkit substrate (H-17 · IN-26 · TB-19/TB-20 ·
OA-05 · L1-21): the saved-mapping store both directions (import column maps + the
v3.1/CR-46 export templates), the additive import-jobs widening (+7 kinds — COA,
ACCOUNT_OPENING_BALANCES, FIXED_ASSETS, EMPLOYEES, PRICE_LISTS, CONTRACTS, BUDGETS —
plus mapping_id/options), and the tenants SANDBOX/demo markers (kind, expires, quota,
owner-email, demo_seeded_at/template/hash). +1 table — the catalog count moves
227 → 228 (the RLS-suite parity gate checks the number). The engine itself is
application code (the onboarding module); zero new journal rules — every import
lands through EXISTING engines (BR-066's negative ledger proof).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `import_mappings` | Saved column maps + export templates (§2.3): tenant-scoped named maps reusable across files of the same shape (IMPORT direction — canonical column → file header) and recurring one-click extract shapes (EXPORT direction — entity, column selection, format, filters; the L1-21 half) | tenant_id, name (UNIQUE per tenant+direction+kind), direction (IMPORT/EXPORT), kind (the import kind vocabulary — the 3 baseline + the 7 PHASE-040 kinds; EXPORT names its entity, shape `^[a-z][a-z0-9_.]{1,60}$`), entity? (NULL on IMPORT — shape CHECK), column_map jsonb (the map itself), options? jsonb, created_by; grants SELECT/INSERT/UPDATE/**DELETE** (tenant user data — re-editable and removable, the entitlements precedent) | 040 | no |

## communications (PHASE-041 — DELIVERED by migration `0064_communications_hub.sql`, schema_version 64)

The Communications Hub substrate (H-22 · N-06…N-08 · IN-13…IN-18 · FD-30 · TB-23 · UX-14 · PP-13/PP-15):
the tenant message-template store (FD-30 — the "no email_templates, strings in code" gap), the
outbound send ledger (every send is a row — status/provider ref/cost/retry policy, BR-067 port
discipline), the user × module × channel notification-preference matrix (TB-23; user_id NULL = the
tenant default row — NULLS NOT DISTINCT), and the unified interaction log (UX-14/IN-16 — messages
+ logged calls per partner). +4 tables — the catalog count moves 228 → 232 (the RLS-suite parity
gate checks the number). The adapters/pipeline are application code (the communication module);
zero new journal rules — the hub posts through EXISTING engines only. Numbering note: the phase
doc planned `0059` — written before CR-50's 0055–0059 and PHASE-040's 0060–0063; 0064 is the
honest next slot (the 0060 numbering-note precedent).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `message_templates` | Tenant message templates (FD-30): channel × locale × module with typed variable declarations — the email/print template substrate; the builtin code catalog is the fallback (tenants start from working AR/EN defaults) | tenant_id, key + channel + locale (UNIQUE per tenant — the effective-template resolution key), channel (EMAIL/WHATSAPP/SMS; EMAIL requires a subject, the others are body-only), locale (ar/en), module (the notification-category vocabulary), subject?, body (1..20000), variables jsonb `[{name, required}]` (typed declarations, shape CHECK), is_active, created_by; grants SELECT/INSERT/UPDATE/**DELETE** (tenant user data — the import_mappings precedent) | 041 | no |
| `outbound_messages` | The outbound send ledger (BR-067): every outbound send is a row — queue → provider → status transitions with evidence | tenant_id, channel (EMAIL/WHATSAPP/SMS), status (QUEUED/SENT/DELIVERED/FAILED — the status-evidence CHECK pins sent_at/delivered_at/last_error coherence), recipient, recipient_user_id?, partner_id?, module, template_key, locale, subject?, body_snapshot (the deterministic rendered record), provider?, provider_ref?, cost_amount/cost_currency? (numeric 19,4 — travel together), attempts/max_attempts (1..10)/next_attempt_at (the retry policy), last_error?, sent_at?, delivered_at?, source_type? (DUNNING_LETTER — the 039/036 handoff — / DIGEST / NUDGE / MANUAL / CALENDAR / NOTIFICATION) + source_id?, correlation_id?, payload? jsonb; queue/partner/report/source indexes (OA-06); grants SELECT/INSERT/UPDATE (LEDGER — no app-role DELETE, the dunning_letters precedent) | 041 | no |
| `notification_preferences` | The notification-preference matrix (TB-23): user × module × channel with tenant defaults | tenant_id, user_id? (NULL = the tenant default row — UNIQUE NULLS NOT DISTINCT per tenant+module+channel), module (the notification-category vocabulary + digest), channel (IN_APP/EMAIL/SMS/WHATSAPP), enabled, updated_by?; grants SELECT/INSERT/UPDATE/**DELETE** (tenant user data — users manage their own rows; the matrix CRUD surface) | 041 | no |
| `communication_log` | The unified interaction log (UX-14/IN-16): messages + manually logged calls per partner feeding the unified inbox | tenant_id, kind (MESSAGE/CALL — the kind↔channel CHECK pins CALL↔CALL), direction (INBOUND/OUTBOUND), channel (EMAIL/WHATSAPP/SMS/CALL), at, partner_id?, user_id?, counterparty?, summary?, body?, outcome? (CALL vocabulary — COMPLETED/NO_ANSWER/BUSY/VOICEMAIL/FAILED/SCHEDULED), duration_minutes? (0..1440), outbound_message_id? (ledger linkage), related_type?/related_id? (polymorphic document link), created_by?; a logged call records outcome + summary (CHECK); partner/at indexes (the inbox hot path); grants SELECT/INSERT/UPDATE (log semantics — DELETE rides the purge path only) | 041 | no |

## manufacturing execution (PHASE-042 — DELIVERED by migrations `0065_routing_work_centers.sql` + `0066_standard_costing.sql`, schema_version 66)

Manufacturing I — Routing, Work Centers & Costing (CR-12, extended by v3.1/CR-45 L2-12): the
multi-operation shop-floor substrate — work centers with per-shift capacity (hours) and fixed/var
hourly cost rates, versioned routings + sequenced operations (one ACTIVE per item, the BOM
discipline), the per-order frozen operation rows (the PENDING/SETUP/RUNNING/PAUSED/COMPLETED/SKIPPED
machine with actual-time capture and the setup/usage/rate variance columns), rework orders (cost
posts to REWORK_EXPENSE — never the parent FG layer, BR-069), reason-coded downtime records (the
OEE availability input; posting policy-gated BR-070, default OFF), and the per-item frozen standard
costs (L2-12: material/labor/overhead + sub-splits, roll-up over BOM + routing, one ACTIVE per
item). +7 tables + 2 security_invoker views (derived OEE facts — no source-of-truth rows, not in
the RLS suite) — the catalog count moves 232 → 239 (the RLS-suite parity gate checks the number).
+4 CoA purposes (5125 REWORK_EXPENSE · 5430 DOWNTIME_EXPENSE · 5990 PURCHASE_PRICE_VARIANCE · 5995
STANDARD_REVALUATION — the 0026 additive-marker pattern). Numbering note: the phase doc planned
≈0060…0066 — written before 039/040/041; 0065/0066 are the honest next slots (the 0064 D-1
precedent). Grants: master-data/document rows (SELECT/INSERT/UPDATE — version lifecycles, no
app-role DELETE, the 0026 manufacturing precedent).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `work_centers` | Work centers (M-03/H-04): where product flows — the capacity + rate datum of routing costing and OEE | tenant_id, code (tenant-unique, shape CHECK), name/name_ar, description?, capacity_per_shift numeric(7,2) HOURS (CHECK 0 < x ≤ 24), shifts_per_day smallint (1..6), fixed_cost_rate/var_cost_rate numeric(19,6) per hour (≥ 0), status (ACTIVE/INACTIVE), cost_center_id? (no FK — the job_cards precedent); grants SELECT/INSERT/UPDATE | 042 | no |
| `routings` | Versioned routings per item (M-02): DRAFT → ACTIVE → ARCHIVED with exactly one ACTIVE per item (the BOM discipline) | tenant_id, item_id (composite FK), version_no (tenant+item+version unique), status, output_uom_id (FK), note/note_ar, activated_at?/archived_at?; partial unique one ACTIVE per item (the uq_bills_of_materials_active_item pattern); grants SELECT/INSERT/UPDATE | 042 | no |
| `routing_operations` | Sequenced routing operations (M-02): setup_time hours per batch + run_time hours per unit on a work center | tenant_id, routing_id (composite FK), sequence (1..999, routing-unique), work_center_id (composite FK), setup_time/run_time numeric(19,6) (≥ 0), fixed_cost_rate?/var_cost_rate? (overrides travel together, NULL = inherit the work center), description/description_ar?, inspection_hook bool (reserved for PHASE-050); grants SELECT/INSERT/UPDATE | 042 | no |
| `production_order_operations` | The per-order frozen operation rows (M-02/M-17/M-18/M-13/M-19): the state machine + actual times + per-operation variances | tenant_id, order_id/routing_id/work_center_id (composite FKs), sequence (order-unique), status (PENDING/SETUP/RUNNING/PAUSED/COMPLETED/SKIPPED — the state-evidence CHECK: SKIPPED ⇒ skip_reason + skip_approved_by; COMPLETED ⇒ both timestamps; SETUP/RUNNING/PAUSED ⇒ started_at; PENDING ⇒ neither), std_setup_time/std_run_time/std_fixed_rate/std_var_rate (frozen at release), actual_setup_time/actual_run_time, setup_variance/usage_variance/rate_variance numeric(19,4) (computed at completion — M-13/M-19), operator_user_id?, started_at?/finished_at?, scrap_qty + scrap_reason_code? (M-12 statistical scrap — qty>0 ⇒ reason), skip_reason?/skip_approved_by?, journal_id? (the G-40 posting); order/work-center/variance indexes (OA-06); grants SELECT/INSERT/UPDATE | 042 | no |
| `rework_orders` | Rework orders (M-14): reference the defective batch/serial + parent order, own routing; cost posts to REWORK_EXPENSE — never the parent FG layer (BR-069) | tenant_id, rework_no? (RW- at release, partial-unique), parent_order_id (composite FK), item_id (FK), batch_id? (FK), defect_ref (1..120), qty (> 0), uom_id (FK), routing_id? (FK), status (DRAFT → RELEASED → IN_PROGRESS → COMPLETED/CANCELLED), std_* frozen + actual_* times, labor_value/overhead_value/rework_value numeric(19,4) (the G-41 roll-up), journal_id? (completion CHECK: journal + value > 0), defect_reason_code?, note/note_ar, timestamps + cancel_reason; grants SELECT/INSERT/UPDATE | 042 | no |
| `downtime_records` | Downtime records (M-15): the reason-coded OEE availability input + the non-value cost source (posting policy-gated BR-070, default OFF) | tenant_id, work_center_id (composite FK), order_id? + operation_sequence? (pair-or-neither CHECK), reason_code (closed vocabulary: PLAN_SETUP/BREAKDOWN/MAINTENANCE/MATERIAL_SHORTAGE/QUALITY_HOLD/POWER_OUTAGE/CHANGEOVER/OPERATOR_ABSENT/OTHER), started_at, ended_at? (open records carry no cost/journal — CHECK; ended ≥ started), duration_minutes (0..1440), cost_amount?/journal_id? (the G-42 posting when the policy opts in), note?; work-center + order indexes (OA-06); grants SELECT/INSERT/UPDATE (log semantics — DELETE rides the purge path only) | 042 | no |
| `item_standard_costs` | The frozen per-item standard cost (L2-12/CR-45): versioned by cost-type totals, one ACTIVE per item (the BOM discipline) | tenant_id, item_id (composite FK), version_no (tenant+item+version unique), status (DRAFT/ACTIVE/ARCHIVED), material_cost/labor_cost/overhead_cost/total_cost numeric(19,6) per unit (CHECK: total = the typed sum; costs ≥ 0), overhead_sub_splits jsonb `[{key, amount}]` (shape CHECK array; per-element validated at the service), source (MANUAL/ROLLED_UP — ROLLED_UP ⇒ rolled_up_at), effective_from?, activated_at?/archived_at?; partial unique one ACTIVE per item; grants SELECT/INSERT/UPDATE | 042 | no |
| `v_work_center_oee_daily` | Derived OEE facts per work center per day (M-16) — security_invoker (RLS rides through), NOT a source-of-truth table | tenant_id, work_center_id, day, planned_hours/actual_hours (std vs actual op times), scrap_qty, completed/skipped/total operations, downtime_minutes (the day's LATERAL fold) | 042 | n/a (view) |
| `v_work_center_oee_period` | Derived monthly OEE rollup (M-16) — the month's downtime derived INDEPENDENTLY from downtime_records (days without operations still count their downtime) | tenant_id, work_center_id, period_start, planned/actual hours, scrap, completed/skipped/total, downtime_minutes | 042 | n/a (view) |

## warehouse management — WMS (PHASE-044 — DELIVERED by migrations `0067_wms_locations.sql` … `0071_wms_seeds.sql`, schema_version 71)

WMS & Inventory Intelligence (CR-14, scope extended by v3.1/CR-46 — L1-20 returnable packaging): the
location substrate — zones/aisles/racks/bins with barcodes and pick sequence (one DEFAULT bin per
warehouse, BR-073), bin-level contents with AVAILABLE/QUARANTINE/HOLD status and the consignment owner
column (INV-029: Σ tenant-owned `bin_contents` = `item_stock` per warehouse/item, same-transaction
writes; `item_stock` stays the valuation authority — INV-010 untouched), license plates (LPNs), the
directed-operations family (putaway rules + the unified PICK/PUTAWAY task board + per-warehouse
strategies + waves), ABC-classified cycle counts, the append-only serial-movement ledger, transfer
pricing + transit exceptions + the shelf-life/slow-movement alert registration + warehouse kitting,
and the returnable-packaging container register with its deposit movement log. +22 tables — the
catalog count moves 239 → 261 (the RLS-suite parity gate checks the number). +4 CoA purposes
(4895 DEPOSIT_FORFEITURE · 1290 QUARANTINE_INVENTORY · 2135 CONSIGNATION_PAYABLE · 4990
TRANSFER_PRICING_ADJUSTMENT — the 0026/0065 additive-marker pattern; the deposit liability leg reuses
the EXISTING DEPOSITS_RECEIVED purpose, 2140 — D-2). Numbering note: the phase doc planned ≈0073…0081 —
written before implementation; PHASE-043 has NOT run (it requires THIS phase), so 0067…0071 are the
honest next slots (the 0064/0065 D-1 precedent). Grants: master data / document rows
(SELECT/INSERT/UPDATE — lifecycles, no app-role DELETE, the 0026 precedent); `bin_contents` is a
POSITION table; `serial_movements` + `returnable_packaging_movements` are append-only logs
(SELECT/INSERT only — the stock_moves discipline).

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `warehouse_zones` | WMS zones (H-07/I-01): the location-tree root — zone types (PICKING/BULK/QUARANTINE/DOCK/STAGE) are the putaway-rule vocabulary; one DEFAULT zone per warehouse | tenant_id, warehouse_id (composite FK), code (tenant+wh unique, shape CHECK), name/name_ar, zone_type, is_default (partial unique one per wh), note | 044 | no |
| `warehouse_aisles` | WMS aisles: zones contain aisles | tenant_id, zone_id (composite FK, CASCADE), code (tenant+zone unique), name/name_ar | 044 | no |
| `warehouse_racks` | WMS racks: aisles contain racks | tenant_id, aisle_id (composite FK, CASCADE), code (tenant+aisle unique), name/name_ar | 044 | no |
| `warehouse_bins` | WMS bins (I-01/I-02, DF-12): the leaf — the scan target (PP-11/DF-17) + NEAREST routing + the backfill anchor | tenant_id, warehouse_id (denormalized), rack_id (composite FK), code (tenant+wh unique), barcode (tenant-unique, shape CHECK), name/name_ar, pick_sequence (1..10⁶, nullable), capacity?, allow_mixed_batches, is_default (partial unique one per wh — BR-073), note | 044 | no |
| `lpns` | License plates / pallets (I-05): the movable grouping over bin_contents rows | tenant_id, lpn_code (tenant-unique), status (ACTIVE/CLOSED — CLOSED ⇒ closed_at, the state-evidence floor), closed_at?, note | 044 | no |
| `bin_contents` | The per-bin position (I-01/I-19/I-24, INV-029): one row per (bin, item, batch, serial, LPN, owner, status) slot — NULLS NOT DISTINCT; consignment rows (owner set) are the EXCLUDED set (never in item_stock/valuation/ATP, BR-076) | tenant_id, bin_id/warehouse_id/item_id (composite FKs), batch_id?/serial_id?/lpn_id?/owner_partner_id? (FKs), status (AVAILABLE/QUARANTINE/HOLD), qty ≥ 0, uom_id?, received_at, note; the pick/FEFO + INV-029 probe indexes (OA-06) | 044 | no |
| `returnable_packaging` | The container-TYPE register (L1-20, v3.1/CR-46): pallets/crates/containers with a deposit per unit | tenant_id, code (tenant-unique), packaging_type (PALLET/CRATE/CONTAINER/OTHER), name/name_ar, deposit_amount ≥ 0, item_id? (asset-item link, SET NULL), status (ACTIVE/RETIRED), note | 044 | no |
| `returnable_packaging_movements` 🔒 | The append-only packaging log (L1-20): ISSUE posts the deposit liability (the EXISTING DEPOSITS_RECEIVED purpose), RETURN releases it, WRITE_OFF posts the 4895 income leg | tenant_id, packaging_id (composite FK), kind (ISSUE/RETURN/WRITE_OFF), qty > 0, deposit_per_unit ≥ 0, partner_id?/delivery_id?/receipt_id?/journal_id?, moved_at, note | 044 | no |
| `putaway_rules` | The putaway condition engine (I-03, PP-12): priority-ordered condition → target zone type or exact bin; first active match wins on goods receipt | tenant_id, priority (1..1000, tenant-unique), name, condition jsonb (closed shape, service-validated), target_zone_type ⊕ target_bin_id (pair-or-neither CHECK), is_active, note | 044 | no |
| `pick_strategies` | Per-warehouse directed-pick method (I-04) | tenant_id, warehouse_id (unique per tenant), method (FIFO/FEFO/NEAREST), allow_partial, note | 044 | no |
| `pick_waves` | Pick waves grouping deliveries into routes (I-06): release snapshots the strategy | tenant_id, wave_no? (PW- at release, unique), warehouse_id, status (DRAFT/RELEASED/COMPLETED/CANCELLED — the state-evidence CHECKs), method? (the frozen snapshot), route_note, released_at?/completed_at? + the by stamps | 044 | no |
| `pick_tasks` | The unified PICK/PUTAWAY task board (I-07, PP-11/DF-17, OA-02 — the single sync surface, D-3): assignee, scan verification, progressive qty, the version column the field-sync conflict checks read (BR-074) | tenant_id, wave_id?, task_kind (PICK/PUTAWAY), status (PENDING/ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED), assignee_user_id?, item_id (FK), batch_id?/serial_id?/lpn_id?, qty > 0, qty_done ≤ qty, from_bin_id (PICK) / to_bin_id (PUTAWAY — the direction CHECK), source_type/source_id/source_line_no?, scan_verified, sequence_no?, completed_at?/completed_by? (COMPLETED ⇒ completed_at), note | 044 | no |
| `cycle_count_schedules` | ABC-frequency count schedules (I-08/I-20) | tenant_id, warehouse_id, name, class_a_days/class_b_days/class_c_days (1..N, ascending CHECK), approval_threshold ≥ 0 (BR-075), blind, is_active, last_run_at?, note | 044 | no |
| `cycle_count_documents` | The generated/manual count session (I-08 — the stock_counts shape, bin-aware); variances post through G-13/G-14 with CYCLE_COUNT reasons | tenant_id, count_no? (CC- at POST, unique), schedule_id?, warehouse_id, status (DRAFT/COUNTED/VARIANCE_REVIEW/POSTED/CANCELLED), snapshot_at, count_date?, blind, variance_loss_value?/variance_gain_value?, supervisor_override, counted_by?/approved_by?, posted_journal_id?, note/note_ar | 044 | no |
| `cycle_count_lines` | Per (item, bin) count lines with the frozen system-qty snapshot | tenant_id, document_id (composite FK, CASCADE), line_no, item_id (FK), bin_id?/batch_id? (FKs), system_qty ≥ 0, counted_qty?, recounted, recount_note?, value_impact?, reason (CYCLE_COUNT_LOSS/CYCLE_COUNT_GAIN at post) | 044 | no |
| `abc_classifications` | ABC classes computed from consumption value + velocity (I-09); is_latest is the one-row floor | tenant_id, item_id (composite FK), computed_at, window_days ≥ 1, class (A/B/C), consumption_value/total_qty_out/velocity ≥ 0, rank_no, is_latest (partial unique per item) | 044 | no |
| `serial_movements` 🔒 | The append-only per-serial ledger (I-16/I-18 — the audit's "serials without movements" gap closed): one row per serial per movement event | tenant_id, serial_id (composite FK), event (RECEIVE/PUTAWAY/PICK/TRANSFER_OUT/TRANSFER_IN/ADJUST_OUT/ADJUST_IN/RETURN/QUARANTINE/RELEASE/SCRAP/CONSIGNMENT_IN/CONSIGNMENT_OUT/KIT_IN/KIT_OUT/SETTLE), move_id? (stock_moves FK), source_type/source_id, from_bin_id?/to_bin_id?, moved_at, note; the serial-walk + source indexes (OA-06) | 044 | no |
| `transfer_pricing_policies` | Internal transfer pricing (I-23): per warehouse PAIR — MARKUP % or FIXED price; absent = the cost-carrying default | tenant_id, from_warehouse_id/to_warehouse_id (unique pair), mode (MARKUP/FIXED — the operand CHECK), markup_pct? (0..1000)/fixed_price? (≥ 0), note | 044 | no |
| `transit_exceptions` | Damaged/missing stock on an IN_TRANSIT transfer line (I-22): the exception + the shrinkage posting refs | tenant_id, transfer_id (composite FK, CASCADE), line_no, exception_kind (DAMAGE/MISSING), qty > 0, journal_id?/move_id? (resolved ⇒ journal — the state-evidence CHECK), resolved_at?/resolved_by?, note | 044 | no |
| `inventory_alert_jobs` | The shelf-life + slow-movement job registration (I-17/I-21/I-25): thresholds + the last-run stats | tenant_id, job_kind (SHELF_LIFE/SLOW_MOVEMENT — unique per tenant), shelf_life_days/slow_movement_days ≥ 1, is_active, last_run_at?, last_flagged, note | 044 | no |
| `warehouse_kit_orders` | Light kit assembly from bins without a production order (I-13): WK- at POST; the G-45 roll-up (kit = Σ components exactly) | tenant_id, kit_no? (unique), warehouse_id (FK), kit_item_id (FK), qty > 0, uom_id?, status (DRAFT/POSTED/CANCELLED — POSTED ⇒ kit_no+posted_at), total_component_cost?, posted_journal_id?/posted_at?/posted_by?, note/note_ar | 044 | no |
| `warehouse_kit_lines` | The kit component consumption with its bin + cost | tenant_id, order_id (composite FK, CASCADE), line_no, component_item_id (FK), qty > 0, unit_cost?/value_amount?, from_bin_id? (FK) | 044 | no |

## Diagrams

ER diagrams per domain cluster: [ERD/](ERD/) — tenancy-identity, accounting-core,
trade-inventory, treasury-tax, automotive-distribution, manufacturing, crm-projects.
Generated/refreshed per
phase (README sync rule).
