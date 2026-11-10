# ERD — Trade & Inventory Cluster

> **Status:** DELIVERED (PHASE-006 master data) · **Owner:** Database Architecture · **Updated:** 2026-11-02 · **Phases:** 006, 010–012, 016 (POS core)

Core attributes only. Column-level specifications live in
[TABLES/trade-inventory.md](../TABLES/trade-inventory.md) (authored in PHASE-006) —
sync rule in [database README](../README.md#synchronization-rule-normative); the
Drizzle schema is the machine-readable mirror (migration 0009 + `db/schema.ts`).

```mermaid
erDiagram
  tenants ||--o{ partners : ""
  tenants ||--o{ credit_terms : ""
  credit_terms ||--o{ partners : "terms"
  partners ||--o{ partner_contacts : ""
  partners ||--o{ partner_addresses : ""
  partners ||--o{ partner_balances : "read model"
  price_lists ||--o{ partners : "customer list (BR-003)"
  branches ||--o{ price_lists : "default list (BR-003)"
  tenants ||--o{ opening_balance_docs : "DRAFT only"
  partners ||--o{ opening_balance_docs : "partner kind"
  tenants ||--o{ items : ""
  item_categories ||--o{ items : ""
  items ||--o{ barcodes : ""
  items ||--o{ item_warehouse_settings : ""
  uoms ||--o{ items : "base uom"
  uoms ||--o{ barcodes : "per-UoM"
  uom_conversions ||--o{ uoms : "from/to × factor (exact 19,6)"
  tenants ||--o{ uoms : "tenant-extendable (8 system seeds)"
  price_lists ||--o{ price_list_items : ""
  items ||--o{ price_list_items : ""
  uoms ||--o{ price_list_items : "tier unit"
  items ||--o{ opening_balance_docs : "stock kind"
  tenants ||--o{ file_objects : "attachments (002 infra / 006 usage)"
  partners ||--o{ file_objects : "PARTNER owner"
  items ||--o{ file_objects : "ITEM owner"
  tenants ||--o{ import_jobs : "preview-gated bulk import"
  partners ||--o{ partners : "P-000001… auto-code (BR-025)"
  tenants ||--o{ warehouses : ""
  branches ||--o{ warehouses : "hosts"
  items ||--o{ stock_moves : ""
  warehouses ||--o{ stock_moves : ""
  items ||--o{ stock_layers : ""
  items ||--o{ item_batches : ""
  items ||--o{ item_serials : ""
  tenants ||--o{ stock_counts : ""
  stock_counts ||--o{ stock_count_lines : ""
  warehouses ||--o{ stock_transfers : "from/to"
  partners ||--o{ sales_invoices : "customer"
  sales_invoices ||--o{ sales_invoice_lines : ""
  sales_invoices |o--o| pos_checks : "paid check → POS-channel invoice (016)"
  items ||--o{ sales_invoice_lines : ""
  sales_invoices ||--o{ credit_notes : "corrected-by"
  partners ||--o{ receipts : "customer"
  branches ||--o{ pos_terminals : "one per counter (016)"
  devices |o--o| pos_terminals : "one terminal = one device (016)"
  pos_terminals ||--o{ sales_invoices : "POS channel (016)"
  pos_tables ||--o{ pos_checks : "floor plan (016)"
  pos_checks ||--o{ pos_kitchen_tickets : "printed tickets (016)"
  partners ||--o{ purchase_orders : "supplier"
  purchase_orders ||--o{ goods_receipts : "received-by"
  goods_receipts ||--o{ stock_moves : "issues IN moves"
  purchase_orders ||--o{ supplier_invoices : "billed-by"
  partners ||--o{ payments : "payee"

  partners {
    uuid id PK
    text kind "CUSTOMER|SUPPLIER|BOTH"
    text code UK_per_tenant "P-000001 auto (BR-025)"
    text name
    text name_ar
    text tax_number
    numeric credit_limit "19,4 NULL=unlimited"
    uuid credit_terms_id FK
    uuid price_list_id FK
    text status
    timestamptz deleted_at "tombstone"
  }
  opening_balance_docs {
    uuid id PK
    text kind "PARTNER|ACCOUNT|STOCK"
    uuid partner_id FK
    uuid account_id FK
    uuid item_id FK
    numeric amount "19,4"
    numeric qty "19,6"
    numeric unit_cost "19,6"
    text status "CHECK-locked DRAFT (007 posts)"
  }
  partner_balances {
    uuid id PK
    uuid partner_id FK "unique per tenant"
    numeric open_balance "19,4"
    numeric draft_balance "19,4 DRAFTS_ONLY at 006"
    numeric overdue_amount "19,4"
  }
  items {
    uuid id PK
    text sku UK_per_tenant
    text name
    text name_ar
    text kind "STOCK|SERVICE|COMPOSITE"
    uuid uom_id FK
    text costing_method "WAC|FIFO"
    boolean track_batch
    boolean track_serial
    boolean has_expiry
    text status
  }
  warehouses {
    uuid id PK
    uuid branch_id FK
    text code
    text name
  }
  stock_moves {
    uuid id PK
    uuid item_id FK
    uuid warehouse_id FK
    text direction "IN|OUT"
    numeric qty "19,6"
    numeric unit_cost "19,6"
    text move_kind
    text source_type
    uuid source_id
    uuid batch_id
    timestamptz moved_at
  }
  stock_layers {
    uuid id PK
    uuid item_id FK
    uuid warehouse_id FK
    numeric remaining_qty "19,6"
    numeric unit_cost "19,6"
    uuid source_move_id FK
  }
  item_batches {
    uuid id PK
    uuid item_id FK
    text batch_no
    date expiry_date
  }
  sales_invoices {
    uuid id PK
    text invoice_no UK_tenant_branch
    uuid customer_id FK
    date invoice_date
    date due_date
    text kind "CASH|CREDIT"
    text channel "STANDARD|POS (016)"
    uuid pos_terminal_id FK "POS channel (016)"
    jsonb tenders "cash/card split (016)"
    text currency
    text status "DRAFT|PENDING_APPROVAL|APPROVED|POSTED|REVERSED"
    jsonb tax_summary
    text offline_receipt_no
  }
  sales_invoice_lines {
    uuid id PK
    uuid invoice_id FK
    uuid item_id FK
    numeric qty "19,6"
    numeric unit_price "19,6"
    numeric discount "19,4"
    jsonb tax_snapshot
    numeric tax_amount "19,4"
    numeric net_amount "19,4"
  }
  purchase_orders {
    uuid id PK
    text order_no
    uuid supplier_id FK
    text status
  }
  goods_receipts {
    uuid id PK
    text receipt_no
    uuid purchase_order_id FK
    uuid warehouse_id FK
    text status
  }
  supplier_invoices {
    uuid id PK
    text internal_no
    text supplier_invoice_no
    uuid supplier_id FK
    text match_result
    text status
  }
  pos_terminals {
    uuid id PK
    uuid branch_id FK
    uuid device_id FK "one terminal = one device"
    uuid cash_account_id FK "till (treasury CASH)"
    text code UK_per_tenant
    text receipt_size "80mm|58mm"
    text status "ACTIVE|INACTIVE"
  }
  pos_tables {
    uuid id PK
    uuid branch_id FK
    text zone
    text label
    int seats
    text status "FREE|OCCUPIED|RESERVED|OUT_OF_SERVICE"
  }
  pos_checks {
    uuid id PK
    text check_no UK_per_tenant
    uuid table_id FK
    text order_type "DINE_IN|TAKEAWAY|DELIVERY|COUNTER"
    text status "OPEN|PAID|CANCELLED"
    jsonb lines "working order — no ledger until paid"
    uuid invoice_id FK "set at payment (channel='POS')"
  }
  pos_kitchen_tickets {
    uuid id PK
    uuid check_id FK
    text ticket_no UK_per_tenant
    jsonb items
    text status "PRINTED|VOID"
  }
```

Atomicity note: document rows + `stock_moves` + journals commit in one transaction
(INV-018); `sales_invoices (id, tenant_id)` unique enables composite-scoped FKs.
