/**
 * P5-T12 — DefList: the description-list pattern for detail/profile cards
 * (accept-invitation, dashboard, platform tenant profile). Labels read as
 * the muted term, values as the strong value; mixed-script values stay
 * LTR-isolated where the caller marks them mono.
 */
import type { JSX, ReactNode } from "react";

import { cx } from "../lib/cx";

export interface DefItem {
  term: string;
  children: ReactNode;
}

export function DefList({ items, className }: { items: DefItem[]; className?: string }): JSX.Element {
  return (
    <dl className={cx("flex flex-col gap-2", className)}>
      {items.map((item) => (
        <div key={item.term} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <dt className="text-xs text-gray-600 sm:w-40 sm:shrink-0">{item.term}</dt>
          <dd className="min-w-0 text-sm text-gray-900">{item.children}</dd>
        </div>
      ))}
    </dl>
  );
}
