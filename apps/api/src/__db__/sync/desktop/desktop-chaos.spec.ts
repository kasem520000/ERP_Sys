import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import {
  generateMinisignKeyPair,
  runUpdateCheck,
  SyncDesktopHost,
  DesktopSession,
  type DesktopStore,
} from "@erp/desktop";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

import { superuserClient } from "../../test-db";
import { closeDb } from "../../../infra/db/client";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { pull as pullService } from "../../../modules/sync/application/pull-service";
import { SyncDeviceRevokedError } from "../../../modules/sync/domain/sync-errors";
import { decodeCursor, encodeCursor } from "../../../modules/sync/application/cursor-tokens";
import {
  applyPullBatch,
  posAppliers,
  readCursor,
  resetCursor,
} from "../../../../../../packages/sync-core/src/store/pull";
import { SyncReadOnlyError } from "../../../../../../packages/sync-core/src/errors";
import { runCycle } from "../../../../../../packages/sync-core/src/cycle";
import type { SyncTransport } from "../../../../../../packages/sync-core/src/client";
import { seededRandom } from "../../../../../../packages/sync-core/src/test-harness/chaos";

import {
  countInbox,
  countInvoices,
  countJournalLines,
  countJournals,
  countStockMoves,
  enrollDevice,
  HarnessTransport,
  journalCountForSource,
  ledgerOraclesHold,
  makeSyncServices,
  posSalePayload,
  seedPosWorld,
  v2Command,
  type PosWorld,
} from "../_oracle";
import { desktopDevice, disposeDesktopFiles } from "./desktop-device";

/**
 * PHASE-021 T13/3-a · the FULL chaos matrix C-01…C-16 re-driven on the
 * DESKTOP file-store profile (MASTER-PLAN §9 — BINDING; SYNC_TESTS §5
 * device matrix + §7 PHASE-021 row; PHASE-021 §6 "full sync chaos matrix
 * against the desktop harness"): every scenario keeps the 020
 * chaos-matrix.spec.ts SHAPE — real API services, real embedded PG, the
 * real sync-core SyncClient/ReferenceDevice through the in-process
 * HarnessTransport — but every device is constructed via `desktopDevice()`:
 * the REAL `@erp/desktop` SQLite file store (better-sqlite3, WAL, dual-
 * profile DR-P21-02, migrations v1–5, deviceClass "tauri-desktop") on a
 * temp-dir file. The file-store-specific adaptations per scenario:
 *
 * - C-01/C-04/C-06: the outbox rows, statuses and honest states live in a
 *   REAL file; C-04 closes + reopens the DB (the simulated crash) before
 *   the recoveryPass;
 * - C-08: the contract-downgrade gate runs through the REAL SyncDesktopHost
 *   (phase "read-only" + one-per-trip onUpdatePrompt), the recovery runs
 *   through the REAL updater client against an in-test HTTP manifest
 *   server with REAL minisign signatures (ed25519 keys generated in-test),
 *   "update applied" = the meta `appVersion` bump, and the restored server
 *   proves contractGateCleared + writable resume + zero data corruption;
 * - C-09/C-16: the post-drain state is re-asserted after close+reopen (the
 *   file is the persistence proof);
 * - C-15: the tamper mutates the CAPTURED outbox row's payload in the file
 *   (the "tampered local row" premise, re-validated server-side);
 * - D-06: the four updater attack postures re-asserted in the DB-suite
 *   context against the same in-test HTTP manifest server (the 1-c suite
 *   proves the crypto; this block proves the integration posture).
 *
 * Dedicated tenant c0a0c0a0 (verified unused across the repo; the master
 * plan's TENANT_DESKTOP 21212121 is taken by push/policies specs — the
 * 2-d/1-b precedent). Seeded RNG per scenario (SYNC_TESTS §9).
 */

const TENANT_CHAOS = "c0a0c0a0-c0a0-c0a0-c0a0-c0a0c0a0c0a0";
const CHAOS_OWNER = "c0a0c0a0-0000-4000-8000-00000000c0a1";
const CHAOS_CASHIER = "c0a0c0a0-0000-4000-8000-00000000c0a2";
/** The C-13 foreign tenant (a REAL second tenant; owned by this suite). */
const TENANT_FOREIGN = "d1b1d1b1-d1b1-d1b1-d1b1-d1b1d1b1d1b1";
const FOREIGN_USER = "d1b1d1b1-0000-4000-8000-00000000d1b1";

const services = makeSyncServices();
let world: PosWorld;
let foreignItemId = "";
let foreignPartnerId = "";

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
  return withTenant(TENANT_CHAOS, () =>
    services.push.push({ deviceId, batchId: generateUuidV7(), commands, contractVersion }),
  );
}

/** Lock + later reopen the December 2026 period (the PERIOD_LOCKED shape). */
async function withDecemberLocked<T>(fn: () => Promise<T>): Promise<T> {
  const periodStore = await import("../../../modules/accounting/infrastructure/accounting.store");
  const period = await withTenant(TENANT_CHAOS, () => periodStore.findPeriodForDate("2026-12-05"));
  expect(period).toBeDefined();
  await withTenant(TENANT_CHAOS, () => services.periods.softClose(CHAOS_OWNER, period!.id));
  await withTenant(TENANT_CHAOS, () => services.periods.lock(CHAOS_OWNER, period!.id));
  try {
    return await fn();
  } finally {
    await withTenant(TENANT_CHAOS, () =>
      services.periods.reopen(CHAOS_OWNER, period!.id, "PHASE-021 desktop chaos C-03 December reopen"),
    );
  }
}

/** A captured pos_sale draft (the shared scenario shape). */
function saleDraft(offline: string, date: string, overrides: { item?: string; qty?: string; unitPrice?: string; tenders?: string } = {}) {
  const unitPrice = overrides.unitPrice ?? "100.000000";
  const qty = overrides.qty ?? "1";
  const net = Number(unitPrice) * Number(qty);
  return {
    clientId: generateUuidV7(),
    terminalId: world.terminalId,
    offlineReceiptNo: offline,
    invoiceDate: date,
    customerId: null,
    orderType: "COUNTER" as const,
    lines: [{ itemId: overrides.item ?? world.itemA, qty, unitPrice, taxCodeId: world.taxStd }],
    tenders: [{ method: "CASH" as const, amount: overrides.tenders ?? `${(net * 1.15).toFixed(4)}` }],
  };
}

/** Read one outbox row off the device's FILE store (typed columns). */
function outboxRowOf(
  store: DesktopStore,
  commandId: string,
): Record<string, unknown> {
  const row = store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId]);
  if (row === undefined) {
    throw new Error(`no outbox row for ${commandId}`);
  }
  return row;
}

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_CHAOS,
    name: "Tenant Desktop Chaos (P21 3a)",
    nameAr: "مستأجر فوضى سطح المكتب",
    prefix: "DTC",
    actor: CHAOS_OWNER,
    cashier: CHAOS_CASHIER,
    salesRep: CHAOS_OWNER,
  });

  // The C-13 foreign tenant: minimal but REAL rows (a user, a uom, an
  // item, a partner) — the ids tenant A's device will reference.
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant Foreign (P21 3a C-13)', 'المستأجر الأجنبي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_FOREIGN],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'p21-3a-foreign@fixture.test', 'P21 3a Foreign User', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_USER],
  );
  const uomId = generateUuidV7();
  foreignItemId = generateUuidV7();
  foreignPartnerId = generateUuidV7();
  await su.query(
    `INSERT INTO uoms (id, tenant_id, code, name) VALUES ($1, $2, 'PCS', 'Pieces')
     ON CONFLICT (id) DO NOTHING`,
    [uomId, TENANT_FOREIGN],
  );
  await su.query(
    `INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, base_price) VALUES
       ($1, $2, 'P21-ITEM', 'P21 3a Foreign Item', 'STOCK', $3, '100.000000')
     ON CONFLICT (id) DO NOTHING`,
    [foreignItemId, TENANT_FOREIGN, uomId],
  );
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $2, 'CUSTOMER', 'P21-P1', 'P21 3a Foreign Partner')
     ON CONFLICT (id) DO NOTHING`,
    [foreignPartnerId, TENANT_FOREIGN],
  );
  await su.end();
});

afterAll(async () => {
  disposeDesktopFiles();
  await closeDb();
});

describe("PHASE-021 desktop chaos matrix C-01…C-16 (SYNC_TESTS §5 desktop profile; MASTER-PLAN §9)", () => {
  it("C-01 duplicate deliveries: pos_sale delivered 4× from the FILE store → one ledger effect set, byte-equal inbox replays, the drain replays duplicate:true", async () => {
    const seed = 0xd01;
    console.log(`[C-01/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // Capture offline (pos_sales row + outbox command, ONE file-backed
    // transaction), then deliver the SAME captured command 4 times (the
    // network-retry shape): the server inbox executes once, replays the
    // ORIGINAL result verbatim on deliveries 2–4.
    const draft = saleDraft("OFF-DC01-00001", "2026-02-10");
    reference.captureSale(draft, "115.0000");
    const command = JSON.parse(
      String(outboxRowOf(dd.store, draft.clientId).payload),
    ) as Record<string, unknown>;

    const first = asAccepted(
      (await transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [command] }))[0]!,
    );
    expect(first.status).toBe("ACCEPTED");
    expect(first).not.toHaveProperty("duplicate");
    expect(first.officialNumber).toMatch(/^POS-/);
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
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 2);
    const invoiceId = first.result.invoiceId as string;
    expect(await journalCountForSource(TENANT_CHAOS, "sales_invoice", invoiceId)).toBe(2);
    const row = outboxRowOf(dd.store, draft.clientId);
    expect(row.status).toBe("ACKED");
    expect(row.official_no).toBe(first.result.officialNo as string);
    expect(dd.store.get("SELECT local_status FROM pos_sales WHERE id = ?", [draft.clientId])).toMatchObject({
      local_status: "SYNCED",
    });
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-02 reorder: the dependent update_draft arrives first → VALIDATION_ERROR referencing the missing dependency (recorded REJECTED in the file); resubmit after the predecessor lands", async () => {
    const seed = 0xd02;
    console.log(`[C-02/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);

    // (a) The premature dependent: references a draft that does not exist
    // yet. Captured on the FILE, cycled → typed rejection recorded.
    const draftId = generateUuidV7();
    const dependentId = reference.captureDraftInvoiceUpdate(
      draftId,
      {
        customerId: world.customerId,
        orderDate: "2026-03-01",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      },
      1,
    );
    const premature = await reference.cycle();
    expect(premature.rejected).toBe(1);
    expect(premature.accepted).toBe(0);
    const prematureRow = outboxRowOf(dd.store, dependentId);
    expect(prematureRow.status).toBe("REJECTED");
    expect(prematureRow.rejection_reason).toBe("VALIDATION_ERROR");
    expect(prematureRow.rejection_action).toBe("EDIT_AND_RESEND");
    const prematureTyped = JSON.parse(String(prematureRow.last_error)) as {
      reason: string;
      resubmittable: boolean;
      message: string;
    };
    expect(prematureTyped.resubmittable).toBe(true);
    expect(prematureTyped.message).toContain(draftId); // the missing dependency
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore); // zero orphans

    // (b) The predecessor lands (captured on the same device), then the
    // dependent is RESUBMITTED as a NEW command (CONFLICT_RESOLUTION §3)
    // against the now-existing draft.
    const createId = reference.captureDraftInvoiceCreate({
      customerId: world.customerId,
      orderDate: "2026-03-01",
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
    });
    const created = await reference.cycle();
    expect(created.accepted).toBe(1);
    const createdRow = outboxRowOf(dd.store, createId);
    expect(createdRow.status).toBe("ACKED");
    const createdResult = JSON.parse(String(createdRow.accepted_result)) as {
      result: { invoiceId: string };
      entity: { version: number };
    };
    const realDraftId = createdResult.result.invoiceId;
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);

    const resubmitId = reference.captureDraftInvoiceUpdate(
      realDraftId,
      {
        customerId: world.customerId,
        orderDate: "2026-03-02",
        lines: [{ itemId: world.itemA, qty: "3", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      },
      createdResult.entity.version,
    );
    const resubmitted = await reference.cycle();
    expect(resubmitted.accepted).toBe(1);
    const resubmitRow = outboxRowOf(dd.store, resubmitId);
    expect(resubmitRow.status).toBe("ACKED");
    const resubmitResult = JSON.parse(String(resubmitRow.accepted_result)) as {
      entity: { id: string; version: number };
    };
    expect(resubmitResult.entity).toMatchObject({ id: realDraftId, version: createdResult.entity.version + 1 });
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-03 partial batch: 5 captured sales, #3 PERIOD_LOCKED → 4 ACKED + 1 typed REJECTED in the file, zero residue", async () => {
    const seed = 0xd03;
    console.log(`[C-03/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);
    const linesBefore = await countJournalLines(TENANT_CHAOS);
    const clientIds: string[] = [];
    for (let n = 1; n <= 5; n += 1) {
      const draft = saleDraft(`OFF-DC03-0000${n}`, n === 3 ? "2026-12-05" : "2026-02-11");
      reference.captureSale(draft, draft.tenders[0]!.amount);
      clientIds.push(draft.clientId);
    }

    const outcome = await withDecemberLocked(() => reference.cycle());
    expect(outcome.pushed).toBe(5);
    expect(outcome.accepted).toBe(4);
    expect(outcome.rejected).toBe(1);

    // The file store's honest states: 4 ACKED/SYNCED + the typed reject.
    const statuses = clientIds.map((id) => String(outboxRowOf(dd.store, id).status));
    expect(statuses.filter((status) => status === "ACKED")).toHaveLength(4);
    const rejectedRow = outboxRowOf(dd.store, clientIds[2]!);
    expect(rejectedRow.status).toBe("REJECTED");
    expect(rejectedRow.rejection_reason).toBe("PERIOD_LOCKED");
    expect(rejectedRow.rejection_action).toBe("EDIT_AND_RESEND");
    expect(JSON.parse(String(rejectedRow.last_error))).toMatchObject({
      reason: "PERIOD_LOCKED",
      resubmittable: true,
    });
    // The wire-level shape (the 020 assertion surface): one direct
    // delivery in the SAME locked window carries the localized guidance
    // (the client stores the typed core; `localized` rides the result).
    const wireProbe = asRejected(
      (
        await withDecemberLocked(() =>
          pushV2(deviceId, [
            v2Command(
              "pos_sale",
              "create",
              "dchaos-c03-probe",
              posSalePayload(world, { offline: "OFF-DC03-00009", date: "2026-12-05" }),
            ),
          ]),
        )
      ).results[0]!,
    );
    expect(wireProbe.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 4); // the probe rejected — zero residue
    expect(dd.store.get("SELECT local_status FROM pos_sales WHERE id = ?", [clientIds[2]!])).toMatchObject({
      local_status: "REJECTED",
    });

    // Zero residue: 4 invoices, 8 journal entries, the EXACT line count
    // (4 × [3 settlement + 2 COGS] = 20) — #3's partial draft rolled back
    // with its savepoint.
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 4);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 8);
    expect(await countJournalLines(TENANT_CHAOS)).toBe(linesBefore + 20);
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-04 crash post-commit pre-ack on the FILE: close + reopen the DB → recoveryPass IN_FLIGHT→QUEUED → the re-push replays the original result — no second journal", async () => {
    const seed = 0xd04;
    console.log(`[C-04/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // Capture offline (one file-backed transaction).
    const draft = saleDraft("OFF-DC04-00001", "2026-02-12");
    reference.captureSale(draft, "115.0000");

    // The crash window: the server COMMITTED (push executed + inbox row
    // recorded) but the device never saw the response — the command stays
    // IN_FLIGHT and the result is dropped.
    reference.markInFlight([draft.clientId]);
    const command = JSON.parse(String(outboxRowOf(dd.store, draft.clientId).payload)) as Record<string, unknown>;
    const dropped = asAccepted(
      (await transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [command] }))[0]!,
    );
    expect(dropped.status).toBe("ACCEPTED"); // the server committed…
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 2);
    expect(reference.state().queue.inFlight).toBe(1);

    // CRASH (simulated): close the DB handle + reopen the SAME file — the
    // outbox row must still be IN_FLIGHT on disk, the boot recoveryPass
    // flips it QUEUED, integrity stays ok.
    const rebooted = dd.reopen();
    assertRebootState(rebooted, draft.clientId);
    const recovery = rebooted.recover();
    expect(recovery.recoveredInFlight).toBe(1);
    expect(recovery.integrity).toBe("ok");

    // The full cycle re-pushes the SAME command — the inbox replays the
    // ORIGINAL result (duplicate:true), never a second execution.
    const outcome = await rebooted.device.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.duplicates).toBe(1);
    expect(outcome.rejected).toBe(0);
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 2);
    const invoiceId = dropped.result.invoiceId as string;
    expect(await journalCountForSource(TENANT_CHAOS, "sales_invoice", invoiceId)).toBe(2);
    const row = outboxRowOf(rebooted.store, draft.clientId);
    expect(row.status).toBe("ACKED");
    expect(row.official_no).toBe(dropped.result.officialNo as string);
    expect(rebooted.store.get("SELECT * FROM pos_sales WHERE id = ?", [draft.clientId])).toMatchObject({
      local_status: "SYNCED",
      official_no: dropped.result.officialNo,
    });
    await ledgerOraclesHold(TENANT_CHAOS);
    rebooted.dispose();
  });

  it("C-05 flap mid-pull: a fetched page is discarded → the FILE cursor not advanced; the re-pull serves the same page; the full drain equals the oracle", async () => {
    const seed = 0xd05;
    console.log(`[C-05/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    // The flap: fetch a page (limit 2), the connection drops — the page is
    // DISCARDED before any local commit (nothing in the cursors table).
    const page = await transport.pull("items", null, 2);
    expect(page.hasMore).toBe(true);
    expect(page.changes.length).toBe(2);
    expect(readCursor(reference.adapter, "items")).toBeNull();
    expect(dd.store.all("SELECT * FROM cursors")).toHaveLength(0);

    // Connectivity returns: the re-pull from the SAME cursor serves the
    // same page (pulls are idempotent; seq order is stable).
    const rePage = await transport.pull("items", null, 2);
    expect({ entityType: rePage.entityType, hasMore: rePage.hasMore, changes: rePage.changes }).toEqual(
      { entityType: page.entityType, hasMore: page.hasMore, changes: page.changes },
    );

    // The full drain: the applied rows equal the feed's DISTINCT entity
    // ids — no duplicates, no gaps — persisted in the file.
    const pulled = await reference.client.pullAll();
    const distinctIds = await withTenant(TENANT_CHAOS, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(DISTINCT entity_id)::int AS n FROM change_log WHERE entity_type = 'items'
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(pulled.items).toBe(distinctIds);
    expect(dd.store.all("SELECT id FROM items")).toHaveLength(distinctIds);
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-06 revoke mid-queue: pull throws DEVICE_REVOKED, pushes per-item DEVICE_REVOKED, the FILE queue pending (no silent loss), reconciliation lists the device", async () => {
    const seed = 0xd06;
    console.log(`[C-06/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // One command executed + recorded server-side, its ack lost mid-queue.
    const ackedLost = saleDraft("OFF-DC06-00001", "2026-02-13");
    reference.captureSale(ackedLost, "115.0000");
    reference.markInFlight([ackedLost.clientId]);
    const command = JSON.parse(String(outboxRowOf(dd.store, ackedLost.clientId).payload)) as Record<string, unknown>;
    const executed = asAccepted(
      (await transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [command] }))[0]!,
    );
    expect(executed.status).toBe("ACCEPTED");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);

    // A second command still queued when the tenant revokes the device.
    const queued = saleDraft("OFF-DC06-00002", "2026-02-13");
    reference.captureSale(queued, "115.0000");
    await withTenant(TENANT_CHAOS, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`UPDATE devices SET revoked_at = now() WHERE id = ${deviceId}::uuid`);
    });

    // Pulls: refused BEFORE anything is served (typed exception).
    await expect(
      withTenant(TENANT_CHAOS, () => pullService({ entityType: "items", cursor: null, deviceId })),
    ).rejects.toBeInstanceOf(SyncDeviceRevokedError);
    await expect(transport.pull("items", null)).rejects.toMatchObject({ code: "DEVICE_REVOKED" });

    // Pushes: per-item DEVICE_REVOKED, zero execution.
    const { results } = await pushV2(deviceId, [
      v2Command("pos_sale", "create", "dchaos-c06-1", posSalePayload(world, { offline: "OFF-DC06-10001", date: "2026-02-13" })),
      v2Command("pos_sale", "create", "dchaos-c06-2", posSalePayload(world, { offline: "OFF-DC06-10002", date: "2026-02-13" })),
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
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 2);
    expect(await countInbox(TENANT_CHAOS, deviceId)).toBe(1);

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
    for (const row of dd.store.all("SELECT status FROM outbox")) {
      expect(row.status).toBe("QUEUED");
    }

    // The reconciliation queue lists the device (the un-acked command).
    const queue = await withTenant(TENANT_CHAOS, () => services.reconciliation.pendingOperations());
    const entry = queue.find((row) => row.deviceId === deviceId);
    expect(entry).toBeDefined();
    expect(entry!.pendingCommands).toBe(1);
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-07 clock skew ±48h: the captured command's advisory timestamps are ignored — server-authoritative ledger dates, same-second dedupe by id", async () => {
    const seed = 0xd07;
    console.log(`[C-07/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const now = Date.now();
    const futureClient = new Date(now + 48 * 3_600_000).toISOString();
    const pastClient = new Date(now - 48 * 3_600_000).toISOString();

    const invoicesBefore = await countInvoices(TENANT_CHAOS);

    // (a) Direct deliveries with skewed clientCreatedAt (±48h extremes):
    // accepted, but the journal carries the BUSINESS date + the server
    // clock (never the skewed client time).
    const futureCommand = v2Command(
      "pos_sale",
      "create",
      "dchaos-c07-future",
      posSalePayload(world, { offline: "OFF-DC07-00001", date: "2026-02-14" }),
      { clientCreatedAt: futureClient },
    );
    const pastCommand = v2Command(
      "pos_sale",
      "create",
      "dchaos-c07-past",
      posSalePayload(world, { offline: "OFF-DC07-00002", date: "2026-02-14" }),
      { clientCreatedAt: pastClient },
    );
    const { results } = await pushV2(deviceId, [futureCommand, pastCommand]);
    expect(results.map((item) => item.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
    for (const item of results) {
      const invoiceId = asAccepted(item).result.invoiceId as string;
      const rows = await withTenant(TENANT_CHAOS, async () => {
        const tx = requireTenantContext().tx!;
        const entry = await tx.execute(sql`
          SELECT je.entry_date AS "entryDate", je.posted_at AS "postedAt"
          FROM journal_entries je
          WHERE je.source_type = 'sales_invoice' AND je.source_id = ${invoiceId}::uuid
          ORDER BY je.operation
        `);
        return entry.rows as unknown as { entryDate: string; postedAt: Date }[];
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.entryDate).toBe("2026-02-14"); // the business date
        expect(new Date(row.postedAt).getTime()).toBeLessThanOrEqual(Date.now()); // server clock
        expect(new Date(row.postedAt).getTime()).toBeLessThan(new Date(futureClient).getTime());
      }
    }
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 2);

    // Same-second dedupe: the SAME command redelivered replays by ID; a
    // DIFFERENT command sharing the same clientCreatedAt processes
    // independently.
    const replay = asAccepted((await pushV2(deviceId, [futureCommand])).results[0]!);
    expect(replay.duplicate).toBe(true);
    const sameSecondDifferentCommand = v2Command(
      "pos_sale",
      "create",
      "dchaos-c07-sames",
      posSalePayload(world, { offline: "OFF-DC07-00003", date: "2026-02-14" }),
      { clientCreatedAt: futureClient },
    );
    const distinct = asAccepted((await pushV2(deviceId, [sameSecondDifferentCommand])).results[0]!);
    expect(distinct).not.toHaveProperty("duplicate");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 3);

    // (b) The FILE-store leg: a captured sale whose advisory `createdAt`
    // is skewed to +48h in the outbox row (the tampered-clock client)
    // drains ACCEPTED — the local honest state is unaffected by the skew.
    const draft = saleDraft("OFF-DC07-00004", "2026-02-14");
    reference.captureSale(draft, "115.0000");
    const payload = JSON.parse(String(outboxRowOf(dd.store, draft.clientId).payload)) as {
      createdAt: string;
    };
    payload.createdAt = futureClient;
    dd.store.run("UPDATE outbox SET payload = ? WHERE command_id = ?", [
      JSON.stringify(payload),
      draft.clientId,
    ]);
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(0);
    expect(outboxRowOf(dd.store, draft.clientId).status).toBe("ACKED");
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-08 stale contract + REAL signed update: per-item rejects; the gate trips (outbox untouched) → the updater installs a REAL minisign-signed build → server restored → gate cleared, writable, clean resume, zero corruption", async () => {
    const seed = 0xd08;
    console.log(`[C-08/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const inboxBefore = await countInbox(TENANT_CHAOS, deviceId);

    // (a) The real server leg: a batch carrying the stale version — every
    // item rejected CONTRACT_VERSION_UNSUPPORTED, nothing executed.
    const stale = "1999-01-01.1";
    const { results } = await pushV2(
      deviceId,
      [
        v2Command("pos_sale", "create", "dchaos-c08-1", posSalePayload(world, { offline: "OFF-DC08-00001", date: "2026-02-15" })),
        v2Command("pos_sale", "create", "dchaos-c08-2", posSalePayload(world, { offline: "OFF-DC08-00002", date: "2026-02-15" })),
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
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    expect(await countInbox(TENANT_CHAOS, deviceId)).toBe(inboxBefore);

    // (b) The device whose compiled-in version is stale (meta preset
    // BEFORE construction): the cycle pushes, the server rejects per-item,
    // the FILE records the typed rejections.
    const staleTransport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const staleDd = desktopDevice({
      transport: staleTransport,
      seed,
      presetMeta: { contractVersion: stale },
    });
    const staleDraft = saleDraft("OFF-DC08-00003", "2026-02-15");
    staleDd.device.captureSale(staleDraft, "115.0000");
    const staleOutcome = await staleDd.device.cycle();
    expect(staleOutcome.rejected).toBe(1);
    expect(staleOutcome.accepted).toBe(0);
    const staleRow = outboxRowOf(staleDd.store, staleDraft.clientId);
    expect(staleRow.rejection_reason).toBe("CONTRACT_VERSION_UNSUPPORTED");
    expect(JSON.parse(String(staleRow.last_error))).toMatchObject({ resubmittable: false });
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    staleDd.dispose();

    // (c) The GATE through the REAL SyncDesktopHost: a server advertising
    // a version the device cannot talk to → read-only, no push attempted,
    // the captured command stays QUEUED (never fabricated ACCEPTED), the
    // one-per-trip onUpdatePrompt fires.
    const gatedTransport = new GatedHarnessTransport(
      new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push }),
      "1999-01-01.0",
    );
    const gatedDd = desktopDevice({ transport: gatedTransport, seed: seed + 1 });
    gatedDd.store.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('appVersion', '1.0.0')");
    const session = new DesktopSession({
      getRefreshToken: async () => "device-refresh-token",
      refresh: async () => ({
        accessToken: "device-access-token",
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    });
    const prompts: string[] = [];
    const host = new SyncDesktopHost({
      store: gatedDd.store,
      transport: gatedTransport,
      session,
      deviceId,
      onUpdatePrompt: (reason) => prompts.push(reason),
    });
    const gateDraft = saleDraft("OFF-DC08-00004", "2026-02-15");
    gatedDd.device.captureSale(gateDraft, "115.0000"); // queued before the gate is known
    gatedTransport.gateArmed = true;
    const gateOutcome = await host.syncNow();
    expect(gateOutcome.outcome!.readOnly).toBe(true);
    expect(gateOutcome.outcome!.pushed).toBe(0);
    expect(gatedTransport.pushAttempts).toHaveLength(0); // no push attempted
    expect(host.state.phase).toBe("read-only");
    expect(host.readOnlyReason).toBe("CONTRACT_VERSION_UNSUPPORTED");
    expect(prompts).toEqual(["CONTRACT_VERSION_UNSUPPORTED"]); // fired ONCE
    expect(host.canWrite()).toBe(false);
    const gateRow = outboxRowOf(gatedDd.store, gateDraft.clientId);
    expect(gateRow.status).toBe("QUEUED"); // untouched — honest
    expect(gateRow.official_no ?? null).toBeNull();
    // captures FAIL LOUDLY while gated (assertWritable on the FILE).
    expect(() =>
      gatedDd.device.capture({
        entityType: "partner",
        intent: "contact_merge",
        payload: { partnerId: generateUuidV7(), phone: "+966500000000" },
      }),
    ).toThrow(SyncReadOnlyError);

    // (d) The REAL signed update: in-test HTTP manifest server + REAL
    // minisign keys; the updater client fetches + verifies + installs —
    // "update applied" is the meta appVersion bump (documented harness
    // contract: the shell relaunches the new build).
    const keyPair = generateMinisignKeyPair();
    const bundle = Buffer.concat([
      Buffer.from("PHASE-021 desktop chaos C-08 signed bundle: "),
      Buffer.alloc(4096, 0xa5),
    ]);
    // "Update applied" (documented harness contract): the shell's install
    // port relaunches the new build — modeled as the meta `appVersion`
    // bump on the store (the running-build marker the UI + gates read).
    const updateServer = await startUpdaterManifestServer({
      keyPair,
      bundle,
      version: "2.0.0",
      installHook: (manifest) => {
        gatedDd.store.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('appVersion', ?)", [
          manifest.version,
        ]);
      },
    });
    try {
      const update = await runUpdateCheck({
        currentVersion: "1.0.0",
        deviceId,
        channel: "stable",
        trustedPublicKeys: [keyPair.publicKeyFile],
        ports: updateServer.ports,
      });
      expect(update.state).toBe("relaunch");
      expect(update.manifest?.version).toBe("2.0.0");
      expect(
        gatedDd.store.get("SELECT value FROM meta WHERE key = 'appVersion'"),
      ).toMatchObject({ value: "2.0.0" }); // the applied build

      // (e) Server restored (supported contract): the next cycle clears
      // the gate (contractGateCleared), the store is writable again, the
      // queued command drains — clean resume, zero data corruption.
      gatedTransport.gateArmed = false;
      const resume = await host.syncNow();
      expect(resume.outcome!.readOnly).toBe(false);
      expect(resume.outcome!.pushed).toBe(1);
      expect(resume.outcome!.accepted).toBe(1);
      expect(host.state.phase).toBe("idle");
      expect(host.canWrite()).toBe(true);
      expect(
        gatedDd.store.get("SELECT value FROM meta WHERE key = 'contractGate'"),
      ).toMatchObject({ value: "ok" });
      const resumedRow = outboxRowOf(gatedDd.store, gateDraft.clientId);
      expect(resumedRow.status).toBe("ACKED");
      expect(String(resumedRow.official_no)).toMatch(/^POS-/);
      expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);

      // No data corruption: the (c)-era local state survived the whole
      // gate→update→resume journey byte-intact (cursors consistent, the
      // pos_sales row SYNCED with its official number).
      const cursorCount = Number(
        gatedDd.store.get("SELECT value FROM meta WHERE key = 'cursorCount'")?.value ?? "0",
      );
      expect(gatedDd.store.all("SELECT * FROM cursors")).toHaveLength(cursorCount);
      expect(
        gatedDd.store.get("SELECT * FROM pos_sales WHERE id = ?", [gateDraft.clientId]),
      ).toMatchObject({ local_status: "SYNCED" });
      // A second cycle is a clean no-op drain.
      const idle = await host.syncNow();
      expect(idle.outcome!.pushed).toBe(0);
      await ledgerOraclesHold(TENANT_CHAOS);
    } finally {
      updateServer.close();
      gatedDd.dispose();
    }
  });

  it("C-09 20 queued sales, 2 engineered rejects → 18 official numbers, typed rejects with user actions in the FILE, PENDING_SYNC never posted; the state survives close+reopen", async () => {
    const seed = 0xd09;
    const rng = seededRandom(seed);
    console.log(`[C-09/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const stockShortageIndex = 1 + ((rng() * 20) | 0);
    let inactiveItemIndex = 1 + ((rng() * 20) | 0);
    if (inactiveItemIndex === stockShortageIndex) {
      inactiveItemIndex = inactiveItemIndex === 20 ? 1 : inactiveItemIndex + 1;
    }
    console.log(`[C-09/desktop] engineered rejects: #${stockShortageIndex} (stock) #${inactiveItemIndex} (inactive item)`);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const clientIds: string[] = [];
    for (let n = 1; n <= 20; n += 1) {
      const draft =
        n === stockShortageIndex
          ? saleDraft(`OFF-DC09-${String(n).padStart(5, "0")}`, "2026-02-16", {
              item: world.itemB,
              qty: "500",
              unitPrice: "40.000000",
              tenders: "23000.0000",
            })
          : n === inactiveItemIndex
            ? saleDraft(`OFF-DC09-${String(n).padStart(5, "0")}`, "2026-02-16", {
                item: world.itemInactive,
                unitPrice: "10.000000",
                tenders: "11.5000",
              })
            : saleDraft(`OFF-DC09-${String(n).padStart(5, "0")}`, "2026-02-16");
      reference.captureSale(draft, draft.tenders[0]!.amount);
      clientIds.push(draft.clientId);
    }

    // Honest state BEFORE the drain: every receipt PENDING_SYNC, the
    // official number appears NOWHERE (OFFLINE_ARCHITECTURE §5).
    const preState = reference.state();
    expect(preState.businessRows.pos_sales ?? []).toHaveLength(20);
    for (const row of preState.businessRows.pos_sales ?? []) {
      expect(row.local_status).toBe("PENDING_SYNC");
      expect(row.official_no ?? null).toBeNull();
    }
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);

    // The drain: one cycle (FIFO ≤ 50 — all 20 in one batch).
    const outcome = await reference.cycle();
    expect(outcome.pushed).toBe(20);
    expect(outcome.accepted).toBe(18);
    expect(outcome.rejected).toBe(2);
    expect(outcome.deferred).toBe(0);

    const officialNumbers = await withTenant(TENANT_CHAOS, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(*)::int AS n FROM sales_invoices
        WHERE channel = 'POS' AND invoice_no LIKE 'POS-%' AND invoice_date = '2026-02-16'
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(officialNumbers).toBe(18);
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 18);

    // The 2 rejects: typed reasons with user-action guidance in the FILE.
    const rejectedRows = dd.store
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
    expect(rejectedRows.map((row) => row.reason).sort()).toEqual(["INSUFFICIENT_STOCK", "ITEM_INACTIVE"]);
    for (const row of rejectedRows) {
      expect(row.action).toBe(
        row.typed.reason === "ITEM_INACTIVE" ? "CANCEL_WITH_REASON" : "EDIT_AND_RESEND",
      );
      expect(typeof row.typed.resubmittable).toBe("boolean");
    }
    const stockReject = rejectedRows.find((row) => row.reason === "INSUFFICIENT_STOCK")!;
    expect(stockReject.typed.details).toMatchObject({ itemId: world.itemB });

    // Honest state AFTER: 18 SYNCED with official numbers, 2 REJECTED
    // (never SYNCED, never an official number).
    const postState = reference.state();
    expect(postState.queue.acked).toBe(18);
    expect(postState.queue.rejected).toBe(2);
    const syncedRows = (postState.businessRows.pos_sales ?? []).filter((row) => row.local_status === "SYNCED");
    const rejectedSales = (postState.businessRows.pos_sales ?? []).filter((row) => row.local_status === "REJECTED");
    expect(syncedRows).toHaveLength(18);
    expect(rejectedSales).toHaveLength(2);
    for (const row of syncedRows) {
      expect(row.official_no).toMatch(/^POS-/);
    }
    for (const row of rejectedSales) {
      expect(row.official_no ?? null).toBeNull();
      expect(row.journal_entry_id ?? null).toBeNull();
    }

    // The FILE persistence proof: close + reopen — the whole post-drain
    // state is byte-identical from the reopened handle.
    const rebooted = dd.reopen();
    const rebootedState = rebooted.device.state();
    expect(rebootedState.queue).toEqual({ pending: 0, inFlight: 0, rejected: 2, acked: 18 });
    expect(rebootedState.businessRows.pos_sales ?? []).toHaveLength(20);
    expect(
      rebooted.store.all("SELECT * FROM pos_sales WHERE local_status = 'SYNCED' AND official_no LIKE 'POS-%'"),
    ).toHaveLength(18);
    await ledgerOraclesHold(TENANT_CHAOS);
    rebooted.dispose();
  });

  it("C-09b PRICE_CHANGED: a captured sale with a stale unit price rejects PRICE_CHANGED (details {itemId, resolved, provided} in the FILE), zero residue; override-allowed lane posts", async () => {
    const seed = 0xd9b;
    console.log(`[C-09b/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // Overrides DISALLOWED (BR-003 gate on the POS path).
    const su = await superuserClient();
    const settingId = generateUuidV7();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES ($1, $2, 'sales.price_override_allowed', 'false'::jsonb)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
      [settingId, TENANT_CHAOS],
    );
    try {
      // Stale price (90 vs resolved 100) with CONSISTENT tenders (90×1.15).
      const stale = saleDraft("OFF-DC09B-00001", "2026-02-17", { unitPrice: "90.000000" });
      reference.captureSale(stale, stale.tenders[0]!.amount);
      const gated = await reference.cycle();
      expect(gated.rejected).toBe(1);
      const row = outboxRowOf(dd.store, stale.clientId);
      expect(row.rejection_reason).toBe("PRICE_CHANGED");
      const typed = JSON.parse(String(row.last_error)) as {
        reason: string;
        resubmittable: boolean;
        details: { itemId: string; provided: string; resolved: string };
      };
      expect(typed.resubmittable).toBe(true);
      expect(typed.details).toMatchObject({ itemId: world.itemA, provided: "90.000000" });
      expect(String(typed.details.resolved)).toMatch(/^100(\.0+)?$/);
      expect(row.rejection_action).toBe("ACCEPT_SERVER_PRICE");
      expect(dd.store.get("SELECT local_status FROM pos_sales WHERE id = ?", [stale.clientId])).toMatchObject({
        local_status: "REJECTED",
      });

      // Zero residue.
      expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
      expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore);
      await ledgerOraclesHold(TENANT_CHAOS);

      // Overrides ALLOWED (the default): the same stale sale POSTS (016
      // lane-pricing semantics).
      await su.query(
        `UPDATE tenant_settings SET value = 'true'::jsonb
         WHERE tenant_id = $1 AND key = 'sales.price_override_allowed'`,
        [TENANT_CHAOS],
      );
      const lane = saleDraft("OFF-DC09B-00002", "2026-02-17", { unitPrice: "90.000000" });
      reference.captureSale(lane, lane.tenders[0]!.amount);
      const laneOutcome = await reference.cycle();
      expect(laneOutcome.accepted).toBe(1);
      expect(String(outboxRowOf(dd.store, lane.clientId).official_no)).toMatch(/^POS-/);
    } finally {
      await su.query(
        `UPDATE tenant_settings SET value = 'true'::jsonb
         WHERE tenant_id = $1 AND key = 'sales.price_override_allowed'`,
        [TENANT_CHAOS],
      );
      await su.end();
    }
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-10 two DESKTOP devices edit the same draft → non-owner FORBIDDEN, owner-stale STALE_VERSION, owner-current ACCEPTED (one resolution path, two files)", async () => {
    const seed = 0xd0a;
    console.log(`[C-10/desktop] seed=${seed}`);
    const owner = await enrollDevice(TENANT_CHAOS, CHAOS_OWNER, { deviceClass: "tauri-desktop" });
    const other = await enrollDevice(TENANT_CHAOS, CHAOS_OWNER, { deviceClass: "tauri-desktop" });
    const ownerTransport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: owner, push: services.push });
    const otherTransport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: other, push: services.push });
    const ownerDd = desktopDevice({ transport: ownerTransport, seed });
    const otherDd = desktopDevice({ transport: otherTransport, seed: seed + 1 });

    // The draft exists (owner-created, captured on the owner's FILE).
    const createId = ownerDd.device.captureDraftInvoiceCreate({
      customerId: world.customerId,
      orderDate: "2026-03-01",
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
    });
    const created = await ownerDd.device.cycle();
    expect(created.accepted).toBe(1);
    const createdResult = JSON.parse(String(outboxRowOf(ownerDd.store, createId).accepted_result)) as {
      result: { invoiceId: string };
      entity: { version: number };
    };
    const draftId = createdResult.result.invoiceId;
    const baseVersion = createdResult.entity.version;

    // Non-owner device: FORBIDDEN with details.ownerDeviceId (C-10).
    const nonOwnerId = otherDd.device.captureDraftInvoiceUpdate(
      draftId,
      {
        customerId: world.customerId,
        orderDate: "2026-03-02",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
      },
      baseVersion,
    );
    const nonOwnerCycle = await otherDd.device.cycle();
    expect(nonOwnerCycle.rejected).toBe(1);
    const nonOwnerRow = outboxRowOf(otherDd.store, nonOwnerId);
    expect(nonOwnerRow.rejection_reason).toBe("FORBIDDEN");
    const nonOwnerTyped = JSON.parse(String(nonOwnerRow.last_error)) as {
      resubmittable: boolean;
      details: { ownerDeviceId: string };
    };
    expect(nonOwnerTyped.resubmittable).toBe(false);
    expect(nonOwnerTyped.details).toMatchObject({ ownerDeviceId: owner });

    // Owner with a stale baseVersion: STALE_VERSION with the fresh row
    // version (the losing device reconciles against it).
    const staleId = ownerDd.device.captureDraftInvoiceUpdate(
      draftId,
      {
        customerId: world.customerId,
        orderDate: "2026-03-03",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
      },
      99,
    );
    const staleCycle = await ownerDd.device.cycle();
    expect(staleCycle.rejected).toBe(1);
    const staleRow = outboxRowOf(ownerDd.store, staleId);
    expect(staleRow.rejection_reason).toBe("STALE_VERSION");
    expect(staleRow.rejection_action).toBe("EDIT_AND_RESEND");
    const staleTyped = JSON.parse(String(staleRow.last_error)) as {
      details: { currentVersion: number };
    };
    expect(staleTyped.details).toMatchObject({ currentVersion: baseVersion });
    // The wire-level shape (the 020 assertion surface): the stale-version
    // rejection carries the localized guidance (the client stores the
    // typed core; `localized` rides the result).
    const staleProbe = asRejected(
      (
        await pushV2(owner, [
          v2Command(
            "sales_invoice",
            "update_draft",
            "dchaos-c10-probe",
            {
              invoiceId: draftId,
              customerId: world.customerId,
              orderDate: "2026-03-05",
              lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
            },
            { baseVersion: 99 },
          ),
        ])
      ).results[0]!,
    );
    expect(staleProbe.reason).toBe("STALE_VERSION");
    expect(staleProbe.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });

    // Owner with the CURRENT baseVersion: ACCEPTED — exactly one
    // resolution path (the draft is single-writer).
    const winnerId = ownerDd.device.captureDraftInvoiceUpdate(
      draftId,
      {
        customerId: world.customerId,
        orderDate: "2026-03-04",
        lines: [{ itemId: world.itemA, qty: "2", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      },
      baseVersion,
    );
    const winnerCycle = await ownerDd.device.cycle();
    expect(winnerCycle.accepted).toBe(1);
    const winnerResult = JSON.parse(String(outboxRowOf(ownerDd.store, winnerId).accepted_result)) as {
      entity: { id: string; version: number };
    };
    expect(winnerResult.entity).toMatchObject({ id: draftId, version: baseVersion + 1 });

    // The final ledger state matches exactly one resolution path.
    const row = await withTenant(TENANT_CHAOS, async () => {
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
    await ledgerOraclesHold(TENANT_CHAOS);
    ownerDd.dispose();
    otherDd.dispose();
  });

  it("C-11 tombstone: soft-deleted item pulls op:DELETE + payload:null into the FILE, stale pushes reject ITEM_INACTIVE, unknown-row tombstones no-op", async () => {
    const seed = 0xd0b;
    const rng = seededRandom(seed);
    console.log(`[C-11/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    // A dedicated tombstone victim item (never referenced elsewhere).
    const victimId = await withTenant(TENANT_CHAOS, async () => {
      const itemsStore = await import("../../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const inserted = await itemsStore.insertItem({
        sku: `DTC-TOMB-${(rng() * 1e6) | 0}`,
        name: "C-11 Desktop Tombstone Victim",
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
    expect(dd.store.get("SELECT * FROM items WHERE id = ?", [victimId])).toBeDefined();

    // Soft-delete server-side (tombstone transport + the GC ledger row).
    await withTenant(TENANT_CHAOS, async () => {
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
    const tombstones = await withTenant(TENANT_CHAOS, async () => {
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
    expect(dd.store.get("SELECT * FROM items WHERE id = ?", [victimId])).toBeUndefined();

    // A stale push referencing the tombstoned id: ITEM_INACTIVE (the
    // tenant's OWN tombstoned master data speaks the actionable
    // vocabulary; cross-tenant no-disclosure is C-13's concern); the
    // truly-unknown id stays the generic VALIDATION_ERROR.
    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const unknownItemId = generateUuidV7();
    const tombstonePush = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("pos_sale", "create", "dchaos-c11-tombstone", posSalePayload(world, { offline: "OFF-DC11-00001", date: "2026-02-17", item: victimId, unitPrice: "10.000000" })),
        ])
      ).results[0]!,
    );
    const unknownPush = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("pos_sale", "create", "dchaos-c11-unknown", posSalePayload(world, { offline: "OFF-DC11-00002", date: "2026-02-17", item: unknownItemId, unitPrice: "10.000000" })),
        ])
      ).results[0]!,
    );
    expect(tombstonePush.reason).toBe("ITEM_INACTIVE");
    expect(tombstonePush.resubmittable).toBe(false);
    expect(tombstonePush.action).toBe("CANCEL_WITH_REASON");
    expect(unknownPush.reason).toBe("VALIDATION_ERROR");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore); // no resurrection

    // A tombstone for a row the device NEVER had: a no-op (idempotent —
    // the cursor still advances past it).
    const unknownRowId = generateUuidV7();
    await withTenant(TENANT_CHAOS, async () => {
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
    expect(dd.store.get("SELECT * FROM items WHERE id = ?", [unknownRowId])).toBeUndefined();
    expect(readCursor(reference.adapter, "items")).toBe(after.cursor);
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-11b: a pos_sale referencing a soft-deleted (tombstoned) item rejects ITEM_INACTIVE resubmittable:false CANCEL_WITH_REASON (deactivated master data vocabulary)", async () => {
    const seed = 0xd1b;
    const rng = seededRandom(seed);
    console.log(`[C-11b/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const tombstonedId = await withTenant(TENANT_CHAOS, async () => {
      const itemsStore = await import("../../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const inserted = await itemsStore.insertItem({
        sku: `DTC-C11B-${(rng() * 1e6) | 0}`,
        name: "C-11b Desktop Tombstoned Ref",
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
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`
        UPDATE items SET deleted_at = now(), status = 'ARCHIVED', updated_at = now()
        WHERE id = ${inserted.id}::uuid
      `);
      return inserted.id;
    });

    const deletedItem = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("pos_sale", "create", "dchaos-c11b-deleted", posSalePayload(world, { offline: "OFF-DC11B-00001", date: "2026-02-18", item: tombstonedId, unitPrice: "10.000000" })),
        ])
      ).results[0]!,
    );
    expect(deletedItem.reason).toBe("ITEM_INACTIVE");
    expect(deletedItem.resubmittable).toBe(false);
    expect(deletedItem.action).toBe("CANCEL_WITH_REASON");

    const inactiveItem = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("pos_sale", "create", "dchaos-c11b-inactive", posSalePayload(world, { offline: "OFF-DC11B-00002", date: "2026-02-18", item: world.itemInactive, unitPrice: "10.000000" })),
        ])
      ).results[0]!,
    );
    expect(inactiveItem.reason).toBe("ITEM_INACTIVE");
    expect(inactiveItem.resubmittable).toBe(false);
    expect(inactiveItem.action).toBe("CANCEL_WITH_REASON");

    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-12 cursor beyond the feed head → resync directive (fresh 0-cursor); the desktop client honors it; the reset persists in the FILE; ledger untouched", async () => {
    const seed = 0xd0c;
    console.log(`[C-12/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // A crafted token with a seq far beyond the tenant's feed head.
    const beyond = encodeCursor({ entityType: "items", seq: 999_999_999, issuedAt: new Date().toISOString() });
    const resync = await withTenant(TENANT_CHAOS, () =>
      pullService({ entityType: "items", cursor: beyond, deviceId }),
    );
    expect(resync.resync).toBe(true);
    expect(resync.changes).toHaveLength(0);
    expect(resync.hasMore).toBe(false);
    const fresh = decodeCursor(resync.cursor);
    expect(fresh?.entityType).toBe("items");
    expect(fresh?.seq).toBe(0);

    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore);

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
    expect(dd.store.all("SELECT id FROM items").length).toBeGreaterThan(0);
    const state = reference.state();
    expect(state.cursors.items).not.toBe(beyond); // the bounded restart landed
    // …and the reset cursor is durable: close + reopen keeps it.
    const rebooted = dd.reopen();
    expect(readCursor(rebooted.device.adapter, "items")).toBe(state.cursors.items);
    await ledgerOraclesHold(TENANT_CHAOS);
    rebooted.dispose();
  });

  it("C-13 cross-tenant references: foreign ids reject with the SAME error shape as unknown ids, zero effects (tenant B byte-identical)", async () => {
    const seed = 0xd0d;
    console.log(`[C-13/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;
    const invoicesBefore = await countInvoices(TENANT_CHAOS);

    // (a) A REAL tenant-B item id vs an unknown id: identical rejection
    // shape (404-equivalent — no existence disclosure).
    const foreignItem = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("pos_sale", "create", "dchaos-c13-foreign-item", posSalePayload(world, { offline: "OFF-DC13-00001", date: "2026-02-18", item: foreignItemId, unitPrice: "100.000000" })),
        ])
      ).results[0]!,
    );
    const unknownItemId = generateUuidV7();
    const unknownItem = asRejected(
      (
        await pushV2(deviceId, [
          v2Command("pos_sale", "create", "dchaos-c13-unknown-item", posSalePayload(world, { offline: "OFF-DC13-00002", date: "2026-02-18", item: unknownItemId, unitPrice: "100.000000" })),
        ])
      ).results[0]!,
    );
    expect(foreignItem.reason).toBe("VALIDATION_ERROR");
    expect(unknownItem.reason).toBe("VALIDATION_ERROR");
    const shapeOf = (item: Extract<PushItemResultV2, { status: "REJECTED" }>, echoedId: string) => ({
      status: item.status,
      reason: item.reason,
      action: item.action,
      resubmittable: item.resubmittable,
      localized: item.localized,
      message: item.message.replace(echoedId, "<id>"),
    });
    expect(shapeOf(foreignItem, foreignItemId)).toEqual(shapeOf(unknownItem, unknownItemId));

    // (b) A foreign PARTNER as the sale's customer: same shape vs unknown.
    const foreignCustomerSale = (customerId: string) => ({
      sale: {
        clientId: generateUuidV7(),
        terminalId: world.terminalId,
        offlineReceiptNo: "OFF-DC13-00003",
        invoiceDate: "2026-02-18",
        customerId,
        orderType: "COUNTER" as const,
        checkId: null,
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        tenders: [{ method: "CASH" as const, amount: "115.0000" }],
      },
    });
    const unknownPartnerId = generateUuidV7();
    const foreignPartner = asRejected(
      (await pushV2(deviceId, [v2Command("pos_sale", "create", "dchaos-c13-foreign-partner", foreignCustomerSale(foreignPartnerId))])).results[0]!,
    );
    const unknownPartner = asRejected(
      (await pushV2(deviceId, [v2Command("pos_sale", "create", "dchaos-c13-unknown-partner", foreignCustomerSale(unknownPartnerId))])).results[0]!,
    );
    expect(foreignPartner.reason).toBe("VALIDATION_ERROR");
    expect(shapeOf(foreignPartner, foreignPartnerId)).toEqual(shapeOf(unknownPartner, unknownPartnerId));

    // (c) A foreign INVOICE id on update_draft (captured on the desktop
    // FILE, cycled): same shape vs unknown.
    const updateOf = (invoiceId: string) =>
      v2Command(
        "sales_invoice",
        "update_draft",
        `dchaos-c13-inv-${invoiceId}`,
        {
          invoiceId,
          customerId: world.customerId,
          orderDate: "2026-03-01",
          lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        },
        { baseVersion: 1 },
      );
    const foreignInvoiceId = generateUuidV7();
    const unknownInvoiceId = generateUuidV7();
    const foreignInvoice = asRejected((await pushV2(deviceId, [updateOf(foreignInvoiceId)])).results[0]!);
    const unknownInvoice = asRejected((await pushV2(deviceId, [updateOf(unknownInvoiceId)])).results[0]!);
    expect(foreignInvoice.reason).toBe("VALIDATION_ERROR");
    expect(shapeOf(foreignInvoice, foreignInvoiceId)).toEqual(shapeOf(unknownInvoice, unknownInvoiceId));

    // Zero effects anywhere: tenant A's ledger untouched, tenant B's rows
    // byte-identical.
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
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
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-14 suspension mid-session: pushes TENANT_SUSPENDED per-item; restore → the desktop device resumes from its parked FILE cursor, no duplicates, the pending command EXECUTES", async () => {
    const seed = 0xd0e;
    console.log(`[C-14/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);

    // Pre-suspension: one accepted command (its inbox row is the no-double-
    // post proof for the resume) + the device's cursor parked mid-feed.
    const acceptedCommand = v2Command("pos_sale", "create", "dchaos-c14-accepted", posSalePayload(world, { offline: "OFF-DC14-00001", date: "2026-02-19" }));
    const accepted = asAccepted((await pushV2(deviceId, [acceptedCommand])).results[0]!);
    expect(accepted.status).toBe("ACCEPTED");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    await reference.client.pullAll();
    const parkedCursor = readCursor(reference.adapter, "items");

    // The command captured (queued in the FILE) when suspension hits.
    const pending = saleDraft("OFF-DC14-00002", "2026-02-19");
    reference.captureSale(pending, "115.0000");

    const su = await superuserClient();
    await su.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [TENANT_CHAOS]);
    await su.end();
    try {
      const inboxBefore = await countInbox(TENANT_CHAOS, deviceId);
      const gated = asRejected(
        (await pushV2(deviceId, [v2Command("pos_sale", "create", "dchaos-c14-direct", posSalePayload(world, { offline: "OFF-DC14-00003", date: "2026-02-19" }))])).results[0]!,
      );
      expect(gated).toMatchObject({
        status: "REJECTED",
        reason: "TENANT_SUSPENDED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect(gated.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
      expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
      expect(await countInbox(TENANT_CHAOS, deviceId)).toBe(inboxBefore); // not poisoned

      const status = await transport.status();
      expect(status.suspended).toBe(true);
    } finally {
      const restore = await superuserClient();
      await restore.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [TENANT_CHAOS]);
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
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);

    // The FILE-queued pending command drains on the next cycle: ACCEPTED,
    // not a duplicate.
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.duplicates).toBe(0);
    expect(outboxRowOf(dd.store, pending.clientId).status).toBe("ACKED");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 2);
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-15 tampered payloads: the captured FILE rows are tampered post-capture (negative qty, price/tender mismatch, zero price) → typed rejects, no partial ledger", async () => {
    const seed = 0xd0f;
    console.log(`[C-15/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);
    const linesBefore = await countJournalLines(TENANT_CHAOS);
    const movesBefore = await countStockMoves(TENANT_CHAOS);

    // Capture three healthy sales, then tamper the PAYLOAD column of each
    // outbox row in the file (the compromised-client premise: the local
    // row is mutated after capture — the server re-validates everything).
    const drafts = [
      saleDraft("OFF-DC15-00001", "2026-02-20"),
      saleDraft("OFF-DC15-00002", "2026-02-20"),
      saleDraft("OFF-DC15-00003", "2026-02-20"),
    ];
    for (const draft of drafts) {
      reference.captureSale(draft, draft.tenders[0]!.amount);
    }
    const tamperPayload = (clientId: string, mutate: (payload: Record<string, unknown>) => void): void => {
      const payload = JSON.parse(String(outboxRowOf(dd.store, clientId).payload)) as Record<string, unknown>;
      mutate(payload);
      dd.store.run("UPDATE outbox SET payload = ? WHERE command_id = ?", [JSON.stringify(payload), clientId]);
    };
    // (a) negative qty.
    tamperPayload(drafts[0]!.clientId, (payload) => {
      ((payload.sale as { lines: { qty: string }[] }).lines[0]!).qty = "-1";
    });
    // (b) price tamper: unit price 80 while the tenders still carry 115.
    tamperPayload(drafts[1]!.clientId, (payload) => {
      ((payload.sale as { lines: { unitPrice: string }[] }).lines[0]!).unitPrice = "80.000000";
      ((payload.sale as { tenders: { amount: string }[] }).tenders[0]!).amount = "115.0000";
    });
    // (c) zero price with a positive tender.
    tamperPayload(drafts[2]!.clientId, (payload) => {
      ((payload.sale as { lines: { unitPrice: string }[] }).lines[0]!).unitPrice = "0.000000";
      ((payload.sale as { tenders: { amount: string }[] }).tenders[0]!).amount = "0.0001";
    });

    const outcome = await reference.cycle();
    expect(outcome.pushed).toBe(3);
    expect(outcome.accepted).toBe(0);
    expect(outcome.rejected).toBe(3);

    // Typed rejects in the FILE: negative-qty + tender-mismatch +
    // zero-price are all VALIDATION_ERROR (resubmittable — fix & resend).
    const reasons = drafts.map((draft) => outboxRowOf(dd.store, draft.clientId));
    for (const row of reasons) {
      expect(row.status).toBe("REJECTED");
      expect(row.rejection_reason).toBe("VALIDATION_ERROR");
      expect(JSON.parse(String(row.last_error))).toMatchObject({ resubmittable: true });
    }
    const tenderMessage = JSON.parse(String(reasons[1]!.last_error)) as { message: string };
    expect(tenderMessage.message).toMatch(/tender/i);
    // The pos_sales rows never left the honest pre-sync state's reject arm.
    for (const draft of drafts) {
      expect(dd.store.get("SELECT * FROM pos_sales WHERE id = ?", [draft.clientId])).toMatchObject({
        local_status: "REJECTED",
        official_no: null,
      });
    }

    // No partial ledger: the oracles hold and nothing moved.
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore);
    expect(await countJournalLines(TENANT_CHAOS)).toBe(linesBefore);
    expect(await countStockMoves(TENANT_CHAOS)).toBe(movesBefore);
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("C-16 storage-full at capture on the FILE: loud typed failure while armed, the queue persists on disk, drains after recovery", async () => {
    const seed = 0xd10;
    console.log(`[C-16/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId, push: services.push });

    // The quota wrapper (C-16): while armed, every write TRANSACTION on
    // the real file store refuses to start (a full disk never accepts a
    // capture — no silent drop, no half-write); reads + everything else
    // delegate to the REAL store.
    let quotaArmed = false;
    const dd = desktopDevice({
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
    const reference = dd.device;

    const draftOf = (offline: string) => saleDraft(offline, "2026-02-21");

    // Two healthy captures, then the disk fills mid-shift.
    reference.captureSale(draftOf("OFF-DC16-00001"), "115.0000");
    reference.captureSale(draftOf("OFF-DC16-00002"), "115.0000");
    expect(reference.state().queue.pending).toBe(2);

    quotaArmed = true;
    expect(() => reference.captureSale(draftOf("OFF-DC16-00003"), "115.0000")).toThrow(
      /quota exceeded/,
    ); // LOUD — never a silent drop

    // The queue persisted in the FILE: both previous entries intact (the
    // outbox is the source of truth for pending operations — never
    // pruned by the fault; reads are not gated, only write transactions).
    expect(dd.store.all("SELECT * FROM outbox")).toHaveLength(2);
    expect(dd.store.all("SELECT * FROM outbox WHERE status = 'QUEUED'")).toHaveLength(2);
    expect(dd.store.all("SELECT * FROM pos_sales")).toHaveLength(2);

    // Recovery (space freed): the queue drains per C-09 semantics — both
    // commands accepted, official numbers stamped, ledger oracles exact.
    quotaArmed = false;
    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(2);
    expect(outcome.rejected).toBe(0);
    expect(outcome.pushed).toBe(2);
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 2);
    const state = reference.state();
    expect(state.queue.acked).toBe(2);
    for (const row of state.businessRows.pos_sales ?? []) {
      expect(row.local_status).toBe("SYNCED");
      expect(row.official_no).toMatch(/^POS-/);
    }
    await ledgerOraclesHold(TENANT_CHAOS);
    dd.dispose();
  });

  it("D-06 updater attack postures in the DB-suite context (in-test HTTP manifest server; REAL minisign crypto): unsigned rejected, tampered bundle rejected, downgrade rejected, min-version forces update", async () => {
    const seed = 0xd06;
    console.log(`[D-06/desktop] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER, { deviceClass: "tauri-desktop" });
    const keyPair = generateMinisignKeyPair();
    const goodBundle = Buffer.concat([
      Buffer.from("PHASE-021 D-06 db-suite bundle: "),
      Buffer.alloc(2048, 0x3c),
    ]);

    // (1) UNSIGNED manifest: the signature field is garbage → rejected
    // before any download.
    const unsignedServer = await startUpdaterManifestServer({
      keyPair,
      bundle: goodBundle,
      version: "2.0.0",
      manifestSignature: "not a minisign signature",
    });
    try {
      const unsigned = await runUpdateCheck({
        currentVersion: "1.0.0",
        deviceId,
        channel: "stable",
        trustedPublicKeys: [keyPair.publicKeyFile],
        ports: unsignedServer.ports,
      });
      expect(unsigned.state).toBe("rejected");
      expect(unsigned.reason).toMatch(/manifest signature rejected/);
      expect(unsignedServer.bundleDownloads).toHaveLength(0); // nothing downloaded
    } finally {
      unsignedServer.close();
    }

    // (2) TAMPERED bundle: the manifest signature binds the trusted key
    // over the ORIGINAL bundle bytes, but the server serves flipped bytes
    // → rejected at bundle verification (REAL Ed25519 mismatch).
    const tamperedBundle = Buffer.from(goodBundle);
    const flipIndex = tamperedBundle.length - 1; // noUncheckedIndexedAccess-safe flip
    tamperedBundle[flipIndex] = (tamperedBundle[flipIndex] ?? 0) ^ 0xff;
    const tamperedServer = await startUpdaterManifestServer({
      keyPair,
      bundle: goodBundle, // the signature covers THESE bytes
      servedBundle: tamperedBundle, // …but the download serves these
      version: "2.0.0",
    });
    try {
      const tampered = await runUpdateCheck({
        currentVersion: "1.0.0",
        deviceId,
        channel: "stable",
        trustedPublicKeys: [keyPair.publicKeyFile],
        ports: tamperedServer.ports,
      });
      expect(tampered.state).toBe("rejected");
      expect(tampered.reason).toMatch(/bundle signature verification failed/);
      expect(tamperedServer.installs).toHaveLength(0); // never installed
    } finally {
      tamperedServer.close();
    }

    // (3) DOWNGRADE: the offered version is older than the running build.
    const downgradeServer = await startUpdaterManifestServer({
      keyPair,
      bundle: goodBundle,
      version: "0.9.0",
    });
    try {
      const downgrade = await runUpdateCheck({
        currentVersion: "1.0.0",
        deviceId,
        channel: "stable",
        trustedPublicKeys: [keyPair.publicKeyFile],
        ports: downgradeServer.ports,
      });
      expect(downgrade.state).toBe("rejected");
      expect(downgrade.reason).toMatch(/downgrade rejected/);
      expect(downgradeServer.bundleDownloads).toHaveLength(0);
    } finally {
      downgradeServer.close();
    }

    // (4) MIN-VERSION forces the update: current below the manifest
    // minimum → blocked-min-version + forceUpdate (DR-P21-05).
    const minVersionServer = await startUpdaterManifestServer({
      keyPair,
      bundle: goodBundle,
      version: "2.0.0",
      minVersion: "1.5.0",
    });
    try {
      const forced = await runUpdateCheck({
        currentVersion: "1.0.0",
        deviceId,
        channel: "stable",
        trustedPublicKeys: [keyPair.publicKeyFile],
        ports: minVersionServer.ports,
      });
      expect(forced.state).toBe("blocked-min-version");
      expect(forced.forceUpdate).toBe(true);
      expect(forced.reason).toMatch(/below manifest minimum/);
      expect(minVersionServer.installs).toHaveLength(0); // the screen drives the install, not the check
    } finally {
      minVersionServer.close();
    }
  });
});

/** Assert the reopened file still holds the IN_FLIGHT row (the C-04
 * simulated-crash reboot: the crash preserved the un-acked state). */
function assertRebootState(rebooted: { store: DesktopStore }, commandId: string): void {
  const row = rebooted.store.get("SELECT status FROM outbox WHERE command_id = ?", [commandId]);
  expect(row).toMatchObject({ status: "IN_FLIGHT" });
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

/**
 * The in-test HTTP manifest server (the D-06/C-08 scripted update channel):
 * serves the signed manifest at `/stable/latest.json` + the bundle bytes at
 * the manifest's bundle path, with REAL minisign signatures over REAL
 * bytes. The ports fetch over a real HTTP socket; the manifest's bundle URL
 * keeps the https form (the client's URL policy), which the port maps onto
 * the local server — the bridge-http seam in the shell does the same
 * routing; the minisign verification on the fetched bytes is the security
 * boundary and runs for real.
 */
interface UpdaterServer {
  readonly ports: {
    fetchManifest(channel: string): Promise<unknown>;
    fetchBundle(url: string): Promise<Buffer>;
    install(bundle: Buffer, manifest: { version: string }): Promise<void>;
  };
  readonly bundleDownloads: number[];
  /** The applied versions (install-port invocations). */
  readonly installs: string[];
  close(): Promise<void>;
}

async function startUpdaterManifestServer(options: {
  keyPair: ReturnType<typeof generateMinisignKeyPair>;
  bundle: Buffer;
  version: string;
  minVersion?: string;
  /** Overrides the platform signature (the unsigned-manifest attack). */
  manifestSignature?: string;
  /** Overrides the SERVED bundle bytes (the tampered-bundle attack: the
   * signature stays over `bundle`, the download serves these). */
  servedBundle?: Buffer;
  installHook?: (manifest: { version: string }) => void;
}): Promise<UpdaterServer> {
  const bundlePath = `/stable/${options.version}/erp-setup.exe`;
  // The Tauri bundle-mode manifest: the platform signature signs the
  // BUNDLE bytes (the stock shell-updater shape — client.ts Ed25519-
  // verifies the downloaded bundle against exactly this signature). The
  // manifest-mode signature path is covered by the 1-c updater suite; the
  // db-suite postures below ride the bundle-mode shape the shell serves.
  const signature = options.manifestSignature ?? options.keyPair.sign(options.bundle);
  const manifest = {
    version: options.version,
    pub_date: "2026-11-05T10:00:00Z",
    platforms: {
      "windows-x86_64": {
        signature,
        url: `https://updates.erp.example${bundlePath}`,
      },
    },
    ...(options.minVersion !== undefined ? { minVersion: options.minVersion } : {}),
    rollout: { stagePercent: 100 },
    notes: "PHASE-021 desktop chaos signed update",
  };
  const manifestJson = JSON.stringify(manifest);

  const bundleDownloads: number[] = [];
  const installs: string[] = [];
  const server = http.createServer((request, response) => {
    const url = request.url ?? "";
    if (url === "/stable/latest.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(manifestJson);
      return;
    }
    if (url === bundlePath) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(options.servedBundle ?? options.bundle);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end(`no such update artifact: ${url}`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  return {
    ports: {
      fetchManifest: async (channel: string) => {
        const response = await fetch(`${base}/${channel}/latest.json`);
        if (!response.ok) throw new Error(`manifest fetch failed: ${response.status}`);
        return (await response.json()) as unknown;
      },
      fetchBundle: async (url: string) => {
        // The bridge-http seam: the manifest's https URL routes onto the
        // in-test server by path (the URL policy was enforced on the
        // manifest field; the signature check on these bytes is the
        // security boundary).
        const path = url.replace(/^https:\/\/[^/]+/, "");
        const response = await fetch(`${base}${path}`);
        if (!response.ok) throw new Error(`bundle download failed: ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        bundleDownloads.push(bytes.length);
        return bytes;
      },
      install: async (_bundle: Buffer, installed: { version: string }) => {
        installs.push(installed.version);
        options.installHook?.(installed);
      },
    },
    bundleDownloads,
    installs,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error)))),
  };
}
