// QA Sucursales Demo (team 94) — crear/actualizar widget Web Chat nativo (asw_*)
// Replica saveNativeWebChatConnection + buildMetadata de lib/modules/webchat/internal.ts
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import postgres from 'postgres';

const APP_DIR = '/www/wwwroot/auth.allsender.tech';
const envText = readFileSync(`${APP_DIR}/.env`, 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const sql = postgres(process.env.POSTGRES_URL || process.env.DATABASE_URL, { max: 1 });
const baseUrl = 'https://auth.allsender.tech';
const TEAM_ID = 94;

function newKey() { return `asw_${randomUUID().replace(/-/g, '')}`; }
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
function defaultSettings(prev = {}) {
  return {
    websiteUrl: prev.websiteUrl || 'https://store.ecomarket.uno',
    widgetTitle: prev.widgetTitle || 'EcoMarket Chat',
    welcomeMessage: prev.welcomeMessage || 'Hola, bienvenido a EcoMarket. ¿En qué podemos ayudarte?',
    widgetColor: prev.widgetColor || '#16a34a',
    collectName: prev.collectName !== false,
    collectEmail: Boolean(prev.collectEmail),
    offlineMessage: prev.offlineMessage || 'Déjanos tu mensaje y te responderemos lo antes posible.',
    position: prev.position || 'right',
    theme: prev.theme || 'light',
    locale: prev.locale || 'es',
    safeMode: prev.safeMode !== false,
    allowedDomains: prev.allowedDomains || 'store.ecomarket.uno\necomarket.uno\nwww.ecomarket.uno',
    preChatEnabled: prev.preChatEnabled !== false,
    csatEnabled: Boolean(prev.csatEnabled),
    botEnabled: Boolean(prev.botEnabled),
    identityValidationEnabled: Boolean(prev.identityValidationEnabled),
    identityValidationRequired: Boolean(prev.identityValidationRequired),
    widgetTemplate: prev.widgetTemplate || 'modern',
    launcherStyle: prev.launcherStyle || 'bubble',
    headerStyle: prev.headerStyle || 'clean',
    bubbleStyle: prev.bubbleStyle || 'rounded',
    borderRadius: Number(prev.borderRadius || 24),
    avatarUrl: prev.avatarUrl || '',
    brandText: prev.brandText || 'Equipo disponible',
    responseTimeText: prev.responseTimeText || 'Normalmente responde en unos minutos',
    launcherText: prev.launcherText || 'Chatea con nosotros',
    inputPlaceholder: prev.inputPlaceholder || 'Escribe tu mensaje...',
    poweredByEnabled: prev.poweredByEnabled !== false,
    ga4Enabled: Boolean(prev.ga4Enabled),
    ga4MeasurementId: prev.ga4MeasurementId || '',
    ga4ConnectedAt: prev.ga4ConnectedAt || '',
    ga4LastEventAt: prev.ga4LastEventAt || '',
  };
}
function buildMetadata(widgetKey, settings) {
  const allowedDomains = normalizeDomains(settings.allowedDomains, settings.websiteUrl);
  const domain = domainFromUrl(settings.websiteUrl || widgetKey);
  const widgetCode = numericHash(widgetKey, 8);
  const signature = numericHash(`${widgetKey}|${domain}|${settings.widgetTitle}|${settings.welcomeMessage}|${settings.widgetColor}|${settings.position}|${settings.theme}|${settings.locale}|internal`, 14);
  const script = `<script id="allsender-webchat" src="${baseUrl}/widget/allsender.js" data-widget-key="${attr(widgetKey)}" data-widget="${attr(widgetKey)}" data-widget-code="${attr(widgetCode)}" data-signature="${attr(signature)}" data-provider="internal" data-channel="web" data-site="${attr(settings.websiteUrl || '')}" data-position="${attr(settings.position)}" data-theme="${attr(settings.theme)}" data-locale="${attr(settings.locale)}" data-safe-mode="${settings.safeMode ? 'true' : 'false'}" data-widget-title="${attr(settings.widgetTitle)}" data-widget-color="${attr(settings.widgetColor)}" data-welcome-message="${attr(settings.welcomeMessage)}" data-offline-message="${attr(settings.offlineMessage)}" data-collect-name="${settings.collectName ? 'true' : 'false'}" data-collect-email="${settings.collectEmail ? 'true' : 'false'}" data-template="${attr(settings.widgetTemplate)}" data-launcher-style="${attr(settings.launcherStyle)}" data-header-style="${attr(settings.headerStyle)}" data-bubble-style="${attr(settings.bubbleStyle)}" data-radius="${attr(settings.borderRadius)}" data-avatar-url="${attr(settings.avatarUrl)}" data-brand-text="${attr(settings.brandText)}" data-response-time-text="${attr(settings.responseTimeText)}" data-launcher-text="${attr(settings.launcherText)}" data-input-placeholder="${attr(settings.inputPlaceholder)}" data-powered-by="${settings.poweredByEnabled ? 'true' : 'false'}" async></script>`;
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
  // --- 1. Estado actual del team 94 ---
  const team = await sql`SELECT id, name, plan_name, status, is_canceled FROM teams WHERE id = ${TEAM_ID}`.catch(() => []);
  const users = await sql`SELECT u.id, u.email, u.name FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ${TEAM_ID} AND tm.role = 'owner'`.catch(() => []);
  const aiConfigs = await sql`SELECT id, is_active, provider FROM ai_configs WHERE team_id = ${TEAM_ID}`.catch(() => []);
  const branchSettings = await sql`SELECT id, is_active, office_hours FROM branch_settings WHERE team_id = ${TEAM_ID}`.catch(() => []);
  const subs = await sql`SELECT module_key, status, is_active FROM team_channel_module_subscriptions WHERE team_id = ${TEAM_ID} ORDER BY module_key`.catch(() => []);
  const modSubs = await sql`SELECT module_code, status, provider FROM team_module_subscriptions WHERE team_id = ${TEAM_ID} ORDER BY module_code`.catch(() => []);
  const conns = await sql`SELECT id, module_key, provider, status, external_account_id, display_name FROM channel_connections WHERE team_id = ${TEAM_ID}`.catch(() => []);
  const branches = await sql`SELECT code, name, city, is_active FROM branches WHERE team_id = ${TEAM_ID} ORDER BY order_index`.catch(() => []);
  console.log('=== TEAM 94 ESTADO ===');
  console.log('TEAM', JSON.stringify(team));
  console.log('OWNERS', JSON.stringify(users));
  console.log('AI_CONFIGS', JSON.stringify(aiConfigs));
  console.log('BRANCH_SETTINGS', JSON.stringify(branchSettings));
  console.log('SUBS', JSON.stringify(subs));
  console.log('MODULE_SUBS', JSON.stringify(modSubs));
  console.log('CONNS', JSON.stringify(conns));
  console.log('BRANCHES', JSON.stringify(branches.map((b) => ({ code: b.code, name: b.name, active: b.is_active }))));

  // --- 2. Crear/actualizar widget ---
  const settings = defaultSettings({});
  const widgetKey = newKey();
  const metadata = buildMetadata(widgetKey, settings);
  const metadataJson = JSON.stringify(metadata);

  await sql`
    INSERT INTO team_channel_module_subscriptions (team_id, module_key, status, is_active, price_cents, currency, metadata, updated_at)
    VALUES (${TEAM_ID}, 'web_chat', 'active', true, 0, 'usd', ${metadataJson}::jsonb, NOW())
    ON CONFLICT (team_id, module_key)
    DO UPDATE SET status = 'active', is_active = true, canceled_at = NULL, metadata = EXCLUDED.metadata, updated_at = NOW()
  `;
  await sql`
    INSERT INTO channel_connections (team_id, module_key, provider, channel_type, display_name, status, external_account_id, metadata, updated_at)
    VALUES (${TEAM_ID}, 'web_chat', 'internal', 'web', ${settings.widgetTitle}, 'active', ${widgetKey}, ${metadataJson}::jsonb, NOW())
    ON CONFLICT (team_id, module_key)
    DO UPDATE SET provider = 'internal', channel_type = 'web', display_name = ${settings.widgetTitle}, status = 'active', external_account_id = ${widgetKey}, metadata = EXCLUDED.metadata, updated_at = NOW()
  `;

  console.log('=== WIDGET CREADO ===');
  console.log(JSON.stringify({ widgetKey, widgetCode: metadata.widget_code, signature: metadata.signature, title: settings.widgetTitle, websiteUrl: settings.websiteUrl, allowedDomains: metadata.security.allowed_domains }, null, 2));
  console.log('EMBED_SCRIPT_START');
  console.log(metadata.script);
  console.log('EMBED_SCRIPT_END');

  await sql.end();
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
