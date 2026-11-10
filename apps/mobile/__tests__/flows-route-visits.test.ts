/**
 * PHASE-022 T-P22-2-e · the route-visit view-model suite (MASTER-PLAN §8 —
 * the Journey G2/G3 surface: today's visits, per-customer tier pricing +
 * balances from cache, visit completion state) over a REAL field store.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openFieldStore, type MobileStore } from "../src/store";
import {
  buildRouteVisitDays,
  isVisitSkipped,
  markVisitSkipped,
  unmarkVisitSkipped,
  visitActionContext,
  weekdayKey,
} from "../src/fieldsales/route-visits";
import { addItemToCart, emptyVanSaleCart, saveVanSale, setCartCustomer, setCartPayment } from "../src/fieldsales/van-sale";
import { saveFieldCollection } from "../src/fieldsales/collection";
import type { FieldFlowContext } from "../src/fieldsales/state-machine";

const DEVICE_ID = "2e2e2e2e-0000-4111-8111-2e2e2e2e2e2e";
const VAN_WH = "2e2e2e2e-1111-4111-8111-2e2e2e2e2e11";
const REP_ID = "2e2e2e2e-rep0-4111-8111-2e2e2e2e2ere";
const ROUTE_SUN = "2e2e2e2e-rt01-4111-8111-2e2e2e2e2er1";
const ROUTE_DAILY = "2e2e2e2e-rt02-4111-8111-2e2e2e2e2er2";
const PARTNER_A = "2e2e2e2e-6666-4111-8111-2e2e2e2e2e66";
const PARTNER_B = "2e2e2e2e-7777-4111-8111-2e2e2e2e2e77";
const PARTNER_C = "2e2e2e2e-8888-4111-8111-2e2e2e2e2e88";
const PARTNER_NO_ROUTE = "2e2e2e2e-9999-4111-8111-2e2e2e2e2e99";
const PRICE_LIST = "2e2e2e2e-pl01-4111-8111-2e2e2e2e2e01";
const ITEM_A = "2e2e2e2e-2222-4111-8111-2e2e2e2e2e22";
const CTX: FieldFlowContext = {
  deviceId: DEVICE_ID,
  deviceCode: "F01",
  vanWarehouseId: VAN_WH,
  cashAccountId: "2e2e2e2e-9999-4111-8111-2e2e2e2e2e9a",
  currencyCode: "SAR",
  today: "2026-11-18",
};

let dir: string;
let store: MobileStore;

function sequencedUuid(prefix: string): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    return `${prefix}0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "p22-2e-routes-"));
  store = openFieldStore(join(dir, "field.db"));

  // Items + barcodes (the sell-here substrate).
  store.run(
    `INSERT INTO items (id, sku, name, name_ar, kind, uom_id, category_id, tax_code_id, base_price,
                         track_batch, track_serial, track_imei, status, updated_at, dirty)
     VALUES (?, 'SKU-A', 'مياه 600مل', NULL, 'STOCK', NULL, NULL, NULL, '2.5000', 0, 0, 0, 'ACTIVE', '2026-11-17T10:00:00Z', 0)`,
    [ITEM_A],
  );
  store.run("INSERT INTO barcodes (id, code, item_id, uom_id, updated_at) VALUES (?, '6291000000011', ?, NULL, '2026-11-17T10:00:00Z')", [
    "2e2e2e2e-beef-4111-8111-2e2e2e2e2eef",
    ITEM_A,
  ]);

  // Partners: A (tier-priced, balanced), B (no price list, balanced), C (no statement).
  for (const [id, code, name, priceList] of [
    [PARTNER_A, "C-001", "عميل الطريق الأول", PRICE_LIST],
    [PARTNER_B, "C-002", "عميل بدون فئة", null],
    [PARTNER_C, "C-003", "عميل بلا كشف", null],
    [PARTNER_NO_ROUTE, "C-004", "عميل خارج الخط", null],
  ] as const) {
    store.run(
      `INSERT INTO partners (id, code, name, name_ar, kind, status, credit_limit, price_list_id, tax_number, updated_at)
       VALUES (?, ?, ?, NULL, 'CUSTOMER', 'ACTIVE', '100.0000', ?, NULL, '2026-11-17T10:00:00Z')`,
      [id, code, name, priceList],
    );
  }
  store.run(
    "INSERT INTO price_list_items (id, price_list_id, item_id, uom_id, unit_price, min_qty, updated_at) VALUES (?, ?, ?, NULL, '2.0000', '0', '2026-11-17T10:00:00Z')",
    ["2e2e2e2e-pli1-4111-8111-2e2e2e2e2ep1", PRICE_LIST, ITEM_A],
  );

  // Statements for A (one open invoice) + B (fully settled).
  const seedStatement = (partnerId: string, name: string, closing: string, entries: unknown): void => {
    store.run(
      `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
          opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload, version, updated_at, dirty)
       VALUES (?, 'C-x', ?, NULL, '2026-11-16', 'SAR', ?, ?, ?, '{}', ?, '2026-11-17T09:00:00Z', '{}', NULL, '2026-11-17T09:00:00Z', 0)`,
      [partnerId, name, closing, closing, closing, JSON.stringify(entries)],
    );
  };
  seedStatement(PARTNER_A, "عميل الطريق الأول", "150.0000", [
    { entryDate: "2026-11-01", docRef: "INV-2026-0007", sourceType: "sales_invoice", currencyCode: "SAR", debit: "150.0000", credit: "0.0000", balance: "150.0000", outstanding: "150.0000" },
  ]);
  seedStatement(PARTNER_B, "عميل بدون فئة", "0.0000", [
    { entryDate: "2026-10-01", docRef: "INV-2026-0001", sourceType: "sales_invoice", currencyCode: "SAR", debit: "100.0000", credit: "0.0000", balance: "0.0000", outstanding: "0.0000" },
  ]);

  // Routes: 2026-11-18 is a WEDNESDAY — ROUTE_SUN's plan ["SUN","WED"]
  // includes it; the daily route carries every day.
  store.run(
    `INSERT INTO routes (id, code, name, name_ar, sales_rep_id, van_warehouse_id, day_pattern, status, customers, payload, version, updated_at, dirty)
     VALUES (?, 'R-01', 'خط الشمال', NULL, ?, ?, ?, 'ACTIVE', ?, '{}', 2, '2026-11-17T10:00:00Z', 0)`,
    [
      ROUTE_SUN,
      REP_ID,
      VAN_WH,
      JSON.stringify(["SUN", "WED"]),
      JSON.stringify([
        { partnerId: PARTNER_B, visitOrder: 2, isPinned: false },
        { partnerId: PARTNER_A, visitOrder: 1, isPinned: true },
      ]),
    ],
  );
  store.run(
    `INSERT INTO routes (id, code, name, name_ar, sales_rep_id, van_warehouse_id, day_pattern, status, customers, payload, version, updated_at, dirty)
     VALUES (?, 'R-02', 'خط يومي', NULL, NULL, NULL, ?, 'ACTIVE', ?, '{}', 1, '2026-11-17T10:00:00Z', 0)`,
    [ROUTE_DAILY, JSON.stringify(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]), JSON.stringify([{ partnerId: PARTNER_C, visitOrder: 1, isPinned: false }])],
  );
});

afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("PHASE-022 2-e · the route-visit view-model (Journey G2/G3)", () => {
  it("derives the weekday key of an ISO date (pure, both directions)", () => {
    expect(weekdayKey("2026-11-18")).toBe("WED"); // the plan date
    expect(weekdayKey("2026-11-15")).toBe("SUN");
    expect(weekdayKey("junk")).toBeNull();
  });

  it("lists today's routes only (the dayPattern filter) and orders customers by visitOrder", () => {
    const days = buildRouteVisitDays(store, { today: "2026-11-18" });
    expect(days.map((day) => day.code).sort()).toEqual(["R-01", "R-02"]);
    const north = days.find((day) => day.code === "R-01");
    expect(north?.customers.map((customer) => customer.partnerId)).toEqual([PARTNER_A, PARTNER_B]); // visitOrder 1, 2
    expect(north?.vanWarehouseId).toBe(VAN_WH);
  });

  it("carries the per-customer tier pricing + balances + open invoices from cache, with the as-of label", () => {
    const days = buildRouteVisitDays(store, { today: "2026-11-18" });
    const north = days.find((day) => day.code === "R-01")!;
    const partnerA = north.customers.find((customer) => customer.partnerId === PARTNER_A)!;
    expect(partnerA.tierPricing).toBe(true); // price list has cached entries
    expect(partnerA.balance).toBe("150.0000");
    expect(partnerA.creditLimit).toBe("100.0000");
    expect(partnerA.openInvoices).toBe(1);
    expect(partnerA.asOf).toBe("2026-11-16");
    expect(partnerA.visitState).toBe("PLANNED");

    const partnerB = north.customers.find((customer) => customer.partnerId === PARTNER_B)!;
    expect(partnerB.tierPricing).toBe(false); // no price list → no tier pricing
    expect(partnerB.openInvoices).toBe(0);

    const daily = days.find((day) => day.code === "R-02")!;
    const partnerC = daily.customers.find((customer) => customer.partnerId === PARTNER_C)!;
    expect(partnerC.balance).toBeNull(); // no cached statement — never guessed
    expect(partnerC.asOf).toBeNull();
  });

  it("narrows to one rep's routes (the logged-in rep)", () => {
    const days = buildRouteVisitDays(store, { today: "2026-11-18", salesRepId: REP_ID });
    expect(days.map((day) => day.code)).toEqual(["R-01"]);
  });

  it("a partner outside today's routes has no visit-action context", () => {
    expect(visitActionContext(store, PARTNER_NO_ROUTE, { today: "2026-11-18" })).toBeNull();
  });

  it("PLANNED → DONE once the device's outbox holds a van sale OR collection for the partner", () => {
    const uuid = sequencedUuid("ea");
    // A van sale for PARTNER_A (the sell-here action).
    let cart = setCartPayment(emptyVanSaleCart("CREDIT"), "CREDIT");
    cart = setCartCustomer(cart, PARTNER_A, "عميل الطريق الأول");
    cart = addItemToCart(store, cart, { code: "6291000000011" });
    const sale = saveVanSale(store, CTX, cart, uuid);
    expect(sale.ok).toBe(true);

    let days = buildRouteVisitDays(store, { today: "2026-11-18" });
    const partnerA = days
      .find((day) => day.code === "R-01")!
      .customers.find((customer) => customer.partnerId === PARTNER_A)!;
    expect(partnerA.visitState).toBe("DONE");

    // A collection for PARTNER_C (the collect-here action).
    const collection = saveFieldCollection(store, CTX, { partnerId: PARTNER_C, method: "CASH", amount: "10.0000" }, sequencedUuid("eb"));
    expect(collection.ok).toBe(true);
    days = buildRouteVisitDays(store, { today: "2026-11-18" });
    const partnerC = days
      .find((day) => day.code === "R-02")!
      .customers.find((customer) => customer.partnerId === PARTNER_C)!;
    expect(partnerC.visitState).toBe("DONE");
  });

  it("SKIPPED is a local meta flag per (date, partner) — unmark re-opens the stop", () => {
    expect(isVisitSkipped(store, "2026-11-18", PARTNER_B)).toBe(false);
    markVisitSkipped(store, "2026-11-18", PARTNER_B);
    expect(isVisitSkipped(store, "2026-11-18", PARTNER_B)).toBe(true);
    // PARTNER_B has a queued van sale? No — only PARTNER_A/C do; skipped wins the render only when not DONE.
    const days = buildRouteVisitDays(store, { today: "2026-11-18" });
    const partnerB = days
      .find((day) => day.code === "R-01")!
      .customers.find((customer) => customer.partnerId === PARTNER_B)!;
    expect(partnerB.visitState).toBe("SKIPPED");
    unmarkVisitSkipped(store, "2026-11-18", PARTNER_B);
    expect(isVisitSkipped(store, "2026-11-18", PARTNER_B)).toBe(false);
  });

  it("resolves the visit-action context (the sell-here navigation payload: the route + its van)", () => {
    const context = visitActionContext(store, PARTNER_A, { today: "2026-11-18" });
    expect(context).toMatchObject({ partnerId: PARTNER_A, routeId: ROUTE_SUN, vanWarehouseId: VAN_WH, date: "2026-11-18" });
  });
});
