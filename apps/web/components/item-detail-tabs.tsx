"use client";

/**
 * PHASE-043 (T-14 erratum) — the item-detail tab strip bridge. The house
 * rule (P5-T12, apps/web/lib/cx.ts): a server-module VALUE import of the
 * @erp/ui barrel pulls client-context modules (createContext/useEffect
 * without a client boundary) into the RSC graph and fails the Turbopack
 * build, so server pages reach interactive overlays through app-side
 * client bridges — the same shape every workspace component uses. This
 * one carries the item card's detail tabs: the general surface verbatim
 * and the PHASE-043 planning slot; children cross the boundary as
 * server-rendered ReactNode (the data-slot mapping stays inside Tabs).
 */
import type { JSX, ReactNode } from "react";

import { Tabs, type TabItem } from "@erp/ui";

export function ItemDetailTabs({
  items,
  children,
}: {
  items: TabItem[];
  children: ReactNode;
}): JSX.Element {
  return <Tabs items={items}>{children}</Tabs>;
}
