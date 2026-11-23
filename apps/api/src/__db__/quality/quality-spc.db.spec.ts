import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  TENANT_QUALITY_RLS,
  freshQualityBatch,
  freshQualityItem,
  setupQualityFixture,
} from "./fixtures";
import { SpecificationService } from "../../modules/quality/application/specification-service";
import { SpcService } from "../../modules/quality/application/spc-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import {
  SpcInsufficientSamplesError,
  SpcSubgroupSizeInvalidError,
  QualityInputInvalidError,
  QualitySpecificationNotFoundError,
} from "../../modules/quality/domain/quality-errors";
import { computeXbarRChart } from "../../modules/quality/domain/spc-statistics";

/**
 * PHASE-050 (W-27 — T-09, 2026-11-23) `quality-spc.db.spec` — THE SPC
 * SERVICE over real PG16 (the plan §4's own arm; acceptance #5's service
 * half): the ingestion's floors (the spec's own row, the source
 * vocabulary, the batch provenance), and THE CHART READ against the PURE
 * MODULE — the service's figures are the pure fold's outputs VERBATIM on
 * the PINNED REFERENCE DATASET A (the same dataset the unit property
 * tests pin: Cp 1.163000 EXACT · Cpk 1.114542 · UCLx 10.255800), the
 * samples drawn from the real spc_measurements rows in time order, the
 * trailing partial group excluded and disclosed. The RLS boundary arm:
 * the isolated tenant sees no samples and no chart (A7's 404 shape).
 */

const audit = new AuditService(new DrizzleAuditStore());
const specifications = new SpecificationService(audit);
const spc = new SpcService(audit);

// DATASET A — the unit property tests' own pinned dataset (13 values ×
// the 20-sample shape below; the pins: grandMean 10.025000 · R̄ 0.400000
// · UCLx 10.255800 · LCLx 9.794200 · UCLr 0.845600 · σ̂ 0.171969 ·
// Cp 1.163000 EXACT · Cpk 1.114542 — no flags).
const DATASET_A = [
  "10.0", "10.2", "9.8", "10.1", "9.9",
  "10.1", "10.3", "9.9", "10.0", "10.2",
  "9.9", "10.0", "10.2", "10.1", "9.8",
  "10.2", "9.8", "10.1", "10.0", "9.9",
];

/** Sample timestamps one hour apart, oldest first (the time order the
 * chart read must reconstruct from the DESC cap). */
function sampledAt(index: number): string {
  return new Date(Date.parse("2026-06-01T08:00:00.000Z") + index * 3_600_000).toISOString();
}

beforeAll(async () => {
  await setupQualityFixture();
});

describe("PHASE-050 W-27 — the SPC service over real PG16", () => {
  it("the chart read returns the PURE module's outputs VERBATIM on the pinned dataset A", async () => {
    const itemId = await freshQualityItem("SPC-A");
    const spec = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        parameterAr: "اللزوجة",
        unit: "cP",
        targetValue: "10.000000",
        ucl: "10.600000",
        lcl: "9.400000",
        actorId: QL_ACTOR,
      }),
    );
    for (const [index, value] of DATASET_A.entries()) {
      await withTenant(TENANT_QUALITY, () =>
        spc.record({
          specId: spec.id,
          value,
          sampledAt: sampledAt(index),
          source: "PRODUCTION",
          actorId: QL_ACTOR,
        }),
      );
    }
    const response = await withTenant(TENANT_QUALITY, () =>
      spc.chart(spec.id, { subgroupSize: 5 }),
    );
    // THE VERBATIM LAW: the service's chart IS the pure fold's output on
    // the same values — computed independently here, not shared. The DB's
    // numeric(19,6) canonicalizes the samples to 6dp strings ("10.0" →
    // "10.000000"); the pure fold is fed the SAME canonical strings the
    // store returned (the DB's own shape — never a re-derivation).
    const canonical = DATASET_A.map((value) => {
      const decimal = new Decimal(value);
      return decimal.toFixed(6);
    });
    const pure = computeXbarRChart({
      values: canonical,
      subgroupSize: 5,
      band: { ucl: "10.600000", lcl: "9.400000" },
    });
    expect(response.chart).toEqual(pure);
    // THE PINS (the unit property tests' own figures — hand-computed):
    expect(response.chart.grandMean).toBe("10.025000");
    expect(response.chart.rBar).toBe("0.400000");
    expect(response.chart.xChart).toEqual({ ucl: "10.255800", lcl: "9.794200" });
    expect(response.chart.rChart).toEqual({ ucl: "0.845600", lcl: "0.000000" });
    expect(response.chart.sigmaHat).toBe("0.171969");
    expect(response.chart.cp).toBe("1.163000");
    expect(response.chart.cpk).toBe("1.114542");
    expect(response.chart.outOfControl).toBe(false);
    expect(response.chart.excludedCount).toBe(0);
    expect(response.chart.subgroups).toHaveLength(4);
    expect(response.sampleCount).toBe(20);
    // The spec row rides along (the band's own home).
    expect(response.spec.id).toBe(spec.id);
    expect(response.spec.ucl).toBe("10.600000");
  });

  it("the chart read caps at the NEWEST samples and reverses to time order (the DESC cap law)", async () => {
    const itemId = await freshQualityItem("SPC-CAP");
    const spec = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        targetValue: "10.000000",
        ucl: "10.600000",
        lcl: "9.400000",
        actorId: QL_ACTOR,
      }),
    );
    // 22 samples: the FIRST two are wild (they must be EXCLUDED by the
    // cap, never charted), the last 20 are dataset A.
    const values = ["50.0", "0.1", ...DATASET_A];
    for (const [index, value] of values.entries()) {
      await withTenant(TENANT_QUALITY, () =>
        spc.record({
          specId: spec.id,
          value,
          sampledAt: sampledAt(index),
          source: "MANUAL",
          actorId: QL_ACTOR,
        }),
      );
    }
    const capped = await withTenant(TENANT_QUALITY, () =>
      spc.chart(spec.id, { subgroupSize: 5, limit: 20 }),
    );
    expect(capped.sampleCount).toBe(20);
    // The newest 20 are exactly dataset A → the same pins, no wild value.
    expect(capped.chart.grandMean).toBe("10.025000");
    expect(capped.chart.outOfControl).toBe(false);
  });

  it("the trailing partial group is excluded and disclosed through the service read", async () => {
    const itemId = await freshQualityItem("SPC-PART");
    const spec = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        targetValue: "10.000000",
        ucl: "10.600000",
        lcl: "9.400000",
        actorId: QL_ACTOR,
      }),
    );
    for (const [index, value] of [...DATASET_A, "13.7", "0.1"].entries()) {
      await withTenant(TENANT_QUALITY, () =>
        spc.record({
          specId: spec.id,
          value,
          sampledAt: sampledAt(index),
          source: "MANUAL",
          actorId: QL_ACTOR,
        }),
      );
    }
    const response = await withTenant(TENANT_QUALITY, () =>
      spc.chart(spec.id, { subgroupSize: 5 }),
    );
    expect(response.sampleCount).toBe(22);
    expect(response.chart.excludedCount).toBe(2);
    expect(response.chart.subgroups).toHaveLength(4);
    // The wild trailing pair never touched the arithmetic.
    expect(response.chart.grandMean).toBe("10.025000");
    expect(response.chart.cp).toBe("1.163000");
    expect(response.chart.outOfControl).toBe(false);
  });

  it("the ingestion floors: the unknown spec is the typed 404 shape; the bad source and the unknown batch are the typed input refusals", async () => {
    await expect(
      withTenant(TENANT_QUALITY, () =>
        spc.record({
          specId: "11111111-1111-4111-8111-111111111111",
          value: "10.0",
          sampledAt: "2026-06-01T08:00:00Z",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "QUALITY_SPECIFICATION_NOT_FOUND" });
    const itemId = await freshQualityItem("SPC-FLOORS");
    const spec = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        targetValue: "10.000000",
        actorId: QL_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        spc.record({
          specId: spec.id,
          value: "10.0",
          sampledAt: "2026-06-01T08:00:00Z",
          source: "SATELLITE",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "QUALITY_INPUT_INVALID" });
    await expect(
      withTenant(TENANT_QUALITY, () =>
        spc.record({
          specId: spec.id,
          value: "10.0",
          sampledAt: "2026-06-01T08:00:00Z",
          batchId: "22222222-2222-4222-8222-222222222222",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({
      code: "QUALITY_INPUT_INVALID",
      details: { field: "batchId" },
    });
    // A negative value is LEGAL (a temperature can be −5 — the recorded
    // honest shape, the no-fabrication law cuts both ways).
    const negative = await withTenant(TENANT_QUALITY, () =>
      spc.record({
        specId: spec.id,
        value: "-5.250000",
        sampledAt: "2026-06-01T08:00:00Z",
        actorId: QL_ACTOR,
      }),
    );
    expect(negative.value).toBe("-5.250000");
  });

  it("the chart's own floors: the subgroup size domain and the complete-subgroup floor (both typed, both carrying the figures)", async () => {
    const itemId = await freshQualityItem("SPC-CHART-FLOOR");
    const spec = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        targetValue: "10.000000",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, () =>
      spc.record({
        specId: spec.id,
        value: "10.0",
        sampledAt: "2026-06-01T08:00:00Z",
        actorId: QL_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () => spc.chart(spec.id, { subgroupSize: 11 })),
    ).rejects.toMatchObject({
      code: "SPC_SUBGROUP_SIZE_INVALID",
      details: { subgroupSize: 11 },
    });
    await expect(
      withTenant(TENANT_QUALITY, () => spc.chart(spec.id, { subgroupSize: 5 })),
    ).rejects.toBeInstanceOf(SpcInsufficientSamplesError);
    await expect(
      withTenant(TENANT_QUALITY, () => spc.chart(spec.id, { subgroupSize: 5 })),
    ).rejects.toMatchObject({ details: { have: 1, need: 5 } });
    await expect(
      withTenant(TENANT_QUALITY, () =>
        spc.chart("11111111-1111-4111-8111-111111111111", { subgroupSize: 5 }),
      ),
    ).rejects.toBeInstanceOf(QualitySpecificationNotFoundError);
  });

  it("the batch provenance: the batch's own measurements read through the provenance surface", async () => {
    const { itemId, batchId } = await freshQualityBatch("SPC-BATCH");
    const spec = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        targetValue: "10.000000",
        actorId: QL_ACTOR,
      }),
    );
    const recorded = await withTenant(TENANT_QUALITY, () =>
      spc.record({
        specId: spec.id,
        value: "10.400000",
        sampledAt: "2026-06-02T08:00:00Z",
        batchId,
        actorId: QL_ACTOR,
      }),
    );
    expect(recorded.batchId).toBe(batchId);
    const byBatch = await withTenant(TENANT_QUALITY, () =>
      spc.listMeasurements({ batchId }),
    );
    expect(byBatch.map((row) => row.id)).toContain(recorded.id);
  });

  it("THE RLS BOUNDARY: the isolated tenant sees no samples and the chart read is the 404 shape", async () => {
    const itemId = await freshQualityItem("SPC-RLS");
    const spec = await withTenant(TENANT_QUALITY, () =>
      specifications.create({
        itemId,
        parameter: "Viscosity",
        targetValue: "10.000000",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, () =>
      spc.record({
        specId: spec.id,
        value: "10.0",
        sampledAt: "2026-06-01T08:00:00Z",
        actorId: QL_ACTOR,
      }),
    );
    // The isolated tenant's own read: nothing (the empty world by
    // construction — the cmms TENANT_CMMS_RLS shape).
    const rlsRows = await withTenant(TENANT_QUALITY_RLS, () =>
      spc.listMeasurements({ specId: spec.id }),
    );
    expect(rlsRows).toEqual([]);
    await expect(
      withTenant(TENANT_QUALITY_RLS, () => spc.chart(spec.id, { subgroupSize: 5 })),
    ).rejects.toMatchObject({ code: "QUALITY_SPECIFICATION_NOT_FOUND" });
  });

  it("the SpcSubgroupSizeInvalidError class surfaces the pure module's own contract (the shared import shape)", () => {
    // The fold's own floor — re-exported through the taxonomy (the HTTP
    // face's single import); the class identity is the same object.
    expect(SpcSubgroupSizeInvalidError).toBeDefined();
    expect(QualityInputInvalidError).toBeDefined();
  });
});
