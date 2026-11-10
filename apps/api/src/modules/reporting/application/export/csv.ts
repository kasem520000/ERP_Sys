import type { ReportResult } from "../contract";

/**
 * PHASE-013 T13 · CSV export (PRINTING_AND_EXPORT §5): UTF-8 with BOM
 * (mandatory for Excel Arabic compatibility — ADR-0011), ISO-8601 dates,
 * decimal strings with `.` separator (no thousands separators —
 * round-trip safe), RFC 4180 quoting, CRLF line endings, header row in
 * the run locale.
 */

export function renderCsv(report: ReportResult): Buffer {
  const locale = report.formatting.locale;
  const header = report.columns.map((column) => csvCell(column.label[locale])).join(",");
  const lines = [header];
  for (const row of report.rows) {
    lines.push(
      report.columns
        .map((column) =>
          csvCell(
            row.values[column.id] === null || row.values[column.id] === undefined
              ? ""
              : String(row.values[column.id]),
          ),
        )
        .join(","),
    );
  }
  if (report.totals.length > 0) {
    lines.push("");
    for (const total of report.totals) {
      lines.push(`${csvCell(total.label[locale])},${csvCell(total.amount)}`);
    }
  }
  // Footer block: asOf/computedAt + assertion status (§8.2 — self-describing).
  lines.push("");
  lines.push(
    `${csvCell(locale === "ar" ? "كما في" : "as of")},${csvCell(report.freshness.asOf ?? report.freshness.computedAt)}`,
  );
  lines.push(
    `${csvCell(locale === "ar" ? "وقت الاحتساب" : "computed at")},${csvCell(report.freshness.computedAt)}`,
  );
  for (const assertion of report.assertions) {
    lines.push(`${csvCell(assertion.id)},${csvCell(assertion.status)}`);
  }
  const body = lines.join("\r\n");
  return Buffer.from(`\uFEFF${body}`, "utf8");
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
