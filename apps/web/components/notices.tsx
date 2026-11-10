/**
 * P5-T12 — inline feedback notices (success / error / info) composed from
 * @erp/ui semantic token classes. Pure presentational — usable from server
 * pages and client forms alike. Errors announce via role="alert", success
 * via role="status", notes via role="note".
 */
import type { JSX, ReactNode } from "react";

import { cx } from "../lib/cx";

export function SuccessNotice({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <p
      role="status"
      className={cx(
        "rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success-text",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function ErrorNotice({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <p
      role="alert"
      className={cx(
        "rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-text",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function InfoNotice({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <p
      role="note"
      className={cx(
        "rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text",
        className,
      )}
    >
      {children}
    </p>
  );
}
