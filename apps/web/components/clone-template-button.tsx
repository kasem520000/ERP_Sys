"use client";

/**
 * Clone a system role template into the tenant:
 * POST /api/bff/identity/roles/clone-template { templateKey }.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JSX } from "react";

import { Button } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { RoleRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedApiError } from "../lib/messages";

export function CloneTemplateButton({
  locale,
  templateKey,
  roleName,
}: {
  locale: Locale;
  templateKey: string;
  roleName: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClone(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await bffFetch<RoleRow>("identity/roles/clone-template", {
      method: "POST",
      body: { templateKey },
    });
    setBusy(false);
    if (result.ok) {
      setNotice(formatMessage(d.rolesCloned, { name: localRoleName(result.data) }));
      router.refresh();
      return;
    }
    setError(localizedApiError(d, result.error, result.retryAfterSeconds));
  }

  function localRoleName(role: RoleRow): string {
    return locale === "ar" && role.nameAr !== null && role.nameAr !== "" ? role.nameAr : role.name;
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <Button variant="secondary" size="sm" loading={busy} onClick={() => void onClone()}>
        {`${d.rolesClone} ${roleName}`}
      </Button>
      {notice !== null && (
        <p role="status" className="text-xs text-success-text">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      )}
    </span>
  );
}
