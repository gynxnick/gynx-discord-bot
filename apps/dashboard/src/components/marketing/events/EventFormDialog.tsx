'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ChannelPicker, type ChannelOption } from '@/components/community/pickers';
import { useApiAction } from '@/components/community/useApiAction';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import {
  addReminder,
  customReminderMinutes,
  emptyEventDraft,
  eventDraftToPayload,
  formatMinutes,
  MAX_REMINDERS,
  REMINDER_PRESETS,
  validateEventDraft,
  type EventDraft,
} from './event-form';

export interface EventFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing an existing (scheduled) event. */
  eventId?: string;
  initial?: EventDraft;
  /** Time zone the date inputs are interpreted in. */
  timezone: string;
  channels?: ChannelOption[] | null;
}

/** Create / edit an event. Times are entered in `timezone` and converted on the server. */
export function EventFormDialog({
  open,
  onClose,
  eventId,
  initial,
  timezone,
  channels,
}: EventFormDialogProps) {
  const mode = eventId ? 'edit' : 'create';
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [draft, setDraft] = useState<EventDraft>(initial ?? emptyEventDraft());
  const [customAmount, setCustomAmount] = useState('');
  const [customUnit, setCustomUnit] = useState<'minutes' | 'hours' | 'days'>('minutes');
  const [reminderError, setReminderError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial ?? emptyEventDraft());
      setFieldErrors({});
      setReminderError(null);
      setCustomAmount('');
    }
    // Reset only when the dialog opens (not when the parent re-renders `initial`).
  }, [open]);

  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const tryAdd = (minutes: number) => {
    const r = addReminder(draft.reminders, minutes);
    setReminderError(r.error ?? null);
    if (!r.error) {
      set('reminders', r.list);
      setCustomAmount('');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = validateEventDraft(draft);
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    const body = eventDraftToPayload(draft, mode);
    const res =
      mode === 'create'
        ? await run('/api/engagement/events', 'POST', body, {
            success: 'Event created',
            successDescription: 'The announcement will be posted shortly.',
            errorTitle: 'Could not create event',
          })
        : await run(`/api/engagement/events/${encodeURIComponent(eventId!)}`, 'PATCH', body, {
            success: 'Event updated',
            errorTitle: 'Could not update event',
          });
    if (res) onClose();
  };

  const err = (k: string) =>
    fieldErrors[k] ??
    (k === 'start' ? fieldErrors.startsAt : k === 'end' ? fieldErrors.durationMinutes : undefined);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'New event' : 'Edit event'}
      description={`Times are in ${timezone}.`}
      size="lg"
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="event-form" loading={pending} loadingLabel="Saving…">
            {mode === 'create' ? 'Create event' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field id="ev-title" label="Title" required error={err('title')}>
          {(p) => (
            <Input
              {...p}
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={100}
            />
          )}
        </Field>
        <Field
          id="ev-desc"
          label="Description"
          required
          help="Discord markdown is supported. Up to 2000 characters."
          error={err('description')}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={5}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={2000}
            />
          )}
        </Field>
        <Field
          id="ev-location"
          label="Location"
          help="Optional, e.g. a voice channel name or game server."
          error={err('location')}
        >
          {(p) => (
            <Input
              {...p}
              value={draft.location}
              onChange={(e) => set('location', e.target.value)}
              maxLength={100}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ev-start" label="Starts" required help={timezone} error={err('start')}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={draft.start}
                onChange={(e) => set('start', e.target.value)}
              />
            )}
          </Field>
          <Field
            id="ev-end"
            label="Ends"
            help="Optional. 5 minutes to 7 days after the start."
            error={err('end')}
          >
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={draft.end}
                min={draft.start || undefined}
                onChange={(e) => set('end', e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ev-capacity" label="Capacity" help="Leave blank for unlimited." error={err('capacity')}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={10000}
                inputMode="numeric"
                value={draft.capacity}
                onChange={(e) => set('capacity', e.target.value)}
                placeholder="Unlimited"
              />
            )}
          </Field>
          <div className="sm:pt-6">
            <Switch
              id="ev-waitlist"
              checked={draft.waitlistEnabled}
              onChange={(v) => set('waitlistEnabled', v)}
              label="Waitlist"
              description="When full, extra RSVPs join a waitlist and are promoted in order."
            />
          </div>
        </div>

        <fieldset className="space-y-2" aria-describedby="ev-rem-help">
          <legend className="text-sm font-medium text-fg">Reminders</legend>
          <p id="ev-rem-help" className="text-xs text-fg-muted">
            DMs to members who are going, sent this long before the start. Up to {MAX_REMINDERS}, all
            different.
          </p>
          {draft.reminders.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Selected reminders">
              {draft.reminders.map((m) => (
                <li
                  key={m}
                  className="inline-flex items-center gap-1 rounded border border-border-strong bg-surface-raised px-2 py-0.5 text-xs"
                >
                  {formatMinutes(m)} before
                  <button
                    type="button"
                    className="ml-1 rounded px-1 text-fg-muted hover:text-fg"
                    onClick={() =>
                      set(
                        'reminders',
                        draft.reminders.filter((x) => x !== m),
                      )
                    }
                    aria-label={`Remove reminder ${formatMinutes(m)} before`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-muted">No reminders.</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {REMINDER_PRESETS.map((p) => (
              <Button
                key={p.minutes}
                size="sm"
                variant="secondary"
                onClick={() => tryAdd(p.minutes)}
                disabled={draft.reminders.includes(p.minutes) || draft.reminders.length >= MAX_REMINDERS}
              >
                + {p.label}
              </Button>
            ))}
            <div className="flex items-end gap-1">
              <div className="w-20">
                <label htmlFor="ev-rem-amount" className="mb-1 block text-xs text-fg-muted">
                  Custom
                </label>
                <Input
                  id="ev-rem-amount"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </div>
              <Select
                aria-label="Custom reminder unit"
                className="w-28"
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value as typeof customUnit)}
                options={[
                  { value: 'minutes', label: 'minutes' },
                  { value: 'hours', label: 'hours' },
                  { value: 'days', label: 'days' },
                ]}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => tryAdd(customReminderMinutes(customAmount, customUnit))}
                disabled={!customAmount.trim() || draft.reminders.length >= MAX_REMINDERS}
              >
                Add
              </Button>
            </div>
          </div>
          {(reminderError ?? fieldErrors.reminderMinutesBefore) && (
            <p className="text-xs text-danger" role="alert">
              {reminderError ?? fieldErrors.reminderMinutesBefore}
            </p>
          )}
        </fieldset>

        {mode === 'create' && (
          <Field
            id="ev-channel"
            label="Channel"
            help="Leave empty to use the configured event channel."
            error={err('channelId')}
          >
            {(p) => (
              <ChannelPicker
                control={p}
                value={draft.channelId}
                onChange={(id) => set('channelId', id)}
                channels={channels}
                placeholder="Configured event channel"
              />
            )}
          </Field>
        )}
      </form>
    </Dialog>
  );
}
