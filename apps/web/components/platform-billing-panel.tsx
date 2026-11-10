"use client";

/**
 * T19-WEB (PHASE-014) — the admin-console billing panel (matrix §3.10,
 * A-009): cross-tenant billing history per tenant (GET
 * /platform/subscriptions?tenantId=…), the MANUAL-INVOICING FALLBACK (invoice
 * select OPEN-only, via bank_transfer/cash/cheque, reference + reason both
 * required min 3 chars → POST /platform/subscriptions/:subscriptionId/
 * manual-payment — the path :id segment is the SUBSCRIPTION id while the body
 * carries the invoiceId), billing-driven suspend/restore with confirmation
 * dialogs (reason required), the on-demand daily pass with its outcome
 * counts, and the audit-visible via_platform_admin note in the caption.
 * Every mutation re-reads the history (the panel is its own source).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BillingRestoreOutcome,
  BillingSuspendOutcome,
  DailyPassOutcome,
  ManualPaymentOutcome,
  PlatformBillingHistory,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedBillingError,
  localizedBillingEvent,
  localizedStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";

type PaymentVia = "bank_transfer" | "cash" | "cheque";
const MIN_INPUT = 3;

export function PlatformBillingPanel({
  locale,
  tenantId,
}: {
  locale: Locale;
  tenantId: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [data, setData] = useState<PlatformBillingHistory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Manual payment form
  const [invoiceId, setInvoiceId] = useState("");
  const [via, setVia] = useState<PaymentVia>("bank_transfer");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  // Suspend/restore (reason shared by both; confirmation dialogs)
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [confirmAction, setConfirmAction] = useState<"suspend" | "restore" | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    const result = await bffFetch<PlatformBillingHistory>(
      `platform/subscriptions?tenantId=${encodeURIComponent(tenantId)}`,
    );
    setBusy(false);
    if (!result.ok) {
      setLoadError(localizedBillingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setLoadError(null);
    setData(result.data);
    // Prefill the OPEN invoice when one exists.
    const open = result.data.invoices.find((invoice) => invoice.status === "OPEN");
    setInvoiceId((current) => (current === "" && open !== undefined ? open.id : current));
  }, [d, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const subscription = data?.subscription ?? null;
  const openInvoices = data?.invoices.filter((invoice) => invoice.status === "OPEN") ?? [];

  async function recordManualPayment(): Promise<void> {
    if (subscription === null) {
      setError(d.billingAdminNoSubscription);
      return;
    }
    if (invoiceId === "" || reference.trim().length < MIN_INPUT || reason.trim().length < MIN_INPUT) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await bffFetch<ManualPaymentOutcome>(
      `platform/subscriptions/${encodeURIComponent(subscription.id)}/manual-payment`,
      {
        method: "POST",
        body: {
          invoiceId,
          via,
          reference: reference.trim(),
          reason: reason.trim(),
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedBillingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.billingAdminManualDone, {
        number: result.data.invoiceNumber,
        status: result.data.subscriptionStatus,
      }),
    );
    setReference("");
    setReason("");
    setInvoiceId("");
    await load();
    router.refresh();
  }

  async function runLifecycle(action: "suspend" | "restore"): Promise<void> {
    if (subscription === null) {
      setError(d.billingAdminNoSubscription);
      return;
    }
    if (lifecycleReason.trim().length < MIN_INPUT) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    if (action === "suspend") {
      const result = await bffFetch<BillingSuspendOutcome>(
        `platform/subscriptions/${encodeURIComponent(subscription.id)}/suspend`,
        { method: "POST", body: { reason: lifecycleReason.trim() } },
      );
      setBusy(false);
      if (!result.ok) {
        setError(localizedBillingError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setNotice(formatMessage(d.billingAdminSuspendDone, { count: result.data.killedSessions }));
    } else {
      const result = await bffFetch<BillingRestoreOutcome>(
        `platform/subscriptions/${encodeURIComponent(subscription.id)}/restore`,
        { method: "POST", body: { reason: lifecycleReason.trim() } },
      );
      setBusy(false);
      if (!result.ok) {
        setError(localizedBillingError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setNotice(d.billingAdminRestoreDone);
    }
    setLifecycleReason("");
    setConfirmAction(null);
    await load();
    router.refresh();
  }

  async function runDailyPass(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await bffFetch<DailyPassOutcome>("platform/subscriptions/run-daily-pass", {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedBillingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.billingAdminDailyPassDone, {
        trials: result.data.trialsExpired,
        suspensions: result.data.suspensions,
        applied: result.data.downgradesApplied,
        blocked: result.data.downgradesBlocked,
        overdue: result.data.overdueInvoices,
        reconciled: result.data.documentsReconciled,
      }),
    );
    await load();
  }

  return (
    <Card
      title={d.billingAdminTitle}
      description={d.billingAdminCaption}
      ariaLabel={d.billingAdminTitle}
      actions={
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          {d.reportWorkspaceRefresh}
        </Button>
      }
    >
      {loadError !== null && <ErrorNotice>{loadError}</ErrorNotice>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {data === null && loadError === null ? (
        <p className="text-sm text-gray-600">{d.loading}</p>
      ) : data === null ? null : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-800">{d.billingAdminSubscription}</span>
            {subscription === null ? (
              <span className="text-sm text-gray-600">—</span>
            ) : (
              <>
                <span
                  dir="ltr"
                  className="rounded-sm border border-info-border bg-info-bg px-1.5 py-0.5 text-xs leading-4 text-info-text"
                >
                  {localizedStatus(d, subscription.status)}
                </span>
                <span dir="ltr" className="font-mono text-xs text-gray-600">
                  {subscription.periodStart} → {subscription.periodEnd}
                </span>
                {data.plan !== null && (
                  <span className="text-sm text-gray-700">
                    {localizedName(data.plan.name, data.plan.nameAr, locale)}
                  </span>
                )}
              </>
            )}
          </div>

          <section aria-label={d.billingAdminManualTitle} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-gray-900">{d.billingAdminManualTitle}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                id={`billing-manual-invoice-${tenantId}`}
                label={d.billingAdminInvoice}
                value={invoiceId}
                onValueChange={setInvoiceId}
                options={[
                  { value: "", label: d.billingAdminSelectInvoice },
                  ...openInvoices.map((invoice) => ({
                    value: invoice.id,
                    label: `${invoice.number} · ${invoice.amount} ${invoice.currencyCode}`,
                  })),
                ]}
              />
              <Select
                id={`billing-manual-via-${tenantId}`}
                label={d.billingAdminVia}
                value={via}
                onValueChange={(value) => setVia(value as PaymentVia)}
                options={[
                  { value: "bank_transfer", label: d.billingAdminViaBankTransfer },
                  { value: "cash", label: d.billingAdminViaCash },
                  { value: "cheque", label: d.billingAdminViaCheque },
                ]}
              />
              <Input
                id={`billing-manual-reference-${tenantId}`}
                label={d.billingAdminReference}
                value={reference}
                onValueChange={setReference}
              />
              <Input
                id={`billing-manual-reason-${tenantId}`}
                label={d.billingAdminReason}
                value={reason}
                onValueChange={setReason}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                loading={busy}
                disabled={openInvoices.length === 0}
                onClick={() => void recordManualPayment()}
              >
                {d.billingAdminRecordButton}
              </Button>
              {openInvoices.length === 0 && (
                <span className="text-xs text-gray-500">{d.billingAdminNoOpenInvoices}</span>
              )}
            </div>
          </section>

          <section aria-label={d.billingAdminLifecycleTitle} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-gray-900">{d.billingAdminLifecycleTitle}</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full max-w-md">
                <Input
                  id={`billing-lifecycle-reason-${tenantId}`}
                  label={d.billingAdminReason}
                  value={lifecycleReason}
                  onValueChange={setLifecycleReason}
                />
              </div>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => setConfirmAction("suspend")}
              >
                {d.billingAdminSuspendButton}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmAction("restore")}
              >
                {d.billingAdminRestoreButton}
              </Button>
            </div>
          </section>

          <section aria-label={d.billingAdminDailyPassTitle} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{d.billingAdminDailyPassTitle}</h3>
            <p className="max-w-2xl text-xs text-gray-500">{d.billingAdminDailyPassHint}</p>
            <Button variant="secondary" disabled={busy} onClick={() => void runDailyPass()}>
              {d.billingAdminDailyPassButton}
            </Button>
          </section>

          {data.events.length > 0 && (
            <section aria-label={d.billingEventsTitle} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{d.billingEventsTitle}</h3>
              <ol className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {data.events.slice(0, 20).map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-col gap-0.5 border-s-2 border-subtle ps-3"
                  >
                    <span className="text-sm font-medium text-gray-800">
                      {localizedBillingEvent(d, event.type)}
                    </span>
                    <span dir="ltr" className="font-mono text-xs text-gray-500">
                      {formatDateTime(event.createdAt, locale)}
                      {event.viaPlatformAdmin ? ` · ${d.billingViaPlatformAdmin}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <InfoNotice>{d.billingAdminAuditNote}</InfoNotice>
        </div>
      )}

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
          }
        }}
        title={confirmAction === "suspend" ? d.billingAdminConfirmSuspend : d.billingAdminConfirmRestore}
        size="sm"
      >
        <p className="text-sm text-gray-700">
          {confirmAction === "suspend" ? d.billingAdminConfirmSuspendBody : d.billingAdminConfirmRestoreBody}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmAction(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant={confirmAction === "suspend" ? "danger" : "primary"}
            onClick={() => {
              if (confirmAction !== null) {
                void runLifecycle(confirmAction);
              }
            }}
          >
            {d.billingAdminConfirmButton}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
