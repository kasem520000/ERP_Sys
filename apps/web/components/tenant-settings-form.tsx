"use client";

/**
 * P4-T12a — typed tenant-settings cards (Settings archetype: grouped
 * fieldsets, Switch for boolean settings, explicit Save per field). Every
 * field saves INDIVIDUALLY via PUT /api/bff/tenancy/settings/:key { value }
 * with per-field saved/error feedback (schema-validated server-side; unknown
 * keys are impossible from this UI). The tax registration status+number pair
 * keeps the API's cross-key rule visible (number required while REGISTERED,
 * rejected otherwise) — both fields therefore keep separate save buttons.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button, Input, Select, Switch } from "@erp/ui";

import { getDictionary, monthNames, type Locale } from "../i18n/dictionaries";
import { isRecord, type TenantSettingsMap } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedTenancyError } from "../lib/messages";
import { Card } from "./card";

type FieldFeedback = { state: "saving" | "saved" | "error"; message?: string };
type AssignAt = "approval" | "posting";
type TaxStatus = "REGISTERED" | "NOT_REGISTERED" | "DEREGISTERED";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asMonth(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12 ? value : 1;
}

function asAssignAt(value: unknown): AssignAt {
  return isRecord(value) && value.assign_at === "approval" ? "approval" : "posting";
}

function asTaxStatus(value: unknown): TaxStatus {
  return value === "REGISTERED" || value === "DEREGISTERED" ? value : "NOT_REGISTERED";
}

/** One settings row: optional label column + control + explicit save + inline feedback. */
function SettingRow({
  label,
  htmlFor,
  control,
  action,
  feedback,
}: {
  label?: string;
  htmlFor?: string;
  control: JSX.Element;
  action: JSX.Element;
  feedback: JSX.Element | null;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-b border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      {label !== undefined && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-gray-700 sm:w-48 sm:shrink-0">
          {label}
        </label>
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <div className="w-full max-w-56">{control}</div>
        {action}
      </div>
      {feedback !== null && <div className="sm:w-full">{feedback}</div>}
    </div>
  );
}

export function TenantSettingsForm({
  locale,
  settings,
}: {
  locale: Locale;
  settings: TenantSettingsMap;
}): JSX.Element {
  const d = getDictionary(locale);
  const [defaultLocale, setDefaultLocale] = useState(asString(settings["general.default_locale"], "ar"));
  const [numeralSystem, setNumeralSystem] = useState(asString(settings["general.numeral_system"], "latn"));
  const [hijriDisplay, setHijriDisplay] = useState(asBool(settings["general.hijri_display"], true));
  const [fiscalMonth, setFiscalMonth] = useState(asMonth(settings["fiscal_calendar.start_month"]));
  const [assignAt, setAssignAt] = useState(asAssignAt(settings["numbering.defaults"]));
  const [supportOptIn, setSupportOptIn] = useState(asBool(settings["platform.support.opt_in"], false));
  const [taxStatus, setTaxStatus] = useState<TaxStatus>(asTaxStatus(settings["tax.registration.status"]));
  const [taxNumber, setTaxNumber] = useState(asString(settings["tax.registration.number"], ""));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, FieldFeedback>>({});

  async function save(key: string, value: unknown): Promise<void> {
    setBusyKey(key);
    setFeedback((previous) => ({ ...previous, [key]: { state: "saving" } }));
    const result = await bffFetch<unknown>(`tenancy/settings/${key}`, {
      method: "PUT",
      body: { value },
    });
    setBusyKey(null);
    if (result.ok) {
      setFeedback((previous) => ({ ...previous, [key]: { state: "saved" } }));
      return;
    }
    setFeedback((previous) => ({
      ...previous,
      [key]: {
        state: "error",
        message: localizedTenancyError(d, result.error, result.retryAfterSeconds),
      },
    }));
  }

  function feedbackOf(key: string): JSX.Element | null {
    const field = feedback[key];
    if (field === undefined) {
      return null;
    }
    if (field.state === "saving") {
      return (
        <span role="status" className="text-xs text-gray-600">
          {d.loading}
        </span>
      );
    }
    if (field.state === "saved") {
      return (
        <span role="status" className="text-xs text-success-text">
          {`✓ ${d.settingsSaved}`}
        </span>
      );
    }
    return (
      <span role="alert" className="text-xs text-danger-700">
        {field.message}
      </span>
    );
  }

  const saveButton = (key: string): JSX.Element => (
    <Button
      variant="secondary"
      size="sm"
      loading={busyKey === key}
      disabled={busyKey !== null && busyKey !== key}
      onClick={() => {
        void save(key, currentValueOf(key));
      }}
    >
      {d.settingsSave}
    </Button>
  );

  function currentValueOf(key: string): unknown {
    switch (key) {
      case "general.default_locale":
        return defaultLocale;
      case "general.numeral_system":
        return numeralSystem;
      case "general.hijri_display":
        return hijriDisplay;
      case "fiscal_calendar.start_month":
        return fiscalMonth;
      case "numbering.defaults":
        return { assign_at: assignAt };
      case "platform.support.opt_in":
        return supportOptIn;
      case "tax.registration.status":
        return taxStatus;
      default:
        return undefined;
    }
  }

  function onTaxNumberSave(): void {
    if (taxNumber.trim().length < 3) {
      setFeedback((previous) => ({
        ...previous,
        "tax.registration.number": { state: "error", message: d.errorsValidation },
      }));
      return;
    }
    void save("tax.registration.number", taxNumber.trim());
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.settingsGeneralTitle} ariaLabel={d.settingsGeneralTitle}>
        <SettingRow
          label={d.settingsDefaultLocaleLabel}
          htmlFor="set-default-locale"
          control={
            <Select
              id="set-default-locale"
              value={defaultLocale}
              onValueChange={setDefaultLocale}
              options={[
                { value: "ar", label: d.localeArabic },
                { value: "en", label: d.localeEnglish },
              ]}
            />
          }
          action={saveButton("general.default_locale")}
          feedback={feedbackOf("general.default_locale")}
        />
        <SettingRow
          label={d.settingsNumeralSystemLabel}
          htmlFor="set-numeral-system"
          control={
            <Select
              id="set-numeral-system"
              value={numeralSystem}
              onValueChange={setNumeralSystem}
              options={[
                { value: "latn", label: d.settingsNumeralLatn },
                { value: "arab", label: d.settingsNumeralArab },
              ]}
            />
          }
          action={saveButton("general.numeral_system")}
          feedback={feedbackOf("general.numeral_system")}
        />
        <SettingRow
          control={
            <Switch
              label={d.settingsHijriLabel}
              description={d.settingsHijriHint}
              checked={hijriDisplay}
              onCheckedChange={setHijriDisplay}
            />
          }
          action={saveButton("general.hijri_display")}
          feedback={feedbackOf("general.hijri_display")}
        />
      </Card>

      <Card title={d.settingsFiscalNumberingTitle} ariaLabel={d.settingsFiscalNumberingTitle}>
        <SettingRow
          label={d.fiscalStartMonthLabel}
          htmlFor="set-fiscal-month"
          control={
            <Select
              id="set-fiscal-month"
              value={String(fiscalMonth)}
              onValueChange={(value) => setFiscalMonth(Number.parseInt(value, 10))}
              options={monthNames[locale].map((name, index) => ({
                value: String(index + 1),
                label: name,
              }))}
            />
          }
          action={saveButton("fiscal_calendar.start_month")}
          feedback={feedbackOf("fiscal_calendar.start_month")}
        />
        <SettingRow
          label={d.numberingAssignAtLabel}
          htmlFor="set-assign-at"
          control={
            <Select
              id="set-assign-at"
              value={assignAt}
              onValueChange={(value) => setAssignAt(value as AssignAt)}
              options={[
                { value: "posting", label: d.numberingAssignAtPosting },
                { value: "approval", label: d.numberingAssignAtApproval },
              ]}
            />
          }
          action={saveButton("numbering.defaults")}
          feedback={feedbackOf("numbering.defaults")}
        />
      </Card>

      <Card title={d.settingsSupportTitle} ariaLabel={d.settingsSupportTitle}>
        <p
          role="note"
          className="mb-3 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
        >
          {d.settingsSupportOptInWarning}
        </p>
        <SettingRow
          control={
            <Switch
              label={d.settingsSupportOptInLabel}
              checked={supportOptIn}
              onCheckedChange={setSupportOptIn}
            />
          }
          action={saveButton("platform.support.opt_in")}
          feedback={feedbackOf("platform.support.opt_in")}
        />
      </Card>

      <Card title={d.settingsTaxTitle} description={d.settingsTaxPairHint} ariaLabel={d.settingsTaxTitle}>
        <SettingRow
          label={d.taxStatusLabel}
          htmlFor="set-tax-status"
          control={
            <Select
              id="set-tax-status"
              value={taxStatus}
              onValueChange={(value) => setTaxStatus(value as TaxStatus)}
              options={[
                { value: "NOT_REGISTERED", label: d.taxStatusNotRegistered },
                { value: "REGISTERED", label: d.taxStatusRegistered },
                { value: "DEREGISTERED", label: d.taxStatusDeregistered },
              ]}
            />
          }
          action={saveButton("tax.registration.status")}
          feedback={feedbackOf("tax.registration.status")}
        />
        <SettingRow
          label={d.taxNumberLabel}
          htmlFor="set-tax-number"
          control={
            <Input
              id="set-tax-number"
              value={taxNumber}
              onValueChange={setTaxNumber}
              mono
              bidiIsolate
            />
          }
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={busyKey === "tax.registration.number"}
              disabled={busyKey !== null || taxNumber.trim() === ""}
              onClick={() => onTaxNumberSave()}
            >
              {d.settingsSave}
            </Button>
          }
          feedback={feedbackOf("tax.registration.number")}
        />
      </Card>
    </div>
  );
}
