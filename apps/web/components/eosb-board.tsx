"use client";

/**
 * PHASE-046 (W-5, T-11 — D-16) — the EOSB board (PAGE_ARCHETYPES §11
 * Reconciliation/Health-Center shape, the hr-leave-board pattern): the
 * CALCULATIONS REGISTER (the computation evidence — kind, service years,
 * entitlement, provision balance, the delta, the G-54 journal tie) and
 * the BR-087 RECONCILIATION VIEW (computed entitlement ↔ provision
 * balance ↔ settled at every row; the alignment delta is the honest
 * standing tie — zero means aligned). THE TRUE-UP TRIGGER: the G-54
 * delta-only act through the W-2 engine's own endpoint; the button
 * renders only when the session holds payroll.runs.post (the ledger act
 * rides the ledger key — matrix §3.24, never the payroll.eosb
 * management key).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  Select,
  Tabs,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  EmployeeListRow,
  EosbCalculationRow,
  EosbReconciliationRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedPayrollError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type EosbKind = "OPENING" | "PERIOD_TRUE_UP" | "TERMINATION";

function kindLabel(d: ReturnType<typeof getDictionary>, kind: EosbKind): string {
  if (kind === "OPENING") return d.payEosbKindOpening;
  if (kind === "PERIOD_TRUE_UP") return d.payEosbKindPeriod;
  return d.payEosbKindTermination;
}

function employeeLabel(
  employees: readonly EmployeeListRow[],
  employeeId: string,
  locale: Locale,
): string {
  const found = employees.find((entry) => entry.id === employeeId);
  if (found === undefined) return employeeId;
  return found.code + " · " + localizedName(found.name, found.nameAr, locale);
}

export function EosbBoard({
  locale,
  initialCalculations,
  initialReconciliation,
  employees,
  canTrueUp,
}: {
  locale: Locale;
  initialCalculations: readonly EosbCalculationRow[];
  initialReconciliation: readonly EosbReconciliationRow[];
  employees: readonly EmployeeListRow[];
  /** The session's payroll.runs.post — the true-up trigger's gate. */
  canTrueUp: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState("calculations");
  const [calculations, setCalculations] =
    useState<readonly EosbCalculationRow[]>(initialCalculations);
  const [reconciliation] = useState<readonly EosbReconciliationRow[]>(initialReconciliation);
  const [kindFilter, setKindFilter] = useState("");
  const [sort, setSort] = useState<DataTableSort[]>([]);

  // The true-up dialog (the G-54 act's shape: employee + kind + date + note).
  const [trueUpOpen, setTrueUpOpen] = useState(false);
  const [tuEmployee, setTuEmployee] = useState("");
  const [tuKind, setTuKind] = useState<EosbKind>("PERIOD_TRUE_UP");
  const [tuDate, setTuDate] = useState(new Date().toISOString().slice(0, 10));
  const [tuNote, setTuNote] = useState("");
  const [tuBusy, setTuBusy] = useState(false);
  const [tuError, setTuError] = useState<string | null>(null);

  const shownCalculations = useMemo(
    () => (kindFilter === "" ? calculations : calculations.filter((row) => row.kind === kindFilter)),
    [calculations, kindFilter],
  );

  async function confirmTrueUp(): Promise<void> {
    if (tuEmployee === "" || !DATE_RE.test(tuDate)) {
      setTuError(d.payEosbTrueUpDate);
      return;
    }
    setTuBusy(true);
    setTuError(null);
    const result = await bffFetch("payroll/eosb/true-up", {
      method: "POST",
      body: {
        employeeId: tuEmployee,
        kind: tuKind,
        onDate: tuDate,
        note: tuNote.trim() === "" ? undefined : tuNote.trim(),
      },
    });
    setTuBusy(false);
    if (!result.ok) {
      setTuError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const data = result.data as { calculation: EosbCalculationRow; journalEntryId: string | null; delta: string };
    setCalculations((rows) => [data.calculation, ...rows]);
    setTrueUpOpen(false);
    setTuNote("");
    setTuError(null);
    toast({ tone: "success", title: d.payEosbTrueUpToast });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{d.payEosbSubtitle}</p>
        {canTrueUp ? (
          <Button onClick={() => setTrueUpOpen(true)}>{d.payEosbTrueUp}</Button>
        ) : null}
      </div>
      {!canTrueUp ? <InfoNotice>{d.payEosbTrueUpNoPermission}</InfoNotice> : null}

      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "calculations", label: d.payEosbTabCalculations },
          { value: "reconciliation", label: d.payEosbTabReconciliation },
        ]}
      >
        <div data-slot="calculations">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Select
                value={kindFilter}
                onValueChange={(value) => setKindFilter(value ?? "")}
                options={[
                  { value: "", label: d.payStatutoryAppliesAll },
                  { value: "OPENING", label: d.payEosbKindOpening },
                  { value: "PERIOD_TRUE_UP", label: d.payEosbKindPeriod },
                  { value: "TERMINATION", label: d.payEosbKindTermination },
                ]}
              />
            </div>
            {shownCalculations.length === 0 ? (
              <InfoNotice>{d.payEosbEmpty}</InfoNotice>
            ) : (
              <DataTable
                rows={[...shownCalculations]}
                rowKey={(row) => row.id}
                sort={sort}
                onSortChange={setSort}
                columns={[
                  {
                    id: "employee",
                    header: activeLocaleHeader(d.payEosbTrueUpEmployee),
                    accessor: (row) => employeeLabel(employees, row.employeeId, locale),
                    render: (row) => (
                      <span className="text-sm">{employeeLabel(employees, row.employeeId, locale)}</span>
                    ),
                  },
                  {
                    id: "kind",
                    header: activeLocaleHeader(d.payEosbKind),
                    accessor: (row) => row.kind,
                    render: (row) => <Badge>{kindLabel(d, row.kind)}</Badge>,
                  },
                  {
                    id: "serviceYears",
                    header: activeLocaleHeader(d.payEosbServiceYears),
                    accessor: (row) => row.serviceYears,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.serviceYears}
                      </span>
                    ),
                  },
                  {
                    id: "entitlement",
                    header: activeLocaleHeader(d.payEosbEntitlement),
                    accessor: (row) => row.entitlementAmount,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.entitlementAmount}
                      </span>
                    ),
                  },
                  {
                    id: "provision",
                    header: activeLocaleHeader(d.payEosbProvisionBalance),
                    accessor: (row) => row.provisionBalance,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.provisionBalance}
                      </span>
                    ),
                  },
                  {
                    id: "delta",
                    header: activeLocaleHeader(d.payEosbDelta),
                    accessor: (row) => row.delta,
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.delta}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.payEosbCalcStatus),
                    accessor: (row) => row.status,
                    render: (row) =>
                      row.status === "POSTED" ? (
                        <Badge tone="primary">{d.payEosbCalcStatusPosted}</Badge>
                      ) : (
                        <Badge>{d.payEosbCalcStatusComputed}</Badge>
                      ),
                  },
                  {
                    id: "journal",
                    header: activeLocaleHeader(d.payEosbJournalEntry),
                    accessor: (row) => row.journalEntryId ?? "",
                    mono: true,
                    render: (row) =>
                      row.journalEntryId === null ? (
                        <span>—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {row.journalEntryId.slice(0, 8)}…
                        </span>
                      ),
                  },
                  {
                    id: "entryDate",
                    header: activeLocaleHeader(d.payEosbEntryDate),
                    accessor: (row) => row.entryDate,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.entryDate}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>

        <div data-slot="reconciliation">
          <Card>
            {reconciliation.length === 0 ? (
              <InfoNotice>{d.payEosbReconcileEmpty}</InfoNotice>
            ) : (
              <DataTable
                rows={[...reconciliation]}
                rowKey={(row) => row.employeeId}
                sort={sort}
                onSortChange={setSort}
                columns={[
                  {
                    id: "employee",
                    header: activeLocaleHeader(d.payEosbTrueUpEmployee),
                    accessor: (row) => employeeLabel(employees, row.employeeId, locale),
                    render: (row) => (
                      <span className="text-sm">{employeeLabel(employees, row.employeeId, locale)}</span>
                    ),
                  },
                  {
                    id: "entitlement",
                    header: activeLocaleHeader(d.payEosbEntitlement),
                    accessor: (row) => row.entitlement,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.entitlement}
                      </span>
                    ),
                  },
                  {
                    id: "provision",
                    header: activeLocaleHeader(d.payEosbProvisionBalance),
                    accessor: (row) => row.provisionBalance,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.provisionBalance}
                      </span>
                    ),
                  },
                  {
                    id: "settled",
                    header: activeLocaleHeader(d.payEosbSettled),
                    accessor: (row) => row.settled ?? "",
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.settled ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "alignedDelta",
                    header: activeLocaleHeader(d.payEosbAlignedDelta),
                    accessor: (row) => row.alignedDelta,
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono tabular-nums" dir="ltr">
                          {row.alignedDelta}
                        </span>
                        {row.alignedDelta === "0.0000" ? (
                          <Badge tone="primary">{d.payEosbAlignedBadge}</Badge>
                        ) : (
                          <Badge>{d.payEosbUnalignedBadge}</Badge>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      </Tabs>

      <Dialog
        open={trueUpOpen}
        onOpenChange={setTrueUpOpen}
        title={d.payEosbTrueUpTitle}
      >
        <div className="space-y-3">
          <Select
            label={d.payEosbTrueUpEmployee}
            value={tuEmployee}
            onValueChange={(value) => setTuEmployee(value ?? "")}
            options={employees.map((entry) => ({
              value: entry.id,
              label: entry.code + " · " + localizedName(entry.name, entry.nameAr, locale),
            }))}
          />
          <Select
            label={d.payEosbTrueUpKind}
            value={tuKind}
            onValueChange={(value) => setTuKind((value as EosbKind) ?? "PERIOD_TRUE_UP")}
            options={[
              { value: "OPENING", label: d.payEosbKindOpening },
              { value: "PERIOD_TRUE_UP", label: d.payEosbKindPeriod },
              { value: "TERMINATION", label: d.payEosbKindTermination },
            ]}
          />
          <DatePicker
            locale={locale}
            label={d.payEosbTrueUpDate}
            value={tuDate}
            onSelect={setTuDate}
          />
          <label className="block space-y-1">
            <span className="text-sm font-medium">{d.payEosbTrueUpNote}</span>
            <Input value={tuNote} onValueChange={setTuNote} />
          </label>
          {tuError !== null ? <ErrorNotice>{tuError}</ErrorNotice> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTrueUpOpen(false)}>
              {d.commonCancel}
            </Button>
            <Button onClick={() => void confirmTrueUp()} loading={tuBusy}>
              {d.payEosbTrueUpConfirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
