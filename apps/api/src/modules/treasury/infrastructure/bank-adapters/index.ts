/**
 * Bank statement format adapters (PHASE-008 §2.8; T10): a pluggable parser
 * registry — each new bank format ships as an adapter + fixture file, never
 * as core changes (§7 risk mitigation). Unmapped formats fall back to the
 * generic column-mapping adapters (tenant-operable): the CSV flavor handles
 * UTF-8 BOM + Arabic column headers (التاريخ/المبلغ/المرجع/البيان), the
 * XLSX flavor parses workbooks via exceljs. Parsed rows are VALIDATED here
 * so a malformed file never reaches the store (STATEMENT_FORMAT_INVALID).
 */

export interface ParsedStatementLine {
  lineDate: string;
  amount: string;
  reference: string | null;
  description: string | null;
}

export interface ParsedStatement {
  lines: ParsedStatementLine[];
  openingBalance: string | null;
  closingBalance: string | null;
}

export interface StatementParseInput {
  fileName: string;
  /** Raw file bytes (CSV text or an XLSX workbook). */
  content: Buffer;
  /** Column mapping for the generic adapters (defaults applied per flavor). */
  mapping?: ColumnMapping;
}

export interface ColumnMapping {
  /** Header name or 1-based column index for the line date. */
  date?: string;
  /** Header name or 1-based column index for the signed amount. */
  amount?: string;
  reference?: string;
  description?: string;
  openingBalance?: string;
  closingBalance?: string;
}

export interface BankAdapter {
  readonly id: string;
  readonly label: { en: string; ar: string };
  /** Accepted filename extensions (lowercase, with dot). */
  readonly extensions: readonly string[];
  parse(input: StatementParseInput): ParsedStatement | Promise<ParsedStatement>;
}

/** AR/EN header aliases resolved case/blindly (localization §bilingual). */
export const DATE_ALIASES = ["date", "value date", "posting date", "التاريخ", "تاريخ العملية", "تاريخ القيمة"];
export const AMOUNT_ALIASES = ["amount", "debit", "credit", "value", "المبلغ", "قيمة", "مدين", "دائن"];
export const REFERENCE_ALIASES = ["reference", "ref", "txn id", "المرجع", "رقم المرجع", "رقم العملية"];
export const DESCRIPTION_ALIASES = ["description", "details", "narrative", "البيان", "التفاصيل", "الوصف"];
const OPENING_ALIASES = ["opening balance", "opening", "الرصيد الافتتاحي", "رصيد أول المدة"];
const CLOSING_ALIASES = ["closing balance", "closing", "balance", "الرصيد الختامي", "الرصيد"];

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\u200f/g, "").replace(/\s+/g, " ");
}

export function headerMatches(header: string, aliases: readonly string[]): boolean {
  const normalized = normalizeHeader(header);
  return aliases.some((alias) => normalized === alias);
}

export function resolveColumn(
  headers: readonly string[],
  requested: string | undefined,
  aliases: readonly string[],
  fallbackIndex: number,
): number {
  if (requested !== undefined && requested !== "") {
    const index = Number(requested);
    if (Number.isInteger(index) && index >= 1) return index - 1;
    const normalized = normalizeHeader(requested);
    const found = headers.findIndex((header) => normalizeHeader(header) === normalized);
    if (found >= 0) return found;
  }
  const aliased = headers.findIndex((header) => headerMatches(header, aliases));
  if (aliased >= 0) return aliased;
  return fallbackIndex;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ].*/;

/** Canonical 4-dp money string from a raw cell (rejects NaN/inf — ADR-0009). */
export function toAmount(raw: string): string {
  const cleaned = raw.trim().replace(/[,\s\u00a0]/g, "").replace(/[()]/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d{1,8})?$/.test(cleaned)) {
    throw new StatementFormatError(`amount "${raw}" is not a plain decimal`);
  }
  const negative = raw.includes("(") || cleaned.startsWith("-");
  const abs = cleaned.replace(/^-/, "");
  const [int, frac = ""] = abs.split(".");
  const padded = (frac + "0000").slice(0, 4);
  return `${negative ? "-" : ""}${int}.${padded}`;
}

export function toIsoDate(raw: string): string {
  const cleaned = raw.trim();
  if (ISO_DATE.test(cleaned)) return cleaned;
  if (ISO_DATETIME.test(cleaned)) return cleaned.slice(0, 10);
  // dd/mm/yyyy and dd-mm-yyyy (the region's common bank exports)
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(cleaned);
  if (match !== null) {
    const day = match[1]!;
    const month = match[2]!;
    const year = match[3]!;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  throw new StatementFormatError(`date "${raw}" is not a recognized format (ISO, dd/mm/yyyy)`);
}

class StatementFormatError extends Error {}

/** Split CSV respecting quoted cells (RFC-4180-ish; banks love stray quotes). */
export function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === "," || char === ";") && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function mapRow(
  cells: readonly string[],
  columns: { date: number; amount: number; reference: number; description: number },
): ParsedStatementLine {
  const rawDate = cells[columns.date] ?? "";
  const rawAmount = cells[columns.amount] ?? "";
  if (rawDate.trim() === "" && rawAmount.trim() === "") {
    throw new StatementFormatError("empty statement row");
  }
  return {
    lineDate: toIsoDate(rawDate),
    amount: toAmount(rawAmount),
    reference: (cells[columns.reference] ?? "").trim() === "" ? null : cells[columns.reference]!.trim(),
    description: (cells[columns.description] ?? "").trim() === "" ? null : cells[columns.description]!.trim(),
  };
}

/** The generic CSV adapter: BOM-tolerant, Arabic-header-aware, delimiter-sniffing. */
export const genericCsvAdapter: BankAdapter = {
  id: "generic-csv",
  label: { en: "Generic CSV (column mapping)", ar: "ملف CSV عام (تخطيط أعمدة)" },
  extensions: [".csv", ".txt"],
  parse(input: StatementParseInput): ParsedStatement {
    let text = input.content.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 BOM
    const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "");
    if (rows.length === 0) throw new StatementFormatError("file has no rows");
    const firstRow = splitCsvRow(rows[0]!);
    const looksLikeHeader = firstRow.some(
      (cell) =>
        DATE_ALIASES.includes(normalizeHeader(cell)) ||
        AMOUNT_ALIASES.includes(normalizeHeader(cell)) ||
        headerMatches(cell, DATE_ALIASES) ||
        headerMatches(cell, AMOUNT_ALIASES),
    );
    const header = looksLikeHeader ? firstRow : [];
    const columns = {
      date: resolveColumn(header, input.mapping?.date, DATE_ALIASES, 0),
      amount: resolveColumn(header, input.mapping?.amount, AMOUNT_ALIASES, 1),
      reference: resolveColumn(header, input.mapping?.reference, REFERENCE_ALIASES, 2),
      description: resolveColumn(header, input.mapping?.description, DESCRIPTION_ALIASES, 3),
    };
    const dataRows = looksLikeHeader ? rows.slice(1) : rows;
    const lines: ParsedStatementLine[] = [];
    for (const row of dataRows) {
      lines.push(mapRow(splitCsvRow(row), columns));
    }
    const openingColumn = resolveColumn(header, input.mapping?.openingBalance, OPENING_ALIASES, -1);
    const closingColumn = resolveColumn(header, input.mapping?.closingBalance, CLOSING_ALIASES, -1);
    let openingBalance: string | null = null;
    let closingBalance: string | null = null;
    if (openingColumn >= 0 && looksLikeHeader) {
      const firstData = splitCsvRow(dataRows[0] ?? "");
      if ((firstData[openingColumn] ?? "").trim() !== "") openingBalance = toAmount(firstData[openingColumn]!);
    }
    if (closingColumn >= 0 && looksLikeHeader) {
      const lastData = splitCsvRow(dataRows[dataRows.length - 1] ?? "");
      if ((lastData[closingColumn] ?? "").trim() !== "") closingBalance = toAmount(lastData[closingColumn]!);
    }
    return { lines, openingBalance, closingBalance };
  },
};

/** The generic XLSX adapter (exceljs; first worksheet, same mapping rules). */
export const genericXlsxAdapter: BankAdapter = {
  id: "generic-xlsx",
  label: { en: "Generic XLSX (column mapping)", ar: "ملف Excel عام (تخطيط أعمدة)" },
  extensions: [".xlsx"],
  async parse(input: StatementParseInput): Promise<ParsedStatement> {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(input.content as unknown as import("exceljs").Buffer);
    } catch {
      throw new StatementFormatError("file is not a readable XLSX workbook");
    }
    const sheet = workbook.worksheets[0];
    if (sheet === undefined) throw new StatementFormatError("workbook has no worksheet");
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      const last = Math.min(row.cellCount, 12);
      for (let column = 1; column <= last; column += 1) {
        const cell = row.getCell(column);
        const value = cell.value;
        if (value === null || value === undefined) {
          cells.push("");
        } else if (value instanceof Date) {
          cells.push(value.toISOString().slice(0, 10));
        } else if (typeof value === "object" && "text" in (value as unknown as Record<string, unknown>)) {
          cells.push(String((value as unknown as { text?: string }).text ?? ""));
        } else if (typeof value === "object" && "result" in (value as unknown as Record<string, unknown>)) {
          cells.push(String((value as unknown as { result?: unknown }).result ?? ""));
        } else {
          cells.push(String(value));
        }
      }
      rows.push(cells);
    });
    if (rows.length === 0) throw new StatementFormatError("worksheet has no rows");
    const looksLikeHeader = rows[0]!.some(
      (cell) => headerMatches(cell, DATE_ALIASES) || headerMatches(cell, AMOUNT_ALIASES),
    );
    const header = looksLikeHeader ? rows[0]! : [];
    const columns = {
      date: resolveColumn(header, input.mapping?.date, DATE_ALIASES, 0),
      amount: resolveColumn(header, input.mapping?.amount, AMOUNT_ALIASES, 1),
      reference: resolveColumn(header, input.mapping?.reference, REFERENCE_ALIASES, 2),
      description: resolveColumn(header, input.mapping?.description, DESCRIPTION_ALIASES, 3),
    };
    const dataRows = looksLikeHeader ? rows.slice(1) : rows;
    const lines = dataRows
      .map((cells) => mapRow(cells, columns))
      .filter((line) => !(line.lineDate === "" && line.amount === "0.0000"));
    const openingColumn = resolveColumn(header, input.mapping?.openingBalance, OPENING_ALIASES, -1);
    const closingColumn = resolveColumn(header, input.mapping?.closingBalance, CLOSING_ALIASES, -1);
    let openingBalance: string | null = null;
    let closingBalance: string | null = null;
    if (openingColumn >= 0 && dataRows.length > 0) {
      const value = dataRows[0]![openingColumn] ?? "";
      if (value.trim() !== "") openingBalance = toAmount(value);
    }
    if (closingColumn >= 0 && dataRows.length > 0) {
      const value = dataRows[dataRows.length - 1]![closingColumn] ?? "";
      if (value.trim() !== "") closingBalance = toAmount(value);
    }
    return { lines, openingBalance, closingBalance };
  },
};

/** The registry (§7: adapter sprawl stays out of the core — plugin surface). */
export const BANK_ADAPTERS: readonly BankAdapter[] = [genericCsvAdapter, genericXlsxAdapter];

export function findBankAdapter(id: string): BankAdapter | undefined {
  return BANK_ADAPTERS.find((adapter) => adapter.id === id);
}

/** Adapter pick by id, else by filename extension, else the CSV default. */
export function resolveAdapter(fileName: string, adapterId?: string): BankAdapter {
  if (adapterId !== undefined && adapterId !== "") {
    const found = findBankAdapter(adapterId);
    if (found === undefined) throw new StatementFormatError(`unknown adapter "${adapterId}"`);
    return found;
  }
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const byExtension = BANK_ADAPTERS.find((adapter) => adapter.extensions.includes(extension));
  return byExtension ?? genericCsvAdapter;
}

export { StatementFormatError };
