/**
 * PHASE-022 T-P22-2-e · the route-visit list view-model (MASTER-PLAN §8 —
 * BINDING; the Journey G2/G3 surface: today's visits, per-customer tier
 * pricing + balances from cache, visit completion state).
 *
 * PURE view-model over the cached routes + statements + partners + price
 * feeds (READ-CACHED, as-of labeled — stale is labeled, never guessed):
 *
 *   - TODAY'S ROUTES: the ACTIVE routes whose `dayPattern` (the jsonb
 *     weekday plan, e.g. ["SUN","MON",…]) includes the requested date's
 *     weekday, optionally narrowed to one sales rep.
 *   - THE VISIT LIST: each route's ordered customers (`visitOrder`), each
 *     row carrying the partner's cached name/code, the statement balance
 *     (the AR closing balance as-of the snapshot), the credit limit, the
 *     tier-pricing availability (the partner's price list has cached
 *     entries for ANY item — "per-customer tier pricing from cache"), and
 *     the open-invoice count (the statement's open sales_invoice entries).
 *   - VISIT COMPLETION: PLANNED by default; DONE when the device's outbox
 *     holds a van-sale or collection command referencing the partner (the
 *     visit produced a document — any state, the honest signal);
 *     SKIPPED when the rep marked it so (a local meta flag, per-date).
 *
 * The "sell here / collect here" actions (routesVisitSellHere /
 * routesVisitCollectHere) are the screen's navigation affordances — this
 * module supplies the partner + route context they navigate WITH.
 */
import type { StorageAdapter } from "@erp/sync-core";
import { metaDelete, metaGet, metaSet } from "@erp/sync-core";

import { readPartner, readStatement } from "./prevalidation";
import { contextToday, type FieldFlowContext } from "./state-machine";

/** The visit completion states (Journey G2/G3). */
export type VisitState = "PLANNED" | "DONE" | "SKIPPED";

/** One route customer's visit row (the list item the screen renders). */
export interface RouteVisitCustomer {
  readonly partnerId: string;
  readonly visitOrder: number;
  readonly isPinned: boolean;
  readonly code: string;
  readonly name: string;
  /** The cached AR closing balance (TEXT decimal; null → no cached statement). */
  readonly balance: string | null;
  readonly currencyCode: string | null;
  /** The statement snapshot's as-of date (the honest label input). */
  readonly asOf: string | null;
  readonly creditLimit: string | null;
  /** Whether the partner's price list has cached entries (tier pricing). */
  readonly tierPricing: boolean;
  /** The open sales_invoice entries with outstanding > 0 (the cached count). */
  readonly openInvoices: number;
  readonly visitState: VisitState;
}

/** One route's visit day (today's slice). */
export interface RouteVisitDay {
  readonly routeId: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly vanWarehouseId: string | null;
  readonly customers: readonly RouteVisitCustomer[];
}

/** The weekday keys the routes' dayPattern carries (the 017 jsonb plan). */
const WEEKDAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/** The weekday key of an ISO date (pure — Date.UTC math, no floats). */
export function weekdayKey(isoDate: string): (typeof WEEKDAY_KEYS)[number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return null;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (utc.getUTCFullYear() !== Number(match[1])) return null;
  return WEEKDAY_KEYS[utc.getUTCDay()] ?? null;
}

/** The parsed dayPattern (a JSON weekday array; junk → an empty set). */
function parseDayPattern(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((day): day is string => typeof day === "string"));
    }
  } catch {
    // junk pattern → no days (the route never matches — honest).
  }
  return new Set();
}

/** The parsed route customers (ordered by visitOrder; junk → empty). */
interface RouteCustomerRow {
  partnerId: string;
  visitOrder: number;
  isPinned: boolean;
}

function parseCustomers(raw: string | null): RouteCustomerRow[] {
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): RouteCustomerRow | null => {
        if (entry === null || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const partnerId = typeof record.partnerId === "string" ? record.partnerId : null;
        if (partnerId === null) return null;
        return {
          partnerId,
          visitOrder: Number(record.visitOrder ?? 0),
          isPinned: record.isPinned === true,
        };
      })
      .filter((row): row is RouteCustomerRow => row !== null)
      .sort((a, b) => a.visitOrder - b.visitOrder || a.partnerId.localeCompare(b.partnerId));
  } catch {
    return [];
  }
}

// -- visit completion state -----------------------------------------------------------

/** The partners the device's outbox holds a van-sale/collection command for. */
function visitedPartnerIds(adapter: StorageAdapter): Set<string> {
  const rows = adapter.all(
    "SELECT entity_type, intent, payload FROM outbox WHERE (entity_type = ? AND intent = ?) OR (entity_type = ? AND intent = ?)",
    ["sales_invoice", "create_draft", "receipt", "create_field_collection"],
  );
  const visited = new Set<string>();
  for (const row of rows) {
    try {
      const payload = JSON.parse(String(row.payload ?? "{}")) as {
        customerId?: unknown;
        partnerId?: unknown;
      };
      const id = typeof payload.customerId === "string" ? payload.customerId
        : typeof payload.partnerId === "string" ? payload.partnerId
        : null;
      if (id !== null) visited.add(id);
    } catch {
      // an unparseable pending payload contributes no visit signal
    }
  }
  return visited;
}

/** The meta key of a date's skipped visit (local-only state). */
function skippedKey(date: string, partnerId: string): string {
  return `route_visit_skipped:${date}:${partnerId}`;
}

/** Mark a visit skipped for a date (local meta — the rep's plan, never synced). */
export function markVisitSkipped(adapter: StorageAdapter, date: string, partnerId: string): void {
  metaSet(adapter, skippedKey(date, partnerId), "1");
}

/** Un-mark a skipped visit (the rep re-opens the stop). */
export function unmarkVisitSkipped(adapter: StorageAdapter, date: string, partnerId: string): void {
  metaDelete(adapter, skippedKey(date, partnerId));
}

/** Whether a visit is locally marked skipped for a date. */
export function isVisitSkipped(adapter: StorageAdapter, date: string, partnerId: string): boolean {
  return metaGet(adapter, skippedKey(date, partnerId)) !== null;
}

// -- the view-model -------------------------------------------------------------------

/** Build today's route-visit days (the Journey G2/G3 list). */
export function buildRouteVisitDays(
  adapter: StorageAdapter,
  options?: { today?: string; salesRepId?: string | null },
): RouteVisitDay[] {
  const today = options?.today !== undefined ? options.today : new Date().toISOString().slice(0, 10);
  const weekday = weekdayKey(today);
  if (weekday === null) return [];
  const routeRows = adapter.all("SELECT * FROM routes WHERE status = ?", ["ACTIVE"]);
  const visited = visitedPartnerIds(adapter);
  const days: RouteVisitDay[] = [];
  for (const row of routeRows) {
    const dayPattern = parseDayPattern(row.day_pattern === null || row.day_pattern === undefined ? null : String(row.day_pattern));
    if (!dayPattern.has(weekday)) continue;
    const salesRepId =
      row.sales_rep_id === null || row.sales_rep_id === undefined ? null : String(row.sales_rep_id);
    if (options?.salesRepId !== undefined && options.salesRepId !== null && salesRepId !== options.salesRepId) {
      continue;
    }
    const customers = parseCustomers(
      row.customers === null || row.customers === undefined ? null : String(row.customers),
    ).map((customer): RouteVisitCustomer => {
      const partner = readPartner(adapter, customer.partnerId);
      const statement = readStatement(adapter, customer.partnerId);
      const priceListId = partner?.priceListId ?? null;
      const tierPricing =
        priceListId !== null &&
        adapter.get("SELECT id FROM price_list_items WHERE price_list_id = ? LIMIT 1", [priceListId]) !==
          undefined;
      const openInvoices = (statement?.entries ?? []).filter(
        (entry) => entry.sourceType === "sales_invoice" && Number(entry.outstanding) > 0,
      ).length;
      const visitState: VisitState = visited.has(customer.partnerId)
        ? "DONE"
        : isVisitSkipped(adapter, today, customer.partnerId)
          ? "SKIPPED"
          : "PLANNED";
      return {
        partnerId: customer.partnerId,
        visitOrder: customer.visitOrder,
        isPinned: customer.isPinned,
        code: partner?.code ?? "",
        name: partner?.name ?? statement?.customerName ?? customer.partnerId,
        balance: statement?.closingBalance ?? null,
        currencyCode: statement?.currencyCode ?? null,
        asOf: statement?.asOf ?? null,
        creditLimit: partner?.creditLimit ?? null,
        tierPricing,
        openInvoices,
        visitState,
      };
    });
    days.push({
      routeId: String(row.id),
      code: String(row.code ?? ""),
      name: String(row.name ?? ""),
      nameAr: row.name_ar === null || row.name_ar === undefined ? null : String(row.name_ar),
      vanWarehouseId:
        row.van_warehouse_id === null || row.van_warehouse_id === undefined
          ? null
          : String(row.van_warehouse_id),
      customers,
    });
  }
  days.sort((a, b) => a.code.localeCompare(b.code));
  return days;
}

/** The route-visit context for one partner (the sell-here/collect-here
 * navigation payload: the route's van warehouse + the visit date). */
export interface VisitActionContext {
  readonly partnerId: string;
  readonly routeId: string;
  readonly vanWarehouseId: string | null;
  readonly date: string;
}

/** Resolve the visit-action context for a partner on a date (null when no
 * today-route carries the partner). */
export function visitActionContext(
  adapter: StorageAdapter,
  partnerId: string,
  options?: { today?: string },
): VisitActionContext | null {
  const today = options?.today !== undefined ? options.today : new Date().toISOString().slice(0, 10);
  const weekday = weekdayKey(today);
  if (weekday === null) return null;
  const rows = adapter.all("SELECT * FROM routes WHERE status = ?", ["ACTIVE"]);
  for (const row of rows) {
    const dayPattern = parseDayPattern(row.day_pattern === null || row.day_pattern === undefined ? null : String(row.day_pattern));
    if (!dayPattern.has(weekday)) continue;
    const customers = parseCustomers(row.customers === null || row.customers === undefined ? null : String(row.customers));
    if (!customers.some((customer) => customer.partnerId === partnerId)) continue;
    return {
      partnerId,
      routeId: String(row.id),
      vanWarehouseId:
        row.van_warehouse_id === null || row.van_warehouse_id === undefined
          ? null
          : String(row.van_warehouse_id),
      date: today,
    };
  }
  return null;
}

/** The flow context convenience: today resolved (re-export for the screens). */
export { contextToday };
export type { FieldFlowContext };
