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
 */
import { useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DocumentStatusBadge,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AssetRevaluationRow,
  BranchRow,
  CapitalizeResultRow,
  FixedAssetCategoryRow,
  FixedAssetDetailRow,
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
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";

const FUNDING = ["CREDIT", "CASH", "OPENING"] as const;

export function FixedAssetDetail({
  locale,
  detail,
  category,
  branch,
  custodian,
  partners,
  baseCurrency,
}: {
  locale: Locale;
  detail: FixedAssetDetailRow;
  category: FixedAssetCategoryRow | null;
  branch: BranchRow | null;
  custodian: TenantUserRow | null;
  partners: readonly PartnerRow[];
  baseCurrency: string;
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

  const needsCapitalization = row.sourceType === null || row.sourceId === null;
  const canLifecycle = row.status === "ACTIVE" || row.status === "FULLY_DEPRECIATED";
  const fundingLabel =
    funding === "CREDIT" ? d.faFundingCredit : funding === "CASH" ? d.faFundingCash : d.faFundingOpening;

  async function refreshDetail(): Promise<void> {
    const refreshed = await bffFetch<FixedAssetDetailRow>(`fixed-assets/assets/${row.id}`);
    if (refreshed.ok) {
      setRow(refreshed.data);
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

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card
          title={d.faOverviewTitle}
          actions={
            <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
              {localizedAssetStatus(d, row.status)}
            </Badge>
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
    </div>
  );
}
