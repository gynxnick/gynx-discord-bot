'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';

type NextStatus = 'TRIAGED' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED';
const LABELS: Record<NextStatus, string> = {
  TRIAGED: 'Triaged',
  INVESTIGATING: 'Investigating',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

export function ReportActions({
  reportId,
  status,
  assignedToMe,
  closed,
  nextStatuses,
}: {
  reportId: string;
  status: string;
  assignedToMe: boolean;
  closed: boolean;
  nextStatuses: NextStatus[];
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const base = `/api/security/reports/${encodeURIComponent(reportId)}`;

  const [claiming, setClaiming] = useState(false);
  const [next, setNext] = useState<NextStatus | ''>('');
  const [resolution, setResolution] = useState('');
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const [savingStatus, setSavingStatus] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const closing = next === 'RESOLVED' || next === 'DISMISSED';

  const claim = async () => {
    setClaiming(true);
    try {
      await api(`${base}/claim`, { method: 'POST' });
      toast.success('Report claimed', 'You are now the assignee.');
      router.refresh();
    } catch (e) {
      toast.error('Could not claim report', (e as Error).message);
    } finally {
      setClaiming(false);
    }
  };

  const changeStatus = async (e: FormEvent) => {
    e.preventDefault();
    if (!next) {
      setStatusErrors({ status: 'Choose a new status.' });
      return;
    }
    if (closing && resolution.trim().length === 0) {
      setStatusErrors({ resolution: 'A resolution summary is required to close a report.' });
      return;
    }
    setSavingStatus(true);
    setStatusErrors({});
    try {
      await api(`${base}/status`, {
        method: 'POST',
        body: { status: next, resolution: resolution.trim() || undefined },
      });
      toast.success('Status updated', `Report moved to ${LABELS[next].toLowerCase()}.`);
      setNext('');
      setResolution('');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setStatusErrors(err.fieldErrors());
      toast.error('Could not update status', (err as Error).message);
    } finally {
      setSavingStatus(false);
    }
  };

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) {
      setNoteError('Write a note first.');
      return;
    }
    setSavingNote(true);
    setNoteError(null);
    try {
      await api(`${base}/notes`, { method: 'POST', body: { content: note.trim() } });
      setNote('');
      toast.success('Note added');
      router.refresh();
    } catch (err) {
      setNoteError(err instanceof ApiError && err.issues[0] ? err.issues[0].message : null);
      toast.error('Could not add note', (err as Error).message);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader title="Triage" />
        <CardBody className="space-y-4">
          {closed ? (
            <p className="text-sm text-fg-muted">
              This report is closed ({status.toLowerCase()}). Closed reports cannot be reopened.
            </p>
          ) : (
            <>
              {!assignedToMe && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={claim}
                  loading={claiming}
                  loadingLabel="Claiming…"
                >
                  Claim report
                </Button>
              )}
              {nextStatuses.length > 0 && (
                <form onSubmit={changeStatus} className="space-y-3" noValidate>
                  <Field id="report-status" label="Change status" error={statusErrors.status}>
                    {(p) => (
                      <Select
                        {...p}
                        value={next}
                        onChange={(e) => setNext(e.target.value as NextStatus | '')}
                        placeholder="Select…"
                        options={nextStatuses.map((s) => ({ value: s, label: LABELS[s] }))}
                      />
                    )}
                  </Field>
                  {closing && (
                    <Field
                      id="report-resolution"
                      label="Resolution summary"
                      required
                      help="Summarise the outcome. If the reporter opted in, they receive a short closure notice (not this text)."
                      error={statusErrors.resolution}
                    >
                      {(p) => (
                        <Textarea
                          {...p}
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                          maxLength={2000}
                          rows={4}
                        />
                      )}
                    </Field>
                  )}
                  <Button
                    type="submit"
                    className="w-full"
                    loading={savingStatus}
                    loadingLabel="Saving…"
                    variant={closing ? 'danger' : 'primary'}
                  >
                    {closing ? `Close as ${LABELS[next as NextStatus].toLowerCase()}` : 'Update status'}
                  </Button>
                </form>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Add a note" description="Internal only. Secrets are redacted automatically." />
        <CardBody>
          <form onSubmit={addNote} className="space-y-3" noValidate>
            <Field id="report-note" label="Note" error={noteError}>
              {(p) => (
                <Textarea
                  {...p}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  rows={4}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="secondary"
              className="w-full"
              loading={savingNote}
              loadingLabel="Saving…"
            >
              Add note
            </Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
