"use client";

/** Tabs primitive — Radix Tabs; arrow keys mirror with `dir` (catalog §7). */
import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";
import { useDirection } from "../utils/direction";

export const TabsRoot = RadixTabs.Root;

export function TabsList({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixTabs.List>, "children">): ReactNode {
  return (
    <RadixTabs.List
      dir={useDirection()}
      className={cn("flex items-center gap-1 border-b border-subtle", className)}
      {...rest}
    >
      {children}
    </RadixTabs.List>
  );
}

export function TabsTrigger({
  children,
  value,
  className,
  disabled,
  ...rest
}: {
  children: ReactNode;
  value: string;
  className?: string;
  disabled?: boolean;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>, "children" | "value">): ReactNode {
  return (
    <RadixTabs.Trigger
      value={value}
      disabled={disabled}
      className={cn(
        "relative select-none border-b-2 border-transparent px-3 py-2 text-sm text-gray-600 outline-none",
        "data-[state=active]:border-primary-600 data-[state=active]:text-primary-700 data-[state=active]:font-medium",
        "disabled:cursor-not-allowed disabled:text-gray-400",
        className,
      )}
      {...rest}
    >
      {children}
    </RadixTabs.Trigger>
  );
}

export const TabsContent = RadixTabs.Content;
