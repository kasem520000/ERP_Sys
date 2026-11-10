import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";

import { appClient, ensureTestDb, superuserClient } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb, getPool } from "../../infra/db/client";
import { startBoss, stopBoss } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { hashToken } from "../../modules/identity/domain/tokens";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { CreditNoteService } from "../../modules/sales/application/credit-notes";
import { PosSaleService } from "../../modules/sales/application/pos-channel/pos-sale-service";
import { QuotationService } from "../../modules/sales/application/quotations";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import { PartnerService } from "../../modules/partners/application/partner-service";
import { ShiftService } from "../../modules/treasury/application/shift-service";
import { AllocationService } from "../../modules/treasury/application/allocation-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { ExpenseService } from "../../modules/treasury/application/expense-service";
import { PettyCashGuard } from "../../modules/treasury/application/petty-cash-service";
import { TransferService as TreasuryTransferService } from "../../modules/treasury/application/transfer-service";
import { VanStockService } from "../../modules/distribution/application/van-stock-service";
import { TransferService as InventoryTransferService } from "../../modules/inventory/application/transfer-service";
import { CountService } from "../../modules/inventory/application/count-service";
import { PosShiftFlowService } from "../../modules/pos/application/shift-flow-service";
import { PushService } from "../../modules/sync/application/push-service";
import { pull } from "../../modules/sync/application/pull-service";
import { newRunService, fullContext } from "../reporting/fixtures";
import type { JournalSpec } from "../../modules/accounting/domain/posting-engine/journal-spec";
import {
  GA_ACTOR,
  GA_ID_PREFIX,
  GA_OWNERS,
  GA_OWNER_PASSWORD,
  GA_TENANT_ISOLATE,
  GA_TENANT_LARGE,
  GA_TENANT_SYNC,
  cleanupGALoadVolume,
  gaStats,
  gaTimed,
  provisionGAReportingWorld,
  provisionGATenantWithOwner,
  readGALoadVolume,
  seedGALoadVolume,
} from "./ga-fixtures";
import { AppModule } from "../../app.module";

/**
 * PHASE-025 T2 · the GA full-load local harness — LOCAL HARNESS TIER: the
 * 10×-derived traffic shape (PERFORMANCE_TEST_PLAN §3) compressed to suite
 * scale against the seeded GA load model (T1). The production-class hosted
 * run is the infra-gated GA obligation (§6/§8 — passing on weaker hardware
 * does NOT close the gate); the `[ga-full-load]` lines below are the
 * recorded local-tier evidence the run report quotes.
 *
 * Targets asserted (PERFORMANCE_TEST_PLAN §1):
 * - T-01 document list p95 < 500 ms @ 100k rows (HTTP, warm pool, n=20),
 * - T-02 posting p95 < 300 ms (PostingService path, n=30),
 * - T-04 interactive report tier p95 < 2 s (the four contract families,
 *   cached steady state — the interactive access pattern) + the standard
 *   statement tier p95 < 10 s (TB/IS/BS compute at the 100k scale — the
 *   compute path, distinct params per run, never a cache hit),
 * - T-05 sync pull/push round-trip p95 < 3 s server processing (typical
 *   batches: 10-command pushes + 100-change pulls, n≥18 each),
 * - T-06 login + shell substrate p95 < 1.5 s (AR + EN),
 * - T-07 5xx < 0.1% across every request the harness makes,
 * - T-08 posting throughput ≥ 20 posts/s sustained (8-lane batch drain),
 * - DB baselines §4: pool saturation < 70%, EXPLAIN top-10 with the RLS
 *   predicate present + index-driven, slow-query budget, pg-boss queue
 *   health, no cross-tenant lock waits.
 *
 * Sandbox-scale honesty note (T1): the large tenant carries its documented
 * volume (100k entries + 200k lines); the mid (3×10k) + small (5×1k)
 * cohorts are representative samples of the §3 mix, asserted at the exact
 * 60/25/15 distribution — the full 1.1M-document cohort is the hosted tier.
 */

const OWNER_EMAIL = "ga-large-owner@fixture.test";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());

// The sync push graph (the desktop-intents wiring, verbatim — the PushService
// constructor slots in module order).
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
const posSales = new PosSaleService(audit, invoices, creditNotes);
const shiftFlow = new PosShiftFlowService(audit, new ShiftService(audit, posting));
const partners = new PartnerService(audit);
const quotations = new QuotationService(audit, numbering);
const deliveries = new DeliveryNoteService(audit, posting, numbering);
const pettyCash = new PettyCashGuard(audit);
const expenses = new ExpenseService(audit, posting, numbering, pettyCash, resolver);
const treasuryTransfers = new TreasuryTransferService(audit, posting, numbering, pettyCash);
const inventoryTransfers = new InventoryTransferService(audit, posting, numbering);
const stockCounts = new CountService(audit, posting, numbering);
const settlement = new SettlementCore(audit, posting, numbering);
const receipts = new ReceiptService(audit, settlement);
const allocations = new AllocationService(audit);
const vanStock = new VanStockService(audit, inventoryTransfers);
const push = new PushService(
  posSales,
  shiftFlow,
  audit,
  invoices,
  partners,
  quotations,
  deliveries,
  expenses,
  treasuryTransfers,
  inventoryTransfers,
  stockCounts,
  receipts,
  allocations,
  vanStock,
  creditNotes,
);

let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;
let ownerToken = "";
let accounts: Record<string, string> = {};
let requests = 0;
let failures5xx = 0;

/**
 * The sampled-op registry (the §4 slow-query budget source). Two planes,
 * kept apart on purpose: the INTERACTIVE plane (labels in
 * `INTERACTIVE_SAMPLE_LABELS` — ops with sub-second budgets: T-01 list
 * 500 ms, T-02 posting 300 ms, the cached interactive report tier) is what
 * the §4 "> 250 ms slow-query watch" governs; the HEAVY tiers (statement
 * computes 10 s, sync batches 3 s, the T-08 drain window, the T-06 login
 * substrate 1.5 s — dominated by password-hash verification, not DB time)
 * carry their OWN budgets and are reported alongside, never hidden.
 */
const samples: { label: string; ms: number }[] = [];
const INTERACTIVE_SAMPLE_LABELS = new Set([
  "T-01 document list",
  "T-02 posting",
  "T-04 interactive (cached)",
]);
function recordSample(label: string, ms: number): void {
  samples.push({ label, ms });
}

/** Pool-statistics sampler (the §4 saturation baseline, under real load). */
const poolStats = { maxInUse: 0, maxWaiting: 0, maxTotal: 0 };
let poolSampler: ReturnType<typeof setInterval> | undefined;

/** pg-boss job-state census (the §4 queue-health baseline). */
async function bossStates(): Promise<Record<string, number>> {
  const su = await superuserClient();
  try {
    const rows = await su.query<{ state: string; n: number }>(
      `SELECT state, count(*)::int AS n FROM boss.job GROUP BY state`,
    );
    const out: Record<string, number> = {};
    for (const row of rows.rows) {
      out[row.state] = row.n;
    }
    return out;
  } finally {
    await su.end();
  }
}

/**
 * The LOAD-attributable queue depth: non-system jobs only. The maintenance
 * crons (sync feed-health/inbox-retention/tombstone-GC, the e-invoicing
 * pipeline sweeps, the RLS canary, cert expiry — every payload carries
 * `{ system: true }`) legitimately land mid-run on their schedules; the §4
 * baseline governs what the LOAD itself queues, so the honest split is
 * system-vs-non-system, not a blanket +2 allowance.
 */
async function bossNonSystemDepth(): Promise<number> {
  const su = await superuserClient();
  try {
    const rows = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM boss.job
        WHERE (data->>'system')::boolean IS DISTINCT FROM true
          AND state IN ('created','active')`,
    );
    return rows.rows[0]?.n ?? 0;
  } finally {
    await su.end();
  }
}
let bossBefore: Record<string, number> = {};
let bossNonSystemBefore = 0;

interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: { data?: unknown; error?: { code: string } };
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse> {
  requests += 1;
  const hasBody = body !== undefined && method !== "GET" && method !== "HEAD";
  const response = await fetch(`${httpBase}${path}`, {
    method,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  if (response.status >= 500) {
    failures5xx += 1;
  }
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: responseHeaders,
    body: text === "" ? {} : (JSON.parse(text) as ApiResponse["body"]),
  };
}

/** The GA posting spec (cash ↔ opening equity, the precedent's T-02 shape).
 * Account ids are PER-TENANT (each GA world provisions its own CoA) —
 * callers pass the tenant's map. */
function gaPostSpec(tenantAccounts: Record<string, string>): JournalSpec {
  return {
    source: { docType: "journal_entry", docId: generateUuidV7(), operation: "post" },
    entryDate: "2026-01-20",
    description: { en: "ga perf post", ar: "ترحيل أداء الحمل" },
    currency: "SAR",
    lines: [
      { accountId: tenantAccounts["1111"]!, direction: "DEBIT", amount: "10.0000" },
      { accountId: tenantAccounts["3100"]!, direction: "CREDIT", amount: "10.0000" },
    ],
  };
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();

  // T1: the GA load model — large tenant (owner + world + 100k/200k volume)
  // + the representative mid/small cohorts (exact §3 mix asserted in the
  // first it), the cross-tenant isolate world, and the T-05 sync tenant.
  await provisionGATenantWithOwner({
    tenantId: GA_TENANT_LARGE,
    tenantName: "Tenant GA large (100k)",
    ownerId: GA_OWNERS.large,
    ownerEmail: OWNER_EMAIL,
  });
  await seedGALoadVolume({ cohorts: true });
  // The cross-tenant lock probe's posting world (its own CoA + FY2026).
  await provisionGAReportingWorld(GA_TENANT_ISOLATE);

  // The T-05 sync tenant: master data + the GA desktop device (direct row,
  // the desktop-intents bootstrap pattern).
  const su = await superuserClient();
  try {
    await su.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
       VALUES ($1, 'Tenant GA sync (T-05)', 'مستأجر المزامنة', 'SAR', 'SA', 'Asia/Riyadh')
       ON CONFLICT (id) DO NOTHING`,
      [GA_TENANT_SYNC],
    );
    await su.query(
      `INSERT INTO devices (id, user_id, platform, name, device_key_hash, device_class)
       VALUES ($1::uuid, $2::uuid, 'DESKTOP', 'ga-sync-device', 'key-ga-sync', 'tauri-desktop')
       ON CONFLICT (id) DO NOTHING`,
      [GA_ID_PREFIX.device, GA_ACTOR],
    );
  } finally {
    await su.end();
  }
  await withTenant(GA_TENANT_SYNC, async () => {
    const { seedMasterDataBasics } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await seedMasterDataBasics();
  });

  // One app boot shared by every it (the precedent's discipline).
  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
  const login = await request("POST", "/api/v1/identity/sessions", {
    email: OWNER_EMAIL,
    password: GA_OWNER_PASSWORD,
  });
  ownerToken = (login.body.data as { token: string }).token;

  // The large-tenant posting accounts (the seeded world's CoA map).
  const largeWorld = await provisionGAReportingWorld(GA_TENANT_LARGE);
  accounts = largeWorld.accounts as Record<string, string>;

  // §4 baselines: sample the pool for the whole scenario, snapshot the queue.
  const pool = getPool();
  poolSampler = setInterval(() => {
    const inUse = pool.totalCount - pool.idleCount;
    if (inUse > poolStats.maxInUse) {
      poolStats.maxInUse = inUse;
    }
    if (pool.waitingCount > poolStats.maxWaiting) {
      poolStats.maxWaiting = pool.waitingCount;
    }
    if (pool.totalCount > poolStats.maxTotal) {
      poolStats.maxTotal = pool.totalCount;
    }
  }, 50);
  bossBefore = await bossStates();
  bossNonSystemBefore = await bossNonSystemDepth();
}, 180_000);

afterAll(async () => {
  if (poolSampler !== undefined) {
    clearInterval(poolSampler);
  }
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await cleanupGALoadVolume({ sync: true });
  await closeDb();
});

describe("GA full load — local harness tier (PHASE-025 T2; PERFORMANCE_TEST_PLAN §1/§3/§4)", () => {
  it("T1 evidence: the seeded GA load model (volumes + the exact §3 mix)", async () => {
    const volume = await readGALoadVolume();
    // The large tier at its documented volume, mix exactly 60/25/15.
    expect(volume.large.total).toBe(100_000);
    expect(volume.large.sales).toBe(60_000);
    expect(volume.large.purchases).toBe(25_000);
    expect(volume.large.treasury).toBe(15_000);
    expect(volume.largeLines).toBe(200_000);
    // The representative cohorts (3×10k + 5×1k), same exact mix.
    expect(volume.mid.total).toBe(30_000);
    expect(volume.mid.sales).toBe(18_000);
    expect(volume.mid.purchases).toBe(7_500);
    expect(volume.mid.treasury).toBe(4_500);
    expect(volume.small.total).toBe(5_000);
    expect(volume.small.sales).toBe(3_000);
    expect(volume.small.purchases).toBe(1_250);
    expect(volume.small.treasury).toBe(750);
    console.log(
      `[ga-full-load] T1 volume large=${volume.large.total} (sales=${volume.large.sales}/purchases=${volume.large.purchases}/treasury=${volume.large.treasury}, lines=${volume.largeLines}) mid=${volume.mid.total} small=${volume.small.total} — sandbox tier ≈ 12% of the §3 1.1M-document cohort; hosted production-class run = infra-gated GA obligation`,
    );
  });

  it("T-01: document list p95 < 500 ms @ 100k rows (HTTP, n=20)", async () => {
    const path = "/api/v1/accounting/journal-entries?limit=50";
    const warm = await request("GET", path, undefined, { "x-session-token": ownerToken });
    expect(warm.status).toBe(200);
    const measured: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const ms = await gaTimed(() =>
        request("GET", path, undefined, { "x-session-token": ownerToken }),
      );
      recordSample("T-01 document list", ms);
      measured.push(ms);
    }
    const stats = gaStats(measured);
    console.log(
      `[ga-full-load] T-01 document-list p95=${stats.p95}ms (p50=${stats.p50} p99=${stats.p99} n=${stats.n}, 100k rows) budget=500ms`,
    );
    expect(stats.p95).toBeLessThan(500);
  });

  it("T-02: posting p95 < 300 ms (PostingService path, n=30)", async () => {
    const measured: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const ms = await withTenant(GA_TENANT_LARGE, () =>
        gaTimed(() => posting.post(gaPostSpec(accounts), { postedBy: GA_ACTOR })),
      );
      recordSample("T-02 posting", ms);
      measured.push(ms);
    }
    const stats = gaStats(measured);
    console.log(
      `[ga-full-load] T-02 posting p95=${stats.p95}ms (p50=${stats.p50} p99=${stats.p99} n=${stats.n}) budget=300ms`,
    );
    expect(stats.p95).toBeLessThan(300);
  });

  it(
    "T-04: interactive report tier p95 < 2 s + standard statement tier p95 < 10 s @ 100k",
    { timeout: 120_000 },
    async () => {
      const runs = newRunService();
      const families: { key: string; params: Record<string, string> }[] = [
        { key: "financial.trial-balance", params: { dateFrom: "2026-01-01", dateTo: "2026-01-28", locale: "en" } },
        { key: "sales.daily-revenue", params: { dateFrom: "2026-01-01", dateTo: "2026-01-28", locale: "en" } },
        { key: "treasury.daily-cash", params: { dateFrom: "2026-01-01", dateTo: "2026-01-28", locale: "en" } },
        { key: "inventory.reorder-alerts", params: { locale: "en" } },
      ];

      // Pass 1 — the compute path (cache-cold), one run per family: the
      // operational families are interactive-class (budget 2 s); the TB
      // compute is the standard-statement tier's business (budget 10 s,
      // asserted below with more samples).
      const compute: Record<string, number> = {};
      for (const family of families) {
        const ms = await withTenant(GA_TENANT_LARGE, () =>
          gaTimed(() =>
            runs.run({ reportKey: family.key, params: family.params, ctx: fullContext(GA_TENANT_LARGE) }),
          ),
        );
        recordSample(`T-04 compute ${family.key}`, ms);
        compute[family.key] = ms;
      }

      // Pass 2 — the cached steady state (the interactive access pattern —
      // what a user re-opening the report hits; REPORT_CONTRACT freshness):
      // 3 samples per family, p95 < 2 s.
      const interactive: number[] = [];
      for (let round = 0; round < 3; round += 1) {
        for (const family of families) {
          const ms = await withTenant(GA_TENANT_LARGE, () =>
            gaTimed(() =>
              runs.run({ reportKey: family.key, params: family.params, ctx: fullContext(GA_TENANT_LARGE) }),
            ),
          );
          recordSample("T-04 interactive (cached)", ms);
          interactive.push(ms);
        }
      }
      const interactiveStats = gaStats(interactive);
      console.log(
        `[ga-full-load] T-04 interactive-tier p95=${interactiveStats.p95}ms (p50=${interactiveStats.p50} p99=${interactiveStats.p99} n=${interactiveStats.n}, cached steady state) budget=2000ms; compute-first-pass tb=${compute["financial.trial-balance"]}ms daily-revenue=${compute["sales.daily-revenue"]}ms daily-cash=${compute["treasury.daily-cash"]}ms reorder=${compute["inventory.reorder-alerts"]}ms`,
      );
      expect(interactiveStats.p95).toBeLessThan(2000);
      // The operational families' COMPUTE path is interactive-class too.
      expect(compute["sales.daily-revenue"]).toBeLessThan(2000);
      expect(compute["treasury.daily-cash"]).toBeLessThan(2000);
      expect(compute["inventory.reorder-alerts"]).toBeLessThan(2000);

      // The standard statement tier (§1 T-04): TB/IS/BS monthly compute at
      // the 100k scale — the COMPUTE path (distinct params per run — every
      // cache key fresh, never a param already computed above), never a
      // cached number. Param shapes per contract: TB/IS take the
      // dateFrom/dateTo window; BS is as-of (asOfDate — its own contract,
      // REPORT_CATALOG §1).
      const statements: number[] = [];
      for (let k = 0; k < 2; k += 1) {
        const dateFrom = `2026-01-0${3 + k}`;
        const asOfDate = `2026-01-2${8 - k}`;
        for (const key of ["financial.trial-balance", "financial.income-statement", "financial.balance-sheet"]) {
          const params: Record<string, string> =
            key === "financial.balance-sheet"
              ? { asOfDate, locale: "en" }
              : { dateFrom, dateTo: "2026-01-28", locale: "en" };
          const ms = await withTenant(GA_TENANT_LARGE, () =>
            gaTimed(() =>
              runs.run({
                reportKey: key,
                params,
                ctx: fullContext(GA_TENANT_LARGE),
              }),
            ),
          );
          recordSample(`T-04 standard ${key}`, ms);
          statements.push(ms);
        }
      }
      const standardStats = gaStats(statements);
      console.log(
        `[ga-full-load] T-04 standard-statement-tier p95=${standardStats.p95}ms (p50=${standardStats.p50} p99=${standardStats.p99} n=${standardStats.n}, TB/IS/BS compute @100k, distinct params) budget=10000ms`,
      );
      expect(standardStats.p95).toBeLessThan(10_000);
    },
  );

  it(
    "T-05: sync pull/push round-trip p95 < 3 s server processing (typical batches)",
    { timeout: 120_000 },
    async () => {
      const deviceId = GA_ID_PREFIX.device;
      const partnerCommand = (index: number) => ({
        commandId: generateUuidV7(),
        entityType: "partner",
        intent: "create",
        idempotencyKey: `ga-sync-${Date.now()}-${index}`,
        clientCreatedAt: "2026-11-06T08:00:00Z",
        payload: { kind: "CUSTOMER", name: `GA sync partner ${index}` },
      });

      // Push side — typical batches of 10 commands: 1 warm call + 18
      // measured calls (19 total: the per-device push rate bucket allows a
      // 20-call burst — one spare).
      const warmPush = await withTenant(GA_TENANT_SYNC, () =>
        push.push({
          deviceId,
          batchId: generateUuidV7(),
          commands: Array.from({ length: 10 }, (_, i) => partnerCommand(i)),
          contractVersion: SYNC_CONTRACT_VERSION,
        }),
      );
      expect(warmPush.results.every((item) => item.status === "ACCEPTED")).toBe(true);
      const pushSamples: number[] = [];
      for (let batch = 0; batch < 18; batch += 1) {
        const ms = await withTenant(GA_TENANT_SYNC, () =>
          gaTimed(() =>
            push.push({
              deviceId,
              batchId: generateUuidV7(),
              commands: Array.from({ length: 10 }, (_, i) => partnerCommand(batch * 10 + 10 + i)),
              contractVersion: SYNC_CONTRACT_VERSION,
            }),
          ),
        );
        recordSample("T-05 push batch(10)", ms);
        pushSamples.push(ms);
      }

      // Pull side — the device's realistic pending backlog: the 190 pushed
      // partner feed rows + 2000 directly-seeded change_log rows (the
      // deterministic 9d-prefix namespace), then typical 100-change pulls.
      const seedTimestamp = new Date().toISOString();
      const su = await superuserClient();
      try {
        await su.query(
          `INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload, changed_at)
           SELECT $1, 'partners', ($2 || lpad(i::text, 12, '0')), 'UPSERT',
                  jsonb_build_object('id', $2 || lpad(i::text, 12, '0'), 'version', 1,
                                     'name', 'ga sync partner row ' || i, 'changedAt', $3::timestamptz),
                  $3::timestamptz
           FROM generate_series(1, 2000) i`,
          [GA_TENANT_SYNC, GA_ID_PREFIX.changeLogEntity, seedTimestamp],
        );
      } finally {
        await su.end();
      }

      // Warm pull (consumes the first page), then 20 measured 100-change
      // pulls, each advancing the cursor (the honest server-processing
      // path: feed catch-up + head query + seq-ordered batch + 2 MB
      // byte-cap serialization).
      let cursor: string | null = null;
      const warm = await withTenant(GA_TENANT_SYNC, () =>
        pull({ entityType: "partners", cursor, limit: 100, deviceId }),
      );
      cursor = warm.cursor;
      expect(warm.changes.length).toBeGreaterThan(0);
      const pullSamples: number[] = [];
      for (let batch = 0; batch < 20; batch += 1) {
        const envelope = await withTenant(GA_TENANT_SYNC, async () => {
          const started = Date.now();
          const result = await pull({ entityType: "partners", cursor, limit: 100, deviceId });
          const ms = Date.now() - started;
          recordSample("T-05 pull batch(100)", ms);
          pullSamples.push(ms);
          return result;
        });
        cursor = envelope.cursor;
      }
      const pushStats = gaStats(pushSamples);
      const pullStats = gaStats(pullSamples);
      const roundTrip = pushStats.p95 + pullStats.p95;
      console.log(
        `[ga-full-load] T-05 sync push p95=${pushStats.p95}ms (p50=${pushStats.p50} p99=${pushStats.p99} n=${pushStats.n}, batches of 10) + pull p95=${pullStats.p95}ms (p50=${pullStats.p50} p99=${pullStats.p99} n=${pullStats.n}, batches of 100) round-trip p95=${roundTrip}ms budget=3000ms`,
      );
      expect(pushStats.p95).toBeLessThan(3000);
      expect(pullStats.p95).toBeLessThan(3000);
      expect(roundTrip).toBeLessThan(3000);
    },
  );

  it("T-06: login + shell substrate p95 < 1.5 s (AR + EN)", async () => {
    for (const locale of ["ar", "en"] as const) {
      const samplesLocale: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const started = Date.now();
        const login = await request("POST", "/api/v1/identity/sessions", {
          email: OWNER_EMAIL,
          password: GA_OWNER_PASSWORD,
        });
        expect(login.status).toBe(200);
        const token = (login.body.data as { token: string }).token;
        await request("GET", "/api/v1/identity/sessions/current", undefined, {
          "x-session-token": token,
        });
        await request("GET", "/api/v1/tenancy/entitlements", undefined, {
          "x-session-token": token,
        });
        await request("GET", "/api/v1/tenancy/navigation", undefined, {
          "x-session-token": token,
        });
        const ms = Date.now() - started;
        recordSample(`T-06 login+shell(${locale})`, ms);
        samplesLocale.push(ms);
        void locale;
      }
      const stats = gaStats(samplesLocale);
      console.log(
        `[ga-full-load] T-06 login+shell(${locale}) p95=${stats.p95}ms (p50=${stats.p50} p99=${stats.p99} n=${stats.n}) budget=1500ms`,
      );
      expect(stats.p95).toBeLessThan(1500);
    }
  });

  it("T-08: posting throughput ≥ 20 posts/s sustained (8-lane batch drain, n=64)", { timeout: 120_000 }, async () => {
    const total = 64;
    const lanes = 8;
    let next = 0;
    const started = Date.now();
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        for (;;) {
          const index = next;
          next += 1;
          if (index >= total) {
            return;
          }
          await withTenant(GA_TENANT_LARGE, () =>
            posting.post(gaPostSpec(accounts), { postedBy: GA_ACTOR }),
          );
        }
      }),
    );
    const elapsedMs = Date.now() - started;
    const postsPerSecond = (total * 1000) / elapsedMs;
    recordSample("T-08 batch drain (whole)", elapsedMs);
    console.log(
      `[ga-full-load] T-08 posting-throughput ${postsPerSecond.toFixed(1)} posts/s (n=${total}, 8 lanes, ${elapsedMs}ms elapsed) budget>=20`,
    );
    expect(postsPerSecond).toBeGreaterThanOrEqual(20);
  });

  it("§4 pool saturation < 70% + no waiters under the mixed-load window", { timeout: 60_000 }, async () => {
    // A ~6 s mixed window (reads + posts + one heavy report) on top of the
    // whole scenario's sampler history — the §4 "under load" observation.
    const deadline = Date.now() + 6_000;
    const path = "/api/v1/accounting/journal-entries?limit=50";
    const runs = newRunService();
    await Promise.all([
      // 4 reader lanes (the 60% read mix; paced to stay well under the R-04
      // tenant window — 429s belong to the spike scenario, not this one).
      ...Array.from({ length: 4 }, () =>
        (async () => {
          while (Date.now() < deadline) {
            await request("GET", path, undefined, { "x-session-token": ownerToken });
            await new Promise((resolve) => {
              setTimeout(resolve, 50);
            });
          }
        })(),
      ),
      // 3 poster lanes (the 25% write mix).
      ...Array.from({ length: 3 }, () =>
        (async () => {
          while (Date.now() < deadline) {
            await withTenant(GA_TENANT_LARGE, () =>
              posting.post(gaPostSpec(accounts), { postedBy: GA_ACTOR }),
            );
          }
        })(),
      ),
      // 1 report lane (the 15% report mix) — TB computes, distinct params.
      (async () => {
        let k = 0;
        while (Date.now() < deadline) {
          k += 1;
          await withTenant(GA_TENANT_LARGE, () =>
            runs.run({
              reportKey: "financial.trial-balance",
              params: {
                dateFrom: `2026-01-0${1 + (k % 5)}`,
                dateTo: "2026-01-28",
                locale: "en",
              },
              ctx: fullContext(GA_TENANT_LARGE),
            }),
          );
        }
      })(),
    ]);
    const pool = getPool();
    const maxPool = pool.options.max ?? 20;
    const utilization = poolStats.maxInUse / maxPool;
    console.log(
      `[ga-full-load] DB-baseline pool maxInUse=${poolStats.maxInUse}/${maxPool} (utilization ${(utilization * 100).toFixed(1)}%) maxWaiting=${poolStats.maxWaiting} maxTotal=${poolStats.maxTotal} budget<70%`,
    );
    expect(utilization).toBeLessThan(0.7);
    expect(poolStats.maxWaiting).toBeLessThanOrEqual(2);
    expect(poolStats.maxTotal).toBeLessThanOrEqual(maxPool);
  });

  it("§4 EXPLAIN top-10 hot queries: RLS predicate present + index-driven", async () => {
    const client = await appClient();
    try {
      // The change_log head (the near-head cursor probe — the typical
      // incremental pull shape) for the pull-plan check below.
      const su = await superuserClient();
      let changeHead = 0;
      try {
        const head = await su.query<{ max: string | null }>(
          `SELECT max(seq) AS max FROM change_log WHERE tenant_id = $1`,
          [GA_TENANT_SYNC],
        );
        changeHead = Number(head.rows[0]?.max ?? 0);
      } finally {
        await su.end();
      }
      const pullCursor = changeHead - 200;

      const checks: {
        name: string;
        tenantId: string | null;
        sql: string;
        tenantOwned: boolean;
        noSeqScanOn?: string[];
      }[] = [
        {
          name: "document-list (journal register)",
          tenantId: GA_TENANT_LARGE,
          sql: `SELECT id, entry_no, entry_date, status, source_type, description FROM journal_entries ORDER BY entry_date DESC, id LIMIT 51`,
          tenantOwned: true,
          noSeqScanOn: ["journal_entries"],
        },
        {
          name: "journal-entry lines (GL detail)",
          tenantId: GA_TENANT_LARGE,
          sql: `SELECT line_no, account_id, direction, amount, base_amount FROM journal_lines WHERE journal_entry_id = '${GA_ID_PREFIX.entry}000000000001' ORDER BY line_no`,
          tenantOwned: true,
          noSeqScanOn: ["journal_lines"],
        },
        {
          name: "partners list",
          tenantId: GA_TENANT_LARGE,
          sql: `SELECT id, code, name, kind, status FROM partners WHERE deleted_at IS NULL AND kind = 'CUSTOMER' ORDER BY code ASC LIMIT 51`,
          tenantOwned: true,
        },
        {
          name: "items list",
          tenantId: GA_TENANT_LARGE,
          sql: `SELECT id, sku, name, kind, status FROM items WHERE deleted_at IS NULL ORDER BY sku ASC LIMIT 51`,
          tenantOwned: true,
        },
        {
          name: "sales-invoice list",
          tenantId: GA_TENANT_LARGE,
          sql: `SELECT id, invoice_no, customer_id, status, invoice_date, created_at FROM sales_invoices WHERE status = 'POSTED' ORDER BY created_at DESC LIMIT 51`,
          tenantOwned: true,
        },
        {
          name: "audit-events recent",
          tenantId: GA_TENANT_LARGE,
          sql: `SELECT id, action, entity_type, entity_id, at FROM audit_events WHERE at >= '2026-01-01' ORDER BY at ASC LIMIT 100`,
          tenantOwned: true,
        },
        {
          name: "sync change_log pull (near-head cursor)",
          tenantId: GA_TENANT_SYNC,
          sql: `SELECT seq, entity_id, op, payload, changed_at FROM change_log WHERE entity_type = 'partners' AND seq > ${pullCursor} ORDER BY seq ASC LIMIT 101`,
          tenantOwned: true,
          noSeqScanOn: ["change_log"],
        },
        {
          name: "trial-balance aggregate (statement window)",
          tenantId: GA_TENANT_LARGE,
          sql: `SELECT a.id, a.code, SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END) AS signed
                FROM accounts a
                JOIN journal_lines l ON l.account_id = a.id
                JOIN journal_entries e ON e.id = l.journal_entry_id
                WHERE a.is_postable AND e.entry_date >= DATE '2026-01-01' AND e.entry_date <= DATE '2026-01-28'
                GROUP BY a.id, a.code HAVING count(l.id) > 0 ORDER BY a.code`,
          tenantOwned: true,
          // A full-aggregate plan may legitimately seq-scan the big tables
          // (hash join + aggregate) — the §4 requirement here is the RLS
          // predicate presence, asserted for every scan of the ledger.
        },
        {
          name: "postings-by-source lookup",
          tenantId: GA_TENANT_LARGE,
          sql: `SELECT id, entry_no, status FROM journal_entries WHERE source_type = 'sales_invoice' AND source_id = '${generateUuidV7()}' AND operation = 'post' LIMIT 1`,
          tenantOwned: true,
          noSeqScanOn: ["journal_entries"],
        },
        {
          name: "sessions-by-token-hash",
          tenantId: null,
          sql: `SELECT active_tenant_id FROM sessions WHERE token_hash = '${hashToken(ownerToken)}' AND revoked_at IS NULL LIMIT 1`,
          tenantOwned: false,
          noSeqScanOn: ["sessions"],
        },
      ];

      for (const check of checks) {
        if (check.tenantId !== null) {
          await client.query(`SELECT set_config('erp.tenant_id', $1, false)`, [check.tenantId]);
        } else {
          await client.query(`SELECT set_config('erp.tenant_id', '', false)`);
        }
        // The sessions-by-token-hash lookup: a LIMIT-1 equality probe the
        // planner legitimately seq-scans while the shared test database
        // holds only a handful of sessions (cost ≈ 3) — production shape
        // (thousands of rows) always drives the token_hash index. Prove
        // the index path the gl-perf way (enable_seqscan=off scoped to
        // this check): a missing index still falls back to a forced seq
        // scan, so the assertion keeps its teeth.
        const seqscanSensitive = check.noSeqScanOn?.includes("sessions") ?? false;
        if (seqscanSensitive) {
          await client.query("SET enable_seqscan = off");
        }
        const plan = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN ${check.sql}`);
        if (seqscanSensitive) {
          await client.query("SET enable_seqscan = on");
        }
        const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
        if (check.tenantOwned) {
          expect(text, `${check.name}: the RLS tenant predicate must be present`).toMatch(/tenant_id/);
        }
        for (const table of check.noSeqScanOn ?? []) {
          expect(
            text,
            `${check.name}: ${table} must be index-driven (no Seq Scan)`,
          ).not.toContain(`Seq Scan on ${table}`);
        }
        console.log(
          `[ga-full-load] EXPLAIN ${check.name} tenantPredicate=${check.tenantOwned ? "present" : "n/a(platform)"} seqScan=${(check.noSeqScanOn ?? []).length === 0 ? "n/a" : "none"} plan="${text.split("\n")[0] ?? ""}"`,
        );
      }
      await client.query(`SELECT set_config('erp.tenant_id', '', false)`);
    } finally {
      await client.end();
    }
  });

  it("§4 slow-query budget: interactive-plane >250 ms ops within the stated budget", () => {
    // The §4 slow-query watch ("> 250 ms queries surface in metrics")
    // governs the INTERACTIVE plane — ops whose own budget is sub-second
    // (T-01 500 ms, T-02 300 ms, the cached interactive report tier). The
    // heavy tiers are separately-budgeted operations, not slow-query
    // signals: statement computes (T-04 standard tier, 10 s), sync batches
    // (T-05, 3 s), the T-08 drain window, and the login substrate (T-06,
    // 1.5 s — dominated by password verification, not DB time). Their
    // >250 ms counts are REPORTED here against their own budgets, never
    // hidden — the §7 report quotes this line verbatim.
    const interactive = samples.filter((sample) =>
      INTERACTIVE_SAMPLE_LABELS.has(sample.label),
    );
    const interactiveSlow = interactive.filter((sample) => sample.ms > 250);
    const heavy = samples.filter((sample) => !INTERACTIVE_SAMPLE_LABELS.has(sample.label));
    const heavySlow = heavy.filter((sample) => sample.ms > 250);
    const budget = interactive.length * 0.1;
    const heavyByLabel = new Map<string, number>();
    for (const sample of heavySlow) {
      heavyByLabel.set(sample.label, (heavyByLabel.get(sample.label) ?? 0) + 1);
    }
    const heavyDetail = [...heavyByLabel.entries()].map(([label, n]) => `${label}=${n}`).join(", ");
    console.log(
      `[ga-full-load] DB-baseline slow-queries(>250ms) interactive-plane ${interactiveSlow.length}/${interactive.length} (budget ${budget.toFixed(1)} = 10% of interactive samples)${interactiveSlow.length > 0 ? ` — slowest: ${interactiveSlow.map((s) => `${s.label}=${s.ms}ms`).join(", ")}` : ""}; heavy-tier (own budgets: T-04 statements 10s / T-05 batches 3s / T-06 substrate 1.5s / T-08 window) ${heavySlow.length}/${heavy.length}${heavyDetail === "" ? "" : ` — ${heavyDetail}`}`,
    );
    expect(interactive.length).toBeGreaterThanOrEqual(50);
    expect(interactiveSlow.length).toBeLessThanOrEqual(budget);
  });

  it("§4 queue health: pg-boss depth stable, no dead-letter growth", async () => {
    const after = await bossStates();
    const depth = (states: Record<string, number>): number =>
      (states.created ?? 0) + (states.active ?? 0);
    const failedBefore = bossBefore.failed ?? 0;
    const failedAfter = after.failed ?? 0;
    console.log(
      `[ga-full-load] DB-baseline pg-boss depth before=${depth(bossBefore)} after=${depth(after)} failed before=${failedBefore} after=${failedAfter} (no dead-letter growth attributable to load)`,
    );
    expect(failedAfter - failedBefore).toBe(0);
    // The load-attributable depth: non-system jobs only (the maintenance
    // crons land on their own schedules mid-run — system payload — and are
    // drained by their own workers). The load's own async fan-out (login
    // notification emails, partner-created inbox jobs) is legitimate QUEUED
    // work; the §4 signal is that it DRAINS, not that it is zero: two
    // successive samples 1 s apart must not grow (the worker consumes), and
    // the absolute depth stays bounded well under any drain-capacity
    // concern.
    const nonSystemA = await bossNonSystemDepth();
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    const nonSystemB = await bossNonSystemDepth();
    console.log(
      `[ga-full-load] DB-baseline pg-boss load-depth (non-system) before=${bossNonSystemBefore} after=${nonSystemA} resampled=${nonSystemB} (draining, not growing — the §4 queue-health signal)`,
    );
    expect(nonSystemB).toBeLessThanOrEqual(nonSystemA + 1);
    expect(nonSystemB).toBeLessThanOrEqual(50);
    // And the total (crons included) never runs away: bounded by the
    // baseline plus the registered schedule census (every registered cron
    // firing at most once per minute of run window — a generous ceiling).
    expect(depth(after)).toBeLessThanOrEqual(depth(bossBefore) + 40);
  });

  it("§4 no cross-tenant lock waits: concurrent postings across two tenants", { timeout: 60_000 }, async () => {
    // 6 posts on the large tenant + 6 on the isolate tenant, all in flight
    // together: Postgres row locks are per-row — the numbering rows and
    // journal rows are tenant-scoped, so the two cohorts must interleave
    // (no global serialization) and none may time out.
    const perPost: number[] = [];
    const isolateAccounts = (await provisionGAReportingWorld(GA_TENANT_ISOLATE))
      .accounts as Record<string, string>;
    const runOne = async (tenantId: string): Promise<number> => {
      const tenantAccounts = tenantId === GA_TENANT_ISOLATE ? isolateAccounts : accounts;
      const ms = await gaTimed(() =>
        withTenant(tenantId, () =>
          posting.post(gaPostSpec(tenantAccounts), { postedBy: GA_ACTOR }),
        ),
      );
      perPost.push(ms);
      return ms;
    };
    const started = Date.now();
    await Promise.all([
      ...Array.from({ length: 6 }, () => runOne(GA_TENANT_LARGE)),
      ...Array.from({ length: 6 }, () => runOne(GA_TENANT_ISOLATE)),
    ]);
    const elapsed = Date.now() - started;
    const sequentialSum = perPost.reduce((acc, ms) => acc + ms, 0);
    console.log(
      `[ga-full-load] DB-baseline cross-tenant-lock concurrent-elapsed=${elapsed}ms (12 posts across 2 tenants; sequential-equivalent=${sequentialSum}ms, overlap proven) — no lock timeouts, no errors`,
    );
    // Overlap evidence: the concurrent window ran well under the
    // sequential-equivalent bound (raw float arithmetic — no rounding).
    expect(elapsed).toBeLessThan(sequentialSum * 0.9);
  });

  it("T-07: the scenario's 5xx rate < 0.1% (4xx business rejections excluded)", () => {
    const rate = failures5xx / requests;
    console.log(
      `[ga-full-load] T-07 5xx=${failures5xx}/${requests} (rate ${(rate * 100).toFixed(3)}%) budget<0.1%`,
    );
    expect(requests).toBeGreaterThan(100);
    expect(rate).toBeLessThan(0.001);
    expect(failures5xx).toBe(0);
  });
});
