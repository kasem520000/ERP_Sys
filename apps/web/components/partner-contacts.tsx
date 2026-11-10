"use client";

/**
 * P6-T11a — partner contacts list + add form (detail tab): rows arrive
 * server-fetched; adding POSTs `partners/partners/:id/contacts` through the
 * BFF client wrapper and refreshes the route (server re-renders the list).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent, JSX } from "react";

import { Button, Checkbox, DataTable, Input, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PartnerContactRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function PartnerContacts({
  locale,
  partnerId,
  rows,
}: {
  locale: Locale;
  partnerId: string;
  rows: readonly PartnerContactRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (name.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = { name: name.trim() };
    if (phone.trim() !== "") body.phone = phone.trim();
    if (email.trim() !== "") body.email = email.trim();
    if (role.trim() !== "") body.role = role.trim();
    if (isPrimary) body.isPrimary = true;
    const result = await bffFetch<PartnerContactRow>(`partners/partners/${partnerId}/contacts`, {
      method: "POST",
      body,
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.partnerSavedToast });
    setName("");
    setPhone("");
    setEmail("");
    setRole("");
    setIsPrimary(false);
    router.refresh();
  }

  return (
    <Card title={d.partnerContactsTitle} ariaLabel={d.partnerContactsTitle}>
      <DataTable
        columns={[
          {
            id: "name",
            header: activeLocaleHeader(d.partnerContactNameLabel),
            accessor: (row) => row.name,
          },
          {
            id: "phone",
            header: activeLocaleHeader(d.partnerContactPhoneLabel),
            accessor: (row) => row.phone ?? "",
            mono: true,
            render: (row) =>
              row.phone === null || row.phone === "" ? (
                <span className="text-gray-500">—</span>
              ) : (
                row.phone
              ),
          },
          {
            id: "email",
            header: activeLocaleHeader(d.partnerContactEmailLabel),
            accessor: (row) => row.email ?? "",
            render: (row) =>
              row.email === null || row.email === "" ? (
                <span className="text-gray-500">—</span>
              ) : (
                row.email
              ),
          },
          {
            id: "role",
            header: activeLocaleHeader(d.partnerContactRoleLabel),
            accessor: (row) => row.role ?? "",
          },
          {
            id: "primary",
            header: activeLocaleHeader(d.partnerContactPrimaryLabel),
            accessor: (row) => (row.isPrimary ? "1" : ""),
            render: (row) => (row.isPrimary ? d.partnerContactPrimaryLabel : "—"),
          },
        ]}
        rows={[...rows]}
        rowKey={(row) => row.id}
        empty={{ title: d.partnerContactsEmpty }}
      />
      <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-3 sm:grid-cols-2">
        <Input
          id="contact-name"
          label={d.partnerContactNameLabel}
          value={name}
          onValueChange={setName}
          required
        />
        <Input
          id="contact-phone"
          label={d.partnerContactPhoneLabel}
          value={phone}
          onValueChange={setPhone}
          mono
          bidiIsolate
        />
        <Input
          id="contact-email"
          label={d.partnerContactEmailLabel}
          value={email}
          onValueChange={setEmail}
          type="email"
          bidiIsolate
        />
        <Input
          id="contact-role"
          label={d.partnerContactRoleLabel}
          value={role}
          onValueChange={setRole}
        />
        <div className="flex items-end justify-between gap-3 sm:col-span-2">
          <Checkbox
            label={d.partnerContactPrimaryLabel}
            checked={isPrimary}
            onCheckedChange={(checked) => setIsPrimary(checked === true)}
          />
          <Button type="submit" variant="primary" loading={busy}>
            {d.partnerContactAdd}
          </Button>
        </div>
      </form>
      {error !== null && <ErrorNotice className="mt-3">{error}</ErrorNotice>}
    </Card>
  );
}
