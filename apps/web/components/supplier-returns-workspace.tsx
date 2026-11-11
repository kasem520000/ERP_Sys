"use client";

/**
 * WEB-039 (PHASE-039) — the supplier returns workspace (/purchasing/returns;
 * transaction-entry archetype, matrix §3.3): the RTV registry over the 0059
 * routes — the create dialog (PO picker over APPROVED/ISSUED/CLOSED orders
 * → per-line qty inputs over the PO's lines, the seven-code reason
 * vocabulary) and the lifecycle REQUESTED → approve → ship (the warehouse
 * whose stock issues) → credit (G-38: the supplier debit note + the
 * returns-account journal) with cancel off the live states. The detail
 * dialog carries the header + lines.
 *
 * Writes gate in-screen on purchasing.rma.manage (the session-derived flag
 * the page passes); every API failure renders localized through the
 * supplier-returns error family.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  useToast,
} from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  ApiResult,
  BranchRow,
  ItemRow,
  PartnerRow,
  PurchaseOrderRow,
  PurchaseOrderWithLines,
  SupplierRmaReasonCode,
  SupplierRmaRow,
  SupplierRmaWithLines,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** SRMA lifecycle tones (the neutral/primary Badge vocabulary). */
const SRMA_TONES: Record<SupplierRmaRow["status"], "primary" | "neutral"> = {
  REQUESTED: "neutral",
  APPROVED: "primary",
  SHIPPED: "primary",
  CREDITED: "neutral",
  CANCELLED: "neutral",
};

const QTY_RE = /^\d+(\.\d{1,6})?$/;

/** The PO states a return can reference (the API's PO_RETURNABLE_STATUSES). */
const PO_RETURNABLE_STATUSES = new Set(["APPROVED", "ISSUED", "CLOSED"]);

const SUPPLIER_REASONS: readonly SupplierRmaReasonCode[] = [
  "DAMAGED",
  "DEFECTIVE",
  "WRONG_ITEM",
  "OVER_SHIPMENT",
  "EXPIRED",
  "RECALL",
  "OTHER",
];

/** The create-SRMA draft (all inputs are strings; the lines ride the map). */
interface SrmaDraft {
  branchId: string;
  purchaseOrderId: string;
  reasonCode: SupplierRmaReasonCode;
  reason: string;
  note: string;
  /** poLineId → qty ("" = skip the line). */
  qtys: Record<string, string>;
}

function emptySrmaDraft(): SrmaDraft {
  return {
    branchId: "",
    purchaseOrderId: "",
    reasonCode: "DAMAGED",
    reason: "",
    note: "",
    qtys: {},
  };
}

/**
 * Stable supplier-returns error family → honest messages
 * (localizedApiError covers the generic families).
 */
function srmaError(
  d: Dictionary,
  failure: { error: ApiErrorBody; retryAfterSeconds?: number },
): string {
  switch (failure.error.code) {
    case "SUPPLIER_RMA_NOT_FOUND":
    case "PURCHASE_ORDER_NOT_FOUND":
      return d.errorsNotFound;
    case "SUPPLIER_RMA_STATE_INVALID":
    case "SALES_DOCUMENT_STATE":
    case "ORDER_LINE_INVALID":
      return d.srmaErrState;
    case "SUPPLIER_RMA_QTY_EXCEEDS_PURCHASED":
      return d.srmaErrQtyExceeds;
    case "SUPPLIER_RETURN_ACCOUNT_UNMAPPED":
      return d.srmaErrUnmapped;
    default:
      return localizedApiError(d, failure.error, failure.retryAfterSeconds);
  }
}

function srmaStatusLabel(d: Dictionary, status: SupplierRmaRow["status"]): string {
  const map: Record<SupplierRmaRow["status"], string> = {
    REQUESTED: d.srmaStatusRequested,
    APPROVED: d.srmaStatusApproved,
    SHIPPED: d.srmaStatusShipped,
    CREDITED: d.srmaStatusCredited,
    CANCELLED: d.srmaStatusCancelled,
  };
  return map[status];
}

function reasonLabel(d: Dictionary, reasonCode: SupplierRmaReasonCode): string {
  const map: Record<SupplierRmaReasonCode, string> = {
    DAMAGED: d.returnsReasonDamaged,
    DEFECTIVE: d.returnsReasonDefective,
    WRONG_ITEM: d.returnsReasonWrongItem,
    OVER_SHIPMENT: d.returnsReasonOverShipment,
    EXPIRED: d.returnsReasonExpired,
    RECALL: d.returnsReasonRecall,
    OTHER: d.returnsReasonOther,
  };
  return map[reasonCode];
}

export function SupplierReturnsWorkspace({
  locale,
  initialSrmas,
  suppliers,
  items,
  purchaseOrders,
  branches,
  warehouses,
  canManage,
}: {
  locale: Locale;
  initialSrmas: readonly SupplierRmaRow[];
  suppliers: readonly PartnerRow[];
  items: readonly ItemRow[];
  purchaseOrders: readonly PurchaseOrderRow[];
  branches: readonly BranchRow[];
  warehouses: readonly WarehouseRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [srmas, setSrmas] = useState<readonly SupplierRmaRow[]>(initialSrmas);

  // -- create / detail / lifecycle dialogs -------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<SrmaDraft>(emptySrmaDraft);
  /** The picked PO's detail (drives the per-line qty inputs). */
  const [pickedPo, setPickedPo] = useState<PurchaseOrderWithLines | null>(null);
  const [detail, setDetail] = useState<SupplierRmaWithLines | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [shipTarget, setShipTarget] = useState<SupplierRmaRow | null>(null);
  const [shipWarehouseId, setShipWarehouseId] = useState("");
  const [cancelTarget, setCancelTarget] = useState<SupplierRmaRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const supplier of suppliers) {
      map.set(supplier.id, localizedName(supplier.name, supplier.nameAr, locale));
    }
    return map;
  }, [suppliers, locale]);

  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} — ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  const returnableOrders = useMemo(
    () => purchaseOrders.filter((order) => PO_RETURNABLE_STATUSES.has(order.status)),
    [purchaseOrders],
  );

  const poLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of purchaseOrders) {
      const supplier = supplierNameById.get(order.supplierId) ?? order.supplierId.slice(0, 8);
      map.set(
        order.id,
        `${order.orderNo ?? order.id.slice(0, 8)} — ${supplier} · ${order.orderDate}`,
      );
    }
    return map;
  }, [purchaseOrders, supplierNameById]);

  const branchOptions = useMemo(() => {
    const options = branches
      .filter((branch) => branch.isActive)
      .map((branch) => ({
        value: branch.id,
        label: localizedName(branch.name, branch.nameAr, locale),
      }));
    // Rows referencing unreadable branches stay selectable with the honest
    // raw id (the zatca-devices fallback).
    for (const srma of srmas) {
      if (options.some((option) => option.value === srma.branchId)) {
        continue;
      }
      options.push({ value: srma.branchId, label: srma.branchId });
    }
    return options;
  }, [branches, srmas, locale]);

  const warehouseOptions = useMemo(
    () =>
      warehouses
        .filter((warehouse) => warehouse.isActive)
        .map((warehouse) => ({
          value: warehouse.id,
          label: localizedName(warehouse.name, warehouse.nameAr, locale),
        })),
    [warehouses, locale],
  );

  function supplierLabel(supplierId: string): string {
    return supplierNameById.get(supplierId) ?? supplierId;
  }

  function poLabel(purchaseOrderId: string): string {
    return poLabelById.get(purchaseOrderId) ?? purchaseOrderId.slice(0, 8);
  }

  async function call<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(srmaError(d, result));
      return undefined;
    }
    return result.data;
  }

  /** Loads the picked PO's lines for the per-line qty inputs. */
  async function pickPo(purchaseOrderId: string): Promise<void> {
    setCreateDraft((draft) => ({ ...draft, purchaseOrderId, qtys: {} }));
    setPickedPo(null);
    if (purchaseOrderId === "") {
      return;
    }
    const loaded = await bffFetch<PurchaseOrderWithLines>(
      `purchasing/purchase-orders/${purchaseOrderId}`,
    );
    if (!loaded.ok) {
      setError(srmaError(d, loaded));
      return;
    }
    setPickedPo(loaded.data);
  }

  function createReady(): boolean {
    // Empty qty = skip the line; a typed-but-invalid qty blocks the submit
    // (no silent line drops — the sourcing every-line discipline).
    const entries = Object.entries(createDraft.qtys).filter(([lineId]) => lineId !== "");
    const anyInvalid = entries.some(([qty]) => qty.trim() !== "" && !QTY_RE.test(qty.trim()));
    const filled = entries.filter(([, qty]) => QTY_RE.test(qty.trim()));
    return (
      createDraft.branchId !== "" &&
      createDraft.purchaseOrderId !== "" &&
      pickedPo !== null &&
      !anyInvalid &&
      filled.length > 0
    );
  }

  async function createSrma(): Promise<void> {
    if (!createReady()) {
      setError(d.errorsValidation);
      return;
    }
    const trimOrNull = (value: string): string | null => {
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    };
    const lines = Object.entries(createDraft.qtys)
      .filter(([lineId, qty]) => lineId !== "" && QTY_RE.test(qty.trim()))
      .map(([poLineId, qty]) => ({ poLineId, qty: qty.trim(), note: null }));
    const created = await call<SupplierRmaRow>("srma-create", () =>
      bffFetch<SupplierRmaRow>("purchasing/returns", {
        method: "POST",
        body: {
          branchId: createDraft.branchId,
          purchaseOrderId: createDraft.purchaseOrderId,
          reasonCode: createDraft.reasonCode,
          reason: trimOrNull(createDraft.reason),
          note: trimOrNull(createDraft.note),
          lines,
        },
      }),
    );
    if (created !== undefined) {
      setCreateOpen(false);
      setCreateDraft(emptySrmaDraft());
      setPickedPo(null);
      setSrmas((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.srmaToastCreated });
      router.refresh();
    }
  }

  async function openDetail(row: SupplierRmaRow): Promise<void> {
    setDetailOpen(true);
    setDetail(null);
    const loaded = await bffFetch<SupplierRmaWithLines>(`purchasing/returns/${row.id}`);
    if (!loaded.ok) {
      setDetailOpen(false);
      setError(srmaError(d, loaded));
      return;
    }
    setDetail(loaded.data);
  }

  async function srmaAction(row: SupplierRmaRow, action: "approve" | "credit"): Promise<void> {
    const updated = await call<SupplierRmaRow>(`${action}-${row.id}`, () =>
      bffFetch<SupplierRmaRow>(`purchasing/returns/${row.id}/${action}`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setSrmas((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.srmaToastDone });
      router.refresh();
    }
  }

  async function submitShip(): Promise<void> {
    if (shipTarget === null || shipWarehouseId === "") {
      setError(d.errorsValidation);
      return;
    }
    const updated = await call<SupplierRmaRow>(`ship-${shipTarget.id}`, () =>
      bffFetch<SupplierRmaRow>(`purchasing/returns/${shipTarget.id}/ship`, {
        method: "POST",
        body: { warehouseId: shipWarehouseId },
      }),
    );
    if (updated !== undefined) {
      setShipTarget(null);
      setShipWarehouseId("");
      setSrmas((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.srmaToastDone });
      router.refresh();
    }
  }

  async function submitCancel(): Promise<void> {
    // The API's cancelSchema requires a 3–500 char reason — validate the
    // typed draft (not the row's own create reason) before the wire.
    const reason = cancelReason.trim();
    if (cancelTarget === null || reason.length < 3) {
      setError(d.errorsValidation);
      return;
    }
    const id = cancelTarget.id;
    const updated = await call<SupplierRmaRow>(`cancel-${id}`, () =>
      bffFetch<SupplierRmaRow>(`purchasing/returns/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
    );
    if (updated !== undefined) {
      setCancelTarget(null);
      setCancelReason("");
      setSrmas((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.srmaToastDone });
      router.refresh();
    }
  }

  // -- render -----------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      {canManage && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              setCreateDraft(emptySrmaDraft());
              setPickedPo(null);
              setCreateOpen(true);
            }}
          >
            {d.srmaActionCreate}
          </Button>
        </div>
      )}

      <Card title={d.supplierReturnsTitle}>
        <DataTable
          columns={[
            {
              id: "srmaNo",
              header: activeLocaleHeader(d.srmaColNo),
              accessor: (row: SupplierRmaRow) => row.srmaNo ?? "—",
              mono: true,
              render: (row: SupplierRmaRow) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.srmaNo ?? "—"}
                </span>
              ),
            },
            {
              id: "supplier",
              header: activeLocaleHeader(d.srmaColSupplier),
              accessor: (row: SupplierRmaRow) => supplierLabel(row.supplierId),
            },
            {
              id: "po",
              header: activeLocaleHeader(d.srmaColPo),
              accessor: (row: SupplierRmaRow) => poLabel(row.purchaseOrderId),
              render: (row: SupplierRmaRow) => (
                <span className="font-mono text-xs" dir="ltr">
                  {poLabel(row.purchaseOrderId)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.returnsColStatus),
              accessor: (row: SupplierRmaRow) => row.status,
              render: (row: SupplierRmaRow) => (
                <Badge tone={SRMA_TONES[row.status]}>{srmaStatusLabel(d, row.status)}</Badge>
              ),
            },
            {
              id: "total",
              header: activeLocaleHeader(d.srmaColTotal),
              accessor: (row: SupplierRmaRow) => row.totalNet,
              numeric: true,
              render: (row: SupplierRmaRow) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.totalNet} {row.currencyCode}
                </span>
              ),
            },
            {
              id: "requestedAt",
              header: activeLocaleHeader(d.srmaColRequested),
              accessor: (row: SupplierRmaRow) => row.requestedAt,
              sortable: true,
              render: (row: SupplierRmaRow) => (
                <span className="font-mono text-xs" dir="ltr">
                  {formatDateTime(row.requestedAt, locale)}
                </span>
              ),
            },
          ]}
          rows={[...srmas]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "view",
              label: d.srmaActionView,
              onSelect: (row: SupplierRmaRow) => {
                void openDetail(row);
              },
            },
            ...(canManage
              ? [
                  {
                    id: "approve",
                    label: d.srmaActionApprove,
                    onSelect: (row: SupplierRmaRow) => {
                      if (row.status !== "REQUESTED") {
                        return;
                      }
                      if (window.confirm(d.srmaConfirmApprove)) {
                        void srmaAction(row, "approve");
                      }
                    },
                  },
                  {
                    id: "ship",
                    label: d.srmaActionShip,
                    onSelect: (row: SupplierRmaRow) => {
                      if (row.status !== "APPROVED") {
                        return;
                      }
                      setError(null);
                      setShipWarehouseId("");
                      setShipTarget(row);
                    },
                  },
                  {
                    id: "credit",
                    label: d.srmaActionCredit,
                    onSelect: (row: SupplierRmaRow) => {
                      if (row.status !== "SHIPPED") {
                        return;
                      }
                      if (window.confirm(d.srmaConfirmCredit)) {
                        void srmaAction(row, "credit");
                      }
                    },
                  },
                  {
                    id: "cancel",
                    label: d.srmaActionCancel,
                    onSelect: (row: SupplierRmaRow) => {
                      if (row.status !== "REQUESTED" && row.status !== "APPROVED") {
                        return;
                      }
                      setError(null);
                      setCancelReason("");
                      setCancelTarget(row);
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.srmaEmpty }}
        />
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={d.srmaCreateTitle}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.sourcingFormBranch}
              value={createDraft.branchId}
              onValueChange={(value) => setCreateDraft({ ...createDraft, branchId: value })}
              options={[{ value: "", label: d.salesSelectBranch }, ...branchOptions]}
              required
            />
            <Select
              label={d.srmaFormPo}
              value={createDraft.purchaseOrderId}
              onValueChange={(value) => void pickPo(value)}
              options={[
                { value: "", label: d.srmaFormPickPo },
                ...returnableOrders.map((order) => ({
                  value: order.id,
                  label: poLabelById.get(order.id) ?? order.id,
                })),
              ]}
              required
            />
            <Select
              label={d.returnsFormReasonCode}
              value={createDraft.reasonCode}
              onValueChange={(value) =>
                setCreateDraft({ ...createDraft, reasonCode: value as SupplierRmaReasonCode })
              }
              options={SUPPLIER_REASONS.map((code) => ({
                value: code,
                label: reasonLabel(d, code),
              }))}
            />
            <Input
              label={`${d.returnsFormReason} (${d.sourcingFormOptional})`}
              value={createDraft.reason}
              onValueChange={(value) => setCreateDraft({ ...createDraft, reason: value })}
            />
            <Input
              label={`${d.returnsFormNote} (${d.sourcingFormOptional})`}
              value={createDraft.note}
              onValueChange={(value) => setCreateDraft({ ...createDraft, note: value })}
            />
          </div>
          {pickedPo !== null && (
            <div className="space-y-2">
              {pickedPo.lines.length === 0 ? (
                <p className="text-sm text-gray-600">{d.srmaLinesEmpty}</p>
              ) : (
                pickedPo.lines.map((line) => (
                  <div
                    key={line.id}
                    className="grid items-end gap-3 rounded-md border border-subtle px-3 py-2 sm:grid-cols-[2fr_1fr]"
                  >
                    <div className="text-sm">
                      <p className="font-medium text-gray-900">
                        {d.srmaColLine} {line.lineNo} — {itemNameById.get(line.itemId) ?? line.itemId}
                      </p>
                      <p className="font-mono text-xs text-gray-600" dir="ltr">
                        {d.srmaColQty}: {line.qty} · {d.srmaColUnitCost}: {line.unitPrice}
                      </p>
                    </div>
                    <Input
                      label={d.srmaFormPoLine}
                      value={createDraft.qtys[line.id] ?? ""}
                      onValueChange={(value) =>
                        setCreateDraft({
                          ...createDraft,
                          qtys: { ...createDraft.qtys, [line.id]: value },
                        })
                      }
                      inputMode="decimal"
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "srma-create"}
            onClick={() => void createSrma()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDetailOpen(false);
            setDetail(null);
          }
        }}
        title={`${d.srmaDetailTitle} — ${detail?.srmaNo ?? ""}`}
        size="lg"
      >
        {detail === null ? (
          <p className="text-sm text-gray-600">{d.loading}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span className="font-semibold text-gray-900">
                {supplierLabel(detail.supplierId)}
              </span>
              <span className="font-mono text-xs" dir="ltr">
                {d.srmaColPo}: {poLabel(detail.purchaseOrderId)}
              </span>
              <span>
                {d.returnsFormReasonCode}: {reasonLabel(d, detail.reasonCode)}
              </span>
              <span className="font-mono tabular-nums" dir="ltr">
                {d.srmaColTotal}: {detail.totalNet} {detail.currencyCode}
              </span>
              {detail.cancelReason !== null && (
                <span className="text-gray-600">
                  {d.returnsCancelReasonLabel}: {detail.cancelReason}
                </span>
              )}
            </div>
            <DataTable
              columns={[
                {
                  id: "lineNo",
                  header: activeLocaleHeader(d.srmaColLine),
                  accessor: (row: SupplierRmaWithLines["lines"][number]) => String(row.lineNo),
                  numeric: true,
                },
                {
                  id: "item",
                  header: activeLocaleHeader(d.srmaColItem),
                  accessor: (row: SupplierRmaWithLines["lines"][number]) =>
                    row.itemId !== null
                      ? (itemNameById.get(row.itemId) ?? row.itemId)
                      : "—",
                },
                {
                  id: "qty",
                  header: activeLocaleHeader(d.srmaColQty),
                  accessor: (row: SupplierRmaWithLines["lines"][number]) => row.qty,
                  numeric: true,
                  render: (row: SupplierRmaWithLines["lines"][number]) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {row.qty}
                    </span>
                  ),
                },
                {
                  id: "unitCost",
                  header: activeLocaleHeader(d.srmaColUnitCost),
                  accessor: (row: SupplierRmaWithLines["lines"][number]) => row.unitCost,
                  numeric: true,
                  render: (row: SupplierRmaWithLines["lines"][number]) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {row.unitCost}
                    </span>
                  ),
                },
                {
                  id: "net",
                  header: activeLocaleHeader(d.srmaColNet),
                  accessor: (row: SupplierRmaWithLines["lines"][number]) => row.netAmount,
                  numeric: true,
                  render: (row: SupplierRmaWithLines["lines"][number]) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {row.netAmount}
                    </span>
                  ),
                },
                {
                  id: "note",
                  header: activeLocaleHeader(d.returnsColNote),
                  accessor: (row: SupplierRmaWithLines["lines"][number]) => row.note ?? "—",
                },
              ]}
              rows={[...detail.lines]}
              rowKey={(row) => row.id}
              empty={{ title: d.srmaLinesEmpty }}
            />
          </div>
        )}
      </Dialog>

      <Dialog
        open={shipTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShipTarget(null);
          }
        }}
        title={d.srmaShipTitle}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <InfoNotice>{d.srmaConfirmShip}</InfoNotice>
          <Select
            label={d.srmaFormWarehouse}
            value={shipWarehouseId}
            onValueChange={setShipWarehouseId}
            options={[{ value: "", label: d.srmaFormWarehouse }, ...warehouseOptions]}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShipTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `ship-${shipTarget?.id ?? ""}`}
            onClick={() => void submitShip()}
          >
            {d.srmaActionShip}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
          }
        }}
        title={d.srmaActionCancel}
        size="sm"
      >
        <Input
          label={d.returnsCancelReasonLabel}
          value={cancelReason}
          onValueChange={setCancelReason}
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `cancel-${cancelTarget?.id ?? ""}`}
            onClick={() => void submitCancel()}
          >
            {d.srmaActionCancel}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
