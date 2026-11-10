/**
 * P5-T12 — Public (unauthenticated) shell for login / forgot-password /
 * accept-invitation / register: token background, slim brand bar with the
 * locale switch, and a centered card surface (no sidebar — no session yet).
 * T19-WEB (PHASE-014): `layout="page"` swaps the centered card for a wide
 * plain main (the marketing pricing page); default keeps the card surface
 * every existing public page uses.
 */
import type { JSX, ReactNode } from "react";

import { getDictionary, otherLocale, type Locale } from "../i18n/dictionaries";

export function PublicShell({
  locale,
  pagePath,
  title,
  layout = "card",
  children,
}: {
  locale: Locale;
  pagePath: string;
  title: string;
  /** "card" = centered max-w-lg card (default); "page" = wide plain surface. */
  layout?: "card" | "page";
  children: ReactNode;
}): JSX.Element {
  const d = getDictionary(locale);
  const other = otherLocale(locale);

  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      <header className="flex items-center justify-between border-b border-subtle bg-surface-card px-4 py-2">
        <span className="text-md font-semibold text-primary-900">{d.appTitle}</span>
        <a
          lang={other}
          hrefLang={other}
          href={`/${other}/${pagePath}`}
          className="rounded-md px-2 py-1 text-sm text-gray-700 underline-offset-2 outline-none hover:bg-surface-sunken hover:underline"
        >
          {d.switchLabel}
        </a>
      </header>
      <main className="flex flex-1 px-4 py-8">
        {layout === "card" ? (
          <div className="flex w-full flex-1 items-center justify-center">
            <div className="w-full max-w-lg">
              <div className="rounded-lg border border-subtle bg-surface-card p-6 shadow-e3">
                <h1 lang={locale} className="text-lg font-semibold text-gray-900">
                  {title}
                </h1>
                <div className="mt-4 flex flex-col gap-4">{children}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <h1 lang={locale} className="text-2xl font-semibold text-gray-900">
              {title}
            </h1>
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
