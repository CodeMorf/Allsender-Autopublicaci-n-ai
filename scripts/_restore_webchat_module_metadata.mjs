
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
const TEAM = 45;
const widgetKey = 'https://store.ecomarket.uno';
const baseUrl = (process.env.AUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://auth.allsender.tech').replace(/\/$/, '');

const settings = {
  websiteUrl: 'https://store.ecomarket.uno/',
  widgetTitle: 'EcoMarket Chat',
  welcomeMessage: 'Hola, somos EcoMarket. ¿En qué podemos ayudarte?',
  widgetColor: '#2563EB',
  collectName: true,
  collectEmail: true,
  offlineMessage: 'Déjanos tu mensaje y te responderemos lo antes posible.',
  position: 'right',
  theme: 'light',
  locale: 'es',
  safeMode: true,
  allowedDomains: 'store.ecomarket.uno\necomarket.uno\nwww.ecomarket.uno',
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
  brandText: 'Equipo disponible',
  responseTimeText: 'Normalmente responde en unos minutos',
  launcherText: 'Chatea con nosotros',
  inputPlaceholder: 'Escribe tu mensaje...',
  poweredByEnabled: true,
  ga4Enabled: false,
  ga4MeasurementId: '',
  ga4ConnectedAt: '',
  ga4LastEventAt: '',
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

const script = `<script id="allsender-webchat" src="${baseUrl}/widget/allsender.js" data-widget="${attr(widgetKey)}" data-widget-key="${attr(widgetKey)}" data-widget-code="${attr(widgetCode)}" data-signature="${attr(signature)}" data-provider="internal" data-channel="web" data-site="${attr(settings.websiteUrl || widgetKey)}" data-position="${attr(settings.position)}" data-theme="${attr(settings.theme)}" data-locale="${attr(settings.locale)}" data-safe-mode="${settings.safeMode ? 'true' : 'false'}" data-widget-title="${attr(settings.widgetTitle)}" data-widget-color="${attr(settings.widgetColor)}" data-welcome-message="${attr(settings.welcomeMessage)}" data-offline-message="${attr(settings.offlineMessage)}" data-collect-name="${settings.collectName ? 'true' : 'false'}" data-collect-email="${settings.collectEmail ? 'true' : 'false'}" data-template="${attr(settings.widgetTemplate)}" data-launcher-style="${attr(settings.launcherStyle)}" data-header-style="${attr(settings.headerStyle)}" data-bubble-style="${attr(settings.bubbleStyle)}" data-radius="${attr(settings.borderRadius)}" data-avatar-url="${attr(settings.avatarUrl)}" data-brand-text="${attr(settings.brandText)}" data-response-time-text="${attr(settings.responseTimeText)}" data-launcher-text="${attr(settings.launcherText)}" data-input-placeholder="${attr(settings.inputPlaceholder)}" data-powered-by="${settings.poweredByEnabled ? 'true' : 'false'}" async></script>`;

const metadata = {
  provider_label: 'AllSender interno',
  public_provider: 'AllSender',
  internal_engine: 'allsender_native_webchat',
  internal_provider: true,
  widget_key: widgetKey,
  widget_code: widgetCode,
  signature,
  settings,
  site: {
    name: settings.widgetTitle,
    domain,
    site_url: settings.websiteUrl,
    widget_key: widgetKey,
    avatar_url: settings.avatarUrl || null,
    help_center_id: null,
  },
  widget: {
    welcome_header: settings.welcomeMessage,
    welcome_tagline: '',
    color: settings.widgetColor,
    bubble_position: settings.position,
    bubble_type: 'standard',
    launcher_title: settings.widgetTitle,
    template: settings.widgetTemplate,
    launcher_style: settings.launcherStyle,
    header_style: settings.headerStyle,
    bubble_style: settings.bubbleStyle,
    border_radius: settings.borderRadius,
    avatar_url: settings.avatarUrl || null,
    brand_text: settings.brandText,
    response_time: 'in_a_few_minutes',
    response_time_text: settings.responseTimeText,
    launcher_text: settings.launcherText,
    input_placeholder: settings.inputPlaceholder,
    powered_by_enabled: settings.poweredByEnabled,
    ga4_enabled: settings.ga4Enabled,
    ga4_measurement_id: settings.ga4MeasurementId || null,
    theme: settings.theme,
    locale: settings.locale,
  },
  design: {
    widgetTemplate: settings.widgetTemplate,
    launcherStyle: settings.launcherStyle,
    headerStyle: settings.headerStyle,
    bubbleStyle: settings.bubbleStyle,
    borderRadius: settings.borderRadius,
    avatarUrl: settings.avatarUrl,
    brandText: settings.brandText,
    responseTimeText: settings.responseTimeText,
    launcherText: settings.launcherText,
    inputPlaceholder: settings.inputPlaceholder,
    poweredByEnabled: settings.poweredByEnabled,
    ga4Enabled: settings.ga4Enabled,
    ga4MeasurementId: settings.ga4MeasurementId,
  },
  analytics: {
    ga4Enabled: settings.ga4Enabled,
    ga4MeasurementId: settings.ga4MeasurementId || null,
    ga4ConnectedAt: null,
    ga4LastEventAt: null,
  },
  features: {
    file_picker: true,
    emoji_picker: true,
    allow_end_conversation: true,
    use_inbox_name_avatar_for_bot: true,
  },
  channel_preferences: {
    welcome_enabled: true,
    welcome_message: settings.welcomeMessage,
    email_collection_enabled: settings.collectEmail,
    allow_messages_after_resolved: true,
    email_continuity_enabled: true,
  },
  assignment: {
    auto_assignment_enabled: true,
    rule: 'round_robin',
    conversation_order: 'earliest_created_first',
  },
  office_hours: {
    enabled: false,
    timezone: 'America/Santo_Domingo',
    days: [1, 2, 3, 4, 5],
    start_time: '08:00',
    end_time: '18:00',
    out_of_hours_message: settings.offlineMessage,
  },
  csat: { enabled: false },
  pre_chat: {
    enabled: true,
    message: 'Comparte tus datos para atenderte mejor.',
    fields: [
      { key: 'fullName', type: 'text', required: true, label: 'Nombre', placeholder: 'Tu nombre' },
      { key: 'emailAddress', type: 'email', required: false, label: 'Email', placeholder: 'tu@email.com' },
    ],
  },
  security: {
    allowed_domains: allowedDomains,
    allow_mobile_apps: true,
    safe_mode: true,
    identity_validation_enabled: false,
    identity_validation_required: false,
    identity_secret_encrypted: null,
  },
  bot: {
    enabled: false,
    mode: 'ai_sales',
    public_name: 'SenAi',
    use_existing_ai_config: true,
    use_existing_sales_agent: true,
    handoff_to_human_enabled: true,
    pause_ai_on_department_assign: true,
  },
  sync: { chatwoot_sync_enabled: false, last_synced_at: null, last_sync_error: null },
  script,
  updated_from: 'client_webchat_module',
  note: 'Web Chat nativo de AllSender. Configurar en /modulo/web-chat. Modulo separado de Sucursales.',
};

const updated = await sql`
  UPDATE channel_connections
  SET
    team_id = ${TEAM},
    provider = 'internal',
    channel_type = 'web',
    display_name = ${settings.widgetTitle},
    status = 'active',
    external_account_id = ${widgetKey},
    metadata = ${sql.json(metadata)},
    updated_at = NOW()
  WHERE module_key = 'web_chat'
    AND (external_account_id = ${widgetKey} OR metadata->>'widget_key' = ${widgetKey} OR id = 1)
  RETURNING id, team_id, display_name,
    metadata->'settings'->>'widgetColor' AS color,
    metadata->'settings'->>'theme' AS theme,
    metadata->'settings'->>'brandText' AS brand,
    metadata->'widget'->>'color' AS widget_color,
    (metadata ? 'design') AS has_design,
    (metadata ? 'take_mode') AS has_take_mode,
    (metadata ? 'visibility') AS has_visibility
`;
console.log(JSON.stringify(updated, null, 2));

await sql`
  UPDATE team_channel_module_subscriptions
  SET status='active', is_active=true, canceled_at=NULL, metadata=${sql.json(metadata)}, updated_at=NOW()
  WHERE team_id=${TEAM} AND module_key='web_chat'
`;

await sql.end({ timeout: 2 });
console.log('RESTORED_OK');
