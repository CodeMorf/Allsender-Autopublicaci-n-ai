
import postgres from 'postgres';
import { readFileSync } from 'fs';

// load .env manually
const envText = readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}

const sql = postgres(process.env.POSTGRES_URL || process.env.DATABASE_URL, { max: 1 });
const FROM = 45;
const TO = 83;
const widgetKey = 'https://store.ecomarket.uno';

const settings = {
  websiteUrl: 'https://store.ecomarket.uno/',
  widgetTitle: 'EcoMarket Chat',
  welcomeMessage: 'Hola, somos EcoMarket. ¿En qué podemos ayudarte?',
  widgetColor: '#26282c',
  collectName: true,
  collectEmail: true,
  offlineMessage: 'Déjanos tu mensaje y te responderemos lo antes posible.',
  position: 'right',
  theme: 'light',
  locale: 'es',
  safeMode: true,
  allowedDomains: 'store.ecomarket.uno,ecomarket.uno,www.ecomarket.uno,auth.allsender.tech',
  preChatEnabled: true,
  csatEnabled: false,
  botEnabled: false,
  identityValidationEnabled: false,
  identityValidationRequired: false,
  widgetTemplate: 'modern',
  launcherStyle: 'bubble',
  headerStyle: 'clean',
  bubbleStyle: 'rounded',
  borderRadius: 24,
  avatarUrl: '',
  brandText: 'EcoMarket disponible',
  responseTimeText: 'Normalmente responde en unos minutos',
  launcherText: 'Chatea con nosotros',
  inputPlaceholder: 'Escribe tu mensaje...',
  poweredByEnabled: true,
  ga4Enabled: false,
  ga4MeasurementId: '',
  ga4ConnectedAt: '',
  ga4LastEventAt: '',
};

const metadata = {
  provider_label: 'AllSender interno',
  public_provider: 'AllSender',
  internal_engine: 'allsender_native_webchat',
  internal_provider: true,
  widget_key: widgetKey,
  settings,
  site: {
    name: 'EcoMarket Chat',
    domain: 'store.ecomarket.uno',
    site_url: settings.websiteUrl,
    widget_key: widgetKey,
  },
  security: {
    allowed_domains: ['store.ecomarket.uno', 'ecomarket.uno', 'www.ecomarket.uno', 'auth.allsender.tech'],
    allow_mobile_apps: true,
    safe_mode: true,
  },
  script: '<script src="https://auth.allsender.tech/widget/allsender.js" data-widget="https://store.ecomarket.uno" data-channel="web" async></script>',
  script_version: 'internal-webchat-v3-team83',
  updated_from: 'ops_reassign_ecomarket_team_20260712',
  included_by_plan: true,
  note: 'Web Chat store.ecomarket.uno -> equipo ECOMARKET (83)',
};

const patch = { reassigned_to_team: 83, reason: 'store.ecomarket.uno belongs to ECOMARKET team' };

await sql`
  UPDATE channel_connections
  SET status = 'inactive', updated_at = NOW(),
      metadata = COALESCE(metadata, '{}'::jsonb) || ${sql.json(patch)}
  WHERE team_id = ${FROM} AND module_key = 'web_chat'
`;
await sql`
  UPDATE team_channel_module_subscriptions
  SET status = 'inactive', is_active = false, updated_at = NOW()
  WHERE team_id = ${FROM} AND module_key = 'web_chat'
`;
await sql`
  INSERT INTO team_channel_module_subscriptions
    (team_id, module_key, status, is_active, price_cents, currency, metadata, updated_at)
  VALUES (${TO}, 'web_chat', 'active', true, 0, 'usd', ${sql.json(metadata)}, NOW())
  ON CONFLICT (team_id, module_key)
  DO UPDATE SET status='active', is_active=true, canceled_at=NULL,
    metadata = COALESCE(team_channel_module_subscriptions.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = NOW()
`;
await sql`
  INSERT INTO channel_connections
    (team_id, module_key, provider, channel_type, display_name, status, external_account_id, metadata, updated_at)
  VALUES (${TO}, 'web_chat', 'internal', 'web', 'EcoMarket Chat', 'active', ${widgetKey}, ${sql.json(metadata)}, NOW())
  ON CONFLICT (team_id, module_key)
  DO UPDATE SET provider='internal', channel_type='web', display_name='EcoMarket Chat', status='active',
    external_account_id=${widgetKey},
    metadata = COALESCE(channel_connections.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = NOW()
`;

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
  const movedDcs = await sql`
    UPDATE department_chat_states SET team_id = ${TO}
    WHERE chat_id IN (SELECT id FROM chats WHERE team_id = ${TO} AND remote_jid LIKE '%@webchat.allsender')
    RETURNING chat_id
  `;
  console.log('MOVED_DCS', movedDcs.length);
} catch (e) {
  console.log('DCS_SKIP', e.message);
}

const verify = await sql`
  SELECT team_id, status, external_account_id
  FROM channel_connections
  WHERE module_key='web_chat' AND (external_account_id=${widgetKey} OR metadata->>'widget_key'=${widgetKey})
`;
console.log('CONN', verify);
const counts = await sql`
  SELECT team_id, count(*)::int n FROM chats
  WHERE remote_jid LIKE '%@webchat.allsender' GROUP BY team_id
`;
console.log('COUNTS', counts);
await sql.end({ timeout: 2 });
console.log('OK');
