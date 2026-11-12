"use client";

/**
 * PHASE-044 (T-14) — the WMS location board: the zone→aisle→rack→bin tree
 * with inline creation at every level, the bin-contents view, the INV-029
 * reconciliation report, and the LPN registry with move-by-LPN. Structural
 * surface only — valuation never moves here (the movement core owns the
 * economic writes; this board only edits the location topology).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  WarehouseRow,
  WmsBinRow,
  WmsBinContentRow,
  WmsLpnRow,
  WmsLocationTreeNode,
  WmsReconcileRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedInventoryError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function InventoryLocations({
  locale,
  warehouses,
  initialWarehouseId,
  initialTree,
  initialContents,
  initialReconcile,
  initialLpns,
  canManage,
}: {
  locale: Locale;
  warehouses: readonly WarehouseRow[];
  initialWarehouseId: string;
  initialTree: readonly WmsLocationTreeNode[];
  initialContents: readonly WmsBinContentRow[];
  initialReconcile: readonly WmsReconcileRow[];
  initialLpns: readonly WmsLpnRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [tree, setTree] = useState<readonly WmsLocationTreeNode[]>(initialTree);
  const [contents, setContents] = useState<readonly WmsBinContentRow[]>(initialContents);
  const [reconcile, setReconcile] = useState<readonly WmsReconcileRow[]>(initialReconcile);
  const [lpns, setLpns] = useState<readonly WmsLpnRow[]>(initialLpns);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The create forms.
  const [zoneCode, setZoneCode] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [zoneNameAr, setZoneNameAr] = useState("");
  const [zoneType, setZoneType] = useState("PICKING");
  const [zoneIsDefault, setZoneIsDefault] = useState(false);
  const [aisleFor, setAisleFor] = useState("");
  const [aisleCode, setAisleCode] = useState("");
  const [aisleName, setAisleName] = useState("");
  const [rackFor, setRackFor] = useState("");
  const [rackCode, setRackCode] = useState("");
  const [rackName, setRackName] = useState("");
  const [binFor, setBinFor] = useState("");
  const [binCode, setBinCode] = useState("");
  const [binBarcode, setBinBarcode] = useState("");
  const [binName, setBinName] = useState("");
  const [binPickSeq, setBinPickSeq] = useState("");
  const [lpnCode, setLpnCode] = useState("");
  const [moveLpnId, setMoveLpnId] = useState("");
  const [moveToBin, setMoveToBin] = useState("");

  const allBins = useMemo(() => {
    const list: WmsBinRow[] = [];
    for (const zone of tree) {
      for (const aisle of zone.aisles) {
        for (const rack of aisle.racks) {
          list.push(...rack.bins);
        }
      }
    }
    return list;
  }, [tree]);

  const zoneTypeLabel = (type: string): string =>
    type === "PICKING" ? d.wmsLocationsZone :
    type === "BULK" ? "BULK" :
    type === "QUARANTINE" ? d.wmsStatusQuarantine :
    type === "DOCK" ? "DOCK" : "STAGE";

  async function reloadWarehouse(nextId: string): Promise<void> {
    setWarehouseId(nextId);
    setBusy("reload");
    setError(null);
    const [treeRes, contentsRes, reconcileRes] = await Promise.all([
      bffFetch<readonly WmsLocationTreeNode[]>(`inventory/wms/locations/tree?warehouseId=${nextId}`),
      bffFetch<readonly WmsBinContentRow[]>(`inventory/wms/bin-contents?warehouseId=${nextId}&limit=500`),
      bffFetch<readonly WmsReconcileRow[]>(`inventory/wms/reconcile?warehouseId=${nextId}`),
    ]);
    setBusy(null);
    if (!treeRes.ok) {
      setError(localizedInventoryError(d, treeRes.error, treeRes.retryAfterSeconds));
      return;
    }
    if (!contentsRes.ok) {
      setError(localizedInventoryError(d, contentsRes.error, contentsRes.retryAfterSeconds));
      return;
    }
    if (!reconcileRes.ok) {
      setError(localizedInventoryError(d, reconcileRes.error, reconcileRes.retryAfterSeconds));
      return;
    }
    setTree(treeRes.data);
    setContents(contentsRes.data);
    setReconcile(reconcileRes.data);
    router.refresh();
  }

  async function createZone(): Promise<void> {
    if (warehouseId === "" || zoneCode.trim() === "" || zoneName.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("zone");
    setError(null);
    setNotice(null);
    const created = await bffFetch("inventory/wms/zones", {
      method: "POST",
      body: {
        warehouseId,
        code: zoneCode.trim(),
        name: zoneName.trim(),
        nameAr: zoneNameAr.trim() === "" ? null : zoneNameAr.trim(),
        zoneType,
        isDefault: zoneIsDefault,
        note: null,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setZoneCode("");
    setZoneName("");
    setZoneNameAr("");
    setZoneIsDefault(false);
    setNotice(d.wmsLocationsZoneCreatedToast);
    await reloadWarehouse(warehouseId);
  }

  async function createAisle(): Promise<void> {
    if (aisleFor === "" || aisleCode.trim() === "" || aisleName.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("aisle");
    setError(null);
    setNotice(null);
    const created = await bffFetch(`inventory/wms/zones/${aisleFor}/aisles`, {
      method: "POST",
      body: { code: aisleCode.trim(), name: aisleName.trim() },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setAisleCode("");
    setAisleName("");
    setNotice(d.wmsLocationsAisleCreatedToast);
    await reloadWarehouse(warehouseId);
  }

  async function createRack(): Promise<void> {
    if (rackFor === "" || rackCode.trim() === "" || rackName.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("rack");
    setError(null);
    setNotice(null);
    const created = await bffFetch(`inventory/wms/aisles/${rackFor}/racks`, {
      method: "POST",
      body: { code: rackCode.trim(), name: rackName.trim() },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRackCode("");
    setRackName("");
    setNotice(d.wmsLocationsRackCreatedToast);
    await reloadWarehouse(warehouseId);
  }

  async function createBin(): Promise<void> {
    if (
      binFor === "" ||
      binCode.trim() === "" ||
      binBarcode.trim() === "" ||
      binName.trim() === "" ||
      (binPickSeq.trim() !== "" && !/^\d+$/.test(binPickSeq.trim()))
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("bin");
    setError(null);
    setNotice(null);
    const created = await bffFetch("inventory/wms/bins", {
      method: "POST",
      body: {
        warehouseId,
        rackId: binFor,
        code: binCode.trim(),
        barcode: binBarcode.trim(),
        name: binName.trim(),
        pickSequence: binPickSeq.trim() === "" ? null : Number(binPickSeq.trim()),
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setBinCode("");
    setBinBarcode("");
    setBinName("");
    setBinPickSeq("");
    setNotice(d.wmsLocationsBinCreatedToast);
    await reloadWarehouse(warehouseId);
  }

  async function createLpn(): Promise<void> {
    if (lpnCode.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("lpn");
    setError(null);
    setNotice(null);
    const created = await bffFetch<WmsLpnRow>("inventory/wms/lpns", {
      method: "POST",
      body: { lpnCode: lpnCode.trim(), note: null },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setLpnCode("");
    setLpns((rows) => [created.data, ...rows]);
    setNotice(d.wmsLpnCreatedToast);
  }

  async function closeLpn(id: string): Promise<void> {
    setBusy(`lpn-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsLpnRow>(`inventory/wms/lpns/${id}/close`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setLpns((rows) => rows.map((row) => (row.id === id ? result.data : row)));
    setNotice(d.wmsLpnClosedToast);
  }

  async function moveLpn(): Promise<void> {
    if (moveLpnId === "" || moveToBin === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("move");
    setError(null);
    setNotice(null);
    const moved = await bffFetch(`inventory/wms/lpns/${moveLpnId}/move`, {
      method: "POST",
      body: { toBinId: moveToBin, note: null },
    });
    setBusy(null);
    if (!moved.ok) {
      setError(localizedInventoryError(d, moved.error, moved.retryAfterSeconds));
      return;
    }
    setMoveLpnId("");
    setMoveToBin("");
    setNotice(d.wmsLpnMovedToast);
    await reloadWarehouse(warehouseId);
  }

  const statusLabel = (status: string): string =>
    status === "AVAILABLE" ? d.wmsStatusAvailable :
    status === "QUARANTINE" ? d.wmsStatusQuarantine : d.wmsStatusHold;

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.wmsLocationsTitle}>
        <div className="max-w-sm">
          <Select
            label={d.wmsLocationsFilterWarehouse}
            value={warehouseId}
            onValueChange={(value) => void reloadWarehouse(value)}
            options={warehouses
              .filter((w) => w.isActive)
              .map((w) => ({
                value: w.id,
                label: localizedName(w.name, w.nameAr, locale),
              }))}
          />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {tree.length === 0 && <p className="text-sm text-muted-foreground">{d.wmsLocationsEmpty}</p>}
          {tree.map((zone) => (
            <details key={zone.id} className="rounded-md border border-border" data-testid="wms-zone">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                <span className="font-mono" dir="ltr">{zone.code}</span>{" · "}
                {zone.name}
                {zone.isDefault && (
                  <span className="ms-2 text-xs text-muted-foreground">({d.wmsLocationsDefault})</span>
                )}
                <span className="ms-2 text-xs text-muted-foreground">{zoneTypeLabel(zone.zoneType)}</span>
              </summary>
              <div className="border-t border-border px-3 py-2">
                {zone.aisles.length === 0 && (
                  <p className="text-xs text-muted-foreground">{d.wmsLocationsNoAisles}</p>
                )}
                {zone.aisles.map((aisle) => (
                  <details key={aisle.id} className="ms-2 rounded-md border border-border" data-testid="wms-aisle">
                    <summary className="cursor-pointer px-3 py-1.5 text-sm">
                      <span className="font-mono" dir="ltr">{aisle.code}</span>{" · "}
                      {aisle.name}
                    </summary>
                    <div className="border-t border-border px-3 py-2">
                      {aisle.racks.length === 0 && (
                        <p className="text-xs text-muted-foreground">{d.wmsLocationsNoRacks}</p>
                      )}
                      {aisle.racks.map((rack) => (
                        <details key={rack.id} className="ms-2 rounded-md border border-border" data-testid="wms-rack">
                          <summary className="cursor-pointer px-3 py-1.5 text-sm">
                            <span className="font-mono" dir="ltr">{rack.code}</span>{" · "}
                            {rack.name}
                            <span className="ms-2 text-xs text-muted-foreground">
                              ({rack.bins.length} {d.wmsLocationsBin})
                            </span>
                          </summary>
                          <div className="border-t border-border px-3 py-2">
                            {rack.bins.length === 0 && (
                              <p className="text-xs text-muted-foreground">{d.wmsLocationsNoBins}</p>
                            )}
                            {rack.bins.length > 0 && (
                              <DataTable
                                columns={[
                                  {
                                    id: "code",
                                    header: activeLocaleHeader(d.wmsLocationsBin),
                                    accessor: (row: WmsBinRow) => row.code,
                                    mono: true,
                                    render: (row: WmsBinRow) => (
                                      <span className="font-mono text-sm" dir="ltr">{row.code}</span>
                                    ),
                                  },
                                  {
                                    id: "barcode",
                                    header: activeLocaleHeader(d.wmsLocationsColBarcode),
                                    accessor: (row: WmsBinRow) => row.barcode,
                                    mono: true,
                                    render: (row: WmsBinRow) => (
                                      <span className="font-mono text-sm" dir="ltr">{row.barcode}</span>
                                    ),
                                  },
                                  {
                                    id: "seq",
                                    header: activeLocaleHeader(d.wmsLocationsColPickSeq),
                                    accessor: (row: WmsBinRow) => String(row.pickSequence ?? 0),
                                    render: (row: WmsBinRow) => row.pickSequence ?? "—",
                                  },
                                  {
                                    id: "default",
                                    header: activeLocaleHeader(d.wmsLocationsDefault),
                                    accessor: (row: WmsBinRow) => (row.isDefault ? "Y" : "N"),
                                    render: (row: WmsBinRow) =>
                                      row.isDefault ? d.wmsLocationsDefault : "—",
                                  },
                                ]}
                                rows={[...rack.bins]}
                                rowKey={(row) => row.id}
                                empty={{ title: d.wmsLocationsNoBins }}
                              />
                            )}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      </Card>

      {canManage && (
        <>
          <Card title={d.wmsLocationsCreateZoneTitle}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Input label={d.wmsLocationsZoneCodeLabel} value={zoneCode} onValueChange={setZoneCode} mono bidiIsolate required />
              <Input label={d.wmsLocationsZoneNameLabel} value={zoneName} onValueChange={setZoneName} required />
              <Input label={d.wmsLocationsZoneNameArLabel} value={zoneNameAr} onValueChange={setZoneNameAr} />
              <Select
                label={d.wmsLocationsZoneTypeLabel}
                value={zoneType}
                onValueChange={setZoneType}
                options={[
                  { value: "PICKING", label: "PICKING" },
                  { value: "BULK", label: "BULK" },
                  { value: "QUARANTINE", label: "QUARANTINE" },
                  { value: "DOCK", label: "DOCK" },
                  { value: "STAGE", label: "STAGE" },
                ]}
              />
              <Select
                label={d.wmsLocationsZoneDefaultLabel}
                value={zoneIsDefault ? "yes" : "no"}
                onValueChange={(value) => setZoneIsDefault(value === "yes")}
                options={[
                  { value: "no", label: "—" },
                  { value: "yes", label: d.wmsLocationsDefault },
                ]}
              />
            </div>
            <Button variant="primary" className="mt-3 self-start" loading={busy === "zone"} onClick={() => void createZone()}>
              {d.commonCreate}
            </Button>
          </Card>

          <Card title={d.wmsLocationsAddAisle}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label={d.wmsLocationsZone}
                value={aisleFor}
                onValueChange={setAisleFor}
                placeholder="—"
                options={tree.map((zone) => ({
                  value: zone.id,
                  label: `${zone.code} · ${zone.name}`,
                }))}
                required
              />
              <Input label={d.wmsLocationsAisleCodeLabel} value={aisleCode} onValueChange={setAisleCode} mono bidiIsolate required />
              <Input label={d.wmsLocationsAisleNameLabel} value={aisleName} onValueChange={setAisleName} required />
            </div>
            <Button variant="primary" className="mt-3 self-start" loading={busy === "aisle"} onClick={() => void createAisle()}>
              {d.commonCreate}
            </Button>
          </Card>

          <Card title={d.wmsLocationsAddRack}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label={d.wmsLocationsAisle}
                value={rackFor}
                onValueChange={setRackFor}
                placeholder="—"
                options={tree.flatMap((zone) =>
                  zone.aisles.map((aisle) => ({
                    value: aisle.id,
                    label: `${zone.code} / ${aisle.code} · ${aisle.name}`,
                  })),
                )}
                required
              />
              <Input label={d.wmsLocationsRackCodeLabel} value={rackCode} onValueChange={setRackCode} mono bidiIsolate required />
              <Input label={d.wmsLocationsRackNameLabel} value={rackName} onValueChange={setRackName} required />
            </div>
            <Button variant="primary" className="mt-3 self-start" loading={busy === "rack"} onClick={() => void createRack()}>
              {d.commonCreate}
            </Button>
          </Card>

          <Card title={d.wmsLocationsCreateBinTitle}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Select
                label={d.wmsLocationsRack}
                value={binFor}
                onValueChange={setBinFor}
                placeholder="—"
                options={tree.flatMap((zone) =>
                  zone.aisles.flatMap((aisle) =>
                    aisle.racks.map((rack) => ({
                      value: rack.id,
                      label: `${zone.code} / ${aisle.code} / ${rack.code}`,
                    })),
                  ),
                )}
                required
              />
              <Input label={d.wmsLocationsBinCodeLabel} value={binCode} onValueChange={setBinCode} mono bidiIsolate required />
              <Input label={d.wmsLocationsBinBarcodeLabel} value={binBarcode} onValueChange={setBinBarcode} mono bidiIsolate required />
              <Input label={d.wmsLocationsBinNameLabel} value={binName} onValueChange={setBinName} required />
              <Input label={d.wmsLocationsBinPickSeqLabel} value={binPickSeq} onValueChange={setBinPickSeq} inputMode="numeric" />
            </div>
            <Button variant="primary" className="mt-3 self-start" loading={busy === "bin"} onClick={() => void createBin()}>
              {d.commonCreate}
            </Button>
          </Card>
        </>
      )}

      <Card title={d.wmsLocationsContentsTitle}>
        <DataTable
          columns={[
            {
              id: "bin",
              header: activeLocaleHeader(d.wmsQColBin),
              accessor: (row) => row.binCode ?? "",
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.binCode ?? "—"}</span>
              ),
            },
            {
              id: "item",
              header: activeLocaleHeader(d.wmsLocationsContentsColItem),
              accessor: (row) => row.itemSku ?? row.itemId,
              mono: true,
            },
            {
              id: "batch",
              header: activeLocaleHeader(d.wmsLocationsContentsColBatch),
              accessor: (row) => row.batchNo ?? "",
              render: (row) => row.batchNo ?? "—",
            },
            {
              id: "serial",
              header: activeLocaleHeader(d.wmsLocationsContentsColSerial),
              accessor: (row) => row.serialNo ?? "",
              render: (row) => row.serialNo ?? "—",
            },
            {
              id: "qty",
              header: activeLocaleHeader(d.wmsLocationsContentsColQty),
              accessor: (row) => row.qty,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.qty}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.wmsLocationsContentsColStatus),
              accessor: (row) => row.status,
              render: (row) => statusLabel(row.status),
            },
            {
              id: "lpn",
              header: activeLocaleHeader(d.wmsLocationsContentsColLpn),
              accessor: (row) => row.lpnCode ?? "",
              render: (row) => row.lpnCode ?? "—",
            },
            {
              id: "owner",
              header: activeLocaleHeader(d.wmsLocationsContentsColOwner),
              accessor: (row) => row.ownerPartnerName ?? "",
              render: (row) => row.ownerPartnerName ?? "—",
            },
          ]}
          rows={[...contents]}
          rowKey={(row) => row.id}
          empty={{ title: d.wmsLocationsContentsEmpty }}
        />
      </Card>

      <Card title={d.wmsLocationsReconcileTitle}>
        {reconcile.length === 0 ? (
          <p className="text-sm text-success-foreground">{d.wmsLocationsReconcileOk}</p>
        ) : (
          <DataTable
            columns={[
              {
                id: "wh",
                header: activeLocaleHeader(d.wmsLocationsReconcileColWarehouse),
                accessor: (row) => row.warehouseCode ?? row.warehouseId,
              },
              {
                id: "item",
                header: activeLocaleHeader(d.wmsLocationsReconcileColItem),
                accessor: (row) => row.itemSku ?? row.itemId,
                mono: true,
              },
              {
                id: "bins",
                header: activeLocaleHeader(d.wmsLocationsReconcileColBins),
                accessor: (row) => row.binQty,
                mono: true,
              },
              {
                id: "stock",
                header: activeLocaleHeader(d.wmsLocationsReconcileColStock),
                accessor: (row) => row.stockQty,
                mono: true,
              },
              {
                id: "diff",
                header: activeLocaleHeader(d.wmsLocationsReconcileColDiff),
                accessor: (row) => row.difference,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm text-danger-foreground" dir="ltr">{row.difference}</span>
                ),
              },
            ]}
            rows={[...reconcile]}
            rowKey={(row) => `${row.warehouseId}:${row.itemId}`}
            empty={{ title: d.wmsLocationsReconcileOk }}
          />
        )}
      </Card>

      <Card title={d.wmsLpnTitle}>
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.wmsLpnColCode),
              accessor: (row) => row.lpnCode,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.lpnCode}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.wmsLpnColStatus),
              accessor: (row) => row.status,
              render: (row) => (row.status === "ACTIVE" ? d.wmsLpnActive : d.wmsLpnClosed),
            },
            {
              id: "note",
              header: activeLocaleHeader(d.wmsLpnColNote),
              accessor: (row) => row.note ?? "",
              render: (row) => row.note ?? "—",
            },
          ]}
          rows={[...lpns]}
          rowKey={(row) => row.id}
          rowActions={
            canManage
              ? [
                  {
                    id: "close",
                    label: d.wmsLpnClose,
                    onSelect: (row: WmsLpnRow) => {
                      if (row.status !== "ACTIVE") return;
                      void closeLpn(row.id);
                    },
                  },
                ]
              : []
          }
          empty={{ title: d.wmsLpnEmpty }}
        />

        {canManage && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Input label={d.wmsLpnCodeLabel} value={lpnCode} onValueChange={setLpnCode} mono bidiIsolate />
            <Button variant="primary" className="self-end" loading={busy === "lpn"} onClick={() => void createLpn()}>
              {d.commonCreate}
            </Button>
          </div>
        )}
      </Card>

      {canManage && (
        <Card title={d.wmsLpnMoveTitle}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label={d.wmsLpnTitle}
              value={moveLpnId}
              onValueChange={setMoveLpnId}
              placeholder="—"
              options={lpns
                .filter((row) => row.status === "ACTIVE")
                .map((row) => ({ value: row.id, label: row.lpnCode }))}
              required
            />
            <Select
              label={d.wmsLpnMoveTargetLabel}
              value={moveToBin}
              onValueChange={setMoveToBin}
              placeholder="—"
              options={allBins.map((bin) => ({ value: bin.id, label: bin.code }))}
              required
            />
            <Button variant="primary" className="self-end" loading={busy === "move"} onClick={() => void moveLpn()}>
              {d.wmsLpnMoveBtn}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
