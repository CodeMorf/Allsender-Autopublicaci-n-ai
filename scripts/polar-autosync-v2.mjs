#!/usr/bin/env node
/*
  AllSender Polar AutoSync V2
  - Sincroniza productos/precios activos de Polar con los planes comerciales.
  - Ordena el mapeo interno para que el panel muestre solo planes reales.
  - El detalle operativo queda en storage/logs/polar-autosync-v2.log.
*/
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, '.env'));

const LOG_DIR = process.env.POLAR_SYNC_LOG_DIR || path.join(ROOT, 'storage', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'polar-autosync-v2.log');

function safe(value) {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'string' && /polar_(oat|pat|at|rt|whs)_/i.test(v) ? '[oculto]' : v));
  } catch {
    return String(value);
  }
}

function log(message, data) {
  const line = `[${new Date().toISOString()}] ${message}${data === undefined ? '' : ` ${safe(data)}`}`;
  fs.appendFileSync(LOG_FILE, `${line}\n`);
  console.log(line);
}

const configuredPlans = [
  { code: 'gratis_por_siempre_month', name: 'Gratis Por Siempre', interval: 'month', amount_cents: 0, currency: 'usd', visibility: 'public' },
  { code: 'basico_year', name: 'Basico', interval: 'year', amount_cents: null, currency: 'usd', visibility: 'public' },
  { code: 'vendo_por_ti_month', name: 'Vendo por ti', interval: 'month', amount_cents: null, currency: 'usd', visibility: 'public' },
  { code: 'plan_ventas_full_360_month', name: 'Plan Ventas Full 360', interval: 'month', amount_cents: null, currency: 'usd', visibility: 'public' },
  { code: 'plan_inicial_month', name: 'Plan Inicial', interval: 'month', amount_cents: null, currency: 'usd', visibility: 'public' },
  { code: 'plan_emprendedor_month', name: 'Plan Emprendedor', interval: 'month', amount_cents: null, currency: 'usd', visibility: 'public' },
  { code: 'plan_ventas_ia_month', name: 'Plan Ventas IA', interval: 'month', amount_cents: null, currency: 'usd', visibility: 'public' },
  { code: 'plan_omnicanal_pro_month', name: 'Plan Omnicanal Pro', interval: 'month', amount_cents: null, currency: 'usd', visibility: 'public' },
  { code: 'plan_empresa_api_month', name: 'Plan Empresa API', interval: 'month', amount_cents: null, currency: 'usd', visibility: 'public' },
];

function normalizeCode(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function intervalFor(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('year') || raw.includes('annual') || raw.includes('anual') || raw.endsWith('_year')) return 'year';
  if (raw.includes('week')) return 'week';
  return 'month';
}

function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n) && n >= 1000) return n;
  return Math.round(n * 100);
}

function quoteIdent(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function nullIfColumn(cols, name) {
  return cols.has(name) ? `NULLIF(${quoteIdent(name)}::text, '')` : null;
}

function effectiveCodeExpression(cols) {
  const parts = ['plan_code', 'local_plan_key', 'local_plan_code', 'code'].map((name) => nullIfColumn(cols, name)).filter(Boolean);
  return parts.length ? `COALESCE(${parts.join(', ')})` : `NULL::text`;
}

const mode = String(process.env.POLAR_SERVER || process.env.POLAR_MODE || 'sandbox').toLowerCase().includes('prod') ? 'production' : 'sandbox';
const baseUrl = (process.env.POLAR_API_URL || (mode === 'production' ? 'https://api.polar.sh/v1' : 'https://sandbox-api.polar.sh/v1')).replace(/\/$/, '');
const token = process.env.POLAR_OAT || process.env.POLAR_ACCESS_TOKEN || process.env.POLAR_ORGANIZATION_ACCESS_TOKEN || process.env.POLAR_API_KEY || '';
const orgId = process.env.POLAR_ORGANIZATION_ID || process.env.ORGANIZATION_ID || '';
const isOrganizationToken = /^polar_oat_/i.test(token);
const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.DRIZZLE_DATABASE_URL || '';

if (!token) {
  log('Token Polar pendiente. Configura el acceso del proveedor antes de sincronizar.');
  process.exit(2);
}

if (!databaseUrl) {
  log('Conexión de datos pendiente. No se pudo iniciar la sincronización.');
  process.exit(2);
}

let PgClient;
try {
  const pg = await import('pg');
  PgClient = (pg.default || pg).Client;
} catch {
  log('Dependencia de base de datos no disponible.');
  process.exit(2);
}

async function polarRequest(method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`Polar respondió ${response.status}`);
    error.body = json;
    throw error;
  }
  return json;
}

async function listAll(endpoint) {
  const out = [];
  for (let page = 1; page <= 100; page++) {
    const url = new URL(`${baseUrl}${endpoint}`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '100');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Polar respondió ${response.status}`);
      error.body = json;
      throw error;
    }
    const items = Array.isArray(json.items) ? json.items : Array.isArray(json) ? json : [];
    out.push(...items);
    const maxPage = Number(json.pagination?.max_page || json.pagination?.total_pages || 1);
    if (page >= maxPage || items.length === 0) break;
  }
  return out;
}

async function tableExists(db, table) {
  const result = await db.query('SELECT to_regclass($1) AS reg', [`public.${table}`]);
  return Boolean(result.rows[0]?.reg);
}

async function columns(db, table) {
  const result = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
  return new Set(result.rows.map((row) => row.column_name));
}

async function ensureColumn(db, table, name, type) {
  const cols = await columns(db, table);
  if (cols.has(name)) return;
  await db.query(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(name)} ${type}`);
  log('Columna preparada', { table, name });
}

async function ensureTables(db) {
  if (!(await tableExists(db, 'polar_plan_mappings'))) {
    await db.query(`CREATE TABLE polar_plan_mappings (
      id bigserial PRIMARY KEY,
      plan_code text,
      local_plan_key text,
      local_plan_id integer,
      billing_cycle text,
      polar_product_id text,
      polar_price_id text,
      polar_product_name text,
      polar_mode text,
      status text DEFAULT 'connected',
      is_active boolean DEFAULT true,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )`);
  } else {
    await ensureColumn(db, 'polar_plan_mappings', 'plan_code', 'text');
    await ensureColumn(db, 'polar_plan_mappings', 'local_plan_key', 'text');
    await ensureColumn(db, 'polar_plan_mappings', 'local_plan_id', 'integer');
    await ensureColumn(db, 'polar_plan_mappings', 'billing_cycle', 'text');
    await ensureColumn(db, 'polar_plan_mappings', 'polar_product_id', 'text');
    await ensureColumn(db, 'polar_plan_mappings', 'polar_price_id', 'text');
    await ensureColumn(db, 'polar_plan_mappings', 'polar_product_name', 'text');
    await ensureColumn(db, 'polar_plan_mappings', 'polar_mode', 'text');
    await ensureColumn(db, 'polar_plan_mappings', 'status', 'text');
    await ensureColumn(db, 'polar_plan_mappings', 'is_active', 'boolean DEFAULT true');
    await ensureColumn(db, 'polar_plan_mappings', 'created_at', 'timestamptz DEFAULT now()');
    await ensureColumn(db, 'polar_plan_mappings', 'updated_at', 'timestamptz DEFAULT now()');
  }

  if (await tableExists(db, 'plans')) {
    await ensureColumn(db, 'plans', 'polar_product_id', 'text');
    await ensureColumn(db, 'plans', 'polar_price_id', 'text');
    await ensureColumn(db, 'plans', 'polar_plan_key', 'text');
    await ensureColumn(db, 'plans', 'polar_synced_at', 'timestamptz');
    await ensureColumn(db, 'plans', 'polar_sync_status', 'text');
  }
}

async function loadLocalPlans(db) {
  if (!(await tableExists(db, 'plans'))) return new Map();
  const cols = await columns(db, 'plans');
  const result = await db.query(`
    SELECT *
    FROM plans
    WHERE COALESCE(is_active, true) = true
      AND COALESCE(is_published, true) = true
      AND deleted_at IS NULL
    ORDER BY amount ASC, id ASC
  `);
  const byCode = new Map();
  for (const row of result.rows) {
    let code = row.polar_plan_key || row.code || row.slug || row.plan_code || '';
    const nameKey = normalizeName(row.name || '');
    const matchedConfig = configuredPlans.find((plan) => normalizeName(plan.name) === nameKey || normalizeCode(plan.name) === normalizeCode(row.name));
    if (!code && matchedConfig) code = matchedConfig.code;
    code = normalizeCode(code);
    if (!code) continue;
    byCode.set(code, {
      id: row.id || null,
      name: row.name || matchedConfig?.name || code,
      amount_cents: toCents(row.amount_cents ?? row.price_cents ?? row.amount ?? row.price),
      currency: String(row.currency || 'usd').toLowerCase(),
      interval: intervalFor(row.interval || matchedConfig?.interval || code),
      columns: cols,
    });
  }
  return byCode;
}

function mergePlanConfig(localPlans) {
  if (localPlans.size > 0) {
    return Array.from(localPlans.entries()).map(([code, local]) => ({
      code,
      name: local.name || code,
      local_name: local.name || code,
      local_id: local.id || null,
      amount_cents: local.amount_cents ?? null,
      currency: local.currency || 'usd',
      interval: local.interval || intervalFor(code),
      visibility: 'public',
    }));
  }

  return configuredPlans.map((plan) => {
    const local = localPlans.get(plan.code);
    return {
      ...plan,
      local_id: local?.id || null,
      local_name: local?.name || plan.name,
      amount_cents: plan.amount_cents ?? local?.amount_cents ?? null,
      currency: plan.currency || local?.currency || 'usd',
      interval: plan.interval || local?.interval || intervalFor(plan.code),
    };
  });
}

function pricePayload(plan) {
  const amount = toCents(plan.amount_cents);
  const currency = String(plan.currency || 'usd').toLowerCase();
  if (amount === 0) return [{ amount_type: 'free', price_currency: currency }];
  if (amount && amount > 0) return [{ amount_type: 'fixed', price_currency: currency, price_amount: amount }];
  return null;
}

function matchProduct(plan, products) {
  const exactCode = products.find((product) => product?.metadata?.allsender_plan_code === plan.code);
  if (exactCode) return exactCode;
  const planName = normalizeName(plan.name);
  const planLocalName = normalizeName(plan.local_name);
  return products.find((product) => {
    const productName = normalizeName(product?.name);
    const interval = product?.recurring_interval || product?.recurringInterval || plan.interval;
    return (productName === planName || productName === planLocalName) && intervalFor(interval) === intervalFor(plan.interval);
  });
}

function pickPrice(product, plan) {
  const prices = Array.isArray(product?.prices) ? product.prices : [];
  if (!prices.length) return null;
  const currency = String(plan.currency || 'usd').toLowerCase();
  const amount = toCents(plan.amount_cents);
  let price = prices.find((item) => !item.is_archived && String(item.price_currency || item.currency || '').toLowerCase() === currency && (amount === null || Number(item.price_amount ?? item.amount ?? 0) === amount));
  if (!price) price = prices.find((item) => !item.is_archived && String(item.price_currency || item.currency || '').toLowerCase() === currency);
  if (!price) price = prices.find((item) => !item.is_archived) || prices[0];
  return price || null;
}

async function createProduct(plan) {
  const prices = pricePayload(plan);
  if (!prices) {
    log('Plan pendiente de precio en Polar', { code: plan.code, name: plan.name });
    return null;
  }
  const body = {
    name: plan.name,
    description: `Acceso AllSender: ${plan.name}`,
    recurring_interval: plan.interval,
    recurring_interval_count: 1,
    visibility: plan.visibility || 'public',
    metadata: {
      allsender_plan_code: plan.code,
      allsender_local_plan_id: String(plan.local_id || ''),
      source: 'allsender-autosync-v2',
      mode,
    },
    prices,
  };
  if (orgId && !isOrganizationToken) body.organization_id = orgId;
  return polarRequest('POST', '/products/', body);
}

async function updateProduct(product, plan) {
  const metadata = { ...(product.metadata || {}), allsender_plan_code: plan.code, source: 'allsender-autosync-v2', mode };
  const patch = { metadata };
  if (product.name !== plan.name) patch.name = plan.name;
  if (product.visibility !== (plan.visibility || 'public')) patch.visibility = plan.visibility || 'public';
  if (product.is_archived) patch.is_archived = false;
  return polarRequest('PATCH', `/products/${product.id}`, patch).catch(() => ({ ...product, ...patch }));
}

async function existingMappingId(db, code) {
  const cols = await columns(db, 'polar_plan_mappings');
  const expr = effectiveCodeExpression(cols);
  const result = await db.query(`SELECT id FROM polar_plan_mappings WHERE ${expr} = $1 ORDER BY id ASC LIMIT 1`, [code]);
  return result.rows[0]?.id || null;
}

async function saveMapping(db, plan, product, price) {
  const cols = await columns(db, 'polar_plan_mappings');
  const values = {
    plan_code: plan.code,
    local_plan_key: plan.code,
    local_plan_id: plan.local_id,
    billing_cycle: plan.interval === 'year' ? 'yearly' : 'monthly',
    polar_product_id: product.id,
    polar_price_id: price?.id || null,
    polar_product_name: product.name || plan.name,
    polar_mode: mode,
    status: 'connected',
    is_active: true,
    updated_at: new Date(),
  };
  const id = await existingMappingId(db, plan.code);
  if (id) {
    const set = [];
    const args = [];
    let i = 1;
    for (const [key, value] of Object.entries(values)) {
      if (!cols.has(key)) continue;
      set.push(`${quoteIdent(key)} = $${i++}`);
      args.push(value);
    }
    args.push(id);
    await db.query(`UPDATE polar_plan_mappings SET ${set.join(', ')} WHERE id = $${i}`, args);
  } else {
    const names = [];
    const placeholders = [];
    const args = [];
    let i = 1;
    for (const [key, value] of Object.entries(values)) {
      if (!cols.has(key)) continue;
      names.push(quoteIdent(key));
      placeholders.push(`$${i++}`);
      args.push(value);
    }
    await db.query(`INSERT INTO polar_plan_mappings (${names.join(', ')}) VALUES (${placeholders.join(', ')})`, args);
  }

  if (plan.local_id && (await tableExists(db, 'plans'))) {
    const planCols = await columns(db, 'plans');
    const set = [];
    const args = [];
    let i = 1;
    const planValues = {
      polar_product_id: product.id,
      polar_price_id: price?.id || null,
      polar_plan_key: plan.code,
      polar_sync_status: 'connected',
    };
    for (const [key, value] of Object.entries(planValues)) {
      if (!planCols.has(key)) continue;
      set.push(`${quoteIdent(key)} = $${i++}`);
      args.push(value);
    }
    if (planCols.has('polar_synced_at')) set.push('polar_synced_at = NOW()');
    if (planCols.has('updated_at')) set.push('updated_at = NOW()');
    if (set.length) {
      args.push(plan.local_id);
      await db.query(`UPDATE plans SET ${set.join(', ')} WHERE id = $${i}`, args);
    }
  }
}

async function cleanupMappings(db, plans = configuredPlans) {
  if (!(await tableExists(db, 'polar_plan_mappings'))) return;
  const cols = await columns(db, 'polar_plan_mappings');
  const expr = effectiveCodeExpression(cols);
  const finalCodes = plans.map((plan) => plan.code).filter(Boolean);
  if (finalCodes.length === 0) return;
  await db.query(`DELETE FROM polar_plan_mappings WHERE COALESCE(${expr}, '') = '' OR COALESCE(${expr}, '') = '-' OR NOT (COALESCE(${expr}, '') = ANY($1::text[]))`, [finalCodes]);
  if (!cols.has('id')) return;
  await db.query(`WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY COALESCE(${expr}, '')
      ORDER BY CASE WHEN COALESCE(polar_product_id, '') <> '' THEN 0 ELSE 1 END, COALESCE(updated_at, created_at, NOW()) DESC, id DESC
    ) AS rn
    FROM polar_plan_mappings
    WHERE COALESCE(${expr}, '') = ANY($1::text[])
  )
  DELETE FROM polar_plan_mappings ppm
  USING ranked r
  WHERE ppm.id = r.id AND r.rn > 1`, [finalCodes]);
}

async function main() {
  log('Iniciando sincronización Polar AutoSync V2', { mode });
  const db = new PgClient({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  await db.connect();
  try {
    await ensureTables(db);
    const localPlans = await loadLocalPlans(db);
    const plans = mergePlanConfig(localPlans);
    let products = await listAll('/products/');
    products = products.filter((product) => !product.is_archived);
    log('Productos Polar cargados', { count: products.length });

    let connected = 0;
    let created = 0;
    let pending = 0;

    for (const plan of plans) {
      let product = matchProduct(plan, products);
      if (!product) {
        product = await createProduct(plan);
        if (product) {
          created += 1;
          products.push(product);
        }
      } else {
        product = await updateProduct(product, plan);
      }
      if (!product?.id) {
        pending += 1;
        continue;
      }
      const price = pickPrice(product, plan);
      await saveMapping(db, plan, product, price);
      connected += 1;
      log('Plan conectado', { code: plan.code, product_id: product.id, price_id: price?.id || null });
    }

    await cleanupMappings(db, plans);
    log('Sincronización completada', { connected, created, pending, mode });
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  log('La sincronización no se pudo completar.', error.body || error.message || error);
  process.exit(1);
});
