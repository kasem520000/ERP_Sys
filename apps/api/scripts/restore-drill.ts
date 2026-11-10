/**
 * PHASE-014 T13 — backup/restore rehearsal (BACKUP_RESTORE_RUNBOOK §3/§4).
 *
 * The first recorded restore drill (RISK-018). Sandbox variant of the §4
 * quarterly drill (the standing local-substitute pattern): the ephemeral
 * environment is an embedded PostgreSQL 16 — the same major as the compose
 * stack — and the dump/restore pair is the REAL pg_dump/pg_restore tooling
 * in custom format (`-Fc`, §3 step 3), not a SQL approximation.
 *
 * Stages (every one timed, §4.6):
 *   1. boot ephemeral PostgreSQL 16 + full migration chain (§3 step 1)
 *   2. seed a verifiable dataset (balanced posted entries + audit trail)
 *   3. source row counts (§4 step 5 queries)
 *   4. pg_dump -Fc (the nightly-dump artifact shape, §1 `nightly-base`)
 *   5. DROP DATABASE + CREATE DATABASE — instance loss at the logical
 *      boundary (procedure §6; roles are cluster-level and survive, the
 *      runbook's --no-owner self-contained restore shape)
 *   6. pg_restore --no-owner --jobs=4
 *   7. post-restore checks — the §3 step 4 invariant smoke (a–e) plus the
 *      INV-003 mutation attempt and the RLS guard over the RESTORED copy,
 *      through a real erp_app role connection (RLS enforced)
 *   8. row-count parity restored vs source (§4 step 5)
 *   9. drill record + teardown (§4 steps 7–8)
 *
 * Usage: pnpm --filter @erp/api restore:drill
 *   PG_TOOLS_BIN (optional) — directory holding pg_dump/pg_restore when the
 *   tools are not on PATH (sandbox: the extracted debian client package).
 */
import { spawnSync } from "node:child_process";
import { rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

const DRILL_TENANT = "6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a";
const DRILL_ACTOR = "6a6a6a6a-0000-4000-8000-00000000006a";
const dumpPath = join(tmpdir(), "erp-restore-drill.dump");

/** The §4 step 5 count queries — run on BOTH source and restored copy. */
const COUNT_QUERIES: ReadonlyArray<{ table: string; sql: string }> = [
  { table: "journal_entries", sql: "SELECT count(*)::int FROM journal_entries" },
  { table: "journal_lines", sql: "SELECT count(*)::int FROM journal_lines" },
  { table: "sales_invoices", sql: "SELECT count(*)::int FROM sales_invoices" },
  { table: "stock_moves", sql: "SELECT count(*)::int FROM stock_moves" },
  { table: "audit_events", sql: "SELECT count(*)::int FROM audit_events" },
];

function log(stage: string, message: string): void {
  console.log(`[restore-drill] ${stage} — ${message}`);
}

async function freePort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function tool(name: "pg_dump" | "pg_restore"): string {
  const dir = process.env.PG_TOOLS_BIN;
  return dir !== undefined && dir !== "" ? join(dir, name) : name;
}

let pgHandle: EmbeddedPostgres | undefined;

async function main(): Promise<void> {
  const startedAt = performance.now();
  const dataDir = join(tmpdir(), "erp-api-restore-drill");
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(dumpPath, { force: true });

  // --- Stage 1: ephemeral PostgreSQL 16 + migrations (§3 step 1) ---------
  const pgPort = await freePort();
  const host = "127.0.0.1";
  const migrateUrl = `postgres://postgres:postgres@${host}:${pgPort}/erp`;
  const appUrl = `postgres://erp_app:erp_app@${host}:${pgPort}/erp`;
  log("1-boot", `embedded PostgreSQL 16 on ${host}:${pgPort}`);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: pgPort,
    persistent: false,
  });
  pgHandle = pg;
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("erp");

  const migrate = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
    encoding: "utf8",
    timeout: 180_000,
  });
  if (migrate.status !== 0) {
    throw new Error(`drizzle-kit migrate failed:\n${migrate.stdout}\n${migrate.stderr}`);
  }
  // Dev credentials (compose parity; SQL files never carry secrets).
  const bootstrap = new Client({ connectionString: migrateUrl });
  await bootstrap.connect();
  await bootstrap.query(`ALTER ROLE erp_app PASSWORD 'erp_app'`);
  await bootstrap.query(`ALTER ROLE erp_readonly PASSWORD 'erp_readonly'`);
  await bootstrap.end();
  log("1-boot", "migration chain applied (0001…0021) + dev credentials");

  // --- Stage 2: seed the verifiable dataset ------------------------------
  // Replica-path inserts (the sanctioned data-repair path past the
  // append-only guards, the exports.spec pattern): one tenant, one fiscal
  // year/period, two BALANCED posted journal entries (INV-001/002 material),
  // a monotonic audit trail (check c material).
  const su = new Client({ connectionString: migrateUrl });
  await su.connect();
  await su.query(`SET session_replication_role = replica`);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Restore Drill Tenant', 'مستأجر تدريب الاستعادة', 'SAR', 'SA', 'Asia/Riyadh')`,
    [DRILL_TENANT],
  );
  // The audit actor must exist (fk_audit_events_actor -> users).
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'drill-owner@fixture.test', 'Drill Owner', 'x', 'ACTIVE', 'ar')`,
    [DRILL_ACTOR],
  );
  const yearId = "6a6a6a6a-1111-4111-8111-111111111111";
  const periodId = "6a6a6a6a-2222-4222-8222-222222222222";
  await su.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date)
     VALUES ($1, $2, 'FY2026', '2026-01-01', '2026-12-31')`,
    [yearId, DRILL_TENANT],
  );
  await su.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, start_date, end_date)
     VALUES ($1, $2, $3, 'FY2026-01', '2026-01-01', '2026-01-31')`,
    [periodId, DRILL_TENANT, yearId],
  );
  const cashId = "6a6a6a6a-3333-4333-8333-333333333333";
  const capitalId = "6a6a6a6a-4444-4444-8444-444444444444";
  await su.query(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable, currency_code)
     VALUES ($1, $2, '1000', 'Cash', 'النقد', 'ASSET', true, 'SAR'),
            ($3, $2, '3000', 'Capital', 'رأس المال', 'EQUITY', true, 'SAR')`,
    [cashId, DRILL_TENANT, capitalId],
  );
  const entries = [
    { id: "6a6a6a6a-5555-4555-8555-555555555555", source: "6a6a6a6a-6666-4666-8666-666666666666", amount: "500.0000" },
    { id: "6a6a6a6a-7777-4777-8777-777777777777", source: "6a6a6a6a-8888-4888-8888-888888888888", amount: "1380.0000" },
  ];
  for (const [i, entry] of entries.entries()) {
    await su.query(
      `INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, fiscal_period_id,
                                    currency_code, status, source_type, source_id, operation,
                                    description, posted_at, posted_by)
       VALUES ($1, $2, $3, '2026-01-15', $4, 'SAR', 'POSTED', 'journal_entry', $5, 'post',
               'restore drill entry', now() - ($6 || ' minutes')::interval, $7)`,
      [entry.id, DRILL_TENANT, `JE-DRILL-${i + 1}`, periodId, entry.source, String(60 - i), DRILL_ACTOR],
    );
    await su.query(
      `INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id,
                                  direction, amount, base_amount)
       VALUES ($1, $2, $3, 1, $4, 'DEBIT', $5, $5),
              ($6, $2, $3, 2, $7, 'CREDIT', $5, $5)`,
      [
        // valid distinct line ids (last group rewritten, shape-preserving)
        `${entry.id.slice(0, 24)}aaa${entry.id.slice(27)}`,
        DRILL_TENANT,
        entry.id,
        cashId,
        entry.amount,
        `${entry.id.slice(0, 24)}bbb${entry.id.slice(27)}`,
        capitalId,
      ],
    );
  }
  for (const [i, action] of ["tenant.registered", "journal.posted", "report.exported"].entries()) {
    await su.query(
      `INSERT INTO audit_events (id, tenant_id, actor_id, action, entity_type, entity_id, at)
       VALUES ($1, $2, $3, $4, 'drill', $5, now() - ($6 || ' minutes')::interval)`,
      [
        `6a6a6a6a-9999-4999-8999-${String(i).padStart(12, "0")}`,
        DRILL_TENANT,
        DRILL_ACTOR,
        action,
        entries[i % entries.length]!.id,
        String(30 - i * 10),
      ],
    );
  }
  await su.query(`SET session_replication_role = DEFAULT`);
  log("2-seed", "tenant + FY2026/01 + 2 balanced posted entries + 3 audit events");

  // --- Stage 3: source row counts (§4 step 5) ----------------------------
  const sourceCounts = new Map<string, number>();
  for (const { table, sql } of COUNT_QUERIES) {
    const result = await su.query<{ count: number }>(sql);
    sourceCounts.set(table, result.rows[0]!.count);
  }
  log("3-source", `row counts: ${[...sourceCounts].map(([t, c]) => `${t}=${c}`).join(" ")}`);

  // --- Stage 4: pg_dump -Fc (§3 step 3 artifact shape) -------------------
  const dumpStart = performance.now();
  const dump = spawnSync(tool("pg_dump"), ["-h", host, "-p", String(pgPort), "-U", "postgres", "-Fc", "-f", dumpPath, "erp"], {
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, PGPASSWORD: "postgres" },
  });
  if (dump.status !== 0) {
    throw new Error(`pg_dump failed (status ${String(dump.status)}):\n${dump.error?.message ?? ""}\n${dump.stdout}\n${dump.stderr}`);
  }
  const dumpSeconds = (performance.now() - dumpStart) / 1000;
  const dumpBytes = statSync(dumpPath).size;
  log("4-dump", `pg_dump -Fc complete in ${dumpSeconds.toFixed(1)}s (${(dumpBytes / 1024).toFixed(0)} KiB artifact)`);

  // --- Stage 5: instance loss at the logical boundary (§6) ---------------
  // DROP must run from the maintenance database (never the open target).
  await su.end();
  const maintenance = new Client({ connectionString: `postgres://postgres:postgres@${host}:${pgPort}/postgres` });
  await maintenance.connect();
  await maintenance.query(`DROP DATABASE erp WITH (FORCE)`);
  await maintenance.query(`CREATE DATABASE erp`);
  await maintenance.end();
  log("5-loss", "database dropped + recreated (roles are cluster-level and survive)");

  // --- Stage 6: pg_restore (§3 step 3) ------------------------------------
  const restoreStart = performance.now();
  const restore = spawnSync(
    tool("pg_restore"),
    ["-h", host, "-p", String(pgPort), "-U", "postgres", "--no-owner", "--jobs=4", "-d", "erp", dumpPath],
    { encoding: "utf8", timeout: 600_000, env: { ...process.env, PGPASSWORD: "postgres" } },
  );
  if (restore.status !== 0) {
    throw new Error(`pg_restore failed (status ${String(restore.status)}):\n${restore.error?.message ?? ""}\n${restore.stdout}\n${restore.stderr}`);
  }
  const restoreSeconds = (performance.now() - restoreStart) / 1000;
  log("6-restore", `pg_restore --no-owner --jobs=4 complete in ${restoreSeconds.toFixed(1)}s`);

  // --- Stage 7: post-restore invariant smoke (§3 step 4 + INV-003) -------
  const check = new Client({ connectionString: migrateUrl });
  await check.connect();
  const failures: string[] = [];

  // (a) INV-001/002 — every entry balanced, tolerance 0.
  const unbalanced = await check.query<{ id: string }>(
    `SELECT je.id FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     GROUP BY je.id
     HAVING SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.amount ELSE -jl.amount END) <> 0
        OR SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.base_amount ELSE -jl.base_amount END) <> 0`,
  );
  if (unbalanced.rows.length !== 0) failures.push(`a: ${unbalanced.rows.length} unbalanced entries (INV-001/002)`);
  log("7-check-a", `INV-001/002 per-entry balance: ${unbalanced.rows.length === 0 ? "GREEN" : "RED"}`);

  // (b) RLS guard — the RESTORED copy, through a REAL erp_app connection.
  const app = new Client({ connectionString: appUrl });
  await app.connect();
  const leaked = await app.query<{ count: number }>(`SELECT count(*)::int AS count FROM audit_events`);
  if (leaked.rows[0]!.count !== 0) failures.push(`b: erp_app saw ${leaked.rows[0]!.count} rows without tenant GUC (RLS)`);
  log(
    "7-check-b",
    `RLS guard on restored copy (erp_app, no GUC): ${leaked.rows[0]!.count} rows — ${leaked.rows[0]!.count === 0 ? "GREEN" : "RED"}`,
  );

  // (c) audit trail — non-empty and monotonically increasing by 'at'.
  const auditCount = (await check.query<{ count: number }>(`SELECT count(*)::int FROM audit_events`)).rows[0]!.count;
  const orderedOk = await check.query<{ ok: boolean }>(
    `SELECT NOT EXISTS (SELECT 1 FROM (SELECT at, lag(at) OVER (ORDER BY id) prev FROM audit_events) t WHERE prev IS NOT NULL AND at < prev) AS ok`,
  );
  if (auditCount === 0 || !orderedOk.rows[0]!.ok) {
    failures.push(`c: audit trail count=${auditCount} ordered=${String(orderedOk.rows[0]!.ok)}`);
  }
  log("7-check-c", `audit trail: ${auditCount} events, id-ordered by 'at'=${orderedOk.rows[0]!.ok ? "GREEN" : "RED"}`);

  // (d) posted documents all have >= 1 journal entry (INV-006 shape).
  const orphanDocs = await check.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM sales_invoices si
     WHERE si.status = 'POSTED' AND NOT EXISTS (
       SELECT 1 FROM journal_entries je WHERE je.tenant_id = si.tenant_id
         AND je.source_type = 'sales_invoice' AND je.source_id = si.id)`,
  );
  if (orphanDocs.rows[0]!.count !== 0) failures.push(`d: ${orphanDocs.rows[0]!.count} posted documents without journal entries`);
  log(
    "7-check-d",
    `posted-doc to journal-entry tie: ${orphanDocs.rows[0]!.count} orphans — ${orphanDocs.rows[0]!.count === 0 ? "GREEN" : "RED"} (drill dataset seeds journal-source entries; sales-invoice count ${sourceCounts.get("sales_invoices") ?? "?"})`,
  );

  // (e) INV-013 — no duplicate (tenant, source_type, source_id, operation).
  const dupes = await check.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM (
       SELECT tenant_id, source_type, source_id, operation FROM journal_entries
       WHERE source_id IS NOT NULL
       GROUP BY tenant_id, source_type, source_id, operation HAVING count(*) > 1) d`,
  );
  if (dupes.rows[0]!.count !== 0) failures.push(`e: ${dupes.rows[0]!.count} duplicate posting keys (INV-013)`);
  log("7-check-e", `INV-013 posting-idempotency uniqueness: ${dupes.rows[0]!.count} duplicates — ${dupes.rows[0]!.count === 0 ? "GREEN" : "RED"}`);

  // (f) INV-003 — the mutation attempt on the RESTORED copy (append-only
  // by grants): erp_app holds no UPDATE grant on journal_lines.
  let inv003 = "GREEN";
  try {
    await app.query(`SET LOCAL app.tenant_id = '${DRILL_TENANT}'`);
    await app.query(`UPDATE journal_lines SET amount = 1 WHERE tenant_id = '${DRILL_TENANT}'`);
    inv003 = "RED (UPDATE succeeded — append-only violated)";
    failures.push("f: journal_lines UPDATE succeeded as erp_app (INV-003)");
  } catch {
    // grant-denied is the expected outcome
  }
  log("7-check-f", `INV-003 mutation attempt on restored copy (erp_app): ${inv003}`);

  // --- Stage 8: row-count parity (§4 step 5) ------------------------------
  const restoredCounts = new Map<string, number>();
  for (const { table, sql } of COUNT_QUERIES) {
    const result = await check.query<{ count: number }>(sql);
    restoredCounts.set(table, result.rows[0]!.count);
  }
  for (const { table } of COUNT_QUERIES) {
    const source = sourceCounts.get(table);
    const restored = restoredCounts.get(table);
    if (source !== restored) failures.push(`parity: ${table} source=${source} restored=${restored}`);
  }
  log(
    "8-parity",
    `restored: ${[...restoredCounts].map(([t, c]) => `${t}=${c}`).join(" ")} — ${failures.some((f) => f.startsWith("parity")) ? "MISMATCH" : "IDENTICAL"}`,
  );

  await app.end();
  await check.end();

  // --- Stage 9: drill record + teardown (§4 steps 7–8) --------------------
  const totalSeconds = (performance.now() - startedAt) / 1000;
  const rtoOk = restoreSeconds <= 4 * 3600;
  console.log("");
  console.log("=== RESTORE DRILL RECORD (BACKUP_RESTORE_RUNBOOK §8) ===");
  console.log(`date:                    ${new Date().toISOString()}`);
  console.log("environment:             embedded PostgreSQL 16 (sandbox — the standing local-substitute tier)");
  console.log("restore point:           pg_dump custom-format artifact of the migrated+seeded database");
  console.log(`dump size:               ${(dumpBytes / 1024).toFixed(0)} KiB`);
  console.log(`time-to-dump:            ${dumpSeconds.toFixed(1)}s`);
  console.log(`time-to-restore (RTO):   ${restoreSeconds.toFixed(1)}s (budget 4h: ${rtoOk ? "GREEN" : "RED"})`);
  console.log("data-loss window (RPO):  0 rows — no writes between dump and drop (dump-restore drill; PITR is the managed tier)");
  console.log(`invariant smoke a-f:     ${failures.length === 0 ? "ALL GREEN" : `FAILED: ${failures.join("; ")}`}`);
  console.log(`row-count parity:        ${failures.some((f) => f.startsWith("parity")) ? "MISMATCH" : "GREEN (5/5 tables identical)"}`);
  console.log(`total wall time:         ${totalSeconds.toFixed(1)}s`);
  console.log(`verdict:                 ${failures.length === 0 && rtoOk ? "DRILL PASSED" : "DRILL FAILED (RISK-018 — repeat within 2 weeks)"}`);
  console.log("========================================================");

  rmSync(dumpPath, { force: true });
  await pg.stop();
  rmSync(dataDir, { recursive: true, force: true });

  if (failures.length !== 0 || !rtoOk) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(`[restore-drill] FATAL: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Teardown ALWAYS (§3 step 6) — also on failure paths.
    rmSync(dumpPath, { force: true });
    if (pgHandle !== undefined) {
      await pgHandle.stop().catch(() => undefined);
    }
    rmSync(join(tmpdir(), "erp-api-restore-drill"), { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  });
