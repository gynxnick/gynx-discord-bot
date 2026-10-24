'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, type FieldControlProps } from '@/components/ui/Form';

/** Serializable channel/role shapes passed from server components (no service imports here). */
export interface PickerChannel {
  id: string;
  name: string;
  type: 'text' | 'announcement' | 'category';
  parentId: string | null;
}
export interface PickerRole {
  id: string;
  name: string;
  managed?: boolean;
}

const SNOWFLAKE = /^\d{17,20}$/;

type Control = FieldControlProps & { disabled?: boolean };

/**
 * Single channel select grouped by category. `channels === null` means the
 * list could not be loaded: the control falls back to a raw ID input.
 */
export function ChannelPicker({
  control,
  channels,
  value,
  onChange,
  allowCategories = false,
  placeholder = 'Not set',
}: {
  control: Control;
  channels: PickerChannel[] | null;
  value: string | null;
  onChange: (id: string | null) => void;
  allowCategories?: boolean;
  placeholder?: string;
}) {
  if (!channels) {
    return (
      <Input
        {...control}
        inputMode="numeric"
        placeholder="Channel ID"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value.trim() || null)}
        maxLength={20}
      />
    );
  }
  const categories = channels.filter((c) => c.type === 'category');
  const top = channels.filter((c) => c.type !== 'category' && !c.parentId);
  const known = channels.some((c) => c.id === value);
  const label = (c: PickerChannel) => `#${c.name}${c.type === 'announcement' ? ' (announcement)' : ''}`;
  return (
    <Select {...control} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {value && !known && <option value={value}>Unknown channel ({value})</option>}
      {top.map((c) => (
        <option key={c.id} value={c.id}>
          {label(c)}
        </option>
      ))}
      {categories.map((cat) => (
        <optgroup key={cat.id} label={cat.name}>
          {allowCategories && <option value={cat.id}>Category: {cat.name}</option>}
          {channels
            .filter((c) => c.parentId === cat.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {label(c)}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** Single role select (highest first, as provided). Falls back to a raw ID input when roles are unavailable. */
export function RolePicker({
  control,
  roles,
  value,
  onChange,
  placeholder = 'Not set',
}: {
  control: Control;
  roles: PickerRole[] | null;
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  if (!roles) {
    return (
      <Input
        {...control}
        inputMode="numeric"
        placeholder="Role ID"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value.trim() || null)}
        maxLength={20}
      />
    );
  }
  const known = roles.some((r) => r.id === value);
  return (
    <Select {...control} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {value && !known && <option value={value}>Unknown role ({value})</option>}
      {roles.map((r) => (
        <option key={r.id} value={r.id} disabled={r.managed}>
          {r.name}
          {r.managed ? ' (managed by an integration)' : ''}
        </option>
      ))}
    </Select>
  );
}

/**
 * Multi-select of IDs (roles or channels) as removable chips plus an "add"
 * select. Falls back to typing an ID when the option list is unavailable.
 */
export function IdMultiPicker({
  id,
  describedBy,
  options,
  values,
  onChange,
  noun,
  max,
  disabled,
}: {
  id: string;
  describedBy?: string;
  options: Array<{ id: string; label: string; group?: string }> | null;
  values: string[];
  onChange: (ids: string[]) => void;
  noun: string;
  max: number;
  disabled?: boolean;
}) {
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const labels = useMemo(() => new Map((options ?? []).map((o) => [o.id, o.label])), [options]);
  const available = (options ?? []).filter((o) => !values.includes(o.id));
  const groups = [...new Set(available.map((o) => o.group ?? ''))];
  const full = values.length >= max;

  const add = (v: string) => {
    if (!v || values.includes(v) || full) return;
    onChange([...values, v]);
  };

  return (
    <div className="space-y-2">
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected ${noun}s`}>
          {values.map((v) => (
            <li key={v}>
              <Badge tone="neutral" className="gap-1 pr-0.5">
                {labels.get(v) ?? <span className="font-mono">{v}</span>}
                <button
                  type="button"
                  className="rounded px-1 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  aria-label={`Remove ${labels.get(v) ?? v}`}
                  disabled={disabled}
                >
                  ×
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-muted">No {noun}s selected.</p>
      )}
      {options ? (
        <Select
          id={id}
          aria-describedby={describedBy}
          value=""
          disabled={disabled || full || available.length === 0}
          onChange={(e) => add(e.target.value)}
          aria-label={`Add ${noun}`}
        >
          <option value="">
            {full
              ? `Maximum of ${max} reached`
              : available.length === 0
                ? `No more ${noun}s to add`
                : `Add a ${noun}…`}
          </option>
          {groups.map((g) =>
            g ? (
              <optgroup key={g} label={g}>
                {available
                  .filter((o) => o.group === g)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ) : (
              available
                .filter((o) => !o.group)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))
            ),
          )}
        </Select>
      ) : (
        <div className="flex gap-2">
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={manualError ? true : undefined}
            inputMode="numeric"
            placeholder={`${noun.charAt(0).toUpperCase() + noun.slice(1)} ID`}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            maxLength={20}
            disabled={disabled || full}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || full}
            onClick={() => {
              const v = manual.trim();
              if (!SNOWFLAKE.test(v)) {
                setManualError('Enter a Discord ID (17–20 digits).');
                return;
              }
              setManualError(null);
              setManual('');
              add(v);
            }}
          >
            Add
          </Button>
        </div>
      )}
      {manualError && (
        <p className="text-xs text-danger" role="alert">
          {manualError}
        </p>
      )}
    </div>
  );
}

/** Option list for IdMultiPicker from channels (text/announcement only, grouped by category). */
export function channelOptions(
  channels: PickerChannel[] | null,
): Array<{ id: string; label: string; group?: string }> | null {
  if (!channels) return null;
  const cat = new Map(channels.filter((c) => c.type === 'category').map((c) => [c.id, c.name]));
  return channels
    .filter((c) => c.type !== 'category')
    .map((c) => ({ id: c.id, label: `#${c.name}`, group: c.parentId ? cat.get(c.parentId) : undefined }));
}

export function roleOptions(roles: PickerRole[] | null): Array<{ id: string; label: string }> | null {
  return roles ? roles.map((r) => ({ id: r.id, label: `@${r.name}` })) : null;
}
