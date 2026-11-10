"use client";

/**
 * PHASE-018 T41 — the recall search (MASTER-PLAN §10): a READ-ONLY batch
 * genealogy surface. The user picks an item then a batch (or pastes a
 * batch UUID) and runs one of the three walks:
 *
 * - upstream — the batch's producing order's batch-bound consumptions,
 *   recursing into material batches that were themselves produced
 *   (level = hops; producedBy null = purchased);
 * - downstream — the orders that consumed the batch and their FG batches
 *   (recursing), PLUS the customer-facing sale edges off the move ledger
 *   (DOC IDS ONLY — the batch-genealogy report enriches the numbers);
 * - summary — the batch card: producing order, on-hand, consumed-by
 *   orders, sales and inspections counts.
 *
 * Unknown or foreign batch ids render the typed
 * GENEALOGY_BATCH_NOT_FOUND message — never a crash. Nothing here ever
 * posts: the screen only ever GETs.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BatchRow,
  GenealogyBatchRef,
  GenealogyBatchSummary,
  GenealogyDownstreamResult,
  GenealogyUpstreamResult,
  ItemRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedBatchStatus,
  localizedManufacturingError,
  localizedProductionOrderStatus,
  localizedSaleDocType,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function qtyCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value}
    </span>
  );
}

type Walk = "upstream" | "downstream" | "batch";

export function ManufacturingGenealogy({
  locale,
  items,
  initialBatches,
}: {
  locale: Locale;
  items: readonly ItemRow[];
  initialBatches: readonly BatchRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Walk | null>(null);

  // Search state.
  const [itemId, setItemId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [pastedBatchId, setPastedBatchId] = useState("");
  const [batches, setBatches] = useState<readonly BatchRow[]>(initialBatches);
  const [batchesLoading, setBatchesLoading] = useState(false);

  // Results (the last walk rendered).
  const [upstream, setUpstream] = useState<GenealogyUpstreamResult | null>(null);
  const [downstream, setDownstream] = useState<GenealogyDownstreamResult | null>(null);
  const [summary, setSummary] = useState<GenealogyBatchSummary | null>(null);

  const trackedItems = useMemo(
    () => items.filter((item) => item.trackBatch),
    [items],
  );
  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  /** The effective batch id: the select wins, else the pasted UUID. */
  const activeBatchId = batchId !== "" ? batchId : pastedBatchId.trim();
  const canSearch = activeBatchId !== "" && UUID_RE.test(activeBatchId);

  async function onItemChange(value: string): Promise<void> {
    setItemId(value);
    setBatchId("");
    setUpstream(null);
    setDownstream(null);
    setSummary(null);
    if (value === "") {
      setBatches(initialBatches);
      return;
    }
    setBatchesLoading(true);
    const result = await bffFetch<readonly BatchRow[]>(`inventory/batches?itemId=${value}&limit=200`);
    setBatchesLoading(false);
    if (!result.ok) {
      // Degrade: the paste path still works.
      setBatches([]);
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setBatches(result.data);
  }

  function clearResults(): void {
    setUpstream(null);
    setDownstream(null);
    setSummary(null);
  }

  async function runWalk(walk: Walk): Promise<void> {
    if (!canSearch) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(walk);
    setError(null);
    const result = await bffFetch<
      GenealogyUpstreamResult | GenealogyDownstreamResult | GenealogyBatchSummary
    >(`manufacturing/genealogy/${walk}/${activeBatchId}`);
    setBusy(null);
    if (!result.ok) {
      clearResults();
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setUpstream(walk === "upstream" ? (result.data as GenealogyUpstreamResult) : null);
    setDownstream(walk === "downstream" ? (result.data as GenealogyDownstreamResult) : null);
    setSummary(walk === "batch" ? (result.data as GenealogyBatchSummary) : null);
  }

  const batchCard: GenealogyBatchRef | null =
    upstream?.batch ?? downstream?.batch ?? summary?.batch ?? null;

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card title={d.mfgGenealogyTitle} description={d.mfgGenealogyBatchHint}>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.mfgGenealogyItem}
            value={itemId}
            onValueChange={(value) => void onItemChange(value)}
            placeholder="—"
            options={trackedItems.map((item) => ({
              value: item.id,
              label: itemLabelById.get(item.id) ?? item.sku,
            }))}
          />
          <Select
            aria-label={d.mfgConsumptionBatch}
            value={batchId}
            onValueChange={(value) => {
              setBatchId(value);
              clearResults();
            }}
            placeholder="—"
            disabled={batchesLoading}
            options={[
              { value: "", label: d.mfgConsumptionBatch },
              ...batches.map((batch) => ({
                value: batch.id,
                label: `${batch.batchNo}${
                  batch.expiryDate !== null ? ` · ${batch.expiryDate}` : ""
                } · ${batch.status}`,
              })),
            ]}
          />
          <div className="w-80">
            <Input
              label={d.mfgGenealogyBatchId}
              value={pastedBatchId}
              onValueChange={(value) => {
                setPastedBatchId(value);
                clearResults();
              }}
              mono
              bidiIsolate
              error={
                pastedBatchId.trim() !== "" && !UUID_RE.test(pastedBatchId.trim())
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Button
            variant="primary"
            loading={busy === "upstream"}
            disabled={!canSearch}
            onClick={() => void runWalk("upstream")}
          >
            {d.mfgGenealogyUpstream}
          </Button>
          <Button
            variant="primary"
            loading={busy === "downstream"}
            disabled={!canSearch}
            onClick={() => void runWalk("downstream")}
          >
            {d.mfgGenealogyDownstream}
          </Button>
          <Button
            variant="secondary"
            loading={busy === "batch"}
            disabled={!canSearch}
            onClick={() => void runWalk("batch")}
          >
            {d.mfgGenealogySummary}
          </Button>
        </div>
      </Card>

      {/* -- the batch card (every walk result starts from it) ------------------------- */}
      {batchCard !== null && (
        <Card title={d.mfgGenealogyBatchCard}>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={batchCard.status === "ACTIVE" ? "primary" : undefined}>
              {localizedBatchStatus(d, batchCard.status)}
            </Badge>
            <span className="font-mono text-sm" dir="ltr">
              {batchCard.batchNo}
            </span>
            <span className="text-sm text-gray-600">{batchCard.sku}</span>
            {batchCard.expiryDate !== null && (
              <span className="text-sm text-gray-600">
                {d.mfgOrderExpiry}:{" "}
                <span className="font-mono text-sm" dir="ltr">
                  {batchCard.expiryDate}
                </span>
              </span>
            )}
          </div>
        </Card>
      )}

      {/* -- upstream result -------------------------------------------------------------- */}
      {upstream !== null && (
        <Card title={d.mfgGenealogyMaterials}>
          {upstream.materials.length === 0 ? (
            <p className="text-sm text-gray-500">—</p>
          ) : (
            <table className="w-full text-sm" aria-label={d.mfgGenealogyMaterials}>
              <thead>
                <tr className="border-b border-subtle text-xs text-gray-600">
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgColLevel}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgConsumptionBatch}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.itemsColSku}</th>
                  <th scope="col" className="px-2 py-1 text-end">{d.stockColQty}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgGenealogyColConsumedBy}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgGenealogyColProducedBy}</th>
                </tr>
              </thead>
              <tbody>
                {upstream.materials.map((edge) => (
                  <tr key={`${edge.level}-${edge.batchId}-${edge.consumedByOrderId}`} className="border-b border-subtle">
                    <td className="px-2 py-1.5 font-mono" dir="ltr">
                      {edge.level}
                    </td>
                    <td className="px-2 py-1.5 font-mono" dir="ltr">
                      {edge.batchNo}
                    </td>
                    <td className="px-2 py-1.5">{edge.sku}</td>
                    <td className="px-2 py-1.5 text-end">{qtyCell(edge.qty)}</td>
                    <td className="px-2 py-1.5 font-mono text-sm" dir="ltr">
                      {edge.consumedByOrderNo ?? shortId(edge.consumedByOrderId)}
                    </td>
                    <td className="px-2 py-1.5">
                      {edge.producedByOrderNo === null ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        <span className="font-mono text-sm" dir="ltr">
                          {edge.producedByOrderNo}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* -- downstream result --------------------------------------------------------------- */}
      {downstream !== null && (
        <>
          <Card title={d.mfgGenealogyProductions}>
            {downstream.productions.length === 0 ? (
              <p className="text-sm text-gray-500">—</p>
            ) : (
              <table className="w-full text-sm" aria-label={d.mfgGenealogyProductions}>
                <thead>
                  <tr className="border-b border-subtle text-xs text-gray-600">
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgColLevel}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgGenealogyColFromBatch}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgGenealogyColOrder}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.accountingColStatus}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgQcColBatch}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.itemsColSku}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.stockColQty}</th>
                  </tr>
                </thead>
                <tbody>
                  {downstream.productions.map((edge) => (
                    <tr key={`${edge.level}-${edge.orderId}-${edge.fromBatchId}`} className="border-b border-subtle">
                      <td className="px-2 py-1.5 font-mono" dir="ltr">
                        {edge.level}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-sm" dir="ltr">
                        {edge.fromBatchNo ?? shortId(edge.fromBatchId)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-sm" dir="ltr">
                        {edge.orderNo ?? shortId(edge.orderId)}
                      </td>
                      <td className="px-2 py-1.5">
                        {localizedProductionOrderStatus(d, edge.orderStatus)}
                      </td>
                      <td className="px-2 py-1.5">
                        {edge.fgBatchNo === null ? (
                          <span className="text-gray-500">—</span>
                        ) : (
                          <span className="font-mono text-sm" dir="ltr">
                            {edge.fgBatchNo}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{edge.fgSku ?? "—"}</td>
                      <td className="px-2 py-1.5 text-end">{qtyCell(edge.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title={d.mfgGenealogySales} description={d.mfgGenealogyIdsHint}>
            {downstream.sales.length === 0 ? (
              <p className="text-sm text-gray-500">—</p>
            ) : (
              <table className="w-full text-sm" aria-label={d.mfgGenealogySales}>
                <thead>
                  <tr className="border-b border-subtle text-xs text-gray-600">
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgColLevel}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgConsumptionBatch}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgGenealogyColDocType}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgGenealogyColDocId}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgGenealogyColDocDate}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.stockColQty}</th>
                  </tr>
                </thead>
                <tbody>
                  {downstream.sales.map((edge) => (
                    <tr key={`${edge.level}-${edge.docId}-${edge.batchId}`} className="border-b border-subtle">
                      <td className="px-2 py-1.5 font-mono" dir="ltr">
                        {edge.level}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-sm" dir="ltr">
                        {batches.find((batch) => batch.id === edge.batchId)?.batchNo ?? shortId(edge.batchId)}
                      </td>
                      <td className="px-2 py-1.5">{localizedSaleDocType(d, edge.docType)}</td>
                      <td className="px-2 py-1.5 font-mono text-sm" dir="ltr">
                        {shortId(edge.docId)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-sm" dir="ltr">
                        {edge.docDate}
                      </td>
                      <td className="px-2 py-1.5 text-end">{qtyCell(edge.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* -- summary result ---------------------------------------------------------------------- */}
      {summary !== null && (
        <Card title={d.mfgGenealogySummary}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [d.mfgGenealogyProducingOrder, summary.producingOrderNo ?? (summary.producingOrderId !== null ? shortId(summary.producingOrderId) : "—")],
              [d.mfgGenealogyOnHand, summary.onHand],
              [d.mfgGenealogySalesCount, String(summary.salesCount)],
              [d.mfgGenealogyInspectionsCount, String(summary.inspectionsCount)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-md border border-subtle bg-surface-sunken px-3 py-2"
              >
                <dt className="text-xs text-gray-600">{label}</dt>
                <dd className="mt-0.5 font-mono tabular-nums" dir="ltr">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-gray-900">{d.mfgGenealogyConsumedBy}</h3>
            {summary.consumedByOrders.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">—</p>
            ) : (
              <table className="mt-2 w-full text-sm" aria-label={d.mfgGenealogyConsumedBy}>
                <thead>
                  <tr className="border-b border-subtle text-xs text-gray-600">
                    <th scope="col" className="px-2 py-1 text-start">{d.mfgGenealogyColOrder}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.stockColQty}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.consumedByOrders.map((order) => (
                    <tr key={order.orderId} className="border-b border-subtle">
                      <td className="px-2 py-1.5 font-mono text-sm" dir="ltr">
                        {order.orderNo ?? shortId(order.orderId)}
                      </td>
                      <td className="px-2 py-1.5 text-end">{qtyCell(order.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
