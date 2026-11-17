import ExcelJS from "exceljs";

/**
 * The statutory remittance export file adapter (PHASE-046 W-4, T-08 — the
 * PHASE-028 budgeting-grid discipline applied to module data: the grid is
 * payroll-run evidence, NOT a report contract, so the export builds through
 * exceljs DIRECTLY, never the PHASE-013 reporting pipeline):
 * - RTL sheet views when the locale is Arabic (column A on the right) — the
 *   028/013 exceljs law;
 * - tabular-nums: every money/rate column carries the 4dp tabular format
 *   `#,##0.0000` (INV-032's exactness rendered, never a rounded display);
 * - one row per (employee × statutory row) — the frozen per-line
 *   `statutory_breakdown` (D-05) + the PIT row when withheld — with the
 *   bold totals row, the frozen `statutory_summary` liability block, and
 *   the self-describing footer (asOf/establishment/the IN-06 statement);
 * - values only (NO formulas — ADR-0011 auditability);
 * - CSV per PRINTING_AND_EXPORT §5: UTF-8 BOM (Excel Arabic), RFC-4180
 *   quoting, CRLF, `.` decimals (round-trip safe), header in the run
 *   locale.
 *
 * READ-ONLY BY CONSTRUCTION (BR-086): the adapter renders the caller's
 * already-frozen strings; it reads nothing, writes nothing, rounds nothing.
 */

export type RemittanceExportLocale = "ar" | "en";

export const EN_HEADERS: readonly string[] = [
  "Employee Code",
  "Employee Name",
  "Component",
  "Kind",
  "Wage Base",
  "Clamped Base",
  "Employee Rate %",
  "Employer Rate %",
  "Employee Share",
  "Employer Share",
  "Row Total",
] as const;

export const AR_HEADERS: readonly string[] = [
  "رمز الموظف",
  "اسم الموظف",
  "البند",
  "النوع",
  "أساس الأجور",
  "الأساس بعد السقف",
  "نسبة الموظف %",
  "نسبة صاحب العمل %",
  "حصة الموظف",
  "حصة صاحب العمل",
  "إجمالي البند",
] as const;

/** One export row: an employee × a frozen statutory breakdown entry (or
 * the PIT row when withheld — base = the line gross, employee-only). */
export interface RemittanceRowModel {
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly code: string;
  readonly kind: "CONTRIBUTION" | "PIT";
  readonly base: string;
  readonly clampedBase: string;
  readonly clampedBy: "MIN" | "MAX" | null;
  readonly employeeRate: string | null;
  readonly employerRate: string | null;
  readonly employeeAmount: string;
  readonly employerAmount: string;
  readonly rowTotal: string;
}

/** One frozen `statutory_summary` row as the liability block renders it. */
export interface RemittanceSummaryRowModel {
  readonly code: string;
  readonly kind: "CONTRIBUTION" | "PIT";
  readonly accrued: string;
  readonly remitted: string;
  readonly outstanding: string;
}

export interface RemittanceExportFileInput {
  readonly locale: RemittanceExportLocale;
  readonly runNo: string | null;
  readonly periodName: string;
  readonly asOf: string;
  readonly currency: string;
  readonly jurisdictionCode: string;
  readonly employerName: string;
  readonly establishmentNo: string | null;
  readonly rows: readonly RemittanceRowModel[];
  readonly totals: {
    readonly employeeShare: string;
    readonly employerShare: string;
    readonly pit: string;
    readonly grandTotal: string;
  };
  readonly summary: readonly RemittanceSummaryRowModel[];
  readonly runTotals: {
    readonly employeeShare: string;
    readonly employerShare: string;
    readonly pit: string;
  };
}

const MONEY_FORMAT = "#,##0.0000";

function isAr(input: RemittanceExportFileInput): boolean {
  return input.locale === "ar";
}

function headerRow(input: RemittanceExportFileInput): string[] {
  return [...(isAr(input) ? AR_HEADERS : EN_HEADERS)];
}

/** The data cells in header order (money/rates as NUMBERS — tabular by
 * format; identity columns as text). */
function dataCells(row: RemittanceRowModel): (string | number)[] {
  return [
    row.employeeCode,
    row.employeeName,
    row.code,
    row.kind,
    Number(row.base),
    Number(row.clampedBase),
    row.employeeRate === null ? "" : Number(row.employeeRate),
    row.employerRate === null ? "" : Number(row.employerRate),
    Number(row.employeeAmount),
    Number(row.employerAmount),
    Number(row.rowTotal),
  ];
}

function totalsLabel(input: RemittanceExportFileInput): string {
  return isAr(input) ? "الإجمالي" : "Total";
}

function summaryHeaders(input: RemittanceExportFileInput): string[] {
  return isAr(input)
    ? ["البند", "النوع", "المستحق", "المحوّل", "المتبقي"]
    : ["Component", "Kind", "Accrued", "Remitted", "Outstanding"];
}

/** The footer block (self-describing — the 013 §4.5 discipline): the run,
 * the period, asOf, the currency, the employer, the establishment (or the
 * honest not-configured note), and the IN-06 statement — exports are the
 * path, NO live-government-API claim. */
function footerLines(input: RemittanceExportFileInput): (string | number)[][] {
  const ar = isAr(input);
  const establishment =
    input.establishmentNo === null
      ? ar
        ? "غير مضبوط — لم يُضبط رقم المنشأة (الإعدادات)"
        : "not configured (set payroll.statutory.gosi_establishment_no)"
      : input.establishmentNo;
  return [
    [ar ? "المسير" : "Run", input.runNo ?? input.periodName],
    [ar ? "الفترة" : "Period", input.periodName],
    [ar ? "كما في" : "as of", input.asOf],
    [ar ? "العملة" : "Currency", input.currency],
    [ar ? "الاختصاص" : "Jurisdiction", input.jurisdictionCode],
    [ar ? "صاحب العمل" : "Employer", input.employerName],
    [ar ? "رقم المنشأة" : "Establishment No.", establishment],
    [
      ar ? "بيان التحويلات القانونية" : "Statutory remittance statement",
      ar
        ? "ملف جاهز للتحويل يصدره النظام — لا يوجد تكامل حكومي مباشر (منصة التكامل هي المرحلة 055)"
        : "a remittance-ready statement generated by the platform — no live government integration (the integration platform is PHASE-055)",
    ],
  ];
}

export function buildRemittanceXlsx(input: RemittanceExportFileInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Payroll";
  const sheet = workbook.addWorksheet("Remittance", {
    views: [{ rightToLeft: isAr(input), state: "frozen", ySplit: 1 }],
  });

  // Header row first (the 028 round-trip contract).
  const header = sheet.addRow(headerRow(input));
  header.font = { bold: true };

  for (const row of input.rows) {
    sheet.addRow(dataCells(row));
  }

  // The bold totals row (tabular 4dp on every amount column).
  const totalsRow = sheet.addRow([
    totalsLabel(input),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    Number(input.totals.employeeShare),
    Number(input.totals.employerShare),
    Number(input.totals.grandTotal),
  ]);
  totalsRow.font = { bold: true };

  // The frozen statutory_summary liability block (D-05): per profile row
  // accrued / remitted / outstanding — the export's totals tie THIS block.
  sheet.addRow([]);
  const summaryHeader = sheet.addRow(summaryHeaders(input));
  summaryHeader.font = { bold: true };
  for (const row of input.summary) {
    sheet.addRow([
      row.code,
      row.kind,
      Number(row.accrued),
      Number(row.remitted),
      Number(row.outstanding),
    ]);
  }
  const runTotalsRow = sheet.addRow([
    isAr(input) ? "إجماليات المسير" : "Run totals",
    "",
    Number(input.runTotals.employeeShare),
    Number(input.runTotals.employerShare),
    Number(input.runTotals.pit),
  ]);
  runTotalsRow.font = { bold: true };

  // The self-describing footer block.
  sheet.addRow([]);
  for (const line of footerLines(input)) {
    sheet.addRow(line);
  }

  // Column formats + widths: the money/rate columns tabular 4dp (columns
  // 5..11); the identity columns text-sized.
  for (let column = 5; column <= 11; column += 1) {
    sheet.getColumn(column).numFmt = MONEY_FORMAT;
    sheet.getColumn(column).width = 16;
  }
  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 34;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 14;

  return workbook.xlsx.writeBuffer().then((out) => Buffer.from(out as ArrayBuffer));
}

export function renderRemittanceCsv(input: RemittanceExportFileInput): Buffer {
  const lines: string[] = [];
  lines.push(headerRow(input).map(csvCell).join(","));
  for (const row of input.rows) {
    // CSV carries the FROZEN STRINGS verbatim (round-trip safe — the exact
    // 4dp decimals, never a re-formatted number).
    lines.push(
      [
        row.employeeCode,
        row.employeeName,
        row.code,
        row.kind,
        row.base,
        row.clampedBase,
        row.employeeRate ?? "",
        row.employerRate ?? "",
        row.employeeAmount,
        row.employerAmount,
        row.rowTotal,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  lines.push(
    [
      totalsLabel(input),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      input.totals.employeeShare,
      input.totals.employerShare,
      input.totals.grandTotal,
    ]
      .map(csvCell)
      .join(","),
  );
  lines.push("");
  lines.push(summaryHeaders(input).map(csvCell).join(","));
  for (const row of input.summary) {
    lines.push(
      [row.code, row.kind, row.accrued, row.remitted, row.outstanding].map(csvCell).join(","),
    );
  }
  lines.push(
    [
      input.locale === "ar" ? "إجماليات المسير" : "Run totals",
      "",
      input.runTotals.employeeShare,
      input.runTotals.employerShare,
      input.runTotals.pit,
    ]
      .map(csvCell)
      .join(","),
  );
  lines.push("");
  for (const line of footerLines(input)) {
    lines.push(line.map((cell) => csvCell(String(cell))).join(","));
  }
  const body = lines.join("\r\n");
  // UTF-8 BOM first (mandatory for Excel Arabic — PRINTING_AND_EXPORT §5).
  return Buffer.from(`\uFEFF${body}`, "utf8");
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
