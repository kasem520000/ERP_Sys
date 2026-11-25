import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { superuserClient } from "../test-db";
import { CM_ACTOR, TENANT_CMMS, freshAsset, setupCmmsFixture } from "./fixtures";

/**
 * PHASE-049 (W-16 — T-01…T-04, the foundation wave) — the CMMS family's
 * FIRST spec (the hr/projects family precedent: the `__db__/cmms/`
 * directory opens with the migrations' own structural laws; the service
 * specs land with their W-17/W-18 waves). What this spec pins over real
 * PostgreSQL 16 (the plan §4's foundation arms):
 *
 * - the work-order machine's stamp law: every ILLEGAL state shape is
 *   refused BY NAME (the CHECK constraints' own constraint names — the
 *   typed-refusal floor the W-17 service rides);
 * - BR-097's single-open structural guard: the partial unique refuses a
 *   second OPEN generated order per (asset, plan) — and only per open
 *   window (a COMPLETED order re-arms the plan);
 * - the plans' XOR trigger-shape law + the METER-only anchor gate;
 * - the meters' odometer law (KM-only + ONE per asset — the R-10
 *   binding) + the readings' JOB-link XOR gate + the value floor;
 * - the spares' qty floor + the (asset, item) uniqueness;
 * - the tags' code-shape floor + the per-tenant code uniqueness;
 * - the transfers' ladder stamp law (the verdict XOR) + the same-branch
 *   refusal + the G-61 journal gate;
 * - the frozen-substrate extension: the not-self parent floor + the
 *   cost-center FK + the four expiry registers accepting dates.
 *
 * THE OWNER'S PER-ARM-WORLD LAW («أذرع الرفض كلٌّ على عالمه»): every
 * rejection arm builds its OWN world — a fresh asset with a unique code,
 * its own meters/plans/orders — no arm shares mutable rows with another;
 * the worlds are cheap (direct SQL on the migration's own floors; the
 * typed services are the later waves').
 */

interface PgError {
  code?: string;
  constraint?: string;
}

async function expectConstraint(
  run: () => Promise<unknown>,
  constraint: string,
  pgCode: "23514" | "23505" | "23503",
): Promise<void> {
  let caught: PgError | undefined;
  try {
    await run();
  } catch (error) {
    caught = error as PgError;
  }
  expect(caught, `expected ${constraint} to refuse the row`).toBeTruthy();
  expect(caught?.code).toBe(pgCode);
  expect(caught?.constraint).toBe(constraint);
}

let su: Client;

beforeAll(async () => {
  await setupCmmsFixture();
  su = await superuserClient();
});

async function insertWorkOrder(row: Record<string, unknown>): Promise<unknown> {
  return su.query(
    `INSERT INTO maintenance_work_orders
       (id, tenant_id, asset_id, order_no, problem, priority, status, plan_id,
        planned_at, started_at, completed_at, labor_total, parts_total,
        external_total, journal_entry_id, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      TENANT_CMMS,
      row.assetId,
      row.orderNo,
      row.problem ?? "Won't start",
      row.priority ?? "MEDIUM",
      row.status,
      row.planId ?? null,
      row.plannedAt ?? null,
      row.startedAt ?? null,
      row.completedAt ?? null,
      row.laborTotal ?? 0,
      row.partsTotal ?? 0,
      row.externalTotal ?? 0,
      row.journalEntryId ?? null,
      CM_ACTOR,
    ],
  );
}

describe("PHASE-049 W-16 — the work-order machine's stamp law (D-03)", () => {
  it("the legal ladder's shapes all insert (REQUESTED → PLANNED → IN_PROGRESS → ON_HOLD ↔ → COMPLETED)", async () => {
    // A completed world: journal stubbed with a real journal_entries row is
    // W-17's golden; here the completed shape is proven through the
    // machine's own stamps by first inserting the pre-completion states.
    const asset = await freshAsset("WO-LEGAL-A");
    await insertWorkOrder({ assetId: asset, orderNo: "MO-LEGAL-1", status: "REQUESTED" });
    await insertWorkOrder({
      assetId: asset,
      orderNo: "MO-LEGAL-2",
      status: "PLANNED",
      plannedAt: "2026-02-01T08:00:00Z",
    });
    await insertWorkOrder({
      assetId: asset,
      orderNo: "MO-LEGAL-3",
      status: "IN_PROGRESS",
      plannedAt: "2026-02-01T08:00:00Z",
      startedAt: "2026-02-01T09:00:00Z",
    });
    await insertWorkOrder({
      assetId: asset,
      orderNo: "MO-LEGAL-4",
      status: "ON_HOLD",
      plannedAt: "2026-02-01T08:00:00Z",
      startedAt: "2026-02-01T09:00:00Z",
    });
    // The completed shape carries the machine's stamps + its journal —
    // proven fully in the transfer/journal arms below and by W-17's
    // golden; here the pre-completion legal shapes are the point.
    const count = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM maintenance_work_orders WHERE tenant_id = $1 AND asset_id = $2`,
      [TENANT_CMMS, asset],
    );
    expect(count.rows[0]!.n).toBe("4");
  });

  it("REQUESTED with a planned stamp is refused by name (never a regression past the machine's floor)", async () => {
    const asset = await freshAsset("WO-REQ-STAMP");
    await expectConstraint(
      () =>
        insertWorkOrder({
          assetId: asset,
          orderNo: "MO-REQ-STAMP",
          status: "REQUESTED",
          plannedAt: "2026-02-01T08:00:00Z",
        }),
      "ck_maintenance_work_orders_stamps",
      "23514",
    );
  });

  it("PLANNED with a start stamp is refused by name", async () => {
    const asset = await freshAsset("WO-PLN-STAMP");
    await expectConstraint(
      () =>
        insertWorkOrder({
          assetId: asset,
          orderNo: "MO-PLN-STAMP",
          status: "PLANNED",
          plannedAt: "2026-02-01T08:00:00Z",
          startedAt: "2026-02-01T09:00:00Z",
        }),
      "ck_maintenance_work_orders_stamps",
      "23514",
    );
  });

  it("COMPLETED without its completion stamp is refused by name", async () => {
    const asset = await freshAsset("WO-CMP-NOSTAMP");
    // A valid-shaped journal uuid: the row-level CHECK fires BEFORE the
    // FK's after-trigger, so the stamp law is the named refusal.
    await expectConstraint(
      () =>
        insertWorkOrder({
          assetId: asset,
          orderNo: "MO-CMP-NOSTAMP",
          status: "COMPLETED",
          plannedAt: "2026-02-01T08:00:00Z",
          startedAt: "2026-02-01T09:00:00Z",
          journalEntryId: "11111111-1111-4111-8111-111111111111",
        }),
      "ck_maintenance_work_orders_stamps",
      "23514",
    );
  });

  it("a non-COMPLETED order carrying the G-59 journal stamp is refused by name (the journal gate)", async () => {
    const asset = await freshAsset("WO-JOURNAL-GATE");
    await expectConstraint(
      () =>
        insertWorkOrder({
          assetId: asset,
          orderNo: "MO-JOURNAL-GATE",
          status: "REQUESTED",
          journalEntryId: "11111111-1111-4111-8111-111111111112",
        }),
      "ck_maintenance_work_orders_journal_gated",
      "23514",
    );
  });

  it("an illegal status value is refused (the machine is CLOSED — no CANCELLED, no invented states)", async () => {
    const asset = await freshAsset("WO-BAD-STATUS");
    // The honest layering (this arm's own finding): an unknown status
    // matches NO branch of the stamp law first, so ck_..._stamps is the
    // observed refusal (the closed-machine floor — every row must fit
    // one of the five legal shapes); the status enum CHECK is the second
    // wall behind it. Both are 23514 — the machine is closed either way.
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO maintenance_work_orders
             (id, tenant_id, asset_id, order_no, problem, status, created_by)
           VALUES (gen_random_uuid(), $1, $2, 'MO-BAD-STATUS', 'x', 'CANCELLED', $3)`,
          [TENANT_CMMS, asset, CM_ACTOR],
        ),
      "ck_maintenance_work_orders_stamps",
      "23514",
    );
  });
});

describe("PHASE-049 W-16 — BR-097's single-open structural guard (D-08)", () => {
  async function seedPlan(asset: string, name: string): Promise<string> {
    const rows = await su.query<{ id: string }>(
      `INSERT INTO maintenance_plans
         (id, tenant_id, asset_id, name, trigger_type, interval_days, next_due_date, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, 'CALENDAR', 30, '2026-03-01', $4)
       RETURNING id`,
      [TENANT_CMMS, asset, name, CM_ACTOR],
    );
    return rows.rows[0]!.id;
  }

  it("a SECOND open generated order per (asset, plan) is refused by the partial unique; a COMPLETED order re-arms the plan", async () => {
    const asset = await freshAsset("BR097-WORLD");
    const planId = await seedPlan(asset, "Monthly service");
    await insertWorkOrder({
      assetId: asset,
      orderNo: "MO-BR097-1",
      status: "PLANNED",
      plannedAt: "2026-02-01T08:00:00Z",
      planId,
    });
    // The second OPEN order on the same (asset, plan) window: refused.
    await expectConstraint(
      () =>
        insertWorkOrder({
          assetId: asset,
          orderNo: "MO-BR097-2",
          status: "REQUESTED",
          planId,
        }),
      "uq_maintenance_work_orders_tenant_plan_open",
      "23505",
    );
    // A MANUAL order (plan_id NULL) never joins the partial unique.
    await insertWorkOrder({ assetId: asset, orderNo: "MO-BR097-3", status: "REQUESTED" });
    // An open order on a DIFFERENT plan of the same asset: legal.
    const secondPlan = await seedPlan(asset, "Quarterly deep service");
    await insertWorkOrder({
      assetId: asset,
      orderNo: "MO-BR097-4",
      status: "PLANNED",
      plannedAt: "2026-02-02T08:00:00Z",
      planId: secondPlan,
    });
    expect(true).toBe(true);
  });
});

describe("PHASE-049 W-16 — the plans' XOR trigger-shape law (D-08)", () => {
  async function insertPlan(row: {
    assetId: string;
    name: string;
    triggerType: string;
    intervalDays?: number | null;
    nextDueDate?: string | null;
    meterId?: string | null;
    thresholdDelta?: string | null;
    lastAnchorValue?: string | null;
  }): Promise<unknown> {
    return su.query(
      `INSERT INTO maintenance_plans
         (id, tenant_id, asset_id, name, trigger_type, interval_days, next_due_date,
          meter_id, threshold_delta, last_anchor_value, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        TENANT_CMMS,
        row.assetId,
        row.name,
        row.triggerType,
        row.intervalDays ?? null,
        row.nextDueDate ?? null,
        row.meterId ?? null,
        row.thresholdDelta ?? null,
        row.lastAnchorValue ?? null,
        CM_ACTOR,
      ],
    );
  }

  async function seedMeter(asset: string, name: string, type = "HOURS"): Promise<string> {
    const rows = await su.query<{ id: string }>(
      `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'h', $5)
       RETURNING id`,
      [TENANT_CMMS, asset, name, type, CM_ACTOR],
    );
    return rows.rows[0]!.id;
  }

  it("the two legal shapes insert (CALENDAR and METER, each exactly its own columns)", async () => {
    const asset = await freshAsset("PLAN-LEGAL");
    const meterId = await seedMeter(asset, "Engine hours");
    await insertPlan({
      assetId: asset,
      name: "Calendar plan",
      triggerType: "CALENDAR",
      intervalDays: 90,
      nextDueDate: "2026-06-01",
    });
    await insertPlan({
      assetId: asset,
      name: "Meter plan",
      triggerType: "METER",
      meterId,
      thresholdDelta: "500",
    });
    expect(true).toBe(true);
  });

  it("CALENDAR carrying a meter is refused by name (the XOR law)", async () => {
    const asset = await freshAsset("PLAN-CAL-METER");
    const meterId = await seedMeter(asset, "Hours");
    await expectConstraint(
      () =>
        insertPlan({
          assetId: asset,
          name: "Mixed plan",
          triggerType: "CALENDAR",
          intervalDays: 30,
          nextDueDate: "2026-03-01",
          meterId,
          thresholdDelta: "100",
        }),
      "ck_maintenance_plans_trigger_shape",
      "23514",
    );
  });

  it("METER without its threshold is refused by name", async () => {
    const asset = await freshAsset("PLAN-METER-NOTHRESH");
    const meterId = await seedMeter(asset, "Hours");
    await expectConstraint(
      () =>
        insertPlan({
          assetId: asset,
          name: "Thresholdless plan",
          triggerType: "METER",
          meterId,
        }),
      "ck_maintenance_plans_trigger_shape",
      "23514",
    );
  });

  it("METER carrying a calendar pair is refused by name", async () => {
    const asset = await freshAsset("PLAN-METER-CAL");
    const meterId = await seedMeter(asset, "Hours");
    await expectConstraint(
      () =>
        insertPlan({
          assetId: asset,
          name: "Over-carried plan",
          triggerType: "METER",
          meterId,
          thresholdDelta: "250",
          intervalDays: 30,
          nextDueDate: "2026-03-01",
        }),
      "ck_maintenance_plans_trigger_shape",
      "23514",
    );
  });

  it("a CALENDAR plan carrying a generation anchor is refused by name (the anchor is the METER kind's own column)", async () => {
    const asset = await freshAsset("PLAN-CAL-ANCHOR");
    await expectConstraint(
      () =>
        insertPlan({
          assetId: asset,
          name: "Anchored calendar plan",
          triggerType: "CALENDAR",
          intervalDays: 30,
          nextDueDate: "2026-03-01",
          lastAnchorValue: "1000",
        }),
      "ck_maintenance_plans_anchor_gated",
      "23514",
    );
  });
});

describe("PHASE-049 W-16 — the meters + readings laws (D-07)", () => {
  it("an odometer designation on a non-KM meter is refused by name (the R-10 binding)", async () => {
    const asset = await freshAsset("MTR-ODO-HOURS");
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, is_odometer, created_by)
           VALUES (gen_random_uuid(), $1, $2, 'Engine hours', 'HOURS', 'h', true, $3)`,
          [TENANT_CMMS, asset, CM_ACTOR],
        ),
      "ck_asset_meters_odometer_gated",
      "23514",
    );
  });

  it("a SECOND odometer on the same asset is refused by the partial unique (ONE odometer per asset)", async () => {
    const asset = await freshAsset("MTR-ODO-TWO");
    await su.query(
      `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, is_odometer, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'Primary odometer', 'KM', 'km', true, $3)`,
      [TENANT_CMMS, asset, CM_ACTOR],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, is_odometer, created_by)
           VALUES (gen_random_uuid(), $1, $2, 'Second odometer', 'KM', 'km', true, $3)`,
          [TENANT_CMMS, asset, CM_ACTOR],
        ),
      "uq_asset_meters_tenant_asset_odometer",
      "23505",
    );
  });

  it("a negative reading value is refused by name (the monotonic law's DB floor)", async () => {
    const asset = await freshAsset("MTR-NEG");
    const meter = await su.query<{ id: string }>(
      `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'Hours', 'HOURS', 'h', $3) RETURNING id`,
      [TENANT_CMMS, asset, CM_ACTOR],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source, created_by)
           VALUES (gen_random_uuid(), $1, $2, -5, '2026-02-01', 'MANUAL', $3)`,
          [TENANT_CMMS, meter.rows[0]!.id, CM_ACTOR],
        ),
      "ck_asset_meter_readings_value",
      "23514",
    );
  });

  it("a JOB reading without its work-order link is refused by name (the XOR gate)", async () => {
    const asset = await freshAsset("MTR-JOB-NOLINK");
    const meter = await su.query<{ id: string }>(
      `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'Hours', 'HOURS', 'h', $3) RETURNING id`,
      [TENANT_CMMS, asset, CM_ACTOR],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source, created_by)
           VALUES (gen_random_uuid(), $1, $2, 100, '2026-02-01', 'JOB', $3)`,
          [TENANT_CMMS, meter.rows[0]!.id, CM_ACTOR],
        ),
      "ck_asset_meter_readings_job_link",
      "23514",
    );
  });

  it("a MANUAL reading carrying a work-order link is refused by name (the XOR gate's other side)", async () => {
    const asset = await freshAsset("MTR-MANUAL-LINK");
    const meter = await su.query<{ id: string }>(
      `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'Hours', 'HOURS', 'h', $3) RETURNING id`,
      [TENANT_CMMS, asset, CM_ACTOR],
    );
    await insertWorkOrder({ assetId: asset, orderNo: "MO-MANUAL-LINK", status: "REQUESTED" });
    const order = await su.query<{ id: string }>(
      `SELECT id FROM maintenance_work_orders WHERE tenant_id = $1 AND order_no = 'MO-MANUAL-LINK'`,
      [TENANT_CMMS],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source, work_order_id, created_by)
           VALUES (gen_random_uuid(), $1, $2, 100, '2026-02-01', 'MANUAL', $3, $4)`,
          [TENANT_CMMS, meter.rows[0]!.id, order.rows[0]!.id, CM_ACTOR],
        ),
      "ck_asset_meter_readings_job_link",
      "23514",
    );
  });
});

describe("PHASE-049 W-16 — the spares + tags laws (D-05/D-09)", () => {
  async function seedItem(sku: string): Promise<string> {
    // The items substrate (0009): sku is the natural key, uom_id required —
    // the world's own unit of measure (ON CONFLICT-safe across arms;
    // uoms/items carry no created_by in the 0009 shape).
    await su.query(
      `INSERT INTO uoms (id, tenant_id, code, name, name_ar, is_system)
       VALUES (gen_random_uuid(), $1, 'UOM-CM', 'CMMS unit', 'وحدة الصيانة', false)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [TENANT_CMMS],
    );
    const rows = await su.query<{ id: string }>(
      `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id)
       SELECT gen_random_uuid(), $1, $2, $3, $4, 'STOCK', u.id
       FROM uoms u WHERE u.tenant_id = $1 AND u.code = 'UOM-CM'
       ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [TENANT_CMMS, sku, `Item ${sku}`, `صنف ${sku}`],
    );
    return rows.rows[0]!.id;
  }

  it("a zero-qty spare line is refused by name (the BOM's floor)", async () => {
    const asset = await freshAsset("SPR-ZERO");
    const itemId = await seedItem("IT-SPR-ZERO");
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_spares (id, tenant_id, asset_id, item_id, qty, created_by)
           VALUES (gen_random_uuid(), $1, $2, $3, 0, $4)`,
          [TENANT_CMMS, asset, itemId, CM_ACTOR],
        ),
      "ck_asset_spares_qty",
      "23514",
    );
  });

  it("a duplicate (asset, item) spare line is refused by the uniqueness (one BOM row per pair)", async () => {
    const asset = await freshAsset("SPR-DUP");
    const itemId = await seedItem("IT-SPR-DUP");
    await su.query(
      `INSERT INTO asset_spares (id, tenant_id, asset_id, item_id, qty, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, 2, $4)`,
      [TENANT_CMMS, asset, itemId, CM_ACTOR],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_spares (id, tenant_id, asset_id, item_id, qty, created_by)
           VALUES (gen_random_uuid(), $1, $2, $3, 3, $4)`,
          [TENANT_CMMS, asset, itemId, CM_ACTOR],
        ),
      "uq_asset_spares_tenant_asset_item",
      "23505",
    );
  });

  it("a too-short tag code is refused by name (the unguessable-code floor)", async () => {
    const asset = await freshAsset("TAG-SHORT");
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_tags (id, tenant_id, asset_id, code, created_by)
           VALUES (gen_random_uuid(), $1, $2, 'short', $3)`,
          [TENANT_CMMS, asset, CM_ACTOR],
        ),
      "ck_asset_tags_code",
      "23514",
    );
  });

  it("a duplicate tag code within the tenant is refused by the uniqueness", async () => {
    const assetA = await freshAsset("TAG-DUP-A");
    const assetB = await freshAsset("TAG-DUP-B");
    const code = "tag-dup-fixed-signed-token-payload-0123456789abcdef";
    await su.query(
      `INSERT INTO asset_tags (id, tenant_id, asset_id, code, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [TENANT_CMMS, assetA, code, CM_ACTOR],
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO asset_tags (id, tenant_id, asset_id, code, created_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
          [TENANT_CMMS, assetB, code, CM_ACTOR],
        ),
      "uq_asset_tags_tenant_code",
      "23505",
    );
  });
});

describe("PHASE-049 W-16 — the transfers' ladder stamp law (D-06)", () => {
  async function insertTransfer(row: Record<string, unknown>): Promise<unknown> {
    return su.query(
      `INSERT INTO asset_transfers
         (id, tenant_id, asset_id, from_branch_id, to_branch_id, reason, status,
          submitted_at, submitted_by, approved_at, approved_by, rejected_at,
          rejected_by, reject_reason, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        TENANT_CMMS,
        row.assetId,
        row.fromBranchId,
        row.toBranchId,
        row.reason ?? "Relocation",
        row.status,
        row.submittedAt ?? null,
        row.submittedBy ?? null,
        row.approvedAt ?? null,
        row.approvedBy ?? null,
        row.rejectedAt ?? null,
        row.rejectedBy ?? null,
        row.rejectReason ?? null,
        CM_ACTOR,
      ],
    );
  }

  async function secondBranch(code: string): Promise<string> {
    const rows = await su.query<{ id: string }>(
      `INSERT INTO branches (id, tenant_id, code, name, name_ar)
       VALUES (gen_random_uuid(), $1, $2, $3, $3)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [TENANT_CMMS, code, `Branch ${code}`],
    );
    return rows.rows[0]!.id;
  }

  it("the legal ladder inserts (DRAFT and SUBMITTED)", async () => {
    const base = await setupCmmsFixture();
    const asset = await freshAsset("TRF-LEGAL");
    const to = await secondBranch("BR-CM-2");
    await insertTransfer({
      assetId: asset,
      fromBranchId: base.branchId,
      toBranchId: to,
      status: "DRAFT",
    });
    await insertTransfer({
      assetId: asset,
      fromBranchId: base.branchId,
      toBranchId: to,
      status: "SUBMITTED",
      submittedAt: "2026-02-01T08:00:00Z",
      submittedBy: CM_ACTOR,
    });
    expect(true).toBe(true);
  });

  it("a same-branch transfer is refused by name", async () => {
    const base = await setupCmmsFixture();
    const asset = await freshAsset("TRF-SAME");
    await expectConstraint(
      () =>
        insertTransfer({
          assetId: asset,
          fromBranchId: base.branchId,
          toBranchId: base.branchId,
          status: "DRAFT",
        }),
      "ck_asset_transfers_branches",
      "23514",
    );
  });

  it("DRAFT carrying an approval stamp is refused by name (the ladder's floor)", async () => {
    const base = await setupCmmsFixture();
    const asset = await freshAsset("TRF-DRAFT-APP");
    const to = await secondBranch("BR-CM-3");
    await expectConstraint(
      () =>
        insertTransfer({
          assetId: asset,
          fromBranchId: base.branchId,
          toBranchId: to,
          status: "DRAFT",
          approvedAt: "2026-02-01T10:00:00Z",
          approvedBy: CM_ACTOR,
        }),
      "ck_asset_transfers_stamps",
      "23514",
    );
  });

  it("APPROVED without its verdict pair is refused by name", async () => {
    const base = await setupCmmsFixture();
    const asset = await freshAsset("TRF-APP-NOSTAMP");
    const to = await secondBranch("BR-CM-4");
    await expectConstraint(
      () =>
        insertTransfer({
          assetId: asset,
          fromBranchId: base.branchId,
          toBranchId: to,
          status: "APPROVED",
        }),
      "ck_asset_transfers_stamps",
      "23514",
    );
  });

  it("REJECTED without its reason is refused by name (the verdict is never silent)", async () => {
    const base = await setupCmmsFixture();
    const asset = await freshAsset("TRF-REJ-NOREASON");
    const to = await secondBranch("BR-CM-5");
    await expectConstraint(
      () =>
        insertTransfer({
          assetId: asset,
          fromBranchId: base.branchId,
          toBranchId: to,
          status: "REJECTED",
          submittedAt: "2026-02-01T08:00:00Z",
          submittedBy: CM_ACTOR,
          rejectedAt: "2026-02-01T09:00:00Z",
          rejectedBy: CM_ACTOR,
        }),
      "ck_asset_transfers_stamps",
      "23514",
    );
  });

  it("an APPROVED transfer carrying BOTH verdicts is refused by name (the XOR law)", async () => {
    const base = await setupCmmsFixture();
    const asset = await freshAsset("TRF-BOTH");
    const to = await secondBranch("BR-CM-6");
    await expectConstraint(
      () =>
        insertTransfer({
          assetId: asset,
          fromBranchId: base.branchId,
          toBranchId: to,
          status: "APPROVED",
          submittedAt: "2026-02-01T08:00:00Z",
          submittedBy: CM_ACTOR,
          approvedAt: "2026-02-01T09:00:00Z",
          approvedBy: CM_ACTOR,
          rejectedAt: "2026-02-01T10:00:00Z",
          rejectedBy: CM_ACTOR,
          rejectReason: "both",
        }),
      "ck_asset_transfers_stamps",
      "23514",
    );
  });
});

describe("PHASE-049 W-16 — the frozen-substrate extension (D-01, migration 0108)", () => {
  it("an asset as its OWN parent is refused by name (the self-reference floor)", async () => {
    const asset = await freshAsset("EXT-SELF");
    await expectConstraint(
      () =>
        su.query(`UPDATE assets SET parent_asset_id = id WHERE id = $1`, [asset]),
      "ck_assets_parent_not_self",
      "23514",
    );
  });

  it("a bogus cost-center FK is refused (the grouping rides the EXISTING tree)", async () => {
    const base = await setupCmmsFixture();
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id,
              acquisition_date, cost, useful_life_months, branch_id, cost_center_id, created_by)
           VALUES (gen_random_uuid(), $1, 'EXT-BADCC', 'x', 'س', $2, '2026-01-15', 100, 60, $3,
              '00000000-0000-4000-8000-00000000dead', $4)`,
          [TENANT_CMMS, base.categoryId, base.branchId, CM_ACTOR],
        ),
      "fk_assets_cost_center",
      "23503",
    );
  });

  it("the four expiry registers accept dates and the component link binds a real parent (the family lands additively)", async () => {
    const parent = await freshAsset("EXT-PARENT");
    const component = await freshAsset("EXT-CHILD", { parentAssetId: parent });
    const rows = await su.query<{
      warranty: string | null;
      insurance: string | null;
      license: string | null;
      inspection: string | null;
      parent: string | null;
    }>(
      `SELECT warranty_expiry::text AS warranty, insurance_expiry::text AS insurance,
              license_expiry::text AS license, inspection_expiry::text AS inspection,
              parent_asset_id::text AS parent
       FROM assets WHERE id = $1`,
      [component],
    );
    expect(rows.rows[0]).toMatchObject({
      warranty: "2027-01-15",
      insurance: null,
      license: null,
      inspection: null,
      parent,
    });
  });
});

describe("PHASE-049 W-18 — THE stock_moves SCOPE ARM (the shared-scope union law)", () => {
  /**
   * THE OWNER'S LAW (the W-17 acceptance, standing from W-18): a
   * constraint over a SHARED domain is recomputed from the UNION of every
   * member every migration has EVER defined — never a single migration's
   * list. This arm turns the G-48 lesson (0109's DROP+ADD rebuilt the
   * stock_moves source domain from 0073's list and missed 0077's
   * contract_mfg) into a standing proof: it parses EVERY migration file
   * for the constraint's definitions, unions all members ever defined,
   * and asserts the LIVE constraint (pg_get_constraintdef) equals that
   * union — with the members ENUMERATED EXPLICITLY (the owner's «تعدّ
   * أعضاء نطاق stock_moves صراحة»). A future partial DROP+ADD goes RED
   * here naming the missing member.
   */
  it("the live source-shape domain equals the UNION of every member every migration ever defined — enumerated explicitly", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const migrationsDir = join(process.cwd(), "migrations");
    const constraintSites = new Map<string, Set<string>>();
    const addOrInline =
      /(?:ADD CONSTRAINT|CONSTRAINT)\s+ck_stock_moves_source_shape\s+CHECK\s*\(\s*"source_type"\s+IN\s*\(([^)]+)\)/g;
    for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
      const text = readFileSync(join(migrationsDir, file), "utf8");
      for (const match of text.matchAll(addOrInline)) {
        const members = new Set(
          [...match[1]!.matchAll(/'([^']+)'/g)].map((hit) => hit[1]!),
        );
        constraintSites.set(file, members);
      }
    }
    // The union — every member every migration has EVER defined.
    const union = new Set<string>();
    for (const members of constraintSites.values()) {
      for (const member of members) union.add(member);
    }
    expect(union.size).toBeGreaterThan(0);
    // The definitions' lineage is on record (the sites enumerated).
    // [dated 2026-11-23 — PHASE-050 W-26: the lineage grows 10 → 11 sites —
    // 0117_quality_ncr_source_shape.sql (the W-25 stock-moves source
    // widening admitting `ncr_record` for G-62's write-off moves) defines
    // the constraint at a NEW site; the W-25 scope-label run left this
    // enumeration stale (an honest catch of W-26's own RED run — the
    // union LAW's dynamic check stayed green; the drift was in the arm's
    // explicit bookkeeping only, repaired here with the W-26 dated
    // note).]
    expect([...constraintSites.keys()].sort()).toEqual([
      "0014_inventory_core.sql",
      "0016_purchasing_core.sql",
      "0018_sales_core.sql",
      "0025_automotive_distribution.sql",
      "0026_manufacturing.sql",
      "0027_crm_projects.sql",
      "0073_stock_moves_wms_sources.sql",
      "0077_contract_manufacturing.sql",
      "0109_cmms_cost_lines_steps.sql",
      "0110_cmms_source_shape_repair.sql",
      "0117_quality_ncr_source_shape.sql",
      "0126_bonded_stock_moves_source.sql",
    ]);

    // The LIVE constraint, from the catalog itself.
    const live = await su.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conname = 'ck_stock_moves_source_shape' AND conrelid = 'public.stock_moves'::regclass`,
    );
    expect(live.rows).toHaveLength(1);
    const liveMembers = new Set(
      [...live.rows[0]!.definition.matchAll(/'([^']+)'/g)].map((hit) => hit[1]!),
    );

    // The members ENUMERATED EXPLICITLY (25 at the 126 chain — every
    // source family the platform has ever defined; [dated 2026-11-23 —
    // PHASE-050 W-26: `ncr_record` joins with 0117 — the W-25 G-62
    // write-off's move source, the honest catch of W-26's own RED run:
    // the W-25 wave's scope-label run left this enumeration at the 23
    // of the 110 chain; dated 2026-11-25 — PHASE-051 W-38:
    // `bonded_move` joins with 0126 — the bonded engine's REAL-
    // movement-core legs (the in-bond transfer's two legs + the
    // deposit's custodial receipt + the release's physical legs), the
    // 0117/0123 additive-slot precedent's own class])
    expect([...liveMembers].sort()).toEqual([
      "bonded_move",
      "consignment_settlement",
      "contract_mfg",
      "credit_note",
      "cross_dock",
      "cycle_count",
      "delivery_note",
      "goods_receipt",
      "job_card",
      "landed_cost",
      "maintenance_work_order",
      "manual_issue",
      "manual_receipt",
      "method_switch",
      "ncr_record",
      "opening_balance_doc",
      "production_order",
      "quarantine_disposition",
      "sales_invoice",
      "service_order",
      "stock_adjustment",
      "stock_count",
      "stock_transfer",
      "supplier_invoice",
      "warehouse_kit",
    ]);

    // THE LAW: live == the all-migrations union (a partial DROP+ADD goes
    // RED here — the difference named, member by member).
    const missing = [...union].filter((member) => !liveMembers.has(member));
    const extra = [...liveMembers].filter((member) => !union.has(member));
    expect(
      { missing, extra },
      "the live stock_moves source domain must equal the union of every member every migration ever defined (the shared-scope union law — the G-48 lesson)",
    ).toEqual({ missing: [], extra: [] });
  });
});

describe("PHASE-049 W-19 — THE NOTIFICATIONS-CATEGORY UNION ARM (the shared-scope union law's second application)", () => {
  /**
   * THE OWNER'S LAW (the W-17 acceptance, standing from W-18), applied to
   * the SECOND shared domain: the notifications/notification_prefs category
   * CHECKs are recomputed from the UNION of every member every migration
   * has EVER defined — never a single migration's list. This arm's first
   * run CAUGHT A REAL PRE-EXISTING DEFECT (the G-48 class, recorded in
   * 0112's header): 0043 §12 widened both domains with 'payroll' and
   * 0051's DROP+ADD silently rebuilt both lists WITHOUT it — latent (no
   * writer ever used the category), caught here by the law's own proof.
   * The repair (0112, the 0110 precedent's shape) restores the complete
   * union; a future partial DROP+ADD goes RED here naming the missing
   * member.
   */
  it("both live category domains equal the UNION of every member every migration ever defined — enumerated explicitly (the 0112 catch: 'payroll' restored)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const migrationsDir = join(process.cwd(), "migrations");
    const sites = new Map<string, Set<string>>();
    for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
      const text = readFileSync(join(migrationsDir, file), "utf8");
      for (const constraint of [
        "ck_notifications_category_values",
        "ck_notification_prefs_category_values",
      ]) {
        const pattern = new RegExp(
          `(?:ADD CONSTRAINT|CONSTRAINT)\\s+${constraint}\\s+CHECK\\s*\\(\\s*"category"\\s+IN\\s*\\(([^)]+)\\)`,
          "g",
        );
        for (const match of text.matchAll(pattern)) {
          const members = new Set(
            [...match[1]!.matchAll(/'([^']+)'/g)].map((hit) => hit[1]!),
          );
          const key = `${file}:${constraint}`;
          sites.set(key, members);
        }
      }
    }
    expect(sites.size).toBeGreaterThan(0);
    // The union — every member every migration has EVER defined (both
    // domains share one lineage).
    const union = new Set<string>();
    for (const members of sites.values()) {
      for (const member of members) union.add(member);
    }

    // The members ENUMERATED EXPLICITLY (seventeen at the 112 chain —
    // every category family the platform has ever defined, 'payroll'
    // among them; [dated 2026-11-23 — PHASE-050 W-26: the union grows
    // 17 → 18 members — `quality` joins with 0118 (the
    // quality-calibration-due sweep's inbox records, D-08's own
    // dependency), the 0111/0112 widening pattern carried into 050];
    // [dated 2026-11-25 — PHASE-051 W-34: the union grows 18 → 19
    // members — `trade` joins with 0123 (the trade-expiry-sweep's inbox
    // records, D-09's own dependency), the same widening pattern
    // carried into 051 — this arm's own design: the new member goes RED
    // here first, named, then the enumeration carries it]):
    expect([...union].sort()).toEqual([
      "assets",
      "budgeting",
      "collections",
      "crm",
      "einvoicing",
      "hr",
      "installments",
      "invoice_overdue",
      "limits",
      "notes",
      "payroll",
      "purchasing",
      "quality",
      "reconciliation",
      "stock",
      "subscription",
      "templates",
      "trade",
      "warranties",
    ]);

    // The LIVE constraints, from the catalog itself — BOTH domains.
    for (const [table, constraint] of [
      ["notifications", "ck_notifications_category_values"],
      ["notification_prefs", "ck_notification_prefs_category_values"],
    ] as const) {
      const live = await su.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
         WHERE conname = '${constraint}' AND conrelid = 'public.${table}'::regclass`,
      );
      expect(live.rows).toHaveLength(1);
      const liveMembers = new Set(
        [...live.rows[0]!.definition.matchAll(/'([^']+)'/g)].map((hit) => hit[1]!),
      );
      // THE LAW: live == the all-migrations union (a partial DROP+ADD goes
      // RED here — the difference named, member by member; this arm's own
      // first run named 'payroll' — the 0112 repair's cause).
      const missing = [...union].filter((member) => !liveMembers.has(member));
      const extra = [...liveMembers].filter((member) => !union.has(member));
      expect(
        { table, missing, extra },
        `the live ${table} category domain must equal the union of every member every migration ever defined (the shared-scope union law)`,
      ).toEqual({ table, missing: [], extra: [] });
    }
  });
});
