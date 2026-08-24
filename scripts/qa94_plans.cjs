const { Pool } = require('pg');
async function main() {
  const fs = require('fs');
  const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
  const m = env.match(/^POSTGRES_URL=(.+)$/m) || env.match(/^DATABASE_URL=(.+)$/m);
  const pool = new Pool({ connectionString: m[1].trim() });

  console.log('=== columnas de teams ===');
  const tc = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'teams' ORDER BY ordinal_position`
  );
  console.log(tc.rows.map(r => r.column_name).join(', '));

  console.log('\n=== planes (id, name, status) ===');
  const pl = await pool.query(`SELECT id, name, status FROM plans ORDER BY id`).catch(e => ({ rows: [{ err: e.message }] }));
  console.log(JSON.stringify(pl.rows));

  console.log('\n=== planes con module_codes que incluyan branches o canales ===');
  const pl2 = await pool.query(
    `SELECT id, name, status, module_codes::text AS codes
     FROM plans
     WHERE module_codes::text ILIKE '%branch%' OR module_codes::text ILIKE '%omnichannel%' OR module_codes::text ILIKE '%zernio%'
     ORDER BY id`
  ).catch(e => ({ rows: [{ err: e.message }] }));
  for (const row of pl2.rows) console.log(JSON.stringify(row).slice(0, 500));

  console.log('\n=== teams demo (recientes / demo / ecomarket) ===');
  const tm = await pool.query(
    `SELECT id, name, created_at FROM teams
     WHERE name ILIKE '%demo%' OR name ILIKE '%ecomarket%' OR name ILIKE '%qa%' OR name ILIKE '%sucursal%'
     ORDER BY created_at DESC LIMIT 15`
  ).catch(e => ({ rows: [{ err: e.message }] }));
  console.log(JSON.stringify(tm.rows));

  console.log('\n=== team_plans / suscripcion de planes por team ===');
  const tp = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'team_plans'`
  ).catch(e => ({ rows: [{ err: e.message }] }));
  console.log(JSON.stringify(tp.rows));
  if (tp.rows.length && !tp.rows[0].err) {
    const tp2 = await pool.query(
      `SELECT * FROM team_plans WHERE team_id IN (94, 83) ORDER BY team_id`
    ).catch(e => ({ rows: [{ err: e.message }] }));
    console.log(JSON.stringify(tp2.rows));
  }

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
