"use client";

/**
 * WEB-038 (PHASE-038) — the blanket-agreements surface (/purchasing/
 * blanket-orders; matrix §3.16, P-03): the standing agreements registry
 * with the released-vs-ceiling progress, the create dialog (branch,
 * supplier, validity window, commitment bounds, price locks) and the
 * collaboration actions — release (draws a PO per release server-side)
 * and close. Writes gate in-screen on purchasing.rfqs.manage (the page
 * passes the session-derived flag); every API failure renders localized.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, Select, useToast } from "@erp/ui";

import { Decimal } from "@erp/domain-core";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  ApiResult,
  BlanketOrderRow,
  BlanketReleaseRow,
  BranchRow,
  PartnerRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BLANKET_TONES: Record<BlanketOrderRow["status"], "primary" | "neutral"> = {
  ACTIVE: "primary",
  EXPIRED: "neutral",
  CLOSED: "neutral",
  CANCELLED: "neutral",
};

interface DraftPriceLock {
  itemId: string;
  unitPrice: string;
}

/** The create-agreement draft (all inputs are strings). */
interface BlanketDraft {
  branchId: string;
  supplierId: string;
  contractId: string;
  title: string;
  titleAr: string;
  currencyCode: string;
  validFrom: string;
  validTo: string;
  minCommitment: string;
  maxCommitment: string;
  priceLock: DraftPriceLock[];
}

interface DraftReleaseLine {
  itemId: string;
  qty: string;
  unitPrice: string;
}

function emptyBlanketDraft(): BlanketDraft {
  return {
    branchId: "",
    supplierId: "",
    contractId: "",
    title: "",
    titleAr: "",
    currencyCode: "SAR",
    validFrom: "",
    validTo: "",
    minCommitment: "",
    maxCommitment: "",
    priceLock: [],
  };
}

function emptyReleaseLines(): DraftReleaseLine[] {
  return [{ itemId: "", qty: "", unitPrice: "" }];
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
    case "BLANKET_ORDER_NOT_FOUND":
    case "SUPPLIER_NOT_FOUND":
      return d.errorsNotFound;
    case "BLANKET_STATE":
    case "BLANKET_RELEASE_LINE_INVALID":
      return d.sourcingErrState;
    case "BLANKET_EXPIRED":
      return d.sourcingErrState;
    case "BLANKET_OVER_RELEASE":
      return d.sourcingErrOverRelease;
    default:
      return localizedApiError(d, failure.error, failure.retryAfterSeconds);
  }
}

function blanketStatusLabel(d: Dictionary, status: BlanketOrderRow["status"]): string {
  const map: Record<BlanketOrderRow["status"], string> = {
    ACTIVE: d.sourcingStatusBlanketActive,
    EXPIRED: d.sourcingStatusBlanketExpired,
    CLOSED: d.sourcingStatusBlanketClosed,
    CANCELLED: d.sourcingStatusBlanketCancelled,
  };
  return map[status];
}

export function BlanketOrders({
  locale,
  initialBlankets,
  partners,
  branches,
  canManage,
}: {
  locale: Locale;
  initialBlankets: readonly BlanketOrderRow[];
  partners: readonly PartnerRow[];
  branches: readonly BranchRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [blankets, setBlankets] = useState<readonly BlanketOrderRow[]>(initialBlankets);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<BlanketDraft>(emptyBlanketDraft);
  const [releaseTarget, setReleaseTarget] = useState<BlanketOrderRow | null>(null);
  const [releaseLines, setReleaseLines] = useState<DraftReleaseLine[]>(emptyReleaseLines);

  // The item registry rides the released agreements' price locks only in
  // this surface — the release lines pick items from free UUID inputs when
  // the locked list is empty, so no extra fetch is needed here.
  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      map.set(partner.id, localizedName(partner.name, partner.nameAr, locale));
    }
    return map;
  }, [partners, locale]);

  const suppliersOnly = useMemo(
    () => partners.filter((p) => p.kind === "SUPPLIER" || p.kind === "BOTH"),
    [partners],
  );

  const branchOptions = useMemo(() => {
    const options = branches.map((branch) => ({
      value: branch.id,
      label: localizedName(branch.name, branch.nameAr, locale),
    }));
    for (const blanket of blankets) {
      if (options.some((option) => option.value === blanket.branchId)) {
        continue;
      }
      options.push({ value: blanket.branchId, label: blanket.branchId });
    }
    return options;
  }, [branches, blankets, locale]);

  function supplierLabel(supplierId: string): string {
    return supplierNameById.get(supplierId) ?? supplierId;
  }

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

  /** Re-pull the registry — releases move releasedAmount server-side. */
  async function refreshBlankets(): Promise<void> {
    const fresh = await bffFetch<readonly BlanketOrderRow[]>("purchasing/blanket-orders?limit=200");
    if (fresh.ok) {
      setBlankets(fresh.data);
    }
    router.refresh();
  }

  function draftReady(draft: BlanketDraft): boolean {
    return (
      draft.branchId !== "" &&
      draft.supplierId !== "" &&
      draft.title.trim() !== "" &&
      CURRENCY_RE.test(draft.currencyCode.trim().toUpperCase()) &&
      /^\d{4}-\d{2}-\d{2}$/.test(draft.validFrom) &&
      /^\d{4}-\d{2}-\d{2}$/.test(draft.validTo) &&
      toMoney4(draft.minCommitment) !== null &&
      toMoney4(draft.maxCommitment) !== null
    );
  }

  async function createBlanket(): Promise<void> {
    if (!draftReady(createDraft)) {
      setError(d.errorsValidation);
      return;
    }
    const min = toMoney4(createDraft.minCommitment)!;
    const max = toMoney4(createDraft.maxCommitment)!;
    const created = await call<BlanketOrderRow>("blanket-create", () =>
      bffFetch<BlanketOrderRow>("purchasing/blanket-orders", {
        method: "POST",
        body: {
          branchId: createDraft.branchId,
          supplierId: createDraft.supplierId,
          contractId: UUID_RE.test(createDraft.contractId.trim()) ? createDraft.contractId.trim() : null,
          title: createDraft.title.trim(),
          titleAr: createDraft.titleAr.trim() === "" ? null : createDraft.titleAr.trim(),
          currencyCode: createDraft.currencyCode.trim().toUpperCase(),
          validFrom: createDraft.validFrom,
          validTo: createDraft.validTo,
          minCommitment: min,
          maxCommitment: max,
          priceLock: createDraft.priceLock
            .filter((lock) => lock.itemId !== "" && MONEY_RE.test(lock.unitPrice.trim()))
            .map((lock) => ({ itemId: lock.itemId, unitPrice: lock.unitPrice.trim() })),
          note: null,
          noteAr: null,
        },
      }),
    );
    if (created !== undefined) {
      setCreateOpen(false);
      setCreateDraft(emptyBlanketDraft());
      setBlankets((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.sourcingToastCreated });
      router.refresh();
    }
  }

  function releaseDraftReady(): boolean {
    return (
      releaseTarget !== null &&
      releaseLines.length > 0 &&
      releaseLines.every(
        (line) =>
          UUID_RE.test(line.itemId.trim()) &&
          QTY_RE.test(line.qty) &&
          (line.unitPrice.trim() === "" || MONEY_RE.test(line.unitPrice.trim())),
      )
    );
  }

  async function submitRelease(): Promise<void> {
    if (releaseTarget === null || !releaseDraftReady()) {
      setError(d.errorsValidation);
      return;
    }
    const released = await call<BlanketReleaseRow>("blanket-release", () =>
      bffFetch<BlanketReleaseRow>(`purchasing/blanket-orders/${releaseTarget.id}/releases`, {
        method: "POST",
        body: {
          lines: releaseLines.map((line) => ({
            itemId: line.itemId.trim(),
            qty: line.qty,
            unitPrice: line.unitPrice.trim() === "" ? null : line.unitPrice.trim(),
            note: null,
          })),
          note: null,
        },
      }),
    );
    if (released !== undefined) {
      setReleaseTarget(null);
      setReleaseLines(emptyReleaseLines());
      toast({ tone: "success", title: d.sourcingToastDone });
      void refreshBlankets();
    }
  }

  async function closeBlanket(row: BlanketOrderRow): Promise<void> {
    const updated = await call<BlanketOrderRow>(`blanket-close-${row.id}`, () =>
      bffFetch<BlanketOrderRow>(`purchasing/blanket-orders/${row.id}/close`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setBlankets((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.sourcingToastDone });
      router.refresh();
    }
  }

  function releasedPercent(row: BlanketOrderRow): number {
    // ADR-0009: percentage math runs through the decimal helper (half-up
    // rounding), never binary floats; a malformed stored decimal degrades
    // to 0 instead of crashing the grid cell.
    try {
      const max = new Decimal(row.maxCommitment);
      if (max.lessThanOrEqualTo(0)) {
        return 0;
      }
      const ratio = new Decimal(row.releasedAmount).div(max).times(100);
      return Math.min(100, ratio.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
    } catch {
      return 0;
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
              setCreateDraft(emptyBlanketDraft());
              setCreateOpen(true);
            }}
          >
            {d.sourcingActionCreate}
          </Button>
        </div>
      )}

      <Card title={d.sourcingBlanketTitle}>
        <DataTable
          columns={[
            {
              id: "blanketNo",
              header: activeLocaleHeader(d.sourcingColBlanketNo),
              accessor: (row: BlanketOrderRow) => row.blanketNo,
              mono: true,
              render: (row: BlanketOrderRow) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.blanketNo}
                </span>
              ),
            },
            {
              id: "supplier",
              header: activeLocaleHeader(d.purchasingSupplier),
              accessor: (row: BlanketOrderRow) => supplierLabel(row.supplierId),
            },
            {
              id: "title",
              header: activeLocaleHeader(d.sourcingColTitle),
              accessor: (row: BlanketOrderRow) => localizedName(row.title, row.titleAr, locale),
            },
            {
              id: "validity",
              header: activeLocaleHeader(d.sourcingColValidity),
              accessor: (row: BlanketOrderRow) => row.validTo,
              render: (row: BlanketOrderRow) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.validFrom} → {row.validTo}
                </span>
              ),
            },
            {
              id: "released",
              header: activeLocaleHeader(d.sourcingColReleased),
              accessor: (row: BlanketOrderRow) => row.releasedAmount,
              numeric: true,
              render: (row: BlanketOrderRow) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.releasedAmount} {row.currencyCode}
                </span>
              ),
            },
            {
              id: "progress",
              header: activeLocaleHeader(d.sourcingColProgress),
              accessor: (row: BlanketOrderRow) => String(releasedPercent(row)),
              numeric: true,
              render: (row: BlanketOrderRow) => {
                const percent = releasedPercent(row);
                return (
                  <div className="flex min-w-36 flex-col gap-1">
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={formatMessage(d.sourcingReleasedOf, {
                        released: row.releasedAmount,
                        max: row.maxCommitment,
                      })}
                    >
                      <div className="h-2 rounded-full bg-primary-600" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="font-mono text-xs tabular-nums" dir="ltr">
                      {percent}%
                    </span>
                  </div>
                );
              },
            },
            {
              id: "status",
              header: activeLocaleHeader(d.sourcingColStatus),
              accessor: (row: BlanketOrderRow) => row.status,
              render: (row: BlanketOrderRow) => (
                <Badge tone={BLANKET_TONES[row.status]}>{blanketStatusLabel(d, row.status)}</Badge>
              ),
            },
          ]}
          rows={[...blankets]}
          rowKey={(row) => row.id}
          rowActions={
            canManage
              ? [
                  {
                    id: "release",
                    label: d.sourcingActionRelease,
                    onSelect: (row: BlanketOrderRow) => {
                      if (row.status !== "ACTIVE") {
                        return;
                      }
                      setReleaseTarget(row);
                      setReleaseLines(emptyReleaseLines());
                    },
                  },
                  {
                    id: "close",
                    label: d.sourcingActionClose,
                    onSelect: (row: BlanketOrderRow) => {
                      if (row.status !== "ACTIVE") {
                        return;
                      }
                      if (window.confirm(d.sourcingConfirmClose)) {
                        void closeBlanket(row);
                      }
                    },
                  },
                ]
              : undefined
          }
          empty={{ title: d.sourcingBlanketEmpty }}
        />
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={`${d.sourcingActionCreate} — ${d.sourcingBlanketNav}`}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.sourcingFormBranch}
              value={createDraft.branchId}
              onValueChange={(value) => setCreateDraft({ ...createDraft, branchId: value })}
              options={[{ value: "", label: d.sourcingFormBranch }, ...branchOptions]}
            />
            <Select
              label={d.purchasingSupplier}
              value={createDraft.supplierId}
              onValueChange={(value) => setCreateDraft({ ...createDraft, supplierId: value })}
              options={[
                { value: "", label: d.purchasingSelectSupplier },
                ...suppliersOnly.map((s) => ({
                  value: s.id,
                  label: supplierNameById.get(s.id) ?? s.code,
                })),
              ]}
            />
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
              label={d.sourcingFormContractId}
              value={createDraft.contractId}
              onValueChange={(value) => setCreateDraft({ ...createDraft, contractId: value })}
              mono
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
              label={d.sourcingFormValidFrom}
              value={createDraft.validFrom === "" ? undefined : createDraft.validFrom}
              onSelect={(iso) => setCreateDraft({ ...createDraft, validFrom: iso })}
              locale={locale}
              required
            />
            <DatePicker
              label={d.sourcingFormValidTo}
              value={createDraft.validTo === "" ? undefined : createDraft.validTo}
              onSelect={(iso) => setCreateDraft({ ...createDraft, validTo: iso })}
              locale={locale}
              required
            />
            <Input
              label={d.sourcingFormMinCommitment}
              value={createDraft.minCommitment}
              onValueChange={(value) => setCreateDraft({ ...createDraft, minCommitment: value })}
              inputMode="decimal"
              error={toMoney4(createDraft.minCommitment) === null ? d.errorsValidation : undefined}
              required
            />
            <Input
              label={d.sourcingFormMaxCommitment}
              value={createDraft.maxCommitment}
              onValueChange={(value) => setCreateDraft({ ...createDraft, maxCommitment: value })}
              inputMode="decimal"
              error={toMoney4(createDraft.maxCommitment) === null ? d.errorsValidation : undefined}
              required
            />
          </div>
          {createDraft.priceLock.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-800">{d.sourcingFormPriceLock}</p>
              {createDraft.priceLock.map((lock, index) => (
                <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
                  <Input
                    label={index === 0 ? d.purchasingItem : undefined}
                    value={lock.itemId}
                    onValueChange={(value) =>
                      setCreateDraft({
                        ...createDraft,
                        priceLock: createDraft.priceLock.map((r, i) => (i === index ? { ...r, itemId: value } : r)),
                      })
                    }
                    mono
                  />
                  <Input
                    label={index === 0 ? d.purchasingUnitPrice : undefined}
                    value={lock.unitPrice}
                    onValueChange={(value) =>
                      setCreateDraft({
                        ...createDraft,
                        priceLock: createDraft.priceLock.map((r, i) =>
                          i === index ? { ...r, unitPrice: value } : r,
                        ),
                      })
                    }
                    inputMode="decimal"
                  />
                  <div className="flex items-end">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setCreateDraft({
                          ...createDraft,
                          priceLock: createDraft.priceLock.filter((_, i) => i !== index),
                        })
                      }
                    >
                      {d.purchasingRemoveLine}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() =>
              setCreateDraft({
                ...createDraft,
                priceLock: [...createDraft.priceLock, { itemId: "", unitPrice: "" }],
              })
            }
          >
            {d.purchasingAddLine}
          </Button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "blanket-create"} onClick={() => void createBlanket()}>
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={releaseTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReleaseTarget(null);
          }
        }}
        title={`${d.sourcingReleaseTitle} — ${releaseTarget?.blanketNo ?? ""}`}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          {releaseTarget !== null && (
            <p className="font-mono text-sm tabular-nums" dir="ltr">
              {formatMessage(d.sourcingReleasedOf, {
                released: releaseTarget.releasedAmount,
                max: releaseTarget.maxCommitment,
              })}{" "}
              {releaseTarget.currencyCode}
            </p>
          )}
          <div className="space-y-3">
            {releaseLines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Input
                  label={index === 0 ? d.purchasingItem : undefined}
                  value={line.itemId}
                  onValueChange={(value) =>
                    setReleaseLines((rows) => rows.map((r, i) => (i === index ? { ...r, itemId: value } : r)))
                  }
                  mono
                  required
                />
                <Input
                  label={index === 0 ? d.purchasingQty : undefined}
                  value={line.qty}
                  onValueChange={(value) =>
                    setReleaseLines((rows) => rows.map((r, i) => (i === index ? { ...r, qty: value } : r)))
                  }
                  inputMode="decimal"
                  required
                />
                <Input
                  label={index === 0 ? `${d.purchasingUnitPrice} (${d.sourcingFormOptional})` : undefined}
                  value={line.unitPrice}
                  onValueChange={(value) =>
                    setReleaseLines((rows) => rows.map((r, i) => (i === index ? { ...r, unitPrice: value } : r)))
                  }
                  inputMode="decimal"
                />
                <div className="flex items-end">
                  {releaseLines.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() => setReleaseLines((rows) => rows.filter((_, i) => i !== index))}
                    >
                      {d.purchasingRemoveLine}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() => setReleaseLines((rows) => [...rows, { itemId: "", qty: "", unitPrice: "" }])}
            >
              {d.purchasingAddLine}
            </Button>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReleaseTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "blanket-release"}
            onClick={() => {
              if (window.confirm(d.sourcingConfirmRelease)) {
                void submitRelease();
              }
            }}
          >
            {d.sourcingActionRelease}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
