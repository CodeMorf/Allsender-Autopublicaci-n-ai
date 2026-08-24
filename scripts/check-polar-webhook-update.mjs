import fs from 'node:fs';
import postgres from 'postgres';

function loadEnvFile() {
  try {
    const text = fs.readFileSync('.env', 'utf8');
    for (const line of text.split('\n')) {
      const clean = line.trim();
      if (!clean || clean.startsWith('#') || !clean.includes('=')) continue;
      const index = clean.indexOf('=');
      const key = clean.slice(0, index).trim();
      const value = clean.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

loadEnvFile();

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!url) {
  console.log('No se encontró conexión disponible.');
  process.exit(0);
}

const sql = postgres(url, { max: 1 });

async function main() {
  console.log('\n=== ULTIMOS EVENTOS POLAR ===');
  try {
    const events = await sql`
      SELECT id, event_type, polar_object_id, team_id, user_id, processed, created_at
      FROM polar_webhook_events
      ORDER BY id DESC
      LIMIT 20
    `;
    console.table(events);
  } catch (e) {
    console.log('No se pudieron leer eventos Polar:', e.message);
  }

  console.log('\n=== SUSCRIPCIONES POLAR LOCALES ===');
  try {
    const subs = await sql`
      SELECT id, team_id, plan_id, provider, provider_subscription_id, provider_customer_id, status, created_at, updated_at
      FROM billing_subscriptions
      WHERE provider = 'polar'
      ORDER BY id DESC
      LIMIT 20
    `;
    console.table(subs);
  } catch (e) {
    console.log('No se pudieron leer suscripciones:', e.message);
  }

  console.log('\n=== EQUIPOS CON PLAN ACTIVO ===');
  try {
    const teams = await sql`
      SELECT t.id, t.name, t.plan_id, p.name AS plan_name,
             t.subscription_provider, t.subscription_status, t.billing_status,
             t.polar_customer_id, t.current_subscription_id, t.updated_at
      FROM teams t
      LEFT JOIN plans p ON p.id = t.plan_id
      ORDER BY t.updated_at DESC NULLS LAST
      LIMIT 20
    `;
    console.table(teams);
  } catch (e) {
    console.log('No se pudieron leer equipos:', e.message);
  }

  console.log('\n=== PLANES CON POLAR ===');
  try {
    const plans = await sql`
      SELECT id, name, price, polar_product_id, polar_price_id, billing_provider, polar_sync_status
      FROM plans
      ORDER BY id ASC
    `;
    console.table(plans);
  } catch (e) {
    console.log('No se pudieron leer planes:', e.message);
  }

  await sql.end();
}

main().catch(async e => {
  console.error(e);
  await sql.end();
});
