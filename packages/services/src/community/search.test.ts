import { describe, expect, it } from 'vitest';
import { rankFaqEntries, scoreFaq, tokenize, type SearchableFaq } from './search';

const e = (id: string, over: Partial<SearchableFaq>): SearchableFaq => ({
  id,
  question: '',
  answer: '',
  keywords: [],
  views: 0,
  ...over,
});

describe('FAQ search ranking', () => {
  const kw = e('kw', { question: 'How do I change things?', answer: 'Open settings.', keywords: ['port'] });
  const q = e('q', { question: 'Which port does my server use?', answer: 'See the panel.' });
  const a = e('a', { question: 'Networking basics', answer: 'The port is listed on the dashboard.' });
  const none = e('none', { question: 'Billing', answer: 'Handled elsewhere.' });

  it('ranks keyword hit > question hit > answer hit and drops non-matches', () => {
    expect(rankFaqEntries([a, none, q, kw], 'port').map((x) => x.id)).toEqual(['kw', 'q', 'a']);
  });

  it('is case-insensitive', () => {
    expect(rankFaqEntries([q], 'PORT').map((x) => x.id)).toEqual(['q']);
  });

  it('a single keyword hit outranks many question and answer hits', () => {
    const manyQ = e('manyQ', { question: 'server port reset mod', answer: 'server port reset mod' });
    const oneKw = e('oneKw', { keywords: ['reset'] });
    expect(rankFaqEntries([manyQ, oneKw], 'server port reset mod').map((x) => x.id)).toEqual([
      'oneKw',
      'manyQ',
    ]);
  });

  it('breaks ties by views', () => {
    const low = e('low', { question: 'port', views: 1 });
    const high = e('high', { question: 'port', views: 50 });
    expect(rankFaqEntries([low, high], 'port').map((x) => x.id)).toEqual(['high', 'low']);
  });

  it('tokenizes and ignores 1-char noise', () => {
    expect(tokenize('How do I fix a Port?')).toEqual(['how', 'do', 'fix', 'port']);
    expect(scoreFaq(q, [])).toBe(0);
  });
});
