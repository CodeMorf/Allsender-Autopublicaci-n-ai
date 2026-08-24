// Verificar filas de channel_connections del team 94
const { readFileSync } = require('fs');
const postgres = require('postgres');
const env = readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
let url = '';
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^(POSTGRES_URL|DATABASE_URL)=(.*)$/);
  if (m) url = m[2].replace(/^["']|["']$/g, '');
}
const sql = postgres(url, { max: 1 });

(async () => {
  const rows = await sql`
    SELECT id, team_id, module_key, provider, channel_type, display_name, status,
           external_account_id, created_at, updated_at,
           metadata->>'widget_key' AS meta_key,
           metadata->>'widget_code' AS meta_code,
           metadata->>'signature' AS meta_sig,
           metadata->'settings'->>'widgetTitle' AS title,
           metadata->'settings'->>'welcomeMessage' AS welcome,
           metadata->'settings'->>'websiteUrl' AS site
    FROM channel_connections
    WHERE team_id = 94
    ORDER BY created_at
  `;
  console.log('CONNS_TEAM94:', JSON.stringify(rows, null, 2));
  const all = await sql`
    SELECT id, team_id, module_key, status, external_account_id
    FROM channel_connections
    WHERE module_key = 'web_chat' AND provider = 'internal' AND status = 'active'
      AND external_account_id = 'asw_8e7bbc55d213422890adc479b1857206'
  `;
  console.log('BY_KEY:', JSON.stringify(all, null, 2));
  await sql.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
