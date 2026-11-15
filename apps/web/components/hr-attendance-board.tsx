"use client";

/**
 * PHASE-045 (T-12) — the attendance board (PAGE_ARCHETYPES §2, the
 * payroll-runs-table pattern): the daily register (per-employee derived
 * verdicts + late/early/worked/overtime minute facts, exceptions
 * highlighted), the exception board (the is_exception rows for a window —
 * filters + pagination re-fetch through the BFF), the back-office capture
 * (POST attendance/records — the 0081 session law) and the one-shot
 * checkout (BR-082's only punch-mutating arm), and the derivation run
 * (POST attendance/derive — the backfill). The register date rides the
 * ?date= deep link; mutations refresh the route and the board re-fetches
 * the exception page with its own filters.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AttendanceDeriveResult,
  AttendanceExceptionsPage,
  AttendanceRecordRow,
  EmployeeListRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedHrAttendanceStatus,
  localizedHrError,
  localizedHrPunchSource,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The punch clock face — 24h HH:MM (the API wants an ISO-8601 instant;
 * the naive wall-clock `${date} ${HH:MM}:00` is its accepted shape). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The exception board page size (the register page seeded page one). */
const EXCEPTION_PAGE_SIZE = 25;

function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** `—` for the never-computed fact (a holiday is never late; an open
 * session has no worked span) — the honest null, never a zero. */
function minutes(value: number | null): string {
  return value === null ? "—" : String(value);
}

export function HrAttendanceBoard({
  locale,
  date,
  registerDate,
  initialRows,
  initialExceptions,
  exceptionError,
  employees,
}: {
  locale: Locale;
  /** The ?date= deep-link date (the server page fetched this day). */
  date: string;
  /** The API's echoed register date (validates the same shape). */
  registerDate: string;
  initialRows: readonly AttendanceRecordRow[];
  initialExceptions: AttendanceExceptionsPage | null;
  exceptionError: { forbidden: boolean; message: string } | null;
  employees: readonly EmployeeListRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  // -- the register (server-driven; mutations refresh the route) ------------
  const [rows, setRows] = useState<readonly AttendanceRecordRow[]>(initialRows);
  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  // -- the register date filter (URL deep link) --------------------------------
  const [draftDate, setDraftDate] = useState(date);

  // -- the exception board (filters + pagination re-fetch through the BFF) ---
  const [excFrom, setExcFrom] = useState(addDaysIso(date, -6));
  const [excTo, setExcTo] = useState(date);
  const [excEmployee, setExcEmployee] = useState("");
  const [excPage, setExcPage] = useState(1);
  const [excRows, setExcRows] = useState<readonly AttendanceRecordRow[]>(
    initialExceptions?.rows ?? [],
  );
  const [excTotal, setExcTotal] = useState(initialExceptions?.total ?? 0);
  const [excBusy, setExcBusy] = useState(false);
  const [excError, setExcError] = useState<string | null>(
    exceptionError === null ? null : exceptionError.message,
  );
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const excRunRef = useRef(0);

  const loadExceptions = useCallback(
    async (from: string, to: string, employeeId: string, page: number): Promise<void> => {
      const run = excRunRef.current + 1;
      excRunRef.current = run;
      setExcBusy(true);
      setExcError(null);
      const search = new URLSearchParams({
        from,
        to,
        page: String(page),
        pageSize: String(EXCEPTION_PAGE_SIZE),
      });
      if (employeeId !== "") {
        search.set("employeeId", employeeId);
      }
      const result = await bffFetch<AttendanceExceptionsPage>(
        `hr/attendance/exceptions?${search.toString()}`,
      );
      if (run !== excRunRef.current) {
        return; // stale response — a newer filter change superseded it
      }
      setExcBusy(false);
      if (!result.ok) {
        setExcError(localizedHrError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setExcRows(result.data.rows);
      setExcTotal(result.data.total);
      setExcPage(result.data.page);
    },
    [d],
  );

  // A new register day (the ?date= deep link changed) resets the draft,
  // the capture work-date seed, and the exception window to its default
  // (the trailing week ending at the day) and reloads page one through
  // the BFF.
  const dateChangedRef = useRef(date);
  useEffect(() => {
    if (date === dateChangedRef.current) {
      return;
    }
    dateChangedRef.current = date;
    const from = addDaysIso(date, -6);
    setDraftDate(date);
    setCapWorkDate(date);
    setExcFrom(from);
    setExcTo(date);
    setExcEmployee("");
    setExcPage(1);
    void loadExceptions(from, date, "", 1);
  }, [date, loadExceptions]);

  // -- the employee pool (the payroll directory degraded onto the register's
  // own employees — the HR role may not carry the payroll view) ----------------
  const employeeOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    for (const row of rows) {
      map.set(row.employeeId, { value: row.employeeId, label: `${row.employeeCode} · ${row.employeeName}` });
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
  }, [rows, employees, locale]);

  // -- the capture form (POST attendance/records — the 0081 session law) ------
  const [capEmployee, setCapEmployee] = useState("");
  const [capWorkDate, setCapWorkDate] = useState(registerDate);
  const [capCheckIn, setCapCheckIn] = useState("");
  const [capCheckOut, setCapCheckOut] = useState("");
  const [capSource, setCapSource] = useState("MANUAL");
  const [capDeviceRef, setCapDeviceRef] = useState("");
  const [capNote, setCapNote] = useState("");
  const [capBusy, setCapBusy] = useState(false);
  const [capError, setCapError] = useState<string | null>(null);
  const [capNotice, setCapNotice] = useState<string | null>(null);

  async function capture(): Promise<void> {
    setCapError(null);
    setCapNotice(null);
    if (
      capEmployee === "" ||
      !DATE_RE.test(capWorkDate) ||
      !TIME_RE.test(capCheckIn) ||
      (capCheckOut !== "" && !TIME_RE.test(capCheckOut)) ||
      (capSource === "DEVICE" && capDeviceRef.trim() === "")
    ) {
      setCapError(d.budgetFormInvalid);
      return;
    }
    setCapBusy(true);
    const result = await bffFetch<AttendanceRecordRow>("hr/attendance/records", {
      method: "POST",
      body: {
        employeeId: capEmployee,
        workDate: capWorkDate,
        checkIn: `${capWorkDate} ${capCheckIn}:00`,
        ...(capCheckOut === "" ? {} : { checkOut: `${capWorkDate} ${capCheckOut}:00` }),
        source: capSource,
        ...(capSource === "DEVICE" ? { deviceRef: capDeviceRef.trim() } : {}),
        ...(capNote.trim() === "" ? {} : { note: capNote.trim() }),
      },
    });
    setCapBusy(false);
    if (!result.ok) {
      setCapError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCapNotice(d.hrCaptureDone);
    toast({ tone: "success", title: d.hrCaptureDone });
    setCapCheckIn("");
    setCapCheckOut("");
    setCapNote("");
    setCapDeviceRef("");
    router.refresh();
    await loadExceptions(excFrom, excTo, excEmployee, excPage);
  }

  // -- the one-shot checkout (BR-082) --------------------------------------------
  const [checkoutTarget, setCheckoutTarget] = useState<AttendanceRecordRow | null>(null);
  const [checkoutTime, setCheckoutTime] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function checkout(): Promise<void> {
    if (checkoutTarget === null) {
      return;
    }
    setCheckoutError(null);
    if (!TIME_RE.test(checkoutTime)) {
      setCheckoutError(d.budgetFormInvalid);
      return;
    }
    setCheckoutBusy(true);
    const result = await bffFetch<AttendanceRecordRow>(
      `hr/attendance/records/${checkoutTarget.id}/checkout`,
      {
        method: "POST",
        body: { checkOut: `${checkoutTarget.workDate} ${checkoutTime}:00` },
      },
    );
    setCheckoutBusy(false);
    if (!result.ok) {
      setCheckoutError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.hrCheckoutDone });
    setCheckoutTarget(null);
    setCheckoutTime("");
    router.refresh();
    await loadExceptions(excFrom, excTo, excEmployee, excPage);
  }

  // -- the derivation run (the backfill) ------------------------------------------
  const [deriveFrom, setDeriveFrom] = useState(date);
  const [deriveTo, setDeriveTo] = useState(date);
  const [deriveBusy, setDeriveBusy] = useState(false);
  const [deriveError, setDeriveError] = useState<string | null>(null);

  async function derive(): Promise<void> {
    setDeriveError(null);
    if (!DATE_RE.test(deriveFrom) || !DATE_RE.test(deriveTo) || deriveTo < deriveFrom) {
      setDeriveError(d.budgetFormInvalid);
      return;
    }
    setDeriveBusy(true);
    const result = await bffFetch<AttendanceDeriveResult>("hr/attendance/derive", {
      method: "POST",
      body: { from: deriveFrom, to: deriveTo },
    });
    setDeriveBusy(false);
    if (!result.ok) {
      setDeriveError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.hrDeriveDone, {
        days: result.data.days,
        rows: result.data.rowsUpdated,
        absent: result.data.absentSynthesized,
      }),
    });
    router.refresh();
    await loadExceptions(excFrom, excTo, excEmployee, excPage);
  }

  const statusBadge = useCallback(
    (row: AttendanceRecordRow): JSX.Element => (
      <Badge tone={row.isException ? "primary" : "neutral"}>
        {localizedHrAttendanceStatus(d, row.derivedStatus)}
      </Badge>
    ),
    [d],
  );

  const exceptionPages =
    excTotal === 0 ? 1 : ((excTotal + EXCEPTION_PAGE_SIZE - 1) / EXCEPTION_PAGE_SIZE) | 0;

  return (
    <div className="flex flex-col gap-4">
      {/* The register date deep link — the server page re-fetches the day. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <DatePicker
            id="hr-attendance-date"
            locale={locale}
            label={d.hrFilterDate}
            value={draftDate}
            onSelect={setDraftDate}
          />
        </div>
        <Button
          variant="secondary"
          disabled={draftDate === date || !DATE_RE.test(draftDate)}
          onClick={() => router.push(`/${locale}/hr/attendance?date=${draftDate}`)}
        >
          {d.hrApplyBtn}
        </Button>
      </div>

      <Card title={`${d.hrAttendanceRegister} — ${registerDate}`}>
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
              render: (row) =>
                row.checkIn !== null && row.checkOut === null ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCheckoutTarget(row);
                      setCheckoutTime("");
                      setCheckoutError(null);
                    }}
                  >
                    {d.hrCheckoutBtn}
                  </Button>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.checkOut ?? "—"}
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
                  className={row.lateMinutes !== null && row.lateMinutes > 0 ? "font-semibold text-danger-700" : ""}
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
            {
              id: "note",
              header: activeLocaleHeader(d.hrColNote),
              accessor: (row) => row.note ?? "—",
              render: (row) => row.note ?? "—",
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
          loading={false}
          empty={{ title: d.hrRegisterEmpty }}
        />
      </Card>

      <Card title={d.hrCaptureTitle} description={d.hrTimeHint}>
        <div className="flex flex-col gap-3">
          {capError !== null && <ErrorNotice>{capError}</ErrorNotice>}
          {capNotice !== null && <SuccessNotice>{capNotice}</SuccessNotice>}
          {employeeOptions.length === 0 ? (
            <InfoNotice>{d.hrEmployeePoolEmpty}</InfoNotice>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                id="hr-capture-employee"
                label={d.hrColEmployee}
                value={capEmployee}
                onValueChange={setCapEmployee}
                options={employeeOptions}
                required
              />
              <DatePicker
                id="hr-capture-date"
                locale={locale}
                label={d.hrCaptureWorkDate}
                value={capWorkDate}
                onSelect={setCapWorkDate}
              />
              <Input
                id="hr-capture-checkin"
                label={d.hrCaptureCheckIn}
                value={capCheckIn}
                onValueChange={setCapCheckIn}
                placeholder="08:05"
                mono
                bidiIsolate
                required
              />
              <Input
                id="hr-capture-checkout"
                label={d.hrCaptureCheckOut}
                value={capCheckOut}
                onValueChange={setCapCheckOut}
                placeholder="17:00"
                mono
                bidiIsolate
              />
              <Select
                id="hr-capture-source"
                label={d.hrColSource}
                value={capSource}
                onValueChange={setCapSource}
                options={[
                  { value: "MANUAL", label: d.hrSourceManual },
                  { value: "DEVICE", label: d.hrSourceDevice },
                ]}
              />
              {capSource === "DEVICE" && (
                <Input
                  id="hr-capture-device"
                  label={d.hrCaptureDeviceRef}
                  value={capDeviceRef}
                  onValueChange={setCapDeviceRef}
                  mono
                  bidiIsolate
                  required
                />
              )}
              <Input
                id="hr-capture-note"
                label={d.hrColNote}
                value={capNote}
                onValueChange={setCapNote}
              />
            </div>
          )}
          {employeeOptions.length > 0 && (
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => void capture()} loading={capBusy}>
                {d.hrCaptureBtn}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card title={d.hrDeriveTitle}>
        <div className="flex flex-col gap-3">
          {deriveError !== null && <ErrorNotice>{deriveError}</ErrorNotice>}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <DatePicker
                id="hr-derive-from"
                locale={locale}
                label={d.hrFilterFrom}
                value={deriveFrom}
                onSelect={setDeriveFrom}
              />
            </div>
            <div className="w-56">
              <DatePicker
                id="hr-derive-to"
                locale={locale}
                label={d.hrFilterTo}
                value={deriveTo}
                onSelect={setDeriveTo}
              />
            </div>
            <Button variant="secondary" onClick={() => void derive()} loading={deriveBusy}>
              {d.hrDeriveBtn}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={d.hrExceptionBoard}>
        <div className="flex flex-col gap-3">
          {excError !== null && <ErrorNotice>{excError}</ErrorNotice>}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <DatePicker
                id="hr-exc-from"
                locale={locale}
                label={d.hrFilterFrom}
                value={excFrom}
                onSelect={setExcFrom}
              />
            </div>
            <div className="w-56">
              <DatePicker
                id="hr-exc-to"
                locale={locale}
                label={d.hrFilterTo}
                value={excTo}
                onSelect={setExcTo}
              />
            </div>
            <div className="w-64">
              <Select
                id="hr-exc-employee"
                label={d.hrColEmployee}
                value={excEmployee}
                onValueChange={setExcEmployee}
                options={[
                  { value: "", label: d.kindFilterAll },
                  ...employeeOptions,
                ]}
              />
            </div>
            <Button
              variant="secondary"
              disabled={
                !DATE_RE.test(excFrom) || !DATE_RE.test(excTo) || excTo < excFrom
              }
              onClick={() => {
                setExcPage(1);
                void loadExceptions(excFrom, excTo, excEmployee, 1);
              }}
            >
              {d.hrApplyBtn}
            </Button>
          </div>
          <p className="text-xs text-gray-600" dir="ltr">
            {formatMessage(d.hrTotalRows, { count: excTotal })}
          </p>
          <DataTable
            columns={[
              {
                id: "date",
                header: activeLocaleHeader(d.hrColDate),
                accessor: (row) => row.workDate,
                sortable: true,
                width: "8rem",
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.workDate}
                  </span>
                ),
              },
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
                id: "status",
                header: activeLocaleHeader(d.hrColStatus),
                accessor: (row) => row.derivedStatus ?? "—",
                render: statusBadge,
              },
              {
                id: "late",
                header: activeLocaleHeader(d.hrColLate),
                accessor: (row) => minutes(row.lateMinutes),
                numeric: true,
                render: (row) => <span dir="ltr">{minutes(row.lateMinutes)}</span>,
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
                id: "punch",
                header: activeLocaleHeader(`${d.hrColCheckIn} → ${d.hrColCheckOut}`),
                accessor: (row) => `${row.checkIn ?? "—"} → ${row.checkOut ?? "—"}`,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.checkIn ?? "—"} → {row.checkOut ?? "—"}
                  </span>
                ),
              },
              {
                id: "note",
                header: activeLocaleHeader(d.hrColNote),
                accessor: (row) => row.note ?? "—",
                render: (row) => row.note ?? "—",
              },
            ]}
            rows={[...excRows]}
            rowKey={(row) => row.id}
            loading={excBusy && excRows.length === 0}
            empty={{ title: d.hrExceptionsEmpty }}
          />
          <Pagination
            page={excPage}
            pageSize={EXCEPTION_PAGE_SIZE}
            total={excTotal}
            onPageChange={(page) => {
              setExcPage(page);
              void loadExceptions(excFrom, excTo, excEmployee, page);
            }}
            announceLabel={formatMessage(d.hrPageOf, {
              current: excPage,
              total: exceptionPages,
            })}
          />
        </div>
      </Card>

      {/* BR-082's one-shot checkout — the only punch-mutating arm. */}
      <Dialog
        open={checkoutTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCheckoutTarget(null);
        }}
        title={d.hrCheckoutBtn}
      >
        <div className="flex flex-col gap-3">
          {checkoutError !== null && <ErrorNotice>{checkoutError}</ErrorNotice>}
          <p className="text-sm text-gray-700">
            {checkoutTarget === null ? "" : `${checkoutTarget.employeeCode} · ${checkoutTarget.employeeName}`}
          </p>
          <Input
            id="hr-checkout-time"
            label={d.hrCheckoutAt}
            value={checkoutTime}
            onValueChange={setCheckoutTime}
            placeholder="17:00"
            hint={d.hrTimeHint}
            mono
            bidiIsolate
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCheckoutTarget(null)} disabled={checkoutBusy}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" onClick={() => void checkout()} loading={checkoutBusy}>
              {d.hrCheckoutBtn}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
