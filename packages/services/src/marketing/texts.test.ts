import { describe, expect, it } from 'vitest';
import { listTextDefinitions, runWithTextOverrides } from '../core/text';
import * as marketing from './index';

describe('marketing texts', () => {
  it('registers the marketing catalogue', () => {
    const defs = listTextDefinitions().filter((d) => d.namespace === 'marketing');
    expect(defs.length).toBeGreaterThanOrEqual(150);
    expect(defs.every((d) => d.help.length > 0)).toBe(true);
  });

  it('keeps the default wording', () => {
    expect(marketing.mentionWarning('EVERYONE', null, { memberCount: 1234 })).toBe(
      'This will ping @everyone and notify about 1,234 members.',
    );
    expect(marketing.announcementTypeLabel('GAME_LAUNCH')).toBe('Game launch');
    expect(marketing.partnerCategoryLabel('OTHER')).toBe('Other');
  });

  it('resolves overrides at call time', () => {
    const out = runWithTextOverrides(
      {
        'marketing.warnRoleCount': 'Custom {role} x{count}',
        'marketing.decisionApprovedTitle': 'Custom approved {ref}',
        'marketing.btnApprove': 'Custom yes',
        'marketing.typePoll': 'Custom poll',
      },
      () => ({
        warning: marketing.mentionWarning('ROLE', '123456789012345678', { roleMemberCount: 5 }),
        dm: marketing.partnerDecisionEmbed({ ref: 'P-0001', status: 'APPROVED', decisionNote: null }),
        buttons: marketing.partnerStaffButtons({ id: 'app1' }),
        type: marketing.announcementTypeLabel('POLL'),
      }),
    );
    expect(out.warning).toBe('Custom <@&123456789012345678> x5');
    expect(out.dm.title).toBe('Custom approved P-0001');
    expect(JSON.stringify(out.buttons)).toContain('Custom yes');
    expect(out.type).toBe('Custom poll');
    // Outside the scope the default is back.
    expect(
      marketing.partnerDecisionEmbed({ ref: 'P-0001', status: 'APPROVED', decisionNote: null }).title,
    ).toBe('Your partner application P-0001 was approved');
  });

  it('applies overrides to service errors', () => {
    expect(() =>
      runWithTextOverrides({ 'marketing.scheduleBadFormat': 'Custom format' }, () =>
        marketing.parseScheduleInput('tomorrow', 'Europe/London'),
      ),
    ).toThrow('Custom format');
  });
});
