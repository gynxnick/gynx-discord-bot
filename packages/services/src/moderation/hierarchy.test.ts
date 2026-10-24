import { describe, expect, it } from 'vitest';
import { checkHierarchy, type HierarchyInput } from './hierarchy';

const base: HierarchyInput = {
  actorId: 'mod',
  actorHighest: 10,
  targetId: 'member',
  targetHighest: 1,
  botHighest: 20,
  guildOwnerId: 'owner',
};

describe('checkHierarchy', () => {
  it('allows a moderator to act on a lower member', () => {
    expect(checkHierarchy(base)).toEqual({ ok: true });
  });
  it('rejects self-targeting', () => {
    expect(checkHierarchy({ ...base, targetId: 'mod' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/yourself/),
    });
  });
  it('rejects the guild owner as target', () => {
    expect(checkHierarchy({ ...base, targetId: 'owner' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/owner/),
    });
  });
  it('rejects equal or higher top roles', () => {
    expect(checkHierarchy({ ...base, targetHighest: 10 }).ok).toBe(false);
    expect(checkHierarchy({ ...base, targetHighest: 11 }).ok).toBe(false);
  });
  it('the owner may act on higher roles but never above the bot', () => {
    expect(checkHierarchy({ ...base, actorId: 'owner', actorHighest: 0, targetHighest: 15 }).ok).toBe(true);
    expect(checkHierarchy({ ...base, actorId: 'owner', actorHighest: 0, targetHighest: 20 })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/mine/),
    });
  });
  it('rejects targets at or above the bot unless the action is DB-only', () => {
    const above = { ...base, actorHighest: 30, targetHighest: 20 };
    expect(checkHierarchy(above).ok).toBe(false);
    expect(checkHierarchy({ ...above, requiresBot: false }).ok).toBe(true);
  });
  it('skips role comparison for non-members', () => {
    expect(checkHierarchy({ ...base, targetHighest: null }).ok).toBe(true);
  });
  it('requires ban permission to moderate staff', () => {
    expect(checkHierarchy({ ...base, targetIsStaff: true }).ok).toBe(false);
    expect(checkHierarchy({ ...base, targetIsStaff: true, actorCanBan: true }).ok).toBe(true);
    expect(checkHierarchy({ ...base, targetIsStaff: true, actorCanBan: true, targetHighest: 12 }).ok).toBe(
      false,
    );
  });
});
