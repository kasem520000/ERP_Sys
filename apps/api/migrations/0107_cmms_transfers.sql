-- PHASE-049 (Blueprint v3.0 · CR-19, extended by v3.2/CR-50) · migration
-- 0107 · CMMS — Asset Maintenance (part 3: the branch transfers with
-- the approval ladder — T-03, the plan §2's honest slot).
--
--   asset_transfers (D-06 — FA-F-07, BR-100): from/to branch, reason,
--     the DRAFT→SUBMITTED→APPROVED/REJECTED ladder with the verdict
--     stamps (the 048 change-orders gate shape). On approval (G-61, the
--     W-18 service through the REAL engine, INV-013 idempotent, posted
--     EXACTLY ONCE — BR-100): the asset's branch_id flips to the
--     destination AND the NBV reclassification posts (DR the
--     destination branch's mapped asset account · CR the source
--     branch's mapped asset account; the branch↔account mapping
--     resolved fail-closed PURPOSE_NOT_MAPPED until the tenant maps
--     the pair — the mapping check BEFORE the flip, the 038/0077
--     discipline) — ONE transaction, the asset row's cost/accumulated
--     columns UNTOUCHED (the branch dimension carries the move; the
--     depreciation engine continues unimpeded, D-01). The G-61 journal
--     stamp exists only on the approved path (the 0103 invoice-gate
--     precedent). Evidence discipline: NO delete (REJECTED stays
--     readable — the contract history, the 0103 change_orders
--     precedent).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. asset_transfers (the ladder + the verdict stamps + the G-61 gate).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_transfers" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "asset_id" uuid NOT NULL,
  "from_branch_id" uuid NOT NULL,
  "to_branch_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "reason_ar" text,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "rejected_at" timestamptz,
  "rejected_by" uuid,
  "reject_reason" text,
  "journal_entry_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_asset_transfers PRIMARY KEY ("id"),
  CONSTRAINT uq_asset_transfers_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_asset_transfers_asset
    FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_asset_transfers_from_branch
    FOREIGN KEY ("from_branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_asset_transfers_to_branch
    FOREIGN KEY ("to_branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_asset_transfers_journal
    FOREIGN KEY ("journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_asset_transfers_status
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  CONSTRAINT ck_asset_transfers_branches
    CHECK ("from_branch_id" <> "to_branch_id"),
  -- The ladder's stamp law (the 0103 shape): DRAFT carries no stamps;
  -- SUBMITTED the submission; APPROVED/REJECTED exactly their own
  -- verdict pair (never both — the XOR law).
  CONSTRAINT ck_asset_transfers_stamps
    CHECK (
      ("status" = 'DRAFT' AND "submitted_at" IS NULL AND "approved_at" IS NULL
         AND "rejected_at" IS NULL AND "reject_reason" IS NULL)
      OR ("status" = 'SUBMITTED' AND "submitted_at" IS NOT NULL
           AND "approved_at" IS NULL AND "rejected_at" IS NULL
           AND "reject_reason" IS NULL)
      OR ("status" = 'APPROVED' AND "submitted_at" IS NOT NULL
           AND "approved_at" IS NOT NULL AND "rejected_at" IS NULL
           AND "reject_reason" IS NULL)
      OR ("status" = 'REJECTED' AND "submitted_at" IS NOT NULL
           AND "approved_at" IS NULL AND "rejected_at" IS NOT NULL
           AND "reject_reason" IS NOT NULL)
    ),
  -- The G-61 stamp exists only on the approved path (BR-100's
  -- exactly-once floor: the guarded single-consumption UPDATE is the
  -- W-18 engine's; the column's gate is the DB's).
  CONSTRAINT ck_asset_transfers_journal_gated
    CHECK ("journal_entry_id" IS NULL OR "status" = 'APPROVED')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_transfers_tenant_asset
  ON "asset_transfers" ("tenant_id", "asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_transfers_tenant_status
  ON "asset_transfers" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_transfers_tenant_to_branch
  ON "asset_transfers" ("tenant_id", "to_branch_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "asset_transfers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_transfers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"asset_transfers"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_transfers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS purge_path_delete ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS purge_path_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY purge_path_delete ON public.%I FOR DELETE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY purge_path_update ON public.%I FOR UPDATE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)', t);
  END LOOP;
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Grants — the evidence discipline (the ladder is history).
--> statement-breakpoint
REVOKE ALL ON "asset_transfers" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "asset_transfers" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "asset_transfers" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "asset_transfers" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "asset_transfers" IS 'PHASE-049 (D-06 — BR-100/G-61): asset transfers between branches — the DRAFT→SUBMITTED→APPROVED/REJECTED ladder; on approval the branch flip + the NBV reclassification post in ONE transaction (exactly once, fail-closed until the branch↔account pair is mapped; the asset''s own carrying value UNTOUCHED) / نقل الأصول بين الفروع: سلم موافقة، وعند الاعتماد يتقلب الفرع ويعاد تصنيف القيمة الدفترية الصافية في معاملة واحدة وبمرة واحدة';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 107)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
