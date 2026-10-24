import type { APIEmbed } from 'discord.js';
import { brandEmbed, community } from '@gynx/services';

/** Static, categorised overview of every command the bot offers. */
export const HELP_SECTIONS: ReadonlyArray<{ name: string; lines: string[] }> = [
  {
    name: 'General',
    lines: [
      '`/help` · this overview',
      '`/about` · about the GYNX.GG bot',
      '`/faq` · search frequently asked questions',
      '`/guides` · browse setup and how-to guides',
      '`/rules` · read and accept the server rules',
      '`/roles` · pick game and notification roles',
    ],
  },
  {
    name: 'Status',
    lines: [
      '`/status` · current service status',
      '`/uptime` · recent uptime',
      '`/incidents` · recent incidents',
      '`/subscribe-status` · status alerts',
    ],
  },
  {
    name: 'Moderation (staff)',
    lines: [
      '`/warn` · `/warnings` · `/timeout` · `/kick` · `/ban`',
      '`/appeal` · appeal a moderation action (members)',
    ],
  },
  {
    name: 'Troubleshooting',
    lines: [
      '`/troubleshoot` · guided troubleshooting',
      '`/diagnose` · run safe diagnostics',
      '`/knowledge-search` · search the knowledge base',
    ],
  },
  {
    name: 'Game utilities',
    lines: ['`/gameinfo` · `/version` · `/playercount`', '`/minecraft` · `/steam` · `/portcheck`'],
  },
  {
    name: 'Security',
    lines: [
      '`/report-abuse` · privately report spam, scams or abuse',
      '`/audit-log` · security audit log (staff)',
    ],
  },
  {
    name: 'Community',
    lines: [
      '`/event` · community events',
      '`/suggest` · share a suggestion',
      '`/poll` · `/giveaway` (staff)',
    ],
  },
  {
    name: 'Marketing',
    lines: [
      '`/referral` · referral links',
      '`/partners` · partner programme',
      '`/announce` · `/schedule-announcement` (staff)',
    ],
  },
  {
    name: 'Analytics',
    lines: ['`/analytics` · `/staff-stats` (staff)'],
  },
];

export function helpEmbed(supportUrl: string | null): APIEmbed {
  return brandEmbed({
    title: 'GYNX.GG bot commands',
    description:
      'Some commands are only available to staff. Commands may be unavailable if a module is turned off on this server.',
    fields: [
      ...HELP_SECTIONS.map((s) => ({ name: s.name, value: s.lines.join('\n') })),
      { name: 'Support', value: community.supportLine(supportUrl) },
    ],
  });
}
