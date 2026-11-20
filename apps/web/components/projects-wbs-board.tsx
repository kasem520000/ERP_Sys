"use client";

/**
 * PHASE-048 (W-12 — T-14) — the projects WBS board (the /projects screen
 * body; the 12-template discipline through the house components): the
 * project selector + THREE tabs — the WBS tree (dependencies + the
 * BR-095 leaf-recomputed %-complete), the Gantt-ish timeline, and the
 * EVM tab (the engine's snapshot).
 *
 * THE ENGINE-OUTPUT LAW (the W-12 reading of the owner's clause 2): the
 * board renders the engines' outputs VERBATIM — the tree's
 * rolledPercent/leafCount/weightSum are the W-9 engine's own figures
 * (zero client-side recomputation of any engine number); the EVM tab
 * renders the W-10 snapshot's figures with DISPLAY-ONLY rounding
 * (formatMoneyDisplay at 2dp — the exact engine strings stay in the
 * DOM's title attributes); and every typed refusal renders WITH ITS
 * PAYLOAD (the code + the message + the details rows — the cycle path,
 * the ceiling's figures, the four legs — never a generic error).
 *
 * THE TABS LAW (the 045 self-board defect, not fixed here — the owner's
 * W-12 clause 8): this board uses the DATA-SLOT shape exclusively —
 * every tab pane carries data-slot="{value}" and routes through the
 * slots map, the shape PROVEN immune to the Children.forEach
 * null-overwrite (the W-5 boards' own precedent). The defect is not
 * touched and not aggravated; the proof is the component test beside
 * this file (all three panes render after switching).
 */
import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  DataTable,
  LoadingState,
  Tabs,
  formatMoneyDisplay,
  renderMoneyCell,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  EvmSnapshot,
  EvmNodeRow,
  ProjectPoolRow,
  WbsTreeNode,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** A canonical decimal/ISO cell (display: the exact server string, LTR). */
function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

/** Display-only money rounding at 2dp — the exact engine string rides
 * the title attribute (the engine-precision law). */
function moneyCell(value: string, currency = "SAR"): JSX.Element {
  return monoCell(renderMoneyCell(formatMoneyDisplay(value, 2), currency), value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** THE TYPED-REFUSAL PANEL (the owner's clause 2): the code + the
 * message + the FULL details payload rendered as rows — never a generic
 * error. The payload carries the engine's own figures (the cycle path,
 * the ceiling's numbers, the reconciliation's legs). */
export function TypedRefusalPanel({
  error,
  title,
  detailsLabel,
}: {
  error: ApiErrorBody;
  title: string;
  detailsLabel: string;
}): JSX.Element {
  const rows: { key: string; value: string }[] = [];
  if (isRecord(error.details)) {
    for (const [key, value] of Object.entries(error.details)) {
      rows.push({
        key,
        value:
          typeof value === "string"
            ? value
            : typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : JSON.stringify(value),
      });
    }
  }
  return (
    <div
      role="alert"
      className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-text"
      data-testid="typed-refusal"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 font-mono text-xs" dir="ltr">
        {error.code}
      </p>
      <p className="mt-2">{error.message}</p>
      {rows.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs">{detailsLabel}</p>
          <dl className="mt-1 flex flex-col gap-1">
            {rows.map((row) => (
              <div key={row.key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="font-mono text-xs sm:w-44 sm:shrink-0" dir="ltr">
                  {row.key}
                </dt>
                <dd className="min-w-0 font-mono text-xs" dir="ltr">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

interface BoardState {
  projectId: string;
  tree: WbsTreeNode[] | null;
  treeError: ApiErrorBody | null;
  evm: EvmSnapshot | null;
  evmError: ApiErrorBody | null;
  busy: boolean;
}

/** Flatten the tree depth-first for the table rows (presentation only —
 * the engine's figures ride the nodes verbatim). */
interface FlatRow {
  node: WbsTreeNode;
  depth: number;
}

function flatten(nodes: readonly WbsTreeNode[], depth: number, out: FlatRow[]): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    flatten(node.children, depth + 1, out);
  }
  return out;
}

const DAY_MS = 86_400_000;

export function ProjectsWbsBoard({
  locale,
  initialProjects,
  initialProjectId,
  initialTree,
  initialTreeError,
  initialEvm,
  initialEvmError,
}: {
  locale: Locale;
  initialProjects: readonly ProjectPoolRow[];
  initialProjectId: string | null;
  initialTree: WbsTreeNode[] | null;
  initialTreeError: ApiErrorBody | null;
  initialEvm: EvmSnapshot | null;
  initialEvmError: ApiErrorBody | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const [tab, setTab] = useState("tree");
  const [state, setState] = useState<BoardState>({
    projectId: initialProjectId ?? "",
    tree: initialTree,
    treeError: initialTreeError,
    evm: initialEvm,
    evmError: initialEvmError,
    busy: false,
  });

  const loadProject = useCallback(async (projectId: string) => {
    setState((prev) => ({
      ...prev,
      projectId,
      busy: true,
      tree: null,
      treeError: null,
      evm: null,
      evmError: null,
    }));
    const [tree, evm] = await Promise.all([
      bffFetch<WbsTreeNode[]>(`projects/${projectId}/wbs`),
      bffFetch<EvmSnapshot>(`projects/${projectId}/evm`),
    ]);
    setState((prev) => ({
      ...prev,
      busy: false,
      tree: tree.ok ? tree.data : null,
      treeError: tree.ok ? null : tree.error,
      evm: evm.ok ? evm.data : null,
      evmError: evm.ok ? null : evm.error,
    }));
  }, []);

  const rows = useMemo(() => (state.tree === null ? [] : flatten(state.tree, 0, [])), [state.tree]);

  // The predecessor code map (presentation: the dependency renders by its
  // CODE; the engine's own ids ride the nodes).
  const codeById = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: readonly WbsTreeNode[]): void => {
      for (const node of nodes) {
        map.set(node.id, node.wbsCode);
        walk(node.children);
      }
    };
    if (state.tree !== null) walk(state.tree);
    return map;
  }, [state.tree]);

  const treeColumns: DataTableColumn<FlatRow>[] = [
    {
      id: "code",
      header: activeLocaleHeader(d.projectsBoardColCode),
      accessor: ({ node }) => node.wbsCode,
      render: ({ node, depth }) => (
        <span
          className="flex items-center gap-2"
          style={{ paddingInlineStart: `${depth * 1.25}rem` }}
        >
          {node.isMilestone ? <Badge tone="primary">{d.projectsBoardMilestone}</Badge> : null}
          {monoCell(node.wbsCode)}
        </span>
      ),
    },
    {
      id: "name",
      header: activeLocaleHeader(d.projectsBoardColName),
      accessor: ({ node }) => localizedName(node.name, node.nameAr, locale),
    },
    {
      id: "weight",
      header: activeLocaleHeader(d.projectsBoardColWeight),
      accessor: ({ node }) => node.weight ?? "—",
      render: ({ node }) => (node.weight === null ? "—" : monoCell(node.weight)),
      numeric: true,
    },
    {
      id: "progress",
      header: activeLocaleHeader(d.projectsBoardColProgress),
      accessor: ({ node }) => node.percentComplete,
      render: ({ node }) => (
        <span className="flex items-center gap-2">
          {monoCell(node.percentComplete)}
          {node.children.length > 0 ? (
            <span title={d.projectsBoardRolledPct}>
              <Badge tone="neutral">
                {node.rolledPercent} · {node.leafCount} {d.projectsBoardLeaves}
              </Badge>
            </span>
          ) : null}
        </span>
      ),
      numeric: true,
    },
    {
      id: "schedule",
      header: activeLocaleHeader(d.projectsBoardColSchedule),
      accessor: ({ node }) => `${node.startDate ?? ""}→${node.endDate ?? ""}`,
      render: ({ node }) =>
        node.startDate === null || node.endDate === null ? (
          "—"
        ) : (
          <span dir="ltr" className="font-mono tabular-nums">
            {node.startDate} → {node.endDate}
          </span>
        ),
    },
    {
      id: "depends",
      header: activeLocaleHeader(d.projectsBoardColDependsOn),
      accessor: ({ node }) => node.predecessorTaskId ?? "—",
      render: ({ node }) => {
        if (node.predecessorTaskId === null) return "—";
        const code = codeById.get(node.predecessorTaskId);
        return code === undefined ? "—" : monoCell(code);
      },
    },
  ];

  // The Gantt-ish layout window (presentation of the engine's own dates).
  const timeline = useMemo(() => {
    const dated = rows.filter((row) => row.node.startDate !== null && row.node.endDate !== null);
    const undated = rows
      .filter((row) => row.node.startDate === null || row.node.endDate === null)
      .map((row) => row.node);
    if (dated.length === 0) return { dated, undated, start: 0, span: 1 };
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const { node } of dated) {
      start = Math.min(start, Date.parse(node.startDate!));
      end = Math.max(end, Date.parse(node.endDate!));
    }
    return { dated, undated, start, span: Math.max(end - start, DAY_MS) };
  }, [rows]);

  const evmColumns: DataTableColumn<EvmNodeRow>[] = [
    { id: "code", header: activeLocaleHeader(d.projectsBoardColCode), accessor: (row) => row.wbsCode, render: (row) => monoCell(row.wbsCode) },
    { id: "name", header: activeLocaleHeader(d.projectsBoardColName), accessor: (row) => row.name },
    { id: "planned", header: activeLocaleHeader(d.projectsBoardEvmBudget), accessor: (row) => row.planned, render: (row) => moneyCell(row.planned), numeric: true },
    { id: "pv", header: activeLocaleHeader("PV"), accessor: (row) => row.pv, render: (row) => moneyCell(row.pv), numeric: true },
    { id: "rolled", header: activeLocaleHeader(d.projectsBoardRolledPct), accessor: (row) => row.rolledPercent, render: (row) => monoCell(row.rolledPercent), numeric: true },
    { id: "ev", header: activeLocaleHeader("EV"), accessor: (row) => row.ev, render: (row) => moneyCell(row.ev), numeric: true },
    { id: "ac", header: activeLocaleHeader("AC"), accessor: (row) => row.acLabor, render: (row) => moneyCell(row.acLabor), numeric: true },
    { id: "cpi", header: activeLocaleHeader("CPI"), accessor: (row) => row.cpi ?? "—", render: (row) => (row.cpi === null ? "—" : monoCell(row.cpi)), numeric: true },
    { id: "spi", header: activeLocaleHeader("SPI"), accessor: (row) => row.spi ?? "—", render: (row) => (row.spi === null ? "—" : monoCell(row.spi)), numeric: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.projectsBoardTitle} description={d.projectsBoardSubtitle}>
        {initialProjects.length === 0 ? (
          <p className="text-sm text-gray-600">{d.projectsBoardNoProjects}</p>
        ) : (
          <label className="flex max-w-md flex-col gap-1 text-sm">
            {d.projectsBoardProjectLabel}
            <select
              className="rounded-md border border-default bg-surface-card px-3 py-2"
              value={state.projectId}
              onChange={(event) => {
                const next = event.target.value;
                if (next !== "") void loadProject(next);
              }}
            >
              {initialProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} — {localizedName(project.name, project.nameAr, locale)}
                </option>
              ))}
            </select>
          </label>
        )}
      </Card>

      {state.busy ? <LoadingState /> : null}

      {!state.busy && state.projectId !== "" ? (
        <Tabs
          items={[
            { value: "tree", label: d.projectsBoardTabTree },
            { value: "timeline", label: d.projectsBoardTabTimeline },
            { value: "evm", label: d.projectsBoardTabEvm },
          ]}
          value={tab}
          onValueChange={setTab}
        >
          {/* THE DATA-SLOT SHAPE (the immune Tabs usage — every pane
              routes through the slots map; the 045 conditional-expression
              defect cannot reach this board). */}
          <div data-slot="tree" className="flex flex-col gap-4">
            {state.treeError !== null ? (
              <TypedRefusalPanel
                error={state.treeError}
                title={d.projectsBoardRefusalTitle}
                detailsLabel={d.projectsBoardRefusalDetails}
              />
            ) : rows.length === 0 ? (
              <p className="text-sm text-gray-600">{d.projectsBoardEmptyTree}</p>
            ) : (
              <DataTable columns={treeColumns} rows={rows} rowKey={({ node }) => node.id} />
            )}
          </div>

          <div data-slot="timeline" className="flex flex-col gap-3">
            <p className="text-xs text-gray-600">
              {d.projectsBoardTimelineRange}:{" "}
              <span dir="ltr" className="font-mono">
                {new Date(timeline.start).toISOString().slice(0, 10)} →{" "}
                {new Date(timeline.start + timeline.span).toISOString().slice(0, 10)}
              </span>
            </p>
            <ul className="flex flex-col gap-1.5" aria-label={d.projectsBoardTabTimeline}>
              {timeline.dated.map(({ node, depth }) => {
                const from = Date.parse(node.startDate!);
                const to = Date.parse(node.endDate!);
                const offset = ((from - timeline.start) / timeline.span) * 100;
                const width = (Math.max(to - from, DAY_MS / 4) / timeline.span) * 100;
                return (
                  <li
                    key={node.id}
                    className="flex items-center gap-2 text-xs"
                    style={{ paddingInlineStart: `${depth * 1}rem` }}
                  >
                    <span className="w-24 shrink-0 font-mono" dir="ltr">
                      {node.wbsCode}
                    </span>
                    <span className="relative h-4 flex-1 rounded bg-surface-sunken">
                      <span
                        className={
                          node.isMilestone
                            ? "absolute -top-0.5 h-4 w-4 rotate-45 rounded-sm bg-primary-600"
                            : "absolute top-0 h-4 rounded bg-primary-600"
                        }
                        style={
                          node.isMilestone
                            ? { insetInlineStart: `${Math.min(offset, 99)}%` }
                            : { insetInlineStart: `${offset}%`, width: `${Math.max(width, 0.75)}%` }
                        }
                        title={`${node.startDate} → ${node.endDate} · ${node.percentComplete}`}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-end font-mono" dir="ltr">
                      {node.percentComplete}
                    </span>
                  </li>
                );
              })}
            </ul>
            {timeline.undated.length > 0 ? (
              <p className="text-xs text-gray-600">
                {d.projectsBoardTimelineNoDates}{" "}
                <span dir="ltr" className="font-mono">
                  {timeline.undated.map((node) => node.wbsCode).join(", ")}
                </span>
              </p>
            ) : null}
          </div>

          <div data-slot="evm" className="flex flex-col gap-4">
            {state.evmError !== null ? (
              state.evmError.code === "FORBIDDEN" ? (
                <ErrorNotice>{d.projectsBoardEvmNoAccess}</ErrorNotice>
              ) : (
                <TypedRefusalPanel
                  error={state.evmError}
                  title={d.projectsBoardRefusalTitle}
                  detailsLabel={d.projectsBoardRefusalDetails}
                />
              )
            ) : state.evm === null ? (
              <p className="text-sm text-gray-600">—</p>
            ) : (
              <>
                <Card title={d.projectsBoardTabEvm}>
                  <DefList
                    items={[
                      { term: d.projectsBoardEvmAsOf, children: monoCell(state.evm.asOf) },
                      {
                        term: d.projectsBoardEvmBudget,
                        children: moneyCell(state.evm.budget.approvedTotal),
                      },
                      {
                        term: d.projectsBoardEvmChangeOrders,
                        children: monoCell(
                          `${state.evm.budget.approvedChangeOrders} (+${state.evm.budget.priceDeltaSum})`,
                        ),
                      },
                      { term: d.projectsBoardEvmBac, children: moneyCell(state.evm.budget.bac) },
                      { term: d.projectsBoardEvmPv, children: moneyCell(state.evm.pv) },
                      {
                        term: `${d.projectsBoardEvmEv} — ${d.projectsBoardEvmStructural}`,
                        children:
                          state.evm.ev.structural.percent === null ? (
                            "—"
                          ) : (
                            <span className="flex items-center gap-2">
                              {moneyCell(state.evm.ev.structural.value)}
                              <Badge tone="neutral">{state.evm.ev.structural.percent}</Badge>
                            </span>
                          ),
                      },
                      {
                        term: `${d.projectsBoardEvmEv} — ${d.projectsBoardEvmCertificate}`,
                        children:
                          state.evm.ev.certificate === null ? (
                            d.projectsBoardEvmNoCertificate
                          ) : (
                            <span className="flex items-center gap-2">
                              {moneyCell(state.evm.ev.certificate.value)}
                              <Badge tone="neutral">
                                {state.evm.ev.certificate.cumulativePercent}
                              </Badge>
                            </span>
                          ),
                      },
                      {
                        term: d.projectsBoardEvmDelta,
                        children: state.evm.ev.delta === null ? "—" : moneyCell(state.evm.ev.delta),
                      },
                    ]}
                  />
                </Card>

                <Card title={d.projectsBoardEvmAc}>
                  <DefList
                    items={[
                      { term: d.projectsBoardEvmLegLabor, children: moneyCell(state.evm.ac.labor) },
                      {
                        term: d.projectsBoardEvmLegMaterials,
                        children: moneyCell(state.evm.ac.materials),
                      },
                      {
                        term: d.projectsBoardEvmLegSubcontract,
                        children: moneyCell(state.evm.ac.subcontract),
                      },
                      {
                        term: d.projectsBoardEvmLegOverhead,
                        children: moneyCell(state.evm.ac.overhead),
                      },
                      { term: d.projectsBoardEvmAc, children: moneyCell(state.evm.ac.total) },
                      {
                        term: d.projectsBoardEvmUnpriced,
                        children: monoCell(String(state.evm.ac.unpricedCount)),
                      },
                    ]}
                  />
                  {state.evm.ac.degradedMaterials || state.evm.ac.degradedOverhead ? (
                    <p className="mt-2 text-xs">{d.projectsBoardEvmDegraded}</p>
                  ) : null}
                </Card>

                <Card title={d.projectsBoardEvmEac}>
                  <DefList
                    items={[
                      {
                        term: d.projectsBoardEvmCpi,
                        children:
                          state.evm.indices.cpi === null ? "—" : monoCell(state.evm.indices.cpi),
                      },
                      {
                        term: d.projectsBoardEvmSpi,
                        children:
                          state.evm.indices.spi === null ? "—" : monoCell(state.evm.indices.spi),
                      },
                      { term: d.projectsBoardEvmEtc, children: moneyCell(state.evm.forecast.etc) },
                      { term: d.projectsBoardEvmEac, children: moneyCell(state.evm.forecast.eac) },
                      {
                        term: d.projectsBoardEvmForecastMethod,
                        children: monoCell(state.evm.forecast.method),
                      },
                    ]}
                  />
                </Card>

                {state.evm.nodes.length > 0 ? (
                  <Card title={d.projectsBoardEvmNodes}>
                    <DataTable
                      columns={evmColumns}
                      rows={[...state.evm.nodes]}
                      rowKey={(row) => row.wbsTaskId}
                    />
                  </Card>
                ) : null}

                {state.evm.disclosures.length > 0 ? (
                  <Card title={d.projectsBoardEvmDisclosures}>
                    <ul className="list-disc space-y-1 ps-5 text-xs text-gray-700">
                      {state.evm.disclosures.map((line, index) => (
                        <li key={`${index}-${line.slice(0, 40)}`}>{line}</li>
                      ))}
                    </ul>
                  </Card>
                ) : null}
              </>
            )}
          </div>
        </Tabs>
      ) : null}
    </div>
  );
}
