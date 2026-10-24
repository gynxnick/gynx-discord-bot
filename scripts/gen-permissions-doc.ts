/**
 * Regenerates the permission matrix section of docs/permissions.md from the
 * source of truth in @gynx/permissions.   Usage: pnpm docs:permissions
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_PERMISSIONS,
  COMMAND_POLICIES,
  PERMISSIONS,
  PRESET_PERMISSIONS,
  PRIVILEGED_PERMISSIONS,
  ROLE_PRESETS,
} from '@gynx/permissions';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const file = resolve(root, 'docs/permissions.md');
const START = '<!-- generated:start -->';
const END = '<!-- generated:end -->';

const short: Record<string, string> = {
  OWNER: 'Own',
  ADMINISTRATOR: 'Adm',
  SENIOR_STAFF: 'Snr',
  SUPPORT_STAFF: 'Sup',
  MODERATOR: 'Mod',
  MARKETING_STAFF: 'Mkt',
  ANALYST: 'Ana',
};

const lines: string[] = [];
lines.push('### Permission keys by preset', '');
lines.push(`| Key | Description | ${ROLE_PRESETS.map((p) => short[p]).join(' | ')} |`);
lines.push(`|---|---|${ROLE_PRESETS.map(() => ':-:').join('|')}|`);
for (const key of ALL_PERMISSIONS) {
  const priv = PRIVILEGED_PERMISSIONS.includes(key) ? ' 🔒' : '';
  const cells = ROLE_PRESETS.map((p) => (PRESET_PERMISSIONS[p].includes(key) ? '✓' : ''));
  lines.push(`| \`${key}\`${priv} | ${PERMISSIONS[key]} | ${cells.join(' | ')} |`);
}
lines.push(
  '',
  `Legend: ${ROLE_PRESETS.map((p) => `${short[p]} = ${p}`).join(', ')}. 🔒 = privileged (never grantable to the partner role).`,
  '',
);
lines.push('### Slash command requirements', '');
lines.push('| Command | Required permission | Discord default visibility | Rate limit (per user) |');
lines.push('|---|---|---|---|');
for (const [name, p] of Object.entries(COMMAND_POLICIES).sort(([a], [b]) => a.localeCompare(b))) {
  const rl = p.rateLimit ? `${p.rateLimit[0]} / ${p.rateLimit[1]}s` : '—';
  lines.push(
    `| \`/${name}\` | ${p.permission ? `\`${p.permission}\`` : 'any member*'} | ${p.discordDefault ?? 'everyone'} | ${rl} |`,
  );
}
lines.push(
  '',
  '\\* Object-level checks still apply inside the service (e.g. only your own records; staff-only subcommands).',
);

const doc = readFileSync(file, 'utf8');
const before = doc.slice(0, doc.indexOf(START) + START.length);
const after = doc.slice(doc.indexOf(END));
writeFileSync(file, `${before}\n${lines.join('\n')}\n${after}`);
console.log(`Updated ${file}`);
