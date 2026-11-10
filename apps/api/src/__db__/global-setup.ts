import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import S3rver from "s3rver";

import { TEST_STATE_FILE, type TestDbState } from "./test-db";

/**
 * vitest globalSetup for the DB suite (vitest.db.config.ts). Runs in its own
 * process before any spec: boots PostgreSQL + S3 + migrations, hands the
 * connection info to the specs through the state file (env is not shared
 * across processes), and tears everything down after the run.
 *
 * Paths:
 * 1. CI (Testcontainers job `scripts/ci/migration-tests.ts`): `TEST_DATABASE_URL`
 *    points at the container; migrations were applied by the runner — this
 *    setup only passes the URL through.
 * 2. Sandbox/local: embedded PostgreSQL 16 (the same major version as the
 *    compose stack) on a free port + `drizzle-kit migrate` + dev role
 *    passwords (migrations themselves never carry credentials).
 */

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL) {
    const state: TestDbState = {
      databaseUrl: process.env.TEST_DATABASE_URL,
      migrateUrl: process.env.TEST_MIGRATE_DATABASE_URL ?? process.env.TEST_DATABASE_URL,
      s3Endpoint: "",
      s3Bucket: "",
    };
    writeFileSync(TEST_STATE_FILE, JSON.stringify(state));
    return async () => {
      rmSync(TEST_STATE_FILE, { force: true });
    };
  }

  const dataDir = join(tmpdir(), "erp-api-testdb");
  rmSync(dataDir, { recursive: true, force: true });
  // S3 files live OUTSIDE the postgres data dir: initdb demands an empty dir.
  const s3Dir = join(tmpdir(), "erp-api-testdb-s3");
  rmSync(s3Dir, { recursive: true, force: true });
  mkdirSync(s3Dir, { recursive: true });

  const pgPort = await freePort();
  const migrateUrl = `postgres://postgres:postgres@127.0.0.1:${pgPort}/erp`;

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: pgPort,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("erp");

  // Apply the real migration chain (the same files CI applies).
  const migrate = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (migrate.status !== 0) {
    await pg.stop().catch(() => undefined);
    throw new Error(
      `drizzle-kit migrate failed (exit ${migrate.status}):\n${migrate.stdout}\n${migrate.stderr}`,
    );
  }

  // Dev credentials — same defaults as scripts/db-dev-credentials.ts.
  const bootstrap = new Client({ connectionString: migrateUrl });
  await bootstrap.connect();
  await bootstrap.query("ALTER ROLE erp_app PASSWORD 'erp_app'");
  await bootstrap.query("ALTER ROLE erp_readonly PASSWORD 'erp_readonly'");
  await bootstrap.end();

  // S3-compatible test server (dev compose uses MinIO; the suite uses s3rver).
  const s3Port = await freePort();
  const s3rver = new S3rver({
    port: s3Port,
    address: "127.0.0.1",
    silent: true,
    directory: s3Dir,
  });
  const s3Host = await new Promise<{ port: number; address: string }>(
    (resolve, reject) => {
      s3rver.run((error, host) => {
        if (error !== null || host === null) {
          reject(error ?? new Error("s3rver failed to start"));
        } else {
          resolve({ port: host.port, address: host.address });
        }
      });
    },
  );
  // Never trust the callback's reported address (may report the IPv6
  // loopback `::1`, which is not a valid URL host without brackets) — the
  // server is bound to 127.0.0.1 by construction.
  const s3Endpoint = `http://127.0.0.1:${s3Host.port}`;
  const s3Bucket = "erp-test-files";
  const s3 = new S3Client({
    region: "us-east-1",
    endpoint: s3Endpoint,
    credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" },
    forcePathStyle: true,
  });
  await s3.send(new CreateBucketCommand({ Bucket: s3Bucket }));

  const state: TestDbState = {
    databaseUrl: `postgres://erp_app:erp_app@127.0.0.1:${pgPort}/erp`,
    migrateUrl,
    s3Endpoint,
    s3Bucket,
  };
  writeFileSync(TEST_STATE_FILE, JSON.stringify(state));

  return async () => {
    await s3rver.close().catch(() => undefined);
    await pg.stop().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(s3Dir, { recursive: true, force: true });
    rmSync(TEST_STATE_FILE, { force: true });
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address !== null && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        reject(new Error("could not reserve a free port"));
      }
    });
  });
}
