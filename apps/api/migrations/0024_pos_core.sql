-- PHASE-016 · migration 0024 · Point of Sale core
--
-- Purpose (PHASE-016 §2/§4; ENTITY_CATALOG §pos; SYNC_PROTOCOL §11):
-- the `pos` module lands as the terminal layer over sales:
-- - pos_terminals: the terminal registry — one row per branch counter,
--   bound to a till cash account (treasury CASH), a device row
--   (platform='pos-terminal', one terminal = one device), a default
--   warehouse for flow-B issues, and the receipt roll size (80/58 mm).
--   Status ACTIVE/INACTIVE only (activate/deactivate lifecycle; no
--   delete — documents reference terminals).
-- - pos_tables / pos_checks / pos_kitchen_tickets: the table-service
--   floor (T6) — deliberately ledger-free documents. An unpaid open
--   check holds NO ledger effect (PHASE-016 §2 item 5 binding); the
--   check converts to a POS sale (sales_invoices channel='POS') at
--   payment and only then posts. pos_checks.lines is a jsonb snapshot
--   (item/qty/price/note) — it is a working document, not a subledger.
-- - cashier_shifts: POS-grade linkage added additively (T3) —
--   pos_terminal_id + denominations jsonb (per-denomination blind count
--   BR-021) + a blind-count flag. Runtime writes remain treasury-owned
--   through its published service (MODULE_BOUNDARIES — this migration
--   only adds columns; no cross-module writer ships).
-- - sales_invoices: the POS channel columns (T5) — channel
--   ('STANDARD'|'POS'), pos_terminal_id, order_type
--   ('DINE_IN'|'TAKEAWAY'|'DELIVERY'|'COUNTER'), pos_table_id (paid
--   check provenance) and tenders jsonb (the cash/card split record —
--   G-02 debit split: cash → till, card → CARD_RECEIVABLE).
-- - change_log + sync_cursors: the NARROW POS slice of the sync
--   foundation (T8; SYNC_PROTOCOL §11 — binding boundary): one feed
--   group (items/barcodes/uoms/price_list_items/partners/tax_codes +
--   terminal config) with per-entity-type cursors. The generalized
--   registry (all entity types, tombstone GC, inbox_commands retention)
--   remains PHASE-020 — recorded in ENTITY_CATALOG as
--   "016 (POS subset) / 020 (generalized)".
-- - chart_of_accounts_template: the additive CARD_RECEIVABLE marker
--   (1151) — card tenders debit a mapped card-settlement account, NOT
--   the till drawer (INV-019 stays honest: till cash = Σ movements).
--   Fail-closed like every purpose: tenants without a live mapping get
--   the typed PURPOSE_NOT_MAPPED refusal on card tenders (existing
--   tenants add the account + purpose mapping once).
-- - permission seeds: pos.terminals.manage / pos.sales.sell /
--   pos.shifts.manage / pos.receipts.print (AUTHORIZATION_MATRIX §3.8
--   pos block; sales.pos_session.* already seeded at 0004).
--
-- All tenant-owned tables get the PHASE-002 RLS macro; change_log rows
-- are tenant-scoped (written by the POS feed writer inside the owning
-- module's transaction, read by authenticated device pulls).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- pos_terminals: the terminal registry (T2).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_terminals" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "branch_id" uuid NOT NULL,
  "device_id" uuid,
  "cash_account_id" uuid NOT NULL,
  "warehouse_id" uuid,
  "receipt_size" text NOT NULL DEFAULT '80mm',
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "quick_keys" jsonb,
  "last_seen_at" timestamptz,
  "activated_at" timestamptz,
  "deactivated_at" timestamptz,
  "offline_seq" integer NOT NULL DEFAULT 0,
  CONSTRAINT pk_pos_terminals PRIMARY KEY ("id"),
  CONSTRAINT ck_pos_terminals_code_shape CHECK ("code" ~ '^[A-Za-z0-9._-]{2,30}$'),
  CONSTRAINT ck_pos_terminals_receipt_size CHECK ("receipt_size" IN ('80mm', '58mm')),
  CONSTRAINT ck_pos_terminals_status CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_terminals_tenant_code ON "pos_terminals" ("tenant_id", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_terminals_tenant_device ON "pos_terminals" ("tenant_id", "device_id") WHERE "device_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_pos_terminals_tenant_branch ON "pos_terminals" ("tenant_id", "branch_id", "status");
--> statement-breakpoint
ALTER TABLE "pos_terminals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"pos_terminals"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- pos_tables: the floor plan (T6) — zones + tables; ledger-free.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_tables" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "zone" text NOT NULL DEFAULT 'MAIN',
  "zone_ar" text,
  "label" text NOT NULL,
  "seats" integer NOT NULL DEFAULT 4,
  "status" text NOT NULL DEFAULT 'FREE',
  "sort_key" integer NOT NULL DEFAULT 0,
  CONSTRAINT pk_pos_tables PRIMARY KEY ("id"),
  CONSTRAINT ck_pos_tables_label_shape CHECK ("label" ~ '^[^\s].{0,29}$'),
  CONSTRAINT ck_pos_tables_status CHECK ("status" IN ('FREE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE')),
  CONSTRAINT ck_pos_tables_seats CHECK ("seats" BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_pos_tables_tenant_branch ON "pos_tables" ("tenant_id", "branch_id", "zone", "sort_key");
--> statement-breakpoint
ALTER TABLE "pos_tables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"pos_tables"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- pos_checks: open guest checks (T6) — unpaid = NO ledger effect; the
-- lines jsonb is the working order document (send/merge/transfer/split).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_checks" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "check_no" text NOT NULL,
  "table_id" uuid,
  "order_type" text NOT NULL DEFAULT 'DINE_IN',
  "guest_count" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'OPEN',
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "opened_by" uuid,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  "invoice_id" uuid,
  "note" text,
  CONSTRAINT pk_pos_checks PRIMARY KEY ("id"),
  CONSTRAINT ck_pos_checks_order_type CHECK ("order_type" IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'COUNTER')),
  CONSTRAINT ck_pos_checks_status CHECK ("status" IN ('OPEN', 'PAID', 'CANCELLED')),
  CONSTRAINT ck_pos_checks_guests CHECK ("guest_count" BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_checks_tenant_no ON "pos_checks" ("tenant_id", "check_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_pos_checks_tenant_branch_status ON "pos_checks" ("tenant_id", "branch_id", "status", "opened_at");
--> statement-breakpoint
ALTER TABLE "pos_checks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"pos_checks"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- pos_kitchen_tickets: printed kitchen tickets (T6) — print-only, no KDS.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_kitchen_tickets" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL,
  "created_by" uuid,
  "check_id" uuid NOT NULL,
  "ticket_no" text NOT NULL,
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'PRINTED',
  "printed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_pos_kitchen_tickets PRIMARY KEY ("id"),
  CONSTRAINT ck_pos_kitchen_tickets_status CHECK ("status" IN ('PRINTED', 'VOID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_kitchen_tickets_tenant_no ON "pos_kitchen_tickets" ("tenant_id", "ticket_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_pos_kitchen_tickets_tenant_check ON "pos_kitchen_tickets" ("tenant_id", "check_id", "printed_at");
--> statement-breakpoint
ALTER TABLE "pos_kitchen_tickets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"pos_kitchen_tickets"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- cashier_shifts: POS-grade additive columns (T3) — terminal linkage +
-- per-denomination blind count (BR-021) + blind-count posture. Writes
-- stay treasury-owned (its service validates + persists).
--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "pos_terminal_id" uuid;
--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "denominations" jsonb;
--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "blind_count" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_cashier_shifts_tenant_terminal
  ON "cashier_shifts" ("tenant_id", "pos_terminal_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- sales_invoices: the POS channel columns (T5). channel separates the
-- counter flow from the back office (default 'STANDARD' keeps every
-- existing row/back-office view unchanged); tenders records the
-- cash/card split for the G-02 debit split + the Z report.
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "channel" text NOT NULL DEFAULT 'STANDARD';
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "pos_terminal_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "order_type" text;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "pos_table_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "tenders" jsonb;
--> statement-breakpoint
ALTER TABLE "sales_invoices" DROP CONSTRAINT IF EXISTS ck_sales_invoices_channel_values;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT ck_sales_invoices_channel_values
  CHECK ("channel" IN ('STANDARD', 'POS'));
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT ck_sales_invoices_order_type_values
  CHECK ("order_type" IS NULL OR "order_type" IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'COUNTER'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_channel_terminal
  ON "sales_invoices" ("tenant_id", "channel", "pos_terminal_id", "invoice_date");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- change_log: the NARROW POS feed slice (T8; SYNC_PROTOCOL §2/§11).
-- entity_type ∈ the POS feed group only (items, barcodes, uoms,
-- price_list_items, partners, tax_codes — pulled read-caches) plus
-- terminal-config bumps. The PHASE-020 generalization widens the table
-- (all entity types + device classes) — never shrinks this contract.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_log" (
  "seq" bigserial PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "op" text NOT NULL,
  "payload" jsonb,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_change_log_op CHECK ("op" IN ('UPSERT', 'DELETE')),
  CONSTRAINT ck_change_log_entity_shape CHECK ("entity_type" ~ '^[a-z][a-z0-9_]{2,40}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_change_log_tenant_entity_seq
  ON "change_log" ("tenant_id", "entity_type", "seq");
--> statement-breakpoint
ALTER TABLE "change_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"change_log"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- sync_cursors: per-device pull positions (SYNC_PROTOCOL §2 — opaque to
-- clients; stored + advanced server-side only on acknowledged batches).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_cursors" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "last_seq" bigint NOT NULL DEFAULT 0,
  "acknowledged_at" timestamptz,
  CONSTRAINT pk_sync_cursors PRIMARY KEY ("id"),
  CONSTRAINT uq_sync_cursors_device_entity UNIQUE ("device_id", "entity_type")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sync_cursors_tenant_device ON "sync_cursors" ("tenant_id", "device_id");
--> statement-breakpoint
ALTER TABLE "sync_cursors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"sync_cursors"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- devices: the pos-terminal slice ships on the existing identity table
-- (PHASE-003 schema, PHASE-016 first runtime consumer): platform gains
-- the 'pos-terminal' value + capability scoping columns (narrow — the
-- PHASE-020 registry adds self-enrollment/attestation columns). NO
-- tenant_id column here: devices stays service-mediated (PHASE-003 §4
-- — no RLS by design; the check-rls tenant_id rule would otherwise
-- demand a policy). The tenant binding resolves through the terminal
-- (pos_terminals is RLS'd; one terminal = one device).
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS ck_devices_platform_values;
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT ck_devices_platform_values
  CHECK ("platform" IN ('DESKTOP', 'ANDROID', 'pos-terminal'));
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "capabilities" jsonb;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "terminal_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_devices_terminal_platform
  ON "devices" ("terminal_id", "platform") WHERE "platform" = 'pos-terminal';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- chart_of_accounts_template: the additive CARD_RECEIVABLE marker (1151)
-- for card-in-till settlement (existing tenants map it once, fail-closed
-- PURPOSE_NOT_MAPPED until then — consistent with every other purpose).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('1151', 'Card receivable (POS)', 'مستحقات البطاقات (نقاط البيع)', 'ASSET', false, '1150', 'CARD_RECEIVABLE')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Permission seeds (T1/T2; AUTHORIZATION_MATRIX §3.8 pos block — the
-- drift checker requires matrix ↔ seed parity; sales.pos_session.*
-- already seeded at 0004).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('pos.terminals.manage', 'pos', 'Register/activate terminals + enroll pos-terminal devices / إدارة أجهزة نقاط البيع'),
('pos.sales.sell', 'pos', 'Counter sales, returns, tenders on a terminal / البيع والمرتجعات على الطرفية'),
('pos.shifts.manage', 'pos', 'Open/close terminal shifts with float + blind count / إدارة ورديات الطرفية'),
('pos.receipts.print', 'pos', 'Print/reprint 80/58 mm receipts / طباعة الإيصالات')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Plan grants (T1; FEATURE_CATALOG §25 protocol step 3): the two intake
-- keys join the business + enterprise plans' feature_keys arrays (the
-- docs' "pos.* set" — retail/restaurant packs light up their floor
-- entries). Idempotent: array_cat over the existing array.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['pos.table_service', 'pos.kitchen_display', 'items.composite_products'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('pos.table_service' = ANY("feature_keys"));
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- System role-template grants (T2; the 0005 templates predate the pos.*
-- family): the cashier template gains the POS counter keys; owner gains
-- the terminal admin key. Existing tenant roles are untouched (tenants
-- compose their own grants through the role editor).
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'pos.sales.sell', 'pos.shifts.manage', 'pos.receipts.print'
)
WHERE r."key" = 'cashier' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'pos.terminals.manage', 'pos.sales.sell', 'pos.shifts.manage',
  'pos.receipts.print', 'sync.devices.revoke'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- Grants (erp_app writes; erp_readonly reads; erp_definer read surface).
--> statement-breakpoint
-- change_log is APPEND-ONLY (the feed substrate — no UPDATE/DELETE, the
-- journal_lines pattern); pos_tables carries DELETE (the floor plan is
-- editable: removing a table is a layout operation, tombstone-free).
GRANT SELECT, INSERT, UPDATE ON "pos_terminals", "pos_checks",
  "pos_kitchen_tickets", "sync_cursors" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pos_tables" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "change_log" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "pos_terminals", "pos_tables", "pos_checks",
  "pos_kitchen_tickets", "change_log", "sync_cursors" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "cashier_shifts", "sales_invoices", "devices" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "pos_terminals", "pos_tables", "pos_checks", "pos_kitchen_tickets",
  "change_log", "sync_cursors", "cashier_shifts", "sales_invoices"
  TO erp_definer;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 24)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
