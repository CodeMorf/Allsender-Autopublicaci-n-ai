// Inspección branches team 94 (v3)
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
  const b = await sql`
    SELECT id, name, code, order_index, is_active, welcome_message, out_of_hours_message,
           timezone, office_hours_enabled, office_days, start_time, end_time, coverage_zones,
           location_text, metadata
    FROM branches WHERE team_id = 94 AND deleted_at IS NULL ORDER BY order_index
  `;
  console.log('BRANCHES:', JSON.stringify(b.map((x) => ({
    id: x.id, code: x.code, name: x.name, order_index: x.order_index, active: x.is_active,
    location: x.location_text, timezone: x.timezone, hours: x.office_hours_enabled ? { days: x.office_days, start: x.start_time, end: x.end_time } : 'always',
    welcome: x.welcome_message, out: x.out_of_hours_message,
    zones: x.coverage_zones, meta: x.metadata,
  })), null, 2));
  await sql.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
