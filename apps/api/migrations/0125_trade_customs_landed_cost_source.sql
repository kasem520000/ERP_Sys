-- PHASE-051 (W-37 — T-10, dated 2026-11-25) · migration 0125 · THE
-- LANDED-COST DECLARATION SOURCE (D-06/D-15(a)'s own structural demand:
-- the customs landed-cost document records ITS declaration — the
-- document-level source + the line-level tie on the allocation rows —
-- and ONE customs landed-cost document exists per declaration, ever;
-- the 0123/0124 additive-slot precedent's class — a service wave's
-- structural demand lands as its own dated additive slot, ordered WITH
-- the writers under the 0099/0111 same-increment law).
--
--   §1 THE LANDED-COST DOCUMENT SOURCE: landed_costs.declaration_id
--     (nullable — an ordinary freight/insurance/other landed cost
--     carries NULL, the pre-051 behavior untouched; a customs landed
--     cost sourced by the declaration's completion act carries the
--     declaration's id — the composite FK to customs_declarations, the
--     D-15(a) documented contract's own column). THE EXACTLY-ONCE
--     INDEX: one PARTIAL UNIQUE index on (tenant_id, declaration_id)
--     WHERE declaration_id IS NOT NULL — INV-036's own single-use face
--     at the relational floor (the completed declaration's duties
--     allocate ONCE, ever: a second customs landed cost sourcing the
--     same declaration is refused at the DB floor before any journal —
--     the INV-013 discipline's structural twin, D-06's own wording
--     «INV-013 single-use on (customs_declaration, id)» rendered as the
--     declaration-source uniqueness; the completion CAS (the stamp law)
--     is the service's own face of the same exactly-once).
--   §2 THE DECLARATION'S OWN LINKAGE PAIR: customs_declarations.
--     landed_cost_id + landed_cost_no (nullable — DRAFT/SUBMITTED/
--     ACCEPTED rows carry NULL; the COMPLETED rung's stamp law lands
--     them TOGETHER with completed_at in the SAME CAS statement — the
--     0119 LC precedent's own shape (the register row carries its
--     document links); NO FK by design on the no column (the official
--     number is display data; the id column carries the composite FK).
--   §3 THE ALLOCATION ROWS' LINE-LEVEL TIE:
--     landed_cost_allocations.declaration_line_id (nullable — the
--     ordinary allocations carry NULL; the customs allocation rows
--     carry the declaration line of their item, D-06's own demand
--     «every allocated duty tied to its declaration line (the
--     line-level linkage recorded on the allocation — INV-036's own
--     demand)»; the composite FK to customs_declaration_lines; the tie
--     map is resolved by the TRADE gate (the declaration's own lines
--     joined to the GRN's stock lines by item — the one-line-per-item
--     exactness law) and passed through the LandedCostService's post
--     — the documented contract, never a cross-module read).
--
--   THE ADDITIVE-SLOT LAW (the 0117/0118/0123/0124 precedent's own
--   class — the master plan's four declared slots 0119–0122 are
--   consumed at W-33 and PUBLISHED (the constants law: no touching any
--   published migration); a service wave's structural demand lands as
--   its own dated additive slot. The chain 124 → 125; the phase's final
--   fingerprint carries the dated disclosure at every claim site.
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--   expected fingerprint): the chain 124 → 125 · ENTITY_CATALOG 354
--   (ZERO table delta — this migration adds NO tables, only the two
--   additive nullable columns + the partial unique index on EXISTING
--   tables) · the permissions drift 357 unchanged (the W-37 routes
--   bind the EXISTING 0122-seeded keys — trade.customs.view over the
--   reads, trade.customs.manage over the register acts; no new key) ·
--   ROUTE_PERMISSIONS 1,188 + 11 = 1,199 (the W-37 dated delta at the
--   block — the customs family, the keys-seed-first discipline's
--   FOURTH trade binding wave).
--
--   Ledger-free by design: zero journal rules, zero invariants, zero
--   account purposes (G-65 posts through the REAL LandedCostService
--   VERBATIM — the existing landed-cost journal shape, the
--   CUSTOMS_DUTY_PAYABLE charge account resolved at the act, the
--   0122 §8 marker standing; the canon rows are W-42's; the
--   reservation law rides it: no identifier outside G-64…G-66 ·
--   INV-036 · BR-105…BR-108 anywhere in this file); zero grants
--   changes (the columns ride the existing table grants — column-level
--   grants do not exist in this schema); zero seeds.
--
--   NULLABLE-ADDITIVE (the 0052/0076/0124 pattern): every existing
--   row carries NULL on both columns — an ordinary landed cost
--   created before W-37 never trips the customs floor (the
--   non-duty landed costs' behavior never restated narrower).

SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- §1 THE LANDED-COST DOCUMENT SOURCE (D-06/D-15(a) — the declaration's
--    own landed-cost document + the exactly-once index).
--> statement-breakpoint
ALTER TABLE "landed_costs" ADD COLUMN IF NOT EXISTS "declaration_id" uuid;
--> statement-breakpoint
ALTER TABLE "landed_costs" DROP CONSTRAINT IF EXISTS fk_landed_costs_declaration;
--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT fk_landed_costs_declaration
  FOREIGN KEY ("declaration_id", "tenant_id")
  REFERENCES "customs_declarations" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
-- INV-036's single-use face at the relational floor: ONE customs
-- landed-cost document per declaration, ever (the partial unique — the
-- ordinary NULL-source rows are untouched).
CREATE UNIQUE INDEX IF NOT EXISTS uq_landed_costs_tenant_declaration
  ON "landed_costs" ("tenant_id", "declaration_id")
  WHERE "declaration_id" IS NOT NULL;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- §2 THE DECLARATION'S OWN LINKAGE PAIR (the completion stamp's own
--    columns — the 0119 LC precedent's document-link shape).
--> statement-breakpoint
ALTER TABLE "customs_declarations" ADD COLUMN IF NOT EXISTS "landed_cost_id" uuid;
--> statement-breakpoint
ALTER TABLE "customs_declarations" ADD COLUMN IF NOT EXISTS "landed_cost_no" text;
--> statement-breakpoint
ALTER TABLE "customs_declarations" DROP CONSTRAINT IF EXISTS fk_customs_declarations_landed_cost;
--> statement-breakpoint
ALTER TABLE "customs_declarations" ADD CONSTRAINT fk_customs_declarations_landed_cost
  FOREIGN KEY ("landed_cost_id", "tenant_id")
  REFERENCES "landed_costs" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- §3 THE ALLOCATION ROWS' LINE-LEVEL TIE (D-06 — «every allocated duty
--    tied to its declaration line», INV-036's own demand).
--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD COLUMN IF NOT EXISTS "declaration_line_id" uuid;
--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" DROP CONSTRAINT IF EXISTS fk_landed_cost_allocations_declaration_line;
--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT fk_landed_cost_allocations_declaration_line
  FOREIGN KEY ("declaration_line_id", "tenant_id")
  REFERENCES "customs_declaration_lines" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
-- The dated column comments (the register's own documentation law).
--> statement-breakpoint
COMMENT ON COLUMN "landed_costs"."declaration_id" IS 'PHASE-051 (W-37 — T-10, D-06/D-15(a)): the customs landed-cost document''s own declaration source — the completion act''s linkage (one customs landed cost per declaration, ever: uq_landed_costs_tenant_declaration) / مصدر الإقرار الجمركي لوثيقة التكاليف الأرضية الجمركية';
--> statement-breakpoint
COMMENT ON COLUMN "customs_declarations"."landed_cost_id" IS 'PHASE-051 (W-37 — T-10, D-06): the completion act''s landed-cost document id — the G-65 flow''s own linkage (landed together with completed_at in the completion CAS) / وثيقة التكاليف الأرضية للإقرار عند الاكتمال';
--> statement-breakpoint
COMMENT ON COLUMN "customs_declarations"."landed_cost_no" IS 'PHASE-051 (W-37 — T-10, D-06): the completion act''s landed-cost official number (display data — the id column is the linkage) / رقم وثيقة التكاليف الأرضية';
--> statement-breakpoint
COMMENT ON COLUMN "landed_cost_allocations"."declaration_line_id" IS 'PHASE-051 (W-37 — T-10, D-06/INV-036): the allocation row''s declaration line — the line-level tie (every allocated duty tied to its declaration line; the tie map resolved by the trade gate, passed through the LandedCostService''s post) / سطر الإقرار المرتبط بصف التوزيع';
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 125)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
