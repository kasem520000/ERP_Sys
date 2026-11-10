"use client";

/**
 * P4-T12a — registration form (public). POST /api/bff/platform/register:
 *
 *  - the base currency is DERIVED from the selected country (display-only,
 *    the API derives/validates it server-side too);
 *  - the tax number is required while the status is REGISTERED;
 *  - error contract: 409 tenancy/email-already-registered → friendly message;
 *    422 tenancy/invalid-registration-input → the display-safe API message;
 *    429 RATE_LIMITED → localized message + Retry-After seconds.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { RegisterResult, RegistrationOptions } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, formatMessage, localizedTenancyError, localizedName } from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";

const MIN_PASSWORD_LENGTH = 10;

type TaxStatus = "REGISTERED" | "NOT_REGISTERED" | "DEREGISTERED";

export function RegisterForm({
  locale,
  options,
}: {
  locale: Locale;
  options: RegistrationOptions;
}): JSX.Element {
  const d = getDictionary(locale);
  const [businessName, setBusinessName] = useState("");
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [templateKey, setTemplateKey] = useState(
    options.industryTemplates.length > 0 ? (options.industryTemplates[0]?.key ?? "") : "",
  );
  const [taxStatus, setTaxStatus] = useState<TaxStatus>("NOT_REGISTERED");
  const [taxNumber, setTaxNumber] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<RegisterResult | null>(null);

  const selectedCountry = options.countries.find((country) => country.code === countryCode);
  const baseCurrency = selectedCountry?.currencyCode ?? "";
  const currencyName = baseCurrency === ""
    ? ""
    : localizedName(
        options.currencies.find((currency) => currency.code === baseCurrency)?.name ?? baseCurrency,
        options.currencies.find((currency) => currency.code === baseCurrency)?.nameAr ?? null,
        locale,
      );

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (
      businessName === "" ||
      countryCode === "" ||
      templateKey === "" ||
      ownerEmail === "" ||
      ownerFullName === "" ||
      ownerPassword.length < MIN_PASSWORD_LENGTH
    ) {
      setError(d.errorsValidation);
      return;
    }
    if (taxStatus === "REGISTERED" && taxNumber.trim() === "") {
      setError(d.registerTaxNumberHint);
      return;
    }
    const body: Record<string, unknown> = {
      businessName,
      countryCode,
      baseCurrency,
      industryTemplateKey: templateKey,
      taxRegistrationStatus: taxStatus,
      ownerEmail,
      ownerFullName,
      ownerPassword,
    };
    if (businessNameAr !== "") {
      body.businessNameAr = businessNameAr;
    }
    if (taxStatus === "REGISTERED") {
      body.taxRegistrationNumber = taxNumber.trim();
    }
    setBusy(true);
    const result = await bffFetch<RegisterResult>("platform/register", { method: "POST", body });
    setBusy(false);
    if (result.ok) {
      setSuccess(result.data);
      return;
    }
    setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
  }

  if (success !== null) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <h2 className="text-md font-semibold text-gray-900">{d.registerSuccessTitle}</h2>
        <p className="text-sm text-gray-700">
          {formatMessage(d.registerSuccessBody, {
            email: success.ownerEmail,
            date: formatDateTime(success.trialExpiresAt, locale),
          })}
        </p>
        <div>
          <LinkButton href={`/${locale}/login`} variant="primary">
            {d.registerGoLogin}
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">{d.registerSubtitle}</p>

      <Input
        id="reg-business-name"
        label={d.registerBusinessNameLabel}
        type="text"
        name="businessName"
        required
        value={businessName}
        onValueChange={setBusinessName}
      />
      <Input
        id="reg-business-name-ar"
        label={d.registerBusinessNameArLabel}
        type="text"
        name="businessNameAr"
        value={businessNameAr}
        onValueChange={setBusinessNameAr}
      />
      <Select
        id="reg-country"
        label={d.registerCountryLabel}
        name="countryCode"
        required
        placeholder="—"
        value={countryCode}
        onValueChange={setCountryCode}
        options={[
          { value: "", label: "—" },
          ...options.countries.map((country) => ({
            value: country.code,
            label: `${localizedName(country.name, country.nameAr, locale)} (${country.code})`,
          })),
        ]}
      />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-700">{d.registerCurrencyLabel}</span>
        <p className="font-mono text-sm text-gray-900">
          {baseCurrency === "" ? "—" : `${baseCurrency}${currencyName === "" ? "" : ` — ${currencyName}`}`}
        </p>
      </div>
      <Select
        id="reg-template"
        label={d.registerTemplateLabel}
        name="industryTemplateKey"
        required
        value={templateKey}
        onValueChange={setTemplateKey}
        options={options.industryTemplates.map((template) => ({
          value: template.key,
          label: `${localizedName(template.name, template.nameAr, locale)} (${template.key})`,
        }))}
      />

      <Select
        id="reg-tax-status"
        label={d.taxStatusLabel}
        name="taxRegistrationStatus"
        value={taxStatus}
        onValueChange={(value) => setTaxStatus(value as TaxStatus)}
        options={[
          { value: "NOT_REGISTERED", label: d.taxStatusNotRegistered },
          { value: "REGISTERED", label: d.taxStatusRegistered },
          { value: "DEREGISTERED", label: d.taxStatusDeregistered },
        ]}
      />
      {taxStatus === "REGISTERED" && (
        <Input
          id="reg-tax-number"
          label={d.taxNumberLabel}
          type="text"
          name="taxRegistrationNumber"
          required
          hint={d.registerTaxNumberHint}
          mono
          bidiIsolate
          value={taxNumber}
          onValueChange={setTaxNumber}
        />
      )}

      <fieldset className="mt-2 flex flex-col gap-4 border-t border-subtle pt-4">
        <legend className="text-md font-semibold text-gray-900">{d.registerOwnerSection}</legend>
        <Input
          id="reg-owner-email"
          label={d.registerOwnerEmailLabel}
          type="email"
          name="ownerEmail"
          autoComplete="email"
          required
          value={ownerEmail}
          onValueChange={setOwnerEmail}
        />
        <Input
          id="reg-owner-name"
          label={d.registerOwnerNameLabel}
          type="text"
          name="ownerFullName"
          autoComplete="name"
          required
          value={ownerFullName}
          onValueChange={setOwnerFullName}
        />
        <Input
          id="reg-owner-password"
          label={d.loginPasswordLabel}
          type="password"
          name="ownerPassword"
          autoComplete="new-password"
          required
          hint={d.acceptPasswordHint}
          value={ownerPassword}
          onValueChange={setOwnerPassword}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy}>
          {d.registerSubmit}
        </Button>
        <a
          href={`/${locale}/login`}
          className="text-sm text-primary-700 underline-offset-2 hover:underline"
        >
          {d.registerGoLogin}
        </a>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </form>
  );
}
