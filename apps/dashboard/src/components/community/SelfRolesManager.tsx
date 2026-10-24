'use client';

import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';
import { roleName, type RoleOption } from './picker-utils';
import { RolePicker } from './pickers';
import { selfRoleToPayload, type SelfRoleDraft } from './self-role-payload';
import { useApiAction } from './useApiAction';

export interface SelfRoleRow {
  id: string;
  roleId: string;
  label: string;
  description: string | null;
  emoji: string | null;
  group: string;
  enabled: boolean;
  sortOrder: number;
}

const GROUPS = [
  { value: 'games', label: 'Games' },
  { value: 'community', label: 'Community' },
  { value: 'notifications', label: 'Notifications' },
];
const groupLabel = (g: string) => GROUPS.find((x) => x.value === g)?.label ?? g;

const blankDraft = (): SelfRoleDraft => ({
  roleId: '',
  label: '',
  description: '',
  emoji: '',
  group: 'games',
  enabled: true,
  sortOrder: '0',
});

export function SelfRolesManager({ rows, roles }: { rows: SelfRoleRow[]; roles: RoleOption[] }) {
  const { run, pending, fieldErrors, error, clearErrors } = useApiAction();
  const [editing, setEditing] = useState<SelfRoleRow | 'new' | null>(null);
  const [d, setD] = useState<SelfRoleDraft>(blankDraft);
  const [deleting, setDeleting] = useState<SelfRoleRow | null>(null);
  const set = <K extends keyof SelfRoleDraft>(k: K, v: SelfRoleDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const open = (r: SelfRoleRow | 'new') => {
    clearErrors();
    setEditing(r);
    setD(
      r === 'new'
        ? blankDraft()
        : {
            roleId: r.roleId,
            label: r.label,
            description: r.description ?? '',
            emoji: r.emoji ?? '',
            group: r.group as SelfRoleDraft['group'],
            enabled: r.enabled,
            sortOrder: String(r.sortOrder),
          },
    );
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const isNew = editing === 'new';
    const body = selfRoleToPayload(d, isNew);
    const res = isNew
      ? await run('/api/community/roles', 'POST', body, {
          success: 'Role added',
          errorTitle: 'Role was not added',
        })
      : await run(`/api/community/roles/${encodeURIComponent((editing as SelfRoleRow).id)}`, 'PATCH', body, {
          success: 'Role updated',
          errorTitle: 'Could not update role',
        });
    if (res) setEditing(null);
  };

  const toggle = (r: SelfRoleRow) =>
    run(
      `/api/community/roles/${encodeURIComponent(r.id)}`,
      'PATCH',
      { enabled: !r.enabled },
      {
        success: r.enabled ? 'Role disabled' : 'Role enabled',
        successDescription: r.enabled ? undefined : 'Safety was re-checked against Discord.',
        errorTitle: r.enabled ? 'Could not disable role' : 'Role was not re-enabled',
      },
    );

  const remove = async () => {
    if (!deleting) return;
    const res = await run(`/api/community/roles/${encodeURIComponent(deleting.id)}`, 'DELETE', undefined, {
      success: 'Role removed from the list',
      errorTitle: 'Could not remove role',
    });
    if (res) setDeleting(null);
  };

  const listed = new Set(rows.map((r) => r.roleId));
  const pickable = roles.filter((r) => !listed.has(r.id) && !r.managed);

  const columns: Column<SelfRoleRow>[] = [
    {
      key: 'role',
      header: 'Role',
      cell: (r) => (
        <div>
          <p className="font-medium text-fg">
            {r.emoji && <span className="mr-1.5">{r.emoji.startsWith('<') ? '' : r.emoji}</span>}
            {r.label}
          </p>
          <p className="text-xs text-fg-muted">{roleName(roles, r.roleId)}</p>
        </div>
      ),
    },
    { key: 'group', header: 'Group', cell: (r) => groupLabel(r.group) },
    {
      key: 'description',
      header: 'Description',
      hideOnMobile: true,
      cell: (r) => <span className="text-fg-muted">{r.description ?? '—'}</span>,
    },
    {
      key: 'order',
      header: 'Order',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="tabular-nums">{r.sortOrder}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (r.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Disabled</Badge>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => open(r)} aria-label={`Edit ${r.label}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void toggle(r)}
            disabled={pending}
            aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.label}`}
          >
            {r.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} aria-label={`Remove ${r.label}`}>
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Self-assignable roles"
        description="Members pick these with /roles. Disabled roles stay listed here but are not offered."
        actions={
          <Button size="sm" onClick={() => open('new')}>
            Add role
          </Button>
        }
      />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Self-assignable roles"
        empty={
          <EmptyState
            title="No self-assignable roles yet"
            description="Add game, community or notification roles members can toggle themselves."
          />
        }
      />

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add self-assignable role' : 'Edit self-assignable role'}
        description={
          editing === 'new' ? 'The server checks the role live in Discord before adding it.' : undefined
        }
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="selfrole-form" loading={pending} loadingLabel="Checking…">
              {editing === 'new' ? 'Add role' : 'Save'}
            </Button>
          </>
        }
      >
        <form id="selfrole-form" onSubmit={save} className="space-y-4" noValidate>
          {error && !Object.keys(fieldErrors).length && (
            <Alert tone="danger" title="The role was rejected">
              {error}
            </Alert>
          )}
          {editing === 'new' && (
            <Field
              id="sr-role"
              label="Discord role"
              required
              help="Never allowed: @everyone, managed/bot roles, roles at or above the bot's highest role, roles with privileged permissions, and staff/partner/verified roles."
              error={fieldErrors.roleId}
            >
              {(p) => (
                <RolePicker
                  control={p}
                  value={d.roleId}
                  onChange={(v) => {
                    set('roleId', v);
                    if (!d.label) set('label', roles.find((r) => r.id === v)?.name ?? '');
                  }}
                  roles={pickable}
                />
              )}
            </Field>
          )}
          <Field id="sr-label" label="Label" required error={fieldErrors.label}>
            {(p) => (
              <Input {...p} value={d.label} onChange={(e) => set('label', e.target.value)} maxLength={80} />
            )}
          </Field>
          <Field
            id="sr-desc"
            label="Description"
            help="Shown in the role menu (max 100 characters)."
            error={fieldErrors.description}
          >
            {(p) => (
              <Input
                {...p}
                value={d.description}
                onChange={(e) => set('description', e.target.value)}
                maxLength={100}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="sr-emoji" label="Emoji" help="Unicode or <:name:id>" error={fieldErrors.emoji}>
              {(p) => (
                <Input {...p} value={d.emoji} onChange={(e) => set('emoji', e.target.value)} maxLength={64} />
              )}
            </Field>
            <Field id="sr-group" label="Group" error={fieldErrors.group}>
              {(p) => (
                <Select
                  {...p}
                  value={d.group}
                  onChange={(e) => set('group', e.target.value as SelfRoleDraft['group'])}
                  options={GROUPS}
                />
              )}
            </Field>
            <Field id="sr-order" label="Order" error={fieldErrors.sortOrder}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={1000}
                  value={d.sortOrder}
                  onChange={(e) => set('sortOrder', e.target.value)}
                />
              )}
            </Field>
          </div>
          {editing === 'new' && (
            <Switch id="sr-enabled" checked={d.enabled} onChange={(v) => set('enabled', v)} label="Enabled" />
          )}
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        loading={pending}
        title="Remove from self-roles?"
        description={
          deleting
            ? `Members will no longer be able to toggle "${deleting.label}". Members who already have the role keep it.`
            : undefined
        }
        confirmLabel="Remove"
      />
    </Card>
  );
}
