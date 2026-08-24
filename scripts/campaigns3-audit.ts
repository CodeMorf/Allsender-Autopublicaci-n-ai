import { client } from '@/lib/db/drizzle';

const email = String(process.argv[2] || '').trim().toLowerCase();

if (!email || !email.includes('@')) {
  throw new Error('Uso: npx tsx scripts/campaigns3-audit.ts correo@dominio');
}

async function main() {
const memberships = await client<
  Array<{ user_id: number; email: string; team_id: number; team_name: string | null; role: string | null }>
>`
  SELECT u.id AS user_id, u.email, tm.team_id, t.name AS team_name, tm.role
  FROM users u
  INNER JOIN team_members tm ON tm.user_id = u.id
  INNER JOIN teams t ON t.id = tm.team_id
  WHERE LOWER(u.email) = ${email}
  ORDER BY tm.id ASC
`;

if (!memberships.length) {
  console.log(JSON.stringify({ ok: false, email, reason: 'USER_OR_TEAM_NOT_FOUND' }, null, 2));
  process.exit(2);
}

const result = [];
for (const membership of memberships) {
  const teamId = Number(membership.team_id);
  const [smtp] = await client<Array<{ total: number; healthy: number; active: number }>>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE health_status = 'HEALTHY')::int AS healthy,
           COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active
    FROM campaign_smtp_providers WHERE team_id = ${teamId}
  `;
  const [emailTemplates] = await client<Array<{ total: number; ready: number }>>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'READY'))::int AS ready
    FROM campaign_email_templates WHERE team_id = ${teamId}
  `;
  const [whatsapp] = await client<Array<{ evolution: number; meta: number; zernio: number }>>`
    SELECT
      (SELECT COUNT(*)::int FROM evolution_instances WHERE team_id = ${teamId}) AS evolution,
      (SELECT COUNT(*)::int FROM evolution_instances WHERE team_id = ${teamId} AND meta_phone_number_id IS NOT NULL) AS meta,
      (SELECT COUNT(*)::int FROM zernio_connections WHERE team_id = ${teamId}) AS zernio
  `;
  const whatsappTemplates = await client<Array<{ name: string; status: string; language: string }>>`
    SELECT name, status, language FROM waba_templates
    WHERE team_id = ${teamId}
    ORDER BY updated_at DESC LIMIT 20
  `;
  const [campaigns] = await client<Array<{ total: number; active: number; failed: number }>>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('READY', 'SCHEDULED', 'PROCESSING'))::int AS active,
           COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
    FROM campaigns WHERE team_id = ${teamId}
  `;

  result.push({
    teamId,
    teamName: membership.team_name,
    role: membership.role,
    smtp,
    emailTemplates,
    whatsapp,
    whatsappTemplates,
    campaigns,
  });
}

console.log(JSON.stringify({ ok: true, email, memberships: result }, null, 2));
}

main().then(() => client.end()).catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await client.end().catch(() => undefined);
  process.exit(1);
});
