"use client";

/**
 * T14-UI (PHASE-008) — receipts/payments list (list-search archetype), one
 * component for both sides: doc no., value date, partner, method, amount +
 * currency, allocated, FX gain/loss, status; filters by status and value-
 * date range (server-side refetch through the BFF — the store does the
 * filtering). Rows drill into the document detail.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  DocumentStatusBadge,
  Input,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PartnerRow, TreasuryDocRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedDocumentStatus,
  localizedTreasuryError,
  localizedTreasuryMethod,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { LinkButton } from "./link-button";
import { activeLocaleHeader } from "./table-header";

const STATUS_FILTERS = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "CANCELLED"] as const;

export function TreasuryDocsTable({
  locale,
  kind,
  initialRows,
  partners,
}: {
  locale: Locale;
  /** "receipts" | "payments" — wire path + labels. */
  kind: "receipts" | "payments";
  initialRows: readonly TreasuryDocRow[];
  partners: readonly PartnerRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const isReceipt = kind === "receipts";
  const [rows, setRows] = useState<readonly TreasuryDocRow[]>(initialRows);
  const [statusFilter, setStatusFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partnerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      map.set(partner.id, localizedName(partner.name, partner.nameAr, locale));
    }
    return map;
  }, [partners, locale]);

  const filtered = useMemo(
    () => (statusFilter === "" ? rows : rows.filter((row) => row.status === statusFilter)),
    [rows, statusFilter],
  );

  async function refetch(): Promise<void> {
    setError(null);
    setBusy(true);
    const params = new URLSearchParams();
    if (statusFilter !== "") {
      params.set("status", statusFilter);
    }
    if (from !== "") {
      params.set("from", from);
    }
    if (to !== "") {
      params.set("to", to);
    }
    const refreshed = await bffFetch<readonly TreasuryDocRow[]>(
      `treasury/${kind}?${params.toString()}`,
    );
    setBusy(false);
    if (!refreshed.ok) {
      setError(localizedTreasuryError(d, refreshed.error, refreshed.retryAfterSeconds));
      return;
    }
    setRows(refreshed.data);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card
        title={isReceipt ? d.treasuryReceiptsTitle : d.treasuryPaymentsTitle}
        actions={
          <LinkButton href={`/${locale}/treasury/${kind}/new`} variant="primary">
            {isReceipt ? d.treasuryReceiptsNew : d.treasuryPaymentsNew}
          </LinkButton>
        }
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={[
                { value: "", label: d.kindFilterAll },
                ...STATUS_FILTERS.map((value) => ({
                  value,
                  label: localizedDocumentStatus(d, value),
                })),
              ]}
              aria-label={d.accountingColStatus}
            />
          </div>
          <div className="w-40">
            <Input
              label={d.accountingFromDate}
              value={from}
              onValueChange={setFrom}
              mono
              bidiIsolate
              placeholder="YYYY-MM-DD"
            />
          </div>
          <div className="w-40">
            <Input
              label={d.accountingToDate}
              value={to}
              onValueChange={setTo}
              mono
              bidiIsolate
              placeholder="YYYY-MM-DD"
            />
          </div>
          <Button variant="secondary" onClick={() => void refetch()} loading={busy}>
            {d.listSearchLabel}
          </Button>
        </div>
        <DataTable
          columns={[
            {
              id: "docNo",
              header: activeLocaleHeader(d.treasuryColDocNo),
              accessor: (row) => row.docNo ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.docNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.docNo}</span>
                ),
            },
            {
              id: "date",
              header: activeLocaleHeader(d.treasuryColValueDate),
              accessor: (row) => row.valueDate,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.valueDate}</span>,
            },
            {
              id: "partner",
              header: activeLocaleHeader(d.treasuryColPartner),
              accessor: (row) => partnerNameById.get(row.partnerId) ?? row.partnerId,
              render: (row) => partnerNameById.get(row.partnerId) ?? row.partnerId,
            },
            {
              id: "counterparty",
              header: activeLocaleHeader(isReceipt ? d.treasuryColPayer : d.treasuryColPayee),
              accessor: (row) => row.counterpartyName ?? "",
              render: (row) =>
                row.counterpartyName === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="max-w-[14rem] truncate">{row.counterpartyName}</span>
                ),
            },
            {
              id: "method",
              header: activeLocaleHeader(d.treasuryColMethod),
              accessor: (row) => row.method,
              render: (row) => localizedTreasuryMethod(d, row.method),
            },
            {
              id: "amount",
              header: activeLocaleHeader(d.treasuryColAmount),
              accessor: (row) => row.amount,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.amount, 2)}{" "}
                  <span className="text-xs text-muted-foreground">{row.currencyCode}</span>
                </span>
              ),
            },
            {
              id: "allocated",
              header: activeLocaleHeader(d.treasuryColAllocated),
              accessor: (row) => row.allocatedAmount,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.allocatedAmount, 2)}
                </span>
              ),
            },
            {
              id: "fx",
              header: activeLocaleHeader(d.treasuryColFx),
              accessor: (row) => row.fxGainLoss,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.fxGainLoss, 2)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={row.status}
                  label={localizedDocumentStatus(d, row.status)}
                />
              ),
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row) => router.push(`/${locale}/treasury/${kind}/${row.id}`),
            },
          ]}
          empty={{
            title: isReceipt ? d.treasuryReceiptsEmpty : d.treasuryPaymentsEmpty,
            primaryAction: (
              <LinkButton href={`/${locale}/treasury/${kind}/new`} variant="primary">
                {isReceipt ? d.treasuryReceiptsNew : d.treasuryPaymentsNew}
              </LinkButton>
            ),
          }}
        />
      </Card>
    </div>
  );
}
