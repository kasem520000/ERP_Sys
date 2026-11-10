"use client";

/**
 * Drawer primitive — a Dialog variant anchored to the logical `start`/`end`
 * edge (renders left in LTR, right in RTL per COMPONENT_CATALOG Drawer row).
 * Radix supplies the focus trap; body scroll lock comes with modal dialogs.
 */
import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "../utils/cn";
import { useDirection } from "../utils/direction";
import { overlayCx, portalZ } from "./_shared";

export const DrawerRoot = RadixDialog.Root;
export const DrawerTrigger = RadixDialog.Trigger;
export const DrawerClose = RadixDialog.Close;

export function DrawerContent({
  children,
  className,
  side = "end", // logical edge — renders left in LTR, right in RTL
  size = "md",
  title,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  side?: "start" | "end";
  size?: "md" | "lg";
  title?: ReactNode;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixDialog.Content>, "children" | "title">): ReactNode {
  const dir = useDirection();
  const widths = { md: "w-[min(28rem,90vw)]", lg: "w-[min(48rem,92vw)]" } as const;
  // logical edge anchoring — start-0/end-0 are inset-inline utilities (RTL-safe)
  const anchor = side === "start" ? "start-0" : "end-0";
  // slide-in from the anchored edge (≤8px + opacity, 120ms — MOTION budget)
  const slide = side === "start"
    ? dir === "rtl"
      ? "data-[state=open]:translate-x-0 -translate-x-2"
      : "data-[state=open]:translate-x-0 translate-x-2"
    : dir === "rtl"
      ? "data-[state=open]:translate-x-0 translate-x-2"
      : "data-[state=open]:translate-x-0 -translate-x-2";
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={cn(overlayCx, portalZ.overlay)} />
      <RadixDialog.Content
        dir={dir}
        className={cn(
          "fixed inset-y-0 m-0 flex h-full max-h-none w-fit flex-col gap-4 rounded-none border-y-0 border-e-0 border-s border-subtle bg-surface-card p-6 shadow-e4 outline-none transition-transform duration-150 ease-enter",
          anchor,
          widths[size],
          portalZ.drawer,
          slide,
          className,
        )}
        {...rest}
      >
        {title !== undefined && <RadixDialog.Title className="text-md font-semibold text-gray-900">{title}</RadixDialog.Title>}
        {children}
        <RadixDialog.Close
          aria-label="close"
          className="absolute end-4 top-4 rounded-md p-1 text-gray-500 hover:bg-surface-sunken hover:text-gray-700"
        >
          <X width={16} height={16} strokeWidth={1.5} aria-hidden="true" />
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export const DrawerTitle = RadixDialog.Title;
export const DrawerDescription = RadixDialog.Description;
