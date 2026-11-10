import { beforeAll, describe, expect, it } from "vitest";

import {
  IN_ACTOR,
  IN_FOREIGN_FIXTURE_IDS,
  TENANT_IN,
  TENANT_IN_FOREIGN,
  installments,
  plans,
  setupInstallmentsFixture,
  su,
  withTenant,
  type InstallmentsFixture,
} from "./fixtures";

/**
 * PHASE-027 wave G spoof suite (SECURITY_TEST_PLAN §2 — the S-04 row; the
 * notes/fixed-assets spoof precedents): foreign invoice / contract / plan /
 * line ids in installments payloads are rejected with typed 404-shape
 * errors and ZERO partial creation, and every lookup is tenant-scoped so a
 * foreign id is indistinguishable from an unknown one (A7).
 *
 * The foreign world is REAL (an activated plan with live lines inside
 * TENANT_IN_FOREIGN), so the waive / charge-late-fee probes can assert the
 * foreign register never moves.
 */

const UNKNOWN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let fixture: InstallmentsFixture;

beforeAll(async () => {
  fixture = await setupInstallmentsFixture();
});

/** Count rows the attack must NOT have created (superuser, tenant-scoped). */
async function countRows(sql: string, params: unknown[]): Promise<number> {
  const client = await su();
  const result = await client.query<{ n: number }>(sql, params);
  await client.end();
  return result.rows[0]?.n ?? 0;
}

/** Residue surfaces inside the FOREIGN tenant (must stay untouched). */
async function foreignResidue(): Promise<Record<string, number>> {
  const client = await su();
  const count = async (table: string): Promise<number> => {
    const result = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [TENANT_IN_FOREIGN],
    );
    return result.rows[0]?.n ?? 0;
  };
  const snapshot = {
    plans: await count("installment_plans"),
    lines: await count("installment_lines"),
    journals: await count("journal_entries"),
  };
  await client.end();
  return snapshot;
}

describe("S-04 — foreign references in installments payloads → typed rejection, zero partial creation", () => {
  it("a plan over a foreign invoice id is rejected PLAN_SOURCE_INVALID; no plan row survives", async () => {
    const before = await foreignResidue();
    const plansBefore = await countRows(
      `SELECT count(*)::int AS n FROM installment_plans WHERE tenant_id = $1`,
      [TENANT_IN],
    );
    await expect(
      withTenant(TENANT_IN, () =>
        plans.createPlan({
          sourceType: "sales_invoice",
          sourceId: IN_FOREIGN_FIXTURE_IDS.invoice,
          downPayment: "2000.0000",
          count: 4,
          startDate: "2026-07-01",
          frequency: "MONTHLY",
          actorId: IN_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PLAN_SOURCE_INVALID" });
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM installment_plans WHERE tenant_id = $1 AND source_id = $2`,
        [TENANT_IN, IN_FOREIGN_FIXTURE_IDS.invoice],
      ),
    ).toBe(0);
    expect(
      await countRows(`SELECT count(*)::int AS n FROM installment_plans WHERE tenant_id = $1`, [TENANT_IN]),
    ).toBe(plansBefore);
    expect(await foreignResidue()).toEqual(before);
  });

  it("a plan over a foreign contract id is rejected PLAN_SOURCE_INVALID; zero partial creation", async () => {
    const before = await foreignResidue();
    await expect(
      withTenant(TENANT_IN, () =>
        plans.createPlan({
          sourceType: "service_contract",
          sourceId: IN_FOREIGN_FIXTURE_IDS.contract,
          downPayment: "2000.0000",
          count: 4,
          startDate: "2026-07-01",
          frequency: "MONTHLY",
          actorId: IN_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PLAN_SOURCE_INVALID" });
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM installment_plans WHERE tenant_id = $1 AND source_id = $2`,
        [TENANT_IN, IN_FOREIGN_FIXTURE_IDS.contract],
      ),
    ).toBe(0);
    expect(await foreignResidue()).toEqual(before);
  });

  it("waive on a foreign line → LINE_NOT_FOUND; the foreign register never moves", async () => {
    const before = await foreignResidue();
    await expect(
      withTenant(TENANT_IN, () =>
        installments.waiveLine({ lineId: fixture.foreign.lineId, reason: "spoofed waive", actorId: IN_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "LINE_NOT_FOUND" });
    expect(await foreignResidue()).toEqual(before);
  });

  it("charge-late-fee on a foreign line → LINE_NOT_FOUND; zero journals anywhere", async () => {
    const before = await foreignResidue();
    // The foreign line's PRE-ATTACK state: the sweep is tenant-global by
    // design (the production daily job walks every ACTIVE tenant), so other
    // specs' sweeps may legitimately have flipped this line DUE — the spoof
    // invariant is that the ATTACK never moves it, i.e. byte-stability, not
    // any absolute status (found by running the suites together).
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const lineBefore = await withTenant(TENANT_IN_FOREIGN, () => store.findLineById(fixture.foreign.lineId));
    expect(lineBefore).toBeDefined();
    expect(lineBefore!.lateFeeEntryId).toBeNull();
    await expect(
      withTenant(TENANT_IN, () =>
        installments.chargeLateFee({ lineId: fixture.foreign.lineId, actorId: IN_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "LINE_NOT_FOUND" });
    expect(await foreignResidue()).toEqual(before);
    // The foreign line itself is untouched by the attack (still no fee — and
    // the sweep can never charge it either: the fixture plan's policy is the
    // PLACEHOLDER default with auto_charge OFF).
    const line = await withTenant(TENANT_IN_FOREIGN, () => store.findLineById(fixture.foreign.lineId));
    expect(line!.status).toBe(lineBefore!.status);
    expect(line!.collectedAmount).toBe(lineBefore!.collectedAmount);
    expect(line!.lateFeeEntryId).toBeNull();
    expect(line!.lateFeeAmount).toBeNull();
  });

  it("A7 route id-probe parity: unknown-vs-foreign ids render identically (typed 404s)", async () => {
    const unknownPlan = await withTenant(TENANT_IN, () =>
      plans
        .createPlan({
          sourceType: "sales_invoice",
          sourceId: UNKNOWN_ID,
          downPayment: "2000.0000",
          count: 4,
          startDate: "2026-07-01",
          frequency: "MONTHLY",
          actorId: IN_ACTOR,
        })
        .catch((error: { code?: string }) => error.code),
    );
    const foreignPlan = await withTenant(TENANT_IN, () =>
      plans
        .createPlan({
          sourceType: "sales_invoice",
          sourceId: IN_FOREIGN_FIXTURE_IDS.invoice,
          downPayment: "2000.0000",
          count: 4,
          startDate: "2026-07-01",
          frequency: "MONTHLY",
          actorId: IN_ACTOR,
        })
        .catch((error: { code?: string }) => error.code),
    );
    expect(unknownPlan).toBe("PLAN_SOURCE_INVALID");
    expect(foreignPlan).toBe("PLAN_SOURCE_INVALID");

    const unknownWaive = await withTenant(TENANT_IN, () =>
      installments
        .waiveLine({ lineId: UNKNOWN_ID, reason: "parity probe", actorId: IN_ACTOR })
        .catch((error: { code?: string }) => error.code),
    );
    const foreignWaive = await withTenant(TENANT_IN, () =>
      installments
        .waiveLine({ lineId: fixture.foreign.lineId, reason: "parity probe", actorId: IN_ACTOR })
        .catch((error: { code?: string }) => error.code),
    );
    expect(unknownWaive).toBe("LINE_NOT_FOUND");
    expect(foreignWaive).toBe("LINE_NOT_FOUND");

    const unknownCharge = await withTenant(TENANT_IN, () =>
      installments
        .chargeLateFee({ lineId: UNKNOWN_ID, actorId: IN_ACTOR })
        .catch((error: { code?: string }) => error.code),
    );
    const foreignCharge = await withTenant(TENANT_IN, () =>
      installments
        .chargeLateFee({ lineId: fixture.foreign.lineId, actorId: IN_ACTOR })
        .catch((error: { code?: string }) => error.code),
    );
    expect(unknownCharge).toBe("LINE_NOT_FOUND");
    expect(foreignCharge).toBe("LINE_NOT_FOUND");
  });
});
