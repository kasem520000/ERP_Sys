"use client";
/**
 * PHASE-021 T2-b · the console form kit (DR-P21-06/§6): the shared field
 * scaffolding + the zod-issue → per-field AR/EN error mapping. The forms
 * validate through the SAME frozen @erp/contracts schemas the server
 * handlers use (the builders call `.parse`); this module turns a
 * ZodError's issues into bilingual field errors — one presentation path,
 * never a second business rule.
 */
import type { JSX, ReactNode } from "react";
import type { ZodIssue } from "zod";

import type { Dictionary } from "../../../i18n/dictionaries";
import { ShellStoreRefusedError } from "../../../lib/shell/store-client";

/** The bilingual message for an enqueue refusal (the async write gate). */
export function enqueueErrorMessage(error: unknown, d: Dictionary): string {
  if (error instanceof ShellStoreRefusedError) {
    return d.offlineReadOnlyGate;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return d.offlineReadOnlyGate;
}

/** A labeled field shell: label (+ optional marker), control, error, hint. */
export function FieldShell({
  locale,
  label,
  optional,
  error,
  hint,
  children,
}: {
  locale: "ar" | "en";
  label: string;
  /** The localized "optional" word (d.offlineFieldOptional). */
  optional?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span lang={locale} className="text-sm font-medium text-gray-800">
        {label}
        {optional !== undefined && <span className="ms-1 font-normal text-gray-500">— {optional}</span>}
      </span>
      {children}
      {hint !== undefined && error === undefined && (
        <span lang={locale} className="text-xs text-gray-500">
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span lang={locale} role="alert" className="text-xs text-danger-text">
          {error}
        </span>
      )}
    </div>
  );
}

/** The grid the forms lay their fields on (responsive, RTL-safe). */
export const FORM_GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-2";

/**
 * Map zod issues to bilingual field errors keyed by the issue path
 * (dotted; `lines.0.itemId` stays as-is — line editors read their own
 * errors by index). Issue kinds (zod v4): invalid_type/undefined →
 * required; invalid_format uuid → uuid; invalid_format regex → the
 * per-field decimal/date rule; too_small/too_big on arrays → the line
 * count bounds; string bounds → length messages.
 */
export function mapZodIssues(issues: readonly ZodIssue[], d: Dictionary): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map((segment) => String(segment)).join(".");
    const key = path === "" ? "_form" : path;
    if (errors[key] !== undefined) continue;
    errors[key] = messageForIssue(issue, path, d);
  }
  return errors;
}

function messageForIssue(issue: ZodIssue, path: string, d: Dictionary): string {
  const tail = path.split(".").pop() ?? path;
  if (issue.code === "invalid_type" && (issue as { received?: unknown }).received === undefined) {
    return d.offlineErrRequired;
  }
  if (issue.code === "invalid_format") {
    const format = (issue as { format?: string }).format;
    if (format === "uuid") return d.offlineErrUuid;
    if (format === "date" || format === "datetime") return d.offlineErrDate;
    // regex failures — resolve by the field's wire shape
    if (tail === "qty") return d.offlineErrQty;
    if (tail === "countedQty") return d.offlineErrCountedQty;
    if (tail === "unitPrice") return d.offlineErrUnitPrice;
    if (tail === "amount" || tail === "creditLimit") return d.offlineErrMoney;
    if (tail === "discountAmount" || tail === "feeAmount") return d.offlineErrMoney;
    if (tail === "exchangeRate") return d.offlineErrFx;
    if (tail === "currencyCode") return d.offlineErrCurrency;
    if (tail === "kind") return d.offlineErrKind;
  }
  if (issue.code === "too_small") {
    if (issue.origin === "array") return d.offlineErrLinesMin;
    return d.offlineErrMinLen;
  }
  if (issue.code === "too_big") {
    if (issue.origin === "array") return d.offlineErrLinesMax;
    return d.offlineErrMaxLen;
  }
  // unknown issue shape — the zod message is the honest fallback
  return issue.message.length > 0 ? issue.message : d.offlineErrRequired;
}
