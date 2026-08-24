#!/usr/bin/env bash
set -euo pipefail

# Ejecuta los cron de Marketing sin exponer secretos en la URL ni en los
# access logs. El endpoint mantiene la compatibilidad con ?key= para llamadas
# antiguas, pero las instalaciones nuevas deben usar Authorization: Bearer.

endpoint="${1:-}"
limit="${2:-80}"
case "$endpoint" in
  comentarios-ia/hydrate|comentarios-ia/respond|autopublicar/generate|autopublicar/publish|autopublicar/retry|autopublicar/cleanup) ;;
  *) echo "endpoint de marketing no permitido" >&2; exit 64 ;;
esac

app_dir="${ALLSENDER_APP_DIR:-/www/wwwroot/auth.allsender.tech}"
env_file="${ALLSENDER_ENV_FILE:-$app_dir/.env}"
base_url="${ALLSENDER_CRON_BASE_URL:-https://auth.allsender.tech}"

env_value() {
  local wanted="$1"
  [ -r "$env_file" ] || return 0
  awk -v wanted="$wanted" '
    /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/ {
      line=$0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, parts, "=")
      key=parts[1]
      if (key != wanted) next
      sub(/^[^=]*=/, "", line)
      gsub(/^"|"$/, "", line)
      gsub(/^\047|\047$/, "", line)
      value=line
    }
    END { print value }
  ' "$env_file"
}

key="${AUTOPUBLICAR_CRON_TOKEN:-}"
[ -n "$key" ] || key="$(env_value AUTOPUBLICAR_CRON_TOKEN)"
[ -n "$key" ] || key="${CRON_SECRET:-}"
[ -n "$key" ] || key="$(env_value CRON_SECRET)"
[ -n "$key" ] || key="${CAMPAIGN_CRON_SECRET:-}"
[ -n "$key" ] || key="$(env_value CAMPAIGN_CRON_SECRET)"
[ -n "$key" ] || key="$(env_value ZERNIO_SYNC_SECRET)"
[ -n "$key" ] || { echo "secreto de cron no configurado" >&2; exit 78; }

lock_dir="$app_dir/storage"
mkdir -p "$lock_dir"
exec 9>"$lock_dir/.marketing-cron-${endpoint//\//-}.lock"
flock -n 9 || exit 0

curl --fail --silent --show-error --max-time 45 \
  -H "Authorization: Bearer $key" \
  -H 'Accept: application/json' \
  "$base_url/api/cron/marketing/$endpoint?limit=$limit"
printf '\n'
