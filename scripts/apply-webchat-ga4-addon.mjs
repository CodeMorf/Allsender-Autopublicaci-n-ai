import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import dotenv from 'dotenv';

const appDir = process.cwd();
const envPath = path.join(appDir, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.log('[webchat-ga4] DATABASE_URL/POSTGRES_URL no disponible. Se omite inicialización automática.');
  process.exit(0);
}

const sql = postgres(url, { max: 1, ssl: url.includes('sslmode=require') ? 'require' : undefined });

async function main() {
  await sql`
    INSERT INTO saas_modules (code, name, description, base_price_amount, currency, trial_days, is_available, created_at, updated_at)
    VALUES (
      'webchat_ga4',
      'Google Analytics V4',
      'Permite vincular Google Analytics V4 al Web Chat sin cargo adicional cuando el plan lo incluye.',
      '1.00',
      'USD',
      0,
      true,
      NOW(),
      NOW()
    )
    ON CONFLICT (code) DO UPDATE SET
      name = COALESCE(NULLIF(saas_modules.name, ''), EXCLUDED.name),
      description = COALESCE(NULLIF(saas_modules.description, ''), EXCLUDED.description),
      is_available = true,
      updated_at = NOW()
  `;

  try {
    await sql`
      INSERT INTO payment_gateway_settings (
        provider, display_name, environment, client_id, client_secret, webhook_id, webhook_url, is_enabled, metadata, created_at, updated_at
      ) VALUES (
        'webchat_ga4_addon',
        'Add-on Google Analytics V4',
        'production',
        NULL,
        NULL,
        NULL,
        '',
        true,
        ${sql.json({ enabled: true, monthly_price_usd: 1, currency: 'USD', description: 'Vinculación nativa de Google Analytics V4 para medir el Web Chat.', source: 'webchat_ga4_phase2' })},
        NOW(),
        NOW()
      )
      ON CONFLICT (provider) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        metadata = COALESCE(payment_gateway_settings.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_at = NOW()
    `;
  } catch (error) {
    console.log('[webchat-ga4] La configuración comercial global se usará con valores por defecto hasta guardarla desde Super Admin.');
  }

  console.log('[webchat-ga4] Inicialización completada.');
}

main().catch((error) => {
  console.error('[webchat-ga4] No se pudo completar la inicialización:', error?.message || error);
  process.exitCode = 1;
}).finally(async () => {
  await sql.end({ timeout: 5 });
});
