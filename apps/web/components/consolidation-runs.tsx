"use client";

/**
 * PHASE-034 (T11) — the run Report Page (PAGE_ARCHETYPES §7): the create-run
 * form (group + fiscal period — one run per pair, created QUEUED then
 * executed), the runs register (group/status filters reload through the BFF —
 * the API's own filter set; status badges QUEUED/RUNNING/COMPLETED/FAILED
 * with the typed errorCode), the synchronous execute action, and the
 * COMPLETED snapshot viewer: the members table (ownership percent + the
 * dated appliedRates — INV-008), the consolidated lines table (DR/CR/net —
 * string-safe exact math, never floats), the frozen elimination effects and
 * the INV-026 assertion badge (PASS green / FAIL red with the compared
 * values). The group-view disclaimer rides every snapshot (ADR-0018).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, Select, formatMoneyDisplay, type DataTableSort } from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  ConsolidationRunRow,
  ConsolidationRunSnapshotView,
  FiscalPeriodRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { subtractExact } from "../lib/exact-money";
import { formatMessage, localizedName, localizedApiError } from "../lib/messages";
import { runStatusLabel } from "./consolidation-groups";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export interface ConsolidationRunsInitialFilters {
  groupId: string;
  status: string;
}

const EMPTY_FILTERS: ConsolidationRunsInitialFilters = { groupId: "", status: "" };

/** Run status chip — COMPLETED green, FAILED red, otherwise neutral (the
 * sales-ar SubledgerTieChip token pattern; Badge ships neutral/primary only). */
function RunStatusBadge({ d, status }: { d: Dictionary; status: string }): JSX.Element {
  const style =
    status === "COMPLETED"
      ? "border-success-border bg-success-bg text-success-text"
      : status === "FAILED"
        ? "border-danger-border bg-danger-bg text-danger-text"
        : "border-subtle bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${style}`}>
      {runStatusLabel(d, status)}
    </span>
  );
}

export function ConsolidationRuns({
  locale,
  initialRuns,
  groups,
  periods,
  initialFilters = EMPTY_FILTERS,
}: {
  locale: Locale;
  initialRuns: readonly ConsolidationRunRow[];
  groups: readonly ConsolidationGroupRow[];
  periods: readonly FiscalPeriodRow[];
  initialFilters?: ConsolidationRunsInitialFilters;
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly ConsolidationRunRow[]>(initialRuns);
  const [groupId, setGroupId] = useState(initialFilters.groupId);
  const [status, setStatus] = useState(initialFilters.status);
  const [createGroupId, setCreateGroupId] = useState(initialFilters.groupId);
  const [createPeriodId, setCreatePeriodId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const [snapshot, setSnapshot] = useState<ConsolidationRunSnapshotView | null>(null);
  const runRef = useRef(0);
  const skipInitialLoad = useRef(initialFilters.groupId === "" && initialFilters.status === "");

  const groupOf = useCallback(
    (id: string): ConsolidationGroupRow | undefined => groups.find((group) => group.id === id),
    [groups],
  );

  const periodLabel = useCallback(
    (id: string): string => {
      const period = periods.find((row) => row.id === id);
      return period === undefined ? id.slice(0, 8) : period.name;
    },
    [periods],
  );

  const loadPage = useCallback(async (): Promise<void> => {
    const run = runRef.current + 1;
    runRef.current = run;
    setBusy("list");
    setError(null);
    const search = new URLSearchParams();
    if (groupId !== "") {
      search.set("groupId", groupId);
    }
    if (status !== "") {
      search.set("status", status);
    }
    const path =
      search.toString() === "" ? "consolidation/runs" : `consolidation/runs?${search.toString()}`;
    const result = await bffFetch<readonly ConsolidationRunRow[]>(path);
    if (run !== runRef.current) {
      return; // stale response — a newer filter change superseded it
    }
    setBusy(null);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, groupId, status]);

  // Filter changes reload the register. The server page already fetched the
  // initial rows — the first run is a no-op unless a deep link pre-filter
  // arrived (then the page fetched with those filters and no refetch fires).
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage();
  }, [loadPage]);

  async function createRun(): Promise<void> {
    setError(null);
    setInfo(null);
    if (createGroupId === "" || createPeriodId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    const created = await bffFetch<ConsolidationRunRow>("consolidation/runs", {
      method: "POST",
      body: { groupId: createGroupId, fiscalPeriodId: createPeriodId },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedApiError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setNotice(d.consolidationRunCreatedToast);
    await loadPage();
  }

  async function executeRun(row: ConsolidationRunRow): Promise<void> {
    setError(null);
    setInfo(null);
    setBusy(`execute-${row.id}`);
    const executed = await bffFetch<ConsolidationRunRow>(`consolidation/runs/${row.id}/execute`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!executed.ok) {
      setError(localizedApiError(d, executed.error, executed.retryAfterSeconds));
      return;
    }
    setNotice(formatMessage(d.consolidationRunExecutedToast, { status: runStatusLabel(d, executed.data.status) }));
    await loadPage();
    if (executed.data.status === "COMPLETED") {
      await openSnapshot(executed.data.id);
    }
  }

  async function openSnapshot(id: string): Promise<void> {
    setError(null);
    setInfo(null);
    setBusy(`snapshot-${id}`);
    const fetched = await bffFetch<ConsolidationRunSnapshotView>(`consolidation/runs/${id}/snapshots`);
    setBusy(null);
    if (!fetched.ok) {
      setError(localizedApiError(d, fetched.error, fetched.retryAfterSeconds));
      return;
    }
    // The snapshot jsonb ships only on COMPLETED runs — a QUEUED/RUNNING/FAILED
    // fetch never renders a silent blank; the honest pending notice fires.
    if (fetched.data.snapshot === null) {
      setSnapshot(null);
      setInfo(d.consolidationSnapshotPending);
      return;
    }
    setSnapshot(fetched.data);
  }

  const snap = snapshot?.snapshot ?? null;
  const snapCurrency = snap?.group.baseCurrency ?? "";
  const periodOptions = useMemo(
    () =>
      periods.map((period) => ({
        value: period.id,
        label: `${period.name} · ${period.startDate} → ${period.endDate}`,
      })),
    [periods],
  );

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {info !== null && <InfoNotice>{info}</InfoNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.consolidationNewRun}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            id="consolidation-run-group"
            label={d.consolidationColGroup}
            value={createGroupId}
            onValueChange={setCreateGroupId}
            options={[
              { value: "", label: "—" },
              ...groups
                .filter((group) => group.status === "ACTIVE")
                .map((group) => ({
                  value: group.id,
                  label: `${localizedName(group.name, group.nameAr, locale)} · ${group.baseCurrency}`,
                })),
            ]}
            required
          />
          <Select
            id="consolidation-run-period"
            label={d.consolidationFiscalPeriod}
            value={createPeriodId}
            onValueChange={setCreatePeriodId}
            options={[{ value: "", label: "—" }, ...periodOptions]}
            required
          />
          <div className="flex items-end">
            <Button variant="primary" onClick={() => void createRun()} loading={busy === "create"}>
              {d.consolidationRunCreateButton}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-600">{d.consolidationRunCreateHint}</p>
      </Card>

      <Card title={d.consolidationRunsNav}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Select
              id="consolidation-runs-filter-group"
              label={d.consolidationColGroup}
              value={groupId}
              onValueChange={(value) => {
                setGroupId(value);
                setCreateGroupId(value);
              }}
              options={[
                { value: "", label: d.kindFilterAll },
                ...groups.map((group) => ({
                  value: group.id,
                  label: localizedName(group.name, group.nameAr, locale),
                })),
              ]}
            />
          </div>
          <div className="w-44">
            <Select
              id="consolidation-runs-filter-status"
              label={d.colStatus}
              value={status}
              onValueChange={setStatus}
              options={[
                { value: "", label: d.kindFilterAll },
                { value: "QUEUED", label: d.consolidationRunStatusQueued },
                { value: "RUNNING", label: d.consolidationRunStatusRunning },
                { value: "COMPLETED", label: d.consolidationRunStatusCompleted },
                { value: "FAILED", label: d.consolidationRunStatusFailed },
              ]}
            />
          </div>
        </div>
        <div className="mt-3">
          <DataTable
            columns={[
              {
                id: "group",
                header: activeLocaleHeader(d.consolidationColGroup),
                accessor: (row) => {
                  const group = groupOf(row.groupId);
                  return group === undefined ? row.groupId.slice(0, 8) : localizedName(group.name, group.nameAr, locale);
                },
                render: (row) => {
                  const group = groupOf(row.groupId);
                  return (
                    <span className="truncate">
                      {group === undefined ? (
                        <span className="font-mono text-xs" dir="ltr">
                          {row.groupId.slice(0, 8)}
                        </span>
                      ) : (
                        localizedName(group.name, group.nameAr, locale)
                      )}
                    </span>
                  );
                },
              },
              {
                id: "period",
                header: activeLocaleHeader(d.consolidationFiscalPeriod),
                accessor: (row) => periodLabel(row.fiscalPeriodId),
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {periodLabel(row.fiscalPeriodId)}
                  </span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.colStatus),
                accessor: (row) => row.status,
                render: (row) => <RunStatusBadge d={d} status={row.status} />,
              },
              {
                id: "errorCode",
                header: activeLocaleHeader(d.consolidationRunErrorCodeCol),
                accessor: (row) => row.errorCode ?? "",
                render: (row) =>
                  row.errorCode === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-xs" dir="ltr">
                      {row.errorCode}
                    </span>
                  ),
              },
              {
                id: "created",
                header: activeLocaleHeader(d.consolidationColCreated),
                accessor: (row) => row.createdAt,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                ),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            sort={sort}
            onSortChange={setSort}
            loading={busy === "list" && rows.length === 0}
            rowActions={[
              {
                id: "execute",
                label: d.consolidationRunExecuteAction,
                onSelect: (row) => void executeRun(row),
              },
              {
                id: "snapshot",
                label: d.commonOpen,
                onSelect: (row) => void openSnapshot(row.id),
              },
            ]}
            empty={{ title: d.consolidationRunsEmpty }}
          />
        </div>
        <p className="mt-3 text-xs text-gray-600">{d.consolidationDisclaimer}</p>
      </Card>

      {snapshot !== null && snap !== null && (
        <Card
          title={d.consolidationRunSnapshotCard}
          description={`${localizedName(snap.group.name, snap.group.nameAr, locale)} · ${periodLabel(snap.fiscalPeriodId)}`}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${
                  snap.inv026.status === "PASS"
                    ? "border-success-border bg-success-bg text-success-text"
                    : "border-danger-border bg-danger-bg text-danger-text"
                }`}
              >
                {snap.inv026.status === "PASS" ? d.consolidationInv026Pass : d.consolidationInv026Fail}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSnapshot(null)}>
                {d.shellClose}
              </Button>
            </span>
          }
        >
          <p className="text-xs text-gray-600">
            {formatMessage(d.consolidationInv026Compared, {
              left: formatMoneyDisplay(snap.inv026.compared.left, 2),
              right: formatMoneyDisplay(snap.inv026.compared.right, 2),
            })}
          </p>

          <h3 className="mt-4 text-sm font-semibold text-gray-900">
            {d.consolidationSnapshotMembersCard}
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.eliminationsLineMember}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.consolidationMemberOwnershipPercent}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.consolidationMemberIncludeFrom}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.consolidationGroupBaseCurrency}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.consolidationSnapshotColRates}
                  </th>
                </tr>
              </thead>
              <tbody>
                {snap.members.map((member) => (
                  <tr key={member.memberTenantId} className="border-b border-subtle/60">
                    <td className="px-2 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-mono text-xs" dir="ltr">
                          {member.memberTenantId.slice(0, 8)}
                        </span>
                        {member.memberName !== null && (
                          <span className="truncate text-xs text-gray-600">{member.memberName}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {member.ownershipPercent}%
                    </td>
                    <td className="px-2 py-2 font-mono text-sm" dir="ltr">
                      {member.includeFrom ?? "—"}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {member.baseCurrency}
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex flex-wrap gap-1">
                        {Object.entries(member.appliedRates).map(([code, rate]) => (
                          <span
                            key={code}
                            className="inline-flex items-center rounded-sm border border-subtle bg-surface-card px-1.5 py-0.5 font-mono text-xs"
                            dir="ltr"
                          >
                            {code} → {rate}
                          </span>
                        ))}
                        {Object.keys(member.appliedRates).length === 0 && (
                          <span className="text-gray-500">—</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-4 text-sm font-semibold text-gray-900">
            {d.consolidationSnapshotConsolidatedCard}
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.accountingAccount}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.consolidationSnapshotColType}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.accountingColDebit}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.accountingColCredit}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.consolidationSnapshotColNet}
                  </th>
                </tr>
              </thead>
              <tbody>
                {snap.consolidated.map((line) => (
                  <tr key={line.accountCode} className="border-b border-subtle/60">
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {line.accountCode}
                    </td>
                    <td className="px-2 py-2 text-xs">{line.accountType}</td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(line.amounts.debit, 2)}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(line.amounts.credit, 2)}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(subtractExact(line.amounts.debit, line.amounts.credit), 2)}{" "}
                      <span className="text-xs text-gray-500">{snapCurrency}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-4 text-sm font-semibold text-gray-900">
            {d.consolidationSnapshotEliminationsCard}
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.eliminationsColNo}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.accountingAccount}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.eliminationsLinePurpose}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.accountingColDebit}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.accountingColCredit}
                  </th>
                </tr>
              </thead>
              <tbody>
                {snap.eliminations.map((line) => (
                  <tr key={`${line.eliminationId}-${line.accountCode}`} className="border-b border-subtle/60">
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {line.eliminationNo ?? line.eliminationId.slice(0, 8)}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {line.accountCode}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {line.purposeKey ?? "—"}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(line.amounts.debit, 2)}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(line.amounts.credit, 2)}
                    </td>
                  </tr>
                ))}
                {snap.eliminations.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-sm text-gray-600">
                      {d.eliminationsEmpty}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-gray-600">{d.consolidationDisclaimer}</p>
        </Card>
      )}
    </div>
  );
}
