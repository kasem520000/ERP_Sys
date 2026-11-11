"use client";

/**
 * WEB-038 (PHASE-038) — the CAPEX intake surface (/purchasing/capex-
 * requests; matrix §3.16, P-10/P-15): the request registry with the
 * create dialog, the submit action, and the approver leg (approve/reject
 * gated by purchasing.capex.approve; the SoD creator-≠-approver rule is
 * enforced server-side). Reject/cancel carry a required reason. The
 * budget-evaluation verdict recorded at submit renders as a mode badge
 * (OFF/ADVISORY/ENFORCE_DRAFT — the 028 guard's vocabulary). The chart of
 * accounts + branch registries are separate permissions — on failure the
 * create dialog degrades to plain UUID inputs (the zatca branches rule).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, Select, useToast } from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  AccountRow,
  ApiErrorBody,
  ApiResult,
  BranchRow,
  CapexRequestRow,
} from "../lib/api-types";
import { isRecord } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAPEX_TONES: Record<CapexRequestRow["status"], "primary" | "neutral"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "primary",
  APPROVED: "primary",
  CONVERTED: "primary",
  REJECTED: "neutral",
  CANCELLED: "neutral",
};

/** The create-request draft (all inputs are strings). */
interface CapexDraft {
  branchId: string;
  title: string;
  titleAr: string;
  description: string;
  accountId: string;
  estimatedAmount: string;
  currencyCode: string;
  neededBy: string;
}

function emptyCapexDraft(): CapexDraft {
  return {
    branchId: "",
    title: "",
    titleAr: "",
    description: "",
    accountId: "",
    estimatedAmount: "",
    currencyCode: "SAR",
    neededBy: "",
  };
}

/** User decimal input → the canonical 4-dp money string the API requires. */
function toMoney4(value: string): string | null {
  const trimmed = value.trim();
  if (!MONEY_RE.test(trimmed)) {
    return null;
  }
  const [whole, frac = ""] = trimmed.split(".");
  return `${whole}.${frac.padEnd(4, "0").slice(0, 4)}`;
}

/**
 * Stable sourcing error family → honest messages (localizedApiError covers
 * the generic families).
 */
function sourcingError(
  d: Dictionary,
  failure: { error: ApiErrorBody; retryAfterSeconds?: number },
): string {
  switch (failure.error.code) {
    case "CAPEX_REQUEST_NOT_FOUND":
      return d.errorsNotFound;
    case "CAPEX_STATE":
      return d.sourcingErrState;
    case "SELF_APPROVAL_BLOCKED":
      return d.purchasingErrSelfApproval;
    default:
      return localizedApiError(d, failure.error, failure.retryAfterSeconds);
  }
}

function capexStatusLabel(d: Dictionary, status: CapexRequestRow["status"]): string {
  const map: Record<CapexRequestRow["status"], string> = {
    DRAFT: d.sourcingStatusCapexDraft,
    PENDING_APPROVAL: d.sourcingStatusCapexPending,
    APPROVED: d.sourcingStatusCapexApproved,
    CONVERTED: d.sourcingStatusCapexConverted,
    REJECTED: d.sourcingStatusCapexRejected,
    CANCELLED: d.sourcingStatusCapexCancelled,
  };
  return map[status];
}

/** The budget-evaluation verdict recorded at submit (mode + warnings). */
function budgetModeOf(evaluation: Record<string, unknown> | null): string | null {
  if (evaluation === null || !isRecord(evaluation)) {
    return null;
  }
  return typeof evaluation.mode === "string" ? evaluation.mode : null;
}

function budgetModeLabel(d: Dictionary, mode: string): string {
  switch (mode) {
    case "OFF":
      return d.sourcingBudgetModeOff;
    case "ADVISORY":
      return d.sourcingBudgetModeAdvisory;
    case "ENFORCE_DRAFT":
      return d.sourcingBudgetModeEnforce;
    default:
      return mode;
  }
}

export function CapexRequests({
  locale,
  initialRequests,
  accounts,
  branches,
  canManage,
  canApprove,
}: {
  locale: Locale;
  initialRequests: readonly CapexRequestRow[];
  accounts: readonly AccountRow[];
  branches: readonly BranchRow[];
  canManage: boolean;
  canApprove: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [requests, setRequests] = useState<readonly CapexRequestRow[]>(initialRequests);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CapexDraft>(emptyCapexDraft);
  // Reject/cancel share the reason dialog (both POSTs require reason ≥ 3).
  const [reasonTarget, setReasonTarget] = useState<{ id: string; action: "reject" | "cancel" } | null>(null);
  const [reason, setReason] = useState("");

  const branchOptions = useMemo(() => {
    const options = branches.map((branch) => ({
      value: branch.id,
      label: localizedName(branch.name, branch.nameAr, locale),
    }));
    for (const request of requests) {
      if (options.some((option) => option.value === request.branchId)) {
        continue;
      }
      options.push({ value: request.branchId, label: request.branchId });
    }
    return options;
  }, [branches, requests, locale]);

  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${account.code} — ${localizedName(account.name, account.nameAr, locale)}`,
      })),
    [accounts, locale],
  );

  async function call<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(sourcingError(d, result));
      return undefined;
    }
    return result.data;
  }

  function draftReady(draft: CapexDraft): boolean {
    return (
      (branches.length > 0 ? draft.branchId !== "" : UUID_RE.test(draft.branchId.trim())) &&
      (accounts.length > 0 ? draft.accountId !== "" : UUID_RE.test(draft.accountId.trim())) &&
      draft.title.trim() !== "" &&
      CURRENCY_RE.test(draft.currencyCode.trim().toUpperCase()) &&
      toMoney4(draft.estimatedAmount) !== null
    );
  }

  async function createRequest(): Promise<void> {
    if (!draftReady(createDraft)) {
      setError(d.errorsValidation);
      return;
    }
    const amount = toMoney4(createDraft.estimatedAmount)!;
    const created = await call<CapexRequestRow>("capex-create", () =>
      bffFetch<CapexRequestRow>("purchasing/capex-requests", {
        method: "POST",
        body: {
          branchId: createDraft.branchId.trim(),
          title: createDraft.title.trim(),
          titleAr: createDraft.titleAr.trim() === "" ? null : createDraft.titleAr.trim(),
          description: createDraft.description.trim() === "" ? null : createDraft.description.trim(),
          accountId: createDraft.accountId.trim(),
          costCenterId: null,
          projectId: null,
          estimatedAmount: amount,
          currencyCode: createDraft.currencyCode.trim().toUpperCase(),
          neededBy: createDraft.neededBy === "" ? null : createDraft.neededBy,
        },
      }),
    );
    if (created !== undefined) {
      setCreateOpen(false);
      setCreateDraft(emptyCapexDraft());
      setRequests((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.sourcingToastCreated });
      router.refresh();
    }
  }

  async function capexAction(
    row: CapexRequestRow,
    action: "submit" | "approve",
  ): Promise<void> {
    const updated = await call<CapexRequestRow>(`${action}-${row.id}`, () =>
      bffFetch<CapexRequestRow>(`purchasing/capex-requests/${row.id}/${action}`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setRequests((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.sourcingToastDone });
      router.refresh();
    }
  }

  async function reasonAction(): Promise<void> {
    if (reasonTarget === null || reason.trim().length < 3) {
      setError(d.errorsValidation);
      return;
    }
    const updated = await call<CapexRequestRow>(`${reasonTarget.action}-${reasonTarget.id}`, () =>
      bffFetch<CapexRequestRow>(`purchasing/capex-requests/${reasonTarget.id}/${reasonTarget.action}`, {
        method: "POST",
        body: { reason: reason.trim() },
      }),
    );
    if (updated !== undefined) {
      setReasonTarget(null);
      setReason("");
      setRequests((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.sourcingToastDone });
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      {canManage && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              setCreateDraft(emptyCapexDraft());
              setCreateOpen(true);
            }}
          >
            {d.sourcingActionCreate}
          </Button>
        </div>
      )}

      <Card title={d.sourcingCapexTitle}>
        <DataTable
          columns={[
            {
              id: "requestNo",
              header: activeLocaleHeader(d.sourcingColRequestNo),
              accessor: (row: CapexRequestRow) => row.requestNo ?? "—",
              mono: true,
              render: (row: CapexRequestRow) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.requestNo ?? "—"}
                </span>
              ),
            },
            {
              id: "title",
              header: activeLocaleHeader(d.sourcingColTitle),
              accessor: (row: CapexRequestRow) => localizedName(row.title, row.titleAr, locale),
            },
            {
              id: "amount",
              header: activeLocaleHeader(d.sourcingColAmount),
              accessor: (row: CapexRequestRow) => row.estimatedAmount,
              numeric: true,
              render: (row: CapexRequestRow) => (
                <span className="font-mono text-sm tabular-nums" dir="ltr">
                  {row.estimatedAmount} {row.currencyCode}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.sourcingColStatus),
              accessor: (row: CapexRequestRow) => row.status,
              render: (row: CapexRequestRow) => (
                <Badge tone={CAPEX_TONES[row.status]}>{capexStatusLabel(d, row.status)}</Badge>
              ),
            },
            {
              id: "budget",
              header: activeLocaleHeader(d.sourcingColBudgetEval),
              accessor: (row: CapexRequestRow) => budgetModeOf(row.budgetEvaluation) ?? "",
              render: (row: CapexRequestRow) => {
                const mode = budgetModeOf(row.budgetEvaluation);
                return mode === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Badge tone={mode === "ENFORCE_DRAFT" ? "neutral" : "primary"}>
                    {budgetModeLabel(d, mode)}
                  </Badge>
                );
              },
            },
          ]}
          rows={[...requests]}
          rowKey={(row) => row.id}
          rowActions={
            canManage || canApprove
              ? [
                  ...(canManage
                    ? [
                        {
                          id: "submit",
                          label: d.sourcingActionSubmit,
                          onSelect: (row: CapexRequestRow) => {
                            if (row.status === "DRAFT") {
                              void capexAction(row, "submit");
                            }
                          },
                        },
                        {
                          id: "cancel",
                          label: d.sourcingActionCancel,
                          onSelect: (row: CapexRequestRow) => {
                            // The server cancels everything except the
                            // terminal CONVERTED/CANCELLED states.
                            if (row.status === "CONVERTED" || row.status === "CANCELLED") {
                              return;
                            }
                            setReasonTarget({ id: row.id, action: "cancel" });
                            setReason("");
                          },
                        },
                      ]
                    : []),
                  ...(canApprove
                    ? [
                        {
                          id: "approve",
                          label: d.sourcingActionApprove,
                          onSelect: (row: CapexRequestRow) => {
                            if (row.status === "PENDING_APPROVAL") {
                              void capexAction(row, "approve");
                            }
                          },
                        },
                        {
                          id: "reject",
                          label: d.sourcingActionReject,
                          onSelect: (row: CapexRequestRow) => {
                            if (row.status !== "PENDING_APPROVAL") {
                              return;
                            }
                            setReasonTarget({ id: row.id, action: "reject" });
                            setReason("");
                          },
                        },
                      ]
                    : []),
                ]
              : undefined
          }
          empty={{ title: d.sourcingCapexEmpty }}
        />
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={`${d.sourcingActionCreate} — ${d.sourcingCapexNav}`}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {branches.length > 0 ? (
              <Select
                label={d.sourcingFormBranch}
                value={createDraft.branchId}
                onValueChange={(value) => setCreateDraft({ ...createDraft, branchId: value })}
                options={[{ value: "", label: d.sourcingFormBranch }, ...branchOptions]}
              />
            ) : (
              <Input
                label={d.sourcingFormBranch}
                value={createDraft.branchId}
                onValueChange={(value) => setCreateDraft({ ...createDraft, branchId: value })}
                mono
                required
              />
            )}
            {accounts.length > 0 ? (
              <Select
                label={d.sourcingFormAccount}
                value={createDraft.accountId}
                onValueChange={(value) => setCreateDraft({ ...createDraft, accountId: value })}
                options={[{ value: "", label: d.sourcingFormAccount }, ...accountOptions]}
              />
            ) : (
              <Input
                label={d.sourcingFormAccount}
                value={createDraft.accountId}
                onValueChange={(value) => setCreateDraft({ ...createDraft, accountId: value })}
                mono
                required
              />
            )}
            <Input
              label={d.sourcingFormTitle}
              value={createDraft.title}
              onValueChange={(value) => setCreateDraft({ ...createDraft, title: value })}
              error={createDraft.title.trim() === "" ? d.errorsValidation : undefined}
              required
            />
            <Input
              label={`${d.sourcingFormTitleAr} (${d.sourcingFormOptional})`}
              value={createDraft.titleAr}
              onValueChange={(value) => setCreateDraft({ ...createDraft, titleAr: value })}
            />
            <Input
              label={d.sourcingFormEstimatedAmount}
              value={createDraft.estimatedAmount}
              onValueChange={(value) => setCreateDraft({ ...createDraft, estimatedAmount: value })}
              inputMode="decimal"
              error={toMoney4(createDraft.estimatedAmount) === null ? d.errorsValidation : undefined}
              required
            />
            <Input
              label={d.sourcingFormCurrency}
              value={createDraft.currencyCode}
              onValueChange={(value) => setCreateDraft({ ...createDraft, currencyCode: value.toUpperCase() })}
              mono
              error={!CURRENCY_RE.test(createDraft.currencyCode.trim()) ? d.errorsValidation : undefined}
              required
            />
            <DatePicker
              label={`${d.sourcingFormNeededBy} (${d.sourcingFormOptional})`}
              value={createDraft.neededBy === "" ? undefined : createDraft.neededBy}
              onSelect={(iso) => setCreateDraft({ ...createDraft, neededBy: iso })}
              locale={locale}
            />
          </div>
          <Input
            label={`${d.sourcingFormDescription} (${d.sourcingFormOptional})`}
            value={createDraft.description}
            onValueChange={(value) => setCreateDraft({ ...createDraft, description: value })}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "capex-create"} onClick={() => void createRequest()}>
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={reasonTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReasonTarget(null);
          }
        }}
        title={reasonTarget?.action === "reject" ? d.sourcingActionReject : d.sourcingActionCancel}
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <Input
            label={d.sourcingFormReason}
            value={reason}
            onValueChange={setReason}
            error={reason.trim().length > 0 && reason.trim().length < 3 ? d.errorsValidation : undefined}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReasonTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `reject-${reasonTarget?.id ?? ""}` || busy === `cancel-${reasonTarget?.id ?? ""}`}
            onClick={() => void reasonAction()}
          >
            {reasonTarget?.action === "reject" ? d.sourcingActionReject : d.sourcingActionCancel}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
