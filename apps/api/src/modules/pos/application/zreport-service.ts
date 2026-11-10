import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-016 T12 · the Z report (end-of-day close): shift-derived,
 * read-only derivation over POSTED POS invoices + the shift record —
 * sales by order type, by tender, per shift, with the Z number
 * `Z-{branchCode}-{yyyyMMdd}` and the GL tie-out totals that
 * `treasury.shift_cash_reconciliation` reconciles against. Printing rides
 * the PHASE-013 report contract (the print templates); no new posting
 * rules — the cash-drop transfer to safe/bank is the treasury transfer
 * service (DR safe/bank · CR till).
 */

@Injectable()
export class PosZReportService {
  /** Build the Z report for a branch + date (or a specific shift). */
  async build(input: { branchId: string; date: string; shiftId?: string }) {
    const tx = requireTenantContext().tx!;
    const params = { branchId: input.branchId, date: input.date, shiftId: input.shiftId ?? null };

    // Posted POS invoices of the day (server dates = invoice dates; the
    // shift filter narrows to invoices created during the shift window).
    const invoices = await tx.execute(sql`
      SELECT i.id, i.invoice_no AS "invoiceNo", i.offline_receipt_no AS "offlineReceiptNo",
             i.order_type AS "orderType", i.total_net AS "totalNet", i.total_tax AS "totalTax",
             i.total_gross AS "totalGross", i.tenders, i.created_at AS "createdAt",
             i.pos_terminal_id AS "posTerminalId"
      FROM sales_invoices i
      WHERE i.channel = 'POS' AND i.status = 'POSTED'
        AND i.branch_id = ${params.branchId} AND i.invoice_date = ${params.date}
        AND (${params.shiftId}::uuid IS NULL OR i.created_at <= now())
      ORDER BY i.created_at
    `);
    const rows = invoices.rows as unknown as {
      id: string;
      invoiceNo: string | null;
      offlineReceiptNo: string | null;
      orderType: string | null;
      totalNet: string;
      totalTax: string;
      totalGross: string;
      tenders: { method: string; amount: string }[] | null;
      createdAt: string;
      posTerminalId: string | null;
    }[];

    const byOrderType = new Map<string, { count: number; net: number; tax: number; gross: number }>();
    const byTender = new Map<string, number>();
    const byTerminal = new Map<string, { count: number; gross: number }>();
    const byHour = new Map<string, { count: number; gross: number }>();
    let totalNet = 0;
    let totalTax = 0;
    let totalGross = 0;
    const lines: {
      invoiceNo: string | null;
      offlineReceiptNo: string | null;
      orderType: string;
      gross: string;
      createdAt: string;
    }[] = [];
    for (const row of rows) {
      const orderType = row.orderType ?? "COUNTER";
      const bucket = byOrderType.get(orderType) ?? { count: 0, net: 0, tax: 0, gross: 0 };
      bucket.count += 1;
      bucket.net += Number(row.totalNet);
      bucket.tax += Number(row.totalTax);
      bucket.gross += Number(row.totalGross);
      byOrderType.set(orderType, bucket);
      totalNet += Number(row.totalNet);
      totalTax += Number(row.totalTax);
      totalGross += Number(row.totalGross);
      for (const tender of row.tenders ?? []) {
        byTender.set(tender.method, (byTender.get(tender.method) ?? 0) + Number(tender.amount));
      }
      const terminalKey = row.posTerminalId ?? "unknown";
      const terminalBucket = byTerminal.get(terminalKey) ?? { count: 0, gross: 0 };
      terminalBucket.count += 1;
      terminalBucket.gross += Number(row.totalGross);
      byTerminal.set(terminalKey, terminalBucket);
      const hour = new Date(row.createdAt).toISOString().slice(11, 13);
      const hourBucket = byHour.get(hour) ?? { count: 0, gross: 0 };
      hourBucket.count += 1;
      hourBucket.gross += Number(row.totalGross);
      byHour.set(hour, hourBucket);
      lines.push({
        invoiceNo: row.invoiceNo,
        offlineReceiptNo: row.offlineReceiptNo,
        orderType,
        gross: row.totalGross,
        createdAt: row.createdAt,
      });
    }

    // The shift context (if provided): expected/counted/difference for the
    // reconciliation panel (treasury.shift_cash_reconciliation parity).
    let shift: Record<string, unknown> | null = null;
    if (input.shiftId !== undefined) {
      const shiftRows = await tx.execute(sql`
        SELECT id, status, shift_no AS "shiftNo", opening_amount AS "openingAmount",
               captured_in AS "capturedIn", captured_out AS "capturedOut",
               expected_amount AS "expectedAmount", counted_amount AS "countedAmount",
               difference, pos_terminal_id AS "posTerminalId", opened_at AS "openedAt",
               closed_at AS "closedAt"
        FROM cashier_shifts WHERE id = ${input.shiftId} LIMIT 1
      `);
      shift = ((shiftRows.rows as unknown as Record<string, unknown>[])[0] ?? null) as
        | Record<string, unknown>
        | null;
    }

    // The OFF- ⇄ official reconciliation listing (BR-029/A-010): every
    // offline-originated invoice carries both numbers 1:1.
    const offlineReconciliation = lines.filter((line) => line.offlineReceiptNo !== null);

    const branchRow = await tx.execute(sql`
      SELECT code FROM branches WHERE id = ${input.branchId} LIMIT 1
    `);
    const branchCode = (branchRow.rows as unknown as { code: string }[])[0]?.code ?? "XX";

    return {
      zNumber: `Z-${branchCode}-${input.date.replace(/-/g, "")}`,
      branchId: input.branchId,
      date: input.date,
      totals: {
        invoiceCount: rows.length,
        totalNet: totalNet.toFixed(4),
        totalTax: totalTax.toFixed(4),
        totalGross: totalGross.toFixed(4),
      },
      byOrderType: [...byOrderType.entries()].map(([type, bucket]) => ({
        orderType: type,
        count: bucket.count,
        net: bucket.net.toFixed(4),
        tax: bucket.tax.toFixed(4),
        gross: bucket.gross.toFixed(4),
      })),
      byTender: [...byTender.entries()].map(([method, amount]) => ({
        method,
        amount: amount.toFixed(4),
      })),
      byTerminal: [...byTerminal.entries()].map(([terminalId, bucket]) => ({
        terminalId,
        count: bucket.count,
        gross: bucket.gross.toFixed(4),
      })),
      byHour: [...byHour.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([hour, bucket]) => ({
        hour,
        count: bucket.count,
        gross: bucket.gross.toFixed(4),
      })),
      offlineReconciliation,
      shift,
    };
  }
}
