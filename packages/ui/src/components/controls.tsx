"use client";

/**
 * Select / Combobox / Checkbox / RadioGroup / Switch — styled catalog
 * components over the primitives (label wrappers + error wiring per §1 rows).
 */
import type { JSX, ReactNode } from "react";
import { useEffect, useId } from "react";

import { cn } from "../utils/cn";
import { useDirection } from "../utils/direction";
import { CheckboxPrimitive } from "../primitives/checkbox";
import { RadioGroupPrimitive, RadioPrimitive } from "../primitives/radio";
import { SwitchPrimitive } from "../primitives/switch";
import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectLabel,
} from "../primitives/select";
import { ComboboxListbox, useComboboxList, type ComboboxItem } from "../primitives/combobox";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "../primitives/popover";
import { useDebouncedValue } from "./input";
import { controlCx } from "../utils/direction";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label?: string;
  options: SelectOption[] | { group: string; options: SelectOption[] }[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  size?: "sm" | "md";
  id?: string;
  name?: string;
  className?: string;
}

/** Select — ≤~50 options; else Combobox. Type-ahead matches AR and EN. */
export function Select({
  label,
  options,
  value,
  onValueChange,
  placeholder,
  error,
  hint,
  disabled,
  required,
  size,
  id,
  name,
  className,
}: SelectProps): JSX.Element {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const grouped = !Array.isArray(options);
  const flat: SelectOption[] = grouped
    ? (options as Array<{ group: string; options: SelectOption[] }>).flatMap((g) => g.options)
    : (options as SelectOption[]);
  void flat;
  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      {label !== undefined && (
        <label htmlFor={fieldId} className="text-sm font-medium text-gray-700">
          {label}
          {required && (
            <span aria-hidden="true" className="text-danger-700">
              {" *"}
            </span>
          )}
        </label>
      )}
      <SelectRoot value={value} onValueChange={onValueChange} disabled={disabled} name={name}>
        <SelectTrigger size={size} placeholder={placeholder} id={fieldId} aria-invalid={error !== undefined || undefined} />
        <SelectContent>
          {!grouped
            ? (options as SelectOption[]).map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)
            : (options as Array<{ group: string; options: SelectOption[] }>).map((g) => (
                <SelectGroup key={g.group}>
                  <SelectLabel>{g.group}</SelectLabel>
                  {g.options.map((o) => (
                    <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
        </SelectContent>
      </SelectRoot>
      {hint !== undefined && <p className="text-xs text-gray-600">{hint}</p>}
      {error !== undefined && (
        <p className="text-xs text-danger-700" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

export interface ComboboxProps {
  label?: string;
  items: ComboboxItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  /** Async search (≥50 records — debounced 200ms by the component). */
  onSearch?: (query: string) => void;
  loading?: boolean;
  emptyText?: string;
  allowClear?: boolean;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Accessible name for the trigger when no visible <label> applies (grids). */
  "aria-label"?: string;
}

/** Combobox — role=combobox + aria-expanded + activedescendant; Enter selects. */
export function Combobox({
  label,
  items,
  value,
  onValueChange,
  onSearch,
  loading = false,
  emptyText,
  allowClear = true,
  placeholder,
  error,
  hint,
  disabled,
  required,
  className,
  "aria-label": ariaLabel,
}: ComboboxProps): JSX.Element {
  const autoId = useId();
  const fieldId = autoId;
  const state = useComboboxList({ items, value, onValueChange });
  const debounced = useDebouncedValue(state.query, 200);
  const dir = useDirection();
  useEffect(() => {
    if (onSearch !== undefined) onSearch(debounced);
  }, [debounced, onSearch]);
  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      {label !== undefined && (
        <label htmlFor={fieldId} className="text-sm font-medium text-gray-700">
          {label}
          {required && (
            <span aria-hidden="true" className="text-danger-700">
              {" *"}
            </span>
          )}
        </label>
      )}
      <PopoverRoot
        open={state.open}
        onOpenChange={(next) => {
          if (next) state.openAndFocus();
          else {
            state.setOpen(false);
            state.onQueryChange("");
          }
        }}
      >
        <PopoverTrigger
          asChild
          onClick={() => (state.open ? state.setOpen(false) : state.openAndFocus())}
        >
          <button
            type="button"
            id={fieldId}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={state.open}
            aria-haspopup="listbox"
            aria-invalid={error !== undefined || undefined}
            disabled={disabled}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md border border-default bg-surface-card px-3 text-sm text-gray-900 outline-none",
              "hover:border-strong data-[placeholder]:text-gray-500 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-gray-400",
              "aria-[invalid=true]:border-danger-700",
              controlCx,
            )}
            data-placeholder={state.selected === undefined ? "true" : undefined}
          >
            <span className={cn("truncate", state.selected === undefined && "text-gray-500")}>
              {state.selected?.label ?? placeholder ?? ""}
            </span>
            <span aria-hidden="true" className="text-xs text-gray-500">▾</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2">
          <input
            ref={state.inputRef}
            value={state.query}
            onChange={(e) => state.onQueryChange(e.target.value)}
            onKeyDown={(e) => state.onKeyDown(e.key)}
            placeholder={placeholder}
            className="mb-2 w-full rounded-md border border-default bg-surface-card px-2 py-1.5 text-sm outline-none focus:border-primary-600"
            {...state.inputProps}
          />
          {loading ? (
            <p className="px-2 py-3 text-sm text-gray-500" aria-live="polite">…</p>
          ) : (
            <ComboboxListbox
              listId={state.listId}
              filtered={state.filtered}
              activeIndex={state.activeIndex}
              value={value}
              onCommit={state.commit}
              empty={emptyText}
              renderItem={(item, active, selected) => (
                <span
                  className={cn(
                    "flex w-full items-center rounded-sm px-2 py-1.5 text-sm",
                    active && "bg-primary-50 text-primary-800",
                    selected && "font-medium",
                    item.disabled && "text-gray-400",
                  )}
                  dir={dir}
                >
                  {item.label}
                </span>
              )}
            />
          )}
        </PopoverContent>
      </PopoverRoot>
      {allowClear && value !== undefined && state.selected !== undefined && (
        <button
          type="button"
          className="self-start text-xs text-gray-500 underline hover:text-gray-700"
          onClick={() => onValueChange?.("")}
          aria-label={typeof label === "string" && label !== "" ? `× ${label}` : "×"}
        >
          ×
        </button>
      )}
      {hint !== undefined && <p className="text-xs text-gray-600">{hint}</p>}
      {error !== undefined && (
        <p className="text-xs text-danger-700" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

export interface CheckboxProps {
  label?: ReactNode;
  checked: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean | "indeterminate") => void;
  error?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/** Checkbox — Space toggles; group = fieldset+legend; tri-state header select-all. */
export function Checkbox({ label, checked, onCheckedChange, error, disabled, invalid, className }: CheckboxProps): JSX.Element {
  const fieldId = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-start gap-2">
        <CheckboxPrimitive
          id={fieldId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          invalid={invalid || error !== undefined}
        />
        {label !== undefined && (
          <label htmlFor={fieldId} className="select-none text-sm text-gray-800 leading-none pt-0.5">
            {label}
          </label>
        )}
      </div>
      {error !== undefined && (
        <p className="text-xs text-danger-700" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

export interface RadioGroupProps {
  label?: string;
  orientation?: "vertical" | "horizontal";
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

/** RadioGroup — arrows move within the group; ≤6 options (else Select). */
export function RadioGroup({ label, orientation, options, value, onValueChange, error, disabled, className }: RadioGroupProps): JSX.Element {
  const name = useId();
  return (
    <fieldset className={cn("flex flex-col gap-2", className)} disabled={disabled}>
      {label !== undefined && <legend className="text-sm font-medium text-gray-700">{label}</legend>}
      <RadioGroupPrimitive value={value} onValueChange={onValueChange} disabled={disabled} orientation={orientation} name={name}>
        {options.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <RadioPrimitive value={o.value} id={`${name}-${o.value}`} disabled={o.disabled} />
            <label htmlFor={`${name}-${o.value}`} className="select-none text-sm text-gray-800">
              {o.label}
            </label>
          </div>
        ))}
      </RadioGroupPrimitive>
      {error !== undefined && (
        <p className="text-xs text-danger-700" aria-live="polite">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export interface SwitchProps {
  label?: ReactNode;
  description?: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** Switch — settings ONLY, never document data (use Checkbox). */
export function Switch({ label, description, checked, onCheckedChange, disabled, className }: SwitchProps): JSX.Element {
  const fieldId = useId();
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <SwitchPrimitive id={fieldId} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <div className="flex flex-col">
        {label !== undefined && (
          <label htmlFor={fieldId} className="select-none text-sm font-medium text-gray-800">
            {label}
          </label>
        )}
        {description !== undefined && <span className="text-xs text-gray-600">{description}</span>}
      </div>
    </div>
  );
}
