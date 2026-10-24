'use client';

import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';
import { linkErrors, type LinkRow } from './form-utils';
import { TagInput } from './TagInput';
import { useApiAction } from './useApiAction';

export interface FaqCategoryRow {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  publishedCount: number;
}

export interface FaqEntryRow {
  id: string;
  categoryId: string | null;
  question: string;
  answer: string;
  keywords: string[];
  links: LinkRow[];
  published: boolean;
  views: number;
  helpfulYes: number;
  helpfulNo: number;
  updatedAtLabel: string;
}

// ── Categories ───────────────────────────────────────────────────────────────

export function FaqCategoriesCard({ categories }: { categories: FaqCategoryRow[] }) {
  const { run, pending, fieldErrors } = useApiAction();
  const [editing, setEditing] = useState<FaqCategoryRow | 'new' | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [deleting, setDeleting] = useState<FaqCategoryRow | null>(null);

  const open = (c: FaqCategoryRow | 'new') => {
    setEditing(c);
    setName(c === 'new' ? '' : c.name);
    setSlug(c === 'new' ? '' : c.slug);
    setSortOrder(c === 'new' ? '0' : String(c.sortOrder));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), slug: slug.trim() || undefined, sortOrder: Number(sortOrder) || 0 };
    const res =
      editing === 'new'
        ? await run('/api/community/faq/categories', 'POST', body, {
            success: 'Category created',
            errorTitle: 'Could not save category',
          })
        : await run(
            `/api/community/faq/categories/${encodeURIComponent((editing as FaqCategoryRow).id)}`,
            'PATCH',
            body,
            {
              success: 'Category updated',
              errorTitle: 'Could not save category',
            },
          );
    if (res) setEditing(null);
  };

  const remove = async () => {
    if (!deleting) return;
    const res = await run(
      `/api/community/faq/categories/${encodeURIComponent(deleting.id)}`,
      'DELETE',
      undefined,
      {
        success: 'Category deleted',
        successDescription: 'Its entries are now uncategorised.',
        errorTitle: 'Could not delete category',
      },
    );
    if (res) setDeleting(null);
  };

  return (
    <Card>
      <CardHeader
        title="Categories"
        description="Members only see categories that have published entries."
        actions={
          <Button size="sm" variant="secondary" onClick={() => open('new')}>
            Add category
          </Button>
        }
      />
      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Categories group entries in /faq. Entries can also stay uncategorised."
        />
      ) : (
        <ul className="divide-y divide-border">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{c.name}</p>
                <p className="text-xs text-fg-muted">
                  <span className="font-mono">{c.slug}</span> · order {c.sortOrder} · {c.publishedCount}{' '}
                  published
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => open(c)}
                  aria-label={`Edit category ${c.name}`}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleting(c)}
                  aria-label={`Delete category ${c.name}`}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add category' : 'Edit category'}
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="faq-category-form" loading={pending} loadingLabel="Saving…">
              Save
            </Button>
          </>
        }
      >
        <form id="faq-category-form" onSubmit={save} className="space-y-4" noValidate>
          <Field id="cat-name" label="Name" required error={fieldErrors.name}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />}
          </Field>
          <Field
            id="cat-slug"
            label="Slug"
            help="Lowercase letters, numbers and dashes. Leave empty to derive from the name."
            error={fieldErrors.slug}
          >
            {(p) => (
              <Input
                {...p}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                maxLength={60}
                placeholder="billing"
              />
            )}
          </Field>
          <Field
            id="cat-order"
            label="Sort order"
            help="Lower numbers come first."
            error={fieldErrors.sortOrder}
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={1000}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            )}
          </Field>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        loading={pending}
        title="Delete category?"
        description={
          deleting
            ? `"${deleting.name}" will be removed. Its entries are kept and become uncategorised.`
            : undefined
        }
        confirmLabel="Delete category"
      />
    </Card>
  );
}

// ── Entries ──────────────────────────────────────────────────────────────────

export interface EntryDraft {
  categoryId: string;
  question: string;
  answer: string;
  keywords: string[];
  links: LinkRow[];
  published: boolean;
}

const emptyDraft = (): EntryDraft => ({
  categoryId: '',
  question: '',
  answer: '',
  keywords: [],
  links: [],
  published: false,
});

export function faqDraftToPayload(d: EntryDraft) {
  return {
    categoryId: d.categoryId || null,
    question: d.question.trim(),
    answer: d.answer.trim(),
    keywords: d.keywords,
    links: d.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
    published: d.published,
  };
}

export function FaqEntriesTable({
  entries,
  categories,
  filtered,
}: {
  entries: FaqEntryRow[];
  categories: FaqCategoryRow[];
  filtered: boolean;
}) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [editing, setEditing] = useState<FaqEntryRow | 'new' | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);
  const [deleting, setDeleting] = useState<FaqEntryRow | null>(null);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Uncategorised';

  const open = (e: FaqEntryRow | 'new') => {
    setFieldErrors({});
    setEditing(e);
    setDraft(
      e === 'new'
        ? emptyDraft()
        : {
            categoryId: e.categoryId ?? '',
            question: e.question,
            answer: e.answer,
            keywords: e.keywords,
            links: e.links,
            published: e.published,
          },
    );
  };
  const set = <K extends keyof EntryDraft>(k: K, v: EntryDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    const local: Record<string, string> = linkErrors(draft.links);
    if (draft.question.trim().length < 5) local.question = 'At least 5 characters.';
    if (!draft.answer.trim()) local.answer = 'Write an answer.';
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    const body = faqDraftToPayload(draft);
    const res =
      editing === 'new'
        ? await run('/api/community/faq/entries', 'POST', body, {
            success: 'FAQ entry created',
            errorTitle: 'Could not save entry',
          })
        : await run(
            `/api/community/faq/entries/${encodeURIComponent((editing as FaqEntryRow).id)}`,
            'PATCH',
            body,
            {
              success: 'FAQ entry saved',
              errorTitle: 'Could not save entry',
            },
          );
    if (res) setEditing(null);
  };

  const togglePublished = (e: FaqEntryRow) =>
    run(
      `/api/community/faq/entries/${encodeURIComponent(e.id)}`,
      'PATCH',
      { published: !e.published },
      {
        success: e.published ? 'Entry unpublished' : 'Entry published',
        errorTitle: 'Could not update entry',
      },
    );

  const remove = async () => {
    if (!deleting) return;
    const res = await run(
      `/api/community/faq/entries/${encodeURIComponent(deleting.id)}`,
      'DELETE',
      undefined,
      { success: 'FAQ entry deleted', errorTitle: 'Could not delete entry' },
    );
    if (res) setDeleting(null);
  };

  const columns: Column<FaqEntryRow>[] = [
    {
      key: 'question',
      header: 'Question',
      cell: (e) => (
        <div className="min-w-[14rem]">
          <button
            type="button"
            className="text-left font-medium text-fg hover:text-accent"
            onClick={() => open(e)}
          >
            {e.question}
          </button>
          {e.keywords.length > 0 && <p className="mt-0.5 text-xs text-fg-muted">{e.keywords.join(', ')}</p>}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      cell: (e) => <span className="text-fg-muted">{catName(e.categoryId)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (e) => (e.published ? <Badge tone="success">Published</Badge> : <Badge>Draft</Badge>),
    },
    {
      key: 'views',
      header: 'Views',
      align: 'right',
      cell: (e) => <span className="tabular-nums">{e.views.toLocaleString('en-US')}</span>,
    },
    {
      key: 'helpful',
      header: 'Helpful',
      align: 'right',
      hideOnMobile: true,
      cell: (e) => (
        <span
          className="whitespace-nowrap tabular-nums text-fg-muted"
          title={`${e.helpfulYes} yes / ${e.helpfulNo} no`}
        >
          {e.helpfulYes} / {e.helpfulNo}
        </span>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      hideOnMobile: true,
      cell: (e) => <span className="whitespace-nowrap text-fg-muted">{e.updatedAtLabel}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (e) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => open(e)} aria-label={`Edit "${e.question}"`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void togglePublished(e)}
            disabled={pending}
            aria-label={`${e.published ? 'Unpublish' : 'Publish'} "${e.question}"`}
          >
            {e.published ? 'Unpublish' : 'Publish'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDeleting(e)}
            aria-label={`Delete "${e.question}"`}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Entries"
        description="Views are counted at most once per member per 10 minutes. Helpful = yes / no votes."
        actions={
          <Button size="sm" onClick={() => open('new')}>
            New entry
          </Button>
        }
      />
      <Table
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        caption="FAQ entries"
        empty={
          <EmptyState
            title={filtered ? 'No entries match these filters' : 'No FAQ entries yet'}
            description={
              filtered
                ? 'Try another search or category.'
                : 'Create the first entry; it stays a draft until you publish it.'
            }
          />
        }
      />

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New FAQ entry' : 'Edit FAQ entry'}
        size="lg"
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="faq-entry-form" loading={pending} loadingLabel="Saving…">
              Save entry
            </Button>
          </>
        }
      >
        <form id="faq-entry-form" onSubmit={save} className="space-y-4" noValidate>
          <Field id="faq-question" label="Question" required error={fieldErrors.question}>
            {(p) => (
              <Input
                {...p}
                value={draft.question}
                onChange={(e) => set('question', e.target.value)}
                maxLength={200}
              />
            )}
          </Field>
          <Field id="faq-category" label="Category" error={fieldErrors.categoryId}>
            {(p) => (
              <Select
                {...p}
                value={draft.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
                placeholder="Uncategorised"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          </Field>
          <Field
            id="faq-answer"
            label="Answer"
            required
            help="Discord markdown: **bold**, *italic*, `code`, lists. Up to 4000 characters."
            error={fieldErrors.answer}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={8}
                value={draft.answer}
                onChange={(e) => set('answer', e.target.value)}
                maxLength={4000}
                className="font-mono text-xs"
              />
            )}
          </Field>
          <Field
            id="faq-keywords"
            label="Keywords"
            help="Boost search matches. Press Enter or comma after each keyword (max 20)."
            error={fieldErrors.keywords}
          >
            {(p) => <TagInput control={p} value={draft.keywords} onChange={(k) => set('keywords', k)} />}
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">Links</legend>
            <p className="text-xs text-fg-muted">Up to 5 https:// links shown as buttons under the answer.</p>
            {draft.links.map((l, i) => (
              <div
                key={i}
                className="grid gap-2 rounded border border-border p-2 sm:grid-cols-[1fr_2fr_auto] sm:items-start"
              >
                <Field id={`faq-link-label-${i}`} label="Label" error={fieldErrors[`links.${i}.label`]}>
                  {(p) => (
                    <Input
                      {...p}
                      value={l.label}
                      maxLength={80}
                      onChange={(e) =>
                        set(
                          'links',
                          draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                </Field>
                <Field id={`faq-link-url-${i}`} label="URL" error={fieldErrors[`links.${i}.url`]}>
                  {(p) => (
                    <Input
                      {...p}
                      value={l.url}
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      maxLength={500}
                      onChange={(e) =>
                        set(
                          'links',
                          draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  className="sm:mt-6"
                  onClick={() =>
                    set(
                      'links',
                      draft.links.filter((_, j) => j !== i),
                    )
                  }
                  aria-label={`Remove link ${i + 1}`}
                >
                  Remove
                </Button>
              </div>
            ))}
            {draft.links.length < 5 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => set('links', [...draft.links, { label: '', url: '' }])}
              >
                Add link
              </Button>
            )}
          </fieldset>
          <Switch
            id="faq-published"
            checked={draft.published}
            onChange={(v) => set('published', v)}
            label="Published"
            description="Drafts are never shown to members."
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        loading={pending}
        title="Delete FAQ entry?"
        description={
          deleting
            ? `"${deleting.question}" and its view/helpful statistics will be permanently removed.`
            : undefined
        }
        confirmLabel="Delete entry"
      />
    </Card>
  );
}
