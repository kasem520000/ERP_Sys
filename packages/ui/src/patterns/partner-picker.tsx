"use client";

/**
 * PartnerPicker (COMPONENT_CATALOG §3 pattern; P6-T11a): the customer/supplier
 * selection pattern over the catalog `Combobox`. Headless by contract
 * (§5 rule 3 / §9): the APP supplies the option list (and any async search
 * wiring via `onSearch` — the combobox debounces 200ms); the pattern owns the
 * picker ergonomics — bilingual type-ahead (AR label matches EN keywords),
 * optional mono meta (partner code) in the option label, clear semantics.
 */
import type { JSX } from "react";

import { Combobox, type ComboboxProps } from "../components/controls";
import type { ComboboxItem } from "../primitives/combobox";

/** A picker option: `label` is the ACTIVE-locale display; `labelAr` feeds EN↔AR type-ahead. */
export interface PickerOption {
  id: string;
  label: string;
  /** Secondary bilingual label — enables AR+EN matching from one option set. */
  labelAr?: string;
  /** Secondary mono hint rendered in the option (e.g. partner code / SKU). */
  meta?: string;
  disabled?: boolean;
}

export interface PartnerPickerProps {
  label?: string;
  items: PickerOption[];
  value?: string;
  onSelect?: (id: string) => void;
  placeholder?: string;
  /** Async search passthrough (≥50 records; debounced by the combobox). */
  onSearch?: (query: string) => void;
  loading?: boolean;
  emptyText?: string;
  allowClear?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
}

export function toComboboxItems(items: readonly PickerOption[]): ComboboxItem[] {
  return items.map((item) => ({
    value: item.id,
    label: item.meta !== undefined && item.meta !== "" ? `${item.label} · ${item.meta}` : item.label,
    keywords: [item.labelAr ?? "", item.meta ?? ""].filter((part) => part !== "").join(" "),
    disabled: item.disabled,
  }));
}

/** PartnerPicker — Combobox semantics; selection restores focus to the trigger. */
export function PartnerPicker({
  label,
  items,
  value,
  onSelect,
  placeholder,
  onSearch,
  loading = false,
  emptyText,
  allowClear = true,
  disabled,
  required,
  error,
  hint,
  className,
}: PartnerPickerProps): JSX.Element {
  const comboboxProps: ComboboxProps = {
    label,
    items: toComboboxItems(items),
    value,
    onValueChange: onSelect,
    onSearch,
    loading,
    emptyText,
    allowClear,
    placeholder,
    disabled,
    required,
    error,
    hint,
    className,
  };
  return <Combobox {...comboboxProps} />;
}
