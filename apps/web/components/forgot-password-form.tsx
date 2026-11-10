"use client";

/**
 * Password-reset request: POST /api/bff/identity/password-resets (public,
 * no session → no CSRF echo needed). Always the same success message.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AcceptedResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedApiError } from "../lib/messages";
import { ErrorNotice, SuccessNotice } from "./notices";

export function ForgotPasswordForm({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await bffFetch<AcceptedResult>("identity/password-resets", {
      method: "POST",
      body: { email },
    });
    setBusy(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    setError(localizedApiError(d, result.error, result.retryAfterSeconds));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">{d.forgotDescription}</p>
      <Input
        id="forgot-email"
        label={d.forgotEmailLabel}
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onValueChange={setEmail}
      />
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {d.forgotSubmit}
        </Button>
      </div>
      {sent && <SuccessNotice>{d.forgotSuccess}</SuccessNotice>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </form>
  );
}
