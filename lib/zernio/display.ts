const TECHNICAL_ZERNIO_VALUE_RE =
  /^(whatsapp|instagram|facebook|telegram|tiktok|linkedin|youtube|threads|pinterest|googlebusiness|snapchat|discord|twitter|x|reddit|bluesky)_[a-z0-9_-]{12,}$/i;

const ZERNIO_CHANNEL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  x: 'Twitter/X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  threads: 'Threads',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  googlebusiness: 'Google Business',
  telegram: 'Telegram',
  snapchat: 'Snapchat',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
};

export function isZernioTechnicalValue(value?: string | null) {
  const clean = String(value || '').trim();
  if (!clean) return false;
  return clean.includes('@zernio.allsender') || TECHNICAL_ZERNIO_VALUE_RE.test(clean);
}

export function zernioPlatformFromJid(remoteJid?: string | null) {
  const jid = String(remoteJid || '').trim();
  if (!jid.endsWith('@zernio.allsender')) return '';
  const local = jid.replace('@zernio.allsender', '');
  return local.includes('_') ? local.split('_')[0].toLowerCase() : '';
}

export function zernioChannelLabel(platform?: string | null, fallback?: string | null) {
  const key = String(platform || '').toLowerCase().trim();
  return (key && ZERNIO_CHANNEL_LABELS[key]) || fallback || 'Red social';
}

export function normalizeDisplayPhone(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw || isZernioTechnicalValue(raw)) return '';
  const phone = raw.replace(/[^\d+]/g, '');
  if (!/^\+?\d{7,18}$/.test(phone)) return '';
  return phone.startsWith('+') ? phone : `+${phone}`;
}

export function resolveZernioDisplayPhone(input: {
  phone?: string | null;
  externalConversationId?: string | null;
  participantUsername?: string | null;
  participantId?: string | null;
  remoteJid?: string | null;
}) {
  const direct = normalizeDisplayPhone(input.phone)
    || normalizeDisplayPhone(input.externalConversationId)
    || normalizeDisplayPhone(input.participantUsername)
    || normalizeDisplayPhone(input.participantId);
  if (direct) return direct;

  const remoteLocal = String(input.remoteJid || '').split('@')[0] || '';
  return normalizeDisplayPhone(remoteLocal);
}

export function resolveZernioDisplayName(input: {
  name?: string | null;
  pushName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  platform?: string | null;
  channelLabel?: string | null;
  remoteJid?: string | null;
}) {
  const candidates = [input.name, input.pushName, input.contactName];
  for (const value of candidates) {
    const clean = String(value || '').trim();
    if (clean && !isZernioTechnicalValue(clean) && !normalizeDisplayPhone(clean)) {
      return clean;
    }
  }

  const phone = resolveZernioDisplayPhone({ phone: input.phone, remoteJid: input.remoteJid });
  if (phone) return phone;

  const platform = input.platform || zernioPlatformFromJid(input.remoteJid);
  return `${zernioChannelLabel(platform, input.channelLabel)} cliente`;
}
