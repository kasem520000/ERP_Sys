import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { Request } from "express";

import { generateUuidV7 } from "@erp/domain-core";

import { SYNC_CONTRACT_VERSION } from "@erp/contracts";

import { appClient, ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import {
  DeviceRegistryService,
  DevicePartnerLinkError,
} from "../../modules/sync/application/device-registry-service";
import { pull as pullService } from "../../modules/sync/application/pull-service";
import { DevicesController } from "../../modules/sync/presentation/devices.controller";
import { makeSyncServices, seedPosWorld, type PosWorld } from "./_oracle";

/**
 * PHASE-022 T-P22-3-b db evidence (DR-P22-05a — MASTER-PLAN §1 item 5 +
 * LOCAL_DATABASE §1.1 rule 2; the server-side writer 2-b's Deviation 2
 * recorded as OPEN): the personal-class PARTNER LINK on register —
 * `devices.linked_partner_id` (migration 0033) finally has a production
 * writer, and it is AUTHORIZED server-side:
 *
 * 1. accepted for deviceClass "android-personal" ONLY (any other class →
 *    the typed refusal, even for an admin);
 * 2. the registering identity must be LINKED TO the partner — a
 *    partner_contacts row whose email matches the identity's email (the
 *    customer-portal link) — or hold the devices admin plane
 *    (`identity.devices.manage`);
 * 3. the partner must be an ACTIVE CUSTOMER of the registering tenant
 *    (the read is RLS-scoped: a cross-tenant/unknown id is refused with
 *    the SAME typed error — no probing);
 * 4. the link is written in the SAME transaction as the device row, and
 *    the PULL SCOPE FOLLOWS (pull-personal.spec's assertions reused: the
 *    linked partner's statements/invoices only — the other partner's
 *    ledger content never appears);
 * 5. a TAMPERED link (another partner the identity has no relationship
 *    with) → DevicePartnerLinkError and NO device row.
 *
 * Dedicated tenant 3b3b3b3b (verified unused across the repo); device ids
 * generated per run; typed failures asserted INSIDE the withTenant scope
 * (the enroll.spec/devices.spec convention). The controller is exercised
 * DIRECTLY with a synthesized session identity (the PermissionsGuard +
 * withTenant wrapper are HTTP-level; the route's own authorization logic —
 * requireIdentity/requireActiveTenant/the zod schema — runs verbatim).
 */

const TENANT = "3b3b3b3b-3b3b-3b3b-3b3b-3b3b3b3b3b3b";
const ADMIN = "3b3b3b3b-0000-4000-8000-000000003b01";
const PA = "3b3b3b3b-0000-4000-8000-000000003b02";
const PA_EMAIL = "p3b-personal@fixture.test";
/** P_OTHER = the partner PA has NO relationship with (the tampered link). */
const P_OTHER = "3b3b3b3b-0000-4000-8000-000000003b81";
/** P_SUP = an ACTIVE SUPPLIER PA IS a contact of (kind gate: not a customer). */
const P_SUP = "3b3b3b3b-0000-4000-8000-000000003b82";
/** A cross-tenant-shaped id (the pull-personal fixture tenant's P2). */
const P_CROSS_TENANT = "f2e2d2d2-0000-4000-8000-000000000101";

const audit = new AuditService(new DrizzleAuditStore());
const registry = new DeviceRegistryService(audit);
const controller = new DevicesController(registry);

/** The tenant-scoped app client (RLS world) for read assertions. */
async function tenantClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT]);
  return client;
}

/** A synthesized session request for the controller's direct invocation
 * (identityOf reads `request.identity`; the guard's withTenant wrapper is
 * replaced by the spec's explicit withTenant scope). */
function sessionRequest(
  userId: string,
  email: string,
): Request {
  return {
    identity: {
      userId,
      activeTenantId: TENANT,
      user: { email, fullName: "Fixture Identity", locale: "ar", status: "ACTIVE" },
    },
  } as unknown as Request;
}

async function auditEvents(
  action: string,
  entityId?: string,
): Promise<{ entityId: string; after: Record<string, unknown> | null }[]> {
  const client = await tenantClient();
  const result = await client.query(
    `SELECT entity_id AS "entityId", after
       FROM audit_events
      WHERE tenant_id = $1 AND action = $2 AND ($3::uuid IS NULL OR entity_id = $3)
      ORDER BY at`,
    [TENANT, action, entityId ?? null],
  );
  await client.end();
  return result.rows.map((row) => ({
    entityId: row.entityId,
    after: row.after === null ? null : (JSON.parse(JSON.stringify(row.after)) as Record<string, unknown>),
  }));
}

let world: PosWorld;
let p1InvoiceId = "";
let pOtherInvoiceId = "";

/** A posted CREDIT invoice for a customer (the REAL create→submit→approve→
 * post chain — the AR subledger content the statement feed computes over),
 * idempotent by note (the world-seeding convention, duplicated from
 * pull-personal.spec per the suite's file-local helper rule). */
async function ensurePostedCreditInvoice(customerId: string, note: string): Promise<string> {
  const su = await superuserClient();
  const found = await su.query<{ id: string }>(
    `SELECT id FROM sales_invoices WHERE tenant_id = $1 AND note = $2 LIMIT 1`,
    [TENANT, note],
  );
  const existing = found.rows[0]?.id;
  await su.end();
  if (existing !== undefined) {
    return existing;
  }
  const { invoices } = makeSyncServices();
  const invoice = await withTenant(TENANT, () =>
    invoices.create({
      branchId: world.branchId,
      customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: "2026-03-15",
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: world.warehouseId,
      cashAccountId: null,
      note,
      noteAr: null,
      actorId: PA,
      lines: [
        {
          itemId: world.itemA,
          accountId: null,
          deliveryLineId: null,
          description: null,
          descriptionAr: null,
          qty: "1",
          unitPrice: "100.000000",
          discountAmount: null,
          taxCodeId: world.taxStd,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT, () => invoices.submit(invoice.id, PA));
  await withTenant(TENANT, () => invoices.approve(invoice.id, ADMIN, false));
  const posted = await withTenant(TENANT, () => invoices.post(invoice.id, ADMIN));
  return posted.invoice.id;
}

beforeAll(async () => {
  ensureTestDb();
  world = await seedPosWorld({
    tenant: TENANT,
    name: "Tenant 3B (register partner link)",
    nameAr: "مستأجر ٣ب لربط الشريك",
    prefix: "P3B",
    actor: ADMIN,
    cashier: ADMIN,
    salesRep: ADMIN,
  });

  const su = await superuserClient();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'p3b-admin@fixture.test', 'P3B Admin', 'x', 'ACTIVE'),
       ($2, $3, 'P3B Personal User', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ADMIN, PA, PA_EMAIL],
  );
  // seedPosWorld already created the owner-clone role (`p3b_owner`, granted
  // to ADMIN — every non-platform key: sync.devices.register AND
  // identity.devices.manage). PA gets a CASHIER clone (no devices admin
  // plane — the contact link is PA's ONLY authorization path).
  const cashierRoleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'p3b_cashier', 'P3B Cashier', 'كاشير ٣ب', false)
     ON CONFLICT (id) DO NOTHING`,
    [cashierRoleId, TENANT],
  );
  const cashierTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'cashier' LIMIT 1`,
  );
  if (cashierTemplate.rows[0] !== undefined) {
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp
        WHERE rp.role_id = $3
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [cashierRoleId, TENANT, cashierTemplate.rows[0].id],
    );
  }
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [generateUuidV7(), TENANT, PA, cashierRoleId],
  );
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $3, 'CUSTOMER', 'P3B-CUST-02', 'P3B Other Customer'),
       ($2, $3, 'SUPPLIER', 'P3B-SUP-01', 'P3B Supplier')
     ON CONFLICT (id) DO NOTHING`,
    [P_OTHER, P_SUP, TENANT],
  );
  // The customer-portal link: PA's email IS a contact row on the world
  // customer (world.customerId) AND on the supplier (kind-gate proof) —
  // but NOT on P_OTHER.
  for (const partnerId of [world.customerId, P_SUP]) {
    await su.query(
      `INSERT INTO partner_contacts (id, tenant_id, partner_id, name, email, role, is_primary)
       VALUES ($1, $2, $3, 'P3B Personal Contact', $4, 'ACCOUNTS', true)
       ON CONFLICT (id) DO NOTHING`,
      [generateUuidV7(), TENANT, partnerId, PA_EMAIL],
    );
  }
  await su.end();

  // Both partners' ledger content (the AR subledger the statement feed
  // computes over + the catch-up invoice projections).
  p1InvoiceId = await ensurePostedCreditInvoice(world.customerId, "P3B statement invoice P1");
  pOtherInvoiceId = await ensurePostedCreditInvoice(P_OTHER, "P3B statement invoice P_OTHER");
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-022 T-P22-3-b · register partner link (DR-P22-05a; the 2-b Deviation-2 writer)", () => {
  it("authorized personal registration: the link is WRITTEN, audited with its basis, and the PULL SCOPE FOLLOWS", async () => {
    const response = await withTenant(TENANT, () =>
      controller.register(sessionRequest(PA, PA_EMAIL), {
        deviceName: "P3B personal phone",
        deviceClass: "android-personal",
        contractVersion: SYNC_CONTRACT_VERSION,
        capabilities: ["personal_account"],
        linkedPartnerId: world.customerId,
      }),
    );
    const deviceId = response.data.deviceId as string;
    expect(deviceId).toBeTruthy();

    // The link is written on the device row (the same transaction).
    const client = await tenantClient();
    const link = await client.query<{ linked_partner_id: string | null }>(
      `SELECT linked_partner_id FROM devices WHERE id = $1`,
      [deviceId],
    );
    expect(link.rows[0]!.linked_partner_id).toBe(world.customerId);
    await client.end();

    // The audit trail carries the link + the authorization BASIS.
    const events = await auditEvents("device.registered", deviceId);
    expect(events).toHaveLength(1);
    expect(events[0]!.after).toMatchObject({
      linkedPartnerId: world.customerId,
      linkedPartnerAuthorizedBy: "contact",
    });

    // The pull scope follows (pull-personal.spec's assertions): the
    // linked partner's statements ONLY — the OTHER partner's ledger
    // content (P_OTHER's posted invoice, fabricated in beforeAll) never
    // appears in any of the device's feeds.
    const statements = await withTenant(TENANT, () =>
      pullService({ entityType: "statements", cursor: null, deviceId, limit: 100 }),
    );
    expect(statements.changes.length).toBeGreaterThan(0);
    expect(statements.changes.every((c) => c.id === world.customerId)).toBe(true);

    const invoices = await withTenant(TENANT, () =>
      pullService({ entityType: "sales_invoices", cursor: null, deviceId, limit: 100 }),
    );
    const invoiceIds = invoices.changes.map((c) => c.id);
    expect(invoiceIds).toContain(p1InvoiceId);
    expect(invoiceIds).not.toContain(pOtherInvoiceId);
  });

  it("tampered link — another partner the identity has no relationship with → typed refusal, NO device row", async () => {
    const before = await tenantClient();
    const beforeCount = await before.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM devices WHERE user_id = $1`,
      [PA],
    );
    await before.end();

    await withTenant(TENANT, async () => {
      await expect(
        controller.register(sessionRequest(PA, PA_EMAIL), {
          deviceName: "P3B tampered phone",
          deviceClass: "android-personal",
          linkedPartnerId: P_OTHER,
        }),
      ).rejects.toBeInstanceOf(DevicePartnerLinkError);
    });
    // Service path identical (the controller adds no authorization of its
    // own beyond the schema — the rule lives in the application service).
    await withTenant(TENANT, async () => {
      await expect(
        registry.register({
          actorId: PA,
          tenantId: TENANT,
          deviceName: "P3B tampered phone (service)",
          deviceClass: "android-personal",
          linkedPartnerId: P_OTHER,
          actorEmail: PA_EMAIL,
        }),
      ).rejects.toBeInstanceOf(DevicePartnerLinkError);
    });

    const after = await tenantClient();
    const afterCount = await after.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM devices WHERE user_id = $1`,
      [PA],
    );
    await after.end();
    expect(afterCount.rows[0]!.count).toBe(beforeCount.rows[0]!.count);
  });

  it("cross-tenant / unknown partner id and non-customer partners → the SAME typed refusal (no probing)", async () => {
    // A partner id shaped like ANOTHER tenant's row (RLS hides it — the
    // refusal is indistinguishable from an unknown id).
    await withTenant(TENANT, async () => {
      await expect(
        registry.register({
          actorId: PA,
          tenantId: TENANT,
          deviceName: "P3B cross-tenant phone",
          deviceClass: "android-personal",
          linkedPartnerId: P_CROSS_TENANT,
          actorEmail: PA_EMAIL,
        }),
      ).rejects.toBeInstanceOf(DevicePartnerLinkError);
    });
    // A random unknown id.
    await withTenant(TENANT, async () => {
      await expect(
        registry.register({
          actorId: PA,
          tenantId: TENANT,
          deviceName: "P3B unknown partner phone",
          deviceClass: "android-personal",
          linkedPartnerId: generateUuidV7(),
          actorEmail: PA_EMAIL,
        }),
      ).rejects.toBeInstanceOf(DevicePartnerLinkError);
    });
    // An ACTIVE SUPPLIER the identity IS a contact of — the personal
    // account link is for CUSTOMERS only.
    await withTenant(TENANT, async () => {
      await expect(
        registry.register({
          actorId: PA,
          tenantId: TENANT,
          deviceName: "P3B supplier-link phone",
          deviceClass: "android-personal",
          linkedPartnerId: P_SUP,
          actorEmail: PA_EMAIL,
        }),
      ).rejects.toBeInstanceOf(DevicePartnerLinkError);
    });
  });

  it("class gate: linkedPartnerId on a NON-personal device class → refused (even for the admin)", async () => {
    await withTenant(TENANT, async () => {
      await expect(
        registry.register({
          actorId: ADMIN,
          tenantId: TENANT,
          deviceName: "P3B field device (link refused)",
          deviceClass: "android-field",
          linkedPartnerId: world.customerId,
          actorEmail: "p3b-admin@fixture.test",
        }),
      ).rejects.toBeInstanceOf(DevicePartnerLinkError);
    });
  });

  it("admin path: identity.devices.manage may link a partner it is NOT a contact of (audited as admin)", async () => {
    const registered = await withTenant(TENANT, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT,
        deviceName: "P3B admin-registered phone",
        deviceClass: "android-personal",
        linkedPartnerId: P_OTHER,
        actorEmail: "p3b-admin@fixture.test",
      }),
    );
    const client = await tenantClient();
    const link = await client.query<{ linked_partner_id: string | null }>(
      `SELECT linked_partner_id FROM devices WHERE id = $1`,
      [registered.device.id],
    );
    expect(link.rows[0]!.linked_partner_id).toBe(P_OTHER);
    await client.end();

    const events = await auditEvents("device.registered", registered.device.id);
    expect(events[0]!.after).toMatchObject({
      linkedPartnerId: P_OTHER,
      linkedPartnerAuthorizedBy: "admin",
    });
  });

  it("legacy register calls without a link keep working (linked_partner_id stays NULL)", async () => {
    const registered = await withTenant(TENANT, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT,
        deviceName: "P3B desktop (no link)",
        deviceClass: "tauri-desktop",
      }),
    );
    const client = await tenantClient();
    const link = await client.query<{ linked_partner_id: string | null }>(
      `SELECT linked_partner_id FROM devices WHERE id = $1`,
      [registered.device.id],
    );
    expect(link.rows[0]!.linked_partner_id).toBeNull();
    await client.end();
  });
});
