'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { ChannelPicker, RolePicker, type PickerChannel, type PickerRole } from './DiscordPickers';
import {
  NUMBER_LIMITS,
  buildPatch,
  toForm,
  type NumberPath,
  type SettingsForm,
  type SettingsView,
} from './general-settings';

export interface KindOption {
  key: string;
  label: string;
  /** Staff-only channel (never the same as a public one). */
  private?: boolean;
}

export function GeneralSettingsForm({
  initial,
  modules,
  channelKinds,
  roleKinds,
  channels,
  roles,
  timeZones: zones,
}: {
  /** IANA zones computed on the server (Intl.supportedValuesOf) so server and client render the same list. */
  timeZones: string[];
  initial: SettingsView;
  modules: KindOption[];
  channelKinds: KindOption[];
  roleKinds: KindOption[];
  channels: PickerChannel[] | null;
  roles: PickerRole[] | null;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [baseline, setBaseline] = useState(initial);
  const [form, setForm] = useState<SettingsForm>(() => toForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const zoneSet = useMemo(() => new Set(zones), [zones]);
  const pending = useMemo(() => buildPatch(baseline, form, zoneSet), [baseline, form, zoneSet]);
  const dirty = Object.keys(pending.patch).length > 0 || Object.keys(pending.errors).length > 0;

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setNumber = (path: NumberPath, value: string) =>
    setForm((f) => ({ ...f, numbers: { ...f.numbers, [path]: value } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const { patch, errors: localErrors } = buildPatch(baseline, form, zoneSet);
    setErrors(localErrors);
    if (Object.keys(localErrors).length) {
      setFormError('Fix the highlighted fields and try again.');
      return;
    }
    if (Object.keys(patch).length === 0) {
      toast.show({ tone: 'info', title: 'Nothing to save', description: 'No settings were changed.' });
      return;
    }
    setSaving(true);
    try {
      const saved = await api<SettingsView>('/api/settings', { method: 'PATCH', body: patch });
      setBaseline(saved);
      setForm(toForm(saved));
      toast.success(
        'Settings saved',
        `${Object.keys(patch).length} setting group(s) updated. Changes are audited.`,
      );
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.issues.length) setErrors(err.fieldErrors());
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
      toast.error('Could not save settings', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setForm(toForm(baseline));
    setErrors({});
    setFormError(null);
  };

  const numberField = (path: NumberPath) => {
    const lim = NUMBER_LIMITS[path];
    const fid = `set-${path.replace('.', '-')}`;
    return (
      <Field
        key={path}
        id={fid}
        label={lim.label}
        help={`${lim.min}–${lim.max} ${lim.unit}`}
        error={errors[path]}
      >
        {(p) => (
          <Input
            {...p}
            type="number"
            inputMode="numeric"
            min={lim.min}
            max={lim.max}
            step={1}
            value={form.numbers[path]}
            onChange={(e) => setNumber(path, e.target.value)}
          />
        )}
      </Field>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {formError && (
        <Alert tone="danger" title="Settings were not saved">
          {formError}
        </Alert>
      )}
      {(!channels || !roles) && (
        <Alert tone="warning" title="Discord lists unavailable">
          {!channels && 'Channels '}
          {!channels && !roles && 'and '}
          {!roles && 'Roles '}
          could not be loaded from Discord. You can still enter IDs directly.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="General" />
          <CardBody className="space-y-4">
            <Field
              id="set-timezone"
              label="Time zone"
              help="Used for schedules, reports and every time shown in the dashboard. Type to search."
              error={errors.timezone}
              required
            >
              {(p) => (
                <>
                  <Input
                    {...p}
                    list="set-timezone-list"
                    autoComplete="off"
                    value={form.timezone}
                    onChange={(e) => set('timezone', e.target.value)}
                    maxLength={64}
                  />
                  <datalist id="set-timezone-list">
                    {zones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field
              id="set-support"
              label="External support URL"
              help="Members are pointed here for support (no ticketing in the bot). Must use https://. Leave empty to unset."
              error={errors.supportUrl}
            >
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  inputMode="url"
                  placeholder="https://support.example.com"
                  value={form.supportUrl}
                  onChange={(e) => set('supportUrl', e.target.value)}
                  maxLength={500}
                />
              )}
            </Field>
            <Field
              id="set-website"
              label="Website URL"
              help="Official GYNX website. When set, the support status panel shows a Visit GYNX Website button. Must use https://."
              error={errors.websiteUrl}
            >
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  inputMode="url"
                  placeholder="https://gynx.gg"
                  value={form.websiteUrl}
                  onChange={(e) => set('websiteUrl', e.target.value)}
                  maxLength={500}
                />
              )}
            </Field>
            <Field
              id="set-footer"
              label="Embed footer"
              help="Shown under bot embeds. 1–100 characters."
              error={errors.embedFooter}
              required
            >
              {(p) => (
                <Input
                  {...p}
                  value={form.embedFooter}
                  onChange={(e) => set('embedFooter', e.target.value)}
                  maxLength={100}
                />
              )}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Modules"
            description="Disabled modules reject their commands and background work."
          />
          <CardBody className="space-y-3">
            {modules.map((m) => (
              <Switch
                key={m.key}
                id={`set-module-${m.key}`}
                label={m.label}
                checked={form.enabledModules.includes(m.key)}
                onChange={(on) =>
                  set(
                    'enabledModules',
                    on ? [...form.enabledModules, m.key] : form.enabledModules.filter((x) => x !== m.key),
                  )
                }
              />
            ))}
            {errors.enabledModules && (
              <p className="text-xs text-danger" role="alert">
                {errors.enabledModules}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Channels"
            description="Staff-only channels cannot be the same as public-facing ones."
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {channelKinds.map((k) => (
              <Field
                key={k.key}
                id={`set-ch-${k.key}`}
                label={k.label}
                help={k.private ? 'Staff only' : undefined}
                error={errors[`channels.${k.key}`]}
              >
                {(p) => (
                  <ChannelPicker
                    control={p}
                    channels={channels}
                    value={form.channels[k.key] ?? null}
                    onChange={(v) => set('channels', { ...form.channels, [k.key]: v })}
                  />
                )}
              </Field>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Roles"
            description="The partner role can never be a staff ping or escalation role."
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {roleKinds.map((k) => (
              <Field key={k.key} id={`set-role-${k.key}`} label={k.label} error={errors[`roles.${k.key}`]}>
                {(p) => (
                  <RolePicker
                    control={p}
                    roles={roles}
                    value={form.roles[k.key] ?? null}
                    onChange={(v) => set('roles', { ...form.roles, [k.key]: v })}
                  />
                )}
              </Field>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Status monitoring"
            description="Guild-wide defaults; a service can override its thresholds."
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {numberField('status.checkIntervalSeconds')}
            {numberField('status.failureThreshold')}
            {numberField('status.recoveryThreshold')}
            {numberField('status.alertCooldownMinutes')}
            {numberField('dutyMaxHours')}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Retention & reports"
            description="Older data is purged automatically by the worker."
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField('retention.diagnosticHours')}
              {numberField('retention.reportDays')}
              {numberField('retention.auditDays')}
              {numberField('retention.healthCheckDays')}
              {numberField('retention.activityDays')}
              {numberField('activeMemberMinMessages')}
            </div>
            <Switch
              id="set-notify-reporter"
              label="Notify reporters on closure"
              description="Reporters who opted in get a short DM when their abuse report is closed."
              checked={form.reportNotifyReporter}
              onChange={(v) => set('reportNotifyReporter', v)}
            />
            <Switch
              id="set-suggestion-threads"
              label="Discussion threads for suggestions"
              description="Open a thread under each suggestion card so members discuss it there and the channel stays a clean list. Needs the Create Public Threads permission."
              checked={form.suggestionThreads}
              onChange={(v) => set('suggestionThreads', v)}
            />
          </CardBody>
        </Card>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-void/95 px-4 py-3 sm:mx-0 sm:rounded-lg sm:border">
        <p className="mr-auto text-xs text-fg-muted" aria-live="polite">
          {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
        </p>
        <Button type="button" variant="ghost" onClick={reset} disabled={!dirty || saving}>
          Discard
        </Button>
        <Button type="submit" loading={saving} loadingLabel="Saving…" disabled={!dirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
