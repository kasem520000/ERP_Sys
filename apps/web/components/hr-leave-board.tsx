"use client";

/**
 * PHASE-045 (T-13) — the leave board (PAGE_ARCHETYPES §2 + §8, the
 * payroll-runs-table pattern): the requests register (range/status/
 * employee filters + pagination re-fetch through the BFF — the API's own
 * filter vocabulary), the simple-approval actions (approve/reject/cancel
 * — PENDING only, the 0083 CHECK; each decision carries an optional
 * note), the request-create form (the span law: never two leaves at
 * once), the balances panel for a year (decimal day strings — ADR-0009),
 * the type catalog (+ create + activate/deactivate), and the accrual
 * policy run + the carry-over rollover.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  Pagination,
  Select,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  EmployeeListRow,
  LeaveAccrualResult,
  LeaveBalanceRow,
  LeaveRequestRow,
  LeaveRequestsPage,
  LeaveRolloverResult,
  LeaveTypeRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedHrError,
  localizedHrLeaveStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The API's decimal-day law (ADR-0009): strings like "21.00". */
const DAYS_RE = /^\d{1,3}(\.\d{1,2})?$/;
const PAGE_SIZE = 25;
/** The balances year axis (the API's 2020–2100 bounds). */
const MIN_YEAR = 2020;

export function HrLeaveBoard({
  locale,
  year,
  initialRequests,
  initialTypes,
  initialBalances,
  employees,
}: {
  locale: Locale;
  /** The server page's default requests window year. */
  year: number;
  initialRequests: LeaveRequestsPage;
  initialTypes: readonly LeaveTypeRow[];
  initialBalances: readonly LeaveBalanceRow[];
  employees: readonly EmployeeListRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const yearOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let entry = MIN_YEAR; entry <= year + 1; entry += 1) {
      out.push({ value: String(entry), label: String(entry) });
    }
    return out;
  }, [year]);

  // -- the requests register (filters + pagination through the BFF) ------------
  const [reqFrom, setReqFrom] = useState(`${year}-01-01`);
  const [reqTo, setReqTo] = useState(`${year}-12-31`);
  const [reqStatus, setReqStatus] = useState("");
  const [reqEmployee, setReqEmployee] = useState("");
  const [reqPage, setReqPage] = useState(1);
  const [reqRows, setReqRows] = useState<readonly LeaveRequestRow[]>(initialRequests.rows);
  const [reqTotal, setReqTotal] = useState(initialRequests.total);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqSort, setReqSort] = useState<DataTableSort[]>([]);
  const reqRunRef = useRef(0);

  const loadRequests = useCallback(
    async (from: string, to: string, status: string, employeeId: string, page: number): Promise<void> => {
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
      if (status !== "") {
        search.set("status", status);
      }
      if (employeeId !== "") {
        search.set("employeeId", employeeId);
      }
      const result = await bffFetch<LeaveRequestsPage>(`hr/leave/requests?${search.toString()}`);
      if (run !== reqRunRef.current) {
        return; // stale response — a newer filter change superseded it
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

  // -- the employee pool (payroll directory; the requests' own employees are
  // merged so the filters survive a directory the HR role cannot view) ---------
  const employeeOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    for (const row of reqRows) {
      map.set(row.employeeId, {
        value: row.employeeId,
        label: `${row.employeeCode} · ${row.employeeName}`,
      });
    }
    for (const employee of employees) {
      if (!map.has(employee.id)) {
        map.set(employee.id, {
          value: employee.id,
          label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
        });
      }
    }
    return [...map.values()];
  }, [reqRows, employees, locale]);

  // -- the request-create form ------------------------------------------------------
  const [newEmployee, setNewEmployee] = useState("");
  const [newType, setNewType] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [newNotice, setNewNotice] = useState<string | null>(null);

  async function createRequest(): Promise<void> {
    setNewError(null);
    setNewNotice(null);
    if (
      newEmployee === "" ||
      newType === "" ||
      !DATE_RE.test(newStart) ||
      !DATE_RE.test(newEnd) ||
      newEnd < newStart
    ) {
      setNewError(d.budgetFormInvalid);
      return;
    }
    setNewBusy(true);
    const result = await bffFetch<LeaveRequestRow>("hr/leave/requests", {
      method: "POST",
      body: {
        employeeId: newEmployee,
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
    setNewNotice(d.hrLeaveRequestCreated);
    toast({ tone: "success", title: d.hrLeaveRequestCreated });
    setNewStart("");
    setNewEnd("");
    setNewNote("");
    await loadRequests(reqFrom, reqTo, reqStatus, reqEmployee, 1);
  }

  // -- the decision dialog (approve/reject/cancel — PENDING only) -------------------
  const [decideTarget, setDecideTarget] = useState<LeaveRequestRow | null>(null);
  const [decideAction, setDecideAction] = useState<"APPROVE" | "REJECT" | "CANCEL">("APPROVE");
  const [decideNote, setDecideNote] = useState("");
  const [decideBusy, setDecideBusy] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  async function decide(): Promise<void> {
    if (decideTarget === null) {
      return;
    }
    setDecideError(null);
    setDecideBusy(true);
    const result = await bffFetch<LeaveRequestRow>(
      `hr/leave/requests/${decideTarget.id}/${decideAction.toLowerCase()}`,
      {
        method: "POST",
        body: decideNote.trim() === "" ? {} : { note: decideNote.trim() },
      },
    );
    setDecideBusy(false);
    if (!result.ok) {
      setDecideError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.hrLeaveDecidedToast });
    setDecideTarget(null);
    setDecideNote("");
    await loadRequests(reqFrom, reqTo, reqStatus, reqEmployee, reqPage);
  }

  // -- the type catalog (+ create + activate/deactivate) -----------------------------
  const [typeRows, setTypeRows] = useState<readonly LeaveTypeRow[]>(initialTypes);
  const [typeCode, setTypeCode] = useState("");
  const [typeName, setTypeName] = useState("");
  const [typeNameAr, setTypeNameAr] = useState("");
  const [typePaid, setTypePaid] = useState(true);
  const [typeAccrual, setTypeAccrual] = useState("21.00");
  const [typeMonthly, setTypeMonthly] = useState(false);
  const [typeProrate, setTypeProrate] = useState(true);
  const [typeCarryCap, setTypeCarryCap] = useState("0.00");
  const [typeBusy, setTypeBusy] = useState(false);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typeNotice, setTypeNotice] = useState<string | null>(null);
  const [typeSort, setTypeSort] = useState<DataTableSort[]>([]);

  const reloadTypes = useCallback(async (): Promise<void> => {
    const result = await bffFetch<readonly LeaveTypeRow[]>("hr/leave/types");
    if (!result.ok) {
      setTypeError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTypeRows(result.data);
  }, [d]);

  async function createType(): Promise<void> {
    setTypeError(null);
    setTypeNotice(null);
    if (
      typeCode.trim() === "" ||
      typeName.trim() === "" ||
      !DAYS_RE.test(typeAccrual) ||
      !DAYS_RE.test(typeCarryCap)
    ) {
      setTypeError(d.budgetFormInvalid);
      return;
    }
    setTypeBusy(true);
    const result = await bffFetch<LeaveTypeRow>("hr/leave/types", {
      method: "POST",
      body: {
        code: typeCode.trim(),
        name: typeName.trim(),
        ...(typeNameAr.trim() === "" ? {} : { nameAr: typeNameAr.trim() }),
        paid: typePaid,
        accrualDaysPerYear: typeAccrual,
        monthlyGrant: typeMonthly,
        prorateJoiners: typeProrate,
        carryOverCapDays: typeCarryCap,
      },
    });
    setTypeBusy(false);
    if (!result.ok) {
      setTypeError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTypeNotice(d.hrLeaveTypeSavedToast);
    toast({ tone: "success", title: d.hrLeaveTypeSavedToast });
    setTypeCode("");
    setTypeName("");
    setTypeNameAr("");
    await reloadTypes();
  }

  async function toggleType(row: LeaveTypeRow, active: boolean): Promise<void> {
    setTypeError(null);
    setTypeBusy(true);
    const result = await bffFetch<LeaveTypeRow>(
      `hr/leave/types/${row.id}/${active ? "activate" : "deactivate"}`,
      { method: "POST" },
    );
    setTypeBusy(false);
    if (!result.ok) {
      setTypeError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    await reloadTypes();
  }

  // -- the balances panel (a year read through the BFF) --------------------------------
  const [balanceYear, setBalanceYear] = useState(String(year));
  const [balanceRows, setBalanceRows] = useState<readonly LeaveBalanceRow[]>(initialBalances);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceSort, setBalanceSort] = useState<DataTableSort[]>([]);

  const loadBalances = useCallback(
    async (yearValue: string): Promise<void> => {
      setBalanceBusy(true);
      setBalanceError(null);
      const result = await bffFetch<readonly LeaveBalanceRow[]>(
        `hr/leave/balances?year=${yearValue}`,
      );
      setBalanceBusy(false);
      if (!result.ok) {
        setBalanceError(localizedHrError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setBalanceRows(result.data);
    },
    [d],
  );

  // -- the accrual run + the rollover ------------------------------------------------
  const [runTypeId, setRunTypeId] = useState("");
  const [runYear, setRunYear] = useState(String(year));
  const [runMonth, setRunMonth] = useState("");
  const [accrualBusy, setAccrualBusy] = useState(false);
  const [rolloverBusy, setRolloverBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function runAccrual(): Promise<void> {
    setRunError(null);
    if (runTypeId === "") {
      setRunError(d.budgetFormInvalid);
      return;
    }
    setAccrualBusy(true);
    const result = await bffFetch<LeaveAccrualResult>("hr/leave/accrual", {
      method: "POST",
      body: {
        leaveTypeId: runTypeId,
        year: Number.parseInt(runYear, 10),
        ...(runMonth === "" ? {} : { asOfMonth: Number.parseInt(runMonth, 10) }),
      },
    });
    setAccrualBusy(false);
    if (!result.ok) {
      setRunError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.hrLeaveAccrualDone, {
        cells: result.data.cellsWritten,
        employees: result.data.employees,
      }),
    });
    await loadBalances(balanceYear);
  }

  async function runRollover(): Promise<void> {
    setRunError(null);
    if (runTypeId === "") {
      setRunError(d.budgetFormInvalid);
      return;
    }
    const fromYear = Number.parseInt(runYear, 10) - 1;
    const toYear = Number.parseInt(runYear, 10);
    setRolloverBusy(true);
    const result = await bffFetch<LeaveRolloverResult>("hr/leave/rollover", {
      method: "POST",
      body: { leaveTypeId: runTypeId, fromYear, toYear },
    });
    setRolloverBusy(false);
    if (!result.ok) {
      setRunError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.hrLeaveRolloverDone, {
        cells: result.data.cellsWritten,
        count: result.data.truncatedCount,
        days: result.data.truncatedDays,
      }),
    });
    await loadBalances(balanceYear);
  }

  const activeTypes = useMemo(() => typeRows.filter((row) => row.active), [typeRows]);
  const typeOptions = useMemo(
    () =>
      typeRows.map((row) => ({
        value: row.id,
        label: `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`,
      })),
    [typeRows, locale],
  );

  const reqPages =
    reqTotal === 0 ? 1 : ((reqTotal + PAGE_SIZE - 1) / PAGE_SIZE) | 0;

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.hrLeaveRequests}>
        <div className="flex flex-col gap-3">
          {reqError !== null && <ErrorNotice>{reqError}</ErrorNotice>}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <DatePicker
                id="hr-leave-from"
                locale={locale}
                label={d.hrFilterFrom}
                value={reqFrom}
                onSelect={setReqFrom}
              />
            </div>
            <div className="w-56">
              <DatePicker
                id="hr-leave-to"
                locale={locale}
                label={d.hrFilterTo}
                value={reqTo}
                onSelect={setReqTo}
              />
            </div>
            <div className="w-48">
              <Select
                id="hr-leave-status"
                label={d.hrColStatus}
                value={reqStatus}
                onValueChange={setReqStatus}
                options={[
                  { value: "", label: d.kindFilterAll },
                  { value: "PENDING", label: d.hrLeaveStatusPending },
                  { value: "APPROVED", label: d.hrLeaveStatusApproved },
                  { value: "REJECTED", label: d.hrLeaveStatusRejected },
                  { value: "CANCELLED", label: d.hrLeaveStatusCancelled },
                ]}
              />
            </div>
            <div className="w-64">
              <Select
                id="hr-leave-employee"
                label={d.hrColEmployee}
                value={reqEmployee}
                onValueChange={setReqEmployee}
                options={[{ value: "", label: d.kindFilterAll }, ...employeeOptions]}
              />
            </div>
            <Button
              variant="secondary"
              disabled={
                !DATE_RE.test(reqFrom) || !DATE_RE.test(reqTo) || reqTo < reqFrom
              }
              onClick={() => {
                setReqPage(1);
                void loadRequests(reqFrom, reqTo, reqStatus, reqEmployee, 1);
              }}
            >
              {d.hrApplyBtn}
            </Button>
          </div>
          <p className="text-xs text-gray-600" dir="ltr">
            {formatMessage(d.hrTotalRows, { count: reqTotal })}
          </p>
          <DataTable
            columns={[
              {
                id: "employee",
                header: activeLocaleHeader(d.hrColEmployee),
                accessor: (row) => `${row.employeeCode} ${row.employeeName}`,
                sortable: true,
                width: "16rem",
                render: (row) => (
                  <span>
                    <span className="font-mono text-sm" dir="ltr">
                      {row.employeeCode}
                    </span>{" "}
                    · {row.employeeName}
                  </span>
                ),
              },
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
                id: "startDate",
                header: activeLocaleHeader(d.hrLeaveStartDate),
                accessor: (row) => row.startDate,
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.startDate}
                  </span>
                ),
              },
              {
                id: "endDate",
                header: activeLocaleHeader(d.hrLeaveEndDate),
                accessor: (row) => row.endDate,
                sortable: true,
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
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.days}
                  </span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.hrColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "APPROVED" ? "primary" : "neutral"}>
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
            ]}
            rows={[...reqRows]}
            rowKey={(row) => row.id}
            sort={reqSort}
            onSortChange={setReqSort}
            loading={reqBusy && reqRows.length === 0}
            empty={{ title: d.hrLeaveRequestsEmpty }}
            rowActions={[
              {
                id: "approve",
                label: d.hrLeaveApproveBtn,
                onSelect: (row) => {
                  setDecideTarget(row);
                  setDecideAction("APPROVE");
                  setDecideNote("");
                  setDecideError(null);
                },
              },
              {
                id: "reject",
                label: d.hrLeaveRejectBtn,
                danger: true,
                onSelect: (row) => {
                  setDecideTarget(row);
                  setDecideAction("REJECT");
                  setDecideNote("");
                  setDecideError(null);
                },
              },
              {
                id: "cancel",
                label: d.hrLeaveCancelRequestBtn,
                onSelect: (row) => {
                  setDecideTarget(row);
                  setDecideAction("CANCEL");
                  setDecideNote("");
                  setDecideError(null);
                },
              },
            ]}
          />
          <Pagination
            page={reqPage}
            pageSize={PAGE_SIZE}
            total={reqTotal}
            onPageChange={(page) => {
              setReqPage(page);
              void loadRequests(reqFrom, reqTo, reqStatus, reqEmployee, page);
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
          {newError !== null && <ErrorNotice>{newError}</ErrorNotice>}
          {newNotice !== null && <SuccessNotice>{newNotice}</SuccessNotice>}
          {employeeOptions.length === 0 || typeOptions.length === 0 ? (
            <InfoNotice>{d.hrEmployeePoolEmpty}</InfoNotice>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                id="hr-leave-new-employee"
                label={d.hrColEmployee}
                value={newEmployee}
                onValueChange={setNewEmployee}
                options={employeeOptions}
                required
              />
              <Select
                id="hr-leave-new-type"
                label={d.hrLeaveTypeLabel}
                value={newType}
                onValueChange={setNewType}
                options={activeTypes.map((row) => ({
                  value: row.id,
                  label: `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`,
                }))}
                required
              />
              <DatePicker
                id="hr-leave-new-start"
                locale={locale}
                label={d.hrLeaveStartDate}
                value={newStart}
                onSelect={setNewStart}
              />
              <DatePicker
                id="hr-leave-new-end"
                locale={locale}
                label={d.hrLeaveEndDate}
                value={newEnd}
                onSelect={setNewEnd}
              />
              <Input
                id="hr-leave-new-note"
                label={d.hrColNote}
                value={newNote}
                onValueChange={setNewNote}
              />
            </div>
          )}
          {employeeOptions.length > 0 && typeOptions.length > 0 && (
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => void createRequest()} loading={newBusy}>
                {d.hrLeaveSubmitBtn}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card title={d.hrLeaveBalances}>
        <div className="flex flex-col gap-3">
          {balanceError !== null && <ErrorNotice>{balanceError}</ErrorNotice>}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Select
                id="hr-leave-balance-year"
                label={d.hrLeaveYearLabel}
                value={balanceYear}
                onValueChange={(value) => {
                  setBalanceYear(value);
                  void loadBalances(value);
                }}
                options={yearOptions}
              />
            </div>
          </div>
          <DataTable
            columns={[
              {
                id: "employee",
                header: activeLocaleHeader(d.hrColEmployee),
                accessor: (row) => `${row.employeeCode} ${row.employeeName}`,
                sortable: true,
                width: "16rem",
                render: (row) => (
                  <span>
                    <span className="font-mono text-sm" dir="ltr">
                      {row.employeeCode}
                    </span>{" "}
                    · {row.employeeName}
                  </span>
                ),
              },
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
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.entitlementDays}
                  </span>
                ),
              },
              {
                id: "carried",
                header: activeLocaleHeader(d.hrColCarried),
                accessor: (row) => row.carriedForwardDays,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.carriedForwardDays}
                  </span>
                ),
              },
              {
                id: "used",
                header: activeLocaleHeader(d.hrColUsed),
                accessor: (row) => row.usedDays,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.usedDays}
                  </span>
                ),
              },
              {
                id: "remaining",
                header: activeLocaleHeader(d.hrColRemaining),
                accessor: (row) => row.remainingDays,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums font-semibold" dir="ltr">
                    {row.remainingDays}
                  </span>
                ),
              },
            ]}
            rows={[...balanceRows]}
            rowKey={(row) => `${row.employeeId}-${row.leaveTypeId}-${row.year}`}
            sort={balanceSort}
            onSortChange={setBalanceSort}
            loading={balanceBusy && balanceRows.length === 0}
            empty={{ title: d.hrLeaveBalancesEmpty }}
          />
        </div>
      </Card>

      <Card title={d.hrLeaveTypesSection}>
        <div className="flex flex-col gap-3">
          {typeError !== null && <ErrorNotice>{typeError}</ErrorNotice>}
          {typeNotice !== null && <SuccessNotice>{typeNotice}</SuccessNotice>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              id="hr-leave-type-code"
              label={d.hrColCode}
              value={typeCode}
              onValueChange={setTypeCode}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-leave-type-name"
              label={d.hrColName}
              value={typeName}
              onValueChange={setTypeName}
              required
            />
            <Input
              id="hr-leave-type-name-ar"
              label={d.hrColNameAr}
              value={typeNameAr}
              onValueChange={setTypeNameAr}
            />
            <Input
              id="hr-leave-type-accrual"
              label={d.hrLeaveAccrualDays}
              value={typeAccrual}
              onValueChange={setTypeAccrual}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-leave-type-carry"
              label={d.hrLeaveCarryCap}
              value={typeCarryCap}
              onValueChange={setTypeCarryCap}
              mono
              bidiIsolate
              required
            />
            <div className="flex flex-col gap-2 pt-2">
              <Checkbox
                label={d.hrColPaid}
                checked={typePaid}
                onCheckedChange={(checked) => {
                  setTypePaid(checked === true);
                }}
              />
              <Checkbox
                label={d.hrLeaveMonthlyGrant}
                checked={typeMonthly}
                onCheckedChange={(checked) => {
                  setTypeMonthly(checked === true);
                }}
              />
              <Checkbox
                label={d.hrLeaveProrateJoiners}
                checked={typeProrate}
                onCheckedChange={(checked) => {
                  setTypeProrate(checked === true);
                }}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void createType()} loading={typeBusy}>
              {d.hrLeaveNewType}
            </Button>
          </div>
          <DataTable
            columns={[
              {
                id: "code",
                header: activeLocaleHeader(d.hrColCode),
                accessor: (row) => row.code,
                sortable: true,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.code}
                  </span>
                ),
              },
              {
                id: "name",
                header: activeLocaleHeader(d.hrColName),
                accessor: (row) => localizedName(row.name, row.nameAr, locale),
                sortable: true,
                render: (row) => localizedName(row.name, row.nameAr, locale),
              },
              {
                id: "paid",
                header: activeLocaleHeader(d.hrColPaid),
                accessor: (row) => (row.paid ? "✓" : "—"),
                render: (row) => (row.paid ? "✓" : "—"),
              },
              {
                id: "accrual",
                header: activeLocaleHeader(d.hrLeaveAccrualDays),
                accessor: (row) => row.accrualDaysPerYear,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.accrualDaysPerYear}
                  </span>
                ),
              },
              {
                id: "monthlyGrant",
                header: activeLocaleHeader(d.hrLeaveMonthlyGrant),
                accessor: (row) => (row.monthlyGrant ? "✓" : "—"),
                render: (row) => (row.monthlyGrant ? "✓" : "—"),
              },
              {
                id: "prorate",
                header: activeLocaleHeader(d.hrLeaveProrateJoiners),
                accessor: (row) => (row.prorateJoiners ? "✓" : "—"),
                render: (row) => (row.prorateJoiners ? "✓" : "—"),
              },
              {
                id: "carryCap",
                header: activeLocaleHeader(d.hrLeaveCarryCap),
                accessor: (row) => row.carryOverCapDays,
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.carryOverCapDays}
                  </span>
                ),
              },
              {
                id: "active",
                header: activeLocaleHeader(d.hrColStatus),
                accessor: (row) => (row.active ? d.hrShiftActive : d.hrShiftInactive),
                render: (row) => (
                  <Badge tone={row.active ? "primary" : "neutral"}>
                    {row.active ? d.hrShiftActive : d.hrShiftInactive}
                  </Badge>
                ),
              },
            ]}
            rows={[...typeRows]}
            rowKey={(row) => row.id}
            sort={typeSort}
            onSortChange={setTypeSort}
            empty={{ title: d.hrLeaveTypesEmpty }}
            rowActions={[
              {
                id: "activate",
                label: d.hrActivateBtn,
                onSelect: (row) => {
                  if (!row.active) void toggleType(row, true);
                },
              },
              {
                id: "deactivate",
                label: d.hrDeactivateBtn,
                onSelect: (row) => {
                  if (row.active) void toggleType(row, false);
                },
              },
            ]}
          />
        </div>
      </Card>

      <Card title={d.hrLeaveAccrualTitle}>
        <div className="flex flex-col gap-3">
          {runError !== null && <ErrorNotice>{runError}</ErrorNotice>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              id="hr-run-type"
              label={d.hrLeaveTypeLabel}
              value={runTypeId}
              onValueChange={setRunTypeId}
              options={typeOptions}
              required
            />
            <Select
              id="hr-run-year"
              label={d.hrLeaveYearLabel}
              value={runYear}
              onValueChange={setRunYear}
              options={yearOptions}
            />
            <Select
              id="hr-run-month"
              label={d.hrLeaveAccrualAsOfMonth}
              value={runMonth}
              onValueChange={setRunMonth}
              options={[
                { value: "", label: d.kindFilterAll },
                ...Array.from({ length: 12 }, (_, index) => ({
                  value: String(index + 1),
                  label: String(index + 1),
                })),
              ]}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => void runAccrual()} loading={accrualBusy}>
              {d.hrLeaveAccrualBtn}
            </Button>
            <Button variant="secondary" onClick={() => void runRollover()} loading={rolloverBusy}>
              {d.hrLeaveRolloverBtn}
            </Button>
          </div>
          <p className="text-xs text-gray-600">
            {d.hrLeaveRolloverTitle} — {d.hrLeaveRolloverFromYear}{" "}
            {Number.parseInt(runYear, 10) - 1} {d.hrLeaveRolloverToYear} {runYear}
          </p>
        </div>
      </Card>

      {/* The simple-approval decision (PENDING only — the 0083 CHECK). */}
      <Dialog
        open={decideTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDecideTarget(null);
        }}
        title={
          decideTarget === null
            ? d.hrLeaveRequests
            : `${decideTarget.employeeCode} · ${decideTarget.leaveTypeCode} — ${decideTarget.startDate} → ${decideTarget.endDate}`
        }
      >
        <div className="flex flex-col gap-3">
          {decideError !== null && <ErrorNotice>{decideError}</ErrorNotice>}
          <Select
            id="hr-leave-decide-action"
            label={d.hrColStatus}
            value={decideAction}
            onValueChange={(value) => {
              if (value === "APPROVE" || value === "REJECT" || value === "CANCEL") {
                setDecideAction(value);
              }
            }}
            options={[
              { value: "APPROVE", label: d.hrLeaveApproveBtn },
              { value: "REJECT", label: d.hrLeaveRejectBtn },
              { value: "CANCEL", label: d.hrLeaveCancelRequestBtn },
            ]}
          />
          <Input
            id="hr-leave-decide-note"
            label={d.hrImportResolveNote}
            value={decideNote}
            onValueChange={setDecideNote}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDecideTarget(null)} disabled={decideBusy}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" onClick={() => void decide()} loading={decideBusy}>
              {decideAction === "APPROVE"
                ? d.hrLeaveApproveBtn
                : decideAction === "REJECT"
                  ? d.hrLeaveRejectBtn
                  : d.hrLeaveCancelRequestBtn}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
