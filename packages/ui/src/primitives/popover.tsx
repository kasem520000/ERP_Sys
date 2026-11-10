"use client";

/** Popover primitive — Radix Popover with logical align + token surface. */
import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";
import { useDirection } from "../utils/direction";
import { COLLISION_PADDING, portalZ, surfaceCx } from "./_shared";

export const PopoverRoot = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({
  children,
  className,
  align = "start",
  width,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "end" | "center";
  /** Optional explicit width (filter menus align to trigger by default). */
  width?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixPopover.Content>, "align">): ReactNode {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        dir={useDirection()}
        align={align}
        sideOffset={6}
        collisionPadding={COLLISION_PADDING}
        className={cn(surfaceCx, portalZ.popover, "p-3", className)}
        style={width ? { width } : undefined}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
