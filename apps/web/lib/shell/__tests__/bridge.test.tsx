/**
 * PHASE-021 T2-b — the shell bridge client suite: fail-closed detection,
 * BROWSER_CAPABILITIES, bridgeOrNullOrThrow, and the React context
 * (online state via connectivity.onChange in the shell, window events in
 * a browser). AR/EN independence is irrelevant here (no strings beyond
 * error text) — the bilingual behavior is covered by the component suite.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  BROWSER_CAPABILITIES,
  BridgeCapabilityError,
  ShellBridgeProvider,
  bridgeOrNullOrThrow,
  detectBridge,
  isDesktopBridge,
  useShell,
} from "../bridge";
import { createBridgeDouble, installBridge, type BridgeDouble } from "./bridge-double";

afterEach(() => {
  cleanup();
  delete (globalThis as { __erpDesktop?: unknown }).__erpDesktop;
});

describe("isDesktopBridge / detectBridge (fail closed)", () => {
  it("returns null with no bridge injected (browser mode)", () => {
    expect(detectBridge()).toBeNull();
  });

  it("validates a structurally complete bridge (incl. the optional sync member)", () => {
    const double = createBridgeDouble({ withSync: true });
    expect(isDesktopBridge(double.bridge)).toBe(true);
    expect(detectBridge()).toBeNull(); // not injected yet
  });

  it("accepts an older shell without the sync member", () => {
    const double = createBridgeDouble({ withSync: false });
    expect(isDesktopBridge(double.bridge)).toBe(true);
    expect(double.bridge.sync).toBeUndefined();
  });

  it("fails closed on a half-injected bridge (print member missing)", () => {
    const double = createBridgeDouble();
    const broken = { ...double.bridge, print: undefined } as unknown;
    expect(isDesktopBridge(broken)).toBe(false);
  });

  it("fails closed when capabilities.sync is present but non-boolean", () => {
    const double = createBridgeDouble();
    const broken = {
      ...double.bridge,
      capabilities: { ...double.bridge.capabilities, sync: "yes" },
    } as unknown;
    expect(isDesktopBridge(broken)).toBe(false);
  });
});

describe("BROWSER_CAPABILITIES", () => {
  it("reports every local capability as false", () => {
    expect(BROWSER_CAPABILITIES).toEqual({
      keychain: false,
      sqlite: false,
      http: false,
      updater: false,
      print: false,
      webview2Probe: false,
    });
  });
});

describe("bridgeOrNullOrThrow", () => {
  it("returns null in browser mode", () => {
    expect(bridgeOrNullOrThrow("read the local store")).toBeNull();
  });

  it("returns the bridge when the SQLite capability is on", () => {
    const double = createBridgeDouble();
    const restore = installBridge(double);
    try {
      expect(bridgeOrNullOrThrow("read the local store")).toBe(double.bridge);
    } finally {
      restore();
    }
  });

  it("throws BridgeCapabilityError when the bridge lacks the SQLite store", () => {
    const double = createBridgeDouble({ capabilities: { sqlite: false } });
    const restore = installBridge(double);
    try {
      expect(() => bridgeOrNullOrThrow("read the local store")).toThrow(BridgeCapabilityError);
    } finally {
      restore();
    }
  });
});

describe("ShellBridgeProvider + useShell", () => {
  it("exposes the desktop mode and tracks connectivity.onChange", async () => {
    const double = createBridgeDouble({ online: true });
    const restore = installBridge(double);
    try {
      const holder: { probe: { online: string; mode: string } | null } = { probe: null };
      render(
        <ShellBridgeProvider>
          <TestProbe onReady={(value) => (holder.probe = value)} />
        </ShellBridgeProvider>,
      );
      expect(holder.probe?.mode).toBe("desktop");
      expect(holder.probe?.online).toBe("true");
      await act(async () => {
        double.setOnline(false);
      });
      expect(holder.probe?.online).toBe("false");
    } finally {
      restore();
    }
  });

  it("exposes the browser mode and listens to window online/offline events", async () => {
    const holder: { probe: { online: string; mode: string } | null } = { probe: null };
    render(
      <ShellBridgeProvider>
        <TestProbe onReady={(value) => (holder.probe = value)} />
      </ShellBridgeProvider>,
    );
    expect(holder.probe?.mode).toBe("browser");
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(holder.probe?.online).toBe("false");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(holder.probe?.online).toBe("true");
  });

  it("renders its children", () => {
    render(
      <ShellBridgeProvider>
        <p>child-content</p>
      </ShellBridgeProvider>,
    );
    expect(screen.getByText("child-content")).toBeTruthy();
  });

  /** A tiny subscriber that mirrors useShell into a mutable probe. */
  function TestProbe({ onReady }: { onReady: (value: { online: string; mode: string }) => void }): null {
    const shell = useShell();
    onReady({ online: String(shell.online), mode: shell.mode });
    return null;
  }

  it("keeps the double's full capability set intact (parity with the shell)", () => {
    const double: BridgeDouble = createBridgeDouble();
    expect(double.bridge.capabilities.sync).toBe(true);
    expect(double.bridge.capabilities.sqlite).toBe(true);
  });
});
