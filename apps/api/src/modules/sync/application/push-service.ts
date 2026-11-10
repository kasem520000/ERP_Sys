import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { processMetrics } from "../../../infra/observability/metrics";
import { AuditService } from "../../audit/api/audit";
import { CountService } from "../../inventory/application/count-service";
import { TransferService as InventoryTransferService } from "../../inventory/application/transfer-service";
import { PartnerService } from "../../partners/application/partner-service";
import { PosSaleService } from "../../sales/application/pos-channel/pos-sale-service";
import { CreditNoteService } from "../../sales/application/credit-notes";
import { DeliveryNoteService } from "../../sales/application/deliveries";
import { SalesInvoiceService } from "../../sales/application/invoices";
import { QuotationService } from "../../sales/application/quotations";
import { AllocationService } from "../../treasury/application/allocation-service";
import { ReceiptService } from "../../treasury/application/receipt-service";
import { ExpenseService } from "../../treasury/application/expense-service";
import { TransferService as TreasuryTransferService } from "../../treasury/application/transfer-service";
import { VanStockService } from "../../distribution/application/van-stock-service";
import { PosShiftFlowService } from "../../pos/application/shift-flow-service";
import {
  PosDeviceNotFoundError,
  PosDeviceNotTerminalError,
  PosDeviceRevokedError,
  PosSyncCommandInvalidError,
} from "../../pos/domain/pos-errors";

// The wire contracts live in @erp/contracts (one source of truth shared
// with the device-side sync-core; §11 rule 1 — same contracts, narrow
// scope). The 016 re-exports stay: the module's public surface is additive.
export {
  POS_REJECTION_REASONS,
  MAX_PUSH_BATCH,
  cashierShiftCommandSchema,
  posSaleCommandSchema,
  type CashierShiftCommand,
  type PosSaleCommand,
  type PushItemResult,
} from "@erp/contracts";
import {
  MAX_PUSH_BATCH,
  ONLINE_ONLY_ENTITIES,
  RESUBMITTABLE_BY_REASON,
  SYNC_CONTRACT_VERSION,
  SYNC_REJECTION_REASONS,
  actionForSyncRejection,
  cashierShiftCommandSchema,
  isContractSupported,
  posSaleCommandSchema,
  syncCommandSchema,
  type CashierShiftCommand,
  type PosSaleCommand,
  type PosRejectionReason,
  type PushItemResult,
  type PushItemResultV2,
  type SyncCommandV2,
  type SyncRejectionReason,
} from "@erp/contracts";
import { publishFeedEntries } from "./change-log-writer";
import { findInboxResult, recordInboxResult } from "./inbox-service";
import {
  configureHandlerServices,
  handlerFor,
  handlerRegistryKeys,
  type HandlerOutcome,
  type NormalizedCommand,
  type SyncHandlerContext,
} from "./handlers";

/**
 * PHASE-016 · the narrow push service (T8; SYNC_PROTOCOL §3 + §11): batch
 * push (≤ 50 commands, per-item results, `Idempotency-Key` = batch id) for
 * exactly two command families: `pos_sale` (invoice + lines + tenders via
 * the SALES module's PosSaleService — sync adds transport, never a second
 * business-logic path) and `cashier_shift` (open/close over the TREASURY
 * shift model).
 *
 * PHASE-020 · the v2 rewrite (MASTER-PLAN §6; SYNC_PROTOCOL §3/§4 + §6;
 * CONFLICT_RESOLUTION §2/§3): the 016 flow generalizes into the unified
 * handler-registry pipeline. Wire compat is §11 rule 3 — ABSOLUTE:
 * - `push()` keeps the 016 input working; a batch WITHOUT `contractVersion`
 *   is the 016 legacy path and its response items carry EXACTLY the 016
 *   field set (byte-compat — the v2 extensions are stripped on that path).
 * - `requireActivePosDevice()` stays byte-identical (the 016 controller
 *   status/pull routes call it).
 * - v2 (contractVersion present) adds: device-class resolution, per-item
 *   TENANT_SUSPENDED / DEVICE_REVOKED / CONTRACT_VERSION_UNSUPPORTED gates
 *   (zero execution, never in the inbox — retryable device/tenant states,
 *   C-14's restore-and-resume depends on NOT recording them), a token-bucket
 *   rate limit rendering DEFERRED, the inbox dedupe (C-01/C-04), and the
 *   per-intent handler registry.
 *
 * Zero-residue discipline (C-03/C-15): every handler runs inside a
 * SAVEPOINT that is rolled back on ANY throw — the ambient request tx
 * cannot roll back per item, so the savepoint is what keeps a rejected
 * command's partial writes from committing with its accepted siblings.
 */

/** The v2 result + the DEFERRED retry hint. `retryAfterMs` is a pending
 * contracts addition (PushItemResultV2Extension carries no retry field
 * yet) — reported, not edited here (wave 1 owns the contracts). */
export type PushItemResultWire = PushItemResultV2 & { retryAfterMs?: number };

/** Generic localized message per rejection reason (CONFLICT_RESOLUTION §3 —
 * direct display; Arabic + English, the repo's two shipped languages). */
const LOCALIZED_BY_REASON: Record<SyncRejectionReason | "RATE_LIMITED", { ar: string; en: string }> = {
  PERIOD_LOCKED: {
    ar: "الفترة المحاسبية مقفلة لهذا التاريخ",
    en: "The accounting period is locked for this date",
  },
  PRICE_CHANGED: {
    ar: "تغيّر السعر على الخادم — راجع السعر الجديد",
    en: "The price changed on the server — review the new price",
  },
  INSUFFICIENT_STOCK: {
    ar: "الكمية المتاحة لا تكفي",
    en: "Available stock is insufficient",
  },
  CREDIT_LIMIT_EXCEEDED: {
    ar: "تجاوز حدّ الائتمان المسموح",
    en: "The credit limit is exceeded",
  },
  STALE_VERSION: {
    ar: "نسخة قديمة — حدّث السجل من الخادم ثم أعد الإرسال",
    en: "Stale version — refresh the row from the server and resend",
  },
  VALIDATION_ERROR: {
    ar: "أمر غير صالح — راجع البيانات وأعد الإرسال",
    en: "Invalid command — review the data and resend",
  },
  ITEM_INACTIVE: {
    ar: "الصنف غير نشط",
    en: "The item is inactive",
  },
  PARTNER_INACTIVE: {
    ar: "العميل غير نشط",
    en: "The partner is inactive",
  },
  DUPLICATE_COMMAND: {
    ar: "أمر مكرر",
    en: "Duplicate command",
  },
  DEVICE_REVOKED: {
    ar: "الجهاز ملغى — لا يمكن تنفيذ الأوامر",
    en: "The device is revoked — commands cannot run",
  },
  TENANT_SUSPENDED: {
    ar: "الحساب موقوف مؤقتًا — لا يمكن تنفيذ الأوامر الآن",
    en: "The tenant is suspended — commands cannot run right now",
  },
  CONTRACT_VERSION_UNSUPPORTED: {
    ar: "إصدار العقد غير مدعوم — حدّث التطبيق",
    en: "Contract version unsupported — update the app",
  },
  FORBIDDEN: {
    ar: "هذا النوع للتحرير عبر الإنترنت فقط",
    en: "This entity type is online-only",
  },
  RATE_LIMITED: {
    ar: "ضغط مرتفع — أعد المحاولة بعد قليل",
    en: "Rate limited — retry shortly",
  },
};

// -- the rate limiter (MASTER-PLAN §6.3) ---------------------------------------
//
// Token bucket per device: refill 10 tokens/min, burst cap 20; one push
// CALL consumes one token. No tokens → ALL items DEFERRED (NOT executed,
// NOT in the inbox — SYNC_PROTOCOL §3.5). In-memory by design (per API
// process); the bucket seed is full (20) so a fresh device can burst.

interface RateBucket {
  tokens: number;
  lastRefill: number;
}
const RATE_BURST = 20;
const RATE_REFILL_PER_MS = 10 / 60_000; // 10 tokens / minute
const RATE_RETRY_AFTER_MS = 5000;
const rateBuckets = new Map<string, RateBucket>();

/** Consume one token; false when the bucket is empty (→ DEFERRED). */
function consumeRateToken(deviceId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(deviceId) ?? { tokens: RATE_BURST, lastRefill: now };
  const refilled = Math.min(
    RATE_BURST,
    bucket.tokens + (now - bucket.lastRefill) * RATE_REFILL_PER_MS,
  );
  if (refilled < 1) {
    rateBuckets.set(deviceId, { tokens: refilled, lastRefill: now });
    return false;
  }
  rateBuckets.set(deviceId, { tokens: refilled - 1, lastRefill: now });
  return true;
}

// -- device resolution ----------------------------------------------------------

interface DeviceRow {
  id: string;
  userId: string;
  platform: string;
  deviceClass: string | null;
  revokedAt: string | null;
  trustFlags: Record<string, unknown>;
}

/** platform → device class (the 2-a rule; the platform CHECK only allows
 * the three values below — android-personal arises only via the
 * device_class column). */
function platformToClass(platform: string): string {
  switch (platform) {
    case "pos-terminal":
      return "pos-terminal";
    case "DESKTOP":
      return "tauri-desktop";
    case "ANDROID":
      return "android-field";
    default:
      return "android-field";
  }
}

// -- normalization ---------------------------------------------------------------

type ParsedCommand =
  | { ok: true; command: NormalizedCommand }
  | { ok: false; id: string; idempotencyKey: string; message: string };

function bestEffortId(raw: unknown): string {
  const candidate = (raw as { id?: unknown; commandId?: unknown }) ?? {};
  if (typeof candidate.id === "string" && candidate.id.length > 0) return candidate.id;
  if (typeof candidate.commandId === "string" && candidate.commandId.length > 0) {
    return candidate.commandId;
  }
  return generateUuidV7();
}

function bestEffortKey(raw: unknown): string {
  const candidate = (raw as { idempotencyKey?: unknown }) ?? {};
  return typeof candidate.idempotencyKey === "string" && candidate.idempotencyKey.length > 0
    ? candidate.idempotencyKey
    : "unknown";
}

/** v2 (intent + entityType strings) or legacy (`type` discriminator), into
 * ONE NormalizedCommand (MASTER-PLAN §6.7: both shapes adapt into one
 * handler registry). */
function normalize(raw: unknown): ParsedCommand {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, id: bestEffortId(raw), idempotencyKey: bestEffortKey(raw), message: "command must be an object" };
  }
  const asRecord = raw as Record<string, unknown>;
  const looksV2 =
    typeof asRecord.intent === "string" && typeof asRecord.entityType === "string";
  if (looksV2) {
    const parsed = syncCommandSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        id: bestEffortId(raw),
        idempotencyKey: bestEffortKey(raw),
        message: "command shape rejected by the v2 contract",
      };
    }
    const data = parsed.data as SyncCommandV2;
    return {
      ok: true,
      command: {
        commandId: data.commandId,
        entityType: data.entityType,
        intent: data.intent,
        idempotencyKey: data.idempotencyKey,
        baseVersion: data.baseVersion,
        clientCreatedAt: data.clientCreatedAt,
        localRef: data.localRef,
        payload: data.payload,
        legacy: false,
      },
    };
  }
  if (asRecord.type === "pos_sale") {
    const parsed = posSaleCommandSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        id: bestEffortId(raw),
        idempotencyKey: bestEffortKey(raw),
        message: "command shape rejected by the contract",
      };
    }
    const data = parsed.data as PosSaleCommand;
    return {
      ok: true,
      command: {
        commandId: data.id,
        entityType: "pos_sale",
        intent: "create",
        idempotencyKey: data.idempotencyKey,
        clientCreatedAt: data.createdAt,
        payload: data,
        legacy: true,
      },
    };
  }
  if (asRecord.type === "cashier_shift") {
    const parsed = cashierShiftCommandSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        id: bestEffortId(raw),
        idempotencyKey: bestEffortKey(raw),
        message: "command shape rejected by the contract",
      };
    }
    const data = parsed.data as CashierShiftCommand;
    return {
      ok: true,
      command: {
        commandId: data.id,
        entityType: "cashier_shift",
        intent: data.event,
        idempotencyKey: data.idempotencyKey,
        clientCreatedAt: data.createdAt,
        payload: data,
        legacy: true,
      },
    };
  }
  return {
    ok: false,
    id: bestEffortId(raw),
    idempotencyKey: bestEffortKey(raw),
    message: "command shape rejected by the contract",
  };
}

// -- result shaping ----------------------------------------------------------------

/** The internal (v2-shaped) item type the pipeline works in. */
type InternalItem = PushItemResultWire;

/** Strip to the EXACT 016 field set (§11 rule 3 byte-compat): no v2
 * extensions (commandId/duplicate/entity/officialNumber/effects/
 * resubmittable/localized/retryAfterMs) on the legacy path. */
function toLegacyItem(item: InternalItem): PushItemResult {
  if (item.status === "ACCEPTED") {
    return {
      id: item.id,
      status: "ACCEPTED",
      idempotencyKey: item.idempotencyKey,
      result: item.result,
    };
  }
  if (item.status === "DEFERRED") {
    return {
      id: item.id,
      status: "DEFERRED",
      idempotencyKey: item.idempotencyKey,
      reason: item.reason,
      message: item.message,
    };
  }
  const legacy: Extract<PushItemResult, { status: "REJECTED" }> = {
    id: item.id,
    status: "REJECTED",
    idempotencyKey: item.idempotencyKey,
    // The legacy registry predates the v2 codes; the admin gates
    // (TENANT_SUSPENDED on a legacy batch) are the only new codes a 016
    // terminal can observe — recorded as a v2 refinement.
    reason: item.reason as PosRejectionReason,
    message: item.message,
    details: item.details,
    action: item.action,
  };
  return legacy;
}

/** Handler-throw → REJECTED item (the 016 rejectFrom pattern, extended to
 * the full sync registry: code in registry, else name, else
 * VALIDATION_ERROR). */
function rejectFromSyncError(
  error: unknown,
  command: NormalizedCommand,
): Extract<InternalItem, { status: "REJECTED" }> {
  const domain = error as {
    code?: string;
    name?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
  const candidate = domain?.code ?? (error instanceof Error ? error.name : undefined);
  const reason: SyncRejectionReason =
    candidate !== undefined && (SYNC_REJECTION_REASONS as readonly string[]).includes(candidate)
      ? (candidate as SyncRejectionReason)
      : "VALIDATION_ERROR";
  return {
    id: command.commandId,
    status: "REJECTED",
    idempotencyKey: command.idempotencyKey,
    reason,
    message: domain?.message ?? "command rejected by server decision",
    details: domain?.details,
    action: actionForSyncRejection(reason),
    commandId: command.commandId,
    resubmittable: RESUBMITTABLE_BY_REASON[reason],
    localized: LOCALIZED_BY_REASON[reason],
  };
}

@Injectable()
export class PushService {
  // PHASE-025 SF-025-001: explicit @Inject tokens on EVERY constructor
  // param (the repo's DI convention — journal-service/audit-service
  // pattern). The bare-type signature relied on design:paramtypes
  // metadata, which the tsx runtime emits but the vitest/esbuild transform
  // does not — an app boot under vitest DI-constructed this service with
  // ALL slots undefined, silently re-wiring the sync handler graph
  // (configureHandlerServices) with undefined services and breaking every
  // push (found by the GA full-load T-05 sync round-trip harness — the
  // first spec to boot the app AND push through the spec-constructed
  // service after the boot). Explicit tokens make the wiring identical in
  // both runtimes — the fix the convention existed for.
  constructor(
    @Inject(PosSaleService) posSales: PosSaleService,
    @Inject(PosShiftFlowService) shiftFlow: PosShiftFlowService,
    @Inject(AuditService) audit: AuditService,
    @Inject(SalesInvoiceService) invoices: SalesInvoiceService,
    // PHASE-021 · DR-P21-08: the owning services of the seven desktop
    // write intents (MASTER-PLAN §6 table) — additive constructor slots,
    // same wiring as the 020 four (the Nest container's instances; specs
    // pass spec-constructed ones — the leads.spec pattern).
    @Inject(PartnerService) partners: PartnerService,
    @Inject(QuotationService) quotations: QuotationService,
    @Inject(DeliveryNoteService) deliveries: DeliveryNoteService,
    @Inject(ExpenseService) expenses: ExpenseService,
    @Inject(TreasuryTransferService) treasuryTransfers: TreasuryTransferService,
    @Inject(InventoryTransferService) inventoryTransfers: InventoryTransferService,
    @Inject(CountService) stockCounts: CountService,
    // PHASE-022 · DR-P22-06: the owning services of the three field write
    // intents (MASTER-PLAN §6 + §1) — additive constructor slots, same
    // wiring as the 021 seven (the Nest container's instances; specs pass
    // spec-constructed ones — the leads.spec pattern).
    @Inject(ReceiptService) receipts: ReceiptService,
    @Inject(AllocationService) allocations: AllocationService,
    @Inject(VanStockService) vanStock: VanStockService,
    @Inject(CreditNoteService) creditNotes: CreditNoteService,
  ) {
    // The handlers call the DI'd owning-module services (single source of
    // instances; specs instantiate this class directly, which wires the
    // same slots — the leads.spec pattern).
    configureHandlerServices({
      posSales,
      shiftFlow,
      audit,
      invoices,
      partners,
      quotations,
      deliveries,
      expenses,
      treasuryTransfers,
      inventoryTransfers,
      stockCounts,
      receipts,
      allocations,
      vanStock,
      creditNotes,
    });
  }

  /** Verify the pushing device: exists, pos-terminal class, not revoked —
   * rejected BEFORE any command executes (SYNC_PROTOCOL §1.5; zero
   * effects on revocation). Kept byte-identical for the 016 controller
   * (status + pull routes); the v2 push() resolves its own device row. */
  async requireActivePosDevice(deviceId: string): Promise<void> {
    const tx = requireTenantContext().tx!;
    const rows = await tx.execute(sql`
      SELECT platform, revoked_at AS "revokedAt" FROM devices WHERE id = ${deviceId} LIMIT 1
    `);
    const device = (rows.rows as unknown as { platform: string; revokedAt: string | null }[])[0];
    if (device === undefined) {
      throw new PosDeviceNotFoundError(deviceId);
    }
    if (device.platform !== "pos-terminal") {
      throw new PosDeviceNotTerminalError(`device ${deviceId} is platform ${device.platform}`);
    }
    if (device.revokedAt !== null) {
      throw new PosDeviceRevokedError(deviceId);
    }
  }

  /**
   * Execute one batch: per-item results; a failing command never affects
   * its siblings (C-03 partial-batch discipline — the per-item savepoint
   * keeps a rejected command's partial writes out of the commit).
   *
   * Input: the 016 shape ({deviceId, batchId, commands}) keeps working
   * (contractVersion absent = legacy wire); v2 adds `contractVersion?`.
   */
  async push(input: {
    deviceId: string;
    batchId?: string;
    commands: unknown[];
    contractVersion?: string;
  }): Promise<{ results: InternalItem[] }> {
    // 016 compat guards: empty batch + the 50-command budget.
    if (input.commands.length === 0) {
      return { results: [] };
    }
    if (input.commands.length > MAX_PUSH_BATCH) {
      throw new PosSyncCommandInvalidError(
        `batch exceeds the 50-command budget (got ${input.commands.length})`,
      );
    }
    // The batch byte budget (SYNC_PROTOCOL §3 "≤ 50 commands OR ≤ 1 MB";
    // D-03): a serialized batch past 1 MB is a malformed envelope — typed
    // SYNC_COMMAND_INVALID, never a silent truncate. The controller
    // repeats the check (defense in depth); the service is the single
    // enforcement point for non-HTTP callers.
    if (Buffer.byteLength(JSON.stringify(input.commands), "utf8") > 1_000_000) {
      throw new PosSyncCommandInvalidError("push batch exceeds the 1 MB budget");
    }
    const tx = requireTenantContext().tx!;

    // 1. Device row (service-mediated — no RLS on devices by design).
    const deviceRows = await tx.execute(sql`
      SELECT id, user_id AS "userId", platform, device_class AS "deviceClass",
             revoked_at AS "revokedAt", trust_flags AS "trustFlags"
      FROM devices WHERE id = ${input.deviceId}::uuid LIMIT 1
    `);
    const device = (deviceRows.rows as unknown as DeviceRow[])[0];
    if (device === undefined) {
      // Keep the 016 error (whole-request — no device, no per-item semantics).
      throw new PosDeviceNotFoundError(input.deviceId);
    }
    const deviceClass = device.deviceClass ?? platformToClass(device.platform);

    // 2. Tenant suspended (C-14) — per-item for ALL commands, zero
    //    execution, never in the inbox (retryable tenant state: after
    //    restore the client re-pushes and the commands EXECUTE — C-14's
    //    "resume, no duplicates" depends on not having recorded these).
    const tenantRows = await tx.execute(
      sql`SELECT status FROM tenants WHERE id = erp.current_tenant_id() LIMIT 1`,
    );
    const tenantStatus =
      (tenantRows.rows as unknown as { status: string }[])[0]?.status ?? "ACTIVE";
    const suspended = tenantStatus !== "ACTIVE";

    // 3. Revoked (C-06) — same channel as suspended.
    const revoked = device.revokedAt !== null;

    // 4. Contract gate (C-08) — per-item, resubmittable false; v2 only
    //    (a legacy batch carries no contractVersion; the 016 terminal IS
    //    the supported baseline).
    const badContract =
      input.contractVersion !== undefined && !isContractSupported(input.contractVersion);

    // 5. Rate limit — only when the gates above pass (a gated push never
    //    consumes a token). DEFERRED items are NOT executed, NOT in inbox.
    const deferred =
      !suspended && !revoked && !badContract && !consumeRateToken(input.deviceId);

    const v2 = input.contractVersion !== undefined;
    const results: InternalItem[] = [];
    // Within-batch idempotencyKey tracking (016 behavior, refined: the
    // second occurrence replays the FIRST command's result + duplicate —
    // recorded in T-P20-2b-push.md as a v2 refinement over the {deduped}
    // echo).
    const seen = new Map<string, InternalItem>();

    for (const raw of input.commands) {
      // a. Normalize (v2 / legacy / shape-reject).
      const parsed = normalize(raw);
      if (!parsed.ok) {
        const item: InternalItem = {
          id: parsed.id,
          status: "REJECTED",
          idempotencyKey: parsed.idempotencyKey,
          reason: "VALIDATION_ERROR",
          message: parsed.message,
          action: actionForSyncRejection("VALIDATION_ERROR"),
          ...(v2
            ? {
                resubmittable: RESUBMITTABLE_BY_REASON.VALIDATION_ERROR,
                localized: LOCALIZED_BY_REASON.VALIDATION_ERROR,
              }
            : {}),
        };
        // Shape-rejected commands are never executed → never in the inbox.
        results.push(v2 ? item : toLegacyItem(item));
        continue;
      }
      const command = parsed.command;
      const finish = (item: InternalItem): InternalItem => (v2 ? item : toLegacyItem(item));

      // Device/tenant/contract/rate gates (identical for every command).
      if (suspended) {
        results.push(
          finish({
            id: command.commandId,
            status: "REJECTED",
            idempotencyKey: command.idempotencyKey,
            reason: "TENANT_SUSPENDED",
            message: `tenant is suspended — pushes are paused until it is restored`,
            action: actionForSyncRejection("TENANT_SUSPENDED"),
            ...(v2
              ? {
                  commandId: command.commandId,
                  resubmittable: false,
                  localized: LOCALIZED_BY_REASON.TENANT_SUSPENDED,
                }
              : {}),
          }),
        );
        continue;
      }
      if (revoked) {
        results.push(
          finish({
            id: command.commandId,
            status: "REJECTED",
            idempotencyKey: command.idempotencyKey,
            reason: "DEVICE_REVOKED",
            message: `device ${input.deviceId} is revoked — pushes are rejected before execution`,
            action: actionForSyncRejection("DEVICE_REVOKED"),
            ...(v2
              ? {
                  commandId: command.commandId,
                  resubmittable: false,
                  localized: LOCALIZED_BY_REASON.DEVICE_REVOKED,
                }
              : {}),
          }),
        );
        continue;
      }
      if (badContract) {
        results.push(
          finish({
            id: command.commandId,
            status: "REJECTED",
            idempotencyKey: command.idempotencyKey,
            reason: "CONTRACT_VERSION_UNSUPPORTED",
            message: `contract version ${input.contractVersion} is not supported (server: ${SYNC_CONTRACT_VERSION} + grace list)`,
            action: actionForSyncRejection("CONTRACT_VERSION_UNSUPPORTED"),
            ...(v2
              ? {
                  commandId: command.commandId,
                  resubmittable: false,
                  localized: LOCALIZED_BY_REASON.CONTRACT_VERSION_UNSUPPORTED,
                }
              : {}),
          }),
        );
        continue;
      }
      if (deferred) {
        results.push(
          finish({
            id: command.commandId,
            status: "DEFERRED",
            idempotencyKey: command.idempotencyKey,
            reason: "RATE_LIMITED",
            message: `push rate limit exceeded — retry after ${RATE_RETRY_AFTER_MS}ms`,
            ...(v2
              ? {
                  commandId: command.commandId,
                  retryAfterMs: RATE_RETRY_AFTER_MS,
                  localized: LOCALIZED_BY_REASON.RATE_LIMITED,
                }
              : {}),
          }),
        );
        continue;
      }

      // b. ONLINE_ONLY guard BEFORE handler lookup (MASTER-PLAN §6.6):
      //    never recorded in the inbox (never executed — the entity list
      //    itself is the verdict; re-evaluation on redelivery is exact).
      if ((ONLINE_ONLY_ENTITIES as readonly string[]).includes(command.entityType)) {
        const item: InternalItem = {
          id: command.commandId,
          status: "REJECTED",
          idempotencyKey: command.idempotencyKey,
          reason: "FORBIDDEN",
          message: `entity type ${command.entityType} is online-only — it is never writable from a device`,
          action: actionForSyncRejection("FORBIDDEN"),
          ...(v2
            ? {
                commandId: command.commandId,
                resubmittable: false,
                localized: LOCALIZED_BY_REASON.FORBIDDEN,
              }
            : {}),
        };
        seen.set(command.idempotencyKey, item);
        results.push(finish(item));
        continue;
      }

      // g. Within-batch duplicate idempotencyKey: replay the FIRST
      //    command's result + duplicate:true (016 refined — see file head).
      const withinBatch = seen.get(command.idempotencyKey);
      if (withinBatch !== undefined) {
        const replay: InternalItem = { ...withinBatch, duplicate: true };
        results.push(finish(replay));
        continue;
      }

      // c. Inbox lookup (C-01/C-04): a hit replays the STORED result
      //    verbatim + duplicate:true — NEVER re-executes.
      const stored: PushItemResultV2 | null = await findInboxResult({
        deviceId: input.deviceId,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
      });
      if (stored !== null) {
        const replay: InternalItem = {
          ...(stored as InternalItem),
          duplicate: true,
          commandId: command.commandId,
        };
        seen.set(command.idempotencyKey, replay);
        results.push(finish(replay));
        continue;
      }

      // d. Handler lookup: no handler → VALIDATION_ERROR with the
      //    supported registry (self-diagnosing client).
      const handler = handlerFor(command.entityType, command.intent);
      if (handler === undefined) {
        const item: InternalItem = {
          id: command.commandId,
          status: "REJECTED",
          idempotencyKey: command.idempotencyKey,
          reason: "VALIDATION_ERROR",
          message: `no handler for ${command.entityType}:${command.intent}`,
          details: { supported: handlerRegistryKeys() },
          action: actionForSyncRejection("VALIDATION_ERROR"),
          ...(v2
            ? {
                commandId: command.commandId,
                resubmittable: RESUBMITTABLE_BY_REASON.VALIDATION_ERROR,
                localized: LOCALIZED_BY_REASON.VALIDATION_ERROR,
              }
            : {}),
        };
        seen.set(command.idempotencyKey, item);
        results.push(finish(item));
        continue;
      }

      // e/f. Execute inside a per-item savepoint (zero-residue: the
      //     ambient tx cannot roll back per item — C-03/C-15). The inbox
      //     row + feed entries commit with the command in the same UoW.
      const ctx: SyncHandlerContext = {
        deviceId: input.deviceId,
        deviceClass,
        userId: device.userId,
        command,
      };
      await tx.execute(sql`SAVEPOINT sync_push_item`);
      let outcome: HandlerOutcome;
      try {
        outcome = await handler(ctx);
        const accepted: InternalItem = {
          id: command.commandId,
          status: "ACCEPTED",
          idempotencyKey: command.idempotencyKey,
          result: outcome.result,
          ...(v2
            ? {
                commandId: command.commandId,
                entity: outcome.entity,
                officialNumber: outcome.officialNumber,
                effects: outcome.effects,
                localized: outcome.localized,
              }
            : {}),
        };
        await recordInboxResult({
          deviceId: input.deviceId,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          entityType: command.entityType,
          intent: command.intent,
          result: accepted,
        });
        if (outcome.feedEntries !== undefined && outcome.feedEntries.length > 0) {
          await publishFeedEntries(outcome.feedEntries);
        }
        await tx.execute(sql`RELEASE SAVEPOINT sync_push_item`);
        seen.set(command.idempotencyKey, accepted);
        results.push(finish(accepted));
      } catch (error) {
        // Roll the item's partial writes back (never committed), then
        // record the typed rejection in the inbox — redeliveries replay
        // it (C-01 covers REJECTED results too).
        await tx.execute(sql`ROLLBACK TO SAVEPOINT sync_push_item`);
        const rejected = rejectFromSyncError(error, command);
        try {
          await recordInboxResult({
            deviceId: input.deviceId,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            entityType: command.entityType,
            intent: command.intent,
            result: rejected,
          });
        } catch {
          // The rejection stands even if the inbox row cannot be written
          // (an INSERT failure here is a DB-level catastrophe; the item
          // result must not swallow the original rejection).
        }
        seen.set(command.idempotencyKey, rejected);
        results.push(finish(rejected));
      }
    }
    // PHASE-025 T9c wiring — the sync-push SLO (MONITORING §5 ≥ 99.5%
    // within 24 h; the in-process window is process-lifetime): terminal
    // outcomes only (ACCEPTED + REJECTED — the health aggregate's
    // successRate definition; DEFERRED is backpressure, never a terminal
    // failure, so it lands in its own observability counter).
    let acceptedCount = 0;
    let rejectedCount = 0;
    let deferredCount = 0;
    for (const item of results) {
      if (item.status === "ACCEPTED") {
        acceptedCount += 1;
      } else if (item.status === "REJECTED") {
        rejectedCount += 1;
      } else {
        deferredCount += 1;
      }
    }
    processMetrics.recordSyncPushOutcomes({
      accepted: acceptedCount,
      rejected: rejectedCount,
      deferred: deferredCount,
    });
    return { results };
  }
}
