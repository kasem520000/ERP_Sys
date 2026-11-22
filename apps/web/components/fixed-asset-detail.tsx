"use client";

/**
 * PHASE-026 (T13-UI) — asset detail (PAGE_ARCHETYPES §5, the
 * treasury-doc-detail pattern): the overview + financial DefLists (cost,
 * opening accumulated, accumulated-to-date, NBV — the INV-023 read model),
 * the depreciation-history table over the append-only lines (run status
 * badges; reversed runs marked, lines stay), and the lifecycle actions:
 * capitalize (G-21 funding CREDIT/CASH/OPENING — shown only while the
 * source is missing), revaluate (BR-044 dialog: draft → post, both through
 * the module's own endpoints), and dispose → the disposal wizard
 * (/fixed-assets/disposals?asset=:id preselects the asset).
 *
 * PHASE-049 (W-21 — T-15) — the card extension: THE EXPIRY CHIPS card (the
 * 0108 four), THE COMPONENTS card (+ the parent link), THE COST CENTER
 * row, THE SERVICE HISTORY timeline (one chronology composed client-side
 * from the engine's own reads — work orders, transfers, meter readings;
 * newest first, each entry the engine's own strings, ZERO computation),
 * and THE EDIT DIALOG (one PATCH carrying only the changed 0108 fields).
 * The internal refresh maps the NESTED detail payload the same way the
 * page does (the honest repair of the 044 wire drift).
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Dialog,
  DocumentStatusBadge,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AssetMeterReadingRow,
  AssetMeterRow,
  AssetRevaluationRow,
  AssetTransferRow,
  BranchRow,
  CapitalizeResultRow,
  CostCenterRow,
  FixedAssetCategoryRow,
  FixedAssetDetailPayload,
  FixedAssetDetailRow,
  FixedAssetRow,
  MaintenanceWorkOrderRow,
  PartnerRow,
  TenantUserRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { subtractExact } from "../lib/exact-money";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedAssetStatus,
  localizedDepreciationMethod,
  localizedDocumentStatus,
  localizedFixedAssetsError,
  localizedMaintenanceStatus,
  localizedTransferStatus,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";

const FUNDING = ["CREDIT", "CASH", "OPENING"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The semantic-tone chip (the fieldservice-board precedent). */
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

function shortId(id: string): string {
  return id.slice(0, 8);
}

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

/** One service-history event (the client-side chronology's own entry — the
 * engine's own strings, never a recomputation). */
interface ServiceHistoryEntry {
  id: string;
  date: string;
  kind: "WORK_ORDER" | "READING" | "TRANSFER";
  label: string;
}

export function FixedAssetDetail({
  locale,
  detail,
  category,
  branch,
  custodian,
  partners,
  baseCurrency,
  parentAsset,
  costCenterLabel,
  costCenters,
  assets,
  branches,
}: {
  locale: Locale;
  detail: FixedAssetDetailRow;
  category: FixedAssetCategoryRow | null;
  branch: BranchRow | null;
  custodian: TenantUserRow | null;
  partners: readonly PartnerRow[];
  baseCurrency: string;
  /** The parent-asset row resolved from the page's asset pool (null when
   * unlinked or unresolvable — the card then renders the short id). */
  parentAsset: FixedAssetRow | null;
  /** The 0108 grouping label (the cost-centers pool's own join). */
  costCenterLabel: string | null;
  costCenters: readonly CostCenterRow[];
  assets: readonly FixedAssetRow[];
  branches: readonly BranchRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const currency = baseCurrency === "" ? "SAR" : baseCurrency;

  const [row, setRow] = useState<FixedAssetDetailRow>(detail);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Capitalization state (G-21).
  const [funding, setFunding] = useState<(typeof FUNDING)[number]>("CREDIT");
  const [partnerId, setPartnerId] = useState("");

  // Revaluation state (BR-044): dialog inputs + the created draft row.
  const [revOpen, setRevOpen] = useState(false);
  const [revGross, setRevGross] = useState("");
  const [revAccum, setRevAccum] = useState("");
  const [revReason, setRevReason] = useState("");
  const [revaluation, setRevaluation] = useState<AssetRevaluationRow | null>(null);

  // The 0108 edit dialog (W-21): the four expiry dates (empty = null), the
  // parent-asset select, and the cost-center select — ONE PATCH with only
  // the changed fields.
  const [editOpen, setEditOpen] = useState(false);
  const [editWarranty, setEditWarranty] = useState("");
  const [editInsurance, setEditInsurance] = useState("");
  const [editLicense, setEditLicense] = useState("");
  const [editInspection, setEditInspection] = useState("");
  const [editParentAssetId, setEditParentAssetId] = useState("");
  const [editCostCenterId, setEditCostCenterId] = useState("");

  // THE SERVICE HISTORY (W-21): one chronology composed client-side from
  // the engine's own reads (orders + transfers + per-meter readings);
  // null while loading, [] when the asset has no service events yet.
  const [serviceHistory, setServiceHistory] = useState<readonly ServiceHistoryEntry[] | null>(null);

  const needsCapitalization = row.sourceType === null || row.sourceId === null;
  const canLifecycle = row.status === "ACTIVE" || row.status === "FULLY_DEPRECIATED";
  const fundingLabel =
    funding === "CREDIT" ? d.faFundingCredit : funding === "CASH" ? d.faFundingCash : d.faFundingOpening;

  async function refreshDetail(): Promise<void> {
    // The honest repair (W-21): the detail endpoint returns the NESTED
    // payload — map it the same way the page does (one mapping, one place
    // per boundary; the engine's own figures verbatim).
    const refreshed = await bffFetch<FixedAssetDetailPayload>(`fixed-assets/assets/${row.id}`);
    if (refreshed.ok) {
      const payload = refreshed.data;
      setRow({
        ...payload.asset,
        accumulatedToDate: payload.accumulated,
        nbv: payload.netBookValue,
        history: payload.depreciationHistory,
        components: payload.components,
      });
    }
  }

  async function capitalize(): Promise<void> {
    setError(null);
    setNotice(null);
    if (funding === "CREDIT" && partnerId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("capitalize");
    const posted = await bffFetch<CapitalizeResultRow>(`fixed-assets/assets/${row.id}/capitalize`, {
      method: "POST",
      body: {
        funding,
        ...(funding === "CREDIT" ? { partnerId } : {}),
      },
    });
    setBusy(null);
    if (!posted.ok) {
      setError(localizedFixedAssetsError(d, posted.error, posted.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.faCapitalizePostedToast, {
        entry: posted.data.journalEntryNo ?? posted.data.journalEntryId,
      }),
    );
    await refreshDetail();
  }

  async function createRevaluation(): Promise<void> {
    setError(null);
    setNotice(null);
    if (revGross.trim() === "" || revAccum.trim() === "" || revReason.trim().length < 3) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("reval");
    const created = await bffFetch<AssetRevaluationRow>("fixed-assets/revaluations", {
      method: "POST",
      body: {
        assetId: row.id,
        revaluationDate: new Date().toISOString().slice(0, 10),
        newGrossValue: revGross.trim(),
        newAccumulated: revAccum.trim(),
        reason: revReason.trim(),
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedFixedAssetsError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRevaluation(created.data);
    setRevOpen(false);
    setNotice(d.faRevCreatedToast);
  }

  async function postRevaluation(): Promise<void> {
    if (revaluation === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("reval-post");
    const posted = await bffFetch<AssetRevaluationRow>(
      `fixed-assets/revaluations/${revaluation.id}/post`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!posted.ok) {
      setError(localizedFixedAssetsError(d, posted.error, posted.retryAfterSeconds));
      return;
    }
    setRevaluation(posted.data);
    setNotice(d.faRevPostedToast);
    await refreshDetail();
  }

  const revDeltaPreview =
    revGross.trim() !== "" && revAccum.trim() !== ""
      ? subtractExact(
          subtractExact(revGross.trim(), revAccum.trim()),
          row.nbv,
        )
      : null;

  // The service-history transfer labels: the branches pool's own join (or
  // the honest short id when the pool lacks the branch).
  const branchLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of branches) {
      map.set(entry.id, entry.code);
    }
    return map;
  }, [branches]);

  // The 0108 labels AFTER an edit: the pools re-derive the cost-center
  // label and the parent row from the (patched) row — the page's server
  // props went stale the moment the PATCH returned.
  const activeCostCenterLabel = useMemo(() => {
    if (row.costCenterId === null) return null;
    const center = costCenters.find((entry) => entry.id === row.costCenterId);
    return center === undefined
      ? costCenterLabel
      : `${center.code} · ${localizedName(center.name, center.nameAr, locale)}`;
  }, [row.costCenterId, costCenters, costCenterLabel, locale]);

  const activeParentAsset = useMemo(() => {
    if (row.parentAssetId === null) return null;
    if (parentAsset !== null && parentAsset.id === row.parentAssetId) return parentAsset;
    return assets.find((asset) => asset.id === row.parentAssetId) ?? null;
  }, [row.parentAssetId, parentAsset, assets]);

  // THE SERVICE HISTORY (W-21) — one chronology composed client-side from
  // the engine's own reads: the asset's work orders, its transfers, and
  // its meters' readings (the engine has no combined endpoint). Every
  // entry is the engine's own strings — orderNo + status, meter name +
  // value + effectiveDate, from→to branch codes + status — ZERO
  // computation; the transfer's date is its latest machine stamp
  // (approved → rejected → submitted → created).
  useEffect(() => {
    let cancelled = false;
    async function loadServiceHistory(): Promise<void> {
      const assetId = row.id;
      const [ordersResult, transfersResult, metersResult] = await Promise.all([
        bffFetch<readonly MaintenanceWorkOrderRow[]>(
          `assets/maintenance/orders?assetId=${encodeURIComponent(assetId)}`,
        ),
        bffFetch<readonly AssetTransferRow[]>(
          `assets/transfers?assetId=${encodeURIComponent(assetId)}`,
        ),
        bffFetch<readonly AssetMeterRow[]>(`assets/meters?assetId=${encodeURIComponent(assetId)}`),
      ]);
      if (cancelled) return;
      const orders = ordersResult.ok ? ordersResult.data : [];
      const transfers = transfersResult.ok ? transfersResult.data : [];
      const meters = metersResult.ok ? metersResult.data : [];
      const readingsPerMeter = await Promise.all(
        meters.map(async (meter) => {
          const result = await bffFetch<readonly AssetMeterReadingRow[]>(
            `assets/meters/${meter.id}/readings`,
          );
          return result.ok ? { meter, readings: result.data } : { meter, readings: [] };
        }),
      );
      if (cancelled) return;
      const entries: ServiceHistoryEntry[] = [];
      for (const order of orders) {
        entries.push({
          id: order.id,
          date: order.createdAt,
          kind: "WORK_ORDER",
          label: `${order.orderNo} · ${localizedMaintenanceStatus(d, order.status)}`,
        });
      }
      for (const { meter, readings } of readingsPerMeter) {
        for (const reading of readings) {
          entries.push({
            id: reading.id,
            date: reading.effectiveDate,
            kind: "READING",
            label: `${localizedName(meter.name, meter.nameAr, locale)} · ${reading.value} ${meter.unit} · ${reading.effectiveDate}`,
          });
        }
      }
      for (const transfer of transfers) {
        const stamp =
          transfer.approvedAt ?? transfer.rejectedAt ?? transfer.submittedAt ?? transfer.createdAt;
        entries.push({
          id: transfer.id,
          date: stamp,
          kind: "TRANSFER",
          label: `${branchLabelById.get(transfer.fromBranchId) ?? shortId(transfer.fromBranchId)} → ${branchLabelById.get(transfer.toBranchId) ?? shortId(transfer.toBranchId)} · ${localizedTransferStatus(d, transfer.status)}`,
        });
      }
      entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      setServiceHistory(entries);
    }
    setServiceHistory(null);
    void loadServiceHistory();
    return () => {
      cancelled = true;
    };
  }, [row.id, d, locale, branchLabelById]);

  function openEditDialog(): void {
    setEditWarranty(row.warrantyExpiry ?? "");
    setEditInsurance(row.insuranceExpiry ?? "");
    setEditLicense(row.licenseExpiry ?? "");
    setEditInspection(row.inspectionExpiry ?? "");
    setEditParentAssetId(row.parentAssetId ?? "");
    setEditCostCenterId(row.costCenterId ?? "");
    setEditOpen(true);
  }

  /** THE 0108 EDIT — one PATCH carrying ONLY the changed fields (empty
   * expiry input = null; the engine re-validates everything). */
  async function saveAssetEdit(): Promise<void> {
    const dates: [string, string][] = [
      [editWarranty, row.warrantyExpiry ?? ""],
      [editInsurance, row.insuranceExpiry ?? ""],
      [editLicense, row.licenseExpiry ?? ""],
      [editInspection, row.inspectionExpiry ?? ""],
    ];
    for (const [draft] of dates) {
      if (draft !== "" && !DATE_RE.test(draft)) {
        setError(d.errorsValidation);
        return;
      }
    }
    const body: Record<string, string | null> = {};
    if (editWarranty !== (row.warrantyExpiry ?? "")) {
      body.warrantyExpiry = editWarranty === "" ? null : editWarranty;
    }
    if (editInsurance !== (row.insuranceExpiry ?? "")) {
      body.insuranceExpiry = editInsurance === "" ? null : editInsurance;
    }
    if (editLicense !== (row.licenseExpiry ?? "")) {
      body.licenseExpiry = editLicense === "" ? null : editLicense;
    }
    if (editInspection !== (row.inspectionExpiry ?? "")) {
      body.inspectionExpiry = editInspection === "" ? null : editInspection;
    }
    if (editParentAssetId !== (row.parentAssetId ?? "")) {
      body.parentAssetId = editParentAssetId === "" ? null : editParentAssetId;
    }
    if (editCostCenterId !== (row.costCenterId ?? "")) {
      body.costCenterId = editCostCenterId === "" ? null : editCostCenterId;
    }
    if (Object.keys(body).length === 0) {
      setEditOpen(false);
      return;
    }
    setBusy("assetEdit");
    setError(null);
    // The PATCH returns the updated REGISTER row (FixedAssetRow) — merge it
    // over the current detail row (the financial reads are untouched by
    // the 0108 family; the engine's own figures stay verbatim).
    const result = await bffFetch<FixedAssetRow>(`fixed-assets/assets/${row.id}`, {
      method: "PATCH",
      body,
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedFixedAssetsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEditOpen(false);
    setNotice(d.faAssetSavedToast);
    setRow((current) => ({ ...current, ...result.data }));
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card
          title={d.faOverviewTitle}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                {localizedAssetStatus(d, row.status)}
              </Badge>
              {/* THE 0108 EDIT (W-21) — the documents & linkage dialog's door */}
              <Button variant="secondary" size="sm" onClick={openEditDialog}>
                {d.faAssetEdit}
              </Button>
            </div>
          }
        >
          <DefList
            items={[
              {
                term: d.faColCode,
                children: (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.code}
                  </span>
                ),
              },
              {
                term: d.colName,
                children: localizedName(row.name, row.nameAr, locale),
              },
              {
                term: d.faFilterCategory,
                children: category === null ? row.categoryId : `${category.code} · ${localizedName(category.name, category.nameAr, locale)}`,
              },
              {
                term: d.faFormAcquisitionDate,
                children: (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.acquisitionDate}
                  </span>
                ),
              },
              {
                term: d.faFormMethod,
                children: `${localizedDepreciationMethod(d, row.depreciationMethod)} · ${row.usefulLifeMonths}`,
              },
              ...(row.depreciationMethod === "UNITS_OF_PRODUCTION" && row.totalEstimatedUnits !== null
                ? [
                    {
                      term: d.faFormUnitsTotal,
                      children: (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {row.totalEstimatedUnits}
                        </span>
                      ),
                    },
                  ]
                : []),
              {
                term: d.faColBranch,
                children: branch === null ? row.branchId : localizedName(branch.name, branch.nameAr, locale),
              },
              {
                term: d.faColCustodian,
                children: custodian === null ? "—" : custodian.fullName,
              },
              // THE COST CENTER ROW (W-21 — the 0108 grouping label)
              {
                term: d.faCostCenter,
                children:
                  activeCostCenterLabel ?? <span className="text-muted-foreground">—</span>,
              },
              {
                term: d.faSourceLabel,
                children:
                  needsCapitalization ? (
                    <span className="text-warning-text">{d.faSourceNone}</span>
                  ) : (
                    <span className="font-mono text-xs" dir="ltr">
                      {row.sourceType} · {row.sourceId}
                    </span>
                  ),
              },
              {
                term: d.faFormNote,
                children: row.note ?? <span className="text-muted-foreground">—</span>,
              },
            ]}
          />
        </Card>

        <Card title={d.faFinancialTitle}>
          <DefList
            items={[
              {
                term: d.faFormCost,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(row.cost, 2)} {currency}
                  </span>
                ),
              },
              {
                term: d.faFormSalvage,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(row.salvageValue, 2)}
                  </span>
                ),
              },
              {
                term: d.faFormOpeningAccumulated,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(row.openingAccumulated, 2)}
                  </span>
                ),
              },
              {
                term: d.faAccumulatedCard,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(row.accumulatedToDate, 2)}
                  </span>
                ),
              },
              {
                term: d.faNbvCard,
                children: (
                  <span className="font-mono text-sm font-semibold tabular-nums" dir="ltr">
                    {formatMoneyDisplay(row.nbv, 2)} {currency}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      </div>

      {/* THE EXPIRY CHIPS (W-21 — the 0108 four: the engine's own dates,
          null renders the honest dash) */}
      <Card title={d.faExpiryChipsTitle}>
        <div className="flex flex-wrap gap-2">
          <Chip tone="neutral">{`${d.faWarrantyExpiry}: ${row.warrantyExpiry ?? "—"}`}</Chip>
          <Chip tone="neutral">{`${d.faInsuranceExpiry}: ${row.insuranceExpiry ?? "—"}`}</Chip>
          <Chip tone="neutral">{`${d.faLicenseExpiry}: ${row.licenseExpiry ?? "—"}`}</Chip>
          <Chip tone="neutral">{`${d.faInspectionExpiry}: ${row.inspectionExpiry ?? "—"}`}</Chip>
        </div>
      </Card>

      {/* THE COMPONENTS (W-21 — the component tree's one level + the
          parent link: the parent's own code, never a bare uuid) */}
      <Card title={d.faComponentsTitle}>
        <div className="flex flex-col gap-3">
          <DefList
            items={[
              {
                term: d.faParentAsset,
                children:
                  activeParentAsset !== null ? (
                    <Link
                      href={`/${locale}/fixed-assets/${activeParentAsset.id}`}
                      className="font-mono text-sm underline-offset-2 hover:underline"
                      dir="ltr"
                    >
                      {activeParentAsset.code}
                    </Link>
                  ) : row.parentAssetId !== null ? (
                    <span className="font-mono text-xs" dir="ltr">
                      {shortId(row.parentAssetId)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
            ]}
          />
          {row.components.length === 0 ? (
            <p className="text-sm text-gray-600">{d.faComponentsEmpty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table aria-label={d.faComponentsTitle} className="w-full text-sm">
                <thead>
                  <tr className="border-b border-subtle">
                    <th scope="col" className="px-2 py-1.5 text-start font-medium">
                      {d.faColCode}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-start font-medium">
                      {d.colName}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-start font-medium">
                      {d.colStatus}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {row.components.map((component) => (
                    <tr key={component.id} className="border-b border-subtle/60">
                      <td className="px-2 py-1.5">
                        <Link
                          href={`/${locale}/fixed-assets/${component.id}`}
                          className="font-mono text-sm underline-offset-2 hover:underline"
                          dir="ltr"
                        >
                          {component.code}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5">
                        {localizedName(component.name, component.nameAr, locale)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={component.status === "ACTIVE" ? "primary" : "neutral"}>
                          {localizedAssetStatus(d, component.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* THE SERVICE HISTORY (W-21 — one chronology composed client-side
          from the engine's own reads; newest first; ZERO computation) */}
      <Card title={d.faServiceHistoryTitle}>
        {serviceHistory === null ? (
          <p className="text-sm text-gray-600">…</p>
        ) : serviceHistory.length === 0 ? (
          <p className="text-sm text-gray-600">{d.faServiceHistoryEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {serviceHistory.map((entry) => (
              <li
                key={`${entry.kind}:${entry.id}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-subtle px-3 py-2 text-sm"
              >
                <Chip
                  tone={
                    entry.kind === "WORK_ORDER" ? "info" : entry.kind === "READING" ? "neutral" : "warning"
                  }
                >
                  {entry.kind === "WORK_ORDER"
                    ? d.faServiceHistoryWorkOrder
                    : entry.kind === "READING"
                      ? d.faServiceHistoryReading
                      : d.faServiceHistoryTransfer}
                </Chip>
                <span dir="auto">{entry.label}</span>
                <span className="ms-auto">{monoCell(entry.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={d.faHistoryTitle}>
        {row.history.length === 0 ? (
          <p className="text-sm text-gray-600">{d.faHistoryEmpty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-subtle">
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {d.faHistoryColDate}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {d.faHistoryColAmount}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {d.faHistoryColUnits}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {d.faHistoryColAccumAfter}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {d.colStatus}
                </th>
              </tr>
            </thead>
            <tbody>
              {row.history.map((line) => (
                <tr key={line.id} className="border-b border-subtle/60">
                  <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                    {formatDateTime(line.createdAt, locale)}
                  </td>
                  <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(line.periodAmount, 2)}
                  </td>
                  <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                    {line.periodUnits === null ? "—" : line.periodUnits}
                  </td>
                  <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(line.accumulatedAmount, 2)}
                  </td>
                  <td className="px-2 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <DocumentStatusBadge
                        status={line.runStatus}
                        label={localizedDocumentStatus(d, line.runStatus)}
                      />
                      {line.reversedAt !== null && <Badge tone="neutral">{d.faReversedBadge}</Badge>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {needsCapitalization && (
        <Card title={d.faCapitalizeTitle} description={d.faCapitalizeHint}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                id="fa-cap-funding"
                label={d.faCapitalizeFunding}
                value={funding}
                onValueChange={(value) => setFunding(value as (typeof FUNDING)[number])}
                options={FUNDING.map((option) => ({
                  value: option,
                  label:
                    option === "CREDIT"
                      ? d.faFundingCredit
                      : option === "CASH"
                        ? d.faFundingCash
                        : d.faFundingOpening,
                }))}
              />
              {funding === "CREDIT" ? (
                <Select
                  id="fa-cap-partner"
                  label={d.faCapitalizePartner}
                  value={partnerId}
                  onValueChange={setPartnerId}
                  options={[
                    { value: "", label: "—" },
                    ...partners.map((partner) => ({
                      value: partner.id,
                      label:
                        partner.code === ""
                          ? localizedName(partner.name, partner.nameAr, locale)
                          : `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`,
                    })),
                  ]}
                  required
                />
              ) : (
                <p className="self-end text-xs text-gray-600">{d.faCapitalizeOpeningNote}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void capitalize()} loading={busy === "capitalize"}>
                {d.faCapitalizeButton} · {fundingLabel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {canLifecycle && (
        <Card title={d.faLifecycleTitle}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setRevOpen(true)}>
                {d.faRevaluateTitle}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  window.location.assign(`/${locale}/fixed-assets/disposals?asset=${row.id}`)
                }
              >
                {d.faDispNewButton}
              </Button>
            </div>
            {revaluation !== null && (
              <div className="rounded-md border border-subtle bg-surface-sunken p-3">
                <DefList
                  items={[
                    {
                      term: d.faRevNewGross,
                      children: (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(revaluation.newGrossValue, 2)}
                        </span>
                      ),
                    },
                    {
                      term: d.faRevNewAccum,
                      children: (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(revaluation.newAccumulated, 2)}
                        </span>
                      ),
                    },
                    {
                      term: d.faRevDeltaPreview,
                      children: (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(revaluation.delta, 2)}
                        </span>
                      ),
                    },
                    { term: d.faRevReason, children: revaluation.reason },
                    {
                      term: d.faJournalEntry,
                      children:
                        revaluation.journalEntryId === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="font-mono text-xs" dir="ltr">
                            {revaluation.journalEntryId}
                          </span>
                        ),
                    },
                  ]}
                />
                {revaluation.status === "DRAFT" ? (
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="primary"
                      onClick={() => void postRevaluation()}
                      loading={busy === "reval-post"}
                    >
                      {d.faRevPostButton}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3">
                    <InfoNotice>{d.faRevPostedToast}</InfoNotice>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {revOpen && (
        <Card title={d.faRevaluateTitle}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyInput
                id="fa-rev-gross"
                label={d.faRevNewGross}
                amount={revGross}
                onAmountChange={setRevGross}
                currency={currency}
                required
              />
              <MoneyInput
                id="fa-rev-accum"
                label={d.faRevNewAccum}
                amount={revAccum}
                onAmountChange={setRevAccum}
                currency={currency}
                required
              />
            </div>
            {revDeltaPreview !== null && (
              <p className="text-xs text-gray-600">
                {d.faRevDeltaPreview}:{" "}
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(revDeltaPreview, 2)}
                </span>
              </p>
            )}
            <Input
              id="fa-rev-reason"
              label={`${d.faRevReason} (${d.errorsValidation})`}
              value={revReason}
              onValueChange={setRevReason}
              required
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setRevOpen(false)}>
                {d.commonCancel}
              </Button>
              <Button variant="primary" onClick={() => void createRevaluation()} loading={busy === "reval"}>
                {d.faRevCreateButton}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* THE 0108 EDIT DIALOG (W-21 — one PATCH with only the changed
          fields; empty expiry input = null) */}
      <Dialog open={editOpen} onOpenChange={setEditOpen} title={d.faAssetEditTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.faWarrantyExpiryLabel}
            value={editWarranty}
            onValueChange={setEditWarranty}
            mono
            bidiIsolate
            hint="YYYY-MM-DD"
          />
          <Input
            label={d.faInsuranceExpiryLabel}
            value={editInsurance}
            onValueChange={setEditInsurance}
            mono
            bidiIsolate
            hint="YYYY-MM-DD"
          />
          <Input
            label={d.faLicenseExpiryLabel}
            value={editLicense}
            onValueChange={setEditLicense}
            mono
            bidiIsolate
            hint="YYYY-MM-DD"
          />
          <Input
            label={d.faInspectionExpiryLabel}
            value={editInspection}
            onValueChange={setEditInspection}
            mono
            bidiIsolate
            hint="YYYY-MM-DD"
          />
          <div className="sm:col-span-2">
            <Select
              label={d.faParentAssetLabel}
              value={editParentAssetId}
              onValueChange={setEditParentAssetId}
              placeholder="—"
              options={[
                { value: "", label: "—" },
                ...assets
                  .filter((asset) => asset.id !== row.id)
                  .map((asset) => ({
                    value: asset.id,
                    label: `${asset.code} · ${localizedName(asset.name, asset.nameAr, locale)}`,
                  })),
              ]}
            />
          </div>
          <div className="sm:col-span-2">
            <Select
              label={d.faCostCenterLabel}
              value={editCostCenterId}
              onValueChange={setEditCostCenterId}
              placeholder="—"
              options={[
                { value: "", label: "—" },
                ...costCenters.map((center) => ({
                  value: center.id,
                  label: `${center.code} · ${localizedName(center.name, center.nameAr, locale)}`,
                })),
              ]}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "assetEdit"}
            onClick={() => void saveAssetEdit()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
