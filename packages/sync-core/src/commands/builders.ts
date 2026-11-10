import {
  type DraftInvoiceCreatePayload,
  type DraftInvoiceUpdatePayload,
  type PartnerContactMergePayload,
} from "@erp/contracts";
import { generateUuidV7 } from "@erp/domain-core";

import type { StorageAdapter } from "../store/adapter";

/**
 * PHASE-016 · the terminal-scoped OFF- receipt numbering (BR-030/A-010;
 * DOCUMENT_LIFECYCLE §4): a per-terminal monotone sequence kept in local
 * meta (`offline_seq:{terminalId}`). `OFF-{terminalCode}-{seq}` is a
 * LOCAL reference only — it reconciles 1:1 to the official number the
 * server assigns at sync (the receipt prints both after sync; before
 * sync it prints the OFF- number plus a pending-sync notice and the
 * official number appears NOWHERE — OFFLINE_ARCHITECTURE §5).
 */
export function nextOfflineNumber(
  adapter: StorageAdapter,
  terminalCode: string,
  terminalId: string,
): string {
  const key = `offline_seq:${terminalId}`;
  const current = Number(adapter.get("SELECT * FROM meta WHERE key = ?", [key])?.value ?? "0");
  const next = current + 1;
  if (current === 0) {
    adapter.run("INSERT INTO meta (key, value) VALUES (?, ?)", [key, String(next)]);
  } else {
    adapter.run("UPDATE meta SET value = ? WHERE key = ?", [String(next), key]);
  }
  return `OFF-${terminalCode}-${String(next).padStart(5, "0")}`;
}

/** Read the current sequence without advancing (diagnostics/UX). */
export function currentOfflineSeq(adapter: StorageAdapter, terminalId: string): number {
  return Number(adapter.get("SELECT * FROM meta WHERE key = ?", [`offline_seq:${terminalId}`])?.value ?? "0");
}

// -- command builders (the §11 push intents; shapes shared with the server
// through @erp/contracts) ----------------------------------------------------------

export interface PosSaleDraft {
  clientId: string;
  terminalId: string;
  offlineReceiptNo: string;
  invoiceDate: string;
  customerId: string | null;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "COUNTER";
  checkId?: string | null;
  lines: {
    itemId: string;
    qty: string;
    unitPrice: string;
    discountAmount?: string | null;
    taxCodeId?: string | null;
    serialIds?: string[] | null;
  }[];
  tenders: { method: "CASH" | "CARD"; amount: string; reference?: string | null }[];
}

/** Build the `pos_sale` command from a captured draft. The idempotency
 * key is `pos_sale:{clientId}` — stable across re-drains and app
 * restarts (the §11 first dedupe layer; INV-013 is the server-side
 * second layer on the posting-operation key). */
export function buildPosSaleCommand(draft: PosSaleDraft): {
  type: "pos_sale";
  id: string;
  idempotencyKey: string;
  createdAt: string;
  sale: PosSaleDraft;
} {
  return {
    type: "pos_sale",
    id: draft.clientId,
    idempotencyKey: `pos_sale:${draft.clientId}`,
    createdAt: new Date().toISOString(),
    sale: draft,
  };
}

/** Build a `cashier_shift` open event. */
export function buildShiftOpenCommand(input: {
  terminalId: string;
  clientId?: string;
  openingAmount: string;
  denominations?: Record<string, string> | null;
}): {
  type: "cashier_shift";
  id: string;
  idempotencyKey: string;
  createdAt: string;
  event: "open";
  shift: {
    terminalId: string;
    clientId?: string;
    openingAmount: string;
    denominations?: Record<string, string> | null;
  };
} {
  const clientId = input.clientId ?? generateUuidV7();
  return {
    type: "cashier_shift",
    id: clientId,
    idempotencyKey: `cashier_shift:open:${clientId}`,
    createdAt: new Date().toISOString(),
    event: "open",
    shift: {
      terminalId: input.terminalId,
      clientId,
      openingAmount: input.openingAmount,
      ...(input.denominations === undefined ? {} : { denominations: input.denominations }),
    },
  };
}

/** Build a `cashier_shift` close event (blind count + optional
 * supervisor attestation for the beyond-tolerance path). */
export function buildShiftCloseCommand(input: {
  terminalId: string;
  denominations: Record<string, string>;
  reason?: string | null;
  supervisorId?: string | null;
  supervisorPin?: string | null;
}): {
  type: "cashier_shift";
  id: string;
  idempotencyKey: string;
  createdAt: string;
  event: "close";
  shift: {
    terminalId: string;
    denominations: Record<string, string>;
    reason?: string | null;
    supervisorId?: string | null;
    supervisorPin?: string | null;
  };
} {
  const id = generateUuidV7();
  return {
    type: "cashier_shift",
    id,
    idempotencyKey: `cashier_shift:close:${input.terminalId}:${id}`,
    createdAt: new Date().toISOString(),
    event: "close",
    shift: {
      terminalId: input.terminalId,
      denominations: input.denominations,
      ...(input.reason === undefined || input.reason === null ? {} : { reason: input.reason }),
      ...(input.supervisorId === undefined || input.supervisorId === null ? {} : { supervisorId: input.supervisorId }),
      ...(input.supervisorPin === undefined || input.supervisorPin === null ? {} : { supervisorPin: input.supervisorPin }),
    },
  };
}

// -- PHASE-020 v2 command builders (SYNC_PROTOCOL §3.2; MASTER-PLAN §2) --------------
//
// The v2 envelope: entityType+intent name the server's handler registry
// key, commandId is the client UUIDv7 (the inbox dedupe key with the
// device), idempotencyKey is the stable retry key (§11 first dedupe
// layer), baseVersion is the optimistic-concurrency guard for edit
// intents (CONFLICT_RESOLUTION §4), clientCreatedAt is advisory only
// (§7 clock skew), localRef is the device-side reference for UI
// surfacing (e.g. the OFF- receipt number).

/** The v2 command envelope (mirrors @erp/contracts syncCommandSchema). */
export type SyncCommandV2Envelope = {
  commandId: string;
  entityType: string;
  intent: string;
  idempotencyKey: string;
  baseVersion?: number;
  clientCreatedAt: string;
  localRef?: string;
  payload: unknown;
};

export interface BuildSyncCommandV2Input {
  entityType: string;
  intent: string;
  payload: unknown;
  /** Stable retry key — generated (UUIDv7) when omitted. */
  idempotencyKey?: string;
  /** Server row version the command edits (update intents). */
  baseVersion?: number;
  /** Advisory device-side reference (OFF- number, draft label, …). */
  localRef?: string;
  /** Explicit command id (deterministic harnesses); generated when omitted. */
  commandId?: string;
}

/** Build a v2 sync command. `uuid` is injectable for deterministic
 * harnesses; the default is the domain-core UUIDv7 generator (ids are
 * time-ordered → natural FIFO locality, ADR-0006). */
export function buildSyncCommandV2(
  input: BuildSyncCommandV2Input,
  uuid: () => string = generateUuidV7,
): SyncCommandV2Envelope {
  const command: SyncCommandV2Envelope = {
    commandId: input.commandId ?? uuid(),
    entityType: input.entityType,
    intent: input.intent,
    idempotencyKey: input.idempotencyKey ?? uuid(),
    clientCreatedAt: new Date().toISOString(),
    payload: input.payload,
  };
  if (input.baseVersion !== undefined) command.baseVersion = input.baseVersion;
  if (input.localRef !== undefined) command.localRef = input.localRef;
  return command;
}

/** The whitelisted contact fields of `partner:contact_merge`
 * (FIELD_LEVEL_MERGE — MASTER-PLAN §7; constrained fields never ride
 * this payload: the server rejects their presence with
 * VALIDATION_ERROR details.constrainedFields, zero merge). */
export type PartnerContactMergeFields = Pick<
  PartnerContactMergePayload,
  "phone" | "phone2" | "email" | "addressLine1" | "addressLine2" | "city" | "contactPerson"
>;

/** Build a `partner:contact_merge` command (≥ 1 whitelisted field). */
export function buildPartnerContactMerge(
  partnerId: string,
  fields: PartnerContactMergeFields,
  uuid: () => string = generateUuidV7,
): SyncCommandV2Envelope {
  return buildSyncCommandV2(
    {
      entityType: "partner",
      intent: "contact_merge",
      payload: { partnerId, ...fields },
      idempotencyKey: `partner:contact_merge:${uuid()}`,
    },
    uuid,
  );
}

/** Build a `sales_invoice:create_draft` command (OWNER_DEVICE_WINS —
 * the server creates the DRAFT and stamps owner_device_id = device). */
export function buildDraftInvoiceCreate(
  payload: DraftInvoiceCreatePayload,
  uuid: () => string = generateUuidV7,
): SyncCommandV2Envelope {
  return buildSyncCommandV2(
    {
      entityType: "sales_invoice",
      intent: "create_draft",
      payload,
      idempotencyKey: `sales_invoice:create_draft:${uuid()}`,
    },
    uuid,
  );
}

/** Build a `sales_invoice:update_draft` command (OWNER_DEVICE_WINS +
 * baseVersion: the aggregate snapshot rides wholesale — lines replace,
 * never patch; baseVersion mismatch → STALE_VERSION server-side). */
export function buildDraftInvoiceUpdate(
  invoiceId: string,
  payload: Omit<DraftInvoiceUpdatePayload, "invoiceId">,
  baseVersion: number,
  uuid: () => string = generateUuidV7,
): SyncCommandV2Envelope {
  return buildSyncCommandV2(
    {
      entityType: "sales_invoice",
      intent: "update_draft",
      payload: { invoiceId, ...payload },
      idempotencyKey: `sales_invoice:update_draft:${invoiceId}:${uuid()}`,
      baseVersion,
    },
    uuid,
  );
}
