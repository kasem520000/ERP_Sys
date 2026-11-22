"use client";

/**
 * PHASE-049 (W-21 — T-14) — the tags admin (the /assets/scan page's second
 * section): the signed-QR tag register per asset — the issue flow
 * (quantity 1-50), the print sheet (the W-13 print law through
 * lib/assets-print: every label from the dictionary, the engine's
 * PRE-RENDERED QR data URIs passed through verbatim, docDate "" — zero
 * wall-clock reads), and the single-use print stamp (the CAS order: build
 * the sheet from UNPRINTED tags, print, then stamp each — a
 * TAG_ALREADY_PRINTED refusal refreshes the register).
 *
 * THE ENGINE-OUTPUT LAW (carried as-is from the W-12/W-13/W-20 boards):
 * the code is the engine's own signed token (rendered mono, truncated with
 * the full string in the title), printedAt is the machine's own stamp, and
 * the register read is a PURE read — the board never computes a code.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, Dialog, Input, Select, type DataTableColumn } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  AssetTagRow,
  FixedAssetRow,
  TagPrintSheetPayload,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  joinTagSheetPages,
  tagSheetPages,
} from "../lib/assets-print";
import { printHtmlDocument } from "../lib/print-frame";
import { localizedCmmsTransferError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

/** Quantity 1-50 (the engine's own range). */
const QTY_RE = /^[1-9][0-9]*$/;

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

export function AssetsTagsAdmin({
  locale,
  assets,
}: {
  locale: Locale;
  assets: readonly FixedAssetRow[];
}): JSX.Element {
  const d = getDictionary(locale);

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the register read -------------------------------------------------------
  const [assetId, setAssetId] = useState("");
  const [tags, setTags] = useState<readonly AssetTagRow[] | null>(null);
  const [tagsRefusal, setTagsRefusal] = useState<ApiErrorBody | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);

  // -- the issue dialog -----------------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [createAssetId, setCreateAssetId] = useState("");
  const [createQuantity, setCreateQuantity] = useState("1");
  const [createNote, setCreateNote] = useState("");
  const [createNoteAr, setCreateNoteAr] = useState("");

  // -- the delete confirm ----------------------------------------------------------
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // -- the print sheet (the W-13 print law through lib/assets-print) ------------------
  const [sheet, setSheet] = useState<TagPrintSheetPayload | null>(null);
  const [sheetPages, setSheetPages] = useState<readonly string[] | null>(null);

  const assetLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets) {
      map.set(asset.id, `${asset.code} · ${localizedName(asset.name, asset.nameAr, locale)}`);
    }
    return map;
  }, [assets, locale]);

  const createReady =
    createAssetId !== "" && QTY_RE.test(createQuantity) && Number(createQuantity) >= 1 && Number(createQuantity) <= 50;

  // -- the register read ------------------------------------------------------------

  async function loadTags(targetAssetId: string): Promise<void> {
    if (targetAssetId === "") {
      setTags(null);
      setTagsRefusal(null);
      return;
    }
    setTagsLoading(true);
    const result = await bffFetch<readonly AssetTagRow[]>(
      `assets/tags?assetId=${encodeURIComponent(targetAssetId)}`,
    );
    setTagsLoading(false);
    if (!result.ok) {
      setTagsRefusal(result.error);
      setTags(null);
      return;
    }
    setTagsRefusal(null);
    setTags(result.data);
  }

  async function issueTags(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<readonly AssetTagRow[]>("assets/tags", {
      method: "POST",
      body: {
        assetId: createAssetId,
        quantity: Number(createQuantity),
        note: createNote.trim() === "" ? null : createNote.trim(),
        noteAr: createNoteAr.trim() === "" ? null : createNoteAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCreateOpen(false);
    setCreateQuantity("1");
    setCreateNote("");
    setCreateNoteAr("");
    setNotice(d.assetsTagsCreatedToast);
    // The issue dialog defaults to the register's selected asset; refresh
    // the register when it is the same asset.
    if (createAssetId === assetId) {
      await loadTags(assetId);
    }
  }

  async function deleteTag(tagId: string): Promise<void> {
    setBusy("delete");
    setError(null);
    const result = await bffFetch<undefined>(`assets/tags/${tagId}`, { method: "DELETE" });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDeleteId(null);
    setNotice(d.assetsTagsDeletedToast);
    await loadTags(assetId);
  }

  // -- THE PRINT SHEET (the honest order: build from UNPRINTED, print, then stamp) ------

  async function openPrintSheet(): Promise<void> {
    if (assetId === "") return;
    setBusy("sheet");
    setError(null);
    const result = await bffFetch<TagPrintSheetPayload>(
      `assets/tags/print-sheet?assetId=${encodeURIComponent(assetId)}`,
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
      return;
    }
    // The engine returns the PENDING tags only; each page is the engine's
    // own QR data URI rendered through the versioned a4-document template.
    setSheet(result.data);
    setSheetPages(tagSheetPages(result.data, locale));
  }

  async function printNow(): Promise<void> {
    if (sheet === null || sheetPages === null) return;
    setBusy("print");
    setError(null);
    // ONE print dialog emits every tag, one per page (the joined html).
    printHtmlDocument(joinTagSheetPages(sheetPages));
    // AFTER printing: the CAS stamps — one POST per tag; the stamp is
    // single-use, so a TAG_ALREADY_PRINTED refusal refreshes the register.
    let refused = false;
    for (const tag of sheet.tags) {
      const result = await bffFetch<AssetTagRow>(`assets/tags/${tag.id}/print`, {
        method: "POST",
        body: {},
      });
      if (!result.ok) {
        setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
        refused = true;
        break;
      }
    }
    setBusy(null);
    setSheet(null);
    setSheetPages(null);
    if (!refused) {
      setNotice(d.assetsTagsPrintedToast);
    }
    await loadTags(assetId);
  }

  // -- the register table ---------------------------------------------------------------

  const tagColumns: DataTableColumn<AssetTagRow>[] = [
    {
      id: "code",
      header: activeLocaleHeader(d.assetsTagsColCode),
      accessor: (row) => row.code,
      render: (row) => (
        <span
          className="block max-w-[16rem] truncate font-mono text-xs"
          dir="ltr"
          title={row.code}
        >
          {row.code}
        </span>
      ),
    },
    {
      id: "printedAt",
      header: activeLocaleHeader(d.assetsTagsColPrintedAt),
      accessor: (row) => row.printedAt ?? "—",
      render: (row) =>
        row.printedAt === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <span className="font-mono tabular-nums" dir="ltr" title={row.printedAt}>
            {row.printedAt}
          </span>
        ),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.assetsTagsColStatus),
      accessor: (row) => (row.printedAt === null ? d.assetsTagsPendingBadge : d.assetsTagsPrintedBadge),
      render: (row) =>
        row.printedAt === null ? (
          <Chip tone="neutral">{d.assetsTagsPendingBadge}</Chip>
        ) : (
          <Chip tone="success">{d.assetsTagsPrintedBadge}</Chip>
        ),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.assetsMaintenanceColActions),
      accessor: () => d.assetsTagsDelete,
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setDeleteId(row.id)}>
          {d.assetsTagsDelete}
        </Button>
      ),
    },
  ];

  // -- the render ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      <Card
        title={d.assetsTagsTitle}
        description={d.assetsTagsSubtitle}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setCreateAssetId(assetId);
              setCreateOpen(true);
            }}
          >
            {d.assetsTagsCreate}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-full max-w-md flex-col gap-1 text-sm sm:w-auto">
            {d.assetsMetersColAsset}
            <select
              className="rounded-md border border-default bg-surface-card px-3 py-2"
              value={assetId}
              onChange={(event) => {
                setAssetId(event.target.value);
                void loadTags(event.target.value);
              }}
            >
              <option value="">—</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {assetLabelById.get(asset.id) ?? asset.code}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" disabled={assetId === ""} onClick={() => void loadTags(assetId)}>
            {d.assetsMaintenanceRefresh}
          </Button>
          <Button
            variant="secondary"
            loading={busy === "sheet"}
            disabled={assetId === ""}
            onClick={() => void openPrintSheet()}
          >
            {d.assetsTagsPrintSheet}
          </Button>
        </div>
      </Card>

      {tagsLoading ? <p className="text-sm text-gray-600">…</p> : null}

      {tagsRefusal !== null ? (
        <TypedRefusalPanel
          error={tagsRefusal}
          title={d.assetsMaintenanceRefusalTitle}
          detailsLabel={d.assetsMaintenanceRefusalDetails}
        />
      ) : null}

      {tagsRefusal === null && tags !== null ? (
        tags.length === 0 ? (
          <p className="text-sm text-gray-600">{d.assetsTagsEmpty}</p>
        ) : (
          <DataTable columns={tagColumns} rows={[...tags]} rowKey={(row) => row.id} />
        )
      ) : null}

      {/* -- the issue dialog (quantity 1-50) --------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.assetsTagsCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.assetsMetersColAsset}
            value={createAssetId}
            onValueChange={setCreateAssetId}
            placeholder="—"
            options={assets.map((asset) => ({
              value: asset.id,
              label: assetLabelById.get(asset.id) ?? asset.code,
            }))}
            required
          />
          <Input
            label={d.assetsTagsQuantity}
            value={createQuantity}
            onValueChange={setCreateQuantity}
            inputMode="numeric"
            mono
            required
          />
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMetersReadingNote}
              value={createNote}
              onValueChange={setCreateNote}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={`${d.assetsMetersReadingNote} (AR)`}
              value={createNoteAr}
              onValueChange={setCreateNoteAr}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void issueTags()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- the delete confirm --------------------------------------------------------- */}
      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title={d.assetsTagsDeleteTitle}
      >
        <p className="text-sm text-gray-600">{d.assetsTagsDeletedToast}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteId(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "delete"}
            onClick={() => deleteId !== null && void deleteTag(deleteId)}
          >
            {d.assetsTagsDelete}
          </Button>
        </div>
      </Dialog>

      {/* the print preview — the FIRST tag's page (the SAME html the paper
          prints; one print dialog emits every tag, one per page). */}
      <Dialog
        open={sheetPages !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSheet(null);
            setSheetPages(null);
          }
        }}
        title={d.assetsTagsPrintSheetTitle}
        size="lg"
      >
        {sheetPages !== null && sheetPages.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-600">
                {d.assetsTagsPendingBadge}: <span className="font-mono tabular-nums">{sheetPages.length}</span>
              </p>
              <Button
                variant="primary"
                size="sm"
                loading={busy === "print"}
                onClick={() => void printNow()}
              >
                {d.assetsTagsPrintNow}
              </Button>
            </div>
            <iframe
              srcDoc={sheetPages[0]}
              title={d.assetsTagsPrintSheetTitle}
              className="h-[70vh] w-full rounded-md border border-subtle bg-white"
            />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
