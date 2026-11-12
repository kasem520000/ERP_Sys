"use client";

/**
 * PHASE-044 (T-14) — the ABC classification screen: the latest generation
 * table (rank, class, consumption value, velocity) with the Pareto class
 * summary and the recompute card (window + thresholds). The class drives
 * count frequency and slotting hints (§2.7); zero-consumption lands C.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { WmsAbcRecomputeResult, WmsAbcRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInventoryError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function InventoryAbc({
  locale,
  initialRows,
  canManage,
}: {
  locale: Locale;
  initialRows: readonly WmsAbcRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly WmsAbcRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState("90");
  const [aPct, setAPct] = useState("0.80");
  const [bPct, setBPct] = useState("0.95");

  const summary = useMemo(() => {
    let a = 0;
    let b = 0;
    let c = 0;
    for (const row of rows) {
      if (row.cls === "A") a += 1;
      else if (row.cls === "B") b += 1;
      else c += 1;
    }
    return { a, b, c };
  }, [rows]);

  async function recompute(): Promise<void> {
    if (!/^\d+$/.test(windowDays) || Number(windowDays) < 1) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("recompute");
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsAbcRecomputeResult>("inventory/wms/abc/recompute", {
      method: "POST",
      body: {
        windowDays: Number(windowDays),
        aPct: aPct.trim() === "" ? undefined : aPct.trim(),
        bPct: bPct.trim() === "" ? undefined : bPct.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.wmsAbcRecomputedToast);
    // Re-read the latest generation.
    const refreshed = await bffFetch<readonly WmsAbcRow[]>("inventory/wms/abc?limit=500");
    if (refreshed.ok) {
      setRows(refreshed.data);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.wmsAbcTitle}>
        <p className="mb-3 text-sm text-muted-foreground">
          {d.wmsAbcSummaryA}: <span className="font-medium">{summary.a}</span> ·{" "}
          {d.wmsAbcSummaryB}: <span className="font-medium">{summary.b}</span> ·{" "}
          {d.wmsAbcSummaryC}: <span className="font-medium">{summary.c}</span>
        </p>
        <p className="mb-3 text-xs text-muted-foreground">{d.wmsAbcHint}</p>
        <DataTable
          columns={[
            {
              id: "rank",
              header: activeLocaleHeader(d.wmsAbcColRank),
              accessor: (row) => String(row.rankNo),
              sortable: true,
            },
            {
              id: "item",
              header: activeLocaleHeader(d.wmsAbcColItem),
              accessor: (row) => row.itemSku ?? row.itemId,
              mono: true,
            },
            {
              id: "cls",
              header: activeLocaleHeader(d.wmsAbcColClass),
              accessor: (row) => row.cls,
              render: (row) => (
                <span
                  className={
                    row.cls === "A"
                      ? "text-xs font-semibold text-success-foreground"
                      : row.cls === "B"
                        ? "text-xs font-semibold"
                        : "text-xs text-muted-foreground"
                  }
                  data-testid={`abc-class-${row.cls}`}
                >
                  {row.cls}
                </span>
              ),
            },
            {
              id: "value",
              header: activeLocaleHeader(d.wmsAbcColValue),
              accessor: (row) => row.consumptionValue,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.consumptionValue}</span>
              ),
            },
            {
              id: "qty",
              header: activeLocaleHeader(d.wmsAbcColQty),
              accessor: (row) => row.totalQtyOut,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.totalQtyOut}</span>
              ),
            },
            {
              id: "velocity",
              header: activeLocaleHeader(d.wmsAbcColVelocity),
              accessor: (row) => row.velocity,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.velocity}</span>
              ),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          empty={{ title: d.wmsAbcEmpty }}
        />
      </Card>

      {canManage && (
        <Card title={d.wmsAbcRecomputeTitle}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label={d.wmsAbcWindowLabel}
              value={windowDays}
              onValueChange={setWindowDays}
              inputMode="numeric"
              required
            />
            <Input label="A %" value={aPct} onValueChange={setAPct} inputMode="decimal" hint="0.80" />
            <Input label="B %" value={bPct} onValueChange={setBPct} inputMode="decimal" hint="0.95" />
          </div>
          <Button variant="primary" className="mt-3 self-start" loading={busy === "recompute"} onClick={() => void recompute()}>
            {d.wmsAbcRecomputeBtn}
          </Button>
        </Card>
      )}
    </div>
  );
}
