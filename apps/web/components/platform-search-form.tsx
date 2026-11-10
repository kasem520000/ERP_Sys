"use client";

/**
 * P5-T12 — platform console search form: SearchInput + submit Button that
 * keeps the existing server-side GET flow (`?q=` URL state, back-preserves-
 * filters) via a router push instead of a native form submit.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, SearchInput } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";

export function PlatformSearchForm({
  locale,
  initialQuery,
}: {
  locale: Locale;
  initialQuery: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(`/${locale}/platform${trimmed === "" ? "" : `?q=${encodeURIComponent(trimmed)}`}`);
  }

  return (
    <form role="search" onSubmit={onSubmit} className="flex w-full max-w-md items-center gap-2">
      <SearchInput
        value={query}
        onValueChange={setQuery}
        label={d.platformSearchLabel}
        placeholder={d.platformSearchLabel}
        className="w-full"
      />
      <Button type="submit" variant="secondary">
        {d.platformSearchSubmit}
      </Button>
    </form>
  );
}
