/**
 * P5-T12 — Card: the app-side card surface composed from @erp/ui tokens
 * (the catalog deliberately ships no Card; apps compose the token classes
 * per DESIGN_SYSTEM §4). Pure presentational — safe in server and client
 * components alike.
 */
import type { JSX, ReactNode } from "react";

import { cx } from "../lib/cx";

export function Card({
  title,
  description,
  actions,
  ariaLabel,
  children,
  className,
}: {
  title?: string;
  description?: string;
  /** P7-T18 — optional header action rail (primary "+ New" links etc.). */
  actions?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section
      aria-label={ariaLabel}
      className={cx("rounded-lg border border-subtle bg-surface-card p-4 shadow-e1", className)}
    >
      {title !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-md font-semibold text-gray-900">{title}</h2>
          {actions}
        </div>
      )}
      {description !== undefined && <p className="mt-1 text-sm text-gray-600">{description}</p>}
      <div className={cx(title !== undefined || description !== undefined ? "mt-3" : undefined)}>
        {children}
      </div>
    </section>
  );
}
