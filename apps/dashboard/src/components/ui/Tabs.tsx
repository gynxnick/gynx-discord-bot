'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

/** WAI-ARIA tabs with roving tabindex (Arrow/Home/End keys, automatic activation). */
export function Tabs({
  items,
  defaultTab,
  label,
  className,
  onChange,
}: {
  items: TabItem[];
  defaultTab?: string;
  label: string;
  className?: string;
  onChange?: (id: string) => void;
}) {
  const enabled = items.filter((i) => !i.disabled);
  const [active, setActive] = useState(defaultTab ?? enabled[0]?.id ?? '');
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    setActive(id);
    onChange?.(id);
    refs.current[id]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = enabled.findIndex((i) => i.id === active);
    if (idx < 0) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(enabled[next]!.id);
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              id={`${base}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              onClick={() => select(t.id)}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40',
                selected ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          id={`${base}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== active}
          tabIndex={0}
          className="pt-4"
        >
          {t.id === active && t.content}
        </div>
      ))}
    </div>
  );
}
