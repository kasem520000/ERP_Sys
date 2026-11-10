import { ImportFileInvalidError } from "../../domain/items-errors";

/**
 * Import parsing (PHASE-006 §2.6/T8): bounded CSV/XLSX readers for the
 * partners/items/opening-balances import engine.
 *
 * Bounds (all enforced BEFORE any row materializes):
 * - file size ≤ MAX_IMPORT_FILE_BYTES (checked on the raw buffer);
 * - rows ≤ MAX_IMPORT_ROWS;
 * - columns per row ≤ MAX_IMPORT_COLUMNS;
 * - XLSX (zip) decompression guard U-07: the ZIP central directory is
 *   inspected first — entry count and total uncompressed size are capped
 *   before the sheet is handed to the parser (no zip bombs).
 *
 * CSV: UTF-8 with BOM tolerated on read (BOM emitted on export per
 * PRINTING_AND_EXPORT), `,` or `;` delimiter sniffed from the header,
 * RFC-4180 quoting. XLSX: first worksheet, header row + data rows.
 */

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLUMNS = 40;
export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

export interface ParsedSheet {
  readonly headers: string[];
  readonly rows: readonly (readonly string[])[];
}

export function assertImportBounds(buffer: Buffer, format: "CSV" | "XLSX"): void {
  if (buffer.byteLength === 0) {
    throw new ImportFileInvalidError("the uploaded file is empty");
  }
  if (buffer.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new ImportFileInvalidError(
      `import file is ${buffer.byteLength >>> 10} KiB — the cap is ${MAX_IMPORT_FILE_BYTES >>> 10} KiB`,
    );
  }
  if (format === "XLSX") {
    assertZipNotBomb(buffer);
  }
}

/** U-07 decompression guard: inspect the ZIP central directory first. */
function assertZipNotBomb(buffer: Buffer): void {
  const MAX_ENTRIES = 512;
  const MAX_TOTAL_UNCOMPRESSED = 128 * 1024 * 1024;
  // Locate the end-of-central-directory record (scan back from the tail).
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
    // A single member >4 GiB (zip64) is out of bounds for imports outright.
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

export async function parseSheet(
  buffer: Buffer,
  format: "CSV" | "XLSX",
): Promise<ParsedSheet> {
  if (format === "CSV") {
    return parseCsv(stripBom(buffer).toString("utf8"));
  }
  const ExcelJS = (await import("exceljs")) as typeof import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as import("exceljs").Buffer);
  } catch {
    throw new ImportFileInvalidError("the XLSX file could not be parsed");
  }
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) {
    throw new ImportFileInvalidError("the XLSX file has no worksheet");
  }
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const raw =
        cell.value === null || cell.value === undefined
          ? ""
          : typeof cell.value === "object" && "text" in (cell.value as object)
            ? String((cell.value as { text?: string }).text ?? "")
            : String(cell.value);
      values.push(raw.trim());
    });
    matrix.push(values);
  });
  return toSheet(matrix);
}

function stripBom(buffer: Buffer): Buffer {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3);
  }
  return buffer;
}

function toSheet(matrix: readonly string[][]): ParsedSheet {
  const headerRow = matrix[0];
  if (headerRow === undefined || headerRow.every((cell) => cell === "")) {
    throw new ImportFileInvalidError("the file has no header row");
  }
  const headers = headerRow.map((cell) => cell.trim());
  const rows: string[][] = [];
  for (const line of matrix.slice(1)) {
    if (line.every((cell) => cell === "")) {
      continue;
    }
    if (line.length > MAX_IMPORT_COLUMNS) {
      throw new ImportFileInvalidError(
        `a row carries ${line.length} columns — the cap is ${MAX_IMPORT_COLUMNS}`,
      );
    }
    rows.push(line);
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new ImportFileInvalidError(
        `the file carries more than ${MAX_IMPORT_ROWS} rows — split the import`,
      );
    }
  }
  return { headers, rows };
}

function parseCsv(text: string): ParsedSheet {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const delimiter = count(firstLine, ";") > count(firstLine, ",") ? ";" : ",";
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      record.push(field.trim());
      field = "";
    } else if (char === "\n") {
      record.push(field.trim());
      field = "";
      records.push(record);
      record = [];
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field.trim());
    records.push(record);
  }
  return toSheet(records);
}

function count(haystack: string, needle: string): number {
  let n = 0;
  for (const char of haystack) {
    if (char === needle) {
      n += 1;
    }
  }
  return n;
}
