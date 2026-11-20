"use client";

/**
 * PHASE-048 (W-13 — T-16) — the field-service dispatch board (the
 * /projects/fieldservice screen body; the 12-template discipline through
 * the house components): the service orders' visits on ONE board — the
 * status machine's own stamps, the pause flag, the W-13 presentation
 * join (the parent order's own number + the technician's own names) —
 * with the status filter and THE SINGLE CLOCK's evaluation panel.
 *
 * THE ENGINE-OUTPUT LAW (carried as-is from the W-12 boards): every
 * figure is an ENGINE OUTPUT rendered VERBATIM — the rows are the W-12
 * listing's own shapes (stamps + the pause flag + the join fields); the
 * SLA panel renders the pure fold's own readings (elapsedMs/pausedMs/
 * targetMs/overMs in the engine's integer milliseconds — the hours view
 * is DISPLAY-ONLY (one 3,600,000 division at display, the exact ms in
 * the title attributes); the escalations render with their dedupe keys
 * and the once-per-(visit, clock) notified flags). ZERO client-side
 * recomputation of any engine number.
 *
 * THE EVALUATION SURFACE (W-12's own design): the listing stays a PURE
 * read; the per-visit "Evaluate SLA" action calls the DEDICATED SLA
 * endpoint — the one surface where BR-096's deduped escalation fires
 * (clicking it on a breached visit is the operator's evaluation act, by
 * design; re-evaluations report notified: false).
 *
 * THE TYPED-REFUSAL PANEL (the shared piece): a refusal renders the
 * code + the message + the FULL details payload — never a generic
 * error. No tabs on this board (one pane) — the 045 defect cannot
 * reach it.
 */
import { useCallback, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  LoadingState,
  type DataTableColumn,
} from "@erp/ui";
import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  ServiceVisitRow,
  SlaClockReading,
  SlaEvaluation,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

/** A canonical decimal/ISO/code cell (display: the exact server string, LTR). */
function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

/** The semantic-tone chip (the billing-history precedent — the ui
 * Badge's tones are the counts/codes pair; states need the semantic
 * classes composed from the app token set). */
type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};
function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/** The ms→hours DISPLAY conversion (one division at display; the exact
 * engine milliseconds ride the title attribute — the display-only law). */
const MS_PER_HOUR = 3_600_000;
function msCell(ms: number, hoursSuffix: string): JSX.Element {
  const hours = (ms / MS_PER_HOUR).toFixed(2);
  return monoCell(`${hours} ${hoursSuffix}`, String(ms));
}

/** The status vocabulary (the machine's fixed enum) — the dictionary's
 * display labels, keyed by the engine's own value. */
const STATUS_KEYS: Record<string, keyof ReturnType<typeof getDictionary>> = {
  NEW: "projectsFieldserviceStatusNEW",
  SCHEDULED: "projectsFieldserviceStatusSCHEDULED",
  DISPATCHED: "projectsFieldserviceStatusDISPATCHED",
  IN_PROGRESS: "projectsFieldserviceStatusINPROGRESS",
  COMPLETED: "projectsFieldserviceStatusCOMPLETED",
  CLOSED: "projectsFieldserviceStatusCLOSED",
};

const STATUS_VALUES = [
  "NEW",
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
] as const;

interface BoardState {
  visits: readonly ServiceVisitRow[] | null;
  error: ApiErrorBody | null;
  busy: boolean;
}

interface SlaState {
  visitId: string | null;
  evaluation: SlaEvaluation | null;
  error: ApiErrorBody | null;
  busy: boolean;
}

export function ProjectsFieldserviceBoard({
  locale,
  initialVisits,
  initialError,
}: {
  locale: Locale;
  initialVisits: readonly ServiceVisitRow[] | null;
  initialError: ApiErrorBody | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [state, setState] = useState<BoardState>({
    visits: initialVisits,
    error: initialError,
    busy: false,
  });
  const [sla, setSla] = useState<SlaState>({
    visitId: null,
    evaluation: null,
    error: null,
    busy: false,
  });

  const load = useCallback(async (status: string) => {
    setState((prev) => ({ ...prev, busy: true }));
    const query = status === "" ? "" : `?status=${status}`;
    const result = await bffFetch<ServiceVisitRow[]>(`projects/fieldservice/visits${query}`);
    setState({
      visits: result.ok ? result.data : null,
      error: result.ok ? null : result.error,
      busy: false,
    });
  }, []);

  const evaluate = useCallback(async (visitId: string) => {
    setSla({ visitId, evaluation: null, error: null, busy: true });
    const result = await bffFetch<SlaEvaluation>(`projects/fieldservice/visits/${visitId}/sla`);
    setSla({
      visitId,
      evaluation: result.ok ? result.data : null,
      error: result.ok ? null : result.error,
      busy: false,
    });
  }, []);

  const columns: DataTableColumn<ServiceVisitRow>[] = [
    {
      id: "order",
      header: activeLocaleHeader(d.projectsFieldserviceColOrder),
      accessor: (row) => row.orderNo ?? row.serviceOrderId,
      render: (row) =>
        row.orderNo === undefined ? monoCell(row.serviceOrderId) : monoCell(row.orderNo),
    },
    {
      id: "technician",
      header: activeLocaleHeader(d.projectsFieldserviceColTechnician),
      accessor: (row) =>
        row.technicianName === undefined || row.technicianName === null
          ? "—"
          : localizedName(row.technicianName, row.technicianNameAr ?? null, locale),
    },
    {
      id: "window",
      header: activeLocaleHeader(d.projectsFieldserviceColWindow),
      accessor: (row) => `${row.scheduledStart} → ${row.scheduledEnd}`,
      render: (row) => (
        <span dir="ltr" className="font-mono tabular-nums">
          {row.scheduledStart} → {row.scheduledEnd}
        </span>
      ),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.projectsFieldserviceColStatus),
      accessor: (row) => row.status,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">
            {d[STATUS_KEYS[row.status] ?? "projectsFieldserviceStatusNEW"]}
          </Badge>
          {row.isPaused ? <Chip tone="warning">{d.projectsFieldservicePausedBadge}</Chip> : null}
        </span>
      ),
    },
    {
      id: "dispatched",
      header: activeLocaleHeader(d.projectsFieldserviceColDispatched),
      accessor: (row) => row.dispatchedAt ?? "—",
      render: (row) => (row.dispatchedAt === null ? "—" : monoCell(row.dispatchedAt)),
    },
    {
      id: "responded",
      header: activeLocaleHeader(d.projectsFieldserviceColResponded),
      accessor: (row) => row.firstRespondedAt ?? "—",
      render: (row) => (row.firstRespondedAt === null ? "—" : monoCell(row.firstRespondedAt)),
    },
    {
      id: "started",
      header: activeLocaleHeader(d.projectsFieldserviceColStarted),
      accessor: (row) => row.startedAt ?? "—",
      render: (row) => (row.startedAt === null ? "—" : monoCell(row.startedAt)),
    },
    {
      id: "completed",
      header: activeLocaleHeader(d.projectsFieldserviceColCompleted),
      accessor: (row) => row.completedAt ?? "—",
      render: (row) => (row.completedAt === null ? "—" : monoCell(row.completedAt)),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.projectsFieldserviceColActions),
      accessor: () => d.projectsFieldserviceEvaluate,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => void evaluate(row.id)}>
          {d.projectsFieldserviceEvaluate}
        </Button>
      ),
    },
  ];

  /** One clock's reading — the engine's own figures (the hours view is
   * display-only; the exact ms ride the titles). */
  function clockCard(reading: SlaClockReading, title: string): JSX.Element {
    return (
      <Card title={title}>
        <DefList
          items={[
            {
              term: reading.running ? d.projectsFieldserviceSlaRunning : d.projectsFieldserviceSlaNotRunning,
              children: <Chip tone={reading.running ? "success" : "neutral"}>
                {reading.running ? d.projectsFieldserviceSlaRunning : d.projectsFieldserviceSlaNotRunning}
              </Chip>,
            },
            {
              term: d.projectsFieldserviceSlaElapsed,
              children: msCell(reading.elapsedMs, d.projectsFieldserviceHoursSuffix),
            },
            {
              term: d.projectsFieldserviceSlaPaused,
              children: msCell(reading.pausedMs, d.projectsFieldserviceHoursSuffix),
            },
            {
              term: d.projectsFieldserviceSlaTarget,
              children:
                reading.targetMs === null ? (
                  d.projectsFieldserviceSlaNoTarget
                ) : (
                  msCell(reading.targetMs, d.projectsFieldserviceHoursSuffix)
                ),
            },
            ...(reading.breached
              ? [
                  {
                    term: d.projectsFieldserviceSlaBreached,
                    children: <Chip tone="danger">{d.projectsFieldserviceSlaBreached}</Chip>,
                  },
                  {
                    term: d.projectsFieldserviceSlaOver,
                    children: msCell(reading.overMs, d.projectsFieldserviceHoursSuffix),
                  },
                ]
              : []),
          ]}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.projectsFieldserviceTitle} description={d.projectsFieldserviceSubtitle}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {d.projectsFieldserviceFilterStatus}
            <select
              className="rounded-md border border-default bg-surface-card px-3 py-2"
              value={statusFilter}
              onChange={(event) => {
                const next = event.target.value;
                setStatusFilter(next);
                void load(next);
              }}
            >
              <option value="">{d.projectsFieldserviceStatusAll}</option>
              {STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {d[STATUS_KEYS[status]!]}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" onClick={() => void load(statusFilter)}>
            {d.projectsFieldserviceRefresh}
          </Button>
        </div>
      </Card>

      {state.busy ? <LoadingState /> : null}

      {!state.busy && state.error !== null ? (
        <TypedRefusalPanel
          error={state.error}
          title={d.projectsFieldserviceRefusalTitle}
          detailsLabel={d.projectsFieldserviceRefusalDetails}
        />
      ) : null}

      {!state.busy && state.error === null && state.visits !== null ? (
        state.visits.length === 0 ? (
          <p className="text-sm text-gray-600">{d.projectsFieldserviceNoVisits}</p>
        ) : (
          <DataTable
            columns={columns}
            rows={[...state.visits]}
            rowKey={(row) => row.id}
          />
        )
      ) : null}

      {sla.visitId !== null ? (
        <Card title={d.projectsFieldserviceSlaTitle}>
          {sla.busy ? (
            <LoadingState />
          ) : sla.error !== null ? (
            <TypedRefusalPanel
              error={sla.error}
              title={d.projectsFieldserviceRefusalTitle}
              detailsLabel={d.projectsFieldserviceRefusalDetails}
            />
          ) : sla.evaluation === null ? null : (
            <div className="flex flex-col gap-4">
              {sla.evaluation.targets === null ? (
                <p className="text-sm text-gray-600">{d.projectsFieldserviceSlaNoTargets}</p>
              ) : (
                <DefList
                  items={[
                    {
                      term: d.projectsFieldserviceSlaTargets,
                      children: monoCell(
                        `${sla.evaluation.targets.responseHours} / ${sla.evaluation.targets.resolutionHours}`,
                      ),
                    },
                  ]}
                />
              )}
              {clockCard(sla.evaluation.response, d.projectsFieldserviceSlaClockResponse)}
              {clockCard(sla.evaluation.resolution, d.projectsFieldserviceSlaClockResolution)}
              <Card title={d.projectsFieldserviceSlaEscalations}>
                {sla.evaluation.escalations.length === 0 ? (
                  <p className="text-sm text-gray-600">{d.projectsFieldserviceSlaNoEscalations}</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {sla.evaluation.escalations.map((escalation) => (
                      <li
                        key={escalation.dedupeKey}
                        className="flex flex-col gap-1 rounded-md border border-subtle px-3 py-2"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <Chip tone="danger">
                            {escalation.clock === "RESPONSE"
                              ? d.projectsFieldserviceSlaClockResponse
                              : d.projectsFieldserviceSlaClockResolution}
                          </Chip>
                          <span>{d.projectsFieldserviceSlaOver}:</span>
                          {msCell(escalation.overMs, d.projectsFieldserviceHoursSuffix)}
                          <span className="flex items-center gap-1">
                            {d.projectsFieldserviceSlaNotified}:
                            <Chip tone={escalation.notified ? "success" : "neutral"}>
                              {String(escalation.notified)}
                            </Chip>
                          </span>
                        </span>
                        <span className="text-xs text-gray-600">
                          {d.projectsFieldserviceSlaDedupeKey}:{" "}
                          <span dir="ltr" className="font-mono">
                            {escalation.dedupeKey}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
