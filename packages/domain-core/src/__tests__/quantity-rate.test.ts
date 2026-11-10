import { describe, expect, it } from "vitest";
import { InvalidValueError, Quantity, Rate } from "../index";

describe("Quantity (numeric(19,6), max 6 dp)", () => {
  it("parses and formats at 6-dp scale", () => {
    expect(Quantity.fromString("12.5").format()).toBe("12.500000");
    expect(Quantity.fromString("12.500000").format()).toBe("12.500000");
  });

  it("rejects beyond 6 dp and non-strings", () => {
    expect(() => Quantity.fromString("12.5000000")).toThrow(InvalidValueError);
    expect(() => Quantity.fromString(12.5 as unknown as string)).toThrow(InvalidValueError);
    expect(() => Quantity.fromNumber(12.5)).toThrow();
  });

  it("supports exact integer-unit construction and addition", () => {
    expect(Quantity.fromIntegerUnits(3n).add(Quantity.fromIntegerUnits(4n)).format()).toBe(
      "7.000000",
    );
  });

  it("keeps 6-dp internal unit-cost precision", () => {
    expect(Quantity.fromString("3.141592").toUnitCost()).toBe("3.141592");
    expect(Quantity.fromString("3").toUnitCost()).toBe("3.000000");
  });
});

describe("Rate (numeric(19,8); percentages numeric(7,4))", () => {
  it("parses FX rates at up to 8 dp", () => {
    expect(Rate.fromString("0.03750000").format()).toBe("0.03750000");
    expect(() => Rate.fromString("0.037500000")).toThrow(InvalidValueError);
    expect(() => Rate.fromNumber(0.0375)).toThrow();
  });

  it("parses percentage rates at up to 4 dp (e.g. VAT 15.0000)", () => {
    expect(Rate.fromPercentageString("15.0000").format()).toBe("15.00000000");
    expect(() => Rate.fromPercentageString("15.00001")).toThrow(InvalidValueError);
  });

  it("multiplies a quantity without premature rounding (rate never rounded before use)", () => {
    // Raw-multiplier semantics: the rate value multiplies as-is. Percent-scale
    // interpretation (15% of a base) is a PHASE-009 tax-engine contract, not v0.
    const rate = Rate.fromString("0.15000000");
    expect(rate.timesQuantity(Quantity.fromString("200")).format()).toBe("30.000000");
    const vat = Rate.fromPercentageString("15.0000");
    expect(vat.timesQuantity(Quantity.fromString("200")).format()).toBe("3000.000000");
  });
});
