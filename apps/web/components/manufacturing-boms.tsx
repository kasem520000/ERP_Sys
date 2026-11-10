"use client";

/**
 * PHASE-018 T41 — the BOM editor:
 *
 * - the version registry table (item, version, status badge, yield,
 *   effective-from, note) with item + status filters (server-refetched);
 * - the create dialog: STOCK output item (its base uom becomes
 *   outputUomId — displayed), yield (0 < y ≤ 100, ≤4dp), note, and a
 *   multi-add component-lines editor (qty per output unit > 0 ≤6dp,
 *   scrap % ≥ 0 ≤4dp);
 * - the selected version's workspace: the lines table, DRAFT-only edit
 *   (PUT full-replace) + activate (optional effective-from), ACTIVE-only
 *   archive;
 * - the explosion preview: item + requested qty + optional explicit
 *   version → the multi-level requirements table + per-item totals.
 *
 * Planning data only — nothing here ever posts a journal; quantities and
 * percentages stay canonical decimal strings (ADR-0009).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  Select,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BomRow,
  BomWithLines,
  ExplosionResult,
  ItemRow,
  UomRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedBomStatus,
  localizedManufacturingError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Percentages ≤ 4dp (yield + scrap); quantities ≤ 6dp (qty per output). */
const PCT_RE = /^\d+(\.\d{1,4})?$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;

/** A component-line draft (multi-add; submit = the full line set). */
interface BomLineDraft {
  componentItemId: string;
  qtyPerOutput: string;
  scrapPct: string;
}

const EMPTY_LINE: BomLineDraft = { componentItemId: "", qtyPerOutput: "", scrapPct: "" };

function lineValid(line: BomLineDraft): boolean {
  if (line.componentItemId === "") return false;
  if (!QTY_RE.test(line.qtyPerOutput) || Number(line.qtyPerOutput) <= 0) return false;
  if (line.scrapPct !== "" && !PCT_RE.test(line.scrapPct)) return false;
  return true;
}

function yieldValid(yieldPct: string): boolean {
  return PCT_RE.test(yieldPct) && Number(yieldPct) > 0 && Number(yieldPct) <= 100;
}

/** A canonical ≤6dp quantity (display: the exact server string, LTR). */
function qtyCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value}
    </span>
  );
}

export function ManufacturingBoms({
  locale,
  initialRows,
  items,
  uoms,
}: {
  locale: Locale;
  initialRows: readonly BomRow[];
  items: readonly ItemRow[];
  uoms: readonly UomRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly BomRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // List filters (server-side refetch, the settlement status-filter pattern).
  const [itemFilter, setItemFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createItemId, setCreateItemId] = useState("");
  const [createYield, setCreateYield] = useState("100");
  const [createNote, setCreateNote] = useState("");
  const [createLines, setCreateLines] = useState<BomLineDraft[]>([{ ...EMPTY_LINE }]);

  // Edit dialog state (DRAFT full-replace).
  const [editOpen, setEditOpen] = useState(false);
  const [editYield, setEditYield] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editLines, setEditLines] = useState<BomLineDraft[]>([{ ...EMPTY_LINE }]);

  // Activate dialog state (optional effective-from).
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateFrom, setActivateFrom] = useState("");

  // Archive dialog state (the confirm hint).
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Selected version workspace.
  const [selected, setSelected] = useState<BomWithLines | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Explosion preview state.
  const [explodeItemId, setExplodeItemId] = useState("");
  const [explodeQty, setExplodeQty] = useState("");
  const [explodeBomId, setExplodeBomId] = useState("");
  const [explosion, setExplosion] = useState<ExplosionResult | null>(null);
  const [explodeLoading, setExplodeLoading] = useState(false);

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
  const skuById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, item.sku);
    }
    return map;
  }, [items]);
  const uomLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const uom of uoms) {
      map.set(uom.id, uom.code);
    }
    return map;
  }, [uoms]);

  const createItem = stockItems.find((item) => item.id === createItemId);
  const createReady =
    createItemId !== "" &&
    yieldValid(createYield) &&
    createLines.length >= 1 &&
    createLines.every(lineValid);
  const editReady =
    selected !== null && yieldValid(editYield) && editLines.length >= 1 && editLines.every(lineValid);
  const explodeReady =
    explodeItemId !== "" &&
    QTY_RE.test(explodeQty) &&
    Number(explodeQty) > 0;

  // -- list ------------------------------------------------------------------------------

  async function loadList(itemId: string, status: string): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (itemId !== "") params.set("itemId", itemId);
    if (status !== "") params.set("status", status);
    const result = await bffFetch<readonly BomRow[]>(`manufacturing/boms?${params.toString()}`);
    setListLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  function onFilterChange(itemId: string, status: string): void {
    setItemFilter(itemId);
    setStatusFilter(status);
    void loadList(itemId, status);
  }

  // -- create ----------------------------------------------------------------------------

  async function createBom(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<BomRow>("manufacturing/boms", {
      method: "POST",
      body: {
        itemId: createItemId,
        outputUomId: createItem!.uomId,
        yieldPct: createYield,
        note: createNote.trim() === "" ? null : createNote.trim(),
        lines: createLines.map((line) => ({
          componentItemId: line.componentItemId,
          qtyPerOutput: line.qtyPerOutput,
          scrapPct: line.scrapPct === "" ? null : line.scrapPct,
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setCreateOpen(false);
    setCreateItemId("");
    setCreateYield("100");
    setCreateNote("");
    setCreateLines([{ ...EMPTY_LINE }]);
    setNotice(formatMessage(d.mfgBomCreatedToast, { version: result.data.versionNo }));
    await selectBom(result.data.id);
  }

  // -- selected workspace ------------------------------------------------------------------

  async function selectBom(id: string): Promise<void> {
    setDetailLoading(true);
    setError(null);
    const result = await bffFetch<BomWithLines>(`manufacturing/boms/${id}`);
    setDetailLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setSelected(result.data);
    // Default the explosion preview to this version's item.
    setExplodeItemId(result.data.itemId);
    setExplodeBomId(result.data.id);
    setExplosion(null);
  }

  function openEdit(): void {
    if (selected === null) return;
    setEditYield(selected.yieldPct);
    setEditNote(selected.note ?? "");
    setEditLines(
      selected.lines.map((line) => ({
        componentItemId: line.componentItemId,
        qtyPerOutput: line.qtyPerOutput,
        scrapPct: line.scrapPct === "0.0000" ? "" : line.scrapPct,
      })),
    );
    setEditOpen(true);
  }

  async function saveEdit(): Promise<void> {
    if (selected === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    const result = await bffFetch<BomRow>(`manufacturing/boms/${selected.id}`, {
      method: "PUT",
      body: {
        yieldPct: editYield,
        note: editNote.trim() === "" ? null : editNote.trim(),
        lines: editLines.map((line) => ({
          componentItemId: line.componentItemId,
          qtyPerOutput: line.qtyPerOutput,
          scrapPct: line.scrapPct === "" ? null : line.scrapPct,
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEditOpen(false);
    setNotice(formatMessage(d.mfgBomSavedToast, { version: result.data.versionNo }));
    await refreshAfterAction(result.data.id);
  }

  async function refreshAfterAction(id: string): Promise<void> {
    const result = await bffFetch<BomWithLines>(`manufacturing/boms/${id}`);
    if (result.ok) {
      setSelected(result.data);
      setRows((current) => current.map((row) => (row.id === id ? result.data : row)));
    }
  }

  async function activateBom(): Promise<void> {
    if (selected === null) return;
    setBusy("activate");
    setError(null);
    const result = await bffFetch<BomRow>(`manufacturing/boms/${selected.id}/activate`, {
      method: "POST",
      body: { effectiveFrom: activateFrom === "" ? null : activateFrom },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setActivateOpen(false);
    setActivateFrom("");
    setNotice(formatMessage(d.mfgBomActivatedToast, { version: result.data.versionNo }));
    await refreshAfterAction(result.data.id);
    // Another version may have been archived by the activation — refetch list.
    await loadList(itemFilter, statusFilter);
  }

  async function archiveBom(): Promise<void> {
    if (selected === null) return;
    setBusy("archive");
    setError(null);
    const result = await bffFetch<BomRow>(`manufacturing/boms/${selected.id}/archive`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setArchiveOpen(false);
    setNotice(formatMessage(d.mfgBomArchivedToast, { version: result.data.versionNo }));
    await refreshAfterAction(result.data.id);
    await loadList(itemFilter, statusFilter);
  }

  // -- explosion preview ---------------------------------------------------------------------

  async function runExplosion(): Promise<void> {
    if (!explodeReady) {
      setError(d.errorsValidation);
      return;
    }
    setExplodeLoading(true);
    setError(null);
    const params = new URLSearchParams({ itemId: explodeItemId, qty: explodeQty });
    if (explodeBomId !== "") params.set("bomId", explodeBomId);
    const result = await bffFetch<ExplosionResult>(
      `manufacturing/boms/explosion?${params.toString()}`,
    );
    setExplodeLoading(false);
    if (!result.ok) {
      setExplosion(null);
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setExplosion(result.data);
  }

  // -- render ------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.mfgBomsTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.mfgBomsNew}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.mfgBomFilterItem}
            value={itemFilter}
            onValueChange={(value) => onFilterChange(value, statusFilter)}
            placeholder="—"
            options={[
              { value: "", label: d.mfgBomFilterItem },
              ...stockItems.map((item) => ({
                value: item.id,
                label: itemLabelById.get(item.id) ?? item.sku,
              })),
            ]}
          />
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={(value) => onFilterChange(itemFilter, value)}
            options={[
              { value: "", label: d.mfgBomsAllStatuses },
              { value: "DRAFT", label: d.mfgBomStatusDraft },
              { value: "ACTIVE", label: d.mfgBomStatusActive },
              { value: "ARCHIVED", label: d.mfgBomStatusArchived },
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
                accessor: (row) => skuById.get(row.itemId) ?? row.itemId,
                render: (row) => itemLabelById.get(row.itemId) ?? row.itemId,
              },
              {
                id: "version",
                header: activeLocaleHeader(d.mfgBomVersion),
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
                    {localizedBomStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "yield",
                header: activeLocaleHeader(d.mfgBomYield),
                accessor: (row) => row.yieldPct,
                numeric: true,
                render: (row) => qtyCell(row.yieldPct),
              },
              {
                id: "effectiveFrom",
                header: activeLocaleHeader(d.mfgBomEffectiveFrom),
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
              {
                id: "note",
                header: activeLocaleHeader(d.mfgBomNote),
                accessor: (row) => row.note ?? "",
                render: (row) =>
                  row.note === null ? <span className="text-gray-500">—</span> : row.note,
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "open",
                label: d.commonOpen,
                onSelect: (row) => {
                  void selectBom(row.id);
                },
              },
            ]}
            empty={{ title: d.mfgBomsEmpty }}
          />
        </div>
      </Card>

      {/* -- selected version workspace -------------------------------------------- */}
      {selected !== null && (
        <Card
          title={`${d.mfgBomWorkspace} · ${itemLabelById.get(selected.itemId) ?? selected.itemId} · v${selected.versionNo}`}
          description={selected.status === "DRAFT" ? d.mfgBomDraftOnlyHint : undefined}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selected.status === "ACTIVE" ? "primary" : undefined}>
                {localizedBomStatus(d, selected.status)}
              </Badge>
              <span className="text-sm text-gray-600">
                {d.mfgBomYield}: {qtyCell(selected.yieldPct)}
              </span>
              <span className="text-sm text-gray-600">
                {d.mfgBomOutputUom}:{" "}
                <span className="font-mono text-sm" dir="ltr">
                  {uomLabelById.get(selected.outputUomId) ?? selected.outputUomId.slice(0, 8)}
                </span>
              </span>
              {selected.effectiveFrom !== null && (
                <span className="text-sm text-gray-600">
                  {d.mfgBomEffectiveFrom}:{" "}
                  <span className="font-mono text-sm" dir="ltr">
                    {selected.effectiveFrom}
                  </span>
                </span>
              )}
            </div>

            <table className="w-full text-sm" aria-label={d.mfgBomLines}>
              <thead>
                <tr className="border-b border-subtle text-xs text-gray-600">
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgBomLineNo}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgBomComponent}</th>
                  <th scope="col" className="px-2 py-1 text-end">{d.mfgBomQtyPerOutput}</th>
                  <th scope="col" className="px-2 py-1 text-end">{d.mfgBomScrapPct}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.itemUomLabel}</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.map((line) => (
                  <tr key={line.id} className="border-b border-subtle">
                    <td className="px-2 py-1.5 font-mono" dir="ltr">
                      {line.lineNo}
                    </td>
                    <td className="px-2 py-1.5">
                      {itemLabelById.get(line.componentItemId) ?? line.componentItemId}
                    </td>
                    <td className="px-2 py-1.5 text-end">{qtyCell(line.qtyPerOutput)}</td>
                    <td className="px-2 py-1.5 text-end">{qtyCell(line.scrapPct)}</td>
                    <td className="px-2 py-1.5">
                      <span className="font-mono text-sm" dir="ltr">
                        {uomLabelById.get(line.uomId) ?? line.uomId.slice(0, 8)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap gap-2">
              {selected.status === "DRAFT" && (
                <>
                  <Button variant="primary" onClick={openEdit}>
                    {d.commonSave}
                  </Button>
                  <Button variant="primary" onClick={() => setActivateOpen(true)}>
                    {d.mfgBomActivate}
                  </Button>
                </>
              )}
              {selected.status === "ACTIVE" && (
                <Button variant="danger" onClick={() => setArchiveOpen(true)}>
                  {d.mfgBomArchive}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setSelected(null);
                  setExplosion(null);
                }}
              >
                {d.commonClear}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {detailLoading && selected === null && (
        <Card title={d.mfgBomWorkspace}>
          <p className="text-sm text-gray-500">…</p>
        </Card>
      )}

      {/* -- explosion preview -------------------------------------------------- */}
      <Card title={d.mfgExplodeTitle} description={d.mfgExplodeHint}>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.mfgBomItem}
            value={explodeItemId}
            onValueChange={(value) => {
              setExplodeItemId(value);
              setExplodeBomId("");
              setExplosion(null);
            }}
            placeholder="—"
            options={stockItems.map((item) => ({
              value: item.id,
              label: itemLabelById.get(item.id) ?? item.sku,
            }))}
            required
          />
          <Select
            label={d.mfgExplodeBom}
            value={explodeBomId}
            onValueChange={setExplodeBomId}
            placeholder="—"
            options={[
              { value: "", label: d.mfgExplodeBomAuto },
              ...rows
                .filter((row) => row.itemId === explodeItemId)
                .map((row) => ({
                  value: row.id,
                  label: `v${row.versionNo} · ${localizedBomStatus(d, row.status)}`,
                })),
            ]}
          />
          <div className="w-40">
            <Input
              label={d.mfgExplodeQty}
              value={explodeQty}
              onValueChange={(value) => {
                setExplodeQty(value);
                setExplosion(null);
              }}
              mono
              required
              error={
                explodeQty !== "" && !QTY_RE.test(explodeQty) ? d.errorsValidation : undefined
              }
            />
          </div>
          <Button
            variant="primary"
            loading={explodeLoading}
            disabled={!explodeReady}
            onClick={() => void runExplosion()}
          >
            {d.mfgExplodeRun}
          </Button>
        </div>

        {explosion !== null && (
          <div className="mt-4 flex flex-col gap-4">
            {explosion.levels.length === 0 ? (
              <p className="text-sm text-gray-500">{d.mfgExplodeEmpty}</p>
            ) : (
              <table className="w-full text-sm" aria-label={d.mfgExplodeLevels}>
                <thead>
                  <tr className="border-b border-subtle text-xs text-gray-600">
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgColLevel}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.itemsColSku}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.stockColQty}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.mfgBomScrapPct}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgExplodeColVia}</th>
                  </tr>
                </thead>
                <tbody>
                  {explosion.levels.flatMap((level) =>
                    level.items.map((item, index) => (
                      <tr key={`${level.level}-${item.itemId}-${index}`} className="border-b border-subtle">
                        <td className="px-2 py-1.5 font-mono" dir="ltr">
                          {level.level}
                        </td>
                        <td className="px-2 py-1.5">{item.sku}</td>
                        <td className="px-2 py-1.5 text-end">{qtyCell(item.qty)}</td>
                        <td className="px-2 py-1.5 text-end">{qtyCell(item.scrapPct)}</td>
                        <td className="px-2 py-1.5">
                          {item.viaSemiFinished === null ? (
                            <span className="text-gray-500">—</span>
                          ) : (
                            item.viaSemiFinished
                          )}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}

            <div>
              <h3 className="text-sm font-semibold text-gray-900">{d.mfgExplodeTotals}</h3>
              <table className="mt-2 w-full text-sm" aria-label={d.mfgExplodeTotals}>
                <thead>
                  <tr className="border-b border-subtle text-xs text-gray-600">
                    <th scope="col" className="px-2 py-1 text-start">{d.itemsColSku}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.stockColQty}</th>
                  </tr>
                </thead>
                <tbody>
                  {explosion.totals.map((total) => (
                    <tr key={total.itemId} className="border-b border-subtle">
                      <td className="px-2 py-1.5">{total.sku}</td>
                      <td className="px-2 py-1.5 text-end">{qtyCell(total.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* -- create dialog --------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.mfgBomCreateTitle}>
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
          <Input
            label={d.mfgBomYield}
            value={createYield}
            onValueChange={setCreateYield}
            hint={d.mfgBomYieldHint}
            mono
            required
            error={!yieldValid(createYield) ? d.mfgErrBomYieldInvalid : undefined}
          />
          <Input
            label={d.mfgBomNote}
            value={createNote}
            onValueChange={setCreateNote}
          />
          <div className="flex items-end text-sm text-gray-600">
            {d.mfgBomOutputUom}:{" "}
            <span className="ms-1 font-mono" dir="ltr">
              {createItem !== undefined
                ? (uomLabelById.get(createItem.uomId) ?? createItem.uomId.slice(0, 8))
                : "—"}
            </span>
          </div>
        </div>

        <BomLinesEditor
          label={d.mfgBomLines}
          addLabel={d.mfgBomAddLine}
          removeLabel={d.mfgBomRemoveLine}
          componentLabel={d.mfgBomComponent}
          qtyLabel={d.mfgBomQtyPerOutput}
          scrapLabel={d.mfgBomScrapPct}
          options={stockItems.map((item) => ({
            value: item.id,
            label: itemLabelById.get(item.id) ?? item.sku,
          }))}
          lines={createLines}
          setLines={setCreateLines}
        />

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createBom()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- edit dialog (DRAFT full-replace) -------------------------------------- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen} title={d.mfgBomEditTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.mfgBomYield}
            value={editYield}
            onValueChange={setEditYield}
            hint={d.mfgBomYieldHint}
            mono
            required
            error={!yieldValid(editYield) ? d.mfgErrBomYieldInvalid : undefined}
          />
          <Input label={d.mfgBomNote} value={editNote} onValueChange={setEditNote} />
        </div>

        <BomLinesEditor
          label={d.mfgBomLines}
          addLabel={d.mfgBomAddLine}
          removeLabel={d.mfgBomRemoveLine}
          componentLabel={d.mfgBomComponent}
          qtyLabel={d.mfgBomQtyPerOutput}
          scrapLabel={d.mfgBomScrapPct}
          options={stockItems.map((item) => ({
            value: item.id,
            label: itemLabelById.get(item.id) ?? item.sku,
          }))}
          lines={editLines}
          setLines={setEditLines}
        />

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "edit"}
            disabled={!editReady}
            onClick={() => void saveEdit()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- activate dialog -------------------------------------------------------- */}
      <Dialog open={activateOpen} onOpenChange={setActivateOpen} title={d.mfgBomActivateTitle}>
        <DatePicker
          locale={locale}
          label={d.mfgBomEffectiveFrom}
          value={activateFrom}
          onSelect={setActivateFrom}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setActivateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "activate"}
            onClick={() => void activateBom()}
          >
            {d.mfgBomActivate}
          </Button>
        </div>
      </Dialog>

      {/* -- archive dialog (the confirm hint) ---------------------------------------- */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen} title={d.mfgBomArchive}>
        <p className="text-sm text-gray-600">{d.mfgBomArchiveHint}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setArchiveOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "archive"}
            onClick={() => void archiveBom()}
          >
            {d.mfgBomArchive}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** The multi-add component-lines editor (create + DRAFT full-replace share it). */
function BomLinesEditor({
  label,
  addLabel,
  removeLabel,
  componentLabel,
  qtyLabel,
  scrapLabel,
  options,
  lines,
  setLines,
}: {
  label: string;
  addLabel: string;
  removeLabel: string;
  componentLabel: string;
  qtyLabel: string;
  scrapLabel: string;
  options: { value: string; label: string }[];
  lines: BomLineDraft[];
  setLines: (next: BomLineDraft[]) => void;
}): JSX.Element {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
      <table className="mt-2 w-full text-sm" aria-label={label}>
        <thead>
          <tr className="border-b border-subtle text-xs text-gray-600">
            <th scope="col" className="px-2 py-1 text-start">{componentLabel}</th>
            <th scope="col" className="px-2 py-1 text-start">{qtyLabel}</th>
            <th scope="col" className="px-2 py-1 text-start">{scrapLabel}</th>
            <th scope="col" className="px-2 py-1 text-end">{removeLabel}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index} className="border-b border-subtle">
              <td className="px-2 py-1.5">
                <Select
                  aria-label={componentLabel}
                  value={line.componentItemId}
                  onValueChange={(value) =>
                    setLines(
                      lines.map((row, i) => (i === index ? { ...row, componentItemId: value } : row)),
                    )
                  }
                  placeholder="—"
                  options={options}
                  required
                />
              </td>
              <td className="px-2 py-1.5">
                <Input
                  aria-label={qtyLabel}
                  value={line.qtyPerOutput}
                  onValueChange={(value) =>
                    setLines(lines.map((row, i) => (i === index ? { ...row, qtyPerOutput: value } : row)))
                  }
                  mono
                  required
                />
              </td>
              <td className="px-2 py-1.5">
                <Input
                  aria-label={scrapLabel}
                  value={line.scrapPct}
                  onValueChange={(value) =>
                    setLines(lines.map((row, i) => (i === index ? { ...row, scrapPct: value } : row)))
                  }
                  mono
                />
              </td>
              <td className="px-2 py-1.5 text-end">
                <Button
                  variant="ghost"
                  disabled={lines.length <= 1}
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                >
                  {removeLabel}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2">
        <Button variant="secondary" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
