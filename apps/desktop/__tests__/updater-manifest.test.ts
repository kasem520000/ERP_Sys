import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  publicKeyFileFromCore,
  publishCli,
  readPrivateKeyCore,
  runSelfTest,
  signManifestCli,
} from "../../../scripts/updater-manifest";
import { generateMinisignKeyPair } from "../src/updater/minisign";
import { parseManifest, verifyManifestSignature, type UpdaterManifest } from "../src/updater/manifest";

/**
 * PHASE-021 T8/T12 — the updater manifest service CLI round-trip
 * (scripts/updater-manifest.ts). REAL crypto everywhere: keypairs are
 * generated Ed25519 (never mocked), manifests and bundles are really signed,
 * verification really runs, tampering really fails (D-06 posture). The
 * checked-in fixtures (deploy/updater/fixtures) must parse; their throwaway
 * authoring key is documented as never-trusted (deploy/updater/README.md).
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "../../../deploy/updater/fixtures/stable");
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "updater-manifest-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureManifest(version = "2.0.0"): UpdaterManifest {
  return {
    version,
    pub_date: "2026-11-04T12:00:00Z",
    platforms: {
      "windows-x86_64": {
        signature: "pending — replaced by the sign step",
        url: `https://updates.erp.example/stable/${version}/ERP-Desktop_${version}_x64-setup.exe`,
      },
    },
    rollout: { stagePercent: 10, cohortSeed: "staging" },
    notes: "round-trip fixture",
  };
}

describe("updater-manifest --self-test (REAL crypto, no mocks)", () => {
  it("runs green end-to-end (keypair → manifest sign → verify → bundle sign → tamper-reject → fixtures → cohort)", () => {
    const result = runSelfTest();
    expect(result.manifestMode.verified).toBe(true);
    expect(result.manifestMode.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(result.bundleMode.verified).toBe(true);
    expect(result.fixturesParsed).toEqual(["latest.json", "1.0.0/manifest.json"]);
    // 1000 devices at 10% cohort lands in the honest 5–15% band.
    expect(result.cohortSampled).toBeGreaterThanOrEqual(50);
    expect(result.cohortSampled).toBeLessThanOrEqual(150);
  });
});

describe("sign CLI — manifest mode + bundle mode round-trips", () => {
  it("signs the canonical manifest JSON and round-trip verifies (file-based, real key)", () => {
    const dir = makeTempDir();
    const pair = generateMinisignKeyPair();
    const keyPath = join(dir, "privkey.key");
    const manifestPath = join(dir, "manifest.json");
    writeFileSync(keyPath, pair.privateKeyFile);
    writeFileSync(manifestPath, `${JSON.stringify(fixtureManifest(), null, 2)}\n`);

    const signed = signManifestCli({ manifestPath, keyPath });

    // The written file carries the signature; verification is green against
    // the PUBLIC key rebuilt from the private core.
    const written = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    expect(written.ok).toBe(true);
    const verification = verifyManifestSignature(
      written.ok ? written.manifest : signed,
      [publicKeyFileFromCore(readPrivateKeyCore(keyPath))],
    );
    expect(verification.verified).toBe(true);
    expect(verification.mode).toBe("manifest");
  });

  it("signs the BUNDLE bytes (Tauri shape) and the round-trip verifies against the same bytes", () => {
    const dir = makeTempDir();
    const pair = generateMinisignKeyPair();
    const keyPath = join(dir, "privkey.key");
    const bundlePath = join(dir, "app.exe");
    const manifestPath = join(dir, "manifest.json");
    writeFileSync(keyPath, pair.privateKeyFile);
    writeFileSync(bundlePath, Buffer.from("fake nsis bundle bytes for the round-trip"));
    writeFileSync(manifestPath, `${JSON.stringify(fixtureManifest("2.1.0"), null, 2)}\n`);

    const signed = signManifestCli({ manifestPath, keyPath, contentPath: bundlePath });
    const verification = verifyManifestSignature(signed, [pair.publicKeyFile]);
    expect(verification.verified).toBe(true);
    expect(verification.mode).toBe("bundle");
  });

  it("rejects a key file with no minisign core (honest error)", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "manifest.json");
    const junkKey = join(dir, "junk.key");
    writeFileSync(junkKey, "this is not a key\n");
    writeFileSync(manifestPath, `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
    expect(() => signManifestCli({ manifestPath, keyPath: junkKey })).toThrow(/no minisign secret-key core/);
  });
});

describe("publish CLI — the hosting layout (deploy/updater/README.md)", () => {
  it("writes the immutable versioned dir + the mutable latest.json and copies artifacts", () => {
    const dir = makeTempDir();
    const pair = generateMinisignKeyPair();
    const artifacts = join(dir, "artifacts");
    const manifestPath = join(artifacts, "manifest.json");
    writeFileSync(join(dir, "privkey.key"), pair.privateKeyFile);
    writeFileSync(join(dir, "pubkey.pub"), pair.publicKeyFile);
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(fixtureManifest("3.0.0"), null, 2)}\n`);
    // Sign the manifest first (publish verifies when --pubkey is given).
    signManifestCli({ manifestPath, keyPath: join(dir, "privkey.key") });
    writeFileSync(join(artifacts, "app.exe"), "bundle bytes");
    writeFileSync(join(artifacts, "app.exe.sig"), pair.sign("bundle bytes"));

    const outDir = join(dir, "out");
    const versionDir = publishCli({
      channel: "stable",
      version: "3.0.0",
      artifactsDir: artifacts,
      pubkeyPath: join(dir, "pubkey.pub"),
      outDir,
    });

    expect(versionDir).toBe(join(outDir, "stable", "3.0.0"));
    const published = parseManifest(JSON.parse(readFileSync(join(versionDir, "manifest.json"), "utf8")));
    expect(published.ok && published.manifest.version).toBe("3.0.0");
    const latest = parseManifest(JSON.parse(readFileSync(join(outDir, "stable", "latest.json"), "utf8")));
    expect(latest.ok && latest.manifest.version).toBe("3.0.0");
    // Artifacts (except the source manifest.json) are copied into the versioned dir.
    expect(readFileSync(join(versionDir, "app.exe"), "utf8")).toBe("bundle bytes");
    expect(readFileSync(join(versionDir, "app.exe.sig"), "utf8")).toContain("untrusted comment:");
  });

  it("refuses a manifest whose version does not match --version (immutable dir integrity)", () => {
    const dir = makeTempDir();
    const artifacts = join(dir, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, "manifest.json"), `${JSON.stringify(fixtureManifest("4.0.0"), null, 2)}\n`);
    expect(() =>
      publishCli({ channel: "stable", version: "4.0.1", artifactsDir: artifacts, outDir: join(dir, "out") }),
    ).toThrow(/manifest version 4\.0\.0 ≠ --version 4\.0\.1/);
  });
});

describe("checked-in fixtures (deploy/updater/fixtures/stable)", () => {
  it("parse and pin the staging shape (1.0.0, windows-x86_64, 10% cohort, bilingual notes)", () => {
    for (const file of ["latest.json", "1.0.0/manifest.json"]) {
      const parsed = parseManifest(JSON.parse(readFileSync(join(fixturesRoot, file), "utf8")));
      expect(parsed.ok, `${file}: ${parsed.ok ? "" : parsed.error}`).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.manifest.version).toBe("1.0.0");
      expect(parsed.manifest.platforms["windows-x86_64"].url).toMatch(/^https:\/\/updates\.erp\.example\/stable\/1\.0\.0\//);
      expect(parsed.manifest.rollout?.stagePercent).toBe(10);
      expect(parsed.manifest.rollout?.cohortSeed).toBe("staging");
      expect(parsed.manifest.notes).toMatch(/[\u0600-\u06FF]/); // Arabic half
      expect(parsed.manifest.notes).toMatch(/staged rollout/i); // English half
      // The throwaway authoring key is NOT trusted: no client key set
      // verifies these fixtures (their signature is shape-only).
      expect(parsed.manifest.platforms["windows-x86_64"].signature).toMatch(/^untrusted comment:/);
    }
  });
});
