import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

import { appClient, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { DeviceRegistryService } from "../../modules/sync/application/device-registry-service";
import { issueRefreshToken, verifyAccessToken } from "../../modules/sync/application/device-tokens";
import { DevicesController } from "../../modules/sync/presentation/devices.controller";
import { pull as pullService } from "../../modules/sync/application/pull-service";

import {
  countInvoices,
  countJournals,
  enrollDevice,
  ledgerOraclesHold,
  makeSyncServices,
  posSalePayload,
  seedPosWorld,
  v2Command,
  type PosWorld,
} from "./_oracle";

/**
 * PHASE-020 T-P20-3b · the push/pull isolation slices (TENANT_ISOLATION_TESTS
 * §7 Y-series; MASTER-PLAN §14 companion suites; MULTI_TENANCY §3 rule 1):
 *
 * - Y-01 cross-tenant push: tenant A's device references tenant B's REAL
 *   ids (item, partner, invoice) → per-item VALIDATION_ERROR, zero effects
 *   in BOTH tenants, no batch abort, no B data in the error surface;
 * - Y-02 pull RLS scope: the feed is the REQUEST tenant's — tenant A's
 *   device can pull A's rows and never B's, and the same device id used in
 *   B's context serves B's rows only (A's rows never ride along);
 * - Y-03 foreign-id refs = unknown-id shape: the rejection is byte-identical
 *   in shape to an unknown-id reference (404-equivalent semantics — no
 *   existence disclosure);
 * - Y-04 device↔tenant binding: a tenant A user's device credential
 *   exchange derives its tenant from the user's ACTIVE membership (never
 *   from ambient context) — the rotation lands in A's audit plane and
 *   nothing in B's.
 *
 * Tenants (MASTER-PLAN §0 TENANT_SYNC_B family, verified unused): A =
 * 30303030 (the full pos world), B = 31313131 (REAL minimal rows whose ids
 * A's device will reference). No cross-file state: both owned here.
 */

const TENANT_A = "30303030-3030-3030-3030-303030303030";
const ACTOR_A = "30303030-0000-4000-8000-000000003001";
const CASHIER_A = "30303030-0000-4000-8000-000000003002";
const SALES_A = "30303030-0000-4000-8000-000000003003";
const TENANT_B = "31313131-3131-3131-3131-313131313131";
const CASHIER_B = "31313131-0000-4000-8000-000000003102";

const services = makeSyncServices();
const registry = new DeviceRegistryService(new AuditService(new DrizzleAuditStore()));
const controller = new DevicesController(registry);
let world: PosWorld;

/** Tenant B's REAL rows (the ids A's device references + B's pull content). */
let bItemId = "";
let bPartnerId = "";
let bInvoiceId = "";
let bBranchId = "";

/** Tenant-scoped RLS app client (the read-assertion world). */
async function scopedClient(tenant: string): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [tenant]);
  return client;
}

async function pushV2(tenant: string, deviceId: string, commands: unknown[]) {
  return withTenant(tenant, () =>
    services.push.push({
      deviceId,
      batchId: generateUuidV7(),
      commands,
      contractVersion: SYNC_CONTRACT_VERSION,
    }),
  );
}

function asRejected(item: PushItemResultV2): Extract<PushItemResultV2, { status: "REJECTED" }> {
  if (item.status !== "REJECTED") {
    throw new Error(`expected a REJECTED item, got ${item.status}`);
  }
  return item;
}

function asAccepted(item: PushItemResultV2): Extract<PushItemResultV2, { status: "ACCEPTED" }> {
  if (item.status !== "ACCEPTED") {
    throw new Error(`expected an ACCEPTED item, got ${item.status}`);
  }
  return item;
}

/** The rejection shape modulo the caller-provided id echo (Y-03's
 * byte-equality proof — no existence disclosure, MULTI_TENANCY rule 1). */
function shapeOf(item: Extract<PushItemResultV2, { status: "REJECTED" }>, echoedId: string) {
  return {
    status: item.status,
    reason: item.reason,
    action: item.action,
    resubmittable: item.resubmittable,
    localized: item.localized,
    message: item.message.replace(echoedId, "<id>"),
  };
}

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_A,
    name: "Tenant Isolation A (P20 3b)",
    nameAr: "مستأجر العزل أ",
    prefix: "ISO",
    actor: ACTOR_A,
    cashier: CASHIER_A,
    salesRep: SALES_A,
  });

  // Tenant B: REAL minimal rows — a user with its own membership, a uom, an
  // item, a partner, a branch, and a DRAFT invoice whose ids tenant A's
  // device will reference (no pos world needed — B is only ever probed).
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant Isolation B (P20 3b)', 'مستأجر العزل ب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'iso-b-cashier@fixture.test', 'Isolation B Cashier', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [CASHIER_B],
  );
  const bRoleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES
       ($1, $2, 'iso_b_owner', 'Isolation B Owner', 'المالك (ب)')
     ON CONFLICT (id) DO NOTHING`,
    [bRoleId, TENANT_B],
  );
  const bTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner' LIMIT 1`,
  );
  if (bTemplate.rows[0] !== undefined) {
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [bRoleId, TENANT_B, bTemplate.rows[0].id],
    );
  }
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [generateUuidV7(), TENANT_B, CASHIER_B, bRoleId],
  );
  const bUomId = generateUuidV7();
  bItemId = generateUuidV7();
  bPartnerId = generateUuidV7();
  bBranchId = generateUuidV7();
  bInvoiceId = generateUuidV7();
  await su.query(
    `INSERT INTO uoms (id, tenant_id, code, name) VALUES ($1, $2, 'PCS', 'Pieces')
     ON CONFLICT (id) DO NOTHING`,
    [bUomId, TENANT_B],
  );
  await su.query(
    `INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, base_price) VALUES
       ($1, $2, 'ISO-B-ITEM', 'Isolation B Item', 'STOCK', $3, '100.000000')
     ON CONFLICT (id) DO NOTHING`,
    [bItemId, TENANT_B, bUomId],
  );
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $2, 'CUSTOMER', 'ISO-B-P1', 'Isolation B Partner')
     ON CONFLICT (id) DO NOTHING`,
    [bPartnerId, TENANT_B],
  );
  await su.query(
    `INSERT INTO branches (id, tenant_id, code, name) VALUES ($1, $2, 'MAIN', 'Isolation B Branch')
     ON CONFLICT (id) DO NOTHING`,
    [bBranchId, TENANT_B],
  );
  // B's REAL draft invoice (the Y-01/Y-03 reference target — a row that
  // exists in B and nowhere in A).
  await su.query(
    `INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, kind, invoice_date,
                                 due_date, currency_code, status)
     VALUES ($1, $2, $3, $4, 'CREDIT', '2026-03-01', '2026-04-01', 'SAR', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [bInvoiceId, TENANT_B, bBranchId, bPartnerId],
  );
  await su.end();
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-020 push/pull isolation (TENANT_ISOLATION_TESTS §7 Y-series)", () => {
  it("Y-01 cross-tenant push: A's device referencing B's REAL ids → per-item VALIDATION_ERROR, zero effects in BOTH tenants, no B data in the error surface", async () => {
    const device = await enrollDevice(TENANT_A, CASHIER_A);
    const invoicesA = await countInvoices(TENANT_A);
    const journalsA = await countJournals(TENANT_A);

    // The foreign batch: B's REAL item, B's REAL partner as customer, and
    // B's REAL draft invoice id — three reference kinds in one batch (the
    // batch NEVER aborts as a whole; each item rejects on its own).
    const customerSale = (customerId: string) => ({
      sale: {
        clientId: generateUuidV7(),
        terminalId: world.terminalId,
        offlineReceiptNo: "OFF-ISO-10001",
        invoiceDate: "2026-02-25",
        customerId,
        orderType: "COUNTER" as const,
        checkId: null,
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        tenders: [{ method: "CASH" as const, amount: "115.0000" }],
      },
    });
    const { results } = await pushV2(TENANT_A, device, [
      v2Command("pos_sale", "create", "iso-y01-item", posSalePayload(world, { offline: "OFF-ISO-10002", date: "2026-02-25", item: bItemId, unitPrice: "100.000000" })),
      v2Command("pos_sale", "create", "iso-y01-partner", customerSale(bPartnerId)),
      v2Command(
        "sales_invoice",
        "update_draft",
        "iso-y01-invoice",
        {
          invoiceId: bInvoiceId,
          customerId: world.customerId,
          orderDate: "2026-03-02",
          lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        },
        { baseVersion: 1 },
      ),
    ]);
    expect(results).toHaveLength(3);
    for (const raw of results) {
      const item = asRejected(raw);
      expect(item.status).toBe("REJECTED");
      expect(item.reason).toBe("VALIDATION_ERROR");
      expect(item.resubmittable).toBe(true);
      expect(item.action).toBe("EDIT_AND_RESEND");
    }

    // No existence disclosure: none of the messages name tenant B, its
    // codes, or anything beyond the caller-provided id echo.
    for (const raw of results) {
      const message = asRejected(raw).message;
      expect(message).not.toMatch(/Isolation B/i);
      expect(message).not.toMatch(/31313131/);
    }

    // Zero effects in BOTH planes: A's ledger untouched, B's rows
    // byte-identical (its item/partner/invoice never moved).
    expect(await countInvoices(TENANT_A)).toBe(invoicesA);
    expect(await countJournals(TENANT_A)).toBe(journalsA);
    const client = await scopedClient(TENANT_B);
    const bInvoice = await client.query<{ status: string; customer_id: string }>(
      `SELECT status, customer_id FROM sales_invoices WHERE id = $1`,
      [bInvoiceId],
    );
    expect(bInvoice.rows[0]).toMatchObject({ status: "DRAFT", customer_id: bPartnerId });
    await client.end();
    await ledgerOraclesHold(TENANT_A);
  });

  it("Y-02 pull RLS scope: the feed is the REQUEST tenant's — A's device never pulls B's rows, and the same device id in B's context serves B's rows only", async () => {
    const device = await enrollDevice(TENANT_A, CASHIER_A);

    // (a) Home context: A's device pulls items → A's item present, B's REAL
    // item NEVER appears (change_log is tenant-scoped by RLS — the rows
    // exist in B but are invisible here).
    const homeFeed = await withTenant(TENANT_A, () =>
      pullService({ entityType: "items", cursor: null, deviceId: device }),
    );
    const homeIds = homeFeed.changes.map((change) => change.id);
    expect(homeIds).toContain(world.itemA);
    expect(homeIds).not.toContain(bItemId);

    // (b) The spoof: the SAME tenant A device id used inside B's context
    // (a forged X-Device-Id on a B-scoped session). The pull serves B's
    // rows ONLY — A's rows never ride along (the device row cannot import
    // its owner tenant's data into another tenant's view).
    const spoofFeed = await withTenant(TENANT_B, () =>
      pullService({ entityType: "items", cursor: null, deviceId: device }),
    );
    const spoofIds = spoofFeed.changes.map((change) => change.id);
    expect(spoofIds).toContain(bItemId);
    expect(spoofIds).not.toContain(world.itemA);
    expect(spoofIds).not.toContain(world.itemB);

    // (c) The permissions snapshot spoof: A's device pulls `permissions`
    // in B's context → the projection is B-scoped for A's user (no
    // membership in B) → an EMPTY key set. Tenant A's permission keys
    // never leak into the B-scoped view.
    const spoofPerms = await withTenant(TENANT_B, () =>
      pullService({ entityType: "permissions", cursor: null, deviceId: device }),
    );
    expect(spoofPerms.changes.length).toBeGreaterThanOrEqual(1);
    const snapshot = spoofPerms.changes[spoofPerms.changes.length - 1]!.payload as {
      userId: string;
      permissions: string[];
    };
    expect(snapshot.userId).toBe(CASHIER_A);
    expect(snapshot.permissions).toEqual([]);
    // …while the home-context snapshot carries A's real keys.
    const homePerms = await withTenant(TENANT_A, () =>
      pullService({ entityType: "permissions", cursor: null, deviceId: device }),
    );
    const homeSnapshot = homePerms.changes[homePerms.changes.length - 1]!.payload as {
      permissions: string[];
    };
    expect(homeSnapshot.permissions).toContain("partners.view");
    await ledgerOraclesHold(TENANT_A);
  });

  it("Y-03 foreign-id refs = unknown-id shape: B's REAL ids reject byte-identically to unknown ids (404-equivalent, no existence disclosure)", async () => {
    const device = await enrollDevice(TENANT_A, CASHIER_A);
    const unknownItemId = generateUuidV7();
    const unknownPartnerId = generateUuidV7();
    const unknownInvoiceId = generateUuidV7();

    const customerSale = (customerId: string, offline: string) => ({
      sale: {
        clientId: generateUuidV7(),
        terminalId: world.terminalId,
        offlineReceiptNo: offline,
        invoiceDate: "2026-02-26",
        customerId,
        orderType: "COUNTER" as const,
        checkId: null,
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        tenders: [{ method: "CASH" as const, amount: "115.0000" }],
      },
    });
    const updateOf = (invoiceId: string, key: string) =>
      v2Command(
        "sales_invoice",
        "update_draft",
        key,
        {
          invoiceId,
          customerId: world.customerId,
          orderDate: "2026-03-03",
          lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        },
        { baseVersion: 1 },
      );

    // Item reference: B's REAL id vs an unknown id.
    const foreignItem = asRejected(
      (await pushV2(TENANT_A, device, [
        v2Command("pos_sale", "create", "iso-y03-item", posSalePayload(world, { offline: "OFF-ISO-20001", date: "2026-02-26", item: bItemId, unitPrice: "100.000000" })),
      ])).results[0]!,
    );
    const unknownItem = asRejected(
      (await pushV2(TENANT_A, device, [
        v2Command("pos_sale", "create", "iso-y03-item-unknown", posSalePayload(world, { offline: "OFF-ISO-20002", date: "2026-02-26", item: unknownItemId, unitPrice: "100.000000" })),
      ])).results[0]!,
    );
    expect(shapeOf(foreignItem, bItemId)).toEqual(shapeOf(unknownItem, unknownItemId));

    // Partner reference (the sale's customer): B's REAL id vs unknown.
    const foreignPartner = asRejected(
      (await pushV2(TENANT_A, device, [v2Command("pos_sale", "create", "iso-y03-partner", customerSale(bPartnerId, "OFF-ISO-20003"))])).results[0]!,
    );
    const unknownPartner = asRejected(
      (await pushV2(TENANT_A, device, [v2Command("pos_sale", "create", "iso-y03-partner-unknown", customerSale(unknownPartnerId, "OFF-ISO-20004"))])).results[0]!,
    );
    expect(shapeOf(foreignPartner, bPartnerId)).toEqual(shapeOf(unknownPartner, unknownPartnerId));

    // Invoice reference (update_draft): B's REAL draft id vs unknown.
    const foreignInvoice = asRejected(
      (await pushV2(TENANT_A, device, [updateOf(bInvoiceId, "iso-y03-invoice")])).results[0]!,
    );
    const unknownInvoice = asRejected(
      (await pushV2(TENANT_A, device, [updateOf(unknownInvoiceId, "iso-y03-invoice-unknown")])).results[0]!,
    );
    expect(shapeOf(foreignInvoice, bInvoiceId)).toEqual(shapeOf(unknownInvoice, unknownInvoiceId));

    // A spoofed push THROUGH B's context referencing A's REAL draft id:
    // A's rows are invisible in B exactly as unknown ids are (the mirror of
    // Y-01 — A's data cannot be reached through another tenant's scope).
    const aDraft = asAccepted(
      (await pushV2(TENANT_A, device, [
        v2Command("sales_invoice", "create_draft", "iso-y03-create", {
          customerId: world.customerId,
          orderDate: "2026-03-04",
          lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        }),
      ])).results[0]!,
    );
    const aDraftId = aDraft.result.invoiceId as string;
    const throughB = asRejected(
      (await withTenant(TENANT_B, () =>
        services.push.push({
          deviceId: device,
          batchId: generateUuidV7(),
          contractVersion: SYNC_CONTRACT_VERSION,
          commands: [updateOf(aDraftId, "iso-y03-through-b")],
        }),
      )).results[0]!,
    );
    const probeInB = generateUuidV7();
    const unknownInB = asRejected(
      (await withTenant(TENANT_B, () =>
        services.push.push({
          deviceId: device,
          batchId: generateUuidV7(),
          contractVersion: SYNC_CONTRACT_VERSION,
          commands: [updateOf(probeInB, "iso-y03-unknown-in-b")],
        }),
      )).results[0]!,
    );
    expect(throughB.reason).toBe("VALIDATION_ERROR");
    expect(shapeOf(throughB, aDraftId)).toEqual(shapeOf(unknownInB, probeInB));
    // The A-owned draft is untouched by the B-scoped attempt.
    const row = await withTenant(TENANT_A, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT version, invoice_date AS "invoiceDate", owner_device_id AS "ownerDeviceId"
        FROM sales_invoices WHERE id = ${aDraftId}::uuid
      `);
      return rows.rows[0] as { version: number; invoiceDate: string; ownerDeviceId: string };
    });
    expect(row).toMatchObject({ version: 1, invoiceDate: "2026-03-04", ownerDeviceId: device });
    await ledgerOraclesHold(TENANT_A);
  });

  it("Y-04 device↔tenant binding: A's user's device credential exchange derives tenant A from the membership (never ambient context) — nothing lands in B", async () => {
    // A real registry-registered device for A's cashier (membership ONLY in
    // tenant A — CASHIER_A has exactly one membership row). The registering
    // actor IS the device user (the registry pattern): the token's sub is
    // the cashier, and the credential exchange must bind to HER membership
    // tenant — A.
    const registered = await withTenant(TENANT_A, () =>
      registry.register({
        actorId: CASHIER_A,
        tenantId: TENANT_A,
        deviceName: "Isolation binding device",
        deviceClass: "pos-terminal",
        contractVersion: SYNC_CONTRACT_VERSION,
        capabilities: ["pos"],
      }),
    );
    const deviceId = registered.device.id;
    const token = await withTenant(TENANT_A, (tx) => issueRefreshToken(tx, deviceId));

    // The PUBLIC exchange path (no session, no ambient tenant scope — the
    // route derives device → user → ACTIVE membership → withTenant). Run
    // it with NO ambient context: the binding must come out as tenant A.
    const rotated = await controller.refresh(deviceId, { refreshToken: token.token });
    const claims = verifyAccessToken(rotated.data.accessToken);
    expect(claims).toMatchObject({ sub: CASHIER_A, deviceId, capabilities: ["pos"] });

    // The rotation is recorded in A's audit plane ONLY — B's audit_events
    // has no row for this device (the exchange cannot be made to bind a
    // foreign tenant by any request shaping).
    const clientA = await scopedClient(TENANT_A);
    const inA = await clientA.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'device.token_rotated' AND entity_id = $2`,
      [TENANT_A, deviceId],
    );
    await clientA.end();
    expect(inA.rows[0]!.n).toBe(1);
    const clientB = await scopedClient(TENANT_B);
    const inB = await clientB.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'device.token_rotated' AND entity_id = $2`,
      [TENANT_B, deviceId],
    );
    const bInbox = await clientB.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM inbox_commands WHERE tenant_id = $1 AND device_id = $2`,
      [TENANT_B, deviceId],
    );
    const bInvoices = await clientB.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sales_invoices WHERE tenant_id = $1 AND owner_device_id = $2`,
      [TENANT_B, deviceId],
    );
    await clientB.end();
    expect(inB.rows[0]!.n).toBe(0);
    expect(bInbox.rows[0]!.n).toBe(0);
    expect(bInvoices.rows[0]!.n).toBe(0);
    await ledgerOraclesHold(TENANT_A);
  });
});
