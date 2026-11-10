"use client";

/**
 * P4-T12a — branch activate/deactivate toggle.
 * PATCH /api/bff/tenancy/branches/:id { isActive: !current }.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JSX } from "react";

import { Button } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BranchRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedTenancyError } from "../lib/messages";

export function BranchToggleButton({
  locale,
  branchId,
  isActive,
}: {
  locale: Locale;
  branchId: string;
  isActive: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await bffFetch<BranchRow>(`tenancy/branches/${encodeURIComponent(branchId)}`, {
      method: "PATCH",
      body: { isActive: !isActive },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <Button
        variant={isActive ? "danger" : "secondary"}
        size="sm"
        loading={busy}
        onClick={() => void onToggle()}
      >
        {isActive ? d.branchesDeactivate : d.branchesActivate}
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      )}
    </span>
  );
}
