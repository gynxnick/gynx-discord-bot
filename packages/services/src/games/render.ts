import type { APIEmbed } from 'discord-api-types/v10';
import { EMBED_COLORS, discordTimestamp, neutraliseMentions, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import type { PortCheckOutcome, ServerQueryResult } from './live';
import { steamStoreUrl, type SteamNewsItem, type VersionInfo } from './metadata';
import type { GameAdapter } from './types';

const INFO_ONLY = 'Information only — GYNX bot never controls game servers.';

export function gameInfoEmbed(g: GameAdapter): APIEmbed {
  return brandEmbed({
    title: g.name,
    url: g.officialSite,
    description: g.notes.map((n) => `• ${n}`).join('\n'),
    fields: [
      { name: 'Developer', value: g.developer, inline: true },
      { name: 'Default port', value: `${g.defaultPort}/${g.protocol}`, inline: true },
      { name: 'Live query', value: g.queryProtocol === 'minecraft-slp' ? 'Server List Ping' : g.queryProtocol === 'a2s' ? 'Steam A2S' : 'Not available', inline: true },
      { name: 'Typical ports', value: g.typicalPorts.map((p) => `\`${p.port}/${p.proto}\` ${p.purpose}`).join('\n') },
      {
        name: 'Links',
        value: [`[Official site](${g.officialSite})`, ...(g.steamAppId ? [`[Steam store](${steamStoreUrl(g.steamAppId)})`] : []), ...g.docsLinks.map((d) => `[${d.label}](${d.url})`)].join('\n'),
      },
    ],
    footer: INFO_ONLY,
  });
}

export function versionEmbed(g: GameAdapter, v: VersionInfo): APIEmbed {
  if (!v.available) return brandEmbed({ title: `${g.name} · latest version`, description: v.message, color: EMBED_COLORS.neutral });
  if (v.kind === 'minecraft') {
    return brandEmbed({
      title: `${g.name} · latest version`,
      fields: [
        { name: 'Latest release', value: `\`${v.release}\`${v.releaseTime ? ` · ${discordTimestamp(v.releaseTime, 'D')}` : ''}`, inline: true },
        { name: 'Latest snapshot', value: v.snapshot ? `\`${v.snapshot}\`` : 'n/a', inline: true },
      ],
      footer: 'Source: Mojang version manifest · cached up to 10 minutes',
    });
  }
  return brandEmbed({
    title: `${g.name} · latest update news`,
    description:
      `Steam does not publish a version number for this game, so here is the most recent official news post:\n\n` +
      `**${neutraliseMentions(v.news.title)}** · ${discordTimestamp(v.news.date, 'D')}` +
      (v.news.url ? `\n${v.news.url}` : ''),
    fields: [{ name: 'Steam store', value: v.storeUrl }],
    footer: 'Source: Steam news · cached up to 10 minutes',
  });
}

export function steamEmbed(g: GameAdapter, news: SteamNewsItem | null): APIEmbed {
  const store = g.steamAppId ? steamStoreUrl(g.steamAppId) : null;
  return brandEmbed({
    title: `${g.name} on Steam`,
    url: store ?? undefined,
    description: !store
      ? `${g.name} is not distributed through Steam. See ${g.officialSite}`
      : news
        ? `**Latest news:** ${neutraliseMentions(news.title)}\n${discordTimestamp(news.date, 'D')}${news.feedLabel ? ` · ${news.feedLabel}` : ''}${news.url ? `\n${news.url}` : ''}`
        : 'Latest news is currently unavailable.',
    fields: store ? [{ name: 'Store page', value: store }] : [],
    footer: 'Source: Steam Web API (public) · cached up to 10 minutes',
  });
}

/** Never includes the resolved IP — hostname only. */
export function serverStatusEmbed(r: ServerQueryResult): APIEmbed {
  const i = r.info;
  if (!i.available) {
    return brandEmbed({
      title: `${r.gameName} · ${r.hostname}`,
      description: i.unavailableReason ?? 'Live data is unavailable.',
      color: EMBED_COLORS.neutral,
      footer: `${INFO_ONLY} Queried from the bot's network.`,
    });
  }
  const players = i.playersOnline !== null ? `${i.playersOnline}${i.playersMax !== null ? ` / ${i.playersMax}` : ''}` : 'unknown';
  return brandEmbed({
    title: `${r.gameName} · ${r.hostname}`,
    description: i.motd ? truncate(neutraliseMentions(i.motd), 500) : i.name ? truncate(neutraliseMentions(i.name), 200) : undefined,
    color: EMBED_COLORS.success,
    fields: [
      { name: 'Players', value: players, inline: true },
      { name: 'Version', value: i.version ? `\`${truncate(i.version, 60)}\`` : 'unknown', inline: true },
      ...(i.protocol !== null && r.gameId === 'minecraft' ? [{ name: 'Protocol', value: String(i.protocol), inline: true }] : []),
      ...(i.map ? [{ name: 'Map', value: truncate(neutraliseMentions(i.map), 100), inline: true }] : []),
      ...(i.latencyMs !== null ? [{ name: 'Response time', value: `${i.latencyMs} ms`, inline: true }] : []),
      { name: 'Query port', value: String(i.queryPort), inline: true },
    ],
    footer: `${INFO_ONLY} Queried from the bot's network.`,
  });
}

const PORT_LABEL: Record<PortCheckOutcome['result'], string> = {
  open: 'Open — a TCP connection was accepted',
  closed: 'Closed — the connection was refused',
  timeout: 'Timed out — no answer within 3 seconds (filtered or offline)',
  unreachable: 'Unreachable — the network path to the host failed',
};

export function portCheckEmbed(o: PortCheckOutcome): APIEmbed {
  return brandEmbed({
    title: `Port check · ${o.hostname}:${o.port}`,
    color: o.result === 'open' ? EMBED_COLORS.success : o.result === 'closed' ? EMBED_COLORS.danger : EMBED_COLORS.warning,
    description:
      `**${PORT_LABEL[o.result]}**${o.latencyMs !== null ? ` · ${o.latencyMs} ms` : ''}\n\n` +
      'This tests TCP reachability from the bot’s network only — results from your own network may differ. ' +
      'Many game ports (Rust, Valheim, Palworld) are UDP and cannot be tested this way; use `/playercount` for those.',
    footer: INFO_ONLY,
  });
}
