const { Pool } = require('pg');
async function main() {
  const fs = require('fs');
  const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
  const m = env.match(/^POSTGRES_URL=(.+)$/m) || env.match(/^DATABASE_URL=(.+)$/m);
  const pool = new Pool({ connectionString: m[1].trim() });

  const u = await pool.query(
    `SELECT id, email, name, role FROM users WHERE email = $1`, ['qa.sucursales@allsender.tech']
  );
  console.log('usuario:', JSON.stringify(u.rows));

  if (u.rows[0]) {
    const tm = await pool.query(
      `SELECT team_id, user_id, role, status FROM team_members WHERE user_id = $1`, [u.rows[0].id]
    );
    console.log('team_members:', JSON.stringify(tm.rows));

    for (const row of tm.rows) {
      const t = await pool.query(`SELECT id, name FROM teams WHERE id = $1`, [row.team_id]);
      console.log('team:', JSON.stringify(t.rows[0]));
    }
  }

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
