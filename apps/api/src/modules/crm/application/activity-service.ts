import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/crm.store";
import { ActivityInputInvalidError } from "../domain/crm-errors";
import { assertRelatedTarget, isRelatedType } from "./related-target";

/**
 * Activity service (PHASE-019 T45; MASTER-PLAN §3): logged past
 * interactions (CALL|MEETING|EMAIL|NOTE) anchored to a
 * LEAD|PARTNER|CONTRACT|SERVICE_ORDER record — the timeline substrate.
 * Activities are append-only history (no edit, no delete route); the
 * timeline read orders by occurredAt DESC. No ledger effects.
 */

const ACTIVITY_KINDS = ["CALL", "MEETING", "EMAIL", "NOTE"] as const;
type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface CreateActivityInput {
  kind: string;
  relatedType: string;
  relatedId: string;
  occurredAt: string;
  summary: string;
  durationMinutes: number | null;
  actorUserId: string | null;
  createdBy: string | null;
}

@Injectable()
export class ActivityService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async create(input: CreateActivityInput): Promise<store.ActivityRow> {
    const kind = input.kind as ActivityKind;
    if (!(ACTIVITY_KINDS as readonly string[]).includes(input.kind)) {
      throw new ActivityInputInvalidError(
        `kind must be CALL, MEETING, EMAIL or NOTE (got ${input.kind})`,
      );
    }
    if (!isRelatedType(input.relatedType)) {
      throw new ActivityInputInvalidError(
        `relatedType must be LEAD, PARTNER, CONTRACT or SERVICE_ORDER (got ${input.relatedType})`,
      );
    }
    if (Number.isNaN(Date.parse(input.occurredAt))) {
      throw new ActivityInputInvalidError(`occurredAt must be an ISO timestamp: ${input.occurredAt}`);
    }
    const summary = input.summary.trim();
    if (summary.length < 1 || summary.length > 2000) {
      throw new ActivityInputInvalidError("summary is required (1..2000 characters)");
    }
    if (input.durationMinutes !== null && (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 0)) {
      throw new ActivityInputInvalidError("durationMinutes must be a non-negative integer (minutes)");
    }
    await assertRelatedTarget(input.relatedType, input.relatedId);
    const activity = await store.insertActivity({
      kind,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      occurredAt: input.occurredAt,
      summary,
      durationMinutes: input.durationMinutes,
      actorUserId: input.actorUserId,
      createdBy: input.createdBy,
    });
    await this.audit.record({
      action: "crm.activity.logged",
      entityType: "crm_activity",
      entityId: activity.id,
      actorId: input.createdBy ?? undefined,
      after: {
        kind: activity.kind,
        relatedType: activity.relatedType,
        relatedId: activity.relatedId,
        occurredAt: activity.occurredAt,
      },
    });
    return activity;
  }

  /** The timeline read (§3): one related record's activities, newest first. */
  async list(filter: {
    relatedType?: string;
    relatedId?: string;
    limit: number;
  }): Promise<store.ActivityRow[]> {
    return store.listActivities(filter);
  }
}
