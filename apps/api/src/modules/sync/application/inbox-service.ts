import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import type { PushItemResultV2 } from "@erp/contracts";

import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-020 · the push inbox service (MASTER-PLAN §3/§6; SYNC_PROTOCOL §4
 * — inbox dedupe; CONFLICT_RESOLUTION §2). One row per EXECUTED command:
 * the (tenant, device, command_id) triple is the dedupe key (the 0029
 * UQ), the idempotency_key index covers the second lookup path (financial
 * intents always define one). DEFERRED commands are never recorded here —
 * they were not executed (0029 inbox_commands comment).
 *
 * Lookup order (SYNC_PROTOCOL §4.1): command_id match first; an
 * idempotency_key hit only when no command_id row exists. A hit replays
 * the STORED result verbatim + `duplicate: true` — never re-executes
 * (C-01/C-04). All statements ride the ambient tenant transaction
 * (requireTenantContext().tx — the same UoW as the command execution, so
 * the inbox row and the command's effects commit or roll back together).
 */

/** Stored row shape (the result jsonb column is the full item result). */
interface InboxRow {
  result: PushItemResultV2;
  processed_at: string;
}

/**
 * Find the recorded result for a previously EXECUTED command.
 * `commandId` match wins over `idempotencyKey` match (two lookups, most
 * recent `processed_at` first) — null when nothing was recorded (the
 * command is new, or was DEFERRED/gated, which never record).
 */
export async function findInboxResult(input: {
  deviceId: string;
  commandId?: string;
  idempotencyKey?: string;
}): Promise<PushItemResultV2 | null> {
  const tx = requireTenantContext().tx!;
  if (input.commandId !== undefined) {
    const byCommand = await tx.execute(sql`
      SELECT result FROM inbox_commands
      WHERE tenant_id = erp.current_tenant_id()
        AND device_id = ${input.deviceId}::uuid
        AND command_id = ${input.commandId}
      ORDER BY processed_at DESC
      LIMIT 1
    `);
    const row = (byCommand.rows as unknown as InboxRow[])[0];
    if (row !== undefined) {
      return row.result as PushItemResultV2;
    }
  }
  if (input.idempotencyKey !== undefined) {
    const byKey = await tx.execute(sql`
      SELECT result FROM inbox_commands
      WHERE tenant_id = erp.current_tenant_id()
        AND device_id = ${input.deviceId}::uuid
        AND idempotency_key = ${input.idempotencyKey}
      ORDER BY processed_at DESC
      LIMIT 1
    `);
    const row = (byKey.rows as unknown as InboxRow[])[0];
    if (row !== undefined) {
      return row.result as PushItemResultV2;
    }
  }
  return null;
}

/**
 * Record the result of an EXECUTED command (ACCEPTED or REJECTED — never
 * DEFERRED). `ON CONFLICT (tenant_id, device_id, command_id) DO NOTHING`:
 * a concurrent twin delivery that already recorded the same command leaves
 * this row untouched — the first recording wins and both deliveries replay
 * it (the dedupe guarantee; a second layer beyond the idempotency checks
 * because the ambient tx cannot be serialized per device across requests).
 */
export async function recordInboxResult(input: {
  deviceId: string;
  commandId: string;
  idempotencyKey: string;
  entityType: string;
  intent: string;
  result: PushItemResultV2;
}): Promise<void> {
  const tx = requireTenantContext().tx!;
  const status = input.result.status === "DEFERRED" ? null : input.result.status;
  if (status === null) {
    // DEFERRED results are never inbox rows (they were not executed —
    // SYNC_PROTOCOL §3.5); the guard keeps the CHECK constraint honest.
    return;
  }
  await tx.execute(sql`
    INSERT INTO inbox_commands
      (id, tenant_id, device_id, command_id, idempotency_key, entity_type,
       intent, status, result, processed_at)
    VALUES
      (${generateUuidV7()}, erp.current_tenant_id(), ${input.deviceId}::uuid,
       ${input.commandId}, ${input.idempotencyKey}, ${input.entityType},
       ${input.intent}, ${status}, ${JSON.stringify(input.result)}::jsonb, now())
    ON CONFLICT (tenant_id, device_id, command_id) DO NOTHING
  `);
}
