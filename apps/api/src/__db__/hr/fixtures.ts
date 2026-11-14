import type { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { ShiftService } from "../../modules/hr/application/shift-service";

/**
 * PHASE-045 (T-03) — the HR suite's lean fixture: tenant H (+ the shared
 * seeded tenants), the H_ACTOR user, and two employees on the payroll
 * substrate (direct SQL — the employees table is the 029 baseline; the
 * hr store reads it under RLS). The shift/roster world is created
 * per-test (unlike the heavy domain fixtures, shifts are cheap).
 */

export const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
export const H_ACTOR = "7a7a7a7a-0000-4000-8000-0000000007a1";

const audit = new AuditService(new DrizzleAuditStore());

export const shiftSvc = new ShiftService(audit);

export interface HrFixture {
  /** EMP-H1 — the rotation employee. */
  employeeH1Id: string;
  /** EMP-H2 — the second rotation employee. */
  employeeH2Id: string;
}

let fixture: HrFixture | undefined;

export async function setupHrFixture(): Promise<HrFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const suClient: Client = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant H (hr core)', 'المستأجر هـ', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_H],
  );
  await suClient.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'hr-actor@fixture.test', 'HR Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [H_ACTOR],
  );
  await suClient.end();

  fixture = await withTenant(TENANT_H, async () => {
    // The ambient tenant transaction (RLS scoped — the app-role insert
    // carries erp.current_tenant_id()); a raw appClient would lack the
    // tenant GUC and hit the RLS wall.
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const { sql } = await import("drizzle-orm");
    const rows = await requireTenantContext().tx!.execute<{ id: string; code: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), 'EMP-H1', 'Hassan Al-Roster', 'حسن الجدولة', '2026-01-01', 'FULL_TIME', 8000, ${H_ACTOR}),
        (gen_random_uuid(), erp.current_tenant_id(), 'EMP-H2', 'Huda Al-Shift', 'هدى الوردية', '2026-01-01', 'FULL_TIME', 9000, ${H_ACTOR})
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, code
    `);
    const byCode = new Map(rows.rows.map((row) => [row.code, row.id]));
    return {
      employeeH1Id: byCode.get("EMP-H1")!,
      employeeH2Id: byCode.get("EMP-H2")!,
    };
  });
  return fixture;
}

export { appClient, closeDb, superuserClient, withTenant };
