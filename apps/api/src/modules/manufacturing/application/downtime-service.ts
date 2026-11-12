import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  RESOLVE_EFFECTIVE_CONFIG_SERVICE,
  ResolveEffectiveConfigService,
} from "../../configuration/application/resolve/resolve-service";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/manufacturing.store";
import type { DowntimeRecordRow } from "../infrastructure/manufacturing.store";
import {
  DowntimeAlreadyClosedError,
  DowntimeInputInvalidError,
  DowntimeRecordNotFoundError,
  OperationNotFoundError,
  ProductionOrderNotFoundError,
  WorkCenterNotFoundError,
} from "../domain/manufacturing-errors";

/**
 * Downtime service (PHASE-042 M-15): reason-coded downtime records per work
 * center — the OEE availability input and the non-value-added cost source.
 * The closed reason vocabulary (the 0065 CHECK floor) is mirrored here so a
 * bad reason is the typed 422 before any SQL.
 *
 * Posting is POLICY-GATED (BR-070): the enum policy manufacturing.downtime_
 * posting (settingsKey manufacturing.downtime_posting) defaults "off" —
 * record-only: the closed row carries ended_at + duration but cost_amount
 * and journal_id stay NULL (the ck_downtime_records_window CHECK floor).
 * With "post" the CLOSE computes
 *   cost = round4(durationMinutes/60 × (fixed_rate + var_rate))
 * and posts G-42 (source downtime_record, operation "close"):
 *   DR DOWNTIME_EXPENSE cost · CR PRODUCTION_OVERHEAD cost
 * — the credit side is applied overhead (idle capacity absorbed against
 * applied overhead): the capacity was planned INTO the overhead rate, so
 * unearned absorption leaves through the same purpose. This choice is
 * documented in the service + the JOURNAL_RULES row text (subagent C).
 *
 * The log is append-shaped: log() may create the record already closed
 * (endedAt + durationMinutes given — the same close semantics apply
 * immediately); close() finalizes an open record; a closed record never
 * re-opens (corrections are new records).
 */

const REASONS = [
  "PLAN_SETUP",
  "BREAKDOWN",
  "MAINTENANCE",
  "MATERIAL_SHORTAGE",
  "QUALITY_HOLD",
  "POWER_OUTAGE",
  "CHANGEOVER",
  "OPERATOR_ABSENT",
  "OTHER",
] as const;

type DowntimeReason = (typeof REASONS)[number];

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function round4(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export interface LogDowntimeInput {
  workCenterId: string;
  reasonCode: DowntimeReason;
  startedAt: string;
  /** Required (0..1440): 0 for an open record — finalized at close. */
  durationMinutes: number;
  endedAt?: string | null;
  orderId?: string | null;
  operationSequence?: number | null;
  note?: string | null;
  actorId: string | null;
}

@Injectable()
export class DowntimeService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: every param carries an explicit @Inject (the vitest/esbuild
    // pipeline does not emit design:paramtypes — the T-13 boot lesson).
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(RESOLVE_EFFECTIVE_CONFIG_SERVICE)
    private readonly resolveConfig: ResolveEffectiveConfigService,
  ) {}

  // -- reads -------------------------------------------------------------------

  async list(filter: {
    workCenterId?: string;
    orderId?: string;
    from?: string;
    to?: string;
    limit: number;
  }): Promise<DowntimeRecordRow[]> {
    return store.listDowntimeRecords(filter);
  }

  async find(id: string): Promise<DowntimeRecordRow> {
    const record = await store.findDowntimeRecordById(id);
    if (record === undefined) throw new DowntimeRecordNotFoundError(id);
    return record;
  }

  // -- log (insert; open or already-closed) ----------------------------------------

  async log(input: LogDowntimeInput): Promise<DowntimeRecordRow> {
    const workCenter = await store.findWorkCenterById(input.workCenterId);
    if (workCenter === undefined) throw new WorkCenterNotFoundError(input.workCenterId);
    if (!REASONS.includes(input.reasonCode)) {
      throw new DowntimeInputInvalidError(
        `reasonCode must be one of ${REASONS.join("/")} — got ${String(input.reasonCode)}`,
      );
    }
    this.assertTimestamp(input.startedAt, "startedAt");
    const durationMinutes = this.canonicalDuration(input.durationMinutes);
    let endedAt: string | null = null;
    if (input.endedAt != null) {
      this.assertTimestamp(input.endedAt, "endedAt");
      this.assertEndAfterStart(input.startedAt, input.endedAt);
      endedAt = input.endedAt;
    }
    // The (order, sequence) pair or neither — the link-shape CHECK floor.
    if ((input.orderId ?? null) !== null || (input.operationSequence ?? null) !== null) {
      if ((input.orderId ?? null) === null || (input.operationSequence ?? null) === null) {
        throw new DowntimeInputInvalidError(
          "the order link is the (orderId, operationSequence) pair or neither",
        );
      }
      const order = await store.findProductionOrderById(input.orderId!);
      if (order === undefined) throw new ProductionOrderNotFoundError(input.orderId!);
      const op = await store.findProductionOrderOperation(input.orderId!, input.operationSequence!);
      if (op === undefined) throw new OperationNotFoundError(input.orderId!, input.operationSequence!);
    }
    const created = await store.insertDowntimeRecord({
      workCenterId: input.workCenterId,
      orderId: input.orderId ?? null,
      operationSequence: input.operationSequence ?? null,
      reasonCode: input.reasonCode,
      startedAt: input.startedAt,
      endedAt,
      durationMinutes,
      note: input.note ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "manufacturing.downtime.logged",
      entityType: "downtime_record",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        workCenterId: input.workCenterId,
        reasonCode: input.reasonCode,
        startedAt: input.startedAt,
        endedAt,
        durationMinutes,
        orderId: input.orderId ?? null,
        operationSequence: input.operationSequence ?? null,
      },
    });
    if (endedAt !== null) {
      // Created closed — the close semantics apply immediately.
      return this.applyClose(created, input.actorId);
    }
    return created;
  }

  // -- close (sets ended + duration; posts G-42 when the policy says so) -------------

  async close(
    id: string,
    input: { endedAt: string; durationMinutes: number; actorId: string | null },
  ): Promise<DowntimeRecordRow> {
    const record = await this.find(id);
    if (record.endedAt !== null) throw new DowntimeAlreadyClosedError(id);
    this.assertTimestamp(input.endedAt, "endedAt");
    this.assertEndAfterStart(record.startedAt, input.endedAt);
    const durationMinutes = this.canonicalDuration(input.durationMinutes);
    await store.patchDowntimeRecord({ id, endedAt: input.endedAt, durationMinutes });
    await this.audit.record({
      action: "manufacturing.downtime.closed",
      entityType: "downtime_record",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { endedAt: input.endedAt, durationMinutes },
    });
    return this.applyClose(await this.find(id), input.actorId);
  }

  /** The policy seam: BR-070's manufacturing.downtime_posting enum ("off" |
   * "post", default "off") off the resolved effective config — the same
   * config.policies seam production-order-service reads. */
  private async downtimePostingPolicy(): Promise<"off" | "post"> {
    const tenantId = requireTenantContext().tenantId;
    const config = await this.resolveConfig.resolveTenantStatic(tenantId);
    return config.policies["manufacturing.downtime_posting"] === "post" ? "post" : "off";
  }

  /** Post-close path: compute + post when the policy is "post"; record-only
   * otherwise (cost/journal stay NULL — the CHECK floor). */
  private async applyClose(record: DowntimeRecordRow, actorId: string | null): Promise<DowntimeRecordRow> {
    if ((await this.downtimePostingPolicy()) !== "post") return record;
    const workCenter = await store.findWorkCenterById(record.workCenterId);
    if (workCenter === undefined) throw new WorkCenterNotFoundError(record.workCenterId);
    // cost = round4(duration/60 × (fixed + var)) — idle capacity at the
    // center's full hourly rate.
    const cost = round4(
      new Decimal(record.durationMinutes)
        .div(60)
        .times(new Decimal(workCenter.fixedCostRate).plus(new Decimal(workCenter.varCostRate))),
    ).toFixed(4);
    if (new Decimal(cost).lessThanOrEqualTo(0)) {
      // An uncosted center stays record-only — a zero-value journal cannot
      // post (the honest floor).
      return record;
    }
    const spec: JournalSpec = {
      source: { docType: "downtime_record", docId: record.id, operation: "close" },
      entryDate: (record.endedAt ?? record.startedAt).slice(0, 10),
      description: {
        en: `Work center ${workCenter.code} — downtime (${record.reasonCode}, ${record.durationMinutes} min)`,
        ar: `مركز عمل ${workCenter.code} — توقف (${record.reasonCode}، ${record.durationMinutes} دقيقة)`,
      },
      currency: await ownTenantBaseCurrency(),
      lines: [
        {
          purpose: "DOWNTIME_EXPENSE",
          direction: "DEBIT",
          amount: cost,
          memo: {
            en: `Work center ${workCenter.code} — idle capacity (${record.reasonCode})`,
            ar: `مركز عمل ${workCenter.code} — طاقة معطّلة (${record.reasonCode})`,
          },
        },
        {
          purpose: "PRODUCTION_OVERHEAD",
          direction: "CREDIT",
          amount: cost,
          memo: {
            en: `Work center ${workCenter.code} — idle capacity absorbed against applied overhead`,
            ar: `مركز عمل ${workCenter.code} — امتصاص الطاقة المعطّلة من المصاريف المطبقة`,
          },
        },
      ],
    };
    const posted = await this.posting.post(spec, { postedBy: actorId });
    await store.patchDowntimeRecord({ id: record.id, costAmount: cost, journalId: posted.journalEntryId });
    await this.audit.record({
      action: "manufacturing.downtime.cost_posted",
      entityType: "downtime_record",
      entityId: record.id,
      actorId: actorId ?? undefined,
      after: { costAmount: cost, journalEntryId: posted.journalEntryId, policy: "post" },
    });
    return this.find(record.id);
  }

  // -- validation helpers ------------------------------------------------------------

  private canonicalDuration(raw: number): number {
    if (!Number.isInteger(raw) || raw < 0 || raw > 1440) {
      throw new DowntimeInputInvalidError(`durationMinutes must be an integer 0..1440 — got ${raw}`);
    }
    return raw;
  }

  private assertTimestamp(value: string, what: string): void {
    if (!TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
      throw new DowntimeInputInvalidError(`${what} must be an ISO date or timestamp: ${value}`);
    }
  }

  private assertEndAfterStart(startedAt: string, endedAt: string): void {
    if (Date.parse(endedAt) < Date.parse(startedAt)) {
      throw new DowntimeInputInvalidError(`endedAt (${endedAt}) is before startedAt (${startedAt})`);
    }
  }
}
