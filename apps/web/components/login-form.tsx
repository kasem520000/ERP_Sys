"use client";

/**
 * Login form. Errors are localized by stable code:
 * INVALID_CREDENTIALS / MFA_REQUIRED (reveals the MFA field) /
 * RATE_LIMITED + Retry-After / UNAUTHENTICATED (= account lockout window).
 * T19-WEB (PHASE-014): optional `next` — an internal locale-prefixed path
 * the pricing CTAs pass through `login?next=…`; validated by the page, only
 * ever used for the post-login redirect (open-redirect safe by shape).
 * PHASE-024 T4: 423 MFA_REQUIRED with details.enrollmentRequired=true means
 * the organization's policy mandates MFA for the user's role and they have
 * no confirmed factor — the same credentials are exchanged for the 15-minute
 * enrollment-only session at the bootstrap BFF route, and the browser is
 * routed to the MFA enrollment page with ?enforced=1. The plain code-challenge
 * path (showMfa) is unchanged.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import { isRecord, type LoginResult, type MfaBootstrapResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedLoginError } from "../lib/messages";
import { ErrorNotice } from "./notices";

/** `error.details.enrollmentRequired === true` (the PHASE-024 423 shape). */
function enrollmentRequiredOf(details: unknown): boolean {
  return isRecord(details) && details.enrollmentRequired === true;
}

export function LoginForm({
  locale,
  next,
}: {
  locale: Locale;
  /** Internal post-login redirect target (already validated by the page). */
  next?: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showMfa, setShowMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, string> = { email, password };
    if (showMfa && mfaCode !== "") {
      body.mfaCode = mfaCode;
    }
    const result = await bffFetch<LoginResult>("session", { method: "POST", body });
    if (result.ok) {
      router.replace(next !== undefined && next !== "" ? next : `/${locale}`);
      router.refresh();
      return;
    }
    if (result.error.code === "MFA_REQUIRED" && enrollmentRequiredOf(result.error.details)) {
      // Policy-mandated enrollment: no factor exists, so no code can be
      // produced — exchange the same credentials for the enrollment-only
      // bootstrap session and route to the MFA page.
      await onEnforcedEnrollment();
      return;
    }
    if (result.error.code === "MFA_REQUIRED") {
      setShowMfa(true);
    }
    setError(localizedLoginError(d, result.error, result.retryAfterSeconds));
    setBusy(false);
  }

  /** PHASE-024 T4 — the enrollment bootstrap exchange (sets the cookies). */
  async function onEnforcedEnrollment(): Promise<void> {
    const bootstrap = await bffFetch<MfaBootstrapResult>("identity/mfa/bootstrap", {
      method: "POST",
      body: { email, password },
    });
    if (bootstrap.ok) {
      router.push(`/${locale}/mfa?enforced=1`);
      router.refresh();
      return;
    }
    if (bootstrap.error.code === "MFA_BOOTSTRAP_NOT_ELIGIBLE") {
      setError(d.loginErrorMfaBootstrapIneligible);
    } else {
      setError(localizedLoginError(d, bootstrap.error, bootstrap.retryAfterSeconds));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">{d.loginSubtitle}</p>
      <Input
        id="login-email"
        label={d.loginEmailLabel}
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onValueChange={setEmail}
      />
      <Input
        id="login-password"
        label={d.loginPasswordLabel}
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onValueChange={setPassword}
      />
      {showMfa && (
        <Input
          id="login-mfa"
          label={d.loginMfaLabel}
          type="text"
          name="mfaCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          hint={d.loginMfaHint}
          mono
          value={mfaCode}
          onValueChange={setMfaCode}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy}>
          {d.loginSubmit}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setShowMfa(!showMfa);
          }}
        >
          {showMfa ? d.loginMfaHide : d.loginMfaShow}
        </Button>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </form>
  );
}
