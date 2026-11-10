import ExcelJS from "exceljs";

import type { ReportResult } from "../contract";

/**
 * PHASE-013 T13 · XLSX export via exceljs (PRINTING_AND_EXPORT §4):
 * RTL sheet views when the run locale is Arabic (column A on the right),
 * typed columns (money/qty as numbers with formats, identifiers as text —
 * leading zeros preserved), bilingual title rows, frozen header,
 * values only (NO formulas — ADR-0011 auditability), and the
 * self-describing footer block (asOf/computedAt/assertions).
 */

export async function renderXlsx(report: ReportResult): Promise<Buffer> {
  const locale = report.formatting.locale;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Reporting";
  const sheet = workbook.addWorksheet("Report", {
    views: [{ rightToLeft: locale === "ar", state: "frozen", ySplit: 0 }],
  });

  // Bilingual title rows above the header when the locale is Arabic.
  sheet.addRow([report.reportId]);
  if (locale === "ar") {
    sheet.addRow(["التقرير", report.columns.length > 0 ? report.columns[0]!.label.en : ""]);
  }
  sheet.addRow([]);

  const headerRow = sheet.addRow(report.columns.map((column) => column.label[locale]));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F1F1" } };
  });

  for (const row of report.rows) {
    sheet.addRow(
      report.columns.map((column) => {
        const value = row.values[column.id];
        if (value === null || value === undefined || value === "") {
          return "" as unknown as number;
        }
        if (column.type === "money" || column.type === "qty") {
          const numeric = Number(value);
          if (Number.isFinite(numeric) && column.id !== "accountCode" && column.id !== "sku") {
            return numeric;
          }
        }
        return String(value);
      }),
    );
  }

  // Column formats + widths from widthHint.
  report.columns.forEach((column, index) => {
    const letter = sheet.getColumn(index + 1).letter;
    if (column.type === "money") {
      sheet.getColumn(index + 1).numFmt = "#,##0.00";
    } else if (column.type === "qty") {
      sheet.getColumn(index + 1).numFmt = "#,##0.000";
    }
    sheet.getColumn(index + 1).width = column.widthHint ?? Math.max(14, column.label.en.length + 4);
    void letter;
  });

  if (report.totals.length > 0) {
    sheet.addRow([]);
    for (const total of report.totals) {
      const row = sheet.addRow([total.label[locale], Number(total.amount)]);
      row.font = { bold: total.kind === "check" };
    }
  }

  // Footer block (§4.5): the workbook states what it is without its row.
  sheet.addRow([]);
  sheet.addRow([locale === "ar" ? "كما في" : "as of", report.freshness.asOf ?? report.freshness.computedAt]);
  sheet.addRow([locale === "ar" ? "وقت الاحتساب" : "computed at", report.freshness.computedAt]);
  sheet.addRow([locale === "ar" ? "العملة الأساسية" : "base currency", report.formatting.baseCurrency]);
  for (const assertion of report.assertions) {
    sheet.addRow([assertion.id, assertion.status]);
  }

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

/** Workbook inspection helper (export-correctness tests: no formulas). */
export async function inspectWorkbook(
  buffer: Buffer,
): Promise<{ formulas: string[]; rightToLeft: boolean; sheetNames: string[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const formulas: string[] = [];
  const sheet = workbook.worksheets[0]!;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.type === ExcelJS.ValueType.Formula) {
        formulas.push(String(cell.value));
      }
    });
  });
  return {
    formulas,
    rightToLeft: sheet.views?.[0]?.rightToLeft === true,
    sheetNames: workbook.worksheets.map((s) => s.name),
  };
}
