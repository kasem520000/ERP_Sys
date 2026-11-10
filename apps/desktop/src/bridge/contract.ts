/**
 * PHASE-021 T1/T4-T11 · the DesktopBridge contract — the ONLY web↔shell
 * seam (MASTER-PLAN §1 item 10 / §8): the Tauri shell injects
 * `globalThis.__erpDesktop` implementing this interface; apps/web's
 * browser-safe client (W2-b, lib/shell/bridge.ts) consumes the TYPE and
 * `detectBridge()` — a null bridge means browser mode (ONLINE-ONLY
 * affordances, no local store, window.print fallback). The Rust side
 * implements the same member names (scripts/check-desktop-shell.ts
 * validates parity); desktop code NEVER imports from apps/web (the
 * desktop-no-web boundary rule — the contract types live here, duplicated
 * client-side by the web package, not shared by import).
 *
 * This module is dependency-free and runtime-environment-neutral: no node
 * or DOM APIs — it must import cleanly in the browser bundle AND in Node
 * (the desktop runtime + its specs).
 */

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
  /** The shell-side sync driver (DR-P21-09): the webview asks the runtime
   * to run a cycle — manual sync-now / post-write fast push. Absent in
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
  /** DR-P21-09 — the shell-side sync driver (OPTIONAL member: older shells
   * predate it; the UI gates manual-sync affordances on capabilities.sync).
   * Backed by the desktop runtime's SyncDesktopHost (the E2E harness wires
   * the real host here; the Rust shell drives the runtime — source-only
   * posture, Windows CI compiles it). */
  readonly sync?: {
    /** Manual full cycle (pull+push; one-in-flight — mirrors skipped). */
    syncNow(): Promise<unknown>;
    /** Post-write fast push (push-only). */
    pushNow(): Promise<unknown>;
  };
}

declare global {
  /** Injected by the Tauri shell BEFORE the web bundle boots (browser
   * builds simply never define it — detectBridge returns null). */
  var __erpDesktop: DesktopBridge | undefined;
}

/** The capability set every BROWSER context reports (no shell = no local
 * capabilities — the same UI renders ONLINE-ONLY affordances, W2-b). */
export const BROWSER_CAPABILITIES: DesktopCapabilities = {
  keychain: false,
  sqlite: false,
  http: false,
  updater: false,
  print: false,
  webview2Probe: false,
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFunctions(value: unknown, names: readonly string[]): boolean {
  return isPlainObject(value) && names.every((name) => typeof value[name] === "function");
}

/**
 * Structural validation of an injected `__erpDesktop`: the version string,
 * the six capability booleans, and every method group (keychain get/set/
 * delete, sql execute/query, http request, updater checkNow/install,
 * system webview2Version/osInfo, print printRaw/printHtml, connectivity
 * onChange/isOnline) must be present with the right shape. Anything else
 * fails closed to browser mode — a half-injected bridge is never trusted.
 */
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
  // DR-P21-09: the sync driver member is OPTIONAL (older shells predate it)
  // but when present it must be structurally complete — fail closed. The
  // `value.sync` spelling keeps the parity checker's hasFunctions(value.X)
  // extraction covering it (sync_sync_now / sync_push_now Rust commands).
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

/**
 * Detect the desktop shell bridge: returns the validated `__erpDesktop`
 * when the shell injected a structurally complete bridge, null otherwise
 * (browser mode — the caller renders ONLINE-ONLY affordances).
 */
export function detectBridge(): DesktopBridge | null {
  const candidate: unknown = (globalThis as { __erpDesktop?: unknown }).__erpDesktop;
  return isDesktopBridge(candidate) ? candidate : null;
}
