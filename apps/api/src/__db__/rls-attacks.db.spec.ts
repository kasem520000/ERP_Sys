import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appClient,
  ensureTestDb,
  seedTenants,
  superuserClient,
  TENANT_A,
  TENANT_B,
} from "./test-db";

/**
 * TENANT_ISOLATION §5 attack matrix against the PHASE-002 infrastructure
 * tables (`audit_events`, `tenants`) on real PostgreSQL 16 — every attack is
 * REQUIRED to fail closed. The connection runs as `erp_app` (non-owner,
 * RLS enforced) exactly like the production pool.
 */

const OWN_ROW_A = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_ROW_B = "aaaaaaaa-2222-4222-8222-222222222222";

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await seedTenants(su);
  await su.query(
    `INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id) VALUES
       ($1, $2, 'invoice.created', 'sales_invoice', $2),
       ($3, $4, 'invoice.created', 'sales_invoice', $4)
     ON CONFLICT (id) DO NOTHING`,
    [OWN_ROW_A, TENANT_A, OTHER_ROW_B, TENANT_B],
  );
  await su.end();
});

afterAll(async () => {
  const su = await superuserClient();
  // Superuser bypasses RLS but NOT the append-only trigger — prove A5 hygiene
  // by leaving the rows in place: audit_events are append-only by design and
  // the suite never deletes them (counts are always tenant/entity filtered).
  await su.end();
});

describe("attack suite A1–A5/A10 — infrastructure tables, as erp_app", () => {
  it("A1: SELECT with no tenant GUC → 0 rows (fail closed)", async () => {
    const app = await appClient();
    const audit = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events",
    );
    const tenants = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM tenants",
    );
    expect(audit.rows[0]?.n).toBe(0);
    expect(tenants.rows[0]?.n).toBe(0);
    await app.end();
  });

  it("A2: SELECT with the other tenant's GUC never exposes this tenant's rows", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_B]);
    const ownRows = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1",
      [TENANT_A],
    );
    const visible = await app.query<{ foreign: number }>(
      "SELECT count(*) FILTER (WHERE tenant_id <> $1)::int AS foreign FROM audit_events",
      [TENANT_B],
    );
    const ownVisible = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1",
      [TENANT_B],
    );
    await app.query("COMMIT");
    expect(ownRows.rows[0]?.n).toBe(0);
    expect(visible.rows[0]?.foreign).toBe(0); // nothing BUT tenant B's own rows
    expect(ownVisible.rows[0]?.n).toBeGreaterThan(0);
    await app.end();
  });

  it("A3: INSERT with a mismatched tenant_id → policy violation 42501", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
    await expect(
      app.query(
        `INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id)
         VALUES ('aaaaaaaa-3333-4333-8333-333333333333', $1, 'forged.created', 'x', $1)`,
        [TENANT_B],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await app.query("ROLLBACK");
    await app.end();
  });

  it("A4: UPDATE another tenant's row with own GUC → 0 rows affected", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
    const result = await app.query("UPDATE tenants SET name = 'HACKED' WHERE id = $1", [
      TENANT_B,
    ]);
    await app.query("COMMIT");
    expect(result.rowCount).toBe(0);
    await app.end();
  });

  it("A5: DELETE another tenant's audit row → rejected (no grant by design)", async () => {
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
    await expect(app.query("DELETE FROM audit_events WHERE id = $1", [OTHER_ROW_B])).rejects
      .toMatchObject({ code: "42501" });
    await app.query("ROLLBACK");
    await app.end();
  });

  it("A10: raw SQL as erp_app without any GUC fails closed on every shape", async () => {
    const app = await appClient();
    const byId = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE id = $1",
      [OWN_ROW_A],
    );
    const joined = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events a JOIN tenants t ON t.id = a.tenant_id`,
    );
    expect(byId.rows[0]?.n).toBe(0);
    expect(joined.rows[0]?.n).toBe(0);
    await app.end();
  });

  it("acceptance 3: UPDATE/DELETE on audit_events are impossible for the app role (grants) AND the trigger (defense-in-depth)", async () => {
    const app = await appClient();
    // Each rejection runs in its own transaction: a denied statement aborts the
    // surrounding transaction, so a shared BEGIN would mask later codes.
    const expectRejected = async (sql: string, params: unknown[]) => {
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
      try {
        await app.query(sql, params);
        expect.unreachable("must be rejected");
      } catch (error) {
        expect((error as { code?: string }).code).toBe("42501");
      } finally {
        await app.query("ROLLBACK");
      }
    };
    await expectRejected("UPDATE audit_events SET action = 'hacked' WHERE id = $1", [
      OWN_ROW_A,
    ]);
    await expectRejected("DELETE FROM audit_events WHERE id = $1", [OWN_ROW_A]);
    await app.end();

    // Even a privileged connection (restore-drill shape: role WITH grants)
    // is stopped by the erp.audit_events_guard() trigger with the documented
    // append-only message (INV-003 substrate).
    const su = await superuserClient();
    await expect(
      su.query("UPDATE audit_events SET action = 'hacked' WHERE id = $1", [OWN_ROW_A]),
    ).rejects.toMatchObject({ code: "P0001", message: /append-only/ });
    await expect(su.query("DELETE FROM audit_events WHERE id = $1", [OWN_ROW_A])).rejects
      .toMatchObject({ code: "P0001", message: /append-only/ });
    await su.end();
  });

  it("guard trigger is installed exactly once with UPDATE+DELETE events", async () => {
    const su = await superuserClient();
    const trigger = await su.query(
      `SELECT trigger_name, string_agg(event_manipulation, ',') AS events
         FROM information_schema.triggers
        WHERE event_object_table = 'audit_events'
        GROUP BY trigger_name`,
    );
    const row = trigger.rows.find((r) => r.trigger_name === "trg_audit_events_guard");
    expect(row?.events).toContain("UPDATE");
    expect(row?.events).toContain("DELETE");
    await su.end();
  });
});

describe("composite tenant-scoped FK pattern (TENANT_ISOLATION §4)", () => {
  it("makes cross-tenant dangling references structurally impossible", async () => {
    const su = await superuserClient();
    // Test fixture (_infra_probe family): created + dropped by the suite;
    // migrations never own it (PHASE-002 §2.4 "kept as test fixture").
    await su.query(`
      CREATE TABLE IF NOT EXISTS _infra_probe (
        id uuid NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        CONSTRAINT pk__infra_probe PRIMARY KEY (id, tenant_id)
      )`);
    await su.query(`
      CREATE TABLE IF NOT EXISTS _infra_probe_child (
        id uuid NOT NULL,
        probe_id uuid NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        CONSTRAINT pk__infra_probe_child PRIMARY KEY (id),
        CONSTRAINT fk__infra_probe_tenant FOREIGN KEY (probe_id, tenant_id)
          REFERENCES _infra_probe (id, tenant_id)
      )`);
    await su.query(
      `INSERT INTO _infra_probe (id, tenant_id) VALUES
         ('bbbbbbbb-1111-4111-8111-111111111111', $1),
         ('bbbbbbbb-2222-4222-8222-222222222222', $2)`,
      [TENANT_A, TENANT_B],
    );
    await su.query(
      `INSERT INTO _infra_probe_child (id, probe_id, tenant_id)
       VALUES ('cccccccc-1111-4111-8111-111111111111', $1, $2)`,
      ["bbbbbbbb-1111-4111-8111-111111111111", TENANT_A],
    );
    // Cross-tenant pair (probe of A, tenant B) violates the composite FK.
    await expect(
      su.query(
        `INSERT INTO _infra_probe_child (id, probe_id, tenant_id)
         VALUES ('cccccccc-2222-4222-8222-222222222222', $1, $2)`,
        ["bbbbbbbb-1111-4111-8111-111111111111", TENANT_B],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    // Cleanup so the catalog/RLS checks stay strict (no allowlist by design).
    await su.query("DROP TABLE IF EXISTS _infra_probe_child");
    await su.query("DROP TABLE IF EXISTS _infra_probe");
    await su.end();
  });
});
