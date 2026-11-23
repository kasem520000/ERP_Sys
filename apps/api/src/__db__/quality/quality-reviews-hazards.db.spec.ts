import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import { ALL_KNOWN_PERMISSIONS, fullContext, newRunService } from "../reporting/fixtures";
import { registrySnapshot } from "../../modules/reporting/registry/runtime";
import { REPORT_CONTRACTS } from "../../modules/reporting/registry";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import * as qualityStore from "../../modules/quality/infrastructure/quality.store";
import { NcrService } from "../../modules/quality/application/ncr-service";
import { CapaService } from "../../modules/quality/application/capa-service";
import { CalibrationService } from "../../modules/quality/application/calibration-service";
import { SpcService } from "../../modules/quality/application/spc-service";
import { QualityCalibrationSweepService } from "../../modules/quality/application/quality-calibration-sweep-service";
import { ManagementReviewsService } from "../../modules/quality/application/reviews-service";
import { HazardRegistersService } from "../../modules/quality/application/hazards-service";
import { SpcInsufficientSamplesError } from "../../modules/quality/domain/quality-errors";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  TENANT_QUALITY_RLS,
  audit,
  complaints,
  ensureQualityOwnerTarget,
  freshQualityInstrument,
  freshQualityItem,
  numbering,
  posting,
  setupQualityFixture,
} from "./fixtures";

/**
 * PHASE-050 (W-30 — T-16) THE REVIEWS + HAZARDS SPEC (the plan §4's own
 * arms): the management review pack's FROZEN INDICATOR PACK over real
 * PG16 through the REAL services — the official MRV number, the pack
 * asserted against the world's ACTUAL counts (the engines' own reads,
 * VERBATIM), and the frozen-snapshot law (a later engine state never
 * moves a stored pack); the hazard register's HACCP floor (a CCP without
 * its critical limit refused BY NAME); the register's own state law (a
 * retired row is frozen evidence); the RLS boundary; and the W-30 report
 * contracts' execution arms (T-17 — the cmms-reports precedent: every
 * contract through the REAL RunService, the registry's own four rows at
 * 122). أذرع الرفض كلٌّ على عالمه.
 */
describe("quality management reviews + hazard registers (Q-10/Q-11 — the frozen pack + the HACCP floor)", () => {
  const ncrs = new NcrService(audit, posting, numbering);
  const capas = new CapaService(audit, posting, numbering);
  const calibrations = new CalibrationService(audit, posting, numbering);
  const spc = new SpcService(audit);
  const reviews = new ManagementReviewsService(audit, numbering, spc);
  const hazards = new HazardRegistersService(audit);

  beforeAll(async () => {
    await setupQualityFixture();
    await ensureQualityOwnerTarget();
  });

  async function customerId(): Promise<string> {
    const fixture = await setupQualityFixture();
    return fixture.partnerId;
  }

  it("THE FROZEN INDICATOR PACK: the official MRV number; the pack equals the world's actual counts VERBATIM; another NCR never moves it", async () => {
    const item = await freshQualityItem("MRV");
    const customer = await customerId();
    // The arm's world: one NCR + one complaint through the REAL services.
    const firstNcr = await withTenant(TENANT_QUALITY, () =>
      ncrs.create({
        itemId: item,
        source: "COMPLAINT",
        partnerId: customer,
        severity: "HIGH",
        problem: "the frozen-pack arm's complaint-driven NCR",
        affectedQty: "3",
        actorId: QL_ACTOR,
      }),
    );
    expect(firstNcr.status).toBe("OPEN");
    const firstComplaint = await withTenant(TENANT_QUALITY, () =>
      complaints.create({
        channel: "PHONE",
        severity: "MEDIUM",
        customerId: customer,
        subject: "the frozen-pack arm's complaint",
        actorId: QL_ACTOR,
      }),
    );
    expect(firstComplaint.status).toBe("NEW");

    // The world's ACTUAL counts at this moment — the engines' own reads
    // (the same store reads the service reads; the SPC leg through the
    // engine's own chart read, the same walk the pack rides).
    const expectedPack = await withTenant(TENANT_QUALITY, async () => {
      const activeSpecs = await qualityStore.listQualitySpecs({ activeOnly: true, limit: 500 });
      let outOfControlCharts = 0;
      for (const spec of activeSpecs) {
        try {
          const { chart } = await spc.chart(spec.id, { limit: 100 });
          if (chart.outOfControl) outOfControlCharts += 1;
        } catch (error) {
          if (error instanceof SpcInsufficientSamplesError) continue;
          throw error;
        }
      }
      return {
        ncrsByStatus: await qualityStore.countNcrsByStatus(),
        capasByStatus: await qualityStore.countCapasByStatus(),
        complaintsByStatus: await qualityStore.countComplaintsByStatus(),
        spc: {
          activeSpecs: activeSpecs.length,
          outOfControlCharts,
          measurements: await qualityStore.countSpcMeasurements(),
        },
      };
    });
    // The arm's own rows are inside the counts (the world's shape).
    expect(expectedPack.ncrsByStatus.OPEN ?? 0).toBeGreaterThanOrEqual(1);
    expect(expectedPack.complaintsByStatus.NEW ?? 0).toBeGreaterThanOrEqual(1);

    const review = await withTenant(TENANT_QUALITY, () =>
      reviews.create({
        meetingDate: "2026-11-23T10:00:00.000Z",
        title: "The annual quality management review",
        attendees: ["Quality Manager", "Plant Manager"],
        decisions: [
          "Approve the HACCP plan revision",
          "Close the two open supplier NCRs",
        ],
        note: "the frozen-pack arm's review",
        actorId: QL_ACTOR,
      }),
    );
    expect(review.reviewNo).toMatch(/^MRV-\d{4}-\d{6}$/);
    expect(review.title).toBe("The annual quality management review");
    expect(review.decisions).toEqual([
      "Approve the HACCP plan revision",
      "Close the two open supplier NCRs",
    ]);
    // THE PACK VERBATIM — the frozen snapshot of the world's own counts.
    expect(review.indicatorPack).toEqual(expectedPack);

    // THE FROZEN-SNAPSHOT LAW: another NCR lands; the stored pack does
    // NOT move (a later engine state never moves a stored pack).
    await withTenant(TENANT_QUALITY, () =>
      ncrs.create({
        itemId: item,
        source: "PRODUCTION",
        severity: "LOW",
        problem: "the after-the-meeting NCR (the frozen law's own probe)",
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    const liveCounts = await withTenant(TENANT_QUALITY, () => qualityStore.countNcrsByStatus());
    expect(liveCounts.OPEN ?? 0).toBe((expectedPack.ncrsByStatus.OPEN ?? 0) + 1);
    const reread = await withTenant(TENANT_QUALITY, () => reviews.find(review.id));
    expect(reread.indicatorPack).toEqual(expectedPack);
    expect(reread.decisions).toEqual(review.decisions);
  });

  it("THE REVIEW LIST + FIND: the newest first; the unknown id is the typed 404", async () => {
    const created = await withTenant(TENANT_QUALITY, () =>
      reviews.create({
        meetingDate: "2026-12-15T09:30:00.000Z",
        decisions: ["Re-audit the allergen CCP"],
        actorId: QL_ACTOR,
      }),
    );
    expect(created.title).toBe("Management Review 2026-12-15");
    const list = await withTenant(TENANT_QUALITY, () => reviews.list({ limit: 10 }));
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]!.id).toBe(created.id);
    const found = await withTenant(TENANT_QUALITY, () => reviews.find(created.id));
    expect(found.reviewNo).toBe(created.reviewNo);
    await expect(
      withTenant(TENANT_QUALITY, () =>
        reviews.find("00000000-0000-4000-8000-000000000000"),
      ),
    ).rejects.toMatchObject({ code: "MANAGEMENT_REVIEW_NOT_FOUND" });
  });

  it("THE HAZARD CREATE + THE HACCP FLOOR: the CCP carries its critical limit; the violating shapes refused BY NAME", async () => {
    const item = await freshQualityItem("HAZ");
    const row = await withTenant(TENANT_QUALITY, () =>
      hazards.create({
        name: "HAZ-MRV-001 Pasteurization temperature",
        hazard: "Survival of pathogenic microorganisms at low pasteurization temperature",
        category: "BIOLOGICAL",
        processStep: "Pasteurization",
        itemId: item,
        isCcp: true,
        criticalLimit: ">= 72 C for 15 seconds",
        monitoringProcedure: "Continuous temperature recorder + hourly operator check",
        correctiveAction: "Divert to re-pasteurization; calibrate the sensor; review the batch",
        actorId: QL_ACTOR,
      }),
    );
    expect(row.isCcp).toBe(true);
    expect(row.criticalLimit).toBe(">= 72 C for 15 seconds");
    expect(row.category).toBe("BIOLOGICAL");
    expect(row.isActive).toBe(true);

    // THE HACCP FLOOR — a CCP without its critical limit is refused BY
    // NAME at the service floor (the 0116 CHECK's own typed face).
    await expect(
      withTenant(TENANT_QUALITY, () =>
        hazards.create({
          name: "HAZ-MRV-002 Metal detection",
          hazard: "Metal fragments in the finished product",
          category: "PHYSICAL",
          isCcp: true,
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HAZARD_CCP_LIMIT_REQUIRED" });
    // The category vocabulary — the 0116 CHECK's own domain.
    await expect(
      withTenant(TENANT_QUALITY, () =>
        hazards.create({
          name: "HAZ-MRV-003 bad category",
          hazard: "the vocabulary floor's own probe",
          category: "RADIATION",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "QUALITY_INPUT_INVALID" });
    // The (tenant, name) natural key.
    await expect(
      withTenant(TENANT_QUALITY, () =>
        hazards.create({
          name: "HAZ-MRV-001 Pasteurization temperature",
          hazard: "the duplicate floor's own probe",
          category: "BIOLOGICAL",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HAZARD_REGISTER_DUPLICATE" });
    // A non-CCP hazard needs no critical limit (the floor cuts one way).
    const plain = await withTenant(TENANT_QUALITY, () =>
      hazards.create({
        name: "HAZ-MRV-004 Allergen changeover residue",
        hazard: "Residual allergen after a changeover",
        category: "ALLERGEN",
        actorId: QL_ACTOR,
      }),
    );
    expect(plain.isCcp).toBe(false);
    expect(plain.criticalLimit).toBeNull();
  });

  it("THE HAZARD LIST + FIND: the register's own filters; the unknown id is the typed 404", async () => {
    const item = await freshQualityItem("HAZLIST");
    const chemical = await withTenant(TENANT_QUALITY, () =>
      hazards.create({
        name: "HAZ-MRV-005 Cleaning agent residue",
        hazard: "Chemical residue from the CIP cycle",
        category: "CHEMICAL",
        itemId: item,
        actorId: QL_ACTOR,
      }),
    );
    const byItem = await withTenant(TENANT_QUALITY, () =>
      hazards.list({ itemId: item, limit: 50 }),
    );
    expect(byItem.map((row) => row.id)).toContain(chemical.id);
    const byCategory = await withTenant(TENANT_QUALITY, () =>
      hazards.list({ category: "CHEMICAL", limit: 500 }),
    );
    expect(byCategory.map((row) => row.id)).toContain(chemical.id);
    const found = await withTenant(TENANT_QUALITY, () => hazards.find(chemical.id));
    expect(found.name).toBe(chemical.name);
    await expect(
      withTenant(TENANT_QUALITY, () =>
        hazards.find("00000000-0000-4000-8000-000000000000"),
      ),
    ).rejects.toMatchObject({ code: "HAZARD_REGISTER_NOT_FOUND" });
  });

  it("THE HAZARD UPDATE: the PATCH merges; the CCP promotion carries its limit; the retired row is frozen evidence", async () => {
    const row = await withTenant(TENANT_QUALITY, () =>
      hazards.create({
        name: "HAZ-MRV-006 Cold-chain storage",
        hazard: "Temperature abuse in the cold store",
        category: "BIOLOGICAL",
        processStep: "Cold storage",
        actorId: QL_ACTOR,
      }),
    );
    // The merged PATCH: the monitoring + corrective texts land, the
    // CCP promotion carries its critical limit (the merged-pair floor).
    await expect(
      withTenant(TENANT_QUALITY, () =>
        hazards.update({ hazardId: row.id, isCcp: true, actorId: QL_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "HAZARD_CCP_LIMIT_REQUIRED" });
    const updated = await withTenant(TENANT_QUALITY, () =>
      hazards.update({
        hazardId: row.id,
        isCcp: true,
        criticalLimit: "<= 4 C continuously",
        monitoringProcedure: "Continuous data logger with a 15-minute sampling interval",
        correctiveAction: "Quarantine the exposed stock; review the logger trace",
        actorId: QL_ACTOR,
      }),
    );
    expect(updated.isCcp).toBe(true);
    expect(updated.criticalLimit).toBe("<= 4 C continuously");
    expect(updated.version).toBe(row.version + 1);
    expect(updated.name).toBe(row.name);

    // THE STATE LAW: retiring is the last write the row accepts.
    const retired = await withTenant(TENANT_QUALITY, () =>
      hazards.update({ hazardId: updated.id, isActive: false, actorId: QL_ACTOR }),
    );
    expect(retired.isActive).toBe(false);
    await expect(
      withTenant(TENANT_QUALITY, () =>
        hazards.update({ hazardId: retired.id, note: "the frozen row probe", actorId: QL_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "HAZARD_REGISTER_STATE" });
    // The activeOnly filter drops the retired row.
    const active = await withTenant(TENANT_QUALITY, () =>
      hazards.list({ activeOnly: true, limit: 500 }),
    );
    expect(active.map((entry) => entry.id)).not.toContain(retired.id);
  });

  it("THE RLS BOUNDARY: the isolated tenant sees neither register", async () => {
    const reviewsSeen = await withTenant(TENANT_QUALITY_RLS, () =>
      qualityStore.listManagementReviews({ limit: 10 }),
    );
    expect(reviewsSeen).toHaveLength(0);
    const hazardsSeen = await withTenant(TENANT_QUALITY_RLS, () =>
      qualityStore.listHazardRegisters({ limit: 10 }),
    );
    expect(hazardsSeen).toHaveLength(0);
  });

  // ── T-17: the four report contracts' execution arms (the cmms-reports
  // precedent — every contract through the REAL RunService) ────────────────

  /** Run one report contract through the REAL RunService on the QL tenant. */
  async function runReport(reportKey: string, params: Record<string, unknown>) {
    const outcome = await withTenant(TENANT_QUALITY, () =>
      newRunService().run({
        reportKey,
        params,
        ctx: fullContext(TENANT_QUALITY),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    return outcome.result!;
  }

  it("THE FOUR REPORT CONTRACTS: the registry carries them on the module's own key; every contract executes over the quality world", async () => {
    const snapshot = registrySnapshot([...REPORT_CONTRACTS]);
    // PHASE-050 (W-30, T-17, dated 2026-11-23): 118 → 122 (+4 quality: ncr-register, capa-status, calibration-due, complaints-summary)
    expect(snapshot).toHaveLength(122);
    const byId = new Map(snapshot.map((row) => [row.id, row]));
    for (const id of [
      "quality.ncr-register",
      "quality.capa-status",
      "quality.calibration-due",
      "quality.complaints-summary",
    ]) {
      expect(byId.get(id)?.requiredPermission).toBe("quality.view");
      expect(byId.get(id)?.category).toBe("quality");
    }
    expect(ALL_KNOWN_PERMISSIONS.has("quality.view")).toBe(true);

    // (a) quality.ncr-register — the arm-1 NCR renders with its own
    // figures (status/severity/source VERBATIM), every assertion PASS.
    const ncrRegister = await runReport("quality.ncr-register", {
      dateFrom: "2000-01-01",
      dateTo: "2100-01-01",
      locale: "en",
    });
    for (const assertion of ncrRegister.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
    const openRows = await runReport("quality.ncr-register", {
      dateFrom: "2000-01-01",
      dateTo: "2100-01-01",
      status: "OPEN",
      locale: "en",
    });
    expect(openRows.rows.length).toBeGreaterThanOrEqual(1);
    expect(
      openRows.rows.every((row) => row.values.status === "OPEN"),
    ).toBe(true);

    // (b) quality.capa-status — a fresh CAPA renders with the BR-103
    // gate's own figures (0 actions: total/open/pending all zero).
    const capa = await withTenant(TENANT_QUALITY, () =>
      capas.create({
        title: "the report arm's CAPA",
        actorId: QL_ACTOR,
      }),
    );
    const capaStatus = await runReport("quality.capa-status", {
      dateFrom: "2000-01-01",
      dateTo: "2100-01-01",
      locale: "en",
    });
    for (const assertion of capaStatus.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
    const capaRow = capaStatus.rows.find((row) => row.values.capaNo === capa.capaNo);
    expect(capaRow).toBeDefined();
    expect(capaRow!.values.actions).toBe("0/0/0");
    expect(capaRow!.values.rootCause).toBe("—");

    // (c) quality.calibration-due — a fresh instrument with its latest
    // calibration due INSIDE the effective ladder's widest window
    // renders in exactly one band (the sweep's own probe shape; the due
    // day derived from the ENGINE'S OWN effective config — stored ∪ the
    // documented default, never assumed).
    const instrument = await freshQualityInstrument("MRVRPT");
    const config = await withTenant(TENANT_QUALITY, () =>
      new QualityCalibrationSweepService(audit, new InboxService()).effectiveConfig(),
    );
    const widestDays = Math.max(...config.thresholds);
    // A due day safely inside the widest band and strictly after the
    // calibration's own day (the 0115 floor) — the documented default
    // ladder [30,7,0] makes this 28; any stored ladder lands inside
    // whatever window the engine itself would alert on.
    const dueInDays = Math.max(1, widestDays - 2);
    const today = new Date();
    const dueDate = new Date(today.getTime() + dueInDays * 86_400_000);
    const isoDay = (date: Date) =>
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    const calibration = await withTenant(TENANT_QUALITY, () =>
      calibrations.create({
        assetId: instrument,
        standardUsed: "Reference thermometer",
        result: "PASS",
        calibratedAt: `${isoDay(today)}T08:00:00.000Z`,
        dueDate: isoDay(dueDate),
        actorId: QL_ACTOR,
      }),
    );
    expect(calibration.dueDate).toBe(isoDay(dueDate));
    const calibrationDue = await runReport("quality.calibration-due", { locale: "en" });
    for (const assertion of calibrationDue.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
    const instrumentCode = await (async () => {
      const su = await superuserClient();
      const rows = await su.query<{ code: string }>(
        `SELECT code FROM assets WHERE tenant_id = $1 AND id = $2`,
        [TENANT_QUALITY, instrument],
      );
      await su.end();
      return rows.rows[0]!.code;
    })();
    const dueRows = calibrationDue.rows.filter((row) => row.values.code === instrumentCode);
    expect(dueRows).toHaveLength(1); // exactly one band (the disjoint fold)
    expect(String(dueRows[0]!.values.dueDate)).toBe(isoDay(dueDate));

    // (d) quality.complaints-summary — the register's own grouped counts
    // with the axis tie PASS (the arm-1 complaint is inside the period).
    const complaintsSummary = await runReport("quality.complaints-summary", {
      dateFrom: "2000-01-01",
      dateTo: "2100-01-01",
      locale: "en",
    });
    for (const assertion of complaintsSummary.assertions) {
      expect(assertion.status, assertion.id).toBe("PASS");
    }
    const total = Number(
      complaintsSummary.totals.find((total) => total.id === "total")!.amount,
    );
    expect(total).toBeGreaterThanOrEqual(1);
    const statusRows = complaintsSummary.rows.filter((row) => row.groupKey === "status");
    const statusSum = statusRows.reduce((sum, row) => sum + Number(row.values.count), 0);
    expect(statusSum).toBe(total);
  });

  it("THE REPORT DENY PATH: a session without quality.view cannot run the quality contracts (before params bind)", async () => {
    const deniedCtx = fullContext(TENANT_QUALITY, {
      permissions: new Set(["reporting.reports.run"]),
    });
    await expect(
      withTenant(TENANT_QUALITY, () =>
        newRunService().run({
          reportKey: "quality.ncr-register",
          params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
          ctx: deniedCtx,
        }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
