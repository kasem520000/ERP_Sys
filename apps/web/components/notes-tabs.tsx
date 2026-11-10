/**
 * PHASE-027 (wave F) — the notes module tab strip: the registry carries two
 * nav items (NAVIGATION_MODEL §1.1 `treasury.cheques-notes` +
 * `treasury.pdc-calendar`), so the module's sibling surfaces (register /
 * calendar / reports) navigate through this in-page strip — the same
 * one-item-many-screens shape fixed-assets uses. Pure presentational server
 * component; the active tab carries aria-current.
 */
import type { JSX } from "react";

import { getDictionary, type Locale } from "../i18n/dictionaries";

export function NotesTabs({
  locale,
  active,
}: {
  locale: Locale;
  active: "notes" | "calendar" | "reports";
}): JSX.Element {
  const d = getDictionary(locale);
  const tabs: Array<{ id: typeof active; href: string; label: string }> = [
    { id: "notes", href: `/${locale}/notes`, label: d.notesTitle },
    { id: "calendar", href: `/${locale}/notes/calendar`, label: d.notesCalendarTitle },
    { id: "reports", href: `/${locale}/notes/reports`, label: d.notesReportsTitle },
  ];
  return (
    <nav aria-label={d.navChequesNotes} className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) =>
        tab.id === active ? (
          <span
            key={tab.id}
            aria-current="page"
            className="rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-800"
          >
            {tab.label}
          </span>
        ) : (
          <a
            key={tab.id}
            href={tab.href}
            className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-700 outline-none hover:border-strong"
          >
            {tab.label}
          </a>
        ),
      )}
    </nav>
  );
}
