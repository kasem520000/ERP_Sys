"use client";

/**
 * PHASE-018 T41 — the QC inspection log + entry (MASTER-PLAN §4):
 *
 * - the inspections table (inspected-at, target-type badge, order no / GRN
 *   id, FG batch id, result badge PASS/FAIL, sampled + sample size,
 *   disposition, note) with the target-type filter;
 * - the create dialog: target type (production_order → a COMPLETED order
 *   select; goods_receipt → a pasted GRN UUID — there is no GRN list API),
 *   result, sampled toggle + sample size, the disposition (FAIL requires
 *   one; PASS allows none/ACCEPT only; return-to-supplier is GRN-only),
 *   inspected-at and note;
 * - the create's side effects render localized: the quarantine release
 *   notice and, on FAIL+SCRAP, the qc_scrap journal line (qty + value).
 *
 * The FG-batch and GRN columns render ids only (the inspection row carries
 * no batch/GRN numbers; the qc_inspection_log report enriches them).
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
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CreateInspectionResult,
  InspectionRow,
  ItemRow,
  ProductionOrderRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedInspectionDisposition,
  localizedInspectionResult,
  localizedInspectionTargetType,
  localizedManufacturingError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function ManufacturingQc({
  locale,
  initialRows,
  orders,
  items,
  today,
}: {
  locale: Locale;
  initialRows: readonly InspectionRow[];
  orders: readonly ProductionOrderRow[];
  items: readonly ItemRow[];
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly InspectionRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // List filter (server-side refetch).
  const [targetFilter, setTargetFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [targetType, setTargetType] = useState<"production_order" | "goods_receipt">(
    "production_order",
  );
  const [orderId, setOrderId] = useState("");
  const [grnId, setGrnId] = useState("");
  const [result, setResult] = useState<"PASS" | "FAIL">("PASS");
  const [sampled, setSampled] = useState(false);
  const [sampleSize, setSampleSize] = useState("");
  const [disposition, setDisposition] = useState("");
  const [inspectedAt, setInspectedAt] = useState(today);
  const [note, setNote] = useState("");

  const orderLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of orders) {
      map.set(
        order.id,
        `${order.orderNo ?? shortId(order.id)} · ${itemSku(items, order.itemId)}`,
      );
    }
    return map;
  }, [orders, items]);

  // Client-side disposition restrictions (§4): PASS allows none/ACCEPT
  // only; FAIL requires a disposition; RETURN_TO_SUPPLIER is GRN-only.
  const dispositionOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [{ value: "", label: d.mfgQcDispNone }];
    if (result === "PASS") {
      options.push({ value: "ACCEPT", label: d.mfgQcDispAccept });
    } else {
      options.push(
        { value: "ACCEPT", label: d.mfgQcDispAccept },
        { value: "SCRAP", label: d.mfgQcDispScrap },
        { value: "REWORK", label: d.mfgQcDispRework },
      );
      if (targetType === "goods_receipt") {
        options.push({ value: "RETURN_TO_SUPPLIER", label: d.mfgQcDispReturn });
      }
    }
    return options;
  }, [d, result, targetType]);

  const grnValid = targetType !== "goods_receipt" || UUID_RE.test(grnId.trim());
  const sampleSizeValid = !sampled || (/^\d+$/.test(sampleSize) && Number(sampleSize) >= 1);
  const dispositionValid =
    result === "PASS"
      ? disposition === "" || disposition === "ACCEPT"
      : disposition !== "";
  const createReady =
    (targetType === "production_order" ? orderId !== "" : grnValid) &&
    sampleSizeValid &&
    dispositionValid;

  // -- list ------------------------------------------------------------------------------

  async function loadList(targetTypeFilter: string): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly InspectionRow[]>(
      `manufacturing/inspections?limit=200${
        targetTypeFilter === "" ? "" : `&targetType=${targetTypeFilter}`
      }`,
    );
    setListLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  function onTargetFilterChange(value: string): void {
    setTargetFilter(value);
    void loadList(value);
  }

  // -- create ------------------------------------------------------------------------------

  async function createInspection(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const created = await bffFetch<CreateInspectionResult>("manufacturing/inspections", {
      method: "POST",
      body: {
        targetType,
        orderId: targetType === "production_order" ? orderId : null,
        grnId: targetType === "goods_receipt" ? grnId.trim() : null,
        result,
        sampled,
        sampleSize: sampled ? Number(sampleSize) : null,
        disposition: disposition === "" ? null : disposition,
        inspectedAt: inspectedAt === "" ? null : inspectedAt,
        note: note.trim() === "" ? null : note.trim(),
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedManufacturingError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [created.data.inspection, ...current]);
    setCreateOpen(false);
    setOrderId("");
    setGrnId("");
    setResult("PASS");
    setSampled(false);
    setSampleSize("");
    setDisposition("");
    setNote("");
    // The side-effect notices: the quarantine release, and on FAIL+SCRAP
    // the qc_scrap journal line (§1 row 4).
    const parts = [
      formatMessage(d.mfgQcCreatedToast, {
        result: localizedInspectionResult(d, created.data.inspection.result),
      }),
    ];
    if (created.data.released) {
      parts.push(d.mfgQcReleasedToast);
    }
    if (created.data.scrapJournalEntryId !== null) {
      parts.push(
        formatMessage(d.mfgQcScrapToast, {
          qty: created.data.scrapQty ?? "—",
          value: created.data.scrapValue ?? "—",
          journal: shortId(created.data.scrapJournalEntryId),
        }),
      );
    }
    setNotice(parts.join(" "));
  }

  // -- render ------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.mfgQcTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.mfgQcNew}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.mfgQcColTarget}
            value={targetFilter}
            onValueChange={onTargetFilterChange}
            options={[
              { value: "", label: d.mfgQcAllTargets },
              { value: "production_order", label: d.mfgQcTargetProductionOrder },
              { value: "goods_receipt", label: d.mfgQcTargetGoodsReceipt },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "inspectedAt",
                header: activeLocaleHeader(d.mfgQcColInspectedAt),
                accessor: (row) => row.inspectedAt,
                mono: true,
                sortable: true,
                render: (row) => formatDateTime(row.inspectedAt, locale),
              },
              {
                id: "targetType",
                header: activeLocaleHeader(d.mfgQcTargetType),
                accessor: (row) => row.targetType,
                render: (row) => (
                  <Badge tone={row.targetType === "production_order" ? "primary" : undefined}>
                    {localizedInspectionTargetType(d, row.targetType)}
                  </Badge>
                ),
              },
              {
                id: "target",
                header: activeLocaleHeader(d.mfgQcColTarget),
                accessor: (row) =>
                  row.targetType === "production_order"
                    ? (orderLabelById.get(row.orderId ?? "") ?? (row.orderId ?? ""))
                    : (row.grnId ?? ""),
                render: (row) =>
                  row.targetType === "production_order" ? (
                    row.orderId === null ? (
                      <span className="text-gray-500">—</span>
                    ) : (
                      (orderLabelById.get(row.orderId) ?? (
                        <span className="font-mono text-sm" dir="ltr">
                          {shortId(row.orderId)}
                        </span>
                      ))
                    )
                  ) : row.grnId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr" aria-label={d.mfgQcColGrn}>
                      {shortId(row.grnId)}
                    </span>
                  ),
              },
              {
                id: "fgBatch",
                header: activeLocaleHeader(d.mfgQcColBatch),
                accessor: (row) => row.fgBatchId ?? "",
                mono: true,
                render: (row) =>
                  row.fgBatchId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {shortId(row.fgBatchId)}
                    </span>
                  ),
              },
              {
                id: "result",
                header: activeLocaleHeader(d.mfgQcResult),
                accessor: (row) => row.result,
                render: (row) => (
                  <span
                    className={
                      row.result === "FAIL"
                        ? "inline-flex w-fit items-center rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-xs leading-4 text-danger-text"
                        : "inline-flex w-fit items-center rounded-sm border border-success-border bg-success-bg px-1.5 py-0.5 text-xs leading-4 text-success-text"
                    }
                  >
                    {localizedInspectionResult(d, row.result)}
                  </span>
                ),
              },
              {
                id: "sampled",
                header: activeLocaleHeader(d.mfgQcColSampled),
                accessor: (row) => (row.sampled ? String(row.sampleSize ?? "") : ""),
                render: (row) =>
                  row.sampled ? (
                    <span className="flex items-center gap-1">
                      <Badge>{d.mfgQcSampled}</Badge>
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.sampleSize ?? "—"}
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-500">—</span>
                  ),
              },
              {
                id: "disposition",
                header: activeLocaleHeader(d.mfgQcDisposition),
                accessor: (row) => row.disposition ?? "",
                render: (row) => localizedInspectionDisposition(d, row.disposition),
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
            empty={{ title: d.mfgQcEmpty }}
          />
        </div>
      </Card>

      {/* -- create dialog --------------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.mfgQcCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.mfgQcTargetType}
            value={targetType}
            onValueChange={(value) => {
              setTargetType(value === "goods_receipt" ? "goods_receipt" : "production_order");
              setDisposition("");
            }}
            options={[
              { value: "production_order", label: d.mfgQcTargetProductionOrder },
              { value: "goods_receipt", label: d.mfgQcTargetGoodsReceipt },
            ]}
            required
          />
          {targetType === "production_order" ? (
            <Select
              label={d.mfgQcOrder}
              value={orderId}
              onValueChange={setOrderId}
              placeholder="—"
              options={orders.map((order) => ({
                value: order.id,
                label:
                  orderLabelById.get(order.id) ??
                  `${order.orderNo ?? shortId(order.id)} · ${order.itemId}`,
              }))}
              required
            />
          ) : (
            <Input
              label={d.mfgQcGrnId}
              value={grnId}
              onValueChange={setGrnId}
              hint={d.mfgQcGrnHint}
              mono
              bidiIsolate
              required
              error={grnId !== "" && !UUID_RE.test(grnId.trim()) ? d.errorsValidation : undefined}
            />
          )}
          <Select
            label={d.mfgQcResult}
            value={result}
            onValueChange={(value) => {
              setResult(value === "FAIL" ? "FAIL" : "PASS");
              setDisposition("");
            }}
            options={[
              { value: "PASS", label: d.mfgQcResultPass },
              { value: "FAIL", label: d.mfgQcResultFail },
            ]}
            required
          />
          <div className="flex items-end">
            <Checkbox
              label={d.mfgQcSampled}
              checked={sampled}
              onCheckedChange={(checked) => {
                const next = checked === true;
                setSampled(next);
                if (!next) setSampleSize("");
              }}
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgQcSampleSize}
              value={sampleSize}
              onValueChange={setSampleSize}
              mono
              disabled={!sampled}
              required={sampled}
              error={!sampleSizeValid ? d.errorsValidation : undefined}
            />
          </div>
          <Select
            label={d.mfgQcDisposition}
            value={disposition}
            onValueChange={setDisposition}
            options={dispositionOptions}
            hint={d.mfgQcDispositionHint}
            required={result === "FAIL"}
          />
          <DatePicker
            locale={locale}
            label={d.mfgQcColInspectedAt}
            value={inspectedAt}
            onSelect={setInspectedAt}
            required
          />
          <Input label={d.mfgBomNote} value={note} onValueChange={setNote} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createInspection()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** The FG item's SKU out of the supporting pool (orders carry itemId only). */
function itemSku(items: readonly ItemRow[], itemId: string): string {
  return items.find((item) => item.id === itemId)?.sku ?? shortId(itemId);
}
