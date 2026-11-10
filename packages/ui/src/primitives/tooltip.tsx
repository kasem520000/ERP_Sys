"use client";

/** Tooltip primitive — Radix Tooltip, 300ms delay (catalog row), z-tooltip. */
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";
import { COLLISION_PADDING, portalZ } from "./_shared";

export const TooltipProvider = RadixTooltip.Provider;

export function TooltipRoot({
  content,
  children,
  shortcut,
  disabled,
}: {
  content: ReactNode;
  children: ReactNode;
  /** Optional shortcut hint rendered at the inline end. */
  shortcut?: string;
  disabled?: boolean;
}): ReactNode {
  if (disabled) return <>{children}</>;
  // Self-contained: radix ≥1.1 throws "`Tooltip` must be used within
  // `TooltipProvider`" without an ancestor — every consumer would crash
  // (story fixtures AND the real app's collapsed sidebar). Embedding the
  // Provider keeps the wrapper the single legal Radix site with no
  // caller-side wiring (nested Providers are sanctioned by Radix).
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          collisionPadding={COLLISION_PADDING}
          className={cn(
            "flex items-center gap-2 rounded-md border border-strong bg-gray-900 px-2 py-1 text-xs text-white shadow-e3 outline-none",
            portalZ.tooltip,
          )}
        >
          {content}
          {shortcut !== undefined && (
            <kbd className="rounded-sm border border-strong bg-gray-800 px-1 font-mono text-xs text-gray-200">
              {shortcut}
            </kbd>
          )}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
