"use client";
/**
 * PHASE-021 T2-b (DR-P21-06/§6) — `useSyncMirror`: the webview's honest
 * mirror of 2-a's shell-side `HostState` (apps/desktop/src/sync/host.ts).
 *
 * The sync ENGINE lives in the shell runtime; the webview never runs a
 * cycle. This hook DERIVES the UI state from store reads + connectivity:
 *
 *   corrupt    ← meta.quarantined === "true" (§6.4)
 *   revoked    ← meta.queueUnresolvable !== null (D-01: the host marked
 *                the queue unresolvable — DEVICE_REVOKED et al.)
 *   read-only  ← meta.contractGate === "read-only" (C-08, reason fixed
 *                to CONTRACT_VERSION_UNSUPPORTED)
 *   syncing    ← any outbox row IN_FLIGHT (best-effort mirror: the
 *                one-in-flight mutex lives shell-side; the store is the
 *                shared truth both sides see)
 *   idle       ← otherwise
 *   browser    ← no bridge (or a bridge without the SQLite store): the
 *                console renders ONLINE-ONLY states — never a simulation.
 *
 * queueDepth = QUEUED + IN_FLIGHT (2-a's queueDepth semantics); lastSyncAt
 * = MAX(cursors.synced_at) — the same stamp the AsOfLabel renders.
 *
 * Every refresh ALSO reconciles the draft_docs projections against the
 * outbox (ACKED → MERGED, REJECTED → SYNC_FAILED): the projection is the
 * webview's own surface, so the webview maintains it — the engine never
 * knows draft_docs exists.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useShell, type DesktopBridge } from "./bridge";
import {
  readAsOf,
  readDrafts,
  readMeta,
  readOutbox,
  updateDraftStatus,
  type DraftStatus,
  type OutboxRowView,
} from "./store-client";

/** The mirror phases — the webview counterpart of 2-a's HostState. */
export type SyncMirrorPhase = "browser" | "idle" | "syncing" | "read-only" | "revoked" | "corrupt";

export interface SyncMirrorState {
  readonly phase: SyncMirrorPhase;
  /** QUEUED + IN_FLIGHT (the "while dirty" depth). */
  readonly queueDepth: number;
  /** MAX(cursors.synced_at) — epoch ms; null when never synced. */
  readonly lastSyncAt: number | null;
  /** Exactly when phase === "read-only" (the C-08 reason is the only one). */
  readonly readOnlyReason: "CONTRACT_VERSION_UNSUPPORTED" | null;
  readonly online: boolean;
  /** Bumped on every completed refresh — consumers re-read their lists. */
  readonly version: number;
}

export interface SyncTriggerResult {
  readonly status: "called" | "unavailable";
}

const POLL_INTERVAL_MS = 30_000;

const INITIAL_STATE: SyncMirrorState = {
  phase: "browser",
  queueDepth: 0,
  lastSyncAt: null,
  readOnlyReason: null,
  online: true,
  version: 0,
};

export function useSyncMirror(): {
  state: SyncMirrorState;
  refresh: () => Promise<void>;
  triggerSyncNow: () => Promise<SyncTriggerResult>;
  triggerPushNow: () => Promise<SyncTriggerResult>;
  /** capabilities.sync === true (DR-P21-09) — the buttons gate on this. */
  syncAvailable: boolean;
} {
  const { bridge, capabilities, online } = useShell();
  const [state, setState] = useState<SyncMirrorState>(INITIAL_STATE);
  /** Serialized refreshes: derivation + reconcile must never interleave. */
  const inFlight = useRef<Promise<void> | null>(null);
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  const refresh = useCallback(async (): Promise<void> => {
    const current = bridgeRef.current;
    if (current === null || current.capabilities.sqlite !== true) {
      setState((prev) => ({ ...prev, phase: "browser", online, version: prev.version + 1 }));
      return;
    }
    const [quarantined, contractGate, queueUnresolvable, outboxRows, asOf] = await Promise.all([
      readMeta(current, "quarantined"),
      readMeta(current, "contractGate"),
      readMeta(current, "queueUnresolvable"),
      readOutbox(current),
      readAsOf(current),
    ]);
    const queueDepth = outboxRows.filter((row) => row.status === "QUEUED" || row.status === "IN_FLIGHT").length;
    let phase: SyncMirrorPhase;
    let readOnlyReason: "CONTRACT_VERSION_UNSUPPORTED" | null = null;
    if (quarantined === "true") {
      phase = "corrupt";
    } else if (queueUnresolvable !== null) {
      phase = "revoked";
    } else if (contractGate === "read-only") {
      phase = "read-only";
      readOnlyReason = "CONTRACT_VERSION_UNSUPPORTED";
    } else if (outboxRows.some((row) => row.status === "IN_FLIGHT")) {
      phase = "syncing";
    } else {
      phase = "idle";
    }
    setState((prev) => ({
      phase,
      queueDepth,
      lastSyncAt: asOf,
      readOnlyReason,
      online,
      version: prev.version + 1,
    }));
    // Projection maintenance (see the module header): the webview owns
    // draft_docs, so the webview reconciles it against the outbox truth.
    await reconcileDrafts(current, outboxRows);
  }, [online]);

  /** One refresh at a time — concurrent callers await the same run. */
  const serializedRefresh = useCallback(async (): Promise<void> => {
    const run = (inFlight.current ?? Promise.resolve()).then(refresh);
    inFlight.current = run.finally(() => {
      if (inFlight.current === run) inFlight.current = null;
    });
    return run;
  }, [refresh]);

  useEffect(() => {
    void serializedRefresh();
    if (typeof document === "undefined") return;
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void serializedRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [serializedRefresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => void serializedRefresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [serializedRefresh]);

  const triggerSyncNow = useCallback(async (): Promise<SyncTriggerResult> => {
    const current = bridgeRef.current;
    if (current === null || current.sync === undefined) {
      return { status: "unavailable" };
    }
    await current.sync.syncNow();
    await serializedRefresh();
    return { status: "called" };
  }, [serializedRefresh]);

  const triggerPushNow = useCallback(async (): Promise<SyncTriggerResult> => {
    const current = bridgeRef.current;
    if (current === null || current.sync === undefined) {
      return { status: "unavailable" };
    }
    await current.sync.pushNow();
    await serializedRefresh();
    return { status: "called" };
  }, [serializedRefresh]);

  return {
    state,
    refresh: serializedRefresh,
    triggerSyncNow,
    triggerPushNow,
    syncAvailable: capabilities.sync === true,
  };
}

/** The statuses a draft flips to when its linked outbox command lands. */
function reconciledStatus(row: OutboxRowView): DraftStatus | null {
  if (row.status === "ACKED") return "MERGED";
  if (row.status === "REJECTED") return "SYNC_FAILED";
  return null;
}

async function reconcileDrafts(
  bridge: DesktopBridge,
  outboxRows: readonly OutboxRowView[],
): Promise<void> {
  const byCommand = new Map(outboxRows.map((row) => [row.commandId, row]));
  const drafts = await readDrafts(bridge);
  for (const draft of drafts) {
    if (draft.commandId === null) continue;
    if (draft.localStatus === "MERGED" || draft.localStatus === "CANCELLED_LOCAL") continue;
    const row = byCommand.get(draft.commandId);
    if (row === undefined) continue;
    const next = reconciledStatus(row);
    if (next === null) continue;
    if (next === draft.localStatus) continue;
    // SYNC_FAILED carries the outbox row's typed reason; MERGED clears it.
    await updateDraftStatus(
      bridge,
      draft.localId,
      next,
      next === "SYNC_FAILED" ? row.rejectionReason : null,
    );
  }
}
