import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { WmsService } from "../../modules/inventory/application/wms.service";
import { CycleCountService } from "../../modules/inventory/application/cycle-count-service";
import { ConsignmentService } from "../../modules/inventory/application/consignment-service";
import type { AuditService } from "../../modules/audit/api/audit";
import { AuditService as AuditServiceImpl } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { findAccountByCode, findActivePurpose, insertAccountPurpose } from "../../modules/tenancy/infrastructure/tenancy.store";
import {
  I_ACTOR,
  I_JAN,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  tracking,
  type InventoryFixture,
} from "./fixtures";

/**
 * INV-029 invariants suite (PHASE-044 T-18; acceptance §6.2): Σ tenant-owned
 * bin_contents = item_stock per (warehouse, item) AT ALL TIMES — asserted
 * after EVERY movement kind in one continuous scenario (receipt → explicit
 * bin → quarantine transition → LPN move → cycle-count adjust →
 * consignment receive → issue), plus the exclusion rules (quarantined/HOLD
 * rows leave the bin-level ATP; owner-partner rows never enter valuation or
 * ATP — BR-076) and the serialized-completeness property over the walk's
 * own corpus (every serialized move covered exactly once).
 *
 * The blocking side of INV-029 is the movement core's BinContentsShortError
 * (the T-03/T-04 suites prove it); this suite is the invariant VIEW — the
 * fold never drifts, whatever the operation.
 */

let fixture: InventoryFixture;
let wms: WmsService;
let cycleCounts: CycleCountService;
let consignment: ConsignmentService;
let supplierId = "";

let itemA = "";
let itemS = "";
let explicitBinId = "";
let serial1 = "";
let serial2 = "";

const SKU_A = "INV-INV29-A";
const SKU_S = "INV-INV29-S";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const audit = new AuditServiceImpl(new DrizzleAuditStore()) as AuditService;
  const posting = new PostingService(audit, new PartnerSubledgerService());
  wms = new WmsService(audit, new InboxService());
  cycleCounts = new CycleCountService(audit, posting, new NumberingService(audit));
  consignment = new ConsignmentService(audit, posting);

  const wh = fixture.warehouseMain;
  itemA = await ensureInventoryItem(SKU_A, "INV-029 walk item");
  itemS = await ensureInventoryItem(SKU_S, "INV-029 serialized item", { trackSerial: true });

  // The consignment owner (the VMI-SUP pattern — a SUPPLIER partner).
  supplierId = await withTenant(TENANT_I, async () => {
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const page = await partnersStore.listPartners({}, undefined, 200);
    const existing =
      page.rows.find((p) => p.code === "VMI-SUP") ??
      (
        await partnersStore.listPartners({}, undefined, 200)
      ).rows.find((p) => p.code === "VMI-SUP");
    if (existing !== undefined) return existing.id;
    const created = await partnersStore.insertPartner({
      kind: "SUPPLIER",
      code: "VMI-SUP",
      name: "VMI Supplier",
      nameAr: "مورد الأمانة",
      taxNumber: null,
      creditLimit: null,
      creditTermsId: null,
      priceListId: null,
    });
    return created.id;
  });
  // The CONSIGNATION_PAYABLE mapping (the consignment consumption's
  // fail-closed account — needed only if consumption runs; the receive in
  // this walk is structural and never posts).
  await withTenant(TENANT_I, async () => {
    if ((await findActivePurpose("CONSIGNATION_PAYABLE")) === undefined) {
      const account = await findAccountByCode("2135");
      if (account !== undefined) {
        await insertAccountPurpose({
          purposeKey: "CONSIGNATION_PAYABLE",
          accountId: account.id,
          activeFrom: I_JAN,
        });
      }
    }
  });

  // The explicit pick bin for the walk (idempotent per code).
  explicitBinId = await withTenant(TENANT_I, async () => {
    const bins = await wmsStore.listBins({ warehouseId: wh, limit: 1000 });
    const found = bins.find((b) => b.code === "INV29-PICK-01");
    if (found !== undefined) return found.id;
    const zones = await wmsStore.listZones({ warehouseId: wh, limit: 500 });
    let zone = zones.find((z) => z.code === "INV29-ZONE");
    if (zone === undefined) {
      zone = await wmsStore.insertZone({
        warehouseId: wh,
        code: "INV29-ZONE",
        name: "INV-029 walk zone",
        nameAr: null,
        zoneType: "PICKING",
        isDefault: false,
        note: null,
        createdBy: I_ACTOR,
      });
    }
    const aisle = await wmsStore.insertAisle({
      zoneId: zone.id,
      code: "INV29-A1",
      name: "INV-029 walk aisle",
      nameAr: null,
      createdBy: I_ACTOR,
    });
    const rack = await wmsStore.insertRack({
      aisleId: aisle.id,
      code: "INV29-R1",
      name: "INV-029 walk rack",
      nameAr: null,
      createdBy: I_ACTOR,
    });
    const bin = await wmsStore.insertBin({
      warehouseId: wh,
      rackId: rack.id,
      code: "INV29-PICK-01",
      barcode: "BIN-INV29-PICK01",
      name: "INV-029 pick face",
      nameAr: null,
      pickSequence: 1,
      capacity: null,
      allowMixedBatches: true,
      isDefault: false,
      note: null,
      createdBy: I_ACTOR,
    });
    return bin.id;
  });

  serial1 = (
    await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: itemS, serialNo: "INV29-S-0001", imei: null, actorId: I_ACTOR }),
    )
  ).id;
  serial2 = (
    await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: itemS, serialNo: "INV29-S-0002", imei: null, actorId: I_ACTOR }),
    )
  ).id;
});

/** The fold: Σ tenant-owned bin_contents == item_stock for both walk items. */
async function assertFold(step: string): Promise<void> {
  const wh = fixture.warehouseMain;
  await withTenant(TENANT_I, async () => {
    for (const itemId of [itemA, itemS]) {
      const rows = await wmsStore.listBinContents({ warehouseId: wh, itemId, limit: 1000 });
      const tenantQty = rows
        .filter((row) => row.ownerPartnerId === null)
        .reduce((sum, row) => sum + Number(row.qty), 0);
      const stockRow = await store.findItemStock(itemId, wh);
      const stockQty = Number(stockRow?.qty ?? 0);
      expect(
        tenantQty,
        `${step}: Σ bins (${tenantQty}) must equal item_stock (${stockQty})`,
      ).toBe(stockQty);
    }
    // The probe sees NO drift for the walk's items (tenant I carries other
    // specs' intentional drift elsewhere — the filter is per-SKU).
    const probe = await wmsStore.reconcileBins({ warehouseId: wh });
    const mine = probe.filter(
      (row) => row.itemSku === SKU_A || row.itemSku === SKU_S,
    );
    expect(mine, `${step}: the probe must see no INV-029 drift for the walk items`).toEqual([]);
  });
}

describe("INV-029 — the fold holds after EVERY movement kind (one continuous walk)", () => {
  it("receipt → explicit bin → quarantine → LPN move → cycle-count adjust → consignment → issue", async () => {
    const wh = fixture.warehouseMain;

    // (1) A plain receipt lands in the lazy DEFAULT bin.
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: itemA,
        warehouseId: wh,
        qty: "100",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    await assertFold("receipt");

    // (2) A second receipt into the EXPLICIT bin — the fold spans bins.
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: itemA,
        warehouseId: wh,
        qty: "40",
        unitCost: "3.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        targetBinId: explicitBinId,
        binStatus: "AVAILABLE",
        actorId: I_ACTOR,
      }),
    );
    await assertFold("explicit-bin receipt");

    // (3) Quarantine the explicit row: the qty never economically moved —
    // INV-029 folds ALL statuses; the bin-level ATP DROPS it.
    const explicitRow = (
      await withTenant(TENANT_I, () =>
        wmsStore.listBinContents({ binId: explicitBinId, itemId: itemA, limit: 10 }),
      )
    )[0]!;
    await withTenant(TENANT_I, () =>
      wms.transitionStatus(explicitRow.id, "QUARANTINE", { note: "walk quarantine", actorId: I_ACTOR }),
    );
    await assertFold("quarantine transition");
    const atp = await withTenant(TENANT_I, () =>
      wmsStore.availableQtyByBin({ warehouseId: wh, itemId: itemA }),
    );
    const atpTotal = atp.reduce((sum, row) => sum + Number(row.qty), 0);
    expect(atpTotal).toBe(100); // the quarantined 40 left availability

    // (4) Bind the default-bin row to an LPN and move the plate.
    const lpn = await withTenant(TENANT_I, () =>
      wms.createLpn({ lpnCode: "INV29-LPN-1", note: "walk plate", actorId: I_ACTOR }),
    );
    const defaultRow = (
      await withTenant(TENANT_I, async () => {
        const bins = await wmsStore.listBins({ warehouseId: wh, limit: 1000 });
        const def = bins.find((b) => b.isDefault)!;
        return wmsStore.listBinContents({ binId: def.id, itemId: itemA, limit: 10 });
      })
    )[0]!;
    await withTenant(TENANT_I, () =>
      wms.bindContentToLpn(defaultRow.id, lpn.id, I_ACTOR),
    );
    await withTenant(TENANT_I, () =>
      wms.moveLpn({ lpnId: lpn.id, toBinId: explicitBinId, note: "walk move", actorId: I_ACTOR }),
    );
    await assertFold("LPN move");

    // (5) A cycle-count GAIN over item A: the plans ride the movement core,
    // so bins and stock move in the SAME approval transaction.
    const doc = await withTenant(TENANT_I, () =>
      cycleCounts.createDocument({
        warehouseId: wh,
        itemIds: [itemA],
        blind: false,
        note: "walk count",
        actorId: I_ACTOR,
      }),
    );
    const lines = await withTenant(TENANT_I, () => cycleCounts.lines(doc.id));
    await withTenant(TENANT_I, () =>
      cycleCounts.enterCounts({
        documentId: doc.id,
        entries: lines.map((line) => ({
          lineNo: line.lineNo,
          countedQty: (Number(line.systemQty) + 5).toFixed(6),
        })),
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => cycleCounts.submit(doc.id, I_ACTOR));
    await withTenant(TENANT_I, () => cycleCounts.review(doc.id, I_ACTOR));
    await withTenant(TENANT_I, () =>
      cycleCounts.approve({ id: doc.id, supervisor: true, actorId: I_ACTOR }),
    );
    await assertFold("cycle-count adjust");

    // (6) Consignment receive: owner rows NEVER enter valuation — item_stock
    // stays byte-identical and the fold (tenant-owned rows only) holds.
    const beforeStock = await withTenant(TENANT_I, () => store.findItemStock(itemA, wh));
    await withTenant(TENANT_I, () =>
      consignment.receive({
        itemId: itemA,
        warehouseId: wh,
        ownerPartnerId: supplierId,
        qty: "25",
        targetBinId: explicitBinId,
        lpnId: null,
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: null,
        note: "walk consignment",
        actorId: I_ACTOR,
      }),
    );
    const afterStock = await withTenant(TENANT_I, () => store.findItemStock(itemA, wh));
    expect(afterStock?.qty).toBe(beforeStock?.qty); // BR-076: no valuation entry
    await assertFold("consignment receive");
    // The ATP never sees the owner's rows either.
    const atpAfterConsignment = await withTenant(TENANT_I, () =>
      wmsStore.availableQtyByBin({ warehouseId: wh, itemId: itemA }),
    );
    expect(
      atpAfterConsignment.reduce((sum, row) => sum + Number(row.qty), 0),
    ).toBe(105); // 100 + 5 gain — the owner's 25 excluded

    // (7) The serialized leg: 2 units in, 1 out — then the completeness
    // property over the walk's corpus.
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: itemS,
        warehouseId: wh,
        qty: "2",
        unitCost: "9.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        serialIds: [serial1, serial2],
        actorId: I_ACTOR,
      }),
    );
    await assertFold("serialized receipt");
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: itemS,
        warehouseId: wh,
        qty: "1",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_JAN,
        serialIds: [serial1],
        actorId: I_ACTOR,
      }),
    );
    await assertFold("serialized issue");

    // (8) The final fold + the serialized ledger completeness: every
    // serialized move of the walk's serials carries exactly one ledger row.
    await assertFold("final");
    const ledger1 = await withTenant(TENANT_I, () =>
      wmsStore.listSerialMovements({ serialId: serial1, limit: 10 }),
    );
    const ledger2 = await withTenant(TENANT_I, () =>
      wmsStore.listSerialMovements({ serialId: serial2, limit: 10 }),
    );
    // The manual issue rides moveKind "issue" → the ledger event is PICK
    // (the movement core's vocabulary; ADJUST_OUT is the adjustment kind).
    expect(ledger1.map((row) => row.event).sort()).toEqual(["PICK", "RECEIVE"]);
    expect(ledger2.map((row) => row.event)).toEqual(["RECEIVE"]);
    // No (move, serial) pair ever duplicates (the T-11 property, restated
    // over this walk's corpus).
    const pairs = [...ledger1, ...ledger2].map((row) => `${row.moveId}:${row.serialId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("BR-073 — the one-default floors (zone + bin)", () => {
  it("a second DEFAULT bin in a warehouse with a default is the typed rejection; the same law holds for zones", async () => {
    const wh = fixture.warehouseMain;
    const bins = await withTenant(TENANT_I, () => wmsStore.listBins({ warehouseId: wh, limit: 1000 }));
    const defaultBin = bins.find((b) => b.isDefault);
    expect(defaultBin).toBeDefined(); // the 0071 §5 backfill anchor

    // A second default bin: typed, zero residue (BR-072's one-default floor).
    await expect(
      withTenant(TENANT_I, () =>
        wms.createBin({
          warehouseId: wh,
          rackId: defaultBin!.rackId,
          code: "INV29-SECOND-DEFAULT",
          barcode: "BIN-INV29-SECOND-DEF",
          name: "Second default (must reject)",
          nameAr: null,
          pickSequence: null,
          capacity: null,
          allowMixedBatches: true,
          isDefault: true,
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(/already has a default bin/);

    // The zone mirror: the walk's own non-default zone cannot flip a second
    // default while the warehouse holds one.
    const zones = await withTenant(TENANT_I, () => wmsStore.listZones({ warehouseId: wh, limit: 500 }));
    const walkZone = zones.find((z) => z.code === "INV29-ZONE")!;
    await expect(
      withTenant(TENANT_I, () =>
        wms.updateZone(walkZone.id, { isDefault: true }, I_ACTOR),
      ),
    ).rejects.toThrow(/already has a default zone/);
  });
});
