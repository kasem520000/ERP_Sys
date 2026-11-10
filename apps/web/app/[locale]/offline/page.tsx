"use client";
/**
 * PHASE-021 T2-b (DR-P21-06/§6; DR-P21-07 — the desktop shell export): the
 * Offline Console route. A CLIENT page with zero server-only dependencies
 * (the depcruise rule `web-shell-no-server` forbids lib/bff*,
 * lib/server-api*, next/headers, server-only here — the export has no
 * Next server to run them on). The ShellBridgeProvider resolves the
 * bridge once; the console renders ONLINE-ONLY states when absent.
 */
import { use } from "react";
import type { JSX } from "react";

import { OfflineConsole } from "../../../components/offline/console";
import { PublicShell } from "../../../components/public-shell";
import { ShellBridgeProvider } from "../../../lib/shell/bridge";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";

export default function OfflinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): JSX.Element {
  const { locale } = use(params);
  const active: Locale = isLocale(locale) ? locale : "ar";
  const d = getDictionary(active);

  return (
    <PublicShell locale={active} pagePath="offline" title={d.offlineConsoleTitle} layout="page">
      <ShellBridgeProvider>
        <OfflineConsole locale={active} />
      </ShellBridgeProvider>
    </PublicShell>
  );
}
