import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { setupTradeFixture, TENANT_TRADE, TR_ACTOR } from "./fixtures";
import { TransportService } from "../../modules/trade/application/transport-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import {
  BlRecordNotFoundError,
  TransportInputInvalidError,
} from "../../modules/trade/domain/trade-errors";

/**
 * PHASE-051 (W-36 — T-09, 2026-11-25) `trade-transport.db.spec` — THE
 * TRANSPORT DOCUMENTS over real PG16 (the plan §4's own arm; the
 * master plan §3 W-36's T-09 share): the multimodal bills of lading
 * (the shipment's own anchor — the official numbers, the commercial
 * links, the container refs) and the packing lists (the anchor law —
 * the B/L link required at the service floor; the pack lines' shape +
 * THE PHYSICAL LAW gross ≥ net). The documents' shipment_status is
 * NEVER writable here — the fold drives it (D-14's own law, asserted
 * as the initial BOOKED rung on every create).
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»):
 * every arm builds its own documents through the service's own create
 * (the official BL/PL numbers reserve per row — every world naturally
 * unique); a rejection arm never shares mutable rows with another arm.
 */

const audit = new AuditService(new DrizzleAuditStore());
const numbering = new NumberingService(audit);
const transport = new TransportService(audit, numbering);

const world: { purchaseOrderId?: string } = {};

beforeAll(async () => {
  const fixture = await setupTradeFixture();
  // The import leg's commercial link (the PO the B/L rides —
  // acceptance #8's chain: PO → LC/collection → transport documents →
  // declaration → receipt → landed cost).
  await withTenant(TENANT_TRADE, async () => {
    const { PurchaseOrderService } = await import("../../modules/purchasing/application/orders");
    const purchaseOrders = new PurchaseOrderService(audit, numbering);
    const po = await purchaseOrders.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      orderDate: "2026-11-25",
      expectedDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
      lines: [
        { itemId: fixture.itemId, qty: "12", unitPrice: "45.000000", taxCodeId: null, requestLineId: null, note: null },
      ],
    });
    world.purchaseOrderId = po.id;
  });
});

/** The raw B/L row (the zero-residue + the fold-initial-rung reads). */
async function rawBl(id: string): Promise<{ shipmentStatus: string; blNo: string }> {
  const rows = await requireTenantContext().tx!.execute<{ shipmentStatus: string; blNo: string }>(sql`
    SELECT shipment_status AS "shipmentStatus", bl_no AS "blNo" FROM bills_of_lading WHERE id = ${id}`);
  return rows.rows[0]!;
}

async function blCount(): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM bills_of_lading WHERE tenant_id = ${TENANT_TRADE}`);
  return rows.rows[0]!.n;
}

async function plCount(): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM packing_lists WHERE tenant_id = ${TENANT_TRADE}`);
  return rows.rows[0]!.n;
}

describe("PHASE-051 W-36 — THE TRANSPORT DOCUMENTS (T-09: the multimodal B/L — the shipment's anchor — + the packing lists, the fold's initial rung on every create)", () => {
  it("THE B/L GOLDEN CREATE: the official BL-{YYYY}-{SEQ:6} number, the multimodal type, the commercial links, the container refs, THE FOLD'S INITIAL RUNG (BOOKED — no manual status write exists anywhere), and the find's own chain (the B/L + its packing lists + its events)", async () => {
    const before = await withTenant(TENANT_TRADE, () => blCount());
    const bl = await withTenant(TENANT_TRADE, () =>
      transport.createBl({
        docType: "MULTIMODAL",
        carrierName: "Maersk Line",
        portOfLoading: "Port Jeddah",
        portOfDischarge: "Port Rotterdam",
        containerRefs: ["MAEU-1234567", "MAEU-7654321"],
        purchaseOrderId: world.purchaseOrderId!,
        deliveryNoteId: null,
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    expect(bl.blNo).toMatch(/^BL-\d{4}-\d{6}$/);
    expect(bl.docType).toBe("MULTIMODAL");
    expect(bl.shipmentStatus).toBe("BOOKED");
    expect(bl.containerRefs).toEqual(["MAEU-1234567", "MAEU-7654321"]);
    expect(bl.purchaseOrderId).toBe(world.purchaseOrderId);
    expect(await withTenant(TENANT_TRADE, () => blCount())).toBe(before + 1);

    // The packing list under it (the chain's own read).
    const packing = await withTenant(TENANT_TRADE, () =>
      transport.createPackingList({
        billOfLadingId: bl.id,
        receiptId: null,
        lines: [
          { description: "Pallets of TR goods", packages: 40, grossKg: "8200.000", netKg: "8000.000" },
          { description: "Crated spares", packages: 6, grossKg: "540.500", netKg: "500.000" },
        ],
        actorId: TR_ACTOR,
      }),
    );
    expect(packing.plNo).toMatch(/^PL-\d{4}-\d{6}$/);
    expect(packing.billOfLadingId).toBe(bl.id);
    expect(packing.shipmentStatus).toBe("BOOKED");
    expect(packing.lines).toEqual([
      { description: "Pallets of TR goods", packages: 40, grossKg: "8200.000", netKg: "8000.000" },
      { description: "Crated spares", packages: 6, grossKg: "540.500", netKg: "500.000" },
    ]);

    // The find's own chain: the B/L + the packing lists + the events.
    const found = await withTenant(TENANT_TRADE, () => transport.findBl(bl.id));
    expect(found.bl.id).toBe(bl.id);
    expect(found.packingLists.map((row) => row.plNo)).toEqual([packing.plNo]);
    expect(found.events).toEqual([]);
  });

  it("THE DOC-TYPE VOCABULARY refuses outside the multimodal set — the typed error, ZERO residue", async () => {
    const before = await withTenant(TENANT_TRADE, () => blCount());
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createBl({
          docType: "CANAL" as "SEA",
          carrierName: "Fixture Carrier",
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    expect(await withTenant(TENANT_TRADE, () => blCount())).toBe(before);
  });

  it("THE B/L'S OWN FLOORS: the empty carrier name, the blank port, the oversized container ref and the >50 refs refuse — all typed, all zero residue", async () => {
    const before = await withTenant(TENANT_TRADE, () => blCount());
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createBl({ docType: "SEA", carrierName: "   ", actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createBl({ docType: "SEA", carrierName: "Carrier", portOfLoading: "  ", actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createBl({
          docType: "SEA",
          carrierName: "Carrier",
          containerRefs: ["X".repeat(51)],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createBl({
          docType: "AIR",
          carrierName: "Carrier",
          containerRefs: Array.from({ length: 51 }, (_, i) => `REF-${i}`),
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    expect(await withTenant(TENANT_TRADE, () => blCount())).toBe(before);
  });

  it("THE UNKNOWN B/L is the typed 404 shape (the find and the packing-list anchor alike)", async () => {
    const notFound = await withTenant(TENANT_TRADE, () =>
      transport.findBl("9e9e9e9e-9e9e-4999-8999-9e9e9e9e9e9e")
        .catch((error: unknown) => error));
    expect(notFound).toBeInstanceOf(BlRecordNotFoundError);
    expect((notFound as BlRecordNotFoundError).code).toBe("BL_RECORD_NOT_FOUND");
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createPackingList({
          billOfLadingId: "9e9e9e9e-9e9e-4999-8999-9e9e9e9e9e9e",
          lines: [{ description: "Pallets", packages: 1, grossKg: "10.000", netKg: "9.000" }],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(BlRecordNotFoundError);
  });

  it("THE PACKING LIST'S ANCHOR + SHAPES: the empty lines set, the blank description, the non-integer packages, the bad kilogram shapes and THE PHYSICAL LAW (gross below net) refuse — all typed, all zero residue", async () => {
    const bl = await withTenant(TENANT_TRADE, () =>
      transport.createBl({ docType: "ROAD", carrierName: "Land Bridge Freight", actorId: TR_ACTOR }));
    const before = await withTenant(TENANT_TRADE, () => plCount());
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createPackingList({ billOfLadingId: bl.id, lines: [], actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createPackingList({
          billOfLadingId: bl.id,
          lines: [{ description: "  ", packages: 1, grossKg: "1.000", netKg: "1.000" }],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createPackingList({
          billOfLadingId: bl.id,
          lines: [{ description: "Pallets", packages: 1.5, grossKg: "1.000", netKg: "1.000" }],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    await expect(
      withTenant(TENANT_TRADE, () =>
        transport.createPackingList({
          billOfLadingId: bl.id,
          lines: [{ description: "Pallets", packages: 1, grossKg: "1.0005", netKg: "1.000" }],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TransportInputInvalidError);
    // THE PHYSICAL LAW: the gross weight carries the packaging — never
    // below the net.
    const physical = await withTenant(TENANT_TRADE, () =>
      transport.createPackingList({
        billOfLadingId: bl.id,
        lines: [{ description: "Pallets", packages: 1, grossKg: "9.000", netKg: "10.000" }],
        actorId: TR_ACTOR,
      }).catch((error: unknown) => error));
    expect(physical).toBeInstanceOf(TransportInputInvalidError);
    expect((physical as TransportInputInvalidError).details!.reason).toContain("never the reverse");
    expect(await withTenant(TENANT_TRADE, () => plCount())).toBe(before);
  });

  it("THE LIST SURFACES: the B/L register filters by doc type and driven status; the packing lists filter by the anchor", async () => {
    const air = await withTenant(TENANT_TRADE, () =>
      transport.createBl({ docType: "AIR", carrierName: "Emirates SkyCargo", actorId: TR_ACTOR }));
    const byType = await withTenant(TENANT_TRADE, () => transport.listBls({ docType: "AIR" }));
    expect(byType.length).toBeGreaterThan(0);
    expect(byType.every((row) => row.docType === "AIR")).toBe(true);
    expect(byType.some((row) => row.id === air.id)).toBe(true);
    const booked = await withTenant(TENANT_TRADE, () => transport.listBls({ shipmentStatus: "BOOKED" }));
    expect(booked.length).toBeGreaterThan(0);
    const underAir = await withTenant(TENANT_TRADE, () =>
      transport.listPackingLists({ billOfLadingId: air.id }));
    expect(underAir).toEqual([]);
    const raw = await withTenant(TENANT_TRADE, () => rawBl(air.id));
    expect(raw.shipmentStatus).toBe("BOOKED");
  });
});
