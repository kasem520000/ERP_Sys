import { describe, expect, it } from "vitest";

import {
  CrashFreeSessions,
  REDACTED_VALUE,
  redactEvent,
  redactText,
} from "../src/telemetry/crash";

/**
 * PHASE-021 T9 · crash telemetry (MASTER-PLAN §7): redaction strips
 * credentials/keys/paths (values AND free-text forms) while tenant tags
 * survive; the rolling crash-free-session counter feeds the rollout gates —
 * windows age old sessions out (24 h trailing, boundary-exact).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe("redactEvent (deep clone + redact, never mutates the input)", () => {
  it("replaces secret-named key values wholesale (tokens, keys, Authorization)", () => {
    const event = {
      tenantId: "21212121-2121-2121-2121-212121212121",
      refreshToken: "rt-secret-value-abc123",
      accessToken: "at-secret-value-xyz789",
      dbKey: "0f2a…cipher-key",
      deviceKey: "ed25519-seed-material",
      Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
      message: "push failed",
    };
    const redacted = redactEvent(event);
    expect(redacted.refreshToken).toBe(REDACTED_VALUE);
    expect(redacted.accessToken).toBe(REDACTED_VALUE);
    expect(redacted.dbKey).toBe(REDACTED_VALUE);
    expect(redacted.deviceKey).toBe(REDACTED_VALUE);
    expect(redacted.Authorization).toBe(REDACTED_VALUE);
    // Tenant ids are routing TAGS, not secrets — they stay (documented).
    expect(redacted.tenantId).toBe("21212121-2121-2121-2121-212121212121");
    expect(redacted.message).toBe("push failed");
  });

  it("matches key-name variants (snake_case, kebab-case, spaces, casing)", () => {
    const event = {
      refresh_token: "x",
      ACCESS_TOKEN: "x",
      "db-key": "x",
      "device key": "x",
      authorization: "x",
    };
    const redacted = redactEvent(event);
    expect(Object.values(redacted).every((value) => value === REDACTED_VALUE)).toBe(true);
  });

  it("redacts NESTED objects and arrays recursively (deep clone)", () => {
    const event = {
      context: {
        deviceKey: "nested-secret",
        headers: { authorization: "Bearer abc.def.ghi" },
        attempts: [{ accessToken: "in-an-array" }],
      },
    };
    const redacted = redactEvent(event);
    expect(redacted.context).toEqual({
      deviceKey: REDACTED_VALUE,
      headers: { authorization: REDACTED_VALUE },
      attempts: [{ accessToken: REDACTED_VALUE }],
    });
  });

  it("redacts path-like string VALUES anywhere in the tree", () => {
    const event = { error: "ENOENT at /home/shop/erp/store.db (WAL)", windows: 'failed to open "C:\\Users\\shop\\AppData\\erp.db"' };
    const redacted = redactEvent(event);
    expect(String(redacted.error)).not.toContain("/home/shop/erp/store.db");
    expect(String(redacted.error)).toContain("<path>");
    expect(String(redacted.windows)).not.toContain("C:\\Users\\shop\\AppData\\erp.db");
    expect(String(redacted.windows)).toContain("<path>");
  });

  it("NEVER mutates the input event (deep clone semantics)", () => {
    const event = {
      refreshToken: "rt-secret",
      nested: { deviceKey: "dk-secret", lines: ["postgres://erp:p@ss@host/erp"] },
    };
    const snapshot = JSON.stringify(event);
    redactEvent(event);
    expect(JSON.stringify(event)).toBe(snapshot);
    expect(event.nested.deviceKey).toBe("dk-secret");
  });

  it("keeps tenant/user tags and non-secret payloads intact", () => {
    const event = {
      tenantId: "tenant-1",
      deviceId: "device-1",
      userId: "user-9",
      docNo: "INV-2026-000123",
      count: 42,
      ok: true,
      when: "2026-11-05T10:00:00.000Z",
    };
    expect(redactEvent(event)).toEqual(event);
  });

  it("cleans token-bearing URLs and DSNs inside free-text values", () => {
    const event = { detail: "GET https://api.erp.example/v1/sync/pull?token=super-secret 500; dsn postgres://erp:pw@db/erp" };
    const detail = String(redactEvent(event).detail);
    expect(detail).not.toContain("super-secret");
    expect(detail).not.toContain("erp:pw@");
    expect(detail).toContain("token=[REDACTED]");
    expect(detail).toContain("postgres://[REDACTED]");
  });
});

describe("redactText (log lines)", () => {
  it("strips bearer tokens", () => {
    expect(redactText("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sig")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
  });

  it("strips database DSNs while keeping the scheme", () => {
    expect(redactText("connect postgres://erp:s3cret@db.internal:5432/erp failed")).toBe(
      "connect postgres://[REDACTED] failed",
    );
    expect(redactText("mongodb+srv://u:p@cluster/erp")).toBe("mongodb+srv://[REDACTED]");
  });

  it("strips tokens from URL query strings (access_token/refresh_token/api_key)", () => {
    expect(redactText("https://h/a?access_token=abc123&x=1")).toBe("https://h/a?access_token=[REDACTED]&x=1");
    expect(redactText("https://h/a?refresh_token=r&api_key=k")).toBe(
      "https://h/a?refresh_token=[REDACTED]&api_key=[REDACTED]",
    );
  });

  it("replaces absolute file paths (POSIX + Windows) with <path>", () => {
    expect(redactText("opened /home/shop/erp/store.db ok")).toBe("opened <path> ok");
    // Unquoted Windows paths without spaces redact whole; paths with spaces
    // need quoting in log discipline (documented best-effort boundary).
    expect(redactText("opened C:\\ERP\\app.exe ok")).toBe("opened <path> ok");
    expect(redactText("tmp /var/log/erp/crash.log")).toContain("<path>");
  });

  it("leaves ordinary URLs and text untouched", () => {
    const line = "GET https://updates.erp.example/stable/latest.json → 200 in 43ms";
    expect(redactText(line)).toBe(line);
  });
});

describe("CrashFreeSessions (rolling counters feeding the rollout gates)", () => {
  it("counts sessions and crash-free sessions over the trailing 24 h window", () => {
    const sessions = new CrashFreeSessions();
    const now = 1_760_000_000_000;
    for (let index = 0; index < 250; index += 1) {
      sessions.sessionStart(`device-${index % 5}`, now - 1000 * index);
    }
    sessions.reportCrash("device-0", now); // one crashed session
    expect(sessions.metrics(DAY_MS, now)).toEqual({ sessions: 250, crashFreeSessions: 249 });
    expect(sessions.rate(DAY_MS, now)).toBeCloseTo(0.996, 12);
  });

  it("aggregates across devices (per-device rolling counters)", () => {
    const sessions = new CrashFreeSessions();
    const now = 1_760_000_000_000;
    sessions.sessionStart("device-a", now - 100);
    sessions.sessionStart("device-a", now - 50);
    sessions.sessionStart("device-b", now - 10);
    sessions.reportCrash("device-a", now); // the LATEST device-a session crashed
    expect(sessions.metrics(DAY_MS, now)).toEqual({ sessions: 3, crashFreeSessions: 2 });
  });

  it("a crash marks the device's LATEST session (older sessions stay crash-free)", () => {
    const sessions = new CrashFreeSessions();
    const now = 1_760_000_000_000;
    sessions.sessionStart("device-a", now - 5000);
    sessions.sessionStart("device-a", now - 1000);
    sessions.reportCrash("device-a", now);
    const metrics = sessions.metrics(DAY_MS, now);
    expect(metrics).toEqual({ sessions: 2, crashFreeSessions: 1 });
  });

  it("an orphan crash (no recorded session) is ignored, honestly", () => {
    const sessions = new CrashFreeSessions();
    const now = 1_760_000_000_000;
    sessions.reportCrash("ghost-device", now);
    expect(sessions.metrics(DAY_MS, now)).toEqual({ sessions: 0, crashFreeSessions: 0 });
    expect(sessions.rate(DAY_MS, now)).toBeNull();
  });

  it("boundary: sessions older than the window AGE OUT exactly", () => {
    const sessions = new CrashFreeSessions();
    const now = 1_760_000_000_000;
    sessions.sessionStart("device-old-ok", now - DAY_MS - 1); // outside 24 h
    sessions.sessionStart("device-old-crash", now - DAY_MS - 1);
    sessions.reportCrash("device-old-crash", now - DAY_MS);
    sessions.sessionStart("device-new", now - 1000);
    // A 48 h window sees all three sessions (queried FIRST — the 24 h
    // query below prunes the aged-out records, per the rolling design).
    expect(sessions.metrics(2 * DAY_MS, now)).toEqual({ sessions: 3, crashFreeSessions: 2 });
    // 24 h window: only device-new counts; the old records age out.
    expect(sessions.metrics(DAY_MS, now)).toEqual({ sessions: 1, crashFreeSessions: 1 });
  });

  it("the counter rolls (pruned records do not resurrect in later windows)", () => {
    const sessions = new CrashFreeSessions();
    const now = 1_760_000_000_000;
    sessions.sessionStart("device-a", now - 10 * DAY_MS);
    expect(sessions.metrics(DAY_MS, now)).toEqual({ sessions: 0, crashFreeSessions: 0 });
    // The 10-day-old record was pruned by the 24 h query — the counter is a
    // rolling window, not an archive (documented).
    expect(sessions.metrics(30 * DAY_MS, now)).toEqual({ sessions: 0, crashFreeSessions: 0 });
  });

  it("feeds the rollout gate end-to-end (metrics → evaluateStageTransition shape)", async () => {
    const { evaluateStageTransition } = await import("../src/updater/rollout");
    const sessions = new CrashFreeSessions();
    const now = 1_760_000_000_000;
    for (let index = 0; index < 250; index += 1) {
      sessions.sessionStart(`gate-device-${index}`, now - 100 * index);
    }
    sessions.reportCrash("gate-device-0", now);
    const decision = evaluateStageTransition({ currentStagePercent: 10, metrics: sessions.metrics(DAY_MS, now) });
    expect(decision.decision).toBe("promote");
    expect(decision.nextStage).toBe(50);
  });
});
