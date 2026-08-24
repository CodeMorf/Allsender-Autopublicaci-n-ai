import fs from 'node:fs';
import postgres from 'postgres';

function loadEnvFile() {
  const text = fs.readFileSync('.env', 'utf8');
  for (const line of text.split('\n')) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || !clean.includes('=')) continue;
    const i = clean.indexOf('=');
    const key = clean.slice(0, i).trim();
    const value = clean.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function arg(name) {
  const found = process.argv.find((x) => x.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=').trim() : '';
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function arraysFrom(value) {
  const arrays = [];
  if (!value) return arrays;
  if (Array.isArray(value)) arrays.push(value);
  for (const key of ['items','data','subscriptions','active_subscriptions','activeSubscriptions']) {
    if (Array.isArray(value?.[key])) arrays.push(value[key]);
  }
  if (Array.isArray(value?.result?.items)) arrays.push(value.result.items);
  if (Array.isArray(value?.result?.data)) arrays.push(value.result.data);
  if (Array.isArray(value?.result?.subscriptions)) arrays.push(value.result.subscriptions);
  if (Array.isArray(value?.customer?.subscriptions)) arrays.push(value.customer.subscriptions);
  if (Array.isArray(value?.customer?.active_subscriptions)) arrays.push(value.customer.active_subscriptions);
  if (Array.isArray(value?.customer?.activeSubscriptions)) arrays.push(value.customer.activeSubscriptions);
  return arrays;
}

function activeStatus(sub) {
  const status = String(first(sub.status, sub.state, sub.subscription_status, sub.subscriptionStatus)).toLowerCase();
  return !status || ['active', 'trialing', 'confirmed', 'past_due'].includes(status);
}

function subscriptionId(sub) {
  return first(sub.id, sub.subscription_id, sub.subscriptionId);
}

function productId(sub) {
  return first(
    sub.product_id,
    sub.productId,
    sub.current_product_id,
    sub.currentProductId,
    sub.product?.id,
    sub.products?.[0]?.id,
    sub.items?.[0]?.product_id,
    sub.items?.[0]?.productId,
    sub.items?.[0]?.product?.id,
    sub.price?.product_id,
    sub.price?.productId,
    sub.price?.product?.id
  );
}

function priceId(sub) {
  return first(
    sub.price_id,
    sub.priceId,
    sub.product_price_id,
    sub.productPriceId,
    sub.product_price?.id,
    sub.productPrice?.id,
    sub.price?.id,
    sub.prices?.[0]?.id,
    sub.items?.[0]?.price_id,
    sub.items?.[0]?.priceId,
    sub.items?.[0]?.price?.id,
    sub.items?.[0]?.product_price_id,
    sub.items?.[0]?.productPriceId,
    sub.items?.[0]?.product_price?.id
  );
}

async function polarGet(path) {
  const token =
    process.env.POLAR_ACCESS_TOKEN ||
    process.env.POLAR_OAT ||
    process.env.POLAR_ORGANIZATION_ACCESS_TOKEN ||
    process.env.POLAR_API_KEY;

  const base =
    process.env.POLAR_API_URL ||
    (String(process.env.POLAR_SERVER || '').toLowerCase() === 'sandbox'
      ? 'https://sandbox-api.polar.sh/v1'
      : 'https://api.polar.sh/v1');

  const url = `${base.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

  if (!response.ok) return null;
  return json;
}

loadEnvFile();
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) {
  console.log('No se encontró conexión disponible.');
  process.exit(1);
}

const email = arg('email');
const teamIdArg = arg('team-id');
const sql = postgres(dbUrl, { max: 1 });

async function main() {
  let teams;
  if (teamIdArg) {
    teams = await sql`SELECT id, name, plan_id, polar_customer_id, current_subscription_id FROM teams WHERE id = ${Number(teamIdArg)} LIMIT 1`;
  } else if (email) {
    teams = await sql`SELECT id, name, plan_id, polar_customer_id, current_subscription_id FROM teams WHERE LOWER(name) LIKE ${`%${email.toLowerCase()}%`} ORDER BY id DESC LIMIT 1`;
  } else {
    console.log('Usa --email=correo@dominio.com o --team-id=61');
    process.exit(1);
  }

  const team = teams[0];
  if (!team) {
    console.log('No se encontró el cliente.');
    process.exit(1);
  }
  if (!team.polar_customer_id) {
    console.log('Este cliente no tiene cliente Polar guardado localmente.');
    process.exit(1);
  }

  console.log('\nCliente local:');
  console.table([team]);

  const customerId = String(team.polar_customer_id);
  const externalId = `team_${team.id}`;
  const responses = [
    await polarGet(`/customers/${encodeURIComponent(customerId)}/state`),
    await polarGet(`/customers/external/${encodeURIComponent(externalId)}/state`),
    await polarGet(`/subscriptions?customer_id=${encodeURIComponent(customerId)}&active=true&limit=100`),
    await polarGet(`/subscriptions?external_customer_id=${encodeURIComponent(externalId)}&active=true&limit=100`),
    await polarGet(`/subscriptions?customer_id=${encodeURIComponent(customerId)}&limit=100`),
    await polarGet(`/subscriptions?external_customer_id=${encodeURIComponent(externalId)}&limit=100`),
  ].filter(Boolean);

  const candidates = responses.flatMap((r) => arraysFrom(r).flat()).filter(Boolean).filter(activeStatus);
  console.log('\nSuscripciones activas detectadas en Polar:');
  console.dir(candidates.map((sub) => ({ id: subscriptionId(sub), status: first(sub.status, sub.state), product_id: productId(sub), price_id: priceId(sub) })), { depth: 4 });

  const active = candidates.find((sub) => productId(sub) || priceId(sub));
  if (!active) {
    console.log('\nNo se detectó una suscripción activa con producto/precio en Polar.');
    process.exit(1);
  }

  const pId = productId(active);
  const prId = priceId(active);
  const sId = subscriptionId(active) || String(team.current_subscription_id || '');

  const plans = await sql`SELECT id, name, polar_product_id, polar_price_id FROM plans ORDER BY id ASC`;
  const matched = plans.find((plan) => {
    const planProduct = String(plan.polar_product_id || '');
    const planPrice = String(plan.polar_price_id || '');
    return (pId && planProduct === pId) || (prId && planPrice === prId);
  });

  if (!matched) {
    console.log('\nNo encontré un plan local conectado a este producto/precio de Polar.');
    console.log('Producto Polar activo:', pId || '(vacío)');
    console.log('Precio Polar activo:', prId || '(vacío)');
    console.table(plans.map((p) => ({ id: p.id, name: p.name, polar_product_id: p.polar_product_id, polar_price_id: p.polar_price_id })));
    process.exit(1);
  }

  console.log('\nPlan detectado para activar localmente:');
  console.table([matched]);

  await sql`
    UPDATE teams
    SET plan_id = ${matched.id},
        subscription_provider = 'polar',
        subscription_status = 'active',
        billing_status = 'active',
        polar_customer_id = ${customerId},
        current_subscription_id = ${sId || null},
        updated_at = NOW()
    WHERE id = ${team.id}
  `;

  const existingSub = await sql`SELECT id FROM billing_subscriptions WHERE provider = 'polar' AND team_id = ${team.id} ORDER BY id DESC LIMIT 1`;
  if (existingSub[0]?.id) {
    await sql`UPDATE billing_subscriptions SET plan_id = ${matched.id}, provider_subscription_id = ${sId || `customer_${customerId}`}, provider_customer_id = ${customerId}, status = 'active', updated_at = NOW() WHERE id = ${existingSub[0].id}`;
  } else {
    await sql`INSERT INTO billing_subscriptions (team_id, plan_id, provider, provider_subscription_id, provider_customer_id, status, created_at, updated_at) VALUES (${team.id}, ${matched.id}, 'polar', ${sId || `customer_${customerId}`}, ${customerId}, 'active', NOW(), NOW())`;
  }

  try {
    await sql`INSERT INTO billing_audit_logs (provider, action, team_id, user_id, metadata, created_at) VALUES ('polar', 'manual_subscription_live_sync', ${team.id}, null, ${JSON.stringify({ plan_id: matched.id, subscription_id: sId, product_id: pId, price_id: prId })}::jsonb, NOW())`;
  } catch {}

  console.log('\nListo. Plan local actualizado desde Polar.');
  console.log(`Cliente: ${team.name}`);
  console.log(`Plan nuevo: ${matched.name}`);
  console.log(`Suscripción Polar: ${sId || '(no disponible)'}`);
}

main().catch(async (error) => {
  console.log('No pudimos completar la sincronización.');
  console.log(error?.message || error);
  await sql.end();
  process.exit(1);
}).finally(async () => {
  await sql.end();
});
