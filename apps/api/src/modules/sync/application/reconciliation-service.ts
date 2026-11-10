import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { DeviceNotFoundError } from "./device-registry-service";

/**
 * PHASE-020 · revoked-device reconciliation (T3; MASTER-PLAN §7
 * `drafts.reassign` + §12; SECURITY_AND_DEVICE_MANAGEMENT §4.4/§6.3;
 * CONFLICT_RESOLUTION §6.3).
 *
 * A revoked device may leave two kinds of unresolved state behind: server-side
 * command records the device never acknowledged (its outbox was already
 * server-rejected by policy — they are never silently dropped or executed)
 * and DRAFT documents it still owns (OWNER_DEVICE_WINS). This service lists
 * that state per tenant, transfers draft ownership server-mediated
 * (admin action, audited), and records the human "close the queue to zero"
 * dismissal so the queue can filter it out.
 */

@Injectable()
export class ReconciliationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * The reconciliation queue: revoked devices of the ambient tenant that
   * still carry unresolved state — pending inbox_commands (executed
   * server-side, never acked by the device) and DRAFT documents still owned
   * by the device. Devices dismissed by an admin (trust_flags.
   * reconciliation_dismissed) are filtered out; devices with nothing left
   * drop off the queue (the "close the queue to zero" journey).
   *
   * `oldestPendingAt` is the device's oldest inbox record (processed_at) —
   * the queue's age column.
   */
  async pendingOperations(): Promise<
    {
      deviceId: string;
      name: string | null;
      revokedAt: Date;
      pendingCommands: number;
      ownedDrafts: number;
      oldestPendingAt: Date | null;
    }[]
  > {
    const tx = requireTenantContext().tx!;
    const rows = await tx.execute(sql`
      SELECT d.id AS "deviceId", d.name, d.revoked_at AS "revokedAt",
        (SELECT count(*)::int FROM inbox_commands ic WHERE ic.device_id = d.id)
          AS "pendingCommands",
        (SELECT count(*)::int FROM sales_invoices si
           WHERE si.owner_device_id = d.id AND si.status = 'DRAFT')
          AS "ownedDrafts",
        (SELECT min(ic.processed_at) FROM inbox_commands ic WHERE ic.device_id = d.id)
          AS "oldestPendingAt"
      FROM devices d
      JOIN memberships m ON m.user_id = d.user_id
      WHERE d.revoked_at IS NOT NULL
        AND m.status = 'ACTIVE'
        AND COALESCE((d.trust_flags ->> 'reconciliation_dismissed')::boolean, false) = false
        AND (
          (SELECT count(*) FROM inbox_commands ic WHERE ic.device_id = d.id) > 0
          OR (SELECT count(*) FROM sales_invoices si
                WHERE si.owner_device_id = d.id AND si.status = 'DRAFT') > 0
        )
      ORDER BY d.revoked_at ASC
    `);
    return rows.rows as unknown as {
      deviceId: string;
      name: string | null;
      revokedAt: Date;
      pendingCommands: number;
      ownedDrafts: number;
      oldestPendingAt: Date | null;
    }[];
  }

  /**
   * Transfer DRAFT ownership from one device to another (server-mediated —
   * MASTER-PLAN §7 `drafts.reassign`; the admin reassign route re-stamps
   * owner_device_id). Only DRAFT rows move; POSTED/approved documents keep
   * their historical owner. Audited with the moved count.
   */
  async reassignDrafts(input: {
    actorId: string;
    fromDeviceId: string;
    toDeviceId: string;
  }): Promise<{ count: number }> {
    const tx = requireTenantContext().tx!;
    const moved = await tx.execute(sql`
      UPDATE sales_invoices SET owner_device_id = ${input.toDeviceId}, updated_at = now(),
             version = version + 1
      WHERE owner_device_id = ${input.fromDeviceId} AND status = 'DRAFT'
      RETURNING id
    `);
    const count = moved.rows.length;
    await this.audit.record({
      action: "sync.draft_reassigned",
      entityType: "sync_reconciliation",
      entityId: input.fromDeviceId,
      actorId: input.actorId,
      after: { fromDeviceId: input.fromDeviceId, toDeviceId: input.toDeviceId, count },
    });
    return { count };
  }

  /**
   * Dismiss a revoked device from the queue (the admin's explicit "close the
   * queue to zero" action): stamps trust_flags.reconciliation_dismissed so
   * the queue filters it, audited as the human decision. The underlying
   * state is never silently dropped — the flag is a review marker.
   */
  async dismissDevice(input: { actorId: string; deviceId: string }): Promise<void> {
    const tx = requireTenantContext().tx!;
    const updated = await tx.execute(sql`
      UPDATE devices
      SET trust_flags = trust_flags || '{"reconciliation_dismissed": true}'::jsonb,
          updated_at = now(), version = version + 1
      WHERE id = ${input.deviceId}
      RETURNING id
    `);
    if (updated.rows.length === 0) {
      throw new DeviceNotFoundError(input.deviceId);
    }
    await this.audit.record({
      action: "sync.reconciliation_dismissed",
      entityType: "sync_reconciliation",
      entityId: input.deviceId,
      actorId: input.actorId,
      after: { deviceId: input.deviceId, dismissed: true },
    });
  }
}
