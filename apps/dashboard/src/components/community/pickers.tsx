'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, type FieldControlProps } from '@/components/ui/Form';
import { groupChannels, type ChannelOption, type RoleOption } from './picker-utils';

export type { ChannelOption, RoleOption } from './picker-utils';

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Channel picker. Uses server-provided `channels` when given; otherwise loads
 * `GET /api/discord/channels` (`{ id, name, type, parentId }[]`). When no
 * channel list is available it falls back to a plain channel-ID input.
 */
export function ChannelPicker({
  control,
  value,
  onChange,
  channels: provided,
  placeholder = 'Select a channel…',
  disabled,
  allowEmpty = true,
}: {
  control: FieldControlProps;
  value: string;
  onChange: (id: string) => void;
  channels?: ChannelOption[] | null;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
}) {
  const { api } = useSession();
  const [fetched, setFetched] = useState<ChannelOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const needFetch = provided === undefined || provided === null;

  useEffect(() => {
    if (!needFetch) return;
    const ac = new AbortController();
    api<unknown>('/api/discord/channels', { signal: ac.signal })
      .then((res) => {
        const list = Array.isArray(res) ? res : ((res as { channels?: unknown })?.channels ?? []);
        setFetched((list as ChannelOption[]).filter((c) => c && typeof c.id === 'string'));
      })
      .catch(() => {
        if (!ac.signal.aborted) setFailed(true);
      });
    return () => ac.abort();
  }, [api, needFetch]);

  const channels = provided ?? fetched;
  const groups = channels ? groupChannels(channels) : [];
  const known = channels?.some((c) => c.id === value) ?? false;

  if (failed || (channels && groups.length === 0)) {
    return (
      <Input
        {...control}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="Channel ID, e.g. 123456789012345678"
        inputMode="numeric"
        maxLength={20}
        disabled={disabled}
      />
    );
  }
  if (!channels)
    return (
      <Select {...control} disabled placeholder="Loading channels…" value="" onChange={() => undefined} />
    );

  return (
    <Select {...control} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="" disabled={!allowEmpty}>
        {placeholder}
      </option>
      {value && !known && SNOWFLAKE.test(value) && <option value={value}>Unknown channel ({value})</option>}
      {groups.map((g) =>
        g.label ? (
          <optgroup key={g.key} label={g.label}>
            {g.channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </optgroup>
        ) : (
          g.channels.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))
        ),
      )}
    </Select>
  );
}

/** Single role picker over server-provided roles (falls back to a role-ID input). */
export function RolePicker({
  control,
  value,
  onChange,
  roles,
  placeholder = 'Select a role…',
  disabled,
  hideManaged = false,
}: {
  control: FieldControlProps;
  value: string;
  onChange: (id: string) => void;
  roles: RoleOption[];
  placeholder?: string;
  disabled?: boolean;
  hideManaged?: boolean;
}) {
  if (roles.length === 0) {
    return (
      <Input
        {...control}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="Role ID, e.g. 123456789012345678"
        inputMode="numeric"
        maxLength={20}
        disabled={disabled}
      />
    );
  }
  const visible = hideManaged ? roles.filter((r) => !r.managed) : roles;
  const known = roles.some((r) => r.id === value);
  return (
    <Select {...control} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{placeholder}</option>
      {value && !known && <option value={value}>Unknown role ({value})</option>}
      {visible.map((r) => (
        <option key={r.id} value={r.id}>
          @{r.name}
          {r.managed ? ' (managed)' : ''}
        </option>
      ))}
    </Select>
  );
}

/** Multi role picker: choose from a select, selected roles shown as removable chips. */
export function RoleMultiPicker({
  control,
  value,
  onChange,
  roles,
  max = 5,
  disabled,
}: {
  control: FieldControlProps;
  value: string[];
  onChange: (ids: string[]) => void;
  roles: RoleOption[];
  max?: number;
  disabled?: boolean;
}) {
  const [manual, setManual] = useState('');
  const name = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const add = (id: string) => {
    if (!id || value.includes(id) || value.length >= max) return;
    onChange([...value, id]);
  };
  return (
    <div className="space-y-2">
      {roles.length > 0 ? (
        <Select
          {...control}
          value=""
          onChange={(e) => add(e.target.value)}
          disabled={disabled || value.length >= max}
          placeholder={value.length >= max ? `Maximum of ${max} roles` : 'Add a role…'}
          options={roles
            .filter((r) => !value.includes(r.id) && !r.managed)
            .map((r) => ({ value: r.id, label: `@${r.name}` }))}
        />
      ) : (
        <div className="flex gap-2">
          <Input
            {...control}
            value={manual}
            onChange={(e) => setManual(e.target.value.trim())}
            placeholder="Role ID"
            inputMode="numeric"
            maxLength={20}
            disabled={disabled}
          />
          <Button
            variant="secondary"
            onClick={() => {
              if (SNOWFLAKE.test(manual)) {
                add(manual);
                setManual('');
              }
            }}
            disabled={disabled || !SNOWFLAKE.test(manual) || value.length >= max}
          >
            Add
          </Button>
        </div>
      )}
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Selected roles">
          {value.map((id) => (
            <li key={id}>
              <Badge tone="accent">
                @{name(id)}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  className="ml-1 rounded text-accent hover:text-fg"
                  aria-label={`Remove role ${name(id)}`}
                  disabled={disabled}
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
