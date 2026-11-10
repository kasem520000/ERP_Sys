"use client";

/**
 * T15-UI (PHASE-009) — the VAT return workspace (list-search archetype,
 * combined): the returns list (country, period, status via
 * DocumentStatusBadge, filing reference) + the create form (country from
 * the jurisdiction packs, period start/end — one return per window), and
 * per selected return the INV-012 workspace: the summary-groups table
 * (direction / treatment / rate / base / tax), the side-by-side
 * cross-check card (document totals vs GL net movements with the
 * ok/mismatch banner), prepare (DRAFT → READY, gated on the exact match),
 * mark-filed (READY only — a HUMAN action, reference + note) and the
 * CSV/XLSX exports (signed download URLs via the files module).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  DatePicker,
  DocumentStatusBadge,
  Input,
  Select,
  formatMoneyDisplay,
  type DocumentStatus,
} from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import {
  isRecord,
  type JurisdictionPackRow,
  type VatReturnExportResult,
  type VatReturnRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedTaxError,
  localizedTaxTreatment,
  localizedVatReturnStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Rate strings travel as canonical decimals ("15.0000") — display trimmed + %. */
function percentLabel(rate: string): string {
  const trimmed = rate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${trimmed === "" ? "0" : trimmed}%`;
}

/** OUTPUT/INPUT direction labels (summary groups carry the raw vocabulary). */
function directionLabel(d: Dictionary, direction: string): string {
  switch (direction) {
    case "OUTPUT":
      return d.vatReturnDirectionOutput;
    case "INPUT":
      return d.vatReturnDirectionInput;
    default:
      return direction;
  }
}

/** Narrow the prepared summary JSON into the groups table rows. */
interface SummaryGroupRow {
  direction: string;
  treatment: string;
  rate: string;
  taxableBase: string;
  taxAmount: string;
}

function summaryGroupsOf(summary: Record<string, unknown>): SummaryGroupRow[] {
  const raw = isRecord(summary) && Array.isArray(summary.groups) ? summary.groups : [];
  return raw.filter(
    (group): group is SummaryGroupRow =>
      isRecord(group) &&
      typeof group.direction === "string" &&
      typeof group.treatment === "string" &&
      typeof group.rate === "string" &&
      typeof group.taxableBase === "string" &&
      typeof group.taxAmount === "string",
  );
}

/** Money cells: canonical strings pass through; anything else renders — . */
function moneyOrDash(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "—";
}

/** Default the create form to the current month's first/last day. */
function currentMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
  };
}

export function VatReturn({
  locale,
  initialReturns,
  packs,
  canPrepare,
  canMarkFiled,
}: {
  locale: Locale;
  initialReturns: readonly VatReturnRow[];
  packs: readonly JurisdictionPackRow[];
  canPrepare: boolean;
  canMarkFiled: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [returns, setReturns] = useState<readonly VatReturnRow[]>(initialReturns);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create form state (country from the seeded packs; month bounds default).
  const bounds = currentMonthBounds();
  const [countryCode, setCountryCode] = useState("");
  const [periodStart, setPeriodStart] = useState(bounds.start);
  const [periodEnd, setPeriodEnd] = useState(bounds.end);

  // Mark-filed form state (READY returns only).
  const [filingReference, setFilingReference] = useState("");
  const [filingNote, setFilingNote] = useState("");

  const selected = returns.find((row) => row.id === selectedId) ?? null;

  const countryOptions = useMemo(
    () =>
      packs.map((pack) => ({
        value: pack.countryCode,
        label: `${pack.countryCode} · ${localizedName(pack.countryName, pack.countryNameAr, locale)}`,
      })),
    [packs, locale],
  );

  const minorUnitsByCountry = useMemo(
    () => new Map(packs.map((pack) => [pack.countryCode, pack.minorUnits])),
    [packs],
  );
  const minorUnits = selected !== null ? (minorUnitsByCountry.get(selected.countryCode) ?? 2) : 2;

  const summaryGroups = selected !== null ? summaryGroupsOf(selected.summary) : [];
  const crossCheck = selected !== null && isRecord(selected.crossCheck) ? selected.crossCheck : {};
  const documentSide = isRecord(crossCheck.documentSide) ? crossCheck.documentSide : {};
  const glSide = isRecord(crossCheck.glSide) ? crossCheck.glSide : {};
  const prepared = selected !== null && selected.preparedAt !== null;

  const createReady =
    countryCode !== "" && periodStart !== "" && periodEnd !== "" && periodStart <= periodEnd;

  async function reloadReturns(): Promise<void> {
    const refreshed = await bffFetch<readonly VatReturnRow[]>("tax/vat-returns");
    if (refreshed.ok) {
      setReturns(refreshed.data);
    }
  }

  async function createReturn(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    const created = await bffFetch<VatReturnRow>("tax/vat-returns", {
      method: "POST",
      body: { countryCode, periodStart, periodEnd },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedTaxError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setReturns((current) => [created.data, ...current]);
    setSelectedId(created.data.id);
    setFilingReference("");
    setFilingNote("");
    setNotice(d.vatReturnCreatedToast);
    router.refresh();
  }

  async function prepareReturn(): Promise<void> {
    if (selected === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("prepare");
    const result = await bffFetch<VatReturnRow>(`tax/vat-returns/${selected.id}/prepare`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTaxError(d, result.error, result.retryAfterSeconds));
      // The row keeps the mismatch banner data server-side — reload it.
      await reloadReturns();
      return;
    }
    setReturns((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    setNotice(d.vatReturnPreparedToast);
    router.refresh();
  }

  async function markFiled(): Promise<void> {
    if (selected === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("filed");
    const result = await bffFetch<VatReturnRow>(`tax/vat-returns/${selected.id}/mark-filed`, {
      method: "POST",
      body: {
        filingReference: filingReference.trim() === "" ? null : filingReference.trim(),
        filingNote: filingNote.trim() === "" ? null : filingNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTaxError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setReturns((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    setFilingReference("");
    setFilingNote("");
    setNotice(d.vatReturnFiledToast);
    router.refresh();
  }

  async function exportReturn(format: "CSV" | "XLSX"): Promise<void> {
    if (selected === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(`export-${format}`);
    const exported = await bffFetch<VatReturnExportResult>(
      `tax/vat-returns/${selected.id}/export?format=${format}`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!exported.ok) {
      setError(localizedTaxError(d, exported.error, exported.retryAfterSeconds));
      return;
    }
    window.open(exported.data.downloadUrl, "_blank");
    setNotice(
      `${formatMessage(d.exportDone, { rows: exported.data.rowCount })} ${formatMessage(
        d.exportExpiresNote,
        { seconds: exported.data.expiresInSeconds },
      )}`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.vatReturnTitle}>
        <DataTable
          columns={[
            {
              id: "country",
              header: activeLocaleHeader(d.vatReturnCountry),
              accessor: (row) => row.countryCode,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.countryCode}
                </span>
              ),
            },
            {
              id: "period",
              header: activeLocaleHeader(d.vatReturnPeriod),
              accessor: (row) => row.periodStart,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.periodStart} → {row.periodEnd}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.vatReturnStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={row.status as DocumentStatus}
                  label={localizedVatReturnStatus(d, row.status)}
                />
              ),
            },
            {
              id: "filingReference",
              header: activeLocaleHeader(d.vatReturnFilingReference),
              accessor: (row) => row.filingReference ?? "",
              mono: true,
              render: (row) =>
                row.filingReference === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.filingReference}
                  </span>
                ),
            },
          ]}
          rows={[...returns]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "select",
              label: d.vatReturnCrossCheck,
              onSelect: (row: VatReturnRow) => {
                setSelectedId(row.id);
                setFilingReference("");
                setFilingNote("");
              },
            },
          ]}
          empty={{ title: d.vatReturnEmpty }}
        />
      </Card>

      {selected !== null && (
        <>
          <Card
            title={d.vatReturnSummaryTitle}
            description={`${selected.countryCode} · ${selected.periodStart} → ${selected.periodEnd}`}
          >
            <div className="flex flex-col gap-3">
              <DocumentStatusBadge
                status={selected.status as DocumentStatus}
                label={localizedVatReturnStatus(d, selected.status)}
                size="md"
              />
              <DataTable
                columns={[
                  {
                    id: "direction",
                    header: activeLocaleHeader(d.vatReturnDirection),
                    accessor: (row) => row.direction,
                    render: (row) => directionLabel(d, row.direction),
                  },
                  {
                    id: "treatment",
                    header: activeLocaleHeader(d.taxCodesTreatment),
                    accessor: (row) => row.treatment,
                    render: (row) => localizedTaxTreatment(d, row.treatment),
                  },
                  {
                    id: "rate",
                    header: activeLocaleHeader(d.taxPacksRate),
                    accessor: (row) => row.rate,
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {percentLabel(row.rate)}
                      </span>
                    ),
                  },
                  {
                    id: "taxableBase",
                    header: activeLocaleHeader(d.vatReturnTaxableBase),
                    accessor: (row) => row.taxableBase,
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {formatMoneyDisplay(row.taxableBase, minorUnits)}
                      </span>
                    ),
                  },
                  {
                    id: "taxAmount",
                    header: activeLocaleHeader(d.vatReturnTaxAmount),
                    accessor: (row) => row.taxAmount,
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {formatMoneyDisplay(row.taxAmount, minorUnits)}
                      </span>
                    ),
                  },
                ]}
                rows={summaryGroups}
                rowKey={(row) => `${row.direction}-${row.treatment}-${row.rate}`}
                empty={{ title: d.vatReturnEmpty }}
              />

              {canPrepare && selected.status !== "FILED" && (
                <Button
                  variant="primary"
                  onClick={() => void prepareReturn()}
                  loading={busy === "prepare"}
                  className="self-start"
                >
                  {d.vatReturnPrepare}
                </Button>
              )}
            </div>
          </Card>

          <Card title={d.vatReturnCrossCheck}>
            <div className="flex flex-col gap-3">
              {prepared &&
                (selected.crossCheckOk ? (
                  <SuccessNotice>{d.vatReturnReadyNote}</SuccessNotice>
                ) : (
                  <ErrorNotice>{d.vatReturnMismatch}</ErrorNotice>
                ))}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-600">
                    <th scope="col" className="py-1 text-start font-medium" aria-hidden="true" />
                    <th scope="col" className="py-1 text-start font-medium">
                      {d.vatReturnDocumentSide}
                    </th>
                    <th scope="col" className="py-1 text-start font-medium">
                      {d.vatReturnGlSide}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      key: "output",
                      label: d.vatReturnOutputTax,
                      documentValue: documentSide.outputTax,
                      glValue: glSide.vatPayableNetCredit,
                    },
                    {
                      key: "input",
                      label: d.vatReturnInputTax,
                      documentValue: documentSide.inputTaxRecoverable,
                      glValue: glSide.vatRecoverableNetDebit,
                    },
                    {
                      key: "expensed",
                      label: d.vatReturnInputTaxExpensed,
                      documentValue: documentSide.inputTaxExpensed,
                      glValue: glSide.vatExpensedNetDebit,
                    },
                  ].map((row) => (
                    <tr key={row.key} className="border-t border-subtle">
                      <td className="py-1.5">{row.label}</td>
                      <td className="py-1.5">
                        <span className="font-mono tabular-nums" dir="ltr">
                          {moneyOrDash(row.documentValue)}
                        </span>
                      </td>
                      <td className="py-1.5">
                        <span className="font-mono tabular-nums" dir="ltr">
                          {moneyOrDash(row.glValue)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {canPrepare && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void exportReturn("CSV")}
                    loading={busy === "export-CSV"}
                  >
                    {d.vatReturnExportCsv}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void exportReturn("XLSX")}
                    loading={busy === "export-XLSX"}
                  >
                    {d.vatReturnExportXlsx}
                  </Button>
                </div>
              )}

              {canMarkFiled && selected.status === "READY" && (
                <div className="flex flex-col gap-3 border-t border-subtle pt-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label={d.vatReturnFilingReference}
                      value={filingReference}
                      onValueChange={setFilingReference}
                      mono
                      bidiIsolate
                    />
                    <Input
                      label={d.vatReturnFilingNote}
                      value={filingNote}
                      onValueChange={setFilingNote}
                    />
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => void markFiled()}
                    loading={busy === "filed"}
                    className="self-start"
                  >
                    {d.vatReturnMarkFiled}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {canPrepare && (
        <Card title={d.vatReturnCreateTitle}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label={d.vatReturnCountry}
              value={countryCode}
              onValueChange={setCountryCode}
              placeholder="—"
              options={countryOptions}
              required
            />
            <DatePicker
              locale={locale}
              label={d.vatReturnPeriodStart}
              value={periodStart}
              onSelect={setPeriodStart}
              required
            />
            <DatePicker
              locale={locale}
              label={d.vatReturnPeriodEnd}
              value={periodEnd}
              onSelect={setPeriodEnd}
              min={periodStart}
              required
            />
          </div>
          <Button
            variant="primary"
            onClick={() => void createReturn()}
            loading={busy === "create"}
            disabled={!createReady}
            className="mt-3 self-start"
          >
            {d.commonCreate}
          </Button>
        </Card>
      )}
    </div>
  );
}
