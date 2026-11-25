-- PHASE-051 (W-35 — T-08, dated 2026-11-25) · migration 0124 · THE
-- ORDERS' OWN INCOTERM COLUMNS (BR-106's mandate floor — D-10's own
-- demand: the selection lands on the order rows themselves, the typed
-- refusal at the order's own posting reads the row's own field; the
-- 0123 additive-slot precedent's class — a service wave's structural
-- demand lands as its own dated additive slot, ordered WITH the
-- writers under the 0099/0111 same-increment law).
--
--   §1 THE PURCHASE ORDERS' COLUMNS: incoterm_code (the tenant's
--     registry code the order carries — the SNAPSHOT semantics: the
--     create froze its choice, a later registry retirement never
--     rewrites a posted order; NO FK by design — the registry is
--     tenant-extensible DATA with a DELETE grant (the 0120 grants
--     block), and a hard FK would refuse the tenant's own registry
--     management; the selection's existence/activeness floor is the
--     SERVICE's typed gate, the code's shape the floor below) ·
--     trade_direction (the explicit IMPORT/EXPORT marker — BR-106's
--     second trigger arm, the owner's ruling (ج) carried VERBATIM:
--     «currency ≠ base currency, or the order carries the
--     import/export tag»).
--
--   §2 THE SALES ORDERS' COLUMNS: the same pair, the same laws — the
--     mandate binds BOTH order families (the trade-flagged purchase
--     AND sales orders — the phase doc's own wording; the export leg
--     rides the sales side).
--
--   THE ADDITIVE-SLOT LAW (the 0117/0118/0123 precedent's own class —
--   the master plan's four declared slots 0119–0122 are consumed at
--   W-33 and PUBLISHED (the constants law: no touching any published
--   migration); a service wave's structural demand lands as its own
--   dated additive slot. The chain 123 → 124; the phase's final
--   fingerprint carries the dated disclosure at every claim site.
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--   expected fingerprint): the chain 123 → 124 · ENTITY_CATALOG 354
--   (ZERO table delta — this migration adds NO tables, only the two
--   additive nullable column pairs on EXISTING tables) · the
--   permissions drift 357 unchanged (the W-35 routes bind the
--   EXISTING 0122-seeded keys — trade.view over the reads,
--   trade.collections.manage over the register acts; no new key) ·
--   ROUTE_PERMISSIONS 1,170 + 11 = 1,181 (the W-35 dated delta at the
--   block — the collections + incoterms families, the keys-seed-first
--   discipline's second trade binding wave).
--
--   Ledger-free by design: zero journal rules, zero invariants, zero
--   account purposes (BR-106 is a mandate FLOOR, never a posting rule
--   — the reservation law rides it: no identifier outside
--   G-64…G-66 · INV-036 · BR-105…BR-108 anywhere in this file); zero
--   grants changes (the columns ride the existing table grants —
--   column-level grants do not exist in this schema); zero seeds (the
--   Incoterms/HS starter sets landed at 0122 §6 for every existing
--   tenant; the NEW-tenant materialization is the W-35 onboarding
--   hook — one source, both paths, the 0098 competency-scale
--   precedent's own shape, never a second sweep).
--
--   NULLABLE-ADDITIVE (the 0052/0076 pattern): every existing row
--   carries NULL on both columns — an order created before W-35 never
--   triggers the mandate's refusal (already-ISSUED rows are past the
--   posting act; a pre-W-35 DRAFT that issues later under a
--   trade-flagged tenant and a foreign currency DOES meet the gate —
--   the honest reading of D-10's own boundary: the mandate is at the
--   posting act, and the posting act now carries the gate).

SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- §1 THE PURCHASE ORDERS' COLUMNS (the import leg — BR-106's floor).
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "incoterm_code" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "trade_direction" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS ck_purchase_orders_incoterm_code;
--> statement-breakpoint
-- The 0120 registry floor's own shape (ck_incoterms_code) — the order
-- carries the registry's code vocabulary; NULL means unselected.
ALTER TABLE "purchase_orders" ADD CONSTRAINT ck_purchase_orders_incoterm_code
  CHECK ("incoterm_code" IS NULL OR "incoterm_code" ~ '^[A-Z0-9]{2,8}$');
--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS ck_purchase_orders_trade_direction;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT ck_purchase_orders_trade_direction
  CHECK ("trade_direction" IS NULL OR "trade_direction" IN ('IMPORT', 'EXPORT'));
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- §2 THE SALES ORDERS' COLUMNS (the export leg — the same pair, the
--    same laws).
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "incoterm_code" text;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "trade_direction" text;
--> statement-breakpoint
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS ck_sales_orders_incoterm_code;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT ck_sales_orders_incoterm_code
  CHECK ("incoterm_code" IS NULL OR "incoterm_code" ~ '^[A-Z0-9]{2,8}$');
--> statement-breakpoint
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS ck_sales_orders_trade_direction;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT ck_sales_orders_trade_direction
  CHECK ("trade_direction" IS NULL OR "trade_direction" IN ('IMPORT', 'EXPORT'));
--> statement-breakpoint
-- The dated column comments (the register's own documentation law).
--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."incoterm_code" IS 'PHASE-051 (T-08, D-10/BR-106): the order''s Incoterms selection — the registry code as snapshot data (validated at create, carried at posting; the tenant-extensible registry, no FK by design) / شرط التجارة المختار — رمز السجل بياناتًا محفوظة';
--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."trade_direction" IS 'PHASE-051 (T-08, D-10/BR-106): the explicit import/export marker — the mandate''s second trigger arm (currency ≠ base OR the marker) / علامة الاستيراد/التصدير — ذراع التفعيل الثاني للإلزام';
--> statement-breakpoint
COMMENT ON COLUMN "sales_orders"."incoterm_code" IS 'PHASE-051 (T-08, D-10/BR-106): the order''s Incoterms selection — the registry code as snapshot data (validated at create, carried at posting; the tenant-extensible registry, no FK by design) / شرط التجارة المختار — رمز السجل بياناتًا محفوظة';
--> statement-breakpoint
COMMENT ON COLUMN "sales_orders"."trade_direction" IS 'PHASE-051 (T-08, D-10/BR-106): the explicit import/export marker — the mandate''s second trigger arm (currency ≠ base OR the marker) / علامة الاستيراد/التصدير — ذراع التفعيل الثاني للإلزام';
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 124)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
