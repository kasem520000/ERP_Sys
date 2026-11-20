"use client";

/**
 * PHASE-048 (W-13 — T-15) — the projects contracting board (the
 * /projects/contracting screen body; the 12-template discipline through
 * the house components): the project selector + FOUR tabs — the progress
 * certificates (with the BR-093 ceiling card), the retention ledger, the
 * change orders (with the re-baselined ceilings), and the subcontracts
 * (with the selected agreement's certificates).
 *
 * THE ENGINE-OUTPUT LAW (the W-12 board's own reading, carried as-is —
 * the owner's clause 4): every figure is an ENGINE OUTPUT rendered
 * VERBATIM — the ceiling card's cumulativeGross/effectiveContractValue/
 * remaining are the billing engine's own BR-093 figures; the retention
 * rows are the W-11 retention engine's ledger; the change-order rows and
 * ceilings are the W-10 engine's own reads; the certificates' retention/
 * net pair is the engine's BR-092 derivation. ZERO client-side
 * recomputation of any engine number; rounding is DISPLAY-ONLY
 * (formatMoneyDisplay at 2dp — the exact engine strings stay in the
 * title attributes).
 *
 * THE TYPED-REFUSAL PANEL (shared piece, extracted from the W-12 board):
 * a refusal renders the code + the message + the FULL details payload —
 * never a generic error; the change-orders tab rides its OWN key
 * (projects.change_order.view) and degrades to the honest no-permission
 * notice on 403 (the EVM-tab precedent).
 *
 * THE TABS LAW (the 045 self-board defect, not touched — not
 * aggravated): this board rides the DATA-SLOT shape exclusively (every
 * pane carries data-slot="{value}" and routes through the slots map —
 * the immune shape, the W-12 board's own precedent; the component test's
 * tab-switching arm is the recorded proof).
 */
import { useCallback, useState } from "react";
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
  ChangeOrderCeiling,
  ChangeOrderRow,
  ContractingBillingState,
  ProgressCertificateRow,
  ProjectPoolRow,
  RetentionAccountRow,
  SubcontractAgreementRow,
  SubcontractCertificateRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";
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

/** Display-only money rounding at 2dp — the exact engine string rides
 * the title attribute (the engine-precision law). */
function moneyCell(value: string, currency = "SAR"): JSX.Element {
  return monoCell(renderMoneyCell(formatMoneyDisplay(value, 2), currency), value);
}

/** The engine's own status vocabulary — rendered verbatim (mono, LTR). */
function statusCell(value: string): JSX.Element {
  return <Badge tone="neutral">{value}</Badge>;
}

/** The certificate-kind vocabulary (the engine's fixed enum) — the
 * dictionary's display labels, keyed by the engine's own value. */
function kindLabel(
  d: ReturnType<typeof getDictionary>,
  kind: string,
): string {
  if (kind === "ADVANCE") return d.projectsContractingKindAdvance;
  if (kind === "FINAL") return d.projectsContractingKindFinal;
  return d.projectsContractingKindProgress;
}

export interface ContractingSurfaces {
  billing: ContractingBillingState | null;
  billingError: ApiErrorBody | null;
  certificates: readonly ProgressCertificateRow[] | null;
  certificatesError: ApiErrorBody | null;
  retention: readonly RetentionAccountRow[] | null;
  retentionError: ApiErrorBody | null;
  changeOrders: readonly ChangeOrderRow[] | null;
  changeOrdersError: ApiErrorBody | null;
  ceiling: ChangeOrderCeiling | null;
  ceilingError: ApiErrorBody | null;
  subcontracts: readonly SubcontractAgreementRow[] | null;
  subcontractsError: ApiErrorBody | null;
}

interface BoardState extends ContractingSurfaces {
  projectId: string;
  busy: boolean;
}

interface SubCertsState {
  agreementId: string | null;
  rows: SubcontractCertificateRow[] | null;
  error: ApiErrorBody | null;
  busy: boolean;
}

const isForbidden = (error: ApiErrorBody): boolean => error.code === "FORBIDDEN";

export function ProjectsContractingBoard({
  locale,
  initialProjects,
  initialProjectId,
  initialSurfaces,
}: {
  locale: Locale;
  initialProjects: readonly ProjectPoolRow[];
  initialProjectId: string | null;
  initialSurfaces: ContractingSurfaces;
}): JSX.Element {
  const d = getDictionary(locale);
  const [tab, setTab] = useState("certificates");
  const [state, setState] = useState<BoardState>({
    ...initialSurfaces,
    projectId: initialProjectId ?? "",
    busy: false,
  });
  const [subCerts, setSubCerts] = useState<SubCertsState>({
    agreementId: null,
    rows: null,
    error: null,
    busy: false,
  });

  const loadProject = useCallback(async (projectId: string) => {
    setState((prev) => ({ ...prev, projectId, busy: true }));
    const [billing, certificates, retention, changeOrders, ceiling, subcontracts] =
      await Promise.all([
        bffFetch<ContractingBillingState>(`projects/${projectId}/billing`),
        bffFetch<ProgressCertificateRow[]>(`projects/${projectId}/certificates`),
        bffFetch<RetentionAccountRow[]>(`projects/${projectId}/retention`),
        bffFetch<ChangeOrderRow[]>(`projects/${projectId}/change-orders`),
        bffFetch<ChangeOrderCeiling>(`projects/${projectId}/change-orders/ceiling`),
        bffFetch<SubcontractAgreementRow[]>(`projects/${projectId}/subcontracts`),
      ]);
    setState((prev) => ({
      ...prev,
      busy: false,
      billing: billing.ok ? billing.data : null,
      billingError: billing.ok ? null : billing.error,
      certificates: certificates.ok ? certificates.data : null,
      certificatesError: certificates.ok ? null : certificates.error,
      retention: retention.ok ? retention.data : null,
      retentionError: retention.ok ? null : retention.error,
      changeOrders: changeOrders.ok ? changeOrders.data : null,
      changeOrdersError: changeOrders.ok ? null : changeOrders.error,
      ceiling: ceiling.ok ? ceiling.data : null,
      ceilingError: ceiling.ok ? null : ceiling.error,
      subcontracts: subcontracts.ok ? subcontracts.data : null,
      subcontractsError: subcontracts.ok ? null : subcontracts.error,
    }));
    setSubCerts({ agreementId: null, rows: null, error: null, busy: false });
  }, []);

  const loadSubCertificates = useCallback(async (agreementId: string) => {
    setSubCerts((prev) => ({ ...prev, agreementId, busy: true, rows: null, error: null }));
    const result = await bffFetch<SubcontractCertificateRow[]>(
      `projects/subcontracts/${agreementId}/certificates`,
    );
    setSubCerts((prev) => ({
      ...prev,
      busy: false,
      rows: result.ok ? result.data : null,
      error: result.ok ? null : result.error,
    }));
  }, []);

  // -- the certificates tab's columns (the W-11 billing engine's rows) ------
  const certColumns: DataTableColumn<ProgressCertificateRow>[] = [
    {
      id: "no",
      header: activeLocaleHeader(d.projectsContractingCertColNo),
      accessor: (row) => row.certificateNo ?? "—",
      render: (row) => (row.certificateNo === null ? "—" : monoCell(row.certificateNo)),
    },
    {
      id: "date",
      header: activeLocaleHeader(d.projectsContractingCertColDate),
      accessor: (row) => row.certificateDate,
      render: (row) => monoCell(row.certificateDate),
    },
    {
      id: "kind",
      header: activeLocaleHeader(d.projectsContractingCertColKind),
      accessor: (row) => row.kind,
      render: (row) => kindLabel(d, row.kind),
    },
    {
      id: "cumulative",
      header: activeLocaleHeader(d.projectsContractingCertColCumulative),
      accessor: (row) => row.cumulativePercent,
      render: (row) => monoCell(`${row.cumulativePercent}%`),
      numeric: true,
    },
    {
      id: "gross",
      header: activeLocaleHeader(d.projectsContractingCertColGross),
      accessor: (row) => row.grossValue,
      render: (row) => moneyCell(row.grossValue, row.currencyCode),
      numeric: true,
    },
    {
      id: "retention",
      header: activeLocaleHeader(d.projectsContractingCertColRetention),
      accessor: (row) => row.retentionAmount,
      render: (row) => moneyCell(row.retentionAmount, row.currencyCode),
      numeric: true,
    },
    {
      id: "net",
      header: activeLocaleHeader(d.projectsContractingCertColNet),
      accessor: (row) => row.netValue,
      render: (row) => moneyCell(row.netValue, row.currencyCode),
      numeric: true,
    },
    {
      id: "advance",
      header: activeLocaleHeader(d.projectsContractingKindAdvance),
      accessor: (row) => row.advanceAppliedAmount,
      render: (row) => moneyCell(row.advanceAppliedAmount, row.currencyCode),
      numeric: true,
    },
    {
      id: "status",
      header: activeLocaleHeader(d.projectsContractingCertColStatus),
      accessor: (row) => row.status,
      render: (row) => statusCell(row.status),
    },
    {
      id: "approvedAt",
      header: activeLocaleHeader(d.projectsContractingCertColApprovedAt),
      accessor: (row) => row.approvedAt ?? "—",
      render: (row) => (row.approvedAt === null ? "—" : monoCell(row.approvedAt)),
    },
  ];

  // -- the retention tab's columns (the W-11 retention engine's ledger) -----
  const retentionColumns: DataTableColumn<RetentionAccountRow>[] = [
    {
      id: "kind",
      header: activeLocaleHeader(d.projectsContractingRetColKind),
      accessor: (row) => row.kind,
      render: (row) =>
        row.kind === "SUBCONTRACTOR"
          ? d.projectsContractingRetKindSubcontractor
          : d.projectsContractingRetKindCustomer,
    },
    {
      id: "contractValue",
      header: activeLocaleHeader(d.projectsContractingRetColContractValue),
      accessor: (row) => row.contractValue ?? "—",
      render: (row) =>
        row.contractValue === null
          ? "—"
          : moneyCell(row.contractValue, row.currencyCode ?? "SAR"),
      numeric: true,
    },
    {
      id: "holdPercent",
      header: activeLocaleHeader(d.projectsContractingRetColHoldPercent),
      accessor: (row) => row.holdPercent ?? "—",
      render: (row) => (row.holdPercent === null ? "—" : monoCell(`${row.holdPercent}%`)),
      numeric: true,
    },
    {
      id: "accrued",
      header: activeLocaleHeader(d.projectsContractingRetColAccrued),
      accessor: (row) => row.accruedBalance,
      render: (row) => moneyCell(row.accruedBalance, row.currencyCode ?? "SAR"),
      numeric: true,
    },
    {
      id: "released",
      header: activeLocaleHeader(d.projectsContractingRetColReleased),
      accessor: (row) => row.releasedAmount,
      render: (row) => moneyCell(row.releasedAmount, row.currencyCode ?? "SAR"),
      numeric: true,
    },
    {
      id: "takingOver",
      header: activeLocaleHeader(d.projectsContractingRetColTakingOver),
      accessor: (row) => row.takingOverDate ?? "—",
      render: (row) => (row.takingOverDate === null ? "—" : monoCell(row.takingOverDate)),
    },
    {
      id: "defect",
      header: activeLocaleHeader(d.projectsContractingRetColDefectLiability),
      accessor: (row) => row.defectLiabilityDate ?? "—",
      render: (row) => (row.defectLiabilityDate === null ? "—" : monoCell(row.defectLiabilityDate)),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.projectsContractingRetColStatus),
      accessor: (row) => row.status,
      render: (row) => statusCell(row.status),
    },
  ];

  // -- the change-orders tab's columns (the W-10 engine's rows) -------------
  const coColumns: DataTableColumn<ChangeOrderRow>[] = [
    {
      id: "no",
      header: activeLocaleHeader(d.projectsContractingCoColNo),
      accessor: (row) => row.coNo ?? "—",
      render: (row) => (row.coNo === null ? "—" : monoCell(row.coNo)),
    },
    {
      id: "title",
      header: activeLocaleHeader(d.projectsContractingCoColTitle),
      accessor: (row) => localizedName(row.title, row.titleAr, locale),
    },
    {
      id: "priceDelta",
      header: activeLocaleHeader(d.projectsContractingCoColPriceDelta),
      accessor: (row) => row.priceDelta,
      render: (row) => monoCell(row.priceDelta),
      numeric: true,
    },
    {
      id: "scheduleDelta",
      header: activeLocaleHeader(d.projectsContractingCoColScheduleDelta),
      accessor: (row) => (row.scheduleDeltaDays === null ? "—" : String(row.scheduleDeltaDays)),
      render: (row) => (row.scheduleDeltaDays === null ? "—" : monoCell(String(row.scheduleDeltaDays))),
      numeric: true,
    },
    {
      id: "status",
      header: activeLocaleHeader(d.projectsContractingCoColStatus),
      accessor: (row) => row.status,
      render: (row) => statusCell(row.status),
    },
    {
      id: "submittedAt",
      header: activeLocaleHeader(d.projectsContractingCoColSubmittedAt),
      accessor: (row) => row.submittedAt ?? "—",
      render: (row) => (row.submittedAt === null ? "—" : monoCell(row.submittedAt)),
    },
    {
      id: "approvedAt",
      header: activeLocaleHeader(d.projectsContractingCoColApprovedAt),
      accessor: (row) => row.approvedAt ?? "—",
      render: (row) => (row.approvedAt === null ? "—" : monoCell(row.approvedAt)),
    },
  ];

  // -- the subcontracts tab's columns (the W-11 subcontract engine) ----------
  const subColumns: DataTableColumn<SubcontractAgreementRow>[] = [
    {
      id: "no",
      header: activeLocaleHeader(d.projectsContractingSubColNo),
      accessor: (row) => row.agreementNo,
      render: (row) => monoCell(row.agreementNo),
    },
    {
      id: "title",
      header: activeLocaleHeader(d.projectsContractingSubColTitle),
      accessor: (row) => localizedName(row.title, row.titleAr, locale),
    },
    {
      id: "partner",
      header: activeLocaleHeader(d.projectsContractingSubColPartner),
      accessor: (row) => row.partnerId,
      render: (row) => monoCell(row.partnerId),
    },
    {
      id: "value",
      header: activeLocaleHeader(d.projectsContractingSubColValue),
      accessor: (row) => row.agreementValue,
      render: (row) => moneyCell(row.agreementValue, row.currencyCode),
      numeric: true,
    },
    {
      id: "retention",
      header: activeLocaleHeader(d.projectsContractingSubColRetention),
      accessor: (row) => row.retentionPercent,
      render: (row) => monoCell(`${row.retentionPercent}%`),
      numeric: true,
    },
    {
      id: "status",
      header: activeLocaleHeader(d.projectsContractingSubColStatus),
      accessor: (row) => row.status,
      render: (row) => statusCell(row.status),
    },
    {
      id: "start",
      header: activeLocaleHeader(d.projectsContractingSubColStart),
      accessor: (row) => row.startDate ?? "—",
      render: (row) => (row.startDate === null ? "—" : monoCell(row.startDate)),
    },
    {
      id: "end",
      header: activeLocaleHeader(d.projectsContractingSubColEnd),
      accessor: (row) => row.endDate ?? "—",
      render: (row) => (row.endDate === null ? "—" : monoCell(row.endDate)),
    },
  ];

  const subCertColumns: DataTableColumn<SubcontractCertificateRow>[] = [
    {
      id: "no",
      header: activeLocaleHeader(d.projectsContractingSubCertColNo),
      accessor: (row) => row.certificateNo ?? "—",
      render: (row) => (row.certificateNo === null ? "—" : monoCell(row.certificateNo)),
    },
    {
      id: "date",
      header: activeLocaleHeader(d.projectsContractingSubCertColDate),
      accessor: (row) => row.certificateDate,
      render: (row) => monoCell(row.certificateDate),
    },
    {
      id: "percent",
      header: activeLocaleHeader(d.projectsContractingSubCertColPercent),
      accessor: (row) => row.progressPercent,
      render: (row) => monoCell(`${row.progressPercent}%`),
      numeric: true,
    },
    {
      id: "gross",
      header: activeLocaleHeader(d.projectsContractingSubCertColGross),
      accessor: (row) => row.grossValue,
      render: (row) => moneyCell(row.grossValue),
      numeric: true,
    },
    {
      id: "withheld",
      header: activeLocaleHeader(d.projectsContractingSubCertColWithheld),
      accessor: (row) => row.retentionWithheld,
      render: (row) => moneyCell(row.retentionWithheld),
      numeric: true,
    },
    {
      id: "net",
      header: activeLocaleHeader(d.projectsContractingSubCertColNet),
      accessor: (row) => row.netPayable,
      render: (row) => moneyCell(row.netPayable),
      numeric: true,
    },
    {
      id: "status",
      header: activeLocaleHeader(d.projectsContractingSubCertColStatus),
      accessor: (row) => row.status,
      render: (row) => statusCell(row.status),
    },
  ];

  /** A surface's render: the typed refusal, the 403 notice (its own key),
   * or the children when the data stands. */
  function surface(
    data: unknown,
    error: ApiErrorBody | null,
    noAccessMessage: string | null,
    children: () => JSX.Element,
  ): JSX.Element {
    if (error !== null) {
      if (noAccessMessage !== null && isForbidden(error)) {
        return <ErrorNotice>{noAccessMessage}</ErrorNotice>;
      }
      return (
        <TypedRefusalPanel
          error={error}
          title={d.projectsContractingRefusalTitle}
          detailsLabel={d.projectsContractingRefusalDetails}
        />
      );
    }
    if (data === null) {
      return <p className="text-sm text-gray-600">{d.projectsContractingNoData}</p>;
    }
    return children();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.projectsContractingTitle} description={d.projectsContractingSubtitle}>
        {initialProjects.length === 0 ? (
          <p className="text-sm text-gray-600">{d.projectsContractingNoProjects}</p>
        ) : (
          <label className="flex max-w-md flex-col gap-1 text-sm">
            {d.projectsContractingProjectLabel}
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
            { value: "certificates", label: d.projectsContractingTabCertificates },
            { value: "retention", label: d.projectsContractingTabRetention },
            { value: "change-orders", label: d.projectsContractingTabChangeOrders },
            { value: "subcontracts", label: d.projectsContractingTabSubcontracts },
          ]}
          value={tab}
          onValueChange={setTab}
        >
          {/* THE DATA-SLOT SHAPE (the immune Tabs usage — every pane
              routes through the slots map; the 045 conditional-expression
              defect cannot reach this board). */}
          <div data-slot="certificates" className="flex flex-col gap-4">
            {surface(
              state.billing,
              state.billingError,
              null,
              () =>
                state.billing === null ? (
                  <p className="text-sm text-gray-600">{d.projectsContractingNoData}</p>
                ) : (
                  <Card title={d.projectsContractingCeilingTitle}>
                    {state.billing.register === null ? (
                      <p className="text-sm text-gray-600">
                        {d.projectsContractingCeilingNoRegister}
                      </p>
                    ) : (
                      <DefList
                        items={[
                          {
                            term: d.projectsContractingCeilingApproved,
                            children: monoCell(String(state.billing.approvedCertificates)),
                          },
                          {
                            term: d.projectsContractingCeilingCumulative,
                            children: moneyCell(state.billing.cumulativeGross),
                          },
                          {
                            term: d.projectsContractingCeilingEffective,
                            children: moneyCell(state.billing.effectiveContractValue ?? "—"),
                          },
                          {
                            term: d.projectsContractingCeilingRemaining,
                            children: moneyCell(state.billing.remaining ?? "—"),
                          },
                        ]}
                      />
                    )}
                  </Card>
                ),
            )}
            {surface(
              state.certificates,
              state.certificatesError,
              null,
              () => (
                <DataTable
                  columns={certColumns}
                  rows={[...state.certificates!]}
                  rowKey={(row) => row.id}
                />
              ),
            )}
          </div>

          <div data-slot="retention" className="flex flex-col gap-4">
            {surface(
              state.retention,
              state.retentionError,
              null,
              () => (
                <DataTable
                  columns={retentionColumns}
                  rows={[...state.retention!]}
                  rowKey={(row) => row.id}
                />
              ),
            )}
          </div>

          <div data-slot="change-orders" className="flex flex-col gap-4">
            {surface(
              state.ceiling,
              state.ceilingError,
              d.projectsContractingCoNoAccess,
              () =>
                state.ceiling === null ? (
                  <p className="text-sm text-gray-600">{d.projectsContractingNoData}</p>
                ) : (
                  <Card title={d.projectsContractingCoCeilingTitle}>
                    {state.ceiling.contractBase === null ? (
                      <p className="text-sm text-gray-600">{d.projectsContractingCoNoBase}</p>
                    ) : (
                      <DefList
                        items={[
                          {
                            term: d.projectsContractingCoContractBase,
                            children: moneyCell(
                              state.ceiling.contractBase.contractValue,
                              state.ceiling.contractBase.currencyCode,
                            ),
                          },
                          {
                            term: d.projectsContractingCeilingEffective,
                            children: moneyCell(state.ceiling.effectiveContractValue ?? "—"),
                          },
                          {
                            term: d.projectsContractingCoApprovedCount,
                            children: monoCell(String(state.ceiling.approvedChangeOrders)),
                          },
                          {
                            term: d.projectsContractingCoPriceDeltaSum,
                            children: monoCell(state.ceiling.priceDeltaSum),
                          },
                          {
                            term: d.projectsContractingCoBudgetCeiling,
                            children: moneyCell(state.ceiling.budgetCeiling ?? "—"),
                          },
                          {
                            term: d.projectsContractingCoScheduleSum,
                            children: monoCell(String(state.ceiling.scheduleDeltaDaysSum)),
                          },
                        ]}
                      />
                    )}
                  </Card>
                ),
            )}
            {surface(
              state.changeOrders,
              state.changeOrdersError,
              d.projectsContractingCoNoAccess,
              () => (
                <DataTable
                  columns={coColumns}
                  rows={[...state.changeOrders!]}
                  rowKey={(row) => row.id}
                />
              ),
            )}
          </div>

          <div data-slot="subcontracts" className="flex flex-col gap-4">
            {surface(
              state.subcontracts,
              state.subcontractsError,
              null,
              () => (
                <DataTable
                  columns={subColumns}
                  rows={[...state.subcontracts!]}
                  rowKey={(row) => row.id}
                />
              ),
            )}
            <Card title={d.projectsContractingSubCertificates}>
              {state.subcontracts !== null && state.subcontracts.length > 0 ? (
                <>
                  <select
                    aria-label={d.projectsContractingSubCertificates}
                    className="max-w-md rounded-md border border-default bg-surface-card px-3 py-2 text-sm"
                    value={subCerts.agreementId ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next !== "") void loadSubCertificates(next);
                    }}
                  >
                    <option value="">—</option>
                    {state.subcontracts.map((agreement) => (
                      <option key={agreement.id} value={agreement.id}>
                        {agreement.agreementNo} — {localizedName(agreement.title, agreement.titleAr, locale)}
                      </option>
                    ))}
                  </select>
                  {subCerts.busy ? (
                    <LoadingState />
                  ) : subCerts.agreementId === null ? (
                    <p className="mt-3 text-sm text-gray-600">
                      {d.projectsContractingSubNoSelection}
                    </p>
                  ) : subCerts.error !== null ? (
                    <div className="mt-3">
                      <TypedRefusalPanel
                        error={subCerts.error}
                        title={d.projectsContractingRefusalTitle}
                        detailsLabel={d.projectsContractingRefusalDetails}
                      />
                    </div>
                  ) : subCerts.rows !== null && subCerts.rows.length > 0 ? (
                    <div className="mt-3">
                      <DataTable
                        columns={subCertColumns}
                        rows={[...subCerts.rows]}
                        rowKey={(row) => row.id}
                      />
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-gray-600">{d.projectsContractingNoData}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-600">{d.projectsContractingNoData}</p>
              )}
            </Card>
          </div>
        </Tabs>
      ) : null}
    </div>
  );
}
