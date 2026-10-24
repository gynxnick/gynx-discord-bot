import { isIP } from 'node:net';
import { redactSecrets, truncate } from '@gynx/shared';

/**
 * Deterministic log analyzers. Pure functions over ALREADY-REDACTED lines:
 * `diagnoseText` redacts credentials and IP addresses first, and only the
 * redacted text is ever seen by analyzers, stored, or shown.
 *
 * Findings describe a *likely* cause, never a confirmed diagnosis.
 */

export type Confidence = 'likely' | 'possible';

export interface Finding {
  id: string;
  title: string;
  confidence: Confidence;
  /** Always phrased as a likely cause, not a confirmed diagnosis. */
  explanation: string;
  /** Short, redacted excerpt of the matching line. */
  evidence: string;
  articleSlug?: string;
}

interface Hit {
  confidence: Confidence;
  explanation: string;
  evidence: string;
}

interface Analyzer {
  id: string;
  title: string;
  scope: 'minecraft' | 'generic';
  articleSlug?: string | ((game: string) => string | undefined);
  run(lines: readonly string[]): Hit | null;
}

const MAX_EVIDENCE = 200;
export const MAX_EXCERPT = 1500;
const MAX_LINES = 50_000;
const DISCLAIMER = 'This is a likely cause based on known log patterns, not a confirmed diagnosis.';

const ev = (line: string) => truncate(line.trim().replace(/\s+/g, ' '), MAX_EVIDENCE);

function find(lines: readonly string[], re: RegExp): { index: number; line: string; m: RegExpMatchArray } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(re);
    if (m) return { index: i, line: lines[i]!, m };
  }
  return null;
}

const javaForClassVersion = (major: number) => (major >= 49 ? major - 44 : null);

const MINECRAFT_ANALYZERS: Analyzer[] = [
  {
    id: 'mc-java-version',
    title: 'Wrong Java version',
    scope: 'minecraft',
    articleSlug: 'minecraft-java-version',
    run(lines) {
      const hit =
        find(lines, /UnsupportedClassVersionError.*class file version (\d+)(?:\.\d+)?.*?up to (\d+)(?:\.\d+)?/) ??
        find(lines, /class file version (\d+)\.\d+/) ??
        find(lines, /Unsupported class file major version (\d+)/) ??
        find(lines, /UnsupportedClassVersionError/);
      if (!hit) return null;
      const needed = hit.m[1] ? javaForClassVersion(Number(hit.m[1])) : null;
      const have = hit.m[2] ? javaForClassVersion(Number(hit.m[2])) : null;
      const detail = needed
        ? `Something on this server was built for Java ${needed}${have ? `, but it is running on Java ${have}` : ', which is newer than the Java runtime in use'}.`
        : 'A component was compiled for a newer Java version than the one running the server.';
      return {
        confidence: 'likely',
        explanation: `${detail} Switch the server to Java ${needed ?? 'the version your Minecraft version requires'} (or newer). ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'mc-out-of-memory',
    title: 'Server ran out of memory',
    scope: 'minecraft',
    articleSlug: 'minecraft-out-of-memory',
    run(lines) {
      const hit = find(lines, /java\.lang\.OutOfMemoryError(?::\s*(.+))?/);
      if (!hit) return null;
      const kind = hit.m[1]?.trim();
      return {
        confidence: 'likely',
        explanation:
          `The Java process ran out of memory${kind ? ` (${truncate(kind, 60)})` : ''}. Common causes are too little memory allocated (-Xmx), too many/heavy mods, or a memory leak in a plugin or mod. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'mc-missing-dependencies',
    title: 'Missing or incompatible mod dependencies',
    scope: 'minecraft',
    articleSlug: 'minecraft-mod-plugin-conflicts',
    run(lines) {
      const forge = find(lines, /Missing or unsupported mandatory dependencies|Missing Mods:/);
      if (forge) {
        const mods = new Set<string>();
        for (const l of lines.slice(forge.index + 1, forge.index + 15)) {
          const m = l.match(/Mod ID:\s*'([\w.-]+)'(?:,\s*Requested by:\s*'([\w.-]+)')?/);
          if (m) mods.add(m[2] ? `${m[1]} (needed by ${m[2]})` : m[1]!);
        }
        return {
          confidence: 'likely',
          explanation: `Forge/NeoForge reported mods that are missing or the wrong version${mods.size ? `: ${[...mods].slice(0, 5).join(', ')}` : ''}. Install the listed dependency versions or remove the mod that needs them. ${DISCLAIMER}`,
          evidence: ev(forge.line),
        };
      }
      const fabric = find(lines, /Mod '([^']+)' \(([\w.-]+)\)[^\n]*?requires (?:any version|version [^\s]+(?: or later)?) of (?:mod )?'?([^,'!(]+)/);
      if (fabric) {
        const [, modName, , dep] = fabric.m;
        return {
          confidence: 'likely',
          explanation: `Fabric reports that "${truncate(modName ?? 'a mod', 60)}" requires "${truncate((dep ?? 'another mod').trim(), 60)}", which is missing or the wrong version. Install a compatible version of the dependency or remove the mod. ${DISCLAIMER}`,
          evidence: ev(fabric.line),
        };
      }
      const incompatible = find(lines, /Incompatible mods? (?:found|set)!/);
      if (incompatible) {
        return {
          confidence: 'possible',
          explanation: `The mod loader reported an incompatible mod set. Check the lines below it for the mods involved. ${DISCLAIMER}`,
          evidence: ev(incompatible.line),
        };
      }
      return null;
    },
  },
  {
    id: 'mc-mixin-failure',
    title: 'Mod conflict (Mixin failed to apply)',
    scope: 'minecraft',
    articleSlug: 'minecraft-mod-plugin-conflicts',
    run(lines) {
      const hit =
        find(lines, /Mixin apply for mod ([\w.-]+) failed/) ??
        find(lines, /Mixin apply failed ([\w.-]+?)\.mixins?\.json/) ??
        find(lines, /(?:InvalidInjectionException|InvalidMixinException|MixinApplyError).*?from mod ([\w.-]+)/) ??
        find(lines, /MixinTransformerError|MixinApplyError|InvalidInjectionException/);
      if (!hit) return null;
      const mod = hit.m[1];
      return {
        confidence: mod ? 'likely' : 'possible',
        explanation: `${mod ? `The mod "${truncate(mod, 60)}"` : 'A mod'} failed to patch the game (Mixin). This usually means the mod is built for a different Minecraft/loader version or conflicts with another mod. Update or remove it and test again. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'mc-port-in-use',
    title: 'Server port already in use',
    scope: 'minecraft',
    articleSlug: 'minecraft-port-in-use',
    run(lines) {
      const hit = find(lines, /FAILED TO BIND TO PORT/i) ?? find(lines, /BindException: Address already in use/);
      if (!hit) return null;
      const assign = find(lines, /Cannot assign requested address/);
      return {
        confidence: 'likely',
        explanation: assign
          ? `The server could not bind its address. The \`server-ip\` setting probably points to an address this machine does not have — usually it should be left empty. ${DISCLAIMER}`
          : `Another process (often a previous instance of the server that is still running) is already using the server port. Stop the other instance or change \`server-port\`. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'mc-eula',
    title: 'Minecraft EULA not accepted',
    scope: 'minecraft',
    articleSlug: 'minecraft-eula',
    run(lines) {
      const hit = find(lines, /You need to agree to the EULA in order to run the server/i);
      if (!hit) return null;
      return {
        confidence: 'likely',
        explanation: `The server stopped because the Minecraft EULA has not been accepted. Read the EULA and set \`eula=true\` in eula.txt if you agree. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'mc-corrupted-chunk',
    title: 'Possible corrupted world chunk/region',
    scope: 'minecraft',
    articleSlug: 'minecraft-world-corruption',
    run(lines) {
      const hit =
        find(lines, /Couldn'?t (?:load|read) chunk|Failed to (?:read|load) chunk|Error reading chunk|Invalid chunk/i) ??
        find(lines, /Chunk file at \[[^\]]+\] is in the wrong location/i) ??
        find(lines, /region file .*(?:truncated|corrupt)|Exception reading .*\.mca|r\.-?\d+\.-?\d+\.mca.*(?:corrupt|truncated|invalid)/i);
      if (!hit) return null;
      return {
        confidence: 'possible',
        explanation: `The server had trouble reading part of the world. This can mean a corrupted chunk or region file (often after a crash or an unclean shutdown). Restore from a backup before trying repair tools. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'mc-ticking-entity',
    title: 'Crash while ticking an entity or block entity',
    scope: 'minecraft',
    articleSlug: 'minecraft-world-corruption',
    run(lines) {
      const hit = find(lines, /Ticking (?:block )?entity|Entity being ticked|Block entity being ticked/i);
      if (!hit) return null;
      const typeLine = find(lines, /Entity Type: ([\w:.-]+)|Name: ([\w:.-]+) \/\/ /);
      const type = typeLine?.m[1] ?? typeLine?.m[2];
      return {
        confidence: 'likely',
        explanation: `The server crashed while updating ${type ? `"${truncate(type, 60)}"` : 'a specific entity or block entity'}. Usually a mod/plugin bug or a broken entity in the world. The crash report's "Entity's Exact location" shows where it is; removing that entity or updating the related mod typically helps. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'mc-plugin-load',
    title: 'Plugin failed to load',
    scope: 'minecraft',
    articleSlug: 'minecraft-mod-plugin-conflicts',
    run(lines) {
      const hit = find(lines, /Could not load '(plugins[\\/][^']+?\.jar)'/);
      if (!hit) return null;
      const file = hit.m[1]!.replace(/^plugins[\\/]/, '');
      const after = lines.slice(hit.index, hit.index + 6).join('\n');
      const dep = after.match(/Unknown\/missing dependency plugins: \[([^\]]+)\]|UnknownDependencyException:\s*([^\n]+)/);
      const api = /Unsupported API version|InvalidPluginException.*api-version/i.test(after);
      const reason = dep
        ? ` It is missing a required plugin: ${truncate((dep[1] ?? dep[2] ?? '').trim(), 80)}.`
        : api
          ? ' It was built for a different server API version.'
          : '';
      return {
        confidence: 'likely',
        explanation: `The plugin "${truncate(file, 80)}" could not be loaded.${reason} Check that the plugin supports your server version and that its dependencies are installed. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'mc-cant-keep-up',
    title: 'Server lag ("Can\'t keep up!")',
    scope: 'minecraft',
    articleSlug: 'minecraft-server-lag',
    run(lines) {
      let count = 0;
      let worst = 0;
      let worstLine = '';
      for (const l of lines) {
        const m = l.match(/Can't keep up! Is the server overloaded\? Running (\d+)ms or (\d+) ticks behind/);
        if (m) {
          count++;
          const ms = Number(m[1]);
          if (ms >= worst) {
            worst = ms;
            worstLine = l;
          }
        }
      }
      if (count === 0) return null;
      return {
        confidence: count >= 5 || worst >= 10_000 ? 'likely' : 'possible',
        explanation: `The server fell behind ${count} time${count === 1 ? '' : 's'} (worst: ${worst} ms). Occasional warnings during startup are normal; frequent ones point to heavy farms/entities, too many chunks loaded, or a resource-hungry plugin/mod. A profiler such as spark helps pinpoint it. ${DISCLAIMER}`,
        evidence: ev(worstLine),
      };
    },
  },
  {
    id: 'mc-version-mismatch',
    title: 'Client/server version mismatch',
    scope: 'minecraft',
    articleSlug: 'minecraft-version-mismatch',
    run(lines) {
      const hit = find(lines, /Outdated (?:server|client)!|Incompatible client! Please use|Incompatible FML modded server|Server is running a different version/i);
      if (!hit) return null;
      return {
        confidence: 'likely',
        explanation: `The client and server are running different Minecraft versions. Use the exact version the server runs (shown in the multiplayer list or /version). ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
];

const CONNECT_ARTICLES: Record<string, string> = {
  minecraft: 'minecraft-cant-connect',
  rust: 'rust-cant-find-server',
  palworld: 'palworld-cant-connect',
  valheim: 'valheim-crossplay-password',
};

const GENERIC_ANALYZERS: Analyzer[] = [
  {
    id: 'net-connection-refused',
    title: 'Connection refused',
    scope: 'generic',
    articleSlug: (game) => CONNECT_ARTICLES[game],
    run(lines) {
      const hit = find(lines, /Connection refused|ECONNREFUSED/i);
      if (!hit) return null;
      return {
        confidence: 'possible',
        explanation: `A connection was actively refused: nothing was listening on that address/port, or the server was still starting or offline. Check the address and port and that the server is running. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
  {
    id: 'net-connection-timeout',
    title: 'Connection timed out',
    scope: 'generic',
    articleSlug: (game) => CONNECT_ARTICLES[game],
    run(lines) {
      const hit = find(lines, /(?:connection|connect|read) timed out|ETIMEDOUT/i);
      if (!hit) return null;
      return {
        confidence: 'possible',
        explanation: `A connection timed out. Typical causes: wrong address or port, the server being offline, or a firewall/network issue between you and the server. ${DISCLAIMER}`,
        evidence: ev(hit.line),
      };
    },
  },
];

/** Analyzer ids, for tests and dashboards. */
export const ANALYZER_IDS = [...MINECRAFT_ANALYZERS, ...GENERIC_ANALYZERS].map((a) => a.id);

const MINECRAFT_MARKERS = /net\.minecraft|Minecraft Crash Report|\[(?:Server thread|main|Render thread|ServerMain)\/(?:INFO|WARN|ERROR)\]|minecraft server version|eula\.txt|\b(?:forge|neoforge|fabricloader|paper|spigot|bukkit)\b/i;

export function detectGame(text: string): string | null {
  return MINECRAFT_MARKERS.test(text.slice(0, 200_000)) ? 'minecraft' : null;
}

/** Mask IPv6 literals (redactSecrets handles IPv4). Validated with isIP to avoid masking timestamps. */
export function maskIPv6(text: string): string {
  return text.replace(/(?<![0-9a-z:])[0-9a-f:]{6,39}(?![0-9a-z:])/gi, (m) => ((m.match(/:/g)?.length ?? 0) >= 2 && isIP(m) === 6 ? '[IP]' : m));
}

/** The single entry point for anything derived from an upload: redact first, always. */
export function redactLog(raw: string): string {
  return maskIPv6(redactSecrets(raw, { maskIps: true }));
}

export interface DiagnosisResult {
  game: string;
  findings: Finding[];
  /** ≤ 1500 chars of redacted log text. */
  excerpt: string;
}

/** Redact, then run the analyzers relevant to the game. Pure and deterministic. */
export function diagnoseText(raw: string, game?: string | null): DiagnosisResult {
  const redacted = redactLog(raw);
  const lines = redacted.split(/\r?\n/).slice(-MAX_LINES);
  const effectiveGame = game ?? detectGame(redacted) ?? 'unknown';
  const analyzers = [...(effectiveGame === 'minecraft' ? MINECRAFT_ANALYZERS : []), ...GENERIC_ANALYZERS];

  const findings: Finding[] = [];
  for (const a of analyzers) {
    const hit = a.run(lines);
    if (!hit) continue;
    const slug = typeof a.articleSlug === 'function' ? a.articleSlug(effectiveGame) : a.articleSlug;
    findings.push({ id: a.id, title: a.title, confidence: hit.confidence, explanation: hit.explanation, evidence: hit.evidence, ...(slug ? { articleSlug: slug } : {}) });
  }
  // 'likely' before 'possible'; otherwise keep analyzer order (stable sort).
  findings.sort((x, y) => (x.confidence === y.confidence ? 0 : x.confidence === 'likely' ? -1 : 1));

  return { game: effectiveGame, findings, excerpt: buildExcerpt(lines, findings) };
}

function buildExcerpt(lines: readonly string[], findings: readonly Finding[]): string {
  const picked = findings.length
    ? [...new Set(findings.map((f) => f.evidence))]
    : lines
        .filter((l) => l.trim())
        .slice(-15)
        .map((l) => truncate(l.trim(), MAX_EVIDENCE));
  return truncate(picked.join('\n'), MAX_EXCERPT);
}
