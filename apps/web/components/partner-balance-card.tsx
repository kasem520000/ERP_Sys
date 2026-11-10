"use client";

/**
 * P6-T11b — partner balance card (detail page): the PHASE-006 read-model is
 * DRAFTS-only by contract (`basis: DRAFTS_ONLY`), so the card labels the
 * basis honestly — badge + note — alongside open/draft/overdue amounts
 * (canonical decimal strings formatted for display, SAR 2 minor units).
 */
import { Badge, formatMoneyDisplay } from "@erp/ui";
import type { JSX } from "react";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PartnerBalanceRow } from "../lib/api-types";
import { Card } from "./card";
import { DefList } from "./def-list";

export function PartnerBalanceCard({
  locale,
  balance,
}: {
  locale: Locale;
  balance: PartnerBalanceRow;
}): JSX.Element {
  const d = getDictionary(locale);
  return (
    <Card
      title={d.partnerBalanceTitle}
      description={d.partnerBalanceDraftNote}
      ariaLabel={d.partnerBalanceTitle}
    >
      <div className="flex items-center gap-2">
        <Badge tone="neutral">{d.partnerBalanceDraftBadge}</Badge>
      </div>
      <DefList
        className="mt-3"
        items={[
          {
            term: d.partnerBalanceOpenAmount,
            children: <span className="font-mono">{formatMoneyDisplay(balance.openBalance, 2)}</span>,
          },
          {
            term: d.partnerBalanceDraftLabel,
            children: (
              <span className="font-mono">{formatMoneyDisplay(balance.draftBalance, 2)}</span>
            ),
          },
          {
            term: d.partnerBalanceOverdueLabel,
            children: (
              <span className="font-mono">{formatMoneyDisplay(balance.overdueAmount, 2)}</span>
            ),
          },
        ]}
      />
    </Card>
  );
}
