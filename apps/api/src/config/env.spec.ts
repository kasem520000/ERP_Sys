import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

describe("parseEnv (PHASE-002 §2.1)", () => {
  it("applies documented defaults", () => {
    const parsed = parseEnv({});
    expect(parsed.PORT).toBe(3001);
    expect(parsed.WORKER_MODE).toBe(0);
    expect(parsed.LOG_LEVEL).toBe("info");
    expect(parsed.S3_BUCKET).toBe("erp-files");
    expect(parsed.SIGNED_URL_TTL_SECONDS).toBe(900);
    expect(parsed.MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(parsed.OTEL_ENABLED).toBe(0);
    expect(parsed.NODE_ENV).toBe("development");
  });

  it("coerces numeric env strings and accepts valid URLs", () => {
    const parsed = parseEnv({
      PORT: "3005",
      WORKER_MODE: "1",
      DATABASE_URL: "postgres://erp_app:erp_app@localhost:5432/erp",
      MIGRATE_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/erp",
      LOG_LEVEL: "debug",
    });
    expect(parsed.PORT).toBe(3005);
    expect(parsed.WORKER_MODE).toBe(1);
    expect(parsed.LOG_LEVEL).toBe("debug");
    expect(parsed.DATABASE_URL).toContain("erp_app");
  });

  it("rejects invalid values fail-fast", () => {
    expect(() => parseEnv({ PORT: "not-a-number" })).toThrow(/Invalid environment/);
    expect(() => parseEnv({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
    expect(() => parseEnv({ WORKER_MODE: "2" })).toThrow(/WORKER_MODE/);
  });
});
