/**
 * PHASE-050 W-24 — THE STANDALONE SCRATCH PROOF (the W-19/W-22/W-0 shape):
 * initdb a scratch embedded PG16 → apply the 116-chain from zero → run
 * check-rls against it → clean shutdown. One process, one log. Run
 * TWICE (السلسلة من الصفر مرتين) — both logs kept.
 *
 * Invocation (this session, disclosed in the wave README): from the
 * REPO ROOT — `pnpm --filter @erp/api exec tsx
 * audit-evidence/phase050-w24/scratch-rls-proof.ts` — the process cwd
 * is apps/api (pnpm --filter's own behavior), so the drizzle-kit binary
 * is invoked DIRECTLY (node_modules/.bin — the W-0 session's nested
 * `pnpm exec` fragility avoided; the wrapper's goal is one process, one
 * log) and check-rls runs through the repo root's tsx on the documented
 * script path.
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

  const drizzleBin = join(process.cwd(), "node_modules", ".bin", "drizzle-kit");
  const migrate = spawnSync(drizzleBin, ["migrate"], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATE_DATABASE_URL: url },
    encoding: "utf8",
    timeout: 180_000,
  });
  if (migrate.status !== 0) {
    console.log(migrate.stdout);
    console.error(migrate.stderr);
    await pg.stop();
    return 1;
  }
  console.log("CHAIN_116_APPLIED");

  console.log("RLS_CHECK");
  const rootTsx = join(process.cwd(), "..", "..", "node_modules", ".bin", "tsx");
  const rls = spawnSync(rootTsx, ["scripts/check-rls.ts"], {
    cwd: join(process.cwd(), "..", ".."),
    env: { ...process.env, MIGRATE_DATABASE_URL: url },
    encoding: "utf8",
    timeout: 120_000,
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
