import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import * as policies from "../../modules/inventory/infrastructure/policies.store";
import { AlertsService } from "../../modules/inventory/application/alerts-service";
import { TransferService } from "../../modules/inventory/application/transfer-service";
import { StockTransferPricingStateError } from "../../modules/inventory/domain/inventory-errors";
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
 * Alerts + transit exceptions + transfer pricing suite (PHASE-044 T-12;
 * §2.13, I-17/I-21/I-22/I-23/I-25): the two daily probes (shelf-life over
 * on-hand batches; slow-movement over stocked items with no outbound in
 * the window), the I-22 damaged/missing legs (the G-13 shrinkage shape at
 * the carried cost restoring INV-010 for the value that never arrived),
 * and G-46's valuation difference (the policy-priced receipt with the
 * margin leg DR dest INVENTORY · CR 4990 TRANSFER_PRICING_ADJUSTMENT).
 */

let fixture: InventoryFixture;
let alerts: AlertsService;
let transfers: TransferService;
let transferPricingAccount = "";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { PostingService } = await import("../../modules/accounting/application/posting-service");
  const { NumberingService } = await import("../../modules/accounting/application/numbering-service");
  const { PartnerSubledgerService } = await import("../../modules/partners/application/subledger-service");
  const { InboxService } = await import("../../modules/notifications/application/inbox-service");
  const audit = new AuditService(new DrizzleAuditStore()) as AuditService;
  const posting = new PostingService(audit, new PartnerSubledgerService());
  alerts = new AlertsService(audit, new InboxService());
  transfers = new TransferService(audit, posting, new NumberingService(audit));

  await withTenant(TENANT_I, async () => {
    const { findAccountByCode, findActivePurpose, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    if ((await findActivePurpose("TRANSFER_PRICING_ADJUSTMENT")) === undefined) {
      const account = await findAccountByCode("4990");
      if (account === undefined) throw new Error("fixture account 4990 missing");
      await insertAccountPurpose({
        purposeKey: "TRANSFER_PRICING_ADJUSTMENT",
        accountId: account.id,
        activeFrom: "2025-12-01",
      });
    }
    transferPricingAccount = (await findAccountByCode("4990"))!.id;
  });
});

describe("I-17/I-21 — the alert probes", () => {
  it("the shelf-life probe flags expiring on-hand batches and stamps the run; an inactive job skips", async () => {
    // A batch expiring soon with on-hand: received today, expiry in 5 days.
    const item = await ensureInventoryItem("INV-ALERT-1", "Shelf-life alert item", {
      trackBatch: true,
      hasExpiry: true,
    });
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        batchNo: "ALERT-EXP-2026",
        batchExpiry: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
        actorId: I_ACTOR,
      }),
    );
    // Register the job row first (absent = the fail-closed default run,
    // but the stamp lands only on a registered row).
    await withTenant(TENANT_I, () =>
      alerts.upsertJob({
        jobKind: "SHELF_LIFE",
        shelfLifeDays: 14,
        slowMovementDays: 90,
        isActive: true,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const run = await withTenant(TENANT_I, () => alerts.runShelfLifeAlerts());
    expect(run.tenants).toBeGreaterThanOrEqual(1);
    expect(run.flagged).toBeGreaterThanOrEqual(1);
    const job = await withTenant(TENANT_I, () => policies.findAlertJob("SHELF_LIFE"));
    expect(job?.lastFlagged).toBeGreaterThanOrEqual(1);
    expect(job?.lastRunAt).toBeTruthy();

    // Inactive: the probe skips the tenant's stock (0 flagged for it).
    await withTenant(TENANT_I, () =>
      alerts.upsertJob({
        jobKind: "SHELF_LIFE",
        shelfLifeDays: 14,
        slowMovementDays: 90,
        isActive: false,
        note: "paused",
        actorId: I_ACTOR,
      }),
    );
    const skipped = await withTenant(TENANT_I, () => alerts.runShelfLifeAlerts());
    expect(skipped.flagged).toBe(0);
    await withTenant(TENANT_I, () =>
      alerts.upsertJob({
        jobKind: "SHELF_LIFE",
        shelfLifeDays: 14,
        slowMovementDays: 90,
        isActive: true,
        note: null,
        actorId: I_ACTOR,
      }),
    );
  });

  it("the slow-movement probe flags stocked items with no outbound in the window", async () => {
    // A never-issued stocked item (the INV-ALERT-2 receipt above suffices).
    const item = await ensureInventoryItem("INV-ALERT-2", "Slow movement item");
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        qty: "4",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () =>
      alerts.upsertJob({
        jobKind: "SLOW_MOVEMENT",
        shelfLifeDays: 14,
        slowMovementDays: 90,
        isActive: true,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const run = await withTenant(TENANT_I, () => alerts.runSlowMovementAlerts());
    expect(run.flagged).toBeGreaterThanOrEqual(1);
    const job = await withTenant(TENANT_I, () => policies.findAlertJob("SLOW_MOVEMENT"));
    expect(job?.lastFlagged).toBeGreaterThanOrEqual(1);
  });
});

describe("I-22 — transit exceptions at receive (the G-13 shrinkage shape)", () => {
  it("DAMAGE + MISSING reduce the received qty and post the shrinkage legs at the carried cost", async () => {
    const item = await ensureInventoryItem("INV-TRN-1", "Transit exception item");
    const from = fixture.warehouseMain;
    const to = fixture.warehouseSecond;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: from,
        qty: "20",
        unitCost: "5.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    const transfer = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: from,
        toWarehouseId: to,
        lines: [{ itemId: item, qty: "20" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => transfers.dispatch(transfer.id, I_ACTOR));

    const received = await withTenant(TENANT_I, () =>
      transfers.receive(transfer.id, I_ACTOR, [
        { lineNo: 1, exceptionKind: "DAMAGE", qty: "3", note: "crushed pallet" },
        { lineNo: 1, exceptionKind: "MISSING", qty: "2", note: "never arrived" },
      ]),
    );
    expect(received.status).toBe("POSTED");

    // The dest received 15 (20 − 3 − 2) at the carried cost 5.
    const destStock = await withTenant(TENANT_I, () => store.findItemStock(item, to));
    expect(Number(destStock?.qty)).toBe(15);

    // Two exception rows with their journals (each leg: DR shrinkage · CR
    // dest inventory at carried cost — 3×5 = 15 and 2×5 = 10).
    const exceptions = await withTenant(TENANT_I, () => transfers.transitExceptions(transfer.id));
    expect(exceptions).toHaveLength(2);
    expect(exceptions.every((row) => row.journalId !== null && row.resolvedAt !== null)).toBe(true);
    for (const row of exceptions) {
      const lines = await withTenant(TENANT_I, () => journal.listLines(row.journalId!));
      const debit = lines.find((l) => l.direction === "DEBIT");
      const credit = lines.find((l) => l.direction === "CREDIT");
      expect(debit?.accountId).toBe(fixture.glShrinkage);
      expect(credit?.accountId).toBe(fixture.glInventorySecond);
      expect(debit?.amount).toBe(row.exceptionKind === "DAMAGE" ? "15.0000" : "10.0000");
    }

    // Exceptions over the line qty are the typed rejection with zero
    // residue (a fresh transfer).
    const item2 = await ensureInventoryItem("INV-TRN-2", "Transit over item");
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item2,
        warehouseId: from,
        qty: "5",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    const transfer2 = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: from,
        toWarehouseId: to,
        lines: [{ itemId: item2, qty: "5" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => transfers.dispatch(transfer2.id, I_ACTOR));
    await expect(
      withTenant(TENANT_I, () =>
        transfers.receive(transfer2.id, I_ACTOR, [
          { lineNo: 1, exceptionKind: "MISSING", qty: "6", note: null },
        ]),
      ),
    ).rejects.toThrow(/exceed the line qty/);
    const still = await withTenant(TENANT_I, () => transfers.find(transfer2.id));
    expect(still.status).toBe("IN_TRANSIT");
    const none = await withTenant(TENANT_I, () => transfers.transitExceptions(transfer2.id));
    expect(none).toHaveLength(0);
    // Clean up: receive it fully so later suites see a settled ledger.
    await withTenant(TENANT_I, () => transfers.receive(transfer2.id, I_ACTOR, []));
  });
});

describe("I-23/G-46 — the transfer-pricing policy", () => {
  it("MARKUP prices the receipt and posts the margin leg DR dest · CR 4990; the operand discipline is enforced", async () => {
    const item = await ensureInventoryItem("INV-TRN-3", "Transfer pricing item");
    const from = fixture.warehouseMain;
    const to = fixture.warehouseSecond;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: from,
        qty: "10",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    // The operand discipline.
    await expect(
      withTenant(TENANT_I, () =>
        transfers.upsertPricingPolicy({
          fromWarehouseId: from,
          toWarehouseId: to,
          mode: "MARKUP",
          markupPct: "10",
          fixedPrice: "1.000000",
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(StockTransferPricingStateError);

    await withTenant(TENANT_I, () =>
      transfers.upsertPricingPolicy({
        fromWarehouseId: from,
        toWarehouseId: to,
        mode: "MARKUP",
        markupPct: "25",
        fixedPrice: null,
        note: "branch transfer margin",
        actorId: I_ACTOR,
      }),
    );

    const transfer = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: from,
        toWarehouseId: to,
        lines: [{ itemId: item, qty: "10" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => transfers.dispatch(transfer.id, I_ACTOR));
    await withTenant(TENANT_I, () => transfers.receive(transfer.id, I_ACTOR, []));

    // The dest stock carries the POLICY price: 4 × 1.25 = 5.000000.
    const destStock = await withTenant(TENANT_I, () => store.findItemStock(item, to));
    expect(destStock?.qty).toBe("10.000000");
    expect(destStock?.avgCost).toBe("5.000000");

    // G-46: the margin leg (10 × (5 − 4) = 10.0000) — DR dest INVENTORY ·
    // CR 4990 TRANSFER_PRICING_ADJUSTMENT.
    const entries = await withTenant(TENANT_I, () =>
      journal.findEntryBySourceKey("stock_transfer", transfer.id, "pricing_line_1"),
    );
    expect(entries).toBeTruthy();
    const lines = await withTenant(TENANT_I, () => journal.listLines(entries!.id));
    const debit = lines.find((l) => l.direction === "DEBIT");
    const credit = lines.find((l) => l.direction === "CREDIT");
    expect(debit?.accountId).toBe(fixture.glInventorySecond);
    expect(debit?.amount).toBe("10.0000");
    expect(credit?.accountId).toBe(transferPricingAccount);
    expect(credit?.amount).toBe("10.0000");

    // INV-029 held on both warehouses.
    for (const wh of [from, to]) {
      const rows = await withTenant(TENANT_I, () =>
        wmsStore.listBinContents({ warehouseId: wh, itemId: item, limit: 10 }),
      );
      const binTotal = rows
        .filter((r) => r.ownerPartnerId === null)
        .reduce((sum, r) => sum + Number(r.qty), 0);
      const stockRow = await withTenant(TENANT_I, () => store.findItemStock(item, wh));
      expect(binTotal).toBeCloseTo(Number(stockRow?.qty ?? 0), 6);
    }

    // Clear the policy (later suites' transfers carry the plain cost).
    await withTenant(TENANT_I, async () => {
      const { superuserClient } = await import("../test-db");
      const su = await superuserClient();
      await su.query("DELETE FROM transfer_pricing_policies WHERE tenant_id = $1", [TENANT_I]);
      await su.end();
    });
  });
});
