"use client";

/**
 * PHASE-043 T-13 — the MRP screen body (list-search archetype):
 *
 * - the run-configuration card: warehouse, bucket size (DAY/WEEK), horizon
 *   (1..366 buckets), run mode (REGENERATIVE/NET_CHANGE), the
 *   transfer-suggestion switch and the NET_CHANGE item scope (an ItemPicker
 *   chip list — the server derives the full scope for REGENERATIVE runs);
 *   POST manufacturing/mrp/runs executes synchronously and returns the run
 *   + its fresh suggestions;
 * - the run-history table (createdAt, status badge, mode, bucket, horizon,
 *   as-of date, the engine stats) — opening a run pins the suggestions
 *   board to that run (the detail card carries the stored parameters:
 *   replayable determinism, same data + same params ⇒ the same plan);
 * - the suggestions board: status/type filters, per-row accept (POST
 *   :id/accept — INV-030 idempotent conversion) and dismiss (POST
 *   :id/dismiss with the REQUIRED 1..300 reason — BR-079). Quantities stay
 *   canonical decimal strings (ADR-0009) rendered LTR-mono.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Input,
  ItemPicker,
  Select,
  Textarea,
  useToast,
  type PickerOption,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ItemRow,
  MrpRunRow,
  MrpSuggestionRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedManufacturingError,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** A canonical decimal/ISO cell (display: the exact server string, LTR). */
function monoCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value}
    </span>
  );
}

export function ManufacturingMrp({
  locale,
  initialRuns,
  initialSuggestions,
  warehouses,
  items,
}: {
  locale: Locale;
  initialRuns: readonly MrpRunRow[];
  initialSuggestions: readonly MrpSuggestionRow[];
  warehouses: readonly WarehouseRow[];
  items: readonly ItemRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const [runs, setRuns] = useState<readonly MrpRunRow[]>(initialRuns);
  const [suggestions, setSuggestions] = useState<readonly MrpSuggestionRow[]>(initialSuggestions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [boardLoading, setBoardLoading] = useState(false);

  // Run configuration (the warehouse defaults to the first active one).
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [bucketSize, setBucketSize] = useState<"DAY" | "WEEK">("WEEK");
  const [horizonBuckets, setHorizonBuckets] = useState("8");
  const [runMode, setRunMode] = useState<"REGENERATIVE" | "NET_CHANGE">("REGENERATIVE");
  const [allowTransfers, setAllowTransfers] = useState(false);
  const [scopeItemIds, setScopeItemIds] = useState<string[]>([]);
  const [scopePick, setScopePick] = useState("");

  // The pinned run (null = every warehouse's open suggestions).
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Board filters (server-refetched).
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Dismiss dialog state (the reason is REQUIRED — BR-079).
  const [dismissRow, setDismissRow] = useState<MrpSuggestionRow | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissError, setDismissError] = useState<string | null>(null);

  const itemById = useMemo(() => {
    const map = new Map<string, ItemRow>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const scopeOptions = useMemo<PickerOption[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        label: item.name,
        labelAr: item.nameAr ?? undefined,
        meta: item.sku,
      })),
    [items],
  );

  function itemLabel(itemId: string): string {
    const item = itemById.get(itemId);
    if (item === undefined) return itemId;
    return `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`;
  }

  function warehouseLabel(id: string): string {
    const warehouse = warehouses.find((row) => row.id === id);
    return warehouse === undefined ? id : `${warehouse.code} · ${localizedName(warehouse.name, warehouse.nameAr, locale)}`;
  }

  // -- labels ----------------------------------------------------------------------------

  function runStatus(status: string): string {
    if (status === "RUNNING") return d.mfgMrpStatusRunning;
    if (status === "COMPLETED") return d.mfgMrpStatusCompleted;
    if (status === "FAILED") return d.mfgMrpStatusFailed;
    return status;
  }

  function suggestionType(type: string): string {
    if (type === "PURCHASE_ORDER") return d.mfgMrpPurchase;
    if (type === "PRODUCTION_ORDER") return d.mfgMrpProduction;
    if (type === "TRANSFER") return d.mfgMrpTransfer;
    return type;
  }

  function suggestionStatus(status: string): string {
    if (status === "SUGGESTED") return d.mfgMrpSuggested;
    if (status === "ACCEPTED") return d.mfgMrpAccepted;
    if (status === "DISMISSED") return d.mfgMrpDismissed;
    if (status === "SUPERSEDED") return d.mfgMrpSuperseded;
    return status;
  }

  function convertedLabel(type: string | null): string {
    if (type === null) return "—";
    if (type === "purchase_order") return d.mfgMrpPurchase;
    if (type === "production_order") return d.mfgMrpProduction;
    if (type === "stock_transfer") return d.mfgMrpTransfer;
    return type;
  }

  function bucketLabel(size: string): string {
    return size === "DAY" ? d.mfgMrpBucketDay : d.mfgMrpBucketWeek;
  }

  function modeLabel(mode: string): string {
    return mode === "NET_CHANGE" ? d.mfgMrpNetChange : d.mfgMrpRegenerative;
  }

  function statsSummary(row: MrpRunRow): string {
    if (row.stats === null) return "—";
    const statItems = row.stats["items"];
    const statSuggestions = row.stats["suggestions"];
    const parts: string[] = [];
    if (typeof statItems === "number") parts.push(`${statItems} ${d.mfgMrpStatItems}`);
    if (typeof statSuggestions === "number") {
      parts.push(`${statSuggestions} ${d.mfgMrpStatSuggestions}`);
    }
    return parts.length === 0 ? "—" : parts.join(" · ");
  }

  // -- loads ------------------------------------------------------------------------------

  async function loadRuns(): Promise<void> {
    setRunsLoading(true);
    const result = await bffFetch<readonly MrpRunRow[]>("manufacturing/mrp/runs?limit=50");
    setRunsLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRuns(result.data);
  }

  async function loadSuggestions(options: { runId?: string | null; status?: string; type?: string } = {}): Promise<void> {
    const runId = options.runId !== undefined ? options.runId : selectedRunId;
    const status = options.status !== undefined ? options.status : statusFilter;
    const type = options.type !== undefined ? options.type : typeFilter;
    setBoardLoading(true);
    let query = "manufacturing/mrp/suggestions?limit=200";
    if (runId !== null) query += `&runId=${runId}`;
    if (status !== "") query += `&status=${status}`;
    if (type !== "") query += `&suggestionType=${type}`;
    const result = await bffFetch<readonly MrpSuggestionRow[]>(query);
    setBoardLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setSuggestions(result.data);
  }

  // -- the run -----------------------------------------------------------------------------

  const horizon = Number(horizonBuckets);
  const runReady =
    warehouseId !== "" &&
    Number.isInteger(horizon) &&
    horizon >= 1 &&
    horizon <= 366 &&
    (runMode === "REGENERATIVE" || scopeItemIds.length > 0);

  async function runMrp(): Promise<void> {
    if (!runReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("run");
    setError(null);
    const result = await bffFetch<{ run: MrpRunRow; suggestions: readonly MrpSuggestionRow[] }>(
      "manufacturing/mrp/runs",
      {
        method: "POST",
        body: {
          warehouseId,
          bucketSize,
          horizonBuckets: horizon,
          runMode,
          allowTransfers,
          scopeItemIds: runMode === "NET_CHANGE" ? scopeItemIds : undefined,
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.mfgMrpRunDone, { suggestions: result.data.suggestions.length }),
    });
    setSelectedRunId(result.data.run.id);
    await Promise.all([loadRuns(), loadSuggestions({ runId: result.data.run.id })]);
  }

  // -- suggestion actions -------------------------------------------------------------------

  async function acceptSuggestion(row: MrpSuggestionRow): Promise<void> {
    if (row.status !== "SUGGESTED") {
      setError(d.mfgErrMrpState);
      return;
    }
    setBusy(`accept:${row.id}`);
    setError(null);
    const result = await bffFetch<unknown>(`manufacturing/mrp/suggestions/${row.id}/accept`, {
      method: "POST",
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.mfgMrpAcceptedToast });
    await loadSuggestions();
  }

  async function dismissSuggestion(): Promise<void> {
    if (dismissRow === null) return;
    const reason = dismissReason.trim();
    if (reason === "" || reason.length > 300) {
      setDismissError(d.mfgErrMrpDismissReason);
      return;
    }
    setBusy(`dismiss:${dismissRow.id}`);
    setDismissError(null);
    const result = await bffFetch<MrpSuggestionRow>(
      `manufacturing/mrp/suggestions/${dismissRow.id}/dismiss`,
      { method: "POST", body: { reason } },
    );
    setBusy(null);
    if (!result.ok) {
      setDismissError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDismissRow(null);
    setDismissReason("");
    toast({ tone: "success", title: d.mfgMrpDismissedToast });
    await loadSuggestions();
  }

  // -- render --------------------------------------------------------------------------------

  const selectedRun = selectedRunId === null ? null : runs.find((row) => row.id === selectedRunId) ?? null;
  const horizonInvalid =
    horizonBuckets !== "" &&
    (!Number.isInteger(horizon) || horizon < 1 || horizon > 366);

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card title={d.mfgMrpRunConfig}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label={d.stockFilterWarehouse}
            value={warehouseId}
            onValueChange={setWarehouseId}
            options={warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: `${warehouse.code} · ${localizedName(warehouse.name, warehouse.nameAr, locale)}`,
            }))}
          />
          <Select
            label={d.mfgMrpBucketSize}
            value={bucketSize}
            onValueChange={(value) => setBucketSize(value === "DAY" ? "DAY" : "WEEK")}
            options={[
              { value: "DAY", label: d.mfgMrpBucketDay },
              { value: "WEEK", label: d.mfgMrpBucketWeek },
            ]}
          />
          <div className="w-36">
            <Input
              label={d.mfgMrpHorizon}
              value={horizonBuckets}
              onValueChange={setHorizonBuckets}
              mono
              required
              inputMode="numeric"
              error={horizonInvalid ? d.errorsValidation : undefined}
            />
          </div>
          <Select
            label={d.mfgMrpMode}
            value={runMode}
            onValueChange={(value) => setRunMode(value === "NET_CHANGE" ? "NET_CHANGE" : "REGENERATIVE")}
            options={[
              { value: "REGENERATIVE", label: d.mfgMrpRegenerative },
              { value: "NET_CHANGE", label: d.mfgMrpNetChange },
            ]}
          />
          <div className="flex flex-col gap-2 pt-6">
            <Checkbox
              label={d.mfgMrpAllowTransfers}
              checked={allowTransfers}
              onCheckedChange={(checked) => setAllowTransfers(checked === true)}
              disabled={busy === "run"}
            />
          </div>
          <div className="flex flex-col gap-1">
            <ItemPicker
              label={d.mfgMrpScope}
              items={scopeOptions}
              value={scopePick}
              onSelect={(id) => {
                if (id !== "" && !scopeItemIds.includes(id)) {
                  setScopeItemIds([...scopeItemIds, id]);
                }
                setScopePick("");
              }}
              emptyText={d.pickerEmptyText}
              disabled={busy === "run"}
            />
            <p className="text-xs text-gray-600">
              {runMode === "NET_CHANGE" ? d.mfgMrpNetChangeHint : d.mfgMrpScopeAll}
            </p>
            {scopeItemIds.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {scopeItemIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-md border border-default bg-surface-card px-2 py-1 text-xs text-gray-800"
                  >
                    {itemLabel(id)}
                    <button
                      type="button"
                      aria-label={`${d.mfgMpsRemoveItem}: ${itemLabel(id)}`}
                      className="rounded-sm p-0.5 text-gray-400 hover:text-gray-600"
                      onClick={() => setScopeItemIds(scopeItemIds.filter((row) => row !== id))}
                      disabled={busy === "run"}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy === "run"} disabled={!runReady} onClick={() => void runMrp()}>
            {d.mfgMrpRun}
          </Button>
        </div>
      </Card>

      <Card title={d.mfgMrpRunHistory}>
        <DataTable
          loading={runsLoading}
          columns={[
            {
              id: "createdAt",
              header: activeLocaleHeader(d.budgetCreatedAt),
              accessor: (row) => row.createdAt,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {formatDateTime(row.createdAt, locale)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.mfgMrpStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "COMPLETED" ? "primary" : undefined}>
                  {runStatus(row.status)}
                </Badge>
              ),
            },
            {
              id: "runMode",
              header: activeLocaleHeader(d.mfgMrpMode),
              accessor: (row) => row.runMode,
              render: (row) => modeLabel(row.runMode),
            },
            {
              id: "bucketSize",
              header: activeLocaleHeader(d.mfgMrpBucketSize),
              accessor: (row) => row.bucketSize,
              render: (row) => bucketLabel(row.bucketSize),
            },
            {
              id: "horizonBuckets",
              header: activeLocaleHeader(d.mfgMrpHorizon),
              accessor: (row) => String(row.horizonBuckets),
              numeric: true,
              render: (row) => monoCell(String(row.horizonBuckets)),
            },
            {
              id: "asOfDate",
              header: activeLocaleHeader(d.mfgMrpAsOf),
              accessor: (row) => row.asOfDate,
              render: (row) => monoCell(row.asOfDate),
            },
            {
              id: "stats",
              header: activeLocaleHeader(d.mfgMrpStats),
              accessor: (row) => String(row.stats?.["suggestions"] ?? ""),
              render: (row) => statsSummary(row),
            },
          ]}
          rows={[...runs]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row) => {
                const next = row.id === selectedRunId ? null : row.id;
                setSelectedRunId(next);
                void loadSuggestions({ runId: next });
              },
            },
          ]}
          empty={{ title: d.mfgMrpRunsEmpty }}
        />
      </Card>

      {selectedRun !== null && (
        <Card
          title={`${d.mfgMrpRunHistory} · ${formatDateTime(selectedRun.createdAt, locale)}`}
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedRunId(null);
                void loadSuggestions({ runId: null });
              }}
            >
              {d.commonClear}
            </Button>
          }
        >
          <DefList
            items={[
              {
                term: d.mfgMrpStatus,
                children:
                  selectedRun.errorCode === null
                    ? runStatus(selectedRun.status)
                    : `${runStatus(selectedRun.status)} · ${selectedRun.errorCode}`,
              },
              { term: d.mfgMrpMode, children: modeLabel(selectedRun.runMode) },
              {
                term: d.mfgMrpBucketSize,
                children: `${bucketLabel(selectedRun.bucketSize)} × ${selectedRun.horizonBuckets}`,
              },
              { term: d.mfgMrpAsOf, children: monoCell(selectedRun.asOfDate) },
              { term: d.stockFilterWarehouse, children: warehouseLabel(selectedRun.warehouseId) },
              { term: d.mfgMrpStats, children: statsSummary(selectedRun) },
            ]}
          />
        </Card>
      )}

      <Card title={d.mfgMrpSuggestions}>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.mfgMrpStatus}
            value={statusFilter}
            onValueChange={(status) => {
              setStatusFilter(status);
              void loadSuggestions({ status });
            }}
            options={[
              { value: "", label: d.mfgOrdersAllStatuses },
              { value: "SUGGESTED", label: d.mfgMrpSuggested },
              { value: "ACCEPTED", label: d.mfgMrpAccepted },
              { value: "DISMISSED", label: d.mfgMrpDismissed },
              { value: "SUPERSEDED", label: d.mfgMrpSuperseded },
            ]}
          />
          <Select
            label={d.mfgMrpSuggestType}
            value={typeFilter}
            onValueChange={(type) => {
              setTypeFilter(type);
              void loadSuggestions({ type });
            }}
            options={[
              { value: "", label: d.mfgOrdersAllStatuses },
              { value: "PURCHASE_ORDER", label: d.mfgMrpPurchase },
              { value: "PRODUCTION_ORDER", label: d.mfgMrpProduction },
              { value: "TRANSFER", label: d.mfgMrpTransfer },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={boardLoading}
            columns={[
              {
                id: "item",
                header: activeLocaleHeader(d.mfgBomItem),
                accessor: (row) => itemById.get(row.itemId)?.sku ?? row.itemId,
                render: (row) => itemLabel(row.itemId),
              },
              {
                id: "suggestionType",
                header: activeLocaleHeader(d.mfgMrpSuggestType),
                accessor: (row) => row.suggestionType,
                render: (row) => (
                  <Badge tone={row.suggestionType === "PRODUCTION_ORDER" ? "primary" : undefined}>
                    {suggestionType(row.suggestionType)}
                  </Badge>
                ),
              },
              {
                id: "qty",
                header: activeLocaleHeader(d.mfgMrpQty),
                accessor: (row) => row.qty,
                numeric: true,
                render: (row) => monoCell(row.qty),
              },
              {
                id: "dueDate",
                header: activeLocaleHeader(d.mfgMrpDue),
                accessor: (row) => row.dueDate,
                render: (row) => monoCell(row.dueDate),
              },
              {
                id: "releaseDate",
                header: activeLocaleHeader(d.mfgMrpRelease),
                accessor: (row) => row.releaseDate,
                render: (row) => monoCell(row.releaseDate),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.mfgMrpStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone={row.status === "SUGGESTED" ? "primary" : undefined}>
                      {suggestionStatus(row.status)}
                    </Badge>
                    {row.frozenFence && <Badge>{d.mfgMrpFrozen}</Badge>}
                  </span>
                ),
              },
              {
                id: "convertedDocType",
                header: activeLocaleHeader(d.mfgMrpConverted),
                accessor: (row) => row.convertedDocType ?? "",
                render: (row) => convertedLabel(row.convertedDocType),
              },
            ]}
            rows={[...suggestions]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "accept",
                label: d.mfgMrpAccept,
                onSelect: (row) => void acceptSuggestion(row),
              },
              {
                id: "dismiss",
                label: d.mfgMrpDismiss,
                danger: true,
                onSelect: (row) => {
                  if (row.status !== "SUGGESTED") {
                    setError(d.mfgErrMrpState);
                    return;
                  }
                  setDismissRow(row);
                  setDismissReason("");
                  setDismissError(null);
                },
              },
            ]}
            empty={{ title: d.mfgMrpSuggestionsEmpty }}
          />
        </div>
      </Card>

      {/* -- dismiss dialog (the reason is REQUIRED — BR-079) ------------------------- */}
      <Dialog
        open={dismissRow !== null}
        onOpenChange={(open) => {
          if (!open) setDismissRow(null);
        }}
        title={d.mfgMrpDismissAction}
      >
        <p className="text-sm text-gray-600">
          {itemLabel(dismissRow?.itemId ?? "")} · {dismissRow !== null ? suggestionType(dismissRow.suggestionType) : ""}
        </p>
        <div className="mt-3">
          <Textarea
            label={d.mfgMrpDismissReason}
            value={dismissReason}
            onValueChange={(value) => {
              setDismissReason(value);
              if (dismissError !== null) setDismissError(null);
            }}
            required
            maxLength={300}
            rows={3}
            error={dismissError ?? undefined}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDismissRow(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === `dismiss:${dismissRow?.id ?? ""}`}
            disabled={dismissReason.trim() === ""}
            onClick={() => void dismissSuggestion()}
          >
            {d.mfgMrpDismiss}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
