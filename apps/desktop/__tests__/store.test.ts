import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, assertWritable, metaGet, metaSet } from "@erp/sync-core";

import {
  createDesktopStore,
  openDesktopStore,
  SqlCipherUnavailableError,
} from "../src/store";

/**
 * PHASE-021 · the desktop store core suite (MASTER-PLAN §3; DR-P21-02;
 * LOCAL_DATABASE §2/§4): REAL SQLite files in temp dirs — pragmas, the
 * full v1→v5 boot chain, meta seed honesty, the StorageAdapter contract,
 * the dual-profile open, and connection hygiene. No mocks anywhere: the
 * whole point is the real file DB.
 */

const workDirs: string[] = [];
function tempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-desktop-store-"));
  workDirs.push(dir);
  return join(dir, `${prefix}.sqlite`);
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

/** Whether THIS better-sqlite3 build carries SQLCipher (the stock build
 * does not — verified: PRAGMA cipher_version returns no row). The cipher
 * assertions branch per build so the suite is honest on the Windows CI
 * SQLCipher profile too. */
const cipherBuildSupported = (() => {
  const probe = new Database(":memory:");
  const version = probe.pragma("cipher_version", { simple: true });
  probe.close();
  return typeof version === "string" && version.length > 0;
})();

function migrationVersions(path: string): number[] {
  const store = openDesktopStore({ path });
  try {
    return store
      .all("SELECT version FROM schema_migrations ORDER BY version")
      .map((row) => Number(row.version));
  } finally {
    store.close();
  }
}

describe("createDesktopStore — pragmas + info (MASTER-PLAN §3)", () => {
  it("opens WAL + foreign_keys (asserted via PRAGMA reads through the adapter)", () => {
    const store = openDesktopStore({ path: tempDbPath("pragmas") });
    try {
      expect(store.get("PRAGMA journal_mode")?.journal_mode).toBe("wal");
      expect(store.get("PRAGMA foreign_keys")?.foreign_keys).toBe(1);
      expect(store.info.profile).toBe("standard");
      expect(store.info.cipherVersion).toBeNull();
      // better-sqlite3 ships SQLITE_ENABLE_DBSTAT_VTAB — verified live,
      // so tableBytes measures exact dbstat pages on this build.
      expect(store.info.byteMeasurement).toBe("dbstat");
      expect(store.isOpen).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("full boot — migrations v1→v5 (LOCAL_DATABASE §2)", () => {
  it("schema_migrations contains 1,2,3,4,5 exactly once; re-runs are idempotent", () => {
    const path = tempDbPath("boot");
    expect(migrationVersions(path)).toEqual([1, 2, 3, 4, 5]);
    // Re-open + re-run BOTH appliers: no duplicates, no clobbering.
    const store = openDesktopStore({ path });
    try {
      applyMigrations(store);
      expect(store.all("SELECT version FROM schema_migrations ORDER BY version").map((r) => Number(r.version)))
        .toEqual([1, 2, 3, 4, 5]);
      // The desktop tables all exist (v4) and start empty.
      for (const table of ["sales_invoices", "quotations", "delivery_notes", "stock_counts", "draft_docs", "local_events"]) {
        expect(store.countRows(table)).toBe(0);
      }
    } finally {
      store.close();
    }
    expect(migrationVersions(path)).toEqual([1, 2, 3, 4, 5]);
  });

  it("v5 meta seeds are present and a re-apply NEVER clobbers runtime values", () => {
    const store = openDesktopStore({ path: tempDbPath("meta-seeds") });
    try {
      expect(metaGet(store, "deviceClass")).toBe("tauri-desktop");
      expect(metaGet(store, "contractVersion")).toBe("2026-11-04.1");
      // "0" = never pulled a snapshot — the D-04 watermark treats ≤ 0 as
      // "not tracked": the fresh store stays writable pre-first-pull.
      expect(metaGet(store, "permissionSnapshotAt")).toBe("0");
      expect(metaGet(store, "enrolledDeviceId")).toBe("");
      expect(metaGet(store, "rolloutChannel")).toBe("stable");
      expect(() => assertWritable(store)).not.toThrow();

      // Runtime writes real values (a status call, enrollment, a pull)…
      metaSet(store, "contractVersion", "2030-01-01.9");
      metaSet(store, "enrolledDeviceId", "21212121-1111-4111-8111-111111111111");
      metaSet(store, "permissionSnapshotAt", String(Date.now()));
      applyMigrations(store); // re-run the whole chain
      // …and the INSERT OR IGNORE seeds must not roll any of it back.
      expect(metaGet(store, "contractVersion")).toBe("2030-01-01.9");
      expect(metaGet(store, "enrolledDeviceId")).toBe("21212121-1111-4111-8111-111111111111");
      expect(metaGet(store, "deviceClass")).toBe("tauri-desktop");
    } finally {
      store.close();
    }
  });
});

describe("StorageAdapter contract (sync-core consumed verbatim)", () => {
  it("transaction atomicity: a throw inside rolls back EVERYTHING; nesting commits with the outer", () => {
    const store = openDesktopStore({ path: tempDbPath("tx") });
    try {
      expect(() =>
        store.transaction(() => {
          store.run(
            "INSERT INTO items (id, sku, name, kind, status, dirty) VALUES (?, ?, ?, ?, ?, ?)",
            ["i-2", "S2", "Item 2", "STOCK", "ACTIVE", 0],
          );
          throw new Error("boom-mid-transaction");
        }),
      ).toThrow("boom-mid-transaction");
      expect(store.countRows("items")).toBe(0);

      store.transaction(() => {
        store.run(
          "INSERT INTO items (id, sku, name, kind, status, dirty) VALUES (?, ?, ?, ?, ?, ?)",
          ["i-3", "S3", "Item 3", "STOCK", "ACTIVE", 0],
        );
        // Nested transaction (the sync-core engine calls adapter.transaction
        // from inside caller transactions) — savepoint semantics.
        store.transaction(() => {
          store.run(
            "INSERT INTO items (id, sku, name, kind, status, dirty) VALUES (?, ?, ?, ?, ?, ?)",
            ["i-4", "S4", "Item 4", "STOCK", "ACTIVE", 0],
          );
        });
      });
      expect(store.countRows("items")).toBe(2);
    } finally {
      store.close();
    }
  });

  it("run/all/get round-trip: null params, boolean normalization, absent row → undefined", () => {
    const store = openDesktopStore({ path: tempDbPath("roundtrip") });
    try {
      // null param lands as SQL NULL; boolean binds normalize to 0/1.
      store.run(
        "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["i-1", "SKU-1", "Item 1", "STOCK", "ACTIVE", null, false, 1],
      );
      const row = store.get("SELECT * FROM items WHERE id = ?", ["i-1"]);
      expect(row?.name).toBe("Item 1");
      expect(row?.updated_at).toBeNull();
      expect(row?.dirty).toBe(0);
      expect(store.get("SELECT * FROM items WHERE id = ?", ["missing"])).toBeUndefined();
      expect(store.all("SELECT id FROM items ORDER BY id")).toEqual([{ id: "i-1" }]);
      // The outbox CHECK-bearing DDL round-trips too (draft_docs statuses).
      store.run(
        "INSERT INTO draft_docs (local_id, doc_type, payload, updated_at) VALUES (?, ?, ?, ?)",
        ["d-1", "sales_invoice", "{}", "2026-11-04T00:00:00Z"],
      );
      expect(String(store.get("SELECT * FROM draft_docs WHERE local_id = ?", ["d-1"])?.local_status)).toBe(
        "DRAFT_LOCAL",
      );
    } finally {
      store.close();
    }
  });
});

describe("dual-profile open (DR-P21-02)", () => {
  it("no encryptionKey → standard profile (plain SQLite, honest info)", () => {
    const store = createDesktopStore({ path: tempDbPath("no-key") });
    try {
      expect(store.info.profile).toBe("standard");
      expect(store.info.cipherVersion).toBeNull();
    } finally {
      store.close();
    }
  });

  it("encryptionKey + explicit profile 'standard' → plain file; the key NEVER reaches the file bytes (secret-scan)", () => {
    const path = tempDbPath("std-fallback");
    const key = "keychain-dbKey-Δ-secret-4f7a2b91";
    const store = openDesktopStore({ path, encryptionKey: key, profile: "standard" });
    try {
      expect(store.info.profile).toBe("standard");
      store.run(
        "INSERT INTO items (id, sku, name, kind, status, dirty) VALUES (?, ?, ?, ?, ?, ?)",
        ["secret-probe-item", "SKU-X", "plaintext probe", "STOCK", "ACTIVE", 0],
      );
    } finally {
      store.close();
    }
    const raw = readFileSync(path);
    // The sandbox/CI fallback profile is a PLAIN file — asserted, not assumed.
    expect(raw.subarray(0, 15).toString("latin1")).toBe("SQLite format 3");
    expect(raw.toString("utf8").includes("plaintext probe")).toBe(true);
    // The invariant that holds on EVERY profile: no key material at rest.
    expect(raw.includes(Buffer.from(key, "utf8"))).toBe(false);
  });

  it("encryptionKey on the stock build FAILS CLOSED unless profile 'standard' is explicit (cipher/auto)", () => {
    if (!cipherBuildSupported) {
      expect(() =>
        createDesktopStore({ path: tempDbPath("cipher-req"), encryptionKey: "k", profile: "cipher" }),
      ).toThrow(SqlCipherUnavailableError);
      expect(() => createDesktopStore({ path: tempDbPath("auto-req"), encryptionKey: "k" })).toThrow(
        SqlCipherUnavailableError,
      );
    } else {
      // The Windows CI SQLCipher build: the cipher profile opens for real
      // and the file is NOT plaintext (D-02 at-rest inspection).
      const path = tempDbPath("cipher-build");
      const store = openDesktopStore({ path, encryptionKey: "k", profile: "cipher" });
      expect(store.info.profile).toBe("cipher");
      expect(typeof store.info.cipherVersion).toBe("string");
      store.close();
      expect(readFileSync(path).subarray(0, 15).toString("latin1")).not.toBe("SQLite format 3");
    }
  });

  it("profile 'cipher' without an encryptionKey is a loud configuration error", () => {
    expect(() => createDesktopStore({ path: tempDbPath("cipher-nokey"), profile: "cipher" })).toThrow(
      SqlCipherUnavailableError,
    );
  });

  it("an empty encryptionKey is a keychain misconfiguration, never a silent plain file", () => {
    expect(() => createDesktopStore({ path: tempDbPath("empty-key"), encryptionKey: "" })).toThrow(
      /encryptionKey must be non-empty/,
    );
  });
});

describe("connection hygiene", () => {
  it("close() is idempotent; operations on a closed store refuse loudly", () => {
    const store = createDesktopStore({ path: tempDbPath("hygiene") });
    expect(store.isOpen).toBe(true);
    store.close();
    expect(store.isOpen).toBe(false);
    expect(() => store.run("SELECT 1")).toThrow(/closed/);
    expect(() => store.all("SELECT 1")).toThrow(/closed/);
    expect(() => store.get("SELECT 1")).toThrow(/closed/);
    expect(() => store.transaction(() => undefined)).toThrow(/closed/);
    expect(() => store.countRows("items")).toThrow(/closed/);
    expect(() => store.deleteOldestSynced("items", 1)).toThrow(/closed/);
    expect(() => store.tableBytes("items")).toThrow(/closed/);
    store.close(); // idempotent
    expect(store.isOpen).toBe(false);
  });
});
