#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
STAMP="$(date +%Y%m%d_%H%M%S)"

echo "== Backup EcoMarket cleanup $STAMP =="
mkdir -p /www/backup/allsender 2>/dev/null || true
if [ -d . ]; then
  tar -czf "/www/backup/allsender/auth_allsender_before_remove_ecomarket_${STAMP}.tar.gz" . 2>/dev/null || true
fi

echo "== Removing obsolete EcoMarket source files =="
rm -rf 'app/[locale]/(admin)/admin/ecomarket-ai'
rm -rf lib/ecomarket
rm -f lib/plugins/ai-chat/ecomarket-tools.ts
rm -f data/ecomarket-ai-settings.json
rm -f DEPLOY_ECOMARKET_AI_PER_TEAM.txt DEPLOY_ECOMARKET_AI_VENTAS.txt

clean_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  cp "$file" "${file}.backup.remove-ecomarket.${STAMP}"
  grep -v -E '(^[[:space:]]*ECOMARKET_|EcoMarket|ecomarket|agente\.ecomarket\.uno|store\.ecomarket\.uno|^FORWARD_WEBHOOK_URL=.*ecomarket)' "$file" > "${file}.tmp.remove-ecomarket"
  mv "${file}.tmp.remove-ecomarket" "$file"
}

echo "== Cleaning .env references =="
clean_env_file .env
clean_env_file .env.local
clean_env_file .env.production
clean_env_file .env.development
clean_env_file .env.example

rm -rf .next

echo "== EcoMarket removed from AllSender runtime config. Run TypeScript/build/reload next. =="
