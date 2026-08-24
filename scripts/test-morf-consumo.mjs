import 'dotenv/config';
import postgres from 'postgres';

const url =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

const apiKey =
  process.env.MORF_AI_OPENROUTER_API_KEY ||
  process.env.OPENROUTER_API_KEY;

const teamId = 63;
const model = 'openrouter/auto';
const inputText = 'Responde exactamente: Prueba de consumo Morf AI correcta.';

if (!url) {
  console.log('No se pudo validar la base de datos.');
  process.exit(1);
}

if (!apiKey) {
  console.log('Morf AI pendiente de activación.');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const walletBefore = await sql`
    SELECT team_id, balance_cents, currency, status
    FROM morf_ai_wallets
    WHERE team_id = ${teamId}
    LIMIT 1
  `;

  console.log('Saldo antes:', walletBefore[0] || null);

  if (!walletBefore[0] || Number(walletBefore[0].balance_cents || 0) <= 0) {
    console.log('Recarga créditos para continuar usando Morf AI.');
    process.exit(1);
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://auth.allsender.tech',
      'X-Title': 'AllSender Morf AI',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: inputText }],
      max_tokens: 40,
      temperature: 0.2,
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    console.log('Morf AI no pudo responder ahora.');
    console.log('Estado:', response.status);
    console.log(raw.slice(0, 800));
    process.exit(1);
  }

  const data = JSON.parse(raw);
  const outputText = data?.choices?.[0]?.message?.content || 'Morf AI respondió correctamente.';

  const inputTokens = Number(data?.usage?.prompt_tokens || 0);
  const outputTokens = Number(data?.usage?.completion_tokens || 0);

  const costCents = 1;

  await sql.begin(async tx => {
    await tx`
      UPDATE morf_ai_wallets
      SET balance_cents = GREATEST(0, balance_cents - ${costCents}),
          updated_at = NOW()
      WHERE team_id = ${teamId}
    `;

    await tx`
      INSERT INTO morf_ai_usage_logs (
        team_id,
        module_code,
        provider,
        model,
        input_tokens,
        output_tokens,
        provider_cost_cents,
        customer_cost_cents,
        markup_percent,
        status,
        metadata,
        created_at
      )
      VALUES (
        ${teamId},
        'morf_test',
        'openrouter',
        ${model},
        ${inputTokens},
        ${outputTokens},
        0,
        ${costCents},
        15.00,
        'completed',
        ${JSON.stringify({
          source: 'manual_test',
          input_preview: inputText.slice(0, 120),
          output_preview: outputText.slice(0, 200),
        })}::jsonb,
        NOW()
      )
    `;
  });

  const walletAfter = await sql`
    SELECT team_id, balance_cents, currency, status, updated_at
    FROM morf_ai_wallets
    WHERE team_id = ${teamId}
    LIMIT 1
  `;

  console.log('Respuesta:', outputText);
  console.log('Saldo después:', walletAfter[0] || null);
  console.log('OK: consumo Morf AI registrado.');
} catch (error) {
  console.log('No se pudo completar la prueba de consumo.');
  console.log(String(error?.message || error).slice(0, 800));
  process.exit(1);
} finally {
  await sql.end();
}
