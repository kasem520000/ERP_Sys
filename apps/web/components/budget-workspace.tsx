"use client";

/**
 * PHASE-028 (T9) — the budget grid workspace (PAGE_ARCHETYPES §4 variant
 * with fiscal-period columns): the @erp/ui PeriodGrid pattern over the
 * budget's periods × dimension keys with live row/period/year totals.
 * DRAFT budgets edit (add/remove line, per-cell amounts → PUT
 * budgeting/budgets/:id/grid — the whole-grid replace); non-DRAFT grids
 * render read-only (BR-050: revisions supersede, never edit). The
 * lifecycle bar drives the BR-050 machine (submit → approve (SoD) →
 * activate → supersede/close), each POST through the BFF with toast +
 * refresh. The consumption banner (GET :id/consumption) renders per-period
 * budget-vs-actual chips whenever ACTUAL > 0 — ADVISORY only (BR-051: no
 * posting is ever blocked). Export buttons fetch the module XLSX (base64
 * envelope) and trigger the browser download. Money values are canonical
 * decimal strings (ADR-0009) folded with the exact-money helpers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  PeriodGrid,
  Select,
  formatMoneyDisplay,
  useToast,
  type PeriodGridRowData,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AccountRow,
  BranchRow,
  BudgetDetailRow,
  BudgetGridResponse,
  BudgetGridSaveResult,
  BudgetListRow,
  BudgetLineView,
  ConsumptionResponse,
  CostCenterRow,
  ExportResponse,
  FiscalYearRow,
  ProjectRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { compareExact, isZeroExact, subtractExact, sumExact } from "../lib/exact-money";
import {
  formatMessage,
  formatDateTime,
  localizedName,
  localizedBudgetScope,
  localizedBudgetStatus,
  localizedBudgetsError,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice } from "./notices";

type BudgetScope = BudgetListRow["scope"];

/** One editable grid row: an account (+ the scope's dimension) × periods. */
interface GridDraftRow {
  key: string;
  accountId: string;
  dimensionId: string | null;
  amounts: Record<string, string>;
}

/** The API's non-negative ≤4dp money contract (ADR-0009). */
const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Folds the server lines into dimension-key rows (periodId → amount). */
function foldDraftRows(lines: readonly BudgetLineView[], scope: BudgetScope): GridDraftRow[] {
  const dimensionOf = (line: BudgetLineView): string | null =>
    scope === "COST_CENTERS"
      ? line.costCenterId
      : scope === "PROJECTS"
        ? line.projectId
        : scope === "BRANCHES"
          ? line.branchId
          : null;
  const rows: GridDraftRow[] = [];
  const byKey = new Map<string, GridDraftRow>();
  for (const line of lines) {
    const dimensionId = dimensionOf(line);
    const key = `${line.accountId}|${dimensionId ?? ""}`;
    let row = byKey.get(key);
    if (row === undefined) {
      row = { key, accountId: line.accountId, dimensionId, amounts: {} };
      byKey.set(key, row);
      rows.push(row);
    }
    row.amounts[line.fiscalPeriodId] = line.amount;
  }
  return rows;
}

/** Browser download from the export envelope's base64 payload. */
function triggerDownload(exported: ExportResponse): void {
  const binary = atob(exported.fileBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: exported.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exported.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function BudgetWorkspace({
  locale,
  detail,
  grid,
  successors,
  years,
  accounts,
  costCenters,
  projects,
  branches,
}: {
  locale: Locale;
  detail: BudgetDetailRow;
  grid: BudgetGridResponse;
  /** Budgets whose supersedesId points here (the page's list fold). */
  successors: readonly BudgetListRow[];
  years: readonly FiscalYearRow[];
  accounts: readonly AccountRow[];
  costCenters: readonly CostCenterRow[];
  projects: readonly ProjectRow[];
  branches: readonly BranchRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const budget = detail.budget;
  const isDraft = budget.status === "DRAFT";
  const periods = grid.periods;

  const [rows, setRows] = useState<GridDraftRow[]>(() => foldDraftRows(grid.lines, budget.scope));
  const [newAccountId, setNewAccountId] = useState("");
  const [newDimensionId, setNewDimensionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<"ar" | "en" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionResponse | null>(null);

  // The live consumption banner (ADR-0008 cache server-side; refreshed
  // after every grid save / lifecycle move).
  const loadConsumption = useCallback(async (): Promise<void> => {
    const result = await bffFetch<ConsumptionResponse>(`budgeting/budgets/${budget.id}/consumption`);
    if (result.ok) {
      setConsumption(result.data);
    }
  }, [budget.id]);

  useEffect(() => {
    void loadConsumption();
  }, [loadConsumption]);

  // -- label resolvers --------------------------------------------------------
  const yearName = useMemo(() => {
    const year = years.find((entry) => entry.id === budget.fiscalYearId);
    return year === undefined ? budget.fiscalYearId : year.name;
  }, [years, budget.fiscalYearId]);

  const accountViewById = useMemo(() => {
    const map = new Map<string, BudgetLineView["account"]>();
    for (const line of grid.lines) {
      if (!map.has(line.accountId)) {
        map.set(line.accountId, line.account);
      }
    }
    return map;
  }, [grid.lines]);

  const accountLabel = useCallback(
    (accountId: string): string => {
      const account = accounts.find((entry) => entry.id === accountId);
      if (account !== undefined) {
        return `${account.code} · ${localizedName(account.name, account.nameAr, locale)}`;
      }
      const view = accountViewById.get(accountId);
      if (view !== undefined && view !== null) {
        return `${view.code} · ${localizedName(view.name, view.nameAr, locale)}`;
      }
      return accountId;
    },
    [accounts, accountViewById, locale],
  );

  const dimensionLabel = useCallback(
    (dimensionId: string): string => {
      const pool =
        budget.scope === "COST_CENTERS"
          ? costCenters
          : budget.scope === "PROJECTS"
            ? projects
            : budget.scope === "BRANCHES"
              ? branches
              : [];
      const row = pool.find((entry) => entry.id === dimensionId);
      return row === undefined ? dimensionId : `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`;
    },
    [budget.scope, costCenters, projects, branches, locale],
  );

  // -- live totals (exact decimal folds) --------------------------------------
  const liveTotals = useMemo(() => {
    const amounts: Record<string, string> = {};
    for (const period of periods) {
      amounts[period.id] = sumExact(rows.map((row) => row.amounts[period.id] ?? ""));
    }
    return amounts;
  }, [rows, periods]);

  const gridRows: readonly PeriodGridRowData[] = useMemo(
    () =>
      rows.map((row) => ({
        key: row.key,
        dimensionLabel:
          row.dimensionId === null
            ? accountLabel(row.accountId)
            : `${accountLabel(row.accountId)} — ${dimensionLabel(row.dimensionId)}`,
        amounts: row.amounts,
      })),
    [rows, accountLabel, dimensionLabel],
  );

  // -- add/remove lines (DRAFT only) -------------------------------------------
  const usedKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
  const accountOptions = useMemo(
    () =>
      accounts
        .filter((account) => account.isPostable)
        .map((account) => ({
          value: account.id,
          label: `${account.code} · ${localizedName(account.name, account.nameAr, locale)}`,
        })),
    [accounts, locale],
  );
  const dimensionOptions = useMemo(() => {
    const pool =
      budget.scope === "COST_CENTERS"
        ? costCenters
        : budget.scope === "PROJECTS"
          ? projects
          : budget.scope === "BRANCHES"
            ? branches
            : [];
    return pool.map((row) => ({ value: row.id, label: `${row.code} · ${localizedName(row.name, row.nameAr, locale)}` }));
  }, [budget.scope, costCenters, projects, branches, locale]);

  const addKey = `${newAccountId}|${budget.scope === "ACCOUNTS" ? "" : newDimensionId}`;
  const addReady =
    newAccountId !== "" &&
    (budget.scope === "ACCOUNTS" || newDimensionId !== "") &&
    !usedKeys.has(addKey);

  function addLine(): void {
    if (!addReady) {
      return;
    }
    setRows([
      ...rows,
      {
        key: addKey,
        accountId: newAccountId,
        dimensionId: budget.scope === "ACCOUNTS" ? null : newDimensionId,
        amounts: {},
      },
    ]);
    setNewAccountId("");
    setNewDimensionId("");
  }

  function onCellChange(rowKey: string, periodId: string, value: string): void {
    setRows((current) =>
      current.map((row) => (row.key === rowKey ? { ...row, amounts: { ...row.amounts, [periodId]: value } } : row)),
    );
  }

  function removeRow(rowKey: string): void {
    setRows((current) => current.filter((row) => row.key !== rowKey));
  }

  // -- the whole-grid save (PUT; DRAFT-only server-side) ----------------------
  async function saveGrid(): Promise<void> {
    setError(null);
    const lines: {
      fiscalPeriodId: string;
      accountId: string;
      costCenterId: string | null;
      projectId: string | null;
      branchId: string | null;
      amount: string;
    }[] = [];
    for (const row of rows) {
      for (const period of periods) {
        const value = (row.amounts[period.id] ?? "").trim();
        if (value === "") {
          continue; // empty cells carry no line (whole-grid replace semantics)
        }
        if (!MONEY_RE.test(value)) {
          setError(d.errorsValidation);
          return;
        }
        lines.push({
          fiscalPeriodId: period.id,
          accountId: row.accountId,
          costCenterId: row.dimensionId !== null && budget.scope === "COST_CENTERS" ? row.dimensionId : null,
          projectId: row.dimensionId !== null && budget.scope === "PROJECTS" ? row.dimensionId : null,
          branchId: row.dimensionId !== null && budget.scope === "BRANCHES" ? row.dimensionId : null,
          amount: value,
        });
      }
    }
    setBusy(true);
    const saved = await bffFetch<BudgetGridSaveResult>(`budgeting/budgets/${budget.id}/grid`, {
      method: "PUT",
      body: { lines },
    });
    setBusy(false);
    if (!saved.ok) {
      setError(localizedBudgetsError(d, saved.error, saved.retryAfterSeconds));
      return;
    }
    // All-empty rows were deleted by the whole-grid replace — prune them
    // from the draft so the UI matches the server truth.
    setRows((current) => current.filter((row) => periods.some((period) => (row.amounts[period.id] ?? "").trim() !== "")));
    toast({
      tone: "success",
      title: formatMessage(d.budgetGridSavedToast, {
        lines: saved.data.lineCount,
        total: formatMoneyDisplay(saved.data.totals.year, 2),
      }),
    });
    router.refresh();
    void loadConsumption();
  }

  // -- lifecycle moves (the BR-050 machine) ------------------------------------
  async function runAction(action: "submit" | "approve" | "activate" | "supersede" | "close"): Promise<void> {
    setError(null);
    setBusy(true);
    const result = await bffFetch<BudgetListRow>(`budgeting/budgets/${budget.id}/${action}`, {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedBudgetsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const titles: Record<typeof action, string> = {
      submit: d.budgetSubmitToast,
      approve: d.budgetApproveToast,
      activate: d.budgetActivateToast,
      supersede: d.budgetSupersedeToast,
      close: d.budgetCloseToast,
    };
    toast({ tone: "success", title: titles[action] });
    if (action === "supersede") {
      router.push(`/${locale}/budgeting/${result.data.id}`);
      return;
    }
    router.refresh();
    void loadConsumption();
  }

  // -- the XLSX export (base64 envelope → browser download) -------------------
  async function exportGrid(lang: "ar" | "en"): Promise<void> {
    setError(null);
    setExporting(lang);
    const exported = await bffFetch<ExportResponse>(`budgeting/budgets/${budget.id}/export?locale=${lang}`);
    setExporting(null);
    if (!exported.ok) {
      setError(localizedBudgetsError(d, exported.error, exported.retryAfterSeconds));
      return;
    }
    triggerDownload(exported.data);
  }

  // -- the consumption banner fold (per period, ACTUAL > 0 only) ---------------
  const consumptionPeriods = useMemo(() => {
    if (consumption === null) {
      return [];
    }
    const out: { id: string; label: string; actual: string; budget: string; variance: string; over: boolean }[] = [];
    for (const period of consumption.periods) {
      const actual = sumExact(period.rows.map((row) => row.actual));
      if (isZeroExact(actual)) {
        continue;
      }
      const budgetSum = sumExact(period.rows.map((row) => row.budget));
      out.push({
        id: period.fiscalPeriodId,
        label: localizedName(period.name, period.nameAr, locale),
        actual,
        budget: budgetSum,
        variance: subtractExact(budgetSum, actual),
        over: compareExact(actual, budgetSum) > 0,
      });
    }
    return out;
  }, [consumption, locale]);
  const anyOver = consumptionPeriods.some((period) => period.over);

  const chainItems: readonly BudgetListRow[] = useMemo(
    () => [...[...detail.chain].reverse(), ...successors],
    [detail.chain, successors],
  );

  const periodColumns = useMemo(
    () => periods.map((period) => ({ id: period.id, label: localizedName(period.name, period.nameAr, locale) })),
    [periods, locale],
  );

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card
        title={budget.code}
        actions={<Badge tone={budget.status === "ACTIVE" ? "primary" : "neutral"}>{localizedBudgetStatus(d, budget.status)}</Badge>}
      >
        <DefList
          items={[
            {
              term: d.budgetColName,
              children: localizedName(budget.name, budget.nameAr, locale),
            },
            { term: d.budgetFormFiscalYear, children: yearName },
            { term: d.budgetColScope, children: localizedBudgetScope(d, budget.scope) },
            {
              term: d.budgetColRevision,
              children: (
                <span className="font-mono tabular-nums" dir="ltr">
                  r{budget.revisionNo}
                </span>
              ),
            },
            { term: d.budgetColLines, children: String(detail.lineCount) },
            {
              term: d.budgetColTotal,
              children: (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(grid.totals.year, 2)}
                </span>
              ),
            },
            { term: d.budgetCreatedAt, children: formatDateTime(budget.createdAt, locale) },
            {
              term: d.budgetSupersedes,
              children:
                detail.chain.length > 0 ? (
                  <a
                    href={`/${locale}/budgeting/${detail.chain[0]!.id}`}
                    className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                    dir="ltr"
                  >
                    {detail.chain[0]!.code}
                  </a>
                ) : (
                  <span className="text-gray-500">—</span>
                ),
            },
            {
              term: d.budgetSupersededBy,
              children:
                successors.length > 0 ? (
                  <span className="flex flex-wrap gap-2">
                    {successors.map((row) => (
                      <a
                        key={row.id}
                        href={`/${locale}/budgeting/${row.id}`}
                        className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                        dir="ltr"
                      >
                        {row.code}
                      </a>
                    ))}
                  </span>
                ) : (
                  <span className="text-gray-500">—</span>
                ),
            },
          ]}
        />
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {budget.status === "DRAFT" && (
          <Button variant="primary" onClick={() => void runAction("submit")} loading={busy}>
            {d.budgetSubmit}
          </Button>
        )}
        {budget.status === "PENDING_APPROVAL" && budget.approvedAt === null && (
          <Button variant="primary" onClick={() => void runAction("approve")} loading={busy}>
            {d.budgetApprove}
          </Button>
        )}
        {budget.status === "PENDING_APPROVAL" && budget.approvedAt !== null && (
          <Button variant="primary" onClick={() => void runAction("activate")} loading={busy}>
            {d.budgetActivate}
          </Button>
        )}
        {budget.status === "ACTIVE" && (
          <>
            <Button variant="primary" onClick={() => void runAction("supersede")} loading={busy}>
              {d.budgetSupersede}
            </Button>
            <Button variant="secondary" onClick={() => void runAction("close")} loading={busy}>
              {d.budgetClose}
            </Button>
            <p className="text-xs text-gray-600">{d.budgetSupersedeHint}</p>
          </>
        )}
        {budget.status === "REVISED" && (
          <Button variant="secondary" onClick={() => void runAction("close")} loading={busy}>
            {d.budgetClose}
          </Button>
        )}
        {budget.status === "DRAFT" && (
          <a
            href={`/${locale}/budgeting/import?budgetId=${budget.id}`}
            className="text-sm text-primary-700 underline decoration-primary-200 hover:text-primary-800"
          >
            {d.budgetsImportLink}
          </a>
        )}
      </div>

      <Card title={d.budgetGridTitle} description={d.budgetLiveTotals}>
        <div className="flex flex-col gap-3">
          {!isDraft && <InfoNotice>{d.budgetGridReadOnly}</InfoNotice>}
          {isDraft && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full max-w-xs">
                <Select
                  id="budget-add-account"
                  label={d.budgetGridAccount}
                  value={newAccountId}
                  onValueChange={setNewAccountId}
                  options={[{ value: "", label: d.kindFilterAll }, ...accountOptions]}
                />
              </div>
              {budget.scope !== "ACCOUNTS" && (
                <div className="w-full max-w-xs">
                  <Select
                    id="budget-add-dimension"
                    label={d.budgetGridDimension}
                    value={newDimensionId}
                    onValueChange={setNewDimensionId}
                    options={[{ value: "", label: d.kindFilterAll }, ...dimensionOptions]}
                  />
                </div>
              )}
              <Button variant="secondary" onClick={addLine} disabled={!addReady || busy}>
                + {d.budgetGridAddLine}
              </Button>
            </div>
          )}
          {isDraft && accountOptions.length === 0 && <InfoNotice>{d.pickerEmptyText}</InfoNotice>}
          <PeriodGrid
            locale={locale}
            periods={periodColumns}
            rows={gridRows}
            totalsRow={{ label: d.budgetGridPeriodTotals, amounts: liveTotals }}
            onCellChange={isDraft ? onCellChange : undefined}
            onRemoveRow={isDraft ? removeRow : undefined}
            readOnly={!isDraft}
            disabled={busy}
            labels={{
              dimension:
                budget.scope === "ACCOUNTS" ? d.budgetGridAccount : `${d.budgetGridAccount} · ${d.budgetGridDimension}`,
              rowTotal: d.budgetGridRowTotal,
              empty: d.budgetGridEmpty,
              removeRow: d.budgetGridRemoveLine,
            }}
            ariaLabel={d.budgetGridTitle}
          />
          {isDraft && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="primary" onClick={() => void saveGrid()} loading={busy}>
                {d.budgetGridSave}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card title={d.budgetExportLabel}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void exportGrid("ar")}
            loading={exporting === "ar"}
            disabled={exporting !== null}
          >
            {d.budgetExportAr}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void exportGrid("en")}
            loading={exporting === "en"}
            disabled={exporting !== null}
          >
            {d.budgetExportEn}
          </Button>
        </div>
      </Card>

      {consumption !== null && (
        <Card title={d.budgetConsumption}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-gray-600">
              {d.budgetComputedAt}:{" "}
              <time className="font-mono text-xs" dir="ltr">
                {formatDateTime(consumption.computedAt, locale)}
              </time>
              {consumption.stale && (
                <span className="ms-2 rounded border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs text-warning-text">
                  {d.budgetStaleWarning}
                </span>
              )}
            </p>
            {consumptionPeriods.length === 0 ? (
              <p className="text-sm text-gray-600">{d.budgetConsumptionEmpty}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {consumptionPeriods.map((period) => (
                  <span
                    key={period.id}
                    className={
                      period.over
                        ? "rounded-md border border-warning-border bg-warning-bg px-3 py-1.5 text-sm text-warning-text"
                        : "rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-800"
                    }
                  >
                    {period.label}: {d.budgetActual}{" "}
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(period.actual, 2)}
                    </span>{" "}
                    /{" "}
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(period.budget, 2)}
                    </span>{" "}
                    · {d.budgetVariance}{" "}
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(period.variance, 2)}
                    </span>
                    {period.over && <strong className="ms-2 font-medium">{d.budgetOverBudget}</strong>}
                  </span>
                ))}
              </div>
            )}
            {anyOver && (
              <p role="status" className="text-sm font-medium text-warning-text">
                {d.budgetAtOverBudget}
              </p>
            )}
            <InfoNotice>{d.budgetAdvisoryNote}</InfoNotice>
          </div>
        </Card>
      )}

      <Card title={d.budgetChainHistory}>
        {chainItems.length === 0 ? (
          <p className="text-sm text-gray-600">{d.budgetChainEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {chainItems.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <a
                  href={`/${locale}/budgeting/${row.id}`}
                  className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                  dir="ltr"
                >
                  {row.code}
                </a>
                <span>{localizedName(row.name, row.nameAr, locale)}</span>
                <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                  {localizedBudgetStatus(d, row.status)}
                </Badge>
                <span className="font-mono text-xs text-gray-500" dir="ltr">
                  r{row.revisionNo}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
