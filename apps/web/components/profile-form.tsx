"use client";

/**
 * P4-T12a — tenant profile form. PUT /api/bff/tenancy/profile
 * { name?, nameAr?, timezone? } (IANA-validated server-side; a datalist of
 * common MENA zones is offered as suggestions). An empty Arabic name is
 * simply omitted (the API treats it as "leave unchanged").
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { TenantProfile } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedTenancyError } from "../lib/messages";
import { TIMEZONE_SUGGESTIONS } from "../lib/constants";
import { ErrorNotice, SuccessNotice } from "./notices";

export function ProfileForm({
  locale,
  initial,
}: {
  locale: Locale;
  initial: { name: string; nameAr: string | null; timezone: string };
}): JSX.Element {
  const d = getDictionary(locale);
  const [name, setName] = useState(initial.name);
  const [nameAr, setNameAr] = useState(initial.nameAr ?? "");
  const [timezone, setTimezone] = useState(initial.timezone);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(null);
    setError(null);
    if (name.trim() === "" || timezone.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    const body: Record<string, unknown> = { name: name.trim(), timezone: timezone.trim() };
    if (nameAr.trim() !== "") {
      body.nameAr = nameAr.trim();
    }
    setBusy(true);
    const result = await bffFetch<TenantProfile>("tenancy/profile", { method: "PUT", body });
    setBusy(false);
    if (!result.ok) {
      setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.settingsProfileSaved);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Input
        id="profile-name"
        label={d.settingsNameLabel}
        type="text"
        name="name"
        required
        value={name}
        onValueChange={setName}
      />
      <Input
        id="profile-name-ar"
        label={d.settingsNameArLabel}
        type="text"
        name="nameAr"
        value={nameAr}
        onValueChange={setNameAr}
      />
      <Input
        id="profile-timezone"
        label={d.settingsTimezoneLabel}
        type="text"
        name="timezone"
        required
        hint={TIMEZONE_SUGGESTIONS.slice(0, 3).join(" · ")}
        mono
        bidiIsolate
        value={timezone}
        onValueChange={setTimezone}
      />
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {d.settingsProfileSubmit}
        </Button>
      </div>
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </form>
  );
}
