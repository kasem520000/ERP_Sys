"use client";

/**
 * PHASE-045 (T-13) — the shifts board (PAGE_ARCHETYPES §2 + §4, the
 * payroll-runs-table pattern): the shift-template register (create/edit
 * PUT + activate/deactivate — HR-04's unique codes) and the roster
 * editor grid (a date × employee pivot over the API's paginated read —
 * the joint-review pagination law; range changes walk pages client-side
 * until hasMore flips false). Cell edits ride PUT roster/cell (a null
 * shift is an explicit MANUAL day-off cell) and POST roster/cell/clear
 * (the delete); the rotation generator rides POST roster/rotation (the
 * 7-slot Monday…Sunday pattern — null = a rostered day off — with the
 * MANUAL-preservation law surfaced in the run toast).
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
  Select,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  EmployeeListRow,
  HrShiftRow,
  RosterCellRow,
  RosterPage,
  RosterRotationResult,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedDayCode,
  localizedHrError,
  localizedHrRosterSource,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 24h time — HH:MM or HH:MM:SS (the API's TIME contract). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const INT_RE = /^\d{1,3}$/;
/** The grid's rendered-column cap (a quarter — the rotation run's cap). */
const MAX_GRID_DAYS = 92;
/** The roster walk's page cap (5000 cells/page — 50k cells honest ceiling). */
const MAX_ROSTER_PAGES = 10;
const ROSTER_PAGE_SIZE = 5000;

function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The ISO weekday code (MON…SUN) for a date — the pattern's axis. */
function isoWeekdayCode(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][day] ?? "MON";
}

export function HrShiftsBoard({
  locale,
  initialShifts,
  initialFrom,
  initialTo,
  initialCells,
  rosterTruncated,
  employees,
}: {
  locale: Locale;
  initialShifts: readonly HrShiftRow[];
  initialFrom: string;
  initialTo: string;
  initialCells: readonly RosterCellRow[];
  rosterTruncated: boolean;
  employees: readonly EmployeeListRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the shift templates --------------------------------------------------------
  const [shiftRows, setShiftRows] = useState<readonly HrShiftRow[]>(initialShifts);
  const [shiftSort, setShiftSort] = useState<DataTableSort[]>([]);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formNameAr, setFormNameAr] = useState("");
  const [formStart, setFormStart] = useState("08:00");
  const [formEnd, setFormEnd] = useState("17:00");
  const [formGrace, setFormGrace] = useState("15");
  const [formBreak, setFormBreak] = useState("60");
  const [formNight, setFormNight] = useState(false);
  const [formNote, setFormNote] = useState("");
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftNotice, setShiftNotice] = useState<string | null>(null);

  const reloadShifts = useCallback(async (): Promise<void> => {
    const result = await bffFetch<readonly HrShiftRow[]>("hr/shifts?limit=500");
    if (!result.ok) {
      setShiftError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setShiftRows(result.data);
  }, [d]);

  function shiftFormValid(): boolean {
    return (
      formCode.trim() !== "" &&
      formName.trim() !== "" &&
      TIME_RE.test(formStart) &&
      TIME_RE.test(formEnd) &&
      INT_RE.test(formGrace) &&
      Number.parseInt(formGrace, 10) >= 0 &&
      Number.parseInt(formGrace, 10) <= 240 &&
      INT_RE.test(formBreak) &&
      Number.parseInt(formBreak, 10) >= 0 &&
      Number.parseInt(formBreak, 10) <= 480
    );
  }

  async function createShift(): Promise<void> {
    setShiftError(null);
    setShiftNotice(null);
    if (!shiftFormValid()) {
      setShiftError(d.budgetFormInvalid);
      return;
    }
    setShiftBusy(true);
    const result = await bffFetch<HrShiftRow>("hr/shifts", {
      method: "POST",
      body: {
        code: formCode.trim(),
        name: formName.trim(),
        ...(formNameAr.trim() === "" ? {} : { nameAr: formNameAr.trim() }),
        startTime: formStart,
        endTime: formEnd,
        graceMinutes: Number.parseInt(formGrace, 10),
        breakMinutes: Number.parseInt(formBreak, 10),
        isNight: formNight,
        ...(formNote.trim() === "" ? {} : { note: formNote.trim() }),
      },
    });
    setShiftBusy(false);
    if (!result.ok) {
      setShiftError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setShiftNotice(d.hrShiftSavedToast);
    toast({ tone: "success", title: d.hrShiftSavedToast });
    setFormCode("");
    setFormName("");
    setFormNameAr("");
    setFormNote("");
    await reloadShifts();
  }

  async function toggleShift(row: HrShiftRow, active: boolean): Promise<void> {
    setShiftError(null);
    setShiftBusy(true);
    const result = await bffFetch<HrShiftRow>(
      `hr/shifts/${row.id}/${active ? "activate" : "deactivate"}`,
      { method: "POST" },
    );
    setShiftBusy(false);
    if (!result.ok) {
      setShiftError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    await reloadShifts();
  }

  // The edit dialog (PUT — the full patch set; nameAr/note/noteAr ride
  // explicitly so the server's null-when-absent arms never clear them).
  const [editTarget, setEditTarget] = useState<HrShiftRow | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editNameAr, setEditNameAr] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editGrace, setEditGrace] = useState("");
  const [editBreak, setEditBreak] = useState("");
  const [editNight, setEditNight] = useState(false);
  const [editNote, setEditNote] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit(row: HrShiftRow): void {
    setEditTarget(row);
    setEditCode(row.code);
    setEditName(row.name);
    setEditNameAr(row.nameAr ?? "");
    setEditStart(row.startTime);
    setEditEnd(row.endTime);
    setEditGrace(String(row.graceMinutes));
    setEditBreak(String(row.breakMinutes));
    setEditNight(row.isNight);
    setEditNote(row.note ?? "");
    setEditError(null);
  }

  async function saveShift(): Promise<void> {
    if (editTarget === null) {
      return;
    }
    setEditError(null);
    if (
      editCode.trim() === "" ||
      editName.trim() === "" ||
      !TIME_RE.test(editStart) ||
      !TIME_RE.test(editEnd) ||
      !INT_RE.test(editGrace) ||
      Number.parseInt(editGrace, 10) < 0 ||
      Number.parseInt(editGrace, 10) > 240 ||
      !INT_RE.test(editBreak) ||
      Number.parseInt(editBreak, 10) < 0 ||
      Number.parseInt(editBreak, 10) > 480
    ) {
      setEditError(d.budgetFormInvalid);
      return;
    }
    setEditBusy(true);
    const result = await bffFetch<HrShiftRow>(`hr/shifts/${editTarget.id}`, {
      method: "PUT",
      body: {
        code: editCode.trim(),
        name: editName.trim(),
        ...(editNameAr.trim() === "" ? {} : { nameAr: editNameAr.trim() }),
        startTime: editStart,
        endTime: editEnd,
        graceMinutes: Number.parseInt(editGrace, 10),
        breakMinutes: Number.parseInt(editBreak, 10),
        isNight: editNight,
        ...(editNote.trim() === "" ? {} : { note: editNote.trim() }),
      },
    });
    setEditBusy(false);
    if (!result.ok) {
      setEditError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.hrShiftSavedToast });
    setEditTarget(null);
    await reloadShifts();
  }

  // -- the roster grid (range changes walk pages through the BFF) --------------------
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [cells, setCells] = useState<readonly RosterCellRow[]>(initialCells);
  const [truncated, setTruncated] = useState(rosterTruncated);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const rosterRunRef = useRef(0);

  const loadRoster = useCallback(
    async (fromValue: string, toValue: string): Promise<void> => {
      const run = rosterRunRef.current + 1;
      rosterRunRef.current = run;
      setRosterBusy(true);
      setRosterError(null);
      const collected: RosterCellRow[] = [];
      let page = 1;
      let more = false;
      for (;;) {
        const result = await bffFetch<RosterPage>(
          `hr/roster?from=${fromValue}&to=${toValue}&page=${page}&pageSize=${ROSTER_PAGE_SIZE}`,
        );
        if (run !== rosterRunRef.current) {
          return; // stale walk — a newer range change superseded it
        }
        if (!result.ok) {
          setRosterError(localizedHrError(d, result.error, result.retryAfterSeconds));
          setRosterBusy(false);
          return;
        }
        collected.push(...result.data.rows);
        more = result.data.hasMore;
        if (!more || page >= MAX_ROSTER_PAGES) {
          break;
        }
        page += 1;
      }
      setCells(collected);
      setTruncated(more);
      setRosterBusy(false);
    },
    [d],
  );

  const gridDates = useMemo(() => {
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) {
      return [];
    }
    const dates: string[] = [];
    let cursor = from;
    while (cursor <= to && dates.length < MAX_GRID_DAYS) {
      dates.push(cursor);
      cursor = addDaysIso(cursor, 1);
    }
    return dates;
  }, [from, to]);

  const gridEmployees = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const cell of cells) {
      if (!map.has(cell.employeeId)) {
        map.set(cell.employeeId, {
          id: cell.employeeId,
          code: cell.employeeCode,
          name: cell.employeeName,
        });
      }
    }
    for (const employee of employees) {
      if (!map.has(employee.id)) {
        map.set(employee.id, {
          id: employee.id,
          code: employee.code,
          name: localizedName(employee.name, employee.nameAr, locale),
        });
      }
    }
    return [...map.values()].sort((left, right) => left.code.localeCompare(right.code));
  }, [cells, employees, locale]);

  const cellMap = useMemo(() => {
    const map = new Map<string, RosterCellRow>();
    for (const cell of cells) {
      map.set(`${cell.employeeId}|${cell.workDate}`, cell);
    }
    return map;
  }, [cells]);

  const activeShifts = useMemo(() => shiftRows.filter((row) => row.active), [shiftRows]);

  // -- the cell editor (PUT roster/cell | POST roster/cell/clear) ---------------------
  const [cellTarget, setCellTarget] = useState<{
    employeeId: string;
    employeeLabel: string;
    workDate: string;
    existing: RosterCellRow | null;
  } | null>(null);
  const [cellShift, setCellShift] = useState("");
  const [cellNote, setCellNote] = useState("");
  const [cellBusy, setCellBusy] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  function openCell(employeeId: string, employeeLabel: string, workDate: string): void {
    const existing = cellMap.get(`${employeeId}|${workDate}`) ?? null;
    setCellTarget({ employeeId, employeeLabel, workDate, existing });
    setCellShift(existing?.shiftId ?? "");
    setCellNote(existing?.note ?? "");
    setCellError(null);
  }

  async function setCell(): Promise<void> {
    if (cellTarget === null) {
      return;
    }
    setCellError(null);
    setCellBusy(true);
    const result = await bffFetch<RosterCellRow>("hr/roster/cell", {
      method: "PUT",
      body: {
        employeeId: cellTarget.employeeId,
        workDate: cellTarget.workDate,
        shiftId: cellShift === "" ? null : cellShift,
        ...(cellNote.trim() === "" ? {} : { note: cellNote.trim() }),
      },
    });
    setCellBusy(false);
    if (!result.ok) {
      setCellError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.hrRosterCellSetToast });
    setCellTarget(null);
    await loadRoster(from, to);
  }

  async function clearCell(): Promise<void> {
    if (cellTarget === null) {
      return;
    }
    setCellError(null);
    setCellBusy(true);
    const result = await bffFetch<{ cleared: boolean }>("hr/roster/cell/clear", {
      method: "POST",
      body: { employeeId: cellTarget.employeeId, workDate: cellTarget.workDate },
    });
    setCellBusy(false);
    if (!result.ok) {
      setCellError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.hrRosterCellClearedToast });
    setCellTarget(null);
    await loadRoster(from, to);
  }

  // -- the rotation generator -----------------------------------------------------
  const [rotEmployees, setRotEmployees] = useState<ReadonlySet<string>>(new Set());
  const [rotPattern, setRotPattern] = useState<string[]>(["", "", "", "", "", "", ""]);
  const [rotFrom, setRotFrom] = useState(initialFrom);
  const [rotTo, setRotTo] = useState(addDaysIso(initialFrom, 13));
  const [rotBusy, setRotBusy] = useState(false);
  const [rotError, setRotError] = useState<string | null>(null);

  function toggleRotEmployee(id: string, checked: boolean): void {
    setRotEmployees((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function applyRotation(): Promise<void> {
    setRotError(null);
    if (
      rotEmployees.size === 0 ||
      !DATE_RE.test(rotFrom) ||
      !DATE_RE.test(rotTo) ||
      rotTo < rotFrom
    ) {
      setRotError(d.hrRotationEmployeesRequired);
      return;
    }
    setRotBusy(true);
    const result = await bffFetch<RosterRotationResult>("hr/roster/rotation", {
      method: "POST",
      body: {
        employeeIds: [...rotEmployees],
        pattern: rotPattern.map((entry) => (entry === "" ? null : entry)),
        startDate: rotFrom,
        endDate: rotTo,
      },
    });
    setRotBusy(false);
    if (!result.ok) {
      setRotError(localizedHrError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.hrRotationDone, {
        cells: result.data.cellsWritten,
        manual: result.data.manualPreserved,
      }),
    });
    await loadRoster(from, to);
  }

  const patternDayCodes = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.hrShiftTemplates}>
        <div className="flex flex-col gap-3">
          {shiftError !== null && <ErrorNotice>{shiftError}</ErrorNotice>}
          {shiftNotice !== null && <SuccessNotice>{shiftNotice}</SuccessNotice>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              id="hr-shift-code"
              label={d.hrColCode}
              value={formCode}
              onValueChange={setFormCode}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-name"
              label={d.hrColName}
              value={formName}
              onValueChange={setFormName}
              required
            />
            <Input
              id="hr-shift-name-ar"
              label={d.hrColNameAr}
              value={formNameAr}
              onValueChange={setFormNameAr}
            />
            <Input
              id="hr-shift-start"
              label={d.hrShiftStart}
              value={formStart}
              onValueChange={setFormStart}
              placeholder="08:00"
              hint={d.hrTimeHint}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-end"
              label={d.hrShiftEnd}
              value={formEnd}
              onValueChange={setFormEnd}
              placeholder="17:00"
              hint={d.hrTimeHint}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-grace"
              label={d.hrShiftGrace}
              value={formGrace}
              onValueChange={setFormGrace}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-break"
              label={d.hrShiftBreak}
              value={formBreak}
              onValueChange={setFormBreak}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-note"
              label={d.hrColNote}
              value={formNote}
              onValueChange={setFormNote}
            />
            <div className="pt-2">
              <Checkbox
                label={d.hrShiftNight}
                checked={formNight}
                onCheckedChange={(checked) => {
                  setFormNight(checked === true);
                }}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void createShift()} loading={shiftBusy}>
              {d.hrShiftNew}
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
                id: "startTime",
                header: activeLocaleHeader(d.hrShiftStart),
                accessor: (row) => row.startTime,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.startTime}
                  </span>
                ),
              },
              {
                id: "endTime",
                header: activeLocaleHeader(d.hrShiftEnd),
                accessor: (row) => row.endTime,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.endTime}
                  </span>
                ),
              },
              {
                id: "graceMinutes",
                header: activeLocaleHeader(d.hrShiftGrace),
                accessor: (row) => String(row.graceMinutes),
                numeric: true,
                render: (row) => <span dir="ltr">{row.graceMinutes}</span>,
              },
              {
                id: "breakMinutes",
                header: activeLocaleHeader(d.hrShiftBreak),
                accessor: (row) => String(row.breakMinutes),
                numeric: true,
                render: (row) => <span dir="ltr">{row.breakMinutes}</span>,
              },
              {
                id: "isNight",
                header: activeLocaleHeader(d.hrShiftNight),
                accessor: (row) => (row.isNight ? "✓" : "—"),
                render: (row) => (row.isNight ? "✓" : "—"),
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
            rows={[...shiftRows]}
            rowKey={(row) => row.id}
            sort={shiftSort}
            onSortChange={setShiftSort}
            empty={{ title: d.hrShiftsEmpty }}
            rowActions={[
              {
                id: "edit",
                label: d.commonEdit,
                onSelect: (row) => openEdit(row),
              },
              {
                id: "activate",
                label: d.hrActivateBtn,
                onSelect: (row) => {
                  if (!row.active) void toggleShift(row, true);
                },
              },
              {
                id: "deactivate",
                label: d.hrDeactivateBtn,
                onSelect: (row) => {
                  if (row.active) void toggleShift(row, false);
                },
              },
            ]}
          />
        </div>
      </Card>

      <Card title={d.hrRosterEditor} description={d.hrRosterGridHint}>
        <div className="flex flex-col gap-3">
          {rosterError !== null && <ErrorNotice>{rosterError}</ErrorNotice>}
          {truncated && (
            <InfoNotice>
              {formatMessage(d.hrRosterTruncated, { cells: cells.length })}
            </InfoNotice>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <DatePicker
                id="hr-roster-from"
                locale={locale}
                label={d.hrFilterFrom}
                value={from}
                onSelect={setFrom}
              />
            </div>
            <div className="w-56">
              <DatePicker
                id="hr-roster-to"
                locale={locale}
                label={d.hrFilterTo}
                value={to}
                onSelect={setTo}
              />
            </div>
            <Button
              variant="secondary"
              disabled={!DATE_RE.test(from) || !DATE_RE.test(to) || to < from}
              loading={rosterBusy}
              onClick={() => {
                void loadRoster(from, to);
              }}
            >
              {d.hrApplyBtn}
            </Button>
          </div>
          {gridDates.length === 0 || gridEmployees.length === 0 ? (
            <InfoNotice>
              {gridEmployees.length === 0 ? d.hrEmployeePoolEmpty : d.hrRosterEmpty}
            </InfoNotice>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border border-subtle">
              <table className="w-full text-sm">
                <caption className="sr-only">{d.hrRosterEditor}</caption>
                <thead className="sticky top-0 bg-surface-sunken">
                  <tr className="border-b border-subtle">
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {d.hrColEmployee}
                    </th>
                    {gridDates.map((date) => (
                      <th key={date} scope="col" className="px-2 py-2 text-center font-medium">
                        <span className="whitespace-nowrap" dir="ltr">
                          {localizedDayCode(d, isoWeekdayCode(date))} {date.slice(5)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridEmployees.map((employee) => (
                    <tr key={employee.id} className="border-b border-subtle">
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className="font-mono text-sm" dir="ltr">
                          {employee.code}
                        </span>{" "}
                        · {employee.name}
                      </td>
                      {gridDates.map((date) => {
                        const cell = cellMap.get(`${employee.id}|${date}`);
                        return (
                          <td key={date} className="px-1 py-1 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                openCell(
                                  employee.id,
                                  `${employee.code} · ${employee.name}`,
                                  date,
                                )
                              }
                              aria-label={`${employee.code} ${date} — ${
                                cell?.shiftCode ?? d.hrRosterCellClearOption
                              }`}
                              className="min-h-[2rem] w-full min-w-[4rem] rounded-md border border-default bg-surface-card px-1 py-0.5 text-xs outline-none transition-colors duration-150 ease-standard hover:border-strong"
                            >
                              <span className="font-mono" dir="ltr">
                                {cell?.shiftCode ?? "—"}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-600">
            {d.hrColSource}: {d.hrRosterSourceRotation} / {d.hrRosterSourceManual}
          </p>
        </div>
      </Card>

      <Card title={d.hrRotationTitle} description={d.hrRotationPatternHint}>
        <div className="flex flex-col gap-3">
          {rotError !== null && <ErrorNotice>{rotError}</ErrorNotice>}
          <div className="grid gap-3 lg:grid-cols-2">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-gray-700">{d.hrRotationEmployees}</legend>
              <div className="max-h-72 overflow-y-auto rounded-md border border-subtle bg-surface-card p-2">
                {gridEmployees.length === 0 ? (
                  <p className="p-2 text-sm text-gray-600">{d.hrEmployeePoolEmpty}</p>
                ) : (
                  gridEmployees.map((employee) => (
                    <div key={employee.id} className="py-0.5">
                      <Checkbox
                        label={`${employee.code} · ${employee.name}`}
                        checked={rotEmployees.has(employee.id)}
                        onCheckedChange={(checked) => {
                          toggleRotEmployee(employee.id, checked === true);
                        }}
                      />
                    </div>
                  ))
                )}
              </div>
            </fieldset>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {patternDayCodes.map((day, index) => (
                  <Select
                    key={day}
                    id={`hr-rotation-${day}`}
                    label={localizedDayCode(d, day)}
                    value={rotPattern[index] ?? ""}
                    onValueChange={(value) => {
                      setRotPattern((previous) => {
                        const next = [...previous];
                        next[index] = value;
                        return next;
                      });
                    }}
                    options={[
                      { value: "", label: d.hrRotationDayOff },
                      ...activeShifts.map((row) => ({
                        value: row.id,
                        label: `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`,
                      })),
                    ]}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-48">
                  <DatePicker
                    id="hr-rotation-from"
                    locale={locale}
                    label={d.hrFilterFrom}
                    value={rotFrom}
                    onSelect={setRotFrom}
                  />
                </div>
                <div className="w-48">
                  <DatePicker
                    id="hr-rotation-to"
                    locale={locale}
                    label={d.hrFilterTo}
                    value={rotTo}
                    onSelect={setRotTo}
                  />
                </div>
                <Button variant="primary" onClick={() => void applyRotation()} loading={rotBusy}>
                  {d.hrRotationApplyBtn}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* The template editor (PUT — the full patch set). */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={`${d.commonEdit} — ${editTarget?.code ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          {editError !== null && <ErrorNotice>{editError}</ErrorNotice>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id="hr-shift-edit-code"
              label={d.hrColCode}
              value={editCode}
              onValueChange={setEditCode}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-edit-name"
              label={d.hrColName}
              value={editName}
              onValueChange={setEditName}
              required
            />
            <Input
              id="hr-shift-edit-name-ar"
              label={d.hrColNameAr}
              value={editNameAr}
              onValueChange={setEditNameAr}
            />
            <Input
              id="hr-shift-edit-start"
              label={d.hrShiftStart}
              value={editStart}
              onValueChange={setEditStart}
              hint={d.hrTimeHint}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-edit-end"
              label={d.hrShiftEnd}
              value={editEnd}
              onValueChange={setEditEnd}
              hint={d.hrTimeHint}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-edit-grace"
              label={d.hrShiftGrace}
              value={editGrace}
              onValueChange={setEditGrace}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-edit-break"
              label={d.hrShiftBreak}
              value={editBreak}
              onValueChange={setEditBreak}
              mono
              bidiIsolate
              required
            />
            <Input
              id="hr-shift-edit-note"
              label={d.hrColNote}
              value={editNote}
              onValueChange={setEditNote}
            />
          </div>
          <Checkbox
            label={d.hrShiftNight}
            checked={editNight}
            onCheckedChange={(checked) => {
              setEditNight(checked === true);
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)} disabled={editBusy}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" onClick={() => void saveShift()} loading={editBusy}>
              {d.commonSave}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* The roster cell editor — set (PUT) or clear (POST). */}
      <Dialog
        open={cellTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCellTarget(null);
        }}
        title={d.hrRosterCellTitle}
      >
        <div className="flex flex-col gap-3">
          {cellError !== null && <ErrorNotice>{cellError}</ErrorNotice>}
          {cellTarget !== null && (
            <>
              <p className="text-sm text-gray-700">
                {cellTarget.employeeLabel} — <span dir="ltr">{cellTarget.workDate}</span>
              </p>
              {cellTarget.existing !== null && (
                <p className="text-xs text-gray-600">
                  {d.hrColSource}: {localizedHrRosterSource(d, cellTarget.existing.source)}
                  {cellTarget.existing.shiftCode === null ? "" : ` · ${cellTarget.existing.shiftCode}`}
                </p>
              )}
              <Select
                id="hr-cell-shift"
                label={d.hrColShift}
                value={cellShift}
                onValueChange={setCellShift}
                options={[
                  { value: "", label: d.hrRosterCellClearOption },
                  ...activeShifts.map((row) => ({
                    value: row.id,
                    label: `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`,
                  })),
                ]}
              />
              <Input
                id="hr-cell-note"
                label={d.hrColNote}
                value={cellNote}
                onValueChange={setCellNote}
              />
              <div className="flex flex-wrap justify-between gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void clearCell()}
                  loading={cellBusy}
                  disabled={cellTarget.existing === null}
                >
                  {d.hrRosterCellClearBtn}
                </Button>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setCellTarget(null)} disabled={cellBusy}>
                    {d.commonCancel}
                  </Button>
                  <Button variant="primary" onClick={() => void setCell()} loading={cellBusy}>
                    {d.hrRosterCellSetBtn}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}
