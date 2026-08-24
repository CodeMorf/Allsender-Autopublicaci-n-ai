const { Pool } = require('pg');

async function main() {
  const fs = require('fs');
  const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
  const m = env.match(/^POSTGRES_URL=(.+)$/m) || env.match(/^DATABASE_URL=(.+)$/m);
  const pool = new Pool({ connectionString: m[1].trim() });

  console.log('=== columnas de branch_chat_states ===');
  try {
    const r = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'branch_chat_states' ORDER BY ordinal_position`
    );
    console.log(r.rows.map(x => x.column_name + ':' + x.data_type).join(', '));
  } catch (e) { console.log('ERR:', e.message); }

  console.log('\n=== branch_chat_states chat 55115 ===');
  try {
    const r = await pool.query(`SELECT * FROM branch_chat_states WHERE team_id = 94 AND chat_id = 55115`);
    console.log(JSON.stringify(r.rows[0], null, 1));
  } catch (e) { console.log('ERR:', e.message); }

  console.log('\n=== branch_logs chat 55115 (todos) ===');
  try {
    const r = await pool.query(`SELECT event_type, message, metadata, created_at FROM branch_logs WHERE team_id = 94 AND chat_id = 55115 ORDER BY created_at`);
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log('ERR:', e.message); }

  console.log('\n=== eventos branch_logs de hoy con sus chats (agrupado) ===');
  try {
    const r = await pool.query(
      `SELECT chat_id, string_agg(event_type || ':' || left(coalesce(message,''), 40), ' -> ' ORDER BY created_at) AS flow
       FROM branch_logs WHERE team_id = 94 AND created_at > now() - interval '1 day'
       GROUP BY chat_id ORDER BY chat_id`
    );
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log('ERR:', e.message); }

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
