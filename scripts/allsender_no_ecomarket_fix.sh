#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="/www/backup/allsender"

mkdir -p "$BACKUP_DIR" 2>/dev/null || true

echo "== AllSender cleanup EcoMarket residual files =="
echo "Root: $ROOT"
echo "Backup: $BACKUP_DIR/auth_allsender_before_no_ecomarket_fix_${STAMP}.tar.gz"

tar -czf "$BACKUP_DIR/auth_allsender_before_no_ecomarket_fix_${STAMP}.tar.gz" . \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./auth_allsender_ai_sales_saas_FULL_SOURCE.zip' \
  --exclude='./auth_allsender_no_ecomarket_FULL_SOURCE.zip' \
  --exclude='./allsender_remove_ecomarket_PATCH.zip' \
  --exclude='./allsender_no_ecomarket_FIX_FINAL.zip' \
  2>/dev/null || true

backup_and_remove() {
  local target="$1"
  if [ -e "$target" ]; then
    mkdir -p "$BACKUP_DIR/removed_ecomarket_${STAMP}/$(dirname "$target")" 2>/dev/null || true
    cp -a "$target" "$BACKUP_DIR/removed_ecomarket_${STAMP}/$target" 2>/dev/null || true
    rm -rf "$target"
    echo "removed: $target"
  fi
}

backup_and_remove 'app/[locale]/(admin)/admin/ecomarket-ai'
backup_and_remove 'lib/ecomarket'
backup_and_remove 'lib/plugins/ai-chat/ecomarket-tools.ts'
backup_and_remove 'data/ecomarket-ai-settings.json'
backup_and_remove 'DEPLOY_ECOMARKET_AI_PER_TEAM.txt'
backup_and_remove 'DEPLOY_ECOMARKET_AI_VENTAS.txt'

clean_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  cp "$file" "${file}.backup.no-ecomarket.${STAMP}"
  awk '
    BEGIN { skip=0 }
    /^[[:space:]]*#[[:space:]]*EcoMarket/ { next }
    /^[[:space:]]*ECOMARKET_/ { next }
    /^[[:space:]]*FORWARD_WEBHOOK_URL=.*(ecomarket|agente\.ecomarket\.uno)/ { next }
    /agente\.ecomarket\.uno/ { next }
    /store\.ecomarket\.uno/ { next }
    { print }
  ' "$file" > "${file}.tmp.no-ecomarket"
  mv "${file}.tmp.no-ecomarket" "$file"
  echo "cleaned: $file"
}

clean_env_file .env
clean_env_file .env.local
clean_env_file .env.production
clean_env_file .env.development
clean_env_file .env.example

rm -rf .next

echo "== Checking residual references in active code =="
if grep -RIn --exclude-dir=node_modules --exclude-dir=.next --exclude='*.zip' --exclude='*.backup*' 'ecomarket\|EcoMarket\|ECOMARKET' app lib components messages .env .env.example 2>/dev/null; then
  echo "WARNING: residual EcoMarket references found above. Review before build."
else
  echo "OK: no EcoMarket references in active app/lib/components/messages/.env/.env.example"
fi

echo "== Done. Now run: npm install && npx tsc --noEmit --pretty false && npm run build && pm2 reload auth-allsender --update-env =="
