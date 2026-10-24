'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  ChannelPicker,
  RoleMultiPicker,
  type ChannelOption,
  type RoleOption,
} from '@/components/community/pickers';
import { useApiAction } from '@/components/community/useApiAction';
import { Alert } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Form';
import {
  emptyGiveawayDraft,
  giveawayDraftToPayload,
  MAX_REQUIRED_ROLES,
  MAX_WINNERS,
  validateGiveawayDraft,
  type GiveawayDraft,
} from './giveaway-form';

export function GiveawayCreateDialog({
  open,
  onClose,
  timezone,
  channels,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  timezone: string;
  channels: ChannelOption[] | null;
  roles: RoleOption[];
}) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [draft, setDraft] = useState<GiveawayDraft>(emptyGiveawayDraft);

  useEffect(() => {
    if (open) {
      setDraft(emptyGiveawayDraft());
      setFieldErrors({});
    }
  }, [open, setFieldErrors]);

  const set = <K extends keyof GiveawayDraft>(k: K, v: GiveawayDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = validateGiveawayDraft(draft);
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    const res = await run('/api/engagement/giveaways', 'POST', giveawayDraftToPayload(draft), {
      success: 'Giveaway started',
      successDescription: 'It will be posted in the channel shortly.',
      errorTitle: 'Could not create giveaway',
    });
    if (res) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New giveaway"
      description="Free community prizes only. No purchase or paid entry."
      size="lg"
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="giveaway-form" loading={pending} loadingLabel="Starting…">
            Start giveaway
          </Button>
        </>
      }
    >
      <form id="giveaway-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field id="gw-prize" label="Prize" required error={fieldErrors.prize}>
          {(p) => (
            <Input
              {...p}
              value={draft.prize}
              onChange={(e) => set('prize', e.target.value)}
              maxLength={200}
            />
          )}
        </Field>
        <Field
          id="gw-desc"
          label="Description"
          help="Optional. Up to 1000 characters."
          error={fieldErrors.description}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={1000}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="gw-winners"
            label="Winners"
            required
            help={`1 to ${MAX_WINNERS}.`}
            error={fieldErrors.winnerCount}
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={MAX_WINNERS}
                inputMode="numeric"
                value={draft.winnerCount}
                onChange={(e) => set('winnerCount', e.target.value)}
              />
            )}
          </Field>
          <Field
            id="gw-ends"
            label="Ends"
            required
            help={`${timezone}. 1 minute to 30 days from now.`}
            error={fieldErrors.endsAt ?? fieldErrors.durationMs}
          >
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={draft.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
              />
            )}
          </Field>
        </div>

        <fieldset className="space-y-3 rounded border border-border p-3">
          <legend className="px-1 text-sm font-medium text-fg">Eligibility</legend>
          <Field
            id="gw-roles"
            label="Required roles"
            help={`Members need at least one of these (max ${MAX_REQUIRED_ROLES}). Leave empty for everyone.`}
            error={fieldErrors.requiredRoleIds}
          >
            {(p) => (
              <RoleMultiPicker
                control={p}
                value={draft.requiredRoleIds}
                onChange={(ids) => set('requiredRoleIds', ids)}
                roles={roles}
                max={MAX_REQUIRED_ROLES}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="gw-acct" label="Min account age (days)" error={fieldErrors.minAccountAgeDays}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={3650}
                  inputMode="numeric"
                  value={draft.minAccountAgeDays}
                  onChange={(e) => set('minAccountAgeDays', e.target.value)}
                />
              )}
            </Field>
            <Field id="gw-member" label="Min days in server" error={fieldErrors.minMemberDays}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={3650}
                  inputMode="numeric"
                  value={draft.minMemberDays}
                  onChange={(e) => set('minMemberDays', e.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <Field id="gw-channel" label="Channel" required error={fieldErrors.channelId}>
          {(p) => (
            <ChannelPicker
              control={p}
              value={draft.channelId}
              onChange={(id) => set('channelId', id)}
              channels={channels}
              allowEmpty={false}
            />
          )}
        </Field>
        <Alert tone="info">
          Winners are drawn with a cryptographically secure shuffle; every draw is recorded with a hash of the
          entrant pool for auditing.
        </Alert>
      </form>
    </Dialog>
  );
}
