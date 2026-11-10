"use client";
/**
 * PHASE-021 T2-b (DR-P21-06/§8) — the browser-safe shell bridge client.
 *
 * The bridge TYPES are DUPLICATED here, structurally identical to
 * `apps/desktop/src/bridge/contract.ts` INCLUDING the optional `sync`
 * member (DR-P21-09) — apps/web NEVER imports `@erp/desktop` (the
 * depcruise `desktop-no-web` boundary rule cuts the other way too); the
 * schema-parity spec (`__tests__/local-schema-parity.test.ts`) imports
 * the real package as a devDependency and pins the duplication against
 * the desktop migrations instead.
 *
 * This module is browser-safe by construction: no node APIs, no
 * server-only helpers (the `web-shell-no-server` rule bans lib/bff*,
 * lib/server-api*, next/headers, server-only here), no direct SQL — the
 * ASYNC repository lives in `lib/shell/store-client.ts`. A null bridge
 * means BROWSER MODE: every offline surface renders ONLINE-ONLY
 * affordances and never queues or simulates.
 */
import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";

// -- the duplicated bridge contract (mirrors apps/desktop/src/bridge/contract.ts) --

export interface DesktopCapabilities {
  /** OS keychain credential storage (Windows Credential Manager). */
  readonly keychain: boolean;
  /** Local SQLite (SQLCipher profile) via the sql plugin. */
  readonly sqlite: boolean;
  /** Shell-side HTTP with device credentials (sync transport). */
  readonly http: boolean;
  /** Signed auto-update channel (checkNow/install). */
  readonly updater: boolean;
  /** Raw ESC-POS + HTML printing. */
  readonly print: boolean;
  /** WebView2 runtime probe (system.webview2Version). */
  readonly webview2Probe: boolean;
  /** The shell-side sync driver (DR-P21-09): syncNow/pushNow. Absent in
   * older shells (capability-gated UI). */
  readonly sync?: boolean;
}

export interface DesktopBridge {
  /** The shell's bridge contract version (semver string). */
  readonly version: string;
  readonly capabilities: DesktopCapabilities;
  readonly keychain: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
  };
  readonly sql: {
    execute(sql: string, params?: unknown[]): Promise<void>;
    query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  };
  readonly http: {
    request(input: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: string;
    }): Promise<{ status: number; body: string }>;
  };
  readonly updater: {
    checkNow(): Promise<unknown>;
    install(): Promise<void>;
  };
  readonly system: {
    webview2Version(): Promise<string | null>;
    osInfo(): Promise<Record<string, string>>;
  };
  readonly print: {
    printRaw(bytes: number[] | Uint8Array): Promise<void>;
    printHtml(html: string): Promise<void>;
  };
  readonly connectivity: {
    onChange(callback: (online: boolean) => void): () => void;
    isOnline(): boolean;
  };
  /** DR-P21-09 — the shell-side sync driver (OPTIONAL member: older
   * shells predate it; the UI gates manual-sync affordances on
   * capabilities.sync). */
  readonly sync?: {
    /** Manual full cycle (pull+push; one-in-flight — mirrors skipped). */
    syncNow(): Promise<unknown>;
    /** Post-write fast push (push-only). */
    pushNow(): Promise<unknown>;
  };
}

/** The capability set every BROWSER context reports (no shell = no local
 * capabilities — the same UI renders ONLINE-ONLY affordances). */
export const BROWSER_CAPABILITIES: DesktopCapabilities = {
  keychain: false,
  sqlite: false,
  http: false,
  updater: false,
  print: false,
  webview2Probe: false,
} as const;

// -- structural validation (fail closed to browser mode) --------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFunctions(value: unknown, names: readonly string[]): boolean {
  return isPlainObject(value) && names.every((name) => typeof value[name] === "function");
}

/** Structural validation of an injected `__erpDesktop` — anything else
 * fails closed to browser mode (a half-injected bridge is never trusted). */
export function isDesktopBridge(value: unknown): value is DesktopBridge {
  if (!isPlainObject(value)) return false;
  if (typeof value.version !== "string" || value.version.length === 0) return false;
  const capabilities = value.capabilities;
  if (!isPlainObject(capabilities)) return false;
  const capabilityKeys: readonly (keyof DesktopCapabilities)[] = [
    "keychain",
    "sqlite",
    "http",
    "updater",
    "print",
    "webview2Probe",
  ];
  if (!capabilityKeys.every((key) => typeof capabilities[key] === "boolean")) return false;
  if (capabilities.sync !== undefined && typeof capabilities.sync !== "boolean") return false;
  if (value.sync !== undefined && !hasFunctions(value.sync, ["syncNow", "pushNow"])) return false;
  return (
    hasFunctions(value.keychain, ["get", "set", "delete"]) &&
    hasFunctions(value.sql, ["execute", "query"]) &&
    hasFunctions(value.http, ["request"]) &&
    hasFunctions(value.updater, ["checkNow", "install"]) &&
    hasFunctions(value.system, ["webview2Version", "osInfo"]) &&
    hasFunctions(value.print, ["printRaw", "printHtml"]) &&
    hasFunctions(value.connectivity, ["onChange", "isOnline"])
  );
}

/** Detect the desktop shell bridge: the validated `__erpDesktop` when the
 * shell injected a structurally complete bridge, null otherwise (browser
 * mode — the caller renders ONLINE-ONLY affordances). */
export function detectBridge(): DesktopBridge | null {
  const candidate: unknown = (globalThis as { __erpDesktop?: unknown }).__erpDesktop;
  return isDesktopBridge(candidate) ? candidate : null;
}

/** Typed refusal when a bridge is PRESENT but a required capability is
 * missing — fail loud, never a silent no-op (the shell subset never
 * degrades to pretending). */
export class BridgeCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeCapabilityError";
  }
}

/**
 * The store-client entry check: the validated bridge, or null in browser
 * mode (the caller renders ONLINE-ONLY states and never queues). THROWS
 * `BridgeCapabilityError` when a bridge is present with
 * `capabilities.sqlite === false` — a shell without a local store cannot
 * serve the offline console, and pretending otherwise would be a silent
 * capability lie.
 */
export function bridgeOrNullOrThrow(usage: string): DesktopBridge | null {
  const bridge = detectBridge();
  if (bridge === null) return null;
  if (bridge.capabilities.sqlite !== true) {
    throw new BridgeCapabilityError(
      `bridge present but the SQLite capability is off — cannot ${usage} (fail-closed, never a silent no-op)`,
    );
  }
  return bridge;
}

// -- the React shell context ------------------------------------------------------

export interface ShellState {
  /** The validated bridge, or null in browser mode. */
  readonly bridge: DesktopBridge | null;
  /** The bridge's capabilities, or BROWSER_CAPABILITIES (all false). */
  readonly capabilities: DesktopCapabilities;
  /** Live connectivity: bridge.connectivity (isOnline + onChange) in the
   * shell; navigator.onLine + online/offline events in the browser. */
  readonly online: boolean;
  readonly mode: "desktop" | "browser";
}

const ShellContext = createContext<ShellState>({
  bridge: null,
  capabilities: BROWSER_CAPABILITIES,
  online: true,
  mode: "browser",
});

/**
 * Mount once per offline surface (the offline console + the unlock
 * screen each wrap their tree): resolves the bridge once, then keeps the
 * online flag live. In the shell the bridge pushes `erp:connectivity`
 * events (mirrored through connectivity.onChange); in a browser the
 * standard `online`/`offline` window events drive the same flag — the
 * console only uses it for LABELS, never to simulate offline behavior.
 */
export function ShellBridgeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [bridge] = useState<DesktopBridge | null>(() => detectBridge());
  const [online, setOnline] = useState<boolean>(() => initialOnline(bridge));

  useEffect(() => {
    if (bridge !== null) {
      return bridge.connectivity.onChange((value) => setOnline(value));
    }
    if (typeof window === "undefined") return;
    const goesOnline = (): void => setOnline(true);
    const goesOffline = (): void => setOnline(false);
    window.addEventListener("online", goesOnline);
    window.addEventListener("offline", goesOffline);
    return () => {
      window.removeEventListener("online", goesOnline);
      window.removeEventListener("offline", goesOffline);
    };
  }, [bridge]);

  const value = useMemo<ShellState>(
    () => ({
      bridge,
      capabilities: bridge?.capabilities ?? BROWSER_CAPABILITIES,
      online,
      mode: bridge === null ? "browser" : "desktop",
    }),
    [bridge, online],
  );

  // createElement (not JSX) keeps this a plain .ts module — the console
  // imports it from both server-agnostic client code and the specs.
  return createElement(ShellContext.Provider, { value }, children);
}

function initialOnline(bridge: DesktopBridge | null): boolean {
  if (bridge !== null) return bridge.connectivity.isOnline();
  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    return navigator.onLine;
  }
  return true;
}

/** The shell state for offline surfaces (bridge + capabilities + online). */
export function useShell(): ShellState {
  return useContext(ShellContext);
}
