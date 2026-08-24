import { client } from '@/lib/db/drizzle';
import { processCampaignById } from '@/lib/campaigns/process';

const targetEmail = String(process.argv[2] || '').trim().toLowerCase();
const allowSend = process.argv.includes('--send');

async function main() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) throw new Error('Indica un correo válido.');
  const campaigns = await client<Array<{ id: number; name: string; status: string; sent_count: number; lead_status: string; lead_email: string }>>`
    SELECT c.id, c.name, c.status, c.sent_count, cl.status AS lead_status, LOWER(cl.email) AS lead_email
    FROM campaigns c
    INNER JOIN campaign_leads cl ON cl.campaign_id = c.id
    INNER JOIN team_members tm ON tm.team_id = c.team_id
    INNER JOIN users u ON u.id = tm.user_id
    WHERE LOWER(u.email) = ${targetEmail}
      AND c.channel = 'EMAIL'
      AND c.test_mode = TRUE
      AND c.name LIKE 'Prueba Email · %'
      AND LOWER(cl.email) = ${targetEmail}
    ORDER BY c.id ASC
    LIMIT 4
  `;
  if (campaigns.length !== 4) throw new Error(`Se esperaban 4 campañas de prueba y se encontraron ${campaigns.length}.`);

  if (!allowSend) {
    console.log(JSON.stringify({ ok: true, dryRun: true, targetEmail, campaigns }, null, 2));
    return;
  }

  const results = [];
  for (const campaign of campaigns) {
    if (campaign.lead_status === 'SENT' || Number(campaign.sent_count || 0) > 0) {
      results.push({ campaignId: campaign.id, name: campaign.name, skipped: 'ALREADY_SENT' });
      continue;
    }
    await client`UPDATE campaigns SET status = 'READY', processing_started_at = NULL WHERE id = ${campaign.id} AND channel = 'EMAIL' AND test_mode = TRUE`;
    await client`UPDATE campaign_leads SET status = 'PENDING', error = NULL, claimed_at = NULL, idempotency_key = NULL WHERE campaign_id = ${campaign.id} AND LOWER(email) = ${targetEmail} AND status IN ('PENDING', 'FAILED')`;
    const result = await processCampaignById(Number(campaign.id));
    results.push({ campaignId: campaign.id, name: campaign.name, result });
  }

  const verification = await client<Array<{ id: number; name: string; status: string; sent_count: number; failed_count: number; lead_status: string; provider_message_id: string | null }>>`
    SELECT c.id, c.name, c.status, c.sent_count, c.failed_count, cl.status AS lead_status, cl.provider_message_id
    FROM campaigns c INNER JOIN campaign_leads cl ON cl.campaign_id = c.id
    WHERE c.id = ANY(${campaigns.map((item) => Number(item.id))}::int[])
    ORDER BY c.id ASC
  `;
  console.log(JSON.stringify({ ok: verification.every((item) => item.status === 'COMPLETED' && item.lead_status === 'SENT'), targetEmail, results, verification: verification.map((item) => ({ ...item, provider_message_id: item.provider_message_id ? 'PRESENT' : null })) }, null, 2));
}

main().then(() => client.end()).catch(async (error) => { console.error(error instanceof Error ? error.message : String(error)); await client.end().catch(() => undefined); process.exit(1); });
