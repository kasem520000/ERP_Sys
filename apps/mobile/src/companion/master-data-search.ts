/**
 * PHASE-022 T-P22-3-b · the cached master-data search (MASTER-PLAN §8
 * row 33; OFFLINE_CAPABILITIES_MATRIX row 33 — "master-data search from
 * cache"): items + partners straight out of the v1 POS read caches, with
 * the per-row as-of label (stale is labeled, never guessed).
 *
 * READ-CACHED† only — no writes, no enqueue, no command builders (the
 * structural no-write proof covers this module). The LIKE pattern is
 * escaped (a query containing % or _ matches literally — a search box is
 * user input, never SQL).
 */
import type { StorageAdapter } from "@erp/sync-core";

/** One search hit (an item or a partner from the cache). */
export interface MasterDataHit {
  readonly kind: "item" | "partner";
  readonly id: string;
  /** The item's SKU / the partner's code. */
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly status: string;
  /** The cache row's updated_at (null = never refreshed — labeled). */
  readonly asOf: string | null;
}

/** Escape a LIKE pattern (user input matches literally). */
function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Search the cached items + partners by code / name / Arabic name.
 *
 * An empty/whitespace query returns [] (no fetch-all "search"); results
 * are newest-updated first, capped at `limit` per kind (default 10). */
export function searchMasterData(
  adapter: StorageAdapter,
  input: { query: string; limit?: number },
): MasterDataHit[] {
  const query = input.query.trim();
  if (query === "") return [];
  const limit = input.limit ?? 10;
  const pattern = `%${escapeLike(query)}%`;
  const like = `(code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR COALESCE(name_ar, '') LIKE ? ESCAPE '\\')`;

  const items = adapter
    .all(
      `SELECT id, sku AS code, name, name_ar, status, updated_at
         FROM items
        WHERE sku LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
           OR COALESCE(name_ar, '') LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC, id LIMIT ?`,
      [pattern, pattern, pattern, limit],
    )
    .map((row) => ({
      kind: "item" as const,
      id: String(row.id),
      code: String(row.code ?? ""),
      name: String(row.name ?? ""),
      nameAr: row.name_ar === null || row.name_ar === undefined ? null : String(row.name_ar),
      status: String(row.status ?? ""),
      asOf: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
    }));

  const partners = adapter
    .all(
      `SELECT id, code, name, name_ar, status, updated_at
         FROM partners
        WHERE ${like}
        ORDER BY updated_at DESC, id LIMIT ?`,
      [pattern, pattern, pattern, limit],
    )
    .map((row) => ({
      kind: "partner" as const,
      id: String(row.id),
      code: String(row.code ?? ""),
      name: String(row.name ?? ""),
      nameAr: row.name_ar === null || row.name_ar === undefined ? null : String(row.name_ar),
      status: String(row.status ?? ""),
      asOf: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
    }));

  return [...items, ...partners];
}
