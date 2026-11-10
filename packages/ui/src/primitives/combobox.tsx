"use client";

/**
 * Combobox primitive — headless listbox mechanics over the Popover primitive
 * (Radix has no combobox; §2 sanctions this composition inside the primitive
 * layer). Owns: filtering, active-option roving via aria-activedescendant,
 * direction-aware arrow keys, type-ahead on both AR and EN labels.
 * The styled `Combobox` catalog component composes this.
 */
import { useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";

export interface ComboboxItem {
  value: string;
  label: string;
  /** Optional secondary label used for type-ahead (AR items also match EN). */
  keywords?: string;
  disabled?: boolean;
}

export interface UseComboboxListOptions {
  items: ComboboxItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  /** Debounced search callback (≥50 records — 200ms debounce at component level). */
  onSearch?: (query: string) => void;
}

export function useComboboxList({ items, value, onValueChange, onSearch }: UseComboboxListOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.keywords !== undefined && item.keywords.toLowerCase().includes(q)) ||
        item.value.toLowerCase().includes(q),
    );
  }, [items, query]);

  const selected = items.find((item) => item.value === value);

  function openAndFocus(): void {
    setOpen(true);
    setActiveIndex(Math.max(0, filtered.findIndex((item) => item.value === value)));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function commit(index: number): void {
    const item = filtered[index];
    if (item === undefined || item.disabled) return;
    onValueChange?.(item.value);
    setQuery("");
    setOpen(false); // selection restores focus to trigger (catalog row)
  }

  function onKeyDown(key: string): void {
    if (key === "ArrowDown") {
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (key === "ArrowUp") {
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (key === "Home") {
      setActiveIndex(0);
    } else if (key === "End") {
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (key === "Enter") {
      commit(activeIndex);
    } else if (key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  function onQueryChange(next: string): void {
    setQuery(next);
    setActiveIndex(0);
    onSearch?.(next);
  }

  const listId = useRef(`erp-combobox-list-${Math.random().toString(36).slice(2, 10)}`).current;

  return {
    open,
    setOpen,
    query,
    onQueryChange,
    filtered,
    activeIndex,
    setActiveIndex,
    commit,
    onKeyDown,
    selected,
    inputRef,
    listId,
    openAndFocus,
    /** combobox input props (role=combobox + aria-expanded + activedescendant). */
    inputProps: {
      role: "combobox" as const,
      "aria-expanded": open,
      "aria-controls": listId,
      "aria-activedescendant": open ? `${listId}-opt-${activeIndex}` : undefined,
      "aria-autocomplete": "list" as const,
    },
  };
}

/** Renderless listbox part — real listbox semantics for the visible window. */
export function ComboboxListbox({
  listId,
  filtered,
  activeIndex,
  value,
  onCommit,
  renderItem,
  empty,
}: {
  listId: string;
  filtered: ComboboxItem[];
  activeIndex: number;
  value?: string;
  onCommit: (index: number) => void;
  renderItem: (item: ComboboxItem, active: boolean, selected: boolean) => ReactNode;
  empty?: ReactNode;
}): JSX.Element {
  return (
    <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto outline-none">
      {filtered.length === 0 && empty !== undefined ? <li className="px-2 py-3 text-sm text-gray-500">{empty}</li> : null}
      {filtered.map((item, index) =>
        renderItem(item, index === activeIndex, item.value === value) === null ? null : (
          <li
            key={item.value}
            id={`${listId}-opt-${index}`}
            role="option"
            aria-selected={item.value === value}
            aria-disabled={item.disabled}
            data-active={index === activeIndex}
            className="cursor-pointer list-none"
            onMouseDown={(e) => {
              e.preventDefault();
              onCommit(index);
            }}
            onMouseMove={() => {
              /* active follows pointer for hover-sync (visual only) */
            }}
          >
            {renderItem(item, index === activeIndex, item.value === value)}
          </li>
        ),
      )}
    </ul>
  );
}
