"use client";

/**
 * P6-T11a — ShellWithSearch: the client bridge that wires the CommandMenu to
 * the PHASE-006 trigram search endpoints. The server AppShell resolves the
 * navigation payload; THIS client component owns the debounced
 * (200ms, ≥2 chars) lazy fetch of `/api/bff/partners/search` +
 * `/api/bff/items/search` and feeds the grouped results into the @erp/ui
 * AppShell's additive remote-search props. 403s degrade silently (the user
 * simply sees navigation matches only) — server enforcement stays authoritative.
 */
import { useCallback, useRef, useState } from "react";
import type { JSX } from "react";

import {
  AppShell as UiAppShell,
  useDebouncedCallback,
  type AppShellProps,
  type CommandMenuRemoteGroup,
} from "@erp/ui";

import { getDictionary } from "../i18n/dictionaries";
import type { ItemRow, PartnerRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName } from "../lib/messages";

export function ShellWithSearch({
  locale,
  dir,
  navigation,
  activePath,
  brand,
  strings,
  userMenu,
  children,
}: Pick<
  AppShellProps,
  "locale" | "dir" | "navigation" | "activePath" | "brand" | "strings" | "userMenu" | "children"
>): JSX.Element {
  const d = getDictionary(locale);
  const [remoteGroups, setRemoteGroups] = useState<CommandMenuRemoteGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const latestQuery = useRef("");

  const runSearch = useCallback(
    async (query: string): Promise<void> => {
      setSearching(true);
      const [partners, items] = await Promise.all([
        bffFetch<readonly PartnerRow[]>(`partners/search?q=${encodeURIComponent(query)}`),
        bffFetch<readonly ItemRow[]>(`items/search?q=${encodeURIComponent(query)}`),
      ]);
      setSearching(false);
      if (latestQuery.current.trim() !== query.trim()) return; // stale response guard
      const groups: CommandMenuRemoteGroup[] = [];
      if (partners.ok && partners.data.length > 0) {
        groups.push({
          label: d.commandGroupPartners,
          items: partners.data.slice(0, 5).map((partner) => ({
            id: partner.id,
            label: `${localizedName(partner.name, partner.nameAr, locale)} · ${partner.code}`,
            href: `/${locale}/partners/${partner.id}`,
            icon: "users",
          })),
        });
      }
      if (items.ok && items.data.length > 0) {
        groups.push({
          label: d.commandGroupItems,
          items: items.data.slice(0, 5).map((item) => ({
            id: item.id,
            label: `${localizedName(item.name, item.nameAr, locale)} · ${item.sku}`,
            href: `/${locale}/inventory/items/${item.id}`,
            icon: "boxes",
          })),
        });
      }
      setRemoteGroups(groups);
    },
    [d, locale],
  );

  const debouncedSearch = useDebouncedCallback();

  const onCommandQuery = useCallback(
    (query: string): void => {
      latestQuery.current = query;
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        setRemoteGroups([]);
        return;
      }
      debouncedSearch(trimmed, 200, () => {
        void runSearch(trimmed);
      });
    },
    [debouncedSearch, runSearch],
  );

  return (
    <UiAppShell
      locale={locale}
      dir={dir}
      density="compact"
      navigation={navigation}
      activePath={activePath}
      brand={brand}
      strings={strings}
      userMenu={userMenu}
      onCommandQuery={onCommandQuery}
      commandRemoteGroups={remoteGroups}
      commandRemoteLoadingLabel={searching ? d.loading : undefined}
    >
      {children}
    </UiAppShell>
  );
}
