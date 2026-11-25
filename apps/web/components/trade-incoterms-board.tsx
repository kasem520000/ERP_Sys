"use client";

/**
 * PHASE-051 (W-39 — T-14, D-17) — the Incoterms reference board (the
 * /trade/incoterms screen body): the registry rows with THE RISK-HINT
 * MATRIX rendered from each row's OWN data (the API's
 * renderIncotermMatrix output — zero parallel computation) + the
 * tenant-addition create act (BR-106's own registry discipline: the
 * tenant extends; the 2020 seed's accuracy disclaimer rides the page)
 * — the 048/049/050 board patterns: the typed-refusal panels with
 * FULL payloads, the mono cells.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button, Checkbox, DataTable, Input, useToast, type DataTableColumn } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ApiErrorBody, TradeIncotermRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedTradeError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const CODE_RE = /^[A-Z0-9]{2,8}$/;

export function TradeIncotermsBoard({
  locale,
  initialIncoterms,
  incotermsError,
  canManage,
}: {
  locale: Locale;
  initialIncoterms: readonly TradeIncotermRow[] | null;
  incotermsError: ApiErrorBody | null;
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the registry -----------------------------------------------------------
  const [incoterms, setIncoterms] = useState<readonly TradeIncotermRow[] | null>(initialIncoterms);
  const [incotermsRefusal, setIncotermsRefusal] = useState<ApiErrorBody | null>(incotermsError);
  const [listLoading, setListLoading] = useState(false);

  // -- the tenant-addition form ---------------------------------------------------
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [carriageBySeller, setCarriageBySeller] = useState(false);
  const [insuranceBySeller, setInsuranceBySeller] = useState(false);
  const [exportClearanceBySeller, setExportClearanceBySeller] = useState(false);
  const [importClearanceBySeller, setImportClearanceBySeller] = useState(false);
  const [importDutyBySeller, setImportDutyBySeller] = useState(false);

  const createReady = CODE_RE.test(code) && name.trim().length >= 2 && nameAr.trim().length >= 2;

  async function loadIncoterms(): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly TradeIncotermRow[]>("trade/incoterms");
    setListLoading(false);
    if (!result.ok) {
      setIncotermsRefusal(result.error);
      setIncoterms(null);
      return;
    }
    setIncotermsRefusal(null);
    setIncoterms(result.data);
  }

  async function createIncoterm(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<TradeIncotermRow>("trade/incoterms", {
      method: "POST",
      body: {
        code,
        name,
        nameAr,
        carriageBySeller,
        insuranceBySeller,
        exportClearanceBySeller,
        importClearanceBySeller,
        importDutyBySeller,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradeIncotermCreatedToast);
    toast({ tone: "success", title: d.tradeIncotermCreatedToast });
    setCode("");
    setName("");
    setNameAr("");
    await loadIncoterms();
  }

  const columns: DataTableColumn<TradeIncotermRow>[] = [
    {
      id: "code",
      header: activeLocaleHeader(d.tradeIncotermColCode),
      accessor: (row) => row.code,
      render: (row) => (
        <span className="font-mono tabular-nums" dir="ltr">
          {row.code}
        </span>
      ),
    },
    {
      id: "name",
      header: activeLocaleHeader(d.tradeIncotermColName),
      accessor: (row) => localizedName(row.name, row.nameAr, locale),
    },
    {
      id: "carriage",
      header: activeLocaleHeader(d.tradeIncotermColCarriage),
      accessor: (row) => (row.carriageBySeller ? d.tradeIncotermSeller : d.tradeIncotermBuyer),
    },
    {
      id: "insurance",
      header: activeLocaleHeader(d.tradeIncotermColInsurance),
      accessor: (row) => (row.insuranceBySeller ? d.tradeIncotermSeller : d.tradeIncotermBuyer),
    },
    {
      id: "exportClearance",
      header: activeLocaleHeader(d.tradeIncotermColExportClearance),
      accessor: (row) => (row.exportClearanceBySeller ? d.tradeIncotermSeller : d.tradeIncotermBuyer),
    },
    {
      id: "importClearance",
      header: activeLocaleHeader(d.tradeIncotermColImportClearance),
      accessor: (row) => (row.importClearanceBySeller ? d.tradeIncotermSeller : d.tradeIncotermBuyer),
    },
    {
      id: "importDuty",
      header: activeLocaleHeader(d.tradeIncotermColImportDuty),
      accessor: (row) => (row.importDutyBySeller ? d.tradeIncotermSeller : d.tradeIncotermBuyer),
    },
    {
      id: "active",
      header: activeLocaleHeader(d.tradeIncotermColActive),
      accessor: (row) => (row.isActive ? d.tradeLcYes : d.tradeLcNo),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      <Card
        title={d.tradeIncotermsTitle}
        description={d.tradeIncotermsSubtitle}
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={listLoading}
            onClick={() => void loadIncoterms()}
          >
            {d.tradeRefresh}
          </Button>
        }
      >
        <p className="text-sm text-gray-600">{d.tradeIncotermsSubtitle}</p>
        {/* D-16's documented accuracy disclaimer (the BR-055 family). */}
        <p className="mt-2 text-xs text-muted-foreground">{d.tradeIncotermsDisclaimer}</p>
      </Card>

      {canManage ? (
        <Card title={d.tradeIncotermCreateTitle}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label={d.tradeIncotermCreateCode} value={code} onValueChange={(v) => setCode(v.toUpperCase())} mono bidiIsolate required />
            <Input label={d.tradeIncotermCreateName} value={name} onValueChange={setName} required />
            <Input label={d.tradeIncotermCreateNameAr} value={nameAr} onValueChange={setNameAr} required />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-5">
            <Checkbox
              label={d.tradeIncotermCreateCarriage}
              checked={carriageBySeller}
              onCheckedChange={(checked) => setCarriageBySeller(checked === true)}
            />
            <Checkbox
              label={d.tradeIncotermCreateInsurance}
              checked={insuranceBySeller}
              onCheckedChange={(checked) => setInsuranceBySeller(checked === true)}
            />
            <Checkbox
              label={d.tradeIncotermCreateExportClearance}
              checked={exportClearanceBySeller}
              onCheckedChange={(checked) => setExportClearanceBySeller(checked === true)}
            />
            <Checkbox
              label={d.tradeIncotermCreateImportClearance}
              checked={importClearanceBySeller}
              onCheckedChange={(checked) => setImportClearanceBySeller(checked === true)}
            />
            <Checkbox
              label={d.tradeIncotermCreateImportDuty}
              checked={importDutyBySeller}
              onCheckedChange={(checked) => setImportDutyBySeller(checked === true)}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              loading={busy === "create"}
              disabled={!createReady}
              onClick={() => void createIncoterm()}
            >
              {d.tradePaneCreate}
            </Button>
          </div>
        </Card>
      ) : null}

      {incotermsRefusal !== null ? (
        <TypedRefusalPanel
          error={incotermsRefusal}
          title={d.tradeRefusalTitle}
          detailsLabel={d.tradeRefusalDetails}
        />
      ) : null}

      {incotermsRefusal === null && incoterms !== null ? (
        incoterms.length === 0 ? (
          <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
        ) : (
          <DataTable columns={columns} rows={[...incoterms]} rowKey={(row) => row.id} />
        )
      ) : null}

      {/* THE RISK-HINT MATRIX — each row's own output rendered VERBATIM (the
          registry data's five ownership axes; the active locale's side). */}
      {incotermsRefusal === null && incoterms !== null && incoterms.length > 0 ? (
        <Card title={d.tradeIncotermMatrixTitle}>
          <div className="flex flex-col gap-3">
            {incoterms.slice(0, 12).map((row) => (
              <div key={row.id} className="rounded-md border border-subtle bg-gray-50 px-3 py-2">
                <p className="text-xs font-semibold text-gray-700">
                  {row.code} · {localizedName(row.name, row.nameAr, locale)}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {(locale === "ar" ? row.matrix.ar : row.matrix.en).map((line) => (
                    <li key={line} className="text-xs text-gray-600">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
