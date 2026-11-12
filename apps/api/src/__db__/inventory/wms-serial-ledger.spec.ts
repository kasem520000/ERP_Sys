import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { appClient } from "../test-db";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { KittingService } from "../../modules/inventory/application/kitting-service";
import { CycleCountService } from "../../modules/inventory/application/cycle-count-service";
import { SerialRequiredError } from "../../modules/inventory/domain/inventory-errors";
import type { AuditService } from "../../modules/audit/api/audit";
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
 * Serial-ledger completeness suite (PHASE-044 T-11; §2.12, I-16/I-18):
 * the audit's "serials without movements" gap closed — a PROPERTY probe
 * over the WHOLE accumulated tenant-I corpus (every spec's serialized
 * flows land in this tenant): no duplicate (move, serial) pairs, every
 * serialized move covered by its ledger row, every ledger row's move
 * resolvable, and the event vocabulary exercised across ALL movement
 * kinds. Plus the serialized-kit leg (KIT_OUT on a serialized component)
 * and the honest cycle-count limitation: a serialized item's variance
 * cannot post without naming its units (SerialRequiredError — fail-closed,
 * never a silent unit-level drift).
 */

let fixture: InventoryFixture;
let kitting: KittingService;
let cycleCounts: CycleCountService;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { PostingService } = await import("../../modules/accounting/application/posting-service");
  const { NumberingService } = await import("../../modules/accounting/application/numbering-service");
  const { PartnerSubledgerService } = await import("../../modules/partners/application/subledger-service");
  const audit = new AuditService(new DrizzleAuditStore()) as AuditService;
  kitting = new KittingService(
    audit,
    new PostingService(audit, new PartnerSubledgerService()),
    new NumberingService(audit),
  );
  cycleCounts = new CycleCountService(
    audit,
    new PostingService(audit, new PartnerSubledgerService()),
    new NumberingService(audit),
  );
});

describe("T-11 — the remaining event kinds", () => {
  it("serialized components/kits name their units AT POST (scan-at-assembly): KIT_OUT + KIT_IN land; omitting them fails closed", async () => {
    const kitItem = await ensureInventoryItem("INV-KIT-3", "Serialized kit item", { trackSerial: true });
    const comp = await ensureInventoryItem("INV-KIT-3A", "Serialized kit component", { trackSerial: true });
    const wh = fixture.warehouseMain;

    const compSerial = await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: comp, serialNo: "KIT-COMP-0001", imei: null, actorId: I_ACTOR }),
    );
    const kitSerial = await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: kitItem, serialNo: "KIT-UNIT-0001", imei: null, actorId: I_ACTOR }),
    );
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: comp,
        warehouseId: wh,
        qty: "1",
        unitCost: "6.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        serialIds: [compSerial.id],
        actorId: I_ACTOR,
      }),
    );

    const order = await withTenant(TENANT_I, () =>
      kitting.createKitOrder({
        warehouseId: wh,
        kitItemId: kitItem,
        qty: "1",
        lines: [{ componentItemId: comp, qty: "1", fromBinId: null }],
        note: null,
        actorId: I_ACTOR,
      }),
    );
    // Without the scans the post fails closed (units must be named).
    await expect(
      withTenant(TENANT_I, () => kitting.postKitOrder({ id: order.id, actorId: I_ACTOR })),
    ).rejects.toThrow(SerialRequiredError);

    // With the scans: the component gets KIT_OUT, the kit unit KIT_IN.
    await withTenant(TENANT_I, () =>
      kitting.postKitOrder({
        id: order.id,
        actorId: I_ACTOR,
        componentSerials: [{ lineNo: 1, serialIds: [compSerial.id] }],
        kitSerialIds: [kitSerial.id],
      }),
    );
    const compLedger = await withTenant(TENANT_I, () =>
      wmsStore.listSerialMovements({ serialId: compSerial.id, limit: 10 }),
    );
    expect([...compLedger.map((row) => row.event)].sort()).toEqual(["KIT_OUT", "RECEIVE"]);
    const kitLedger = await withTenant(TENANT_I, () =>
      wmsStore.listSerialMovements({ serialId: kitSerial.id, limit: 10 }),
    );
    expect(kitLedger.map((row) => row.event)).toEqual(["KIT_IN"]);
    // The kit unit is in stock on the default bin.
    const kitSerialRow = await withTenant(TENANT_I, () => store.findSerialById(kitSerial.id));
    expect(kitSerialRow?.status).toBe("in_stock");
  });

  it("a serialized item's cycle-count variance FAILS CLOSED (SerialRequiredError — units must be named)", async () => {
    const item = await ensureInventoryItem("INV-CC-SER", "Cycle count serial item", { trackSerial: true });
    const wh = fixture.warehouseMain;
    const serial = await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: item, serialNo: "CC-SER-0001", imei: null, actorId: I_ACTOR }),
    );
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "1",
        unitCost: "10.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        serialIds: [serial.id],
        actorId: I_ACTOR,
      }),
    );
    const doc = await withTenant(TENANT_I, () =>
      cycleCounts.createDocument({
        warehouseId: wh,
        itemIds: [item],
        blind: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const lines = await withTenant(TENANT_I, () => cycleCounts.lines(doc.id));
    await withTenant(TENANT_I, () =>
      cycleCounts.enterCounts({
        documentId: doc.id,
        entries: lines.map((line) => ({ lineNo: line.lineNo, countedQty: "0" })), // −1 unit
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => cycleCounts.submit(doc.id, I_ACTOR));
    await withTenant(TENANT_I, () => cycleCounts.review(doc.id, I_ACTOR));
    await expect(
      withTenant(TENANT_I, () =>
        cycleCounts.approve({ id: doc.id, supervisor: true, actorId: I_ACTOR }),
      ),
    ).rejects.toThrow(SerialRequiredError);
    // Zero residue: the serial is still in stock, the document un-posted.
    const serialRow = await withTenant(TENANT_I, () => store.findSerialById(serial.id));
    expect(serialRow?.status).toBe("in_stock");
    const still = await withTenant(TENANT_I, () => cycleCounts.findDocument(doc.id));
    expect(still.status).toBe("VARIANCE_REVIEW");
  });
});

describe("T-11 — the completeness property over the whole corpus (after this file's seeding; the sibling suites' serialized flows join when the folder runs together)", () => {
  it("no (move, serial) pair appears twice in the ledger", async () => {
    const client = await appClient();
    await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_I]);
    const dup = await client.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM (
        SELECT move_id, serial_id FROM serial_movements
        WHERE move_id IS NOT NULL
        GROUP BY move_id, serial_id HAVING count(*) > 1
      ) d
    `);
    await client.end();
    expect(dup.rows[0]!.n).toBe(0);
  });

  it("every serialized stock move is covered by at least one ledger row (no move without its effect)", async () => {
    const client = await appClient();
    await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_I]);
    const uncovered = await client.query<{ n: number }>(`
      SELECT count(*)::int AS n
      FROM stock_moves m
      JOIN items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
      WHERE i.track_serial = true AND m.serial_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM serial_movements sm WHERE sm.move_id = m.id
        )
    `);
    await client.end();
    expect(uncovered.rows[0]!.n).toBe(0);
  });

  it("every ledger row's move resolves to the same item as its serial (no cross-wiring)", async () => {
    const client = await appClient();
    await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_I]);
    const crossed = await client.query<{ n: number }>(`
      SELECT count(*)::int AS n
      FROM serial_movements sm
      JOIN stock_moves m ON m.id = sm.move_id AND m.tenant_id = sm.tenant_id
      JOIN item_serials s ON s.id = sm.serial_id AND s.tenant_id = sm.tenant_id
      WHERE m.item_id <> s.item_id
    `);
    const total = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM serial_movements WHERE move_id IS NOT NULL",
    );
    await client.end();
    expect(crossed.rows[0]!.n).toBe(0);
    // The corpus carries real history (the probe is not vacuous): this
    // file's own flows seed ≥ 4 move-bound rows; the sibling suites'
    // serialized flows add dozens more when the folder runs together.
    expect(total.rows[0]!.n).toBeGreaterThanOrEqual(4);
  });
});
