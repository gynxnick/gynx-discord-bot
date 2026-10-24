import { describe, expect, it } from 'vitest';
import { troubleshooting } from '@gynx/services';
import {
  buildOutline,
  emptyFlow,
  fromDefinition,
  removeNode,
  renameReferences,
  stableStringify,
  toDefinition,
  validateDefinitionStructure,
  validateEditorFlow,
  type EditorFlow,
} from './flow-editor-model';

const sample: EditorFlow = {
  start: 'q1',
  nodes: [
    {
      id: 'q1',
      prompt: 'What happens?',
      options: [
        { label: 'Timeout', target: 'next', next: 'q2', articleSlug: '' },
        { label: 'Version', target: 'article', next: '', articleSlug: 'minecraft-version-mismatch' },
        { label: 'Other', target: 'escalate', next: '', articleSlug: '' },
      ],
    },
    {
      id: 'q2',
      prompt: 'Works now?',
      options: [
        { label: 'Yes', target: 'resolve', next: '', articleSlug: '' },
        { label: 'No', target: 'escalate', next: '', articleSlug: '' },
      ],
    },
  ],
};

describe('flow editor ↔ definition mapping', () => {
  it('maps each target type to exactly one definition field', () => {
    expect(toDefinition(sample)).toEqual({
      start: 'q1',
      nodes: {
        q1: {
          prompt: 'What happens?',
          options: [
            { label: 'Timeout', next: 'q2' },
            { label: 'Version', articleSlug: 'minecraft-version-mismatch' },
            { label: 'Other', escalate: true },
          ],
        },
        q2: {
          prompt: 'Works now?',
          options: [
            { label: 'Yes', resolve: true },
            { label: 'No', escalate: true },
          ],
        },
      },
    });
  });

  it('round-trips every seeded flow losslessly and agrees with the service validator', () => {
    for (const f of troubleshooting.SEED_FLOWS) {
      const { flow, warnings } = fromDefinition(f.definition);
      expect(warnings).toEqual([]);
      const def = toDefinition(flow);
      expect(stableStringify(def)).toBe(stableStringify(f.definition));
      expect(validateEditorFlow(flow)).toEqual([]);
      expect(troubleshooting.validateFlowDefinition(def).ok).toBe(true);
    }
  });

  it('warns about combinations the structured editor cannot represent', () => {
    const r = fromDefinition({
      start: 'a',
      nodes: {
        a: {
          prompt: 'p',
          options: [
            { label: 'x', next: 'a', articleSlug: 'hint' },
            { label: 'y', resolve: true },
          ],
        },
      },
    });
    expect(r.warnings).toHaveLength(1);
    expect(r.flow.nodes[0]!.options[0]!.target).toBe('next');
  });

  it('tolerates garbage input', () => {
    expect(fromDefinition(null).flow).toEqual(emptyFlow());
    expect(fromDefinition({ nodes: 'x' }).flow.nodes).toHaveLength(1);
  });

  it('re-points references when a node is renamed and clears them when removed', () => {
    const renamed = renameReferences(
      { ...sample, nodes: sample.nodes.map((n) => (n.id === 'q2' ? { ...n, id: 'confirm' } : n)) },
      1,
      'q2',
    );
    expect(renamed.nodes[0]!.options[0]!.next).toBe('confirm');
    // Renaming to an id that already exists is refused.
    const clash = { ...sample, nodes: sample.nodes.map((n) => (n.id === 'q2' ? { ...n, id: 'q1' } : n)) };
    expect(renameReferences(clash, 1, 'q2')).toBe(clash);

    const removed = removeNode(sample, 1);
    expect(removed.nodes).toHaveLength(1);
    expect(removed.nodes[0]!.options[0]!.next).toBe('');
    expect(validateEditorFlow(removed).some((e) => e.includes('choose the node'))).toBe(true);
  });
});

describe('client validation mirrors validateFlowDefinition', () => {
  const cases: Array<[string, unknown]> = [
    ['unknown next', { start: 'a', nodes: { a: { prompt: 'p', options: [{ label: 'x', next: 'zzz' }] } } }],
    [
      'missing start',
      { start: 'nope', nodes: { a: { prompt: 'p', options: [{ label: 'x', resolve: true }] } } },
    ],
    [
      'unreachable',
      {
        start: 'a',
        nodes: {
          a: { prompt: 'p', options: [{ label: 'x', resolve: true }] },
          b: { prompt: 'p', options: [{ label: 'x', resolve: true }] },
        },
      },
    ],
    [
      'cycle without exit',
      {
        start: 'a',
        nodes: {
          a: {
            prompt: 'p',
            options: [
              { label: 'x', next: 'b' },
              { label: 'y', resolve: true },
            ],
          },
          b: { prompt: 'p', options: [{ label: 'x', next: 'c' }] },
          c: { prompt: 'p', options: [{ label: 'x', next: 'b' }] },
        },
      },
    ],
    [
      'both continue and end',
      {
        start: 'a',
        nodes: {
          a: {
            prompt: 'p',
            options: [
              { label: 'x', next: 'a', resolve: true },
              { label: 'y', resolve: true },
            ],
          },
        },
      },
    ],
    ['no target', { start: 'a', nodes: { a: { prompt: 'p', options: [{ label: 'x' }] } } }],
  ];

  it.each(cases)('produces the same messages as the service: %s', (_name, def) => {
    const service = troubleshooting.validateFlowDefinition(def);
    expect(service.ok).toBe(false);
    expect(validateDefinitionStructure(def as never)).toEqual(service.errors);
  });

  it('flags editor-only problems (duplicate ids, empty labels) before structure', () => {
    const dup: EditorFlow = {
      start: 'a',
      nodes: [sample.nodes[1]!, { ...sample.nodes[1]! }].map((n) => ({ ...n, id: 'a' })),
    };
    expect(validateEditorFlow(dup)).toContain('Node id "a" is used more than once.');
    const blank: EditorFlow = {
      start: 'a',
      nodes: [
        { id: 'a', prompt: '', options: [{ label: '', target: 'resolve', next: '', articleSlug: '' }] },
      ],
    };
    const errs = validateEditorFlow(blank);
    expect(errs).toContain('Node "a": the prompt is required.');
    expect(errs).toContain('Node "a" option 1: the label is required.');
  });
});

describe('buildOutline', () => {
  it('walks from start, marks outcomes and does not expand revisited nodes', () => {
    const def = toDefinition({
      start: 'a',
      nodes: [
        {
          id: 'a',
          prompt: 'A?',
          options: [
            { label: 'go b', target: 'next', next: 'b', articleSlug: '' },
            { label: 'done', target: 'resolve', next: '', articleSlug: '' },
          ],
        },
        {
          id: 'b',
          prompt: 'B?',
          options: [
            { label: 'back', target: 'next', next: 'a', articleSlug: '' },
            { label: 'help', target: 'escalate', next: '', articleSlug: '' },
          ],
        },
      ],
    });
    expect(buildOutline(def).map((l) => [l.depth, l.kind, l.via])).toEqual([
      [0, 'node', ''],
      [1, 'node', 'go b'],
      [2, 'repeat', 'back'],
      [2, 'escalate', 'help'],
      [1, 'resolve', 'done'],
    ]);
  });
});
