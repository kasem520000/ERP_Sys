"use client";
/**
 * PHASE-021 T2-b · shared form types: the cached option catalogs the
 * console loads once per mirror refresh and hands to every draft form,
 * plus the editing (rejection → edit-and-resend) hand-off shape.
 */
import type { CachedCountSession, CachedItem, CachedPartner, CachedTaxCode, DraftRowView, OutboxRowView } from "../../../lib/shell/store-client";

/** The pickers' sources (READ-CACHED; the local v1–v4 caches). */
export interface ConsoleOptions {
  readonly items: readonly CachedItem[];
  readonly partners: readonly CachedPartner[];
  readonly taxCodes: readonly CachedTaxCode[];
  readonly countSessions: readonly CachedCountSession[];
}

/** The editing hand-off: a rejected draft re-opened in its form. */
export interface EditingDraft {
  readonly draft: DraftRowView;
  readonly row: OutboxRowView;
}

/** Parse the editing draft's original payload (defensive — null on junk). */
export function editingPayload(editing: EditingDraft | null): Record<string, unknown> | null {
  if (editing === null) return null;
  try {
    const parsed: unknown = JSON.parse(editing.draft.payload);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read a string field out of an editing payload ("" when absent). */
export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Read a possibly-null uuid ("" when absent/null). */
export function uuid(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Read a lines array out of an editing payload (never null). */
export function lines(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
