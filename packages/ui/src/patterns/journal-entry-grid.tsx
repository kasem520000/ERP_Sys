"use client";

/**
 * JournalEntryGrid (PHASE-007 pattern; COMPONENT_CATALOG §6.3): manual journal
 * entry with live balanced-entry preview — the UI mirror of INV-001. Grid
 * semantics: account (Combobox on active leaf accounts), description, cost
 * center, partner (REQUIRED when the account carries an AR/AP purpose — the
 * engine rule surfaced inline), debit, credit, tax code, line total;
 * add/remove line controls. Keyboard model: Enter moves to the next cell,
 * Alt+Enter adds a new line focused on its account cell, Ctrl+D duplicates
 * the current line, Delete on an empty selected row removes it. The sticky
 * MoneySummaryBar shows Σdebit | Σcredit | Δ; the caller disables its Post
 * action while Δ≠0 (the bar exposes `isBalanced` via the computed callback —
 * the UI lock is convenience, the ENGINE is authority). Headless by contract:
 * the app injects the account/partner/cost-center option lists.
 */
import { useCallback, useId, useMemo, useState, type JSX } from "react";

import { Button } from "../components/button";
import { Combobox } from "../components/controls";
import { Input } from "../components/input";
import { MoneyInput } from "../components/money-input";
import { cn } from "../utils/cn";
import { MoneySummaryBar } from "./money-summary-bar";
import type { PickerOption } from "./partner-picker";

export interface JournalLineDraft {
  id: string;
  accountId?: string;
  memo?: string;
  costCenterId?: string;
  partnerId?: string;
  debit: string;
  credit: string;
  taxCodeId?: string;
}

export interface JournalEntryGridLabels {
  account: string;
  description: string;
  costCenter: string;
  partner: string;
  debit: string;
  credit: string;
  taxCode: string;
  lineTotal: string;
  addLine: string;
  removeLine: string;
  duplicateLine: string;
  partnerRequired: string;
  summary: {
    debit: string;
    credit: string;
    difference: string;
    balanced: string;
    unbalanced: string;
  };
}

export interface JournalEntryGridProps {
  currency: string;
  minorUnits?: number;
  accounts: readonly PickerOption[];
  partners?: readonly PickerOption[];
  costCenters?: readonly PickerOption[];
  taxCodes?: readonly PickerOption[];
  /** Account ids that demand a partner (AR/AP control) — inline rule. */
  partnerRequiredAccountIds?: ReadonlySet<string>;
  labels: JournalEntryGridLabels;
  lines: readonly JournalLineDraft[];
  onLinesChange: (lines: JournalLineDraft[]) => void;
  disabled?: boolean;
  className?: string;
}

let seed = 0;
function newLineId(): string {
  seed += 1;
  return `line-${Date.now().toString(36)}-${seed}`;
}

export function emptyLine(): JournalLineDraft {
  return { id: newLineId(), debit: "", credit: "" };
}

/** Exact 4-dp addition over canonical strings (BigInt minor units). */
function addExact(a: string, b: string): string {
  const toMinor = (value: string): bigint => {
    if (value === "") return 0n;
    const negative = value.startsWith("-");
    const [int = "0", frac = ""] = value.replace("-", "").split(".");
    const minor = BigInt(int) * 10_000n + BigInt(frac.slice(0, 4).padEnd(4, "0"));
    return negative ? -minor : minor;
  };
  const sum = toMinor(a) + toMinor(b);
  const negative = sum < 0n;
  const abs = negative ? -sum : sum;
  const whole = abs / 10_000n;
  const frac = (abs % 10_000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function JournalEntryGrid({
  currency,
  minorUnits = 2,
  accounts,
  partners = [],
  costCenters = [],
  taxCodes = [],
  partnerRequiredAccountIds = new Set<string>(),
  labels,
  lines,
  onLinesChange,
  disabled = false,
  className,
}: JournalEntryGridProps): JSX.Element {
  const gridId = useId();
  const [focusedLine, setFocusedLine] = useState<string | null>(null);

  const totals = useMemo(() => {
    let debit = "0.0000";
    let credit = "0.0000";
    for (const line of lines) {
      debit = addExact(debit, line.debit === "" ? "0" : line.debit);
      credit = addExact(credit, line.credit === "" ? "0" : line.credit);
    }
    return { debit, credit };
  }, [lines]);

  const update = useCallback(
    (id: string, patch: Partial<JournalLineDraft>) => {
      onLinesChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
    },
    [lines, onLinesChange],
  );

  const addLine = useCallback(() => {
    onLinesChange([...lines, emptyLine()]);
  }, [lines, onLinesChange]);

  const removeLine = useCallback(
    (id: string) => {
      onLinesChange(lines.length <= 1 ? [emptyLine()] : lines.filter((line) => line.id !== id));
    },
    [lines, onLinesChange],
  );

  const duplicateLine = useCallback(
    (id: string) => {
      const index = lines.findIndex((line) => line.id === id);
      if (index === -1) return;
      const clone = { ...lines[index]!, id: newLineId() };
      const next = [...lines.slice(0, index + 1), clone, ...lines.slice(index + 1)];
      onLinesChange(next);
    },
    [lines, onLinesChange],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableRowElement>, line: JournalLineDraft) => {
      if (event.altKey && event.key === "Enter") {
        event.preventDefault();
        addLine();
        return;
      }
      if (event.ctrlKey && (event.key === "d" || event.key === "D")) {
        event.preventDefault();
        duplicateLine(line.id);
        return;
      }
      if (event.key === "Delete" && line.accountId === undefined && line.debit === "" && line.credit === "") {
        event.preventDefault();
        removeLine(line.id);
      }
    },
    [addLine, duplicateLine, removeLine],
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="overflow-x-auto rounded-lg border">
        <table
          role="grid"
          aria-label={labels.lineTotal}
          className="w-full min-w-(--erp-width-journal-grid) border-collapse text-sm"
        >
          <thead>
            <tr className="border-b bg-surface-muted">
              <th scope="col" className="px-3 py-2 text-start font-medium">{labels.account}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{labels.description}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{labels.costCenter}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{labels.partner}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{labels.debit}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{labels.credit}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{labels.taxCode}</th>
              <th scope="col" className="px-3 py-2" aria-label={labels.removeLine} />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const needsPartner =
                line.accountId !== undefined && partnerRequiredAccountIds.has(line.accountId);
              const cellName = (column: string): string => `${column} ${index + 1}`;
              return (
                <tr
                  key={line.id}
                  id={`${gridId}-row-${index}`}
                  role="row"
                  tabIndex={0}
                  className={cn(
                    "border-b last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                    focusedLine === line.id && "bg-surface-muted/60",
                  )}
                  onFocus={() => setFocusedLine(line.id)}
                  onBlur={() => setFocusedLine(null)}
                  onKeyDown={(event) => onKeyDown(event, line)}
                >
                  <td role="gridcell" className="px-2 py-1.5">
                    <Combobox
                      items={accounts.map((option) => ({
                        value: option.id,
                        label: option.meta !== undefined && option.meta !== "" ? `${option.label} · ${option.meta}` : option.label,
                        keywords: [option.labelAr ?? "", option.meta ?? ""].filter(Boolean).join(" "),
                      }))}
                      value={line.accountId ?? ""}
                      onValueChange={(value) => update(line.id, { accountId: value === "" ? undefined : value })}
                      placeholder="—"
                      aria-label={cellName(labels.account)}
                      disabled={disabled}
                    />
                  </td>
                  <td role="gridcell" className="px-2 py-1.5">
                    <Input
                      value={line.memo ?? ""}
                      onValueChange={(value) => update(line.id, { memo: value })}
                      aria-label={cellName(labels.description)}
                      disabled={disabled}
                    />
                  </td>
                  <td role="gridcell" className="px-2 py-1.5">
                    <Combobox
                      items={costCenters.map((option) => ({ value: option.id, label: option.label }))}
                      value={line.costCenterId ?? ""}
                      onValueChange={(value) => update(line.id, { costCenterId: value === "" ? undefined : value })}
                      placeholder="—"
                      aria-label={cellName(labels.costCenter)}
                      disabled={disabled || costCenters.length === 0}
                    />
                  </td>
                  <td role="gridcell" className="px-2 py-1.5">
                    <Combobox
                      items={partners.map((option) => ({ value: option.id, label: option.label }))}
                      value={line.partnerId ?? ""}
                      onValueChange={(value) => update(line.id, { partnerId: value === "" ? undefined : value })}
                      placeholder="—"
                      aria-label={cellName(labels.partner)}
                      disabled={disabled || partners.length === 0}
                      error={needsPartner && line.partnerId === undefined ? labels.partnerRequired : undefined}
                    />
                  </td>
                  <td role="gridcell" className="px-2 py-1.5">
                    <MoneyInput
                      amount={line.debit}
                      currency={currency}
                      minorUnits={minorUnits}
                      onAmountChange={(value) => update(line.id, { debit: value, credit: "" })}
                      ariaLabel={cellName(labels.debit)}
                      disabled={disabled}
                      allowNegative={false}
                    />
                  </td>
                  <td role="gridcell" className="px-2 py-1.5">
                    <MoneyInput
                      amount={line.credit}
                      currency={currency}
                      minorUnits={minorUnits}
                      onAmountChange={(value) => update(line.id, { credit: value, debit: "" })}
                      ariaLabel={cellName(labels.credit)}
                      disabled={disabled}
                      allowNegative={false}
                    />
                  </td>
                  <td role="gridcell" className="px-2 py-1.5">
                    <Combobox
                      items={taxCodes.map((option) => ({ value: option.id, label: option.label }))}
                      value={line.taxCodeId ?? ""}
                      onValueChange={(value) => update(line.id, { taxCodeId: value === "" ? undefined : value })}
                      placeholder="—"
                      aria-label={cellName(labels.taxCode)}
                      disabled={disabled || taxCodes.length === 0}
                    />
                  </td>
                  <td role="gridcell" className="px-2 py-1.5 text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLine(line.id)}
                      disabled={disabled}
                      aria-label={`${labels.removeLine} ${index + 1}`}
                    >
                      ×
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <Button variant="secondary" size="sm" onClick={addLine} disabled={disabled}>
          + {labels.addLine}
        </Button>
        <span className="text-xs text-muted-foreground" aria-hidden>
          Ctrl+D {labels.duplicateLine} · Alt+Enter {labels.addLine}
        </span>
      </div>
      <MoneySummaryBar
        debit={totals.debit}
        credit={totals.credit}
        currency={currency}
        minorUnits={minorUnits}
        labels={labels.summary}
      />
    </div>
  );
}
