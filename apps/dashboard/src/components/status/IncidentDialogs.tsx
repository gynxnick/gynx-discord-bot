'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { TagInput } from '@/components/settings/TagInput';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Alert } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { INCIDENT_STATUS_LABEL, SEVERITY_LABEL } from './labels';

export interface ServiceRef {
  slug: string;
  name: string;
}

const SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
const OPEN_STATUSES = ['INVESTIGATING', 'IDENTIFIED', 'MONITORING'] as const;
const ALL_STATUSES = [...OPEN_STATUSES, 'RESOLVED'] as const;

/** Checkbox list of services (multi-select). */
export function ServiceChecklist({
  id,
  services,
  value,
  onChange,
  error,
}: {
  id: string;
  services: ServiceRef[];
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
}) {
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-1.5 text-sm font-medium text-fg">Affected services</legend>
      {services.length === 0 ? (
        <p className="text-xs text-fg-muted">No services are configured yet.</p>
      ) : (
        <div className="grid max-h-48 gap-2 overflow-y-auto rounded border border-border p-3 sm:grid-cols-2">
          {services.map((s) => (
            <Checkbox
              key={s.slug}
              id={`${id}-${s.slug}`}
              label={s.name}
              description={<span className="font-mono">{s.slug}</span>}
              checked={value.includes(s.slug)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, s.slug] : value.filter((x) => x !== s.slug))
              }
            />
          ))}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function useSubmit() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setErrors(err.fieldErrors());
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return { errors, setErrors, formError, saving, run };
}

/** "New incident" button + dialog (incidents.manage). */
export function NewIncidentButton({ services }: { services: ServiceRef[] }) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('MINOR');
  const [status, setStatus] = useState<(typeof OPEN_STATUSES)[number]>('INVESTIGATING');
  const [slugs, setSlugs] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const { errors, setErrors, formError, saving, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (title.trim().length < 3) local.title = 'Title must be at least 3 characters.';
    if (description.trim().length < 3) local.description = 'Describe the impact (at least 3 characters).';
    setErrors(local);
    if (Object.keys(local).length) return;
    void run(async () => {
      const incident = await api<{ id: string; ref: string }>('/api/status/incidents', {
        method: 'POST',
        body: {
          title: title.trim(),
          description: description.trim(),
          severity,
          status,
          serviceSlugs: slugs,
          regions,
        },
      });
      toast.success(
        `Incident ${incident.ref} created`,
        'Subscribers and the incident channel are notified shortly.',
      );
      setOpen(false);
      router.push(`/status/incidents/${incident.id}`);
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>New incident</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!saving}
        size="lg"
        title="New incident"
        description="Incident text is public: it is posted to the incident channel and DMed to subscribers. Secrets and IPs are redacted automatically."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="incident-create" loading={saving} loadingLabel="Creating…">
              Create incident
            </Button>
          </>
        }
      >
        <form id="incident-create" onSubmit={submit} noValidate className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field id="inc-title" label="Title" required error={errors.title}>
            {(p) => (
              <Input
                {...p}
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Login failures on EU nodes"
              />
            )}
          </Field>
          <Field
            id="inc-desc"
            label="Description"
            required
            error={errors.description}
            help="What members are experiencing. This becomes the first timeline entry."
          >
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                value={description}
                maxLength={2000}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="inc-sev" label="Severity" error={errors.severity}>
              {(p) => (
                <Select
                  {...p}
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as typeof severity)}
                  options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s]! }))}
                />
              )}
            </Field>
            <Field id="inc-status" label="Initial status" error={errors.status}>
              {(p) => (
                <Select
                  {...p}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  options={OPEN_STATUSES.map((s) => ({ value: s, label: INCIDENT_STATUS_LABEL[s]! }))}
                />
              )}
            </Field>
          </div>
          <ServiceChecklist
            id="inc-services"
            services={services}
            value={slugs}
            onChange={setSlugs}
            error={errors.serviceSlugs}
          />
          <Field id="inc-regions" label="Regions" error={errors.regions} help="Optional, up to 10.">
            {(p) => (
              <TagInput
                id={p.id}
                describedBy={p['aria-describedby']}
                invalid={p['aria-invalid']}
                values={regions}
                onChange={setRegions}
                max={10}
                maxLength={60}
                label="Region"
                placeholder="EU West"
              />
            )}
          </Field>
        </form>
      </Dialog>
    </>
  );
}

/** Edit title / services / regions without posting an update (incidents.manage). */
export function EditIncidentButton({
  incidentId,
  initial,
  services,
}: {
  incidentId: string;
  initial: { title: string; serviceSlugs: string[]; regions: string[] };
  services: ServiceRef[];
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [slugs, setSlugs] = useState(initial.serviceSlugs);
  const [regions, setRegions] = useState(initial.regions);
  const { errors, setErrors, formError, saving, run } = useSubmit();

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (title.trim() !== initial.title) body.title = title.trim();
    if (!same(slugs, initial.serviceSlugs)) body.serviceSlugs = slugs;
    if (!same(regions, initial.regions)) body.regions = regions;
    if (body.title !== undefined && (body.title as string).length < 3) {
      setErrors({ title: 'Title must be at least 3 characters.' });
      return;
    }
    if (Object.keys(body).length === 0) {
      setOpen(false);
      return;
    }
    void run(async () => {
      await api(`/api/status/incidents/${encodeURIComponent(incidentId)}`, { method: 'PATCH', body });
      toast.success('Incident updated', 'Details changed without posting a status update.');
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit details
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!saving}
        size="lg"
        title="Edit incident details"
        description="Changes the title, affected services and regions. To change the status or description, post an update instead."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="incident-edit" loading={saving} loadingLabel="Saving…">
              Save
            </Button>
          </>
        }
      >
        <form id="incident-edit" onSubmit={submit} noValidate className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field id="inc-edit-title" label="Title" required error={errors.title}>
            {(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <ServiceChecklist
            id="inc-edit-services"
            services={services}
            value={slugs}
            onChange={setSlugs}
            error={errors.serviceSlugs}
          />
          <Field id="inc-edit-regions" label="Regions" error={errors.regions}>
            {(p) => (
              <TagInput
                id={p.id}
                describedBy={p['aria-describedby']}
                values={regions}
                onChange={setRegions}
                max={10}
                maxLength={60}
                label="Region"
              />
            )}
          </Field>
        </form>
      </Dialog>
    </>
  );
}

/** Post a timeline update (status + message; RESOLVED requires a resolution summary). */
export function IncidentUpdateForm({
  incidentId,
  currentStatus,
  currentSeverity,
}: {
  incidentId: string;
  currentStatus: string;
  currentSeverity: string;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [status, setStatus] = useState<string>(currentStatus);
  const [message, setMessage] = useState('');
  const [resolution, setResolution] = useState('');
  const [severity, setSeverity] = useState(currentSeverity);
  const { errors, setErrors, formError, saving, run } = useSubmit();
  const resolving = status === 'RESOLVED';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (message.trim().length < 3) local.message = 'Write an update (at least 3 characters).';
    if (resolving && resolution.trim().length < 3)
      local.resolutionSummary = 'A resolution summary is required to resolve an incident.';
    setErrors(local);
    if (Object.keys(local).length) return;
    void run(async () => {
      await api(`/api/status/incidents/${encodeURIComponent(incidentId)}/updates`, {
        method: 'POST',
        body: {
          status,
          message: message.trim(),
          ...(resolving ? { resolutionSummary: resolution.trim() } : {}),
          ...(severity !== currentSeverity ? { severity } : {}),
        },
      });
      toast.success(resolving ? 'Incident resolved' : 'Update posted', 'Subscribers are notified shortly.');
      setMessage('');
      setResolution('');
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title="Post an update"
        description="Public: posted to the incident channel and sent to subscribers."
      />
      <CardBody>
        <form onSubmit={submit} noValidate className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="upd-status" label="Status" error={errors.status}>
              {(p) => (
                <Select
                  {...p}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  options={ALL_STATUSES.map((s) => ({ value: s, label: INCIDENT_STATUS_LABEL[s]! }))}
                />
              )}
            </Field>
            <Field id="upd-sev" label="Severity" error={errors.severity}>
              {(p) => (
                <Select
                  {...p}
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s]! }))}
                />
              )}
            </Field>
          </div>
          <Field id="upd-message" label="Message" required error={errors.message}>
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                value={message}
                maxLength={2000}
                onChange={(e) => setMessage(e.target.value)}
              />
            )}
          </Field>
          {resolving && (
            <Field
              id="upd-resolution"
              label="Resolution summary"
              required
              error={errors.resolutionSummary}
              help="Shown on the resolved incident. Resolving is final."
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={resolution}
                  maxLength={2000}
                  onChange={(e) => setResolution(e.target.value)}
                />
              )}
            </Field>
          )}
          <Button
            type="submit"
            className="w-full sm:w-auto"
            variant={resolving ? 'danger' : 'primary'}
            loading={saving}
            loadingLabel="Posting…"
          >
            {resolving ? 'Resolve incident' : 'Post update'}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
