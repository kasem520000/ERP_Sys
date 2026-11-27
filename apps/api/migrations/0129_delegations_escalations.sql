-- PHASE-052 (W-43 — T-01, dated 2026-11-27) · migration 0129 · THE
-- DELEGATION WINDOWS + THE ESCALATION EVENTS (D-02 slot 3 — the
-- absence windows with the from→to users and the module/entity/all
-- scope; the SLA-breach detections with the reassign/add-level/
-- notification actions and the recurring reminders — the structural
-- dedupe at the floor, the 0111/0123 axes law).
--
--   §1 delegations (W-03, D-07): the absence windows — from_user →
--     to_user, the scope kind ALL / MODULE / ENTITY with its value
--     (the pair law at the floor), the starts_at/ends_at window (ends
--     strictly after starts), and NO self-delegation (the trivial
--     cycle refused at the floor — the G-67 graph walk's own seed
--     law; the transitive circularity rejection at save is the pure
--     fold's own typed refusal, W-43 unit-first). The windows are
--     tenant DATA (the BR-055 family: the engine never invents an
--     assignee; an unresolvable rule is a typed refusal — fail-closed,
--     never a fallback to the creator).
--   §2 escalation_events (W-05, W-06, D-08): the SLA-breach
--     detections — the kind vocabulary REASSIGN / ADD_LEVEL / NOTIFY /
--     REMINDER (the escalation actions per the step's config + the
--     recurring reminders on the settings registry's cadence), the
--     due_date DAY AXIS (the dedupe key's own axis — one event per
--     step + kind + day, the structural dedupe AT THE FLOOR: the
--     uq_escalation_events_dedupe uniqueness), and the action's own
--     payload record (the reassign from→to, the notification refs).
--     The sweep itself is W-45's engine (the 05:45 cron, the DB-clock
--     law, the audit seal, the entitlement gate, the per-tenant
--     catch-and-continue) — this table is its append-only evidence.
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--   expected fingerprint): the chain 128 → 129 · ENTITY_CATALOG 358 →
--   360 (this migration's +2; the four slots' +6 together: 354 → 360)
--   · the permissions drift 357 unchanged (the nine keys land at 0130
--   §5) · ROUTE_PERMISSIONS 1,215 UNCHANGED (keys-seed-first).
--
--   Ledger-free by design (red line §6.3 — the engine gates, it never
--     posts; the delegation windows and the SLA configs are tenant
--     DATA).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. delegations (W-03, D-07 — the absence windows).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delegations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "from_user_id" uuid NOT NULL,
  "to_user_id" uuid NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_value" text,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_delegations PRIMARY KEY ("id"),
  CONSTRAINT uq_delegations_id_tenant UNIQUE ("id", "tenant_id"),
  -- THE NO-SELF-DELEGATION FLOOR (the G-67 graph walk's own seed law:
  -- the trivial cycle refused here; the transitive circularity is the
  -- pure fold's typed refusal naming the chain — D-07, W-43).
  CONSTRAINT ck_delegations_no_self CHECK ("from_user_id" <> "to_user_id"),
  -- THE SCOPE PAIR LAW: ALL carries no value; MODULE/ENTITY carry
  -- exactly one (the module key / the entity type — the resolution
  -- plane's own vocabulary, D-07).
  CONSTRAINT ck_delegations_scope_shape
    CHECK (
      ("scope_kind" = 'ALL' AND "scope_value" IS NULL)
      OR ("scope_kind" IN ('MODULE', 'ENTITY') AND "scope_value" IS NOT NULL)
    ),
  CONSTRAINT ck_delegations_scope_kind
    CHECK ("scope_kind" IN ('ALL', 'MODULE', 'ENTITY')),
  -- THE WINDOW LAW: strictly positive (an empty or inverted window is
  -- never an absence).
  CONSTRAINT ck_delegations_window CHECK ("ends_at" > "starts_at")
);

--> statement-breakpoint
-- The resolution lookup (the act-time re-route walks the ACTIVE
-- windows by the from_user — D-07's own law: the resolution happens
-- at the moment of the act).
CREATE INDEX IF NOT EXISTS ix_delegations_tenant_from
  ON "delegations" ("tenant_id", "from_user_id", "starts_at", "ends_at");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. escalation_events (W-05, W-06, D-08 — the SLA-breach detections;
--    the append-only evidence the sweep writes).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "escalation_events" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "step_instance_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "due_date" date NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "note" text,
  CONSTRAINT pk_escalation_events PRIMARY KEY ("id"),
  CONSTRAINT uq_escalation_events_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_escalation_events_step_instance
    FOREIGN KEY ("step_instance_id", "tenant_id")
    REFERENCES "workflow_step_instances" ("id", "tenant_id") ON DELETE RESTRICT,
  -- THE ACTION VOCABULARY (D-08): the escalation actions per the
  -- step's config (REASSIGN / ADD_LEVEL / NOTIFY) + the recurring
  -- REMINDER on the settings registry's cadence.
  CONSTRAINT ck_escalation_events_kind
    CHECK ("kind" IN ('REASSIGN', 'ADD_LEVEL', 'NOTIFY', 'REMINDER')),
  CONSTRAINT ck_escalation_events_payload_shape
    CHECK (jsonb_typeof("payload") = 'object'),
  -- THE STRUCTURAL DEDUPE AT THE FLOOR (the 0111/0123 axes law —
  -- `workflow:sla:{stepInstanceId}:{kind}:{dueDate}`: the day axis
  -- the due date; one event per step + kind + day, EVER — the sweep's
  -- own idempotence is the index, never a read-check race).
  CONSTRAINT uq_escalation_events_dedupe
    UNIQUE ("tenant_id", "step_instance_id", "kind", "due_date")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_escalation_events_tenant_step
  ON "escalation_events" ("tenant_id", "step_instance_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS — the A1–A10 family over both tables.
--> statement-breakpoint
ALTER TABLE "delegations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "delegations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"delegations"');
--> statement-breakpoint
ALTER TABLE "escalation_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "escalation_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"escalation_events"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delegations', 'escalation_events'] LOOP
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
-- 4. Grants — the evidence discipline (the escalation events are
--    append-only sweep evidence: S/I/U, NO DELETE; the delegation
--    windows are tenant DATA — editable, never deleted).
--> statement-breakpoint
REVOKE ALL ON "delegations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "delegations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "delegations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "delegations" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "escalation_events" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "escalation_events" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "escalation_events" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "escalation_events" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "delegations" IS 'PHASE-052 (W-03, T-01, D-07): the absence delegation windows — from→to users, the module/entity/all scope, the window bounds; the active windows re-route PENDING steps at act time / نوافذ التفويض أثناء الغياب: من وإلى، ونطاق التفويض ومدة النافذة';

--> statement-breakpoint
COMMENT ON TABLE "escalation_events" IS 'PHASE-052 (W-05/W-06, T-01, D-08): the SLA-breach escalation events — the reassign/add-level/notification actions and the recurring reminders, one per step + kind + day (the structural dedupe) / أحداث التصعيد عند تجاوز المهلة: الإجراءات والتذكيرات الدورية، واحدة لكل خطوة ونوع ويوم';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 129)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
