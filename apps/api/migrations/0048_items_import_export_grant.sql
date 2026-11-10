-- PHASE-035 (Blueprint v3.0 · CR-05) · migration 0048 · the items.import_export
-- grant repair (audit EVAL-F-5 / ERP_FULL_GAP_ANALYSIS H-18): the feature was
-- fully built in PHASE-006 (screen /inventory/import, controller, dry-run
-- validation, import-export.db.spec) but NO plan ever carried the key — the
-- navigation registry item items.import_export (featureKey items.import_export
-- + permission items.import.run) is pruned server-side for every tenant on
-- every plan, so the screen is unreachable from the sidebar (silent
-- activation defect; direct URL still works and the API guard passes).
--
-- Repair: one DATA-ONLY grant following the 0042/0043 plan-grant block
-- precedent (FEATURE_CATALOG §22 protocol step 3): items.import_export joins
-- business + enterprise; starter does NOT get it (the tier-4 precedent —
-- budgeting 0042, payroll 0043 — starter keeps the manual-entry flow only).
-- The BR-040 dependency closure (items.item_master + partners.directory) is
-- already satisfied in both plans (entitlements.db.spec asserts closure per
-- seeded plan; both deps are in the 0008 seeds for all three plans).
--
-- DATA-ONLY: zero new tables/columns/enums/journals/posting rules/
-- permission keys (INV-022; drift stays 245=245 — items.import.run was
-- seeded by 0004 and role-granted by 0005 long ago; this migration moves no
-- permission rows). Idempotent array_cat guard (the 0042/0043 convention:
-- guarded on the single granted key so re-running is a no-op).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Plan grant (the 0042/0043 block): items.import_export → business +
-- enterprise. Starter keeps the manual-entry flow (no bulk import).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['items.import_export'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('items.import_export' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 48)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
