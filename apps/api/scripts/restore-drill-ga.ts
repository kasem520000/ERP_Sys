/**
 * PHASE-025 T6 — cross-region restore rehearsal (DISASTER_RECOVERY §5 item 2 /
 * BACKUP_RESTORE_RUNBOOK §7, the GA gate leg).
 *
 * Local-tier honesty note (no recovery region exists in this sandbox): §7
 * step 2's recorded infrastructure-as-code + `deploy/compose.prod.yml`
 * provisioning and the step-4 DNS/LB cutover are HOSTED legs — this script
 * executes the §7 steps 3–4 shape with TWO fresh embedded PostgreSQL 16
 * instances standing in for the two regions:
 *
 *   SOURCE   ("primary region")  — migrated (0001–0036) + seeded, then dumped
 *                                  with the §1 nightly-dump artifact shape
 *                                  (`pg_dump --format=custom --compress=9
 *                                  --no-owner --exclude-schema=boss`).
 *   RECOVERY ("recovery region") — FRESH boot, full migration chain applied
 *                                  (the §7 "role bootstrap per DEPLOYMENT
 *                                  §6" leg, drizzle-kit migrate per the
 *                                  global-setup pattern), then the restore
 *                                  target prepared (fresh database — §3 step 1
 *                                  shape; cluster-level roles survive the
 *                                  logical drop, the PHASE-014 finding) and
 *                                  the nightly-shaped artifact restored with
 *                                  `pg_restore --no-owner --jobs=4` — TIMED.
 *
 * The recorded wall time is the restore leg of the RTO ≤ 8 h claim
 * (DISASTER_RECOVERY §1 S1); the provisioning + cutover legs are the hosted
 * follow-up obligation recorded with the drill.
 *
 * Stages:
 *   1. boot the RECOVERY instance (fresh embedded PostgreSQL 16)
 *   2. apply the FULL migration chain 0001→0036 on it + dev credentials
 *      (DEPLOYMENT §6 steps 2–3 rehearsal) — timed
 *   3. boot the SOURCE instance (second embedded PostgreSQL 16), apply the
 *      chain, seed the verifiable dataset (balanced posted entries + audit
 *      trail — the PHASE-014 drill's seeding pattern), capture §4 step 5
 *      source counts, create the nightly-shaped dump — dump timed
 *   4. prepare the restore target on the recovery instance (fresh database;
 *      roles survive) + `pg_restore --no-owner --jobs=4` — TIMED
 *   5. §3 step 4 invariant smoke on the RESTORED copy: assertions a–e plus
 *      the INV-003 mutation attempt and the RLS guard through a real
 *      erp_app connection (checks copied from the PHASE-014 drill)
 *   6. row-count parity restored vs source (§4 step 5)
 *   7. drill record — §8 table-row shape + JSON summary for the GA
 *      release checklist
 *   8. teardown ALWAYS (both instances + artifact)
 *
 * Usage: pnpm --filter @erp/api restore:drill-ga
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

const DRILL_TENANT = "7d7d7d7d-7d7d-7d7d-7d7d-7d7d7d7d7d7d";
const DRILL_ACTOR = "7d7d7d7d-0000-4000-8000-00000000007d";
const dumpPath = join(tmpdir(), "erp-restore-drill-ga.dump");

/** The §4 step 5 count queries — run on BOTH source and restored copy. */
const COUNT_QUERIES: ReadonlyArray<{ table: string; sql: string }> = [
  { table: "journal_entries", sql: "SELECT count(*)::int FROM journal_entries" },
  { table: "journal_lines", sql: "SELECT count(*)::int FROM journal_lines" },
  { table: "sales_invoices", sql: "SELECT count(*)::int FROM sales_invoices" },
  { table: "stock_moves", sql: "SELECT count(*)::int FROM stock_moves" },
  { table: "audit_events", sql: "SELECT count(*)::int FROM audit_events" },
];

function log(stage: string, message: string): void {
  console.log(`[restore-drill-ga] ${stage} — ${message}`);
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

let sourcePg: EmbeddedPostgres | undefined;
let recoveryPg: EmbeddedPostgres | undefined;

async function main(): Promise<void> {
  const startedAt = performance.now();
  const sourceDir = join(tmpdir(), "erp-api-restore-drill-ga-source");
  const recoveryDir = join(tmpdir(), "erp-api-restore-drill-ga-recovery");
  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(recoveryDir, { recursive: true, force: true });
  rmSync(dumpPath, { force: true });

  const host = "127.0.0.1";

  // --- Stage 1: boot the RECOVERY instance (§7 step 2 stand-in) -----------
  const recoveryPort = await freePort();
  const recoveryMigrateUrl = `postgres://postgres:postgres@${host}:${recoveryPort}/erp`;
  const recoveryAppUrl = `postgres://erp_app:erp_app@${host}:${recoveryPort}/erp`;
  log("1-recovery-boot", `fresh embedded PostgreSQL 16 (recovery-region stand-in) on ${host}:${recoveryPort}`);
  const recovery = new EmbeddedPostgres({
    databaseDir: recoveryDir,
    user: "postgres",
    password: "postgres",
    port: recoveryPort,
    persistent: false,
  });
  recoveryPg = recovery;
  await recovery.initialise();
  await recovery.start();
  await recovery.createDatabase("erp");

  // --- Stage 2: full migration chain on the recovery instance ------------
  // The §7 "role bootstrap per DEPLOYMENT §6" leg at local tier: the chain
  // (0001 creates erp_migrate/erp_app/erp_readonly; 0002 on uses erp_migrate
  // semantics) applies to a virgin instance — the IaC/compose.prod.yml
  // provisioning around it is the hosted leg.
  const chainStart = performance.now();
  const recoveryMigrate = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATE_DATABASE_URL: recoveryMigrateUrl },
    encoding: "utf8",
    timeout: 180_000,
  });
  if (recoveryMigrate.status !== 0) {
    throw new Error(
      `recovery drizzle-kit migrate failed:\n${recoveryMigrate.stdout}\n${recoveryMigrate.stderr}`,
    );
  }
  // Dev credentials (compose parity; SQL files never carry secrets) — set on
  // the CLUSTER-level roles here so they survive the stage-4 database reset.
  const recoveryBootstrap = new Client({ connectionString: recoveryMigrateUrl });
  await recoveryBootstrap.connect();
  await recoveryBootstrap.query(`ALTER ROLE erp_app PASSWORD 'erp_app'`);
  await recoveryBootstrap.query(`ALTER ROLE erp_readonly PASSWORD 'erp_readonly'`);
  await recoveryBootstrap.end();
  const recoveryChainSeconds = (performance.now() - chainStart) / 1000;
  log(
    "2-recovery-chain",
    `full migration chain applied on the recovery instance (0001–0036) + dev credentials in ${recoveryChainSeconds.toFixed(1)}s`,
  );

  // --- Stage 3: SOURCE instance — boot + chain + seed + counts + dump ----
  const sourcePort = await freePort();
  const sourceMigrateUrl = `postgres://postgres:postgres@${host}:${sourcePort}/erp`;
  log("3-source", `booting the SOURCE instance (primary-region stand-in) on ${host}:${sourcePort}`);
  const source = new EmbeddedPostgres({
    databaseDir: sourceDir,
    user: "postgres",
    password: "postgres",
    port: sourcePort,
    persistent: false,
  });
  sourcePg = source;
  await source.initialise();
  await source.start();
  await source.createDatabase("erp");
  const sourceMigrate = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATE_DATABASE_URL: sourceMigrateUrl },
    encoding: "utf8",
    timeout: 180_000,
  });
  if (sourceMigrate.status !== 0) {
    throw new Error(`source drizzle-kit migrate failed:\n${sourceMigrate.stdout}\n${sourceMigrate.stderr}`);
  }

  // Seed the verifiable dataset (the PHASE-014 drill's pattern): one tenant,
  // one fiscal year/period, two BALANCED posted journal entries (INV-001/002
  // material), a monotonic audit trail (check c material). Replica-path
  // inserts — the sanctioned data-repair path past the append-only guards.
  const su = new Client({ connectionString: sourceMigrateUrl });
  await su.connect();
  await su.query(`SET session_replication_role = replica`);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'GA Cross-Region Drill Tenant', 'مستأجر تدريب الاستعادة عبر المناطق', 'SAR', 'SA', 'Asia/Riyadh')`,
    [DRILL_TENANT],
  );
  // The audit actor must exist (fk_audit_events_actor -> users).
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'ga-drill-owner@fixture.test', 'GA Drill Owner', 'x', 'ACTIVE', 'ar')`,
    [DRILL_ACTOR],
  );
  const yearId = "7d7d7d7d-1111-4111-8111-111111111111";
  const periodId = "7d7d7d7d-2222-4222-8222-222222222222";
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
  const cashId = "7d7d7d7d-3333-4333-8333-333333333333";
  const capitalId = "7d7d7d7d-4444-4444-8444-444444444444";
  await su.query(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable, currency_code)
     VALUES ($1, $2, '1000', 'Cash', 'النقد', 'ASSET', true, 'SAR'),
            ($3, $2, '3000', 'Capital', 'رأس المال', 'EQUITY', true, 'SAR')`,
    [cashId, DRILL_TENANT, capitalId],
  );
  const entries = [
    { id: "7d7d7d7d-5555-4555-8555-555555555555", source: "7d7d7d7d-6666-4666-8666-666666666666", amount: "500.0000" },
    { id: "7d7d7d7d-7777-4777-8777-777777777777", source: "7d7d7d7d-8888-4888-8888-888888888888", amount: "1380.0000" },
  ];
  for (const [i, entry] of entries.entries()) {
    await su.query(
      `INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, fiscal_period_id,
                                    currency_code, status, source_type, source_id, operation,
                                    description, posted_at, posted_by)
       VALUES ($1, $2, $3, '2026-01-15', $4, 'SAR', 'POSTED', 'journal_entry', $5, 'post',
               'cross-region drill entry', now() - ($6 || ' minutes')::interval, $7)`,
      [entry.id, DRILL_TENANT, `JE-GA-${i + 1}`, periodId, entry.source, String(60 - i), DRILL_ACTOR],
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
        `7d7d7d7d-9999-4999-8999-${String(i).padStart(12, "0")}`,
        DRILL_TENANT,
        DRILL_ACTOR,
        action,
        entries[i % entries.length]!.id,
        String(30 - i * 10),
      ],
    );
  }
  await su.query(`SET session_replication_role = DEFAULT`);
  log("3-source", "seeded: tenant + FY2026/01 + 2 balanced posted entries + 3 audit events");

  // §4 step 5 source counts (production reads at dump time).
  const sourceCounts = new Map<string, number>();
  for (const { table, sql } of COUNT_QUERIES) {
    const result = await su.query<{ count: number }>(sql);
    sourceCounts.set(table, result.rows[0]!.count);
  }
  log("3-source", `row counts: ${[...sourceCounts].map(([t, c]) => `${t}=${c}`).join(" ")}`);

  // The nightly-shaped dump (§1 `nightly-dump` artifact): custom format,
  // compress 9, --no-owner, boss schema excluded (queue state is
  // reconstructable). Local-tier substitution: the embedded superuser stands
  // in for the erp_migrate-level credentials of the §1 job.
  const dumpStart = performance.now();
  const dump = spawnSync(
    tool("pg_dump"),
    [
      "-h", host, "-p", String(sourcePort), "-U", "postgres",
      "--format=custom", "--compress=9", "--no-owner", "--exclude-schema=boss",
      "-f", dumpPath, "erp",
    ],
    { encoding: "utf8", timeout: 300_000, env: { ...process.env, PGPASSWORD: "postgres" } },
  );
  if (dump.status !== 0) {
    throw new Error(
      `pg_dump failed (status ${String(dump.status)}):\n${dump.error?.message ?? ""}\n${dump.stdout}\n${dump.stderr}`,
    );
  }
  const dumpSeconds = (performance.now() - dumpStart) / 1000;
  const dumpBytes = statSync(dumpPath).size;
  log(
    "3-source",
    `nightly-shaped pg_dump complete in ${dumpSeconds.toFixed(1)}s (${(dumpBytes / 1024).toFixed(0)} KiB artifact; boss schema excluded per §1 — present on source via migration 0001, empty of queue tables in this drill)`,
  );
  await su.end();

  // --- Stage 4: restore into the recovery instance (§7 step 3) -----------
  // Restore target = a FRESH database on the recovery instance (§3 step 1
  // fresh-environment shape). The stage-2 chain apply stays meaningful: the
  // CLUSTER-level roles (erp_migrate/erp_app/erp_readonly + passwords)
  // survive the logical drop — the PHASE-014 finding — which is exactly the
  // out-of-band role-provisioning path the managed-instance drill verifies.
  const maintenance = new Client({
    connectionString: `postgres://postgres:postgres@${host}:${recoveryPort}/postgres`,
  });
  await maintenance.connect();
  await maintenance.query(`DROP DATABASE erp WITH (FORCE)`);
  await maintenance.query(`CREATE DATABASE erp`);
  await maintenance.end();
  log("4-restore", "restore target prepared: fresh database on the recovery instance (cluster-level roles survive)");

  const restoreStart = performance.now();
  const restore = spawnSync(
    tool("pg_restore"),
    ["-h", host, "-p", String(recoveryPort), "-U", "postgres", "--no-owner", "--jobs=4", "-d", "erp", dumpPath],
    { encoding: "utf8", timeout: 600_000, env: { ...process.env, PGPASSWORD: "postgres" } },
  );
  if (restore.status !== 0) {
    throw new Error(
      `pg_restore failed (status ${String(restore.status)}):\n${restore.error?.message ?? ""}\n${restore.stdout}\n${restore.stderr}`,
    );
  }
  const restoreSeconds = (performance.now() - restoreStart) / 1000;
  log("4-restore", `pg_restore --no-owner --jobs=4 into the recovery instance complete in ${restoreSeconds.toFixed(1)}s`);

  // --- Stage 5: post-restore invariant smoke (§3 step 4 + INV-003) -------
  const check = new Client({ connectionString: recoveryMigrateUrl });
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
  log("5-check-a", `INV-001/002 per-entry balance: ${unbalanced.rows.length === 0 ? "GREEN" : "RED"}`);

  // (b) RLS guard — the RESTORED copy, through a REAL erp_app connection.
  const app = new Client({ connectionString: recoveryAppUrl });
  await app.connect();
  const leaked = await app.query<{ count: number }>(`SELECT count(*)::int AS count FROM audit_events`);
  if (leaked.rows[0]!.count !== 0) failures.push(`b: erp_app saw ${leaked.rows[0]!.count} rows without tenant GUC (RLS)`);
  log(
    "5-check-b",
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
  log("5-check-c", `audit trail: ${auditCount} events, id-ordered by 'at'=${orderedOk.rows[0]!.ok ? "GREEN" : "RED"}`);

  // (d) posted documents all have >= 1 journal entry (INV-006 shape).
  const orphanDocs = await check.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM sales_invoices si
     WHERE si.status = 'POSTED' AND NOT EXISTS (
       SELECT 1 FROM journal_entries je WHERE je.tenant_id = si.tenant_id
         AND je.source_type = 'sales_invoice' AND je.source_id = si.id)`,
  );
  if (orphanDocs.rows[0]!.count !== 0) failures.push(`d: ${orphanDocs.rows[0]!.count} posted documents without journal entries`);
  log(
    "5-check-d",
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
  log("5-check-e", `INV-013 posting-idempotency uniqueness: ${dupes.rows[0]!.count} duplicates — ${dupes.rows[0]!.count === 0 ? "GREEN" : "RED"}`);

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
  log("5-check-f", `INV-003 mutation attempt on restored copy (erp_app): ${inv003}`);

  // (shape) the §1 nightly-artifact shape: the restored copy must NOT carry
  // the boss schema (queue state is reconstructable, never restored).
  const bossSchemas = await check.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name = 'boss'`,
  );
  if (bossSchemas.rows[0]!.count !== 0) {
    failures.push(`shape: boss schema present in restored copy (${bossSchemas.rows[0]!.count}) — §1 exclusion not in effect`);
  }
  log(
    "5-check-shape",
    `nightly artifact shape (boss schema excluded): ${bossSchemas.rows[0]!.count === 0 ? "GREEN" : "RED"}`,
  );

  // --- Stage 6: row-count parity (§4 step 5) ------------------------------
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
    "6-parity",
    `restored: ${[...restoredCounts].map(([t, c]) => `${t}=${c}`).join(" ")} — ${failures.some((f) => f.startsWith("parity")) ? "MISMATCH" : "IDENTICAL"}`,
  );

  await app.end();
  await check.end();

  // --- Stage 7: drill record (§8 row shape + JSON summary) ---------------
  const totalSeconds = (performance.now() - startedAt) / 1000;
  // §7 RTO ≤ 8 h is declaration → cutover. Locally measured legs: recovery
  // bootstrap (chain) + restore. Hosted legs (not measured, no sandbox
  // equivalent): IaC provisioning, backup-bucket cross-region fetch, DNS/LB
  // cutover — recorded as the follow-up obligation.
  const rtoBudgetSeconds = 8 * 3600;
  const rtoOk = restoreSeconds <= rtoBudgetSeconds;
  const date = new Date().toISOString().slice(0, 10);
  const verdict = failures.length === 0 && rtoOk ? "PASSED" : "FAILED (RISK-018 — repeat within 2 weeks)";
  const checksSummary = failures.length === 0 ? "ALL GREEN" : `FAILED: ${failures.join("; ")}`;
  const failed = (prefix: string): boolean => failures.some((f) => f.startsWith(prefix));
  const parityTables = COUNT_QUERIES.filter(
    ({ table }) => sourceCounts.get(table) === restoredCounts.get(table),
  ).length;
  const rpoDrillGreen = !failures.some((f) => f.startsWith("parity"));

  console.log("");
  console.log("=== CROSS-REGION RESTORE REHEARSAL — DRILL RECORD (DISASTER_RECOVERY §5 / BACKUP_RESTORE_RUNBOOK §7, §8) ===");
  console.log(`date:                        ${date}`);
  console.log("type:                        cross-region (local-tier rehearsal — PHASE-025 T6 GA gate leg)");
  console.log("environment:                 TWO embedded PostgreSQL 16 instances (sandbox: source + recovery stand-ins; §7 step-2 IaC/compose.prod.yml provisioning + DNS/LB cutover are hosted legs)");
  console.log("migration chain:             0001–0036 (applied on BOTH instances — the recovery instance from a virgin boot)");
  console.log(`restore point:               nightly-shaped pg_dump artifact of the migrated+seeded source (${(dumpBytes / 1024).toFixed(0)} KiB, --format=custom --compress=9 --no-owner --exclude-schema=boss)`);
  console.log(`recovery bootstrap (chain):  ${recoveryChainSeconds.toFixed(1)}s (DEPLOYMENT §6 steps 2–3 shape — not part of the RTO clock)`);
  console.log(`time-to-dump:                ${dumpSeconds.toFixed(1)}s`);
  console.log(`time-to-restore (RTO leg):   ${restoreSeconds.toFixed(1)}s (budget 8 h: ${rtoOk ? "GREEN" : "RED"})`);
  console.log("data-loss window (RPO):      0 rows — no writes between dump and restore (drill semantics; the S1 ≤ 15 min claim is the managed-tier backup-replication lag — hosted)");
  console.log(`invariant smoke a–f + shape: ${checksSummary}`);
  console.log(`row-count parity:            ${rpoDrillGreen ? `GREEN (${parityTables}/${COUNT_QUERIES.length} tables identical)` : "MISMATCH"}`);
  console.log(`total wall time:             ${totalSeconds.toFixed(1)}s`);
  console.log(`verdict:                     DRILL ${verdict}`);
  console.log("");
  console.log("--- §8 drill-log row (append to BACKUP_RESTORE_RUNBOOK §8) ---");
  console.log(
    `| ${date} | Cross-region restore rehearsal (PHASE-025 T6 — GA gate; DISASTER_RECOVERY §5 item 2 / runbook §7 at LOCAL tier: two fresh embedded PostgreSQL 16 instances standing in for primary + recovery regions — the §7 step-2 IaC + compose.prod.yml provisioning and the step-4 DNS/LB cutover are the hosted follow-up obligation) | AI coding agent (PHASE-025 session, DR-C) | Nightly-shaped pg_dump artifact (--format=custom --compress=9 --no-owner --exclude-schema=boss) of the fully-migrated (0001–0036) + seeded source; recovery instance bootstrapped from virgin (full chain re-applied, roles out-of-band-equivalent per DEPLOYMENT §6) | ${restoreSeconds.toFixed(1)}s restore / ${recoveryChainSeconds.toFixed(1)}s recovery bootstrap (RTO 8 h — ${rtoOk ? "GREEN" : "RED"}, restore leg measured; provisioning + cutover hosted) | 0 rows lost — no writes between dump and restore (RPO 15 min — ${rpoDrillGreen ? "GREEN" : "RED"}; drill semantics; replication lag is the managed-tier claim) | ${failures.length === 0 && rtoOk ? "**PASSED**" : "**FAILED**"} — post-restore invariant smoke on the restored recovery copy: (a) INV-001/002 balance ${failed("a:") ? "RED" : "GREEN"}; (b) RLS via real erp_app connection ${failed("b:") ? "RED" : "GREEN"}; (c) audit trail ordered ${failed("c:") ? "RED" : "GREEN"}; (d) posted-doc tie ${failed("d:") ? "RED" : "GREEN"}; (e) INV-013 uniqueness ${failed("e:") ? "RED" : "GREEN"}; (f) INV-003 mutation grant-denied ${failed("f:") ? "RED" : "GREEN"}; boss-schema exclusion ${failed("shape:") ? "RED" : "GREEN"}; row-count parity ${parityTables}/${COUNT_QUERIES.length} | Hosted-tier re-run of §7 end-to-end (IaC provisioning + cross-region fetch + cutover) when the recovery region exists; the recovery-region wall time remains the infra-gated RTO evidence |`,
  );
  console.log("");
  console.log("--- JSON summary (GA release checklist) ---");
  console.log(
    JSON.stringify(
      {
        drill: "cross-region-restore-rehearsal",
        date,
        tier: "local (embedded PostgreSQL 16 x2 — source + recovery stand-ins)",
        migrationChain: "0001-0036",
        timings: {
          recoveryBootstrapSeconds: Number(recoveryChainSeconds.toFixed(1)),
          dumpSeconds: Number(dumpSeconds.toFixed(1)),
          restoreSeconds: Number(restoreSeconds.toFixed(1)),
          totalWallSeconds: Number(totalSeconds.toFixed(1)),
        },
        rto: { budgetHours: 8, measuredLeg: "restore", measuredSeconds: Number(restoreSeconds.toFixed(1)), verdict: rtoOk ? "GREEN" : "RED", hostedLegs: ["IaC provisioning", "cross-region backup fetch", "DNS/LB cutover"] },
        rpo: { targetMinutes: 15, measured: "0 rows lost (no writes between dump and restore — drill semantics)", hostedClaim: "backup replication lag" },
        checks: { a_inv001_002: !failed("a:"), b_rls: !failed("b:"), c_audit: !failed("c:"), d_inv006: !failed("d:"), e_inv013: !failed("e:"), f_inv003: !failed("f:"), shape_bossExcluded: !failed("shape:"), parity: `${parityTables}/${COUNT_QUERIES.length}` },
        rowCountSource: Object.fromEntries(sourceCounts),
        rowCountRestored: Object.fromEntries(restoredCounts),
        verdict,
      },
      null,
      2,
    ),
  );
  console.log("===========================================================");

  // --- Stage 8: teardown ALWAYS (§4 step 8) -------------------------------
  rmSync(dumpPath, { force: true });
  await source.stop();
  await recovery.stop();
  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(recoveryDir, { recursive: true, force: true });
  log("8-teardown", "both instances stopped + data dirs + artifact removed");

  if (failures.length !== 0 || !rtoOk) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(`[restore-drill-ga] FATAL: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Teardown ALWAYS (§4 step 8) — also on failure paths.
    rmSync(dumpPath, { force: true });
    if (sourcePg !== undefined) {
      await sourcePg.stop().catch(() => undefined);
    }
    if (recoveryPg !== undefined) {
      await recoveryPg.stop().catch(() => undefined);
    }
    rmSync(join(tmpdir(), "erp-api-restore-drill-ga-source"), { recursive: true, force: true });
    rmSync(join(tmpdir(), "erp-api-restore-drill-ga-recovery"), { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  });
