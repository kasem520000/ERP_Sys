/**
 * PHASE-021 T2-b — the in-memory bridge double for the lib/shell suites.
 *
 * INFRASTRUCTURE, not a mock of business logic: a JS Map-backed `sql`
 * member that executes the narrow statement grammar `STORE_SQL` defines
 * (SELECT * [+ WHERE pk], SELECT key FROM permissions, INSERT [OR
 * REPLACE], UPDATE … SET … WHERE pk) — the same approach sync-core's
 * `memoryAdapter` takes for the POS core. The double is ALSO the shape
 * the W3 E2E harness replaces with the REAL desktop runtime (a temp
 * SQLite file behind the same bridge interface — see
 * agent-ctx/T-P21-2b.md §E2E).
 */
import { vi } from "vitest";

import { BROWSER_CAPABILITIES, type DesktopBridge, type DesktopCapabilities } from "../bridge";

/** Primary-key column per table (the double's row identity). */
const PK: Record<string, string> = {
  outbox: "command_id",
  draft_docs: "local_id",
  local_events: "rowid",
  meta: "key",
  cursors: "entity_type",
  items: "id",
  partners: "id",
  tax_codes: "id",
  stock_counts: "id",
  sales_invoices: "id",
  permissions: "key",
};

export interface BridgeDoubleCallLog {
  syncNow: number;
  pushNow: number;
  printHtml: string[];
  /** Every executed statement, in order (crash-window assertions). */
  executed: string[];
}

export interface BridgeDouble {
  readonly bridge: DesktopBridge;
  /** The live tables — test seeding + assertions read these directly. */
  readonly tables: Map<string, Map<string, Record<string, unknown>>>;
  readonly calls: BridgeDoubleCallLog;
  /** Seed rows into a table (identity by PK; local_events uses rowid). */
  seed(table: string, rows: readonly Record<string, unknown>[]): void;
  /** Flip connectivity and notify subscribers (the provider re-renders). */
  setOnline(online: boolean): void;
  /** Make the NEXT matching statement throw — crash-window tests. */
  failOn(pattern: RegExp): void;
}

export interface BridgeDoubleOptions {
  /** Capability overrides on top of the full shell set. */
  capabilities?: Partial<DesktopCapabilities>;
  online?: boolean;
  /** Omit the optional sync member to model an older shell. */
  withSync?: boolean;
  /** Injectable cycle results (default: resolve undefined). */
  syncResults?: { syncNow?: () => Promise<unknown>; pushNow?: () => Promise<unknown> };
}

const normalize = (sql: string): string => sql.trim().replace(/\s+/g, " ");

export function createBridgeDouble(options: BridgeDoubleOptions = {}): BridgeDouble {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const rowsOf = (table: string): Map<string, Record<string, unknown>> => {
    let rows = tables.get(table);
    if (rows === undefined) {
      rows = new Map();
      tables.set(table, rows);
    }
    return rows;
  };
  const calls: BridgeDoubleCallLog = { syncNow: 0, pushNow: 0, printHtml: [], executed: [] };
  let failPattern: RegExp | null = null;
  let online = options.online ?? true;
  const listeners = new Set<(online: boolean) => void>();
  let nextRowId = 0;

  const insertInto = (sql: string, params: readonly unknown[], orReplace: boolean): void => {
    const insert = sql.match(
      /^INSERT (OR REPLACE )?INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)$/i,
    );
    if (insert === null) throw new Error(`bridge double: unsupported INSERT: ${sql.slice(0, 90)}`);
    const table = insert[2]!;
    const columns = insert[3]!.split(",").map((token) => token.trim());
    const placeholders = insert[4]!.split(",").map((token) => token.trim());
    if (placeholders.length !== params.length) {
      throw new Error(`bridge double: ${table} expects ${placeholders.length} params, got ${params.length}`);
    }
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      row[column] = params[index] ?? null;
    });
    const pk = PK[table] ?? "id";
    if (pk === "rowid") {
      nextRowId += 1;
      row.rowid = nextRowId;
      rowsOf(table).set(`rowid-${nextRowId}`, row);
      return;
    }
    const key = String(row[pk] ?? `row-${(nextRowId += 1)}`);
    if (!orReplace && rowsOf(table).has(key)) {
      throw new Error(`bridge double: duplicate ${pk}=${key} in ${table} (UNIQUE)`);
    }
    rowsOf(table).set(key, row);
  };

  const executeUpdate = (sql: string, params: readonly unknown[]): void => {
    const update = sql.match(/^UPDATE (\w+) SET (.*?)(?: WHERE (\w+) = \?)?$/i);
    if (update === null) throw new Error(`bridge double: unsupported UPDATE: ${sql.slice(0, 90)}`);
    const table = update[1]!;
    const assignments = update[2]!
      .split(/,\s*/)
      .map((token) => token.trim())
      .map((token) => /^(\w+) = \?$/.exec(token))
      .filter((match): match is RegExpExecArray => match !== null);
    if (assignments.length + (update[3] !== undefined ? 1 : 0) !== params.length) {
      throw new Error(`bridge double: UPDATE ${table} param count mismatch`);
    }
    const whereColumn = update[3];
    const whereValue = whereColumn !== undefined ? params[assignments.length] : undefined;
    for (const row of rowsOf(table).values()) {
      if (whereColumn !== undefined && row[whereColumn] !== whereValue) continue;
      assignments.forEach((assignment, index) => {
        row[assignment[1]!] = params[index] ?? null;
      });
    }
  };

  const sql = {
    async execute(statement: string, params: unknown[] = []): Promise<void> {
      const normalized = normalize(statement);
      calls.executed.push(normalized);
      if (failPattern !== null && failPattern.test(normalized)) {
        failPattern = null;
        throw new Error(`bridge double: injected failure on: ${normalized.slice(0, 90)}`);
      }
      if (/^INSERT (OR REPLACE )?INTO /i.test(normalized)) {
        insertInto(normalized, params, /^INSERT OR REPLACE /i.test(normalized));
        return;
      }
      if (/^UPDATE /i.test(normalized)) {
        executeUpdate(normalized, params);
        return;
      }
      throw new Error(`bridge double: unsupported execute: ${normalized.slice(0, 90)}`);
    },
    async query(statement: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
      const normalized = normalize(statement);
      const selectAll = /^SELECT \* FROM (\w+)$/.exec(normalized);
      if (selectAll !== null) {
        return [...rowsOf(selectAll[1]!).values()].map((row) => ({ ...row }));
      }
      const selectWhere = /^SELECT \* FROM (\w+) WHERE (\w+) = \?$/.exec(normalized);
      if (selectWhere !== null) {
        const table = selectWhere[1]!;
        const column = selectWhere[2]!;
        return [...rowsOf(table).values()]
          .filter((row) => row[column] === (params[0] ?? null))
          .map((row) => ({ ...row }));
      }
      const selectKeys = /^SELECT key FROM permissions$/.exec(normalized);
      if (selectKeys !== null) {
        return [...rowsOf("permissions").values()].map((row) => ({ key: row.key }));
      }
      throw new Error(`bridge double: unsupported query: ${normalized.slice(0, 90)}`);
    },
  };

  const capabilities: DesktopCapabilities = {
    ...BROWSER_CAPABILITIES,
    keychain: true,
    sqlite: true,
    http: true,
    updater: true,
    print: true,
    webview2Probe: true,
    ...(options.capabilities ?? {}),
    ...(options.withSync === false ? {} : { sync: options.capabilities?.sync ?? true }),
  };

  const sync =
    options.withSync === false
      ? undefined
      : {
          syncNow: vi.fn(async () => {
            calls.syncNow += 1;
            return options.syncResults?.syncNow?.() ?? undefined;
          }),
          pushNow: vi.fn(async () => {
            calls.pushNow += 1;
            return options.syncResults?.pushNow?.() ?? undefined;
          }),
        };

  const bridge: DesktopBridge = {
    version: "2.0.0-test",
    capabilities,
    keychain: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    sql,
    http: {
      request: vi.fn(async () => ({ status: 200, body: "{}" })),
    },
    updater: {
      checkNow: vi.fn(async () => ({})),
      install: vi.fn(async () => undefined),
    },
    system: {
      webview2Version: vi.fn(async () => "120.0.2210.61"),
      osInfo: vi.fn(async () => ({ os: "test" })),
    },
    print: {
      printRaw: vi.fn(async () => undefined),
      printHtml: vi.fn(async (html: string) => {
        calls.printHtml.push(html);
      }),
    },
    connectivity: {
      onChange(callback: (value: boolean) => void): () => void {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      isOnline(): boolean {
        return online;
      },
    },
    ...(sync === undefined ? {} : { sync }),
  };

  return {
    bridge,
    tables,
    calls,
    seed(table: string, rows: readonly Record<string, unknown>[]): void {
      for (const row of rows) {
        const pk = PK[table] ?? "id";
        if (pk === "rowid") {
          nextRowId += 1;
          rowsOf(table).set(`rowid-${nextRowId}`, { rowid: nextRowId, ...row });
        } else {
          rowsOf(table).set(String(row[pk]), { ...row });
        }
      }
    },
    setOnline(value: boolean): void {
      online = value;
      for (const listener of listeners) listener(value);
    },
    failOn(pattern: RegExp): void {
      failPattern = pattern;
    },
  };
}

/** Inject the double as `globalThis.__erpDesktop` and clean up after. */
export function installBridge(double: BridgeDouble): () => void {
  (globalThis as { __erpDesktop?: DesktopBridge }).__erpDesktop = double.bridge;
  return () => {
    delete (globalThis as { __erpDesktop?: DesktopBridge }).__erpDesktop;
  };
}
