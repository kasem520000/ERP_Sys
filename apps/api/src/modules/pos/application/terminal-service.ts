import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/pos.store";
import {
  PosTerminalCodeTakenError,
  PosTerminalDeviceBoundError,
  PosTerminalNotFoundError,
  PosTerminalTillInvalidError,
} from "../domain/pos-errors";

/**
 * Terminal registry service (PHASE-016 T2): admin CRUD + the
 * activate/deactivate lifecycle + manual `pos-terminal` device enrollment
 * (SYNC_PROTOCOL §11 — attestation-lite optional at this phase, one
 * terminal = one device). The till binding validates through the
 * treasury store (CASH + ACTIVE) — the pos module never writes treasury
 * rows, it only references them.
 */
@Injectable()
export class PosTerminalService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: { branchId?: string; status?: string; limit?: number }) {
    return store.listTerminals({
      branchId: filter.branchId,
      status: filter.status,
      limit: Math.min(filter.limit ?? 100, 500),
    });
  }

  async find(id: string) {
    const terminal = await store.findTerminalById(id);
    if (terminal === undefined) throw new PosTerminalNotFoundError(id);
    return terminal;
  }

  async register(input: {
    code: string;
    name: string;
    nameAr: string | null;
    branchId: string;
    cashAccountId: string;
    warehouseId: string | null;
    receiptSize: "80mm" | "58mm";
    actorId: string | null;
  }) {
    const existing = await store.findTerminalByCode(input.code);
    if (existing !== undefined) throw new PosTerminalCodeTakenError(input.code);

    // The till must be an ACTIVE CASH account (the shift/BR-021 substrate).
    const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
    const till = await treasuryStore.findCashAccountById(input.cashAccountId);
    if (till === undefined) {
      throw new PosTerminalTillInvalidError(`cash account ${input.cashAccountId} does not exist`);
    }
    if (till.type !== "CASH") {
      throw new PosTerminalTillInvalidError(
        `terminal tills must be CASH accounts — ${till.name} is ${till.type}`,
      );
    }
    if (till.status !== "ACTIVE") {
      throw new PosTerminalTillInvalidError(`cash account ${till.name} is ${till.status}`);
    }

    const terminal = await store.insertTerminal({ ...input, createdBy: input.actorId });
    await this.audit.record({
      action: "pos.terminal_registered",
      entityType: "pos_terminal",
      entityId: terminal.id,
      actorId: input.actorId ?? undefined,
      after: { code: terminal.code, branchId: terminal.branchId, tillId: terminal.cashAccountId },
    });
    return terminal;
  }

  async setStatus(input: { id: string; status: "ACTIVE" | "INACTIVE"; actorId: string | null }) {
    await this.find(input.id);
    const terminal = await store.updateTerminalStatus(input);
    await this.audit.record({
      action: input.status === "ACTIVE" ? "pos.terminal_activated" : "pos.terminal_deactivated",
      entityType: "pos_terminal",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      after: { status: input.status },
    });
    return terminal;
  }

  async setQuickKeys(input: {
    id: string;
    quickKeys: Record<string, unknown>;
    actorId: string | null;
  }) {
    await this.find(input.id);
    return store.updateQuickKeys({ terminalId: input.id, quickKeys: input.quickKeys });
  }

  /**
   * Enroll a `pos-terminal` device manually (SYNC_PROTOCOL §1 narrow
   * slice): the admin authenticates, the device row binds to the terminal
   * (one terminal = one device — a bound device is refused elsewhere), and
   * the terminal gains the device link. The device key is hashed
   * server-side; the terminal presents it on pull/push (full device-token
   * rotation is the PHASE-020 registry).
   */
  async enrollDevice(input: {
    terminalId: string;
    deviceName: string;
    deviceKey: string;
    actorId: string | null;
  }) {
    const terminal = await this.find(input.terminalId);
    if (terminal.status !== "ACTIVE") {
      throw new PosTerminalDeviceBoundError(
        `terminal ${terminal.code} is ${terminal.status} — activate it before enrolling a device`,
      );
    }
    if (terminal.deviceId !== null) {
      throw new PosTerminalDeviceBoundError(
        `terminal ${terminal.code} already has a device — revoke it before enrolling a new one`,
      );
    }
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("pos device enrollment requires an ambient tenant scope");
    }
    const deviceId = generateUuidV7();
    const keyHash = createHash("sha256").update(input.deviceKey).digest("hex");
    await context.tx.execute(sql`
      INSERT INTO devices (id, user_id, platform, name, device_key_hash, capabilities, terminal_id)
      VALUES (${deviceId}, ${input.actorId}, 'pos-terminal', ${input.deviceName}, ${keyHash},
              ${JSON.stringify({ pos: true })}::jsonb, ${terminal.id})
    `);
    const updated = await store.bindTerminalDevice({ terminalId: terminal.id, deviceId });
    await this.audit.record({
      action: "pos.device_enrolled",
      entityType: "pos_terminal",
      entityId: terminal.id,
      actorId: input.actorId ?? undefined,
      after: { deviceId, deviceName: input.deviceName, platform: "pos-terminal" },
    });
    return { terminal: updated, deviceId };
  }

  /** Revoke a terminal's device (sync.devices.revoke — pushes fail with
   * DEVICE_REVOKED before any command executes). */
  async revokeDevice(input: { terminalId: string; actorId: string | null }) {
    const terminal = await this.find(input.terminalId);
    if (terminal.deviceId === null) {
      throw new PosTerminalDeviceBoundError(`terminal ${terminal.code} has no device to revoke`);
    }
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("pos device revocation requires an ambient tenant scope");
    }
    await context.tx.execute(sql`
      UPDATE devices SET revoked_at = now(), updated_at = now(), version = version + 1
      WHERE id = ${terminal.deviceId} AND revoked_at IS NULL
    `);
    const updated = await store.bindTerminalDevice({ terminalId: terminal.id, deviceId: null });
    await this.audit.record({
      action: "pos.device_revoked",
      entityType: "pos_terminal",
      entityId: terminal.id,
      actorId: input.actorId ?? undefined,
      after: { deviceId: terminal.deviceId, revoked: true },
    });
    return updated;
  }
}
