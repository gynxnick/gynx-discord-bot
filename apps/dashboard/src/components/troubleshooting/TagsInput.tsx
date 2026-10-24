'use client';

import { useState, type KeyboardEvent } from 'react';
import { Input, type FieldControlProps } from '@/components/ui/Form';
import { normalizeTags, splitTags } from './forms';

/** Chip-style tag entry: Enter, comma or blur adds; × removes. */
export function TagsInput({
  value,
  onChange,
  max = 10,
  control,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  control: FieldControlProps;
}) {
  const [draft, setDraft] = useState('');

  const commit = (text: string) => {
    const parts = splitTags(text);
    if (parts.length) onChange(normalizeTags([...value, ...parts]).slice(0, max));
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {value.map((t) => (
            <li
              key={t}
              className="inline-flex items-center gap-1 rounded border border-border-strong bg-surface-raised px-1.5 py-0.5 text-xs text-fg"
            >
              {t}
              <button
                type="button"
                className="rounded px-0.5 text-fg-muted hover:text-fg"
                aria-label={`Remove tag ${t}`}
                onClick={() => onChange(value.filter((x) => x !== t))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        {...control}
        value={draft}
        maxLength={64}
        disabled={value.length >= max}
        placeholder={value.length >= max ? `Maximum ${max} tags` : 'Type a tag and press Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && commit(draft)}
      />
    </div>
  );
}
