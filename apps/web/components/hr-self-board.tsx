"use client";

/**
 * PHASE-045 (T-14) — the employee self-service board (PAGE_ARCHETYPES
 * §2, the tabbed-workspace pattern): the OWN attendance calendar (a
 * window's derived days — status badges + the exact minute facts), the
 * OWN leave world (the requests register with the cancel-own-PENDING
 * decision, the create-own-request form, the exact-decimal balances
 * panel for a year), and the OWN read-only roster over a window. The
 * employee scope NEVER arrives from the UI — the API resolves it from
 * the session's identity bridge; an unlinked account renders the
 * honest not-linked state (the tabs never even load).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  Pagination,
  Select,
  Tabs,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AttendanceRecordRow,
  LeaveBalanceRow,
  LeaveRequestRow,
  LeaveTypeRow,
  RosterCellRow,
  SelfAttendanceRead,
  SelfEmployeeCard,
  SelfLeaveRequestsPage,
  SelfRosterPage,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedHrAttendanceStatus,
  localizedHrError,
  localizedHrLeaveStatus,
  localizedHrPunchSource,
  localizedHrRosterSource,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 25;
/** The API's self-service window cap (the derivation horizon — a
 * quarter; wider spans are a deliberate range change). */
const MAX_WINDOW_DAYS = 92;

type SelfTab = "attendance" | "leave" | "roster";

function minutes(value: number | null): string {
  return value === null ? "—" : `${value}`;
}

function windowDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

export function HrSelfBoard({
  locale,
  employee,
  today,
  initialAttendance,
  initialRequests,
  initialTypes,
  initialBalances,
  initialRoster,
}: {
  locale: Locale;
  employee: SelfEmployeeCard;
  /** Today (server-side UTC date) — the default windows' anchor. */
  today: string;
  initialAttendance: SelfAttendanceRead;
  initialRequests: SelfLeaveRequestsPage;
  initialTypes: readonly LeaveTypeRow[];
  initialBalances: readonly LeaveBalanceRow[];
  initialRoster: SelfRosterPage;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const year = Number(today.slice(0, 4));
  const employeeLabel = `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`;

  const tabItems = useMemo(
    () => [
      { value: "attendance" as const, label: d.hrSelfTabAttendance },
      { value: "leave" as const, label: d.hrSelfTabLeave },
      { value: "roster" as const, label: d.hrSelfTabRoster },
    ],
    [d],
  );
  const [tab, setTab] = useState<SelfTab>("attendance");

  // -- the attendance calendar (a window through the BFF) --------------------------
  const [attFrom, setAttFrom] = useState(initialAttendance.from);
  const [attTo, setAttTo] = useState(initialAttendance.to);
  const [attRows, setAttRows] = useState<readonly AttendanceRecordRow[]>(initialAttendance.rows);
  const [attBusy, setAttBusy] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);
  const [attSort, setAttSort] = useState<DataTableSort[]>([]);
  const attRunRef = useRef(0);

  const loadAttendance = useCallback(
    async (from: string, to: string): Promise<void> => {
      const run = attRunRef.current + 1;
      attRunRef.current = run;
      setAttBusy(true);
      setAttError(null);
      const search = new URLSearchParams({ from, to });
      const result = await bffFetch<SelfAttendanceRead>(`hr/self/attendance?${search.toString()}`);
      if (run !== attRunRef.current) {
        return; // stale response — a newer window superseded it
      }
      setAttBusy(false);
      if (!result.ok) {
        setAttError(localizedHrError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setAttRows(result.data.rows);
    },
    [d],
  );

  function applyAttendanceWindow(): void {
    if (!DATE_RE.test(attFrom) || !DATE_RE.test(attTo) || attTo < attFrom) {
      setAttError(d.budgetFormInvalid);
      return;
    }
    if (windowDays(attFrom, attTo) > MAX_WINDOW_DAYS) {
      setAttError(d.hrErrRosterInvalid);
      return;
    }
    void loadAttendance(attFrom, attTo);
  }

  const statusBadge = useCallback(
    (row: AttendanceRecordRow): JSX.Element => (
      <Badge tone={row.isException ? "primary" : "neutral"}>
        {localizedHrAttendanceStatus(d, row.derivedStatus)}
      </Badge>
    ),
    [d],
  );

  // -- the own leave requests (a year window + pagination) -------------------------
  const [reqFrom, setReqFrom] = useState(`${year}-01-01`);
  const [reqTo, setReqTo] = useState(`${year}-12-31`);
  const [reqPage, setReqPage] = useState(initialRequests.page);
  const [reqRows, setReqRows] = useState<readonly LeaveRequestRow[]>(initialRequests.rows);
  const [reqTotal, setReqTotal] = useState(initialRequests.total);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqSort, setReqSort] = useState<DataTableSort[]>([]);
  const reqRunRef = useRef(0);

  const loadRequests = useCallback(
    async (from: string, to: string, page: number): Promise<void> => {
      const run = reqRunRef.current + 1;
      reqRunRef.current = run;
      setReqBusy(true);
      setReqError(null);
      const search = new URLSearchParams({
        from,
        to,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const result = await bffFetch<SelfLeaveRequestsPage>(`hr/self/leave/requests?${search.toString()}`);
      if (run !== reqRunRef.current) {
        return;
      }
      setReqBusy(false);
      if (!result.ok) {
        setReqError(localizedHrError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setReqRows(result.data.rows);
      setReqTotal(result.data.total);
      setReqPage(result.data.page);
    },
    [d],
  );

  function applyRequestsWindow(): void {
    if (!DATE_RE.test(reqFrom) || !DATE_RE.test(reqTo) || reqTo < reqFrom) {
      setReqError(d.budgetFormInvalid);
      return;
    }
    void loadRequests(reqFrom, reqTo, 1);
  }

  const reqPages = reqTotal === 0 ? 1 : ((reqTotal + PAGE_SIZE - 1) / PAGE_SIZE) | 0;

  // -- the balances panel (a year) ---------------------------------------------------
  const [balYear, setBalYear] = useState(String(year));
  const [balRows, setBalRows] = useState<readonly LeaveBalanceRow[]>(initialBalances);
  const [balBusy, setBalBusy] = useState(false);
  const [balError, setBalError] = useState<string | null>(null);

  const loadBalances = useCallback(
    async (yearParam: string): Promise<void> => {
      setBalBusy(true);
      setBalError(null);
      const result = await bffFetch<readonly LeaveBalanceRow[]>(
        `hr/self/leave/balances?year=${yearParam}`,
      );
      setBalBusy(false);
      if (!result.ok) {
        setBalError(localizedHrError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setBalRows(result.data);
    },
    [d],
  );

  // -- the create-own-request form ----------------------------------------------------
  const [newType, setNewType] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  async function createRequest(): Promise<void> {
    setNewError(null);
    if (
      newType === "" ||
      !DATE_RE.test(newStart) ||
      !DATE_RE.test(newEnd) ||
      newEnd < newStart
    ) {
      setNewError(d.budgetFormInvalid);
      return;
    }
    setNewBusy(true);
    const result = await bffFetch<LeaveRequestRow>("hr/self/leave/requests", {
      method: "POST",
      body: {
        leaveTypeId: newType,
        startDate: newStart,
        endDate: newEnd,
        ...(newNote.trim() === "" ? {} : { note: newNote.trim() }),
      },
    });
    setNewBusy(false);
    if (!result.ok) {
      setNewError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.hrLeaveRequestCreated });
    setNewStart("");
    setNewEnd("");
    setNewNote("");
    await loadRequests(reqFrom, reqTo, 1);
  }

  // -- the cancel-own dialog (PENDING only — the one decision an employee owns) ------
  const [cancelTarget, setCancelTarget] = useState<LeaveRequestRow | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function cancelRequest(): Promise<void> {
    if (cancelTarget === null) {
      return;
    }
    setCancelError(null);
    setCancelBusy(true);
    const result = await bffFetch<LeaveRequestRow>(
      `hr/self/leave/requests/${cancelTarget.id}/cancel`,
      {
        method: "POST",
        body: cancelNote.trim() === "" ? {} : { note: cancelNote.trim() },
      },
    );
    setCancelBusy(false);
    if (!result.ok) {
      setCancelError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.hrSelfCancelledToast });
    setCancelTarget(null);
    setCancelNote("");
    await loadRequests(reqFrom, reqTo, reqPage);
  }

  // -- the own roster (read-only, a window) --------------------------------------------
  const [rosFrom, setRosFrom] = useState(initialRoster.from);
  const [rosTo, setRosTo] = useState(initialRoster.to);
  const [rosRows, setRosRows] = useState<readonly RosterCellRow[]>(initialRoster.rows);
  const [rosTotal, setRosTotal] = useState(initialRoster.total);
  const [rosPage, setRosPage] = useState(initialRoster.page);
  const [rosBusy, setRosBusy] = useState(false);
  const [rosError, setRosError] = useState<string | null>(null);
  const [rosSort, setRosSort] = useState<DataTableSort[]>([]);
  const rosRunRef = useRef(0);

  const loadRoster = useCallback(
    async (from: string, to: string, page: number): Promise<void> => {
      const run = rosRunRef.current + 1;
      rosRunRef.current = run;
      setRosBusy(true);
      setRosError(null);
      const search = new URLSearchParams({
        from,
        to,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const result = await bffFetch<SelfRosterPage>(`hr/self/roster?${search.toString()}`);
      if (run !== rosRunRef.current) {
        return;
      }
      setRosBusy(false);
      if (!result.ok) {
        setRosError(localizedHrError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setRosRows(result.data.rows);
      setRosTotal(result.data.total);
      setRosPage(result.data.page);
    },
    [d],
  );

  function applyRosterWindow(): void {
    if (!DATE_RE.test(rosFrom) || !DATE_RE.test(rosTo) || rosTo < rosFrom) {
      setRosError(d.budgetFormInvalid);
      return;
    }
    if (windowDays(rosFrom, rosTo) > MAX_WINDOW_DAYS) {
      setRosError(d.hrErrRosterInvalid);
      return;
    }
    void loadRoster(rosFrom, rosTo, 1);
  }

  const rosPages = rosTotal === 0 ? 1 : ((rosTotal + PAGE_SIZE - 1) / PAGE_SIZE) | 0;

  const yearOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let entry = 2020; entry <= year + 1; entry += 1) {
      out.push({ value: String(entry), label: String(entry) });
    }
    return out;
  }, [year]);

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.hrSelfTitle}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="neutral">{employeeLabel}</Badge>
          <span className="text-sm text-neutral-600">{d.hrSelfCalendarTitle}</span>
        </div>
      </Card>

      <Tabs items={tabItems} value={tab} onValueChange={(value) => setTab(value as SelfTab)}>
        {tab === "attendance" && (
          <div className="flex flex-col gap-4">
            <Card title={d.hrSelfCalendarTitle}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <DatePicker
                      id="hr-self-att-from"
                      locale={locale}
                      label={d.hrFilterFrom}
                      value={attFrom}
                      onSelect={setAttFrom}
                    />
                  </div>
                  <div className="w-44">
                    <DatePicker
                      id="hr-self-att-to"
                      locale={locale}
                      label={d.hrFilterTo}
                      value={attTo}
                      onSelect={setAttTo}
                    />
                  </div>
                  <Button onClick={applyAttendanceWindow} disabled={attBusy}>
                    {d.hrApplyBtn}
                  </Button>
                </div>
                {attError !== null && <ErrorNotice>{attError}</ErrorNotice>}
                <DataTable
                  columns={[
                    {
                      id: "date",
                      header: activeLocaleHeader(d.hrColDate),
                      accessor: (row) => row.workDate,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.workDate}
                        </span>
                      ),
                    },
                    {
                      id: "status",
                      header: activeLocaleHeader(d.hrColStatus),
                      accessor: (row) => row.derivedStatus ?? "—",
                      render: statusBadge,
                    },
                    {
                      id: "checkIn",
                      header: activeLocaleHeader(d.hrColCheckIn),
                      accessor: (row) => row.checkIn ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.checkIn ?? "—"}
                        </span>
                      ),
                    },
                    {
                      id: "checkOut",
                      header: activeLocaleHeader(d.hrColCheckOut),
                      accessor: (row) => row.checkOut ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.checkOut ?? "—"}
                        </span>
                      ),
                    },
                    {
                      id: "shift",
                      header: activeLocaleHeader(d.hrColShift),
                      accessor: (row) => row.shiftCode ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.shiftCode ?? "—"}
                        </span>
                      ),
                    },
                    {
                      id: "late",
                      header: activeLocaleHeader(d.hrColLate),
                      accessor: (row) => minutes(row.lateMinutes),
                      numeric: true,
                      render: (row) => (
                        <span
                          className={
                            row.lateMinutes !== null && row.lateMinutes > 0
                              ? "font-semibold text-danger-700"
                              : ""
                          }
                          dir="ltr"
                        >
                          {minutes(row.lateMinutes)}
                        </span>
                      ),
                    },
                    {
                      id: "earlyLeave",
                      header: activeLocaleHeader(d.hrColEarlyLeave),
                      accessor: (row) => minutes(row.earlyLeaveMinutes),
                      numeric: true,
                      render: (row) => <span dir="ltr">{minutes(row.earlyLeaveMinutes)}</span>,
                    },
                    {
                      id: "worked",
                      header: activeLocaleHeader(d.hrColWorked),
                      accessor: (row) => minutes(row.workedMinutes),
                      numeric: true,
                      render: (row) => <span dir="ltr">{minutes(row.workedMinutes)}</span>,
                    },
                    {
                      id: "overtime",
                      header: activeLocaleHeader(d.hrColOvertime),
                      accessor: (row) => minutes(row.overtimeMinutes),
                      numeric: true,
                      render: (row) => <span dir="ltr">{minutes(row.overtimeMinutes)}</span>,
                    },
                    {
                      id: "source",
                      header: activeLocaleHeader(d.hrColSource),
                      accessor: (row) => localizedHrPunchSource(d, row.source),
                      render: (row) => localizedHrPunchSource(d, row.source),
                    },
                  ]}
                  rows={[...attRows]}
                  rowKey={(row) => row.id}
                  sort={attSort}
                  onSortChange={setAttSort}
                  loading={attBusy}
                  empty={{ title: d.hrSelfEmpty }}
                />
              </div>
            </Card>
          </div>
        )}

        {tab === "leave" && (
          <div className="flex flex-col gap-4">
            <Card title={d.hrLeaveRequests}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <DatePicker
                      id="hr-self-req-from"
                      locale={locale}
                      label={d.hrFilterFrom}
                      value={reqFrom}
                      onSelect={setReqFrom}
                    />
                  </div>
                  <div className="w-44">
                    <DatePicker
                      id="hr-self-req-to"
                      locale={locale}
                      label={d.hrFilterTo}
                      value={reqTo}
                      onSelect={setReqTo}
                    />
                  </div>
                  <Button onClick={applyRequestsWindow} disabled={reqBusy}>
                    {d.hrApplyBtn}
                  </Button>
                </div>
                {reqError !== null && <ErrorNotice>{reqError}</ErrorNotice>}
                <DataTable
                  columns={[
                    {
                      id: "type",
                      header: activeLocaleHeader(d.hrLeaveTypeLabel),
                      accessor: (row) => row.leaveTypeCode,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.leaveTypeCode}
                        </span>
                      ),
                    },
                    {
                      id: "start",
                      header: activeLocaleHeader(d.hrLeaveStartDate),
                      accessor: (row) => row.startDate,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.startDate}
                        </span>
                      ),
                    },
                    {
                      id: "end",
                      header: activeLocaleHeader(d.hrLeaveEndDate),
                      accessor: (row) => row.endDate,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.endDate}
                        </span>
                      ),
                    },
                    {
                      id: "days",
                      header: activeLocaleHeader(d.hrColDays),
                      accessor: (row) => row.days,
                      numeric: true,
                      render: (row) => <span dir="ltr">{row.days}</span>,
                    },
                    {
                      id: "status",
                      header: activeLocaleHeader(d.hrColStatus),
                      accessor: (row) => localizedHrLeaveStatus(d, row.status),
                      render: (row) => (
                        <Badge tone={row.status === "PENDING" ? "primary" : "neutral"}>
                          {localizedHrLeaveStatus(d, row.status)}
                        </Badge>
                      ),
                    },
                    {
                      id: "note",
                      header: activeLocaleHeader(d.hrColNote),
                      accessor: (row) => row.note ?? row.decisionNote ?? "—",
                      render: (row) => row.note ?? row.decisionNote ?? "—",
                    },
                    {
                      id: "actions",
                      header: activeLocaleHeader(d.hrColStatus),
                      accessor: () => "",
                      render: (row) =>
                        row.status === "PENDING" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setCancelTarget(row);
                              setCancelNote("");
                              setCancelError(null);
                            }}
                          >
                            {d.hrLeaveCancelRequestBtn}
                          </Button>
                        ) : (
                          <span aria-hidden="true">—</span>
                        ),
                    },
                  ]}
                  rows={[...reqRows]}
                  rowKey={(row) => row.id}
                  sort={reqSort}
                  onSortChange={setReqSort}
                  loading={reqBusy}
                  empty={{ title: d.hrSelfEmpty }}
                />
                <Pagination
                  page={reqPage}
                  pageSize={PAGE_SIZE}
                  total={reqTotal}
                  onPageChange={(page) => {
                    setReqPage(page);
                    void loadRequests(reqFrom, reqTo, page);
                  }}
                  announceLabel={formatMessage(d.hrPageOf, {
                    current: reqPage,
                    total: reqPages,
                  })}
                />
              </div>
            </Card>

            <Card title={d.hrLeaveNewRequest}>
              <div className="flex flex-col gap-3">
                {initialTypes.length === 0 ? (
                  <InfoNotice>{d.hrSelfNoTypes}</InfoNotice>
                ) : (
                  <>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-64">
                        <Select
                          id="hr-self-leave-type"
                          label={d.hrLeaveTypeLabel}
                          value={newType}
                          onValueChange={setNewType}
                          options={initialTypes.map((type) => ({
                            value: type.id,
                            label: `${type.code} · ${localizedName(type.name, type.nameAr, locale)}`,
                          }))}
                        />
                      </div>
                      <div className="w-44">
                        <DatePicker
                          id="hr-self-leave-start"
                          locale={locale}
                          label={d.hrLeaveStartDate}
                          value={newStart}
                          onSelect={setNewStart}
                        />
                      </div>
                      <div className="w-44">
                        <DatePicker
                          id="hr-self-leave-end"
                          locale={locale}
                          label={d.hrLeaveEndDate}
                          value={newEnd}
                          onSelect={setNewEnd}
                        />
                      </div>
                    </div>
                    <div className="w-full max-w-xl">
                      <Input
                        id="hr-self-leave-note"
                        label={d.hrColNote}
                        value={newNote}
                        onValueChange={setNewNote}
                      />
                    </div>
                    {newError !== null && <ErrorNotice>{newError}</ErrorNotice>}
                    <div>
                      <Button onClick={() => void createRequest()} disabled={newBusy}>
                        {d.hrLeaveSubmitBtn}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card title={d.hrLeaveBalances}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-32">
                    <Select
                      id="hr-self-balance-year"
                      label={d.hrLeaveYearLabel}
                      value={balYear}
                      onValueChange={(value) => {
                        setBalYear(value);
                        void loadBalances(value);
                      }}
                      options={yearOptions}
                    />
                  </div>
                </div>
                {balError !== null && <ErrorNotice>{balError}</ErrorNotice>}
                <DataTable
                  columns={[
                    {
                      id: "type",
                      header: activeLocaleHeader(d.hrLeaveTypeLabel),
                      accessor: (row) => row.leaveTypeCode,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.leaveTypeCode}
                        </span>
                      ),
                    },
                    {
                      id: "entitlement",
                      header: activeLocaleHeader(d.hrColEntitlement),
                      accessor: (row) => row.entitlementDays,
                      numeric: true,
                      render: (row) => <span dir="ltr">{row.entitlementDays}</span>,
                    },
                    {
                      id: "carried",
                      header: activeLocaleHeader(d.hrColCarried),
                      accessor: (row) => row.carriedForwardDays,
                      numeric: true,
                      render: (row) => <span dir="ltr">{row.carriedForwardDays}</span>,
                    },
                    {
                      id: "used",
                      header: activeLocaleHeader(d.hrColUsed),
                      accessor: (row) => row.usedDays,
                      numeric: true,
                      render: (row) => <span dir="ltr">{row.usedDays}</span>,
                    },
                    {
                      id: "remaining",
                      header: activeLocaleHeader(d.hrColRemaining),
                      accessor: (row) => row.remainingDays,
                      numeric: true,
                      render: (row) => (
                        <span className="font-semibold" dir="ltr">
                          {row.remainingDays}
                        </span>
                      ),
                    },
                  ]}
                  rows={[...balRows]}
                  rowKey={(row) => `${row.employeeId}|${row.leaveTypeId}|${row.year}`}
                  sort={[]}
                  onSortChange={() => undefined}
                  loading={balBusy}
                  empty={{ title: d.hrLeaveBalancesEmpty }}
                />
              </div>
            </Card>
          </div>
        )}

        {tab === "roster" && (
          <div className="flex flex-col gap-4">
            <Card title={d.hrSelfRosterTitle}>
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.hrRosterGridHint}</InfoNotice>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <DatePicker
                      id="hr-self-ros-from"
                      locale={locale}
                      label={d.hrFilterFrom}
                      value={rosFrom}
                      onSelect={setRosFrom}
                    />
                  </div>
                  <div className="w-44">
                    <DatePicker
                      id="hr-self-ros-to"
                      locale={locale}
                      label={d.hrFilterTo}
                      value={rosTo}
                      onSelect={setRosTo}
                    />
                  </div>
                  <Button onClick={applyRosterWindow} disabled={rosBusy}>
                    {d.hrApplyBtn}
                  </Button>
                </div>
                {rosError !== null && <ErrorNotice>{rosError}</ErrorNotice>}
                <DataTable
                  columns={[
                    {
                      id: "date",
                      header: activeLocaleHeader(d.hrColDate),
                      accessor: (row) => row.workDate,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.workDate}
                        </span>
                      ),
                    },
                    {
                      id: "shift",
                      header: activeLocaleHeader(d.hrColShift),
                      accessor: (row) => row.shiftCode ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.shiftCode ?? "—"}
                        </span>
                      ),
                    },
                    {
                      id: "name",
                      header: activeLocaleHeader(d.hrColName),
                      accessor: (row) =>
                        row.shiftName === null ? "—" : localizedName(row.shiftName, null, locale),
                      render: (row) =>
                        row.shiftName === null ? "—" : localizedName(row.shiftName, null, locale),
                    },
                    {
                      id: "start",
                      header: activeLocaleHeader(d.hrShiftStart),
                      accessor: (row) => row.startTime ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.startTime ?? "—"}
                        </span>
                      ),
                    },
                    {
                      id: "end",
                      header: activeLocaleHeader(d.hrShiftEnd),
                      accessor: (row) => row.endTime ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.endTime ?? "—"}
                        </span>
                      ),
                    },
                    {
                      id: "night",
                      header: activeLocaleHeader(d.hrShiftNight),
                      accessor: (row) => (row.isNight === true ? "✓" : "—"),
                      render: (row) => (row.isNight === true ? "✓" : <span aria-hidden="true">—</span>),
                    },
                    {
                      id: "source",
                      header: activeLocaleHeader(d.hrColSource),
                      accessor: (row) => localizedHrRosterSource(d, row.source),
                      render: (row) => localizedHrRosterSource(d, row.source),
                    },
                  ]}
                  rows={[...rosRows]}
                  rowKey={(row) => row.id}
                  sort={rosSort}
                  onSortChange={setRosSort}
                  loading={rosBusy}
                  empty={{ title: d.hrSelfEmpty }}
                />
                <Pagination
                  page={rosPage}
                  pageSize={PAGE_SIZE}
                  total={rosTotal}
                  onPageChange={(page) => {
                    setRosPage(page);
                    void loadRoster(rosFrom, rosTo, page);
                  }}
                  announceLabel={formatMessage(d.hrPageOf, {
                    current: rosPage,
                    total: rosPages,
                  })}
                />
              </div>
            </Card>
          </div>
        )}
      </Tabs>

      {/* The cancel-own dialog (PENDING only). */}
      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title={d.hrLeaveCancelRequestBtn}
      >
        <div className="flex flex-col gap-3">
          {cancelTarget !== null && (
            <InfoNotice>
              {`${cancelTarget.leaveTypeCode} · ${cancelTarget.startDate} → ${cancelTarget.endDate} (${cancelTarget.days})`}
            </InfoNotice>
          )}
          <Input
            id="hr-self-cancel-note"
            label={d.hrColNote}
            value={cancelNote}
            onValueChange={setCancelNote}
          />
          {cancelError !== null && <ErrorNotice>{cancelError}</ErrorNotice>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              {d.commonCancel}
            </Button>
            <Button onClick={() => void cancelRequest()} disabled={cancelBusy}>
              {d.hrLeaveCancelRequestBtn}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
