'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ChannelPicker, type ChannelOption } from '@/components/community/pickers';
import { useApiAction } from '@/components/community/useApiAction';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import {
  addOption,
  emptyPollDraft,
  MAX_OPTIONS,
  MIN_OPTIONS,
  moveOption,
  pollDraftToPayload,
  removeOption,
  validatePollDraft,
  type DurationUnit,
  type PollDraft,
} from './poll-form';

export function PollCreateDialog({
  open,
  onClose,
  channels,
}: {
  open: boolean;
  onClose: () => void;
  channels: ChannelOption[] | null;
}) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [draft, setDraft] = useState<PollDraft>(emptyPollDraft);

  useEffect(() => {
    if (open) {
      setDraft(emptyPollDraft());
      setFieldErrors({});
    }
  }, [open, setFieldErrors]);

  const set = <K extends keyof PollDraft>(k: K, v: PollDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setOption = (i: number, v: string) =>
    set(
      'options',
      draft.options.map((o, j) => (j === i ? v : o)),
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = validatePollDraft(draft);
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    const res = await run('/api/engagement/polls', 'POST', pollDraftToPayload(draft), {
      success: 'Poll created',
      successDescription: 'It will be posted in the channel shortly.',
      errorTitle: 'Could not create poll',
    });
    if (res) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New poll"
      size="lg"
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="poll-form" loading={pending} loadingLabel="Creating…">
            Create poll
          </Button>
        </>
      }
    >
      <form id="poll-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field id="poll-question" label="Question" required error={fieldErrors.question}>
          {(p) => (
            <Input
              {...p}
              value={draft.question}
              onChange={(e) => set('question', e.target.value)}
              maxLength={300}
            />
          )}
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">
            Options{' '}
            <span className="font-normal text-fg-muted">
              ({draft.options.length} of {MAX_OPTIONS})
            </span>
          </legend>
          <ol className="space-y-2">
            {draft.options.map((o, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className="mt-2 w-5 shrink-0 text-right text-xs tabular-nums text-fg-muted"
                  aria-hidden="true"
                >
                  {i + 1}.
                </span>
                <Field
                  id={`poll-opt-${i}`}
                  label={<span className="sr-only">Option {i + 1}</span>}
                  error={fieldErrors[`options.${i}`]}
                  className="min-w-0 flex-1"
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={o}
                      onChange={(e) => setOption(i, e.target.value)}
                      maxLength={80}
                      placeholder={`Option ${i + 1}`}
                    />
                  )}
                </Field>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set('options', moveOption(draft.options, i, -1))}
                    disabled={i === 0}
                    aria-label={`Move option ${i + 1} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set('options', moveOption(draft.options, i, 1))}
                    disabled={i === draft.options.length - 1}
                    aria-label={`Move option ${i + 1} down`}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set('options', removeOption(draft.options, i))}
                    disabled={draft.options.length <= MIN_OPTIONS}
                    aria-label={`Remove option ${i + 1}`}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          {fieldErrors.options && (
            <p className="text-xs text-danger" role="alert">
              {fieldErrors.options}
            </p>
          )}
          {draft.options.length < MAX_OPTIONS && (
            <Button size="sm" variant="secondary" onClick={() => set('options', addOption(draft.options))}>
              Add option
            </Button>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="poll-mode" label="Choices" error={fieldErrors.multipleChoice}>
            {(p) => (
              <Select
                {...p}
                value={draft.multipleChoice ? 'multi' : 'single'}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, multipleChoice: e.target.value === 'multi', maxChoices: '' }))
                }
                options={[
                  { value: 'single', label: 'Single choice' },
                  { value: 'multi', label: 'Multiple choice' },
                ]}
              />
            )}
          </Field>
          {draft.multipleChoice && (
            <Field
              id="poll-max"
              label="Max choices"
              help={`Blank = up to all ${draft.options.length} options.`}
              error={fieldErrors.maxChoices}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={draft.options.length}
                  inputMode="numeric"
                  value={draft.maxChoices}
                  onChange={(e) => set('maxChoices', e.target.value)}
                />
              )}
            </Field>
          )}
        </div>

        <Field
          id="poll-duration"
          label="Duration"
          required
          help="1 minute to 14 days."
          error={fieldErrors.durationMs}
        >
          {(p) => (
            <div className="flex gap-2">
              <Input
                {...p}
                className="w-28"
                type="number"
                min={1}
                inputMode="numeric"
                value={draft.durationAmount}
                onChange={(e) => set('durationAmount', e.target.value)}
              />
              <Select
                aria-label="Duration unit"
                className="w-32"
                value={draft.durationUnit}
                onChange={(e) => set('durationUnit', e.target.value as DurationUnit)}
                options={[
                  { value: 'minutes', label: 'minutes' },
                  { value: 'hours', label: 'hours' },
                  { value: 'days', label: 'days' },
                ]}
              />
            </div>
          )}
        </Field>

        <Switch
          id="poll-anon"
          checked={draft.anonymous}
          onChange={(v) => set('anonymous', v)}
          label="Anonymous"
          description="Nobody, including staff, can ever see who voted for what. This cannot be changed later."
        />
        <Switch
          id="poll-live"
          checked={draft.liveResults}
          onChange={(v) => set('liveResults', v)}
          label="Live results"
          description="Show running counts on the poll message. Off: results appear when it closes."
        />

        <Field id="poll-channel" label="Channel" required error={fieldErrors.channelId}>
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
      </form>
    </Dialog>
  );
}
