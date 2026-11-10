import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetUuidv7ForTests, Uuidv7OverflowError, generateUuidV7 } from "../uuidv7";

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.useRealTimers();
  __resetUuidv7ForTests();
});

describe("generateUuidV7", () => {
  it("produces RFC 9562 UUIDv7 format (version 7, variant 10)", () => {
    const id = generateUuidV7();
    expect(id).toMatch(UUIDV7_PATTERN);
    expect(id[14]).toBe("7"); // version nibble
    expect(["8", "9", "a", "b"]).toContain(id[19]); // variant bits
  });

  it("is strictly monotonically increasing within the process (sortable as string)", () => {
    const ids = Array.from({ length: 2000 }, () => generateUuidV7());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids); // string sort == generation order
  });

  it("keeps strict order within the same millisecond (counter monotonicity)", () => {
    vi.useFakeTimers({ now: 1770000000000 });
    const first = generateUuidV7();
    const second = generateUuidV7();
    expect(second > first).toBe(true);
    expect(first.slice(15, 18)).toBe("000");
    expect(second.slice(15, 18)).toBe("001");
  });

  it("throws on counter exhaustion (4096 ids in one millisecond)", () => {
    vi.useFakeTimers({ now: 1770000000000 });
    for (let i = 0; i < 4096; i += 1) {
      generateUuidV7();
    }
    expect(() => generateUuidV7()).toThrow(Uuidv7OverflowError);
  });
});
