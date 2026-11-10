/**
 * PHASE-022 T-P22-3-b · the companion dashboard view-model (MASTER-PLAN
 * §8 "Companion: dashboard … READ-CACHED with as-of labels"): today's
 * activity aggregated over the device's OWN documents (the outbox rows
 * the field flows wrote — locally-created AND synced, honest states
 * included) + the van-stock read cache + the parked-rejection count.
 *
 * READ-CACHED† only — no writes, no enqueue, no command builders (the
 * structural no-write proof covers this module). Stale is labeled, never
 * guessed: every metric carries the as-of of its latest contributing
 * row; the van-stock summary carries the cache's max updated_at; an
 * empty cache is null (never a guessed zero).
 */
import type { StorageAdapter } from "@erp/sync-core";
import { rejectedCommands } from "@erp/sync-core";

import { addDecimals, mulDecimals, subDecimals, sumDecimals } from "../exact-decimal";
import { flowRows } from "../fieldsales/state-machine";

/** One dashboard metric, summed PER CURRENCY (never a cross-currency lie). */
export interface DashboardMetric {
  /** The per-currency sums (one row per currencyCode seen today). */
  readonly byCurrency: readonly { readonly currencyCode: string; readonly amount: string }[];
  /** How many documents the metric covers (all currencies). */
  readonly count: number;
  /** The latest contributing row's timestamp (null = nothing today). */
  readonly asOf: string | null;
}

/** The van-stock summary (the read cache; null = never pulled). */
export interface DashboardVanStock {
  readonly totalQty: string;
  readonly asOf: string | null;
}

/** The companion dashboard (row 12 + the parked tile + the van tile). */
export interface CompanionDashboard {
  readonly today: string;
  readonly sales: DashboardMetric;
  readonly collections: DashboardMetric;
  /** Collections with method CASH only (the rep's cash position). */
  readonly cash: DashboardMetric;
  readonly returns: DashboardMetric;
  readonly vanStock: DashboardVanStock | null;
  readonly parkedRejections: number;
}

interface LineLike {
  qty?: unknown;
  unitPrice?: unknown;
  discountAmount?: unknown;
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A document's line net = qty × unitPrice − discountAmount (exact). */
function lineNet(line: LineLike): string {
  const qty = typeof line.qty === "string" ? line.qty : "0";
  const price = typeof line.unitPrice === "string" ? line.unitPrice : "0";
  const net = mulDecimals(qty, price);
  return typeof line.discountAmount === "string" && line.discountAmount !== ""
    ? subDecimals(net, line.discountAmount)
    : net;
}

/** A document's total: Σ line nets, or the explicit amount (receipts). */
function documentAmount(payload: Record<string, unknown>): string {
  if (typeof payload.amount === "string" && payload.amount !== "") return payload.amount;
  if (Array.isArray(payload.lines)) {
    return sumDecimals((payload.lines as LineLike[]).map((line) => lineNet(line)));
  }
  return "0";
}

function currencyOf(payload: Record<string, unknown>): string {
  return typeof payload.currencyCode === "string" && payload.currencyCode !== ""
    ? payload.currencyCode
    : "";
}

/** Aggregate one intent's outbox rows for a business date into a metric. */
function metricForDay(
  amounts: { amount: string; currencyCode: string; at: string }[],
): DashboardMetric {
  const byCurrency = new Map<string, string>();
  for (const entry of amounts) {
    const key = entry.currencyCode === "" ? "SAR" : entry.currencyCode;
    byCurrency.set(key, addDecimals(byCurrency.get(key) ?? "0", entry.amount));
  }
  const asOf = amounts.reduce<string | null>(
    (latest, entry) => (latest === null || entry.at > latest ? entry.at : latest),
    null,
  );
  return {
    byCurrency: [...byCurrency.entries()].map(([currencyCode, amount]) => ({ currencyCode, amount })),
    count: amounts.length,
    asOf,
  };
}

/** The outbox rows of one intent whose client date is `today`. */
function todayRows(
  adapter: StorageAdapter,
  entityType: string,
  intent: string,
  today: string,
) {
  return flowRows(adapter, entityType, intent).filter((row) => row.clientCreatedAt.slice(0, 10) === today);
}

/**
 * Build the companion dashboard over the pulled/local caches.
 *
 * `today` is the business date (YYYY-MM-DD — the caller's context date;
 * the flows stamp it onto the documents). The metrics read the device's
 * OWN documents regardless of honest state (a PENDING_SYNC sale still
 * happened locally; a REJECTED one awaits the parked screen — counts are
 * honest by inclusion, amounts are the document amounts).
 */
export function buildCompanionDashboard(
  adapter: StorageAdapter,
  input: { today: string },
): CompanionDashboard {
  const salesRows = todayRows(adapter, "sales_invoice", "create_draft", input.today);
  const collectionRows = todayRows(adapter, "receipt", "create_field_collection", input.today);
  const returnsRows = todayRows(adapter, "credit_note", "create_draft", input.today);

  const toEntries = (rows: typeof salesRows) =>
    rows.map((row) => {
      const payload = parsePayload(row.payload);
      return {
        amount: documentAmount(payload),
        currencyCode: currencyOf(payload),
        at: row.ackedAt ?? row.clientCreatedAt,
      };
    });

  const cashEntries = collectionRows
    .map((row) => ({ row, payload: parsePayload(row.payload) }))
    .filter(({ payload }) => payload.method === undefined || payload.method === "CASH")
    .map(({ row, payload }) => ({
      amount: documentAmount(payload),
      currencyCode: currencyOf(payload),
      at: row.ackedAt ?? row.clientCreatedAt,
    }));

  const vanStockRows = adapter.all(
    "SELECT qty, updated_at FROM van_stocks ORDER BY updated_at DESC, id",
  );
  const vanStock: DashboardVanStock | null =
    vanStockRows.length === 0
      ? null
      : {
          totalQty: sumDecimals(vanStockRows.map((row) => String(row.qty ?? "0"))),
          asOf: vanStockRows.reduce<string | null>(
            (latest, row) => {
              const at = row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at);
              return at !== null && (latest === null || at > latest) ? at : latest;
            },
            null,
          ),
        };

  return {
    today: input.today,
    sales: metricForDay(toEntries(salesRows)),
    collections: metricForDay(toEntries(collectionRows)),
    cash: metricForDay(cashEntries),
    returns: metricForDay(toEntries(returnsRows)),
    vanStock,
    parkedRejections: rejectedCommands(adapter).length,
  };
}
