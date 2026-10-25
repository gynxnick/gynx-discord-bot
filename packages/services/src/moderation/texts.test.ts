import { describe, expect, it } from 'vitest';
import type { ModerationAction, ModerationAppeal } from '@gynx/database';
import { listTextDefinitions, runWithTextOverrides } from '../core/text';
import * as moderation from './index';

const action = {
  id: 'a1',
  guildId: 'g1',
  number: 42,
  ref: 'M-0042',
  type: 'WARN',
  targetId: '123456789012345678',
  moderatorId: 'automod',
  reason: 'Spam',
  durationSeconds: null,
  expiresAt: null,
  status: 'APPLIED',
  failureReason: null,
  dmSent: true,
  moderatorNote: null,
  automodEventId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} as unknown as ModerationAction;

describe('moderation texts', () => {
  it('registers the moderation catalogue', () => {
    const keys = listTextDefinitions().filter((d) => d.namespace === 'moderation');
    expect(keys.length).toBeGreaterThanOrEqual(100);
    expect(keys.every((d) => d.help.length > 0)).toBe(true);
  });

  it('keeps today’s wording by default', () => {
    const e = moderation.modlogEmbed(action);
    expect(e.title).toBe('M-0042 · Warning');
    expect(e.fields?.find((f) => f.name === 'Moderator')?.value).toBe('Automod');
    expect(
      moderation.checkHierarchy({
        actorId: 'x',
        actorHighest: 1,
        targetId: 'x',
        targetHighest: 0,
        botHighest: 5,
        guildOwnerId: 'o',
      }),
    ).toEqual({ ok: false, reason: 'You cannot moderate yourself.' });
  });

  it('applies overrides at call time (modlog post)', () => {
    const e = runWithTextOverrides(
      {
        'moderation.modlogTitle': 'Case {ref}: {action}',
        'moderation.actionWarn': 'Strike',
        'moderation.moderatorAutomod': 'Robot',
      },
      () => moderation.modlogEmbed(action),
    );
    expect(e.title).toBe('Case M-0042: Strike');
    expect(e.fields?.find((f) => f.name === 'Moderator')?.value).toBe('Robot');
    // Outside the scope the default is back.
    expect(moderation.modlogEmbed(action).title).toBe('M-0042 · Warning');
  });

  it('applies overrides at call time (member DM, appeal decision, automod reason)', () => {
    const appeal = {
      id: 'ap1',
      status: 'DENIED',
      reviewNote: null,
    } as unknown as ModerationAppeal;
    runWithTextOverrides(
      {
        'moderation.dmTitleBan': 'Custom ban notice for {server}',
        'moderation.appealDeniedFor': 'Custom {ref} denied',
        'moderation.escalationWarn': 'Custom {count}',
      },
      () => {
        const dm = moderation.actionDmEmbed({
          type: 'BAN',
          reason: 'Raiding',
          durationMs: null,
          guildName: 'GYNX.GG',
          supportUrl: null,
        });
        expect(dm.title).toBe('Custom ban notice for GYNX.GG');
        expect(dm.description).toContain('**Duration:** Permanent');
        const decision = moderation.appealDecisionEmbed(appeal, 'M-0042', 'GYNX.GG', null);
        expect(decision.description).toContain('Custom M-0042 denied');
        expect(
          moderation.suggestEscalation(1, { warnAtStrikes: 2, timeoutAtStrikes: 4, timeoutMinutes: 30 })
            .summary,
        ).toBe('Custom 1');
      },
    );
  });
});
