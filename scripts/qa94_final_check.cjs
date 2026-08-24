const { Pool } = require('pg');

async function main() {
  const envPath = '/www/wwwroot/auth.allsender.tech/.env';
  const fs = require('fs');
  const env = fs.readFileSync(envPath, 'utf8');
  const m = env.match(/^POSTGRES_URL=(.+)$/m) || env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('no POSTGRES_URL/DATABASE_URL in .env');
  const pool = new Pool({ connectionString: m[1].trim() });

  console.log('=== branch_chat_states (team 94) ===');
  try {
    const r = await pool.query(
      `SELECT chat_id, status, branch_id, current_zone, agent_turns, zone_attempts,
              tracking_attempts, updated_at, metadata
       FROM branch_chat_states WHERE team_id = 94 ORDER BY updated_at DESC`
    );
    if (r.rows.length === 0) console.log('(sin filas)');
    for (const row of r.rows) {
      console.log(JSON.stringify(row, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    }
  } catch (e) { console.log('ERROR branch_chat_states:', e.message); }

  console.log('\n=== branch_logs (team 94) — últimos 40 ===');
  try {
    const r = await pool.query(
      `SELECT id, chat_id, event_type, message, metadata, created_at
       FROM branch_logs WHERE team_id = 94 ORDER BY created_at DESC LIMIT 40`
    );
    if (r.rows.length === 0) console.log('(sin filas)');
    for (const row of r.rows) {
      console.log(JSON.stringify({ id: row.id, chat: row.chat_id, event: row.event_type, msg: row.message ? row.message.slice(0, 140) : null, meta: row.metadata ? JSON.stringify(row.metadata).slice(0, 260) : null, at: row.created_at }, null, 1));
    }
  } catch (e) { console.log('ERROR branch_logs:', e.message); }

  console.log('\n=== conversations recientes en branch_chat_states por chat_id ===');
  try {
    const r = await pool.query(
      `SELECT chat_id, status, count(*) FILTER (WHERE status IN ('assigned','branch_selected')) AS assigned_count
       FROM branch_chat_states WHERE team_id = 94 GROUP BY chat_id, status ORDER BY chat_id`
    );
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log('ERROR:', e.message); }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
