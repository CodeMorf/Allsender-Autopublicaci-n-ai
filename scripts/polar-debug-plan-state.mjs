import 'dotenv/config';
import postgres from 'postgres';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [k, ...rest] = arg.replace(/^--/, '').split('=');
  return [k, rest.join('=') || '1'];
}));

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!databaseUrl) {
  console.error('No se pudo revisar la información. Falta la conexión de datos.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
const email = String(args.email || '').trim().toLowerCase();
const teamId = args['team-id'] ? Number(args['team-id']) : 0;

async function main() {
  if (!email && !teamId) {
    console.log('Uso: node scripts/polar-debug-plan-state.mjs --email=cliente@dominio.com');
    console.log('  o: node scripts/polar-debug-plan-state.mjs --team-id=59');
    return;
  }

  const teams = teamId
    ? await sql`
      SELECT t.id, t.name, t.plan_id, t.plan_name, t.subscription_status, t.billing_status, t.subscription_provider,
             t.polar_customer_id, t.current_subscription_id, t.current_period_start, t.current_period_end,
             u.email AS principal_user_email, p.name AS resolved_plan_name
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN users u ON u.id = tm.user_id
      LEFT JOIN plans p ON p.id = t.plan_id
      WHERE t.id = ${teamId}
      ORDER BY tm.role = 'owner' DESC, u.id ASC
      LIMIT 10
    `
    : await sql`
      SELECT DISTINCT ON (t.id) t.id, t.name, t.plan_id, t.plan_name, t.subscription_status, t.billing_status, t.subscription_provider,
             t.polar_customer_id, t.current_subscription_id, t.current_period_start, t.current_period_end,
             u.email AS principal_user_email, p.name AS resolved_plan_name
      FROM users u
      JOIN team_members tm ON tm.user_id = u.id
      JOIN teams t ON t.id = tm.team_id
      LEFT JOIN plans p ON p.id = t.plan_id
      WHERE LOWER(u.email) = ${email}
      ORDER BY t.id, tm.role = 'owner' DESC
    `;

  console.log('\nEquipos encontrados');
  console.table(teams);

  for (const team of teams) {
    console.log(`\n--- Equipo ${team.id}: ${team.name} ---`);

    const checkouts = await sql`
      SELECT id, checkout_id, plan_id, status, polar_product_id, created_at, updated_at
      FROM polar_checkout_sessions
      WHERE team_id = ${team.id}
      ORDER BY updated_at DESC, id DESC
      LIMIT 10
    `;
    console.log('Checkouts Polar locales');
    console.table(checkouts);

    const subs = await sql`
      SELECT id, provider_subscription_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at
      FROM billing_subscriptions
      WHERE provider = 'polar' AND team_id = ${team.id}
      ORDER BY updated_at DESC, id DESC
      LIMIT 10
    `.catch(() => []);
    console.log('Suscripciones locales');
    console.table(subs);

    const payments = await sql`
      SELECT id, provider_order_id, plan_id, status, amount, currency, paid_at, created_at, updated_at
      FROM billing_payments
      WHERE provider = 'polar' AND team_id = ${team.id}
      ORDER BY updated_at DESC, id DESC
      LIMIT 10
    `.catch(() => []);
    console.log('Pagos locales');
    console.table(payments);
  }

  const plans = await sql`
    SELECT id, name, amount, currency, interval, polar_plan_key, polar_product_id, polar_price_id, billing_provider, polar_sync_status
    FROM plans
    ORDER BY amount ASC, id ASC
  `;
  console.log('\nPlanes disponibles');
  console.table(plans);
}

main().catch((error) => {
  console.error('No se pudo revisar el estado del plan.', error);
  process.exitCode = 1;
}).finally(async () => {
  await sql.end({ timeout: 5 });
});
