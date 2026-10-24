import { describe, expect, it } from 'vitest';
import { scoreArticle, tokenize } from './articles';

const article = (over: Partial<Parameters<typeof scoreArticle>[0]> = {}) => ({
  title: 'Minecraft: Out of memory',
  summary: 'What OutOfMemoryError means',
  body: 'Lower view distance. Memory leaks happen.',
  tags: ['memory', 'ram'],
  game: 'minecraft',
  helpfulYes: 0,
  helpfulNo: 0,
  views: 0,
  ...over,
});

describe('knowledge search ranking', () => {
  it('tokenizes and drops stop words', () => {
    expect(tokenize("Why can't I connect to my server?")).toEqual(['connect', 'server']);
    expect(tokenize('a')).toEqual([]);
  });

  it('weights title > tags > summary > body and rewards full matches and the game filter', () => {
    const terms = tokenize('memory');
    const inTitle = scoreArticle(article(), terms, 'memory');
    const inBodyOnly = scoreArticle(article({ title: 'Lag', summary: 'Slow', tags: [] }), terms, 'memory');
    expect(inTitle).toBeGreaterThan(inBodyOnly);
    expect(scoreArticle(article(), terms, 'memory', 'minecraft')).toBeGreaterThan(inTitle);
    expect(scoreArticle(article(), tokenize('valheim password'), 'valheim password')).toBe(0);
  });

  it('nudges well-rated articles up', () => {
    const terms = tokenize('memory');
    expect(scoreArticle(article({ helpfulYes: 9, helpfulNo: 1 }), terms, 'memory')).toBeGreaterThan(
      scoreArticle(article({ helpfulYes: 1, helpfulNo: 9 }), terms, 'memory'),
    );
  });
});
