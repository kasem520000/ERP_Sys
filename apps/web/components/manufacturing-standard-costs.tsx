"use client";

/**
 * PHASE-042 T-10 (L2-12) — the standard-cost workspace:
 *
 * - the versions registry (item, v{n}, status badge, the three cost legs,
 *   the server-derived total, the source badge, effective-from) with the
 *   item filter (server-refetched) — one ACTIVE per item;
 * - the create-manual dialog: material/labor/overhead (≤ 6dp, ≥ 0) +
 *   optional effectiveFrom; the total is derived server-side (the hint
 *   says so — the ck floor);
 * - the roll-up button on the picked item: POST /roll-up folds the item's
 *   ACTIVE BOM (component standards × qty) + ACTIVE routing (rates ×
 *   times) into a new ROLLED_UP draft;
 * - the activate dialog (DRAFT only): the optional revaluateStock
 *   checkbox with the explicit journal warning.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ItemRow, ItemStandardCostRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedManufacturingError,
  localizedRoutingStatus,
  localizedStandardCostSource,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Costs ≤ 6dp, non-negative (numeric(19,6) mirror). */
const COST_RE = /^\d+(\.\d{1,6})?$/;

function moneyCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {formatMoneyDisplay(value, 4)}
    </span>
  );
}

export function ManufacturingStandardCosts({
  locale,
  initialRows,
  items,
  today,
}: {
  locale: Locale;
  initialRows: readonly ItemStandardCostRow[];
  items: readonly ItemRow[];
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly ItemStandardCostRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Item filter (server-side refetch).
  const [itemFilter, setItemFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  // Create-manual dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createItemId, setCreateItemId] = useState("");
  const [createMaterial, setCreateMaterial] = useState("");
  const [createLabor, setCreateLabor] = useState("");
  const [createOverhead, setCreateOverhead] = useState("");
  const [createEffectiveFrom, setCreateEffectiveFrom] = useState("");

  // Activate dialog state.
  const [activateRow, setActivateRow] = useState<ItemStandardCostRow | null>(null);
  const [revaluateStock, setRevaluateStock] = useState(false);

  const stockItems = useMemo(
    () => items.filter((item) => item.kind === "STOCK" && item.deletedAt === null),
    [items],
  );
  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  const createReady =
    createItemId !== "" &&
    COST_RE.test(createMaterial) &&
    COST_RE.test(createLabor) &&
    COST_RE.test(createOverhead);

  // -- list ------------------------------------------------------------------------------

  async function loadList(itemId: string): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (itemId !== "") params.set("itemId", itemId);
    const result = await bffFetch<readonly ItemStandardCostRow[]>(
      `manufacturing/standard-costs?${params.toString()}`,
    );
    setListLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  function onItemFilterChange(itemId: string): void {
    setItemFilter(itemId);
    void loadList(itemId);
  }

  // -- create-manual -----------------------------------------------------------------------

  async function createStandard(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<ItemStandardCostRow>("manufacturing/standard-costs", {
      method: "POST",
      body: {
        itemId: createItemId,
        materialCost: createMaterial,
        laborCost: createLabor,
        overheadCost: createOverhead,
        effectiveFrom: createEffectiveFrom === "" ? null : createEffectiveFrom,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    await loadList(itemFilter);
    setCreateOpen(false);
    setCreateItemId("");
    setCreateMaterial("");
    setCreateLabor("");
    setCreateOverhead("");
    setCreateEffectiveFrom("");
    setNotice(d.mfgScCreatedToast);
  }

  // -- roll-up -------------------------------------------------------------------------------

  async function rollUp(): Promise<void> {
    if (itemFilter === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("rollup");
    setError(null);
    const result = await bffFetch<ItemStandardCostRow>("manufacturing/standard-costs/roll-up", {
      method: "POST",
      body: { itemId: itemFilter },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    await loadList(itemFilter);
    setNotice(d.mfgScRolledUpToast);
  }

  // -- activate ---------------------------------------------------------------------------------

  async function activateStandard(): Promise<void> {
    if (activateRow === null) return;
    setBusy("activate");
    setError(null);
    const result = await bffFetch<ItemStandardCostRow>(
      `manufacturing/standard-costs/${activateRow.id}/activate`,
      {
        method: "POST",
        body: { revaluateStock },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setActivateRow(null);
    setRevaluateStock(false);
    await loadList(itemFilter);
    setNotice(d.mfgScActivatedToast);
  }

  // -- render --------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.mfgStdCostsTitle}
        description={d.mfgScTotalHint}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={busy === "rollup"}
              disabled={itemFilter === ""}
              onClick={() => void rollUp()}
            >
              {d.mfgScRollUp}
            </Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {d.mfgScCreate}
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.mfgBomItem}
            value={itemFilter}
            onValueChange={onItemFilterChange}
            placeholder="—"
            options={[
              { value: "", label: d.mfgBomFilterItem },
              ...stockItems.map((item) => ({
                value: item.id,
                label: itemLabelById.get(item.id) ?? item.sku,
              })),
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "item",
                header: activeLocaleHeader(d.mfgBomItem),
                accessor: (row) => items.find((item) => item.id === row.itemId)?.sku ?? row.itemId,
                render: (row) => itemLabelById.get(row.itemId) ?? row.itemId,
              },
              {
                id: "version",
                header: activeLocaleHeader(d.mfgScVersions),
                accessor: (row) => String(row.versionNo),
                mono: true,
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    v{row.versionNo}
                  </span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "ACTIVE" ? "primary" : undefined}>
                    {localizedRoutingStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "material",
                header: activeLocaleHeader(d.mfgScMaterial),
                accessor: (row) => row.materialCost,
                numeric: true,
                render: (row) => moneyCell(row.materialCost),
              },
              {
                id: "labor",
                header: activeLocaleHeader(d.mfgScLabor),
                accessor: (row) => row.laborCost,
                numeric: true,
                render: (row) => moneyCell(row.laborCost),
              },
              {
                id: "overhead",
                header: activeLocaleHeader(d.mfgScOverhead),
                accessor: (row) => row.overheadCost,
                numeric: true,
                render: (row) => moneyCell(row.overheadCost),
              },
              {
                id: "total",
                header: activeLocaleHeader(d.accountingColTotal),
                accessor: (row) => row.totalCost,
                numeric: true,
                render: (row) => moneyCell(row.totalCost),
              },
              {
                id: "source",
                header: activeLocaleHeader(d.mfgScSource),
                accessor: (row) => row.source,
                render: (row) => (
                  <Badge tone={row.source === "ROLLED_UP" ? "primary" : undefined}>
                    {localizedStandardCostSource(d, row.source)}
                  </Badge>
                ),
              },
              {
                id: "effectiveFrom",
                header: activeLocaleHeader(d.mfgScEffectiveFrom),
                accessor: (row) => row.effectiveFrom ?? "",
                mono: true,
                render: (row) =>
                  row.effectiveFrom === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {row.effectiveFrom}
                    </span>
                  ),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "activate",
                label: d.mfgScActivate,
                onSelect: (row) => {
                  if (row.status !== "DRAFT") {
                    setError(d.mfgErrStdNotDraft);
                    return;
                  }
                  setActivateRow(row);
                  setRevaluateStock(false);
                },
              },
            ]}
            empty={{ title: d.mfgScEmpty }}
          />
        </div>
      </Card>

      {/* -- create-manual dialog ----------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.mfgScCreate}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.mfgBomItem}
            value={createItemId}
            onValueChange={setCreateItemId}
            placeholder="—"
            options={stockItems.map((item) => ({
              value: item.id,
              label: itemLabelById.get(item.id) ?? item.sku,
            }))}
            required
          />
          <DatePicker
            locale={locale}
            label={d.mfgScEffectiveFrom}
            value={createEffectiveFrom === "" ? today : createEffectiveFrom}
            onSelect={setCreateEffectiveFrom}
          />
          <div className="w-40">
            <Input
              label={d.mfgScMaterial}
              value={createMaterial}
              onValueChange={setCreateMaterial}
              mono
              required
              error={
                createMaterial !== "" && !COST_RE.test(createMaterial)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgScLabor}
              value={createLabor}
              onValueChange={setCreateLabor}
              mono
              required
              error={
                createLabor !== "" && !COST_RE.test(createLabor) ? d.errorsValidation : undefined
              }
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgScOverhead}
              value={createOverhead}
              onValueChange={setCreateOverhead}
              mono
              required
              error={
                createOverhead !== "" && !COST_RE.test(createOverhead)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
        </div>
        <div className="mt-2">
          <InfoNotice>{d.mfgScTotalHint}</InfoNotice>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createStandard()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- activate dialog (the revaluation warning) ----------------------------------------- */}
      <Dialog
        open={activateRow !== null}
        onOpenChange={(open) => {
          if (!open) setActivateRow(null);
        }}
        title={d.mfgScActivate}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-600">
            {itemLabelById.get(activateRow?.itemId ?? "") ?? ""} ·{" "}
            <span className="font-mono" dir="ltr">
              v{activateRow?.versionNo ?? ""}
            </span>
          </p>
          <Checkbox
            label={d.mfgScRevaluateStock}
            checked={revaluateStock}
            onCheckedChange={(checked) => setRevaluateStock(checked === true)}
          />
          {revaluateStock && <InfoNotice>{d.mfgScRevaluationWarning}</InfoNotice>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setActivateRow(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "activate"}
            onClick={() => void activateStandard()}
          >
            {d.mfgScActivate}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
