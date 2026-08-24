// Inspección estado team 94 (v2, columnas correctas)
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
  const r = await sql`
    SELECT id, team_id, is_active, company_name, company_timezone, greeting_message,
           ask_location_message, not_found_message, handoff_message, fallback_branch_code,
           pause_ai_on_assign, metadata
    FROM branch_settings WHERE team_id = 94
  `;
  console.log('SETTINGS:', JSON.stringify(r, null, 2));

  const b = await sql`
    SELECT id, name, code, city, order_index, is_active, welcome_message, out_of_hours_message,
           timezone, office_hours_enabled, office_days, start_time, end_time, coverage_zones
    FROM branches WHERE team_id = 94 AND deleted_at IS NULL ORDER BY order_index
  `;
  console.log('BRANCHES:', JSON.stringify(b, null, 2));

  const bs = await sql`
    SELECT b.id, b.code, b.name, bs.status, bs.id as branch_member_id
    FROM branches b
    LEFT JOIN branch_members bs ON bs.branch_id = b.id
    WHERE b.team_id = 94
  `;
  console.log('MEMBERS:', JSON.stringify(bs, null, 2));
  await sql.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
