"use client";

/**
 * PHASE-049 (W-21 — T-14) — the transfers board (the /assets/transfers
 * screen body): the branch-to-branch transfer register with its approval
 * ladder (DRAFT → SUBMITTED → APPROVED/REJECTED), cloned from the W-20
 * board pattern (assets-maintenance-board) — the workspace + lifecycle-bar
 * shape.
 *
 * THE ENGINE-OUTPUT LAW (carried as-is from the W-12/W-13/W-20 boards):
 * every figure is an ENGINE OUTPUT rendered VERBATIM — the ladder's own
 * stamps (submittedAt/approvedAt/rejectedAt), the rejection's own reason,
 * the journal link, and THE G-61 VERDICT's own figures (nbv,
 * journalEntryId, fromAccountId/toAccountId exactly as the approval act
 * returned them). The zero-NBV case (journalEntryId null) renders the
 * engine's own honest note — no fabricated entry. Zero client-side
 * recomputation of any engine number.
 *
 * THE SoD FLOOR (the engine's own law): the creator neither approves nor
 * rejects their own request — the board renders the ladder; the engine
 * refuses the self-approval (TRANSFER_SELF_APPROVAL_BLOCKED rides the
 * typed-failure summary).
 *
 * THE TYPED-REFUSAL PANEL (the shared piece): a refused action renders the
 * code + the message + the FULL details payload through the notices line's
 * localized summary; a refused list read renders the whole
 * TypedRefusalPanel — never a generic error.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  formatMoneyDisplay,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  AssetTransferRow,
  BranchRow,
  FixedAssetRow,
  TransferApprovalResult,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedCmmsTransferError,
  localizedTransferStatus,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const TRANSFER_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;

/** The create-transfer draft (the to-branch floor is client-side only —
 * the engine re-verifies against the asset's live branch). */
interface TransferDraft {
  assetId: string;
  toBranchId: string;
  reason: string;
  reasonAr: string;
  note: string;
  noteAr: string;
}

const EMPTY_TRANSFER: TransferDraft = {
  assetId: "",
  toBranchId: "",
  reason: "",
  reasonAr: "",
  note: "",
  noteAr: "",
};

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

function moneyCell(value: string): JSX.Element {
  return monoCell(formatMoneyDisplay(value, 4), value);
}

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

/** The ladder's own tones: DRAFT neutral, SUBMITTED info, APPROVED success,
 * REJECTED danger. */
function transferStatusChipTone(status: string): ChipTone {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "SUBMITTED") return "info";
  return "neutral";
}

export function AssetsTransfersBoard({
  locale,
  initialTransfers,
  transfersError,
  assets,
  branches,
}: {
  locale: Locale;
  initialTransfers: readonly AssetTransferRow[] | null;
  transfersError: ApiErrorBody | null;
  assets: readonly FixedAssetRow[];
  branches: readonly BranchRow[];
}): JSX.Element {
  const d = getDictionary(locale);

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the listing -----------------------------------------------------------
  const [transfers, setTransfers] = useState<readonly AssetTransferRow[] | null>(initialTransfers);
  const [transfersRefusal, setTransfersRefusal] = useState<ApiErrorBody | null>(transfersError);
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [transferDraft, setTransferDraft] = useState<TransferDraft>({ ...EMPTY_TRANSFER });

  // -- the workspace (the row itself carries the whole ladder) ------------------
  const [workspace, setWorkspace] = useState<AssetTransferRow | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  /** THE G-61 VERDICT — the approval act's own report, rendered verbatim. */
  const [approval, setApproval] = useState<TransferApprovalResult | null>(null);

  // -- the derived pools ---------------------------------------------------------
  const assetLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets) {
      map.set(asset.id, `${asset.code} · ${localizedName(asset.name, asset.nameAr, locale)}`);
    }
    return map;
  }, [assets, locale]);

  const branchLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) {
      map.set(branch.id, `${branch.code} · ${localizedName(branch.name, branch.nameAr, locale)}`);
    }
    return map;
  }, [branches, locale]);

  const branchLabel = (id: string): string => branchLabelById.get(id) ?? shortId(id);

  /** The create dialog's to-branch pool — the asset's current branch is
   * excluded client-side (the floor; the engine re-verifies live). */
  const createAsset = useMemo(
    () => (transferDraft.assetId === "" ? null : assets.find((asset) => asset.id === transferDraft.assetId) ?? null),
    [assets, transferDraft.assetId],
  );
  const toBranchOptions = useMemo(() => {
    const pool = branches.filter((branch) => branch.isActive);
    return (createAsset === null ? pool : pool.filter((branch) => branch.id !== createAsset.branchId)).map(
      (branch) => ({
        value: branch.id,
        label: branchLabelById.get(branch.id) ?? branch.code,
      }),
    );
  }, [branches, branchLabelById, createAsset]);

  const createReady =
    transferDraft.assetId !== "" &&
    transferDraft.toBranchId !== "" &&
    (createAsset === null || transferDraft.toBranchId !== createAsset.branchId) &&
    transferDraft.reason.trim().length >= 1 &&
    transferDraft.reason.trim().length <= 2000;

  const rejectReady = rejectReason.trim().length >= 1 && rejectReason.trim().length <= 2000;

  // -- the listing read ------------------------------------------------------------

  async function loadTransfers(): Promise<void> {
    setListLoading(true);
    const query = statusFilter === "" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
    const result = await bffFetch<readonly AssetTransferRow[]>(`assets/transfers${query}`);
    setListLoading(false);
    if (!result.ok) {
      setTransfersRefusal(result.error);
      setTransfers(null);
      return;
    }
    setTransfersRefusal(null);
    setTransfers(result.data);
  }

  async function createTransfer(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<AssetTransferRow>("assets/transfers", {
      method: "POST",
      body: {
        assetId: transferDraft.assetId,
        toBranchId: transferDraft.toBranchId,
        reason: transferDraft.reason.trim(),
        reasonAr: transferDraft.reasonAr.trim() === "" ? null : transferDraft.reasonAr.trim(),
        note: transferDraft.note.trim() === "" ? null : transferDraft.note.trim(),
        noteAr: transferDraft.noteAr.trim() === "" ? null : transferDraft.noteAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCreateOpen(false);
    setTransferDraft({ ...EMPTY_TRANSFER });
    setNotice(d.assetsTransfersCreatedToast);
    await loadTransfers();
  }

  // -- the ladder's own moves ----------------------------------------------------------

  async function moveTransfer(
    verb: "submit" | "approve" | "reject",
    body: Record<string, unknown>,
    toast: string,
  ): Promise<void> {
    if (workspace === null) return;
    setBusy(verb);
    setError(null);
    const result =
      verb === "reject"
        ? await bffFetch<AssetTransferRow>(`assets/transfers/${workspace.id}/reject`, {
            method: "POST",
            body,
          })
        : verb === "approve"
          ? await bffFetch<TransferApprovalResult>(`assets/transfers/${workspace.id}/approve`, {
              method: "POST",
              body,
            })
          : await bffFetch<AssetTransferRow>(`assets/transfers/${workspace.id}/submit`, {
              method: "POST",
              body,
            });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(toast);
    if (verb === "approve") {
      // THE G-61 VERDICT — the approval act's own report (transfer + the
      // fold's NBV + both branch accounts), rendered verbatim below.
      const verdict = result.data as TransferApprovalResult;
      setApproval(verdict);
      setWorkspace(verdict.transfer);
    } else {
      setWorkspace(result.data as AssetTransferRow);
    }
    await loadTransfers();
  }

  // -- the listing table ---------------------------------------------------------------

  const transferColumns: DataTableColumn<AssetTransferRow>[] = [
    {
      id: "asset",
      header: activeLocaleHeader(d.assetsTransfersColAsset),
      accessor: (row) => assetLabelById.get(row.assetId) ?? shortId(row.assetId),
    },
    {
      id: "from",
      header: activeLocaleHeader(d.assetsTransfersColFrom),
      accessor: (row) => branchLabel(row.fromBranchId),
    },
    {
      id: "to",
      header: activeLocaleHeader(d.assetsTransfersColTo),
      accessor: (row) => branchLabel(row.toBranchId),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.assetsTransfersColStatus),
      accessor: (row) => localizedTransferStatus(d, row.status),
      render: (row) => (
        <Chip tone={transferStatusChipTone(row.status)}>
          {localizedTransferStatus(d, row.status)}
        </Chip>
      ),
    },
    {
      id: "submittedAt",
      header: activeLocaleHeader(d.assetsTransfersColSubmitted),
      accessor: (row) => row.submittedAt ?? "—",
      render: (row) => (row.submittedAt === null ? <span className="text-xs text-gray-500">—</span> : monoCell(row.submittedAt)),
    },
    {
      id: "approvedAt",
      header: activeLocaleHeader(d.assetsTransfersColApproved),
      accessor: (row) => row.approvedAt ?? "—",
      render: (row) => (row.approvedAt === null ? <span className="text-xs text-gray-500">—</span> : monoCell(row.approvedAt)),
    },
    {
      id: "rejectedAt",
      header: activeLocaleHeader(d.assetsTransfersColRejected),
      accessor: (row) => row.rejectedAt ?? "—",
      render: (row) => (row.rejectedAt === null ? <span className="text-xs text-gray-500">—</span> : monoCell(row.rejectedAt)),
    },
    {
      id: "journal",
      header: activeLocaleHeader(d.assetsTransfersColJournal),
      accessor: (row) => row.journalEntryId ?? "—",
      render: (row) =>
        row.journalEntryId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(shortId(row.journalEntryId), row.journalEntryId)
        ),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.assetsMaintenanceColActions),
      accessor: () => d.assetsTransfersOpen,
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setApproval(null);
            setWorkspace(row);
          }}
        >
          {d.assetsTransfersOpen}
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
        title={d.assetsTransfersTitle}
        description={d.assetsTransfersSubtitle}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            {d.assetsTransfersCreate}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {d.assetsTransfersColStatus}
            <select
              className="rounded-md border border-default bg-surface-card px-3 py-2"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
              }}
            >
              <option value="">{d.assetsMaintenanceStatusAll}</option>
              {TRANSFER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {localizedTransferStatus(d, status)}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" onClick={() => void loadTransfers()}>
            {d.assetsMaintenanceRefresh}
          </Button>
        </div>
      </Card>

      {listLoading ? <p className="text-sm text-gray-600">…</p> : null}

      {transfersRefusal !== null ? (
        <TypedRefusalPanel
          error={transfersRefusal}
          title={d.assetsMaintenanceRefusalTitle}
          detailsLabel={d.assetsMaintenanceRefusalDetails}
        />
      ) : null}

      {transfersRefusal === null && transfers !== null ? (
        transfers.length === 0 ? (
          <p className="text-sm text-gray-600">{d.assetsTransfersEmpty}</p>
        ) : (
          <DataTable columns={transferColumns} rows={[...transfers]} rowKey={(row) => row.id} />
        )
      ) : null}

      {workspace !== null ? (
        <Card
          title={assetLabelById.get(workspace.assetId) ?? shortId(workspace.assetId)}
          actions={
            <Badge tone="neutral">{localizedTransferStatus(d, workspace.status)}</Badge>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={transferStatusChipTone(workspace.status)}>
                {localizedTransferStatus(d, workspace.status)}
              </Chip>
              <span className="text-sm text-gray-600">
                {assetLabelById.get(workspace.assetId) ?? shortId(workspace.assetId)}
              </span>
              <span className="text-sm text-gray-600" dir="ltr">
                {branchLabel(workspace.fromBranchId)} → {branchLabel(workspace.toBranchId)}
              </span>
            </div>

            <DefList
              items={[
                {
                  term: d.assetsTransfersReason,
                  children: localizedName(workspace.reason, workspace.reasonAr, locale),
                },
                {
                  term: d.assetsTransfersColSubmitted,
                  children:
                    workspace.submittedAt === null ? (
                      <span className="text-xs text-gray-500">—</span>
                    ) : (
                      monoCell(workspace.submittedAt)
                    ),
                },
                {
                  term: d.assetsTransfersColApproved,
                  children:
                    workspace.approvedAt === null ? (
                      <span className="text-xs text-gray-500">—</span>
                    ) : (
                      monoCell(workspace.approvedAt)
                    ),
                },
                {
                  term: d.assetsTransfersColRejected,
                  children:
                    workspace.rejectedAt === null ? (
                      <span className="text-xs text-gray-500">—</span>
                    ) : (
                      monoCell(workspace.rejectedAt)
                    ),
                },
                ...(workspace.rejectReason !== null
                  ? [
                      {
                        term: d.assetsTransfersRejectReason,
                        children: workspace.rejectReason,
                      },
                    ]
                  : []),
                {
                  term: d.assetsTransfersColJournal,
                  children:
                    workspace.journalEntryId === null ? (
                      <span className="text-xs text-gray-500">—</span>
                    ) : (
                      monoCell(workspace.journalEntryId)
                    ),
                },
                ...(workspace.note !== null || workspace.noteAr !== null
                  ? [
                      {
                        term: d.assetsMetersReadingNote,
                        children: localizedName(workspace.note ?? "—", workspace.noteAr, locale),
                      },
                    ]
                  : []),
              ]}
            />

            {/* THE G-61 VERDICT — the approval act's own report, rendered
                verbatim (nbv + journal + both branch accounts); the zero-NBV
                case renders the engine's own honest note. */}
            {approval !== null ? (
              <Card title={d.assetsTransfersNbv}>
                {approval.journalEntryId === null ? (
                  <p className="text-sm text-gray-600">{d.assetsTransfersZeroNbv}</p>
                ) : (
                  <DefList
                    items={[
                      {
                        term: d.assetsTransfersNbv,
                        children: moneyCell(approval.nbv),
                      },
                      {
                        term: d.assetsTransfersColJournal,
                        children: monoCell(approval.journalEntryId),
                      },
                      {
                        term: d.assetsTransfersColFrom,
                        children: monoCell(shortId(approval.fromAccountId ?? "—"), approval.fromAccountId ?? undefined),
                      },
                      {
                        term: d.assetsTransfersColTo,
                        children: monoCell(shortId(approval.toAccountId ?? "—"), approval.toAccountId ?? undefined),
                      },
                    ]}
                  />
                )}
              </Card>
            ) : null}

            {/* the lifecycle bar — the ladder's own moves */}
            <div className="flex flex-wrap gap-2">
              {workspace.status === "DRAFT" ? (
                <Button
                  variant="primary"
                  loading={busy === "submit"}
                  onClick={() => void moveTransfer("submit", {}, d.assetsTransfersSubmittedToast)}
                >
                  {d.assetsTransfersSubmit}
                </Button>
              ) : null}
              {workspace.status === "SUBMITTED" ? (
                <>
                  <Button variant="primary" onClick={() => setApproveOpen(true)}>
                    {d.assetsTransfersApprove}
                  </Button>
                  <Button variant="secondary" onClick={() => setRejectOpen(true)}>
                    {d.assetsTransfersReject}
                  </Button>
                </>
              ) : null}
              <Button variant="ghost" onClick={() => setWorkspace(null)}>
                {d.commonClear}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* -- the create-transfer dialog -------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.assetsTransfersCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.assetsTransfersColAsset}
            value={transferDraft.assetId}
            onValueChange={(value) =>
              setTransferDraft((prev) => ({ ...prev, assetId: value, toBranchId: "" }))
            }
            placeholder="—"
            options={assets.map((asset) => ({
              value: asset.id,
              label: assetLabelById.get(asset.id) ?? asset.code,
            }))}
            required
          />
          <Select
            label={d.assetsTransfersToBranch}
            value={transferDraft.toBranchId}
            onValueChange={(value) => setTransferDraft((prev) => ({ ...prev, toBranchId: value }))}
            placeholder="—"
            hint={createAsset === null ? undefined : branchLabel(createAsset.branchId)}
            options={toBranchOptions}
            required
          />
          <div className="sm:col-span-2">
            <Input
              label={d.assetsTransfersReason}
              value={transferDraft.reason}
              onValueChange={(value) => setTransferDraft((prev) => ({ ...prev, reason: value }))}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsTransfersReasonAr}
              value={transferDraft.reasonAr}
              onValueChange={(value) => setTransferDraft((prev) => ({ ...prev, reasonAr: value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMetersReadingNote}
              value={transferDraft.note}
              onValueChange={(value) => setTransferDraft((prev) => ({ ...prev, note: value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={`${d.assetsMetersReadingNote} (AR)`}
              value={transferDraft.noteAr}
              onValueChange={(value) => setTransferDraft((prev) => ({ ...prev, noteAr: value }))}
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
            onClick={() => void createTransfer()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- the approve confirm (the G-61 act's door) -------------------------------- */}
      <Dialog
        open={approveOpen}
        onOpenChange={(open) => {
          if (!open) setApproveOpen(false);
        }}
        title={d.assetsTransfersApproveTitle}
      >
        <p className="text-sm text-gray-600">{d.assetsTransfersApproveTitle}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setApproveOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "approve"}
            onClick={() => {
              setApproveOpen(false);
              void moveTransfer("approve", {}, d.assetsTransfersApprovedToast);
            }}
          >
            {d.assetsTransfersApprove}
          </Button>
        </div>
      </Dialog>

      {/* -- the reject dialog (the reason is required — the engine's own law) ---------- */}
      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (!open) setRejectOpen(false);
        }}
        title={d.assetsTransfersRejectTitle}
      >
        <Input
          label={d.assetsTransfersRejectReason}
          value={rejectReason}
          onValueChange={setRejectReason}
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setRejectOpen(false);
              setRejectReason("");
            }}
          >
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "reject"}
            disabled={!rejectReady}
            onClick={() => {
              setRejectOpen(false);
              void moveTransfer(
                "reject",
                { rejectReason: rejectReason.trim() },
                d.assetsTransfersRejectedToast,
              ).then(() => setRejectReason(""));
            }}
          >
            {d.assetsTransfersReject}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
