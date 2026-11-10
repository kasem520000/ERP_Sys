import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

import { superuserClient } from "../../test-db";
import { closeDb } from "../../../infra/db/client";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../../modules/audit/infrastructure/drizzle-audit.store";
import { PartnerSubledgerService } from "../../../modules/partners/application/subledger-service";
import { PostingService } from "../../../modules/accounting/application/posting-service";
import { NumberingService } from "../../../modules/accounting/application/numbering-service";
import { SalesRepService } from "../../../modules/sales/application/reps";
import { AllocationService } from "../../../modules/treasury/application/allocation-service";
import { VanStockService } from "../../../modules/distribution/application/van-stock-service";
import { TransferService as InventoryTransferService } from "../../../modules/inventory/application/transfer-service";
import { pull as pullService, SyncEntityNotPulledError } from "../../../modules/sync/application/pull-service";
import { SyncDeviceRevokedError } from "../../../modules/sync/domain/sync-errors";
import { decodeCursor, encodeCursor } from "../../../modules/sync/application/cursor-tokens";
import { applyPullBatch, posAppliers, readCursor, resetCursor } from "../../../../../../packages/sync-core/src/store/pull";
import { SyncReadOnlyError } from "../../../../../../packages/sync-core/src/errors";
import { runCycle } from "../../../../../../packages/sync-core/src/cycle";
import type { SyncTransport } from "../../../../../../packages/sync-core/src/client";
import { seededRandom } from "../../../../../../packages/sync-core/src/test-harness/chaos";
import { metaGet, metaSet } from "../../../../../../packages/sync-core/src/store/adapter";
import type { ReferenceDevice } from "../../../../../../packages/sync-core/src/test-harness/reference-device";
import type { MobileStore } from "../../../../../../apps/mobile/src/store/store";
import { MobileSyncHost } from "../../../../../../apps/mobile/src/sync/host";
import { FakeScheduler, MobileSyncTriggers } from "../../../../../../apps/mobile/src/sync/triggers";
import {
  SYNC_BACKGROUND_MIN_INTERVAL_MS,
  SYNC_FOREGROUND_INTERVAL_MS,
} from "../../../../../../apps/mobile/src/constants";

import {
  countInbox,
  enrollDevice,
  HarnessTransport,
  journalCountForSource,
  ledgerOraclesHold,
  makeSyncServices,
  seedPosWorld,
  v2Command,
  type PosWorld,
} from "../_oracle";
import { disposeExpoFiles, expoDevice, expoPersonalDevice } from "./expo-device";

/**
 * PHASE-022 T-P22-3a · the FULL chaos matrix C-01…C-16 re-driven on the
 * EXPO device-class profile (MASTER-PLAN §9 — BINDING; SYNC_TESTS §5
 * device-matrix row "Field-sales phone (Expo Android, PHASE-022) | expo
 * SQLite | C-02, C-05, C-06, C-07, C-13 | battery/connectivity fault
 * profiles" + §7 PHASE-022 row "Full matrix against Expo/SQLite store;
 * battery/connectivity realism via fault profiles"): every scenario keeps
 * the 020/021 chaos-matrix SHAPE — real API services, real embedded PG,
 * the real sync-core SyncClient/ReferenceDevice through the in-process
 * HarnessTransport — but every device is constructed via `expoDevice()`:
 * the REAL `@erp/mobile` SQLite store (better-sqlite3, WAL, sync-core
 * v1–3 + the mobile field migrations v4/v5, deviceClass "android-field")
 * on a temp-dir file, with the app's pull-materialization seam
 * (van_stocks/routes/settlement_templates/statements → the mobile
 * tables) wrapped around the transport. The scenario numbering is the
 * canonical SYNC_TESTS §5 matrix (C-01 duplicate, C-02 reorder, C-03
 * partial batch, C-04 crash pre-ack, C-05 flap mid-pull, C-06 revoke,
 * C-07 clock skew, C-08 contract downgrade, C-09 drain with rejects,
 * C-10 two devices one draft, C-11 tombstone, C-12 cursor regression,
 * C-13 cross-tenant, C-14 suspension, C-15 tamper, C-16 storage-full) —
 * the FIELD-SALES emphasis set (C-02/C-05/C-06/C-07/C-13) is re-driven
 * with the field write intents (receipt / van confirm / credit-note
 * draft, DR-P22-06) and the battery/connectivity fault profiles
 * (airplane windows, Doze-deferred backgrounds ≥ 15 min, mid-sync
 * kills — the fault-soup variant at the end, deterministically seeded).
 *
 * Honest in-sim scope (MASTER-PLAN §0): no Android SDK/emulator in the
 * sandbox — expo-sqlite is the same SQLite engine as the node driver
 * (the harness is honest about everything except the cipher profile,
 * on-device only; see expo-device.ts). C-06/C-07/C-13 run here against
 * the real server semantics over the real store; the ON-DEVICE legs
 * (hardware clock/battery/radio realism) are the device-farm/CI wiring
 * recorded as the honest deferral — the PHASE-021 Windows-hardware
 * evidence posture.
 *
 * Dedicated tenant TENANT_EXPO "7e5d0000-0022-4000-8000-000000000022"
 * (verified unused across migrations + specs before use — the golden
 * constant; grep for the exact uuid). Seeded RNG per scenario
 * (SYNC_TESTS §9).
 */

const TENANT_EXPO = "7e5d0000-0022-4000-8000-000000000022";
const EXPO_OWNER = "7e5d0000-0022-4000-8000-00000000e001";
const EXPO_CASHIER = "7e5d0000-0022-4000-8000-00000000e002";
const EXPO_REP = "7e5d0000-0022-4000-8000-00000000e003";
/** The INACTIVE partner (the PARTNER_INACTIVE gate). */
const INACTIVE_PARTNER = "7e5d0000-0022-4000-8000-00000000e101";
/** The C-13 foreign tenant (a REAL second tenant; owned by this suite). */
const TENANT_FOREIGN = "8e7f0000-0022-4000-8000-000000000022";
const FOREIGN_USER = "8e7f0000-0022-4000-8000-000000008e01";

const INVOICE_NOTE_POSTED = "EXC credit-note reference invoice";
const VAN_CODE = "EXC-VAN-01";
const REP_CODE = "EXC-REP-01";
/** The receipt value dates (March — OPEN) + the December lock target. */
const COLLECTION_DATE = "2026-03-19";
const LOCKED_DATE = "2026-12-18";

const services = makeSyncServices();
let world: PosWorld;
let repId = "";
let vanId = "";
/** load #1 (itemA ×10, RECEIVED — the mirror substrate). */
const load1IdHolder: string[] = [];
/** load #2 (itemB ×5, IN_TRANSIT — C-02's confirm_load substrate). */
let load2Id = "";
/** load #3 (itemA ×5, IN_TRANSIT — C-09's confirm + double-confirm). */
let load3Id = "";
let postedInvoiceId = "";
let postedInvoiceLineId = "";
let openItemId = "";
let foreignItemId = "";
let foreignPartnerId = "";

// The seeding service graph (the field-intents.spec beforeAll shape —
// makeSyncServices' push drives the transports; these own the van world).
const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const inventoryTransfers = new InventoryTransferService(audit, posting, numbering);
const repService = new SalesRepService(audit);
const vans = new VanStockService(audit, inventoryTransfers);
const allocations = new AllocationService(audit);

/** Narrow to REJECTED for typed access. */
function asRejected(item: PushItemResultV2): Extract<PushItemResultV2, { status: "REJECTED" }> {
  if (item.status !== "REJECTED") {
    throw new Error(`expected a REJECTED item, got ${item.status}`);
  }
  return item;
}

/** Narrow to ACCEPTED for typed access. */
function asAccepted(item: PushItemResultV2): Extract<PushItemResultV2, { status: "ACCEPTED" }> {
  if (item.status !== "ACCEPTED") {
    throw new Error(`expected an ACCEPTED item, got ${item.status}`);
  }
  return item;
}

/** Direct services-level push (the 020 `pushV2` helper: real push service,
 * real tenant context — NOT through the transport, so transport call
 * counters stay meaningful). */
async function pushV2(deviceId: string, commands: unknown[], contractVersion = SYNC_CONTRACT_VERSION) {
  return withTenant(TENANT_EXPO, () =>
    services.push.push({ deviceId, batchId: generateUuidV7(), commands, contractVersion }),
  );
}

/** Row count of a tenant table (fixed internal literals only). */
async function countRows(table: string): Promise<number> {
  return withTenant(TENANT_EXPO, async () => {
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

/** One tenant-scoped row query (RLS world). */
async function oneRow(query: ReturnType<typeof sql>): Promise<Record<string, unknown> | undefined> {
  return withTenant(TENANT_EXPO, async () => {
    const rows = await requireTenantContext().tx!.execute(query);
    return (rows.rows as unknown as Record<string, unknown>[])[0];
  });
}

/** Lock + later reopen the period covering LOCKED_DATE (the push.spec
 * withDecemberLocked shape — softClose → lock → try/finally reopen). */
async function withPeriodLocked<T>(fn: () => Promise<T>): Promise<T> {
  const periodStore = await import("../../../modules/accounting/infrastructure/accounting.store");
  const period = await withTenant(TENANT_EXPO, () => periodStore.findPeriodForDate(LOCKED_DATE));
  expect(period).toBeDefined();
  await withTenant(TENANT_EXPO, () => services.periods.softClose(EXPO_OWNER, period!.id));
  await withTenant(TENANT_EXPO, () => services.periods.lock(EXPO_OWNER, period!.id));
  try {
    return await fn();
  } finally {
    await withTenant(TENANT_EXPO, () =>
      services.periods.reopen(EXPO_OWNER, period!.id, "PHASE-022 expo-chaos.spec December reopen"),
    );
  }
}

// -- the field write-intent capture helpers (DR-P22-06 shapes) --------------------------

/** A `receipt:create_field_collection` payload (money TEXT, ADR-0009). */
function receiptPayload(input: {
  amount?: string;
  valueDate?: string;
  partnerId?: string;
  allocations?: { openItemId: string; amount: string }[];
  reference?: string;
}) {
  return {
    partnerId: input.partnerId ?? world.customerId,
    cashAccountId: world.cashAccountId,
    method: "CASH" as const,
    currencyCode: "SAR",
    amount: input.amount ?? "10.0000",
    valueDate: input.valueDate ?? COLLECTION_DATE,
    collectedAt: "2026-03-19T08:30:00+03:00",
    ...(input.reference !== undefined ? { reference: input.reference } : {}),
    ...(input.allocations !== undefined ? { allocations: input.allocations } : {}),
  };
}

/** Capture a field collection on the device's FILE store (one
 * transaction: assertWritable + the v2 envelope + engine enqueue). */
function captureReceipt(
  device: ReferenceDevice,
  key: string,
  input: Parameters<typeof receiptPayload>[0] = {},
): string {
  return device.capture({
    entityType: "receipt",
    intent: "create_field_collection",
    payload: receiptPayload(input),
    idempotencyKey: key,
  });
}

/** Capture a `van:confirm_load` on the device's FILE store. */
function captureConfirmLoad(device: ReferenceDevice, key: string, transferId: string): string {
  return device.capture({
    entityType: "van",
    intent: "confirm_load",
    payload: { transferId, confirmedAt: "2026-03-19T07:00:00+03:00" },
    idempotencyKey: key,
  });
}

/** Capture a `van:confirm_unload` on the device's FILE store. */
function captureConfirmUnload(
  device: ReferenceDevice,
  key: string,
  lines: { itemId: string; qty: string }[],
): string {
  return device.capture({
    entityType: "van",
    intent: "confirm_unload",
    payload: {
      vanWarehouseId: vanId,
      toWarehouseId: world.warehouseId,
      lines,
      note: "end-of-day return",
      confirmedAt: "2026-03-19T16:45:00+03:00",
    },
    idempotencyKey: key,
  });
}

/** Capture a `credit_note:create_draft` on the device's FILE store. */
function captureCreditNoteDraft(device: ReferenceDevice, key: string): string {
  return device.capture({
    entityType: "credit_note",
    intent: "create_draft",
    payload: {
      invoiceId: postedInvoiceId,
      noteDate: "2026-03-18",
      note: "EXC van return",
      lines: [{ invoiceLineId: postedInvoiceLineId, qty: "1", returnToStock: true }],
    },
    idempotencyKey: key,
  });
}

/** Read one outbox row off the device's FILE store (typed columns). */
function outboxRowOf(store: MobileStore, commandId: string): Record<string, unknown> {
  const row = store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId]);
  if (row === undefined) {
    throw new Error(`no outbox row for ${commandId}`);
  }
  return row;
}

/** The current van mirror quantity for one item (null when the row
 * vanished — the mirror's HAVING <> 0 semantics). */
async function vanQty(itemId: string): Promise<string | null> {
  const row = await oneRow(sql`
    SELECT qty FROM van_stocks
    WHERE warehouse_id = ${vanId}::uuid AND item_id = ${itemId}::uuid LIMIT 1
  `);
  return row === undefined ? null : String(row.qty);
}

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_EXPO,
    name: "Tenant Expo Chaos (P22 3a)",
    nameAr: "مستأجر فوضى الجوال",
    prefix: "EXC",
    actor: EXPO_OWNER,
    cashier: EXPO_CASHIER,
    salesRep: EXPO_REP,
  });

  // The INACTIVE partner (the PARTNER_INACTIVE gate) — a live row, status
  // flipped server-side (the desktop-intents convention).
  const su = await superuserClient();
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $2, 'CUSTOMER', 'EXC-CUST-IN', 'Expo Fixture Inactive Partner')
     ON CONFLICT (id) DO NOTHING`,
    [INACTIVE_PARTNER, TENANT_EXPO],
  );
  await su.end();
  await withTenant(TENANT_EXPO, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`
      UPDATE partners SET status = 'INACTIVE', updated_at = now()
      WHERE id = ${INACTIVE_PARTNER}::uuid AND status = 'ACTIVE'
    `);
  });

  // The REAL distribution chain (the pull-fields/field-intents fixture
  // shape): rep + van + THREE loads — #1 RECEIVED (the mirror substrate:
  // itemA ×10), #2 + #3 IN_TRANSIT (the confirm_load substrates).
  await withTenant(TENANT_EXPO, async () => {
    const existingReps = await repService.list({ limit: 50 });
    repId =
      existingReps.find((r) => r.code === REP_CODE)?.id ??
      (
        await repService.create({
          code: REP_CODE,
          name: "EXC field rep",
          nameAr: "مندوب ميداني",
          email: null,
          phone: null,
          note: null,
          noteAr: null,
          actorId: EXPO_OWNER,
        })
      ).id;

    const { listVans } = await import("../../../modules/distribution/infrastructure/distribution.store");
    const existingVans = await listVans({ limit: 50 });
    vanId =
      existingVans.find((v) => v.code === VAN_CODE)?.id ??
      (
        await vans.registerVan({
          code: VAN_CODE,
          name: "Van 01",
          nameAr: "سيارة التوزيع ٠١",
          branchId: world.branchId,
          salesRepId: repId,
          actorId: EXPO_OWNER,
        })
      ).id;

    const openLoads = async (): Promise<string[]> => {
      const suOpen = await superuserClient();
      const rows = await suOpen.query<{ id: string }>(
        `SELECT t.id FROM stock_transfers t WHERE t.tenant_id = $1 AND t.status = 'IN_TRANSIT'
           AND t.to_warehouse_id = $2 ORDER BY t.created_at`,
        [TENANT_EXPO, vanId],
      );
      await suOpen.end();
      return rows.rows.map((row) => row.id);
    };

    // load #1 — itemA ×10, dispatched AND received (the mirror substrate).
    const mirrorCount = await oneRow(
      sql`SELECT count(*)::int AS n FROM van_stocks WHERE warehouse_id = ${vanId}::uuid`,
    );
    if (Number(mirrorCount?.n ?? 0) === 0) {
      const load = await vans.loadOut({
        fromWarehouseId: world.warehouseId,
        vanWarehouseId: vanId,
        lines: [{ itemId: world.itemA, qty: "10" }],
        note: "EXC morning load 1",
        noteAr: null,
        actorId: EXPO_REP,
      });
      load1IdHolder.push(load.id); // recorded for the evidence (unused by assertions)
      await vans.receiveTransfer(load.id, { actorId: EXPO_REP });
    }
    // loads #2 + #3 — IN_TRANSIT (the confirm_load substrates).
    let inTransit = await openLoads();
    if (inTransit.length < 1) {
      const load2 = await vans.loadOut({
        fromWarehouseId: world.warehouseId,
        vanWarehouseId: vanId,
        lines: [{ itemId: world.itemB, qty: "5" }],
        note: "EXC morning load 2",
        noteAr: null,
        actorId: EXPO_REP,
      });
      inTransit = [...inTransit, load2.id];
    }
    if (inTransit.length < 2) {
      const load3 = await vans.loadOut({
        fromWarehouseId: world.warehouseId,
        vanWarehouseId: vanId,
        lines: [{ itemId: world.itemA, qty: "5" }],
        note: "EXC morning load 3",
        noteAr: null,
        actorId: EXPO_REP,
      });
      inTransit = [...inTransit, load3.id];
    }
    load2Id = inTransit[0]!;
    load3Id = inTransit[1]!;
  });

  // The posted reference invoice (the credit note's POSTED reference + the
  // receipt allocation's AR open item) — the ensurePostedCreditInvoice
  // shape, idempotent by note.
  {
    const suInvoice = await superuserClient();
    const found = await suInvoice.query<{ id: string }>(
      `SELECT id FROM sales_invoices WHERE tenant_id = $1 AND note = $2 LIMIT 1`,
      [TENANT_EXPO, INVOICE_NOTE_POSTED],
    );
    const existing = found.rows[0]?.id;
    await suInvoice.end();
    if (existing !== undefined) {
      postedInvoiceId = existing;
    } else {
      const invoice = await withTenant(TENANT_EXPO, () =>
        services.invoices.create({
          branchId: world.branchId,
          customerId: world.customerId,
          salesRepId: null,
          kind: "CREDIT",
          invoiceDate: "2026-03-15",
          dueDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          orderId: null,
          deliveryId: null,
          warehouseId: world.warehouseId,
          cashAccountId: null,
          note: INVOICE_NOTE_POSTED,
          noteAr: null,
          actorId: EXPO_REP,
          lines: [
            {
              itemId: world.itemA,
              accountId: null,
              deliveryLineId: null,
              description: null,
              descriptionAr: null,
              qty: "2",
              unitPrice: "100.000000",
              discountAmount: null,
              taxCodeId: world.taxStd,
              batchId: null,
              serialIds: null,
              note: null,
            },
          ],
        }),
      );
      await withTenant(TENANT_EXPO, () => services.invoices.submit(invoice.id, EXPO_REP));
      await withTenant(TENANT_EXPO, () => services.invoices.approve(invoice.id, EXPO_OWNER, false));
      const posted = await withTenant(TENANT_EXPO, () => services.invoices.post(invoice.id, EXPO_OWNER));
      postedInvoiceId = posted.invoice.id;
    }
    const lineRow = await oneRow(sql`
      SELECT id FROM sales_invoice_lines WHERE invoice_id = ${postedInvoiceId}::uuid
      ORDER BY line_no LIMIT 1
    `);
    postedInvoiceLineId = String(lineRow?.id ?? "");
    const openItems = await withTenant(TENANT_EXPO, () =>
      allocations.openItems({ partnerId: world.customerId, side: "AR" }),
    );
    openItemId = openItems.find((item) => item.sourceType === "sales_invoice")?.id ?? "";
  }

  // The C-13 foreign tenant: minimal but REAL rows (a user, a uom, an
  // item, a partner) — the ids tenant A's device will reference.
  const suForeign = await superuserClient();
  await suForeign.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant Foreign (P22 3a C-13)', 'المستأجر الأجنبي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_FOREIGN],
  );
  await suForeign.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'p22-3a-foreign@fixture.test', 'P22 3a Foreign User', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_USER],
  );
  const uomId = generateUuidV7();
  foreignItemId = generateUuidV7();
  foreignPartnerId = generateUuidV7();
  await suForeign.query(
    `INSERT INTO uoms (id, tenant_id, code, name) VALUES ($1, $2, 'PCS', 'Pieces')
     ON CONFLICT (id) DO NOTHING`,
    [uomId, TENANT_FOREIGN],
  );
  await suForeign.query(
    `INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, base_price) VALUES
       ($1, $2, 'P22-EXPO-ITEM', 'P22 3a Foreign Item', 'STOCK', $3, '100.000000')
     ON CONFLICT (id) DO NOTHING`,
    [foreignItemId, TENANT_FOREIGN, uomId],
  );
  await suForeign.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $2, 'CUSTOMER', 'P22-EXPO-P1', 'P22 3a Foreign Partner')
     ON CONFLICT (id) DO NOTHING`,
    [foreignPartnerId, TENANT_FOREIGN],
  );
  await suForeign.end();
});

afterAll(async () => {
  disposeExpoFiles();
  await closeDb();
});

describe("PHASE-022 expo chaos matrix C-01…C-16 (SYNC_TESTS §5 field-sales phone profile; MASTER-PLAN §9)", () => {
  it("C-01 duplicate deliveries: receipt:create_field_collection delivered 4× from the FILE store → one ledger effect set, byte-equal inbox replays, the drain replays duplicate:true", async () => {
    const seed = 0xe01;
    console.log(`[C-01/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");
    const journalsBefore = await countRows("journal_entries");

    // Capture offline (the v2 envelope + outbox command, ONE file-backed
    // transaction), then deliver the SAME captured command 4 times (the
    // network-retry shape): the server inbox executes once, replays the
    // ORIGINAL result verbatim on deliveries 2–4.
    const commandId = captureReceipt(reference, "expo-c01-receipt-1", {
      amount: "230.0000",
      reference: "EXC-C01-001",
    });
    const command = JSON.parse(String(outboxRowOf(ed.store, commandId).payload)) as Record<string, unknown>;

    const first = asAccepted(
      (await transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [command] }))[0]!,
    );
    expect(first.status).toBe("ACCEPTED");
    expect(first).not.toHaveProperty("duplicate");
    expect(first.officialNumber).toMatch(/^RCV-\d{4}-\d{6}$/);
    for (let delivery = 2; delivery <= 4; delivery += 1) {
      const replay = asAccepted(
        (await transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [command] }))[0]!,
      );
      expect(replay.duplicate).toBe(true);
      const { duplicate: _dropped, ...rest } = replay;
      void _dropped;
      expect(rest).toEqual(first); // byte-equal replay (the ORIGINAL result)
    }

    // The device drain: the queued command pushes once more — the inbox
    // replays the original (duplicate:true), the FILE row lands ACKED with
    // the ORIGINAL official number, and the ledger still holds exactly one
    // effect set (INV-013).
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.duplicates).toBe(1);
    expect(await countRows("receipts")).toBe(receiptsBefore + 1);
    expect(await countRows("journal_entries")).toBe(journalsBefore + 1);
    const receiptId = first.result.receiptId as string;
    expect(await journalCountForSource(TENANT_EXPO, "receipt", receiptId)).toBe(1);
    const row = outboxRowOf(ed.store, commandId);
    expect(row.status).toBe("ACKED");
    expect(row.official_no).toBe(first.result.receiptNo as string);
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-02 reorder (FIELD EMPHASIS): the dependent van:confirm_unload arrives before its confirm_load predecessor → INSUFFICIENT_STOCK referencing the van snapshot (no orphans); the predecessor lands; the resubmission succeeds; the double-load rejects STALE_VERSION", async () => {
    const seed = 0xe02;
    console.log(`[C-02/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const movesBefore = await countRows("stock_moves");

    // (a) The premature dependent: the end-of-day unload of itemB whose
    // load has NOT been confirmed yet (the network reordered the two
    // device commands across batches). The van snapshot is the bound —
    // the mirror holds 0 itemB → the typed reject with the
    // machine-readable availableQty, zero orphans.
    const prematureId = captureConfirmUnload(reference, "expo-c02-unload-premature", [
      { itemId: world.itemB, qty: "5" },
    ]);
    const premature = await reference.cycle();
    expect(premature.rejected).toBe(1);
    expect(premature.accepted).toBe(0);
    const prematureRow = outboxRowOf(ed.store, prematureId);
    expect(prematureRow.status).toBe("REJECTED");
    expect(prematureRow.rejection_reason).toBe("INSUFFICIENT_STOCK");
    expect(prematureRow.rejection_action).toBe("EDIT_AND_RESEND");
    const prematureTyped = JSON.parse(String(prematureRow.last_error)) as {
      reason: string;
      resubmittable: boolean;
      details: { vanWarehouseId: string; itemId: string; availableQty: string; requestedQty: string };
    };
    expect(prematureTyped.resubmittable).toBe(true);
    expect(prematureTyped.details).toMatchObject({
      vanWarehouseId: vanId,
      itemId: world.itemB,
      availableQty: "0.000000",
      requestedQty: "5",
    });
    expect(await countRows("stock_moves")).toBe(movesBefore); // zero orphans

    // (b) The predecessor lands (captured on the same device): the load
    // confirmation receives the IN leg — the van mirror now holds itemB.
    const confirmId = captureConfirmLoad(reference, "expo-c02-confirm-load", load2Id);
    const confirmed = await reference.cycle();
    expect(confirmed.accepted).toBe(1);
    const confirmRow = outboxRowOf(ed.store, confirmId);
    expect(confirmRow.status).toBe("ACKED");
    expect(String(confirmRow.official_no)).toMatch(/^TRN-/);
    expect(await vanQty(world.itemA)).toBe("10.000000"); // load #1 still mirrored
    expect(await vanQty(world.itemB)).toBe("5.000000"); // the confirmed load #2

    // (c) The dependent is RESUBMITTED as a NEW command (CONFLICT_RESOLUTION
    // §3 — new commandId, fresh idempotencyKey): the whole itemB load
    // returns, the mirror row vanishes.
    const resubmitId = captureConfirmUnload(reference, "expo-c02-unload-resubmit", [
      { itemId: world.itemB, qty: "5" },
    ]);
    const resubmitted = await reference.cycle();
    expect(resubmitted.accepted).toBe(1);
    expect(outboxRowOf(ed.store, resubmitId).status).toBe("ACKED");
    expect(await vanQty(world.itemB)).toBeNull(); // the whole load returned — the row vanished

    // (d) The double-load drill: the load document is already POSTED — a
    // duplicate confirm rejects STALE_VERSION with the machine-readable
    // current status (the client re-pulls and re-applies).
    const doubleId = captureConfirmLoad(reference, "expo-c02-confirm-double", load2Id);
    const doubleCycle = await reference.cycle();
    expect(doubleCycle.rejected).toBe(1);
    const doubleRow = outboxRowOf(ed.store, doubleId);
    expect(doubleRow.rejection_reason).toBe("STALE_VERSION");
    const doubleTyped = JSON.parse(String(doubleRow.last_error)) as {
      resubmittable: boolean;
      details: { transferId: string; currentStatus: string };
    };
    expect(doubleTyped.details).toMatchObject({ transferId: load2Id, currentStatus: "POSTED" });
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-03 partial batch: 5 captured collections, #3 PERIOD_LOCKED → 4 ACKED + 1 typed REJECTED in the file, zero residue", async () => {
    const seed = 0xe03;
    console.log(`[C-03/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");
    const journalsBefore = await countRows("journal_entries");
    const commandIds: string[] = [];
    for (let n = 1; n <= 5; n += 1) {
      commandIds.push(
        captureReceipt(reference, `expo-c03-receipt-${n}`, {
          valueDate: n === 3 ? LOCKED_DATE : COLLECTION_DATE,
          reference: `EXC-C03-00${n}`,
        }),
      );
    }

    const outcome = await withPeriodLocked(() => reference.cycle());
    expect(outcome.pushed).toBe(5);
    expect(outcome.accepted).toBe(4);
    expect(outcome.rejected).toBe(1);

    // The file store's honest states: 4 ACKED + the typed reject.
    const statuses = commandIds.map((id) => String(outboxRowOf(ed.store, id).status));
    expect(statuses.filter((status) => status === "ACKED")).toHaveLength(4);
    const rejectedRow = outboxRowOf(ed.store, commandIds[2]!);
    expect(rejectedRow.status).toBe("REJECTED");
    expect(rejectedRow.rejection_reason).toBe("PERIOD_LOCKED");
    expect(rejectedRow.rejection_action).toBe("EDIT_AND_RESEND");
    expect(JSON.parse(String(rejectedRow.last_error))).toMatchObject({
      reason: "PERIOD_LOCKED",
      resubmittable: true,
      details: { entryDate: LOCKED_DATE, status: "LOCKED" },
    });
    // The wire-level shape (the 020 assertion surface): one direct
    // delivery in the SAME locked window carries the localized guidance.
    const wireProbe = asRejected(
      (
        await withPeriodLocked(() =>
          pushV2(deviceId, [
            v2Command(
              "receipt",
              "create_field_collection",
              "expo-c03-probe",
              receiptPayload({ valueDate: LOCKED_DATE, reference: "EXC-C03-009" }),
            ),
          ]),
        )
      ).results[0]!,
    );
    expect(wireProbe.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
    // Zero residue: 4 receipts, 4 journals — #3's partial draft rolled
    // back with its savepoint.
    expect(await countRows("receipts")).toBe(receiptsBefore + 4);
    expect(await countRows("journal_entries")).toBe(journalsBefore + 4);
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-04 crash post-commit pre-ack on the FILE: close + reopen the DB → recoveryPass IN_FLIGHT→QUEUED → the re-push replays the original result — no second journal", async () => {
    const seed = 0xe04;
    console.log(`[C-04/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");
    const journalsBefore = await countRows("journal_entries");

    // Capture offline (one file-backed transaction).
    const commandId = captureReceipt(reference, "expo-c04-receipt-1", { reference: "EXC-C04-001" });

    // The crash window: the server COMMITTED (push executed + inbox row
    // recorded) but the device never saw the response — the command stays
    // IN_FLIGHT and the result is dropped.
    reference.markInFlight([commandId]);
    const command = JSON.parse(String(outboxRowOf(ed.store, commandId).payload)) as Record<string, unknown>;
    const dropped = asAccepted(
      (await transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [command] }))[0]!,
    );
    expect(dropped.status).toBe("ACCEPTED"); // the server committed…
    expect(await countRows("receipts")).toBe(receiptsBefore + 1);
    expect(await countRows("journal_entries")).toBe(journalsBefore + 1);
    expect(reference.state().queue.inFlight).toBe(1);

    // CRASH (simulated): close the DB handle + reopen the SAME file — the
    // outbox row must still be IN_FLIGHT on disk, the boot recoveryPass
    // flips it QUEUED, integrity stays ok.
    const rebooted = ed.reopen();
    expect(
      rebooted.store.get("SELECT status FROM outbox WHERE command_id = ?", [commandId]),
    ).toMatchObject({ status: "IN_FLIGHT" });
    const recovery = rebooted.recover();
    expect(recovery.recoveredInFlight).toBe(1);
    expect(recovery.integrity).toBe("ok");

    // The full cycle re-pushes the SAME command — the inbox replays the
    // ORIGINAL result (duplicate:true), never a second execution.
    const outcome = await rebooted.device.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.duplicates).toBe(1);
    expect(outcome.rejected).toBe(0);
    expect(await countRows("receipts")).toBe(receiptsBefore + 1);
    expect(await countRows("journal_entries")).toBe(journalsBefore + 1);
    const receiptId = dropped.result.receiptId as string;
    expect(await journalCountForSource(TENANT_EXPO, "receipt", receiptId)).toBe(1);
    const row = outboxRowOf(rebooted.store, commandId);
    expect(row.status).toBe("ACKED");
    expect(row.official_no).toBe(dropped.result.receiptNo as string);
    await ledgerOraclesHold(TENANT_EXPO);
    rebooted.dispose();
  });

  it("C-05 connectivity flap mid-sync (FIELD EMPHASIS): a fetched page is discarded → the FILE cursor not advanced, nothing materialized; the re-pull from cursor N serves the same page; the full drain converges (items + the field feed caches)", async () => {
    const seed = 0xe05;
    console.log(`[C-05/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const flap = new FlapTransport(transport);
    const ed = expoDevice({ transport: flap, seed });
    const reference = ed.device;

    // The flap: fetch a page (limit 2), the connection drops — the page is
    // DISCARDED before any local commit (nothing in the cursors table,
    // nothing materialized).
    const page = await flap.pull("items", null, 2);
    expect(page.hasMore).toBe(true);
    expect(page.changes.length).toBe(2);
    expect(readCursor(reference.adapter, "items")).toBeNull();
    expect(ed.store.all("SELECT * FROM cursors")).toHaveLength(0);

    // Connectivity returns: the re-pull from the SAME cursor serves the
    // same page (pulls are idempotent; seq order is stable).
    const rePage = await flap.pull("items", null, 2);
    expect({ entityType: rePage.entityType, hasMore: rePage.hasMore, changes: rePage.changes }).toEqual(
      { entityType: page.entityType, hasMore: page.hasMore, changes: page.changes },
    );

    // The same discarded-page discipline on the FIELD feed: a van_stocks
    // page fetched then dropped never materializes a row.
    const vanPage = await flap.pull("van_stocks", null, 5);
    expect(vanPage.changes.length).toBeGreaterThan(0);
    expect(ed.store.all("SELECT * FROM van_stocks")).toHaveLength(0);
    expect(readCursor(reference.adapter, "van_stocks")).toBeNull();

    // The airplane window mid-cycle: every transport call fails, the
    // cycle degrades honestly (no cursor advancement without a full page
    // commit), then connectivity returns.
    flap.airplane = true;
    await expect(flap.pull("items", null, 2)).rejects.toThrow(/airplane/);
    expect(readCursor(reference.adapter, "items")).toBeNull();
    flap.airplane = false;

    // The full drain: the applied rows equal the feed's DISTINCT entity
    // ids — no duplicates, no gaps — persisted in the file (pullAll covers
    // the POS-subset base; the field feed rides the cycle below).
    const pulled = await reference.client.pullAll();
    const distinctIds = await withTenant(TENANT_EXPO, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(DISTINCT entity_id)::int AS n FROM change_log WHERE entity_type = 'items'
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(pulled.items).toBe(distinctIds);
    expect(ed.store.all("SELECT id FROM items")).toHaveLength(distinctIds);

    // The field caches materialize through the app's pull seam: the full
    // cycle pulls the field feed group (pullAll covers the POS-subset
    // base only) — the van mirror row (itemA ×10 from load #1) lands as
    // a TEXT-decimal row.
    const fieldCycle = await reference.cycle();
    expect(fieldCycle.pushed).toBe(0); // nothing queued — a pull-only drain
    const vanRows = ed.store.all("SELECT item_id, qty, value FROM van_stocks WHERE item_id = ?", [
      world.itemA,
    ]);
    expect(vanRows).toHaveLength(1);
    expect(vanRows[0]).toMatchObject({ qty: "10.000000", value: "600.0000" });
    expect(readCursor(reference.adapter, "van_stocks")).not.toBeNull();
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-06 revoke mid-queue (FIELD EMPHASIS): pull throws DEVICE_REVOKED, pushes per-item DEVICE_REVOKED, the FILE queue pending (no silent loss), queue unresolvable + surfaced, reconciliation lists the device", async () => {
    const seed = 0xe06;
    console.log(`[C-06/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");

    // One command executed + recorded server-side, its ack lost mid-queue.
    const ackedLostId = captureReceipt(reference, "expo-c06-receipt-1", { reference: "EXC-C06-001" });
    reference.markInFlight([ackedLostId]);
    const command = JSON.parse(String(outboxRowOf(ed.store, ackedLostId).payload)) as Record<string, unknown>;
    const executed = asAccepted(
      (await transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [command] }))[0]!,
    );
    expect(executed.status).toBe("ACCEPTED");
    expect(await countRows("receipts")).toBe(receiptsBefore + 1);

    // A second command still queued when the tenant revokes the device.
    const queuedId = captureReceipt(reference, "expo-c06-receipt-2", { reference: "EXC-C06-002" });
    await withTenant(TENANT_EXPO, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`UPDATE devices SET revoked_at = now() WHERE id = ${deviceId}::uuid`);
    });

    // Pulls: refused BEFORE anything is served (typed exception).
    await expect(
      withTenant(TENANT_EXPO, () => pullService({ entityType: "items", cursor: null, deviceId })),
    ).rejects.toBeInstanceOf(SyncDeviceRevokedError);
    await expect(transport.pull("items", null)).rejects.toMatchObject({ code: "DEVICE_REVOKED" });
    await expect(transport.pull("van_stocks", null)).rejects.toMatchObject({ code: "DEVICE_REVOKED" });

    // Pushes: per-item DEVICE_REVOKED, zero execution.
    const { results } = await pushV2(deviceId, [
      v2Command(
        "receipt",
        "create_field_collection",
        "expo-c06-direct-1",
        receiptPayload({ reference: "EXC-C06-101" }),
      ),
      v2Command(
        "receipt",
        "create_field_collection",
        "expo-c06-direct-2",
        receiptPayload({ reference: "EXC-C06-102" }),
      ),
    ]);
    expect(results).toHaveLength(2);
    for (const raw of results) {
      const item = asRejected(raw);
      expect(item).toMatchObject({
        status: "REJECTED",
        reason: "DEVICE_REVOKED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect(item.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
    }
    expect(await countRows("receipts")).toBe(receiptsBefore + 1);
    expect(await countInbox(TENANT_EXPO, deviceId)).toBe(1);

    // The client cycle: revocation surfaced, NO push attempted (the
    // transport saw exactly the one pre-revoke push).
    const outcome = await reference.cycle();
    expect(outcome.deviceRevoked).toBe(true);
    expect(outcome.pushed).toBe(0);
    expect(transport.pushCalls).toHaveLength(1);
    const state = reference.state();
    expect(state.meta.queueUnresolvable).toBe("DEVICE_REVOKED");
    // BOTH commands stay QUEUED in the FILE (no silent loss): the
    // never-pushed one AND the executed-but-unacked one (the cycle's boot
    // recovery returned the IN_FLIGHT row to the queue).
    expect(state.queue.pending).toBe(2);
    for (const row of ed.store.all("SELECT status FROM outbox")) {
      expect(row.status).toBe("QUEUED");
    }
    expect(outboxRowOf(ed.store, queuedId).status).toBe("QUEUED");

    // The reconciliation queue lists the device (the un-acked command).
    const queue = await withTenant(TENANT_EXPO, () => services.reconciliation.pendingOperations());
    const entry = queue.find((row) => row.deviceId === deviceId);
    expect(entry).toBeDefined();
    expect(entry!.pendingCommands).toBe(1);
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-07 clock skew ±48h (FIELD EMPHASIS): the captured command's advisory timestamps are ignored — server-authoritative ledger dates (valueDate + the server clock), same-second dedupe by id", async () => {
    const seed = 0xe07;
    console.log(`[C-07/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const now = Date.now();
    const futureClient = new Date(now + 48 * 3_600_000).toISOString();
    const pastClient = new Date(now - 48 * 3_600_000).toISOString();

    const receiptsBefore = await countRows("receipts");

    // (a) Direct deliveries with skewed clientCreatedAt (±48h extremes):
    // accepted, but the journal carries the BUSINESS date (valueDate) +
    // the server clock (never the skewed client time).
    const futureCommand = v2Command(
      "receipt",
      "create_field_collection",
      "expo-c07-future",
      receiptPayload({ reference: "EXC-C07-001" }),
      { clientCreatedAt: futureClient },
    );
    const pastCommand = v2Command(
      "receipt",
      "create_field_collection",
      "expo-c07-past",
      receiptPayload({ reference: "EXC-C07-002" }),
      { clientCreatedAt: pastClient },
    );
    const { results } = await pushV2(deviceId, [futureCommand, pastCommand]);
    expect(results.map((item) => item.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
    for (const item of results) {
      const receiptId = asAccepted(item).result.receiptId as string;
      const rows = await withTenant(TENANT_EXPO, async () => {
        const tx = requireTenantContext().tx!;
        const entry = await tx.execute(sql`
          SELECT je.entry_date AS "entryDate", je.posted_at AS "postedAt"
          FROM journal_entries je
          WHERE je.source_type = 'receipt' AND je.source_id = ${receiptId}::uuid
        `);
        return entry.rows as unknown as { entryDate: string; postedAt: Date }[];
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.entryDate).toBe(COLLECTION_DATE); // the business date
      expect(new Date(rows[0]!.postedAt).getTime()).toBeLessThanOrEqual(Date.now()); // server clock
      expect(new Date(rows[0]!.postedAt).getTime()).toBeLessThan(new Date(futureClient).getTime());
    }
    expect(await countRows("receipts")).toBe(receiptsBefore + 2);

    // Same-second dedupe: the SAME command redelivered replays by ID; a
    // DIFFERENT command sharing the same clientCreatedAt processes
    // independently.
    const replay = asAccepted((await pushV2(deviceId, [futureCommand])).results[0]!);
    expect(replay.duplicate).toBe(true);
    const sameSecondDifferentCommand = v2Command(
      "receipt",
      "create_field_collection",
      "expo-c07-sames",
      receiptPayload({ reference: "EXC-C07-003" }),
      { clientCreatedAt: futureClient },
    );
    const distinct = asAccepted((await pushV2(deviceId, [sameSecondDifferentCommand])).results[0]!);
    expect(distinct).not.toHaveProperty("duplicate");
    expect(await countRows("receipts")).toBe(receiptsBefore + 3);

    // (b) The FILE-store leg: a captured receipt whose advisory
    // `createdAt` is skewed to +48h in the outbox row (the tampered-clock
    // client) drains ACCEPTED — the local honest state is unaffected.
    const commandId = captureReceipt(reference, "expo-c07-receipt-file", { reference: "EXC-C07-004" });
    const payload = JSON.parse(String(outboxRowOf(ed.store, commandId).payload)) as {
      clientCreatedAt: string;
    };
    payload.clientCreatedAt = futureClient;
    ed.store.run("UPDATE outbox SET payload = ? WHERE command_id = ?", [
      JSON.stringify(payload),
      commandId,
    ]);
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(0);
    expect(outboxRowOf(ed.store, commandId).status).toBe("ACKED");
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-08 contract downgrade: per-item rejects; the gate trips through the REAL MobileSyncHost (read-only, outbox untouched, prompt once) → the updated build + restored server → gate cleared, writable, clean resume, zero corruption", async () => {
    const seed = 0xe08;
    console.log(`[C-08/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const receiptsBefore = await countRows("receipts");
    const inboxBefore = await countInbox(TENANT_EXPO, deviceId);

    // (a) The real server leg: a batch carrying the stale version — every
    // item rejected CONTRACT_VERSION_UNSUPPORTED, nothing executed.
    const stale = "1999-01-01.1";
    const { results } = await pushV2(
      deviceId,
      [
        v2Command("receipt", "create_field_collection", "expo-c08-1", receiptPayload({ reference: "EXC-C08-001" })),
        v2Command("receipt", "create_field_collection", "expo-c08-2", receiptPayload({ reference: "EXC-C08-002" })),
      ],
      stale,
    );
    expect(results).toHaveLength(2);
    for (const raw of results) {
      const item = asRejected(raw);
      expect(item).toMatchObject({
        status: "REJECTED",
        reason: "CONTRACT_VERSION_UNSUPPORTED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect(item.message).toContain(stale);
    }
    expect(await countRows("receipts")).toBe(receiptsBefore);
    expect(await countInbox(TENANT_EXPO, deviceId)).toBe(inboxBefore);

    // (b) The device whose compiled-in version is stale (meta preset
    // BEFORE construction): the cycle pushes, the server rejects per-item,
    // the FILE records the typed rejections.
    const staleTransport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const staleEd = expoDevice({
      transport: staleTransport,
      seed,
      presetMeta: { contractVersion: stale },
    });
    const staleCommandId = captureReceipt(staleEd.device, "expo-c08-receipt-stale", {
      reference: "EXC-C08-003",
    });
    const staleOutcome = await staleEd.device.cycle();
    expect(staleOutcome.rejected).toBe(1);
    expect(staleOutcome.accepted).toBe(0);
    const staleRow = outboxRowOf(staleEd.store, staleCommandId);
    expect(staleRow.rejection_reason).toBe("CONTRACT_VERSION_UNSUPPORTED");
    expect(JSON.parse(String(staleRow.last_error))).toMatchObject({ resubmittable: false });
    expect(await countRows("receipts")).toBe(receiptsBefore);
    staleEd.dispose();

    // (c) The GATE through the REAL MobileSyncHost: a server advertising
    // a version the device cannot talk to → read-only, no push attempted,
    // the captured command stays QUEUED (never fabricated ACCEPTED), the
    // one-per-trip onUpdatePrompt fires.
    const gatedTransport = new GatedHarnessTransport(
      new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push }),
      "1999-01-01.0",
    );
    const gatedEd = expoDevice({ transport: gatedTransport, seed: seed + 1 });
    const prompts: string[] = [];
    const host = new MobileSyncHost({
      store: gatedEd.store,
      deviceClass: "android-field",
      transport: gatedTransport,
      accessToken: () => "expo-c08-access-token",
      onUpdatePrompt: (reason) => prompts.push(reason),
    });
    const gateCommandId = captureReceipt(gatedEd.device, "expo-c08-receipt-gate", {
      reference: "EXC-C08-004",
    });
    gatedTransport.gateArmed = true;
    const gateOutcome = await host.syncNow();
    expect(gateOutcome.outcome!.readOnly).toBe(true);
    expect(gateOutcome.outcome!.pushed).toBe(0);
    expect(gatedTransport.pushAttempts).toHaveLength(0); // no push attempted
    expect(host.state.phase).toBe("read-only");
    expect(host.readOnlyReason).toBe("CONTRACT_VERSION_UNSUPPORTED");
    expect(prompts).toEqual(["CONTRACT_VERSION_UNSUPPORTED"]); // fired ONCE
    expect(host.canWrite()).toBe(false);
    const gateRow = outboxRowOf(gatedEd.store, gateCommandId);
    expect(gateRow.status).toBe("QUEUED"); // untouched — honest
    expect(gateRow.official_no ?? null).toBeNull();
    // captures FAIL LOUDLY while gated (assertWritable on the FILE).
    expect(() =>
      gatedEd.device.capture({
        entityType: "partner",
        intent: "contact_merge",
        payload: { partnerId: generateUuidV7(), phone: "+966500000000" },
      }),
    ).toThrow(SyncReadOnlyError);

    // (d) The updated build + the restored server: on Android the store
    // rollout delivers the new build (the ReleasePolicy min-version
    // surface is 4-a's; the harness models the updated build as the meta
    // contractVersion bump — the documented desktop appVersion-bump
    // contract, adapted). Server restored → the next cycle clears the
    // gate, the store is writable again, the queued command drains.
    metaSet(gatedEd.store, "contractVersion", SYNC_CONTRACT_VERSION);
    gatedTransport.gateArmed = false;
    const resume = await host.syncNow();
    expect(resume.outcome!.readOnly).toBe(false);
    expect(resume.outcome!.pushed).toBe(1);
    expect(resume.outcome!.accepted).toBe(1);
    expect(host.state.phase).toBe("idle");
    expect(host.canWrite()).toBe(true);
    expect(metaGet(gatedEd.store, "contractGate")).toBe("ok");
    const resumedRow = outboxRowOf(gatedEd.store, gateCommandId);
    expect(resumedRow.status).toBe("ACKED");
    expect(String(resumedRow.official_no)).toMatch(/^RCV-/);
    expect(await countRows("receipts")).toBe(receiptsBefore + 1);

    // No data corruption: the (c)-era local state survived the whole
    // gate→update→resume journey byte-intact (cursors consistent).
    const cursorCount = Number(
      gatedEd.store.get("SELECT value FROM meta WHERE key = 'cursorCount'")?.value ?? "0",
    );
    expect(gatedEd.store.all("SELECT * FROM cursors")).toHaveLength(cursorCount);
    // A second cycle is a clean no-op drain.
    const idle = await host.syncNow();
    expect(idle.outcome!.pushed).toBe(0);
    await ledgerOraclesHold(TENANT_EXPO);
    gatedEd.dispose();
  });

  it("C-09 20 queued field commands, 2 engineered rejects → 18 ACKED (receipts + the load confirm + the credit-note draft), typed rejects with user actions in the FILE, honest states survive close+reopen", async () => {
    const seed = 0xe09;
    const rng = seededRandom(seed);
    console.log(`[C-09/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    // The engineered rejects: the over-unload at #20 — AFTER the load
    // confirm (#19) so the van snapshot it reads is deterministic
    // (itemA 15 = load #1's 10 + load #3's confirmed 5; array order
    // preserves causality, SYNC_PROTOCOL §6) — and the INACTIVE-partner
    // collection at a seeded position in the plain-receipt range (1..17).
    const overUnloadIndex = 20;
    let inactiveIndex = 1 + ((rng() * 16) | 0);
    if (inactiveIndex === overUnloadIndex) {
      inactiveIndex = 1;
    }
    console.log(`[C-09/expo] engineered rejects: #${overUnloadIndex} (over-unload) #${inactiveIndex} (inactive partner)`);

    const receiptsBefore = await countRows("receipts");
    const commandIds: string[] = [];
    const creditNoteKey = "expo-c09-credit-note";
    const confirmKey = "expo-c09-confirm-load";
    const overUnloadKey = "expo-c09-over-unload";
    const inactiveKey = "expo-c09-inactive";
    const allocatedKey = "expo-c09-allocated";
    for (let n = 1; n <= 20; n += 1) {
      let commandId: string;
      if (n === overUnloadIndex) {
        // The over-unload: 30 requested vs 15 available (10 mirrored + 5
        // from the load #3 confirm at #19 earlier in the SAME batch —
        // array order preserves causality, SYNC_PROTOCOL §6).
        commandId = captureConfirmUnload(reference, overUnloadKey, [{ itemId: world.itemA, qty: "30" }]);
      } else if (n === inactiveIndex) {
        commandId = captureReceipt(reference, inactiveKey, {
          partnerId: INACTIVE_PARTNER,
          reference: `EXC-C09-${String(n).padStart(2, "0")}`,
        });
      } else if (n === 17) {
        // One ALLOCATED collection (settles the AR open item).
        commandId = captureReceipt(reference, allocatedKey, {
          amount: "100.0000",
          allocations: [{ openItemId, amount: "100.0000" }],
          reference: `EXC-C09-${String(n).padStart(2, "0")}`,
        });
      } else if (n === 18) {
        // The credit-note draft (OFFLINE-DRAFT — no posting, no number).
        commandId = captureCreditNoteDraft(reference, creditNoteKey);
      } else if (n === 19) {
        // The load #3 confirmation (the IN_TRANSIT substrate).
        commandId = captureConfirmLoad(reference, confirmKey, load3Id);
      } else {
        commandId = captureReceipt(reference, `expo-c09-receipt-${n}`, {
          reference: `EXC-C09-${String(n).padStart(2, "0")}`,
        });
      }
      commandIds.push(commandId);
    }

    // Honest state BEFORE the drain: every command QUEUED, the official
    // number appears NOWHERE (OFFLINE_ARCHITECTURE §5).
    const preState = reference.state();
    expect(preState.queue.pending).toBe(20);
    for (const row of ed.store.all("SELECT status, official_no FROM outbox")) {
      expect(row.status).toBe("QUEUED");
      expect(row.official_no ?? null).toBeNull();
    }
    expect(await countRows("receipts")).toBe(receiptsBefore);

    // The drain: one cycle (FIFO ≤ 50 — all 20 in one batch).
    const outcome = await reference.cycle();
    expect(outcome.pushed).toBe(20);
    expect(outcome.accepted).toBe(18);
    expect(outcome.rejected).toBe(2);
    expect(outcome.deferred).toBe(0);

    expect(await countRows("receipts")).toBe(receiptsBefore + 16);

    // The 2 rejects: typed reasons with user-action guidance in the FILE.
    const rejectedRows = ed.store
      .all("SELECT * FROM outbox WHERE status = 'REJECTED'")
      .map((row) => ({
        reason: String(row.rejection_reason),
        action: String(row.rejection_action),
        typed: JSON.parse(String(row.last_error)) as {
          reason: string;
          resubmittable: boolean;
          details: Record<string, unknown> | null;
        },
      }));
    expect(rejectedRows).toHaveLength(2);
    expect(rejectedRows.map((row) => row.reason).sort()).toEqual(["INSUFFICIENT_STOCK", "PARTNER_INACTIVE"]);
    for (const row of rejectedRows) {
      expect(row.action).toBe(
        row.typed.reason === "PARTNER_INACTIVE" ? "CANCEL_WITH_REASON" : "EDIT_AND_RESEND",
      );
      expect(typeof row.typed.resubmittable).toBe("boolean");
    }
    const overUnload = rejectedRows.find((row) => row.reason === "INSUFFICIENT_STOCK")!;
    expect(overUnload.typed.details).toMatchObject({
      vanWarehouseId: vanId,
      itemId: world.itemA,
      availableQty: "15.000000",
      requestedQty: "30",
    });
    const inactive = rejectedRows.find((row) => row.reason === "PARTNER_INACTIVE")!;
    expect(inactive.typed.details).toMatchObject({ partnerId: INACTIVE_PARTNER, status: "INACTIVE" });

    // Honest state AFTER: 18 ACKED — 17 with official numbers (16 RCV +
    // the TRN confirm) + the credit-note DRAFT honestly numberless; the
    // allocated collection settled the open item.
    const postState = reference.state();
    expect(postState.queue).toEqual({ pending: 0, inFlight: 0, rejected: 2, acked: 18 });
    const withNumbers = ed.store.all(
      "SELECT official_no FROM outbox WHERE status = 'ACKED' AND official_no IS NOT NULL",
    );
    expect(withNumbers).toHaveLength(17);
    for (const row of withNumbers) {
      expect(String(row.official_no)).toMatch(/^(RCV|TRN)-/);
    }
    const creditNoteRow = outboxRowOf(ed.store, commandIds[17]!);
    expect(creditNoteRow.status).toBe("ACKED");
    expect(creditNoteRow.official_no ?? null).toBeNull(); // DRAFT — no number until posting
    const creditNoteResult = JSON.parse(String(creditNoteRow.accepted_result)) as {
      result: { creditNoteId: string; status: string; totalGross: string; reentryValue: string };
    };
    expect(creditNoteResult.result.status).toBe("DRAFT");
    expect(await journalCountForSource(TENANT_EXPO, "credit_note", creditNoteResult.result.creditNoteId)).toBe(0);
    const confirmRow = outboxRowOf(ed.store, commandIds[18]!);
    expect(String(confirmRow.official_no)).toMatch(/^TRN-/);
    const allocatedRow = outboxRowOf(ed.store, commandIds[16]!); // n=17 — the allocated collection
    const allocatedResult = JSON.parse(String(allocatedRow.accepted_result)) as {
      result: { allocatedAmount: string };
    };
    expect(allocatedResult.result.allocatedAmount).toBe("100.0000");
    // The van mirror after the confirm (itemA 10 + 5) — the over-unload
    // left it untouched (zero residue).
    expect(await vanQty(world.itemA)).toBe("15.000000");
    expect(await vanQty(world.itemB)).toBeNull();

    // The FILE persistence proof: close + reopen — the whole post-drain
    // state is byte-identical from the reopened handle.
    const rebooted = ed.reopen();
    const rebootedState = rebooted.device.state();
    expect(rebootedState.queue).toEqual({ pending: 0, inFlight: 0, rejected: 2, acked: 18 });
    expect(
      rebooted.store.all("SELECT * FROM outbox WHERE status = 'ACKED' AND official_no LIKE 'RCV-%'"),
    ).toHaveLength(16);
    await ledgerOraclesHold(TENANT_EXPO);
    rebooted.dispose();
  });

  it("C-10 two EXPO devices edit the same draft → non-owner FORBIDDEN, owner-stale STALE_VERSION, owner-current ACCEPTED (one resolution path, two files)", async () => {
    const seed = 0xe0a;
    console.log(`[C-10/expo] seed=${seed}`);
    const owner = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const other = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const ownerTransport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId: owner, push: services.push });
    const otherTransport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId: other, push: services.push });
    const ownerEd = expoDevice({ transport: ownerTransport, seed });
    const otherEd = expoDevice({ transport: otherTransport, seed: seed + 1 });

    // The draft exists (owner-created, captured on the owner's FILE).
    const createId = ownerEd.device.captureDraftInvoiceCreate({
      customerId: world.customerId,
      orderDate: "2026-03-01",
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
    });
    const created = await ownerEd.device.cycle();
    expect(created.accepted).toBe(1);
    const createdResult = JSON.parse(String(outboxRowOf(ownerEd.store, createId).accepted_result)) as {
      result: { invoiceId: string };
      entity: { version: number };
    };
    const draftId = createdResult.result.invoiceId;
    const baseVersion = createdResult.entity.version;

    // Non-owner device: FORBIDDEN with details.ownerDeviceId (C-10).
    const nonOwnerId = otherEd.device.captureDraftInvoiceUpdate(
      draftId,
      {
        customerId: world.customerId,
        orderDate: "2026-03-02",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
      },
      baseVersion,
    );
    const nonOwnerCycle = await otherEd.device.cycle();
    expect(nonOwnerCycle.rejected).toBe(1);
    const nonOwnerRow = outboxRowOf(otherEd.store, nonOwnerId);
    expect(nonOwnerRow.rejection_reason).toBe("FORBIDDEN");
    const nonOwnerTyped = JSON.parse(String(nonOwnerRow.last_error)) as {
      resubmittable: boolean;
      details: { ownerDeviceId: string };
    };
    expect(nonOwnerTyped.resubmittable).toBe(false);
    expect(nonOwnerTyped.details).toMatchObject({ ownerDeviceId: owner });

    // Owner with a stale baseVersion: STALE_VERSION with the fresh row
    // version (the losing device reconciles against it).
    const staleId = ownerEd.device.captureDraftInvoiceUpdate(
      draftId,
      {
        customerId: world.customerId,
        orderDate: "2026-03-03",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
      },
      99,
    );
    const staleCycle = await ownerEd.device.cycle();
    expect(staleCycle.rejected).toBe(1);
    const staleRow = outboxRowOf(ownerEd.store, staleId);
    expect(staleRow.rejection_reason).toBe("STALE_VERSION");
    expect(staleRow.rejection_action).toBe("EDIT_AND_RESEND");
    const staleTyped = JSON.parse(String(staleRow.last_error)) as {
      details: { currentVersion: number };
    };
    expect(staleTyped.details).toMatchObject({ currentVersion: baseVersion });

    // Owner with the CURRENT baseVersion: ACCEPTED — exactly one
    // resolution path (the draft is single-writer).
    const winnerId = ownerEd.device.captureDraftInvoiceUpdate(
      draftId,
      {
        customerId: world.customerId,
        orderDate: "2026-03-04",
        lines: [{ itemId: world.itemA, qty: "2", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      },
      baseVersion,
    );
    const winnerCycle = await ownerEd.device.cycle();
    expect(winnerCycle.accepted).toBe(1);
    const winnerResult = JSON.parse(String(outboxRowOf(ownerEd.store, winnerId).accepted_result)) as {
      entity: { id: string; version: number };
    };
    expect(winnerResult.entity).toMatchObject({ id: draftId, version: baseVersion + 1 });

    // The final ledger state matches exactly one resolution path.
    const row = await withTenant(TENANT_EXPO, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT version, invoice_date AS "invoiceDate", owner_device_id AS "ownerDeviceId",
               (SELECT count(*)::int FROM sales_invoice_lines WHERE invoice_id = ${draftId}::uuid) AS lines
        FROM sales_invoices WHERE id = ${draftId}::uuid
      `);
      return rows.rows[0] as { version: number; invoiceDate: string; ownerDeviceId: string; lines: number };
    });
    expect(row).toMatchObject({
      version: baseVersion + 1,
      invoiceDate: "2026-03-04",
      ownerDeviceId: owner,
      lines: 1,
    });
    await ledgerOraclesHold(TENANT_EXPO);
    ownerEd.dispose();
    otherEd.dispose();
  });

  it("C-11 tombstone: soft-deleted item pulls op:DELETE + payload:null into the FILE; the van_stocks vanished-key DELETE diff empties the mobile cache; stale pushes reject ITEM_INACTIVE; unknown-row tombstones no-op", async () => {
    const seed = 0xe0b;
    const rng = seededRandom(seed);
    console.log(`[C-11/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    // A dedicated tombstone victim item (never referenced elsewhere).
    const victimId = await withTenant(TENANT_EXPO, async () => {
      const itemsStore = await import("../../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const inserted = await itemsStore.insertItem({
        sku: `EXC-TOMB-${(rng() * 1e6) | 0}`,
        name: "C-11 Expo Tombstone Victim",
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "10.000000",
      });
      return inserted.id;
    });

    // Sync the device first so it HOLDS the item locally (in the file).
    await reference.client.pullAll();
    expect(ed.store.get("SELECT * FROM items WHERE id = ?", [victimId])).toBeDefined();

    // Soft-delete server-side (tombstone transport + the GC ledger row).
    await withTenant(TENANT_EXPO, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`
        UPDATE items SET deleted_at = now(), status = 'ARCHIVED', updated_at = now()
        WHERE id = ${victimId}::uuid
      `);
    });
    const feed = await transport.pull("items", readCursor(reference.adapter, "items"));
    const deleteEntry = feed.changes.find((change) => change.id === victimId);
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.op).toBe("DELETE");
    expect(deleteEntry!.payload).toBeNull();
    expect(deleteEntry!.version).toBeNull();
    const tombstones = await withTenant(TENANT_EXPO, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(*)::int AS n FROM tombstones WHERE entity_type = 'items' AND entity_id = ${victimId}::text
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(tombstones).toBe(1);

    // The tombstone applies: the FILE row disappears (idempotent remove).
    const applied = applyPullBatch(
      reference.adapter,
      { entityType: "items", cursor: feed.cursor, changes: [...feed.changes] },
      posAppliers,
    );
    expect(applied).toBeGreaterThan(0);
    expect(ed.store.get("SELECT * FROM items WHERE id = ?", [victimId])).toBeUndefined();

    // The van_stocks vanished-key DELETE diff: the server-side return of
    // the WHOLE remaining load (itemA ×15) vanishes the mirror row — the
    // device's first full pull carries UPSERT + DELETE for the key, and
    // the mobile cache ends EMPTY (the field app's snapshot semantics).
    await withTenant(TENANT_EXPO, async () => {
      await vans.unload({
        vanWarehouseId: vanId,
        toWarehouseId: world.warehouseId,
        lines: [{ itemId: world.itemA, qty: "15" }],
        note: "C-11 whole-load return",
        noteAr: null,
        actorId: EXPO_REP,
      });
      // The mirror-first read refreshes the 017 mirror from stock_moves
      // (the board contract — the handler-side seam 2-c recorded: the
      // unload service itself does not refresh; pull-fields.spec's
      // pattern).
      await vans.listVanStock({ warehouseId: vanId });
    });
    expect(await vanQty(world.itemA)).toBeNull(); // the mirror is EMPTY
    expect(await vanQty(world.itemB)).toBeNull();
    await reference.cycle();
    expect(ed.store.all("SELECT * FROM van_stocks")).toHaveLength(0);
    const vanTombstones = await withTenant(TENANT_EXPO, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(*)::int AS n FROM tombstones WHERE entity_type = 'van_stocks'
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(vanTombstones).toBeGreaterThanOrEqual(1);

    // A stale push referencing the tombstoned id: ITEM_INACTIVE (the
    // tenant's OWN tombstoned master data speaks the actionable
    // vocabulary; cross-tenant no-disclosure is C-13's concern); the
    // truly-unknown id stays the generic VALIDATION_ERROR.
    const movesBefore = await countRows("stock_moves");
    const unknownItemId = generateUuidV7();
    const tombstonePush = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("van", "confirm_unload", "expo-c11-tombstone", {
            vanWarehouseId: vanId,
            toWarehouseId: world.warehouseId,
            lines: [{ itemId: victimId, qty: "1" }],
          }),
        ])
      ).results[0]!,
    );
    const unknownPush = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("van", "confirm_unload", "expo-c11-unknown", {
            vanWarehouseId: vanId,
            toWarehouseId: world.warehouseId,
            lines: [{ itemId: unknownItemId, qty: "1" }],
          }),
        ])
      ).results[0]!,
    );
    expect(tombstonePush.reason).toBe("ITEM_INACTIVE");
    expect(tombstonePush.resubmittable).toBe(false);
    expect(tombstonePush.action).toBe("CANCEL_WITH_REASON");
    expect(unknownPush.reason).toBe("VALIDATION_ERROR");
    expect(await countRows("stock_moves")).toBe(movesBefore); // no resurrection

    // A tombstone for a row the device NEVER had: a no-op (idempotent —
    // the cursor still advances past it).
    const unknownRowId = generateUuidV7();
    await withTenant(TENANT_EXPO, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`
        INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload)
        VALUES (erp.current_tenant_id(), 'items', ${unknownRowId}::text, 'DELETE', NULL)
      `);
    });
    const after = await transport.pull("items", readCursor(reference.adapter, "items"));
    const unknownTombstone = after.changes.find((change) => change.id === unknownRowId);
    expect(unknownTombstone).toBeDefined();
    const noopApplied = applyPullBatch(
      reference.adapter,
      { entityType: "items", cursor: after.cursor, changes: [...after.changes] },
      posAppliers,
    );
    expect(noopApplied).toBeGreaterThan(0);
    expect(ed.store.get("SELECT * FROM items WHERE id = ?", [unknownRowId])).toBeUndefined();
    expect(readCursor(reference.adapter, "items")).toBe(after.cursor);
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-11b push budget (the per-device token bucket): burst past the bucket → DEFERRED RATE_LIMITED with retryAfterMs, nothing executed, nothing in the inbox; the expo outbox paces the retry (next_attempt_at) and drains after the window", async () => {
    const seed = 0xe1b;
    console.log(`[C-11b/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");

    // A fresh device: the bucket starts full (burst 20 push CALLS).
    let deferredAt = -1;
    let accepted = 0;
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const { results } = await pushV2(deviceId, [
        v2Command("receipt", "create_field_collection", `expo-c11b-rate-${attempt}`, {
          ...receiptPayload({ amount: "1.0000", reference: `EXC-C11B-${String(attempt).padStart(2, "0")}` }),
        }),
      ]);
      const item = results[0]!;
      if (item.status === "DEFERRED") {
        expect(item.reason).toBe("RATE_LIMITED");
        expect((item as { retryAfterMs?: number }).retryAfterMs).toBe(5000);
        deferredAt = attempt;
        break;
      }
      expect(item.status).toBe("ACCEPTED");
      accepted += 1;
    }
    expect(accepted).toBeGreaterThan(0);
    expect(deferredAt).toBeGreaterThan(0);

    // The DEFERRED push executed nothing and recorded no inbox row.
    const inboxBefore = await countInbox(TENANT_EXPO, deviceId);
    expect(inboxBefore).toBe(accepted);
    expect(await countRows("receipts")).toBe(receiptsBefore + accepted);

    // The client leg: the expo device's queued command pushes into the
    // EMPTY bucket → DEFERRED, the outbox row returns to QUEUED PACED by
    // the server's retryAfterMs (SYNC_PROTOCOL §3.5) without counting an
    // attempt — the queue never silently drains.
    const commandId = captureReceipt(reference, "expo-c11b-queued", { amount: "1.0000", reference: "EXC-C11B-Q1" });
    const gated = await reference.cycle();
    expect(gated.deferred).toBe(1);
    const row = outboxRowOf(ed.store, commandId);
    expect(row.status).toBe("QUEUED");
    expect(Number(row.attempts)).toBe(0);
    expect(Number(row.next_attempt_at)).toBeGreaterThan(Date.now());
    expect(await countInbox(TENANT_EXPO, deviceId)).toBe(inboxBefore);
    expect(await countRows("receipts")).toBe(receiptsBefore + accepted);

    // The host's DEFERRED retry hint arms the RetryScheduler with the
    // server's hint (the trigger set's §3.5 wiring).
    const host = new MobileSyncHost({
      store: ed.store,
      deviceClass: "android-field",
      transport,
      accessToken: () => "expo-c11b-access-token",
    });
    expect(host.deferredRetryHintMs()).not.toBeNull();
    expect(host.deferredRetryHintMs()!).toBeLessThanOrEqual(5000);

    // After the window (refill 10 tokens/min + the row's 5 s pacing) the
    // queued command drains: ACCEPTED, not a replay.
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const drained = await reference.cycle();
    expect(drained.accepted).toBe(1);
    expect(drained.duplicates).toBe(0);
    expect(outboxRowOf(ed.store, commandId).status).toBe("ACKED");
    expect(await countRows("receipts")).toBe(receiptsBefore + accepted + 1);
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  }, 30_000);

  it("C-12 cursor beyond the feed head → resync directive (fresh 0-cursor); the expo client honors it; the reset persists in the FILE; ledger untouched", async () => {
    const seed = 0xe0c;
    console.log(`[C-12/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");
    const journalsBefore = await countRows("journal_entries");

    // A crafted token with a seq far beyond the tenant's feed head.
    const beyond = encodeCursor({ entityType: "items", seq: 999_999_999, issuedAt: new Date().toISOString() });
    const resync = await withTenant(TENANT_EXPO, () =>
      pullService({ entityType: "items", cursor: beyond, deviceId }),
    );
    expect(resync.resync).toBe(true);
    expect(resync.changes).toHaveLength(0);
    expect(resync.hasMore).toBe(false);
    const fresh = decodeCursor(resync.cursor);
    expect(fresh?.entityType).toBe("items");
    expect(fresh?.seq).toBe(0);

    expect(await countRows("receipts")).toBe(receiptsBefore);
    expect(await countRows("journal_entries")).toBe(journalsBefore);

    // The client honors the directive: the preset beyond-head cursor in
    // the FILE is reset + the feed re-serves from 0 (no silent "no
    // changes"); the resync event is observable.
    resetCursor(reference.adapter, "items", beyond);
    const events: { type: string; entityType?: string }[] = [];
    const outcome = await runCycle(reference.client, {
      onEvent: (event) => events.push({ type: event.type, ...(event as { entityType?: string }) }),
    });
    expect(events.some((event) => event.type === "resync" && event.entityType === "items")).toBe(true);
    expect(outcome.pulled).toBeGreaterThan(0);
    expect(ed.store.all("SELECT id FROM items").length).toBeGreaterThan(0);
    const state = reference.state();
    expect(state.cursors.items).not.toBe(beyond); // the bounded restart landed
    // …and the reset cursor is durable: close + reopen keeps it.
    const rebooted = ed.reopen();
    expect(readCursor(rebooted.device.adapter, "items")).toBe(state.cursors.items);
    await ledgerOraclesHold(TENANT_EXPO);
    rebooted.dispose();
  });

  it("C-13 cross-tenant references (FIELD EMPHASIS): foreign ids reject with the SAME error shape as unknown ids, zero effects (tenant B byte-identical)", async () => {
    const seed = 0xe0d;
    console.log(`[C-13/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;
    const receiptsBefore = await countRows("receipts");
    const movesBefore = await countRows("stock_moves");

    // (a) A REAL tenant-B transfer id on van:confirm_load vs an unknown
    // id: identical rejection shape (404-equivalent — no existence
    // disclosure).
    const shapeOf = (item: Extract<PushItemResultV2, { status: "REJECTED" }>, echoedId: string) => ({
      status: item.status,
      reason: item.reason,
      action: item.action,
      resubmittable: item.resubmittable,
      localized: item.localized,
      message: item.message.replace(echoedId, "<id>"),
    });
    const unknownTransferId = generateUuidV7();
    const foreignLoad = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("van", "confirm_load", "expo-c13-foreign-load", { transferId: foreignPartnerId }),
        ])
      ).results[0]!,
    );
    // (tenant B owns no transfers — the foreign PARTNER id stands in as a
    // REAL tenant-B id in the transfer id-space; the handler's id lookup
    // is tenant-scoped, so the no-disclosure rule is what is proven.)
    const unknownLoad = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("van", "confirm_load", "expo-c13-unknown-load", { transferId: unknownTransferId }),
        ])
      ).results[0]!,
    );
    expect(foreignLoad.reason).toBe("VALIDATION_ERROR");
    expect(unknownLoad.reason).toBe("VALIDATION_ERROR");
    expect(shapeOf(foreignLoad, foreignPartnerId)).toEqual(shapeOf(unknownLoad, unknownTransferId));

    // (b) A foreign PARTNER as the collection's customer: same shape vs
    // unknown.
    const unknownPartnerId = generateUuidV7();
    const foreignPartner = asRejected(
      (
        await pushV2(deviceId, [
          v2Command(
            "receipt",
            "create_field_collection",
            "expo-c13-foreign-partner",
            receiptPayload({ partnerId: foreignPartnerId, reference: "EXC-C13-001" }),
          ),
        ])
      ).results[0]!,
    );
    const unknownPartner = asRejected(
      (
        await pushV2(deviceId, [
          v2Command(
            "receipt",
            "create_field_collection",
            "expo-c13-unknown-partner",
            receiptPayload({ partnerId: unknownPartnerId, reference: "EXC-C13-002" }),
          ),
        ])
      ).results[0]!,
    );
    expect(foreignPartner.reason).toBe("VALIDATION_ERROR");
    expect(shapeOf(foreignPartner, foreignPartnerId)).toEqual(shapeOf(unknownPartner, unknownPartnerId));

    // (c) A foreign INVOICE id on credit_note:create_draft (captured on
    // the expo FILE, cycled): same shape vs unknown.
    const updateOf = (invoiceId: string) =>
      v2Command("credit_note", "create_draft", `expo-c13-note-${invoiceId}`, {
        invoiceId,
        noteDate: "2026-03-18",
        lines: [{ invoiceLineId: postedInvoiceLineId, qty: "1", returnToStock: true }],
      });
    const foreignInvoiceId = generateUuidV7();
    const unknownInvoiceId = generateUuidV7();
    const foreignNote = asRejected((await pushV2(deviceId, [updateOf(foreignInvoiceId)])).results[0]!);
    const unknownNote = asRejected((await pushV2(deviceId, [updateOf(unknownInvoiceId)])).results[0]!);
    expect(foreignNote.reason).toBe("VALIDATION_ERROR");
    expect(shapeOf(foreignNote, foreignInvoiceId)).toEqual(shapeOf(unknownNote, unknownInvoiceId));

    // Zero effects anywhere: tenant A's ledger untouched, tenant B's rows
    // byte-identical.
    expect(await countRows("receipts")).toBe(receiptsBefore);
    expect(await countRows("stock_moves")).toBe(movesBefore);
    const foreignUnchanged = await withTenant(TENANT_FOREIGN, async () => {
      const tx = requireTenantContext().tx!;
      const items = await tx.execute(sql`SELECT count(*)::int AS n FROM items WHERE deleted_at IS NULL`);
      const partners = await tx.execute(sql`SELECT count(*)::int AS n FROM partners WHERE deleted_at IS NULL`);
      return (
        (items.rows as unknown as { n: number }[])[0]!.n === 1 &&
        (partners.rows as unknown as { n: number }[])[0]!.n === 1
      );
    });
    expect(foreignUnchanged).toBe(true);
    // The device's file queue is empty (nothing captured — zero residue).
    expect(reference.state().queue.pending).toBe(0);
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-14 suspension mid-queue: pushes TENANT_SUSPENDED per-item; restore → the expo device resumes from its parked FILE cursor, no duplicates, the pending command EXECUTES", async () => {
    const seed = 0xe0e;
    console.log(`[C-14/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");

    // Pre-suspension: one accepted command (its inbox row is the no-double-
    // post proof for the resume) + the device's cursor parked mid-feed.
    const acceptedCommand = v2Command(
      "receipt",
      "create_field_collection",
      "expo-c14-accepted",
      receiptPayload({ reference: "EXC-C14-001" }),
    );
    const accepted = asAccepted((await pushV2(deviceId, [acceptedCommand])).results[0]!);
    expect(accepted.status).toBe("ACCEPTED");
    expect(await countRows("receipts")).toBe(receiptsBefore + 1);
    await reference.client.pullAll();
    const parkedCursor = readCursor(reference.adapter, "items");

    // The command captured (queued in the FILE) when suspension hits.
    const pendingId = captureReceipt(reference, "expo-c14-receipt-pending", { reference: "EXC-C14-002" });

    const su = await superuserClient();
    await su.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [TENANT_EXPO]);
    await su.end();
    try {
      const inboxBefore = await countInbox(TENANT_EXPO, deviceId);
      const gated = asRejected(
        (
          await pushV2(deviceId, [
            v2Command(
              "receipt",
              "create_field_collection",
              "expo-c14-direct",
              receiptPayload({ reference: "EXC-C14-003" }),
            ),
          ])
        ).results[0]!,
      );
      expect(gated).toMatchObject({
        status: "REJECTED",
        reason: "TENANT_SUSPENDED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect(gated.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
      expect(await countRows("receipts")).toBe(receiptsBefore + 1);
      expect(await countInbox(TENANT_EXPO, deviceId)).toBe(inboxBefore); // not poisoned

      const status = await transport.status();
      expect(status.suspended).toBe(true);
    } finally {
      const restore = await superuserClient();
      await restore.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [TENANT_EXPO]);
      await restore.end();
    }

    // Resume: the protocol continues from the parked cursor (no duplicate
    // application), the previously-accepted command replays from the
    // inbox (duplicate:true, zero new effects), and the suspended-gated
    // command EXECUTES (ACCEPTED, not a replay).
    const delta = await reference.client.pullAll();
    expect(delta.items).toBe(0); // nothing changed server-side while suspended
    expect(decodeCursor(readCursor(reference.adapter, "items") ?? "")?.seq).toBe(
      decodeCursor(parkedCursor ?? "")?.seq,
    );

    const replay = asAccepted((await pushV2(deviceId, [acceptedCommand])).results[0]!);
    expect(replay.duplicate).toBe(true); // the inbox replay — no second post
    expect(await countRows("receipts")).toBe(receiptsBefore + 1);

    // The FILE-queued pending command drains on the next cycle: ACCEPTED,
    // not a duplicate.
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.duplicates).toBe(0);
    expect(outboxRowOf(ed.store, pendingId).status).toBe("ACKED");
    expect(await countRows("receipts")).toBe(receiptsBefore + 2);
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-15 tampered payloads: the captured FILE rows are tampered post-capture (negative amount, malformed decimal, negative qty) → typed rejects, no partial ledger", async () => {
    const seed = 0xe0f;
    console.log(`[C-15/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");
    const movesBefore = await countRows("stock_moves");

    // Capture three healthy commands, then tamper the PAYLOAD column of
    // each outbox row in the file (the compromised-client premise: the
    // local row is mutated after capture — the server re-validates
    // everything).
    const receipt1 = captureReceipt(reference, "expo-c15-receipt-1", { reference: "EXC-C15-001" });
    const receipt2 = captureReceipt(reference, "expo-c15-receipt-2", { reference: "EXC-C15-002" });
    const unload1 = captureConfirmUnload(reference, "expo-c15-unload-1", [{ itemId: world.itemA, qty: "1" }]);
    const tamperPayload = (commandId: string, mutate: (payload: Record<string, unknown>) => void): void => {
      const envelope = JSON.parse(String(outboxRowOf(ed.store, commandId).payload)) as Record<string, unknown>;
      mutate(envelope.payload as Record<string, unknown>); // the v2 envelope NESTS the payload
      ed.store.run("UPDATE outbox SET payload = ? WHERE command_id = ?", [JSON.stringify(envelope), commandId]);
    };
    // (a) negative amount (the owning service's positive-amount gate — the
    // wire pattern admits the sign; the service refuses it, 2-c's
    // INVALID_AMOUNT → VALIDATION_ERROR mapping).
    tamperPayload(receipt1, (payload) => {
      payload.amount = "-10.0000";
    });
    // (b) malformed decimal.
    tamperPayload(receipt2, (payload) => {
      payload.amount = "12.50.00";
    });
    // (c) negative qty on the unload line.
    tamperPayload(unload1, (payload) => {
      (payload.lines as { qty: string }[])[0]!.qty = "-5";
    });

    const outcome = await reference.cycle();
    expect(outcome.pushed).toBe(3);
    expect(outcome.accepted).toBe(0);
    expect(outcome.rejected).toBe(3);

    // Typed rejects in the FILE: all three are the zod VALIDATION_ERROR
    // (resubmittable — fix & resend), zero residue server-side.
    for (const commandId of [receipt1, receipt2, unload1]) {
      const row = outboxRowOf(ed.store, commandId);
      expect(row.status).toBe("REJECTED");
      expect(row.rejection_reason).toBe("VALIDATION_ERROR");
      expect(row.rejection_action).toBe("EDIT_AND_RESEND");
      expect(JSON.parse(String(row.last_error))).toMatchObject({ resubmittable: true });
    }
    const zodMessage = JSON.parse(String(outboxRowOf(ed.store, receipt2).last_error)) as { message: string };
    expect(zodMessage.message).toMatch(/payload rejected by the contract/);

    // No partial ledger: the oracles hold and nothing moved.
    expect(await countRows("receipts")).toBe(receiptsBefore);
    expect(await countRows("stock_moves")).toBe(movesBefore);
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("C-16 storage-full at capture on the FILE: loud typed failure while armed, the queue persists on disk, drains after recovery", async () => {
    const seed = 0xe10;
    console.log(`[C-16/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });

    // The quota wrapper (C-16): while armed, every write TRANSACTION on
    // the real file store refuses to start (a full disk never accepts a
    // capture — no silent drop, no half-write); reads + everything else
    // delegate to the REAL store.
    let quotaArmed = false;
    const ed = expoDevice({
      transport,
      seed,
      wrapAdapter: (store) => ({
        transaction: <T>(fn: () => T): T => {
          if (quotaArmed) {
            throw new Error("local store quota exceeded (SQLITE_FULL) — write transaction refused");
          }
          return store.transaction(fn);
        },
        run: (statement, params) => store.run(statement, params),
        all: (statement, params) => store.all(statement, params),
        get: (statement, params) => store.get(statement, params),
        listBusinessTables: () => store.listBusinessTables(),
      }),
    });
    const reference = ed.device;

    // Two healthy captures, then the disk fills mid-shift.
    const firstId = captureReceipt(reference, "expo-c16-receipt-1", { reference: "EXC-C16-001" });
    const secondId = captureReceipt(reference, "expo-c16-receipt-2", { reference: "EXC-C16-002" });
    expect(reference.state().queue.pending).toBe(2);

    quotaArmed = true;
    expect(() => captureReceipt(reference, "expo-c16-receipt-3", { reference: "EXC-C16-003" })).toThrow(
      /quota exceeded/,
    ); // LOUD — never a silent drop

    // The queue persisted in the FILE: both previous entries intact (the
    // outbox is the source of truth for pending operations — never
    // pruned by the fault; reads are not gated, only write transactions).
    expect(ed.store.all("SELECT * FROM outbox")).toHaveLength(2);
    expect(ed.store.all("SELECT * FROM outbox WHERE status = 'QUEUED'")).toHaveLength(2);

    // Recovery (space freed): the queue drains per C-09 semantics — both
    // commands accepted, official numbers stamped, ledger oracles exact.
    quotaArmed = false;
    const receiptsBefore = await countRows("receipts");
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(2);
    expect(outcome.rejected).toBe(0);
    expect(outcome.pushed).toBe(2);
    expect(await countRows("receipts")).toBe(receiptsBefore + 2);
    const state = reference.state();
    expect(state.queue.acked).toBe(2);
    for (const commandId of [firstId, secondId]) {
      expect(String(outboxRowOf(ed.store, commandId).official_no)).toMatch(/^RCV-/);
    }
    await ledgerOraclesHold(TENANT_EXPO);
    ed.dispose();
  });

  it("P-01 the personal class profile (DR-P22-08b): pull-only cycles materialize the linked partner's scoped read models; push is REFUSED on three layers; out-of-group pulls get the typed rejection; tampered cursors never widen the scope", async () => {
    const seed = 0xe11;
    console.log(`[P-01/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_OWNER, {
      deviceClass: "android-personal",
      linkedPartnerId: world.customerId,
    });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const pd = expoPersonalDevice({
      transport,
      seed,
      accessToken: () => "expo-personal-access-token",
    });

    // The pull-only cycle: the linked partner's scoped feeds materialize
    // into the personal read models (money TEXT, ADR-0009).
    const cycle = await pd.host.syncNow();
    expect(cycle.outcome!.pulled).toBeGreaterThan(0);
    expect(pd.store.all("SELECT * FROM statements").length).toBeGreaterThan(0);
    const statementRows = pd.store.all(
      "SELECT id, closing_balance FROM statements WHERE id = ?",
      [world.customerId],
    );
    expect(statementRows).toHaveLength(1);
    expect(typeof statementRows[0]!.closing_balance).toBe("string");
    const invoiceRows = pd.store.all("SELECT id, invoice_no FROM sales_invoices WHERE id = ?", [
      postedInvoiceId,
    ]);
    expect(invoiceRows).toHaveLength(1);
    expect(String(invoiceRows[0]!.invoice_no)).toMatch(/^SAL-\d{4}-\d{6}$/);
    // The posted field collections (C-01…C-16's receipts for the linked
    // partner) are in the receipts read model.
    expect(pd.store.all("SELECT * FROM receipts").length).toBeGreaterThan(0);
    for (const row of pd.store.all("SELECT amount FROM receipts")) {
      expect(typeof row.amount).toBe("string");
    }
    // The cursors parked per entity (the pull-only sync state).
    expect(pd.store.all("SELECT * FROM cursors").length).toBeGreaterThan(0);

    // The NO-PUSH hard guard, three layers (LOCAL_DATABASE §1.1 rule 2):
    // (1) the host refuses pushNow with the pull-only skip,
    await expect(pd.host.pushNow()).resolves.toMatchObject({ skipped: "pull-only" });
    // (2) the host reports an always-empty queue + never-writable gate,
    expect(pd.host.canWrite()).toBe(false);
    expect(pd.host.queueStats()).toEqual({ pending: 0, inFlight: 0, rejected: 0, acked: 0 });
    expect(pd.host.rejectedCommands()).toEqual([]);
    // (3) the store has NO outbox table at all (sqlite_master — the
    // structural proof; a tampered device holds no queue to tamper).
    expect(
      pd.store.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outbox'"),
    ).toBeUndefined();
    expect(
      pd.store.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'inbox'"),
    ).toBeUndefined();

    // Out-of-group entities: SYNC_ENTITY_NOT_PULLED (no existence leak).
    for (const entityType of ["items", "van_stocks", "routes"] as const) {
      await expect(transport.pull(entityType, null)).rejects.toBeInstanceOf(SyncEntityNotPulledError);
    }

    // Tampered cursors: forged + cross-entity get the typed rejection
    // (the pull-personal shapes).
    const validCursor = await withTenant(TENANT_EXPO, () =>
      pullService({ entityType: "statements", cursor: null, deviceId, limit: 100 }),
    );
    const forged = `${validCursor.cursor.slice(0, -6)}AAAAAA`;
    await expect(
      withTenant(TENANT_EXPO, () => pullService({ entityType: "statements", cursor: forged, deviceId })),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_INVALID" });
    const itemsCursor = encodeCursor({
      entityType: "items",
      seq: 1,
      issuedAt: new Date().toISOString(),
    });
    await expect(
      withTenant(TENANT_EXPO, () =>
        pullService({ entityType: "statements", cursor: itemsCursor, deviceId }),
      ),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_INVALID" });

    // The read models + cursors survive close + reopen (the file is the
    // persistence proof).
    const rebooted = pd.reopen();
    expect(rebooted.store.all("SELECT * FROM statements").length).toBeGreaterThan(0);
    expect(rebooted.store.all("SELECT * FROM receipts").length).toBeGreaterThan(0);
    await ledgerOraclesHold(TENANT_EXPO);
    rebooted.dispose();
  });

  it("F-01 fault soup (battery/connectivity realism, SYNC_TESTS §5): airplane windows, a dropped push response, a duplicate delivery, a Doze-deferred background (≥ 15 min simulated) and a mid-soup crash reboot — deterministically seeded; the store converges, oracles hold", async () => {
    const seed = 0x5f1;
    const rng = seededRandom(seed);
    // The deterministic schedule: which cycle is the airplane window and
    // whether the duplicate delivery precedes the Doze gap.
    const airplaneCycle = 2 + ((rng() * 2) | 0); // cycle 2 or 3
    const duplicateBeforeDoze = rng() < 0.5;
    console.log(
      `[F-01/expo] seed=${seed} schedule: airplaneCycle=${String(airplaneCycle)} duplicateBeforeDoze=${String(duplicateBeforeDoze)}`,
    );
    const deviceId = await enrollDevice(TENANT_EXPO, EXPO_REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_EXPO, deviceId, push: services.push });
    const soup = new SoupTransport(transport);
    const ed = expoDevice({ transport: soup, seed });
    const reference = ed.device;

    const receiptsBefore = await countRows("receipts");

    // Six collections captured offline (one file-backed transaction each).
    const commandIds: string[] = [];
    for (let n = 1; n <= 6; n += 1) {
      commandIds.push(
        captureReceipt(reference, `expo-f01-receipt-${n}`, { reference: `EXC-F01-00${n}` }),
      );
    }
    expect(reference.state().queue.pending).toBe(6);

    // CYCLE 1 — the dropped response: the server COMMITTED (all six
    // execute + inbox rows), the response never returns (the C-04 window
    // through a transport fault). The client parks the rows QUEUED.
    soup.dropNextPushResponse = true;
    const dropped = await reference.cycle();
    expect(dropped.pushed).toBe(0);
    expect(await countRows("receipts")).toBe(receiptsBefore + 6); // committed server-side
    expect(reference.state().queue.pending).toBe(6);
    expect(soup.droppedPushes).toEqual([6]);

    // CYCLE 2..3 — one is the airplane window (every transport call
    // fails; nothing advances), the other re-pushes with a duplicate
    // delivery (the network retries the batch; the inbox replays
    // duplicate:true — zero new effects).
    for (let cycle = 2; cycle <= 3; cycle += 1) {
      if (cycle === airplaneCycle) {
        soup.airplane = true;
        const offline = await reference.cycle();
        expect(offline.pushed).toBe(0);
        expect(offline.pulled).toBe(0);
        soup.airplane = false;
      } else {
        soup.duplicateNextDelivery = true;
        const repush = await reference.cycle();
        expect(repush.accepted).toBe(6);
        expect(repush.duplicates).toBe(6);
        expect(await countRows("receipts")).toBe(receiptsBefore + 6); // still six — no double post
      }
    }
    expect(reference.state().queue.acked).toBe(6);

    // The mid-soup crash reboot: close + reopen the SAME file — WAL
    // recovers, the whole post-drain state is byte-identical, and a
    // follow-up cycle is a clean no-op.
    const rebooted = ed.reopen();
    const recovery = rebooted.recover();
    expect(recovery.integrity).toBe("ok");
    expect(recovery.recoveredInFlight).toBe(0);
    expect(rebooted.device.state().queue).toEqual({ pending: 0, inFlight: 0, rejected: 0, acked: 6 });
    const settled = await rebooted.device.cycle();
    expect(settled.pushed).toBe(0);
    expect(settled.accepted).toBe(0);

    // The Doze-deferred background (the ≥ 15 min OS-scheduled gap,
    // simulated): the REAL MobileSyncTriggers over the REAL host register
    // the background task at the golden floor, the OS defers it (Doze),
    // and when it finally fires the background cycle completes cleanly.
    const background = new FakeScheduler();
    const timers: { intervalMs?: number }[] = [];
    const fakeTimers = {
      setInterval: (callback: () => void, ms: number) => {
        timers.push({ intervalMs: ms });
        void callback;
        return {} as unknown;
      },
      clearInterval: () => undefined,
      setTimeout: (callback: () => void, ms: number) => {
        timers.push({ intervalMs: ms });
        void callback;
        return {} as unknown;
      },
      clearTimeout: () => undefined,
    };
    const host = new MobileSyncHost({
      store: rebooted.store,
      deviceClass: "android-field",
      transport: soup,
      accessToken: () => "expo-f01-access-token",
    });
    const triggers = new MobileSyncTriggers({
      host,
      connectivity: null,
      background,
      timers: fakeTimers,
    });
    triggers.start();
    expect(background.registrations).toHaveLength(1);
    expect(background.registrations[0]!.minIntervalMs).toBe(SYNC_BACKGROUND_MIN_INTERVAL_MS); // ≥ 15 min (Doze-aware ceiling)
    expect(background.registrations[0]!.minIntervalMs).toBeGreaterThanOrEqual(900_000);
    // The foreground cadence armed at the golden 2-min interval.
    expect(timers.some((timer) => timer.intervalMs === SYNC_FOREGROUND_INTERVAL_MS)).toBe(true);
    await background.fire(0); // the deferred task finally runs (background cycle)
    expect(host.state.phase).toBe("idle");
    expect(host.deferredRetryHintMs()).toBeNull(); // nothing deferred — the queue is drained
    triggers.stop();
    expect(background.isUnregistered(0)).toBe(true);

    // Convergence: every command ACKED with its official number, exactly
    // six receipts (one journal each — INV-013), the cursors stable, the
    // oracles hold.
    for (const commandId of commandIds) {
      const row = outboxRowOf(rebooted.store, commandId);
      expect(row.status).toBe("ACKED");
      expect(String(row.official_no)).toMatch(/^RCV-/);
    }
    expect(await countRows("receipts")).toBe(receiptsBefore + 6);
    const finalCycle = await rebooted.device.cycle();
    expect(finalCycle.pushed).toBe(0);
    expect(finalCycle.accepted).toBe(0);
    await ledgerOraclesHold(TENANT_EXPO);
    rebooted.dispose();
  }, 30_000);
});

/**
 * The C-05 connectivity-flap injection: while `airplane` is armed every
 * transport call fails with the simulated connection drop (the airplane
 * window mid-cycle); everything delegates to the inner transport
 * untouched otherwise (inner call counters stay meaningful).
 */
class FlapTransport implements SyncTransport {
  airplane = false;

  constructor(private readonly inner: HarnessTransport) {}

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    if (this.airplane) {
      throw new Error("simulated connection drop (airplane mode)");
    }
    return operation();
  }

  async pull(entityType: string, cursor: string | null, limit?: number) {
    return this.guarded(() => this.inner.pull(entityType, cursor, limit));
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]) {
    return this.guarded(() => this.inner.push(batchId, commands));
  }

  async status() {
    return this.guarded(() => this.inner.status!());
  }

  async pushV2(request: { contractVersion: string; commands: readonly Record<string, unknown>[] }) {
    return this.guarded(() => this.inner.pushV2!(request));
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    return this.guarded(() => this.inner.pullAck!(positions));
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    return this.guarded(() => this.inner.pushAck!(commandIds));
  }
}

/**
 * The F-01 fault-soup injection over a real HarnessTransport: airplane
 * windows (every call fails), the dropped push response (the server
 * commits, the response never returns — C-04 through a transport fault),
 * and the duplicate delivery (the network retries the batch — the inbox
 * replays duplicate:true, zero new effects). The schedule is armed by
 * the test (drawn from the scenario's seeded RNG — deterministic).
 */
class SoupTransport implements SyncTransport {
  airplane = false;
  dropNextPushResponse = false;
  duplicateNextDelivery = false;
  /** The command counts of every dropped push response. */
  readonly droppedPushes: number[] = [];

  constructor(private readonly inner: HarnessTransport) {}

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    if (this.airplane) {
      throw new Error("simulated connection drop (airplane mode)");
    }
    return operation();
  }

  async pull(entityType: string, cursor: string | null, limit?: number) {
    return this.guarded(() => this.inner.pull(entityType, cursor, limit));
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]) {
    return this.guarded(() => this.inner.push(batchId, commands));
  }

  async status() {
    return this.guarded(() => this.inner.status!());
  }

  async pushV2(request: { contractVersion: string; commands: readonly Record<string, unknown>[] }) {
    await this.guarded(() => Promise.resolve());
    if (this.dropNextPushResponse) {
      this.dropNextPushResponse = false;
      // The server COMMITTED (the inner push executes + records the
      // inbox rows) — the response is dropped mid-flight.
      await this.inner.pushV2!(request);
      this.droppedPushes.push(request.commands.length);
      throw new Error("simulated connection drop mid-push (response lost)");
    }
    if (this.duplicateNextDelivery) {
      this.duplicateNextDelivery = false;
      await this.inner.pushV2!(request); // the first delivery
      return this.inner.pushV2!(request); // the network retry — the inbox replays
    }
    return this.inner.pushV2!(request);
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    return this.guarded(() => this.inner.pullAck!(positions));
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    return this.guarded(() => this.inner.pushAck!(commandIds));
  }
}

/**
 * The C-08 fault injection: a HarnessTransport whose `status()` advertises
 * a contract version the device cannot talk to while `gateArmed` (the
 * server-upgraded-past-the-device shape; the 020 `statusContractVersion`
 * override, made flippable so the restored-server leg can reuse the SAME
 * transport + device). Every other call delegates to the inner transport
 * untouched.
 */
class GatedHarnessTransport implements SyncTransport {
  gateArmed = false;
  /** Every push attempt that reached the inner transport (the C-08 "no
   * push attempted while gated" assertion). */
  readonly pushAttempts: string[] = [];

  constructor(
    private readonly inner: HarnessTransport,
    private readonly staleVersion: string,
  ) {}

  async status(): Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }> {
    if (this.gateArmed) {
      return {
        serverTime: new Date().toISOString(),
        contractVersion: this.staleVersion,
        device: { revoked: false },
      };
    }
    return this.inner.status();
  }

  async pull(entityType: string, cursor: string | null, limit?: number) {
    return this.inner.pull(entityType, cursor, limit);
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]) {
    this.pushAttempts.push(batchId);
    return this.inner.push(batchId, commands);
  }

  async pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }) {
    this.pushAttempts.push(request.contractVersion);
    return this.inner.pushV2(request);
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    return this.inner.pullAck(positions);
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    return this.inner.pushAck(commandIds);
  }
}
