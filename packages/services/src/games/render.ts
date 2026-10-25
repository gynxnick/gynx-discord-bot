import type { APIEmbed } from 'discord-api-types/v10';
import { EMBED_COLORS, discordTimestamp, neutraliseMentions, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import type { PortCheckOutcome, ServerQueryResult } from './live';
import { steamStoreUrl, type SteamNewsItem, type VersionInfo } from './metadata';
import { GamesText as T } from './texts';
import type { GameAdapter } from './types';

const queriedFooter = () => T.queriedFooter({ infoOnly: T.infoOnlyFooter() });

export function gameInfoEmbed(g: GameAdapter): APIEmbed {
  return brandEmbed({
    title: g.name,
    url: g.officialSite,
    description: g.notes.map((n) => `• ${n}`).join('\n'),
    fields: [
      { name: T.developerField(), value: g.developer, inline: true },
      { name: T.defaultPortField(), value: `${g.defaultPort}/${g.protocol}`, inline: true },
      {
        name: T.liveQueryField(),
        value:
          g.queryProtocol === 'minecraft-slp'
            ? T.liveQuerySlp()
            : g.queryProtocol === 'a2s'
              ? T.liveQueryA2s()
              : T.liveQueryNone(),
        inline: true,
      },
      {
        name: T.typicalPortsField(),
        value: g.typicalPorts.map((p) => `\`${p.port}/${p.proto}\` ${p.purpose}`).join('\n'),
      },
      {
        name: T.linksField(),
        value: [
          `[${T.officialSiteLink()}](${g.officialSite})`,
          ...(g.steamAppId ? [`[${T.steamStoreLink()}](${steamStoreUrl(g.steamAppId)})`] : []),
          ...g.docsLinks.map((d) => `[${d.label}](${d.url})`),
        ].join('\n'),
      },
    ],
    footer: T.infoOnlyFooter(),
  });
}

export function versionEmbed(g: GameAdapter, v: VersionInfo): APIEmbed {
  if (!v.available)
    return brandEmbed({
      title: T.versionTitle({ game: g.name }),
      description: v.message,
      color: EMBED_COLORS.neutral,
    });
  if (v.kind === 'minecraft') {
    return brandEmbed({
      title: T.versionTitle({ game: g.name }),
      fields: [
        {
          name: T.latestReleaseField(),
          value: `\`${v.release}\`${v.releaseTime ? ` · ${discordTimestamp(v.releaseTime, 'D')}` : ''}`,
          inline: true,
        },
        {
          name: T.latestSnapshotField(),
          value: v.snapshot ? `\`${v.snapshot}\`` : T.notApplicable(),
          inline: true,
        },
      ],
      footer: T.mojangSourceFooter(),
    });
  }
  return brandEmbed({
    title: T.newsTitle({ game: g.name }),
    description:
      `${T.newsIntro()}\n\n` +
      `**${neutraliseMentions(v.news.title)}** · ${discordTimestamp(v.news.date, 'D')}` +
      (v.news.url ? `\n${v.news.url}` : ''),
    fields: [{ name: T.steamStoreField(), value: v.storeUrl }],
    footer: T.steamNewsSourceFooter(),
  });
}

export function steamEmbed(g: GameAdapter, news: SteamNewsItem | null): APIEmbed {
  const store = g.steamAppId ? steamStoreUrl(g.steamAppId) : null;
  return brandEmbed({
    title: T.steamTitle({ game: g.name }),
    url: store ?? undefined,
    description: !store
      ? T.notOnSteam({ game: g.name, site: g.officialSite })
      : news
        ? `${T.latestNews({ title: neutraliseMentions(news.title) })}\n${discordTimestamp(news.date, 'D')}${news.feedLabel ? ` · ${news.feedLabel}` : ''}${news.url ? `\n${news.url}` : ''}`
        : T.newsUnavailable(),
    fields: store ? [{ name: T.storePageField(), value: store }] : [],
    footer: T.steamApiSourceFooter(),
  });
}

/** Never includes the resolved IP — hostname only. */
export function serverStatusEmbed(r: ServerQueryResult): APIEmbed {
  const i = r.info;
  if (!i.available) {
    return brandEmbed({
      title: T.serverTitle({ game: r.gameName, host: r.hostname }),
      description: i.unavailableReason ?? T.liveUnavailable(),
      color: EMBED_COLORS.neutral,
      footer: queriedFooter(),
    });
  }
  const players =
    i.playersOnline !== null
      ? `${i.playersOnline}${i.playersMax !== null ? ` / ${i.playersMax}` : ''}`
      : T.unknownValue();
  return brandEmbed({
    title: T.serverTitle({ game: r.gameName, host: r.hostname }),
    description: i.motd
      ? truncate(neutraliseMentions(i.motd), 500)
      : i.name
        ? truncate(neutraliseMentions(i.name), 200)
        : undefined,
    color: EMBED_COLORS.success,
    fields: [
      { name: T.playersField(), value: players, inline: true },
      {
        name: T.versionField(),
        value: i.version ? `\`${truncate(i.version, 60)}\`` : T.unknownValue(),
        inline: true,
      },
      ...(i.protocol !== null && r.gameId === 'minecraft'
        ? [{ name: T.protocolField(), value: String(i.protocol), inline: true }]
        : []),
      ...(i.map
        ? [{ name: T.mapField(), value: truncate(neutraliseMentions(i.map), 100), inline: true }]
        : []),
      ...(i.latencyMs !== null
        ? [{ name: T.responseTimeField(), value: T.latencyValue({ ms: i.latencyMs }), inline: true }]
        : []),
      { name: T.queryPortField(), value: String(i.queryPort), inline: true },
    ],
    footer: queriedFooter(),
  });
}

/** Resolved at render time so server overrides apply. */
const portLabel = (result: PortCheckOutcome['result']): string =>
  ({
    open: T.portOpen,
    closed: T.portClosed,
    timeout: T.portTimeout,
    unreachable: T.portUnreachable,
  })[result]();

export function portCheckEmbed(o: PortCheckOutcome): APIEmbed {
  return brandEmbed({
    title: T.portCheckTitle({ host: o.hostname, port: o.port }),
    color:
      o.result === 'open'
        ? EMBED_COLORS.success
        : o.result === 'closed'
          ? EMBED_COLORS.danger
          : EMBED_COLORS.warning,
    description:
      `**${portLabel(o.result)}**${o.latencyMs !== null ? ` · ${T.latencyValue({ ms: o.latencyMs })}` : ''}\n\n` +
      T.portCheckExplainer(),
    footer: T.infoOnlyFooter(),
  });
}
