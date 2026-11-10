import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

import { superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";

import {
  countInbox,
  countInvoices,
  countJournals,
  countStockMoves,
  enrollDevice,
  ledgerOraclesHold,
  makeSyncServices,
  posSalePayload,
  seedPosWorld,
  v2Command,
  type PosWorld,
} from "./_oracle";

/**
 * PHASE-020 T-P20-3b · duplicate/idempotency depth (MASTER-PLAN §14
 * companion suite; IDEMPOTENCY_AND_RETRIES; SYNC_PROTOCOL §4 + §11): the
 * inbox dedupe (C-01's depth), the within-batch replay, the cross-batch
 * replay, and the LAST-LAYER proof — after the 30-day inbox retention
 * window purges the inbox row, a restored outbox's duplicate delivery
 * still cannot double-post (the pos_sale service's own (terminal, OFF-)
 * posting-key check; INV-013 is the net).
 *
 * Dedicated tenant 25252525 (verified unused): the suite owns it end to
 * end. Each test enrolls its OWN device (fresh token bucket — the push
 * rate limiter never colors the dedupe assertions).
 */

const TENANT_DUPLICATES = "25252525-2525-2525-2525-252525252525";
const DUP_OWNER = "25252525-0000-4000-8000-000000002501";
const DUP_CASHIER = "25252525-0000-4000-8000-000000002502";

const services = makeSyncServices();
let world: PosWorld;

function asAccepted(item: PushItemResultV2): Extract<PushItemResultV2, { status: "ACCEPTED" }> {
  if (item.status !== "ACCEPTED") {
    throw new Error(`expected an ACCEPTED item, got ${item.status}: ${JSON.stringify(item)}`);
  }
  return item;
}

async function pushV2(deviceId: string, commands: unknown[]) {
  return withTenant(TENANT_DUPLICATES, () =>
    services.push.push({
      deviceId,
      batchId: generateUuidV7(),
      commands,
      contractVersion: SYNC_CONTRACT_VERSION,
    }),
  );
}

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_DUPLICATES,
    name: "Tenant Duplicates (P20 3b)",
    nameAr: "مستأجر التكرار",
    prefix: "DUP",
    actor: DUP_OWNER,
    cashier: DUP_CASHIER,
    salesRep: DUP_OWNER,
  });
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-020 duplicates + idempotency depth (SYNC_PROTOCOL §4/§11; INV-013)", () => {
  it("2× immediate duplicate: the same batch re-sent back-to-back → byte-equal replay, one ledger effect set", async () => {
    const device = await enrollDevice(TENANT_DUPLICATES, DUP_CASHIER);
    const command = v2Command(
      "pos_sale",
      "create",
      "dup-immediate-1",
      posSalePayload(world, { offline: "OFF-DUP-10001", date: "2026-02-10" }),
    );
    const invoicesBefore = await countInvoices(TENANT_DUPLICATES);
    const journalsBefore = await countJournals(TENANT_DUPLICATES);

    const first = asAccepted((await pushV2(device, [command])).results[0]!);
    expect(first).not.toHaveProperty("duplicate");

    // The immediate retry (the classic double-tap / socket recycle).
    const second = (await pushV2(device, [command])).results[0]!;
    expect(second.status).toBe("ACCEPTED");
    expect(second.duplicate).toBe(true);
    const { duplicate: _dropped, ...rest } = second;
    void _dropped;
    expect(rest).toEqual(first);

    expect(await countInvoices(TENANT_DUPLICATES)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_DUPLICATES)).toBe(journalsBefore + 2);
    await ledgerOraclesHold(TENANT_DUPLICATES);
  });

  it("10× the same idempotencyKey: one execution, nine byte-equal replays, one journal pair", async () => {
    const device = await enrollDevice(TENANT_DUPLICATES, DUP_CASHIER);
    const command = v2Command(
      "pos_sale",
      "create",
      "dup-ten-1",
      posSalePayload(world, { offline: "OFF-DUP-20001", date: "2026-02-10" }),
    );
    const invoicesBefore = await countInvoices(TENANT_DUPLICATES);
    const journalsBefore = await countJournals(TENANT_DUPLICATES);

    const first = asAccepted((await pushV2(device, [command])).results[0]!);
    for (let attempt = 2; attempt <= 10; attempt += 1) {
      const replay = (await pushV2(device, [command])).results[0]!;
      expect(replay.status).toBe("ACCEPTED");
      expect(replay.duplicate).toBe(true);
      const { duplicate: _dropped, ...rest } = replay;
      void _dropped;
      expect(rest).toEqual(first); // every replay byte-equal to the original
    }

    // Exactly-once across all ten deliveries (INV-013 as the net).
    expect(await countInvoices(TENANT_DUPLICATES)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_DUPLICATES)).toBe(journalsBefore + 2);
    expect(await countStockMoves(TENANT_DUPLICATES)).toBeGreaterThanOrEqual(1);
    const invoiceId = first.result.invoiceId as string;
    const journals = await withTenant(TENANT_DUPLICATES, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(*)::int AS n FROM journal_entries
        WHERE source_type = 'sales_invoice' AND source_id = ${invoiceId}::uuid
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(journals).toBe(2); // settlement + COGS, never more
    await ledgerOraclesHold(TENANT_DUPLICATES);
  });

  it("concurrent twin deliveries (sequential in-process — noted): the second replays the first's stored result", async () => {
    // NOTE (limitation, recorded): a TRUE concurrent twin would need two
    // interleaved withTenant transactions racing the handler; the db suite
    // runs sequentially in one process, so the twins are back-to-back
    // sequential pushes — the closest faithful simulation. The server-side
    // race guard (inbox INSERT ... ON CONFLICT DO NOTHING + INV-013 op
    // keys) is the layer a real race would exercise.
    const device = await enrollDevice(TENANT_DUPLICATES, DUP_CASHIER);
    const command = v2Command(
      "pos_sale",
      "create",
      "dup-concurrent-1",
      posSalePayload(world, { offline: "OFF-DUP-30001", date: "2026-02-11" }),
    );
    const invoicesBefore = await countInvoices(TENANT_DUPLICATES);

    const first = asAccepted((await pushV2(device, [command])).results[0]!);
    const twin = asAccepted((await pushV2(device, [command])).results[0]!);
    expect(twin.duplicate).toBe(true);
    expect((twin.result as { invoiceId: string }).invoiceId).toBe(first.result.invoiceId);
    expect(await countInvoices(TENANT_DUPLICATES)).toBe(invoicesBefore + 1);
    await ledgerOraclesHold(TENANT_DUPLICATES);
  });

  it("cross-batch duplicate: the key first seen in batch 1 replays inside batch 5 → duplicate:true, no re-execution", async () => {
    const device = await enrollDevice(TENANT_DUPLICATES, DUP_CASHIER);
    const invoicesBefore = await countInvoices(TENANT_DUPLICATES);
    const journalsBefore = await countJournals(TENANT_DUPLICATES);

    // Batch 1: the original command.
    const original = v2Command(
      "pos_sale",
      "create",
      "dup-crossbatch-1",
      posSalePayload(world, { offline: "OFF-DUP-40001", date: "2026-02-11" }),
    );
    const first = asAccepted((await pushV2(device, [original])).results[0]!);

    // Batches 2–4: unrelated commands (unique keys — each executes once).
    for (let batch = 2; batch <= 4; batch += 1) {
      const result = asAccepted(
        (
          await pushV2(device, [
            v2Command(
              "pos_sale",
              "create",
              `dup-crossbatch-${batch}`,
              posSalePayload(world, { offline: `OFF-DUP-4000${batch}`, date: "2026-02-11" }),
            ),
          ])
        ).results[0]!,
      );
      expect(result).not.toHaveProperty("duplicate");
    }

    // Batch 5: carries batch 1's command again (a restored outbox tail).
    const batch5 = await pushV2(device, [
      v2Command(
        "pos_sale",
        "create",
        "dup-crossbatch-5",
        posSalePayload(world, { offline: "OFF-DUP-40005", date: "2026-02-11" }),
      ),
      original,
    ]);
    expect(batch5.results.map((item) => item.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
    const replayed = batch5.results[1]!;
    expect(replayed.duplicate).toBe(true);
    const { duplicate: _dropped, ...rest } = replayed;
    void _dropped;
    expect(rest).toEqual(first);

    // 5 unique commands → 5 invoices, 10 journals — the cross-batch replay
    // added nothing.
    expect(await countInvoices(TENANT_DUPLICATES)).toBe(invoicesBefore + 5);
    expect(await countJournals(TENANT_DUPLICATES)).toBe(journalsBefore + 10);
    await ledgerOraclesHold(TENANT_DUPLICATES);
  });

  it("35-day restored outbox: after the inbox retention window purges the row, the posting-key dedupe still blocks the double-post", async () => {
    const device = await enrollDevice(TENANT_DUPLICATES, DUP_CASHIER);
    const command = v2Command(
      "pos_sale",
      "create",
      "dup-restored-1",
      posSalePayload(world, { offline: "OFF-DUP-50001", date: "2026-02-12" }),
    );
    const invoicesBefore = await countInvoices(TENANT_DUPLICATES);
    const journalsBefore = await countJournals(TENANT_DUPLICATES);
    const movesBefore = await countStockMoves(TENANT_DUPLICATES);

    const first = asAccepted((await pushV2(device, [command])).results[0]!);
    const invoiceId = first.result.invoiceId as string;
    const officialNo = first.result.officialNo as string;
    expect(await countInvoices(TENANT_DUPLICATES)).toBe(invoicesBefore + 1);
    expect(await countInbox(TENANT_DUPLICATES, device)).toBe(1);

    // The device is restored from a 35-day-old backup: its outbox still
    // holds the command, but the server's inbox retention window (30d,
    // MASTER-PLAN §11 sync.inbox.retention) has aged the row out. The job
    // runs as the privileged maintenance role (erp_app holds no
    // UPDATE/DELETE on inbox_commands), so the aging + purge ride the
    // superuser handle. First age it past the window (what the job keys
    // on)…
    const su = await superuserClient();
    await su.query(
      `UPDATE inbox_commands SET processed_at = now() - interval '35 days'
        WHERE tenant_id = $1 AND device_id = $2 AND command_id = $3`,
      [TENANT_DUPLICATES, device, (command as { commandId: string }).commandId],
    );
    // …then the retention job's DELETE (the row is gone — the inbox replay
    // path MUST miss now).
    await su.query(
      `DELETE FROM inbox_commands
        WHERE tenant_id = $1 AND device_id = $2 AND command_id = $3`,
      [TENANT_DUPLICATES, device, (command as { commandId: string }).commandId],
    );
    await su.end();
    expect(await countInbox(TENANT_DUPLICATES, device)).toBe(0);

    // The restored outbox re-pushes the SAME command. The inbox misses —
    // and the pos_sale service's OWN posting-key dedupe (the (terminal,
    // OFF- number) pair + the client-id key, the §11 second layer) catches
    // it: replayed result, zero new ledger effects.
    const replay = asAccepted((await pushV2(device, [command])).results[0]!);
    expect(replay.status).toBe("ACCEPTED");
    expect(replay).not.toHaveProperty("duplicate"); // the INBOX missed…
    expect(replay.result).toMatchObject({
      replay: true, // …the SERVICE-level posting-key dedupe caught it
      invoiceId,
      officialNo,
    });

    // INV-013 as the net: no second invoice, no second journal, no second
    // stock move — the duplicate CANNOT double-post even after inbox
    // expiry.
    expect(await countInvoices(TENANT_DUPLICATES)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_DUPLICATES)).toBe(journalsBefore + 2);
    expect(await countStockMoves(TENANT_DUPLICATES)).toBe(movesBefore + 1);
    const perSource = await withTenant(TENANT_DUPLICATES, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(*)::int AS n FROM journal_entries
        WHERE source_type = 'sales_invoice' AND source_id = ${invoiceId}::uuid
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(perSource).toBe(2);
    await ledgerOraclesHold(TENANT_DUPLICATES);
  });
});
