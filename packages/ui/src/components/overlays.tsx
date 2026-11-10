"use client";

/**
 * Dialog / Drawer / Tooltip / Popover / Tabs — catalog-styled overlays
 * (dialog/drawer/tooltip wrappers with the documented defaults).
 */
import { Children, isValidElement, useState, type JSX, type ReactNode } from "react";

import { DialogContent, DialogRoot, DialogTrigger } from "../primitives/dialog";
import { DrawerContent, DrawerRoot, DrawerTrigger } from "../primitives/drawer";
import { TooltipRoot } from "../primitives/tooltip";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "../primitives/popover";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "../primitives/tabs";

export function Dialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: "sm" | "md" | "lg";
  trigger?: ReactNode;
  children: ReactNode;
  showClose?: boolean;
  ariaLabel?: string;
}): JSX.Element {
  const { open, onOpenChange, title, description, size, trigger, children, showClose, ariaLabel } = props;
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent title={title} description={description} size={size} showClose={showClose} ariaLabel={ariaLabel}>
        {children}
      </DialogContent>
    </DialogRoot>
  );
}

export function Drawer(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  side?: "start" | "end";
  size?: "md" | "lg";
  trigger?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const { open, onOpenChange, title, side, size, trigger, children } = props;
  return (
    <DrawerRoot open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}
      <DrawerContent title={title} side={side} size={size}>
        {children}
      </DrawerContent>
    </DrawerRoot>
  );
}

/** Tooltip — aria-describedby on hover AND focus; Escape-dismissible (WCAG 1.4.13). */
export function Tooltip(props: { content: ReactNode; shortcut?: string; children: ReactNode; disabled?: boolean }): JSX.Element {
  return <TooltipRoot content={props.content} shortcut={props.shortcut} disabled={props.disabled}>{props.children}</TooltipRoot>;
}

export function Popover(props: {
  children: ReactNode;
  content: ReactNode;
  align?: "start" | "end" | "center";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  width?: string;
}): JSX.Element {
  const { children, content, align, open, onOpenChange, width } = props;
  return (
    <PopoverRoot open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} width={width}>
        {content}
      </PopoverContent>
    </PopoverRoot>
  );
}

export interface TabItem {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * Tabs — trigger list + content routing. Children either carry
 * `data-slot="{value}"` (each routes into its item's TabsContent) or, when
 * no slotted children exist, the whole block renders under the active tab
 * (the segmented-control usage the opening-balances console has). Both
 * paths mount a TabsContent per active value so Radix's trigger
 * `aria-controls` always resolves (axe aria-valid-attr-value).
 */
export function Tabs(props: {
  items: TabItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const { items, value, onValueChange, children, className } = props;
  const [internal, setInternal] = useState(items[0]?.value ?? "");
  const active = value ?? internal;

  const slots = new Map<string, ReactNode>();
  let unslotted: ReactNode = null;
  Children.forEach(children, (child) => {
    if (isValidElement(child)) {
      const slot = (child.props as Record<string, unknown>)["data-slot"];
      if (typeof slot === "string") {
        slots.set(slot, child);
        return;
      }
    }
    unslotted = child;
  });

  return (
    <TabsRoot
      value={value}
      onValueChange={(next) => {
        setInternal(next);
        onValueChange?.(next);
      }}
      className={className}
    >
      <TabsList>
        {items.map((t) => (
          <TabsTrigger key={t.value} value={t.value} disabled={t.disabled}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {slots.size > 0
        ? items.map((t) =>
            slots.has(t.value) ? (
              <TabsContent key={t.value} value={t.value}>
                {slots.get(t.value)}
              </TabsContent>
            ) : null,
          )
        : null}
      {slots.size === 0 && unslotted !== null ? (
        <TabsContent value={active}>{children}</TabsContent>
      ) : null}
    </TabsRoot>
  );
}
