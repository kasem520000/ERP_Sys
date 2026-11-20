"use client";

/**
 * PHASE-048 (W-12 — T-14; extracted W-13 — T-15 for the second and third
 * projects boards): THE TYPED-REFUSAL PANEL — the owner's W-12 clause 2,
 * now the projects web plane's shared piece: a refusal renders the code +
 * the message + the FULL details payload as rows (the cycle path, the
 * ceiling's figures, the four legs — never a generic error). Behavior-
 * preserving extraction from projects-wbs-board.tsx (the W-12 board's own
 * component test unchanged and green is the no-regression proof).
 */
import type { JSX } from "react";

import type { ApiErrorBody } from "../lib/api-types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function TypedRefusalPanel({
  error,
  title,
  detailsLabel,
}: {
  error: ApiErrorBody;
  title: string;
  detailsLabel: string;
}): JSX.Element {
  const rows: { key: string; value: string }[] = [];
  if (isRecord(error.details)) {
    for (const [key, value] of Object.entries(error.details)) {
      rows.push({
        key,
        value:
          typeof value === "string"
            ? value
            : typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : JSON.stringify(value),
      });
    }
  }
  return (
    <div
      role="alert"
      className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-text"
      data-testid="typed-refusal"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 font-mono text-xs" dir="ltr">
        {error.code}
      </p>
      <p className="mt-2">{error.message}</p>
      {rows.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs">{detailsLabel}</p>
          <dl className="mt-1 flex flex-col gap-1">
            {rows.map((row) => (
              <div key={row.key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="font-mono text-xs sm:w-44 sm:shrink-0" dir="ltr">
                  {row.key}
                </dt>
                <dd className="min-w-0 font-mono text-xs" dir="ltr">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
