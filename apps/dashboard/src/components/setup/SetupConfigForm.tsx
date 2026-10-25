'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Feedback';
import { Checkbox, Input } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import {
  NAME_MAX,
  SLOWMODE_MAX,
  configToForm,
  extraRestrictedRoles,
  formToPatch,
  normalizeHex,
  type ConfigForm,
} from './config-form';
import type { BlueprintRoleView, BlueprintView, RoutingRow, SetupConfigView } from './types';

const SECTIONS = [
  { id: 'setup-roles', label: 'Roles' },
  { id: 'setup-channels', label: 'Channels' },
  { id: 'setup-restricted', label: 'Restricted channels' },
  { id: 'setup-components', label: 'Components' },
  { id: 'setup-panels', label: 'Panels' },
  { id: 'setup-routing', label: 'Routing' },
  { id: 'setup-text', label: 'Embed text' },
];

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-danger" role="alert">
      {message}
    </p>
  );
}

export function SetupConfigForm({
  initial,
  blueprint,
}: {
  initial: SetupConfigView;
  blueprint: BlueprintView;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [baseline, setBaseline] = useState(initial);
  const [form, setForm] = useState<ConfigForm>(() => configToForm(initial, blueprint));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pending = useMemo(() => formToPatch(baseline, form, blueprint), [baseline, form, blueprint]);
  const dirty = Object.keys(pending.patch).length > 0 || Object.keys(pending.errors).length > 0;
  const staffRoles = blueprint.roles.filter((r) => r.staff);
  const roleName = (key: string) => form.roles[key]?.name ?? key;
  const restrictedChannels = blueprint.categories.flatMap((c) => c.channels.filter((ch) => ch.restrictedTo));

  const update = (fn: (f: ConfigForm) => ConfigForm) => setForm((f) => fn(f));
  const setRole = (key: string, patch: Partial<{ name: string; color: string }>) =>
    update((f) => ({ ...f, roles: { ...f.roles, [key]: { ...f.roles[key]!, ...patch } } }));
  const setName = (key: string, value: string) =>
    update((f) => ({ ...f, names: { ...f.names, [key]: value } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const { patch, errors: local } = formToPatch(baseline, form, blueprint);
    setErrors(local);
    if (Object.keys(local).length) {
      setFormError('Fix the highlighted fields and try again.');
      return;
    }
    if (Object.keys(patch).length === 0) {
      toast.show({
        tone: 'info',
        title: 'Nothing to save',
        description: 'The configuration was not changed.',
      });
      return;
    }
    setSaving(true);
    try {
      const saved = await api<SetupConfigView>('/api/setup/config', { method: 'PATCH', body: patch });
      setBaseline(saved);
      setForm(configToForm(saved, blueprint));
      toast.success('Setup configuration saved', 'Run a preview to see what it changes in Discord.');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.issues.length) setErrors(err.fieldErrors());
        setFormError(err.message);
      } else setFormError('Something went wrong. Please try again.');
      toast.error('Configuration not saved', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setForm(configToForm(baseline, blueprint));
    setErrors({});
    setFormError(null);
  };

  const roleCols: Column<BlueprintRoleView>[] = [
    {
      key: 'name',
      header: 'Role name',
      cell: (r) => {
        const path = `roles.${r.key}.name`;
        return (
          <div className="min-w-[10rem]">
            <label htmlFor={`role-name-${r.key}`} className="sr-only">
              Name for the {r.name} role
            </label>
            <Input
              id={`role-name-${r.key}`}
              value={form.roles[r.key]?.name ?? ''}
              maxLength={NAME_MAX}
              onChange={(e) => setRole(r.key, { name: e.target.value })}
              aria-invalid={errors[path] ? true : undefined}
              aria-describedby={errors[path] ? `${path}-err` : undefined}
            />
            <FieldError id={`${path}-err`} message={errors[path]} />
          </div>
        );
      },
    },
    {
      key: 'color',
      header: 'Colour',
      cell: (r) => {
        const path = `roles.${r.key}.color`;
        const value = form.roles[r.key]?.color ?? '';
        const swatch = normalizeHex(value) ?? '#000000';
        return (
          <div className="min-w-[9rem]">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`Pick colour for ${roleName(r.key)}`}
                value={swatch.toLowerCase()}
                onChange={(e) => setRole(r.key, { color: e.target.value.toUpperCase() })}
                className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border-strong bg-surface p-0.5"
              />
              <label htmlFor={`role-color-${r.key}`} className="sr-only">
                Hex colour for {roleName(r.key)}
              </label>
              <Input
                id={`role-color-${r.key}`}
                value={value}
                maxLength={7}
                spellCheck={false}
                className="w-28 font-mono uppercase"
                onChange={(e) => setRole(r.key, { color: e.target.value })}
                onBlur={(e) => {
                  const n = normalizeHex(e.target.value);
                  if (n) setRole(r.key, { color: n });
                }}
                aria-invalid={errors[path] ? true : undefined}
                aria-describedby={errors[path] ? `${path}-err` : undefined}
              />
            </div>
            <FieldError id={`${path}-err`} message={errors[path]} />
          </div>
        );
      },
    },
    {
      key: 'purpose',
      header: 'Purpose',
      hideOnMobile: true,
      cell: (r) => <span className="text-fg-muted">{r.purpose}</span>,
    },
    {
      key: 'permissions',
      header: 'Server permissions',
      hideOnMobile: true,
      cell: (r) =>
        r.permissions.length === 0 && r.manualPermissions.length === 0 ? (
          <span className="text-xs text-fg-muted">None (channel permissions only)</span>
        ) : (
          <div className="flex max-w-xs flex-wrap gap-1">
            {r.permissions.map((p) => (
              <code key={p} className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px] text-fg">
                {p}
              </code>
            ))}
            {r.manualPermissions.map((p) => (
              <span key={p} className="text-[11px] text-warning">
                Manual: {p}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: 'staff',
      header: 'Type',
      cell: (r) => (r.staff ? <Badge tone="accent">Staff</Badge> : <Badge>Member</Badge>),
    },
  ];

  const routingCols: Column<RoutingRow>[] = [
    {
      key: 'resource',
      header: 'Blueprint resource',
      cell: (r) => (
        <span className="text-fg">
          {r.resourceType === 'channel'
            ? (form.names[r.resourceKey] ?? r.resourceName)
            : roleName(r.resourceKey)}
          {r.private && (
            <Badge className="ml-2" tone="warning">
              Private
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'feature', header: 'Feeds', cell: (r) => r.feature },
    {
      key: 'binding',
      header: 'Setting',
      hideOnMobile: true,
      cell: (r) => <code className="font-mono text-xs text-fg-muted">{r.binding}</code>,
    },
  ];

  return (
    <form onSubmit={submit} noValidate className="space-y-6 pb-20">
      <nav aria-label="Configuration sections" className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded border border-border px-2.5 py-1 text-xs text-fg-muted no-underline hover:bg-surface-hover hover:text-fg hover:no-underline"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {formError && (
        <Alert tone="danger" title="Configuration was not saved">
          {formError}
        </Alert>
      )}
      <Alert tone="info">
        Saving the configuration does not change Discord. Run <Link href="/setup">a preview</Link> afterwards
        to see and confirm the changes.
      </Alert>

      <Card id="setup-roles">
        <CardHeader
          title="Roles"
          description="Names and colours of the blueprint roles, highest first. Server permissions are deliberately minimal; channel permissions do the rest."
        />
        <Table columns={roleCols} rows={blueprint.roles} rowKey={(r) => r.key} caption="Blueprint roles" />
      </Card>

      <Card id="setup-channels">
        <CardHeader
          title="Channels"
          description="Choose which blueprint channels to create and what they are called."
        />
        <CardBody className="space-y-6">
          <p className="text-xs text-fg-muted">
            Emoji are part of the Discord channel name (for example{' '}
            <code className="font-mono">👋・welcome</code>
            ). Renaming a channel that already exists renames it in place; it is never deleted and recreated.
          </p>
          {blueprint.categories.map((cat) => (
            <fieldset key={cat.key} className="rounded-md border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-semibold text-fg">
                {form.names[cat.key] ?? cat.name}
                {cat.private && (
                  <Badge className="ml-2" tone="warning">
                    Private
                  </Badge>
                )}
              </legend>
              <div className="mb-3 max-w-md">
                <label htmlFor={`cat-name-${cat.key}`} className="block text-xs font-medium text-fg-muted">
                  Category name
                </label>
                <Input
                  id={`cat-name-${cat.key}`}
                  value={form.names[cat.key] ?? ''}
                  maxLength={NAME_MAX}
                  onChange={(e) => setName(cat.key, e.target.value)}
                  aria-invalid={errors[`names.${cat.key}`] ? true : undefined}
                  aria-describedby={errors[`names.${cat.key}`] ? `names.${cat.key}-err` : undefined}
                />
                <FieldError id={`names.${cat.key}-err`} message={errors[`names.${cat.key}`]} />
              </div>
              <ul className="divide-y divide-border">
                {cat.channels.map((ch) => {
                  const included = form.included[ch.key] !== false;
                  const namePath = `names.${ch.key}`;
                  const smPath = `slowmode.${ch.key}`;
                  return (
                    <li
                      key={ch.key}
                      className="grid gap-2 py-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_8rem] sm:items-start"
                    >
                      <Checkbox
                        id={`ch-include-${ch.key}`}
                        checked={included}
                        onChange={(e) =>
                          update((f) => ({ ...f, included: { ...f.included, [ch.key]: e.target.checked } }))
                        }
                        label={<span className="font-mono text-xs">{ch.key}</span>}
                        description={
                          [ch.type === 'voice' ? 'Voice' : 'Text', ch.panel ? `panel: ${ch.panel}` : null]
                            .filter(Boolean)
                            .join(' · ') || undefined
                        }
                      />
                      <div>
                        <label htmlFor={`ch-name-${ch.key}`} className="sr-only">
                          Name for {ch.key}
                        </label>
                        <Input
                          id={`ch-name-${ch.key}`}
                          value={form.names[ch.key] ?? ''}
                          maxLength={NAME_MAX}
                          disabled={!included}
                          onChange={(e) => setName(ch.key, e.target.value)}
                          aria-invalid={errors[namePath] ? true : undefined}
                          aria-describedby={errors[namePath] ? `${namePath}-err` : undefined}
                        />
                        <FieldError id={`${namePath}-err`} message={errors[namePath]} />
                      </div>
                      {ch.type === 'text' ? (
                        <div>
                          <label
                            htmlFor={`ch-slow-${ch.key}`}
                            className="block text-xs text-fg-muted sm:sr-only"
                          >
                            Slow mode for {ch.key} (seconds)
                          </label>
                          <div className="flex items-center gap-1.5">
                            <Input
                              id={`ch-slow-${ch.key}`}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={SLOWMODE_MAX}
                              step={1}
                              disabled={!included}
                              value={form.slowmode[ch.key] ?? '0'}
                              onChange={(e) =>
                                update((f) => ({
                                  ...f,
                                  slowmode: { ...f.slowmode, [ch.key]: e.target.value },
                                }))
                              }
                              aria-invalid={errors[smPath] ? true : undefined}
                              aria-describedby={errors[smPath] ? `${smPath}-err` : undefined}
                            />
                            <span className="text-xs text-fg-muted" aria-hidden="true">
                              s
                            </span>
                          </div>
                          <FieldError id={`${smPath}-err`} message={errors[smPath]} />
                        </div>
                      ) : (
                        <span className="hidden sm:block" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
          {errors.excludedChannels && <FieldError id="excluded-err" message={errors.excludedChannels} />}
        </CardBody>
      </Card>

      <Card id="setup-restricted">
        <CardHeader
          title="Restricted channels"
          description="Private staff channels that only some staff roles can see."
        />
        <CardBody className="space-y-4">
          <Alert tone="warning">
            Keep executive and security channels (staff reports, abuse reports) to leadership by default. Do
            not give Moderators access to them unless you are sure.
          </Alert>
          {restrictedChannels.map((ch) => {
            const selected = form.restricted[ch.key] ?? [];
            const extra = extraRestrictedRoles(ch, selected);
            const path = `restrictedAccess.${ch.key}`;
            return (
              <fieldset
                key={ch.key}
                className="rounded-md border border-border p-3"
                aria-describedby={errors[path] ? `${path}-err` : undefined}
              >
                <legend className="px-1 text-sm font-medium text-fg">{form.names[ch.key] ?? ch.name}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {staffRoles.map((r) => (
                    <Checkbox
                      key={r.key}
                      id={`restricted-${ch.key}-${r.key}`}
                      label={roleName(r.key)}
                      checked={selected.includes(r.key)}
                      onChange={(e) =>
                        update((f) => {
                          const cur = f.restricted[ch.key] ?? [];
                          const next = e.target.checked ? [...cur, r.key] : cur.filter((k) => k !== r.key);
                          return { ...f, restricted: { ...f.restricted, [ch.key]: next } };
                        })
                      }
                    />
                  ))}
                </div>
                {extra.length > 0 && (
                  <p className="mt-2 text-xs text-warning">
                    Not in the blueprint default: {extra.map(roleName).join(', ')}.
                  </p>
                )}
                <FieldError id={`${path}-err`} message={errors[path]} />
              </fieldset>
            );
          })}
        </CardBody>
      </Card>

      <Card id="setup-components">
        <CardHeader
          title="Components"
          description="What setup manages on this server. All selected means everything in the blueprint."
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                update((f) => ({
                  ...f,
                  components: Object.fromEntries(blueprint.components.map((c) => [c.key, true])),
                }))
              }
            >
              Select all
            </Button>
          }
        />
        <CardBody>
          <fieldset aria-describedby={errors.components ? 'components-err' : undefined}>
            <legend className="sr-only">Components</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {blueprint.components.map((c) => (
                <Checkbox
                  key={c.key}
                  id={`component-${c.key}`}
                  label={c.label}
                  checked={form.components[c.key] === true}
                  onChange={(e) =>
                    update((f) => ({ ...f, components: { ...f.components, [c.key]: e.target.checked } }))
                  }
                />
              ))}
            </div>
            <FieldError id="components-err" message={errors.components} />
          </fieldset>
        </CardBody>
      </Card>

      <div id="setup-panels" className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Customer support status panel" />
          <CardBody className="space-y-3 text-sm">
            <Switch
              id="setup-show-staff"
              checked={form.showStaffNames}
              onChange={(v) => update((f) => ({ ...f, showStaffNames: v }))}
              label="Show on-duty staff names"
              description="Customers see the approved public names of staff on duty (never Discord names or IDs)."
            />
            <p className="text-fg-muted">
              The panel only shows whether support is available. It never has ticket controls: tickets stay in
              the GYNX web ticketer.
            </p>
            <p className="text-fg-muted">
              Wording: <Link href="/settings/text">Settings → Bot text</Link> (filter the area to “Support”).
              The website button uses the Website URL in <Link href="/settings">Settings → General</Link>.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Staff duty control panel" />
          <CardBody className="space-y-3 text-sm text-fg-muted">
            <p>
              Posted in the private staff duty channel with Go On Duty, Go Off Duty, My Status and View
              On-Duty Team buttons. It uses the same duty sessions as <code className="font-mono">/duty</code>
              , so going on duty there updates the customer panel.
            </p>
            <p>
              Only staff with an approved public name can go on duty. Manage names in{' '}
              <Link href="/status/duty">Status → Support duty</Link>.
            </p>
          </CardBody>
        </Card>
      </div>

      <Card id="setup-routing">
        <CardHeader
          title="Logging and alert routing"
          description="Which blueprint channel or role each feature uses after setup. Setup writes these into the server settings."
        />
        <Table
          columns={routingCols}
          rows={blueprint.routing}
          rowKey={(r) => `${r.resourceKey}:${r.binding}`}
          caption="Feature routing"
        />
      </Card>

      <Card id="setup-text">
        <CardHeader
          title="Embed text"
          description="Setup posts these messages; their wording is edited elsewhere."
        />
        <CardBody>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
            <li>
              Welcome, verification and duty panel text, button labels and the support panel wording:{' '}
              <Link href="/settings/text">Settings → Bot text</Link> (areas “Setup” and “Support”).
            </li>
            <li>
              Rules text and the welcome message:{' '}
              <Link href="/community">Community → Welcome &amp; onboarding</Link>.
            </li>
          </ul>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <p className="mr-auto text-xs text-fg-muted" aria-live="polite">
          {dirty
            ? `${Object.keys(pending.patch).length} section(s) changed${
                Object.keys(pending.errors).length ? ' · fix highlighted fields' : ''
              }`
            : 'No unsaved changes'}
        </p>
        <Button variant="secondary" onClick={reset} disabled={!dirty || saving}>
          Reset
        </Button>
        <Button type="submit" loading={saving} disabled={!dirty}>
          Save configuration
        </Button>
      </div>
    </form>
  );
}
