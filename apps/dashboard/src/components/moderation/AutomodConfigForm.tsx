'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import {
  IdMultiPicker,
  channelOptions,
  roleOptions,
  type PickerChannel,
  type PickerRole,
} from '@/components/settings/DiscordPickers';
import { TagInput } from '@/components/settings/TagInput';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import {
  AUTOMOD_LISTS,
  AUTOMOD_NUMBERS,
  automodPatch,
  automodToForm,
  normalizeDomain,
  normalizeInvite,
  type AutomodConfigView,
  type AutomodForm,
  type AutomodListKey,
  type AutomodNumberKey,
} from './automod-form';

export function AutomodConfigForm({
  initial,
  channels,
  roles,
}: {
  initial: AutomodConfigView;
  channels: PickerChannel[] | null;
  roles: PickerRole[] | null;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [baseline, setBaseline] = useState(initial);
  const [form, setForm] = useState<AutomodForm>(() => automodToForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(() => Object.keys(automodPatch(baseline, form).patch).length > 0, [baseline, form]);

  const setNum = (k: AutomodNumberKey, v: string) =>
    setForm((f) => ({ ...f, numbers: { ...f.numbers, [k]: v } }));
  const setFlag = (k: keyof AutomodForm['flags'], v: boolean) =>
    setForm((f) => ({ ...f, flags: { ...f.flags, [k]: v } }));
  const setList = (k: AutomodListKey, v: string[]) =>
    setForm((f) => ({ ...f, lists: { ...f.lists, [k]: v } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { patch, errors: local } = automodPatch(baseline, form);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) {
      setFormError('Fix the highlighted fields and try again.');
      return;
    }
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const saved = await api<AutomodConfigView>('/api/moderation/automod/config', {
        method: 'PATCH',
        body: patch,
      });
      setBaseline(saved);
      setForm(automodToForm(saved));
      toast.success('Automod updated', 'The change is saved and written to the audit log.');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setErrors(err.fieldErrors());
      setFormError((err as Error).message);
      toast.error('Could not save automod settings', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const num = (k: AutomodNumberKey) => {
    const lim = AUTOMOD_NUMBERS[k];
    return (
      <Field
        key={k}
        id={`am-${k}`}
        label={lim.label}
        help={`${lim.min}–${lim.max} ${lim.unit}`}
        error={errors[k]}
      >
        {(p) => (
          <Input
            {...p}
            type="number"
            inputMode="numeric"
            min={lim.min}
            max={lim.max}
            value={form.numbers[k]}
            onChange={(e) => setNum(k, e.target.value)}
          />
        )}
      </Field>
    );
  };
  const tags = (
    k: AutomodListKey,
    label: string,
    help: string,
    normalize?: (v: string) => string | null,
    placeholder?: string,
  ) => (
    <Field id={`am-${k}`} label={label} help={help} error={errors[k]}>
      {(p) => (
        <TagInput
          id={p.id}
          describedBy={p['aria-describedby']}
          invalid={p['aria-invalid']}
          values={form.lists[k]}
          onChange={(v) => setList(k, v)}
          max={AUTOMOD_LISTS[k]}
          normalize={normalize}
          label={label}
          placeholder={placeholder}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {formError && (
        <Alert tone="danger" title="Automod settings were not saved">
          {formError}
        </Alert>
      )}
      <Card>
        <CardBody>
          <Switch
            id="am-enabled"
            label="Automod enabled"
            description="When off, messages are not checked at all."
            checked={form.flags.enabled}
            onChange={(v) => setFlag('enabled', v)}
          />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Spam thresholds" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {num('duplicateThreshold')}
            {num('duplicateWindowSeconds')}
            {num('burstThreshold')}
            {num('burstWindowSeconds')}
            {num('maxMentions')}
            {num('newAccountDays')}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Escalation"
            description="Strikes within the window: first hit deletes, then warn, then timeout. Automod never bans."
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {num('strikeWindowHours')}
            {num('timeoutMinutes')}
            {num('warnAtStrikes')}
            {num('timeoutAtStrikes')}
            {num('warningExpiryDays')}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Links & invites" />
          <CardBody className="space-y-4">
            <Switch
              id="am-invites"
              label="Block Discord invites"
              checked={form.flags.blockInvites}
              onChange={(v) => setFlag('blockInvites', v)}
            />
            {tags(
              'allowedInviteCodes',
              'Allowed invite codes',
              'Invites to these codes are never removed (e.g. your own server). Paste a link or a code.',
              normalizeInvite,
              'gynx',
            )}
            <Switch
              id="am-phishing"
              label="Phishing detection"
              description="Flags look-alike domains and common scam patterns."
              checked={form.flags.phishingDetection}
              onChange={(v) => setFlag('phishingDetection', v)}
            />
            {tags(
              'blockedDomains',
              'Blocked domains',
              'Messages linking these domains (and subdomains) are removed.',
              normalizeDomain,
              'example.com',
            )}
            {tags(
              'allowedDomains',
              'Allowed domains',
              'Never treated as phishing or blocked.',
              normalizeDomain,
              'gynx.gg',
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Phrases & exemptions" />
          <CardBody className="space-y-4">
            {tags(
              'blockedPhrases',
              'Blocked phrases',
              '2–100 characters each. Matching ignores case and common obfuscation. Phrases are not written to the audit log.',
              (v) => (v.length >= 2 ? v : null),
              'free nitro',
            )}
            <Field
              id="am-exempt-roles"
              label="Exempt roles"
              help="Members with any of these roles are never checked."
              error={errors.exemptRoleIds}
            >
              {(p) => (
                <IdMultiPicker
                  id={p.id}
                  describedBy={p['aria-describedby']}
                  options={roleOptions(roles)}
                  values={form.lists.exemptRoleIds}
                  onChange={(v) => setList('exemptRoleIds', v)}
                  noun="role"
                  max={AUTOMOD_LISTS.exemptRoleIds}
                />
              )}
            </Field>
            <Field
              id="am-exempt-channels"
              label="Exempt channels"
              help="Messages in these channels are never checked."
              error={errors.exemptChannelIds}
            >
              {(p) => (
                <IdMultiPicker
                  id={p.id}
                  describedBy={p['aria-describedby']}
                  options={channelOptions(channels)}
                  values={form.lists.exemptChannelIds}
                  onChange={(v) => setList('exemptChannelIds', v)}
                  noun="channel"
                  max={AUTOMOD_LISTS.exemptChannelIds}
                />
              )}
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-void/95 px-4 py-3 sm:mx-0 sm:rounded-lg sm:border">
        <p className="mr-auto text-xs text-fg-muted" aria-live="polite">
          {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
        </p>
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || saving}
          onClick={() => {
            setForm(automodToForm(baseline));
            setErrors({});
            setFormError(null);
          }}
        >
          Discard
        </Button>
        <Button type="submit" loading={saving} loadingLabel="Saving…" disabled={!dirty}>
          Save automod settings
        </Button>
      </div>
    </form>
  );
}
