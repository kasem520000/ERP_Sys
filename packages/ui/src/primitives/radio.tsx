"use client";

/** Radio primitive — Radix RadioGroup; arrows move within the group (§7). */
import * as RadixRadioGroup from "@radix-ui/react-radio-group";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";
import { useDirection } from "../utils/direction";

export function RadioGroupPrimitive({
  children,
  value,
  onValueChange,
  disabled,
  orientation = "vertical",
  className,
  ...rest
}: {
  children: ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixRadioGroup.Root>, "value" | "onValueChange" | "orientation">): ReactNode {
  return (
    <RadixRadioGroup.Root
      dir={useDirection()}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      orientation={orientation}
      className={cn("flex gap-2", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap", className)}
      {...rest}
    >
      {children}
    </RadixRadioGroup.Root>
  );
}

export function RadioPrimitive({
  value,
  className,
  ...rest
}: {
  value: string;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixRadioGroup.Item>, "value">): ReactNode {
  return (
    <RadixRadioGroup.Item
      value={value}
      className={cn(
        "aspect-square h-4 w-4 shrink-0 rounded-full border border-default bg-surface-card outline-none",
        "data-[state=checked]:border-primary-600 disabled:cursor-not-allowed disabled:border-subtle disabled:bg-surface-sunken",
        className,
      )}
      {...rest}
    >
      <RadixRadioGroup.Indicator className="flex items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-primary-600" />
      </RadixRadioGroup.Indicator>
    </RadixRadioGroup.Item>
  );
}
