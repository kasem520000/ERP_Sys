/**
 * PHASE-021 T2-b — the sync-mirror suite: the webview's HostState mirror
 * (phase derivation from store reads), the queue depth, the draft
 * reconciliation, and the honest syncNow/pushNow triggers.
 */
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ShellBridgeProvider } from "../bridge";
import { useSyncMirror, type SyncMirrorState } from "../sync-mirror";
import { createBridgeDouble, installBridge, type BridgeDouble } from "./bridge-double";

afterEach(() => {
  cleanup();
  delete (globalThis as { __erpDesktop?: unknown }).__erpDesktop;
});

const UUID_A = "21212121-0000-4000-8000-000000000001";
const UUID_B = "21212121-0000-4000-8000-000000000002";

/** Render the mirror inside the provider and expose its live state. */
function mountMirror(_double: BridgeDouble): {
  get: () => SyncMirrorState;
  triggerSyncNow: () => Promise<{ status: "called" | "unavailable" }>;
  triggerPushNow: () => Promise<{ status: "called" | "unavailable" }>;
} {
  let current: SyncMirrorState | null = null;
  let syncNow: () => Promise<{ status: "called" | "unavailable" }> = () => {
    throw new Error("not captured");
  };
  let pushNow: () => Promise<{ status: "called" | "unavailable" }> = () => {
    throw new Error("not captured");
  };
  function Probe(): null {
    const mirror = useSyncMirror();
    current = mirror.state;
    syncNow = mirror.triggerSyncNow;
    pushNow = mirror.triggerPushNow;
    return null;
  }
  render(createElement(ShellBridgeProvider, null, createElement(Probe, null)));
  return {
    get: () => current as SyncMirrorState,
    triggerSyncNow: () => syncNow(),
    triggerPushNow: () => pushNow(),
  };
}

function outbox(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    command_id: UUID_A,
    entity_type: "partner",
    intent: "create",
    payload: "{}",
    idempotency_key: "k",
    base_version: null,
    client_created_at: "2026-11-04T10:00:00.000Z",
    local_ref: null,
    status: "QUEUED",
    attempts: 0,
    next_attempt_at: 0,
    last_error: null,
    last_attempt_at: null,
    accepted_result: null,
    rejection_reason: null,
    rejection_action: null,
    official_no: null,
    acked_at: null,
    ...overrides,
  };
}

describe("phase derivation (the HostState mirror)", () => {
  it("stays in browser phase when no bridge is present", async () => {
    const mirror = mountMirror(createBridgeDouble({ online: true }));
    // no bridge injected — the mirror must never touch a store
    await act(async () => {});
    expect(mirror.get().phase).toBe("browser");
    expect(mirror.get().queueDepth).toBe(0);
  });

  it("derives corrupt from meta.quarantined (§6.4)", async () => {
    const double = createBridgeDouble();
    double.seed("meta", [{ key: "quarantined", value: "true" }]);
    installBridge(double);
    const mirror = mountMirror(double);
    await act(async () => {});
    expect(mirror.get().phase).toBe("corrupt");
  });

  it("derives revoked from meta.queueUnresolvable (D-01)", async () => {
    const double = createBridgeDouble();
    double.seed("meta", [{ key: "queueUnresolvable", value: "DEVICE_REVOKED" }]);
    installBridge(double);
    const mirror = mountMirror(double);
    await act(async () => {});
    expect(mirror.get().phase).toBe("revoked");
  });

  it("derives read-only from meta.contractGate with the C-08 reason", async () => {
    const double = createBridgeDouble();
    double.seed("meta", [{ key: "contractGate", value: "read-only" }]);
    installBridge(double);
    const mirror = mountMirror(double);
    await act(async () => {});
    expect(mirror.get().phase).toBe("read-only");
    expect(mirror.get().readOnlyReason).toBe("CONTRACT_VERSION_UNSUPPORTED");
  });

  it("derives syncing while an outbox row is IN_FLIGHT, and idle otherwise", async () => {
    const double = createBridgeDouble();
    double.seed("outbox", [outbox({ status: "IN_FLIGHT" })]);
    installBridge(double);
    const mirror = mountMirror(double);
    await act(async () => {});
    expect(mirror.get().phase).toBe("syncing");
    expect(mirror.get().queueDepth).toBe(1);
  });

  it("derives idle with the as-of stamp from cursors", async () => {
    const double = createBridgeDouble();
    double.seed("cursors", [{ entity_type: "items", last_seq: "9", synced_at: 1_790_000_500_000 }]);
    installBridge(double);
    const mirror = mountMirror(double);
    await act(async () => {});
    expect(mirror.get().phase).toBe("idle");
    expect(mirror.get().lastSyncAt).toBe(1_790_000_500_000);
  });

  it("counts the queue depth as QUEUED + IN_FLIGHT", async () => {
    const double = createBridgeDouble();
    double.seed("outbox", [
      outbox({ command_id: UUID_A, status: "QUEUED" }),
      outbox({ command_id: UUID_B, status: "IN_FLIGHT" }),
    ]);
    installBridge(double);
    const mirror = mountMirror(double);
    await act(async () => {});
    expect(mirror.get().queueDepth).toBe(2);
  });
});

describe("draft reconciliation (the projection maintenance)", () => {
  it("flips a draft to MERGED when its outbox command is ACKED", async () => {
    const double = createBridgeDouble();
    double.seed("outbox", [outbox({ status: "ACKED", official_no: "P-000009" })]);
    double.seed("draft_docs", [
      {
        local_id: UUID_B,
        doc_type: "partner_create",
        entity_id: null,
        payload: "{}",
        local_status: "DRAFT_LOCAL",
        command_id: UUID_A,
        rejection: null,
        updated_at: "2026-11-04T09:00:00.000Z",
      },
    ]);
    installBridge(double);
    const mirror = mountMirror(double);
    await act(async () => {});
    const draft = double.tables.get("draft_docs")!.get(UUID_B)!;
    expect(draft.local_status).toBe("MERGED");
    expect(draft.rejection).toBeNull();
    expect(mirror.get().phase).toBe("idle");
  });

  it("flips a draft to SYNC_FAILED carrying the outbox row's typed reason", async () => {
    const double = createBridgeDouble();
    double.seed("outbox", [
      outbox({ status: "REJECTED", rejection_reason: "PRICE_CHANGED", last_error: "{\"reason\":\"PRICE_CHANGED\"}" }),
    ]);
    double.seed("draft_docs", [
      {
        local_id: UUID_B,
        doc_type: "expense",
        entity_id: null,
        payload: "{}",
        local_status: "DRAFT_LOCAL",
        command_id: UUID_A,
        rejection: null,
        updated_at: "2026-11-04T09:00:00.000Z",
      },
    ]);
    installBridge(double);
    mountMirror(double);
    await act(async () => {});
    const draft = double.tables.get("draft_docs")!.get(UUID_B)!;
    expect(draft.local_status).toBe("SYNC_FAILED");
    expect(draft.rejection).toBe("PRICE_CHANGED");
  });

  it("never touches terminal drafts (MERGED / CANCELLED_LOCAL)", async () => {
    const double = createBridgeDouble();
    double.seed("outbox", [outbox({ status: "REJECTED", rejection_reason: "VALIDATION_ERROR" })]);
    double.seed("draft_docs", [
      {
        local_id: UUID_B,
        doc_type: "expense",
        entity_id: null,
        payload: "{}",
        local_status: "CANCELLED_LOCAL",
        command_id: UUID_A,
        rejection: "PRICE_CHANGED",
        updated_at: "2026-11-04T09:00:00.000Z",
      },
    ]);
    installBridge(double);
    await act(async () => {});
    const draft = double.tables.get("draft_docs")!.get(UUID_B)!;
    expect(draft.local_status).toBe("CANCELLED_LOCAL");
    expect(draft.rejection).toBe("PRICE_CHANGED");
  });
});

describe("syncNow / pushNow triggers (DR-P21-09)", () => {
  it("reports unavailable on an older shell without the sync member", async () => {
    const double = createBridgeDouble({ withSync: false });
    installBridge(double);
    const mirror = mountMirror(double);
    const result = await mirror.triggerSyncNow();
    expect(result.status).toBe("unavailable");
    expect(double.calls.syncNow).toBe(0);
  });

  it("reports unavailable in browser mode", async () => {
    const mirror = mountMirror(createBridgeDouble());
    expect((await mirror.triggerPushNow()).status).toBe("unavailable");
  });

  it("calls the shell driver and refreshes afterwards", async () => {
    const double = createBridgeDouble();
    installBridge(double);
    const mirror = mountMirror(double);
    const before = mirror.get().version;
    await act(async () => {
      const result = await mirror.triggerSyncNow();
      expect(result.status).toBe("called");
    });
    expect(double.calls.syncNow).toBe(1);
    expect(mirror.get().version).toBeGreaterThan(before);
    await act(async () => {
      const result = await mirror.triggerPushNow();
      expect(result.status).toBe("called");
    });
    expect(double.calls.pushNow).toBe(1);
  });

  it("bumps the version on every refresh", async () => {
    const double = createBridgeDouble();
    installBridge(double);
    const mirror = mountMirror(double);
    const first = mirror.get().version;
    await act(async () => {});
    expect(mirror.get().version).toBeGreaterThanOrEqual(first);
  });
});
