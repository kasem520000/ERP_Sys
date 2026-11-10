/**
 * PHASE-022 T-P22-1b — the react-native Flow bridge for vitest (DR-P22-02
 * tooling; resolves the T-P22-1a deviation 4 deferral).
 *
 * WHY THIS EXISTS: `react-native` ships Flow syntax (`import typeof …`,
 * `@flow` type annotations) that Node's ESM loader, esbuild and rollup all
 * refuse to parse, and its Library sources are CommonJS with Metro-only
 * platform extensions (`.android.js`) that Node resolution does not know
 * about. Metro normally compiles all of this; the sandbox runs vitest.
 *
 * THE ARCHITECTURE (the jest architecture, ported to vitest):
 *
 *   1. `reactNativeBridge()` — a tiny vite plugin. Vitest maps
 *      `test.server.deps.inline` onto vite's `ssr.noExternal`, so with the
 *      inline regexes below vite asks its transform pipeline (instead of the
 *      ESM-import externalizer — which dies on `import typeof`) for every RN
 *      module the test files import. The plugin's transform answers with a
 *      ONE-LINE PASSTHROUGH `module.exports = require(<absolute file path>)`,
 *      so the vite pipeline never has to parse Flow at all, and every
 *      importer shares the single Node-CJS instance of react-native that the
 *      require-hook below produces (no split-brain module identity between
 *      the test file's `import` and @testing-library/react-native's internal
 *      `require("react-native")`).
 *
 *   2. `installReactNativeTestEnvironment()` — the vitest setup half, run
 *      from vitest.setup.rn.mjs BEFORE any test file imports react-native:
 *        - the react-native/jest/setup.js globals (transcribed without jest:
 *          `__DEV__`, `window`, ACT-environment flags, and the
 *          `nativeModuleProxy` native-module table that
 *          Libraries/BatchedBridge/NativeModules requires instead of the
 *          real bridge);
 *        - a Metro-style platform resolver patch — Node's resolver gets
 *          `.android.js` / `.native.js` / `.ios.js` fallbacks for requires
 *          originating inside react-native files (ADR-0014: this app is
 *          Android-only, so android wins);
 *        - a `require.extensions[".js"]` babel hook (the babel-register
 *          pattern) that transforms react-native / @react-native files with
 *          @react-native/babel-preset — the exact preset Metro uses — and
 *          leaves every other file untouched.
 *
 *   @babel/core and @react-native/babel-preset are NOT direct dependencies
 *   of @erp/mobile (the phase rule: never `pnpm install`) — they already
 *   live in the pnpm store as dependencies of react-native's own tree, so
 *   the hook resolves them through the store directory. If a future
 *   environment restructures the store, the hook fails loudly with the
 *   remediation (`pnpm add -D @react-native/babel-preset`) instead of
 *   silently skipping.
 */

import { createRequire } from "node:module";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Matches files owned by react-native (works for both the
 *  apps/mobile/node_modules symlink path and the resolved .pnpm store path). */
const RN_OWNED_PATH = /node_modules[\\/](react-native|@react-native)[\\/]/;

/** Metro platform resolution order — Android first (ADR-0014). */
const PLATFORM_EXTENSIONS = [".android.js", ".native.js", ".ios.js"];

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate `@react-native/babel-preset` in the pnpm virtual store by walking up
 * from this file to the workspace root. Returns the preset's real directory.
 */
function findRnBabelPresetDir() {
  let dir = here;
  for (let hops = 0; hops < 8; hops += 1) {
    const pnpmDir = path.join(dir, "node_modules", ".pnpm");
    if (fs.existsSync(pnpmDir)) {
      const candidate = fs
        .readdirSync(pnpmDir)
        .filter((entry) => /^@react-native\+babel-preset@/.test(entry))
        .sort()
        .at(-1);
      if (candidate !== undefined) {
        return path.join(pnpmDir, candidate, "node_modules", "@react-native", "babel-preset");
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The vitest/vite plugin: never let the vite pipeline see Flow sources. */
export function reactNativeBridge() {
  return {
    name: "erp-mobile-react-native-flow-bridge",
    enforce: "pre",
    transform(code, id) {
      if (!RN_OWNED_PATH.test(id)) return undefined;
      const cleanId = id.split("?")[0];
      return {
        code: `module.exports = require(${JSON.stringify(cleanId)});`,
        map: { mappings: "" },
      };
    },
  };
}

/** The vitest setup half: globals + Metro platform resolution + babel hook. */
export function installReactNativeTestEnvironment() {
  if (globalThis.__erpRnTestEnvironmentInstalled === true) return;
  globalThis.__erpRnTestEnvironmentInstalled = true;

  const nodeRequire = createRequire(import.meta.url);
  const Module = nodeRequire("node:module");

  // -- react-native/jest/setup.js globals (minus the jest.mock machinery) ----
  globalThis.__DEV__ = true;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = (callback) =>
    globalThis.setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => globalThis.clearTimeout(id);

  // The native-module table NativeModules.js needs instead of the real
  // bridge (global.nativeModuleProxy short-circuits the
  // `__fbBatchedBridgeConfig` invariant). Transcribed from
  // react-native/jest/setup.js with jest.fn replaced by plain functions.
  globalThis.nativeModuleProxy = {
    AlertManager: { alertWithArgs() {} },
    AsyncLocalStorage: {
      multiGet(_keys, callback) {
        process.nextTick(() => callback(null, []));
      },
      multiSet(_entries, callback) {
        process.nextTick(() => callback(null));
      },
      multiRemove(_keys, callback) {
        process.nextTick(() => callback(null));
      },
      multiMerge(_entries, callback) {
        process.nextTick(() => callback(null));
      },
      clear(callback) {
        process.nextTick(() => callback(null));
      },
      getAllKeys(callback) {
        process.nextTick(() => callback(null, []));
      },
    },
    DeviceInfo: {
      getConstants: () => ({
        Dimensions: {
          window: { fontScale: 2, height: 1334, scale: 2, width: 750 },
          screen: { fontScale: 2, height: 1334, scale: 2, width: 750 },
        },
      }),
    },
    DevSettings: { addMenuItem() {}, reload() {} },
    ImageLoader: {
      getSize: () => Promise.resolve([320, 240]),
      getSizeWithHeaders: () => Promise.resolve({ height: 222, width: 333 }),
      prefetchImage() {},
      prefetchImageWithMetadata() {},
      queryCache() {},
    },
    ImageViewManager: {
      getSize(_uri, success) {
        process.nextTick(() => success(320, 240));
      },
      prefetchImage() {},
    },
    KeyboardObserver: { addListener() {}, removeListeners() {} },
    Networking: { sendRequest() {}, abortRequest() {}, addListener() {}, removeListeners() {} },
    PlatformConstants: {
      getConstants: () => ({
        reactNativeVersion: { major: 1000, minor: 0, patch: 0, prerelease: undefined },
      }),
    },
    PushNotificationManager: {
      presentLocalNotification() {},
      scheduleLocalNotification() {},
      cancelAllLocalNotifications() {},
      removeAllDeliveredNotifications() {},
      getDeliveredNotifications(callback) {
        process.nextTick(() => callback([]));
      },
      removeDeliveredNotifications() {},
      setApplicationIconBadgeNumber() {},
      getApplicationIconBadgeNumber(callback) {
        process.nextTick(() => callback(0));
      },
      cancelLocalNotifications() {},
      getScheduledLocalNotifications(callback) {
        process.nextTick(() => callback());
      },
      requestPermissions: () => Promise.resolve({ alert: true, badge: true, sound: true }),
      abandonPermissions() {},
      checkPermissions(callback) {
        process.nextTick(() => callback({ alert: true, badge: true, sound: true }));
      },
      getInitialNotification: () => Promise.resolve(null),
      addListener() {},
      removeListeners() {},
    },
    SourceCode: { getConstants: () => ({ scriptURL: null }) },
    StatusBarManager: {
      setColor() {},
      setStyle() {},
      setHidden() {},
      setNetworkActivityIndicatorVisible() {},
      setBackgroundColor() {},
      setTranslucent() {},
      getConstants: () => ({ HEIGHT: 42 }),
    },
    Timing: { createTimer() {}, deleteTimer() {} },
    UIManager: { getConstants: () => ({}) },
    BlobModule: {
      getConstants: () => ({ BLOB_URI_SCHEME: "content", BLOB_URI_HOST: null }),
      addNetworkingHandler() {},
      enableBlobSupport() {},
      disableBlobSupport() {},
      createFromParts() {},
      sendBlob() {},
      release() {},
    },
    WebSocketModule: {
      connect() {},
      send() {},
      sendBinary() {},
      ping() {},
      close() {},
      addListener() {},
      removeListeners() {},
    },
    I18nManager: {
      allowRTL() {},
      forceRTL() {},
      swapLeftAndRightInRTL() {},
      getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: true }),
    },
  };

  // -- Metro platform-extension resolution (.android.js first) --------------
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
      const fromRnFile = parent !== null && parent !== undefined && RN_OWNED_PATH.test(parent.filename ?? "");
      if (fromRnFile && !request.startsWith("node:")) {
        for (const extension of PLATFORM_EXTENSIONS) {
          try {
            return originalResolveFilename.call(this, request + extension, parent, isMain, options);
          } catch {
            // try the next platform extension
          }
        }
      }
      throw error;
    }
  };

  // -- the babel require-hook (react-native files only) ----------------------
  let transformRnFile = null;
  const transformedCache = new Map();

  function ensureTransformer() {
    if (transformRnFile !== null) return transformRnFile;
    const presetDir = findRnBabelPresetDir();
    if (presetDir === null) {
      throw new Error(
        "[vitest.rn-bridge] @react-native/babel-preset not found in the pnpm store — " +
          "run `pnpm add -D @react-native/babel-preset` (workspace root or apps/mobile) " +
          "and re-run; react-native Flow sources cannot be transformed without it.",
      );
    }
    const requireFromPreset = createRequire(path.join(presetDir, "noop.js"));
    const babel = requireFromPreset("@babel/core");
    const preset = requireFromPreset("@react-native/babel-preset");
    transformRnFile = (filename) => {
      const source = fs.readFileSync(filename, "utf8");
      return babel.transformSync(source, {
        filename,
        presets: [preset],
        compact: false,
        sourceMaps: "inline",
      }).code;
    };
    return transformRnFile;
  }

  const originalJsLoader = nodeRequire.extensions[".js"];
  nodeRequire.extensions[".js"] = function rnFlowHook(module, filename) {
    if (RN_OWNED_PATH.test(filename)) {
      const transform = ensureTransformer();
      let code = transformedCache.get(filename);
      if (code === undefined) {
        code = transform(filename);
        transformedCache.set(filename, code);
      }
      module._compile(code, filename);
      return;
    }
    return originalJsLoader(module, filename);
  };
}
