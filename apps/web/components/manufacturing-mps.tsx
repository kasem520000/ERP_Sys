"use client";

/**
 * PHASE-043 T-14 — the MPS screen body: the @erp/ui PeriodGrid pattern over
 * the next 8 Monday-anchored weekly buckets (the engine's own WEEK
 * convention — netting.ts weekStartIso) × the added item rows. Every cell
 * edit PUTs manufacturing/mps/entries for that slot (debounced 600ms — the
 * grid fires per keystroke, the API wants one upsert per settled cell), the
 * row status rides each write so a FIRMED row never silently un-firms on a
 * qty edit, and the per-row Firm toggle re-PUTs the row's non-empty buckets
 * with the flipped status. In-fence writes (BR-078) answer
 * MPS_FROZEN_FENCE_EDIT / MPS_FROZEN_REASON_REQUIRED — the typed messages
 * surface as the board's warning notice and the grid refetches the truth.
 * Quantities stay canonical decimal strings (ADR-0009).
 */
import { useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  ItemPicker,
  PeriodGrid,
  Select,
  useToast,
  type PeriodGridRowData,
  type PickerOption,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ItemRow,
  MpsEntryRow,
  MpsReadinessResult,
  UomRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { isZeroExact, sumExact } from "../lib/exact-money";
import { localizedName, localizedManufacturingError } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";

/** The grid's bucket count (8 weekly buckets ≈ two months of schedule). */
const BUCKET_COUNT = 8;
/** Cell-write debounce — one PUT per settled cell, not per keystroke. */
const CELL_DEBOUNCE_MS = 600;
/** The API's QTY contract — non-negative decimals ≤ 6dp (ADR-0009). */
const QTY_RE = /^\d+(\.\d{1,6})?$/;

function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** The ISO week start (Monday) — the engine's WEEK bucket anchor. */
function weekStartIso(date: string): string {
  const utc = new Date(`${date}T00:00:00Z`);
  const day = utc.getUTCDay(); // 0=Sun..6=Sat
  const delta = day === 0 ? -6 : 1 - day;
  return addDaysIso(date, delta);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Amounts by item → bucket (explicit zeros render as empty cells). */
type AmountMap = Record<string, Record<string, string>>;

function amountsFrom(entries: readonly MpsEntryRow[]): AmountMap {
  const out: AmountMap = {};
  for (const entry of entries) {
    if (isZeroExact(entry.qty)) continue;
    const row = out[entry.itemId] ?? {};
    row[entry.bucketStart] = entry.qty;
    out[entry.itemId] = row;
  }
  return out;
}

export function ManufacturingMps({
  locale,
  warehouseId: initialWarehouseId,
  warehouses,
  items,
  uoms,
  initialEntries,
  initialReadiness,
}: {
  locale: Locale;
  warehouseId: string;
  warehouses: readonly WarehouseRow[];
  items: readonly ItemRow[];
  uoms: readonly UomRow[];
  initialEntries: readonly MpsEntryRow[];
  initialReadiness: MpsReadinessResult | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [entries, setEntries] = useState<readonly MpsEntryRow[]>(initialEntries);
  const [amounts, setAmounts] = useState<AmountMap>(() => amountsFrom(initialEntries));
  const [readiness, setReadiness] = useState<MpsReadinessResult | null>(initialReadiness);
  const [gridItemIds, setGridItemIds] = useState<string[]>(() => [
    ...new Set(initialEntries.map((entry) => entry.itemId)),
  ]);
  const [firmIntent, setFirmIntent] = useState<Record<string, "PLANNED" | "FIRMED">>({});
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // The next 8 weekly bucket starts — computed client-side from today (the
  // periods are the ISO dates themselves, LTR-mono by nature).
  const buckets = useMemo(() => {
    const anchor = weekStartIso(todayIso());
    return Array.from({ length: BUCKET_COUNT }, (_, index) => addDaysIso(anchor, index * 7));
  }, []);
  const periods = useMemo(() => buckets.map((bucket) => ({ id: bucket, label: bucket })), [buckets]);

  const itemById = useMemo(() => {
    const map = new Map<string, ItemRow>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);
  const uomCodeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const uom of uoms) map.set(uom.id, uom.code);
    return map;
  }, [uoms]);

  const itemOptions = useMemo<PickerOption[]>(
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
    const uom = uomCodeById.get(item.uomId) ?? "";
    return `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}${uom === "" ? "" : ` (${uom})`}`;
  }

  /** The row's write status: the firm intent, else any FIRMED bucket of the row. */
  function rowStatusOf(itemId: string): "PLANNED" | "FIRMED" {
    const intent = firmIntent[itemId];
    if (intent !== undefined) return intent;
    return entries.some((row) => row.itemId === itemId && row.status === "FIRMED")
      ? "FIRMED"
      : "PLANNED";
  }

  // -- loads ---------------------------------------------------------------------------

  async function loadWarehouse(warehouse: string): Promise<void> {
    setWarehouseId(warehouse);
    setFirmIntent({});
    setError(null);
    setLoading(true);
    const [entriesResult, readinessResult] = await Promise.all([
      bffFetch<readonly MpsEntryRow[]>(`manufacturing/mps/entries?limit=500&warehouseId=${warehouse}`),
      bffFetch<MpsReadinessResult>(`manufacturing/mps/readiness?warehouseId=${warehouse}`),
    ]);
    setLoading(false);
    if (!entriesResult.ok) {
      setError(localizedManufacturingError(d, entriesResult.error, entriesResult.retryAfterSeconds));
      // A failed warehouse load renders NO grid data (never the previous
      // warehouse's rows under the new selection).
      setEntries([]);
      setAmounts({});
      setReadiness(null);
      return;
    }
    setEntries(entriesResult.data);
    setAmounts(amountsFrom(entriesResult.data));
    setReadiness(readinessResult.ok ? readinessResult.data : null);
  }

  function upsertEntryLocal(next: MpsEntryRow): void {
    setEntries((current) => [
      ...current.filter(
        (row) => !(row.itemId === next.itemId && row.bucketStart === next.bucketStart),
      ),
      next,
    ]);
  }

  // -- cell writes (one PUT per settled cell) --------------------------------------------

  async function flushCell(itemId: string, bucketStart: string, value: string): Promise<void> {
    const item = itemById.get(itemId);
    if (item === undefined || warehouseId === "") return;
    const qty = value === "" ? "0" : value;
    setSaving(true);
    const result = await bffFetch<MpsEntryRow>("manufacturing/mps/entries", {
      method: "PUT",
      body: {
        warehouseId,
        itemId,
        bucketStart,
        qty,
        uomId: item.uomId,
        status: rowStatusOf(itemId),
      },
    });
    setSaving(false);
    if (!result.ok) {
      // The typed frozen-fence rejection (BR-078) and every other failure
      // surface as the board's warning — then the grid restores the truth.
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      await reloadEntries();
      return;
    }
    upsertEntryLocal(result.data);
    toast({ tone: "success", title: d.mfgMpsSavedToast });
  }

  async function reloadEntries(): Promise<void> {
    if (warehouseId === "") return;
    const result = await bffFetch<readonly MpsEntryRow[]>(
      `manufacturing/mps/entries?limit=500&warehouseId=${warehouseId}`,
    );
    if (result.ok) {
      setEntries(result.data);
      setAmounts(amountsFrom(result.data));
    }
  }

  function onCellChange(rowKey: string, periodId: string, value: string): void {
    setAmounts((current) => ({
      ...current,
      [rowKey]: { ...(current[rowKey] ?? {}), [periodId]: value },
    }));
    const key = `${rowKey}:${periodId}`;
    const timers = timersRef.current;
    const existing = timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    // Partial input (e.g. "1.") waits for the settled value; the empty
    // string settles immediately as the explicit zero.
    if (value !== "" && !QTY_RE.test(value)) return;
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void flushCell(rowKey, periodId, value);
      }, CELL_DEBOUNCE_MS),
    );
  }

  // -- the firm toggle (re-PUTs the row's non-empty buckets with the flipped status) -----

  async function toggleFirm(itemId: string): Promise<void> {
    const item = itemById.get(itemId);
    if (item === undefined || warehouseId === "") return;
    const next = rowStatusOf(itemId) === "FIRMED" ? "PLANNED" : "FIRMED";
    setFirmIntent({ ...firmIntent, [itemId]: next });
    const rowAmounts = amounts[itemId] ?? {};
    const touched = buckets.filter((bucket) => (rowAmounts[bucket] ?? "") !== "");
    if (touched.length === 0) {
      toast({ tone: "success", title: d.mfgMpsSavedToast });
      return;
    }
    setSaving(true);
    setError(null);
    for (const bucket of touched) {
      const result = await bffFetch<MpsEntryRow>("manufacturing/mps/entries", {
        method: "PUT",
        body: {
          warehouseId,
          itemId,
          bucketStart: bucket,
          qty: rowAmounts[bucket] ?? "0",
          uomId: item.uomId,
          status: next,
        },
      });
      if (!result.ok) {
        setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
        setSaving(false);
        await reloadEntries();
        return;
      }
      upsertEntryLocal(result.data);
    }
    setSaving(false);
    toast({ tone: "success", title: d.mfgMpsSavedToast });
  }

  // -- the grid rows ----------------------------------------------------------------------

  function addRow(): void {
    if (pick === "" || gridItemIds.includes(pick)) return;
    setGridItemIds([...gridItemIds, pick]);
    setPick("");
  }

  const rows = useMemo<PeriodGridRowData[]>(
    () =>
      gridItemIds.map((itemId) => ({
        key: itemId,
        dimensionLabel: itemLabel(itemId),
        amounts: amounts[itemId] ?? {},
      })),
    // itemLabel closes over the item/uom pools (stable for the page's life).
    [gridItemIds, amounts, itemById, uomCodeById, locale],
  );

  const totals = useMemo(() => {
    const per: Record<string, string> = {};
    for (const bucket of buckets) {
      per[bucket] = sumExact(
        gridItemIds.map((itemId) => amounts[itemId]?.[bucket] ?? "").filter((value) => value !== ""),
      );
    }
    return { label: d.mfgMpsGrid, amounts: per };
  }, [buckets, gridItemIds, amounts, d]);

  // -- render ------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card title={d.mfgMpsTitle}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs">
            <Select
              label={d.stockFilterWarehouse}
              value={warehouseId}
              onValueChange={(warehouse) => void loadWarehouse(warehouse)}
              options={warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.code} · ${localizedName(warehouse.name, warehouse.nameAr, locale)}`,
              }))}
            />
          </div>
          <div className="w-full max-w-xs">
            <ItemPicker
              label={d.mfgBomItem}
              items={itemOptions}
              value={pick}
              onSelect={(id) => setPick(id)}
              emptyText={d.pickerEmptyText}
              disabled={saving}
            />
          </div>
          <Button variant="secondary" onClick={addRow} disabled={pick === "" || saving}>
            + {d.mfgMpsAddItem}
          </Button>
        </div>
      </Card>

      <Card title={d.mfgMpsGrid}>
        <div className="flex flex-col gap-3">
          {warehouseId === "" && <ErrorNotice>{d.mfgMpsEmpty}</ErrorNotice>}
          <PeriodGrid
            locale={locale}
            periods={periods}
            rows={rows}
            totalsRow={totals}
            onCellChange={warehouseId === "" ? undefined : onCellChange}
            onRemoveRow={
              warehouseId === ""
                ? undefined
                : (rowKey) => setGridItemIds(gridItemIds.filter((id) => id !== rowKey))
            }
            disabled={saving || loading}
            minorUnits={6}
            labels={{
              dimension: d.mfgBomItem,
              rowTotal: d.mfgMpsRowTotal,
              empty: d.mfgMpsEmpty,
              removeRow: d.mfgMpsRemoveItem,
            }}
            ariaLabel={d.mfgMpsGrid}
          />
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {rows.map((row) => {
                const status = rowStatusOf(row.key);
                return (
                  <span
                    key={row.key}
                    className="inline-flex items-center gap-2 rounded-md border border-default bg-surface-card px-2 py-1 text-xs text-gray-800"
                  >
                    <span className="max-w-56 truncate">{row.dimensionLabel}</span>
                    <Badge tone={status === "FIRMED" ? "primary" : undefined}>
                      {status === "FIRMED" ? d.mfgMpsFirmed : d.mfgMpsPlanned}
                    </Badge>
                    <button
                      type="button"
                      className="rounded-sm border border-default px-1.5 py-0.5 text-xs hover:border-strong disabled:cursor-not-allowed disabled:text-gray-400"
                      onClick={() => void toggleFirm(row.key)}
                      disabled={saving || loading || warehouseId === ""}
                    >
                      {status === "FIRMED" ? d.mfgMpsPlanned : d.mfgMpsFirm}
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card title={d.mfgMpsReadiness}>
        {readiness === null ? (
          <p className="text-sm text-gray-600">—</p>
        ) : (
          <div className="flex flex-col gap-2">
            <DefList
              items={[
                { term: d.mfgMpsScopeItems, children: String(readiness.scopeSize) },
                {
                  term: d.mfgMpsNoLeadTime,
                  children: String(readiness.itemsWithoutLeadTime.length),
                },
              ]}
            />
            {readiness.itemsWithoutLeadTime.length > 0 && (
              <ErrorNotice>
                {d.mfgMpsNoLeadTime}: {readiness.itemsWithoutLeadTime.length} / {readiness.scopeSize}
              </ErrorNotice>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
