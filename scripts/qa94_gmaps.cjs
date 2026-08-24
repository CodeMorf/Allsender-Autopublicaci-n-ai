const { Pool } = require('pg');
async function main() {
  const fs = require('fs');
  const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
  const m = env.match(/^POSTGRES_URL=(.+)$/m) || env.match(/^DATABASE_URL=(.+)$/m);
  const pool = new Pool({ connectionString: m[1].trim() });
  const r = await pool.query(
    `SELECT key, value::text FROM platform_global_settings WHERE key = 'google_maps'`
  );
  console.log('google_maps config:', JSON.stringify(r.rows, null, 1));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
