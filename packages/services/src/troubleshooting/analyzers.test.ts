import { describe, expect, it } from 'vitest';
import { ANALYZER_IDS, MAX_EXCERPT, detectGame, diagnoseText, maskIPv6, redactLog } from './analyzers';

// ───────────── Realistic fixtures (trimmed real-world shapes) ─────────────

const JAVA_VERSION = `[14:02:11] [ServerMain/INFO]: Environment: Environment[sessionHost=https://sessionserver.mojang.com, servicesHost=https://api.minecraftservices.com, name=PROD]
Error: LinkageError occurred while loading main class net.minecraft.bundler.Main
	java.lang.UnsupportedClassVersionError: net/minecraft/bundler/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0`;

const OOM = `[03:14:07] [Server thread/INFO]: Preparing spawn area: 86%
[03:15:42] [Server thread/ERROR]: Encountered an unexpected exception
java.lang.OutOfMemoryError: Java heap space
	at java.util.Arrays.copyOf(Arrays.java:3512) ~[?:?]
	at net.minecraft.world.level.chunk.storage.RegionFile.write(RegionFile.java:220) ~[server-1.20.1.jar:?]`;

const FORGE_DEPS = `[main/INFO] [net.minecraftforge.fml.loading.FMLLoader/CORE]: Loading Forge 47.2.0
[main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:
	Mod ID: 'architectury', Requested by: 'roughlyenoughitems', Expected range: '[9.1.12,)', Actual version: '[MISSING]'
	Mod ID: 'cloth_config', Requested by: 'roughlyenoughitems', Expected range: '[11.1.106,)', Actual version: '[MISSING]'
[main/INFO] [net.minecraftforge.fml.loading.LoadingModList/]: Shutting down`;

const FABRIC_DEPS = `[12:00:01] [main/INFO]: Loading Minecraft 1.20.4 with Fabric Loader 0.15.6
[12:00:02] [main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Install fabric-api, any version.
More details:
	 - Mod 'Sodium Extra' (sodium-extra) 0.5.4 requires any version of fabric-api, which is missing!`;

const MIXIN = `[16:20:33] [main/WARN]: Error loading class: me/jellysquid/mods/sodium/client/render/SodiumWorldRenderer (java.lang.ClassNotFoundException: me/jellysquid/mods/sodium/client/render/SodiumWorldRenderer)
[16:20:34] [main/ERROR]: Mixin apply for mod iris failed iris.mixins.json:MixinLevelRenderer from mod iris -> net.minecraft.class_761: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException Critical injection failure`;

const PORT_IN_USE = `[18:45:10] [Server thread/INFO]: Starting Minecraft server on *:25565
[18:45:10] [Server thread/WARN]: **** FAILED TO BIND TO PORT!
[18:45:10] [Server thread/WARN]: The exception was: io.netty.channel.unix.Errors$NativeIoException: bind(..) failed: Address already in use
[18:45:10] [Server thread/WARN]: Perhaps a server is already running on that port?`;

const EULA = `[09:00:00] [ServerMain/INFO]: Building unoptimized datafixer
[09:00:02] [ServerMain/WARN]: Failed to load eula.txt
[09:00:02] [ServerMain/INFO]: You need to agree to the EULA in order to run the server. Go to eula.txt for more info.`;

const CHUNK = `[21:10:00] [Server thread/ERROR]: Couldn't load chunk [12, -7]
java.util.zip.ZipException: invalid distance too far back
[21:10:00] [Server thread/ERROR]: Chunk file at [12, -7] is in the wrong location; relocating. (Expected [12, -7], got [0, 0])`;

const TICKING = `---- Minecraft Crash Report ----
// Who set us up the TNT?

Time: 2024-05-01 21:33:12
Description: Ticking entity

java.lang.NullPointerException: Cannot invoke "net.minecraft.world.entity.Entity.getX()" because "target" is null
	at com.example.mobs.AttackGoal.tick(AttackGoal.java:42)

-- Entity being ticked --
Details:
	Entity Type: examplemobs:goblin (com.example.mobs.Goblin)
	Entity's Exact location: 104.50, 64.00, -233.30`;

const PLUGIN = `[10:00:01] [Server thread/INFO]: Starting minecraft server version 1.20.4
[10:00:03] [Server thread/ERROR]: [ModernPluginLoadingStrategy] Could not load 'plugins/EssentialsXChat-2.20.1.jar' in folder 'plugins'
org.bukkit.plugin.UnknownDependencyException: Unknown/missing dependency plugins: [Essentials]. Please download and install these plugins to run 'EssentialsChat'.`;

const LAG = Array.from(
  { length: 6 },
  (_, i) => `[12:0${i}:00] [Server thread/WARN]: Can't keep up! Is the server overloaded? Running ${2000 + i * 1500}ms or ${40 + i * 30} ticks behind`,
).join('\n');

const CONNECT_REFUSED = `[12:00:00] [Render thread/INFO]: Connecting to mc.example.net, 25565
[12:00:01] [Render thread/WARN]: Couldn't connect to server
io.netty.channel.AbstractChannel$AnnotatedConnectException: Connection refused: no further information: mc.example.net/203.0.114.7:25565`;

const CONNECT_TIMEOUT = `[12:00:00] [Server Connector #1/ERROR]: Couldn't connect to server
io.netty.channel.ConnectTimeoutException: connection timed out: mc.example.net/203.0.114.7:25565`;

const VERSION_MISMATCH = `[19:22:01] [Server thread/INFO]: Disconnecting Steve (/[IP]:51515): Outdated client! Please use 1.21.1`;

const ids = (text: string, game?: string) => diagnoseText(text, game).findings.map((f) => f.id);

describe('Minecraft analyzers', () => {
  it('Java version mismatch → names required and current Java', () => {
    const r = diagnoseText(JAVA_VERSION);
    const f = r.findings.find((x) => x.id === 'mc-java-version')!;
    expect(f).toBeDefined();
    expect(f.confidence).toBe('likely');
    expect(f.explanation).toMatch(/Java 21.*Java 17/);
    expect(f.articleSlug).toBe('minecraft-java-version');
    expect(f.evidence).toContain('UnsupportedClassVersionError');
  });

  it('OutOfMemoryError', () => {
    const f = diagnoseText(OOM).findings.find((x) => x.id === 'mc-out-of-memory')!;
    expect(f.explanation).toMatch(/Java heap space/);
  });

  it('Forge missing dependencies lists the mods', () => {
    const f = diagnoseText(FORGE_DEPS).findings.find((x) => x.id === 'mc-missing-dependencies')!;
    expect(f.explanation).toContain('architectury (needed by roughlyenoughitems)');
    expect(f.explanation).toContain('cloth_config');
  });

  it('Fabric "requires mod X"', () => {
    const f = diagnoseText(FABRIC_DEPS).findings.find((x) => x.id === 'mc-missing-dependencies')!;
    expect(f.explanation).toMatch(/"Sodium Extra" requires "fabric-api"/);
  });

  it('Mixin apply failure names the mod', () => {
    const f = diagnoseText(MIXIN).findings.find((x) => x.id === 'mc-mixin-failure')!;
    expect(f.explanation).toContain('"iris"');
    expect(f.confidence).toBe('likely');
  });

  it('port already in use', () => expect(ids(PORT_IN_USE)).toContain('mc-port-in-use'));
  it('EULA not accepted', () => expect(ids(EULA)).toEqual(['mc-eula']));
  it('corrupted chunk', () => expect(ids(CHUNK)).toContain('mc-corrupted-chunk'));

  it('ticking entity names the entity type', () => {
    const f = diagnoseText(TICKING).findings.find((x) => x.id === 'mc-ticking-entity')!;
    expect(f.explanation).toContain('examplemobs:goblin');
  });

  it('plugin could not load + missing dependency', () => {
    const f = diagnoseText(PLUGIN).findings.find((x) => x.id === 'mc-plugin-load')!;
    expect(f.explanation).toContain('EssentialsXChat-2.20.1.jar');
    expect(f.explanation).toContain('Essentials');
  });

  it("Can't keep up! counts occurrences and worst lag", () => {
    const f = diagnoseText(LAG).findings.find((x) => x.id === 'mc-cant-keep-up')!;
    expect(f.confidence).toBe('likely');
    expect(f.explanation).toMatch(/6 times \(worst: 9500 ms\)/);
    const single = diagnoseText(LAG.split('\n')[0]!).findings.find((x) => x.id === 'mc-cant-keep-up')!;
    expect(single.confidence).toBe('possible');
  });

  it('client/server version mismatch', () => expect(ids(VERSION_MISMATCH, 'minecraft')).toContain('mc-version-mismatch'));
});

describe('generic analyzers', () => {
  it('connection refused / timed out (and links the per-game article)', () => {
    const refused = diagnoseText(CONNECT_REFUSED).findings.find((f) => f.id === 'net-connection-refused')!;
    expect(refused.articleSlug).toBe('minecraft-cant-connect');
    expect(ids(CONNECT_TIMEOUT, 'rust')).toEqual(['net-connection-timeout']);
    expect(diagnoseText(CONNECT_TIMEOUT, 'rust').findings[0]!.articleSlug).toBe('rust-cant-find-server');
  });

  it('every finding is phrased as a likely cause, not a confirmed diagnosis', () => {
    for (const fx of [JAVA_VERSION, OOM, FORGE_DEPS, FABRIC_DEPS, MIXIN, PORT_IN_USE, EULA, CHUNK, TICKING, PLUGIN, LAG, CONNECT_REFUSED]) {
      for (const f of diagnoseText(fx).findings) {
        expect(f.explanation).toMatch(/not a confirmed diagnosis/);
        expect(f.evidence.length).toBeLessThanOrEqual(200);
        expect(ANALYZER_IDS).toContain(f.id);
      }
    }
  });

  it('reports nothing for a clean log', () => {
    const clean = `[10:00:00] [Server thread/INFO]: Starting minecraft server version 1.21.1\n[10:00:05] [Server thread/INFO]: Done (4.512s)! For help, type "help"`;
    const r = diagnoseText(clean);
    expect(r.findings).toEqual([]);
    expect(r.game).toBe('minecraft');
    expect(r.excerpt).toContain('Done (4.512s)');
  });

  it('does not run Minecraft analyzers on other games', () => {
    expect(ids(EULA, 'valheim')).toEqual([]);
    expect(detectGame('Valheim dedicated server version 0.217.46')).toBeNull();
  });
});

describe('redaction happens before analysis', () => {
  const SECRET_LOG = `[10:00:00] [Server thread/INFO]: Loading properties
rcon.password=secret
[10:00:01] [Server thread/INFO]: Starting Minecraft server on 51.38.12.99:25565
[10:00:01] [Server thread/WARN]: **** FAILED TO BIND TO PORT! 51.38.12.99:25565 rcon.password=secret
[10:00:02] [Server thread/INFO]: token=abcdefghijklmnop1234 IPv6 bind 2001:41d0:304:200::5e1f
[10:00:03] [Server thread/ERROR]: java.lang.OutOfMemoryError: Java heap space (host 51.38.12.99)`;

  it('never exposes the password or IPs in findings or excerpt', () => {
    const r = diagnoseText(SECRET_LOG);
    expect(r.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['mc-port-in-use', 'mc-out-of-memory']));
    const everything = JSON.stringify(r);
    expect(everything).not.toContain('secret');
    expect(everything).not.toContain('51.38.12.99');
    expect(everything).not.toContain('2001:41d0');
    expect(everything).not.toContain('abcdefghijklmnop1234');
    expect(everything).toContain('[IP]');
    expect(everything).toContain('[REDACTED]');
  });

  it('caps the excerpt at 1500 chars', () => {
    const noisy = Array.from({ length: 500 }, (_, i) => `[10:00:00] [Server thread/INFO]: line ${i} ${'x'.repeat(150)}`).join('\n');
    expect(diagnoseText(noisy).excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT);
  });

  it('masks IPv6 without touching timestamps or Java method refs', () => {
    expect(maskIPv6('at 12:34:56 from fe80::1ff:fe23:4567:890a and Foo::bar')).toBe('at 12:34:56 from [IP] and Foo::bar');
    expect(redactLog('connect 10.0.0.5:25565')).toBe('connect [IP]:25565');
  });
});
