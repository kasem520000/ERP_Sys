"use client";

/**
 * Invitation acceptance: POST /api/bff/session/accept { token, fullName,
 * password, locale } — on success the BFF sets the session cookie and the
 * user lands on the dashboard. Client-side the password must be ≥ 10 chars.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AcceptInvitationResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInvitationError } from "../lib/messages";
import { ErrorNotice } from "./notices";

const MIN_PASSWORD_LENGTH = 10;

export function AcceptInvitationForm({
  locale,
  token,
}: {
  locale: Locale;
  token: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (fullName === "" || password.length < MIN_PASSWORD_LENGTH) {
      setError(`${d.acceptPasswordHint} ${d.errorsValidation}`);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bffFetch<AcceptInvitationResult>("session/accept", {
      method: "POST",
      body: { token, fullName, password, locale },
    });
    if (result.ok) {
      router.replace(`/${locale}`);
      router.refresh();
      return;
    }
    setError(localizedInvitationError(d, result.error));
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Input
        id="accept-name"
        label={d.acceptFullNameLabel}
        type="text"
        name="fullName"
        autoComplete="name"
        required
        value={fullName}
        onValueChange={setFullName}
      />
      <Input
        id="accept-password"
        label={d.acceptPasswordLabel}
        type="password"
        name="password"
        autoComplete="new-password"
        required
        hint={d.acceptPasswordHint}
        value={password}
        onValueChange={setPassword}
      />
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {d.acceptSubmit}
        </Button>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </form>
  );
}
