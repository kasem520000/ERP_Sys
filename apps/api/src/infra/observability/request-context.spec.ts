import { describe, expect, it } from "vitest";

import {
  getCorrelationId,
  isUuid,
  requestContextStorage,
} from "./request-context";

describe("request correlation context (OBSERVABILITY §Structured logging)", () => {
  it("isUuid accepts only well-formed UUIDs", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid("11111111-1111-1111-1111-111111111111zz")).toBe(false);
  });

  it("exposes the correlation id inside the ALS scope only", async () => {
    expect(getCorrelationId()).toBeUndefined();
    const inside = await requestContextStorage.run(
      { correlationId: "11111111-1111-4111-8111-111111111111" },
      async () => getCorrelationId(),
    );
    expect(inside).toBe("11111111-1111-4111-8111-111111111111");
    expect(getCorrelationId()).toBeUndefined();
  });

  it("propagates across awaited async boundaries within the scope", async () => {
    const result = await requestContextStorage.run({ correlationId: "corr-1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getCorrelationId();
    });
    expect(result).toBe("corr-1");
  });
});
