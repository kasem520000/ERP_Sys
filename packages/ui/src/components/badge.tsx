"use client";

/**
 * Badge + DocumentStatusBadge (§6.4 NORMATIVE) + DocumentActions — the
 * lifecycle vocabulary components. Tones are FIXED to the token map; text
 * comes from the app i18n bundle (`enums.document_status.*`).
 */
import type { JSX, ReactNode } from "react";

import { cn } from "../utils/cn";
import { Icon } from "../utils/icons";
import { bidiIsolateStyle } from "../utils/bidi";
import { DropdownContent, DropdownItem, DropdownRoot, DropdownTrigger } from "../primitives/dropdown";
import {
  DOCUMENT_STATUS_STYLE,
  DOCUMENT_TRANSITIONS,
  type DocumentActionId,
  type DocumentStatus,
  type StatusTone,
} from "../utils/status";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-subtle bg-gray-100 text-gray-600",
  primary: "border-primary-200 bg-primary-50 text-primary-800",
  info: "border-info-border bg-info-bg text-info-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  success: "border-success-border bg-success-bg text-success-text",
  "success-info": "border-success-info-border bg-success-info-bg text-success-info-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
};

export interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "primary";
  mono?: boolean;
  /** Isolate mixed-script content (codes, numbers) — RTL §5. */
  bidiIsolate?: boolean;
  className?: string;
}

/** Badge — counts/codes/categories; statuses MUST use DocumentStatusBadge. */
export function Badge({ children, tone = "neutral", mono, bidiIsolate, className }: BadgeProps): JSX.Element {
  return (
    <span
      style={bidiIsolate ? bidiIsolateStyle : undefined}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4",
        TONE_CLASSES[tone === "primary" ? "primary" : tone],
        mono && "font-mono tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface DocumentStatusBadgeProps {
  status: DocumentStatus;
  /** App-i18n resolved label (component ships the mapping, not translations). */
  label: string;
  showIcon?: boolean;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}

/** DocumentStatusBadge — one component renders the lifecycle vocabulary everywhere. */
export function DocumentStatusBadge({
  status,
  label,
  showIcon = true,
  size = "sm",
  title,
  className,
}: DocumentStatusBadgeProps): JSX.Element {
  // Fixed vocabulary map; an unknown status degrades to neutral instead of
  // crashing a screen (the vocabulary change itself needs a decision record).
  const style = DOCUMENT_STATUS_STYLE[status] ?? { tone: "neutral" as const, icon: "circle" as const };
  return (
    <span
      title={title ?? label}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5",
        TONE_CLASSES[style.tone],
        size === "sm" ? "text-xs leading-4" : "text-sm leading-5",
        className,
      )}
    >
      {showIcon && <Icon name={style.icon} size={12} />}
      <span className={cn(style.strikethrough === true && "line-through")}>{label}</span>
    </span>
  );
}

export interface DocumentActionsProps {
  status: DocumentStatus;
  /** App-i18n action labels keyed by action id. */
  labels: Record<DocumentActionId, string>;
  onAction: (action: DocumentActionId) => void;
  /** `post`/`reverse`/`cancel` are destructive-or-critical: app confirms. */
  disabled?: boolean;
  triggerLabel?: string;
  className?: string;
}

/**
 * DocumentActions — the transition menu derived from the SAME lifecycle table
 * (DOCUMENT_LIFECYCLE §2): submit/approve/post/reverse/cancel appear only
 * where the state permits.
 */
export function DocumentActions({
  status,
  labels,
  onAction,
  disabled,
  triggerLabel,
  className,
}: DocumentActionsProps): JSX.Element {
  const actions = DOCUMENT_TRANSITIONS[status];
  if (actions.length === 0) return <span aria-hidden="true" className={cn("hidden", className)} />;
  const critical = new Set<DocumentActionId>(["reverse", "cancel"]);
  return (
    <DropdownRoot>
      <DropdownTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-default bg-surface-card px-2 py-1 text-sm text-gray-700 outline-none hover:border-strong disabled:opacity-50",
            className,
          )}
        >
          {triggerLabel ?? labels.post}
          <Icon name="chevron-down" size={14} />
        </button>
      </DropdownTrigger>
      <DropdownContent align="end">
        {actions.map((action) => (
          <DropdownItem
            key={action}
            tone={critical.has(action) ? "danger" : "default"}
            onSelect={() => onAction(action)}
          >
            {labels[action]}
          </DropdownItem>
        ))}
      </DropdownContent>
    </DropdownRoot>
  );
}
