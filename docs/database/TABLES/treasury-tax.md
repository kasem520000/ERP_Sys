# TABLES — Treasury & Tax Cluster

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-11-05 · **Phases:** 008 (tax sections grow at 009; parked lines + format registry 023)

Column-level specification for the treasury cluster delivered in PHASE-008,
consistent with the [ERD/treasury-tax.md](../ERD/treasury-tax.md) diagram,
[ENTITY_CATALOG.md](../ENTITY_CATALOG.md) §treasury,
[DATABASE_CONVENTIONS.md](../DATABASE_CONVENTIONS.md),
[DATA_DICTIONARY.md](../DATA_DICTIONARY.md) (standard columns, enums, money semantics),
[CONSTRAINTS_AND_INDEXES.md](../CONSTRAINTS_AND_INDEXES.md), and the domain rules in
[../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4 (G-05/G-06/G-10/G-11/G-12),
[../accounting/RECONCILIATION.md](../../accounting/RECONCILIATION.md) §4 (bank rec),
[../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
(allocations, on-account) and [../product/BUSINESS_RULES.md](../../product/BUSINESS_RULES.md)
§4 (BR-020…BR-023). Drizzle schema (`apps/api/src/db/schema.ts`) is the machine-readable
mirror (sync rule). All tenant-owned tables carry the standard columns block and RLS per
conventions unless noted. Delivered by migration `0012_treasury.sql` (the phase document's
T1 name `0009_treasury.sql` drifted — 0009–0011 were consumed by PHASE-006/007; same
renumbering drift the PHASE-007 report recorded for its own T2).

Standard columns (`id uuid PK UUIDv7`, `tenant_id`, `created_at`, `updated_at`,
`version`, `created_by` where a user actor exists) per
[DATABASE_CONVENTIONS.md](../DATABASE_CONVENTIONS.md) §5 — abbreviated below as
"**+standard**". Money is `numeric(19,4)`, rates `numeric(19,8)`, dates `date`,
timestamps `timestamptz` (ADR-0009). Every new table gets the `erp.apply_tenant_policy`
RLS macro (TENANT_ISOLATION §2) and is registered in the generated isolation suite's
tables registry (`apps/api/src/__db__/isolation/tables.registry.ts` — A1–A10 green).

## `cash_accounts` — treasury accounts (PHASE-008)

Each treasury account **is** a GL account: `account_id` is unique per tenant (1:1), so
INV-019's "balance = Σ movements" is unambiguous per GL account. Opening requires an
existing mapped GL account (service-enforced); closing preserves every movement and
journal row — a status flip that blocks new documents only.

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | composite-FK anchor for `cash_movements`, documents, statements |
| `name` / `name_ar` | text | no / yes | — | `uq_cash_accounts_tenant_name`; `length(name) BETWEEN 1 AND 120` | Bilingual display name |
| `type` | text | no | — | ck: `CASH \| BANK \| PETTY` | Account class (BR-020 caps apply to PETTY) |
| `account_id` | uuid | no | — | composite FK → `accounts(id, tenant_id)` (RESTRICT); `uq_cash_accounts_tenant_account` | The CoA ledger account this treasury account IS |
| `branch_id` | uuid | yes | — | composite FK → `branches(id, tenant_id)` | Optional branch scoping (matrix §5) |
| `currency_code` | char(3) | no | — | FK → `currencies.code` | Account currency (INV-005 currency restriction rides the GL account) |
| `status` | text | no | `ACTIVE` | ck: `ACTIVE \| CLOSED`; `ck_cash_accounts_closed_shape` | Closing blocks new documents, preserves history |
| `opened_at` / `closed_at` / `closed_by` / `close_reason` | timestamptz / timestamptz / uuid / text | no / yes / yes / yes | `now()` / — | closed-shape CHECK ties `closed_at` to the CLOSED status | Lifecycle audit trail |

Indexes: `ix_cash_accounts_tenant_type_status (tenant_id, type, status)`,
`ix_cash_accounts_tenant_branch` (partial, `branch_id IS NOT NULL`).

## `cash_movements` — the money ledger (PHASE-008, append-only 🔒)

Immutable IN/OUT rows written **only by treasury services** inside the same transaction
as their journal posting (INV-019's substrate). `amount` is the account-currency quantum;
`base_amount` carries the exact base conversion so the INV-019 check sums in base.
`(source_type, source_id, account, direction)` uniqueness is the movement-level mirror
of the journal's INV-013 key — a source document never yields two movements on the same
account side (transfers differ per account+direction).

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id`, `created_at` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | no `updated_at`/`version` — rows are immutable |
| `cash_account_id` | uuid | no | — | composite FK → `cash_accounts(id, tenant_id)` (RESTRICT) | The account this movement hits |
| `direction` | text | no | — | ck: `IN \| OUT` | Signed by convention: IN increases, OUT decreases the account balance |
| `amount` | numeric(19,4) | no | — | `CHECK (amount > 0)` | Account-currency quantum (sign lives in `direction`) |
| `currency_code` | char(3) | no | — | FK → `currencies.code` | Movement currency |
| `exchange_rate` | numeric(19,8) | no | `1` | `CHECK (exchange_rate > 0)` | Rate captured at posting (base per 1 foreign) |
| `base_amount` | numeric(19,4) | no | — | `CHECK (base_amount > 0)` | Exact base conversion (ADR-0009) — what INV-019 sums |
| `source_type` | text | no | — | ck: `receipt \| payment \| cash_transfer \| expense \| shift_variance` | The treasury service that wrote the row (write matrix: only treasury) |
| `source_id` | uuid | no | — | `uq_cash_movements_source_side` | Source document id — composite idempotency with `direction` |
| `value_date` | date | no | — | — | Economic date (drives aging + bank-rec windows) |
| `memo` / `memo_ar` | text / text | yes / yes | — | `length ≤ 500` | Bilingual memo |

**Append-only enforcement (§6 security):** `erp_app` holds SELECT/INSERT only — no
UPDATE/DELETE grant at all — plus the `erp.cash_movements_guard()` BEFORE UPDATE/DELETE
trigger raises on any attempt, so even repository misuse cannot rewrite cash history
(proven live in the INV-019 suite: grant denial + trigger raise both asserted).

Indexes: `ix_cash_movements_tenant_account_date (tenant_id, cash_account_id, value_date)`
(the bank-rec match window), `ix_cash_movements_tenant_source (tenant_id, source_type, source_id)`.

## `receipts` — money-in documents (PHASE-008)

DRAFT → POSTED lifecycle per [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)
§3 (no approval by default; BR-034 policies may add PENDING_APPROVAL/APPROVED for
doc_type `receipt`). Official numbers assign at posting via the numbering service
(INV-021); posted rows are immutable — correction is reversal-only (INV-014). The CHEQUE
method value is reserved (cheque lifecycle lands PHASE-012/027 — catalog deferral note).

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `status` | text | no | `DRAFT` | ck: `DRAFT \| PENDING_APPROVAL \| APPROVED \| POSTED \| CANCELLED` | Lifecycle state |
| `receipt_no` | text | yes | — | `ck_receipts_posted_shape` (POSTED ⇒ number + journal set) | Official number (INV-021, RCV-{yyyy}-{seq}) |
| `cash_account_id` | uuid | no | — | composite FK → `cash_accounts` | Money lands here (G-05 DR) |
| `partner_id` | uuid | no | — | composite FK → `partners` | The AR partner (allocation target owner) |
| `method` | text | no | — | ck: `CASH \| BANK \| CHEQUE \| CARD \| TRANSFER` | Payment method (CHEQUE reserved — no lifecycle here) |
| `payer_name` | text | yes | — | — | Free-text payer (on-account receipts) |
| `currency_code` / `exchange_rate` | char(3) / numeric(19,8) | no / yes | — / — | rate `> 0` when set | FX capture at posting (G-06 uses it) |
| `amount` | numeric(19,4) | no | — | `CHECK (amount > 0)` | Document amount in its currency |
| `value_date` | date | no | — | — | Economic date |
| `reference` / `description` / `description_ar` | text | yes | — | reference `length ≤ 80` | Bilingual references |
| `allocated_amount` | numeric(19,4) | no | `0` | `CHECK (0 ≤ allocated_amount ≤ amount)` — INV-016 bookkeeping invariant | Σ effective allocations ( remainder is on-account, BR-027) |
| `fx_gain_loss` | numeric(19,4) | no | `0` | — | Realized FX residual captured at settlement (G-06 mirror) |
| `submitted_at/by`, `approved_at/by`, `posted_at/by` | timestamptz / uuid | yes | — | — | Lifecycle audit trail |
| `posted_journal_id` | uuid | yes | — | `ck_receipts_posted_shape` | The one journal (INV-013 idempotent per source/op) |
| `cancelled_at/by`, `cancel_reason` | timestamptz / uuid / text | yes | — | — | Cancellation audit |

Indexes: `ix_receipts_tenant_status_date`, `ix_receipts_tenant_partner`.

## `payments` — money-out documents (PHASE-008)

The exact money-out mirror of `receipts` (G-10; FX mirrors G-06). Same lifecycle, same
posted-shape CHECK, official `payment_no` (PAY-{yyyy}-{seq}), `payee_name` instead of
`payer_name`, allocations settle AP open items.

Same column shape as `receipts` (§ above) with: `payment_no`, `payee_name`, AP-side
`treasury_allocations`. Indexes: `ix_payments_tenant_status_date`, `ix_payments_tenant_partner`.

## `treasury_allocations` — settlement links (PHASE-008; INV-016, CC-02)

Settlement links between a receipt/payment and the partner's open items
(`partner_subledger_entries` — at this phase the PHASE-007 opening-balance items).
Exactly one of `receipt_id`/`payment_id` is set (real composite FKs, not a polymorphic
hole). Effective allocations are those on POSTED documents; the service validates
Σ ≤ document amount and Σ ≤ open-item outstanding under a row lock on the open item
(CC-02). DRAFT rows are editable until posting; DELETE is granted for the pre-POST edit
path (same sanctioned pattern as manual journal drafts) and confined by the service.

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id`, `created_at`, `created_by` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | immutable once posted |
| `receipt_id` | uuid | yes | — | composite FK → `receipts` (CASCADE); `ck_treasury_allocations_exactly_one_doc` (`(receipt_id IS NULL) <> (payment_id IS NULL)`) | The money-in leg |
| `payment_id` | uuid | yes | — | composite FK → `payments` (CASCADE) | The money-out leg |
| `open_item_id` | uuid | no | — | composite FK → `partner_subledger_entries` (RESTRICT) | The settled AR/AP subledger row |
| `amount` | numeric(19,4) | no | — | `CHECK (amount > 0)` | Allocated quantum (partial allocations allowed) |

Uniqueness: `uq_treasury_allocations_receipt_item` (partial, `receipt_id IS NOT NULL`) and
`uq_treasury_allocations_payment_item` (partial, `payment_id IS NOT NULL`) — the
exactly-one-doc CHECK plus two partial uniques prevent duplicate (document, open item)
rows. Indexes: `ix_treasury_allocations_tenant_item`, plus partial per-leg document indexes.

## `expense_categories` — bilingual expense accounts (PHASE-008; BR-023)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `code` | text | no | — | `uq_expense_categories_tenant_code`; `^[A-Za-z0-9_-]{2,30}$` | Tenant-unique code |
| `name` / `name_ar` | text / text | no / no | — | — | Bilingual name (required both — Arabic-first) |
| `account_id` | uuid | no | — | composite FK → `accounts` (RESTRICT) | The expense GL account (G-11 DR) |
| `approval_mode` | text | no | `single-approver` | ck: `none \| single-approver` | Per-category approval policy (BR-023) |
| `is_active` | boolean | no | `true` | — | Soft-retire categories; history preserved |

## `expenses` — claims with approval + payout posting (PHASE-008; G-11)

DRAFT → PENDING_APPROVAL → APPROVED → POSTED (the approval hop is skipped when the
category's `approval_mode = none`). `tax_code_id` is the **reserved PHASE-009 field**
(nullable uuid placeholder; the tax FK + GL effect wire in PHASE-009 — documented in the
phase doc). `receipt_file_id` links the mandatory receipt attachment above the tenant's
`treasury.expense_receipt_threshold` (files module — `file_objects.owner_type = 'EXPENSE'`,
widened additively in this migration).

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `status` | text | no | `DRAFT` | ck: `DRAFT \| PENDING_APPROVAL \| APPROVED \| POSTED \| CANCELLED` | Lifecycle state |
| `expense_no` | text | yes | — | `ck_expenses_posted_shape` | Official number (EXP-{yyyy}-{seq}, INV-021) |
| `category_id` | uuid | no | — | composite FK → `expense_categories` (RESTRICT) | Drives the DR account + approval mode |
| `cash_account_id` | uuid | no | — | composite FK → `cash_accounts` (RESTRICT) | Payout source (G-11 CR; petty caps BR-020 apply for PETTY) |
| `payee_name` | text | no | — | `length 1..160` | Who is paid |
| `currency_code` / `exchange_rate` | char(3) / numeric(19,8) | no / yes | — / — | rate `> 0` when set | FX capture |
| `amount` | numeric(19,4) | no | — | `CHECK (amount > 0)` | Claim amount |
| `tax_code_id` | uuid | yes | — | **reserved** — no FK yet (PHASE-009) | Recoverable tax code (field travels, no computation this phase) |
| `receipt_file_id` | uuid | yes | — | composite FK → `file_objects` (SET NULL) | Receipt attachment (BR-023 threshold) |
| `value_date`, `description`, `description_ar`, lifecycle stamps | — | — | — | — | Same shape as receipts |

Indexes: `ix_expenses_tenant_status_date`, `ix_expenses_tenant_category`.

## `cash_transfers` — account↔account transfers with charges (PHASE-008; G-12)

DRAFT → POSTED; the fee F posts to the `BANK_CHARGES` purpose; INV-019 holds on both
sides (two movements: OUT on source, IN on destination minus fee).

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `status` | text | no | `DRAFT` | ck: `DRAFT \| PENDING_APPROVAL \| APPROVED \| POSTED \| CANCELLED` | Lifecycle |
| `transfer_no` | text | yes | — | `ck_cash_transfers_posted_shape` | Official number (TRF-{yyyy}-{seq}) |
| `from_account_id` / `to_account_id` | uuid | no | — | composite FKs → `cash_accounts`; `CHECK (from <> to)` | The two legs |
| `currency_code` / `exchange_rate` | char(3) / numeric(19,8) | no / yes | — / — | rate `> 0` when set | FX capture |
| `amount` | numeric(19,4) | no | — | `CHECK (amount > 0)` | Transferred quantum |
| `fee_amount` | numeric(19,4) | no | `0` | `CHECK (0 ≤ fee < amount)` — fee is strictly below the principal | Bank charge (BANK_CHARGES posting) |
| `value_date`, `reference`, bilingual description, lifecycle stamps | — | — | — | — | Same shape as receipts |

Index: `ix_cash_transfers_tenant_status_date`.

## `cashier_shifts` — BR-021 shift model (PHASE-008)

Opening float, manual tellering capture feed (`captured_in/out` — POS-grade UX lands
PHASE-016), close count, variance handling. `expected = opening + in − out` at close;
`difference = counted − expected`. One OPEN shift per account (partial unique).
Variance journals post with the shift as source; the supervisor attestation is required
above the `treasury.shift_variance_tolerance` threshold.

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `status` | text | no | `OPEN` | ck: `OPEN \| CLOSED \| CANCELLED`; `uq_cashier_shifts_one_open_per_account` (partial, `status = 'OPEN'`) | One open shift per account |
| `shift_no` | text | yes | — | — | Numbering at close |
| `cash_account_id` | uuid | no | — | composite FK → `cash_accounts` | The cash drawer account |
| `currency_code` / `exchange_rate` | char(3) / numeric(19,8) | no / yes | — / — | — | FX capture |
| `opening_amount` | numeric(19,4) | no | `0` | nonnegative CHECK | Opening float |
| `captured_in` / `captured_out` | numeric(19,4) | no | `0` | nonnegative CHECK | Manual capture feed accumulators |
| `expected_amount` / `counted_amount` / `difference` | numeric(19,4) | yes | — | set at close | The BR-21 worked example: expected 1,380 · counted 1,377.50 → difference −2.50 posts |
| `variance_posted_journal_id` | uuid | yes | — | — | The variance journal (source = this shift) |
| `supervisor_id` / `supervisor_verified_at` | uuid / timestamptz | yes | — | — | Required above tolerance before close |
| `close_reason` / `opened_at` / `closed_at` / `closed_by` | text / timestamptz / timestamptz / uuid | yes / no / yes / yes | `now()` | `ck_cashier_shifts_closed_shape` | Lifecycle audit |

Index: `ix_cashier_shifts_tenant_status (tenant_id, status, opened_at)`.

## `bank_statements` — imported statements (PHASE-008; BR-022)

One imported file per `(tenant, file_hash)` — imports are idempotent; RECONCILED locks
the statement period for that account (service-enforced on any later matching inside a
reconciled window for the account).

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `status` | text | no | `IMPORTED` | ck: `IMPORTED \| RECONCILED`; `ck_bank_statements_reconciled_shape` | Reconcile is terminal for the period |
| `cash_account_id` | uuid | no | — | composite FK → `cash_accounts` | The bank account |
| `period_start` / `period_end` | date | no / no | — | `CHECK (end ≥ start)` | The statement window (lock scope) |
| `file_name` / `file_hash` | text | no / no | — | hash `^[a-f0-9]{64}$`; `uq_bank_statements_tenant_hash` | Idempotency key (sha-256 of bytes) |
| `adapter_id` | text | no | — | — | The format adapter used (`generic-csv`, `generic-xlsx`, …) |
| `opening_balance` / `closing_balance` | numeric(19,4) | yes | — | — | Optional control totals from the file |
| `line_count` | integer | no | `0` | `CHECK (line_count ≥ 0)` | Bounded by the import row cap (U-07 pattern) |
| `imported_at` / `reconciled_at` / `reconciled_by` | timestamptz | no / yes / yes | `now()` | — | Lifecycle audit |

Index: `ix_bank_statements_tenant_account_period (tenant_id, cash_account_id, period_start, period_end)`.

## `bank_statement_lines` — informational match rows (PHASE-008; RECONCILIATION §4)

**They never create ledger entries** — matching is informational. Signed-amount
convention: positive = money into the bank account, negative = money out.
`matched_movement_id` links the informational side to the system movement;
`matched_at/by` + `match_mode` audit every match.

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `bank_statement_id` | uuid | no | — | composite FK → `bank_statements` (CASCADE); `uq_bank_statement_lines_statement_no` with `line_no` | Parent statement |
| `line_no` | integer | no | — | — | File row order |
| `line_date` | date | no | — | — | Parsed value date (window matching) |
| `amount` | numeric(19,4) | no | — | signed (positive = in) | The bank's quantum |
| `reference` / `description` | text | yes | — | reference `length ≤ 120` | Match keys (auto-match: amount + date window + reference) |
| `matched_movement_id` | uuid | yes | — | composite FK → `cash_movements` (RESTRICT) | The system movement this line matched |
| `matched_at` / `matched_by` / `match_mode` | timestamptz / uuid / text | yes | — | `ck_bank_statement_lines_match_shape`; mode ck: `AUTO \| MANUAL \| NULL` | Match audit |

Indexes: `ix_bank_statement_lines_tenant_statement (tenant_id, bank_statement_id, line_no)`,
`ix_bank_statement_lines_tenant_movement` (partial, `matched_movement_id IS NOT NULL`).

## `bank_statement_parked_lines` — unparseable rows parked for manual mapping (PHASE-023, migration `0035_external_integrations.sql`; T7)

A row a family parser cannot parse parks here instead of failing the file:
raw cells verbatim, **amounts NEVER guessed** (the BR-022/RECONCILIATION §4
"no parser writes a guessed amount" rule made structural). Resolution is manual
mapping — the mapper confirms every field, the service writes the mapped
`bank_statement_lines` row and links it; discard records why.

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` **+standard** | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `statement_id` | uuid | no | — | soft link — no FK (parked rows precede their mapped line); `uq_bank_parked_lines_slot` with `line_index` | The parent statement |
| `line_index` | integer | no | — | `CHECK (line_index >= 0)` | File row order (the parking slot) |
| `raw_cells` | jsonb | no | — | — | The split cells verbatim |
| `raw_line` | text | no | — | — | The raw line verbatim |
| `parked_reason` | text | no | — | `length 1..200` | Why it parked (typed reason) |
| `status` | text | no | `PARKED` | ck: `PARKED \| RESOLVED \| DISCARDED` | Resolution state |
| `resolved_line_id` | uuid | yes | — | soft link — no FK | The mapped `bank_statement_lines` row (set at resolve) |
| `resolved_by` / `resolved_at` | uuid / timestamptz | yes / yes | — | — | Resolution audit |
| `resolution_note` | text | yes | — | — | Mandatory why on discard |

Index: `ix_bank_parked_tenant_status (tenant_id, status)` — the mapping queue.
Grants: SELECT/INSERT/UPDATE for `erp_app` (no DELETE — the parking audit
survives; discard is a status).

## `bank_statement_formats` — the shipped parser-format registry (PHASE-023 seeded; global reference)

Format **FAMILIES** with declared required columns — structural shapes, not
bank-specific claims; no format is attributed to a bank without verified
documentation (NO-FABRICATION). `erp_migrate` writes; everyone else reads (the
currencies/jurisdictions pattern — **no `tenant_id`, no RLS**).

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `key` | text | no | — | **PK** (natural: `generic-csv`, `csv-debit-credit`, …) | Registry key (what `bank_statements.adapter_id` records) |
| `label_en` / `label_ar` | text | no / no | — | — | Bilingual labels |
| `family` | text | no | — | ck: `csv \| xlsx` | The structural family |
| `extensions` | jsonb | no | — | — | Accepted file extensions |
| `required_columns` | jsonb | no | — | — | The columns a parser of this family REQUIRES (rows missing them park) |
| `notes` | text | yes | — | — | Provenance/semantics notes |
| `created_at` | timestamptz | no | `now()` | — | Seed marker |

Seeded rows (0035): `generic-csv` + `generic-xlsx` (the PHASE-008 adapters,
carried into the registry), `csv-debit-credit` (two-column amount family — the
signed amount derives from the debit/credit pair; a row with both or neither
parks; balance columns optional) and `csv-with-balances` (single signed amount +
running balance; balance drift is recorded as an advisory warning, never a
silent correction).

## Widening of existing tables (this migration)

- `reconciliation_runs.kind` widened with `BANK_REC` (the per-account statement-period
  reconcile state rides the PHASE-007 framework; `CASH` was pre-provisioned for INV-019).
- `file_objects.owner_type` widened additively with `EXPENSE` (receipt attachments; the
  PHASE-006 set `PARTNER/ITEM/OPENING_BALANCE_DOC` unchanged).

## Tax tables (PHASE-009+)

The tax/jurisdiction tables (`tax_registrations`, `jurisdictions`,
`jurisdiction_tax_rates`, `tax_codes`, `e_invoicing_submissions` in the ERD) land in
[TABLES/tax-compliance.md](tax-compliance.md) per the grow-per-phase rule when
PHASE-009 ships them; the ERD diagram in
[../ERD/treasury-tax.md](../ERD/treasury-tax.md) already carries their core attributes.
