import { describe, expect, it } from 'vitest';
import {
  answerRows,
  campaignPatch,
  campaignProblems,
  canAnnounceLocked,
  decisionPayload,
  decisionProblems,
  isOpenStatus,
  type CampaignDraft,
} from './partner-utils';

const questions = [
  { id: 'about', label: 'Who are you?', required: true },
  { id: 'links', label: 'Relevant links (optional)', required: false },
];

describe('partner answers', () => {
  it('pairs answers with question labels in question order, keeping text verbatim', () => {
    const rows = answerRows(questions, {
      links: 'https://a.example\nhttps://b.example',
      about: '  <b>Hi</b>\n\nthere ',
    });
    expect(rows.map((r) => r.label)).toEqual(['Who are you?', 'Relevant links (optional)']);
    expect(rows[0]!.value).toBe('  <b>Hi</b>\n\nthere ');
    expect(rows[1]!.value).toBe('https://a.example\nhttps://b.example');
  });

  it('marks missing answers and keeps unknown keys visible', () => {
    const rows = answerRows(questions, { about: 'x', legacy: 'old answer' });
    expect(rows[1]).toMatchObject({ id: 'links', value: null, required: false });
    expect(rows[2]).toMatchObject({ id: 'legacy', value: 'old answer' });
  });

  it('tolerates malformed stored answers', () => {
    expect(answerRows(questions, null).every((r) => r.value === null)).toBe(true);
    expect(answerRows(questions, ['x']).length).toBe(2);
  });
});

describe('partner decision', () => {
  it('requires a decision and a 3+ character note', () => {
    expect(
      decisionProblems({ decision: '', decisionNote: 'ok', internalNotes: '', campaignName: '' }),
    ).toHaveProperty('decision');
    expect(
      decisionProblems({ decision: 'REJECTED', decisionNote: ' no ', internalNotes: '', campaignName: '' }),
    ).toHaveProperty('decisionNote');
    expect(
      decisionProblems({
        decision: 'REJECTED',
        decisionNote: 'Not a fit',
        internalNotes: '',
        campaignName: '',
      }),
    ).toEqual({});
  });

  it('builds the payload, dropping blanks and the campaign name for rejections', () => {
    expect(
      decisionPayload({
        decision: 'APPROVED',
        decisionNote: ' Welcome! ',
        internalNotes: ' ',
        campaignName: ' Spring ',
      }),
    ).toEqual({
      decision: 'APPROVED',
      decisionNote: 'Welcome!',
      campaignName: 'Spring',
    });
    expect(
      decisionPayload({
        decision: 'REJECTED',
        decisionNote: 'Sorry',
        internalNotes: 'too small',
        campaignName: 'Spring',
      }),
    ).toEqual({
      decision: 'REJECTED',
      decisionNote: 'Sorry',
      internalNotes: 'too small',
    });
  });

  it('knows which statuses are still open', () => {
    expect(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].filter(isOpenStatus)).toEqual([
      'PENDING',
      'UNDER_REVIEW',
    ]);
  });
});

describe('campaign edit', () => {
  const initial: CampaignDraft = { name: 'P-1 partnership', active: true, endsAt: '', canAnnounce: false };

  it('sends only changed fields', () => {
    expect(campaignPatch(initial, initial)).toEqual({});
    expect(campaignPatch(initial, { ...initial, name: ' New ', endsAt: '2026-12-01T18:00' })).toEqual({
      name: 'New',
      endsAt: '2026-12-01T18:00',
    });
    expect(campaignPatch({ ...initial, endsAt: '2026-12-01T18:00' }, { ...initial, endsAt: '' })).toEqual({
      endsAt: null,
    });
    expect(campaignPatch(initial, { ...initial, active: false, canAnnounce: true })).toEqual({
      active: false,
      canAnnounce: true,
    });
  });

  it('validates name and end date', () => {
    expect(campaignProblems({ ...initial, name: ' ' })).toHaveProperty('name');
    expect(campaignProblems({ ...initial, endsAt: 'tomorrow' })).toHaveProperty('endsAt');
    expect(campaignProblems(initial)).toEqual({});
  });

  it('locks enabling announce rights without settings.manage, but never disabling', () => {
    expect(canAnnounceLocked(false, false)).toBe(true);
    expect(canAnnounceLocked(false, true)).toBe(false);
    expect(canAnnounceLocked(true, false)).toBe(false);
  });
});
