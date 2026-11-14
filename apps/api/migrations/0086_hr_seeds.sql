-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0086 · HR Core —
-- Attendance, Leaves & Shifts (part 7: the DATA-ONLY seed — the 0078
-- pattern).
--
--   §1 the SIX permission keys (matrix §3.20):
--        hr.attendance        — manage attendance records + the register
--        hr.attendance.import — run the device-import wizard (commit)
--        hr.shifts            — manage shifts + the roster grid
--        hr.overtime          — manage overtime rules + approve entries
--        hr.leave             — manage leave types + approve requests
--        hr.self_service      — the employee self-service tabs (own
--                               attendance calendar, own leave + balance,
--                               own roster — the SoD-scoped read surface)
--      Role tiers (the 0078 precedent): owner + accountant take the
--      management keys; the viewer role takes NONE (HR data visibility
--      rides HR permissions, never user administration — the
--      authorization-matrix SoD note); hr.self_service is granted to
--      every authenticated employee-role shape at the APPLICATION
--      boundary (the linked-user check), seeded here to the owner tier
--      only — the drift check's seeded-set equality is what matters.
--   §2 the THREE feature plan grants (the tier-4 precedent: business +
--      enterprise only — HR is not a starter feature):
--        hr.attendance.* · hr.leave.* · hr.shifts.* (template-composable
--        grants, CR-36 (f))
--   §3 the default leave types (§2.6): DECIDED to nothing here — the
--      table is tenant-scoped (no global row exists to seed); the
--      ANNUAL/SICK/UNPAID defaults land per tenant at the leave
--      service's first use (accrual 0.00 — the BR-055 no-fabricated-
--      defaults discipline; statutory quantities are PHASE-046's
--      jurisdiction regime, never fabricated).
--   §4 the workforce-industry manifest enablement — DEFERRED to the
--      phase's T-15 web step BY DECISION (recorded in the kickoff): the
--      enablement is one coherent change with the CANONICAL manifests
--      (packages/contracts/src/industry/templates.ts — the code source of
--      truth), the specs' pinned manifest hashes, and the starter-plan
--      degradation-chain pins; doing the DB half alone (the 0078 §4
--      shape) desyncs the stored manifests from the canonical hash the
--      apply service verifies. The keys themselves are registered now
--      (FEATURE_DEPS + the module segment + the plan grants — §2), so
--      nothing blocks the later enablement.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. Permission keys (the six, matrix §3.20).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('hr.attendance', 'hr', 'Manage attendance records and the daily register / إدارة سجلات الحضور وسجل اليوم'),
('hr.attendance.import', 'hr', 'Run and commit the attendance device import / تشغيل وتثبيت استيراد الحضور من الأجهزة'),
('hr.shifts', 'hr', 'Manage shifts and the roster grid / إدارة الورديات وجداول الدوام'),
('hr.overtime', 'hr', 'Manage overtime rules and approve entries / إدارة قواعد العمل الإضافي واعتماد السجلات'),
('hr.leave', 'hr', 'Manage leave types and approve requests / إدارة أنواع الإجازات واعتماد الطلبات'),
('hr.self_service', 'hr', 'Employee self-service: own attendance, leave, and roster / الخدمة الذاتية: حضوري وإجازاتي وجدولي')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'hr.attendance', 'hr.attendance.import', 'hr.shifts', 'hr.overtime', 'hr.leave', 'hr.self_service'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'hr.attendance', 'hr.attendance.import', 'hr.shifts', 'hr.overtime', 'hr.leave'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. Feature plan grants (the tier-4 precedent — business + enterprise).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys", ARRAY[
  'hr.attendance', 'hr.leave', 'hr.shifts'
])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('hr.attendance' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Default leave types — NOTHING seeded here, by decision (recorded in
--    the kickoff): leave_types is a TENANT-scoped table (tenant_id NOT
--    NULL — there is no global row to seed, unlike 0078's global
--    lot_sizing_rules catalog); the phase plan's "default leave types"
--    seed item maps to the PER-TENANT provisioning path — the leave
--    service's first-use default (ANNUAL/SICK/UNPAID at accrual 0.00,
--    the BR-055 no-fabricated-defaults discipline; statutory quantities
--    are PHASE-046's jurisdiction regime).

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 86)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
