import { beforeEach, describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  FEATURE_KEYS,
  ContractKeyConflictError,
  ContractKeyNotFoundError,
  getContractSchema,
  listContractSchemas,
  moneyAmountSchema,
  percentageSchema,
  quantitySchema,
  fxRateSchema,
  registerContractSchema,
  resetContractRegistryForTests,
  utcTimestampSchema,
  isoDateSchema,
} from "../index";

beforeEach(() => {
  resetContractRegistryForTests();
});

describe("schema registry v0", () => {
  it("starts empty (registry v0 — population starts with PHASE-002 endpoints)", () => {
    expect(listContractSchemas()).toEqual([]);
  });

  it("registers and retrieves schemas under stable keys", () => {
    const schema = moneyAmountSchema;
    registerContractSchema("v0.demo.money", schema);
    expect(getContractSchema("v0.demo.money")).toBe(schema);
    expect(listContractSchemas()).toEqual(["v0.demo.money"]);
  });

  it("rejects duplicate keys", () => {
    registerContractSchema("v0.demo.money", moneyAmountSchema);
    expect(() => registerContractSchema("v0.demo.money", moneyAmountSchema)).toThrow(
      ContractKeyConflictError,
    );
  });

  it("fails lookups for unregistered keys", () => {
    expect(() => getContractSchema("v0.demo.missing")).toThrow(ContractKeyNotFoundError);
  });
});

describe("wire-format schemas (API_CONVENTIONS §7 / DEF-001)", () => {
  it("accepts amounts with up to 4 dp and rejects 5 dp or numbers", () => {
    expect(moneyAmountSchema.safeParse("1234.5000").success).toBe(true);
    expect(moneyAmountSchema.safeParse("-0.01").success).toBe(true);
    expect(moneyAmountSchema.safeParse("1234.50000").success).toBe(false);
    expect(moneyAmountSchema.safeParse(1234.5).success).toBe(false);
    expect(moneyAmountSchema.safeParse("12,50").success).toBe(false);
  });

  it("accepts quantities up to 6 dp, rejects 7 dp", () => {
    expect(quantitySchema.safeParse("12.500000").success).toBe(true);
    expect(quantitySchema.safeParse("12.5000000").success).toBe(false);
  });

  it("accepts FX rates up to 8 dp, rejects 9 dp", () => {
    expect(fxRateSchema.safeParse("0.03750000").success).toBe(true);
    expect(fxRateSchema.safeParse("0.037500000").success).toBe(false);
  });

  it("accepts percentages up to 4 dp, rejects 5 dp", () => {
    expect(percentageSchema.safeParse("15.0000").success).toBe(true);
    expect(percentageSchema.safeParse("15.00001").success).toBe(false);
  });

  it("accepts ISO dates and UTC timestamps with offsets, rejects local forms", () => {
    expect(isoDateSchema.safeParse("2026-10-27").success).toBe(true);
    expect(isoDateSchema.safeParse("27-10-2026").success).toBe(false);
    expect(utcTimestampSchema.safeParse("2026-10-27T08:15:00Z").success).toBe(true);
    expect(utcTimestampSchema.safeParse("2026-10-27T08:15:00+03:00").success).toBe(true);
    expect(utcTimestampSchema.safeParse("2026-10-27T08:15:00").success).toBe(false);
  });
});

describe("enum seeds", () => {
  it("error codes are UPPER_SNAKE strings, never numbers", () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("feature keys seed is empty until the subscription phases", () => {
    expect(Object.keys(FEATURE_KEYS)).toHaveLength(0);
  });
});
