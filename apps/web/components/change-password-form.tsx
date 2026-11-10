"use client";

/**
 * Password change: POST /api/bff/identity/password-change { current, next }.
 * The API revokes all other sessions and keeps this one alive. A 400/422
 * VALIDATION_ERROR here means the current password did not verify (the
 * client already enforces the ≥ 10-char policy on `next`).
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ChangedResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedApiError } from "../lib/messages";
import { ErrorNotice, SuccessNotice } from "./notices";

const MIN_PASSWORD_LENGTH = 10;

export function ChangePasswordForm({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(null);
    setError(null);
    if (current === "" || next.length < MIN_PASSWORD_LENGTH) {
      setError(`${d.passwordNextHint} ${d.errorsValidation}`);
      return;
    }
    setBusy(true);
    const result = await bffFetch<ChangedResult>("identity/password-change", {
      method: "POST",
      body: { current, next },
    });
    setBusy(false);
    if (result.ok) {
      setNotice(d.passwordSuccess);
      setCurrent("");
      setNext("");
      return;
    }
    if (result.error.code === "VALIDATION_ERROR") {
      setError(d.passwordErrorCurrent);
      return;
    }
    setError(localizedApiError(d, result.error, result.retryAfterSeconds));
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-subtle bg-surface-card p-4 shadow-e1"
    >
      <Input
        id="change-current"
        label={d.passwordCurrentLabel}
        type="password"
        name="current"
        autoComplete="current-password"
        required
        value={current}
        onValueChange={setCurrent}
      />
      <Input
        id="change-next"
        label={d.passwordNextLabel}
        type="password"
        name="next"
        autoComplete="new-password"
        required
        hint={d.passwordNextHint}
        value={next}
        onValueChange={setNext}
      />
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {d.passwordSubmit}
        </Button>
      </div>
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </form>
  );
}
