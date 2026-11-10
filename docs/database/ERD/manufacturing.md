# ERD — Manufacturing Cluster (PHASE-018)

> **Status:** DELIVERED (PHASE-018, migration `0026_manufacturing.sql`) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-02 · **Phases:** 018

Core attributes only. Column-level specifications live in
[TABLES/manufacturing.md](../TABLES/manufacturing.md) (authored in PHASE-018) —
sync rule in [database README](../README.md#synchronization-rule-normative);
the Drizzle schema is the machine-readable mirror (migration 0026 +
`db/schema.ts`).

```mermaid
erDiagram
  items ||--o{ bills_of_materials : "versioned recipe (one ACTIVE)"
  uoms ||--o{ bills_of_materials : "output UoM"
  bills_of_materials ||--o{ bom_lines : "components (DELETE: DRAFT replace)"
  items ||--o{ bom_lines : "component items"
  uoms ||--o{ bom_lines : "component UoM"
  branches ||--o{ production_orders : "per-branch PRD series"
  bills_of_materials |o--o{ production_orders : "bound at release"
  items ||--o{ production_orders : "the FG item (one per order)"
  uoms ||--o{ production_orders : "output UoM"
  warehouses ||--o{ production_orders : "materials warehouse"
  warehouses ||--o{ production_orders : "FG warehouse"
  production_orders ||--o{ production_order_lines : "frozen level-1 snapshot"
  items ||--o{ production_order_lines : "component items"
  production_orders ||--o{ production_consumptions : "batch-linked issues"
  items ||--o{ production_consumptions : "consumed components"
  item_batches |o--o{ production_consumptions : "material batch (genealogy upstream)"
  production_orders ||--o{ production_scraps : "reason-coded WIP scrap"
  production_orders |o--o{ inspections : "QC target (production_order)"
  goods_receipts |o--o{ inspections : "QC target (goods_receipt)"
  production_orders |o--o| item_batches : "produced-batch provenance (fg_batch_id + item_batches.production_order_id)"
  warehouses ||--o{ stock_moves : "consume/completion moves (production_order source)"

  bills_of_materials {
    uuid id PK
    uuid item_id FK
    int version_no UK_tenant_item_version
    text status "DRAFT|ACTIVE|ARCHIVED (one ACTIVE per item)"
    uuid output_uom_id FK
    numeric yield_pct "7,4 CHECK 0<y<=100"
    date effective_from
  }
  bom_lines {
    uuid id PK
    uuid bom_id FK
    int line_no UK_bom_line
    uuid component_item_id FK
    uuid uom_id FK
    numeric qty_per_output "19,6 > 0"
    numeric scrap_pct "7,4 >= 0"
  }
  production_orders {
    uuid id PK
    text order_no UK_tenant "PRD-{yyyy}-{seq:5}"
    uuid branch_id FK
    text status "DRAFT|RELEASED|IN_PROGRESS|COMPLETED|CANCELLED"
    uuid bom_id FK "bound at release"
    uuid item_id FK
    uuid uom_id FK
    numeric planned_qty "19,6 > 0"
    numeric actual_qty "19,6"
    uuid materials_warehouse_id FK
    uuid fg_warehouse_id FK
    numeric labor_rate "19,6"
    numeric overhead_rate "19,6"
    uuid cost_center_id "no FK (job_cards precedent)"
    numeric yield_snapshot "7,4"
    uuid fg_batch_id "completion stamp"
    uuid fg_journal_id "completion journal"
    numeric fg_value "19,4"
    numeric wip_credit_value "19,4"
    numeric labor_value "19,4"
    numeric overhead_value "19,4"
    text cancel_reason "CANCELLED => reason + cancelled_at"
  }
  production_order_lines {
    uuid id PK
    uuid order_id FK
    int line_no UK_order_line
    uuid component_item_id FK
    uuid uom_id FK
    numeric planned_qty "19,6"
    numeric scrap_pct "7,4"
    numeric actual_qty "19,6"
    boolean over_plan "variance review flag (once)"
  }
  production_consumptions {
    uuid id PK
    uuid order_id FK
    uuid item_id FK
    uuid batch_id "genealogy upstream edge"
    numeric qty "19,6 > 0"
    numeric unit_cost "19,6 >= 0"
    numeric value "19,4 > 0"
    uuid journal_id "consume journal anchor"
    timestamptz consumed_at
  }
  production_scraps {
    uuid id PK
    uuid order_id FK
    text reason_code "1..40"
    numeric qty "19,6 > 0"
    numeric value "19,4 > 0 (<= WIP, service-enforced)"
    uuid journal_id "scrap journal anchor"
    timestamptz scrapped_at
  }
  inspections {
    uuid id PK
    text target_type "production_order|goods_receipt"
    uuid order_id FK "production_order target"
    uuid grn_id FK "goods_receipt target"
    uuid fg_batch_id "quarantine subject"
    text result "PASS|FAIL"
    boolean sampled
    int sample_size
    text disposition "ACCEPT|SCRAP|REWORK|RETURN_TO_SUPPLIER (required on FAIL)"
    timestamptz inspected_at
  }
```

Atomicity notes: the consume journal (`production_order:consume`), the scrap
journal (`production_order:scrap`), and the completion journal
(`production_order:complete` — DR FG inventory · CR WIP · CR
PRODUCTION_LABOR/PRODUCTION_OVERHEAD when rates > 0) each commit in ONE
transaction with their stock moves and documents (INV-018) through the
centralized posting engine (INV-013 idempotency anchors). Pre-completion
scrap posts NO stock move (stock left at consumption); the QC-fail
post-completion scrap (qc_scrap) issues the whole quarantined batch on-hand
from the FG warehouse. Genealogy is read-only — it never writes; the sales
edges it walks live in `stock_moves` (source_type `sales_invoice`/
`delivery_note`), inventory-owned.
