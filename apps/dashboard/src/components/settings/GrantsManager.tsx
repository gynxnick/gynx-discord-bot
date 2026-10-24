'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PRESET_PERMISSIONS,
  PRIVILEGED_PERMISSIONS,
  ROLE_PRESETS,
  isPermissionKey,
  isRolePreset,
  privilegedKeysIn,
  ungrantableKeys,
  type PermissionKey,
} from '@gynx/permissions';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge, StatusBadge, humanizeEnum } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

export interface GrantRow {
  id: string;
  subjectType: 'ROLE' | 'USER';
  subjectId: string;
  permission: string;
  effect: 'ALLOW' | 'DENY';
  createdById: string;
  createdAt: string;
}
interface RoleOption {
  id: string;
  name: string;
  position: number;
  managed: boolean;
}

const WILDCARDS = [...new Set(ALL_PERMISSIONS.map((k) => k.split('.')[0]!))]
  .filter((prefix) => ALL_PERMISSIONS.filter((k) => k.startsWith(`${prefix}.`)).length > 1)
  .map((prefix) => `${prefix}.*`);

function expand(permission: string): PermissionKey[] {
  if (isRolePreset(permission)) return [...PRESET_PERMISSIONS[permission]];
  if (permission.endsWith('.*')) return ALL_PERMISSIONS.filter((k) => k.startsWith(permission.slice(0, -1)));
  return isPermissionKey(permission) ? [permission] : [];
}

function describe(permission: string): string {
  if (isPermissionKey(permission)) return PERMISSIONS[permission];
  if (isRolePreset(permission)) return `Preset: ${PRESET_PERMISSIONS[permission].length} permissions`;
  if (permission.endsWith('.*')) return `Every ${permission.slice(0, -2)} permission`;
  return 'Unknown permission (ignored)';
}

const SNOWFLAKE = /^\d{17,20}$/;

export function GrantsManager({
  initialGrants,
  roles: initialRoles,
  canManage,
  myPermissions,
  partnerRoleId,
}: {
  initialGrants: GrantRow[];
  roles: RoleOption[];
  canManage: boolean;
  myPermissions: string[];
  partnerRoleId: string | null;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [roles, setRoles] = useState(initialRoles);
  const [loadingRoles, setLoadingRoles] = useState(false);

  const [subjectType, setSubjectType] = useState<'ROLE' | 'USER'>('ROLE');
  const [subjectId, setSubjectId] = useState('');
  const [permission, setPermission] = useState('');
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<GrantRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const mine = useMemo(() => new Set(myPermissions as PermissionKey[]), [myPermissions]);
  const roleName = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);

  const blocked = permission ? ungrantableKeys(mine, permission) : [];
  const partnerPrivileged =
    subjectType === 'ROLE' && partnerRoleId && subjectId === partnerRoleId && effect === 'ALLOW' && permission
      ? privilegedKeysIn(permission)
      : [];
  const expanded = permission ? expand(permission) : [];

  const refreshRoles = async () => {
    setLoadingRoles(true);
    try {
      const r = await api<{ roles: RoleOption[] }>('/api/discord/roles');
      setRoles(r.roles);
    } catch (e) {
      toast.error('Could not load roles', (e as Error).message);
    } finally {
      setLoadingRoles(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!SNOWFLAKE.test(subjectId))
      errs.subjectId = subjectType === 'ROLE' ? 'Choose a role.' : 'Enter a Discord user ID (17–20 digits).';
    if (!permission) errs.permission = 'Choose a permission or preset.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await api('/api/permissions/grants', {
        method: 'POST',
        body: { subjectType, subjectId, permission, effect },
      });
      toast.success('Permission saved');
      setPermission('');
      setSubjectId('');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.issues.length) setErrors(err.fieldErrors());
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api(`/api/permissions/grants/${encodeURIComponent(pendingDelete.id)}`, { method: 'DELETE' });
      toast.success('Permission removed');
      setPendingDelete(null);
      router.refresh();
    } catch (err) {
      toast.error('Could not remove permission', (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const subjectLabel = (g: Pick<GrantRow, 'subjectType' | 'subjectId'>) =>
    g.subjectType === 'ROLE' ? (
      <span>
        <span className="text-fg">@{roleName.get(g.subjectId) ?? 'unknown role'}</span>{' '}
        <span className="font-mono text-xs text-fg-muted">{g.subjectId}</span>
      </span>
    ) : (
      <span>
        <span className="text-fg-muted">User</span> <span className="font-mono text-xs">{g.subjectId}</span>
      </span>
    );

  const columns: Column<GrantRow>[] = [
    { key: 'subject', header: 'Applies to', cell: subjectLabel },
    {
      key: 'permission',
      header: 'Permission',
      cell: (g) => (
        <div>
          <code className="font-mono text-xs text-fg">{g.permission}</code>
          {isRolePreset(g.permission) && (
            <Badge tone="accent" className="ml-2">
              Preset
            </Badge>
          )}
          {expand(g.permission).some((k) => PRIVILEGED_PERMISSIONS.includes(k)) && (
            <Badge tone="warning" className="ml-2">
              Privileged
            </Badge>
          )}
          <p className="mt-0.5 text-xs text-fg-muted">{describe(g.permission)}</p>
        </div>
      ),
    },
    {
      key: 'effect',
      header: 'Effect',
      cell: (g) => <StatusBadge status={g.effect} label={g.effect === 'ALLOW' ? 'Allow' : 'Deny'} />,
    },
    {
      key: 'created',
      header: 'Added',
      hideOnMobile: true,
      cell: (g) => (
        <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(g.createdAt)}</span>
      ),
    },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (g) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPendingDelete(g)}
          aria-label={`Remove ${g.permission} from ${g.subjectType.toLowerCase()} ${g.subjectId}`}
        >
          Remove
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <Card>
          <CardHeader
            title="Add a permission"
            description="You can only grant permissions you hold yourself."
          />
          <CardBody>
            <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field id="grant-subject-type" label="Applies to">
                {(p) => (
                  <Select
                    {...p}
                    value={subjectType}
                    onChange={(e) => {
                      setSubjectType(e.target.value as 'ROLE' | 'USER');
                      setSubjectId('');
                    }}
                    options={[
                      { value: 'ROLE', label: 'A Discord role' },
                      { value: 'USER', label: 'A specific user' },
                    ]}
                  />
                )}
              </Field>
              {subjectType === 'ROLE' ? (
                <Field
                  id="grant-role"
                  label="Role"
                  required
                  error={errors.subjectId}
                  help={
                    <button
                      type="button"
                      className="text-accent hover:underline disabled:opacity-50"
                      onClick={refreshRoles}
                      disabled={loadingRoles}
                    >
                      {loadingRoles ? 'Refreshing roles…' : 'Refresh role list'}
                    </button>
                  }
                >
                  {(p) => (
                    <Select
                      {...p}
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      placeholder={roles.length ? 'Choose a role…' : 'No roles loaded'}
                      options={roles.map((r) => ({
                        value: r.id,
                        label: `@${r.name}${r.managed ? ' (integration)' : ''}${r.id === partnerRoleId ? ' (partner role)' : ''}`,
                      }))}
                    />
                  )}
                </Field>
              ) : (
                <Field
                  id="grant-user"
                  label="User ID"
                  required
                  error={errors.subjectId}
                  help="Right-click the member in Discord → Copy User ID."
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value.trim())}
                      inputMode="numeric"
                      placeholder="123456789012345678"
                      maxLength={20}
                    />
                  )}
                </Field>
              )}
              <Field id="grant-permission" label="Permission or preset" required error={errors.permission}>
                {(p) => (
                  <Select
                    {...p}
                    value={permission}
                    onChange={(e) => setPermission(e.target.value)}
                    placeholder="Choose…"
                  >
                    <optgroup label="Role presets">
                      {ROLE_PRESETS.map((r) => (
                        <option key={r} value={r}>
                          {humanizeEnum(r)}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Permission groups">
                      {WILDCARDS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Individual permissions">
                      {ALL_PERMISSIONS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                )}
              </Field>
              <Field id="grant-effect" label="Effect" help="Deny overrides any allow from other roles.">
                {(p) => (
                  <Select
                    {...p}
                    value={effect}
                    onChange={(e) => setEffect(e.target.value as 'ALLOW' | 'DENY')}
                    options={[
                      { value: 'ALLOW', label: 'Allow' },
                      { value: 'DENY', label: 'Deny' },
                    ]}
                  />
                )}
              </Field>

              {permission && (
                <div className="md:col-span-2 xl:col-span-4">
                  <p className="text-sm text-fg">{describe(permission)}</p>
                  {expanded.length > 1 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Included permissions">
                      {expanded.map((k) => (
                        <li key={k}>
                          <Badge tone={PRIVILEGED_PERMISSIONS.includes(k) ? 'warning' : 'neutral'}>
                            <span title={PERMISSIONS[k]}>{k}</span>
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {blocked.length > 0 && (
                <Alert
                  tone="warning"
                  title="You can't grant all of this"
                  className="md:col-span-2 xl:col-span-4"
                >
                  You don&apos;t hold: {blocked.join(', ')}. The server will reject this grant.
                </Alert>
              )}
              {partnerPrivileged.length > 0 && (
                <Alert
                  tone="warning"
                  title="Not allowed for the partner role"
                  className="md:col-span-2 xl:col-span-4"
                >
                  Privileged permissions ({partnerPrivileged.join(', ')}) can never be granted to the partner
                  role.
                </Alert>
              )}
              {formError && (
                <Alert tone="danger" className="md:col-span-2 xl:col-span-4">
                  {formError}
                </Alert>
              )}
              <div className="md:col-span-2 xl:col-span-4">
                <Button type="submit" loading={saving} loadingLabel="Saving…">
                  Save permission
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info">
          You can view permissions. Changing them requires the permissions.manage permission.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Current grants"
          description={`${initialGrants.length} grant${initialGrants.length === 1 ? '' : 's'}`}
        />
        <Table
          columns={columns}
          rows={initialGrants}
          rowKey={(g) => g.id}
          caption="Staff permission grants"
          empty={
            <EmptyState
              title="No grants yet"
              description="Only the server owner can use the dashboard until roles are granted access."
            />
          }
        />
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Remove this permission?"
        confirmLabel="Remove permission"
        description="Members relying on this grant lose access within about five minutes (when their session refreshes)."
      >
        {pendingDelete && (
          <p className="text-sm text-fg">
            <code className="font-mono">{pendingDelete.permission}</code> (
            {pendingDelete.effect.toLowerCase()}) for {subjectLabel(pendingDelete)}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
