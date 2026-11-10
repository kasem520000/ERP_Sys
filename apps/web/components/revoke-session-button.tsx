"use client";

/**
 * Revoke a tenant session: POST /api/bff/identity/sessions/{id}/revoke.
 * If the revoked row is the caller's own session, the refreshed page
 * bounces to the login screen (401 → redirect server-side).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JSX } from "react";

import { Button } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { RevokedResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedApiError } from "../lib/messages";

export function RevokeSessionButton({
  locale,
  sessionId,
}: {
  locale: Locale;
  sessionId: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRevoke(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await bffFetch<RevokedResult>(
      `identity/sessions/${encodeURIComponent(sessionId)}/revoke`,
      { method: "POST" },
    );
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    setError(localizedApiError(d, result.error, result.retryAfterSeconds));
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <Button variant="danger" size="sm" loading={busy} onClick={() => void onRevoke()}>
        {d.sessionsRevoke}
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      )}
    </span>
  );
}
