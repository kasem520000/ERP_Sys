#!/usr/bin/env node
/**
 * PHASE-021 DR-P21-07 — the desktop export prebuild (apps/web).
 *
 * Wraps a `next build` for the Tauri shell's STATIC EXPORT subset:
 *
 *   pnpm --filter @erp/web build:desktop
 *     = node scripts/desktop-export-prebuild.mjs -- next build
 *
 * Exact steps (the DR-P21-07 mechanics — see apps/web/desktop.routes.json):
 *   0. ABORT-SAFE RESTORE FIRST: if .desktop-stash/ exists from a crashed
 *      previous run, everything is restored from it (the stash is the
 *      authoritative copy of the pre-build tree) before anything else runs.
 *   1. Validate the manifest (desktop.routes.json): shape + every include
 *      route must exist as app/[locale]/<route>/page.tsx — missing routes
 *      fail LOUD with the full list; no include route may shadow the
 *      reserved exclude names (api, middleware).
 *   2. STASH (rename, same filesystem, no content copied):
 *        app/[locale]   → .desktop-stash/app-locale   (the FULL route tree)
 *        app/api        → .desktop-stash/app-api      (the BFF catch-all +
 *                         session routes — server-only, not exportable)
 *        middleware.ts  → .desktop-stash/middleware.ts (per-request CSP
 *                         nonce layer — no server in the shell; the shell's
 *                         CSP lives in tauri.conf.json)
 *        next-env.d.ts  → .desktop-stash/next-env.d.ts (defensive: keeps the
 *                         generated reference stable across build modes)
 *   3. REBUILD the reduced app/[locale]: layout.tsx (the shared chrome) +
 *      a COPY of each manifest route dir (copies — the stash keeps the full
 *      tree so restore is a single authoritative move back).
 *   4. SPAWN the wrapped build (`next build` by default; everything after
 *      `--`) with ERP_TARGET=desktop in its environment — next.config.ts
 *      switches to output:"export" + distDir:"out-desktop" + unoptimized
 *      images there.
 *   5. ALWAYS RESTORE (finally — also on build failure, spawn error, SIGINT/
 *      SIGTERM): remove the derived app/[locale] tree, move every stashed
 *      surface back, delete .desktop-stash/. Idempotent: restoring an
 *      already-clean tree is a no-op. NEVER touches git state (no git
 *      commands run here — `git status` after any run must show zero stash
 *      leftovers; out-desktop/ is a gitignored build output).
 *
 * No dependencies — plain node:fs/path/child_process (Node ≥ 22).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stashDir = join(webRoot, ".desktop-stash");
const appDir = join(webRoot, "app");
const localeDir = join(appDir, "[locale]");
const apiDir = join(appDir, "api");
const middlewareFile = join(webRoot, "middleware.ts");
const nextEnvFile = join(webRoot, "next-env.d.ts");

const STASH = {
  locale: join(stashDir, "app-locale"),
  api: join(stashDir, "app-api"),
  middleware: join(stashDir, "middleware.ts"),
  nextEnv: join(stashDir, "next-env.d.ts"),
};

let restored = false;

function log(message) {
  process.stdout.write(`[desktop-export] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[desktop-export] ERROR: ${message}\n`);
  process.exitCode = 1;
}

/** Reserved server surfaces (manifest `exclude`) — always removed for export. */
const RESERVED = ["api", "middleware"];

/** Reads + structurally validates desktop.routes.json (fail loud, no deps). */
function readManifest() {
  const manifestPath = join(webRoot, "desktop.routes.json");
  if (!existsSync(manifestPath)) {
    fail(`missing ${manifestPath} — the desktop shell manifest (DR-P21-07)`);
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`desktop.routes.json is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  const include = manifest.include;
  if (!Array.isArray(include) || include.length === 0) {
    fail("desktop.routes.json: 'include' must be a non-empty array of route segments");
    process.exit(1);
  }
  const routePattern = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
  const bad = include.filter((route) => typeof route !== "string" || !routePattern.test(route));
  if (bad.length > 0) {
    fail(`desktop.routes.json: invalid route entries (need lowercase kebab path segments): ${bad.join(", ")}`);
    process.exit(1);
  }
  const shadowing = include.filter((route) => RESERVED.includes(route.split("/")[0]));
  if (shadowing.length > 0) {
    fail(`desktop.routes.json: include routes may not shadow reserved server surfaces (${RESERVED.join(", ")}): ${shadowing.join(", ")}`);
    process.exit(1);
  }
  return { include, notes: typeof manifest.notes === "string" ? manifest.notes : "" };
}

/** Moves a path back from the stash; tolerates a missing source or target. */
function restoreOne(stashPath, targetPath, { replaceTarget = false } = {}) {
  if (!existsSync(stashPath)) return;
  if (existsSync(targetPath)) {
    if (!replaceTarget) {
      // Target AND stash both hold it — the stash is authoritative (it was
      // renamed away from this very tree). Replace + say so, loudly enough.
      log(`restore: replacing existing ${targetPath} from stash (authoritative)`);
    }
    rmSync(targetPath, { recursive: true, force: true });
  }
  renameSync(stashPath, targetPath);
  log(`restore: ${targetPath}`);
}

/** Full abort-safe restore (idempotent; safe on a clean tree). */
function restoreAll(reason) {
  if (restored) return;
  restored = true;
  if (!existsSync(stashDir)) {
    log(`restore (${reason}): clean — nothing stashed`);
    return;
  }
  log(`restore (${reason}): restoring stashed surfaces…`);
  restoreOne(STASH.locale, localeDir, { replaceTarget: true });
  restoreOne(STASH.api, apiDir);
  restoreOne(STASH.middleware, middlewareFile);
  restoreOne(STASH.nextEnv, nextEnvFile);
  rmSync(stashDir, { recursive: true, force: true });
  log(`restore (${reason}): .desktop-stash removed — tree is back to normal`);
}

/** Validates every manifest route exists in the CURRENT (pre-stash) tree. */
function validateRoutes(include) {
  const missing = include.filter((route) => !existsSync(join(localeDir, route, "page.tsx")));
  if (missing.length > 0) {
    fail(
      `desktop.routes.json lists routes that do not exist as app/[locale]/<route>/page.tsx:\n` +
        missing.map((route) => `  - ${route}`).join("\n"),
    );
    process.exit(1);
  }
  if (!existsSync(join(localeDir, "layout.tsx"))) {
    fail("app/[locale]/layout.tsx (the shared shell chrome) is missing — the export needs it");
    process.exit(1);
  }
}

/** Stash + rebuild the reduced route tree (steps 2–3 of the header). */
function stashAndReduce(include) {
  mkdirSync(stashDir, { recursive: true });
  renameSync(localeDir, STASH.locale);
  if (existsSync(apiDir)) renameSync(apiDir, STASH.api);
  if (existsSync(middlewareFile)) renameSync(middlewareFile, STASH.middleware);
  if (existsSync(nextEnvFile)) renameSync(nextEnvFile, STASH.nextEnv);

  mkdirSync(localeDir, { recursive: true });
  cpSync(join(STASH.locale, "layout.tsx"), join(localeDir, "layout.tsx"));
  for (const route of include) {
    cpSync(join(STASH.locale, route), join(localeDir, route), { recursive: true });
  }
  log(
    `stashed: app/[locale] (full tree), app/api, middleware.ts, next-env.d.ts → .desktop-stash/\n` +
      `reduced tree: app/[locale]/{layout.tsx, ${include.join(", ")}}`,
  );
}

/** Resolves the local next binary (pnpm workspace symlink) — no shell needed. */
function resolveNextBin() {
  const require = createRequire(join(webRoot, "package.json"));
  try {
    const nextPackageJson = require.resolve("next/package.json");
    return join(dirname(nextPackageJson), "dist", "bin", "next");
  } catch {
    return join(webRoot, "node_modules", "next", "dist", "bin", "next");
  }
}

/** Runs the wrapped build with ERP_TARGET=desktop; returns its exit code. */
function runBuild(argvAfterSeparator) {
  const command = argvAfterSeparator.length > 0 ? argvAfterSeparator : ["next", "build"];
  let file = command[0];
  let args = command.slice(1);
  if (file === "next") {
    file = process.execPath;
    args = [resolveNextBin(), ...args];
  }
  log(`spawning (cwd ${webRoot}): ${file} ${args.join(" ")}  [ERP_TARGET=desktop]`);
  const child = spawn(file, args, {
    cwd: webRoot,
    stdio: "inherit",
    env: { ...process.env, ERP_TARGET: "desktop" },
  });
  child.on("error", (error) => {
    fail(`build process failed to start: ${error.message}`);
  });
  return new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const separator = process.argv.indexOf("--");
  const buildArgs = separator >= 0 ? process.argv.slice(separator + 1) : [];

  // Step 0 — abort-safe: a leftover stash from a crashed run is restored first.
  if (existsSync(stashDir)) {
    log("found a leftover .desktop-stash/ (crashed run?) — restoring before anything else");
    restored = false;
    restoreAll("abort-safe pre-restore");
    restored = false; // this run may stash again below
  }

  const { include } = readManifest();
  validateRoutes(include);
  stashAndReduce(include);

  process.on("SIGINT", () => {
    restoreAll("SIGINT");
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    restoreAll("SIGTERM");
    process.exit(143);
  });

  try {
    const code = await runBuild(buildArgs);
    if (code === 0) {
      log("build finished — restoring the workspace tree");
    } else {
      log(`build FAILED (exit ${code}) — restoring the workspace tree anyway`);
    }
    process.exitCode = code ?? 1;
  } finally {
    restoreAll("finally");
  }
}

main().catch((error) => {
  fail(`unexpected error: ${error instanceof Error ? error.stack : String(error)}`);
  restoreAll("error");
  process.exitCode = 1;
});
