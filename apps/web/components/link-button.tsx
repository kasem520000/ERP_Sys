/**
 * P5-T12 — LinkButton: an anchor styled with the @erp/ui Button token
 * classes (Button renders a <button> and cannot carry href; navigational
 * "buttons" — wizard exits, pagination cursors, register success — compose
 * the same token classes on <a> app-side).
 */
import type { JSX, ReactNode } from "react";

import { cx } from "../lib/cx";

const VARIANTS = {
  primary: "bg-primary-600 text-white hover:bg-primary-700",
  secondary:
    "bg-surface-card text-gray-800 border border-default hover:border-strong hover:bg-surface-sunken",
  ghost: "bg-transparent text-gray-700 hover:bg-surface-sunken",
} as const;

export function LinkButton({
  href,
  variant = "secondary",
  children,
  className,
  ariaLabel,
}: {
  href: string;
  variant?: keyof typeof VARIANTS;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className={cx(
        "inline-flex h-[var(--erp-density-control-height)] select-none items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none",
        "transition-colors duration-150 ease-standard",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </a>
  );
}
