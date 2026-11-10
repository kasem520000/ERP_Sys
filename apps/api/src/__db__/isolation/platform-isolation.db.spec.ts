import { beforeAll, describe, expect, it } from "vitest";

import { appClient, ensureTestDb, superuserClient } from "../test-db";

/**
 * PHASE-004 T1 — the platform-scope GUC mini-matrix (TENANT_ISOLATION_TESTS
 * §9.4: "the platform-scope GUC path on `tenants` gets its own mini-matrix
 * mirroring A1–A5 — wrong/missing platform GUC → 0 rows"):
 *
 * - P1 no GUC: platform surfaces (`tenants`, `plans`, NULL-tenant audit
 *   rows) read 0 rows as erp_app;
 * - P2 a TENANT GUC is not a platform GUC: tenant-scoped sessions see at
 *   most their own tenant row, never the fleet;
 * - P3 wrong/mismatched platform GUC shapes: the platform path reads the
 *   fleet but CANNOT write tenant-scoped audit rows (the WITH CHECK
 *   demands tenant_id IS NULL — a platform admin can never forge a
 *   tenant row);
 * - P4 the platform GUC never opens tenant-owned tables (branches stay
 *   invisible — per-operation tenant scoping is the ONLY console path
 *   into tenant rows, ADR-0005);
 * - P5 with the platform GUC: tenants/plans readable, cross-tenant audit
 *   review sees tenant rows + platform rows alike (platform.audit.view).
 */

/** Dedicated probe tenants — never the shared A/B fixtures (exact-count suites). */
const PROBE_P1 = "99999999-1111-4111-8111-111111111111";
const PROBE_P2 = "99999999-2222-4222-8222-222222222222";

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Probe One (platform matrix)', 'مسبار واحد', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Probe Two (platform matrix)', 'مسبار اثنان', 'AED', 'AE', 'Asia/Dubai')
     ON CONFLICT (id) DO NOTHING`,
    [PROBE_P1, PROBE_P2],
  );
  // One platform-scope audit row (tenant_id NULL) + one row per probe tenant.
  await su.query(
    `INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, via_platform_admin)
     VALUES
       ('cccccccc-0000-4000-8000-000000000001', NULL, 'platform.probe', 'tenant', $1, true),
       ('cccccccc-0000-4000-8000-000000000002', $1, 'tenant.probe', 'tenant', $1, false),
       ('cccccccc-0000-4000-8000-000000000003', $2, 'tenant.probe', 'tenant', $2, false)
     ON CONFLICT (id) DO NOTHING`,
    [PROBE_P1, PROBE_P2],
  );
  await su.end();
});

describe("P1 platform surfaces read 0 rows without any GUC (as erp_app)", () => {
  it("tenants: 0 rows", async () => {
    const app = await appClient();
    const rows = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM tenants`);
    await app.end();
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("plans: 0 rows", async () => {
    const app = await appClient();
    const rows = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM plans`);
    await app.end();
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("audit_events: tenant rows AND platform rows invisible", async () => {
    const app = await appClient();
    const rows = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events`,
    );
    await app.end();
    expect(rows.rows[0]?.n).toBe(0);
  });
});

describe("P2 a tenant GUC is NOT a platform GUC", () => {
  it("tenant-scoped session sees only its own tenant row, never the fleet", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [PROBE_P1]);
    const tenants = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tenants`,
    );
    const plans = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM plans`,
    );
    await app.query("COMMIT");
    await app.end();
    expect(tenants.rows[0]?.n).toBe(1); // own row only
    expect(plans.rows[0]?.n).toBe(3); // plan catalog reads ARE allowed (labels)
  });

  it("tenant-scoped session never sees platform audit rows (NULL tenant)", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [PROBE_P1]);
    const platformRows = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id IS NULL`,
    );
    const ownRows = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1`,
      [PROBE_P1],
    );
    await app.query("COMMIT");
    await app.end();
    expect(platformRows.rows[0]?.n).toBe(0);
    expect(ownRows.rows[0]?.n).toBe(1);
  });
});

describe("P3 platform GUC cannot forge tenant-scoped audit rows", () => {
  it("INSERT with a tenant_id under the platform GUC → 42501", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.platform_scope', 'on', true)");
    await expect(
      app.query(
        `INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, via_platform_admin)
         VALUES ('cccccccc-9000-4000-8000-000000000009', $1, 'forge.tenant', 'tenant', $1, true)`,
        [PROBE_P2],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await app.query("ROLLBACK");
    await app.end();
  });

  it("tenant session cannot forge a platform (NULL) audit row → 42501", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [PROBE_P1]);
    await expect(
      app.query(
        `INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, via_platform_admin)
         VALUES ('cccccccc-9000-4000-8000-00000000000a', NULL, 'forge.platform', 'tenant', $1, true)`,
        [PROBE_P1],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await app.query("ROLLBACK");
    await app.end();
  });

  it("plans writes stay platform-path only: tenant GUC INSERT → 42501", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [PROBE_P1]);
    await expect(
      app.query(
        `INSERT INTO plans (id, key, name, name_ar, price_amount, currency_code, limits, feature_keys)
         VALUES ('31111111-0000-4000-8000-00000000000f', 'rogue', 'Rogue', 'م rogue', 0, 'SAR',
                 '{}'::jsonb, ARRAY['platform.registration'])`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await app.query("ROLLBACK");
    await app.end();
  });
});

describe("P4 the platform GUC never opens tenant-owned tables", () => {
  it("branches/entitlements/settings stay invisible under the platform GUC", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.platform_scope', 'on', true)");
    const branches = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM branches`,
    );
    const entitlements = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM entitlements`,
    );
    const settings = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tenant_settings`,
    );
    await app.query("COMMIT");
    await app.end();
    expect(branches.rows[0]?.n).toBe(0);
    expect(entitlements.rows[0]?.n).toBe(0);
    expect(settings.rows[0]?.n).toBe(0);
  });
});

describe("P5 with the platform GUC the console surface opens (S-07 substrate)", () => {
  it("tenants list sees the fixture fleet + the platform tenant", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.platform_scope', 'on', true)");
    const rows = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tenants WHERE status = 'ACTIVE'`,
    );
    await app.query("COMMIT");
    await app.end();
    // two fixture tenants + the seeded platform-operations tenant
    expect(rows.rows[0]?.n).toBeGreaterThanOrEqual(3);
  });

  it("cross-tenant audit review sees tenant rows AND platform rows", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.platform_scope', 'on', true)");
    const all = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events`,
    );
    const platformOnly = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id IS NULL`,
    );
    await app.query("COMMIT");
    await app.end();
    expect(all.rows[0]?.n).toBeGreaterThanOrEqual(3);
    expect(platformOnly.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it("platform admin can write a platform audit row (tenant_id NULL)", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.platform_scope', 'on', true)");
    const inserted = await app.query(
      `INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, via_platform_admin)
       VALUES ('cccccccc-8000-4000-8000-00000000000b', NULL, 'platform.ok', 'tenant',
               $1, true)`,
      [PROBE_P1],
    );
    await app.query("ROLLBACK");
    await app.end();
    expect(inserted.rowCount).toBe(1);
  });
});
