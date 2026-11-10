/**
 * PHASE-022 T-P22-4-a · the client-side release policy (MASTER-PLAN §1
 * DR-P22-10 + §10): compares the running `appVersion` against the published
 * minimum in the release manifest and decides the force-update gate — the
 * desktop updater manifest pattern (apps/desktop/src/updater/manifest.ts,
 * the DR-P21-05 port) applied to the Android calver `v1.YY.MM.patch`.
 *
 * The manifest shape mirrors the desktop updater manifest (version /
 * pub_date / platforms / rollout / notes) plus the mobile-specific
 * `minVersion` force-update field; `.github/workflows/mobile-release.yml`
 * assembles it in CI (the `minVersion` field) and this module is the
 * client-side consumer. Pure TS, no I/O — the manifest arrives over HTTPS
 * (the updater-hosting runbook); tests simulate it (DR-P22-10: "simulated
 * in tests → force-update screen").
 */

/** The only mobile platform this phase ships (ADR-0014 Android-first). */
export type ReleasePlatform = "android";

/**
 * The published release manifest (the desktop updater-manifest shape,
 * ported): `minVersion` is the force-update input — a client below it is
 * blocked with the update screen (the DR-P21-05 halt remedy rides this
 * field: on a rollout halt, CI publishes `minVersion` = last-known-good).
 */
export interface MobileReleaseManifest {
  readonly version: string;
  readonly pub_date: string;
  readonly minVersion?: string;
  readonly platforms: {
    readonly android: { readonly url: string };
  };
  readonly rollout?: { readonly stagePercent: number; readonly cohortSeed?: string };
  readonly notes?: string;
}

export type ParseManifestResult =
  | { readonly ok: true; readonly manifest: MobileReleaseManifest }
  | { readonly ok: false; readonly error: string };

// -- structural validation (hand-rolled — @erp/mobile has no zod) ----------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Structural validation of a release manifest. Unknown ADDITIVE fields are
 * tolerated (forward compatibility — the desktop parseManifest does the
 * same); every known field is checked and failures carry the field name.
 */
export function parseReleaseManifest(json: unknown): ParseManifestResult {
  if (!isPlainObject(json)) return { ok: false, error: "manifest: not a JSON object" };
  if (!nonEmptyString(json.version)) return { ok: false, error: "manifest.version: required non-empty string" };
  if (!nonEmptyString(json.pub_date)) return { ok: false, error: "manifest.pub_date: required non-empty string" };
  if (Number.isNaN(Date.parse(json.pub_date))) {
    return { ok: false, error: `manifest.pub_date: not a parseable date: ${json.pub_date}` };
  }
  const platforms = json.platforms;
  if (!isPlainObject(platforms)) return { ok: false, error: "manifest.platforms: required object" };
  const android = platforms.android;
  if (!isPlainObject(android)) return { ok: false, error: "manifest.platforms.android: required object" };
  if (!nonEmptyString(android.url)) {
    return { ok: false, error: "manifest.platforms.android.url: required non-empty string" };
  }
  if (json.minVersion !== undefined && !nonEmptyString(json.minVersion)) {
    return { ok: false, error: "manifest.minVersion: when present must be a non-empty string" };
  }
  if (json.rollout !== undefined) {
    if (!isPlainObject(json.rollout)) return { ok: false, error: "manifest.rollout: when present must be an object" };
    const stagePercent = json.rollout.stagePercent;
    if (
      typeof stagePercent !== "number" ||
      !Number.isSafeInteger(stagePercent) ||
      stagePercent < 0 ||
      stagePercent > 100
    ) {
      return { ok: false, error: "manifest.rollout.stagePercent: required integer in [0, 100]" };
    }
    if (json.rollout.cohortSeed !== undefined && !nonEmptyString(json.rollout.cohortSeed)) {
      return { ok: false, error: "manifest.rollout.cohortSeed: when present must be a non-empty string" };
    }
  }
  if (json.notes !== undefined && typeof json.notes !== "string") {
    return { ok: false, error: "manifest.notes: when present must be a string" };
  }
  return {
    ok: true,
    manifest: {
      version: json.version,
      pub_date: json.pub_date,
      platforms: { android: { url: android.url } },
      ...(json.minVersion !== undefined ? { minVersion: json.minVersion } : {}),
      ...(json.rollout !== undefined
        ? {
            rollout: {
              stagePercent: json.rollout.stagePercent as number,
              ...(json.rollout.cohortSeed !== undefined ? { cohortSeed: json.rollout.cohortSeed as string } : {}),
            },
          }
        : {}),
      ...(json.notes !== undefined ? { notes: json.notes as string } : {}),
    },
  };
}

// -- version comparison (the desktop compareSemver port, calver-tolerant) ---

/**
 * Numeric segment-wise comparison, -1 | 0 | 1 — the desktop updater's
 * compareSemver (apps/desktop/src/updater/manifest.ts) ported to the mobile
 * calver `v1.YY.MM.patch`: an optional leading `v`/`V` is stripped, missing
 * segments are zero (`1.26.11` equals `1.26.11.0`), leading zeros compare
 * numerically (`1.26.11.02` equals `1.26.11.2`), and a NON-numeric segment
 * sorts before a numeric one at the same position (`1.26.11.2-rc1` <
 * `1.26.11.2`, the semver prerelease rule). Two non-numeric segments compare
 * by code point (deterministic). Never throws: junk sorts deterministically
 * before anything numeric, so a broken value fails CLOSED (force-update),
 * never silently passes.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const normalize = (value: string): string => value.trim().replace(/^[vV]/, "");
  const segmentsA = normalize(a).split(".");
  const segmentsB = normalize(b).split(".");
  const length = Math.max(segmentsA.length, segmentsB.length);
  for (let index = 0; index < length; index += 1) {
    const left = segmentsA[index] ?? "0";
    const right = segmentsB[index] ?? "0";
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const leftValue = Number(left);
      const rightValue = Number(right);
      if (leftValue < rightValue) return -1;
      if (leftValue > rightValue) return 1;
    } else if (leftNumeric !== rightNumeric) {
      // Prerelease ordering: the tagged side ("2-rc1") sorts BEFORE the
      // plain release ("2") — 1.26.11.2-rc1 < 1.26.11.2.
      return leftNumeric ? 1 : -1;
    } else if (left < right) {
      return -1;
    } else if (left > right) {
      return 1;
    }
  }
  return 0;
}

// -- the policy decision ------------------------------------------------------

export type ReleasePolicyDecision =
  | { readonly action: "ok"; readonly reason: string }
  | { readonly action: "force-update"; readonly minVersion: string; readonly reason: string };

/**
 * Minimum-version enforcement (DR-P22-10): a running build below the
 * published `manifest.minVersion` is force-updated off itself (the client
 * blocks with the update screen — the entry-gate consumer in
 * native/App.tsx). No published minimum ⇒ nothing to enforce. The manifest
 * is assumed parse-validated (parseReleaseManifest) — an unparseable
 * manifest is the caller's fail-loud error, never a silent pass here.
 */
export function evaluateReleasePolicy(input: {
  readonly appVersion: string;
  readonly manifest: MobileReleaseManifest;
}): ReleasePolicyDecision {
  const minimum = input.manifest.minVersion;
  if (minimum === undefined) {
    return {
      action: "ok",
      reason: `no published minimum (manifest ${input.manifest.version} carries no minVersion) — nothing to enforce`,
    };
  }
  if (compareVersions(input.appVersion, minimum) < 0) {
    return {
      action: "force-update",
      minVersion: minimum,
      reason: `app ${input.appVersion} is below the published minimum ${minimum} — update required before the app may run`,
    };
  }
  return {
    action: "ok",
    reason: `app ${input.appVersion} meets the published minimum ${minimum}`,
  };
}
