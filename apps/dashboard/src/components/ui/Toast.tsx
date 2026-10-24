'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from './cn';

export type ToastTone = 'info' | 'success' | 'danger';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  show: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const toneCls: Record<ToastTone, string> = {
  info: 'border-accent/40',
  success: 'border-success/40',
  danger: 'border-danger/50',
};
const dotCls: Record<ToastTone, string> = { info: 'bg-accent', success: 'bg-success', danger: 'bg-danger' };

/** Transient notifications in a polite live region (errors use an assertive region). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), t.tone === 'danger' ? 8000 : 5000),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ tone: 'success', title, description }),
      error: (title, description) => show({ tone: 'danger', title, description }),
    }),
    [show],
  );

  const render = (tone: 'polite' | 'assertive') =>
    items
      .filter((t) => (tone === 'assertive' ? t.tone === 'danger' : t.tone !== 'danger'))
      .map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-md border bg-surface-raised px-4 py-3 shadow-lg',
            toneCls[t.tone],
          )}
        >
          <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dotCls[t.tone])} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{t.title}</p>
            {t.description && <p className="mt-0.5 text-xs text-fg-muted">{t.description}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="rounded p-0.5 text-fg-muted hover:text-fg"
            aria-label="Dismiss notification"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        <div aria-live="polite" role="status" className="flex flex-col gap-2">
          {render('polite')}
        </div>
        <div aria-live="assertive" role="alert" className="flex flex-col gap-2">
          {render('assertive')}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
