"use client";

/**
 * PHASE-042 T-11 (M-17) — the touch-first shop-floor terminal:
 *
 * - SCAN FIRST: a big autofocus input with the OP:<orderId>:<seq>:<action>
 *   barcode format — parsed client-side (the exact server regex), posted
 *   to the idempotent /shopfloor/scan endpoint, with the elapsed-time
 *   capture for complete riding the server default;
 * - the live order view: pick a RELEASED/IN_PROGRESS order → its frozen
 *   operations with status chips, std/actual times and the per-op
 *   transitions (start → pause → resume → complete; skip needs a reason +
 *   a distinct ACTIVE approver — the SoD dialog);
 * - the downtime quick-log: work center, one of the nine reason codes,
 *   minutes and an optional order link — started_at rides now − minutes so
 *   the logged window is honest and closed.
 *
 * Touch-first = min-h-12 targets everywhere, no hover-only affordances;
 * every table stays RTL-safe (logical utilities + LTR-mono numbers).
 */
import { useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ItemRow,
  OrderOperationsResult,
  ProductionOrderRow,
  ScanResult,
  TenantUserRow,
  WorkCenterRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedDowntimeReason,
  localizedManufacturingError,
  localizedOperationStatus,
  localizedProductionOrderStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";

/** The exact server scan shape (SCAN_RE in operation-execution-service). */
const SCAN_RE = /^OP:([0-9a-fA-F-]{36}):(\d{1,3}):(start|pause|resume|complete)$/;
const TIME_RE = /^\d+(\.\d{1,6})?$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;

const DOWNTIME_REASONS: readonly string[] = [
  "PLAN_SETUP",
  "BREAKDOWN",
  "MAINTENANCE",
  "MATERIAL_SHORTAGE",
  "QUALITY_HOLD",
  "POWER_OUTAGE",
  "CHANGEOVER",
  "OPERATOR_ABSENT",
  "OTHER",
];

const LIVE_STATUSES: readonly string[] = ["RELEASED", "IN_PROGRESS"];
const OPEN_OP_STATUSES: readonly string[] = ["PENDING", "SETUP", "RUNNING", "PAUSED"];

/** A canonical decimal cell (the exact server string, LTR). */
function decCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value}
    </span>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function ManufacturingShopfloorTerminal({
  locale,
  initialOrders,
  items,
  workCenters,
  users,
}: {
  locale: Locale;
  initialOrders: readonly ProductionOrderRow[];
  items: readonly ItemRow[];
  workCenters: readonly WorkCenterRow[];
  users: readonly TenantUserRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Scan state.
  const [scanCode, setScanCode] = useState("");
  const scanRef = useRef<HTMLInputElement | null>(null);

  // Live order view state.
  const [orders, setOrders] = useState<readonly ProductionOrderRow[]>(initialOrders);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [ops, setOps] = useState<OrderOperationsResult | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);

  // Complete dialog state.
  const [completeSeq, setCompleteSeq] = useState<number | null>(null);
  const [actualSetup, setActualSetup] = useState("");
  const [actualRun, setActualRun] = useState("");
  const [scrapQty, setScrapQty] = useState("");
  const [scrapReason, setScrapReason] = useState("");

  // Skip dialog state (the SoD approver floor).
  const [skipSeq, setSkipSeq] = useState<number | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [skipApprover, setSkipApprover] = useState("");

  // Downtime quick-log state.
  const [dtWorkCenterId, setDtWorkCenterId] = useState("");
  const [dtReason, setDtReason] = useState("");
  const [dtMinutes, setDtMinutes] = useState("");
  const [dtOrderId, setDtOrderId] = useState("");
  const [dtNote, setDtNote] = useState("");

  const liveOrders = useMemo(
    () => orders.filter((order) => LIVE_STATUSES.includes(order.status)),
    [orders],
  );
  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);
  const workCenterLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const wc of workCenters) {
      map.set(wc.id, `${wc.code} · ${localizedName(wc.name, wc.nameAr, locale)}`);
    }
    return map;
  }, [workCenters, locale]);
  const orderLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of orders) {
      map.set(
        order.id,
        `${order.orderNo ?? shortId(order.id)} · ${itemLabelById.get(order.itemId) ?? order.itemId}`,
      );
    }
    return map;
  }, [orders, itemLabelById]);

  const selectedOrder = ops?.order ?? null;
  const completeReady =
    completeSeq !== null &&
    TIME_RE.test(actualSetup) &&
    TIME_RE.test(actualRun) &&
    (scrapQty === "" || QTY_RE.test(scrapQty)) &&
    (scrapQty === "" || scrapReason.trim() !== "");
  const skipReady =
    skipSeq !== null && skipReason.trim() !== "" && skipApprover !== "";
  const dtReady =
    dtWorkCenterId !== "" &&
    dtReason !== "" &&
    /^\d{1,4}$/.test(dtMinutes) &&
    Number(dtMinutes) >= 0 &&
    Number(dtMinutes) <= 1440;

  // -- the live order view -----------------------------------------------------------------

  async function loadOperations(orderId: string): Promise<void> {
    setOpsLoading(true);
    setError(null);
    const result = await bffFetch<OrderOperationsResult>(
      `manufacturing/production-orders/${orderId}/operations`,
    );
    setOpsLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setOps(result.data);
    setOrders((current) =>
      current.map((row) => (row.id === result.data.order.id ? result.data.order : row)),
    );
  }

  function onSelectOrder(orderId: string): void {
    setSelectedOrderId(orderId);
    setOps(null);
    if (orderId !== "") {
      void loadOperations(orderId);
    }
  }

  // -- the scan (M-17) ----------------------------------------------------------------------

  async function submitScan(): Promise<void> {
    const code = scanCode.trim();
    if (code === "") return;
    const match = SCAN_RE.exec(code);
    if (match === null) {
      setError(d.mfgSfScanInvalid);
      return;
    }
    setBusy("scan");
    setError(null);
    const result = await bffFetch<ScanResult>("manufacturing/shopfloor/scan", {
      method: "POST",
      body: { code },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setScanCode("");
    setNotice(
      formatMessage(d.mfgSfScanDoneToast, {
        action: result.data.action,
        seq: result.data.operation.sequence,
      }),
    );
    // Jump the terminal to the scanned order's live view.
    const orderId = result.data.operation.orderId;
    if (selectedOrderId !== orderId) {
      setSelectedOrderId(orderId);
    }
    await loadOperations(orderId);
    scanRef.current?.focus();
  }

  // -- the operation transitions -----------------------------------------------------------

  async function opAction(seq: number, action: "start" | "pause" | "resume"): Promise<void> {
    if (selectedOrderId === "") return;
    setBusy(`${action}:${seq}`);
    setError(null);
    const result = await bffFetch<{ operation: unknown }>(
      `manufacturing/production-orders/${selectedOrderId}/operations/${seq}/${action}`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(formatMessage(d.mfgSfScanDoneToast, { action, seq }));
    await loadOperations(selectedOrderId);
  }

  async function completeOp(): Promise<void> {
    if (selectedOrderId === null || completeSeq === null || !completeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(`complete:${completeSeq}`);
    setError(null);
    const result = await bffFetch<{ operation: unknown }>(
      `manufacturing/production-orders/${selectedOrderId}/operations/${completeSeq}/complete`,
      {
        method: "POST",
        body: {
          actualSetupTime: actualSetup,
          actualRunTime: actualRun,
          scrapQty: scrapQty === "" ? null : scrapQty,
          scrapReasonCode: scrapQty === "" ? null : scrapReason.trim(),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCompleteSeq(null);
    setActualSetup("");
    setActualRun("");
    setScrapQty("");
    setScrapReason("");
    setNotice(formatMessage(d.mfgSfScanDoneToast, { action: "complete", seq: completeSeq }));
    await loadOperations(selectedOrderId);
  }

  async function skipOp(): Promise<void> {
    if (selectedOrderId === "" || skipSeq === null || !skipReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(`skip:${skipSeq}`);
    setError(null);
    const result = await bffFetch<{ operation: unknown }>(
      `manufacturing/production-orders/${selectedOrderId}/operations/${skipSeq}/skip`,
      {
        method: "POST",
        body: {
          reason: skipReason.trim(),
          approvedBy: skipApprover,
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setSkipSeq(null);
    setSkipReason("");
    setSkipApprover("");
    setNotice(formatMessage(d.mfgSfScanDoneToast, { action: "skip", seq: skipSeq }));
    await loadOperations(selectedOrderId);
  }

  // -- the downtime quick-log ----------------------------------------------------------------

  async function logDowntime(): Promise<void> {
    if (!dtReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("downtime");
    setError(null);
    const minutes = Number(dtMinutes);
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - minutes * 60000);
    // The (order, sequence) pair or neither (the 0065 link-shape CHECK):
    // the link rides the order's current operation when it has one.
    const linkedOrder = orders.find((order) => order.id === dtOrderId);
    const linkPair =
      linkedOrder !== undefined && linkedOrder.currentOperation !== null
        ? { orderId: linkedOrder.id, operationSequence: linkedOrder.currentOperation }
        : { orderId: null, operationSequence: null };
    const result = await bffFetch<unknown>("manufacturing/downtime", {
      method: "POST",
      body: {
        workCenterId: dtWorkCenterId,
        reasonCode: dtReason,
        startedAt: startedAt.toISOString(),
        durationMinutes: minutes,
        endedAt: endedAt.toISOString(),
        orderId: linkPair.orderId,
        operationSequence: linkPair.operationSequence,
        note: dtNote.trim() === "" ? null : dtNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDtReason("");
    setDtMinutes("");
    setDtNote("");
    setNotice(d.mfgDtLoggedToast);
  }

  // -- render --------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {/* -- the scan-first card (M-17) -------------------------------------------------- */}
      <Card title={d.mfgSfScan}>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void submitScan();
          }}
        >
          <div className="flex-1">
            <label htmlFor="shopfloor-scan" className="text-sm font-medium text-gray-700">
              {d.mfgSfScan}
            </label>
            <input
              id="shopfloor-scan"
              ref={scanRef}
              // Scan-first: the cursor starts here and returns after every scan.
              autoFocus
              dir="ltr"
              autoComplete="off"
              className="mt-1 min-h-12 w-full rounded-md border border-default bg-surface-card px-3 text-base font-mono text-gray-900 outline-none focus:border-strong"
              placeholder={d.mfgSfScanPlaceholder}
              value={scanCode}
              onChange={(event) => setScanCode(event.target.value)}
              aria-describedby="shopfloor-scan-hint"
            />
            <p id="shopfloor-scan-hint" className="mt-1 text-xs text-gray-500">
              {d.mfgSfScanHint}
            </p>
          </div>
          <Button
            variant="primary"
            type="submit"
            className="min-h-12 px-6 text-base"
            loading={busy === "scan"}
            disabled={scanCode.trim() === ""}
          >
            {d.mfgSfScan}
          </Button>
        </form>
      </Card>

      {/* -- the live order view ----------------------------------------------------------- */}
      <Card title={d.mfgSfOperations}>
        <div className="flex flex-col gap-4">
          <Select
            label={d.mfgSfOrder}
            value={selectedOrderId}
            onValueChange={onSelectOrder}
            placeholder="—"
            className="text-base"
            options={liveOrders.map((order) => ({
              value: order.id,
              label: orderLabelById.get(order.id) ?? order.id,
            }))}
          />

          {selectedOrderId === "" ? (
            <p className="text-sm text-gray-500">{d.mfgOpsEmpty}</p>
          ) : opsLoading && ops === null ? (
            <p className="text-sm text-gray-500">…</p>
          ) : selectedOrder !== null ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={selectedOrder.status === "IN_PROGRESS" ? "primary" : undefined}>
                  {localizedProductionOrderStatus(d, selectedOrder.status)}
                </Badge>
                <span className="font-mono text-sm" dir="ltr">
                  {selectedOrder.orderNo ?? shortId(selectedOrder.id)}
                </span>
                <span className="text-sm text-gray-600">
                  {itemLabelById.get(selectedOrder.itemId) ?? selectedOrder.itemId}
                </span>
                <span className="text-sm text-gray-600">
                  {d.mfgOpsCurrentOperation}:{" "}
                  <span className="font-mono" dir="ltr">
                    {selectedOrder.currentOperation ?? "—"}
                  </span>
                </span>
              </div>

              <ul className="flex flex-col gap-2" aria-label={d.mfgSfOperations}>
                {ops?.operations.map((op) => {
                  const open = OPEN_OP_STATUSES.includes(op.status);
                  return (
                    <li
                      key={op.id}
                      className="flex flex-col gap-2 rounded-md border border-subtle bg-surface-sunken p-3 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base" dir="ltr">
                          #{op.sequence}
                        </span>
                        <Badge tone={op.status === "RUNNING" ? "primary" : undefined}>
                          {localizedOperationStatus(d, op.status)}
                        </Badge>
                        <span className="text-sm text-gray-700">
                          {workCenterLabelById.get(op.workCenterId) ?? op.workCenterId}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span>
                          {d.mfgOpsStdSetup}: {decCell(op.stdSetupTime)}
                        </span>
                        <span>
                          {d.mfgOpsStdRun}: {decCell(op.stdRunTime)}
                        </span>
                        {op.startedAt !== null && (
                          <span>
                            {d.mfgOpsStartedAt}:{" "}
                            <span className="font-mono" dir="ltr">
                              {op.startedAt.slice(0, 16).replace("T", " ")}
                            </span>
                          </span>
                        )}
                        {op.scrapQty !== "0.000000" && op.scrapQty !== "0" && (
                          <span>
                            {d.mfgSfScrapQty}: {decCell(op.scrapQty)}
                          </span>
                        )}
                      </div>
                      {open && (
                        <div className="flex flex-wrap gap-2">
                          {op.status === "PENDING" && (
                            <Button
                              variant="primary"
                              className="min-h-12 px-5"
                              loading={busy === `start:${op.sequence}`}
                              onClick={() => void opAction(op.sequence, "start")}
                            >
                              {d.mfgSfStart}
                            </Button>
                          )}
                          {(op.status === "SETUP" || op.status === "RUNNING") && (
                            <Button
                              variant="secondary"
                              className="min-h-12 px-5"
                              loading={busy === `pause:${op.sequence}`}
                              onClick={() => void opAction(op.sequence, "pause")}
                            >
                              {d.mfgSfPause}
                            </Button>
                          )}
                          {op.status === "PAUSED" && (
                            <Button
                              variant="primary"
                              className="min-h-12 px-5"
                              loading={busy === `resume:${op.sequence}`}
                              onClick={() => void opAction(op.sequence, "resume")}
                            >
                              {d.mfgSfResume}
                            </Button>
                          )}
                          <Button
                            variant="primary"
                            className="min-h-12 px-5"
                            onClick={() => {
                              setCompleteSeq(op.sequence);
                              setActualSetup("0");
                              setActualRun("");
                              setScrapQty("");
                              setScrapReason("");
                            }}
                          >
                            {d.mfgSfComplete}
                          </Button>
                          <Button
                            variant="danger"
                            className="min-h-12 px-5"
                            onClick={() => {
                              setSkipSeq(op.sequence);
                              setSkipReason("");
                              setSkipApprover("");
                            }}
                          >
                            {d.mfgSfSkip}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{d.mfgOpsEmpty}</p>
          )}
        </div>
      </Card>

      {/* -- the downtime quick-log --------------------------------------------------------- */}
      <Card title={d.mfgSfDowntimeTitle} description={d.mfgDtPolicyNote}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label={d.mfgDtWorkCenter}
            value={dtWorkCenterId}
            onValueChange={setDtWorkCenterId}
            placeholder="—"
            options={workCenters.map((wc) => ({
              value: wc.id,
              label: workCenterLabelById.get(wc.id) ?? wc.code,
            }))}
            required
          />
          <Select
            label={d.mfgDtReason}
            value={dtReason}
            onValueChange={setDtReason}
            placeholder="—"
            options={DOWNTIME_REASONS.map((reason) => ({
              value: reason,
              label: localizedDowntimeReason(d, reason),
            }))}
            required
          />
          <div className="w-36">
            <Input
              label={d.mfgDtDuration}
              value={dtMinutes}
              onValueChange={setDtMinutes}
              mono
              required
              inputMode="numeric"
              error={
                dtMinutes !== "" &&
                (!/^\d{1,4}$/.test(dtMinutes) || Number(dtMinutes) > 1440)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Select
            label={d.mfgDtOrder}
            value={dtOrderId}
            onValueChange={setDtOrderId}
            placeholder="—"
            options={[
              { value: "", label: "—" },
              ...orders.map((order) => ({
                value: order.id,
                label: orderLabelById.get(order.id) ?? order.id,
              })),
            ]}
          />
          <Input label={d.mfgDtNote} value={dtNote} onValueChange={setDtNote} />
        </div>
        <div className="mt-3">
          <Button
            variant="primary"
            className="min-h-12 px-6"
            loading={busy === "downtime"}
            disabled={!dtReady}
            onClick={() => void logDowntime()}
          >
            {d.mfgDtLog}
          </Button>
        </div>
      </Card>

      {/* -- complete dialog ---------------------------------------------------------------- */}
      <Dialog
        open={completeSeq !== null}
        onOpenChange={(open) => {
          if (!open) setCompleteSeq(null);
        }}
        title={d.mfgSfCompleteTitle}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="w-40">
            <Input
              label={d.mfgSfActualSetup}
              value={actualSetup}
              onValueChange={setActualSetup}
              mono
              required
              error={actualSetup !== "" && !TIME_RE.test(actualSetup) ? d.errorsValidation : undefined}
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgSfActualRun}
              value={actualRun}
              onValueChange={setActualRun}
              mono
              required
              error={actualRun !== "" && !TIME_RE.test(actualRun) ? d.errorsValidation : undefined}
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgSfScrapQty}
              value={scrapQty}
              onValueChange={setScrapQty}
              mono
              error={scrapQty !== "" && !QTY_RE.test(scrapQty) ? d.errorsValidation : undefined}
            />
          </div>
          <Input
            label={d.mfgSfScrapReason}
            value={scrapReason}
            onValueChange={setScrapReason}
            error={scrapQty !== "" && scrapReason.trim() === "" ? d.mfgErrScrapReasonRequired : undefined}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCompleteSeq(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={completeSeq !== null && busy === `complete:${completeSeq}`}
            disabled={!completeReady}
            onClick={() => void completeOp()}
          >
            {d.mfgSfComplete}
          </Button>
        </div>
      </Dialog>

      {/* -- skip dialog (the SoD approver floor) --------------------------------------------- */}
      <Dialog
        open={skipSeq !== null}
        onOpenChange={(open) => {
          if (!open) setSkipSeq(null);
        }}
        title={d.mfgSfSkipTitle}
      >
        <div className="flex flex-col gap-3">
          <Input
            label={d.mfgSfSkipReason}
            value={skipReason}
            onValueChange={setSkipReason}
            required
            error={skipReason.trim() === "" ? d.errorsValidation : undefined}
          />
          <Select
            label={d.mfgSfSkipApprover}
            value={skipApprover}
            onValueChange={setSkipApprover}
            placeholder="—"
            options={users.map((user) => ({
              value: user.userId,
              label: `${user.fullName} · ${user.email}`,
            }))}
            required
          />
          <InfoNotice>{d.mfgSfSkipHint}</InfoNotice>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setSkipSeq(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={skipSeq !== null && busy === `skip:${skipSeq}`}
            disabled={!skipReady}
            onClick={() => void skipOp()}
          >
            {d.mfgSfSkip}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
