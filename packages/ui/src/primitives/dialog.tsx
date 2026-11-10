"use client";

/**
 * Dialog primitive — thin Radix wrapper (focus trap + restore + Escape are
 * Radix's; styling is ours). Overlay: token scrim, no blur (§5).
 */
import * as RadixDialog from "@radix-ui/react-dialog";
type RadixDialogProps = React.ComponentPropsWithoutRef<typeof RadixDialog.Dialog>;
import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "../utils/cn";
import { useDirection } from "../utils/direction";
import { overlayCx, portalZ } from "./_shared";

export const DialogRoot = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  children,
  className,
  size = "md",
  showClose = true,
  title,
  description,
  ariaLabel,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  showClose?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  /** Accessible name when no visible title exists (e.g. command menus). */
  ariaLabel?: string;
} & Omit<RadixDialogProps, "children" | "open" | "onOpenChange" | "modal">): ReactNode {
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={cn(overlayCx, portalZ.overlay)} />
      <RadixDialog.Content
        aria-label={ariaLabel}
        dir={useDirection()}
        className={cn(
          "fixed inset-0 m-auto flex max-h-[85vh] w-fit flex-col gap-4 rounded-lg border border-subtle bg-surface-card p-6 shadow-e4 outline-none",
          widths[size],
          portalZ.dialog,
          className,
        )}
        {...rest}
      >
        <div className="flex flex-col gap-1">
          {title !== undefined && <RadixDialog.Title className="text-md font-semibold text-gray-900">{title}</RadixDialog.Title>}
          {description !== undefined && (
            <RadixDialog.Description className="text-sm text-gray-600">{description}</RadixDialog.Description>
          )}
        </div>
        {children}
        {showClose && (
          <RadixDialog.Close
            aria-label="close"
            className="absolute end-4 top-4 rounded-md p-1 text-gray-500 transition-colors duration-150 ease-exit hover:bg-surface-sunken hover:text-gray-700"
          >
            <X width={16} height={16} strokeWidth={1.5} aria-hidden="true" />
          </RadixDialog.Close>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;
