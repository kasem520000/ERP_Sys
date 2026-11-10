/**
 * PHASE-021 T1/T12 · `check:desktop-shell` — the structural gate for the
 * Tauri shell sources + the desktop web export (MASTER-PLAN §8). The Rust
 * shell ships as SOURCE (no Rust toolchain in the sandbox — the k6
 * precedent): this script validates everything that does NOT need cargo, and
 * the Windows CI workflow (desktop-release.yml) compiles the crate for real.
 *
 * Coverage (exit ≠ 0 on any failure):
 *  1. src-tauri/tauri.conf.json — parses + invariants: identifier
 *     "com.erp.desktop", frontendDist resolves (from src-tauri/) to
 *     apps/web/out-desktop, updater endpoints present (the {{target}}/
 *     {{current_version}} updater channel), pubkey placeholder, bundle
 *     targets exactly nsis+msi, updater artifacts enabled.
 *  2. Bridge contract ↔ Rust command parity — parses the DesktopBridge
 *     member groups out of apps/desktop/src/bridge/contract.ts (the
 *     hasFunctions structural-validation pairs — the same surface
 *     isDesktopBridge enforces), maps each member to its Rust command name
 *     (the `<group>_<snake(method)>` table documented in src-tauri/src/
 *     lib.rs), and asserts BOTH a `#[tauri::command] fn <name>` in the
 *     src-tauri sources AND its registration in the generate_handler! list.
 *     A member missing on either side fails with the exact missing pair.
 *     connectivity.onChange maps to the EVENT "erp:connectivity" (listen-only,
 *     not an invoke) — asserted as the event name in lib.rs.
 *  3. apps/web/desktop.routes.json — manifest shape + every include route
 *     exists as app/[locale]/<route>/page.tsx (fail loud, all missing listed)
 *     + no include route shadows the reserved server surfaces.
 *  4. IF apps/web/out-desktop exists — every manifest route × locale has an
 *     exported HTML file (flat <locale>/<route>.html or dir index.html) and
 *     _next assets are present. If the export dir is absent: PASS with the
 *     note "export not built (run pnpm --filter @erp/web build:desktop)" —
 *     the CI workflow runs this check AFTER building the export.
 *  5. Secret scan — tauri.conf.json + capabilities/*.json + Cargo.toml must
 *     contain no key-looking material (private-key blocks, long base64/hex
 *     blobs, credential-looking assignments); the documented placeholder
 *     "<set-by-CI>" is allowlisted.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = join(repoRoot, "apps/desktop/src-tauri");
const webRoot = join(repoRoot, "apps/web");
const locales = readWebLocales();

let failures = 0;

function pass(message: string): void {
  console.log(`  ✓ ${message}`);
}

function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

function section(title: string): void {
  console.log(`\n== ${title}`);
}

/** The web app locales (i18n/dictionaries.ts `locales` literal). */
function readWebLocales(): string[] {
  const source = readFileSync(join(webRoot, "i18n/dictionaries.ts"), "utf8");
  const match = /export const locales = \[([^\]]*)\]/.exec(source);
  if (!match) throw new Error("i18n/dictionaries.ts: cannot read the locales literal");
  return match[1]!
    .split(",")
    .map((entry) => entry.trim().replace(/["'`]/g, ""))
    .filter((entry) => entry.length > 0);
}

// -- 1. tauri.conf.json invariants ---------------------------------------------

interface CheckResult {
  readonly ok: boolean;
  readonly detail?: string;
}

function checkTauriConfig(): void {
  section("1. src-tauri/tauri.conf.json invariants");
  const path = join(srcTauri, "tauri.conf.json");
  if (!existsSync(path)) {
    fail(`${path} missing`);
    return;
  }
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    fail(`tauri.conf.json does not parse: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const expect = (condition: boolean, message: string, detail?: string): void => {
    if (condition) pass(message);
    else fail(message + (detail === undefined ? "" : ` — ${detail}`));
  };

  expect(config.identifier === "com.erp.desktop", 'identifier is "com.erp.desktop"', String(config.identifier));
  expect(config.productName === "ERP Desktop", 'productName is "ERP Desktop"', String(config.productName));

  const build = config.build as Record<string, unknown> | undefined;
  const frontendDist = typeof build?.frontendDist === "string" ? build.frontendDist : "";
  const resolved = resolve(srcTauri, frontendDist || ".");
  expect(
    resolved === join(webRoot, "out-desktop"),
    `frontendDist resolves to apps/web/out-desktop (from src-tauri: "${frontendDist}")`,
    `resolved to ${resolved}`,
  );

  const bundle = config.bundle as Record<string, unknown> | undefined;
  const targets = Array.isArray(bundle?.targets) ? (bundle!.targets as string[]) : [];
  expect(
    targets.includes("nsis") && targets.includes("msi"),
    "bundle targets include nsis + msi",
    `targets = [${targets.join(", ")}]`,
  );
  expect(bundle?.createUpdaterArtifacts === true, "bundle.createUpdaterArtifacts enabled (updater .sig artifacts)");

  const plugins = config.plugins as Record<string, unknown> | undefined;
  const updater = plugins?.updater as Record<string, unknown> | undefined;
  const endpoints = Array.isArray(updater?.endpoints) ? (updater!.endpoints as string[]) : [];
  expect(
    endpoints.some((endpoint) => endpoint.includes("{{target}}") && endpoint.includes("{{current_version}}")),
    "updater endpoints carry the {{target}}/{{current_version}} channel template",
    `endpoints = [${endpoints.join(", ")}]`,
  );
  expect(
    typeof updater?.pubkey === "string" && updater.pubkey.length > 0,
    "updater pubkey present (CI injects the real key — placeholder <set-by-CI> documented)",
  );
}

// -- 2. bridge contract ↔ Rust command parity ----------------------------------

interface MemberMapping {
  readonly label: string;
  readonly kind: "command" | "event";
  readonly rustName: string;
}

/** camelCase → snake_case (checkNow → check_now; webview2Version → webview2_version). */
function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * The parity table — mirrors the mapping table documented in
 * src-tauri/src/lib.rs (invoke commands) plus the one event member.
 */
function mapMember(group: string, method: string): MemberMapping {
  if (group === "connectivity" && method === "onChange") {
    return { label: "connectivity.onChange", kind: "event", rustName: "erp:connectivity" };
  }
  return { label: `${group}.${method}`, kind: "command", rustName: `${group}_${snake(method)}` };
}

function readRustSources(): { raw: string; code: string } {
  const chunks: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".rs")) chunks.push(readFileSync(path, "utf8"));
    }
  };
  walk(join(srcTauri, "src"));
  walk(join(srcTauri, "plugins"));
  const raw = chunks.join("\n");
  // Comment-stripped view for the structural extracts (the mapping-table doc
  // comment in lib.rs names every command in prose — it must not count as
  // code).
  const code = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return { raw, code };
}

function checkBridgeParity(): void {
  section("2. DesktopBridge contract ↔ Rust command parity");
  const contractPath = join(repoRoot, "apps/desktop/src/bridge/contract.ts");
  if (!existsSync(contractPath)) {
    fail(`${contractPath} missing (the bridge contract is the parity source)`);
    return;
  }
  const contract = readFileSync(contractPath, "utf8");
  const { raw: rustRaw, code: rust } = readRustSources();

  // The contract's own structural validation lists every method group —
  // hasFunctions(value.<group>, ["m1", "m2"]) — the authoritative member set.
  const groups: Array<{ group: string; methods: string[] }> = [];
  const hasFunctions = /hasFunctions\(value\.(\w+),\s*\[([^\]]*)\]\)/g;
  for (const match of contract.matchAll(hasFunctions)) {
    const methods = match[2]!
      .split(",")
      .map((method) => method.trim().replace(/["'`]/g, ""))
      .filter((method) => method.length > 0);
    groups.push({ group: match[1]!, methods });
  }
  if (groups.length === 0) {
    fail("bridge contract: no hasFunctions(...) member groups found — parse drift");
    return;
  }
  const memberCount = groups.reduce((total, entry) => total + entry.methods.length, 0);
  pass(`contract member groups parsed: ${groups.map((g) => `${g.group}(${g.methods.length})`).join(", ")} — ${memberCount} members`);

  // Rust side: command fns + the generate_handler registration list.
  const commandFns = new Set<string>();
  for (const match of rust.matchAll(/#\[tauri::command\]\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/g)) {
    commandFns.add(match[1]!);
  }
  const handlerMatch = /generate_handler!\[([^\]]*)\]/s.exec(rust);
  const handlerList = new Set<string>();
  if (handlerMatch) {
    for (let raw of handlerMatch[1]!.split(",")) {
      raw = raw.trim();
      if (raw.length === 0) continue;
      handlerList.add(raw.split("::").pop()!);
    }
  }
  if (commandFns.size === 0) fail("src-tauri: no #[tauri::command] fns found under src/ or plugins/");
  else pass(`Rust #[tauri::command] fns: ${commandFns.size}`);
  if (handlerList.size === 0) fail("src-tauri: generate_handler! registration list not found");
  else pass(`generate_handler! registrations: ${handlerList.size}`);

  let commandsChecked = 0;
  for (const { group, methods } of groups) {
    for (const method of methods) {
      const mapping = mapMember(group, method);
      if (mapping.kind === "event") {
        const present = rustRaw.includes(`"${mapping.rustName}"`);
        if (present) pass(`${mapping.label} → event "${mapping.rustName}" present in the Rust sources`);
        else fail(`${mapping.label} → event "${mapping.rustName}" NOT found in the Rust sources`);
        continue;
      }
      commandsChecked += 1;
      const hasFn = commandFns.has(mapping.rustName);
      const registered = handlerList.has(mapping.rustName);
      if (hasFn && registered) {
        pass(`${mapping.label} → ${mapping.rustName} (#[tauri::command] + registered)`);
      } else {
        const missing: string[] = [];
        if (!hasFn) missing.push("no #[tauri::command] fn");
        if (!registered) missing.push("not in generate_handler!");
        fail(`${mapping.label} → ${mapping.rustName}: ${missing.join(" + ")}`);
      }
    }
  }
  // Reverse parity: every registered command must map back to a contract member.
  const contractNames = new Set(
    groups.flatMap(({ group, methods }) =>
      methods.map((method) => mapMember(group, method)).filter((m) => m.kind === "command").map((m) => m.rustName),
    ),
  );
  const orphans = [...handlerList].filter((name) => !contractNames.has(name));
  if (orphans.length === 0) pass(`reverse parity: all ${commandsChecked} registered commands map to contract members`);
  else fail(`Rust commands with no contract member (remove or extend the contract deliberately): ${orphans.join(", ")}`);
}

// -- 3. desktop.routes.json ----------------------------------------------------

function checkRoutesManifest(): { include: string[] } | null {
  section("3. apps/web/desktop.routes.json — the shell export manifest");
  const path = join(webRoot, "desktop.routes.json");
  if (!existsSync(path)) {
    fail(`${path} missing (DR-P21-07 — the prebuild + this check consume it)`);
    return null;
  }
  let manifest: { include?: unknown; exclude?: unknown };
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as { include?: unknown; exclude?: unknown };
  } catch (error) {
    fail(`desktop.routes.json does not parse: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!Array.isArray(manifest.include) || manifest.include.length === 0) {
    fail("desktop.routes.json: 'include' must be a non-empty array");
    return null;
  }
  const routePattern = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
  const include = manifest.include as string[];
  const invalid = include.filter((route) => !routePattern.test(route));
  if (invalid.length > 0) fail(`invalid route entries (lowercase kebab path segments): ${invalid.join(", ")}`);
  else pass(`include: [${include.join(", ")}]`);

  const reserved = Array.isArray(manifest.exclude) ? (manifest.exclude as string[]) : ["api", "middleware"];
  const shadowing = include.filter((route) => reserved.includes(route.split("/")[0]!));
  if (shadowing.length > 0) fail(`include routes shadow reserved server surfaces (${reserved.join(", ")}): ${shadowing.join(", ")}`);
  else pass(`reserved server surfaces (${reserved.join(", ")}) are never shadowed`);

  const missing = include.filter((route) => !existsSync(join(webRoot, "app/[locale]", route, "page.tsx")));
  if (missing.length > 0) {
    fail(
      `manifest routes missing from app/[locale]/ (create the page or fix the manifest):\n` +
        missing.map((route) => `      - app/[locale]/${route}/page.tsx`).join("\n"),
    );
  } else {
    pass(`every manifest route exists as app/[locale]/<route>/page.tsx (${include.length}/${include.length})`);
  }
  return { include };
}

// -- 4. the export (when built) -------------------------------------------------

function checkExport(include: string[]): void {
  section("4. apps/web/out-desktop — the exported shell (skipped when not built)");
  const outDir = join(webRoot, "out-desktop");
  if (!existsSync(outDir)) {
    console.log("  ○ export not built (run pnpm --filter @erp/web build:desktop) — PASS with note");
    return;
  }
  for (const route of include) {
    for (const locale of locales) {
      const flat = join(outDir, locale, `${route}.html`);
      const dir = join(outDir, locale, route, "index.html");
      const found = existsSync(flat) ? flat : existsSync(dir) ? dir : null;
      if (found) pass(`/${locale}/${route} exported (${found.slice(outDir.length)})`);
      else fail(`/${locale}/${route} missing in the export (expected ${locale}/${route}.html or index.html)`);
    }
  }
  const staticAssets = join(outDir, "_next", "static");
  if (existsSync(staticAssets) && readdirSync(staticAssets).length > 0) {
    pass("_next/static assets present");
  } else {
    fail("_next/static assets missing — the export is incomplete");
  }
}

// -- 5. secret scan ---------------------------------------------------------------

/** Documented placeholders that are explicitly NOT secrets. */
const ALLOWLIST = new Set(["<set-by-ci>"]);

function scanForSecrets(name: string, contents: string): void {
  const patterns: Array<{ label: string; pattern: RegExp }> = [
    { label: "private-key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { label: "long base64 blob (≥40 chars)", pattern: /(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])/g },
    { label: "long hex blob (≥32 chars)", pattern: /(?:^|[^a-fA-F0-9])[a-fA-F0-9]{32,}(?![a-fA-F0-9])/g },
    { label: "credential-looking assignment", pattern: /\b(password|secret|token|api[_-]?key|private[_-]?key)\b\s*[:=]\s*["'][^"']{8,}["']/gi },
  ];
  let clean = true;
  for (const { label, pattern } of patterns) {
    for (const match of contents.matchAll(pattern)) {
      const hit = match[0].trim();
      if (ALLOWLIST.has(hit.toLowerCase())) continue;
      if (ALLOWLIST.has(hit.split(/[:=]/, 1)[0]?.trim().toLowerCase() ?? "")) continue;
      // Assignment form: allowlisted VALUE (e.g. pubkey = "<set-by-CI>").
      const assigned = /=\s*["']?(<[^"']+)["']?/.exec(hit);
      if (assigned && ALLOWLIST.has(assigned[1]!.toLowerCase())) continue;
      clean = false;
      fail(`${name}: ${label} → ${hit.slice(0, 72)}${hit.length > 72 ? "…" : ""}`);
    }
  }
  if (clean) pass(`${name}: no key-looking material`);
}

function checkSecrets(): void {
  section("5. secret scan — shell configs");
  scanForSecrets("src-tauri/tauri.conf.json", readFileSync(join(srcTauri, "tauri.conf.json"), "utf8"));
  scanForSecrets("src-tauri/Cargo.toml", readFileSync(join(srcTauri, "Cargo.toml"), "utf8"));
  const capabilitiesDir = join(srcTauri, "capabilities");
  if (existsSync(capabilitiesDir)) {
    for (const entry of readdirSync(capabilitiesDir)) {
      if (entry.endsWith(".json")) {
        scanForSecrets(`src-tauri/capabilities/${entry}`, readFileSync(join(capabilitiesDir, entry), "utf8"));
      }
    }
  } else {
    fail("src-tauri/capabilities/ missing (the Tauri v2 capability file)");
  }
}

// -- main ------------------------------------------------------------------------

function main(): void {
  console.log("check:desktop-shell — PHASE-021 T1/T12 structural gate (source-only shell; CI compiles)");
  checkTauriConfig();
  checkBridgeParity();
  const manifest = checkRoutesManifest();
  if (manifest) checkExport(manifest.include);
  checkSecrets();
  console.log(
    failures === 0
      ? "\ncheck:desktop-shell: PASS — shell sources structurally valid" +
          "\n  (honest note: the Rust crate is compiled only by .github/workflows/desktop-release.yml)"
      : `\ncheck:desktop-shell: FAIL — ${failures} failure(s)`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
