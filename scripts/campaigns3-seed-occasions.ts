import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { client } from '@/lib/db/drizzle';

const targetEmail = String(process.argv[2] || '').trim().toLowerCase();

function encryptionKey() {
  const secret = process.env.CAMPAIGN_SETTINGS_ENCRYPTION_KEY || process.env.AUTH_SECRET || '';
  if (!secret) throw new Error('CAMPAIGN_SETTINGS_ENCRYPTION_KEY o AUTH_SECRET no está configurada.');
  return createHash('sha256').update(secret).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function lastSunday(year: number, monthIndex: number) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function emailHtml(title: string, message: string, accent: string) {
  return `<div style="background:#f8fafc;padding:32px 16px;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:620px;margin:auto;background:white;border-radius:22px;overflow:hidden;border:1px solid #e2e8f0"><div style="background:${accent};padding:30px;color:white"><div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">AllSender</div><h1 style="margin:10px 0 0;font-size:30px;line-height:1.2">${title}</h1></div><div style="padding:30px"><p style="font-size:18px;font-weight:700">Hola {{nombre|Cliente}},</p><p style="font-size:15px;line-height:1.8;color:#475569">${message}</p><a href="https://allsender.tech" style="display:inline-block;margin-top:12px;background:#111827;color:white;padding:13px 20px;border-radius:10px;text-decoration:none;font-weight:700">Descubrir AllSender</a><p style="margin-top:28px;font-size:12px;color:#94a3b8">Prueba controlada de AllSender Campaigns 3.0.</p></div></div></div>`;
}

const occasions = [
  { key: 'birthday', name: 'Cumpleaños', subject: '🎉 {{nombre|Amigo}}, hoy celebramos contigo', title: 'Tu día merece una gran conversación', message: 'Celebramos contigo y queremos recordarte que cada relación empieza con un mensaje oportuno. AllSender ayuda a convertir momentos especiales en experiencias cercanas y medibles.', accent: '#7c3aed', trigger: 'BIRTHDAY' },
  { key: 'valentines', name: 'San Valentín', subject: '💜 {{nombre|Amigo}}, convierte conversaciones en relaciones', title: 'Las mejores relaciones comienzan conversando', message: 'Este San Valentín conecta con tus clientes de forma auténtica. Centraliza WhatsApp, email y automatizaciones para acompañar cada oportunidad con contexto.', accent: '#e11d48', trigger: 'SPECIAL_DATE' },
  { key: 'mothers_day', name: 'Día de las Madres', subject: '🌷 {{nombre|Amigo}}, hoy celebramos su historia', title: 'Gracias, mamá', message: 'Una fecha para reconocer cuidado, constancia y cercanía. Diseña campañas humanas, oportunas y respetuosas desde un solo centro omnicanal.', accent: '#db2777', trigger: 'SPECIAL_DATE' },
  { key: 'fathers_day', name: 'Día de los Padres', subject: '💙 {{nombre|Amigo}}, un mensaje para papá', title: 'Para papá, un detalle que se recuerda', message: 'Acompaña esta fecha con mensajes relevantes y una experiencia consistente en cada canal. AllSender organiza audiencia, contenido, entrega y resultados.', accent: '#2563eb', trigger: 'SPECIAL_DATE' },
] as const;

async function main() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) throw new Error('Indica un correo válido.');
  const membership = (await client<Array<{ team_id: number; name: string | null }>>`
    SELECT tm.team_id, t.name FROM users u
    INNER JOIN team_members tm ON tm.user_id = u.id
    INNER JOIN teams t ON t.id = tm.team_id
    WHERE LOWER(u.email) = ${targetEmail}
    ORDER BY tm.id ASC LIMIT 1
  `)[0];
  if (!membership) throw new Error('No se encontró el equipo del correo indicado.');
  const teamId = Number(membership.team_id);

  const smtpHost = String(process.env.SMTP_HOST || '').trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPass = String(process.env.SMTP_PASS || '');
  const smtpFromEmail = String(process.env.SMTP_FROM_EMAIL || smtpUser).trim().toLowerCase();
  const smtpFromName = String(process.env.SMTP_FROM_NAME || 'AllSender').trim();
  if (!smtpHost || !smtpUser || !smtpPass || !smtpFromEmail) throw new Error('El SMTP del servidor está incompleto.');

  const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: smtpUser, pass: smtpPass } });
  await transporter.verify();

  const existingProvider = (await client<Array<{ id: number }>>`
    SELECT id FROM campaign_smtp_providers WHERE team_id = ${teamId} AND name = 'AllSender Server SMTP' LIMIT 1
  `)[0];
  let smtpProviderId = Number(existingProvider?.id || 0);
  if (smtpProviderId) {
    await client`
      UPDATE campaign_smtp_providers SET host = ${smtpHost}, port = ${smtpPort}, secure = ${smtpPort === 465}, username = ${smtpUser}, password_ciphertext = ${encryptSecret(smtpPass)}, from_name = ${smtpFromName}, from_email = ${smtpFromEmail}, priority = 1, is_active = TRUE, health_status = 'HEALTHY', last_checked_at = NOW(), last_error = NULL, updated_at = NOW()
      WHERE id = ${smtpProviderId} AND team_id = ${teamId}
    `;
  } else {
    smtpProviderId = Number((await client<Array<{ id: number }>>`
      INSERT INTO campaign_smtp_providers (team_id, name, host, port, secure, username, password_ciphertext, from_name, from_email, priority, daily_limit, is_active, health_status, last_checked_at)
      VALUES (${teamId}, 'AllSender Server SMTP', ${smtpHost}, ${smtpPort}, ${smtpPort === 465}, ${smtpUser}, ${encryptSecret(smtpPass)}, ${smtpFromName}, ${smtpFromEmail}, 1, 100, TRUE, 'HEALTHY', NOW()) RETURNING id
    `)[0].id);
  }

  await client`
    INSERT INTO campaign_settings (team_id, general, router, limits, exclusions, automations)
    VALUES (${teamId}, ${JSON.stringify({ timezone: 'America/Santo_Domingo', defaultChannel: 'EMAIL', testMode: true, testRecipients: [targetEmail] })}::jsonb, ${JSON.stringify({ whatsapp: ['meta_direct', 'zernio', 'evolution'], email: ['smtp_priority'], llm: { capability: 'text', strategy: 'primary_then_fallback' } })}::jsonb, ${JSON.stringify({ batchSize: 10, delaySeconds: 1, maxAttempts: 2 })}::jsonb, ${JSON.stringify({ unsubscribed: true, invalid: true, bounced: true, complaint: true })}::jsonb, '{}'::jsonb)
    ON CONFLICT (team_id) DO UPDATE SET
      general = campaign_settings.general || EXCLUDED.general,
      router = campaign_settings.router || EXCLUDED.router,
      limits = campaign_settings.limits || EXCLUDED.limits,
      exclusions = campaign_settings.exclusions || EXCLUDED.exclusions,
      updated_at = NOW()
  `;

  const templateIds: Record<string, number> = {};
  const campaignIds: Record<string, number> = {};
  for (const occasion of occasions) {
    const providerName = `allsender_${occasion.key}_test`;
    const existingTemplate = (await client<Array<{ id: number }>>`SELECT id FROM campaign_email_templates WHERE team_id = ${teamId} AND provider_name = ${providerName} LIMIT 1`)[0];
    const html = emailHtml(occasion.title, occasion.message, occasion.accent);
    let templateId = Number(existingTemplate?.id || 0);
    if (templateId) {
      await client`UPDATE campaign_email_templates SET display_name = ${occasion.name}, subject = ${occasion.subject}, preheader = ${occasion.title}, html = ${html}, plain_text = ${`${occasion.title}\n\nHola {{nombre|Cliente}},\n\n${occasion.message}\n\nhttps://allsender.tech`}, sender = ${smtpFromName}, language = 'es', category = 'MARKETING', variables = '["nombre"]'::jsonb, version = version + 1, status = 'ACTIVE', updated_at = NOW() WHERE id = ${templateId} AND team_id = ${teamId}`;
    } else {
      templateId = Number((await client<Array<{ id: number }>>`INSERT INTO campaign_email_templates (team_id, display_name, provider_name, subject, preheader, html, plain_text, sender, language, category, variables, status) VALUES (${teamId}, ${occasion.name}, ${providerName}, ${occasion.subject}, ${occasion.title}, ${html}, ${`${occasion.title}\n\nHola {{nombre|Cliente}},\n\n${occasion.message}\n\nhttps://allsender.tech`}, ${smtpFromName}, 'es', 'MARKETING', '["nombre"]'::jsonb, 'ACTIVE') RETURNING id`)[0].id);
    }
    templateIds[occasion.key] = templateId;

    const campaignName = `Prueba Email · ${occasion.name} · ${targetEmail}`;
    const existingCampaign = (await client<Array<{ id: number }>>`SELECT id FROM campaigns WHERE team_id = ${teamId} AND channel = 'EMAIL' AND name = ${campaignName} ORDER BY id DESC LIMIT 1`)[0];
    let campaignId = Number(existingCampaign?.id || 0);
    if (!campaignId) {
      campaignId = Number((await client<Array<{ id: number }>>`INSERT INTO campaigns (team_id, instance_id, name, channel, status, email_template_id, smtp_provider_id, test_mode, total_leads) VALUES (${teamId}, NULL, ${campaignName}, 'EMAIL', 'DRAFT', ${templateId}, ${smtpProviderId}, TRUE, 1) RETURNING id`)[0].id);
      await client`INSERT INTO campaign_leads (campaign_id, phone, email, variables, status) VALUES (${campaignId}, NULL, ${targetEmail}, ${JSON.stringify({ nombre: 'AllSender', name: 'AllSender', email: targetEmail, __campaignChannel: 'EMAIL', __campaignDelaySeconds: 1 })}::jsonb, 'PENDING')`;
    }
    campaignIds[occasion.key] = campaignId;

    const automationName = `${occasion.name} · Email · Modo prueba`;
    const rules = occasion.trigger === 'BIRTHDAY' ? { dateField: 'birth_date', daysOffset: 0, requiresAudienceField: true } : { eventType: occasion.key.toUpperCase(), daysOffset: -7, requiresCalendarEvent: true };
    const actions = [{ type: 'CREATE_CAMPAIGN', channel: 'EMAIL', emailTemplateId: templateId, smtpProviderId, testMode: true }];
    const existingAutomation = (await client<Array<{ id: number }>>`SELECT id FROM campaign_automations WHERE team_id = ${teamId} AND name = ${automationName} LIMIT 1`)[0];
    if (existingAutomation) await client`UPDATE campaign_automations SET trigger_type = ${occasion.trigger}, rules = ${JSON.stringify(rules)}::jsonb, actions = ${JSON.stringify(actions)}::jsonb, is_active = FALSE, updated_at = NOW() WHERE id = ${existingAutomation.id} AND team_id = ${teamId}`;
    else await client`INSERT INTO campaign_automations (team_id, name, trigger_type, rules, actions, is_active) VALUES (${teamId}, ${automationName}, ${occasion.trigger}, ${JSON.stringify(rules)}::jsonb, ${JSON.stringify(actions)}::jsonb, FALSE)`;
  }

  const nextYear = new Date().getUTCFullYear() + 1;
  const calendar = [
    { date: `${nextYear}-02-14`, name: 'San Valentín', type: 'VALENTINES' },
    { date: lastSunday(nextYear, 4), name: 'Día de las Madres', type: 'MOTHERS_DAY' },
    { date: lastSunday(nextYear, 6), name: 'Día de los Padres', type: 'FATHERS_DAY' },
  ];
  for (const event of calendar) await client`INSERT INTO campaign_calendar_events (team_id, country, year, timezone, language, event_date, name, event_type, is_custom) VALUES (${teamId}, 'DO', ${nextYear}, 'America/Santo_Domingo', 'es', ${event.date}, ${event.name}, ${event.type}, FALSE) ON CONFLICT (team_id, country, year, event_date, name) DO UPDATE SET event_type = EXCLUDED.event_type, timezone = EXCLUDED.timezone, updated_at = NOW()`;

  console.log(JSON.stringify({ ok: true, teamId, smtpProviderId, smtpHealth: 'HEALTHY', targetEmail, templateIds, campaignIds, whatsapp: { status: 'BLOCKED_NO_APPROVED_TEMPLATE_OR_TEST_PHONE' } }, null, 2));
}

main().then(() => client.end()).catch(async (error) => { console.error(error instanceof Error ? error.message : String(error)); await client.end().catch(() => undefined); process.exit(1); });
