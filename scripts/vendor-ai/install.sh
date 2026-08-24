#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-/www/wwwroot/auth.allsender.tech}"

fail() {
  printf 'VENTA AI MORF INSTALL GUARD: FAIL - %s\n' "$1" >&2
  exit 1
}

[[ "$TARGET" != *'erp.allsender.tech'* ]] || fail 'ruta ERP rechazada; el modulo vive en auth/omnichannel'
[[ -d "$TARGET" ]] || fail "checkout no encontrado: $TARGET"
cd "$TARGET"
command -v node >/dev/null 2>&1 || fail 'node no disponible'
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail 'el destino debe ser un checkout Git; el ZIP no se instala como overlay'

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
NODE

if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
  fail 'merge incompleto en el checkout destino'
fi

printf '%s\n' \
  'VENTA AI MORF INSTALL GUARD: PASS' \
  'Destino correcto: auth/omnichannel.' \
  'Contrato: 102 tools unicas con update_order.' \
  'Loop activo: morfGenerate, sin provider fisico.' \
  'No se copio ningun archivo: el ZIP directo esta bloqueado por diseno.' \
  'Use la rama de integracion aprobada y scripts/vendor-ai/verify.sh antes de solicitar piloto.'
