const { Pool } = require('pg');
async function main() {
  const fs = require('fs');
  const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
  const m = env.match(/^POSTGRES_URL=(.+)$/m) || env.match(/^DATABASE_URL=(.+)$/m);
  const pool = new Pool({ connectionString: m[1].trim() });

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'team_members' ORDER BY ordinal_position`
  );
  console.log('team_members columns:', cols.rows.map(r => r.column_name).join(', '));

  const tm = await pool.query(
    `SELECT * FROM team_members WHERE user_id = 142`
  ).catch(e => ({ rows: [{ err: e.message }] }));
  console.log('team_members 142:', JSON.stringify(tm.rows));

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
