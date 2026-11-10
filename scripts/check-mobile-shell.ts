/**
 * PHASE-022 T-P22-4-a · `check:mobile-shell` — the structural gate for the
 * Expo native glue + the RN screen surface (MASTER-PLAN §1 DR-P22-01/
 * DR-P22-02/DR-P22-11 + §10; the check-desktop-shell precedent). The native
 * dir ships as SOURCE (no Android SDK / EAS CLI / expo toolchain in the
 * sandbox — the k6 precedent): this script validates everything that does
 * NOT need the expo toolchain, and the EAS CI workflow
 * (.github/workflows/mobile-release.yml) compiles the app for real.
 *
 * Coverage (exit ≠ 0 on any failure):
 *  1. native/package.json — the expo toolchain declaration: all nine
 *     packages present (expo + the six expo-* device modules + react +
 *     react-native), react EXACTLY matching apps/mobile (18.3.1) and
 *     react-native consistent with the workspace range (^0.76.5 ⊇ 0.76.5),
 *     plus the packageManager pin the EAS CI install follows.
 *  2. native/App.tsx — the entry point: registerRootComponent invoked, the
 *     app entry wired through apps/mobile/package.json "main", and the
 *     planned drivers + navigation registry + I18nManager.forceRTL +
 *     background-fetch TODO wiring present (structure, not compilation —
 *     the driver names are derived from native/drivers/README.md).
 *  3. app.config.ts + eas.json — parse + the required keys: android-only
 *     platform, the com.erp.field package id, and the preview (internal
 *     APK) + production (AAB, autoIncrement, EXPO_NO_TELEMETRY) profiles.
 *  4. the screen registry — every screen file referenced in
 *     apps/mobile/src/screens/registry.ts exists, and every *Screen.tsx in
 *     the dir is registered (no orphans); the screenEntry call count equals
 *     the registered import count.
 *  5. screen imports — only allowed modules: react, react-native, relative
 *     imports (theme/i18n/the mobile areas), and the package's own workspace
 *     deps (@erp/contracts/@erp/domain-core/@erp/sync-core). Never
 *     packages/ui, never apps/api, never expo-* (grep-level, per file).
 *  6. the workspace boundary — pnpm-workspace.yaml negates
 *     apps/mobile/native, the lockfile carries no native importer, and the
 *     workspace package declares no expo dependency.
 *  7. DR-P22-02/11 spot-checks — no raw hex-color literals and no
 *     physical-direction style props in the screens dir (the ESLint
 *     DR-P22-03 rule is the primary gate; this is the structural mirror).
 *     a11y props + ≥44px targets stay with the ESLint/render suites —
 *     printed here as the recorded note, never a silent skip.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = join(repoRoot, "apps/mobile");
const nativeRoot = join(mobileRoot, "native");
const screensRoot = join(mobileRoot, "src/screens");

let failures = 0;

function pass(message: string): void {
  console.log(`  ✓ ${message}`);
}

function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

function info(message: string): void {
  console.log(`  ○ ${message}`);
}

function section(title: string): void {
  console.log(`\n== ${title}`);
}

interface PkgJson {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly packageManager?: string;
  readonly main?: string;
  readonly [key: string]: unknown;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

// -- 1. native/package.json — the expo toolchain declaration ---------------

/** The nine-package expo toolchain (DR-P22-01) every native build needs. */
const NATIVE_TOOLCHAIN: ReadonlyArray<{ readonly name: string; readonly version: string }> = [
  { name: "expo", version: "~52.0.0" },
  { name: "expo-sqlite", version: "~15.0.0" },
  { name: "expo-secure-store", version: "~14.0.0" },
  { name: "expo-local-authentication", version: "~15.0.0" },
  { name: "expo-notifications", version: "~0.29.0" },
  { name: "expo-background-fetch", version: "~13.0.0" },
  { name: "expo-task-manager", version: "~12.0.0" },
  { name: "react", version: "18.3.1" },
  { name: "react-native", version: "0.76.5" },
];

/**
 * Caret-range satisfaction for the consistency check: does the native PIN
 * satisfy the workspace RANGE? `^x.y.z`: same major; for 0.x also same
 * minor; patch at least the range's floor.
 */
function satisfiesCaret(pin: string, range: string): boolean {
  const rangeMatch = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const pinMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(pin);
  if (!rangeMatch || !pinMatch) return false;
  const [major, minor, patch] = [Number(pinMatch[1]), Number(pinMatch[2]), Number(pinMatch[3])];
  const [rMajor, rMinor, rPatch] = [Number(rangeMatch[1]), Number(rangeMatch[2]), Number(rangeMatch[3])];
  if (major !== rMajor) return false;
  if (major === 0 && minor !== rMinor) return false;
  if (minor === rMinor && patch < rPatch) return false;
  return true;
}

function checkNativePackage(): void {
  section("1. native/package.json — the expo toolchain declaration");
  const path = join(nativeRoot, "package.json");
  if (!existsSync(path)) {
    fail(`${path} missing (the EAS glue package — DR-P22-01)`);
    return;
  }
  const nativePkg = readJson(path) as PkgJson;
  const deps = (nativePkg.dependencies ?? {}) as Record<string, string>;

  const missing = NATIVE_TOOLCHAIN.filter((entry) => deps[entry.name] === undefined);
  if (missing.length > 0) fail(`expo toolchain incomplete — missing: ${missing.map((e) => e.name).join(", ")}`);
  else pass(`all 9 toolchain packages declared: ${NATIVE_TOOLCHAIN.map((e) => `${e.name}@${deps[e.name]}`).join(", ")}`);

  const wrongVersion = NATIVE_TOOLCHAIN.filter((entry) => deps[entry.name] !== undefined && deps[entry.name] !== entry.version);
  if (wrongVersion.length > 0) {
    fail(
      `toolchain versions drifted from the DR-P22-01 pin — ${wrongVersion
        .map((e) => `${e.name}: ${deps[e.name]} (expected ${e.version})`)
        .join(", ")}`,
    );
  } else {
    pass("every toolchain version matches the DR-P22-01 pin table");
  }

  // react/react-native consistency with the workspace package.
  const mobilePkgPath = join(mobileRoot, "package.json");
  const mobilePkg = readJson(mobilePkgPath) as PkgJson;
  const mobileDeps = (mobilePkg.dependencies ?? {}) as Record<string, string>;
  if (deps["react"] === mobileDeps["react"]) {
    pass(`react matches the workspace exactly: ${deps["react"]} === ${mobileDeps["react"]}`);
  } else {
    fail(`react drift: native ${deps["react"] ?? "<absent>"} vs workspace ${mobileDeps["react"] ?? "<absent>"} (must be identical)`);
  }
  const nativeRn = deps["react-native"] ?? "";
  const mobileRn = mobileDeps["react-native"] ?? "";
  if (satisfiesCaret(nativeRn, mobileRn)) {
    pass(`react-native consistent: native pin ${nativeRn} satisfies the workspace range ${mobileRn}`);
  } else {
    fail(`react-native inconsistent: native pin ${nativeRn || "<absent>"} does not satisfy the workspace range ${mobileRn || "<absent>"}`);
  }

  // The package manager the EAS CI install follows (corepack reads it).
  const rootPkg = readJson(join(repoRoot, "package.json")) as PkgJson;
  if (nativePkg.packageManager !== undefined && nativePkg.packageManager === rootPkg.packageManager) {
    pass(`packageManager pin matches the root: ${nativePkg.packageManager}`);
  } else {
    fail(
      `packageManager mismatch: native ${String(nativePkg.packageManager)} vs root ${String(rootPkg.packageManager)} ` +
        "(the workflow's native install relies on this pin)",
    );
  }
}

// -- 2. native/App.tsx — the entry point --------------------------------------

/** The planned drivers, derived from native/drivers/README.md's table. */
function plannedDrivers(): string[] {
  const path = join(nativeRoot, "drivers/README.md");
  if (!existsSync(path)) return [];
  const source = readFileSync(path, "utf8");
  const drivers = new Set<string>();
  for (const match of source.matchAll(/`([a-z-]+)\.ts`/g)) {
    drivers.add(match[1]!);
  }
  return [...drivers];
}

function checkEntryPoint(): void {
  section("2. native/App.tsx — the entry point + the planned wiring");
  const path = join(nativeRoot, "App.tsx");
  if (!existsSync(path)) {
    fail(`${path} missing (the expo entry — registerRootComponent)`);
    return;
  }
  const source = readFileSync(path, "utf8");

  if (/import\s*\{[^}]*registerRootComponent[^}]*\}\s*from\s*["']expo["']/.test(source) && /registerRootComponent\s*\(/.test(source)) {
    pass("registerRootComponent imported from expo and invoked");
  } else {
    fail("registerRootComponent not wired (expected the expo import + the App invocation)");
  }

  // The app entry: apps/mobile/package.json "main" → ./native/App.tsx (the
  // metro entry), while the library surface stays on the exports map.
  const mobilePkg = readJson(join(mobileRoot, "package.json")) as PkgJson;
  if (mobilePkg.main === "./native/App.tsx") {
    const exportsMap = (mobilePkg.exports ?? {}) as Record<string, unknown>;
    if (exportsMap["."] === "./src/index.ts") {
      pass('the app entry is native/App.tsx (package.json "main") with the library surface intact on exports["."]');
    } else {
      fail('package.json exports["."] must stay "./src/index.ts" (the library surface — the entry change must not drift it)');
    }
  } else {
    fail(`package.json "main" must be "./native/App.tsx" (the metro entry) — found ${String(mobilePkg.main)}`);
  }

  // The planned wiring (TODO stubs acceptable — structure, not compilation).
  const drivers = plannedDrivers();
  if (drivers.length === 0) {
    fail("native/drivers/README.md: the planned-driver table could not be parsed");
  } else {
    const unwired = drivers.filter((driver) => !source.includes(driver));
    if (unwired.length === 0) {
      pass(`all ${drivers.length} planned drivers named in the wiring TODO (${drivers.join(", ")})`);
    } else {
      fail(`planned drivers missing from the App.tsx wiring TODO: ${unwired.join(", ")}`);
    }
  }
  for (const marker of ["SCREEN_REGISTRY", "I18nManager.forceRTL", "background-fetch"]) {
    if (source.includes(marker)) pass(`wiring TODO names ${marker}`);
    else fail(`wiring TODO must name ${marker} (the DR-P22-01/11 glue plan)`);
  }
}

// -- 3. app.config.ts + eas.json — the EAS build surface ----------------------

interface ExpoAppConfig {
  readonly name?: string;
  readonly slug?: string;
  readonly scheme?: string;
  readonly version?: string;
  readonly platforms?: unknown;
  readonly android?: { readonly package?: string };
  readonly jsEngine?: string;
}

async function checkBuildSurface(): Promise<void> {
  section("3. app.config.ts + eas.json — the EAS build surface");

  // app.config.ts — imported (it imports nothing itself; tsx loads it).
  let appConfig: ExpoAppConfig | null = null;
  try {
    const mod = (await import("../apps/mobile/app.config")) as { default: ExpoAppConfig };
    appConfig = mod.default;
    pass("app.config.ts loads (imports nothing — the DR-P22-01 rule)");
  } catch (error) {
    fail(`app.config.ts failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (appConfig !== null) {
    const expect = (condition: boolean, message: string, detail?: string): void => {
      if (condition) pass(message);
      else fail(message + (detail === undefined ? "" : ` — ${detail}`));
    };
    expect(appConfig.name === "ERP Field", 'name is "ERP Field"', String(appConfig.name));
    expect(appConfig.slug === "erp-field", 'slug is "erp-field"', String(appConfig.slug));
    expect(
      Array.isArray(appConfig.platforms) &&
        appConfig.platforms.length === 1 &&
        appConfig.platforms[0] === "android",
      'platforms is exactly ["android"] (android-only this phase)',
      JSON.stringify(appConfig.platforms),
    );
    expect(
      appConfig.android?.package === "com.erp.field",
      'android.package is "com.erp.field"',
      String(appConfig.android?.package),
    );
    expect(typeof appConfig.version === "string" && appConfig.version.length > 0, "version is a non-empty string", String(appConfig.version));
    expect(appConfig.jsEngine === "hermes", 'jsEngine is "hermes" (the RN 0.76/Expo 52 default, pinned)', String(appConfig.jsEngine));
  }

  // eas.json — plain JSON parse (the "//" keys are legal JSON strings).
  const easPath = join(mobileRoot, "eas.json");
  if (!existsSync(easPath)) {
    fail(`${easPath} missing`);
    return;
  }
  let eas: Record<string, unknown>;
  try {
    eas = readJson(easPath);
  } catch (error) {
    fail(`eas.json does not parse: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const build = (eas.build ?? {}) as Record<string, Record<string, unknown>>;
  const preview = build.preview;
  const production = build.production;
  if (preview === undefined) {
    fail('eas.json: the "preview" profile is missing');
  } else {
    const ok =
      preview.distribution === "internal" &&
      (preview.android as { buildType?: string } | undefined)?.buildType === "apk" &&
      preview.developmentClient === false;
    if (ok) pass('preview profile: internal APK distribution (the QA/device-drill channel)');
    else fail(`preview profile keys wrong: ${JSON.stringify(preview)}`);
  }
  if (production === undefined) {
    fail('eas.json: the "production" profile is missing');
  } else {
    const android = (production.android as { buildType?: string } | undefined)?.buildType;
    const env = (production.env ?? {}) as Record<string, string>;
    const ok = production.autoIncrement === true && android === "app-bundle" && env["EXPO_NO_TELEMETRY"] === "1";
    if (ok) pass("production profile: AAB + autoIncrement + EXPO_NO_TELEMETRY=1 (no secrets inline — S-15 is CI-injected)");
    else fail(`production profile keys wrong: ${JSON.stringify(production)}`);
  }
  const cli = (eas.cli ?? {}) as Record<string, string>;
  if (typeof cli.version === "string" && cli.version.startsWith(">=")) pass(`cli.version floor: ${cli.version}`);
  else fail("cli.version must be a >= floor (e.g. \">= 12.0.0\")");
  const submit = (eas.submit ?? {}) as Record<string, unknown>;
  if (submit.production !== undefined) pass("submit.production documented (the Play Store track placeholder)");
  else fail("eas.json: submit.production must be documented (never silently absent)");
}

// -- 4. the screen registry ---------------------------------------------------

/** Every relative ./ import in registry.ts (the registration site). */
function registryScreenImports(): string[] {
  const source = readFileSync(join(screensRoot, "registry.ts"), "utf8");
  const specs = new Set<string>();
  for (const match of source.matchAll(/from\s*["']\.\/([A-Za-z0-9-]+)["']/g)) {
    if (/Screen$/.test(match[1]!)) specs.add(match[1]!);
  }
  return [...specs];
}

function checkScreenRegistry(): void {
  section("4. src/screens/registry.ts — completeness + no orphans");
  const registryPath = join(screensRoot, "registry.ts");
  if (!existsSync(registryPath)) {
    fail(`${registryPath} missing (the DR-P22-11 registration site)`);
    return;
  }
  const registered = registryScreenImports();
  if (registered.length === 0) {
    fail("registry.ts: no *Screen component imports found — parse drift");
    return;
  }

  const missingOnDisk = registered.filter((name) => !existsSync(join(screensRoot, `${name}.tsx`)));
  if (missingOnDisk.length === 0) {
    pass(`every registered screen exists on disk (${registered.length}/${registered.length})`);
  } else {
    fail(`registered screens missing from the dir: ${missingOnDisk.join(", ")}`);
  }

  const dirScreens = readdirSync(screensRoot)
    .filter((entry) => /^[A-Z][A-Za-z0-9]*Screen\.tsx$/.test(entry))
    .map((entry) => entry.replace(/\.tsx$/, ""));
  const orphans = dirScreens.filter((name) => !registered.includes(name));
  if (orphans.length === 0) {
    pass(`no orphans: every *Screen.tsx in the dir is registered (${dirScreens.length}/${dirScreens.length})`);
  } else {
    fail(`orphan screens (in the dir, NOT registered — register or delete): ${orphans.join(", ")}`);
  }

  const source = readFileSync(registryPath, "utf8");
  const entryCalls = (source.match(/screenEntry\(/g) ?? []).length;
  if (entryCalls === registered.length) {
    pass(`screenEntry calls ${entryCalls} === registered imports ${registered.length}`);
  } else {
    fail(`screenEntry calls ${entryCalls} ≠ registered imports ${registered.length} (an import without an entry, or vice versa)`);
  }
  const uniqueNames = new Set((source.match(/name: "[A-Za-z]+"/g) ?? []).map((n) => n.slice(7, -1)));
  if (uniqueNames.size === registered.length) {
    pass(`unique registry names: ${uniqueNames.size}`);
  } else {
    fail(`registry names are not unique across entries: ${[...uniqueNames].join(", ")}`);
  }
  const referenceCount = source.split("\n").filter((line) => line.includes("Screen")).length;
  info(`registry.ts carries ${referenceCount} screen-reference lines — the T-P22-3-b handoff figure (60 at wave close)`);
}

// -- 5. screen imports (the allowed-module surface) ---------------------------

/** Import/export-from specifiers in a source file. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(/(?:^|[\s;}])from\s*["']([^"']+)["']/g)) {
    specs.push(match[1]!);
  }
  for (const match of source.matchAll(/^import\s*["']([^"']+)["']/gm)) {
    specs.push(match[1]!);
  }
  return specs;
}

const ALLOWED_BARE = new Set(["react", "react-native", "@erp/contracts", "@erp/domain-core", "@erp/sync-core"]);

function classifyViolation(specifier: string): string {
  if (specifier === "@erp/ui" || specifier.startsWith("@erp/ui/")) return "packages/ui (DR-P22-01 — RN never imports packages/ui)";
  if (specifier === "@erp/api" || specifier.startsWith("@erp/api/")) return "apps/api (clients never import the API app)";
  if (/^expo(-|$)/.test(specifier)) return "the expo toolchain (native/ owns it — DR-P22-01)";
  if (specifier.startsWith("@erp/")) return `another @erp package (${specifier} — only contracts/domain-core/sync-core are declared)`;
  if (specifier.startsWith("packages/") || specifier.startsWith("apps/")) return "a monorepo deep path (never — import the package name)";
  if (specifier.startsWith("node:") || specifier.startsWith("fs") || specifier.startsWith("path")) return "a Node builtin (RN screens run on the device)";
  return "an undeclared module";
}

function checkScreenImports(): void {
  section("5. src/screens/** imports — the allowed-module surface");
  const files = readdirSync(screensRoot).filter((entry) => /\.(ts|tsx)$/.test(entry));
  let checkedFiles = 0;
  let checkedImports = 0;
  for (const file of files) {
    const source = readFileSync(join(screensRoot, file), "utf8");
    const specs = importSpecifiers(source);
    if (specs.length === 0) continue;
    checkedFiles += 1;
    const violations = specs.filter((specifier) => {
      if (specifier.startsWith("./") || specifier.startsWith("../")) return false;
      if (specifier.startsWith("react/") || specifier.startsWith("react-native/")) return false;
      return !ALLOWED_BARE.has(specifier);
    });
    checkedImports += specs.length;
    if (violations.length === 0) {
      pass(`${file}: ${specs.length} imports all allowed (react/react-native/relative/@erp workspace deps)`);
    } else {
      for (const specifier of violations) {
        fail(`${file}: forbidden import "${specifier}" — ${classifyViolation(specifier)}`);
      }
    }
  }
  info(`${checkedFiles} screen-area files checked, ${checkedImports} import statements validated`);
}

// -- 6. the workspace boundary --------------------------------------------------

function checkWorkspaceBoundary(): void {
  section("6. the workspace boundary — native/ is never installed");
  const workspaceYaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  if (/["']!apps\/mobile\/native["']/.test(workspaceYaml)) {
    pass('pnpm-workspace.yaml carries the explicit "!apps/mobile/native" negation');
  } else {
    fail('pnpm-workspace.yaml must negate "apps/mobile/native" (the DR-P22-01 boundary)');
  }

  const lockSource = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8");
  const lockHits = lockSource.match(/apps\/mobile\/native/g) ?? [];
  if (lockHits.length === 0) {
    pass("pnpm-lock.yaml: no apps/mobile/native importer (the native dir never enters the lockfile)");
  } else {
    fail(`pnpm-lock.yaml mentions apps/mobile/native ${lockHits.length}× — the native dir must stay outside the install graph`);
  }

  const mobilePkg = readJson(join(mobileRoot, "package.json")) as PkgJson;
  const allDeps = {
    ...((mobilePkg.dependencies ?? {}) as Record<string, string>),
    ...((mobilePkg.devDependencies ?? {}) as Record<string, string>),
  };
  const expoKeys = Object.keys(allDeps).filter((key) => /^expo(-|$)/.test(key) || /^@expo\//.test(key));
  if (expoKeys.length === 0) {
    pass("@erp/mobile declares no expo dependency (the toolchain lives only in native/package.json)");
  } else {
    fail(`@erp/mobile must never depend on the expo toolchain — found: ${expoKeys.join(", ")}`);
  }
}

// -- 7. DR-P22-02/11 structural spot-checks ------------------------------------

/** Comment-stripped view (comment LINES + block comments; inline trailing
 * slashes survive so URL strings never get mangled). */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const PHYSICAL_PROPS =
  /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor)\s*:/;
const POSITIONING_KEYS = /^\s*(left|right):/m;
const HEX_COLOR = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3})\b/;
const TEXTALIGN_PHYSICAL = /textAlign\s*:\s*["']?(left|right)["']?/;

function checkScreenSpotChecks(): void {
  section("7. DR-P22-02/11 spot-checks — screens (tokens + logical props)");
  const files = readdirSync(screensRoot).filter((entry) => /\.(ts|tsx)$/.test(entry));
  let tokenHits = 0;
  let rtlHits = 0;
  for (const file of files) {
    const source = stripComments(readFileSync(join(screensRoot, file), "utf8"));
    const hex = HEX_COLOR.exec(source);
    if (hex) {
      tokenHits += 1;
      fail(`${file}: raw hex color literal "${hex[0]}" — screens read theme tokens, never re-declare values (DR-P22-02)`);
    }
    for (const line of source.split("\n")) {
      if (line.includes("rtl-exempt")) continue; // the documented escape (mirror of the ESLint protocol)
      if (PHYSICAL_PROPS.test(line) || POSITIONING_KEYS.test(line) || TEXTALIGN_PHYSICAL.test(line)) {
        rtlHits += 1;
        fail(`${file}: physical-direction style prop — use logical props (DR-P22-03): ${line.trim()}`);
      }
    }
  }
  if (tokenHits === 0) pass("no raw hex-color literals in the screens dir (tokens only — DR-P22-02)");
  if (rtlHits === 0) pass("no physical-direction style props (logical props only — the DR-P22-03 mirror)");
  info("a11y labels + ≥44px targets: enforced by the render suites (screens-cpr/screens tests) + ESLint DR-P22-03 — listed for the record, never skipped");
}

// -- main ------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("check:mobile-shell — PHASE-022 T-P22-4-a structural gate (source-only native glue; EAS CI compiles)");
  checkNativePackage();
  checkEntryPoint();
  await checkBuildSurface();
  checkScreenRegistry();
  checkScreenImports();
  checkWorkspaceBoundary();
  checkScreenSpotChecks();
  console.log(
    failures === 0
      ? "\ncheck:mobile-shell: PASS — mobile shell + screen surface structurally valid" +
          "\n  (honest note: the expo toolchain is compiled only by .github/workflows/mobile-release.yml)"
      : `\ncheck:mobile-shell: FAIL — ${failures} failure(s)`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`check:mobile-shell: unexpected failure — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
