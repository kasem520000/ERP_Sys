"use client";

/**
 * PHASE-024 T4 — the `identity.mfa.policy` settings card (Settings
 * archetype, the TenantSettingsForm per-key PUT pattern): mode select
 * (inherit plan / custom override) +, in custom mode, a roles checkbox list
 * (GET /identity/roles tenant roles). One save button → ONE
 * PUT /api/bff/tenancy/settings/identity.mfa.policy { value } — the whole
 * compound value saves atomically (the numbering.defaults precedent), with
 * inline saved/error feedback plus a toast (the export-card toast pattern).
 *
 * An explicitly EMPTY custom list is a legitimate policy (MFA optional even
 * when the plan mandates) — the hint says so; the API caps the list at 20.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button, Checkbox, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import { isRecord, type MfaPolicyValue, type RoleRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedTenancyError, localizedName } from "../lib/messages";
import { Card } from "./card";

/** The SETTINGS_REGISTRY schema cap (settings-schema.ts required_roles.max). */
const MAX_ROLES = 20;

/** Normalizes the settings-map value (registry default ∪ stored row). */
export function asMfaPolicy(value: unknown): MfaPolicyValue {
  if (isRecord(value) && (value.mode === "plan" || value.mode === "custom")) {
    const roles = Array.isArray(value.required_roles)
      ? value.required_roles.filter((role): role is string => typeof role === "string")
      : [];
    return { mode: value.mode, required_roles: roles };
  }
  return { mode: "plan", required_roles: [] };
}

type Feedback = { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

export function MfaPolicyCard({
  locale,
  policy,
  roles,
}: {
  locale: Locale;
  policy: MfaPolicyValue;
  /** Tenant roles for the multi-select; null when the list could not be fetched. */
  roles: readonly RoleRow[] | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const [mode, setMode] = useState<MfaPolicyValue["mode"]>(policy.mode);
  const [selected, setSelected] = useState<readonly string[]>(policy.required_roles);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);

  /** The checkbox list: the tenant's roles, plus any stored key not in it. */
  const roleRows: readonly RoleRow[] =
    roles === null
      ? policy.required_roles.map((key) => ({
          id: key,
          tenantId: null,
          key,
          name: key,
          nameAr: null,
          isSystem: false,
        }))
      : roles;
  const knownKeys = new Set(roleRows.map((role) => role.key));
  // Stored keys missing from the live list (a role was deleted mid-session):
  // keep them visible + checkable so nothing silently disappears on save.
  const missingKeys = selected.filter((key) => !knownKeys.has(key));

  function onToggleRole(key: string, checked: boolean): void {
    if (checked && selected.length >= MAX_ROLES) {
      setRolesError(formatMessage(d.mfaPolicyRolesMaxError, { max: MAX_ROLES }));
      return;
    }
    setRolesError(null);
    setSelected((previous) =>
      checked ? [...previous, key] : previous.filter((roleKey) => roleKey !== key),
    );
  }

  async function onSave(): Promise<void> {
    setBusy(true);
    setFeedback({ state: "saving" });
    const result = await bffFetch<unknown>("tenancy/settings/identity.mfa.policy", {
      method: "PUT",
      body: { value: { mode, required_roles: selected } },
    });
    setBusy(false);
    if (result.ok) {
      setFeedback({ state: "saved" });
      toast({ tone: "success", title: d.settingsSaved });
      return;
    }
    const message = localizedTenancyError(d, result.error, result.retryAfterSeconds);
    setFeedback({ state: "error", message });
    toast({ tone: "danger", title: message });
  }

  return (
    <Card title={d.mfaPolicyTitle} description={d.mfaPolicyDescription} ariaLabel={d.mfaPolicyTitle}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 border-b border-subtle pb-3 sm:flex-row sm:items-center sm:gap-4">
          <label htmlFor="set-mfa-policy-mode" className="text-sm font-medium text-gray-700 sm:w-48 sm:shrink-0">
            {d.mfaPolicyModeLabel}
          </label>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <div className="w-full max-w-56">
              <Select
                id="set-mfa-policy-mode"
                value={mode}
                onValueChange={(value) => setMode(value === "custom" ? "custom" : "plan")}
                options={[
                  { value: "plan", label: d.mfaPolicyModePlan },
                  { value: "custom", label: d.mfaPolicyModeCustom },
                ]}
              />
            </div>
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void onSave()}>
              {d.settingsSave}
            </Button>
            {feedback !== null && (
              <span
                role={feedback.state === "error" ? "alert" : "status"}
                className={
                  feedback.state === "error"
                    ? "text-xs text-danger-700"
                    : feedback.state === "saving"
                      ? "text-xs text-gray-600"
                      : "text-xs text-success-text"
                }
              >
                {feedback.state === "saving"
                  ? d.loading
                  : feedback.state === "saved"
                    ? `✓ ${d.settingsSaved}`
                    : feedback.message}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-gray-600">
          {mode === "plan" ? d.mfaPolicyModePlanHint : d.mfaPolicyModeCustomHint}
        </p>

        {mode === "custom" && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700">{d.mfaPolicyRolesLabel}</span>
            <p className="text-xs text-gray-600">{d.mfaPolicyRolesHint}</p>
            {roles === null && <p className="text-xs text-warning-text">{d.mfaPolicyRolesUnavailable}</p>}
            {roleRows.length === 0 && missingKeys.length === 0 ? (
              <p className="text-sm text-gray-600">{d.mfaPolicyNoRoles}</p>
            ) : (
              <fieldset
                className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-md border border-subtle bg-surface-sunken p-3"
                aria-label={d.mfaPolicyRolesLabel}
              >
                {roleRows.map((role) => (
                  <Checkbox
                    key={role.key}
                    checked={selected.includes(role.key)}
                    onCheckedChange={(checked) => onToggleRole(role.key, checked === true)}
                    label={
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{localizedName(role.name, role.nameAr, locale)}</span>
                        <span dir="ltr" className="font-mono text-xs text-gray-500">
                          {role.key}
                        </span>
                      </span>
                    }
                  />
                ))}
                {missingKeys.map((key) => (
                  <Checkbox
                    key={key}
                    checked
                    onCheckedChange={(checked) => onToggleRole(key, checked === true)}
                    label={
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{d.mfaPolicyRoleMissing}</span>
                        <span dir="ltr" className="font-mono text-xs text-gray-500">
                          {key}
                        </span>
                      </span>
                    }
                  />
                ))}
              </fieldset>
            )}
            <p className="text-xs text-gray-600" aria-live="polite">
              {formatMessage(d.mfaPolicySelectedCount, { count: selected.length, max: MAX_ROLES })}
            </p>
            {rolesError !== null && (
              <p role="alert" className="text-xs text-danger-700">
                {rolesError}
              </p>
            )}
            <div>
              <Button variant="secondary" size="sm" loading={busy} onClick={() => void onSave()}>
                {d.settingsSave}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
