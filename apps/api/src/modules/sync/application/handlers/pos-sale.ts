import { sql } from "drizzle-orm";

import { posSaleCommandSchema, type PosSaleCommand } from "@erp/contracts";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import {
  handlerServices,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-020 · `pos_sale:create` (MASTER-PLAN §7 SERVER_DECISION row;
 * SYNC_PROTOCOL §3/§6; CONFLICT_RESOLUTION §2 financial-documents row).
 * The 016 offline sale, verbatim: PosSaleService.submitOffline through the
 * sales module's posting engine — period/price/stock/credit validated
 * there (typed errors map to per-item rejections), dedupe on the
 * (terminal, OFF- number) pair + the posting-operation key (INV-013) —
 * the §11 second layer beyond the inbox.
 *
 * Accepts BOTH shapes: the legacy command object (payload = the whole
 * {type, id, idempotencyKey, createdAt, sale}) and the v2 payload
 * (payload = {sale: {…}} — the same inner shape, schema-validated with the
 * SAME contracts schema so v2 and legacy are byte-parity on the wire).
 */

function saleOf(ctx: SyncHandlerContext): PosSaleCommand["sale"] {
  if (ctx.command.legacy) {
    // The push service already parsed the legacy command with
    // posSaleCommandSchema — the payload IS the parsed command.
    return (ctx.command.payload as PosSaleCommand).sale;
  }
  const raw = (ctx.command.payload as { sale?: unknown })?.sale;
  return posSaleCommandSchema.shape.sale.parse(raw);
}

/** The server row version (sales_invoices.version) for the feed marker. */
async function invoiceVersion(invoiceId: string): Promise<number> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(
    sql`SELECT version FROM sales_invoices WHERE id = ${invoiceId} LIMIT 1`,
  );
  const row = (rows.rows as unknown as { version: number }[])[0];
  return row?.version ?? 1;
}

export const posSaleCreateHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  const sale = saleOf(ctx);
  // The 016 executeCommand mapping, verbatim (actorId null — the device
  // user is recorded on the audit trail by the service, the command rides
  // the device identity).
  const outcome = await handlerServices().posSales.submitOffline({
    terminalId: sale.terminalId,
    customerId: sale.customerId,
    lines: sale.lines.map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount ?? null,
      taxCodeId: line.taxCodeId ?? null,
      serialIds: line.serialIds ?? null,
    })),
    tenders: sale.tenders.map((tender) => ({
      method: tender.method,
      amount: tender.amount,
      reference: tender.reference ?? null,
    })),
    orderType: sale.orderType,
    checkId: sale.checkId ?? null,
    offlineReceiptNo: sale.offlineReceiptNo,
    clientId: sale.clientId,
    invoiceDate: sale.invoiceDate,
    actorId: null,
    idempotencyKey: ctx.command.idempotencyKey,
  });

  const invoice = outcome.invoice;
  const version = await invoiceVersion(invoice.id);
  // Effects + feed entries only when this delivery actually executed — a
  // submitOffline replay (the (terminal, OFF-) pair hit) added nothing.
  const executed = !outcome.replay;
  return {
    status: "ACCEPTED",
    // Byte-parity with the 016 result field set (id/status/idempotencyKey/
    // result ride the legacy wire unchanged).
    result: {
      invoiceId: invoice.id,
      officialNo: invoice.invoiceNo,
      offlineReceiptNo: sale.offlineReceiptNo,
      journalEntryId: invoice.postedJournalId,
      replay: outcome.replay,
    },
    entity: { id: invoice.id, version },
    officialNumber: invoice.invoiceNo ?? undefined,
    effects: executed && invoice.postedJournalId !== null
      ? { journalEntryIds: [invoice.postedJournalId] }
      : undefined,
    feedEntries: executed
      ? [
          {
            // Header-only marker payload: the catch-up writer projects the
            // full row at pull time — {id, version} is the dedupe/version
            // signal (MASTER-PLAN §1.3b).
            entityType: "sales_invoices",
            entityId: invoice.id,
            op: "UPSERT" as const,
            payload: { id: invoice.id, version },
          },
        ]
      : undefined,
  };
};
