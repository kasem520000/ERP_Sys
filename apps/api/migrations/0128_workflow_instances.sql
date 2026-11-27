-- PHASE-052 (W-43 — T-01, dated 2026-11-27) · migration 0128 · THE
-- INSTANCES + THE STEP INSTANCES (D-02 slot 2 — one instance per
-- triggered document, the immutable definition snapshot captured at
-- trigger time; the per-step state ladder with the assignee, the
-- delegated_to provenance, the acted stamps, the comment, and the SLA
-- due floor — the complete step-history record the timeline renders,
-- PP-17's own substrate).
--
--   §1 workflow_instances (W-07): the entity reference (the polymorphic
--     doc pointer — the FOUR exemplar surfaces of D-05's registry, the
--     same closed floor as 0127 §1), the definition SNAPSHOT jsonb
--     (the immutable capture at trigger time — the doc's own
--     "immutable definition snapshot per instance": a definition edited
--     after trigger NEVER rewrites a live instance), the current-step
--     pointer, and the terminal state + stamp — INV-037's own floor:
--     a terminal instance (COMPLETED/CANCELLED) carries its completed_at
--     stamp, and the service layer's typed WORKFLOW_INSTANCE_IMMUTABLE
--     refusal (W-44/D-13) makes every later mutation a typed error.
--     ONE ACTIVE CHAIN PER DOCUMENT — the partial unique index (the
--     terminal instances stand as the frozen history the timeline
--     renders; a re-submitted document opens a NEW chain, never
--     rewrites a terminal one).
--   §2 workflow_step_instances (W-07, PP-17): the per-step state
--     PENDING / APPROVED / REJECTED / SKIPPED / DELEGATED with the
--     resolved assignee, delegated_to, acted_at/acted_by, the comment,
--     and the SLA due_at — THE LADDER'S STAMP LAW at the floor (the
--     declared interpretation, 051's own style): PENDING carries no
--     act and no delegation; DELEGATED awaits the delegate's act (the
--     re-route recorded, the act not yet landed); APPROVED/REJECTED
--     carry the act pair (acted_at + acted_by — delegated_to stays as
--     the provenance when the act came through a window); SKIPPED
--     carries the skip stamp with NO actor (the branch excluded the
--     step — the fold's own verdict, never a user act). The TASK
--     completion write-back IS the step's own act pair (D-11 — the
--     tasks ARE the step instances, no seventh table).
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--   expected fingerprint): the chain 127 → 128 · ENTITY_CATALOG 356 →
--   358 (this migration's +2; the four slots' +6 together: 354 → 360)
--   · the permissions drift 357 unchanged (the nine keys land at 0130
--   §5) · ROUTE_PERMISSIONS 1,215 UNCHANGED (keys-seed-first).
--
--   Ledger-free by design (red line §6.3 — the engine gates, it never
--     posts).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. workflow_instances (W-07, D-02 — one per triggered document; the
--    immutable snapshot + the terminal floor).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_instances" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "definition_id" uuid NOT NULL,
  "trigger_entity" text NOT NULL,
  "trigger_entity_id" uuid NOT NULL,
  "definition_snapshot" jsonb NOT NULL,
  "current_step_order" integer,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "completed_at" timestamptz,
  CONSTRAINT pk_workflow_instances PRIMARY KEY ("id"),
  CONSTRAINT uq_workflow_instances_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_workflow_instances_definition
    FOREIGN KEY ("definition_id", "tenant_id")
    REFERENCES "workflow_definitions" ("id", "tenant_id") ON DELETE RESTRICT,
  -- THE TRIGGER REGISTRY FLOOR (D-05 — the same closed four-member
  -- vocabulary as 0127 §1; the owner's ruling (ج); widenings dated).
  CONSTRAINT ck_workflow_instances_trigger_entity
    CHECK ("trigger_entity" IN (
      'manual_journal', 'purchase_order', 'change_order', 'duty_drawback_claim'
    )),
  -- THE SNAPSHOT FLOOR: a json object captured at trigger time — the
  -- immutable definition record (versioning beyond the snapshot is OUT
  -- of scope by the phase doc's own §2).
  CONSTRAINT ck_workflow_instances_snapshot_shape
    CHECK (jsonb_typeof("definition_snapshot") = 'object'),
  CONSTRAINT ck_workflow_instances_status
    CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  -- THE CURRENT-STEP POINTER: NULL exactly at the terminal states.
  CONSTRAINT ck_workflow_instances_pointer_shape
    CHECK (
      ("status" = 'ACTIVE' AND "current_step_order" IS NOT NULL)
      OR ("status" IN ('COMPLETED', 'CANCELLED') AND "current_step_order" IS NULL)
    ),
  -- INV-037's OWN FLOOR (the terminal immutability — the reserved
  -- wording lands at W-51's canon row; the service layer's typed
  -- WORKFLOW_INSTANCE_IMMUTABLE refusal is W-44/D-13's fold): the
  -- terminal state carries its stamp, TOGETHER.
  CONSTRAINT ck_workflow_instances_terminal_shape
    CHECK (
      ("status" = 'ACTIVE' AND "completed_at" IS NULL)
      OR ("status" IN ('COMPLETED', 'CANCELLED') AND "completed_at" IS NOT NULL)
    )
);

--> statement-breakpoint
-- ONE ACTIVE CHAIN PER DOCUMENT (the declared interpretation: the
-- terminal instances stand as the frozen history — a re-submitted
-- document opens a new chain; the partial unique index is that law's
-- own structural face).
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_instances_live_doc
  ON "workflow_instances" ("tenant_id", "trigger_entity", "trigger_entity_id")
  WHERE "status" = 'ACTIVE';

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_workflow_instances_tenant_definition
  ON "workflow_instances" ("tenant_id", "definition_id");

--> statement-breakpoint
-- The document lookup (the timeline's own anchor — the embedded
-- component on the four bound document detail pages, W-48).
CREATE INDEX IF NOT EXISTS ix_workflow_instances_tenant_doc
  ON "workflow_instances" ("tenant_id", "trigger_entity", "trigger_entity_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. workflow_step_instances (W-07, PP-17, D-11 — the per-step state
--    ladder; the TASK steps ARE these rows).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_step_instances" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "instance_id" uuid NOT NULL,
  "step_order" integer NOT NULL,
  "step_type" text NOT NULL,
  "assignee_user_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "delegated_to" uuid,
  "acted_at" timestamptz,
  "acted_by" uuid,
  "comment" text,
  "due_at" timestamptz,
  CONSTRAINT pk_workflow_step_instances PRIMARY KEY ("id"),
  CONSTRAINT uq_workflow_step_instances_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_workflow_step_instances_tenant_instance_order
    UNIQUE ("tenant_id", "instance_id", "step_order"),
  CONSTRAINT fk_workflow_step_instances_instance
    FOREIGN KEY ("instance_id", "tenant_id")
    REFERENCES "workflow_instances" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_workflow_step_instances_order CHECK ("step_order" >= 1),
  -- The captured step type (the timeline's own row renders it; the
  -- same three-member vocabulary as 0127 §2 — the W-10 scope note).
  CONSTRAINT ck_workflow_step_instances_type
    CHECK ("step_type" IN ('APPROVAL', 'NOTIFICATION', 'TASK')),
  CONSTRAINT ck_workflow_step_instances_status
    CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED', 'DELEGATED')),
  -- THE LADDER'S STAMP LAW (the declared interpretation — the fold's
  -- own matrix, D-13): PENDING carries no act and no delegation;
  -- DELEGATED awaits the delegate's act (the re-route recorded, the
  -- act not yet landed); APPROVED/REJECTED carry the act pair
  -- (delegated_to stays as the act's provenance when it came through
  -- a window); SKIPPED carries the skip stamp with NO actor (the
  -- branch's own verdict, never a user act).
  CONSTRAINT ck_workflow_step_instances_act_shape
    CHECK (
      ("status" = 'PENDING' AND "acted_at" IS NULL AND "acted_by" IS NULL AND "delegated_to" IS NULL)
      OR ("status" = 'DELEGATED' AND "acted_at" IS NULL AND "acted_by" IS NULL AND "delegated_to" IS NOT NULL)
      OR ("status" IN ('APPROVED', 'REJECTED') AND "acted_at" IS NOT NULL AND "acted_by" IS NOT NULL)
      OR ("status" = 'SKIPPED' AND "acted_at" IS NOT NULL AND "acted_by" IS NULL AND "delegated_to" IS NULL)
    )
);

--> statement-breakpoint
-- The approval inbox's own lookup (the PENDING work per assignee —
-- the aging indicators read this index, W-48).
CREATE INDEX IF NOT EXISTS ix_workflow_step_instances_tenant_assignee
  ON "workflow_step_instances" ("tenant_id", "assignee_user_id", "status");

--> statement-breakpoint
-- The SLA sweep's own lookup (the escalation plane — D-08's breach
-- detection over the awaiting steps; the OA-06 budget wave probes
-- this statement's stable plan).
CREATE INDEX IF NOT EXISTS ix_workflow_step_instances_tenant_due
  ON "workflow_step_instances" ("tenant_id", "status", "due_at")
  WHERE "status" IN ('PENDING', 'DELEGATED');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS — the A1–A10 family over both tables.
--> statement-breakpoint
ALTER TABLE "workflow_instances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_instances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"workflow_instances"');
--> statement-breakpoint
ALTER TABLE "workflow_step_instances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_step_instances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"workflow_step_instances"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_instances', 'workflow_step_instances'] LOOP
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
-- 4. Grants — the evidence discipline (the instance + step registers
--    are the timeline's own frozen history: S/I/U, NO DELETE — the
--    terminal records are immutable evidence, INV-037's own law).
--> statement-breakpoint
REVOKE ALL ON "workflow_instances" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workflow_instances" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "workflow_instances" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "workflow_instances" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "workflow_step_instances" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workflow_step_instances" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "workflow_step_instances" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "workflow_step_instances" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "workflow_instances" IS 'PHASE-052 (W-07, T-01, D-02/D-13): the workflow instances — one per triggered document, the immutable definition snapshot, the current-step pointer, the terminal state + stamp (INV-037''s floor) / حالات سير العمل: حالة لكل مستند مُطلَق، بلقطة التعريف الثابتة والحالة الختامية وختمها';

--> statement-breakpoint
COMMENT ON TABLE "workflow_step_instances" IS 'PHASE-052 (W-07/W-08, T-01, D-11/D-13): the per-step instances — the PENDING/APPROVED/REJECTED/SKIPPED/DELEGATED ladder with the assignee, the delegation provenance, the act stamps, the comment, the SLA due floor — the complete step history the timeline renders (PP-17); the TASK steps ARE these rows / خطوات الحالة: سجل كل خطوة بمكلَّفها وختم قرارها وتفويضها وتعليقها ومهلتها — التاريخ الكامل الذي يعرضه المخطط الزمني';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 128)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
