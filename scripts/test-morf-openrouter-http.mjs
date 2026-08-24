import 'dotenv/config';

const apiKey =
  process.env.MORF_AI_OPENROUTER_API_KEY ||
  process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.log('Morf AI pendiente de activación.');
  process.exit(1);
}

try {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://auth.allsender.tech',
      'X-Title': 'AllSender Morf AI',
    },
    body: JSON.stringify({
      model: 'openrouter/auto',
      messages: [
        {
          role: 'user',
          content: 'Responde exactamente: Morf AI operativo.',
        },
      ],
      max_tokens: 30,
      temperature: 0.2,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    console.log('Morf AI no pudo responder ahora.');
    console.log('Estado:', response.status);
    console.log(text.slice(0, 800));
    process.exit(1);
  }

  const data = JSON.parse(text);
  console.log('OK:', data?.choices?.[0]?.message?.content || 'Morf AI respondió correctamente.');
} catch (error) {
  console.log('Morf AI no pudo responder ahora.');
  console.log(String(error?.message || error).slice(0, 800));
  process.exit(1);
}
