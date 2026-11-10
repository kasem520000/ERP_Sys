/**
 * PHASE-021 W3 task 3-b — the E2E desktop-offline harness (MASTER-PLAN §10,
 * BINDING): the REAL desktop runtime in the Playwright Node process, exposed
 * to the exported Offline Console as an injected `window.__erpDesktop` test
 * double. NOTHING here mocks the system under test:
 *
 * - the local store is the REAL better-sqlite3 desktop adapter
 *   (`openDesktopStore` — WAL + FK + sync-core v1–3 + desktop v4–5
 *   migrations) over a per-journey temp SQLite file;
 * - the sync engine is the REAL `SyncDesktopHost` (W2 2-a) over the
 *   UNMODIFIED sync-core client + `runCycle`;
 * - the session is the REAL `DesktopSession` (W1 1-b, memory-only access
 *   token, primed with a non-expiring e2e token);
 * - the keychain is the REAL `MemoryKeychain` (W1 1-b);
 * - the permission snapshot is applied through the REAL 1-b
 *   `applyPermissionSnapshotPayload` (the `permissions` table rows + the
 *   D-04 `permissionSnapshotAt` watermark — exactly the shape
 *   apps/web `store-client.unlockSnapshot` reads);
 * - the ONLY double is the SERVER: `ScriptedSyncTransport`, an in-process
 *   SyncTransport implementing the REAL wire shapes (pull envelopes with
 *   nextCursor/serverTime/contractVersion, v2 per-item push results with
 *   the v2 extensions, status with the supported contract + device block)
 *   scripted as offline → online → PRICE_CHANGED rejection → resend
 *   ACCEPTED, modeled on sync-core's test-harness `FakeSyncServerV2`/
 *   `FaultTransport` patterns (chaos.ts) but inlined + honest.
 *
 * The bridge double wiring (page.exposeFunction + context.addInitScript)
 * mirrors the Tauri shell's injection point: every member maps 1:1 onto the
 * real runtime (sql.execute/query → store.run/all; sync.syncNow/pushNow →
 * host.syncNow/pushNow; print → capture; connectivity → a flippable flag)
 * and `apps/web`'s `detectBridge` validates the assembled shape — get it
 * structurally wrong and the console falls back to browser mode (the spec
 * asserts desktop mode first).
 */
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";

import type { BrowserContext } from "@playwright/test";
import {
  DesktopSession,
  MemoryKeychain,
  SyncDesktopHost,
  applyPermissionSnapshotPayload,
  openDesktopStore,
  type DesktopStore,
} from "@erp/desktop";
import type { PullEnvelope, PushItemResult, PushItemResultV2 } from "@erp/contracts";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";
import type { SyncTransport } from "@erp/sync-core";

// -- repository locations -----------------------------------------------------------

/**
 * The repo root, located ROBUSTLY: Playwright transpiles imported helper
 * modules into its own cache location (the helper's `__dirname` there is NOT
 * tests/e2e — verified: it resolved to the HOME dir, which once sent pnpm's
 * cwd hunting for a workspace through EACCES-denied reserve dirs). Walking
 * up from the worker's cwd (the invocation root) until pnpm-workspace.yaml
 * + package.json appear is stable regardless of where the transpiled module
 * lands; __dirname is only a fallback candidate.
 */
function findRepoRoot(): string {
  const starts: string[] = [process.cwd()];
  if (typeof __dirname === "string") starts.push(__dirname);
  for (const start of starts) {
    let current = resolve(start);
    for (let depth = 0; depth < 10; depth += 1) {
      if (existsSync(join(current, "pnpm-workspace.yaml")) && existsSync(join(current, "package.json"))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error("cannot locate the ERP repo root (pnpm-workspace.yaml + package.json) from the process cwd");
}

const repoRoot = findRepoRoot();
export const outDesktopDir = join(repoRoot, "apps", "web", "out-desktop");

/** The seeded world's stable ids (the MASTER-PLAN §0 2121… golden pattern). */
export const seeded = {
  deviceId: "21212121-0000-4000-8000-0000000021ee",
  itemEspressoId: "21212121-0000-4000-8000-00000000e201",
  itemLatteId: "21212121-0000-4000-8000-00000000e202",
  partnerId: "21212121-0000-4000-8000-00000000e301",
  taxCodeId: "21212121-0000-4000-8000-00000000e401",
  priceListId: "21212121-0000-4000-8000-00000000e501",
  priceListItemId: "21212121-0000-4000-8000-00000000e502",
  uomId: "21212121-0000-4000-8000-00000000e503",
  postedInvoiceId: "21212121-0000-4000-8000-00000000e601",
} as const;

/** The cached item the journey drafts against (the STALE local price). */
export const cachedItem = {
  id: seeded.itemEspressoId,
  sku: "ESP-001",
  name: "Espresso cup",
  nameAr: "كوب إسبريسو",
  basePrice: "12.5000",
} as const;

export const cachedItem2 = {
  id: seeded.itemLatteId,
  sku: "LAT-002",
  name: "Latte glass",
  nameAr: "كأس لاتيه",
  basePrice: "16.0000",
} as const;

export const cachedPartner = {
  id: seeded.partnerId,
  code: "CUST-001",
  name: "Elite Store",
  nameAr: "متجر النخبة",
} as const;

/** The cached permission keys the unlock screen lists in full mode. */
export const permissionKeys: readonly string[] = [
  "sales.documents.read",
  "sales.documents.write",
  "partners.read",
  "partners.write",
  "inventory.count.read",
  "offline.drafts.write",
];

/** The server's current price (the PRICE_CHANGED rejection payload). */
export const serverPrice = "18.7500";
/** The official number the RESEND acceptance stamps. */
export const resendOfficialNo = "INV-2026-9042";
/** The posted cached invoice (the row-32 reprint source). */
export const postedInvoice = {
  id: seeded.postedInvoiceId,
  docNo: "INV-2026-0042",
  totalGross: "115.0000",
} as const;

/** The as-of stamp every seeded cursor carries (2026-11-04T09:30:00Z). */
export const seededAsOfMs = Date.UTC(2026, 10, 4, 9, 30);

// -- the scripted server transport (the ONLY double) ---------------------------------

export type FaultPhase = "offline" | "online";

/**
 * The in-process scripted SyncTransport: REAL wire shapes, scripted phases.
 *
 * - phase "offline": every route throws a network error (the harness flips
 *   connectivity at the same moment — the shell watcher and the network are
 *   one reality).
 * - phase "online": status returns the supported contract + a live device;
 *   pull serves empty envelopes with nextCursor (the seeded caches ARE the
 *   pulled state); pushV2 ACCEPTS every command except the FIRST
 *   `sales_invoice:create_draft` push, which returns the per-item
 *   PRICE_CHANGED rejection carrying the server's current price + trace id;
 *   the RESEND (a NEW commandId — the console's accept-server-price path
 *   mints a fresh command + idempotency key) returns ACCEPTED with the
 *   official number.
 *
 * Every call is recorded for the spec's honest-state assertions.
 */
export class ScriptedSyncTransport implements SyncTransport {
  phase: FaultPhase = "offline";
  /** Per-journey trace id rendered inside the rejection message + details. */
  readonly rejectionTraceId: string;
  statusCalls = 0;
  readonly pullCalls: { entityType: string; cursor: string | null }[] = [];
  readonly pushV2Calls: { contractVersion: string; commands: readonly Record<string, unknown>[] }[] = [];
  legacyPushCalls = 0;
  readonly pullAcks: { entityType: string; cursor: string }[][] = [];
  readonly pushAcks: string[][] = [];

  private invoiceDraftPushes = 0;
  private accepted = 0;
  private readonly offlineError = new Error("e2e scripted network unreachable (offline phase)");

  constructor(rejectionTraceId: string) {
    this.rejectionTraceId = rejectionTraceId;
  }

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    void limit;
    if (this.phase === "offline") throw this.offlineError;
    this.pullCalls.push({ entityType, cursor });
    const position = cursor ?? "0";
    return {
      entityType,
      cursor: position,
      nextCursor: position,
      hasMore: false,
      changes: [],
      serverTime: new Date().toISOString(),
      contractVersion: SYNC_CONTRACT_VERSION,
    };
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]> {
    void batchId;
    this.legacyPushCalls += 1;
    // The v2 host never takes the legacy path (pushV2 is present); kept for
    // contract completeness with the same decision engine.
    const results = await this.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands });
    return results.map((result) =>
      result.status === "ACCEPTED"
        ? { id: result.id, status: "ACCEPTED" as const, idempotencyKey: result.idempotencyKey, result: result.result }
        : result.status === "REJECTED"
          ? {
              id: result.id,
              status: "REJECTED" as const,
              idempotencyKey: result.idempotencyKey,
              // The v2 registry widens the reason set (016-compat cast — the
              // same idiom sync-core's legacyPush adapter uses).
              reason: result.reason as PushItemResult extends { reason: infer R } ? R : never,
              message: result.message,
              action: result.action,
            }
          : {
              id: result.id,
              status: "DEFERRED" as const,
              idempotencyKey: result.idempotencyKey,
              reason: result.reason,
              message: result.message,
            },
    );
  }

  async status(): Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }> {
    if (this.phase === "offline") throw this.offlineError;
    this.statusCalls += 1;
    return {
      serverTime: new Date().toISOString(),
      contractVersion: SYNC_CONTRACT_VERSION,
      device: { revoked: false },
    };
  }

  async pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]> {
    if (this.phase === "offline") throw this.offlineError;
    this.pushV2Calls.push({ contractVersion: request.contractVersion, commands: [...request.commands] });
    return request.commands.map((raw) => this.decide(raw));
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    if (this.phase === "offline") throw this.offlineError;
    this.pullAcks.push([...positions]);
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    if (this.phase === "offline") throw this.offlineError;
    this.pushAcks.push([...commandIds]);
  }

  /** The per-command server decision (the §11 inbox-replay + rejection script). */
  private decide(raw: Record<string, unknown>): PushItemResultV2 {
    const commandId = typeof raw.commandId === "string" ? raw.commandId : String(raw.id ?? "");
    const idempotencyKey = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : commandId;
    const isInvoiceDraft = raw.entityType === "sales_invoice" && raw.intent === "create_draft";
    if (isInvoiceDraft) {
      this.invoiceDraftPushes += 1;
      if (this.invoiceDraftPushes === 1) {
        // The scripted PRICE_CHANGED rejection: the server's CURRENT price +
        // the rejecting response's trace id ride message + details (the
        // message renders verbatim in the outbox view; the details enable
        // accept-server-price and show in the server-response block).
        return {
          id: commandId,
          commandId,
          status: "REJECTED",
          idempotencyKey,
          reason: "PRICE_CHANGED",
          message: `unit price for line 1 changed on the server: ${cachedItem.basePrice} → ${serverPrice} (trace ${this.rejectionTraceId})`,
          details: {
            lineIndex: 0,
            itemId: cachedItem.id,
            serverPrice,
            providedPrice: cachedItem.basePrice,
            currency: "SAR",
            traceId: this.rejectionTraceId,
          },
          action: "ACCEPT_SERVER_PRICE",
          resubmittable: true,
        };
      }
    }
    this.accepted += 1;
    const officialNo = isInvoiceDraft ? resendOfficialNo : `DOC-E2E-${String(this.accepted).padStart(4, "0")}`;
    return {
      id: commandId,
      commandId,
      status: "ACCEPTED",
      idempotencyKey,
      result: { officialNo, invoiceId: commandId, journalEntryId: `je-${idempotencyKey}`, replay: false },
      officialNumber: officialNo,
      entity: { id: commandId, version: 1 },
      effects: { journalEntryIds: [`je-${idempotencyKey}`] },
    };
  }
}

// -- the per-journey real runtime ----------------------------------------------------

/** One journey's REAL desktop runtime + the captured bridge side effects. */
export interface DesktopWorld {
  readonly store: DesktopStore;
  readonly host: SyncDesktopHost;
  readonly transport: ScriptedSyncTransport;
  readonly session: DesktopSession;
  readonly keychain: MemoryKeychain;
  /** bridge.print.printHtml captures (the reprint journey). */
  readonly printedHtml: string[];
  /** bridge.print.printRaw captures. */
  readonly printedRaw: number[][];
  /** bridge.http.request captures (must stay EMPTY — the engine is shell-side). */
  readonly httpCalls: { method: string; url: string }[];
  /** bridge.updater.checkNow call count. */
  updaterChecks: number;
  /** The D-04 snapshot stamp (epoch ms) the unlock screen renders. */
  readonly snapshotAtMs: number;
  /** The temp dir holding the SQLite file (removed on close). */
  readonly tempDir: string;
  close(): void;
}

/**
 * Boot the REAL desktop runtime for one journey: temp-dir SQLite store
 * (fully migrated v1–5), the seeded cached world (items/partners/tax
 * codes/price list/posted invoice/cursors/meta), the permission snapshot
 * through 1-b's real applier, the memory-only session (primed), and the
 * SyncDesktopHost over the scripted transport.
 */
export function createDesktopWorld(locale: string): DesktopWorld {
  const tempDir = mkdtempSync(join(tmpdir(), `erp-e2e-desktop-${locale}-`));
  const store = openDesktopStore({ path: join(tempDir, "erp-desktop.sqlite") });
  const nowIso = new Date().toISOString();
  const snapshotAtMs = Date.now() - 3_600_000; // pulled an hour ago — inside the 7-day D-04 watermark

  // -- the cached read world (the frozen v1+v3 column lists, pull-applier shapes)
  store.run(
    `INSERT INTO items (id, sku, name, name_ar, kind, uom_id, category_id, tax_code_id, base_price,
                         track_batch, track_serial, track_imei, status, updated_at, dirty, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      cachedItem.id,
      cachedItem.sku,
      cachedItem.name,
      cachedItem.nameAr,
      "STOCK",
      seeded.uomId,
      null,
      seeded.taxCodeId,
      cachedItem.basePrice,
      0,
      0,
      0,
      "ACTIVE",
      nowIso,
      3,
    ],
  );
  store.run(
    `INSERT INTO items (id, sku, name, name_ar, kind, uom_id, category_id, tax_code_id, base_price,
                         track_batch, track_serial, track_imei, status, updated_at, dirty, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      cachedItem2.id,
      cachedItem2.sku,
      cachedItem2.name,
      cachedItem2.nameAr,
      "STOCK",
      seeded.uomId,
      null,
      null,
      cachedItem2.basePrice,
      0,
      0,
      0,
      "ACTIVE",
      nowIso,
      2,
    ],
  );
  store.run(
    `INSERT INTO partners (id, code, name, name_ar, kind, status, credit_limit, price_list_id, tax_number, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [cachedPartner.id, cachedPartner.code, cachedPartner.name, cachedPartner.nameAr, "CUSTOMER", "ACTIVE", "5000.0000", seeded.priceListId, "310000000000003", nowIso, 4],
  );
  store.run(
    `INSERT INTO tax_codes (id, code, name, name_ar, country_code, default_treatment, rate, status, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [seeded.taxCodeId, "VAT15", "VAT 15%", "ضريبة ١٥٪", "SA", "STANDARD", "15.0000", "ACTIVE", nowIso, 1],
  );
  store.run(
    `INSERT INTO price_list_items (id, price_list_id, item_id, uom_id, unit_price, min_qty, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [seeded.priceListItemId, seeded.priceListId, cachedItem.id, seeded.uomId, cachedItem.basePrice, "1", nowIso, 1],
  );
  store.run(
    `INSERT INTO sales_invoices (id, doc_no, partner_id, status, issue_date, total_gross, total_tax, currency,
                                  payload, version, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      postedInvoice.id,
      postedInvoice.docNo,
      cachedPartner.id,
      "POSTED",
      "2026-11-01",
      postedInvoice.totalGross,
      "15.0000",
      "SAR",
      JSON.stringify({
        storeName: { ar: "متجر النخبة", en: "Elite Store" },
        vatRegNo: "310000000000003",
        subtotal: "100.0000",
        lines: [{ nameAr: "كوب إسبريسو", name: "Espresso cup", qty: "2", unitPrice: "12.5000", lineTotal: "25.0000" }],
      }),
      3,
      "2026-11-01T10:00:00.000Z",
    ],
  );

  // -- the cursors: every desktop feed entity synced at the seeded as-of stamp
  //    (MAX(cursors.synced_at) is the AsOfLabel source). cursorCount stays
  //    absent — recoveryPass backfills it on the first cycle (absent ≠ mismatch).
  for (const entityType of [
    "items",
    "barcodes",
    "uoms",
    "price_list_items",
    "partners",
    "tax_codes",
    "pos_terminals",
    "cashier_shifts",
    "sales_invoices",
  ]) {
    store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES (?, ?, ?)", [entityType, "7", seededAsOfMs]);
  }

  // -- the meta runtime keys (v5 seeds deviceClass/contractVersion; the
  //    enrolled device id is a runtime-written value)
  store.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('enrolledDeviceId', ?)", [seeded.deviceId]);
  store.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('contractVersion', ?)", [SYNC_CONTRACT_VERSION]);

  // -- the permission snapshot through the REAL 1-b applier: the permissions
  //    table rows + the D-04 watermark in one call (the exact shape the
  //    unlock screen's unlockSnapshot() reads).
  applyPermissionSnapshotPayload(store, { permissions: [...permissionKeys], snapshotAt: snapshotAtMs });

  // -- the REAL session (memory-only) with a primed e2e token + a rotating
  //    refresh closure (never exercised unless the journey stalls past the
  //    15-min expiry — it will not).
  const session = new DesktopSession({
    getRefreshToken: async () => "e2e-refresh-token",
    refresh: async () => ({
      accessToken: "e2e-access-token-rotated",
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }),
  });
  session.prime("e2e-access-token", new Date(Date.now() + 14 * 60_000).toISOString());

  const transport = new ScriptedSyncTransport(`e2e-price-trace-${locale}`);
  const host = new SyncDesktopHost({ store, transport, session, deviceId: seeded.deviceId });

  const world: DesktopWorld = {
    store,
    host,
    transport,
    session,
    keychain: new MemoryKeychain(),
    printedHtml: [],
    printedRaw: [],
    httpCalls: [],
    updaterChecks: 0,
    snapshotAtMs,
    tempDir,
    close(): void {
      try {
        if (store.isOpen) store.close();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
  return world;
}

// -- the bridge double (page.exposeFunction + addInitScript) -------------------------

/**
 * Expose the bridge functions on a browser context and install the init
 * script that assembles `window.__erpDesktop` from them BEFORE the web
 * bundle boots (the Tauri shell's injection point). `withSyncDriver: false`
 * produces the DR-P21-09 older-shell posture — capabilities.sync undefined,
 * no `sync` member — which `detectBridge` still accepts and the console's
 * manual-sync affordances gate on.
 */
export async function attachDesktopBridge(
  context: BrowserContext,
  world: DesktopWorld,
  opts: { withSyncDriver: boolean },
): Promise<void> {
  // sql → the REAL store adapter (execute→run, query→all): every STORE_SQL
  // statement the console issues runs against the real SQLite file.
  // (exposeFunction serializes sync + async returns alike — the callbacks
  // return the store adapter's synchronous values directly.)
  await context.exposeFunction("__e2eSqlExecute", (sql: string, params?: unknown[]) => {
    world.store.run(sql, params);
  });
  await context.exposeFunction("__e2eSqlQuery", (sql: string, params?: unknown[]) =>
    world.store.all(sql, params),
  );
  // keychain → the REAL MemoryKeychain (in-memory, per-journey).
  await context.exposeFunction("__e2eKeychainGet", (name: string) => world.keychain.get(name));
  await context.exposeFunction("__e2eKeychainSet", (name: string, value: string) => {
    world.keychain.set(name, value);
  });
  await context.exposeFunction("__e2eKeychainDelete", (name: string) => {
    world.keychain.delete(name);
  });
  // http → capture-only: the console NEVER calls it (the sync engine is
  // shell-side); the spec asserts the capture stays empty.
  await context.exposeFunction("__e2eHttpRequest", (input: { method: string; url: string }) => {
    world.httpCalls.push({ method: input.method, url: input.url });
    return { status: 503, body: "{}" };
  });
  // updater → the up-to-date posture (checkNow recorded).
  await context.exposeFunction("__e2eUpdaterCheckNow", () => {
    world.updaterChecks += 1;
    return { status: "up-to-date", version: "0.1.0-e2e" };
  });
  await context.exposeFunction("__e2eUpdaterInstall", () => undefined);
  // system → a CURRENT WebView2 runtime (≥ the recommended 120.0.2210.61).
  await context.exposeFunction("__e2eSystemWebview2Version", () => "131.0.2903.86");
  await context.exposeFunction("__e2eSystemOsInfo", () => ({
    platform: "win32",
    release: "10.0.26100",
    arch: "x64",
  }));
  // print → capture (printRaw bytes / printHtml documents).
  await context.exposeFunction("__e2ePrintRaw", (bytes: number[]) => {
    world.printedRaw.push([...bytes]);
  });
  await context.exposeFunction("__e2ePrintHtml", (html: string) => {
    world.printedHtml.push(html);
  });
  // sync → the REAL host (DR-P21-09): the functions are exposed on every
  // profile; only the full profile's init script wires the `sync` member.
  await context.exposeFunction("__e2eSyncNow", () => world.host.syncNow());
  await context.exposeFunction("__e2ePushNow", () => world.host.pushNow());

  await context.addInitScript(buildBridgeInitScript(opts.withSyncDriver));
}

/**
 * The init script: assembles the structurally complete `__erpDesktop` from
 * the exposed functions. detectBridge (apps/web lib/shell/bridge.ts) checks
 * the version string, the six capability booleans (+ optional sync), and
 * every method group — this shape satisfies it exactly.
 */
function buildBridgeInitScript(withSyncDriver: boolean): string {
  return `
(() => {
  const onlineListeners = [];
  window.__e2eConnectivityOnline = true;
  window.__e2eSetOnline = (value) => {
    window.__e2eConnectivityOnline = value === true;
    for (const listener of [...onlineListeners]) listener(window.__e2eConnectivityOnline);
  };
  const capabilities = {
    keychain: true,
    sqlite: true,
    http: true,
    updater: true,
    print: true,
    webview2Probe: true,${withSyncDriver ? "\n    sync: true," : ""}
  };
  const bridge = {
    version: "e2e-harness",
    capabilities,
    keychain: {
      get: (name) => window.__e2eKeychainGet(name),
      set: (name, value) => window.__e2eKeychainSet(name, value),
      delete: (name) => window.__e2eKeychainDelete(name),
    },
    sql: {
      execute: (sql, params) => window.__e2eSqlExecute(sql, params),
      query: (sql, params) => window.__e2eSqlQuery(sql, params),
    },
    http: { request: (input) => window.__e2eHttpRequest(input) },
    updater: {
      checkNow: () => window.__e2eUpdaterCheckNow(),
      install: () => window.__e2eUpdaterInstall(),
    },
    system: {
      webview2Version: () => window.__e2eSystemWebview2Version(),
      osInfo: () => window.__e2eSystemOsInfo(),
    },
    print: {
      printRaw: (bytes) => window.__e2ePrintRaw(bytes),
      printHtml: (html) => window.__e2ePrintHtml(html),
    },
    connectivity: {
      onChange: (callback) => {
        onlineListeners.push(callback);
        return () => {
          const index = onlineListeners.indexOf(callback);
          if (index >= 0) onlineListeners.splice(index, 1);
        };
      },
      isOnline: () => window.__e2eConnectivityOnline === true,
    },
  };${
    withSyncDriver
      ? `
  bridge.sync = {
    syncNow: () => window.__e2eSyncNow(),
    pushNow: () => window.__e2ePushNow(),
  };`
      : ""
  }
  window.__erpDesktop = bridge;
})();
`;
}

// -- the desktop export build (once per run) + the static server ----------------------

/** The static file types the export serves (zero-dep http server). */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Build the desktop export (`pnpm --filter @erp/web build:desktop` — the
 * DR-P21-07 prebuild + ERP_TARGET=desktop next build, ~40 s). Built ONCE
 * per run and shared by both locale journeys.
 *
 * `E2E_SKIP_BUILD=1` reuses an existing out-desktop (the gate command builds
 * it explicitly when the in-spec build proves flaky in a CI context) — the
 * reuse is refused loudly when the export is missing.
 */
export function buildDesktopExport(): void {
  const indexPage = join(outDesktopDir, "ar", "offline.html");
  if (process.env.E2E_SKIP_BUILD === "1") {
    if (!existsSync(indexPage)) {
      throw new Error(
        "E2E_SKIP_BUILD=1 but apps/web/out-desktop is absent — run `pnpm --filter @erp/web build:desktop` first",
      );
    }
    return;
  }
  const result = spawnSync("pnpm", ["--filter", "@erp/web", "build:desktop"], {
    cwd: repoRoot,
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env },
  });
  if (result.stdout !== undefined && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== undefined && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  if (result.error !== undefined) {
    throw new Error(`build:desktop failed to spawn: ${String(result.error)}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `build:desktop failed (exit ${String(result.status)})\n` +
        `--- stdout tail ---\n${(result.stdout ?? "").slice(-4000)}\n` +
        `--- stderr tail ---\n${(result.stderr ?? "").slice(-4000)}`,
    );
  }
  if (!existsSync(indexPage)) {
    throw new Error("build:desktop completed but apps/web/out-desktop/ar/offline.html is missing");
  }
}

/** A running zero-dep static file server over the export directory. */
export interface StaticExportServer {
  readonly port: number;
  readonly origin: string;
  close(): Promise<void>;
}

/**
 * Serve `apps/web/out-desktop` statically: URLs map to files (with the
 * Next-export `page.html` fallback for extensionless routes), 404 otherwise.
 * No webServer config in playwright.config — the journeys inject the bridge
 * double per context, which a managed webServer cannot do.
 */
export async function startStaticExportServer(): Promise<StaticExportServer> {
  const server: Server = createServer((request, response) => {
    const fail = (status: number, text: string): void => {
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(text);
    };
    const rawPath = (request.url ?? "/").split("?")[0] ?? "/";
    let relative: string;
    try {
      relative = decodeURIComponent(rawPath);
    } catch {
      fail(400, "bad request");
      return;
    }
    if (relative.endsWith("/")) relative += "index.html";
    const candidate = normalize(join(outDesktopDir, relative));
    if (candidate !== outDesktopDir && !candidate.startsWith(outDesktopDir + sep)) {
      fail(403, "forbidden");
      return;
    }
    // Next 16 export layout: a route ships BOTH a payload DIRECTORY
    // (ar/unlock/ with .txt RSC payloads) and the sibling page document
    // (ar/unlock.html) — resolve documents first, payloads by direct path.
    let target: string | undefined;
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      const indexTarget = join(candidate, "index.html");
      target = existsSync(indexTarget) ? indexTarget : existsSync(candidate + ".html") ? candidate + ".html" : undefined;
    } else if (existsSync(candidate)) {
      target = candidate;
    } else if (!candidate.endsWith(".html") && existsSync(candidate + ".html")) {
      target = candidate + ".html";
    }
    if (target === undefined || !existsSync(target) || !statSync(target).isFile()) {
      fail(404, `not found: ${rawPath}`);
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(target).pipe(response);
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("static export server failed to bind an ephemeral port");
  }
  return {
    port: address.port,
    origin: `http://127.0.0.1:${String(address.port)}`,
    close(): Promise<void> {
      return new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
      });
    },
  };
}

/** The D6 cleanup: remove the transient, regenerable export after the run. */
export function removeDesktopExport(): void {
  rmSync(outDesktopDir, { recursive: true, force: true });
}
