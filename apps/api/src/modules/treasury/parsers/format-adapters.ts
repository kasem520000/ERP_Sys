import {
  DATE_ALIASES,
  AMOUNT_ALIASES,
  REFERENCE_ALIASES,
  DESCRIPTION_ALIASES,
  headerMatches,
  normalizeHeader,
  resolveColumn,
  splitCsvRow,
  toAmount,
  toIsoDate,
  StatementFormatError,
  genericCsvAdapter,
  genericXlsxAdapter,
  type BankAdapter,
  type ColumnMapping,
  type ParsedStatement,
  type ParsedStatementLine,
} from "../infrastructure/bank-adapters";

export type { BankAdapter, ColumnMapping, ParsedStatement, ParsedStatementLine, StatementParseInput } from "../infrastructure/bank-adapters";

/**
 * PHASE-023 T7 — bank-statement FORMAT-FAMILY adapters with PARKING
 * (phase §2 item 8; integrations README §3.6): two structural CSV families
 * whose rows are parsed defensively — a row that cannot be parsed parks
 * (raw cells stored verbatim for manual mapping) instead of failing the
 * file, and NEVER writes a guessed amount into bank_statement_lines.
 *
 * NO-FABRICATION discipline: these are FORMAT-SHAPE families (declared
 * required columns in the bank_statement_formats registry rows — migration
 * 0035), not bank-specific claims; no format is attributed to a named bank
 * without verified documentation.
 */

/** A row that could not be parsed — parked for manual mapping. */
export interface ParkedStatementRow {
  readonly lineIndex: number;
  readonly rawLine: string;
  readonly rawCells: readonly string[];
  readonly reason: string;
}

/** The parking-aware parse result (family adapters only). */
export interface ParkedParsedStatement extends ParsedStatement {
  readonly parked: readonly ParkedStatementRow[];
  /** Advisory balance-drift warnings (recorded, never corrected). */
  readonly balanceWarnings?: readonly string[];
}

const DEBIT_ALIASES = ["debit", "withdrawal", "مدين", "سحب", "خصم"];
const CREDIT_ALIASES = ["credit", "deposit", "دائن", "إيداع"];
const BALANCE_ALIASES = ["balance", "running balance", "الرصيد", "الرصيد الجاري"];

/** Parse one amount cell defensively; null parks (never a guessed value). */
function tryAmount(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  try {
    return toAmount(raw);
  } catch {
    return null;
  }
}

/** Parse one date cell defensively; null parks. */
function tryDate(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  try {
    return toIsoDate(raw);
  } catch {
    return null;
  }
}

function csvText(content: Buffer): string {
  let text = content.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 BOM
  return text;
}

/**
 * Family adapter `csv-debit-credit` (registry key csv-debit-credit): a
 * date column + SEPARATE debit/credit columns; the signed amount is
 * derived as debit − credit (a row with both or neither parks — the
 * ambiguity is the mapper's to resolve, never ours to guess).
 */
export const csvDebitCreditAdapter: BankAdapter = {
  id: "csv-debit-credit",
  label: { en: "CSV with separate debit/credit columns", ar: "CSV بأعمدة مدين/دائن منفصلة" },
  extensions: [".csv", ".txt"],
  parse(input: { fileName: string; content: Buffer; mapping?: ColumnMapping }): ParkedParsedStatement {
    const rows = csvText(input.content)
      .split(/\r?\n/)
      .filter((row) => row.trim() !== "");
    if (rows.length === 0) throw new StatementFormatError("file has no rows");
    const firstRow = splitCsvRow(rows[0]!);
    const looksLikeHeader = firstRow.some(
      (cell) =>
        headerMatches(cell, DATE_ALIASES) ||
        headerMatches(cell, DEBIT_ALIASES) ||
        headerMatches(cell, CREDIT_ALIASES),
    );
    const header = looksLikeHeader ? firstRow : [];
    const dateColumn = resolveColumn(header, input.mapping?.date, DATE_ALIASES, 0);
    const debitColumn = (() => {
      const found = header.findIndex((cell) => headerMatches(cell, DEBIT_ALIASES));
      if (found >= 0) return found;
      const fallback = header.findIndex((cell) => headerMatches(cell, AMOUNT_ALIASES));
      return fallback >= 0 ? fallback : 1;
    })();
    const creditColumn = (() => {
      const found = header.findIndex((cell) => headerMatches(cell, CREDIT_ALIASES));
      return found >= 0 ? found : debitColumn + 1;
    })();
    const referenceColumn = resolveColumn(header, input.mapping?.reference, REFERENCE_ALIASES, -1);
    const descriptionColumn = resolveColumn(header, input.mapping?.description, DESCRIPTION_ALIASES, -1);
    const dataRows = looksLikeHeader ? rows.slice(1) : rows;
    const lines: ParsedStatementLine[] = [];
    const parked: ParkedStatementRow[] = [];
    for (const [index, row] of dataRows.entries()) {
      const cells = splitCsvRow(row);
      const rawDate = cells[dateColumn];
      const date = tryDate(rawDate);
      const debit = tryAmount(cells[debitColumn]);
      const credit = tryAmount(cells[creditColumn]);
      const hasDebit = debit !== null && Number(debit) !== 0;
      const hasCredit = credit !== null && Number(credit) !== 0;
      if (date === null) {
        parked.push({ lineIndex: index, rawLine: row, rawCells: cells, reason: `unparseable date "${rawDate ?? ""}"` });
        continue;
      }
      if (hasDebit === hasCredit) {
        // both set or both empty/zero — ambiguous direction: park.
        parked.push({
          lineIndex: index,
          rawLine: row,
          rawCells: cells,
          reason: hasDebit ? "both debit and credit set — ambiguous direction" : "neither debit nor credit set",
        });
        continue;
      }
      const amount = hasDebit ? `-${debit}` : credit!;
      lines.push({
        lineDate: date,
        amount,
        reference: referenceColumn >= 0 ? cells[referenceColumn]?.trim() || null : null,
        description: descriptionColumn >= 0 ? cells[descriptionColumn]?.trim() || null : null,
      });
    }
    if (lines.length === 0 && parked.length === 0) {
      throw new StatementFormatError("no statement rows found");
    }
    return { lines, openingBalance: null, closingBalance: null, parked };
  },
};

/**
 * Family adapter `csv-with-balances` (registry key csv-with-balances): a
 * single signed amount column + a running balance column. Balance drift
 * (parsed running balance ≠ previous ± amount) is recorded as an advisory
 * warning on the parse result — never a silent correction.
 */
export const csvWithBalancesAdapter: BankAdapter = {
  id: "csv-with-balances",
  label: { en: "CSV with running balance", ar: "CSV برصيد جارٍ" },
  extensions: [".csv", ".txt"],
  parse(input: { fileName: string; content: Buffer; mapping?: ColumnMapping }): ParkedParsedStatement {
    const rows = csvText(input.content)
      .split(/\r?\n/)
      .filter((row) => row.trim() !== "");
    if (rows.length === 0) throw new StatementFormatError("file has no rows");
    const firstRow = splitCsvRow(rows[0]!);
    const looksLikeHeader = firstRow.some(
      (cell) => headerMatches(cell, DATE_ALIASES) || headerMatches(cell, BALANCE_ALIASES),
    );
    const header = looksLikeHeader ? firstRow : [];
    const dateColumn = resolveColumn(header, input.mapping?.date, DATE_ALIASES, 0);
    const amountColumn = resolveColumn(header, input.mapping?.amount, AMOUNT_ALIASES, 1);
    const balanceColumn = (() => {
      const found = header.findIndex((cell) => headerMatches(cell, BALANCE_ALIASES));
      return found >= 0 ? found : 2;
    })();
    const referenceColumn = resolveColumn(header, input.mapping?.reference, REFERENCE_ALIASES, -1);
    const descriptionColumn = resolveColumn(header, input.mapping?.description, DESCRIPTION_ALIASES, -1);
    const dataRows = looksLikeHeader ? rows.slice(1) : rows;
    const lines: ParsedStatementLine[] = [];
    const parked: ParkedStatementRow[] = [];
    const balanceWarnings: string[] = [];
    let previousBalance: number | null = null;
    let lastBalance: number | null = null;
    for (const [index, row] of dataRows.entries()) {
      const cells = splitCsvRow(row);
      const date = tryDate(cells[dateColumn]);
      const amount = tryAmount(cells[amountColumn]);
      const balance = tryAmount(cells[balanceColumn]);
      if (date === null || amount === null) {
        parked.push({
          lineIndex: index,
          rawLine: row,
          rawCells: cells,
          reason:
            date === null
              ? `unparseable date "${cells[dateColumn] ?? ""}"`
              : `unparseable amount "${cells[amountColumn] ?? ""}"`,
        });
        continue;
      }
      if (balance !== null) {
        const expected = previousBalance === null ? null : Number((previousBalance + Number(amount)).toFixed(4));
        if (expected !== null && Math.abs(expected - Number(balance)) > 0.00005) {
          // Advisory only: recorded, never corrected (no guessed amounts).
          balanceWarnings.push(
            `line ${index}: running balance ${balance} ≠ previous ${previousBalance} ± ${amount}`,
          );
        }
        previousBalance = Number(balance);
        lastBalance = Number(balance);
      }
      lines.push({
        lineDate: date,
        amount,
        reference: referenceColumn >= 0 ? cells[referenceColumn]?.trim() || null : null,
        description: descriptionColumn >= 0 ? cells[descriptionColumn]?.trim() || null : null,
      });
    }
    if (lines.length === 0 && parked.length === 0) {
      throw new StatementFormatError("no statement rows found");
    }
    return {
      lines,
      openingBalance: null,
      closingBalance: lastBalance === null ? null : lastBalance.toFixed(4),
      parked,
      ...(balanceWarnings.length > 0 ? { balanceWarnings } : {}),
    } as ParkedParsedStatement;
  },
};

/**
 * The extended registry (T7): the PHASE-008 generic adapters + the two
 * PHASE-023 format families. The statement import service resolves against
 * THIS list; bank_statement_formats (migration 0035) documents the rows.
 */
export const BANK_ADAPTERS_V2: readonly BankAdapter[] = [
  genericCsvAdapter,
  genericXlsxAdapter,
  csvDebitCreditAdapter,
  csvWithBalancesAdapter,
];

/** Backwards-compatible alias (the import service's import name). */
export const BANK_ADAPTERS = BANK_ADAPTERS_V2;

export function findBankAdapterV2(id: string): BankAdapter | undefined {
  return BANK_ADAPTERS_V2.find((adapter) => adapter.id === id);
}

/** Adapter pick by id, else by extension, else the CSV default (T7 registry). */
export function resolveAdapter(fileName: string, adapterId?: string): BankAdapter {
  if (adapterId !== undefined && adapterId !== "") {
    const found = findBankAdapterV2(adapterId);
    if (found === undefined) throw new StatementFormatError(`unknown adapter "${adapterId}"`);
    return found;
  }
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const byExtension = BANK_ADAPTERS_V2.find((adapter) => adapter.extensions.includes(extension));
  return byExtension ?? genericCsvAdapter;
}

export { normalizeHeader };
