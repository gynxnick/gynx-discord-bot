'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, truncateText } from '@/lib/format';
import { ServiceChecklist, type ServiceRef } from './IncidentDialogs';
import { MaintenanceBadge } from './labels';

export interface MaintenanceRow {
  id: string;
  title: string;
  description: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  startsAt: string;
  endsAt: string;
  /** Guild-local "YYYY-MM-DDTHH:MM" for the datetime inputs. */
  startsLocal: string;
  endsLocal: string;
  services: ServiceRef[];
}

export function MaintenanceTable({
  title,
  description,
  rows,
  timezone,
  canManage,
  services,
  emptyTitle,
  footer,
}: {
  title: string;
  description?: string;
  rows: MaintenanceRow[];
  timezone: string;
  canManage: boolean;
  services: ServiceRef[];
  emptyTitle: string;
  footer?: ReactNode;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState<MaintenanceRow | null>(null);
  const [confirm, setConfirm] = useState<{ row: MaintenanceRow; op: 'cancel' | 'end' } | null>(null);
  const [busy, setBusy] = useState(false);

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await api(`/api/status/maintenance/${encodeURIComponent(confirm.row.id)}/${confirm.op}`, {
        method: 'POST',
      });
      toast.success(
        confirm.op === 'cancel' ? 'Maintenance cancelled' : 'Maintenance ended',
        confirm.op === 'cancel'
          ? 'Members are told if it had already been announced.'
          : 'Services return to normal checks.',
      );
      setConfirm(null);
      router.refresh();
    } catch (e) {
      toast.error('Action failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = (r: MaintenanceRow) => r.status === 'SCHEDULED' || r.status === 'IN_PROGRESS';
  const columns: Column<MaintenanceRow>[] = [
    {
      key: 'title',
      header: 'Maintenance',
      cell: (r) => (
        <div className="min-w-[12rem]">
          <p className="font-medium text-fg">{r.title}</p>
          <p className="text-xs text-fg-muted">{truncateText(r.description, 100)}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <MaintenanceBadge status={r.status} /> },
    {
      key: 'start',
      header: 'Starts',
      cell: (r) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(r.startsAt, timezone)}</span>
      ),
    },
    {
      key: 'end',
      header: 'Ends',
      cell: (r) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(r.endsAt, timezone)}</span>
      ),
    },
    {
      key: 'services',
      header: 'Services',
      hideOnMobile: true,
      cell: (r) => <span className="text-fg-muted">{r.services.map((s) => s.name).join(', ') || '—'}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (r: MaintenanceRow) =>
              open(r) ? (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  {r.status === 'SCHEDULED' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => setConfirm({ row: r, op: 'cancel' })}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => setConfirm({ row: r, op: 'end' })}
                    >
                      End now
                    </Button>
                  )}
                </div>
              ) : null,
          } satisfies Column<MaintenanceRow>,
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption={title}
        empty={<EmptyState title={emptyTitle} />}
      />
      {footer}
      {editing && (
        <MaintenanceDialog
          row={editing}
          services={services}
          timezone={timezone}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        title={confirm?.op === 'cancel' ? 'Cancel this maintenance?' : 'End this maintenance now?'}
        description={
          confirm?.op === 'cancel'
            ? 'Scheduled start/end jobs are cancelled. If members were already notified, a cancellation notice is posted.'
            : 'The window ends immediately and covered services go back to normal health checks.'
        }
        confirmLabel={confirm?.op === 'cancel' ? 'Cancel maintenance' : 'End now'}
        cancelLabel="Keep it"
      />
    </Card>
  );
}

export function NewMaintenanceButton({ services, timezone }: { services: ServiceRef[]; timezone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Schedule maintenance</Button>
      {open && (
        <MaintenanceDialog
          row={null}
          services={services}
          timezone={timezone}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function MaintenanceDialog({
  row,
  services,
  timezone,
  onClose,
  onSaved,
}: {
  row: MaintenanceRow | null;
  services: ServiceRef[];
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const inProgress = row?.status === 'IN_PROGRESS';
  const [title, setTitle] = useState(row?.title ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [startsLocal, setStartsLocal] = useState(row?.startsLocal ?? '');
  const [endsLocal, setEndsLocal] = useState(row?.endsLocal ?? '');
  const [slugs, setSlugs] = useState<string[]>(row?.services.map((s) => s.slug) ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (title.trim().length < 3) local.title = 'Title must be at least 3 characters.';
    if (description.trim().length < 3) local.description = 'Describe the impact (at least 3 characters).';
    if (!startsLocal) local.startsLocal = 'Choose a start time.';
    if (!endsLocal) local.endsLocal = 'Choose an end time.';
    if (startsLocal && endsLocal && endsLocal <= startsLocal)
      local.endsLocal = 'The end must be after the start.';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;

    let body: Record<string, unknown>;
    if (!row)
      body = {
        title: title.trim(),
        description: description.trim(),
        startsLocal,
        endsLocal,
        serviceSlugs: slugs,
      };
    else {
      body = {};
      if (title.trim() !== row.title) body.title = title.trim();
      if (description.trim() !== row.description) body.description = description.trim();
      if (endsLocal !== row.endsLocal) body.endsLocal = endsLocal;
      if (!inProgress) {
        if (startsLocal !== row.startsLocal) body.startsLocal = startsLocal;
        if (
          !same(
            slugs,
            row.services.map((s) => s.slug),
          )
        )
          body.serviceSlugs = slugs;
      }
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    }
    setSaving(true);
    try {
      if (row) await api(`/api/status/maintenance/${encodeURIComponent(row.id)}`, { method: 'PATCH', body });
      else await api('/api/status/maintenance', { method: 'POST', body });
      toast.success(
        row ? 'Maintenance updated' : 'Maintenance scheduled',
        row ? 'Members get a fresh notice if the times changed.' : 'An announcement is posted shortly.',
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
      title={row ? 'Edit maintenance' : 'Schedule maintenance'}
      description={`Times are in the server time zone (${timezone}). Windows can be at most 14 days long.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="maintenance-form" loading={saving} loadingLabel="Saving…">
            {row ? 'Save changes' : 'Schedule'}
          </Button>
        </>
      }
    >
      <form id="maintenance-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        {inProgress && (
          <Alert tone="info">This maintenance is in progress: only the text and end time can change.</Alert>
        )}
        <Field id="mw-title" label="Title" required error={errors.title}>
          {(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field
          id="mw-desc"
          label="Description"
          required
          error={errors.description}
          help="Public: posted to the status channel and sent to subscribers."
        >
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="mw-start" label={`Starts (${timezone})`} required error={errors.startsLocal}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={startsLocal}
                disabled={inProgress}
                onChange={(e) => setStartsLocal(e.target.value)}
              />
            )}
          </Field>
          <Field id="mw-end" label={`Ends (${timezone})`} required error={errors.endsLocal}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={endsLocal}
                onChange={(e) => setEndsLocal(e.target.value)}
              />
            )}
          </Field>
        </div>
        {!inProgress && (
          <ServiceChecklist
            id="mw-services"
            services={services}
            value={slugs}
            onChange={setSlugs}
            error={errors.serviceSlugs}
          />
        )}
      </form>
    </Dialog>
  );
}
