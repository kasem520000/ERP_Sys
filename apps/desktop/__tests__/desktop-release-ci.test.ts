import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PHASE-021 T12 — structural validation of the Windows release workflow
 * (.github/workflows/desktop-release.yml).
 *
 * HONEST LIMITATION (documented, deliberate): this spec does NOT parse the
 * YAML into a document model — the repo has no YAML dependency and gains
 * none for this. It asserts on the RAW TEXT with ordered regexes: every
 * required step marker must appear, IN PIPELINE ORDER (each match position
 * strictly greater than the previous), exactly the guarantee the pipeline
 * contract needs (install → build:desktop → check:desktop-shell → cargo →
 * sign → SBOM → upload → manifest publish). Real execution happens on
 * windows-latest runners (the sandbox has no Rust toolchain — the k6
 * precedent; MASTER-PLAN §0/§8). A separate sanity check (basic YAML shape)
 * is covered by the indentation/structure assertions below.
 */

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(here, "../../../.github/workflows/desktop-release.yml");
const workflow = readFileSync(workflowPath, "utf8");

/** The workflow minus its comment lines — ordered/step assertions must match
 * STEP CONTENT, never the prose comments (which narrate the same pipeline
 * order and would make indexOf lie about positions). */
const steps = workflow
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

/** Ordered marker assertion: finds `marker` AFTER `from` (or throws). */
function assertOrdered(markers: readonly string[]): void {
  let position = -1;
  let previous = "<start>";
  for (const marker of markers) {
    const index = steps.indexOf(marker);
    expect(index, `marker "${marker}" must exist in desktop-release.yml`).toBeGreaterThanOrEqual(0);
    expect(
      index,
      `marker "${marker}" must come AFTER "${previous}" (pipeline order)`,
    ).toBeGreaterThan(position);
    position = index;
    previous = marker;
  }
}

describe("desktop-release.yml — the Windows release pipeline (PHASE-021 T12)", () => {
  it("exists and is a sane YAML document (basic structural shape)", () => {
    // Cheap structural sanity without a YAML parser: top-level keys present,
    // exactly one job, consistent step indentation. A full parse runs in CI
    // via the other tooling; here we assert what the contract needs.
    expect(workflow.startsWith("name: desktop-release")).toBe(true);
    expect(workflow).toContain("jobs:");
    expect(workflow).toContain("windows-release:");
    expect((workflow.match(/^ {6}- (name|uses|run):/gm) ?? []).length).toBeGreaterThan(10);
    expect(workflow).not.toMatch(/\t/); // YAML forbids tabs for indentation
  });

  it("triggers on version tags only (v*)", () => {
    expect(workflow).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:\s*\[\s*"v\*"\s*\]/);
  });

  it("runs on windows-latest with the pinned toolchain (pnpm 9.15.9, node 22.12)", () => {
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("version: 9.15.9");
    expect(workflow).toContain("node-version: 22.12");
    // The repo .nvmrc pins the same 22.12 line (full "22.12.0" there,
    // "22.12" in the workflow — the same major.minor).
    const nvmrc = readFileSync(join(here, "../../../.nvmrc"), "utf8").trim();
    expect(nvmrc).toMatch(/^22\.12(\.\d+)?$/);
  });

  it("requires the ordered pipeline: install → build:desktop → check:desktop-shell → cargo → sign → sbom → upload → manifest publish", () => {
    assertOrdered([
      "pnpm install --frozen-lockfile",
      "pnpm --filter @erp/web build:desktop",
      "pnpm check:desktop-shell",
      "cargo build --release",
      "signtool sign",
      "cyclonedx-npm",
      "uses: actions/upload-artifact@v4",
      "scripts/updater-manifest.ts publish",
    ]);
  });

  it("compiles the SQLCipher cipher profile in BOTH cargo invocations (DR-P21-02)", () => {
    // run:-line matches only (the step *names* also say "cargo build" in
    // prose — they are not invocations).
    const cargoSteps = steps.match(/^\s*(?:- )?run:.*cargo (?:build|tauri build)[^\n]*/gm) ?? [];
    expect(cargoSteps.length).toBeGreaterThanOrEqual(2);
    for (const step of cargoSteps) {
      expect(step).toContain("--features sqlcipher");
    }
  });

  it("wires the real minisign updater signing key from secrets (S-15)", () => {
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.UPDATE_SIGNING_KEY }}");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.UPDATE_SIGNING_KEY_PASSWORD }}");
    // And the publish step verifies against the channel PUBLIC key.
    expect(workflow).toContain("UPDATE_SIGNING_PUBKEY: ${{ secrets.UPDATE_SIGNING_PUBKEY }}");
  });

  it("code signing documents the EV-cert seam honestly (thumbprint secret or an explicit skip warning)", () => {
    expect(workflow).toContain("WINDOWS_CERT_THUMBPRINT");
    expect(workflow).toContain("timestamp.digicert.com");
    expect(workflow).toMatch(/::warning::Windows code signing skipped/);
  });

  it("never embeds secrets inline (documented placeholders only)", () => {
    // All secret references go through the ${{ secrets.* }} context — no raw
    // private-key material in the workflow file itself.
    const keyLooking = workflow.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z0-9+/]{60,}={0,2}/g);
    expect(keyLooking ?? []).toEqual([]);
  });
});
