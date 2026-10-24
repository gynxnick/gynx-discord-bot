import type { ReactNode } from 'react';
import { colorToCss, tokenizeLine, type MentionNames } from './embed-markdown';

export interface EmbedPreviewProps {
  /** Message content above the embed (e.g. the mention prefix). */
  content?: string | null;
  title?: string | null;
  description?: string | null;
  color?: string | null;
  imageUrl?: string | null;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string | null;
  names?: MentionNames;
  /** Accessible label for the preview region. */
  label?: string;
  botName?: string;
}

function Md({ text, names }: { text: string; names?: MentionNames }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {tokenizeLine(line, names).map((t, j): ReactNode => {
            switch (t.kind) {
              case 'bold':
                return (
                  <strong key={j} className="font-semibold text-fg">
                    {t.text}
                  </strong>
                );
              case 'italic':
                return <em key={j}>{t.text}</em>;
              case 'code':
                return (
                  <code key={j} className="rounded bg-void px-1 py-0.5 font-mono text-[0.85em]">
                    {t.text}
                  </code>
                );
              case 'mention':
                return (
                  <span key={j} className="rounded bg-accent-soft px-0.5 text-accent">
                    {t.text}
                  </span>
                );
              default:
                return <span key={j}>{t.text}</span>;
            }
          })}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

/**
 * Discord-like message preview (approximation: Discord's own renderer differs
 * in details). Renders text only — no HTML from user content.
 */
export function EmbedPreview({
  content,
  title,
  description,
  color,
  imageUrl,
  fields = [],
  footer,
  names,
  label = 'Message preview',
  botName = 'GYNX.GG',
}: EmbedPreviewProps) {
  const safeImage = imageUrl && /^https:\/\//i.test(imageUrl) ? imageUrl : null;
  return (
    <figure aria-label={label} className="rounded-md border border-border bg-[#1a1a22] p-3 text-sm">
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg"
        >
          G
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-semibold text-fg">{botName}</span>
            <span className="ml-1.5 rounded bg-accent px-1 text-[10px] font-semibold uppercase text-accent-fg">
              App
            </span>
          </p>
          {content && (
            <p className="mt-0.5 break-words text-fg">
              <Md text={content} names={names} />
            </p>
          )}
          <div
            className="mt-1.5 max-w-[520px] overflow-hidden rounded border-l-4 bg-surface-raised"
            style={{ borderLeftColor: colorToCss(color) }}
          >
            <div className="space-y-2 px-3 py-2.5">
              {title && <p className="break-words font-semibold text-fg">{title}</p>}
              {description && (
                <div className="break-words text-[13px] leading-relaxed text-fg/90">
                  <Md text={description} names={names} />
                </div>
              )}
              {fields.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {fields.map((f, i) => (
                    <div key={i} className={f.inline ? '' : 'sm:col-span-3'}>
                      <p className="text-xs font-semibold text-fg">{f.name}</p>
                      <p className="break-all text-xs text-fg-muted">{f.value}</p>
                    </div>
                  ))}
                </div>
              )}
              {safeImage && (
                // External images are not loaded in the dashboard (content security policy); show where it points instead.
                <div className="flex h-24 items-center justify-center rounded border border-dashed border-border-strong bg-void px-3 text-center text-xs text-fg-muted">
                  <span className="break-all">Image: {safeImage}</span>
                </div>
              )}
              {footer && <p className="text-[11px] text-fg-muted">{footer}</p>}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
