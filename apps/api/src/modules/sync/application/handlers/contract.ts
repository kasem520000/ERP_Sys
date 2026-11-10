import { DomainError } from "@erp/domain-core";

import type { AuditService } from "../../../audit/api/audit";
import type { CountService } from "../../../inventory/application/count-service";
import type { TransferService as InventoryTransferService } from "../../../inventory/application/transfer-service";
import type { PartnerService } from "../../../partners/application/partner-service";
import type { PosShiftFlowService } from "../../../pos/application/shift-flow-service";
import type { DeliveryNoteService } from "../../../sales/application/deliveries";
import type { CreditNoteService } from "../../../sales/application/credit-notes";
import type { SalesInvoiceService } from "../../../sales/application/invoices";
import type { QuotationService } from "../../../sales/application/quotations";
import type { PosSaleService } from "../../../sales/application/pos-channel/pos-sale-service";
import type { AllocationService } from "../../../treasury/application/allocation-service";
import type { ReceiptService } from "../../../treasury/application/receipt-service";
import type { ExpenseService } from "../../../treasury/application/expense-service";
import type { TransferService as TreasuryTransferService } from "../../../treasury/application/transfer-service";
import type { VanStockService } from "../../../distribution/application/van-stock-service";

/**
 * PHASE-020 · the handler CONTRACT (split from ./index by the dependency
 * rules — DEPENDENCY_RULES §2.1 no-circular): every handler module imports
 * its types + the shared service accessor + the typed validation throw
 * from THIS leaf, while ./index keeps only the registry (which imports the
 * handler modules). index → handlers → contract stays acyclic; consumers
 * keep importing everything from "./handlers" (index re-exports).
 */

/** The execution context handed to every handler. `deviceClass` comes from
 * the devices row (agent 2-c owns the registry; handlers read the row via
 * the push service, never the registry service). */
export interface SyncHandlerContext {
  readonly deviceId: string;
  /** From the devices row: device_class column, else the platform mapping. */
  readonly deviceClass: string;
  /** devices.user_id — the device's user (audit actor when non-null). */
  readonly userId: string | null;
  readonly command: NormalizedCommand;
}

/** The unified command shape: v2 SyncCommand or the 016 legacy commands,
 * normalized by the push service before dispatch. */
export interface NormalizedCommand {
  /** v2 commandId, or the legacy command `id`. */
  readonly commandId: string;
  /** 'pos_sale' | 'cashier_shift' for legacy; the v2 entityType. */
  readonly entityType: string;
  /** 'create' for legacy pos_sale; 'open'/'close' for legacy shifts; v2 intent. */
  readonly intent: string;
  readonly idempotencyKey: string;
  readonly baseVersion?: number;
  readonly clientCreatedAt: string;
  readonly localRef?: string;
  /** Legacy: the whole command object; v2: the command's payload. */
  readonly payload: unknown;
  readonly legacy: boolean;
}

/** What a successful handler returns. `result` rides the ACCEPTED item;
 * `entity`/`officialNumber`/`effects` are the v2 extensions; `feedEntries`
 * are written to change_log in the same tx as the command (header-only
 * marker payloads — the catch-up writer projects details at pull time). */
export interface HandlerOutcome {
  readonly status: "ACCEPTED";
  readonly result: Record<string, unknown>;
  readonly entity?: { id: string; version: number };
  readonly officialNumber?: string;
  readonly effects?: {
    journalEntryIds?: string[];
    stockMoveIds?: string[];
  };
  readonly localized?: { ar: string; en: string };
  readonly feedEntries?: readonly {
    entityType: string;
    entityId: string;
    op: "UPSERT" | "DELETE";
    payload: Record<string, unknown> | null;
  }[];
}

export type SyncCommandHandler = (ctx: SyncHandlerContext) => Promise<HandlerOutcome>;

// -- service wiring ------------------------------------------------------------
//
// Handlers are module-level functions on a shared registry (the push
// service looks them up by key), so the DI'd service instances they call
// are injected ONCE per process by the PushService constructor (the Nest
// container's instances — single source). Specs instantiate PushService
// directly (the leads.spec pattern), which wires the same slots.

export interface HandlerServices {
  readonly posSales: PosSaleService;
  readonly shiftFlow: PosShiftFlowService;
  readonly audit: AuditService;
  readonly invoices: SalesInvoiceService;
  // PHASE-021 · DR-P21-08 (MASTER-PLAN §6 table): the owning services of
  // the seven desktop write intents — additive slots, wired by the same
  // PushService constructor call (DI container or spec).
  readonly partners: PartnerService;
  readonly quotations: QuotationService;
  readonly deliveries: DeliveryNoteService;
  readonly expenses: ExpenseService;
  readonly treasuryTransfers: TreasuryTransferService;
  readonly inventoryTransfers: InventoryTransferService;
  readonly stockCounts: CountService;
  // PHASE-022 · DR-P22-06 (MASTER-PLAN §6 + §1): the owning services of the
  // three field write intents — additive slots, wired by the same
  // PushService constructor call (DI container or spec).
  /** `receipt:create_field_collection` — the treasury create→post chain. */
  readonly receipts: ReceiptService;
  /** The receipt's optional open-item allocations (INV-016/BR-027). */
  readonly allocations: AllocationService;
  /** `van:confirm_load`/`van:confirm_unload` — the 017 van transfer chain. */
  readonly vanStock: VanStockService;
  /** `credit_note:create_draft` — the sales credit-note DRAFT path. */
  readonly creditNotes: CreditNoteService;
}

let services: HandlerServices | undefined;

/** Called by the PushService constructor (DI container or spec). */
export function configureHandlerServices(injected: HandlerServices): void {
  services = injected;
}

/** The handler modules' accessor; throws loud when unwired (fail closed). */
export function handlerServices(): HandlerServices {
  if (services === undefined) {
    throw new Error(
      "sync handlers are not wired — construct PushService (it calls configureHandlerServices)",
    );
  }
  return services;
}

/** Typed VALIDATION_ERROR throw for handler pre-write validation: maps to
 * the per-item rejection reason VALIDATION_ERROR (SYNC_REJECTION_REASONS)
 * BEFORE any write — the zero-residue rule (the ambient tx cannot roll
 * back per item). */
export function handlerValidationError(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new DomainError("VALIDATION_ERROR", message, details);
}
