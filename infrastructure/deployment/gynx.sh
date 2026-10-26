#!/usr/bin/env bash
# gynx: manage the GYNX Discord bot stack on this server.
# Installed to /usr/local/bin/gynx by install.sh. Run `gynx help`.
set -euo pipefail

APP_DIR="${GYNX_APP_DIR:-__APP_DIR__}"
ENV_FILE="${GYNX_ENV_FILE:-/etc/gynx/gynx.env}"
BACKUP_DIR="${GYNX_BACKUP_DIR:-/var/backups/gynx}"
BACKUP_KEEP_DAYS="${GYNX_BACKUP_KEEP_DAYS:-14}"
COMPOSE_FILE="$APP_DIR/infrastructure/deployment/docker-compose.prod.yml"

die() { echo "gynx: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[[ $EUID -eq 0 ]] || die "run as root (sudo gynx $*)"
[[ -f "$COMPOSE_FILE" ]] || die "app not found at $APP_DIR"
[[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE (run install.sh first)"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

wait_healthy() {
  local deadline=$((SECONDS + ${1:-300})) svc state
  for svc in bot worker dashboard; do
    while :; do
      state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "gynx-$svc-1" 2>/dev/null || echo missing)
      [[ $state == healthy ]] && { echo "    $svc: healthy"; break; }
      if ((SECONDS > deadline)); then
        echo "    $svc: $state (timed out). Check: gynx logs $svc" >&2
        return 1
      fi
      sleep 3
    done
  done
}

cmd_build() {
  info "Building the app image (takes a few minutes the first time)"
  dc build migrate
}

cmd_up() {
  info "Starting services"
  dc up -d --remove-orphans
  info "Waiting for health checks"
  wait_healthy 300
}

cmd_register_commands() {
  info "Registering slash commands with Discord"
  dc run --rm --no-deps bot node apps/bot/dist/scripts/register-commands.js
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  local file
  file="$BACKUP_DIR/gynx-$(date -u +%Y%m%dT%H%M%SZ).dump"
  info "Backing up database to $file"
  dc exec -T postgres pg_dump -U gynx -d gynx -Fc >"$file.partial"
  mv "$file.partial" "$file"
  chmod 600 "$file"
  find "$BACKUP_DIR" -name 'gynx-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -delete
  echo "    $(du -h "$file" | cut -f1)  (keeping $BACKUP_KEEP_DAYS days)"
}

cmd_restore() {
  local file="${1:-}"
  [[ -f "$file" ]] || die "usage: gynx restore <backup.dump>   (see $BACKUP_DIR)"
  echo "This REPLACES the current database with $file."
  read -r -p "Type 'restore' to continue: " ok
  [[ $ok == restore ]] || die "aborted"
  cmd_backup
  info "Stopping bot, worker and dashboard (prevents duplicate scheduled sends)"
  dc stop bot worker dashboard
  info "Restoring"
  dc exec -T postgres pg_restore -U gynx -d gynx --clean --if-exists --no-owner <"$file"
  info "Applying migrations and restarting"
  dc run --rm migrate
  cmd_up
}

cmd_set() {
  local key=$1 val tmp
  [[ $key =~ ^[A-Z][A-Z0-9_]*$ ]] || die "usage: gynx set KEY   (e.g. gynx set DISCORD_BOT_TOKEN)"
  case $key in
    POSTGRES_PASSWORD | ENCRYPTION_KEY)
      die "$key can't be changed this way: it would lock you out of existing data (see docs/security.md)"
      ;;
  esac
  if [[ $key =~ TOKEN|SECRET|PASSWORD|KEY ]]; then
    read -r -s -p "New value for $key (hidden): " val
    echo
  else
    read -r -p "New value for $key: " val
  fi
  val=$(printf '%s' "$val" | tr -d '\r\n\t ')  # strip stray CR/whitespace from pasted values
  [[ -n $val ]] || die "empty value, nothing changed"
  [[ $val != *$'\n'* ]] || die "value must be a single line"
  tmp=$(mktemp "$(dirname "$ENV_FILE")/.gynx.env.XXXXXX")
  chmod 600 "$tmp"
  grep -v "^${key}=" "$ENV_FILE" >"$tmp" || true
  printf '%s=%s\n' "$key" "$val" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
  echo "Saved $key. Applying…"
  dc up -d --force-recreate --no-deps bot worker dashboard
}

# Print the GitHub webhook settings for the update feed; creates the secret on first use.
cmd_github_webhook() {
  local secret url tmp
  secret=$(grep -E '^GITHUB_WEBHOOK_SECRET=' "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)
  if [[ -z $secret ]]; then
    secret=$(openssl rand -hex 32)
    tmp=$(mktemp "$(dirname "$ENV_FILE")/.gynx.env.XXXXXX")
    chmod 600 "$tmp"
    grep -v '^GITHUB_WEBHOOK_SECRET=' "$ENV_FILE" >"$tmp" || true
    printf 'GITHUB_WEBHOOK_SECRET=%s\n' "$secret" >>"$tmp"
    mv "$tmp" "$ENV_FILE"
    info "Generated GITHUB_WEBHOOK_SECRET; restarting the dashboard"
    dc up -d --force-recreate --no-deps dashboard
  fi
  url=$(grep -E '^DASHBOARD_URL=' "$ENV_FILE" | cut -d= -f2-)
  cat <<EOF
GitHub → repository → Settings → Webhooks → Add webhook:
  Payload URL   ${url%/}/api/webhooks/github
  Content type  application/json
  Secret        $secret
  Events        Let me select individual events → Pushes, Releases
Then add the repository in the dashboard: Status & incidents → Update feed.
Keep the secret private. To rotate it: gynx set GITHUB_WEBHOOK_SECRET (then update every webhook).
EOF
}

cmd_update() {
  if [[ -d "$APP_DIR/.git" ]]; then
    info "Pulling latest code"
    git -C "$APP_DIR" pull --ff-only
  else
    echo "    $APP_DIR is not a git checkout: using the files already there"
  fi
  cmd_backup
  cmd_build
  cmd_up
  cmd_register_commands
  info "Update complete"
}

cmd_status() {
  dc ps
  echo
  for svc in bot worker dashboard; do
    printf '%-10s %s\n' "$svc" "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "gynx-$svc-1" 2>/dev/null || echo 'not running')"
  done
  local url
  url=$(grep -E '^DASHBOARD_URL=' "$ENV_FILE" | cut -d= -f2-)
  echo
  echo "Dashboard: $url"
}

case "${1:-help}" in
  status) cmd_status ;;
  logs) shift; dc logs -f --tail=200 "$@" ;;
  # Recreate (not just restart) so changes in /etc/gynx/gynx.env are picked up.
  restart)
    shift
    (($#)) || set -- bot worker dashboard
    dc up -d --force-recreate --no-deps "$@"
    ;;
  set) shift; cmd_set "${1:-}" ;;
  start | up) cmd_up ;;
  stop | down) dc stop ;;
  build) cmd_build ;;
  update) cmd_update ;;
  backup) cmd_backup ;;
  restore) shift; cmd_restore "${1:-}" ;;
  register-commands) cmd_register_commands ;;
  github-webhook) cmd_github_webhook ;;
  migrate) dc run --rm migrate ;;
  psql) dc exec postgres psql -U gynx -d gynx ;;
  config) "${EDITOR:-nano}" "$ENV_FILE"; echo "Run 'gynx restart' to apply changes." ;;
  help | -h | --help)
    cat <<'EOF'
Usage: gynx <command>

  status              Show service state and the dashboard URL
  logs [service]      Follow logs (bot, worker, dashboard, postgres, caddy, ...)
  restart [service]   Restart bot, worker and dashboard (or one service), applying config changes
  set <KEY>           Change one setting, e.g. gynx set DISCORD_BOT_TOKEN (secrets are hidden)
  start | stop        Start or stop the whole stack
  update              Pull code, back up, rebuild, migrate, restart, re-register commands
  backup              Dump the database to /var/backups/gynx (also runs nightly)
  restore <file>      Restore a backup (takes a safety backup first)
  register-commands   Re-register slash commands with Discord
  github-webhook      Show the GitHub webhook settings for the update feed (creates the secret)
  migrate             Apply database migrations
  psql                Open a database shell
  config              Edit /etc/gynx/gynx.env (then: gynx restart)
EOF
    ;;
  *) die "unknown command '$1' (try: gynx help)" ;;
esac
