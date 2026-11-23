import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import * as qualityStore from "../../modules/quality/infrastructure/quality.store";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  TENANT_QUALITY_RLS,
  freshQualityHoldWorld,
  recalls,
  setupQualityFixture,
} from "./fixtures";

/**
 * PHASE-050 (W-28 — T-14) THE RECALL SPEC (the plan §4's own arm: "the
 * drill + the OA-06 budget" — the budget's EXPLAIN arm is W-31's; this
 * spec proves the drill and the record): D-14's own division — the drill
 * QUERY (the live read: the genealogy walk consumed VERBATIM + the
 * customer fold) is distinct from the drill RECORD (the registry ladder
 * with the FROZEN snapshots landing at the execute act). The drill
 * resolves a batch to its where-used chain and the customers who
 * received it — a recall drill becomes a query, not a fire drill.
 */
describe("quality recall — the drill + the record (Q-09/Q-12)", () => {
  beforeAll(async () => {
    await setupQualityFixture();
    await (await import("./fixtures")).ensureQualityPostingWorld();
  });

  async function customerQl(): Promise<string> {
    const su = await superuserClient();
    const rows = await su.query<{ id: string }>(
      `SELECT id FROM partners WHERE tenant_id = $1 AND code = 'QL-CUST' LIMIT 1`,
      [TENANT_QUALITY],
    );
    await su.end();
    return rows.rows[0]!.id;
  }

  async function branchQl(): Promise<string> {
    const su = await superuserClient();
    const rows = await su.query<{ id: string }>(
      `SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1`,
      [TENANT_QUALITY],
    );
    await su.end();
    return rows.rows[0]!.id;
  }

  it("THE DRILL QUERY: batch → where-used → customers (a shipped batch resolves to its customer; nothing shipped resolves to the honest empty scope)", async () => {
    const { deliveries } = await import("./fixtures");
    const world = await freshQualityHoldWorld("DRILL");
    const customer = await customerQl();
    // Ship part of the batch through the REAL delivery path (the genealogy
    // walk's own sales-edge source).
    const note = await withTenant(TENANT_QUALITY, async () =>
      deliveries.create({
        branchId: await branchQl(),
        customerId: customer,
        salesRepId: null,
        orderId: null,
        warehouseId: world.warehouseId,
        deliveryDate: "2026-11-23",
        currencyCode: "SAR",
        note: "the drill's shipped delivery",
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: world.itemId,
            qty: "10",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: world.batchId,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_QUALITY, () => deliveries.post(note.id, QL_ACTOR));

    const drill = await withTenant(TENANT_QUALITY, () => recalls.drill(world.batchId));
    expect(drill.batch.batchId).toBe(world.batchId);
    expect(drill.whereUsed.sales).toHaveLength(1);
    expect(drill.whereUsed.sales[0]!.docType).toBe("delivery_note");
    expect(drill.whereUsed.sales[0]!.docId).toBe(note.id);
    expect(drill.whereUsed.sales[0]!.qty).toBe("10.000000");
    expect(drill.customers).toHaveLength(1);
    expect(drill.customers[0]!.customerId).toBe(customer);
    expect(drill.customers[0]!.documents).toHaveLength(1);
    expect(drill.customers[0]!.documents[0]!.docId).toBe(note.id);

    // The honest empty scope: a batch nothing left on.
    const emptyWorld = await freshQualityHoldWorld("DRLE");
    const emptyDrill = await withTenant(TENANT_QUALITY, () =>
      recalls.drill(emptyWorld.batchId),
    );
    expect(emptyDrill.whereUsed.sales).toHaveLength(0);
    expect(emptyDrill.customers).toHaveLength(0);

    // The unknown batch is the typed input floor.
    await expect(
      withTenant(TENANT_QUALITY, () =>
        recalls.drill("00000000-0000-4000-8000-000000000000"),
      ),
    ).rejects.toMatchObject({ code: "QUALITY_INPUT_INVALID" });
  });

  it("THE RECORD: initiate → execute (the FROZEN snapshots) → close — the ladder through the REAL CAS; a later stock move never moves a stored snapshot", async () => {
    const { deliveries } = await import("./fixtures");
    const world = await freshQualityHoldWorld("REC");
    const customer = await customerQl();
    const note = await withTenant(TENANT_QUALITY, async () =>
      deliveries.create({
        branchId: await branchQl(),
        customerId: customer,
        salesRepId: null,
        orderId: null,
        warehouseId: world.warehouseId,
        deliveryDate: "2026-11-23",
        currencyCode: "SAR",
        note: " the record's shipped delivery",
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: world.itemId,
            qty: "7",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: world.batchId,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_QUALITY, () => deliveries.post(note.id, QL_ACTOR));

    const record = await withTenant(TENANT_QUALITY, () =>
      recalls.initiate({
        batchId: world.batchId,
        reason: "foreign matter contamination reported by a customer",
        actorId: QL_ACTOR,
      }),
    );
    expect(record.status).toBe("INITIATED");
    expect(record.recallNo).toMatch(/^REC-\d{4}-\d{6}$/);
    expect(record.scope).toBeNull();
    expect(record.affectedCustomers).toBeNull();

    // The close-before-execute is the typed refusal (the frozen snapshots
    // are the executed paths' own record).
    await expect(
      withTenant(TENANT_QUALITY, () => recalls.close({ recallId: record.id, actorId: QL_ACTOR })),
    ).rejects.toMatchObject({ code: "RECALL_STATE" });

    const executed = await withTenant(TENANT_QUALITY, () =>
      recalls.execute({ recallId: record.id, actorId: QL_ACTOR }),
    );
    expect(executed.status).toBe("EXECUTED");
    expect(executed.executedAt).not.toBeNull();
    // THE SCOPE SNAPSHOT: the kind-tagged where-used array (0116's own
    // jsonb-array law) — one sale entry for the shipped delivery + the
    // frozenAt witness.
    const scope = executed.scope as { kind: string; docId?: string }[];
    expect(scope.filter((entry) => entry.kind === "sale")).toHaveLength(1);
    expect(scope.find((entry) => entry.kind === "sale")!.docId).toBe(note.id);
    expect(scope.find((entry) => entry.kind === "witness")).toBeDefined();
    const frozen = executed.affectedCustomers as { customerId: string }[];
    expect(frozen[0]!.customerId).toBe(customer);

    // THE FROZEN SNAPSHOT LAW: a later delivery never moves the stored
    // scope (the single-use stamp — the executed record is evidence).
    const note2 = await withTenant(TENANT_QUALITY, async () =>
      deliveries.create({
        branchId: await branchQl(),
        customerId: customer,
        salesRepId: null,
        orderId: null,
        warehouseId: world.warehouseId,
        deliveryDate: "2026-11-23",
        currencyCode: "SAR",
        note: "the post-freeze delivery",
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: world.itemId,
            qty: "3",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: world.batchId,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_QUALITY, () => deliveries.post(note2.id, QL_ACTOR));
    const reRead = await withTenant(TENANT_QUALITY, () => recalls.find(record.id));
    expect((reRead.affectedCustomers as { customerId: string }[]).length).toBe(1);
    // And the re-execute is refused (the single-use snapshot stamp).
    await expect(
      withTenant(TENANT_QUALITY, () => recalls.execute({ recallId: record.id, actorId: QL_ACTOR })),
    ).rejects.toMatchObject({ code: "RECALL_STATE" });

    const closed = await withTenant(TENANT_QUALITY, () =>
      recalls.close({ recallId: record.id, actorId: QL_ACTOR }),
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
    // The closed register refuses every move.
    await expect(
      withTenant(TENANT_QUALITY, () => recalls.close({ recallId: record.id, actorId: QL_ACTOR })),
    ).rejects.toMatchObject({ code: "RECALL_STATE" });
  });

  it("THE HELD BATCH'S OWN RECALL: the drill works beside an ACTIVE hold (the record is not the gate — INV-035 blocks issues, never reads)", async () => {
    const { holds } = await import("./fixtures");
    const world = await freshQualityHoldWorld("REC-HOLD");
    await withTenant(TENANT_QUALITY, () =>
      holds.create({ batchId: world.batchId, reason: "hold — the recall-beside arm", actorId: QL_ACTOR }),
    );
    const drill = await withTenant(TENANT_QUALITY, () => recalls.drill(world.batchId));
    expect(drill.batch.batchId).toBe(world.batchId);
    const record = await withTenant(TENANT_QUALITY, () =>
      recalls.initiate({ batchId: world.batchId, reason: "the held batch's own recall", actorId: QL_ACTOR }),
    );
    const executed = await withTenant(TENANT_QUALITY, () =>
      recalls.execute({ recallId: record.id, actorId: QL_ACTOR }),
    );
    expect(executed.status).toBe("EXECUTED");
  });

  it("THE RLS BOUNDARY + the not-found floor: the isolated tenant sees no records; the unknown recall is the typed 404", async () => {
    await expect(
      withTenant(TENANT_QUALITY, () =>
        recalls.find("00000000-0000-4000-8000-000000000000"),
      ),
    ).rejects.toMatchObject({ code: "RECALL_RECORD_NOT_FOUND" });
    const isolated = await withTenant(TENANT_QUALITY_RLS, () =>
      qualityStore.listRecalls({ limit: 10 }),
    );
    expect(isolated).toHaveLength(0);
  });
});
