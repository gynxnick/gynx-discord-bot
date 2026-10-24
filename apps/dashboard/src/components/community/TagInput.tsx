'use client';

import { useState, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Input, type FieldControlProps } from '@/components/ui/Form';
import { addTags } from './form-utils';

/** Free-text tags: type and press Enter or comma to add; chips are removable. */
export function TagInput({
  control,
  value,
  onChange,
  max = 20,
  maxLength = 40,
  placeholder = 'Type and press Enter',
  lowercase = true,
}: {
  control: FieldControlProps;
  value: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  lowercase?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    if (!draft.trim()) return;
    onChange(addTags(value, draft, { max, maxLength, lowercase }));
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="space-y-2">
      <Input
        {...control}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length >= max ? `Maximum of ${max}` : placeholder}
        disabled={value.length >= max}
        maxLength={maxLength * 3}
      />
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Added tags">
          {value.map((t) => (
            <li key={t}>
              <Badge>
                {t}
                <button
                  type="button"
                  className="ml-1 hover:text-fg"
                  aria-label={`Remove ${t}`}
                  onClick={() => onChange(value.filter((x) => x !== t))}
                >
                  ×
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
