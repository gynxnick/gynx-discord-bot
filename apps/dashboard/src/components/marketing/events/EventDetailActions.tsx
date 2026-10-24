'use client';

import { useState, type FormEvent } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Textarea } from '@/components/ui/Form';
import { CancelEventDialog } from './CancelEventDialog';
import { EventFormDialog } from './EventFormDialog';
import type { EventDraft } from './event-form';

/** Header actions for a scheduled event: edit + cancel. */
export function EventDetailActions({
  event,
  draft,
  timezone,
}: {
  event: { id: string; title: string };
  draft: EventDraft;
  timezone: string;
}) {
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button variant="danger" onClick={() => setCancelling(true)}>
        Cancel event
      </Button>
      <EventFormDialog
        open={editing}
        onClose={() => setEditing(false)}
        eventId={event.id}
        initial={draft}
        timezone={timezone}
      />
      <CancelEventDialog event={cancelling ? event : null} onClose={() => setCancelling(false)} />
    </>
  );
}

/** Post-event summary (min 10 chars). Posting marks the event COMPLETED and updates its message. */
export function EventSummaryForm({ eventId, existing }: { eventId: string; existing: string | null }) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [summary, setSummary] = useState(existing ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = summary.trim();
    if (t.length < 10) {
      setFieldErrors({ summary: 'At least 10 characters.' });
      return;
    }
    await run(
      `/api/engagement/events/${encodeURIComponent(eventId)}/summary`,
      'POST',
      { summary: t },
      {
        success: existing ? 'Summary updated' : 'Summary posted',
        successDescription: 'The event is now marked completed.',
        errorTitle: 'Could not post summary',
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title="Summary"
        description="Share how it went. Posting marks the event completed and updates its Discord message."
      />
      <form onSubmit={submit} className="space-y-3 p-4" noValidate>
        <Field
          id="ev-summary"
          label="Summary"
          required
          help="10 to 2000 characters. Discord markdown is supported."
          error={fieldErrors.summary}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={5}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={2000}
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={pending} loadingLabel="Posting…">
            {existing ? 'Update summary' : 'Post summary'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
