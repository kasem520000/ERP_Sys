import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";

import { reloadEnv } from "../config/env";

/**
 * Shared handle to the suite database (written by global-setup.ts): specs
 * call `ensureTestDb()` first — it wires `process.env` so the application's
 * lazy singletons (db pool, pg-boss, S3 client) bind to the test server.
 *
 * A db spec that runs without the setup state fails loudly — never silently
 * against a developer's compose stack (ambient DATABASE_URL is ignored by
 * design when the state file is absent).
 */
export const TEST_STATE_FILE = join(tmpdir(), "erp-api-testdb-state.json");

export interface TestDbState {
  /** App-role URL (`erp_app`, non-owner, RLS enforced). */
  databaseUrl: string;
  /** Bootstrap/migrate-role URL — seeding + guard-trigger proofs only. */
  migrateUrl: string;
  /** s3rver endpoint ("" when the CI runner provides TEST_DATABASE_URL). */
  s3Endpoint: string;
  s3Bucket: string;
}

/** Deterministic tenant ids used across the attack suite. */
export const TENANT_A = "11111111-1111-1111-1111-111111111111";
export const TENANT_B = "22222222-2222-2222-2222-222222222222";

let state: TestDbState | undefined;

export function ensureTestDb(): TestDbState {
  if (state !== undefined) {
    return state;
  }
  state = JSON.parse(readFileSync(TEST_STATE_FILE, "utf8")) as TestDbState;
  process.env.DATABASE_URL = state.databaseUrl;
  process.env.S3_ENDPOINT = state.s3Endpoint;
  process.env.S3_ACCESS_KEY = "S3RVER";
  process.env.S3_SECRET_KEY = "S3RVER";
  process.env.S3_BUCKET = state.s3Bucket;
  // The env singleton was parsed at import time (before this bootstrap);
  // refresh it so every lazy consumer (pool, boss, S3) sees the test stack.
  reloadEnv();
  return state;
}

/** Fresh superuser (migrate-role) client — seeding + DDL fixtures. */
export async function superuserClient(): Promise<Client> {
  const testState = ensureTestDb();
  const client = new Client({ connectionString: testState.migrateUrl });
  await client.connect();
  return client;
}

/** Fresh app-role client (RLS enforced — the attacker's connection). */
export async function appClient(): Promise<Client> {
  const testState = ensureTestDb();
  const client = new Client({ connectionString: testState.databaseUrl });
  await client.connect();
  return client;
}

/** Idempotent seed of the two fixture tenants (as the bootstrap role). */
export async function seedTenants(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant A (test)', 'المستأجر أ', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant B (test)', 'المستأجر ب', 'YER', 'YE', 'Asia/Aden')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
}
