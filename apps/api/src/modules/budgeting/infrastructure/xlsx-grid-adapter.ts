import ExcelJS from "exceljs";

import { BudgetImportFormatError } from "../domain/budgeting-errors";

/**
 * The budget grid XLSX adapter (PHASE-028 T8 — the PHASE-013 export
 * pipeline's exceljs discipline applied to module data): RTL sheet views
 * when the locale is Arabic (column A on the right), money as numbers with
 * the 4dp tabular format `#,##0.0000`, bold totals row, frozen header,
 * values only (NO formulas — ADR-0011 auditability). The import accepts
 * BOTH header fixture sets (AR and EN — the Arabic-header mapping
 * requirement) and validates the shape before returning rows.
 */

const MAX_PERIOD_COLUMNS = 24;

export const EN_HEADERS: readonly string[] = [
  "Account Code",
  "Account Name",
  "Dimension Code",
  "Total",
];

export const AR_HEADERS: readonly string[] = [
  "رمز الحساب",
  "اسم الحساب",
  "رمز البُعد",
  "الإجمالي",
];

export interface GridExportPeriod {
  readonly id: string;
  readonly label: string;
}

export interface GridExportLine {
  readonly accountId: string;
  readonly dimensionId: string | null;
  readonly fiscalPeriodId: string;
  readonly amount: string;
}

export interface GridExportInput {
  readonly budgetCode: string;
  readonly budgetName: string;
  readonly scope: string;
  readonly locale: "ar" | "en";
  readonly periods: readonly GridExportPeriod[];
  readonly lineAmounts: readonly GridExportLine[];
  readonly accountLabels: readonly {
    accountId: string;
    code: string;
    name: string;
    dimensionLabel: string | null;
  }[];
}

/** Build the grid workbook (header row first — the import round-trip
 * contract; one row per account × dimension key). */
export async function buildGridXlsx(input: GridExportInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Budgeting";
  const sheet = workbook.addWorksheet("Budget", {
    views: [{ rightToLeft: input.locale === "ar", state: "frozen", ySplit: 1 }],
  });

  const periodColumns = input.periods.slice(0, MAX_PERIOD_COLUMNS);
  const header = [
    ...(input.locale === "ar" ? AR_HEADERS.slice(0, 3) : EN_HEADERS.slice(0, 3)),
    ...periodColumns.map((period) => period.label),
    input.locale === "ar" ? AR_HEADERS[3]! : EN_HEADERS[3]!,
  ];
  const headerRow = sheet.addRow(header);
  headerRow.font = { bold: true };
  void input.budgetName;

  // One row per (account, dimension key): periods spread across columns.
  const rowKeys: { accountId: string; dimensionId: string | null }[] = [];
  for (const line of input.lineAmounts) {
    const exists = rowKeys.some(
      (key) => key.accountId === line.accountId && key.dimensionId === line.dimensionId,
    );
    if (!exists) {
      rowKeys.push({ accountId: line.accountId, dimensionId: line.dimensionId });
    }
  }
  const labelOf = (accountId: string): string => {
    const found = input.accountLabels.find((label) => label.accountId === accountId);
    return found === undefined ? "" : `${found.code} — ${found.name}`;
  };
  const codeOf = (accountId: string): string => {
    const found = input.accountLabels.find((label) => label.accountId === accountId);
    return found === undefined ? "" : found.code;
  };
  const dimensionOf = (accountId: string, dimensionId: string | null): string => {
    if (dimensionId === null) {
      return "";
    }
    const found = input.accountLabels.find((label) => label.accountId === accountId);
    return found?.dimensionLabel ?? "";
  };

  const columnTotals = new Array<number>(periodColumns.length).fill(0);
  let grandTotal = 0;
  for (const rowKey of rowKeys) {
    const cells: (string | number)[] = [
      codeOf(rowKey.accountId),
      labelOf(rowKey.accountId),
      dimensionOf(rowKey.accountId, rowKey.dimensionId),
    ];
    let rowTotal = 0;
    periodColumns.forEach((period, index) => {
      const line = input.lineAmounts.find(
        (candidate) =>
          candidate.accountId === rowKey.accountId &&
          candidate.dimensionId === rowKey.dimensionId &&
          candidate.fiscalPeriodId === period.id,
      );
      const amount = line === undefined ? 0 : Number(line.amount);
      rowTotal += amount;
      grandTotal += amount;
      columnTotals[index] = (columnTotals[index] ?? 0) + amount;
      cells.push(amount);
    });
    cells.push(rowTotal);
    sheet.addRow(cells);
  }

  // Totals row (bold; tabular 4dp money on every amount column).
  const totalsRow = sheet.addRow([
    input.locale === "ar" ? "الإجمالي" : "Total",
    "",
    "",
    ...columnTotals,
    grandTotal,
  ]);
  totalsRow.font = { bold: true };

  const firstAmountColumn = 4;
  for (let i = 0; i <= periodColumns.length; i += 1) {
    sheet.getColumn(firstAmountColumn + i).numFmt = "#,##0.0000";
    sheet.getColumn(firstAmountColumn + i).width = 16;
  }
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 40;
  sheet.getColumn(3).width = 18;

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

export interface ParsedGrid {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Parse an imported grid workbook: the first row of the first worksheet is
 * the header (must carry ≥ 5 columns — the 3 identity columns + ≥ 1 period
 * + total); the remaining rows are data (stringified cells). Shape-level
 * validation lives here; row-level validation lives in the import service.
 */
export async function parseGridXlsxAsync(buffer: Buffer): Promise<ParsedGrid> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BudgetImportFormatError({ reason: "not a readable XLSX workbook" });
  }
  const sheet = workbook.worksheets[0];
  if (sheet === undefined || sheet.rowCount < 1) {
    throw new BudgetImportFormatError({ reason: "empty workbook (no rows)" });
  }
  const headers: string[] = [];
  const rows: string[][] = [];
  sheet.eachRow((row, rowNo) => {
    const values = (row.values as unknown[]).slice(1); // column A → index 0
    const cells = values.map((value) =>
      value === null || value === undefined ? "" : String(value).trim(),
    );
    if (rowNo === 1) {
      headers.push(...cells);
    } else {
      rows.push(cells);
    }
  });
  if (headers.length < 5) {
    throw new BudgetImportFormatError({
      reason: `header carries ${headers.length} columns — the grid needs the 3 identity columns + periods + total`,
    });
  }
  return { headers, rows };
}
