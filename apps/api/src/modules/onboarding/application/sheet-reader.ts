import { Readable } from "node:stream";

import * as ExcelJS from "exceljs";

import { ImportFileInvalidError } from "../domain/onboarding-errors";

/**
 * PHASE-040 bounded-memory sheet reader (§4 performance/OA-06): the
 * toolkit's import kinds support up to 100,000-row fixtures, so unlike the
 * PHASE-006 engine (5,000 rows fully materialized) the reader streams —
 * `readSheet` yields rows one at a time; the caller's per-row state stays
 * O(1) and only the bounded report sample (first `MAX_REPORT_ISSUES`
 * issues + the summary) is retained.
 *
 * Bounds (enforced BEFORE any row is yielded):
 * - file size ≤ MAX_TOOLKIT_FILE_BYTES (32 MiB — the 100k-row headroom);
 * - rows ≤ MAX_TOOLKIT_ROWS (100,000);
 * - columns per row ≤ MAX_TOOLKIT_COLUMNS (60);
 * - XLSX (zip) decompression guard U-07: the ZIP central directory is
 *   inspected first — entry count and total uncompressed size capped
 *   before the workbook reader starts (the PHASE-006 guard, verbatim —
 *   extracted here so the toolkit does not reach into the items module's
 *   private surface; the constants stay the items engine's own).
 *
 * CSV: UTF-8 with BOM tolerated, `,`/`;` delimiter sniffed from the header
 * line, RFC-4180 quoting, streamed line-by-line. XLSX: ExcelJS
 * WorkbookReader (streaming) over the first worksheet.
 */

export const MAX_TOOLKIT_ROWS = 100_000;
export const MAX_TOOLKIT_COLUMNS = 60;
export const MAX_TOOLKIT_FILE_BYTES = 32 * 1024 * 1024;

export interface SheetRow {
  /** 1-based sheet row number (the header is row 1 — data rows start at 2). */
  readonly rowNo: number;
  readonly cells: readonly string[];
}

export interface SheetStream {
  readonly headers: readonly string[];
  /** Async iteration is pull-based — one row in memory at a time. */
  readonly rows: AsyncIterable<SheetRow>;
}

/** U-07 decompression guard (the 0009 shape, verbatim semantics). */
function assertZipNotBomb(buffer: Buffer): void {
  const MAX_ENTRIES = 512;
  const MAX_TOTAL_UNCOMPRESSED = 256 * 1024 * 1024;
  const eocdMinOffset = Math.max(0, buffer.byteLength - 66_000);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= eocdMinOffset; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new ImportFileInvalidError("not a valid XLSX (zip) file");
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  if (entries > MAX_ENTRIES) {
    throw new ImportFileInvalidError(`XLSX has ${entries} entries — the cap is ${MAX_ENTRIES}`);
  }
  let total = 0;
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.byteLength || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new ImportFileInvalidError("corrupt XLSX directory");
    }
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    if (uncompressed === 0xffffffff || compressed === 0xffffffff) {
      throw new ImportFileInvalidError("zip64 members are out of import bounds");
    }
    total += uncompressed;
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      throw new ImportFileInvalidError(
        "XLSX decompresses beyond the import cap (zip-bomb guard U-07)",
      );
    }
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLen + extraLen + commentLen;
  }
}

export function assertToolkitBounds(buffer: Buffer, format: "CSV" | "XLSX"): void {
  if (buffer.byteLength === 0) {
    throw new ImportFileInvalidError("the uploaded file is empty");
  }
  if (buffer.byteLength > MAX_TOOLKIT_FILE_BYTES) {
    throw new ImportFileInvalidError(
      `import file is ${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MiB — the cap is ${
        MAX_TOOLKIT_FILE_BYTES / (1024 * 1024)
      } MiB`,
    );
  }
  if (format === "XLSX") {
    assertZipNotBomb(buffer);
  }
}

/** Normalize a header cell for alias matching (case/space/underscore-insensitive). */
export function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Parse one RFC-4180 CSV line (tolerating the sniffed delimiter). */
function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function sniffDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

function assertColumnCount(cells: readonly string[], rowNo: number): void {
  if (cells.length > MAX_TOOLKIT_COLUMNS) {
    throw new ImportFileInvalidError(
      `row ${rowNo} carries ${cells.length} columns — the cap is ${MAX_TOOLKIT_COLUMNS}`,
    );
  }
}

async function* csvRows(
  buffer: Buffer,
): AsyncGenerator<SheetRow, void, undefined> {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  // Trim trailing empty physical lines; embedded newlines inside quoted
  // cells are stitched back here (an unterminated quote carries to the
  // next line — the RFC-4180 continuation).
  let headers: string[] | undefined;
  let delimiter: string | null = null;
  let rowNo = 1;
  let pending: string | null = null;
  let pendingNo = 0;
  let dataRows = 0;
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]!;
    let physicalNo = rowNo;
    rowNo += 1;
    if (pending !== null) {
      line = `${pending}\n${line}`;
      physicalNo = pendingNo;
    }
    // A line that is entirely blank (and not inside a quoted cell) is skipped.
    if (headers !== undefined && pending === null && line.trim() === "") {
      continue;
    }
    // The delimiter is sniffed ONCE from the header line and reused.
    if (delimiter === null) {
      delimiter = sniffDelimiter(line);
    }
    // Re-join quoted continuations before parsing.
    let openQuotes = 0;
    for (let c = 0; c < line.length; c += 1) {
      if (line[c] === '"' && line[c - 1] !== '"') openQuotes += 1;
    }
    if (openQuotes % 2 === 1 && i < lines.length - 1) {
      pending = line;
      pendingNo = physicalNo;
      continue;
    }
    pending = null;
    const cells = parseCsvLine(line, delimiter);
    if (headers === undefined) {
      assertColumnCount(cells, 1);
      headers = cells;
      continue;
    }
    const nonEmpty = cells.some((cell) => cell !== "");
    if (!nonEmpty) {
      continue;
    }
    dataRows += 1;
    if (dataRows > MAX_TOOLKIT_ROWS) {
      throw new ImportFileInvalidError(
        `the file carries more than ${MAX_TOOLKIT_ROWS} data rows — split it (bounded-memory discipline)`,
      );
    }
    assertColumnCount(cells, physicalNo);
    yield { rowNo: physicalNo, cells };
  }
  if (headers === undefined) {
    throw new ImportFileInvalidError("the file carries no header row");
  }
}

async function* xlsxRows(buffer: Buffer): AsyncGenerator<SheetRow, void, undefined> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    // Shared strings are resolved incrementally (bounded memory).
    entries: "emit",
    worksheets: "emit",
  });
  let sheetIndex = -1;
  let headers: string[] | undefined;
  let dataRows = 0;
  let rowNo = 1;
  for await (const sheet of reader) {
    sheetIndex += 1;
    if (sheetIndex > 0) {
      break; // first worksheet only
    }
    for await (const row of sheet) {
      const physicalNo = rowNo;
      rowNo += 1;
      const cells =
        row.values === undefined || row.values === null
          ? []
          : (row.values as unknown[]).slice(1).map((value) => {
              if (value === null || value === undefined) return "";
              if (value instanceof Date) return value.toISOString().slice(0, 10);
              // Rich-text objects: concatenate the runs.
              if (typeof value === "object" && "richText" in (value as Record<string, unknown>)) {
                const runs = (value as { richText: { text: string }[] }).richText;
                return runs.map((run) => run.text).join("");
              }
              return String(value).trim();
            });
      if (headers === undefined) {
        assertColumnCount(cells, 1);
        headers = cells;
        continue;
      }
      if (!cells.some((cell) => cell !== "")) {
        continue;
      }
      dataRows += 1;
      if (dataRows > MAX_TOOLKIT_ROWS) {
        throw new ImportFileInvalidError(
          `the file carries more than ${MAX_TOOLKIT_ROWS} data rows — split it (bounded-memory discipline)`,
        );
      }
      assertColumnCount(cells, physicalNo);
      yield { rowNo: physicalNo, cells };
    }
  }
  if (headers === undefined) {
    throw new ImportFileInvalidError("the workbook carries no header row (first worksheet is empty)");
  }
}

/** First row pass: headers only (for the wizard's preview + auto-detect). */
export async function readHeaders(buffer: Buffer, format: "CSV" | "XLSX"): Promise<string[]> {
  const stream = await openSheet(buffer, format);
  return [...stream.headers];
}

/** Open a bounded sheet stream (bounds asserted before the first row). */
export async function openSheet(
  buffer: Buffer,
  format: "CSV" | "XLSX",
): Promise<SheetStream> {
  assertToolkitBounds(buffer, format);
  if (format === "CSV") {
    const headers = await readCsvHeaders(buffer);
    return { headers, rows: csvRows(buffer) };
  }
  const headers = await readXlsxHeaders(buffer);
  return { headers, rows: xlsxRows(buffer) };
}

async function readCsvHeaders(buffer: Buffer): Promise<string[]> {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.trim() === "") {
    throw new ImportFileInvalidError("the file carries no header row");
  }
  const cells = parseCsvLine(firstLine, sniffDelimiter(firstLine));
  assertColumnCount(cells, 1);
  return cells;
}

async function readXlsxHeaders(buffer: Buffer): Promise<string[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    entries: "emit",
    worksheets: "emit",
  });
  for await (const sheet of reader) {
    for await (const row of sheet) {
      const cells =
        row.values === undefined || row.values === null
          ? []
          : (row.values as unknown[]).slice(1).map((value) => {
              if (value === null || value === undefined) return "";
              if (value instanceof Date) return value.toISOString().slice(0, 10);
              if (typeof value === "object" && "richText" in (value as Record<string, unknown>)) {
                const runs = (value as { richText: { text: string }[] }).richText;
                return runs.map((run) => run.text).join("");
              }
              return String(value).trim();
            });
      assertColumnCount(cells, 1);
      return cells;
    }
    break;
  }
  throw new ImportFileInvalidError("the workbook carries no header row (first worksheet is empty)");
}
