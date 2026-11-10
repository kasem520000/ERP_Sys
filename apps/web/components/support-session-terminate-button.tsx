"use client";

/**
 * P4-T12a — tenant-side terminate of an ACTIVE opt-in support session.
 * DELETE /api/bff/tenancy/support-sessions/:id → { terminated: true };
 * 409 tenancy/support-session-not-active maps to the localized message.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JSX } from "react";

import { Button } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import { bffFetch } from "../lib/client-api";
import { localizedTenancyError } from "../lib/messages";

export interface TerminateResult {
  terminated: boolean;
}

export function SupportSessionTerminateButton({
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

  async function onTerminate(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await bffFetch<TerminateResult>(
      `tenancy/support-sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <Button variant="danger" size="sm" loading={busy} onClick={() => void onTerminate()}>
        {d.supportTerminate}
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      )}
    </span>
  );
}
