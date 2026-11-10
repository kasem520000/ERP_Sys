"use client";

/**
 * MFA setup (Settings archetype sections):
 *  1. enroll  → POST /api/bff/identity/mfa/totp/enroll (secret + otpauth);
 *  2. verify  → POST /api/bff/identity/mfa/totp/verify { code };
 *  3. recovery codes → POST /api/bff/identity/mfa/recovery-codes
 *     (shown ONCE; the API stores only hashes).
 *
 * PHASE-024 T4: `enforced` renders the policy-mandated notice banner — the
 * user arrived through the enrollment bootstrap (a 15-minute session that
 * ONLY the MFA endpoints answer; every other API call is 423 until a TOTP
 * verify passes, which also flips the gate for the live sessions).
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ConfirmedResult, MfaEnrollResult, RecoveryCodesResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedApiError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";

type Phase = "idle" | "enrolled" | "confirmed";

export function MfaPanel({ locale, enforced = false }: { locale: Locale; enforced?: boolean }): JSX.Element {
  const d = getDictionary(locale);
  const [phase, setPhase] = useState<Phase>("idle");
  const [enrollment, setEnrollment] = useState<MfaEnrollResult | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onEnroll(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await bffFetch<MfaEnrollResult>("identity/mfa/totp/enroll", { method: "POST" });
    setBusy(false);
    if (result.ok) {
      setEnrollment(result.data);
      setPhase("enrolled");
      setCodes(null);
      return;
    }
    setError(localizedApiError(d, result.error, result.retryAfterSeconds));
  }

  async function onVerify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await bffFetch<ConfirmedResult>("identity/mfa/totp/verify", {
      method: "POST",
      body: { code },
    });
    setBusy(false);
    if (result.ok) {
      setPhase("confirmed");
      setNotice(d.mfaVerified);
      setCode("");
      return;
    }
    if (result.error.code === "VALIDATION_ERROR") {
      setError(d.mfaInvalidCode);
      return;
    }
    setError(localizedApiError(d, result.error, result.retryAfterSeconds));
  }

  async function onRecoveryCodes(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await bffFetch<RecoveryCodesResult>("identity/mfa/recovery-codes", {
      method: "POST",
    });
    setBusy(false);
    if (result.ok) {
      setCodes(result.data.codes);
      return;
    }
    if (result.error.code === "NOT_FOUND") {
      setError(d.mfaNeedConfirmed);
      return;
    }
    setError(localizedApiError(d, result.error, result.retryAfterSeconds));
  }

  return (
    <div className="flex flex-col gap-4">
      {enforced && (
        <p
          role="note"
          className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm font-medium text-warning-text"
        >
          {d.mfaEnforcedNotice}
        </p>
      )}
      <p className="text-sm text-gray-600">{d.mfaDescription}</p>

      <Card title={d.mfaEnrollTitle} ariaLabel={d.mfaEnrollTitle}>
        <Button variant="primary" loading={busy} onClick={() => void onEnroll()}>
          {d.mfaEnrollButton}
        </Button>
      </Card>

      {phase !== "idle" && enrollment !== null && (
        <Card title={d.mfaVerifyTitle} ariaLabel={d.mfaVerifyTitle}>
          <div className="flex flex-col gap-4">
            <Input
              id="mfa-secret"
              label={d.mfaSecretLabel}
              value={enrollment.secret}
              readOnly
              mono
              bidiIsolate
            />
            <Input
              id="mfa-otpauth"
              label={d.mfaOtpauthLabel}
              value={enrollment.otpauth}
              readOnly
              mono
              bidiIsolate
            />
            <p className="text-xs text-gray-600">{d.mfaEnrollHint}</p>
            <form onSubmit={onVerify} noValidate className="flex flex-col gap-3">
              <Input
                id="mfa-code"
                label={d.mfaVerifyCodeLabel}
                type="text"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                mono
                bidiIsolate
                value={code}
                onValueChange={setCode}
              />
              <div>
                <Button type="submit" variant="primary" loading={busy}>
                  {d.mfaVerifySubmit}
                </Button>
              </div>
            </form>
          </div>
        </Card>
      )}

      <Card title={d.mfaRecoveryTitle} description={d.mfaRecoveryDescription} ariaLabel={d.mfaRecoveryTitle}>
        <div className="flex flex-col gap-3">
          <div>
            <Button variant="secondary" loading={busy} onClick={() => void onRecoveryCodes()}>
              {codes === null ? d.mfaRecoveryGenerate : d.mfaRecoveryRegenerate}
            </Button>
          </div>
          {codes !== null && (
            <ol
              aria-live="polite"
              className="grid grid-cols-1 gap-1 rounded-md border border-subtle bg-surface-sunken p-3 sm:grid-cols-2"
            >
              {codes.map((recoveryCode) => (
                <li key={recoveryCode} className="font-mono text-sm tabular-nums text-gray-900">
                  {recoveryCode}
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );
}
