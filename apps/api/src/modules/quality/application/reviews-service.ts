import { Inject, Injectable } from "@nestjs/common";

import { NumberingService } from "../../accounting/application/numbering-service";
import { AuditService } from "../../audit/api/audit";

import {
  ManagementReviewNotFoundError,
  QualityInputInvalidError,
} from "../domain/quality-errors";
import { SpcInsufficientSamplesError } from "../domain/spc-statistics";
import * as store from "../infrastructure/quality.store";
import { SpcService } from "./spc-service";

/**
 * PHASE-050 (W-30 — T-16, 2026-11-23) THE MANAGEMENT REVIEW SERVICE —
 * Q-10 (D-15): the meeting RECORD. THE FROZEN INDICATOR PACK is the
 * wave's own law: at create the service reads the CURRENT status counts
 * through the module's OWN store reads (the NCR/CAPA/complaint registers'
 * GROUP BY counts, the sample store's volume — one simple count query
 * each) and the SPC out-of-control chart count through the ENGINE'S OWN
 * chart read (SpcService.chart — the PURE module's output VERBATIM, the
 * spc-service docblock's declared "report pack W-30" consumer surface;
 * zero recomputation, zero parallel computation), then FREEZES the pack
 * into the row's indicator_pack jsonb — a later engine state NEVER moves
 * a stored pack (the record is the review's own evidence; the register
 * carries no update path by design, the 0116 evidence discipline).
 *
 * The decisions land as a jsonb array (the meeting's outputs); the
 * official number rides the treasury {PREFIX}-{YYYY}-{SEQ:6} convention
 * (INV-021/ADR-0006 — the NCR/CMP/REC precedent: numbering.reserve +
 * bind, the same ambient transaction).
 */

/** Official management review numbers (INV-021/ADR-0006; the treasury
 * {PREFIX}-{YYYY}-{SEQ:6} convention — the NCR/CMP/REC precedent). */
export const MANAGEMENT_REVIEW_NUMBER_FORMAT = {
  prefix: "MRV",
  format: "MRV-{YYYY}-{SEQ:6}",
  docType: "management_review",
} as const;

/** The per-spec chart read's own sample cap (the engine's own default —
 * the newest 100 samples feed the fold, the same window the chart
 * surface renders). */
const CHART_SAMPLE_LIMIT = 100;

/** The SPC leg's honest shape: the ACTIVE specs read through the
 * register's own list (bounded by the store's 500 cap), each spec's
 * LATEST chart through the engine's own read — a spec with fewer
 * samples than the subgroup size has NO chart yet (the fold's own
 * input floor — not out-of-control, skipped); the count is the number
 * of charts the ENGINE itself flags outOfControl. */
async function spcChartCounts(spc: SpcService): Promise<{
  activeSpecs: number;
  outOfControlCharts: number;
}> {
  const specs = await store.listQualitySpecs({ activeOnly: true, limit: 500 });
  let outOfControlCharts = 0;
  for (const spec of specs) {
    try {
      const { chart } = await spc.chart(spec.id, { limit: CHART_SAMPLE_LIMIT });
      if (chart.outOfControl) outOfControlCharts += 1;
    } catch (error) {
      if (error instanceof SpcInsufficientSamplesError) continue;
      throw error;
    }
  }
  return { activeSpecs: specs.length, outOfControlCharts };
}

export interface CreateManagementReviewInput {
  /** The meeting's date/time (ISO datetime — held_at). */
  meetingDate: string;
  title?: string;
  attendees?: string[];
  decisions: string[];
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class ManagementReviewsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(SpcService) private readonly spc: SpcService,
  ) {}

  async create(input: CreateManagementReviewInput): Promise<store.ManagementReviewRow> {
    if (Number.isNaN(Date.parse(input.meetingDate))) {
      throw new QualityInputInvalidError({
        field: "meetingDate",
        reason: `the meeting date must be an ISO datetime: ${input.meetingDate}`,
      });
    }
    const title = input.title?.trim() ?? "";
    if (title.length > 500) {
      throw new QualityInputInvalidError({
        field: "title",
        reason: "the review title is at most 500 chars",
      });
    }
    const attendees = input.attendees ?? [];
    if (attendees.length > 100 || attendees.some((entry) => entry.trim().length === 0 || entry.length > 200)) {
      throw new QualityInputInvalidError({
        field: "attendees",
        reason: "attendees are optional strings (1…200 chars each, at most 100 entries)",
      });
    }
    if (input.decisions.length === 0 || input.decisions.length > 100) {
      throw new QualityInputInvalidError({
        field: "decisions",
        reason: "the review carries its decisions (1…100 entries — the record is the decisions' own home)",
      });
    }
    if (input.decisions.some((entry) => entry.trim().length === 0 || entry.length > 2000)) {
      throw new QualityInputInvalidError({
        field: "decisions",
        reason: "every decision is a non-blank string (1…2000 chars)",
      });
    }
    // THE INDICATOR PACK (D-15: the engines' own reads, zero
    // recomputation) — read in the SAME ambient transaction that lands
    // the row, then frozen verbatim.
    const indicatorPack: store.ReviewIndicatorPack = {
      ncrsByStatus: await store.countNcrsByStatus(),
      capasByStatus: await store.countCapasByStatus(),
      complaintsByStatus: await store.countComplaintsByStatus(),
      spc: {
        ...(await spcChartCounts(this.spc)),
        measurements: await store.countSpcMeasurements(),
      },
    };
    // The number's year is the MEETING's own year (the document names the
    // review it records — the NCR/CMP/REC precedent's current-year anchor
    // is those documents' own creation-time law; a review's anchor is its
    // held-at date, the declared W-30 interpretation).
    const year = String(new Date(input.meetingDate).getUTCFullYear());
    const acquired = await this.numbering.reserve({
      docType: MANAGEMENT_REVIEW_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: MANAGEMENT_REVIEW_NUMBER_FORMAT.format,
      prefix: MANAGEMENT_REVIEW_NUMBER_FORMAT.prefix,
      year,
    });
    const row = await store.insertManagementReview({
      reviewNo: acquired.number,
      title: title.length > 0 ? title : `Management Review ${input.meetingDate.slice(0, 10)}`,
      heldAt: input.meetingDate,
      attendees,
      indicatorPack,
      decisions: input.decisions,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.numbering.bind(MANAGEMENT_REVIEW_NUMBER_FORMAT.docType, acquired.number, row.id);
    await this.audit.record({
      action: "quality.management_review_created",
      entityType: "quality_management_review",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        reviewNo: row.reviewNo,
        heldAt: row.heldAt,
        decisions: row.decisions.length,
      },
    });
    return row;
  }

  async list(filter: { limit?: number } = {}): Promise<store.ManagementReviewRow[]> {
    return store.listManagementReviews({ limit: filter.limit ?? 200 });
  }

  async find(id: string): Promise<store.ManagementReviewRow> {
    const row = await store.findManagementReviewById(id);
    if (row === undefined) throw new ManagementReviewNotFoundError({ reviewId: id });
    return row;
  }
}
