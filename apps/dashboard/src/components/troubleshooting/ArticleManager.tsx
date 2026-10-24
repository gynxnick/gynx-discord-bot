'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea, type SelectOption } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/format';
import {
  articlePayload,
  articleToForm,
  emptyArticle,
  helpfulRatio,
  slugify,
  validateArticleForm,
  type ArticleFormState,
  type ArticleRow,
} from './forms';
import { MarkdownPreview } from './MarkdownPreview';
import { TagsInput } from './TagsInput';

export function ArticleManager({
  rows,
  games,
  timezone,
  filtered,
}: {
  rows: ArticleRow[];
  games: SelectOption[];
  timezone: string;
  filtered: boolean;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const gameLabel = (g: string | null) => (g ? (games.find((x) => x.value === g)?.label ?? g) : 'General');

  const [editing, setEditing] = useState<ArticleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ArticleRow | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const doDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await api(`/api/troubleshooting/articles/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
      toast.success('Article deleted', deleting.title);
      setDeleting(null);
      router.refresh();
    } catch (e) {
      toast.error('Could not delete article', (e as Error).message);
    } finally {
      setBusyDelete(false);
    }
  };

  const doSeed = async () => {
    setSeeding(true);
    try {
      const r = await api<{ articlesCreated: number; flowsCreated: number }>('/api/troubleshooting/seed', {
        method: 'POST',
      });
      toast.success(
        'Default content loaded',
        `${r.articlesCreated} article(s) and ${r.flowsCreated} flow(s) added. Existing items were left unchanged.`,
      );
      setSeedOpen(false);
      router.refresh();
    } catch (e) {
      toast.error('Could not load default content', (e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const columns: Column<ArticleRow>[] = [
    {
      key: 'title',
      header: 'Title',
      cell: (a) => (
        <div className="min-w-[12rem]">
          <button
            type="button"
            className="text-left font-medium text-accent hover:underline"
            onClick={() => setEditing(a)}
          >
            {a.title}
          </button>
          <p className="font-mono text-xs text-fg-muted">{a.slug}</p>
        </div>
      ),
    },
    { key: 'game', header: 'Game', cell: (a) => gameLabel(a.game) },
    {
      key: 'tags',
      header: 'Tags',
      hideOnMobile: true,
      cell: (a) =>
        a.tags.length ? (
          <span className="flex max-w-[16rem] flex-wrap gap-1">
            {a.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: 'published',
      header: 'Status',
      cell: (a) =>
        a.published ? (
          <Badge tone="success" dot>
            Published
          </Badge>
        ) : (
          <Badge dot>Draft</Badge>
        ),
    },
    { key: 'views', header: 'Views', align: 'right', cell: (a) => formatNumber(a.views) },
    {
      key: 'helpful',
      header: 'Helpful',
      align: 'right',
      hideOnMobile: true,
      cell: (a) => {
        const r = helpfulRatio(a.helpfulYes, a.helpfulNo);
        return (
          <span className="whitespace-nowrap" title={`${a.helpfulYes} yes / ${a.helpfulNo} no`}>
            {r === null ? <span className="text-fg-muted">No votes</span> : `${r}%`}
            <span className="ml-1 text-xs text-fg-muted">
              ({a.helpfulYes}/{a.helpfulNo})
            </span>
          </span>
        );
      },
    },
    {
      key: 'updated',
      header: 'Updated',
      hideOnMobile: true,
      cell: (a) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(a.updatedAt, timezone)}</span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (a) => (
        <span className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label={`Edit ${a.title}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() => setDeleting(a)}
            aria-label={`Delete ${a.title}`}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-xs text-fg-muted">
          Members see published articles in /knowledge-search and inside troubleshooting flows.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSeedOpen(true)}>
            Load default GYNX content
          </Button>
          <Button size="sm" onClick={() => setEditing('new')}>
            New article
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        caption="Knowledge base articles, most recently updated first"
        empty={
          <EmptyState
            title={filtered ? 'No articles match these filters' : 'No articles yet'}
            description={
              filtered
                ? 'Try a different search, game or status.'
                : 'Write your first article, or load the default GYNX content to get started.'
            }
          />
        }
      />

      {editing && (
        <ArticleEditor
          key={editing === 'new' ? 'new' : editing.id}
          article={editing === 'new' ? null : editing}
          games={games}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
        loading={busyDelete}
        title="Delete article?"
        confirmLabel="Delete article"
        description={
          deleting
            ? `“${deleting.title}” will be removed permanently. Flows that link to it must be updated before they can be saved again.`
            : undefined
        }
      />

      <ConfirmDialog
        open={seedOpen}
        onCancel={() => setSeedOpen(false)}
        onConfirm={doSeed}
        loading={seeding}
        destructive={false}
        title="Load default GYNX content?"
        confirmLabel="Load defaults"
        description="Adds the curated starter articles and troubleshooting flows as published items. Anything with the same slug that already exists — including items you edited — is never overwritten, so this is safe to run again."
      />
    </>
  );
}

function ArticleEditor({
  article,
  games,
  onClose,
  onSaved,
}: {
  article: ArticleRow | null;
  games: SelectOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const [form, setForm] = useState<ArticleFormState>(article ? articleToForm(article) : emptyArticle());
  const [slugTouched, setSlugTouched] = useState(Boolean(article));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ArticleFormState>(k: K, v: ArticleFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const local = validateArticleForm(form);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      const body = articlePayload(form);
      if (article)
        await api(`/api/troubleshooting/articles/${encodeURIComponent(article.id)}`, {
          method: 'PATCH',
          body,
        });
      else await api('/api/troubleshooting/articles', { method: 'POST', body });
      toast.success(article ? 'Article saved' : 'Article created', body.title);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setErrors(err.fieldErrors());
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!saving}
      size="lg"
      title={article ? 'Edit article' : 'New article'}
      description="Write for members: short steps, the exact error text, and what to try next. Credentials are scrubbed automatically on save."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving} loadingLabel="Saving…">
            {article ? 'Save changes' : 'Create article'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && (
          <Alert tone="danger" title="Could not save">
            {formError}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="kb-title" label="Title" required error={errors.title}>
            {(p) => (
              <Input
                {...p}
                value={form.title}
                maxLength={120}
                onChange={(e) => {
                  const title = e.target.value;
                  setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : slugify(title) }));
                }}
              />
            )}
          </Field>
          <Field
            id="kb-slug"
            label="Slug"
            required
            help="Used in links and flows. Lowercase-kebab-case."
            error={errors.slug}
          >
            {(p) => (
              <Input
                {...p}
                className="font-mono"
                value={form.slug}
                maxLength={64}
                onChange={(e) => {
                  setSlugTouched(true);
                  set('slug', e.target.value);
                }}
              />
            )}
          </Field>
        </div>
        <Field
          id="kb-summary"
          label="Summary"
          required
          help="One or two sentences shown in search results (10–300 characters)."
          error={errors.summary}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={form.summary}
              maxLength={300}
              onChange={(e) => set('summary', e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="kb-game" label="Game" error={errors.game}>
            {(p) => (
              <Select
                {...p}
                value={form.game}
                onChange={(e) => set('game', e.target.value)}
                placeholder="General (all games)"
                options={games}
              />
            )}
          </Field>
          <Field
            id="kb-url"
            label="External link"
            help="Optional https:// link to a longer guide."
            error={errors.url}
          >
            {(p) => (
              <Input
                {...p}
                type="url"
                inputMode="url"
                value={form.url}
                maxLength={500}
                placeholder="https://"
                onChange={(e) => set('url', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field id="kb-tags" label="Tags" help="Search keywords, up to 10." error={errors.tags}>
          {(p) => <TagsInput control={p} value={form.tags} onChange={(t) => set('tags', t)} />}
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">
            Body
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          </p>
          <Tabs
            label="Article body"
            items={[
              {
                id: 'write',
                label: 'Write',
                content: (
                  <Field
                    id="kb-body"
                    label={<span className="sr-only">Body (Markdown)</span>}
                    help="Markdown: # headings, **bold**, *italics*, - lists, 1. lists, `code`, ``` code blocks, [links](https://…). Other markup is shown as text."
                    error={errors.body}
                  >
                    {(p) => (
                      <Textarea
                        {...p}
                        className="font-mono text-xs"
                        rows={14}
                        value={form.body}
                        maxLength={6000}
                        onChange={(e) => set('body', e.target.value)}
                      />
                    )}
                  </Field>
                ),
              },
              {
                id: 'preview',
                label: 'Preview',
                content: (
                  <div className="min-h-[12rem] rounded border border-border p-3">
                    <MarkdownPreview source={form.body} />
                  </div>
                ),
              },
            ]}
          />
          <p className="mt-1 text-right text-xs text-fg-muted">{form.body.length} / 6000</p>
        </div>

        <Switch
          id="kb-published"
          checked={form.published}
          onChange={(v) => set('published', v)}
          label="Published"
          description="Drafts are only visible to staff."
        />
        {/* Enables Enter-to-submit from single-line inputs. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
