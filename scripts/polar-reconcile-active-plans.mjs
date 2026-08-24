import 'dotenv/config';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!databaseUrl) {
  console.error('No se pudo iniciar la sincronización. Falta la conexión de datos.');
  process.exit(1);
}

const includeRecentCheckouts = process.argv.includes('--include-recent-checkouts');
const sql = postgres(databaseUrl, { max: 1 });

async function syncFromSubscriptions() {
  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (team_id)
        team_id,
        plan_id,
        status,
        provider_customer_id,
        provider_subscription_id,
        current_period_start,
        current_period_end
      FROM billing_subscriptions
      WHERE provider = 'polar'
        AND status IN ('active', 'trialing')
        AND team_id IS NOT NULL
        AND plan_id IS NOT NULL
      ORDER BY team_id, updated_at DESC, id DESC
    )
    UPDATE teams t
    SET plan_id = latest.plan_id,
        plan_name = p.name,
        subscription_status = latest.status,
        billing_status = latest.status,
        subscription_provider = 'polar',
        polar_customer_id = COALESCE(latest.provider_customer_id, t.polar_customer_id),
        current_subscription_id = COALESCE(latest.provider_subscription_id, t.current_subscription_id),
        current_period_start = COALESCE(latest.current_period_start, t.current_period_start),
        current_period_end = COALESCE(latest.current_period_end, t.current_period_end),
        updated_at = NOW()
    FROM latest
    JOIN plans p ON p.id = latest.plan_id
    WHERE t.id = latest.team_id
      AND (t.plan_id IS DISTINCT FROM latest.plan_id OR COALESCE(t.subscription_status, '') <> latest.status)
    RETURNING t.id, t.name, p.name AS plan_name, latest.status
  `;
  return rows;
}

async function syncFromPaidOrders() {
  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (team_id)
        team_id,
        user_id,
        plan_id,
        provider_customer_id,
        provider_order_id
      FROM billing_payments
      WHERE provider = 'polar'
        AND status = 'paid'
        AND team_id IS NOT NULL
        AND plan_id IS NOT NULL
      ORDER BY team_id, COALESCE(paid_at, updated_at, created_at) DESC, id DESC
    )
    UPDATE teams t
    SET plan_id = latest.plan_id,
        plan_name = p.name,
        subscription_status = 'active',
        billing_status = 'active',
        subscription_provider = 'polar',
        polar_customer_id = COALESCE(latest.provider_customer_id, t.polar_customer_id),
        updated_at = NOW()
    FROM latest
    JOIN plans p ON p.id = latest.plan_id
    WHERE t.id = latest.team_id
      AND (t.plan_id IS DISTINCT FROM latest.plan_id OR COALESCE(t.subscription_status, '') <> 'active')
    RETURNING t.id, t.name, p.name AS plan_name, latest.provider_order_id
  `;
  return rows;
}

async function syncFromConfirmedCheckouts() {
  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (team_id)
        team_id,
        user_id,
        plan_id,
        checkout_id,
        status
      FROM polar_checkout_sessions
      WHERE team_id IS NOT NULL
        AND plan_id IS NOT NULL
        AND LOWER(COALESCE(status, '')) IN ('confirmed','return_confirmed','succeeded','completed','complete','paid','active')
      ORDER BY team_id, updated_at DESC, id DESC
    )
    UPDATE teams t
    SET plan_id = latest.plan_id,
        plan_name = p.name,
        subscription_status = 'active',
        billing_status = 'active',
        subscription_provider = 'polar',
        updated_at = NOW()
    FROM latest
    JOIN plans p ON p.id = latest.plan_id
    WHERE t.id = latest.team_id
      AND (t.plan_id IS DISTINCT FROM latest.plan_id OR COALESCE(t.subscription_status, '') <> 'active')
    RETURNING t.id, t.name, p.name AS plan_name, latest.checkout_id, latest.status
  `;
  return rows;
}

async function syncFromRecentCheckouts() {
  if (!includeRecentCheckouts) return [];
  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (team_id)
        team_id,
        user_id,
        plan_id,
        checkout_id,
        status
      FROM polar_checkout_sessions
      WHERE team_id IS NOT NULL
        AND plan_id IS NOT NULL
        AND created_at >= NOW() - INTERVAL '48 hours'
      ORDER BY team_id, updated_at DESC, id DESC
    )
    UPDATE teams t
    SET plan_id = latest.plan_id,
        plan_name = p.name,
        subscription_status = 'active',
        billing_status = 'active',
        subscription_provider = 'polar',
        updated_at = NOW()
    FROM latest
    JOIN plans p ON p.id = latest.plan_id
    WHERE t.id = latest.team_id
      AND (t.plan_id IS DISTINCT FROM latest.plan_id OR COALESCE(t.subscription_status, '') <> 'active')
    RETURNING t.id, t.name, p.name AS plan_name, latest.checkout_id, latest.status
  `;
  return rows;
}

async function main() {
  console.log('Sincronizando planes activos Polar...');
  const fromSubscriptions = await syncFromSubscriptions();
  const fromOrders = await syncFromPaidOrders();
  const fromConfirmedCheckouts = await syncFromConfirmedCheckouts();
  const fromRecentCheckouts = await syncFromRecentCheckouts();

  console.log(JSON.stringify({
    subscriptions_updated: fromSubscriptions.length,
    paid_orders_updated: fromOrders.length,
    confirmed_checkouts_updated: fromConfirmedCheckouts.length,
    recent_checkouts_updated: fromRecentCheckouts.length,
    include_recent_checkouts: includeRecentCheckouts,
  }, null, 2));

  if (fromSubscriptions.length) console.table(fromSubscriptions);
  if (fromOrders.length) console.table(fromOrders);
  if (fromConfirmedCheckouts.length) console.table(fromConfirmedCheckouts);
  if (fromRecentCheckouts.length) console.table(fromRecentCheckouts);
}

main()
  .catch((error) => {
    console.error('No se pudo completar la sincronización de planes Polar.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
