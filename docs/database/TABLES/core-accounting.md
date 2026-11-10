# TABLES — Accounting Core Cluster

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-10-27 · **Phases:** 007 (currencies seeded 002+)

Column-level specification for the accounting core, consistent with the
[ERD/accounting-core.md](../ERD/accounting-core.md) diagram,
[ENTITY_CATALOG.md](../ENTITY_CATALOG.md) §accounting,
[DATABASE_CONVENTIONS.md](../DATABASE_CONVENTIONS.md),
[DATA_DICTIONARY.md](../DATA_DICTIONARY.md) (standard columns, enums, money semantics),
[CONSTRAINTS_AND_INDEXES.md](../CONSTRAINTS_AND_INDEXES.md), and the domain rules in
[../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) (engine, CoA and
lifecycle documents). Drizzle schema
is the machine-readable mirror (sync rule). All tenant-owned tables carry the standard
columns block and RLS per conventions unless noted.

Standard columns (`id uuid PK UUIDv7`, `tenant_id`, `created_at`, `updated_at`,
`version`, `created_by` where a user actor exists) per
[DATABASE_CONVENTIONS.md](../DATABASE_CONVENTIONS.md) §5 — abbreviated below as
"**+standard**". Money is `numeric(19,4)`, rates `numeric(19,8)`, dates `date`,
timestamps `timestamptz` (ADR-0009).

## `currencies` — ISO currencies (global seed table)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `code` | char(3) | no | — | **PK** (natural) | ISO 4217 |
| `name` / `name_ar` | text | no / yes | — | — | Bilingual labels |
| `minor_units` | int | no | `2` | `CHECK (minor_units BETWEEN 0 AND 4)` | Rounding precision (KWD/BHD/OMR = 3) — drives ADR-0009 rounding |
| `symbol` | text | yes | — | — | Display symbol |
| `is_active` | boolean | no | `true` | — | Inactive codes rejected for new tenants |

Global reference table: **no `tenant_id`, no RLS**, read-only to `erp_app`
([TENANT_ISOLATION.md](../TENANT_ISOLATION.md) §3). Seeded via migrations, idempotent by
natural key ([SEEDS/README.md](../SEEDS/README.md)).

## `accounts` — chart-of-accounts nodes (PHASE-007)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | composite-FK anchor for `journal_lines`, `account_purposes` |
| `code` | text | no | — | `uq_accounts_tenant_code` | Per-tenant code (dictionary §12) |
| `name` / `name_ar` | text | no / yes | — | — | Bilingual name |
| `type` | text | no | — | ck: `ASSET \| LIABILITY \| EQUITY \| REVENUE \| EXPENSE` | Account type (drives statement mapping) |
| `parent_id` | uuid | yes | — | composite FK → `accounts(id, tenant_id)` (RESTRICT) | Tree; posting only on leaves |
| `is_postable` | boolean | no | `false` | — | Only leaf+postable accounts accept lines (INV-004) |
| `currency_code` | char(3) | yes | — | FK → `currencies.code` | NULL = any currency; set = currency-restricted (INV-005) |
| `status` | text | no | `ACTIVE` | ck: `ACTIVE \| ARCHIVED` | Archive blocked while postings/purposes reference it (INV-015) |

Notes: `ix_accounts_tenant_parent` for the tree; deletion is structurally impossible
(RESTRICT + lifecycle); [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) owns
the template and purpose rules.

## `account_purposes` — purpose → account mapping (PHASE-007)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | — | — |
| `purpose_key` | text | no | — | `uq_account_purposes_tenant_purpose_active` (partial, `active_to IS NULL`) | System role: `AR_CONTROL`, `AP_CONTROL`, `VAT_PAYABLE`, `VAT_RECOVERABLE`, `INVENTORY`, `COGS`, `SALES_REVENUE`, `ROUNDING_DIFFERENCE`, `FX_GAIN`, `FX_LOSS`, `RETAINED_EARNINGS`, … (catalog owned by posting engine module) |
| `account_id` | uuid | no | — | composite FK → `accounts(id, tenant_id)` (RESTRICT) | Mapped account |
| `active_from` | date | no | — | — | Effective date of the mapping |
| `active_to` | date | yes | — | — | NULL = current; set when superseded — history preserved for reports spanning the change |

## `fiscal_years` — tenant accounting years (PHASE-007)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | — | — |
| `name` | text | no | — | — | Label (e.g., "2026") |
| `start_date` / `end_date` | date | no / no | — | `CHECK (start_date <= end_date)`; `uq_fiscal_years_tenant_name` | Gregorian year per A-004 |
| `status` | text | no | `OPEN` | ck: `OPEN \| CLOSED` | Year-end closing → CLOSED after retained-earnings posting ([PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md)) |

## `fiscal_periods` — month periods (PHASE-007)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `tenant_id` denormalized for RLS (period scope derives via year) | — |
| `fiscal_year_id` | uuid | no | — | composite FK → `fiscal_years(id, tenant_id)` | — |
| `name` | text | no | — | — | e.g., "2026-01" |
| `start_date` / `end_date` | date | no / no | — | `CHECK (start_date <= end_date)`; `excl_fiscal_periods_no_overlap` | No overlapping periods inside a year |
| `status` | text | no | `OPEN` | ck: `OPEN \| SOFT_CLOSED \| LOCKED` | LOCKED rejects posting (INV-011); reopen is permissioned+audited (INV-020) |
| `closed_at` / `closed_by` | timestamptz / uuid | yes / yes | — | — | Audit of the closing action |

## `exchange_rates` — dated rates (PHASE-007)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | — | — |
| `currency_code` | char(3) | no | — | FK → `currencies.code`; `uq_exchange_rates_tenant_currency_date` | Document currency being rated |
| `rate_date` | date | no | — | — | Business date the rate applies to |
| `rate` | numeric(19,8) | no | — | `CHECK (rate > 0)` | **Base per 1 foreign** (dictionary §7); INV-008 |
| `source` | text | no | `'MANUAL'` | ck: `MANUAL \| IMPORTED` (extensible by decision record) | Provenance of the rate (import adapter later) |

## `journal_entries` — posted entries (PHASE-007, append-only 🔒)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)`; `uq_journal_entries_tenant_source_op` (INV-013) | — |
| `entry_no` | text | yes | — | `uq_journal_entries_tenant_entry_no` | Official journal number, assigned at posting (immutable, INV-021 pattern) |
| `entry_date` | date | no | — | — | Business date → fiscal period resolution (dictionary §11) |
| `fiscal_period_id` | uuid | no | — | composite FK → `fiscal_periods(id, tenant_id)` | Must resolve to a non-LOCKED period (INV-011, engine + trigger) |
| `currency_code` | char(3) | no | — | FK → `currencies.code` | Document currency |
| `exchange_rate` | numeric(19,8) | no | `1` | `CHECK (exchange_rate > 0)` | Base per 1 foreign; = 1 when base currency (INV-008) |
| `status` | text | no | `POSTED` | ck: `POSTED \| REVERSED` | Reversal = separate counter-entry, never an edit |
| `source_type` | text | no | — | — | `sales_invoice`, `receipt`, `stock_count`, `recurring`, … (provenance, [RELATIONSHIPS.md](../RELATIONSHIPS.md) §3) |
| `source_id` | uuid | yes | — | — | NULL for standalone manual entries; idempotency key applies when set |
| `operation` | text | no | — | — | `POST`, `REVERSE`, `ADJUST`, … (discriminator in the INV-013 key) |
| `reversal_of_id` | uuid | yes | — | composite self-FK (RESTRICT) | Counter-entry link |
| `reversed_by_id` | uuid | yes | — | composite self-FK (RESTRICT) | At most one reversal (INV-014) |
| `description` | text | yes | — | — | Header narrative (dictionary §10) |
| `posted_at` / `posted_by` | timestamptz / uuid | no / yes | now() / — | — | Posting transaction metadata; job-generated → `posted_by` NULL + audit carries correlation |

Append-only: no UPDATE/DELETE grants + guard triggers (INV-003). Hot indexes:
`(tenant_id, entry_date)`, `(tenant_id, account via lines)`, `(tenant_id, source_type,
source_id)` ([CONSTRAINTS_AND_INDEXES.md](../CONSTRAINTS_AND_INDEXES.md) §4).

## `journal_lines` — entry lines (PHASE-007, append-only 🔒)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** (no `updated_at` mutations — append-only) | — | — | — | — | — |
| `journal_entry_id` | uuid | no | — | composite FK → `journal_entries(id, tenant_id)` ON DELETE CASCADE | CASCADE = draft-entry cleanup only; posted parents are undeletable |
| `line_no` | int | no | — | `UNIQUE (journal_entry_id, line_no)` | Stable ordering for statements/printing |
| `account_id` | uuid | no | — | composite FK → `accounts(id, tenant_id)` (RESTRICT) | Must be leaf+postable+active (INV-004) |
| `direction` | text | no | — | ck: `DEBIT \| CREDIT` | Side; magnitude stays positive |
| `amount` | numeric(19,4) | no | — | `CHECK (amount > 0)` | Document currency (dictionary §6) |
| `base_amount` | numeric(19,4) | no | — | `CHECK (base_amount > 0)` | `amount × exchange_rate` as stored (INV-008) |
| `partner_id` | uuid | yes | — | composite FK → `partners(id, tenant_id)` | **Required** when the account holds an AR/AP control purpose (INV-009) |
| `item_id` | uuid | yes | — | composite FK → `items(id, tenant_id)` | Inventory/COGS analysis dimension (INV-010 reconciliation) |
| `cost_center_id` | uuid | yes | — | composite FK → `cost_centers(id, tenant_id)` | Analytical dimension |
| `tax_code_id` | uuid | yes | — | composite FK → `tax_codes(id, tenant_id)` | Tax traceability for VAT return cross-checks (INV-012) |
| `memo` | text | yes | — | — | Line-level free text (dictionary §10) |

Balanced-entry trigger + engine validation #7 (INV-001/002); immutability triggers
(INV-003); hot indexes per [CONSTRAINTS_AND_INDEXES.md](../CONSTRAINTS_AND_INDEXES.md) §4.

## `cost_centers` — analytical dimension (PHASE-007 basic)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | — | — |
| `code` | text | no | — | `uq_cost_centers_tenant_code` | Per-tenant code |
| `name` / `name_ar` | text | no / yes | — | — | Bilingual name |
| `parent_id` | uuid | yes | — | composite self-FK (RESTRICT) | Optional tree |
| `is_active` | boolean | no | `true` | — | Inactive centers reject new lines |

## `recurring_journals` — recurrence definitions (PHASE-007)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | — | — |
| `name` | text | no | — | — | Human label |
| `template` | jsonb | no | — | — | Draft entry payload (lines, accounts, amounts or formulas) validated by the engine module — amounts never live here authoritative: the generated entry is a real `journal_entry` |
| `schedule` | text | no | — | cron-like spec validated by module | Generation schedule |
| `next_run_date` | date | no | — | — | Worker picks due definitions; generation posts via the engine (INV-013 idempotency per run) |
| `last_run_at` | timestamptz | yes | — | — | Observability of the schedule |
| `status` | text | no | `ACTIVE` | ck: `ACTIVE \| PAUSED` | Paused stops generation without losing definition |

## `approval_policies` — per-doc-type approval rules (PHASE-007)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | — | — |
| `doc_type` | text | no | — | `UNIQUE (tenant_id, doc_type, applies_from)` — current policy per type | `sales_invoice`, `receipt`, `expense`, … |
| `policy` | jsonb | no | — | — | Thresholds, approver roles, auto-post flags (e.g., `cash_sales_autopost`) — the lifecycle engine reads this to route DRAFT→PENDING_APPROVAL→APPROVED ([DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §1) |
| `applies_from` | date | no | — | — | Policy versioning: old rows retained for audit of past decisions |
| `is_active` | boolean | no | `true` | — | Deactivate = revert to default (no-approver) path |

**Cross-cluster notes:** `journal_entries.source_type/source_id` link back to the trade
documents (PHASE-008/010/011/012 — see [ERD/treasury-tax.md](../ERD/treasury-tax.md),
[ERD/trade-inventory.md](../ERD/trade-inventory.md)); purpose-key resolution rules and
validation order live in [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md); nothing in
this cluster may be mutated by configuration (INV-022).
