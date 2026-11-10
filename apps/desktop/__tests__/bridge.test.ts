import { afterEach, describe, expect, it } from "vitest";

import {
  BROWSER_CAPABILITIES,
  detectBridge,
  isDesktopBridge,
  type DesktopBridge,
} from "../src/bridge/contract";

/**
 * PHASE-021 · the DesktopBridge contract — the ONLY web↔shell seam (MASTER-
 * PLAN §1 item 10; W2-b consumes detectBridge + the types verbatim): a
 * structurally complete injected `__erpDesktop` is returned; anything
 * partial/absent/malformed fails CLOSED to browser mode (null bridge).
 */

function completeBridge(): DesktopBridge {
  return {
    version: "1.0.0",
    capabilities: {
      keychain: true,
      sqlite: true,
      http: true,
      updater: true,
      print: true,
      webview2Probe: true,
    },
    keychain: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
    },
    sql: {
      execute: async () => undefined,
      query: async () => [],
    },
    http: {
      request: async () => ({ status: 200, body: "" }),
    },
    updater: {
      checkNow: async () => ({}),
      install: async () => undefined,
    },
    system: {
      webview2Version: async () => "120.0.2210.61",
      osInfo: async () => ({ os: "windows" }),
    },
    print: {
      printRaw: async () => undefined,
      printHtml: async () => undefined,
    },
    connectivity: {
      onChange: () => () => undefined,
      isOnline: () => true,
    },
  };
}

function withInjected(bridge: unknown, run: () => void): void {
  (globalThis as { __erpDesktop?: unknown }).__erpDesktop = bridge;
  try {
    run();
  } finally {
    delete (globalThis as { __erpDesktop?: unknown }).__erpDesktop;
  }
}

afterEach(() => {
  delete (globalThis as { __erpDesktop?: unknown }).__erpDesktop;
});

describe("detectBridge (fail-closed structural validation)", () => {
  it("returns the bridge when the shell injected a complete __erpDesktop", () => {
    withInjected(completeBridge(), () => {
      const bridge = detectBridge();
      expect(bridge).not.toBeNull();
      expect(bridge?.version).toBe("1.0.0");
      expect(bridge?.capabilities.sqlite).toBe(true);
      expect(typeof bridge?.sql.execute).toBe("function");
      expect(typeof bridge?.connectivity.onChange).toBe("function");
    });
  });

  it("returns null in browser mode (nothing injected)", () => {
    expect(detectBridge()).toBeNull();
  });

  const broken: readonly [string, () => unknown][] = [
    ["not an object", () => "nope"],
    ["null", () => null],
    ["missing version", () => ({ ...completeBridge(), version: undefined })],
    ["empty version", () => ({ ...completeBridge(), version: "" })],
    ["non-string version", () => ({ ...completeBridge(), version: 1 })],
    ["missing capabilities", () => ({ ...completeBridge(), capabilities: undefined })],
    ["capabilities missing one boolean", () => ({ ...completeBridge(), capabilities: { keychain: true, sqlite: true, http: true, updater: true, print: true } })],
    ["capabilities with non-boolean", () => ({ ...completeBridge(), capabilities: { keychain: "yes", sqlite: true, http: true, updater: true, print: true, webview2Probe: true } })],
    ["keychain without delete", () => ({ ...completeBridge(), keychain: { get: async () => null, set: async () => undefined } })],
    ["sql without query", () => ({ ...completeBridge(), sql: { execute: async () => undefined } })],
    ["http without request", () => ({ ...completeBridge(), http: {} })],
    ["updater without install", () => ({ ...completeBridge(), updater: { checkNow: async () => ({}) } })],
    ["system without osInfo", () => ({ ...completeBridge(), system: { webview2Version: async () => null } })],
    ["print without printRaw", () => ({ ...completeBridge(), print: { printHtml: async () => undefined } })],
    ["connectivity without isOnline", () => ({ ...completeBridge(), connectivity: { onChange: () => () => undefined } })],
  ];

  for (const [name, factory] of broken) {
    it(`a bridge broken by ${name} fails CLOSED to browser mode`, () => {
      withInjected(factory(), () => {
        expect(detectBridge()).toBeNull();
        expect(isDesktopBridge(factory())).toBe(false);
      });
    });
  }

  it("BROWSER_CAPABILITIES reports every capability false (browser mode)", () => {
    expect(BROWSER_CAPABILITIES).toEqual({
      keychain: false,
      sqlite: false,
      http: false,
      updater: false,
      print: false,
      webview2Probe: false,
    });
  });

  it("isDesktopBridge accepts a complete bridge", () => {
    expect(isDesktopBridge(completeBridge())).toBe(true);
  });
});
