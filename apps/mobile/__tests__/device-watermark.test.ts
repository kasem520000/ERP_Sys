import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { metaGet } from "@erp/sync-core";

import {
  SNAPSHOT_WATERMARK_MS,
  canWriteOffline,
  offlineWritePolicy,
  permissionWatermarkState,
  writePermissionWatermark,
} from "../src/device";
import { openFieldStore, openPersonalStore, type MobileStore } from "../src/store";

/**
 * PHASE-022 T2-b unit evidence (MASTER-PLAN §0 golden constants +
 * §1 DR-P22-09; SECURITY_AND_DEVICE_MANAGEMENT §5; SYNC_TESTS D-04):
 * the 7-day permission-snapshot watermark policy — the desktop
 * watermark application ported, over the REAL mobile stores
 * (openFieldStore / openPersonalStore on temp SQLite files).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-05T12:00:00.000Z");

const workDirs: string[] = [];
function tempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-mobile-watermark-"));
  workDirs.push(dir);
  return join(dir, `${prefix}.sqlite`);
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

describe("permissionWatermarkState (the D-04 7-day watermark)", () => {
  it("fresh snapshot (≤ 7 days) → 'fresh' + the as-of label; the writePolicy gate is WRITABLE (offline capture + queueing)", () => {
    const store = openFieldStore(tempDbPath("fresh"));
    try {
      const snapshotAt = new Date(NOW - 6 * DAY_MS - 23 * 60 * 60 * 1000); // 6d23h
      writePermissionWatermark(store, snapshotAt.toISOString());

      const state = permissionWatermarkState(store, { now: new Date(NOW) });
      expect(state.mode).toBe("fresh");
      expect(state.reason).toBeNull();
      expect(state.snapshotAt).toEqual(snapshotAt);
      expect(state.asOf).toBe(snapshotAt.toISOString());

      // The writePolicy gate: writable, local queueing allowed.
      const policy = offlineWritePolicy(state);
      expect(policy).toEqual({
        mode: "writable",
        localWriteCaching: true,
        onlineRequiredForWrites: false,
        reason: "FRESH",
        asOf: snapshotAt.toISOString(),
      });
      expect(canWriteOffline(policy, false)).toBe(true);
      expect(canWriteOffline(policy, true)).toBe(true);
    } finally {
      store.close();
    }
  });

  it("exactly 7 days is STILL fresh; 7 days + 1 s → 'stale' SNAPSHOT_EXPIRED → read-only + online-required-for-writes", () => {
    const store: MobileStore = openPersonalStore(tempDbPath("boundary"));
    try {
      // Exactly 7 days (the sync-core `ageDays > 7` boundary — strictly
      // greater; the desktop unlock's boundary ported).
      writePermissionWatermark(store, String(NOW - SNAPSHOT_WATERMARK_MS));
      expect(permissionWatermarkState(store, { now: new Date(NOW) }).mode).toBe("fresh");

      // One second past the window.
      const staleAt = new Date(NOW - SNAPSHOT_WATERMARK_MS - 1000);
      writePermissionWatermark(store, String(staleAt.getTime()));
      const state = permissionWatermarkState(store, { now: new Date(NOW) });
      expect(state).toEqual({
        mode: "stale",
        reason: "SNAPSHOT_EXPIRED",
        snapshotAt: staleAt,
        asOf: staleAt.toISOString(),
      });

      // The writePolicy gate: read-only, NO local queueing, writes
      // require connectivity (§5.3 — cached reads viewable; every
      // write needs live authorization).
      const policy = offlineWritePolicy(state);
      expect(policy).toEqual({
        mode: "read-only",
        localWriteCaching: false,
        onlineRequiredForWrites: true,
        reason: "SNAPSHOT_EXPIRED",
        asOf: staleAt.toISOString(),
      });
      // A write WITH connectivity goes through the live path; offline
      // it is refused (the honest degradation — the snapshot gates UI
      // only, the server stays final on every push, §5.2).
      expect(canWriteOffline(policy, true)).toBe(true);
      expect(canWriteOffline(policy, false)).toBe(false);
    } finally {
      store.close();
    }
  });

  it("no snapshot at all (never pulled) → 'stale' NO_SNAPSHOT + as-of null — the desktop D-04 semantics (the 022 client is always-permissions-fed)", () => {
    const store = openFieldStore(tempDbPath("never-pulled"));
    try {
      const state = permissionWatermarkState(store, { now: new Date(NOW) });
      expect(state).toEqual({
        mode: "stale",
        reason: "NO_SNAPSHOT",
        snapshotAt: null,
        asOf: null,
      });
      const policy = offlineWritePolicy(state);
      expect(policy.mode).toBe("read-only");
      expect(policy.reason).toBe("NO_SNAPSHOT");
      expect(policy.asOf).toBeNull();
      expect(policy.localWriteCaching).toBe(false);
    } finally {
      store.close();
    }
  });

  it("the watermark rides meta `permissionSnapshotAt` (the sync-core applier contract — ISO, epoch ms, and numeric-string all accepted) and the constant is 7 days", () => {
    const store = openFieldStore(tempDbPath("formats"));
    try {
      expect(SNAPSHOT_WATERMARK_MS).toBe(7 * DAY_MS);

      // ISO 8601 (the permissions-feed payload shape).
      writePermissionWatermark(store, new Date(NOW - DAY_MS).toISOString());
      expect(metaGet(store, "permissionSnapshotAt")).toBe(String(NOW - DAY_MS)); // normalized to epoch ms
      expect(permissionWatermarkState(store, { now: new Date(NOW) }).mode).toBe("fresh");

      // A numeric-string epoch (hand-written meta — accepted like the
      // desktop normalizeSnapshotAtMs).
      store.run("UPDATE meta SET value = ? WHERE key = 'permissionSnapshotAt'", [
        String(NOW - 8 * DAY_MS),
      ]);
      expect(permissionWatermarkState(store, { now: new Date(NOW) }).reason).toBe("SNAPSHOT_EXPIRED");

      // Unparseable junk → the honest NO_SNAPSHOT verdict (fail closed).
      store.run("UPDATE meta SET value = ? WHERE key = 'permissionSnapshotAt'", ["not-a-date"]);
      expect(permissionWatermarkState(store, { now: new Date(NOW) }).reason).toBe("NO_SNAPSHOT");
    } finally {
      store.close();
    }
  });
});
