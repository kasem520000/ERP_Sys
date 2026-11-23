import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { findBatchById } from "../../inventory/infrastructure/inventory.store";

import * as store from "../infrastructure/quality.store";
import { computeXbarRChart, SpcSubgroupSizeInvalidError, type XbarRChart } from "../domain/spc-statistics";
import { QualityInputInvalidError, QualitySpecificationNotFoundError } from "../domain/quality-errors";

/**
 * PHASE-050 (W-27 — T-09, 2026-11-23) THE SPC SERVICE (Q-04, D-12): the
 * sample store's ingestion surface + the computed X-bar/R chart read.
 *
 * THE ZERO-PARALLEL-COMPUTATION LAW (D-12's own core): the chart is the
 * PURE module's output VERBATIM — this service reads the samples,
 * reverses them to time order, feeds `computeXbarRChart`, and returns
 * its result untouched; no consumer (surface API, web chart W-29,
 * report pack W-30) ever recomputes a limit, a mean, or a flag.
 *
 * THE SAMPLES' PROVENANCE (0113's own design): the measurements draw
 * from the specifications' parameters (the spec_id FK is the ONLY
 * parameter source — no parallel parameter register exists); the
 * optional batch link carries the sample's provenance on the existing
 * batch ledger (validated through the inventory store's own read); the
 * source vocabulary (MANUAL/PRODUCTION/INSPECTION) is the 0113 CHECK's
 * own domain, refused typed at this floor. Evidence discipline: the
 * store carries NO DELETE — corrections are new samples, never
 * rewrites; a negative value is LEGAL (a temperature can be −5 — the
 * no-fabrication law cuts both ways).
 */

const SPC_SOURCES = ["MANUAL", "PRODUCTION", "INSPECTION"] as const;

export interface RecordSpcMeasurementInput {
  specId: string;
  value: string;
  sampledAt: string;
  source?: string;
  batchId?: string | null;
  note?: string | null;
  actorId: string | null;
}

/** The chart read's own response — the spec row (the band's own home),
 * the pure module's output VERBATIM, and the sample count. */
export interface SpcChartResponse {
  spec: store.QualitySpecRow;
  chart: XbarRChart;
  sampleCount: number;
}

@Injectable()
export class SpcService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async record(input: RecordSpcMeasurementInput): Promise<store.SpcMeasurementRow> {
    const spec = await store.findQualitySpecById(input.specId);
    if (spec === undefined) {
      throw new QualitySpecificationNotFoundError({ specificationId: input.specId });
    }
    // The value floor: a parseable finite decimal at ≤ 6dp (the 0113
    // column's own shape; negatives legal — the physical domains own
    // their signs, the module never fabricates a floor).
    let value: Decimal;
    try {
      value = new Decimal(input.value);
    } catch {
      throw new QualityInputInvalidError({
        field: "value",
        reason: `the measured value must be a decimal at most 6dp: ${input.value}`,
      });
    }
    if (!value.isFinite() || value.decimalPlaces() > 6) {
      throw new QualityInputInvalidError({
        field: "value",
        reason: `the measured value must be a finite decimal at most 6dp: ${input.value}`,
      });
    }
    const source = input.source ?? "MANUAL";
    if (!(SPC_SOURCES as readonly string[]).includes(source)) {
      throw new QualityInputInvalidError({
        field: "source",
        reason: `source must be one of ${SPC_SOURCES.join("/")}: ${source}`,
      });
    }
    const batchId = input.batchId ?? null;
    if (batchId !== null) {
      const batch = await findBatchById(batchId);
      if (batch === undefined) {
        throw new QualityInputInvalidError({
          field: "batchId",
          reason: `batch ${batchId} does not exist in this tenant`,
        });
      }
    }
    const row = await store.insertSpcMeasurement({
      specId: input.specId,
      value: input.value,
      sampledAt: input.sampledAt,
      source,
      batchId,
      note: input.note ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "quality.spc_measurement_recorded",
      entityType: "spc_measurement",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { specId: row.specId, value: row.value, sampledAt: row.sampledAt, source: row.source },
    });
    return row;
  }

  async listMeasurements(filter: {
    specId?: string;
    batchId?: string;
    limit?: number;
  }): Promise<store.SpcMeasurementRow[]> {
    const limit = filter.limit ?? 200;
    if (filter.specId !== undefined) {
      const rows = await store.listSpcMeasurements({ specId: filter.specId, limit });
      return rows;
    }
    if (filter.batchId !== undefined) {
      return store.listSpcMeasurementsByBatch({ batchId: filter.batchId, limit });
    }
    throw new QualityInputInvalidError({
      field: "specId",
      reason: "the measurement list requires specId (or batchId for the provenance read)",
    });
  }

  /**
   * THE CHART READ: the newest `limit` samples of the spec's parameter,
   * fed to the PURE module in time order — its output returned VERBATIM.
   */
  async chart(
    specId: string,
    options: { subgroupSize?: number; limit?: number } = {},
  ): Promise<SpcChartResponse> {
    const subgroupSize = options.subgroupSize ?? 5;
    if (!Number.isInteger(subgroupSize)) {
      throw new SpcSubgroupSizeInvalidError(subgroupSize);
    }
    const spec = await store.findQualitySpecById(specId);
    if (spec === undefined) {
      throw new QualitySpecificationNotFoundError({ specificationId: specId });
    }
    const limit = Math.min(options.limit ?? 100, 500);
    const newest = await store.listSpcMeasurements({ specId, limit });
    const timeOrdered = [...newest].reverse();
    const chart = computeXbarRChart({
      values: timeOrdered.map((row) => row.value),
      subgroupSize,
      band: { ucl: spec.ucl, lcl: spec.lcl },
    });
    return { spec, chart, sampleCount: timeOrdered.length };
  }
}
