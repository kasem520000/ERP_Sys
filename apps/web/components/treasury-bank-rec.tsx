"use client";

/**
 * T14-UI (PHASE-008) — bank reconciliation wizard (wizard archetype): step 1
 * imports a statement (account + adapter + file read as base64 client-side
 * + optional period/mapping fields), the statements list selects a working
 * statement, and the workspace drives BR-022: statement lines with match
 * state, auto-match, manual match/unmatch against the account's unmatched
 * movements, the unmatched-aging panel (two aged lists), reconcile (locks
 * the period), and the INV-019 on-demand cash reconciliation check.
 */
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Input,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AgedCashMovementRow,
  CashAccountRow,
  ImportAdapterRow,
  StatementLineRow,
  StatementRow,
  TreasuryCashCheckResult,
  UnmatchedAgingData,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedMatchMode,
  localizedStatementStatus,
  localizedTreasuryError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Browser file → base64 (without the data: prefix). */
function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unexpected file result"));
        return;
      }
      const separator = result.indexOf(",");
      resolve(separator === -1 ? result : result.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

export function TreasuryBankRec({
  locale,
  cashAccounts,
  adapters,
  initialStatements,
}: {
  locale: Locale;
  cashAccounts: readonly CashAccountRow[];
  adapters: readonly ImportAdapterRow[];
  initialStatements: readonly StatementRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [statements, setStatements] = useState<readonly StatementRow[]>(initialStatements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<readonly StatementLineRow[]>([]);
  const [aging, setAging] = useState<UnmatchedAgingData | null>(null);
  const [checkResult, setCheckResult] = useState<TreasuryCashCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Import form state.
  const [importAccountId, setImportAccountId] = useState("");
  const [adapterId, setAdapterId] = useState(adapters[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [mappingDate, setMappingDate] = useState("");
  const [mappingAmount, setMappingAmount] = useState("");
  const [mappingReference, setMappingReference] = useState("");
  const [mappingDescription, setMappingDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Aging + check state.
  const [agingAsOf, setAgingAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [checkAsOf, setCheckAsOf] = useState(new Date().toISOString().slice(0, 10));

  // Manual-match state (one line at a time).
  const [matchLineId, setMatchLineId] = useState<string | null>(null);
  const [matchMovementId, setMatchMovementId] = useState("");

  const selected = statements.find((row) => row.id === selectedId) ?? null;

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of cashAccounts) {
      map.set(account.id, localizedName(account.name, account.nameAr, locale));
    }
    return map;
  }, [cashAccounts, locale]);

  async function reloadStatements(): Promise<readonly StatementRow[]> {
    const refreshed = await bffFetch<readonly StatementRow[]>("treasury/bank-statements");
    if (refreshed.ok) {
      setStatements(refreshed.data);
      return refreshed.data;
    }
    return statements;
  }

  async function selectStatement(id: string): Promise<void> {
    setSelectedId(id);
    setMatchLineId(null);
    setError(null);
    setBusy("lines");
    const loaded = await bffFetch<readonly StatementLineRow[]>(`treasury/bank-statements/${id}/lines`);
    setBusy(null);
    if (!loaded.ok) {
      setError(localizedTreasuryError(d, loaded.error, loaded.retryAfterSeconds));
      return;
    }
    setLines(loaded.data);
    setAging(null);
  }

  async function importStatement(): Promise<void> {
    setError(null);
    setNotice(null);
    if (importAccountId === "" || file === null) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("import");
    const contentBase64 = await readFileBase64(file);
    const imported = await bffFetch<{ statement: StatementRow; idempotentReplay: boolean }>(
      "treasury/bank-statements/import",
      {
        method: "POST",
        body: {
          cashAccountId: importAccountId,
          fileName: file.name,
          contentBase64,
          periodStart: periodStart === "" ? undefined : periodStart,
          periodEnd: periodEnd === "" ? undefined : periodEnd,
          adapterId: adapterId === "" ? undefined : adapterId,
          mapping:
            mappingDate === "" && mappingAmount === "" && mappingReference === "" && mappingDescription === ""
              ? undefined
              : {
                  date: mappingDate === "" ? undefined : mappingDate,
                  amount: mappingAmount === "" ? undefined : mappingAmount,
                  reference: mappingReference === "" ? undefined : mappingReference,
                  description: mappingDescription === "" ? undefined : mappingDescription,
                },
        },
      },
    );
    setBusy(null);
    if (!imported.ok) {
      setError(localizedTreasuryError(d, imported.error, imported.retryAfterSeconds));
      return;
    }
    await reloadStatements();
    setSelectedId(imported.data.statement.id);
    setFile(null);
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = "";
    }
    setPeriodStart("");
    setPeriodEnd("");
    setMappingDate("");
    setMappingAmount("");
    setMappingReference("");
    setMappingDescription("");
    setNotice(d.treasuryBankRecImportedToast);
    await selectStatement(imported.data.statement.id);
  }

  async function autoMatch(): Promise<void> {
    if (selectedId === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("auto");
    const matched = await bffFetch<{ matched: number }>(
      `treasury/bank-statements/${selectedId}/auto-match`,
      { method: "POST", body: {} },
    );
    if (!matched.ok) {
      setBusy(null);
      setError(localizedTreasuryError(d, matched.error, matched.retryAfterSeconds));
      return;
    }
    setNotice(formatMessage(d.treasuryBankRecAutoMatchToast, { count: matched.data.matched }));
    await selectStatement(selectedId);
    setBusy(null);
  }

  async function applyMatch(lineId: string, movementId: string | null): Promise<void> {
    if (selectedId === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(lineId);
    const matched = await bffFetch<{ matched: boolean }>(
      `treasury/bank-statements/${selectedId}/match`,
      { method: "POST", body: { lineId, movementId } },
    );
    setBusy(null);
    if (!matched.ok) {
      setError(localizedTreasuryError(d, matched.error, matched.retryAfterSeconds));
      return;
    }
    setNotice(d.treasuryBankRecMatchedToast);
    setMatchLineId(null);
    setMatchMovementId("");
    await selectStatement(selectedId);
  }

  async function reconcile(): Promise<void> {
    if (selectedId === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("reconcile");
    const reconciled = await bffFetch<StatementRow>(`treasury/bank-statements/${selectedId}/reconcile`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!reconciled.ok) {
      setError(localizedTreasuryError(d, reconciled.error, reconciled.retryAfterSeconds));
      return;
    }
    setStatements((current) => current.map((row) => (row.id === selectedId ? reconciled.data : row)));
    setNotice(d.treasuryBankRecReconciledToast);
  }

  async function loadAging(): Promise<void> {
    if (selected === null) {
      return;
    }
    setError(null);
    setBusy("aging");
    const params = new URLSearchParams({ cashAccountId: selected.cashAccountId });
    if (agingAsOf !== "") {
      params.set("asOf", agingAsOf);
    }
    const loaded = await bffFetch<UnmatchedAgingData>(`treasury/unmatched-aging?${params.toString()}`);
    setBusy(null);
    if (!loaded.ok) {
      setError(localizedTreasuryError(d, loaded.error, loaded.retryAfterSeconds));
      return;
    }
    setAging(loaded.data);
  }

  async function runCashCheck(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("check");
    const result = await bffFetch<TreasuryCashCheckResult>("treasury/reconciliation/cash-check", {
      method: "POST",
      body: { asOf: checkAsOf },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTreasuryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCheckResult(result.data);
  }

  const unmatchedMovementOptions = useMemo(() => {
    const source = aging?.unmatchedMovements ?? [];
    return source.map((movement) => ({
      value: movement.id,
      label: `${movement.valueDate} · ${movement.amount} ${movement.currencyCode} · ${movement.sourceType}`,
    }));
  }, [aging]);

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.treasuryBankRecImportTitle} description={d.treasuryBankRecFileHint}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label={d.treasuryDocCashAccount}
            value={importAccountId}
            onValueChange={setImportAccountId}
            placeholder="—"
            options={cashAccounts.map((account) => ({
              value: account.id,
              label: `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`,
            }))}
            required
          />
          <Select
            label={d.treasuryBankRecAdapter}
            value={adapterId}
            onValueChange={setAdapterId}
            placeholder="—"
            options={adapters.map((adapter) => ({
              value: adapter.id,
              label: `${locale === "ar" ? adapter.label.ar : adapter.label.en} (${adapter.extensions.join(", ")})`,
            }))}
            required
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="treasury-bank-rec-file" className="text-sm font-medium text-gray-700">
              {d.treasuryBankRecFile}
            </label>
            <input
              id="treasury-bank-rec-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.xlsx"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const picked = event.target.files !== null ? event.target.files[0] : undefined;
                setFile(picked ?? null);
              }}
              className="w-full rounded-md border border-default bg-surface-card px-3 py-2 text-sm text-gray-900 outline-none hover:border-strong focus:border-primary-600"
            />
          </div>
          <Input
            label={d.treasuryBankRecPeriodStart}
            value={periodStart}
            onValueChange={setPeriodStart}
            mono
            bidiIsolate
            placeholder="YYYY-MM-DD"
          />
          <Input
            label={d.treasuryBankRecPeriodEnd}
            value={periodEnd}
            onValueChange={setPeriodEnd}
            mono
            bidiIsolate
            placeholder="YYYY-MM-DD"
          />
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-gray-700">{d.treasuryBankRecMappingHint}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label={d.treasuryBankRecMappingDate} value={mappingDate} onValueChange={setMappingDate} />
            <Input label={d.treasuryBankRecMappingAmount} value={mappingAmount} onValueChange={setMappingAmount} />
            <Input
              label={d.treasuryBankRecMappingReference}
              value={mappingReference}
              onValueChange={setMappingReference}
            />
            <Input
              label={d.treasuryBankRecMappingDescription}
              value={mappingDescription}
              onValueChange={setMappingDescription}
            />
          </div>
        </details>
        <Button
          variant="primary"
          onClick={() => void importStatement()}
          loading={busy === "import"}
          disabled={importAccountId === "" || file === null}
          className="mt-3 self-start"
        >
          {d.treasuryBankRecImportBtn}
        </Button>
      </Card>

      <Card title={d.treasuryBankRecStatementsTitle}>
        <DataTable
          columns={[
            {
              id: "file",
              header: activeLocaleHeader(d.treasuryBankRecColFile),
              accessor: (row) => row.fileName,
              sortable: true,
              render: (row) => (
                <span className="max-w-[16rem] truncate font-mono text-xs" dir="ltr">{row.fileName}</span>
              ),
            },
            {
              id: "account",
              header: activeLocaleHeader(d.treasuryDocCashAccount),
              accessor: (row) => accountNameById.get(row.cashAccountId) ?? row.cashAccountId,
            },
            {
              id: "period",
              header: activeLocaleHeader(d.treasuryBankRecColPeriod),
              accessor: (row) => `${row.periodStart}…${row.periodEnd}`,
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.periodStart} → {row.periodEnd}
                </span>
              ),
            },
            {
              id: "lines",
              header: activeLocaleHeader(d.treasuryBankRecColLines),
              accessor: (row) => String(row.lineCount),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">{row.lineCount}</span>
              ),
            },
            {
              id: "importedAt",
              header: activeLocaleHeader(d.treasuryBankRecColImportedAt),
              accessor: (row) => row.importedAt,
              render: (row) => formatDateTime(row.importedAt, locale),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "RECONCILED" ? "primary" : "neutral"}>
                  {localizedStatementStatus(d, row.status)}
                </Badge>
              ),
            },
          ]}
          rows={[...statements]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "work",
              label: d.commonOpen,
              onSelect: (row) => void selectStatement(row.id),
            },
          ]}
          empty={{ title: d.treasuryBankRecEmpty }}
        />
      </Card>

      {selected === null ? (
        <InfoNotice>{d.treasuryBankRecSelectStatement}</InfoNotice>
      ) : (
        <>
          <Card
            title={d.treasuryBankRecLinesTitle}
            description={`${selected.fileName} · ${localizedStatementStatus(d, selected.status)}`}
            actions={
              selected.status === "IMPORTED" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void autoMatch()} loading={busy === "auto"}>
                    {d.treasuryBankRecAutoMatchBtn}
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => void reconcile()} loading={busy === "reconcile"}>
                    {d.treasuryBankRecReconcileBtn}
                  </Button>
                </div>
              ) : undefined
            }
          >
            <p className="mb-2 text-xs text-muted-foreground">{d.treasuryBankRecReconcileHint}</p>
            <DataTable
              columns={[
                {
                  id: "lineNo",
                  header: activeLocaleHeader(d.treasuryBankRecColLineNo),
                  accessor: (row) => String(row.lineNo),
                  numeric: true,
                  sortable: true,
                  render: (row) => (
                    <span className="font-mono tabular-nums" dir="ltr">{row.lineNo}</span>
                  ),
                },
                {
                  id: "date",
                  header: activeLocaleHeader(d.treasuryColValueDate),
                  accessor: (row) => row.lineDate,
                  mono: true,
                  sortable: true,
                  render: (row) => <span className="font-mono text-sm" dir="ltr">{row.lineDate}</span>,
                },
                {
                  id: "amount",
                  header: activeLocaleHeader(d.treasuryColAmount),
                  accessor: (row) => row.amount,
                  numeric: true,
                  sortable: true,
                  render: (row) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(row.amount, 2)}
                    </span>
                  ),
                },
                {
                  id: "reference",
                  header: activeLocaleHeader(d.treasuryDocReference),
                  accessor: (row) => row.reference ?? "",
                  render: (row) =>
                    row.reference === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="max-w-[10rem] truncate font-mono text-xs" dir="ltr">{row.reference}</span>
                    ),
                },
                {
                  id: "description",
                  header: activeLocaleHeader(d.treasuryColMemo),
                  accessor: (row) => row.description ?? "",
                  render: (row) => (
                    <span className="max-w-[18rem] truncate">{row.description ?? "—"}</span>
                  ),
                },
                {
                  id: "match",
                  header: activeLocaleHeader(d.treasuryBankRecColMatchState),
                  accessor: (row) => row.matchMode ?? "",
                  render: (row) => (
                    <Badge tone={row.matchedMovementId !== null ? "primary" : "neutral"}>
                      {localizedMatchMode(d, row.matchMode)}
                    </Badge>
                  ),
                },
              ]}
              rows={[...lines]}
              rowKey={(row) => row.id}
              rowActions={
                selected.status === "IMPORTED"
                  ? [
                      {
                        id: "match",
                        label: d.treasuryBankRecManualMatch,
                        onSelect: (row: StatementLineRow) => {
                          setMatchMovementId("");
                          setMatchLineId(row.id);
                        },
                      },
                      {
                        id: "unmatch",
                        label: d.treasuryBankRecUnmatchBtn,
                        onSelect: (row: StatementLineRow) => void applyMatch(row.id, null),
                      },
                    ]
                  : undefined
              }
              empty={{ title: d.treasuryBankRecEmpty }}
            />
          </Card>

          {matchLineId !== null && (
            <Card title={d.treasuryBankRecManualMatch}>
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">{d.treasuryBankRecAgingTitle}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-56">
                    <Input
                      label={d.treasuryBankRecAgingAsOf}
                      value={agingAsOf}
                      onValueChange={setAgingAsOf}
                      mono
                      bidiIsolate
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                  <Button variant="secondary" onClick={() => void loadAging()} loading={busy === "aging"}>
                    {d.treasuryBankRecLoadAgingBtn}
                  </Button>
                </div>
                <Select
                  label={d.treasuryBankRecMatchMovement}
                  value={matchMovementId}
                  onValueChange={setMatchMovementId}
                  placeholder="—"
                  options={unmatchedMovementOptions}
                  required
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => void applyMatch(matchLineId, matchMovementId)}
                    loading={busy === matchLineId}
                    disabled={matchMovementId === ""}
                  >
                    {d.treasuryBankRecManualMatch}
                  </Button>
                  <Button variant="ghost" onClick={() => setMatchLineId(null)}>
                    {d.commonCancel}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <Card
            title={d.treasuryBankRecAgingTitle}
            actions={
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-44">
                  <Input
                    label={d.treasuryBankRecAgingAsOf}
                    value={agingAsOf}
                    onValueChange={setAgingAsOf}
                    mono
                    bidiIsolate
                    placeholder="YYYY-MM-DD"
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={() => void loadAging()} loading={busy === "aging"}>
                  {d.treasuryBankRecLoadAgingBtn}
                </Button>
              </div>
            }
          >
            {aging === null ? (
              <p className="text-sm text-muted-foreground">{d.treasuryBankRecLoadAgingBtn} —</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{d.treasuryBankRecUnmatchedLinesTitle}</h3>
                  <DataTable
                    columns={[
                      {
                        id: "lineNo",
                        header: activeLocaleHeader(d.treasuryBankRecColLineNo),
                        accessor: (row) => String(row.lineNo),
                        numeric: true,
                        render: (row) => (
                          <span className="font-mono tabular-nums" dir="ltr">{row.lineNo}</span>
                        ),
                      },
                      {
                        id: "date",
                        header: activeLocaleHeader(d.treasuryColValueDate),
                        accessor: (row) => row.lineDate,
                        render: (row) => <span className="font-mono text-sm" dir="ltr">{row.lineDate}</span>,
                      },
                      {
                        id: "amount",
                        header: activeLocaleHeader(d.treasuryColAmount),
                        accessor: (row) => row.amount,
                        numeric: true,
                        render: (row) => (
                          <span className="font-mono tabular-nums" dir="ltr">
                            {formatMoneyDisplay(row.amount, 2)}
                          </span>
                        ),
                      },
                      {
                        id: "age",
                        header: activeLocaleHeader(d.treasuryBankRecColAgeDays),
                        accessor: (row) => String(row.ageDays ?? ""),
                        numeric: true,
                        render: (row) => (
                          <span className="font-mono tabular-nums" dir="ltr">{row.ageDays ?? "—"}</span>
                        ),
                      },
                    ]}
                    rows={[...aging.unmatchedLines]}
                    rowKey={(row) => row.id}
                    empty={{ title: d.treasuryBankRecMatched }}
                  />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{d.treasuryBankRecUnmatchedMovementsTitle}</h3>
                  <DataTable
                    columns={[
                      {
                        id: "date",
                        header: activeLocaleHeader(d.treasuryColValueDate),
                        accessor: (row: AgedCashMovementRow) => row.valueDate,
                        render: (row) => <span className="font-mono text-sm" dir="ltr">{row.valueDate}</span>,
                      },
                      {
                        id: "direction",
                        header: activeLocaleHeader(d.accountingColDirection),
                        accessor: (row: AgedCashMovementRow) => row.direction,
                        render: (row: AgedCashMovementRow) => (
                          <Badge tone={row.direction === "IN" ? "primary" : "neutral"}>
                            {row.direction === "IN" ? d.treasuryColDirectionIn : d.treasuryColDirectionOut}
                          </Badge>
                        ),
                      },
                      {
                        id: "amount",
                        header: activeLocaleHeader(d.treasuryColAmount),
                        accessor: (row: AgedCashMovementRow) => row.amount,
                        numeric: true,
                        render: (row: AgedCashMovementRow) => (
                          <span className="font-mono tabular-nums" dir="ltr">
                            {formatMoneyDisplay(row.amount, 2)}{" "}
                            <span className="text-xs text-muted-foreground">{row.currencyCode}</span>
                          </span>
                        ),
                      },
                      {
                        id: "source",
                        header: activeLocaleHeader(d.treasuryColSource),
                        accessor: (row: AgedCashMovementRow) => row.sourceType,
                        render: (row: AgedCashMovementRow) => (
                          <span className="font-mono text-xs" dir="ltr">{row.sourceType}</span>
                        ),
                      },
                      {
                        id: "age",
                        header: activeLocaleHeader(d.treasuryBankRecColAgeDays),
                        accessor: (row: AgedCashMovementRow) => String(row.ageDays ?? ""),
                        numeric: true,
                        render: (row: AgedCashMovementRow) => (
                          <span className="font-mono tabular-nums" dir="ltr">{row.ageDays ?? "—"}</span>
                        ),
                      },
                    ]}
                    rows={[...aging.unmatchedMovements]}
                    rowKey={(row) => row.id}
                    empty={{ title: d.treasuryBankRecMatched }}
                  />
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      <Card
        title={d.treasuryBankRecCashCheckTitle}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <Input
                label={d.treasuryBankRecCashCheckAsOf}
                value={checkAsOf}
                onValueChange={setCheckAsOf}
                mono
                bidiIsolate
                placeholder="YYYY-MM-DD"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={() => void runCashCheck()} loading={busy === "check"}>
              {d.treasuryBankRecCashCheckBtn}
            </Button>
          </div>
        }
      >
        {checkResult === null ? (
          <p className="text-sm text-muted-foreground">{d.treasuryBankRecCashCheckBtn} —</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Badge tone={checkResult.status === "OK" ? "primary" : "neutral"}>
              {checkResult.status === "OK" ? d.treasuryBankRecCashCheckOk : d.treasuryBankRecCashCheckBroken}
            </Badge>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{d.treasuryBankRecColControlBalance}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{checkResult.controlBalance}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{d.treasuryBankRecColSubledgerBalance}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{checkResult.subledgerBalance}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{d.treasuryBankRecColDiffCount}</dt>
                <dd className="font-mono tabular-nums" dir="ltr">{checkResult.diffCount}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{d.treasuryBankRecAgingAsOf}</dt>
                <dd className="font-mono text-sm" dir="ltr">{checkAsOf}</dd>
              </div>
            </dl>
          </div>
        )}
      </Card>
    </div>
  );
}
