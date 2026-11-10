import { describe, expect, it } from "vitest";

import { generateMinisignKeyPair } from "../src/updater/minisign";
import {
  canonicalManifestJson,
  compareSemver,
  evaluateVersionGate,
  isCohortSelected,
  parseManifest,
  signManifest,
  verifyManifestSignature,
  type UpdaterManifest,
} from "../src/updater/manifest";
import { downloadAndInstallUpdate, runUpdateCheck, type UpdaterPorts } from "../src/updater/client";
import { applyStageDecision, crashFreeRate, evaluateStageTransition, haltRemedy } from "../src/updater/rollout";
import { CRASH_FREE_GATES } from "../src/index";

/**
 * PHASE-021 T8 · the updater manifest (Tauri v2 shape), deterministic
 * staged-rollout cohort, version/min-version gates, the dual-trust key
 * window, the check→verify→gate→download→verify→apply client state machine
 * (ports faked, crypto REAL), and the crash-free-gated rollout service.
 */

function baseManifest(overrides: Partial<UpdaterManifest> = {}): UpdaterManifest {
  return {
    version: "2.0.0",
    pub_date: "2026-11-05T10:00:00Z",
    platforms: {
      "windows-x86_64": {
        signature: "placeholder-replaced-by-tests",
        url: "https://updates.erp.example/stable/2.0.0/erp-setup-2.0.0.exe",
      },
    },
    ...overrides,
  };
}

describe("parseManifest (structural validation)", () => {
  it("parses a complete manifest with every optional field", () => {
    const result = parseManifest({
      version: "2.0.0",
      pub_date: "2026-11-05T10:00:00Z",
      platforms: { "windows-x86_64": { signature: "sig", url: "https://host/bundle.exe" } },
      minVersion: "1.5.0",
      rollout: { stagePercent: 50, cohortSeed: "2.0.0:50" },
      notes: "bug fixes",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.version).toBe("2.0.0");
      expect(result.manifest.minVersion).toBe("1.5.0");
      expect(result.manifest.rollout).toEqual({ stagePercent: 50, cohortSeed: "2.0.0:50" });
      expect(result.manifest.notes).toBe("bug fixes");
    }
  });

  it("tolerates unknown ADDITIVE fields (forward compatibility)", () => {
    const result = parseManifest({
      ...baseManifest(),
      futureField: { anything: true },
    });
    expect(result.ok).toBe(true);
  });

  const invalid: readonly [string, unknown][] = [
    ["null", null],
    ["array", [baseManifest()]],
    ["string", "2.0.0"],
    ["missing version", { ...baseManifest(), version: undefined }],
    ["empty version", { ...baseManifest(), version: "  " }],
    ["non-string version", { ...baseManifest(), version: 2 }],
    ["missing pub_date", { ...baseManifest(), pub_date: undefined }],
    ["unparseable pub_date", { ...baseManifest(), pub_date: "not a date at all" }],
    ["missing platforms", { ...baseManifest(), platforms: undefined }],
    ["platforms not object", { ...baseManifest(), platforms: [] }],
    ["missing windows-x86_64", { ...baseManifest(), platforms: { "darwin-aarch64": {} } }],
    ["missing signature", { ...baseManifest(), platforms: { "windows-x86_64": { url: "https://h/b" } } }],
    ["empty signature", { ...baseManifest(), platforms: { "windows-x86_64": { signature: "", url: "https://h/b" } } }],
    ["missing url", { ...baseManifest(), platforms: { "windows-x86_64": { signature: "s" } } }],
    ["empty minVersion", { ...baseManifest(), minVersion: "" }],
    ["rollout not object", { ...baseManifest(), rollout: "50" }],
    ["stagePercent non-integer", { ...baseManifest(), rollout: { stagePercent: 10.5 } }],
    ["stagePercent negative", { ...baseManifest(), rollout: { stagePercent: -1 } }],
    ["stagePercent above 100", { ...baseManifest(), rollout: { stagePercent: 101 } }],
    ["stagePercent non-number", { ...baseManifest(), rollout: { stagePercent: "50" } }],
    ["empty cohortSeed", { ...baseManifest(), rollout: { stagePercent: 50, cohortSeed: "" } }],
    ["non-string notes", { ...baseManifest(), notes: 42 }],
  ];

  for (const [name, json] of invalid) {
    it(`rejects ${name} with a field-named error`, () => {
      const result = parseManifest(json);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    });
  }
});

describe("isCohortSelected (deterministic staged rollout)", () => {
  it("is deterministic: identical inputs always produce the identical answer", () => {
    for (let index = 0; index < 200; index += 1) {
      const deviceId = `device-${index}`;
      expect(isCohortSelected(deviceId, "stable", "2.0.0", 10)).toBe(isCohortSelected(deviceId, "stable", "2.0.0", 10));
    }
  });

  it("0% selects nobody; 100% selects everybody", () => {
    expect(isCohortSelected("device-1", "stable", "2.0.0", 0)).toBe(false);
    for (let index = 0; index < 50; index += 1) {
      expect(isCohortSelected(`device-${index}`, "stable", "2.0.0", 100)).toBe(true);
    }
  });

  it("fails CLOSED on nonsense percentages (never an accidental full rollout)", () => {
    expect(isCohortSelected("device-1", "stable", "2.0.0", Number.NaN)).toBe(false);
    expect(isCohortSelected("device-1", "stable", "2.0.0", -5)).toBe(false);
    expect(isCohortSelected("device-1", "stable", "2.0.0", 10.5)).toBe(false);
  });

  it("distributes evenly: 10 000 devices at 10% land within 8%–12%", () => {
    let selected = 0;
    const total = 10_000;
    for (let index = 0; index < total; index += 1) {
      if (isCohortSelected(`device-${String(index).padStart(5, "0")}`, "stable", "2.0.0", 10)) selected += 1;
    }
    const percent = (selected * 100) / total;
    expect(percent).toBeGreaterThanOrEqual(8);
    expect(percent).toBeLessThanOrEqual(12);
  });

  it("the cohort reshuffles per version/channel (some device flips selection)", () => {
    let flips = 0;
    for (let index = 0; index < 500; index += 1) {
      const deviceId = `device-${index}`;
      if (
        isCohortSelected(deviceId, "stable", "2.0.0", 50) !== isCohortSelected(deviceId, "stable", "2.0.1", 50)
      ) {
        flips += 1;
      }
    }
    expect(flips).toBeGreaterThan(0);
  });
});

describe("compareSemver (semver + CalVer tolerance)", () => {
  it("compares semver numerically", () => {
    expect(compareSemver("1.2.3", "1.2.4")).toBe(-1);
    expect(compareSemver("1.2.4", "1.2.3")).toBe(1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1); // numeric, not lexicographic
  });

  it("treats missing segments as zero (109.0 == 109.0.0.0)", () => {
    expect(compareSemver("109.0", "109.0.0.0")).toBe(0);
    expect(compareSemver("109.0.1518", "109.0.1518.78")).toBe(-1);
  });

  it("tolerates CalVer: leading zeros compare numerically", () => {
    expect(compareSemver("2026.11.04", "2026.11.4")).toBe(0);
    expect(compareSemver("2026.11.04", "2026.12.01")).toBe(-1);
    expect(compareSemver("2026.2.1", "2026.10.1")).toBe(-1); // 2 < 10 numerically
  });

  it("orders prerelease tags before their release (numeric before non-numeric)", () => {
    expect(compareSemver("1.2.3-beta", "1.2.3")).toBe(-1);
    expect(compareSemver("1.2.3", "1.2.3-beta")).toBe(1);
  });
});

describe("evaluateVersionGate (downgrade + min-version policy)", () => {
  it("rejects downgrades (D-06: never install an older build)", () => {
    const result = evaluateVersionGate({ currentVersion: "2.0.0", offeredVersion: "1.9.0" });
    expect(result.decision).toBe("rejected");
    expect(result.reason).toContain("downgrade");
  });

  it("reports up-to-date when the offered version matches (even with a minVersion set)", () => {
    const result = evaluateVersionGate({ currentVersion: "2.0.0", offeredVersion: "2.0.0", minVersion: "2.5.0" });
    expect(result.decision).toBe("up-to-date");
  });

  it("force-updates when the current version is below the manifest minimum", () => {
    const result = evaluateVersionGate({ currentVersion: "1.0.0", offeredVersion: "2.0.0", minVersion: "2.0.0" });
    expect(result.decision).toBe("force-update");
    expect(result.reason).toContain("below manifest minimum");
  });

  it("offers a normal update when above the minimum", () => {
    const result = evaluateVersionGate({ currentVersion: "2.0.0", offeredVersion: "2.1.0", minVersion: "1.5.0" });
    expect(result.decision).toBe("update-available");
  });

  it("downgrade beats everything — even a below-minimum current version", () => {
    const result = evaluateVersionGate({ currentVersion: "1.0.0", offeredVersion: "0.9.0", minVersion: "2.0.0" });
    expect(result.decision).toBe("rejected");
  });
});

describe("manifest signatures (dual-trust key window, S-15 rotation)", () => {
  const oldKey = generateMinisignKeyPair();
  const newKey = generateMinisignKeyPair();
  const unknownKey = generateMinisignKeyPair();
  const trusted = [oldKey.publicKeyFile, newKey.publicKeyFile];

  it("signManifest → verifyManifestSignature with the same key (mode manifest)", () => {
    const signed = signManifest(baseManifest(), oldKey.privateKey);
    const result = verifyManifestSignature(signed, trusted);
    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.mode).toBe("manifest");
      expect(result.keyId).toBe(oldKey.keyId);
    }
  });

  it("rotation window: a manifest signed by the NEW key verifies with [old, new] trusted", () => {
    const signed = signManifest(baseManifest(), newKey.privateKey);
    const result = verifyManifestSignature(signed, trusted);
    expect(result.verified).toBe(true);
  });

  it("rotation window: a manifest signed by the OLD key still verifies (dual-trust)", () => {
    const signed = signManifest(baseManifest(), oldKey.privateKey);
    expect(verifyManifestSignature(signed, [newKey.publicKeyFile, oldKey.publicKeyFile]).verified).toBe(true);
  });

  it("a key OUTSIDE the trust window is rejected", () => {
    const signed = signManifest(baseManifest(), unknownKey.privateKey);
    const result = verifyManifestSignature(signed, trusted);
    expect(result.verified).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("Tauri-shaped manifests (signature-of-the-BUNDLE) verify in mode bundle, bound to a trusted key", () => {
    const bundle = Buffer.from("fake nsis bundle bytes for the manifest-level check");
    const manifest: UpdaterManifest = {
      ...baseManifest(),
      platforms: {
        "windows-x86_64": {
          signature: newKey.sign(bundle),
          url: "https://updates.erp.example/stable/2.0.0/erp-setup.exe",
        },
      },
    };
    const result = verifyManifestSignature(manifest, trusted);
    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.mode).toBe("bundle");
      expect(result.keyId).toBe(newKey.keyId);
      expect(result.reason).toContain("bundle");
    }
  });

  it("a Tauri-shaped signature from an UNTRUSTED key is rejected at the manifest stage", () => {
    const bundle = Buffer.from("bundle");
    const manifest: UpdaterManifest = {
      ...baseManifest(),
      platforms: { "windows-x86_64": { signature: unknownKey.sign(bundle), url: "https://h/b.exe" } },
    };
    expect(verifyManifestSignature(manifest, trusted).verified).toBe(false);
  });

  it("garbage signature fields are rejected without throwing", () => {
    expect(verifyManifestSignature(baseManifest(), trusted).verified).toBe(false);
  });

  it("canonicalManifestJson blanks the signature and fixes the key order (sign/verify agreement)", () => {
    const manifest = baseManifest({ minVersion: "1.5.0", rollout: { stagePercent: 10 }, notes: "n" });
    expect(canonicalManifestJson(manifest)).toBe(canonicalManifestJson(manifest));
    expect(canonicalManifestJson(manifest)).not.toContain("placeholder-replaced-by-tests");
    expect(canonicalManifestJson(manifest)).toContain('"signature":""');
  });
});

describe("runUpdateCheck (ports faked — the crypto is real)", () => {
  const keyPair = generateMinisignKeyPair();
  const rotatedIn = generateMinisignKeyPair();
  const bundle = Buffer.concat([
    Buffer.from("PHASE-021 real fake bundle: "),
    Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x7f]),
  ]);

  function portsFor(manifests: unknown[], options: { bundle?: Buffer; failInstall?: boolean } = {}): {
    ports: UpdaterPorts;
    downloads: string[];
    installs: { bundle: Buffer; manifest: UpdaterManifest }[];
  } {
    const downloads: string[] = [];
    const installs: { bundle: Buffer; manifest: UpdaterManifest }[] = [];
    return {
      downloads,
      installs,
      ports: {
        fetchManifest: async () => {
          const next = manifests.shift();
          if (next === undefined) throw new Error("no manifest programmed");
          return next;
        },
        fetchBundle: async (url: string) => {
          downloads.push(url);
          return options.bundle ?? bundle;
        },
        install: async (downloaded: Buffer, manifest: UpdaterManifest) => {
          if (options.failInstall === true) throw new Error("shell install command failed");
          installs.push({ bundle: downloaded, manifest });
        },
      },
    };
  }

  function tauriManifest(overrides: {
    signature?: string;
    version?: string;
    minVersion?: string;
    rollout?: UpdaterManifest["rollout"];
    url?: string;
  } = {}): UpdaterManifest {
    return {
      ...baseManifest(),
      version: overrides.version ?? "2.0.0",
      ...(overrides.minVersion !== undefined ? { minVersion: overrides.minVersion } : {}),
      ...(overrides.rollout !== undefined ? { rollout: overrides.rollout } : {}),
      platforms: {
        "windows-x86_64": {
          signature: overrides.signature ?? keyPair.sign(bundle),
          url: overrides.url ?? "https://updates.erp.example/stable/2.0.0/erp-setup.exe",
        },
      },
    };
  }

  it("happy path: real signed manifest + bundle → download → verify → install → relaunch", async () => {
    const manifest = tauriManifest();
    const { ports, downloads, installs } = portsFor([manifest]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-happy",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("relaunch");
    expect(outcome.manifest?.version).toBe("2.0.0");
    expect(downloads).toEqual(["https://updates.erp.example/stable/2.0.0/erp-setup.exe"]);
    expect(installs).toHaveLength(1);
    expect(installs[0]!.bundle.equals(bundle)).toBe(true);
    expect(installs[0]!.manifest.version).toBe("2.0.0");
  });

  it("dual-trust window: a bundle signed by the ROTATED-IN key installs with [old, new] trusted", async () => {
    const manifest = tauriManifest({ signature: rotatedIn.sign(bundle) });
    const { ports, installs } = portsFor([manifest]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-rotation",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile, rotatedIn.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("relaunch");
    expect(installs).toHaveLength(1);
  });

  it("unsigned/garbage manifest signature ⇒ rejected before any download", async () => {
    const manifest = tauriManifest({ signature: "not a minisign signature" });
    const { ports, downloads } = portsFor([manifest]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-unsigned",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("rejected");
    expect(outcome.reason).toContain("manifest signature");
    expect(downloads).toHaveLength(0);
  });

  it("tampered bundle ⇒ rejected at bundle verification (real Ed25519 mismatch)", async () => {
    const manifest = tauriManifest(); // signature over the ORIGINAL bundle
    const tampered = Buffer.concat([bundle, Buffer.from("evil payload")]);
    const { ports } = portsFor([manifest], { bundle: tampered });
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-tamper",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("rejected");
    expect(outcome.reason).toContain("bundle signature verification failed");
  });

  it("downgrade ⇒ rejected (offered older than current)", async () => {
    const manifest = tauriManifest({ version: "0.9.0" });
    const { ports, downloads } = portsFor([manifest]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-downgrade",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("rejected");
    expect(outcome.reason).toContain("downgrade");
    expect(downloads).toHaveLength(0);
  });

  it("same version ⇒ up-to-date (no download)", async () => {
    const manifest = tauriManifest({ version: "1.0.0" });
    const { ports, downloads } = portsFor([manifest]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-current",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("up-to-date");
    expect(downloads).toHaveLength(0);
  });

  it("cohort gate: a device NOT in the 10% cohort ⇒ not-selected, nothing downloaded", async () => {
    // Deterministically find a device outside the 10% cohort for 2.0.0.
    let deviceId = "device-outside";
    for (let index = 0; index < 10_000; index += 1) {
      const candidate = `device-${index}`;
      if (!isCohortSelected(candidate, "stable", "2.0.0", 10)) {
        deviceId = candidate;
        break;
      }
    }
    expect(isCohortSelected(deviceId, "stable", "2.0.0", 10)).toBe(false);
    const manifest = tauriManifest({ rollout: { stagePercent: 10 } });
    const { ports, downloads } = portsFor([manifest]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId,
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("not-selected");
    expect(outcome.reason).toContain("10%");
    expect(downloads).toHaveLength(0);
  });

  it("min-version gate: current below minimum ⇒ blocked-min-version + forceUpdate, no auto-download", async () => {
    const manifest = tauriManifest({ minVersion: "2.0.0" });
    const { ports, downloads, installs } = portsFor([manifest]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-banned",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("blocked-min-version");
    expect(outcome.forceUpdate).toBe(true);
    expect(outcome.reason).toContain("below manifest minimum");
    expect(downloads).toHaveLength(0);
    expect(installs).toHaveLength(0);
    // The blocked screen drives the mandatory install through the SAME
    // verified tail the happy path uses.
    const applied = await downloadAndInstallUpdate(outcome.manifest!, [keyPair.publicKeyFile], ports);
    expect(applied.state).toBe("relaunch");
    expect(installs).toHaveLength(1);
  });

  it("a manifest-signed manifest (mode manifest) still cannot install a bundle — the field must sign the bundle bytes", async () => {
    // Documents the two publication modes: manifest-level signing passes the
    // manifest gate, but the D-06 install boundary requires the signature
    // field to verify over the downloaded bundle.
    const signed = signManifest(tauriManifest(), keyPair.privateKey);
    const { ports } = portsFor([signed]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-modes",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("rejected");
    expect(outcome.reason).toContain("bundle signature verification failed");
  });

  it("non-https bundle URL ⇒ rejected (update channel is https-only)", async () => {
    const manifest = tauriManifest({ url: "http://updates.erp.example/insecure.exe" });
    const { ports, downloads } = portsFor([manifest]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-http",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("rejected");
    expect(outcome.reason).toContain("https required");
    expect(downloads).toHaveLength(0);
  });

  it("an unparseable manifest payload ⇒ rejected (invalid manifest)", async () => {
    const { ports } = portsFor([{ version: 2 }]);
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-garbage",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("rejected");
    expect(outcome.reason).toContain("invalid manifest");
  });

  it("manifest fetch transport failure ⇒ failed (operational, not a security rejection)", async () => {
    const ports: UpdaterPorts = {
      fetchManifest: async () => {
        throw new Error("offline");
      },
      fetchBundle: async () => bundle,
      install: async () => undefined,
    };
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-offline",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("failed");
    expect(outcome.reason).toContain("manifest fetch failed");
  });

  it("install port failure ⇒ failed with the honest shell error", async () => {
    const manifest = tauriManifest();
    const { ports } = portsFor([manifest], { failInstall: true });
    const outcome = await runUpdateCheck({
      currentVersion: "1.0.0",
      deviceId: "device-installfail",
      channel: "stable",
      trustedPublicKeys: [keyPair.publicKeyFile],
      ports,
    });
    expect(outcome.state).toBe("failed");
    expect(outcome.reason).toContain("install failed");
  });
});

describe("rollout gates (CRASH_FREE_GATES from the golden constants)", () => {
  it("the golden gates are wired (0.995/200, 0.997/500, halt 0.985)", () => {
    expect(CRASH_FREE_GATES.promote10to50).toEqual({ rate: 0.995, minSessions: 200 });
    expect(CRASH_FREE_GATES.promote50to100).toEqual({ rate: 0.997, minSessions: 500 });
    expect(CRASH_FREE_GATES.halt).toBe(0.985);
  });

  it("99.6% over 250 sessions at stage 10 ⇒ promote 10 → 50", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 10, metrics: { sessions: 250, crashFreeSessions: 249 } });
    expect(decision.decision).toBe("promote");
    expect(decision.nextStage).toBe(50);
    expect(decision.reason).toContain("promote 10% → 50%");
  });

  it("a rate that meets the gate over a SMALL sample (150 sessions) ⇒ hold (insufficient sessions)", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 10, metrics: { sessions: 150, crashFreeSessions: 150 } });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).toContain("larger sample");
  });

  it("100% over 10 sessions ⇒ hold (insufficient sessions)", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 10, metrics: { sessions: 10, crashFreeSessions: 10 } });
    expect(decision.decision).toBe("hold");
  });

  it("≥ 99.7% over 600 sessions at stage 50 ⇒ promote 50 → 100", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 50, metrics: { sessions: 600, crashFreeSessions: 599 } });
    expect(decision.decision).toBe("promote");
    expect(decision.nextStage).toBe(100);
  });

  it("98% over 300 sessions ⇒ HALT (below 98.5% with a real sample)", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 10, metrics: { sessions: 300, crashFreeSessions: 294 } });
    expect(decision.decision).toBe("halt");
    expect(decision.reason).toContain("halt");
  });

  it("the halt gate stays armed at stage 100 (a fully rolled-out bad build still halts)", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 100, metrics: { sessions: 120, crashFreeSessions: 90 } });
    expect(decision.decision).toBe("halt");
  });

  it("tiny-sample guard: below the halt rate but < 50 sessions ⇒ hold, honestly recorded", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 10, metrics: { sessions: 40, crashFreeSessions: 30 } });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).toContain("tiny-sample guard");
  });

  it("a healthy-but-below-gate rate holds by RATE (not sample)", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 50, metrics: { sessions: 600, crashFreeSessions: 593 } });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).toContain("below the promote gate");
  });

  it("an empty window (0 sessions) holds with the no-sessions reason", () => {
    const decision = evaluateStageTransition({ currentStagePercent: 10, metrics: { sessions: 0, crashFreeSessions: 0 } });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).toContain("no sessions");
  });

  it("haltRemedy produces the force-update minimum-version bump (DR-P21-05)", () => {
    expect(haltRemedy("2.0.1")).toEqual({ action: "force-update", minVersion: "2.0.1" });
  });

  it("crashFreeRate: null on empty windows, clamps out-of-range counters", () => {
    expect(crashFreeRate({ sessions: 0, crashFreeSessions: 0 })).toBeNull();
    expect(crashFreeRate({ sessions: 250, crashFreeSessions: 260 })).toBe(1);
    expect(crashFreeRate({ sessions: 250, crashFreeSessions: -5 })).toBe(0);
    expect(crashFreeRate({ sessions: 250, crashFreeSessions: 249 })).toBeCloseTo(0.996, 12);
  });
});

describe("applyStageDecision (pure manifest-block reducer)", () => {
  it("promote advances to the next canonical stage with a fresh epoch seed", () => {
    const block = applyStageDecision({
      version: "2.0.1",
      current: { stagePercent: 10, cohortSeed: "2.0.1:10" },
      decision: { decision: "promote", nextStage: 50, reason: "gates met" },
    });
    expect(block).toEqual({ stagePercent: 50, cohortSeed: "2.0.1:50" });
  });

  it("hold keeps the current stage and CARRIES the existing seed", () => {
    const block = applyStageDecision({
      version: "2.0.1",
      current: { stagePercent: 50, cohortSeed: "existing-epoch" },
      decision: { decision: "hold", reason: "sample too small" },
    });
    expect(block).toEqual({ stagePercent: 50, cohortSeed: "existing-epoch" });
  });

  it("halt freezes the rollout at the current stage (the remedy is the minVersion bump, not a stage change)", () => {
    const block = applyStageDecision({
      version: "2.0.1",
      current: { stagePercent: 50, cohortSeed: "2.0.1:50" },
      decision: { decision: "halt", reason: "crash gate breached" },
    });
    expect(block.stagePercent).toBe(50);
  });

  it("derives a deterministic seed when none was carried", () => {
    const block = applyStageDecision({
      version: "3.0.0",
      current: { stagePercent: 100 },
      decision: { decision: "hold", reason: "final stage" },
    });
    expect(block).toEqual({ stagePercent: 100, cohortSeed: "3.0.0:100" });
  });
});
