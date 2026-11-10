"use client";

/**
 * T19-WEB (PHASE-014) — the notifications center (self plane; PHASE-014 §2.8):
 * the in-app inbox (list, unread filter toggle, mark-read on click via
 * PATCH /notifications/:id/read), row-carried bilingual content (no dictionary
 * for content — only for chrome), severity chips (info=neutral, warning=amber,
 * critical=red), action buttons (internal actionUrl via locale-prefixed link,
 * external via anchor), the per-category preferences panel (4 categories ×
 * in-app/email — Switch controls, PUT per change, optimistic with rollback),
 * and a 60s poll that refreshes the list + unread count while the page is
 * open (aria-live status line). The routes stay usable during read-only
 * grace upstream (inbox management is exempt).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { Switch } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  NotificationPrefRow,
  NotificationRow,
  UnreadCountData,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, formatMessage, localizedApiError } from "../lib/messages";
import { cx } from "../lib/cx";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";

type Category = NotificationPrefRow["category"];
const CATEGORIES: readonly Category[] = [
  "limits",
  "subscription",
  "reconciliation",
  "invoice_overdue",
];

type Severity = NotificationRow["severity"];

function severityChipClass(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "border-danger-border bg-danger-bg text-danger-text";
    case "warning":
      return "border-warning-border bg-warning-bg text-warning-text";
    default:
      return "border-subtle bg-gray-100 text-gray-600";
  }
}

/** Internal actionUrls ride the locale prefix; external ones anchor out. */
function isInternalUrl(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

export function NotificationsCenter({
  locale,
  initialRows,
  initialPrefs,
}: {
  locale: Locale;
  initialRows: readonly NotificationRow[];
  initialPrefs: readonly NotificationPrefRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly NotificationRow[]>(initialRows);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Preferences: absent categories = both channels ON (the API default).
  const [prefs, setPrefs] = useState<Record<Category, { inApp: boolean; email: boolean }>>(() => {
    const base = {} as Record<Category, { inApp: boolean; email: boolean }>;
    for (const category of CATEGORIES) {
      const row = initialPrefs.find((pref) => pref.category === category);
      base[category] = row !== undefined ? { inApp: row.inApp, email: row.email } : { inApp: true, email: true };
    }
    return base;
  });
  // The latest refresh in flight guard (poll + manual refresh share it).
  const refreshing = useRef(false);

  const refresh = useCallback(
    async (filterUnread: boolean): Promise<void> => {
      if (refreshing.current) {
        return;
      }
      refreshing.current = true;
      setBusy(true);
      const [list, count] = await Promise.all([
        bffFetch<readonly NotificationRow[]>(
          `notifications?unread=${filterUnread ? "true" : "false"}&limit=50`,
        ),
        bffFetch<UnreadCountData>("notifications/unread-count"),
      ]);
      refreshing.current = false;
      setBusy(false);
      if (!list.ok) {
        setError(localizedApiError(d, list.error, list.retryAfterSeconds));
        return;
      }
      setError(null);
      setRows(list.data);
      if (count.ok) {
        setUnreadCount(count.data.count);
      }
      setSyncedAt(new Date().toISOString());
    },
    [d],
  );

  // Poll every 60s while the page is open (PHASE-014 §2.8).
  useEffect(() => {
    void refresh(unreadOnly);
    const timer = window.setInterval(() => {
      void refresh(unreadOnly);
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, unreadOnly]);

  const shownRows = useMemo(
    () => (unreadOnly ? rows.filter((row) => row.readAt === null) : rows),
    [rows, unreadOnly],
  );

  /** Mark-read on click — optimistic, rolled back on failure. */
  async function markRead(row: NotificationRow): Promise<void> {
    if (row.readAt !== null) {
      return;
    }
    const before = rows;
    setRows((current) =>
      current.map((candidate) =>
        candidate.id === row.id ? { ...candidate, readAt: new Date().toISOString() } : candidate,
      ),
    );
    if (unreadCount !== null && unreadCount > 0) {
      setUnreadCount(unreadCount - 1);
    }
    const result = await bffFetch<{ read: boolean }>(`notifications/${encodeURIComponent(row.id)}/read`, {
      method: "PATCH",
      body: {},
    });
    if (!result.ok) {
      setRows(before); // rollback
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
    }
  }

  /** PUT per change — optimistic with rollback (preferences suppress only). */
  async function togglePref(category: Category, channel: "inApp" | "email", next: boolean): Promise<void> {
    const before = prefs;
    setPrefs((current) => ({ ...current, [category]: { ...current[category], [channel]: next } }));
    const result = await bffFetch<{ saved: boolean }>("notifications/preferences", {
      method: "PUT",
      body: {
        category,
        inApp: channel === "inApp" ? next : prefs[category].inApp,
        email: channel === "email" ? next : prefs[category].email,
      },
    });
    if (!result.ok) {
      setPrefs(before); // rollback
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setError(null);
    setNotice(d.notificationsPrefsSaved);
  }

  const categoryLabel = (category: Category): string => {
    switch (category) {
      case "limits":
        return d.notificationsCategoryLimits;
      case "subscription":
        return d.notificationsCategorySubscription;
      case "reconciliation":
        return d.notificationsCategoryReconciliation;
      case "invoice_overdue":
        return d.notificationsCategoryInvoiceOverdue;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => {
              setUnreadOnly((current) => !current);
            }}
            className={cx(
              "inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium outline-none transition-colors duration-150 ease-standard",
              unreadOnly
                ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
                : "border-default bg-surface-card text-gray-800 hover:border-strong hover:bg-surface-sunken",
            )}
          >
            {d.notificationsUnreadOnly}
          </button>
          <button
            type="button"
            onClick={() => void refresh(unreadOnly)}
            disabled={busy}
            className="inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-4 text-sm font-medium text-gray-800 outline-none hover:border-strong hover:bg-surface-sunken disabled:opacity-60"
          >
            {d.notificationsRefresh}
          </button>
        </div>
        <p aria-live="polite" className="text-xs text-gray-500">
          {unreadCount !== null ? formatMessage(d.notificationsSyncLine, { count: unreadCount }) : ""}
          {syncedAt !== null ? ` — ${formatDateTime(syncedAt, locale)}` : ""}
        </p>
      </div>

      <section aria-labelledby="notifications-inbox-heading" className="flex flex-col gap-3">
        <h2 id="notifications-inbox-heading" className="text-md font-semibold text-gray-900">
          {d.notificationsInboxHeading}
        </h2>
        {shownRows.length === 0 ? (
          <p className="text-sm text-gray-600">{d.notificationsEmpty}</p>
        ) : (
          <ul className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
            {shownRows.map((row) => {
              const actionInternal =
                row.actionUrl !== null && row.actionLabel !== null && isInternalUrl(row.actionUrl);
              return (
                <li key={row.id}>
                  <article
                    className={cx(
                      "flex flex-col gap-2 rounded-lg border p-4",
                      row.readAt === null
                        ? "border-subtle bg-surface-card shadow-e1"
                        : "border-subtle bg-surface-sunken",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cx(
                          "inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4",
                          severityChipClass(row.severity),
                        )}
                      >
                        {row.severity}
                      </span>
                      <span className="text-sm font-semibold text-gray-900">
                        {row.title[locale]}
                      </span>
                      <span dir="ltr" className="font-mono text-xs text-gray-500">
                        {formatDateTime(row.createdAt, locale)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{row.body[locale]}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      {row.readAt === null ? (
                        <button
                          type="button"
                          onClick={() => void markRead(row)}
                          className="inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-4 text-sm font-medium text-gray-800 outline-none hover:border-strong hover:bg-surface-sunken"
                        >
                          {d.notificationsMarkRead}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">
                          {d.notificationsReadAt} {formatDateTime(row.readAt, locale)}
                        </span>
                      )}
                      {row.actionLabel !== null &&
                        row.actionUrl !== null &&
                        (actionInternal ? (
                          <a
                            href={`/${locale}${row.actionUrl}`}
                            onClick={() => void markRead(row)}
                            className="inline-flex min-h-11 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-white outline-none hover:bg-primary-700"
                          >
                            {row.actionLabel[locale]}
                          </a>
                        ) : (
                          <a
                            href={row.actionUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => void markRead(row)}
                            className="inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-4 text-sm font-medium text-gray-800 outline-none hover:border-strong hover:bg-surface-sunken"
                          >
                            {row.actionLabel[locale]} ↗
                          </a>
                        ))}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Card title={d.notificationsPrefsTitle} ariaLabel={d.notificationsPrefsTitle}>
        <p className="mb-4 max-w-xl text-sm text-gray-600">{d.notificationsPrefsHint}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 border-collapse text-sm">
            <thead>
              <tr className="border-b border-subtle">
                <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                  {d.notificationsPrefsCategory}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                  {d.notificationsPrefsInApp}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                  {d.notificationsPrefsEmail}
                </th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((category) => (
                <tr key={category} className="border-t border-subtle">
                  <th scope="row" className="px-3 py-2 text-start font-normal text-gray-700">
                    {categoryLabel(category)}
                  </th>
                  <td className="px-3 py-2">
                    <Switch
                      label={<span className="sr-only">{`${categoryLabel(category)} — ${d.notificationsPrefsInApp}`}</span>}
                      checked={prefs[category].inApp}
                      onCheckedChange={(checked) => void togglePref(category, "inApp", checked)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Switch
                      label={<span className="sr-only">{`${categoryLabel(category)} — ${d.notificationsPrefsEmail}`}</span>}
                      checked={prefs[category].email}
                      onCheckedChange={(checked) => void togglePref(category, "email", checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
