import { createHash } from "node:crypto";

import type { ReportResult } from "./contract";

/**
 * PHASE-013 T10 · the report cache (REPORTING_ARCHITECTURE §6): keyed by
 * `(tenant, report_id, contract_version, params_hash)` with as-of semantics
 * inside params_hash — a "current" run and an as-of run never share entries.
 * Invalidation: ledger events (journal.posted / period.locked — wired via
 * the accounting ledger-events bus) drop the tenant's entries; "current"
 * runs are additionally capped at a 60 s TTL regardless of contract TTL.
 * As-of entries live until an event mutates posted history in their window
 * (a period reopen inserting into a cached as-of window is exactly such a
 * mutation — INV-020 discipline).
 */

export interface CacheEntry {
  readonly result: ReportResult;
  readonly storedAt: number;
  readonly ttlMs: number;
}

const MAX_CURRENT_TTL_MS = 60_000;

export class ReportCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly tenantIndex = new Map<string, string>();
  private unsubscribe: (() => void) | undefined;

  /** Wire ledger-event invalidation (call once at module init). */
  attachLedgerEvents(
    subscribe: (
      listener: (event: { type: string; tenantId: string }) => void,
    ) => () => void,
  ): void {
    this.unsubscribe?.();
    this.unsubscribe = subscribe((event) => {
      this.invalidateTenantEntries(event.tenantId);
    });
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  static cacheKey(parts: {
    tenantId: string;
    reportId: string;
    contractVersion: number;
    params: Record<string, unknown>;
  }): string {
    const canonical = ReportCache.canonicalParams(parts.params);
    return createHash("sha256")
      .update(`${parts.tenantId}|${parts.reportId}|${parts.contractVersion}|${canonical}`)
      .digest("hex");
  }

  /** Params hash for the run row (idempotency key component). */
  static paramsHash(params: Record<string, unknown>): string {
    return createHash("sha256").update(ReportCache.canonicalParams(params)).digest("hex");
  }

  private static canonicalParams(params: Record<string, unknown>): string {
    // Deterministic JSON: object keys sorted at every nesting level so two
    // param sets that differ only in key order hash identically.
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(canonicalize);
      }
      if (value !== null && typeof value === "object") {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
          sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
        }
        return sorted;
      }
      return value;
    };
    return JSON.stringify(canonicalize(params));
  }

  get(
    key: string,
    options: { semantics: "as-of" | "current" } = { semantics: "as-of" },
  ): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    const ttl =
      options.semantics === "current"
        ? Math.min(entry.ttlMs, MAX_CURRENT_TTL_MS)
        : entry.ttlMs;
    if (Date.now() - entry.storedAt >= ttl) {
      this.entries.delete(key);
      this.tenantIndex.delete(key);
      return undefined;
    }
    return entry;
  }

  setForTenant(tenantId: string, key: string, result: ReportResult, ttlMs: number): void {
    if (ttlMs <= 0) {
      return; // cacheTtlSeconds: 0 = no caching (contract-declared)
    }
    this.entries.set(key, { result, storedAt: Date.now(), ttlMs });
    this.tenantIndex.set(key, tenantId);
  }

  /** Invalidate one tenant's entries (posting/lock events). Returns count. */
  invalidateTenantEntries(tenantId: string): number {
    let dropped = 0;
    for (const [key, tenant] of this.tenantIndex) {
      if (tenant === tenantId) {
        this.entries.delete(key);
        this.tenantIndex.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  /** Test seam: reset everything. */
  clear(): void {
    this.entries.clear();
    this.tenantIndex.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
