-- PHASE-052 (Blueprint v3.0 · CR-22 — Workflow & Approvals Engine) ·
-- migration 0127 · THE DEFINITIONS REGISTER + THE ORDERED STEPS (T-01,
-- the approved master plan's D-02 slot 1 — the owner's 2026-11-27
-- approval dispatch §1a: the plan approved as it stood, the rulings
-- (أ)–(د) carried; this wave W-43 the foundation).
--
--   §1 workflow_definitions (W-01, D-02): the tenant definition
--     register bound to a trigger entity + event — the FOUR exemplar
--     surfaces of D-05's registry (the owner's ruling (ج): manual_
--     journals · purchase_orders · the 048 change orders · the 051
--     duty drawback claims; every doc type outside the ruled set keeps
--     its existing behavior byte-identical — the out-of-scope
--     prohibition enforced AT THE FLOOR, the closed-vocabulary law
--     with dated additive widenings the only extension path) — with
--     the active flag, the entry conditions jsonb (D-06's evaluator
--     group shape — the shallow object floor here, the deep typed
--     refusals the pure fold's own), the bilingual name (the AR-first
--     law), and the origin_policy_id column from birth (nullable —
--     the bridge's back-reference; the FK itself lands at 0130 per
--     D-02's slot division, the additive 0067/0070 pattern).
--   §2 workflow_steps (W-02, W-05, D-02): the ordered steps — type
--     APPROVAL / NOTIFICATION / TASK (the W-10 scope note: the three
--     step types ONLY, free-form custom actions OUT — DR-052-02's own
--     record), the assignee rule ROLE / USER / FIELD / FORMULA, the
--     branch conditions jsonb (amount thresholds / department / the
--     PHASE-036 custom fields — D-06's operands), the per-step
--     sla_hours, and the bilingual step label. The (tenant,
--     definition, step_order) uniqueness is the visual ordering's own
--     floor (D-14's form-first editor — the order is data, never a
--     canvas).
--
--   THE D-02 DISCLOSURE (the standing law — this provision's final
--   expected fingerprint, the wave's envelope): the chain 126 → 127 ·
--   ENTITY_CATALOG 354 → 356 (this migration's +2; the four slots'
--   +6 together: 354 → 360) · the permissions drift 357 unchanged
--   (the nine workflow.* keys land at 0130 §5, both sides together —
--   zero-drift from the first increment, D-03) · ROUTE_PERMISSIONS
--   1,215 UNCHANGED (keys-seed-first, the 0116 §1 precedent — zero
--   routes before the W-44+ service waves; the matrix §3.30's dated
--   note records it).
--
--   Ledger-free by design (red line §6.3: the workflow engine GATES
--     documents, it never posts — no workflow surface writes a
--     journal entry; zero account purposes, zero CoA markers; the
--     chains gate the EXISTING submit/approve verdicts, the
--     movements/postings stay their modules' own).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. workflow_definitions (W-01, D-02 — the tenant definition register
--    bound to a trigger entity + event; the immutable per-instance
--    snapshot's source).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_definitions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "trigger_entity" text NOT NULL,
  "trigger_event" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "conditions" jsonb NOT NULL DEFAULT '{"all":[]}'::jsonb,
  "origin_policy_id" uuid,
  CONSTRAINT pk_workflow_definitions PRIMARY KEY ("id"),
  CONSTRAINT uq_workflow_definitions_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_workflow_definitions_tenant_name UNIQUE ("tenant_id", "name"),
  -- THE TRIGGER REGISTRY (D-05 — the owner's ruling (ج): the FOUR
  -- exemplar binding set; the vocabulary mapping law binds each doc
  -- type's OWN submit-transition status, never a parallel vocabulary —
  -- the DOCUMENT_LIFECYCLE §2 sovereignty. Every doc type outside the
  -- set keeps its existing behavior byte-identical — the closed floor
  -- below is the out-of-scope prohibition's own structural face;
  -- widenings are dated additive migrations, the 0123 precedent).
  CONSTRAINT ck_workflow_definitions_trigger_entity
    CHECK ("trigger_entity" IN (
      'manual_journal', 'purchase_order', 'change_order', 'duty_drawback_claim'
    )),
  -- THE MAPPING LAW (D-05): PENDING_APPROVAL for journals/POs,
  -- SUBMITTED for the change orders and the drawback claims — the doc
  -- types' own submit-transition statuses.
  CONSTRAINT ck_workflow_definitions_trigger_event
    CHECK ("trigger_event" IN ('PENDING_APPROVAL', 'SUBMITTED')),
  CONSTRAINT ck_workflow_definitions_name_shape
    CHECK ("name" ~ '^[^\n\r\t]{1,200}$' AND "name_ar" ~ '^[^\n\r\t]{1,200}$'),
  -- THE ENTRY CONDITIONS' SHALLOW FLOOR (D-06): a group object
  -- ({"all":[…]} / {"any":[…]}); the deep shape — the operand laws,
  -- the short-circuit AND/OR, the typed refusals naming the condition
  -- BY PATH — is the pure fold's own (W-43, unit-first).
  CONSTRAINT ck_workflow_definitions_conditions_shape
    CHECK (jsonb_typeof("conditions") = 'object')
);

--> statement-breakpoint
-- The engine's hot-path lookup (the phase doc §7's own mitigation:
-- indexed trigger lookups on every submit transition).
CREATE INDEX IF NOT EXISTS ix_workflow_definitions_tenant_trigger
  ON "workflow_definitions" ("tenant_id", "trigger_entity", "trigger_event", "active");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_steps" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "definition_id" uuid NOT NULL,
  "step_order" integer NOT NULL,
  "step_type" text NOT NULL,
  "assignee_rule" text NOT NULL,
  "assignee_value" text NOT NULL,
  "conditions" jsonb NOT NULL DEFAULT '{"all":[]}'::jsonb,
  "sla_hours" integer,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  CONSTRAINT pk_workflow_steps PRIMARY KEY ("id"),
  CONSTRAINT uq_workflow_steps_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_workflow_steps_tenant_definition_order
    UNIQUE ("tenant_id", "definition_id", "step_order"),
  CONSTRAINT fk_workflow_steps_definition
    FOREIGN KEY ("definition_id", "tenant_id")
    REFERENCES "workflow_definitions" ("id", "tenant_id") ON DELETE RESTRICT,
  -- THE ORDERING FLOOR (D-14's form-first editor: the order is data,
  -- 1-based, never a canvas).
  CONSTRAINT ck_workflow_steps_order CHECK ("step_order" >= 1),
  -- THE W-10 SCOPE NOTE (DR-052-02's own record): the three step types
  -- ONLY — APPROVAL / NOTIFICATION / TASK; free-form custom actions
  -- are OUT of scope by the phase doc's own §2.
  CONSTRAINT ck_workflow_steps_type
    CHECK ("step_type" IN ('APPROVAL', 'NOTIFICATION', 'TASK')),
  -- THE ASSIGNEE RULE (W-05): ROLE / USER / FIELD / FORMULA — the
  -- document-derived assignment (the FORMULA rule is the owner's
  -- manager class of the phase doc's own §2).
  CONSTRAINT ck_workflow_steps_assignee_rule
    CHECK ("assignee_rule" IN ('ROLE', 'USER', 'FIELD', 'FORMULA')),
  CONSTRAINT ck_workflow_steps_assignee_value_shape
    CHECK ("assignee_value" ~ '^[A-Za-z0-9_.:@ -]{1,200}$'),
  -- THE BRANCH CONDITIONS' SHALLOW FLOOR (D-06): the same group-object
  -- shape as the entry conditions; the operands (amount thresholds on
  -- the canonical 4-dp string comparisons — the BR-034 compareExact
  -- law; department equality; the PHASE-036 custom-field equality/
  -- range) are the pure fold's own typed laws.
  CONSTRAINT ck_workflow_steps_conditions_shape
    CHECK (jsonb_typeof("conditions") = 'object'),
  -- THE PER-STEP SLA (W-05/D-08): whole hours, at least one — the
  -- escalation sweep's own clock substrate.
  CONSTRAINT ck_workflow_steps_sla_hours
    CHECK ("sla_hours" IS NULL OR "sla_hours" >= 1),
  CONSTRAINT ck_workflow_steps_name_shape
    CHECK ("name" ~ '^[^\n\r\t]{1,200}$' AND "name_ar" ~ '^[^\n\r\t]{1,200}$')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_workflow_steps_tenant_definition
  ON "workflow_steps" ("tenant_id", "definition_id", "step_order");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. RLS — the A1–A10 family over both tables.
--> statement-breakpoint
ALTER TABLE "workflow_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_definitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"workflow_definitions"');
--> statement-breakpoint
ALTER TABLE "workflow_steps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_steps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"workflow_steps"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_definitions', 'workflow_steps'] LOOP
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
-- 3. Grants — the evidence discipline (the definition register is
--    audited configuration: deactivation via the active flag is the
--    path, never row deletion; the immutable snapshots make every
--    historical definition the timeline's own frozen source).
--> statement-breakpoint
REVOKE ALL ON "workflow_definitions" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workflow_definitions" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "workflow_definitions" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "workflow_definitions" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "workflow_steps" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workflow_steps" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "workflow_steps" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "workflow_steps" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "workflow_definitions" IS 'PHASE-052 (W-01, T-01, D-02/D-05): the tenant workflow definition register — bound to a trigger entity + event (the four exemplar surfaces), the entry conditions, the active flag, the immutable per-instance snapshot''s source / سجل تعريفات سير العمل: التعريفات المرتبطة بمستندٍ وحدث إطلاق، وشروط الدخول، ومصدر اللقطة الثابتة لكل حالة';

--> statement-breakpoint
COMMENT ON TABLE "workflow_steps" IS 'PHASE-052 (W-02/W-05, T-01, D-02): the ordered workflow steps — the APPROVAL/NOTIFICATION/TASK type, the ROLE/USER/FIELD/FORMULA assignee rule, the branch conditions, the per-step SLA hours / خطوات سير العمل المرتبة: النوع وقاعدة المكلَّف وشروط التفرع وساعات الخدمة';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 127)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
