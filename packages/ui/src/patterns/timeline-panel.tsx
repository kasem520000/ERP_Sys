"use client";

/**
 * TimelinePanel (PHASE-027 pattern; COMPONENT_CATALOG §3): the append-only
 * event-log reader — an ordered, tone-marked vertical trail for custody /
 * audit histories (note_events is the first consumer; the audit + sync
 * consoles follow). Purely presentational and headless by contract: the app
 * supplies localized titles/subtitles and picks the tone; the panel never
 * embeds business words. `locale` is bilingual plumbing only — it sets the
 * section's `lang` (screen-reader voice selection; never `dir`: the app
 * shell owns direction per RTL_DESIGN_RULES §2). RTL-correct through
 * logical utilities only, so the trail grows from the inline-start edge
 * and keeps the same visual rhythm in both directions; the connector line
 * and markers are decorative (aria-hidden) so the list reads as a plain
 * ordered list to assistive tech.
 */
import type { JSX } from "react";

import { cn } from "../utils/cn";
import { Icon, type IconName } from "../utils/icons";

/** Marker tone — the fixed vocabulary (neutral trail + semantic outliers). */
export type TimelineTone = "default" | "positive" | "warning" | "critical";

export interface TimelineItem {
  /** Event date — ISO (YYYY-MM-DD) renders LTR-isolated mono. */
  date: string;
  /** Stable event code (e.g. "DEPOSIT") — rendered as a mono chip, never localized here. */
  kind: string;
  /** Localized event title (the app resolves bilingual labels). */
  title: string;
  /** Optional localized secondary line (memo, actor, amounts). */
  subtitle?: string;
  /** Marker tone (default = neutral trail dot). */
  tone?: TimelineTone;
  /** Optional registry icon rendered inside the marker. */
  icon?: IconName;
}

export interface TimelinePanelProps {
  /** Content locale ("ar" | "en") — sets the section's `lang` (bilingual-ready voice selection); direction stays ambient (RTL §2). */
  locale?: "ar" | "en";
  /** Optional visible heading (also the section's accessible name). */
  title?: string;
  items: readonly TimelineItem[];
  /** Rendered when the log is empty (never a fabricated row). */
  emptyText?: string;
  className?: string;
}

/** Fixed tone → marker token classes (the Badge token map precedent). */
const TONE_MARKER_CLASSES: Record<TimelineTone, string> = {
  default: "border-primary-200 bg-primary-50 text-primary-700",
  positive: "border-success-border bg-success-bg text-success-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  critical: "border-danger-border bg-danger-bg text-danger-text",
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function TimelinePanel({ locale, title, items, emptyText, className }: TimelinePanelProps): JSX.Element {
  return (
    <section
      lang={locale}
      aria-label={title}
      data-testid="timeline-panel"
      className={cn("rounded-lg border bg-surface", className)}
    >
      {title !== undefined && (
        <h3 className="border-b px-4 py-3 text-sm font-semibold">{title}</h3>
      )}
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground" data-testid="timeline-panel-empty">
          {emptyText ?? "—"}
        </p>
      ) : (
        <ol className="flex flex-col gap-5 border-s border-subtle px-4 py-4 ps-5">
          {items.map((item, index) => (
            <li key={`${item.date}-${item.kind}-${index}`} className="relative">
              {/* decorative marker centered on the connector (RTL: start edge) */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -start-7 top-0 flex size-4 items-center justify-center rounded-full border-2",
                  TONE_MARKER_CLASSES[item.tone ?? "default"],
                )}
              >
                {item.icon !== undefined ? (
                  <Icon name={item.icon} size={12} />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <div className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <time
                    dateTime={ISO_DATE_RE.test(item.date) ? item.date : undefined}
                    className="font-mono text-xs tabular-nums text-muted-foreground"
                    dir="ltr"
                  >
                    {item.date}
                  </time>
                  <span
                    className="rounded-sm border border-subtle bg-gray-100 px-1.5 py-0.5 font-mono text-xs leading-4 text-gray-600"
                    dir="ltr"
                  >
                    {item.kind}
                  </span>
                </div>
                <span className="text-sm font-medium">{item.title}</span>
                {item.subtitle !== undefined && item.subtitle !== "" && (
                  <span className="text-xs text-muted-foreground">{item.subtitle}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
