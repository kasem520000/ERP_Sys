import { SYNC_CONTRACT_VERSION } from "@erp/contracts";

import type { CycleOutcome } from "../cycle";
import { runCycle } from "../cycle";
import { SyncClient, type SyncTransport } from "../client";
import {
  applyMigrations,
  BUSINESS_TABLES,
  metaGet,
  metaSet,
  type MemoryAdapter,
  type StorageAdapter,
} from "../store/adapter";
import { capturePosSale } from "../store/pull";
import type { PosSaleDraft } from "../commands/builders";
import { assertWritable, permissionWatermarkState } from "../watermark";
import {
  clearQueueUnresolvable,
  enqueue,
  markInFlight,
  queueStats,
  queueUnresolvableReason,
  type OutboxRow,
} from "../outbox/engine";
import {
  buildDraftInvoiceCreate,
  buildDraftInvoiceUpdate,
  buildPartnerContactMerge,
  buildPosSaleCommand as buildPosSale,
  buildSyncCommandV2,
  type BuildSyncCommandV2Input,
} from "../commands/builders";
import { seededRandom } from "./chaos";

/**
 * PHASE-020 · the harness-native reference device (MASTER-PLAN §13; §14 —
 * the chaos matrix drives THIS, not a fake): a REAL SyncClient over a
 * (pre-migrated) memoryAdapter + an injected SyncTransport, exposing the
 * three surfaces the W3 scenarios need:
 *
 * - `capture(input)` — a v2 local write: assertWritable + the v2 command
 *   builders + engine enqueue in ONE transaction (loud SyncReadOnlyError
 *   / LocalStoreCorruptError on refusal — C-08/C-15/C-16);
 * - `captureSale(draft)` — the 016-style POS sale capture (pos_sales row
 *   PENDING_SYNC + the outbox command, one transaction — C-09);
 * - `cycle()` — `runCycle` through the real client (the full §9 sequence);
 * - `state()` — the observable store: business rows, outbox rows,
 *   cursors, queue stats + the meta gates (read-only / watermark /
 *   quarantine / unresolvable queue).
 *
 * The constructor resolves the device class from the adapter's meta
 * (`deviceClass`, defaulting to + backfilling "pos-terminal") and the
 * contract version from meta (defaulting to the compiled-in current
 * version) — a scenario presets either by writing meta BEFORE
 * constructing the device. The seed drives the harness RNG (replayable
 * scenarios, SYNC_TESTS §9 Sev-1).
 */
export class ReferenceDevice {
  readonly adapter: StorageAdapter;
  readonly client: SyncClient;
  readonly transport: SyncTransport;
  readonly deviceClass: string;
  /** The scenario's seeded RNG (every randomized step draws from here). */
  readonly rng: () => number;

  constructor(adapter: StorageAdapter, transport: SyncTransport, seed = 42) {
    this.adapter = adapter;
    this.transport = transport;
    this.rng = seededRandom(seed);
    applyMigrations(adapter);
    this.deviceClass = metaGet(adapter, "deviceClass") ?? "pos-terminal";
    metaSet(adapter, "deviceClass", this.deviceClass);
    if (metaGet(adapter, "contractVersion") === null) {
      metaSet(adapter, "contractVersion", DEFAULT_CONTRACT_VERSION);
    }
    this.client = new SyncClient(adapter, transport);
  }

  /**
   * A generic v2 local write: builds the v2 command envelope, asserts the
   * store is writable, and enqueues through the engine — ONE transaction
   * (a refusal throws BEFORE any write; nothing half-captured). Returns
   * the commandId.
   */
  capture(input: BuildSyncCommandV2Input): string {
    const command = buildSyncCommandV2(input);
    this.adapter.transaction(() => {
      assertWritable(this.adapter);
      enqueue(this.adapter, {
        entityType: input.entityType,
        intent: input.intent,
        payload: command as unknown as Record<string, unknown>,
        idempotencyKey: command.idempotencyKey,
        baseVersion: input.baseVersion ?? null,
        commandId: command.commandId,
        localRef: input.localRef ?? null,
      });
    });
    return command.commandId;
  }

  /** `partner:contact_merge` capture (FIELD_LEVEL_MERGE intent). */
  capturePartnerContactMerge(
    partnerId: string,
    fields: Parameters<typeof buildPartnerContactMerge>[1],
  ): string {
    const command = buildPartnerContactMerge(partnerId, fields);
    return this.capture({
      entityType: "partner",
      intent: "contact_merge",
      payload: command.payload,
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
    });
  }

  /** `sales_invoice:create_draft` capture (OWNER_DEVICE_WINS intent). */
  captureDraftInvoiceCreate(payload: Parameters<typeof buildDraftInvoiceCreate>[0]): string {
    const command = buildDraftInvoiceCreate(payload);
    return this.capture({
      entityType: "sales_invoice",
      intent: "create_draft",
      payload: command.payload,
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
    });
  }

  /** `sales_invoice:update_draft` capture (baseVersion guard intent). */
  captureDraftInvoiceUpdate(
    invoiceId: string,
    payload: Parameters<typeof buildDraftInvoiceUpdate>[1],
    baseVersion: number,
  ): string {
    const command = buildDraftInvoiceUpdate(invoiceId, payload, baseVersion);
    return this.capture({
      entityType: "sales_invoice",
      intent: "update_draft",
      payload: command.payload,
      idempotencyKey: command.idempotencyKey,
      baseVersion,
      commandId: command.commandId,
    });
  }

  /**
   * The 016-style POS sale capture (C-09): the pos_sales business row
   * (PENDING_SYNC — never a posted state) + the pos_sale outbox command
   * in ONE transaction. Returns the sale's clientId.
   */
  captureSale(draft: PosSaleDraft, totalGross: string): string {
    return capturePosSale(this.adapter, {
      // Explicit clientId: the pos_sales row id == the command's sale
      // clientId (the 1:1 reconciliation pair — markSynced targets it).
      clientId: draft.clientId,
      offlineReceiptNo: draft.offlineReceiptNo,
      terminalId: draft.terminalId,
      customerId: draft.customerId,
      orderType: draft.orderType,
      invoiceDate: draft.invoiceDate,
      totalGross,
      tenders: draft.tenders,
      lines: draft.lines,
      enqueueCommand: (store) => {
        const command = buildPosSale(draft);
        enqueue(store, {
          entityType: "pos_sale",
          intent: "create",
          payload: command as unknown as Record<string, unknown>,
          idempotencyKey: command.idempotencyKey,
          commandId: command.id,
        });
      },
    });
  }

  /** Mark commands IN_FLIGHT without applying results (crash sims). */
  markInFlight(commandIds: readonly string[]): void {
    markInFlight(this.adapter, commandIds);
  }

  /** One full §9 cycle through the real client. */
  async cycle(): Promise<CycleOutcome> {
    return runCycle(this.client);
  }

  /** Clear the unresolvable-queue flag (the reconciliation resolution). */
  resolveQueue(): void {
    clearQueueUnresolvable(this.adapter);
  }

  /** The observable device state (scenario assertions). */
  state(): ReferenceDeviceState {
    const watermark = permissionWatermarkState(this.adapter);
    const contractGate = metaGet(this.adapter, "contractGate");
    const businessRows: Record<string, Record<string, unknown>[]> = {};
    for (const table of this.businessTables()) {
      businessRows[table] = this.adapter.all(`SELECT * FROM ${table}`);
    }
    const cursors: Record<string, string> = {};
    for (const row of this.adapter.all("SELECT * FROM cursors")) {
      cursors[String(row.entity_type)] = String(row.last_seq);
    }
    const outbox = this.adapter.all("SELECT * FROM outbox").map(outboxRow);
    return {
      deviceClass: this.deviceClass,
      businessRows,
      outbox,
      cursors,
      queue: queueStats(this.adapter),
      meta: {
        contractVersion: metaGet(this.adapter, "contractVersion"),
        contractGate,
        permissionSnapshotAt: watermark.snapshotAt,
        watermarkReadOnly: watermark.readOnly,
        watermarkAgeDays: watermark.ageDays,
        quarantined: metaGet(this.adapter, "quarantined") === "true",
        queueUnresolvable: queueUnresolvableReason(this.adapter),
        readOnly:
          contractGate === "read-only" ||
          watermark.readOnly ||
          metaGet(this.adapter, "quarantined") === "true",
      },
    };
  }

  private businessTables(): readonly string[] {
    const memory = this.adapter as MemoryAdapter;
    return memory.listBusinessTables !== undefined ? memory.listBusinessTables() : BUSINESS_TABLES;
  }
}

/** The default contract version stamped into meta at construction (the
 * compiled-in current version — a scenario overrides it by pre-writing
 * meta before constructing the device). */
const DEFAULT_CONTRACT_VERSION = SYNC_CONTRACT_VERSION;

function outboxRow(row: Record<string, unknown>): OutboxRow & Record<string, unknown> {
  return {
    commandId: String(row.command_id),
    entityType: String(row.entity_type),
    intent: String(row.intent),
    payload: String(row.payload),
    idempotencyKey: String(row.idempotency_key),
    baseVersion: row.base_version === undefined || row.base_version === null ? null : Number(row.base_version),
    clientCreatedAt: String(row.client_created_at),
    localRef: row.local_ref === undefined || row.local_ref === null ? null : String(row.local_ref),
    status: String(row.status) as OutboxRow["status"],
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: row.next_attempt_at === undefined || row.next_attempt_at === null ? 0 : Number(row.next_attempt_at),
    lastError: row.last_error === undefined || row.last_error === null ? null : String(row.last_error),
    lastAttemptAt: row.last_attempt_at === undefined || row.last_attempt_at === null ? null : String(row.last_attempt_at),
    acceptedResult: row.accepted_result === undefined || row.accepted_result === null ? null : String(row.accepted_result),
    rejectionReason: row.rejection_reason === undefined || row.rejection_reason === null ? null : String(row.rejection_reason),
    rejectionAction: row.rejection_action === undefined || row.rejection_action === null ? null : String(row.rejection_action),
    officialNo: row.official_no === undefined || row.official_no === null ? null : String(row.official_no),
    ackedAt: row.acked_at === undefined || row.acked_at === null ? null : String(row.acked_at),
    ...row,
  };
}

/** The `state()` snapshot shape. */
export interface ReferenceDeviceState {
  deviceClass: string;
  /** Business-table rows (read caches + write set — machinery excluded). */
  businessRows: Record<string, Record<string, unknown>[]>;
  outbox: (OutboxRow & Record<string, unknown>)[];
  /** entityType → last persisted cursor. */
  cursors: Record<string, string>;
  queue: { pending: number; inFlight: number; rejected: number; acked: number };
  meta: {
    contractVersion: string | null;
    /** "read-only" when the C-08 gate tripped; "ok"/null otherwise. */
    contractGate: string | null;
    permissionSnapshotAt: number | null;
    watermarkReadOnly: boolean;
    watermarkAgeDays: number;
    quarantined: boolean;
    /** The unresolvable-queue reason (revoked device), null when draining. */
    queueUnresolvable: string | null;
    /** Any read-only condition (gate, watermark, or quarantine). */
    readOnly: boolean;
  };
}
