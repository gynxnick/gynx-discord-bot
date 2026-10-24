'use client';

import { useState, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Form';

/**
 * Free-text list editor: type a value and press Enter or comma to add it;
 * pasting a comma/newline separated list adds every entry. Values are shown
 * as removable chips. `normalize` may return null to reject an entry.
 */
export function TagInput({
  id,
  values,
  onChange,
  max,
  maxLength = 100,
  placeholder,
  describedBy,
  invalid,
  disabled,
  normalize = (v) => v,
  label,
}: {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  maxLength?: number;
  placeholder?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  normalize?: (v: string) => string | null;
  /** Used for chip remove-button labels. */
  label: string;
}) {
  const [draft, setDraft] = useState('');
  const [rejected, setRejected] = useState<string | null>(null);

  const addMany = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    const bad: string[] = [];
    for (const p of parts) {
      const v = normalize(p.slice(0, maxLength));
      if (v === null) {
        bad.push(p);
        continue;
      }
      if (!next.includes(v) && next.length < max) next.push(v);
    }
    setRejected(bad.length ? `Not added: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}` : null);
    onChange(next);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addMany(draft);
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" aria-label={`${label} list`}>
          {values.map((v) => (
            <li key={v}>
              <Badge tone="neutral" className="max-w-full gap-1 pr-0.5">
                <span className="truncate">{v}</span>
                <button
                  type="button"
                  className="rounded px-1 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  disabled={disabled}
                >
                  ×
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && addMany(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,\n]/.test(text)) {
            e.preventDefault();
            addMany(text);
          }
        }}
        placeholder={values.length >= max ? `Maximum of ${max} reached` : placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        disabled={disabled || values.length >= max}
        maxLength={maxLength}
        autoComplete="off"
      />
      <p className="text-xs text-fg-muted">
        {values.length}/{max} · Press Enter or comma to add.
      </p>
      {rejected && (
        <p className="text-xs text-warning" role="status">
          {rejected}
        </p>
      )}
    </div>
  );
}
