"use client";

/**
 * PHASE-024 T8 — the tenant audit-review filter form (the platform/audit
 * filter pattern): action/actor/entity/correlation text inputs + fromAt/toAt
 * datetime-local inputs + the limit select. Submits through the router so
 * the filters stay URL-encoded and shareable (the server page re-runs the
 * same filter set against GET /audit/events and the CSV export anchor).
 *
 * datetime-local values (YYYY-MM-DDTHH:mm) are converted to the API's
 * zod datetime() shape (UTC, Z-suffixed) on submit; the initial values
 * round-trip back from the ISO instant in the URL. The inputs are raw
 * <input type="datetime-local"> elements — the house Input's type union has
 * no datetime-local (the file-input precedent in treasury-bank-rec) — with
 * the house control classes so heights match the sibling Selects.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";

const LIMIT_OPTIONS = [50, 100, 200, 500] as const;
const DEFAULT_LIMIT = 200;

/** The selectable row limits (exported for the server page's param parsing). */
export const AUDIT_LIMIT_OPTIONS: readonly number[] = LIMIT_OPTIONS;
export const AUDIT_DEFAULT_LIMIT = DEFAULT_LIMIT;

/** datetime-local (16 or 19 chars) → the API's ISO datetime (UTC, Z-suffixed). */
function localToIso(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (trimmed.length === 16) {
    return `${trimmed}:00Z`;
  }
  if (trimmed.length === 19) {
    return `${trimmed}Z`;
  }
  return trimmed.endsWith("Z") ? trimmed : undefined;
}

/** ISO instant → the datetime-local input shape (first 16 chars). */
function isoToLocal(value: string): string {
  return value.length >= 16 ? value.slice(0, 16) : "";
}

export function AuditReviewFilterForm({
  locale,
  initial,
}: {
  locale: Locale;
  initial: {
    action: string;
    actorId: string;
    entityType: string;
    entityId: string;
    correlationId: string;
    fromAt: string;
    toAt: string;
    limit: number;
  };
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [action, setAction] = useState(initial.action);
  const [actorId, setActorId] = useState(initial.actorId);
  const [entityType, setEntityType] = useState(initial.entityType);
  const [entityId, setEntityId] = useState(initial.entityId);
  const [correlationId, setCorrelationId] = useState(initial.correlationId);
  const [fromAt, setFromAt] = useState(isoToLocal(initial.fromAt));
  const [toAt, setToAt] = useState(isoToLocal(initial.toAt));
  const [limit, setLimit] = useState<string>(String(initial.limit));

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams();
    if (action.trim() !== "") {
      params.set("action", action.trim());
    }
    if (actorId.trim() !== "") {
      params.set("actorId", actorId.trim());
    }
    if (entityType.trim() !== "") {
      params.set("entityType", entityType.trim());
    }
    if (entityId.trim() !== "") {
      params.set("entityId", entityId.trim());
    }
    if (correlationId.trim() !== "") {
      params.set("correlationId", correlationId.trim());
    }
    const fromIso = localToIso(fromAt);
    if (fromIso !== undefined) {
      params.set("fromAt", fromIso);
    }
    const toIso = localToIso(toAt);
    if (toIso !== undefined) {
      params.set("toAt", toIso);
    }
    params.set("limit", String(limit));
    router.push(`/${locale}/audit?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
      <div className="w-full max-w-xs">
        <Input
          label={d.auditFilterAction}
          value={action}
          onValueChange={setAction}
          mono
          bidiIsolate
        />
      </div>
      <div className="w-full max-w-xs">
        <Input
          label={d.auditFilterActorId}
          value={actorId}
          onValueChange={setActorId}
          mono
          bidiIsolate
        />
      </div>
      <div className="w-full max-w-xs">
        <Input
          label={d.auditFilterEntityType}
          value={entityType}
          onValueChange={setEntityType}
          mono
          bidiIsolate
        />
      </div>
      <div className="w-full max-w-xs">
        <Input
          label={d.auditFilterEntityId}
          value={entityId}
          onValueChange={setEntityId}
          mono
          bidiIsolate
        />
      </div>
      <div className="w-full max-w-xs">
        <Input
          label={d.auditFilterCorrelationId}
          value={correlationId}
          onValueChange={setCorrelationId}
          mono
          bidiIsolate
        />
      </div>
      <div className="flex w-full flex-col gap-1 sm:w-56">
        <label htmlFor="audit-from-at" className="text-sm font-medium text-gray-700">
          {d.auditFilterFromAt}
        </label>
        <input
          id="audit-from-at"
          type="datetime-local"
          dir="ltr"
          value={fromAt}
          onChange={(event) => setFromAt(event.target.value)}
          className="h-[var(--erp-density-control-height)] w-full rounded-md border border-default bg-surface-card px-3 font-mono text-sm tabular-nums text-gray-900 outline-none hover:border-strong focus:border-primary-600"
        />
      </div>
      <div className="flex w-full flex-col gap-1 sm:w-56">
        <label htmlFor="audit-to-at" className="text-sm font-medium text-gray-700">
          {d.auditFilterToAt}
        </label>
        <input
          id="audit-to-at"
          type="datetime-local"
          dir="ltr"
          value={toAt}
          onChange={(event) => setToAt(event.target.value)}
          className="h-[var(--erp-density-control-height)] w-full rounded-md border border-default bg-surface-card px-3 font-mono text-sm tabular-nums text-gray-900 outline-none hover:border-strong focus:border-primary-600"
        />
      </div>
      <div className="w-full max-w-32">
        <Select
          label={d.auditFilterLimit}
          value={String(limit)}
          onValueChange={setLimit}
          options={LIMIT_OPTIONS.map((value) => ({ value: String(value), label: String(value) }))}
        />
      </div>
      <Button type="submit" variant="primary">
        {d.auditFilterApply}
      </Button>
    </form>
  );
}
