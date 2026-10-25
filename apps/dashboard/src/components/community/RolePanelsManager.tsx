'use client';

import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import { ChannelPicker, type ChannelOption } from './pickers';
import { useApiAction } from './useApiAction';

export interface RolePanelRow {
  id: string;
  channelId: string;
  title: string;
  description: string | null;
  groups: string[];
  messageId: string | null;
  syncedAt: string | null;
}

const GROUPS = [
  { value: 'games', label: 'Games' },
  { value: 'community', label: 'Community' },
  { value: 'notifications', label: 'Notifications' },
] as const;

interface Draft {
  channelId: string;
  title: string;
  description: string;
  groups: string[];
}

const blank = (): Draft => ({ channelId: '', title: 'Pick your roles', description: '', groups: [] });

export function RolePanelsManager({
  rows,
  channels,
  enabledRoleCount,
}: {
  rows: RolePanelRow[];
  channels: ChannelOption[] | null;
  enabledRoleCount: number;
}) {
  const { run, pending, fieldErrors, error } = useApiAction();
  const [editing, setEditing] = useState<RolePanelRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RolePanelRow | null>(null);
  const [d, setD] = useState<Draft>(blank());

  const channelName = (id: string) => {
    const c = channels?.find((x) => x.id === id);
    return c ? `#${c.name}` : id;
  };

  const open = (r: RolePanelRow | 'new') => {
    setEditing(r);
    setD(
      r === 'new'
        ? blank()
        : { channelId: r.channelId, title: r.title, description: r.description ?? '', groups: r.groups },
    );
  };

  const toggleGroup = (g: string, on: boolean) =>
    setD((x) => ({ ...x, groups: on ? [...new Set([...x.groups, g])] : x.groups.filter((y) => y !== g) }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      channelId: d.channelId,
      title: d.title.trim(),
      description: d.description.trim() || undefined,
      groups: d.groups,
    };
    const res =
      editing === 'new'
        ? await run('/api/community/panels', 'POST', body, {
            success: 'Panel created',
            successDescription: 'The bot posts it within a few seconds.',
            errorTitle: 'Panel was not created',
          })
        : await run(
            `/api/community/panels/${encodeURIComponent((editing as RolePanelRow).id)}`,
            'PATCH',
            body,
            {
              success: 'Panel updated',
              errorTitle: 'Could not update panel',
            },
          );
    if (res) setEditing(null);
  };

  const refresh = (id?: string) =>
    run('/api/community/panels/refresh', 'POST', id ? { id } : {}, {
      success: 'Refresh queued',
      successDescription: 'Panels update within a few seconds.',
      errorTitle: 'Could not refresh',
    });

  const remove = async () => {
    if (!deleting) return;
    const res = await run(`/api/community/panels/${encodeURIComponent(deleting.id)}`, 'DELETE', undefined, {
      success: 'Panel deleted',
      successDescription: 'Its Discord message is removed within a few seconds.',
      errorTitle: 'Could not delete panel',
    });
    if (res) setDeleting(null);
  };

  const columns: Column<RolePanelRow>[] = [
    {
      key: 'title',
      header: 'Panel',
      cell: (r) => (
        <div>
          <p className="font-medium text-fg">{r.title}</p>
          <p className="text-xs text-fg-muted">{channelName(r.channelId)}</p>
        </div>
      ),
    },
    {
      key: 'groups',
      header: 'Roles shown',
      cell: (r) =>
        r.groups.length
          ? r.groups.map((g) => GROUPS.find((x) => x.value === g)?.label ?? g).join(', ')
          : 'All groups',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) =>
        r.messageId ? <Badge tone="success">Posted</Badge> : <Badge tone="warning">Waiting to post</Badge>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => open(r)} aria-label={`Edit ${r.title}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh(r.id)}
            disabled={pending}
            aria-label={`Refresh ${r.title}`}
          >
            Refresh
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} aria-label={`Delete ${r.title}`}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card className="mt-6">
      <CardHeader
        title="Role panels"
        description="A message in a channel with one button per role. Members click to add or remove roles; the panel updates itself when you change the list above."
        actions={
          <div className="flex gap-2">
            {rows.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={pending}>
                Refresh all
              </Button>
            )}
            <Button size="sm" onClick={() => open('new')}>
              Post a panel
            </Button>
          </div>
        }
      />
      {enabledRoleCount > 25 && (
        <Alert tone="warning" title="More than 25 roles" className="mx-4 mb-4">
          A panel shows at most 25 buttons. Split roles across panels by group, or members can use /roles for
          the rest.
        </Alert>
      )}
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Role panels"
        empty={
          <EmptyState
            title="No role panels yet"
            description="Post one in a channel like #roles so members can pick roles with a click."
          />
        }
      />

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Post a role panel' : 'Edit role panel'}
        description="Members need to be able to see the channel; the bot needs View Channel, Send Messages and Embed Links."
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="rolepanel-form" loading={pending}>
              {editing === 'new' ? 'Post panel' : 'Save'}
            </Button>
          </>
        }
      >
        <form id="rolepanel-form" onSubmit={save} className="space-y-4" noValidate>
          {error && !Object.keys(fieldErrors).length && (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          )}
          <Field id="rp-channel" label="Channel" required error={fieldErrors.channelId}>
            {(p) => (
              <ChannelPicker
                control={p}
                value={d.channelId}
                onChange={(v) => setD((x) => ({ ...x, channelId: v }))}
                channels={channels}
                allowEmpty={false}
              />
            )}
          </Field>
          <Field id="rp-title" label="Title" required error={fieldErrors.title}>
            {(p) => (
              <Input
                {...p}
                value={d.title}
                maxLength={100}
                onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))}
              />
            )}
          </Field>
          <Field
            id="rp-desc"
            label="Text above the buttons"
            help="Optional. Default: “Click a button to add a role. Click it again to remove it.”"
            error={fieldErrors.description}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={1000}
                value={d.description}
                onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))}
              />
            )}
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">Roles shown</legend>
            <p className="mb-2 text-xs text-fg-muted">Leave all unticked to show every group.</p>
            <div className="flex flex-wrap gap-4">
              {GROUPS.map((g) => (
                <Checkbox
                  key={g.value}
                  id={`rp-group-${g.value}`}
                  label={g.label}
                  checked={d.groups.includes(g.value)}
                  onChange={(e) => toggleGroup(g.value, e.target.checked)}
                />
              ))}
            </div>
          </fieldset>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        loading={pending}
        title="Delete this role panel?"
        description="Its message is removed from Discord. Members keep the roles they already have."
        confirmLabel="Delete panel"
      />
    </Card>
  );
}
