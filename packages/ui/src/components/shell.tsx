"use client";

/**
 * NavigationSidebar + CommandMenu + AppShell + shortcut registry
 * (NAVIGATION_MODEL §2/§3/§6/§7, ACCESSIBILITY §1).
 *
 * The shell renders the server-resolved registry ONLY (derived payload);
 * sidebar = nav landmark with aria-current; collapsed rail keeps accessible
 * names (tooltips); ⌘K CommandMenu searches navigation items by AR and EN
 * labels; mobile tab bar below md; `?` cheat sheet; single-letter shortcuts
 * never fire while typing in a field.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";

import type { NavItem, ResolvedNavigation } from "@erp/contracts";

import { cn } from "../utils/cn";
import { DirectionProvider, DensityProvider, useDirection, type Density } from "../utils/direction";
import { Icon, type IconName } from "../utils/icons";
import { Dialog } from "./overlays";
import { Tooltip } from "./overlays";
import { Button } from "./button";
import { ToastProvider } from "./toast";

export interface NavigationSidebarProps {
  navigation: ResolvedNavigation;
  activePath: string;
  /** Locale-prefixed link builder: route → `/${locale}${route}`. */
  hrefFor: (route: string) => string;
  locale: "ar" | "en";
  collapsed?: boolean;
  className?: string;
}

/** Sidebar — renders only permitted groups, binding order, aria-current=page. */
export function NavigationSidebar({
  navigation,
  activePath,
  hrefFor,
  locale,
  collapsed = false,
  className,
}: NavigationSidebarProps): JSX.Element {
  return (
    <nav aria-label={locale === "ar" ? "التنقل الرئيسي" : "Main navigation"} className={cn("flex h-full flex-col gap-4 overflow-y-auto py-4", collapsed ? "w-14 px-1" : "w-60 px-3", className)}>
      {navigation.groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          {!collapsed && (
            <p className="px-2 pb-1 text-xs font-medium text-gray-500">{group.label[locale]}</p>
          )}
          {collapsed && <span className="sr-only">{group.label[locale]}</span>}
          {group.items.map((item) => {
            const active = activePath === item.route;
            const link = (
              <a
                key={item.id}
                href={hrefFor(item.route)}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label[locale] : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 text-sm text-gray-700 outline-none",
                  "hover:bg-primary-50 hover:text-primary-800",
                  active && "bg-primary-50 font-medium text-primary-800",
                  collapsed ? "justify-center py-2" : "py-1.5",
                )}
              >
                <Icon name={item.icon as IconName} size={collapsed ? 20 : 16} />
                {!collapsed && <span className="truncate">{item.label[locale]}</span>}
                {collapsed && <span className="sr-only">{item.label[locale]}</span>}
              </a>
            );
            return collapsed ? (
              <Tooltip key={item.id} content={item.label[locale]}>
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigation: ResolvedNavigation;
  locale: "ar" | "en";
  hrefFor: (route: string) => string;
  placeholder?: string;
  /**
   * P6-T11a — remote-search wiring: invoked on every query change (raw,
   * undebounced — the app-side bridge debounces). Purely additive; absent
   * keeps the PHASE-005 local-only behavior (stories/snapshots unchanged).
   */
  onQuery?: (query: string) => void;
  /** App-populated remote result groups (e.g. partner/item trigram search). */
  remoteGroups?: CommandMenuRemoteGroup[];
  /** Announcement for the remote loading state (app i18n). */
  remoteLoadingLabel?: string;
}

/** A single remote result: navigation happens via the app-built href. */
export interface CommandMenuRemoteItem {
  id: string;
  label: string;
  href: string;
  /** Registry icon name; defaults to the search icon. */
  icon?: string;
}

export interface CommandMenuRemoteGroup {
  label: string;
  items: CommandMenuRemoteItem[];
}

/** ⌘K command menu — THE global search surface (screens never add their own). */
export function CommandMenu({ open, onOpenChange, navigation, locale, hrefFor, placeholder, onQuery, remoteGroups, remoteLoadingLabel }: CommandMenuProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items: NavItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = navigation.groups.flatMap((g) => g.items);
    if (q === "") return all;
    // searches by Arabic OR English label (NAVIGATION_MODEL §3)
    return all.filter((i) => i.label.ar.toLowerCase().includes(q) || i.label.en.toLowerCase().includes(q));
  }, [navigation, query]);

  // P6-T11a: remote-search bridge — raw query broadcast (debounce is the
  // caller's concern); groups render after the local navigation matches.
  useEffect(() => {
    if (open && onQuery !== undefined) onQuery(query);
  }, [query, open, onQuery]);
  const remote = remoteGroups ?? [];
  const flatRemote = useMemo(() => remote.flatMap((group) => group.items), [remote]);
  const total = items.length + flatRemote.length;

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function commitIndex(index: number): void {
    if (index < items.length) {
      const item = items[index];
      if (item !== undefined) {
        onOpenChange(false);
        window.location.assign(hrefFor(item.route));
      }
      return;
    }
    const remoteItem = flatRemote[index - items.length];
    if (remoteItem !== undefined) {
      onOpenChange(false);
      window.location.assign(remoteItem.href);
    }
  }

  function onKeyDown(key: string): void {
    if (key === "ArrowDown") setActive((i) => Math.min(i + 1, total - 1));
    else if (key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (key === "Enter") {
      commitIndex(active);
    }
  }

  const dir = useDirection();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} showClose={false} ariaLabel={placeholder ?? (locale === "ar" ? "قائمة الأوامر" : "Command menu")}>
      <div dir={dir} className="flex flex-col gap-2">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls="erp-command-results"
          aria-activedescendant={`erp-command-opt-${active}`}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => onKeyDown(e.key)}
          placeholder={placeholder ?? (locale === "ar" ? "ابحث أو انتقل إلى…" : "Search or jump to…")}
          className="w-full rounded-md border border-default px-3 py-2 text-sm outline-none focus:border-primary-600"
        />
        <ul id="erp-command-results" role="listbox" className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {total === 0 && (
            <li className="px-2 py-3 text-center text-sm text-gray-500">{locale === "ar" ? "لا نتائج" : "No results"}</li>
          )}
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`erp-command-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn("flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm", i === active && "bg-primary-50 text-primary-800")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                commitIndex(i);
              }}
            >
              <Icon name={item.icon as IconName} size={16} />
              <span>{item.label[locale]}</span>
              <span className="ms-auto font-mono text-xs text-gray-500">{item.shortcut ?? ""}</span>
            </li>
          ))}
          {remote.map((group) => (
            <li key={group.label} role="presentation">
              <p className="px-2 pb-0.5 pt-2 text-xs font-medium text-gray-500">{group.label}</p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const index = items.length + flatRemote.indexOf(item);
                  return (
                    <li
                      key={item.id}
                      id={`erp-command-opt-${index}`}
                      role="option"
                      aria-selected={index === active}
                      className={cn("flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm", index === active && "bg-primary-50 text-primary-800")}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        commitIndex(index);
                      }}
                    >
                      <Icon name={(item.icon ?? "search") as IconName} size={16} />
                      <span>{item.label}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {onQuery !== undefined && remoteLoadingLabel !== undefined && flatRemote.length === 0 && query.trim().length >= 2 && (
            <li role="status" className="px-2 py-1 text-center text-xs text-gray-500">{remoteLoadingLabel}</li>
          )}
        </ul>
      </div>
    </Dialog>
  );
}

export interface AppShellProps {
  locale: "ar" | "en";
  dir: "rtl" | "ltr";
  density?: Density;
  navigation?: ResolvedNavigation;
  activePath: string;
  brand: BilingualBrand;
  /** Skip-link + screen-reader strings (app i18n). */
  strings: {
    skipToContent: string;
    commandMenuLabel: string;
    shortcutsTitle: string;
    closeLabel: string;
    moreLabel: string;
  };
  userMenu?: ReactNode;
  children: ReactNode;
  /**
   * P6-T11a — CommandMenu remote-search wiring (purely additive): the app
   * bridge debounces the raw query and populates the result groups (e.g.
   * partner/item trigram search). Absent keeps local-only behavior.
   */
  onCommandQuery?: (query: string) => void;
  commandRemoteGroups?: CommandMenuRemoteGroup[];
  commandRemoteLoadingLabel?: string;
}

export interface BilingualBrand {
  name: string;
  logoUrl?: string;
}

/**
 * AppShell — owns `<html lang dir>` semantics at the layout level (the web
 * app applies them to <html>; this shell carries providers + chrome):
 * skip-to-content first Tab stop, sidebar (desktop) / drawer (mobile),
 * global banner slot, toast stack, ⌘K, `?` cheat sheet, mobile tab bar.
 */
export function AppShell({
  locale,
  dir,
  density = "compact",
  navigation,
  activePath,
  brand,
  strings,
  userMenu,
  children,
  onCommandQuery,
  commandRemoteGroups,
  commandRemoteLoadingLabel,
}: AppShellProps): JSX.Element {
  const hrefFor = useCallback((route: string): string => `/${locale}${route === "/" ? "" : route}`, [locale]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // global shortcut registry (NAVIGATION_MODEL §7): ⌘K, /, ?, g-prefix
  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      return el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    }
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (isTyping(e.target)) return; // single letters never fire while typing
      if (e.key === "/") {
        e.preventDefault();
        setCommandOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setCheatsheetOpen(true);
      } else if (e.key.toLowerCase() === "g") {
        gPending = true;
        if (gTimer !== null) clearTimeout(gTimer);
        gTimer = setTimeout(() => {
          gPending = false;
        }, 600);
      } else if (gPending) {
        const item = Object.values(navigation?.shortcuts ?? {}).find((s) => s.shortcut === `g ${e.key.toLowerCase()}`);
        if (item !== undefined) {
          e.preventDefault();
          window.location.assign(hrefFor(item.route));
        }
        gPending = false;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigation, hrefFor]);

  const hasNav = navigation !== undefined && navigation.groups.length > 0;

  return (
    <DirectionProvider dir={dir}>
      <DensityProvider density={density}>
        <ToastProvider>
          <div className="flex min-h-screen flex-col bg-surface-page">
            <header className="sticky top-0 z-[var(--erp-z-raised)] flex items-center gap-3 border-b border-subtle bg-surface-card px-4 py-2">
              {/* skip-to-content: FIRST tab stop, inside the header landmark
                  (axe region rule) — visible on focus only */}
              <a
                href="#main-content"
                className="absolute z-[var(--erp-z-toast)] m-2 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white opacity-0 focus:opacity-100 focus-visible:opacity-100"
              >
                {strings.skipToContent}
              </a>
              <span className="flex items-center gap-2 text-md font-semibold text-primary-900" data-visual-ready-brand>
                {brand.logoUrl !== undefined ? (
                  <img src={brand.logoUrl} alt="" className="h-6 w-6" />
                ) : null}
                <span>{brand.name}</span>
              </span>
              {/* accessible name = visible text (label-content-name rule);
                  the kbd hint is decorative (aria-hidden) */}
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                className="flex items-center gap-2 rounded-md border border-subtle bg-surface-sunken px-2 py-1 text-xs text-gray-600 outline-none hover:border-strong"
              >
                <Icon name="search" size={14} />
                <span>{strings.commandMenuLabel}</span>
                <kbd aria-hidden="true" className="rounded-sm border border-strong bg-surface-card px-1 font-mono text-xs">⌘K</kbd>
              </button>
              <div className="ms-auto flex items-center gap-2">{userMenu}</div>
            </header>
            <div className="flex flex-1">
              <aside className="hidden lg:block" data-visual-ready="true">
                {hasNav && <NavigationSidebar navigation={navigation} activePath={activePath} hrefFor={hrefFor} locale={locale} />}
              </aside>
              <main id="main-content" className="min-w-0 flex-1 px-4 py-6 lg:px-6">
                {children}
              </main>
            </div>
            {/* mobile tab bar (below md): Home · primary workflow · More (full registry drawer) */}
            {hasNav && (
              <nav aria-label="mobile" className="fixed inset-x-0 bottom-0 z-[var(--erp-z-drawer)] flex border-t border-subtle bg-surface-card md:hidden">
                <a href={hrefFor("/")} className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs text-gray-600">
                  <Icon name="home" size={20} />
                  <span>{navigation.groups[0]?.label[locale] ?? "Home"}</span>
                </a>
                {navigation.groups[0]?.items[0] !== undefined && navigation.groups[0].items[0].route !== "/" && (
                  <a href={hrefFor(navigation.groups[0].items[0].route)} className="flex min-h-11 flex-1 flex-col items-center justify-center py-1 text-xs text-gray-600">
                    <Icon name={navigation.groups[0].items[0].icon as IconName} size={20} />
                    <span>{navigation.groups[0].items[0].label[locale]}</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs text-gray-600"
                >
                  <Icon name="kebab-vertical" size={20} />
                  <span>{strings.moreLabel}</span>
                </button>
              </nav>
            )}
          </div>
          <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} navigation={navigation ?? { groups: [], shortcuts: {} }} locale={locale} hrefFor={hrefFor} placeholder={strings.commandMenuLabel} onQuery={onCommandQuery} remoteGroups={commandRemoteGroups} remoteLoadingLabel={commandRemoteLoadingLabel} />
          <Dialog open={cheatsheetOpen} onOpenChange={setCheatsheetOpen} title={strings.shortcutsTitle} size="sm">
            <ul className="flex flex-col gap-1 text-sm text-gray-700">
              <li className="flex justify-between gap-6"><span>⌘K / Ctrl+K</span><span>{strings.commandMenuLabel}</span></li>
              <li className="flex justify-between gap-6"><span>/</span><span>{strings.commandMenuLabel}</span></li>
              <li className="flex justify-between gap-6"><span>g h</span><span>{navigation?.groups[0]?.items[0]?.label[locale] ?? ""}</span></li>
              <li className="flex justify-between gap-6"><span>?</span><span>{strings.shortcutsTitle}</span></li>
            </ul>
          </Dialog>
          {hasNav && (
            <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen} title={strings.moreLabel} size="sm">
              <NavigationSidebar navigation={navigation} activePath={activePath} hrefFor={hrefFor} locale={locale} className="h-auto w-full px-0 py-0" />
            </Dialog>
          )}
        </ToastProvider>
      </DensityProvider>
    </DirectionProvider>
  );
}

/** Back-preserves-filters (§4): encode list state into the URL search string. */
export function encodeListState(state: Record<string, string>): string {
  const params = new URLSearchParams(state);
  return params.toString();
}

export function decodeListState(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search).entries()) out[k] = v;
  return out;
}

export { Button };
