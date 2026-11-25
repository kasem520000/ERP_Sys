-- PHASE-051 (Blueprint v3.0 · CR-21 — Foreign Trade & Logistics) ·
-- migration 0121 · THE CUSTOMS/BONDED/DRAWBACK CLUSTER (T-03, the
-- approved master plan's D-02 slot 3: customs_declarations — office,
-- type import/export/transit, status, the receipt/PO link ·
-- customs_declaration_lines — HS code, origin, quantities, customs
-- value, duty rate, duty amount, import VAT · hs_code_registry — the
-- tenant-extensible starter set · bonded_warehouse_moves — the G-66
-- duty-suspended anchor · duty_drawback_claims — the BR-108
-- export-evidence gate).
--
--   §1 customs_declarations (L-06, D-06/D-07): the declaration
--     register — the customs office, the type (import/export/transit),
--     the status ladder with the stamp law (COMPLETED carries its
--     completed_at — INV-036's own floor: a customs-duty landed-cost
--     allocation on an import receipt REQUIRES a COMPLETED
--     declaration reference), the receipt/PO links (the import chain)
--     and the B/L link (the tracking fold's declaration arm + the
--     drawback export evidence). The duties and import VAT flow into
--     the EXISTING landed-cost allocation at W-37 (G-65 — a
--     landed-cost document of kind customs sourced from the
--     declaration's OWN lines, the REAL LandedCostsService the ONLY
--     allocator, VERBATIM). The shipment_status mirror is the fold's
--     driven surface. Evidence: S/I/U, NO DELETE (the declaration is
--     the customs audit trail).
--   §2 customs_declaration_lines (L-07/L-08, G-65): the declaration's
--     own rows — HS code, origin country, quantities, customs value,
--     duty rate, duty amount, import VAT. THE NO-HARDCODED-RATES LAW
--     (red line 5, the phase doc §7's own mitigation): the rates are
--     TENANT DATA on these lines, never seeded, never defaulted to a
--     jurisdiction's figure; the line math is W-37's pure fold (the
--     Decimal discipline — ADR-0009). uq per (tenant, declaration,
--     line_no); every allocated duty ties to its declaration line
--     (INV-036's own demand — the line-level linkage recorded on the
--     allocation at W-37). Evidence: S/I/U.
--   §3 hs_code_registry (L-08, D-16): the tenant-extensible starter
--     set — NO duty rates anywhere on these rows (a missing HS code is
--     MISSING, never invented; the starter rows carry the accuracy
--     disclaimer in their note; the tenant owns the final
--     classification). The seed lands at 0122 §6. Master data: grants
--     S/I/U/D.
--   §4 bonded_warehouse_moves (L-14, D-08 — the G-66 anchor): the
--     duty-suspended move record — IN_BOND (the transfer inside the
--     bond: the physical move rides the REAL movement core at W-38,
--     moveKind transfer, sourced bonded_move, ONE ambient transaction,
--     NO duty entry — the no-duty floor here) and RELEASE (the
--     release into free circulation: the duty recognized EXACTLY ONCE
--     — BR-107 — through the G-65-shaped recognition at release, the
--     stamps pair atomic: duty_amount + release_journal_entry_id +
--     release_recognized_at TOGETHER, INV-013 single-use on
--     (bonded_warehouse_moves, id, release); the recognition requires
--     the declaration link — the G-65 shape's own source law). The
--     lines array carries the move's own lines (the fourteen-table
--     budget has no child table — the 050 CAPA actions precedent).
--     Evidence: S/I/U, NO DELETE.
--   §5 duty_drawback_claims (L-12, D-12 — the BR-108 gate): the
--     drawback claim register — the export-evidence link (the export
--     declaration OR the export bill of lading), the claimed amounts,
--     the status workflow. THE EVIDENCE FLOOR: submission requires the
--     linked export evidence (status past DRAFT ⇒ at least one
--     evidence link — the typed refusal at the service names the claim
--     + the missing evidence; the floor keeps the register honest).
--     THE CLAIM CARRIES NO GL ENTRY (the non-ledger-document law, the
--     050 note-20 pattern: the claim is a registry record; the refund
--     money lands when treasury records it — the honest boundary,
--     053's surface). Evidence: S/I/U, NO DELETE.
--   §6 THE ADDITIVE CERTIFICATE LINK (the 0067/0070 pattern):
--     certificates_of_origin.declaration_id — the declaration link
--     0120 §4 could not carry (customs_declarations did not exist at
--     that slot); the composite-FK law applies.
--
--   THE D-02 DISCLOSURE (the standing law): the chain 120 → 121 ·
--     ENTITY_CATALOG 348 → 353 (this migration's +5) → 354 at 0122 ·
--     the permissions drift 347 unchanged here · ROUTE_PERMISSIONS
--     1,159 unchanged (keys-seed-first).
--
--   Ledger-free by design (G-65 is W-37's service wave through the
--     REAL LandedCostsService; G-66's release recognition is W-38's;
--     the canon rows are W-42's — this migration creates the stamps,
--     never a posting surface).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. customs_declarations (L-06 — the declaration register).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customs_declarations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "declaration_no" text NOT NULL,
  "declaration_type" text NOT NULL,
  "customs_office" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "submitted_at" timestamptz,
  "accepted_at" timestamptz,
  "completed_at" timestamptz,
  "receipt_id" uuid,
  "purchase_order_id" uuid,
  "bill_of_lading_id" uuid,
  "shipment_status" text NOT NULL DEFAULT 'BOOKED',
  "currency" varchar(3) NOT NULL,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_customs_declarations PRIMARY KEY ("id"),
  CONSTRAINT uq_customs_declarations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_customs_declarations_tenant_no UNIQUE ("tenant_id", "declaration_no"),
  CONSTRAINT fk_customs_declarations_receipt
    FOREIGN KEY ("receipt_id", "tenant_id")
    REFERENCES "goods_receipts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_customs_declarations_po
    FOREIGN KEY ("purchase_order_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_customs_declarations_bl
    FOREIGN KEY ("bill_of_lading_id", "tenant_id")
    REFERENCES "bills_of_lading" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_customs_declarations_type
    CHECK ("declaration_type" IN ('IMPORT', 'EXPORT', 'TRANSIT')),
  CONSTRAINT ck_customs_declarations_status
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'COMPLETED', 'CANCELLED')),
  -- THE LADDER'S STAMP LAW (INV-036's own floor: a customs-duty
  -- landed-cost allocation requires a COMPLETED declaration — the
  -- completion stamp exists only on the COMPLETED rung, the acceptance
  -- only past ACCEPTED, the submission only past SUBMITTED; DRAFT and
  -- CANCELLED carry no stamps at all).
  CONSTRAINT ck_customs_declarations_submitted_shape
    CHECK (
      ("status" IN ('SUBMITTED', 'ACCEPTED', 'COMPLETED') AND "submitted_at" IS NOT NULL)
      OR ("status" NOT IN ('SUBMITTED', 'ACCEPTED', 'COMPLETED')
           AND "submitted_at" IS NULL)
    ),
  CONSTRAINT ck_customs_declarations_accepted_shape
    CHECK (
      ("status" IN ('ACCEPTED', 'COMPLETED') AND "accepted_at" IS NOT NULL)
      OR ("status" NOT IN ('ACCEPTED', 'COMPLETED') AND "accepted_at" IS NULL)
    ),
  CONSTRAINT ck_customs_declarations_completed_shape
    CHECK (
      ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
      OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL)
    ),
  -- THE FOLD'S DRIVEN MIRROR (D-14): the declaration's logistics
  -- status — distinct from the customs ladder above (the customs
  -- status is the customs office's own fact; this mirror is the
  -- tracking fold's driven surface, the monotone ladder's vocabulary
  -- kept at the floor).
  CONSTRAINT ck_customs_declarations_shipment_status
    CHECK (
      "shipment_status" IN ('BOOKED', 'DEPARTED', 'ARRIVED', 'CLEARED', 'DELIVERED')
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_customs_declarations_tenant_status
  ON "customs_declarations" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_customs_declarations_tenant_receipt
  ON "customs_declarations" ("tenant_id", "receipt_id")
  WHERE "receipt_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_customs_declarations_tenant_po
  ON "customs_declarations" ("tenant_id", "purchase_order_id")
  WHERE "purchase_order_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_customs_declarations_tenant_bl
  ON "customs_declarations" ("tenant_id", "bill_of_lading_id")
  WHERE "bill_of_lading_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. customs_declaration_lines (L-07/L-08, G-65 — the duty/VAT math's
--    own rows; the rates are tenant DATA).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customs_declaration_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "declaration_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "hs_code" text NOT NULL,
  "origin_country" varchar(2),
  "item_id" uuid,
  "description" text,
  "quantity" numeric(19, 6),
  "uom" text,
  "customs_value" numeric(19, 4) NOT NULL,
  "duty_rate" numeric(9, 6) NOT NULL DEFAULT 0,
  "duty_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "import_vat" numeric(19, 4) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_customs_declaration_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_customs_declaration_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_customs_declaration_lines_tenant_decl_line
    UNIQUE ("tenant_id", "declaration_id", "line_no"),
  CONSTRAINT fk_customs_declaration_lines_declaration
    FOREIGN KEY ("declaration_id", "tenant_id")
    REFERENCES "customs_declarations" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_customs_declaration_lines_item
    FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_customs_declaration_lines_line_no
    CHECK ("line_no" > 0),
  CONSTRAINT ck_customs_declaration_lines_hs_code
    CHECK ("hs_code" ~ '^[0-9]{2,10}$'),
  -- THE NO-HARDCODED-RATES LAW: the rates and amounts are the tenant's
  -- own rows — non-negative, never seeded with a jurisdiction's
  -- figure; a zero rate is the explicit tenant statement (EXW/free),
  -- never a fabricated default. The line math fold is W-37's (the
  -- Decimal discipline — ADR-0009).
  CONSTRAINT ck_customs_declaration_lines_amounts
    CHECK (
      "customs_value" >= 0 AND "duty_rate" >= 0
      AND "duty_amount" >= 0 AND "import_vat" >= 0
      AND ("quantity" IS NULL OR "quantity" >= 0)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_customs_declaration_lines_tenant_decl
  ON "customs_declaration_lines" ("tenant_id", "declaration_id", "line_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_customs_declaration_lines_tenant_hs
  ON "customs_declaration_lines" ("tenant_id", "hs_code");
--> statement-breakpoint
-- OA-06's own anchor (the W-41 budgets probe the declaration-lines
-- statement's stable plan: the tenant+declaration index-driven law).
CREATE INDEX IF NOT EXISTS ix_customs_declaration_lines_tenant_item
  ON "customs_declaration_lines" ("tenant_id", "item_id")
  WHERE "item_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. hs_code_registry (L-08, D-16 — the tenant-extensible starter set;
--    NO duty rates on these rows, ever).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hs_code_registry" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "hs_code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "note" text,
  "note_ar" text,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_hs_code_registry PRIMARY KEY ("id"),
  CONSTRAINT uq_hs_code_registry_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_hs_code_registry_tenant_code UNIQUE ("tenant_id", "hs_code"),
  CONSTRAINT ck_hs_code_registry_code
    CHECK ("hs_code" ~ '^[0-9]{2,10}$'),
  CONSTRAINT ck_hs_code_registry_names
    CHECK ("name" ~ '.{2,160}' AND "name_ar" ~ '.{2,160}')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_hs_code_registry_tenant_active
  ON "hs_code_registry" ("tenant_id", "is_active", "hs_code");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. bonded_warehouse_moves (L-14, D-08 — the G-66 duty-suspended
--    anchor: IN_BOND the no-duty transfer, RELEASE the exactly-once
--    recognition).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bonded_warehouse_moves" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "move_no" text NOT NULL,
  "move_kind" text NOT NULL,
  "from_warehouse_id" uuid,
  "to_warehouse_id" uuid,
  "declaration_id" uuid,
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "executed_at" timestamptz,
  "duty_amount" numeric(19, 4),
  "release_recognized_at" timestamptz,
  "release_journal_entry_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_bonded_warehouse_moves PRIMARY KEY ("id"),
  CONSTRAINT uq_bonded_warehouse_moves_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_bonded_warehouse_moves_tenant_no UNIQUE ("tenant_id", "move_no"),
  CONSTRAINT fk_bonded_warehouse_moves_from_wh
    FOREIGN KEY ("from_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_bonded_warehouse_moves_to_wh
    FOREIGN KEY ("to_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_bonded_warehouse_moves_declaration
    FOREIGN KEY ("declaration_id", "tenant_id")
    REFERENCES "customs_declarations" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_bonded_warehouse_moves_release_journal
    FOREIGN KEY ("release_journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_bonded_warehouse_moves_kind
    CHECK ("move_kind" IN ('IN_BOND', 'RELEASE')),
  CONSTRAINT ck_bonded_warehouse_moves_status
    CHECK ("status" IN ('DRAFT', 'EXECUTED')),
  CONSTRAINT ck_bonded_warehouse_moves_lines_shape
    CHECK (jsonb_typeof("lines") = 'array'),
  -- THE EXECUTION STAMP LAW: an executed move carries its execution
  -- stamp, a draft carries none.
  CONSTRAINT ck_bonded_warehouse_moves_executed_shape
    CHECK (
      ("status" = 'EXECUTED' AND "executed_at" IS NOT NULL)
      OR ("status" = 'DRAFT' AND "executed_at" IS NULL)
    ),
  -- THE G-66 NO-DUTY FLOOR: an in-bond transfer NEVER carries a duty
  -- figure, a recognition stamp, or a release entry — moves inside
  -- the bond post NO duty (the plan's own law at the DB floor).
  CONSTRAINT ck_bonded_warehouse_moves_in_bond_no_duty
    CHECK (
      "move_kind" = 'RELEASE'
      OR (
        "duty_amount" IS NULL AND "release_recognized_at" IS NULL
        AND "release_journal_entry_id" IS NULL
      )
    ),
  -- THE BR-107 EXACTLY-ONCE FLOOR: on the RELEASE kind the
  -- recognition pair is ATOMIC (the duty figure, the stamp, and the
  -- recognition time TOGETHER — never a recognized release without
  -- its entry, never an entry without the figure); the recognition
  -- requires the declaration link (the G-65 shape's own source law —
  -- the duty recognized is the declaration's own figure).
  CONSTRAINT ck_bonded_warehouse_moves_release_shape
    CHECK (
      ("move_kind" = 'RELEASE' AND "duty_amount" IS NOT NULL
         AND "release_recognized_at" IS NOT NULL
         AND "release_journal_entry_id" IS NOT NULL
         AND "declaration_id" IS NOT NULL)
      OR ("move_kind" = 'RELEASE' AND "duty_amount" IS NULL
           AND "release_recognized_at" IS NULL
           AND "release_journal_entry_id" IS NULL)
      OR ("move_kind" = 'IN_BOND')
    ),
  CONSTRAINT ck_bonded_warehouse_moves_duty_amount
    CHECK ("duty_amount" IS NULL OR "duty_amount" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bonded_warehouse_moves_tenant_kind
  ON "bonded_warehouse_moves" ("tenant_id", "move_kind", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bonded_warehouse_moves_tenant_declaration
  ON "bonded_warehouse_moves" ("tenant_id", "declaration_id")
  WHERE "declaration_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. duty_drawback_claims (L-12, D-12 — the BR-108 evidence gate; NO
--    GL entry by design).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "duty_drawback_claims" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "claim_no" text NOT NULL,
  "export_declaration_id" uuid,
  "export_bill_of_lading_id" uuid,
  "claimed_amount" numeric(19, 4) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "submitted_at" timestamptz,
  "decided_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_duty_drawback_claims PRIMARY KEY ("id"),
  CONSTRAINT uq_duty_drawback_claims_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_duty_drawback_claims_tenant_no UNIQUE ("tenant_id", "claim_no"),
  CONSTRAINT fk_duty_drawback_claims_declaration
    FOREIGN KEY ("export_declaration_id", "tenant_id")
    REFERENCES "customs_declarations" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_duty_drawback_claims_bl
    FOREIGN KEY ("export_bill_of_lading_id", "tenant_id")
    REFERENCES "bills_of_lading" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_duty_drawback_claims_status
    CHECK (
      "status" IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAID')
    ),
  CONSTRAINT ck_duty_drawback_claims_amount
    CHECK ("claimed_amount" > 0),
  -- THE BR-108 EVIDENCE FLOOR: submission requires the linked export
  -- evidence — the export declaration OR the export bill of lading;
  -- a claim past DRAFT without either is refused here (the typed
  -- refusal at the W-38 service names the claim + the missing
  -- evidence; the floor keeps the register honest).
  CONSTRAINT ck_duty_drawback_claims_evidence
    CHECK (
      "status" = 'DRAFT'
      OR "export_declaration_id" IS NOT NULL
      OR "export_bill_of_lading_id" IS NOT NULL
    ),
  -- THE WORKFLOW STAMPS: submitted only past SUBMITTED, decided only
  -- on the decided rungs (APPROVED/REJECTED/PAID).
  CONSTRAINT ck_duty_drawback_claims_submitted_shape
    CHECK (
      ("status" <> 'DRAFT' AND "submitted_at" IS NOT NULL)
      OR ("status" = 'DRAFT' AND "submitted_at" IS NULL)
    ),
  CONSTRAINT ck_duty_drawback_claims_decided_shape
    CHECK (
      ("status" IN ('APPROVED', 'REJECTED', 'PAID') AND "decided_at" IS NOT NULL)
      OR ("status" NOT IN ('APPROVED', 'REJECTED', 'PAID') AND "decided_at" IS NULL)
    )
  -- THE NO-GL SHAPE (D-12): no journal column by design — the claim
  -- is a registry record (the 050 note-20 non-ledger-document law);
  -- the refund money lands when treasury records it (053's surface).
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_duty_drawback_claims_tenant_status
  ON "duty_drawback_claims" ("tenant_id", "status", "submitted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_duty_drawback_claims_tenant_declaration
  ON "duty_drawback_claims" ("tenant_id", "export_declaration_id")
  WHERE "export_declaration_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_duty_drawback_claims_tenant_bl
  ON "duty_drawback_claims" ("tenant_id", "export_bill_of_lading_id")
  WHERE "export_bill_of_lading_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. THE ADDITIVE CERTIFICATE LINK (the 0067/0070 pattern): the
--    certificates' declaration link — 0120 §4's own deferred column
--    (customs_declarations did not exist at that slot); the
--    composite-FK law applies.
--> statement-breakpoint
ALTER TABLE "certificates_of_origin"
  ADD COLUMN IF NOT EXISTS "declaration_id" uuid;
--> statement-breakpoint
-- The 0116 §7 shape (the additive DROP+ADD guard; the column is empty
-- here — the constraint validates trivially on the from-zero chain).
ALTER TABLE "certificates_of_origin"
  DROP CONSTRAINT IF EXISTS fk_certificates_of_origin_declaration;
--> statement-breakpoint
ALTER TABLE "certificates_of_origin"
  ADD CONSTRAINT fk_certificates_of_origin_declaration
  FOREIGN KEY ("declaration_id", "tenant_id")
  REFERENCES "customs_declarations" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. RLS — the A1–A10 family over the five tables.
--> statement-breakpoint
ALTER TABLE "customs_declarations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customs_declarations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"customs_declarations"');
--> statement-breakpoint
ALTER TABLE "customs_declaration_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customs_declaration_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"customs_declaration_lines"');
--> statement-breakpoint
ALTER TABLE "hs_code_registry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hs_code_registry" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"hs_code_registry"');
--> statement-breakpoint
ALTER TABLE "bonded_warehouse_moves" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bonded_warehouse_moves" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bonded_warehouse_moves"');
--> statement-breakpoint
ALTER TABLE "duty_drawback_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "duty_drawback_claims" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"duty_drawback_claims"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customs_declarations', 'customs_declaration_lines', 'hs_code_registry',
    'bonded_warehouse_moves', 'duty_drawback_claims'
  ] LOOP
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
-- 8. Grants — the master-data registry vs the evidence discipline.
--> statement-breakpoint
REVOKE ALL ON "customs_declarations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "customs_declarations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "customs_declarations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "customs_declarations" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "customs_declaration_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "customs_declaration_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "customs_declaration_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "customs_declaration_lines" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "hs_code_registry" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hs_code_registry" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "hs_code_registry" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "hs_code_registry" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "bonded_warehouse_moves" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bonded_warehouse_moves" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "bonded_warehouse_moves" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "bonded_warehouse_moves" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "duty_drawback_claims" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "duty_drawback_claims" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "duty_drawback_claims" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "duty_drawback_claims" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "customs_declarations" IS 'PHASE-051 (L-06, T-03, D-06/D-07): the customs declarations register — the status ladder whose COMPLETED rung is INV-036''s own floor, the receipt/PO/B-L links of the import chain, the duties flowing into the existing landed-cost allocation at G-65 / سجل الإقرارات الجمركية: سلّم الحالة واكتماله أرضية INV-036 والرسوم تتدفق إلى توزيع التكاليف الأرضية';
--> statement-breakpoint
COMMENT ON TABLE "customs_declaration_lines" IS 'PHASE-051 (L-07/L-08, T-03, G-65): the declaration''s own lines — HS code, origin, quantities, customs value, the tenant''s own duty rates (never seeded, never hardcoded) and import VAT / سطور الإقرار: رموز المنشأ والقيمة الجمركية ورسوم المستأجر نفسه';
--> statement-breakpoint
COMMENT ON TABLE "hs_code_registry" IS 'PHASE-051 (L-08, T-03, D-16): the tenant-extensible HS starter registry — no duty rates on these rows, the accuracy disclaimer on the starter set, the tenant owns the final classification / سجل رموز النظام المنسق: مجموعة استهلالية قابلة للتوسيع بلا رسوم نهائية';
--> statement-breakpoint
COMMENT ON TABLE "bonded_warehouse_moves" IS 'PHASE-051 (L-14, T-03, D-08): the bonded warehouse moves — the G-66 anchor: in-bond transfers carry NO duty (the floor), the release recognizes the duty exactly once (BR-107''s atomic stamps) / حركات المستودع الجمركي: النقل داخل الضمان بلا رسوم والإفراج يعترف بالرسم مرة واحدة';
--> statement-breakpoint
COMMENT ON TABLE "duty_drawback_claims" IS 'PHASE-051 (L-12, T-03, D-12): the duty drawback claims — the BR-108 export-evidence gate at the floor, the claim carrying NO GL entry by design (the refund lands in treasury) / طلبات استرداد الرسوم: بوابة الدليل التصديري ولا قيد محاسبي في الطلب نفسه';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 121)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
