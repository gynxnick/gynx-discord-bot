'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ServiceView } from '@/app/api/status/views';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, relativeTime } from '@/lib/format';
import { ServiceStateBadge, STATE_LABEL } from './labels';
import {
  SERVICE_KINDS,
  emptyServiceForm,
  serviceToForm,
  servicePayload,
  slugify,
  type ServiceFormValues,
} from './service-form';

export interface UptimeCell {
  d1: string | null;
  d7: string | null;
  d30: string | null;
}

const KIND_LABEL: Record<string, string> = {
  HTTP: 'HTTP',
  TCP: 'TCP',
  STATUSPAGE: 'Status page',
  MANUAL: 'Manual',
};
const MANUAL_STATES = ['OPERATIONAL', 'DEGRADED', 'OUTAGE', 'UNKNOWN'] as const;

export function ServicesManager({
  services,
  uptime,
  timezone,
  canManage,
  canSetState,
  canAllowPrivate,
  defaults,
}: {
  services: ServiceView[];
  uptime: Record<string, UptimeCell>;
  timezone: string;
  canManage: boolean;
  canSetState: boolean;
  canAllowPrivate: boolean;
  defaults: { failureThreshold: number; recoveryThreshold: number };
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();

  const [editing, setEditing] = useState<ServiceView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ServiceView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [stateFor, setStateFor] = useState<ServiceView | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/api/status/services/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
      toast.success(
        'Service deleted',
        `${deleting.name} is no longer monitored. Its status subscriptions were removed.`,
      );
      setDeleting(null);
      router.refresh();
    } catch (e) {
      toast.error('Could not delete service', (e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const uptimeText = (slug: string, key: keyof UptimeCell) => {
    const u = uptime[slug];
    if (!u) return <span className="text-fg-muted">—</span>;
    const v = u[key];
    return v === null || v === 'no data' ? (
      <span className="text-fg-muted">no data</span>
    ) : (
      <span className="tabular-nums">{v}</span>
    );
  };

  const columns: Column<ServiceView>[] = [
    {
      key: 'name',
      header: 'Service',
      cell: (s) => (
        <div className="min-w-[10rem]">
          <p className="font-medium text-fg">{s.name}</p>
          <p className="font-mono text-xs text-fg-muted">{s.slug}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {!s.public && <Badge>Private</Badge>}
            {!s.enabled && <Badge tone="warning">Paused</Badge>}
            {s.allowPrivate && <Badge tone="warning">Private network</Badge>}
          </div>
        </div>
      ),
    },
    {
      key: 'region',
      header: 'Region',
      hideOnMobile: true,
      cell: (s) => s.region ?? <span className="text-fg-muted">—</span>,
    },
    { key: 'kind', header: 'Kind', hideOnMobile: true, cell: (s) => KIND_LABEL[s.kind] ?? s.kind },
    { key: 'state', header: 'State', cell: (s) => <ServiceStateBadge state={s.state} /> },
    {
      key: 'checked',
      header: 'Last checked',
      hideOnMobile: true,
      cell: (s) =>
        s.kind === 'MANUAL' ? (
          <span className="text-fg-muted">Set manually</span>
        ) : (
          <span
            className="whitespace-nowrap text-fg-muted"
            title={formatDateTime(s.lastCheckedAt, timezone)}
            suppressHydrationWarning
          >
            {relativeTime(s.lastCheckedAt)}
          </span>
        ),
    },
    { key: 'u1', header: '24h', align: 'right', cell: (s) => uptimeText(s.slug, 'd1') },
    { key: 'u7', header: '7d', align: 'right', hideOnMobile: true, cell: (s) => uptimeText(s.slug, 'd7') },
    { key: 'u30', header: '30d', align: 'right', hideOnMobile: true, cell: (s) => uptimeText(s.slug, 'd30') },
    ...(canManage
      ? [
          {
            key: 'target',
            header: 'Target',
            hideOnMobile: true,
            cell: (s: ServiceView) =>
              s.target ? (
                <span className="break-all font-mono text-xs text-fg-muted">
                  {s.target}
                  {s.port ? `:${s.port}` : ''}
                </span>
              ) : (
                <span className="text-fg-muted">—</span>
              ),
          } satisfies Column<ServiceView>,
        ]
      : []),
    ...(canManage || canSetState
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (s: ServiceView) => (
              <div className="flex justify-end gap-1">
                {canSetState && s.kind === 'MANUAL' && (
                  <Button size="sm" variant="secondary" onClick={() => setStateFor(s)}>
                    Set state
                  </Button>
                )}
                {canManage && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(s)}
                      aria-label={`Edit ${s.name}`}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => setDeleting(s)}
                      aria-label={`Delete ${s.name}`}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            ),
          } satisfies Column<ServiceView>,
        ]
      : []),
  ];

  return (
    <>
      <Card>
        <CardHeader
          title="Monitored services"
          description="Uptime is computed from stored health checks for public, enabled services. “no data” means no checks were recorded in that period."
          actions={
            canManage && (
              <Button size="sm" onClick={() => setEditing('new')}>
                Add service
              </Button>
            )
          }
        />
        <Table
          columns={columns}
          rows={services}
          rowKey={(s) => s.id}
          caption="Monitored services"
          empty={
            <EmptyState
              title="No services monitored yet"
              description={
                canManage
                  ? 'Add a service to start health checks and show it on the status board.'
                  : 'Ask someone with status management to add services.'
              }
            />
          }
        />
      </Card>

      {editing && (
        <ServiceDialog
          service={editing === 'new' ? null : editing}
          canAllowPrivate={canAllowPrivate}
          defaults={defaults}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {stateFor && (
        <ManualStateDialog
          service={stateFor}
          onClose={() => setStateFor(null)}
          onSaved={() => {
            setStateFor(null);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title={`Delete ${deleting?.name ?? 'service'}?`}
        description="Health-check history and member subscriptions for this service are removed. Past incidents keep their text. This cannot be undone."
        confirmLabel="Delete service"
      />
    </>
  );
}

function ServiceDialog({
  service,
  canAllowPrivate,
  defaults,
  onClose,
  onSaved,
}: {
  service: ServiceView | null;
  canAllowPrivate: boolean;
  defaults: { failureThreshold: number; recoveryThreshold: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const [form, setForm] = useState<ServiceFormValues>(() =>
    service ? serviceToForm(service) : emptyServiceForm(),
  );
  const [slugTouched, setSlugTouched] = useState(Boolean(service));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ServiceFormValues>(k: K, v: ServiceFormValues[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const needsTarget = form.kind !== 'MANUAL';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { payload, errors: local } = servicePayload(form, service ?? undefined);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;
    if (service && Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (service)
        await api(`/api/status/services/${encodeURIComponent(service.id)}`, {
          method: 'PATCH',
          body: payload,
        });
      else await api('/api/status/services', { method: 'POST', body: payload });
      toast.success(
        service ? 'Service updated' : 'Service added',
        service ? undefined : 'The first check runs on the next monitoring cycle.',
      );
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setErrors(err.fieldErrors());
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!saving}
      size="lg"
      title={service ? `Edit ${service.name}` : 'Add monitored service'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="service-form" loading={saving} loadingLabel="Saving…">
            {service ? 'Save changes' : 'Add service'}
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="svc-name"
            label="Name"
            required
            error={errors.name}
            help="Shown publicly on the status board."
          >
            {(p) => (
              <Input
                {...p}
                value={form.name}
                maxLength={80}
                onChange={(e) => {
                  set('name', e.target.value);
                  if (!slugTouched) set('slug', slugify(e.target.value));
                }}
              />
            )}
          </Field>
          <Field
            id="svc-slug"
            label="Slug"
            required
            error={errors.slug}
            help="Lowercase letters, digits and dashes. Used by /status commands."
          >
            {(p) => (
              <Input
                {...p}
                className="font-mono"
                value={form.slug}
                maxLength={40}
                onChange={(e) => {
                  setSlugTouched(true);
                  set('slug', e.target.value);
                }}
              />
            )}
          </Field>
          <Field id="svc-region" label="Region" error={errors.region}>
            {(p) => (
              <Input
                {...p}
                value={form.region}
                maxLength={60}
                placeholder="EU West"
                onChange={(e) => set('region', e.target.value)}
              />
            )}
          </Field>
          <Field id="svc-kind" label="Check type" error={errors.kind}>
            {(p) => (
              <Select
                {...p}
                value={form.kind}
                onChange={(e) => set('kind', e.target.value as ServiceFormValues['kind'])}
                options={SERVICE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k]! }))}
              />
            )}
          </Field>
        </div>
        <Field id="svc-desc" label="Description" error={errors.description} help="Optional, shown publicly.">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={form.description}
              maxLength={300}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>

        {needsTarget && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id="svc-target"
              label={form.kind === 'TCP' ? 'Host' : 'URL'}
              required
              className={form.kind === 'TCP' ? 'sm:col-span-2' : 'sm:col-span-3'}
              error={errors.target}
              help="Internal: only visible to staff with status management. Never shown to members."
            >
              {(p) => (
                <Input
                  {...p}
                  className="font-mono"
                  value={form.target}
                  maxLength={500}
                  placeholder={form.kind === 'TCP' ? 'node1.example.com' : 'https://example.com/health'}
                  onChange={(e) => set('target', e.target.value)}
                />
              )}
            </Field>
            {form.kind === 'TCP' && (
              <Field id="svc-port" label="Port" required error={errors.port}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => set('port', e.target.value)}
                  />
                )}
              </Field>
            )}
          </div>
        )}

        {needsTarget && (
          <div className="grid gap-4 sm:grid-cols-3">
            {form.kind !== 'TCP' && (
              <Field
                id="svc-expected"
                label="Expected status"
                error={errors.expectedStatus}
                help="Blank = any 2xx"
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    min={100}
                    max={599}
                    value={form.expectedStatus}
                    onChange={(e) => set('expectedStatus', e.target.value)}
                  />
                )}
              </Field>
            )}
            <Field id="svc-timeout" label="Timeout (ms)" error={errors.timeoutMs} help="500–30000">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={500}
                  max={30000}
                  value={form.timeoutMs}
                  onChange={(e) => set('timeoutMs', e.target.value)}
                />
              )}
            </Field>
            <Field
              id="svc-degraded"
              label="Degraded above (ms)"
              error={errors.degradedLatencyMs}
              help="Blank = latency never degrades"
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60000}
                  value={form.degradedLatencyMs}
                  onChange={(e) => set('degradedLatencyMs', e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        {needsTarget && (
          <fieldset className="rounded border border-border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
              Threshold override
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="svc-fail"
                label="Failures before outage"
                error={errors.failureThreshold}
                help={`Blank = guild default (${defaults.failureThreshold})`}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={20}
                    value={form.failureThreshold}
                    onChange={(e) => set('failureThreshold', e.target.value)}
                  />
                )}
              </Field>
              <Field
                id="svc-recover"
                label="Successes before recovery"
                error={errors.recoveryThreshold}
                help={`Blank = guild default (${defaults.recoveryThreshold})`}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={20}
                    value={form.recoveryThreshold}
                    onChange={(e) => set('recoveryThreshold', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </fieldset>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="svc-sort" label="Sort order" error={errors.sortOrder} help="Lower first (−1000…1000)">
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={-1000}
                max={1000}
                value={form.sortOrder}
                onChange={(e) => set('sortOrder', e.target.value)}
              />
            )}
          </Field>
          <div className="space-y-3 sm:col-span-2 sm:pt-6">
            <Checkbox
              id="svc-public"
              label="Show publicly"
              description="Listed on the status board and /status."
              checked={form.public}
              onChange={(e) => set('public', e.target.checked)}
            />
            <Checkbox
              id="svc-enabled"
              label="Enabled"
              description="Paused services are not checked."
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
          </div>
        </div>

        {needsTarget && (canAllowPrivate || form.allowPrivate) && (
          <div className="space-y-2 rounded border border-warning/40 bg-warning-soft p-3">
            <Switch
              id="svc-private"
              label="Allow private / internal addresses"
              description={
                canAllowPrivate
                  ? 'Lets checks reach loopback, LAN and reserved IPs. Only enable for infrastructure you own — this is audited.'
                  : 'Enabled by an administrator. Changing it requires the settings permission.'
              }
              checked={form.allowPrivate}
              disabled={!canAllowPrivate}
              onChange={(v) => set('allowPrivate', v)}
            />
            {errors.allowPrivate && (
              <p className="text-xs text-danger" role="alert">
                {errors.allowPrivate}
              </p>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

function ManualStateDialog({
  service,
  onClose,
  onSaved,
}: {
  service: ServiceView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const [state, setState] = useState<string>(
    MANUAL_STATES.includes(service.state as (typeof MANUAL_STATES)[number]) ? service.state : 'OPERATIONAL',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/status/services/${encodeURIComponent(service.id)}/state`, {
        method: 'POST',
        body: { state },
      });
      toast.success('State updated', `${service.name} is now ${STATE_LABEL[state]?.toLowerCase()}.`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!saving}
      size="sm"
      title={`Set state: ${service.name}`}
      description="Manual services are not probed. A state change posts an alert like an automatic check would."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} loadingLabel="Saving…" disabled={state === service.state}>
            Set state
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <Field id="manual-state" label="State">
        {(p) => (
          <Select
            {...p}
            value={state}
            onChange={(e) => setState(e.target.value)}
            options={MANUAL_STATES.map((s) => ({ value: s, label: STATE_LABEL[s]! }))}
          />
        )}
      </Field>
    </Dialog>
  );
}
