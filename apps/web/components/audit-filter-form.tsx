"use client";

/**
 * P5-T12 — platform audit filter form: platformOnly Checkbox + tenant/action
 * Inputs + Apply. Submits through the router so the filters stay URL-encoded
 * (cursor pagination preserves them server-side).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Checkbox, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";

export function AuditFilterForm({
  locale,
  initial,
}: {
  locale: Locale;
  initial: { platformOnly: boolean; tenantId: string; action: string };
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [platformOnly, setPlatformOnly] = useState(initial.platformOnly);
  const [tenantId, setTenantId] = useState(initial.tenantId);
  const [action, setAction] = useState(initial.action);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams();
    if (platformOnly) {
      params.set("platformOnly", "true");
    }
    if (tenantId.trim() !== "") {
      params.set("tenantId", tenantId.trim());
    }
    if (action.trim() !== "") {
      params.set("action", action.trim());
    }
    const search = params.toString();
    router.push(`/${locale}/platform/audit${search === "" ? "" : `?${search}`}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
      <Checkbox
        label={d.platformAuditPlatformOnly}
        checked={platformOnly}
        onCheckedChange={(checked) => setPlatformOnly(checked === true)}
      />
      <div className="w-full max-w-xs">
        <Input
          label={d.platformAuditTenantFilter}
          value={tenantId}
          onValueChange={setTenantId}
          mono
          bidiIsolate
        />
      </div>
      <div className="w-full max-w-xs">
        <Input
          label={d.platformAuditActionFilter}
          value={action}
          onValueChange={setAction}
          mono
          bidiIsolate
        />
      </div>
      <Button type="submit" variant="primary">
        {d.platformAuditApply}
      </Button>
    </form>
  );
}
