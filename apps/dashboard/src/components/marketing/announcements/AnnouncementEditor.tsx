'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { EmbedPreview } from '@/components/community/EmbedPreview';
import {
  ChannelPicker,
  RolePicker,
  type ChannelOption,
  type RoleOption,
} from '@/components/community/pickers';
import { channelName } from '@/components/community/picker-utils';
import { useApiAction } from '@/components/community/useApiAction';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Alert } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  draftToPayload,
  humanizeMentions,
  isCancellable,
  isDeletable,
  isDirty,
  isEditable,
  isQueueable,
  mentionContent,
  MENTION_OPTIONS,
  previewColor,
  STATUS_LABELS,
  STATUS_TONES,
  validateDraft,
  type AnnouncementDraft,
  type AnnouncementStatus,
  type MentionMode,
} from './announcement-utils';

export interface TemplateOption {
  id: string;
  name: string;
  type: string;
  title: string;
  body: string;
}

export interface EditorAnnouncement {
  id: string;
  status: AnnouncementStatus;
  version: number;
  draft: AnnouncementDraft;
  /** Scheduled time as a datetime-local value in the guild time zone ('' when none). */
  scheduledForInput: string;
  scheduledForLabel: string | null;
  publishedAtLabel: string | null;
}

export interface AnnouncementEditorProps {
  announcement: EditorAnnouncement | null;
  initialDraft: AnnouncementDraft;
  timezone: string;
  /** Null → the channel picker loads channels itself (or falls back to an ID input). */
  channels: ChannelOption[] | null;
  roles: RoleOption[];
  templates: TemplateOption[];
  typeOptions: Array<{ value: string; label: string }>;
  /** Default embed colour per type (#RRGGBB) — matches what the bot posts. */
  typeColors: Record<string, string>;
  footer: string;
  /** Earliest sensible schedule value (datetime-local, guild time zone). */
  minScheduleInput: string;
}

interface Preview {
  id: string;
  version: number;
  status: AnnouncementStatus;
  channelId: string;
  warning: string | null;
  requiresMentionConfirmation: boolean;
  canMassMention: boolean;
}

interface Saved {
  id: string;
  version: number;
}

type QueueKind = 'publish' | 'schedule';

const MASS_MENTION_REQUIRED =
  'Pinging @everyone, @here or a role needs the mass-mention permission (announcements.mass_mention). Ask an administrator, or change the mention to "No mention".';

/**
 * Announcement editor with a live Discord-like preview. Publishing is a
 * two-step flow: save pending edits → fetch the server preview (version +
 * mention warning) → explicit confirmation → publish/schedule with
 * `expectedVersion`, so an edit made in between is never sent unseen.
 */
export function AnnouncementEditor(props: AnnouncementEditorProps) {
  const {
    announcement,
    timezone,
    channels,
    roles,
    templates,
    typeOptions,
    typeColors,
    footer,
    minScheduleInput,
  } = props;
  const router = useRouter();
  const toast = useToast();
  const { api, can } = useSession();
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();

  const [draft, setDraft] = useState<AnnouncementDraft>(props.initialDraft);
  const [saved, setSaved] = useState<AnnouncementDraft | null>(announcement ? announcement.draft : null);
  const [current, setCurrent] = useState<Saved | null>(
    announcement ? { id: announcement.id, version: announcement.version } : null,
  );
  const [when, setWhen] = useState(announcement?.scheduledForInput ?? '');
  const [templateId, setTemplateId] = useState('');
  const [preparing, setPreparing] = useState<QueueKind | null>(null);
  const [confirm, setConfirm] = useState<{ kind: QueueKind; preview: Preview; id: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status: AnnouncementStatus = announcement?.status ?? 'DRAFT';
  const canPublish = can('announcements.publish');
  const canCreate = can('announcements.create');
  const canMassMention = can('announcements.mass_mention');
  // Editing a scheduled announcement re-queues it, which the service only allows with publish rights.
  const scheduledLocked = status === 'SCHEDULED' && !canPublish;
  const editable = canCreate && isEditable(status) && !scheduledLocked;
  const dirty = editable && isDirty(draft, saved);
  const busy = pending || preparing !== null;

  const roleNameById = useMemo(() => {
    const map = new Map(roles.map((r) => [r.id, r.name]));
    return (id: string) => map.get(id);
  }, [roles]);

  const set = <K extends keyof AnnouncementDraft>(k: K, v: AnnouncementDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setDraft((d) => ({ ...d, type: t.type, title: t.title, body: t.body }));
  };

  const checkLocal = (): boolean => {
    const errs = validateDraft(draft);
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      toast.error('Check the highlighted fields');
      return false;
    }
    return true;
  };

  /** Save pending edits (create when new). Returns the saved id + version, or null on failure. */
  const persist = async (successToast: boolean): Promise<Saved | null> => {
    if (!checkLocal()) return null;
    const payload = draftToPayload(draft);
    if (!current) {
      const res = await run<{ id: string; version: number }>(
        '/api/marketing/announcements',
        'POST',
        payload,
        {
          success: successToast ? 'Draft saved' : undefined,
          errorTitle: 'Could not save the announcement',
          refresh: false,
        },
      );
      if (!res) return null;
      const s = { id: res.id, version: res.version };
      setCurrent(s);
      setSaved(draft);
      return s;
    }
    if (!dirty) return current;
    const res = await run<{ id: string; version: number }>(
      `/api/marketing/announcements/${encodeURIComponent(current.id)}`,
      'PATCH',
      { ...payload, expectedVersion: current.version },
      {
        success: successToast ? 'Changes saved' : undefined,
        errorTitle: 'Could not save the announcement',
        refresh: false,
      },
    );
    if (!res) return null;
    const s = { id: res.id, version: res.version };
    setCurrent(s);
    setSaved(draft);
    return s;
  };

  /** After a successful action: go to the announcement's page (new) or reload server data. */
  const finish = (id: string) => {
    if (!announcement) router.push(`/marketing/announcements/${encodeURIComponent(id)}`);
    else router.refresh();
  };

  const saveDraft = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!editable) return;
    const s = await persist(true);
    if (s) finish(s.id);
  };

  const startQueue = async (kind: QueueKind) => {
    if (kind === 'schedule' && !when) {
      setFieldErrors({ when: 'Pick a date and time.' });
      return;
    }
    setPreparing(kind);
    try {
      const s = editable ? await persist(false) : current;
      if (!s) return;
      let preview: Preview;
      try {
        preview = await api<Preview>(`/api/marketing/announcements/${encodeURIComponent(s.id)}/preview`);
      } catch (err) {
        toast.error('Could not prepare the preview', (err as Error).message);
        return;
      }
      if (preview.requiresMentionConfirmation && !preview.canMassMention) {
        toast.error('Mass-mention permission required', MASS_MENTION_REQUIRED);
        return;
      }
      setConfirm({ kind, preview, id: s.id });
    } finally {
      setPreparing(null);
    }
  };

  const confirmQueue = async () => {
    if (!confirm) return;
    const { kind, preview, id } = confirm;
    const base = {
      expectedVersion: preview.version,
      ...(preview.requiresMentionConfirmation ? { confirmMentions: true } : {}),
    };
    const path = `/api/marketing/announcements/${encodeURIComponent(id)}/${kind}`;
    const res =
      kind === 'publish'
        ? await run(path, 'POST', base, {
            success: 'Announcement queued',
            successDescription: 'The bot posts it within a few seconds.',
            errorTitle: 'Could not publish',
            refresh: false,
          })
        : await run(
            path,
            'POST',
            { ...base, when: when.replace('T', ' '), timezone },
            { success: 'Announcement scheduled', errorTitle: 'Could not schedule', refresh: false },
          );
    setConfirm(null);
    if (res) finish(id);
  };

  const cancel = async () => {
    if (!current) return;
    const res = await run(
      `/api/marketing/announcements/${encodeURIComponent(current.id)}/cancel`,
      'POST',
      undefined,
      {
        success: 'Schedule cancelled',
        successDescription: 'It is kept as a cancelled announcement; you can publish or schedule it again.',
        errorTitle: 'Could not cancel',
      },
    );
    if (res) setConfirmCancel(false);
  };

  const remove = async () => {
    if (!current) return;
    const res = await run(
      `/api/marketing/announcements/${encodeURIComponent(current.id)}`,
      'DELETE',
      undefined,
      {
        success: 'Announcement deleted',
        errorTitle: 'Could not delete',
        refresh: false,
      },
    );
    if (res) {
      setConfirmDelete(false);
      router.push('/marketing/announcements');
      router.refresh();
    }
  };

  const confirmTarget = confirm ? channelName(channels, confirm.preview.channelId) : '';
  const confirmWarning = confirm?.preview.warning
    ? humanizeMentions(confirm.preview.warning, roleNameById)
    : null;
  const scheduleLabel = when ? `${when.replace('T', ' ')} (${timezone})` : '';
  const pingsWithoutPermission = draft.mention !== 'NONE' && !canMassMention;

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        {announcement && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
            <Badge tone={STATUS_TONES[status]} dot>
              {STATUS_LABELS[status]}
            </Badge>
            {announcement.scheduledForLabel && status === 'SCHEDULED' && (
              <span>Scheduled for {announcement.scheduledForLabel}</span>
            )}
            {announcement.publishedAtLabel && <span>Published {announcement.publishedAtLabel}</span>}
            <span>Version {current?.version ?? announcement.version}</span>
            {dirty && <Badge tone="warning">Unsaved changes</Badge>}
          </div>
        )}

        {!isEditable(status) && (
          <Alert tone="info" title="Read-only">
            {status === 'PUBLISHING'
              ? 'This announcement is being posted right now and can no longer be changed.'
              : 'Published announcements can no longer be edited.'}
          </Alert>
        )}
        {scheduledLocked && (
          <Alert tone="info" title="Scheduled">
            Changing a scheduled announcement re-queues it, which needs the publish permission.
          </Alert>
        )}
        {!canCreate && isEditable(status) && !scheduledLocked && (
          <Alert tone="info">
            You can publish or schedule this announcement, but editing it needs the create permission.
          </Alert>
        )}

        <Card>
          <CardHeader
            title="Content"
            description="Mentions inside the text never ping anyone; only the mention setting below does."
          />
          <form id="announcement-form" onSubmit={saveDraft} className="space-y-4 p-4" noValidate>
            <fieldset disabled={!editable || busy} className="space-y-4">
              <legend className="sr-only">Announcement content</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {templates.length > 0 && editable && (
                  <Field
                    id="ann-template"
                    label="Start from a template"
                    help="Replaces the type, title and text."
                  >
                    {(p) => (
                      <Select
                        {...p}
                        value={templateId}
                        onChange={(e) => applyTemplate(e.target.value)}
                        placeholder="Choose a template…"
                        options={templates.map((t) => ({ value: t.id, label: t.name }))}
                      />
                    )}
                  </Field>
                )}
                <Field id="ann-type" label="Type" error={fieldErrors.type}>
                  {(p) => (
                    <Select
                      {...p}
                      value={draft.type}
                      onChange={(e) => set('type', e.target.value)}
                      options={typeOptions}
                    />
                  )}
                </Field>
              </div>
              <Field id="ann-title" label="Title" required error={fieldErrors.title}>
                {(p) => (
                  <Input
                    {...p}
                    value={draft.title}
                    onChange={(e) => set('title', e.target.value)}
                    maxLength={256}
                  />
                )}
              </Field>
              <Field
                id="ann-body"
                label="Text"
                required
                help={`${draft.body.trim().length.toLocaleString('en-US')} / 4,000 characters. Supports **bold**, *italic* and \`code\`.`}
                error={fieldErrors.body}
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={10}
                    value={draft.body}
                    onChange={(e) => set('body', e.target.value)}
                    maxLength={4000}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="ann-image"
                  label="Image URL"
                  help="Optional. Public https:// image."
                  error={fieldErrors.imageUrl}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="url"
                      value={draft.imageUrl}
                      onChange={(e) => set('imageUrl', e.target.value)}
                      maxLength={1000}
                      placeholder="https://…"
                    />
                  )}
                </Field>
                <Field
                  id="ann-color"
                  label="Colour"
                  help="Optional hex value. Empty uses the type's colour."
                  error={fieldErrors.color}
                >
                  {(p) => (
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-9 w-9 shrink-0 rounded border border-border"
                        style={{ backgroundColor: previewColor(draft.color, draft.type, typeColors) }}
                      />
                      <Input
                        {...p}
                        value={draft.color}
                        onChange={(e) => set('color', e.target.value)}
                        maxLength={7}
                        placeholder="#22D3EE"
                      />
                    </div>
                  )}
                </Field>
              </div>
              <Field id="ann-channel" label="Channel" required error={fieldErrors.channelId}>
                {(p) => (
                  <ChannelPicker
                    control={p}
                    value={draft.channelId}
                    onChange={(v) => set('channelId', v)}
                    channels={channels}
                    disabled={!editable || busy}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="ann-mention"
                  label="Mention"
                  help="Who gets a notification when it is posted."
                  error={fieldErrors.mention}
                >
                  {(p) => (
                    <Select
                      {...p}
                      value={draft.mention}
                      onChange={(e) => set('mention', e.target.value as MentionMode)}
                      options={MENTION_OPTIONS.map((o) => ({ ...o }))}
                    />
                  )}
                </Field>
                {draft.mention === 'ROLE' && (
                  <Field id="ann-role" label="Role to mention" required error={fieldErrors.mentionRoleId}>
                    {(p) => (
                      <RolePicker
                        control={p}
                        value={draft.mentionRoleId}
                        onChange={(v) => set('mentionRoleId', v)}
                        roles={roles}
                        disabled={!editable || busy}
                      />
                    )}
                  </Field>
                )}
              </div>
              {pingsWithoutPermission && (
                <Alert tone="warning" title="Mass-mention permission required">
                  You can save this draft, but only staff with the mass-mention permission can publish or
                  schedule an announcement that pings
                  {draft.mention === 'ROLE' ? ' a role' : draft.mention === 'HERE' ? ' @here' : ' @everyone'}.
                </Alert>
              )}
            </fieldset>
          </form>
        </Card>

        <Card>
          <CardHeader title="Publish" description={`Times are in the server time zone (${timezone}).`} />
          <div className="space-y-4 p-4">
            {canPublish && isQueueable(status) && (
              <Field
                id="ann-when"
                label="Schedule for"
                help="At least one minute ahead, at most one year."
                error={fieldErrors.when}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="datetime-local"
                    value={when}
                    min={minScheduleInput}
                    onChange={(e) => setWhen(e.target.value)}
                    disabled={busy}
                    className="sm:max-w-xs"
                  />
                )}
              </Field>
            )}
            {!canPublish && (
              <p className="text-sm text-fg-muted">
                Publishing and scheduling need the publish permission. Save the draft and ask a publisher to
                send it.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {editable && (
                <Button
                  type="submit"
                  form="announcement-form"
                  variant="secondary"
                  loading={pending && preparing === null && !confirm}
                  loadingLabel="Saving…"
                  disabled={busy || (Boolean(current) && !dirty)}
                >
                  {current ? 'Save changes' : 'Save draft'}
                </Button>
              )}
              {canPublish && isQueueable(status) && (
                <>
                  <Button
                    onClick={() => void startQueue('publish')}
                    loading={preparing === 'publish'}
                    loadingLabel="Preparing…"
                    disabled={busy}
                  >
                    Publish now
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void startQueue('schedule')}
                    loading={preparing === 'schedule'}
                    loadingLabel="Preparing…"
                    disabled={busy}
                  >
                    {status === 'SCHEDULED' ? 'Reschedule' : 'Schedule'}
                  </Button>
                </>
              )}
              {canPublish && current && isCancellable(status) && (
                <Button variant="secondary" onClick={() => setConfirmCancel(true)} disabled={busy}>
                  Cancel schedule
                </Button>
              )}
              {canCreate && current && announcement && isDeletable(status) && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Delete
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="xl:col-span-2">
        <div className="space-y-2 xl:sticky xl:top-4">
          <h2 className="text-sm font-semibold text-fg">Preview</h2>
          <EmbedPreview
            label="Announcement preview"
            content={mentionContent(draft.mention, draft.mentionRoleId)}
            title={draft.title || 'Title'}
            description={draft.body || 'Your announcement text appears here.'}
            color={previewColor(draft.color, draft.type, typeColors)}
            imageUrl={draft.imageUrl.trim() || null}
            footer={footer}
            names={{ role: roleNameById, channel: (id) => channels?.find((c) => c.id === id)?.name }}
          />
          <p className="text-xs text-fg-muted">
            Posts to{' '}
            <span className="text-fg">
              {draft.channelId ? channelName(channels, draft.channelId) : 'no channel selected'}
            </span>
            . Approximation of Discord&apos;s rendering; the post also shows the publish time.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmQueue}
        loading={pending}
        destructive={Boolean(confirm?.preview.requiresMentionConfirmation)}
        title={
          confirm?.kind === 'schedule' ? 'Schedule this announcement?' : 'Publish this announcement now?'
        }
        description={
          confirm?.kind === 'schedule'
            ? `It will be posted to ${confirmTarget} at ${scheduleLabel}.`
            : `It will be posted to ${confirmTarget} within a few seconds. Posted messages cannot be unsent from the dashboard.`
        }
        confirmLabel={
          confirm?.preview.requiresMentionConfirmation
            ? confirm.kind === 'schedule'
              ? 'Schedule and notify'
              : 'Publish and notify'
            : confirm?.kind === 'schedule'
              ? 'Schedule'
              : 'Publish now'
        }
      >
        {confirmWarning ? (
          <Alert tone="warning" title="Members will be notified">
            {confirmWarning}
          </Alert>
        ) : (
          <p className="text-sm text-fg-muted">Nobody is pinged by this announcement.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmCancel}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={cancel}
        loading={pending}
        title="Cancel the scheduled post?"
        description="It will not be posted. The announcement is kept as cancelled, so you can schedule it again later."
        confirmLabel="Cancel schedule"
        cancelLabel="Keep scheduled"
      />

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        loading={pending}
        title="Delete this announcement?"
        description={`"${saved?.title ?? draft.title}" and its delivery history will be removed permanently.`}
        confirmLabel="Delete announcement"
      />
    </div>
  );
}
