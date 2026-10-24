import { buildOutline, type FlowDefinitionShape, type OutlineLine } from './flow-editor-model';
import { cn } from '@/components/ui/cn';

const KIND_CLS: Record<OutlineLine['kind'], string> = {
  node: 'text-fg',
  repeat: 'text-fg-muted italic',
  missing: 'text-danger',
  article: 'text-accent',
  resolve: 'text-success',
  escalate: 'text-warning',
};

/** Read-only indented tree of the flow, starting at the start node. */
export function FlowOutline({ definition }: { definition: FlowDefinitionShape | null }) {
  if (!definition) return <p className="text-sm text-fg-muted">Fix the JSON to see the outline.</p>;
  const lines = buildOutline(definition);
  return (
    <ul className="space-y-1 font-mono text-xs" aria-label="Flow outline">
      {lines.map((l, i) => (
        <li
          key={i}
          style={{ paddingLeft: `${Math.min(l.depth, 12) * 1.1}rem` }}
          className={cn('break-words', KIND_CLS[l.kind])}
        >
          {l.via && <span className="text-fg-muted">[{l.via}] </span>}
          {l.text}
        </li>
      ))}
    </ul>
  );
}
