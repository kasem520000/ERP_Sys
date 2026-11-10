import type { Metadata } from "next";
import type { JSX, ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale, locales, type Locale } from "../../i18n/dictionaries";
import "../globals.css";

/**
 * Root layout with locale-driven direction (PHASE-001 §4: "<html lang dir>
 * wired for AR/EN switch demo"). The design system replaces these skeleton
 * styles in PHASE-005.
 */

export function generateStaticParams(): Array<{ locale: Locale }> {
  return locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  title: "Universal Business ERP Platform",
  description: "Multi-tenant, multi-industry SaaS ERP for MENA/GCC — Arabic-first.",
};

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
