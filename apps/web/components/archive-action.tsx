"use client";

/**
 * P6-T11b — record archive action (partner + item detail pages): a Dialog
 * confirm over the destructive POST `…/:id/archive`; success toasts and
 * routes back to the list, 409/403 surface the localized master-data error.
 * Pure pass-through of dictionary labels — no route-specific strings here.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Dialog, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError } from "../lib/messages";

export interface ArchiveActionLabels {
  button: string;
  confirmTitle: string;
  confirmBody: string;
  successToast: string;
}

export function ArchiveAction({
  locale,
  archiveEndpoint,
  redirectTo,
  labels,
  disabled,
  className,
}: {
  locale: Locale;
  /** BFF path of the destructive POST (e.g. `partners/partners/:id/archive`). */
  archiveEndpoint: string;
  /** Absolute app path to route to after a successful archive. */
  redirectTo: string;
  labels: ArchiveActionLabels;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await bffFetch(archiveEndpoint, { method: "POST" });
    setBusy(false);
    if (!result.ok) {
      setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setOpen(false);
    toast({ tone: "success", title: labels.successToast });
    router.push(redirectTo);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={labels.confirmTitle}
      description={labels.confirmBody}
      ariaLabel={labels.confirmTitle}
      trigger={
        <Button variant="secondary" disabled={disabled === true} className={className}>
          {labels.button}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {error !== null && (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void onConfirm()}>
            {labels.button}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
