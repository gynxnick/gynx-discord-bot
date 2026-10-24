import { renderSafeMarkdown } from './markdown';

/**
 * Preview of knowledge-base Markdown. The HTML comes from `renderSafeMarkdown`,
 * which escapes the entire source first and only emits a fixed set of tags
 * (links are https-only), so injected markup is shown as text.
 */
export function MarkdownPreview({ source, className }: { source: string; className?: string }) {
  if (!source.trim()) return <p className="text-sm text-fg-muted">Nothing to preview yet.</p>;
  return (
    <div
      className={
        'space-y-3 break-words text-sm leading-relaxed text-fg ' +
        '[&_h3]:text-base [&_h3]:font-semibold [&_h4]:text-sm [&_h4]:font-semibold [&_h5]:text-sm [&_h5]:font-medium [&_h5]:text-fg-muted ' +
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 ' +
        '[&_code]:rounded [&_code]:bg-surface-raised [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs ' +
        '[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-raised [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 ' +
        (className ?? '')
      }
      // Safe: renderSafeMarkdown escapes all input and emits only whitelisted tags.
      dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(source) }}
    />
  );
}
