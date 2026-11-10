"use client";

/**
 * T19-WEB (PHASE-014) — read-only product state context (SUBSCRIPTION §8):
 * the server AppShell resolves GET /tenancy/entitlements once per page and
 * publishes the subscription projection here; client components under the
 * shell (billing history, checkout, onboarding wizard) read it through
 * `useReadOnly()` to disable business-mutating actions with the bilingual
 * reason — reports/exports/printing stay enabled (never an error page).
 */
import { createContext, useContext } from "react";
import type { JSX, ReactNode } from "react";

export interface ReadOnlyState {
  /** True while the subscription is in the read-only grace period. */
  readOnly: boolean;
  /** ISO timestamp of grace expiry (display-only; the server enforces). */
  graceEndsAt: string | null;
}

const DEFAULT_STATE: ReadOnlyState = { readOnly: false, graceEndsAt: null };

const ReadOnlyContext = createContext<ReadOnlyState>(DEFAULT_STATE);

export function ReadOnlyProvider({
  value,
  children,
}: {
  value: ReadOnlyState;
  children: ReactNode;
}): JSX.Element {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

/** The ambient read-only state (defaults to writable when unresolved). */
export function useReadOnly(): ReadOnlyState {
  return useContext(ReadOnlyContext);
}
