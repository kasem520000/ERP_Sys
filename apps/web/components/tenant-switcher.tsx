"use client";

/**
 * Tenant switcher: PUT /api/bff/session { tenantId } — the BFF rotates the
 * session server-side and reissues the cookies; a full router refresh
 * re-renders every server component under the new tenant context.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JSX } from "react";

import { Badge, Button } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import { bffFetch } from "../lib/client-api";
import { localizedApiError } from "../lib/messages";
import { ErrorNotice } from "./notices";

export interface TenantOption {
  tenantId: string;
  label: string;
  /** ACTIVE membership in an ACTIVE tenant — the only switchable state. */
  switchable: boolean;
  isActive: boolean;
  statusText: string;
}

export function TenantSwitcher({
  locale,
  options,
  activeTenantId,
}: {
  locale: Locale;
  options: TenantOption[];
  activeTenantId: string | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(tenantId: string): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await bffFetch("session", { method: "PUT", body: { tenantId } });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    setError(localizedApiError(d, result.error, result.retryAfterSeconds));
  }

  if (options.length === 0) {
    return <p className="text-sm text-gray-600">—</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={d.homeSwitchTenant} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.tenantId === activeTenantId;
          return (
            <Button
              key={option.tenantId}
              variant="secondary"
              disabled={busy || isActive || !option.switchable}
              onClick={() => {
                void switchTo(option.tenantId);
              }}
            >
              <span className="max-w-56 truncate">{option.label}</span>
              <Badge tone={isActive ? "primary" : "neutral"}>{option.statusText}</Badge>
            </Button>
          );
        })}
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );
}
