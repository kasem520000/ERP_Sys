/**
 * PeriodGrid stories (PHASE-028) — the budget workspace's period-column
 * grid states for the visual matrix (AR/EN × density via the harness
 * locale globals). Three stories: the editable AR grid (RTL mirrored,
 * sticky dimension column, live row totals), the read-only EN grid
 * (formatted text cells), and the empty grid (never a fabricated row).
 */
import { useState } from "react";
import type { Meta, StoryFn } from "@storybook/react-vite";

import { addExact } from "../utils/exact-decimal";
import { PeriodGrid, type PeriodGridRowData } from "./period-grid";

const meta: Meta = {
  title: "Patterns/PeriodGrid",
  parameters: { layout: "padded" },
};
export default meta;

const PERIODS = [
  { id: "p1", label: "يناير / Jan" },
  { id: "p2", label: "فبراير / Feb" },
  { id: "p3", label: "مارس / Mar" },
  { id: "p4", label: "أبريل / Apr" },
];

const ROWS: readonly PeriodGridRowData[] = [
  {
    key: "5000",
    dimensionLabel: "5000 · مصاريف التشغيل / Operating expenses",
    amounts: { p1: "12000.0000", p2: "12000.0000", p3: "12500.5", p4: "" },
  },
  {
    key: "6000",
    dimensionLabel: "6000 · رواتب وأجور / Salaries & wages",
    amounts: { p1: "48000", p2: "48000", p3: "48000", p4: "52000.25" },
  },
];

const TOTALS = { label: "الإجمالي / Totals", amounts: { p1: "60000.0000", p2: "60000.0000", p3: "60500.5", p4: "52000.25" } };

/** Live per-period totals over the rows (exact decimal math — ADR-0009). */
function totalsOf(rows: readonly PeriodGridRowData[]): Record<string, string> {
  const amounts: Record<string, string> = {};
  for (const period of PERIODS) {
    let sum = "0.0000";
    for (const row of rows) {
      const value = row.amounts[period.id] ?? "";
      if (value !== "") {
        sum = addExact(sum, value);
      }
    }
    amounts[period.id] = sum;
  }
  return amounts;
}

export const EditableArabic: StoryFn = () => {
  const [rows, setRows] = useState<PeriodGridRowData[]>([...ROWS]);
  return (
    <div className="max-w-2xl">
      <PeriodGrid
        locale="ar"
        periods={PERIODS}
        rows={rows}
        totalsRow={{ label: TOTALS.label, amounts: totalsOf(rows) }}
        onCellChange={(rowKey, periodId, value) => {
          setRows((current) =>
            current.map((row) => (row.key === rowKey ? { ...row, amounts: { ...row.amounts, [periodId]: value } } : row)),
          );
        }}
        labels={{
          dimension: "الحساب / Account",
          rowTotal: "الإجمالي السنوي / Year total",
          empty: "لا صفوف / No rows",
        }}
        ariaLabel="شبكة موازنة الفترات / Budget period grid"
      />
    </div>
  );
};

export const ReadOnlyEnglish: StoryFn = () => (
  <div className="max-w-2xl">
    <PeriodGrid
      locale="en"
      periods={PERIODS}
      rows={ROWS}
      totalsRow={TOTALS}
      readOnly
      labels={{
        dimension: "Account",
        rowTotal: "Year total",
        empty: "No rows",
      }}
      ariaLabel="Budget period grid"
    />
  </div>
);

export const Empty: StoryFn = () => (
  <div className="max-w-2xl">
    <PeriodGrid
      locale="ar"
      periods={PERIODS}
      rows={[]}
      totalsRow={{ label: "الإجمالي / Totals", amounts: {} }}
      labels={{
        dimension: "الحساب / Account",
        rowTotal: "الإجمالي السنوي / Year total",
        empty: "لا بنود موازنة بعد / No budget lines yet",
      }}
    />
  </div>
);
