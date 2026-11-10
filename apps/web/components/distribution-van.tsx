"use client";

/**
 * PHASE-017 T14 (9a-dist) — the van fleet & van stock screen:
 *
 * - the fleet table (code, name, branch, bound rep, active) with the
 *   register dialog (one van per rep — the uq mirrors server-side);
 * - per-van balances off the `van_stocks` mirror (item / qty / value +
 *   totals; picking a van re-reads `distribution/van-stock?warehouseId=`
 *   which refreshes the mirror inside the owning transaction);
 * - load-out / unload dialogs (a main warehouse ↔ a van; the lines editor
 *   is item + positive-≤6dp qty) — both dispatch an ordinary transfer and
 *   land IN_TRANSIT until the other side receives it;
 * - the in-transit list with per-row receive (receive refreshes the
 *   destination van's mirror immediately).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  SalesRepRow,
  StockTransferRow,
  VanRow,
  VanStockRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { isPositiveDecimal, sumExact } from "../lib/exact-money";
import {
  formatMessage,
  localizedName,
  localizedDistributionError,
  localizedStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const VAN_CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** A movement line draft (load-out / unload share the shape). */
interface MoveLineDraft {
  key: number;
  itemId: string;
  qty: string;
}

let lineSeq = 0;

function newLine(): MoveLineDraft {
  lineSeq += 1;
  return { key: lineSeq, itemId: "", qty: "" };
}

function itemLabel(item: ItemRow, locale: Locale): string {
  const name = localizedName(item.name, item.nameAr, locale);
  return `${name} · ${item.sku}`;
}

export function DistributionVan({
  locale,
  initialVans,
  initialStock,
  branches,
  reps,
  warehouses,
  items,
  inTransit,
}: {
  locale: Locale;
  initialVans: readonly VanRow[];
  initialStock: readonly VanStockRow[];
  branches: readonly BranchRow[];
  reps: readonly SalesRepRow[];
  warehouses: readonly WarehouseRow[];
  items: readonly ItemRow[];
  inTransit: readonly StockTransferRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [vans, setVans] = useState<readonly VanRow[]>(initialVans);
  const [transfers, setTransfers] = useState<readonly StockTransferRow[]>(inTransit);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Register dialog state.
  const [registerOpen, setRegisterOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [branchId, setBranchId] = useState("");
  const [repId, setRepId] = useState("");

  // Balances state (per selected van).
  const [selectedVanId, setSelectedVanId] = useState("");
  const [stockRows, setStockRows] = useState<readonly VanStockRow[]>(initialStock);
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Load-out / unload dialog state.
  const [mode, setMode] = useState<"load-out" | "unload" | null>(null);
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [vanId, setVanId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [lines, setLines] = useState<MoveLineDraft[]>([newLine()]);

  const activeBranches = useMemo(
    () => branches.filter((branch) => branch.isActive),
    [branches],
  );
  const activeReps = useMemo(() => reps.filter((rep) => rep.status === "ACTIVE"), [reps]);
  const activeVans = useMemo(() => vans.filter((van) => van.isActive), [vans]);
  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) {
      map.set(branch.id, localizedName(branch.name, branch.nameAr, locale));
    }
    return map;
  }, [branches, locale]);
  const repLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const rep of reps) {
      map.set(rep.id, `${localizedName(rep.name, rep.nameAr, locale)} · ${rep.code}`);
    }
    return map;
  }, [reps, locale]);

  const codeValid = VAN_CODE_RE.test(code.trim());
  const registerReady = codeValid && name.trim() !== "" && branchId !== "" && repId !== "";
  const linesValid = lines.length >= 1 && lines.every((line) => line.itemId !== "" && isPositiveDecimal(line.qty));
  const moveReady = linesValid && vanId !== "" && (mode === "load-out" ? fromWarehouseId !== "" : toWarehouseId !== "");

  const selectedStock = useMemo(
    () => stockRows.filter((row) => row.warehouseId === selectedVanId),
    [stockRows, selectedVanId],
  );
  const totals = useMemo(() => {
    if (selectedStock.length === 0) return { qty: "0", value: "0" };
    return {
      qty: sumExact(selectedStock.map((row) => row.qty)),
      value: sumExact(selectedStock.map((row) => row.value)),
    };
  }, [selectedStock]);

  // -- fleet -------------------------------------------------------------------------

  async function registerVan(): Promise<void> {
    if (!registerReady) {
      setError(codeValid ? d.errorsValidation : d.distErrVanCodeTaken);
      return;
    }
    setBusy("register");
    setError(null);
    const result = await bffFetch<VanRow>("distribution/vans", {
      method: "POST",
      body: {
        code: code.trim(),
        name: name.trim(),
        nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
        branchId,
        salesRepId: repId,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setVans((current) => [result.data, ...current]);
    setRegisterOpen(false);
    const repName = localizedName(
      reps.find((rep) => rep.id === repId)?.name ?? repId,
      reps.find((rep) => rep.id === repId)?.nameAr ?? null,
      locale,
    );
    setCode("");
    setName("");
    setNameAr("");
    setBranchId("");
    setRepId("");
    setNotice(formatMessage(d.distVanRegisteredToast, { code: result.data.code, rep: repName }));
  }

  // -- balances ----------------------------------------------------------------------

  async function pickVan(nextVanId: string): Promise<void> {
    setSelectedVanId(nextVanId);
    if (nextVanId === "") {
      setStockRows([]);
      return;
    }
    setBalancesLoading(true);
    // Reading a specific van refreshes its mirror inside the request.
    const result = await bffFetch<readonly VanStockRow[]>(
      `distribution/van-stock?warehouseId=${nextVanId}`,
    );
    setBalancesLoading(false);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setStockRows(result.data);
  }

  // -- load-out / unload ----------------------------------------------------------------

  function openMove(nextMode: "load-out" | "unload"): void {
    setMode(nextMode);
    setFromWarehouseId("");
    setVanId("");
    setToWarehouseId("");
    setLines([newLine()]);
  }

  async function submitMove(): Promise<void> {
    if (mode === null || !moveReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("move");
    setError(null);
    const moveLines = lines.map((line) => ({ itemId: line.itemId, qty: line.qty }));
    const path =
      mode === "load-out"
        ? "distribution/van-stock/load-out"
        : "distribution/van-stock/unload";
    const payload =
      mode === "load-out"
        ? { fromWarehouseId, vanWarehouseId: vanId, lines: moveLines }
        : { vanWarehouseId: vanId, toWarehouseId, lines: moveLines };
    const result = await bffFetch<StockTransferRow>(path, { method: "POST", body: payload });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTransfers((current) => [result.data, ...current.filter((row) => row.id !== result.data.id)]);
    setMode(null);
    setNotice(
      formatMessage(
        mode === "load-out" ? d.distLoadOutToast : d.distUnloadToast,
        { no: result.data.transferNo ?? result.data.id.slice(0, 8) },
      ),
    );
  }

  async function receiveTransfer(transfer: StockTransferRow): Promise<void> {
    setBusy(transfer.id);
    setError(null);
    const result = await bffFetch<StockTransferRow>(
      `distribution/van-stock/transfers/${transfer.id}/receive`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    // POSTED rows leave the in-transit list; the destination van's mirror
    // was refreshed server-side — re-read if it is the selected van.
    setTransfers((current) => current.filter((row) => row.id !== transfer.id));
    if (selectedVanId === transfer.toWarehouseId) {
      await pickVan(selectedVanId);
    }
    setNotice(d.distTransfersReceiveToast);
  }

  // -- render ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.distributionVanTitle}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => openMove("load-out")}>
              {d.distLoadOutTitle}
            </Button>
            <Button variant="secondary" onClick={() => openMove("unload")}>
              {d.distUnloadTitle}
            </Button>
            <Button variant="primary" onClick={() => setRegisterOpen(true)}>
              {d.distVanRegister}
            </Button>
          </div>
        }
      >
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.distVanCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.code}
                </span>
              ),
            },
            {
              id: "name",
              header: activeLocaleHeader(d.distVanName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "branch",
              header: activeLocaleHeader(d.distVanBranch),
              accessor: (row) => branchNameById.get(row.branchId) ?? row.branchId,
            },
            {
              id: "rep",
              header: activeLocaleHeader(d.distVanRep),
              accessor: (row) => row.salesRepName ?? "—",
            },
            {
              id: "active",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => (row.isActive ? "ACTIVE" : "INACTIVE"),
              render: (row) => (
                <Badge tone={row.isActive ? "primary" : undefined}>
                  {localizedStatus(d, row.isActive ? "ACTIVE" : "INACTIVE")}
                </Badge>
              ),
            },
          ]}
          rows={[...vans]}
          rowKey={(row) => row.id}
          empty={{ title: d.distVanEmpty }}
        />
      </Card>

      <Card title={d.distVanBalancesTitle}>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.distVanPickVan}
            value={selectedVanId}
            onValueChange={(value) => void pickVan(value)}
            placeholder="—"
            options={activeVans.map((van) => ({
              value: van.id,
              label: `${localizedName(van.name, van.nameAr, locale)} · ${van.code}`,
            }))}
          />
          {selectedVanId !== "" && (
            <div className="flex items-center gap-4 rounded-md border border-subtle bg-surface-sunken px-3 py-2">
              <span className="text-sm text-gray-600">{d.distVanTotals}</span>
              <span className="font-mono tabular-nums" dir="ltr">
                {d.distVanQty}: {totals.qty} · {d.distVanValue}: {formatMoneyDisplay(totals.value, 2)}
              </span>
            </div>
          )}
        </div>
        <div className="mt-3">
          <DataTable
            loading={balancesLoading}
            columns={[
              {
                id: "sku",
                header: activeLocaleHeader(d.distVanSku),
                accessor: (row) => row.sku,
                mono: true,
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.sku}
                  </span>
                ),
              },
              {
                id: "item",
                header: activeLocaleHeader(d.distVanItem),
                accessor: (row) => localizedName(row.itemName, row.itemNameAr, locale),
              },
              {
                id: "qty",
                header: activeLocaleHeader(d.distVanQty),
                accessor: (row) => row.qty,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.qty}
                  </span>
                ),
              },
              {
                id: "value",
                header: activeLocaleHeader(d.distVanValue),
                accessor: (row) => row.value,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(row.value, 2)}
                  </span>
                ),
              },
            ]}
            rows={[...selectedStock]}
            rowKey={(row) => row.id}
            empty={{ title: d.distVanBalancesEmpty }}
          />
        </div>
      </Card>

      <Card title={d.distTransfersTitle} description={d.distTransfersVanOnly}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.transfersColNo),
              accessor: (row) => row.transferNo ?? "",
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.transferNo ?? "—"}
                </span>
              ),
            },
            {
              id: "from",
              header: activeLocaleHeader(d.transfersColFrom),
              accessor: (row) => row.fromWarehouseCode,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.fromWarehouseCode}
                </span>
              ),
            },
            {
              id: "to",
              header: activeLocaleHeader(d.transfersColTo),
              accessor: (row) => row.toWarehouseCode,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.toWarehouseCode}
                </span>
              ),
            },
            {
              id: "lines",
              header: activeLocaleHeader(d.transfersColLines),
              accessor: (row) => String(row.lineCount),
              numeric: true,
            },
            {
              id: "dispatchDate",
              header: activeLocaleHeader(d.transfersColDispatchDate),
              accessor: (row) => row.dispatchDate ?? "",
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.dispatchDate ?? "—"}
                </span>
              ),
            },
          ]}
          rows={[...transfers]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "receive",
              label: d.transfersReceive,
              onSelect: (row) => {
                if (row.status !== "IN_TRANSIT") return;
                void receiveTransfer(row);
              },
            },
          ]}
          empty={{ title: d.distTransfersEmpty }}
        />
      </Card>

      {/* -- register van dialog -------------------------------------------------- */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen} title={d.distVanRegister}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.distVanCode}
            value={code}
            onValueChange={setCode}
            error={code !== "" && !codeValid ? d.errorsValidation : undefined}
            mono
            bidiIsolate
            required
          />
          <Input label={d.distVanName} value={name} onValueChange={setName} required />
          <Input label={`${d.distVanName} (AR)`} value={nameAr} onValueChange={setNameAr} />
          <Select
            label={d.distVanBranch}
            value={branchId}
            onValueChange={setBranchId}
            placeholder="—"
            options={activeBranches.map((branch) => ({
              value: branch.id,
              label: branchNameById.get(branch.id) ?? branch.code,
            }))}
            required
          />
          <Select
            label={d.distVanRep}
            value={repId}
            onValueChange={setRepId}
            placeholder="—"
            options={activeReps.map((rep) => ({
              value: rep.id,
              label: repLabelById.get(rep.id) ?? rep.code,
            }))}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRegisterOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "register"}
            disabled={!registerReady}
            onClick={() => void registerVan()}
          >
            {d.distVanRegister}
          </Button>
        </div>
      </Dialog>

      {/* -- load-out / unload dialog ---------------------------------------------- */}
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null);
        }}
        title={mode === "unload" ? d.distUnloadTitle : d.distLoadOutTitle}
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "load-out" ? (
            <>
              <Select
                label={d.distLoadOutFrom}
                value={fromWarehouseId}
                onValueChange={setFromWarehouseId}
                placeholder="—"
                options={warehouses.map((warehouse) => ({
                  value: warehouse.id,
                  label: `${localizedName(warehouse.name, warehouse.nameAr, locale)} · ${warehouse.code}`,
                }))}
                required
              />
              <Select
                label={d.distLoadOutVan}
                value={vanId}
                onValueChange={setVanId}
                placeholder="—"
                options={activeVans.map((van) => ({
                  value: van.id,
                  label: `${localizedName(van.name, van.nameAr, locale)} · ${van.code}`,
                }))}
                required
              />
            </>
          ) : (
            <>
              <Select
                label={d.distUnloadVan}
                value={vanId}
                onValueChange={setVanId}
                placeholder="—"
                options={activeVans.map((van) => ({
                  value: van.id,
                  label: `${localizedName(van.name, van.nameAr, locale)} · ${van.code}`,
                }))}
                required
              />
              <Select
                label={d.distUnloadTo}
                value={toWarehouseId}
                onValueChange={setToWarehouseId}
                placeholder="—"
                options={warehouses.map((warehouse) => ({
                  value: warehouse.id,
                  label: `${localizedName(warehouse.name, warehouse.nameAr, locale)} · ${warehouse.code}`,
                }))}
                required
              />
            </>
          )}
        </div>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-gray-700">{mode === "unload" ? d.distUnloadTitle : d.distLoadOutTitle}</legend>
          <div className="mt-2 flex flex-col gap-2">
            {lines.map((line, index) => (
              <div key={line.key} className="flex flex-wrap items-end gap-2">
                <span className="w-10 text-sm text-gray-600" aria-hidden="true">
                  {index + 1}.
                </span>
                <span className="min-w-56">
                  <Select
                    label={d.distVanItem}
                    value={line.itemId}
                    onValueChange={(value) =>
                      setLines((current) =>
                        current.map((entry) =>
                          entry.key === line.key ? { ...entry, itemId: value } : entry,
                        ),
                      )
                    }
                    placeholder="—"
                    options={items.map((item) => ({
                      value: item.id,
                      label: itemLabel(item, locale),
                    }))}
                    aria-label={d.distVanItem}
                  />
                </span>
                <span className="w-32">
                  <Input
                    label={d.distVanQty}
                    value={line.qty}
                    onValueChange={(value) =>
                      setLines((current) =>
                        current.map((entry) =>
                          entry.key === line.key ? { ...entry, qty: value } : entry,
                        ),
                      )
                    }
                    error={
                      line.qty !== "" && !isPositiveDecimal(line.qty)
                        ? d.errorsValidation
                        : undefined
                    }
                    inputMode="decimal"
                    mono
                    bidiIsolate
                  />
                </span>
                <Button
                  variant="ghost"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((entry) => entry.key !== line.key))
                  }
                >
                  {d.distCompRemove}
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" className="mt-2" onClick={() => setLines((current) => [...current, newLine()])}>
            {d.distLoadOutAddLine}
          </Button>
        </fieldset>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setMode(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "move"}
            disabled={!moveReady}
            onClick={() => void submitMove()}
          >
            {mode === "unload" ? d.distUnloadBtn : d.distLoadOutBtn}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
