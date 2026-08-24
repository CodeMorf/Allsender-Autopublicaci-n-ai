const { Pool } = require('pg');
async function main() {
  const fs = require('fs');
  const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
  const m = env.match(/^POSTGRES_URL=(.+)$/m) || env.match(/^DATABASE_URL=(.+)$/m);
  const pool = new Pool({ connectionString: m[1].trim() });

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'plans' ORDER BY ordinal_position`
  );
  console.log('plans columns:', cols.rows.map(r => r.column_name).join(', '));

  const teams = await pool.query(`SELECT id, name, plan_id, plan_name, subscription_status, billing_status FROM teams WHERE id IN (94, 83)`);
  console.log('\nteams:', JSON.stringify(teams.rows, null, 1));

  const ids = teams.rows.map(t => t.plan_id).filter(Boolean);
  if (ids.length) {
    const pl = await pool.query(`SELECT * FROM plans WHERE id = ANY($1)`, [ids]);
    for (const row of pl.rows) {
      const copy = { ...row };
      for (const k of Object.keys(copy)) {
        if (typeof copy[k] === 'object') copy[k] = JSON.stringify(copy[k]).slice(0, 800);
      }
      console.log('\nplan:', JSON.stringify(copy, null, 1));
    }
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
