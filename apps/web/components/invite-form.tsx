"use client";

/**
 * Invite form: POST /api/bff/identity/invitations { email, roleId }.
 * Dev has no browser-visible mail delivery, so the issued accept link
 * (acceptPath contains the token) is surfaced right in the UI.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { IssuedInvitation } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, localizedApiError } from "../lib/messages";
import { ErrorNotice, SuccessNotice } from "./notices";

export interface InviteRole {
  id: string;
  label: string;
  key: string;
}

function extractToken(acceptPath: string): string | null {
  const queryIndex = acceptPath.indexOf("?");
  if (queryIndex === -1) {
    return null;
  }
  const params = new URLSearchParams(acceptPath.slice(queryIndex + 1));
  const token = params.get("token");
  return token !== null && token !== "" ? token : null;
}

export function InviteForm({ locale, roles }: { locale: Locale; roles: InviteRole[] }): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles.length > 0 ? (roles[0]?.id ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ acceptHref: string; expiresAt: string } | null>(null);

  if (roles.length === 0) {
    return <p className="text-sm text-gray-600">{d.usersNoRoles}</p>;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (email === "" || roleId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    setError(null);
    setIssued(null);
    const result = await bffFetch<IssuedInvitation>("identity/invitations", {
      method: "POST",
      body: { email, roleId },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const token = extractToken(result.data.acceptPath);
    setIssued({
      acceptHref:
        token === null
          ? result.data.acceptPath
          : `/${locale}/accept-invitation?token=${encodeURIComponent(token)}`,
      expiresAt: result.data.expiresAt,
    });
    setEmail("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Input
        id="invite-email"
        label={d.usersInviteEmailLabel}
        type="email"
        name="email"
        autoComplete="off"
        required
        value={email}
        onValueChange={setEmail}
      />
      <Select
        id="invite-role"
        label={d.usersInviteRoleLabel}
        name="roleId"
        required
        value={roleId}
        onValueChange={setRoleId}
        options={roles.map((role) => ({ value: role.id, label: `${role.label} (${role.key})` }))}
      />
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {d.usersInviteSubmit}
        </Button>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {issued !== null && (
        <SuccessNotice className="flex flex-col gap-1">
          <span>{d.usersInviteLinkTitle}</span>
          <a href={issued.acceptHref} className="break-all font-mono text-xs underline">
            {issued.acceptHref}
          </a>
          <span className="text-xs">
            {d.usersInviteExpiresLabel} {formatDateTime(issued.expiresAt, locale)}
          </span>
        </SuccessNotice>
      )}
    </form>
  );
}
