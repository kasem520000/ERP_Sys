/**
 * PHASE-022 T-P22-3-b · the statement view-model (MASTER-PLAN §8 row 13;
 * OFFLINE_CAPABILITIES_MATRIX android-personal row 13 + the field
 * companion's per-customer statement): the cached statement snapshot
 * (`statements` read cache — the StatementLite projection, LOCAL_DATABASE
 * §1.1) rendered as entries + a RUNNING BALANCE + the as-of label.
 *
 * READ-CACHED† only — no writes, no enqueue, no command builders (the
 * structural no-write proof in companion-personal.test covers this
 * module). Stale is labeled, never guessed: the view carries `asOf`
 * (the snapshot's business as-of date) and `generatedAt` (when the
 * server computed it); the screen renders both through AsOfLabel.
 */
import type { StorageAdapter } from "@erp/sync-core";

import { addDecimals } from "../exact-decimal";

/** One statement entry with its running balance (the StatementLite shape). */
export interface StatementViewEntry {
  /** ISO date (YYYY-MM-DD). */
  readonly entryDate: string;
  readonly docRef: string | null;
  readonly sourceType: string;
  readonly currencyCode: string;
  readonly debit: string;
  readonly credit: string;
  /** The running balance AFTER this entry (the projection's field; the
   * view-model recomputes it from the opening balance when absent). */
  readonly balance: string;
  readonly outstanding: string;
}

/** The rendered statement view (one partner's cached snapshot). */
export interface StatementView {
  readonly partnerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly currencyCode: string;
  readonly openingBalance: string;
  readonly closingBalance: string;
  readonly entries: readonly StatementViewEntry[];
  /** The aging buckets (the honest due-date structure the cache carries). */
  readonly aging: Readonly<Record<string, string>> | null;
  /** The snapshot's business as-of date (YYYY-MM-DD) — null = never pulled. */
  readonly asOf: string | null;
  /** When the SERVER computed the snapshot (ISO timestamp). */
  readonly generatedAt: string | null;
}

interface StatementRow {
  id: string;
  customer_code: string;
  customer_name: string;
  customer_name_ar: string | null;
  as_of: string | null;
  currency_code: string | null;
  opening_balance: string | null;
  closing_balance: string | null;
  aging: string | null;
  entries: string | null;
  generated_at: string | null;
  payload: string;
  updated_at: string | null;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Build the statement view over the cached snapshot(s).
 *
 * `partnerId` selects one partner's statement; when omitted the MOST
 * RECENTLY UPDATED snapshot wins (the personal profile holds exactly the
 * linked partner; the field profile may hold several customers' rows).
 * Returns null when nothing was ever pulled (the honest empty state —
 * never a fabricated zero statement). */
export function buildStatementView(
  adapter: StorageAdapter,
  input: { partnerId?: string | null } = {},
): StatementView | null {
  const row = (
    input.partnerId === undefined || input.partnerId === null
      ? adapter.get(
          "SELECT * FROM statements ORDER BY updated_at DESC, id DESC LIMIT 1",
        )
      : adapter.get("SELECT * FROM statements WHERE id = ? LIMIT 1", [input.partnerId])
  ) as StatementRow | undefined;
  if (row === undefined) return null;

  const payload = parseJson<{
    entries?: unknown;
    aging?: unknown;
    openingBalance?: unknown;
    closingBalance?: unknown;
    currencyCode?: unknown;
    asOf?: unknown;
    generatedAt?: unknown;
  }>(row.payload);

  const rawEntries = parseJson<unknown[]>(row.entries) ?? (Array.isArray(payload?.entries) ? (payload!.entries as unknown[]) : []);
  const openingBalance =
    row.opening_balance ??
    (typeof payload?.openingBalance === "string" ? payload!.openingBalance : "0");
  let running = openingBalance;
  const entries: StatementViewEntry[] = rawEntries.map((raw) => {
    const entry = raw as Record<string, unknown>;
    const str = (key: string, fallback = "0"): string =>
      typeof entry[key] === "string" ? (entry[key] as string) : fallback;
    const nullable = (key: string): string | null =>
      typeof entry[key] === "string" ? (entry[key] as string) : null;
    const debit = str("debit");
    const credit = str("credit");
    running = addDecimals(addDecimals(running, debit), `-${credit}`);
    const statedBalance = str("balance");
    const balance = statedBalance === "0" && running !== "0" ? running : statedBalance;
    return {
      entryDate: str("entryDate", ""),
      docRef: nullable("docRef"),
      sourceType: str("sourceType", ""),
      currencyCode: str("currencyCode", row.currency_code ?? ""),
      debit,
      credit,
      balance: entry["balance"] === undefined ? running : balance,
      outstanding: str("outstanding"),
    };
  });

  const aging =
    parseJson<Record<string, string>>(row.aging) ??
    (payload?.aging !== null && typeof payload?.aging === "object"
      ? (payload!.aging as Record<string, string>)
      : null);

  return {
    partnerId: row.id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    customerNameAr: row.customer_name_ar,
    currencyCode:
      row.currency_code ??
      (typeof payload?.currencyCode === "string" ? payload!.currencyCode : ""),
    openingBalance,
    closingBalance:
      row.closing_balance ??
      (typeof payload?.closingBalance === "string" ? payload!.closingBalance : running),
    entries,
    aging,
    asOf:
      row.as_of ??
      (typeof payload?.asOf === "string" ? payload!.asOf : null) ??
      row.updated_at,
    generatedAt:
      row.generated_at ??
      (typeof payload?.generatedAt === "string" ? payload!.generatedAt : null),
  };
}
