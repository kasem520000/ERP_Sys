import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { freshTradeDeclaration, TENANT_TRADE, TR_ACTOR } from "./fixtures";
import { TransportService } from "../../modules/trade/application/transport-service";
import { TrackingService } from "../../modules/trade/application/tracking-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import {
  BlRecordNotFoundError,
  DeclarationLinkNotFoundError,
  TrackingEventInvalidError,
} from "../../modules/trade/domain/trade-errors";

/**
 * PHASE-051 (W-36 — T-13, 2026-11-25) `trade-tracking.db.spec` — THE
 * SHIPMENT TRACKING FOLD over real PG16 (the plan §4's own arm;
 * acceptance #7's engine arms — the master plan §3 W-36's exit): the
 * milestone events DRIVE the document statuses through the PURE FOLD
 * rendered VERBATIM — the full ladder walked on the anchor B/L, the
 * packing lists under it and the event's own linked declaration; the
 * monotone law at the service floor (a regressing event RECORDS in the
 * append-only log but NEVER regresses a document's status); the
 * multi-rung leap; the idempotent diagonal; the typed refusals (the
 * milestone vocabulary, the unknown B/L, the unknown declaration link
 * — each with ZERO residue).
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»): every
 * arm builds its own B/L (+ its packing lists + its declaration)
 * through the service's own create — a rejection arm never shares
 * mutable rows with another arm.
 */

const audit = new AuditService(new DrizzleAuditStore());
const numbering = new NumberingService(audit);
const transport = new TransportService(audit, numbering);
const tracking = new TrackingService(audit);

// The fixture's substrate boots in the suite's beforeAll (the trade
// fixture's idempotent setup — the declaration helper and the
// transport service share it).
beforeAll(async () => {
  const { setupTradeFixture } = await import("./fixtures");
  await setupTradeFixture();
});

/** A fresh world per arm: its own B/L + two packing lists under it. */
async function freshShipment(): Promise<{ blId: string; blNo: string; plIds: string[] }> {
  const bl = await withTenant(TENANT_TRADE, () =>
    transport.createBl({ docType: "SEA", carrierName: "Fresh World Carrier", actorId: TR_ACTOR }));
  const plIds: string[] = [];
  for (const description of ["Pallets A", "Pallets B"]) {
    const packing = await withTenant(TENANT_TRADE, () =>
      transport.createPackingList({
        billOfLadingId: bl.id,
        lines: [{ description, packages: 10, grossKg: "1050.000", netKg: "1000.000" }],
        actorId: TR_ACTOR,
      }));
    plIds.push(packing.id);
  }
  return { blId: bl.id, blNo: bl.blNo, plIds };
}

async function rawStatuses(blId: string, plIds: readonly string[]): Promise<{
  bl: string;
  packing: string[];
}> {
  const tx = requireTenantContext().tx!;
  const bl = await tx.execute<{ status: string }>(sql`
    SELECT shipment_status AS status FROM bills_of_lading WHERE id = ${blId}`);
  const packing = await tx.execute<{ id: string; status: string }>(sql`
    SELECT id, shipment_status AS status FROM packing_lists
    WHERE id IN (${sql.join(plIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY id`);
  return { bl: bl.rows[0]!.status, packing: packing.rows.map((row) => row.status) };
}

async function eventCount(blId: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM shipment_tracking_events
    WHERE bill_of_lading_id = ${blId}`);
  return rows.rows[0]!.n;
}

async function append(blId: string, milestone: string, eventAt = "2026-11-20T08:00:00Z") {
  return withTenant(TENANT_TRADE, () =>
    tracking.appendEvent({ billOfLadingId: blId, milestone, eventAt, actorId: TR_ACTOR }));
}

describe("PHASE-051 W-36 — THE TRACKING DRIVE (T-13: the fold rendered VERBATIM on the anchor B/L + the packing lists under it + the event's own declaration)", () => {
  it("THE GOLDEN LADDER: BOOKED (the diagonal NOOP on a fresh world) → DEPARTED → ARRIVED → CLEARED → DELIVERED — every rung advances the anchor AND both packing lists; the log carries all five events; the drive's summary names the verdicts", async () => {
    const shipment = await freshShipment();
    // The diagonal on the fresh world: the B/L starts at BOOKED, the
    // BOOKED event re-asserts — the status stays, the event records.
    const booked = await append(shipment.blId, "BOOKED");
    expect(booked.drive.bl.outcome).toBe("NOOP");
    expect(booked.drive.bl.from).toBe("BOOKED");
    expect(booked.drive.bl.to).toBeNull();
    expect(booked.drive.packingLists.every((row) => row.outcome === "NOOP")).toBe(true);
    let statuses = await withTenant(TENANT_TRADE, () => rawStatuses(shipment.blId, shipment.plIds));
    expect(statuses.bl).toBe("BOOKED");
    expect(statuses.packing).toEqual(["BOOKED", "BOOKED"]);

    for (const [milestone, count] of [
      ["DEPARTED", 2],
      ["ARRIVED", 3],
      ["CLEARED", 4],
      ["DELIVERED", 5],
    ] as const) {
      const result = await append(shipment.blId, milestone);
      expect(result.drive.bl.outcome).toBe("ADVANCE");
      expect(result.drive.bl.to).toBe(milestone);
      expect(result.drive.packingLists.every((row) => row.outcome === "ADVANCE" && row.to === milestone)).toBe(true);
      statuses = await withTenant(TENANT_TRADE, () => rawStatuses(shipment.blId, shipment.plIds));
      expect(statuses.bl).toBe(milestone);
      expect(statuses.packing).toEqual([milestone, milestone]);
      expect(await withTenant(TENANT_TRADE, () => eventCount(shipment.blId))).toBe(count);
    }
    // The log reads back in event order (the append-only truth).
    const events = await withTenant(TENANT_TRADE, () =>
      tracking.listEvents({ billOfLadingId: shipment.blId }));
    expect(events.map((row) => row.milestone)).toEqual([
      "BOOKED", "DEPARTED", "ARRIVED", "CLEARED", "DELIVERED",
    ]);
  });

  it("THE MONOTONE LAW AT THE SERVICE: a regressing event RECORDS in the append-only log but NEVER regresses a document's status — the drive's refusal names the ladder", async () => {
    const shipment = await freshShipment();
    await append(shipment.blId, "DEPARTED");
    await append(shipment.blId, "ARRIVED");
    const regressing = await append(shipment.blId, "DEPARTED", "2026-11-22T10:00:00Z");
    // The event records (the carrier's late-arriving fact is the truth).
    expect(regressing.event.milestone).toBe("DEPARTED");
    expect(await withTenant(TENANT_TRADE, () => eventCount(shipment.blId))).toBe(3);
    // The drive refuses — the documents NEVER move backward.
    expect(regressing.drive.bl.outcome).toBe("REFUSED");
    expect(regressing.drive.bl.to).toBeNull();
    expect(regressing.drive.packingLists.every((row) => row.outcome === "REFUSED")).toBe(true);
    const statuses = await withTenant(TENANT_TRADE, () => rawStatuses(shipment.blId, shipment.plIds));
    expect(statuses.bl).toBe("ARRIVED");
    expect(statuses.packing).toEqual(["ARRIVED", "ARRIVED"]);
  });

  it("THE MULTI-RUNG LEAP: a fresh world's DELIVERED event advances the documents directly — the fold does not demand intermediate events", async () => {
    const shipment = await freshShipment();
    const leap = await append(shipment.blId, "DELIVERED");
    expect(leap.drive.bl.outcome).toBe("ADVANCE");
    expect(leap.drive.bl.from).toBe("BOOKED");
    expect(leap.drive.bl.to).toBe("DELIVERED");
    const statuses = await withTenant(TENANT_TRADE, () => rawStatuses(shipment.blId, shipment.plIds));
    expect(statuses.bl).toBe("DELIVERED");
    expect(statuses.packing).toEqual(["DELIVERED", "DELIVERED"]);
  });

  it("THE DECLARATION DRIVE: the event's OWN linked declaration advances with the shipment (the customs leg); earlier events' declarations stay on their own rungs", async () => {
    const shipment = await freshShipment();
    const declarationA = await freshTradeDeclaration("TRK-A");
    const declarationB = await freshTradeDeclaration("TRK-B");
    // The DEPARTED event drives declaration A only.
    const departed = await withTenant(TENANT_TRADE, () =>
      tracking.appendEvent({
        billOfLadingId: shipment.blId,
        milestone: "DEPARTED",
        eventAt: "2026-11-20T09:00:00Z",
        declarationId: declarationA,
        actorId: TR_ACTOR,
      }));
    expect(departed.drive.declaration!.id).toBe(declarationA);
    expect(departed.drive.declaration!.outcome).toBe("ADVANCE");
    expect(departed.drive.declaration!.to).toBe("DEPARTED");
    // The ARRIVED event drives declaration B (its own link).
    const arrived = await withTenant(TENANT_TRADE, () =>
      tracking.appendEvent({
        billOfLadingId: shipment.blId,
        milestone: "ARRIVED",
        eventAt: "2026-11-21T09:00:00Z",
        declarationId: declarationB,
        actorId: TR_ACTOR,
      }));
    expect(arrived.drive.declaration!.id).toBe(declarationB);
    expect(arrived.drive.declaration!.to).toBe("ARRIVED");
    // The raw reads: A stays DEPARTED (its own last drive), B ARRIVED —
    // the 0121 shipment_status column is the fold's own output.
    const rows = await withTenant(TENANT_TRADE, async () => {
      const tx = requireTenantContext().tx!;
      const result = await tx.execute<{ id: string; status: string }>(sql`
        SELECT id, shipment_status AS status FROM customs_declarations
        WHERE id IN (${declarationA}, ${declarationB}) ORDER BY id`);
      return result.rows;
    });
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(declarationA)).toBe("DEPARTED");
    expect(byId.get(declarationB)).toBe("ARRIVED");
  });

  it("THE MILESTONE VOCABULARY'S TYPED REFUSAL: an unknown milestone refuses the whole act — ZERO residue (no event row)", async () => {
    const shipment = await freshShipment();
    const refusal = await withTenant(TENANT_TRADE, () =>
      tracking.appendEvent({ billOfLadingId: shipment.blId, milestone: "SAILING", eventAt: "2026-11-20T08:00:00Z", actorId: TR_ACTOR })
        .catch((error: unknown) => error));
    expect(refusal).toBeInstanceOf(TrackingEventInvalidError);
    expect((refusal as TrackingEventInvalidError).code).toBe("TRACKING_EVENT_INVALID");
    expect((refusal as TrackingEventInvalidError).details!.reason).toContain("carrier ladder");
    expect(await withTenant(TENANT_TRADE, () => eventCount(shipment.blId))).toBe(0);
  });

  it("THE EVENT SHAPES: the malformed eventAt refuses — the typed error, ZERO residue", async () => {
    const shipment = await freshShipment();
    await expect(
      withTenant(TENANT_TRADE, () =>
        tracking.appendEvent({ billOfLadingId: shipment.blId, milestone: "DEPARTED", eventAt: "not-a-date", actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TrackingEventInvalidError);
    expect(await withTenant(TENANT_TRADE, () => eventCount(shipment.blId))).toBe(0);
  });

  it("THE UNKNOWN B/L anchor: the typed 404 shape, ZERO residue", async () => {
    const refusal = await withTenant(TENANT_TRADE, () =>
      tracking.appendEvent({
        billOfLadingId: "9e9e9e9e-9e9e-4999-8999-9e9e9e9e9e9e",
        milestone: "DEPARTED",
        eventAt: "2026-11-20T08:00:00Z",
        actorId: TR_ACTOR,
      }).catch((error: unknown) => error));
    expect(refusal).toBeInstanceOf(BlRecordNotFoundError);
    expect((refusal as BlRecordNotFoundError).code).toBe("BL_RECORD_NOT_FOUND");
  });

  it("THE DECLARATION LINK'S TYPED 404: an unknown declaration refuses the append — ZERO residue (the event never records)", async () => {
    const shipment = await freshShipment();
    const refusal = await withTenant(TENANT_TRADE, () =>
      tracking.appendEvent({
        billOfLadingId: shipment.blId,
        milestone: "CLEARED",
        eventAt: "2026-11-22T08:00:00Z",
        declarationId: "9e9e9e9e-9e9e-4999-8999-9e9e9e9e9e9e",
        actorId: TR_ACTOR,
      }).catch((error: unknown) => error));
    expect(refusal).toBeInstanceOf(DeclarationLinkNotFoundError);
    expect((refusal as DeclarationLinkNotFoundError).code).toBe("DECLARATION_LINK_NOT_FOUND");
    expect((refusal as DeclarationLinkNotFoundError).details!.blId).toBe(shipment.blId);
    expect(await withTenant(TENANT_TRADE, () => eventCount(shipment.blId))).toBe(0);
    // The documents never moved.
    const statuses = await withTenant(TENANT_TRADE, () => rawStatuses(shipment.blId, shipment.plIds));
    expect(statuses.bl).toBe("BOOKED");
  });

  it("THE EVENT-LOG READS: the events filter by the B/L and by the declaration link (the customs leg's own read)", async () => {
    const shipment = await freshShipment();
    const declaration = await freshTradeDeclaration("TRK-C");
    await withTenant(TENANT_TRADE, () =>
      tracking.appendEvent({
        billOfLadingId: shipment.blId,
        milestone: "DEPARTED",
        eventAt: "2026-11-20T09:00:00Z",
        declarationId: declaration,
        actorId: TR_ACTOR,
      }));
    await append(shipment.blId, "ARRIVED", "2026-11-21T09:00:00Z");
    const byBl = await withTenant(TENANT_TRADE, () =>
      tracking.listEvents({ billOfLadingId: shipment.blId }));
    expect(byBl).toHaveLength(2);
    const byDeclaration = await withTenant(TENANT_TRADE, () =>
      tracking.listEvents({ declarationId: declaration }));
    expect(byDeclaration).toHaveLength(1);
    expect(byDeclaration[0]!.milestone).toBe("DEPARTED");
    expect(byDeclaration[0]!.carrierRef === null || typeof byDeclaration[0]!.carrierRef === "string").toBe(true);
  });
});
