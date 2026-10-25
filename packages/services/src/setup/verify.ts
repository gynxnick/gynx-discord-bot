import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import type { SetupResource } from '@gynx/database';
import { BLUEPRINT_ROLES, categoryKey, channelKey, roleKey } from './blueprint';
import { allChannels, type EffectiveBlueprint } from './config';
import type { DiscordAdminPort } from './port';
import type { Finding, GuildSnapshot, SnapshotChannel } from './types';

const VIEW = P.ViewChannel;
const SEND = P.SendMessages;

/**
 * Post-setup verification against the live server. Returns findings; the setup
 * is verified when none of them is above `info`.
 *
 * - every managed role/category/channel exists with its blueprint name
 * - private areas deny @everyone VIEW, and only blueprint roles (and the bot) are allowed in
 * - restricted channels deny VIEW to staff roles that are not designated
 * - the bot can see and post where it posts panels or logs
 * - the owner is never denied (owners bypass overwrites, but a deny is still reported)
 * - deployed panels/messages still exist
 */
export async function verifySetup(
  port: DiscordAdminPort,
  snapshot: GuildSnapshot,
  bp: EffectiveBlueprint,
  manifest: readonly SetupResource[],
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const byKey = new Map(manifest.map((m) => [m.blueprintKey, m]));
  const roles = new Map(snapshot.roles.map((r) => [r.id, r]));
  const chans = new Map(snapshot.channels.map((c) => [c.id, c]));
  const blueprintRoleIds = new Set(
    BLUEPRINT_ROLES.map((r) => byKey.get(roleKey(r.key))?.discordResourceId).filter(Boolean) as string[],
  );

  // Names / existence
  for (const role of bp.roles) {
    const m = byKey.get(roleKey(role.key));
    if (!m) continue;
    const cur = roles.get(m.discordResourceId);
    if (!cur)
      findings.push({
        level: 'warning',
        code: 'missing',
        key: m.blueprintKey,
        message: `Role ${role.name} is missing.`,
      });
    else if (cur.name !== role.name)
      findings.push({
        level: 'warning',
        code: 'renamed',
        key: m.blueprintKey,
        message: `Role ${role.name} is named "${cur.name}".`,
      });
  }

  const checkPrivate = (key: string, label: string, ch: SnapshotChannel) => {
    const everyone = ch.overwrites.find((o) => o.id === snapshot.guildId);
    if (!everyone || (everyone.deny & VIEW) === 0n || (everyone.allow & VIEW) !== 0n) {
      findings.push({
        level: 'warning',
        code: 'private-exposure',
        key,
        message: `${label} is private but @everyone is not denied View Channel.`,
      });
    }
    for (const o of ch.overwrites) {
      if (o.id === snapshot.guildId || o.id === snapshot.botUserId) continue;
      if ((o.allow & VIEW) === 0n) continue;
      if (o.type === 0 && blueprintRoleIds.has(o.id)) continue;
      if (o.type === 1 && o.id === snapshot.ownerId) continue;
      findings.push({
        level: 'warning',
        code: 'private-exposure',
        key,
        message: `${label} is private but ${o.type === 0 ? 'a role' : 'a member'} outside the blueprint (${o.id}) can view it.`,
      });
    }
  };

  const checkCommon = (key: string, label: string, ch: SnapshotChannel) => {
    const owner = ch.overwrites.find((o) => o.type === 1 && o.id === snapshot.ownerId);
    if (owner && (owner.deny & VIEW) !== 0n) {
      findings.push({
        level: 'warning',
        code: 'owner-lockout',
        key,
        message: `${label} denies the server owner View Channel (owners bypass it, but remove the overwrite).`,
      });
    }
  };

  for (const cat of bp.categories) {
    const m = byKey.get(categoryKey(cat.key));
    if (m) {
      const cur = chans.get(m.discordResourceId);
      if (!cur) {
        if (cat.included)
          findings.push({
            level: 'warning',
            code: 'missing',
            key: m.blueprintKey,
            message: `Category ${cat.name} is missing.`,
          });
      } else {
        if (cur.name !== cat.name)
          findings.push({
            level: 'warning',
            code: 'renamed',
            key: m.blueprintKey,
            message: `Category ${cat.name} is named "${cur.name}".`,
          });
        if (cat.private) checkPrivate(m.blueprintKey, `Category ${cat.name}`, cur);
        checkCommon(m.blueprintKey, `Category ${cat.name}`, cur);
      }
    }
  }

  const hasAdmin = (snapshot.botPermissions & P.Administrator) !== 0n;
  for (const ch of allChannels(bp)) {
    const m = byKey.get(channelKey(ch.key));
    if (!m) continue;
    const cur = chans.get(m.discordResourceId);
    const label = `Channel ${ch.name}`;
    if (!cur) {
      if (ch.included)
        findings.push({
          level: 'warning',
          code: 'missing',
          key: m.blueprintKey,
          message: `${label} is missing.`,
        });
      continue;
    }
    if (cur.name !== ch.name)
      findings.push({
        level: 'warning',
        code: 'renamed',
        key: m.blueprintKey,
        message: `${label} is named "${cur.name}".`,
      });
    if (ch.private) checkPrivate(m.blueprintKey, label, cur);
    checkCommon(m.blueprintKey, label, cur);

    if (ch.restricted) {
      for (const [target, want] of ch.overwrites) {
        if (target === '@everyone' || target === 'self' || (want.deny & VIEW) === 0n) continue;
        const rid = byKey.get(roleKey(target))?.discordResourceId;
        if (!rid || !roles.has(rid)) continue;
        const o = cur.overwrites.find((x) => x.id === rid);
        if (!o || (o.deny & VIEW) === 0n) {
          findings.push({
            level: 'warning',
            code: 'restricted-access',
            key: m.blueprintKey,
            message: `${label} is restricted, but role ${target} is not denied View Channel.`,
          });
        }
      }
    }

    const botPosts = ch.type === 'text' && (ch.panel || ch.bindings.length > 0);
    if (botPosts && !hasAdmin) {
      const self = cur.overwrites.find((o) => o.id === snapshot.botUserId);
      const everyone = cur.overwrites.find((o) => o.id === snapshot.guildId);
      const selfOk = self && (self.allow & (VIEW | SEND)) === (VIEW | SEND);
      const selfDenied = self && (self.deny & (VIEW | SEND)) !== 0n;
      const everyoneBlocks = everyone && (everyone.deny & (VIEW | SEND)) !== 0n;
      const guildOk = (snapshot.botPermissions & (VIEW | SEND)) === (VIEW | SEND);
      if (!selfOk && (selfDenied || everyoneBlocks || !guildOk)) {
        findings.push({
          level: 'warning',
          code: 'bot-access',
          key: m.blueprintKey,
          message: `The bot cannot see or post in ${ch.name}.`,
        });
      }
    }
  }

  // Panels / messages
  for (const m of manifest) {
    if (m.resourceType !== 'MESSAGE' || !m.channelId) continue;
    let exists = false;
    try {
      exists = await port.messageExists(m.channelId, m.discordResourceId);
    } catch {
      exists = false;
    }
    if (!exists)
      findings.push({
        level: 'warning',
        code: 'panel-missing',
        key: m.blueprintKey,
        message: `The ${m.blueprintKey.replace('message:', '')} message is missing.`,
      });
  }

  return findings;
}

export const isVerified = (findings: readonly Finding[]) => findings.every((f) => f.level === 'info');
