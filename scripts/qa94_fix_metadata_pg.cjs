// Corregir metadata con driver pg (probado en create_foxpack_branches.js)
const fs = require('fs');
const { Pool } = require('pg');
const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
let url = '';
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^(POSTGRES_URL|DATABASE_URL)=(.*)$/);
  if (m) url = m[2].replace(/^["']|["']$/g, '');
}

function domainFromUrl(value) {
  try {
    const u = String(value || '').trim();
    if (!u) return '';
    return new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, '');
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
  let h = 0; const s = String(value || '');
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (Math.abs(h).toString() + Math.abs(h * 7 + 13).toString()).slice(0, length).padStart(length, '0');
}
function attr(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function buildMetadata(widgetKey, settings) {
  const allowedDomains = normalizeDomains(settings.allowedDomains, settings.websiteUrl);
  const domain = domainFromUrl(settings.websiteUrl || widgetKey);
  const widgetCode = numericHash(widgetKey, 8);
  const signature = numericHash(`${widgetKey}|${domain}|${settings.widgetTitle}|${settings.welcomeMessage}|${settings.widgetColor}|${settings.position}|${settings.theme}|${settings.locale}|internal`, 14);
  const script = `<script id="allsender-webchat" src="https://auth.allsender.tech/widget/allsender.js" data-widget-key="${attr(widgetKey)}" data-widget="${attr(widgetKey)}" data-widget-code="${attr(widgetCode)}" data-signature="${attr(signature)}" data-provider="internal" data-channel="web" data-site="${attr(settings.websiteUrl || '')}" data-position="${attr(settings.position)}" data-theme="${attr(settings.theme)}" data-locale="${attr(settings.locale)}" data-safe-mode="${settings.safeMode ? 'true' : 'false'}" data-widget-title="${attr(settings.widgetTitle)}" data-widget-color="${attr(settings.widgetColor)}" data-welcome-message="${attr(settings.welcomeMessage)}" data-offline-message="${attr(settings.offlineMessage)}" data-collect-name="${settings.collectName ? 'true' : 'false'}" data-collect-email="${settings.collectEmail ? 'true' : 'false'}" data-template="${attr(settings.widgetTemplate)}" data-launcher-style="${attr(settings.launcherStyle)}" data-header-style="${attr(settings.headerStyle)}" data-bubble-style="${attr(settings.bubbleStyle)}" data-radius="${attr(settings.borderRadius)}" data-avatar-url="${attr(settings.avatarUrl)}" data-brand-text="${attr(settings.brandText)}" data-response-time-text="${attr(settings.responseTimeText)}" data-launcher-text="${attr(settings.launcherText)}" data-input-placeholder="${attr(settings.inputPlaceholder)}" data-powered-by="${settings.poweredByEnabled ? 'true' : 'false'}" async></script>`;
  return {
    provider_label: 'AllSender interno', public_provider: 'AllSender', internal_engine: 'allsender_native_webchat', internal_provider: true,
    widget_key: widgetKey, widget_code: widgetCode, signature, settings,
    site: { name: settings.widgetTitle, domain, site_url: settings.websiteUrl, widget_key: widgetKey, avatar_url: settings.avatarUrl || null, help_center_id: null },
    widget: {
      welcome_header: settings.welcomeMessage, welcome_tagline: '', color: settings.widgetColor, bubble_position: settings.position,
      bubble_type: 'standard', launcher_title: settings.widgetTitle, template: settings.widgetTemplate, launcher_style: settings.launcherStyle,
      header_style: settings.headerStyle, bubble_style: settings.bubbleStyle, border_radius: settings.borderRadius, avatar_url: settings.avatarUrl || null,
      brand_text: settings.brandText, response_time: 'in_a_few_minutes', response_time_text: settings.responseTimeText,
      launcher_text: settings.launcherText, input_placeholder: settings.inputPlaceholder, powered_by_enabled: settings.poweredByEnabled,
      ga4_enabled: settings.ga4Enabled, ga4_measurement_id: settings.ga4MeasurementId || null, theme: settings.theme, locale: settings.locale,
    },
    design: {
      widgetTemplate: settings.widgetTemplate, launcherStyle: settings.launcherStyle, headerStyle: settings.headerStyle,
      bubbleStyle: settings.bubbleStyle, borderRadius: settings.borderRadius, avatarUrl: settings.avatarUrl, brandText: settings.brandText,
      responseTimeText: settings.responseTimeText, launcherText: settings.launcherText, inputPlaceholder: settings.inputPlaceholder,
      poweredByEnabled: settings.poweredByEnabled, ga4Enabled: settings.ga4Enabled, ga4MeasurementId: settings.ga4MeasurementId,
    },
    analytics: { ga4Enabled: settings.ga4Enabled, ga4MeasurementId: settings.ga4MeasurementId || null, ga4ConnectedAt: null, ga4LastEventAt: null },
    features: { file_picker: true, emoji_picker: true, allow_end_conversation: true, use_inbox_name_avatar_for_bot: true },
    channel_preferences: { welcome_enabled: true, welcome_message: settings.welcomeMessage, email_collection_enabled: settings.collectEmail, allow_messages_after_resolved: true, email_continuity_enabled: true },
    assignment: { auto_assignment_enabled: true, rule: 'round_robin', conversation_order: 'earliest_created_first' },
    office_hours: { enabled: false, timezone: 'America/Santo_Domingo', days: [1, 2, 3, 4, 5], start_time: '08:00', end_time: '18:00', out_of_hours_message: settings.offlineMessage },
    csat: { enabled: settings.csatEnabled },
    pre_chat: { enabled: settings.preChatEnabled, message: 'Comparte tus datos para atenderte mejor.', fields: [
      { key: 'fullName', type: 'text', required: settings.collectName, label: 'Nombre', placeholder: 'Tu nombre' },
      { key: 'emailAddress', type: 'email', required: false, label: 'Email', placeholder: 'tu@email.com' },
    ] },
    security: { allowed_domains: allowedDomains, allow_mobile_apps: true, safe_mode: settings.safeMode, identity_validation_enabled: false, identity_validation_required: false, identity_secret_encrypted: null },
    bot: { enabled: settings.botEnabled, mode: 'ai_sales', public_name: 'SenAi', use_existing_ai_config: true, use_existing_sales_agent: true, handoff_to_human_enabled: true, pause_ai_on_department_assign: true },
    sync: { chatwoot_sync_enabled: false, last_synced_at: null, last_sync_error: null },
    script, updated_from: 'client_webchat_module',
    note: 'Web Chat nativo multi-tenant SaaS. Clave unica asw_* por equipo.',
  };
}

(async () => {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const widgetKey = 'asw_8e7bbc55d213422890adc479b1857206';
    const settings = {
      websiteUrl: 'https://store.ecomarket.uno',
      widgetTitle: 'EcoMarket Chat',
      welcomeMessage: 'Hola, bienvenido a EcoMarket. ¿En qué podemos ayudarte?',
      widgetColor: '#16a34a',
      collectName: true,
      collectEmail: false,
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
    const metadata = buildMetadata(widgetKey, settings);
    const metadataJson = JSON.stringify(metadata);

    const r1 = await client.query(
      'UPDATE channel_connections SET metadata = $1::jsonb, updated_at = NOW() WHERE id = 298 RETURNING id, metadata->>\'widget_key\' AS k, metadata->\'settings\'->>\'widgetTitle\' AS t',
      [metadataJson]
    );
    console.log('UPDATED_CONN:', JSON.stringify(r1.rows));

    const r2 = await client.query(
      "UPDATE team_channel_module_subscriptions SET metadata = $1::jsonb, updated_at = NOW() WHERE team_id = 94 AND module_key = 'web_chat' RETURNING team_id, metadata->>'widget_key' AS k",
      [metadataJson]
    );
    console.log('UPDATED_SUB:', JSON.stringify(r2.rows));

    const chk = await client.query(
      "SELECT metadata->>'widget_code' AS code, metadata->>'signature' AS sig, metadata->'settings'->>'widgetTitle' AS title, metadata->'security'->'allowed_domains' AS domains FROM channel_connections WHERE id = 298"
    );
    console.log('CHECK:', JSON.stringify(chk.rows));
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
