import { ensureTestDb, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PeriodService } from "../../modules/accounting/application/period-service";

/**
 * PHASE-025 T1 · the GA load-model fixtures (PERFORMANCE_TEST_PLAN §3 — the
 * deterministic volume generator). Sandbox-tier scaling, honestly documented:
 *
 * - The GA §3 load model is 1 large (≈100k documents) + 50 mid (≈10k) +
 *   500 small (≈1k) = 1.1M documents. 1.1M rows are NOT feasible inside the
 *   db-suite window (singleFork, one embedded PostgreSQL 16), so this
 *   generator seeds the documented LARGE tier at its full documented volume
 *   (100k journal_entries + 200k journal_lines — the T-01/T-04 pin scale)
 *   plus a REPRESENTATIVE cohort: 3 mid tenants × 10k + 5 small × 1k
 *   (135k rows ≈ 12% of the model's document count) with the §3 document
 *   mix distribution (60% sales / 25% purchases / 15% treasury) asserted
 *   EXACTLY at every tier. The production-class 10× run on the full cohort
 *   is the infra-gated GA obligation (PERFORMANCE_TEST_PLAN §6/§8: passing
 *   on weaker hardware does not close the gate); the [ga-full-load] numbers
 *   are the recorded local-harness tier evidence.
 *
 * - Determinism: fixed uuid namespaces per family (below) + generate_series
 *   bulk inserts (the mvp-candidate precedent's sanctioned path). NEVER any
 *   uuid from another spec's fixtures (the PHASE-023 48484848 lesson).
 *
 * - RLS: the volume seeds run as the superuser/migrate role with
 *   `session_replication_role = replica` (the mvp-candidate precedent), so
 *   the rows land without trigger side effects while every table keeps its
 *   RLS policy — all measured reads go through the app role (RLS enforced).
 *
 * - Realistic index state: ANALYZE after seeding (real planner statistics),
 *   never VACUUM FULL (no freshly-vacuumed utopia — PERFORMANCE_TEST_PLAN
 *   §3 "realistic index bloat maintained").
 *
 * ## Fixture uuid namespaces (each verified unused across apps/api/src)
 *
 * - journal_entries seed ids: `9b9b9b9b-0000-4000-8000-<12 digits>`
 *   (slot-encoded per tenant: slot × 1,000,000 + series index, so tenants
 *   never collide; cleanup deletes by the `9b9b9b9b-` prefix).
 * - journal_lines seed ids: `9c9c9c9c-0000-4000-8000-<12 digits>`
 *   (slot-encoded: slot × 2,000,000 + index × 2 + line − 1; 2 balanced
 *   lines per seeded entry on line-bearing tenants).
 * - change_log seed entity ids (text): `9d9d9d9d-0000-4000-8000-<12 digits>`.
 * - The GA sync device row: `9e9e9e9e-0000-4000-8000-0000000000de`.
 * - Tenant ids (house repeated-hex style): dcdcdcdc (large), dededede
 *   (cross-tenant isolate), dfdfdfdf (spike A), e7e7e7e7 (spike B),
 *   e8e8e8e8 (report-hammer small), e9e9e9e9 (T-05 sync), eaeaeaea (soak),
 *   ebebebeb/ecececec/edededed (mid cohort), efefefef/fdfdfdfd/fefefefe/
 *   9f9f9f9f/6e6e6e6e (small cohort).
 * - Users: the `6f6f6f6f-0000-4000-8000-` family (GA_ACTOR …0007).
 */

// -- tenants + actors -----------------------------------------------------------

/** The GA large tenant (100k documents — the T-01/T-04 pin scale). */
export const GA_TENANT_LARGE = "dcdcdcdc-dcdc-dcdc-dcdc-dcdcdcdcdcdc";
/** Cross-tenant lock-wait probe tenant (full posting world). */
export const GA_TENANT_ISOLATE = "dededede-dede-dede-dede-dededededede";
/** Spike scenario tenant A (saturates its R-04 window). */
export const GA_TENANT_SPIKE_A = "dfdfdfdf-dfdf-dfdf-dfdf-dfdfdfdfdfdf";
/** Spike scenario tenant B (isolation + recovery witness). */
export const GA_TENANT_SPIKE_B = "e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7";
/** Report-hammer small tenant (noisy-neighbor witness, 1k docs). */
export const GA_TENANT_SMALL = "e8e8e8e8-e8e8-e8e8-e8e8-e8e8e8e8e8e8";
/** T-05 sync tenant (push/pull measurement). */
export const GA_TENANT_SYNC = "e9e9e9e9-e9e9-e9e9-e9e9-e9e9e9e9e9e9";
/** Compressed-soak mid tenant (steady mid-load, 10k docs). */
export const GA_TENANT_SOAK = "eaeaeaea-eaea-eaea-eaea-eaeaeaeaeaea";
/** Mid cohort (3 × 10k — the representative §3 mid tier). */
export const GA_MID_COHORT: readonly string[] = Object.freeze([
  "ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb",
  "ecececec-ecec-ecec-ecec-ecececececec",
  "edededed-eded-eded-eded-edededededed",
]);
/** Small cohort (5 × 1k — the representative §3 small tier). */
export const GA_SMALL_COHORT: readonly string[] = Object.freeze([
  "efefefef-efef-efef-efef-efefefefefef",
  "fdfdfdfd-fdfd-fdfd-fdfd-fdfdfdfdfdfd",
  "fefefefe-fefe-fefe-fefe-fefefefefefe",
  "9f9f9f9f-9f9f-9f9f-9f9f-9f9f9f9f9f9f",
  "6e6e6e6e-6e6e-6e6e-6e6e-6e6e6e6e6e6e",
]);

/** The acting user for GA postings/runs (R_ACTOR-style, no login needed). */
export const GA_ACTOR = "6f6f6f6f-0000-4000-8000-0000000006f1";
/** Login-able owners (one per tenant that needs an HTTP session). */
export const GA_OWNERS = Object.freeze({
  large: "6f6f6f6f-0000-4000-8000-0000000006f2",
  isolate: "6f6f6f6f-0000-4000-8000-0000000006f3",
  spikeA: "6f6f6f6f-0000-4000-8000-0000000006f4",
  spikeB: "6f6f6f6f-0000-4000-8000-0000000006f5",
  small: "6f6f6f6f-0000-4000-8000-0000000006f6",
  soak: "6f6f6f6f-0000-4000-8000-0000000006f7",
});
/** One strong passphrase for every GA owner login (fixture-only). */
export const GA_OWNER_PASSWORD = "ga-load-scenario-strong-passphrase-25";

/** Seed id prefixes (cleanup deletes by these — see header). */
export const GA_ID_PREFIX = Object.freeze({
  entry: "9b9b9b9b-0000-4000-8000-",
  line: "9c9c9c9c-0000-4000-8000-",
  changeLogEntity: "9d9d9d9d-0000-4000-8000-",
  device: "9e9e9e9e-0000-4000-8000-0000000000de",
});

/** The §3 document mix (60/25/15) over the journal source_type vocabulary. */
export const GA_MIX = Object.freeze({
  sales: Object.freeze(["sales_invoice", "credit_note", "receipt"]),
  purchases: Object.freeze(["supplier_invoice", "payment"]),
  treasury: Object.freeze(["expense", "cash_transfer"]),
});

/** Seeded volumes per tier (entries; the large tier also gets 2 lines/entry). */
export const GA_VOLUME = Object.freeze({
  largeEntries: 100_000,
  midEntries: 10_000,
  smallEntries: 1_000,
});

// -- latency statistics (ADR-0009 house pattern: raw float arithmetic) ----------

/**
 * Rank-selected percentile of latency samples (ms). The Math.* ban
 * (ADR-0009) forbids rounding helpers; rank selection is the sanctioned
 * `no-restricted-properties` exemption (the mvp-candidate `p95()` shape) —
 * latency statistics, never money math.
 */
export function gaPercentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  // eslint-disable-next-line no-restricted-properties -- latency-statistics rank selection (ADR-0009 exemption), never money math.
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

/** The p50/p95/p99 evidence triple the §7 report template quotes. */
export function gaStats(samples: readonly number[]): {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: gaPercentile(sorted, 0.5),
    p95: gaPercentile(sorted, 0.95),
    p99: gaPercentile(sorted, 0.99),
    max: sorted.length === 0 ? 0 : (sorted[sorted.length - 1] ?? 0),
  };
}

/** Wall-clock ms around an async op (the precedent's `timed`). */
export async function gaTimed(fn: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await fn();
  return Date.now() - started;
}

// -- tenant provisioning --------------------------------------------------------

/**
 * Tenant + login-able owner (the mvp-candidate precedent's exact shape):
 * tenants row, users row (real password hash), an owner role cloned from the
 * global owner template (full permission set), and the single membership —
 * login binds this tenant (login-service picks the single active membership),
 * so the owner's session draws THAT tenant's R-04 budget.
 */
export async function provisionGATenantWithOwner(input: {
  tenantId: string;
  tenantName: string;
  ownerId: string;
  ownerEmail: string;
}): Promise<void> {
  ensureTestDb();
  const su = await superuserClient();
  try {
    await su.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
       VALUES ($1, $2, 'مستأجر الأداء', 'SAR', 'SA', 'Asia/Riyadh')
       ON CONFLICT (id) DO NOTHING`,
      [input.tenantId, input.tenantName],
    );
    const { PasswordService } = await import("../../modules/identity/application/password-service");
    const passwords = new PasswordService();
    await su.query(
      `INSERT INTO users (id, email, full_name, password_hash, status, locale)
       VALUES ($1, $2, 'GA Load Owner', $3, 'ACTIVE', 'ar')
       ON CONFLICT (id) DO NOTHING`,
      [input.ownerId, input.ownerEmail, await passwords.hashFromNewPassword(GA_OWNER_PASSWORD)],
    );
    const template = await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
    );
    const existing = await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'owner'`,
      [input.tenantId],
    );
    if (existing.rows.length === 0 && template.rows[0] !== undefined) {
      const { generateUuidV7 } = await import("@erp/domain-core");
      const roleId = generateUuidV7();
      await su.query(
        `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
         VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
        [roleId, input.tenantId],
      );
      await su.query(
        `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
         SELECT $1, $2, rp.permission_id FROM role_permissions rp
          JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
        [roleId, input.tenantId, template.rows[0].id],
      );
      await su.query(
        `INSERT INTO memberships (id, tenant_id, user_id, role_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [generateUuidV7(), input.tenantId, input.ownerId, roleId],
      );
    }
  } finally {
    await su.end();
  }
}

/** The posting/reporting world a GA tenant needs (the reporting-fixture
 * pattern, minimal subset): master data + CoA template + posting purposes +
 * FY2026 + a customer, returning the account map + FY2026-01 period id. */
export interface GAReportingWorld {
  periodId: string;
  customerId: string;
  /** CoA code → account id for the codes the seeds + postings touch. */
  accounts: Readonly<Record<string, string>>;
}

const worlds = new Map<string, GAReportingWorld>();
const periods = new PeriodService(new AuditService(new DrizzleAuditStore()));

const GA_ACCOUNT_CODES: readonly string[] = Object.freeze([
  "1111",
  "1130",
  "1140",
  "2110",
  "3100",
  "4100",
  "5100",
  "5210",
]);

export async function provisionGAReportingWorld(tenantId: string): Promise<GAReportingWorld> {
  const cached = worlds.get(tenantId);
  if (cached !== undefined) {
    return cached;
  }
  ensureTestDb();
  const su = await superuserClient();
  try {
    await su.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
       VALUES ($1, $2, 'مستأجر الأداء', 'SAR', 'SA', 'Asia/Riyadh')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, `Tenant GA world (${tenantId.slice(0, 8)})`],
    );
    await su.query(
      `INSERT INTO users (id, email, full_name, password_hash, status)
       VALUES ($1, 'ga-actor@fixture.test', 'GA Actor', 'x', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [GA_ACTOR],
    );
  } finally {
    await su.end();
  }
  const world = await withTenant(tenantId, async () => {
    const { seedMasterDataBasics, provisionCoaTemplate, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const store = await import("../../modules/accounting/infrastructure/accounting.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();
    const accounts: Record<string, string> = {};
    for (const code of GA_ACCOUNT_CODES) {
      const account = await store.findAccountByCode(code);
      if (account === undefined) {
        throw new Error(`GA fixture account ${code} missing (CoA template)`);
      }
      accounts[code] = account.id;
    }
    // The posting purposes T-02/T-08 need (cash ↔ opening equity legs).
    for (const [purposeKey, code] of [
      ["CASH", "1111"],
      ["OPENING_EQUITY", "3100"],
    ] as const) {
      const existing = await store.findActivePurpose(purposeKey);
      if (existing === undefined) {
        await insertAccountPurpose({ purposeKey, accountId: accounts[code]!, activeFrom: "2025-12-01" });
      }
    }
    // FY2026 (idempotent — createYear replays on the existing name).
    const existingYear = await store.findFiscalYearByName("FY2026");
    const yearId =
      existingYear?.id ??
      (await periods.createYear(GA_ACTOR, {
        name: "FY2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      })).id;
    const period = (await store.listPeriods(yearId)).find((row) => row.name === "FY2026-01");
    if (period === undefined) {
      throw new Error("GA fixture period FY2026-01 missing");
    }
    // The AR counterparty (INV-009 postings carry partners on control lines).
    const existingCustomer = await partnersStore.findPartnerByCode("GA-CUST-01");
    const customerId =
      existingCustomer?.id ??
      (await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "GA-CUST-01",
        name: "شركة الأداء",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      })).id;
    return { periodId: period.id, customerId, accounts };
  });
  worlds.set(tenantId, world);
  return world;
}

// -- T1: the deterministic volume seed ------------------------------------------

/**
 * The deterministic §3-mix journal source_type for a series index
 * (documented here; the SQL mirrors it exactly):
 * `(i - 1) % 20` → 0..11 sales (12/20 = 60%), 12..16 purchases (5/20 = 25%),
 * 17..19 treasury (3/20 = 15%); within a bucket the source types cycle.
 */
export function gaMixSourceType(index: number): string {
  const slot = (index - 1) % 20;
  if (slot <= 11) {
    return GA_MIX.sales[(index - 1) % GA_MIX.sales.length] ?? "sales_invoice";
  }
  if (slot <= 16) {
    return GA_MIX.purchases[(index - 1) % GA_MIX.purchases.length] ?? "supplier_invoice";
  }
  return GA_MIX.treasury[(index - 1) % GA_MIX.treasury.length] ?? "expense";
}

interface GATierSeed {
  tenantId: string;
  /** The id-namespace slot (entries: slot × 1M + i; lines: slot × 2M + i×2). */
  slot: number;
  entries: number;
}

/** FY2026-01 period id on a tenant (FY2026 created through the app path). */
async function resolveGAFY2026Period(tenantId: string): Promise<string> {
  return withTenant(tenantId, async () => {
    const store = await import("../../modules/accounting/infrastructure/accounting.store");
    const existingYear = await store.findFiscalYearByName("FY2026");
    const yearId =
      existingYear?.id ??
      (await periods.createYear(GA_ACTOR, {
        name: "FY2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      })).id;
    const period = (await store.listPeriods(yearId)).find((row) => row.name === "FY2026-01");
    if (period === undefined) {
      throw new Error(`GA fixture period FY2026-01 missing on ${tenantId}`);
    }
    return period.id;
  });
}

/** The §3-mix entry INSERT for one tier (the caller owns replica mode). */
async function insertGATierEntries(
  su: import("pg").Client,
  input: GATierSeed & { periodId: string },
): Promise<void> {
  await su.query(
    `INSERT INTO journal_entries (id, tenant_id, entry_date, fiscal_period_id, currency_code,
                                  source_type, source_id, operation, posted_at, posted_by, status, description)
     SELECT ($5 || lpad(($6 * 1000000 + i)::text, 12, '0'))::uuid, $1,
            DATE '2026-01-01' + (i % 28), $2, 'SAR',
            (CASE
               WHEN (i - 1) % 20 <= 11 THEN (ARRAY['sales_invoice','credit_note','receipt'])[1 + ((i - 1) % 3)]
               WHEN (i - 1) % 20 <= 16 THEN (ARRAY['supplier_invoice','payment'])[1 + ((i - 1) % 2)]
               ELSE (ARRAY['expense','cash_transfer'])[1 + ((i - 1) % 2)]
             END),
            NULL, 'post', now(), $3, 'POSTED', 'ga load row'
     FROM generate_series(1, $4) i`,
    [input.tenantId, input.periodId, GA_ACTOR, input.entries, GA_ID_PREFIX.entry, input.slot],
  );
}

/**
 * The balanced line pairs for one tier (1 debit + 1 credit per entry,
 * 10.0000 each — every entry balances, so the trial-balance debits=
 * credits assertion PASSES on the seeded volume): debits cycle 5
 * asset/expense codes, credits cycle 4 equity/liability/revenue codes.
 * Line ids are slot-encoded (slot × 2M + i × 2 + line − 1) — tiers never
 * collide on the global uuid PK.
 */
async function insertGATierLines(
  su: import("pg").Client,
  input: GATierSeed & { accounts: Readonly<Record<string, string>> },
): Promise<void> {
  const debitCodes = ["1111", "1130", "1140", "5100", "5210"];
  const creditCodes = ["4100", "2110", "3100", "1140"];
  for (let i = 0; i < debitCodes.length; i += 1) {
    await su.query(
      `INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id,
                                  direction, amount, base_amount)
       SELECT ($4 || lpad(($7 * 2000000 + i * 2)::text, 12, '0'))::uuid, $1,
              ($5 || lpad(($7 * 1000000 + i)::text, 12, '0'))::uuid, 1, $2, 'DEBIT', 10.0000, 10.0000
       FROM generate_series(1, $3) i
       WHERE (i - 1) % 5 = $6`,
      [
        input.tenantId,
        input.accounts[debitCodes[i]!]!,
        input.entries,
        GA_ID_PREFIX.line,
        GA_ID_PREFIX.entry,
        i,
        input.slot,
      ],
    );
  }
  for (let i = 0; i < creditCodes.length; i += 1) {
    await su.query(
      `INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id,
                                  direction, amount, base_amount)
       SELECT ($4 || lpad(($7 * 2000000 + i * 2 + 1)::text, 12, '0'))::uuid, $1,
              ($5 || lpad(($7 * 1000000 + i)::text, 12, '0'))::uuid, 2, $2, 'CREDIT', 10.0000, 10.0000
       FROM generate_series(1, $3) i
       WHERE (i - 1) % 4 = $6`,
      [
        input.tenantId,
        input.accounts[creditCodes[i]!]!,
        input.entries,
        GA_ID_PREFIX.line,
        GA_ID_PREFIX.entry,
        i,
        input.slot,
      ],
    );
  }
}

/**
 * Seed the GA load model (T1): the full volume generator — the large
 * tenant at its documented tier (100k entries + 200k lines) plus the
 * representative mid/small cohorts. Runs ANALYZE after the bulk inserts
 * (realistic planner state, no VACUUM FULL). Not idempotent by design
 * (id-prefix collisions on re-run) — the suite's fresh embedded DB per
 * run is the contract; `cleanupGALoadVolume` is the matching delete.
 */
export async function seedGALoadVolume(options?: {
  /** Include the mid + small representative cohorts (default true). */
  cohorts?: boolean;
}): Promise<{
  largeEntries: number;
  largeLines: number;
  midEntries: number;
  smallEntries: number;
}> {
  ensureTestDb();
  const cohorts = options?.cohorts ?? true;
  const su = await superuserClient();
  try {
    // The large tenant needs its posting/reporting world BEFORE the volume
    // seed (its lines reference real CoA accounts; its FY2026-01 period
    // anchors every entry).
    const largeWorld = await provisionGAReportingWorld(GA_TENANT_LARGE);
    const plan: GATierSeed[] = [
      { tenantId: GA_TENANT_LARGE, slot: 0, entries: GA_VOLUME.largeEntries },
    ];
    if (cohorts) {
      GA_MID_COHORT.forEach((tenantId, index) => {
        plan.push({ tenantId, slot: 1 + index, entries: GA_VOLUME.midEntries });
      });
      GA_SMALL_COHORT.forEach((tenantId, index) => {
        plan.push({ tenantId, slot: 5 + index, entries: GA_VOLUME.smallEntries });
      });
    }

    await su.query(`SET session_replication_role = replica`);
    for (const tier of plan) {
      // Cohort tenants carry no reporting world — they still need their
      // tenants row (the FY2026 createYear path runs through the app role
      // with FK + RLS triggers ON) and a REAL FY2026-01 period anchoring
      // every seeded entry.
      if (tier.tenantId !== GA_TENANT_LARGE) {
        await su.query(
          `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
           VALUES ($1, $2, 'مستأجر الأداء', 'SAR', 'SA', 'Asia/Riyadh')
           ON CONFLICT (id) DO NOTHING`,
          [tier.tenantId, `Tenant GA cohort (${tier.tenantId.slice(0, 8)})`],
        );
      }
      const periodId =
        tier.tenantId === GA_TENANT_LARGE
          ? largeWorld.periodId
          : await resolveGAFY2026Period(tier.tenantId);
      await insertGATierEntries(su, { ...tier, periodId });
    }
    await insertGATierLines(su, {
      tenantId: GA_TENANT_LARGE,
      slot: 0,
      entries: GA_VOLUME.largeEntries,
      accounts: largeWorld.accounts,
    });
    await su.query(`SET session_replication_role = DEFAULT`);

    // Realistic planner state: fresh statistics, never a vacuum utopia.
    await su.query(`ANALYZE journal_entries`);
    await su.query(`ANALYZE journal_lines`);

    const midEntries = cohorts ? GA_MID_COHORT.length * GA_VOLUME.midEntries : 0;
    const smallEntries = cohorts ? GA_SMALL_COHORT.length * GA_VOLUME.smallEntries : 0;
    return {
      largeEntries: GA_VOLUME.largeEntries,
      largeLines: GA_VOLUME.largeEntries * 2,
      midEntries,
      smallEntries,
    };
  } finally {
    await su.end();
  }
}

/**
 * Single-tenant volume seed (the report-hammer's small witness tenant): the
 * same §3 mix + balanced lines, one tier. Slot 4 is reserved for this use
 * (0 = large, 1–3 mids, 5–9 cohort smalls).
 */
export async function seedGASingleTenantVolume(input: {
  tenantId: string;
  slot: number;
  entries: number;
  withLines: boolean;
}): Promise<void> {
  ensureTestDb();
  const su = await superuserClient();
  try {
    const world = await provisionGAReportingWorld(input.tenantId);
    await su.query(`SET session_replication_role = replica`);
    await insertGATierEntries(su, {
      tenantId: input.tenantId,
      slot: input.slot,
      entries: input.entries,
      periodId: world.periodId,
    });
    if (input.withLines) {
      await insertGATierLines(su, {
        tenantId: input.tenantId,
        slot: input.slot,
        entries: input.entries,
        accounts: world.accounts,
      });
    }
    await su.query(`SET session_replication_role = DEFAULT`);
    await su.query(`ANALYZE journal_entries`);
    await su.query(`ANALYZE journal_lines`);
  } finally {
    await su.end();
  }
}

/** Re-query the seeded volumes + the §3 mix (the spec's assertion source). */
export async function readGALoadVolume(): Promise<{
  large: { total: number; sales: number; purchases: number; treasury: number };
  mid: { total: number; sales: number; purchases: number; treasury: number };
  small: { total: number; sales: number; purchases: number; treasury: number };
  largeLines: number;
}> {
  ensureTestDb();
  const su = await superuserClient();
  try {
    const readTier = async (tenantIds: readonly string[]): Promise<{
      total: number;
      sales: number;
      purchases: number;
      treasury: number;
    }> => {
      const rows = await su.query<{ source_type: string; n: number }>(
        `SELECT source_type, count(*)::int AS n FROM journal_entries
         WHERE id::text LIKE $1 AND tenant_id = ANY($2::uuid[])
         GROUP BY source_type`,
        [`${GA_ID_PREFIX.entry}%`, tenantIds],
      );
      let sales = 0;
      let purchases = 0;
      let treasury = 0;
      for (const row of rows.rows) {
        if ((GA_MIX.sales as readonly string[]).includes(row.source_type)) {
          sales += row.n;
        } else if ((GA_MIX.purchases as readonly string[]).includes(row.source_type)) {
          purchases += row.n;
        } else if ((GA_MIX.treasury as readonly string[]).includes(row.source_type)) {
          treasury += row.n;
        }
      }
      return { total: sales + purchases + treasury, sales, purchases, treasury };
    };
    const lines = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_lines WHERE id::text LIKE $1`,
      [`${GA_ID_PREFIX.line}%`],
    );
    return {
      large: await readTier([GA_TENANT_LARGE]),
      mid: await readTier(GA_MID_COHORT),
      small: await readTier(GA_SMALL_COHORT),
      largeLines: lines.rows[0]?.n ?? 0,
    };
  } finally {
    await su.end();
  }
}

/**
 * The matching cleanup (T1 discipline: every seed has one). Deletes by the
 * documented id prefixes only — replica mode (FK triggers off), lines first
 * (the cascade is trigger-driven and replica mode suspends it), then the
 * entries. Cohort tenants/worlds/owners persist (idempotent fixture rows,
 * the house pattern) — only the per-run volume + markers go.
 */
export async function cleanupGALoadVolume(options?: {
  /** Also drop the pushed sync partners + their feed rows (T-05 cleanup). */
  sync?: boolean;
}): Promise<void> {
  ensureTestDb();
  const su = await superuserClient();
  try {
    await su.query(`SET session_replication_role = replica`);
    await su.query(`DELETE FROM journal_lines WHERE id::text LIKE $1`, [
      `${GA_ID_PREFIX.line}%`,
    ]);
    await su.query(`DELETE FROM journal_entries WHERE id::text LIKE $1`, [
      `${GA_ID_PREFIX.entry}%`,
    ]);
    if (options?.sync === true) {
      await su.query(
        `DELETE FROM change_log WHERE entity_id LIKE $1
            OR entity_id IN (SELECT id::text FROM partners WHERE name LIKE 'GA sync partner%')`,
        [`${GA_ID_PREFIX.changeLogEntity}%`],
      );
      await su.query(`DELETE FROM inbox_commands WHERE device_id = $1::uuid`, [
        GA_ID_PREFIX.device,
      ]);
      await su.query(`DELETE FROM partners WHERE name LIKE 'GA sync partner%'`);
    }
    // The per-run posting markers (T-02/T-08/soak posts) — the precedent's
    // description-marker cleanup, replica path past the append-only guards.
    await su.query(
      `DELETE FROM journal_lines WHERE journal_entry_id IN
         (SELECT id FROM journal_entries WHERE description LIKE '%ga perf post%'
            OR description LIKE '%ga soak post%')`,
    );
    await su.query(
      `DELETE FROM journal_entries WHERE description LIKE '%ga perf post%'
         OR description LIKE '%ga soak post%'`,
    );
    // This suite's report runs (uuidv7 ids — scoped by the GA tenants).
    await su.query(`DELETE FROM report_runs WHERE tenant_id = ANY($1::uuid[])`, [
      [
        GA_TENANT_LARGE,
        GA_TENANT_ISOLATE,
        GA_TENANT_SMALL,
        GA_TENANT_SOAK,
        GA_TENANT_SYNC,
      ],
    ]);
    await su.query(`SET session_replication_role = DEFAULT`);
  } finally {
    await su.end();
  }
}
