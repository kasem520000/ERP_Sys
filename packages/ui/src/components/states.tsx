"use client";

/**
 * EmptyState / LoadingState / ErrorState / Breadcrumbs / Pagination —
 * the state+navigation set (catalog §1 rows; states must exist before
 * first release — "every component tolerates loading/empty/error").
 */
import type { JSX, ReactNode } from "react";
import { useId } from "react";

import { cn } from "../utils/cn";
import { Icon, type IconName } from "../utils/icons";

export function EmptyState({
  icon = "inbox",
  title,
  description,
  primaryAction,
  className,
}: {
  icon?: IconName;
  /** Bilingual display object resolved by the app: {ar,en} — pass the active string. */
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}>
      <Icon name={icon} size={24} className="text-gray-400" />
      <p className="text-sm font-medium text-gray-800">{title}</p>
      {description !== undefined && <p className="max-w-sm text-xs text-gray-600">{description}</p>}
      {primaryAction !== undefined && <div className="mt-2">{primaryAction}</div>}
    </div>
  );
}

export function LoadingState({
  variant = "table",
  rows = 5,
  className,
}: {
  variant?: "table" | "form" | "report";
  rows?: number;
  className?: string;
}): JSX.Element {
  const grid = variant === "table";
  return (
    <div aria-busy="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }).map((_, i) =>
        grid ? (
          <div
            key={i}
            className="h-[var(--erp-density-row-height)] w-full animate-pulse rounded-sm bg-gray-100 motion-reduce:animate-none motion-reduce:bg-gray-100"
          />
        ) : (
          <div key={i} className="h-4 w-2/3 animate-pulse rounded-sm bg-gray-100 motion-reduce:animate-none" />
        ),
      )}
    </div>
  );
}

export function ErrorState({
  title,
  detail,
  retry,
  className,
}: {
  title: string;
  /** Document-safe detail (financial errors must not leak internals). */
  detail?: string;
  retry?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}>
      <Icon name="alert" size={24} className="text-danger-700" />
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {detail !== undefined && <p className="max-w-md text-xs text-gray-600">{detail}</p>}
      {retry !== undefined && <div className="mt-2">{retry}</div>}
    </div>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumbs — nav landmark + aria-current on the last item; separator chevron mirrors. */
export function Breadcrumbs({ items, maxVisible = 4, className }: { items: Crumb[]; maxVisible?: number; className?: string }): JSX.Element {
  const navId = useId();
  const collapsed = items.length > maxVisible;
  const visible = collapsed ? items.slice(-maxVisible + 1) : items;
  return (
    <nav id={navId} aria-label="breadcrumb" className={cn("flex items-center gap-1 text-xs text-gray-600", className)}>
      {collapsed && (
        <>
          <span className="text-gray-500">…</span>
          <Icon name="chevron-end" size={12} className="text-gray-400" />
        </>
      )}
      {visible.map((item, i) => {
        const last = i === visible.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1">
            {item.href !== undefined && !last ? (
              <a href={item.href} className="hover:text-primary-700 hover:underline">
                {item.label}
              </a>
            ) : (
              <span aria-current={last ? "page" : undefined} className={cn(last && "font-medium text-gray-800")}>
                {item.label}
              </span>
            )}
            {!last && <Icon name="chevron-end" size={12} className="text-gray-400" />}
          </span>
        );
      })}
    </nav>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 25, 50, 100],
  announceLabel,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
  /** e.g. "صفحة 3 من 12" — announced politely per catalog row. */
  announceLabel?: string;
  className?: string;
}): JSX.Element {
  // eslint-disable-next-line no-restricted-properties -- page-count geometry, not money math (ADR-0009).
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const status = announceLabel ?? `${page} / ${pages}`;
  return (
    <div className={cn("flex items-center justify-between gap-3 border-t border-subtle px-3 py-2", className)}>
      <p aria-live="polite" className="text-xs text-gray-600 tabular-nums">
        {status}
      </p>
      <div className="flex items-center gap-1">
        {onPageSizeChange !== undefined && (
          <select
            aria-label="page size"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="me-2 rounded-md border border-default bg-surface-card px-1.5 py-0.5 text-xs tabular-nums outline-none"
          >
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          aria-label="first page"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          className="rounded-md p-1 text-gray-600 outline-none hover:bg-surface-sunken disabled:opacity-40"
        >
          <Icon name="chevrons-start" size={16} />
        </button>
        <button
          type="button"
          aria-label="previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="rounded-md p-1 text-gray-600 outline-none hover:bg-surface-sunken disabled:opacity-40"
        >
          <Icon name="chevron-start" size={16} />
        </button>
        <span className="px-1 font-mono text-xs tabular-nums text-gray-700">
          {page}/{pages}
        </span>
        <button
          type="button"
          aria-label="next page"
          disabled={page >= pages}
          onClick={() => onPageChange(Math.min(pages, page + 1))}
          className="rounded-md p-1 text-gray-600 outline-none hover:bg-surface-sunken disabled:opacity-40"
        >
          <Icon name="chevron-end" size={16} />
        </button>
        <button
          type="button"
          aria-label="last page"
          disabled={page >= pages}
          onClick={() => onPageChange(pages)}
          className="rounded-md p-1 text-gray-600 outline-none hover:bg-surface-sunken disabled:opacity-40"
        >
          <Icon name="chevrons-end" size={16} />
        </button>
      </div>
    </div>
  );
}
