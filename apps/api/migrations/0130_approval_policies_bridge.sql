-- PHASE-052 (W-43 — T-01 + T-05's substrate, dated 2026-11-27) ·
-- migration 0130 · THE APPROVAL-POLICIES BRIDGE SUBSTRATE + THE
-- DATA-ONLY GRANTS BLOCK (D-02 slot 4 — the origin_policy_id FK
-- back-reference to the converted approval_policies row (the column
-- itself was born at 0127; the FK + the lookup index land here, the
-- additive 0067/0070 pattern) + the nine workflow.* permission keys
-- and the five feature flags — the 0122 pattern verbatim).
--
--   §1 THE BRIDGE SUBSTRATE (D-12): workflow_definitions.origin_
--     policy_id — the nullable back-reference from a CONVERTED
--     definition to its source approval_policies row (the conversion
--     tool itself is W-46's engine wave: none → the honest no-chain
--     row; single-approver → the one-step APPROVAL chain; two-step →
--     the two-step chain (the manual_journals approval_step semantics
--     verbatim); amount-threshold → the branch pair — the BR-034
--     comparison law preserved). The lookup index is the parity
--     test's own plane (the documents gated before/after, W-46).
--   §2 THE NINE PERMISSION KEYS + the role grants (matrix §3.30; the
--     drift 357 → 366 — zero-drift from the first increment, seed =
--     mirror; the owner's ruling (ب): the keys ship as workflow.*,
--     NOT platform.workflow.* — the dated deviation from the phase
--     doc §4's letter UPHELD under the 0060 law: platform.* is the
--     never-tenant-assignable namespace, and these are tenant-facing
--     role keys): the owner template holds all nine; the accountant
--     the ONE finance-read key (workflow.history.view — the timeline
--     read plane on the documents the finance roles already read;
--     the operational keys stay owner-only).
--   §3 THE PLAN GRANTS (the 050 precedent — THE DECLARED NEUTRAL
--     ZERO): business + enterprise carry the FIVE FEATURE FLAGS —
--     workflow.engine (the runtime engine + the bridge — the base
--     unit) · workflow.definitions (the chain editor plane) ·
--     workflow.delegation · workflow.escalation · workflow.tasks.
--     STARTER GETS NONE. NO INDUSTRY-TEMPLATE MANIFEST ENABLEMENTS
--     (D-04: the engine is a HORIZONTAL capability — plan-gated,
--     never template-gated; the capabilities matrix stays agreeing
--     with zero delta).
--   THE COMPOSITION LAW (D-04, the catalog's own): workflow.engine
--     stands on platform.branches (the payroll.employees precedent —
--     the assignee resolution and the delegation windows ride the
--     branch/user substrate, never a new substrate); the four planes
--     compose workflow.engine (the trade.lc-on-trade pattern).
--
--   THE D-02 DISCLOSURE (the standing law — the wave's own final
--   expected fingerprint): the chain 129 → 130 · ENTITY_CATALOG 360
--   (ZERO table delta — this migration adds no tables; the four
--   slots' +6 together: 354 → 360) · the permissions drift 357 → 366
--   (the +9 keys, D-03 — zero-drift from the first increment, both
--   sides together) · ROUTE_PERMISSIONS 1,215 UNCHANGED (keys-seed-
--   first, the 0116 §1 precedent — zero routes before the W-44+
--   service waves; the matrix §3.30's dated note records it).
--
--   Ledger-free by design (red line §6.3 — the engine gates, it
--     never posts; zero account purposes, zero CoA markers, zero
--     seeds — the definitions and windows are tenant-created DATA).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. THE BRIDGE SUBSTRATE (D-12 — the FK back-reference + the lookup
--    index; the additive 0067/0070 pattern).
--> statement-breakpoint
ALTER TABLE "workflow_definitions"
  ADD CONSTRAINT fk_workflow_definitions_origin_policy
    FOREIGN KEY ("origin_policy_id", "tenant_id")
    REFERENCES "approval_policies" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- The bridge's lookup plane (the parity test walks the converted
-- definitions by their source rows; the partial index carries only
-- the converted — the native definitions never enter it).
CREATE INDEX IF NOT EXISTS ix_workflow_definitions_tenant_origin_policy
  ON "workflow_definitions" ("tenant_id", "origin_policy_id")
  WHERE "origin_policy_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. THE DATA-ONLY GRANTS BLOCK (the 0098/0103/0108/0116/0122
--    pattern) — (a) the nine permission keys + the role grants
--    (matrix §3.30; the drift 357 → 366 — zero-drift from the first
--    increment, seed = mirror; the owner's ruling (ب): workflow.*,
--    never platform.workflow.*).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('workflow.definitions.manage', 'workflow', 'Manage the workflow definitions — the chain editor: the ordered steps, the branch conditions, the SLA, the assignee rules / إدارة تعريفات سير العمل: محرر السلاسل والخطوات وشروط التفرع والمهل والمكلَّفين'),
('workflow.approve', 'workflow', 'The approve/reject act on a workflow step / إجراء الموافقة أو الرفض على خطوة سير العمل'),
('workflow.inbox.act', 'workflow', 'Act on the approval inbox — the pending work with the aging indicators and the quick actions / التعامل على صندوق الموافقات: الأعمال المعلقة ومؤشرات التقادم والإجراءات السريعة'),
('workflow.delegate', 'workflow', 'Create one''s own delegation windows (the absence re-route) / إنشاء نوافذ التفويض الشخصية أثناء الغياب'),
('workflow.history.view', 'workflow', 'View the workflow timeline — the full step history on every bound document (PP-17) / عرض المخطط الزمني لسير العمل: التاريخ الكامل لكل خطوة على المستند'),
('workflow.escalation.manage', 'workflow', 'Configure the escalation plane — the SLA actions and the reminder cadence / إعداد التصعيد: إجراءات تجاوز المهلة وإيقاع التذكيرات'),
('workflow.tasks.manage', 'workflow', 'Manage the document-linked tasks (the TASK steps) / إدارة المهام المرتبطة بالمستندات'),
('workflow.delegations.manage', 'workflow', 'Administer all delegation windows tenant-wide / إدارة نوافذ التفويض على مستوى المنشأة'),
('workflow.settings.admin', 'workflow', 'Administer the engine settings (the reminder cadence registry) / إدارة إعدادات محرك سير العمل')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'workflow.definitions.manage', 'workflow.approve', 'workflow.inbox.act',
  'workflow.delegate', 'workflow.history.view', 'workflow.escalation.manage',
  'workflow.tasks.manage', 'workflow.delegations.manage',
  'workflow.settings.admin'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- The accountant's finance-read plane (the 0122 single-read-key
-- precedent): the timeline read on the documents the finance roles
-- already read — the journal approval's own history surface; the
-- operational keys stay owner-only.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'workflow.history.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. THE PLAN GRANTS — business + enterprise carry the five flags;
--    STARTER stays at THE DECLARED NEUTRAL ZERO (the 050 precedent —
--    the engine is a horizontal capability, not a starter feature).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'workflow.engine', 'workflow.definitions', 'workflow.delegation',
  'workflow.escalation', 'workflow.tasks'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('workflow.engine' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 130)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
