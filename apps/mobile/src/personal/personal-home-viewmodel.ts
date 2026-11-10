/**
 * PHASE-022 T-P22-3-b · the personal home view-model (MASTER-PLAN §8
 * "Personal: balance/statement/invoices/receipts/due dates/notifications
 * — READ-CACHED, as-of labels, zero write affordances"; OFFLINE_CAPABIL
 * ITIES_MATRIX row 29 — the personal device class): balance + the honest
 * due-date structure (the statement snapshot's AGING buckets — the only
 * due-date data the cache carries; never a guessed date) + recent
 * documents (invoices + receipts read models) + the notifications cache.
 *
 * READ-ONLY class by construction: no writes, no enqueue, no command
 * builders (the structural no-write proof covers this module). Stale is
 * labeled, never guessed: every section carries its own as-of.
 */
import type { StorageAdapter } from "@erp/sync-core";

/** The aging bucket keys (the statement snapshot's due-date structure). */
export const AGING_BUCKETS = ["not_due", "1_30", "31_60", "61_90", "90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** One aging row (bucket → amount, the honest "when is money due"). */
export interface AgingRow {
  readonly bucket: AgingBucket;
  readonly amount: string;
}

/** One recent document (an invoice or a receipt from the read models). */
export interface RecentDocRow {
  readonly kind: "invoice" | "receipt";
  readonly id: string;
  readonly number: string | null;
  readonly date: string | null;
  readonly amount: string | null;
  readonly currencyCode: string | null;
  readonly status: string;
  readonly asOf: string | null;
}

/** One cached notification (the bilingual {ar,en} title/body shapes). */
export interface NotificationRow {
  readonly id: string;
  readonly category: string | null;
  readonly severity: string | null;
  readonly titleAr: string | null;
  readonly titleEn: string | null;
  readonly readAt: string | null;
  readonly asOf: string | null;
}

/** The personal home view (row 29 — read-only by construction). */
export interface PersonalHomeView {
  /** The linked partner's balance (null = no statement pulled yet). */
  readonly balance: {
    readonly amount: string;
    readonly currencyCode: string;
    readonly asOf: string | null;
    readonly generatedAt: string | null;
  } | null;
  /** The linked partner identity (the statement snapshot's customer). */
  readonly linkedPartner: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly nameAr: string | null;
  } | null;
  /** The due-date structure (aging buckets; [] when no statement). */
  readonly aging: readonly AgingRow[];
  /** The latest documents (invoices + receipts merged, newest first). */
  readonly recentDocs: readonly RecentDocRow[];
  /** The notifications cache (newest first). */
  readonly notifications: readonly NotificationRow[];
  /** Unread notifications count. */
  readonly unreadCount: number;
}

function parseJson<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

/** The bilingual title/body picker ({ar,en} jsonb at rest). */
function bilingual(raw: unknown): { ar: string | null; en: string | null } {
  const parsed = parseJson<{ ar?: unknown; en?: unknown }>(raw);
  if (parsed !== null) {
    return {
      ar: typeof parsed.ar === "string" ? parsed.ar : null,
      en: typeof parsed.en === "string" ? parsed.en : null,
    };
  }
  return typeof raw === "string" ? { ar: raw, en: raw } : { ar: null, en: null };
}

/**
 * Build the personal home view over the personal read models. All reads;
 * `today` is accepted for interface symmetry with the field context (the
 * aging buckets are server-computed — no local date math on money).
 */
export function buildPersonalHome(
  adapter: StorageAdapter,
  input: { today?: string; docLimit?: number; notificationLimit?: number } = {},
): PersonalHomeView {
  const docLimit = input.docLimit ?? 5;
  const notificationLimit = input.notificationLimit ?? 10;

  const statement = adapter.get(
    `SELECT id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
            closing_balance, aging, generated_at, updated_at
       FROM statements ORDER BY updated_at DESC, id DESC LIMIT 1`,
  );
  const balance =
    statement === undefined
      ? null
      : {
          amount: String(statement.closing_balance ?? "0"),
          currencyCode: String(statement.currency_code ?? ""),
          asOf:
            statement.as_of === null || statement.as_of === undefined
              ? null
              : String(statement.as_of),
          generatedAt:
            statement.generated_at === null || statement.generated_at === undefined
              ? null
              : String(statement.generated_at),
        };
  const linkedPartner =
    statement === undefined
      ? null
      : {
          id: String(statement.id),
          code: String(statement.customer_code ?? ""),
          name: String(statement.customer_name ?? ""),
          nameAr:
            statement.customer_name_ar === null || statement.customer_name_ar === undefined
              ? null
              : String(statement.customer_name_ar),
        };
  const agingRaw = parseJson<Record<string, unknown>>(statement?.aging) ?? {};
  const aging: AgingRow[] = AGING_BUCKETS.map((bucket) => ({
    bucket,
    amount: typeof agingRaw[bucket] === "string" ? (agingRaw[bucket] as string) : "0",
  }));

  const invoices = adapter
    .all(
      `SELECT id, invoice_no, status, order_date, total_amount, currency, updated_at
         FROM sales_invoices ORDER BY updated_at DESC, id LIMIT ?`,
      [docLimit],
    )
    .map((row) => ({
      kind: "invoice" as const,
      id: String(row.id),
      number:
        row.invoice_no === null || row.invoice_no === undefined ? null : String(row.invoice_no),
      date: row.order_date === null || row.order_date === undefined ? null : String(row.order_date),
      amount:
        row.total_amount === null || row.total_amount === undefined
          ? null
          : String(row.total_amount),
      currencyCode: row.currency === null || row.currency === undefined ? null : String(row.currency),
      status: String(row.status ?? ""),
      asOf: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
    }));
  const receipts = adapter
    .all(
      `SELECT id, receipt_no, status, value_date, amount, currency_code, updated_at
         FROM receipts ORDER BY updated_at DESC, id LIMIT ?`,
      [docLimit],
    )
    .map((row) => ({
      kind: "receipt" as const,
      id: String(row.id),
      number:
        row.receipt_no === null || row.receipt_no === undefined ? null : String(row.receipt_no),
      date: row.value_date === null || row.value_date === undefined ? null : String(row.value_date),
      amount: row.amount === null || row.amount === undefined ? null : String(row.amount),
      currencyCode:
        row.currency_code === null || row.currency_code === undefined
          ? null
          : String(row.currency_code),
      status: String(row.status ?? ""),
      asOf: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
    }));
  const recentDocs = [...invoices, ...receipts]
    .sort((a, b) => (b.asOf ?? "").localeCompare(a.asOf ?? "") || b.id.localeCompare(a.id))
    .slice(0, docLimit);

  const notifications = adapter
    .all(
      `SELECT id, category, severity, title, read_at, updated_at
         FROM notifications ORDER BY updated_at DESC, id LIMIT ?`,
      [notificationLimit],
    )
    .map((row) => {
      const title = bilingual(row.title);
      return {
        id: String(row.id),
        category: row.category === null || row.category === undefined ? null : String(row.category),
        severity:
          row.severity === null || row.severity === undefined ? null : String(row.severity),
        titleAr: title.ar,
        titleEn: title.en,
        readAt: row.read_at === null || row.read_at === undefined ? null : String(row.read_at),
        asOf: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
      };
    });
  const unreadRow = adapter.get("SELECT count(*) AS n FROM notifications WHERE read_at IS NULL");
  const unreadCount = Number(unreadRow?.n ?? 0);

  return { balance, linkedPartner, aging, recentDocs, notifications, unreadCount };
}
