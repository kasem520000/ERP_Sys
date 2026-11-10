"use client";

/**
 * T19-WEB (PHASE-014) — header bell affordance (PHASE-014 §2.8): fetches
 * /api/v1/notifications/unread-count on mount and on window focus (self
 * plane — session-authenticated, no permission), links to the notifications
 * inbox. The badge count is announced via aria-label; fetch failures degrade
 * silently (the inbox page is the authoritative surface, the server stays
 * the enforcer). ≥44px touch target; the registry ships no bell glyph, so
 * the "inbox" icon carries the affordance.
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { Icon } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { UnreadCountData } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage } from "../lib/messages";

export function NotificationBell({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await bffFetch<UnreadCountData>("notifications/unread-count");
    if (result.ok) {
      setCount(result.data.count);
    }
    // 401/403/network degrade silently — never break the shell for a badge
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const hasUnread = count !== null && count > 0;
  const label =
    count === null
      ? d.notificationsTitle
      : hasUnread
        ? `${d.notificationsTitle} — ${formatMessage(d.notificationsUnreadCount, { count })}`
        : d.notificationsTitle;

  return (
    <a
      href={`/${locale}/notifications`}
      aria-label={label}
      title={label}
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-md border border-default bg-surface-card text-gray-700 outline-none transition-colors duration-150 ease-standard hover:border-strong hover:bg-surface-sunken"
    >
      <Icon name="inbox" size={20} />
      {hasUnread && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -end-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-bg px-1 font-mono text-xs font-semibold leading-none text-danger-text"
        >
          {Math.min(count ?? 0, 99)}
        </span>
      )}
    </a>
  );
}
