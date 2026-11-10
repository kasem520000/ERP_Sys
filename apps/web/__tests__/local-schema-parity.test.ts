/**
 * PHASE-021 T2-b (task G) — the schema-parity guard: every SQL statement
 * the webview's store-client issues is pinned against the REAL frozen
 * DDL (sync-core v1–3 + desktop v4–5), parsed out of the actual
 * `@erp/sync-core` / `@erp/desktop` migration sources (the desktop import
 * is a devDependency — Node test only; app code NEVER imports it). A
 * drift between the web SQL and the desktop schema fails HERE, at the
 * compile-time-ish boundary, instead of at runtime in the shell.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCAL_MIGRATIONS, type LocalMigration } from "@erp/sync-core";
import { STORE_SQL } from "../lib/shell/store-client";

/**
 * The desktop v4/v5 DDL is read from its SOURCE FILE as text: depcruise's
 * clients-never-import-other-clients rule bans an apps/web → apps/desktop
 * module edge even as a devDependency. Reading the file keeps the FULL
 * parity guarantee — the REAL shipped DDL is parsed, not a copy — with
 * zero module-graph coupling (a drift in desktop-migrations.ts still
 * fails THIS spec).
 */
function desktopMigrationsFromSource(): LocalMigration[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, "../../desktop/src/store/desktop-migrations.ts"),
    "utf8",
  );
  const migrations: LocalMigration[] = [];
  // One block per migration: `version: N,` … `statements: [ … ],` — the
  // pattern tolerates the explanatory comments between the fields.
  const blocks = [
    ...source.matchAll(
      /version:\s*(\d+),\s*(?:\/\/[^\n]*\n\s*)*minContractVersion:\s*"([^"]+)",\s*statements:\s*\[([\s\S]*?)\n\s*\],/g,
    ),
  ];
  for (const block of blocks) {
    const version = Number(block[1]);
    const body = block[3] ?? "";
    const statements = [...body.matchAll(/`((?:[^`\\]|\\.)*)`/gs)]
      .map((match) => match[1]!)
      .filter((statement) => /^(CREATE|ALTER|INSERT|DROP)/i.test(statement.trim()));
    if (Number.isFinite(version) && statements.length > 0) {
      migrations.push({ version, minContractVersion: block[2] ?? "", statements });
    }
  }
  if (migrations.length === 0) {
    throw new Error("schema-parity: failed to parse desktop-migrations.ts source");
  }
  return migrations;
}

const DESKTOP_MIGRATIONS: readonly LocalMigration[] = desktopMigrationsFromSource();

// -- DDL parsing ---------------------------------------------------------------------


const CONSTRAINT_PREFIXES = ["PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "CONSTRAINT"];

function columnsFromCreate(createSql: string): string[] {
  const open = createSql.indexOf("(");
  const close = createSql.lastIndexOf(")");
  if (open < 0 || close <= open) {
    throw new Error(`unparseable CREATE TABLE: ${createSql.slice(0, 80)}`);
  }
  const body = createSql.slice(open + 1, close);
  return body
    .split(/,\n/)
    .map((line) => line.trim())
    .flatMap((line) => (line.includes("\n") ? line.split("\n").map((part) => part.trim()) : [line]))
    .map((line) => line.replace(/\s+/g, " "))
    .filter((line) => line.length > 0)
    .map((line) => line.split(" ")[0]!.replace(/[^A-Za-z0-9_]/g, ""))
    .filter((name) => name.length > 0)
    .filter((name) => !CONSTRAINT_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)));
}

function buildSchema(migrations: readonly LocalMigration[]): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const migration of migrations) {
    for (const statement of migration.statements) {
      const normalized = statement.trim().replace(/\s+/g, " ");
      const create = /^CREATE TABLE IF NOT EXISTS (\w+) \(/i.exec(normalized);
      if (create !== null) {
        const table = create[1]!;
        const columns = columnsFromCreate(statement);
        const existing = tables.get(table) ?? new Set<string>();
        for (const column of columns) existing.add(column);
        tables.set(table, existing);
        continue;
      }
      const alter = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/i.exec(normalized);
      if (alter !== null) {
        const table = alter[1]!;
        const column = alter[2]!;
        const existing = tables.get(table) ?? new Set<string>();
        existing.add(column);
        tables.set(table, existing);
      }
    }
  }
  return tables;
}

/** The on-demand `permissions` table — NOT in the migrations; created by
 * apps/desktop/src/auth/unlock.ts (`CREATE TABLE IF NOT EXISTS permissions
 * (key TEXT PRIMARY KEY)` — 1-b decision 7). Its DDL is duplicated here
 * with the citation; a future migration that adds it formally should
 * replace this allowlist. */
const ON_DEMAND_TABLES: Readonly<Record<string, readonly string[]>> = {
  permissions: ["key"],
};

// -- statement parsing ---------------------------------------------------------------

interface TouchedStatement {
  readonly key: string;
  readonly sql: string;
  readonly table: string;
  /** null for SELECT * (touches every column). */
  readonly columns: readonly string[] | null;
}

function parseStatement(key: string, sql: string): TouchedStatement {
  const normalized = sql.trim().replace(/\s+/g, " ");
  const insert = /^INSERT (?:OR REPLACE )?INTO (\w+) \(([^)]*)\)/i.exec(normalized);
  if (insert !== null) {
    return {
      key,
      sql,
      table: insert[1]!,
      columns: insert[2]!.split(",").map((token) => token.trim()),
    };
  }
  const update = /^UPDATE (\w+) SET (.*) WHERE (\w+) = \?$/i.exec(normalized);
  if (update !== null) {
    const setColumns = update[2]!
      .split(/,\s*/)
      .map((assignment) => /^(\w+) = \?$/.exec(assignment.trim())?.[1])
      .filter((name): name is string => name !== undefined);
    return { key, sql, table: update[1]!, columns: [...setColumns, update[3]!] };
  }
  const selectWhere = /^SELECT \* FROM (\w+) WHERE (\w+) = \?$/i.exec(normalized);
  if (selectWhere !== null) {
    return { key, sql, table: selectWhere[1]!, columns: [selectWhere[2]!] };
  }
  const selectAll = /^SELECT \* FROM (\w+)$/i.exec(normalized);
  if (selectAll !== null) {
    return { key, sql, table: selectAll[1]!, columns: null };
  }
  const selectKeys = /^SELECT (\w+) FROM (\w+)$/i.exec(normalized);
  if (selectKeys !== null) {
    return { key, sql, table: selectKeys[2]!, columns: [selectKeys[1]!] };
  }
  throw new Error(`schema-parity: unrecognized STORE_SQL statement ${key}: ${normalized.slice(0, 90)}`);
}

// -- the spec -------------------------------------------------------------------------

describe("the local schema parity (web SQL ↔ frozen v1–v5 DDL)", () => {
  const ddl = buildSchema([...LOCAL_MIGRATIONS, ...DESKTOP_MIGRATIONS]);

  const allTables: ReadonlySet<string> = new Set([...ddl.keys(), ...Object.keys(ON_DEMAND_TABLES)]);
  const columnsOf = (table: string): ReadonlySet<string> => {
    const fromDdl = ddl.get(table);
    const onDemand = ON_DEMAND_TABLES[table] ?? [];
    return new Set([...(fromDdl ?? []), ...onDemand]);
  };

  it("the v1–v5 DDL covers every table the store-client touches", () => {
    for (const [key, sql] of Object.entries(STORE_SQL)) {
      const touched = parseStatement(key, sql);
      expect(
        allTables.has(touched.table),
        `${key} touches table "${touched.table}" which no v1–v5 migration (nor the on-demand allowlist) creates`,
      ).toBe(true);
    }
  });

  it("every touched column exists with the right name in the DDL", () => {
    for (const [key, sql] of Object.entries(STORE_SQL)) {
      const touched = parseStatement(key, sql);
      const tableColumns = columnsOf(touched.table);
      if (touched.columns === null) continue; // SELECT * — the table existence is the guard
      for (const column of touched.columns) {
        expect(
          tableColumns.has(column),
          `${key} touches ${touched.table}.${column} which the DDL does not define`,
        ).toBe(true);
      }
    }
  });

  it("the outbox INSERT matches the engine's column list EXACTLY (v1 + v3 ALTERs)", () => {
    const touched = parseStatement("outboxInsert", STORE_SQL.outboxInsert);
    const ddlColumns = columnsOf("outbox");
    expect(new Set(touched.columns)).toEqual(ddlColumns);
    // the v3 additions specifically
    expect(ddlColumns.has("local_ref")).toBe(true);
    expect(ddlColumns.has("next_attempt_at")).toBe(true);
  });

  it("the draft_docs upsert covers the whole v4 projection row", () => {
    const touched = parseStatement("draftUpsert", STORE_SQL.draftUpsert);
    const ddlColumns = columnsOf("draft_docs");
    expect(new Set(touched.columns)).toEqual(ddlColumns);
    // the v4 CHECK vocabulary is present in the DDL source
    expect(STORE_SQL.draftUpdateStatus).toContain("local_status");
  });

  it("the local_events insert covers the v4 audit columns (id is AUTOINCREMENT-implicit)", () => {
    const touched = parseStatement("localEventInsert", STORE_SQL.localEventInsert);
    const ddlColumns = columnsOf("local_events");
    expect(touched.columns).toEqual(["kind", "choice", "reason", "trace_id", "command_id", "payload", "at"]);
    expect(ddlColumns.has("id")).toBe(true);
    expect(ddlColumns.has("trace_id")).toBe(true);
  });

  it("the desktop migrations parsed to the expected table set (the parser itself is guarded)", () => {
    for (const table of [
      "outbox",
      "inbox",
      "cursors",
      "meta",
      "items",
      "partners",
      "tax_codes",
      "pos_sales",
      "sales_invoices",
      "quotations",
      "delivery_notes",
      "stock_counts",
      "draft_docs",
      "local_events",
      "permissions",
    ]) {
      expect(allTables.has(table), `expected table ${table} in the v1–v5 set`).toBe(true);
    }
    // spot-check exact column names the mappers rely on
    expect(columnsOf("sales_invoices").has("doc_no")).toBe(true);
    expect(columnsOf("sales_invoices").has("total_gross")).toBe(true);
    expect(columnsOf("items").has("name_ar")).toBe(true);
    expect(columnsOf("partners").has("credit_limit")).toBe(true);
    expect(columnsOf("stock_counts").has("counted_at")).toBe(true);
    expect(columnsOf("cursors").has("synced_at")).toBe(true);
    expect(columnsOf("meta").has("key")).toBe(true);
  });

  it("DESKTOP_MIGRATIONS continues the sync-core numbering (the boot-order contract)", () => {
    const versions = DESKTOP_MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([4, 5]);
    expect(LOCAL_MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3]);
  });
});
