import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import {
  FakeCommerceChannel,
  FakeShippingProvider,
  importChannelOrders,
  listChannelOrders,
  resolveConflict,
  type ChannelOrder,
} from "../../modules/sales/adapters/commerce/commerce-port";
import { setupPackTenant, X_ACTOR, type PackTenant } from "../tax/fixtures";

/**
 * PHASE-023 T8 verification (phase §6): the CommerceChannelPort contract
 * against the fake channel — order import is UPSERT-BY-NATURAL-KEY
 * (channel order id); the Idempotency-Key per batch replays the recorded
 * outcome without re-pulling; financial-field drift flags CONFLICT with
 * the server-decision resolution (KEEP_EXISTING / TAKE_INCOMING /
 * REJECT_BOTH — never last-write-wins, ADR-0012); the ShippingPort fake
 * reserves the boundary.
 */

let tenant: PackTenant;
const channel = new FakeCommerceChannel();

function order(id: string, total: string, qty = 2): ChannelOrder {
  return {
    channelOrderId: id,
    orderDate: "2026-11-06",
    currencyCode: "SAR",
    total,
    items: [{ sku: "SKU-1", qty, unitPrice: (Number(total) / qty).toFixed(2) }],
    customerName: "عميل القناة",
  };
}

beforeAll(async () => {
  tenant = await setupPackTenant("SA");
});

describe("import — upsert by natural key", () => {
  it("imports new orders and skips unchanged re-imports", async () => {
    channel.enqueueBatch([order("CH-1001", "100.00"), order("CH-1002", "250.50")]);
    const first = await withTenant(tenant.tenantId, () =>
      importChannelOrders({ channel, batchKey: "batch-alpha-1", actorId: X_ACTOR }),
    );
    expect(first.imported).toBe(2);
    expect(first.idempotentReplay).toBe(false);
    // Re-import the SAME orders (new batch key): unchanged financials → skipped.
    channel.enqueueBatch([order("CH-1001", "100.00"), order("CH-1002", "250.50")]);
    const second = await withTenant(tenant.tenantId, () =>
      importChannelOrders({ channel, batchKey: "batch-alpha-2", actorId: X_ACTOR }),
    );
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it("duplicate batch key replays the RECORDED outcome (no re-pull)", async () => {
    channel.enqueueBatch([order("CH-2001", "90.00")]);
    const first = await withTenant(tenant.tenantId, () =>
      importChannelOrders({ channel, batchKey: "batch-beta-1", actorId: X_ACTOR }),
    );
    expect(first.imported).toBe(1);
    const replay = await withTenant(tenant.tenantId, () =>
      importChannelOrders({ channel, batchKey: "batch-beta-1", actorId: X_ACTOR }),
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.imported).toBe(first.imported);
  });
});

describe("conflict policy — server-decision, never LWW (ADR-0012)", () => {
  it("financial drift flags CONFLICT and resolution is an explicit decision", async () => {
    channel.enqueueBatch([order("CH-3001", "500.00")]);
    await withTenant(tenant.tenantId, () =>
      importChannelOrders({ channel, batchKey: "batch-gamma-1", actorId: X_ACTOR }),
    );
    // Re-import with a CHANGED total → conflict.
    channel.enqueueBatch([order("CH-3001", "700.00")]);
    const drift = await withTenant(tenant.tenantId, () =>
      importChannelOrders({ channel, batchKey: "batch-gamma-2", actorId: X_ACTOR }),
    );
    expect(drift.conflicts).toBe(1);
    const conflicts = await withTenant(tenant.tenantId, () =>
      listChannelOrders({ status: "CONFLICT" }),
    );
    const row = conflicts.find((entry) => entry.channelOrderId === "CH-3001");
    expect(row).toBeDefined();
    // TAKE_INCOMING: the human decision applies the incoming payload.
    await withTenant(tenant.tenantId, () =>
      resolveConflict({ channelOrderId: row!.id, resolution: "TAKE_INCOMING", actorId: X_ACTOR }),
    );
    const after = await withTenant(tenant.tenantId, () => listChannelOrders({}));
    const resolved = after.find((entry) => entry.channelOrderId === "CH-3001");
    expect(resolved?.status).toBe("RESOLVED");
    // An unresolved conflict swallows re-imports as conflict signals.
    channel.enqueueBatch([order("CH-3001", "900.00")]);
    const again = await withTenant(tenant.tenantId, () =>
      importChannelOrders({ channel, batchKey: "batch-gamma-3", actorId: X_ACTOR }),
    );
    expect(again.imported).toBe(0);
    expect(again.conflicts + again.skipped).toBe(1);
  });
});

describe("push surfaces (price/stock)", () => {
  it("pushPrice/pushStock reach the channel and return acceptance counts", async () => {
    const price = await channel.pushPrice([{ sku: "SKU-1", price: "55.00", currencyCode: "SAR" }]);
    expect(price.accepted).toBe(1);
    const stock = await channel.pushStock([{ sku: "SKU-1", qty: 12 }]);
    expect(stock.accepted).toBe(1);
    expect(channel.pricePushCount).toBe(1);
    expect(channel.stockPushCount).toBe(1);
  });
});

describe("ShippingPort — reserved with a fake only (post-MVP)", () => {
  it("the fake quotes a deterministic FAKE rate (no real tariff)", async () => {
    const shipping = new FakeShippingProvider();
    const quote = await shipping.quote({ weightGrams: 1000, destinationCountry: "SA", currencyCode: "SAR" });
    expect(quote.serviceName).toBe("FAKE-STANDARD");
    expect(quote.amount).toBe("11.00"); // 10 + 1000×0.001 — the documented fake
  });
});
