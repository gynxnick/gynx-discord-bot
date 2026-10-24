import type { FlowDefinition } from './flow-definition';

/**
 * Curated default knowledge base + flows. Generic, publicly-known guidance
 * only: nothing here describes GYNX infrastructure, plans or policies. Every
 * article ends by pointing to support (the guild's supportUrl is attached
 * when rendered).
 */

export interface SeedArticle {
  slug: string;
  title: string;
  summary: string;
  game: string | null;
  tags: string[];
  body: string;
}

export interface SeedFlow {
  slug: string;
  title: string;
  game: string | null;
  description: string;
  definition: FlowDefinition;
}

const STILL_STUCK =
  '\n\n**Still stuck?** Use the *Still stuck* button below to reach the support team — include what you already tried and the exact error message.';

export const SEED_ARTICLES: readonly SeedArticle[] = [
  {
    slug: 'minecraft-cant-connect',
    title: "Minecraft: Can't connect / Connection timed out",
    summary:
      'Step-by-step checks when the client shows "Can\'t connect to server", "Connection refused" or "Connection timed out".',
    game: 'minecraft',
    tags: ['connect', 'connection', 'timeout', 'timed', 'refused', 'join', 'network'],
    body:
      '**1. Check the address and port.** Copy the exact address from your server details. If the port is not 25565, add it: `play.example.com:25566`.\n' +
      '**2. Is the server actually running?** Open the console and wait until you see `Done (…s)! For help, type "help"`. Joining during startup gives "Connection refused".\n' +
      '**3. Version mismatch?** "Outdated client/server" means your game version differs from the server — see *Minecraft: Client/server version mismatch*.\n' +
      '**4. Timed out vs. refused.** *Refused* = nothing is listening (server offline/crashed or wrong port). *Timed out* = packets never arrive (wrong address, firewall, VPN or local network issue).\n' +
      '**5. Rule out your own network.** Disable VPNs/proxies, try another network (e.g. phone hotspot), and allow Java (javaw.exe) through your firewall.\n' +
      '**6. Mods/proxies.** Modded servers require the same mods and loader version on your client. Behind a proxy (Velocity/BungeeCord) the backend must not be joined directly.\n' +
      '**7. Check the server log** (`logs/latest.log`) for errors at startup — you can run `/diagnose` on it.' +
      STILL_STUCK,
  },
  {
    slug: 'minecraft-version-mismatch',
    title: 'Minecraft: Client/server version mismatch',
    summary: 'Fix "Outdated client!", "Outdated server!" and "Incompatible client" by matching versions.',
    game: 'minecraft',
    tags: ['version', 'outdated', 'mismatch', 'incompatible', 'update', 'launcher'],
    body:
      'Minecraft clients can only join servers running the **same version** (unless the server uses a compatibility plugin such as ViaVersion).\n\n' +
      '**Find the server version:** hover the server in your multiplayer list, run `/version` in game, or check the first lines of `latest.log`.\n' +
      '**Change your client version:** Minecraft Launcher → *Installations* → *New installation* → pick the matching version.\n' +
      '**After a server update** every player has to switch versions too. Modpacks must be updated on both sides to the same pack version.\n' +
      '**Snapshots** never join release servers and vice versa.\n' +
      '**Modded:** the mod loader (Forge/NeoForge/Fabric) and mod versions must match the server. "Mismatched mod list" means a mod is missing or a different version.' +
      STILL_STUCK,
  },
  {
    slug: 'minecraft-java-version',
    title: 'Minecraft: Crash on startup due to Java version',
    summary: 'UnsupportedClassVersionError / "class file version 65.0" means the wrong Java runtime is used.',
    game: 'minecraft',
    tags: ['java', 'jdk', 'jre', 'unsupportedclassversionerror', 'class', 'startup', 'crash'],
    body:
      'An error like `UnsupportedClassVersionError … class file version 65.0 … only recognizes class file versions up to 61.0` means the server (or a mod/plugin) needs a **newer Java** than the one running it.\n\n' +
      '**Class file version → Java:** 52 = Java 8, 55 = Java 11, 60 = Java 16, 61 = Java 17, 65 = Java 21.\n\n' +
      '**Typical requirements:**\n' +
      '• Minecraft 1.20.5 and newer → Java 21\n' +
      '• 1.18 – 1.20.4 → Java 17\n' +
      '• 1.17 → Java 16\n' +
      '• 1.16.5 and older → Java 8 (many older modpacks break on newer Java)\n\n' +
      '**Fix:** select the matching Java version for the server (start script or your hosting panel’s Java/Docker image setting) and restart. Too *new* a Java can also break very old modded versions — match the version the modpack recommends.' +
      STILL_STUCK,
  },
  {
    slug: 'minecraft-mod-plugin-conflicts',
    title: 'Minecraft: Mod or plugin conflicts and missing dependencies',
    summary: 'Diagnose missing dependencies, Mixin failures and plugins that refuse to load.',
    game: 'minecraft',
    tags: [
      'mods',
      'plugins',
      'forge',
      'fabric',
      'neoforge',
      'mixin',
      'dependency',
      'conflict',
      'paper',
      'spigot',
    ],
    body:
      '**Missing dependencies** — Forge/NeoForge prints `Missing or unsupported mandatory dependencies` and lists `Mod ID` + `Requested by`. Fabric says `Mod X requires …`. Install the listed library (e.g. Fabric API, Architectury, Cloth Config) in the version required.\n\n' +
      '**Mixin failures** — `Mixin apply failed …` / `Mixin apply for mod X failed` usually means mod X is built for a different Minecraft or loader version, or two mods patch the same code. Update mod X, or remove it to confirm.\n\n' +
      "**Plugins** — `Could not load 'plugins/X.jar'` is followed by the reason: an `UnknownDependencyException` (install the dependency, e.g. Vault/ProtocolLib), an unsupported `api-version` (plugin is for another server version), or a corrupt download.\n\n" +
      '**Never mix:** Forge mods on Fabric (or vice versa), client-only mods (shaders, minimaps) on servers, or Bukkit plugins on a mod loader without a hybrid server.\n\n' +
      '**Find the culprit fast:** remove half of the mods/plugins, test, and repeat on the half that still fails (binary search). Always keep a backup first.' +
      STILL_STUCK,
  },
  {
    slug: 'minecraft-out-of-memory',
    title: 'Minecraft: Out of memory (OutOfMemoryError)',
    summary: 'What "java.lang.OutOfMemoryError: Java heap space" means and how to reduce memory usage.',
    game: 'minecraft',
    tags: ['memory', 'ram', 'oom', 'outofmemoryerror', 'heap', 'xmx', 'crash'],
    body:
      '`java.lang.OutOfMemoryError` means the Java process used all the memory it was allowed (`-Xmx`).\n\n' +
      '**Common causes:** heavy modpacks, high view/simulation distance, lots of loaded chunks (chunk loaders), huge farms or dropped items, and memory leaks in a mod/plugin.\n\n' +
      '**What helps:**\n' +
      '• Make sure the allocated memory matches what your plan provides — setting `-Xmx` *higher* than the available memory makes things worse.\n' +
      '• Lower `view-distance` / `simulation-distance` in server.properties.\n' +
      '• Pre-generate the world (e.g. Chunky) instead of generating while players explore.\n' +
      '• Use a profiler such as *spark* to find the mod/plugin or area that is using memory.\n' +
      '• Update mods/plugins — leaks are often fixed in newer versions.\n\n' +
      '*Note:* `OutOfMemoryError: Metaspace` or `unable to create native thread` point to a mod/plugin problem rather than heap size.' +
      STILL_STUCK,
  },
  {
    slug: 'minecraft-world-corruption',
    title: 'Minecraft: World corruption basics',
    summary:
      'Recognise corrupted chunks/regions and ticking-entity crashes, and recover safely from backups.',
    game: 'minecraft',
    tags: ['world', 'corruption', 'corrupt', 'chunk', 'region', 'ticking', 'entity', 'backup', 'crash'],
    body:
      "**Signs:** log lines such as `Couldn't load chunk`, `Chunk file at [x, z] is in the wrong location`, region file errors, or a crash report describing a `Ticking entity` / `Ticking block entity`.\n\n" +
      '**First, stop and back up.** Copy the whole world folder before trying anything — repairs can make things worse.\n\n' +
      "**Ticking entity / block entity:** the crash report shows *Entity Type* and *Entity's Exact location*. Updating the related mod often fixes it. Some loaders/configs (e.g. Forge `removeErroringEntities`) can remove the broken entity — use with care and only with a backup.\n\n" +
      '**Corrupted chunks:** restoring the affected region file (`region/r.X.Z.mca`) from a backup is the safest fix. Tools like MCA Selector can delete or inspect individual chunks (deleted chunks regenerate).\n\n' +
      '**Prevent it:** always stop the server with `stop` (never kill it), keep regular backups, and avoid disk-full situations.' +
      STILL_STUCK,
  },
  {
    slug: 'minecraft-eula',
    title: 'Minecraft: Server stops with "You need to agree to the EULA"',
    summary: 'A fresh server shuts down until the Minecraft EULA is accepted in eula.txt.',
    game: 'minecraft',
    tags: ['eula', 'startup', 'eula.txt', 'stops'],
    body:
      'On first start, a Minecraft server creates `eula.txt` and stops with `You need to agree to the EULA in order to run the server`.\n\n' +
      '**Fix:** read the Minecraft EULA (https://aka.ms/MinecraftEULA). If you agree, open `eula.txt`, change `eula=false` to `eula=true`, save, and start the server again.\n\n' +
      'If it keeps happening, make sure you edited the `eula.txt` in the server’s root folder (next to the server jar) and that the file was saved.' +
      STILL_STUCK,
  },
  {
    slug: 'minecraft-port-in-use',
    title: 'Minecraft: "FAILED TO BIND TO PORT"',
    summary: 'The server cannot open its port because something else is using it or server-ip is wrong.',
    game: 'minecraft',
    tags: ['port', 'bind', 'bindexception', 'address', 'in use', 'server-ip'],
    body:
      '`**** FAILED TO BIND TO PORT!` with `Address already in use` means another process is already using that port — very often a previous instance of the server that did not shut down.\n\n' +
      '**Fixes:**\n' +
      '• Stop the server fully and wait a few seconds before starting again; make sure only one instance is running.\n' +
      '• Check that `server-port` in server.properties is the port assigned to your server.\n' +
      '• If the error says `Cannot assign requested address`, the `server-ip` setting points to an address this machine does not have — leave `server-ip=` empty unless you were told otherwise.\n' +
      '• Query/RCON ports (`query.port`, `rcon.port`) must not clash with the game port either.' +
      STILL_STUCK,
  },
  {
    slug: 'minecraft-server-lag',
    title: 'Minecraft: "Can\'t keep up!" and server lag',
    summary: 'Understand TPS lag warnings and find what is slowing the server down.',
    game: 'minecraft',
    tags: ['lag', 'tps', 'mspt', 'cant keep up', 'performance', 'overloaded', 'spark'],
    body:
      "`Can't keep up! Is the server overloaded? Running 5000ms or 100 ticks behind` means the server could not run its 20 ticks per second. A few warnings during startup or world generation are normal.\n\n" +
      '**Frequent warnings point to:** large farms or mob grinders, many dropped items/entities, redstone clocks, loading new chunks while players explore, too-high view/simulation distance, or a slow mod/plugin.\n\n' +
      '**How to find the cause:** install *spark* and run `/spark profiler` for a few minutes during lag — it shows which mod, plugin or entity type uses the most time.\n\n' +
      "**Quick wins:** pre-generate the world, lower `simulation-distance`, limit entities (e.g. Paper's entity settings), and keep mods/plugins up to date." +
      STILL_STUCK,
  },
  {
    slug: 'rust-cant-find-server',
    title: "Rust: Can't find or join the server",
    summary: 'Why a Rust server is missing from the browser and how to connect directly with client.connect.',
    game: 'rust',
    tags: ['rust', 'browser', 'server list', 'connect', 'join', 'f1', 'client.connect'],
    body:
      '**The server list can take a while.** After a (re)start it can take several minutes before the server appears in the in-game browser, and filters (region, modded/community tab, "hide full") may hide it.\n\n' +
      '**Connect directly:** press **F1** to open the console and type `client.connect address:port` using the game port from your server details (default 28015).\n\n' +
      '**Still not listed?** Check that the server finished starting (the console shows `Server startup complete`), that `server.port`/`server.queryport` match the ports assigned to you, and whether it is on a different game branch (e.g. staging).\n\n' +
      '**Connection errors:** "Disconnected: Steam Auth Timeout" or "EAC" errors are usually client-side — verify game files in Steam and restart Steam.' +
      STILL_STUCK,
  },
  {
    slug: 'rust-wipe-version-mismatch',
    title: 'Rust: Wipe day and version mismatch',
    summary: 'Forced monthly updates require server and client to update before anyone can join.',
    game: 'rust',
    tags: ['rust', 'wipe', 'forced', 'update', 'version', 'protocol', 'mismatch', 'oxide', 'carbon'],
    body:
      'Facepunch releases a **forced update** roughly once a month (usually the first Thursday). After it, outdated servers and clients cannot connect to each other ("protocol mismatch" / "server is running a different version").\n\n' +
      '**Fix:** update the game client in Steam, then update the server build (restart/update it so it pulls the latest build). Map and blueprint wipes depend on the server settings, but the forced update itself always requires a new build.\n\n' +
      '**Modded servers:** Oxide/uMod or Carbon must be updated to the build that matches the new game version, otherwise the server may fail to start or plugins break. Update plugins that report errors after wipe.\n\n' +
      '**Tip:** wait until the official update is live before updating, and keep a backup of `server/<identity>` (configs, plugin data).' +
      STILL_STUCK,
  },
  {
    slug: 'palworld-cant-connect',
    title: "Palworld: Can't connect to a dedicated server",
    summary: 'Version mismatches, direct-connect address format and common Palworld join problems.',
    game: 'palworld',
    tags: ['palworld', 'connect', 'join', 'version', 'mismatch', 'direct connect', 'password'],
    body:
      '**Use direct connect.** In *Join Multiplayer Game*, enter `address:port` at the bottom (default game port 8211) and click *Connect*.\n\n' +
      '**Version mismatch:** after a Palworld patch both the client and the server must be updated. A version mismatch error means one side is outdated — update the game in Steam/Xbox and restart/update the server.\n\n' +
      '**Password:** if the server has a password, you will be asked for it. Make sure there are no extra spaces.\n\n' +
      '**Crossplay:** Steam and Xbox/PC Game Pass players can only play together on servers and versions that support crossplay — check the current official notes.\n\n' +
      '**Server still starting?** Large saves can take a while to load; wait until the server log shows it is running.' +
      STILL_STUCK,
  },
  {
    slug: 'valheim-crossplay-password',
    title: 'Valheim: Crossplay, join codes and password problems',
    summary: 'Fix "Incorrect password", crossplay join codes, and servers missing from the list.',
    game: 'valheim',
    tags: ['valheim', 'crossplay', 'password', 'join code', 'connect', 'xbox', 'playfab'],
    body:
      '**Password rules:** Valheim server passwords must be at least **5 characters** and must **not** be contained in the server name — otherwise the server will not start correctly. Passwords are case-sensitive.\n\n' +
      '**Crossplay servers** (started with `-crossplay`) are joined with the **join code** shown in the server log, or via the community list. Xbox/Game Pass players can only join crossplay servers.\n\n' +
      '**Non-crossplay servers** are joined via Steam: *Join Game* → *Add server* → `address:port` (default 2456). The Steam query port is the game port + 1 (2457).\n\n' +
      '**"Incompatible version":** update the game on all clients and the server. Mods (BepInEx/Valheim Plus etc.) usually must be identical on clients and server.\n\n' +
      '**Not in the list?** It can take a few minutes after start. Use *Add server* / join code instead of searching.' +
      STILL_STUCK,
  },
  {
    slug: 'gmod-missing-content',
    title: "Garry's Mod: Missing textures, ERROR models and Workshop content",
    summary:
      'Purple/black checkers or red ERROR signs mean missing content — subscribe to the server collection or mount games.',
    game: 'gmod',
    tags: ['gmod', 'garrys mod', 'missing', 'textures', 'error', 'workshop', 'collection', 'css', 'content'],
    body:
      '**Purple/black checkerboards** are missing textures; **big red ERROR signs** are missing models.\n\n' +
      '**Most common cause:** content from another game (very often *Counter-Strike: Source*) that the server/addons rely on. Own the game and mount it via the controller icon in the main menu, or use content packs the server provides.\n\n' +
      '**Workshop content:** subscribe to the server’s Workshop collection. Servers can make clients download it automatically with `+host_workshop_collection <id>` and `resource.AddWorkshop` in Lua.\n\n' +
      '**Fixing a broken download:** unsubscribe and resubscribe, or delete the cached addon in `garrysmod/cache/workshop` and rejoin. Enable *Allow all custom files* in the multiplayer options.\n\n' +
      '**Server owners:** after changing the collection, restart the server so it re-downloads the addons.' +
      STILL_STUCK,
  },
];

export const SEED_FLOWS: readonly SeedFlow[] = [
  {
    slug: 'minecraft-cant-connect',
    title: "Minecraft: I can't connect",
    game: 'minecraft',
    description: 'Walk through the most common reasons a Minecraft server cannot be joined.',
    definition: {
      start: 'error',
      nodes: {
        error: {
          prompt: 'What message do you see when you try to join?',
          options: [
            { label: 'Connection timed out', next: 'timeout' },
            { label: 'Connection refused', next: 'refused' },
            { label: 'Outdated client / server', articleSlug: 'minecraft-version-mismatch' },
            { label: 'Mod / mod list mismatch', articleSlug: 'minecraft-mod-plugin-conflicts' },
            { label: 'Something else', escalate: true },
          ],
        },
        timeout: {
          prompt: 'Did you copy the exact address — including the port if it is not 25565 (address:port)?',
          options: [
            { label: 'Yes, the address is correct', next: 'network' },
            { label: 'No / not sure', articleSlug: 'minecraft-cant-connect' },
          ],
        },
        network: {
          prompt:
            'Try once with VPN/proxy disabled or on another network (e.g. phone hotspot). Does it work then?',
          options: [
            { label: 'Yes, it works now', resolve: true },
            { label: 'No, still timing out', articleSlug: 'minecraft-cant-connect' },
          ],
        },
        refused: {
          prompt: 'Is the server fully started? The console should show "Done (…s)! For help, type help".',
          options: [
            { label: 'It shows Done — still refused', next: 'refused-port' },
            { label: 'It crashed or keeps restarting', articleSlug: 'minecraft-java-version' },
            { label: 'I can’t see the console', escalate: true },
          ],
        },
        'refused-port': {
          prompt: 'Does the port in your address match `server-port` in server.properties?',
          options: [
            { label: 'I fixed the port — it works', resolve: true },
            { label: 'They match, still refused', articleSlug: 'minecraft-port-in-use' },
          ],
        },
      },
    },
  },
  {
    slug: 'minecraft-crash-startup',
    title: 'Minecraft: Server crashes on startup',
    game: 'minecraft',
    description: 'Identify the usual startup crash causes: Java version, EULA, mods, memory and ports.',
    definition: {
      start: 'symptom',
      nodes: {
        symptom: {
          prompt:
            'Tip: `/diagnose` can read your latest.log automatically. Which of these appears in the log?',
          options: [
            { label: 'UnsupportedClassVersionError', articleSlug: 'minecraft-java-version' },
            { label: 'You need to agree to the EULA', articleSlug: 'minecraft-eula' },
            { label: 'Missing dependencies / Mixin', articleSlug: 'minecraft-mod-plugin-conflicts' },
            { label: 'OutOfMemoryError', articleSlug: 'minecraft-out-of-memory' },
            { label: 'None of these', next: 'other' },
          ],
        },
        other: {
          prompt: 'Does the log mention FAILED TO BIND TO PORT, or chunk / ticking entity errors?',
          options: [
            { label: 'FAILED TO BIND TO PORT', articleSlug: 'minecraft-port-in-use' },
            { label: 'Chunk or ticking entity errors', articleSlug: 'minecraft-world-corruption' },
            { label: 'No — something else', escalate: true },
          ],
        },
      },
    },
  },
  {
    slug: 'rust-cant-find-server',
    title: "Rust: I can't find or join the server",
    game: 'rust',
    description: 'Find a Rust server that is missing from the browser or rejects your connection.',
    definition: {
      start: 'problem',
      nodes: {
        problem: {
          prompt: 'What is happening?',
          options: [
            { label: 'Server not in the browser', next: 'direct' },
            { label: 'Version / protocol mismatch', articleSlug: 'rust-wipe-version-mismatch' },
            { label: 'Steam auth / EAC error', articleSlug: 'rust-cant-find-server' },
            { label: 'Something else', escalate: true },
          ],
        },
        direct: {
          prompt: 'Press F1 and run `client.connect address:port` with your game port. Does that connect?',
          options: [
            { label: 'Yes, I’m in', resolve: true },
            { label: 'No, it fails', articleSlug: 'rust-cant-find-server' },
          ],
        },
      },
    },
  },
  {
    slug: 'palworld-cant-connect',
    title: "Palworld: I can't connect",
    game: 'palworld',
    description: 'Check version, address and password issues for Palworld dedicated servers.',
    definition: {
      start: 'problem',
      nodes: {
        problem: {
          prompt: 'What do you see?',
          options: [
            { label: 'Version mismatch', articleSlug: 'palworld-cant-connect' },
            { label: 'Connection timed out', next: 'address' },
            { label: 'Wrong password', articleSlug: 'palworld-cant-connect' },
            { label: 'Something else', escalate: true },
          ],
        },
        address: {
          prompt: 'Are you using direct connect with `address:port` (default port 8211)?',
          options: [
            { label: 'That fixed it', resolve: true },
            { label: 'Yes, still timing out', articleSlug: 'palworld-cant-connect' },
          ],
        },
      },
    },
  },
  {
    slug: 'valheim-cant-join',
    title: "Valheim: I can't join the server",
    game: 'valheim',
    description: 'Crossplay join codes, passwords and version problems for Valheim servers.',
    definition: {
      start: 'type',
      nodes: {
        type: {
          prompt: 'Is the server a crossplay server (joined with a join code)?',
          options: [
            { label: 'Yes, crossplay', next: 'crossplay' },
            { label: 'No, Steam only', next: 'steam' },
            { label: 'I don’t know', articleSlug: 'valheim-crossplay-password' },
          ],
        },
        crossplay: {
          prompt: 'Did you use the current join code from the server log (it changes on restart)?',
          options: [
            { label: 'New code works', resolve: true },
            { label: 'Still can’t join', articleSlug: 'valheim-crossplay-password' },
          ],
        },
        steam: {
          prompt: 'What error do you get?',
          options: [
            { label: 'Incorrect password', articleSlug: 'valheim-crossplay-password' },
            { label: 'Incompatible version', articleSlug: 'valheim-crossplay-password' },
            { label: 'Not listed / timeout', articleSlug: 'valheim-crossplay-password' },
            { label: 'Something else', escalate: true },
          ],
        },
      },
    },
  },
  {
    slug: 'gmod-missing-content',
    title: "Garry's Mod: Missing textures or ERROR models",
    game: 'gmod',
    description: 'Fix purple/black textures and ERROR models caused by missing content.',
    definition: {
      start: 'what',
      nodes: {
        what: {
          prompt: 'What are you seeing?',
          options: [
            { label: 'Purple/black textures', next: 'css' },
            { label: 'Red ERROR models', next: 'css' },
            { label: 'Addons not downloading', articleSlug: 'gmod-missing-content' },
          ],
        },
        css: {
          prompt:
            'Have you subscribed to the server’s Workshop collection and mounted Counter-Strike: Source (if the server needs it)?',
          options: [
            { label: 'That fixed it', resolve: true },
            { label: 'Done, still missing', articleSlug: 'gmod-missing-content' },
            { label: 'Not sure how', articleSlug: 'gmod-missing-content' },
          ],
        },
      },
    },
  },
];
