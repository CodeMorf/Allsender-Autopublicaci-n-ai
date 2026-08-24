
import postgres from 'postgres';
import { readFileSync } from 'fs';
const envText = readFileSync('/www/wwwroot/auth.allsender.tech/.env','utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const sql = postgres(process.env.POSTGRES_URL || process.env.DATABASE_URL, { max: 1 });

// free pool: clear assigned on webchat contacts so any agent can take
const cleared = await sql`
  UPDATE contacts
  SET assigned_user_id = NULL
  WHERE team_id = 45
    AND chat_id IN (SELECT id FROM chats WHERE team_id = 45 AND remote_jid LIKE '%@webchat.allsender')
  RETURNING id, chat_id
`;
console.log('CLEARED_ASSIGN', cleared.length);

try {
  await sql`
    UPDATE department_chat_states
    SET assigned_user_id = NULL,
        status = COALESCE(status, 'webchat_open'),
        updated_at = NOW()
    WHERE team_id = 45
      AND chat_id IN (SELECT id FROM chats WHERE team_id = 45 AND remote_jid LIKE '%@webchat.allsender')
  `;
  console.log('DCS_FREE_OK');
} catch(e) { console.log('DCS', e.message); }

// Disable department auto-menu forcing if it blocks free take pool visibility? keep active but no exclusive assign
const depts = await sql`SELECT id, name, is_active FROM departments WHERE team_id=45 AND deleted_at IS NULL`;
console.log('DEPTS', depts);

const list = await sql`
  SELECT c.id, c.name, c.last_message_text, c.unread_count, co.assigned_user_id, dcs.assigned_user_id as dcs_agent, dcs.status
  FROM chats c
  LEFT JOIN contacts co ON co.chat_id = c.id
  LEFT JOIN department_chat_states dcs ON dcs.chat_id = c.id AND dcs.team_id = c.team_id
  WHERE c.team_id = 45 AND c.remote_jid LIKE '%@webchat.allsender'
  ORDER BY c.last_message_timestamp DESC
  LIMIT 10
`;
console.log('POOL', list);
await sql.end({timeout:2});
