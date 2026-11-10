"use client";

/**
 * Toast system (catalog row): role=status polite (errors role=alert per
 * ACCESSIBILITY §5), stacked max 3, auto-dismiss 6s (danger sticky), enter
 * 120ms from start edge, visual harness pauses via testMode.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Info, TriangleAlert, X } from "lucide-react";

export type ToastTone = "success" | "warning" | "danger" | "info";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  toast: (item: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<ToastTone, ReactNode> = {
  success: <Check width={16} height={16} strokeWidth={1.5} aria-hidden="true" className="text-success-700" />,
  warning: <TriangleAlert width={16} height={16} strokeWidth={1.5} aria-hidden="true" className="text-warning-700" />,
  danger: <TriangleAlert width={16} height={16} strokeWidth={1.5} aria-hidden="true" className="text-danger-700" />,
  info: <Info width={16} height={16} strokeWidth={1.5} aria-hidden="true" className="text-info-700" />,
};

export function ToastProvider({
  children,
  /** testMode: freeze toasts at enter-complete + disable auto-dismiss (visual §3). */
  testMode = false,
}: {
  children: ReactNode;
  testMode?: boolean;
}): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string): void => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (item: Omit<ToastItem, "id">): string => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      // stacked max 3 — oldest drops (catalog row)
      setItems((prev) => [...prev, { ...item, id }].slice(-3));
      // danger: sticky; never the only error surface (catalog row)
      if (!testMode && item.tone !== "danger") {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), 6000),
        );
      }
      return id;
    },
    [dismiss, testMode],
  );

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error("useToast requires <ToastProvider> (app shell provides it)");
  return api;
}

function Toaster({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }): JSX.Element | null {
  const [client, setClient] = useState(false);
  useEffect(() => {
    setClient(true);
  }, []);
  if (!client || items.length === 0 || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed bottom-6 end-6 z-[var(--erp-z-toast)] flex w-80 flex-col gap-2" data-visual-ready="true">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === "danger" ? "alert" : "status"}
          className="flex items-start gap-2 rounded-lg border border-subtle bg-surface-card p-3 shadow-e4 transition-[opacity,translate] duration-150 ease-enter data-visual-mask"
        >
          <span className="mt-0.5">{TONE_ICON[t.tone]}</span>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-gray-900">{t.title}</span>
            {t.description !== undefined && <span className="text-xs text-gray-600">{t.description}</span>}
            {t.action !== undefined && (
              <button
                type="button"
                className="self-start text-xs font-medium text-primary-700 underline"
                onClick={() => {
                  t.action?.onClick();
                  onDismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="dismiss"
            onClick={() => onDismiss(t.id)}
            className="rounded-sm p-0.5 text-gray-400 hover:text-gray-600"
          >
            <X width={14} height={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
