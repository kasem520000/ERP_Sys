"use client";

/**
 * THE PROMISE POINT (نقطة الوعد) — the joint review round (2026-11-15):
 * the sales order line's ATP surface. Renders EXACTLY what the backend's
 * checkLineAtp answers — the verdict (OK/SHORT), the THREE-VALUED
 * protection standing RELATIVE TO THE REMAINING qty (UNPROTECTED /
 * PARTIALLY_PROTECTED / FULLY_PROTECTED), the protected/unprotected
 * QUANTITIES, and the BILINGUAL (AR/EN) advisory note verbatim.
 *
 * THE STANDING RULES (never softened by the UI): the UNRESERVED portion
 * is ADVISORY ONLY (another order's delivery can take that stock first)
 * and a BACKORDER STAYS LEGAL — no ATP gate exists at issue, and this
 * surface never blocks anything; the shortage verdict is a warning, not
 * a stop sign.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ItemRow,
  SalesOrderLineAtpResult,
  SalesOrderRow,
  SalesOrderWithLines,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedSalesError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";

/** A qty cell in the standing grid (mono LTR — canonical decimal text). */
function Qty({ value }: { value: string }): JSX.Element {
  return (
    <span className="font-mono text-sm" dir="ltr">
      {value}
    </span>
  );
}

export function AtpPromisePoint({
  locale,
  order,
  items,
  onClose,
}: {
  locale: Locale;
  order: SalesOrderRow;
  items: readonly ItemRow[];
  onClose: () => void;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const [lines, setLines] = useState<SalesOrderWithLines["lines"] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The per-line ATP answers (lineId → the check result). */
  const [results, setResults] = useState<Map<string, SalesOrderLineAtpResult>>(new Map());
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const result = await bffFetch<SalesOrderWithLines>(`sales/sales-orders/${order.id}`);
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(
          localizedSalesError(d, result.error ?? { code: "NETWORK_ERROR", message: "" }, result.retryAfterSeconds),
        );
        return;
      }
      setLines(result.data.lines);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const skuById = new Map(items.map((item) => [item.id, item.sku]));

  async function checkLine(lineId: string, promisedDate: string | null): Promise<void> {
    setChecking(lineId);
    const result = await bffFetch<SalesOrderLineAtpResult>(
      `sales/sales-orders/${order.id}/lines/${lineId}/atp`,
      {
        method: "POST",
        body: { promisedDate },
      },
    );
    setChecking(null);
    if (!result.ok) {
      const message = localizedSalesError(
        d,
        result.error ?? { code: "NETWORK_ERROR", message: "" },
        result.retryAfterSeconds,
      );
      toast({ tone: "danger", title: message });
      return;
    }
    setResults((current) => new Map(current).set(lineId, result.data));
  }

  return (
    <Card
      title={`${d.salesPromisePoint} · ${order.orderNo ?? order.id.slice(0, 8)}`}
      description={d.salesPromiseAdvisoryRule}
    >
      <div className="flex flex-col gap-4">
        {loadError !== null && <ErrorNotice>{loadError}</ErrorNotice>}
        {lines === null && loadError === null && (
          <p className="text-sm text-gray-600">{d.salesPromiseLoading}</p>
        )}
        {lines !== null && lines.length === 0 && <ErrorNotice>{d.salesPromiseLoadFailed}</ErrorNotice>}
        {lines !== null && lines.length > 0 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-gray-600">{d.salesPromiseLines}</p>
            {lines.map((line) => {
              const result = results.get(line.id);
              return (
                <div key={line.id} className="rounded-md border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm" dir="ltr">
                        {skuById.get(line.itemId) ?? line.itemId}
                      </span>
                      <Qty value={line.qty} />
                      {line.promisedDate !== null && (
                        <span className="text-xs text-gray-500">
                          {d.salesPromisePromisedDate}: <span dir="ltr">{line.promisedDate}</span>
                        </span>
                      )}
                      {line.atpStatus !== null && (
                        <Badge tone={line.atpStatus === "OK" ? "primary" : undefined}>
                          {d.salesPromiseStamped}: {line.atpStatus === "OK" ? d.salesPromiseVerdictOk : d.salesPromiseVerdictShort}
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      loading={checking === line.id}
                      onClick={() => void checkLine(line.id, line.promisedDate)}
                    >
                      {d.salesPromiseCheck}
                    </Button>
                  </div>

                  {result !== undefined && (
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{d.salesPromiseVerdict}:</span>
                        <Badge tone={result.verdict === "OK" ? "primary" : undefined}>
                          {result.verdict === "OK" ? d.salesPromiseVerdictOk : d.salesPromiseVerdictShort}
                        </Badge>
                        <span className="text-xs font-medium text-gray-700">{d.salesPromiseProtection}:</span>
                        <Badge
                          tone={
                            result.protection === "FULLY_PROTECTED"
                              ? "primary"
                              : result.protection === "PARTIALLY_PROTECTED"
                                ? undefined
                                : undefined
                          }
                        >
                          {result.protection === "FULLY_PROTECTED"
                            ? d.salesPromiseFullyProtected
                            : result.protection === "PARTIALLY_PROTECTED"
                              ? d.salesPromisePartiallyProtected
                              : d.salesPromiseUnprotected}
                        </Badge>
                        {result.suggestedDate !== null && (
                          <span className="text-xs text-gray-600">
                            {d.salesPromiseSuggested}: <span dir="ltr">{result.suggestedDate}</span>
                          </span>
                        )}
                      </div>
                      <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
                        <div>
                          <dt className="text-gray-500">{d.salesPromiseAvailable}</dt>
                          <dd>
                            <Qty value={result.availableNow} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{d.salesPromiseRemaining}</dt>
                          <dd>
                            <Qty value={result.remainingQty} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{d.salesPromiseAllocated}</dt>
                          <dd>
                            <Qty value={result.reservedForLineQty} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{d.salesPromiseProtectedQty}</dt>
                          <dd>
                            <Qty value={result.protectedQty} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{d.salesPromiseUnprotectedQty}</dt>
                          <dd>
                            <Qty value={result.unprotectedQty} />
                          </dd>
                        </div>
                      </dl>
                      {/* THE BILINGUAL ADVISORY NOTE — both languages,
                       * rendered verbatim from the backend's answer. */}
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-gray-700">{d.salesPromiseNote}</span>
                        <p className="rounded-sm bg-yellow-50 p-2 text-xs leading-5 text-yellow-900" dir="ltr">
                          {result.advisoryNote.en}
                        </p>
                        <p className="rounded-sm bg-yellow-50 p-2 text-xs leading-6 text-yellow-900" dir="rtl">
                          {result.advisoryNote.ar}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {d.commonCancel}
          </Button>
        </div>
      </div>
    </Card>
  );
}
