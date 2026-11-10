"use client";

/** Checkbox primitive — Radix Checkbox; indeterminate = visual Minus (§1 row). */
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import type { ReactNode } from "react";
import { Check, Minus } from "lucide-react";

import { cn } from "../utils/cn";

export function CheckboxPrimitive({
  checked,
  onCheckedChange,
  disabled,
  invalid,
  className,
  ...rest
}: {
  checked: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean | "indeterminate") => void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root>, "checked" | "onCheckedChange">): ReactNode {
  return (
    <RadixCheckbox.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-default bg-surface-card outline-none",
        "data-[state=checked]:border-primary-600 data-[state=checked]:bg-primary-600 data-[state=checked]:text-white",
        "data-[state=indeterminate]:border-primary-600 data-[state=indeterminate]:bg-primary-600 data-[state=indeterminate]:text-white",
        "disabled:cursor-not-allowed disabled:border-subtle disabled:bg-surface-sunken disabled:text-gray-400",
        invalid && "border-danger-700 aria-[invalid=true]:border-danger-700",
        className,
      )}
      {...rest}
    >
      <RadixCheckbox.Indicator className="text-current">
        {checked === "indeterminate" ? (
          <Minus width={14} height={14} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Check width={14} height={14} strokeWidth={1.5} aria-hidden="true" />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
