'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';

/** Restricted moderator note (moderation.audit.view). Empty saves clear the note. */
export function ModeratorNoteEditor({ actionId, initial }: { actionId: string; initial: string | null }) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [note, setNote] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = note.trim() !== (initial ?? '');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/api/moderation/records/${encodeURIComponent(actionId)}/note`, {
        method: 'PUT',
        body: { note: note.trim() || null },
      });
      toast.success(note.trim() ? 'Note saved' : 'Note cleared');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.issues[0] ? err.issues[0].message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Moderator note"
        description="Only visible to staff with moderation audit access. Never sent to the member or the modlog."
      />
      <CardBody>
        <form onSubmit={save} noValidate className="space-y-3">
          <Field
            id="mod-note"
            label="Note"
            error={error}
            help="Secrets are redacted automatically. Max 1000 characters."
          >
            {(p) => (
              <Textarea
                {...p}
                rows={5}
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="secondary"
            className="w-full"
            loading={saving}
            loadingLabel="Saving…"
            disabled={!dirty}
          >
            Save note
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
