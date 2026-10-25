import { describe, expect, it } from 'vitest';
import { setup } from '@gynx/services';
import {
  EMBED_TOTAL_LIMIT,
  buildComponentSelect,
  buildControls,
  buildDisruptiveConfirm,
  embedLength,
  listValue,
  renderOverview,
  renderPreview,
} from './view';

type Preview = setup.OperationPreview;

function preview(over: Partial<Preview['plan']> = {}, extra: Partial<Preview> = {}): Preview {
  const changes = over.changes ?? [];
  return {
    operationId: 'op_123',
    type: 'START',
    blueprintVersion: 1,
    plan: {
      blueprintVersion: 1,
      changes,
      findings: [],
      inPlace: [],
      missingBotPermissions: [],
      blocked: false,
      ...over,
    },
    summary: { create: changes.length, adopt: 0, update: 0, permissions: 0, messages: 0, disruptive: 0 },
    requiresDisruptiveConsent: false,
    ...extra,
  };
}

/** A plan far larger than Discord allows in one message. */
function hugePlan(): setup.PlannedChange[] {
  const changes: setup.PlannedChange[] = [];
  for (let i = 0; i < 300; i++)
    changes.push({
      kind: 'role.create',
      key: `role:r${i}`,
      name: `Role ${i}`,
      color: '#ffffff',
      permissions: '0',
      risk: 'safe',
      description: `Create role "Role ${i}" with a fairly long description to fill up space quickly`,
    });
  for (const cat of setup.BLUEPRINT_CATEGORIES)
    for (let i = 0; i < 60; i++)
      changes.push({
        kind: 'channel.create',
        key: setup.channelKey(`${cat.key}-c${i}`),
        name: `channel-${i}`,
        channelType: 'text',
        parentKey: setup.categoryKey(cat.key),
        risk: i % 7 === 0 ? 'disruptive' : 'safe',
        description: `Create #channel-${i} in ${cat.name} with an extended explanation of why`,
      });
  for (let i = 0; i < 400; i++)
    changes.push({
      kind: 'overwrite.set',
      key: `ow:${i}`,
      channelKey: 'channel:x',
      target: '@everyone',
      allow: '0',
      deny: '1024',
      risk: 'safe',
      description: `Overwrite ${i}`,
    });
  for (let i = 0; i < 50; i++)
    changes.push({
      kind: 'message.deploy',
      key: `message:m${i}`,
      channelKey: 'channel:welcome',
      panel: 'welcome',
      risk: 'safe',
      description: `Post the panel number ${i} with plenty of words in the description`,
    });
  return changes;
}

describe('/setup renderPreview', () => {
  it('stays within every Discord embed limit for a very large preview', () => {
    const findings: setup.Finding[] = Array.from({ length: 200 }, (_, i) => ({
      level: i % 3 === 0 ? 'info' : i % 3 === 1 ? 'warning' : 'blocking',
      code: 'x',
      message: `Finding ${i}: ${'detail '.repeat(20)}`,
    }));
    const embeds = renderPreview(
      preview(
        {
          changes: hugePlan(),
          findings,
          missingBotPermissions: Array.from({ length: 60 }, (_, i) => `Permission${i}`),
          blocked: true,
        },
        { requiresDisruptiveConsent: true },
      ),
    );
    expect(embeds.length).toBeGreaterThan(0);
    expect(embeds.length).toBeLessThanOrEqual(10);
    expect(embeds.reduce((n, e) => n + embedLength(e), 0)).toBeLessThanOrEqual(EMBED_TOTAL_LIMIT);
    for (const e of embeds) {
      expect((e.description ?? '').length).toBeLessThanOrEqual(4096);
      expect((e.title ?? '').length).toBeLessThanOrEqual(256);
      expect((e.fields ?? []).length).toBeLessThanOrEqual(25);
      for (const f of e.fields ?? []) {
        expect(f.value.length).toBeLessThanOrEqual(1024);
        expect(f.name.length).toBeLessThanOrEqual(256);
      }
    }
    const text = JSON.stringify(embeds);
    expect(text).toMatch(/\+\d+ more/); // truncated lists say how much is hidden
    expect(text).toContain('Setup cannot run yet');
    // Nothing important is dropped to fit: channels and the blocking findings survive.
    expect(embeds.map((e) => e.title)).toEqual([
      'Server setup preview',
      'Channels by category',
      'Conflicts and findings',
    ]);
    expect(embeds[2]!.description!.startsWith('⛔')).toBe(true);
    expect(embeds[2]!.fields?.[0]?.name).toBe('Missing bot permissions');
  });

  it('groups channels by blueprint category and lists blocking findings first', () => {
    const [cat] = setup.BLUEPRINT_CATEGORIES;
    const embeds = renderPreview(
      preview({
        changes: [
          {
            kind: 'channel.create',
            key: setup.channelKey(cat!.channels[0]!.key),
            name: 'x',
            channelType: 'text',
            parentKey: setup.categoryKey(cat!.key),
            risk: 'safe',
            description: 'Create #welcome',
          },
        ],
        findings: [
          { level: 'info', code: 'i', message: 'just info' },
          { level: 'blocking', code: 'b', message: 'must fix' },
        ],
      }),
    );
    const channels = embeds.find((e) => e.title === 'Channels by category')!;
    expect(channels.fields![0]).toMatchObject({ name: cat!.name, value: '➕ Create #welcome' });
    const findings = embeds.find((e) => e.title === 'Conflicts and findings')!;
    expect(findings.description!.indexOf('must fix')).toBeLessThan(
      findings.description!.indexOf('just info'),
    );
  });

  it('says when nothing would change', () => {
    expect(JSON.stringify(renderPreview(preview()))).toContain('Nothing would change');
  });
});

describe('listValue', () => {
  it('keeps everything that fits and appends "+N more" for the rest', () => {
    expect(listValue(['a', 'b'])).toBe('a\nb');
    const v = listValue(
      Array.from({ length: 100 }, (_, i) => `line ${i}`),
      60,
    );
    expect(v.length).toBeLessThanOrEqual(60);
    expect(v).toMatch(/\+\d+ more$/);
    expect(listValue([])).toBe('None');
  });
});

describe('/setup controls', () => {
  it('component select lists every component, multi-select, min 1, all selected by default', () => {
    const row = buildComponentSelect('op_1');
    const menu = row.components[0]!;
    expect(menu.custom_id).toBe('setupwiz:select:op_1');
    expect(menu.min_values).toBe(1);
    expect(menu.options).toHaveLength(setup.COMPONENTS.length);
    expect(menu.max_values).toBe(setup.COMPONENTS.length);
    expect(menu.options.every((o) => o.default)).toBe(true);
    expect(menu.options.map((o) => o.value)).toEqual(setup.COMPONENTS.map((c) => c.key));
  });

  it('component select keeps a narrowed selection', () => {
    const menu = buildComponentSelect('op_1', ['roles', 'permissions']).components[0]!;
    expect(menu.options.filter((o) => o.default).map((o) => o.value)).toEqual(['roles', 'permissions']);
  });

  it('a blocked plan has no Confirm button', () => {
    const change = hugePlan()[0]!;
    const ok = buildControls(preview({ changes: [change] })).components;
    expect(ok.map((b) => ('custom_id' in b ? b.custom_id : ''))).toEqual([
      'setupwiz:confirm:op_123',
      'setupwiz:cancel:op_123',
    ]);
    const blocked = buildControls(preview({ changes: [change], blocked: true })).components;
    expect(blocked.map((b) => ('custom_id' in b ? b.custom_id : ''))).toEqual(['setupwiz:cancel:op_123']);
  });

  it('the disruptive confirmation names the count and uses confirm2', () => {
    const p = preview(
      {},
      { summary: { create: 0, adopt: 0, update: 3, permissions: 0, messages: 0, disruptive: 3 } },
    );
    const c = buildDisruptiveConfirm(p);
    expect(c.content).toContain('**3** things members already use');
    expect(JSON.stringify(c.components)).toContain('setupwiz:confirm2:op_123');
  });
});

describe('/setup status overview', () => {
  it('shows completion, missing/renamed resources, panels and the last operation', () => {
    const [e] = renderOverview({
      status: 'PARTIAL',
      blueprintVersion: 2,
      deployedBlueprintVersion: 1,
      completionPercent: 87.4,
      roles: [
        { key: 'a', name: 'Founder', state: 'present', discordId: '1' },
        { key: 'b', name: 'Support', state: 'missing', discordId: null },
      ],
      channels: [{ key: 'c', name: 'rules', category: 'START HERE', state: 'renamed', discordId: '2' }],
      panels: [{ key: 'duty-control', state: 'deployed', channelId: '3', messageId: '4' }],
      permissionFindings: [],
      outstanding: [{ level: 'warning', code: 'w', message: 'Bot role is too low' }],
      lastOperation: {
        id: 'op',
        type: 'START',
        status: 'PARTIAL',
        startedAt: '2026-10-25T10:00:00Z',
        completedAt: null,
      },
      lastVerifiedAt: null,
    });
    const text = JSON.stringify(e);
    expect(e!.description).toContain('**87%** complete');
    expect(text).toContain('Support (missing)');
    expect(text).toContain('rules · START HERE (renamed)');
    expect(text).not.toContain('Founder');
    expect(text).toContain('duty-control (deployed)');
    expect(text).toContain('Bot role is too low');
    expect(text).toContain('START · PARTIAL');
  });
});
