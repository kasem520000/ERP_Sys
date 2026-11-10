import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Client } from "pg";

import { appClient, ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  fitsByteCap,
  PULL_PAGE_BYTE_CAP,
  pull,
  SyncDeviceRevokedError,
  SyncEntityNotPulledError,
} from "../../modules/sync/application/pull-service";
import {
  decodeCursor,
  encodeCursor,
  SYNC_CONTRACT_VERSION,
} from "../../modules/sync/application/cursor-tokens";

/**
 * PHASE-020 T5 db evidence (SYNC_PROTOCOL §2 + MASTER-PLAN §5): the v2
 * pull surface — catch-up-fed change_log served strictly by seq through
 * the extended envelope (nextCursor/serverTime/contractVersion/resync +
 * per-change version), the page budgets (count cap + the 2 MB byte cap),
 * the C-12 bounded-restart directive, the device-class feed-group gate
 * (SYNC_ENTITY_NOT_PULLED, no existence leak), the tombstone transport
 * (soft-delete → op:'DELETE' + payload:null + a tombstones row), and the
 * per-user permissions snapshot feed. The 016 wire shape (changes +
 * cursor + hasMore) is asserted verbatim alongside the v2 additions.
 *
 * Dedicated tenant 20202020 (SAR): the pull suite owns it end to end
 * (the sync-suite tenant from MASTER-PLAN §0).
 */

const TENANT_PULL = "20202020-2020-2020-2020-202020202020";
const ACTOR = "20202020-0000-4000-8000-000000003001";
const ROLE_ID = "20202020-0000-4000-8000-000000003002";
const ITEM_ID = "20202020-0000-4000-8000-000000004001";
const PARTNER_IDS = [
  "20202020-0000-4000-8000-000000004002",
  "20202020-0000-4000-8000-000000004003",
  "20202020-0000-4000-8000-000000004004",
] as const;
const CASH_ACCOUNT_ID = "20202020-0000-4000-8000-000000004005";
const TERMINAL_ID = "20202020-0000-4000-8000-000000004006";
const ANDROID_DEVICE = "20202020-0000-4000-8000-000000005001";
const POS_DEVICE = "20202020-0000-4000-8000-000000005002";

/** The tenant-scoped app client (RLS world) for read assertions. */
async function pullClient(tenant: string): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [tenant]);
  return client;
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant P20A (sync pull)', 'المستأجر ب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PULL],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'p20a-pull@fixture.test', 'P20A Pull Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR],
  );
  // The actor's tenant role: cloned from the system owner template (the
  // 0005 cross-join grants — the matrix's full tenant-plane key set).
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES
       ($1, $2, 'owner_p20a', 'Owner (P20A)', 'المالك (P20A)')
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ID, TENANT_PULL],
  );
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [ROLE_ID, TENANT_PULL, template.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    ["20202020-0000-4000-8000-000000003003", TENANT_PULL, ACTOR, ROLE_ID],
  );
  // The fixture devices (devices is service-mediated — seeded as the
  // bootstrap role; device_key_hash is NOT NULL + unique). The third is
  // pre-revoked for the DEVICE_REVOKED pull gate.
  await su.query(
    `INSERT INTO devices (id, user_id, platform, name, device_key_hash, device_class, revoked_at) VALUES
       ($1, $4, 'ANDROID', 'P20A android-personal device', 'p20a-android-personal-key', 'android-personal', NULL),
       ($2, $4, 'pos-terminal', 'P20A pos terminal device', 'p20a-pos-terminal-key', 'pos-terminal', NULL),
       ($3, $4, 'pos-terminal', 'P20A revoked terminal device', 'p20a-revoked-terminal-key', 'pos-terminal', now())
     ON CONFLICT (id) DO NOTHING`,
    [ANDROID_DEVICE, POS_DEVICE, "20202020-0000-4000-8000-000000005003", ACTOR],
  );
  await su.end();

  await withTenant(TENANT_PULL, async () => {
    const { seedMasterDataBasics, provisionCoaTemplate, findBranchByCode, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    await seedMasterDataBasics();
    // The feed content: one item + three partners (page-cap fixture).
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`
      INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, base_price)
      VALUES (${ITEM_ID}, erp.current_tenant_id(), 'P20A-ITEM-1', 'Pull Fixture Item', 'STOCK',
              (SELECT id FROM uoms WHERE code = 'PCS' AND tenant_id = erp.current_tenant_id()),
              '100.000000')
      ON CONFLICT (id) DO NOTHING
    `);
    for (const [index, partnerId] of PARTNER_IDS.entries()) {
      await tx.execute(sql`
        INSERT INTO partners (id, tenant_id, kind, code, name)
        VALUES (${partnerId}, erp.current_tenant_id(), 'CUSTOMER', ${`P20A-P${index + 1}`},
                ${`Pull Fixture Partner ${index + 1}`})
        ON CONFLICT (id) DO NOTHING
      `);
    }
    // The pos-terminals projection fixture: CoA template (the till's GL
    // account 1111) + branch + cash account + the terminal itself.
    await provisionCoaTemplate();
    const branch =
      (await findBranchByCode("MAIN-P20A")) ??
      (await insertBranch({ code: "MAIN-P20A", name: "Main branch (P20A)", nameAr: null, address: null }));
    await tx.execute(sql`
      INSERT INTO cash_accounts (id, tenant_id, name, type, account_id, currency_code)
      VALUES (${CASH_ACCOUNT_ID}, erp.current_tenant_id(), 'POS Till (P20A)', 'CASH',
              (SELECT id FROM accounts WHERE code = '1111' AND tenant_id = erp.current_tenant_id()), 'SAR')
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO pos_terminals (id, tenant_id, code, name, branch_id, cash_account_id,
                                 receipt_size, status)
      VALUES (${TERMINAL_ID}, erp.current_tenant_id(), 'T1-POS', 'POS Terminal 1 (P20A)',
              ${branch.id}, ${CASH_ACCOUNT_ID}, '80mm', 'ACTIVE')
      ON CONFLICT (id) DO NOTHING
    `);
  });
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-020 pull v2 (SYNC_PROTOCOL §2 + MASTER-PLAN §5)", () => {
  it("bootstrap pull (cursor null) → seq-ordered changes with version; drained → hasMore false", async () => {
    const first = await withTenant(TENANT_PULL, () => pull({ entityType: "items", cursor: null }));
    expect(first.entityType).toBe("items");
    // The v2 envelope additions (additive — the 016 fields stay verbatim).
    expect(first.contractVersion).toBe(SYNC_CONTRACT_VERSION);
    expect(typeof first.serverTime).toBe("string");
    expect(first.nextCursor).toBe(first.cursor);
    expect(first.changes.map((change) => change.id)).toContain(ITEM_ID);
    const seqs = first.changes.map((change) => change.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    for (const change of first.changes) {
      expect(change.op).toBe("UPSERT");
      expect(change.version).toBe(1); // fresh source rows (0009 version column)
      expect(change.payload?.version).toBe(1);
    }
    // Draining: the next pull from the returned cursor is empty + idle.
    const second = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "items", cursor: first.cursor }),
    );
    expect(second.hasMore).toBe(false);
    expect(second.changes).toHaveLength(0);
    expect(decodeCursor(second.cursor)?.seq).toBe(decodeCursor(first.cursor)?.seq);
  });

  it("page cap: limit=2 → hasMore + advancing nextCursor; continuation is contiguous (no gaps/duplicates)", async () => {
    const page1 = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "partners", cursor: null, limit: 2 }),
    );
    expect(page1.changes).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "partners", cursor: page1.nextCursor!, limit: 2 }),
    );
    expect(page2.changes).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    const all = [...page1.changes, ...page2.changes];
    expect(new Set(all.map((change) => change.id)).size).toBe(3);
    const seqs = all.map((change) => change.seq);
    for (let index = 1; index < seqs.length; index += 1) {
      expect(seqs[index]!).toBeGreaterThan(seqs[index - 1]!);
    }
    // The continuation starts strictly after page 1's last emitted seq (a
    // contiguous window: no overlap, no re-serve).
    const page1Seqs = page1.changes.map((change) => change.seq);
    const page2Seqs = page2.changes.map((change) => change.seq);
    expect(page2Seqs[0]!).toBeGreaterThan(page1Seqs[page1Seqs.length - 1]!);
    expect(decodeCursor(page2.cursor)?.seq).toBe(seqs[seqs.length - 1]!);
  });

  it("byte cap: fitsByteCap enforces the 2 MB page budget (pure — the cap is untestable with real data)", () => {
    expect(PULL_PAGE_BYTE_CAP).toBe(2_000_000);
    expect(fitsByteCap(0, 2_000_000)).toBe(true);
    expect(fitsByteCap(1, 2_000_000)).toBe(false);
    expect(fitsByteCap(1_999_999, 1)).toBe(true);
    expect(fitsByteCap(1_999_999, 2)).toBe(false);
  });

  it("C-12: cursor beyond the feed head → resync directive (fresh 0-cursor, zero changes)", async () => {
    const beyond = encodeCursor({
      entityType: "items",
      seq: 999_999_999,
      issuedAt: new Date().toISOString(),
    });
    const resync = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "items", cursor: beyond }),
    );
    expect(resync.resync).toBe(true);
    expect(resync.changes).toHaveLength(0);
    expect(resync.hasMore).toBe(false);
    expect(resync.nextCursor).toBe(resync.cursor);
    const fresh = decodeCursor(resync.cursor);
    expect(fresh?.entityType).toBe("items");
    expect(fresh?.seq).toBe(0);
    // The bounded restart actually re-serves the feed from 0.
    const restart = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "items", cursor: resync.cursor }),
    );
    expect(restart.resync).toBeUndefined();
    expect(restart.changes.map((change) => change.id)).toContain(ITEM_ID);
  });

  it("feed-group gate: android-personal cannot pull items (SYNC_ENTITY_NOT_PULLED) but pulls permissions", async () => {
    await expect(
      withTenant(TENANT_PULL, () =>
        pull({ entityType: "items", cursor: null, deviceId: ANDROID_DEVICE }),
      ),
    ).rejects.toBeInstanceOf(SyncEntityNotPulledError);
    await expect(
      withTenant(TENANT_PULL, () =>
        pull({ entityType: "items", cursor: null, deviceId: ANDROID_DEVICE }),
      ),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_NOT_PULLED" });

    // The permissions snapshot entity is pulled by EVERY class (§10).
    const permissions = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "permissions", cursor: null, deviceId: ANDROID_DEVICE }),
    );
    expect(permissions.changes.length).toBeGreaterThanOrEqual(1);
    const payload = permissions.changes[0]!.payload as {
      userId: string;
      permissions: string[];
      snapshotAt: string;
      watermarkDays: number;
    };
    expect(payload.userId).toBe(ACTOR);
    // Seeded base keys from the owner-template clone (0004 + 0005).
    expect(payload.permissions).toContain("partners.view");
    expect(payload.permissions).toContain("sync.devices.register");
    expect(typeof payload.snapshotAt).toBe("string");
    expect(payload.watermarkDays).toBe(7);
  });

  it("revoked device: pull rejected with DEVICE_REVOKED before anything is served (§1.5)", async () => {
    await expect(
      withTenant(TENANT_PULL, () =>
        pull({
          entityType: "items",
          cursor: null,
          deviceId: "20202020-0000-4000-8000-000000005003",
        }),
      ),
    ).rejects.toBeInstanceOf(SyncDeviceRevokedError);
    await expect(
      withTenant(TENANT_PULL, () =>
        pull({
          entityType: "items",
          cursor: null,
          deviceId: "20202020-0000-4000-8000-000000005003",
        }),
      ),
    ).rejects.toMatchObject({ code: "DEVICE_REVOKED" });
  });

  it("tombstone: soft-deleted partner → op:'DELETE' + payload:null feed entry + a tombstones row", async () => {
    const victim = PARTNER_IDS[2]!;
    await withTenant(TENANT_PULL, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`
        UPDATE partners SET deleted_at = now(), updated_at = now(), status = 'ARCHIVED'
        WHERE id = ${victim}
      `);
    });
    const feed = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "partners", cursor: null }),
    );
    const deleteEntry = feed.changes.find((c) => c.id === victim && c.op === "DELETE");
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.payload).toBeNull();
    expect(deleteEntry!.version).toBeNull();

    // The GC ledger row (0029) — readable only through the tenant's RLS.
    const client = await pullClient(TENANT_PULL);
    const tombstones = await client.query<{ deleted_at: string; gc_after: string }>(
      `SELECT deleted_at, gc_after FROM tombstones
        WHERE entity_type = 'partners' AND entity_id = $1`,
      [victim],
    );
    await client.end();
    expect(tombstones.rows).toHaveLength(1);
    expect(tombstones.rows[0]!.gc_after).not.toBeNull();
  });

  it("permission snapshot: revoking the membership projects an updated snapshot row on the next pull", async () => {
    const first = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "permissions", cursor: null, deviceId: POS_DEVICE }),
    );
    expect(first.changes.length).toBeGreaterThanOrEqual(1);
    const before = first.changes[first.changes.length - 1]!.payload as { permissions: string[] };
    expect(before.permissions).toContain("partners.view");

    await withTenant(TENANT_PULL, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`
        UPDATE memberships SET status = 'REVOKED', updated_at = now()
        WHERE user_id = ${ACTOR} AND tenant_id = erp.current_tenant_id()
      `);
    });

    // The delta pull (from the previous position) serves exactly the new
    // projected snapshot — the key set dropped to empty.
    const delta = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "permissions", cursor: first.cursor, deviceId: POS_DEVICE }),
    );
    expect(delta.changes).toHaveLength(1);
    const after = delta.changes[0]!.payload as {
      permissions: string[];
      snapshotAt: string;
      watermarkDays: number;
    };
    expect(after.permissions).toEqual([]);
    expect(after.watermarkDays).toBe(7);
  });

  it("pos-group v2 projections: pos_terminals feed entry present; cashier_shifts drains empty", async () => {
    // No deviceId → the fail-safe pos group (the 016 session path).
    const terminals = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "pos_terminals", cursor: null }),
    );
    const entry = terminals.changes.find((change) => change.id === TERMINAL_ID);
    expect(entry).toBeDefined();
    expect(entry!.op).toBe("UPSERT");
    expect(entry!.payload).toMatchObject({
      code: "T1-POS",
      status: "ACTIVE",
      receiptSize: "80mm",
      version: 1,
    });
    expect(entry!.version).toBe(1);

    const shifts = await withTenant(TENANT_PULL, () =>
      pull({ entityType: "cashier_shifts", cursor: null }),
    );
    expect(shifts.hasMore).toBe(false);
    expect(shifts.changes).toHaveLength(0);
  });
});
