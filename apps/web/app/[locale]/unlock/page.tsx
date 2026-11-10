"use client";
/**
 * PHASE-021 T2-b (DR-P21-06/§6; DR-P21-07): the unlock screen route — the
 * shell loads this screen first (tauri.conf.json app.windows[0].url):
 * the journey is unlock → offline console (MASTER-PLAN §6). Client page,
 * zero server-only dependencies (web-shell-no-server), PublicShell
 * chrome, the cached permission-snapshot decision (D-04).
 */
import { use } from "react";
import type { JSX } from "react";

import { UnlockScreen } from "../../../components/offline/unlock-screen";
import { PublicShell } from "../../../components/public-shell";
import { ShellBridgeProvider } from "../../../lib/shell/bridge";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";

export default function UnlockPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): JSX.Element {
  const { locale } = use(params);
  const active: Locale = isLocale(locale) ? locale : "ar";
  const d = getDictionary(active);

  return (
    <PublicShell locale={active} pagePath="unlock" title={d.unlockTitle} layout="card">
      <ShellBridgeProvider>
        <UnlockScreen locale={active} />
      </ShellBridgeProvider>
    </PublicShell>
  );
}
