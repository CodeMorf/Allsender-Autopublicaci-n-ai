
import postgres from 'postgres';
import { readFileSync } from 'fs';
const envText = readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const sql = postgres(process.env.POSTGRES_URL || process.env.DATABASE_URL, { max: 1 });
const FROM = 45, TO = 83;
const widgetKey = 'https://store.ecomarket.uno';

// Inspect current rows
const rows = await sql`
  SELECT id, team_id, status, external_account_id, module_key, provider
  FROM channel_connections
  WHERE module_key = 'web_chat'
    AND (
      external_account_id = ${widgetKey}
      OR metadata->>'widget_key' = ${widgetKey}
      OR team_id IN (${FROM}, ${TO})
    )
`;
console.log('BEFORE', rows);

// Move connection ownership 45 -> 83 by updating team_id
const upd = await sql`
  UPDATE channel_connections
  SET team_id = ${TO},
      status = 'active',
      display_name = 'EcoMarket Chat',
      updated_at = NOW()
  WHERE module_key = 'web_chat'
    AND provider = 'internal'
    AND (
      external_account_id = ${widgetKey}
      OR metadata->>'widget_key' = ${widgetKey}
    )
  RETURNING id, team_id, status, external_account_id
`;
console.log('CONN_MOVED', upd);

// Subscription: ensure 83 active, 45 inactive
await sql`
  INSERT INTO team_channel_module_subscriptions
    (team_id, module_key, status, is_active, price_cents, currency, metadata, updated_at)
  VALUES (${TO}, 'web_chat', 'active', true, 0, 'usd', ${sql.json({ widget_key: widgetKey, source: 'ops_reassign', included_by_plan: true })}, NOW())
  ON CONFLICT (team_id, module_key)
  DO UPDATE SET status='active', is_active=true, canceled_at=NULL, updated_at=NOW()
`;
await sql`
  UPDATE team_channel_module_subscriptions
  SET status='inactive', is_active=false, updated_at=NOW()
  WHERE team_id=${FROM} AND module_key='web_chat'
`;

// Move chats
const movedChats = await sql`
  UPDATE chats SET team_id = ${TO}
  WHERE team_id = ${FROM} AND remote_jid LIKE '%@webchat.allsender'
  RETURNING id
`;
console.log('MOVED_CHATS', movedChats.length);

const movedContacts = await sql`
  UPDATE contacts SET team_id = ${TO}
  WHERE chat_id IN (SELECT id FROM chats WHERE team_id = ${TO} AND remote_jid LIKE '%@webchat.allsender')
  RETURNING id
`;
console.log('MOVED_CONTACTS', movedContacts.length);

try {
  const dcs = await sql`
    UPDATE department_chat_states SET team_id = ${TO}
    WHERE chat_id IN (SELECT id FROM chats WHERE team_id = ${TO} AND remote_jid LIKE '%@webchat.allsender')
    RETURNING chat_id
  `;
  console.log('MOVED_DCS', dcs.length);
} catch (e) {
  console.log('DCS', e.message);
}

const after = await sql`
  SELECT id, team_id, status, external_account_id FROM channel_connections
  WHERE module_key='web_chat' AND (external_account_id=${widgetKey} OR metadata->>'widget_key'=${widgetKey})
`;
console.log('AFTER_CONN', after);
const counts = await sql`
  SELECT team_id, count(*)::int n FROM chats
  WHERE remote_jid LIKE '%@webchat.allsender' GROUP BY team_id
`;
console.log('COUNTS', counts);
await sql.end({ timeout: 2 });
console.log('OK');
