"use client";

/**
 * Button / IconButton (COMPONENT_CATALOG §1 rows). One `primary` per view
 * region; destructive = danger + confirm dialog (ACCESSIBILITY §6: Enter
 * never maps to destructive). `loading` keeps width stable + aria-busy.
 */
import type { JSX, MouseEvent, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { cn } from "../utils/cn";
import { Icon, type IconName } from "../utils/icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-700",
  secondary: "bg-surface-card text-gray-800 border border-default hover:border-strong hover:bg-surface-sunken",
  ghost: "bg-transparent text-gray-700 hover:bg-surface-sunken",
  danger: "bg-danger-700 text-white hover:bg-danger-text",
};

const SIZES = { sm: "h-7 gap-1 px-2 text-xs", md: "h-[var(--erp-density-control-height)] gap-2 px-3 text-sm" } as const;

export interface ButtonProps {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  disabled?: boolean;
  iconStart?: IconName;
  iconEnd?: IconName;
  type?: "button" | "submit" | "reset";
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  "aria-label"?: string;
  name?: string;
  value?: string;
  form?: string;
  /** Stable play-function target (visual-harness conventions). */
  "data-testid"?: string;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled = false,
  iconStart,
  iconEnd,
  type = "button",
  onClick,
  className,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-md font-medium whitespace-nowrap outline-none",
        "transition-colors duration-150 ease-standard",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle width={16} height={16} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />
      ) : (
        iconStart !== undefined && <Icon name={iconStart} size={16} />
      )}
      {children}
      {!loading && iconEnd !== undefined && <Icon name={iconEnd} size={16} />}
    </button>
  );
}

/** IconButton — `label` is REQUIRED (aria-label + tooltip); ≥44px on touch. */
export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  disabled = false,
  onClick,
  className,
  type = "button",
}: {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  type?: "button" | "submit";
}): JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-md outline-none transition-colors duration-150 ease-standard",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        size === "sm" ? "h-7 w-7" : "h-[var(--erp-density-control-height)] min-w-[var(--erp-density-touch-target)] w-[var(--erp-density-touch-target)]",
        className,
      )}
    >
      <Icon name={icon} size={size === "sm" ? 16 : 20} />
    </button>
  );
}
