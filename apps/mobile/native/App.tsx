/**
 * PHASE-022 (DR-P22-01 / DR-P22-11) — the Expo entry point STUB.
 *
 * This file is device-side glue: it lives in the dir the pnpm workspace never
 * installs (see ../README.md), outside apps/mobile/tsconfig.json, and outside
 * every sandbox compile gate. EAS CI (.github/workflows/mobile-release.yml,
 * T-P22-4-a) installs the expo toolchain and compiles this file; the dev
 * sandbox validates the structure via `pnpm check:mobile-shell`.
 *
 * The app ENTRY is this file: apps/mobile/package.json "main" points here
 * (metro resolves the entry from the project-root package.json) — the
 * library surface stays on the "exports" map ("." → ./src/index.ts), so
 * workspace consumers are unaffected by the entry wiring.
 *
 * TODO(DR-P22-01 / DR-P22-11 — the navigation + driver glue, the screen
 * waves' follow-up): register here, in this order —
 *   1. the navigation registry: SCREEN_REGISTRY from ../src/screens — the
 *      tab-bar navigation glue over the registered screens (fieldsales /
 *      companion / personal / rejection areas), plus the release-policy
 *      entry gate: evaluateReleasePolicy from ../src/release blocks the
 *      first run with the force-update screen when the build is below the
 *      published minVersion;
 *   2. the drivers registry (./drivers — the device implementations of the
 *      src/ ports, per ../drivers/README.md):
 *      sqlite, secure-store, unlock, trust, notifications + fcm,
 *      background-scheduler, barcode-scanner;
 *   3. I18nManager.forceRTL from the resolved locale (../src/i18n — the
 *      port boundary: direction is forced HERE, never inside src/);
 *   4. the background-fetch sync task (../src/sync host, scheduled via
 *      expo-background-fetch + expo-task-manager, ≤ 15 min, Doze-aware).
 * Until then this stub only proves the entry-point shape.
 */
import { registerRootComponent } from "expo";
import { Text, View } from "react-native";

function App() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>ERP Field — native shell stub (DR-P22-01)</Text>
    </View>
  );
}

registerRootComponent(App);

export default App;
