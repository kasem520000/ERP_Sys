/**
 * PHASE-013 · in-process ledger events (REPORTING_ARCHITECTURE §6.3;
 * MODULE_BOUNDARIES §events "posting events flow in for cache
 * invalidation"): the accounting module publishes ledger mutations that can
 * change report results; the reporting module's cache subscribes and drops
 * the affected tenant's entries. Side-channel signals, never the record —
 * the durable truth stays journal entries + audit events.
 *
 * Fail-safe semantics: a published-but-rolled-back transaction causes a
 * spurious invalidation (harmless recompute); a missed event would leave a
 * stale cache — which is why "current" runs are additionally capped at a
 * 60 s TTL (REPORTING_ARCHITECTURE §6.4) and as-of runs are deterministic
 * re-reads of immutable lines.
 */

export type LedgerEventType =
  /** A journal entry was posted (reversals are posts — they fire this too). */
  | "journal.posted"
  /** A fiscal period was locked (close-time invalidation). */
  | "period.locked";

export interface LedgerEvent {
  type: LedgerEventType;
  tenantId: string;
  entryId?: string;
  periodId?: string;
}

type Listener = (event: LedgerEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to ledger events (reporting cache invalidation). */
export function onLedgerEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish a ledger event (accounting module internals only). */
export function publishLedgerEvent(event: LedgerEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken subscriber must never break the posting transaction.
    }
  }
}
