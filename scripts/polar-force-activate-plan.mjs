import 'dotenv/config';
import postgres from 'postgres';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [k, ...rest] = arg.replace(/^--/, '').split('=');
  return [k, rest.join('=') || '1'];
}));

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!databaseUrl) {
  console.error('No se pudo aplicar el plan. Falta la conexión de datos.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
const email = String(args.email || '').trim().toLowerCase();
const teamIdArg = args['team-id'] ? Number(args['team-id']) : 0;
const planInput = String(args.plan || args['plan-id'] || '').trim();
const status = String(args.status || 'active').trim() || 'active';

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function resolveTeamId() {
  if (teamIdArg > 0) return teamIdArg;
  if (!email) return 0;
  const rows = await sql`
    SELECT t.id
    FROM users u
    JOIN team_members tm ON tm.user_id = u.id
    JOIN teams t ON t.id = tm.team_id
    WHERE LOWER(u.email) = ${email}
    ORDER BY tm.role = 'owner' DESC, t.id ASC
    LIMIT 1
  `;
  return Number(rows[0]?.id || 0);
}

async function resolvePlan() {
  if (!planInput) return null;
  const rows = await sql`
    SELECT id, name, interval, trial_days
    FROM plans
    WHERE id::text = ${planInput}
       OR LOWER(name) = LOWER(${planInput})
       OR LOWER(COALESCE(polar_plan_key, '')) = LOWER(${planInput})
    ORDER BY id ASC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function syncEntitlements(teamId, planId, source) {
  const modules = await sql`
    SELECT pme.module_code, sm.currency
    FROM plan_module_entitlements pme
    JOIN saas_modules sm ON sm.code = pme.module_code
    WHERE pme.plan_id = ${planId} AND pme.is_allowed = true
  `.catch(() => []);

  const channels = await sql`
    SELECT pce.module_key, acm.currency
    FROM plan_channel_entitlements pce
    JOIN allsender_channel_modules acm ON acm.module_key = pce.module_key
    WHERE pce.plan_id = ${planId} AND pce.is_allowed = true
  `.catch(() => []);

  if (modules.length === 0) {
    await sql`
      UPDATE team_module_subscriptions
      SET status = 'inactive', updated_at = NOW()
      WHERE team_id = ${teamId} AND provider = 'plan_entitlement'
    `.catch(() => null);
  }

  for (const mod of modules) {
    await sql`
      INSERT INTO team_module_subscriptions (
        team_id, module_code, status, trial_started_at, trial_ends_at,
        price_amount, currency, provider, provider_subscription_id, created_at, updated_at
      ) VALUES (
        ${teamId}, ${mod.module_code}, ${status}, NULL, NULL,
        0, ${mod.currency || 'usd'}, 'plan_entitlement', ${source}, NOW(), NOW()
      )
      ON CONFLICT (team_id, module_code) DO UPDATE SET
        status = EXCLUDED.status,
        trial_ends_at = NULL,
        price_amount = 0,
        currency = EXCLUDED.currency,
        provider = 'plan_entitlement',
        provider_subscription_id = EXCLUDED.provider_subscription_id,
        updated_at = NOW()
    `;
  }

  for (const ch of channels) {
    await sql`
      INSERT INTO team_channel_module_subscriptions (
        team_id, module_key, status, is_active, price_cents, currency,
        stripe_subscription_id, stripe_price_id, trial_started_at, trial_ends_at,
        current_period_ends_at, canceled_at, metadata, created_at, updated_at
      ) VALUES (
        ${teamId}, ${ch.module_key}, ${status}, ${status === 'active' || status === 'trialing'}, 0, ${ch.currency || 'usd'},
        NULL, NULL, NULL, NULL,
        NULL, NULL, ${JSON.stringify({ source: 'plan_entitlement', included_by_plan: true, applied_by: 'polar_force_activate' })}::jsonb, NOW(), NOW()
      )
      ON CONFLICT (team_id, module_key) DO UPDATE SET
        status = EXCLUDED.status,
        is_active = EXCLUDED.is_active,
        price_cents = 0,
        currency = EXCLUDED.currency,
        stripe_subscription_id = NULL,
        stripe_price_id = NULL,
        trial_started_at = NULL,
        trial_ends_at = NULL,
        canceled_at = NULL,
        metadata = COALESCE(team_channel_module_subscriptions.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_at = NOW()
    `;
  }

  await sql`
    UPDATE team_module_subscriptions
    SET status = 'inactive', updated_at = NOW()
    WHERE team_id = ${teamId}
      AND provider = 'plan_entitlement'
      AND NOT (module_code = ANY(${modules.map((m) => m.module_code)}::text[]))
  `.catch(() => null);

  await sql`
    UPDATE team_channel_module_subscriptions
    SET status = 'inactive', is_active = false, canceled_at = NOW(), updated_at = NOW()
    WHERE team_id = ${teamId}
      AND (
        metadata @> ${JSON.stringify({ source: 'plan_entitlement' })}::jsonb
        OR metadata @> ${JSON.stringify({ included_by_plan: true })}::jsonb
      )
      AND NOT (module_key = ANY(${channels.map((c) => c.module_key)}::text[]))
  `.catch(() => null);

  return { modules: modules.length, channels: channels.length };
}

async function main() {
  const teamId = await resolveTeamId();
  const plan = await resolvePlan();
  if (!teamId) {
    console.error('No se encontró el cliente/equipo indicado. Usa --email=correo o --team-id=ID.');
    process.exit(1);
  }
  if (!plan) {
    console.error('No se encontró el plan indicado. Usa --plan="Nombre del plan" o --plan-id=ID.');
    process.exit(1);
  }

  const active = ['active', 'trialing', 'manual_active', 'paid'].includes(status);
  const periodEnd = active ? addDays(String(plan.interval || 'month') === 'year' ? 365 : 31) : null;
  const source = `manual_polar_${Date.now()}`;

  await sql.begin(async (tx) => {
    await tx`
      UPDATE teams
      SET plan_id = ${plan.id},
          plan_name = ${plan.name},
          subscription_status = ${status},
          billing_status = ${status},
          subscription_provider = 'polar',
          is_canceled = ${!active},
          current_period_start = CASE WHEN ${active} THEN COALESCE(current_period_start, NOW()) ELSE current_period_start END,
          current_period_end = CASE WHEN ${active} THEN ${periodEnd} ELSE current_period_end END,
          cancel_at_period_end = false,
          updated_at = NOW()
      WHERE id = ${teamId}
    `;
  });

  const entitlementResult = await syncEntitlements(teamId, plan.id, source);

  await sql`
    INSERT INTO billing_audit_logs (provider, action, team_id, user_id, metadata, created_at)
    VALUES ('polar', 'manual_plan_activation', ${teamId}, NULL, ${JSON.stringify({ plan_id: plan.id, plan_name: plan.name, status, source, email })}::jsonb, NOW())
  `.catch(() => null);

  console.log('Plan aplicado correctamente.');
  console.table([{ team_id: teamId, plan_id: plan.id, plan_name: plan.name, status, modules: entitlementResult.modules, channels: entitlementResult.channels }]);
}

main().catch((error) => {
  console.error('No se pudo aplicar el plan.', error);
  process.exitCode = 1;
}).finally(async () => {
  await sql.end({ timeout: 5 });
});
