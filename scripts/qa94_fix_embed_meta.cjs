// Actualizar metadata (widget_code/signature) del team 94 con los valores correctos (FNV-1a)
const fs = require('fs');
const { Pool } = require('pg');
const env = fs.readFileSync('/www/wwwroot/auth.allsender.tech/.env', 'utf8');
let url = '';
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^(POSTGRES_URL|DATABASE_URL)=(.*)$/);
  if (m) url = m[2].replace(/^["']|["']$/g, '');
}

function numericHash(value, length = 12) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const first = Math.abs(hash >>> 0).toString().padStart(10, '0');
  let secondValue = 0;
  for (let i = value.length - 1; i >= 0; i -= 1) secondValue = (secondValue * 31 + value.charCodeAt(i)) >>> 0;
  return `${first}${String(secondValue).padStart(10, '0')}`.slice(0, length);
}

(async () => {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const widgetKey = 'asw_8e7bbc55d213422890adc479b1857206';
    const r = await client.query(
      'SELECT metadata FROM channel_connections WHERE id = 298'
    );
    const meta = r.rows[0].metadata;
    const settings = meta.settings;
    const code = numericHash(`code:${widgetKey}`, 8);
    const sig = numericHash(`${widgetKey}|${settings.websiteUrl}|${settings.widgetTitle}|${settings.welcomeMessage}|${settings.widgetColor}|${settings.position}|${settings.theme}|${settings.locale}|internal|web`, 14);
    console.log('COMPUTED code:', code, 'sig:', sig);

    meta.widget_code = code;
    meta.signature = sig;
    meta.script = meta.script.replace(/data-widget-code="[0-9]+"/, `data-widget-code="${code}"`)
      .replace(/data-signature="[0-9]+"/, `data-signature="${sig}"`);

    const up = await client.query(
      'UPDATE channel_connections SET metadata = $1::jsonb, updated_at = NOW() WHERE id = 298 RETURNING metadata->>\'widget_code\' AS code, metadata->>\'signature\' AS sig',
      [JSON.stringify(meta)]
    );
    console.log('UPDATED:', JSON.stringify(up.rows));
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
