import { Inject, Injectable } from "@nestjs/common";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { FilesService } from "../../files/api/files";
import * as partnerStore from "../../partners/infrastructure/partners.store";
import * as store from "../infrastructure/items.store";

/**
 * Export service (PHASE-006 §2.6/T8): bounded synchronous generation of
 * partners/items/opening-balance-draft exports as CSV (UTF-8 **with BOM**
 * per PRINTING_AND_EXPORT CSV rules — Arabic round-trips cleanly in Excel)
 * or XLSX, stored via the files module under the tenant prefix and handed
 * back as a tenant-bound signed URL (A11-tested). Exports are audited with
 * row counts (matrix: `items.import.run` gates bulk data operations).
 */

const MAX_EXPORT_ROWS = 10_000;

export interface ExportInput {
  kind: "PARTNERS" | "ITEMS" | "OPENING_BALANCES";
  format: "CSV" | "XLSX";
}

export interface ExportResult {
  downloadUrl: string;
  expiresInSeconds: number;
  rowCount: number;
  kind: string;
  format: string;
}

@Injectable()
export class ExportService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  async run(actorId: string, input: ExportInput): Promise<ExportResult> {
    const tenantId = (await import("../../../infra/db/tenant-context")).requireTenantContext().tenantId;
    const { headers, rows } = await collectExport(input.kind);
    const bytes =
      input.format === "CSV" ? toCsv(headers, rows) : await toXlsx(headers, rows);
    const contentType =
      input.format === "CSV"
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const stamp = new Date().toISOString().slice(0, 10);
    const extension = input.format === "CSV" ? "csv" : "xlsx";
    const { key } = await this.files.writeObject(
      tenantId,
      `${input.kind.toLowerCase()}-export-${stamp}.${extension}`,
      bytes,
      contentType,
    );
    const downloadUrl = await this.files.issueDownloadUrl(tenantId, key);
    await this.audit.record({
      action: "export.completed",
      entityType: "export",
      entityId: generateUuidV7(),
      actorId,
      after: { kind: input.kind, format: input.format, rows: rows.length, key },
    });
    return {
      downloadUrl,
      expiresInSeconds: 900,
      rowCount: rows.length,
      kind: input.kind,
      format: input.format,
    };
  }
}

async function collectExport(
  kind: ExportInput["kind"],
): Promise<{ headers: string[]; rows: string[][] }> {
  if (kind === "PARTNERS") {
    const page = await partnerStore.listPartners({}, undefined, MAX_EXPORT_ROWS);
    const all = [...page.rows];
    // bounded walk (≤ MAX_EXPORT_ROWS total — the guard below truncates)
    while (all.length < MAX_EXPORT_ROWS && page.hasMore) {
      const next = await partnerStore.listPartners({}, page.nextCursor ?? undefined, MAX_EXPORT_ROWS);
      all.push(...next.rows);
      if (!next.hasMore) {
        break;
      }
      page.hasMore = next.hasMore;
      page.nextCursor = next.nextCursor;
    }
    return {
      headers: ["code", "kind", "name", "name_ar", "tax_number", "credit_limit", "credit_terms_id", "price_list_id", "status"],
      rows: all
        .slice(0, MAX_EXPORT_ROWS)
        .map((row) => [
          row.code,
          row.kind,
          row.name,
          row.nameAr ?? "",
          row.taxNumber ?? "",
          row.creditLimit ?? "",
          row.creditTermsId ?? "",
          row.priceListId ?? "",
          row.status,
        ]),
    };
  }
  if (kind === "ITEMS") {
    let page = await store.listItems({}, undefined, MAX_EXPORT_ROWS);
    const all = [...page.rows];
    while (all.length < MAX_EXPORT_ROWS && page.hasMore) {
      const next = await store.listItems({}, page.nextCursor ?? undefined, MAX_EXPORT_ROWS);
      all.push(...next.rows);
      if (!next.hasMore) {
        break;
      }
      page = { ...page, hasMore: next.hasMore, nextCursor: next.nextCursor };
    }
    return {
      headers: ["sku", "name", "name_ar", "kind", "uom_id", "category_id", "costing_method", "base_price", "reorder_level", "reorder_qty", "status"],
      rows: all
        .slice(0, MAX_EXPORT_ROWS)
        .map((row) => [
          row.sku,
          row.name,
          row.nameAr ?? "",
          row.kind,
          row.uomId,
          row.categoryId ?? "",
          row.costingMethod,
          row.basePrice ?? "",
          row.reorderLevel ?? "",
          row.reorderQty ?? "",
          row.status,
        ]),
    };
  }
  const page = await partnerStore.listOpeningBalanceDocs(undefined, undefined, MAX_EXPORT_ROWS);
  const rows = (page.rows as unknown as partnerStore.OpeningBalanceDocRow[]).slice(0, MAX_EXPORT_ROWS);
  return {
    headers: ["kind", "partner_id", "account_id", "item_id", "qty", "unit_cost", "amount", "currency_code", "status", "note"],
    rows: rows.map((row) => [
      row.kind,
      row.partnerId ?? "",
      row.accountId ?? "",
      row.itemId ?? "",
      row.qty ?? "",
      row.unitCost ?? "",
      row.amount ?? "",
      row.currencyCode,
      row.status,
      row.note ?? "",
    ]),
  };
}

/** CSV per PRINTING_AND_EXPORT: UTF-8 BOM + RFC-4180 quoting. */
function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): Buffer {
  const quote = (value: string): string => {
    const escaped = value.replace(/"/g, '""');
    return /[",;\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };
  const lines = [headers.map(quote).join(","), ...rows.map((row) => row.map(quote).join(","))];
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function toXlsx(headers: readonly string[], rows: readonly (readonly string[])[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")) as typeof import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("export");
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row);
  }
  const written = await workbook.xlsx.writeBuffer();
  return Buffer.from(written);
}
