"use client";

/**
 * P4-T12a — platform lifecycle panel (inline; reason is required by the API,
 * min 3 chars). POST /api/bff/platform/tenants/:id/suspend | /restore
 * { reason } — suspend also reports the killed session count (rule-6).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { RestoreResult, SuspendResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedTenancyError } from "../lib/messages";
import { ErrorNotice, SuccessNotice } from "./notices";

const MIN_REASON_LENGTH = 3;

export function PlatformLifecyclePanel({
  locale,
  tenantId,
  status,
}: {
  locale: Locale;
  tenantId: string;
  status: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSuspend = status === "ACTIVE";
  const canRestore = status === "SUSPENDED";

  async function onTransition(suspend: boolean): Promise<void> {
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(d.errorsValidation);
      return;
    }
    const path = `platform/tenants/${encodeURIComponent(tenantId)}/${suspend ? "suspend" : "restore"}`;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (suspend) {
      const result = await bffFetch<SuspendResult>(path, {
        method: "POST",
        body: { reason: reason.trim() },
      });
      setBusy(false);
      if (!result.ok) {
        setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setNotice(formatMessage(d.platformSuspendDone, { count: result.data.killedSessions }));
    } else {
      const result = await bffFetch<RestoreResult>(path, {
        method: "POST",
        body: { reason: reason.trim() },
      });
      setBusy(false);
      if (!result.ok) {
        setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setNotice(d.platformRestoreDone);
    }
    setReason("");
    router.refresh();
  }

  if (!canSuspend && !canRestore) {
    return <p className="text-sm text-gray-600">—</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-md">
          <Input
            id={`lifecycle-reason-${tenantId}`}
            label={d.platformReasonLabel}
            value={reason}
            onValueChange={setReason}
          />
        </div>
        <Button
          variant={canSuspend ? "danger" : "primary"}
          loading={busy}
          onClick={() => void onTransition(canSuspend)}
        >
          {canSuspend ? d.platformSuspendButton : d.platformRestoreButton}
        </Button>
      </div>
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );
}
