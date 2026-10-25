'use client';

import { useState, type FormEvent } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';

export interface DutyProfileRow {
  userId: string;
  publicName: string;
  enabled: boolean;
}
export interface OnDutyRow {
  userId: string;
  publicName: string;
  startedAt: string;
  expiresAt: string;
}

const fmt = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

export function DutyManager({
  profiles,
  onDuty,
  timeZone,
}: {
  profiles: DutyProfileRow[];
  onDuty: OnDutyRow[];
  timeZone: string;
}) {
  const { run, pending, fieldErrors, error } = useApiAction();
  const [editing, setEditing] = useState<DutyProfileRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<DutyProfileRow | null>(null);
  const [ending, setEnding] = useState<OnDutyRow | null>(null);
  const [d, setD] = useState<DutyProfileRow>({ userId: '', publicName: '', enabled: true });

  const open = (p: DutyProfileRow | 'new') => {
    setEditing(p);
    setD(p === 'new' ? { userId: '', publicName: '', enabled: true } : { ...p });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run(
      '/api/support/profiles',
      'POST',
      { ...d, userId: d.userId.trim() },
      {
        success: 'Public name saved',
        successDescription: 'The support status panel updates within a few seconds.',
        errorTitle: 'Not saved',
      },
    );
    if (res) setEditing(null);
  };

  const onDutyCols: Column<OnDutyRow>[] = [
    {
      key: 'name',
      header: 'Shown as',
      cell: (r) => <span className="font-medium text-fg">🟢 {r.publicName}</span>,
    },
    { key: 'since', header: 'On duty since', cell: (r) => fmt(r.startedAt, timeZone) },
    {
      key: 'ends',
      header: 'Ends automatically',
      hideOnMobile: true,
      cell: (r) => fmt(r.expiresAt, timeZone),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEnding(r)}
          aria-label={`End ${r.publicName}'s session`}
        >
          End session
        </Button>
      ),
    },
  ];

  const profileCols: Column<DutyProfileRow>[] = [
    {
      key: 'name',
      header: 'Public name',
      cell: (r) => <span className="font-medium text-fg">{r.publicName}</span>,
    },
    {
      key: 'user',
      header: 'Discord user ID',
      hideOnMobile: true,
      cell: (r) => <span className="font-mono text-xs">{r.userId}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (r.enabled ? <Badge tone="success">Can go on duty</Badge> : <Badge>Disabled</Badge>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => open(r)} aria-label={`Edit ${r.publicName}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRemoving(r)}
            aria-label={`Remove ${r.publicName}`}
          >
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`On duty now (${onDuty.length})`}
          description="Customers see these names on the support status panel. Staff go on and off duty with /duty on and /duty off."
        />
        <Table
          columns={onDutyCols}
          rows={onDuty}
          rowKey={(r) => r.userId}
          caption="Staff on duty"
          empty={<EmptyState title="Nobody is on duty" description="The panel shows support as offline." />}
        />
      </Card>

      <Card>
        <CardHeader
          title="Approved public names"
          description="Only staff listed here can go on duty, and customers only ever see the public name (never their Discord name or ID)."
          actions={
            <Button size="sm" onClick={() => open('new')}>
              Approve a name
            </Button>
          }
        />
        <Table
          columns={profileCols}
          rows={profiles}
          rowKey={(r) => r.userId}
          caption="Approved public names"
          empty={
            <EmptyState
              title="No names approved yet"
              description="Approve a public name for each support staff member."
            />
          }
        />
      </Card>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Approve a public name' : 'Edit public name'}
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="duty-form" loading={pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="duty-form" onSubmit={save} className="space-y-4" noValidate>
          {error && !Object.keys(fieldErrors).length && (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          )}
          <Field
            id="duty-user"
            label="Discord user ID"
            required
            help="In Discord: Developer Mode on, right-click the staff member → Copy User ID."
            error={fieldErrors.userId}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={d.userId}
                disabled={editing !== 'new'}
                onChange={(e) => setD((x) => ({ ...x, userId: e.target.value }))}
              />
            )}
          </Field>
          <Field
            id="duty-name"
            label="Public name"
            required
            help="What customers see, e.g. “Alex”. 1–32 characters, no mentions, links or formatting."
            error={fieldErrors.publicName}
          >
            {(p) => (
              <Input
                {...p}
                maxLength={32}
                value={d.publicName}
                onChange={(e) => setD((x) => ({ ...x, publicName: e.target.value }))}
              />
            )}
          </Field>
          <Switch
            id="duty-enabled"
            checked={d.enabled}
            onChange={(v) => setD((x) => ({ ...x, enabled: v }))}
            label="Can go on duty"
            description="Turning this off ends any active session."
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const ok = await run(
            `/api/support/profiles/${encodeURIComponent(removing.userId)}`,
            'DELETE',
            undefined,
            {
              success: 'Public name removed',
              errorTitle: 'Could not remove',
            },
          );
          if (ok) setRemoving(null);
        }}
        loading={pending}
        title="Remove this public name?"
        description="They can no longer go on duty, and any active session ends now."
        confirmLabel="Remove"
      />

      <ConfirmDialog
        open={ending !== null}
        onCancel={() => setEnding(null)}
        onConfirm={async () => {
          if (!ending) return;
          const ok = await run(
            `/api/support/sessions/${encodeURIComponent(ending.userId)}/end`,
            'POST',
            {},
            {
              success: 'Session ended',
              errorTitle: 'Could not end session',
            },
          );
          if (ok) setEnding(null);
        }}
        loading={pending}
        title="End this duty session?"
        description={ending ? `${ending.publicName} goes off duty and the panel updates.` : undefined}
        confirmLabel="End session"
      />
    </div>
  );
}
