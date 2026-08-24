import 'dotenv/config';
import postgres from 'postgres';

const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const token =
  process.env.POLAR_ACCESS_TOKEN ||
  process.env.POLAR_OAT ||
  process.env.POLAR_ORGANIZATION_ACCESS_TOKEN ||
  process.env.POLAR_API_KEY;

const apiBase = (process.env.POLAR_API_URL ||
  (process.env.POLAR_SERVER === 'production'
    ? 'https://api.polar.sh/v1'
    : 'https://sandbox-api.polar.sh/v1')
).replace(/\/$/, '');

const log = (...args) => console.log('[morf-polar-sync]', ...args);

if (!dbUrl) {
  log('No se pudo conectar con la base de datos.');
  process.exit(1);
}

if (!token) {
  log('Polar no está configurado todavía.');
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 1 });

function moneyLabel(cents, currency) {
  return `${String(currency || 'USD').toUpperCase()} ${(Number(cents || 0) / 100).toFixed(2)}`;
}

function cleanId(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (id.startsWith('PRODUCT_ID_')) return '';
  if (id.startsWith('PRICE_ID_')) return '';
  return id;
}

async function polarFetch(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.detail || data?.message || data?.error || text || `HTTP ${response.status}`;
    const error = new Error(String(message).slice(0, 800));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

function listItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.result?.items)) return payload.result.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function listProducts() {
  const attempts = [
    '/products?limit=100',
    '/products',
  ];

  for (const path of attempts) {
    try {
      return listItems(await polarFetch(path));
    } catch (error) {
      log('No se pudo leer lista de productos con', path);
    }
  }

  return [];
}

function productMatches(product, code) {
  const metadata = product?.metadata || {};
  return (
    String(metadata.allsender_morf_package_code || metadata.package_code || '').toLowerCase() === String(code).toLowerCase()
    || String(product?.name || '').toLowerCase().includes(`morf ai - ${String(code).toLowerCase()}`)
    || String(product?.name || '').toLowerCase().includes(`morf ai ${String(code).toLowerCase()}`)
  );
}

function firstPriceId(product) {
  const candidates = [
    product?.price_id,
    product?.priceId,
    product?.default_price_id,
    product?.defaultPriceId,
    product?.price?.id,
    product?.prices?.[0]?.id,
    product?.recurring_prices?.[0]?.id,
    product?.recurringPrices?.[0]?.id,
  ];

  for (const item of candidates) {
    const id = cleanId(item);
    if (id) return id;
  }

  return '';
}

async function createProduct(pack) {
  const currency = String(pack.currency || 'USD').toLowerCase();
  const amount = Number(pack.amount_cents || 0);
  const productName = `Morf AI - ${pack.name}`;

  const baseMetadata = {
    allsender_billing_type: 'morf_ai_recharge',
    allsender_morf_package_id: String(pack.id),
    allsender_morf_package_code: String(pack.code),
    package_code: String(pack.code),
    credit_cents: String(pack.credit_cents),
    amount_cents: String(pack.amount_cents),
    source: 'allsender_super_admin',
  };

  const payloads = [
    {
      name: productName,
      description: pack.description || `Recarga ${moneyLabel(pack.credit_cents, pack.currency)} para Morf AI.`,
      prices: [
        {
          amount_type: 'fixed',
          price_amount: amount,
          price_currency: currency,
        },
      ],
      metadata: baseMetadata,
    },
    {
      name: productName,
      description: pack.description || `Recarga ${moneyLabel(pack.credit_cents, pack.currency)} para Morf AI.`,
      prices: [
        {
          amountType: 'fixed',
          priceAmount: amount,
          priceCurrency: currency,
        },
      ],
      metadata: baseMetadata,
    },
    {
      name: productName,
      description: pack.description || `Recarga ${moneyLabel(pack.credit_cents, pack.currency)} para Morf AI.`,
      price_amount: amount,
      price_currency: currency,
      metadata: baseMetadata,
    },
  ];

  let lastError = null;

  for (const payload of payloads) {
    try {
      return await polarFetch('/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No se pudo crear producto en Polar.');
}

try {
  const packages = await sql`
    SELECT id::int, code, name, description, amount_cents::int, credit_cents::int, currency,
           NULLIF(COALESCE(polar_product_id, ''), '') AS polar_product_id,
           NULLIF(COALESCE(polar_price_id, ''), '') AS polar_price_id,
           is_active,
           sort_order
    FROM morf_ai_recharge_packages
    WHERE is_active = true
    ORDER BY sort_order ASC, id ASC
  `;

  const products = await listProducts();
  let synced = 0;
  let created = 0;
  let skipped = 0;

  for (const pack of packages) {
    const existingProductId = cleanId(pack.polar_product_id);
    const existingPriceId = cleanId(pack.polar_price_id);

    if (existingProductId && existingPriceId) {
      log(`OK ${pack.code}: ya conectado.`);
      skipped += 1;
      continue;
    }

    let product = products.find((item) => productMatches(item, pack.code));

    if (!product) {
      log(`Creando producto Polar para ${pack.code} ${moneyLabel(pack.amount_cents, pack.currency)}...`);
      product = await createProduct(pack);
      products.push(product);
      created += 1;
    } else {
      log(`Encontrado producto Polar existente para ${pack.code}.`);
    }

    const productId = cleanId(product?.id || product?.product_id || product?.productId);
    const priceId = firstPriceId(product);

    if (!productId) {
      throw new Error(`Polar no devolvió Product ID para ${pack.code}.`);
    }

    await sql`
      UPDATE morf_ai_recharge_packages
      SET polar_product_id = ${productId},
          polar_price_id = NULLIF(${priceId}, ''),
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
            polar_sync: 'ok',
            polar_sync_source: 'super_admin_morf_polar_sync',
            polar_synced_at: new Date().toISOString(),
          })}::jsonb,
          updated_at = NOW()
      WHERE id = ${pack.id}
    `;

    synced += 1;
    log(`Conectado ${pack.code}: product=${productId} price=${priceId || 'pendiente'}`);
  }

  log(`Finalizado. sincronizados=${synced}, creados=${created}, ya_conectados=${skipped}`);
} catch (error) {
  log('La sincronización necesita revisión.');
  log(String(error?.message || error).slice(0, 1200));
  process.exit(1);
} finally {
  await sql.end();
}
