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
  openFieldStore,
  openPersonalStore,
  readStagedSurvivors,
  recoverCorruptStore,
  type MobileStore,
} from "../src/store";

/**
 * PHASE-022 · the LOCAL_DATABASE §6.4 corruption drill suite (T2-a;
 * MASTER-PLAN §7), ported from the proven @erp/desktop drill: `PRAGMA
 * integrity_check` verdicts on REAL corrupt files (page corruption AND
 * a destroyed header), the stage → delete → recreate → re-import →
 * cursors-reset recovery with survivors preserved for BOTH profiles,
 * the honest partial path, the personal drill (cursors staged, read
 * models disposable), and the loud unrecoverable failures. Recorded
 * probe facts the tests rely on (the desktop drill's): appended
 * trailing garbage is IGNORED by integrity_check (a middle-page write
 * is the corruption that trips it), and a destroyed header makes even
 * the open pragmas throw — that open failure is the caller's cue to go
 * straight to recovery.
 */

const workDirs: string[] = [];
function tempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-mobile-corrupt-"));
  workDirs.push(dir);
  return join(dir, `${prefix}.sqlite`);
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

/** Seed the FIELD store so the drill has precious rows to save: 5 real
 * outbox commands (through the sync-core engine — the production
 * writer), one inbox mirror row, one cursor. The 300 fat van_stocks
 * rows go FIRST so the cache data pages sit at the END of the file —
 * corrupting the last page then hits disposable cache data, never the
 * machinery pages. */
function seedFieldForDrill(path: string): string[] {
  const store = openFieldStore(path);
  const commandIds: string[] = [];
  try {
    store.transaction(() => {
      for (let i = 0; i < 300; i += 1) {
        store.run(
          "INSERT INTO van_stocks (id, warehouse_id, item_id, qty, value, payload, version, updated_at, dirty) VALUES (?, 'wh-1', 'item-1', '1.000000', '1.0000', ?, 1, ?, 0)",
          [
            `vs-${String(i).padStart(4, "0")}`,
            `Item ${i} ${"x".repeat(2000)}`,
            new Date(1_760_000_000_000 + i * 60_000).toISOString(),
          ],
        );
      }
      for (let i = 0; i < 5; i += 1) {
        const row = enqueue(store, {
          entityType: "pos_sale",
          intent: "create",
          payload: { n: i },
          idempotencyKey: `mobile-drill-${i}`,
        });
        commandIds.push(row.commandId);
      }
      store.run("INSERT INTO inbox (command_id, processed_at) VALUES (?, ?)", ["cmd-inbox-1", 1]);
      store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('van_stocks', '42', 0)");
    });
  } finally {
    store.close();
  }
  return commandIds;
}

/** Seed the PERSONAL store: read-model rows + a cursor (the profile's
 * only sync state; there is no outbox to stage — DR-P22-08b). */
function seedPersonalForDrill(path: string): void {
  const store = openPersonalStore(path);
  try {
    store.transaction(() => {
      store.run(
        "INSERT INTO statements (id, customer_code, customer_name, opening_balance, payload, updated_at) VALUES (?, 'P-1', 'Partner 1', '10.0000', '{}', '2026-11-04T00:00:00Z')",
        ["partner-1"],
      );
      store.run(
        "INSERT INTO notifications (id, user_id, category, severity, title, body, payload, updated_at) VALUES ('n-1', 'u-1', 'limits', 'info', '{}', '{}', '{}', '2026-11-04T00:00:00Z')",
      );
      store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('statements', '7', 0)");
    });
  } finally {
    store.close();
  }
}

/** Corrupt the LAST page of the (closed, checkpointed) DB file — page
 * size multiples hold after a clean close, and the trailing pages
 * belong to the fat cache table, so the machinery pages stay readable. */
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
  it("a healthy field store verdicts ok", () => {
    const path = tempDbPath("healthy");
    seedFieldForDrill(path);
    const store = openFieldStore(path);
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
    seedFieldForDrill(path);
    corruptLastPage(path);
    const store = openFieldStore(path); // header intact → opens
    try {
      const verdict = integrityCheck(store);
      expect(verdict.ok).toBe(false);
      expect(verdict.detail.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  it("a closed store refuses the check loudly", () => {
    const store = openFieldStore(tempDbPath("closed-check"));
    store.close();
    expect(() => integrityCheck(store)).toThrow(/closed/);
  });
});

describe("recoverCorruptStore — the §6.4 drill (field profile)", () => {
  it("stages survivors, recreates, re-imports, resets cursors + the full-pull flag — the next recoveryPass is clean", () => {
    const path = tempDbPath("drill");
    const commandIds = seedFieldForDrill(path);
    corruptLastPage(path);

    const reopened = openFieldStore(path);
    const verdict = integrityCheck(reopened);
    expect(verdict.ok).toBe(false);

    const result = recoverCorruptStore({ path, profile: "field", store: reopened, integrityDetail: verdict.detail });
    expect(reopened.isOpen).toBe(false); // the drill closed the corrupt handle
    expect(result.partial).toBe(false);
    expect(result.stagedOutbox).toBe(5);
    expect(result.stagedInbox).toBe(1);
    expect(result.stagedCursors).toBe(1);
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
      expect(fresh.countRows("van_stocks")).toBe(0);
      // Cursors emptied for the full re-pull + the checksums maintained.
      expect(fresh.all("SELECT * FROM cursors")).toHaveLength(0);
      expect(metaGet(fresh, "cursorCount")).toBe("0");
      expect(metaGet(fresh, "inboxCount")).toBe("1");
      expect(metaGet(fresh, "quarantineRecoveryAt")).toBe(result.quarantineRecoveryAt);
      // The explicit full-pull flag (the host clears it after the next
      // successful cycle).
      expect(metaGet(fresh, "fullPullPending")).toBe("true");
      expect(result.fullPullPending).toBe("true");
      // The full migration chain re-ran on the fresh file.
      expect(
        fresh.all("SELECT version FROM schema_migrations ORDER BY version").map((r) => Number(r.version)),
      ).toEqual([1, 2, 3, 4, 5]);
      // Consistent store: the next boot recovery pass sees NO mismatch.
      const recovery = recoveryPass(fresh);
      expect(recovery.integrity).toBe("ok");
      expect(recovery.recoveredInFlight).toBe(0);
    } finally {
      fresh.close();
    }
  });

  it("partial path: a destroyed header stages an empty manifest with partial:true — recovery still proceeds", () => {
    const path = tempDbPath("partial");
    seedFieldForDrill(path);
    // Trash the ENTIRE file — recorded probe fact: even the open pragmas
    // throw ("file is not a database"), so boot goes straight to recovery.
    const size = readFileSync(path).length;
    writeFileSync(path, Buffer.alloc(size, 0x41));
    expect(() => openFieldStore(path)).toThrow();

    const result = recoverCorruptStore({ path, profile: "field", integrityDetail: "file is not a database" });
    expect(result.partial).toBe(true);
    expect(result.stagedOutbox).toBe(0);
    expect(result.reimportedOutbox).toBe(0);
    const manifest = readStagedSurvivors(result.stagingFile);
    expect(manifest.partial).toBe(true);
    expect(manifest.profile).toBe("field");
    expect(manifest.outbox).toEqual([]);

    const fresh = result.store;
    try {
      expect(integrityCheck(fresh).ok).toBe(true);
      expect(fresh.all("SELECT * FROM cursors")).toHaveLength(0);
      expect(metaGet(fresh, "cursorCount")).toBe("0");
      expect(metaGet(fresh, "quarantineRecoveryAt")).toBeTruthy();
      expect(metaGet(fresh, "fullPullPending")).toBe("true");
      expect(recoveryPass(fresh).integrity).toBe("ok");
    } finally {
      fresh.close();
    }
  });

  it("unrecoverable: an unwritable staging file throws LocalStoreCorruptError and NEVER deletes the store", () => {
    const path = tempDbPath("staging-blocked");
    seedFieldForDrill(path);
    corruptLastPage(path);
    // A directory where the staging manifest must land → the write fails.
    mkdirSync(`${path}.staging`);
    try {
      expect(() => recoverCorruptStore({ path, profile: "field" })).toThrow(LocalStoreCorruptError);
      // The drill refused BEFORE the destructive step: the file survives.
      expect(existsSync(path)).toBe(true);
    } finally {
      rmSync(`${path}.staging`, { recursive: true, force: true });
    }
  });

  it("a profile mismatch is a loud configuration error (one file, one profile)", () => {
    const path = tempDbPath("profile-mismatch");
    seedFieldForDrill(path);
    corruptLastPage(path);
    const reopened = openFieldStore(path);
    expect(() =>
      recoverCorruptStore({ path, profile: "personal", store: reopened }),
    ).toThrow(/does not match opts.profile/);
    reopened.close();
  });
});

describe("recoverCorruptStore — the §6.4 drill (personal profile, DR-P22-08b)", () => {
  it("stages the cursors (the only sync state), drops the read models, sets the full-pull flag", () => {
    const path = tempDbPath("personal-drill");
    seedPersonalForDrill(path);
    corruptLastPage(path);

    const reopened = openPersonalStore(path);
    const verdict = integrityCheck(reopened);
    expect(verdict.ok).toBe(false);

    const result = recoverCorruptStore({ path, profile: "personal", store: reopened, integrityDetail: verdict.detail });
    expect(reopened.isOpen).toBe(false);
    expect(result.partial).toBe(false);
    expect(result.stagedOutbox).toBe(0); // no outbox exists — honest zeros
    expect(result.stagedInbox).toBe(0);
    expect(result.stagedCursors).toBe(1);

    const fresh = result.store as MobileStore;
    try {
      expect(integrityCheck(fresh).ok).toBe(true);
      // The disposable read models were dropped with the corrupt file.
      expect(fresh.countRows("statements")).toBe(0);
      expect(fresh.countRows("notifications")).toBe(0);
      // Cursors reset for the full re-pull; the checksum maintained.
      expect(fresh.all("SELECT * FROM cursors")).toHaveLength(0);
      expect(metaGet(fresh, "cursorCount")).toBe("0");
      // The full-pull flag is set for the personal profile too.
      expect(metaGet(fresh, "fullPullPending")).toBe("true");
      // The personal chain re-ran on the fresh file.
      expect(
        fresh.all("SELECT version FROM schema_migrations ORDER BY version").map((r) => Number(r.version)),
      ).toEqual([1, 2]);
      // And the recreated file is still personal: no outbox table.
      expect(
        fresh.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outbox'"),
      ).toBeUndefined();
    } finally {
      fresh.close();
    }
  });
});
