/**
 * PHASE-041 (T-08 · UX-14/IN-16) — the unified inbox: the per-partner
 * interaction timeline (messages + logged calls) over communication_log
 * with filters, and the basic call logging (manual entries with outcome +
 * duration linked to partners and users — voice/VOIP calling itself is out
 * of scope by the phase doc).
 *
 * Outbound partner-facing messages project into the log at enqueue time
 * (the outbox service's projection — T-05); inbound messages can be
 * recorded by future channels; calls arrive here as manual entries.
 */

import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { CallLogInvalidError } from "../domain/communication-errors";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("unified inbox access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface InboxEntry {
  readonly id: string;
  readonly kind: "MESSAGE" | "CALL";
  readonly direction: "INBOUND" | "OUTBOUND";
  readonly channel: string;
  readonly at: string;
  readonly partnerId: string | null;
  readonly userId: string | null;
  readonly counterparty: string | null;
  readonly summary: string | null;
  readonly body: string | null;
  readonly outcome: string | null;
  readonly durationMinutes: number | null;
  readonly outboundMessageId: string | null;
  readonly relatedType: string | null;
  readonly relatedId: string | null;
  readonly createdBy: string | null;
}

export interface InboxFilter {
  readonly partnerId?: string;
  readonly kind?: string;
  readonly channel?: string;
  readonly direction?: string;
  readonly fromAt?: string;
  readonly toAt?: string;
  readonly limit?: number;
}

const LOG_COLUMNS = sql`id, kind, direction, channel, at, partner_id AS "partnerId",
  user_id AS "userId", counterparty, summary, body, outcome,
  duration_minutes AS "durationMinutes", outbound_message_id AS "outboundMessageId",
  related_type AS "relatedType", related_id AS "relatedId", created_by AS "createdBy"`;

export class UnifiedInboxService {
  /** The timeline query (partner-scoped or tenant-wide) with filters. */
  async list(filter: InboxFilter = {}): Promise<readonly InboxEntry[]> {
    const tx = tenantTx();
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const rows = await tx.execute(sql`
      SELECT ${LOG_COLUMNS} FROM communication_log
      WHERE (${filter.partnerId ?? null}::uuid IS NULL OR partner_id = ${filter.partnerId ?? null}::uuid)
        AND (${filter.kind ?? null}::text IS NULL OR kind = ${filter.kind ?? null}::text)
        AND (${filter.channel ?? null}::text IS NULL OR channel = ${filter.channel ?? null}::text)
        AND (${filter.direction ?? null}::text IS NULL OR direction = ${filter.direction ?? null}::text)
        AND (${filter.fromAt ?? null}::timestamptz IS NULL OR at >= ${filter.fromAt ?? null}::timestamptz)
        AND (${filter.toAt ?? null}::timestamptz IS NULL OR at <= ${filter.toAt ?? null}::timestamptz)
      ORDER BY at DESC LIMIT ${limit}`);
    return rows.rows as unknown as InboxEntry[];
  }

  /**
   * Log a call (IN-16): a manual entry with outcome + optional duration
   * linked to the partner and the logging user. The polymorphic document
   * link (relatedType/relatedId) connects the call to an invoice/task/
   * contract when relevant.
   */
  async logCall(input: {
    actorId: string;
    partnerId: string;
    at?: string;
    direction: "INBOUND" | "OUTBOUND";
    outcome: "COMPLETED" | "NO_ANSWER" | "BUSY" | "VOICEMAIL" | "FAILED" | "SCHEDULED";
    summary: string;
    body?: string | null;
    durationMinutes?: number | null;
    relatedType?: string | null;
    relatedId?: string | null;
  }): Promise<InboxEntry> {
    if (input.summary.trim().length === 0 || input.summary.length > 300) {
      throw new CallLogInvalidError("summary must be 1..300 chars");
    }
    if (input.durationMinutes !== undefined && input.durationMinutes !== null) {
      if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 0 || input.durationMinutes > 1440) {
        throw new CallLogInvalidError("durationMinutes must be an integer 0..1440");
      }
    }
    if ((input.relatedType === null) !== (input.relatedId === null)) {
      throw new CallLogInvalidError("relatedType and relatedId travel together");
    }
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      INSERT INTO communication_log
        (id, tenant_id, kind, direction, channel, at, partner_id, user_id,
         summary, body, outcome, duration_minutes, related_type, related_id, created_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), 'CALL', ${input.direction}, 'CALL',
              ${input.at ?? sql`now()`}, ${input.partnerId}, ${input.actorId},
              ${input.summary}, ${input.body ?? null}, ${input.outcome},
              ${input.durationMinutes ?? null},
              ${input.relatedType ?? null}, ${input.relatedId ?? null}, ${input.actorId})
      RETURNING ${LOG_COLUMNS}`);
    return (rows.rows as unknown as InboxEntry[])[0]!;
  }

  /** The logger edits their own entry (log semantics — no deletes). */
  async updateCall(
    entryId: string,
    actorId: string,
    patch: {
      outcome?: string;
      summary?: string;
      body?: string | null;
      durationMinutes?: number | null;
    },
  ): Promise<InboxEntry> {
    if (patch.summary !== undefined && (patch.summary.trim().length === 0 || patch.summary.length > 300)) {
      throw new CallLogInvalidError("summary must be 1..300 chars");
    }
    if (
      patch.durationMinutes !== undefined &&
      patch.durationMinutes !== null &&
      (!Number.isInteger(patch.durationMinutes) ||
        patch.durationMinutes < 0 ||
        patch.durationMinutes > 1440)
    ) {
      throw new CallLogInvalidError("durationMinutes must be an integer 0..1440");
    }
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      UPDATE communication_log SET
        outcome = COALESCE(${patch.outcome ?? null}::text, outcome),
        summary = COALESCE(${patch.summary ?? null}::text, summary),
        body = COALESCE(${patch.body ?? null}::text, body),
        duration_minutes = COALESCE(${patch.durationMinutes ?? null}::int, duration_minutes),
        updated_at = now(), version = communication_log.version + 1
      WHERE id = ${entryId} AND kind = 'CALL' AND created_by = ${actorId}
      RETURNING ${LOG_COLUMNS}`);
    const row = (rows.rows as unknown as InboxEntry[])[0];
    if (row === undefined) {
      throw new CallLogInvalidError(
        `no call entry ${entryId} authored by the caller (entries are editable by their logger only)`,
      );
    }
    return row;
  }
}
