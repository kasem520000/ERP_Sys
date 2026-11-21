/**
 * PHASE-049 W-19 — THE STANDALONE SCRATCH PROOF (the W-16/W-17/W-18 shape):
 * initdb a scratch embedded PG16 → apply the 111-chain from zero → run
 * check-rls against it → clean shutdown. One process, one log. Run
 * TWICE (السلسلة من الصفر مرتين) — both logs kept.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.SCRATCH_PORT ?? 5499);

async function main(): Promise<number> {
  const dataDir = join(tmpdir(), `erp-api-scratch-rls-${PORT}`);
  rmSync(dataDir, { recursive: true, force: true });

  console.log("SCRATCH_INITDB");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  console.log("SCRATCH_READY");
  await pg.start();
  await pg.createDatabase("erp");

  const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/erp`;
  const client = new Client({ connectionString: url });
  await client.connect();
  console.log("CHAIN_APPLYING");
  await client.end();

  const migrate = spawnSync(
    "pnpm",
    ["--filter", "@erp/api", "exec", "drizzle-kit", "migrate"],
    { env: { ...process.env, MIGRATE_DATABASE_URL: url }, encoding: "utf8" },
  );
  if (migrate.status !== 0) {
    console.log(migrate.stdout);
    console.error(migrate.stderr);
    await pg.stop();
    return 1;
  }
  console.log("CHAIN_111_APPLIED");

  console.log("RLS_CHECK");
  const rls = spawnSync("pnpm", ["run", "check:rls"], {
    env: { ...process.env, MIGRATE_DATABASE_URL: url },
    encoding: "utf8",
  });
  console.log(rls.stdout);
  console.error(rls.stderr);

  console.log("SCRATCH_STOPPING");
  await pg.stop();
  console.log("SCRATCH_STOPPED");
  return rls.status ?? 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
