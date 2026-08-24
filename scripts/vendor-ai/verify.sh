#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(pwd)}"
cd "$ROOT"

fail() {
  printf 'VENTA AI MORF VERIFY: FAIL - %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail 'node no disponible'
command -v pnpm >/dev/null 2>&1 || fail 'pnpm no disponible'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum no disponible'
[[ -f package.json ]] || fail "package.json no existe en $ROOT"
[[ -f scripts/vendor-ai/CHECKSUMS.sha256 ]] || fail 'falta CHECKSUMS.sha256'
sha256sum -c scripts/vendor-ai/CHECKSUMS.sha256

required_files=(
  lib/morf-ai/runtime/generate.ts
  lib/morf-ai/runtime/index.ts
  lib/morf-ai/runtime/types.ts
  lib/morf-ai/providers/types.ts
  lib/agents/sales/runtime/contract.ts
  lib/agents/sales/runtime/dispatcher.ts
  lib/agents/sales/runtime/registry.ts
  lib/agents/sales/runtime/services.ts
  lib/agents/sales/llm/conversation.ts
  lib/agents/sales/vendor-runtime.ts
  docs/vendor-ai/allsender_100_tools_v1.json
  docs/vendor-ai/contract-preflight.test.ts
)
for file in "${required_files[@]}"; do
  [[ -f "$file" ]] || fail "falta $file"
done

node <<'NODE'
const fs = require('node:fs');
const contract = JSON.parse(fs.readFileSync('docs/vendor-ai/allsender_100_tools_v1.json', 'utf8'));
const names = contract.map((tool) => tool?.function?.name);
if (contract.length !== 102) throw new Error(`tool_count=${contract.length}; expected=102`);
if (new Set(names).size !== 102) throw new Error('duplicate_tool_names');
if (!names.includes('update_order')) throw new Error('update_order_missing');
if (!names.includes('cancel_order')) throw new Error('cancel_order_missing');
const loop = fs.readFileSync('lib/agents/sales/llm/conversation.ts', 'utf8');
if (!loop.includes('morfGenerate(')) throw new Error('morfGenerate_missing');
if (/MISTRAL_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY/.test(loop)) {
  throw new Error('physical_provider_inside_sales_loop');
}
console.log('CONTRACT PASS - 102 unique tools, update_order present, Morf-only active loop');
NODE

mapfile -d '' tests < <(
  find . -type f -name '*.test.ts' \
    -not -path './node_modules/*' \
    -not -path './.next/*' \
    -not -path './.git/*' \
    -print0 | sort -z
)

[[ "${#tests[@]}" -ge 29 ]] || fail "inventario incompleto: ${#tests[@]} tests; esperado al menos 29"

log_dir="$(mktemp -d)"
trap 'rm -rf -- "$log_dir"' EXIT

for test_file in "${tests[@]}"; do
  test_file="${test_file#./}"
  printf 'TEST %s\n' "$test_file"
  log_file="$log_dir/$(printf '%s' "$test_file" | tr '/\\:' '___').log"
  if ! pnpm exec tsx "$test_file" 2>&1 | tee "$log_file"; then
    fail "test fallo: $test_file"
  fi
  if grep -Ei '(^|[^[:alnum:]_])SKIP(PED)?([^[:alnum:]_]|$)' "$log_file" \
    | grep -Eiv 'SKIP(PED)?[[:space:]:=]+0([^[:digit:]]|$)' >/dev/null; then
    fail "test omitido: $test_file"
  fi
  if grep -Eq ':[[:space:]]+FAIL([[:space:]]|$)' "$log_file"; then
    fail "test reporto FAIL: $test_file"
  fi
done

printf 'TYPECHECK\n'
pnpm exec tsc --noEmit --pretty false

printf 'BUILD\n'
export POSTGRES_URL="${POSTGRES_URL:-postgres://venta-ai-build:venta-ai-build@127.0.0.1:1/venta-ai-build}"
export PUSHER_APP_ID="${PUSHER_APP_ID:-venta-ai-build}"
export NEXT_PUBLIC_PUSHER_KEY="${NEXT_PUBLIC_PUSHER_KEY:-venta-ai-build}"
export PUSHER_SECRET="${PUSHER_SECRET:-venta-ai-build}"
export STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-sk_test_venta_ai_build_only}"
pnpm build

git diff --check
printf 'VENTA AI MORF VERIFY: PASS - tests=%s, skipped=0, typecheck=PASS, build=PASS\n' "${#tests[@]}"
