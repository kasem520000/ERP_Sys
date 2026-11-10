"use client";

/**
 * T-WEB (PHASE-013) — the report workspace (PAGE_ARCHETYPES §7, the Report
 * archetype): the permission-filtered registry catalog grouped by category,
 * the minimal declarative parameter bar (dateFrom/dateTo + asOf for as-of
 * semantics + the per-run report locale), client-side saved views
 * (localStorage 'erp-report-views' — parameter sets only, never new logic),
 * run + poll (inline envelopes render immediately; queued job-class runs
 * poll every 2s up to 60s with a stage display), the read-only grouped
 * result table (numeric columns tabular + text-end, 🔒 = the locked
 * balance-check totals, drill links as anchors), the reconciliation
 * assertion footer (FAIL blocks exports client-side too — the server blocks
 * them regardless), signed-URL exports and the print-preview dialog (iframe
 * srcDoc — the same HTML the renderer prints). RTL: logical utilities only.
 */
import { useEffect, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";

import { Button, DataTable, DatePicker, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, otherLocale, type Dictionary, type Locale } from "../i18n/dictionaries";
import {
  isRecord,
  type ApiErrorBody,
  type ReportExportResult,
  type ReportPrintPreview,
  type ReportRegistryItem,
  type ReportResultColumn,
  type ReportResultEnvelope,
  type ReportResultRow,
  type ReportRunOutcome,
  type ReportRunStatus,
  type ReportRunSummary,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { cx } from "../lib/cx";
import { formatMessage, localizedApiError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Saved views are client-side parameter sets (the phase forbids a server table). */
interface SavedView {
  id: string;
  label: { ar: string; en: string };
  reportKey: string;
  params: { dateFrom: string; dateTo: string; asOf?: string; locale: "ar" | "en" };
}

const SAVED_VIEWS_KEY = "erp-report-views";

/** Queued job-class run polling (REPORTING_ARCHITECTURE §3): 2s up to 60s. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

/** Default the window params to the current month's first/last day (as vat-return). */
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

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * T19-WEB (PHASE-014) — dashboard drill-down deep links: /reports?report=…
 * &dateFrom=…&dateTo=…[&asOf=…]. Read once from the location on mount
 * (client-only; SSR renders the plain defaults). The report key must match
 * a permitted catalog row — unpermitted keys resolve to no selection (the
 * server is the enforcer; never a feature-existence leak).
 */
interface DeepLink {
  report: string;
  dateFrom?: string;
  dateTo?: string;
  asOf?: string;
}

function deepLinkFromLocation(): DeepLink | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const report = params.get("report");
  if (report === null || report === "") {
    return null;
  }
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  const asOf = params.get("asOf");
  return {
    report,
    dateFrom: dateFrom !== null && YMD_RE.test(dateFrom) ? dateFrom : undefined,
    dateTo: dateTo !== null && YMD_RE.test(dateTo) ? dateTo : undefined,
    asOf: asOf !== null && YMD_RE.test(asOf) ? asOf : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Narrow a localStorage row into a SavedView (storage is untrusted). */
function isSavedView(value: unknown): value is SavedView {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.label) &&
    typeof value.label.ar === "string" &&
    typeof value.label.en === "string" &&
    typeof value.reportKey === "string" &&
    isRecord(value.params) &&
    typeof value.params.dateFrom === "string" &&
    typeof value.params.dateTo === "string"
  );
}

/** Tone chip (same token classes the sales-ar SubledgerTieChip composes). */
function Chip({
  tone,
  children,
}: {
  tone: "success" | "danger" | "info" | "neutral";
  children: ReactNode;
}): JSX.Element {
  const styles = {
    success: "border-success-border bg-success-bg text-success-text",
    danger: "border-danger-border bg-danger-bg text-danger-text",
    info: "border-info-border bg-info-bg text-info-text",
    neutral: "border-subtle bg-gray-100 text-gray-600",
  } as const;
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4",
        styles[tone],
      )}
    >
      {children}
    </span>
  );
}

function runStatusLabel(d: Dictionary, status: string): string {
  switch (status) {
    case "QUEUED":
      return d.reportWorkspaceQueued;
    case "RUNNING":
      return d.reportWorkspaceRunning;
    case "SUCCEEDED":
      return d.reportWorkspaceStatusSucceeded;
    case "FAILED":
      return d.reportWorkspaceStatusFailed;
    default:
      return status;
  }
}

function runStatusTone(status: string): "success" | "danger" | "info" | "neutral" {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "FAILED":
      return "danger";
    case "RUNNING":
      return "info";
    default:
      return "neutral";
  }
}

/** Reporting error localization (ASSERTION_FAILED export block + param shapes). */
function localizedReportError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  if (error.code === "ASSERTION_FAILED") {
    return d.reportWorkspaceExportBlocked;
  }
  if (error.code === "PARAMS_INVALID" || error.code === "CONTRACT_VERSION_MISMATCH") {
    return d.errorsValidation;
  }
  return localizedApiError(d, error, retryAfterSeconds);
}

/** One result cell: null → dash, numeric → mono tabular LTR run (RTL §8). */
function resultCell(row: ReportResultRow, column: ReportResultColumn): ReactNode {
  const value = row.values[column.id];
  if (value === null || value === undefined) {
    return <span className="text-gray-400">—</span>;
  }
  if (column.numeric === true) {
    return (
      <span className="font-mono tabular-nums" dir="ltr">
        {String(value)}
      </span>
    );
  }
  if (column.type === "date") {
    return (
      <span className="font-mono" dir="ltr">
        {String(value)}
      </span>
    );
  }
  return String(value);
}

export function ReportWorkspace({
  locale,
  registry,
  initialRuns,
  permissions,
  canExport,
  reportKeyPrefix,
}: {
  locale: Locale;
  registry: readonly ReportRegistryItem[];
  initialRuns: readonly ReportRunSummary[];
  permissions: readonly string[];
  canExport: boolean;
  /**
   * PHASE-026 (T13-UI) — optional module scoping for module report pages
   * (e.g. "/fixed-assets/reports" passes "fixed_assets."): filters the
   * catalog AND the run history to keys with this prefix. Absent = the
   * whole registry (the /reports default — behavior unchanged).
   */
  reportKeyPrefix?: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const other = otherLocale(locale);
  const bounds = currentMonthBounds();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(bounds.start);
  const [dateTo, setDateTo] = useState(bounds.end);
  const [asOf, setAsOf] = useState(bounds.end);
  const [runLocale, setRunLocale] = useState<"ar" | "en">(locale);

  const [result, setResult] = useState<ReportResultEnvelope | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [pollStage, setPollStage] = useState<{ status: string; stage: string | null } | null>(null);
  const [initialRunsState, setInitialRunsState] =
    useState<readonly ReportRunSummary[]>(initialRuns);

  const [views, setViews] = useState<readonly SavedView[]>([]);
  const [viewNameAr, setViewNameAr] = useState("");
  const [viewNameEn, setViewNameEn] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [printOpen, setPrintOpen] = useState(false);
  const [printHtml, setPrintHtml] = useState<string | null>(null);

  // Saved views load once on mount (localStorage is client-only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
      if (raw === null) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setViews(parsed.filter(isSavedView));
      }
    } catch {
      // storage unavailable (private mode / quota) — views stay empty
    }
  }, []);

  // T19-WEB (PHASE-014): dashboard drill-down — apply the deep link once on
  // mount (client-only; effect-after-hydration, so SSR markup matches and
  // the parameters simply appear). Unpermitted report keys resolve to no
  // selection once `permitted` filters the catalog.
  useEffect(() => {
    const link = deepLinkFromLocation();
    if (link === null) {
      return;
    }
    setSelectedKey(link.report);
    if (link.dateFrom !== undefined) {
      setDateFrom(link.dateFrom);
    }
    if (link.dateTo !== undefined) {
      setDateTo(link.dateTo);
    }
    if (link.asOf !== undefined) {
      setAsOf(link.asOf);
    }
  }, []);

  /**
   * The catalog is filtered to reports whose requiredPermission the user
   * holds — plus the optional module prefix (PHASE-026: the fixed-assets
   * report page scopes to the "fixed_assets." keys).
   */
  const permitted = useMemo(
    () =>
      registry.filter(
        (item) =>
          permissions.includes(item.requiredPermission) &&
          (reportKeyPrefix === undefined || item.id.startsWith(reportKeyPrefix)),
      ),
    [registry, permissions, reportKeyPrefix],
  );

  const categories = useMemo(() => {
    const order: string[] = [];
    const byCategory = new Map<string, ReportRegistryItem[]>();
    for (const item of permitted) {
      const bucket = byCategory.get(item.category);
      if (bucket === undefined) {
        byCategory.set(item.category, [item]);
        order.push(item.category);
      } else {
        bucket.push(item);
      }
    }
    return order.map((category) => ({ category, items: byCategory.get(category) ?? [] }));
  }, [permitted]);

  const selected = permitted.find((item) => item.id === selectedKey) ?? null;

  const failedAssertionIds =
    result === null ? [] : result.assertions.filter((a) => a.status === "FAIL").map((a) => a.id);
  const assertionsFailed = failedAssertionIds.length > 0;
  const hasDrill = result !== null && result.rows.some((row) => (row.drillLinks?.length ?? 0) > 0);
  const resultFormats =
    result === null
      ? []
      : (registry.find((item) => item.id === result.reportId)?.exportFormats ?? []);
  const resultTitle =
    result === null
      ? ""
      : (registry.find((item) => item.id === result.reportId)?.title[locale] ?? result.reportId);

  /** Data + interleaved group header rows (groupKey → registry group label). */
  const resultBody = useMemo((): ReactNode[] => {
    if (result === null) {
      return [];
    }
    const colCount = result.columns.length + (hasDrill ? 1 : 0);
    const groupLabelOf = (key: string): string => {
      const group = result.groups.find((candidate) => candidate.key === key);
      return group !== undefined ? group.label[locale] : key;
    };
    const out: ReactNode[] = [];
    let lastGroupKey: string | undefined;
    result.rows.forEach((row, index) => {
      if (row.groupKey !== undefined && row.groupKey !== lastGroupKey) {
        out.push(
          <tr
            key={`group-${row.groupKey}-${index}`}
            className="border-t border-subtle bg-surface-sunken"
          >
            <th
              scope="rowgroup"
              colSpan={colCount}
              className="px-3 py-1.5 text-start text-sm font-semibold text-gray-800"
            >
              {groupLabelOf(row.groupKey)}
            </th>
          </tr>,
        );
      }
      lastGroupKey = row.groupKey;
      out.push(
        <tr key={row.key} className="border-t border-subtle">
          {result.columns.map((column) => (
            <td
              key={column.id}
              className={cx("px-3 py-1.5", column.numeric === true ? "text-end" : "text-start")}
            >
              {resultCell(row, column)}
            </td>
          ))}
          {hasDrill && (
            <td className="px-3 py-1.5">
              {(row.drillLinks ?? []).map((link) => (
                <a
                  key={link.route}
                  href={link.route}
                  className="me-3 text-xs text-gray-700 underline hover:text-gray-900"
                >
                  {link.label[locale]}
                </a>
              ))}
            </td>
          )}
        </tr>,
      );
    });
    return out;
  }, [result, hasDrill, locale]);

  const runReady =
    selected !== null &&
    dateFrom !== "" &&
    dateTo !== "" &&
    dateFrom <= dateTo &&
    (selected.semantics !== "as-of" || asOf !== "");

  function persistViews(next: readonly SavedView[]): void {
    setViews(next);
    try {
      window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable — the in-memory list still applies for this visit
    }
  }

  function clearSelection(): void {
    setSelectedKey(null);
    setResult(null);
    setCurrentRunId(null);
    setPollStage(null);
    setError(null);
    setNotice(null);
  }

  function selectReport(id: string): void {
    setSelectedKey(id);
    setResult(null);
    setCurrentRunId(null);
    setPollStage(null);
    setError(null);
    setNotice(null);
  }

  /**
   * Run history, scoped by the module prefix when present (PHASE-026):
   * refreshRuns re-fetches unfiltered, then this filter narrows the list.
   */
  const runs =
    reportKeyPrefix === undefined
      ? initialRunsState
      : initialRunsState.filter((row) => row.reportKey.startsWith(reportKeyPrefix));

  async function refreshRuns(): Promise<void> {
    setBusy("history");
    const refreshed = await bffFetch<readonly ReportRunSummary[]>("reporting/report-runs?limit=20");
    if (refreshed.ok) {
      setInitialRunsState(
        reportKeyPrefix === undefined
          ? refreshed.data
          : refreshed.data.filter((row) => row.reportKey.startsWith(reportKeyPrefix)),
      );
    }
    setBusy(null);
  }

  /** Load a stored result envelope (the export/print source of truth). */
  async function fetchResult(runId: string): Promise<boolean> {
    const fetched = await bffFetch<ReportResultEnvelope | null>(
      `reporting/report-runs/${runId}/result`,
    );
    if (!fetched.ok) {
      setError(localizedReportError(d, fetched.error, fetched.retryAfterSeconds));
      return false;
    }
    if (fetched.data === null) {
      setError(d.errorsNotFound);
      return false;
    }
    setResult(fetched.data);
    setCurrentRunId(runId);
    return true;
  }

  async function runReport(): Promise<void> {
    if (selected === null || !runReady) {
      return;
    }
    setError(null);
    setNotice(null);
    setResult(null);
    setCurrentRunId(null);
    setPollStage(null);
    setBusy("run");
    const params: Record<string, unknown> = { dateFrom, dateTo, locale: runLocale };
    if (selected.semantics === "as-of") {
      params.asOf = asOf;
    }
    const outcome = await bffFetch<ReportRunOutcome>("reporting/report-runs", {
      method: "POST",
      body: { reportKey: selected.id, params },
    });
    if (!outcome.ok) {
      setBusy(null);
      setError(localizedReportError(d, outcome.error, outcome.retryAfterSeconds));
      void refreshRuns();
      return;
    }
    if (outcome.data.result !== undefined) {
      // inline (or cached) — the envelope is the run result
      setResult(outcome.data.result);
      setCurrentRunId(outcome.data.runId);
      setBusy(null);
      void refreshRuns();
      return;
    }
    // job path — poll the run row every 2s up to 60s (stage display)
    setPollStage({ status: "QUEUED", stage: null });
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      if (Date.now() >= deadline) {
        break;
      }
      const status = await bffFetch<ReportRunStatus | null>(
        `reporting/report-runs/${outcome.data.runId}`,
      );
      if (!status.ok || status.data === null) {
        continue; // transient poll miss — retry until the deadline
      }
      setPollStage({ status: status.data.status, stage: status.data.stage });
      if (status.data.status === "SUCCEEDED") {
        const loaded = await fetchResult(outcome.data.runId);
        setBusy(null);
        setPollStage(null);
        void refreshRuns();
        if (!loaded) {
          return;
        }
        return;
      }
      if (status.data.status === "FAILED") {
        setError(
          status.data.errorCode === null
            ? d.reportWorkspaceStatusFailed
            : `${d.reportWorkspaceStatusFailed} (${status.data.errorCode})`,
        );
        setBusy(null);
        setPollStage(null);
        void refreshRuns();
        return;
      }
    }
    setBusy(null);
    setPollStage(null);
    setError(d.errorsGeneric);
    void refreshRuns();
  }

  async function exportResult(format: "pdf" | "xlsx" | "csv"): Promise<void> {
    if (currentRunId === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(`export-${format}`);
    const exported = await bffFetch<ReportExportResult>(
      `reporting/report-runs/${currentRunId}/exports`,
      { method: "POST", body: { format } },
    );
    setBusy(null);
    if (!exported.ok) {
      setError(localizedReportError(d, exported.error, exported.retryAfterSeconds));
      return;
    }
    window.open(exported.data.url, "_blank");
    setNotice(formatMessage(d.exportExpiresNote, { seconds: exported.data.expiresInSeconds }));
  }

  async function openPrintPreview(): Promise<void> {
    if (currentRunId === null) {
      return;
    }
    setError(null);
    setBusy("print");
    const preview = await bffFetch<ReportPrintPreview | null>(
      `reporting/print-preview/${currentRunId}`,
    );
    setBusy(null);
    if (!preview.ok) {
      setError(localizedReportError(d, preview.error, preview.retryAfterSeconds));
      return;
    }
    setPrintHtml(preview.data === null ? null : preview.data.html);
    setPrintOpen(true);
  }

  async function openRun(row: ReportRunSummary): Promise<void> {
    if (row.status !== "SUCCEEDED") {
      return;
    }
    setSelectedKey(row.reportKey);
    setError(null);
    setNotice(null);
    setBusy("open");
    await fetchResult(row.runId);
    setBusy(null);
  }

  function saveCurrentView(): void {
    if (selected === null) {
      return;
    }
    const ar = viewNameAr.trim();
    const en = viewNameEn.trim();
    if (ar === "" && en === "") {
      setError(d.errorsValidation);
      return;
    }
    const view: SavedView = {
      id: randomId(),
      label: { ar: ar === "" ? en : ar, en: en === "" ? ar : en },
      reportKey: selected.id,
      params: {
        dateFrom,
        dateTo,
        locale: runLocale,
        ...(selected.semantics === "as-of" ? { asOf } : {}),
      },
    };
    persistViews([...views, view]);
    setViewNameAr("");
    setViewNameEn("");
    setError(null);
    setNotice(d.reportWorkspaceViewSaved);
  }

  function applyView(view: SavedView): void {
    setSelectedKey(view.reportKey);
    setDateFrom(view.params.dateFrom);
    setDateTo(view.params.dateTo);
    setRunLocale(view.params.locale);
    if (view.params.asOf !== undefined) {
      setAsOf(view.params.asOf);
    }
    setError(null);
    setNotice(null);
  }

  function deleteView(id: string): void {
    persistViews(views.filter((view) => view.id !== id));
  }

  const exportLabels: Record<string, string> = {
    pdf: d.reportWorkspaceExportPdf,
    xlsx: d.reportWorkspaceExportXlsx,
    csv: d.reportWorkspaceExportCsv,
  };

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* catalog — left column on lg, top on mobile; permission-filtered */}
        <Card title={d.reportWorkspaceCatalog} ariaLabel={d.reportWorkspaceCatalog}>
          {categories.length === 0 ? (
            <p className="text-sm text-gray-600">{d.reportWorkspaceNoReport}</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <div className="flex flex-col gap-4">
                {categories.map(({ category, items }) => (
                  <div key={category} className="flex flex-col gap-1.5">
                    <p
                      className="font-mono text-xs tracking-wide text-gray-500 uppercase"
                      dir="ltr"
                    >
                      {category}
                    </p>
                    <div className="flex flex-col gap-1">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => selectReport(item.id)}
                          aria-pressed={selectedKey === item.id}
                          className={cx(
                            "rounded-md border px-2.5 py-1.5 text-start outline-none transition-colors",
                            selectedKey === item.id
                              ? "border-primary-600 bg-primary-50"
                              : "border-default bg-surface-card hover:border-strong",
                          )}
                        >
                          <span className="block text-sm font-medium text-gray-900">
                            {item.title[locale]}
                          </span>
                          <span lang={other} className="block text-xs text-gray-500">
                            {item.title[other]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* workspace column */}
        <div className="flex min-w-0 flex-col gap-6">
          {selected === null && result === null && (
            <Card title={d.reportWorkspaceTitle}>
              <p className="text-sm text-gray-600">{d.reportWorkspaceNoReport}</p>
            </Card>
          )}
          {selected !== null && (
            <>
              <Card
                title={selected.title[locale]}
                description={`v${selected.version} · ${selected.executionClass} · ${selected.semantics}`}
                actions={
                  <Button size="sm" variant="ghost" onClick={clearSelection}>
                    {d.reportWorkspaceBack}
                  </Button>
                }
              >
                <div className="flex flex-wrap items-end gap-3">
                  <DatePicker
                    locale={locale}
                    label={d.reportWorkspaceDateFrom}
                    value={dateFrom}
                    onSelect={setDateFrom}
                    required
                  />
                  <DatePicker
                    locale={locale}
                    label={d.reportWorkspaceDateTo}
                    value={dateTo}
                    onSelect={setDateTo}
                    min={dateFrom}
                    required
                  />
                  {selected.semantics === "as-of" && (
                    <DatePicker
                      locale={locale}
                      label={d.reportWorkspaceAsOfLabel}
                      value={asOf}
                      onSelect={setAsOf}
                    />
                  )}
                  <Select
                    label={d.reportWorkspaceLocale}
                    value={runLocale}
                    onValueChange={(next) => {
                      setRunLocale(next === "en" ? "en" : "ar");
                    }}
                    options={[
                      { value: "ar", label: "العربية" },
                      { value: "en", label: "English" },
                    ]}
                  />
                  <Button
                    variant="primary"
                    onClick={() => void runReport()}
                    loading={busy === "run"}
                    disabled={!runReady}
                    className="self-start"
                  >
                    {d.reportWorkspaceRun}
                  </Button>
                </div>
                {busy === "run" && pollStage !== null && (
                  <p aria-live="polite" className="mt-3 text-sm text-gray-600">
                    {runStatusLabel(d, pollStage.status)}
                    {pollStage.stage !== null && (
                      <>
                        {" · "}
                        {d.reportWorkspaceStage}:{" "}
                        <span className="font-mono" dir="ltr">
                          {pollStage.stage}
                        </span>
                      </>
                    )}
                  </p>
                )}
              </Card>

              <Card title={d.reportWorkspaceSavedViews}>
                <div className="flex flex-col gap-3">
                  {views.length > 0 && (
                    <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                      {views.map((view) => (
                        <li
                          key={view.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-subtle px-2.5 py-1.5"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-gray-900">
                              {view.label[locale] === "" ? view.label[other] : view.label[locale]}
                            </span>
                            <span className="block font-mono text-xs text-gray-500" dir="ltr">
                              {view.reportKey}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Button size="sm" onClick={() => applyView(view)}>
                              {d.reportWorkspaceApply}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => deleteView(view.id)}
                              aria-label={`${d.reportWorkspaceDeleteView}: ${view.label[locale]}`}
                            >
                              {d.reportWorkspaceDeleteView}
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label={d.reportWorkspaceViewNameAr}
                      value={viewNameAr}
                      onValueChange={setViewNameAr}
                    />
                    <Input
                      label={d.reportWorkspaceViewNameEn}
                      value={viewNameEn}
                      onValueChange={setViewNameEn}
                    />
                  </div>
                  <Button onClick={saveCurrentView} className="self-start">
                    {d.reportWorkspaceSaveView}
                  </Button>
                </div>
              </Card>
            </>
          )}

          {result !== null && (
            <Card title={resultTitle}>
              <div className="flex flex-col gap-3">
                <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span className="font-mono" dir="ltr">
                    {result.runId}
                  </span>
                  <span aria-hidden="true">·</span>
                  {result.freshness.asOf != null && result.freshness.asOf !== "" && (
                    <>
                      <span>
                        {formatMessage(d.reportWorkspaceAsOf, {
                          date: result.freshness.asOf,
                        })}
                      </span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span>
                    {formatMessage(d.reportWorkspaceComputedAt, {
                      datetime: result.freshness.computedAt,
                    })}
                  </span>
                </p>

                {/* export + print bar (assertion FAIL disables the export buttons) */}
                <div className="flex flex-wrap items-center gap-2">
                  {resultFormats.map((format) => (
                    <Button
                      key={format}
                      size="sm"
                      disabled={!canExport || assertionsFailed}
                      loading={busy === `export-${format}`}
                      onClick={() => {
                        if (format === "pdf" || format === "xlsx" || format === "csv") {
                          void exportResult(format);
                        }
                      }}
                    >
                      {exportLabels[format] ?? format.toUpperCase()}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === "print"}
                    onClick={() => void openPrintPreview()}
                  >
                    {d.reportWorkspacePrintPreview}
                  </Button>
                  {!canExport && <span className="text-xs text-gray-500">{d.errorsForbidden}</span>}
                </div>

                {assertionsFailed && (
                  <ErrorNotice>
                    {`${d.reportWorkspaceAssertionFailed}: ${failedAssertionIds.join(", ")}`}
                  </ErrorNotice>
                )}

                {(result.notes ?? []).map((note, index) => (
                  <InfoNotice key={index}>{note[locale]}</InfoNotice>
                ))}

                {result.rows.length === 0 ? (
                  <p className="text-sm text-gray-600">{d.reportWorkspaceEmpty}</p>
                ) : (
                  <div className="max-h-[70vh] overflow-auto rounded-md border border-subtle">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-surface-sunken">
                        <tr className="text-xs text-gray-600">
                          {result.columns.map((column) => (
                            <th
                              key={column.id}
                              scope="col"
                              className={cx(
                                "px-3 py-2 font-medium",
                                column.numeric === true ? "text-end" : "text-start",
                              )}
                            >
                              {column.label[locale]}
                            </th>
                          ))}
                          {hasDrill && <th scope="col" className="px-3 py-2" aria-hidden="true" />}
                        </tr>
                      </thead>
                      <tbody>{resultBody}</tbody>
                      {result.totals.length > 0 && (
                        <tfoot>
                          {result.totals.map((total) => (
                            <tr
                              key={total.id}
                              className="border-t-2 border-subtle bg-surface-sunken"
                            >
                              {result.columns.length >= 2 ? (
                                <>
                                  <th
                                    scope="row"
                                    colSpan={result.columns.length - 1}
                                    className="px-3 py-1.5 text-start font-semibold text-gray-900"
                                  >
                                    {total.kind === "check" && (
                                      <span aria-hidden="true" className="me-1">
                                        🔒
                                      </span>
                                    )}
                                    {total.label[locale]}
                                  </th>
                                  <td className="px-3 py-1.5 text-end">
                                    <span className="font-mono tabular-nums" dir="ltr">
                                      {total.amount}
                                    </span>
                                  </td>
                                  {hasDrill && <td />}
                                </>
                              ) : (
                                <th
                                  scope="row"
                                  colSpan={1}
                                  className="px-3 py-1.5 text-start font-semibold text-gray-900"
                                >
                                  {total.kind === "check" && (
                                    <span aria-hidden="true" className="me-1">
                                      🔒
                                    </span>
                                  )}
                                  {total.label[locale]}:{" "}
                                  <span className="font-mono tabular-nums" dir="ltr">
                                    {total.amount}
                                  </span>
                                </th>
                              )}
                            </tr>
                          ))}
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}

                {/* reconciliation assertion footer (PASS badges / ids) */}
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-gray-600">{d.reportWorkspaceAssertions}:</p>
                  {result.assertions.length === 0 ? (
                    <span className="text-xs text-gray-500">—</span>
                  ) : (
                    result.assertions.map((assertion) => (
                      <Chip
                        key={assertion.id}
                        tone={assertion.status === "PASS" ? "success" : "danger"}
                      >
                        <span className="font-mono" dir="ltr">
                          {assertion.id}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span dir="ltr">{assertion.status}</span>
                      </Chip>
                    ))
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* run history — clicking a SUCCEEDED row loads its stored result */}
      <Card
        title={d.reportWorkspaceRunHistory}
        actions={
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "history"}
            onClick={() => void refreshRuns()}
          >
            {d.reportWorkspaceRefresh}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "reportKey",
              header: activeLocaleHeader(d.reportWorkspaceColReport),
              accessor: (row) => row.reportKey,
              mono: true,
              sortable: true,
            },
            {
              id: "status",
              header: activeLocaleHeader(d.reportWorkspaceStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Chip tone={runStatusTone(row.status)}>{runStatusLabel(d, row.status)}</Chip>
              ),
            },
            {
              id: "assertion",
              header: activeLocaleHeader(d.reportWorkspaceAssertions),
              accessor: (row) => row.assertionStatus ?? "",
              render: (row) =>
                row.assertionStatus === null ? (
                  <span className="text-gray-400">—</span>
                ) : (
                  <Chip tone={row.assertionStatus === "PASS" ? "success" : "danger"}>
                    <span dir="ltr">{row.assertionStatus}</span>
                  </Chip>
                ),
            },
            {
              id: "duration",
              header: activeLocaleHeader(d.reportWorkspaceDuration),
              accessor: (row) => String(row.durationMs ?? 0),
              numeric: true,
              sortable: true,
              render: (row) =>
                row.durationMs === null ? (
                  <span className="text-gray-400">—</span>
                ) : (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {`${row.durationMs}ms`}
                  </span>
                ),
            },
            {
              id: "createdAt",
              header: activeLocaleHeader(d.importJobsColCreated),
              accessor: (row) => row.createdAt,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.createdAt}
                </span>
              ),
            },
          ]}
          rows={[...runs]}
          rowKey={(row) => row.runId}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row: ReportRunSummary) => {
                void openRun(row);
              },
            },
          ]}
          empty={{ title: d.reportWorkspaceNoRuns }}
        />
      </Card>

      {/* print preview — the same HTML the server renderer prints */}
      <Dialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title={d.reportWorkspacePrintPreview}
        size="lg"
      >
        {printHtml !== null ? (
          <iframe
            srcDoc={printHtml}
            title={d.reportWorkspacePrintPreview}
            className="h-[70vh] w-full rounded-md border border-subtle bg-white"
          />
        ) : (
          <p className="text-sm text-gray-600">{d.reportWorkspaceEmpty}</p>
        )}
      </Dialog>
    </div>
  );
}
