import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PHASE-003 docs-drift checker (PHASE-003 T2; AUTHORIZATION_MATRIX §9.1;
 * REGRESSION_STRATEGY §docs-drift): the `permissions` seed (migration
 * `0004_permissions_seed.sql`) must match the normative catalog in
 * `docs/security/AUTHORIZATION_MATRIX.md` §3 exactly — keys are contracts
 * (ERROR_MODEL §4; matrix §1: tenants compose roles from the catalog and
 * cannot invent keys).
 *
 * Parse rules for the matrix (§3 "Permission catalog by module"):
 * - Only `### 3.x` subsections count; §2 role table, §5 branch rules, §6
 *   portal set and §7 support rows are out of the seeded catalog (portal
 *   keys arrive with PHASE-022; role mapping is template grants, not keys).
 * - A row's first cell holds one or more backticked tokens: full keys
 *   (`sales.invoices.view`) and suffix continuations (`.create`) that expand
 *   against the preceding full key (`sales.invoices.create`).
 *
 * The check is bidirectional (missing in seed / unknown in seed) and
 * fail-closed; the local gate + CI run it on every push.
 */

export interface DriftResult {
  ok: boolean;
  matrixKeys: readonly string[];
  seedKeys: readonly string[];
  missingInSeed: readonly string[];
  unknownInSeed: readonly string[];
}

/** Extract the §3 permission keys from AUTHORIZATION_MATRIX.md. */
export function parseMatrixKeys(matrixMarkdown: string): string[] {
  const keys: string[] = [];
  let inSection3 = false;
  let lastFullKey: string | undefined;

  for (const rawLine of matrixMarkdown.split("\n")) {
    const line = rawLine.trim();
    if (/^##\s/.test(line)) {
      inSection3 = false;
      continue;
    }
    if (/^###\s+3\.\d+/.test(line)) {
      inSection3 = true;
      lastFullKey = undefined;
      continue;
    }
    if (!inSection3 || !line.startsWith("|")) {
      continue;
    }
    const firstCell = line.split("|")[1] ?? "";
    for (const token of [...firstCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)) {
      if (token.startsWith(".")) {
        if (lastFullKey === undefined) {
          throw new Error(`matrix row continues a key without a preceding full key: ${line}`);
        }
        const prefix = lastFullKey.slice(0, lastFullKey.lastIndexOf("."));
        keys.push(`${prefix}${token}`);
      } else if (token.includes(".")) {
        keys.push(token);
        lastFullKey = token;
      }
    }
  }
  return [...new Set(keys)].sort();
}

/** Extract the seeded keys from the permissions seed migration SQL. */
export function parseSeedKeys(seedSql: string): string[] {
  const keys = [...seedSql.matchAll(/^\('([a-z][a-z0-9_.-]+)',/gm)].map((m) => m[1]!);
  return [...new Set(keys)].sort();
}

/** Bidirectional diff (fail-closed on any drift). */
export function diffDrift(matrixKeys: readonly string[], seedKeys: readonly string[]): DriftResult {
  const matrix = new Set(matrixKeys);
  const seed = new Set(seedKeys);
  const missingInSeed = [...matrix].filter((key) => !seed.has(key)).sort();
  const unknownInSeed = [...seed].filter((key) => !matrix.has(key)).sort();
  return {
    ok: missingInSeed.length === 0 && unknownInSeed.length === 0,
    matrixKeys,
    seedKeys,
    missingInSeed,
    unknownInSeed,
  };
}

function resolveMonorepoPath(relative: string): string {
  const candidates = [join(process.cwd(), relative), join(process.cwd(), "..", "..", relative)];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`check-permissions-drift: cannot resolve ${relative} from ${process.cwd()}`);
}

export function runDriftCheck(matrixMarkdown: string, seedSql: string): DriftResult {
  return diffDrift(parseMatrixKeys(matrixMarkdown), parseSeedKeys(seedSql));
}

/**
 * CLI entry (scripts/check-permissions-drift.ts): exit code 1 on any
 * drift. The seed side is the UNION of every permission-seeding migration
 * (0004 base set + later phase migrations that seed `permissions` rows —
 * PHASE-016 0024 added the pos.* family; PHASE-018 0026 added the
 * manufacturing.* family; PHASE-019 0027 re-asserts the crm base set and
 * adds crm.contracts.bill + accounting.projects.manage): a key seeded
 * anywhere counts.
 */
const PERMISSION_SEED_MIGRATIONS: readonly string[] = [
  "apps/api/migrations/0004_permissions_seed.sql",
  "apps/api/migrations/0024_pos_core.sql",
  "apps/api/migrations/0025_automotive_distribution.sql",
  "apps/api/migrations/0026_manufacturing.sql",
  "apps/api/migrations/0027_crm_projects.sql",
  // PHASE-020: 0029 re-asserts the four sync-plane keys (sync.devices.*,
  // sync.settings.manage, identity.devices.manage — seeded at 0004 base,
  // going live with the device registry).
  "apps/api/migrations/0029_sync_foundation.sql",
  // PHASE-023 T8: 0035 seeds sales.commerce.manage (the commerce-channel
  // import gate — operator-plane, granted to platform ops roles only).
  "apps/api/migrations/0035_external_integrations.sql",
  // PHASE-036 (Blueprint v3.0 · CR-06): 0049 seeds the three extensibility
  // keys (configuration.custom_fields.read/.manage +
  // configuration.form_layouts.manage — matrix §3.8; 245 → 248).
  "apps/api/migrations/0049_custom_fields.sql",
  // PHASE-037 (Blueprint v3.0 · CR-07): 0050 seeds the one ZATCA device
  // key (tax.einvoicing.devices.manage — matrix §3.7; 248 → 249).
  "apps/api/migrations/0050_zatca_phase1.sql",
  // PHASE-038 (Blueprint v3.0 · CR-08): 0051 seeds the SEVEN sourcing
  // keys (matrix §3.16; 249 → 256).
  "apps/api/migrations/0051_rfq_quotes.sql",
  // PHASE-039 (Blueprint v3.0 · CR-09; extended by v3.1/CR-46 +
  // v3.2/CR-50): 0056 seeds the NINE returns & collections keys
  // (matrix §3.17; 256 → 265) — sales.rma.read/manage/approve,
  // sales.dunning.manage, sales.warranties.manage, sales.late-fees.manage,
  // sales.collection-agencies.manage, purchasing.rma.read/manage.
  "apps/api/migrations/0056_dunning_collections.sql",
  // PHASE-040 (Blueprint v3.0 · CR-10): 0060 seeds the TWO data-onboarding
  // keys (matrix §3.18; 265 → 267) — configuration.imports.manage +
  // configuration.demo_data.manage (the doc's platform.* names renamed:
  // matrix §3.10 + the identity-flows checklist pin platform.* as never
  // tenant-assignable — recorded deviation in the completion report §4).
  "apps/api/migrations/0060_import_toolkit.sql",
  // PHASE-041 (Blueprint v3.0 · CR-11): 0064 seeds the FIVE communications
  // keys (matrix §3.19; 267 → 272) — communication.templates.manage,
  // communication.outbox.read, communication.preferences.manage,
  // communication.inbox.read, communication.calendar.connect.
  "apps/api/migrations/0064_communications_hub.sql",
  // PHASE-042 (Blueprint v3.0 · CR-12, extended by v3.1/CR-45 L2-12):
  // 0065 seeds the SIX manufacturing-execution keys (matrix §3.20;
  // 272 → 278) — manufacturing.work_centers.manage,
  // manufacturing.routings.manage, manufacturing.shopfloor.execute,
  // manufacturing.rework_orders.manage, manufacturing.downtime.log,
  // manufacturing.oee.read; 0066 seeds the seventh (278 → 279) —
  // manufacturing.standard_costs.manage.
  "apps/api/migrations/0065_routing_work_centers.sql",
  "apps/api/migrations/0066_standard_costing.sql",
  // PHASE-044 (Blueprint v3.0 · CR-14): 0071 seeds the EIGHT WMS keys
  // (matrix §3.21; 279 → 287) — inventory.wms.locations,
  // inventory.wms.putaway, inventory.wms.picking, inventory.cycle_counts,
  // inventory.abc, inventory.tracking.serial_ledger, inventory.quarantine,
  // inventory.tracking.consignment.
  "apps/api/migrations/0071_wms_seeds.sql",
  // PHASE-043 (Blueprint v3.0 · CR-13): 0078 seeds the FOUR planning keys
  // (matrix §3.22; 287 → 291) — manufacturing.mrp, manufacturing.mps,
  // manufacturing.planning_policies, manufacturing.mps.frozen_edit (the
  // DATA-DEPENDENT frozen-fence override — granted to owner + accountant,
  // resolved per request by the MPS service against the entry's bucket).
  "apps/api/migrations/0078_mrp_seeds.sql",
  // PHASE-045 (Blueprint v3.0 · CR-15): 0086 seeds the SIX HR-core keys
  // (matrix §3.23; 291 → 297) — hr.attendance, hr.attendance.import,
  // hr.shifts, hr.overtime, hr.leave, hr.self_service (the SoD-scoped
  // self surface — the employee↔user link resolves the OWN-rows scope).
  "apps/api/migrations/0086_hr_seeds.sql",
  // PHASE-046 (Blueprint v3.0 · CR-16): 0092 seeds the THREE compliance
  // keys (matrix §3.24; 297 → 300) — payroll.statutory, payroll.eosb
  // (owner + accountant + payroll_officer) and payroll.statutory.verify
  // (owner-only — the BR-085 verification act, SoD-bound: the verifier ≠
  // the row's last editor).
  "apps/api/migrations/0092_payroll_statutory_seeds.sql",
  // PHASE-047 (Blueprint v3.0 · CR-17): 0098 seeds the TWELVE talent
  // keys (matrix §3.25; 300 → 312) — the four flag families
  // (hr.performance.view/manage/review · hr.recruitment.view/manage/
  // interview · hr.training.view/manage · hr.org.view/manage) plus the
  // two cross-cutting keys (hr.documents.manage · hr.competency.manage).
  // Role grants: the owner template holds all twelve; the accountant the
  // four view keys (the finance side's read plane); no other system role
  // (talent management is tenant-granted beyond the baseline).
  "apps/api/migrations/0098_hr_talent_grants.sql",
  // PHASE-048 (Blueprint v3.0 · CR-18, the W-8 foundation wave,
  // 2026-11-20): 0103 §1 seeds the FOURTEEN projects keys (matrix §3.26;
  // 312 → 326) — projects.wbs.view/manage · projects.budget.view/manage
  // · projects.allocation.manage · projects.change_order.view/approve ·
  // projects.contracting.view/manage · projects.certificates.approve ·
  // projects.retention.manage · projects.evm.view ·
  // projects.fieldservice.view/dispatch. Role grants: the owner template
  // holds all fourteen; the accountant the five finance-read view keys.
  "apps/api/migrations/0103_projects_contracting_fieldservice.sql",
  // PHASE-049 (Blueprint v3.0 · CR-19 extended by v3.2/CR-50, the W-16
  // foundation wave, 2026-11-21): 0108 §1 seeds the TEN assets keys
  // (matrix §3.27; 326 → 336) — assets.maintenance.view/manage/plan ·
  // assets.meters.view/record · assets.spares.manage ·
  // assets.transfer.view/approve · assets.tags.manage ·
  // assets.expiry.view. Role grants: the owner template holds all ten;
  // the accountant the two finance-read view keys (maintenance.view —
  // INV-034's GL reconciliation plane; expiry.view — the renewal
  // registers); the operational keys stay owner-only.
  "apps/api/migrations/0108_cmms_asset_extensions.sql",
  // PHASE-049 (W-19 — the tags + sweep wave, 2026-11-21): 0111 §2 seeds
  // the ONE sweep threshold key (matrix §3.27; 336 → 337) —
  // assets.expiry.manage: the sweep's threshold settings surface over
  // the first 049 settings keys (assets.expiry_sweep_thresholds). Role
  // grants: the owner template holds it; no other system role (the
  // sweep's configuration is an operational act; the accountant's
  // finance-read plane stays at assets.expiry.view).
  "apps/api/migrations/0111_cmms_sweep_settings.sql",
  // PHASE-050 (CR-20 — QMS, the W-24 foundation wave, 2026-11-22):
  // 0116 §5a seeds the TEN quality keys (matrix §3.28; 337 → 347) —
  // quality.view/manage · quality.ncr.manage · quality.capa.manage ·
  // quality.calibration.manage · quality.spc.view ·
  // quality.complaints.manage · quality.coa.generate ·
  // quality.hold.manage · quality.recall.manage. Role grants: the owner
  // template holds all ten; the accountant the ONE finance-read key
  // (quality.view — the G-62/G-63 GL reconciliation's read plane); the
  // operational keys stay owner-only.
  "apps/api/migrations/0116_quality_holds_recall.sql",
];

export async function main(): Promise<void> {
  const matrixPath = resolveMonorepoPath("docs/security/AUTHORIZATION_MATRIX.md");
  const seedSql = PERMISSION_SEED_MIGRATIONS.map((relative) =>
    readFileSync(resolveMonorepoPath(relative), "utf8"),
  ).join("\n");
  const result = runDriftCheck(readFileSync(matrixPath, "utf8"), seedSql);
  for (const key of result.missingInSeed) {
    console.error(`[permissions-drift] IN MATRIX BUT NOT SEEDED: ${key}`);
  }
  for (const key of result.unknownInSeed) {
    console.error(`[permissions-drift] SEEDED BUT NOT IN MATRIX: ${key}`);
  }
  console.log(
    `[permissions-drift] ${result.ok ? "OK" : "FAILED"} — matrix ${result.matrixKeys.length} keys, seed ${result.seedKeys.length} keys`,
  );
  if (!result.ok) {
    process.exitCode = 1;
  }
}
