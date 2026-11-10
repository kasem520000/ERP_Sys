import { Client } from "pg";

/**
 * Dev/test role-credential provisioning (PHASE-002, docs/operations/
 * DEVELOPMENT_SETUP §Database): migrations deliberately create the runtime
 * roles WITHOUT passwords — SQL files never carry secrets (gitleaks).
 * Fresh stacks (compose, embedded test PG, Testcontainers) run this script
 * right after `drizzle-kit migrate` to assign the documented dev values;
 * production assigns real passwords out-of-band (SECRETS_MANAGEMENT).
 *
 * Fail-closed: refuses to run with NODE_ENV=production.
 */
const DEV_PASSWORDS: Readonly<Record<string, string>> = {
  erp_app: "erp_app",
  erp_readonly: "erp_readonly",
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "refusing to set dev credentials with NODE_ENV=production: assign real passwords out-of-band (SECRETS_MANAGEMENT)",
    );
  }
  const url = process.env.MIGRATE_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("MIGRATE_DATABASE_URL is required (bootstrap/migrate role connection)");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  for (const [role, password] of Object.entries(DEV_PASSWORDS)) {
    await client.query(`ALTER ROLE ${role} PASSWORD $1`, [password]);
    console.log(`[db-dev-credentials] ${role}: dev password set`);
  }
  await client.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
