'use client';

import { useState, type FormEvent } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { campaignPatch, campaignProblems, canAnnounceLocked, type CampaignDraft } from './partner-utils';

export function CampaignEditForm({
  campaignId,
  initial,
  canSettings,
  timezone,
}: {
  campaignId: string;
  initial: CampaignDraft;
  canSettings: boolean;
  timezone: string;
}) {
  const { run, pending, fieldErrors, setFieldErrors, error } = useApiAction();
  const [draft, setDraft] = useState<CampaignDraft>(initial);
  const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const patch = campaignPatch(initial, draft);
  const dirty = Object.keys(patch).length > 0;
  const announceLocked = canAnnounceLocked(canSettings, initial.canAnnounce);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problems = campaignProblems(draft);
    if (Object.keys(problems).length) {
      setFieldErrors(problems);
      return;
    }
    if (!dirty) return;
    await run(`/api/marketing/partners/campaigns/${encodeURIComponent(campaignId)}`, 'PATCH', patch, {
      success: 'Campaign saved',
      errorTitle: 'Could not save campaign',
    });
  };

  return (
    <Card>
      <CardHeader title="Campaign settings" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate aria-label="Edit campaign">
          <Field id="campaign-name" label="Name" required error={fieldErrors.name}>
            {(p) => (
              <Input {...p} value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
            )}
          </Field>
          <Field
            id="campaign-ends"
            label="End date"
            help={`Guild time (${timezone}). Leave empty for no end date.`}
            error={fieldErrors.endsAt}
          >
            {(p) => (
              <div className="flex gap-2">
                <Input
                  {...p}
                  type="datetime-local"
                  value={draft.endsAt}
                  onChange={(e) => set('endsAt', e.target.value)}
                />
                {draft.endsAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => set('endsAt', '')}
                    aria-label="Clear end date"
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}
          </Field>
          <Switch
            id="campaign-active"
            checked={draft.active}
            onChange={(v) => set('active', v)}
            label="Active"
            description="Inactive campaigns can’t get new partner invites."
          />
          <Switch
            id="campaign-announce"
            checked={draft.canAnnounce}
            onChange={(v) => set('canAnnounce', v)}
            disabled={announceLocked && !draft.canAnnounce}
            label="Partner may announce"
            description={
              announceLocked
                ? 'Letting a partner post announcements is a settings-level decision: enabling this requires the settings.manage permission.'
                : canSettings
                  ? 'Lets the partner post announcements for this campaign.'
                  : 'You can turn this off. Turning it back on later requires settings.manage.'
            }
          />
          {error && !Object.keys(fieldErrors).length && (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(initial)} disabled={pending}>
                Reset
              </Button>
            )}
            <Button type="submit" loading={pending} loadingLabel="Saving…" disabled={!dirty || pending}>
              Save changes
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
