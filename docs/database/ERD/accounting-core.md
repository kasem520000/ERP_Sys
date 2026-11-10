# ERD — Accounting Core Cluster

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-10-27 · **Phases:** 006–007

Core attributes only (full specs: [TABLES/core-accounting.md](../TABLES/core-accounting.md)).

```mermaid
erDiagram
  tenants ||--o{ accounts : "owns CoA"
  accounts ||--o{ accounts : "parent/children"
  accounts ||--o{ account_purposes : "mapped-to"
  accounts ||--o{ journal_lines : "posted-on"
  tenants ||--o{ fiscal_years : ""
  fiscal_years ||--o{ fiscal_periods : ""
  fiscal_periods ||--o{ journal_entries : "scoped-by"
  journal_entries ||--o{ journal_lines : ""
  journal_entries ||--o{ journal_entries : "reversal_of/reversed_by"
  tenants ||--o{ exchange_rates : ""
  tenants ||--o{ cost_centers : ""
  tenants ||--o{ recurring_journals : ""
  tenants ||--o{ approval_policies : ""

  accounts {
    uuid id PK
    text code UK_per_tenant
    text name
    text name_ar
    text type "ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE"
    uuid parent_id FK
    boolean is_postable
    text currency
    text status
  }
  account_purposes {
    uuid id PK
    text purpose_key UK_per_tenant_active
    uuid account_id FK
    date active_from
  }
  fiscal_years {
    uuid id PK
    date start_date
    date end_date
    text status
  }
  fiscal_periods {
    uuid id PK
    uuid fiscal_year_id FK
    date start_date
    date end_date
    text status "OPEN|SOFT_CLOSED|LOCKED"
  }
  journal_entries {
    uuid id PK
    text entry_no UK_per_tenant
    date entry_date
    uuid fiscal_period_id FK
    text currency
    numeric exchange_rate "19,8"
    text status "POSTED|REVERSED"
    text source_type
    uuid source_id
    text operation
    uuid reversal_of_id FK
    uuid reversed_by_id FK
    timestamptz posted_at
    uuid posted_by
  }
  journal_lines {
    uuid id PK
    uuid journal_entry_id FK
    int line_no
    uuid account_id FK
    text direction "debit|credit"
    numeric amount "19,4"
    numeric base_amount "19,4"
    uuid partner_id
    uuid item_id
    uuid cost_center_id
    uuid tax_code_id
    text memo
  }
  exchange_rates {
    uuid id PK
    text currency_code
    date rate_date
    numeric rate "19,8"
  }
  cost_centers {
    uuid id PK
    text code
    text name
    uuid parent_id
  }
  recurring_journals {
    uuid id PK
    jsonb template
    text schedule
    date next_run_date
    text status
  }
  approval_policies {
    uuid id PK
    text doc_type
    jsonb policy
  }
```

Key structural constraints: `journal_entries (id, tenant_id)` unique — enabling
composite tenant-scoped FK from `journal_lines`; unique `(tenant_id, source_type,
source_id, operation)` = **posting idempotency** (INV-013); `journal_lines` are
append-only (INV-003).
