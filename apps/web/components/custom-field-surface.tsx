"use client";

/**
 * WEB-036 (PHASE-036) — the shared CustomFieldSurface: renders one control
 * per ACTIVE definition of one entity type (the surface payload's rows),
 * localized per locale with the required marker, and emits the FULL
 * customFields payload (`{ [key]: value }`, empty values omitted so a
 * full-replace save clears them). Renders null when the tenant has no
 * ACTIVE definitions — a starter tenant's forms stay byte-identical.
 *
 * Per data type (FD-18): TEXT → Input, NUMBER → NumberInput, DATE →
 * DatePicker, BOOLEAN → yes/no Select, SELECT → options Select,
 * MULTISELECT → checkbox group (no frozen multi-select exists in @erp/ui),
 * REFERENCE → UUID Input with the target-entity hint.
 */
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { Checkbox, DatePicker, Input, NumberInput, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { CustomFieldDefinitionRow, CustomFieldValueView } from "../lib/api-types";
import { localizedName } from "../lib/messages";

export interface CustomFieldSurfaceProps {
  locale: Locale;
  /** The entity vocabulary string ("partners", "items", …). */
  entityType: string;
  definitions: readonly CustomFieldDefinitionRow[];
  values: Record<string, CustomFieldValueView>;
  onChange: (payload: Record<string, unknown>) => void;
  /** Renders without the sub-section heading (nested surfaces). */
  hideHeading?: boolean;
}

/** The draft's normalized wire value — undefined means "cleared". */
function normalizeValue(
  definition: CustomFieldDefinitionRow,
  raw: unknown,
): unknown | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  switch (definition.dataType) {
    case "NUMBER": {
      if (typeof raw === "number") {
        return Number.isFinite(raw) ? raw : undefined;
      }
      const text = String(raw).trim();
      if (text === "") {
        return undefined;
      }
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case "BOOLEAN":
      return raw === true || raw === "true" ? true : raw === false || raw === "false" ? false : undefined;
    case "MULTISELECT":
      return Array.isArray(raw) && raw.length > 0 ? raw.filter((entry) => typeof entry === "string") : undefined;
    default: {
      const text = typeof raw === "string" ? raw.trim() : String(raw);
      return text === "" ? undefined : text;
    }
  }
}

/** Seed string for controlled inputs from the incoming value view. */
function seedString(view: CustomFieldValueView | undefined): string {
  if (view === undefined || view.value === null || view.value === undefined) {
    return "";
  }
  return String(view.value);
}

export function CustomFieldSurface({
  locale,
  entityType,
  definitions,
  values,
  onChange,
  hideHeading = false,
}: CustomFieldSurfaceProps): JSX.Element | null {
  const d = getDictionary(locale);
  // The draft is a plain string/boolean/array scratchpad per key — inputs
  // are string-driven; normalizeValue converts on emit.
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const definition of definitions) {
      const view = values[definition.key];
      if (view !== undefined && view.value !== null && view.value !== undefined && view.value !== "") {
        seed[definition.key] = view.value;
      }
    }
    return seed;
  });

  // Re-seed when the parent's values change identity (router.refresh with a
  // fresh server row) or the definitions set changes (surface fetched late).
  const valuesSignature = useMemo(() => JSON.stringify(values), [values]);
  const definitionsRef = definitions;
  useEffect(() => {
    const seed: Record<string, unknown> = {};
    for (const definition of definitionsRef) {
      const view = values[definition.key];
      if (view !== undefined && view.value !== null && view.value !== undefined && view.value !== "") {
        seed[definition.key] = view.value;
      }
    }
    setDraft(seed);
  }, [valuesSignature, definitionsRef]);

  if (definitions.length === 0) {
    return null;
  }

  function emit(next: Record<string, unknown>): void {
    setDraft(next);
    const payload: Record<string, unknown> = {};
    for (const definition of definitions) {
      const normalized = normalizeValue(definition, next[definition.key]);
      if (normalized !== undefined) {
        payload[definition.key] = normalized;
      }
    }
    onChange(payload);
  }

  function setEntry(key: string, value: unknown): void {
    emit({ ...draft, [key]: value });
  }

  function toggleMultiEntry(key: string, optionId: string, checked: boolean): void {
    const current = Array.isArray(draft[key])
      ? (draft[key] as unknown[]).filter((entry): entry is string => typeof entry === "string")
      : [];
    const next = checked
      ? [...new Set([...current, optionId])]
      : current.filter((entry) => entry !== optionId);
    setEntry(key, next);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-subtle bg-surface-sunken p-3">
      {!hideHeading && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{d.customFieldsFormSectionTitle}</h3>
          <p className="text-xs text-gray-600">{d.customFieldsFormSectionDescription}</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2" data-entity-type={entityType}>
        {definitions.map((definition) => {
          const label = localizedName(definition.label, definition.labelAr, locale);
          const raw = draft[definition.key];
          switch (definition.dataType) {
            case "NUMBER":
              return (
                <NumberInput
                  key={definition.id}
                  id={`custom-field-${definition.key}`}
                  label={label}
                  value={seedString({ value: raw })}
                  onValueChange={(value) => setEntry(definition.key, value)}
                  required={definition.required}
                />
              );
            case "DATE":
              return (
                <DatePicker
                  key={definition.id}
                  id={`custom-field-${definition.key}`}
                  locale={locale}
                  label={label}
                  value={typeof raw === "string" && raw !== "" ? raw : undefined}
                  onSelect={(iso) => setEntry(definition.key, iso)}
                  required={definition.required}
                />
              );
            case "BOOLEAN":
              return (
                <Select
                  key={definition.id}
                  id={`custom-field-${definition.key}`}
                  label={label}
                  value={raw === true || raw === "true" ? "true" : raw === false || raw === "false" ? "false" : ""}
                  onValueChange={(value) => setEntry(definition.key, value)}
                  placeholder={d.customFieldsSelectEmpty}
                  options={[
                    { value: "true", label: d.customFieldsYesOption },
                    { value: "false", label: d.customFieldsNoOption },
                  ]}
                  required={definition.required}
                />
              );
            case "SELECT":
            case "MULTISELECT": {
              const options = definition.options ?? [];
              const selectOptions = options
                .filter((option) => option.status === "ACTIVE")
                .map((option) => ({
                  value: option.id,
                  label: localizedName(option.label, option.labelAr, locale),
                }));
              if (definition.dataType === "SELECT") {
                const currentId = typeof raw === "string" ? raw : "";
                // Historical values may point at an ARCHIVED option — keep it
                // selectable so the stored id survives an untouched save.
                if (currentId !== "" && !selectOptions.some((option) => option.value === currentId)) {
                  const currentView = values[definition.key];
                  const fallbackLabel =
                    locale === "ar"
                      ? (currentView?.optionLabelAr ?? currentView?.optionLabel ?? currentId)
                      : (currentView?.optionLabel ?? currentId);
                  selectOptions.push({ value: currentId, label: fallbackLabel });
                }
                return (
                  <Select
                    key={definition.id}
                    id={`custom-field-${definition.key}`}
                    label={label}
                    value={currentId}
                    onValueChange={(value) => setEntry(definition.key, value)}
                    placeholder={d.customFieldsSelectEmpty}
                    options={selectOptions}
                    required={definition.required}
                  />
                );
              }
              const selected = Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
              const activeOptions = options.filter((option) => option.status === "ACTIVE");
              return (
                <fieldset key={definition.id} className="flex flex-col gap-1">
                  <legend className="text-sm font-medium text-gray-700">
                    {label}
                    {definition.required && (
                      <span aria-hidden="true" className="text-danger-700">
                        {" *"}
                      </span>
                    )}
                  </legend>
                  {activeOptions.length === 0 ? (
                    <p className="text-xs text-gray-600">{d.customFieldsMultiselectEmpty}</p>
                  ) : (
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      {activeOptions.map((option) => (
                        <Checkbox
                          key={option.id}
                          label={localizedName(option.label, option.labelAr, locale)}
                          checked={selected.includes(option.id)}
                          onCheckedChange={(checked) =>
                            toggleMultiEntry(definition.key, option.id, checked === true)
                          }
                        />
                      ))}
                    </div>
                  )}
                </fieldset>
              );
            }
            case "REFERENCE":
              return (
                <Input
                  key={definition.id}
                  id={`custom-field-${definition.key}`}
                  label={label}
                  value={seedString({ value: raw })}
                  onValueChange={(value) => setEntry(definition.key, value)}
                  hint={`${d.customFieldsReferenceHint}: ${definition.config.referenceEntity ?? "—"}`}
                  required={definition.required}
                  mono
                  bidiIsolate
                />
              );
            case "TEXT":
            default:
              return (
                <Input
                  key={definition.id}
                  id={`custom-field-${definition.key}`}
                  label={label}
                  value={seedString({ value: raw })}
                  onValueChange={(value) => setEntry(definition.key, value)}
                  required={definition.required}
                />
              );
          }
        })}
      </div>
    </div>
  );
}
