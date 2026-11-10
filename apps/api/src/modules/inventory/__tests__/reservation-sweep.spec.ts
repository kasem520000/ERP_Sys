import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReservationService } from "../application/reservation-service";

/**
 * PHASE-015 T9 (`inventory.reservations`) — the reservation-expiry sweep
 * as a unit suite: the per-tenant pass (`sweepExpired`) and the system job
 * (`expireReservations`) orchestration — audited as a SYSTEM action, one
 * UoW per tenant, aggregated counts. The SQL state transition (past-due
 * ACTIVE rows only, MANUAL + SALES_ORDER holders alike) is proven against
 * a real database in `src/__db__/inventory/reservations-sweep.spec.ts`.
 */

const storeMock = vi.hoisted(() => ({
  sweepExpiredReservations: vi.fn<() => Promise<string[]>>(),
}));

const tenantsMock = vi.hoisted(() => ({
  listActiveTenantIds: vi.fn<() => Promise<string[]>>(),
}));

const sweptTenants: string[] = vi.hoisted(() => []);

vi.mock("../infrastructure/inventory.store", () => storeMock);
vi.mock("../../../infra/jobs/system-tenants", () => tenantsMock);
vi.mock("../../../infra/db/tenant-context", () => ({
  withTenant: (tenantId: string, fn: () => Promise<unknown>) => {
    sweptTenants.push(tenantId);
    return fn();
  },
  requireTenantContext: () => {
    throw new Error("unit spec: no ambient tenant context");
  },
}));

function auditSpy() {
  return { record: vi.fn() };
}

beforeEach(() => {
  storeMock.sweepExpiredReservations.mockReset();
  tenantsMock.listActiveTenantIds.mockReset();
  sweptTenants.length = 0;
});

describe("sweepExpired (per-tenant pass)", () => {
  it("audits the flip batch anchored on the first flipped row", async () => {
    const audit = auditSpy();
    storeMock.sweepExpiredReservations.mockResolvedValue([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    const service = new ReservationService(audit as never);

    const result = await service.sweepExpired(null);

    expect(result).toEqual({ released: 2 });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith({
      action: "inventory.reservations_swept",
      entityType: "stock_reservation",
      entityId: "11111111-1111-4111-8111-111111111111",
      actorId: undefined, // system action — no user drove the pass
      after: {
        released: 2,
        reservationIds: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      },
    });
  });

  it("writes NOTHING when nothing was past due (a clean pool stays clean)", async () => {
    const audit = auditSpy();
    storeMock.sweepExpiredReservations.mockResolvedValue([]);
    const service = new ReservationService(audit as never);

    expect(await service.sweepExpired(null)).toEqual({ released: 0 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("stamps the requesting actor on the on-demand endpoint path", async () => {
    const audit = auditSpy();
    storeMock.sweepExpiredReservations.mockResolvedValue(["33333333-3333-4333-8333-333333333333"]);
    const service = new ReservationService(audit as never);

    await service.sweepExpired("44444444-4444-4444-8444-444444444444");

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "44444444-4444-4444-8444-444444444444" }),
    );
  });
});

describe("expireReservations (the system job)", () => {
  it("sweeps every ACTIVE tenant in its own UoW and aggregates the counts", async () => {
    const audit = auditSpy();
    tenantsMock.listActiveTenantIds.mockResolvedValue([
      "aaaaaaaa-0000-4000-8000-0000000000t1",
      "aaaaaaaa-0000-4000-8000-0000000000t2",
      "aaaaaaaa-0000-4000-8000-0000000000t3",
    ]);
    storeMock.sweepExpiredReservations
      .mockResolvedValueOnce([
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ])
      .mockResolvedValueOnce([]) // a clean tenant
      .mockResolvedValueOnce(["33333333-3333-4333-8333-333333333333"]);
    const service = new ReservationService(audit as never);

    const result = await service.expireReservations();

    expect(result).toEqual({ tenants: 3, released: 3 });
    expect(sweptTenants).toEqual([
      "aaaaaaaa-0000-4000-8000-0000000000t1",
      "aaaaaaaa-0000-4000-8000-0000000000t2",
      "aaaaaaaa-0000-4000-8000-0000000000t3",
    ]);
    // One audit per tenant that flipped something; the clean tenant stays silent.
    expect(audit.record).toHaveBeenCalledTimes(2);
    for (const call of audit.record.mock.calls) {
      expect(call[0]).toMatchObject({ action: "inventory.reservations_swept", actorId: undefined });
    }
  });

  it("survives an empty platform (zero ACTIVE tenants) as a no-op", async () => {
    const audit = auditSpy();
    tenantsMock.listActiveTenantIds.mockResolvedValue([]);
    const service = new ReservationService(audit as never);

    expect(await service.expireReservations()).toEqual({ tenants: 0, released: 0 });
    expect(storeMock.sweepExpiredReservations).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
