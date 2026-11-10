# Entity Catalog

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-11-07

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

## sales (PHASE-012; POS 016; job cards + commissions 017)

| Entity | Purpose | Key fields | Phase | OC |
|--------|---------|-----------|-------|----|
| `quotations` | Offers | tenant_id, customer_id, valid_until, status, lines, totals | 012 | no |
| `quotation_lines` | Offer lines (BR-003 resolution at create) | tenant_id, quotation_id, item_id, qty, unit_price, discount, tax_code_id, net/tax amounts | 012 | no |
| `sales_orders` | Confirmed orders | tenant_id, customer_id, branch_id, order_no, status, lines, reservations | 012 | no |
| `sales_order_lines` | Order lines + the optional soft-reservation reference | tenant_id, order_id, item_id, qty, unit_price, discount, tax_code_id, net/tax amounts, reservation_id | 012 | no |
| `delivery_notes` | Goods-out docs | tenant_id, order_id, warehouse_id, status, lines | 012 | no |
| `delivery_note_lines` | DN lines (issue-cost snapshot — the W-3 provenance) | tenant_id, delivery_id, order_line_id, item_id, qty, unit_price, net_amount, batch_id, serial_ids, issue_unit_cost, issue_value | 012 | no |
| `sales_invoices` | Billing docs | tenant_id, customer_id, branch_id, invoice_no, invoice_date, due_date, kind (CASH/CREDIT), currency, exchange_rate, totals, tax_summary, posted_journal_ids, status, offline_receipt_no?, einvoice_status, channel (STANDARD/POS), pos_terminal_id?, order_type? (DINE_IN/TAKEAWAY/DELIVERY/COUNTER), pos_table_id?, tenders jsonb (the cash/card split — G-02), job_card_id?/vehicle_id? (017 provenance — the card→invoice chain + per-vehicle history), owner_device_id? (020 — the OWNER_DEVICE_WINS drafts stamp, reassigned by the admin route), claim_ref? (031 — external insurer claim reference, captured only when a template policy activates it; null = self-pay) | 012 → 016 (POS channel columns) → 017 (job-card/vehicle provenance) → 020 (owner-device drafts) → 031 (healthcare claim_ref) | POS yes |
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

## Diagrams

ER diagrams per domain cluster: [ERD/](ERD/) — tenancy-identity, accounting-core,
trade-inventory, treasury-tax, automotive-distribution, manufacturing, crm-projects.
Generated/refreshed per
phase (README sync rule).
