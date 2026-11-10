"use client";

/**
 * T15-UI (PHASE-009) — tax registrations (settings archetype): the
 * per-jurisdiction registration list (country, status badge, registration
 * number, effective window) + the upsert form (country select seeded from
 * the jurisdiction packs, status, number — shown only while REGISTERED —
 * and the effective-from date). Upserts are POST tax/tax-registrations;
 * the status/number pair is validated as a pair server-side.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { JurisdictionPackRow, TaxRegistrationRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedRegistrationStatus, localizedTaxError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const STATUS_OPTIONS = ["REGISTERED", "NOT_REGISTERED", "DEREGISTERED"] as const;

export function TaxRegistrations({
  locale,
  initialRegistrations,
  packs,
}: {
  locale: Locale;
  initialRegistrations: readonly TaxRegistrationRow[];
  packs: readonly JurisdictionPackRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [registrations, setRegistrations] =
    useState<readonly TaxRegistrationRow[]>(initialRegistrations);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Upsert form state.
  const [countryCode, setCountryCode] = useState("");
  const [status, setStatus] = useState<string>("REGISTERED");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));

  const countryOptions = useMemo(
    () =>
      packs.map((pack) => ({
        value: pack.countryCode,
        label: `${pack.countryCode} · ${localizedName(pack.countryName, pack.countryNameAr, locale)}`,
      })),
    [packs, locale],
  );

  const numberValid =
    registrationNumber.trim().length >= 3 && registrationNumber.trim().length <= 50;
  const upsertReady =
    countryCode !== "" && effectiveFrom !== "" && (status !== "REGISTERED" || numberValid);

  async function upsertRegistration(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!upsertReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("upsert");
    const saved = await bffFetch<TaxRegistrationRow>("tax/tax-registrations", {
      method: "POST",
      body: {
        countryCode,
        status,
        registrationNumber: status === "REGISTERED" ? registrationNumber.trim() : null,
        effectiveFrom,
      },
    });
    setBusy(null);
    if (!saved.ok) {
      setError(localizedTaxError(d, saved.error, saved.retryAfterSeconds));
      return;
    }
    setRegistrations((current) => {
      const rest = current.filter((row) => row.countryCode !== saved.data.countryCode);
      return [...rest, saved.data].sort((a, b) => a.countryCode.localeCompare(b.countryCode));
    });
    setRegistrationNumber("");
    setNotice(d.taxRegistrationsSavedToast);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.taxRegistrationsTitle}>
        <DataTable
          columns={[
            {
              id: "country",
              header: activeLocaleHeader(d.taxCodesCountry),
              accessor: (row) => row.countryCode,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.countryCode}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.taxRegistrationsStatus),
              accessor: (row) => row.status,
              render: (row) =>
                row.status === "REGISTERED" ? (
                  <Badge tone="primary">{localizedRegistrationStatus(d, row.status)}</Badge>
                ) : (
                  <Badge tone="neutral">{localizedRegistrationStatus(d, row.status)}</Badge>
                ),
            },
            {
              id: "number",
              header: activeLocaleHeader(d.taxRegistrationsNumber),
              accessor: (row) => row.registrationNumber ?? "",
              mono: true,
              render: (row) =>
                row.registrationNumber === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.registrationNumber}
                  </span>
                ),
            },
            {
              id: "effectiveFrom",
              header: activeLocaleHeader(d.taxRegistrationsEffectiveFrom),
              accessor: (row) => row.effectiveFrom,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.effectiveFrom}
                </span>
              ),
            },
            {
              id: "effectiveTo",
              header: activeLocaleHeader(d.taxRegistrationsEffectiveTo),
              accessor: (row) => row.effectiveTo ?? "",
              mono: true,
              render: (row) =>
                row.effectiveTo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.effectiveTo}
                  </span>
                ),
            },
          ]}
          rows={[...registrations]}
          rowKey={(row) => row.id}
          empty={{ title: d.taxRegistrationsEmpty }}
        />
      </Card>

      <Card title={d.taxRegistrationsCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label={d.taxCodesCountry}
            value={countryCode}
            onValueChange={setCountryCode}
            placeholder="—"
            options={countryOptions}
            required
          />
          <Select
            label={d.taxRegistrationsStatus}
            value={status}
            onValueChange={setStatus}
            options={STATUS_OPTIONS.map((value) => ({
              value,
              label: localizedRegistrationStatus(d, value),
            }))}
            required
          />
          {status === "REGISTERED" && (
            <Input
              label={d.taxRegistrationsNumber}
              value={registrationNumber}
              onValueChange={setRegistrationNumber}
              hint={d.taxErrRegistrationNumber}
              mono
              bidiIsolate
              required
            />
          )}
          <DatePicker
            locale={locale}
            label={d.taxRegistrationsEffectiveFrom}
            value={effectiveFrom}
            onSelect={setEffectiveFrom}
            required
          />
        </div>
        <Button
          variant="primary"
          onClick={() => void upsertRegistration()}
          loading={busy === "upsert"}
          disabled={!upsertReady}
          className="mt-3 self-start"
        >
          {d.commonCreate}
        </Button>
      </Card>
    </div>
  );
}
