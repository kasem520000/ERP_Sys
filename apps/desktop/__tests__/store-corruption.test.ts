import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalStoreCorruptError, enqueue, metaGet, recoveryPass } from "@erp/sync-core";

import {
  integrityCheck,
  openDesktopStore,
  readStagedSurvivors,
  recoverCorruptStore,
} from "../src/store";

/**
 * PHASE-021 · the LOCAL_DATABASE §6.4 corruption drill suite (MASTER-PLAN
 * §3; PHASE-021 T2): `PRAGMA integrity_check` verdicts on REAL corrupt
 * files (page corruption AND a destroyed header), the stage → delete →
 * recreate → re-import → cursors-reset recovery with survivors preserved,
 * the honest partial path, and the loud unrecoverable failures. Recorded
 * probe facts the tests rely on: appended trailing garbage is IGNORED by
 * integrity_check (a middle-page write is the corruption that trips it),
 * and a destroyed header makes even `PRAGMA journal_mode` throw — that
 * open failure is the caller's cue to go straight to recovery.
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

/** Seed the store so the drill has precious rows to save: 5 real outbox
 * commands (through the sync-core engine — the production writer), one
 * inbox mirror row, one cursor. The 300 fat items rows go FIRST so the
 * items data pages sit at the END of the file — corrupting the last page
 * then hits disposable cache data, never the machinery pages. */
function seedForDrill(path: string): string[] {
  const store = openDesktopStore({ path });
  const commandIds: string[] = [];
  try {
    store.transaction(() => {
      for (let i = 0; i < 300; i += 1) {
        store.run(
          "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
          [
            `item-${String(i).padStart(4, "0")}`,
            `SKU-${i}`,
            `Item ${i} ${"x".repeat(2000)}`,
            "STOCK",
            "ACTIVE",
            new Date(1_760_000_000_000 + i * 60_000).toISOString(),
            0,
          ],
        );
      }
      for (let i = 0; i < 5; i += 1) {
        const row = enqueue(store, {
          entityType: "pos_sale",
          intent: "create",
          payload: { n: i },
          idempotencyKey: `corruption-drill-${i}`,
        });
        commandIds.push(row.commandId);
      }
      store.run("INSERT INTO inbox (command_id, processed_at) VALUES (?, ?)", ["cmd-inbox-1", 1]);
      store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('items', '42', 0)");
    });
  } finally {
    store.close();
  }
  return commandIds;
}

/** Corrupt the LAST page of the (closed, checkpointed) DB file — page
 * size multiples hold after a clean close, and the trailing pages belong
 * to the fat items table, so the machinery pages stay readable. */
function corruptLastPage(path: string): void {
  const size = readFileSync(path).length;
  expect(size % 4096).toBe(0); // clean close → checkpointed whole pages
  const fd = openSync(path, "r+");
  try {
    const garbage = Buffer.alloc(512, 0xff);
    writeSync(fd, garbage, 0, garbage.length, size - 4096);
  } finally {
    closeSync(fd);
  }
}

describe("integrityCheck (LOCAL_DATABASE §6.4)", () => {
  it("a healthy store verdicts ok", () => {
    const path = tempDbPath("healthy");
    seedForDrill(path);
    const store = openDesktopStore({ path });
    try {
      const verdict = integrityCheck(store);
      expect(verdict.ok).toBe(true);
      expect(verdict.detail).toBe("ok");
    } finally {
      store.close();
    }
  });

  it("a corrupted page verdicts NOT ok (the pragma throw IS the verdict)", () => {
    const path = tempDbPath("page-corrupt");
    seedForDrill(path);
    corruptLastPage(path);
    const store = openDesktopStore({ path }); // header intact → opens
    try {
      const verdict = integrityCheck(store);
      expect(verdict.ok).toBe(false);
      expect(verdict.detail.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});

describe("recoverCorruptStore — the §6.4 drill", () => {
  it("stages survivors, recreates, re-imports, resets cursors — and the next recoveryPass is clean", () => {
    const path = tempDbPath("drill");
    const commandIds = seedForDrill(path);
    corruptLastPage(path);

    const reopened = openDesktopStore({ path });
    const verdict = integrityCheck(reopened);
    expect(verdict.ok).toBe(false);

    const result = recoverCorruptStore({ path, store: reopened, integrityDetail: verdict.detail });
    expect(reopened.isOpen).toBe(false); // the drill closed the corrupt handle
    expect(result.partial).toBe(false);
    expect(result.stagedOutbox).toBe(5);
    expect(result.stagedInbox).toBe(1);
    expect(result.reimportedOutbox).toBe(5); // every survivor landed
    expect(result.reimportedInbox).toBe(1);
    expect(existsSync(result.stagingFile)).toBe(true); // kept for audit/salvage

    const fresh = result.store;
    try {
      expect(fresh.isOpen).toBe(true);
      expect(integrityCheck(fresh).ok).toBe(true);
      // The precious outbox rows came back whole (payload + status).
      const outboxIds = fresh.all("SELECT command_id FROM outbox").map((r) => String(r.command_id));
      expect(outboxIds).toEqual(expect.arrayContaining(commandIds));
      const row = fresh.get("SELECT * FROM outbox WHERE command_id = ?", [commandIds[0]!]);
      expect(row?.status).toBe("QUEUED");
      expect(String(row?.payload)).toContain('"n":0');
      // The disposable read cache was dropped with the corrupt file.
      expect(fresh.countRows("items")).toBe(0);
      // Cursors emptied for the full re-pull + the checksums maintained.
      expect(fresh.all("SELECT * FROM cursors")).toHaveLength(0);
      expect(metaGet(fresh, "cursorCount")).toBe("0");
      expect(metaGet(fresh, "inboxCount")).toBe("1");
      expect(metaGet(fresh, "quarantineRecoveryAt")).toBe(result.quarantineRecoveryAt);
      // The full migration chain re-ran on the fresh file.
      expect(
        fresh.all("SELECT version FROM schema_migrations ORDER BY version").map((r) => Number(r.version)),
      ).toEqual([1, 2, 3, 4, 5]);
      // Consistent store: the W2 boot recovery pass sees NO mismatch.
      const recovery = recoveryPass(fresh);
      expect(recovery.integrity).toBe("ok");
      expect(recovery.recoveredInFlight).toBe(0);
    } finally {
      fresh.close();
    }
  });

  it("partial path: a destroyed header stages an empty manifest with partial:true — recovery still proceeds", () => {
    const path = tempDbPath("partial");
    seedForDrill(path);
    // Trash the ENTIRE file — recorded probe fact: even the open pragmas
    // throw ("file is not a database"), so boot goes straight to recovery.
    const size = readFileSync(path).length;
    writeFileSync(path, Buffer.alloc(size, 0x41));
    expect(() => openDesktopStore({ path })).toThrow();

    const result = recoverCorruptStore({ path, integrityDetail: "file is not a database" });
    expect(result.partial).toBe(true);
    expect(result.stagedOutbox).toBe(0);
    expect(result.reimportedOutbox).toBe(0);
    const manifest = readStagedSurvivors(result.stagingFile);
    expect(manifest.partial).toBe(true);
    expect(manifest.outbox).toEqual([]);

    const fresh = result.store;
    try {
      expect(integrityCheck(fresh).ok).toBe(true);
      expect(fresh.all("SELECT * FROM cursors")).toHaveLength(0);
      expect(metaGet(fresh, "cursorCount")).toBe("0");
      expect(metaGet(fresh, "quarantineRecoveryAt")).toBeTruthy();
      expect(recoveryPass(fresh).integrity).toBe("ok");
    } finally {
      fresh.close();
    }
  });

  it("unrecoverable: an unwritable staging file throws LocalStoreCorruptError and NEVER deletes the store", () => {
    const path = tempDbPath("staging-blocked");
    seedForDrill(path);
    corruptLastPage(path);
    // A directory where the staging manifest must land → the write fails.
    mkdirSync(`${path}.staging`);
    try {
      expect(() => recoverCorruptStore({ path })).toThrow(LocalStoreCorruptError);
      // The drill refused BEFORE the destructive step: the file survives.
      expect(existsSync(path)).toBe(true);
    } finally {
      rmSync(`${path}.staging`, { recursive: true, force: true });
    }
  });

  it("recreation failure (cipher requested without the keychain key) wraps as LocalStoreCorruptError", () => {
    const path = tempDbPath("recreate-fail");
    seedForDrill(path);
    expect(() => recoverCorruptStore({ path, profile: "cipher" })).toThrow(LocalStoreCorruptError);
  });

  it("the standard-with-key fallback profile recovers with its profile preserved and the key still never at rest", () => {
    const path = tempDbPath("recover-std-key");
    const key = "std-fallback-key-9d3f6a";
    const store = openDesktopStore({ path, encryptionKey: key, profile: "standard" });
    const commandIds: string[] = [];
    try {
      commandIds.push(
        enqueue(store, {
          entityType: "pos_sale",
          intent: "create",
          payload: { guard: true },
          idempotencyKey: "std-key-recovery-1",
        }).commandId,
      );
    } finally {
      store.close();
    }
    corruptLastPage(path);

    const reopened = openDesktopStore({ path, encryptionKey: key, profile: "standard" });
    expect(integrityCheck(reopened).ok).toBe(false);
    const result = recoverCorruptStore({ path, store: reopened, encryptionKey: key });
    expect(result.store.info.profile).toBe("standard"); // carried from the open store
    expect(result.reimportedOutbox).toBe(1);
    const outboxIds = result.store.all("SELECT command_id FROM outbox").map((r) => String(r.command_id));
    expect(outboxIds).toEqual(commandIds);
    result.store.close();
    // DR-P21-02 invariant on the RECREATED file too: no key material at rest.
    const raw = readFileSync(path);
    expect(raw.includes(Buffer.from(key, "utf8"))).toBe(false);
    // The staging manifest never carries the key either.
    expect(readFileSync(result.stagingFile, "utf8").includes(key)).toBe(false);
  });
});
