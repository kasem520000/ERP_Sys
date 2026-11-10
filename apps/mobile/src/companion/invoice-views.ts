/**
 * PHASE-022 T-P22-3-b · the own-documents invoice views (MASTER-PLAN §8
 * row 14; OFFLINE_CAPABILITIES_MATRIX row 14): the companion's OWN
 * documents — locally-created (the field flows' outbox rows, any honest
 * state) + synced (the ACKED rows with their official numbers) — plus
 * the cached server invoices (the `sales_invoices` read model, the
 * personal profile's own list).
 *
 * READ-CACHED† only — no writes, no enqueue, no command builders (the
 * structural no-write proof covers this module). The official number
 * appears ONLY on ACKED rows (state honesty: no locally created state is
 * ever presented as posted); the local OFF- reference is the local
 * identity until then; every row carries its as-of.
 */
import type { StorageAdapter } from "@erp/sync-core";

import { mulDecimals, subDecimals, sumDecimals } from "../exact-decimal";
import { flowRows, type HonestFlowState } from "../fieldsales/state-machine";

/** One of the device's own documents (a locally-created + synced row). */
export interface OwnDocumentRow {
  readonly commandId: string;
  /** The payload's entity identity (an edit intent's invoiceId; null for
   * offline creates whose id the server assigns on accept). */
  readonly entityId: string | null;
  /** The OFF- local reference (the local identity until the official no). */
  readonly localRef: string | null;
  /** The server-assigned number (ACKED rows only — never a guess). */
  readonly officialNo: string | null;
  readonly partnerId: string | null;
  readonly orderDate: string | null;
  readonly totalAmount: string;
  readonly currencyCode: string | null;
  readonly state: HonestFlowState;
  /** The server document status of an ACKED command (e.g. "DRAFT"). */
  readonly serverStatus: string | null;
  /** When this state was last known (ackedAt, else the local capture). */
  readonly asOf: string | null;
}

/** One cached server invoice (the sales_invoices read model). */
export interface CachedInvoiceRow {
  readonly id: string;
  readonly invoiceNo: string | null;
  readonly status: string;
  readonly kind: string | null;
  readonly customerId: string | null;
  readonly orderDate: string | null;
  readonly totalAmount: string | null;
  readonly currency: string | null;
  readonly updatedAt: string | null;
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function documentTotal(payload: Record<string, unknown>): string {
  if (Array.isArray(payload.lines)) {
    return sumDecimals(
      (payload.lines as Record<string, unknown>[]).map((line) => {
        const qty = typeof line.qty === "string" ? line.qty : "0";
        const price = typeof line.unitPrice === "string" ? line.unitPrice : "0";
        const net = mulDecimals(qty, price);
        return typeof line.discountAmount === "string" && line.discountAmount !== ""
          ? subDecimals(net, line.discountAmount)
          : net;
      }),
    );
  }
  return typeof payload.amount === "string" ? payload.amount : "0";
}

function serverStatusOf(acceptedResult: string | null): string | null {
  if (acceptedResult === null) return null;
  try {
    const parsed = JSON.parse(acceptedResult) as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : null;
  } catch {
    return null;
  }
}

/**
 * The device's OWN documents (row 14): every `sales_invoice:create_draft`
 * outbox row — locally-created (PENDING_SYNC / REJECTED / CANCELLED) and
 * synced (ACKED, with the official number) — newest first. `entityType` +
 * `intent` default to the van-sale draft invoice; the flow-state is the
 * state machine's honest read of the row.
 */
export function buildOwnDocuments(
  adapter: StorageAdapter,
  input: { entityType?: string; intent?: string; limit?: number } = {},
): OwnDocumentRow[] {
  const rows = flowRows(
    adapter,
    input.entityType ?? "sales_invoice",
    input.intent ?? "create_draft",
  ).slice(0, input.limit ?? 50);
  return rows.map((row) => {
    const payload = parsePayload(row.payload);
    const entityId =
      (typeof payload.invoiceId === "string" && payload.invoiceId) ||
      (typeof payload.entityId === "string" && payload.entityId) ||
      null;
    const state: HonestFlowState =
      row.status === "ACKED"
        ? "POSTED"
        : row.status === "REJECTED"
          ? "REJECTED"
          : row.status === "CANCELLED"
            ? "CANCELLED"
            : "PENDING_SYNC";
    return {
      commandId: row.commandId,
      entityId,
      localRef: row.localRef,
      officialNo: row.officialNo,
      partnerId: typeof payload.customerId === "string" ? payload.customerId : null,
      orderDate: typeof payload.orderDate === "string" ? payload.orderDate : null,
      totalAmount: documentTotal(payload),
      currencyCode: typeof payload.currencyCode === "string" ? payload.currencyCode : null,
      state,
      serverStatus: serverStatusOf(row.acceptedResult),
      asOf: row.ackedAt ?? row.clientCreatedAt,
    };
  });
}

/** The cached server invoices (the read model; newest-updated first). */
export function buildCachedInvoices(
  adapter: StorageAdapter,
  input: { limit?: number } = {},
): CachedInvoiceRow[] {
  return adapter
    .all(
      `SELECT id, invoice_no, status, kind, customer_id, order_date, total_amount, currency, updated_at
         FROM sales_invoices ORDER BY updated_at DESC, id LIMIT ?`,
      [input.limit ?? 50],
    )
    .map((row) => ({
      id: String(row.id),
      invoiceNo: row.invoice_no === null || row.invoice_no === undefined ? null : String(row.invoice_no),
      status: String(row.status ?? ""),
      kind: row.kind === null || row.kind === undefined ? null : String(row.kind),
      customerId:
        row.customer_id === null || row.customer_id === undefined ? null : String(row.customer_id),
      orderDate:
        row.order_date === null || row.order_date === undefined ? null : String(row.order_date),
      totalAmount:
        row.total_amount === null || row.total_amount === undefined ? null : String(row.total_amount),
      currency: row.currency === null || row.currency === undefined ? null : String(row.currency),
      updatedAt:
        row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
    }));
}
