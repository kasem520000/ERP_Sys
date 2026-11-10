"use client";

/**
 * T13-UI (PHASE-011) — payables views (list archetype §2): AP aging
 * (bucketed, deterministic as-of), the supplier statement (running
 * balance + aging column, document currency + base totals), and the GRNI
 * register (received − invoiced per GRN line — RC-09's screen).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, DatePicker, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ApAgingRow, GrniRegisterRow, SupplierStatementRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedPurchasingError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type View = "aging" | "statement" | "grni";

export function PurchasingAp({
  locale,
  initialAging,
  initialGrni,
  suppliers,
}: {
  locale: Locale;
  initialAging: readonly ApAgingRow[];
  initialGrni: readonly GrniRegisterRow[];
  suppliers: readonly { id: string; code: string; name: string; nameAr: string | null }[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [view, setView] = useState<View>("aging");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [aging, setAging] = useState<readonly ApAgingRow[]>(initialAging);
  const [grni, setGrni] = useState<readonly GrniRegisterRow[]>(initialGrni);
  const [statementSupplier, setStatementSupplier] = useState("");
  const [statement, setStatement] = useState<SupplierStatementRow | null>(null);

  const supplierOptions = useMemo(() => {
    const byId = new Map(suppliers.map((s) => [s.id, s]));
    const options = [...byId.values()].map((s) => ({
      value: s.id,
      label: `${s.code} · ${s.name}`,
    }));
    return options;
  }, [suppliers]);

  async function refresh(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (view === "aging") {
        const result = await bffFetch<readonly ApAgingRow[]>(`purchasing/ap/aging?asOf=${asOf}`);
        if (!result.ok) {
          setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
          return;
        }
        setAging(result.data);
      } else if (view === "grni") {
        const result = await bffFetch<readonly GrniRegisterRow[]>(`purchasing/grni?asOf=${asOf}`);
        if (!result.ok) {
          setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
          return;
        }
        setGrni(result.data);
      } else if (statementSupplier !== "") {
        const result = await bffFetch<SupplierStatementRow>(
          `purchasing/ap/statements/${statementSupplier}?asOf=${asOf}`,
        );
        if (!result.ok) {
          setError(localizedPurchasingError(d, result.error, result.retryAfterSeconds));
          return;
        }
        setStatement(result.data);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          <Button variant={view === "aging" ? "primary" : "secondary"} onClick={() => setView("aging")}>
            {d.purchasingApAging}
          </Button>
          <Button variant={view === "statement" ? "primary" : "secondary"} onClick={() => setView("statement")}>
            {d.purchasingApStatement}
          </Button>
          <Button variant={view === "grni" ? "primary" : "secondary"} onClick={() => setView("grni")}>
            {d.purchasingGrniRegister}
          </Button>
        </div>
        <DatePicker
          label={d.purchasingAsOf}
          value={asOf}
          onSelect={setAsOf}
          locale={locale}
          />
        {view === "statement" && (
          <Select
            label={d.purchasingSupplier}
            value={statementSupplier}
            onValueChange={setStatementSupplier}
            options={[{ value: "", label: d.purchasingSelectSupplier }, ...supplierOptions]}
          />
        )}
        <Button disabled={busy} onClick={() => void refresh()}>
          {busy ? d.loading : d.retryLabel}
        </Button>
      </div>

      {view === "aging" && (
        <Card title={d.purchasingApAging}>
          <DataTable
            columns={[
              {
                id: "supplier",
                header: activeLocaleHeader(d.purchasingSupplier),
                accessor: (row: ApAgingRow) => row.supplierCode,
                render: (row: ApAgingRow) => `${row.supplierCode} · ${row.supplierName}`,
              },
              {
                id: "notDue",
                header: activeLocaleHeader(d.purchasingAgingNotDue),
                accessor: (row: ApAgingRow) => row.notDue,
                render: (row: ApAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.notDue}</span>
                ),
              },
              {
                id: "b1",
                header: activeLocaleHeader(d.purchasingAging1_30),
                accessor: (row: ApAgingRow) => row.b1_30,
                render: (row: ApAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.b1_30}</span>
                ),
              },
              {
                id: "b31",
                header: activeLocaleHeader(d.purchasingAging31_60),
                accessor: (row: ApAgingRow) => row.b31_60,
                render: (row: ApAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.b31_60}</span>
                ),
              },
              {
                id: "b61",
                header: activeLocaleHeader(d.purchasingAging61_90),
                accessor: (row: ApAgingRow) => row.b61_90,
                render: (row: ApAgingRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.b61_90}</span>
                ),
              },
              {
                id: "b90",
                header: activeLocaleHeader(d.purchasingAging90Plus),
                accessor: (row: ApAgingRow) => row.b90Plus,
                render: (row: ApAgingRow) => (
                  <span className="font-mono text-sm text-destructive" dir="ltr">{row.b90Plus}</span>
                ),
              },
              {
                id: "total",
                header: activeLocaleHeader(d.purchasingAgingTotal),
                accessor: (row: ApAgingRow) => row.total,
                render: (row: ApAgingRow) => (
                  <span className="font-mono text-sm font-semibold" dir="ltr">{row.total}</span>
                ),
              },
            ]}
            rows={[...aging]}
            rowKey={(row) => row.supplierId}
            empty={{ title: d.purchasingEmpty }}
          />
        </Card>
      )}

      {view === "statement" && statement !== null && (
        <>
          <Card title={`${d.purchasingApStatement} · ${statement.supplierCode}`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">{d.purchasingAsOf}</p>
                <p className="font-mono text-sm" dir="ltr">{statement.asOf}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{d.purchasingClosingBalance}</p>
                <p className="font-mono text-sm font-semibold" dir="ltr">{statement.closingBalance}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{`${d.purchasingAging90Plus} / ${d.purchasingAgingTotal}`}</p>
                <p className="font-mono text-sm" dir="ltr">
                  {statement.aging["90_plus"]} / {statement.aging.not_due}
                </p>
              </div>
            </div>
          </Card>
          <Card title={d.purchasingApStatement}>
            <DataTable
              columns={[
                {
                  id: "date",
                  header: activeLocaleHeader(d.purchasingInvoiceDate),
                  accessor: (row: SupplierStatementRow["entries"][number]) => row.entryDate,
                },
                {
                  id: "ref",
                  header: activeLocaleHeader(d.purchasingInvoiceNo),
                  accessor: (row: SupplierStatementRow["entries"][number]) => row.docRef ?? row.sourceType,
                  mono: true,
                },
                {
                  id: "debit",
                  header: activeLocaleHeader(d.purchasingDebit),
                  accessor: (row: SupplierStatementRow["entries"][number]) => row.debit,
                  render: (row: SupplierStatementRow["entries"][number]) => (
                    <span className="font-mono text-sm" dir="ltr">{row.debit === "0.0000" ? "—" : row.debit}</span>
                  ),
                },
                {
                  id: "credit",
                  header: activeLocaleHeader(d.purchasingCredit),
                  accessor: (row: SupplierStatementRow["entries"][number]) => row.credit,
                  render: (row: SupplierStatementRow["entries"][number]) => (
                    <span className="font-mono text-sm" dir="ltr">{row.credit === "0.0000" ? "—" : row.credit}</span>
                  ),
                },
                {
                  id: "balance",
                  header: activeLocaleHeader(d.purchasingBalance),
                  accessor: (row: SupplierStatementRow["entries"][number]) => row.balance,
                  render: (row: SupplierStatementRow["entries"][number]) => (
                    <span className="font-mono text-sm" dir="ltr">{row.balance}</span>
                  ),
                },
                {
                  id: "outstanding",
                  header: activeLocaleHeader(d.purchasingOutstanding),
                  accessor: (row: SupplierStatementRow["entries"][number]) => row.outstanding,
                  render: (row: SupplierStatementRow["entries"][number]) => (
                    <span className="font-mono text-sm" dir="ltr">{row.outstanding}</span>
                  ),
                },
              ]}
              rows={[...statement.entries]}
              rowKey={(row) => `${row.entryDate}-${row.docRef ?? row.sourceType}`}
              empty={{ title: d.purchasingEmpty }}
            />
          </Card>
        </>
      )}

      {view === "grni" && (
        <Card title={d.purchasingGrniRegister}>
          <DataTable
            columns={[
              {
                id: "receipt",
                header: activeLocaleHeader(d.purchasingReceiptNo),
                accessor: (row: GrniRegisterRow) => row.receiptNo ?? row.grnId.slice(0, 8),
                mono: true,
              },
              {
                id: "date",
                header: activeLocaleHeader(d.purchasingReceiptDate),
                accessor: (row: GrniRegisterRow) => row.receiptDate,
              },
              {
                id: "received",
                header: activeLocaleHeader(d.purchasingReceivedValue),
                accessor: (row: GrniRegisterRow) => row.receivedValue,
                render: (row: GrniRegisterRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.receivedValue}</span>
                ),
              },
              {
                id: "invoiced",
                header: activeLocaleHeader(d.purchasingInvoicedValue),
                accessor: (row: GrniRegisterRow) => row.invoicedValue,
                render: (row: GrniRegisterRow) => (
                  <span className="font-mono text-sm" dir="ltr">{row.invoicedValue}</span>
                ),
              },
              {
                id: "remaining",
                header: activeLocaleHeader(d.purchasingGrniRemaining),
                accessor: (row: GrniRegisterRow) =>
                  (Number(row.receivedValue) - Number(row.invoicedValue)).toFixed(4),
                render: (row: GrniRegisterRow) => (
                  <span className="font-mono text-sm font-semibold" dir="ltr">
                    {(Number(row.receivedValue) - Number(row.invoicedValue)).toFixed(4)}
                  </span>
                ),
              },
            ]}
            rows={[...grni]}
            rowKey={(row) => row.grnLineId}
            empty={{ title: d.purchasingEmpty }}
          />
        </Card>
      )}
    </div>
  );
}
