"use client";

/**
 * Select primitive — Radix Select parts with token styling; type-ahead and
 * arrow keys come from Radix (direction-aware via `dir`).
 */
import * as RadixSelect from "@radix-ui/react-select";
import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../utils/cn";
import { useDirection, controlCx } from "../utils/direction";
import { COLLISION_PADDING } from "./_shared";

export const SelectRoot = RadixSelect.Root;
export const SelectGroup = RadixSelect.Group;
export const SelectValue = RadixSelect.Value;

export function SelectTrigger({
  className,
  placeholder,
  size,
  ...rest
}: {
  className?: string;
  placeholder?: ReactNode;
  size?: "sm" | "md";
} & Omit<React.ComponentPropsWithoutRef<typeof RadixSelect.Trigger>, "placeholder">): ReactNode {
  return (
    <RadixSelect.Trigger
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md border border-default bg-surface-card px-3 text-sm text-gray-900 outline-none",
        "hover:border-strong data-[placeholder]:text-gray-500 disabled:cursor-not-allowed disabled:border-subtle disabled:bg-surface-sunken disabled:text-gray-400",
        controlCx,
        size === "sm" && "h-8 text-xs",
        "aria-[invalid=true]:border-danger-700",
        className,
      )}
      {...rest}
    >
      {placeholder !== undefined && (
        <span className="pointer-events-none absolute opacity-0">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
      )}
      <RadixSelect.Value placeholder={placeholder} />
      <ChevronDown width={16} height={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-gray-500" />
    </RadixSelect.Trigger>
  );
}

export function SelectContent({
  children,
  className,
  position = "popper",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  position?: "popper" | "item-aligned";
} & Omit<React.ComponentPropsWithoutRef<typeof RadixSelect.Content>, "position">): ReactNode {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        dir={useDirection()}
        position={position}
        sideOffset={4}
        collisionPadding={COLLISION_PADDING}
        className={cn(
          "z-[var(--erp-z-dropdown)] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-subtle bg-surface-card shadow-e3",
          position === "popper" && "max-h-[min(18rem,var(--radix-select-content-available-height))]",
          className,
        )}
        {...rest}
      >
        <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

export function SelectItem({
  children,
  value,
  disabled,
  className,
  ...rest
}: {
  children: ReactNode;
  value: string;
  disabled?: boolean;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixSelect.Item>, "value">): ReactNode {
  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm py-1.5 pe-8 ps-2 text-sm text-gray-800 outline-none",
        "data-[state=checked]:font-medium data-[highlighted]:bg-primary-50 data-[highlighted]:text-primary-800",
        "data-[disabled]:pointer-events-none data-[disabled]:text-gray-400",
        className,
      )}
      {...rest}
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="absolute end-2 text-primary-700">
        <Check width={16} height={16} strokeWidth={1.5} aria-hidden="true" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

export const SelectLabel = ({ children }: { children: ReactNode }): ReactNode => (
  <RadixSelect.Label className="px-2 py-1.5 text-xs text-gray-500">{children}</RadixSelect.Label>
);

export const SelectSeparator = (): ReactNode => <RadixSelect.Separator className="my-1 h-px bg-subtle" />;
