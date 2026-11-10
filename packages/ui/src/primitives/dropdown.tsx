"use client";

/** Dropdown primitive — Radix DropdownMenu with token surface + RTL dir. */
import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";
import { COLLISION_PADDING, portalZ, surfaceCx } from "./_shared";

export const DropdownRoot = ({ dir, ...rest }: { dir?: "rtl" | "ltr" } & React.ComponentPropsWithoutRef<typeof RadixDropdown.Root>) => <RadixDropdown.Root dir={dir ?? undefined} {...rest} />;
export const DropdownTrigger = RadixDropdown.Trigger;
export const DropdownGroup = RadixDropdown.Group;

export function DropdownContent({
  children,
  className,
  align = "start",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "end" | "center";
} & Omit<React.ComponentPropsWithoutRef<typeof RadixDropdown.Content>, "align">): ReactNode {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        align={align}
        sideOffset={6}
        collisionPadding={COLLISION_PADDING}
        className={cn(surfaceCx, portalZ.dropdown, "min-w-40 p-1", className)}
        {...rest}
      >
        {children}
      </RadixDropdown.Content>
    </RadixDropdown.Portal>
  );
}

export function DropdownItem({
  children,
  className,
  tone,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** destructive items render danger text (ACCESSIBILITY §6: never default-focused) */
  tone?: "default" | "danger";
} & React.ComponentPropsWithoutRef<typeof RadixDropdown.Item>): ReactNode {
  return (
    <RadixDropdown.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        "data-[highlighted]:bg-primary-50 data-[highlighted]:text-primary-800",
        tone === "danger" && "text-danger-700 data-[highlighted]:bg-danger-bg data-[highlighted]:text-danger-text",
        className,
      )}
      {...rest}
    >
      {children}
    </RadixDropdown.Item>
  );
}

export const DropdownSeparator = ({ className }: { className?: string }): ReactNode => (
  <RadixDropdown.Separator className={cn("my-1 h-px bg-subtle", className)} />
);

export const DropdownLabel = ({ children, className }: { children: ReactNode; className?: string }): ReactNode => (
  <RadixDropdown.Label className={cn("px-2 py-1.5 text-xs text-gray-500", className)}>{children}</RadixDropdown.Label>
);
