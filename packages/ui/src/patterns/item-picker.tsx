"use client";

/**
 * ItemPicker (COMPONENT_CATALOG §3 pattern; P6-T11a): item selection + barcode
 * affordance over the catalog `Combobox`. Same headless contract as
 * PartnerPicker (§5 rule 3 / §9): the app supplies options and any async
 * search; SKU rides as the mono meta. Scan-first (barcode hardware → query)
 * is the app's `onSearch` wiring; the pattern keeps type-first semantics and
 * the AR/EN type-ahead from one option set.
 */
import type { JSX } from "react";

import { Combobox, type ComboboxProps } from "../components/controls";
import type { PickerOption } from "./partner-picker";
import { toComboboxItems } from "./partner-picker";

export interface ItemPickerProps {
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

/** ItemPicker — Combobox semantics; SKU meta; barcode scans enter as queries. */
export function ItemPicker({
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
}: ItemPickerProps): JSX.Element {
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
