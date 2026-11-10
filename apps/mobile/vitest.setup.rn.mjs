/**
 * PHASE-022 T-P22-1b — the vitest setup file that installs the react-native
 * Flow bridge (globals + Metro platform resolution + the @react-native/
 * babel-preset require-hook) BEFORE any test file imports react-native.
 * The mechanism lives in ./vitest.rn-bridge.mjs (see its header comment).
 */
import { installReactNativeTestEnvironment } from "./vitest.rn-bridge.mjs";

installReactNativeTestEnvironment();
