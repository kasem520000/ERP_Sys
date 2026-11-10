"use client";

/** Switch primitive — Radix Switch (settings only, never document data). */
import * as RadixSwitch from "@radix-ui/react-switch";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";

export function SwitchPrimitive({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...rest
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixSwitch.Root>, "checked" | "onCheckedChange">): ReactNode {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-default bg-surface-sunken outline-none",
        "data-[state=checked]:border-primary-600 data-[state=checked]:bg-primary-600",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      <RadixSwitch.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-e1",
          "transition-transform duration-150 ease-standard data-[state=checked]:translate-x-4",
        )}
      />
    </RadixSwitch.Root>
  );
}
