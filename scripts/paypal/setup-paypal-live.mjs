import 'dotenv/config';
import postgres from 'postgres';

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Falta POSTGRES_URL o DATABASE_URL.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

const PLAN_DEFINITIONS = [
  {
    key: 'chat_basic_monthly',
    name: 'AllSender Chat Basic Monthly',
    description: 'Web Chat, 1 agente, 1 canal activo y CRM básico.',
    value: '19.00',
    moduleKey: null,
  },
  {
    key: 'chat_pro_monthly',
    name: 'AllSender Chat Pro Monthly',
    description: 'Web Chat, Instagram DM, Facebook Messenger, WhatsApp Evolution y 3 agentes.',
    value: '29.00',
    moduleKey: null,
  },
  {
    key: 'chat_ai_monthly',
    name: 'AllSender Chat AI Monthly',
    description: 'Todo Pro más IA automática, etiquetas inteligentes, seguimiento y resumen.',
    value: '49.00',
    moduleKey: null,
  },
  {
    key: 'chat_business_monthly',
    name: 'AllSender Chat Business Monthly',
    description: 'Canales ampliados, más agentes, prioridad y automatizaciones avanzadas.',
    value: '79.00',
    moduleKey: null,
  },
  { key: 'module_webchat_monthly', name: 'AllSender Module Web Chat Monthly', description: 'Módulo Web Chat con 7 días de prueba.', value: '5.00', moduleKey: 'webchat' },
  { key: 'module_email_monthly', name: 'AllSender Module Email Inbox Monthly', description: 'Módulo Email Inbox con 7 días de prueba.', value: '5.00', moduleKey: 'email' },
  { key: 'module_sms_monthly', name: 'AllSender Module SMS Monthly', description: 'Módulo SMS con 7 días de prueba. El consumo se factura aparte.', value: '5.00', moduleKey: 'sms' },
  { key: 'module_instagram_monthly', name: 'AllSender Module Instagram DM Monthly', description: 'Módulo Instagram DM con 7 días de prueba.', value: '10.00', moduleKey: 'instagram' },
  { key: 'module_facebook_monthly', name: 'AllSender Module Facebook Messenger Monthly', description: 'Módulo Facebook Messenger con 7 días de prueba.', value: '10.00', moduleKey: 'facebook' },
  { key: 'module_whatsapp_monthly', name: 'AllSender Module WhatsApp Monthly', description: 'Módulo WhatsApp con 7 días de prueba. El consumo se factura aparte si aplica.', value: '10.00', moduleKey: 'whatsapp' },
  { key: 'module_tiktok_monthly', name: 'AllSender Module TikTok DM Monthly', description: 'Módulo TikTok DM con 7 días de prueba.', value: '10.00', moduleKey: 'tiktok' },
  { key: 'module_ai_monthly', name: 'AllSender Module AI Automation Monthly', description: 'Módulo IA automática con 7 días de prueba.', value: '15.00', moduleKey: 'ai' },
  { key: 'module_extra_agent_monthly', name: 'AllSender Extra Agent Monthly', description: 'Agente adicional con 7 días de prueba.', value: '5.00', moduleKey: 'extra_agent' },
];

const WEBHOOK_EVENTS = [
  'BILLING.SUBSCRIPTION.CREATED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED',
  'PAYMENT.SALE.REFUNDED',
];

function apiBase(environment) {
  return environment === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

async function getGatewayConfig() {
  const rows = await sql`
    SELECT *
    FROM payment_gateway_settings
    WHERE provider = 'paypal'
    LIMIT 1
  `;

  const config = rows[0];

  if (!config) {
    throw new Error('No existe payment_gateway_settings provider=paypal. Ejecuta primero el SQL.');
  }

  if (!config.client_id || !config.client_secret) {
    throw new Error('PayPal no tiene client_id o client_secret en SQL.');
  }

  return config;
}

async function getAccessToken(config) {
  const basicAuth = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64');

  const response = await fetch(`${apiBase(config.environment)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PayPal OAuth error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function paypalFetch(config, token, path, options = {}) {
  const response = await fetch(`${apiBase(config.environment)}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PayPal API error ${response.status} ${path}: ${body}`);
  }

  if (response.status === 204) return {};
  return response.json();
}

async function ensureProduct(config, token) {
  const [existing] = await sql`
    SELECT *
    FROM paypal_products
    WHERE product_key = 'allsender_saas'
    LIMIT 1
  `;

  if (existing?.paypal_product_id) {
    console.log(`Producto PayPal existente: ${existing.paypal_product_id}`);
    return existing.paypal_product_id;
  }

  const product = await paypalFetch(config, token, '/v1/catalogs/products', {
    method: 'POST',
    body: JSON.stringify({
      name: 'AllSender SaaS',
      description: 'AllSender omnichannel automation platform with chat, CRM, AI and social messaging modules.',
      type: 'SERVICE',
      category: 'SOFTWARE',
      home_url: process.env.AUTH_BASE_URL || process.env.BASE_URL || 'https://auth.allsender.tech',
    }),
  });

  await sql`
    UPDATE paypal_products
    SET paypal_product_id = ${product.id},
        status = ${product.status || 'created'},
        raw_response = ${sql.json(product)},
        updated_at = NOW()
    WHERE product_key = 'allsender_saas'
  `;

  console.log(`Producto PayPal creado: ${product.id}`);
  return product.id;
}

function planPayload(productId, plan) {
  return {
    product_id: productId,
    name: plan.name,
    description: plan.description,
    billing_cycles: [
      {
        frequency: {
          interval_unit: 'DAY',
          interval_count: 7,
        },
        tenure_type: 'TRIAL',
        sequence: 1,
        total_cycles: 1,
        pricing_scheme: {
          fixed_price: {
            value: '0.00',
            currency_code: 'USD',
          },
        },
      },
      {
        frequency: {
          interval_unit: 'MONTH',
          interval_count: 1,
        },
        tenure_type: 'REGULAR',
        sequence: 2,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: {
            value: plan.value,
            currency_code: 'USD',
          },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee: {
        value: '0.00',
        currency_code: 'USD',
      },
      setup_fee_failure_action: 'CONTINUE',
      payment_failure_threshold: 3,
    },
    taxes: {
      percentage: '0',
      inclusive: false,
    },
  };
}

async function ensurePlans(config, token, productId) {
  const created = [];

  for (const plan of PLAN_DEFINITIONS) {
    const [existing] = await sql`
      SELECT *
      FROM paypal_subscription_plans
      WHERE plan_key = ${plan.key}
      LIMIT 1
    `;

    if (existing?.paypal_plan_id) {
      console.log(`Plan existente ${plan.key}: ${existing.paypal_plan_id}`);
      created.push({ key: plan.key, id: existing.paypal_plan_id });
      continue;
    }

    const paypalPlan = await paypalFetch(config, token, '/v1/billing/plans', {
      method: 'POST',
      body: JSON.stringify(planPayload(productId, plan)),
    });

    try {
      await paypalFetch(config, token, `/v1/billing/plans/${paypalPlan.id}/activate`, {
        method: 'POST',
      });
    } catch (error) {
      console.log(`Activación no requerida o no disponible para ${paypalPlan.id}: ${error.message}`);
    }

    await sql`
      UPDATE paypal_subscription_plans
      SET paypal_plan_id = ${paypalPlan.id},
          paypal_product_id = ${productId},
          status = ${paypalPlan.status || 'created'},
          raw_response = ${sql.json(paypalPlan)},
          updated_at = NOW()
      WHERE plan_key = ${plan.key}
    `;

    console.log(`Plan creado ${plan.key}: ${paypalPlan.id}`);
    created.push({ key: plan.key, id: paypalPlan.id });
  }

  return created;
}

async function ensureWebhook(config, token) {
  if (config.webhook_id) {
    console.log(`Webhook PayPal existente: ${config.webhook_id}`);
    return config.webhook_id;
  }

  const webhookUrl = config.webhook_url || `${process.env.AUTH_BASE_URL || process.env.BASE_URL || 'https://auth.allsender.tech'}/api/paypal/webhook`;

  const webhook = await paypalFetch(config, token, '/v1/notifications/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      url: webhookUrl,
      event_types: WEBHOOK_EVENTS.map((name) => ({ name })),
    }),
  });

  await sql`
    UPDATE payment_gateway_settings
    SET webhook_id = ${webhook.id},
        webhook_url = ${webhook.url || webhookUrl},
        metadata = metadata || ${sql.json({ webhook_events: WEBHOOK_EVENTS })},
        updated_at = NOW()
    WHERE provider = 'paypal'
  `;

  console.log(`Webhook PayPal creado: ${webhook.id}`);
  return webhook.id;
}

async function main() {
  const config = await getGatewayConfig();
  console.log(`PayPal environment: ${config.environment}`);

  const token = await getAccessToken(config);
  console.log('PayPal OAuth OK');

  const productId = await ensureProduct(config, token);
  const plans = await ensurePlans(config, token, productId);
  const webhookId = await ensureWebhook(config, token);

  console.log('\n=== IDs para referencia ===');
  console.log(`PAYPAL_PRODUCT_ID=${productId}`);
  for (const plan of plans) {
    console.log(`PAYPAL_PLAN_${plan.key.toUpperCase()}=${plan.id}`);
  }
  console.log(`PAYPAL_WEBHOOK_ID=${webhookId}`);

  console.log('\nListo. Los IDs quedaron guardados en PostgreSQL.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
