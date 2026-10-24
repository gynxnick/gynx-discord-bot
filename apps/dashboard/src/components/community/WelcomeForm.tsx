'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { EmbedPreview } from './EmbedPreview';
import { fillWelcomePlaceholders, unknownPlaceholders } from './embed-markdown';
import { welcomeToPayload, type WelcomeDraft } from './welcome-payload';
import { ChannelPicker, RolePicker, type ChannelOption, type RoleOption } from './pickers';
import { useApiAction } from './useApiAction';

export function WelcomeForm({
  initial,
  channels,
  roles,
  serverName,
}: {
  initial: WelcomeDraft;
  channels: ChannelOption[] | null;
  roles: RoleOption[];
  serverName: string;
}) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [d, setD] = useState<WelcomeDraft>(initial);
  const [saved, setSaved] = useState<WelcomeDraft>(initial);
  const set = <K extends keyof WelcomeDraft>(k: K, v: WelcomeDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const badPlaceholders = useMemo(() => unknownPlaceholders(d.message), [d.message]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (badPlaceholders.length)
      local.message = `Unknown placeholder(s): ${badPlaceholders.map((p) => `{${p}}`).join(', ')}. Use {user} and {server}.`;
    if (d.verificationEnabled && !d.verifiedRoleId)
      local.verifiedRoleId = 'Choose a verified role before enabling verification.';
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    const res = await run('/api/community/welcome', 'PUT', welcomeToPayload(d), {
      success: 'Welcome settings saved',
      errorTitle: 'Could not save welcome settings',
    });
    if (res) setSaved(d);
  };

  const previewMessage = fillWelcomePlaceholders(d.message, { user: '@NewMember', server: serverName });
  const steps = [
    d.requireRulesAck || d.verificationEnabled ? '• Read the rules with `/rules`' : null,
    d.verificationEnabled ? '• Press **Verify** below to unlock the server' : null,
    '• Pick your games and notifications with `/roles`',
    '• Find quick answers with `/faq`',
  ].filter(Boolean);

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <Card>
          <CardHeader
            title="Welcome message"
            description="Posted in the welcome channel when a member joins."
          />
          <CardBody className="space-y-4">
            <Switch
              id="w-enabled"
              checked={d.enabled}
              onChange={(v) => set('enabled', v)}
              label="Welcome messages enabled"
            />
            <Field
              id="w-channel"
              label="Welcome channel"
              help="Leave empty to skip the channel post (DMs can still be sent)."
              error={fieldErrors.channelId}
            >
              {(p) => (
                <ChannelPicker
                  control={p}
                  value={d.channelId}
                  onChange={(v) => set('channelId', v)}
                  channels={channels}
                  placeholder="No channel"
                />
              )}
            </Field>
            <Field id="w-title" label="Title" required error={fieldErrors.title}>
              {(p) => (
                <Input
                  {...p}
                  value={d.title}
                  onChange={(e) => set('title', e.target.value)}
                  maxLength={256}
                />
              )}
            </Field>
            <Field
              id="w-message"
              label="Message"
              required
              help={
                <>
                  Placeholders: <code className="font-mono">{'{user}'}</code> mentions the new member,{' '}
                  <code className="font-mono">{'{server}'}</code> is the server name. @everyone/@here in the
                  text never ping.
                </>
              }
              error={
                fieldErrors.message ??
                (badPlaceholders.length
                  ? `Unknown placeholder(s): ${badPlaceholders.map((p) => `{${p}}`).join(', ')}`
                  : null)
              }
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={5}
                  value={d.message}
                  onChange={(e) => set('message', e.target.value)}
                  maxLength={2000}
                />
              )}
            </Field>
            <Switch
              id="w-dm"
              checked={d.dmOnJoin}
              onChange={(v) => set('dmOnJoin', v)}
              label="Also DM new members"
              description="Members with closed DMs are skipped silently."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="w-docs" label="Docs URL" help="https:// only" error={fieldErrors.docsUrl}>
                {(p) => (
                  <Input
                    {...p}
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={d.docsUrl}
                    onChange={(e) => set('docsUrl', e.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>
              <Field
                id="w-support"
                label="Support URL"
                help="Overrides the server-wide support link here."
                error={fieldErrors.supportUrl}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={d.supportUrl}
                    onChange={(e) => set('supportUrl', e.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Rules & verification" />
          <CardBody className="space-y-4">
            <Field
              id="w-rules"
              label="Rules"
              required
              help="Shown by /rules and during onboarding."
              error={fieldErrors.rulesText}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={6}
                  value={d.rulesText}
                  onChange={(e) => set('rulesText', e.target.value)}
                  maxLength={4000}
                />
              )}
            </Field>
            <Switch
              id="w-ack"
              checked={d.requireRulesAck}
              onChange={(v) => set('requireRulesAck', v)}
              label="Require members to accept the rules"
            />
            <Switch
              id="w-verify"
              checked={d.verificationEnabled}
              onChange={(v) => set('verificationEnabled', v)}
              label="Verification button"
              description="Members press Verify to receive the verified role."
            />
            <Field
              id="w-role"
              label="Verified role"
              required={d.verificationEnabled}
              help="Checked live against Discord when changed: it must be below the bot's highest role, not managed, and carry no privileged permissions."
              error={fieldErrors.verifiedRoleId}
            >
              {(p) => (
                <RolePicker
                  control={p}
                  value={d.verifiedRoleId}
                  onChange={(v) => set('verifiedRoleId', v)}
                  roles={roles}
                  placeholder="No verified role"
                  hideManaged
                />
              )}
            </Field>
            <Field
              id="w-age"
              label="Minimum account age (days)"
              help="Younger accounts must verify. 0 disables the check."
              error={fieldErrors.minAccountAgeDays}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={365}
                  value={d.minAccountAgeDays}
                  onChange={(e) => set('minAccountAgeDays', e.target.value)}
                />
              )}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Raid protection"
            description="Never kicks or bans: a detected raid flags the joiners and alerts staff once per window."
          />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field
              id="w-threshold"
              label="Join threshold"
              help="3–1000 joins"
              error={fieldErrors.raidJoinThreshold}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={3}
                  max={1000}
                  value={d.raidJoinThreshold}
                  onChange={(e) => set('raidJoinThreshold', e.target.value)}
                />
              )}
            </Field>
            <Field
              id="w-window"
              label="Window (seconds)"
              help="10–3600"
              error={fieldErrors.raidWindowSeconds}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={10}
                  max={3600}
                  value={d.raidWindowSeconds}
                  onChange={(e) => set('raidWindowSeconds', e.target.value)}
                />
              )}
            </Field>
            <Field id="w-action" label="Action" error={fieldErrors.raidAction}>
              {(p) => (
                <Select
                  {...p}
                  value={d.raidAction}
                  onChange={(e) => set('raidAction', e.target.value as WelcomeDraft['raidAction'])}
                  options={[
                    { value: 'ALERT', label: 'Alert staff only' },
                    { value: 'REQUIRE_VERIFICATION', label: 'Alert + require verification' },
                  ]}
                />
              )}
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4 xl:col-span-2">
        <div className="xl:sticky xl:top-4 space-y-4">
          <Card>
            <CardHeader title="Preview" description="Approximation of the welcome post in Discord." />
            <CardBody>
              {d.enabled ? (
                <EmbedPreview
                  title={d.title}
                  description={`${previewMessage}\n\n${steps.join('\n')}`}
                  fields={[
                    ...(d.docsUrl ? [{ name: 'Docs', value: d.docsUrl, inline: true }] : []),
                    ...(d.supportUrl ? [{ name: 'Support', value: d.supportUrl, inline: true }] : []),
                  ]}
                  label="Welcome message preview"
                />
              ) : (
                <p className="text-sm text-fg-muted">Welcome messages are disabled.</p>
              )}
            </CardBody>
          </Card>
          {dirty && (
            <Alert tone="info" title="Unsaved changes">
              Save to apply these settings.
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" loading={pending} loadingLabel="Saving…" disabled={!dirty}>
              Save settings
            </Button>
            <Button variant="secondary" onClick={() => setD(saved)} disabled={!dirty || pending}>
              Discard
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
