"use client";

/**
 * WEB-038 (PHASE-038) — the supplier-collaboration surface (/purchasing/
 * supplier-scorecards; matrix §3.16, P-04): the scorecard windows with the
 * color-coded delivery/quality/price/overall scores, the per-supplier
 * recompute (purchasing.suppliers.rate gate) and the approved-vendor item
 * list with its upsert form (purchasing.rfqs.manage gate). The AVL loads
 * client-side on mount; every API failure renders localized.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, NumberInput, Select, useToast } from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  ApiResult,
  ApprovedSupplierItemRow,
  PartnerRow,
  SupplierRatingRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The score color ladder: ≥80 green, ≥60 amber, else red. */
function scoreClass(score: string): string {
  const value = Number(score);
  if (!Number.isFinite(value)) {
    return "text-gray-700";
  }
  if (value >= 80) {
    return "text-success-text";
  }
  return value >= 60 ? "text-warning-text" : "text-danger-text";
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
    case "SUPPLIER_RATING_NOT_FOUND":
    case "SUPPLIER_NOT_FOUND":
      return d.errorsNotFound;
    default:
      return localizedApiError(d, failure.error, failure.retryAfterSeconds);
  }
}

export function SupplierScorecards({
  locale,
  initialRatings,
  partners,
  canRate,
  canManage,
}: {
  locale: Locale;
  initialRatings: readonly SupplierRatingRow[];
  partners: readonly PartnerRow[];
  canRate: boolean;
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [ratings, setRatings] = useState<readonly SupplierRatingRow[]>(initialRatings);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- approved items (client-loaded sub-list) ---------------------------------
  const [approvedItems, setApprovedItems] = useState<readonly ApprovedSupplierItemRow[]>([]);
  const [approvedLoading, setApprovedLoading] = useState(true);
  const [avlSupplierId, setAvlSupplierId] = useState("");
  const [avlItemId, setAvlItemId] = useState("");
  const [avlStatus, setAvlStatus] = useState<"APPROVED" | "SUSPENDED">("APPROVED");
  const [avlExpiresAt, setAvlExpiresAt] = useState("");

  // -- recompute dialog ----------------------------------------------------------
  const [recomputeTarget, setRecomputeTarget] = useState<string | null>(null);
  const [recomputeWindowDays, setRecomputeWindowDays] = useState("");

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

  function supplierLabel(supplierId: string): string {
    return supplierNameById.get(supplierId) ?? supplierId;
  }

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const loaded = await bffFetch<readonly ApprovedSupplierItemRow[]>(
        "purchasing/approved-supplier-items?limit=200",
      );
      if (!cancelled) {
        setApprovedLoading(false);
        if (loaded.ok) {
          setApprovedItems(loaded.data);
        }
        // A failed AVL read renders the honest empty list — the scorecards
        // table above stays fully usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function refreshApprovedItems(): Promise<void> {
    const fresh = await bffFetch<readonly ApprovedSupplierItemRow[]>(
      "purchasing/approved-supplier-items?limit=200",
    );
    if (fresh.ok) {
      setApprovedItems(fresh.data);
    }
  }

  async function recompute(): Promise<void> {
    if (recomputeTarget === null) {
      return;
    }
    const windowDays = recomputeWindowDays.trim() === "" ? undefined : Number(recomputeWindowDays);
    if (windowDays !== undefined && (!Number.isInteger(windowDays) || windowDays < 7 || windowDays > 730)) {
      setError(d.errorsValidation);
      return;
    }
    const updated = await call<SupplierRatingRow>("recompute", () =>
      bffFetch<SupplierRatingRow>(`purchasing/supplier-ratings/${recomputeTarget}/recompute`, {
        method: "POST",
        body: windowDays === undefined ? {} : { windowDays },
      }),
    );
    if (updated !== undefined) {
      setRecomputeTarget(null);
      setRecomputeWindowDays("");
      setRatings((rows) => {
        const others = rows.filter((row) => row.supplierId !== updated.supplierId);
        return [updated, ...others];
      });
      toast({ tone: "success", title: d.sourcingToastDone });
      router.refresh();
    }
  }

  function avlDraftReady(): boolean {
    return avlSupplierId !== "" && UUID_RE.test(avlItemId.trim());
  }

  async function upsertApprovedItem(): Promise<void> {
    if (!avlDraftReady()) {
      setError(d.errorsValidation);
      return;
    }
    const saved = await call<ApprovedSupplierItemRow>("avl-upsert", () =>
      bffFetch<ApprovedSupplierItemRow>("purchasing/approved-supplier-items", {
        method: "POST",
        body: {
          supplierId: avlSupplierId,
          itemId: avlItemId.trim(),
          status: avlStatus,
          expiresAt: avlExpiresAt === "" ? null : avlExpiresAt,
          note: null,
        },
      }),
    );
    if (saved !== undefined) {
      setAvlItemId("");
      setAvlExpiresAt("");
      await refreshApprovedItems();
      toast({ tone: "success", title: d.sourcingToastDone });
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card title={d.sourcingScorecardsTitle}>
        <DataTable
          columns={[
            {
              id: "supplier",
              header: activeLocaleHeader(d.purchasingSupplier),
              accessor: (row: SupplierRatingRow) => supplierLabel(row.supplierId),
            },
            {
              id: "window",
              header: activeLocaleHeader(d.sourcingColWindow),
              accessor: (row: SupplierRatingRow) => row.windowEnd,
              render: (row: SupplierRatingRow) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.windowStart} → {row.windowEnd}
                </span>
              ),
            },
            {
              id: "delivery",
              header: activeLocaleHeader(d.sourcingColDelivery),
              accessor: (row: SupplierRatingRow) => row.deliveryScore,
              numeric: true,
              render: (row: SupplierRatingRow) => (
                <span className={`font-mono text-sm tabular-nums ${scoreClass(row.deliveryScore)}`} dir="ltr">
                  {row.deliveryScore}
                </span>
              ),
            },
            {
              id: "quality",
              header: activeLocaleHeader(d.sourcingColQuality),
              accessor: (row: SupplierRatingRow) => row.qualityScore,
              numeric: true,
              render: (row: SupplierRatingRow) => (
                <span className={`font-mono text-sm tabular-nums ${scoreClass(row.qualityScore)}`} dir="ltr">
                  {row.qualityScore}
                </span>
              ),
            },
            {
              id: "price",
              header: activeLocaleHeader(d.sourcingColPrice),
              accessor: (row: SupplierRatingRow) => row.priceScore,
              numeric: true,
              render: (row: SupplierRatingRow) => (
                <span className={`font-mono text-sm tabular-nums ${scoreClass(row.priceScore)}`} dir="ltr">
                  {row.priceScore}
                </span>
              ),
            },
            {
              id: "overall",
              header: activeLocaleHeader(d.sourcingColOverall),
              accessor: (row: SupplierRatingRow) => row.overallScore,
              numeric: true,
              sortable: true,
              render: (row: SupplierRatingRow) => (
                <span className={`font-mono text-sm font-semibold tabular-nums ${scoreClass(row.overallScore)}`} dir="ltr">
                  {row.overallScore}
                </span>
              ),
            },
            {
              id: "sample",
              header: activeLocaleHeader(d.sourcingColSample),
              accessor: (row: SupplierRatingRow) => String(row.sampleSize),
              numeric: true,
              render: (row: SupplierRatingRow) => (
                <span className="font-mono text-sm tabular-nums" dir="ltr">
                  {row.sampleSize}
                </span>
              ),
            },
            {
              id: "computedAt",
              header: activeLocaleHeader(d.sourcingColSubmitted),
              accessor: (row: SupplierRatingRow) => row.computedAt,
              render: (row: SupplierRatingRow) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.computedAt.slice(0, 19).replace("T", " ")}
                </span>
              ),
            },
          ]}
          rows={[...ratings]}
          rowKey={(row) => row.id}
          rowActions={
            canRate
              ? [
                  {
                    id: "recompute",
                    label: d.sourcingActionRecompute,
                    onSelect: (row: SupplierRatingRow) => {
                      setRecomputeTarget(row.supplierId);
                      setRecomputeWindowDays("");
                    },
                  },
                ]
              : undefined
          }
          empty={{ title: d.sourcingScorecardsEmpty }}
        />
      </Card>

      <Card title={d.sourcingApprovedItemsTitle}>
        {canManage && (
          <div className="mb-4 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label={d.purchasingSupplier}
                value={avlSupplierId}
                onValueChange={setAvlSupplierId}
                options={[
                  { value: "", label: d.purchasingSelectSupplier },
                  ...suppliersOnly.map((s) => ({
                    value: s.id,
                    label: supplierNameById.get(s.id) ?? s.code,
                  })),
                ]}
              />
              <Input
                label={d.purchasingItem}
                value={avlItemId}
                onValueChange={setAvlItemId}
                mono
                error={avlItemId.trim() !== "" && !UUID_RE.test(avlItemId.trim()) ? d.errorsValidation : undefined}
                required
              />
              <Select
                label={d.sourcingFormStatus}
                value={avlStatus}
                onValueChange={(value) => setAvlStatus(value as "APPROVED" | "SUSPENDED")}
                options={[
                  { value: "APPROVED", label: d.sourcingStatusApproved },
                  { value: "SUSPENDED", label: d.sourcingStatusSuspended },
                ]}
              />
              <DatePicker
                label={d.sourcingFormExpires}
                value={avlExpiresAt === "" ? undefined : avlExpiresAt}
                onSelect={setAvlExpiresAt}
                locale={locale}
              />
            </div>
            <Button
              variant="primary"
              className="self-start"
              loading={busy === "avl-upsert"}
              onClick={() => void upsertApprovedItem()}
            >
              {d.commonSave}
            </Button>
          </div>
        )}
        {approvedLoading ? (
          <p className="text-sm text-gray-600">{d.loading}</p>
        ) : (
          <DataTable
            columns={[
              {
                id: "supplier",
                header: activeLocaleHeader(d.purchasingSupplier),
                accessor: (row: ApprovedSupplierItemRow) => supplierLabel(row.supplierId),
              },
              {
                id: "item",
                header: activeLocaleHeader(d.purchasingItem),
                accessor: (row: ApprovedSupplierItemRow) => row.itemId,
                mono: true,
                render: (row: ApprovedSupplierItemRow) => (
                  <span className="font-mono text-xs" dir="ltr" title={row.itemId}>
                    {row.itemId.slice(0, 8)}…
                  </span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.sourcingColStatus),
                accessor: (row: ApprovedSupplierItemRow) => row.status,
                render: (row: ApprovedSupplierItemRow) => (
                  <Badge tone={row.status === "APPROVED" ? "primary" : "neutral"}>
                    {row.status === "APPROVED" ? d.sourcingStatusApproved : d.sourcingStatusSuspended}
                  </Badge>
                ),
              },
              {
                id: "expires",
                header: activeLocaleHeader(d.sourcingColExpires),
                accessor: (row: ApprovedSupplierItemRow) => row.expiresAt ?? "",
                render: (row: ApprovedSupplierItemRow) =>
                  row.expiresAt === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-mono text-xs" dir="ltr">
                      {row.expiresAt}
                    </span>
                  ),
              },
            ]}
            rows={[...approvedItems]}
            rowKey={(row) => row.id}
            empty={{ title: d.sourcingApprovedItemsEmpty }}
          />
        )}
      </Card>

      {recomputeTarget !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setRecomputeTarget(null);
            }
          }}
          title={d.sourcingActionRecompute}
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-700">
              {supplierLabel(recomputeTarget)} — {d.sourcingConfirmRecompute}
            </p>
            <NumberInput
              label={`${d.sourcingFormWindowDays} (${d.sourcingFormOptional})`}
              value={recomputeWindowDays}
              onValueChange={setRecomputeWindowDays}
              min={7}
              max={730}
              step={1}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRecomputeTarget(null)}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" loading={busy === "recompute"} onClick={() => void recompute()}>
              {d.sourcingActionRecompute}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
