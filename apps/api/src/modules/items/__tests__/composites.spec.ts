import { describe, expect, it } from "vitest";

import type { ItemRow } from "../infrastructure/items.store";
import { validateComponentDefinition } from "../application/composite-service";
import {
  ComponentDuplicateError,
  ComponentNotStockError,
  ComponentQtyInvalidError,
  ComponentSelfReferenceError,
  CompositeKindInvalidError,
  CompositeNotDefinedError,
  ItemNotFoundError,
} from "../domain/items-errors";

/**
 * PHASE-015 T9 (`items.composite_products`) — the definition validation
 * matrix as a PURE unit suite (the db-backed golden posting lives in
 * `src/__db__/sales/composites-golden.spec.ts`): every rule of the
 * full-replace contract fails with its typed error, and the happy path
 * normalizes to 6dp.
 */

function itemRow(overrides: Partial<ItemRow> & { id: string }): ItemRow {
  return {
    sku: `SKU-${overrides.id.slice(0, 8)}`,
    name: "row",
    nameAr: null,
    kind: "STOCK",
    uomId: "00000000-0000-4000-8000-000000000001",
    categoryId: null,
    taxCodeId: null,
    costingMethod: "WAC",
    trackBatch: false,
    trackSerial: false,
    trackImei: false,
    hasExpiry: false,
    // PHASE-018 (migration 0026): shelf life rides items; null default here.
    shelfLifeDays: null,
    reorderLevel: null,
    reorderQty: null,
    basePrice: null,
    status: "ACTIVE",
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

const COMPOSITE_ID = "aaaaaaa1-0000-4000-8000-0000000000c1";
const STOCK_A = "aaaaaaa2-0000-4000-8000-0000000000c2";
const STOCK_B = "aaaaaaa3-0000-4000-8000-0000000000c3";
const SERVICE_ID = "aaaaaaa4-0000-4000-8000-0000000000c4";
const NESTED_COMPOSITE_ID = "aaaaaaa5-0000-4000-8000-0000000000c5";
const ARCHIVED_STOCK_ID = "aaaaaaa6-0000-4000-8000-0000000000c6";

const composite = itemRow({ id: COMPOSITE_ID, kind: "COMPOSITE" });
const stockA = itemRow({ id: STOCK_A });
const stockB = itemRow({ id: STOCK_B });
const service = itemRow({ id: SERVICE_ID, kind: "SERVICE" });
const nestedComposite = itemRow({ id: NESTED_COMPOSITE_ID, kind: "COMPOSITE" });
const archivedStock = itemRow({ id: ARCHIVED_STOCK_ID, deletedAt: "2026-02-01T00:00:00.000Z" });

function validate(
  components: readonly { componentItemId: string; qty: string }[],
  options: {
    composite?: ItemRow;
    extraItems?: ItemRow[];
  } = {},
) {
  const componentItems = new Map(
    [stockA, stockB, service, nestedComposite, archivedStock, ...(options.extraItems ?? [])].map(
      (row) => [row.id, row],
    ),
  );
  return validateComponentDefinition({
    composite: options.composite ?? composite,
    components,
    componentItems,
  });
}

describe("composite definition validation matrix (PHASE-015 T9)", () => {
  it("accepts a valid definition and normalizes qty to 6dp", () => {
    expect(
      validate([
        { componentItemId: STOCK_A, qty: "2" },
        { componentItemId: STOCK_B, qty: "3.5" },
      ]),
    ).toEqual([
      { componentItemId: STOCK_A, qty: "2.000000" },
      { componentItemId: STOCK_B, qty: "3.500000" },
    ]);
  });

  it("accepts an empty list (clearing the definition is a full replace)", () => {
    expect(validate([])).toEqual([]);
  });

  it("rejects a non-COMPOSITE owner (STOCK item carrying components)", () => {
    expect(() => validate([{ componentItemId: STOCK_A, qty: "1" }], { composite: stockA })).toThrow(
      CompositeKindInvalidError,
    );
    expect(() => validate([{ componentItemId: STOCK_A, qty: "1" }], { composite: stockA })).toThrow(
      /is STOCK — component lists attach to COMPOSITE-kind items only/,
    );
  });

  it("rejects an archived composite owner", () => {
    expect(() =>
      validate([{ componentItemId: STOCK_A, qty: "1" }], {
        composite: itemRow({ id: COMPOSITE_ID, kind: "COMPOSITE", deletedAt: "2026-02-01T00:00:00.000Z" }),
      }),
    ).toThrow(ItemNotFoundError);
  });

  it("rejects an unknown component (typed 404 shape)", () => {
    expect(() => validate([{ componentItemId: "bbbbbbb1-0000-4000-8000-0000000000d1", qty: "1" }])).toThrow(
      ItemNotFoundError,
    );
  });

  it("rejects an archived component", () => {
    expect(() => validate([{ componentItemId: ARCHIVED_STOCK_ID, qty: "1" }])).toThrow(ItemNotFoundError);
  });

  it("rejects SERVICE components", () => {
    expect(() => validate([{ componentItemId: SERVICE_ID, qty: "1" }])).toThrow(ComponentNotStockError);
  });

  it("rejects COMPOSITE components (no nested explosion in v1)", () => {
    expect(() => validate([{ componentItemId: NESTED_COMPOSITE_ID, qty: "1" }])).toThrow(
      ComponentNotStockError,
    );
    expect(() => validate([{ componentItemId: NESTED_COMPOSITE_ID, qty: "1" }])).toThrow(
      /components must be STOCK items/,
    );
  });

  it.each(["0", "0.000000", "-1", "1.5.2", "abc", "1.2345678", ""])(
    "rejects an invalid qty (%s)",
    (qty) => {
      expect(() => validate([{ componentItemId: STOCK_A, qty }])).toThrow(ComponentQtyInvalidError);
    },
  );

  it("rejects duplicate components", () => {
    expect(() =>
      validate([
        { componentItemId: STOCK_A, qty: "1" },
        { componentItemId: STOCK_A, qty: "2" },
      ]),
    ).toThrow(ComponentDuplicateError);
  });

  it("rejects self-reference (mirrors the DB CHECK ck_item_components_distinct)", () => {
    expect(() => validate([{ componentItemId: COMPOSITE_ID, qty: "1" }])).toThrow(
      ComponentSelfReferenceError,
    );
  });

  it("validates rows in order — the first offending rule wins deterministically", () => {
    // A self-reference followed by a duplicate: self-reference fires first.
    expect(() =>
      validate([
        { componentItemId: COMPOSITE_ID, qty: "1" },
        { componentItemId: COMPOSITE_ID, qty: "2" },
      ]),
    ).toThrow(ComponentSelfReferenceError);
  });
});

describe("composite explosion contract errors (typed surface)", () => {
  it("CompositeNotDefinedError carries the COMPOSITE_NOT_DEFINED code", () => {
    const error = new CompositeNotDefinedError(COMPOSITE_ID);
    expect(error.code).toBe("COMPOSITE_NOT_DEFINED");
    expect(error.message).toMatch(/has no component definition/);
  });
});
