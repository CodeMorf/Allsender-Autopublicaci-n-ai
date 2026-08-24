
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

// Team of the real inbox the user is looking at (WhatsApp/FB/Zernio)
const TARGET = 75;
const OLD = 45;
const widgetKey = 'https://store.ecomarket.uno';
const baseUrl = (process.env.AUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://auth.allsender.tech').replace(/\/$/, '');

// Load current metadata if any, keep full structure
const existing = (await sql`
  SELECT metadata FROM channel_connections
  WHERE module_key='web_chat' AND (external_account_id=${widgetKey} OR metadata->>'widget_key'=${widgetKey})
  LIMIT 1
`)[0];

const prevSettings = existing?.metadata?.settings || {};
const settings = {
  websiteUrl: prevSettings.websiteUrl || 'https://store.ecomarket.uno/',
  widgetTitle: prevSettings.widgetTitle || 'EcoMarket Chat',
  welcomeMessage: prevSettings.welcomeMessage || 'Hola, somos EcoMarket. ¿En qué podemos ayudarte?',
  widgetColor: prevSettings.widgetColor || '#2563EB',
  collectName: prevSettings.collectName !== false,
  collectEmail: prevSettings.collectEmail !== false,
  offlineMessage: prevSettings.offlineMessage || 'Déjanos tu mensaje y te responderemos lo antes posible.',
  position: prevSettings.position || 'right',
  theme: prevSettings.theme || 'light',
  locale: prevSettings.locale || 'es',
  safeMode: prevSettings.safeMode !== false,
  allowedDomains: prevSettings.allowedDomains || 'store.ecomarket.uno\necomarket.uno\nwww.ecomarket.uno',
  preChatEnabled: prevSettings.preChatEnabled !== false,
  csatEnabled: Boolean(prevSettings.csatEnabled),
  botEnabled: Boolean(prevSettings.botEnabled),
  identityValidationEnabled: Boolean(prevSettings.identityValidationEnabled),
  identityValidationRequired: Boolean(prevSettings.identityValidationRequired),
  widgetTemplate: prevSettings.widgetTemplate || 'modern',
  launcherStyle: prevSettings.launcherStyle || 'bubble',
  headerStyle: prevSettings.headerStyle || 'clean',
  bubbleStyle: prevSettings.bubbleStyle || 'rounded',
  borderRadius: Number(prevSettings.borderRadius || 24),
  avatarUrl: prevSettings.avatarUrl || '',
  brandText: prevSettings.brandText || 'Equipo disponible',
  responseTimeText: prevSettings.responseTimeText || 'Normalmente responde en unos minutos',
  launcherText: prevSettings.launcherText || 'Chatea con nosotros',
  inputPlaceholder: prevSettings.inputPlaceholder || 'Escribe tu mensaje...',
  poweredByEnabled: prevSettings.poweredByEnabled !== false,
  ga4Enabled: Boolean(prevSettings.ga4Enabled),
  ga4MeasurementId: prevSettings.ga4MeasurementId || '',
  ga4ConnectedAt: prevSettings.ga4ConnectedAt || '',
  ga4LastEventAt: prevSettings.ga4LastEventAt || '',
};

function domainFromUrl(value) {
  try {
    const u = String(value || '').trim();
    if (!u) return '';
    const withProto = u.includes('://') ? u : `https://${u}`;
    return new URL(withProto).hostname.replace(/^www\./, '');
  } catch { return ''; }
}
function normalizeDomains(text, websiteUrl) {
  const raw = String(text || '').split(/[\n,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    .map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''));
  const site = domainFromUrl(websiteUrl);
  const set = new Set(raw);
  if (site) set.add(site);
  return Array.from(set);
}
function numericHash(value, length = 12) {
  let h = 0;
  const s = String(value || '');
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  const n = Math.abs(h).toString() + Math.abs(h * 7 + 13).toString();
  return n.slice(0, length).padStart(length, '0');
}
function attr(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const allowedDomains = normalizeDomains(settings.allowedDomains, settings.websiteUrl);
const domain = domainFromUrl(settings.websiteUrl || widgetKey);
const widgetCode = numericHash(widgetKey, 8);
const signature = numericHash(`${widgetKey}|${domain}|${settings.widgetTitle}|${settings.welcomeMessage}|${settings.widgetColor}|${settings.position}|${settings.theme}|${settings.locale}|internal`, 14);
const script = `<script id="allsender-webchat" src="${baseUrl}/widget/allsender.js" data-widget="${attr(widgetKey)}" data-widget-key="${attr(widgetKey)}" data-channel="web" data-widget-title="${attr(settings.widgetTitle)}" data-widget-color="${attr(settings.widgetColor)}" data-theme="${attr(settings.theme)}" data-brand-text="${attr(settings.brandText)}" data-welcome-message="${attr(settings.welcomeMessage)}" async></script>`;

const metadata = {
  provider_label: 'AllSender interno',
  public_provider: 'AllSender',
  internal_engine: 'allsender_native_webchat',
  internal_provider: true,
  widget_key: widgetKey,
  widget_code: widgetCode,
  signature,
  settings,
  site: { name: settings.widgetTitle, domain, site_url: settings.websiteUrl, widget_key: widgetKey, avatar_url: settings.avatarUrl || null, help_center_id: null },
  widget: {
    welcome_header: settings.welcomeMessage, welcome_tagline: '', color: settings.widgetColor,
    bubble_position: settings.position, bubble_type: 'standard', launcher_title: settings.widgetTitle,
    template: settings.widgetTemplate, launcher_style: settings.launcherStyle, header_style: settings.headerStyle,
    bubble_style: settings.bubbleStyle, border_radius: settings.borderRadius, avatar_url: settings.avatarUrl || null,
    brand_text: settings.brandText, response_time: 'in_a_few_minutes', response_time_text: settings.responseTimeText,
    launcher_text: settings.launcherText, input_placeholder: settings.inputPlaceholder,
    powered_by_enabled: settings.poweredByEnabled, ga4_enabled: settings.ga4Enabled,
    ga4_measurement_id: settings.ga4MeasurementId || null, theme: settings.theme, locale: settings.locale,
  },
  design: {
    widgetTemplate: settings.widgetTemplate, launcherStyle: settings.launcherStyle, headerStyle: settings.headerStyle,
    bubbleStyle: settings.bubbleStyle, borderRadius: settings.borderRadius, avatarUrl: settings.avatarUrl,
    brandText: settings.brandText, responseTimeText: settings.responseTimeText, launcherText: settings.launcherText,
    inputPlaceholder: settings.inputPlaceholder, poweredByEnabled: settings.poweredByEnabled,
    ga4Enabled: settings.ga4Enabled, ga4MeasurementId: settings.ga4MeasurementId,
  },
  analytics: { ga4Enabled: false, ga4MeasurementId: null, ga4ConnectedAt: null, ga4LastEventAt: null },
  features: { file_picker: true, emoji_picker: true, allow_end_conversation: true, use_inbox_name_avatar_for_bot: true },
  channel_preferences: {
    welcome_enabled: true, welcome_message: settings.welcomeMessage,
    email_collection_enabled: settings.collectEmail, allow_messages_after_resolved: true, email_continuity_enabled: true,
  },
  assignment: { auto_assignment_enabled: true, rule: 'round_robin', conversation_order: 'earliest_created_first' },
  office_hours: { enabled: false, timezone: 'America/Santo_Domingo', days: [1,2,3,4,5], start_time: '08:00', end_time: '18:00', out_of_hours_message: settings.offlineMessage },
  csat: { enabled: false },
  pre_chat: {
    enabled: settings.preChatEnabled,
    message: 'Comparte tus datos para atenderte mejor.',
    fields: [
      { key: 'fullName', type: 'text', required: settings.collectName, label: 'Nombre', placeholder: 'Tu nombre' },
      { key: 'emailAddress', type: 'email', required: false, label: 'Email', placeholder: 'tu@email.com' },
    ],
  },
  security: {
    allowed_domains: allowedDomains, allow_mobile_apps: true, safe_mode: settings.safeMode,
    identity_validation_enabled: false, identity_validation_required: false, identity_secret_encrypted: null,
  },
  bot: {
    enabled: false, mode: 'ai_sales', public_name: 'SenAi', use_existing_ai_config: true,
    use_existing_sales_agent: true, handoff_to_human_enabled: true, pause_ai_on_department_assign: true,
  },
  sync: { chatwoot_sync_enabled: false, last_synced_at: null, last_sync_error: null },
  script,
  updated_from: 'client_webchat_module',
  note: 'Web Chat nativo store.ecomarket.uno en el mismo equipo del inbox (75).',
};

// 1) Move connection to team 75 with full metadata
const conn = await sql`
  UPDATE channel_connections
  SET team_id = ${TARGET},
      status = 'active',
      provider = 'internal',
      channel_type = 'web',
      display_name = ${settings.widgetTitle},
      external_account_id = ${widgetKey},
      metadata = ${sql.json(metadata)},
      updated_at = NOW()
  WHERE module_key = 'web_chat'
    AND (external_account_id = ${widgetKey} OR metadata->>'widget_key' = ${widgetKey})
  RETURNING id, team_id, status, display_name
`;
console.log('CONN', conn);

// 2) Subscriptions
await sql`
  INSERT INTO team_channel_module_subscriptions
    (team_id, module_key, status, is_active, price_cents, currency, metadata, updated_at)
  VALUES (${TARGET}, 'web_chat', 'active', true, 0, 'usd', ${sql.json(metadata)}, NOW())
  ON CONFLICT (team_id, module_key)
  DO UPDATE SET status='active', is_active=true, canceled_at=NULL, metadata=${sql.json(metadata)}, updated_at=NOW()
`;
await sql`
  UPDATE team_channel_module_subscriptions
  SET status='inactive', is_active=false, updated_at=NOW()
  WHERE team_id = ${OLD} AND module_key = 'web_chat'
`;

// 3) Move ALL store webchat chats into team 75
const moved = await sql`
  UPDATE chats SET team_id = ${TARGET}
  WHERE remote_jid LIKE '%@webchat.allsender'
  RETURNING id
`;
console.log('MOVED_CHATS', moved.length);

await sql`
  UPDATE contacts SET team_id = ${TARGET}
  WHERE chat_id IN (SELECT id FROM chats WHERE remote_jid LIKE '%@webchat.allsender')
`;
try {
  await sql`
    UPDATE department_chat_states SET team_id = ${TARGET}
    WHERE chat_id IN (SELECT id FROM chats WHERE remote_jid LIKE '%@webchat.allsender')
  `;
} catch (e) { console.log('DCS', e.message); }

// 4) Free assignment so pool is visible
await sql`
  UPDATE contacts SET assigned_user_id = NULL
  WHERE team_id = ${TARGET}
    AND chat_id IN (SELECT id FROM chats WHERE team_id = ${TARGET} AND remote_jid LIKE '%@webchat.allsender')
`;

// 5) Send live hola
console.log('DB_OK');
await sql.end({ timeout: 2 });
