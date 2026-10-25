#!/usr/bin/env bash
# GYNX Discord bot: one-shot installer for a fresh Ubuntu 22.04/24.04 or Debian 12 VPS.
#
#   sudo ./infrastructure/deployment/install.sh
#
# Safe to re-run: existing secrets in /etc/gynx/gynx.env are kept (the encryption
# key is never regenerated), and only missing values are asked for.
#
# Non-interactive use: export the values first, e.g.
#   DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... DISCORD_GUILD_ID=... \
#   DISCORD_OAUTH_CLIENT_SECRET=... DASHBOARD_DOMAIN=dash.gynx.gg ACME_EMAIL=ops@gynx.gg \
#   sudo -E ./infrastructure/deployment/install.sh --yes
#
# Flags:
#   --yes            don't ask for confirmation (fail if a required value is missing)
#   --no-firewall    don't configure ufw
#   --no-swap        don't create a swap file on small servers
set -euo pipefail

ASSUME_YES=0
SETUP_FIREWALL=1
SETUP_SWAP=1
for arg in "$@"; do
  case "$arg" in
    --yes | -y) ASSUME_YES=1 ;;
    --no-firewall) SETUP_FIREWALL=0 ;;
    --no-swap) SETUP_SWAP=0 ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_DIR=/etc/gynx
ENV_FILE="$ENV_DIR/gynx.env"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { echo; bold "==> $*"; }
warn() { printf '\033[33mWARNING:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Never exit silently: report the failing line and command.
# shellcheck disable=SC2154  # rc is assigned inside the trap string
trap 'rc=$?; echo "ERROR: install stopped at line $LINENO (exit $rc): $BASH_COMMAND" >&2; exit $rc' ERR

# ─── Preflight ──────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "run as root: sudo $0"
[[ -f "$APP_DIR/infrastructure/deployment/docker-compose.prod.yml" ]] || die "run this from inside the gynx-discord-bot repository"
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu | debian) ;;
  *) die "unsupported OS '${ID:-unknown}'. Use Ubuntu 22.04/24.04 or Debian 12." ;;
esac
case "$(uname -m)" in
  x86_64 | aarch64) ;;
  *) die "unsupported CPU architecture $(uname -m)" ;;
esac
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
disk_gb=$(df -BG --output=avail "$APP_DIR" | tail -1 | tr -dc '0-9')
((disk_gb >= 8)) || die "at least 8 GB free disk space is needed (found ${disk_gb} GB)"
((mem_mb >= 900)) || die "at least 1 GB RAM is needed (found ${mem_mb} MB)"

bold "GYNX Discord bot installer"
echo "  App directory : $APP_DIR"
echo "  Secrets file  : $ENV_FILE"
echo "  Server        : ${PRETTY_NAME:-$ID}, ${mem_mb} MB RAM, ${disk_gb} GB free"

# ─── Packages & Docker ──────────────────────────────────────────────────────
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg openssl git cron ufw dnsutils jq >/dev/null

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  step "Installing Docker Engine (official repository)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null
echo "  $(docker --version)"

# The dashboard build needs ~1.5 GB of memory; add swap on small servers.
if ((SETUP_SWAP)) && ((mem_mb < 3000)) && [[ -z "$(swapon --show --noheadings)" ]]; then
  step "Creating a 2 GB swap file (server has ${mem_mb} MB RAM)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# ─── Configuration ──────────────────────────────────────────────────────────
step "Configuration"
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"

# Load existing values (re-run) without executing the file.
declare -A CFG=()
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r k v; do
    [[ $k =~ ^[A-Z0-9_]+$ ]] && CFG[$k]="$v"
  done <"$ENV_FILE"
  echo "  Found existing $ENV_FILE: keeping its values and secrets."
fi

# value precedence: existing file > environment variable > prompt
ask() { # ask KEY "Prompt" validator-regex [secret] [default]
  local key=$1 prompt=$2 re=$3 secret=${4:-} def=${5:-} val
  val="${CFG[$key]:-${!key:-}}"
  while [[ -z $val || ! $val =~ $re ]]; do
    [[ -n $val ]] && warn "$key doesn't look right."
    ((ASSUME_YES)) && die "$key is missing or invalid (set it in the environment for --yes)"
    if [[ $secret == secret ]]; then
      read -r -s -p "  $prompt: " val; echo
      val=$(printf '%s' "$val" | tr -d '\r\n\t ')  # pasted values may carry a stray CR or spaces
    else
      read -r -p "  $prompt${def:+ [$def]}: " val
      val=${val:-$def}
    fi
  done
  CFG[$key]="$val"
}

gen() { # gen KEY command...
  local key=$1; shift
  [[ -n ${CFG[$key]:-} ]] || CFG[$key]="$("$@")"
}

SNOWFLAKE='^[0-9]{17,20}$'
echo "  Discord values: https://discord.com/developers/applications → your application."
ask DISCORD_APPLICATION_ID "Application ID (General Information)" "$SNOWFLAKE"
# Bot tokens have three dot-separated parts (the Public Key, a hex string, does not).
TOKEN_RE='^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$'
ask DISCORD_BOT_TOKEN "Bot token (Bot → Reset Token, NOT the Public Key; hidden)" "$TOKEN_RE" secret
ask DISCORD_OAUTH_CLIENT_ID "OAuth2 Client ID" "$SNOWFLAKE" '' "${CFG[DISCORD_APPLICATION_ID]}"
ask DISCORD_OAUTH_CLIENT_SECRET "OAuth2 Client Secret (hidden)" '^.{16,}$' secret
ask DISCORD_GUILD_ID "Your Discord server ID (right-click server → Copy Server ID)" "$SNOWFLAKE"
ask DASHBOARD_DOMAIN "Dashboard domain (e.g. dash.gynx.gg; DNS must point here)" '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
ask ACME_EMAIL "Email for Let's Encrypt certificate notices" '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
# Region/City names only: abbreviations like EST/PST are fixed offsets with no daylight saving.
ask DEFAULT_TIMEZONE "Default time zone (e.g. America/New_York, Europe/London)" '^(UTC|[A-Z][A-Za-z_]+/[A-Za-z0-9_+/-]+)$' '' UTC
while [[ ${CFG[DEFAULT_TIMEZONE]} != UTC && ! -f /usr/share/zoneinfo/${CFG[DEFAULT_TIMEZONE]} ]]; do
  warn "Unknown time zone '${CFG[DEFAULT_TIMEZONE]}'."
  ((ASSUME_YES)) && die "DEFAULT_TIMEZONE must be a Region/City zone such as America/New_York"
  CFG[DEFAULT_TIMEZONE]=''
  ask DEFAULT_TIMEZONE "Default time zone (e.g. America/New_York, Europe/London)" '^(UTC|[A-Z][A-Za-z_]+/[A-Za-z0-9_+/-]+)$' '' UTC
done
ask PORTCHECK_ALLOWED_SUFFIXES "Domains /portcheck may test (comma list, e.g. gynx.gg; blank = disabled)" '.*' '' ''

# ─── Verify the Discord application before building anything ──────────────
API=https://discord.com/api/v10
# Secrets go to curl on stdin (-K -), never on the command line where `ps` could see them.
discord_get() { # discord_get PATH → prints "STATUS BODY"
  printf 'header = "Authorization: Bot %s"\n' "${CFG[DISCORD_BOT_TOKEN]}" |
    curl -sS --max-time 15 -K - -w '\n%{http_code}' "$API$1" 2>/dev/null || echo $'\n000'
}
status_of() { tail -n1 <<<"$1"; }
body_of() { sed '$d' <<<"$1"; }
pause() {
  ((ASSUME_YES)) && die "$1"
  read -r -p "  $1 Press Enter to check again (Ctrl+C to quit)… " _
}

step "Checking your Discord application"
while :; do
  r=$(discord_get /users/@me)
  case $(status_of "$r") in
    200)
      bot_name=$(body_of "$r" | jq -r '.username // "bot"' 2>/dev/null || echo bot)
      app_id=$(body_of "$(discord_get /applications/@me)" | jq -r '.id // empty' 2>/dev/null || true)
      if [[ -n $app_id && $app_id != "${CFG[DISCORD_APPLICATION_ID]}" ]]; then
        warn "That token belongs to application $app_id, not ${CFG[DISCORD_APPLICATION_ID]}."
        ((ASSUME_YES)) && die "token and application ID don't match"
        CFG[DISCORD_BOT_TOKEN]=''
        ask DISCORD_BOT_TOKEN "Bot token for application ${CFG[DISCORD_APPLICATION_ID]} (hidden)" "$TOKEN_RE" secret
        continue
      fi
      echo "  Bot token OK: $bot_name (application ${app_id:-${CFG[DISCORD_APPLICATION_ID]}})"
      break
      ;;
    401)
      warn "Discord rejected the bot token. Use Bot → Reset Token (not the Public Key)."
      ((ASSUME_YES)) && die "invalid bot token"
      CFG[DISCORD_BOT_TOKEN]=''
      ask DISCORD_BOT_TOKEN "Bot token (hidden)" "$TOKEN_RE" secret
      ;;
    *) pause "Couldn't reach Discord to check the token." ;;
  esac
done

# OAuth client secret: a client_credentials request succeeds only with a valid id/secret pair.
while :; do
  code=$(printf 'user = "%s:%s"\n' "${CFG[DISCORD_OAUTH_CLIENT_ID]}" "${CFG[DISCORD_OAUTH_CLIENT_SECRET]}" |
    curl -sS --max-time 15 -K - -o /dev/null -w '%{http_code}' \
      -d grant_type=client_credentials -d scope=identify "$API/oauth2/token" 2>/dev/null || echo 000)
  case $code in
    200) echo "  OAuth2 client secret OK"; break ;;
    400 | 401)
      warn "Discord rejected the OAuth2 client ID/secret. Copy it again from OAuth2 → Client Secret (Reset Secret if needed)."
      ((ASSUME_YES)) && die "invalid OAuth2 client secret"
      CFG[DISCORD_OAUTH_CLIENT_SECRET]=''
      ask DISCORD_OAUTH_CLIENT_SECRET "OAuth2 Client Secret (hidden)" '^.{16,}$' secret
      ;;
    *) pause "Couldn't reach Discord to check the OAuth2 secret." ;;
  esac
done

# Privileged intents: GUILD_MEMBERS (1<<14 or limited 1<<15), MESSAGE_CONTENT (1<<18 or limited 1<<19).
while :; do
  r=$(discord_get /applications/@me)
  flags=$(body_of "$r" | jq -r '.flags // 0' 2>/dev/null || echo 0)
  [[ $flags =~ ^[0-9]+$ ]] || flags=0
  missing=()
  ((flags & (1 << 14 | 1 << 15))) || missing+=("Server Members Intent")
  ((flags & (1 << 18 | 1 << 19))) || missing+=("Message Content Intent")
  ((${#missing[@]} == 0)) && { echo "  Privileged intents OK"; break; }
  echo "  Turn on in Developer Portal → Bot: ${missing[*]} (then Save Changes)."
  pause "Privileged intents are not enabled."
done

while :; do
  r=$(discord_get "/guilds/${CFG[DISCORD_GUILD_ID]}")
  [[ $(status_of "$r") == 200 ]] && { echo "  Bot is in the server"; break; }
  echo "  The bot isn't in server ${CFG[DISCORD_GUILD_ID]} yet. Invite it (exact permissions, no Administrator):"
  echo "    https://discord.com/oauth2/authorize?client_id=${CFG[DISCORD_APPLICATION_ID]}&scope=bot%20applications.commands&permissions=1099780189223"
  pause "Bot not in the server yet."
done

echo "  Also add this OAuth2 redirect (Developer Portal → OAuth2 → Redirects → Save):"
echo "    https://${CFG[DASHBOARD_DOMAIN]}/api/auth/callback"
((ASSUME_YES)) || read -r -p "  Press Enter once the redirect is saved… " _

# Generated once, never rotated by re-runs.
gen POSTGRES_PASSWORD openssl rand -hex 24
gen SESSION_SECRET openssl rand -base64 48
gen ENCRYPTION_KEY openssl rand -hex 32
CFG[DASHBOARD_URL]="https://${CFG[DASHBOARD_DOMAIN]}"
CFG[NODE_ENV]=production
CFG[LOG_LEVEL]="${CFG[LOG_LEVEL]:-info}"
CFG[WEEKLY_REPORT_ENABLED]="${CFG[WEEKLY_REPORT_ENABLED]:-true}"
CFG[WEEKLY_REPORT_DAY]="${CFG[WEEKLY_REPORT_DAY]:-MONDAY}"
CFG[WEEKLY_REPORT_TIME]="${CFG[WEEKLY_REPORT_TIME]:-09:00}"

tmp="$(mktemp "$ENV_DIR/.gynx.env.XXXXXX")"
{
  echo "# GYNX Discord bot: production configuration. Root-only; never commit."
  echo "# Edit with 'gynx config', then 'gynx restart'."
  for k in $(printf '%s\n' "${!CFG[@]}" | sort); do printf '%s=%s\n' "$k" "${CFG[$k]}"; done
} >"$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
echo "  Saved $ENV_FILE (mode 600)."

# ─── DNS check ──────────────────────────────────────────────────────────────
step "Checking DNS for ${CFG[DASHBOARD_DOMAIN]}"
dns_ips=$(dig +short A "${CFG[DASHBOARD_DOMAIN]}" | grep -E '^[0-9.]+$' || true)
my_ips=$(hostname -I 2>/dev/null || true)
public_ip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
if [[ -z $dns_ips ]]; then
  warn "${CFG[DASHBOARD_DOMAIN]} has no A record yet. Point it at ${public_ip:-this server}; HTTPS starts working once DNS resolves."
elif ! grep -qwF -f <(echo "$dns_ips") <(echo "$my_ips $public_ip"); then
  warn "${CFG[DASHBOARD_DOMAIN]} resolves to $(echo "$dns_ips" | tr '\n' ' ')but this server is ${public_ip:-$my_ips}."
else
  echo "  OK: $(echo "$dns_ips" | tr '\n' ' ')"
fi

# ─── Firewall ───────────────────────────────────────────────────────────────
if ((SETUP_FIREWALL)); then
  step "Firewall (ufw): allowing SSH, HTTP, HTTPS only"
  # `sshd -T` fails on systems using socket activation (no /run/sshd), so fall back to the config file.
  ssh_port=$({ sshd -T 2>/dev/null || true; } | awk '/^port / {print $2; exit}')
  [[ -n $ssh_port ]] || ssh_port=$(awk 'tolower($1)=="port" {print $2; exit}' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true)
  [[ $ssh_port =~ ^[0-9]+$ ]] || ssh_port=22
  ufw allow "${ssh_port:-22}/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443 >/dev/null
  ufw --force enable >/dev/null
  echo "  SSH port ${ssh_port:-22}, 80 and 443 open."
  echo "  Note: Docker manages its own iptables rules; only Caddy publishes ports (80/443)."
fi

# ─── gynx command, backups ──────────────────────────────────────────────────
step "Installing the 'gynx' management command"
sed "s#__APP_DIR__#$APP_DIR#" "$APP_DIR/infrastructure/deployment/gynx.sh" >/usr/local/bin/gynx
chmod 755 /usr/local/bin/gynx
cat >/etc/cron.d/gynx-backup <<'EOF'
# Nightly database backup (kept 14 days in /var/backups/gynx)
30 3 * * * root /usr/local/bin/gynx backup >>/var/log/gynx-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/gynx-backup
echo "  /usr/local/bin/gynx installed; nightly backup at 03:30."

# ─── Build & start ──────────────────────────────────────────────────────────
step "Building and starting (first build takes 5–10 minutes)"
gynx build
gynx start
gynx register-commands || warn "Command registration failed. Check the bot token/application ID, then run: gynx register-commands"
gynx backup >/dev/null || true

# ─── Done ───────────────────────────────────────────────────────────────────
echo
bold "Installed."
cat <<EOF

Dashboard:  ${CFG[DASHBOARD_URL]}

Next:
  1. In Discord → Server Settings → Roles, drag the bot's role above member/self-roles
     and below staff roles.
  2. Sign in to the dashboard as the server owner and follow docs/release-checklist.md
     (permissions, channels, support URL, monitored services).

Day-to-day:  gynx status | gynx logs bot | gynx update | gynx backup | gynx help
EOF
