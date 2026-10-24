import { describe, expect, it } from 'vitest';
import { GAME_IDS } from '../games/registry';
import { articleInputSchema } from './articles';
import { MAX_FLOW_NODES, referencedArticleSlugs, validateFlowDefinition } from './flow-definition';
import { SEED_ARTICLES, SEED_FLOWS } from './seed-content';

const ok = {
  start: 'a',
  nodes: {
    a: {
      prompt: 'Q1?',
      options: [
        { label: 'Go on', next: 'b' },
        { label: 'Done', resolve: true },
      ],
    },
    b: {
      prompt: 'Q2?',
      options: [
        { label: 'Back', next: 'a' },
        { label: 'Help', escalate: true },
        { label: 'Read', articleSlug: 'some-article' },
      ],
    },
  },
};

describe('validateFlowDefinition', () => {
  it('accepts a valid flow (cycles are fine when an exit exists)', () => {
    const v = validateFlowDefinition(ok);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(referencedArticleSlugs(v.definition!)).toEqual(['some-article']);
  });

  it('rejects unknown node references and a missing start', () => {
    expect(validateFlowDefinition({ ...ok, start: 'zzz' }).errors.join()).toMatch(
      /Start node "zzz" does not exist/,
    );
    const bad = {
      start: 'a',
      nodes: {
        a: {
          prompt: 'Q',
          options: [
            { label: 'x', next: 'nope' },
            { label: 'y', resolve: true },
          ],
        },
      },
    };
    expect(validateFlowDefinition(bad).errors.join()).toMatch(/unknown node "nope"/);
  });

  it('rejects unreachable nodes', () => {
    const v = validateFlowDefinition({
      ...ok,
      nodes: { ...ok.nodes, orphan: { prompt: 'Lost', options: [{ label: 'x', resolve: true }] } },
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/"orphan" is unreachable/);
  });

  it('rejects cycles without an exit', () => {
    const loop = {
      start: 'a',
      nodes: {
        a: {
          prompt: 'A',
          options: [
            { label: 'to b', next: 'b' },
            { label: 'done', resolve: true },
          ],
        },
        b: { prompt: 'B', options: [{ label: 'to c', next: 'c' }] },
        c: { prompt: 'C', options: [{ label: 'to b', next: 'b' }] },
      },
    };
    const v = validateFlowDefinition(loop);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/"b" can never reach an outcome/);
    expect(v.errors.join()).toMatch(/"c" can never reach an outcome/);
  });

  it('rejects more than 50 nodes', () => {
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_FLOW_NODES; i++) {
      nodes[`n${i}`] = {
        prompt: `Step ${i}`,
        options:
          i < MAX_FLOW_NODES ? [{ label: 'next', next: `n${i + 1}` }] : [{ label: 'end', resolve: true }],
      };
    }
    expect(validateFlowDefinition({ start: 'n0', nodes }).errors.join()).toMatch(/at most 50 nodes/);
  });

  it('rejects malformed options', () => {
    const base = (option: unknown) => ({ start: 'a', nodes: { a: { prompt: 'Q', options: [option] } } });
    expect(validateFlowDefinition(base({ label: 'nothing' })).errors.join()).toMatch(/must continue/);
    expect(
      validateFlowDefinition(base({ label: 'both', resolve: true, escalate: true })).errors.join(),
    ).toMatch(/both resolve and escalate/);
    expect(
      validateFlowDefinition({
        start: 'a',
        nodes: { a: { prompt: 'Q', options: [{ label: 'x', next: 'a', resolve: true }] } },
      }).errors.join(),
    ).toMatch(/both continue and end/);
    expect(validateFlowDefinition(base({ label: 'x', resolve: true, evil: 1 })).ok).toBe(false); // strict
    expect(validateFlowDefinition({ start: 'a', nodes: { a: { prompt: 'Q', options: [] } } }).ok).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({ label: `o${i}`, resolve: true }));
    expect(validateFlowDefinition({ start: 'a', nodes: { a: { prompt: 'Q', options: six } } }).ok).toBe(
      false,
    );
    expect(validateFlowDefinition('not an object').ok).toBe(false);
  });
});

describe('seed content', () => {
  const slugs = new Set(SEED_ARTICLES.map((a) => a.slug));

  it('every seed flow is valid and links only seeded articles', () => {
    for (const f of SEED_FLOWS) {
      const v = validateFlowDefinition(f.definition);
      expect(v.errors, f.slug).toEqual([]);
      for (const s of referencedArticleSlugs(v.definition!))
        expect(slugs.has(s), `${f.slug} → ${s}`).toBe(true);
    }
  });

  it('every seed article passes validation, has a known game and ends with a support pointer', () => {
    for (const a of SEED_ARTICLES) {
      expect(() => articleInputSchema.parse(a), a.slug).not.toThrow();
      if (a.game) expect(GAME_IDS).toContain(a.game);
      expect(
        a.body.trim().endsWith('include what you already tried and the exact error message.'),
        a.slug,
      ).toBe(true);
      expect(a.body).not.toMatch(/\bGYNX\b/); // generic guidance only — no infrastructure claims
    }
  });

  it('covers the required games and topics', () => {
    for (const s of [
      'minecraft-cant-connect',
      'minecraft-version-mismatch',
      'minecraft-java-version',
      'minecraft-mod-plugin-conflicts',
      'minecraft-out-of-memory',
      'minecraft-world-corruption',
      'rust-cant-find-server',
      'rust-wipe-version-mismatch',
      'palworld-cant-connect',
      'valheim-crossplay-password',
      'gmod-missing-content',
    ]) {
      expect(slugs.has(s), s).toBe(true);
    }
  });
});
