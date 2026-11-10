# TABLES — Trade & Inventory Cluster (Master Data)

> **Status:** DELIVERED (PHASE-006, migration 0009) · **Owner:** Database Architecture · **Updated:** 2026-10-29 · **Phases:** 006 (master data) / 010–012 (documents)
>
> Column-level specifications for the PHASE-006 master-data cluster, authored in-phase
> per the ENTITY_CATALOG note ("later-phase specs complete in their phase"). Warehouse/stock
> tables (PHASE-010) and document tables (PHASE-011/012) extend this file in their phases.
> The Drizzle schema mirror is `apps/api/src/db/schema.ts` (sync rule, database README);
> RLS is the standard macro (`erp.apply_tenant_policy`) on every table here — proven by the
> generated A1–A10 suite (168 tests) over the isolation registry.

## §partners — unified customer/supplier directory (BR-025)

**`partners`** — one row per business partner; `kind` is the role lens (customers,
suppliers, or both — kind changes are blocked once postings exist per BR-025).

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `id` | uuid PK | app-generated UUIDv7 (ADR-0006) |
| `tenant_id` | uuid NOT NULL | FK tenants (RESTRICT); macro RLS; composite anchor `uq_partners_id_tenant (id, tenant_id)` |
| `created_at` / `updated_at` / `version` | timestamptz / timestamptz / int | standard columns (DATABASE_CONVENTIONS §5); `version` drives 409 STALE_VERSION optimistic locking |
| `kind` | text NOT NULL | CHECK `('CUSTOMER','SUPPLIER','BOTH')` |
| `code` | text NOT NULL | tenant-unique (`uq_partners_tenant_code`); CHECK `^[A-Za-z0-9_-]{1,20}$`; auto-numbered `P-000001…` by the service (BR-025) via a per-tenant advisory lock |
| `name` / `name_ar` | text NOT NULL / text | bilingual pattern (§4: name NOT NULL, name_ar nullable); 1–200 chars |
| `tax_number` | text | CHECK `^[0-9A-Za-z-]{5,30}$` |
| `credit_limit` | numeric(19,4) NULL | ADR-0009 money; NULL = unlimited (BR-001); CHECK ≥ 0 |
| `credit_terms_id` | uuid NULL | composite FK → credit_terms (RESTRICT) |
| `price_list_id` | uuid NULL | composite FK → price_lists (RESTRICT) — BR-003 level 1 |
| `status` | text NOT NULL | CHECK `('ACTIVE','INACTIVE','ARCHIVED')` |
| `deleted_at` | timestamptz NULL | tombstone (soft-delete policy); CHECK: deleted → status ARCHIVED |

Indexes: `ix_partners_tenant_kind`, `ix_partners_tenant_status`, `ix_partners_tenant_credit_terms`,
`ix_partners_name_trgm` — GIN `(tenant_id, name gin_trgm_ops, name_ar gin_trgm_ops)` (§8.5 AR+EN search).

**`partner_contacts`** — `id, tenant_id (anchor), partner_id (composite FK → partners), name
(1–200), phone (CHECK `^\+?[0-9]{6,20}$`), email (shape CHECK), role, is_primary boolean`;
index `ix_partner_contacts_tenant_partner`.

**`partner_addresses`** — `id, tenant_id, partner_id (composite FK), type CHECK
('BILLING','SHIPPING','OTHER'), line1 (1–300), line2, city, country_code (FK countries,
RESTRICT), geo jsonb`; index `ix_partner_addresses_tenant_partner`.

## §credit_terms — payment terms (BR-026)

**`credit_terms`** — `id, tenant_id (anchor), code` (tenant-unique, CHECK `^[A-Z0-9_-]{1,20}$`),
`name / name_ar`, `days int CHECK 0..365`, `description`, `is_system boolean` — the seeded
NET-7/15/30/60 rows are read-only (service-enforced; `SystemCreditTermsImmutableError`).
BR-026 semantics: due dates are computed at document creation (PHASE-007/011/012 read the
terms then); existing documents never move. Seeded per tenant at onboarding
(`seedMasterDataBasics`, mirroring the migration 0009 backfill).

## §items — item master

**`item_categories`** — bilingual tree: `code` tenant-unique, `name/name_ar`, `parent_id`
composite self-FK (RESTRICT), `status ('ACTIVE','ARCHIVED')`; cycle-freedom is a service
invariant (ancestor walk rejects descendants as parents). Default tax codes ride on
categories from PHASE-009.

**`items`** — one row per SKU:

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `sku` | text NOT NULL | tenant-unique; CHECK `^[A-Za-z0-9._-]{1,40}$` |
| `name` / `name_ar` | text NOT NULL / text | bilingual; 1–200 |
| `kind` | text NOT NULL | CHECK `('STOCK','SERVICE','COMPOSITE')` |
| `uom_id` | uuid NOT NULL | composite FK → uoms (base unit) |
| `category_id` | uuid NULL | composite FK → item_categories |
| `tax_code_id` | uuid NULL | **NO FK — expand-migrate-contract**: `tax_codes` lands in PHASE-009 which adds the FK + validation (MIGRATION_STRATEGY §3); UI hides the field until then |
| `costing_method` | text NOT NULL DEFAULT 'WAC' | CHECK `('WAC','FIFO')`; stored now, enforced from PHASE-010 (decisions/accounting DR-001) |
| `track_batch` / `track_serial` / `track_imei` / `has_expiry` | boolean NOT NULL DEFAULT false | CHECK: expiry ⇒ batch; tracking only on STOCK (BR-INV-04 decoupling) |
| `reorder_level` / `reorder_qty` | numeric(19,6) NULL | quantities as decimal strings over the API (ADR-0009); CHECK ≥ 0 |
| `base_price` | numeric(19,6) NULL | CHECK ≥ 0; the BR-003 last-resort price level |
| `status` / `deleted_at` | text / timestamptz | lifecycle mirrors partners (archive tombstone) |

Indexes: `ix_items_tenant_kind`, `ix_items_tenant_category`, `ix_items_tenant_status`,
`uq_items_tenant_sku`, `ix_items_name_trgm` (GIN tenant-first trigram, AR+EN).

**`barcodes`** — `item_id` + `uom_id` composite FKs, `code` CHECK `^[0-9A-Za-z_-]{1,64}$`;
**tenant-wide scan-unique** `uq_barcodes_tenant_code` (a barcode never maps to two items)
+ per-item-per-UoM unique `uq_barcodes_tenant_item_uom_code`.

## §uoms — units of measure (T2 exact conversions)

**`uoms`** — `code` tenant-unique (CHECK `^[A-Za-z0-9_-]{1,10}$`), `name/name_ar`,
`is_system boolean` (the 8 common units PCS/KG/G/L/BOX/CTN/M/HR are seeded read-only at
onboarding), `is_active`. **`uom_conversions`** — `from_uom_id`/`to_uom_id` composite FKs,
`factor numeric(19,6) CHECK > 0`, unique per ordered pair, CHECK from ≠ to; the seeded
universal pair is kg↔g only (box/carton factors are tenant-specific — never fabricated).
Chain resolution is BFS with exact decimal multiplication (domain-core `Decimal`); the
property test proves compose-exactly (zero 6-dp drift).

## §price_lists — pricing (BR-003)

**`price_lists`** — `name/name_ar`, `kind CHECK ('SALE','PURCHASE')`, `currency_code` FK
currencies (service enforces tenant base at this phase), `valid_from`/`valid_to` dates
(CHECK to ≥ from; service enforces "active on date"), `status ('ACTIVE','INACTIVE')`.
**`price_list_items`** — tiers: `price_list_id`/`item_id`/`uom_id` composite FKs,
`unit_price numeric(19,6) CHECK ≥ 0`, `min_qty numeric(19,6) CHECK > 0 DEFAULT 1`, unique
per `(list, item, uom, min_qty)`. Resolution precedence (BR-003): **customer's price list →
customer-tier list (distribution, PHASE-017) → branch default list
(`branches.default_price_list_id`, migration 0009) → item base price**, each with
per-request provenance (source level, applied UoM, exact conversion factor, override
allowance flag `sales.price_override_allowed`).

## §opening_balance_docs — DRAFT capture (G-16 source; zero posting)

**`opening_balance_docs`** — `kind CHECK ('PARTNER','ACCOUNT','STOCK')` with typed target
columns (`partner_id`/`account_id`/`item_id` composite FKs) + shape CHECKs making
cross-kind pollution structurally impossible; `amount numeric(19,4)` (partner/account) or
`qty`+`unit_cost numeric(19,6)` (stock); `currency_code` FK currencies (service enforces
tenant base); `note`; `status text NOT NULL DEFAULT 'DRAFT'` **CHECK-locked to 'DRAFT'** —
the schema-level zero-posting boundary (PHASE-007 widens it when the posting engine lands;
stock drafts post in PHASE-010). One DRAFT per target: partial uniques per kind
(`uq_obd_tenant_partner/account/item`). Sign conventions (validated for future postability):
CUSTOMER drafts positive (AR debit), SUPPLIER drafts negative (AP credit), BOTH either;
account drafts are signed balances consumed by PHASE-007's balanced-entry check.

## §partner_balances — read model (MODULE_BOUNDARIES: partners-owned)

`partner_id` composite FK unique per tenant; `open_balance`, `draft_balance`,
`overdue_amount` numeric(19,4); `last_recomputed_at`. At this phase `draft_balance` reflects
opening-balance DRAFT sums only; open/overdue stay 0 until PHASE-007/008/012 — every UI
surface labels the basis honestly (DRAFTS_ONLY).

## §file_objects — attachments (ENTITY_CATALOG: 002 infra / 006 usage)

`owner_type CHECK ('PARTNER','ITEM','OPENING_BALANCE_DOC')`, `owner_id uuid` (existence
validated by the owning controller), `storage_key` tenant-prefixed + tenant-unique (A11:
the files module re-verifies the prefix on every URL issuance), `name` (sanitized ≤200,
Arabic-safe U-06), `size_bytes bigint CHECK > 0`, `content_type` (allow-listed at issuance
U-01), `checksum`, `uploaded_by`, `deleted_at` (tombstone — `files.manage` never row-deletes).

## §import_jobs — preview-gated bulk import state (ADR-0008)

`kind CHECK ('PARTNERS','ITEMS','OPENING_BALANCES')`, `format CHECK ('CSV','XLSX')`,
`upload_token` tenant-unique (idempotency: same token → same job), `file_key`, `file_name`,
`status CHECK ('PREVIEWING','PREVIEW_READY','COMMITTING','COMMITTED','FAILED')`,
row counters (`total/valid/invalid/duplicate/committed_rows`), `report jsonb` (the
deterministic row-level dry-run artifact), `error`, `committed_at`, `created_by`. The
commit runs as a bounded tenant-scoped pg-boss job claiming PREVIEW_READY → COMMITTING
atomically (concurrent duplicate commits conflict; post-COMMITTED replays are idempotent).

## Grants & roles (migration 0009)

All fifteen tables: `REVOKE ALL FROM erp_app` then `GRANT SELECT, INSERT, UPDATE` (no
DELETE — lifecycle is archive tombstones + RESTRICT FKs; `files.manage` delete is a
tombstone); `GRANT SELECT TO erp_readonly`; definer read surface for the support proxy.
Seeds: per-tenant uoms + NET-N terms + kg↔g (idempotent by natural key; the onboarding
instantiator mirrors the migration backfill for post-0009 tenants).

---

# TABLES — Inventory & Warehousing Cluster (PHASE-010)

> **Status:** DELIVERED (PHASE-010, migrations 0014/0015) · **Owner:** Database Architecture ·
> **Updated:** 2026-10-30 · Column-level specs for the PHASE-010 cluster, authored in-phase per
> the file header rule. ADR-0009 precision discipline throughout: quantities and unit costs are
> `numeric(19,6)` (6-decimal internal), money quanta `numeric(19,4)`. `stock_moves` is the
> platform's only other append-only table besides `audit_events`/`cash_movements` (grants +
> guard trigger — INV-010/INV-017). RLS macro on all thirteen tables; the isolation registry
> covers each (A1–A11).

## §warehouses — stock locations under the branch registry (§2.1)

**`warehouses`** — one row per physical stock location, linked to a PHASE-004 branch
(van warehouses are PHASE-017 and never created here).

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `id` | uuid PK | app-generated UUIDv7; composite anchor `uq_warehouses_id_tenant` |
| `tenant_id` | uuid NOT NULL | FK tenants (RESTRICT); macro RLS |
| `created_at` / `updated_at` / `version` / `created_by` | standard | §5 columns; `version` drives optimistic locking |
| `branch_id` | uuid NOT NULL | composite FK → branches (RESTRICT) — per-branch visibility reads this |
| `code` | text NOT NULL | tenant-unique; CHECK `^[A-Za-z0-9_-]{1,20}$` |
| `name` / `name_ar` | text NOT NULL / text | bilingual pattern; 1–120 / 1–160 |
| `inventory_account_id` | uuid NULL | composite FK → accounts (RESTRICT); the G-15 per-warehouse override — NULL ⇒ the tenant INVENTORY purpose account |
| `is_active` | boolean NOT NULL DEFAULT true | deactivation blocks new movements; history stays |
| `deactivated_at` / `deactivated_by` | timestamptz / uuid | shape CHECK `(is_active = false) = (deactivated_at IS NOT NULL)` |
| `note` | text | 1–500 |

Indexes: `ix_warehouses_tenant_branch`, `ix_warehouses_tenant_active`.

**`item_warehouse_settings`** — per-item-per-warehouse defaults (§2.2/§2.14): `item_id` +
`warehouse_id` composite FKs, `reorder_level` / `min_qty` numeric(19,6) DEFAULT 0 CHECK ≥ 0
(consumed by the nightly reorder job — BR-019 alert, never autopilot), and
`last_reorder_alerted_at timestamptz` — the job's once-per-24h-window dedupe stamp.
Unique `(tenant_id, item_id, warehouse_id)`; index `ix_item_warehouse_settings_tenant_wh`.

## §stock_moves — the append-only stock ledger 🔒 (§2.3; INV-010/017/018)

**`stock_moves`** — immutable IN/OUT rows written ONLY by inventory services in the same
transaction as the journal posting (or the documented policy-none transfer case). This is the
highest-volume table in the platform.

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `id` | uuid PK | UUIDv7; composite anchor |
| `tenant_id` | uuid NOT NULL | FK tenants (RESTRICT); macro RLS |
| `item_id` / `warehouse_id` | uuid NOT NULL | composite FKs → items / warehouses (RESTRICT) |
| `direction` | text NOT NULL | CHECK `('IN','OUT')` — qty is always > 0, direction carries the sign |
| `move_kind` | text NOT NULL | CHECK `('receipt','issue','transfer_in','transfer_out','adjust')` |
| `qty` | numeric(19,6) NOT NULL | CHECK > 0 |
| `unit_cost` | numeric(19,6) NOT NULL | CHECK ≥ 0 — 6-decimal internal precision (ADR-0009) |
| `value_amount` | numeric(19,4) NOT NULL | CHECK > 0 — the exact journal quantum |
| `batch_id` / `serial_id` | uuid NULL | FKs → item_batches / item_serials (added in 0015 — FK expand step) when the item is tracked |
| `source_type` | text NOT NULL | CHECK `('manual_receipt','manual_issue','stock_adjustment','stock_count','stock_transfer','opening_balance_doc','method_switch')` |
| `source_id` | uuid NOT NULL | full provenance (with source_type) |
| `moved_at` | date NOT NULL | the entry date — every journal's entry_date equals its moves' moved_at (INV-011 alignment) |
| `reason` / `memo` / `memo_ar` | text | reason codes (BR-015 DAMAGE/EXPIRED/…); 1–500 memos |
| `posted_journal_id` | uuid NULL | composite FK → journal_entries (RESTRICT); NULL only for same-account transfer legs (asserted by construction in the INV-010 job) |

Indexes: `ix_stock_moves_tenant_item_wh_date` (the mandated tenant-first composite, §6),
`ix_stock_moves_tenant_wh_date`, `ix_stock_moves_tenant_source`,
`ix_stock_moves_tenant_journal`, partial `ix_stock_moves_tenant_batch` /
`ix_stock_moves_tenant_serial` (WHERE NOT NULL). **Grants:** SELECT + INSERT only for
`erp_app` (no UPDATE/DELETE — A4 asserts the denial) plus trigger
`trg_stock_moves_guard` BEFORE UPDATE OR DELETE (defense in depth, mirrors cash_movements).

**`stock_layers`** — FIFO cost layers (§2.5): created at receipt at the receipt move's unit
cost, consumed oldest-first; fully-consumed rows STAY at `remaining_qty = 0` (Σ layer qty =
on-hand holds over all rows — property-tested). `remaining_qty` / `unit_cost` numeric(19,6)
CHECK ≥ 0, `source_move_id` uuid NULL composite FK → stock_moves (unique per tenant where
NOT NULL; NULL only for method-switch re-based layers — INV-017 re-bases at book value),
`received_at date NOT NULL`. Live-layer partial index
`ix_stock_layers_tenant_item_wh_received` (WHERE remaining_qty > 0).

**`item_stock`** — the on-hand read model (§2.4/§6), maintained transactionally by every
movement writer (never eventually-consistent): `qty` numeric(19,6) (negative ONLY under the
explicit tenant policy BR-013 — partial index `ix_item_stock_tenant_negative` WHERE qty < 0
flags them), `avg_cost` numeric(19,6) (the WAC state; 0 for FIFO items — their valuation is
Σ layer qty × cost). Unique `(tenant_id, item_id, warehouse_id)`.

## §stock_transfers — two-leg warehouse transfers (§2.9; BR-016; G-15)

**`stock_transfers`** — `transfer_no` text (tenant-unique, `TRN-YYYY-NNNNNN`), `from_warehouse_id`
/ `to_warehouse_id` composite FKs with CHECK distinct, `status` CHECK
`('DRAFT','IN_TRANSIT','POSTED','CANCELLED')` (DOCUMENT_LIFECYCLE §3), `dispatch_date` /
`dispatched_by` (shape CHECK: IN_TRANSIT|POSTED ⇒ both present), `receive_date` /
`received_by` (POSTED ⇒ both), `posted_journal_id` (NULL exactly when both warehouses
resolve the same GL account — the G-15 policy-none case), `note` / `note_ar` 1–500.
Indexes: `ix_stock_transfers_tenant_status`, `_tenant_from`, `_tenant_to`.

**`stock_transfer_lines`** — one row per item per transfer: `transfer_id` composite FK
(CASCADE), `line_no` int ≥ 1 unique per transfer, `item_id` composite FK, `qty`
numeric(19,6) CHECK > 0 (base UoM), unique `(tenant_id, transfer_id, item_id)`.

**`stock_adjustments`** — manual reason-coded documents (§2.17; G-13/G-14):
`adjustment_no` tenant-unique, `warehouse_id` / `item_id` composite FKs, `reason` CHECK
`('DAMAGE','EXPIRED','COUNT_LOSS','COUNT_GAIN','OTHER')`, `delta_qty` numeric(19,6) SIGNED
CHECK ≠ 0, `unit_cost` numeric(19,6) NULL (gain at-cost override; default = current
valuation), `counter_account_id` composite FK NULL with shape CHECK
`(reason = 'OTHER') = (counter_account_id IS NOT NULL)` (the service never invents the
economic counterparty), `status` CHECK `('DRAFT','POSTED','CANCELLED')` + full posted-shape
CHECK (posting_date/posted_by/posted_at/posted_journal_id all present iff POSTED).

**`stock_reservations`** — the soft reservation seam (§2.13; in-phase catalog addition):
`item_id` / `warehouse_id` composite FKs, `qty` numeric(19,6) CHECK > 0, `holder_type`
CHECK `('MANUAL','SALES_ORDER')` (SALES_ORDER rides PHASE-012), `holder_id` uuid NULL,
`expires_at` timestamptz (expired rows stop netting immediately), `status` CHECK
`('ACTIVE','RELEASED','CONSUMED')` + released/consumed shape CHECKs, `note` 1–300.
Indexes: `ix_stock_reservations_netting (tenant_id, item_id, warehouse_id, status)`,
partial `ix_stock_reservations_expiry_sweep` (WHERE status = 'ACTIVE'). Availability
netting only — never a hard allocation lock (hard policies + the
`inventory.reservations` entitlement key land PHASE-015).

## §item_batches / §item_serials — tracking registries (§2.11/§2.12; BR-017/BR-018)

**`item_batches`** — `batch_no` (1–60, unique per tenant+item), `expiry_date` date NULL
(FEFO issuing for has_expiry items — BR-017), `source_ref` (1–120, provenance),
`status` CHECK `('ACTIVE','WRITTEN_OFF')`. Index
`ix_item_batches_tenant_item_expiry` (the FEFO scan).

**`item_serials`** — the unit registry: `serial_no` (1–80, unique per tenant+item),
`imei` (CHECK `^[0-9]{15,17}$`, unique per tenant where NOT NULL), `status` CHECK
`('in_stock','sold','returned')` + sold/returned shape CHECKs (sold_at / returned_at carry
the BR-018 return-binding audit), `current_owner` (1–160). Returns must reference the
originally sold unit — the service enforces it off this registry's binding history.

## §stock_counts — the count workspace (§2.10; BR-015; Journey D)

**`stock_counts`** — `count_no` tenant-unique, `warehouse_id` composite FK, `status` CHECK
`('DRAFT','COUNTED','VARIANCE_REVIEW','POSTED','CANCELLED')`, `blind` boolean (hide book
quantities from the counter), `snapshot_at` timestamptz (system-qty snapshot frozen at
creation), `counted_by` / `submitted_at` (shape CHECK: COUNTED+ ⇒ both), `variance` jsonb
(loss/gain line counts + values; shape CHECK: VARIANCE_REVIEW+ ⇒ present),
`approved_by` / `approved_at` / `supervisor_override` (the BR-015 above-tolerance second
approval) / `posting_date` / `posted_journal_id` (full posted-shape CHECK).

**`stock_count_lines`** — `stock_count_id` composite FK (CASCADE), `line_no` int ≥ 1,
`item_id` composite FK, `batch_id` NULL composite FK (batch-tracked items carry one line
per batch — partial uniques make both shapes collision-free), `system_qty` numeric(19,6)
CHECK ≥ 0 (the frozen snapshot), `counted_qty` numeric(19,6) NULL (NULL = not counted;
CHECK ≥ 0), `recounted` boolean + `recount_note` (1–300; the audited recount path),
`value_impact` numeric(19,4) NULL (variance × current valuation, computed at review).

## Grants & roles (migrations 0014/0015)

All thirteen tables: `REVOKE ALL FROM erp_app` then `GRANT SELECT, INSERT, UPDATE` — EXCEPT
`stock_moves` (SELECT + INSERT only, 🔒 append-only by grants) — plus `GRANT SELECT TO
erp_readonly` and the definer read surface for the support proxy. Guard trigger
`trg_stock_moves_guard` (BEFORE UPDATE OR DELETE → exception) as defense in depth; even the
superuser delete is refused (RC-05 asserts it — repairs are compensating corrections, and
the documented test-tooling path disables the trigger for the moment of a fixture removal).
Template correction in 0014: the viewer role template drops the pre-granted
`inventory.transfers.view` / `inventory.counts.view` (matrix §3.5 — viewer holds exactly
`inventory.stock.view` + `inventory.moves.view`).
