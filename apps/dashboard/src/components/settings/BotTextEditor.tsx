'use client';

import { useMemo, useRef, useState } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/Feedback';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';

export interface BotTextEntry {
  key: string;
  namespace: string;
  help: string;
  kind: 'title' | 'label' | 'short' | 'text' | 'long';
  max: number;
  vars: readonly string[];
  default: string;
  override: string | null;
  updatedAt: string | null;
}

const NAMESPACE_LABELS: Record<string, string> = {
  core: 'General',
  community: 'Community & roles',
  moderation: 'Moderation',
  security: 'Security',
  status: 'Status',
  troubleshooting: 'Troubleshooting',
  games: 'Game utilities',
  engagement: 'Events, polls & giveaways',
  marketing: 'Announcements & partners',
  analytics: 'Analytics & settings',
};
const nsLabel = (ns: string) => NAMESPACE_LABELS[ns] ?? ns.charAt(0).toUpperCase() + ns.slice(1);

/** Sample values for the live preview. */
const SAMPLE: Record<string, string> = {
  user: '@Member',
  server: 'GYNX.GG',
  seconds: '30',
  module: 'Status & incidents',
  reference: 'a1b2c3d4',
};
const preview = (s: string) =>
  s.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (w, v: string) => SAMPLE[v] ?? `‹${v}›`);

function TextRow({ entry }: { entry: BotTextEntry }) {
  const { run, pending, fieldErrors, error } = useApiAction();
  const current = entry.override ?? entry.default;
  const [value, setValue] = useState(current);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const dirty = value !== current;
  const singleLine = entry.kind === 'label' || entry.kind === 'title' || entry.kind === 'short';
  const id = `text-${entry.key}`;
  const err = fieldErrors.value ?? (error && dirty ? error : undefined);

  const insert = (v: string) => {
    const el = ref.current;
    const token = `{${v}}`;
    if (!el) return setValue((x) => x + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => el.focus());
  };

  return (
    <li className="border-t border-border px-4 py-4 first:border-t-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {entry.help}
        </label>
        {entry.override !== null && <Badge tone="accent">Customised</Badge>}
      </div>
      <p className="mb-2 font-mono text-xs text-fg-muted">{entry.key}</p>

      {singleLine ? (
        <Input
          id={id}
          ref={ref}
          value={value}
          maxLength={entry.max}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!err}
          aria-describedby={`${id}-meta`}
        />
      ) : (
        <Textarea
          id={id}
          ref={ref}
          rows={Math.min(8, Math.max(2, value.split('\n').length + 1))}
          value={value}
          maxLength={entry.max}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!err}
          aria-describedby={`${id}-meta`}
        />
      )}

      <div
        id={`${id}-meta`}
        className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted"
      >
        <span className={value.length > entry.max ? 'text-danger' : undefined}>
          {value.length}/{entry.max}
        </span>
        {entry.vars.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            Placeholders:
            {entry.vars.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insert(v)}
                className="rounded border border-border px-1.5 py-0.5 font-mono text-fg hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={`Insert {${v}}`}
              >
                {`{${v}}`}
              </button>
            ))}
          </span>
        )}
      </div>

      {err && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {err}
        </p>
      )}

      {(dirty || entry.override !== null) && (
        <div className="mt-3 rounded-md border border-border bg-surface-2 p-3 text-sm">
          <p className="mb-1 text-xs uppercase tracking-wide text-fg-muted">Preview</p>
          <p className="whitespace-pre-wrap text-fg">{preview(value)}</p>
          {entry.override !== null && (
            <p className="mt-2 text-xs text-fg-muted">
              Default: <span className="whitespace-pre-wrap">{entry.default}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!dirty || pending}
          loading={pending && dirty}
          onClick={() =>
            void run(
              '/api/settings/text',
              'PUT',
              { key: entry.key, value },
              {
                success: 'Text saved',
                successDescription: 'The bot uses it within about 30 seconds.',
                errorTitle: 'Text not saved',
              },
            )
          }
        >
          Save
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setValue(current)} disabled={pending}>
            Undo changes
          </Button>
        )}
        {entry.override !== null && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={async () => {
              const ok = await run(
                '/api/settings/text',
                'DELETE',
                { key: entry.key },
                {
                  success: 'Reset to default',
                  errorTitle: 'Could not reset',
                },
              );
              if (ok) setValue(entry.default);
            }}
          >
            Reset to default
          </Button>
        )}
      </div>
    </li>
  );
}

export function BotTextEditor({ entries }: { entries: BotTextEntry[] }) {
  const [q, setQ] = useState('');
  const [ns, setNs] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);

  const namespaces = useMemo(() => [...new Set(entries.map((e) => e.namespace))].sort(), [entries]);
  const customised = entries.filter((e) => e.override !== null).length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!ns || e.namespace === ns) &&
        (!changedOnly || e.override !== null) &&
        (!needle ||
          e.key.toLowerCase().includes(needle) ||
          e.help.toLowerCase().includes(needle) ||
          e.default.toLowerCase().includes(needle) ||
          (e.override ?? '').toLowerCase().includes(needle)),
    );
  }, [entries, q, ns, changedOnly]);

  const groups = useMemo(() => {
    const m = new Map<string, BotTextEntry[]>();
    for (const e of filtered) m.set(e.namespace, [...(m.get(e.namespace) ?? []), e]);
    return [...m.entries()].sort(([a], [b]) =>
      a === 'core' ? -1 : b === 'core' ? 1 : nsLabel(a).localeCompare(nsLabel(b)),
    );
  }, [filtered]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <Input
            type="search"
            placeholder="Search text, e.g. welcome, button, error…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search bot text"
          />
          <Select
            aria-label="Filter by area"
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            options={[
              { value: '', label: 'All areas' },
              ...namespaces.map((n) => ({ value: n, label: nsLabel(n) })),
            ]}
          />
          <Switch
            id="changed-only"
            checked={changedOnly}
            onChange={setChangedOnly}
            label={`Customised only (${customised})`}
          />
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          {entries.length} texts · {customised} customised. Changes reach the bot within about 30 seconds; the
          status board and role panels update themselves.
        </p>
      </Card>

      {groups.length === 0 ? (
        <EmptyState title="No matching text" description="Try another search or clear the filters." />
      ) : (
        groups.map(([namespace, list]) => (
          <Card key={namespace}>
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-fg">
              {nsLabel(namespace)} <span className="font-normal text-fg-muted">· {list.length}</span>
            </h2>
            <ul>
              {list.map((e) => (
                <TextRow key={`${e.key}:${e.override ?? ''}`} entry={e} />
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
