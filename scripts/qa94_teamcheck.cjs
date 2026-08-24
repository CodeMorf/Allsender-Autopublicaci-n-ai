const { Pool } = require('pg');
async function main() {
  const fs = require('fs');
  const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
  const m = env.match(/^POSTGRES_URL=(.+)$/m) || env.match(/^DATABASE_URL=(.+)$/m);
  const pool = new Pool({ connectionString: m[1].trim() });

  for (const teamId of [94, 83]) {
    console.log(`\n===== TEAM ${teamId} =====`);
    try {
      const t = await pool.query(`SELECT id, name, plan, status FROM teams WHERE id = $1`, [teamId]);
      console.log('team:', JSON.stringify(t.rows[0]));
    } catch (e) { console.log('team ERR:', e.message); }
    try {
      const s = await pool.query(
        `SELECT module_code, status, provider FROM team_module_subscriptions WHERE team_id = $1`, [teamId]
      );
      console.log('module_subscriptions:', JSON.stringify(s.rows));
    } catch (e) { console.log('subs ERR:', e.message); }
    try {
      const c = await pool.query(
        `SELECT module_key, status, count(*) FROM channel_connections WHERE team_id = $1 GROUP BY module_key, status`, [teamId]
      );
      console.log('channel_connections:', JSON.stringify(c.rows));
    } catch (e) { console.log('conn ERR:', e.message); }
    try {
      const b = await pool.query(
        `SELECT id, name, code, location_text, keywords, office_hours_enabled, timezone, metadata::text FROM branches WHERE team_id = $1 AND deleted_at IS NULL ORDER BY order_index`, [teamId]
      );
      console.log('branches:', JSON.stringify(b.rows, null, 1));
    } catch (e) { console.log('branches ERR:', e.message); }
    try {
      const bs = await pool.query(
        `SELECT is_active, company_name, company_timezone, fallback_branch_code FROM branch_settings WHERE team_id = $1`, [teamId]
      );
      console.log('branch_settings:', JSON.stringify(bs.rows));
    } catch (e) { console.log('bs ERR:', e.message); }
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
