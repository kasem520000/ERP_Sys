import { describe, expect, it } from "vitest";
import {
  CurrencyMismatchError,
  DomainError,
  InvalidValueError,
  err,
  isErr,
  isOk,
  ok,
} from "../index";

describe("Result semantics", () => {
  it("ok() carries a value and is recognized by isOk", () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) expect(result.value).toBe(42);
  });

  it("err() carries a DomainError and is recognized by isErr", () => {
    const result = err(new InvalidValueError("bad value"));
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) expect(result.error).toBeInstanceOf(DomainError);
  });
});

describe("Domain errors", () => {
  it("carry stable machine codes and a distinct class name", () => {
    const e = new InvalidValueError("not a decimal");
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe("domain/invalid-value");
    expect(e.name).toBe("InvalidValueError");
    expect(e.message).toBe("not a decimal");
  });

  it("expose structured details for logging/telemetry", () => {
    const e = new CurrencyMismatchError("SAR", "AED");
    expect(e.code).toBe("domain/currency-mismatch");
    expect(e.details).toEqual({ left: "SAR", right: "AED" });
  });
});
