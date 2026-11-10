"use client";

/**
 * P6-T11a — partner addresses list + add form (detail tab): BILLING/SHIPPING/
 * OTHER typed rows; adding POSTs `partners/partners/:id/addresses` and
 * refreshes the route.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent, JSX } from "react";

import { Button, DataTable, Input, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PartnerAddressRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

function localizedAddressType(type: string, d: ReturnType<typeof getDictionary>): string {
  if (type === "BILLING") return d.addressTypeBilling;
  if (type === "SHIPPING") return d.addressTypeShipping;
  return d.addressTypeOther;
}

export function PartnerAddresses({
  locale,
  partnerId,
  rows,
}: {
  locale: Locale;
  partnerId: string;
  rows: readonly PartnerAddressRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const [type, setType] = useState("BILLING");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (line1.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = { type, line1: line1.trim() };
    if (line2.trim() !== "") body.line2 = line2.trim();
    if (city.trim() !== "") body.city = city.trim();
    if (countryCode.trim() !== "") body.countryCode = countryCode.trim().toUpperCase();
    const result = await bffFetch<PartnerAddressRow>(`partners/partners/${partnerId}/addresses`, {
      method: "POST",
      body,
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.partnerSavedToast });
    setLine1("");
    setLine2("");
    setCity("");
    setCountryCode("");
    router.refresh();
  }

  return (
    <Card title={d.partnerAddressesTitle} ariaLabel={d.partnerAddressesTitle}>
      <DataTable
        columns={[
          {
            id: "type",
            header: activeLocaleHeader(d.addressTypeLabel),
            accessor: (row) => row.type,
            render: (row) => localizedAddressType(row.type, d),
          },
          {
            id: "line1",
            header: activeLocaleHeader(d.partnerAddressLine1Label),
            accessor: (row) => row.line1,
          },
          {
            id: "line2",
            header: activeLocaleHeader(d.partnerAddressLine2Label),
            accessor: (row) => row.line2 ?? "",
            render: (row) =>
              row.line2 === null || row.line2 === "" ? <span className="text-gray-500">—</span> : row.line2,
          },
          {
            id: "city",
            header: activeLocaleHeader(d.partnerAddressCityLabel),
            accessor: (row) => row.city ?? "",
          },
          {
            id: "country",
            header: activeLocaleHeader(d.partnerAddressCountryLabel),
            accessor: (row) => row.countryCode ?? "",
            mono: true,
          },
        ]}
        rows={[...rows]}
        rowKey={(row) => row.id}
        empty={{ title: d.partnerAddressesEmpty }}
      />
      <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-3 sm:grid-cols-2">
        <Select
          id="address-type"
          label={d.addressTypeLabel}
          value={type}
          onValueChange={setType}
          options={[
            { value: "BILLING", label: d.addressTypeBilling },
            { value: "SHIPPING", label: d.addressTypeShipping },
            { value: "OTHER", label: d.addressTypeOther },
          ]}
          required
        />
        <Input
          id="address-line1"
          label={d.partnerAddressLine1Label}
          value={line1}
          onValueChange={setLine1}
          required
        />
        <Input
          id="address-line2"
          label={d.partnerAddressLine2Label}
          value={line2}
          onValueChange={setLine2}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            id="address-city"
            label={d.partnerAddressCityLabel}
            value={city}
            onValueChange={setCity}
          />
          <Input
            id="address-country"
            label={d.partnerAddressCountryLabel}
            value={countryCode}
            onValueChange={(value) => setCountryCode(value.toUpperCase())}
            mono
            bidiIsolate
            hint="SA"
          />
        </div>
        <div className="sm:col-span-2 flex items-center justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            {d.partnerAddressAdd}
          </Button>
        </div>
      </form>
      {error !== null && <ErrorNotice className="mt-3">{error}</ErrorNotice>}
    </Card>
  );
}
