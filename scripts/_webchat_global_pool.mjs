
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

// Admin team where global admin works
const ADMIN_TEAM = 45;
const OTHER = 83;
const widgetKey = 'https://store.ecomarket.uno';

// 1) Webchat connection always on admin team (global inbox)
const conn = await sql`
  UPDATE channel_connections
  SET team_id = ${ADMIN_TEAM},
      status = 'active',
      display_name = 'EcoMarket Chat',
      updated_at = NOW(),
      metadata = COALESCE(metadata, '{}'::jsonb) || ${sql.json({
        visibility: 'global_team_pool',
        take_mode: 'first_agent',
        updated_from: 'ops_global_no_restrictions_20260712',
        note: 'Inbox global del equipo admin. Owner/admin ven todos. Agentes: quien tome primero.',
      })}
  WHERE module_key = 'web_chat'
    AND provider = 'internal'
    AND (external_account_id = ${widgetKey} OR metadata->>'widget_key' = ${widgetKey})
  RETURNING id, team_id, status, external_account_id
`;
console.log('CONN', conn);

// 2) Subscriptions: admin team active, other inactive
await sql`
  INSERT INTO team_channel_module_subscriptions
    (team_id, module_key, status, is_active, price_cents, currency, metadata, updated_at)
  VALUES (${ADMIN_TEAM}, 'web_chat', 'active', true, 0, 'usd', ${sql.json({
    widget_key: widgetKey,
    visibility: 'global_team_pool',
    take_mode: 'first_agent',
    included_by_plan: true,
  })}, NOW())
  ON CONFLICT (team_id, module_key)
  DO UPDATE SET status = 'active', is_active = true, canceled_at = NULL, updated_at = NOW()
`;
await sql`
  UPDATE team_channel_module_subscriptions
  SET status = 'inactive', is_active = false, updated_at = NOW()
  WHERE team_id = ${OTHER} AND module_key = 'web_chat'
`;

// 3) Move all webchat chats into admin team (global pool)
const moved = await sql`
  UPDATE chats
  SET team_id = ${ADMIN_TEAM}
  WHERE remote_jid LIKE '%@webchat.allsender'
    AND team_id <> ${ADMIN_TEAM}
  RETURNING id
`;
console.log('MOVED_CHATS_TO_ADMIN', moved.length);

// also ensure any already on admin stay
const ensureContacts = await sql`
  UPDATE contacts
  SET team_id = ${ADMIN_TEAM}
  WHERE chat_id IN (
    SELECT id FROM chats WHERE remote_jid LIKE '%@webchat.allsender'
  )
  RETURNING id
`;
console.log('CONTACTS', ensureContacts.length);

try {
  const dcs = await sql`
    UPDATE department_chat_states
    SET team_id = ${ADMIN_TEAM},
        -- free pool: not locked to a single agent; first take assigns
        assigned_user_id = CASE
          WHEN assigned_user_id IS NULL THEN NULL
          ELSE assigned_user_id
        END,
        updated_at = NOW()
    WHERE chat_id IN (SELECT id FROM chats WHERE remote_jid LIKE '%@webchat.allsender')
    RETURNING chat_id, assigned_user_id, status
  `;
  console.log('DCS', dcs.length);
} catch (e) {
  console.log('DCS_ERR', e.message);
}

// 4) NO branch restrictions for this team (if active, free chats hidden from agents)
try {
  const br = await sql`
    UPDATE branch_settings
    SET is_active = false, updated_at = NOW()
    WHERE team_id = ${ADMIN_TEAM}
    RETURNING team_id, is_active
  `;
  console.log('BRANCH_OFF', br);
} catch (e) {
  console.log('BRANCH_SKIP', e.message);
}

// 5) Make sure EcoMarket owner can also work in admin team pool (as agent) if not already
const eco = await sql`SELECT id, email FROM users WHERE email = 'info@ecomarket.uno' LIMIT 1`;
if (eco[0]) {
  await sql`
    INSERT INTO team_members (user_id, team_id, role, joined_at)
    VALUES (${eco[0].id}, ${ADMIN_TEAM}, 'agent', NOW())
    ON CONFLICT DO NOTHING
  `.catch(async (e) => {
    // try alternate conflict target / columns
    console.log('TM_INSERT_ALT', e.message);
    try {
      const exists = await sql`
        SELECT id FROM team_members WHERE user_id = ${eco[0].id} AND team_id = ${ADMIN_TEAM} LIMIT 1
      `;
      if (!exists[0]) {
        // inspect columns
        const cols = await sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'team_members' ORDER BY ordinal_position
        `;
        console.log('TM_COLS', cols.map((c) => c.column_name));
      } else {
        console.log('TM_EXISTS', exists[0]);
      }
    } catch (e2) {
      console.log('TM_FAIL', e2.message);
    }
  });
}

// 6) Inspect team_members schema and ensure eco membership
const tmCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'team_members' ORDER BY ordinal_position
`;
console.log('TM_COLS', tmCols.map((c) => c.column_name));

const members = await sql`
  SELECT u.email, tm.role
  FROM team_members tm
  JOIN users u ON u.id = tm.user_id
  WHERE tm.team_id = ${ADMIN_TEAM}
`;
console.log('MEMBERS_ADMIN_TEAM', members);

// 7) Verify counts
const counts = await sql`
  SELECT team_id, count(*)::int n
  FROM chats
  WHERE remote_jid LIKE '%@webchat.allsender'
  GROUP BY team_id
`;
console.log('WEBCHAT_BY_TEAM', counts);

const conn2 = await sql`
  SELECT team_id, status, external_account_id
  FROM channel_connections
  WHERE module_key = 'web_chat' AND external_account_id = ${widgetKey}
`;
console.log('CONN2', conn2);

await sql.end({ timeout: 2 });
console.log('DONE_GLOBAL_POOL');
