import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { WmsService } from "../../modules/inventory/application/wms.service";
import { QuarantineService } from "../../modules/inventory/application/quarantine-service";
import { BinContentStateError } from "../../modules/inventory/domain/inventory-errors";
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
 * Quarantine board suite (PHASE-044 T-08; §2.8, I-24): the G-43 policy
 * gate around every AVAILABLE ↔ QUARANTINE transition (off = the G-15
 * same-account mirror, NOTHING posts; distinct = DR 1290 · CR INVENTORY at
 * qty × avg cost, mirrored on release — fail-closed until 1290 maps), and
 * the three dispositions (RELEASE structural; SCRAP = the G-13 shrinkage
 * shape through the movement core with the SCRAP serial event; RTV = the
 * explicit-counter discipline). INV-029 holds at every disposition (the
 * directed take decrements the held row in the SAME transaction).
 */

let fixture: InventoryFixture;
let wms: WmsService;
let quarantine: QuarantineService;
let quarantineAccount = "";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { PostingService } = await import("../../modules/accounting/application/posting-service");
  const { PartnerSubledgerService } = await import("../../modules/partners/application/subledger-service");
  const { InboxService } = await import("../../modules/notifications/application/inbox-service");
  const audit = new AuditService(new DrizzleAuditStore()) as AuditService;
  wms = new WmsService(audit, new InboxService());
  quarantine = new QuarantineService(audit, new PostingService(audit, new PartnerSubledgerService()), wms);

  // Map 1290 QUARANTINE_INVENTORY for the tenant (the 0070 marker; the
  // fixture CoA provision creates the account, not the mapping).
  await withTenant(TENANT_I, async () => {
    const { findAccountByCode, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const { findActivePurpose } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    if ((await findActivePurpose("QUARANTINE_INVENTORY")) === undefined) {
      const account = await findAccountByCode("1290");
      if (account === undefined) throw new Error("fixture account 1290 missing");
      await insertAccountPurpose({
        purposeKey: "QUARANTINE_INVENTORY",
        accountId: account.id,
        activeFrom: "2025-12-01",
      });
    }
    const { findAccountByCode: find } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    quarantineAccount = (await find("1290"))!.id;
  });
});

/** Sets (then clears) the tenant policy — the budgeting-rules pattern. */
async function withPolicy(value: "off" | "distinct", fn: () => Promise<void>): Promise<void> {
  const { superuserClient } = await import("../test-db");
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
       (gen_random_uuid(), $1, 'inventory.quarantine_posting', $2::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_I, JSON.stringify(value)],
  );
  await su.end();
  try {
    await fn();
  } finally {
    const su2 = await superuserClient();
    await su2.query("DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'inventory.quarantine_posting'", [
      TENANT_I,
    ]);
    await su2.end();
  }
}

async function seedRow(sku: string, qty: string, unitCost: string): Promise<string> {
  const item = await ensureInventoryItem(sku, `${sku} quarantine item`);
  await withTenant(TENANT_I, () =>
    stock.manualReceipt({
      itemId: item,
      warehouseId: fixture.warehouseMain,
      qty,
      unitCost,
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: I_JAN,
      actorId: I_ACTOR,
    }),
  );
  const rows = await withTenant(TENANT_I, () =>
    wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId: item, limit: 5 }),
  );
  return rows[0]!.id;
}

describe("G-43 — the policy-gated quarantine leg (BR-077, the G-15 mirror)", () => {
  it("policy OFF: a transition posts NOTHING (the same-account default); the slot still moves", async () => {
    const contentId = await seedRow("INV-Q-OFF", "10", "2.000000");
    const itemId = await withTenant(TENANT_I, async () => (await wmsStore.findBinContentById(contentId))!.itemId);
    const before = await withTenant(TENANT_I, () => store.findItemStock(itemId, fixture.warehouseMain));

    const moved = await withTenant(TENANT_I, () =>
      quarantine.transition(contentId, "QUARANTINE", { note: "QC hold", actorId: I_ACTOR }),
    );
    expect(moved.content.status).toBe("QUARANTINE");
    expect(moved.journalEntryId).toBeNull();

    // The G-15 mirror: no journal exists for the transition.
    const entry = await withTenant(TENANT_I, () =>
      journal.findEntryBySourceKey("bin_content", contentId, "quarantine"),
    );
    expect(entry).toBeUndefined();
    // The valuation is byte-identical; the fold spans statuses.
    const after = await withTenant(TENANT_I, () => store.findItemStock(itemId, fixture.warehouseMain));
    expect(after?.qty).toBe(before?.qty);
    expect(after?.avgCost).toBe(before?.avgCost);
  });

  it("policy DISTINCT: quarantine posts DR 1290 · CR INVENTORY at qty × avg cost; release mirrors it", async () => {
    const contentId = await seedRow("INV-Q-DST", "8", "5.000000");
    const itemId = await withTenant(TENANT_I, async () => (await wmsStore.findBinContentById(contentId))!.itemId);

    await withPolicy("distinct", async () => {
      await withTenant(TENANT_I, () =>
        quarantine.transition(contentId, "QUARANTINE", { note: "QC hold", actorId: I_ACTOR }),
      );
      const entry = await withTenant(TENANT_I, () =>
        journal.findEntryBySourceKey("bin_content", contentId, "quarantine"),
      );
      expect(entry).toBeTruthy();
      const lines = await withTenant(TENANT_I, () => journal.listLines(entry!.id));
      // 8 × 5.00 = 40.0000 both sides.
      const debit = lines.find((l) => l.direction === "DEBIT");
      const credit = lines.find((l) => l.direction === "CREDIT");
      expect(debit?.accountId).toBe(quarantineAccount);
      expect(debit?.amount).toBe("40.0000");
      expect(credit?.accountId).toBe(fixture.glInventory);
      expect(credit?.amount).toBe("40.0000");

      // The release mirrors the leg.
      const target = await withTenant(TENANT_I, () =>
        wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId, status: "QUARANTINE", limit: 5 }),
      );
      const releaseRow = target[0]!;
      await withTenant(TENANT_I, () =>
        quarantine.transition(releaseRow.id, "AVAILABLE", { note: "QC pass", actorId: I_ACTOR }),
      );
      const releaseEntry = await withTenant(TENANT_I, () =>
        journal.findEntryBySourceKey("bin_content", releaseRow.id, "release"),
      );
      expect(releaseEntry).toBeTruthy();
      const releaseLines = await withTenant(TENANT_I, () => journal.listLines(releaseEntry!.id));
      const rDebit = releaseLines.find((l) => l.direction === "DEBIT");
      const rCredit = releaseLines.find((l) => l.direction === "CREDIT");
      expect(rDebit?.accountId).toBe(fixture.glInventory);
      expect(rCredit?.accountId).toBe(quarantineAccount);
      expect(rDebit?.amount).toBe("40.0000");
    });
  });

  it("policy DISTINCT, 1290 UNMAPPED: the transition fails closed (typed) with ZERO residue", async () => {
    const contentId = await seedRow("INV-Q-FC", "6", "1.000000");
    // Temporarily deactivate the mapping (the pre-mapping tenant state) —
    // raw SQL on the fixture superuser (no service API deactivates).
    const { superuserClient } = await import("../test-db");
    const su = await superuserClient();
    await su.query(
      `UPDATE account_purposes SET active_to = now()
       WHERE tenant_id = $1 AND purpose_key = 'QUARANTINE_INVENTORY' AND active_to IS NULL`,
      [TENANT_I],
    );
    await su.end();
    try {
      await withPolicy("distinct", async () => {
        await expect(
          withTenant(TENANT_I, () =>
            quarantine.transition(contentId, "QUARANTINE", { note: "should fail", actorId: I_ACTOR }),
          ),
        ).rejects.toThrow(/PURPOSE_NOT_MAPPED|no active account mapping/i);
        // ZERO residue: the row is still AVAILABLE (the whole UoW rolled back).
        const row = await withTenant(TENANT_I, () => wmsStore.findBinContentById(contentId));
        expect(row!.status).toBe("AVAILABLE");
      });
    } finally {
      await withTenant(TENANT_I, async () => {
        const { insertAccountPurpose, findAccountByCode, findActivePurpose } = await import(
          "../../modules/tenancy/infrastructure/tenancy.store"
        );
        if ((await findActivePurpose("QUARANTINE_INVENTORY")) === undefined) {
          const account = await findAccountByCode("1290");
          await insertAccountPurpose({
            purposeKey: "QUARANTINE_INVENTORY",
            accountId: account!.id,
            activeFrom: "2025-12-01",
          });
        }
      });
    }
  });

  it("HOLD never posts — even under DISTINCT (a legal hold, not a valuation state)", async () => {
    const contentId = await seedRow("INV-Q-HOLD", "4", "3.000000");
    await withPolicy("distinct", async () => {
      await withTenant(TENANT_I, () =>
        quarantine.transition(contentId, "HOLD", { note: "legal hold", actorId: I_ACTOR }),
      );
      const entry = await withTenant(TENANT_I, () =>
        journal.findEntryBySourceKey("bin_content", contentId, "quarantine"),
      );
      expect(entry).toBeUndefined();
      // The source row drained to 0 (the history floor keeps its status);
      // the held qty lives on the TARGET row (a new slot id).
      const source = await withTenant(TENANT_I, () => wmsStore.findBinContentById(contentId));
      expect(Number(source!.qty)).toBe(0);
      const itemId = await withTenant(TENANT_I, async () => (await wmsStore.findBinContentById(contentId))!.itemId);
      const held = await withTenant(TENANT_I, () =>
        wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId, status: "HOLD", limit: 5 }),
      );
      expect(held).toHaveLength(1);
      expect(Number(held[0]!.qty)).toBe(4);
    });
  });
});

describe("§2.8 — the dispositions", () => {
  it("SCRAP: the G-13 shrinkage shape through the movement core; the held row decrements in the SAME transaction; the serial ledger gets SCRAP", async () => {
    const item = await ensureInventoryItem("INV-Q-SCRAP", "Quarantine scrap item", { trackSerial: false });
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        qty: "12",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId: item, limit: 5 }),
    );
    const contentId = rows[0]!.id;
    await withTenant(TENANT_I, () =>
      wms.transitionStatus(contentId, "QUARANTINE", { note: "QC hold", actorId: I_ACTOR }),
    );
    const held = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId: item, status: "QUARANTINE", limit: 5 }),
    );

    const result = await withTenant(TENANT_I, () =>
      quarantine.dispose({
        contentId: held[0]!.id,
        disposition: "SCRAP",
        note: "damaged beyond repair",
        counterAccountId: null,
        actorId: I_ACTOR,
      }),
    );
    expect(result.valueAmount).toBe("48.0000");
    const lines = await withTenant(TENANT_I, () => journal.listLines(result.journalEntryId!));
    const debit = lines.find((l) => l.direction === "DEBIT");
    const credit = lines.find((l) => l.direction === "CREDIT");
    expect(debit?.accountId).toBe(fixture.glShrinkage);
    expect(credit?.accountId).toBe(fixture.glInventory);
    expect(debit?.amount).toBe("48.0000");

    // The move: reason SCRAP, source quarantine_disposition.
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "quarantine_disposition", itemId: item, limit: 5 }),
    );
    expect(moves[0]?.reason).toBe("SCRAP");
    expect(moves[0]?.qty).toBe("12.000000");

    // INV-029: bins = stock = 0.
    const binRows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId: item, limit: 10 }),
    );
    const binTotal = binRows
      .filter((r) => r.ownerPartnerId === null)
      .reduce((sum, r) => sum + Number(r.qty), 0);
    const stockRow = await withTenant(TENANT_I, () => store.findItemStock(item, fixture.warehouseMain));
    expect(binTotal).toBeCloseTo(0, 6);
    expect(Number(stockRow?.qty)).toBeCloseTo(0, 6);
  });

  it("SCRAP of a serialized unit appends exactly ONE serial_movements row with event SCRAP", async () => {
    const item = await ensureInventoryItem("INV-Q-SER", "Quarantine serialized item", { trackSerial: true });
    const { tracking } = await import("./fixtures");
    const serial = await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: item, serialNo: "QSCRAP-0001", imei: null, actorId: I_ACTOR }),
    );
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        qty: "1",
        unitCost: "9.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        serialIds: [serial.id],
        actorId: I_ACTOR,
      }),
    );
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId: item, limit: 5 }),
    );
    await withTenant(TENANT_I, () =>
      wms.transitionStatus(rows[0]!.id, "QUARANTINE", { note: "QC hold", actorId: I_ACTOR }),
    );
    const held = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId: item, status: "QUARANTINE", limit: 5 }),
    );

    await withTenant(TENANT_I, () =>
      quarantine.dispose({
        contentId: held[0]!.id,
        disposition: "SCRAP",
        note: "DOA unit",
        counterAccountId: null,
        actorId: I_ACTOR,
      }),
    );

    const ledger = await withTenant(TENANT_I, () => wmsStore.listSerialMovements({ serialId: serial.id, limit: 10 }));
    // Exactly one row per movement — the T-11 law (RECEIVE, QUARANTINE,
    // SCRAP; the same-day ordering between the transition stamp and the
    // date-only disposition stamp is not semantically meaningful).
    expect([...ledger.map((row) => row.event)].sort()).toEqual(["QUARANTINE", "RECEIVE", "SCRAP"]);
    expect(ledger).toHaveLength(3);
  });

  it("RETURN_TO_VENDOR requires the explicit counter account; with it the leg posts DR counter · CR INVENTORY", async () => {
    const contentId = await seedRow("INV-Q-RTV", "5", "6.000000");
    await withTenant(TENANT_I, () =>
      wms.transitionStatus(contentId, "QUARANTINE", { note: "QC hold", actorId: I_ACTOR }),
    );
    const held = await withTenant(TENANT_I, async () =>
      wmsStore.listBinContents({
        warehouseId: fixture.warehouseMain,
        itemId: (await wmsStore.findBinContentById(contentId))!.itemId,
        status: "QUARANTINE",
        limit: 5,
      }),
    );

    // The typed rejection without the counter account.
    await expect(
      withTenant(TENANT_I, () =>
        quarantine.dispose({
          contentId: held[0]!.id,
          disposition: "RETURN_TO_VENDOR",
          note: null,
          counterAccountId: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(BinContentStateError);

    const result = await withTenant(TENANT_I, () =>
      quarantine.dispose({
        contentId: held[0]!.id,
        disposition: "RETURN_TO_VENDOR",
        note: "back to the supplier",
        counterAccountId: fixture.glCogs,
        actorId: I_ACTOR,
      }),
    );
    expect(result.valueAmount).toBe("30.0000");
    const lines = await withTenant(TENANT_I, () => journal.listLines(result.journalEntryId!));
    const debit = lines.find((l) => l.direction === "DEBIT");
    const credit = lines.find((l) => l.direction === "CREDIT");
    expect(debit?.accountId).toBe(fixture.glCogs);
    expect(credit?.accountId).toBe(fixture.glInventory);
    // The move carries the RETURN_TO_VENDOR reason.
    const itemId = await withTenant(TENANT_I, async () => (await wmsStore.findBinContentById(contentId))!.itemId);
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "quarantine_disposition", itemId, limit: 5 }),
    );
    expect(moves[0]?.reason).toBe("RETURN_TO_VENDOR");
  });

  it("a disposition over an AVAILABLE row is the typed rejection (the board owns held rows only)", async () => {
    const contentId = await seedRow("INV-Q-AVAIL", "3", "1.000000");
    await expect(
      withTenant(TENANT_I, () =>
        quarantine.dispose({
          contentId,
          disposition: "SCRAP",
          note: null,
          counterAccountId: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(/dispositions act on held rows/);
  });

  it("the board lists the held rows (QUARANTINE by default, HOLD on request)", async () => {
    const contentId = await seedRow("INV-Q-BOARD", "7", "1.000000");
    const itemId = await withTenant(TENANT_I, async () => (await wmsStore.findBinContentById(contentId))!.itemId);
    await withTenant(TENANT_I, () =>
      wms.transitionStatus(contentId, "HOLD", { note: "legal hold", actorId: I_ACTOR }),
    );
    const board = await withTenant(TENANT_I, () => quarantine.board({ warehouseId: fixture.warehouseMain }));
    expect(board.some((row) => row.itemId === itemId)).toBe(false); // HOLD ≠ QUARANTINE default
    const holdBoard = await withTenant(TENANT_I, () =>
      quarantine.board({ status: "HOLD", warehouseId: fixture.warehouseMain }),
    );
    expect(holdBoard.some((row) => row.itemId === itemId && Number(row.qty) === 7)).toBe(true);
  });
});
