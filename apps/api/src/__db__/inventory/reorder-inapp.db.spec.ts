import { beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { ReorderService } from "../../modules/inventory/application/reorder-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import type { EmailService } from "../../modules/notifications/application/email-service";

/**
 * PHASE-015 T10 · the reorder scan's in-app leg (BR-019 — alert only,
 * never autopilot; PHASE-015 §6: "reorder alert (notification created; no
 * PO created)"): a dedicated tenant with an owner membership, two items
 * pushed below their reorder levels, and the nightly scan run with a
 * capturing email stub — the `stock`-category digest lands in the owner's
 * inbox exactly once per 24h window, the email still rides the queue, the
 * audit event records it, and the purchasing tables stay untouched.
 */

const TENANT_RO = "39393939-3939-3939-3939-393939393939";
const RO_ACTOR = "3a3a3a3a-0000-4000-8000-00000000003a";
const RO_OWNER = "3a3a3a3a-0000-4000-8000-00000000003b";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const periods = new PeriodService(audit);
const coa = new CoaService(audit);
const warehouses = new WarehouseService(audit);
const stock = new StockService(audit, posting);
const inbox = new InboxService();

interface EmailedCall {
  template: string;
  recipient: string;
  variables: Record<string, string>;
}
const emailed: EmailedCall[] = [];
const emailStub = {
  enqueue: async (_tenantId: string, payload: EmailedCall) => {
    emailed.push(payload);
  },
} as unknown as EmailService;
const reorder = new ReorderService(audit, emailStub, inbox);

let warehouseId = "";
let itemA = "";
let itemB = "";

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant RO (reorder in-app)', 'المستأجر ر-ع', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_RO],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'ro-actor@fixture.test', 'RO Actor', 'x', 'ACTIVE', 'ar'),
            ($2, 'reord-owner@fixture.test', 'RO Owner', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [RO_ACTOR, RO_OWNER],
  );
  // The owner membership (the scan's email + in-app target).
  const ownerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
    [roleId, TENANT_RO],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
    [roleId, TENANT_RO, ownerTemplate.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_RO, RO_OWNER, roleId],
  );
  await su.end();

  await withTenant(TENANT_RO, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, listBranches, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    // COUNT_GAIN receipts post CR INVENTORY_APPRECIATION — the one host
    // the template leaves unmarked (same tenant-setup step as the
    // inventory fixture: 4920 created on demand).
    if ((await findActivePurpose("INVENTORY_APPRECIATION")) === undefined) {
      let appreciation = await findAccountByCode("4920");
      if (appreciation === undefined) {
        appreciation = await coa.create(RO_ACTOR, {
          code: "4920",
          name: "Inventory appreciation",
          nameAr: "زيادة قيمة المخزون",
          type: "REVENUE",
          parentId: (await findAccountByCode("4000"))!.id,
          currencyCode: null,
          isGroup: false,
        });
      }
      await insertAccountPurpose({
        purposeKey: "INVENTORY_APPRECIATION",
        accountId: appreciation.id,
        activeFrom: "2025-12-01",
      });
    }

    if ((await findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(RO_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }

    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    const existing = await warehouses.list({ limit: 10, activeOnly: false });
    const warehouse =
      existing.find((w) => w.code === "RO-WH") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "RO-WH",
        name: "Reorder warehouse",
        nameAr: "مستودع إعادة الطلب",
        inventoryAccountId: null,
        note: null,
        actorId: RO_ACTOR,
      }));
    warehouseId = warehouse.id;

    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, name: string) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      return created.id;
    };
    itemA = await ensureItem("RO-A", "Reorder item A");
    itemB = await ensureItem("RO-B", "Reorder item B");

    // Position: 10 units of A @ 2 and 4 of B @ 1 (2026-01-05) — guard on
    // the on-hand read model so re-entry never double-receives.
    const inventoryStore = await import("../../modules/inventory/infrastructure/inventory.store");
    const positioned = await inventoryStore.findItemStock(itemA, warehouse.id);
    if (positioned === undefined || Number(positioned.qty) === 0) {
      await stock.manualReceipt({
        itemId: itemA,
        warehouseId,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: RO_ACTOR,
      });
      await stock.manualReceipt({
        itemId: itemB,
        warehouseId,
        qty: "4",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: RO_ACTOR,
      });
    }

    // Reorder levels above the on-hand: A 10 ≤ 20, B 4 ≤ 10.
    await warehouses.upsertItemSetting({
      itemId: itemA,
      warehouseId,
      reorderLevel: "20",
      minQty: "5",
      actorId: RO_ACTOR,
    });
    await warehouses.upsertItemSetting({
      itemId: itemB,
      warehouseId,
      reorderLevel: "10",
      minQty: "2",
      actorId: RO_ACTOR,
    });
  });
});

describe("BR-019 reorder scan — the PHASE-015 in-app leg (T10)", () => {
  it("the scan creates the stock-category inbox digest + the email + the audit, and NO purchase orders", async () => {
    const first = await withTenant(TENANT_RO, () =>
      reorder.runNightlyScan({ runMode: "NIGHTLY", checkedBy: RO_ACTOR }),
    );
    expect(first.belowReorder).toBe(2);
    expect(first.alerted).toBe(2);
    expect(first.recipient).toBe("reord-owner@fixture.test");
    expect(first.notifiedInApp).toBe(true);

    // The email still rides the templated queue (AR, both items listed).
    expect(emailed.length).toBe(1);
    expect(emailed[0]!.template).toBe("stock_below_reorder");
    expect(emailed[0]!.recipient).toBe("reord-owner@fixture.test");
    expect(emailed[0]!.variables.items).toContain("RO-A");

    // The in-app digest: owner-targeted, stock category, warning, action
    // link to the replenishment view, bilingual body naming the count.
    const rows = await withTenant(TENANT_RO, () => inbox.listForUser(RO_OWNER, { limit: 10 }));
    const digest = rows.find((row) => row.title.en.includes("reorder level"));
    expect(digest).toBeDefined();
    expect(digest!.userId).toBe(RO_OWNER);
    expect(digest!.category).toBe("stock");
    expect(digest!.severity).toBe("warning");
    expect(digest!.actionUrl).toBe("/inventory/below-reorder");
    expect(digest!.title.ar).toContain("2");
    expect(digest!.body.ar).toContain("RO-A");
    expect(digest!.readAt).toBeNull();

    // The dedupe key carries the 24h window index.
    const su = await superuserClient();
    const keyRow = await su.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM notifications WHERE tenant_id = $1 AND category = 'stock' LIMIT 1`,
      [TENANT_RO],
    );
    expect(keyRow.rows[0]!.dedupe_key).toMatch(/^stock\.below_reorder:\d+$/);

    // The purchasing tables gained NOTHING (BR-019: alert only).
    const orders = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM purchase_orders WHERE tenant_id = $1`,
      [TENANT_RO],
    );
    expect(orders.rows[0]!.n).toBe("0");
    const requests = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM purchase_requests WHERE tenant_id = $1`,
      [TENANT_RO],
    );
    expect(requests.rows[0]!.n).toBe("0");
    await su.end();

    // The audit event carries the in-app flag (the durable surface).
    const events = await withTenant(TENANT_RO, () =>
      audit.list({ entityType: "item_warehouse_setting", limit: 10 }),
    );
    const scanEvent = events.find((event) => event.action === "inventory.stock_below_reorder");
    expect(scanEvent).toBeDefined();
    expect((scanEvent!.after as { notifiedInApp?: boolean }).notifiedInApp).toBe(true);
  });

  it("a second scan inside the 24h window does not duplicate the digest", async () => {
    const before = await withTenant(TENANT_RO, () => inbox.listForUser(RO_OWNER, { limit: 50 }));
    const second = await withTenant(TENANT_RO, () =>
      reorder.runNightlyScan({ runMode: "ON_DEMAND", checkedBy: RO_ACTOR }),
    );
    expect(second.alerted).toBe(0);
    expect(second.withinWindow).toBe(2);
    expect(second.notifiedInApp).toBe(false);

    const after = await withTenant(TENANT_RO, () => inbox.listForUser(RO_OWNER, { limit: 50 }));
    expect(after.length).toBe(before.length);
    expect(after.filter((row) => row.category === "stock").length).toBe(1);
    // The email did not re-fire either (the dedupe stamp held).
    expect(emailed.length).toBe(1);
  });

  it("belowReorderList() suggests replenishment quantities (max(level×2 − on-hand, level))", async () => {
    const suggestions = await withTenant(TENANT_RO, () => reorder.belowReorderList());
    expect(suggestions).toHaveLength(2);
    const a = suggestions.find((row) => row.itemSku === "RO-A")!;
    const b = suggestions.find((row) => row.itemSku === "RO-B")!;
    expect(a.qtyOnHand).toBe("10.000000");
    expect(a.reorderLevel).toBe("20.000000");
    expect(a.suggestedReorderQty).toBe("30.000000"); // max(40−10, 20)
    expect(b.suggestedReorderQty).toBe("16.000000"); // max(20−4, 10)
    expect(b.itemName).toBe("Reorder item B");
  });

  it("the owner's stock-category preference suppresses the in-app channel (email still on)", async () => {
    // Turn in-app OFF for stock; drop the alert stamps so the scan has due
    // rows again (superuser tooling — the window's dedupe is per stamp).
    await withTenant(TENANT_RO, () =>
      inbox.upsertPref(RO_OWNER, { category: "stock", inApp: false, email: true }),
    );
    const su = await superuserClient();
    await su.query(
      `UPDATE item_warehouse_settings SET last_reorder_alerted_at = NULL WHERE tenant_id = $1`,
      [TENANT_RO],
    );
    await su.end();

    const before = await withTenant(TENANT_RO, () => inbox.listForUser(RO_OWNER, { limit: 50 }));
    const suppressed = await withTenant(TENANT_RO, () =>
      reorder.runNightlyScan({ runMode: "ON_DEMAND", checkedBy: RO_ACTOR }),
    );
    expect(suppressed.alerted).toBe(2);
    expect(suppressed.notifiedInApp).toBe(false); // pref-suppressed
    const after = await withTenant(TENANT_RO, () => inbox.listForUser(RO_OWNER, { limit: 50 }));
    expect(after.length).toBe(before.length); // no new row
    expect(emailed.length).toBe(2); // the email channel is unaffected
  });
});
