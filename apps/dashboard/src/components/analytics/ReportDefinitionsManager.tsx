'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { useGuildChannels } from './channels';
import { ChannelLabel } from './ChannelLabel';
import {
  WEEKDAY_OPTIONS,
  definitionToForm,
  emptyDefinitionForm,
  formToPayload,
  weekdayLabel,
  type DefinitionForm,
} from './definition-form';

export interface DefinitionView {
  id: string;
  name: string;
  enabled: boolean;
  day: string;
  time: string;
  timezone: string;
  periodDays: number;
  channelId: string | null;
  /** Next run formatted server-side in the definition's own time zone. */
  nextRunLabel: string | null;
  lastRunLabel: string | null;
}

function timeZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return f ? f('timeZone') : [];
  } catch {
    return [];
  }
}

export function ReportDefinitionsManager({
  definitions,
  guildTimezone,
}: {
  definitions: DefinitionView[];
  guildTimezone: string;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const channels = useGuildChannels();
  const zones = useMemo(timeZones, []);

  const [editing, setEditing] = useState<DefinitionView | 'new' | null>(null);
  const [form, setForm] = useState<DefinitionForm>(emptyDefinitionForm(guildTimezone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DefinitionView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const open = (d: DefinitionView | 'new') => {
    setEditing(d);
    setForm(d === 'new' ? emptyDefinitionForm(guildTimezone) : definitionToForm(d));
    setErrors({});
    setFormError(null);
  };
  const close = () => {
    if (!saving) setEditing(null);
  };
  const set = <K extends keyof DefinitionForm>(k: K, v: DefinitionForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mapped = formToPayload(form);
    if (!mapped.ok) {
      setErrors(mapped.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      if (editing === 'new')
        await api('/api/analytics/definitions', { method: 'POST', body: mapped.payload });
      else if (editing)
        await api(`/api/analytics/definitions/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          body: mapped.payload,
        });
      toast.success(editing === 'new' ? 'Schedule created' : 'Schedule saved');
      setEditing(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.issues.length) setErrors(err.fieldErrors());
        setFormError(err.message);
      } else setFormError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (d: DefinitionView, enabled: boolean) => {
    setToggling(d.id);
    try {
      await api(`/api/analytics/definitions/${encodeURIComponent(d.id)}`, {
        method: 'PATCH',
        body: { enabled },
      });
      toast.success(enabled ? 'Schedule enabled' : 'Schedule paused', d.name);
      router.refresh();
    } catch (err) {
      toast.error('Could not update schedule', (err as Error).message);
    } finally {
      setToggling(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api(`/api/analytics/definitions/${encodeURIComponent(pendingDelete.id)}`, { method: 'DELETE' });
      toast.success('Schedule deleted', pendingDelete.name);
      setPendingDelete(null);
      router.refresh();
    } catch (err) {
      toast.error('Could not delete schedule', (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const textChannels = channels.channels.filter(
    (c) =>
      c.type === undefined ||
      c.type === 0 ||
      c.type === 5 ||
      c.type === 'GUILD_TEXT' ||
      c.type === 'GUILD_ANNOUNCEMENT' ||
      c.type === 'text',
  );

  const columns: Column<DefinitionView>[] = [
    {
      key: 'name',
      header: 'Schedule',
      cell: (d) => (
        <div>
          <p className="font-medium text-fg">{d.name}</p>
          <p className="text-xs text-fg-muted">
            {d.periodDays}-day period{d.lastRunLabel ? ` · last run ${d.lastRunLabel}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'when',
      header: 'Runs',
      cell: (d) => (
        <span className="whitespace-nowrap">
          {weekdayLabel(d.day)} {d.time} <span className="text-xs text-fg-muted">{d.timezone}</span>
        </span>
      ),
    },
    {
      key: 'next',
      header: 'Next run',
      cell: (d) =>
        d.enabled ? (
          d.nextRunLabel ? (
            <span className="text-sm">{d.nextRunLabel}</span>
          ) : (
            <span className="text-fg-muted">Not scheduled</span>
          )
        ) : (
          <Badge>Paused</Badge>
        ),
    },
    {
      key: 'channel',
      header: 'Channel',
      hideOnMobile: true,
      cell: (d) =>
        d.channelId ? <ChannelLabel id={d.channelId} /> : <span className="text-fg-muted">Not posted</span>,
    },
    {
      key: 'enabled',
      header: 'Enabled',
      cell: (d) => (
        <Switch
          id={`def-enabled-${d.id}`}
          checked={d.enabled}
          disabled={toggling === d.id}
          onChange={(v) => void toggle(d, v)}
          label={<span className="sr-only">Enable {d.name}</span>}
        />
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (d) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => open(d)} aria-label={`Edit ${d.name}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPendingDelete(d)}
            aria-label={`Delete ${d.name}`}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader
          title="Schedules"
          description={`${definitions.length} schedule${definitions.length === 1 ? '' : 's'}`}
          actions={<Button onClick={() => open('new')}>New schedule</Button>}
        />
        <Table
          columns={columns}
          rows={definitions}
          rowKey={(d) => d.id}
          caption="Report schedules"
          empty={
            <EmptyState
              title="No schedules yet"
              description="Create a schedule to generate a CEO report every week."
              action={<Button onClick={() => open('new')}>New schedule</Button>}
            />
          }
        />
      </Card>

      <Dialog
        open={editing !== null}
        onClose={close}
        dismissible={!saving}
        title={editing === 'new' ? 'New report schedule' : 'Edit report schedule'}
        description="The report covers the given number of days ending at the run time."
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="report-definition-form" loading={saving} loadingLabel="Saving…">
              {editing === 'new' ? 'Create schedule' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form id="report-definition-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field id="def-name" label="Name" required error={errors.name} className="sm:col-span-2">
            {(p) => (
              <Input
                {...p}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={80}
                placeholder="Weekly CEO report"
              />
            )}
          </Field>
          <Field id="def-day" label="Weekday" required error={errors.day}>
            {(p) => (
              <Select
                {...p}
                value={form.day}
                onChange={(e) => set('day', e.target.value)}
                options={WEEKDAY_OPTIONS.map((d) => ({ value: d, label: weekdayLabel(d) }))}
              />
            )}
          </Field>
          <Field id="def-time" label="Time (24h)" required error={errors.time}>
            {(p) => (
              <Input {...p} type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
            )}
          </Field>
          <Field
            id="def-tz"
            label="Time zone"
            required
            error={errors.timezone}
            help="IANA name, e.g. Europe/London."
          >
            {(p) => (
              <>
                <Input
                  {...p}
                  value={form.timezone}
                  onChange={(e) => set('timezone', e.target.value)}
                  list="def-tz-list"
                  autoComplete="off"
                  maxLength={64}
                />
                {zones.length > 0 && (
                  <datalist id="def-tz-list">
                    {zones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                )}
              </>
            )}
          </Field>
          <Field id="def-period" label="Period (days)" required error={errors.periodDays} help="1–31 days.">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={31}
                step={1}
                inputMode="numeric"
                value={form.periodDays}
                onChange={(e) => set('periodDays', e.target.value)}
              />
            )}
          </Field>
          <Field
            id="def-channel"
            label="Post to channel"
            error={errors.channelId}
            className="sm:col-span-2"
            help={
              channels.status === 'ready'
                ? 'Use a private staff channel. Leave empty to generate without posting.'
                : channels.status === 'loading'
                  ? 'Loading channels…'
                  : 'Channel list unavailable — paste a channel ID (Developer Mode → Copy Channel ID), or leave empty.'
            }
          >
            {(p) =>
              channels.status === 'ready' ? (
                <Select
                  {...p}
                  value={form.channelId}
                  onChange={(e) => set('channelId', e.target.value)}
                  options={[
                    { value: '', label: 'Do not post (generate only)' },
                    ...(form.channelId && !textChannels.some((c) => c.id === form.channelId)
                      ? [{ value: form.channelId, label: `Unknown channel ${form.channelId}` }]
                      : []),
                    ...textChannels.map((c) => ({ value: c.id, label: `#${c.name}` })),
                  ]}
                />
              ) : (
                <Input
                  {...p}
                  value={form.channelId}
                  onChange={(e) => set('channelId', e.target.value.trim())}
                  inputMode="numeric"
                  placeholder="123456789012345678"
                  maxLength={20}
                />
              )
            }
          </Field>
          <div className="sm:col-span-2">
            <Switch
              id="def-enabled"
              checked={form.enabled}
              onChange={(v) => set('enabled', v)}
              label="Enabled"
              description="Paused schedules keep their settings but do not run."
            />
          </div>
          {formError && (
            <Alert tone="danger" className="sm:col-span-2">
              {formError}
            </Alert>
          )}
        </form>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete this schedule?"
        confirmLabel="Delete schedule"
        description="The schedule stops running and every report generated from it is deleted as well. This cannot be undone. Pause it instead to keep its reports."
      >
        {pendingDelete && <p className="text-sm font-medium text-fg">{pendingDelete.name}</p>}
      </ConfirmDialog>
    </>
  );
}
