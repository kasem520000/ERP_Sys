import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { ConsignmentService } from "../../modules/inventory/application/consignment-service";
import {
  ConsignmentPartnerInvalidError,
  ConsignmentStockShortError,
} from "../../modules/inventory/domain/inventory-errors";
import type { AuditService } from "../../modules/audit/api/audit";
import {
  I_ACTOR,
  I_JAN,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  type InventoryFixture,
} from "./fixtures";

/**
 * Consignment / VMI suite (PHASE-044 T-09; §2.9, I-10/I-11/I-19): the
 * owner-partner substrate — vendor-owned rows at bin level EXCLUDED from
 * valuation and ATP (BR-076: item_stock, stock_moves, and the pick
 * allocation source never see them; INV-029's fold spans tenant-owned
 * rows only), the structural receive/return legs (no journal — the stock
 * is not the tenant's asset), and the consumption settlement G-44
 * (DR COGS · CR 2135 CONSIGNATION_PAYABLE at the agreed unit price, the
 * owner stamped on both legs — fail-closed until 2135 maps, BR-077).
 */

let fixture: InventoryFixture;
let consignment: ConsignmentService;
let supplierId = "";
let customerId = "";
let consignmentPayableAccount = "";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { PostingService } = await import("../../modules/accounting/application/posting-service");
  const { PartnerSubledgerService } = await import("../../modules/partners/application/subledger-service");
  const audit = new AuditService(new DrizzleAuditStore()) as AuditService;
  consignment = new ConsignmentService(audit, new PostingService(audit, new PartnerSubledgerService()));

  await withTenant(TENANT_I, async () => {
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const { findAccountByCode, findActivePurpose, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    // A supplier (the VMI owner) + a customer (the invalid-owner case).
    const page = await partnersStore.listPartners({}, undefined, 100);
    const existing = page.rows.concat(page.hasMore ? await (async () => {
      const page2 = await partnersStore.listPartners({}, page.nextCursor ?? undefined, 100);
      return page2.rows;
    })() : []);
    const supplier =
      existing.find((p) => p.code === "VMI-SUP") ??
      (await partnersStore.insertPartner({
        kind: "SUPPLIER",
        code: "VMI-SUP",
        name: "VMI Supplier",
        nameAr: "مورد الأمانة",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }));
    supplierId = supplier.id;
    const customer =
      existing.find((p) => p.code === "VMI-CUST") ??
      (await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "VMI-CUST",
        name: "Plain Customer",
        nameAr: "عميل عادي",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }));
    customerId = customer.id;

    if ((await findActivePurpose("CONSIGNATION_PAYABLE")) === undefined) {
      const account = await findAccountByCode("2135");
      if (account === undefined) throw new Error("fixture account 2135 missing");
      await insertAccountPurpose({
        purposeKey: "CONSIGNATION_PAYABLE",
        accountId: account.id,
        activeFrom: "2025-12-01",
      });
    }
    consignmentPayableAccount = (await findAccountByCode("2135"))!.id;
  });
});

describe("§2.9 — the receive leg: owner rows land structurally, EXCLUDED from the tenant's books", () => {
  it("receive writes bin_contents with the owner set; item_stock/stock_moves stay untouched (BR-076)", async () => {
    const item = await ensureInventoryItem("INV-CON-1", "Consignment plain item");
    const before = await withTenant(TENANT_I, () => store.findItemStock(item, fixture.warehouseMain));
    const movesBefore = await withTenant(TENANT_I, () =>
      store.listStockMoves({ warehouseId: fixture.warehouseMain, itemId: item, limit: 500 }),
    );

    const received = await withTenant(TENANT_I, () =>
      consignment.receive({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        ownerPartnerId: supplierId,
        qty: "80",
        targetBinId: null,
        lpnId: null,
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: null,
        note: "VMI replenishment",
        actorId: I_ACTOR,
      }),
    );
    expect(received.qty).toBe("80");

    // The owner's rows exist at the default bin with the owner stamped.
    const ownerRows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ ownerPartnerId: supplierId, itemId: item, limit: 10 }),
    );
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]!.ownerPartnerName).toBe("VMI Supplier");
    expect(ownerRows[0]!.qty).toBe("80.000000");

    // BR-076's exclusions — byte-identical tenant books.
    const after = await withTenant(TENANT_I, () => store.findItemStock(item, fixture.warehouseMain));
    expect(after?.qty ?? "0").toBe(before?.qty ?? "0");
    const movesAfter = await withTenant(TENANT_I, () =>
      store.listStockMoves({ warehouseId: fixture.warehouseMain, itemId: item, limit: 500 }),
    );
    expect(movesAfter).toHaveLength(movesBefore.length);

    // The INV-029 probe never reports the owner's rows (the fold is
    // tenant-owned only).
    const recon = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: fixture.warehouseMain }));
    expect(recon.some((row) => row.itemId === item)).toBe(false);

    // ATP at bin level: the owner's rows are invisible.
    const available = await withTenant(TENANT_I, () =>
      wmsStore.availableQtyByBin({ warehouseId: fixture.warehouseMain, itemId: item }),
    );
    expect(available).toHaveLength(0);
  });

  it("a CUSTOMER partner cannot own consignment stock (typed)", async () => {
    const item = await ensureInventoryItem("INV-CON-2", "Consignment second item");
    await expect(
      withTenant(TENANT_I, () =>
        consignment.receive({
          itemId: item,
          warehouseId: fixture.warehouseMain,
          ownerPartnerId: customerId,
          qty: "5",
          targetBinId: null,
          lpnId: null,
          batchId: null,
          batchNo: null,
          batchExpiry: null,
          serialIds: null,
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(ConsignmentPartnerInvalidError);
  });
});

describe("G-44 — the consumption settlement", () => {
  it("consume posts DR COGS · CR 2135 at the agreed price, decrements the owner's rows, and leaves the tenant's ledger untouched", async () => {
    const item = await ensureInventoryItem("INV-CON-3", "Consignment settle item");
    await withTenant(TENANT_I, () =>
      consignment.receive({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        ownerPartnerId: supplierId,
        qty: "50",
        targetBinId: null,
        lpnId: null,
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: null,
        note: null,
        actorId: I_ACTOR,
      }),
    );

    const result = await withTenant(TENANT_I, () =>
      consignment.consume({
        ownerPartnerId: supplierId,
        warehouseId: fixture.warehouseMain,
        itemId: item,
        qty: "20",
        unitPrice: "7.500000",
        valueDate: I_JAN,
        note: "sold on behalf of the owner",
        actorId: I_ACTOR,
      }),
    );
    expect(result.valueAmount).toBe("150.0000");
    expect(result.journalEntryId).toBeTruthy();

    const lines = await withTenant(TENANT_I, () => journal.listLines(result.journalEntryId!));
    const debit = lines.find((l) => l.direction === "DEBIT");
    const credit = lines.find((l) => l.direction === "CREDIT");
    expect(debit?.accountId).toBe(fixture.glCogs);
    expect(debit?.amount).toBe("150.0000");
    expect(debit?.partnerId).toBe(supplierId);
    expect(credit?.accountId).toBe(consignmentPayableAccount);
    expect(credit?.amount).toBe("150.0000");
    expect(credit?.partnerId).toBe(supplierId);

    // The owner's row decremented to 30; item_stock STILL untouched.
    const ownerRows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ ownerPartnerId: supplierId, itemId: item, limit: 10 }),
    );
    expect(Number(ownerRows[0]!.qty)).toBe(30);
    const stockRow = await withTenant(TENANT_I, () => store.findItemStock(item, fixture.warehouseMain));
    expect(stockRow ?? null).toBeNull();

    // A second settlement posts again (the exactly-once key is per
    // settlement, never per partner).
    const second = await withTenant(TENANT_I, () =>
      consignment.consume({
        ownerPartnerId: supplierId,
        warehouseId: fixture.warehouseMain,
        itemId: item,
        qty: "5",
        unitPrice: "8.000000",
        valueDate: I_JAN,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    expect(second.valueAmount).toBe("40.0000");
    expect(second.journalEntryId).not.toBe(result.journalEntryId);
  });

  it("an over-draw is the typed rejection with zero residue", async () => {
    const item = await ensureInventoryItem("INV-CON-4", "Consignment short item");
    await withTenant(TENANT_I, () =>
      consignment.receive({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        ownerPartnerId: supplierId,
        qty: "10",
        targetBinId: null,
        lpnId: null,
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: null,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_I, () =>
        consignment.consume({
          ownerPartnerId: supplierId,
          warehouseId: fixture.warehouseMain,
          itemId: item,
          qty: "11",
          unitPrice: "1.000000",
          valueDate: I_JAN,
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(ConsignmentStockShortError);
    const ownerRows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ ownerPartnerId: supplierId, itemId: item, limit: 10 }),
    );
    expect(Number(ownerRows[0]!.qty)).toBe(10);
  });
});

describe("§2.9 — the serialized + return legs", () => {
  it("serialized consignment stock: CONSIGNMENT_IN at receive, CONSIGNMENT_OUT + sold at consume (one row per movement)", async () => {
    const item = await ensureInventoryItem("INV-CON-5", "Consignment serial item", { trackSerial: true });
    const { tracking } = await import("./fixtures");
    const serial = await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: item, serialNo: "VMI-0001", imei: null, actorId: I_ACTOR }),
    );
    await withTenant(TENANT_I, () =>
      consignment.receive({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        ownerPartnerId: supplierId,
        qty: "1",
        targetBinId: null,
        lpnId: null,
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: [serial.id],
        note: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () =>
      consignment.consume({
        ownerPartnerId: supplierId,
        warehouseId: fixture.warehouseMain,
        itemId: item,
        qty: "1",
        unitPrice: "15.000000",
        valueDate: I_JAN,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const ledger = await withTenant(TENANT_I, () => wmsStore.listSerialMovements({ serialId: serial.id, limit: 10 }));
    expect([...ledger.map((row) => row.event)].sort()).toEqual(["CONSIGNMENT_IN", "CONSIGNMENT_OUT"]);
    const serialRow = await withTenant(TENANT_I, () => store.findSerialById(serial.id));
    expect(serialRow?.status).toBe("sold");
  });

  it("returnToOwner drains the rows structurally — no journal, the unit returns to the owner's custody", async () => {
    const item = await ensureInventoryItem("INV-CON-6", "Consignment return item");
    await withTenant(TENANT_I, () =>
      consignment.receive({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        ownerPartnerId: supplierId,
        qty: "12",
        targetBinId: null,
        lpnId: null,
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: null,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_I, () =>
      consignment.returnToOwner({
        ownerPartnerId: supplierId,
        warehouseId: fixture.warehouseMain,
        itemId: item,
        qty: "12",
        note: "end of the VMI contract",
        actorId: I_ACTOR,
      }),
    );
    expect(result.qty).toBe("12");
    const ownerRows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ ownerPartnerId: supplierId, itemId: item, limit: 10 }),
    );
    expect(Number(ownerRows[0]!.qty)).toBe(0);
    // No journal exists for the return (structural only — the settled
    // item's entries all predate it; none reference this item).
    const entries = await withTenant(TENANT_I, () =>
      journal.listEntries({ sourceType: "consignment_settlement", limit: 50 }),
    );
    expect(entries.rows.some((e) => e.description?.includes("INV-CON-6"))).toBe(false);
  });

  it("the VMI view folds the owner's on-hand per item", async () => {
    const view = await withTenant(TENANT_I, () => consignment.ownerOnHand(supplierId, fixture.warehouseMain));
    const row = view.find((entry) => entry.itemSku === "INV-CON-3");
    expect(row?.qty).toBe(25); // 50 − 20 − 5
  });
});
