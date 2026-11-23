import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import * as qualityStore from "../../modules/quality/infrastructure/quality.store";
import { NcrService } from "../../modules/quality/application/ncr-service";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  TENANT_QUALITY_RLS,
  audit,
  complaints,
  freshQualityHoldWorld,
  numbering,
  posting,
  setupQualityFixture,
} from "./fixtures";

/**
 * PHASE-050 (W-28 — T-12) THE COMPLAINTS SPEC (the plan §4's own arm:
 * "the intake + the NCR link"): the lifecycle walks its ladder over real
 * PG16 through the REAL services — the official CMP numbering, the
 * intake's inbox notification (category 'quality'), the triage act
 * carrying the first NCR link, the link window's refusals, the
 * resolution pair landing together, the closed register refusing every
 * move, and the RLS boundary. أذرع الرفض كلٌّ على عالمه.
 */
describe("quality complaints — the intake + the NCR link (Q-08)", () => {
  beforeAll(async () => {
    await setupQualityFixture();
    await (await import("./fixtures")).ensureQualityOwnerTarget();
  });

  async function customerId(): Promise<string> {
    const su = await superuserClient();
    const rows = await su.query<{ id: string }>(
      `SELECT id FROM partners WHERE tenant_id = $1 AND code = 'QL-CUST' LIMIT 1`,
      [TENANT_QUALITY],
    );
    await su.end();
    return rows.rows[0]!.id;
  }

  it("THE INTAKE: the official CMP number, the NEW status, the inbox notification recorded (category 'quality')", async () => {
    const customer = await customerId();
    const row = await withTenant(TENANT_QUALITY, () =>
      complaints.create({
        channel: "PHONE",
        severity: "HIGH",
        customerId: customer,
        subject: "the packaging arrived torn",
        details: "Batch QL-B-001 cartons damaged in transit",
        actorId: QL_ACTOR,
      }),
    );
    expect(row.status).toBe("NEW");
    expect(row.complaintNo).toMatch(/^CMP-\d{4}-\d{6}$/);
    const su = await superuserClient();
    const inbox = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
        WHERE tenant_id = $1 AND category = 'quality'
          AND dedupe_key = $2`,
      [TENANT_QUALITY, `quality:complaint:${row.complaintNo}`],
    );
    expect(inbox.rows[0]!.n).toBe(1);
    await su.end();
  });

  it("THE LADDER: triage (carrying the first NCR link) → progress → resolve (the pair) → close — every rung through the REAL CAS", async () => {
    const world = await freshQualityHoldWorld("CMP");
    const ncrService = new NcrService(audit, posting, numbering);
    const customer = await customerId();
    const ncr = await withTenant(TENANT_QUALITY, () =>
      ncrService.create({
        itemId: world.itemId,
        batchId: world.batchId,
        source: "COMPLAINT",
        partnerId: customer,
        severity: "MEDIUM",
        problem: "the complaint-driven NCR (the link arm)",
        affectedQty: "2",
        actorId: QL_ACTOR,
      }),
    );
    const row = await withTenant(TENANT_QUALITY, () =>
      complaints.create({
        channel: "EMAIL",
        severity: "MEDIUM",
        customerId: customer,
        itemId: world.itemId,
        batchId: world.batchId,
        subject: "the ladder arm's complaint",
        actorId: QL_ACTOR,
      }),
    );
    const triaged = await withTenant(TENANT_QUALITY, () =>
      complaints.triage({ complaintId: row.id, ncrId: ncr.id, actorId: QL_ACTOR }),
    );
    expect(triaged.status).toBe("TRIAGED");
    expect(triaged.ncrId).toBe(ncr.id);
    const progressed = await withTenant(TENANT_QUALITY, () =>
      complaints.progress({ complaintId: row.id, actorId: QL_ACTOR }),
    );
    expect(progressed.status).toBe("IN_PROGRESS");
    const resolved = await withTenant(TENANT_QUALITY, () =>
      complaints.resolve({
        complaintId: row.id,
        resolution: "replacement dispatched; carrier claim filed",
        actorId: QL_ACTOR,
      }),
    );
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolution).toBe("replacement dispatched; carrier claim filed");
    expect(resolved.resolvedAt).not.toBeNull();
    const closed = await withTenant(TENANT_QUALITY, () =>
      complaints.close({ complaintId: row.id, actorId: QL_ACTOR }),
    );
    expect(closed.status).toBe("CLOSED");
    // The closed register refuses every move.
    await expect(
      withTenant(TENANT_QUALITY, () =>
        complaints.progress({ complaintId: row.id, actorId: QL_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "COMPLAINT_STATE" });
  });

  it("THE LINK WINDOW: a NEW complaint carries no link; the link lands at TRIAGED through the register's OWN row", async () => {
    const customer = await customerId();
    const row = await withTenant(TENANT_QUALITY, () =>
      complaints.create({
        channel: "PORTAL",
        severity: "LOW",
        customerId: customer,
        subject: "the link window arm",
        actorId: QL_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        complaints.linkNcr({
          complaintId: row.id,
          ncrId: "00000000-0000-4000-8000-000000000000",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "COMPLAINT_STATE" });
    // The triage's own link floor: an unknown NCR is the typed 404.
    await expect(
      withTenant(TENANT_QUALITY, () =>
        complaints.triage({
          complaintId: row.id,
          ncrId: "00000000-0000-4000-8000-000000000000",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "NCR_RECORD_NOT_FOUND" });
    const triaged = await withTenant(TENANT_QUALITY, () =>
      complaints.triage({ complaintId: row.id, actorId: QL_ACTOR }),
    );
    expect(triaged.status).toBe("TRIAGED");
    expect(triaged.ncrId).toBeNull();
    // The not-found complaint is the typed 404 (A7 parity).
    await expect(
      withTenant(TENANT_QUALITY, () =>
        complaints.find("00000000-0000-4000-8000-000000000000"),
      ),
    ).rejects.toMatchObject({ code: "COMPLAINT_NOT_FOUND" });
  });

  it("THE RESOLUTION-PAIR FLOOR: the resolve on a non-IN_PROGRESS rung is the typed refusal; the blank resolution is the input floor", async () => {
    const customer = await customerId();
    const row = await withTenant(TENANT_QUALITY, () =>
      complaints.create({
        channel: "WALK_IN",
        severity: "CRITICAL",
        customerId: customer,
        subject: "the resolution floor arm",
        actorId: QL_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        complaints.resolve({ complaintId: row.id, resolution: "too early", actorId: QL_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "COMPLAINT_STATE" });
    await withTenant(TENANT_QUALITY, () =>
      complaints.triage({ complaintId: row.id, actorId: QL_ACTOR }),
    );
    await withTenant(TENANT_QUALITY, () =>
      complaints.progress({ complaintId: row.id, actorId: QL_ACTOR }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        complaints.resolve({ complaintId: row.id, resolution: "   ", actorId: QL_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "QUALITY_INPUT_INVALID" });
  });

  it("THE RLS BOUNDARY: the isolated tenant sees no complaints", async () => {
    const isolated = await withTenant(TENANT_QUALITY_RLS, () =>
      qualityStore.listComplaints({ limit: 10 }),
    );
    expect(isolated).toHaveLength(0);
  });
});
