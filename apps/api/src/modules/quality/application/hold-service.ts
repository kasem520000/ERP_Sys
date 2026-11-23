/**
 * PHASE-050 (W-28 — T-13, 2026-11-23) THE HOLD SERVICE — the register's
 * own surface (create/list/read/release). INV-035 + BR-101 — D-07: the
 * BLOCKING side of the law is the shared gate (hold-gate.ts, wired into
 * planIssue); THIS service is the register's own management plane: the
 * create (the one-active-per-batch law's typed pre-check), the active
 * read the web banners consume (W-29), and BR-101's release (the
 * disposition-link requirement refused at the service floor, the
 * ck_release_shape DB floor beneath it).
 */
import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";

import {
  BatchHoldAlreadyActiveError,
  BatchQualityHoldNotFoundError,
  BatchQualityHoldStateError,
  HoldReleaseDispositionRequiredError,
  QualityInputInvalidError,
} from "../domain/quality-errors";
import { holdReleaseGate } from "../domain/hold-blocking";
import * as store from "../infrastructure/quality.store";

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new QualityInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

export interface CreateHoldInput {
  batchId: string;
  reason: string;
  ncrId?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class HoldService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async create(input: CreateHoldInput): Promise<store.BatchQualityHoldRow> {
    requireUuid(input.batchId, "batchId");
    if (input.reason.trim().length === 0 || input.reason.length > 2000) {
      throw new QualityInputInvalidError({
        field: "reason",
        reason: "the hold reason is required (1…2000 chars)",
      });
    }
    let ncrId: string | null = null;
    if (input.ncrId !== undefined && input.ncrId !== null && input.ncrId !== "") {
      ncrId = requireUuid(input.ncrId, "ncrId");
      // The link's typed pre-check: the NCR must be the register's OWN
      // row (the 0116 FK guarantees existence; this floor names it).
      const ncr = await store.findNcrById(ncrId);
      if (ncr === undefined) {
        throw new QualityInputInvalidError({
          field: "ncrId",
          reason: `NCR ${ncrId} does not exist in this tenant`,
        });
      }
    }
    // THE ONE-ACTIVE-PER-BATCH LAW — the typed pre-check (the 23505 on
    // the partial unique never surfaces raw).
    const active = await store.findActiveHoldByBatch(input.batchId);
    if (active !== undefined) {
      throw new BatchHoldAlreadyActiveError({ batchId: input.batchId, holdId: active.id });
    }
    const row = await store.insertBatchQualityHold({
      batchId: input.batchId,
      reason: input.reason,
      ncrId,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "quality.batch_hold_created",
      entityType: "batch_quality_hold",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { batchId: row.batchId, reason: row.reason, ncrId: row.ncrId },
    });
    return row;
  }

  async list(filter: {
    batchId?: string;
    status?: "ACTIVE" | "RELEASED";
    limit?: number;
  }): Promise<store.BatchQualityHoldRow[]> {
    return store.listBatchQualityHolds({
      batchId: filter.batchId,
      status: filter.status,
      limit: filter.limit ?? 200,
    });
  }

  /** The batch's ACTIVE hold — the web banners' own read (W-29): a
   * batch-bearing surface renders the hold banner from this shape (null
   * = no banner). */
  async findActiveByBatch(
    batchId: string,
  ): Promise<store.BatchQualityHoldRow | null> {
    requireUuid(batchId, "batchId");
    return (await store.findActiveHoldByBatch(batchId)) ?? null;
  }

  /** BR-101's release: the disposition-linked record + the note, refused
   * at the service floor naming what is missing; the CAS beneath pins
   * ACTIVE (the raced/stale move is the state error). */
  async release(input: {
    holdId: string;
    releaseNote: string;
    actorId: string | null;
  }): Promise<store.BatchQualityHoldRow> {
    requireUuid(input.holdId, "holdId");
    if (input.releaseNote.trim().length === 0 || input.releaseNote.length > 2000) {
      throw new QualityInputInvalidError({
        field: "releaseNote",
        reason: "the release note is required (1…2000 chars) — the justification record",
      });
    }
    const current = await store.findBatchQualityHoldById(input.holdId);
    if (current === undefined) {
      throw new BatchQualityHoldNotFoundError({ holdId: input.holdId });
    }
    const verdict = holdReleaseGate({
      status: current.status,
      ncrId: current.ncrId,
      releaseNote: input.releaseNote,
    });
    if (!verdict.allowed) {
      if (verdict.refusal === "NOT_ACTIVE") {
        throw new BatchQualityHoldStateError({
          holdId: input.holdId,
          status: current.status,
        });
      }
      throw new HoldReleaseDispositionRequiredError({
        holdId: input.holdId,
        missing:
          current.ncrId === null
            ? "the hold carries no NCR link"
            : "the release note is blank",
      });
    }
    const row = await store.releaseBatchQualityHold({
      id: input.holdId,
      releaseNote: input.releaseNote,
      updatedBy: input.actorId,
    });
    if (row === undefined) {
      throw new BatchQualityHoldStateError({
        holdId: input.holdId,
        status: current.status,
      });
    }
    await this.audit.record({
      action: "quality.batch_hold_released",
      entityType: "batch_quality_hold",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { batchId: row.batchId, releasedAt: row.releasedAt, releaseNote: row.releaseNote },
    });
    return row;
  }
}
