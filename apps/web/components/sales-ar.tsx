"use client";

/**
 * T13-UI (PHASE-012) — receivables views (list archetype §2): AR aging
 * (bucketed, deterministic as-of per RC-10), the customer statement
 * (running balance + aging columns + the INV-009 subledgerTie footer),
 * and the open-items surface the receipts allocation context consumes
 * (INV-016). The on-demand invoice.overdue scan posts the §2.9 job; print
 * stays honestly disabled until the PHASE-013 reporting release (§7).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, DatePicker, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ArAgingRow,
  ArOpenItemRow,
  ArStatement,
  OverdueScanResult,
  PartnerRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedName, localizedSalesError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type View = "aging" | "statement" | "open";

/** INV-009 footer chip — ok/not (the tied balances render beside it). */
function SubledgerTieChip({
  ok,
  okLabel,
  brokenLabel,
}: {
  ok: boolean;
  okLabel: string;
  brokenLabel: string;
}): JSX.Element {
  const style = ok
    ? "border-success-border bg-success-bg text-success-text"
    : "border-danger-border bg-danger-bg text-danger-text";
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${style}`}>
      {ok ? okLabel : brokenLabel}
    </span>
  );
}

export function SalesAr({
  locale,
  initialAging,
  initialOpenItems,
  customers,
  canRunScan,
}: {
  locale: Locale;
  initialAging: readonly ArAgingRow[];
  initialOpenItems: readonly ArOpenItemRow[];
  customers: readonly PartnerRow[];
  canRunScan: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const [view, setView] = useState<View>("aging");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [aging, setAging] = useState<readonly ArAgingRow[]>(initialAging);
  const [openItems, setOpenItems] = useState<readonly ArOpenItemRow[]>(initialOpenItems);
  const [statementCustomer, setStatementCustomer] = useState("");
  const [openCustomer, setOpenCustomer] = useState("");
  const [statement, setStatement] = useState<ArStatement | null>(null);

  const customerOptions = useMemo(() => {
    const byId = new Map(customers.map((c) => [c.id, c]));
    return [...byId.values()].map((c) => ({
      value: c.id,
      label: `${c.code} · ${localizedName(c.name, c.nameAr, locale)}`,
    }));
  }, [customers, locale]);

  async function refresh(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (view === "aging") {
        const result = await bffFetch<readonly ArAgingRow[]>(`sales/ar/aging?asOf=${asOf}`);
        if (!result.ok) {
          setError(localizedSalesError(d, result.error, result.retryAfterSeconds));
          return;
        }
        setAging(result.data);
      } else if (view === "open") {
        const result = await bffFetch<readonly ArOpenItemRow[]>(
          `sales/ar/open-items?limit=200${openCustomer === "" ? "" : `&customerId=${openCustomer}`}`,
        );
        if (!result.ok) {
          setError(localizedSalesError(d, result.error, result.retryAfterSeconds));
          return;
        }
        setOpenItems(result.data);
      } else if (statementCustomer !== "") {
        const result = await bffFetch<ArStatement>(
          `sales/ar/statements/${statementCustomer}?asOf=${asOf}`,
        );
        if (!result.ok) {
          setError(localizedSalesError(d, result.error, result.retryAfterSeconds));
          return;
        }
        setStatement(result.data);
      }
    } finally {
      setBusy(false);
    }
  }

  async function runOverdueScan(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await bffFetch<OverdueScanResult>("sales/jobs/invoice-overdue/run-scan", {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedSalesError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.salesOverdueScanDone, { overdue: result.data.overdue, alerted: result.data.alerted }),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          <Button variant={view === "aging" ? "primary" : "secondary"} onClick={() => setView("aging")}>
            {d.salesArAging}
          </Button>
          <Button variant={view === "statement" ? "primary" : "secondary"} onClick={() => setView("statement")}>
            {d.salesArStatement}
          </Button>
          <Button variant={view === "open" ? "primary" : "secondary"} onClick={() => setView("open")}>
            {d.salesArOpenItems}
          </Button>
        </div>
        {view !== "open" && (
          <DatePicker label={d.salesAsOf} value={asOf} onSelect={setAsOf} locale={locale} />
        )}
        {view === "statement" && (
          <Select
            label={d.salesCustomer}
            value={statementCustomer}
            onValueChange={setStatementCustomer}
            options={[{ value: "", label: d.salesSelectCustomer }, ...customerOptions]}
          />
        )}
        {view === "open" && (
          <Select
            label={d.salesCustomer}
            value={openCustomer}
            onValueChange={setOpenCustomer}
            options={[{ value: "", label: d.salesSelectCustomer }, ...customerOptions]}
          />
        )}
        <Button disabled={busy} onClick={() => void refresh()}>
          {busy ? d.loading : d.retryLabel}
        </Button>
        {canRunScan && (
          <Button variant="secondary" disabled={busy} onClick={() => void runOverdueScan()}>
            {d.salesRunOverdueScan}
          </Button>
        )}
      </div>

      {view === "aging" && (
        <Card title={d.salesArAging}>
          <DataTable
            columns={[
              {
                id: "customer",
                header: activeLocaleHeader(d.salesCustomer),
                accessor: (row: ArAgingRow) => row.customerCode,
                render: (row: ArAgingRow) => `${row.customerCode} · ${localizedName(row.customerName, row.customerNameAr, locale)}`,
              },
              {
                id: "notDue",
                header: activeLocaleHeader(d.salesAgingNotDue),
                accessor: (row: ArAgingRow) => row.notDue,
                render: (row: ArAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.notDue}</span>
                ),
              },
              {
                id: "b1",
                header: activeLocaleHeader(d.salesAging1_30),
                accessor: (row: ArAgingRow) => row.b1_30,
                render: (row: ArAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.b1_30}</span>
                ),
              },
              {
                id: "b31",
                header: activeLocaleHeader(d.salesAging31_60),
                accessor: (row: ArAgingRow) => row.b31_60,
                render: (row: ArAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.b31_60}</span>
                ),
              },
              {
                id: "b61",
                header: activeLocaleHeader(d.salesAging61_90),
                accessor: (row: ArAgingRow) => row.b61_90,
                render: (row: ArAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.b61_90}</span>
                ),
              },
              {
                id: "b90",
                header: activeLocaleHeader(d.salesAging90Plus),
                accessor: (row: ArAgingRow) => row.b90Plus,
                render: (row: ArAgingRow) => (
                  <span className="font-mono text-sm text-destructive" dir="ltr">{row.b90Plus}</span>
                ),
              },
              {
                id: "total",
                header: activeLocaleHeader(d.salesAgingTotal),
                accessor: (row: ArAgingRow) => row.total,
                render: (row: ArAgingRow) => (
                  <span className="font-mono text-sm font-semibold" dir="ltr">{row.total}</span>
                ),
              },
              {
                id: "baseTotal",
                header: activeLocaleHeader(d.salesBaseBalance),
                accessor: (row: ArAgingRow) => row.baseTotal,
                render: (row: ArAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.baseTotal}</span>
                ),
              },
            ]}
            rows={[...aging]}
            rowKey={(row) => row.customerId}
            empty={{ title: d.salesEmpty }}
          />
        </Card>
      )}

      {view === "statement" && (
        <>
          {statement !== null && (
            <Card title={`${d.salesArStatement} · ${statement.customerCode}`}>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">{d.salesAsOf}</p>
                  <p className="font-mono text-sm" dir="ltr">{statement.asOf}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{d.salesClosingBalance}</p>
                  <p className="font-mono text-sm font-semibold" dir="ltr">{statement.closingBalance}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{d.salesBaseBalance}</p>
                  <p className="font-mono text-sm" dir="ltr">{statement.closingBalanceBase}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{`${d.salesAging90Plus} / ${d.salesAgingNotDue}`}</p>
                  <p className="font-mono text-sm" dir="ltr">
                    {statement.aging["90_plus"]} / {statement.aging.not_due}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">{d.salesSubledgerTie}</p>
                <SubledgerTieChip
                  ok={statement.subledgerTie.ok}
                  okLabel={d.salesTieOk}
                  brokenLabel={d.salesTieBroken}
                />
                <p className="font-mono text-xs" dir="ltr">
                  {statement.subledgerTie.statementBalance} / {statement.subledgerTie.subledgerBalance}
                </p>
              </div>
            </Card>
          )}
          <Card title={d.salesArStatement}>
            <DataTable
              columns={[
                {
                  id: "date",
                  header: activeLocaleHeader(d.salesInvoiceDate),
                  accessor: (row: ArStatement["entries"][number]) => row.entryDate,
                },
                {
                  id: "ref",
                  header: activeLocaleHeader(d.salesInvoiceNo),
                  accessor: (row: ArStatement["entries"][number]) => row.docRef ?? row.sourceType,
                  mono: true,
                },
                {
                  id: "debit",
                  header: activeLocaleHeader(d.salesDebit),
                  accessor: (row: ArStatement["entries"][number]) => row.debit,
                  render: (row: ArStatement["entries"][number]) => (
                    <span className="font-mono text-sm" dir="ltr">{row.debit === "0.0000" ? "—" : row.debit}</span>
                  ),
                },
                {
                  id: "credit",
                  header: activeLocaleHeader(d.salesCredit),
                  accessor: (row: ArStatement["entries"][number]) => row.credit,
                  render: (row: ArStatement["entries"][number]) => (
                    <span className="font-mono text-sm" dir="ltr">{row.credit === "0.0000" ? "—" : row.credit}</span>
                  ),
                },
                {
                  id: "balance",
                  header: activeLocaleHeader(d.salesBalance),
                  accessor: (row: ArStatement["entries"][number]) => row.balance,
                  render: (row: ArStatement["entries"][number]) => (
                    <span className="font-mono text-sm" dir="ltr">{row.balance}</span>
                  ),
                },
                {
                  id: "outstanding",
                  header: activeLocaleHeader(d.salesOutstanding),
                  accessor: (row: ArStatement["entries"][number]) => row.outstanding,
                  render: (row: ArStatement["entries"][number]) => (
                    <span className="font-mono text-sm" dir="ltr">{row.outstanding}</span>
                  ),
                },
              ]}
              rows={[...(statement?.entries ?? [])]}
              rowKey={(row) => `${row.entryDate}-${row.docRef ?? row.sourceType}`}
              empty={{ title: d.salesEmpty }}
            />
            {/* §7 constraint: statement print arrives with PHASE-013 — an
                honest disabled state, never a dead button that pretends. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled>
                {d.salesPrint}
              </Button>
              <p className="text-xs text-muted-foreground">{d.salesPrintDisabled}</p>
            </div>
          </Card>
        </>
      )}

      {view === "open" && (
        <Card title={d.salesArOpenItems}>
          <InfoNotice>{d.salesOpenItemsHint}</InfoNotice>
          <DataTable
            columns={[
              {
                id: "date",
                header: activeLocaleHeader(d.salesInvoiceDate),
                accessor: (row: ArOpenItemRow) => row.entryDate,
              },
              {
                id: "customer",
                header: activeLocaleHeader(d.salesCustomer),
                accessor: (row: ArOpenItemRow) => row.partnerId,
                render: (row: ArOpenItemRow) => row.partnerId.slice(0, 8),
              },
              {
                id: "source",
                header: activeLocaleHeader(d.salesSource),
                accessor: (row: ArOpenItemRow) => row.sourceType,
                render: (row: ArOpenItemRow) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.sourceType}
                    {row.memo !== null && row.memo !== "" ? ` · ${row.memo}` : ""}
                  </span>
                ),
              },
              {
                id: "due",
                header: activeLocaleHeader(d.salesDueDate),
                accessor: (row: ArOpenItemRow) => row.dueDate ?? "—",
              },
              {
                id: "amount",
                header: activeLocaleHeader(d.salesAmount),
                accessor: (row: ArOpenItemRow) => row.amount,
                render: (row: ArOpenItemRow) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.direction === "DEBIT" ? row.amount : `−${row.amount}`}
                  </span>
                ),
              },
              {
                id: "settled",
                header: activeLocaleHeader(d.salesCredit),
                accessor: (row: ArOpenItemRow) => row.settledAmount,
                render: (row: ArOpenItemRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.settledAmount}</span>
                ),
              },
              {
                id: "outstanding",
                header: activeLocaleHeader(d.salesOutstanding),
                accessor: (row: ArOpenItemRow) => row.outstanding,
                render: (row: ArOpenItemRow) => (
                  <span className="font-mono text-sm font-semibold" dir="ltr">{row.outstanding}</span>
                ),
              },
            ]}
            rows={[...openItems]}
            rowKey={(row) => row.id}
            empty={{ title: d.salesEmpty }}
          />
        </Card>
      )}
    </div>
  );
}
