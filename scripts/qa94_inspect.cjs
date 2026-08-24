// Inspección rápida de schema + estado team 94 (errores visibles)
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
  const r1 = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'branches' ORDER BY ordinal_position`;
  console.log('BRANCHES COLS:', r1.map((r) => r.column_name).join(','));
  const r2 = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'branch_settings' ORDER BY ordinal_position`;
  console.log('SETTINGS COLS:', r2.map((r) => r.column_name).join(','));
  const r3 = await sql`SELECT id, name, plan_name FROM teams WHERE id = 94`;
  console.log('TEAM:', JSON.stringify(r3));
  const r4 = await sql`SELECT id, is_active, office_hours FROM branch_settings WHERE team_id = 94`;
  console.log('SETTINGS:', JSON.stringify(r4));
  const r5 = await sql`SELECT id, code, name, city, is_active, order_index FROM branches WHERE team_id = 94 ORDER BY order_index`;
  console.log('BRANCHES:', JSON.stringify(r5.map((b) => ({ id: b.id, code: b.code, name: b.name, city: b.city, active: b.is_active }))));
  await sql.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
