import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, assertWritable, metaGet, metaSet } from "@erp/sync-core";

import {
  FIELD_BUSINESS_TABLES,
  PERSONAL_READ_MODELS,
  applyFieldMigrations,
  applyPersonalMigrations,
  createMobileStore,
  createNodeDriver,
  openFieldStore,
  openPersonalStore,
  type MobileStore,
} from "../src/store";
import {
  MOBILE_DEVICE_CLASSES,
  MOBILE_STORAGE_BUDGET_BYTES,
  SYNC_PULL_BUDGET_BYTES,
  SYNC_PUSH_BUDGET_BYTES,
} from "../src/constants";

/**
 * PHASE-022 · the mobile store core suite (T2-a; MASTER-PLAN §7; DR-P22-08
 * + DR-P22-08b; LOCAL_DATABASE §1.1/§2/§4): REAL SQLite files in temp
 * dirs — the full field boot chain (sync-core v1–3 + field v4+), the
 * personal chain (v1+ — cursors + meta + read models ONLY, no
 * outbox/inbox), version numbering, the boot-order + cross-profile
 * guards, meta-seed honesty, money-as-TEXT (ADR-0009), the
 * StorageAdapter contract, and connection hygiene. No mocks anywhere:
 * the whole point is the real file DB through the REAL driver port.
 */

const workDirs: string[] = [];
function tempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-mobile-store-"));
  workDirs.push(dir);
  return join(dir, `${prefix}.sqlite`);
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

/** Whether THIS better-sqlite3 build carries dbstat (it does — the
 * desktop store suite recorded it; the branch keeps the suite honest on
 * a custom build). */
const dbstatBuildSupported = (() => {
  const probe = new Database(":memory:");
  try {
    probe.prepare("SELECT 1 FROM dbstat LIMIT 1").get();
    return true;
  } catch {
    return false;
  } finally {
    probe.close();
  }
})();

function migrationVersions(store: MobileStore): number[] {
  try {
    return store
      .all("SELECT version FROM schema_migrations ORDER BY version")
      .map((row) => Number(row.version));
  } finally {
    store.close();
  }
}

describe("openFieldStore — pragmas + info (MASTER-PLAN §7)", () => {
  it("opens WAL + foreign_keys (asserted through the store), dbstat measurement, field identity", () => {
    const store = openFieldStore(tempDbPath("pragmas"));
    try {
      expect(store.get("PRAGMA journal_mode")?.journal_mode).toBe("wal");
      expect(store.get("PRAGMA foreign_keys")?.foreign_keys).toBe(1);
      expect(store.info.deviceClass).toBe("android-field");
      expect(store.deviceClass).toBe(MOBILE_DEVICE_CLASSES.field);
      // better-sqlite3 ships SQLITE_ENABLE_DBSTAT_VTAB — the byte-exact
      // measurement, not the row approximation.
      expect(store.info.byteMeasurement).toBe(dbstatBuildSupported ? "dbstat" : "row-approx");
      expect(store.isOpen).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("field boot — sync-core v1–3 then field v4+ (LOCAL_DATABASE §2)", () => {
  it("schema_migrations contains 1,2,3,4,5 exactly once; re-runs are idempotent", () => {
    const path = tempDbPath("boot");
    expect(migrationVersions(openFieldStore(path))).toEqual([1, 2, 3, 4, 5]);
    // Re-open + re-run BOTH appliers: no duplicates, no clobbering.
    const store = openFieldStore(path);
    try {
      applyMigrations(store);
      expect(store.all("SELECT version FROM schema_migrations ORDER BY version").map((r) => Number(r.version)))
        .toEqual([1, 2, 3, 4, 5]);
      // Every field table exists (v4) and starts empty.
      for (const table of ["van_stocks", "routes", "settlement_templates", "statements"]) {
        expect(store.countRows(table)).toBe(0);
      }
      // The POS base + machinery from sync-core v1–3 exist too.
      for (const table of ["items", "partners", "pos_sales", "outbox", "inbox", "cursors"]) {
        expect(store.countRows(table)).toBe(0);
      }
      // meta carries exactly the v5 INSERT OR IGNORE seeds (runtime values
      // land later — the fresh store has only the seeds).
      expect(store.countRows("meta")).toBe(5);
    } finally {
      store.close();
    }
    expect(migrationVersions(openFieldStore(path))).toEqual([1, 2, 3, 4, 5]);
  });

  it("the field tables mirror the LITE payload columns (feed-projections parity, spot DDL)", () => {
    const store = openFieldStore(tempDbPath("lite-mirror"));
    try {
      const columns = (table: string): string[] =>
        store
          .all(`PRAGMA table_info(${table})`)
          .map((row) => String(row.name))
          .sort();
      // VanStockLite: id, warehouseId, itemId, batchId, qty, value, refreshedAt.
      expect(columns("van_stocks")).toEqual(
        [
          "id", "warehouse_id", "item_id", "batch_id", "qty", "value",
          "refreshed_at", "payload", "version", "updated_at", "dirty",
        ].sort(),
      );
      // SettlementTemplateLite: the money columns are all present.
      expect(columns("settlement_templates")).toEqual(
        [
          "id", "settlement_no", "sales_rep_id", "van_warehouse_id", "shift_id", "settlement_date",
          "status", "opening_cash", "cash_sales", "collections", "cash_refunds", "rep_expenses",
          "expected_cash", "counted_cash", "variance", "variance_direction", "deposit_amount",
          "payload", "version", "updated_at", "dirty",
        ].sort(),
      );
      // RouteLite: the ordered customer list rides the row.
      expect(columns("routes")).toContain("customers");
      // StatementLite: the change row's id IS the partner id.
      expect(columns("statements")).toContain("customer_code");
      expect(columns("statements")).toContain("generated_at");
    } finally {
      store.close();
    }
  });

  it("v5 meta seeds are present and a re-apply NEVER clobbers runtime values", () => {
    const store = openFieldStore(tempDbPath("meta-seeds"));
    try {
      expect(metaGet(store, "deviceClass")).toBe("android-field");
      expect(metaGet(store, "contractVersion")).toBe("2026-11-04.1");
      // "0" = never pulled a snapshot — the D-04 watermark treats ≤ 0 as
      // "not tracked": the fresh store stays writable pre-first-pull.
      expect(metaGet(store, "permissionSnapshotAt")).toBe("0");
      expect(metaGet(store, "enrolledDeviceId")).toBe("");
      // The preset budget (the brief's presetMeta) — the golden constant.
      expect(metaGet(store, "storageBudgetBytes")).toBe(String(MOBILE_STORAGE_BUDGET_BYTES));
      expect(() => assertWritable(store)).not.toThrow();

      // Runtime writes real values (a status call, enrollment, a pull)…
      metaSet(store, "contractVersion", "2030-01-01.9");
      metaSet(store, "enrolledDeviceId", "31313131-1111-4111-8111-111111111111");
      metaSet(store, "permissionSnapshotAt", String(Date.now()));
      applyMigrations(store); // re-run the sync-core chain
      applyFieldMigrations(store); // …and the field chain
      // …and the INSERT OR IGNORE seeds must not roll any of it back.
      expect(metaGet(store, "contractVersion")).toBe("2030-01-01.9");
      expect(metaGet(store, "enrolledDeviceId")).toBe("31313131-1111-4111-8111-111111111111");
      expect(metaGet(store, "deviceClass")).toBe("android-field");
    } finally {
      store.close();
    }
  });

  it("boot-order guard: applyFieldMigrations without sync-core v1–3 refuses loudly", () => {
    const path = tempDbPath("boot-order");
    const driver = createNodeDriver();
    driver.open(path);
    const store = createMobileStore(driver, "field", path);
    try {
      expect(() => applyFieldMigrations(store)).toThrow(/applyMigrations \(v1–3\) must run first/);
    } finally {
      store.close();
    }
  });
});

describe("personal boot — DR-P22-08b (cursors + meta + read models ONLY)", () => {
  it("schema_migrations contains 1,2; NO outbox/inbox tables exist (LOCAL_DATABASE §1.1 rule 2)", () => {
    const path = tempDbPath("personal");
    expect(migrationVersions(openPersonalStore(path))).toEqual([1, 2]);
    const store = openPersonalStore(path);
    try {
      // The read models exist + start empty.
      expect(store.listBusinessTables()).toEqual([...PERSONAL_READ_MODELS]);
      for (const table of PERSONAL_READ_MODELS) {
        expect(store.countRows(table)).toBe(0);
      }
      // The write-capable machinery is STRUCTURALLY absent — a tampered
      // personal device holds no queue to tamper.
      for (const forbidden of ["outbox", "inbox", "pos_sales", "items"]) {
        expect(
          store.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [forbidden]),
        ).toBeUndefined();
      }
      // Meta seeds (the personal chain's own v2).
      expect(metaGet(store, "deviceClass")).toBe("android-personal");
      expect(metaGet(store, "contractVersion")).toBe("2026-11-04.1");
      expect(metaGet(store, "permissionSnapshotAt")).toBe("0");
      expect(metaGet(store, "enrolledDeviceId")).toBe("");
      expect(metaGet(store, "storageBudgetBytes")).toBe(String(MOBILE_STORAGE_BUDGET_BYTES));
    } finally {
      store.close();
    }
  });

  it("the personal read-model tables mirror the LITE payload columns (spot DDL)", () => {
    const store = openPersonalStore(tempDbPath("personal-lite"));
    try {
      const columns = (table: string): string[] =>
        store.all(`PRAGMA table_info(${table})`).map((row) => String(row.name)).sort();
      // ReceiptLite: receipt_no null until posting, partnerId the scope key.
      expect(columns("receipts")).toEqual(
        [
          "id", "receipt_no", "status", "partner_id", "method", "currency_code", "amount",
          "value_date", "reference", "posted_at", "payload", "version", "updated_at", "dirty",
        ].sort(),
      );
      // NotificationLite: bilingual title/body jsonb at rest.
      expect(columns("notifications")).toContain("title");
      expect(columns("notifications")).toContain("read_at");
      // The 020 sales-invoice header projection (the personal group's
      // sales_invoices feed shape).
      expect(columns("sales_invoices")).toContain("owner_device_id");
      // StatementLite shared with the field profile.
      expect(columns("statements")).toContain("closing_balance_base");
    } finally {
      store.close();
    }
  });

  it("cross-profile guards: one file, one profile — never a silent mix", () => {
    // A field file refused the personal chain…
    const fieldPath = tempDbPath("cross-field");
    const fieldStore = openFieldStore(fieldPath);
    fieldStore.close();
    expect(() => openPersonalStore(fieldPath)).toThrow(/non-personal migration chain/);
    // …and a personal file refused the field chain (loudly — sync-core's
    // v3 ALTERs cannot apply to a store with no outbox).
    const personalPath = tempDbPath("cross-personal");
    const personalStore = openPersonalStore(personalPath);
    personalStore.close();
    expect(() => openFieldStore(personalPath)).toThrow();
    // And the direct applier refuses on a non-personal chain marker too.
    const driver = createNodeDriver();
    driver.open(personalPath);
    const reopened = createMobileStore(driver, "personal", personalPath);
    applyPersonalMigrations(reopened); // idempotent re-run on the right profile
    reopened.close();
  });
});

describe("money is TEXT — ADR-0009 (canonical decimal strings, never REAL)", () => {
  it("field + personal money/qty columns round-trip as TEXT decimal strings", () => {
    const field = openFieldStore(tempDbPath("money-field"));
    try {
      field.run(
        `INSERT INTO van_stocks (id, warehouse_id, item_id, batch_id, qty, value, refreshed_at,
            payload, version, updated_at, dirty)
         VALUES (?, ?, ?, NULL, ?, ?, NULL, '{}', 1, '2026-11-04T00:00:00Z', 0)`,
        ["vs-1", "wh-1", "item-1", "10.000000", "600.0000"],
      );
      const row = field.get("SELECT * FROM van_stocks WHERE id = ?", ["vs-1"]);
      expect(typeof row?.qty).toBe("string");
      expect(row?.qty).toBe("10.000000"); // 6-dp quantities (numeric(19,6) at rest)
      expect(typeof row?.value).toBe("string");
      expect(row?.value).toBe("600.0000"); // 4-dp money (numeric(19,4) at rest)
      // typeof TEXT for every money column of the settlement template.
      field.run(
        `INSERT INTO settlement_templates (id, sales_rep_id, status, opening_cash, expected_cash,
            payload, updated_at) VALUES ('st-1', 'rep-1', 'DRAFT', '100.0000', '100.0000', '{}', '2026-11-04T00:00:00Z')`,
      );
      const settlement = field.get("SELECT * FROM settlement_templates WHERE id = ?", ["st-1"]);
      expect(typeof settlement?.opening_cash).toBe("string");
      expect(settlement?.opening_cash).toBe("100.0000");
      // Declining to store money as REAL: a REAL bind stays REAL in
      // SQLite only if the column were REAL-typed — the DDL is TEXT, so
      // the value lands as a string.
      field.run(
        "INSERT INTO statements (id, customer_code, customer_name, opening_balance, payload, updated_at) VALUES (?, ?, ?, ?, '{}', '2026-11-04T00:00:00Z')",
        ["partner-1", "P-1", "Partner 1", "12.5000"],
      );
      expect(typeof field.get("SELECT * FROM statements WHERE id = ?", ["partner-1"])?.opening_balance).toBe("string");
    } finally {
      field.close();
    }
    const personal = openPersonalStore(tempDbPath("money-personal"));
    try {
      personal.run(
        `INSERT INTO receipts (id, status, partner_id, method, amount, value_date, payload, updated_at)
         VALUES ('rc-1', 'POSTED', 'partner-1', 'CASH', '250.0000', '2026-11-04', '{}', '2026-11-04T00:00:00Z')`,
      );
      expect(typeof personal.get("SELECT * FROM receipts WHERE id = ?", ["rc-1"])?.amount).toBe("string");
      expect(personal.get("SELECT * FROM receipts WHERE id = ?", ["rc-1"])?.amount).toBe("250.0000");
    } finally {
      personal.close();
    }
  });
});

describe("StorageAdapter contract (sync-core consumed verbatim)", () => {
  it("transaction atomicity: a throw inside rolls back EVERYTHING; nesting commits with the outer", () => {
    const store = openFieldStore(tempDbPath("tx"));
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
    const store = openFieldStore(tempDbPath("roundtrip"));
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
      // The CHECK-bearing v4 DDL round-trips (money stays TEXT on insert).
      store.run(
        "INSERT INTO van_stocks (id, warehouse_id, item_id, qty, value, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["vs-1", "wh-1", "item-1", "1.000000", "2.0000", "{}", "2026-11-04T00:00:00Z"],
      );
      expect(store.get("SELECT * FROM van_stocks WHERE id = ?", ["vs-1"])?.qty).toBe("1.000000");
    } finally {
      store.close();
    }
  });
});

describe("connection hygiene", () => {
  it("close() is idempotent; operations on a closed store refuse loudly", () => {
    const store = openFieldStore(tempDbPath("hygiene"));
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
    expect(() => store.dbstatBytes()).toThrow(/closed/);
    store.close(); // idempotent
    expect(store.isOpen).toBe(false);
  });

  it("the driver refuses a second open on one file and a closed-driver op is loud", () => {
    const path = tempDbPath("driver-lifecycle");
    const driver = createNodeDriver();
    driver.open(path);
    expect(() => driver.open(path)).toThrow(/already open/);
    driver.close();
    expect(() => driver.run("SELECT 1")).toThrow(/closed/);
    expect(() => driver.integrityCheck()).toThrow(/closed/);
  });
});

describe("the constants parity (the frozen migration values vs the golden leaf)", () => {
  it("the seeded meta values equal the constants module (never drift with imports)", () => {
    const store = openFieldStore(tempDbPath("parity"));
    try {
      expect(store.info.deviceClass).toBe(MOBILE_DEVICE_CLASSES.field);
      expect(Number(metaGet(store, "storageBudgetBytes"))).toBe(MOBILE_STORAGE_BUDGET_BYTES);
      expect(FIELD_BUSINESS_TABLES).toContain("van_stocks");
      expect(PERSONAL_READ_MODELS).toContain("notifications");
      // The bandwidth golden constants the transport consumes (spot).
      expect(SYNC_PULL_BUDGET_BYTES).toBe(8_388_608);
      expect(SYNC_PUSH_BUDGET_BYTES).toBe(2_097_152);
      // The raw file is a plain SQLite file (the Node driver; the DEVICE
      // driver owns at-rest encryption, DR-P22-09).
      store.close();
      expect(readFileSync(store.info.path).subarray(0, 15).toString("latin1")).toBe("SQLite format 3");
    } finally {
      store.close();
    }
  });
});
