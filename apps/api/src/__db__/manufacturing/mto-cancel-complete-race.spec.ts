import { beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as invStore from "../../modules/inventory/infrastructure/inventory.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import { SalesOrderService } from "../../modules/sales/application/orders";
import { AtpService } from "../../modules/manufacturing/application/atp-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { SalesDocumentStateError } from "../../modules/sales/domain/sales-errors";
import * as planningStore from "../../modules/manufacturing/infrastructure/planning.store";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  orders,
  stock,
  setupMfgFixture,
  type MfgFixture,
} from "./fixtures";

/**
 * THE CANCEL/COMPLETE RACE (the owner's round-4 proof, made deterministic).
 *
 * The owner's finding (proven on the live DB at 65c3226): the round-3
 * dead-line guard reads the linked order's status with a PLAIN SELECT and
 * only THEN creates the holder — a window. The owner's test paused the
 * completion AFTER the guard read, ran the sales order's cancellation to
 * commit in an independent transaction inside that window, and then let
 * the completion create the reservation: the order ended CANCELLED with
 * an ACTIVE MTO reservation of 10 that nobody can ever settle (no
 * delivery posts for a cancelled order; the cancel's release had already
 * run before the holder existed) — the orphan, again. The round-3 test
 * covered cancel-BEFORE-completion only, never the overlap.
 *
 * THE SERIALIZATION PROTOCOL (the fix this spec pins): the linked sales
 * order's HEADER ROW is the serialization point between the completion
 * and the order's terminations —
 *   - the completion's guard read is a LOCKING read (FOR UPDATE OF the
 *     sales_orders row, held to its UoW's commit): nothing can terminate
 *     the order between the read and the holder's commit;
 *   - cancel/close take the SAME row lock FIRST (a locked header read
 *     before their status check), so every termination serializes against
 *     every completion AND against every other termination;
 *   - the lock order is deadlock-free BY CONSTRUCTION: the completion
 *     acquires item_stock (its receipts) BEFORE the header and never
 *     touches the order's lines/reservations; a termination acquires the
 *     header FIRST and never touches item_stock (its release path updates
 *     reservation rows and line links only); a delivery never locks the
 *     header at all. The wait-for graph around the header row is a star —
 *   whoever holds it can always finish, so no cycle can form.
 *
 * The two legal outcomes of the overlap (the spec accepts EITHER, and
 * ONLY these): the holder is created then SETTLED by the terminating
 * side's release (the cancel/close release loop sees the committed holder
 * after it unblocks), or the holder's creation is PREVENTED (the guard
 * read unblocks on the post-termination state and skips). Never an
 * ACTIVE holder on a dead order.
 *
 * The deterministic harness: vi.spyOn on the guard read (the budgeting
 * spec's module-spy precedent) splits the completion's UoW exactly at
 * the owner's window — AFTER the status read, BEFORE the holder
 * creation — and observes, from fresh committed reads, which world the
 * termination is in:
 *   - "slipped": the termination COMMITTED inside the window (the
 *     pre-fix shape — this is the owner's proof; the law assertion below
 *     FAILS there with the orphan);
 *   - "blocked": the termination is WAITING on the sales_orders row lock
 *     the completion's UoW holds (the post-fix shape — the serialization
 *     engaged; pg_locks carries an ungranted lock while nothing else in
 *     the single-fork suite can be waiting).
 */

const specAudit = new AuditService(new DrizzleAuditStore());
const salesOrdersSvc = new SalesOrderService(
  specAudit,
  new NumberingService(specAudit),
  new AtpService(),
);

const spec: { fixture?: MfgFixture; matItem?: string } = {};

let chainSeq = 0;

async function ensureItem(sku: string, name: string): Promise<string> {
  const found = await itemsStore.findItemBySku(sku);
  if (found !== undefined) return found.id;
  const uoms = await itemsStore.listUoms();
  const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
  const created = await itemsStore.insertItem({
    sku,
    name,
    nameAr: null,
    kind: "STOCK",
    uomId: pcs.id,
    categoryId: null,
    taxCodeId: null,
    costingMethod: "WAC",
    trackBatch: true,
    trackSerial: false,
    trackImei: false,
    hasExpiry: true,
    shelfLifeDays: 365,
    reorderLevel: null,
    reorderQty: null,
    basePrice: null,
  });
  return created.id;
}

interface RaceChain {
  /** The MO id (IN_PROGRESS, consumed, one complete() away from done). */
  moId: string;
  salesOrderId: string;
  fgLineId: string;
  fgItem: string;
}

/** A dedicated-FG-item MTO chain parked one complete() away from done:
 * an ISSUED sales order with the FG line, a linked MO released, started,
 * and consumed — everything the race needs, nothing it doesn't. The
 * dedicated item keeps every availability assertion answerable for THIS
 * chain alone (the surplus spec's per-scenario isolation). */
async function buildChain(label: string): Promise<RaceChain> {
  const f = spec.fixture!;
  chainSeq += 1;
  const stamp = `${Date.now() % 100000}-${chainSeq}`;
  return withTenant(TENANT_M, async () => {
    const fgItem = await ensureItem(
      `M-RACE-${label}-${stamp}`,
      `cancel/complete race FG (${label})`,
    );
    const draft = await boms.create({
      itemId: fgItem,
      outputUomId: (await itemsStore.findItemById(fgItem))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "100.0000",
      note: `cancel/complete race BOM (${label})`,
      noteAr: null,
      actorId: M_ACTOR,
      lines: [{ componentItemId: spec.matItem!, qtyPerOutput: "1.000000", scrapPct: "0" }],
    });
    const activeBom = await boms.activate(draft.id, {
      effectiveFrom: "2026-03-01",
      actorId: M_ACTOR,
    });
    await stock.manualReceipt({
      itemId: spec.matItem!,
      warehouseId: f.warehouseRaw,
      qty: "10",
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-03-01",
      batchNo: `M-RACE-${label}-MAT-${stamp}`,
      batchExpiry: "2027-01-01",
      actorId: M_ACTOR,
    });
    const salesOrder = await salesStore.insertSalesOrder({
      branchId: f.branchId,
      customerId: f.customerId,
      salesRepId: null,
      warehouseId: f.warehouseFg,
      quotationId: null,
      orderDate: "2026-03-01",
      expectedDate: "2026-03-20",
      currencyCode: "SAR",
      exchangeRate: null,
      note: `cancel/complete race order (${label})`,
      noteAr: null,
      actorId: null,
      totalNet: "100.0000",
      totalTax: "0.0000",
      totalGross: "100.0000",
      lines: [
        {
          itemId: fgItem,
          description: "race FG line",
          descriptionAr: null,
          qty: "10",
          unitPrice: "10.000000",
          discountAmount: "0.000000",
          taxCodeId: f.taxCodeIds.notSubject,
          netAmount: "100.0000",
          taxAmount: "0.0000",
          note: null,
        },
      ],
    });
    await salesOrdersSvc.submit(salesOrder.id, M_ACTOR);
    await salesOrdersSvc.approve(salesOrder.id, M_ACTOR);
    await salesOrdersSvc.issue(salesOrder.id, M_ACTOR);
    const fgLine = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;
    const order = await orders.create({
      branchId: f.branchId,
      itemId: fgItem,
      bomId: activeBom.id,
      plannedQty: "10",
      plannedDate: "2026-03-18",
      materialsWarehouseId: f.warehouseRaw,
      fgWarehouseId: f.warehouseFg,
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: `cancel/complete race MO (${label})`,
      noteAr: null,
      actorId: M_ACTOR,
    });
    await orders.linkSalesOrder(order.id, { salesOrderLineId: fgLine.id, actorId: M_ACTOR });
    await orders.release(order.id, M_ACTOR);
    await orders.start(order.id, M_ACTOR);
    await orders.consume(order.id, {
      lines: [{ itemId: spec.matItem!, qty: "10" }],
      consumedAt: "2026-03-15",
      note: null,
      noteAr: null,
      actorId: M_ACTOR,
    });
    return { moId: order.id, salesOrderId: salesOrder.id, fgLineId: fgLine.id, fgItem };
  });
}

type Termination = "cancel" | "close";

/** The terminating side, in its OWN UoW on its OWN pooled connection —
 * exactly the independent transaction of the owner's proof. */
function runTermination(kind: Termination, salesOrderId: string): Promise<unknown> {
  return withTenant(TENANT_M, () =>
    kind === "cancel"
      ? salesOrdersSvc.cancel(salesOrderId, "the cancel/complete race probe", M_ACTOR)
      : salesOrdersSvc.close(salesOrderId, M_ACTOR),
  );
}

/** A committed read of the sales order's status (a fresh short UoW). */
async function orderStatus(salesOrderId: string): Promise<string> {
  return withTenant(TENANT_M, async () => {
    const order = await salesStore.findSalesOrderById(salesOrderId);
    expect(order).toBeDefined();
    return order!.status;
  });
}

/** A committed read of the MO's status. */
async function moStatus(moId: string): Promise<string> {
  return withTenant(TENANT_M, async () => {
    const order = await orders.find(moId);
    return order.status;
  });
}

/** Every reservation of the chain's FG item at the FG warehouse. */
async function fgReservations(
  fgItem: string,
  status?: string,
): Promise<invStore.ReservationRow[]> {
  const f = spec.fixture!;
  return withTenant(TENANT_M, async () =>
    (await invStore.listReservations({
      itemId: fgItem,
      warehouseId: f.warehouseFg,
      ...(status === undefined ? {} : { status }),
      limit: 100,
    })) as invStore.ReservationRow[],
  );
}

/** Is ANY lock in the cluster ungranted (someone waiting)? pg_locks is
 * world-readable; in the single-fork sequential suite the only possible
 * waiter during the window is the raced termination. */
async function anyLockWaiter(): Promise<boolean> {
  return withTenant(TENANT_M, async () => {
    const rows = await requireTenantContext().tx!.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_locks WHERE granted = false`,
    );
    return rows.rows[0]!.n > 0;
  });
}

/** The completion audit's MTO evidence (the holder id or the skip). */
async function completionMtoEvidence(
  moId: string,
): Promise<{ mtoReservationId: string | null; mtoSkipReason: string | null }> {
  return withTenant(TENANT_M, async () => {
    const rows = await requireTenantContext().tx!.execute<{
      mtoReservationId: string | null;
      mtoSkipReason: string | null;
    }>(sql`
      SELECT after->>'mtoReservationId' AS "mtoReservationId",
             after->>'mtoSkipReason' AS "mtoSkipReason"
      FROM audit_events
      WHERE action = 'manufacturing.production_order.completed' AND entity_id = ${moId}
      ORDER BY at DESC
      LIMIT 1
    `);
    const row = rows.rows[0];
    expect(row).toBeDefined();
    return { mtoReservationId: row!.mtoReservationId, mtoSkipReason: row!.mtoSkipReason };
  });
}

interface WindowObservation {
  shape: "slipped" | "blocked";
  /** The sales order's committed status observed inside the window. */
  orderStatusAtObservation: string;
  /** The MO's committed status observed inside the window — IN_PROGRESS
   * proves the completion was still mid-flight (its UoW paused inside
   * the spy, nothing of it committed). */
  moStatusAtObservation: string;
}

/** Watch the termination inside the completion's read→reserve window and
 * classify the world deterministically:
 *   - "slipped" — the termination's effect COMMITTED inside the window
 *     (the pre-fix shape; the owner's proof). The termination promise is
 *     awaited to full settle before the window closes.
 *   - "blocked" — the termination is WAITING on a lock the completion's
 *     UoW holds (the post-fix shape — the serialization engaged). It
 *     stays blocked until the completion commits, after the window. */
async function observeTheWindow(
  termination: Promise<unknown>,
  salesOrderId: string,
  moId: string,
): Promise<WindowObservation> {
  let terminationError: unknown;
  const guarded = termination.catch((error: unknown) => {
    terminationError = error;
    throw error;
  });
  const deadline = Date.now() + 20_000;
  for (;;) {
    const order = await orderStatus(salesOrderId);
    if (order === "CANCELLED" || order === "CLOSED") {
      const mo = await moStatus(moId);
      await guarded; // fully settled inside the window
      return { shape: "slipped", orderStatusAtObservation: order, moStatusAtObservation: mo };
    }
    if (await anyLockWaiter()) {
      return {
        shape: "blocked",
        orderStatusAtObservation: order,
        moStatusAtObservation: await moStatus(moId),
      };
    }
    if (terminationError !== undefined) {
      throw new Error(`the termination failed inside the window: ${String(terminationError)}`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        "harness: the termination neither committed nor blocked within 20s — the window is not the raced one",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The spied guard read's exact shape. */
type GuardSpy = MockInstance<(lineId: string) => Promise<string | undefined>>;

interface OverlapHarness {
  spy: GuardSpy;
  observation: { value?: WindowObservation };
  termination: { promise?: Promise<unknown> };
}

/** Split the completion's UoW at the owner's window: the guard read runs
 * (REAL, inside the completion's transaction), then the termination
 * starts in its own UoW and is observed to a classified shape, and only
 * then does the completion continue toward its holder decision. */
function installOverlapSpy(kind: Termination, chain: RaceChain): OverlapHarness {
  const real = planningStore.findSalesOrderStatusByLine;
  const spy: GuardSpy = vi.spyOn(planningStore, "findSalesOrderStatusByLine");
  const harness: OverlapHarness = { spy, observation: {}, termination: {} };
  spy.mockImplementationOnce(async (lineId: string) => {
    const status = await real(lineId);
    const termination = runTermination(kind, chain.salesOrderId);
    harness.termination.promise = termination;
    harness.observation.value = await observeTheWindow(
      termination,
      chain.salesOrderId,
      chain.moId,
    );
    return status;
  });
  return harness;
}

/** The reverse win: the termination runs to COMMIT while the completion
 * waits BEFORE its guard read — the read then sees the post-termination
 * state (the round-3 dead-line skip, under the race harness). */
function installReverseSpy(kind: Termination, chain: RaceChain): GuardSpy {
  const real = planningStore.findSalesOrderStatusByLine;
  const spy: GuardSpy = vi.spyOn(planningStore, "findSalesOrderStatusByLine");
  spy.mockImplementationOnce(async (lineId: string) => {
    await runTermination(kind, chain.salesOrderId);
    return real(lineId);
  });
  return spy;
}

/** The no-orphan law + the free-stock recovery, shared by every race
 * test: the order terminated, NOTHING ACTIVE survives for the made-to-
 * order stock, and the produced 10 are FREE (availability recovers them
 * — the orphan nets availability forever, the free stock does not). */
async function assertNoOrphan(
  chain: RaceChain,
  expectedStatus: "CANCELLED" | "CLOSED",
): Promise<void> {
  const f = spec.fixture!;
  expect(await orderStatus(chain.salesOrderId)).toBe(expectedStatus);
  const active = await fgReservations(chain.fgItem, "ACTIVE");
  expect(
    active,
    `the orphan check — an ACTIVE holder on a ${expectedStatus} order is the leak (the owner's round-4 proof)`,
  ).toHaveLength(0);
  const availability = await withTenant(TENANT_M, () =>
    invStore.reservationAvailability(chain.fgItem, f.warehouseFg),
  );
  expect(availability!.available).toBe("10.000000");
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.matItem = await ensureItem("M-RACE-MAT", "cancel/complete race material");
  });
});

describe("the cancel/complete race — the serialization protocol between the MTO completion and the sales order's terminations", () => {
  it("THE OVERLAP, cancel (the owner's proof, deterministic): the cancel runs BETWEEN the completion's guard read and its holder creation — either the holder is created then SETTLED by the cancel's release, or its creation is prevented; pre-fix the cancel committed inside the window and the holder leaked ACTIVE on a CANCELLED order", async () => {
    const chain = await buildChain("OVL-CA");
    const harness = installOverlapSpy("cancel", chain);
    let completion: Awaited<ReturnType<typeof orders.complete>> | undefined;
    try {
      completion = await withTenant(TENANT_M, () =>
        orders.complete(chain.moId, {
          actualQty: "10",
          completedAt: "2026-03-16",
          actorId: M_ACTOR,
        }),
      );
    } finally {
      // Never leak a spy, never leak an unhandled termination rejection.
      harness.spy.mockRestore();
      await harness.termination.promise?.catch(() => undefined);
    }
    expect(completion!.order.status).toBe("COMPLETED");

    const observation = harness.observation.value!;
    if (observation.shape === "blocked") {
      // The serialization engaged: the cancel waited on the sales_orders
      // row lock the completion's UoW held; the order was still ISSUED and
      // the MO still IN_PROGRESS at the observation — a real overlap, not
      // a sequential cancel-after-complete.
      expect(observation.orderStatusAtObservation).toBe("ISSUED");
      expect(observation.moStatusAtObservation).toBe("IN_PROGRESS");
    } else {
      // The race REPRODUCED (the pre-fix shape — the owner's window). The
      // MO must have been mid-flight when the cancel committed, proving
      // the overlap; the orphan law below is what fails pre-fix.
      expect(observation.orderStatusAtObservation).toBe("CANCELLED");
      expect(observation.moStatusAtObservation).toBe("IN_PROGRESS");
    }

    // THE LAW (both shapes): no orphan — the holder settled or never was.
    await assertNoOrphan(chain, "CANCELLED");

    if (observation.shape === "blocked") {
      // The created-then-settled arm: the holder WAS created (the
      // completion's audit carries its id) and the cancel's release
      // SETTLED it after the completion committed.
      const evidence = await completionMtoEvidence(chain.moId);
      expect(evidence.mtoSkipReason).toBeNull();
      expect(evidence.mtoReservationId).not.toBeNull();
      const holder = (await fgReservations(chain.fgItem)).find(
        (row) => row.id === evidence.mtoReservationId,
      );
      expect(holder).toBeDefined();
      expect(holder!.status).toBe("RELEASED");
      expect(holder!.qty).toBe("10.000000");
    }
  });

  it("THE OVERLAP, close: the close runs between the guard read and the holder creation — the same serialization, the same no-orphan law; pre-fix the holder leaked ACTIVE on a CLOSED order", async () => {
    const chain = await buildChain("OVL-CL");
    const harness = installOverlapSpy("close", chain);
    let completion: Awaited<ReturnType<typeof orders.complete>> | undefined;
    try {
      completion = await withTenant(TENANT_M, () =>
        orders.complete(chain.moId, {
          actualQty: "10",
          completedAt: "2026-03-16",
          actorId: M_ACTOR,
        }),
      );
    } finally {
      harness.spy.mockRestore();
      await harness.termination.promise?.catch(() => undefined);
    }
    expect(completion!.order.status).toBe("COMPLETED");

    const observation = harness.observation.value!;
    if (observation.shape === "blocked") {
      expect(observation.orderStatusAtObservation).toBe("ISSUED");
      expect(observation.moStatusAtObservation).toBe("IN_PROGRESS");
    } else {
      expect(observation.orderStatusAtObservation).toBe("CLOSED");
      expect(observation.moStatusAtObservation).toBe("IN_PROGRESS");
    }

    await assertNoOrphan(chain, "CLOSED");

    if (observation.shape === "blocked") {
      const evidence = await completionMtoEvidence(chain.moId);
      expect(evidence.mtoSkipReason).toBeNull();
      expect(evidence.mtoReservationId).not.toBeNull();
      const holder = (await fgReservations(chain.fgItem)).find(
        (row) => row.id === evidence.mtoReservationId,
      );
      expect(holder).toBeDefined();
      expect(holder!.status).toBe("RELEASED");
    }
  });

  it("THE REVERSE WIN, cancel: the cancel commits while the completion waits BEFORE its guard read — the holder is never created (LINKED_ORDER_CANCELLED), the stock lands FREE, and the completion itself is never blocked by the dead link", async () => {
    const chain = await buildChain("REV-CA");
    const spy = installReverseSpy("cancel", chain);
    let completion: Awaited<ReturnType<typeof orders.complete>> | undefined;
    try {
      completion = await withTenant(TENANT_M, () =>
        orders.complete(chain.moId, {
          actualQty: "10",
          completedAt: "2026-03-16",
          actorId: M_ACTOR,
        }),
      );
    } finally {
      spy.mockRestore();
    }
    expect(completion!.order.status).toBe("COMPLETED");

    await assertNoOrphan(chain, "CANCELLED");

    // The prevention arm's evidence: the skip, audited, with NO holder.
    const evidence = await completionMtoEvidence(chain.moId);
    expect(evidence.mtoSkipReason).toBe("LINKED_ORDER_CANCELLED");
    expect(evidence.mtoReservationId).toBeNull();
    expect(await fgReservations(chain.fgItem)).toHaveLength(0);
  });

  it("THE REVERSE WIN, close: the close commits before the completion's guard read — LINKED_ORDER_CLOSED, no holder, free stock", async () => {
    const chain = await buildChain("REV-CL");
    const spy = installReverseSpy("close", chain);
    let completion: Awaited<ReturnType<typeof orders.complete>> | undefined;
    try {
      completion = await withTenant(TENANT_M, () =>
        orders.complete(chain.moId, {
          actualQty: "10",
          completedAt: "2026-03-16",
          actorId: M_ACTOR,
        }),
      );
    } finally {
      spy.mockRestore();
    }
    expect(completion!.order.status).toBe("COMPLETED");

    await assertNoOrphan(chain, "CLOSED");

    const evidence = await completionMtoEvidence(chain.moId);
    expect(evidence.mtoSkipReason).toBe("LINKED_ORDER_CLOSED");
    expect(evidence.mtoReservationId).toBeNull();
    expect(await fgReservations(chain.fgItem)).toHaveLength(0);
  });

  it("THE PROTOCOL SMOKE (lock order + deadlock): completion, cancel, AND close all in flight together — no deadlock, exactly ONE termination effect, the loser the typed state error, the completion always finishes, never an orphan", async () => {
    const chain = await buildChain("SMOKE");
    const settled = await Promise.allSettled([
      withTenant(TENANT_M, () =>
        orders.complete(chain.moId, {
          actualQty: "10",
          completedAt: "2026-03-16",
          actorId: M_ACTOR,
        }),
      ),
      withTenant(TENANT_M, () =>
        salesOrdersSvc.cancel(chain.salesOrderId, "the three-way race probe", M_ACTOR),
      ),
      withTenant(TENANT_M, () => salesOrdersSvc.close(chain.salesOrderId, M_ACTOR)),
    ]);

    // The completion is never blocked by the dead link (the round-3 law)
    // and never deadlocks (a 40P01 would surface here as a rejection).
    expect(settled[0]!.status).toBe("fulfilled");

    // Exactly ONE termination effect: the locked header read serializes
    // cancel/close — the winner terminates, the loser sees the winner's
    // terminal status and fails with the typed state error (pre-fix both
    // could fulfill, the second status overwriting the first).
    const terminations = [settled[1]!, settled[2]!];
    const fulfilled = terminations.filter((s) => s.status === "fulfilled");
    const rejected = terminations.filter((s) => s.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { status: "rejected"; reason: unknown }).reason).toBeInstanceOf(
      SalesDocumentStateError,
    );

    const finalStatus = await orderStatus(chain.salesOrderId);
    expect(["CANCELLED", "CLOSED"]).toContain(finalStatus);
    await assertNoOrphan(chain, finalStatus as "CANCELLED" | "CLOSED");
  });
});
