import { describe, expect, it } from 'vitest';
import { listTextDefinitions, runWithTextOverrides } from '../core/text';
import * as games from '../games';
import * as troubleshooting from './index';

const outcome = (findings: troubleshooting.Finding[] = []): troubleshooting.DiagnosisOutcome => ({
  recordId: 'rec1',
  game: 'minecraft',
  findings,
  supportUrl: null,
  expiresAt: new Date('2026-01-01T12:00:00Z'),
});

describe('troubleshooting texts', () => {
  it('registers the troubleshooting namespace', () => {
    const keys = listTextDefinitions().filter((d) => d.namespace === 'troubleshooting');
    expect(keys.length).toBeGreaterThanOrEqual(40);
    expect(keys.map((k) => k.key)).toContain('troubleshooting.noIssueTitle');
  });

  it('keeps the default wording', () => {
    const e = troubleshooting.diagnosisEmbed(outcome(), 'latest.log');
    expect(e.title).toBe('No known issue detected');
    expect(e.description).toContain('I checked **latest.log** against known minecraft problems');
    expect(e.footer?.text).toContain('never upload files containing passwords. Stored summary expires');
    expect(troubleshooting.supportText(null)).toBe('Still stuck? Please contact the support team.');
  });

  it('applies overrides at call time', () => {
    runWithTextOverrides(
      {
        'troubleshooting.noIssueTitle': 'Nothing found',
        'troubleshooting.searchNoResults': 'Nope: {query}',
        'troubleshooting.stillStuckButton': 'Help me',
        'troubleshooting.fileEmpty': 'Empty file!',
      },
      () => {
        expect(troubleshooting.diagnosisEmbed(outcome(), 'a.log').title).toBe('Nothing found');
        expect(troubleshooting.searchResultsEmbed('lag', [], 0).description).toBe('Nope: lag');
        const rows = troubleshooting.diagnosisComponents(outcome());
        expect(JSON.stringify(rows)).toContain('Help me');
        expect(() =>
          troubleshooting.validateAttachment({
            url: 'https://cdn.discordapp.com/attachments/1/2/a.log',
            name: 'a.log',
            size: 0,
          }),
        ).toThrow('Empty file!');
      },
    );
    // Outside the scope the default is back.
    expect(troubleshooting.diagnosisEmbed(outcome(), 'a.log').title).toBe('No known issue detected');
  });
});

describe('games texts', () => {
  it('registers the games namespace', () => {
    const keys = listTextDefinitions().filter((d) => d.namespace === 'games');
    expect(keys.length).toBeGreaterThanOrEqual(40);
    expect(keys.find((k) => k.key === 'games.liveDisabled')?.default).toBe(games.LIVE_DISABLED_MESSAGE);
  });

  it('keeps the default wording', () => {
    const e = games.portCheckEmbed({ hostname: 'mc.gynx.gg', port: 25565, result: 'open', latencyMs: 12 });
    expect(e.title).toBe('Port check · mc.gynx.gg:25565');
    expect(e.description).toContain('**Open — a TCP connection was accepted** · 12 ms');
  });

  it('applies overrides at call time', () => {
    runWithTextOverrides(
      {
        'games.portCheckTitle': 'Custom {host} / {port}',
        'games.portClosed': 'Shut',
        'games.developerField': 'Made by',
        'games.versionTitle': 'Version of {game}',
      },
      () => {
        const p = games.portCheckEmbed({ hostname: 'h.gynx.gg', port: 1, result: 'closed', latencyMs: null });
        expect(p.title).toBe('Custom h.gynx.gg / 1');
        expect(p.description).toContain('**Shut**');
        const info = games.gameInfoEmbed(games.getGame('minecraft'));
        expect(info.fields?.[0]?.name).toBe('Made by');
        const v = games.versionEmbed(games.getGame('minecraft'), {
          available: false,
          message: games.GamesText.versionUnavailable(),
        });
        expect(v.title).toBe('Version of Minecraft: Java Edition');
      },
    );
  });

  it('resolves live-check errors at call time', async () => {
    await runWithTextOverrides({ 'games.liveDisabled': 'Live checks off' }, async () => {
      await expect(games.resolveGameTarget('mc.gynx.gg', { allowedSuffixes: [] })).rejects.toThrow(
        'Live checks off',
      );
    });
  });
});
