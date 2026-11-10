"use client";

/**
 * Input / Textarea / NumberInput / SearchInput (COMPONENT_CATALOG §1 rows).
 * label bound via for/id; error via aria-describedby + aria-invalid; `mono`
 * for codes; `bidiIsolate` isolates mixed-script values (RTL §5) — never
 * `dir="auto"` on constrained fields (RTL_AND_LTR §6).
 */
import type { JSX, ReactNode } from "react";
import { useId } from "react";
import { Search, X } from "lucide-react";

import { bidiIsolateStyle } from "../utils/bidi";
import { cn } from "../utils/cn";
import { controlCx } from "../utils/direction";

export interface InputProps {
  label?: string;
  value: string;
  onValueChange?: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  mono?: boolean;
  /** Isolate mixed-script runs (tax no., IBAN, email, document numbers). */
  bidiIsolate?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  type?: "text" | "password" | "email" | "tel" | "url";
  inputMode?: "text" | "decimal" | "numeric";
  autoComplete?: string;
  name?: string;
  id?: string;
  onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  "aria-label"?: string;
  /** Stable play-function target (visual-harness conventions). */
  "data-testid"?: string;
}

function FieldShell({
  label,
  error,
  hint,
  required,
  fieldId,
  children,
  className,
}: {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  fieldId: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
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
      <div className="relative flex w-full items-center">
        {children}
      </div>
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-gray-600">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-xs text-danger-700" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  label,
  value,
  onValueChange,
  error,
  hint,
  placeholder,
  disabled,
  readOnly,
  required,
  mono,
  bidiIsolate,
  prefix,
  suffix,
  type = "text",
  inputMode,
  autoComplete,
  name,
  id,
  onPaste,
  onFocus,
  onBlur,
  onKeyDown,
  className,
  ...rest
}: InputProps): JSX.Element {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const invalid = error !== undefined;
  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      required={required}
      fieldId={fieldId}
      className={className}
    >
      {prefix !== undefined && (
        <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-2 text-sm text-gray-500">
          {prefix}
        </span>
      )}
      <input
        id={fieldId}
        name={name}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={hint !== undefined || error !== undefined ? `${fieldId}-hint ${fieldId}-error` : undefined}
        autoComplete={autoComplete}
        style={bidiIsolate ? bidiIsolateStyle : undefined}
        className={cn(
          "w-full rounded-md border border-default bg-surface-card px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400",
          "hover:border-strong focus:border-primary-600",
          "disabled:cursor-not-allowed disabled:border-subtle disabled:bg-surface-sunken disabled:text-gray-400",
          "read-only:bg-surface-sunken",
          "aria-[invalid=true]:border-danger-700",
          controlCx,
          mono && "font-mono tabular-nums",
          prefix !== undefined && "ps-8",
          suffix !== undefined && "pe-10",
        )}
        {...rest}
      />
      {suffix !== undefined && (
        <span className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-3 text-sm text-gray-500">
          {suffix}
        </span>
      )}
    </FieldShell>
  );
}

export interface TextareaProps extends Omit<InputProps, "type" | "prefix" | "suffix" | "mono" | "bidiIsolate"> {
  rows?: number;
  maxLength?: number;
}

export function Textarea({
  label,
  value,
  onValueChange,
  error,
  hint,
  placeholder,
  disabled,
  readOnly,
  required,
  rows = 3,
  maxLength,
  id,
  name,
  className,
}: TextareaProps): JSX.Element {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const invalid = error !== undefined;
  const remaining = maxLength !== undefined ? maxLength - value.length : undefined;
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} fieldId={fieldId} className={className}>
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onValueChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={hint !== undefined || error !== undefined ? `${fieldId}-hint ${fieldId}-error` : undefined}
        className={cn(
          "w-full resize-y rounded-md border border-default bg-surface-card px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400",
          "hover:border-strong focus:border-primary-600 disabled:bg-surface-sunken disabled:text-gray-400",
          "aria-[invalid=true]:border-danger-700",
        )}
      />
      {remaining !== undefined && remaining <= 20 && (
        <p aria-live="polite" className="text-xs text-gray-600">
          {remaining}
        </p>
      )}
    </FieldShell>
  );
}

/** NumberInput — quantities/discount %/rates. inputMode=decimal; money → MoneyInput. */
export function NumberInput({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  allowNegative = false,
  unitSuffix,
  error,
  hint,
  disabled,
  required,
  id,
  name,
  className,
}: {
  label?: string;
  value: string;
  onValueChange?: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  allowNegative?: boolean;
  unitSuffix?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
}): JSX.Element {
  void min; void max; void step; // native attrs land with the form integration phases; clamp/step validated on commit
  const sanitize = (raw: string): string => {
    let next = raw.replace(/[^\d.-]/g, "");
    if (!allowNegative) next = next.replace(/-/g, "");
    else next = next.replace(/-/g, (m, off: number) => (off === 0 ? m : ""));
    next = next.replace(/(\..*)\./g, "$1");
    return next;
  };
  return (
    <Input
      label={label}
      value={value}
      onValueChange={(next) => onValueChange?.(sanitize(next))}
      error={error}
      hint={hint}
      disabled={disabled}
      required={required}
      id={id}
      name={name}
      mono
      inputMode="decimal"
      suffix={unitSuffix}
      className={className}
    />
  );
}

/** SearchInput — list headers (role=searchbox, clear announced; global search is CommandMenu). */
export function SearchInput({
  value,
  onValueChange,
  onDebouncedChange,
  placeholder,
  label,
  className,
  disabled,
}: {
  value: string;
  onValueChange?: (value: string) => void;
  onDebouncedChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}): JSX.Element {
  const timer = useDebouncedCallback();
  const fieldId = useId();
  return (
    <div className={cn("relative flex items-center", className)}>
      <Search width={16} height={16} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute start-3 text-gray-500" />
      <input
        id={fieldId}
        role="searchbox"
        type="search"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onValueChange?.(e.target.value);
          timer(e.target.value, 200, (v) => onDebouncedChange?.(v));
        }}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className={cn(
          "w-full rounded-md border border-default bg-surface-card ps-9 pe-8 text-sm text-gray-900 outline-none placeholder:text-gray-400",
          "hover:border-strong focus:border-primary-600 disabled:bg-surface-sunken disabled:text-gray-400",
          controlCx,
        )}
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="clear search"
          onClick={() => {
            onValueChange?.("");
            onDebouncedChange?.("");
          }}
          className="absolute end-2 rounded-sm p-0.5 text-gray-500 hover:text-gray-700"
        >
          <X width={14} height={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** 200ms debounce hook (SearchInput + Combobox contract). */
import { useCallback, useEffect, useRef, useState } from "react";

export function useDebouncedCallback(): ((value: string, ms: number, fire: (value: string) => void) => void) {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (ref.current !== null) clearTimeout(ref.current);
  }, []);
  return useCallback((value: string, ms: number, fire: (value: string) => void) => {
    if (ref.current !== null) clearTimeout(ref.current);
    ref.current = setTimeout(() => fire(value), ms);
  }, []);
}

export function useDebouncedValue(value: string, ms = 200): string {
  const [debounced, setDebounced] = useState(value);
  const set = useDebouncedCallback();
  useEffect(() => {
    set(value, ms, setDebounced);
  }, [value, ms, set]);
  return debounced;
}
