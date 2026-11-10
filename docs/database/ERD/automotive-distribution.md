# ERD — Automotive & Distribution Cluster (PHASE-017)

> **Status:** DELIVERED (PHASE-017, migration `0025_automotive_distribution.sql`) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-02 · **Phases:** 017

Core attributes only. Column-level specifications live in
[TABLES/automotive-distribution.md](../TABLES/automotive-distribution.md) (authored in
PHASE-017) — sync rule in [database README](../README.md#synchronization-rule-normative);
the Drizzle schema is the machine-readable mirror (migration 0025 + `db/schema.ts`).

```mermaid
erDiagram
  partners ||--o{ vehicles : "per-partner registry (017)"
  vehicles |o--o{ job_cards : "checked-in vehicle"
  partners ||--o{ job_cards : "customer"
  branches ||--o{ job_cards : ""
  warehouses ||--o{ job_cards : "parts source"
  job_cards ||--o{ job_card_lines : ""
  items ||--o{ job_card_lines : "PARTS stock-kind / LABOR service-kind"
  quotations |o--o{ job_cards : "diagnosis quote (BR-006)"
  job_cards |o--o| sales_invoices : "invoiced-by (provenance cols)"
  vehicles |o--o{ sales_invoices : "per-vehicle history (017)"
  job_cards |o--o{ credit_notes : "warranty note (W-3 re-entry)"
  sales_reps ||--o{ commission_runs : "run basis (INVOICED|COLLECTED)"
  commission_runs ||--o{ commission_run_lines : "one row per run x rep"
  sales_reps ||--o{ commission_run_lines : "per-rep math + payout"
  sales_reps ||--o{ routes : "assigned rep"
  warehouses |o--o{ routes : "van binding (VAN-type)"
  routes ||--o{ route_customers : "composition (visit order)"
  partners ||--o{ route_customers : "route customers"
  routes ||--o{ route_visits : "planned per day-pattern"
  partners ||--o{ route_visits : "visited customer"
  route_visits |o--o| sales_invoices : "completion link (EXISTS-validated)"
  route_visits |o--o| credit_notes : "completion link"
  route_visits |o--o| receipts : "completion link (collection)"
  warehouses ||--o{ van_stocks : "VAN slice mirror"
  items ||--o{ van_stocks : ""
  warehouses ||--o{ stock_moves : "load-out/unload are transfers (TRN-)"
  price_lists |o--o{ customer_tiers : "tier price list (BR-003 level)"
  customer_tiers |o--o{ free_goods_rules : "tier-scoped promotions"
  customer_tiers |o--o{ partners : "assignment (partners.customer_tier_id)"
  items ||--o{ free_goods_rules : "buy/get items"
  sales_reps ||--o{ rep_settlements : "day lock (rep, date)"
  warehouses |o--o{ rep_settlements : "van context"
  rep_settlements ||--o{ rep_settlement_lines : "signed component ledger"
  sales_reps ||--o{ sales_invoices : "rep attribution (cash sales feed settlements)"

  vehicles {
    uuid id PK
    uuid partner_id FK
    text make
    text model
    int model_year
    text chassis_no UK_tenant_partial "VIN shape"
    text plate_no
    numeric odometer_km "12,1"
    date odometer_at
    text status "ACTIVE|ARCHIVED"
  }
  job_cards {
    uuid id PK
    text card_no UK_tenant "JC-"
    uuid customer_id FK
    uuid vehicle_id FK
    uuid warehouse_id FK
    text parts_issue_mode "reserve|issue_immediate"
    text status "DRAFT|IN_PROGRESS|COMPLETED|INVOICED|CANCELLED"
    uuid quotation_id FK
    uuid invoice_id FK
    uuid credit_note_id FK
    numeric labor_hours_total "19,6"
  }
  job_card_lines {
    uuid id PK
    uuid job_card_id FK
    int line_no
    text line_type "PARTS|LABOR"
    uuid item_id FK
    numeric qty "19,6"
    numeric estimated_hours "19,6 LABOR billing"
    numeric logged_hours "19,6"
    text status "PENDING|RESERVED|ISSUED|INVOICED|CANCELLED"
    uuid reservation_id FK "JOB_CARD hold"
    numeric issue_unit_cost "19,6 snapshot"
    uuid issue_journal_id FK
    uuid invoice_line_id FK "port-stamped mapping"
  }
  commission_runs {
    uuid id PK
    date period_from
    date period_to
    text basis "INVOICED|COLLECTED"
    text status "DRAFT|POSTED|CANCELLED"
    numeric total_base "19,4"
    numeric total_commission "19,4"
    uuid journal_entry_id FK "accrual at post"
  }
  commission_run_lines {
    uuid id PK
    uuid run_id FK
    uuid sales_rep_id FK "unique per run"
    numeric base_amount "19,4"
    numeric rate_applied "7,4 effective for tiered"
    numeric commission_amount "19,4"
    jsonb detail "bands + components + excluded"
    text payout_status "ACCRUED|PAID"
  }
  routes {
    uuid id PK
    text code UK_tenant
    uuid sales_rep_id FK
    uuid van_warehouse_id FK "VAN-type"
    jsonb day_pattern "MON..SUN subset"
    text status "ACTIVE|INACTIVE"
  }
  route_visits {
    uuid id PK
    uuid route_id FK
    uuid customer_id FK
    date planned_date
    text status "PLANNED|COMPLETED|SKIPPED|MISSED"
    uuid sales_invoice_id FK "completion links"
    uuid credit_note_id FK
    uuid receipt_id FK
  }
  van_stocks {
    uuid id PK
    uuid warehouse_id FK "VAN-type"
    uuid item_id FK
    uuid batch_id FK
    numeric qty "19,6 mirror"
    numeric value "19,4 WAC carried"
    timestamptz refreshed_at
  }
  customer_tiers {
    uuid id PK
    text code UK_tenant
    uuid price_list_id FK "SALE-kind"
    numeric discount_cap_pct "5,2"
    int visit_frequency_days
    text status "ACTIVE|INACTIVE"
  }
  free_goods_rules {
    uuid id PK
    text code UK_tenant
    uuid buy_item_id FK
    numeric buy_qty "19,6"
    uuid get_item_id FK
    numeric get_qty "19,6"
    uuid tier_id FK "null = all customers"
    text reason_code "BR-008"
    date valid_from
    date valid_to
  }
  rep_settlements {
    uuid id PK
    text settlement_no UK_tenant "STL-"
    uuid sales_rep_id FK
    uuid van_warehouse_id FK
    date settlement_date "day lock (rep, date)"
    text status "DRAFT|COUNTED|APPROVED|POSTED|CANCELLED"
    numeric expected_cash "19,4"
    numeric counted_cash "19,4"
    numeric variance "19,4 signed"
    text variance_direction "SHORTAGE|SURPLUS|NONE"
    uuid variance_journal_id FK "always posts BR-021"
    uuid deposit_journal_id FK
  }
  rep_settlement_lines {
    uuid id PK
    uuid settlement_id FK
    int line_no
    text component "OPENING_CASH|CASH_SALE|COLLECTION|CASH_REFUND|REP_EXPENSE|VARIANCE|BANK_DEPOSIT"
    numeric amount "19,4 signed"
    uuid source_id "document ref"
  }
```

Atomicity notes: settlement variance/deposit journals + `cash_movements` legs and the
`job_card:issue_parts` COGS journal + `job_card`-sourced stock move each commit in one
transaction with their documents (INV-018); `commission_run:accrual` posts through the
centralized engine exactly once (INV-013). `warehouses.type='VAN'` rows live in the
inventory-owned table (the additive VAN slice) — van load-out/unload are ordinary
`stock_transfers`, and `van_stocks` is the read-model mirror (never a second ledger).
