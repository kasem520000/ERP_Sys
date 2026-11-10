"use client";

/**
 * PHASE-019 T50 — recurring billing:
 *
 * - the runs history (the crm.billing_run audit events, newest first —
 *   there is NO billing_runs table, the documented §5 choice) with the
 *   summary counts extracted defensively from the audit after-state;
 * - the manual run dialog: the asOf picker + the DRY PREVIEW over every
 *   ACTIVE contract (the per-contract billing-preview route — the
 *   tenant-wide preview is not exposed over HTTP) and the run itself
 *   (POST crm/billing-runs — INV-013 idempotent, never auto-posts);
 * - the drafts review: the contract_invoices listing with the sales
 *   invoices deep-link (the drafts flow the ordinary approval chain).
 *
 * Keyboard-complete: every action is a real focusable button inside the
 * focus-managed @erp/ui dialogs (§14).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";
import Link from "next/link";

import { Badge, Button, DataTable, DatePicker, Dialog } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BillingPreviewRow,
  BillingRunResultRow,
  BillingRunSummaryRow,
  ContractInvoiceRow,
  ServiceContractReadRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedCrmError,
  localizedScheduleEntryType,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** The audit after-state IS the run result — read defensively (unknown). */
function runCounts(summary: unknown): {
  asOf: string;
  scanned: number;
  drafts: number;
  locked: number;
  duplicates: number;
  narrative: number;
} {
  const shape = summary as Partial<BillingRunResultRow> | null;
  return {
    asOf: typeof shape?.asOf === "string" ? shape.asOf : "—",
    scanned: typeof shape?.contractsScanned === "number" ? shape.contractsScanned : 0,
    drafts: Array.isArray(shape?.draftsCreated) ? shape.draftsCreated.length : 0,
    locked: Array.isArray(shape?.skippedLocked) ? shape.skippedLocked.length : 0,
    duplicates: Array.isArray(shape?.skippedDuplicate) ? shape.skippedDuplicate.length : 0,
    narrative: Array.isArray(shape?.needsNarrative) ? shape.needsNarrative.length : 0,
  };
}

export function CrmBilling({
  locale,
  initialRuns,
  contracts,
  initialContractInvoices,
}: {
  locale: Locale;
  initialRuns: readonly BillingRunSummaryRow[];
  contracts: readonly ServiceContractReadRow[];
  initialContractInvoices: readonly ContractInvoiceRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [runs, setRuns] = useState<readonly BillingRunSummaryRow[]>(initialRuns);
  const [contractInvoices, setContractInvoices] = useState<readonly ContractInvoiceRow[]>(
    initialContractInvoices,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The manual run dialog (asOf + dry preview + run).
  const [runOpen, setRunOpen] = useState(false);
  const [runAsOf, setRunAsOf] = useState("");
  const [previews, setPreviews] = useState<readonly BillingPreviewRow[]>([]);
  const [previewRan, setPreviewRan] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const activeContracts = useMemo(
    () => contracts.filter((row) => row.contract.status === "ACTIVE"),
    [contracts],
  );
  const contractLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of contracts) {
      map.set(
        row.contract.id,
        `${row.contract.contractNo ?? shortId(row.contract.id)} · ${row.contract.title}`,
      );
    }
    return map;
  }, [contracts]);

  const runReady = runAsOf !== "";

  async function reloadInvoices(): Promise<void> {
    const result = await bffFetch<readonly ContractInvoiceRow[]>("crm/contract-invoices?limit=200");
    if (result.ok) {
      setContractInvoices(result.data);
    }
  }

  // -- the dry preview (per ACTIVE contract — the §5 preview mirror) --------------

  async function runDryPreview(): Promise<void> {
    if (!runReady) {
      setError(d.errorsValidation);
      return;
    }
    setPreviewLoading(true);
    setError(null);
    const results = await Promise.all(
      activeContracts.map((row) =>
        bffFetch<BillingPreviewRow>(`crm/contracts/${row.contract.id}/billing-preview?asOf=${runAsOf}`),
      ),
    );
    setPreviewLoading(false);
    const failed = results.find((result) => !result.ok);
    if (failed !== undefined && !failed.ok) {
      setError(localizedCrmError(d, failed.error, failed.retryAfterSeconds));
      return;
    }
    setPreviewRan(true);
    setPreviews(
      results.flatMap((result) => (result.ok ? [result.data] : [])),
    );
  }

  // -- the manual run -----------------------------------------------------------------

  async function runBilling(): Promise<void> {
    if (!runReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("run");
    setError(null);
    const result = await bffFetch<BillingRunResultRow>("crm/billing-runs", {
      method: "POST",
      body: { asOf: runAsOf },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRunOpen(false);
    setPreviews([]);
    setPreviewRan(false);
    setNotice(
      formatMessage(d.crmBillingRunToast, {
        drafts: result.data.draftsCreated.length,
        scanned: result.data.contractsScanned,
      }),
    );
    const history = await bffFetch<readonly BillingRunSummaryRow[]>("crm/billing-runs?limit=20");
    if (history.ok) setRuns(history.data);
    await reloadInvoices();
  }

  // -- render -------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.crmBillingRunsTitle}
        actions={
          <Button variant="primary" onClick={() => setRunOpen(true)}>
            {d.crmBillingRunAction}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "at",
              header: activeLocaleHeader(d.crmBillingColAt),
              accessor: (row) => row.at,
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.at.slice(0, 16).replace("T", " ")}
                </span>
              ),
            },
            {
              id: "actor",
              header: activeLocaleHeader(d.crmBillingColActor),
              accessor: (row) => row.actorId ?? "",
              render: (row) =>
                row.actorId === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-xs" dir="ltr">
                    {shortId(row.actorId)}
                  </span>
                ),
            },
            {
              id: "asOf",
              header: activeLocaleHeader(d.crmBillingColAsOf),
              accessor: (row) => runCounts(row.summary).asOf,
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {runCounts(row.summary).asOf}
                </span>
              ),
            },
            {
              id: "scanned",
              header: activeLocaleHeader(d.crmBillingColScanned),
              accessor: (row) => String(runCounts(row.summary).scanned),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {runCounts(row.summary).scanned}
                </span>
              ),
            },
            {
              id: "drafts",
              header: activeLocaleHeader(d.crmBillingColDrafts),
              accessor: (row) => String(runCounts(row.summary).drafts),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {runCounts(row.summary).drafts}
                </span>
              ),
            },
            {
              id: "locked",
              header: activeLocaleHeader(d.crmBillingColLocked),
              accessor: (row) => String(runCounts(row.summary).locked),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {runCounts(row.summary).locked}
                </span>
              ),
            },
            {
              id: "duplicates",
              header: activeLocaleHeader(d.crmBillingColDuplicates),
              accessor: (row) => String(runCounts(row.summary).duplicates),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {runCounts(row.summary).duplicates}
                </span>
              ),
            },
            {
              id: "narrative",
              header: activeLocaleHeader(d.crmBillingColNarrative),
              accessor: (row) => String(runCounts(row.summary).narrative),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {runCounts(row.summary).narrative}
                </span>
              ),
            },
          ]}
          rows={[...runs]}
          rowKey={(row) => row.id}
          empty={{ title: d.crmBillingRunsEmpty }}
        />
      </Card>

      {/* -- the drafts review (contract invoices + the sales deep-link) ------------ */}
      <Card
        title={d.crmBillingDraftsTitle}
        actions={
          <Link
            href={`/${locale}/sales/invoices`}
            className="inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-3 text-sm font-medium text-gray-800 underline-offset-2 hover:border-strong hover:underline"
          >
            {d.crmBillingDraftsLink}
          </Link>
        }
      >
        <DataTable
          columns={[
            {
              id: "contract",
              header: activeLocaleHeader(d.crmBillingDraftsColContract),
              accessor: (row) => contractLabelById.get(row.contractId) ?? row.contractId,
              render: (row) =>
                contractLabelById.get(row.contractId) ?? shortId(row.contractId),
            },
            {
              id: "invoice",
              header: activeLocaleHeader(d.crmBillingDraftsColInvoice),
              accessor: (row) => row.invoiceId,
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {shortId(row.invoiceId)}
                </span>
              ),
            },
            {
              id: "period",
              header: activeLocaleHeader(d.crmBillingDraftsColPeriod),
              accessor: (row) => row.periodKey ?? "",
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.periodKey ?? "—"}
                </span>
              ),
            },
            {
              id: "milestone",
              header: activeLocaleHeader(d.crmBillingDraftsColMilestone),
              accessor: (row) => row.milestoneScheduleId ?? "",
              mono: true,
              render: (row) =>
                row.milestoneScheduleId === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-xs" dir="ltr">
                    {shortId(row.milestoneScheduleId)}
                  </span>
                ),
            },
            {
              id: "createdAt",
              header: activeLocaleHeader(d.crmBillingDraftsColCreatedAt),
              accessor: (row) => row.createdAt,
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => <Badge tone="primary">{row.status}</Badge>,
            },
          ]}
          rows={[...contractInvoices]}
          rowKey={(row) => row.id}
          empty={{ title: d.crmBillingDraftsEmpty }}
        />
      </Card>

      {/* -- the manual run dialog (asOf + dry preview + run) -------------------------- */}
      <Dialog
        open={runOpen}
        onOpenChange={(open) => {
          setRunOpen(open);
          if (!open) {
            setPreviews([]);
            setPreviewRan(false);
          }
        }}
        title={d.crmBillingRunTitle}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <DatePicker
              locale={locale}
              label={d.crmBillingRunAsOf}
              value={runAsOf}
              onSelect={setRunAsOf}
            />
            <Button
              variant="secondary"
              loading={previewLoading}
              disabled={!runReady || activeContracts.length === 0}
              onClick={() => void runDryPreview()}
            >
              {d.crmBillingPreviewAll}
            </Button>
          </div>

          {previewRan &&
            previews.every((preview) => preview.items.length === 0) && (
              <p className="text-sm text-gray-500">{d.crmBillingPreviewEmpty}</p>
            )}

          {previews.length > 0 && (
            <div className="flex max-h-96 flex-col gap-3 overflow-y-auto" aria-label={d.crmBillingPreviewTitle}>
              {previews.flatMap((preview) =>
                preview.items.map((item) => (
                  <div
                    key={`${preview.contractId}-${item.entry.id}`}
                    className="rounded-md border border-subtle p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{localizedScheduleEntryType(d, item.entry.entryType)}</Badge>
                      <span className="text-sm text-gray-700">
                        {d.crmBillingPreviewContract}:{" "}
                        {contractLabelById.get(preview.contractId) ?? shortId(preview.contractId)}
                      </span>
                      <span className="font-mono text-xs" dir="ltr">
                        {item.entry.periodKey ?? item.entry.milestoneLabel ?? "—"} ·{" "}
                        {item.entry.billDate}
                      </span>
                      {item.periodLocked && <Badge>{d.crmPreviewLockedChip}</Badge>}
                    </div>
                    <ul className="mt-2 flex flex-col gap-1">
                      {item.wouldInvoice.map((line, index) => (
                        <li key={index} className="text-sm text-gray-700">
                          <span className="font-mono" dir="ltr">
                            {shortId(line.feeItemId)}
                          </span>{" "}
                          ·{" "}
                          <span className="font-mono tabular-nums" dir="ltr">
                            {line.qty} × {line.unitPrice ?? "—"}
                          </span>
                          {line.description !== null ? ` · ${line.description}` : ""}
                        </li>
                      ))}
                    </ul>
                    {item.needsNarrative.length > 0 && (
                      <p className="mt-1 text-xs text-warning-text">
                        {d.crmPreviewNeedsNarrative}:{" "}
                        <span className="font-mono tabular-nums" dir="ltr">
                          {item.needsNarrative.length}
                        </span>
                      </p>
                    )}
                  </div>
                )),
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRunOpen(false);
                setPreviews([]);
              }}
            >
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              loading={busy === "run"}
              disabled={!runReady}
              onClick={() => void runBilling()}
            >
              {d.crmBillingRunAction}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
