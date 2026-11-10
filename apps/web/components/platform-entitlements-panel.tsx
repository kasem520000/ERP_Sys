"use client";

/**
 * P4-T12a — platform entitlements panel: the granted-keys DataTable with
 * inline revocation (DELETE /api/bff/platform/tenants/:id/entitlements/
 * :featureKey?reason=…, reason required) + the grant form (POST
 * /api/bff/platform/tenants/:id/entitlements). Error contract highlights:
 * 422 tenancy/feature-dependencies-missing (details.missing listed),
 * 422 tenancy/manual-grant-expiry-required, 422 tenancy/unknown-feature-key.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, DatePicker, DataTable, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ConsoleEntitlement } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, localizedTenancyError } from "../lib/messages";
import { ENTITLEMENT_SOURCES, type EntitlementSource } from "../lib/constants";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const MIN_REASON_LENGTH = 3;

export function PlatformEntitlementsPanel({
  locale,
  tenantId,
  entitlements,
}: {
  locale: Locale;
  tenantId: string;
  entitlements: readonly ConsoleEntitlement[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();

  const [featureKey, setFeatureKey] = useState("");
  const [source, setSource] = useState<EntitlementSource>("MANUAL");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantNotice, setGrantNotice] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);

  async function onGrant(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setGrantError(null);
    setGrantNotice(null);
    if (featureKey.trim() === "" || reason.trim().length < MIN_REASON_LENGTH) {
      setGrantError(d.errorsValidation);
      return;
    }
    if (source === "MANUAL" && expiresAt === "") {
      setGrantError(d.platformGrantExpiryRequired);
      return;
    }
    const body: Record<string, unknown> = {
      featureKey: featureKey.trim(),
      source,
      reason: reason.trim(),
    };
    if (expiresAt !== "") {
      // The API validates a full ISO datetime — the picked YMD is expanded.
      const parsed = new Date(expiresAt);
      if (!Number.isNaN(parsed.getTime())) {
        body.expiresAt = parsed.toISOString();
      }
    }
    setGrantBusy(true);
    const result = await bffFetch<ConsoleEntitlement>(
      `platform/tenants/${encodeURIComponent(tenantId)}/entitlements`,
      { method: "POST", body },
    );
    setGrantBusy(false);
    if (!result.ok) {
      setGrantError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setGrantNotice(d.platformGrantDone);
    setFeatureKey("");
    setExpiresAt("");
    setReason("");
    router.refresh();
  }

  return (
    <Card title={d.platformEntitlementsTitle} ariaLabel={d.platformEntitlementsTitle}>
      <DataTable
        columns={[
          {
            id: "featureKey",
            header: activeLocaleHeader(d.platformColFeatureKey),
            accessor: (row) => row.featureKey,
            mono: true,
            sortable: true,
          },
          {
            id: "source",
            header: activeLocaleHeader(d.platformColSource),
            accessor: (row) => row.source,
            mono: true,
            sortable: true,
          },
          {
            id: "expires",
            header: activeLocaleHeader(d.usersColExpires),
            accessor: (row) => row.expiresAt ?? "",
            render: (row) => formatDateTime(row.expiresAt, locale),
          },
          {
            id: "actions",
            header: activeLocaleHeader(d.usersColActions),
            accessor: () => "",
            width: "22rem",
            render: (row) => (
              <RevokeControl locale={locale} tenantId={tenantId} entitlement={row} />
            ),
          },
        ]}
        rows={[...entitlements]}
        rowKey={(row) => row.id}
        empty={{ title: d.platformEntitlementsEmpty }}
      />

      <div className="mt-4 border-t border-subtle pt-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">{d.platformGrantTitle}</h3>
        <form onSubmit={onGrant} noValidate className="flex max-w-2xl flex-col gap-3">
          <Input
            id={`grant-feature-${tenantId}`}
            label={d.platformGrantFeatureLabel}
            value={featureKey}
            onValueChange={setFeatureKey}
            mono
            bidiIsolate
          />
          <div className="flex flex-wrap gap-3">
            <div className="w-full max-w-44">
              <Select
                id={`grant-source-${tenantId}`}
                label={d.platformGrantSourceLabel}
                value={source}
                onValueChange={(value) => setSource(value as EntitlementSource)}
                options={ENTITLEMENT_SOURCES.map((value) => ({ value, label: value }))}
              />
            </div>
            <div className="w-full max-w-56">
              <DatePicker
                id={`grant-expires-${tenantId}`}
                label={d.platformGrantExpiresLabel}
                value={expiresAt}
                onSelect={setExpiresAt}
                locale={locale}
              />
              <p className="mt-1 text-xs text-gray-600">{d.platformGrantExpiresHint}</p>
            </div>
          </div>
          <Input
            id={`grant-reason-${tenantId}`}
            label={d.platformGrantReasonLabel}
            value={reason}
            onValueChange={setReason}
          />
          <div>
            <Button type="submit" variant="primary" loading={grantBusy}>
              {d.platformGrantSubmit}
            </Button>
          </div>
          {grantNotice !== null && <SuccessNotice>{grantNotice}</SuccessNotice>}
          {grantError !== null && <ErrorNotice>{grantError}</ErrorNotice>}
        </form>
      </div>
    </Card>
  );
}

function RevokeControl({
  locale,
  tenantId,
  entitlement,
}: {
  locale: Locale;
  tenantId: string;
  entitlement: ConsoleEntitlement;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRevoke(): Promise<void> {
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bffFetch<unknown>(
      `platform/tenants/${encodeURIComponent(tenantId)}/entitlements/${encodeURIComponent(
        entitlement.featureKey,
      )}?reason=${encodeURIComponent(reason.trim())}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex flex-wrap items-end gap-2">
      <div className="w-full max-w-56">
        <Input
          aria-label={d.platformRevokeReasonLabel}
          value={reason}
          onValueChange={setReason}
        />
      </div>
      <Button variant="danger" size="sm" loading={busy} onClick={() => void onRevoke()}>
        {d.platformRevoke}
      </Button>
      {error !== null && (
        <span role="alert" className="w-full text-xs text-danger-700">
          {error}
        </span>
      )}
    </span>
  );
}
