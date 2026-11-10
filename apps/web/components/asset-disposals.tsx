"use client";

/**
 * PHASE-026 (T13-UI) — disposals list + the disposal wizard (PAGE_ARCHETYPES
 * §9, the wizard archetype — the import-wizard pattern with a 3-chip
 * stepper): step 1 picks the asset (ACTIVE/FULLY_DEPRECIATED only),
 * step 2 sets kind SALE/SCRAP + proceeds (SCRAP demands an explicit
 * zero-proceeds confirmation — never a silent default) + date, step 3 shows
 * the computed review (cost / accumulated / NBV / gain-loss = proceeds −
 * NBV) before submitting the DRAFT. The lifecycle then runs on the draft
 * panel: approve (a SECOND user — the SoD row; the creator cannot approve
 * or post), post (G-23 with the mandatory loss mirror), and the posted
 * voucher renders through the PHASE-013 a4-document print template
 * (iframe srcDoc — the same HTML the renderer prints) with a print action.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DocumentStatusBadge,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";
import { renderA4Document, type A4DocumentPayload, type PrintBranding } from "@erp/ui/print";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AssetDisposalRow, FixedAssetListRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { isPositiveDecimal, isZeroExact, subtractExact } from "../lib/exact-money";
import { printHtmlDocument } from "../lib/print-frame";
import {
  formatMessage,
  localizedName,
  localizedDisposalKind,
  localizedDocumentStatus,
  localizedFixedAssetsError,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const WIZARD_STEPS = [1, 2, 3] as const;

export function AssetDisposals({
  locale,
  baseCurrency,
  initialDisposals,
  assets,
  preselectedAssetId,
  branding,
  today,
}: {
  locale: Locale;
  baseCurrency: string;
  initialDisposals: readonly AssetDisposalRow[];
  assets: readonly FixedAssetListRow[];
  /** From ?asset=:id — the asset-detail "dispose" action lands here preselected. */
  preselectedAssetId: string | null;
  branding: PrintBranding;
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const currency = baseCurrency === "" ? "SAR" : baseCurrency;

  const [rows, setRows] = useState<readonly AssetDisposalRow[]>(initialDisposals);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Wizard state (steps 1–3).
  const [wizardOpen, setWizardOpen] = useState(preselectedAssetId !== null);
  const [step, setStep] = useState<(typeof WIZARD_STEPS)[number]>(1);
  const [assetId, setAssetId] = useState(preselectedAssetId ?? "");
  const [kind, setKind] = useState<"SALE" | "SCRAP">("SALE");
  const [proceeds, setProceeds] = useState("");
  const [scrapZero, setScrapZero] = useState(false);
  const [disposalDate, setDisposalDate] = useState(today);

  // Draft lifecycle state (post-wizard + list row-open).
  const [draft, setDraft] = useState<AssetDisposalRow | null>(null);
  const [voucherHtml, setVoucherHtml] = useState<string | null>(null);

  const eligible = useMemo(
    () => assets.filter((asset) => asset.status === "ACTIVE" || asset.status === "FULLY_DEPRECIATED"),
    [assets],
  );
  const selectedAsset = assets.find((asset) => asset.id === assetId) ?? null;
  const assetLabel = (id: string): string => {
    const asset = assets.find((row) => row.id === id);
    return asset === undefined ? id : `${asset.code} · ${localizedName(asset.name, asset.nameAr, locale)}`;
  };

  /** Computed review (step 3 + the draft panel) — exact string math only. */
  const review = useMemo(() => {
    if (selectedAsset === null) {
      return null;
    }
    return {
      cost: selectedAsset.cost,
      accumulated: selectedAsset.accumulatedToDate,
      nbv: selectedAsset.nbv,
      gainLoss: subtractExact(proceeds.trim() === "" ? "0" : proceeds.trim(), selectedAsset.nbv),
    };
  }, [selectedAsset, proceeds]);

  const step2Valid =
    selectedAsset !== null &&
    disposalDate !== "" &&
    (kind === "SALE"
      ? isPositiveDecimal(proceeds)
      : (isZeroExact(proceeds) && scrapZero) || isPositiveDecimal(proceeds));

  function resetWizard(): void {
    setWizardOpen(false);
    setStep(1);
    setAssetId("");
    setKind("SALE");
    setProceeds("");
    setScrapZero(false);
    setDisposalDate(today);
    setDraft(null);
    setVoucherHtml(null);
  }

  async function refreshList(): Promise<void> {
    const refreshed = await bffFetch<readonly AssetDisposalRow[]>("fixed-assets/disposals?limit=100");
    if (refreshed.ok) {
      setRows(refreshed.data);
    }
  }

  async function submitDraft(): Promise<void> {
    if (selectedAsset === null || !step2Valid) {
      setError(d.errorsValidation);
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("submit");
    const created = await bffFetch<AssetDisposalRow>("fixed-assets/disposals", {
      method: "POST",
      body: {
        assetId: selectedAsset.id,
        kind,
        disposalDate,
        proceeds: kind === "SCRAP" && scrapZero ? "0" : proceeds.trim(),
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedFixedAssetsError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setDraft(created.data);
    setWizardOpen(false);
    setNotice(d.faDispCreatedToast);
    await refreshList();
  }

  async function approveDraft(): Promise<void> {
    if (draft === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("approve");
    const approved = await bffFetch<AssetDisposalRow>(`fixed-assets/disposals/${draft.id}/approve`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!approved.ok) {
      setError(localizedFixedAssetsError(d, approved.error, approved.retryAfterSeconds));
      return;
    }
    setDraft(approved.data);
    setNotice(d.faDispApprovedToast);
    await refreshList();
  }

  async function postDraft(): Promise<void> {
    if (draft === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("post");
    const posted = await bffFetch<AssetDisposalRow>(`fixed-assets/disposals/${draft.id}/post`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!posted.ok) {
      setError(localizedFixedAssetsError(d, posted.error, posted.retryAfterSeconds));
      return;
    }
    setDraft(posted.data);
    setNotice(
      formatMessage(d.faDispPostedToast, {
        no: posted.data.disposalNo ?? "—",
        entry: posted.data.journalEntryId ?? "—",
      }),
    );
    setVoucherHtml(buildVoucherHtml(posted.data));
    await refreshList();
    router.refresh();
  }

  /** The posted voucher — the a4-document print template (PHASE-013). */
  function buildVoucherHtml(posted: AssetDisposalRow): string {
    const postedAsset = assets.find((asset) => asset.id === posted.assetId) ?? null;
    const payload: A4DocumentPayload = {
      template: "a4-document",
      locale,
      title: { ar: "سند استبعاد أصل ثابت", en: "Fixed-asset disposal voucher" },
      docNo: posted.disposalNo ?? "—",
      docDate: posted.disposalDate,
      branding,
      parties: [
        {
          label: { ar: "الأصل", en: "Asset" },
          lines: [
            assetLabel(posted.assetId),
            `${localizedDisposalKind(d, posted.kind)} · ${posted.disposalDate}`,
          ],
        },
      ],
      columns: [
        { label: { ar: "البيان", en: "Description" } },
        { label: { ar: "المبلغ", en: "Amount" }, numeric: true },
      ],
      rows: [
        [d.faDispVoucherTotalsProceeds, posted.proceeds],
        [d.faDispVoucherTotalsAccum, posted.accumulatedSnapshot],
        [d.faDispVoucherTotalsCost, postedAsset?.cost ?? "—"],
        [d.faDispVoucherTotalsGainLoss, posted.gainLoss],
      ],
      totals: [
        { label: { ar: d.faDispColGainLoss, en: d.faDispColGainLoss }, amount: posted.gainLoss },
      ],
    };
    return renderA4Document(payload);
  }

  const stepLabels = [d.faDispStep1, d.faDispStep2, d.faDispStep3];

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.faDisposalsTitle}
        actions={
          <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
            {d.faDispNewButton}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.faDispColNo),
              accessor: (row) => row.disposalNo ?? "",
              mono: true,
              render: (row) =>
                row.disposalNo === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.disposalNo}
                  </span>
                ),
            },
            {
              id: "asset",
              header: activeLocaleHeader(d.faDispColAsset),
              accessor: (row) => assetLabel(row.assetId),
              render: (row) => assetLabel(row.assetId),
            },
            {
              id: "kind",
              header: activeLocaleHeader(d.faDispColKind),
              accessor: (row) => localizedDisposalKind(d, row.kind),
            },
            {
              id: "date",
              header: activeLocaleHeader(d.faDispColDate),
              accessor: (row) => row.disposalDate,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.disposalDate}
                </span>
              ),
            },
            {
              id: "proceeds",
              header: activeLocaleHeader(d.faDispColProceeds),
              accessor: (row) => row.proceeds,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.proceeds, 2)}
                </span>
              ),
            },
            {
              id: "nbv",
              header: activeLocaleHeader(d.faDispColNbv),
              accessor: (row) => row.netBookValue,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.netBookValue, 2)}
                </span>
              ),
            },
            {
              id: "gainLoss",
              header: activeLocaleHeader(d.faDispColGainLoss),
              accessor: (row) => row.gainLoss,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.gainLoss, 2)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <span className="flex flex-wrap items-center gap-2">
                  <DocumentStatusBadge status={row.status} label={localizedDocumentStatus(d, row.status)} />
                  {row.approvedBy !== null && <Badge tone="neutral">{d.accountingApprove}</Badge>}
                </span>
              ),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row) => {
                setDraft(row);
                setVoucherHtml(null);
                setWizardOpen(false);
              },
            },
          ]}
          empty={{ title: d.faDisposalsEmpty }}
        />
      </Card>

      {wizardOpen && (
        <Card title={d.faDispWizardTitle} ariaLabel={d.faDispWizardTitle}>
          <ol className="mb-4 flex flex-wrap items-center gap-2 text-xs" aria-label={d.faDispWizardTitle}>
            {WIZARD_STEPS.map((index) => (
              <li key={index} aria-current={step === index ? "step" : undefined}>
                <span
                  className={
                    step === index
                      ? "rounded-md border border-primary-200 bg-primary-50 px-2 py-1 font-medium text-primary-800"
                      : "rounded-md border border-subtle bg-surface-sunken px-2 py-1 text-gray-600"
                  }
                >
                  {index} · {stepLabels[index - 1]}
                </span>
              </li>
            ))}
          </ol>

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <Select
                id="fa-disp-asset"
                label={d.faDispAssetLabel}
                hint={d.faDispAssetHint}
                value={assetId}
                onValueChange={(value) => {
                  setAssetId(value);
                  setDraft(null);
                }}
                options={[
                  { value: "", label: "—" },
                  ...eligible.map((asset) => ({
                    value: asset.id,
                    label: `${asset.code} · ${localizedName(asset.name, asset.nameAr, locale)} — ${formatMoneyDisplay(asset.nbv, 2)}`,
                  })),
                ]}
                required
              />
              <div className="flex justify-end gap-2 border-t border-subtle pt-3">
                <Button variant="ghost" onClick={resetWizard}>
                  {d.commonCancel}
                </Button>
                <Button variant="primary" disabled={assetId === ""} onClick={() => setStep(2)}>
                  {d.faDispNext}
                </Button>
              </div>
            </div>
          )}

          {step === 2 && selectedAsset !== null && (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  id="fa-disp-kind"
                  label={d.faDispKindLabel}
                  value={kind}
                  onValueChange={(value) => setKind(value === "SCRAP" ? "SCRAP" : "SALE")}
                  options={[
                    { value: "SALE", label: d.faDispKindSale },
                    { value: "SCRAP", label: d.faDispKindScrap },
                  ]}
                  required
                />
                <Input
                  id="fa-disp-date"
                  label={d.faDispDateLabel}
                  value={disposalDate}
                  onValueChange={setDisposalDate}
                  mono
                  bidiIsolate
                  required
                />
              </div>
              <MoneyInput
                id="fa-disp-proceeds"
                label={d.faDispProceedsLabel}
                hint={d.faDispProceedsHint}
                amount={proceeds}
                onAmountChange={setProceeds}
                currency={currency}
                required
              />
              {kind === "SCRAP" && isZeroExact(proceeds) && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={scrapZero} onCheckedChange={(checked) => setScrapZero(checked === true)} />
                  {d.faDispScrapZeroLabel}
                </label>
              )}
              {error !== null && <ErrorNotice>{error}</ErrorNotice>}
              <div className="flex justify-end gap-2 border-t border-subtle pt-3">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  {d.faDispBack}
                </Button>
                <Button variant="primary" disabled={!step2Valid} onClick={() => setStep(3)}>
                  {d.faDispNext}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && review !== null && (
            <div className="flex flex-col gap-3">
              <Card title={d.faDispReviewTitle}>
                <DefList
                  items={[
                    { term: d.faDispReviewCost, children: <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(review.cost, 2)}</span> },
                    { term: d.faDispReviewAccum, children: <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(review.accumulated, 2)}</span> },
                    { term: d.faDispReviewNbv, children: <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(review.nbv, 2)}</span> },
                    { term: d.faDispColProceeds, children: <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(proceeds, 2)}</span> },
                    { term: d.faDispReviewGainLoss, children: <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(review.gainLoss, 2)}</span> },
                  ]}
                />
              </Card>
              <p className="text-xs text-gray-600">{d.faDispProceedsHint}</p>
              <div className="flex justify-end gap-2 border-t border-subtle pt-3">
                <Button variant="secondary" onClick={() => setStep(2)}>
                  {d.faDispBack}
                </Button>
                <Button variant="primary" onClick={() => void submitDraft()} loading={busy === "submit"}>
                  {d.faDispSubmitButton}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {draft !== null && (
        <Card
          title={d.faDispWizardTitle}
          description={assetLabel(draft.assetId)}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              <DocumentStatusBadge status={draft.status} label={localizedDocumentStatus(d, draft.status)} />
              {draft.disposalNo !== null && (
                <span className="font-mono text-sm" dir="ltr">
                  {draft.disposalNo}
                </span>
              )}
            </span>
          }
        >
          <DefList
            items={[
              { term: d.faDispColKind, children: localizedDisposalKind(d, draft.kind) },
              {
                term: d.faDispColDate,
                children: (
                  <span className="font-mono text-sm" dir="ltr">
                    {draft.disposalDate}
                  </span>
                ),
              },
              {
                term: d.faDispColProceeds,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(draft.proceeds, 2)}
                  </span>
                ),
              },
              {
                term: d.faDispColNbv,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(draft.netBookValue, 2)}
                  </span>
                ),
              },
              {
                term: d.faDispColGainLoss,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(draft.gainLoss, 2)}
                  </span>
                ),
              },
              {
                term: d.faJournalEntry,
                children:
                  draft.journalEntryId === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-mono text-xs" dir="ltr">
                      {draft.journalEntryId}
                    </span>
                  ),
              },
            ]}
          />
          <div className="mt-3">
            <InfoNotice>{d.faDispApproveHint}</InfoNotice>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
            {draft.status === "DRAFT" && draft.approvedBy === null && (
              <Button variant="secondary" onClick={() => void approveDraft()} loading={busy === "approve"}>
                {d.faDispApproveButton}
              </Button>
            )}
            {draft.status === "DRAFT" && draft.approvedBy !== null && (
              <Button variant="primary" onClick={() => void postDraft()} loading={busy === "post"}>
                {d.faDispPostButton}
              </Button>
            )}
            {draft.status === "POSTED" && (
              <Button
                variant="secondary"
                onClick={() => setVoucherHtml(buildVoucherHtml(draft))}
              >
                {d.faDispVoucherTitle}
              </Button>
            )}
            <Button variant="ghost" onClick={resetWizard}>
              {d.commonCancel}
            </Button>
          </div>
        </Card>
      )}

      {voucherHtml !== null && (
        <Card
          title={d.faDispVoucherTitle}
          actions={
            <Button variant="secondary" size="sm" onClick={() => printHtmlDocument(voucherHtml)}>
              {d.faDispPrintButton}
            </Button>
          }
        >
          <iframe
            srcDoc={voucherHtml}
            title={d.faDispVoucherTitle}
            className="h-[70vh] w-full rounded-md border border-subtle bg-white"
          />
        </Card>
      )}
    </div>
  );
}
